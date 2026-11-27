/**
 * Direct manipulation of pgfplots axes (design/pgfplots.md section 8): moving
 * writes `at=`, resizing writes `width`/`height` through the inverse of the
 * size model (behaviour A2–A4), dragging the legend writes its position in
 * axis description coordinates (behaviour L1/L2). All are option-list edits
 * of the axis; the rest of the list keeps its text, comments and order.
 */
import type { AddLegendEntryStatement, AddPlotStatement, AxisStatement, Span, Statement } from "../../ast/types.js";
import { nestedStatements } from "../../ast/walk.js";
import type { WorldPoint } from "../../coords/points.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry } from "../../options/types.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import type { EvaluateOptions, PgfplotsAxisEditInfo, SceneElement } from "../../semantic/types.js";
import { LEGEND_POSITIONS } from "../../pgfplots/model.js";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, DESCRIPTION_ALLOWANCE } from "../../pgfplots/layout.js";
import { parseAxisDescriptionId, parseAxisPlotId } from "../../pgfplots/edit-ids.js";
import { unchangedSource, userText } from "../fragment.js";
import { coordinateText } from "../writer/coordinate-text.js";
import type { EditGeometrySession } from "../geometry-session.js";
import { applyOptionMutationsToTarget, type OptionMutation } from "../option-mutations.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { resolvePropertyTarget, type PropertyTarget } from "../property-target.js";
import { shortestDecimal, writeTolerancePt, type DragFormatPrecision } from "../format.js";
import type { EditActionResultLike } from "../result-types.js";
import type { ResizeRole } from "../actions.js";

type Pt = { x: number; y: number };
type Box = { minX: number; minY: number; maxX: number; maxY: number };

const PT_PER_UNIT: Record<string, number> = { pt: 1, cm: 72.27 / 2.54, mm: 72.27 / 25.4, in: 72.27, bp: 72.27 / 72 };

/** The edit geometry of an axis, from the scene's axis box path. */
export function readAxisEditInfo(elements: readonly SceneElement[], axisId: string): PgfplotsAxisEditInfo | null {
  for (const element of elements) {
    if (element.kind === "Path" && element.pgfplotsAxis?.axisId === axisId) return element.pgfplotsAxis;
  }
  return null;
}

/** Every axis of a scene with its edit geometry. */
export function listAxisEditInfos(elements: readonly SceneElement[]): PgfplotsAxisEditInfo[] {
  return elements.flatMap((element) => (element.kind === "Path" && element.pgfplotsAxis ? [element.pgfplotsAxis] : []));
}

export function findAxisStatement(statements: readonly Statement[], axisId: string): AxisStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Axis" && statement.id === axisId) return statement;
    const nested = nestedStatements(statement);
    if (nested) {
      const found = findAxisStatement(nested, axisId);
      if (found) return found;
    }
  }
  return null;
}

function sceneElements(source: string, parseOptions: EditParseOptions, geometry: EditGeometrySession | undefined, evaluateOptions?: EvaluateOptions): readonly SceneElement[] {
  if (geometry?.source === source) return geometry.semantic.scene.elements;
  const parsed = parseTikzForEdit(source, parseOptions);
  return evaluateTikzFigure(parsed.figure, source, evaluateOptions).scene.elements;
}

function frameInverseLinear(info: PgfplotsAxisEditInfo, v: Pt): Pt | null {
  const { a, b, c, d } = info.frame;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return { x: (d * v.x - c * v.y) / det, y: (-b * v.x + a * v.y) / det };
}

function worldToLocal(info: PgfplotsAxisEditInfo, w: Pt): Pt | null {
  const { e, f } = info.frame;
  return frameInverseLinear(info, { x: w.x - e, y: w.y - f });
}

function isAxisAligned(info: PgfplotsAxisEditInfo): boolean {
  return Math.abs(info.frame.b) < 1e-9 && Math.abs(info.frame.c) < 1e-9 && info.frame.a > 0 && info.frame.d > 0;
}

function kvEntry(entries: readonly OptionEntry[] | undefined, key: string): Extract<OptionEntry, { kind: "kv" }> | null {
  let found: Extract<OptionEntry, { kind: "kv" }> | null = null;
  for (const entry of entries ?? []) {
    if (entry.kind === "kv" && normalizeOptionKey(entry.key).replace(/^\/pgfplots\//u, "") === key) found = entry;
  }
  return found;
}

function hasFlag(entries: readonly OptionEntry[] | undefined, key: string): boolean {
  return (entries ?? []).some((entry) => (entry.kind === "flag" || entry.kind === "kv") && normalizeOptionKey(entry.key).replace(/^\/pgfplots\//u, "") === key);
}

function stripBraces(raw: string): string {
  let text = raw.trim();
  while (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1).trim();
  return text;
}

/** `2cm` → { value: 2, unit: "cm" }; `3` → unit null; anything else (macros, `0.8\textwidth`) → null. */
function readLengthWithUnit(raw: string): { value: number; unit: string | null } | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(pt|cm|mm|in|bp)?$/u.exec(stripBraces(raw));
  if (!match?.[1]) return null;
  return { value: Number(match[1]), unit: match[2] ?? null };
}

/** A length in `unit`, to the edit's write tolerance (pt). */
function writeLength(valuePt: number, unit: string): string {
  const perUnit = PT_PER_UNIT[unit] ?? 1;
  return `${shortestDecimal(valuePt / perUnit, writeTolerancePt() / perUnit)}${unit}`;
}

function success(source: string, target: PropertyTarget, mutations: Map<string, OptionMutation>, axisId: string, note?: string): EditActionResultLike {
  const rewritten = applyOptionMutationsToTarget(source, target, mutations);
  if (!rewritten) return { kind: "success", newSource: unchangedSource(source), patches: [], changedSourceIds: [axisId] };
  if (note) return { kind: "partial", newSource: rewritten.source, patches: [rewritten.patch], changedSourceIds: [axisId], skippedHandles: [], reason: note };
  return { kind: "success", newSource: rewritten.source, patches: [rewritten.patch], changedSourceIds: [axisId] };
}

function resolveAxisTarget(source: string, axisId: string, parseOptions: EditParseOptions): PropertyTarget | null {
  const resolved = resolvePropertyTarget(source, axisId, parseOptions);
  return resolved.kind === "found" && resolved.target.kind === "pgfplots-axis" ? resolved.target : null;
}

/**
 * The `at` value placing the axis anchor at `local` (pt in the parent frame),
 * in the spelling of the existing value: the same unit when both components
 * carry one, unitless through the parent's x/y vectors when the value is
 * unitless, cm otherwise.
 */
function writeAtValue(existing: string | null, local: Pt, parentBasis: { x: Pt; y: Pt } | undefined, fallbackUnit = "cm"): string {
  const inner = existing ? stripBraces(existing) : "";
  const pair = /^\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/u.exec(inner);
  const x = pair?.[1] ? readLengthWithUnit(pair[1]) : null;
  const y = pair?.[2] ? readLengthWithUnit(pair[2]) : null;
  if (x && y && x.unit === null && y.unit === null && parentBasis) {
    const { x: bx, y: by } = parentBasis;
    const det = bx.x * by.y - bx.y * by.x;
    if (Math.abs(det) > 1e-12) {
      const u = (by.y * local.x - by.x * local.y) / det;
      const v = (-bx.y * local.x + bx.x * local.y) / det;
      const scale = Math.hypot(bx.x, bx.y) || 1;
      const tol = writeTolerancePt() / scale;
      return `{(${shortestDecimal(u, tol)},${shortestDecimal(v, tol)})}`;
    }
  }
  const unitX = x?.unit ?? y?.unit ?? fallbackUnit;
  const unitY = y?.unit ?? x?.unit ?? fallbackUnit;
  return `{(${writeLength(local.x, unitX)},${writeLength(local.y, unitY)})}`;
}

/** Moves an axis by a world delta: writes `at={(x,y)}` (behaviour A6), keeping `anchor=`. */
export function applyMoveAxisAction(
  source: string,
  axisId: string,
  delta: WorldPoint,
  _formatPrecision: DragFormatPrecision | undefined,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): EditActionResultLike {
  const target = resolveAxisTarget(source, axisId, parseOptions);
  if (!target) return { kind: "unsupported", reason: `Axis ${axisId} was not found.` };
  const info = readAxisEditInfo(sceneElements(source, parseOptions, geometry), axisId);
  if (!info) return { kind: "unsupported", reason: "The axis has no rendered geometry to move (is it drawn?)." };
  const localDelta = frameInverseLinear(info, delta);
  if (!localDelta) return { kind: "unsupported", reason: "Cannot invert the axis frame." };
  if (Math.abs(localDelta.x) < 1e-9 && Math.abs(localDelta.y) < 1e-9) {
    return { kind: "success", newSource: unchangedSource(source), patches: [], changedSourceIds: [axisId] };
  }
  const anchorPoint = info.anchors[info.anchor] ?? info.anchors["south west"];
  if (!anchorPoint) return { kind: "unsupported", reason: `Unknown axis anchor \`${info.anchor}\`.` };
  const next = { x: anchorPoint.x + localDelta.x, y: anchorPoint.y + localDelta.y };
  const existing = kvEntry(target.options?.entries, "at");
  const value = writeAtValue(existing?.valueRaw ?? null, next, info.parentBasis, authoredLengthUnit(target.options?.entries));
  return success(source, target, new Map([[existing ? normalizeOptionKey(existing.key) : "at", { kind: "set", value: coordinateText(value) }]]), axisId);
}

/** The point a fixed fraction along the box (or a fixed offset outside it) occupies after the box changes. */
function carryAlong(p: number, lo: number, hi: number, nlo: number, nhi: number): number {
  if (p < lo) return nlo + (p - lo);
  if (p > hi) return nhi + (p - hi);
  const t = hi - lo > 1e-12 ? (p - lo) / (hi - lo) : 0;
  return nlo + t * (nhi - nlo);
}

export type ResizeAxisAction = {
  elementId: string;
  role: ResizeRole;
  newWorld: WorldPoint;
  preserveAspect?: boolean;
  referenceBounds?: { minX: number; minY: number; maxX: number; maxY: number };
};

/**
 * Resizes an axis from a handle on its outer box. The dragged edge moves by
 * the pointer's displacement and so does the matching edge of the axis
 * rectangle (descriptions sit outside it rigidly). The new rectangle is
 * written as `width`/`height` through the inverse of behaviour A2–A4:
 * target = box / scale + (scale only axis ? 0 : 45pt). A drag that changes
 * one direction also writes the other when it was only implied by the aspect
 * rule (A2), so the other side does not move. The opposite edge stays where
 * it was: `at` is rewritten when the axis anchor is not on that edge.
 */
export function applyResizeAxisAction(
  source: string,
  action: ResizeAxisAction,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): EditActionResultLike {
  const axisId = action.elementId;
  const target = resolveAxisTarget(source, axisId, parseOptions);
  if (!target) return { kind: "unsupported", reason: `Axis ${axisId} was not found.` };
  const info = readAxisEditInfo(sceneElements(source, parseOptions, geometry), axisId);
  if (!info) return { kind: "unsupported", reason: "The axis has no rendered geometry to resize." };
  if (!isAxisAligned(info)) return { kind: "unsupported", reason: "Resizing a rotated or mirrored axis is not supported." };
  const role = action.role;
  const affectsX = role.includes("left") || role.includes("right");
  const affectsY = role.includes("top") || role.includes("bottom");
  if ((affectsX && info.size.xUnit !== undefined) || (affectsY && info.size.yUnit !== undefined)) {
    return { kind: "unsupported", reason: "This axis is sized by unit vectors (`x=`/`y=`); change them in the inspector." };
  }
  const outer: Box = info.bbox;
  const reference = action.referenceBounds ? referenceToLocal(info, action.referenceBounds) ?? outer : outer;
  const pointer = worldToLocal(info, action.newWorld);
  if (!pointer) return { kind: "unsupported", reason: "Cannot invert the axis frame." };
  const { x0, y0, x1, y1 } = info.box;
  let nx0 = x0, nx1 = x1, ny0 = y0, ny1 = y1;
  const min = 8;
  if (role.includes("right")) nx1 = Math.max(x0 + min, x1 + (pointer.x - reference.maxX));
  if (role.includes("left")) nx0 = Math.min(x1 - min, x0 + (pointer.x - reference.minX));
  if (role.includes("top")) ny1 = Math.max(y0 + min, y1 + (pointer.y - reference.maxY));
  if (role.includes("bottom")) ny0 = Math.min(y1 - min, y0 + (pointer.y - reference.minY));
  if (action.preserveAspect && affectsX && affectsY) {
    const ratio = Math.max((nx1 - nx0) / (x1 - x0), (ny1 - ny0) / (y1 - y0));
    const w = (x1 - x0) * ratio; const h = (y1 - y0) * ratio;
    if (role.includes("left")) nx0 = nx1 - w; else nx1 = nx0 + w;
    if (role.includes("bottom")) ny0 = ny1 - h; else ny1 = ny0 + h;
  }
  const allowance = info.size.scaleOnlyAxis ? 0 : DESCRIPTION_ALLOWANCE;
  const scale = info.size.scale > 1e-12 ? info.size.scale : 1;
  const targetFor = (boxLength: number) => boxLength / scale + allowance;
  const currentWidthTarget = info.size.width ?? (info.size.height !== undefined ? (info.size.height * DEFAULT_WIDTH) / DEFAULT_HEIGHT : DEFAULT_WIDTH);
  const currentHeightTarget = info.size.height ?? (info.size.width !== undefined ? (info.size.width * DEFAULT_HEIGHT) / DEFAULT_WIDTH : DEFAULT_HEIGHT);
  const mutations = new Map<string, OptionMutation>();
  const notes: string[] = [];
  const writeSize = (key: "width" | "height", valuePt: number) => {
    const existing = kvEntry(target.options?.entries, key);
    const read = existing ? readLengthWithUnit(existing.valueRaw) : null;
    if (existing && !read?.unit) notes.push(`\`${key}=${existing.valueRaw.trim()}\` was replaced by a length in cm.`);
    mutations.set(existing ? normalizeOptionKey(existing.key) : key, { kind: "set", value: coordinateText(writeLength(valuePt, read?.unit ?? "cm")) });
  };
  if (affectsX) writeSize("width", targetFor(nx1 - nx0));
  if (affectsY) writeSize("height", targetFor(ny1 - ny0));
  // A2: one given dimension implies the other; pin it so a one-direction drag changes one direction.
  if (affectsX && !affectsY && info.size.height === undefined) writeSize("height", currentHeightTarget);
  if (affectsY && !affectsX && info.size.width === undefined) writeSize("width", currentWidthTarget);
  // Keep the opposite edge: the anchor follows the box.
  const anchorPoint = info.anchors[info.anchor] ?? info.anchors["south west"];
  if (anchorPoint) {
    const next = { x: carryAlong(anchorPoint.x, x0, x1, nx0, nx1), y: carryAlong(anchorPoint.y, y0, y1, ny0, ny1) };
    if (Math.hypot(next.x - anchorPoint.x, next.y - anchorPoint.y) > 1e-6) {
      const existing = kvEntry(target.options?.entries, "at");
      mutations.set(existing ? normalizeOptionKey(existing.key) : "at", { kind: "set", value: coordinateText(writeAtValue(existing?.valueRaw ?? null, next, info.parentBasis, authoredLengthUnit(target.options?.entries))) });
    }
  }
  return success(source, target, mutations, axisId, notes.length > 0 ? notes.join(" ") : undefined);
}

/** The unit the axis' own `width`/`height` are written in, for a new `at` (cm when neither has one). */
function authoredLengthUnit(entries: readonly OptionEntry[] | undefined): string {
  for (const key of ["width", "height"]) {
    const entry = kvEntry(entries, key);
    const unit = entry ? readLengthWithUnit(entry.valueRaw)?.unit : null;
    if (unit) return unit;
  }
  return "cm";
}

function referenceToLocal(info: PgfplotsAxisEditInfo, bounds: Box): Box | null {
  const a = worldToLocal(info, { x: bounds.minX, y: bounds.minY });
  const b = worldToLocal(info, { x: bounds.maxX, y: bounds.maxY });
  if (!a || !b) return null;
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/** The point of a box a TikZ anchor name names (compass anchors and `center`). */
function compassPoint(box: Box, anchor: string): Pt {
  const name = anchor.trim();
  const x = name.includes("west") ? box.minX : name.includes("east") ? box.maxX : (box.minX + box.maxX) / 2;
  const y = name.includes("south") ? box.minY : name.includes("north") ? box.maxY : (box.minY + box.maxY) / 2;
  return { x, y };
}

/** How close (as a fraction of the axis box) a dropped legend must come to a `legend pos` preset to snap to it. */
export const LEGEND_POS_SNAP_FRACTION = 0.02;

/**
 * Moves the legend by a world delta. Writes `legend pos=<preset>` when the
 * dropped legend lands within `LEGEND_POS_SNAP_FRACTION` of a documented
 * preset (behaviour L2), else `legend style={…, at={(rx,ry)}, anchor=…}` in
 * axis description coordinates (L1: a plain pair is relative to the box),
 * keeping the legend's anchor. A conflicting `legend pos` or `at` is removed.
 */
export function applyMoveLegendAction(
  source: string,
  axisId: string,
  delta: WorldPoint,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): EditActionResultLike {
  const target = resolveAxisTarget(source, axisId, parseOptions);
  if (!target) return { kind: "unsupported", reason: `Axis ${axisId} was not found.` };
  const info = readAxisEditInfo(sceneElements(source, parseOptions, geometry), axisId);
  if (!info?.legend) return { kind: "unsupported", reason: "The axis draws no legend to move." };
  const localDelta = frameInverseLinear(info, delta);
  if (!localDelta) return { kind: "unsupported", reason: "Cannot invert the axis frame." };
  const { x0, y0, x1, y1 } = info.box;
  const w = x1 - x0; const h = y1 - y0;
  if (!(w > 1e-9 && h > 1e-9)) return { kind: "unsupported", reason: "The axis box is empty." };
  const moved: Box = { minX: info.legend.bbox.minX + localDelta.x, minY: info.legend.bbox.minY + localDelta.y, maxX: info.legend.bbox.maxX + localDelta.x, maxY: info.legend.bbox.maxY + localDelta.y };
  const entries = target.options?.entries ?? [];
  const mutations = new Map<string, OptionMutation>();
  const legendPos = kvEntry(entries, "legend pos");
  const legendStyle = kvEntry(entries, "legend style");
  // Snap to a preset: the preset's anchor point of the moved legend near the preset's `at`.
  for (const [name, spec] of Object.entries(LEGEND_POSITIONS)) {
    const parsed = /^at=\{\(([^,]+),([^)]+)\)\},anchor=(.*)$/u.exec(spec);
    if (!parsed?.[1] || !parsed[2] || !parsed[3]) continue;
    const rx = Number(parsed[1]); const ry = Number(parsed[2]);
    const p = compassPoint(moved, parsed[3]);
    const ex = (p.x - x0) / w - rx; const ey = (p.y - y0) / h - ry;
    if (Math.abs(ex) <= LEGEND_POS_SNAP_FRACTION && Math.abs(ey) <= LEGEND_POS_SNAP_FRACTION) {
      mutations.set(legendPos ? normalizeOptionKey(legendPos.key) : "legend pos", { kind: "set", value: userText(name, "inspector-value") });
      if (legendStyle) {
        const rest = legendStyleWithout(legendStyle.valueRaw, ["at", "anchor"]);
        mutations.set(normalizeOptionKey(legendStyle.key), rest === null ? { kind: "remove" } : { kind: "set", value: userText(rest, "inspector-value") });
      }
      return success(source, target, mutations, axisId);
    }
  }
  const anchor = info.legend.anchor;
  const p = compassPoint(moved, anchor);
  const tol = writeTolerancePt() / Math.max(w, h);
  const at = `{(${shortestDecimal((p.x - x0) / w, tol)},${shortestDecimal((p.y - y0) / h, tol)})}`;
  const base = legendStyle ? legendStyleWithout(legendStyle.valueRaw, ["at", "anchor"]) : null;
  const value = `{${base ? `${base}, ` : ""}at=${at}, anchor=${anchor}}`;
  if (legendPos) mutations.set(normalizeOptionKey(legendPos.key), { kind: "remove" });
  mutations.set(legendStyle ? normalizeOptionKey(legendStyle.key) : "legend style", { kind: "set", value: userText(value, "inspector-value") });
  return success(source, target, mutations, axisId);
}

/** The inside of `legend style={…}` without the given keys, or null when nothing is left. */
function legendStyleWithout(raw: string, keys: readonly string[]): string | null {
  const list = parseOptionListRaw(`[${stripBraces(raw)}]`);
  const kept = list.entries.filter((entry) => !(entry.kind !== "unknown" && keys.includes(normalizeOptionKey(entry.key)))).map((entry) => entry.raw.trim()).filter((text) => text.length > 0);
  return kept.length > 0 ? kept.join(", ") : null;
}

/**
 * Spans an `\addplot` deletion removes: the statement and the `\addlegendentry`
 * directly after it (only blanks between), with the line they occupy.
 */
export function plotDeletionSpans(source: string, axis: AxisStatement, plot: AddPlotStatement): Span[] {
  const index = axis.body.indexOf(plot);
  const next = axis.body[index + 1];
  const entry = next?.kind === "AddLegendEntry" && /^\s*$/u.test(source.slice(plot.span.to, next.span.from)) ? next : null;
  return [lineSpan(source, { from: plot.span.from, to: (entry ?? plot).span.to })];
}

/** The pair a plot forms with its directly following legend entry. */
export function plotWithLegendEntry(source: string, axis: AxisStatement, plot: AddPlotStatement): { span: Span; entry: AddLegendEntryStatement | null } {
  const index = axis.body.indexOf(plot);
  const next = axis.body[index + 1];
  const entry = next?.kind === "AddLegendEntry" && /^\s*$/u.test(source.slice(plot.span.to, next.span.from)) ? next : null;
  return { span: { from: plot.span.from, to: (entry ?? plot).span.to }, entry };
}

/** Widens a span to whole lines when only blanks surround it on its lines. */
export function lineSpan(source: string, span: Span): Span {
  let from = span.from;
  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t")) from -= 1;
  let to = span.to;
  while (to < source.length && (source[to] === " " || source[to] === "\t")) to += 1;
  const startsLine = from === 0 || source[from - 1] === "\n";
  const endsLine = to === source.length || source[to] === "\n";
  if (startsLine && endsLine) return { from, to: to < source.length ? to + 1 : to };
  return span;
}

export { parseAxisDescriptionId, parseAxisPlotId };
