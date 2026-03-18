import * as p from "@clack/prompts";

import { createDefaultRegistry } from "../agent/agent-registry.js";
import { AgentName } from "../agent/types.js";
import { ConfigManager, type Config } from "../config-manager.js";
import { Locale, LOCALE_LABELS, setLocale, SUPPORTED_LOCALES, t } from "../i18n/index.js";
import type { TunnelType } from "../tunnel/types.js";
import { ChannelName, DEFAULT_HOOK_PORT } from "../utils/constants.js";
import { detectCliPrefix } from "../utils/install-detection.js";
import { installShellCompletion } from "../utils/shell-completion.js";
import { saveConfig, syncAgentHooks } from "./setup-agent-hooks.js";
import { promptDiscordCredentials } from "./setup-discord.js";
import { promptProjectSetup } from "./setup-projects.js";
import { promptSlackCredentials } from "./setup-slack.js";
import { promptToken, registerChatId, verifyToken, waitForUserStart } from "./setup-telegram.js";
import { promptTmuxSetup } from "./setup-tmux.js";
import { promptTunnelSetup } from "./setup-tunnel.js";

export { promptDiscordCredentials } from "./setup-discord.js";
export { promptSlackCredentials } from "./setup-slack.js";
export { promptToken, verifyToken, waitForUserStart } from "./setup-telegram.js";

export interface SetupOptions {
  autoStart?: boolean;
}

export async function runSetup(options: SetupOptions = {}): Promise<Config> {
  p.intro(t("setup.intro"));

  let existing: Config | null = null;
  try {
    existing = ConfigManager.load();
  } catch {
    // first-time setup
  }

  const locale = await promptLanguage(existing);
  setLocale(locale);

  const channel = await promptChannel(existing);
  const { tunnelType, ngrokAuthtoken } = await promptTunnelSetup(existing);

  let token = "";
  let userId = 0;

  if (channel === ChannelName.Telegram) {
    token = await promptToken(existing);
    const tokenUnchanged = existing !== null && token === existing.telegram_bot_token;

    if (tokenUnchanged) {
      userId = existing!.user_id;
      p.log.success(t("setup.tokenUnchanged"));
    } else {
      const botUsername = await verifyToken(token);
      userId = await waitForUserStart(token, botUsername);
    }
  }

  const config = buildConfig(
    channel,
    token,
    userId,
    existing,
    locale,
    [],
    tunnelType,
    ngrokAuthtoken
  );

  if (channel === ChannelName.Discord) {
    await promptDiscordCredentials(config, existing);
  } else if (channel === ChannelName.Slack) {
    await promptSlackCredentials(config, existing);
  }

  const previousAgents = existing?.agents ?? [];
  const selectedAgents = await promptAgents(previousAgents);
  config.agents = selectedAgents;

  saveConfig(config);
  syncAgentHooks(config, previousAgents);
  if (channel === ChannelName.Telegram) {
    registerChatId(userId);
  }
  await promptTmuxSetup();
  await promptProjectSetup(config);

  installShellCompletion();

  if (options.autoStart) {
    p.outro(t("setup.completeAutoStart"));
  } else {
    const startCommand = detectCliPrefix();
    p.outro(t("setup.complete", { command: startCommand }));
  }

  return config;
}

async function promptChannel(existing: Config | null): Promise<string> {
  const result = await p.select({
    message: t("setup.channelMessage"),
    initialValue: existing?.channel ?? ChannelName.Telegram,
    options: [
      { value: ChannelName.Telegram, label: "Telegram" },
      { value: ChannelName.Discord, label: "Discord" },
      { value: ChannelName.Slack, label: "Slack" },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  return result;
}

async function promptLanguage(existing: Config | null): Promise<Locale> {
  const result = await p.select({
    message: t("setup.languageMessage"),
    initialValue: existing?.locale ?? Locale.EN,
    options: SUPPORTED_LOCALES.map((loc) => ({
      value: loc,
      label: LOCALE_LABELS[loc],
    })),
  });

  if (p.isCancel(result)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  return result;
}

async function promptAgents(previousAgents: string[]): Promise<string[]> {
  const registry = createDefaultRegistry();
  const providers = registry.all();

  const detectedNames = new Set(providers.filter((p) => p.detect()).map((p) => p.name));

  const initialValues =
    previousAgents.length > 0
      ? previousAgents.filter((a) => detectedNames.has(a as AgentName))
      : detectedNames.has(AgentName.ClaudeCode)
        ? [AgentName.ClaudeCode]
        : [];

  const options = providers
    .filter((provider) => detectedNames.has(provider.name))
    .map((provider) => ({
      value: provider.name,
      label: provider.displayName,
    }));

  if (options.length === 0) {
    p.log.warn(t("setup.agentNotInstalled", { agent: "any agent" }));
    return [];
  }

  const result = await p.multiselect({
    message: t("setup.selectAgents"),
    options,
    initialValues,
    required: true,
  });

  if (p.isCancel(result)) {
    p.cancel(t("setup.cancelled"));
    process.exit(0);
  }

  return result as string[];
}

function buildConfig(
  channel: string,
  token: string,
  userId: number,
  existing: Config | null,
  locale: Locale,
  agents: string[],
  tunnel: TunnelType,
  ngrokAuthtoken?: string
): Config {
  const cfg: Config = {
    channel,
    telegram_bot_token: token || existing?.telegram_bot_token || "",
    user_id: userId || existing?.user_id || 0,
    hook_port: existing?.hook_port || DEFAULT_HOOK_PORT,
    hook_secret: existing?.hook_secret || ConfigManager.generateSecret(),
    tunnel,
    locale,
    agents,
    projects: existing?.projects || [],
  };
  if (ngrokAuthtoken) cfg.ngrok_authtoken = ngrokAuthtoken;
  return cfg;
}
