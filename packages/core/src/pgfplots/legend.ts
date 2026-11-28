/**
 * Legends (behaviour L): which entries are drawn, in which grid, and the
 * geometry of the TikZ matrix that holds them. Pure; the axis evaluator
 * measures the text nodes and emits the elements.
 *
 * The manual documents the legend as `\matrix[style=every axis legend]`
 * with one row per entry, `<image cell> & \node{<text>}`. The layout below
 * is PGF's matrix algorithm (pgfmodulematrix.code.tex, LPPL): every cell is
 * a picture whose origin is aligned per column and per row; a column is as
 * wide as the largest extent left of the origin plus the largest extent
 * right of it, a row as high as the largest height above plus the largest
 * depth below the origin (both starting at 0, so the origin is always
 * inside), and `column sep` of a cell's column is added in front of the next
 * column. `matrix.ts` lays out cells by their centres and only holds nodes,
 * so it cannot express this (behaviour L3).
 */
import type { AddLegendEntryStatement, AxisBodyItem, LegendStatement, Span } from "../ast/types.js";
import type { Box, Point } from "./layout.js";
import type { LegendEntryText, LegendModel } from "./model.js";

/** A drawn legend entry: text and the index of its image (into the image list), in grid order. */
export type LegendPair = { entry: LegendEntryText; image: number };

/** How image i of the legend pairs (L4): with entry i when there is one; `drawn` when the pair is in the legend. */
export type LegendImagePairing = { entry: number | null; drawn: boolean };

/**
 * Images and texts pair up in order: image i with entry i. Empty `\legend`
 * items drop their pair (an `\addlegendentry{}` does not, Z8); the shorter
 * list ends the legend (L4). The renderer and the edit actions both pair
 * through this function.
 */
export function pairLegendImages(entries: readonly LegendEntryText[], imageCount: number): LegendImagePairing[] {
  return Array.from({ length: imageCount }, (_, i) => {
    const entry = entries[i];
    return entry ? { entry: i, drawn: entry.text.trim() !== "" || entry.keep === true } : { entry: null, drawn: false };
  });
}

/** The drawn pairs in grid order (`reverse legend` reverses them). */
export function legendPairs(entries: readonly LegendEntryText[], imageCount: number, model: LegendModel): LegendPair[] {
  const pairs: LegendPair[] = [];
  pairLegendImages(entries, imageCount).forEach((pairing, image) => {
    const entry = pairing.entry === null ? undefined : entries[pairing.entry];
    if (entry && pairing.drawn) pairs.push({ entry, image });
  });
  return model.reverse ? pairs.reverse() : pairs;
}

/** A legend image: an `\addplot` that is not `forget plot`, or an `\addlegendimage` (L4). */
export type LegendImageRef = { sourceId: string; kind: "plot" | "image" };

/**
 * The plot-to-legend association of an axis, as the renderer pairs it: the
 * effective entries (with where each is written), the images in order and
 * how they pair. Kept with the axis evaluation for the edit actions.
 */
export type LegendAssociation = {
  /** `commands`: `\addlegendentry`/`\legend` (they beat `legend entries`); `legend entries`; `none`. */
  form: "commands" | "legend entries" | "none";
  entries: LegendEntryText[];
  images: LegendImageRef[];
  pairing: LegendImagePairing[];
};

export function associateLegend(entries: { entries: LegendEntryText[]; commands: boolean }, images: readonly LegendImageRef[]): LegendAssociation {
  return {
    form: entries.commands ? "commands" : entries.entries.length > 0 ? "legend entries" : "none",
    entries: entries.entries,
    images: [...images],
    pairing: pairLegendImages(entries.entries, images.length)
  };
}

/** The entry of a plot or legend image: its image index, entry index (null when it has none) and entry. Null for a plot that is no legend image (`forget plot`). */
export function legendEntryOf(association: LegendAssociation, sourceId: string): { image: number; entry: number | null; text: LegendEntryText | null; drawn: boolean } | null {
  const image = association.images.findIndex((ref) => ref.sourceId === sourceId);
  if (image < 0) return null;
  const pairing = association.pairing[image];
  const entry = pairing?.entry ?? null;
  return { image, entry, text: entry === null ? null : association.entries[entry] ?? null, drawn: pairing?.drawn ?? false };
}

/** Rows of pairs: `legend columns` per row (−1: one row), then `transpose legend` (L4). */
export function legendGrid<T>(pairs: readonly T[], model: LegendModel): T[][] {
  const perRow = model.columns === -1 ? Math.max(1, pairs.length) : Math.max(1, model.columns);
  const rows: T[][] = [];
  for (let i = 0; i < pairs.length; i += perRow) rows.push(pairs.slice(i, i + perRow));
  if (!model.transpose || perRow <= 1) return rows;
  const transposed: T[][] = [];
  for (let c = 0; c < perRow; c += 1) {
    const row = rows.flatMap((r) => r.slice(c, c + 1));
    if (row.length > 0) transposed.push(row);
  }
  return transposed;
}

/** A matrix cell: its picture's bounding box relative to the cell origin (`null` cells do not exist in that row). */
export type MatrixCell = Box | null;

export type MatrixLayout = {
  /** Content width (sum of the column widths and separations). */
  width: number;
  /** Content height above the baseline (the last row's origin) and depth below it. */
  height: number;
  depth: number;
  /** Cell origins, x from the content's left edge, y from the baseline. */
  origins: Array<Array<Point | null>>;
};

/**
 * PGF's matrix layout. `columnSepBefore[c]` is the separation in front of
 * column c (0-based; index 0 unused), `rowSep` the separation between rows.
 */
export function layoutMatrix(rows: ReadonlyArray<readonly MatrixCell[]>, columnSepBefore: readonly number[], rowSep: number): MatrixLayout {
  const columns = Math.max(0, ...rows.map((r) => r.length));
  const left: number[] = Array.from({ length: columns }, () => -Infinity);
  const right: number[] = Array.from({ length: columns }, () => -Infinity);
  const heights: number[] = [];
  const depths: number[] = [];
  for (const row of rows) {
    let h = 0; let d = 0;
    row.forEach((cell, c) => {
      if (!cell) return;
      const sep = c > 0 ? columnSepBefore[c] ?? 0 : 0;
      left[c] = Math.max(left[c] ?? -Infinity, -cell.minX + sep);
      right[c] = Math.max(right[c] ?? -Infinity, cell.maxX);
      h = Math.max(h, cell.maxY);
      d = Math.max(d, -cell.minY);
    });
    heights.push(h);
    depths.push(d);
  }
  const originX: number[] = [];
  let x = 0;
  for (let c = 0; c < columns; c += 1) {
    const l = Number.isFinite(left[c]) ? left[c] ?? 0 : 0;
    const r = Number.isFinite(right[c]) ? right[c] ?? 0 : 0;
    originX.push(x + l);
    x += l + r;
  }
  const lastDepth = depths[depths.length - 1] ?? 0;
  // y of each row's origin above the baseline (last row origin = 0).
  const originY: number[] = Array.from({ length: rows.length }, () => 0);
  for (let r = rows.length - 2; r >= 0; r -= 1) originY[r] = (originY[r + 1] ?? 0) + (heights[r + 1] ?? 0) + rowSep + (depths[r] ?? 0);
  const total = heights.reduce((a, b) => a + b, 0) + depths.reduce((a, b) => a + b, 0) + rowSep * Math.max(0, rows.length - 1);
  return {
    width: x,
    height: total - lastDepth,
    depth: lastDepth,
    origins: rows.map((row, r) => row.map((cell, c) => (cell ? { x: originX[c] ?? 0, y: originY[r] ?? 0 } : null)))
  };
}

/** One painted piece of a legend image, relative to the cell origin. */
export type LegendImagePiece =
  | { kind: "line"; points: Point[] }
  | { kind: "rectangle"; from: Point; to: Point }
  | { kind: "marks"; at: Point[] };

export type LegendImageGeometry = { pieces: LegendImagePiece[] };

const CM = 72.27 / 2.54;

const EM = 10;
const EX = 4.30554;

/**
 * `ybar legend`, `xbar legend` (manual axisdescription.tex): a bar plot of
 * (0cm, 0.8em) and (2 bar width, 0.6em) with `bar width=3pt, bar shift=0pt,
 * yshift=-0.2em`; bars start at 0 in the image's own frame (em, ex of the
 * normal 10pt font). `single ybar legend`: one 6pt bar at (0pt, 0.8em).
 */
function barLegend(points: Array<{ x: number; y: number }>, width: number, vertical: boolean, shift: number): LegendImageGeometry {
  return {
    pieces: points.map((p) => vertical
      ? { kind: "rectangle" as const, from: { x: p.x - width / 2, y: shift }, to: { x: p.x + width / 2, y: p.y + shift } }
      : { kind: "rectangle" as const, from: { x: 0, y: p.y + shift - width / 2 }, to: { x: p.x, y: p.y + shift + width / 2 } })
  };
}

const BAR_LEGEND_IMAGES: Record<string, (plot: { onlyMarks: boolean; hasMarks: boolean }) => LegendImageGeometry> = {
  "ybar legend": () => barLegend([{ x: 0, y: 0.8 * EM }, { x: 6, y: 0.6 * EM }], 3, true, -0.2 * EM),
  // Measured (behaviour Z14): bars of 0.8em centred at y=-0.2em and 0.6em at y=2*bar width-0.2em,
  // i.e. the ybar coordinates with x and y exchanged.
  "xbar legend": () => barLegend([{ x: 0.8 * EM, y: 0 }, { x: 0.6 * EM, y: 6 }], 3, false, -0.2 * EM),
  "single ybar legend": () => barLegend([{ x: 0, y: 0.8 * EM }], 6, true, -0.2 * EM),
  "single xbar legend": () => barLegend([{ x: 0.8 * EM, y: 0 }], 6, false, 0.2 * EX)
};

/**
 * Legend image kinds (manual "Legend Appearance"): the documented
 * `legend image code` of each style, as geometry. Pluggable: a plot type
 * adds its kind here (e.g. `ybar legend` with the bar plots).
 */
export const LEGEND_IMAGE_BUILDERS: Record<string, (plot: { onlyMarks: boolean; hasMarks: boolean }) => LegendImageGeometry> = {
  // `\draw[mark repeat=2,mark phase=2,#1] plot coordinates {(0cm,0cm) (0.3cm,0cm) (0.6cm,0cm)};`
  "line legend": ({ onlyMarks, hasMarks }) => ({
    pieces: [
      ...(onlyMarks ? [] : [{ kind: "line" as const, points: [{ x: 0, y: 0 }, { x: 0.3 * CM, y: 0 }, { x: 0.6 * CM, y: 0 }] }]),
      ...(hasMarks ? [{ kind: "marks" as const, at: [{ x: 0.3 * CM, y: 0 }] }] : [])
    ]
  }),
  // `\draw[#1] (0cm,-0.1cm) rectangle (0.6cm,0.1cm);`
  "area legend": () => ({ pieces: [{ kind: "rectangle", from: { x: 0, y: -0.1 * CM }, to: { x: 0.6 * CM, y: 0.1 * CM } }] }),
  "empty legend": () => ({ pieces: [] }),
  ...BAR_LEGEND_IMAGES
};

/** Bounding box of an image cell (PGF: stroked paths grow by half the line width, marks count geometrically). */
export function legendImageBox(geometry: LegendImageGeometry, stroked: boolean, lineWidth: number, markExtent: Box | null): Box | null {
  let box: Box | null = null;
  const add = (b: Box) => { box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : b; };
  const half = stroked ? lineWidth / 2 : 0;
  for (const piece of geometry.pieces) {
    if (piece.kind === "line") {
      const xs = piece.points.map((p) => p.x); const ys = piece.points.map((p) => p.y);
      add({ minX: Math.min(...xs) - half, minY: Math.min(...ys) - half, maxX: Math.max(...xs) + half, maxY: Math.max(...ys) + half });
    } else if (piece.kind === "rectangle") {
      add({ minX: Math.min(piece.from.x, piece.to.x) - half, minY: Math.min(piece.from.y, piece.to.y) - half, maxX: Math.max(piece.from.x, piece.to.x) + half, maxY: Math.max(piece.from.y, piece.to.y) + half });
    } else if (markExtent) {
      for (const p of piece.at) add({ minX: p.x + markExtent.minX, minY: p.y + markExtent.minY, maxX: p.x + markExtent.maxX, maxY: p.y + markExtent.maxY });
    }
  }
  return box;
}

/** Legend entries of an axis: `\legend` (the last one wins) over `\addlegendentry` (in order) over `legend entries` (manual "Legends"). */
export function collectLegendEntries(
  body: readonly AxisBodyItem[],
  model: LegendModel,
  read: {
    addLegendEntry: (item: AddLegendEntryStatement) => LegendEntryText;
    legend: (item: LegendStatement) => LegendEntryText[];
  }
): { entries: LegendEntryText[]; commands: boolean } {
  let fromCommands: LegendEntryText[] | null = null;
  for (const item of body) {
    if (item.kind === "AddLegendEntry") (fromCommands ??= []).push({ ...read.addLegendEntry(item), origin: { kind: "addlegendentry", statementId: item.id, span: item.span } });
    else if (item.kind === "Legend") {
      const list = read.legend(item);
      // Item spans hold when the list was read item for item (no `...` expansion).
      const asWritten = list.length === item.entries.length && !item.entries.some((entry) => entry.raw.trim() === "...");
      fromCommands = list.map((entry, index) => ({ ...entry, origin: { kind: "legend", statementId: item.id, index, span: asWritten ? item.entries[index]?.span ?? null : null } }));
    }
  }
  if (fromCommands) return { entries: fromCommands, commands: true };
  return { entries: model.entries ?? [], commands: false };
}

export type { Span };
