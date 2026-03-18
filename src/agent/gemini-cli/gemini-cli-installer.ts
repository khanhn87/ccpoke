import { HookScriptCopier } from "../../hooks/hook-script-copier.js";
import { readJsonFile, writeJsonFile } from "../../utils/atomic-file.js";
import { isWindows } from "../../utils/constants.js";
import { paths, toPosixPath } from "../../utils/paths.js";
import type { AgentInstaller, IntegrityResult } from "../types.js";
import {
  buildHookConfigs,
  hasCcpokeHook,
  isScriptCurrent,
  isScriptPresent,
  type GeminiSettings,
} from "./gemini-cli-settings.js";

const SOURCE_MAP: Record<string, string> = {
  "ccpoke-stop": "gemini-stop",
  "ccpoke-session-start": "gemini-session-start",
  "ccpoke-notification": "gemini-notification",
};

function copyScripts(): void {
  HookScriptCopier.copyLib();
  const ext = isWindows() ? ".cmd" : ".sh";

  for (const cfg of buildHookConfigs()) {
    const baseName = SOURCE_MAP[cfg.hookName];
    const sourceFile = baseName ? `${baseName}${ext}` : undefined;
    if (sourceFile) {
      HookScriptCopier.copy(sourceFile, cfg.scriptPath);
    }
  }
}

export const geminiCliInstaller = {
  isInstalled(): boolean {
    try {
      const settings = readJsonFile<GeminiSettings>(paths.geminiSettings, {});
      if (!settings.hooks) return false;
      return buildHookConfigs().every((cfg) => hasCcpokeHook(settings.hooks?.[cfg.event] ?? []));
    } catch {
      return false;
    }
  },

  verifyIntegrity(): IntegrityResult {
    const missing: string[] = [];

    try {
      const settings = readJsonFile<GeminiSettings>(paths.geminiSettings, {});
      for (const cfg of buildHookConfigs()) {
        if (!hasCcpokeHook(settings.hooks?.[cfg.event] ?? []))
          missing.push(`${cfg.event} hook in settings`);
      }
    } catch {
      missing.push("settings.json");
    }

    const ext = isWindows() ? ".cmd" : ".sh";
    for (const cfg of buildHookConfigs()) {
      const baseName = SOURCE_MAP[cfg.hookName];
      const sourceFile = baseName ? `${baseName}${ext}` : undefined;
      if (!isScriptPresent(cfg.scriptPath)) {
        missing.push(`${cfg.hookName} script file`);
      } else if (sourceFile && !isScriptCurrent(cfg.scriptPath, sourceFile)) {
        missing.push(`outdated ${cfg.hookName} script`);
      }
    }

    return { complete: missing.length === 0, missing };
  },

  install(): void {
    geminiCliInstaller.uninstall();

    const settings = readJsonFile<GeminiSettings>(paths.geminiSettings, {});
    if (!settings.hooks) {
      settings.hooks = {};
    }

    for (const cfg of buildHookConfigs()) {
      settings.hooks[cfg.event] = [
        ...(settings.hooks[cfg.event] ?? []),
        {
          matcher: cfg.matcher,
          hooks: [
            {
              name: cfg.hookName,
              type: "command",
              command: toPosixPath(cfg.scriptPath),
              timeout: cfg.timeout,
            },
          ],
        },
      ];
    }

    writeJsonFile(paths.geminiSettings, settings);
    copyScripts();
  },

  uninstall(): void {
    try {
      const settings = readJsonFile<GeminiSettings>(paths.geminiSettings, {});
      if (!settings.hooks) {
        return;
      }

      for (const event of Object.keys(settings.hooks)) {
        const entries = settings.hooks[event];
        if (!entries) {
          continue;
        }

        const filtered = entries.filter((e) => !hasCcpokeHook([e]));
        if (filtered.length === 0) {
          delete settings.hooks[event];
        } else {
          settings.hooks[event] = filtered;
        }
      }

      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      writeJsonFile(paths.geminiSettings, settings);
    } catch {
      /* settings may not exist */
    }

    for (const cfg of buildHookConfigs()) {
      HookScriptCopier.remove(cfg.scriptPath);
    }
  },
} satisfies AgentInstaller;
