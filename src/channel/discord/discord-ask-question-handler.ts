import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type DMChannel,
  type Message,
  type TextChannel,
} from "discord.js";

import type { AskUserQuestionEvent, AskUserQuestionItem } from "../../agent/agent-handler.js";
import type { PaneRegistry } from "../../tmux/pane-registry.js";
import type { TmuxBridge } from "../../tmux/tmux-bridge.js";
import { logger } from "../../utils/log.js";
import { buildSessionLabel } from "../session-label.js";
import { truncate } from "../summarize-tool.js";
import {
  AskQuestionTuiInjector,
  type InjectionAnswer,
} from "../telegram/ask-question-tui-injector.js";

interface PendingQuestion {
  pendingId: number;
  paneId: string;
  questions: AskUserQuestionItem[];
  currentIndex: number;
  answers: Map<number, InjectionAnswer>;
  messageIds: Map<number, string>;
  multiSelectState: Map<number, Set<number>>;
  createdAt: number;
}

const EXPIRE_MS = 10 * 60 * 1000;
const MAX_PENDING = 50;
const EMBED_COLOR = 0x6c5ce7;

export class DiscordAskQuestionHandler {
  private pending = new Map<string, PendingQuestion>();
  private pendingById = new Map<number, string>();
  private nextPendingId = 1;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private injector: AskQuestionTuiInjector;

  constructor(
    private getChannel: () => DMChannel | TextChannel | null,
    tmuxBridge: TmuxBridge,
    private paneRegistry: PaneRegistry | null
  ) {
    this.injector = new AskQuestionTuiInjector(tmuxBridge);
  }

  async forwardQuestion(event: AskUserQuestionEvent): Promise<void> {
    const channel = this.getChannel();
    if (!channel || !event.paneId || event.questions.length === 0) return;

    logger.info(`[Discord:AskQ] paneId=${event.paneId} questions=${event.questions.length}`);

    if (this.pending.size >= MAX_PENDING && !this.pending.has(event.paneId)) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.clearPending(oldest[0]);
    }

    const pendingId = this.nextPendingId++;
    const pq: PendingQuestion = {
      pendingId,
      paneId: event.paneId,
      questions: event.questions,
      currentIndex: 0,
      answers: new Map(),
      messageIds: new Map(),
      multiSelectState: new Map(),
      createdAt: Date.now(),
    };

    this.setPending(event.paneId, pq);
    await this.sendQuestion(channel, pq, 0);
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    if (parts.length < 4) return;

    const prefix = parts[0];
    const pendingId = parseInt(parts[1]!, 10);
    const qIdx = parseInt(parts[2]!, 10);
    const optPart = parts[3]!;

    const pq = this.findPendingByNumericId(pendingId);
    if (!pq) {
      await interaction.reply({ content: "This question has expired.", ephemeral: true });
      return;
    }

    if (prefix === "aq") {
      await this.handleSingleSelect(interaction, pq, qIdx, optPart);
    } else if (prefix === "am") {
      await this.handleMultiSelect(interaction, pq, qIdx, optPart);
    }
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.pendingById.clear();
  }

  private async sendQuestion(
    channel: DMChannel | TextChannel,
    pq: PendingQuestion,
    qIdx: number
  ): Promise<void> {
    const q = pq.questions[qIdx];
    if (!q) return;

    const n = qIdx + 1;
    const total = pq.questions.length;
    const sessionLine = this.resolveSessionLabel(pq.paneId);
    const titleParts = [sessionLine, `Question ${n}/${total}${q.header ? ` [${q.header}]` : ""}`]
      .filter(Boolean)
      .join(" — ");
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(titleParts)
      .setDescription(q.question)
      .setTimestamp();

    if (q.options.some((o) => o.description)) {
      const optList = q.options
        .map((o, i) => `**${i + 1}.** ${o.label}${o.description ? ` — ${o.description}` : ""}`)
        .join("\n");
      embed.addFields({ name: "Options", value: optList });
    }

    const rows = q.multiSelect
      ? buildMultiSelectRows(pq.pendingId, qIdx, q, new Set())
      : buildSingleSelectRows(pq.pendingId, qIdx, q);

    const msg = await channel
      .send({ embeds: [embed], components: rows })
      .catch(() => null as Message | null);

    if (msg) {
      pq.messageIds.set(qIdx, msg.id);
      if (q.multiSelect) pq.multiSelectState.set(qIdx, new Set());
    }
  }

  private async handleSingleSelect(
    interaction: ButtonInteraction,
    pq: PendingQuestion,
    qIdx: number,
    optPart: string
  ): Promise<void> {
    const optIdx = parseInt(optPart, 10);
    const q = pq.questions[qIdx];
    if (!q || optIdx < 0 || optIdx >= q.options.length) return;

    pq.answers.set(qIdx, { indices: [optIdx] });

    const selected = q.options[optIdx]!.label;
    const updatedEmbed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`Question ${qIdx + 1}/${pq.questions.length}`)
      .setDescription(`Selected: **${selected}**`)
      .setTimestamp();

    await interaction.update({ embeds: [updatedEmbed], components: [] }).catch(() => {});

    await this.injectAnswer(pq, qIdx);
    await this.advanceToNext(pq);
  }

  private async handleMultiSelect(
    interaction: ButtonInteraction,
    pq: PendingQuestion,
    qIdx: number,
    optPart: string
  ): Promise<void> {
    const q = pq.questions[qIdx];
    if (!q) return;

    if (optPart === "c") {
      const selected = pq.multiSelectState.get(qIdx) ?? new Set();
      pq.answers.set(qIdx, { indices: [...selected].sort((a, b) => a - b) });

      const labels = [...selected]
        .sort((a, b) => a - b)
        .map((i) => q.options[i]?.label ?? "")
        .filter(Boolean);

      const updatedEmbed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`Question ${qIdx + 1}/${pq.questions.length}`)
        .setDescription(`Selected: **${labels.join(", ") || "none"}**`)
        .setTimestamp();

      await interaction.update({ embeds: [updatedEmbed], components: [] }).catch(() => {});

      await this.injectAnswer(pq, qIdx);
      await this.advanceToNext(pq);
      return;
    }

    const optIdx = parseInt(optPart, 10);
    if (optIdx < 0 || optIdx >= q.options.length) return;

    const toggleSet = pq.multiSelectState.get(qIdx) ?? new Set<number>();
    if (toggleSet.has(optIdx)) {
      toggleSet.delete(optIdx);
    } else {
      toggleSet.add(optIdx);
    }
    pq.multiSelectState.set(qIdx, toggleSet);

    const rows = buildMultiSelectRows(pq.pendingId, qIdx, q, toggleSet);
    await interaction.update({ components: rows }).catch(() => {});
  }

  private async injectAnswer(pq: PendingQuestion, qIdx: number): Promise<void> {
    const q = pq.questions[qIdx];
    const answer = pq.answers.get(qIdx);
    if (!q || !answer) return;

    logger.debug(
      `[Discord:AskQ:inject] paneId=${pq.paneId} qIdx=${qIdx} indices=${answer.indices}`
    );

    try {
      const ready = await this.injector.waitForTui(pq.paneId, 5000);
      if (!ready) throw new Error("TUI not ready");

      if (q.multiSelect) {
        await this.injector.injectMultiSelect(pq.paneId, q, answer);
      } else {
        await this.injector.injectSingleSelect(pq.paneId, q, answer);
      }
    } catch (err) {
      logger.error({ err }, "[Discord:AskQ] injection failed");
    }
  }

  private async advanceToNext(pq: PendingQuestion): Promise<void> {
    pq.currentIndex++;
    if (pq.currentIndex >= pq.questions.length) {
      logger.debug(`[Discord:AskQ:submit] all ${pq.questions.length} questions answered`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const ready = await this.injector.waitForTui(pq.paneId, 5000);
        if (ready) this.injector.sendEnter(pq.paneId);
      } catch {
        /* best-effort */
      }
      this.clearPending(pq.paneId);

      const channel = this.getChannel();
      if (channel) {
        await channel.send("All questions answered.").catch(() => {});
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    const channel = this.getChannel();
    if (channel) await this.sendQuestion(channel, pq, pq.currentIndex);
  }

  private resolveSessionLabel(paneId: string): string {
    const pane = this.paneRegistry?.getByPaneId(paneId);
    if (!pane) return "";
    return buildSessionLabel(pane.project, pane.model, paneId);
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

const MAX_ACTION_ROWS = 5;

function buildSingleSelectRows(
  pendingId: number,
  qIdx: number,
  q: AskUserQuestionItem
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const maxOptions = MAX_ACTION_ROWS * 5;
  const optCount = Math.min(q.options.length, maxOptions);
  for (let i = 0; i < optCount; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let j = i; j < Math.min(i + 5, optCount); j++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`aq:${pendingId}:${qIdx}:${j}`)
          .setLabel(truncate(q.options[j]!.label, 80))
          .setStyle(ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildMultiSelectRows(
  pendingId: number,
  qIdx: number,
  q: AskUserQuestionItem,
  selected: Set<number>
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const maxOptionRows = MAX_ACTION_ROWS - 1;
  const maxOptions = maxOptionRows * 5;
  const optCount = Math.min(q.options.length, maxOptions);
  for (let i = 0; i < optCount; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (let j = i; j < Math.min(i + 5, optCount); j++) {
      const isSelected = selected.has(j);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`am:${pendingId}:${qIdx}:${j}`)
          .setLabel(`${isSelected ? "✓ " : ""}${truncate(q.options[j]!.label, 77)}`)
          .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`am:${pendingId}:${qIdx}:c`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Primary)
  );
  rows.push(confirmRow);
  return rows;
}
