/**
 * Stage 2 of the axis pipeline: the coordinates of each plot, in data units.
 * Pure: reads the AST and the plot model only.
 */
import type { AddPlotStatement, PlotTableInput, Span } from "../ast/types.js";
import { expandForeachList } from "../foreach/list.js";
import { compilePgfMathExpression, type PgfMathDeclaredFunction, type PgfMathTrigFormat } from "../semantic/pgfmath/evaluator.js";
import { readInlineTable, type InlineTableColumnSeparator } from "./inline-table.js";
import { readPgfFloat, readPgfNumber, stripBraces, type PlotModel } from "./model.js";

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
export function collectPlotData(statement: AddPlotStatement, plot: PlotModel, source: string, expand: (text: string) => string = (text) => text, env: PlotMathEnvironment = DEFAULT_MATH_ENVIRONMENT): PlotData {
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
    return sampleExpressions(null, expand(input.expression), plot, input.expressionSpan, env);
  }
  if (input.kind === "parametric") {
    const [xc, yc, ...rest] = input.components;
    if (!xc || !yc || rest.length > 0) return { kind: "unsupported", reason: "parametric plots other than (x expr, y expr)", span: input.span };
    return sampleExpressions(expand(stripBraces(xc.raw)), expand(stripBraces(yc.raw)), plot, input.span, env);
  }
  return { kind: "unsupported", reason: `\`${input.name}\` input`, span: input.nameSpan };
}

/** `1`, `-2.5e3`, `inf`, `nan`; a braced pgfmath expression is evaluated (float mode, as pgfplots reads coordinates). */
function readCoordinateNumber(raw: string): number | null {
  const text = raw.trim();
  if (/^[-+]?(?:inf|infty)$/iu.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
  if (/^[-+]?nan$/iu.test(text)) return Number.NaN;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(text)) return Number(text);
  if (text.startsWith("{")) return readPgfFloat(text);
  // Unbraced math (`2*3`, an expanded `\h*8`); text that pgfmath cannot read stays symbolic.
  if (/^[-+*/^().\d\sA-Za-z]+$/u.test(text) && /[\d(]/u.test(text)) return readPgfFloat(text);
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

/** What plot expressions see: functions from `declare function`, the trig format (`trig format plots` applied by the caller). */
export type PlotMathEnvironment = {
  functions?: ReadonlyMap<string, PgfMathDeclaredFunction>;
  trigFormat: PgfMathTrigFormat;
};

const DEFAULT_MATH_ENVIRONMENT: PlotMathEnvironment = { trigFormat: "deg" };

/**
 * The sample positions of an expression plot: `samples at` (a `\foreach`
 * list) when given, else `samples` equally spaced values over `domain`,
 * both ends included (manual pgfplots.reference.axis-addplot.tex; behaviour M).
 */
export function samplePositions(plot: PlotModel): number[] | { error: string } {
  if (plot.samplesAt !== undefined) {
    let entries: string[];
    try {
      entries = expandForeachList(plot.samplesAt, { parseExpressions: true });
    } catch {
      return { error: `samples at={${plot.samplesAt}}` };
    }
    const values: number[] = [];
    for (const entry of entries) {
      const value = readPgfNumber(entry);
      if (value === null) return { error: `samples at entry \`${entry}\`` };
      values.push(value);
    }
    return values;
  }
  const domain = plot.domain ?? DEFAULT_DOMAIN;
  const samples = plot.samples ?? DEFAULT_SAMPLES;
  const out: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    out.push(samples === 1 ? domain.from : i === samples - 1 ? domain.to : domain.from + ((domain.to - domain.from) * i) / (samples - 1));
  }
  return out;
}

type CompiledComponent = (x: number) => number | { error: string };

/**
 * Compiles one coordinate expression for float evaluation (pgfplots
 * samples with the fpu; manual: "Starting with version 1.2, \addplot
 * expression uses a floating point unit"). The variable is bound both as
 * the constant `x` and as the macro `\x` (manual: "it is the same whether
 * you write \x or just x"). Errors at a sample give NaN/±Infinity as fpu
 * does; only errors of the expression as a whole are reported.
 */
function compileComponent(expression: string, variable: string, env: PlotMathEnvironment): CompiledComponent | { error: string } {
  const compiled = compilePgfMathExpression(expression, {
    mode: "float",
    trigFormat: env.trigFormat,
    ...(env.functions ? { functions: env.functions } : {}),
    variables: [variable, `\\${variable}`]
  });
  if (!compiled.ok) return { error: compiled.message };
  const fn = compiled.fn;
  return (x) => {
    const result = fn([x, x]);
    if (typeof result === "number") return result;
    if (result.code === "division-by-zero" || result.code === "invalid-domain" || result.code === "overflow" || result.code === "non-numeric-result") return Number.NaN;
    return { error: result.message };
  };
}

/** `\addplot {expr}` and `\addplot ({x expr},{y expr})`. */
function sampleExpressions(xExpression: string | null, yExpression: string, plot: PlotModel, span: Span, env: PlotMathEnvironment): PlotData {
  const positions = samplePositions(plot);
  if (!Array.isArray(positions)) return { kind: "unsupported", reason: positions.error, span };
  const fy = compileComponent(yExpression, plot.variable, env);
  if (typeof fy !== "function") return { kind: "unsupported", reason: `expression \`${yExpression}\` (${fy.error})`, span };
  let fx: CompiledComponent | null = null;
  if (xExpression !== null) {
    const compiled = compileComponent(xExpression, plot.variable, env);
    if (typeof compiled !== "function") return { kind: "unsupported", reason: `expression \`${xExpression}\` (${compiled.error})`, span };
    fx = compiled;
  }
  const points: PlotPoint[] = [];
  for (const t of positions) {
    const y = fy(t);
    if (typeof y !== "number") return { kind: "unsupported", reason: `expression \`${yExpression}\` (${y.error})`, span };
    const x = fx ? fx(t) : t;
    if (typeof x !== "number") return { kind: "unsupported", reason: `expression \`${xExpression ?? ""}\` (${x.error})`, span };
    points.push({ x, y, jump: false });
  }
  return { kind: "points", points };
}

/**
 * Coordinate filters and unbounded coordinates (manual coordfiltering.tex,
 * 2dplots.tex `unbounded coords`): `restrict x to domain` maps values
 * outside [min, max] to ∓inf (the starred form clamps them); then with
 * `unbounded coords=discard` (initial) points with a non-finite
 * coordinate are dropped and the line joins their neighbours, and with
 * `jump` the line is interrupted there.
 */
export function filterPlotPoints(points: readonly PlotPoint[], plot: PlotModel): PlotPoint[] {
  const out: PlotPoint[] = [];
  let pendingJump = false;
  for (const point of points) {
    let { x, y } = point;
    for (const filter of plot.restrict) {
      const v = filter.axis === "x" ? x : y;
      let w = v;
      if (Number.isFinite(v)) {
        if (v < filter.min) w = filter.truncate ? filter.min : -Infinity;
        else if (v > filter.max) w = filter.truncate ? filter.max : Infinity;
      }
      if (filter.axis === "x") x = w; else y = w;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (plot.unboundedCoords === "jump") pendingJump = true;
      continue;
    }
    out.push({ x, y, jump: point.jump || pendingJump });
    pendingJump = false;
  }
  return out;
}
