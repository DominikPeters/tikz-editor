import { sourceSlice, tikz, type TikzFragment } from "./fragment.js";
import { requireArrayValue } from "../utils/collections.js";
import type { PathItem, PathStatement, Span } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import type { WorldPoint } from "../coords/points.js";
import { worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { invertFrameToWorldTransform } from "../coords/frame.js";
import { splitAllAtTopLevel } from "../domains/coordinates/parse.js";
import { stripEnclosingBraces } from "../semantic/style/option-utils.js";
import { sameSiteContext, spelledCoordinateFrame, type SiteContext } from "../semantic/site-context.js";
import { isFrameLocalCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import type { EditGeometrySession } from "./geometry-session.js";
import { normalizeOptionKey, type OptionMutation } from "./option-mutations.js";
import { resolveStatementOptionContext } from "./parent-frame.js";
import { parseTikzForEdit, sourceFingerprintForEdit, type EditParseOptions } from "./parse-options.js";
import { findPathStatementById } from "./statement-find.js";
import { createCoordinateWriter, readContextPoint } from "./writer/index.js";

const CENTER_EPSILON = 1e-3;
const MOVE_EPSILON = 1e-6;

export type CenteredPivotMovePlan = {
  kind: "success";
  /** The context each moved statement's coordinates are read in after its pivot moves. */
  contextsBySource: ReadonlyMap<string, SiteContext>;
  mutationsBySource: ReadonlyMap<string, ReadonlyMap<string, OptionMutation>>;
  replacements: Array<{ span: Span; text: TikzFragment }>;
} | { kind: "unsupported"; reason: string };

/** Plan pivot and coordinate-frame changes together, against the gesture source. */
export function planCenteredPivotMoves(
  source: string,
  editHandles: readonly EditHandle[],
  deltasBySource: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): CenteredPivotMovePlan {
  const contextsBySource = new Map<string, SiteContext>();
  const mutationsBySource = new Map<string, ReadonlyMap<string, OptionMutation>>();
  const replacements: Array<{ span: Span; text: TikzFragment }> = [];
  const parsed = parseTikzForEdit(source, parseOptions);
  const fingerprint = sourceFingerprintForEdit(source, parseOptions);
  const spans = new Map<string, number>();
  for (const handle of editHandles) {
    const key = spanKey(handle.sourceRef.sourceSpan);
    spans.set(key, (spans.get(key) ?? 0) + 1);
  }
  for (const [sourceId, delta] of deltasBySource) {
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
      return { kind: "unsupported", reason: "Centered-pivot move requires a finite translation." };
    }
    if (Math.abs(delta.x) <= MOVE_EPSILON && Math.abs(delta.y) <= MOVE_EPSILON) continue;
    const statement = findPathStatementById(parsed.figure.body, sourceId);
    if (!statement) continue;
    const handles = editHandles.filter(handle => handle.sourceRef.sourceId === sourceId && handle.kind === "path-point");
    const center = shapeCenter(statement, handles);
    if (!center || !handles.every(handle => isFrameLocalCoordinateEditHandle(handle) && handle.rewriteMode === "direct" &&
      (handle.coordinateForm === "cartesian" || handle.coordinateForm === "polar"))) continue;
    const entries = statement.options?.entries ?? [];
    const pivots = entries.filter(isRotateAroundEntry);
    if (pivots.length !== 1) continue;
    const rotation = requireArrayValue(pivots, 0);
    // The pivot is a coordinate read in the state of the options before it:
    // its plain numbers go through the axis vectors there, then the CTM.
    const pivotText = rotateAroundPivot(source, rotation);
    if (!pivotText) continue;
    const prefix = resolveStatementOptionContext(source, sourceId, entries.slice(0, entries.indexOf(rotation)), parseOptions, geometry);
    const pivotWorld = prefix && readContextPoint(prefix, pivotText.raw);
    if (!prefix || !pivotWorld) continue;
    const originalContext = resolveStatementOptionContext(source, sourceId, undefined, parseOptions, geometry);
    if (!originalContext || handles.some(handle => !isFrameLocalCoordinateEditHandle(handle) || !sameSiteContext(handle.siteContext, originalContext))) continue;
    // An external authored pivot keeps its current semantics; only a pivot
    // already at the visual center follows that center during movement.
    if (Math.hypot(pivotWorld.x - center.x, pivotWorld.y - center.y) > CENTER_EPSILON) continue;
    if (handles.some(handle => handle.sourceRef.sourceFingerprint !== fingerprint ||
      source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) !== handle.sourceText)) {
      return { kind: "unsupported", reason: "Some selected handles are stale. Wait for recompute and try again." };
    }
    if (handles.some(handle => (spans.get(spanKey(handle.sourceRef.sourceSpan)) ?? 0) > 1)) {
      return { kind: "unsupported", reason: "Handle span is shared by expanded statements (foreach/macro), cannot move safely." };
    }
    const nextPivot = createCoordinateWriter(source).point({ kind: "context", context: prefix, replaces: pivotText.raw },
      worldPoint(pt(pivotWorld.x + delta.x), pt(pivotWorld.y + delta.y)), { precision: "reparameterize" });
    if (nextPivot.kind !== "ok") return { kind: "unsupported", reason: `Cannot move the rotation pivot: ${nextPivot.reason}.` };
    // Preserve the key, the angle expression and the option's position.
    const nextValue = tikz`${pivotText.before}${nextPivot.fragment}${pivotText.after}`;
    const nextRaw = tikz`${pivotText.key}${pivotText.equals}${nextValue}`;
    const nextEntry = { ...rotation, valueRaw: nextValue, raw: nextRaw };
    const nextEntries = entries.map(entry => entry === rotation ? nextEntry : entry);
    const context = resolveStatementOptionContext(source, sourceId, nextEntries, parseOptions, geometry);
    if (!context || !invertFrameToWorldTransform(spelledCoordinateFrame(context, { unitlessX: true, unitlessY: true }))) {
      return { kind: "unsupported", reason: "Centered-pivot move requires an invertible complete coordinate frame." };
    }
    contextsBySource.set(sourceId, context);
    mutationsBySource.set(sourceId, new Map([[normalizeOptionKey(rotation.key), { kind: "set", value: nextValue }]]));
    replacements.push({ span: rotation.span, text: nextRaw });
  }
  return { kind: "success", contextsBySource, mutationsBySource, replacements };
}

/**
 * The pivot coordinate of `rotate around={angle:(x,y)}`, with the text
 * around it copied from the source: the key and `=`, and the value before
 * and after the coordinate (braces, the angle expression).
 */
function rotateAroundPivot(source: string, entry: Extract<OptionEntry, { kind: "kv" }>):
  { raw: string; key: TikzFragment; equals: TikzFragment; before: TikzFragment; after: TikzFragment } | null {
  const { keySpan, valueSpan } = entry;
  if (!keySpan || !valueSpan) return null;
  const value = source.slice(valueSpan.from, valueSpan.to);
  const colon = splitAllAtTopLevel(stripEnclosingBraces(value), ":");
  if (colon.length !== 2) return null;
  const raw = requireArrayValue(colon, 1).trim();
  const at = value.lastIndexOf(raw);
  if (at < 0 || !raw.startsWith("(")) return null;
  return {
    raw,
    key: sourceSlice(source, keySpan),
    equals: sourceSlice(source, { from: keySpan.to, to: valueSpan.from }),
    before: sourceSlice(source, { from: valueSpan.from, to: valueSpan.from + at }),
    after: sourceSlice(source, { from: valueSpan.from + at + raw.length, to: valueSpan.to })
  };
}

function spanKey(span: Span): string {
  return `${span.from}:${span.to}`;
}

function isRotateAroundEntry(entry: OptionEntry): entry is Extract<OptionEntry, { kind: "kv" }> {
  if (entry.kind !== "kv") return false;
  const key = normalizeOptionKey(entry.key);
  return key === "rotate around" || key === "/tikz/rotate around";
}

function shapeCenter(statement: PathStatement, handles: readonly EditHandle[]): WorldPoint | undefined {
  const shapes = statement.items.filter((item): item is Extract<PathItem, { kind: "PathKeyword" }> =>
    item.kind === "PathKeyword" && (item.keyword === "rectangle" || item.keyword === "circle" || item.keyword === "ellipse"));
  if (shapes.length !== 1) return;
  if (requireArrayValue(shapes, 0).keyword === "rectangle" && handles.length === 2) {
    return worldPoint(pt((requireArrayValue(handles, 0).world.x + requireArrayValue(handles, 1).world.x) / 2), pt((requireArrayValue(handles, 0).world.y + requireArrayValue(handles, 1).world.y) / 2));
  }
  if ((requireArrayValue(shapes, 0).keyword === "circle" || requireArrayValue(shapes, 0).keyword === "ellipse") && handles.length === 1) return requireArrayValue(handles, 0).world;
}
