import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import * as p from "@clack/prompts";

import { t } from "../i18n/index.js";
import { isMacOS, isWindows } from "../utils/constants.js";
import { LOG_FILE } from "../utils/log.js";
import { getPackageVersion, paths } from "../utils/paths.js";

const ISSUES_URL = "https://github.com/kaida-palooza/ccpoke/issues/new";

const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/https?:\/\/[a-z0-9-]+\.trycloudflare\.com\b/gi, "https://***.trycloudflare.com"],
  [/from=\d+/g, "from=***"],
  [/chatId=\d+/g, "chatId=***"],
  [/userId=\d+/g, "userId=***"],
  [/"hostname":"[^"]+"/g, '"hostname":"***"'],
  [/(?<=\/Users\/|\/home\/)[^/\s"]+/g, "***"],
  [/project=[^\s")]+/g, "project=***"],
];

function sanitizeLog(raw: string): string {
  let result = raw;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function sanitizeConfig(): string {
  try {
    const raw = readFileSync(paths.configFile, "utf-8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(cfg)) {
      if (/token|secret|key|password|credential|user_id|chat_id|channel_id/i.test(key)) {
        sanitized[key] = "***";
      } else if (key === "projects") {
        sanitized[key] = `[${Array.isArray(val) ? val.length : 0} project(s)]`;
      } else {
        sanitized[key] = val;
      }
    }
    return JSON.stringify(sanitized, null, 2);
  } catch {
    return "not found or unreadable";
  }
}

function collectReport(description: string, logContent: string | null): string {
  const sections = [
    `=== user description ===\n${description}`,
    [
      "=== ccpoke bug report ===",
      "",
      `ccpoke: v${getPackageVersion()}`,
      `node:   ${process.version}`,
      `os:     ${process.platform} ${process.arch}`,
      `date:   ${new Date().toISOString()}`,
    ].join("\n"),
    `=== config (sanitized) ===\n${sanitizeConfig()}`,
  ];

  if (logContent) {
    sections.push(`=== log (${LOG_FILE}) ===\n${sanitizeLog(logContent)}`);
  }

  return sections.join("\n\n");
}

function readLogFile(): string | null {
  try {
    return readFileSync(LOG_FILE, "utf-8");
  } catch {
    return null;
  }
}

function purgeOldReports(): void {
  try {
    for (const file of readdirSync(paths.ccpokeDir)) {
      if (file.startsWith("bug-report-") && file.endsWith(".txt")) {
        unlinkSync(join(paths.ccpokeDir, file));
      }
    }
  } catch {
    // best-effort
  }
}

function openInFileManager(filepath: string): void {
  try {
    if (isMacOS()) {
      execSync(`open -R "${filepath}"`, { stdio: "ignore" });
    } else if (isWindows()) {
      execSync(`explorer /select,"${filepath}"`, { stdio: "ignore" });
    } else {
      const dir = join(filepath, "..");
      execSync(`xdg-open "${dir}"`, { stdio: "ignore" });
    }
  } catch {
    // best-effort
  }
}

function buildIssueUrl(title: string, body: string): string {
  const params = new URLSearchParams({ title, body });
  return `${ISSUES_URL}?${params.toString()}`;
}

export async function runBug(): Promise<void> {
  p.intro(t("bug.intro"));

  const description = await p.text({
    message: t("bug.descriptionPrompt"),
    placeholder: t("bug.descriptionPlaceholder"),
  });

  if (p.isCancel(description)) {
    p.cancel(t("bug.cancelled"));
    return;
  }

  const userDescription = (description as string).trim() || "Bug report";

  const s = p.spinner();
  s.start(t("bug.collecting"));

  const logContent = readLogFile();

  if (!logContent) {
    p.log.warning(t("bug.noLogFile", { path: LOG_FILE }));
  }

  const report = collectReport(userDescription, logContent);

  mkdirSync(paths.ccpokeDir, { recursive: true });
  purgeOldReports();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `bug-report-${timestamp}.txt`;
  const filepath = join(paths.ccpokeDir, filename);

  writeFileSync(filepath, report, "utf-8");
  s.stop(t("bug.saved", { path: filepath }));

  const issueBody = t("bug.attachHint");
  const issueUrl = buildIssueUrl(`[Bug] ${userDescription.slice(0, 80)}`, issueBody);

  p.log.step(t("bug.openingFolder"));
  openInFileManager(filepath);

  p.log.info(t("bug.issueLink"));
  p.log.message(issueUrl);

  p.outro(t("bug.instructions"));
}
