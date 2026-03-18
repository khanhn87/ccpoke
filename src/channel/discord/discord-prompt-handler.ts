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

import type { NotificationEvent } from "../../agent/agent-handler.js";
import type { AgentRegistry } from "../../agent/agent-registry.js";
import { PaneState, type PaneRegistry } from "../../tmux/pane-registry.js";
import type { TmuxBridge } from "../../tmux/tmux-bridge.js";
import { logger } from "../../utils/log.js";

interface PendingPrompt {
  paneId: string;
  createdAt: number;
}

const PROMPT_EXPIRE_MS = 10 * 60 * 1000;
const MAX_PENDING = 100;
const MAX_RESPONSE_LENGTH = 10_000;
const EMBED_COLOR = 0x74b9ff;

export class DiscordPromptHandler {
  private pending = new Map<string, PendingPrompt>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  onElicitationSent?: (messageId: string, paneId: string, project: string) => void;

  constructor(
    private getChannel: () => DMChannel | TextChannel | null,
    private paneRegistry: PaneRegistry,
    private tmuxBridge: TmuxBridge,
    private registry: AgentRegistry
  ) {}

  async forwardPrompt(event: NotificationEvent): Promise<void> {
    const channel = this.getChannel();
    if (!channel) return;

    if (event.notificationType === "elicitation_dialog") {
      await this.sendElicitationPrompt(channel, event);
    }
  }

  injectElicitationResponse(paneId: string, text: string): boolean {
    const pane = this.paneRegistry.getByPaneId(paneId);
    if (!pane) return false;
    if (!this.pending.has(paneId)) return false;

    logger.info(`[Discord:Prompt:inject] paneId=${paneId} text="${text.slice(0, 50)}"`);

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

  async handleElicitReplyButton(interaction: ButtonInteraction, paneId: string): Promise<void> {
    const pane = this.paneRegistry.getByPaneId(paneId);
    if (!pane) {
      await interaction.reply({ content: "Session expired.", ephemeral: true });
      return;
    }

    await interaction.reply({
      content: `Reply for **${pane.project}**: send your message as a DM`,
      ephemeral: true,
    });
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  private async sendElicitationPrompt(
    channel: DMChannel | TextChannel,
    event: NotificationEvent
  ): Promise<void> {
    const title = event.title ? `❓ ${event.title}` : "❓ Input Required";
    const paneId = event.paneId ?? "";
    const project = paneId ? this.paneRegistry.getByPaneId(paneId)?.project : undefined;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(title)
      .setDescription(event.message)
      .setTimestamp();

    if (project) {
      embed.setFooter({ text: project });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`elicit:${paneId}`)
        .setLabel("Reply")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("💬")
    );

    const sent = await channel
      .send({ embeds: [embed], components: [row] })
      .catch(() => null as Message | null);

    if (sent) {
      this.setPending(paneId);
      this.onElicitationSent?.(sent.id, paneId, project ?? "");
      logger.debug(`[Discord:Prompt] elicitation sent msgId=${sent.id} paneId=${paneId}`);
    }
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
