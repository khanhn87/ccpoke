import * as p from "@clack/prompts";
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import qrcode from "qrcode-terminal";

import type { Config } from "../config-manager.js";
import { t } from "../i18n/index.js";

const SETUP_WAIT_TIMEOUT_MS = 120_000;

export async function promptDiscordCredentials(
  config: Config,
  existing: Config | null
): Promise<void> {
  const botToken = await p.text({
    message: t("setup.discordTokenMessage"),
    placeholder: t("setup.discordTokenPlaceholder"),
    initialValue: existing?.discord_bot_token ?? "",
    validate(value) {
      if (!value || !value.trim()) return t("setup.tokenRequired");
    },
  });

  if (p.isCancel(botToken)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  const token = (botToken as string).trim();
  config.discord_bot_token = token;

  const tokenUnchanged = existing !== null && token === existing.discord_bot_token;

  if (tokenUnchanged && existing?.discord_user_id) {
    config.discord_user_id = existing.discord_user_id;
    p.log.success(t("setup.discordTokenUnchanged"));
    return;
  }

  const botInfo = await verifyDiscordToken(token);
  config.discord_user_id = await waitForDiscordDM(token, botInfo.id);
}

async function verifyDiscordToken(token: string): Promise<{ id: string; username: string }> {
  const spinner = p.spinner();
  spinner.start(t("setup.discordVerifyingToken"));

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15_000);
      client.once(Events.ClientReady, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await client.login(token);
    await ready;

    const id = client.user!.id;
    const username = client.user!.tag ?? client.user!.username ?? "unknown";

    spinner.stop(t("setup.discordBotVerified", { username }));
    client.destroy();
    return { id, username };
  } catch {
    client.destroy();
    spinner.stop(t("setup.discordTokenVerifyFailed"));
    throw new Error(t("setup.discordTokenVerifyFailed"));
  }
}

async function waitForDiscordDM(token: string, botId: string): Promise<string> {
  const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot%20applications.commands&permissions=18432`;

  p.log.step(t("setup.discordScanOrClick"));

  const qrString = await new Promise<string>((resolve) => {
    qrcode.generate(inviteUrl, { small: true }, (code: string) => {
      resolve(code);
    });
  });

  const indentedQr = qrString
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `│    ${line}`)
    .join("\n");

  process.stdout.write(`${indentedQr}\n│\n│    ${inviteUrl}\n`);

  p.log.step(t("setup.discordWaitingForDM"));

  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.Guilds],
    partials: [Partials.Channel, Partials.Message],
  });

  try {
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 15_000);
      client.once(Events.ClientReady, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await client.login(token);
    await ready;

    const userId = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(t("setup.discordWaitingTimeout", { seconds: SETUP_WAIT_TIMEOUT_MS / 1000 }))
        );
      }, SETUP_WAIT_TIMEOUT_MS);

      client.on(Events.GuildCreate, async (guild) => {
        try {
          const owner = await guild.fetchOwner();
          const dm = await owner.createDM();
          await dm.send(t("setup.discordUserDetected", { userId: owner.id }));
          clearTimeout(timeout);
          resolve(owner.id);
        } catch {
          // guild owner DM failed — fall back to waiting for manual DM
        }
      });

      client.on("messageCreate", async (msg) => {
        if (msg.author.bot) return;
        if (!msg.channel.isDMBased()) return;

        clearTimeout(timeout);
        await msg.reply(t("setup.discordUserDetected", { userId: msg.author.id })).catch(() => {});
        resolve(msg.author.id);
      });
    });

    p.log.success(t("setup.discordUserDetected", { userId }));
    client.destroy();
    return userId;
  } catch (err) {
    client.destroy();
    throw err;
  }
}
