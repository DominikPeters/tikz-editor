import type { PathItem, PathStatement, Span } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import type { WorldPoint } from "../coords/points.js";
import { worldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import type { FrameTransform } from "../coords/transforms.js";
import { applyFrameToWorldPoint, invertFrameToWorldTransform, worldVectorToFrameLocal } from "../coords/frame.js";
import { frameLocalPoint, worldVector } from "../coords/points.js";
import { splitAllAtTopLevel } from "../domains/coordinates/parse.js";
import { parseRotateAroundValue, stripEnclosingBraces } from "../semantic/style/option-utils.js";
import { isFrameLocalCoordinateEditHandle, type EditHandle } from "../semantic/types.js";
import type { EditGeometrySession } from "./geometry-session.js";
import { CM_PER_PT, formatNumber } from "./format.js";
import { normalizeOptionKey, type OptionMutation } from "./option-mutations.js";
import { resolveStatementOptionFrame } from "./parent-frame.js";
import { parseTikzForEdit, sourceFingerprintForEdit, type EditParseOptions } from "./parse-options.js";
import { findPathStatementById } from "./statement-find.js";

const CENTER_EPSILON = 1e-3;
const MOVE_EPSILON = 1e-6;

export type CenteredPivotMovePlan = {
  kind: "success";
  framesBySource: ReadonlyMap<string, FrameTransform>;
  mutationsBySource: ReadonlyMap<string, ReadonlyMap<string, OptionMutation>>;
  replacements: Array<{ span: Span; text: string }>;
} | { kind: "unsupported"; reason: string };

/** Plan pivot and coordinate-frame changes together, against the gesture source. */
export function planCenteredPivotMoves(
  source: string,
  editHandles: readonly EditHandle[],
  deltasBySource: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): CenteredPivotMovePlan {
  const framesBySource = new Map<string, FrameTransform>();
  const mutationsBySource = new Map<string, ReadonlyMap<string, OptionMutation>>();
  const replacements: Array<{ span: Span; text: string }> = [];
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
    const rotation = pivots[0];
    const parsedRotation = parseRotateAroundValue(rotation.valueRaw);
    if (!parsedRotation) continue;
    const prefix = resolveStatementOptionFrame(source, sourceId, entries.slice(0, entries.indexOf(rotation)), parseOptions, geometry);
    if (!prefix) continue;
    const originalFrame = resolveStatementOptionFrame(source, sourceId, undefined, parseOptions, geometry);
    if (!originalFrame || handles.some(handle => !isFrameLocalCoordinateEditHandle(handle) || !framesMatch(handle.frame, originalFrame))) continue;
    const pivotWorld = applyFrameToWorldPoint(prefix, frameLocalPoint(parsedRotation.pivot.x, parsedRotation.pivot.y));
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
    const localDelta = worldVectorToFrameLocal(worldVector(delta.x, delta.y), prefix);
    if (!localDelta) return { kind: "unsupported", reason: "Centered-pivot move requires an invertible coordinate frame." };
    const nextPivot = worldPoint(pt(parsedRotation.pivot.x + localDelta.x), pt(parsedRotation.pivot.y + localDelta.y));
    // Preserve the angle expression and the actual key/option position.
    const angleRaw = splitAllAtTopLevel(stripEnclosingBraces(rotation.valueRaw), ":")[0].trim();
    const nextValue = `{${angleRaw}:(${formatNumber(nextPivot.x * CM_PER_PT, { fractionDigits: 6 })},${formatNumber(nextPivot.y * CM_PER_PT, { fractionDigits: 6 })})}`;
    const nextEntry = { ...rotation, valueRaw: nextValue, raw: `${rotation.key}=${nextValue}` };
    const nextEntries = entries.map(entry => entry === rotation ? nextEntry : entry);
    const frame = resolveStatementOptionFrame(source, sourceId, nextEntries, parseOptions, geometry);
    if (!frame || !invertFrameToWorldTransform(frame)) {
      return { kind: "unsupported", reason: "Centered-pivot move requires an invertible complete coordinate frame." };
    }
    framesBySource.set(sourceId, frame);
    mutationsBySource.set(sourceId, new Map([[normalizeOptionKey(rotation.key), { kind: "set", value: nextValue }]]));
    replacements.push({ span: rotation.span, text: nextEntry.raw });
  }
  return { kind: "success", framesBySource, mutationsBySource, replacements };
}

function spanKey(span: Span): string {
  return `${span.from}:${span.to}`;
}

function framesMatch(left: FrameTransform, right: FrameTransform): boolean {
  return (["a", "b", "c", "d", "e", "f"] as const).every(key => Math.abs(left[key] - right[key]) < 1e-9);
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
  if (shapes[0].keyword === "rectangle" && handles.length === 2) {
    return worldPoint(pt((handles[0].world.x + handles[1].world.x) / 2), pt((handles[0].world.y + handles[1].world.y) / 2));
  }
  if ((shapes[0].keyword === "circle" || shapes[0].keyword === "ellipse") && handles.length === 1) return handles[0].world;
}
