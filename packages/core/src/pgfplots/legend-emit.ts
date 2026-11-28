/**
 * Emission of an axis legend (behaviour L). The axis evaluator supplies the
 * impure services (node evaluation, style resolution, marks); this module
 * decides what is drawn where.
 *
 * - Text cells are TikZ nodes `\node[<cells>,<nodes>,<entry options>]{text}`
 *   evaluated in a frame whose font is the legend's (`every axis legend`'s
 *   `font`, `text`), as inside the matrix.
 * - The matrix itself is a TikZ node of the legend's shape and style whose
 *   text box is the cell grid: `minimum width` = grid width + 2 inner xsep,
 *   `text height`/`text depth` = the grid's height above / depth below the
 *   last row's origin, so its anchors (`base` included) are TikZ's.
 */
import type { AxisStatement, Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionListAst } from "../options/types.js";
import type { NodeGeometryProbe, SemanticContextFrame } from "../semantic/context.js";
import type { PlotMarkPrimitive } from "../semantic/path/plot-marks.js";
import type { ResolvedStyle, SceneElement } from "../semantic/types.js";
import { plotHandlerCommands } from "./plot-handlers.js";
import { cloneStyleRegistry, expandPgfplotsOptions, type PgfplotsKeyUse, type PgfplotsStyleRegistry } from "./keys.js";
import type { Box, LabelGeometry, LabelRequest, Point } from "./layout.js";
import { collectLegendEntries, layoutMatrix, legendGrid, legendImageBox, legendPairs, LEGEND_IMAGE_BUILDERS, type LegendImageGeometry, type MatrixCell } from "./legend.js";
import { legendEntryText, readLength, readPgfNumber, splitTopLevelList, stripBraces, LEGEND_POSITIONS, type AxisModel, type LegendEntryText, type PlotModel } from "./model.js";

export type LocalCommand = { kind: "M" | "L"; to: Point } | { kind: "C"; c1: Point; c2: Point; to: Point } | { kind: "Z" };

export type LegendImageSource = { plot: PlotModel; sourceId: string; span: Span };

export type LegendMarks = { style: ResolvedStyle; primitives: Array<Extract<PlotMarkPrimitive, { kind: "path" }>> };

export type LegendHost = {
  axis: AxisStatement;
  model: AxisModel;
  /** Images in order: every `\addplot` that is not `forget plot`, and `\addlegendimage`. */
  images: LegendImageSource[];
  diagnostics: Diagnostic[];
  /** The plot path style of an image (plot style, then `every legend image post`). */
  pathStyle: (plot: PlotModel, legendKeys: readonly PgfplotsKeyUse[]) => ResolvedStyle;
  marks: (plot: PlotModel, base: ResolvedStyle) => LegendMarks | null;
  /** A child frame of the axis frame with the given TikZ keys applied to its style (the legend's font). */
  frameWith: (uses: readonly PgfplotsKeyUse[]) => SemanticContextFrame;
  /** Evaluates a node request in `frame`; with `emit` false only measures. */
  node: (request: LabelRequest, frame: SemanticContextFrame, emit: boolean) => { elements: SceneElement[]; probe: NodeGeometryProbe | null; geometry: LabelGeometry | null };
  /** A path element from local-coordinate commands. */
  path: (sourceId: string, itemId: string, style: ResolvedStyle, span: Span, commands: LocalCommand[]) => SceneElement;
  /** Final axis box (local coordinates) and the map to world. */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Resolves `at` of the legend (a TikZ coordinate inside the axis) to local coordinates, or null. */
  resolvePoint: (raw: string) => Point | null;
  expand: (text: string) => string;
};

export type LegendResult = {
  elements: SceneElement[];
  /** Bounding box contribution (local coordinates). */
  bbox: Box | null;
  probe: NodeGeometryProbe | null;
  text: string;
  /** The matrix' text box (content left edge on the baseline, size): what TeX boxes as the node text. */
  textBox: { origin: Point; width: number; height: number; depth: number };
  /** Each drawn entry node, in paint order. */
  entries: Array<{ index: number; probe: NodeGeometryProbe | null; text: string; row: number; column: number }>;
  /** The anchor the legend node is placed by (editing). */
  anchor: string;
};

/** Keys of `every axis legend` that belong to the matrix layout rather than the legend node. */
const MATRIX_KEYS = new Set(["cells", "nodes", "column sep", "row sep", "at", "anchor", "matrix anchor", "legend columns", "legend cell align", "legend pos", "legend plot pos"]);
/** Keys that also reach the cells (TikZ applies them to the matrix' contents). */
const CASCADING_KEYS = new Set(["font", "text", "text opacity", "color"]);
/** Line width set on the legend reaches the images drawn inside it (b-sep: `thick` legend, 0.8pt images). */
const IMAGE_KEYS = new Set(["line width", "ultra thin", "very thin", "thin", "semithick", "thick", "very thick", "ultra thick"]);

type LegendStyle = {
  node: PgfplotsKeyUse[];
  cascade: PgfplotsKeyUse[];
  image: PgfplotsKeyUse[];
  cells: OptionListAst[];
  nodes: OptionListAst[];
  at: string;
  anchor: string;
  columnSep: number;
  rowSep: number;
  innerXSep: number;
  columnStyles: PgfplotsStyleRegistry;
  columns?: number;
  plotPos?: "left" | "right" | "none";
};

function styleValue(value: string | null): OptionListAst {
  return parseOptionListRaw(`[${stripBraces(value ?? "")}]`);
}

function readLegendStyle(model: AxisModel): LegendStyle {
  const registry = cloneStyleRegistry(model.styles);
  for (const name of ["every odd column", "every even column", "every odd row", "every even row"]) registry.set(name, []);
  const style: LegendStyle = { node: [], cascade: [], image: [], cells: [], nodes: [], at: "(0.98,0.98)", anchor: "north east", columnSep: 0, rowSep: 0, innerXSep: 0.3333 * 10, columnStyles: registry };
  expandPgfplotsOptions(registry.get("every axis legend") ?? [], registry, (use) => {
    const { key, value } = use;
    if (key === "cells") style.cells.push(styleValue(value));
    else if (key === "nodes") style.nodes.push(styleValue(value));
    else if (key === "at") style.at = stripBraces(value ?? "");
    else if (key === "anchor") style.anchor = stripBraces(value ?? "");
    else if (key === "column sep") style.columnSep = readLength(value ?? "") ?? style.columnSep;
    else if (key === "row sep") style.rowSep = readLength(value ?? "") ?? style.rowSep;
    else if (key === "legend columns") { const n = readPgfNumber(value ?? ""); if (n !== null) style.columns = n; }
    else if (key === "legend plot pos") { const t = stripBraces(value ?? ""); if (t === "left" || t === "right" || t === "none") style.plotPos = t; }
    else if (key === "legend cell align") { const t = stripBraces(value ?? ""); style.cells.push(parseOptionListRaw(`[anchor=${t === "left" ? "west" : t === "right" ? "east" : "center"}]`)); }
    else if (key === "legend pos") {
      const pos = LEGEND_POSITIONS[stripBraces(value ?? "")];
      const parsed = pos ? /^at=\{(.*)\},anchor=(.*)$/u.exec(pos) : null;
      if (parsed) { style.at = parsed[1] ?? style.at; style.anchor = parsed[2] ?? style.anchor; }
    } else {
      if (!MATRIX_KEYS.has(key)) style.node.push(use);
      if (CASCADING_KEYS.has(key)) style.cascade.push(use);
      // The line width reaches the images and the entry nodes (their outer sep: legend-entries-key).
      if (IMAGE_KEYS.has(key)) { style.image.push(use); style.cascade.push(use); }
      if (key === "inner sep" || key === "inner xsep") style.innerXSep = readLength(value ?? "") ?? style.innerXSep;
    }
  }, {});
  return style;
}

/** `column sep` set by `every odd/even column` (TikZ matrix): it separates that column from the next. */
function columnSepAfter(style: LegendStyle, column: number): number {
  const name = column % 2 === 1 ? "every odd column" : "every even column";
  let sep = style.columnSep;
  expandPgfplotsOptions(style.columnStyles.get(name) ?? [], cloneStyleRegistry(style.columnStyles), (use) => {
    if (use.key === "column sep") sep = readLength(use.value ?? "") ?? sep;
  });
  return sep;
}

const CELL_STYLE_SKIP = new Set(["column sep", "row sep"]);
function columnCellStyle(style: LegendStyle, column: number): OptionListAst[] {
  const name = column % 2 === 1 ? "every odd column" : "every even column";
  const uses: string[] = [];
  expandPgfplotsOptions(style.columnStyles.get(name) ?? [], cloneStyleRegistry(style.columnStyles), (use) => {
    if (!CELL_STYLE_SKIP.has(use.key)) uses.push(use.value === null ? use.key : `${use.key}=${use.value}`);
  });
  return uses.length > 0 ? [parseOptionListRaw(`[${uses.join(",")}]`)] : [];
}

function legendTexts(host: LegendHost): LegendEntryText[] {
  return axisLegendEntries(host).entries;
}

/** The legend entries of an axis with their origins (L4), as the legend draws them. */
export function axisLegendEntries(host: Pick<LegendHost, "axis" | "model" | "expand">): { entries: LegendEntryText[]; commands: boolean } {
  return collectLegendEntries(host.axis.body, host.model.legend, {
    addLegendEntry: (item) => ({ text: host.expand(item.text), options: item.options ? item.options.entries.map((e) => e.raw).join(",") : "", span: item.span, textSpan: item.textSpan, keep: true }),
    legend: (item) => {
      const raws = item.entries.map((entry) => entry.raw);
      let list = raws;
      if (item.delimiter === "," && raws.some((raw) => raw.trim() === "...")) list = expandDots(raws);
      // Editing keeps a span per item when the list was not expanded (no dots).
      return list.map((raw, i) => ({ ...legendEntryText(host.expand(raw), item.span), ...(list === raws && item.entries[i] ? { textSpan: item.entries[i].span } : {}) }));
    }
  });
}

/** `\legend{1,2,...,5}`: the `\foreach` dots for numbers (manual `\legend`). */
function expandDots(raws: readonly string[]): string[] {
  const out: string[] = [];
  raws.forEach((raw, i) => {
    if (raw.trim() !== "...") { out.push(raw); return; }
    const a = Number(raws[i - 2]); const b = Number(raws[i - 1]); const end = Number(raws[i + 1]);
    if (![a, b, end].every(Number.isFinite) || b === a) return;
    const step = b - a;
    for (let v = b + step; step > 0 ? v < end - 1e-9 : v > end + 1e-9; v += step) out.push(String(Number(v.toFixed(10))));
  });
  return out;
}

export function emitLegend(host: LegendHost): LegendResult | null {
  const { model } = host;
  const texts = legendTexts(host);
  if (texts.length === 0) return null;
  if (model.legend.toName !== undefined) {
    host.diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-key:legend to name", message: "`legend to name` stores the legend for `\\ref`; it is not drawn in the axis (as in TeX), and `\\ref` legends are not rendered by this editor.", span: host.axis.optionsSpan ?? host.axis.beginSpan });
    return null;
  }
  const style = readLegendStyle(model);
  const legendModel = { ...model.legend, ...(style.columns !== undefined ? { columns: style.columns } : {}), ...(style.plotPos ? { plotPos: style.plotPos } : {}) };
  const pairs = legendPairs(texts, host.images.length, legendModel);
  if (pairs.length === 0) return null;
  const grid = legendGrid(pairs, legendModel);
  const frame = host.frameWith(style.cascade);
  const warned = new Set<string>();

  type Cell = { kind: "text"; request: LabelRequest; box: Box } | { kind: "image"; source: LegendImageSource; geometry: LegendImageGeometry; pathStyle: ResolvedStyle; marks: LegendMarks | null; box: Box | null };
  let entryIndex = 0;
  const cellRows: Cell[][] = grid.map((row) => row.flatMap((pair): Cell[] => {
    const index = entryIndex;
    entryIndex += 1;
    const cellsOptions = (column: number) => [...style.cells, ...columnCellStyle(style, column), ...style.nodes, ...(pair.entry.options ? [parseOptionListRaw(`[${pair.entry.options}]`)] : [])];
    const textCell = (column: number): Cell => {
      const request: LabelRequest = { role: "legend-entry", tickPosition: index, text: pair.entry.text, styles: cellsOptions(column), placement: "", at: { x: 0, y: 0 }, ...(pair.entry.textSpan ? { textSpan: pair.entry.textSpan } : {}) };
      const measured = host.node(request, frame, false).geometry;
      const box = measured ? measured.border : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      return { kind: "text", request, box };
    };
    const imageCell = (source: LegendImageSource): Cell => {
      const kind = source.plot.legendImage;
      const builder = LEGEND_IMAGE_BUILDERS[kind];
      if (!builder) {
        if (!warned.has(kind)) {
          warned.add(kind);
          host.diagnostics.push({ severity: "warning", code: `unsupported-pgfplots-key:${kind}`, message: `Legend images of \`${kind}\` are not drawn yet; the legend shows the entry without its image.`, span: source.span });
        }
        return { kind: "image", source, geometry: { pieces: [] }, pathStyle: host.pathStyle(source.plot, style.image), marks: null, box: null };
      }
      const pathStyle = host.pathStyle(source.plot, style.image);
      const marks = source.plot.mark === null ? null : host.marks(source.plot, pathStyle);
      const geometry = builder({ onlyMarks: source.plot.onlyMarks, hasMarks: marks !== null });
      const stroked = !!pathStyle.stroke && pathStyle.stroke !== "none";
      const extent = marks ? primitivesBox(marks.primitives) : null;
      return { kind: "image", source, geometry, pathStyle, marks, box: legendImageBox(geometry, stroked, pathStyle.lineWidth, extent) };
    };
    const plotPos = legendModel.plotPos;
    const source = host.images[pair.image];
    // TikZ numbers matrix columns from 1: images and texts alternate.
    const firstColumn = row.indexOf(pair) * (plotPos === "none" ? 1 : 2) + 1;
    if (plotPos === "none" || !source) return [textCell(firstColumn)];
    return plotPos === "left" ? [imageCell(source), textCell(firstColumn + 1)] : [textCell(firstColumn), imageCell(source)];
  }));

  // An empty picture (empty legend) counts as a zero box at its origin (pgfmodulematrix).
  const matrixCells: MatrixCell[][] = cellRows.map((row) => row.map((cell) => cell.box ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }));
  const columns = Math.max(0, ...matrixCells.map((r) => r.length));
  const seps = Array.from({ length: columns }, (_, c) => (c === 0 ? 0 : columnSepAfter(style, c)));
  const matrix = layoutMatrix(matrixCells, seps, style.rowSep);

  // The legend node.
  const at = host.resolvePoint(style.at);
  if (!at) {
    host.diagnostics.push({ severity: "warning", code: "invalid-pgfplots-value:legend style", message: `Cannot read the legend position \`at=${style.at}\`; the legend is not drawn.`, span: host.axis.optionsSpan ?? host.axis.beginSpan });
    return null;
  }
  const nodeKeys = style.node.map((use) => (use.value === null ? use.key : `${use.key}=${use.value}`));
  const boxRequest: LabelRequest = {
    role: "legend", text: "", styles: nodeKeys.length > 0 ? [parseOptionListRaw(`[${nodeKeys.join(",")}]`)] : [],
    placement: `minimum width=${String(matrix.width + 2 * style.innerXSep)}pt,text height=${String(matrix.height)}pt,text depth=${String(matrix.depth)}pt,anchor=${style.anchor}`,
    at
  };
  const legendNode = host.node(boxRequest, frame, true);
  if (!legendNode.probe || !legendNode.geometry) return null;
  const probe = legendNode.probe;
  const center = legendNode.geometry.anchors.center ?? at;
  const base = legendNode.geometry.anchors.base ?? center;
  const left = center.x - matrix.width / 2;
  const elements: SceneElement[] = [...legendNode.elements];
  const visibleText: string[] = [];
  const entryRecords: LegendResult["entries"] = [];
  cellRows.forEach((row, r) => { row.forEach((cell, c) => {
    const origin = matrix.origins[r]?.[c];
    if (!origin) return;
    const o = { x: left + origin.x, y: base.y + origin.y };
    if (cell.kind === "text") {
      const drawnEntry = host.node({ ...cell.request, at: o }, frame, true);
      elements.push(...drawnEntry.elements);
      entryRecords.push({ index: cell.request.tickPosition ?? 0, probe: drawnEntry.probe, text: cell.request.text, row: r + 1, column: c + 1 });
      visibleText.push(cell.request.text);
      return;
    }
    elements.push(...imageElements(host, cell.source, cell.geometry, cell.pathStyle, cell.marks, o, `${String(r)}-${String(c)}`));
  }); });
  const drawn = legendNode.geometry.border;
  const lineWidth = (legendNode.elements[0]?.style.stroke && legendNode.elements[0].style.stroke !== "none") ? legendNode.elements[0].style.lineWidth / 2 : 0;
  return {
    elements,
    bbox: { minX: drawn.minX - lineWidth, minY: drawn.minY - lineWidth, maxX: drawn.maxX + lineWidth, maxY: drawn.maxY + lineWidth },
    probe,
    text: visibleText.join(""),
    textBox: { origin: { x: left, y: base.y }, width: matrix.width, height: matrix.height, depth: matrix.depth },
    entries: entryRecords,
    anchor: style.anchor
  };
}

function primitivesBox(primitives: LegendMarks["primitives"]): Box | null {
  let box: Box | null = null;
  for (const primitive of primitives) for (const s of primitive.segments) {
    const pts = s.op === "C" ? [[s.x1, s.y1], [s.x2, s.y2], [s.x, s.y]] : s.op === "Z" ? [] : [[s.x, s.y]];
    for (const [x = 0, y = 0] of pts) box = box ? { minX: Math.min(box.minX, x), minY: Math.min(box.minY, y), maxX: Math.max(box.maxX, x), maxY: Math.max(box.maxY, y) } : { minX: x, minY: y, maxX: x, maxY: y };
  }
  return box;
}

function imageElements(host: LegendHost, source: LegendImageSource, geometry: LegendImageGeometry, pathStyle: ResolvedStyle, marks: LegendMarks | null, o: Point, cellId: string): SceneElement[] {
  const out: SceneElement[] = [];
  const at = (p: Point): Point => ({ x: o.x + p.x, y: o.y + p.y });
  let n = 0;
  for (const piece of geometry.pieces) {
    if (piece.kind === "line") {
      // The image is `\draw[<plot style>] plot coordinates {...}`: the plot's handler applies (b-const: jump mark mid).
      const commands: LocalCommand[] = plotHandlerCommands(piece.points.map((p) => ({ p: at(p), jump: false })), source.plot.handler, { tension: source.plot.tension, combBase: (q) => ({ x: q.x, y: o.y }) });
      out.push(host.path(source.sourceId, `legend-image:${cellId}:${String(n++)}`, pathStyle, source.span, commands));
    } else if (piece.kind === "rectangle") {
      const a = at(piece.from); const b = at(piece.to);
      out.push(host.path(source.sourceId, `legend-image:${cellId}:${String(n++)}`, pathStyle, source.span, [
        { kind: "M", to: a }, { kind: "L", to: { x: a.x, y: b.y } }, { kind: "L", to: b }, { kind: "L", to: { x: b.x, y: a.y } }, { kind: "Z" }, { kind: "M", to: b }
      ]));
    } else if (marks) {
      for (const p of piece.at) {
        const q = at(p);
        marks.primitives.forEach((primitive, i) => {
          const style: ResolvedStyle = { ...marks.style, stroke: primitive.stroke, drawExplicit: primitive.stroke !== null, fill: primitive.fill };
          out.push(host.path(source.sourceId, `legend-mark:${cellId}:${String(i)}`, style, source.span, primitive.segments.map((s): LocalCommand => {
            switch (s.op) {
              case "M": return { kind: "M", to: { x: q.x + s.x, y: q.y + s.y } };
              case "L": return { kind: "L", to: { x: q.x + s.x, y: q.y + s.y } };
              case "C": return { kind: "C", c1: { x: q.x + s.x1, y: q.y + s.y1 }, c2: { x: q.x + s.x2, y: q.y + s.y2 }, to: { x: q.x + s.x, y: q.y + s.y } };
              case "Z": return { kind: "Z" };
            }
          })));
        });
      }
    }
  }
  return out;
}

export { splitTopLevelList };
