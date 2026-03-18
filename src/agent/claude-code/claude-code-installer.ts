import { existsSync } from "node:fs";

import { HookScriptCopier } from "../../hooks/hook-script-copier.js";
import { readJsonFile, writeJsonFile } from "../../utils/atomic-file.js";
import { CCPOKE_MARKER, isWindows } from "../../utils/constants.js";
import { paths, toPosixPath } from "../../utils/paths.js";
import type { AgentInstaller, IntegrityResult } from "../types.js";

interface HookCommand {
  type: string;
  command: string;
  timeout: number;
}

interface HookEntry {
  matcher?: string;
  hooks: HookCommand[];
}

interface Settings {
  hooks?: {
    Stop?: HookEntry[];
    SessionStart?: HookEntry[];
    Notification?: HookEntry[];
    PreToolUse?: HookEntry[];
    PermissionRequest?: HookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const SCRIPT_MAP = [
  { source: "claude-code-stop", target: () => paths.claudeCodeHookScript },
  { source: "claude-code-session-start", target: () => paths.claudeCodeSessionStartScript },
  { source: "claude-code-notification", target: () => paths.claudeCodeNotificationScript },
  { source: "claude-code-pretooluse", target: () => paths.claudeCodePreToolUseScript },
  {
    source: "claude-code-permission-request",
    target: () => paths.claudeCodePermissionRequestScript,
  },
] as const;

function hasCcpokeHook(entries: HookEntry[]): boolean {
  return entries.some((entry) =>
    entry.hooks?.some((h) => typeof h.command === "string" && h.command.includes(CCPOKE_MARKER))
  );
}

function copyScripts(): void {
  HookScriptCopier.copyLib();
  const ext = isWindows() ? ".cmd" : ".sh";
  for (const entry of SCRIPT_MAP) {
    HookScriptCopier.copy(`${entry.source}${ext}`, entry.target());
  }
}

export const claudeCodeInstaller = {
  isInstalled(): boolean {
    try {
      const settings = readJsonFile<Settings>(paths.claudeSettings, {});
      return (
        hasCcpokeHook(settings.hooks?.Stop ?? []) &&
        hasCcpokeHook(settings.hooks?.SessionStart ?? []) &&
        hasCcpokeHook(settings.hooks?.Notification ?? []) &&
        hasCcpokeHook(settings.hooks?.PreToolUse ?? []) &&
        hasCcpokeHook(settings.hooks?.PermissionRequest ?? [])
      );
    } catch {
      return false;
    }
  },

  verifyIntegrity(): IntegrityResult {
    const missing: string[] = [];
    try {
      const settings = readJsonFile<Settings>(paths.claudeSettings, {});
      if (!hasCcpokeHook(settings.hooks?.Stop ?? [])) {
        missing.push("Stop hook in settings");
      }
      if (!hasCcpokeHook(settings.hooks?.SessionStart ?? [])) {
        missing.push("SessionStart hook in settings");
      }
      if (!hasCcpokeHook(settings.hooks?.Notification ?? [])) {
        missing.push("Notification hook in settings");
      }
      if (!hasCcpokeHook(settings.hooks?.PreToolUse ?? [])) {
        missing.push("PreToolUse hook in settings");
      }
      if (!hasCcpokeHook(settings.hooks?.PermissionRequest ?? [])) {
        missing.push("PermissionRequest hook in settings");
      }
      if (!settings.skipDangerousModePermissionPrompt) {
        missing.push("skipDangerousModePermissionPrompt");
      }
    } catch {
      missing.push("settings.json");
    }

    const ext = isWindows() ? ".cmd" : ".sh";
    for (const entry of SCRIPT_MAP) {
      const targetPath = entry.target();
      if (!existsSync(targetPath)) {
        missing.push(`${entry.source} script file`);
      } else if (HookScriptCopier.needsCopy(`${entry.source}${ext}`, targetPath)) {
        missing.push(`outdated ${entry.source} script`);
      }
    }

    return { complete: missing.length === 0, missing };
  },

  install(): void {
    claudeCodeInstaller.uninstall();

    const settings = readJsonFile<Settings>(paths.claudeSettings, {});
    if (!settings.hooks) {
      settings.hooks = {};
    }

    settings.hooks.Stop = [
      ...(settings.hooks.Stop ?? []),
      {
        hooks: [{ type: "command", command: toPosixPath(paths.claudeCodeHookScript), timeout: 10 }],
      },
    ];
    settings.hooks.SessionStart = [
      ...(settings.hooks.SessionStart ?? []),
      {
        hooks: [
          { type: "command", command: toPosixPath(paths.claudeCodeSessionStartScript), timeout: 5 },
        ],
      },
    ];
    settings.hooks.Notification = [
      ...(settings.hooks.Notification ?? []),
      {
        hooks: [
          {
            type: "command",
            command: toPosixPath(paths.claudeCodeNotificationScript),
            timeout: 10,
          },
        ],
      },
    ];
    settings.hooks.PreToolUse = [
      ...(settings.hooks.PreToolUse ?? []),
      {
        matcher: "AskUserQuestion",
        hooks: [
          { type: "command", command: toPosixPath(paths.claudeCodePreToolUseScript), timeout: 5 },
        ],
      },
    ];
    settings.hooks.PermissionRequest = [
      ...(settings.hooks.PermissionRequest ?? []),
      {
        hooks: [
          {
            type: "command",
            command: toPosixPath(paths.claudeCodePermissionRequestScript),
            timeout: 5,
          },
        ],
      },
    ];

    settings.skipDangerousModePermissionPrompt = true;

    writeJsonFile(paths.claudeSettings, settings);
    copyScripts();
  },

  uninstall(): void {
    const settings = readJsonFile<Settings>(paths.claudeSettings, {});
    if (!settings.hooks) {
      return;
    }

    const hooks = settings.hooks as Record<string, HookEntry[]>;
    for (const hookType of Object.keys(hooks)) {
      const entries = hooks[hookType];
      if (!Array.isArray(entries)) {
        continue;
      }

      const filtered = entries.filter(
        (entry) =>
          !entry.hooks?.some(
            (h) => typeof h.command === "string" && h.command.includes(CCPOKE_MARKER)
          )
      );

      if (filtered.length === 0) {
        delete hooks[hookType];
      } else {
        hooks[hookType] = filtered;
      }
    }

    if (Object.keys(hooks).length === 0) {
      delete settings.hooks;
    }

    writeJsonFile(paths.claudeSettings, settings);

    for (const entry of SCRIPT_MAP) {
      HookScriptCopier.remove(entry.target());
    }
  },
} satisfies AgentInstaller;
