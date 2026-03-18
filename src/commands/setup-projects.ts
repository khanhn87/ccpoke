import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import * as p from "@clack/prompts";

import { ConfigManager, type Config } from "../config-manager.js";
import { t } from "../i18n/index.js";
import { promptPath } from "../utils/path-prompt.js";

export async function promptProjectSetup(config: Config): Promise<void> {
  if (config.projects.length > 0) return;

  const shouldAdd = await p.confirm({
    message: t("setup.addProjectPrompt"),
    initialValue: true,
  });

  if (p.isCancel(shouldAdd) || !shouldAdd) {
    p.log.info(t("setup.skipProject"));
    return;
  }

  while (true) {
    const added = await promptSingleProject(config);
    if (!added) break;

    const continueAdding = await p.confirm({
      message: t("setup.addAnotherProject"),
      initialValue: false,
    });

    if (p.isCancel(continueAdding) || !continueAdding) break;
  }
}

async function promptSingleProject(config: Config): Promise<boolean> {
  const rawPath = await promptPath(t("projectCmd.pathMessage"), process.cwd());

  if (p.isCancel(rawPath)) return false;

  const pathStr = rawPath as string;
  if (!pathStr) {
    p.log.error(t("projectCmd.pathRequired"));
    return false;
  }

  const fullPath = resolve(pathStr);
  if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
    p.log.error(t("projectCmd.pathInvalid"));
    return false;
  }

  const name = await p.text({
    message: t("projectCmd.nameMessage"),
    initialValue: basename(fullPath),
    validate(value) {
      if (!value || !value.trim()) return t("projectCmd.nameRequired");
      if (config.projects.some((proj) => proj.name === value.trim()))
        return t("projectCmd.nameDuplicate");
    },
  });

  if (p.isCancel(name)) return false;

  const trimmedName = (name as string).trim();
  config.projects.push({ name: trimmedName, path: fullPath });
  ConfigManager.save(config);
  p.log.success(t("setup.projectAdded", { name: trimmedName, path: fullPath }));
  return true;
}
