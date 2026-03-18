import * as p from "@clack/prompts";
import TelegramBot from "node-telegram-bot-api";
import qrcode from "qrcode-terminal";

import { ConfigManager } from "../config-manager.js";
import { t } from "../i18n/index.js";

const SETUP_WAIT_TIMEOUT_MS = 120_000;

export async function promptToken(
  existing: { telegram_bot_token?: string } | null
): Promise<string> {
  const result = await p.text({
    message: t("setup.tokenMessage"),
    placeholder: t("setup.tokenPlaceholder"),
    initialValue: existing?.telegram_bot_token ?? "",
    validate(value) {
      if (!value || !value.trim()) return t("setup.tokenRequired");
      if (!value.includes(":")) return t("setup.tokenInvalidFormat");
    },
  });

  if (p.isCancel(result)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  return result.trim();
}

export async function verifyToken(token: string): Promise<string> {
  const spinner = p.spinner();
  spinner.start(t("setup.verifyingToken"));

  try {
    const bot = new TelegramBot(token);
    const me = await bot.getMe();

    spinner.stop(t("setup.botVerified", { username: me.username ?? "unknown" }));
    return me.username ?? "unknown";
  } catch {
    spinner.stop(t("setup.tokenVerifyFailed"));
    throw new Error(t("setup.tokenVerifyFailed"));
  }
}

export async function waitForUserStart(token: string, botUsername: string): Promise<number> {
  const deepLink = `https://t.me/${botUsername}?start=setup`;

  p.log.step(t("setup.scanOrClick"));

  const qrString = await new Promise<string>((resolve) => {
    qrcode.generate(deepLink, { small: true }, (code: string) => {
      resolve(code);
    });
  });

  const indentedQr = qrString
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `│    ${line}`)
    .join("\n");

  process.stdout.write(`${indentedQr}\n│\n│    ${deepLink}\n`);

  p.log.step(t("setup.waitingForStart"));

  const bot = new TelegramBot(token, { polling: true });

  try {
    const userId = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        bot.stopPolling();
        reject(new Error(t("setup.waitingTimeout", { seconds: SETUP_WAIT_TIMEOUT_MS / 1000 })));
      }, SETUP_WAIT_TIMEOUT_MS);

      bot.onText(/\/start(?:\s|$)/, (msg) => {
        clearTimeout(timeout);

        bot
          .sendMessage(msg.chat.id, t("setup.userDetected", { userId: msg.from!.id }))
          .finally(() => {
            bot.stopPolling();
            resolve(msg.from!.id);
          });
      });
    });

    p.log.success(t("setup.userDetected", { userId }));
    return userId;
  } catch (err) {
    bot.stopPolling();
    throw err;
  }
}

export function registerChatId(userId: number): void {
  const state = ConfigManager.loadChatState();

  if (state.chat_id === userId) {
    return;
  }

  state.chat_id = userId;
  ConfigManager.saveChatState(state);
  p.log.success(t("setup.chatIdRegistered"));
}
