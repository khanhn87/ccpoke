import TelegramBot from "node-telegram-bot-api";

import { t } from "../../i18n/index.js";
import { PaneState, type PaneMetadata } from "../../tmux/pane-registry.js";
import { queryPanePid } from "../../tmux/tmux-scanner.js";
import { buildSessionLabel } from "../session-label.js";
import { buildTargetCallback } from "./callback-parser.js";
import { escapeMarkdownV2 } from "./escape-markdown.js";

const STATE_EMOJI: Record<string, string> = {
  [PaneState.Idle]: "\u{1F7E2}",
  [PaneState.Busy]: "\u{1F7E1}",
  [PaneState.Unknown]: "\u26AA",
};

const MAX_KEYBOARD_ROWS = 50;
const MAX_LABEL_CHARS = 32;

export function formatPaneList(panes: PaneMetadata[]): {
  text: string;
  replyMarkup: TelegramBot.InlineKeyboardMarkup | undefined;
} {
  if (panes.length === 0) {
    return { text: t("sessions.empty"), replyMarkup: undefined };
  }

  const sorted = [...panes].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

  const rows: TelegramBot.InlineKeyboardButton[][] = [];

  for (const pane of sorted.slice(0, MAX_KEYBOARD_ROWS)) {
    const emoji = STATE_EMOJI[pane.state] ?? "\u26AA";
    const label = buildSessionLabel(pane.project, pane.model, pane.paneId, MAX_LABEL_CHARS);
    const panePid = queryPanePid(pane.paneId) ?? "0";
    const callbackData = buildTargetCallback("session", pane.paneId, panePid);

    rows.push([{ text: `${emoji} ${label}`, callback_data: callbackData }]);
  }

  return {
    text: `*${escapeMarkdownV2(t("sessions.title"))}*`,
    replyMarkup: { inline_keyboard: rows },
  };
}
