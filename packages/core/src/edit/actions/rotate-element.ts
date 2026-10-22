import { editedSlice, option, optionValueFor, sourceSlice, tikz, unchangedSource, type CoordinateText, type EditedSource, type TikzFragment } from "../fragment.js";
import { requireDefined } from "../../utils/invariants.js";
import { createEditGeometrySession, type EditGeometrySession } from "../geometry-session.js";
import type { EditActionResultLike } from "../result-types.js";
import type { PathItem, Statement, Span } from "../../ast/types.js";
import type { OptionEntry } from "../../options/types.js";
import { pt } from "../../coords/scalars.js";
import { frameTransform, worldTransform, type FrameTransform } from "../../coords/transforms.js";
import { worldPoint, type WorldPoint } from "../../coords/points.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import type {
  EditHandle,
  EvaluateOptions,
  SceneElement,
  ScenePath,
  ScenePathShapeHint
} from "../../semantic/types.js";
import { isFrameLocalCoordinateEditHandle } from "../../semantic/types.js";
import { applyTextReplacements } from "../statement-ops.js";
import { rewritePreciseFrameCoordinate } from "../frame-coordinate.js";
import { normalizeOptionKey } from "../option-mutations.js";
import {
  applyOptionMutationsToTarget,
  type OptionMutation
} from "../option-mutations.js";
import { changedSourceIdsForPropertyTarget, resolvePropertyTarget } from "../property-target.js";
import type { SourcePatch } from "../types.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import {
  buildTransformSetPropertyMutations,
  resolveTransformInspectorMutationContextFromOptionEntries,
  ROTATE_CLEAR_KEYS,
  type TransformInspectorMutationContext
} from "../property-write-builders.js";
import { findPathStatementById } from "../statement-find.js";
import { applyMatrix, inverseMatrix } from "../../semantic/transform.js";
import { replaceSpan } from "../patch.js";
import { createCoordinateWriter, rotationSense, type CoordinateWriter } from "../writer/index.js";
import type { SiteContext } from "../../semantic/site-context.js";

const ROTATE_EPSILON = 1e-6;


export type RotateElementAction = {
  kind: "rotateElement";
  elementId: string;
  targetId?: string;
  angleDeg: number;
  mode: "property" | "origin" | "center-pivot";
  baselineSource?: string;
};

type RectangleRotateContext = {
  kind: "rectangle";
  target: Extract<Statement, { kind: "Path" }>;
  startHandle: EditHandle;
  oppositeHandle: EditHandle;
};

type EllipseLikeRotateContext = {
  kind: "circle" | "ellipse";
  target: Extract<Statement, { kind: "Path" }>;
  center: WorldPoint;
  centerHandle: EditHandle;
};

type CenterPivotRotateContext = RectangleRotateContext | EllipseLikeRotateContext;

export function applyRotateElementAction(
  currentSource: string,
  action: RotateElementAction,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions = {},
  geometry?: EditGeometrySession
): EditActionResultLike {
  const elementId = action.elementId.trim();
  if (elementId.length === 0) {
    return { kind: "unsupported", reason: "Missing element id for rotateElement." };
  }
  if (!Number.isFinite(action.angleDeg)) {
    return { kind: "unsupported", reason: "Missing rotate angle." };
  }

  const baselineSource = action.baselineSource ?? currentSource;
  const result = action.mode === "center-pivot"
    ? applyCenterPivotRotate(baselineSource, action, evaluateOptions, parseOptions, geometry)
    : applyPropertyRotate(baselineSource, action, parseOptions);
  if (result.kind === "success" && baselineSource !== currentSource) {
    return {
      ...result,
      patches: [computeReplacementPatch(currentSource, result.newSource)]
    };
  }
  return result;
}

function applyPropertyRotate(
  source: string,
  action: RotateElementAction,
  parseOptions: EditParseOptions
): EditActionResultLike {
  const targetId = (action.targetId ?? action.elementId).trim();
  const resolvedTarget = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolvedTarget.kind !== "found") {
    return { kind: "unsupported", reason: resolvedTarget.reason };
  }
  const context = resolveTransformInspectorMutationContextFromOptionEntries(
    resolvedTarget.target.options?.entries
  );
  const writer = createCoordinateWriter(source);
  const mutations = action.mode === "origin"
    ? buildOriginRotateMutations(writer, action.angleDeg)
    : buildPropertyRotateMutations(source, writer, resolvedTarget.target.options?.entries ?? [], context, action.angleDeg);
  if (!mutations) {
    return { kind: "unsupported", reason: "Could not find the pivot of the rotation to keep it." };
  }
  const applied = applyOptionMutationsToTarget(source, resolvedTarget.target, mutations);
  if (!applied) {
    return { kind: "unsupported", reason: "rotateElement would not change the source." };
  }
  return {
    kind: "success",
    newSource: applied.source,
    patches: [applied.patch],
    changedSourceIds: changedSourceIdsForPropertyTarget(resolvedTarget.target)
  };
}

function applyCenterPivotRotate(
  source: string,
  action: RotateElementAction,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions,
  geometry?: EditGeometrySession
): EditActionResultLike {
  const baseline = geometry?.source === source ? geometry : buildBaselineContext(source, evaluateOptions, parseOptions);
  const context = resolveCenterPivotRotateContext(
    baseline.parsed.figure.body,
    baseline.semantic.scene.elements,
    baseline.semantic.editHandles,
    action.elementId
  );
  if (context.kind === "unsupported") {
    return context;
  }
  if (context.kind === "not-found") {
    return {
      kind: "unsupported",
      reason: "Center-pivot rotate currently supports explicit path rectangles, circles, and ellipses."
    };
  }

  if (pathHasUnsupportedTransformOptions(context.target)) {
    return {
      kind: "unsupported",
      reason: "Center-pivot rotate currently supports shapes without other path transforms."
    };
  }

  const targetId = (action.targetId ?? action.elementId).trim();
  const resolvedTarget = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolvedTarget.kind !== "found") {
    return { kind: "unsupported", reason: resolvedTarget.reason };
  }

  if (resolvedTarget.target.kind !== "path-statement" || resolvedTarget.target.id !== context.target.id) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires the selected path's own options." };
  }
  const entries = context.target.options?.entries ?? [];
  const rotations = entries.filter(isRotationOption);
  if (rotations.length > 1) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires one authored path rotation." };
  }
  const rotation = rotations[0];
  const rotationIndex = rotation ? entries.indexOf(rotation) : entries.length;
  const prefixContext = baseline.optionContext(action.elementId, entries.slice(0, rotationIndex));
  const prefixFrame = prefixContext && frameTransform(prefixContext.ctm.a, prefixContext.ctm.b, prefixContext.ctm.c,
    prefixContext.ctm.d, prefixContext.ctm.e, prefixContext.ctm.f);
  const prefix = prefixFrame && asWorldTransform(prefixFrame);
  const inversePrefix = prefix && inverseMatrix(prefix);
  if (!prefixContext || !prefixFrame || !prefix || !inversePrefix) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires an invertible coordinate frame." };
  }
  const transformContext = resolveTransformInspectorMutationContextFromOptionEntries(
    resolvedTarget.target.options?.entries
  );
  const baseAngleDeg = transformContext.values.rotate;
  // The gesture turns the world by the change from the authored angle; under
  // a reflection the option's angle turns the other way.
  const center = resolveCenterPivot(context);
  const worldDeltaDeg = normalizeSignedDeg(action.angleDeg - baseAngleDeg);
  // Where the parent frame is conformal the gesture turns the world, and
  // under a reflection the option's angle turns the other way. Under stretch
  // or skew no angle is a world rotation: the gesture's change goes to the
  // option's own angle, which TikZ composes with the parent.
  const sense = rotationSense(prefixContext);
  const deltaDeg = (sense ?? 1) * worldDeltaDeg;
  const nextAngleDeg = normalizeTinyNumber(baseAngleDeg + deltaDeg);
  const value = Math.abs(nextAngleDeg) <= ROTATE_EPSILON ? null
    : createCoordinateWriter(source).rotation(prefixContext, sense === null ? { authored: nextAngleDeg } : { world: sense * nextAngleDeg }, center);
  if (value?.kind === "unsupported") return { kind: "unsupported", reason: `Center-pivot rotate: ${value.reason}.` };
  const pivotValue = value?.fragment ?? null;
  // The pivot belongs to the frame at the authored rotation option. Parent
  // stretch/skew still composes with the local rotation, as it does in TikZ.
  const pivot = applyMatrix(inversePrefix, center);
  const rotateMutation = buildCenterPivotRotateMutations(pivotValue);
  const nextRotation = centerRotationOption(pivotValue, rotation?.span ?? context.target.span);
  const nextEntries = rotation
    ? entries.flatMap(entry => entry === rotation ? nextRotation ? [nextRotation] : [] : [entry])
    : nextRotation ? [...entries, nextRotation] : entries;
  const nextContext = baseline.optionContext(action.elementId, nextEntries);
  if (!nextContext) {
    return { kind: "unsupported", reason: "Could not resolve the replacement rotation frame." };
  }
  const coordinateRewrites = context.kind === "rectangle"
    ? buildRectangleCoordinateRewrites(source, context, pivot, deltaDeg, nextContext, prefixFrame)
    : buildEllipseLikeCoordinateRewrites(source, context, nextContext);
  if (coordinateRewrites.kind === "unsupported") {
    return coordinateRewrites;
  }

  let nextSource = unchangedSource(source);
  const patches: SourcePatch[] = [];
  // Replace the existing rotation in place: moving it past a named style
  // would change the linear part of an ellipse even at the same angle.
  const optionApplied = rotation && pivotValue
    ? replaceRotationOption(nextSource, rotation, option("rotate around", pivotValue))
    : applyOptionMutationsToTarget(nextSource, resolvedTarget.target, rotateMutation);
  if (optionApplied) {
    nextSource = optionApplied.source;
    patches.push(optionApplied.patch);
  }

  if (coordinateRewrites.replacements.length > 0) {
    const adjustedReplacements = adjustReplacementsForPriorPatches(coordinateRewrites.replacements, patches);
    const coordinateApplied = applyTextReplacements(nextSource, adjustedReplacements);
    nextSource = coordinateApplied.source;
    patches.push(...coordinateApplied.patches);
  }

  if (nextSource === source) {
    return { kind: "unsupported", reason: "rotateElement would not change the source." };
  }

  return {
    kind: "success",
    newSource: nextSource,
    patches,
    changedSourceIds: changedSourceIdsForPropertyTarget(resolvedTarget.target)
  };
}

function buildBaselineContext(
  source: string,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions
): EditGeometrySession {
  const parsed = parseTikzForEdit(source, { ...parseOptions });
  const semantic = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
  return createEditGeometrySession({ source, parsed, semantic }, evaluateOptions, parseOptions);
}

function asWorldTransform(transform: FrameTransform) {
  return worldTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
}

function isRotationOption(entry: OptionEntry): boolean {
  if (entry.kind !== "kv") return false;
  const key = normalizeOptionKey(entry.key);
  return key === "rotate" || key === "/tikz/rotate" || key === "rotate around" || key === "/tikz/rotate around";
}

/** `rotate around=…`, or nothing for no rotation. */
function centerRotationOption(value: CoordinateText | null, span: Span): OptionEntry | undefined {
  if (value === null) return undefined;
  return { kind: "kv", key: "rotate around", valueRaw: value, raw: option("rotate around", value), span };
}

function replaceRotationOption(source: string, rotation: OptionEntry, replacement: TikzFragment) {
  const updated = replaceSpan(source, rotation.span, replacement);
  if (updated.source === source) return null;
  return {
    source: updated.source,
    patch: { oldSpan: rotation.span, newSpan: updated.changedSpan, replacement }
  };
}

/**
 * The inspector's rotation: the authored angle, about the pivot the option
 * already names (copied from the source), with the keys it replaces cleared.
 */
function buildPropertyRotateMutations(
  source: string,
  writer: CoordinateWriter,
  entries: readonly OptionEntry[],
  context: TransformInspectorMutationContext,
  angleDeg: number
): Map<string, OptionMutation> | null {
  const mutations = new Map<string, OptionMutation>();
  for (const mutation of buildTransformSetPropertyMutations(context, "rotate", angleDeg)) {
    for (const clearKey of mutation.clearKeys) {
      mutations.set(clearKey, { kind: "remove" });
    }
    if (mutation.value.length === 0) {
      mutations.set(mutation.key, { kind: "remove" });
      continue;
    }
    const angle = writer.angle(normalizeTinyNumber(angleDeg));
    if (mutation.key !== "rotate around") {
      mutations.set(mutation.key, { kind: "set", value: angle });
      continue;
    }
    const pivot = rotateAroundPivot(source, entries);
    if (!pivot) return null;
    mutations.set(mutation.key, { kind: "set", value: tikz`{${angle}:${pivot}}` });
  }
  return mutations;
}

/** The pivot an existing `rotate around={angle:pivot}` names, as written. */
function rotateAroundPivot(source: string, entries: readonly OptionEntry[]): TikzFragment | null {
  const entry = [...entries].reverse().find(candidate => candidate.kind === "kv" && normalizeOptionKey(candidate.key) === "rotate around");
  if (entry?.kind !== "kv") return null;
  const raw = source.slice(entry.span.from, entry.span.to);
  const colon = raw.indexOf(":");
  const close = raw.lastIndexOf("}");
  if (colon < 0 || close <= colon) return null;
  const from = entry.span.from + colon + 1;
  const to = entry.span.from + close;
  return source.slice(from, to).trim().length > 0 ? sourceSlice(source, { from, to }) : null;
}

function buildOriginRotateMutations(writer: CoordinateWriter, angleDeg: number): Map<string, OptionMutation> {
  const normalizedAngle = normalizeTinyNumber(angleDeg);
  const mutations = new Map<string, OptionMutation>();
  for (const key of ROTATE_CLEAR_KEYS) {
    mutations.set(key, { kind: "remove" });
  }
  if (Math.abs(normalizedAngle) <= ROTATE_EPSILON) {
    mutations.set("rotate", { kind: "remove" });
  } else {
    mutations.set("rotate", { kind: "set", value: writer.angle(normalizedAngle) });
  }
  return mutations;
}

function buildCenterPivotRotateMutations(value: CoordinateText | null): Map<string, OptionMutation> {
  const mutations = new Map<string, OptionMutation>();
  for (const key of ROTATE_CLEAR_KEYS) {
    mutations.set(key, { kind: "remove" });
  }
  mutations.set("rotate", { kind: "remove" });
  mutations.set("rotate around", value === null ? { kind: "remove" } : { kind: "set", value: optionValueFor("rotate around", value) });
  return mutations;
}

type CenterPivotRotateResolution =
  | CenterPivotRotateContext
  | { kind: "not-found" }
  | { kind: "unsupported"; reason: string };

function resolveCenterPivotRotateContext(
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  elementId: string
): CenterPivotRotateResolution {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return { kind: "not-found" };
  }

  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === elementId && !element.adornment);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  if (nonTextElements.length !== 1) {
    return { kind: "not-found" };
  }

  const element = nonTextElements[0];
  if (!element) {
    return { kind: "not-found" };
  }

  if (element.kind === "Path" && resolveScenePathShapeHint(element, pathStatement) === "rectangle") {
    const rectangle = resolveRectangleContext(pathStatement, editHandles, elementId);
    if (rectangle.kind !== "found") {
      return rectangle;
    }
    return {
      kind: "rectangle",
      target: pathStatement,
      startHandle: rectangle.startHandle,
      oppositeHandle: rectangle.oppositeHandle
    };
  }

  const shape = resolveEllipseLikeContext(pathStatement, element, editHandles, elementId);
  if (shape.kind !== "found") {
    return shape;
  }
  return {
    kind: shape.shapeKind,
    target: pathStatement,
    center: shape.center,
    centerHandle: shape.centerHandle
  };
}

function resolveRectangleContext(
  pathStatement: Extract<Statement, { kind: "Path" }>,
  editHandles: readonly EditHandle[],
  elementId: string
): { kind: "found"; startHandle: EditHandle; oppositeHandle: EditHandle } | { kind: "unsupported"; reason: string } {
  if (resolvePathShapeHintFromItems(pathStatement.items) !== "rectangle") {
    return { kind: "unsupported", reason: "Center-pivot rotate requires explicit path rectangles." };
  }

  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "path-point"
  );
  if (pathPointHandles.length !== 2) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires rectangles with explicit start and target coordinates." };
  }
  const [startHandle, oppositeHandle] = pathPointHandles;
  if (!startHandle || !oppositeHandle) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires rectangles with explicit start and target coordinates." };
  }
  if (!isDirectFrameLocalHandle(startHandle) || !isDirectFrameLocalHandle(oppositeHandle)) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires direct, rewritable rectangle coordinates." };
  }
  if (spansEqual(startHandle.sourceRef.sourceSpan, oppositeHandle.sourceRef.sourceSpan)) {
    return { kind: "unsupported", reason: "Center-pivot rotate cannot target shared coordinate spans." };
  }
  return { kind: "found", startHandle, oppositeHandle };
}

function resolveEllipseLikeContext(
  pathStatement: Extract<Statement, { kind: "Path" }>,
  element: SceneElement,
  editHandles: readonly EditHandle[],
  elementId: string
): { kind: "found"; shapeKind: "circle" | "ellipse"; center: WorldPoint; centerHandle: EditHandle } | { kind: "not-found" } | { kind: "unsupported"; reason: string } {
  let shapeKind: "circle" | "ellipse" | null = null;
  let center: WorldPoint | null = null;

  if (element.kind === "Circle") {
    shapeKind = "circle";
    center = element.center;
  } else if (element.kind === "Ellipse") {
    shapeKind = "ellipse";
    center = element.center;
  } else if (element.kind === "Path") {
    const hint = resolveScenePathShapeHint(element, pathStatement);
    if (hint === "circle" || hint === "ellipse") {
      shapeKind = hint;
    }
  }

  if (!shapeKind) {
    return { kind: "not-found" };
  }
  const syntaxHint = resolvePathShapeHintFromItems(pathStatement.items);
  if (syntaxHint !== shapeKind) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires explicit circle/ellipse source syntax." };
  }

  const candidateHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "path-point"
  );
  if (candidateHandles.length !== 1) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires circle/ellipse paths with explicit center coordinates." };
  }
  const centerHandle = candidateHandles[0];
  if (!centerHandle || !isDirectFrameLocalHandle(centerHandle)) {
    return { kind: "unsupported", reason: "Center-pivot rotate requires a direct, rewritable center coordinate." };
  }

  return {
    kind: "found",
    shapeKind,
    center: center ?? centerHandle.world,
    centerHandle
  };
}

function buildRectangleCoordinateRewrites(
  source: string,
  context: RectangleRotateContext,
  pivot: WorldPoint,
  deltaDeg: number,
  nextContext: SiteContext,
  prefixFrame: FrameTransform
): { kind: "success"; replacements: Array<{ span: Span; text: TikzFragment }> } | { kind: "unsupported"; reason: string } {
  const prefix = asWorldTransform(prefixFrame);
  const inversePrefix = requireDefined(inverseMatrix(prefix), "Missing required inverseMatrix(prefix)");
  const rotateLocalPoint = (point: WorldPoint) => applyMatrix(prefix,
    rotateWorldPointAroundCenter(applyMatrix(inversePrefix, point), pivot, deltaDeg));
  const targetStart = rotateLocalPoint(context.startHandle.world);
  const targetOpposite = rotateLocalPoint(context.oppositeHandle.world);
  const replacements = [
    {
      handle: context.startHandle,
      context: contextFor(context.startHandle, nextContext),
      newWorld: targetStart
    },
    {
      handle: context.oppositeHandle,
      context: contextFor(context.oppositeHandle, nextContext),
      newWorld: targetOpposite
    }
  ];

  return rewriteHandleTargets(source, replacements);
}

function buildEllipseLikeCoordinateRewrites(
  source: string,
  context: EllipseLikeRotateContext,
  nextContext: SiteContext
): { kind: "success"; replacements: Array<{ span: Span; text: TikzFragment }> } | { kind: "unsupported"; reason: string } {
  return rewriteHandleTargets(source, [
    {
      handle: context.centerHandle,
      context: contextFor(context.centerHandle, nextContext),
      newWorld: context.center
    }
  ]);
}

function rewriteHandleTargets(
  source: string,
  targets: Array<{ handle: EditHandle; context: SiteContext | undefined; newWorld: WorldPoint }>
): { kind: "success"; replacements: Array<{ span: Span; text: TikzFragment }> } | { kind: "unsupported"; reason: string } {
  const replacementBySpan = new Map<string, { span: Span; text: TikzFragment }>();
  for (const target of targets) {
    const handle = target.handle;
    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      return { kind: "unsupported", reason: "Some selected handles are stale. Wait for recompute and try again." };
    }

    const text = rewritePreciseFrameCoordinate(target.newWorld, handle, source, false, target.context);
    if (text == null) {
      return { kind: "unsupported", reason: "Could not rewrite one or more coordinates for center-pivot rotate." };
    }
    if (text === actualText) {
      continue;
    }
    const spanKey = `${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`;
    const existing = replacementBySpan.get(spanKey);
    if (existing) {
      if (existing.text !== text) {
        return { kind: "unsupported", reason: "Center-pivot rotate produced conflicting rewrites for a shared coordinate." };
      }
      continue;
    }
    replacementBySpan.set(spanKey, {
      span: handle.sourceRef.sourceSpan,
      text
    });
  }
  return { kind: "success", replacements: [...replacementBySpan.values()] };
}

/** The frame after the rotation edit, for a direct coordinate read in it. */
function contextFor(handle: EditHandle, context: SiteContext): SiteContext | undefined {
  return isDirectFrameLocalHandle(handle) ? context : undefined;
}

function resolveCenterPivot(context: CenterPivotRotateContext): WorldPoint {
  if (context.kind === "rectangle") {
    return worldPoint(
      pt((context.startHandle.world.x + context.oppositeHandle.world.x) / 2),
      pt((context.startHandle.world.y + context.oppositeHandle.world.y) / 2)
    );
  }
  return context.center;
}

function pathHasUnsupportedTransformOptions(pathStatement: Extract<Statement, { kind: "Path" }>): boolean {
  const entries = pathStatement.options?.entries ?? [];
  for (const entry of entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    const key = normalizeOptionKey(entry.key);
    if (
      key === "rotate" ||
      key === "/tikz/rotate" ||
      key === "rotate around" ||
      key === "/tikz/rotate around"
    ) {
      continue;
    }
    if (TRANSFORM_OPTION_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}

const TRANSFORM_OPTION_KEYS = new Set([
  "shift",
  "/tikz/shift",
  "xshift",
  "/tikz/xshift",
  "yshift",
  "/tikz/yshift",
  "scale",
  "/tikz/scale",
  "xscale",
  "/tikz/xscale",
  "yscale",
  "/tikz/yscale",
  "cm",
  "/tikz/cm",
  "transform canvas",
  "/tikz/transform canvas"
]);

function resolveScenePathShapeHint(
  path: ScenePath,
  pathStatement: Extract<Statement, { kind: "Path" }>
): ScenePathShapeHint | null {
  return path.shapeHint ?? resolvePathShapeHintFromItems(pathStatement.items);
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


function isDirectFrameLocalHandle(handle: EditHandle): handle is EditHandle & {
  rewriteMode: "direct";
  local: { x: number; y: number };
  frame: FrameTransform;
  transform: FrameTransform;
} {
  return isFrameLocalCoordinateEditHandle(handle) && handle.rewriteMode === "direct";
}

function rotateWorldPointAroundCenter(point: WorldPoint, center: WorldPoint, degrees: number): WorldPoint {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return worldPoint(
    pt(center.x + dx * cos - dy * sin),
    pt(center.y + dx * sin + dy * cos)
  );
}



function adjustReplacementsForPriorPatches(
  replacements: Array<{ span: Span; text: TikzFragment }>,
  patches: readonly SourcePatch[]
): Array<{ span: Span; text: TikzFragment }> {
  let adjusted = replacements;
  for (const patch of patches) {
    const delta = (patch.newSpan.to - patch.newSpan.from) - (patch.oldSpan.to - patch.oldSpan.from);
    if (delta === 0) {
      continue;
    }
    adjusted = adjusted.map((replacement) => ({
      ...replacement,
      span:
        replacement.span.from >= patch.oldSpan.to
          ? {
              from: replacement.span.from + delta,
              to: replacement.span.to + delta
            }
          : replacement.span
    }));
  }
  return adjusted;
}

function spansEqual(left: Span, right: Span): boolean {
  return left.from === right.from && left.to === right.to;
}

function normalizeTinyNumber(value: number): number {
  return Math.abs(value) <= 1e-9 ? 0 : value;
}

function normalizeSignedDeg(value: number): number {
  let normalized = value % 360;
  if (normalized <= -180) normalized += 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}

function computeReplacementPatch(oldSource: string, newSource: EditedSource): SourcePatch {
  const oldLen = oldSource.length;
  const newLen = newSource.length;
  const minLen = Math.min(oldLen, newLen);
  let prefix = 0;
  while (prefix < minLen && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }
  let oldSuffix = oldLen;
  let newSuffix = newLen;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }
  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: editedSlice(newSource, prefix, newSuffix)
  };
}
