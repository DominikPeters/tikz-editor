import { parseSourceSpans } from "tikz-editor/text/knuth-plass";

export type TextSelectionRange = {
  start: number;
  end: number;
};

export function normalizeTextSelectionRange(range: TextSelectionRange, textLength: number): TextSelectionRange {
  const start = Math.min(Math.max(Math.floor(range.start), 0), textLength);
  const end = Math.min(Math.max(Math.floor(range.end), 0), textLength);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
}

export function expandSelectionToMathDelimiters(text: string, range: TextSelectionRange): TextSelectionRange {
  const normalized = normalizeTextSelectionRange(range, text.length);
  if (normalized.start === normalized.end) {
    return normalized;
  }
  const parsed = parseSourceSpans(text);
  if (parsed.error) {
    return normalized;
  }
  let start = normalized.start;
  let end = normalized.end;
  for (const span of parsed.spans) {
    if (span.kind !== "math") {
      continue;
    }
    if (start <= span.contentStart && end >= span.contentEnd) {
      start = Math.min(start, span.rawStart);
      end = Math.max(end, span.rawEnd);
    }
  }
  return normalizeTextSelectionRange({ start, end }, text.length);
}
