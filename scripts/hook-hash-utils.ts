import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export const PROJECT_ROOT = join(import.meta.dirname, "..");
export const HOOKS_DIR = join(PROJECT_ROOT, "hooks");
export const LOCK_FILE = join(PROJECT_ROOT, "ccpoke-lock.json");

export interface LockEntry {
  hash: string;
  version: string;
}

export function computeHash(filePath: string): string {
  const content = readFileSync(filePath);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function collectHookFiles(dir: string, base: string = dir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectHookFiles(fullPath, base));
    } else if (entry.isFile()) {
      files.push(relative(base, fullPath).replace(/\\/g, "/"));
    }
  }

  return files.sort();
}
