export function shortenModel(model: string): string {
  if (!model) return "";
  return model
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "gpt")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/-(\d+)$/, " $1");
}

export function buildSessionLabel(
  project: string,
  model: string,
  paneId: string,
  maxLen = 40
): string {
  const short = shortenModel(model);
  const prefix = paneId ? `${project} [${paneId}]` : project;

  if (!short) return truncate(prefix, maxLen);

  const sep = " · ";
  const full = `${prefix}${sep}${short}`;
  if (full.length <= maxLen) return full;

  const modelBudget = maxLen - prefix.length - sep.length;
  if (modelBudget >= 6) {
    return `${prefix}${sep}${truncate(short, modelBudget)}`;
  }

  const half = Math.floor((maxLen - sep.length) / 2);
  return `${truncate(prefix, half)}${sep}${truncate(short, half)}`;
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}
