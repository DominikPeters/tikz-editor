/**
 * Table input for `\addplot table` and `\pgfplotstableread`: the format keys
 * of `/pgfplots/table/` and a reader for inline or file text. Rules from the
 * manual (axis-addplot.tex "Reading Coordinates From Tables",
 * pgfplotstable.tex input keys) and experiment E17 (behaviour section V).
 * Pure: no AST, no scene.
 */
import type { Span } from "../ast/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { splitTopLevelList, stripBraces } from "./model.js";

export type TableColumnSeparator = "space" | "tab" | "comma" | "semicolon" | "colon" | "ampersand" | "braces";

/** One column source: a name (preferred), an index, an expression (V2, manual `table/x`, `x index`, `x expr`). */
export type ColumnSource = { name?: string; index?: number; expr?: string };

export type TableSettings = {
  colSep: TableColumnSeparator;
  /** `row sep=newline` or `\\` (`crcr` is the same, E17 `crcr`). */
  rowSep: "newline" | "\\\\";
  header: "true" | "false" | "has colnames";
  skipFirstN: number;
  /** `#` and these start a comment that runs to the end of the line. */
  commentChars: string[];
  ignoreChars: string[];
  whiteSpaceChars: string[];
  /** `trim cells` (on for `col sep=&`). */
  trimCells: boolean;
  x: ColumnSource;
  y: ColumnSource;
  meta?: ColumnSource;
  /** Error columns (`x error`, `y error plus`, …), by key: `x`, `x plus`, `x minus`, `y`, `y plus`, `y minus`. */
  errors: Record<string, ColumnSource>;
  /** `each nth point` given in the table options (it is also a plot key). */
  eachNthPoint?: number;
};

export function defaultTableSettings(): TableSettings {
  return {
    colSep: "space", rowSep: "newline", header: "true", skipFirstN: 0, commentChars: [], ignoreChars: [], whiteSpaceChars: [],
    trimCells: false, x: { index: 0 }, y: { index: 1 }, errors: {}
  };
}

const SEPARATORS: Record<string, TableColumnSeparator> = {
  space: "space", tab: "tab", comma: "comma", semicolon: "semicolon", colon: "colon", ampersand: "ampersand", "&": "ampersand", "\\&": "ampersand", braces: "braces"
};

export type TableKeyProblem = { key: string; value: string; span: Span; reason: "unsupported" | "invalid" };

/** `{(,),\ ,\#}` → the characters. */
function readCharList(raw: string): string[] {
  return splitTopLevelList(stripBraces(raw)).flatMap((item) => {
    const text = item.trim();
    if (text === "\\ " || text === "\\") return [" "];
    if (text.length === 0) return item.length > 0 ? [" "] : [];
    if (text.startsWith("\\") && text.length === 2) return [text.charAt(1)];
    return [text.charAt(0)];
  });
}

/** Table keys the reader knows (with or without the `table/` prefix in `\addplot table[…]`). */
const KNOWN = new Set([
  "x", "y", "x index", "y index", "x expr", "y expr", "meta", "meta index", "meta expr",
  "col sep", "row sep", "header", "skip first n", "comment chars", "ignore chars", "white space chars", "trim cells",
  "format", "search path", "search path/implicit .", "read completely", "each nth point",
  "x error", "y error", "x error index", "y error index", "x error expr", "y error expr",
  "x error plus", "x error minus", "y error plus", "y error minus",
  "x error plus index", "x error minus index", "y error plus index", "y error minus index",
  "x error plus expr", "x error minus expr", "y error plus expr", "y error minus expr"
]);

/**
 * Applies table keys in order. `entries` come from `\pgfplotsset{table/…}`,
 * `\pgfplotstableset`, plot options `table/…` and finally `\addplot table[…]`
 * (where the prefix may be left out). Returns the keys it could not use.
 */
export function applyTableKeys(settings: TableSettings, entries: readonly OptionEntry[], prefixOptional: boolean): TableKeyProblem[] {
  const problems: TableKeyProblem[] = [];
  for (const entry of entries) {
    if (entry.kind === "unknown") continue;
    let key = entry.key.trim().replace(/\s+/gu, " ").replace(/^\/pgfplots\//u, "");
    if (key.startsWith("table/")) key = key.slice("table/".length);
    else if (!prefixOptional) continue;
    const value = entry.kind === "kv" ? stripBraces(entry.valueRaw) : null;
    const invalid = (): void => { problems.push({ key, value: value ?? "", span: entry.span, reason: "invalid" }); };
    if (!KNOWN.has(key)) {
      problems.push({ key, value: value ?? "", span: entry.span, reason: "unsupported" });
      continue;
    }
    const column = (letter: "x" | "y" | "meta", kind: "name" | "index" | "expr"): void => {
      const current = settings[letter] ?? {};
      if (value === null) { invalid(); return; }
      if (kind === "name") settings[letter] = { ...current, name: value };
      else if (kind === "expr") settings[letter] = { ...current, expr: value };
      else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) { invalid(); return; }
        settings[letter] = { ...current, index: n };
      }
    };
    const error = (target: string, kind: "name" | "index" | "expr"): void => {
      if (value === null) { invalid(); return; }
      const targets = target.endsWith("plus") || target.endsWith("minus") ? [target] : [`${target} plus`, `${target} minus`];
      for (const t of targets) {
        const current = settings.errors[t] ?? {};
        if (kind === "name") settings.errors[t] = { name: value };
        else if (kind === "expr") settings.errors[t] = { ...current, expr: value };
        else {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0) { invalid(); return; }
          settings.errors[t] = { index: n };
        }
      }
    };
    const errorKey = /^(x|y) error( plus| minus)?( index| expr)?$/u.exec(key);
    if (errorKey) {
      error(`${errorKey[1] ?? "y"}${errorKey[2] ?? ""}`, errorKey[3] === " index" ? "index" : errorKey[3] === " expr" ? "expr" : "name");
      continue;
    }
    switch (key) {
      case "x": case "y": case "meta": column(key, "name"); break;
      case "x index": column("x", "index"); break;
      case "y index": column("y", "index"); break;
      case "meta index": column("meta", "index"); break;
      case "x expr": column("x", "expr"); break;
      case "y expr": column("y", "expr"); break;
      case "meta expr": column("meta", "expr"); break;
      case "col sep": {
        const sep = SEPARATORS[value ?? ""];
        if (!sep) { invalid(); break; }
        settings.colSep = sep;
        if (sep === "ampersand") settings.trimCells = true;
        break;
      }
      case "row sep": {
        if (value === "newline") settings.rowSep = "newline";
        else if (value === "\\\\" || value === "crcr") settings.rowSep = "\\\\";
        else invalid();
        break;
      }
      case "header": {
        const v = value ?? "true";
        if (v === "true" || v === "false" || v === "has colnames") settings.header = v;
        else invalid();
        break;
      }
      case "skip first n": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) invalid(); else settings.skipFirstN = n;
        break;
      }
      case "each nth point": {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) invalid(); else settings.eachNthPoint = n;
        break;
      }
      case "comment chars": settings.commentChars = readCharList(value ?? ""); break;
      case "ignore chars": settings.ignoreChars = readCharList(value ?? ""); break;
      case "white space chars": settings.whiteSpaceChars = readCharList(value ?? ""); break;
      case "trim cells": settings.trimCells = (value ?? "true") !== "false"; break;
      // Accepted without effect here: the format is decided by the argument, files are found next to the document.
      default: break;
    }
  }
  return problems;
}

export function tableEntries(list: OptionListAst | undefined): OptionEntry[] {
  return list?.entries ?? [];
}

export type TableRow = {
  cells: string[];
  /** `\lineno`: counts every line from the first, including skipped, comment, empty and header lines (E17). */
  lineno: number;
  /** An empty line precedes the row: the plot jumps there (`empty line=auto` at compat ≥ 1.4). */
  afterEmptyLine: boolean;
  /** Where the row's text is (offsets of the text given to the reader plus its offset). */
  span: Span;
};

export type ReadTableResult = {
  /** Column names, or null when the first row is data (names are then the indices). */
  names: string[] | null;
  rows: TableRow[];
};

type RawLine = { text: string; from: number; to: number };

/**
 * Splits table text into lines as TeX and the reader see them. Inline data
 * (an argument read by TeX) loses `%` comments together with their end of
 * line, so `1 2 % c⏎3 4` is one row (E17 `trailing-percent`); in a file a
 * `%` comment ends at the end of its line. With `row sep=\\` rows end at
 * `\\` and newlines are spaces.
 */
function splitLines(text: string, offset: number, inline: boolean, rowSep: "newline" | "\\\\"): RawLine[] {
  const lines: RawLine[] = [];
  // Fast path (large generated tables): newline rows, nothing TeX would change.
  if (rowSep === "newline" && !text.includes("{") && !(inline && text.includes("%"))) {
    let start = 0;
    for (;;) {
      const end = text.indexOf("\n", start);
      const stop = end < 0 ? text.length : end;
      const lineEnd = stop > start && text.charCodeAt(stop - 1) === 13 ? stop - 1 : stop;
      lines.push({ text: text.slice(start, lineEnd), from: offset + start, to: offset + lineEnd });
      if (end < 0) break;
      start = end + 1;
    }
    return lines;
  }
  let current = "";
  let from = offset;
  let depth = 0;
  const push = (end: number): void => {
    lines.push({ text: current, from, to: end });
    current = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === "\\") {
      const next = text.charAt(i + 1);
      if (next === "\\" && rowSep === "\\\\" && depth === 0) {
        push(offset + i);
        i += 1;
        from = offset + i + 1;
        continue;
      }
      current += c + next;
      i += 1;
      continue;
    }
    if (c === "%" && inline) {
      // TeX drops the comment and the end of line.
      while (i + 1 < text.length && text.charAt(i + 1) !== "\n") i += 1;
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "\r") continue;
    if (c === "\n") {
      if (rowSep === "newline" && depth === 0) {
        push(offset + i);
        from = offset + i + 1;
      } else current += " ";
      continue;
    }
    current += c;
  }
  if (current.length > 0 || rowSep === "newline") push(offset + text.length);
  return lines;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;
const UNBOUNDED = /^[+-]?(?:nan|inf|infty)$/iu;

/** A cell as a number: decimal or scientific, `nan`, `inf`, `-inf`; anything else is NaN (the row is then discarded, E17). */
export function readTableNumber(raw: string): number {
  const text = raw.trim();
  if (NUMBER.test(text)) return Number(text);
  if (UNBOUNDED.test(text)) return /nan/iu.test(text) ? Number.NaN : text.startsWith("-") ? -Infinity : Infinity;
  const braced = /^\{(.*)\}$/u.exec(text);
  if (braced?.[1] !== undefined && NUMBER.test(braced[1].trim())) return Number(braced[1]);
  return Number.NaN;
}

function isHeaderNumber(raw: string): boolean {
  const text = raw.trim();
  return NUMBER.test(text) || UNBOUNDED.test(text);
}

const SEPARATOR_CHAR: Record<Exclude<TableColumnSeparator, "space" | "braces">, string> = {
  tab: "\t", comma: ",", semicolon: ";", colon: ":", ampersand: "&"
};

const SIMPLE_SPACE_CELLS = /^[^{}\\]*$/u;

function splitCells(line: string, settings: TableSettings): string[] {
  if (settings.colSep === "space" && SIMPLE_SPACE_CELLS.test(line)) return line.split(/[ \t]+/u);
  const cells: string[] = [];
  if (settings.colSep === "braces") {
    for (const match of line.matchAll(/\{((?:[^{}]|\{[^{}]*\})*)\}/gu)) cells.push(match[1] ?? "");
    return cells;
  }
  const sep = settings.colSep === "space" ? null : SEPARATOR_CHAR[settings.colSep];
  let current = "";
  let depth = 0;
  let started = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (c === "\\") { current += c + line.charAt(i + 1); i += 1; started = true; continue; }
    if (c === "{") depth += 1;
    if (c === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && (sep === null ? c === " " || c === "\t" : c === sep)) {
      if (sep !== null || started) cells.push(current);
      current = ""; started = false;
      continue;
    }
    current += c; started = true;
  }
  if (sep !== null || started) cells.push(current);
  return cells.map((cell) => {
    const trimmed = cell.trim();
    return trimmed.startsWith("{") && trimmed.endsWith("}") ? stripBraces(trimmed) : trimmed;
  });
}

/**
 * Reads table text (inline argument or file contents) into column names and
 * rows (V1–V8). `offset` is where `text` starts in the document, for spans.
 */
export function readTableText(text: string, offset: number, inline: boolean, settings: TableSettings): ReadTableResult {
  const comments = new Set(["#", ...settings.commentChars, ...(inline ? [] : ["%"])]);
  const commentList = [...comments];
  const ignore = new Set(settings.ignoreChars);
  const white = new Set(settings.whiteSpaceChars);
  const plain = ignore.size === 0 && white.size === 0;
  const lines = splitLines(text, offset, inline, settings.rowSep);
  const rows: TableRow[] = [];
  let names: string[] | null = null;
  let headerDecided = false;
  let afterEmpty = false;
  let sawRow = false;
  for (let lineno = 0; lineno < lines.length; lineno += 1) {
    if (lineno < settings.skipFirstN) continue;
    const line = lines[lineno];
    if (!line) continue;
    let body = line.text;
    if (!plain) {
      let out = "";
      for (const c of body) {
        if (ignore.has(c)) continue;
        out += white.has(c) ? " " : c;
      }
      body = out;
    }
    let commentAt = -1;
    if (body.includes("\\") || commentList.some((c) => body.includes(c))) {
      for (let i = 0; i < body.length; i += 1) {
        const c = body.charAt(i);
        if (c === "\\") { i += 1; continue; }
        if (comments.has(c)) { commentAt = i; break; }
      }
    }
    const content = (commentAt >= 0 ? body.slice(0, commentAt) : body).trim();
    if (content.length === 0) {
      // A comment line is skipped; a blank line is an empty line (a jump after the first row).
      if (commentAt < 0 && sawRow) afterEmpty = true;
      continue;
    }
    const cells = splitCells(content, settings);
    if (!headerDecided) {
      headerDecided = true;
      const isHeader = settings.header === "has colnames" || (settings.header === "true" && cells.some((cell) => !isHeaderNumber(cell)));
      if (isHeader) {
        names = cells;
        continue;
      }
    }
    rows.push({ cells, lineno, afterEmptyLine: afterEmpty, span: { from: line.from, to: line.to } });
    afterEmpty = false;
    sawRow = true;
  }
  return { names, rows };
}

/** The index of a column source in a read table, or a reason it has none (V2: a name wins over an index). */
export function resolveColumn(source: ColumnSource, names: string[] | null): number | { missing: string } | null {
  if (source.name !== undefined) {
    const at = names ? names.indexOf(source.name) : -1;
    if (at >= 0) return at;
    // Without a header the names are the indices ("0", "1", …).
    if (!names && /^\d+$/u.test(source.name)) return Number(source.name);
    return { missing: source.name };
  }
  if (source.index !== undefined) return source.index;
  return null;
}
