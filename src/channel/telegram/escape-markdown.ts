const SPECIAL_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS, (m) => `\\${m}`);
}

const INLINE_MESSAGE_MAX_LENGTH = 500;

export function isInlineMessage(text: string): boolean {
  const hasCodeBlock = /```[\s\S]*?```|```[\s\S]*$/.test(text);
  if (hasCodeBlock) return false;
  return text.length <= INLINE_MESSAGE_MAX_LENGTH;
}

export function markdownToTelegramV2(text: string): string {
  const segments: string[] = [];
  const codeBlockPattern = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;

  while ((match = codeBlockPattern.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push(formatInlineSection(text.slice(lastIdx, match.index)));
    }
    const lang = match[1] || "";
    const code = match[2]!.replace(/[\\`]/g, (m) => `\\${m}`);
    segments.push(`\`\`\`${lang}\n${code}\`\`\``);
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    segments.push(formatInlineSection(text.slice(lastIdx)));
  }

  return segments.join("");
}

function formatInlineSection(text: string): string {
  return text.split("\n").map(convertInlineLine).join("\n");
}

function convertInlineLine(line: string): string {
  const tokens: { start: number; end: number; raw: string; converted: string }[] = [];

  collectInlineCode(line, tokens);
  collectBoldText(line, tokens);
  collectItalicText(line, tokens);
  collectStrikethrough(line, tokens);
  collectLinks(line, tokens);

  tokens.sort((a, b) => a.start - b.start);
  const merged = removeOverlapping(tokens);

  let result = "";
  let cursor = 0;

  for (const token of merged) {
    if (token.start > cursor) {
      result += escapeMarkdownV2(line.slice(cursor, token.start));
    }
    result += token.converted;
    cursor = token.end;
  }

  if (cursor < line.length) {
    result += escapeMarkdownV2(line.slice(cursor));
  }

  return convertHeading(result, line);
}

function collectInlineCode(
  line: string,
  tokens: { start: number; end: number; raw: string; converted: string }[]
): void {
  const regex = /`([^`]+)`/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      converted: `\`${escapeInsidePre(match[1]!)}\``,
    });
  }
}

function collectBoldText(
  line: string,
  tokens: { start: number; end: number; raw: string; converted: string }[]
): void {
  const regex = /\*\*(.+?)\*\*/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      converted: `*${escapeMarkdownV2(match[1]!)}*`,
    });
  }
}

function collectItalicText(
  line: string,
  tokens: { start: number; end: number; raw: string; converted: string }[]
): void {
  const regex = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      converted: `_${escapeMarkdownV2(match[1]!)}_`,
    });
  }
}

function collectStrikethrough(
  line: string,
  tokens: { start: number; end: number; raw: string; converted: string }[]
): void {
  const regex = /~~(.+?)~~/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      converted: `~${escapeMarkdownV2(match[1]!)}~`,
    });
  }
}

function collectLinks(
  line: string,
  tokens: { start: number; end: number; raw: string; converted: string }[]
): void {
  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    const label = escapeMarkdownV2(match[1]!);
    const url = match[2]!.replace(/[)\\]/g, (m) => `\\${m}`);
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0],
      converted: `[${label}](${url})`,
    });
  }
}

function removeOverlapping(
  tokens: { start: number; end: number; raw: string; converted: string }[]
): { start: number; end: number; raw: string; converted: string }[] {
  const result: { start: number; end: number; raw: string; converted: string }[] = [];
  let lastEnd = -1;

  for (const token of tokens) {
    if (token.start >= lastEnd) {
      result.push(token);
      lastEnd = token.end;
    }
  }

  return result;
}

function convertHeading(escapedLine: string, rawLine: string): string {
  const headingMatch = rawLine.match(/^(#{1,6})\s+/);
  if (!headingMatch) return escapedLine;

  const content = escapedLine.slice(escapeMarkdownV2(headingMatch[0]).length);
  return `*${content}*`;
}

function escapeInsidePre(text: string): string {
  return text.replace(/[\\`]/g, (m) => `\\${m}`);
}
