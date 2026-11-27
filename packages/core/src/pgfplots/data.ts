/**
 * Stage 2 of the axis pipeline: the coordinates of each plot, in data units.
 * Pure: reads the AST and the plot model only.
 */
import type { AddPlotStatement, PlotTableInput, Span } from "../ast/types.js";
import { evaluatePgfMathExpression } from "../semantic/pgfmath/evaluator.js";
import { readInlineTable, type InlineTableColumnSeparator } from "./inline-table.js";
import { readPgfNumber, stripBraces, type PlotModel } from "./model.js";

export type PlotPoint = {
  x: number;
  y: number;
  /** An empty line precedes the point: the plot jumps here (compat 1.4+). */
  jump: boolean;
};

export type PlotData =
  | { kind: "points"; points: PlotPoint[] }
  | { kind: "unsupported"; reason: string; span: Span };

/** Default `domain` and `samples` of expression plots (manual: -5:5, 25). */
export const DEFAULT_DOMAIN = { from: -5, to: 5 };
export const DEFAULT_SAMPLES = 25;

/** `expand` expands macros in coordinate and table text (identity when there are none). */
export function collectPlotData(statement: AddPlotStatement, plot: PlotModel, source: string, expand: (text: string) => string = (text) => text): PlotData {
  const input = statement.input;
  if (statement.dimension === 3) return { kind: "unsupported", reason: "\\addplot3 (3D plots)", span: statement.commandSpan };
  if (input.kind === "coordinates") {
    const points: PlotPoint[] = [];
    for (const point of input.points) {
      const [xRaw, yRaw] = point.components;
      if (!xRaw || !yRaw || point.components.length > 2) {
        return { kind: "unsupported", reason: "coordinates other than (x,y)", span: point.span };
      }
      const x = readCoordinateNumber(expand(xRaw.raw));
      const y = readCoordinateNumber(expand(yRaw.raw));
      if (x === null || y === null) {
        return { kind: "unsupported", reason: `non-numeric coordinate \`(${xRaw.raw},${yRaw.raw})\` (symbolic coordinates)`, span: point.span };
      }
      points.push({ x, y, jump: point.afterEmptyLine });
    }
    if (input.unparsed.length > 0) {
      const first = input.unparsed[0];
      if (first) return { kind: "unsupported", reason: `unreadable coordinate text \`${first.raw.trim()}\``, span: first.span };
    }
    return { kind: "points", points };
  }
  if (input.kind === "table") return collectTable(input, source);
  if (input.kind === "expression") {
    return sampleExpression(expand(input.expression), plot, input.expressionSpan);
  }
  if (input.kind === "parametric") return { kind: "unsupported", reason: "parametric expression plots", span: input.span };
  return { kind: "unsupported", reason: `\`${input.name}\` input`, span: input.nameSpan };
}

/** `1`, `-2.5e3`, `inf`, `nan`; a braced pgfmath expression is evaluated. */
function readCoordinateNumber(raw: string): number | null {
  const text = raw.trim();
  if (/^[-+]?(?:inf|infty)$/iu.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  if (/^nan$/iu.test(text)) return Number.NaN;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(text)) return Number(text);
  if (text.startsWith("{")) return readPgfNumber(text);
  return null;
}

function tableOption(input: PlotTableInput, names: readonly string[]): { value: string; span: Span } | undefined {
  let found: { value: string; span: Span } | undefined;
  for (const entry of input.options?.entries ?? []) {
    if (entry.kind !== "kv") continue;
    const key = entry.key.replace(/^\/pgfplots\/table\//u, "").replace(/^table\//u, "").trim();
    if (names.includes(key)) found = { value: stripBraces(entry.valueRaw), span: entry.span };
  }
  return found;
}

const SEPARATORS: Record<string, InlineTableColumnSeparator> = {
  space: "space", tab: "tab", comma: "comma", colon: "colon", semicolon: "semicolon", ampersand: "ampersand"
};

const KNOWN_TABLE_KEYS = new Set(["x", "y", "x index", "y index", "col sep", "header", "row sep"]);

function collectTable(input: PlotTableInput, source: string): PlotData {
  if (input.source.kind !== "inline") {
    return { kind: "unsupported", reason: input.source.kind === "file" ? `table from file \`${input.source.name}\`` : `table from macro \`${input.source.name}\``, span: input.source.span };
  }
  for (const entry of input.options?.entries ?? []) {
    const key = entry.kind === "unknown" ? entry.raw : entry.key.replace(/^\/pgfplots\/table\//u, "").replace(/^table\//u, "").trim();
    if (!KNOWN_TABLE_KEYS.has(key)) return { kind: "unsupported", reason: `table option \`${key}\``, span: entry.span };
  }
  const colSep = tableOption(input, ["col sep"]);
  const separator = colSep ? SEPARATORS[colSep.value] : "space";
  if (!separator) return { kind: "unsupported", reason: `col sep=${colSep?.value ?? ""}`, span: colSep?.span ?? input.span };
  const header = tableOption(input, ["header"]);
  const rowSep = tableOption(input, ["row sep"]);
  const reading = readInlineTable(source, input.source.span.from, input.source.span.to, {
    columnSeparator: separator,
    ...(header ? { header: header.value === "true" ? true : header.value === "false" ? false : "auto" } : {}),
    ...(rowSep?.value === "\\\\" || rowSep?.value === "crcr" ? { rowSeparator: "\\\\" } : {})
  });
  const names = reading.header?.cells.map((cell) => stripBraces(cell.raw)) ?? [];
  const column = (axis: "x" | "y"): number | string => {
    const index = tableOption(input, [`${axis} index`]);
    const named = tableOption(input, [axis]);
    if (named) {
      const at = names.indexOf(named.value);
      return at >= 0 ? at : `no column named \`${named.value}\``;
    }
    if (index) {
      const n = Number(index.value);
      return Number.isInteger(n) && n >= 0 ? n : `bad ${axis} index \`${index.value}\``;
    }
    return axis === "x" ? 0 : 1;
  };
  const xColumn = column("x");
  const yColumn = column("y");
  if (typeof xColumn === "string") return { kind: "unsupported", reason: xColumn, span: input.span };
  if (typeof yColumn === "string") return { kind: "unsupported", reason: yColumn, span: input.span };
  const points: PlotPoint[] = [];
  for (const row of reading.rows) {
    const xCell = row.cells[xColumn];
    const yCell = row.cells[yColumn];
    if (!xCell || !yCell) return { kind: "unsupported", reason: "table row without the selected columns", span: row.span };
    const x = readCoordinateNumber(xCell.raw);
    const y = readCoordinateNumber(yCell.raw);
    if (x === null || y === null) return { kind: "unsupported", reason: `non-numeric table cell in \`${source.slice(row.span.from, row.span.to).trim()}\``, span: row.span };
    points.push({ x, y, jump: row.afterEmptyLine });
  }
  return { kind: "points", points };
}

/**
 * `\addplot {expr}`: `samples` equally spaced values of `x` over `domain`
 * (manual: domain -5:5, samples 25), the expression evaluated by pgfmath
 * (trigonometry in degrees, PGF's default).
 */
function sampleExpression(expression: string, plot: PlotModel, span: Span): PlotData {
  const domain = plot.domain ?? DEFAULT_DOMAIN;
  const samples = plot.samples ?? DEFAULT_SAMPLES;
  const points: PlotPoint[] = [];
  for (let i = 0; i < samples; i += 1) {
    const x = samples === 1 ? domain.from : domain.from + ((domain.to - domain.from) * i) / (samples - 1);
    const substituted = substituteVariable(expression, x);
    if (substituted === null) return { kind: "unsupported", reason: `expression \`${expression}\``, span };
    const result = evaluatePgfMathExpression(substituted);
    if (!result.ok) {
      if (result.code === "division-by-zero" || result.code === "invalid-domain") {
        points.push({ x, y: Number.NaN, jump: false });
        continue;
      }
      return { kind: "unsupported", reason: `expression \`${expression}\` (${result.message})`, span };
    }
    points.push({ x, y: result.quantity.value, jump: false });
  }
  return { kind: "points", points };
}

/** Replaces the variable `x` (or `\x`) by a parenthesised number; identifiers containing x are left alone. */
function substituteVariable(expression: string, x: number): string | null {
  const value = `(${x.toPrecision(17)})`;
  if (/\\(?!x\b)[A-Za-z]+/u.test(expression)) return null;
  return expression.replace(/\\x\b/gu, value).replace(/(?<![A-Za-z_])x(?![A-Za-z_])/gu, value);
}
