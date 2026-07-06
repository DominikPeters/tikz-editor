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
  text: string;
};

const TIKZPICTURE_TOKEN_RE = /\\(?:begin|end)\s*\{\s*tikzpicture\s*\}/g;

function isTexLikeFile(file: ArxivSourceFile): boolean {
  return /\.(?:tex|tikz|ltx)$/iu.test(file.path);
}

function countLinesBefore(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}

function countLinesIn(source: string): number {
  if (source.length === 0) {
    return 1;
  }
  let lines = 1;
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) {
      lines += 1;
    }
  }
  return lines;
}

function summarizeCandidate(source: string): string {
  const body = source
    .replace(/\\(?:begin|end)\s*\{\s*tikzpicture\s*\}/gu, "")
    .split("\n")
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
    .replace(/[^\n]/gu, " ");
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
  const matches: TokenMatch[] = [];
  for (const match of file.source.matchAll(TIKZPICTURE_TOKEN_RE)) {
    matches.push({ index: match.index, text: match[0] });
  }
  const out: ArxivTikzCandidate[] = [];
  const stack: TokenMatch[] = [];
  const closedSpans: Array<{ from: number; to: number }> = [];
  for (const match of matches) {
    if (/\\begin/u.test(match.text)) {
      stack.push(match);
      continue;
    }
    const start = stack.pop();
    if (!start || stack.length > 0) {
      continue;
    }
    const end = match.index + match.text.length;
    const source = file.source.slice(start.index, end).trim();
    const contextualSource = buildContextualSource(file.source, start.index, end, closedSpans);
    closedSpans.push({ from: start.index, to: end });
    if (source.length === 0) {
      continue;
    }
    const lineStart = countLinesBefore(file.source, start.index);
    const lineEnd = lineStart + countLinesIn(source) - 1;
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
