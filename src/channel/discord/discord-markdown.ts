import { EmbedBuilder } from "discord.js";

import { buildSessionLabel, shortenModel } from "../session-label.js";
import type { NotificationData } from "../types.js";

const DISCORD_EMBED_COLOR = 0x00b894;

export function formatNotificationEmbed(
  data: NotificationData,
  responseUrl?: string
): EmbedBuilder {
  const label = buildSessionLabel(data.projectName, "", data.paneId ?? "");
  const embed = new EmbedBuilder().setColor(DISCORD_EMBED_COLOR).setTitle(label).setTimestamp();

  const short = shortenModel(data.model);
  const desc = short ? `🐾 ${data.agentDisplayName}\n🧠 ${short}` : `🐾 ${data.agentDisplayName}`;
  embed.setDescription(desc);

  if (data.responseSummary) {
    const snippet =
      data.responseSummary.length > 500
        ? data.responseSummary.slice(0, 497) + "..."
        : data.responseSummary;
    embed.addFields({ name: "", value: snippet });
  }

  if (responseUrl) {
    embed.setURL(responseUrl);
  }

  return embed;
}
