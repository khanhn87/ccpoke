import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type DMChannel,
  type TextChannel,
} from "discord.js";

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

interface PendingPermission {
  pendingId: number;
  paneId: string;
  toolName: string;
  toolSummary: string;
  planLabels?: string[];
  createdAt: number;
}

const EXPIRE_MS = 10 * 60 * 1000;
const MAX_PENDING = 50;
const EMBED_COLOR_WARN = 0xfdcb6e;
const EMBED_COLOR_ALLOW = 0x00b894;
const EMBED_COLOR_DENY = 0xd63031;

export class DiscordPermissionHandler {
  private pending = new Map<number, PendingPermission>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextPendingId = 1;
  private injector: PermissionTuiInjector;

  constructor(
    private getChannel: () => DMChannel | TextChannel | null,
    private paneRegistry: PaneRegistry,
    tmuxBridge: TmuxBridge
  ) {
    this.injector = new PermissionTuiInjector(tmuxBridge);
  }

  async forwardPermission(event: PermissionRequestEvent): Promise<void> {
    const channel = this.getChannel();
    if (!channel || !event.paneId) return;

    logger.info(`[Discord:PermReq] paneId=${event.paneId} tool=${event.toolName}`);

    if (this.pending.size >= MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.clearPending(oldest[0]);
    }

    const pendingId = this.nextPendingId++;
    const toolSummary = summarizeTool(event.toolName, event.toolInput);
    const pane = this.paneRegistry.getByPaneId(event.paneId);
    const projectName = pane?.project ?? "unknown";
    const agentName = AGENT_DISPLAY_NAMES[(pane?.agent as AgentName) ?? AgentName.ClaudeCode];

    const planLabels = isExitPlanMode(event.toolName)
      ? this.injector.extractPlanOptions(event.paneId)
      : undefined;

    const pp: PendingPermission = {
      pendingId,
      paneId: event.paneId,
      toolName: event.toolName,
      toolSummary,
      planLabels,
      createdAt: Date.now(),
    };

    this.setPending(pendingId, pp);

    const label = buildSessionLabel(projectName, pane?.model ?? "", event.paneId);

    let embed: EmbedBuilder;
    if (isExitPlanMode(event.toolName)) {
      embed = new EmbedBuilder()
        .setColor(EMBED_COLOR_WARN)
        .setTitle(label)
        .setDescription(`🐾 ${agentName}\n\n${t("permissionRequest.planTitle")}`)
        .setTimestamp();
    } else {
      embed = new EmbedBuilder()
        .setColor(EMBED_COLOR_WARN)
        .setTitle("⚠️ Permission Request")
        .setDescription(`**${label}**`)
        .addFields(
          { name: "🔧 Tool", value: event.toolName, inline: true },
          { name: "Input", value: `\`${toolSummary}\`` }
        )
        .setTimestamp();
    }

    const row = planLabels
      ? this.buildPlanButtons(pendingId, planLabels)
      : this.buildStandardButtons(pendingId);

    await channel.send({ embeds: [embed], components: [row] }).catch((err: unknown) => {
      logger.error({ err }, "[Discord:PermReq] send failed");
    });
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    if (parts.length < 3) return;

    const action = parts[1]!;
    const pendingId = parseInt(parts[2]!, 10);

    const pp = this.pending.get(pendingId);
    if (!pp) {
      await interaction.reply({ content: "This permission request has expired.", ephemeral: true });
      return;
    }

    const injectionResult = parsePermissionCallback(action);

    let resultText: string;
    let embedColor: number;

    if (injectionResult.action === "plan-option") {
      const label = pp.planLabels?.[injectionResult.optionIndex!] ?? "";
      resultText = t("permissionRequest.planApproved", { option: label });
      embedColor = EMBED_COLOR_ALLOW;
    } else {
      const allow = injectionResult.action === "allow";
      resultText = allow
        ? `Allowed: **${pp.toolName}** — \`${pp.toolSummary}\``
        : `Denied: **${pp.toolName}** — \`${pp.toolSummary}\``;
      embedColor = allow ? EMBED_COLOR_ALLOW : EMBED_COLOR_DENY;
    }

    const resultEmoji = injectionResult.action === "deny" ? "❌" : "✅";

    const updatedEmbed = new EmbedBuilder()
      .setColor(embedColor)
      .setDescription(`${resultEmoji} ${resultText}`)
      .setTimestamp();

    await interaction.deferUpdate();

    try {
      await this.injector.inject(pp.paneId, injectionResult);
      logger.debug(`[Discord:PermReq] injected ${injectionResult.action} → ${pp.paneId}`);
    } catch (err) {
      logger.error({ err }, "[Discord:PermReq] injection failed");
    }

    await interaction.editReply({ embeds: [updatedEmbed], components: [] }).catch(() => {});

    this.clearPending(pendingId);
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  private buildPlanButtons(pendingId: number, labels: string[]): ActionRowBuilder<ButtonBuilder> {
    const styles = [ButtonStyle.Success, ButtonStyle.Primary, ButtonStyle.Secondary];
    const emojis = ["🔄", "⚡", "✋"];
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...labels
        .slice(0, 3)
        .map((label, i) =>
          new ButtonBuilder()
            .setCustomId(`perm:e${i}:${pendingId}`)
            .setLabel(label)
            .setStyle(styles[i]!)
            .setEmoji(emojis[i]!)
        )
    );
  }

  private buildStandardButtons(pendingId: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`perm:a:${pendingId}`)
        .setLabel("Allow")
        .setStyle(ButtonStyle.Success)
        .setEmoji("✅"),
      new ButtonBuilder()
        .setCustomId(`perm:d:${pendingId}`)
        .setLabel("Deny")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("❌")
    );
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
