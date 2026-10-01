import { nextEditHandleId } from "../edit-handles.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import type { EdgeOperationItem, ToOperationItem, PathStatement } from "../../ast/types.js";
import { currentFrame, type SemanticContext } from "../context.js";
import { parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import {
  evaluateNodeItem,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveNamedCoordinateBorderPointFromRawAlongAngle
} from "../nodes/evaluate.js";
import type { FeatureId } from "../../capabilities/feature-ids.js";
import type { ResolvedStyle, SceneElement, ScenePath, ScenePathCommand } from "../types.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "./types.js";
import { makePath } from "./elements.js";
import { appendPathPoint, roundClosedPathStartCorner } from "./segments.js";
import { normalizeOptionValue, toRadians } from "./shared.js";
import { createEditHandle } from "../edit-handles.js";
import type { StyleChainEntry } from "../style-chain.js";

type ToCurveUiMode = "in-out" | "bend";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export function applyToOperation(
  item: ToOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  activePath: ScenePath | null,
  previousSegmentRoundedCorners: number | null,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  startCoordinateRaw: string | null = null
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  return applyToLikeOperation(
    item,
    context,
    statement,
    style,
    styleChain,
    activePath,
    previousSegmentRoundedCorners,
    markFeature,
    pushDiagnostic,
    {
      operationKeyword: "to",
      operationFeature: "to_operation",
      keywordFeature: "keyword_to",
      unsupportedDiagnostic: "unsupported-to-operation",
      allowImplicitMoveToTargetWhenNoStart: true,
      startCoordinateRaw
    }
  );
}

export function applyEdgeOperation(
  item: EdgeOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  startPoint: WorldPoint | null,
  startCoordinateRaw: string | null = null
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  const savedCurrentPoint = context.currentPoint;
  const savedPathStartPoint = context.pathStartPoint;
  context.currentPoint = startPoint;
  context.pathStartPoint = startPoint;

  const handled = applyToLikeOperation(item, context, statement, style, styleChain, null, null, markFeature, pushDiagnostic, {
    operationKeyword: "edge",
    operationFeature: "edge_operation",
    keywordFeature: "keyword_edge",
    unsupportedDiagnostic: "unsupported-edge-operation",
    allowImplicitMoveToTargetWhenNoStart: false,
    startCoordinateRaw
  });

  context.currentPoint = savedCurrentPoint;
  context.pathStartPoint = savedPathStartPoint;
  return handled;
}

function applyToLikeOperation(
  item: ToOperationItem | EdgeOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  activePath: ScenePath | null,
  previousSegmentRoundedCorners: number | null,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  config: {
    operationKeyword: "to" | "edge";
    operationFeature: FeatureId;
    keywordFeature: FeatureId;
    unsupportedDiagnostic: string;
    allowImplicitMoveToTargetWhenNoStart: boolean;
    startCoordinateRaw?: string | null;
  }
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  const behindNodeElements: SceneElement[] = [];
  const frontNodeElements: SceneElement[] = [];
  const target = item.target ?? parseToTarget(item.raw, config.operationKeyword);
  if (!target) {
    markFeature(config.operationFeature, "unsupported");
    pushDiagnostic(
      config.unsupportedDiagnostic,
      `\`${config.operationKeyword}\` operation target is not yet supported.`,
      item.span.from,
      item.span.to
    );
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  markFeature(config.operationFeature, "supported");
  markFeature(config.keywordFeature, "supported");
  markFeature("path_operators_basic", "supported");

  if (target.kind === "cycle") {
    if (activePath) {
      if (context.currentPoint && context.pathStartPoint) {
        const closingFrom = context.currentPoint;
        const pathStart = context.pathStartPoint;
        appendPathPoint(
          activePath.commands,
          "--",
          closingFrom,
          pathStart,
          previousSegmentRoundedCorners,
          style.roundedCorners
        );
        context.currentPoint = pathStart;
        roundClosedPathStartCorner(activePath.commands, closingFrom, pathStart, style.roundedCorners);
      }
      activePath.commands.push({ kind: "Z" });
      context.currentPoint = context.pathStartPoint;
    }
    return {
      activePath,
      segment: null,
      behindNodeElements,
      frontNodeElements,
      previousSegmentRoundedCorners: null
    };
  }

  const evaluated = evaluateRawCoordinate(target.raw, context, target.relativePrefix);
  if (!evaluated.world) {
    markFeature(config.operationFeature, "unsupported");
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `${config.operationKeyword}-operation target issue: ${code}`, item.span.from, item.span.to);
    }
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  const targetSpan = target.kind === "coordinate" ? (target.span ?? item.span) : item.span;
  const handle = createEditHandle(evaluated, targetSpan, statement.id, "path-point", context);
  if (handle) {
    context.editHandles.push(handle);
  }

  const startPoint = context.currentPoint;
  if (!startPoint && !config.allowImplicitMoveToTargetWhenNoStart) {
    markFeature(config.operationFeature, "unsupported");
    pushDiagnostic(
      config.unsupportedDiagnostic,
      `\`${config.operationKeyword}\` operation requires a current point before the operation.`,
      item.span.from,
      item.span.to
    );
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  const resolvedStartPoint =
    startPoint && config.startCoordinateRaw
      ? maybeResolveNamedCoordinateBorderPointFromRaw(config.startCoordinateRaw, startPoint, evaluated.world, context)
      : startPoint;
  const resolvedTargetPoint = maybeResolveNamedCoordinateBorderPointFromRaw(
    target.raw,
    evaluated.world,
    resolvedStartPoint ?? startPoint,
    context
  );
  let effectiveStartPoint = resolvedStartPoint ?? startPoint;
  let effectiveTargetPoint = resolvedTargetPoint;
  const curved = effectiveStartPoint ? extractToCurveOptions(item.options, effectiveStartPoint, effectiveTargetPoint) : null;
  if (effectiveStartPoint && curved) {
    if (config.startCoordinateRaw) {
      effectiveStartPoint = maybeResolveNamedCoordinateBorderPointFromRawAlongAngle(
        config.startCoordinateRaw,
        effectiveStartPoint,
        curved.out,
        context
      );
    }
    effectiveTargetPoint = maybeResolveNamedCoordinateBorderPointFromRawAlongAngle(target.raw, effectiveTargetPoint, curved.in, context);
  }

  let path = activePath;
  if (!path) {
    if (effectiveStartPoint) {
      path = makePath(statement.id, item.id, style, styleChain, item.span);
      path.commands.push({ kind: "M", to: effectiveStartPoint });
      context.pathStartPoint = effectiveStartPoint;
    } else {
      path = makePath(statement.id, item.id, style, styleChain, item.span);
      path.commands.push({ kind: "M", to: effectiveTargetPoint });
      context.pathStartPoint = effectiveTargetPoint;
      context.currentPoint = effectiveTargetPoint;
      markFeature("svg_path", "supported");
      return {
        activePath: path,
        segment: null,
        behindNodeElements,
        frontNodeElements,
        previousSegmentRoundedCorners: null
      };
    }
  }

  const start = effectiveStartPoint;
  if (start && path && alignPathToStart(path.commands, start)) {
    context.pathStartPoint = start;
  }
  let segment: PlacementSegment | null;
  let nextRoundedCorners;
  if (start && curved) {
    segment = appendToCurve(path.commands, start, effectiveTargetPoint, curved);
    appendToLikeCurveEditHandles({
      itemId: item.id,
      statementId: statement.id,
      start,
      end: effectiveTargetPoint,
      curve: curved,
      segment,
      context
    });
    nextRoundedCorners = style.roundedCorners;
    markFeature("path_operator_curves", "supported");
  } else {
    const appended = appendPathPoint(
      path.commands,
      "--",
      start,
      effectiveTargetPoint,
      previousSegmentRoundedCorners,
      style.roundedCorners
    );
    segment = appended.segment;
    nextRoundedCorners = appended.nextRoundedCorners;
  }
  context.currentPoint = effectiveTargetPoint;

  for (const node of item.nodes ?? []) {
    const resolvedNode = evaluateNodeItem(
      node,
      statement,
      context,
      style,
      markFeature,
      pushDiagnostic,
      segment,
      undefined,
      0.5,
      undefined,
      styleChain
    );
    behindNodeElements.push(...resolvedNode.behindElements);
    frontNodeElements.push(...resolvedNode.frontElements);
  }

  markFeature("svg_path", "supported");
  return {
    activePath: path,
    segment,
    behindNodeElements,
    frontNodeElements,
    previousSegmentRoundedCorners: nextRoundedCorners
  };
}

function parseToTarget(
  raw: string,
  operationKeyword: "to" | "edge"
): { kind: "cycle"; span?: { from: number; to: number } } | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++"; span?: { from: number; to: number } } | null {
  if (/\bcycle\b/i.test(raw)) {
    return { kind: "cycle" };
  }

  const match = raw.match(new RegExp(`(${operationKeyword}\\\\b[\\\\s\\\\S]*?)(\\\\+\\\\+|\\\\+)?(\\([^\\)]*\\))\\s*$`, "i"));
  if (!match) {
    return null;
  }

  const prefix = match[2] === "++" ? "++" : match[2] === "+" ? "+" : undefined;
  return {
    kind: "coordinate",
    raw: match[3],
    relativePrefix: prefix
  };
}

function extractToCurveOptions(
  options: ToOperationItem["options"],
  from: WorldPoint,
  to: WorldPoint
): {
  out: number;
  in: number;
  outLooseness: number;
  inLooseness: number;
  outMinDistance: number;
  outMaxDistance: number;
  inMinDistance: number;
  inMaxDistance: number;
  relative: boolean;
  baseHeading: number;
  uiMode: ToCurveUiMode;
  bendSignedAngle: number;
} | null {
  if (!options) {
    return null;
  }

  let out = 45;
  let inAngle = 135;
  let looseness: number | null = null;
  let outLooseness: number | null = null;
  let inLooseness: number | null = null;
  let outMinDistance = 0;
  let outMaxDistance = Number.POSITIVE_INFINITY;
  let inMinDistance = 0;
  let inMaxDistance = Number.POSITIVE_INFINITY;
  let curveRequested = false;
  let relative = false;
  let bendAngle = 30;
  let hasExplicitInOrOut = false;
  let hasBendDirectionOption = false;
  let bendDirection: "left" | "right" | null = null;
  let bendSignedAngle = 0;

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "bend left") {
        out = bendAngle;
        inAngle = 180 - out;
        relative = true;
        curveRequested = true;
        hasBendDirectionOption = true;
        bendDirection = "left";
        bendSignedAngle = Math.abs(bendAngle);
      } else if (entry.key === "bend right") {
        out = -bendAngle;
        inAngle = 180 - out;
        relative = true;
        curveRequested = true;
        hasBendDirectionOption = true;
        bendDirection = "right";
        bendSignedAngle = -Math.abs(bendAngle);
      } else if (entry.key === "relative") {
        relative = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "out") {
      const parsed = parseCurveAngleOption(entry.valueRaw);
      if (parsed != null) {
        out = parsed;
        curveRequested = true;
        hasExplicitInOrOut = true;
      }
      continue;
    }

    if (entry.key === "in") {
      const parsed = parseCurveAngleOption(entry.valueRaw);
      if (parsed != null) {
        inAngle = parsed;
        curveRequested = true;
        hasExplicitInOrOut = true;
      }
      continue;
    }

    if (entry.key === "looseness") {
      const parsed = parseNonNegativeScalarOption(entry.valueRaw);
      if (parsed != null) {
        looseness = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "out looseness") {
      const parsed = parseNonNegativeScalarOption(entry.valueRaw);
      if (parsed != null) {
        outLooseness = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "in looseness") {
      const parsed = parseNonNegativeScalarOption(entry.valueRaw);
      if (parsed != null) {
        inLooseness = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "bend angle") {
      const parsed = parseCurveAngleOption(entry.valueRaw);
      if (parsed != null) {
        bendAngle = parsed;
      }
      continue;
    }

    if (entry.key === "bend left" || entry.key === "bend right") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        const parsed = parseCurveAngleOption(normalized);
        if (parsed != null) {
          bendAngle = parsed;
        }
      }
      if (entry.key === "bend left") {
        out = bendAngle;
        bendDirection = "left";
        bendSignedAngle = Math.abs(bendAngle);
      } else {
        out = -bendAngle;
        bendDirection = "right";
        bendSignedAngle = -Math.abs(bendAngle);
      }
      inAngle = 180 - out;
      relative = true;
      curveRequested = true;
      hasBendDirectionOption = true;
      continue;
    }

    if (entry.key === "relative") {
      const parsed = parseRelativeBooleanOption(entry.valueRaw);
      if (parsed != null) {
        relative = parsed;
      }
      continue;
    }

    if (entry.key === "distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        inMinDistance = parsed;
        inMaxDistance = parsed;
        outMinDistance = parsed;
        outMaxDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "min distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        inMinDistance = parsed;
        outMinDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "max distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        inMaxDistance = parsed;
        outMaxDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "in min distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        inMinDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "in max distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        inMaxDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "in distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        inMinDistance = parsed;
        inMaxDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "out min distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        outMinDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "out max distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        outMaxDistance = parsed;
        curveRequested = true;
      }
      continue;
    }

    if (entry.key === "out distance") {
      const parsed = parseNonNegativeLengthOption(entry.valueRaw);
      if (parsed != null) {
        outMinDistance = parsed;
        outMaxDistance = parsed;
        curveRequested = true;
      }
    }
  }

  if (!curveRequested) {
    return null;
  }

  const baseHeading = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  if (relative) {
    out += baseHeading;
    inAngle += baseHeading;
  }

  if (!hasBendDirectionOption) {
    bendSignedAngle = normalizeSignedDegrees(out - baseHeading);
  } else if (bendDirection === "left") {
    bendSignedAngle = Math.abs(bendSignedAngle);
  } else if (bendDirection === "right") {
    bendSignedAngle = -Math.abs(bendSignedAngle);
  }

  const shared = looseness ?? 1;
  return {
    out,
    in: inAngle,
    outLooseness: outLooseness ?? shared,
    inLooseness: inLooseness ?? shared,
    outMinDistance,
    outMaxDistance,
    inMinDistance,
    inMaxDistance,
    relative,
    baseHeading,
    uiMode: hasExplicitInOrOut ? "in-out" : hasBendDirectionOption ? "bend" : "in-out",
    bendSignedAngle
  };
}

function appendToCurve(
  commands: ScenePathCommand[],
  from: WorldPoint,
  to: WorldPoint,
  options: {
    out: number;
    in: number;
    outLooseness: number;
    inLooseness: number;
    outMinDistance: number;
    outMaxDistance: number;
    inMinDistance: number;
    inMaxDistance: number;
  }
): PlacementSegment {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const baseDistance = Math.hypot(dx, dy) * 0.3915;

  let outDistance = baseDistance * options.outLooseness;
  let inDistance = baseDistance * options.inLooseness;
  outDistance = Math.min(Math.max(outDistance, options.outMinDistance), options.outMaxDistance);
  inDistance = Math.min(Math.max(inDistance, options.inMinDistance), options.inMaxDistance);

  const outRadians = toRadians(options.out);
  const inRadians = toRadians(options.in);
  const c1 = wp(
    from.x + outDistance * Math.cos(outRadians),
    from.y + outDistance * Math.sin(outRadians)
  );
  const c2 = wp(
    to.x + inDistance * Math.cos(inRadians),
    to.y + inDistance * Math.sin(inRadians)
  );

  commands.push({
    kind: "C",
    c1,
    c2,
    to
  });

  return {
    kind: "cubic",
    from,
    c1,
    c2,
    to
  };
}

function appendToLikeCurveEditHandles(args: {
  itemId: string;
  statementId: string;
  start: WorldPoint;
  end: WorldPoint;
  curve: {
    out: number;
    in: number;
    relative: boolean;
    baseHeading: number;
    uiMode: ToCurveUiMode;
    bendSignedAngle: number;
  };
  segment: PlacementSegment | null;
  context: SemanticContext;
}): void {
  if (args.segment?.kind !== "cubic") {
    return;
  }

  if (args.curve.uiMode === "bend") {
    const bendHandleWorld = bendHandlePoint(args.start, args.end, args.curve.bendSignedAngle);
    pushSyntheticCurveHandle({
      context: args.context,
      statementId: args.statementId,
      kind: "path-bend",
      world: bendHandleWorld,
      curveEdit: {
        kind: "to-bend",
        operationItemId: args.itemId,
        startWorld: args.start,
        endWorld: args.end,
        baseHeading: args.curve.baseHeading
      }
    });
    return;
  }

  pushSyntheticCurveHandle({
    context: args.context,
    statementId: args.statementId,
    kind: "path-control",
    world: args.segment.c1,
    curveEdit: {
      kind: "to-angle",
      operationItemId: args.itemId,
      role: "out",
      startWorld: args.start,
      endWorld: args.end,
      relative: args.curve.relative,
      baseHeading: args.curve.baseHeading
    }
  });
  pushSyntheticCurveHandle({
    context: args.context,
    statementId: args.statementId,
    kind: "path-control",
    world: args.segment.c2,
    curveEdit: {
      kind: "to-angle",
      operationItemId: args.itemId,
      role: "in",
      startWorld: args.start,
      endWorld: args.end,
      relative: args.curve.relative,
      baseHeading: args.curve.baseHeading
    }
  });
}

function pushSyntheticCurveHandle(args: {
  context: SemanticContext;
  statementId: string;
  kind: "path-control" | "path-bend";
  world: WorldPoint;
  curveEdit:
    | {
        kind: "to-angle";
        operationItemId: string;
        role: "out" | "in";
        startWorld: WorldPoint;
        endWorld: WorldPoint;
        relative: boolean;
        baseHeading: number;
      }
    | {
        kind: "to-bend";
        operationItemId: string;
        startWorld: WorldPoint;
        endWorld: WorldPoint;
        baseHeading: number;
      };
}): void {
  const syntheticSpan = makeSyntheticHandleSpan(args.context);
  args.context.editHandles.push({
    id: nextEditHandleId(args.context, args.statementId, args.kind),
    runtimeId: nextEditHandleId(args.context, args.statementId, args.kind),
    sourceRef: {
      sourceId: args.statementId,
      sourceSpan: syntheticSpan,
      sourceFingerprint: args.context.sourceFingerprint
    },
    handleType: "curve-control",
    kind: args.kind,
    world: args.world,
    transform: currentFrame(args.context).transform,
    sourceText: "",
    coordinateForm: "cartesian",
    rewriteMode: "direct",
    curveEdit: args.curveEdit
  });
}

function makeSyntheticHandleSpan(context: SemanticContext): { from: number; to: number } {
  const from = context.source.length + context.editHandles.length * 2;
  return {
    from,
    to: from + 1
  };
}

function bendHandlePoint(start: WorldPoint, end: WorldPoint, signedBendAngle: number): WorldPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const midpoint = wp((start.x + end.x) / 2, (start.y + end.y) / 2);
  if (length <= 1e-9) {
    return midpoint;
  }

  const unitNormal = {
    x: -dy / length,
    y: dx / length
  };
  const clampedAngle = Math.min(89.9, Math.max(0, Math.abs(signedBendAngle)));
  const unsignedOffset = 0.5 * length * Math.tan((clampedAngle * Math.PI) / 180);
  const signedOffset = signedBendAngle >= 0 ? unsignedOffset : -unsignedOffset;

  return wp(midpoint.x + unitNormal.x * signedOffset, midpoint.y + unitNormal.y * signedOffset);
}

function parseCurveAngleOption(valueRaw: string): number | null {
  const normalized = normalizeOptionValue(valueRaw);
  if (normalized.length === 0) {
    return null;
  }

  const quantity = parseQuantityExpression(normalized);
  if (quantity?.kind === "scalar" && Number.isFinite(quantity.value)) {
    return quantity.value;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNonNegativeScalarOption(valueRaw: string): number | null {
  const normalized = normalizeOptionValue(valueRaw);
  if (normalized.length === 0) {
    return null;
  }

  const quantity = parseQuantityExpression(normalized);
  if (quantity?.kind === "scalar" && Number.isFinite(quantity.value) && quantity.value >= 0) {
    return quantity.value;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeLengthOption(valueRaw: string): number | null {
  const parsed = parseLength(valueRaw, "pt");
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseRelativeBooleanOption(valueRaw: string): boolean | null {
  const normalized = normalizeOptionValue(valueRaw).toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
    return false;
  }
  return null;
}

function normalizeSignedDegrees(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(wrapped) < 1e-9 ? 0 : wrapped;
}

function alignPathToStart(commands: ScenePathCommand[], start: WorldPoint): boolean {
  const lastPoint = commandEndpoint(commands[commands.length - 1]);
  if (lastPoint && Math.hypot(lastPoint.x - start.x, lastPoint.y - start.y) <= 1e-6) {
    return false;
  }

  const first = commands[0];
  if (commands.length === 1 && first?.kind === "M") {
    first.to = start;
    return true;
  }

  commands.push({ kind: "M", to: start });
  return true;
}

function commandEndpoint(command: ScenePathCommand | undefined): WorldPoint | null {
  if (!command) {
    return null;
  }
  if (command.kind === "M" || command.kind === "L" || command.kind === "C" || command.kind === "A") {
    return command.to;
  }
  return null;
}
