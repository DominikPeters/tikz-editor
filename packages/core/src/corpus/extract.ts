import { requireDefined } from "../utils/invariants.js";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildLineStarts, lineBreakWidthAt, lineForOffset } from "../text/line-map.js";

export type TikzSnippetKind = "tikzpicture" | "tikz-inline";

export type TikzSnippet = {
  id: string;
  kind: TikzSnippetKind;
  filePath: string;
  source: string;
  span: { from: number; to: number };
  startLine: number;
  endLine: number;
  incomplete: boolean;
};

const BEGIN_TIKZ = "\\begin{tikzpicture}";
const END_TIKZ = "\\end{tikzpicture}";
const TIKZ_INLINE_PATTERN = /\\tikz\b/g;

export function collectTikzSnippetsFromDocs(rootDir: string): TikzSnippet[] {
  const texFiles = collectTexFiles(rootDir);
  const snippets: TikzSnippet[] = [];

  for (const file of texFiles) {
    const source = readFileSync(file, "utf8");
    const relativePath = relative(rootDir, file);
    snippets.push(...extractTikzSnippetsFromSource(source, relativePath));
  }

  snippets.sort((a, b) => {
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.span.from - b.span.from;
  });

  return snippets;
}

export function extractTikzSnippetsFromSource(source: string, filePath: string): TikzSnippet[] {
  const lineStarts = buildLineStarts(source);

  const pictureSpans = extractTikzPictureSpans(source);
  const pictureSnippets = pictureSpans.map((span, index) =>
    createSnippet({
      kind: "tikzpicture",
      filePath,
      source,
      span,
      lineStarts,
      index
    })
  );

  const inlineSpans = extractInlineTikzSpans(source, pictureSpans);
  const inlineSnippets = inlineSpans.map((span, index) =>
    createSnippet({
      kind: "tikz-inline",
      filePath,
      source,
      span,
      lineStarts,
      index
    })
  );

  return [...pictureSnippets, ...inlineSnippets];
}

type SpanWithCompleteness = {
  from: number;
  to: number;
  incomplete: boolean;
};

function collectTexFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = requireDefined(stack.pop(), "Missing required stack.pop()");
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".tex")) {
        files.push(fullPath);
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function extractTikzPictureSpans(source: string): SpanWithCompleteness[] {
  const spans: SpanWithCompleteness[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const beginIndex = source.indexOf(BEGIN_TIKZ, cursor);
    if (beginIndex === -1) {
      break;
    }

    let depth = 1;
    let scanCursor = beginIndex + BEGIN_TIKZ.length;
    let isComplete = true;

    while (depth > 0) {
      const nextBegin = source.indexOf(BEGIN_TIKZ, scanCursor);
      const nextEnd = source.indexOf(END_TIKZ, scanCursor);

      if (nextEnd === -1) {
        isComplete = false;
        scanCursor = source.length;
        break;
      }

      if (nextBegin !== -1 && nextBegin < nextEnd) {
        depth += 1;
        scanCursor = nextBegin + BEGIN_TIKZ.length;
      } else {
        depth -= 1;
        scanCursor = nextEnd + END_TIKZ.length;
      }
    }

    const endIndex = depth === 0 ? scanCursor : source.length;
    spans.push({
      from: beginIndex,
      to: endIndex,
      incomplete: !isComplete
    });

    cursor = Math.max(endIndex, beginIndex + BEGIN_TIKZ.length);
  }

  return spans;
}

function extractInlineTikzSpans(source: string, excludedSpans: SpanWithCompleteness[]): SpanWithCompleteness[] {
  const spans: SpanWithCompleteness[] = [];

  TIKZ_INLINE_PATTERN.lastIndex = 0;
  let match = TIKZ_INLINE_PATTERN.exec(source);

  while (match) {
    const start = match.index;
    if (!isInsideAnySpan(start, excludedSpans)) {
      const parsed = findInlineSnippetEnd(source, start + match[0].length);
      spans.push({
        from: start,
        to: parsed.end,
        incomplete: parsed.incomplete
      });
    }

    const nextStart = match.index + Math.max(1, match[0].length);
    TIKZ_INLINE_PATTERN.lastIndex = nextStart;
    match = TIKZ_INLINE_PATTERN.exec(source);
  }

  return spans;
}

function findInlineSnippetEnd(source: string, cursor: number): { end: number; incomplete: boolean } {
  let curlyDepth = 0;
  let squareDepth = 0;
  let parenDepth = 0;
  let inComment = false;

  for (let i = cursor; i < source.length; i += 1) {
    const ch = source[i];

    if (inComment) {
      if (lineBreakWidthAt(source, i) > 0) {
        inComment = false;
      }
      continue;
    }

    if (ch === "%") {
      inComment = true;
      continue;
    }

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (ch === "{") {
      curlyDepth += 1;
      continue;
    }
    if (ch === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      continue;
    }
    if (ch === "[") {
      squareDepth += 1;
      continue;
    }
    if (ch === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    const canTerminate = curlyDepth === 0 && squareDepth === 0 && parenDepth === 0;

    if (ch === ";" && canTerminate) {
      return { end: i + 1, incomplete: false };
    }

    if (lineBreakWidthAt(source, i) > 0 && canTerminate) {
      return { end: i, incomplete: true };
    }
  }

  return { end: source.length, incomplete: true };
}

function isInsideAnySpan(position: number, spans: SpanWithCompleteness[]): boolean {
  for (const span of spans) {
    if (position >= span.from && position < span.to) {
      return true;
    }
  }
  return false;
}

function createSnippet(params: {
  kind: TikzSnippetKind;
  filePath: string;
  source: string;
  span: SpanWithCompleteness;
  lineStarts: number[];
  index: number;
}): TikzSnippet {
  const { kind, filePath, source, span, lineStarts, index } = params;

  return {
    id: `${filePath}:${kind}:${index}`,
    kind,
    filePath,
    source: source.slice(span.from, span.to),
    span: {
      from: span.from,
      to: span.to
    },
    startLine: lineForOffset(span.from, lineStarts),
    endLine: lineForOffset(Math.max(span.from, span.to - 1), lineStarts),
    incomplete: span.incomplete
  };
}
