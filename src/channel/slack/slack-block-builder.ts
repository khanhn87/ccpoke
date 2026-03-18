import type { KnownBlock } from "@slack/web-api";

import { extractProseSnippet } from "../../utils/markdown.js";
import { buildSessionLabel, shortenModel } from "../session-label.js";
import type { NotificationData } from "../types.js";

const RESPONSE_TEXT_MAX = 2800;

export function buildNotificationBlocks(
  data: NotificationData,
  responseUrl?: string
): KnownBlock[] {
  const blocks: KnownBlock[] = [];
  const label = buildSessionLabel(data.projectName, "", data.paneId ?? "");

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: label, emoji: true },
  });

  const short = shortenModel(data.model);
  const fields: { type: "mrkdwn"; text: string }[] = [
    { type: "mrkdwn", text: `*Agent*\n${data.agentDisplayName}` },
  ];
  if (short) {
    fields.push({ type: "mrkdwn", text: `*Model*\n${short}` });
  }

  blocks.push({ type: "section", fields });

  const summaryText = data.responseSummary
    ? extractProseSnippet(data.responseSummary, RESPONSE_TEXT_MAX)
    : "Task done";

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: summaryText },
  });

  if (responseUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Details", emoji: true },
          url: responseUrl,
          action_id: "view_details",
        },
      ],
    });
  }

  return blocks;
}
