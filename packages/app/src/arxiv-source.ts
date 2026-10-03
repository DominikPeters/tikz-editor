import { readTexControlSequence, skipTexComment, skipTexVerbatim } from "@tikz-editor/core/parser/tex-lexical";
import type { ArxivSourceFile, ArxivSourcePayload } from "./platform/types.js";

export type ArxivTikzCandidate = {
  id: string;
  arxivId: string;
  path: string;
  source: string;
  contextualSource: string;
  lineStart: number;
  lineEnd: number;
  label: string;
};

export type ArxivPaperSession = {
  input: string;
  paper: ArxivSourcePayload | null;
  selectedCandidateId: string | null;
};

type TokenMatch = {
  index: number;
  to: number;
  kind: "begin" | "end";
};

// Import accepts whitespace around the environment name and retains an outer
// nested picture as one candidate. Core figure recovery has a different policy.
const TIKZPICTURE_ARGUMENT_RE = /\s*\{\s*tikzpicture\s*\}/y;

function collectTikzPictureTokens(source: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipTexComment(source, cursor);
      continue;
    }
    if (char !== "\\") {
      cursor += 1;
      continue;
    }
    const command = readTexControlSequence(source, cursor)!;
    const verbatimEnd = skipTexVerbatim(source, command, true);
    if (verbatimEnd !== null) {
      cursor = verbatimEnd;
      continue;
    }
    if (command.raw === "\\begin" || command.raw === "\\end") {
      TIKZPICTURE_ARGUMENT_RE.lastIndex = command.to;
      const argument = TIKZPICTURE_ARGUMENT_RE.exec(source);
      if (argument) {
        cursor = TIKZPICTURE_ARGUMENT_RE.lastIndex;
        matches.push({ index: command.from, to: cursor, kind: command.raw === "\\begin" ? "begin" : "end" });
        continue;
      }
    }
    cursor = command.to;
  }
  return matches;
}

function isTexLikeFile(file: ArxivSourceFile): boolean {
  return /\.(?:tex|tikz|ltx)$/iu.test(file.path);
}

function countLinesBefore(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    const char = source.charCodeAt(i);
    if (char === 13) {
      line += 1;
      if (i + 1 < index && source.charCodeAt(i + 1) === 10) i += 1;
    } else if (char === 10) {
      line += 1;
    }
  }
  return line;
}

function summarizeCandidate(source: string): string {
  const body = source
    .replace(/\\(?:begin|end)\s*\{\s*tikzpicture\s*\}/gu, "")
    .split(/\r\n?|\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%"));
  if (!body) {
    return "tikzpicture";
  }
  return body.length > 88 ? `${body.slice(0, 85)}...` : body;
}

function blankSourceRange(source: string, from: number, to: number): string {
  return source
    .slice(from, to)
    .replace(/[^\r\n]/gu, (match) => " ".repeat(match.length));
}

function buildContextualSource(fileSource: string, startIndex: number, endIndex: number, priorSpans: ReadonlyArray<{ from: number; to: number }>): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const span of priorSpans) {
    if (span.to <= cursor || span.from >= startIndex) {
      continue;
    }
    parts.push(fileSource.slice(cursor, span.from));
    parts.push(blankSourceRange(fileSource, span.from, Math.min(span.to, startIndex)));
    cursor = Math.min(span.to, startIndex);
  }
  parts.push(fileSource.slice(cursor, startIndex));
  parts.push(fileSource.slice(startIndex, endIndex));
  return parts.join("");
}

function collectTikzPictureCandidates(file: ArxivSourceFile, arxivId: string): ArxivTikzCandidate[] {
  const matches = collectTikzPictureTokens(file.source);
  const out: ArxivTikzCandidate[] = [];
  const stack: TokenMatch[] = [];
  const closedSpans: Array<{ from: number; to: number }> = [];
  for (const match of matches) {
    if (match.kind === "begin") {
      stack.push(match);
      continue;
    }
    const start = stack.pop();
    if (!start || stack.length > 0) {
      continue;
    }
    const end = match.to;
    const source = file.source.slice(start.index, end).trim();
    const contextualSource = buildContextualSource(file.source, start.index, end, closedSpans);
    closedSpans.push({ from: start.index, to: end });
    if (source.length === 0) {
      continue;
    }
    const lineStart = countLinesBefore(file.source, start.index);
    const lineEnd = countLinesBefore(file.source, end);
    const index = out.length + 1;
    out.push({
      id: `${file.path}:${lineStart}:${index}`,
      arxivId,
      path: file.path,
      source,
      contextualSource,
      lineStart,
      lineEnd,
      label: summarizeCandidate(source)
    });
  }
  return out;
}

export function extractArxivTikzCandidates(paper: ArxivSourcePayload): ArxivTikzCandidate[] {
  const texFiles = paper.files
    .filter(isTexLikeFile)
    .sort((a, b) => {
      const aMain = /(^|\/)main\.tex$/iu.test(a.path) || a.source.includes("\\begin{document}");
      const bMain = /(^|\/)main\.tex$/iu.test(b.path) || b.source.includes("\\begin{document}");
      if (aMain !== bMain) {
        return aMain ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });
  return texFiles.flatMap((file) => collectTikzPictureCandidates(file, paper.id));
}

export function createArxivVirtualFileName(candidate: ArxivTikzCandidate): string {
  const normalizedId = candidate.arxivId.replace(/[^\dA-Za-z.-]+/gu, "-");
  const baseName = candidate.path
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/u, "")
    .replace(/[^\dA-Za-z.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  const pathPart = baseName && baseName.length > 0 ? baseName : "figure";
  return `${normalizedId}-${pathPart}-L${candidate.lineStart}.tex`;
}
