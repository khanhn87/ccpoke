import type { TmuxBridge } from "../tmux/tmux-bridge.js";

const KEY_DELAY_MS = 80;
const MAX_PLAN_OPTION_INDEX = 2;
const PLAN_OPTION_PATTERN = /^\s*[❯►>\s]*(Yes,\s*.+)$/;

const FALLBACK_LABELS = [
  "Yes, clear context and bypass permissions",
  "Yes, and bypass permissions",
  "Yes, manually approve edits",
] as const;

export type PermissionAction = "allow" | "deny" | "plan-option";

export interface PermissionInjectionResult {
  action: PermissionAction;
  optionIndex?: number;
}

export function isExitPlanMode(toolName: string): boolean {
  return toolName === "ExitPlanMode";
}

export function parsePermissionCallback(action: string): PermissionInjectionResult {
  if (action.startsWith("e")) {
    const idx = parseInt(action[1]!, 10);
    const clamped = Number.isNaN(idx) ? 0 : Math.min(Math.max(idx, 0), MAX_PLAN_OPTION_INDEX);
    return { action: "plan-option", optionIndex: clamped };
  }
  return { action: action === "a" ? "allow" : "deny" };
}

export class PermissionTuiInjector {
  constructor(private tmuxBridge: TmuxBridge) {}

  extractPlanOptions(paneId: string): string[] {
    try {
      const content = this.tmuxBridge.capturePane(paneId, 20);
      const options: string[] = [];
      for (const line of content.split("\n")) {
        const match = PLAN_OPTION_PATTERN.exec(line);
        if (match) options.push(match[1]!.trim());
      }
      if (options.length >= 3) return options.slice(0, 3);
    } catch {
      /* pane capture failed — use fallback */
    }
    return [...FALLBACK_LABELS];
  }

  async inject(paneId: string, result: PermissionInjectionResult): Promise<void> {
    const ready = await this.tmuxBridge.waitForTuiReady(paneId, 5000);
    if (!ready) throw new Error("TUI not ready");

    if (result.action === "plan-option") {
      await this.injectOptionSelect(paneId, result.optionIndex ?? 0);
    } else {
      this.tmuxBridge.sendKeys(paneId, result.action === "allow" ? "y" : "n", ["Enter"]);
    }
  }

  private async injectOptionSelect(paneId: string, optionIndex: number): Promise<void> {
    for (let i = 0; i < optionIndex; i++) {
      this.tmuxBridge.sendSpecialKey(paneId, "Down");
      await this.delay(KEY_DELAY_MS);
    }
    await this.delay(KEY_DELAY_MS);
    this.tmuxBridge.sendSpecialKey(paneId, "Enter");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
