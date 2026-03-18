import type TelegramBot from "node-telegram-bot-api";

import type { NotificationEvent } from "../../agent/agent-handler.js";
import type { AgentRegistry } from "../../agent/agent-registry.js";
import { t } from "../../i18n/index.js";
import { PaneState, type PaneRegistry } from "../../tmux/pane-registry.js";
import type { TmuxBridge } from "../../tmux/tmux-bridge.js";
import { queryPanePid } from "../../tmux/tmux-scanner.js";
import { logger } from "../../utils/log.js";
import { buildTargetCallback } from "./callback-parser.js";
import { escapeMarkdownV2 } from "./escape-markdown.js";
import { padMaxWidth } from "./telegram-sender.js";

interface PendingPrompt {
  paneId: string;
  createdAt: number;
}

const PROMPT_EXPIRE_MS = 10 * 60 * 1000;
const MAX_PENDING = 100;
const MAX_RESPONSE_LENGTH = 10_000;

export class PromptHandler {
  private pending = new Map<string, PendingPrompt>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private bot: TelegramBot,
    private chatId: () => number | null,
    private paneRegistry: PaneRegistry,
    private tmuxBridge: TmuxBridge,
    private registry: AgentRegistry
  ) {}

  async forwardPrompt(event: NotificationEvent): Promise<void> {
    const chat = this.chatId();
    if (!chat) return;

    if (event.notificationType === "elicitation_dialog") {
      await this.sendElicitationPrompt(chat, event);
    }
  }

  injectElicitationResponse(paneId: string, text: string): boolean {
    const pane = this.paneRegistry.getByPaneId(paneId);
    if (!pane) return false;

    if (!this.pending.has(paneId)) return false;
    logger.info(`[Prompt:inject] paneId=${paneId} text="${text.slice(0, 50)}"`);

    const trimmed = text.trim();
    if (trimmed.length === 0) return false;

    const safeText =
      trimmed.length > MAX_RESPONSE_LENGTH ? trimmed.slice(0, MAX_RESPONSE_LENGTH) : trimmed;

    const submitKeys = this.registry.resolve(pane.agent)!.submitKeys;

    try {
      this.tmuxBridge.sendKeys(pane.paneId, safeText, submitKeys);
    } catch {
      return false;
    }

    this.paneRegistry.updateState(paneId, PaneState.Busy);
    this.paneRegistry.touch(paneId);
    this.clearPending(paneId);
    return true;
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  onElicitationSent?: (
    chatId: number,
    messageId: number,
    paneId: string,
    panePid: string,
    project: string
  ) => void;

  private async sendElicitationPrompt(chatId: number, event: NotificationEvent): Promise<void> {
    const paneId = event.paneId;
    if (!paneId) return;

    const title = event.title
      ? `\u2753 *${escapeMarkdownV2(event.title)}*`
      : `\u2753 *${escapeMarkdownV2(t("prompt.elicitationTitle"))}*`;

    const body = escapeMarkdownV2(event.message);
    const project = this.resolveProjectName(paneId);
    const projectLine = project ? `\n_${escapeMarkdownV2(project)}_` : "";

    const panePid = queryPanePid(paneId) ?? "0";
    const callbackData = buildTargetCallback("elicit", paneId, panePid);

    const text = padMaxWidth(
      `${title}${projectLine}\n\n${body}\n\n${escapeMarkdownV2(t("prompt.elicitationReplyHint"))}`
    );

    const sent = await this.bot
      .sendMessage(chatId, text, {
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [{ text: `💬 ${t("prompt.replyButton")}`, callback_data: callbackData }],
          ],
        },
      })
      .catch(() => null);

    if (sent) {
      this.setPending(paneId);
      this.onElicitationSent?.(chatId, sent.message_id, paneId, panePid, project ?? "");
    }
  }

  private resolveProjectName(paneId: string): string | undefined {
    return this.paneRegistry.getByPaneId(paneId)?.project;
  }

  private setPending(paneId: string): void {
    if (this.pending.size >= MAX_PENDING && !this.pending.has(paneId)) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.clearPending(oldest[0]);
    }

    this.clearPending(paneId);
    this.pending.set(paneId, { paneId, createdAt: Date.now() });

    const timer = setTimeout(() => {
      this.pending.delete(paneId);
      this.timers.delete(paneId);
    }, PROMPT_EXPIRE_MS);
    this.timers.set(paneId, timer);
  }

  private clearPending(paneId: string): void {
    this.pending.delete(paneId);
    const timer = this.timers.get(paneId);
    if (timer) clearTimeout(timer);
    this.timers.delete(paneId);
  }
}
