import type { EditActionResultLike } from "../result-types.js";
import type { CoordinateItem, NodeItem, PathItem, PathStatement, Span, Statement } from "../../ast/types.js";
import { pt } from "../../coords/scalars.js";
import type { OptionEntry } from "../../options/types.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import type { EditHandle } from "../../semantic/types.js";
import type { ScenePathShapeHint } from "../../semantic/types.js";
import { parseCoordinateLike, parseLength } from "../../semantic/coords/parse-length.js";
import { collectSourceWorldBounds } from "../snapping/index.js";
import { localToSourceUnits, worldToLocal } from "../coords.js";
import { CM_PER_PT, formatNumber, pointDistanceFormatOptions, type DragFormatPrecision } from "../format.js";
import {
  buildTransformSetPropertyMutations,
  resolveTransformInspectorMutationContextFromOptionEntries
} from "../property-write-builders.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget, type PropertyTarget } from "../property-target.js";
import { rewriteCoordinate } from "../rewrite.js";
import { applyTextReplacements } from "../statement-ops.js";
import type { SourcePatch } from "../types.js";
import { planAlignDeltas, planDistributeDeltas, type AlignMode, type DistributeAxis } from "../arrange.js";
import { applyOptionMutationsToTarget, rewriteOptionListMutations, type OptionMutation } from "../option-mutations.js";
import { parseTikzForEdit, sourceFingerprintForEdit, type EditParseOptions } from "../parse-options.js";
import { normalizeOptionKey } from "../option-key.js";
import { FIT_DIRECT_MANIPULATION_BLOCK_REASON, sourceUsesFitNodeFromParseResult } from "../fit.js";
import { findPathStatementById, normalizeElementIds, uniqueStrings } from "../statement-find.js";

const ARRANGE_EPSILON = 1e-6;
const CENTER_PIVOT_EPSILON = 1e-3;


type KeyValueOptionEntry = Extract<OptionEntry, { kind: "kv" }>;
type KeyValueOptionCandidate = { entry: KeyValueOptionEntry; index: number };
type MoveRewriteBatchResult = Exclude<EditActionResultLike, { kind: "error" }>;

export type AlignElementsAction = { elementIds: string[]; mode: AlignMode };
export type DistributeElementsAction = { elementIds: string[]; axis: DistributeAxis };

export function applyMoveElementsAction(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: WorldPoint,
  formatPrecision: DragFormatPrecision | undefined,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(elementIds);
  if (normalizedIds.length === 0) {
    return { kind: "unsupported", reason: "No element ids were provided for moveElements" };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
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
  const changedSourceIds = expandChangedSourceIdsForMovedElements(parsed.figure.body, normalizedIds);
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
  const movedPathShapeDeltas = new Map<string, WorldPoint>();

  if (nonMatrixElementIds.length > 0) {
    const byHandles = applyMoveElementsUsingHandleRewrites(currentSource, editHandles, nonMatrixElementIds, delta, parseOptions);
    if (byHandles.kind === "error") {
      return byHandles;
    }
    if (byHandles.kind === "success" || byHandles.kind === "partial") {
      currentSource = byHandles.newSource;
      patches.push(...byHandles.patches);
      movedAny = true;
      for (const elementId of nonMatrixElementIds) {
        movedPathShapeDeltas.set(elementId, delta);
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
      parseOptions
    );
    if (byMatrixPlacement.kind === "success" || byMatrixPlacement.kind === "partial") {
      currentSource = byMatrixPlacement.newSource;
      patches.push(...byMatrixPlacement.patches);
      movedAny = true;
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
      parseOptions
    );
    if (byTreeRootPlacement.kind === "success" || byTreeRootPlacement.kind === "partial") {
      currentSource = byTreeRootPlacement.newSource;
      patches.push(...byTreeRootPlacement.patches);
      movedAny = true;
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
      parseOptions
    );
    if (byScopeTransform.kind === "success" || byScopeTransform.kind === "partial") {
      currentSource = byScopeTransform.newSource;
      patches.push(...byScopeTransform.patches);
      movedAny = true;
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

  const pivotUpdates = applyCenterRotateAroundPivotTranslations(
    currentSource,
    editHandles,
    movedPathShapeDeltas,
    parseOptions
  );
  currentSource = pivotUpdates.source;
  patches.push(...pivotUpdates.patches);

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
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(action.elementIds);
  if (normalizedIds.length < 2) {
    return { kind: "unsupported", reason: "Align requires at least 2 selected elements." };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const plan = planAlignDeltas(boundsBySource, normalizedIds, action.mode);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas, parseOptions);
}

export function applyDistributeElementsAction(
  source: string,
  action: DistributeElementsAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const normalizedIds = normalizeElementIds(action.elementIds);
  if (normalizedIds.length < 3) {
    return { kind: "unsupported", reason: "Distribute requires at least 3 selected elements." };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const plan = planDistributeDeltas(boundsBySource, normalizedIds, action.axis);
  if (plan.kind === "unsupported") {
    return plan;
  }

  return applyElementDeltaMapStrict(source, semantic.editHandles, normalizedIds, plan.deltas, parseOptions);
}

function applyMoveElementsUsingHandleRewrites(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  delta: WorldPoint,
  parseOptions: EditParseOptions = {}
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

  type PendingReplacement = { span: { from: number; to: number }; text: string };
  const pending: PendingReplacement[] = [];

  for (const handle of rewritable) {
    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      skippedHandles.push(handle.id);
      continue;
    }

    const newWorld: WorldPoint = worldPoint(pt(handle.world.x + delta.x), pt(handle.world.y + delta.y));
    const text = rewriteCoordinate(newWorld, handle, source);
    if (text != null) {
      pending.push({ span: handle.sourceRef.sourceSpan, text });
    } else {
      skippedHandles.push(handle.id);
    }
  }

  if (pending.length === 0) {
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
  parseOptions: EditParseOptions
): MoveRewriteBatchResult {
  let currentSource = source;
  const patches: SourcePatch[] = [];
  const failedElementIds: string[] = [];
  const failureReasons: string[] = [];

  for (const elementId of elementIds) {
    const placementHandle = placementHandlesBySource.get(elementId);
    const rewrite = rewriteSingleMatrixPlacement(currentSource, elementId, delta, placementHandle, parseOptions);
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
  parseOptions: EditParseOptions
): MoveRewriteBatchResult {
  let currentSource = source;
  const patches: SourcePatch[] = [];
  const failedElementIds: string[] = [];
  const failureReasons: string[] = [];

  for (const elementId of elementIds) {
    const rewrite = rewriteSingleScopeTransform(currentSource, elementId, delta, formatPrecision, parseOptions);
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
  parseOptions: EditParseOptions
): ScopeTransformRewriteResult {
  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind !== "found") {
    return { kind: "unsupported", reason: `Scope ${elementId} was not found` };
  }

  const inPlaceShiftRewrite = rewriteSingleScopeShiftInPlace(source, resolved.target, elementId, delta, formatPrecision);
  if (inPlaceShiftRewrite) {
    return inPlaceShiftRewrite;
  }

  const normalizedDelta = resolveDeltaUsingFullLinear(targetOptionsEntries(resolved.target), delta) ?? delta;

  const context = resolveTransformInspectorMutationContextFromOptionEntries(targetOptionsEntries(resolved.target));
  const mutations = [
    ...buildTransformSetPropertyMutations(context, "xshift", context.values.xshift + normalizedDelta.x),
    ...buildTransformSetPropertyMutations(context, "yshift", context.values.yshift + normalizedDelta.y)
  ];
  const optionMutations = new Map<string, OptionMutation>();
  for (const mutation of mutations) {
    for (const clearKey of mutation.clearKeys) {
      optionMutations.set(clearKey, { kind: "remove" });
    }
    optionMutations.set(
      mutation.key,
      mutation.value.trim().length === 0
        ? { kind: "remove" }
        : formatScopeTranslationMutation(mutation.key, mutation.value, formatPrecision)
    );
  }
  const rewritten = applyOptionMutationsToTarget(source, resolved.target, optionMutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: `Scope ${elementId} already matches the requested position` };
  }

  return {
    kind: "success",
    source: rewritten.source,
    patches: [rewritten.patch]
  };
}

function rewriteSingleScopeShiftInPlace(
  source: string,
  target: PropertyTarget,
  elementId: string,
  delta: WorldPoint,
  formatPrecision: DragFormatPrecision | undefined
): ScopeTransformRewriteResult | null {
  if (!target.options) {
    return null;
  }

  const entries = target.options.entries;
  const shiftEntries = entries
    .map((entry, index) => ({ entry, index }))
    .filter((candidate): candidate is KeyValueOptionCandidate => {
      if (candidate.entry.kind !== "kv") {
        return false;
      }
      const key = normalizeOptionKey(candidate.entry.key);
      return key === "shift" || key === "/tikz/shift";
    });
  const lastShift = shiftEntries[shiftEntries.length - 1] ?? null;
  if (!lastShift) {
    const xyTranslationEntries = entries
      .map((entry, index) => ({ entry, index }))
      .filter((candidate): candidate is KeyValueOptionCandidate => {
        if (candidate.entry.kind !== "kv") {
          return false;
        }
        const key = normalizeOptionKey(candidate.entry.key);
        return key === "xshift" || key === "/tikz/xshift" || key === "yshift" || key === "/tikz/yshift";
      });
    if (xyTranslationEntries.length === 0) {
      return null;
    }

    const firstTranslationIndex = Math.min(...xyTranslationEntries.map((candidate) => candidate.index));
    const prefixLinear = resolvePrefixLinearTransform(entries, firstTranslationIndex);
    if (!prefixLinear) {
      return null;
    }
    const localDelta = applyInverseLinear(prefixLinear, delta);
    if (!localDelta) {
      return null;
    }

    const context = resolveTransformInspectorMutationContextFromOptionEntries(entries);
    const nextShiftX = context.values.xshift + localDelta.x;
    const nextShiftY = context.values.yshift + localDelta.y;
    const nextShiftXValue = formatScopeShiftValue(nextShiftX, formatPrecision);
    const nextShiftYValue = formatScopeShiftValue(nextShiftY, formatPrecision);
    const optionMutations = new Map<string, OptionMutation>();
    if (nextShiftXValue != null) {
      optionMutations.set("xshift", {
        kind: "set",
        value: nextShiftXValue
      });
    } else {
      optionMutations.set("xshift", { kind: "remove" });
    }
    if (nextShiftYValue != null) {
      optionMutations.set("yshift", {
        kind: "set",
        value: nextShiftYValue
      });
    } else {
      optionMutations.set("yshift", { kind: "remove" });
    }

    const rewritten = applyOptionMutationsToTarget(source, target, optionMutations);
    if (!rewritten) {
      return { kind: "unsupported", reason: `Scope ${elementId} already matches the requested position` };
    }

    return {
      kind: "success",
      source: rewritten.source,
      patches: [rewritten.patch]
    };
  }

  const prefixLinear = resolvePrefixLinearTransform(entries, lastShift.index);
  if (!prefixLinear) {
    return null;
  }
  const localDelta = applyInverseLinear(prefixLinear, delta);
  if (!localDelta) {
    return null;
  }

  const context = resolveTransformInspectorMutationContextFromOptionEntries(entries);
  const nextShiftX = context.values.xshift + localDelta.x;
  const nextShiftY = context.values.yshift + localDelta.y;
  const nextShiftXValue = formatScopeShiftValue(nextShiftX, formatPrecision);
  const nextShiftYValue = formatScopeShiftValue(nextShiftY, formatPrecision);
  const shiftMutation: OptionMutation = nextShiftXValue == null && nextShiftYValue == null
    ? { kind: "remove" }
    : {
        kind: "set",
        value: `(${nextShiftXValue ?? "0pt"},${nextShiftYValue ?? "0pt"})`
      };
  const optionMutations = new Map<string, OptionMutation>([
    ["shift", shiftMutation]
  ]);

  const rewritten = applyOptionMutationsToTarget(source, target, optionMutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: `Scope ${elementId} already matches the requested position` };
  }

  return {
    kind: "success",
    source: rewritten.source,
    patches: [rewritten.patch]
  };
}

function formatScopeTranslationMutation(
  key: string,
  value: string,
  formatPrecision: DragFormatPrecision | undefined
): OptionMutation {
  const normalizedKey = normalizeOptionKey(key);
  if (normalizedKey !== "xshift" && normalizedKey !== "yshift") {
    return { kind: "set", value };
  }
  const match = /^([-+]?(?:\d+(?:\.\d+)?|\.\d+))pt$/.exec(value.trim());
  if (!match) {
    return { kind: "set", value };
  }
  const formatted = formatScopeShiftValue(Number(match[1]), formatPrecision);
  return formatted == null ? { kind: "remove" } : { kind: "set", value: formatted };
}

function formatScopeShiftValue(
  value: number,
  formatPrecision: DragFormatPrecision | undefined
): string | null {
  const formatted = formatNumber(value, pointDistanceFormatOptions(formatPrecision));
  return Number(formatted) === 0 ? null : `${formatted}pt`;
}

function targetOptionsEntries(target: PropertyTarget): readonly OptionEntry[] {
  return target.options?.entries ?? [];
}

function resolveDeltaUsingFullLinear(entries: readonly OptionEntry[], delta: WorldPoint): WorldPoint | null {
  const fullLinear = resolvePrefixLinearTransform(entries, entries.length);
  if (!fullLinear) {
    return null;
  }
  return applyInverseLinear(fullLinear, delta);
}

type LinearTransform = { a: number; b: number; c: number; d: number };

function resolvePrefixLinearTransform(entries: readonly OptionEntry[], endExclusive: number): LinearTransform | null {
  let linear: LinearTransform = { a: 1, b: 0, c: 0, d: 1 };

  for (let index = 0; index < endExclusive; index += 1) {
    const entry = entries[index];
    if (entry.kind !== "kv") {
      continue;
    }
    const key = normalizeOptionKey(entry.key);
    if (key === "scale" || key === "/tikz/scale") {
      const factor = Number(entry.valueRaw);
      if (!Number.isFinite(factor)) {
        return null;
      }
      linear = multiplyLinear(linear, { a: factor, b: 0, c: 0, d: factor });
      continue;
    }
    if (key === "xscale" || key === "/tikz/xscale") {
      const factor = Number(entry.valueRaw);
      if (!Number.isFinite(factor)) {
        return null;
      }
      linear = multiplyLinear(linear, { a: factor, b: 0, c: 0, d: 1 });
      continue;
    }
    if (key === "yscale" || key === "/tikz/yscale") {
      const factor = Number(entry.valueRaw);
      if (!Number.isFinite(factor)) {
        return null;
      }
      linear = multiplyLinear(linear, { a: 1, b: 0, c: 0, d: factor });
      continue;
    }
    if (key === "rotate" || key === "/tikz/rotate") {
      const degrees = Number(entry.valueRaw);
      if (!Number.isFinite(degrees)) {
        return null;
      }
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      linear = multiplyLinear(linear, { a: cos, b: sin, c: -sin, d: cos });
    }
  }

  return linear;
}

function multiplyLinear(left: LinearTransform, right: LinearTransform): LinearTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d
  };
}

function applyInverseLinear(linear: LinearTransform, point: WorldPoint): WorldPoint | null {
  const det = linear.a * linear.d - linear.b * linear.c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) {
    return null;
  }

  return worldPoint(
    pt((linear.d * point.x - linear.c * point.y) / det),
    pt((-linear.b * point.x + linear.a * point.y) / det)
  );
}

type MatrixPlacementRewriteResult =
  | { kind: "success"; source: string; patches: SourcePatch[] }
  | { kind: "unsupported"; reason: string };

function applyMoveTreeRootElementsWithPlacementRewrite(
  source: string,
  elementIds: readonly string[],
  delta: WorldPoint,
  parseOptions: EditParseOptions
): MoveRewriteBatchResult {
  let currentSource = source;
  const patches: SourcePatch[] = [];
  const failedElementIds: string[] = [];
  const failureReasons: string[] = [];

  for (const elementId of elementIds) {
    const rewrite = rewriteSingleTreeRootPlacement(currentSource, elementId, delta, parseOptions);
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
  parseOptions: EditParseOptions
): MatrixPlacementRewriteResult {
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const statement = findPathStatementById(parsed.figure.body, elementId)!;
  const matrixNode = findPrimaryMatrixNodeItem(statement)!;

  const semantic = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
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
    const bodyOpenOffset = matrixTarget.target.matrixBodyOpenOffset!;

    if (atOptionEntry) {
      const optionReplacement = rewriteOptionListMutations(
        matrixTarget.target.options!,
        new Map<string, OptionMutation>([["at", { kind: "remove" }]]),
        undefined,
        matrixTarget.target.optionsFormat
      );
      const applied = applyTextReplacements(source, [
        { span: matrixTarget.target.optionsSpan!, text: optionReplacement },
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
    )!;
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
  parseOptions: EditParseOptions
): MatrixPlacementRewriteResult {
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const statement = findPathStatementById(parsed.figure.body, elementId)!;
  const rootNode = findPrimaryTreeRootNodeItem(statement)!;

  const semantic = evaluateTikzFigure(parsed.figure, source);
  const placementHandle = semantic.editHandles.find(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "node-position"
  );
  const currentPlacementWorld =
    placementHandle?.world ??
    (() => {
      const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
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
  const inserted = replaceSourceSpan(source, { from: insertionOffset, to: insertionOffset }, ` at ${nextCoordinate}`)!;
  return { kind: "success", source: inserted.source, patches: [inserted.patch] };
}

function applyElementDeltaMapStrict(
  source: string,
  editHandles: EditHandle[],
  elementIds: readonly string[],
  deltasBySource: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions = {}
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

  type PendingReplacement = { span: { from: number; to: number }; text: string };
  const pending: PendingReplacement[] = [];
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

    const text = rewriteCoordinate(
      worldPoint(pt(handle.world.x + delta.x), pt(handle.world.y + delta.y)),
      handle,
      source
    );
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

  if (pending.length === 0) {
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

  const pivotUpdates = applyCenterRotateAroundPivotTranslations(
    currentSource,
    editHandles,
    deltasBySource,
    parseOptions
  );
  currentSource = pivotUpdates.source;
  patches.push(...pivotUpdates.patches);

  return {
    kind: "success",
    newSource: currentSource,
    patches,
    changedSourceIds: normalizedIds
  };
}

function applyCenterRotateAroundPivotTranslations(
  source: string,
  editHandles: readonly EditHandle[],
  deltasBySource: ReadonlyMap<string, WorldPoint>,
  parseOptions: EditParseOptions
): { source: string; patches: SourcePatch[] } {
  if (deltasBySource.size === 0) {
    return { source, patches: [] };
  }

  let currentSource = source;
  const patches: SourcePatch[] = [];
  for (const [sourceId, delta] of deltasBySource.entries()) {
    if (Math.abs(delta.x) <= ARRANGE_EPSILON && Math.abs(delta.y) <= ARRANGE_EPSILON) {
      continue;
    }

    const parsed = parseTikzForEdit(currentSource, { ...parseOptions });
    const statement = findPathStatementById(parsed.figure.body, sourceId);
    if (!statement) {
      continue;
    }
    const center = resolveExplicitPathShapeCenter(statement, editHandles, sourceId);
    if (!center) {
      continue;
    }

    const resolvedTarget = resolvePropertyTarget(currentSource, sourceId, parseOptions);
    if (resolvedTarget.kind !== "found") {
      continue;
    }
    const transformContext = resolveTransformInspectorMutationContextFromOptionEntries(
      resolvedTarget.target.options?.entries
    );
    const rotateAround = transformContext.values.rotateAround;
    if (!rotateAround) {
      continue;
    }
    const pivot = parseRotateAroundPivotRaw(rotateAround.pivotRaw);
    if (!pivot || !pointsApproximatelyEqual(pivot, center, CENTER_PIVOT_EPSILON)) {
      continue;
    }

    const nextPivot = worldPoint(pt(pivot.x + delta.x), pt(pivot.y + delta.y));
    const mutations = new Map<string, OptionMutation>();
    mutations.set("/tikz/rotate", { kind: "remove" });
    mutations.set("rotate", { kind: "remove" });
    mutations.set("/tikz/rotate around", { kind: "remove" });
    mutations.set("rotate around", {
      kind: "set",
      value: `{${formatNumber(transformContext.values.rotate)}:${formatWorldPointCoordinateRaw(nextPivot)}}`
    });
    const applied = applyOptionMutationsToTarget(currentSource, resolvedTarget.target, mutations);
    if (!applied) {
      continue;
    }
    currentSource = applied.source;
    patches.push(applied.patch);
  }

  return { source: currentSource, patches };
}

function resolveExplicitPathShapeCenter(
  statement: PathStatement,
  editHandles: readonly EditHandle[],
  sourceId: string
): WorldPoint | null {
  const shapeHint = resolvePathShapeHintFromItems(statement.items);
  if (!shapeHint) {
    return null;
  }
  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "path-point"
  );
  if (shapeHint === "rectangle") {
    if (pathPointHandles.length !== 2) {
      return null;
    }
    const first = pathPointHandles[0];
    const second = pathPointHandles[1];
    if (!first || !second) {
      return null;
    }
    return worldPoint(
      pt((first.world.x + second.world.x) / 2),
      pt((first.world.y + second.world.y) / 2)
    );
  }
  if (shapeHint === "circle" || shapeHint === "ellipse") {
    if (pathPointHandles.length !== 1) {
      return null;
    }
    return pathPointHandles[0]?.world ?? null;
  }
  return null;
}

function resolvePathShapeHintFromItems(items: readonly PathItem[]): ScenePathShapeHint | null {
  const hints = new Set<ScenePathShapeHint>();
  collectPathShapeHints(items, hints);
  if (hints.size !== 1) {
    return null;
  }
  return [...hints][0] ?? null;
}

function collectPathShapeHints(items: readonly PathItem[], hints: Set<ScenePathShapeHint>): void {
  for (const item of items) {
    if (item.kind === "PathKeyword") {
      if (item.keyword === "rectangle" || item.keyword === "circle" || item.keyword === "ellipse") {
        hints.add(item.keyword);
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      collectPathShapeHints(item.body, hints);
    }
  }
}

function parseRotateAroundPivotRaw(raw: string): WorldPoint | null {
  const coordinate = parseCoordinateLike(raw);
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

function pointsApproximatelyEqual(left: WorldPoint, right: WorldPoint, epsilon: number): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function formatWorldPointCoordinateRaw(point: WorldPoint): string {
  return `(${formatNumber(point.x * CM_PER_PT)},${formatNumber(point.y * CM_PER_PT)})`;
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
  elementIds: readonly string[]
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
  }

  return expanded;
}
