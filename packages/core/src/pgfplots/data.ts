/**
 * Stage 2 of the axis pipeline: the coordinates of each plot, in data units.
 * Pure: reads the AST, the plot model and what the host supplies through
 * `PlotDataIo` (table files, tables read by `\pgfplotstableread`).
 */
import type { AddPlotStatement, PlotTableInput, Span } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import { expandForeachList } from "../foreach/list.js";
import { compilePgfMathExpression, type PgfMathDeclaredFunction, type PgfMathTrigFormat } from "../semantic/pgfmath/evaluator.js";
import { readPgfFloat, readPgfNumber, stripBraces, type PlotFilter, type PlotModel } from "./model.js";
import { compileTableExpression, type CompiledTableExpression } from "./table-expr.js";
import { applyTableKeys, defaultTableSettings, readTableNumber, readTableText, resolveColumn, type ColumnSource, type TableSettings } from "./table.js";

export type PlotPoint = {
  x: number;
  y: number;
  /** An empty line precedes the point: the plot jumps here (compat 1.4+). */
  jump: boolean;
  /** `[meta]` or the table's `meta` column, as written (stored for later use: scatter, nodes near coords). */
  meta?: string;
  /** Explicit error values from `+- (ex,ey)` or table error columns: plus/minus amounts per direction. */
  error?: { xPlus?: number; xMinus?: number; yPlus?: number; yMinus?: number };
};

/** A table file as the host could provide it (design open question: file-backed tables). */
export type TableFileRead =
  | { status: "resolved"; text: string }
  /** The document has a folder the editor reads, but the file is not there. */
  | { status: "missing" }
  /** The editor cannot read the document's folder at all (browser, unsaved document). */
  | { status: "unavailable" };

/** A table read by `\pgfplotstableread[options]{data}\macro`. */
export type ReadTableMacro = { data: string; offset: number; inline: boolean; options: OptionEntry[] };

export type PlotDataIo = {
  /** `table/…` keys in effect before the table's own options: settings, axis options, plot options, in order. */
  tableKeys: readonly OptionEntry[];
  readFile: (name: string) => TableFileRead;
  tableMacro: (name: string) => ReadTableMacro | null;
  /** `symbolic x coords` / `symbolic y coords` of the axis (behaviour X1): a name reads as its position. */
  symbolic?: { x?: readonly string[]; y?: readonly string[] };
};

export type PlotData =
  | { kind: "points"; points: PlotPoint[]; notes?: PlotDataNote[] }
  | { kind: "unsupported"; reason: string; span: Span }
  /** The input is fine but its data cannot be read (a missing file): diagnosed by its own code. */
  | { kind: "unavailable"; code: string; message: string; span: Span };

/** Things worth a diagnostic that do not stop the plot (unknown table keys). */
export type PlotDataNote = { code: string; message: string; span: Span };

/** Default `domain` and `samples` of expression plots (manual: -5:5, 25). */
export const DEFAULT_DOMAIN = { from: -5, to: 5 };
export const DEFAULT_SAMPLES = 25;

const NO_IO: PlotDataIo = { tableKeys: [], readFile: () => ({ status: "unavailable" }), tableMacro: () => null };

/** `expand` expands macros in coordinate and table text (identity when there are none). */
export function collectPlotData(statement: AddPlotStatement, plot: PlotModel, source: string, expand: (text: string) => string = (text) => text, env: PlotMathEnvironment = DEFAULT_MATH_ENVIRONMENT, io: PlotDataIo = NO_IO): PlotData {
  const input = statement.input;
  if (statement.dimension === 3) return { kind: "unsupported", reason: "`\\addplot3`", span: statement.commandSpan };
  let raw: PlotData;
  if (input.kind === "coordinates") raw = collectCoordinates(statement, expand, io.symbolic ?? {});
  else if (input.kind === "table") raw = collectTable(input, source, plot, io, expand);
  else if (input.kind === "expression") raw = sampleExpressions(null, expand(input.expression), plot, input.expressionSpan, env);
  else if (input.kind === "parametric") {
    const [xc, yc, ...rest] = input.components;
    if (!xc || !yc || rest.length > 0) return { kind: "unsupported", reason: "this parametric form", span: input.span };
    raw = sampleExpressions(expand(stripBraces(xc.raw)), expand(stripBraces(yc.raw)), plot, input.span, env);
  }
  else return { kind: "unsupported", reason: `\`${input.name}\` input`, span: input.nameSpan };
  if (raw.kind !== "points") return raw;
  if (input.kind !== "table") {
    const filtered = applyFilters(raw.points.map((point, index) => ({ point, coordindex: index, lineno: index, cells: [] })), plot, null);
    if (filtered.kind !== "points") return filtered;
    return { ...raw, points: normalizeUnbounded(filtered.points, plot.unboundedCoords) };
  }
  return { ...raw, points: normalizeUnbounded(raw.points, plot.unboundedCoords) };
}

/** X1: a symbolic coordinate is its position in the list; a name not in it is a TeX error. */
function symbolicIndex(raw: string, names: readonly string[] | undefined): number | null {
  if (!names) return null;
  const at = names.indexOf(raw.trim().replace(/^\{([\s\S]*)\}$/u, "$1").trim());
  return at >= 0 ? at : null;
}

function collectCoordinates(statement: AddPlotStatement, expand: (text: string) => string, symbolic: NonNullable<PlotDataIo["symbolic"]>): PlotData {
  const input = statement.input;
  if (input.kind !== "coordinates") throw new Error("coordinates expected");
  const points: PlotPoint[] = [];
  for (const point of input.points) {
    const [xRaw, yRaw] = point.components;
    if (!xRaw || !yRaw || point.components.length > 2) {
      return { kind: "unsupported", reason: "coordinates with more than x and y", span: point.span };
    }
    const x = symbolic.x ? symbolicIndex(expand(xRaw.raw), symbolic.x) : readCoordinateNumber(expand(xRaw.raw));
    const y = symbolic.y ? symbolicIndex(expand(yRaw.raw), symbolic.y) : readCoordinateNumber(expand(yRaw.raw));
    if (x === null || y === null) {
      const missing = (symbolic.x !== undefined && x === null) || (symbolic.y !== undefined && y === null);
      return { kind: "unsupported", reason: missing ? `coordinate \`(${xRaw.raw},${yRaw.raw})\` outside the symbolic coordinate list (TeX stops: "the input coordinate has not been defined")` : `non-numeric coordinate \`(${xRaw.raw},${yRaw.raw})\` (symbolic coordinates without \`symbolic x coords\`)`, span: point.span };
    }
    const entry: PlotPoint = { x, y, jump: point.afterEmptyLine };
    if (point.meta) entry.meta = point.meta.raw;
    if (point.errors.length > 0) {
      const error: NonNullable<PlotPoint["error"]> = {};
      for (const part of point.errors) {
        const ex = readCoordinateNumber(expand(part.components[0]?.raw ?? "0")) ?? 0;
        const ey = readCoordinateNumber(expand(part.components[1]?.raw ?? "0")) ?? 0;
        // `+-` both sides, `+=` upper, `-=` lower (manual errorbars.tex).
        if (part.kind !== "-=") { error.xPlus = ex; error.yPlus = ey; }
        if (part.kind !== "+=") { error.xMinus = ex; error.yMinus = ey; }
      }
      entry.error = error;
    }
    points.push(entry);
  }
  if (input.unparsed.length > 0) {
    const first = input.unparsed[0];
    if (first) return { kind: "unsupported", reason: `unreadable coordinate text \`${first.raw.trim()}\``, span: first.span };
  }
  return { kind: "points", points };
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

/**
 * V4 (manual `unbounded coords`, E17 `nan-*`): an unbounded coordinate
 * (`nan`, `±inf`, or a filtered point) removes the point; with
 * `unbounded coords=jump` the line also jumps over it. Limits never see it.
 */
export function normalizeUnbounded(points: readonly PlotPoint[], mode: "discard" | "jump"): PlotPoint[] {
  const out: PlotPoint[] = [];
  let pendingJump = false;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (mode === "jump") pendingJump = true;
      continue;
    }
    out.push(pendingJump || point.jump ? { ...point, jump: true } : point);
    pendingJump = false;
  }
  return out;
}

type FilterRow = { point: PlotPoint; coordindex: number; lineno: number; cells: readonly number[] };

/**
 * The documented coordinate filters, in the order given (coordfiltering.tex):
 * `each nth point` keeps `\coordindex` 0, n, 2n, … (E17 `each-nth`);
 * `skip coords between index={b}{e}` drops b ≤ i < e; `restrict x/y/expr to
 * domain` sets x (or y) to ±inf outside [min, max] (the starred forms clamp
 * x, or y, to the bound instead; E17 `restrict-expr*`).
 */
function applyFilters(rows: readonly FilterRow[], plot: PlotModel, names: readonly string[] | null): PlotData & { kind: "points" } | PlotData {
  if (plot.filters.length === 0) return { kind: "points", points: rows.map((row) => row.point) };
  const compiled = new Map<PlotFilter, CompiledTableExpression>();
  for (const filter of plot.filters) {
    if (filter.kind === "restrict expr") {
      const c = compileTableExpression(filter.expr, names);
      if (!c.ok) return { kind: "unsupported", reason: `\`restrict expr to domain\` expression \`${filter.expr}\` (${c.message})`, span: filter.span };
      compiled.set(filter, c);
    }
  }
  const points = rows.map((row) => {
    const point = { ...row.point };
    for (const filter of plot.filters) {
      if (filter.kind === "each nth point") {
        if (row.coordindex % filter.n !== 0) point.x = Number.NaN;
      } else if (filter.kind === "skip coords between index") {
        if (row.coordindex >= filter.from && row.coordindex < filter.to) point.x = Number.NaN;
      } else {
        let value: number;
        if (filter.kind === "restrict expr") {
          const c = compiled.get(filter);
          value = c?.ok ? c.evaluate({ cells: row.cells, coordindex: row.coordindex, lineno: row.lineno }) : Number.NaN;
        } else value = filter.axis === "x" ? point.x : point.y;
        const target = filter.kind === "restrict expr" ? "x" : filter.axis;
        if (Number.isNaN(value)) continue;
        if (value < filter.min) point[target] = filter.clamp ? filter.min : -Infinity;
        else if (value > filter.max) point[target] = filter.clamp ? filter.max : Infinity;
      }
    }
    return point;
  });
  return { kind: "points", points };
}

const TABLE_UNREADABLE = "pgfplots-table-file-unavailable";

/** Table input (behaviour V): inline rows, a file through the host, or a table read by `\pgfplotstableread`. */
function collectTable(input: PlotTableInput, source: string, plot: PlotModel, io: PlotDataIo, expand: (text: string) => string): PlotData {
  const settings: TableSettings = defaultTableSettings();
  const notes: PlotDataNote[] = [];
  const note = (problems: ReturnType<typeof applyTableKeys>): void => {
    for (const problem of problems) {
      notes.push({
        code: problem.reason === "unsupported" ? `unsupported-pgfplots-key:table/${problem.key}` : `invalid-pgfplots-value:table/${problem.key}`,
        message: problem.reason === "unsupported" ? `Table key \`${problem.key}\` is not supported yet.` : `Cannot read \`${problem.key}=${problem.value}\`.`,
        span: problem.span
      });
    }
  };
  // A table read by \pgfplotstableread keeps the format it was read with; later format keys only select columns.
  const macroSource = input.source.kind === "macro";
  note(applyTableKeys(settings, macroSource ? io.tableKeys.filter((entry) => entry.kind !== "unknown" && /^(?:\/pgfplots\/)?table\/(?:x|y|meta)(?: |$)/u.test(entry.key.trim())) : io.tableKeys, false));
  let text: string;
  let offset: number;
  let inline: boolean;
  const tableSource = input.source;
  if (tableSource.kind === "inline") {
    text = tableSource.raw;
    offset = tableSource.span.from;
    inline = true;
  } else if (tableSource.kind === "file") {
    const name = expand(tableSource.name).trim();
    const read = io.readFile(name);
    if (read.status !== "resolved") {
      return {
        kind: "unavailable",
        code: TABLE_UNREADABLE,
        message: read.status === "missing"
          ? `Table file \`${name}\` was not found.`
          : `Table file \`${name}\` cannot be read here. Save the document first.`,
        span: tableSource.span
      };
    }
    text = read.text;
    offset = 0;
    inline = false;
  } else {
    const table = io.tableMacro(tableSource.name);
    if (!table) {
      return { kind: "unsupported", reason: `undefined table \`${tableSource.name}\``, span: tableSource.span };
    }
    note(applyTableKeys(settings, table.options, true));
    if (table.inline) {
      text = table.data;
      offset = table.offset;
      inline = true;
    } else {
      const read = io.readFile(table.data.trim());
      if (read.status !== "resolved") {
        return {
          kind: "unavailable",
          code: TABLE_UNREADABLE,
          message: `Table file \`${table.data.trim()}\` ${read.status === "missing" ? "was not found" : "cannot be read here"}.`,
          span: tableSource.span
        };
      }
      text = read.text;
      offset = 0;
      inline = false;
    }
  }
  note(applyTableKeys(settings, input.options?.entries ?? [], true));
  for (const n of notes) if (n.code.startsWith("unsupported-pgfplots-key:table/")) {
    // A selector key the reader does not know may change which data is plotted: do not guess.
    if (/table\/(?:x|y|z)(?: |$)/u.test(n.code)) return { kind: "unsupported", reason: `table option \`${n.code.slice("unsupported-pgfplots-key:table/".length)}\``, span: n.span };
  }
  const table = readTableText(text, offset, inline, settings);
  const names = table.names;
  type Getter = (cells: readonly number[], coordindex: number, lineno: number) => number;
  const getter = (letter: "x" | "y", sourceSpec: ColumnSource): Getter | string => {
    if (sourceSpec.expr !== undefined) {
      const compiled = compileTableExpression(expand(sourceSpec.expr), names);
      if (!compiled.ok) return `\`${letter} expr=${sourceSpec.expr}\` (${compiled.message})`;
      return (cells, coordindex, lineno) => compiled.evaluate({ cells, coordindex, lineno });
    }
    const column = resolveColumn(sourceSpec, names);
    if (column === null) return `no ${letter} column`;
    if (typeof column !== "number") return `the table has no column \`${column.missing}\``;
    return (cells) => cells[column] ?? Number.NaN;
  };
  const xColumn = settings.x.expr === undefined ? resolveColumn(settings.x, names) : null;
  const yColumn = settings.y.expr === undefined ? resolveColumn(settings.y, names) : null;
  const getX = getter("x", settings.x);
  const getY = getter("y", settings.y);
  if (typeof getX === "string") return { kind: "unsupported", reason: getX, span: input.span };
  if (typeof getY === "string") return { kind: "unsupported", reason: getY, span: input.span };
  const errorGetters: Array<[keyof NonNullable<PlotPoint["error"]>, Getter]> = [];
  for (const [key, spec] of Object.entries(settings.errors)) {
    const g = getter(key.startsWith("x") ? "x" : "y", spec);
    if (typeof g === "string") return { kind: "unsupported", reason: `error column ${g}`, span: input.span };
    const field = key === "x plus" ? "xPlus" : key === "x minus" ? "xMinus" : key === "y plus" ? "yPlus" : "yMinus";
    errorGetters.push([field, g]);
  }
  const metaColumn = settings.meta && settings.meta.expr === undefined ? resolveColumn(settings.meta, names) : null;
  const filterRows: FilterRow[] = [];
  // A cell missing from a short row keeps the value of the row before (E17 `short-row`).
  let previous: number[] = [];
  const width = names?.length ?? 0;
  for (let coordindex = 0; coordindex < table.rows.length; coordindex += 1) {
    const row = table.rows[coordindex];
    if (!row) continue;
    const count = Math.max(width, row.cells.length, previous.length);
    const cells = Array.from({ length: count }, () => Number.NaN);
    for (let i = 0; i < count; i += 1) {
      const cell = row.cells[i];
      cells[i] = cell === undefined ? previous[i] ?? Number.NaN : readTableNumber(cell);
    }
    previous = cells;
    const point: PlotPoint = { x: getX(cells, coordindex, row.lineno), y: getY(cells, coordindex, row.lineno), jump: row.afterEmptyLine };
    if (io.symbolic?.x && typeof xColumn === "number") point.x = symbolicIndex(row.cells[xColumn] ?? "", io.symbolic.x) ?? Number.NaN;
    if (io.symbolic?.y && typeof yColumn === "number") point.y = symbolicIndex(row.cells[yColumn] ?? "", io.symbolic.y) ?? Number.NaN;
    if (typeof metaColumn === "number") {
      const meta = row.cells[metaColumn];
      if (meta !== undefined) point.meta = meta;
    }
    if (errorGetters.length > 0) {
      const error: NonNullable<PlotPoint["error"]> = {};
      for (const [field, g] of errorGetters) error[field] = g(cells, coordindex, row.lineno);
      point.error = error;
    }
    filterRows.push({ point, coordindex, lineno: row.lineno, cells });
  }
  const tableFilters = settings.eachNthPoint !== undefined ? { ...plot, filters: [{ kind: "each nth point" as const, n: settings.eachNthPoint, span: input.span }, ...plot.filters] } : plot;
  const filtered = applyFilters(filterRows, tableFilters, names);
  if (filtered.kind !== "points") return filtered;
  return notes.length > 0 ? { kind: "points", points: filtered.points, notes } : { kind: "points", points: filtered.points };
}

/** What plot expressions see: functions from `declare function`, the trig format (`trig format plots` applied by the caller). */
export type PlotMathEnvironment = {
  functions?: ReadonlyMap<string, PgfMathDeclaredFunction>;
  trigFormat: PgfMathTrigFormat;
  /** The x direction is logarithmic: `domain` is sampled logarithmically (manual axis-addplot.tex; behaviour Z11). */
  logSamples?: boolean;
};

const DEFAULT_MATH_ENVIRONMENT: PlotMathEnvironment = { trigFormat: "deg" };

/**
 * The sample positions of an expression plot: `samples at` (a `\foreach`
 * list) when given, else `samples` equally spaced values over `domain`,
 * both ends included (manual pgfplots.reference.axis-addplot.tex; behaviour M).
 */
export function samplePositions(plot: PlotModel, logSamples = false): number[] | { error: string } {
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
  // Manual axis-addplot.tex: "If the x-axis is logarithmic, samples will be drawn logarithmically"
  // (equal steps of ln x; measured: domain 0.1:10, 5 samples gives 0.1, 0.316, 1, 3.16, 10).
  const log = logSamples && domain.from > 0 && domain.to > 0;
  const a = log ? Math.log(domain.from) : domain.from; const b = log ? Math.log(domain.to) : domain.to;
  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? a : i === samples - 1 ? b : a + ((b - a) * i) / (samples - 1);
    out.push(i === 0 || samples === 1 ? domain.from : i === samples - 1 ? domain.to : log ? Math.exp(t) : t);
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
  const positions = samplePositions(plot, env.logSamples === true);
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
    out.push({ ...point, x, y, jump: point.jump || pendingJump });
    pendingJump = false;
  }
  return out;
}
