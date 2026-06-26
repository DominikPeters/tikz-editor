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

export function evaluatePathStatement(
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  options: PathEvaluationOptions = {}
): SceneElement[] {
  const geometryElements: SceneElement[] = [];
  const behindNodeElements: SceneElement[] = [];
  const frontNodeElements: SceneElement[] = [];
  let activePath: ScenePath | null = null;
  let currentOperator: "--" | "-|" | "|-" | null = null;
  let activeRoundedCorners = style.roundedCorners;
  let pendingRectangleFrom: WorldPoint | null = null;
  let pendingCircleCenter: WorldPoint | null = null;
  let pendingCircleRadius: { value: number; applyFrameTransform: boolean } | null = null;
  let pendingCircleRadii:
    | {
        rx: { value: number; applyFrameTransform: boolean };
        ry: { value: number; applyFrameTransform: boolean };
      }
    | null = null;
  let pendingCircleRotation = 0;
  let pendingEllipseCenter: WorldPoint | null = null;
  let pendingEllipseRadii:
    | {
        rx: { value: number; applyFrameTransform: boolean };
        ry: { value: number; applyFrameTransform: boolean };
      }
    | null = null;
  let pendingArc: { from: WorldPoint } | null = null;
  let pendingGrid: { from: WorldPoint; stepX: number; stepY: number } | null = null;
  let pendingNamedCoordinate: { name: string } | null = null;
  let pendingSegmentPlacements: Array<{ name: string; fraction: number }> = [];
  let pendingSegmentNodes: NodeItem[] = [];
  let pendingSegmentPics: Array<{ item: PicOperationItem; fraction: number }> = [];
  let pendingNodeNameForNodeCommand: string | null = null;
  let lastPlacementSegment: PlacementSegment | null = null;
  let previousSegmentRoundedCorners: number | null = null;
  let leadingToLikeOptions: OptionListAst | undefined;
  let currentPointLogical: WorldPoint | null = context.currentPoint;
  let currentPointCoordinate: Pick<CoordinateItem, "form" | "x"> | null = null;
  let pendingEdgeStartCoordinateRaw: string | null = null;
  let edgeOperationStart: { point: WorldPoint; coordinateRaw: string | null } | null = null;
  let treeParentCandidate: { nameRaw: string | null; point: WorldPoint; span: { from: number; to: number } } | null = null;
  let sawNonLeadingPathItem = false;
  const emittedTreeHookDiagnostics = new Set<string>();
  const honorInitialCurrentPoint = options.honorInitialCurrentPoint === true;
  if (!honorInitialCurrentPoint) {
    // Each standalone TikZ path starts from a fresh current point; leaking the
    // previous statement's endpoint breaks node placement for node-only paths.
    context.currentPoint = null;
    context.pathStartPoint = null;
  }
  let hasPathCurrentPoint = honorInitialCurrentPoint && context.currentPoint != null;
  const frame = context.stack[context.stack.length - 1];
  let treeFrameState = frame;
  const frameTransform = frame.transform;
  let statementStyleChain = frame.styleChain;
  let plotSettings = applyPlotSettingsFromStyleChain(
    createDefaultPlotSettings(),
    statementStyleChain,
    treeFrameState.macroBindings
  );
  const pointsClose = (left: WorldPoint, right: WorldPoint): boolean => Math.hypot(left.x - right.x, left.y - right.y) <= 1e-6;
  const defaultPathOrigin = applyMatrix(frameTransform, wp(0, 0));
  const setCurrentPoint = (
    point: WorldPoint | null,
    logicalPoint: WorldPoint | null = point,
    coordinate: Pick<CoordinateItem, "form" | "x"> | null = null
  ): void => {
    context.currentPoint = point;
    if (!point) {
      currentPointLogical = null;
      currentPointCoordinate = null;
      return;
    }
    currentPointLogical = logicalPoint ?? point;
    currentPointCoordinate = coordinate;
    hasPathCurrentPoint = true;
  };
  const flushPendingSegmentPlacements = (segment: PlacementSegment | null): void => {
    if (!segment || pendingSegmentPlacements.length === 0) {
      return;
    }
    for (const pending of pendingSegmentPlacements) {
      const point = pointAtPlacementSegment(segment, pending.fraction);
      writeNamedCoordinate(context, applyNameScope(pending.name, context), point);
    }
    pendingSegmentPlacements = [];
  };
  const flushPendingSegmentNodes = (segment: PlacementSegment | null): void => {
    if (!segment || pendingSegmentNodes.length === 0) {
      return;
    }

    for (const node of pendingSegmentNodes) {
      const scopedAutoSide = resolveScopedAutoSide(statementStyleChain);
      const nodeOptionsWithScopedAuto =
        scopedAutoSide != null
          ? mergeOptionLists(parseOptionListRaw(`[auto=${scopedAutoSide}]`, node.span.from), node.options)
          : node.options;
      const resolvedNode = evaluateNodeItem(
        nodeOptionsWithScopedAuto === node.options ? node : { ...node, options: nodeOptionsWithScopedAuto, optionsSpan: nodeOptionsWithScopedAuto?.span },
        statement,
        context,
        style,
        markFeature,
        pushDiagnostic,
        segment,
        undefined,
        0.5,
        undefined,
        statementStyleChain
      );
      behindNodeElements.push(...resolvedNode.behindElements);
      frontNodeElements.push(...resolvedNode.frontElements);
    }
    pendingSegmentNodes = [];
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
    if (!segment || pendingSegmentPics.length === 0) {
      return;
    }
    for (const pending of pendingSegmentPics) {
      emitPicOperation(pending.item, pointAtPlacementSegment(segment, pending.fraction), segment);
    }
    pendingSegmentPics = [];
  };
  const flushPendingCircle = (sourceId: string, span: Span): void => {
    if (!pendingCircleCenter) {
      return;
    }
    const fallbackRadius = pendingCircleRadius ?? (style.radius != null ? { value: style.radius, applyFrameTransform: true } : null);
    if (fallbackRadius != null) {
      const circleTransform = resolveLengthTransform(
        fallbackRadius.applyFrameTransform,
        frameTransform,
        statementStyleChain
      );
      activePath = emitCircleOrEllipse({
        geometry: transformCircleGeometry(fallbackRadius.value, circleTransform),
        center: pendingCircleCenter,
        statementId: statement.id,
        itemId: sourceId,
        span,
        style,
        styleChain: statementStyleChain,
        shouldCompoundFilledSubpaths,
        activePath,
        geometryElements,
        markFeature
      });
    } else {
      const fallbackRadii = pendingCircleRadii ?? {
        rx: { value: style.xRadius ?? DEFAULT_GRID_STEP, applyFrameTransform: true },
        ry: { value: style.yRadius ?? DEFAULT_GRID_STEP, applyFrameTransform: true }
      };
      const ellipseTransform = resolveLengthTransform(
        fallbackRadii.rx.applyFrameTransform || fallbackRadii.ry.applyFrameTransform,
        frameTransform,
        statementStyleChain
      );
      activePath = emitCircleOrEllipse({
        geometry: {
          kind: "ellipse",
          ...transformEllipseGeometry(
            fallbackRadii.rx.value,
            fallbackRadii.ry.value,
            pendingCircleRotation,
            ellipseTransform
          )
        },
        center: pendingCircleCenter,
        statementId: statement.id,
        itemId: sourceId,
        span,
        style,
        styleChain: statementStyleChain,
        shouldCompoundFilledSubpaths,
        activePath,
        geometryElements,
        markFeature
      });
    }
    pendingCircleCenter = null;
    pendingCircleRadius = null;
    pendingCircleRadii = null;
    pendingCircleRotation = 0;
    lastPlacementSegment = null;
  };
  const computeShouldCompoundFilledSubpaths = (candidateStyle: ResolvedStyle): boolean => {
    const hasFilledShadowLayer = candidateStyle.shadowLayers.some(
      (layer) => layer.style.shadeEnabled || (layer.style.fill != null && layer.style.fill !== "none")
    );
    return candidateStyle.shadeEnabled || (candidateStyle.fill != null && candidateStyle.fill !== "none") || hasFilledShadowLayer;
  };
  let shouldCompoundFilledSubpaths = computeShouldCompoundFilledSubpaths(style);
  const drawEdgeOptions = parseStyleValueAsOptionList("draw");
  const everyEdgeOptions = parseStyleValueAsOptionList("every edge");
  const edgeFromParentStyleOptions = parseStyleValueAsOptionList("edge from parent");
  let currentItemIndex = -1;
  const itemHandlers = new Map<PathItem["kind"], (item: PathItem) => void>([
    [
      "PlotOperation",
      (pathItem) => {
        const item = pathItem as PlotOperationItem;
        const connectFrom = currentOperator === "--" ? context.currentPoint ?? currentPointLogical : null;
        const localPlotSettings = applyPlotOptionLists(
          { ...plotSettings },
          item.options ? [item.options] : [],
          treeFrameState.macroBindings
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
            currentOperator = null;
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
          activePath = flushDrawableActivePath(geometryElements, activePath);
          const emitted = emitPlotPath({
            statementId: statement.id,
            item,
            points,
            settings: localPlotSettings,
            connectFrom,
            style,
            styleChain: statementStyleChain,
            geometryElements,
            markFeature,
            activeRoundedCorners,
            setCurrentPoint: (point) => { setCurrentPoint(point); },
            setPathStartPoint: (point) => {
              context.pathStartPoint = point;
            }
          });
          lastPlacementSegment = emitted.lastPlacementSegment;
          previousSegmentRoundedCorners = emitted.previousSegmentRoundedCorners;
          markFeature("plot_operation", "supported");
          currentOperator = null;
          return;
        }

        if (item.mode === "expression") {
          const expressionRaw = item.dataRaw?.trim() ?? "";
          if (expressionRaw.length === 0) {
            pushDiagnostic("invalid-plot-expression", "Plot expression requires a coordinate expression.", item.span.from, item.span.to);
            currentOperator = null;
            return;
          }

          const entries = buildPlotExpressionEntries({
            context,
            consumerStatementId: statement.id,
            expressionRaw,
            settings: localPlotSettings,
            macroBindings: treeFrameState.macroBindings
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
            currentOperator = null;
            return;
          }
          activePath = flushDrawableActivePath(geometryElements, activePath);
          const emitted = emitPlotPath({
            statementId: statement.id,
            item,
            points,
            settings: localPlotSettings,
            connectFrom,
            style,
            styleChain: statementStyleChain,
            geometryElements,
            markFeature,
            activeRoundedCorners,
            setCurrentPoint: (point) => { setCurrentPoint(point); },
            setPathStartPoint: (point) => {
              context.pathStartPoint = point;
            }
          });
          lastPlacementSegment = emitted.lastPlacementSegment;
          previousSegmentRoundedCorners = emitted.previousSegmentRoundedCorners;
          markFeature("plot_operation", "supported");
          currentOperator = null;
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
          currentOperator = null;
          return;
        }

        markFeature("plot_operation", "unsupported");
        pushDiagnostic(
          "invalid-plot-operation",
          "Could not parse this plot operation.",
          item.span.from,
          item.span.to
        );
        currentOperator = null;
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

        const sizeAwarePoints = resolveSizeAwareGraphNodePoints(runtimeGraphNodes, graphStatement, context, style);
        for (const runtimeNode of runtimeGraphNodes) {
          const defaultPoint = sizeAwarePoints.get(runtimeNode.nodeIndex) ?? runtimeNode.defaultPoint;
          const evaluatedNode = withDependencySource(context, graphStatement.id, () =>
            evaluateNodeItem(
              runtimeNode.syntheticNode,
              graphStatement,
              context,
              style,
              markFeature,
              pushDiagnostic,
              null,
              undefined,
              undefined,
              defaultPoint,
              statementStyleChain
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
              style,
              frameTransform,
              edgeOptionLayers,
              frame.customStyles,
              (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
              statementStyleChain,
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
        currentOperator = null;
      }
    ],
    [
      "PathOption",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "PathOption" }>;
        const expandedOptions = expandOptionListMacros([item.options], treeFrameState.macroBindings, context.macroTraceCollector ?? undefined)[0] ?? item.options;
        const expandedItem = expandedOptions === item.options ? item : { ...item, options: expandedOptions };
        if (pendingCircleCenter) {
          const parsed = extractCircleShapeOptions(expandedItem, treeFrameState.macroBindings, context.macroTraceCollector ?? undefined);
          if (parsed.radius != null) {
            pendingCircleRadius = parsed.radius;
            pendingCircleRadii = null;
          } else if (parsed.rx != null && parsed.ry != null) {
            pendingCircleRadius = null;
            pendingCircleRadii = { rx: parsed.rx, ry: parsed.ry };
          }
          if (parsed.rotation != null) {
            pendingCircleRotation = parsed.rotation;
          }
        }

        if (pendingEllipseCenter) {
          pendingEllipseRadii = extractEllipseRadii(
            expandedItem,
            pushDiagnostic,
            treeFrameState.macroBindings,
            context.macroTraceCollector ?? undefined
          );
        }

        if (pendingArc) {
          const arcParams = extractArcParameters(
            expandedItem,
            pushDiagnostic,
            style,
            treeFrameState.macroBindings,
            context.macroTraceCollector ?? undefined
          );
          if (arcParams) {
            let path: ScenePath | null = activePath;
            if (!path) {
              path = makePath(statement.id, item.id, style, statementStyleChain, item.span);
              path.commands.push({ kind: "M", to: pendingArc.from });
            }
            const appended = appendArcCommand(path.commands, pendingArc.from, arcParams, frameTransform);
            activePath = path;
            setCurrentPoint(appended.endpoint);
            lastPlacementSegment = appended.segment;
            previousSegmentRoundedCorners = activeRoundedCorners;
            markFeature("keyword_arc", "supported");
            markFeature("svg_path", "supported");
            pendingArc = null;
          }
        }

        if (pendingGrid) {
          const parsed = extractGridSteps(
            expandedItem,
            pushDiagnostic,
            treeFrameState.macroBindings,
            treeFrameState.transform
          );
          if (parsed) {
            if (parsed.stepX != null && parsed.stepX >= 0) {
              pendingGrid.stepX = parsed.stepX;
            }
            if (parsed.stepY != null && parsed.stepY >= 0) {
              pendingGrid.stepY = parsed.stepY;
            }
          }
        }

        const rounded = extractRoundedCorners(expandedOptions, activeRoundedCorners);
        if (rounded !== undefined) {
          activeRoundedCorners = rounded;
        }

        const isLeadingPathOption = !sawNonLeadingPathItem;
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
            const optionCustomStyles = cloneCustomStyleRegistry(treeFrameState.customStyles);
            const optionPicDefinitions = clonePicDefinitionRegistry(treeFrameState.picDefinitions);
            applyPicDefinitionsFromOptionLists(optionPicDefinitions, [expandedOptions], optionSourceRef);
            const optionResolved = resolveContextDelta(
              treeFrameState.style,
              treeFrameState.transform,
              [
                {
                  kind: "scope",
                  sourceRef: optionSourceRef,
                  rawOptions: [expandedOptions]
                }
              ],
              optionCustomStyles,
              (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
              treeFrameState.styleChain,
              (raw) => resolveContextColorAliasValue(context, raw)
            );
            for (const diagnostic of optionResolved.diagnostics) {
              pushStyleDiagnostic(pushDiagnostic, diagnostic, "Path option issue", item.span);
            }

            const optionMeta = resolveFrameMeta(treeFrameState, optionResolved.expandedOptionLists, optionSourceRef);

            treeFrameState = {
              ...treeFrameState,
              ...optionMeta,
              style: optionResolved.style,
              styleChain: optionResolved.chain,
              transform: optionResolved.transform,
              customStyles: optionCustomStyles,
              picDefinitions: optionPicDefinitions
            };
            style = treeFrameState.style;
            statementStyleChain = treeFrameState.styleChain;
            if (activePath) {
              activePath.style = { ...style };
              activePath.styleChain = cloneStyleChain(statementStyleChain);
            }
            plotSettings = applyPlotSettingsFromStyleChain(
              createDefaultPlotSettings(),
              treeFrameState.styleChain,
              treeFrameState.macroBindings
            );
            shouldCompoundFilledSubpaths = computeShouldCompoundFilledSubpaths(style);
          }
          if (isLeadingPathOption) {
            leadingToLikeOptions = mergeOptionLists(leadingToLikeOptions, expandedOptions);
          }
        }
      }
    ],
    [
      "Node",
      (pathItem) => {
        const item = pathItem as Extract<PathItem, { kind: "Node" }>;
        if (currentOperator) {
          pendingSegmentNodes.push(item);
          return;
        }
        const adornmentOptions = resolveOptionsForNodeAdornmentPlan(item.options, treeFrameState, context);
        const adornmentPlan = extractNodeAdornmentPlan(adornmentOptions, {
          quoteMode: treeFrameState.nodeQuotesMode,
          labelPosition: treeFrameState.labelPosition,
          pinPosition: treeFrameState.pinPosition,
          labelDistancePt: treeFrameState.labelDistancePt,
          pinDistancePt: treeFrameState.pinDistancePt,
          pinEdgeRaw: treeFrameState.pinEdgeRaw
        });
        const declaredNodeName = pendingNodeNameForNodeCommand ?? item.name ?? null;
        const hasFollowingTreeChildren = hasFollowingChildOperation(statement.items, currentItemIndex + 1);
        const existingTreeParent = treeParentCandidate;
        const synthesizedTreeNodeName: string | null =
          hasFollowingTreeChildren && !declaredNodeName
            ? makeTreeAutoName(existingTreeParent?.nameRaw ?? null, statement.id, item.id, currentItemIndex + 1, frame.treeLevel)
            : null;
        if (synthesizedTreeNodeName) {
          markFeature("tree_auto_naming", "supported");
        }
        const trailingCoordinateRaw = maybeResolveTrailingCoordinateFromNodeName(item.name);
        const synthesizedMainNodeName =
          adornmentPlan.adornments.length > 0 && !declaredNodeName
            ? `adornment_main_${sanitizeGeneratedNodeName(statement.id)}_${currentItemIndex}`
            : null;
        const forcedMainNodeName: string | undefined =
          pendingNodeNameForNodeCommand ?? synthesizedMainNodeName ?? synthesizedTreeNodeName ?? undefined;
        const nodeBase = trailingCoordinateRaw ? { ...item, name: undefined } : item;
        const nodeItem = {
          ...nodeBase,
          options: adornmentPlan.mainOptions,
          optionsSpan: adornmentPlan.mainOptions?.span
        };
        const standaloneNodeDefaultTarget = !hasPathCurrentPoint ? defaultPathOrigin : undefined;
        const allowImplicitOriginHandle =
          statement.command === "node"
          && !hasPathCurrentPoint
          && !isMatrixNodeOptions(nodeItem.options);
        const scopedAutoSide = resolveScopedAutoSide(statementStyleChain);
        const nodeOptionsWithScopedAuto =
          scopedAutoSide != null
            ? mergeOptionLists(parseOptionListRaw(`[auto=${scopedAutoSide}]`, item.span.from), nodeItem.options)
            : nodeItem.options;
        const explicitNodeAtSyntax = hasExplicitNodeAtSyntax(statement.items, currentItemIndex);
        const explicitNodeAtTarget = explicitNodeAtSyntax ? (currentPointLogical ?? context.currentPoint ?? undefined) : undefined;
        const resolvedNode = evaluateNodeItem(
          nodeOptionsWithScopedAuto === nodeItem.options ? nodeItem : { ...nodeItem, options: nodeOptionsWithScopedAuto, optionsSpan: nodeOptionsWithScopedAuto?.span },
          statement,
          context,
          style,
          markFeature,
          pushDiagnostic,
          lastPlacementSegment,
          forcedMainNodeName,
          undefined,
          explicitNodeAtTarget ?? standaloneNodeDefaultTarget,
          statementStyleChain,
          { allowImplicitOriginHandle, explicitAtSyntax: explicitNodeAtSyntax }
        );
        pendingNodeNameForNodeCommand = null;
        const edgeStartName = declaredNodeName ?? forcedMainNodeName;
        pendingEdgeStartCoordinateRaw = edgeStartName ? `(${edgeStartName.trim()})` : null;
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
            treeParentCandidate = {
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
              style,
              markFeature,
              pushDiagnostic,
              null,
              materialized.node.name,
              undefined,
              undefined,
              statementStyleChain
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
              const helpLinesOptions = parseStyleValueAsOptionList("help lines");
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
                style,
                frameTransform,
                pinEdgeOptionLayers,
                frame.customStyles,
                (raw) => evaluateRawCoordinate(raw, context).world,
                statementStyleChain,
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
            if (activePath) {
              activePath.commands.push({ kind: "M", to: trailingCoordinate.world });
            }
            setCurrentPoint(trailingCoordinate.world);
            context.pathStartPoint = trailingCoordinate.world;
            lastPlacementSegment = null;
            previousSegmentRoundedCorners = null;
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
        activePath = flushDrawableActivePath(geometryElements, activePath);
        previousSegmentRoundedCorners = null;
        pendingRectangleFrom = null;
        pendingCircleCenter = null;
        pendingCircleRadius = null;
        pendingCircleRadii = null;
        pendingCircleRotation = 0;
        pendingEllipseCenter = null;
        pendingEllipseRadii = null;
        pendingArc = null;
        pendingGrid = null;

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

        let operationStyle = style;
        if (item.options) {
          const resolvedDecorateOptions = resolveContextDelta(
            style,
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
            statementStyleChain,
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
            ...style,
            decoration: {
              ...style.decoration,
              enabled: true,
              params: { ...style.decoration.params }
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

          const adornmentOptions = resolveOptionsForNodeAdornmentPlan(item.options, treeFrameState, context);
          const adornmentPlan = extractNodeAdornmentPlan(adornmentOptions, {
            quoteMode: treeFrameState.nodeQuotesMode,
            labelPosition: treeFrameState.labelPosition,
            pinPosition: treeFrameState.pinPosition,
            labelDistancePt: treeFrameState.labelDistancePt,
            pinDistancePt: treeFrameState.pinDistancePt,
            pinEdgeRaw: treeFrameState.pinEdgeRaw
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
              style,
              markFeature,
              pushDiagnostic,
              null,
              materialized.node.name,
              undefined,
              undefined,
              statementStyleChain
            );
            behindNodeElements.push(...resolvedAdornment.behindElements);
            frontNodeElements.push(...resolvedAdornment.frontElements);
          }
        };

        const nextItem = statement.items[currentItemIndex + 1];
        const nextCoordinate = statement.items[currentItemIndex + 2];
        if (nextItem?.kind === "PathKeyword" && nextItem.keyword === "at" && nextCoordinate?.kind === "Coordinate") {
          pendingNamedCoordinate = { name: parsedName };
        } else {
          const placementFraction = resolveNodePositionFraction(item.options);
          if (placementFraction != null && currentOperator) {
            pendingSegmentPlacements.push({ name: parsedName, fraction: placementFraction });
            markFeature("named_coordinates", "supported");
            return;
          }

          const capturePoint =
            placementFraction != null && lastPlacementSegment
              ? pointAtPlacementSegment(lastPlacementSegment, placementFraction)
              : currentPointLogical ?? context.currentPoint;
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
        if (placementFraction != null && currentOperator) {
          pendingSegmentPics.push({ item, fraction: placementFraction });
          return;
        }

        const segment = placementFraction != null ? lastPlacementSegment : null;
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

        const placement = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
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
        const toPlan = extractToLikeOptionPlan(mergeToLikePathOptions(item, leadingToLikeOptions));
        const toItem: ToOperationItem =
          toPlan.generatedNodes.length > 0
            ? {
                ...toPlan.item,
                nodes: [...(toPlan.item.nodes ?? []), ...toPlan.generatedNodes]
              }
            : toPlan.item;
        let toStartCoordinateRaw: string | null = null;
        if (currentPointCoordinate) {
          const namedCoordinate = currentPointCoordinate as { form: string; x: string };
          if (namedCoordinate.form === "named") {
            toStartCoordinateRaw = `(${namedCoordinate.x.trim()})`;
          }
        }
        const handled = applyToOperation(
          toItem,
          context,
          statement,
          style,
          statementStyleChain,
          activePath,
          previousSegmentRoundedCorners,
          markFeature,
          pushDiagnostic,
          toStartCoordinateRaw
        );
        activePath = handled.activePath;
        if (handled.segment) {
          lastPlacementSegment = handled.segment;
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
          previousSegmentRoundedCorners = handled.previousSegmentRoundedCorners;
        }
        setCurrentPoint(context.currentPoint);
      }
    ],
    [
      "EdgeOperation",
      (pathItem) => {
        const item = pathItem as EdgeOperationItem;
        const edgePlan = extractToLikeOptionPlan(mergeToLikePathOptions(item, leadingToLikeOptions));
        const edgeItem: EdgeOperationItem =
          edgePlan.generatedNodes.length > 0
            ? {
                ...edgePlan.item,
                nodes: [...(edgePlan.item.nodes ?? []), ...edgePlan.generatedNodes]
              }
            : edgePlan.item;
        if (!edgeOperationStart) {
          let coordinateRaw = pendingEdgeStartCoordinateRaw;
          if (!coordinateRaw && currentPointCoordinate) {
            const namedCoordinate = currentPointCoordinate as { form: string; x: string };
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
          edgeOperationStart = {
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
          style,
          frameTransform,
          edgeOptionLayers,
          frame.customStyles,
          (raw) => evaluateRawCoordinate(raw, context).world,
          statementStyleChain,
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
          edgeOperationStart.point,
          edgeOperationStart.coordinateRaw
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

        let operationTransform = treeFrameState.transform;
        if (item.options) {
          const optionSourceRef = {
            sourceId: item.id,
            sourceSpan: item.optionsSpan ?? item.span,
            sourceKind: "svg-operation-options",
            label: "svg"
          } as const;
          const optionCustomStyles = cloneCustomStyleRegistry(treeFrameState.customStyles);
          const optionResolved = resolveContextDelta(
            style,
            treeFrameState.transform,
            [
              {
                kind: "scope",
                sourceRef: optionSourceRef,
                rawOptions: [item.options]
              }
            ],
            optionCustomStyles,
            (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
            statementStyleChain,
            (raw) => resolveContextColorAliasValue(context, raw)
          );
          operationTransform = optionResolved.transform;
          for (const diagnostic of optionResolved.diagnostics) {
            pushStyleDiagnostic(pushDiagnostic, diagnostic, "SVG option issue", item.span);
          }
        }

        const fallbackStart = applyMatrix(treeFrameState.transform, wp(0, 0));
        const startPoint = context.currentPoint ?? currentPointLogical ?? fallbackStart;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(startPoint);
        }

        const parsed = parseSvgPathOperation({
          payloadRaw: item.dataRaw,
          transform: operationTransform,
          startPoint,
          subpathStartPoint: context.pathStartPoint
        });
        if (!activePath && parsed.commands.length > 0) {
          activePath = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
          if (parsed.commands[0]?.kind !== "M") {
            activePath.commands.push({ kind: "M", to: startPoint });
          }
        }
        if (activePath && parsed.commands.length > 0) {
          activePath.commands.push(...parsed.commands);
        }

        if (parsed.subpathStartPoint) {
          context.pathStartPoint = parsed.subpathStartPoint;
        }
        setCurrentPoint(parsed.endPoint);
        currentOperator = null;
        pendingEdgeStartCoordinateRaw = null;

        if (parsed.lastSegment) {
          lastPlacementSegment = parsed.lastSegment;
          previousSegmentRoundedCorners = activeRoundedCorners;
        } else {
          lastPlacementSegment = null;
          previousSegmentRoundedCorners = null;
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
    currentItemIndex = index;
    if (item.kind !== "PathComment" && item.kind !== "PathOption") {
      sawNonLeadingPathItem = true;
    }
    if (item.kind !== "EdgeOperation" && item.kind !== "PathComment") {
      edgeOperationStart = null;
      pendingEdgeStartCoordinateRaw = null;
    }
    if (
      item.kind !== "PathComment" &&
      item.kind !== "PathOption" &&
      item.kind !== "ChildOperation" &&
      item.kind !== "Coordinate" &&
      item.kind !== "Node"
    ) {
      treeParentCandidate = null;
    }

      if (item.kind === "Coordinate") {
      if (statement.command === "node" && item.raw.trim() === "()") {
        continue;
      }

        if (pendingCircleCenter) {
          const radius = parseCircleRadiusFromCoordinateRaw(expandPathItemRaw(item.raw, context));
          if (radius != null) {
            const circleTransform = resolveLengthTransform(radius.applyFrameTransform, frameTransform, statementStyleChain);
            activePath = emitCircleOrEllipse({
              geometry: transformCircleGeometry(radius.value, circleTransform),
              center: pendingCircleCenter,
              statementId: statement.id,
              itemId: item.id,
              span: item.span,
              style,
              styleChain: statementStyleChain,
              shouldCompoundFilledSubpaths,
              activePath,
              geometryElements,
              markFeature
            });
            pendingCircleCenter = null;
            pendingCircleRadius = null;
            pendingCircleRadii = null;
            pendingCircleRotation = 0;
            continue;
          }
          flushPendingCircle(item.id, item.span);
        }

      if (pendingEllipseCenter) {
        const parsedRadii = parseEllipseRadiiFromCoordinateRaw(expandPathItemRaw(item.raw, context));
      if (parsedRadii) {
          const ellipseTransform = resolveLengthTransform(
            parsedRadii.rx.applyFrameTransform || parsedRadii.ry.applyFrameTransform,
            frameTransform,
            statementStyleChain
          );
          const geometry = transformEllipseGeometry(parsedRadii.rx.value, parsedRadii.ry.value, 0, ellipseTransform);
          markFeature("keyword_ellipse", "supported");
          activePath = emitCircleOrEllipse({
            geometry: { kind: "ellipse", ...geometry },
            center: pendingEllipseCenter,
            statementId: statement.id,
            itemId: item.id,
            span: item.span,
            style,
            styleChain: statementStyleChain,
            shouldCompoundFilledSubpaths,
            activePath,
            geometryElements,
            markFeature
          });
          pendingEllipseCenter = null;
          pendingEllipseRadii = null;
          lastPlacementSegment = null;
          continue;
        }
      }

      if (pendingArc) {
        const shorthand = parseArcShorthand(expandPathItemRaw(item.raw, context));
        if (shorthand) {
          let path: ScenePath | null = activePath;
          if (!path) {
            path = makePath(statement.id, item.id, style, statementStyleChain, item.span);
            path.commands.push({ kind: "M", to: pendingArc.from });
          }
          const appended = appendArcCommand(path.commands, pendingArc.from, shorthand, frameTransform);
          activePath = path;
          setCurrentPoint(appended.endpoint);
          lastPlacementSegment = appended.segment;
          previousSegmentRoundedCorners = activeRoundedCorners;
          markFeature("keyword_arc", "supported");
          markFeature("svg_path", "supported");
          pendingArc = null;
          continue;
        }
      }

      if (
        statement.command === "node" &&
        item.form === "named" &&
        pendingNodeNameForNodeCommand == null &&
        shouldCaptureStandaloneNodeNameCoordinate(statement.items, index)
      ) {
        const rawName = item.x.trim();
        if (rawName.length > 0) {
          pendingNodeNameForNodeCommand = rawName;
          markFeature("named_coordinates", "supported");
          continue;
        }
      }

      if (
        statement.command === "coordinate" &&
        item.form === "named" &&
        pendingNamedCoordinate == null &&
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
            pendingNamedCoordinate = { name: rawName };
          } else {
            const fallbackPoint = hasPathCurrentPoint ? (currentPointLogical ?? context.currentPoint ?? defaultPathOrigin) : defaultPathOrigin;
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
        evaluateTurnCoordinate(item, currentPointLogical ?? context.currentPoint, frameTransform, lastPlacementSegment) ??
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
      treeParentCandidate = {
        nameRaw:
          item.form === "named" && !item.x.includes(".") && item.x.trim().length > 0
            ? item.x.trim()
            : null,
        point: evaluated.world,
        span: item.span
      };

      if (pendingNamedCoordinate) {
        const scopedName = applyNameScope(pendingNamedCoordinate.name, context);
        writeNamedCoordinate(context, scopedName, evaluated.world);
        if (handle && handle.rewriteMode !== "unsupported" && !handle.rewriteTargetHandleId) {
          context.namedCoordinateRewriteHandles.set(scopedName, handle.id);
        }
        pendingNamedCoordinate = null;
      }

      if (pendingGrid) {
        markFeature("keyword_grid", "supported");
        markFeature("svg_path", "supported");
        geometryElements.push(
          ...makeGridElements(
            statement.id,
            item.id,
            pendingGrid.from,
            evaluated.world,
              pendingGrid.stepX,
              pendingGrid.stepY,
              style,
              statementStyleChain,
              item.span,
              frameTransform
            )
        );
        setCurrentPoint(evaluated.world, evaluated.world, {
          form: item.form,
          x: item.x
        });
        pendingGrid = null;
        continue;
      }

      if (pendingRectangleFrom) {
        markFeature("shape_rectangle", "supported");
        if (shouldCompoundFilledSubpaths) {
          activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, statementStyleChain, item.span);
          markPathShapeHint(activePath, "rectangle");
          appendRectangleSubpath(activePath.commands, pendingRectangleFrom, evaluated.world, activeRoundedCorners, frameTransform);
        } else {
          geometryElements.push(
            makeRectangleElement(
              statement.id,
              item.id,
                pendingRectangleFrom,
                evaluated.world,
                style,
                statementStyleChain,
                item.span,
                activeRoundedCorners,
                frameTransform
            )
          );
        }
        lastPlacementSegment = {
          kind: "line",
          from: pendingRectangleFrom,
          to: evaluated.world
        };
        markFeature("svg_path", "supported");
        pendingRectangleFrom = null;
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
      const sourceLogicalPoint = currentPointLogical ?? context.currentPoint;
      const hasOperatorSegment = currentOperator != null && context.currentPoint != null && sourceLogicalPoint != null;
      // For -| and |- operators, compute border intersections using the bend point
      // direction rather than the direct source→target direction.
      // -| means horizontal-then-vertical: bend at (target.x, source.y)
      // |- means vertical-then-horizontal: bend at (source.x, target.y)
      const sourceBorderRef = hasOperatorSegment && currentOperator === "-|"
        ? wp(evaluated.world.x, sourceLogicalPoint.y)
        : hasOperatorSegment && currentOperator === "|-"
          ? wp(sourceLogicalPoint.x, evaluated.world.y)
          : evaluated.world;
      const targetBorderRef = hasOperatorSegment && currentOperator === "-|"
        ? wp(evaluated.world.x, sourceLogicalPoint.y)
        : hasOperatorSegment && currentOperator === "|-"
          ? wp(sourceLogicalPoint.x, evaluated.world.y)
          : sourceLogicalPoint;
      const pathSourcePoint = hasOperatorSegment
        ? currentPointCoordinate
          ? maybeResolveNamedCoordinateBorderPoint(currentPointCoordinate, sourceLogicalPoint, sourceBorderRef, context)
          : sourceLogicalPoint
        : null;
      const pathTargetPoint = hasOperatorSegment
        ? maybeResolveNamedCoordinateBorderPoint(item, evaluated.world, targetBorderRef, context)
        : evaluated.world;
      const advancedPoint = hasOperatorSegment ? pathTargetPoint : evaluated.world;
      if (!hasOperatorSegment && pendingSegmentPlacements.length > 0) {
        for (const pending of pendingSegmentPlacements) {
          writeNamedCoordinate(context, applyNameScope(pending.name, context), evaluated.world);
        }
        pendingSegmentPlacements = [];
      }

      if (!activePath) {
        activePath = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
        if (hasOperatorSegment && pathSourcePoint) {
          activePath.commands.push({ kind: "M", to: pathSourcePoint });
          const appended = appendPathPoint(
            activePath.commands,
            currentOperator,
            pathSourcePoint,
            pathTargetPoint,
            previousSegmentRoundedCorners,
            activeRoundedCorners
          );
          lastPlacementSegment = appended.segment;
          flushPendingSegmentNodes(appended.segment);
          flushPendingSegmentPlacements(appended.segment);
          flushPendingSegmentPics(appended.segment);
          previousSegmentRoundedCorners = appended.nextRoundedCorners;
          context.pathStartPoint = pathSourcePoint;
        } else {
          activePath.commands.push({ kind: "M", to: pathTargetPoint });
          context.pathStartPoint = pathTargetPoint;
          lastPlacementSegment = null;
          previousSegmentRoundedCorners = null;
        }
        markFeature("svg_path", "supported");
      } else if (!currentOperator) {
        activePath.commands.push({ kind: "M", to: pathTargetPoint });
        context.pathStartPoint = pathTargetPoint;
        lastPlacementSegment = null;
        previousSegmentRoundedCorners = null;
      } else if (hasOperatorSegment && pathSourcePoint) {
        const lastCommand = activePath.commands[activePath.commands.length - 1];
        if (lastCommand?.kind === "M") {
          lastCommand.to = pathSourcePoint;
          context.pathStartPoint = pathSourcePoint;
        } else {
          const lastPoint =
            lastCommand?.kind === "L" || lastCommand?.kind === "C"
              ? lastCommand.to
              : null;
          if (!lastPoint || !pointsClose(lastPoint, pathSourcePoint)) {
            activePath.commands.push({ kind: "M", to: pathSourcePoint });
            context.pathStartPoint = pathSourcePoint;
          }
        }
        const appended = appendPathPoint(
          activePath.commands,
          currentOperator,
          pathSourcePoint,
          pathTargetPoint,
          previousSegmentRoundedCorners,
          activeRoundedCorners
        );
        lastPlacementSegment = appended.segment;
        flushPendingSegmentNodes(appended.segment);
        flushPendingSegmentPlacements(appended.segment);
        flushPendingSegmentPics(appended.segment);
        previousSegmentRoundedCorners = appended.nextRoundedCorners;
      } else {
        activePath.commands.push({ kind: "M", to: pathTargetPoint });
        context.pathStartPoint = pathTargetPoint;
        lastPlacementSegment = null;
        previousSegmentRoundedCorners = null;
      }

      const shouldAdvancePoint = item.relativePrefix ? item.relativePrefix === "++" : true;
      if (shouldAdvancePoint) {
        setCurrentPoint(advancedPoint, evaluated.world, coordinateRef);
      } else if (context.currentPoint) {
        setCurrentPoint(context.currentPoint, advancedPoint, currentPointCoordinate);
      }
      if (!context.currentPoint) {
        setCurrentPoint(advancedPoint, evaluated.world, coordinateRef);
      }
      currentOperator = null;
      continue;
    }

      if (item.kind === "PathKeyword") {
        if (pendingCircleCenter) {
          flushPendingCircle(item.id, item.span);
        }

      if (item.keyword === "--" || item.keyword === "-|" || item.keyword === "|-") {
        currentOperator = item.keyword;
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

        if (!activePath) {
          if (!context.currentPoint) {
            markFeature("path_operator_curves", "unsupported");
            pushDiagnostic("curve-without-start", "Curve operator requires a current point.", item.span.from, item.span.to);
            index = parsedCurve.consumedIndex;
            continue;
          }
          activePath = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
          activePath.commands.push({ kind: "M", to: context.currentPoint });
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
        activePath.commands.push({
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
          lastPlacementSegment = curveSegment;
        }
        previousSegmentRoundedCorners = activeRoundedCorners;
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
            style,
            markFeature,
            pushDiagnostic,
            curveSegment,
            undefined,
            0.5,
            undefined,
            statementStyleChain
          );
          behindNodeElements.push(...resolvedNode.behindElements);
          frontNodeElements.push(...resolvedNode.frontElements);
        }

        if (parsedCurve.endAdvancesCurrentPoint) {
          setCurrentPoint(parsedCurve.endPoint);
        }
        if (parsedCurve.endClosesPath) {
          activePath.commands.push({ kind: "Z" });
          if (hasDrawablePathSegments(activePath)) {
            geometryElements.push(activePath);
          }
          activePath = null;
          previousSegmentRoundedCorners = null;
          if (context.pathStartPoint) {
            setCurrentPoint(context.pathStartPoint);
          }
          lastPlacementSegment = null;
          markFeature("path_cycle", "supported");
        }
        currentOperator = null;
        index = parsedCurve.consumedIndex;
        continue;
      }

      if (item.keyword === "cycle") {
        if (activePath) {
          const logicalCurrentPoint = currentPointLogical ?? context.currentPoint;
          if (logicalCurrentPoint && context.pathStartPoint) {
            const closingFrom = logicalCurrentPoint;
            const pathStart = context.pathStartPoint;
            const operator: "--" | "-|" | "|-" = currentOperator ?? "--";
            const appended = appendPathPoint(
              activePath.commands,
              operator,
              closingFrom,
              pathStart,
              previousSegmentRoundedCorners,
              activeRoundedCorners
            );
            previousSegmentRoundedCorners = appended.nextRoundedCorners;
            setCurrentPoint(pathStart);
            roundClosedPathStartCorner(activePath.commands, closingFrom, pathStart, activeRoundedCorners);
          }
          activePath.commands.push({ kind: "Z" });
          if (shouldCompoundFilledSubpaths) {
            previousSegmentRoundedCorners = null;
          } else {
            if (hasDrawablePathSegments(activePath)) {
              geometryElements.push(activePath);
            }
            activePath = null;
            previousSegmentRoundedCorners = null;
          }
          markFeature("path_cycle", "supported");
        }
        if (context.pathStartPoint) {
          setCurrentPoint(context.pathStartPoint);
        }
        lastPlacementSegment = null;
        currentOperator = null;
        continue;
      }

      if (item.keyword === "rectangle") {
        const rectangleStart = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveRectangleStart = hasPathCurrentPoint ? rectangleStart : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveRectangleStart);
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingRectangleFrom = effectiveRectangleStart;
        lastPlacementSegment = null;
        markFeature("shape_rectangle", "supported");
        continue;
      }

      if (item.keyword === "circle") {
        const circleCenter = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveCircleCenter = hasPathCurrentPoint ? circleCenter : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveCircleCenter);
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingCircleCenter = effectiveCircleCenter;
        pendingCircleRadius = null;
        pendingCircleRadii = null;
        pendingCircleRotation = 0;
        lastPlacementSegment = null;
        markFeature("shape_circle", "supported");
        continue;
      }

      if (item.keyword === "ellipse") {
        const ellipseCenter = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveEllipseCenter = hasPathCurrentPoint ? ellipseCenter : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveEllipseCenter);
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingEllipseCenter = effectiveEllipseCenter;
        pendingEllipseRadii = null;
        lastPlacementSegment = null;
        markFeature("keyword_ellipse", "supported");
        markFeature("shape_ellipse", "supported");
        continue;
      }

      if (item.keyword === "arc") {
        const arcStart = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveArcStart = hasPathCurrentPoint ? arcStart : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveArcStart);
        }
        pendingArc = { from: effectiveArcStart };
        lastPlacementSegment = null;
        markFeature("keyword_arc", "supported");
        continue;
      }

      if (item.keyword === "grid") {
        const gridStart = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveGridStart = hasPathCurrentPoint ? gridStart : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveGridStart);
        }
        activePath = flushDrawableActivePath(geometryElements, activePath);
        previousSegmentRoundedCorners = null;
        const gridStepDefaults = extractGridStepsFromOptionLists(
          statementStyleChain.flatMap((entry) => entry.rawOptions),
          pushDiagnostic,
          treeFrameState.macroBindings,
          treeFrameState.transform
        );
        pendingGrid = {
          from: effectiveGridStart,
          stepX: gridStepDefaults?.stepX ?? resolveDefaultGridStep(treeFrameState.transform, "x"),
          stepY: gridStepDefaults?.stepY ?? resolveDefaultGridStep(treeFrameState.transform, "y")
        };
        lastPlacementSegment = null;
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

        if (!activePath) {
          activePath = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
          activePath.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        for (const command of parsed.commands) {
          activePath.commands.push(command);
        }
        previousSegmentRoundedCorners = activeRoundedCorners;
        const lastCommand = parsed.commands[parsed.commands.length - 1];
        if (lastCommand?.kind === "C") {
          const previousCommand = parsed.commands.length > 1 ? parsed.commands[parsed.commands.length - 2] : null;
          const from = previousCommand?.kind === "C" ? previousCommand.to : context.currentPoint;
          if (from) {
            lastPlacementSegment = {
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
        currentOperator = null;
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

        let path: ScenePath | null = activePath;
        if (!path) {
          path = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
          path.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        const from = context.currentPoint;
        const to = maybeResolveNamedCoordinateBorderPoint(targetItem, evaluatedTarget.world, from, context);
        const segment = appendSinCosSegment(path.commands, from, to, item.keyword);
        activePath = path;
        lastPlacementSegment = segment;
        previousSegmentRoundedCorners = activeRoundedCorners;
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

        currentOperator = null;
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
        treeParentCandidate,
        treeFrameState,
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
      treeParentCandidate = handled.treeParentCandidate;
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

  if (pendingCircleCenter) {
    flushPendingCircle(statement.id, statement.span);
  }

  if (pendingEllipseCenter) {
    const radii = pendingEllipseRadii ?? {
      rx: { value: DEFAULT_GRID_STEP, applyFrameTransform: true },
      ry: { value: DEFAULT_GRID_STEP, applyFrameTransform: true }
    };
    const ellipseTransform = resolveLengthTransform(
      radii.rx.applyFrameTransform || radii.ry.applyFrameTransform,
      frameTransform,
      statementStyleChain
    );
    const geometry = transformEllipseGeometry(radii.rx.value, radii.ry.value, 0, ellipseTransform);
    activePath = emitCircleOrEllipse({
      geometry: { kind: "ellipse", ...geometry },
      center: pendingEllipseCenter,
      statementId: statement.id,
      itemId: statement.id,
      span: statement.span,
      style,
      styleChain: statementStyleChain,
      shouldCompoundFilledSubpaths,
      activePath,
      geometryElements,
      markFeature
    });
    lastPlacementSegment = null;
  }

  if (pendingArc) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires either option parameters or shorthand coordinates.", statement.span.from, statement.span.to);
  }

  if (activePath && hasDrawablePathSegments(activePath)) {
    geometryElements.push(activePath);
  }

  const preActionElements: SceneElement[] = [];
  const postActionElements: SceneElement[] = [];
  for (const preAction of style.decorationPreActions) {
    markFeature("decorate_option", "supported");
    preActionElements.push(
      ...decoratePathElements(geometryElements, preAction, "collect", statement.id, context.mathRandom, markFeature, pushDiagnostic)
    );
  }
  for (const postAction of style.decorationPostActions) {
    markFeature("decorate_option", "supported");
    postActionElements.push(
      ...decoratePathElements(geometryElements, postAction, "collect", statement.id, context.mathRandom, markFeature, pushDiagnostic)
    );
  }

  let mainGeometry = geometryElements;
  if (style.decoration.enabled) {
    markFeature("decorate_option", "supported");
    mainGeometry = decoratePathElements(
      geometryElements,
      style.decoration,
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

  if (style.clip) {
    markFeature("path_clipping", "supported");
    const clipPath = buildClipPath(statement, geometryElements, style.fillRule);
    if (clipPath) {
      outputClipChain = [...inheritedClipChain, clipPath];
      frame.clipChain = outputClipChain;
    }
    if (currentPathBounds) {
      extendPictureBounds(context, currentPathBounds);
    }
    frame.pictureSizeRelevant = false;
  }

  if (style.useAsBoundingBox) {
    markFeature("use_as_bounding_box", "supported");
    if (currentPathBounds) {
      extendPictureBounds(context, currentPathBounds);
    }
    frame.pictureSizeRelevant = false;
  }

  let statementElements = [...preActionElements, ...behindNodeElements, ...mainGeometry, ...frontNodeElements, ...postActionElements];
  statementElements = attachClipChainToElements(statementElements, outputClipChain);
  if (!style.clip && !style.useAsBoundingBox && frame.pictureSizeRelevant) {
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
