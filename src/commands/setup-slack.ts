import * as p from "@clack/prompts";
import { WebClient } from "@slack/web-api";

import type { Config } from "../config-manager.js";
import { t } from "../i18n/index.js";

export async function promptSlackCredentials(
  config: Config,
  existing: Config | null
): Promise<void> {
  const botToken = await p.text({
    message: t("setup.slackTokenMessage"),
    placeholder: t("setup.slackTokenPlaceholder"),
    initialValue: existing?.slack_bot_token ?? "",
    validate(value) {
      if (!value || !value.trim()) return t("setup.tokenRequired");
      if (!value.startsWith("xoxb-")) return t("setup.slackTokenInvalidFormat");
    },
  });

  if (p.isCancel(botToken)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  const token = (botToken as string).trim();
  config.slack_bot_token = token;

  const tokenUnchanged = existing !== null && token === existing.slack_bot_token;

  if (tokenUnchanged && existing?.slack_channel_id) {
    config.slack_channel_id = existing.slack_channel_id;
    p.log.success(t("setup.slackTokenUnchanged"));
    return;
  }

  const verified = await verifySlackToken(token);
  if (!verified) throw new Error(t("setup.slackTokenVerifyFailed"));

  config.slack_channel_id = await pickSlackChannel(token, existing);
  await verifySlackChannelMembership(token, config.slack_channel_id);
}

async function verifySlackToken(token: string): Promise<boolean> {
  const spinner = p.spinner();
  spinner.start(t("setup.slackVerifyingToken"));

  try {
    const client = new WebClient(token);
    const result = await client.auth.test();
    spinner.stop(
      t("setup.slackBotVerified", { name: (result.bot_id as string | undefined) ?? "bot" })
    );
    return true;
  } catch {
    spinner.stop(t("setup.slackTokenVerifyFailed"));
    return false;
  }
}

async function pickSlackChannel(token: string, existing: Config | null): Promise<string> {
  const client = new WebClient(token);

  let channels: { id: string; name: string }[] = [];
  try {
    const result = await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 100,
    });
    channels =
      result.channels
        ?.filter((c) => c.is_member && c.id && c.name)
        .map((c) => ({ id: c.id!, name: c.name! })) ?? [];
  } catch {
    // scope missing or error — fallback to manual
  }

  if (channels.length > 0) {
    const selected = await p.select({
      message: t("setup.slackSelectChannel"),
      initialValue: existing?.slack_channel_id ?? channels[0]!.id,
      options: channels.map((c) => ({ value: c.id, label: `#${c.name}` })),
    });

    if (p.isCancel(selected)) {
      p.cancel(t("setup.cancelled"));
      process.exit(0);
    }

    return selected;
  }

  const channelId = await p.text({
    message: t("setup.slackChannelIdMessage"),
    placeholder: t("setup.slackChannelIdPlaceholder"),
    initialValue: existing?.slack_channel_id ?? "",
    validate(value) {
      if (!value || !value.trim()) return t("setup.slackChannelIdRequired");
    },
  });

  if (p.isCancel(channelId)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  return (channelId as string).trim();
}

async function verifySlackChannelMembership(token: string, channelId: string): Promise<void> {
  const spinner = p.spinner();
  spinner.start(t("setup.slackVerifyingChannel"));

  const client = new WebClient(token);
  try {
    const info = await client.conversations.info({ channel: channelId });
    if (info.channel?.is_member) {
      spinner.stop(t("setup.slackChannelVerified"));
      return;
    }
  } catch {
    // fall through to bot name lookup + warning
  }

  let botName = "your-bot";
  try {
    const auth = await client.auth.test();
    if (auth.user) botName = auth.user as string;
  } catch {
    // ignore
  }

  spinner.stop(t("setup.slackChannelNotMember", { name: botName }));
}
