import type TelegramBot from "node-telegram-bot-api";

import type { AskUserQuestionEvent, AskUserQuestionItem } from "../../agent/agent-handler.js";
import { t } from "../../i18n/index.js";
import type { PaneRegistry } from "../../tmux/pane-registry.js";
import type { TmuxBridge } from "../../tmux/tmux-bridge.js";
import { logger } from "../../utils/log.js";
import { buildSessionLabel } from "../session-label.js";
import {
  buildMultiSelectKeyboard,
  buildSingleSelectKeyboard,
} from "./ask-question-keyboard-builder.js";
import { AskQuestionTuiInjector, type InjectionAnswer } from "./ask-question-tui-injector.js";
import { escapeMarkdownV2 } from "./escape-markdown.js";
import { padMaxWidth } from "./telegram-sender.js";

interface PendingQuestion {
  pendingId: number;
  sessionId: string;
  paneId: string;
  agent?: string;
  questions: AskUserQuestionItem[];
  currentIndex: number;
  answers: Map<number, InjectionAnswer>;
  messageIds: Map<number, number>;
  multiSelectState: Map<number, Set<number>>;
  createdAt: number;
}

const EXPIRE_MS = 10 * 60 * 1000;
const MAX_PENDING = 50;

export class AskQuestionHandler {
  private pending = new Map<string, PendingQuestion>();
  private pendingById = new Map<number, string>();
  private nextPendingId = 1;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private injector: AskQuestionTuiInjector;
  private callbackLocks = new Map<number, Promise<void>>();
  private processedCallbacks = new Set<string>();

  constructor(
    private bot: TelegramBot,
    private chatId: () => number | null,
    tmuxBridge: TmuxBridge,
    private paneRegistry: PaneRegistry | null
  ) {
    this.injector = new AskQuestionTuiInjector(tmuxBridge);
  }

  async forwardQuestion(event: AskUserQuestionEvent): Promise<void> {
    const chat = this.chatId();
    if (!chat || !event.paneId || event.questions.length === 0) return;

    logger.info(
      `[AskQ] sessionId=${event.sessionId} paneId=${event.paneId} questions=${event.questions.length}`
    );

    if (this.pending.size >= MAX_PENDING && !this.pending.has(event.paneId)) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.clearPending(oldest[0]);
    }

    const pendingId = this.nextPendingId++;
    const pq: PendingQuestion = {
      pendingId,
      sessionId: event.sessionId,
      paneId: event.paneId,
      agent: event.agent,
      questions: event.questions,
      currentIndex: 0,
      answers: new Map(),
      messageIds: new Map(),
      multiSelectState: new Map(),
      createdAt: Date.now(),
    };

    logger.info(
      `[AskQ:store] pendingId=${pendingId} paneId=${event.paneId} pending.keys=[${[...this.pending.keys()].join(",")}]`
    );

    this.setPending(event.paneId, pq);
    await this.sendQuestion(chat, pq, 0);
  }

  async handleCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.data || !query.message) return;

    if (this.processedCallbacks.has(query.id)) {
      logger.debug(`[AskQ:callback] DEDUP skip id=${query.id}`);
      try {
        await this.bot.answerCallbackQuery(query.id);
      } catch {
        /* best-effort ack */
      }
      return;
    }
    this.processedCallbacks.add(query.id);
    if (this.processedCallbacks.size > 200) {
      const first = this.processedCallbacks.values().next().value as string;
      this.processedCallbacks.delete(first);
    }

    logger.debug(`[AskQ:callback] data=${query.data}`);

    const msgId = query.message.message_id;
    const prev = this.callbackLocks.get(msgId) ?? Promise.resolve();
    const current = prev
      .then(() => this.processCallback(query))
      .catch((err) => {
        logger.error({ err }, "[AskQ:callback] error");
      });
    this.callbackLocks.set(msgId, current);
    await current;
  }

  private async processCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    if (!query.data) return;

    if (query.data.startsWith("aq:")) {
      await this.handleSingleSelectCallback(query);
    } else if (query.data.startsWith("am:")) {
      await this.handleMultiSelectCallback(query);
    }
  }

  hasPendingOtherReply(_chatId: number, _messageId: number): boolean {
    return false;
  }

  async handleOtherTextReply(_chatId: number, _messageId: number, _text: string): Promise<boolean> {
    return false;
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.pendingById.clear();
    this.callbackLocks.clear();
    this.processedCallbacks.clear();
  }

  private async sendQuestion(chatId: number, pq: PendingQuestion, qIdx: number): Promise<void> {
    const q = pq.questions[qIdx];
    if (!q) return;

    const sessionLine = this.buildSessionLine(pq.paneId);
    const header = formatQuestionHeader(pq, qIdx);
    const hint = q.multiSelect ? t("askQuestion.multiSelectHint") : t("askQuestion.selectHint");
    const optionList = formatOptionList(q);
    const headerBlock = sessionLine ? `${sessionLine}\n${header}` : header;
    const text = padMaxWidth(
      optionList
        ? `${headerBlock}\n\n${escapeMarkdownV2(q.question)}\n\n${optionList}\n\n_${escapeMarkdownV2(hint)}_`
        : `${headerBlock}\n\n${escapeMarkdownV2(q.question)}\n\n_${escapeMarkdownV2(hint)}_`
    );

    const keyboard = q.multiSelect
      ? buildMultiSelectKeyboard(pq.pendingId, qIdx, q, new Set())
      : buildSingleSelectKeyboard(pq.pendingId, qIdx, q);

    const sent = await this.bot
      .sendMessage(chatId, text, { parse_mode: "MarkdownV2", reply_markup: keyboard })
      .catch(() => null);

    if (sent) {
      pq.messageIds.set(qIdx, sent.message_id);
      if (q.multiSelect) pq.multiSelectState.set(qIdx, new Set());
    }
  }

  private async handleSingleSelectCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const parts = query.data!.split(":");
    if (parts.length < 4) return;

    const pendingId = parseInt(parts[1]!, 10);
    const qIdx = parseInt(parts[2]!, 10);
    const optPart = parts[3]!;

    const pq = this.findPendingByNumericId(pendingId);
    if (!pq) {
      logger.debug(`[AskQ:single] pendingId=${pendingId} NOT FOUND`);
      await this.bot.answerCallbackQuery(query.id, { text: t("askQuestion.sessionExpired") });
      return;
    }
    logger.debug(
      `[AskQ:single] pendingId=${pendingId} → sessionId=${pq.sessionId} paneId=${pq.paneId} opt=${optPart}`
    );

    const optIdx = parseInt(optPart, 10);
    const q = pq.questions[qIdx];
    if (!q || optIdx < 0 || optIdx >= q.options.length) return;

    await this.bot.answerCallbackQuery(query.id, { text: t("askQuestion.sending") });
    pq.answers.set(qIdx, { indices: [optIdx] });

    const msgId = pq.messageIds.get(qIdx);
    if (msgId) {
      await this.bot
        .editMessageText(
          padMaxWidth(
            `${formatQuestionHeader(pq, qIdx)}\n\n${escapeMarkdownV2(t("askQuestion.selected", { option: q.options[optIdx]!.label }))}`
          ),
          { chat_id: query.message!.chat.id, message_id: msgId, parse_mode: "MarkdownV2" }
        )
        .catch(() => {});
    }

    await this.injectAnswer(pq, qIdx);
    await this.advanceToNext(query.message!.chat.id, pq);
  }

  private async handleMultiSelectCallback(query: TelegramBot.CallbackQuery): Promise<void> {
    const parts = query.data!.split(":");
    if (parts.length < 4) return;

    const pendingId = parseInt(parts[1]!, 10);
    const qIdx = parseInt(parts[2]!, 10);
    const optPart = parts[3]!;

    const pq = this.findPendingByNumericId(pendingId);
    if (!pq) {
      logger.debug(`[AskQ:multi] pendingId=${pendingId} NOT FOUND`);
      await this.bot.answerCallbackQuery(query.id, { text: t("askQuestion.sessionExpired") });
      return;
    }
    logger.debug(
      `[AskQ:multi] pendingId=${pendingId} → sessionId=${pq.sessionId} paneId=${pq.paneId} opt=${optPart}`
    );

    const q = pq.questions[qIdx];
    if (!q) return;

    if (optPart === "c") {
      await this.handleMultiSelectConfirm(query, pq, qIdx, q);
      return;
    }

    const optIdx = parseInt(optPart, 10);
    if (optIdx < 0 || optIdx >= q.options.length) return;

    const toggleSet = pq.multiSelectState.get(qIdx) ?? new Set();
    if (toggleSet.has(optIdx)) {
      toggleSet.delete(optIdx);
    } else {
      toggleSet.add(optIdx);
    }
    pq.multiSelectState.set(qIdx, toggleSet);

    const keyboard = buildMultiSelectKeyboard(pq.pendingId, qIdx, q, toggleSet);

    await this.bot.answerCallbackQuery(query.id);
    await this.bot
      .editMessageReplyMarkup(keyboard, {
        chat_id: query.message!.chat.id,
        message_id: query.message!.message_id,
      })
      .catch(() => {});
  }

  private async handleMultiSelectConfirm(
    query: TelegramBot.CallbackQuery,
    pq: PendingQuestion,
    qIdx: number,
    q: AskUserQuestionItem
  ): Promise<void> {
    await this.bot.answerCallbackQuery(query.id, { text: t("askQuestion.sending") });

    const selected = pq.multiSelectState.get(qIdx) ?? new Set();
    pq.answers.set(qIdx, {
      indices: [...selected].sort((a, b) => a - b),
    });

    const labels = [...selected]
      .sort((a, b) => a - b)
      .map((i) => q.options[i]?.label ?? "")
      .filter(Boolean);

    const msgId = pq.messageIds.get(qIdx);
    if (msgId) {
      await this.bot
        .editMessageText(
          padMaxWidth(
            `${formatQuestionHeader(pq, qIdx)}\n\n${escapeMarkdownV2(t("askQuestion.selectedMultiple", { options: labels.join(", ") }))}`
          ),
          { chat_id: query.message!.chat.id, message_id: msgId, parse_mode: "MarkdownV2" }
        )
        .catch(() => {});
    }

    await this.injectAnswer(pq, qIdx);
    await this.advanceToNext(query.message!.chat.id, pq);
  }

  private async injectAnswer(pq: PendingQuestion, qIdx: number): Promise<void> {
    const q = pq.questions[qIdx];
    const answer = pq.answers.get(qIdx);
    if (!q || !answer) return;

    logger.debug(
      `[AskQ:inject] paneId=${pq.paneId} sessionId=${pq.sessionId} qIdx=${qIdx} indices=${answer.indices}`
    );

    try {
      const ready = await this.injector.waitForTui(pq.paneId, 5000);
      logger.debug(`[AskQ:inject] TUI ready=${ready} for target=${pq.paneId}`);
      if (!ready) throw new Error("TUI not ready");

      if (q.multiSelect) {
        await this.injector.injectMultiSelect(pq.paneId, q, answer, pq.agent);
      } else {
        await this.injector.injectSingleSelect(pq.paneId, q, answer, pq.agent);
      }
    } catch (err) {
      logger.error({ err }, t("askQuestion.injectionFailed"));
      const chat = this.chatId();
      if (chat) {
        await this.bot
          .sendMessage(chat, padMaxWidth(t("askQuestion.injectionFailed")))
          .catch(() => {});
      }
    }
  }

  private async advanceToNext(chatId: number, pq: PendingQuestion): Promise<void> {
    pq.currentIndex++;
    if (pq.currentIndex >= pq.questions.length) {
      logger.debug(
        `[AskQ:submit] all ${pq.questions.length} questions answered, submitting via Enter on target=${pq.paneId}`
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const ready = await this.injector.waitForTui(pq.paneId, 5000);
        if (ready) {
          this.injector.sendEnter(pq.paneId);
        }
      } catch {
        /* best-effort submit */
      }
      this.clearPending(pq.paneId);
      await this.bot.sendMessage(chatId, padMaxWidth(t("askQuestion.allAnswered"))).catch(() => {});
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.sendQuestion(chatId, pq, pq.currentIndex);
  }

  private buildSessionLine(paneId: string): string {
    const pane = this.paneRegistry?.getByPaneId(paneId);
    if (!pane) return "";
    const label = buildSessionLabel(pane.project, pane.model, paneId);
    return `*${escapeMarkdownV2(label)}*`;
  }

  private findPendingByNumericId(id: number): PendingQuestion | undefined {
    const paneId = this.pendingById.get(id);
    if (!paneId) return undefined;
    return this.pending.get(paneId);
  }

  private setPending(paneId: string, pq: PendingQuestion): void {
    this.clearPending(paneId);
    this.pending.set(paneId, pq);
    this.pendingById.set(pq.pendingId, paneId);
    const timer = setTimeout(() => this.clearPending(paneId), EXPIRE_MS);
    this.timers.set(paneId, timer);
  }

  private clearPending(paneId: string): void {
    const pq = this.pending.get(paneId);
    if (pq) this.pendingById.delete(pq.pendingId);
    this.pending.delete(paneId);
    const timer = this.timers.get(paneId);
    if (timer) clearTimeout(timer);
    this.timers.delete(paneId);
  }
}

function formatQuestionHeader(pq: PendingQuestion, qIdx: number): string {
  const n = qIdx + 1;
  const total = pq.questions.length;
  const q = pq.questions[qIdx]!;
  const title = t("askQuestion.title", { n, total });
  const header = q.header ? ` \\[${escapeMarkdownV2(q.header)}\\]` : "";
  return `*${escapeMarkdownV2(title)}*${header}`;
}

function formatOptionList(q: AskUserQuestionItem): string | null {
  const hasAnyDescription = q.options.some((o) => o.description);
  if (!hasAnyDescription) return null;

  return q.options
    .map((opt, i) => {
      const label = `*${escapeMarkdownV2(opt.label)}*`;
      const desc = opt.description ? ` — ${escapeMarkdownV2(opt.description)}` : "";
      return `${i + 1}\\. ${label}${desc}`;
    })
    .join("\n");
}
