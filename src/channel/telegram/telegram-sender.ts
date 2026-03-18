import TelegramBot from "node-telegram-bot-api";

import { t } from "../../i18n/index.js";
import { logger } from "../../utils/log.js";
import { buildTargetCallback } from "./callback-parser.js";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const PAGINATION_FOOTER_RESERVE = 30;
const SPLIT_LOOKBACK_RANGE = 200;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;
const BRAILLE_BLANK = "\u2800";
const MAX_WIDTH_PAD = `\n${BRAILLE_BLANK.repeat(40)}`;

export function padMaxWidth(text: string): string {
  return `${text}${MAX_WIDTH_PAD}`;
}

export async function sendTelegramMessage(
  bot: TelegramBot,
  chatId: number,
  text: string,
  responseUrl?: string,
  paneId?: string,
  panePid?: string
): Promise<void> {
  const pages = splitMessage(
    text,
    TELEGRAM_MAX_MESSAGE_LENGTH - PAGINATION_FOOTER_RESERVE - MAX_WIDTH_PAD.length
  );

  for (let i = 0; i < pages.length; i++) {
    let content = pages[i]!;
    if (pages.length > 1) {
      content = `${content}\n\n_\\[${i + 1}/${pages.length}\\]_`;
    }
    content += MAX_WIDTH_PAD;

    const isLastPage = i === pages.length - 1;
    const opts: TelegramBot.SendMessageOptions = { parse_mode: "MarkdownV2" };

    if (isLastPage) {
      const markup = buildResponseReplyMarkup(responseUrl, paneId, panePid);
      if (markup) opts.reply_markup = markup;
    }

    const rawContent = pages[i]! + MAX_WIDTH_PAD;
    await sendWithRetry(
      bot,
      chatId,
      content,
      rawContent,
      opts,
      isLastPage,
      responseUrl,
      paneId,
      panePid
    );
  }
}

async function sendWithRetry(
  bot: TelegramBot,
  chatId: number,
  content: string,
  rawContent: string,
  opts: TelegramBot.SendMessageOptions,
  isLastPage: boolean,
  responseUrl?: string,
  paneId?: string,
  panePid?: string
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt === 0) {
        await bot.sendMessage(chatId, content, opts);
      } else if (attempt === 1) {
        const fallbackOpts: TelegramBot.SendMessageOptions = {};
        if (isLastPage) {
          const markup = buildResponseReplyMarkup(responseUrl, paneId, panePid);
          if (markup) fallbackOpts.reply_markup = markup;
        }
        await bot.sendMessage(chatId, rawContent, fallbackOpts);
      } else {
        await bot.sendMessage(chatId, rawContent);
      }
      return;
    } catch (error: unknown) {
      const isLastAttempt = attempt === MAX_RETRIES - 1;
      const tgError = error as {
        response?: { statusCode?: number; parameters?: { retry_after?: number } };
      };

      if (tgError.response?.statusCode === 429) {
        const retryAfter =
          tgError.response?.parameters?.retry_after ?? RETRY_DELAYS_MS[attempt]! / 1000;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
      } else if (!isLastAttempt) {
        logger.error(
          { err: error },
          attempt === 0 ? t("bot.sendFailed") : t("bot.sendFallbackFailed")
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]!));
      } else {
        logger.error({ err: error }, t("bot.sendFallbackFailed"));
      }
    }
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const pages: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      pages.push(remaining);
      break;
    }

    const splitAt = findSplitPoint(remaining, maxLen);
    pages.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return pages;
}

function findSplitPoint(text: string, maxLen: number): number {
  const searchStart = Math.max(0, maxLen - SPLIT_LOOKBACK_RANGE);

  for (let i = maxLen; i > searchStart; i--) {
    if (text[i] === "\n" && text[i - 1] === "\n") return i + 1;
  }

  for (let i = maxLen; i > searchStart; i--) {
    if (text[i] === "\n" && text[i - 1] !== "\\") return i + 1;
  }

  for (let i = maxLen; i > searchStart; i--) {
    if (text[i] === " " && text[i - 1] !== "\\") return i + 1;
  }

  return maxLen;
}

function buildResponseReplyMarkup(
  responseUrl?: string,
  paneId?: string,
  panePid?: string
): TelegramBot.InlineKeyboardMarkup | undefined {
  const buttons: TelegramBot.InlineKeyboardButton[] = [];

  if (responseUrl) {
    const viewText = `📖 ${t("bot.viewDetails")}`;
    const viewButton = responseUrl.startsWith("https://")
      ? { text: viewText, web_app: { url: responseUrl } }
      : { text: viewText, url: responseUrl };
    buttons.push(viewButton);
  }

  if (paneId && panePid) {
    buttons.push({
      text: "💬 Chat",
      callback_data: buildTargetCallback("chat", paneId, panePid),
    });
  }

  if (buttons.length === 0) return undefined;
  return { inline_keyboard: [buttons] };
}
