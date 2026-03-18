import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { toPosixPath } from "../utils/paths.js";

interface LockEntry {
  hash: string;
  version: string;
}

type HookLockFile = Record<string, LockEntry>;

const LOCK_FILE_NAME = "ccpoke-lock.json";

export function getLockFilePath(projectRoot: string): string {
  return join(projectRoot, LOCK_FILE_NAME);
}

export function readLockFile(projectRoot: string): HookLockFile | null {
  const lockPath = getLockFilePath(projectRoot);
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8")) as HookLockFile;
  } catch {
    return null;
  }
}

export function computeFileHash(filePath: string): string {
  const content = readFileSync(filePath);
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

export function isFileUpToDate(installedPath: string, lockHash: string): boolean {
  if (!existsSync(installedPath)) return false;
  try {
    return computeFileHash(installedPath) === lockHash;
  } catch {
    return false;
  }
}

export function getLockHash(projectRoot: string, relativeFileName: string): string | null {
  const lock = readLockFile(projectRoot);
  if (!lock) return null;
  const normalizedKey = toPosixPath(relativeFileName);
  return lock[normalizedKey]?.hash ?? null;
}
