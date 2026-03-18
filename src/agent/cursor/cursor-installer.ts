import { existsSync, mkdirSync } from "node:fs";

import { HookScriptCopier } from "../../hooks/hook-script-copier.js";
import { readJsonFile, writeJsonFile } from "../../utils/atomic-file.js";
import { CCPOKE_MARKER, isWindows } from "../../utils/constants.js";
import { paths, toPosixPath } from "../../utils/paths.js";
import type { AgentInstaller, IntegrityResult } from "../types.js";

interface StopHook {
  command: string;
  timeout: number;
}

interface HooksConfig {
  version?: number;
  hooks?: {
    stop?: StopHook[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function hasCcpokeHook(stopHooks: StopHook[]): boolean {
  return stopHooks.some(
    (entry) => typeof entry.command === "string" && entry.command.includes(CCPOKE_MARKER)
  );
}

function hasExactHookPath(stopHooks: StopHook[]): boolean {
  const expected = toPosixPath(paths.cursorHookScript);
  return stopHooks.some((entry) => typeof entry.command === "string" && entry.command === expected);
}

export const cursorInstaller = {
  isInstalled(): boolean {
    try {
      if (!existsSync(paths.cursorHooksJson)) return false;
      const config = readJsonFile<HooksConfig>(paths.cursorHooksJson, { version: 1, hooks: {} });
      return hasCcpokeHook(config.hooks?.stop ?? []);
    } catch {
      return false;
    }
  },

  verifyIntegrity(): IntegrityResult {
    const missing: string[] = [];

    try {
      const config = readJsonFile<HooksConfig>(paths.cursorHooksJson, { version: 1, hooks: {} });
      const stopHooks = config.hooks?.stop ?? [];
      if (!hasCcpokeHook(stopHooks)) {
        missing.push("Stop hook in hooks.json");
      } else if (!hasExactHookPath(stopHooks)) {
        missing.push("wrong hook script path in hooks.json");
      }
    } catch {
      missing.push("hooks.json");
    }

    if (!existsSync(paths.cursorHookScript)) {
      missing.push("stop script file");
    } else {
      const ext = isWindows() ? ".cmd" : ".sh";
      if (HookScriptCopier.needsCopy(`cursor-stop${ext}`, paths.cursorHookScript)) {
        missing.push("outdated stop script");
      }
    }

    return { complete: missing.length === 0, missing };
  },

  install(): void {
    cursorInstaller.uninstall();

    mkdirSync(paths.cursorDir, { recursive: true });

    const config = readJsonFile<HooksConfig>(paths.cursorHooksJson, { version: 1, hooks: {} });
    if (!config.hooks) {
      config.hooks = {};
    }

    config.hooks.stop = [
      ...(config.hooks.stop ?? []),
      {
        command: toPosixPath(paths.cursorHookScript),
        timeout: 10,
      },
    ];

    if (!config.version) {
      config.version = 1;
    }

    writeJsonFile(paths.cursorHooksJson, config);

    HookScriptCopier.copyLib();
    const ext = isWindows() ? ".cmd" : ".sh";
    HookScriptCopier.copy(`cursor-stop${ext}`, paths.cursorHookScript);
  },

  uninstall(): void {
    if (!existsSync(paths.cursorHooksJson)) {
      return;
    }

    const config = readJsonFile<HooksConfig>(paths.cursorHooksJson, { version: 1, hooks: {} });
    if (!config.hooks?.stop) {
      return;
    }

    const filtered = config.hooks.stop.filter(
      (entry) => !(typeof entry.command === "string" && entry.command.includes(CCPOKE_MARKER))
    );

    if (filtered.length === 0) {
      delete config.hooks.stop;
    } else {
      config.hooks.stop = filtered;
    }

    if (Object.keys(config.hooks).length === 0) {
      delete config.hooks;
    }

    writeJsonFile(paths.cursorHooksJson, config);

    HookScriptCopier.remove(paths.cursorHookScript);
  },
} satisfies AgentInstaller;
