import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  PROJECT_ROOT,
  HOOKS_DIR,
  LOCK_FILE,
  type LockEntry,
  computeHash,
  collectHookFiles,
} from "./hook-hash-utils.js";

function main(): void {
  const version = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8")).version;
  const hookFiles = collectHookFiles(HOOKS_DIR);

  let existing: Record<string, LockEntry> = {};
  if (existsSync(LOCK_FILE)) {
    try {
      existing = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
    } catch {
      /* start fresh */
    }
  }

  const lockData: Record<string, LockEntry> = {};
  let changed = 0;

  for (const relPath of hookFiles) {
    const absPath = join(HOOKS_DIR, relPath);
    const hash = computeHash(absPath);
    const prev = existing[relPath];

    if (prev && prev.hash === hash) {
      lockData[relPath] = prev;
      console.log(`  ${relPath} → unchanged (v${prev.version})`);
    } else {
      lockData[relPath] = { hash, version };
      console.log(`  ${relPath} → ${hash.slice(0, 20)}... (v${version})`);
      changed++;
    }
  }

  writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2) + "\n");

  console.log(
    `\n✓ ccpoke-lock.json updated (${hookFiles.length} files, ${changed} changed)`
  );
}

main();
