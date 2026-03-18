import { existsSync, mkdirSync, unlinkSync } from "node:fs";

import { HookScriptCopier } from "../../hooks/hook-script-copier.js";
import { paths } from "../../utils/paths.js";
import type { AgentInstaller, IntegrityResult } from "../types.js";

export const opencodeInstaller = {
  isInstalled(): boolean {
    return existsSync(paths.opencodePluginFile);
  },

  verifyIntegrity(): IntegrityResult {
    const missing: string[] = [];

    if (!existsSync(paths.opencodePluginFile)) {
      missing.push("ccpoke-notify.js in plugins dir");
    } else if (HookScriptCopier.needsCopy("opencode-notify.js", paths.opencodePluginFile)) {
      missing.push("outdated ccpoke-notify.js");
    }

    return { complete: missing.length === 0, missing };
  },

  install(): void {
    opencodeInstaller.uninstall();
    mkdirSync(paths.opencodePluginsDir, { recursive: true });
    HookScriptCopier.copy("opencode-notify.js", paths.opencodePluginFile);
  },

  uninstall(): void {
    try {
      unlinkSync(paths.opencodePluginFile);
    } catch {
      /* may not exist */
    }
  },
} satisfies AgentInstaller;
