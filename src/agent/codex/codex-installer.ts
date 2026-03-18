import { existsSync, readFileSync } from "node:fs";

import { HookScriptCopier } from "../../hooks/hook-script-copier.js";
import { writeTextFile } from "../../utils/atomic-file.js";
import { CCPOKE_MARKER, isWindows } from "../../utils/constants.js";
import { paths, toPosixPath } from "../../utils/paths.js";
import type { AgentInstaller, IntegrityResult } from "../types.js";

const NOTIFY_LINE_PATTERN = /^notify\s*=\s*\[([\s\S]*?)\]/m;

function readNotifyArray(content: string): string[] {
  const match = content.match(NOTIFY_LINE_PATTERN);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function writeNotifyLine(entries: string[]): string {
  const quoted = entries.map((e) => `"${e}"`).join(", ");
  return `notify = [${quoted}]`;
}

function readConfig(): string {
  try {
    return readFileSync(paths.codexConfigToml, "utf-8");
  } catch {
    return "";
  }
}

export const codexInstaller = {
  isInstalled(): boolean {
    try {
      if (!existsSync(paths.codexConfigToml)) {
        return false;
      }
      const entries = readNotifyArray(readConfig());
      return entries.some((e) => e.includes(CCPOKE_MARKER));
    } catch {
      return false;
    }
  },

  verifyIntegrity(): IntegrityResult {
    const missing: string[] = [];

    try {
      const entries = readNotifyArray(readConfig());
      if (!entries.some((e) => e.includes(CCPOKE_MARKER)))
        missing.push("notify entry in config.toml");
      else if (!entries.includes(toPosixPath(paths.codexHookScript)))
        missing.push("wrong notify script path in config.toml");
    } catch {
      missing.push("config.toml");
    }

    if (!existsSync(paths.codexHookScript)) {
      missing.push("notify script file");
    } else {
      const ext = isWindows() ? ".cmd" : ".sh";
      if (HookScriptCopier.needsCopy(`codex-notify${ext}`, paths.codexHookScript)) {
        missing.push("outdated notify script");
      }
    }

    return { complete: missing.length === 0, missing };
  },

  install(): void {
    codexInstaller.uninstall();

    let content = readConfig();
    const entries = readNotifyArray(content);
    entries.push(toPosixPath(paths.codexHookScript));

    const newLine = writeNotifyLine(entries);
    if (NOTIFY_LINE_PATTERN.test(content)) {
      content = content.replace(NOTIFY_LINE_PATTERN, newLine);
    } else {
      const sectionMatch = content.match(/^\[/m);
      if (sectionMatch?.index !== undefined) {
        content =
          content.slice(0, sectionMatch.index) + newLine + "\n" + content.slice(sectionMatch.index);
      } else {
        content = content.trimEnd() + (content.trim() ? "\n" : "") + newLine + "\n";
      }
    }

    writeTextFile(paths.codexConfigToml, content);

    HookScriptCopier.copyLib();
    const ext = isWindows() ? ".cmd" : ".sh";
    HookScriptCopier.copy(`codex-notify${ext}`, paths.codexHookScript);
  },

  uninstall(): void {
    if (!existsSync(paths.codexConfigToml)) {
      return;
    }

    let content = readConfig();
    const entries = readNotifyArray(content).filter((e) => !e.includes(CCPOKE_MARKER));

    if (entries.length === 0) {
      content = content.replace(/^notify\s*=\s*\[[\s\S]*?\]\s*\n?/m, "");
    } else {
      content = content.replace(NOTIFY_LINE_PATTERN, writeNotifyLine(entries));
    }

    writeTextFile(paths.codexConfigToml, content);

    HookScriptCopier.remove(paths.codexHookScript);
  },
} satisfies AgentInstaller;
