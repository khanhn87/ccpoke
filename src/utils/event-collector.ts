import { homedir } from "node:os";
import { join } from "node:path";

import { readJsonFile, writeJsonFile } from "./atomic-file.js";
import { logger } from "./log.js";

interface CollectedEntry {
  timestamp: string;
  agent: string;
  body: unknown;
}

const FIXTURES_DIR = join(homedir(), ".ccpoke", "fixtures");
const MAX_ENTRIES = 500;

let enabled: boolean | null = null;

function isEnabled(): boolean {
  if (enabled === null) {
    enabled = process.env.CCPOKE_COLLECT === "true";
    if (enabled) logger.info(`[Collector] activated → ${FIXTURES_DIR}`);
  }
  return enabled;
}

function collect(eventType: string, body: unknown, agent = "unknown"): void {
  if (!isEnabled()) return;
  try {
    const filePath = join(FIXTURES_DIR, `${eventType}.json`);
    const entries = readJsonFile<CollectedEntry[]>(filePath, []);
    entries.push({ timestamp: new Date().toISOString(), agent, body });
    writeJsonFile(filePath, entries.slice(-MAX_ENTRIES));
  } catch (err: unknown) {
    logger.error({ err }, `[Collector] failed to write ${eventType}`);
  }
}

export const eventCollector = { collect };
