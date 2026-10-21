/**
 * Source-text units for the plain (non-rendered) deletes and motions:
 * whitespace-delimited words and logical lines, where `\\` (with an
 * optional `*` and `[…]`) also ends a line.
 */

type LineRange = { start: number; end: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function previousWordBoundary(text: string, offset: number): number {
  let index = clamp(offset, 0, text.length);
  while (index > 0 && /\s/u.test(text[index - 1] ?? "")) {
    index -= 1;
  }
  while (index > 0 && !/\s/u.test(text[index - 1] ?? "")) {
    index -= 1;
  }
  return index;
}

export function nextWordBoundary(text: string, offset: number): number {
  let index = clamp(offset, 0, text.length);
  while (index < text.length && /\s/u.test(text[index] ?? "")) {
    index += 1;
  }
  while (index < text.length && !/\s/u.test(text[index] ?? "")) {
    index += 1;
  }
  return index;
}

function logicalLineRanges(text: string): LineRange[] {
  if (text.length === 0) {
    return [{ start: 0, end: 0 }];
  }
  const ranges: LineRange[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === "\r") {
      const next = text[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
      ranges.push({ start, end: cursor });
      start = next;
      cursor = next;
      continue;
    }
    if (text[cursor] === "\n") {
      ranges.push({ start, end: cursor });
      start = cursor + 1;
      cursor += 1;
      continue;
    }
    if (text[cursor] === "\\" && text[cursor + 1] === "\\") {
      let next = cursor + 2;
      if (text[next] === "*") {
        next += 1;
      }
      while (next < text.length && /\s/u.test(text[next] ?? "")) {
        next += 1;
      }
      if (text[next] === "[") {
        let bracketCursor = next + 1;
        while (bracketCursor < text.length && text[bracketCursor] !== "]") {
          bracketCursor += 1;
        }
        if (bracketCursor < text.length) {
          next = bracketCursor + 1;
        }
      }
      ranges.push({ start, end: cursor });
      start = next;
      cursor = next;
      continue;
    }
    cursor += 1;
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

export function logicalLineBoundary(text: string, offset: number, direction: "backward" | "forward"): number {
  const bounded = clamp(offset, 0, text.length);
  const ranges = logicalLineRanges(text);
  const pivot = text.length === 0 ? 0 : Math.min(Math.max(0, bounded), text.length - 1);
  const range =
    ranges.find((candidate) => pivot >= candidate.start && pivot < candidate.end) ??
    ranges[ranges.length - 1] ?? { start: 0, end: text.length };
  return direction === "backward" ? range.start : range.end;
}
