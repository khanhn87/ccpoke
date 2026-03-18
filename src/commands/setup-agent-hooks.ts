import * as p from "@clack/prompts";

import { createDefaultRegistry } from "../agent/agent-registry.js";
import { ConfigManager, type Config } from "../config-manager.js";
import { HookEnvWriter } from "../hooks/hook-env-writer.js";
import { t } from "../i18n/index.js";

export function syncAgentHooks(config: Config, previousAgents: string[]): void {
  const registry = createDefaultRegistry();
  HookEnvWriter.write(config.hook_port, config.hook_secret);

  const removedAgents = previousAgents.filter((a) => !config.agents.includes(a));
  for (const agentName of removedAgents) {
    const provider = registry.resolve(agentName);
    if (!provider) continue;

    try {
      provider.uninstallHook();
      p.log.success(t("setup.agentHookUninstalled", { agent: provider.displayName }));
    } catch {
      // hook may not exist
    }
  }

  for (const agentName of config.agents) {
    const provider = registry.resolve(agentName);
    if (!provider) continue;

    if (!provider.detect()) {
      p.log.warn(t("setup.agentNotInstalled", { agent: provider.displayName }));
      continue;
    }

    if (provider.isHookInstalled()) {
      p.log.step(t("setup.agentHookAlreadyInstalled", { agent: provider.displayName }));
      continue;
    }

    try {
      provider.installHook();
      p.log.success(t("setup.agentHookInstalled", { agent: provider.displayName }));
    } catch (err: unknown) {
      p.log.error(
        t("setup.hookFailed", { error: err instanceof Error ? err.message : String(err) })
      );
      throw err;
    }
  }
}

export function saveConfig(config: Config): void {
  ConfigManager.save(config);
  p.log.success(t("setup.configSaved"));
}
