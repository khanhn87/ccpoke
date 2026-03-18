export function extractProseSnippet(text: string, maxLength: number): string {
  const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, "").replace(/```[\s\S]*/g, "");
  const paragraphs = withoutCodeBlocks.split(/\n\n+/);

  const candidates = paragraphs
    .map((p) => ({ raw: p.trim(), cleaned: stripInlineMarkdown(p.trim()) }))
    .filter((c) => c.cleaned.length >= 20);

  const proseBlocks = candidates.filter((c) => !isStructuredBlock(c.raw));
  if (proseBlocks.length > 0) {
    const joined = proseBlocks.map((b) => b.cleaned).join(" ");
    return truncateAtWordBoundary(joined, maxLength);
  }

  if (candidates.length > 0) {
    const joined = candidates.map((c) => c.cleaned).join(" ");
    return truncateAtWordBoundary(joined, maxLength);
  }

  return truncateAtWordBoundary(stripInlineMarkdown(text), maxLength);
}

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

export function isStructuredBlock(line: string): boolean {
  if (/^\|.*\|/.test(line)) return true;
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^\*\*[^*]+\*\*:?\s*$/.test(line)) return true;

  const lines = line.split("\n");
  const listLines = lines.filter((l) => /^\s*[-*•]\s|^\s*\d+[.)]\s/.test(l));
  if (listLines.length > lines.length * 0.5) return true;

  return false;
}

export function truncateMarkdown(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;

  const slice = text.slice(0, maxLen);
  const fenceCount = (slice.match(/```/g) || []).length;

  if (fenceCount % 2 !== 0) {
    const lastNewline = slice.lastIndexOf("\n");
    const cutAt = lastNewline > 0 ? lastNewline : maxLen;
    return slice.slice(0, cutAt) + "\n```\n\n\\.\\.\\.";
  }

  const lastPara = slice.lastIndexOf("\n\n");
  if (lastPara > maxLen * 0.6) return slice.slice(0, lastPara) + "\n\n...";

  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > maxLen * 0.6) return slice.slice(0, lastSpace) + "...";

  return slice + "...";
}

export function truncateAtWordBoundary(text: string, maxLength: number): string {
  const normalized = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;

  const truncated = normalized.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  const cut = lastSpace > maxLength * 0.6 ? truncated.slice(0, lastSpace) : truncated;
  return cut;
}
