/**
 * The data grid of one plot (the inspector's Edit Data… panel): what the
 * grid shows for a plot's input, and the edits it makes. Every edit changes
 * only the text it names (one coordinate component, one table cell, one row)
 * through the readers' spans, so comments, line breaks and the rest of the
 * source keep their text; a new row copies the separator its neighbours use.
 * One grid action is one source change, so one undo step (a paste included).
 *
 * - `coordinates {…}` (design/pgfplots.md section 8, the per-point spans):
 *   columns x, y, then the first error part (`+- (ex,ey)` …) and `[meta]`
 *   when any point has them. Symbolic x values are text; a new category is
 *   added to the axis' `symbolic x coords` in the same edit (behaviour X1:
 *   a name not in the list stops TeX), refused when the list comes from a
 *   style. A value TeX would split (a comma, parentheses) is written in
 *   braces, as `{2*pi}` is; braced expressions stay as written.
 * - inline `table {…}` (behaviour V): the header (when there is one) and the
 *   cells, by the table's own `col sep`/`row sep`; renaming a column also
 *   renames it in the plot's `x=`/`y=` and `\thisrow{…}`.
 * - `\addplot table {\macro}` from `\pgfplotstableread{…}\macro`: the same
 *   grid on the read statement's data; every plot of that table changes.
 * - file tables are read-only here (the web shell cannot write files, and
 *   the desktop shell does not write user data files in this version);
 *   expression plots have no grid (their fields are in the inspector).
 */
import type { AddPlotStatement, AxisStatement, PgfplotsTableReadStatement, PlotCoordinatePoint, Span, Statement } from "../../ast/types.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { readInlineTable, type InlineTableColumnSeparator, type InlineTableReading, type InlineTableRow } from "../../pgfplots/inline-table.js";
import { parseAxisPlotId } from "../../pgfplots/edit-ids.js";
import { EMPTY_FRAGMENT, userText } from "../fragment.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import type { EditActionResultLike } from "../result-types.js";
import { findAxisStatement } from "./axis-actions.js";
import { applyReplacements, type Replacement } from "./legend-edits.js";

export type PlotDataColumn = { id: string; label: string; editable: boolean };

export type PlotDataGrid =
  | {
      kind: "coordinates" | "table";
      columns: PlotDataColumn[];
      rows: string[][];
      /** Inline table: the header row is editable (renaming a column). */
      headerEditable: boolean;
      /** Shown above the grid (a shared `\pgfplotstableread` table, …). */
      note?: string;
      /** For a symbolic x axis: the categories, in order. */
      categories?: string[];
    }
  | { kind: "readonly"; reason: string; rows: string[][]; columns: PlotDataColumn[] }
  | { kind: "none"; reason: string };

export type PlotDataChange =
  | { type: "set"; row: number; column: number; value: string }
  /** A block of values at (row, column), rows past the end added. */
  | { type: "paste"; row: number; column: number; values: string[][] }
  /** A new row at `at` (0 = first), with the given values or a copy of a neighbour. */
  | { type: "insertRow"; at: number; values?: string[] }
  | { type: "deleteRows"; rows: number[] }
  /** Inline table header: rename column `column`. */
  | { type: "renameColumn"; column: number; name: string };

function plain(key: string): string {
  return normalizeOptionKey(key).replace(/^\/pgfplots\//u, "").replace(/^table\//u, "");
}

function stripBraces(raw: string): string {
  let text = raw.trim();
  while (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim();
  return text;
}

function kvValue(entries: readonly OptionEntry[] | undefined, key: string): string | null {
  let value: string | null = null;
  for (const entry of entries ?? []) {
    if (entry.kind === "kv" && plain(entry.key) === key) value = stripBraces(entry.valueRaw);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Locating the data.

type Located =
  | { kind: "coordinates"; axis: AxisStatement; plot: AddPlotStatement; points: PlotCoordinatePoint[]; body: Span }
  | { kind: "table"; axis: AxisStatement; plot: AddPlotStatement; dataSpan: Span; options: TableFormat; shared?: { macro: string; users: number } }
  | { kind: "readonly"; reason: string; axis: AxisStatement; plot: AddPlotStatement }
  | { kind: "none"; reason: string };

type TableFormat = { columnSeparator: InlineTableColumnSeparator; rowSeparator: "newline" | "\\\\"; header: boolean | "auto" };

function tableFormat(lists: ReadonlyArray<OptionListAst | undefined>): TableFormat | { unsupported: string } {
  const entries = lists.flatMap((list) => list?.entries ?? []);
  const separators: Record<string, InlineTableColumnSeparator> = { space: "space", tab: "tab", comma: "comma", colon: "colon", semicolon: "semicolon", "&": "ampersand", ampersand: "ampersand" };
  const col = kvValue(entries, "col sep");
  const row = kvValue(entries, "row sep");
  const header = kvValue(entries, "header");
  const columnSeparator = col === null ? "space" : separators[col];
  if (!columnSeparator) return { unsupported: `\`col sep=${col ?? ""}\`` };
  if (row !== null && row !== "newline" && row !== "\\\\" && row !== "crcr") return { unsupported: `\`row sep=${row}\`` };
  if (header !== null && header !== "true" && header !== "false") return { unsupported: `\`header=${header}\`` };
  for (const key of ["skip first n", "comment chars", "ignore chars", "white space chars", "trim cells", "format"]) {
    if (kvValue(entries, key) !== null) return { unsupported: `\`${key}\`` };
  }
  return { columnSeparator, rowSeparator: row === null || row === "newline" ? "newline" : "\\\\", header: header === null ? "auto" : header === "true" };
}

function* walkStatements(statements: readonly Statement[]): Generator<Statement> {
  for (const statement of statements) {
    yield statement;
    if (statement.kind === "Scope") yield* walkStatements(statement.body);
    if (statement.kind === "Axis") yield* walkStatements(statement.body.filter((item): item is Statement => "kind" in item && item.kind !== "AddPlot" && item.kind !== "AddLegendEntry" && item.kind !== "AddLegendImage" && item.kind !== "Legend" && item.kind !== "PgfplotsExtra" && item.kind !== "AxisScopeBegin" && item.kind !== "AxisScopeEnd"));
  }
}

function* walkPlots(statements: readonly Statement[]): Generator<AddPlotStatement> {
  for (const statement of statements) {
    if (statement.kind === "Axis") for (const item of statement.body) if (item.kind === "AddPlot") yield item;
    if (statement.kind === "Scope") yield* walkPlots(statement.body);
  }
}

function locate(source: string, plotId: string, parseOptions: EditParseOptions): Located {
  const ref = parseAxisPlotId(plotId);
  if (!ref) return { kind: "none", reason: "Select a plot to see its data." };
  const parsed = parseTikzForEdit(source, parseOptions);
  const axis = findAxisStatement(parsed.figure.body, ref.axisId);
  const plot = axis?.body.find((item): item is AddPlotStatement => item.kind === "AddPlot" && item.id === plotId);
  if (!axis || !plot) return { kind: "none", reason: "The plot was not found." };
  const input = plot.input;
  if (plot.dimension === 3) return { kind: "readonly", reason: "3D plot data is read-only.", axis, plot };
  if (input.kind === "coordinates") {
    if (input.unparsed.length > 0) return { kind: "readonly", reason: "Part of the coordinate list could not be read. Edit it in Source.", axis, plot };
    return { kind: "coordinates", axis, plot, points: input.points, body: input.bodySpan };
  }
  if (input.kind === "expression" || input.kind === "parametric") return { kind: "none", reason: "Expression plots have no data table." };
  if (input.kind !== "table") return { kind: "none", reason: "This plot has no data table." };
  const axisTableLists = (axis.options?.entries ?? []).filter((entry) => entry.kind === "kv" && /^(?:\/pgfplots\/)?table\//u.test(entry.key.trim()));
  if (axisTableLists.length > 0) return { kind: "readonly", reason: "The axis sets table options. Edit the table in Source.", axis, plot };
  if (input.source.kind === "file") return { kind: "readonly", reason: `The data is in the file \`${input.source.name}\`.`, axis, plot };
  if (input.source.kind === "inline") {
    if (!input.source.terminated) return { kind: "readonly", reason: "The table is not closed.", axis, plot };
    const format = tableFormat([input.options]);
    if ("unsupported" in format) return { kind: "readonly", reason: `Unsupported table option: ${format.unsupported}.`, axis, plot };
    return { kind: "table", axis, plot, dataSpan: input.source.span, options: format };
  }
  // `\pgfplotstableread{…}\macro`: the read statement's data, shared by every plot of that table.
  const macro = input.source.name;
  const read = [...walkStatements(parsed.figure.body)].filter((statement): statement is PgfplotsTableReadStatement => statement.kind === "PgfplotsTableRead" && statement.macroName === macro).at(-1);
  if (!read) return { kind: "readonly", reason: `The table \`${macro}\` is read outside this picture.`, axis, plot };
  if (!/[\n]|\\\\/u.test(read.dataRaw)) return { kind: "readonly", reason: `The table \`${macro}\` is read from the file \`${read.dataRaw.trim()}\`.`, axis, plot };
  const format = tableFormat([read.options, input.options]);
  if ("unsupported" in format) return { kind: "readonly", reason: `Unsupported table option: ${format.unsupported}.`, axis, plot };
  const users = [...walkPlots(parsed.figure.body)].filter((other) => other.input.kind === "table" && other.input.source.kind === "macro" && other.input.source.name === macro).length;
  return { kind: "table", axis, plot, dataSpan: read.dataSpan, options: format, shared: { macro, users } };
}

function readTable(source: string, located: Extract<Located, { kind: "table" }>): InlineTableReading {
  return readInlineTable(source, located.dataSpan.from, located.dataSpan.to, { columnSeparator: located.options.columnSeparator, rowSeparator: located.options.rowSeparator, header: located.options.header });
}

// ---------------------------------------------------------------------------
// The grid.

type CoordinateLayout = { errors: number; meta: boolean };

function coordinateLayout(points: readonly PlotCoordinatePoint[]): CoordinateLayout {
  const errors = Math.max(0, ...points.map((point) => point.errors[0]?.components.length ?? 0));
  return { errors, meta: points.some((point) => point.meta !== undefined) };
}

function symbolicCategories(axis: AxisStatement): string[] | null {
  const value = kvValue(axis.options?.entries, "symbolic x coords");
  return value === null ? null : value.split(",").map((name) => name.trim()).filter((name) => name.length > 0);
}

/** What the grid shows for a plot. */
export function readPlotDataGrid(source: string, plotId: string, parseOptions: EditParseOptions = {}): PlotDataGrid {
  const located = locate(source, plotId, parseOptions);
  if (located.kind === "none") return located;
  if (located.kind === "readonly") return { kind: "readonly", reason: located.reason, rows: [], columns: [] };
  if (located.kind === "coordinates") {
    const layout = coordinateLayout(located.points);
    const operator = located.points.find((point) => point.errors[0])?.errors[0]?.kind ?? "+-";
    const columns: PlotDataColumn[] = [
      { id: "x", label: "x", editable: true },
      { id: "y", label: "y", editable: true },
      ...Array.from({ length: layout.errors }, (_, index): PlotDataColumn => ({ id: `error${String(index)}`, label: `${operator} ${index === 0 ? "x" : index === 1 ? "y" : String(index)}`, editable: true })),
      ...(layout.meta ? [{ id: "meta", label: "meta", editable: true }] : [])
    ];
    const rows = located.points.map((point) => [
      point.components[0]?.raw ?? "",
      point.components[1]?.raw ?? "",
      ...Array.from({ length: layout.errors }, (_, index) => point.errors[0]?.components[index]?.raw ?? ""),
      ...(layout.meta ? [point.meta?.raw ?? ""] : [])
    ]);
    const categories = symbolicCategories(located.axis);
    return { kind: "coordinates", columns, rows, headerEditable: false, ...(categories ? { categories } : {}) };
  }
  const reading = readTable(source, located);
  const width = Math.max(reading.header?.cells.length ?? 0, ...reading.rows.map((row) => row.cells.length));
  const columns = Array.from({ length: width }, (_, index): PlotDataColumn => ({ id: `c${String(index)}`, label: reading.header?.cells[index]?.raw ?? String(index), editable: true }));
  const rows = reading.rows.map((row) => Array.from({ length: width }, (_, index) => row.cells[index]?.raw ?? ""));
  const note = located.shared ? `Table \`${located.shared.macro}\` is used by ${String(located.shared.users)} plot${located.shared.users === 1 ? "" : "s"}.` : undefined;
  return { kind: "table", columns, rows, headerEditable: reading.header !== undefined, ...(note ? { note } : {}) };
}

// ---------------------------------------------------------------------------
// Edits.

type Edit = { span: Span; text: string };

/** A coordinate component as TeX reads it: commas and parentheses need braces. */
function coordinateText(value: string): string {
  const text = value.trim();
  if (text.startsWith("{") && text.endsWith("}")) return text;
  return /[,()[\]]/u.test(text) ? `{${text}}` : text;
}

/** A table cell: a separator inside it needs braces (behaviour V: braces group a cell). */
function cellText(value: string, separator: InlineTableColumnSeparator): string {
  const text = value.trim();
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const needs = separator === "space" ? /\s/u.test(text) : text.includes({ tab: "\t", comma: ",", colon: ":", semicolon: ";", ampersand: "&" }[separator]);
  return needs || text.includes("\\\\") ? `{${text}}` : text;
}

function lineIndent(source: string, at: number): string {
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/u.exec(source.slice(lineStart, at))?.[0] ?? "";
}

class Refusal extends Error {}

/** The text between two rows or points, without a comment in it (a copied separator must not copy a comment). */
function cleanGap(gap: string): string {
  if (!gap.includes("%")) return gap;
  const lastBreak = gap.lastIndexOf("\n");
  return lastBreak >= 0 ? `\n${gap.slice(lastBreak + 1)}` : " ";
}

function coordinateEdits(source: string, located: Extract<Located, { kind: "coordinates" }>, change: PlotDataChange): Edit[] {
  const { points, axis } = located;
  const layout = coordinateLayout(points);
  const edits: Edit[] = [];
  const categories = symbolicCategories(axis);
  const newCategories: string[] = [];
  const checkCategory = (value: string) => {
    const text = value.trim();
    if (text.length === 0 || Number.isFinite(Number(text)) || text.startsWith("{")) return;
    if (categories === null) {
      if (points.some((point) => !Number.isFinite(Number(point.components[0]?.raw)))) {
        throw new Refusal("The `symbolic x coords` list is not in the axis options.");
      }
      return;
    }
    if (!categories.includes(text) && !newCategories.includes(text)) newCategories.push(text);
  };
  const setCell = (point: PlotCoordinatePoint, column: number, value: string) => {
    if (column <= 1) {
      const component = point.components[column];
      if (!component) throw new Refusal("This coordinate has no such component.");
      if (column === 0) checkCategory(value);
      if (value.trim().length === 0) throw new Refusal("A coordinate cannot be empty.");
      edits.push({ span: component.span, text: coordinateText(value) });
      return;
    }
    const errorIndex = column - 2;
    if (errorIndex < layout.errors) {
      const component = point.errors[0]?.components[errorIndex];
      if (!component) throw new Refusal("This point has no error value.");
      edits.push({ span: component.span, text: coordinateText(value) });
      return;
    }
    if (layout.meta) {
      if (!point.meta) throw new Refusal("This point has no meta value.");
      edits.push({ span: { from: point.meta.bracketSpan.from + 1, to: point.meta.bracketSpan.to - 1 }, text: value.trim() });
      return;
    }
    throw new Refusal("No such column.");
  };
  const newPoint = (values: readonly string[]) => {
    const [x = "", y = ""] = values;
    if (x.trim().length === 0 || y.trim().length === 0) throw new Refusal("A new point needs an x and a y value.");
    checkCategory(x);
    return `(${coordinateText(x)},${coordinateText(y)})`;
  };
  /** Insert points before index `at`, with the separator the neighbours use. */
  const insertAt = (at: number, texts: readonly string[]) => {
    if (texts.length === 0) return;
    const next = points[at];
    const previous = points[at - 1];
    if (next) {
      const gap = cleanGap(previous ? source.slice(previous.span.to, next.span.from) : at + 1 < points.length ? source.slice(next.span.to, points[at + 1]?.span.from ?? next.span.to) : " ");
      edits.push({ span: { from: next.span.from, to: next.span.from }, text: texts.map((text) => `${text}${gap}`).join("") });
    } else if (previous) {
      const before = points[at - 2];
      const gap = cleanGap(before ? source.slice(before.span.to, previous.span.from) : " ");
      edits.push({ span: { from: previous.span.to, to: previous.span.to }, text: texts.map((text) => `${gap}${text}`).join("") });
    } else {
      edits.push({ span: { from: located.body.to, to: located.body.to }, text: texts.join(" ") });
    }
  };
  switch (change.type) {
    case "set": {
      const point = points[change.row];
      if (!point) throw new Refusal("No such row.");
      setCell(point, change.column, change.value);
      break;
    }
    case "paste": {
      const appended: string[] = [];
      change.values.forEach((values, offset) => {
        const point = points[change.row + offset];
        if (point) values.forEach((value, index) => { if (change.column + index < 2 + layout.errors + (layout.meta ? 1 : 0)) setCell(point, change.column + index, value); });
        else if (change.column === 0) appended.push(newPoint(values));
        else throw new Refusal("New rows need an x value.");
      });
      insertAt(points.length, appended);
      break;
    }
    case "insertRow": {
      const neighbour = points[Math.min(change.at, points.length - 1)] ?? points[change.at - 1];
      const values = change.values ?? (neighbour ? [neighbour.components[0]?.raw ?? "0", neighbour.components[1]?.raw ?? "0"] : ["0", "0"]);
      insertAt(Math.max(0, Math.min(change.at, points.length)), [newPoint(values)]);
      break;
    }
    case "deleteRows": {
      const doomed = new Set(change.rows);
      if (doomed.size >= points.length) throw new Refusal("A plot needs at least one point.");
      for (const index of [...doomed].sort((a, b) => a - b)) {
        const point = points[index];
        if (!point) continue;
        // The point with the separator before it (or after it, for the first point).
        const previous = points[index - 1];
        const next = points[index + 1];
        if (previous && !doomed.has(index - 1)) edits.push({ span: { from: previous.span.to, to: point.span.to }, text: "" });
        else if (next) edits.push({ span: { from: point.span.from, to: next.span.from }, text: "" });
        else if (previous) edits.push({ span: { from: previous.span.to, to: point.span.to }, text: "" });
      }
      break;
    }
    case "renameColumn":
      throw new Refusal("Coordinate columns cannot be renamed.");
  }
  if (newCategories.length > 0) {
    const entry = (axis.options?.entries ?? []).filter((candidate): candidate is Extract<OptionEntry, { kind: "kv" }> => candidate.kind === "kv" && plain(candidate.key) === "symbolic x coords").at(-1);
    if (!entry?.valueSpan) throw new Refusal("The `symbolic x coords` list is not in the axis options.");
    const inner = { from: entry.valueSpan.from, to: entry.valueSpan.to };
    const raw = source.slice(inner.from, inner.to);
    const closing = raw.trimEnd().endsWith("}") ? inner.from + raw.trimEnd().length - 1 : inner.to;
    edits.push({ span: { from: closing, to: closing }, text: `,${newCategories.join(",")}` });
  }
  return edits;
}

function tableEdits(source: string, located: Extract<Located, { kind: "table" }>, change: PlotDataChange): Edit[] {
  const reading = readTable(source, located);
  const { rows } = reading;
  const separator = located.options.columnSeparator;
  const edits: Edit[] = [];
  const width = Math.max(reading.header?.cells.length ?? 0, ...rows.map((row) => row.cells.length));
  const setCell = (row: InlineTableRow, column: number, value: string) => {
    const cell = row.cells[column];
    if (!cell) throw new Refusal("This row has no such cell.");
    if (value.trim().length === 0) throw new Refusal("A cell cannot be empty. Use `nan` for a missing value.");
    edits.push({ span: cell.span, text: cellText(value, separator) });
  };
  const joinOf = (row: InlineTableRow | undefined) => {
    const [first, second] = row?.cells ?? [];
    if (first && second) return source.slice(first.span.to, second.span.from);
    return separator === "space" ? " " : { tab: "\t", comma: ",", colon: ":", semicolon: ";", ampersand: "&" }[separator];
  };
  const rowText = (values: readonly string[], like: InlineTableRow | undefined) => {
    const cells = Array.from({ length: width }, (_, index) => values[index] ?? "");
    if (cells.some((cell) => cell.trim().length === 0)) throw new Refusal(`A new row needs ${String(width)} values.`);
    return cells.map((cell) => cellText(cell, separator)).join(joinOf(like));
  };
  /** Rows inserted before row `at`, each followed by the text between two rows (newline, indent, `\\`). */
  const insertAt = (at: number, texts: readonly string[]) => {
    if (texts.length === 0) return;
    const next = rows[at];
    const previous = rows[at - 1] ?? reading.header;
    const gapBetween = (a: InlineTableRow | undefined, b: InlineTableRow | undefined) => (a && b ? cleanGap(source.slice(a.span.to, b.span.from)) : null);
    const gap = gapBetween(previous, next) ?? gapBetween(rows[rows.length - 2] ?? reading.header, rows[rows.length - 1])
      ?? (located.options.rowSeparator === "\\\\" ? ` \\\\\n${lineIndent(source, (previous ?? next)?.span.from ?? located.dataSpan.from)}` : `\n${lineIndent(source, (previous ?? next)?.span.from ?? located.dataSpan.from)}`);
    if (next && previous !== undefined && previous !== reading.header) edits.push({ span: { from: next.span.from, to: next.span.from }, text: texts.map((text) => `${text}${gap}`).join("") });
    else if (next) edits.push({ span: { from: next.span.from, to: next.span.from }, text: texts.map((text) => `${text}${gap}`).join("") });
    else if (previous) {
      // After the last row: its own row separator (`\\`) comes first when the table uses one.
      const after = source.slice(previous.span.to, located.dataSpan.to);
      const trailingSep = located.options.rowSeparator === "\\\\" ? /^\s*\\\\/u.exec(after)?.[0] ?? "" : "";
      const at = previous.span.to + trailingSep.length;
      const lineGap = gap.replace(/^\s*\\\\/u, "");
      const closing = located.options.rowSeparator === "\\\\" && trailingSep ? " \\\\" : "";
      edits.push({ span: { from: at, to: at }, text: texts.map((text) => `${lineGap}${text}${closing}`).join("") });
    } else throw new Refusal("The table has no rows.");
  };
  switch (change.type) {
    case "set": {
      const row = rows[change.row];
      if (!row) throw new Refusal("No such row.");
      setCell(row, change.column, change.value);
      break;
    }
    case "paste": {
      const appended: string[] = [];
      change.values.forEach((values, offset) => {
        const row = rows[change.row + offset];
        if (row) values.forEach((value, index) => { if (change.column + index < width) setCell(row, change.column + index, value); });
        else if (change.column === 0) appended.push(rowText(values, rows.at(-1)));
        else throw new Refusal("New rows need every value.");
      });
      insertAt(rows.length, appended);
      break;
    }
    case "insertRow": {
      const neighbour = rows[Math.min(change.at, rows.length - 1)];
      const values = change.values ?? neighbour?.cells.map((cell) => cell.raw) ?? [];
      insertAt(Math.max(0, Math.min(change.at, rows.length)), [rowText(values, neighbour)]);
      break;
    }
    case "deleteRows": {
      const doomed = [...new Set(change.rows)].sort((a, b) => a - b);
      if (doomed.length >= rows.length) throw new Refusal("A table needs at least one row.");
      for (const index of doomed) {
        const row = rows[index];
        if (!row) continue;
        // The whole line of the row (with its `\\`), so comment lines around it stay.
        const lineStart = source.lastIndexOf("\n", row.span.from - 1) + 1;
        let end = row.span.to;
        if (located.options.rowSeparator === "\\\\") {
          const sep = /^\s*\\\\/u.exec(source.slice(end, located.dataSpan.to));
          if (sep) end += sep[0].length;
        }
        const lineEnd = source.indexOf("\n", end);
        // The rest of the line may hold the row's own comment: it goes with the row.
        const rest = lineEnd < 0 ? "" : source.slice(end, lineEnd).trim();
        const ownLine = source.slice(lineStart, row.span.from).trim().length === 0 && (lineEnd < 0 || rest.length === 0 || rest.startsWith("%"));
        if (ownLine && lineEnd >= 0 && lineEnd < located.dataSpan.to) edits.push({ span: { from: lineStart, to: lineEnd + 1 }, text: "" });
        else edits.push({ span: { from: row.span.from, to: end }, text: "" });
      }
      break;
    }
    case "renameColumn": {
      const header = reading.header;
      const cell = header?.cells[change.column];
      if (!header || !cell) throw new Refusal("The table has no header row.");
      const name = change.name.trim();
      if (name.length === 0 || /[\s{}\\]/u.test(name)) throw new Refusal("A column name is one word without braces or backslashes.");
      if (header.cells.some((other, index) => index !== change.column && other.raw === name)) throw new Refusal(`The table already has a column \`${name}\`.`);
      const old = cell.raw;
      edits.push({ span: cell.span, text: name });
      // The plot's own references: `x=old`, `y=old`, `\thisrow{old}` in `x expr`/`y expr`.
      const references = located.plot.input.kind === "table" ? located.plot.input.options?.entries ?? [] : [];
      for (const entry of references) {
        if (entry.kind !== "kv" || !entry.valueSpan) continue;
        const key = plain(entry.key);
        if ((key === "x" || key === "y" || key === "meta" || key === "y error" || key === "x error") && stripBraces(entry.valueRaw) === old) {
          const raw = source.slice(entry.valueSpan.from, entry.valueSpan.to);
          const offset = raw.indexOf(old);
          edits.push({ span: { from: entry.valueSpan.from + offset, to: entry.valueSpan.from + offset + old.length }, text: name });
        } else {
          const raw = source.slice(entry.valueSpan.from, entry.valueSpan.to);
          for (const match of raw.matchAll(/\\thisrow\{([^{}]*)\}/gu)) {
            if (match[1]?.trim() !== old) continue;
            const from = entry.valueSpan.from + match.index + "\\thisrow{".length;
            edits.push({ span: { from, to: from + match[1].length }, text: name });
          }
        }
      }
      if (located.shared) throw new Refusal(`The table \`${located.shared.macro}\` is shared by several plots.`);
      break;
    }
  }
  return edits;
}

/** Applies one grid change: one source change, one undo step. */
export function applyEditPlotDataAction(source: string, plotId: string, change: PlotDataChange, parseOptions: EditParseOptions = {}): EditActionResultLike {
  const located = locate(source, plotId, parseOptions);
  if (located.kind === "none" || located.kind === "readonly") return { kind: "unsupported", reason: located.reason };
  let edits: Edit[];
  try {
    edits = located.kind === "coordinates" ? coordinateEdits(source, located, change) : tableEdits(source, located, change);
  } catch (error) {
    if (error instanceof Refusal) return { kind: "unsupported", reason: error.message };
    throw error;
  }
  const effective = edits.filter((edit) => source.slice(edit.span.from, edit.span.to) !== edit.text);
  if (effective.length === 0) return { kind: "unsupported", reason: "The data would not change." };
  const sorted = [...effective].sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);
  for (let index = 1; index < sorted.length; index += 1) {
    if ((sorted[index]?.span.from ?? 0) < (sorted[index - 1]?.span.to ?? 0)) return { kind: "unsupported", reason: "These changes overlap." };
  }
  const replacements: Replacement[] = sorted.map((edit) => ({ span: edit.span, fragment: edit.text.length > 0 ? userText(edit.text, "inspector-value") : EMPTY_FRAGMENT }));
  const applied = applyReplacements(source, replacements);
  return { kind: "success", newSource: applied.source, patches: applied.patches, changedSourceIds: [located.axis.id], selectedSourceIds: [plotId] };
}
