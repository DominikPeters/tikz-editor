import type { EditGeometrySession } from "../geometry-session.js";
import type { EditActionResultLike } from "../result-types.js";
import type { CoordinateItem, NodeItem, PathStatement, Span, Statement } from "../../ast/types.js";
import { pt } from "../../coords/scalars.js";
import type { OptionEntry } from "../../options/types.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { worldTransform, type FrameTransform } from "../../coords/transforms.js";
import { isFrameLocalCoordinateEditHandle } from "../../semantic/types.js";
import { planCenteredPivotMoves, type CenteredPivotMovePlan } from "../center-pivot-move.js";
import { rewritePreciseFrameCoordinate } from "../frame-coordinate.js";
import { resolveStatementOptionFrame } from "../parent-frame.js";
import type { EditHandle } from "../../semantic/types.js";
import { parseCoordinateLike, parseLength } from "../../semantic/coords/parse-length.js";
import { collectSourceWorldBounds } from "../snapping/index.js";
import { localToSourceUnits, worldToLocal } from "../coords.js";
import { CM_PER_PT, formatNumber, pointDistanceFormatOptions, type DragFormatPrecision } from "../format.js";
import { computeMinimalReplacementPatch, replaceSpan } from "../patch.js";
import { correctMovedCoordinateDependencies } from "../calc-move.js";
import { resolvePropertyTarget } from "../property-target.js";
import { rewriteCoordinate } from "../rewrite.js";
import { applyTextReplacements } from "../statement-ops.js";
import type { SourcePatch } from "../types.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "../arrange.js";
import {
  applyOptionMutationsToTarget,
  rewriteSourceBackedOptionListMutations,
  type OptionMutation
} from "../option-mutations.js";
import { parseTikzForEdit, sourceFingerprintForEdit, type EditParseOptions } from "../parse-options.js";
import { normalizeOptionKey } from "../option-key.js";
import { FIT_DIRECT_MANIPULATION_BLOCK_REASON, sourceUsesFitNodeFromParseResult } from "../fit.js";
import { findPathStatementById, normalizeElementIds, uniqueStrings } from "../statement-find.js";

const ARRANGE_EPSILON = 1e-6;


type MoveRewriteBatchResult = Exclude<EditActionResultLike, { kind: "error" }>;

export type AlignElementsAction = { elementIds: string[]; mode: AlignMode };
export type DistributeElementsAction = { elementIds: string[]; axis: DistributeAxis };

/** Immutable source and handles captured at the start of an element drag. */
export type MoveElementsBaseline = {
  source: string;
  editHandles: EditHandle[];
  sourceFingerprint?: string;
};

export function applyMoveElementsAction(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: WorldPoint,
  formatPrecision: DragFormatPrecision | undefined,
  parseOptions: EditParseOptions = {},
  baseline?: MoveElementsBaseline,
  geometry?: EditGeometrySession
): EditActionResultLike {
  if (baseline) {
    source = baseline.source;
    editHandles = baseline.editHandles;
    parseOptions = { ...parseOptions, sourceFingerprint: baseline.sourceFingerprint };
  }
  const requestedIds = normalizeElementIds(elementIds);
  if (requestedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for moveElements" };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const normalizedIds = collapseMovedScopeDescendants(parsed.figure.body, requestedIds, editHandles);
  const fitBlockedId = normalizedIds.find((elementId) =>
    sourceUsesFitNodeFromParseResult(source, parsed, elementId)
  );
  if (fitBlockedId) {
    return { kind: "unsupported", reason: FIT_DIRECT_MANIPULATION_BLOCK_REASON };
  }
  const matrixElementIds = normalizedIds.filter((elementId) => {
    const statement = findPathStatementById(parsed.figure.body, elementId);
    return statement != null && isMatrixPathStatement(statement);
  });
  const treeRootElementIds = normalizedIds.filter((elementId) => {
    const statement = findPathStatementById(parsed.figure.body, elementId);
    return statement != null && isTreeRootPathStatement(statement);
  });
  const scopeElementIdSet = new Set(
    normalizedIds.filter((elementId) => findScopeStatementById(parsed.figure.body, elementId) != null)
  );
  const matrixElementIdSet = new Set(matrixElementIds);
  const treeRootElementIdSet = new Set(treeRootElementIds);
  const changedSourceIds = expandChangedSourceIdsForMovedElements(parsed.figure.body, requestedIds, editHandles);
  // Returning a drag to its origin must also preserve the original spelling
  // and precision of coordinates, including values that cannot be formatted
  // exactly by the normal coordinate writer.
  if (baseline && Math.abs(delta.x) < 1e-6 && Math.abs(delta.y) < 1e-6) {
    return { kind: "success", newSource: source, patches: [], changedSourceIds };
  }
  const nonMatrixElementIds = normalizedIds.filter(
    (elementId) => !matrixElementIdSet.has(elementId) && !scopeElementIdSet.has(elementId) && !treeRootElementIdSet.has(elementId)
  );
  const scopeElementIds = normalizedIds.filter((elementId) => scopeElementIdSet.has(elementId));

  const matrixPlacementHandlesBySource = new Map<string, EditHandle>();
  for (const handle of editHandles) {
    if (handle.kind !== "node-position" || !matrixElementIdSet.has(handle.sourceRef.sourceId)) {
      continue;
    }
    if (!matrixPlacementHandlesBySource.has(handle.sourceRef.sourceId)) {
      matrixPlacementHandlesBySource.set(handle.sourceRef.sourceId, handle);
    }
  }

  let currentSource = source;
  const patches: SourcePatch[] = [];
  const skippedHandles: string[] = [];
  const reasons: string[] = [];
  let movedAny = false;
  const movedSourceDeltas = new Map<string, WorldPoint>();
  const inheritedSourceIds = new Set<string>();

  if (nonMatrixElementIds.length > 0) {
    const centerPlan = planCenteredPivotMoves(source, editHandles, new Map(nonMatrixElementIds.map(id => [id, delta])), parseOptions, geometry);
    if (centerPlan.kind === "unsupported") return centerPlan;
    const byHandles = applyMoveElementsUsingHandleRewrites(currentSource, editHandles, nonMatrixElementIds, delta, parseOptions, centerPlan);
    if (byHandles.kind === "error") {
      return byHandles;
    }
    if (byHandles.kind === "success" || byHandles.kind === "partial") {
      currentSource = byHandles.newSource;
      patches.push(...byHandles.patches);
      movedAny = true;
      for (const elementId of nonMatrixElementIds) {
        movedSourceDeltas.set(elementId, delta);
      }
      if (byHandles.kind === "partial") {
        skippedHandles.push(...byHandles.skippedHandles);
        reasons.push(byHandles.reason);
      }
    } else {
      reasons.push(byHandles.reason);
    }
  }

  if (matrixElementIds.length > 0) {
    const byMatrixPlacement = applyMoveMatrixElementsWithPlacementRewrite(
      currentSource,
      matrixElementIds,
      delta,
      matrixPlacementHandlesBySource,
      parseOptions,
      geometry
    );
    if (byMatrixPlacement.kind === "success" || byMatrixPlacement.kind === "partial") {
      currentSource = byMatrixPlacement.newSource;
      patches.push(...byMatrixPlacement.patches);
      movedAny = true;
      for (const elementId of matrixElementIds) movedSourceDeltas.set(elementId, delta);
      if (byMatrixPlacement.kind === "partial") {
        reasons.push(byMatrixPlacement.reason);
      }
    } else {
      reasons.push(byMatrixPlacement.reason);
    }
  }

  if (treeRootElementIds.length > 0) {
    const byTreeRootPlacement = applyMoveTreeRootElementsWithPlacementRewrite(
      currentSource,
      treeRootElementIds,
      delta,
      parseOptions,
      geometry
    );
    if (byTreeRootPlacement.kind === "success" || byTreeRootPlacement.kind === "partial") {
      currentSource = byTreeRootPlacement.newSource;
      patches.push(...byTreeRootPlacement.patches);
      movedAny = true;
      for (const elementId of treeRootElementIds) movedSourceDeltas.set(elementId, delta);
      if (byTreeRootPlacement.kind === "partial") {
        reasons.push(byTreeRootPlacement.reason);
      }
    } else {
      reasons.push(byTreeRootPlacement.reason);
    }
  }

  if (scopeElementIds.length > 0) {
    const byScopeTransform = applyMoveScopeElementsWithTransformRewrite(
      currentSource,
      scopeElementIds,
      delta,
      formatPrecision,
      parseOptions,
      geometry
    );
    if (byScopeTransform.kind === "success" || byScopeTransform.kind === "partial") {
      currentSource = byScopeTransform.newSource;
      patches.push(...byScopeTransform.patches);
      movedAny = true;
      for (const sourceId of expandChangedSourceIdsForMovedElements(parsed.figure.body, scopeElementIds, editHandles)) {
        movedSourceDeltas.set(sourceId, delta);
        inheritedSourceIds.add(sourceId);
      }
      if (byScopeTransform.kind === "partial") {
        reasons.push(byScopeTransform.reason);
      }
    } else {
      reasons.push(byScopeTransform.reason);
    }
  }

  if (!movedAny) {
    return {
      kind: "unsupported",
      reason: reasons[0] ?? "No coordinate rewrites succeeded"
    };
  }

  const dependencyCorrected = correctMovedCoordinateDependencies(source, currentSource, editHandles, movedSourceDeltas, parseOptions, geometry, inheritedSourceIds);
  if (dependencyCorrected == null) {
    return { kind: "unsupported", reason: "Could not preserve dependencies between the selected coordinates." };
  }
  if (dependencyCorrected !== currentSource) {
    currentSource = dependencyCorrected;
    patches.splice(0, patches.length, computeMinimalReplacementPatch(source, currentSource));
  }

  const uniqueReasons = uniqueStrings(reasons);
  if (uniqueReasons.length > 0 || skippedHandles.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: uniqueStrings(skippedHandles),
      changedSourceIds,
      reason:
        uniqueReasons.length > 0
          ? uniqueReasons.join(" ")
          : "Some handles use unsupported coordinate forms and were skipped"
    };
  }

  return { kind: "success", newSource: currentSource, patches, changedSourceIds };
}

export function applyAlignElementsAction(
  source: string,
  action: AlignElementsAction,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(action.elementIds);
  if (normalizedIds.length < 2) {
    return { kind: "unsupported", reason: "Align requires at least 2 selected elements." };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const semantic = geometry?.semantic ?? evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = geometry?.boundsBySource ?? collectSourceWorldBounds(semantic.scene.elements);
  const plan = planAlignDeltas(boundsBySource, normalizedIds, action.mode);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas, parseOptions, geometry);
}

export function applyDistributeElementsAction(
  source: string,
  action: DistributeElementsAction,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(action.elementIds);
  if (normalizedIds.length < 3) {
    return { kind: "unsupported", reason: "Distribute requires at least 3 selected elements." };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const semantic = geometry?.semantic ?? evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = geometry?.boundsBySource ?? collectSourceWorldBounds(semantic.scene.elements);
  const plan = planDistributeDeltas(boundsBySource, normalizedIds, action.axis);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas, parseOptions, geometry);
}

function applyMoveElementsUsingHandleRewrites(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: WorldPoint,
  parseOptions: EditParseOptions = {},
  centerPlan?: Extract<CenteredPivotMovePlan, { kind: "success" }>
): EditActionResultLike {
  const sourceIdSet = new Set(elementIds);
  const elementHandles = editHandles.filter((handle) => sourceIdSet.has(handle.sourceRef.sourceId));

  if (elementHandles.length === 0) {
    return { kind: "unsupported", reason: "No handles found for the selected element(s)" };
  }

  const rewritable = elementHandles.filter((handle) => handle.rewriteMode !== "unsupported");
  const skippedHandles = elementHandles
    .filter((handle) => handle.rewriteMode === "unsupported")
    .map((handle) => handle.id);

  if (rewritable.length === 0) {
    return {
      kind: "unsupported",
      reason: "All handles for the selected element(s) use unsupported coordinate forms"
    };
  }

  const sourceFingerprint = sourceFingerprintForEdit(source, parseOptions);
  if (rewritable.some((handle) => handle.sourceRef.sourceFingerprint !== sourceFingerprint)) {
    return { kind: "error", message: "Handle does not match current source (stale handle)." };
  }
  const spanCounts = new Map<string, number>();
  for (const handle of editHandles) {
    const key = `${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`;
    spanCounts.set(key, (spanCounts.get(key) ?? 0) + 1);
  }
  if (rewritable.some((handle) =>
    spanCounts.get(`${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`)! > 1)) {
    return { kind: "unsupported", reason: "Handle span is shared by expanded statements (foreach/macro), cannot move safely." };
  }

  type PendingReplacement = { span: { from: number; to: number }; text: string };
  const pending: PendingReplacement[] = [...(centerPlan?.replacements ?? [])];
  let deferredDependencies = false;

  for (const handle of rewritable) {
    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      if (centerPlan?.framesBySource.has(handle.sourceRef.sourceId)) return { kind: "unsupported", reason: "Some selected handles are stale. Wait for recompute and try again." };
      skippedHandles.push(handle.id);
      continue;
    }

    // Keep authored offsets until all direct coordinates and ancestor frames
    // have moved. The shared dependency pass then uses their fresh bases.
    if (handle.rewriteMode === "delta" || handle.handleType === "node-positioning") {
      deferredDependencies = true;
      continue;
    }

    const newWorld: WorldPoint = worldPoint(pt(handle.world.x + delta.x), pt(handle.world.y + delta.y));
    const frame = centerPlan?.framesBySource.get(handle.sourceRef.sourceId);
    const text = frame ? rewritePreciseFrameCoordinate(newWorld, handleWithFrame(handle, frame), source, parseOptions.bypassSnapping)
      : rewriteCoordinate(newWorld, handle, source, parseOptions.bypassSnapping);
    if (text != null) {
      pending.push({ span: handle.sourceRef.sourceSpan, text });
    } else {
      if (frame) return { kind: "unsupported", reason: "Could not rewrite every coordinate together with the moved center pivot." };
      skippedHandles.push(handle.id);
    }
  }

  if (pending.length === 0 && !deferredDependencies) {
    return { kind: "unsupported", reason: "No coordinate rewrites succeeded" };
  }

  pending.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return right.span.from - left.span.from;
    }
    return right.span.to - left.span.to;
  });

  let currentSource = source;
  const patches: SourcePatch[] = [];
  for (const replacement of pending) {
    const updated = replaceSpan(currentSource, replacement.span, replacement.text);
    patches.push({
      oldSpan: replacement.span,
      newSpan: updated.changedSpan,
      replacement: replacement.text
    });
    currentSource = updated.source;
  }

  if (skippedHandles.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles,
      reason: "Some handles use unsupported coordinate forms and were skipped"
    };
  }

  return { kind: "success", newSource: currentSource, patches };
}

function applyMoveMatrixElementsWithPlacementRewrite(
  source: string,
  elementIds: readonly string[],
  delta: WorldPoint,
  placementHandlesBySource: ReadonlyMap<string, EditHandle>,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): MoveRewriteBatchResult {
  let currentSource = source;
  const patches: SourcePatch[] = [];
  const failedElementIds: string[] = [];
  const failureReasons: string[] = [];

  for (const elementId of elementIds) {
    const placementHandle = placementHandlesBySource.get(elementId);
    const rewrite = rewriteSingleMatrixPlacement(currentSource, elementId, delta, placementHandle, parseOptions, geometry);
    if (rewrite.kind === "unsupported") {
      failedElementIds.push(elementId);
      failureReasons.push(rewrite.reason);
      continue;
    }

    currentSource = rewrite.source;
    patches.push(...rewrite.patches);
  }

  if (patches.length === 0) {
    return {
      kind: "unsupported",
      reason: failureReasons[0]
    };
  }

  if (failedElementIds.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: [],
      reason: `Could not move some matrix elements (${failedElementIds.join(", ")}): ${uniqueStrings(failureReasons).join(" ")}`
    };
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches
  };
}

function applyMoveScopeElementsWithTransformRewrite(
  source: string,
  elementIds: readonly string[],
  delta: WorldPoint,
  formatPrecision: DragFormatPrecision | undefined,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): MoveRewriteBatchResult {
  let currentSource = source;
  const patches: SourcePatch[] = [];
  const failedElementIds: string[] = [];
  const failureReasons: string[] = [];

  for (const elementId of elementIds) {
    const rewrite = rewriteSingleScopeTransform(currentSource, elementId, delta, formatPrecision, parseOptions, geometry);
    if (rewrite.kind === "unsupported") {
      failedElementIds.push(elementId);
      failureReasons.push(rewrite.reason);
      continue;
    }

    currentSource = rewrite.source;
    patches.push(...rewrite.patches);
  }

  if (patches.length === 0) {
    return {
      kind: "unsupported",
      reason: failureReasons[0]
    };
  }

  if (failedElementIds.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: [],
      reason: `Could not move some scopes (${failedElementIds.join(", ")}): ${uniqueStrings(failureReasons).join(" ")}`
    };
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches
  };
}

type ScopeTransformRewriteResult =
  | { kind: "success"; source: string; patches: SourcePatch[] }
  | { kind: "unsupported"; reason: string };

function rewriteSingleScopeTransform(
  source: string,
  elementId: string,
  delta: WorldPoint,
  formatPrecision: DragFormatPrecision | undefined,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): ScopeTransformRewriteResult {
  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind !== "found") {
    return { kind: "unsupported", reason: `Scope ${elementId} was not found` };
  }
  const entries = resolved.target.options?.entries ?? [];
  const mutations = planOrderedScopeTranslation(entries, delta,
    prefix => resolveStatementOptionFrame(source, elementId, prefix, parseOptions, geometry), formatPrecision);
  if (!mutations) {
    return { kind: "unsupported", reason: "Could not map scope movement into its authored coordinate frame." };
  }
  const rewritten = applyOptionMutationsToTarget(source, resolved.target, mutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: `Scope ${elementId} already matches the requested position` };
  }
  return { kind: "success", source: rewritten.source, patches: [rewritten.patch] };
}

/** Plan source-local shifts in the actual ordered frame at each editable entry.
 * Scope resize uses the same boundary after changing the scale entries. */
export function planOrderedScopeTranslation(
  entries: readonly OptionEntry[],
  delta: WorldPoint,
  resolveFrame: (entries: readonly OptionEntry[]) => FrameTransform | undefined,
  formatPrecision: DragFormatPrecision | undefined,
  appendIndex = entries.length
): Map<string, OptionMutation> | null {
  if (Math.abs(delta.x) < 1e-10 && Math.abs(delta.y) < 1e-10) return new Map();
  const keyed = entries.flatMap((entry, index) => entry.kind === "kv"
    ? [{ entry, index, key: normalizeOptionKey(entry.key).replace(/^\/tikz\//, "") }] : []);
  const shifts = keyed.filter(({ key }) => key === "shift");
  if (shifts.length === 1) {
    const shift = shifts[0];
    const old = parseRotateAroundPivotRaw(shift.entry.valueRaw);
    const prefix = resolveFrame(entries.slice(0, shift.index));
    const localDelta = prefix ? applyInverseLinear(prefix, delta) : null;
    if (old && localDelta) {
      const pair = parseCoordinateLike(shift.entry.valueRaw.trim().replace(/^\{([\s\S]*)\}$/, "$1"));
      const x = Math.abs(localDelta.x) < 1e-10 && pair ? pair.x : formatScopeShiftValue(old.x + localDelta.x, formatPrecision) ?? "0pt";
      const y = Math.abs(localDelta.y) < 1e-10 && pair ? pair.y : formatScopeShiftValue(old.y + localDelta.y, formatPrecision) ?? "0pt";
      return new Map([[normalizeOptionKey(shift.entry.key), { kind: "set", value: `(${x},${y})` }]]);
    }
  }
  const xEntries = keyed.filter(({ key }) => key === "xshift");
  const yEntries = keyed.filter(({ key }) => key === "yshift");
  if (xEntries.length > 1 || yEntries.length > 1) return null;
  const xEntry = xEntries[0], yEntry = yEntries[0];
  const oldX = xEntry ? parseLength(xEntry.entry.valueRaw, "pt") : 0;
  const oldY = yEntry ? parseLength(yEntry.entry.valueRaw, "pt") : 0;
  if (oldX == null || oldY == null) return null;
  const prefixX = resolveFrame(entries.slice(0, xEntry?.index ?? appendIndex));
  const prefixY = resolveFrame(entries.slice(0, yEntry?.index ?? appendIndex));
  if (!prefixX || !prefixY) return null;
  const localDelta = applyInverseLinear({ a: prefixX.a, b: prefixX.b, c: prefixY.c, d: prefixY.d }, delta);
  if (!localDelta) return null;
  const mutations = new Map<string, OptionMutation>();
  for (const [key, value, correction] of [
    [xEntry ? normalizeOptionKey(xEntry.entry.key) : "xshift", oldX + localDelta.x, localDelta.x],
    [yEntry ? normalizeOptionKey(yEntry.entry.key) : "yshift", oldY + localDelta.y, localDelta.y]
  ] as const) {
    if (Math.abs(correction) < 1e-10 && value !== 0) continue;
    const formatted = formatScopeShiftValue(value, formatPrecision);
    mutations.set(key, formatted == null ? { kind: "remove" } : { kind: "set", value: formatted });
  }
  return mutations;
}

export function mutateOrderedOptionEntries(
  entries: readonly OptionEntry[],
  mutations: ReadonlyMap<string, OptionMutation>
): OptionEntry[] {
  const emitted = new Set<string>();
  const result: OptionEntry[] = [];
  for (const entry of entries) {
    const key = entry.kind === "kv" || entry.kind === "flag" ? normalizeOptionKey(entry.key) : "";
    const mutation = mutations.get(key);
    if (!mutation) { result.push(entry); continue; }
    if (mutation.kind === "set" && !emitted.has(key)) {
      result.push({ ...entry, kind: "kv", key, valueRaw: mutation.value, raw: `${key}=${mutation.value}` });
      emitted.add(key);
    }
  }
  for (const [key, mutation] of mutations) {
    if (mutation.kind === "set" && !emitted.has(key)) {
      result.push({ kind: "kv", key, valueRaw: mutation.value, raw: `${key}=${mutation.value}`, span: { from: 0, to: 0 } });
    }
  }
  return result;
}

function formatScopeShiftValue(value: number, formatPrecision: DragFormatPrecision | undefined): string | null {
  const formatted = formatNumber(value, pointDistanceFormatOptions(formatPrecision));
  return Number(formatted) === 0 ? null : `${formatted}pt`;
}

function applyInverseLinear(linear: Pick<FrameTransform, "a" | "b" | "c" | "d">, point: WorldPoint): WorldPoint | null {
  const det = linear.a * linear.d - linear.b * linear.c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) return null;
  return worldPoint(pt((linear.d * point.x - linear.c * point.y) / det), pt((-linear.b * point.x + linear.a * point.y) / det));
}

type MatrixPlacementRewriteResult =
  | { kind: "success"; source: string; patches: SourcePatch[] }
  | { kind: "unsupported"; reason: string };

function applyMoveTreeRootElementsWithPlacementRewrite(
  source: string,
  elementIds: readonly string[],
  delta: WorldPoint,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): MoveRewriteBatchResult {
  let currentSource = source;
  const patches: SourcePatch[] = [];
  const failedElementIds: string[] = [];
  const failureReasons: string[] = [];

  for (const elementId of elementIds) {
    const rewrite = rewriteSingleTreeRootPlacement(currentSource, elementId, delta, parseOptions, geometry);
    if (rewrite.kind === "unsupported") {
      failedElementIds.push(elementId);
      failureReasons.push(rewrite.reason);
      continue;
    }

    currentSource = rewrite.source;
    patches.push(...rewrite.patches);
  }

  if (patches.length === 0) {
    return {
      kind: "unsupported",
      reason: failureReasons[0]
    };
  }

  if (failedElementIds.length > 0) {
    return {
      kind: "partial",
      newSource: currentSource,
      patches,
      skippedHandles: [],
      reason: `Could not move some tree roots (${failedElementIds.join(", ")}): ${uniqueStrings(failureReasons).join(" ")}`
    };
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches
  };
}

function rewriteSingleMatrixPlacement(
  source: string,
  elementId: string,
  delta: WorldPoint,
  placementHandle: EditHandle | undefined,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): MatrixPlacementRewriteResult {
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const statement = findPathStatementById(parsed.figure.body, elementId);
  if (!statement) {
    return { kind: "unsupported", reason: `Could not resolve matrix statement ${elementId}` };
  }
  const matrixNode = findPrimaryMatrixNodeItem(statement);
  if (!matrixNode) {
    return { kind: "unsupported", reason: `Could not resolve matrix node for ${elementId}` };
  }

  const semantic = geometry?.semantic ?? evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = geometry?.boundsBySource ?? collectSourceWorldBounds(semantic.scene.elements);
  const bounds = boundsBySource.get(elementId);
  if (!bounds) {
    return { kind: "unsupported", reason: `Could not resolve semantic bounds for matrix ${elementId}` };
  }

  const nextCenterWorld: WorldPoint = worldPoint(
    pt((bounds.minX + bounds.maxX) / 2 + delta.x),
    pt((bounds.minY + bounds.maxY) / 2 + delta.y)
  );
  const nextCoordinate = formatPlacementCoordinateFromWorld(
    nextCenterWorld,
    placementHandle?.handleType === "coordinate" && placementHandle.coordinateSpace === "frame-local"
      ? placementHandle.frame
      : undefined
  );

  const inlineAtCoordinate = findInlineAtCoordinateItem(statement);
  if (inlineAtCoordinate) {
    const rewrittenInline = replaceSourceSpan(source, inlineAtCoordinate.span, nextCoordinate);
    if (rewrittenInline) {
      return { kind: "success", source: rewrittenInline.source, patches: [rewrittenInline.patch] };
    }
    return {
      kind: "unsupported",
      reason: `Matrix ${elementId} placement already matches the requested position`
    };
  }

  const atOptionEntry = matrixNode.options?.entries.find(
    (entry): entry is Extract<OptionEntry, { kind: "kv" }> => entry.kind === "kv" && entry.key === "at"
  );
  const matrixTarget = resolvePropertyTarget(source, elementId, parseOptions);
  if (matrixTarget.kind === "found" && matrixTarget.target.kind === "matrix-statement") {
    const bodyOpenOffset = matrixTarget.target.matrixBodyOpenOffset;
    if (bodyOpenOffset == null) {
      return { kind: "unsupported", reason: `Could not resolve matrix body opening for ${elementId}` };
    }

    if (atOptionEntry) {
      const targetOptions = matrixTarget.target.options;
      const targetOptionsSpan = matrixTarget.target.optionsSpan;
      if (!targetOptions || !targetOptionsSpan) {
        return { kind: "unsupported", reason: `Could not resolve matrix options for ${elementId}` };
      }
      const optionReplacement = rewriteSourceBackedOptionListMutations(
        source,
        targetOptionsSpan,
        targetOptions,
        new Map<string, OptionMutation>([["at", { kind: "remove" }]]),
        matrixTarget.target.optionsFormat
      );
      const applied = applyTextReplacements(source, [
        { span: targetOptionsSpan, text: optionReplacement },
        {
          span: { from: bodyOpenOffset, to: bodyOpenOffset },
          text: buildMatrixInlineAtInsertion(source, bodyOpenOffset, nextCoordinate)
        }
      ]);
      return {
        kind: "success",
        source: applied.source,
        patches: applied.patches
      };
    }

    const rewrittenInlineInsertion = replaceSourceSpan(
      source,
      { from: bodyOpenOffset, to: bodyOpenOffset },
      buildMatrixInlineAtInsertion(source, bodyOpenOffset, nextCoordinate)
    );
    if (!rewrittenInlineInsertion) {
      return { kind: "unsupported", reason: `Matrix ${elementId} placement already matches the requested position` };
    }
    return { kind: "success", source: rewrittenInlineInsertion.source, patches: [rewrittenInlineInsertion.patch] };
  }

  return {
    kind: "unsupported",
    reason: `Could not rewrite matrix placement for ${elementId}`
  };
}

function rewriteSingleTreeRootPlacement(
  source: string,
  elementId: string,
  delta: WorldPoint,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): MatrixPlacementRewriteResult {
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const statement = findPathStatementById(parsed.figure.body, elementId);
  if (!statement) {
    return { kind: "unsupported", reason: `Could not resolve tree root statement ${elementId}` };
  }
  const rootNode = findPrimaryTreeRootNodeItem(statement);
  if (!rootNode) {
    return { kind: "unsupported", reason: `Tree root ${elementId} has no root node to move` };
  }

  const semantic = geometry?.semantic ?? evaluateTikzFigure(parsed.figure, source);
  const placementHandle = semantic.editHandles.find(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "node-position"
  );
  const currentPlacementWorld =
    placementHandle?.world ??
    (() => {
      const boundsBySource = geometry?.boundsBySource ?? collectSourceWorldBounds(semantic.scene.elements);
      const bounds = boundsBySource.get(elementId);
      if (!bounds) {
        return null;
      }
      return worldPoint(
        pt((bounds.minX + bounds.maxX) / 2),
        pt((bounds.minY + bounds.maxY) / 2)
      );
    })();
  if (!currentPlacementWorld) {
    return { kind: "unsupported", reason: `Could not resolve semantic placement for tree root ${elementId}` };
  }
  const nextPlacementWorld: WorldPoint = worldPoint(
    pt(currentPlacementWorld.x + delta.x),
    pt(currentPlacementWorld.y + delta.y)
  );
  const nextCoordinate = formatPlacementCoordinateFromWorld(
    nextPlacementWorld,
    placementHandle?.handleType === "coordinate" && placementHandle.coordinateSpace === "frame-local"
      ? placementHandle.frame
      : undefined
  );

  const atOptionEntry = rootNode.options?.entries
    .filter((entry): entry is Extract<typeof entry, { kind: "kv" }> => entry.kind === "kv")
    .find((entry) => normalizeOptionKey(entry.key) === "at");
  const rootPlacementComesFromOption =
    atOptionEntry != null && rootNode.atSpan != null && spansEqual(atOptionEntry.span, rootNode.atSpan);

  if (rootNode.atSpan && !rootPlacementComesFromOption) {
    const rewrittenAt = replaceSourceSpan(source, rootNode.atSpan, nextCoordinate);
    if (rewrittenAt) {
      return { kind: "success", source: rewrittenAt.source, patches: [rewrittenAt.patch] };
    }
    return {
      kind: "unsupported",
      reason: `Tree root ${elementId} placement already matches the requested position`
    };
  }

  if (atOptionEntry) {
    const rewrittenOption = replaceSourceSpan(source, atOptionEntry.span, `at=${nextCoordinate}`);
    if (rewrittenOption) {
      return { kind: "success", source: rewrittenOption.source, patches: [rewrittenOption.patch] };
    }
    return {
      kind: "unsupported",
      reason: `Tree root ${elementId} placement already matches the requested position`
    };
  }

  const insertionOffset = resolveTreeRootNodePlacementInsertionOffset(rootNode, source);
  const inserted = replaceSourceSpan(source, { from: insertionOffset, to: insertionOffset }, ` at ${nextCoordinate}`);
  if (!inserted) {
    return { kind: "unsupported", reason: `Tree root ${elementId} placement already matches the requested position` };
  }
  return { kind: "success", source: inserted.source, patches: [inserted.patch] };
}

function applyElementDeltaMapStrict(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  deltasBySource: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for arrange operation." };
  }

  const sourceIdSet = new Set(normalizedIds);
  const selectedHandles = editHandles.filter((handle) => sourceIdSet.has(handle.sourceRef.sourceId));
  if (selectedHandles.length === 0) {
    return { kind: "unsupported", reason: "No handles found for the selected element(s)." };
  }

  const handlesBySource = new Map<string, EditHandle[]>();
  for (const handle of selectedHandles) {
    const existing = handlesBySource.get(handle.sourceRef.sourceId);
    if (existing) {
      existing.push(handle);
    } else {
      handlesBySource.set(handle.sourceRef.sourceId, [handle]);
    }
  }

  for (const sourceId of normalizedIds) {
    const handles = handlesBySource.get(sourceId) ?? [];
    if (handles.length === 0) {
      return {
        kind: "unsupported",
        reason: `No handles found for selected element: ${sourceId}.`
      };
    }
    if (handles.some((handle) => handle.rewriteMode === "unsupported")) {
      return {
        kind: "unsupported",
        reason: "One or more selected elements use unsupported coordinate forms."
      };
    }
  }

  const centerPlan = planCenteredPivotMoves(source, editHandles, deltasBySource, parseOptions, geometry);
  if (centerPlan.kind === "unsupported") return centerPlan;
  type PendingReplacement = { span: { from: number; to: number }; text: string };
  const pending: PendingReplacement[] = [...centerPlan.replacements];
  const replacementBySpan = new Map<string, string>();

  for (const handle of selectedHandles) {
    const delta = deltasBySource.get(handle.sourceRef.sourceId) ?? { x: 0, y: 0 };
    if (Math.abs(delta.x) <= ARRANGE_EPSILON && Math.abs(delta.y) <= ARRANGE_EPSILON) {
      continue;
    }

    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      return {
        kind: "unsupported",
        reason: "Some selected handles are stale. Wait for recompute and try again."
      };
    }

    if (handle.rewriteMode === "delta" || handle.handleType === "node-positioning") continue;

    const next = worldPoint(pt(handle.world.x + delta.x), pt(handle.world.y + delta.y));
    const frame = centerPlan.framesBySource.get(handle.sourceRef.sourceId);
    const text = frame ? rewritePreciseFrameCoordinate(next, handleWithFrame(handle, frame), source) : rewriteCoordinate(next, handle, source);
    if (text == null) {
      return {
        kind: "unsupported",
        reason: "Could not rewrite one or more selected coordinates."
      };
    }

    const spanKey = `${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`;
    const existing = replacementBySpan.get(spanKey);
    if (existing != null) {
      if (existing !== text) {
        return {
          kind: "unsupported",
          reason: "Arrange operation found conflicting rewrites for a shared coordinate span."
        };
      }
      continue;
    }

    replacementBySpan.set(spanKey, text);
    pending.push({ span: handle.sourceRef.sourceSpan, text });
  }

  if (pending.length === 0 && !selectedHandles.some((handle) =>
    handle.rewriteMode === "delta" || handle.handleType === "node-positioning")) {
    return { kind: "unsupported", reason: "Arrange operation would not change the source." };
  }

  pending.sort((left, right) => {
    if (left.span.from !== right.span.from) {
      return right.span.from - left.span.from;
    }
    return right.span.to - left.span.to;
  });

  let currentSource = source;
  const patches: SourcePatch[] = [];
  for (const replacement of pending) {
    const updated = replaceSpan(currentSource, replacement.span, replacement.text);
    patches.push({
      oldSpan: replacement.span,
      newSpan: updated.changedSpan,
      replacement: replacement.text
    });
    currentSource = updated.source;
  }

  const dependencyCorrected = correctMovedCoordinateDependencies(source, currentSource, editHandles, deltasBySource, parseOptions, geometry);
  if (dependencyCorrected == null) {
    return { kind: "unsupported", reason: "Could not preserve dependencies between the arranged coordinates." };
  }
  if (dependencyCorrected !== currentSource) {
    currentSource = dependencyCorrected;
    patches.splice(0, patches.length, computeMinimalReplacementPatch(source, currentSource));
  }

  if (currentSource === source) {
    return { kind: "unsupported", reason: "Arrange operation would not change the source." };
  }

  return {
    kind: "success",
    newSource: currentSource,
    patches,
    changedSourceIds: normalizedIds
  };
}

function handleWithFrame(handle: EditHandle, frame: FrameTransform): EditHandle {
  return isFrameLocalCoordinateEditHandle(handle) ? { ...handle, frame,
    transform: worldTransform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f) } : handle;
}

function parseRotateAroundPivotRaw(raw: string): WorldPoint | null {
  const coordinate = parseCoordinateLike(raw.trim().replace(/^\{([\s\S]*)\}$/, "$1"));
  if (!coordinate) {
    return null;
  }
  const x = parseLength(coordinate.x, "cm");
  const y = parseLength(coordinate.y, "cm");
  if (x == null || y == null) {
    return null;
  }
  return worldPoint(pt(x), pt(y));
}

function replaceSourceSpan(
  source: string,
  span: Span,
  replacement: string
): { source: string; patch: SourcePatch } | null {
  const previous = source.slice(span.from, span.to);
  if (previous === replacement) {
    return null;
  }
  const updated = replaceSpan(source, span, replacement);
  return {
    source: updated.source,
    patch: {
      oldSpan: span,
      newSpan: updated.changedSpan,
      replacement
    }
  };
}

function spansEqual(left: Span, right: Span): boolean {
  return left.from === right.from && left.to === right.to;
}

function buildMatrixInlineAtInsertion(source: string, bodyOpenOffset: number, nextCoordinate: string): string {
  const needsLeadingSpace = !/\s/u.test(source[bodyOpenOffset - 1]);
  return `${needsLeadingSpace ? " " : ""}at ${nextCoordinate} `;
}

function formatPlacementCoordinateFromWorld(world: WorldPoint, transform?: EditHandle["frame"]): string {
  if (transform) {
    const local = worldToLocal(world, transform);
    if (local) {
      const inSourceUnits = localToSourceUnits(local);
      return `(${formatNumber(inSourceUnits.x)},${formatNumber(inSourceUnits.y)})`;
    }
  }

  return `(${formatNumber(world.x * CM_PER_PT)},${formatNumber(world.y * CM_PER_PT)})`;
}

function findPrimaryMatrixNodeItem(statement: PathStatement): NodeItem | null {
  for (const item of statement.items) {
    if (item.kind === "Node" && isMatrixNodeItem(item)) {
      return item;
    }
  }
  return null;
}

function findInlineAtCoordinateItem(statement: PathStatement): CoordinateItem | null {
  for (let index = 0; index < statement.items.length - 1; index += 1) {
    const item = statement.items[index];
    const next = statement.items[index + 1];
    if (item.kind === "PathKeyword" && item.keyword === "at" && next.kind === "Coordinate") {
      return next;
    }
  }
  return null;
}

function isMatrixPathStatement(statement: PathStatement): boolean {
  return statement.items.some((item) => item.kind === "Node" && isMatrixNodeItem(item));
}

function isTreeRootPathStatement(statement: PathStatement): boolean {
  return statement.items.some((item) => item.kind === "ChildOperation");
}

function findPrimaryTreeRootNodeItem(statement: PathStatement): NodeItem | null {
  for (const item of statement.items) {
    if (item.kind === "Node") {
      return item;
    }
  }
  return null;
}

function resolveTreeRootNodePlacementInsertionOffset(node: NodeItem, source: string): number {
  if (node.textSource === "group" && node.textSpan.from > node.span.from && source[node.textSpan.from - 1] === "{") {
    return node.textSpan.from - 1;
  }
  return node.span.to;
}

function isMatrixNodeItem(item: NodeItem): boolean {
  for (const entry of item.options?.entries ?? []) {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "matrix" || entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      return true;
    }
  }
  return false;
}

function findScopeStatementById(
  statements: readonly Statement[],
  scopeId: string
): Extract<Statement, { kind: "Scope" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Scope" && statement.id === scopeId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findScopeStatementById(statement.body, scopeId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function expandChangedSourceIdsForMovedElements(
  statements: readonly Statement[],
  elementIds: readonly string[],
  editHandles: readonly EditHandle[] = []
): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();

  const push = (sourceId: string) => {
    const normalized = sourceId.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    expanded.push(normalized);
  };

  const visitScope = (scope: Extract<Statement, { kind: "Scope" }>) => {
    push(scope.id);
    for (const statement of scope.body) {
      push(statement.id);
      if (statement.kind === "Scope") {
        visitScope(statement);
      }
    }
  };

  for (const elementId of elementIds) {
    const scope = findScopeStatementById(statements, elementId);
    if (!scope) {
      push(elementId);
      continue;
    }
    visitScope(scope);
    for (const handle of editHandles) {
      if (containsSpan(scope.span, handle.sourceRef.sourceSpan)) push(handle.sourceRef.sourceId);
    }
  }

  return expanded;
}

/** A selected scope owns its descendants' translation; preserve all requested
 * ids separately for invalidation and editor identity reconciliation. */
function collapseMovedScopeDescendants(
  statements: readonly Statement[],
  elementIds: readonly string[],
  editHandles: readonly EditHandle[]
): string[] {
  const selectedScopes = elementIds.flatMap((id) => {
    const scope = findScopeStatementById(statements, id);
    return scope ? [scope] : [];
  });
  if (selectedScopes.length === 0) return [...elementIds];
  const spansBySource = new Map<string, Span>();
  const visit = (body: readonly Statement[]) => {
    for (const statement of body) {
      spansBySource.set(statement.id, statement.span);
      if (statement.kind === "Scope") visit(statement.body);
    }
  };
  visit(statements);
  for (const handle of editHandles) {
    if (!spansBySource.has(handle.sourceRef.sourceId)) {
      spansBySource.set(handle.sourceRef.sourceId, handle.sourceRef.sourceSpan);
    }
  }
  return elementIds.filter((id) => {
    const span = spansBySource.get(id);
    return !span || !selectedScopes.some((scope) => scope.id !== id && containsSpan(scope.span, span));
  });
}

function containsSpan(parent: Span, child: Span): boolean {
  return parent.from <= child.from && parent.to >= child.to;
}
