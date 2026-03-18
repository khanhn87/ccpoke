import type TelegramBot from "node-telegram-bot-api";

import type { PermissionRequestEvent } from "../../agent/agent-handler.js";
import { AGENT_DISPLAY_NAMES, AgentName } from "../../agent/types.js";
import { t } from "../../i18n/index.js";
import type { PaneRegistry } from "../../tmux/pane-registry.js";
import type { TmuxBridge } from "../../tmux/tmux-bridge.js";
import { logger } from "../../utils/log.js";
import {
  isExitPlanMode,
  parsePermissionCallback,
  PermissionTuiInjector,
} from "../permission-tui-injector.js";
import { buildSessionLabel } from "../session-label.js";
import { summarizeTool } from "../summarize-tool.js";
import { escapeMarkdownV2 } from "./escape-markdown.js";
import { padMaxWidth } from "./telegram-sender.js";

interface PendingPermission {
  pendingId: number;
  sessionId: string;
  paneId: string;
  toolName: string;
  toolSummary: string;
  planLabels?: string[];
  createdAt: number;
}

const EXPIRE_MS = 10 * 60 * 1000;
const MAX_PENDING = 50;
const NBSP = "\u00A0";

export class PermissionRequestHandler {
  private pending = new Map<number, PendingPermission>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextPendingId = 1;
  private processedCallbacks = new Set<string>();
  private injector: PermissionTuiInjector;

  constructor(
    private bot: TelegramBot,
    private chatId: () => number | null,
    private paneRegistry: PaneRegistry,
    tmuxBridge: TmuxBridge
  ) {
    this.injector = new PermissionTuiInjector(tmuxBridge);
  }

  async forwardPermission(event: PermissionRequestEvent): Promise<void> {
    const chat = this.chatId();
    if (!chat || !event.paneId) return;

    logger.info(
      `[PermReq] sessionId=${event.sessionId} paneId=${event.paneId} tool=${event.toolName}`
    );

    if (this.pending.size >= MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.clearPending(oldest[0]);
    }

    const pendingId = this.nextPendingId++;
    const toolSummary = summarizeTool(event.toolName, event.toolInput);
    const pane = this.paneRegistry.getByPaneId(event.paneId);
    const projectName = pane?.project ?? "unknown";
    const agentName = AGENT_DISPLAY_NAMES[pane?.agent ?? AgentName.ClaudeCode];

    const planLabels = isExitPlanMode(event.toolName)
      ? this.injector.extractPlanOptions(event.paneId)
      : undefined;

    const pp: PendingPermission = {
      pendingId,
      sessionId: event.sessionId,
      paneId: event.paneId,
      toolName: event.toolName,
      toolSummary,
      planLabels,
      createdAt: Date.now(),
    };

    this.setPending(pendingId, pp);

    const text = padMaxWidth(
      this.formatMessage(
        projectName,
        agentName,
        event.toolName,
        toolSummary,
        event.paneId,
        pane?.model ?? ""
      )
    );
    const keyboard = planLabels
      ? this.buildPlanKeyboard(pendingId, planLabels)
      : this.buildStandardKeyboard(pendingId);

    await this.bot
      .sendMessage(chat, text, { parse_mode: "MarkdownV2", reply_markup: keyboard })
      .catch((err: unknown) => logger.error({ err }, "[PermReq] send failed"));
  }

  async handleCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.data || !query.message) return;

    if (this.processedCallbacks.has(query.id)) {
      try {
        await this.bot.answerCallbackQuery(query.id);
      } catch {
        /* best-effort */
      }
      return;
    }
    this.processedCallbacks.add(query.id);
    if (this.processedCallbacks.size > 200) {
      const first = this.processedCallbacks.values().next().value as string;
      this.processedCallbacks.delete(first);
    }

    const parts = query.data.split(":");
    if (parts.length < 3) return;

    const action = parts[1]!;
    const pendingId = parseInt(parts[2]!, 10);

    const pp = this.pending.get(pendingId);
    if (!pp) {
      await this.bot.answerCallbackQuery(query.id, { text: t("permissionRequest.sessionExpired") });
      return;
    }

    await this.bot.answerCallbackQuery(query.id, { text: t("permissionRequest.sending") });

    const injectionResult = parsePermissionCallback(action);

    let resultText: string;
    let resultEmoji: string;

    if (injectionResult.action === "plan-option") {
      const label = pp.planLabels?.[injectionResult.optionIndex!] ?? "";
      resultText = t("permissionRequest.planApproved", { option: label });
      resultEmoji = "✅";
    } else {
      const allow = injectionResult.action === "allow";
      resultText = allow
        ? t("permissionRequest.allowed", { tool: pp.toolName, summary: pp.toolSummary })
        : t("permissionRequest.denied", { tool: pp.toolName, summary: pp.toolSummary });
      resultEmoji = allow ? "✅" : "❌";
    }

    await this.bot
      .editMessageText(padMaxWidth(`${resultEmoji} ${escapeMarkdownV2(resultText)}`), {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: "MarkdownV2",
      })
      .catch(() => {});

    try {
      await this.injector.inject(pp.paneId, injectionResult);
      logger.debug(`[PermReq] injected ${injectionResult.action} → ${pp.paneId}`);
    } catch (err) {
      logger.error({ err }, t("permissionRequest.injectionFailed"));
    }

    this.clearPending(pendingId);
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.processedCallbacks.clear();
  }

  private buildPlanKeyboard(pendingId: number, labels: string[]): TelegramBot.InlineKeyboardMarkup {
    const emojis = ["🔄", "⚡", "✋"];
    const maxLen = Math.max(...labels.map((l) => l.length));
    return {
      inline_keyboard: labels.map((label, i) => [
        {
          text: `${emojis[i]} ${label}${NBSP.repeat(maxLen - label.length)}`,
          callback_data: `perm:e${i}:${pendingId}`,
        },
      ]),
    };
  }

  private buildStandardKeyboard(pendingId: number): TelegramBot.InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: `✅ ${t("permissionRequest.allow")}`, callback_data: `perm:a:${pendingId}` },
          { text: `❌ ${t("permissionRequest.deny")}`, callback_data: `perm:d:${pendingId}` },
        ],
      ],
    };
  }

  private formatMessage(
    project: string,
    agent: string,
    toolName: string,
    summary: string,
    paneId: string,
    model: string
  ): string {
    const label = buildSessionLabel(project, model, paneId);

    if (isExitPlanMode(toolName)) {
      const titleLine = `*${escapeMarkdownV2(label)}*`;
      const metaLine = `🐾 ${escapeMarkdownV2(agent)}`;
      const planLine = `\n${escapeMarkdownV2(t("permissionRequest.planTitle"))}`;
      return `${titleLine}\n${metaLine}\n${planLine}`;
    }

    const header = `⚠️ *${escapeMarkdownV2(t("permissionRequest.title"))}*\n_${escapeMarkdownV2(label)}_`;
    const tool = `🔧 *${escapeMarkdownV2(toolName)}*\n\`${escapeMarkdownV2(summary)}\``;
    return `${header}\n\n${tool}`;
  }

  private setPending(pendingId: number, pp: PendingPermission): void {
    this.pending.set(pendingId, pp);
    const timer = setTimeout(() => this.clearPending(pendingId), EXPIRE_MS);
    this.timers.set(pendingId, timer);
  }

  private clearPending(pendingId: number): void {
    this.pending.delete(pendingId);
    const timer = this.timers.get(pendingId);
    if (timer) clearTimeout(timer);
    this.timers.delete(pendingId);
  }
}
