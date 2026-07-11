import { worldBounds, worldPoint } from "../../coords/points.js";
import type { WorldPoint, WorldBounds } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { CoordinateItem, EdgeFromParentOperationItem, EdgeOperationItem, GraphOperationItem, NodeItem, PathItem, PathStatement, PicOperationItem, PlotOperationItem, Span, ToOperationItem } from "../../ast/types.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { parseTikz } from "../../parser/index.js";
import { parseOptionListRaw } from "../../options/parse.js";
import {
  readNamedCoordinate,
  resolveContextColorAliasValue,
  withDependencySource,
  writeNamedCoordinate,
  type SemanticContext
} from "../context.js";
import {
  applyNameScope,
  evaluateNodeItem,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "../nodes/evaluate.js";
import { pointAtPlacementSegment, resolveNodePositionFraction } from "../nodes/placement.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
import type { EvaluatedCoordinate } from "../coords/evaluate.js";
import type { ResolvedStyle, SceneClipPath, SceneElement, ScenePath, ScenePathCommand } from "../types.js";
import { appendArcCommand, extractArcParameters, parseArcShorthand } from "./arc.js";
import { DEFAULT_GRID_STEP } from "./constants.js";
import { appendSinCosSegment, parseBezierFromItems } from "./curves.js";
import {
  appendEllipseSubpath,
  appendRectangleSubpath,
  ensurePathForSubpath,
  flushDrawableActivePath,
  hasDrawablePathSegments,
  markPathShapeHint,
  makePath,
  makeRectangleElement
} from "./elements.js";
import { extractGridSteps, extractGridStepsFromOptionLists, makeGridElements } from "./grid.js";
import { parseCircleRadiusFromCoordinateRaw, parseCoordinateOperation, parseEllipseRadiiFromCoordinateRaw } from "./parsers.js";
import { parseParabolaFromItems } from "./parabola.js";
import { extractCircleShapeOptions, extractEllipseRadii, extractRoundedCorners } from "./shape-options.js";
import { appendPathPoint, roundClosedPathStartCorner } from "./segments.js";
import { parseSvgPathOperation } from "./svg.js";
import { applyEdgeOperation, applyToOperation } from "./to-operation.js";
import {
  cloneAdornmentOwnerGeometry,
  extractNodeAdornmentPlan,
  extractToLikeOptionPlan,
  makeNodeAdornmentTargetId,
  materializeNodeAdornment
} from "./label-quotes.js";
import { expandMacroBindings } from "../../macros/index.js";
import type { DiagnosticPushFn, FeatureMarkFn, PathEvaluationOptions, PlacementSegment } from "./types.js";
import { applyMatrix, identityMatrix } from "../transform.js";
import { createEditHandle } from "../edit-handles.js";
import { parseStyleValueAsOptionList, resolveContextDelta } from "../style/resolve.js";
import { styleDiagnosticCode, styleDiagnosticSpan, type StyleDiagnostic } from "../style/diagnostics.js";
import { expandOptionListMacros } from "../style/macro-options.js";
import { cloneStyleChain, type StyleChainEntry, type StyleTraceLayerInput } from "../style-chain.js";
import { cloneCustomStyleRegistry, walkOptionEntriesWithCustomStyles } from "../style/custom-styles.js";
import { applyPicDefinitionsFromOptionLists, clonePicDefinitionRegistry } from "../pics/registry.js";
import { computeBounds, resolveFrameMeta } from "../evaluate.js";
import {
  applyPlotOptionLists,
  applyPlotSettingsFromStyleChain,
  createDefaultPlotSettings
} from "./plot.js";
import { decoratePathElements } from "./decorate.js";
import { makeTreeAutoName } from "./tree.js";
import {
  hasFollowingChildOperation,
  sanitizeGeneratedNodeName
} from "./tree-child.js";
import { buildGraphPlan } from "./graph.js";
import { resolveSizeAwareGraphNodePoints, type RuntimeGraphNode } from "./graph-size-aware-placement.js";
import { evaluateTurnCoordinate, resolveDefaultGridStep } from "./evaluate-coordinate-helpers.js";
import {
  buildPlotExpressionEntries,
  emitPlotPath,
  evaluatePlotCoordinatePoints,
  extractPlotCoordinateEntries
} from "./evaluate-plot.js";
import { emitCircleOrEllipse, transformCircleGeometry, transformEllipseGeometry } from "./evaluate-shapes.js";
import { handleChildOperationCluster } from "./evaluate-tree.js";

const DRAW_EDGE_OPTIONS = parseStyleValueAsOptionList("draw");
const EVERY_EDGE_OPTIONS = parseStyleValueAsOptionList("every edge");
const EDGE_FROM_PARENT_STYLE_OPTIONS = parseStyleValueAsOptionList("edge from parent");
const HELP_LINES_OPTIONS = parseStyleValueAsOptionList("help lines");

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

function wb(minX: number, minY: number, maxX: number, maxY: number): WorldBounds {
  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function pushStyleDiagnostic(
  pushDiagnostic: DiagnosticPushFn,
  diagnostic: StyleDiagnostic,
  messagePrefix: string,
  fallbackSpan: Span
): void {
  const code = styleDiagnosticCode(diagnostic);
  const span = styleDiagnosticSpan(diagnostic, fallbackSpan);
  pushDiagnostic(code, `${messagePrefix}: ${code}`, span.from, span.to);
}

function resolveOptionsForNodeAdornmentPlan(
  options: OptionListAst | undefined,
  frame: SemanticContext["stack"][number],
  context: SemanticContext
): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const macroExpanded = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  const expandedEntries: OptionEntry[] = [];
  const diagnostics: string[] = [];
  walkOptionEntriesWithCustomStyles(
    macroExpanded,
    cloneCustomStyleRegistry(frame.customStyles),
    (entry) => expandedEntries.push(entry),
    diagnostics
  );

  const expandedOptions: OptionListAst | undefined =
    expandedEntries.length > 0
      ? {
          span: options.span,
          raw: macroExpanded.map((list) => list.raw).join(", "),
          entries: expandedEntries
        }
      : undefined;
  const rawSignature = nodeAdornmentControlSignature(options);
  const expandedSignature = nodeAdornmentControlSignature(expandedOptions);
  return rawSignature === expandedSignature ? options : expandedOptions;
}

function nodeAdornmentControlSignature(options: OptionListAst | undefined): string {
  if (!options) {
    return "";
  }

  return options.entries
    .filter((entry) => {
      if (entry.kind === "kv") {
        return (
          entry.key === "label" ||
          entry.key === "pin" ||
          entry.key === "label position" ||
          entry.key === "pin position" ||
          entry.key === "label distance" ||
          entry.key === "pin distance" ||
          entry.key === "pin edge" ||
          entry.key === "quotes mean label" ||
          entry.key === "quotes mean pin"
        );
      }
      if (entry.kind === "flag") {
        return entry.key === "quotes mean label" || entry.key === "quotes mean pin";
      }
      const trimmed = entry.raw.trim();
      return trimmed.startsWith("\"") || trimmed.startsWith("'");
    })
    .map((entry) => entry.raw)
    .join("\n");
}

type PendingLength = {
  value: number;
  applyFrameTransform: boolean;
};

type PendingRadii = {
  rx: PendingLength;
  ry: PendingLength;
};

type PathBuilderState = {
  style: ResolvedStyle;
  activePath: ScenePath | null;
  currentOperator: "--" | "-|" | "|-" | null;
  activeRoundedCorners: number | null;
  pendingRectangleFrom: WorldPoint | null;
  pendingCircleCenter: WorldPoint | null;
  pendingCircleRadius: PendingLength | null;
  pendingCircleRadii: PendingRadii | null;
  pendingCircleRotation: number;
  pendingEllipseCenter: WorldPoint | null;
  pendingEllipseRadii: PendingRadii | null;
  pendingArc: { from: WorldPoint } | null;
  pendingGrid: { from: WorldPoint; stepX: number; stepY: number } | null;
  pendingNamedCoordinate: { name: string } | null;
  pendingSegmentPlacements: Array<{ name: string; fraction: number }>;
  pendingSegmentNodes: NodeItem[];
  pendingSegmentPics: Array<{ item: PicOperationItem; fraction: number }>;
  pendingNodeNameForNodeCommand: string | null;
  lastPlacementSegment: PlacementSegment | null;
  previousSegmentRoundedCorners: number | null;
  leadingToLikeOptions: OptionListAst | undefined;
  currentPointLogical: WorldPoint | null;
  currentPointCoordinate: Pick<CoordinateItem, "form" | "x"> | null;
  pendingEdgeStartCoordinateRaw: string | null;
  edgeOperationStart: { point: WorldPoint; coordinateRaw: string | null } | null;
  treeParentCandidate: {
    nameRaw: string | null;
    point: WorldPoint;
    span: { from: number; to: number };
  } | null;
  sawNonLeadingPathItem: boolean;
  hasPathCurrentPoint: boolean;
  treeFrameState: SemanticContext["stack"][number];
  statementStyleChain: StyleChainEntry[];
  plotSettings: ReturnType<typeof createDefaultPlotSettings>;
  shouldCompoundFilledSubpaths: boolean;
  currentItemIndex: number;
};

function computeShouldCompoundFilledSubpaths(candidateStyle: ResolvedStyle): boolean {
  const hasFilledShadowLayer = candidateStyle.shadowLayers.some(
    (layer) => layer.style.shadeEnabled || (layer.style.fill != null && layer.style.fill !== "none")
  );
  return candidateStyle.shadeEnabled
    || (candidateStyle.fill != null && candidateStyle.fill !== "none")
    || hasFilledShadowLayer;
}

export function evaluatePathStatement(
  statement: PathStatement,
  context: SemanticContext,
  initialStyle: ResolvedStyle,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  options: PathEvaluationOptions = {}
): SceneElement[] {
  const geometryElements: SceneElement[] = [];
  const behindNodeElements: SceneElement[] = [];
  const frontNodeElements: SceneElement[] = [];
  const emittedTreeHookDiagnostics = new Set<string>();
  const honorInitialCurrentPoint = options.honorInitialCurrentPoint === true;
  const initialCurrentPointLogical = context.currentPoint;
  if (!honorInitialCurrentPoint) {
    // Each standalone TikZ path starts from a fresh current point; leaking the
    // previous statement's endpoint breaks node placement for node-only paths.
    context.currentPoint = null;
    context.pathStartPoint = null;
  }
  const frame = context.stack[context.stack.length - 1];
  const frameTransform = frame.transform;
  const initialPlotSettings = applyPlotSettingsFromStyleChain(
    createDefaultPlotSettings(),
    frame.styleChain,
    frame.macroBindings
  );
  const builder: PathBuilderState = {
    style: initialStyle,
    activePath: null,
    currentOperator: null,
    activeRoundedCorners: initialStyle.roundedCorners,
    pendingRectangleFrom: null,
    pendingCircleCenter: null,
    pendingCircleRadius: null,
    pendingCircleRadii: null,
    pendingCircleRotation: 0,
    pendingEllipseCenter: null,
    pendingEllipseRadii: null,
    pendingArc: null,
    pendingGrid: null,
    pendingNamedCoordinate: null,
    pendingSegmentPlacements: [],
    pendingSegmentNodes: [],
    pendingSegmentPics: [],
    pendingNodeNameForNodeCommand: null,
    lastPlacementSegment: null,
    previousSegmentRoundedCorners: null,
    leadingToLikeOptions: undefined,
    currentPointLogical: initialCurrentPointLogical,
    currentPointCoordinate: null,
    pendingEdgeStartCoordinateRaw: null,
    edgeOperationStart: null,
    treeParentCandidate: null,
    sawNonLeadingPathItem: false,
    hasPathCurrentPoint: honorInitialCurrentPoint && context.currentPoint != null,
    treeFrameState: frame,
    statementStyleChain: frame.styleChain,
    plotSettings: initialPlotSettings,
    shouldCompoundFilledSubpaths: computeShouldCompoundFilledSubpaths(initialStyle),
    currentItemIndex: -1
  };
  const pointsClose = (left: WorldPoint, right: WorldPoint): boolean => Math.hypot(left.x - right.x, left.y - right.y) <= 1e-6;
  const defaultPathOrigin = applyMatrix(frameTransform, wp(0, 0));
  const setCurrentPoint = (
    point: WorldPoint | null,
    logicalPoint: WorldPoint | null = point,
    coordinate: Pick<CoordinateItem, "form" | "x"> | null = null
  ): void => {
    context.currentPoint = point;
    if (!point) {
      builder.currentPointLogical = null;
      builder.currentPointCoordinate = null;
      return;
    }
    builder.currentPointLogical = logicalPoint ?? point;
    builder.currentPointCoordinate = coordinate;
    builder.hasPathCurrentPoint = true;
  };
  const flushPendingSegmentPlacements = (segment: PlacementSegment | null): void => {
    if (!segment || builder.pendingSegmentPlacements.length === 0) {
      return;
    }
    for (const pending of builder.pendingSegmentPlacements) {
      const point = pointAtPlacementSegment(segment, pending.fraction);
      writeNamedCoordinate(context, applyNameScope(pending.name, context), point);
    }
    builder.pendingSegmentPlacements = [];
  };
  const flushPendingSegmentNodes = (segment: PlacementSegment | null): void => {
    if (!segment || builder.pendingSegmentNodes.length === 0) {
      return;
    }

    for (const node of builder.pendingSegmentNodes) {
      const scopedAutoSide = resolveScopedAutoSide(builder.statementStyleChain);
      const nodeOptionsWithScopedAuto =
        scopedAutoSide != null
          ? mergeOptionLists(parseOptionListRaw(`[auto=${scopedAutoSide}]`, node.span.from), node.options)
          : node.options;
      const resolvedNode = evaluateNodeItem(
        nodeOptionsWithScopedAuto === node.options ? node : { ...node, options: nodeOptionsWithScopedAuto, optionsSpan: nodeOptionsWithScopedAuto?.span },
        statement,
        context,
        builder.style,
        markFeature,
        pushDiagnostic,
        segment,
        undefined,
        0.5,
        undefined,
        builder.statementStyleChain
      );
      behindNodeElements.push(...resolvedNode.behindElements);
      frontNodeElements.push(...resolvedNode.frontElements);
    }
    builder.pendingSegmentNodes = [];
  };
  const emitPicOperation = (
    item: PicOperationItem,
    placement: WorldPoint,
    segment: PlacementSegment | null = null
  ): void => {
    markFeature("pic_operation", "supported");
    if (!options.evaluatePicOperation) {
      markFeature("pic_operation", "unsupported");
      pushDiagnostic("unsupported-pic-operation", "`pic` operations are parsed but not semantically implemented here.", item.span.from, item.span.to);
      return;
    }
    const resolved = options.evaluatePicOperation(item, placement, segment);
    behindNodeElements.push(...resolved.behindElements);
    frontNodeElements.push(...resolved.frontElements);
  };
  const flushPendingSegmentPics = (segment: PlacementSegment | null): void => {
    if (!segment || builder.pendingSegmentPics.length === 0) {
      return;
    }
    for (const pending of builder.pendingSegmentPics) {
      emitPicOperation(pending.item, pointAtPlacementSegment(segment, pending.fraction), segment);
    }
    builder.pendingSegmentPics = [];
  };
  const flushPendingCircle = (sourceId: string, span: Span): void => {
    if (!builder.pendingCircleCenter) {
      return;
    }
    const fallbackRadius = builder.pendingCircleRadius ?? (builder.style.radius != null ? { value: builder.style.radius, applyFrameTransform: true } : null);
    if (fallbackRadius != null) {
      const circleTransform = resolveLengthTransform(
        fallbackRadius.applyFrameTransform,
        frameTransform,
        builder.statementStyleChain
      );
      builder.activePath = emitCircleOrEllipse({
        geometry: transformCircleGeometry(fallbackRadius.value, circleTransform),
        center: builder.pendingCircleCenter,
        statementId: statement.id,
        itemId: sourceId,
        span,
        style: builder.style,
        styleChain: builder.statementStyleChain,
        shouldCompoundFilledSubpaths: builder.shouldCompoundFilledSubpaths,
        activePath: builder.activePath,
        geometryElements,
        markFeature
      });
    } else {
      const fallbackRadii = builder.pendingCircleRadii ?? {
        rx: { value: builder.style.xRadius ?? DEFAULT_GRID_STEP, applyFrameTransform: true },
        ry: { value: builder.style.yRadius ?? DEFAULT_GRID_STEP, applyFrameTransform: true }
      };
      const ellipseTransform = resolveLengthTransform(
        fallbackRadii.rx.applyFrameTransform || fallbackRadii.ry.applyFrameTransform,
        frameTransform,
        builder.statementStyleChain
      );
      builder.activePath = emitCircleOrEllipse({
        geometry: {
          kind: "ellipse",
          ...transformEllipseGeometry(
            fallbackRadii.rx.value,
            fallbackRadii.ry.value,
            builder.pendingCircleRotation,
            ellipseTransform
          )
        },
        center: builder.pendingCircleCenter,
        statementId: statement.id,
        itemId: sourceId,
        span,
        style: builder.style,
        styleChain: builder.statementStyleChain,
        shouldCompoundFilledSubpaths: builder.shouldCompoundFilledSubpaths,
        activePath: builder.activePath,
        geometryElements,
        markFeature
      });
    }
    builder.pendingCircleCenter = null;
    builder.pendingCircleRadius = null;
    builder.pendingCircleRadii = null;
    builder.pendingCircleRotation = 0;
    builder.lastPlacementSegment = null;
  };
  const drawEdgeOptions = DRAW_EDGE_OPTIONS;
  const everyEdgeOptions = EVERY_EDGE_OPTIONS;
  const edgeFromParentStyleOptions = EDGE_FROM_PARENT_STYLE_OPTIONS;
  const itemHandlers = new Map<PathItem["kind"], (item: PathItem) => void>([
    [
      "PlotOperation",
      (pathItem) => {
        const item = pathItem as PlotOperationItem;
        const connectFrom = builder.currentOperator === "--" ? context.currentPoint ?? builder.currentPointLogical : null;
        const localPlotSettings = applyPlotOptionLists(
          { ...builder.plotSettings },
          item.options ? [item.options] : [],
          builder.treeFrameState.macroBindings
        );

        if (item.mode === "coordinates") {
          const coordinateEntries = extractPlotCoordinateEntries(item.dataRaw ?? "");
          if (coordinateEntries.length === 0) {
            pushDiagnostic(
              "invalid-plot-coordinates",
              "Plot coordinates require at least one coordinate entry.",
              item.span.from,
              item.span.to
            );
            builder.currentOperator = null;
            return;
          }
          const points = evaluatePlotCoordinatePoints({
            entries: coordinateEntries,
            span: item.span,
            issuePrefix: "Plot coordinate issue",
            currentPoint: context.currentPoint,
            setCurrentPoint: (point) => {
              context.currentPoint = point;
            },
            pushDiagnostic,
            evaluateCoordinateRaw: (raw, relativePrefix) => evaluateRawCoordinate(raw, context, relativePrefix)
          });
          builder.activePath = flushDrawableActivePath(geometryElements, builder.activePath);
          const emitted = emitPlotPath({
            statementId: statement.id,
            item,
            points,
            settings: localPlotSettings,
            connectFrom,
            style: builder.style,
            styleChain: builder.statementStyleChain,
            geometryElements,
            markFeature,
            activeRoundedCorners: builder.activeRoundedCorners,
            setCurrentPoint: (point) => { setCurrentPoint(point); },
            setPathStartPoint: (point) => {
              context.pathStartPoint = point;
            }
          });
          builder.lastPlacementSegment = emitted.lastPlacementSegment;
          builder.previousSegmentRoundedCorners = emitted.previousSegmentRoundedCorners;
          markFeature("plot_operation", "supported");
          builder.currentOperator = null;
          return;
        }

        if (item.mode === "expression") {
          const expressionRaw = item.dataRaw?.trim() ?? "";
          if (expressionRaw.length === 0) {
            pushDiagnostic("invalid-plot-expression", "Plot expression requires a coordinate expression.", item.span.from, item.span.to);
            builder.currentOperator = null;
            return;
          }

          const entries = buildPlotExpressionEntries({
            context,
            consumerStatementId: statement.id,
            expressionRaw,
            settings: localPlotSettings,
            macroBindings: builder.treeFrameState.macroBindings
          });

          const points = evaluatePlotCoordinatePoints({
            entries,
            span: item.span,
            issuePrefix: "Plot expression issue",
            currentPoint: context.currentPoint,
            setCurrentPoint: (point) => {
              context.currentPoint = point;
            },
            pushDiagnostic,
            evaluateCoordinateRaw: (raw, relativePrefix) => evaluateRawCoordinate(raw, context, relativePrefix)
          });
          if (points.length === 0) {
            pushDiagnostic("invalid-plot-expression", "Plot expression did not produce any valid coordinate points.", item.span.from, item.span.to);
            builder.currentOperator = null;
            return;
          }
          builder.activePath = flushDrawableActivePath(geometryElements, builder.activePath);
          const emitted = emitPlotPath({
            statementId: statement.id,
            item,
            points,
            settings: localPlotSettings,
            connectFrom,
            style: builder.style,
            styleChain: builder.statementStyleChain,
            geometryElements,
            markFeature,
            activeRoundedCorners: builder.activeRoundedCorners,
            setCurrentPoint: (point) => { setCurrentPoint(point); },
            setPathStartPoint: (point) => {
              context.pathStartPoint = point;
            }
          });
          builder.lastPlacementSegment = emitted.lastPlacementSegment;
          builder.previousSegmentRoundedCorners = emitted.previousSegmentRoundedCorners;
          markFeature("plot_operation", "supported");
          builder.currentOperator = null;
          return;
        }

        if (item.mode === "function" || item.mode === "file") {
          markFeature("plot_operation", "unsupported");
          pushDiagnostic(
            `unsupported-plot-mode:${item.mode}`,
            `Plot mode \`${item.mode}\` is not supported yet.`,
            item.span.from,
            item.span.to
          );
          builder.currentOperator = null;
          return;
        }

        markFeature("plot_operation", "unsupported");
        pushDiagnostic(
          "invalid-plot-operation",
          "Could not parse this plot operation.",
          item.span.from,
          item.span.to
        );
        builder.currentOperator = null;
      }
    ],
    [
      "GraphOperation",
      (pathItem) => {
        const item = pathItem as GraphOperationItem;
        const plan = buildGraphPlan(item, context.namedNodeSets);
        if (plan.diagnostics.length > 0) {
          for (const diagnostic of plan.diagnostics) {
            pushDiagnostic(
              "invalid-graph-syntax",
              `Graph syntax issue: ${diagnostic}`,
              item.specSpan.from,
              item.specSpan.to
            );
          }
        }

        const graphStatement: PathStatement = {
          kind: "Path",
          id: `${statement.id}:${item.id}:graph`,
          span: item.span,
          command: "path",
          options: undefined,
          items: []
        };

        const plannedBehindNodeElements: SceneElement[] = [];
        const plannedFrontNodeElements: SceneElement[] = [];

        const runtimeGraphNodes: RuntimeGraphNode[] = [];

        for (let nodeIndex = 0; nodeIndex < plan.nodes.length; nodeIndex += 1) {
          const node = plan.nodes[nodeIndex];
          const existingNodeCoordinate = withDependencySource(context, graphStatement.id, () => {
            const scoped = applyNameScope(node.name, context);
            const scopedMatch = readNamedCoordinate(context, scoped);
            return scopedMatch ?? readNamedCoordinate(context, node.name);
          });
          if (existingNodeCoordinate) {
            continue;
          }

          const syntheticNode: NodeItem = {
            kind: "Node",
            id: `${item.id}:graph-node:${nodeIndex}`,
            span: node.span,
            raw: node.name,
            templateRaw: node.name,
            name: node.name,
            optionsSpan: node.options?.span,
            options: node.options,
            textSource: "group",
            textSpan: node.span,
            text: node.text
          };
          runtimeGraphNodes.push({
            syntheticNode,
            defaultPoint: node.defaultPoint,
            placementHint: node.placementHint,
            nodeIndex
          });
        }

        const sizeAwarePoints = resolveSizeAwareGraphNodePoints(runtimeGraphNodes, graphStatement, context, builder.style);
        for (const runtimeNode of runtimeGraphNodes) {
          const defaultPoint = sizeAwarePoints.get(runtimeNode.nodeIndex) ?? runtimeNode.defaultPoint;
          const evaluatedNode = withDependencySource(context, graphStatement.id, () =>
            evaluateNodeItem(
              runtimeNode.syntheticNode,
              graphStatement,
              context,
              builder.style,
              markFeature,
              pushDiagnostic,
              null,
              undefined,
              undefined,
              defaultPoint,
              builder.statementStyleChain
            )
          );
          plannedBehindNodeElements.push(...evaluatedNode.behindElements);
          plannedFrontNodeElements.push(...evaluatedNode.frontElements);
        }

        const edgeElements: SceneElement[] = [];
        for (let edgeIndex = 0; edgeIndex < plan.edges.length; edgeIndex += 1) {
          const edge = plan.edges[edgeIndex];
          const startCoordinateRaw = `(${edge.from}${edge.fromAnchor ? `.${edge.fromAnchor}` : ""})`;
          const targetCoordinateRaw = `(${edge.to}${edge.toAnchor ? `.${edge.toAnchor}` : ""})`;
          const graphEdgeNodes: NodeItem[] | undefined =
            edge.nodes && edge.nodes.length > 0
              ? edge.nodes.map((node, nodeIndex): NodeItem => ({
                  kind: "Node",
                  id: `${item.id}:graph-edge:${edgeIndex}:node:${nodeIndex}`,
                  span: node.span,
                  raw: node.text,
                  templateRaw: node.text,
                  optionsSpan: node.options?.span,
                  options: node.options,
                  textSource: "group",
                  textSpan: node.span,
                  text: node.text
                }))
              : undefined;
          const startEvaluation = withDependencySource(context, graphStatement.id, () =>
            evaluateRawCoordinate(startCoordinateRaw, context)
          );
          for (const code of startEvaluation.diagnostics) {
            pushDiagnostic(code, `Graph edge start issue: ${code}`, edge.span.from, edge.span.to);
          }
          if (!startEvaluation.world) {
            pushDiagnostic(
              "graph-edge-without-start",
              `Graph edge source \`${edge.from}\` is not available.`,
              edge.span.from,
              edge.span.to
            );
            continue;
          }

          const baseEdgeItem: EdgeOperationItem = {
            kind: "EdgeOperation",
            id: `${item.id}:graph-edge:${edgeIndex}`,
            span: edge.span,
            optionsSpan: edge.options?.span,
            options: edge.options,
            nodes: graphEdgeNodes,
            target: {
              kind: "coordinate",
              raw: targetCoordinateRaw,
              span: edge.span
            },
            raw: `${edge.from} ${edge.operator} ${edge.to}`
          };
          const edgePlan = extractToLikeOptionPlan(baseEdgeItem);
          const edgeItem: EdgeOperationItem =
            edgePlan.generatedNodes.length > 0
              ? {
                  ...edgePlan.item,
                  nodes: [...(edgePlan.item.nodes ?? []), ...edgePlan.generatedNodes]
                }
              : edgePlan.item;

          const edgeOptionLayers: StyleTraceLayerInput[] = [];
          if (everyEdgeOptions) {
            edgeOptionLayers.push({
              kind: "command",
              sourceRef: {
                sourceId: edgeItem.id,
                sourceSpan: edge.span,
                sourceKind: "edge-default",
                label: "every edge"
              },
              rawOptions: [everyEdgeOptions]
            });
          }
          if (drawEdgeOptions) {
            edgeOptionLayers.push({
              kind: "command",
              sourceRef: {
                sourceId: edgeItem.id,
                sourceSpan: edge.span,
                sourceKind: "edge-default",
                label: "draw"
              },
              rawOptions: [drawEdgeOptions]
            });
          }
          if (edgeItem.options) {
            edgeOptionLayers.push({
              kind: "command",
              sourceRef: {
                sourceId: edgeItem.id,
                sourceSpan: edgeItem.optionsSpan ?? edge.span,
                sourceKind: "edge-options",
                label: "graph edge"
              },
              rawOptions: [edgeItem.options]
            });
          }

          const resolvedEdgeStyle = withDependencySource(context, graphStatement.id, () =>
            resolveContextDelta(
              builder.style,
              frameTransform,
              edgeOptionLayers,
              frame.customStyles,
              (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
              builder.statementStyleChain,
              (raw) => resolveContextColorAliasValue(context, raw)
            )
          );
          for (const diagnostic of resolvedEdgeStyle.diagnostics) {
            const code = styleDiagnosticCode(diagnostic);
            if (code === "unsupported-option-flag:every edge") {
              continue;
            }
            pushStyleDiagnostic(pushDiagnostic, diagnostic, "Graph edge option issue", edge.span);
          }

          const handled = withDependencySource(context, graphStatement.id, () =>
            applyEdgeOperation(
              edgeItem,
              context,
              graphStatement,
              resolvedEdgeStyle.style,
              resolvedEdgeStyle.chain,
              markFeature,
              pushDiagnostic,
              startEvaluation.world,
              startCoordinateRaw
            )
          );
          if (handled.activePath && hasDrawablePathSegments(handled.activePath)) {
            edgeElements.push(...handled.behindNodeElements, handled.activePath, ...handled.frontNodeElements);
          } else {
            edgeElements.push(...handled.behindNodeElements, ...handled.frontNodeElements);
          }
        }

        markFeature("graph_operation", "supported");
        behindNodeElements.push(...plannedBehindNodeElements);
        frontNodeElements.push(...edgeElements, ...plannedFrontNodeElements);
        builder.currentOperator = null;
      }
    ],
    [
      "PathOption",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "PathOption" }>;
        const expandedOptions = expandOptionListMacros([item.options], builder.treeFrameState.macroBindings, context.macroTraceCollector ?? undefined)[0] ?? item.options;
        const expandedItem = expandedOptions === item.options ? item : { ...item, options: expandedOptions };
        if (builder.pendingCircleCenter) {
          const parsed = extractCircleShapeOptions(expandedItem, builder.treeFrameState.macroBindings, context.macroTraceCollector ?? undefined);
          if (parsed.radius != null) {
            builder.pendingCircleRadius = parsed.radius;
            builder.pendingCircleRadii = null;
          } else if (parsed.rx != null && parsed.ry != null) {
            builder.pendingCircleRadius = null;
            builder.pendingCircleRadii = { rx: parsed.rx, ry: parsed.ry };
          }
          if (parsed.rotation != null) {
            builder.pendingCircleRotation = parsed.rotation;
          }
        }

        if (builder.pendingEllipseCenter) {
          builder.pendingEllipseRadii = extractEllipseRadii(
            expandedItem,
            pushDiagnostic,
            builder.treeFrameState.macroBindings,
            context.macroTraceCollector ?? undefined
          );
        }

        if (builder.pendingArc) {
          const arcParams = extractArcParameters(
            expandedItem,
            pushDiagnostic,
            builder.style,
            builder.treeFrameState.macroBindings,
            context.macroTraceCollector ?? undefined
          );
          if (arcParams) {
            let path: ScenePath | null = builder.activePath;
            if (!path) {
              path = makePath(statement.id, item.id, builder.style, builder.statementStyleChain, item.span);
              path.commands.push({ kind: "M", to: builder.pendingArc.from });
            }
            const appended = appendArcCommand(path.commands, builder.pendingArc.from, arcParams, frameTransform);
            builder.activePath = path;
            setCurrentPoint(appended.endpoint);
            builder.lastPlacementSegment = appended.segment;
            builder.previousSegmentRoundedCorners = builder.activeRoundedCorners;
            markFeature("keyword_arc", "supported");
            markFeature("svg_path", "supported");
            builder.pendingArc = null;
          }
        }

        if (builder.pendingGrid) {
          const parsed = extractGridSteps(
            expandedItem,
            pushDiagnostic,
            builder.treeFrameState.macroBindings,
            builder.treeFrameState.transform
          );
          if (parsed) {
            if (parsed.stepX != null && parsed.stepX >= 0) {
              builder.pendingGrid.stepX = parsed.stepX;
            }
            if (parsed.stepY != null && parsed.stepY >= 0) {
              builder.pendingGrid.stepY = parsed.stepY;
            }
          }
        }

        const rounded = extractRoundedCorners(expandedOptions, builder.activeRoundedCorners);
        if (rounded !== undefined) {
          builder.activeRoundedCorners = rounded;
        }

        const isLeadingPathOption = !builder.sawNonLeadingPathItem;
        const mirrorsStatementOptions =
          isLeadingPathOption
          && item.span.from === statement.options?.span.from
          && item.span.to === statement.options.span.to;

        if (expandedOptions) {
          if (!mirrorsStatementOptions) {
            const optionSourceRef = {
              sourceId: item.id,
              sourceSpan: item.span,
              sourceKind: "path-option-item",
              label: "path option"
            } as const;
            const optionCustomStyles = cloneCustomStyleRegistry(builder.treeFrameState.customStyles);
            const optionPicDefinitions = clonePicDefinitionRegistry(builder.treeFrameState.picDefinitions);
            applyPicDefinitionsFromOptionLists(optionPicDefinitions, [expandedOptions], optionSourceRef);
            const optionResolved = resolveContextDelta(
              builder.treeFrameState.style,
              builder.treeFrameState.transform,
              [
                {
                  kind: "scope",
                  sourceRef: optionSourceRef,
                  rawOptions: [expandedOptions]
                }
              ],
              optionCustomStyles,
              (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
              builder.treeFrameState.styleChain,
              (raw) => resolveContextColorAliasValue(context, raw)
            );
            for (const diagnostic of optionResolved.diagnostics) {
              pushStyleDiagnostic(pushDiagnostic, diagnostic, "Path option issue", item.span);
            }

            const optionMeta = resolveFrameMeta(builder.treeFrameState, optionResolved.expandedOptionLists, optionSourceRef);

            builder.treeFrameState = {
              ...builder.treeFrameState,
              ...optionMeta,
              style: optionResolved.style,
              styleChain: optionResolved.chain,
              transform: optionResolved.transform,
              customStyles: optionCustomStyles,
              picDefinitions: optionPicDefinitions
            };
            builder.style = builder.treeFrameState.style;
            builder.statementStyleChain = builder.treeFrameState.styleChain;
            if (builder.activePath) {
              builder.activePath.style = { ...builder.style };
              builder.activePath.styleChain = cloneStyleChain(builder.statementStyleChain);
            }
            builder.plotSettings = applyPlotSettingsFromStyleChain(
              createDefaultPlotSettings(),
              builder.treeFrameState.styleChain,
              builder.treeFrameState.macroBindings
            );
            builder.shouldCompoundFilledSubpaths = computeShouldCompoundFilledSubpaths(builder.style);
          }
          if (isLeadingPathOption) {
            builder.leadingToLikeOptions = mergeOptionLists(builder.leadingToLikeOptions, expandedOptions);
          }
        }
      }
    ],
    [
      "Node",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "Node" }>;
        if (builder.currentOperator) {
          builder.pendingSegmentNodes.push(item);
          return;
        }
        const adornmentOptions = resolveOptionsForNodeAdornmentPlan(item.options, builder.treeFrameState, context);
        const adornmentPlan = extractNodeAdornmentPlan(adornmentOptions, {
          quoteMode: builder.treeFrameState.nodeQuotesMode,
          labelPosition: builder.treeFrameState.labelPosition,
          pinPosition: builder.treeFrameState.pinPosition,
          labelDistancePt: builder.treeFrameState.labelDistancePt,
          pinDistancePt: builder.treeFrameState.pinDistancePt,
          pinEdgeRaw: builder.treeFrameState.pinEdgeRaw
        });
        const declaredNodeName = builder.pendingNodeNameForNodeCommand ?? item.name ?? null;
        const hasFollowingTreeChildren = hasFollowingChildOperation(statement.items, builder.currentItemIndex + 1);
        const existingTreeParent = builder.treeParentCandidate;
        const synthesizedTreeNodeName: string | null =
          hasFollowingTreeChildren && !declaredNodeName
            ? makeTreeAutoName(existingTreeParent?.nameRaw ?? null, statement.id, item.id, builder.currentItemIndex + 1, frame.treeLevel)
            : null;
        if (synthesizedTreeNodeName) {
          markFeature("tree_auto_naming", "supported");
        }
        const trailingCoordinateRaw = maybeResolveTrailingCoordinateFromNodeName(item.name);
        const synthesizedMainNodeName =
          adornmentPlan.adornments.length > 0 && !declaredNodeName
            ? `adornment_main_${sanitizeGeneratedNodeName(statement.id)}_${builder.currentItemIndex}`
            : null;
        const forcedMainNodeName: string | undefined =
          builder.pendingNodeNameForNodeCommand ?? synthesizedMainNodeName ?? synthesizedTreeNodeName ?? undefined;
        const nodeBase = trailingCoordinateRaw ? { ...item, name: undefined } : item;
        const nodeItem = {
          ...nodeBase,
          options: adornmentPlan.mainOptions,
          optionsSpan: adornmentPlan.mainOptions?.span
        };
        const standaloneNodeDefaultTarget = !builder.hasPathCurrentPoint ? defaultPathOrigin : undefined;
        const allowImplicitOriginHandle =
          statement.command === "node"
          && !builder.hasPathCurrentPoint
          && !isMatrixNodeOptions(nodeItem.options);
        const scopedAutoSide = resolveScopedAutoSide(builder.statementStyleChain);
        const nodeOptionsWithScopedAuto =
          scopedAutoSide != null
            ? mergeOptionLists(parseOptionListRaw(`[auto=${scopedAutoSide}]`, item.span.from), nodeItem.options)
            : nodeItem.options;
        const explicitNodeAtSyntax = hasExplicitNodeAtSyntax(statement.items, builder.currentItemIndex);
        const explicitNodeAtTarget = explicitNodeAtSyntax ? (builder.currentPointLogical ?? context.currentPoint ?? undefined) : undefined;
        const resolvedNode = evaluateNodeItem(
          nodeOptionsWithScopedAuto === nodeItem.options ? nodeItem : { ...nodeItem, options: nodeOptionsWithScopedAuto, optionsSpan: nodeOptionsWithScopedAuto?.span },
          statement,
          context,
          builder.style,
          markFeature,
          pushDiagnostic,
          builder.lastPlacementSegment,
          forcedMainNodeName,
          undefined,
          explicitNodeAtTarget ?? standaloneNodeDefaultTarget,
          builder.statementStyleChain,
          { allowImplicitOriginHandle, explicitAtSyntax: explicitNodeAtSyntax }
        );
        builder.pendingNodeNameForNodeCommand = null;
        const edgeStartName = declaredNodeName ?? forcedMainNodeName;
        builder.pendingEdgeStartCoordinateRaw = edgeStartName ? `(${edgeStartName.trim()})` : null;
        behindNodeElements.push(...resolvedNode.behindElements);
        frontNodeElements.push(...resolvedNode.frontElements);

        const treeParentNameCandidate: string | null = forcedMainNodeName ?? declaredNodeName;
        if (treeParentNameCandidate && treeParentNameCandidate.trim().length > 0) {
          const scopedTreeParentName = applyNameScope(treeParentNameCandidate, context);
          const treeParentPoint: WorldPoint | undefined =
            readNamedCoordinate(context, scopedTreeParentName) ??
            readNamedCoordinate(context, treeParentNameCandidate) ??
            existingTreeParent?.point;
          if (treeParentPoint) {
            builder.treeParentCandidate = {
              nameRaw: scopedTreeParentName,
              point: treeParentPoint,
              span: item.span
            };
          }
        }

        const mainNodeNameRaw = forcedMainNodeName ?? declaredNodeName;
        if (mainNodeNameRaw) {
          for (let adornmentIndex = 0; adornmentIndex < adornmentPlan.adornments.length; adornmentIndex += 1) {
            const spec = adornmentPlan.adornments[adornmentIndex];
            const materialized = materializeNodeAdornment({
              spec,
              context,
              mainNodeNameRaw,
              ownerId: item.id,
              adornmentIndex
            });
            const resolvedAdornment = evaluateNodeItem(
              materialized.node,
              statement,
              context,
              builder.style,
              markFeature,
              pushDiagnostic,
              null,
              materialized.node.name,
              undefined,
              undefined,
              builder.statementStyleChain
            );
            behindNodeElements.push(...resolvedAdornment.behindElements);
            frontNodeElements.push(...resolvedAdornment.frontElements);

            if (spec.kind === "pin" && materialized.node.name && materialized.mainPoint) {
              const pinAdornmentTargetId = makeNodeAdornmentTargetId(item.id, adornmentIndex, "pin");
              const pinEdgeItem: EdgeOperationItem = {
                kind: "EdgeOperation",
                id: `${item.id}:pin-edge:${adornmentIndex}`,
                span: spec.span,
                optionsSpan: undefined,
                options: undefined,
                nodes: undefined,
                target: {
                  kind: "coordinate",
                  raw: `(${materialized.node.name})`
                },
                raw: `edge (${materialized.node.name})`
              };

              const pinEdgeOptionLayers: StyleTraceLayerInput[] = [];
              const helpLinesOptions = HELP_LINES_OPTIONS;
              if (helpLinesOptions) {
                pinEdgeOptionLayers.push({
                  kind: "command",
                  sourceRef: {
                    sourceId: pinEdgeItem.id,
                    sourceSpan: spec.span,
                    sourceKind: "pin-edge-default",
                    label: "help lines"
                  },
                  rawOptions: [helpLinesOptions]
                });
              }
              if (materialized.pinEdgeOptions) {
                pinEdgeOptionLayers.push({
                  kind: "command",
                  sourceRef: {
                    sourceId: pinEdgeItem.id,
                    sourceSpan: materialized.pinEdgeOptions.span,
                    sourceKind: "pin-edge-options",
                    label: "pin edge"
                  },
                  rawOptions: [materialized.pinEdgeOptions]
                });
              }
              const resolvedPinEdgeStyle = resolveContextDelta(
                builder.style,
                frameTransform,
                pinEdgeOptionLayers,
                frame.customStyles,
                (raw) => evaluateRawCoordinate(raw, context).world,
                builder.statementStyleChain,
                (raw) => resolveContextColorAliasValue(context, raw)
              );
              for (const diagnostic of resolvedPinEdgeStyle.diagnostics) {
                pushStyleDiagnostic(pushDiagnostic, diagnostic, "Pin edge option issue", spec.span);
              }

              const pinEdgeHandlesStart = context.editHandles.length;
              const pinEdge = applyEdgeOperation(
                pinEdgeItem,
                context,
                statement,
                resolvedPinEdgeStyle.style,
                resolvedPinEdgeStyle.chain,
                markFeature,
                pushDiagnostic,
                materialized.mainPoint,
                `(${materialized.mainNameRaw})`
              );
              for (let handleIndex = pinEdgeHandlesStart; handleIndex < context.editHandles.length; handleIndex += 1) {
                const handle = context.editHandles[handleIndex];
                if (handle?.sourceRef.sourceId !== statement.id) {
                  continue;
                }
                context.editHandles[handleIndex] = {
                  ...handle,
                  sourceRef: {
                    ...handle.sourceRef,
                    sourceId: pinAdornmentTargetId
                  }
                };
              }
              if (pinEdge.activePath && hasDrawablePathSegments(pinEdge.activePath)) {
                pinEdge.activePath = {
                  ...pinEdge.activePath,
                  adornment: {
                    targetId: pinAdornmentTargetId,
                    kind: "pin",
                    ownerSourceId: item.id,
                    ownerNodeId: item.id,
                    adornmentIndex,
                    optionSpan: spec.span,
                    valueSpan: spec.valueSpan,
                    textSpan: spec.textSpan,
                    angleRaw: spec.angleRaw,
                    angleSpan: spec.angleSpan,
                    distancePt: spec.distancePt,
                    defaultDistancePt: spec.defaultDistancePt,
                    distanceExplicit: spec.distanceExplicit,
                    ownerPoint: materialized.mainPoint ?? undefined,
                    ownerGeometry: cloneAdornmentOwnerGeometry(materialized.mainGeometry)
                  }
                };
                frontNodeElements.push(...pinEdge.behindNodeElements);
                if (pinEdge.activePath) {
                  frontNodeElements.push(pinEdge.activePath);
                }
                frontNodeElements.push(...pinEdge.frontNodeElements);
              } else {
                frontNodeElements.push(...pinEdge.behindNodeElements, ...pinEdge.frontNodeElements);
              }
            }
          }
        }

        if (trailingCoordinateRaw) {
          const trailingCoordinate = evaluateRawCoordinate(trailingCoordinateRaw, context);
          if (trailingCoordinate.world) {
            if (builder.activePath) {
              builder.activePath.commands.push({ kind: "M", to: trailingCoordinate.world });
            }
            setCurrentPoint(trailingCoordinate.world);
            context.pathStartPoint = trailingCoordinate.world;
            builder.lastPlacementSegment = null;
            builder.previousSegmentRoundedCorners = null;
          } else {
            for (const code of trailingCoordinate.diagnostics) {
              pushDiagnostic(code, `Node trailing coordinate issue: ${code}`, item.span.from, item.span.to);
            }
          }
        }
      }
    ],
    [
      "DecorateOperation",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "DecorateOperation" }>;
        markFeature("decorate_operation", "supported");
        builder.activePath = flushDrawableActivePath(geometryElements, builder.activePath);
        builder.previousSegmentRoundedCorners = null;
        builder.pendingRectangleFrom = null;
        builder.pendingCircleCenter = null;
        builder.pendingCircleRadius = null;
        builder.pendingCircleRadii = null;
        builder.pendingCircleRotation = 0;
        builder.pendingEllipseCenter = null;
        builder.pendingEllipseRadii = null;
        builder.pendingArc = null;
        builder.pendingGrid = null;

        const raw = item.subpathRaw.trim();
        const subpathBody = raw.startsWith("{") && raw.endsWith("}") ? raw.slice(1, -1) : raw;
        const parseResult = parseTikz(`\\begin{tikzpicture}\\path ${subpathBody};\\end{tikzpicture}`, {
          recover: true,
        });
        for (const diagnostic of parseResult.diagnostics) {
          if (diagnostic.severity !== "error") {
            continue;
          }
          pushDiagnostic(
            diagnostic.code ?? "decorate-operation-parse-error",
            `Decorate operation parse issue: ${diagnostic.message}`,
            item.subpathSpan.from,
            item.subpathSpan.to
          );
        }

        const normalizedSubpathBody = subpathBody.trim();
        const hasSelfReferentialDecorate = parseResult.figure.body.some((candidate) => {
          if (candidate.kind !== "Path" || candidate.items.length !== 1) {
            return false;
          }
          const onlyItem = candidate.items[0];
          return onlyItem?.kind === "DecorateOperation" && onlyItem.subpathRaw.trim() === normalizedSubpathBody;
        });
        if (hasSelfReferentialDecorate) {
          pushDiagnostic(
            "invalid-decorate-operation",
            "Decorate operation requires a decorated subpath.",
            item.subpathSpan.from,
            item.subpathSpan.to
          );
          return;
        }

        let operationStyle = builder.style;
        if (item.options) {
          const resolvedDecorateOptions = resolveContextDelta(
            builder.style,
            frameTransform,
            [
              {
                kind: "command",
                sourceRef: {
                  sourceId: item.id,
                  sourceSpan: item.optionsSpan ?? item.span,
                  sourceKind: "decorate-operation",
                  label: "decorate"
                },
                rawOptions: [item.options]
              }
            ],
            frame.customStyles,
            (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
            builder.statementStyleChain,
            (raw) => resolveContextColorAliasValue(context, raw)
          );
          operationStyle = {
            ...resolvedDecorateOptions.style,
            decoration: {
              ...resolvedDecorateOptions.style.decoration,
              enabled: true,
              params: { ...resolvedDecorateOptions.style.decoration.params }
            }
          };
          for (const diagnostic of resolvedDecorateOptions.diagnostics) {
            pushStyleDiagnostic(pushDiagnostic, diagnostic, "Decorate option issue", item.span);
          }
        } else {
          operationStyle = {
            ...builder.style,
            decoration: {
              ...builder.style.decoration,
              enabled: true,
              params: { ...builder.style.decoration.params }
            }
          };
        }

        for (const nestedStatement of parseResult.figure.body) {
          if (nestedStatement.kind !== "Path") {
            continue;
          }
          const nestedElements = withDependencySource(context, nestedStatement.id, () =>
            evaluatePathStatement(nestedStatement, context, operationStyle, markFeature, pushDiagnostic)
          );
          geometryElements.push(...nestedElements);
        }
      }
    ],
    [
      "CoordinateOperation",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "CoordinateOperation" }>;
        const operationName = item.name?.trim();
        const parsedName = operationName === undefined || operationName.length === 0 ? parseCoordinateOperation(item.raw)?.name : operationName;
        if (!parsedName) {
          pushDiagnostic("invalid-coordinate-operation", "Could not parse coordinate operation.", item.span.from, item.span.to);
          return;
        }

        const emitCoordinateAdornmentLabels = (basePoint: WorldPoint | null): void => {
          if (!basePoint || !item.options) {
            return;
          }

          const adornmentOptions = resolveOptionsForNodeAdornmentPlan(item.options, builder.treeFrameState, context);
          const adornmentPlan = extractNodeAdornmentPlan(adornmentOptions, {
            quoteMode: builder.treeFrameState.nodeQuotesMode,
            labelPosition: builder.treeFrameState.labelPosition,
            pinPosition: builder.treeFrameState.pinPosition,
            labelDistancePt: builder.treeFrameState.labelDistancePt,
            pinDistancePt: builder.treeFrameState.pinDistancePt,
            pinEdgeRaw: builder.treeFrameState.pinEdgeRaw
          });
          if (adornmentPlan.adornments.length === 0) {
            return;
          }

          for (let adornmentIndex = 0; adornmentIndex < adornmentPlan.adornments.length; adornmentIndex += 1) {
            const spec = adornmentPlan.adornments[adornmentIndex];
            const materialized = materializeNodeAdornment({
              spec,
              context,
              mainNodeNameRaw: parsedName,
              ownerId: item.id,
              adornmentIndex
            });
            const resolvedAdornment = evaluateNodeItem(
              materialized.node,
              statement,
              context,
              builder.style,
              markFeature,
              pushDiagnostic,
              null,
              materialized.node.name,
              undefined,
              undefined,
              builder.statementStyleChain
            );
            behindNodeElements.push(...resolvedAdornment.behindElements);
            frontNodeElements.push(...resolvedAdornment.frontElements);
          }
        };

        const nextItem = statement.items[builder.currentItemIndex + 1];
        const nextCoordinate = statement.items[builder.currentItemIndex + 2];
        if (nextItem?.kind === "PathKeyword" && nextItem.keyword === "at" && nextCoordinate?.kind === "Coordinate") {
          builder.pendingNamedCoordinate = { name: parsedName };
        } else {
          const placementFraction = resolveNodePositionFraction(item.options);
          if (placementFraction != null && builder.currentOperator) {
            builder.pendingSegmentPlacements.push({ name: parsedName, fraction: placementFraction });
            markFeature("named_coordinates", "supported");
            return;
          }

          const capturePoint =
            placementFraction != null && builder.lastPlacementSegment
              ? pointAtPlacementSegment(builder.lastPlacementSegment, placementFraction)
              : builder.currentPointLogical ?? context.currentPoint;
          if (capturePoint) {
            writeNamedCoordinate(context, applyNameScope(parsedName, context), capturePoint);
            emitCoordinateAdornmentLabels(capturePoint);
          } else {
            pushDiagnostic(
              "invalid-coordinate-operation",
              "Coordinate operation requires `at (...)` or an existing current point.",
              item.span.from,
              item.span.to
            );
          }
        }
        markFeature("named_coordinates", "supported");
      }
    ],
    [
      "PicOperation",
      (pathItem) => {
        const item = pathItem as PicOperationItem;
        const placementFraction = resolveNodePositionFraction(item.options);
        if (placementFraction != null && builder.currentOperator) {
          builder.pendingSegmentPics.push({ item, fraction: placementFraction });
          return;
        }

        const segment = placementFraction != null ? builder.lastPlacementSegment : null;
        const explicitPlacement = item.atRaw ? evaluateRawCoordinate(item.atRaw, context, item.atRelativePrefix) : null;
        if (explicitPlacement) {
          for (const code of explicitPlacement.diagnostics) {
            pushDiagnostic(code, `Pic placement issue: ${code}`, item.atSpan?.from ?? item.span.from, item.atSpan?.to ?? item.span.to);
          }
          if (!explicitPlacement.world) {
            markFeature("pic_operation", "unsupported");
            pushDiagnostic("invalid-pic-placement", "Could not evaluate pic placement.", item.atSpan?.from ?? item.span.from, item.atSpan?.to ?? item.span.to);
            return;
          }
          if (item.atSpan) {
            const handle = createEditHandle(explicitPlacement, item.atSpan, item.id, "node-position", context);
            if (handle) {
              context.editHandles.push(handle);
            }
          }
          emitPicOperation(item, explicitPlacement.world, segment);
          return;
        }

        if (placementFraction != null && segment) {
          emitPicOperation(item, pointAtPlacementSegment(segment, placementFraction), segment);
          return;
        }

        const placement = builder.currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        emitPicOperation(item, placement, null);
      }
    ],
    [
      "UnknownPathItem",
      () => {}
    ],
    [
      "ToOperation",
      (pathItem) => {
        const item = pathItem as ToOperationItem;
        const toPlan = extractToLikeOptionPlan(mergeToLikePathOptions(item, builder.leadingToLikeOptions));
        const toItem: ToOperationItem =
          toPlan.generatedNodes.length > 0
            ? {
                ...toPlan.item,
                nodes: [...(toPlan.item.nodes ?? []), ...toPlan.generatedNodes]
              }
            : toPlan.item;
        let toStartCoordinateRaw: string | null = null;
        if (builder.currentPointCoordinate) {
          const namedCoordinate = builder.currentPointCoordinate as { form: string; x: string };
          if (namedCoordinate.form === "named") {
            toStartCoordinateRaw = `(${namedCoordinate.x.trim()})`;
          }
        }
        const handled = applyToOperation(
          toItem,
          context,
          statement,
          builder.style,
          builder.statementStyleChain,
          builder.activePath,
          builder.previousSegmentRoundedCorners,
          markFeature,
          pushDiagnostic,
          toStartCoordinateRaw
        );
        builder.activePath = handled.activePath;
        if (handled.segment) {
          builder.lastPlacementSegment = handled.segment;
        }
        if (handled.segment) {
          for (const pic of toItem.pics ?? []) {
            const fraction = resolveNodePositionFraction(pic.options) ?? 0.5;
            emitPicOperation(pic, pointAtPlacementSegment(handled.segment, fraction), handled.segment);
          }
        }
        behindNodeElements.push(...handled.behindNodeElements);
        frontNodeElements.push(...handled.frontNodeElements);
        if (handled.previousSegmentRoundedCorners !== undefined) {
          builder.previousSegmentRoundedCorners = handled.previousSegmentRoundedCorners;
        }
        setCurrentPoint(context.currentPoint);
      }
    ],
    [
      "EdgeOperation",
      (pathItem) => {
        const item = pathItem as EdgeOperationItem;
        const edgePlan = extractToLikeOptionPlan(mergeToLikePathOptions(item, builder.leadingToLikeOptions));
        const edgeItem: EdgeOperationItem =
          edgePlan.generatedNodes.length > 0
            ? {
                ...edgePlan.item,
                nodes: [...(edgePlan.item.nodes ?? []), ...edgePlan.generatedNodes]
              }
            : edgePlan.item;
        if (!builder.edgeOperationStart) {
          let coordinateRaw = builder.pendingEdgeStartCoordinateRaw;
          if (!coordinateRaw && builder.currentPointCoordinate) {
            const namedCoordinate = builder.currentPointCoordinate as { form: string; x: string };
            if (namedCoordinate.form === "named") {
              coordinateRaw = `(${namedCoordinate.x.trim()})`;
            }
          }
          let startPoint = context.currentPoint;
          if (!startPoint && coordinateRaw) {
            const resolvedStart = evaluateRawCoordinate(coordinateRaw, context);
            for (const code of resolvedStart.diagnostics) {
              pushDiagnostic(code, `Edge start issue: ${code}`, item.span.from, item.span.to);
            }
            if (resolvedStart.world) {
              startPoint = resolvedStart.world;
            }
          }
          if (!startPoint) {
            pushDiagnostic("edge-without-start", "`edge` operation requires a current point.", item.span.from, item.span.to);
            return;
          }
          builder.edgeOperationStart = {
            point: startPoint,
            coordinateRaw
          };
        }

        const edgeOptionLayers: StyleTraceLayerInput[] = [];
        if (everyEdgeOptions) {
          edgeOptionLayers.push({
            kind: "command",
            sourceRef: {
              sourceId: edgeItem.id,
              sourceSpan: item.span,
              sourceKind: "edge-default",
              label: "every edge"
            },
            rawOptions: [everyEdgeOptions]
          });
        }
        if (drawEdgeOptions) {
          edgeOptionLayers.push({
            kind: "command",
            sourceRef: {
              sourceId: edgeItem.id,
              sourceSpan: item.span,
              sourceKind: "edge-default",
              label: "draw"
            },
            rawOptions: [drawEdgeOptions]
          });
        }
        if (edgeItem.options) {
          edgeOptionLayers.push({
            kind: "command",
            sourceRef: {
              sourceId: edgeItem.id,
              sourceSpan: edgeItem.optionsSpan ?? item.span,
              sourceKind: "edge-options",
              label: "edge"
            },
            rawOptions: [edgeItem.options]
          });
        }
        const resolvedEdgeStyle = resolveContextDelta(
          builder.style,
          frameTransform,
          edgeOptionLayers,
          frame.customStyles,
          (raw) => evaluateRawCoordinate(raw, context).world,
          builder.statementStyleChain,
          (raw) => resolveContextColorAliasValue(context, raw)
        );
        for (const diagnostic of resolvedEdgeStyle.diagnostics) {
          const code = styleDiagnosticCode(diagnostic);
          if (code === "unsupported-option-flag:every edge") {
            continue;
          }
          pushStyleDiagnostic(pushDiagnostic, diagnostic, "Edge option issue", item.span);
        }

        const handled = applyEdgeOperation(
          edgeItem,
          context,
          statement,
          resolvedEdgeStyle.style,
          resolvedEdgeStyle.chain,
          markFeature,
          pushDiagnostic,
          builder.edgeOperationStart.point,
          builder.edgeOperationStart.coordinateRaw
        );
        if (handled.segment) {
          for (const pic of edgeItem.pics ?? []) {
            const fraction = resolveNodePositionFraction(pic.options) ?? 0.5;
            emitPicOperation(pic, pointAtPlacementSegment(handled.segment, fraction), handled.segment);
          }
        }
        if (handled.activePath && hasDrawablePathSegments(handled.activePath)) {
          frontNodeElements.push(...handled.behindNodeElements);
          frontNodeElements.push(handled.activePath);
          frontNodeElements.push(...handled.frontNodeElements);
        } else {
          frontNodeElements.push(...handled.behindNodeElements, ...handled.frontNodeElements);
        }
      }
    ],
    [
      "EdgeFromParentOperation",
      (pathItem) => {
        const item = pathItem as EdgeFromParentOperationItem;
        markFeature("edge_from_parent_operation", "unsupported");
        pushDiagnostic(
          "edge-from-parent-outside-child",
          "`edge from parent`/`edge to parent` operations are only supported inside `child` bodies.",
          item.span.from,
          item.span.to
        );
      }
    ],
    [
      "SvgOperation",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "SvgOperation" }>;
        if (item.options) {
          markFeature("options_structured", "supported");
        }

        let operationTransform = builder.treeFrameState.transform;
        if (item.options) {
          const optionSourceRef = {
            sourceId: item.id,
            sourceSpan: item.optionsSpan ?? item.span,
            sourceKind: "svg-operation-options",
            label: "svg"
          } as const;
          const optionCustomStyles = cloneCustomStyleRegistry(builder.treeFrameState.customStyles);
          const optionResolved = resolveContextDelta(
            builder.style,
            builder.treeFrameState.transform,
            [
              {
                kind: "scope",
                sourceRef: optionSourceRef,
                rawOptions: [item.options]
              }
            ],
            optionCustomStyles,
            (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
            builder.statementStyleChain,
            (raw) => resolveContextColorAliasValue(context, raw)
          );
          operationTransform = optionResolved.transform;
          for (const diagnostic of optionResolved.diagnostics) {
            pushStyleDiagnostic(pushDiagnostic, diagnostic, "SVG option issue", item.span);
          }
        }

        const fallbackStart = applyMatrix(builder.treeFrameState.transform, wp(0, 0));
        const startPoint = context.currentPoint ?? builder.currentPointLogical ?? fallbackStart;
        if (!context.currentPoint && !builder.currentPointLogical) {
          setCurrentPoint(startPoint);
        }

        const parsed = parseSvgPathOperation({
          payloadRaw: item.dataRaw,
          transform: operationTransform,
          startPoint,
          subpathStartPoint: context.pathStartPoint
        });
        if (!builder.activePath && parsed.commands.length > 0) {
          builder.activePath = makePath(statement.id, item.id, builder.style, builder.statementStyleChain, statement.span);
          if (parsed.commands[0]?.kind !== "M") {
            builder.activePath.commands.push({ kind: "M", to: startPoint });
          }
        }
        if (builder.activePath && parsed.commands.length > 0) {
          builder.activePath.commands.push(...parsed.commands);
        }

        if (parsed.subpathStartPoint) {
          context.pathStartPoint = parsed.subpathStartPoint;
        }
        setCurrentPoint(parsed.endPoint);
        builder.currentOperator = null;
        builder.pendingEdgeStartCoordinateRaw = null;

        if (parsed.lastSegment) {
          builder.lastPlacementSegment = parsed.lastSegment;
          builder.previousSegmentRoundedCorners = builder.activeRoundedCorners;
        } else {
          builder.lastPlacementSegment = null;
          builder.previousSegmentRoundedCorners = null;
        }

        if (parsed.commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A")) {
          markFeature("svg_path", "supported");
        }

        if (parsed.diagnostics.length === 0 || parsed.commands.length > 0) {
          markFeature("svg_operation", "supported");
        } else {
          markFeature("svg_operation", "unsupported");
        }

        for (const issue of parsed.diagnostics) {
          pushDiagnostic("invalid-svg-path-data", `SVG path issue: ${issue}`, item.span.from, item.span.to);
        }
      }
    ],
    [
      "LetOperation",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "LetOperation" }>;
        markFeature("let_operation", "unsupported");
        pushDiagnostic("unsupported-let-operation", "`let` operations are not semantically implemented yet.", item.span.from, item.span.to);
      }
    ]
  ]);

  for (let index = 0; index < statement.items.length; index += 1) {
    const item = statement.items[index];
    builder.currentItemIndex = index;
    if (item.kind !== "PathComment" && item.kind !== "PathOption") {
      builder.sawNonLeadingPathItem = true;
    }
    if (item.kind !== "EdgeOperation" && item.kind !== "PathComment") {
      builder.edgeOperationStart = null;
      builder.pendingEdgeStartCoordinateRaw = null;
    }
    if (
      item.kind !== "PathComment" &&
      item.kind !== "PathOption" &&
      item.kind !== "ChildOperation" &&
      item.kind !== "Coordinate" &&
      item.kind !== "Node"
    ) {
      builder.treeParentCandidate = null;
    }

      if (item.kind === "Coordinate") {
      if (statement.command === "node" && item.raw.trim() === "()") {
        continue;
      }

        if (builder.pendingCircleCenter) {
          const radius = parseCircleRadiusFromCoordinateRaw(expandPathItemRaw(item.raw, context));
          if (radius != null) {
            const circleTransform = resolveLengthTransform(radius.applyFrameTransform, frameTransform, builder.statementStyleChain);
            builder.activePath = emitCircleOrEllipse({
              geometry: transformCircleGeometry(radius.value, circleTransform),
              center: builder.pendingCircleCenter,
              statementId: statement.id,
              itemId: item.id,
              span: item.span,
              style: builder.style,
              styleChain: builder.statementStyleChain,
              shouldCompoundFilledSubpaths: builder.shouldCompoundFilledSubpaths,
              activePath: builder.activePath,
              geometryElements,
              markFeature
            });
            builder.pendingCircleCenter = null;
            builder.pendingCircleRadius = null;
            builder.pendingCircleRadii = null;
            builder.pendingCircleRotation = 0;
            continue;
          }
          flushPendingCircle(item.id, item.span);
        }

      if (builder.pendingEllipseCenter) {
        const parsedRadii = parseEllipseRadiiFromCoordinateRaw(expandPathItemRaw(item.raw, context));
      if (parsedRadii) {
          const ellipseTransform = resolveLengthTransform(
            parsedRadii.rx.applyFrameTransform || parsedRadii.ry.applyFrameTransform,
            frameTransform,
            builder.statementStyleChain
          );
          const geometry = transformEllipseGeometry(parsedRadii.rx.value, parsedRadii.ry.value, 0, ellipseTransform);
          markFeature("keyword_ellipse", "supported");
          builder.activePath = emitCircleOrEllipse({
            geometry: { kind: "ellipse", ...geometry },
            center: builder.pendingEllipseCenter,
            statementId: statement.id,
            itemId: item.id,
            span: item.span,
            style: builder.style,
            styleChain: builder.statementStyleChain,
            shouldCompoundFilledSubpaths: builder.shouldCompoundFilledSubpaths,
            activePath: builder.activePath,
            geometryElements,
            markFeature
          });
          builder.pendingEllipseCenter = null;
          builder.pendingEllipseRadii = null;
          builder.lastPlacementSegment = null;
          continue;
        }
      }

      if (builder.pendingArc) {
        const shorthand = parseArcShorthand(expandPathItemRaw(item.raw, context));
        if (shorthand) {
          let path: ScenePath | null = builder.activePath;
          if (!path) {
            path = makePath(statement.id, item.id, builder.style, builder.statementStyleChain, item.span);
            path.commands.push({ kind: "M", to: builder.pendingArc.from });
          }
          const appended = appendArcCommand(path.commands, builder.pendingArc.from, shorthand, frameTransform);
          builder.activePath = path;
          setCurrentPoint(appended.endpoint);
          builder.lastPlacementSegment = appended.segment;
          builder.previousSegmentRoundedCorners = builder.activeRoundedCorners;
          markFeature("keyword_arc", "supported");
          markFeature("svg_path", "supported");
          builder.pendingArc = null;
          continue;
        }
      }

      if (
        statement.command === "node" &&
        item.form === "named" &&
        builder.pendingNodeNameForNodeCommand == null &&
        shouldCaptureStandaloneNodeNameCoordinate(statement.items, index)
      ) {
        const rawName = item.x.trim();
        if (rawName.length > 0) {
          builder.pendingNodeNameForNodeCommand = rawName;
          markFeature("named_coordinates", "supported");
          continue;
        }
      }

      if (
        statement.command === "coordinate" &&
        item.form === "named" &&
        builder.pendingNamedCoordinate == null &&
        shouldCaptureStandaloneNodeNameCoordinate(statement.items, index)
      ) {
        const rawName = item.x.trim();
        if (rawName.length > 0) {
          let nextMeaningfulItem: PathStatement["items"][number] | null = null;
          for (let lookahead = index + 1; lookahead < statement.items.length; lookahead += 1) {
            const candidate = statement.items[lookahead];
            if (candidate?.kind === "PathComment") {
              continue;
            }
            nextMeaningfulItem = candidate ?? null;
            break;
          }

          const hasExplicitAtTarget = nextMeaningfulItem?.kind === "PathKeyword" && nextMeaningfulItem.keyword === "at";
          if (hasExplicitAtTarget) {
            builder.pendingNamedCoordinate = { name: rawName };
          } else {
            const fallbackPoint = builder.hasPathCurrentPoint ? (builder.currentPointLogical ?? context.currentPoint ?? defaultPathOrigin) : defaultPathOrigin;
            writeNamedCoordinate(context, applyNameScope(rawName, context), fallbackPoint);
            if (!context.currentPoint) {
              setCurrentPoint(fallbackPoint, fallbackPoint, {
                form: item.form,
                x: item.x
              });
            }
          }

          markFeature("named_coordinates", "supported");
          continue;
        }
      }

      const evaluated: EvaluatedCoordinate =
        evaluateTurnCoordinate(item, builder.currentPointLogical ?? context.currentPoint, frameTransform, builder.lastPlacementSegment) ??
        evaluateCoordinate(item, context);
      const handleKind = statement.command === "node" ? "node-position" : "path-point";
      const rewriteTargetHandleId =
        handleKind === "path-point" && evaluated.coordinateForm === "named"
          ? resolveNamedCoordinateRewriteHandleId(item.x, context)
          : undefined;
      const handle = createEditHandle(evaluated, item.span, statement.id, handleKind, context, {
        rewriteTargetHandleId
      });
      if (handle) context.editHandles.push(handle);
      for (const code of evaluated.diagnostics) {
        pushDiagnostic(code, `Coordinate evaluation issue: ${code}`, item.span.from, item.span.to);
      }
      if (!evaluated.world) {
        continue;
      }
      builder.treeParentCandidate = {
        nameRaw:
          item.form === "named" && !item.x.includes(".") && item.x.trim().length > 0
            ? item.x.trim()
            : null,
        point: evaluated.world,
        span: item.span
      };

      if (builder.pendingNamedCoordinate) {
        const scopedName = applyNameScope(builder.pendingNamedCoordinate.name, context);
        writeNamedCoordinate(context, scopedName, evaluated.world);
        if (handle && handle.rewriteMode !== "unsupported" && !handle.rewriteTargetHandleId) {
          context.namedCoordinateRewriteHandles.set(scopedName, handle.id);
        }
        builder.pendingNamedCoordinate = null;
      }

      if (builder.pendingGrid) {
        markFeature("keyword_grid", "supported");
        markFeature("svg_path", "supported");
        geometryElements.push(
          ...makeGridElements(
            statement.id,
            item.id,
            builder.pendingGrid.from,
            evaluated.world,
              builder.pendingGrid.stepX,
              builder.pendingGrid.stepY,
              builder.style,
              builder.statementStyleChain,
              item.span,
              frameTransform
            )
        );
        setCurrentPoint(evaluated.world, evaluated.world, {
          form: item.form,
          x: item.x
        });
        builder.pendingGrid = null;
        continue;
      }

      if (builder.pendingRectangleFrom) {
        markFeature("shape_rectangle", "supported");
        if (builder.shouldCompoundFilledSubpaths) {
          builder.activePath = ensurePathForSubpath(builder.activePath, statement.id, item.id, builder.style, builder.statementStyleChain, item.span);
          markPathShapeHint(builder.activePath, "rectangle");
          appendRectangleSubpath(builder.activePath.commands, builder.pendingRectangleFrom, evaluated.world, builder.activeRoundedCorners, frameTransform);
        } else {
          geometryElements.push(
            makeRectangleElement(
              statement.id,
              item.id,
                builder.pendingRectangleFrom,
                evaluated.world,
                builder.style,
                builder.statementStyleChain,
                item.span,
                builder.activeRoundedCorners,
                frameTransform
            )
          );
        }
        builder.lastPlacementSegment = {
          kind: "line",
          from: builder.pendingRectangleFrom,
          to: evaluated.world
        };
        markFeature("svg_path", "supported");
        builder.pendingRectangleFrom = null;
        setCurrentPoint(evaluated.world, evaluated.world, {
          form: item.form,
          x: item.x
        });
        context.pathStartPoint ??= evaluated.world;
        continue;
      }

      const coordinateRef: Pick<CoordinateItem, "form" | "x"> = {
        form: item.form,
        x: item.x
      };
      const sourceLogicalPoint = builder.currentPointLogical ?? context.currentPoint;
      const hasOperatorSegment = builder.currentOperator != null && context.currentPoint != null && sourceLogicalPoint != null;
      // For -| and |- operators, compute border intersections using the bend point
      // direction rather than the direct source→target direction.
      // -| means horizontal-then-vertical: bend at (target.x, source.y)
      // |- means vertical-then-horizontal: bend at (source.x, target.y)
      const sourceBorderRef = hasOperatorSegment && builder.currentOperator === "-|"
        ? wp(evaluated.world.x, sourceLogicalPoint.y)
        : hasOperatorSegment && builder.currentOperator === "|-"
          ? wp(sourceLogicalPoint.x, evaluated.world.y)
          : evaluated.world;
      const targetBorderRef = hasOperatorSegment && builder.currentOperator === "-|"
        ? wp(evaluated.world.x, sourceLogicalPoint.y)
        : hasOperatorSegment && builder.currentOperator === "|-"
          ? wp(sourceLogicalPoint.x, evaluated.world.y)
          : sourceLogicalPoint;
      const pathSourcePoint = hasOperatorSegment
        ? builder.currentPointCoordinate
          ? maybeResolveNamedCoordinateBorderPoint(builder.currentPointCoordinate, sourceLogicalPoint, sourceBorderRef, context)
          : sourceLogicalPoint
        : null;
      const pathTargetPoint = hasOperatorSegment
        ? maybeResolveNamedCoordinateBorderPoint(item, evaluated.world, targetBorderRef, context)
        : evaluated.world;
      const advancedPoint = hasOperatorSegment ? pathTargetPoint : evaluated.world;
      if (!hasOperatorSegment && builder.pendingSegmentPlacements.length > 0) {
        for (const pending of builder.pendingSegmentPlacements) {
          writeNamedCoordinate(context, applyNameScope(pending.name, context), evaluated.world);
        }
        builder.pendingSegmentPlacements = [];
      }

      if (!builder.activePath) {
        builder.activePath = makePath(statement.id, item.id, builder.style, builder.statementStyleChain, statement.span);
        if (hasOperatorSegment && pathSourcePoint) {
          builder.activePath.commands.push({ kind: "M", to: pathSourcePoint });
          const appended = appendPathPoint(
            builder.activePath.commands,
            builder.currentOperator,
            pathSourcePoint,
            pathTargetPoint,
            builder.previousSegmentRoundedCorners,
            builder.activeRoundedCorners
          );
          builder.lastPlacementSegment = appended.segment;
          flushPendingSegmentNodes(appended.segment);
          flushPendingSegmentPlacements(appended.segment);
          flushPendingSegmentPics(appended.segment);
          builder.previousSegmentRoundedCorners = appended.nextRoundedCorners;
          context.pathStartPoint = pathSourcePoint;
        } else {
          builder.activePath.commands.push({ kind: "M", to: pathTargetPoint });
          context.pathStartPoint = pathTargetPoint;
          builder.lastPlacementSegment = null;
          builder.previousSegmentRoundedCorners = null;
        }
        markFeature("svg_path", "supported");
      } else if (!builder.currentOperator) {
        builder.activePath.commands.push({ kind: "M", to: pathTargetPoint });
        context.pathStartPoint = pathTargetPoint;
        builder.lastPlacementSegment = null;
        builder.previousSegmentRoundedCorners = null;
      } else if (hasOperatorSegment && pathSourcePoint) {
        const lastCommand = builder.activePath.commands[builder.activePath.commands.length - 1];
        if (lastCommand?.kind === "M") {
          lastCommand.to = pathSourcePoint;
          context.pathStartPoint = pathSourcePoint;
        } else {
          const lastPoint =
            lastCommand?.kind === "L" || lastCommand?.kind === "C"
              ? lastCommand.to
              : null;
          if (!lastPoint || !pointsClose(lastPoint, pathSourcePoint)) {
            builder.activePath.commands.push({ kind: "M", to: pathSourcePoint });
            context.pathStartPoint = pathSourcePoint;
          }
        }
        const appended = appendPathPoint(
          builder.activePath.commands,
          builder.currentOperator,
          pathSourcePoint,
          pathTargetPoint,
          builder.previousSegmentRoundedCorners,
          builder.activeRoundedCorners
        );
        builder.lastPlacementSegment = appended.segment;
        flushPendingSegmentNodes(appended.segment);
        flushPendingSegmentPlacements(appended.segment);
        flushPendingSegmentPics(appended.segment);
        builder.previousSegmentRoundedCorners = appended.nextRoundedCorners;
      } else {
        builder.activePath.commands.push({ kind: "M", to: pathTargetPoint });
        context.pathStartPoint = pathTargetPoint;
        builder.lastPlacementSegment = null;
        builder.previousSegmentRoundedCorners = null;
      }

      const shouldAdvancePoint = item.relativePrefix ? item.relativePrefix === "++" : true;
      if (shouldAdvancePoint) {
        setCurrentPoint(advancedPoint, evaluated.world, coordinateRef);
      } else if (context.currentPoint) {
        setCurrentPoint(context.currentPoint, advancedPoint, builder.currentPointCoordinate);
      }
      if (!context.currentPoint) {
        setCurrentPoint(advancedPoint, evaluated.world, coordinateRef);
      }
      builder.currentOperator = null;
      continue;
    }

      if (item.kind === "PathKeyword") {
        if (builder.pendingCircleCenter) {
          flushPendingCircle(item.id, item.span);
        }

      if (item.keyword === "--" || item.keyword === "-|" || item.keyword === "|-") {
        builder.currentOperator = item.keyword;
        markFeature("path_operators_basic", "supported");
        continue;
      }

      if (item.keyword === "..") {
        const parsedCurve = parseBezierFromItems(statement.items, index, context);
        if (!parsedCurve) {
          markFeature("path_operator_curves", "unsupported");
          pushDiagnostic(
            "unsupported-path-operator",
            "Curve operator `..` currently supports only `.. controls (...) [and (...)] .. [node ...] (...)` patterns.",
            item.span.from,
            item.span.to
          );
          continue;
        }

        if (!builder.activePath) {
          if (!context.currentPoint) {
            markFeature("path_operator_curves", "unsupported");
            pushDiagnostic("curve-without-start", "Curve operator requires a current point.", item.span.from, item.span.to);
            index = parsedCurve.consumedIndex;
            continue;
          }
          builder.activePath = makePath(statement.id, item.id, builder.style, builder.statementStyleChain, statement.span);
          builder.activePath.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        for (const code of parsedCurve.control1Evaluation.diagnostics) {
          pushDiagnostic(code, `Coordinate evaluation issue: ${code}`, parsedCurve.control1Coordinate.span.from, parsedCurve.control1Coordinate.span.to);
        }
        if (parsedCurve.control2Coordinate && parsedCurve.control2Evaluation) {
          for (const code of parsedCurve.control2Evaluation.diagnostics) {
            pushDiagnostic(code, `Coordinate evaluation issue: ${code}`, parsedCurve.control2Coordinate.span.from, parsedCurve.control2Coordinate.span.to);
          }
        }
        if (parsedCurve.endCoordinate && parsedCurve.endEvaluation) {
          for (const code of parsedCurve.endEvaluation.diagnostics) {
            pushDiagnostic(code, `Coordinate evaluation issue: ${code}`, parsedCurve.endCoordinate.span.from, parsedCurve.endCoordinate.span.to);
          }
        }

        if (!parsedCurve.endPoint) {
          markFeature("path_operator_curves", "unsupported");
          pushDiagnostic("invalid-curve-target", "Failed to evaluate curve control or target point.", item.span.from, item.span.to);
          index = parsedCurve.consumedIndex;
          continue;
        }

        const addCurveHandle = (
          coordinate: CoordinateItem | undefined,
          evaluated: EvaluatedCoordinate | undefined,
          kind: "path-control" | "path-point"
        ) => {
          if (!coordinate || !evaluated) {
            return;
          }
          const rewriteTargetHandleId =
            evaluated.coordinateForm === "named"
              ? resolveNamedCoordinateRewriteHandleId(coordinate.x, context)
              : undefined;
          const handle = createEditHandle(evaluated, coordinate.span, statement.id, kind, context, {
            rewriteTargetHandleId
          });
          if (handle) {
            context.editHandles.push(handle);
          }
        };

        addCurveHandle(parsedCurve.control1Coordinate, parsedCurve.control1Evaluation, "path-control");
        addCurveHandle(parsedCurve.control2Coordinate, parsedCurve.control2Evaluation, "path-control");
        addCurveHandle(parsedCurve.endCoordinate, parsedCurve.endEvaluation, "path-point");

        const curveFrom = context.currentPoint;
        builder.activePath.commands.push({
          kind: "C",
          c1: parsedCurve.control1,
          c2: parsedCurve.control2,
          to: parsedCurve.endPoint
        });
        const curveSegment: PlacementSegment | null =
          curveFrom
            ? {
                kind: "cubic",
                from: curveFrom,
                c1: parsedCurve.control1,
                c2: parsedCurve.control2,
                to: parsedCurve.endPoint
              }
            : null;
        if (curveSegment) {
          builder.lastPlacementSegment = curveSegment;
        }
        builder.previousSegmentRoundedCorners = builder.activeRoundedCorners;
        markFeature("path_operator_curves", "supported");
        markFeature("keyword_controls", "supported");
        if (parsedCurve.usedAnd) {
          markFeature("keyword_and", "supported");
        }
        markFeature("svg_path", "supported");

        for (const node of parsedCurve.nodes) {
          const resolvedNode = evaluateNodeItem(
            node,
            statement,
            context,
            builder.style,
            markFeature,
            pushDiagnostic,
            curveSegment,
            undefined,
            0.5,
            undefined,
            builder.statementStyleChain
          );
          behindNodeElements.push(...resolvedNode.behindElements);
          frontNodeElements.push(...resolvedNode.frontElements);
        }

        if (parsedCurve.endAdvancesCurrentPoint) {
          setCurrentPoint(parsedCurve.endPoint);
        }
        if (parsedCurve.endClosesPath) {
          builder.activePath.commands.push({ kind: "Z" });
          if (hasDrawablePathSegments(builder.activePath)) {
            geometryElements.push(builder.activePath);
          }
          builder.activePath = null;
          builder.previousSegmentRoundedCorners = null;
          if (context.pathStartPoint) {
            setCurrentPoint(context.pathStartPoint);
          }
          builder.lastPlacementSegment = null;
          markFeature("path_cycle", "supported");
        }
        builder.currentOperator = null;
        index = parsedCurve.consumedIndex;
        continue;
      }

      if (item.keyword === "cycle") {
        if (builder.activePath) {
          const logicalCurrentPoint = builder.currentPointLogical ?? context.currentPoint;
          if (logicalCurrentPoint && context.pathStartPoint) {
            const closingFrom = logicalCurrentPoint;
            const pathStart = context.pathStartPoint;
            const operator: "--" | "-|" | "|-" = builder.currentOperator ?? "--";
            const appended = appendPathPoint(
              builder.activePath.commands,
              operator,
              closingFrom,
              pathStart,
              builder.previousSegmentRoundedCorners,
              builder.activeRoundedCorners
            );
            builder.previousSegmentRoundedCorners = appended.nextRoundedCorners;
            setCurrentPoint(pathStart);
            roundClosedPathStartCorner(builder.activePath.commands, closingFrom, pathStart, builder.activeRoundedCorners);
          }
          builder.activePath.commands.push({ kind: "Z" });
          if (builder.shouldCompoundFilledSubpaths) {
            builder.previousSegmentRoundedCorners = null;
          } else {
            if (hasDrawablePathSegments(builder.activePath)) {
              geometryElements.push(builder.activePath);
            }
            builder.activePath = null;
            builder.previousSegmentRoundedCorners = null;
          }
          markFeature("path_cycle", "supported");
        }
        if (context.pathStartPoint) {
          setCurrentPoint(context.pathStartPoint);
        }
        builder.lastPlacementSegment = null;
        builder.currentOperator = null;
        continue;
      }

      if (item.keyword === "rectangle") {
        const rectangleStart = builder.currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveRectangleStart = builder.hasPathCurrentPoint ? rectangleStart : defaultPathOrigin;
        if (!context.currentPoint && !builder.currentPointLogical) {
          setCurrentPoint(effectiveRectangleStart);
        }
        if (!builder.shouldCompoundFilledSubpaths) {
          builder.activePath = flushDrawableActivePath(geometryElements, builder.activePath);
        }
        builder.previousSegmentRoundedCorners = null;
        builder.pendingRectangleFrom = effectiveRectangleStart;
        builder.lastPlacementSegment = null;
        markFeature("shape_rectangle", "supported");
        continue;
      }

      if (item.keyword === "circle") {
        const circleCenter = builder.currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveCircleCenter = builder.hasPathCurrentPoint ? circleCenter : defaultPathOrigin;
        if (!context.currentPoint && !builder.currentPointLogical) {
          setCurrentPoint(effectiveCircleCenter);
        }
        if (!builder.shouldCompoundFilledSubpaths) {
          builder.activePath = flushDrawableActivePath(geometryElements, builder.activePath);
        }
        builder.previousSegmentRoundedCorners = null;
        builder.pendingCircleCenter = effectiveCircleCenter;
        builder.pendingCircleRadius = null;
        builder.pendingCircleRadii = null;
        builder.pendingCircleRotation = 0;
        builder.lastPlacementSegment = null;
        markFeature("shape_circle", "supported");
        continue;
      }

      if (item.keyword === "ellipse") {
        const ellipseCenter = builder.currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveEllipseCenter = builder.hasPathCurrentPoint ? ellipseCenter : defaultPathOrigin;
        if (!context.currentPoint && !builder.currentPointLogical) {
          setCurrentPoint(effectiveEllipseCenter);
        }
        if (!builder.shouldCompoundFilledSubpaths) {
          builder.activePath = flushDrawableActivePath(geometryElements, builder.activePath);
        }
        builder.previousSegmentRoundedCorners = null;
        builder.pendingEllipseCenter = effectiveEllipseCenter;
        builder.pendingEllipseRadii = null;
        builder.lastPlacementSegment = null;
        markFeature("keyword_ellipse", "supported");
        markFeature("shape_ellipse", "supported");
        continue;
      }

      if (item.keyword === "arc") {
        const arcStart = builder.currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveArcStart = builder.hasPathCurrentPoint ? arcStart : defaultPathOrigin;
        if (!context.currentPoint && !builder.currentPointLogical) {
          setCurrentPoint(effectiveArcStart);
        }
        builder.pendingArc = { from: effectiveArcStart };
        builder.lastPlacementSegment = null;
        markFeature("keyword_arc", "supported");
        continue;
      }

      if (item.keyword === "grid") {
        const gridStart = builder.currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveGridStart = builder.hasPathCurrentPoint ? gridStart : defaultPathOrigin;
        if (!context.currentPoint && !builder.currentPointLogical) {
          setCurrentPoint(effectiveGridStart);
        }
        builder.activePath = flushDrawableActivePath(geometryElements, builder.activePath);
        builder.previousSegmentRoundedCorners = null;
        const gridStepDefaults = extractGridStepsFromOptionLists(
          builder.statementStyleChain.flatMap((entry) => entry.rawOptions),
          pushDiagnostic,
          builder.treeFrameState.macroBindings,
          builder.treeFrameState.transform
        );
        builder.pendingGrid = {
          from: effectiveGridStart,
          stepX: gridStepDefaults?.stepX ?? resolveDefaultGridStep(builder.treeFrameState.transform, "x"),
          stepY: gridStepDefaults?.stepY ?? resolveDefaultGridStep(builder.treeFrameState.transform, "y")
        };
        builder.lastPlacementSegment = null;
        continue;
      }

      if (item.keyword === "coordinates") {
        pushDiagnostic(
          "unsupported-path-keyword",
          "Path keyword `coordinates` is currently implemented only as part of a typed `plot` operation.",
          item.span.from,
          item.span.to
        );
        continue;
      }

      if (item.keyword === "parabola") {
        if (!context.currentPoint) {
          pushDiagnostic("parabola-without-start", "Parabola keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }

        const parsed = parseParabolaFromItems(statement.items, index, context);
        if (!parsed) {
          pushDiagnostic("invalid-parabola", "Parabola requires a target coordinate or `cycle`.", item.span.from, item.span.to);
          continue;
        }

        if (!builder.activePath) {
          builder.activePath = makePath(statement.id, item.id, builder.style, builder.statementStyleChain, statement.span);
          builder.activePath.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        for (const command of parsed.commands) {
          builder.activePath.commands.push(command);
        }
        builder.previousSegmentRoundedCorners = builder.activeRoundedCorners;
        const lastCommand = parsed.commands[parsed.commands.length - 1];
        if (lastCommand?.kind === "C") {
          const previousCommand = parsed.commands.length > 1 ? parsed.commands[parsed.commands.length - 2] : null;
          const from = previousCommand?.kind === "C" ? previousCommand.to : context.currentPoint;
          if (from) {
            builder.lastPlacementSegment = {
              kind: "cubic",
              from,
              c1: lastCommand.c1,
              c2: lastCommand.c2,
              to: lastCommand.to
            };
          }
        }
        setCurrentPoint(parsed.endPoint);
        markFeature("svg_path", "supported");
        index = parsed.consumedIndex;
        builder.currentOperator = null;
        continue;
      }

      if (item.keyword === "sin" || item.keyword === "cos") {
        if (!context.currentPoint) {
          pushDiagnostic(`${item.keyword}-without-start`, `\`${item.keyword}\` requires a current point.`, item.span.from, item.span.to);
          continue;
        }

        const targetItem = statement.items[index + 1];
        if (targetItem?.kind !== "Coordinate") {
          pushDiagnostic(`invalid-${item.keyword}-target`, `\`${item.keyword}\` requires a following coordinate target.`, item.span.from, item.span.to);
          continue;
        }

        const evaluatedTarget = evaluateCoordinate(targetItem, context);
        for (const code of evaluatedTarget.diagnostics) {
          pushDiagnostic(code, `${item.keyword} target issue: ${code}`, targetItem.span.from, targetItem.span.to);
        }
        if (!evaluatedTarget.world) {
          index += 1;
          continue;
        }

        let path: ScenePath | null = builder.activePath;
        if (!path) {
          path = makePath(statement.id, item.id, builder.style, builder.statementStyleChain, statement.span);
          path.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        const from = context.currentPoint;
        const to = maybeResolveNamedCoordinateBorderPoint(targetItem, evaluatedTarget.world, from, context);
        const segment = appendSinCosSegment(path.commands, from, to, item.keyword);
        builder.activePath = path;
        builder.lastPlacementSegment = segment;
        builder.previousSegmentRoundedCorners = builder.activeRoundedCorners;
        markFeature("path_operator_curves", "supported");
        markFeature("svg_path", "supported");

        if (evaluatedTarget.advancesCurrentPoint) {
          setCurrentPoint(to, evaluatedTarget.world, {
            form: targetItem.form,
            x: targetItem.x
          });
        } else if (!context.currentPoint) {
          setCurrentPoint(to, evaluatedTarget.world, {
            form: targetItem.form,
            x: targetItem.x
          });
        }

        builder.currentOperator = null;
        index += 1;
        continue;
      }

      if (item.keyword === "controls" || item.keyword === "and") {
        if (item.keyword === "controls") {
          markFeature("keyword_controls", "unsupported");
        } else {
          markFeature("keyword_and", "unsupported");
        }
        pushDiagnostic(
          "unsupported-path-keyword",
          `Path keyword \`${item.keyword}\` is parsed but not semantically implemented yet.`,
          item.span.from,
          item.span.to
        );
      }

      if (item.keyword === "edge") {
        markFeature("edge_operation", "unsupported");
        markFeature("keyword_edge", "unsupported");
        pushDiagnostic(
          "invalid-edge-operation",
          "`edge` operation requires a target coordinate.",
          item.span.from,
          item.span.to
        );
      }

      if (item.keyword === "bend") {
        pushDiagnostic(
          "unsupported-path-keyword",
          `Path keyword \`${item.keyword}\` is parsed but not semantically implemented yet.`,
          item.span.from,
          item.span.to
        );
      }

      continue;
    }

    if (item.kind === "PlotOperation" || item.kind === "PathOption") {
      const mappedHandler = itemHandlers.get(item.kind);
      if (mappedHandler) {
        mappedHandler(item);
      }
      continue;
    }

    if (item.kind === "ChildOperation") {
      const handled = handleChildOperationCluster({
        statement,
        index,
        treeParentCandidate: builder.treeParentCandidate,
        treeFrameState: builder.treeFrameState,
        context,
        defaultPathOrigin,
        drawEdgeOptions,
        edgeFromParentStyleOptions,
        markFeature,
        pushDiagnostic,
        emittedTreeHookDiagnostics,
        evaluatePathStatement,
        frontNodeElements,
        evaluateRawCoordinateWorld: (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world
      });
      if (handled.consumed <= 0) {
        continue;
      }
      builder.treeParentCandidate = handled.treeParentCandidate;
      index += handled.consumed - 1;
      continue;
    }

    if (
      item.kind === "Node" ||
      item.kind === "PicOperation" ||
      item.kind === "DecorateOperation" ||
      item.kind === "CoordinateOperation"
    ) {
      const mappedHandler = itemHandlers.get(item.kind);
      if (mappedHandler) {
        mappedHandler(item);
      }
      continue;
    }

    const tailHandler = itemHandlers.get(item.kind);
    if (tailHandler) {
      tailHandler(item);
      continue;
    }
  }

  if (builder.pendingCircleCenter) {
    flushPendingCircle(statement.id, statement.span);
  }

  if (builder.pendingEllipseCenter) {
    const radii = builder.pendingEllipseRadii ?? {
      rx: { value: DEFAULT_GRID_STEP, applyFrameTransform: true },
      ry: { value: DEFAULT_GRID_STEP, applyFrameTransform: true }
    };
    const ellipseTransform = resolveLengthTransform(
      radii.rx.applyFrameTransform || radii.ry.applyFrameTransform,
      frameTransform,
      builder.statementStyleChain
    );
    const geometry = transformEllipseGeometry(radii.rx.value, radii.ry.value, 0, ellipseTransform);
    builder.activePath = emitCircleOrEllipse({
      geometry: { kind: "ellipse", ...geometry },
      center: builder.pendingEllipseCenter,
      statementId: statement.id,
      itemId: statement.id,
      span: statement.span,
      style: builder.style,
      styleChain: builder.statementStyleChain,
      shouldCompoundFilledSubpaths: builder.shouldCompoundFilledSubpaths,
      activePath: builder.activePath,
      geometryElements,
      markFeature
    });
    builder.lastPlacementSegment = null;
  }

  if (builder.pendingArc) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires either option parameters or shorthand coordinates.", statement.span.from, statement.span.to);
  }

  if (builder.activePath && hasDrawablePathSegments(builder.activePath)) {
    geometryElements.push(builder.activePath);
  }

  const preActionElements: SceneElement[] = [];
  const postActionElements: SceneElement[] = [];
  for (const preAction of builder.style.decorationPreActions) {
    markFeature("decorate_option", "supported");
    preActionElements.push(
      ...decoratePathElements(geometryElements, preAction, "collect", statement.id, context.mathRandom, markFeature, pushDiagnostic)
    );
  }
  for (const postAction of builder.style.decorationPostActions) {
    markFeature("decorate_option", "supported");
    postActionElements.push(
      ...decoratePathElements(geometryElements, postAction, "collect", statement.id, context.mathRandom, markFeature, pushDiagnostic)
    );
  }

  let mainGeometry = geometryElements;
  if (builder.style.decoration.enabled) {
    markFeature("decorate_option", "supported");
    mainGeometry = decoratePathElements(
      geometryElements,
      builder.style.decoration,
      "replace",
      statement.id,
      context.mathRandom,
      markFeature,
      pushDiagnostic
    );
  }
  const currentPathBounds = computeBounds(geometryElements);
  const inheritedClipChain = frame.clipChain;
  let outputClipChain = inheritedClipChain;

  if (builder.style.clip) {
    markFeature("path_clipping", "supported");
    const clipPath = buildClipPath(statement, geometryElements, builder.style.fillRule);
    if (clipPath) {
      outputClipChain = [...inheritedClipChain, clipPath];
      frame.clipChain = outputClipChain;
    }
    if (currentPathBounds) {
      extendPictureBounds(context, currentPathBounds);
    }
    frame.pictureSizeRelevant = false;
  }

  if (builder.style.useAsBoundingBox) {
    markFeature("use_as_bounding_box", "supported");
    if (currentPathBounds) {
      extendPictureBounds(context, currentPathBounds);
    }
    frame.pictureSizeRelevant = false;
  }

  let statementElements = [...preActionElements, ...behindNodeElements, ...mainGeometry, ...frontNodeElements, ...postActionElements];
  statementElements = attachClipChainToElements(statementElements, outputClipChain);
  if (!builder.style.clip && !builder.style.useAsBoundingBox && frame.pictureSizeRelevant) {
    extendPictureBounds(context, computeBounds(statementElements));
  }

  return statementElements;
}

function buildClipPath(
  statement: PathStatement,
  geometryElements: readonly SceneElement[],
  fillRule: ResolvedStyle["fillRule"]
): SceneClipPath | null {
  const commands: ScenePathCommand[] = [];
  for (const element of geometryElements) {
    commands.push(...toClipCommands(element));
  }
  if (!commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A")) {
    return null;
  }
  return {
    id: `scene-clip:${statement.id}`,
    sourceRef: {
      sourceId: statement.id,
      sourceSpan: statement.span,
      sourceFingerprint: ""
    },
    commands,
    fillRule
  };
}

function toClipCommands(element: SceneElement): ScenePathCommand[] {
  if (element.kind === "Path") {
    return clonePathCommands(element.commands);
  }

  if (element.kind === "Circle") {
    const commands: ScenePathCommand[] = [];
    appendEllipseSubpath(commands, element.center, element.radius, element.radius, 0);
    return commands;
  }

  if (element.kind === "Ellipse") {
    const commands: ScenePathCommand[] = [];
    appendEllipseSubpath(commands, element.center, element.rx, element.ry, element.rotation ?? 0);
    return commands;
  }

  return [];
}

function clonePathCommands(commands: readonly ScenePathCommand[]): ScenePathCommand[] {
  return commands.map((command) => {
    if (command.kind === "Z") {
      return { kind: "Z" };
    }
    if (command.kind === "M" || command.kind === "L") {
      return { kind: command.kind, to: { ...command.to } };
    }
    if (command.kind === "C") {
      return {
        kind: "C",
        c1: { ...command.c1 },
        c2: { ...command.c2 },
        to: { ...command.to }
      };
    }
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: { ...command.to }
    };
  });
}

function attachClipChainToElements(elements: readonly SceneElement[], clipChain: readonly SceneClipPath[]): SceneElement[] {
  return elements.map((element) => ({
    ...element,
    clipChain: clipChain.map((clipPath) => ({
      ...clipPath,
      sourceRef: { ...clipPath.sourceRef },
      commands: clonePathCommands(clipPath.commands)
    }))
  }));
}

function extendPictureBounds(context: SemanticContext, bounds: WorldBounds | undefined): void {
  if (!bounds) {
    return;
  }
  if (!context.pictureBounds) {
    context.pictureBounds = worldBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    return;
  }
  context.pictureBounds = wb(
    Math.min(context.pictureBounds.minX, bounds.minX),
    Math.min(context.pictureBounds.minY, bounds.minY),
    Math.max(context.pictureBounds.maxX, bounds.maxX),
    Math.max(context.pictureBounds.maxY, bounds.maxY)
  );
}

function resolveLengthTransform(
  applyFrameTransform: boolean,
  frameTransform: { a: number; b: number; c: number; d: number },
  styleChain: StyleChainEntry[]
): { a: number; b: number; c: number; d: number } {
  if (applyFrameTransform) {
    return frameTransform;
  }
  return explicitLengthNeedsFrameTransform(styleChain) ? frameTransform : identityMatrix();
}

function explicitLengthNeedsFrameTransform(styleChain: StyleChainEntry[]): boolean {
  for (const layer of styleChain) {
    for (const optionList of layer.rawOptions) {
      for (const entry of optionList.entries) {
        if (entry.kind !== "kv") {
          continue;
        }
        if (
          entry.key === "scale" ||
          entry.key === "xscale" ||
          entry.key === "yscale" ||
          entry.key === "rotate" ||
          entry.key === "rotate around" ||
          entry.key === "/tikz/rotate around" ||
          entry.key === "cm" ||
          entry.key === "/tikz/cm"
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function resolveNamedCoordinateRewriteHandleId(rawName: string, context: SemanticContext): string | undefined {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const scoped = applyNameScope(trimmed, context);
  const candidates = scoped === trimmed ? [trimmed] : [scoped, trimmed];
  for (const candidate of candidates) {
    const handleId = context.namedCoordinateRewriteHandles.get(candidate);
    if (handleId) {
      return handleId;
    }
  }
  return undefined;
}

function mergeToLikePathOptions<T extends ToOperationItem | EdgeOperationItem>(
  item: T,
  leadingOptions: OptionListAst | undefined
): T {
  if (!leadingOptions || !item.options) {
    if (!leadingOptions) {
      return item;
    }
    return {
      ...item,
      options: leadingOptions,
      optionsSpan: leadingOptions.span
    };
  }

  return {
    ...item,
    options: mergeOptionLists(leadingOptions, item.options),
    optionsSpan: {
      from: Math.min(leadingOptions.span.from, item.options.span.from),
      to: Math.max(leadingOptions.span.to, item.options.span.to)
    }
  };
}

function hasExplicitNodeAtSyntax(items: PathItem[], nodeIndex: number): boolean {
  let meaningfulSeen = 0;
  for (let index = nodeIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "PathComment" || item.kind === "PathOption") {
      continue;
    }

    if (meaningfulSeen === 0) {
      if (item.kind !== "Coordinate") {
        return false;
      }
      meaningfulSeen = 1;
      continue;
    }

    return item.kind === "PathKeyword" && item.keyword === "at";
  }
  return false;
}

function resolveScopedAutoSide(styleChain: StyleTraceLayerInput[]): "left" | "right" | null {
  let autoSide: "left" | "right" | null = null;
  let swap = false;

  for (const entry of styleChain) {
    for (const optionList of entry.rawOptions) {
      for (const option of optionList.entries) {
        if (option.kind === "flag") {
          if (option.key === "auto") {
            autoSide = "left";
          } else if (option.key === "swap") {
            swap = !swap;
          }
          continue;
        }

        if (option.kind !== "kv") {
          continue;
        }

        if (option.key === "auto") {
          const normalized = option.valueRaw.trim().toLowerCase();
          if (normalized === "right") {
            autoSide = "right";
          } else if (
            normalized === "left" ||
            normalized === "true" ||
            normalized === "yes" ||
            normalized === "on" ||
            normalized === "1"
          ) {
            autoSide = "left";
          } else if (
            normalized === "false" ||
            normalized === "no" ||
            normalized === "off" ||
            normalized === "0"
          ) {
            autoSide = null;
          }
          continue;
        }

        if (option.key === "swap") {
          const normalized = option.valueRaw.trim().toLowerCase();
          if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
            swap = true;
          } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
            swap = false;
          }
        }
      }
    }
  }

  if (autoSide == null) {
    return null;
  }

  return swap ? (autoSide === "left" ? "right" : "left") : autoSide;
}

function mergeOptionLists(left: OptionListAst | undefined, right: OptionListAst | undefined): OptionListAst | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return {
    span: {
      from: Math.min(left.span.from, right.span.from),
      to: Math.max(left.span.to, right.span.to)
    },
    raw: `${left.raw}, ${right.raw}`,
    entries: [...left.entries, ...right.entries]
  };
}

function isMatrixNodeOptions(options: NodeItem["options"] | undefined): boolean {
  for (const entry of options?.entries ?? []) {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "matrix" || entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      return true;
    }
  }
  return false;
}

function expandPathItemRaw(raw: string, context: SemanticContext): string {
  const frame = context.stack[context.stack.length - 1];
  return expandMacroBindings(raw, frame.macroBindings, { trace: context.macroTraceCollector ?? undefined });
}
