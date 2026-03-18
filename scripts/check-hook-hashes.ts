import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HOOKS_DIR,
  LOCK_FILE,
  type LockEntry,
  computeHash,
  collectHookFiles,
} from "./hook-hash-utils.js";

function main(): void {
  let lockData: Record<string, LockEntry>;

  try {
    lockData = JSON.parse(readFileSync(LOCK_FILE, "utf-8"));
  } catch {
    console.error("✗ ccpoke-lock.json not found. Run: pnpm hash:update");
    process.exit(1);
  }

  const hookFiles = collectHookFiles(HOOKS_DIR);
  const errors: string[] = [];

  const missingInLock = hookFiles.filter((f) => !lockData[f]);
  if (missingInLock.length > 0) {
    errors.push(`Missing from ccpoke-lock.json: ${missingInLock.join(", ")}`);
  }

  const staleInLock = Object.keys(lockData).filter((f) => !hookFiles.includes(f));
  if (staleInLock.length > 0) {
    errors.push(`Stale entries in ccpoke-lock.json: ${staleInLock.join(", ")}`);
  }

  for (const relPath of hookFiles) {
    const absPath = join(HOOKS_DIR, relPath);
    const currentHash = computeHash(absPath);
    const entry = lockData[relPath];

    if (entry && currentHash !== entry.hash) {
      errors.push(`Hash mismatch: ${relPath}`);
    }
  }

  if (errors.length > 0) {
    console.error("✗ Hook hash check failed:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error("\nRun: pnpm hash:update");
    process.exit(1);
  }

  console.log(`✓ Hook hashes verified (${hookFiles.length} files)`);
}

main();
