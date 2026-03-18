import { execSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import * as p from "@clack/prompts";
import AdmZip from "adm-zip";

import { t } from "../i18n/index.js";
import { resetTmuxBinaryCache } from "../tmux/tmux-bridge.js";
import { isMacOS, isWindows, refreshWindowsPath } from "../utils/constants.js";
import { shellSpawnArgs } from "../utils/shell.js";

export async function promptTmuxSetup(): Promise<void> {
  const version = isWindows() ? (getTmuxVersion() ?? getPsmuxVersion()) : getTmuxVersion();

  if (version) {
    p.log.success(t("setup.tmuxDetected", { version }));
    return;
  }

  const shouldInstall = await p.confirm({
    message: isWindows() ? t("setup.tmuxWindowsInstallPrompt") : t("setup.tmuxInstallPrompt"),
    initialValue: true,
  });

  if (p.isCancel(shouldInstall) || !shouldInstall) {
    p.log.info(t("setup.tmuxInstallSkipped"));
    return;
  }

  const installed = await installTmux();
  if (!installed) {
    p.log.warn(isWindows() ? t("setup.tmuxWindowsInstallFailed") : t("setup.tmuxInstallFailed"));
  }
}

function getTmuxVersion(): string | null {
  try {
    const raw = execSync("tmux -V", { stdio: "pipe", encoding: "utf-8" }).trim();
    return parseVersionNumber(raw);
  } catch {
    return null;
  }
}

function getPsmuxVersion(): string | null {
  try {
    const raw = execSync("psmux -V", { stdio: "pipe", encoding: "utf-8" }).trim();
    return parseVersionNumber(raw);
  } catch {
    return null;
  }
}

function parseVersionNumber(raw: string): string {
  return raw.replace(/^\S+\s+/, "").trim() || raw.trim();
}

async function installTmux(): Promise<boolean> {
  if (isWindows()) {
    return downloadPsmuxFromGithub();
  }

  let installCmd: string | null = null;

  if (isMacOS()) {
    try {
      execSync("which brew", { stdio: "pipe" });
      installCmd = "brew install tmux";
    } catch {
      // no brew
    }
  } else {
    try {
      execSync("which apt-get", { stdio: "pipe" });
      installCmd = "sudo apt-get install -y tmux";
    } catch {
      // no apt-get
    }
  }

  if (!installCmd) {
    p.log.warn(t("setup.tmuxInstallFailed"));
    return false;
  }

  const s = p.spinner();
  s.start(installCmd);

  try {
    await runCommandAsync(installCmd);
    s.stop(t("setup.tmuxInstallSuccess"));
    return true;
  } catch {
    s.stop(t("setup.tmuxInstallFailed"));
    return false;
  }
}

async function downloadPsmuxFromGithub(): Promise<boolean> {
  const s = p.spinner();
  s.start(t("setup.psmuxDownloading"));

  try {
    const archMap: Record<string, string> = { x64: "x64", arm64: "arm64", ia32: "x86" };
    const arch = archMap[process.arch] ?? "x64";

    const releaseRes = await fetch("https://api.github.com/repos/marlocarlo/psmux/releases/latest");
    if (!releaseRes.ok) {
      s.stop(t("setup.psmuxDownloadFailed"));
      p.log.error(`GitHub API responded with ${releaseRes.status}`);
      return false;
    }
    const release = (await releaseRes.json()) as {
      tag_name: string;
      assets: { name: string; browser_download_url: string }[];
    };
    const assetName = `psmux-${release.tag_name}-windows-${arch}.zip`;
    const asset = release.assets?.find((a) => a.name === assetName);
    if (!asset) {
      s.stop(t("setup.psmuxDownloadFailed"));
      return false;
    }

    const installDir = join(
      process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local"),
      "psmux"
    );

    const zipRes = await fetch(asset.browser_download_url, { redirect: "follow" });
    if (!zipRes.ok) {
      s.stop(t("setup.psmuxDownloadFailed"));
      p.log.error(`Download failed with ${zipRes.status}`);
      return false;
    }
    const zipBuffer = Buffer.from(await zipRes.arrayBuffer());

    mkdirSync(installDir, { recursive: true });
    new AdmZip(zipBuffer).extractAllTo(installDir, true);

    const entries = readdirSync(installDir);
    const subDir = entries.find((e) => {
      try {
        return statSync(join(installDir, e)).isDirectory();
      } catch {
        return false;
      }
    });
    if (subDir) {
      const subDirPath = join(installDir, subDir);
      for (const file of readdirSync(subDirPath)) {
        copyFileSync(join(subDirPath, file), join(installDir, file));
      }
      rmSync(subDirPath, { recursive: true, force: true });
    }

    const regExe = join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");

    try {
      const regOutput = execSync(`"${regExe}" query "HKCU\\Environment" /v Path`, {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5000,
      });
      const currentPath = regOutput.match(/REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]?.trim() ?? "";
      if (!currentPath.toLowerCase().includes(installDir.toLowerCase())) {
        const newPath = currentPath ? `${currentPath};${installDir}` : installDir;
        execSync(
          `"${regExe}" add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`,
          { stdio: "pipe", timeout: 5000 }
        );
      }
    } catch {
      try {
        execSync(
          `"${regExe}" add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${installDir}" /f`,
          { stdio: "pipe", timeout: 5000 }
        );
      } catch {
        p.log.warn(t("setup.tmuxWindowsPathRefreshHint"));
      }
    }

    refreshWindowsPath();
    resetTmuxBinaryCache();

    s.stop(t("setup.tmuxInstallSuccess"));
    p.log.info(t("setup.tmuxWindowsPathRefreshHint"));
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    s.stop(t("setup.psmuxDownloadFailed"));
    p.log.error(`psmux download error: ${detail}`);
    return false;
  }
}

function spawnAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "pipe" });

    let output = "";

    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("close", (code: number | null) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    child.on("error", reject);
  });
}

function runCommandAsync(command: string): Promise<string> {
  const { cmd, args } = shellSpawnArgs(command);
  return spawnAsync(cmd, args);
}
