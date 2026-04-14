import type {
  EditHandle,
  EvaluateOptions,
  Point,
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathShapeHint
} from "../../semantic/types.js";
import type { CoordinateItem, NodeItem, PathItem, PathOptionItem, Statement, Span } from "../../ast/types.js";
import type { PropertyTarget } from "../property-target.js";
import { resolvePropertyTarget } from "../property-target.js";
import { evaluateTikzFigure } from "../../semantic/evaluate.js";
import { parseCircleRadiusFromCoordinateRaw, parseEllipseRadiiFromCoordinateRaw } from "../../semantic/path/parsers.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { resolveNodeShape } from "../../semantic/nodes/options.js";
import { applyMatrix, inverseMatrix } from "../../semantic/transform.js";
import { collectSourceWorldBounds } from "../snapping/index.js";
import { worldToLocal } from "../coords.js";
import { replaceSpan } from "../patch.js";
import { rewriteCoordinate } from "../rewrite.js";
import { CM_PER_PT, formatNumber } from "../format.js";
import { applyTextReplacements } from "../statement-ops.js";
import { resolveTransformInspectorMutationContextFromOptionEntries } from "../inspector.js";
import {
  applyOptionMutationsToTarget,
  normalizeOptionKey,
  rewriteOptionListMutations,
  serializeOptionEntry,
  type OptionMutation,
  type OptionMutationApplyResult
} from "../option-mutations.js";
import type { SourcePatch } from "../types.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import { FIT_DIRECT_MANIPULATION_BLOCK_REASON, propertyTargetUsesFit, sourceUsesFitNodeFromParseResult } from "../fit.js";

const RESIZE_EPSILON = 1e-3;

type ResizeRole =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

type NodeWidthResizeStrategy = "minimum-width" | "text-width";

export type ResizeElementAction = {
  elementId: string;
  role: ResizeRole;
  newWorld: Point;
  preserveAspect?: boolean;
  preserveAspectRatio?: number;
  referenceBounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  referenceScopeTransform?: {
    xscale: number;
    yscale: number;
    xshift: number;
    yshift: number;
  };
};

type EditActionResultLike =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

export function applyResizeElementAction(
  source: string,
  action: ResizeElementAction,
  evaluateOptions: EvaluateOptions | undefined,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const elementId = action.elementId.trim();
  if (elementId.length === 0) {
    return { kind: "unsupported", reason: "Missing element id for resizeElement." };
  }

  const resolved = resolvePropertyTarget(source, elementId, parseOptions);
  if (resolved.kind === "not-found") {
    return { kind: "unsupported", reason: resolved.reason };
  }
  if (propertyTargetUsesFit(resolved.target)) {
    return { kind: "unsupported", reason: FIT_DIRECT_MANIPULATION_BLOCK_REASON };
  }

  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  if (sourceUsesFitNodeFromParseResult(source, parsed, elementId)) {
    return { kind: "unsupported", reason: FIT_DIRECT_MANIPULATION_BLOCK_REASON };
  }
  const semantic = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
  const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
  const scopeBoundsById = buildScopeBoundsById(parsed.figure.body, boundsBySource);
  if (findScopeStatementById(parsed.figure.body, elementId)) {
    return applyResizeScope(source, action, resolved.target, scopeBoundsById, parsed.figure.body);
  }
  const hasNodePositionHandle = semantic.editHandles.some(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "node-position"
  );
  if (!hasNodePositionHandle) {
    const rectangleContext = resolvePathRectangleResizeContext(
      parsed.figure.body,
      semantic.scene.elements,
      semantic.editHandles,
      elementId
    );
    if (rectangleContext.kind === "found") {
      return applyResizePathRectangle(source, action, rectangleContext);
    }
    if (rectangleContext.kind === "unsupported") {
      return rectangleContext;
    }

    return applyResizePathCircleOrEllipse(
      source,
      action,
      parsed.figure.body,
      semantic.scene.elements,
      semantic.editHandles
    );
  }

  const resizeTarget = resolveResizePropertyTarget(
    source,
    parsed.figure.body,
    elementId,
    resolved.target,
    parseOptions
  );
  const isDiamondNodeShape = isDiamondNodeShapeInPathStatement(parsed.figure.body, elementId);
  const currentBounds = action.referenceBounds ?? resolveNodeResizeBounds(semantic.scene.elements, elementId);
  if (!currentBounds) {
    return { kind: "unsupported", reason: "No geometry bounds were found for the selected node." };
  }

  const center = {
    x: (currentBounds.minX + currentBounds.maxX) / 2,
    y: (currentBounds.minY + currentBounds.maxY) / 2
  };
  const nodeLinearTransform = resolveNodeResizeLinearTransform(semantic.scene.elements, elementId);
  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }
  const widthResizeStrategy = resolveNodeWidthResizeStrategy(resizeTarget, affectsWidth);

  const floorMutations = new Map<string, OptionMutation>([
    ["minimum width", { kind: "remove" }],
    ["minimum height", { kind: "remove" }]
  ]);
  const floorRewrite = applyOptionMutationsToTarget(source, resizeTarget, floorMutations);
  const floorSource = floorRewrite ? floorRewrite.source : source;
  const floorParsed = parseTikzForEdit(floorSource, {
    ...parseOptions,
  });
  const floorSemantic = evaluateTikzFigure(floorParsed.figure, floorSource, evaluateOptions);
  const floorBounds = resolveNodeResizeBounds(floorSemantic.scene.elements, elementId);
  if (!floorBounds) {
    return { kind: "unsupported", reason: "Could not resolve intrinsic node bounds for resize." };
  }

  const pointerDelta = {
    x: action.newWorld.x - center.x,
    y: action.newWorld.y - center.y
  };
  const localPointerDelta = nodeLinearTransform
    ? worldVectorToLocal(pointerDelta, nodeLinearTransform)
    : pointerDelta;
  const requestedWidth = 2 * Math.abs(localPointerDelta.x);
  const requestedHeight = 2 * Math.abs(localPointerDelta.y);
  const intrinsicWorldWidth = floorBounds.maxX - floorBounds.minX;
  const intrinsicWorldHeight = floorBounds.maxY - floorBounds.minY;
  const intrinsicLocal = nodeLinearTransform
    ? worldSizeToLocalSize({ width: intrinsicWorldWidth, height: intrinsicWorldHeight }, nodeLinearTransform)
    : { width: intrinsicWorldWidth, height: intrinsicWorldHeight };
  const intrinsicWidth = intrinsicLocal.width;
  const intrinsicHeight = intrinsicLocal.height;
  const inferredTextWidthInset = resolveNodeTextWidthInsetLocal({
    elements: floorSemantic.scene.elements,
    sourceId: elementId,
    nodeLinearTransform,
    intrinsicLocalWidth: intrinsicWidth,
    intrinsicWorldWidth
  });
  const fallbackTextWidthInset = resolveNodeHorizontalInsetFallback(resizeTarget);
  const effectiveTextWidthInset = inferredTextWidthInset ?? fallbackTextWidthInset;
  const requestedTextWidth =
    widthResizeStrategy === "text-width"
      ? Math.max(RESIZE_EPSILON, requestedWidth - effectiveTextWidthInset)
      : null;
  const liveBounds = resolveNodeResizeBounds(semantic.scene.elements, elementId) ?? currentBounds;
  const liveWorldWidth = liveBounds.maxX - liveBounds.minX;
  const liveWorldHeight = liveBounds.maxY - liveBounds.minY;
  const liveLocalSize = nodeLinearTransform
    ? worldSizeToLocalSize({ width: liveWorldWidth, height: liveWorldHeight }, nodeLinearTransform)
    : { width: liveWorldWidth, height: liveWorldHeight };

  if (isDiamondNodeShape && isSideResizeRole(action.role)) {
    const rewritten = rewriteDiamondSideResize({
      source,
      resizeTarget,
      role: action.role,
      requestedWidth,
      requestedHeight,
      currentWidth: liveLocalSize.width,
      currentHeight: liveLocalSize.height
    });
    if (rewritten) {
      return {
        kind: "success",
        newSource: rewritten.source,
        patches: [rewritten.patch]
      };
    }
  }

  const preserveExplicitWidthFloor = targetHasOptionKey(resizeTarget, "minimum width");
  const preservePathAttachedWidthFloor = isPathAttachedNodeTargetId(parsed.figure.body, resizeTarget.id);
  const preserveExplicitHeightFloor = targetHasOptionKey(resizeTarget, "minimum height");

  const resizeCandidates = buildNodeResizeMutationCandidates({
    widthResizeStrategy,
    affectsWidth,
    affectsHeight,
    requestedWidth,
    requestedTextWidth,
    requestedHeight,
    intrinsicWidth,
    intrinsicHeight,
    preserveExplicitWidthFloor: preserveExplicitWidthFloor && !preservePathAttachedWidthFloor,
    preserveExplicitHeightFloor
  });
  const rewritten = chooseBestNodeResizeMutationCandidate({
    source,
    resizeTarget,
    elementId,
    evaluateOptions,
    parseOptions,
    nodeLinearTransform,
    affectsWidth,
    affectsHeight,
    requestedWidth,
    requestedHeight,
    candidates: resizeCandidates
  });
  if (!rewritten) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch]
  };
}

function buildNodeResizeMutationCandidates(args: {
  widthResizeStrategy: NodeWidthResizeStrategy;
  affectsWidth: boolean;
  affectsHeight: boolean;
  requestedWidth: number;
  requestedTextWidth: number | null;
  requestedHeight: number;
  intrinsicWidth: number;
  intrinsicHeight: number;
  preserveExplicitWidthFloor: boolean;
  preserveExplicitHeightFloor: boolean;
}): Array<{ mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean }> {
  const {
    widthResizeStrategy,
    affectsWidth,
    affectsHeight,
    requestedWidth,
    requestedTextWidth,
    requestedHeight,
    intrinsicWidth,
    intrinsicHeight,
    preserveExplicitWidthFloor,
    preserveExplicitHeightFloor
  } = args;
  if (widthResizeStrategy === "text-width" && affectsWidth) {
    const textWidthMutation: OptionMutation = {
      kind: "set",
      value: `${formatNumber(Math.max(RESIZE_EPSILON, requestedTextWidth ?? RESIZE_EPSILON))}pt`
    };
    const heightMutation: OptionMutation =
      requestedHeight > intrinsicHeight + RESIZE_EPSILON
        ? { kind: "set", value: `${formatNumber(requestedHeight)}pt` }
        : { kind: "remove" };
    const candidates: Array<{ mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean }> = [];
    if (!affectsHeight) {
      candidates.push(buildResizeCandidate(new Map([["text width", textWidthMutation]]), false));
      return dedupeResizeCandidates(candidates);
    }
    if (affectsWidth && affectsHeight) {
      candidates.push(buildResizeCandidate(new Map([
        ["text width", textWidthMutation],
        ["minimum height", heightMutation]
      ]), false));
      if (heightMutation.kind === "set") {
        candidates.push(buildResizeCandidate(new Map<string, OptionMutation>([
          ["text width", textWidthMutation],
          ["minimum height", { kind: "remove" }]
        ]), true));
      }
      return dedupeResizeCandidates(candidates);
    }
    candidates.push(buildResizeCandidate(new Map([["text width", textWidthMutation]]), false));
    return dedupeResizeCandidates(candidates);
  }

  const widthMutation: OptionMutation =
    requestedWidth > intrinsicWidth + RESIZE_EPSILON
      ? { kind: "set", value: `${formatNumber(requestedWidth)}pt` }
      : preserveExplicitWidthFloor
        ? { kind: "set", value: `${formatNumber(intrinsicWidth)}pt` }
        : { kind: "remove" };
  const heightMutation: OptionMutation =
    requestedHeight > intrinsicHeight + RESIZE_EPSILON
      ? { kind: "set", value: `${formatNumber(requestedHeight)}pt` }
      : { kind: "remove" };

  const candidates: Array<{ mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean }> = [];

  if (affectsWidth && affectsHeight) {
    candidates.push(buildResizeCandidate(new Map([
      ["minimum width", widthMutation],
      ["minimum height", heightMutation]
    ]), false));
    if (heightMutation.kind === "set") {
      candidates.push(buildResizeCandidate(new Map([
        ["minimum width", widthMutation],
        ["minimum height", { kind: "remove" }]
      ]), true));
    }
    if (!preserveExplicitWidthFloor) {
      candidates.push(buildResizeCandidate(new Map([
        ["minimum width", { kind: "remove" }],
        ["minimum height", heightMutation]
      ]), true));
    }
    return dedupeResizeCandidates(candidates);
  }

  if (affectsWidth) {
    candidates.push(buildResizeCandidate(new Map([["minimum width", widthMutation]]), false));
    if (!preserveExplicitHeightFloor) {
      candidates.push(buildResizeCandidate(new Map([
        ["minimum width", widthMutation],
        ["minimum height", { kind: "remove" }]
      ]), true));
    }
  }

  if (affectsHeight) {
    candidates.push(buildResizeCandidate(new Map([["minimum height", heightMutation]]), false));
    if (!preserveExplicitWidthFloor) {
      candidates.push(buildResizeCandidate(new Map([
        ["minimum width", { kind: "remove" }],
        ["minimum height", heightMutation]
      ]), true));
    }
  }

  return dedupeResizeCandidates(candidates);
}

function buildResizeCandidate(
  mutations: Map<string, OptionMutation>,
  removesOtherConstraint: boolean
): { mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean } {
  let explicitConstraintCount = 0;
  for (const mutation of mutations.values()) {
    if (mutation.kind === "set") {
      explicitConstraintCount += 1;
    }
  }
  return { mutations, explicitConstraintCount, removesOtherConstraint };
}

function dedupeResizeCandidates(
  candidates: ReadonlyArray<{ mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean }>
): Array<{ mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean }> {
  const unique = new Map<string, { mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean }>();
  for (const candidate of candidates) {
    const key = [...candidate.mutations.entries()]
      .map(([name, mutation]) => `${name}:${mutation.kind === "set" ? mutation.value : "remove"}`)
      .sort()
      .join("|");
    if (!unique.has(key)) {
      unique.set(key, candidate);
    }
  }
  return [...unique.values()];
}

function chooseBestNodeResizeMutationCandidate(args: {
  source: string;
  resizeTarget: PropertyTarget;
  elementId: string;
  evaluateOptions: EvaluateOptions | undefined;
  parseOptions: EditParseOptions;
  nodeLinearTransform: { a: number; b: number; c: number; d: number } | null;
  affectsWidth: boolean;
  affectsHeight: boolean;
  requestedWidth: number;
  requestedHeight: number;
  candidates: ReadonlyArray<{ mutations: Map<string, OptionMutation>; explicitConstraintCount: number; removesOtherConstraint: boolean }>;
}): OptionMutationApplyResult | null {
  const {
    source,
    resizeTarget,
    elementId,
    evaluateOptions,
    parseOptions,
    nodeLinearTransform,
    affectsWidth,
    affectsHeight,
    requestedWidth,
    requestedHeight,
    candidates
  } = args;

  let best: OptionMutationApplyResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const rewritten = applyOptionMutationsToTarget(source, resizeTarget, candidate.mutations);
    const candidateSource = rewritten ? rewritten.source : source;
    const parsed = parseTikzForEdit(candidateSource, {
      ...parseOptions,
    });
    const semantic = evaluateTikzFigure(parsed.figure, candidateSource, evaluateOptions);
    const boundsBySource = collectSourceWorldBounds(semantic.scene.elements);
    const bounds = boundsBySource.get(elementId);
    if (!bounds) {
      continue;
    }
    const localSize = nodeLinearTransform
      ? worldSizeToLocalSize({ width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }, nodeLinearTransform)
      : { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
    const score =
      (affectsWidth ? Math.abs(localSize.width - requestedWidth) : 0) +
      (affectsHeight ? Math.abs(localSize.height - requestedHeight) : 0) +
      candidate.explicitConstraintCount * 0.01 +
      (candidate.removesOtherConstraint ? 0.005 : 0);
    if (score < bestScore - 1e-6) {
      bestScore = score;
      best = rewritten;
    }
  }

  return best;
}

function applyResizeScope(
  source: string,
  action: ResizeElementAction,
  target: PropertyTarget,
  scopeBoundsById: ReadonlyMap<string, { minX: number; minY: number; maxX: number; maxY: number }>,
  statements: readonly Statement[]
): EditActionResultLike {
  const bounds = action.referenceBounds ?? scopeBoundsById.get(action.elementId);
  if (!bounds) {
    return { kind: "unsupported", reason: "No geometry bounds were found for the selected scope." };
  }

  const currentWidth = bounds.maxX - bounds.minX;
  const currentHeight = bounds.maxY - bounds.minY;
  if (!(currentWidth > RESIZE_EPSILON) || !(currentHeight > RESIZE_EPSILON)) {
    return { kind: "unsupported", reason: "Resize requires a scope with non-zero bounds." };
  }

  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const currentContext = resolveTransformInspectorMutationContextFromOptionEntries(target.options?.entries);
  if (Math.abs(currentContext.values.rotate) > 1e-6) {
    return { kind: "unsupported", reason: "Scope resize currently supports only non-rotated scopes." };
  }
  const baseValues = action.referenceScopeTransform ?? currentContext.values;

  const fixed = resolveFixedScopePoint(bounds, action.role);
  let nextWidth = affectsWidth ? Math.abs(action.newWorld.x - fixed.x) : currentWidth;
  let nextHeight = affectsHeight ? Math.abs(action.newWorld.y - fixed.y) : currentHeight;

  if (action.preserveAspect && affectsWidth && affectsHeight) {
    const uniformScale = Math.max(nextWidth / currentWidth, nextHeight / currentHeight);
    nextWidth = currentWidth * uniformScale;
    nextHeight = currentHeight * uniformScale;
  }

  nextWidth = Math.max(nextWidth, RESIZE_EPSILON);
  nextHeight = Math.max(nextHeight, RESIZE_EPSILON);

  const scaleRatioX = affectsWidth ? nextWidth / currentWidth : 1;
  const scaleRatioY = affectsHeight ? nextHeight / currentHeight : 1;
  const nextValues = {
    xscale: baseValues.xscale * scaleRatioX,
    yscale: baseValues.yscale * scaleRatioY,
    xshift: affectsWidth
      ? fixed.x - scaleRatioX * (fixed.x - baseValues.xshift)
      : baseValues.xshift,
    yshift: affectsHeight
      ? fixed.y - scaleRatioY * (fixed.y - baseValues.yshift)
      : baseValues.yshift
  };

  if (
    !Number.isFinite(nextValues.xscale) ||
    !Number.isFinite(nextValues.yscale) ||
    !Number.isFinite(nextValues.xshift) ||
    !Number.isFinite(nextValues.yshift)
  ) {
    return { kind: "unsupported", reason: "Scope resize produced a non-finite transform." };
  }

  const rewritten = applyScopeTransformRewrite(source, target, nextValues);
  if (!rewritten) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    changedSourceIds: expandScopeChangedSourceIds(statements, [action.elementId])
  };
}

function applyScopeTransformRewrite(
  source: string,
  target: PropertyTarget,
  values: { xscale: number; yscale: number; xshift: number; yshift: number },
): OptionMutationApplyResult | null {
  const orderedSetMutations = new Map<string, OptionMutation>();
  if (Math.abs(values.xshift) > RESIZE_EPSILON) {
    orderedSetMutations.set("xshift", { kind: "set", value: `${formatNumber(values.xshift)}pt` });
  }
  if (Math.abs(values.yshift) > RESIZE_EPSILON) {
    orderedSetMutations.set("yshift", { kind: "set", value: `${formatNumber(values.yshift)}pt` });
  }
  if (Math.abs(values.xscale - 1) > RESIZE_EPSILON) {
    orderedSetMutations.set("xscale", { kind: "set", value: formatNumber(values.xscale) });
  }
  if (Math.abs(values.yscale - 1) > RESIZE_EPSILON) {
    orderedSetMutations.set("yscale", { kind: "set", value: formatNumber(values.yscale) });
  }

  if (target.options && target.optionsSpan) {
    const filteredOptions = {
      ...target.options,
      entries: target.options.entries.filter((entry) => {
        if (entry.kind !== "kv" && entry.kind !== "flag") {
          return true;
        }
        const key = normalizeOptionKey(entry.key);
        return !SCOPE_TRANSFORM_OPTION_KEYS.has(key);
      })
    };
    const replacement = rewriteOptionListMutations(
      filteredOptions,
      orderedSetMutations,
      undefined,
      target.optionsFormat ?? "bracketed"
    );
    const oldSpan = target.optionsSpan;
    const previous = source.slice(oldSpan.from, oldSpan.to);
    if (previous === replacement) {
      return null;
    }
    const updated = replaceSpan(source, oldSpan, replacement);
    return {
      source: updated.source,
      patch: {
        oldSpan,
        newSpan: updated.changedSpan,
        replacement
      }
    };
  }

  return applyOptionMutationsToTarget(source, target, orderedSetMutations);
}

const SCOPE_TRANSFORM_OPTION_KEYS = new Set([
  "scale",
  "/tikz/scale",
  "xscale",
  "/tikz/xscale",
  "yscale",
  "/tikz/yscale",
  "shift",
  "/tikz/shift",
  "xshift",
  "/tikz/xshift",
  "yshift",
  "/tikz/yshift"
]);

function resolveFixedScopePoint(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  role: ResizeRole
): Point {
  switch (role) {
    case "top-left":
      return { x: bounds.maxX, y: bounds.minY };
    case "top-right":
      return { x: bounds.minX, y: bounds.minY };
    case "bottom-left":
      return { x: bounds.maxX, y: bounds.maxY };
    case "bottom-right":
      return { x: bounds.minX, y: bounds.maxY };
    case "left":
      return { x: bounds.maxX, y: (bounds.minY + bounds.maxY) / 2 };
    case "right":
      return { x: bounds.minX, y: (bounds.minY + bounds.maxY) / 2 };
    case "top":
      return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY };
    case "bottom":
      return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY };
  }
}

function buildScopeBoundsById(
  statements: readonly Statement[],
  boundsBySource: ReadonlyMap<string, { minX: number; minY: number; maxX: number; maxY: number }>
): Map<string, { minX: number; minY: number; maxX: number; maxY: number }> {
  const boundsByScopeId = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();

  const visit = (items: readonly Statement[]): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    let merged: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    for (const statement of items) {
      if (statement.kind === "Scope") {
        const childBounds = visit(statement.body);
        if (childBounds) {
          boundsByScopeId.set(statement.id, childBounds);
          merged = merged ? mergeBounds(merged, childBounds) : childBounds;
        }
        continue;
      }
      const ownBounds = boundsBySource.get(statement.id);
      if (ownBounds) {
        merged = merged ? mergeBounds(merged, ownBounds) : ownBounds;
      }
    }
    return merged;
  };

  visit(statements);
  return boundsByScopeId;
}

function mergeBounds(
  left: { minX: number; minY: number; maxX: number; maxY: number },
  right: { minX: number; minY: number; maxX: number; maxY: number }
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY)
  };
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

function expandScopeChangedSourceIds(
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

type PathShapeResizeSyntax = {
  keyword: "circle" | "ellipse";
  keywordSpan: Span;
  optionItems: PathOptionItem[];
  payloadCoordinate: CoordinateItem | null;
};

type PathShapeResizeContext = {
  kind: "found";
  shapeKind: "circle" | "ellipse";
  center: Point;
  syntax: PathShapeResizeSyntax;
  centerHandle: EditHandle;
};

type RectangleCornerRole = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type PathRectangleResizeContext = {
  kind: "found";
  startHandle: EditHandle;
  oppositeHandle: EditHandle;
};

type PathRectangleResizeResolution =
  | PathRectangleResizeContext
  | { kind: "not-rectangle" }
  | { kind: "unsupported"; reason: string };

function applyResizePathRectangle(
  source: string,
  action: ResizeElementAction,
  context: PathRectangleResizeContext
): EditActionResultLike {
  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const transform = context.startHandle.transform;
  const localPointer = worldToLocal(action.newWorld, transform);
  const startLocal = context.startHandle.local ?? worldToLocal(context.startHandle.world, transform);
  const oppositeLocal = context.oppositeHandle.local ?? worldToLocal(context.oppositeHandle.world, transform);
  if (!localPointer || !startLocal || !oppositeLocal) {
    return { kind: "unsupported", reason: "Could not resolve local geometry for rectangle resize." };
  }

  const roleCorners = resolveRectangleRoleCorners(startLocal, oppositeLocal);
  const currentMinX = Math.min(startLocal.x, oppositeLocal.x);
  const currentMaxX = Math.max(startLocal.x, oppositeLocal.x);
  const currentMinY = Math.min(startLocal.y, oppositeLocal.y);
  const currentMaxY = Math.max(startLocal.y, oppositeLocal.y);

  let minX = currentMinX;
  let maxX = currentMaxX;
  let minY = currentMinY;
  let maxY = currentMaxY;

  if (isRectangleCornerRole(action.role)) {
    const fixedLocal = roleCorners[oppositeRectangleCornerRole(action.role)];
    minX = Math.min(fixedLocal.x, localPointer.x);
    maxX = Math.max(fixedLocal.x, localPointer.x);
    minY = Math.min(fixedLocal.y, localPointer.y);
    maxY = Math.max(fixedLocal.y, localPointer.y);
  } else if (action.role === "left" || action.role === "right") {
    const fixedX = action.role === "left"
      ? (roleCorners["top-right"].x + roleCorners["bottom-right"].x) / 2
      : (roleCorners["top-left"].x + roleCorners["bottom-left"].x) / 2;
    minX = Math.min(fixedX, localPointer.x);
    maxX = Math.max(fixedX, localPointer.x);
  } else if (action.role === "top" || action.role === "bottom") {
    const fixedY = action.role === "top"
      ? (roleCorners["bottom-left"].y + roleCorners["bottom-right"].y) / 2
      : (roleCorners["top-left"].y + roleCorners["top-right"].y) / 2;
    minY = Math.min(fixedY, localPointer.y);
    maxY = Math.max(fixedY, localPointer.y);
  }

  const startUsesMinX = startLocal.x <= oppositeLocal.x;
  const startUsesMinY = startLocal.y <= oppositeLocal.y;

  const nextStartLocal: Point = {
    x: startUsesMinX ? minX : maxX,
    y: startUsesMinY ? minY : maxY
  };
  const nextOppositeLocal: Point = {
    x: startUsesMinX ? maxX : minX,
    y: startUsesMinY ? maxY : minY
  };

  const nextStartWorld = applyMatrix(transform, nextStartLocal);
  const nextOppositeWorld = applyMatrix(transform, nextOppositeLocal);
  let oppositeRewriteHandle = context.oppositeHandle;
  if (
    oppositeRewriteHandle.rewriteMode === "delta" &&
    oppositeRewriteHandle.relativeBaseWorld &&
    pointDistanceSquared(oppositeRewriteHandle.relativeBaseWorld, context.startHandle.world) <= 1e-6
  ) {
    oppositeRewriteHandle = {
      ...oppositeRewriteHandle,
      relativeBaseWorld: nextStartWorld
    };
  }

  const rewriteTargets: Array<{ handle: EditHandle; newWorld: Point }> = [
    { handle: context.startHandle, newWorld: nextStartWorld },
    { handle: oppositeRewriteHandle, newWorld: nextOppositeWorld }
  ];

  const replacementBySpan = new Map<string, { span: Span; text: string }>();
  for (const target of rewriteTargets) {
    const handle = target.handle;
    const actualText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
    if (actualText !== handle.sourceText) {
      return { kind: "unsupported", reason: "Some selected handles are stale. Wait for recompute and try again." };
    }

    const text = rewriteCoordinate(target.newWorld, handle, source);
    if (text == null) {
      return { kind: "unsupported", reason: "Could not rewrite one or more rectangle coordinates." };
    }
    if (text === actualText) {
      continue;
    }

    const spanKey = `${handle.sourceRef.sourceSpan.from}:${handle.sourceRef.sourceSpan.to}`;
    const existing = replacementBySpan.get(spanKey);
    if (existing) {
      if (existing.text !== text) {
        return { kind: "unsupported", reason: "Rectangle resize produced conflicting rewrites for a shared coordinate." };
      }
      continue;
    }

    replacementBySpan.set(spanKey, {
      span: handle.sourceRef.sourceSpan,
      text
    });
  }

  const replacements = [...replacementBySpan.values()];
  if (replacements.length === 0) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  const applied = applyTextReplacements(source, replacements);
  if (applied.source === source) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: applied.source,
    patches: applied.patches
  };
}

function resolvePathRectangleResizeContext(
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  elementId: string
): PathRectangleResizeResolution {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return { kind: "not-rectangle" };
  }

  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === elementId && !element.adornment);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  if (nonTextElements.length !== 1) {
    return { kind: "not-rectangle" };
  }

  const rectangle = nonTextElements[0];
  if (!rectangle || rectangle.kind !== "Path") {
    return { kind: "not-rectangle" };
  }
  if (resolveScenePathShapeHint(rectangle, pathStatement) !== "rectangle") {
    return { kind: "not-rectangle" };
  }

  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "path-point"
  );
  if (pathPointHandles.length !== 2) {
    return {
      kind: "unsupported",
      reason: "Resize requires rectangles with explicit start and target coordinates."
    };
  }

  const [startHandle, oppositeHandle] = pathPointHandles;
  if (!startHandle || !oppositeHandle) {
    return {
      kind: "unsupported",
      reason: "Resize requires rectangles with explicit start and target coordinates."
    };
  }

  if (startHandle.rewriteMode === "unsupported" || oppositeHandle.rewriteMode === "unsupported") {
    return {
      kind: "unsupported",
      reason: "Rectangle resize requires rewritable rectangle coordinates."
    };
  }

  if (
    startHandle.sourceRef.sourceSpan.from === oppositeHandle.sourceRef.sourceSpan.from &&
    startHandle.sourceRef.sourceSpan.to === oppositeHandle.sourceRef.sourceSpan.to
  ) {
    return {
      kind: "unsupported",
      reason: "Rectangle resize cannot target shared coordinate spans."
    };
  }

  if (!transformsApproximatelyEqual(startHandle.transform, oppositeHandle.transform)) {
    return {
      kind: "unsupported",
      reason: "Rectangle resize requires matching coordinate transforms."
    };
  }

  return {
    kind: "found",
    startHandle,
    oppositeHandle
  };
}

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
      if (item.keyword === "rectangle") {
        hints.add("rectangle");
      } else if (item.keyword === "circle") {
        hints.add("circle");
      } else if (item.keyword === "ellipse") {
        hints.add("ellipse");
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      collectPathShapeHints(item.body, hints);
    }
  }
}

function applyResizePathCircleOrEllipse(
  source: string,
  action: ResizeElementAction,
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[]
): EditActionResultLike {
  const elementId = action.elementId.trim();
  const context = resolvePathShapeResizeContext(statements, elements, editHandles, elementId);
  if (context.kind === "unsupported") {
    return context;
  }

  const affectsWidth = action.role.includes("left") || action.role.includes("right");
  const affectsHeight = action.role.includes("top") || action.role.includes("bottom");
  if (!affectsWidth && !affectsHeight) {
    return { kind: "unsupported", reason: `Unsupported resize role: ${action.role}` };
  }

  const localPointer = worldToLocal(action.newWorld, context.centerHandle.transform);
  const localCenter =
    context.centerHandle.local ?? worldToLocal(context.center, context.centerHandle.transform);
  if (!localPointer || !localCenter) {
    return { kind: "unsupported", reason: "Could not resolve local geometry for circle/ellipse resize." };
  }

  const localDx = Math.abs(localPointer.x - localCenter.x);
  const localDy = Math.abs(localPointer.y - localCenter.y);
  const currentLocalRadii = resolveCurrentLocalShapeRadii(context.syntax);
  if ((!affectsWidth || !affectsHeight) && !currentLocalRadii) {
    return { kind: "unsupported", reason: "Resize requires explicit circle/ellipse radii for single-axis drags." };
  }

  let nextRxLocal = affectsWidth ? localDx : (currentLocalRadii?.rx ?? localDx);
  let nextRyLocal = affectsHeight ? localDy : (currentLocalRadii?.ry ?? localDy);
  if (context.shapeKind === "circle") {
    const currentRadius = currentLocalRadii?.rx ?? Math.max(nextRxLocal, nextRyLocal);
    const nextRadius = Math.max(
      affectsWidth ? localDx : currentRadius,
      affectsHeight ? localDy : currentRadius
    );
    nextRxLocal = nextRadius;
    nextRyLocal = nextRadius;
  } else if (context.shapeKind === "ellipse" && action.preserveAspect) {
    const fallbackAspectRatio =
      currentLocalRadii && currentLocalRadii.rx > RESIZE_EPSILON && currentLocalRadii.ry > RESIZE_EPSILON
        ? currentLocalRadii.ry / currentLocalRadii.rx
        : null;
    const fixedAspectRatio =
      Number.isFinite(action.preserveAspectRatio) && (action.preserveAspectRatio ?? 0) > RESIZE_EPSILON
        ? action.preserveAspectRatio!
        : fallbackAspectRatio;
    if (!fixedAspectRatio || fixedAspectRatio <= RESIZE_EPSILON) {
      return { kind: "unsupported", reason: "Resize requires explicit ellipse radii to preserve aspect ratio." };
    }

    if (affectsWidth && affectsHeight) {
      nextRxLocal = Math.max(localDx, localDy / fixedAspectRatio);
      nextRyLocal = nextRxLocal * fixedAspectRatio;
    } else if (affectsWidth) {
      nextRxLocal = localDx;
      nextRyLocal = nextRxLocal * fixedAspectRatio;
    } else {
      nextRyLocal = localDy;
      nextRxLocal = nextRyLocal / fixedAspectRatio;
    }
  }

  nextRxLocal = Math.max(nextRxLocal, RESIZE_EPSILON);
  nextRyLocal = Math.max(nextRyLocal, RESIZE_EPSILON);

  const payloadRewrite = rewriteShapePayloadCoordinate(context.syntax, nextRxLocal, nextRyLocal);
  if (payloadRewrite) {
    const rewritten = applySpanTextReplacement(source, payloadRewrite.span, payloadRewrite.text);
    if (!rewritten) {
      return { kind: "unsupported", reason: "Resize would not change node constraints." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch]
    };
  }

  const radiusMutations = buildShapeRadiusMutations(context, nextRxLocal, nextRyLocal);
  const optionTarget = pickPathShapeResizeOptionTarget(context.syntax.optionItems);
  if (optionTarget) {
    const replacement = rewriteOptionListMutations(optionTarget.options, radiusMutations);
    const rewritten = applySpanTextReplacement(source, optionTarget.span, replacement);
    if (!rewritten) {
      return { kind: "unsupported", reason: "Resize would not change node constraints." };
    }
    return {
      kind: "success",
      newSource: rewritten.source,
      patches: [rewritten.patch]
    };
  }

  const entries: string[] = [];
  for (const [key, mutation] of radiusMutations.entries()) {
    if (mutation.kind === "set") {
      entries.push(serializeOptionEntry(key, mutation.value));
    }
  }
  if (entries.length === 0) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  const inserted = `[${entries.join(", ")}]`;
  const rewritten = applySpanTextReplacement(source, {
    from: context.syntax.keywordSpan.to,
    to: context.syntax.keywordSpan.to
  }, inserted);
  if (!rewritten) {
    return { kind: "unsupported", reason: "Resize would not change node constraints." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch]
  };
}

function resolvePathShapeResizeContext(
  statements: readonly Statement[],
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  elementId: string
): PathShapeResizeContext | { kind: "unsupported"; reason: string } {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return { kind: "unsupported", reason: "resizeElement currently supports only node-like or shape-path elements." };
  }

  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === elementId && !element.adornment);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  const explicitShapeElements = nonTextElements.filter(
    (element): element is SceneCircle | SceneEllipse => element.kind === "Circle" || element.kind === "Ellipse"
  );

  let shapeKind: "circle" | "ellipse" | null = null;
  let center: Point | null = null;
  let requireSingleCenterHandle = false;

  if (explicitShapeElements.length === 1 && nonTextElements.length === 1) {
    const explicitShape = explicitShapeElements[0]!;
    shapeKind = explicitShape.kind === "Circle" ? "circle" : "ellipse";
    center = explicitShape.center;
  } else if (explicitShapeElements.length === 0 && nonTextElements.length === 1 && nonTextElements[0]?.kind === "Path") {
    const pathElement = nonTextElements[0];
    const hint = resolveScenePathShapeHint(pathElement, pathStatement);
    if (hint === "circle" || hint === "ellipse") {
      shapeKind = hint;
      requireSingleCenterHandle = true;
    }
  }

  if (!shapeKind) {
    return { kind: "unsupported", reason: "Resize supports exactly one circle/ellipse primitive per statement." };
  }

  const syntax = resolvePathShapeResizeSyntax(pathStatement.items);
  if (!syntax) {
    return { kind: "unsupported", reason: "Could not resolve editable circle/ellipse source syntax." };
  }

  const candidateHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === elementId && handle.kind === "path-point"
  );
  if (candidateHandles.length === 0) {
    return { kind: "unsupported", reason: "No editable center handle was found for this circle/ellipse." };
  }
  if (requireSingleCenterHandle && candidateHandles.length !== 1) {
    return { kind: "unsupported", reason: "Resize requires circle/ellipse paths with explicit center coordinates." };
  }

  let centerHandle = candidateHandles[0]!;
  if (center) {
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const handle of candidateHandles) {
      const dx = handle.world.x - center.x;
      const dy = handle.world.y - center.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        centerHandle = handle;
      }
    }
  }

  return {
    kind: "found",
    shapeKind,
    center: center ?? centerHandle.world,
    syntax,
    centerHandle
  };
}

function resolvePathShapeResizeSyntax(items: readonly PathItem[]): PathShapeResizeSyntax | null {
  const keywordItems = items.filter(
    (item): item is Extract<PathItem, { kind: "PathKeyword" }> =>
      item.kind === "PathKeyword" && (item.keyword === "circle" || item.keyword === "ellipse")
  );
  if (keywordItems.length !== 1) {
    return null;
  }
  const keywordItem = keywordItems[0]!;
  const keywordIndex = items.findIndex((item) => item.id === keywordItem.id);
  if (keywordIndex < 0) {
    return null;
  }

  const optionItems: PathOptionItem[] = [];
  let payloadCoordinate: CoordinateItem | null = null;
  for (let index = keywordIndex + 1; index < items.length; index += 1) {
    const next = items[index];
    if (!next || next.kind === "PathComment") {
      continue;
    }
    if (next.kind === "PathOption" && !payloadCoordinate) {
      optionItems.push(next);
      continue;
    }
    if (next.kind === "Coordinate" && !payloadCoordinate) {
      const parsed =
        keywordItem.keyword === "circle"
          ? parseCircleRadiusFromCoordinateRaw(next.raw) != null
          : parseEllipseRadiiFromCoordinateRaw(next.raw) != null;
      if (parsed) {
        payloadCoordinate = next;
      }
      break;
    }
    break;
  }

  return {
    keyword: keywordItem.keyword === "ellipse" ? "ellipse" : "circle",
    keywordSpan: keywordItem.span,
    optionItems,
    payloadCoordinate
  };
}

function resolveCurrentLocalShapeRadii(
  syntax: PathShapeResizeSyntax
): { rx: number; ry: number } | null {
  const payload = syntax.payloadCoordinate;
  if (payload) {
    if (syntax.keyword === "circle") {
      const radius = parseCircleRadiusFromCoordinateRaw(payload.raw);
      if (radius != null) {
        return { rx: radius.value, ry: radius.value };
      }
    } else {
      const radii = parseEllipseRadiiFromCoordinateRaw(payload.raw);
      if (radii) {
        return { rx: radii.rx.value, ry: radii.ry.value };
      }
    }
  }

  if (syntax.keyword === "circle") {
    let radius: number | null = null;
    let radii: { rx: number; ry: number } | null = null;
    for (const item of syntax.optionItems) {
      const parsed = parseCircleRadiiFromOptionItem(item);
      if (parsed.kind === "radius") {
        radius = parsed.radius;
        radii = null;
      } else if (parsed.kind === "radii") {
        radius = null;
        radii = { rx: parsed.rx, ry: parsed.ry };
      }
    }
    if (radius != null) {
      return { rx: radius, ry: radius };
    }
    return radii;
  }

  let radii: { rx: number; ry: number } | null = null;
  for (const item of syntax.optionItems) {
    const parsed = parseEllipseRadiiFromOptionItem(item);
    if (parsed) {
      radii = parsed;
    }
  }
  return radii;
}

function parseCircleRadiiFromOptionItem(
  item: PathOptionItem
): { kind: "none" } | { kind: "radius"; radius: number } | { kind: "radii"; rx: number; ry: number } {
  let radius: number | null = null;
  let rx: number | null = null;
  let ry: number | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    }
  }

  if (radius != null) {
    return { kind: "radius", radius };
  }
  if (rx != null && ry != null) {
    return { kind: "radii", rx, ry };
  }
  return { kind: "none" };
}

function parseEllipseRadiiFromOptionItem(item: PathOptionItem): { rx: number; ry: number } | null {
  let rx: number | null = null;
  let ry: number | null = null;
  let radius: number | null = null;
  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    }
  }
  if (radius != null) {
    return { rx: radius, ry: radius };
  }
  if (rx != null && ry != null) {
    return { rx, ry };
  }
  return null;
}

function rewriteShapePayloadCoordinate(
  syntax: PathShapeResizeSyntax,
  nextRxLocal: number,
  nextRyLocal: number
): { span: Span; text: string } | null {
  if (!syntax.payloadCoordinate) {
    return null;
  }

  if (syntax.keyword === "circle") {
    if (parseCircleRadiusFromCoordinateRaw(syntax.payloadCoordinate.raw) == null) {
      return null;
    }
    return {
      span: syntax.payloadCoordinate.span,
      text: formatCircleRadiusCoordinateRaw(syntax.payloadCoordinate.raw, nextRxLocal)
    };
  }

  if (parseEllipseRadiiFromCoordinateRaw(syntax.payloadCoordinate.raw) == null) {
    return null;
  }
  return {
    span: syntax.payloadCoordinate.span,
    text: formatEllipseRadiiCoordinateRaw(syntax.payloadCoordinate.raw, nextRxLocal, nextRyLocal)
  };
}

function formatCircleRadiusCoordinateRaw(oldRaw: string, radiusPt: number): string {
  const value = `${formatNumber(radiusPt * CM_PER_PT)}cm`;
  const exact = oldRaw.match(/^\((\s*)([^)]*)(\s*)\)$/s);
  if (exact) {
    return `(${exact[1]}${value}${exact[3]})`;
  }
  return `(${value})`;
}

function formatEllipseRadiiCoordinateRaw(oldRaw: string, rxPt: number, ryPt: number): string {
  const rx = `${formatNumber(rxPt * CM_PER_PT)}cm`;
  const ry = `${formatNumber(ryPt * CM_PER_PT)}cm`;
  const exact = oldRaw.match(/^\((\s*)([^)]*?)(\s+and\s+)([^)]*?)(\s*)\)$/is);
  if (exact) {
    return `(${exact[1]}${rx}${exact[3]}${ry}${exact[5]})`;
  }
  return `(${rx} and ${ry})`;
}

function buildShapeRadiusMutations(
  context: PathShapeResizeContext,
  nextRxLocal: number,
  nextRyLocal: number
): Map<string, OptionMutation> {
  const mutations = new Map<string, OptionMutation>();
  if (context.shapeKind === "circle") {
    const radiusValue = `${formatNumber(nextRxLocal * CM_PER_PT)}cm`;
    mutations.set("radius", { kind: "set", value: radiusValue });
    mutations.set("x radius", { kind: "remove" });
    mutations.set("y radius", { kind: "remove" });
    return mutations;
  }

  mutations.set("x radius", { kind: "set", value: `${formatNumber(nextRxLocal * CM_PER_PT)}cm` });
  mutations.set("y radius", { kind: "set", value: `${formatNumber(nextRyLocal * CM_PER_PT)}cm` });
  mutations.set("radius", { kind: "remove" });
  return mutations;
}

function pickPathShapeResizeOptionTarget(
  optionItems: readonly PathOptionItem[]
): PathOptionItem | null {
  if (optionItems.length === 0) {
    return null;
  }
  for (let index = optionItems.length - 1; index >= 0; index -= 1) {
    const item = optionItems[index];
    if (!item) {
      continue;
    }
    const hasRadiusEntry = item.options.entries.some(
      (entry) =>
        entry.kind === "kv" &&
        (entry.key === "radius" || entry.key === "x radius" || entry.key === "y radius")
    );
    if (hasRadiusEntry) {
      return item;
    }
  }
  return optionItems[optionItems.length - 1] ?? null;
}

function applySpanTextReplacement(
  source: string,
  span: Span,
  replacement: string
): OptionMutationApplyResult | null {
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

function resolveRectangleRoleCorners(
  startLocal: Point,
  oppositeLocal: Point
): Record<RectangleCornerRole, Point> {
  const minX = Math.min(startLocal.x, oppositeLocal.x);
  const maxX = Math.max(startLocal.x, oppositeLocal.x);
  const minY = Math.min(startLocal.y, oppositeLocal.y);
  const maxY = Math.max(startLocal.y, oppositeLocal.y);

  return {
    "top-left": { x: minX, y: maxY },
    "top-right": { x: maxX, y: maxY },
    "bottom-left": { x: minX, y: minY },
    "bottom-right": { x: maxX, y: minY }
  };
}

function isRectangleCornerRole(role: ResizeRole): role is RectangleCornerRole {
  return role === "top-left" || role === "top-right" || role === "bottom-left" || role === "bottom-right";
}

function oppositeRectangleCornerRole(role: RectangleCornerRole): RectangleCornerRole {
  switch (role) {
    case "top-left":
      return "bottom-right";
    case "top-right":
      return "bottom-left";
    case "bottom-left":
      return "top-right";
    case "bottom-right":
      return "top-left";
  }
}

function pointDistanceSquared(left: Point, right: Point): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function resolveNodeResizeLinearTransform(
  elements: readonly SceneElement[],
  sourceId: string
): { a: number; b: number; c: number; d: number } | null {
  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === sourceId && !element.adornment);
  const transformed = sourceElements.find((element) => element.transform != null);
  if (!transformed?.transform) {
    return null;
  }
  return {
    a: transformed.transform.a,
    b: transformed.transform.b,
    c: transformed.transform.c,
    d: transformed.transform.d
  };
}

function resolveNodeResizeBounds(
  elements: readonly SceneElement[],
  sourceId: string
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const sourceElements = elements.filter(
    (element) =>
      element.sourceRef.sourceId === sourceId &&
      !element.adornment
  );
  if (sourceElements.length === 0) {
    return null;
  }

  const nonText = sourceElements.filter((element) => element.kind !== "Text");
  const boundsBySource = collectSourceWorldBounds(nonText.length > 0 ? nonText : sourceElements);
  return boundsBySource.get(sourceId) ?? null;
}

function targetHasOptionKey(target: PropertyTarget, key: string): boolean {
  const normalized = normalizeOptionKey(key);
  for (const entry of target.options?.entries ?? []) {
    if (entry.kind !== "kv" && entry.kind !== "flag") {
      continue;
    }
    if (normalizeOptionKey(entry.key) === normalized) {
      return true;
    }
  }
  return false;
}

function resolveNodeWidthResizeStrategy(target: PropertyTarget, affectsWidth: boolean): NodeWidthResizeStrategy {
  if (affectsWidth && targetHasOptionKey(target, "text width")) {
    return "text-width";
  }
  return "minimum-width";
}

function resolveNodeHorizontalInsetFallback(target: PropertyTarget): number {
  const defaultInnerXSep = parseLength(".3333em", "pt") ?? 3.333;
  let innerXSep = defaultInnerXSep;
  for (const entry of target.options?.entries ?? []) {
    if (entry.kind !== "kv") {
      continue;
    }
    const key = normalizeOptionKey(entry.key);
    if (key === "inner sep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        innerXSep = parsed;
      }
      continue;
    }
    if (key === "inner xsep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        innerXSep = parsed;
      }
    }
  }
  return Math.max(0, innerXSep * 2);
}

function resolveNodeTextWidthInsetLocal(args: {
  elements: readonly SceneElement[];
  sourceId: string;
  nodeLinearTransform: { a: number; b: number; c: number; d: number } | null;
  intrinsicLocalWidth: number;
  intrinsicWorldWidth: number;
}): number | null {
  const textElement = args.elements.find(
    (element): element is Extract<SceneElement, { kind: "Text" }> =>
      element.kind === "Text" &&
      element.sourceRef.sourceId === args.sourceId &&
      !element.adornment &&
      Number.isFinite(element.nodeVisualWidth) &&
      Number.isFinite(element.textBlockWidth)
  );
  if (!textElement || textElement.nodeVisualWidth == null || textElement.textBlockWidth == null) {
    return null;
  }

  const rawInset = Math.max(0, textElement.nodeVisualWidth - textElement.textBlockWidth);
  if (!Number.isFinite(rawInset)) {
    return null;
  }
  if (!args.nodeLinearTransform) {
    return rawInset;
  }

  const visualWidth = textElement.nodeVisualWidth;
  const diffToLocal = Math.abs(visualWidth - args.intrinsicLocalWidth);
  const diffToWorld = Math.abs(visualWidth - args.intrinsicWorldWidth);
  if (diffToWorld + RESIZE_EPSILON < diffToLocal) {
    const converted = worldSizeToLocalSize(
      { width: rawInset, height: 0 },
      args.nodeLinearTransform
    ).width;
    return Number.isFinite(converted) ? Math.max(0, converted) : rawInset;
  }
  return rawInset;
}

function isSideResizeRole(role: ResizeRole): role is Extract<ResizeRole, "left" | "right" | "top" | "bottom"> {
  return role === "left" || role === "right" || role === "top" || role === "bottom";
}

function rewriteDiamondSideResize(args: {
  source: string;
  resizeTarget: PropertyTarget;
  role: Extract<ResizeRole, "left" | "right" | "top" | "bottom">;
  requestedWidth: number;
  requestedHeight: number;
  currentWidth: number;
  currentHeight: number;
}): OptionMutationApplyResult | null {
  const { source, resizeTarget, role, requestedWidth, requestedHeight, currentWidth, currentHeight } = args;
  const dimensions = resolveTargetMinimumDimensions(resizeTarget);
  if (dimensions.hasMinimumSize) {
    return null;
  }
  const aspect = resolveDiamondAspectRatio(resizeTarget);

  const affectsWidth = role === "left" || role === "right";
  const safeAspect = Number.isFinite(aspect) && aspect > RESIZE_EPSILON ? aspect : 1;
  const mutations = new Map<string, OptionMutation>();

  if (dimensions.hasExplicitMinimumWidth && dimensions.hasExplicitMinimumHeight) {
    const currentPrimary = affectsWidth ? currentWidth : currentHeight;
    const requestedPrimary = affectsWidth ? requestedWidth : requestedHeight;
    if (!Number.isFinite(currentPrimary) || !Number.isFinite(requestedPrimary) || currentPrimary <= RESIZE_EPSILON) {
      return null;
    }
    const scale = Math.max(0, requestedPrimary / currentPrimary);
    if (!Number.isFinite(scale)) {
      return null;
    }
    const nextMinimumWidth = Math.max(0, dimensions.minimumWidth * scale);
    const nextMinimumHeight = Math.max(0, dimensions.minimumHeight * scale);
    mutations.set("minimum width", { kind: "set", value: `${formatNumber(nextMinimumWidth)}pt` });
    mutations.set("minimum height", { kind: "set", value: `${formatNumber(nextMinimumHeight)}pt` });
    return applyOptionMutationsToTarget(source, resizeTarget, mutations);
  }

  if (affectsWidth) {
    const companionHeight = inferDiamondCompanionHeight({
      dimensions,
      currentWidth,
      currentHeight,
      aspect: safeAspect
    });
    const nextMinimumWidth = Math.max(0, requestedWidth - safeAspect * companionHeight);
    mutations.set("minimum width", { kind: "set", value: `${formatNumber(nextMinimumWidth)}pt` });
    if (!dimensions.hasExplicitMinimumHeight) {
      mutations.set("minimum height", { kind: "remove" });
    }
    return applyOptionMutationsToTarget(source, resizeTarget, mutations);
  }

  const companionWidth = inferDiamondCompanionWidth({
    dimensions,
    currentWidth,
    currentHeight,
    aspect: safeAspect
  });
  const nextMinimumHeight = Math.max(0, requestedHeight - companionWidth / safeAspect);
  mutations.set("minimum height", { kind: "set", value: `${formatNumber(nextMinimumHeight)}pt` });
  if (!dimensions.hasExplicitMinimumWidth) {
    mutations.set("minimum width", { kind: "remove" });
  }
  return applyOptionMutationsToTarget(source, resizeTarget, mutations);
}

function resolveDiamondAspectRatio(target: PropertyTarget): number {
  for (const entry of target.options?.entries ?? []) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (normalizeOptionKey(entry.key) !== "aspect") {
      continue;
    }
    const parsed = Number(entry.valueRaw.trim().replace(/^\{/, "").replace(/\}$/, ""));
    if (Number.isFinite(parsed) && parsed > RESIZE_EPSILON) {
      return parsed;
    }
  }
  return 1;
}

function inferDiamondCompanionHeight(args: {
  dimensions: {
    minimumWidth: number;
    minimumHeight: number;
    hasExplicitMinimumWidth: boolean;
    hasExplicitMinimumHeight: boolean;
  };
  currentWidth: number;
  currentHeight: number;
  aspect: number;
}): number {
  const { dimensions, currentWidth, currentHeight, aspect } = args;
  const safeAspect = Number.isFinite(aspect) && aspect > RESIZE_EPSILON ? aspect : 1;
  const currentW = Math.max(currentWidth, 0);
  const currentH = Math.max(currentHeight, 0);

  if (dimensions.hasExplicitMinimumHeight) {
    return Math.max(dimensions.minimumHeight, 0);
  }
  if (dimensions.hasExplicitMinimumWidth) {
    const width = Math.max(dimensions.minimumWidth, RESIZE_EPSILON);
    const fromWidth = (currentW - width) / safeAspect;
    const fromHeight = currentH - width / safeAspect;
    const derived = Number.isFinite(fromWidth) && Number.isFinite(fromHeight)
      ? (fromWidth + fromHeight) / 2
      : Number.isFinite(fromWidth)
        ? fromWidth
        : fromHeight;
    return Math.max(derived, 0);
  }

  return Math.max(currentW / (2 * safeAspect), 0);
}

function inferDiamondCompanionWidth(args: {
  dimensions: {
    minimumWidth: number;
    minimumHeight: number;
    hasExplicitMinimumWidth: boolean;
    hasExplicitMinimumHeight: boolean;
  };
  currentWidth: number;
  currentHeight: number;
  aspect: number;
}): number {
  const { dimensions, currentWidth, currentHeight, aspect } = args;
  const safeAspect = Number.isFinite(aspect) && aspect > RESIZE_EPSILON ? aspect : 1;
  const currentW = Math.max(currentWidth, 0);
  const currentH = Math.max(currentHeight, 0);

  if (dimensions.hasExplicitMinimumWidth) {
    return Math.max(dimensions.minimumWidth, 0);
  }
  if (dimensions.hasExplicitMinimumHeight) {
    const height = Math.max(dimensions.minimumHeight, RESIZE_EPSILON);
    const fromWidth = currentW - safeAspect * height;
    const fromHeight = safeAspect * (currentH - height);
    const derived = Number.isFinite(fromWidth) && Number.isFinite(fromHeight)
      ? (fromWidth + fromHeight) / 2
      : Number.isFinite(fromWidth)
        ? fromWidth
        : fromHeight;
    return Math.max(derived, 0);
  }
  return Math.max(currentW / 2, 0);
}

function resolveTargetMinimumDimensions(target: PropertyTarget): {
  minimumWidth: number;
  minimumHeight: number;
  hasMinimumSize: boolean;
  hasExplicitMinimumWidth: boolean;
  hasExplicitMinimumHeight: boolean;
} {
  let minimumWidth = parseLength("1pt", "pt") ?? 1;
  let minimumHeight = parseLength("1pt", "pt") ?? 1;
  let minimumSize: number | null = null;
  let hasExplicitMinimumWidth = false;
  let hasExplicitMinimumHeight = false;
  for (const entry of target.options?.entries ?? []) {
    if (entry.kind !== "kv") {
      continue;
    }
    const key = normalizeOptionKey(entry.key);
    if (key === "minimum width") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        minimumWidth = Math.max(0, parsed);
        hasExplicitMinimumWidth = true;
      }
      continue;
    }
    if (key === "minimum height") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        minimumHeight = Math.max(0, parsed);
        hasExplicitMinimumHeight = true;
      }
      continue;
    }
    if (key === "minimum size") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        minimumSize = Math.max(0, parsed);
      }
      continue;
    }
  }

  if (minimumSize != null) {
    minimumWidth = Math.max(minimumWidth, minimumSize);
    minimumHeight = Math.max(minimumHeight, minimumSize);
  }
  return {
    minimumWidth,
    minimumHeight,
    hasMinimumSize: minimumSize != null,
    hasExplicitMinimumWidth,
    hasExplicitMinimumHeight
  };
}

function worldVectorToLocal(
  vector: Point,
  linearTransform: { a: number; b: number; c: number; d: number }
): Point {
  const matrix = {
    ...linearTransform,
    e: 0,
    f: 0
  };
  const inverse = inverseMatrix(matrix);
  if (!inverse) {
    return vector;
  }
  return {
    x: inverse.a * vector.x + inverse.c * vector.y,
    y: inverse.b * vector.x + inverse.d * vector.y
  };
}

function worldSizeToLocalSize(
  size: { width: number; height: number },
  linearTransform: { a: number; b: number; c: number; d: number }
): { width: number; height: number } {
  const matrix = {
    ...linearTransform,
    e: 0,
    f: 0
  };
  const inverse = inverseMatrix(matrix);
  if (!inverse) {
    return size;
  }
  const corners = [
    { x: -size.width / 2, y: -size.height / 2 },
    { x: size.width / 2, y: -size.height / 2 },
    { x: size.width / 2, y: size.height / 2 },
    { x: -size.width / 2, y: size.height / 2 }
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const mapped = {
      x: inverse.a * corner.x + inverse.c * corner.y,
      y: inverse.b * corner.x + inverse.d * corner.y
    };
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  }
  return {
    width: maxX - minX,
    height: maxY - minY
  };
}

function transformsApproximatelyEqual(
  left: EditHandle["transform"],
  right: EditHandle["transform"],
  epsilon = 1e-9
): boolean {
  return (
    Math.abs(left.a - right.a) <= epsilon &&
    Math.abs(left.b - right.b) <= epsilon &&
    Math.abs(left.c - right.c) <= epsilon &&
    Math.abs(left.d - right.d) <= epsilon &&
    Math.abs(left.e - right.e) <= epsilon &&
    Math.abs(left.f - right.f) <= epsilon
  );
}

function resolveResizePropertyTarget(
  source: string,
  statements: readonly Statement[],
  elementId: string,
  defaultTarget: PropertyTarget,
  parseOptions: EditParseOptions = {}
): PropertyTarget {
  if (defaultTarget.kind !== "path-statement") {
    return defaultTarget;
  }

  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return defaultTarget;
  }

  const nodeIds = collectPathNodeIds(pathStatement.items);
  if (nodeIds.length !== 1) {
    return defaultTarget;
  }

  const nodeTarget = resolvePropertyTarget(source, nodeIds[0]!, parseOptions);
  if (nodeTarget.kind === "found") {
    return nodeTarget.target;
  }

  return defaultTarget;
}

function findPathStatementById(
  statements: readonly Statement[],
  elementId: string
): Extract<Statement, { kind: "Path" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === elementId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, elementId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function findPathStatementContainingNodeId(
  statements: readonly Statement[],
  nodeId: string
): Extract<Statement, { kind: "Path" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Path") {
      if (collectPathNodeIds(statement.items).includes(nodeId)) {
        return statement;
      }
      continue;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementContainingNodeId(statement.body, nodeId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function isPathAttachedNodeTargetId(statements: readonly Statement[], targetId: string): boolean {
  const hostPath = findPathStatementContainingNodeId(statements, targetId);
  return hostPath != null && hostPath.command !== "node";
}

function collectPathNodeIds(items: readonly PathItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.kind === "Node") {
      ids.push(item.id);
      continue;
    }

    if (
      (item.kind === "ToOperation" || item.kind === "EdgeOperation" || item.kind === "EdgeFromParentOperation") &&
      item.nodes
    ) {
      ids.push(...item.nodes.map((node) => node.id));
      continue;
    }

    if (item.kind === "ChildOperation") {
      ids.push(...collectPathNodeIds(item.body));
    }
  }

  return [...new Set(ids)];
}

function isDiamondNodeShapeInPathStatement(statements: readonly Statement[], elementId: string): boolean {
  const pathStatement = findPathStatementById(statements, elementId);
  if (!pathStatement) {
    return false;
  }
  const nodes = collectPathNodeItems(pathStatement.items);
  if (nodes.length !== 1) {
    return false;
  }
  return resolveNodeShape(nodes[0]?.options) === "diamond";
}

function collectPathNodeItems(items: readonly PathItem[]): NodeItem[] {
  const nodes: NodeItem[] = [];
  for (const item of items) {
    if (item.kind === "Node") {
      nodes.push(item);
      continue;
    }
    if (
      (item.kind === "ToOperation" || item.kind === "EdgeOperation" || item.kind === "EdgeFromParentOperation") &&
      item.nodes
    ) {
      nodes.push(...item.nodes);
      continue;
    }
    if (item.kind === "ChildOperation") {
      nodes.push(...collectPathNodeItems(item.body));
    }
  }
  return nodes;
}
