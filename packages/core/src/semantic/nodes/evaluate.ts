import type { NodeItem, PathStatement } from "../../ast/types.js";
import { pt } from "../../coords/scalars.js";
import { worldPoint } from "../../coords/points.js";
import { worldTransform } from "../../coords/transforms.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import {
  readNamedNodeGeometry,
  resolveContextColorAliasValue,
  type ProvenanceOptionList,
  type SemanticContext
} from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import {
  currentAnchorForDirection,
  resolveNodePositioningTarget,
  targetAnchorForDirection,
  type PositioningDirection
} from "../path/node-positioning.js";
import {
  resolvePathAttachedNodeRegime,
  resolvePathAttachedNodeSloped,
  resolvePathPositionFraction
} from "../path/path-attached.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "../path/types.js";
import type { WorldPoint } from "../../coords/points.js";
import type { WorldTransform } from "../../coords/transforms.js";
import type { ResolvedStyle, SceneAdornment, SceneElement, ScenePathAttachment, ScenePathCommand } from "../types.js";
import { cloneCustomStyleRegistry, walkOptionEntriesWithCustomStyles } from "../style/custom-styles.js";
import { expandOptionListMacros } from "../style/macro-options.js";
import { resolveContextDelta } from "../style/resolve.js";
import { makeNodeAdornmentTargetId } from "../path/label-quotes.js";
import {
  cloneResolvedStyle,
  cloneStyleChain,
  diffResolvedStyle,
  type StyleChainEntry,
  type StyleSourceRef,
  type StyleTraceLayerInput
} from "../style-chain.js";
import { nodeAnchorOffset, placeNodeCenter, registerNamedNodeAnchors } from "./anchors.js";
import {
  applyNodeBoxPaintMode,
  makeCircleElement,
  makeNodeBoxElement,
  makeNodeCircularSectorElement,
  makeNodeChamferedRectangleElement,
  makeNodeCloudCalloutElement,
  makeNodeCloudElement,
  makeNodeLineElement,
  makeNodeMagnifyingHandleElement,
  makeNodeCylinderElement,
  makeNodeDartElement,
  makeNodeDiamondSplitElement,
  makeNodeDiamondSizingElement,
  makeNodeEllipseCalloutElement,
  makeNodeEllipseElement,
  makeNodeRoundedRectangleElement,
  makeNodeIsoscelesTriangleElement,
  makeNodeKiteElement,
  makeNodeRectangleCalloutElement,
  makeNodeRegularPolygonElement,
  makeNodeSemicircleElement,
  makeNodeSignalElement,
  makeNodeSingleArrowElement,
  makeNodeStarElement,
  makeNodeStarburstElement,
  makeNodeTapeElement,
  makeNodeTrapeziumElement,
  makeNodeDoubleArrowElement,
  makeTextElement,
  resolveNodeBoxPaintMode
} from "./elements.js";
import { adjustNodeLayoutForShape, resolveNodeLayout } from "./layout.js";
import { evaluateMatrixNodeItem, resolveMatrixMode } from "./matrix.js";
import { collectScopedNodeNames } from "./named-coordinates.js";
import {
  resolveEffectiveNodeOptions,
  resolveEveryShapeNodeStyleLists,
  resolveNodeAnchor,
  resolveNodeLayer,
  resolveNodeOptionTransform,
  resolveNodeStyle,
  resolveNodeShape,
  withDefaultNodePosition
} from "./options.js";
import { resolveCalloutPointerOffset, resolveNodeShapeGeometryParams } from "./shape-geometry.js";
import {
  isMultipartShape,
  parseNodeParts,
  resolveRectangleSplitIgnoreEmptyParts,
  resolveRectangleSplitHorizontal,
  resolveRectangleSplitPartTexts,
  resolveRectangleSplitParts
} from "./multipart.js";
import type { NodeShape } from "./types.js";
import { resolveNodeTargetPoint } from "./placement.js";
import { normalizeEscapedTextSpaces, normalizeNodeTextFontSize } from "./normalize-text.js";
import { normalizeOptionValue } from "./utils.js";
import { resolveFitOverrides } from "./fit.js";
import { applyNodeDecorations } from "./node-decorations.js";
import {
  mergeOptionLists,
  resolveCircleSolidusHorizontalTextOffset,
  resolveCircleSolidusVerticalTextOffset,
  resolveRectangleSplitDrawSplits,
  resolveRectangleSplitLayoutGeometry,
  resolveRectangleSplitPartFills,
  resolveRectangleSplitPartTextPosition,
  resolveRectangleSplitUseCustomFill,
  resolveTwoPartShapeSizing,
  resolveTwoPartShapeVisual,
  resolveTwoPartSplitTextPosition
} from "./multipart-layout.js";
import { splitTopLevelCommas } from "./raw-list.js";
import { applyMatrixToVector, identityMatrix, multiplyMatrix, rotationMatrix } from "../transform.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

const CONTINUOUS_POSITIONING_DIRECTIONS: PositioningDirection[] = [
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right"
];

export type NodeAnchorExtents = {
  left: number;
  right: number;
  up: number;
  down: number;
  halfWidth: number;
  halfHeight: number;
};

function computePositioningAnchorOffsetsByDirection(params: {
  targetNodeName: string;
  targetCenter: WorldPoint;
  currentCenter: WorldPoint;
  context: SemanticContext;
  legacyOf: boolean;
  nodeShape: NodeShape;
  nodeLayout: ReturnType<typeof adjustNodeLayoutForShape>;
  nodeOptions: OptionListAst | undefined;
  nodeTransform: WorldTransform;
}): Record<string, { targetAnchor: WorldPoint; currentAnchor: WorldPoint }> {
  const {
    targetNodeName,
    targetCenter,
    context,
    legacyOf,
    nodeShape,
    nodeLayout,
    nodeOptions,
    nodeTransform
  } = params;
  const offsets: Record<string, { targetAnchor: WorldPoint; currentAnchor: WorldPoint }> = {};

  for (const direction of CONTINUOUS_POSITIONING_DIRECTIONS) {
    const currentAnchor = applyMatrixToVector(
      nodeTransform,
      nodeAnchorOffset(nodeShape, nodeLayout, currentAnchorForDirection(direction), nodeOptions)
    );
    let targetAnchor: WorldPoint = worldPoint(pt(0), pt(0));

    if (!legacyOf) {
      const targetAnchorWorldPoint = evaluateRawCoordinate(
        `(${targetNodeName}.${targetAnchorForDirection(direction)})`,
        context
      ).world;
      if (targetAnchorWorldPoint) {
        targetAnchor = worldPoint(
          pt(targetAnchorWorldPoint.x - targetCenter.x),
          pt(targetAnchorWorldPoint.y - targetCenter.y)
        );
      }
    }

    offsets[direction] = {
      targetAnchor,
      currentAnchor: wp(currentAnchor.x, currentAnchor.y)
    };
  }

  return offsets;
}

export function measureNodeAnchorExtents(
  item: NodeItem,
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle,
  defaultPositionFraction?: number
): NodeAnchorExtents {
  const frame = context.stack[context.stack.length - 1];
  const everyNodeStyles = item.adornment ? [] : frame.everyNodeStyles;
  const nodeOptions = withDefaultNodePosition(item.options, defaultPositionFraction);
  const effectiveNodeOptions = resolveEffectiveNodeOptions({
    statementOptions: statement.options,
    nodeOptions,
    everyNodeStyles,
    everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
    everyCircleNodeStyles: frame.everyCircleNodeStyles,
    everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
    everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
    everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
    everyKiteNodeStyles: frame.everyKiteNodeStyles,
    everyDartNodeStyles: frame.everyDartNodeStyles,
    everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
    everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
    everyCloudNodeStyles: frame.everyCloudNodeStyles,
    everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
    everySignalNodeStyles: frame.everySignalNodeStyles,
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });
  const effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
    statementOptions: undefined,
    nodeOptions,
    everyNodeStyles,
    everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
    everyCircleNodeStyles: frame.everyCircleNodeStyles,
    everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
    everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
    everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
    everyKiteNodeStyles: frame.everyKiteNodeStyles,
    everyDartNodeStyles: frame.everyDartNodeStyles,
    everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
    everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
    everyCloudNodeStyles: frame.everyCloudNodeStyles,
    everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
    everySignalNodeStyles: frame.everySignalNodeStyles,
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });

  const expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
  const expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);

  const nodeDecorationBaseStyle: ResolvedStyle = {
    ...style,
    decoration: {
      ...style.decoration,
      enabled: false,
      params: { ...style.decoration.params }
    },
    decorationPreActions: [],
    decorationPostActions: []
  };
  const nodeLocalStyle = resolveNodeStyle(expandedNodeLocalOptions, nodeDecorationBaseStyle, context, 1);
  const nodeShape = resolveNodeShape(expandedNodeOptions);
  const expandedNodeText = expandMacroBindings(item.text, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const resolvedNodeText = normalizeEscapedTextSpaces(resolveTextColorAliases(expandedNodeText, context, statement.id));
  const normalizedText = normalizeNodeTextFontSize(resolvedNodeText, nodeLocalStyle.fontSize);
  const nodeTextStyle = normalizedText.fontSizePt === nodeLocalStyle.fontSize
    ? nodeLocalStyle
    : { ...nodeLocalStyle, fontSize: normalizedText.fontSizePt };
  const baseNodeLayout = resolveNodeLayout(
    normalizedText.text,
    expandedNodeOptions,
    nodeTextStyle,
    1,
    context.textEngine,
    "text"
  );
  const nodeLayout = adjustNodeLayoutForShape(baseNodeLayout, nodeShape);
  const anchor = resolveNodeAnchor(expandedNodeOptions);
  const directionalExtents = resolveDirectionalAnchorExtents(anchor, nodeLayout.anchorHalfWidth, nodeLayout.anchorHalfHeight);
  return {
    left: directionalExtents.left,
    right: directionalExtents.right,
    up: directionalExtents.up,
    down: directionalExtents.down,
    halfWidth: nodeLayout.anchorHalfWidth,
    halfHeight: nodeLayout.anchorHalfHeight
  };
}

function resolveDirectionalAnchorExtents(
  anchor: string,
  halfWidth: number,
  halfHeight: number
): { left: number; right: number; up: number; down: number } {
  const normalized = anchor.trim().toLowerCase().replaceAll("_", " ");
  const hasEast = normalized.includes("east");
  const hasWest = normalized.includes("west");
  const hasNorth = normalized.includes("north");
  const hasSouth = normalized.includes("south");

  const left = hasEast ? halfWidth * 2 : hasWest ? 0 : halfWidth;
  const right = hasWest ? halfWidth * 2 : hasEast ? 0 : halfWidth;
  const up = hasSouth ? halfHeight * 2 : hasNorth ? 0 : halfHeight;
  const down = hasNorth ? halfHeight * 2 : hasSouth ? 0 : halfHeight;

  return { left, right, up, down };
}

export function evaluateNodeItem(
  item: NodeItem,
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  segment: PlacementSegment | null,
  forcedName?: string,
  defaultPositionFraction?: number,
  defaultTargetWorldPoint?: WorldPoint,
  baseStyleChain?: StyleChainEntry[],
  placementOptions: { allowImplicitOriginHandle?: boolean; explicitAtSyntax?: boolean; textMode?: "text" | "math" } = {}
): {
  behindElements: SceneElement[];
  frontElements: SceneElement[];
} {
  const frame = context.stack[context.stack.length - 1];
  const effectiveBaseStyleChain = baseStyleChain ?? frame.styleChain;
  const everyNodeStyles = item.adornment ? [] : frame.everyNodeStyles;
  const everyFitStyles = item.adornment ? [] : frame.everyFitStyles;
  const nodeOptions = withDefaultNodePosition(item.options, defaultPositionFraction);
  let effectiveNodeOptions = resolveEffectiveNodeOptions({
    statementOptions: statement.options,
    nodeOptions,
    everyNodeStyles,
    everyFitStyles,
    everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
    everyCircleNodeStyles: frame.everyCircleNodeStyles,
    everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
    everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
    everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
    everyKiteNodeStyles: frame.everyKiteNodeStyles,
    everyDartNodeStyles: frame.everyDartNodeStyles,
    everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
    everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
    everyCloudNodeStyles: frame.everyCloudNodeStyles,
    everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
    everySignalNodeStyles: frame.everySignalNodeStyles,
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });
  let effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
    statementOptions: undefined,
    nodeOptions,
    everyNodeStyles,
    everyFitStyles,
    everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
    everyCircleNodeStyles: frame.everyCircleNodeStyles,
    everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
    everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
    everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
    everyKiteNodeStyles: frame.everyKiteNodeStyles,
    everyDartNodeStyles: frame.everyDartNodeStyles,
    everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
    everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
    everyCloudNodeStyles: frame.everyCloudNodeStyles,
    everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
    everySignalNodeStyles: frame.everySignalNodeStyles,
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });
  let expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
  let expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);

  const fitOverrides = resolveFitOverrides(expandedNodeOptions, context);
  if (fitOverrides.hasFit) {
    markFeature("fit_node", fitOverrides.overrideOptions ? "supported" : "unsupported");
    for (const diagnostic of fitOverrides.diagnostics) {
      pushDiagnostic(diagnostic.code, diagnostic.message, item.span.from, item.span.to);
    }
    const fitSyntheticOptions = fitOverrides.overrideOptions ? [fitOverrides.overrideOptions] : [];

    effectiveNodeOptions = resolveEffectiveNodeOptions({
      statementOptions: statement.options,
      nodeOptions,
      everyNodeStyles,
      everyFitStyles,
      applyEveryFitStyles: true,
      syntheticOptions: fitSyntheticOptions,
      everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
      everyCircleNodeStyles: frame.everyCircleNodeStyles,
      everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
      everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
      everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
      everyKiteNodeStyles: frame.everyKiteNodeStyles,
      everyDartNodeStyles: frame.everyDartNodeStyles,
      everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
      everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
      everyCloudNodeStyles: frame.everyCloudNodeStyles,
      everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
      everySignalNodeStyles: frame.everySignalNodeStyles,
      everyTapeNodeStyles: frame.everyTapeNodeStyles,
      everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
      everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
      everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
      everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
      everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
    });
    effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
      statementOptions: undefined,
      nodeOptions,
      everyNodeStyles,
      everyFitStyles,
      applyEveryFitStyles: true,
      syntheticOptions: fitSyntheticOptions,
      everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
      everyCircleNodeStyles: frame.everyCircleNodeStyles,
      everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
      everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
      everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
      everyKiteNodeStyles: frame.everyKiteNodeStyles,
      everyDartNodeStyles: frame.everyDartNodeStyles,
      everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
      everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
      everyCloudNodeStyles: frame.everyCloudNodeStyles,
      everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
      everySignalNodeStyles: frame.everySignalNodeStyles,
      everyTapeNodeStyles: frame.everyTapeNodeStyles,
      everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
      everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
      everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
      everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
      everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
    });

    expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
    expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);
  }
  const expandedEveryTextNodePartOptions = mergeOptionLists(
    expandProvenanceOptionLayers(frame.everyTextNodePartStyles, frame, context.macroTraceCollector ?? undefined).map(
      (layer) => layer.options
    )
  );
  const rectangleSplitOptions = mergeOptionLists([expandedEveryTextNodePartOptions, expandedNodeOptions]);

  const nodeDecorationBaseStyle: ResolvedStyle = {
    ...style,
    decoration: {
      ...style.decoration,
      enabled: false,
      params: { ...style.decoration.params }
    },
    decorationPreActions: [],
    decorationPostActions: []
  };
  const nodeLocalStyle = resolveNodeStyle(expandedNodeLocalOptions, nodeDecorationBaseStyle, context, 1);
  const nodeShape = resolveNodeShape(expandedNodeOptions);
  const commandNodeOptions = fitOverrides.overrideOptions
    ? resolveEffectiveNodeOptions({
        statementOptions: undefined,
        nodeOptions,
        everyNodeStyles: [],
        everyFitStyles: [],
        syntheticOptions: [fitOverrides.overrideOptions],
        everyRectangleNodeStyles: [],
        everyCircleNodeStyles: [],
        everyDiamondNodeStyles: [],
        everyTrapeziumNodeStyles: [],
        everyIsoscelesTriangleNodeStyles: [],
        everyKiteNodeStyles: [],
        everyDartNodeStyles: [],
        everyCircularSectorNodeStyles: [],
        everyCylinderNodeStyles: [],
        everyCloudNodeStyles: [],
        everyStarburstNodeStyles: [],
        everySignalNodeStyles: [],
        everyTapeNodeStyles: [],
        everyRectangleCalloutNodeStyles: [],
        everyEllipseCalloutNodeStyles: [],
        everyCloudCalloutNodeStyles: [],
        everySingleArrowNodeStyles: [],
        everyDoubleArrowNodeStyles: []
      })
    : nodeOptions;

  const nodeStyleTrace = resolveNodeStyleTrace({
    item,
    statement,
    context,
    baseStyle: style,
    baseStyleChain: effectiveBaseStyleChain,
    nodeShape,
    nodeOptions: commandNodeOptions,
    applyEveryFitStyles: fitOverrides.hasFit,
    transformScale: 1
  });
  const nodeStyle = nodeStyleTrace.style;
  const nodeStyleChain = nodeStyleTrace.chain;
  const anchor =
    resolveAutoNodeAnchor(expandedNodeOptions, segment, effectiveBaseStyleChain) ??
    resolveNodeAnchor(expandedNodeOptions);
  const statementHasTreeChildren = statement.items.some((candidate) => candidate.kind === "ChildOperation");
  const isSyntheticTreeChildStatement = statement.id.includes(":tree-child:");
  const shouldUseStatementSourceId =
    item.adornment != null ||
    statement.command === "node" ||
    statementHasTreeChildren ||
    isSyntheticTreeChildStatement;
  const nodeSourceId = shouldUseStatementSourceId ? statement.id : item.id;
  const nodeHandleSourceId = item.adornment
    ? makeNodeAdornmentTargetId(item.adornment.ownerNodeId, item.adornment.adornmentIndex, item.adornment.kind)
    : nodeSourceId;
  const target = resolveNodeTargetPoint(
    item,
    context,
    nodeHandleSourceId,
    item.span,
    pushDiagnostic,
    expandedNodeOptions,
    segment,
    defaultTargetWorldPoint,
    placementOptions
  );
  const resolvedPositioning = resolveNodePositioningTarget(expandedNodeOptions, context, target);
  for (const code of resolvedPositioning.diagnostics) {
    pushDiagnostic(code, `Node positioning issue: ${code}`, item.span.from, item.span.to);
  }

  const expandedNodeText = expandMacroBindings(item.text, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const resolvedNodeText = normalizeEscapedTextSpaces(resolveTextColorAliases(expandedNodeText, context, statement.id));
  const rawNodeParts = isMultipartShape(nodeShape) ? parseNodeParts(resolvedNodeText) : [{ name: "text", text: resolvedNodeText }];
  const mainNodeText = rawNodeParts.find((part) => part.name === "text")?.text ?? "";
  const normalizedNodeText = normalizeNodeTextFontSize(mainNodeText, nodeStyle.fontSize);
  let layoutNodeText = normalizedNodeText.text;
  if (nodeShape === "circle split" || nodeShape === "ellipse split" || nodeShape === "diamond split") {
    const lower = rawNodeParts.find((part) => part.name === "lower") ?? rawNodeParts.find((part) => part.name !== "text");
    if (lower && lower.text.length > 0) {
      const normalizedLower = normalizeNodeTextFontSize(lower.text, nodeStyle.fontSize);
      layoutNodeText = `${normalizedNodeText.text}\\\\${normalizedLower.text}`;
    }
  } else if (nodeShape === "circle solidus") {
    const lower = rawNodeParts.find((part) => part.name === "lower") ?? rawNodeParts.find((part) => part.name !== "text");
    if (lower && lower.text.length > 0) {
      const normalizedLower = normalizeNodeTextFontSize(lower.text, nodeStyle.fontSize);
      layoutNodeText = `${normalizedNodeText.text}\\\\${normalizedLower.text}`;
    } else {
      layoutNodeText = normalizedNodeText.text;
    }
  } else if (nodeShape === "rectangle split") {
    const partCount = Math.max(1, resolveRectangleSplitParts(rectangleSplitOptions));
    const horizontal = resolveRectangleSplitHorizontal(rectangleSplitOptions);
    const ignoreEmpty = resolveRectangleSplitIgnoreEmptyParts(rectangleSplitOptions);
    const partTextsBase = resolveRectangleSplitPartTexts(rawNodeParts, partCount);
    const partTexts = (ignoreEmpty ? partTextsBase.filter((partText) => partText.length > 0) : partTextsBase).map(
      (partText) => normalizeNodeTextFontSize(partText, nodeStyle.fontSize).text
    );
    layoutNodeText = partTexts.join(horizontal ? " " : "\\\\");
  }
  const nodeTextStyle = normalizedNodeText.fontSizePt === nodeStyle.fontSize
    ? nodeStyle
    : { ...nodeStyle, fontSize: normalizedNodeText.fontSizePt };

  const matrixMode = resolveMatrixMode(effectiveNodeOptions);
  if (matrixMode.enabled) {
    return evaluateMatrixNodeItem({
      item,
      statement,
      context,
      style,
      markFeature,
      pushDiagnostic,
      forcedName,
      matrixMode,
      nodeShape,
      nodeStyle,
      nodeStyleChain,
      effectiveNodeOptions,
      effectiveNodeLocalOptions,
      inheritedTransformScale: 1,
      resolvedPositioning,
      fallbackAnchor: resolvedPositioning.anchorOverride ?? anchor,
      evaluateNestedNode: (matrixCellItem, defaultTargetWorldPoint) =>
        evaluateNodeItem(
          matrixCellItem,
          statement,
          context,
          style,
          markFeature,
          pushDiagnostic,
          null,
          undefined,
          undefined,
          defaultTargetWorldPoint,
          effectiveBaseStyleChain,
          { allowImplicitOriginHandle: false, textMode: matrixMode.textMode }
        )
    });
  }

  const baseNodeLayout = resolveNodeLayout(
    layoutNodeText,
    expandedNodeOptions,
    nodeTextStyle,
    1,
    context.textEngine,
    placementOptions.textMode ?? "text"
  );
  const adjustedNodeLayout = adjustNodeLayoutForShape(baseNodeLayout, nodeShape);
  const shapeGeometry = resolveNodeShapeGeometryParams(expandedNodeOptions, () => context.mathRandom.nextRaw());
  const twoPartShapeSizing = resolveTwoPartShapeSizing({
    nodeShape,
    rawNodeParts,
    options: expandedNodeOptions,
    style: nodeTextStyle,
    textMode: placementOptions.textMode ?? "text",
    context,
    baseLayout: adjustedNodeLayout
  });
  const twoPartVisual = twoPartShapeSizing
    ? resolveTwoPartShapeVisual(nodeShape, twoPartShapeSizing, shapeGeometry.diamondAspect)
    : null;
  const rectangleSplitLayout =
    nodeShape === "rectangle split"
      ? resolveRectangleSplitLayoutGeometry({
          rawNodeParts,
          options: rectangleSplitOptions,
          style: nodeTextStyle,
          textMode: placementOptions.textMode ?? "text",
          context,
          baseLayout: adjustedNodeLayout
        })
      : null;
  const nodeLayout = rectangleSplitLayout
    ? {
        ...adjustedNodeLayout,
        visualWidth: rectangleSplitLayout.width,
        visualHeight: rectangleSplitLayout.height,
        visualRadius: Math.max(rectangleSplitLayout.width, rectangleSplitLayout.height) / 2,
        anchorHalfWidth: rectangleSplitLayout.width / 2 + adjustedNodeLayout.outerXSep,
        anchorHalfHeight: rectangleSplitLayout.height / 2 + adjustedNodeLayout.outerYSep,
        anchorRadius: Math.max(
          rectangleSplitLayout.width / 2 + adjustedNodeLayout.outerXSep,
          rectangleSplitLayout.height / 2 + adjustedNodeLayout.outerYSep
        )
      }
    : twoPartVisual
      ? {
          ...adjustedNodeLayout,
          visualWidth: twoPartVisual.width,
          visualHeight: twoPartVisual.height,
          visualRadius: twoPartVisual.radius,
          anchorHalfWidth: twoPartVisual.width / 2 + adjustedNodeLayout.outerXSep,
          anchorHalfHeight: twoPartVisual.height / 2 + adjustedNodeLayout.outerYSep,
          anchorRadius: Math.max(
            twoPartVisual.width / 2 + adjustedNodeLayout.outerXSep,
            twoPartVisual.height / 2 + adjustedNodeLayout.outerYSep
          ),
          twoPartShapeSizing: twoPartShapeSizing ?? undefined
        }
    : adjustedNodeLayout;
  const slopedRotation = resolveSlopedNodeRotation(expandedNodeOptions, segment, effectiveBaseStyleChain);
  const inheritedNodeTransform: WorldTransform = frame.transformShape
    ? worldTransform(frame.transform.a, frame.transform.b, frame.transform.c, frame.transform.d, 0, 0)
    : identityMatrix();
  const nodeOptionTransform = resolveNodeOptionTransform(expandedNodeLocalOptions, style, context);
  const baseNodeTransform = multiplyMatrix(inheritedNodeTransform, nodeOptionTransform);
  const nodeTransform =
    slopedRotation != null && Math.abs(slopedRotation) > 1e-6
      ? multiplyMatrix(baseNodeTransform, rotationMatrix(slopedRotation))
      : baseNodeTransform;
  const center = placeNodeCenter(
    resolvedPositioning.anchorPoint,
    nodeShape,
    nodeLayout,
    resolvedPositioning.anchorOverride ?? anchor,
    expandedNodeOptions,
    nodeTransform
  );
  // Create positioning handle now that we have center and nodeLayout for the current node (B)
  if (resolvedPositioning.relativePlacement) {
    const rp = resolvedPositioning.relativePlacement;
    const dir = rp.direction;
    const isBaseOrMid = dir.startsWith("base ") || dir.startsWith("mid ");
    if (!isBaseOrMid) {
      // Remove any implicit origin handle that resolveNodeTargetPoint created for this node
      const implicitIdx = context.editHandles.findIndex(
        (h) => h.sourceRef.sourceId === nodeHandleSourceId && h.kind === "node-position"
      );
      if (implicitIdx !== -1) {
        context.editHandles.splice(implicitIdx, 1);
      }

      // Look up target node's geometry for anchor compensation
      const targetGeom = readNamedNodeGeometry(context, rp.targetNodeName);

      const sourceText = context.source.slice(rp.span.from, rp.span.to);
      context.editHandles.push({
        id: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
        runtimeId: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
        sourceRef: {
          sourceId: nodeHandleSourceId,
          sourceSpan: rp.span,
          sourceFingerprint: context.sourceFingerprint
        },
        handleType: "node-positioning",
        kind: "node-position",
        world: center,
        transform: frame?.transform ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        sourceText,
        coordinateForm: "cartesian",
        rewriteMode: "positioning",
        positioningContext: {
          direction: rp.direction,
          targetNodeName: rp.targetNodeName,
          targetCenter: rp.targetCenter,
          currentCenter: center,
          legacyOf: rp.legacyOf,
          anchorOffsetsByDirection: computePositioningAnchorOffsetsByDirection({
            targetNodeName: rp.targetNodeName,
            targetCenter: rp.targetCenter,
            currentCenter: center,
            context,
            legacyOf: rp.legacyOf,
            nodeShape,
            nodeLayout,
            nodeOptions: expandedNodeOptions,
            nodeTransform
          }),
          targetAnchorHW: targetGeom?.anchorHalfWidth ?? 0,
          targetAnchorHH: targetGeom?.anchorHalfHeight ?? 0,
          currentAnchorHW: nodeLayout.anchorHalfWidth,
          currentAnchorHH: nodeLayout.anchorHalfHeight
        }
      });
    }
  }

  const pathAttachmentMetadata: ScenePathAttachment | null =
    !item.adornment &&
    segment &&
    !resolvedPositioning.relativePlacement &&
    !item.atRaw &&
    !expandedNodeOptions?.entries.some((entry) => entry.kind === "kv" && entry.key === "at")
      ? (() => {
          const regime = resolvePathAttachedNodeRegime(expandedNodeOptions, effectiveBaseStyleChain);
          if (!regime) {
            return null;
          }
          const pos = resolvePathPositionFraction(expandedNodeOptions) ?? 0.5;
          return {
            hostPathSourceId: statement.id,
            nodeSourceId: nodeSourceId,
            segment,
            pos,
            regime,
            sloped: resolvePathAttachedNodeSloped(expandedNodeOptions, effectiveBaseStyleChain)
          } satisfies ScenePathAttachment;
        })()
      : null;

  if (pathAttachmentMetadata) {
    const sourceText = context.source.slice(item.span.from, item.span.to);
      context.editHandles.push({
        id: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
        runtimeId: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
      sourceRef: {
        sourceId: nodeHandleSourceId,
        sourceSpan: item.optionsSpan ?? item.span,
        sourceFingerprint: context.sourceFingerprint
      },
        handleType: "path-attachment",
        kind: "node-position",
        world: center,
        transform: frame?.transform ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      sourceText,
      coordinateForm: "cartesian",
      rewriteMode: "positioning",
      pathAttachmentContext: {
        hostPathSourceId: pathAttachmentMetadata.hostPathSourceId,
        segment: pathAttachmentMetadata.segment,
        pos: pathAttachmentMetadata.pos,
        regime: pathAttachmentMetadata.regime,
        sloped: pathAttachmentMetadata.sloped
      }
    });
  }

  const setNames = collectSetNames(expandedNodeOptions);
  let scopedNames = collectScopedNodeNames(forcedName ?? item.name, item.aliases, context);
  if (scopedNames.length === 0 && setNames.length > 0) {
    scopedNames = collectScopedNodeNames(makeGeneratedSetMemberName(item), undefined, context);
  }

  for (const name of scopedNames) {
    registerNamedNodeAnchors(context, name, center, nodeShape, nodeLayout, expandedNodeOptions, nodeTransform, nodeSourceId);
  }
  registerNodeSetMembership(scopedNames, setNames, context);

  const nodeElementTransform = resolveNodeElementTransform(center, nodeTransform);
  const nodeElements: SceneElement[] = [];
  const pushNodeElement = (element: SceneElement): void => {
    const rotatedElement = rotateNodeElementGeometry(element, center, 0);
    rotatedElement.styleChain = cloneStyleChain(nodeStyleChain);
    rotatedElement.transform = nodeElementTransform;
    nodeElements.push(rotatedElement);
  };
  const explicitPaintMode = resolveNodeBoxPaintMode(expandedNodeLocalOptions);
  const resolvedPaintMode = {
    draw:
      explicitPaintMode.draw ||
      (!style.drawExplicit && nodeStyle.drawExplicit && nodeStyle.stroke != null && nodeStyle.stroke !== "none"),
    fill:
      explicitPaintMode.fill ||
      ((style.fill == null || style.fill === "none") && nodeStyle.fill != null && nodeStyle.fill !== "none")
  };
  if (resolvedPaintMode.draw || resolvedPaintMode.fill || nodeStyle.shadowLayers.length > 0) {
    const nodeBoxStyle = applyNodeBoxPaintMode(nodeStyle, resolvedPaintMode);
    const nodeDividerStyle: ResolvedStyle = {
      ...nodeBoxStyle,
      fill: null,
      fillPattern: null,
      doubleStroke: false,
      doubleDistance: 0
    };
    const calloutWorldPointerOffset = resolveCalloutPointerOffset(shapeGeometry, context, center);
    if (nodeShape === "rounded rectangle") {
      pushNodeElement(
        makeNodeRoundedRectangleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          nodeLayout.textBlockWidth,
          nodeLayout.textBlockHeight,
          Math.max(0, (nodeLayout.naturalWidth - nodeLayout.textBlockWidth) / 2),
          Math.max(0, (nodeLayout.naturalHeight - nodeLayout.textBlockHeight) / 2),
          shapeGeometry.roundedRectangleArcLength,
          shapeGeometry.roundedRectangleWestArc,
          shapeGeometry.roundedRectangleEastArc,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_rounded_rectangle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "chamfered rectangle") {
      pushNodeElement(
        makeNodeChamferedRectangleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.chamferedRectangleXSepPt,
          shapeGeometry.chamferedRectangleYSepPt,
          shapeGeometry.chamferedRectangleAngle,
          shapeGeometry.chamferedRectangleCorners,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_chamfered_rectangle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cross out") {
      const halfWidth = nodeLayout.visualWidth / 2;
      const halfHeight = nodeLayout.visualHeight / 2;
      pushNodeElement(
        makeNodeLineElement(
          nodeSourceId,
          `${item.id}:cross-a`,
          wp(center.x - halfWidth, center.y - halfHeight),
          wp(center.x + halfWidth, center.y + halfHeight),
          nodeDividerStyle,
          item.span
        )
      );
      pushNodeElement(
        makeNodeLineElement(
          nodeSourceId,
          `${item.id}:cross-b`,
          wp(center.x - halfWidth, center.y + halfHeight),
          wp(center.x + halfWidth, center.y - halfHeight),
          nodeDividerStyle,
          item.span
        )
      );
      markFeature("shape_cross_out", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "strike out") {
      const halfWidth = nodeLayout.visualWidth / 2;
      const halfHeight = nodeLayout.visualHeight / 2;
      pushNodeElement(
        makeNodeLineElement(
          nodeSourceId,
          `${item.id}:strike`,
          wp(center.x - halfWidth, center.y - halfHeight),
          wp(center.x + halfWidth, center.y + halfHeight),
          nodeDividerStyle,
          item.span
        )
      );
      markFeature("shape_strike_out", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "magnifying glass") {
      pushNodeElement(makeCircleElement(nodeSourceId, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      pushNodeElement(
        makeNodeMagnifyingHandleElement(
          nodeSourceId,
          `${item.id}:handle`,
          center,
          nodeLayout.visualRadius,
          shapeGeometry.magnifyingGlassHandleAngle,
          shapeGeometry.magnifyingGlassHandleAspect,
          { ...nodeBoxStyle, fill: null },
          item.span
        )
      );
      markFeature("shape_magnifying_glass", "supported");
      markFeature("svg_circle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "circle split" || nodeShape === "circle solidus") {
      pushNodeElement(makeCircleElement(nodeSourceId, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      const r = nodeLayout.visualRadius;
      if (nodeShape === "circle split") {
        pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:split`,
            wp(center.x - r, center.y),
            wp(center.x + r, center.y),
            nodeDividerStyle,
            item.span
          )
        );
        markFeature("shape_circle_split", "supported");
      } else {
        pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:solidus`,
            wp(center.x - r * 0.437, center.y - r * 0.437),
            wp(center.x + r * 0.437, center.y + r * 0.437),
            nodeDividerStyle,
            item.span
          )
        );
        markFeature("shape_circle_solidus", "supported");
      }
      markFeature("svg_circle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "ellipse split") {
      pushNodeElement(makeNodeEllipseElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:split`,
            wp(center.x - nodeLayout.visualWidth / 2, center.y),
            wp(center.x + nodeLayout.visualWidth / 2, center.y),
            nodeDividerStyle,
            item.span
          )
        );
      markFeature("shape_ellipse_split", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "diamond split") {
      if (twoPartShapeSizing) {
        pushNodeElement(
          makeNodeDiamondSplitElement(
            nodeSourceId,
            item.id,
            center,
            twoPartShapeSizing,
            shapeGeometry.diamondAspect,
            nodeBoxStyle,
            item.span
          )
        );
      } else {
        pushNodeElement(
          makeNodeDiamondSizingElement(
            nodeSourceId,
            item.id,
            center,
            nodeLayout.naturalWidth,
            nodeLayout.naturalHeight,
            nodeLayout.minimumWidth,
            nodeLayout.minimumHeight,
            shapeGeometry.diamondAspect,
            nodeBoxStyle,
            item.span
          )
        );
      }
      pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:split`,
            wp(center.x - nodeLayout.visualWidth / 2, center.y),
            wp(center.x + nodeLayout.visualWidth / 2, center.y),
            nodeDividerStyle,
            item.span
          )
        );
      markFeature("shape_diamond_split", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle split") {
      const parts = Math.max(1, resolveRectangleSplitParts(rectangleSplitOptions));
      const horizontal = resolveRectangleSplitHorizontal(rectangleSplitOptions);
      const splitLayout = rectangleSplitLayout ?? resolveRectangleSplitLayoutGeometry({
        rawNodeParts,
        options: rectangleSplitOptions,
        style: nodeTextStyle,
        textMode: placementOptions.textMode ?? "text",
        context,
        baseLayout: nodeLayout
      });
      const effectiveSplitWidth = splitLayout.width;
      const effectiveSplitHeight = splitLayout.height;
      const useCustomFill = resolveRectangleSplitUseCustomFill(expandedNodeOptions);
      const drawSplits = resolveRectangleSplitDrawSplits(expandedNodeOptions);
      const partFills = resolveRectangleSplitPartFills(expandedNodeOptions, context, statement.id, nodeTextStyle.textColor ?? "#000000");
      const segments = splitLayout.segments.map((segment) => ({
        ...segment,
        center: wp(center.x + segment.center.x, center.y + segment.center.y),
        minX: center.x + segment.minX,
        maxX: center.x + segment.maxX,
        minY: center.y + segment.minY,
        maxY: center.y + segment.maxY
      }));
      if (useCustomFill && partFills.length > 0) {
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          const fill = partFills[Math.min(index, partFills.length - 1)] ?? null;
          if (!fill || fill === "none") {
            continue;
          }
          pushNodeElement(
            makeNodeBoxElement(
              nodeSourceId,
              `${item.id}:part-fill-${index + 1}`,
              segment.center,
              segment.width,
              segment.height,
              {
                ...nodeBoxStyle,
                stroke: null,
                drawExplicit: false,
                fill,
                fillPattern: null,
                doubleStroke: false,
                doubleDistance: 0
              },
              item.span
            )
          );
        }
        pushNodeElement(
          makeNodeBoxElement(
            nodeSourceId,
            `${item.id}:border`,
            center,
            effectiveSplitWidth,
            effectiveSplitHeight,
            { ...nodeDividerStyle, fill: null, fillPattern: null, drawExplicit: true },
            item.span
          )
        );
      } else {
        pushNodeElement(makeNodeBoxElement(nodeSourceId, item.id, center, effectiveSplitWidth, effectiveSplitHeight, nodeBoxStyle, item.span));
      }
      if (parts > 1) {
        for (let index = 1; index < segments.length; index += 1) {
          if (drawSplits) {
            const previous = segments[index - 1];
            const current = segments[index];
            if (horizontal) {
              const x = (previous.maxX + current.minX) / 2;
              pushNodeElement(
                makeNodeLineElement(
                  nodeSourceId,
                  `${item.id}:split-${index}`,
                  wp(x, center.y - effectiveSplitHeight / 2),
                  wp(x, center.y + effectiveSplitHeight / 2),
                  nodeDividerStyle,
                  item.span
                )
              );
            } else {
              const y = (previous.minY + current.maxY) / 2;
              pushNodeElement(
                makeNodeLineElement(
                  nodeSourceId,
                  `${item.id}:split-${index}`,
                  wp(center.x - effectiveSplitWidth / 2, y),
                  wp(center.x + effectiveSplitWidth / 2, y),
                  nodeDividerStyle,
                  item.span
                )
              );
            }
          }
        }
      }
      markFeature("shape_rectangle_split", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "circle") {
      pushNodeElement(makeCircleElement(nodeSourceId, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      markFeature("shape_circle", "supported");
      markFeature("svg_circle", "supported");
    } else if (nodeShape === "ellipse") {
      pushNodeElement(makeNodeEllipseElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_ellipse", "supported");
    } else if (nodeShape === "diamond") {
      pushNodeElement(
        makeNodeDiamondSizingElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.diamondAspect,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_diamond", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "trapezium") {
      pushNodeElement(
        makeNodeTrapeziumElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.trapeziumLeftAngle,
          shapeGeometry.trapeziumRightAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.trapeziumStretches,
          shapeGeometry.trapeziumStretchesBody,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_trapezium", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "semicircle") {
      pushNodeElement(
        makeNodeSemicircleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_semicircle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "isosceles triangle") {
      pushNodeElement(
        makeNodeIsoscelesTriangleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.isoscelesTriangleApexAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.isoscelesTriangleStretches,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_isosceles_triangle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "kite") {
      pushNodeElement(
        makeNodeKiteElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.kiteUpperVertexAngle,
          shapeGeometry.kiteLowerVertexAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_kite", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "dart") {
      pushNodeElement(
        makeNodeDartElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.dartTipAngle,
          shapeGeometry.dartTailAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_dart", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "circular sector") {
      pushNodeElement(
        makeNodeCircularSectorElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.circularSectorAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_circular_sector", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cylinder") {
      pushNodeElement(
        makeNodeCylinderElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          Math.max(0, (nodeLayout.naturalHeight - nodeLayout.textBlockHeight) / 2),
          shapeGeometry.cylinderAspect,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cylinder", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "regular polygon") {
      pushNodeElement(
        makeNodeRegularPolygonElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.regularPolygonSides,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_regular_polygon", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "star") {
      pushNodeElement(
        makeNodeStarElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.starPoints,
          shapeGeometry.starPointRatio,
          shapeGeometry.starPointHeightPt,
          shapeGeometry.starUsesPointRatio,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_star", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cloud") {
      pushNodeElement(
        makeNodeCloudElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.cloudPuffs,
          shapeGeometry.cloudPuffArc,
          shapeGeometry.diamondAspect,
          shapeGeometry.cloudIgnoresAspect,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cloud", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "starburst") {
      pushNodeElement(
        makeNodeStarburstElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.starburstPoints,
          shapeGeometry.starburstPointHeightPt,
          shapeGeometry.randomStarburstSeed,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_starburst", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "signal") {
      pushNodeElement(
        makeNodeSignalElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.signalPointerAngle,
          shapeGeometry.signalToSides,
          shapeGeometry.signalFromSides,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_signal", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "tape") {
      pushNodeElement(
        makeNodeTapeElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.tapeBendTop,
          shapeGeometry.tapeBendBottom,
          shapeGeometry.tapeBendHeightPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_tape", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle callout") {
      pushNodeElement(
        makeNodeRectangleCalloutElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          calloutWorldPointerOffset,
          shapeGeometry.calloutPointerWidthPt,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_rectangle_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "ellipse callout") {
      pushNodeElement(
        makeNodeEllipseCalloutElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.visualWidth,
          nodeLayout.visualHeight,
          0,
          0,
          calloutWorldPointerOffset,
          shapeGeometry.calloutPointerArc,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_ellipse_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cloud callout") {
      pushNodeElement(
        makeNodeCloudCalloutElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.cloudPuffs,
          shapeGeometry.cloudPuffArc,
          shapeGeometry.diamondAspect,
          shapeGeometry.cloudIgnoresAspect,
          shapeGeometry.shapeBorderRotate,
          calloutWorldPointerOffset,
          shapeGeometry.calloutPointerStartSizeRaw,
          shapeGeometry.calloutPointerEndSizeRaw,
          shapeGeometry.calloutPointerSegments,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cloud_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "single arrow") {
      pushNodeElement(
        makeNodeSingleArrowElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.singleArrowTipAngle,
          shapeGeometry.singleArrowHeadExtendPt,
          shapeGeometry.singleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_single_arrow", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "double arrow") {
      pushNodeElement(
        makeNodeDoubleArrowElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.doubleArrowTipAngle,
          shapeGeometry.doubleArrowHeadExtendPt,
          shapeGeometry.doubleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_double_arrow", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle") {
      pushNodeElement(makeNodeBoxElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_rectangle", "supported");
      markFeature("svg_path", "supported");
    }
  }

  const renderedNodeText = nodeLayout.textLines.join("\n");
  const isTwoPartSplitShape =
    nodeShape === "circle split" || nodeShape === "circle solidus" || nodeShape === "ellipse split" || nodeShape === "diamond split";
  const hasMultipartSecondaryParts =
    isMultipartShape(nodeShape) && rawNodeParts.some((part) => part.name !== "text" && part.text.length > 0);
  if (renderedNodeText.length > 0 && !hasMultipartSecondaryParts && !isTwoPartSplitShape) {
    pushNodeElement(
      makeTextElement(
        nodeSourceId,
        item.id,
        center,
        nodeTextStyle,
        item.span,
        renderedNodeText,
        nodeLayout.textBlockWidth,
        nodeLayout.textBlockHeight,
        nodeLayout.visualWidth,
        nodeLayout.visualHeight,
        nodeLayout.textRenderInfo,
        undefined,
        undefined,
        item.textSpan,
        hasTextWidthOption(expandedNodeOptions)
      )
    );
    markFeature("svg_text", "supported");
  }

  if (isMultipartShape(nodeShape)) {
    const parts = rawNodeParts.filter((part) => part.name !== "text" && part.text.length > 0);
    if (parts.length > 0 || isTwoPartSplitShape) {
      if (nodeShape === "circle split" || nodeShape === "ellipse split" || nodeShape === "diamond split") {
        const splitTextStyle: ResolvedStyle = nodeTextStyle;
        if (mainNodeText.length > 0) {
          const upperLayout = resolveNodeLayout(
            mainNodeText,
            expandedNodeOptions,
            splitTextStyle,
            1,
            context.textEngine,
            placementOptions.textMode ?? "text"
          );
          pushNodeElement(
            makeTextElement(
              nodeSourceId,
              `${item.id}:upper`,
              resolveTwoPartSplitTextPosition({
                nodeShape,
                nodeLayout,
                partLayout: upperLayout,
                center,
                anchor: "text",
                options: expandedNodeOptions,
                lineWidth: nodeStyle.lineWidth
              }),
              splitTextStyle,
              item.span,
              mainNodeText,
              upperLayout.textBlockWidth,
              upperLayout.textBlockHeight,
              nodeLayout.visualWidth,
              nodeLayout.visualHeight,
              upperLayout.textRenderInfo,
              undefined,
              undefined,
              item.textSpan,
              hasTextWidthOption(expandedNodeOptions)
            )
          );
        }
        const lower = parts.find((part) => part.name === "lower") ?? parts[0];
        if (lower) {
          const lowerLayout = resolveNodeLayout(
            lower.text,
            expandedNodeOptions,
            splitTextStyle,
            1,
            context.textEngine,
            placementOptions.textMode ?? "text"
          );
          pushNodeElement(
            makeTextElement(
              nodeSourceId,
              `${item.id}:lower`,
              resolveTwoPartSplitTextPosition({
                nodeShape,
                nodeLayout,
                partLayout: lowerLayout,
                center,
                anchor: "lower",
                options: expandedNodeOptions,
                lineWidth: nodeStyle.lineWidth
              }),
              splitTextStyle,
              item.span,
              lower.text,
              lowerLayout.textBlockWidth,
              lowerLayout.textBlockHeight,
              nodeLayout.visualWidth,
              nodeLayout.visualHeight,
              lowerLayout.textRenderInfo,
              undefined,
              undefined,
              item.textSpan,
              hasTextWidthOption(expandedNodeOptions)
            )
          );
        }
      } else if (nodeShape === "circle solidus") {
        const solidusTextStyle: ResolvedStyle = nodeTextStyle;
        if (mainNodeText.length > 0) {
          const upperLayout = resolveNodeLayout(
            mainNodeText,
            expandedNodeOptions,
            solidusTextStyle,
            1,
            context.textEngine,
            placementOptions.textMode ?? "text"
          );
          pushNodeElement(
            makeTextElement(
              nodeSourceId,
              `${item.id}:upper`,
              wp(
                center.x - resolveCircleSolidusHorizontalTextOffset(upperLayout, nodeStyle.lineWidth),
                center.y + resolveCircleSolidusVerticalTextOffset(upperLayout, nodeStyle.lineWidth)
              ),
              solidusTextStyle,
              item.span,
              mainNodeText,
              upperLayout.textBlockWidth,
              upperLayout.textBlockHeight,
              nodeLayout.visualWidth,
              nodeLayout.visualHeight,
              upperLayout.textRenderInfo,
              undefined,
              undefined,
              item.textSpan,
              hasTextWidthOption(expandedNodeOptions)
            )
          );
        }
        const lower = parts.find((part) => part.name === "lower") ?? parts[0];
        if (lower) {
          const lowerLayout = resolveNodeLayout(
            lower.text,
            expandedNodeOptions,
            solidusTextStyle,
            1,
            context.textEngine,
            placementOptions.textMode ?? "text"
          );
          pushNodeElement(
            makeTextElement(
              nodeSourceId,
              `${item.id}:lower`,
              wp(
                center.x + resolveCircleSolidusHorizontalTextOffset(lowerLayout, nodeStyle.lineWidth),
                center.y - resolveCircleSolidusVerticalTextOffset(lowerLayout, nodeStyle.lineWidth)
              ),
              solidusTextStyle,
              item.span,
              lower.text,
              lowerLayout.textBlockWidth,
              lowerLayout.textBlockHeight,
              nodeLayout.visualWidth,
              nodeLayout.visualHeight,
              lowerLayout.textRenderInfo,
              undefined,
              undefined,
              item.textSpan,
              hasTextWidthOption(expandedNodeOptions)
            )
          );
        }
      } else if (nodeShape === "rectangle split") {
        const splitLayout = rectangleSplitLayout ?? resolveRectangleSplitLayoutGeometry({
          rawNodeParts,
          options: rectangleSplitOptions,
          style: nodeTextStyle,
          textMode: placementOptions.textMode ?? "text",
          context,
          baseLayout: nodeLayout
        });
        const effectiveSplitWidth = splitLayout.width;
        const effectiveSplitHeight = splitLayout.height;
        for (let index = 0; index < splitLayout.parts.length; index += 1) {
          const part = splitLayout.parts[index];
          const partText = part.text;
          if (partText.length === 0) {
            continue;
          }
          const partLayout = part.layout;
          const position = resolveRectangleSplitPartTextPosition({
            splitLayout,
            index,
            center
          });
          pushNodeElement(
            makeTextElement(
              nodeSourceId,
              `${item.id}:part-${index + 1}`,
              position,
              splitLayout.textStyle,
              item.span,
              partText,
              partLayout.textBlockWidth,
              partLayout.textBlockHeight,
              effectiveSplitWidth,
              effectiveSplitHeight,
              partLayout.textRenderInfo,
              undefined,
              undefined,
              item.textSpan,
              hasTextWidthOption(expandedNodeOptions)
            )
          );
        }
      }
      markFeature("svg_text", "supported");
    }
  }

  const renderedNodeElements = applyNodeDecorations(
    nodeElements,
    nodeLocalStyle.decoration,
    `${nodeSourceId}:${item.id}`,
    context.mathRandom,
    markFeature,
    pushDiagnostic
  );
  const adornmentMetadata = item.adornment;
  const editableNodeElements = renderedNodeElements.map((element) => {
    const withAdornment = adornmentMetadata ? attachAdornmentMetadata(element, adornmentMetadata, center) : element;
    return pathAttachmentMetadata ? attachPathAttachmentMetadata(withAdornment, pathAttachmentMetadata) : withAdornment;
  });
  const layer = resolveNodeLayer(expandedNodeOptions, context);
  if (layer === "behind") {
    return { behindElements: editableNodeElements, frontElements: [] };
  }
  return { behindElements: [], frontElements: editableNodeElements };
}

function attachAdornmentMetadata(
  element: SceneElement,
  adornment: NonNullable<NodeItem["adornment"]>,
  ownerPoint: WorldPoint
): SceneElement {
  const metadata: SceneAdornment = {
    targetId: makeNodeAdornmentTargetId(adornment.ownerNodeId, adornment.adornmentIndex, adornment.kind),
    kind: adornment.kind,
    ownerSourceId: adornment.ownerSourceId,
    ownerNodeId: adornment.ownerNodeId,
    adornmentIndex: adornment.adornmentIndex,
    optionSpan: adornment.optionSpan,
    valueSpan: adornment.valueSpan,
    textSpan: adornment.textSpan,
    angleRaw: adornment.angleRaw,
    angleSpan: adornment.angleSpan,
    distancePt: adornment.distancePt,
    defaultDistancePt: adornment.defaultDistancePt,
    distanceExplicit: adornment.distanceExplicit,
    ownerPoint,
    ownerGeometry: adornment.ownerGeometry
  };

  return {
    ...element,
    adornment: metadata
  };
}

function attachPathAttachmentMetadata(
  element: SceneElement,
  pathAttachment: ScenePathAttachment
): SceneElement {
  return {
    ...element,
    pathAttachment
  };
}

function resolveNodeStyleTrace(params: {
  item: NodeItem;
  statement: PathStatement;
  context: SemanticContext;
  baseStyle: ResolvedStyle;
  baseStyleChain: StyleChainEntry[];
  nodeShape: NodeShape;
  nodeOptions: OptionListAst | undefined;
  applyEveryFitStyles?: boolean;
  transformScale: number;
}): { style: ResolvedStyle; chain: StyleChainEntry[] } {
  const frame = params.context.stack[params.context.stack.length - 1];
  const macroTrace = params.context.macroTraceCollector ?? undefined;
  const everyNodeLayers = expandProvenanceOptionLayers(frame.everyNodeStyles, frame, macroTrace);
  const everyFitLayers =
    params.applyEveryFitStyles === true
      ? expandProvenanceOptionLayers(frame.everyFitStyles, frame, macroTrace)
      : [];
  const includeEveryNodeLayers = !params.item.adornment;
  const everyShapeLayers = expandProvenanceOptionLayers(resolveEveryShapeNodeStyleLayers(frame, params.nodeShape), frame, macroTrace);
  const expandedStatementOptions = params.statement.options
    ? expandOptionListMacros([params.statement.options], frame.macroBindings, macroTrace)
    : [];
  const expandedNodeOptions = params.nodeOptions ? expandOptionListMacros([params.nodeOptions], frame.macroBindings, macroTrace) : [];
  const commandOptions = [...expandedStatementOptions, ...expandedNodeOptions];

  const layers: StyleTraceLayerInput[] = [
    ...(includeEveryNodeLayers
      ? everyNodeLayers.map(
          (layer): StyleTraceLayerInput => ({
            kind: "every-node",
            sourceRef: layer.sourceRef,
            rawOptions: [layer.options]
          })
        )
      : []),
    ...(includeEveryNodeLayers
      ? everyFitLayers.map(
          (layer): StyleTraceLayerInput => ({
            kind: "every-node",
            sourceRef: layer.sourceRef,
            rawOptions: [layer.options]
          })
        )
      : []),
    ...everyShapeLayers.map(
      (layer): StyleTraceLayerInput => ({
        kind: "every-shape",
        shape: params.nodeShape,
        sourceRef: layer.sourceRef,
        rawOptions: [layer.options]
      })
    )
  ];
  layers.push({
    kind: "command",
    sourceRef: {
      sourceId: params.item.id,
      sourceSpan: params.item.optionsSpan ?? params.item.span,
      sourceKind: "node-options",
      label: "node"
    },
    rawOptions: commandOptions
  });

  const resolved = resolveContextDelta(
    params.baseStyle,
    frame.transform,
    layers,
    cloneCustomStyleRegistry(frame.customStyles),
    (raw) => evaluateRawCoordinate(raw, params.context).world,
    params.baseStyleChain,
    (raw) => resolveContextColorAliasValue(params.context, raw)
  );

  const scaledStyle = applyNodeTransformScale(resolved.style, params.transformScale);
  const scaleContributions = diffResolvedStyle(resolved.style, scaledStyle);
  if (Object.keys(scaleContributions).length === 0) {
    return { style: scaledStyle, chain: resolved.chain };
  }

  const scaleSourceRef: StyleSourceRef = {
    sourceId: params.item.id,
    sourceSpan: params.item.span,
    sourceKind: "node-transform-scale",
    label: "node transform scale"
  };
  return {
    style: scaledStyle,
    chain: [
      ...resolved.chain,
      {
        kind: "command",
        sourceRef: scaleSourceRef,
        rawOptions: [],
        before: cloneResolvedStyle(resolved.style),
        after: cloneResolvedStyle(scaledStyle),
        resolvedContributions: scaleContributions
      }
    ]
  };
}

function applyNodeTransformScale(style: ResolvedStyle, transformScale: number): ResolvedStyle {
  if (Math.abs(transformScale - 1) <= 1e-6) {
    return style;
  }
  return {
    ...style,
    lineWidth: style.lineWidth * transformScale,
    doubleDistance: style.doubleDistance * transformScale,
    doubleLineCenterDistance: style.doubleLineCenterDistance == null ? null : style.doubleLineCenterDistance * transformScale,
    fontSize: style.fontSize * transformScale
  };
}

function expandProvenanceOptionLayers(
  layers: ProvenanceOptionList[],
  frame: SemanticContext["stack"][number],
  macroTrace: SemanticContext["macroTraceCollector"] | undefined
): ProvenanceOptionList[] {
  if (layers.length === 0) {
    return [];
  }

  const expanded: ProvenanceOptionList[] = [];
  for (const layer of layers) {
    const expandedOptions = expandOptionListMacros([layer.options], frame.macroBindings, macroTrace ?? undefined);
    if (expandedOptions.length === 0) {
      expanded.push(layer);
      continue;
    }
    for (const optionList of expandedOptions) {
      expanded.push({
        options: optionList,
        sourceRef: layer.sourceRef
      });
    }
  }
  return expanded;
}

function resolveEveryShapeNodeStyleLayers(frame: SemanticContext["stack"][number], nodeShape: NodeShape): ProvenanceOptionList[] {
  return resolveEveryShapeNodeStyleLists(nodeShape, frame);
}

function resolveAutoNodeAnchor(
  options: NodeItem["options"],
  segment: PlacementSegment | null,
  styleChain: StyleChainEntry[] = []
): string | null {
  if (!options || !segment) {
    return null;
  }

  let autoSide: "left" | "right" | null = null;
  let autoExplicit = false;
  let swap = false;
  let swapExplicit = false;
  const sloped = resolveScopedBooleanOption(options, styleChain, "sloped") ?? false;

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "auto") {
        autoExplicit = true;
        autoSide = "left";
      } else if (entry.key === "swap") {
        swapExplicit = true;
        swap = !swap;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "auto") {
      const normalized = entry.valueRaw.trim().toLowerCase();
      autoExplicit = true;
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

    if (entry.key === "swap") {
      const normalized = entry.valueRaw.trim().toLowerCase();
      swapExplicit = true;
      if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
        swap = true;
      } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
        swap = false;
      }
    }
  }

  if (!autoExplicit || !swapExplicit) {
    for (const styleEntry of styleChain) {
      for (const optionList of styleEntry.rawOptions) {
        for (const option of optionList.entries) {
          if (option.kind === "flag") {
            if (!autoExplicit && option.key === "auto") {
              autoSide = "left";
            } else if (!swapExplicit && option.key === "swap") {
              swap = !swap;
            }
            continue;
          }

          if (option.kind !== "kv") {
            continue;
          }

          if (!autoExplicit && option.key === "auto") {
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

          if (!swapExplicit && option.key === "swap") {
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
  }

  if (!autoSide) {
    return null;
  }

  if (sloped) {
    const tangent = segmentTangent(segment);
    if (!tangent) {
      return null;
    }

    let normal = wp(pt(-1 * tangent.y), tangent.x);
    if (autoSide === "right") {
      normal = wp(pt(-1 * normal.x), pt(-1 * normal.y));
    }
    if (swap) {
      normal = wp(pt(-1 * normal.x), pt(-1 * normal.y));
    }

    const slopedRotation =
      resolveSlopedNodeRotation(options, segment, styleChain) ??
      (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
    const theta = (slopedRotation * Math.PI) / 180;
    const northDirection = wp(-Math.sin(theta), Math.cos(theta));
    const dot = normal.x * northDirection.x + normal.y * northDirection.y;
    return dot >= 0 ? "south" : "north";
  }

  const tangent = segmentTangent(segment);
  if (!tangent) {
    return null;
  }

    let normal = wp(pt(-1 * tangent.y), tangent.x);
    if (autoSide === "right") {
      normal = wp(pt(-1 * normal.x), pt(-1 * normal.y));
    }
    if (swap) {
      normal = wp(pt(-1 * normal.x), pt(-1 * normal.y));
    }

  const anchorDirection = wp(pt(-1 * normal.x), pt(-1 * normal.y));
  return directionToAnchor(anchorDirection);
}

function resolveSlopedNodeRotation(
  options: NodeItem["options"],
  segment: PlacementSegment | null,
  styleChain: StyleChainEntry[] = []
): number | null {
  if (!options || !segment) {
    return null;
  }

  if (!resolveScopedBooleanOption(options, styleChain, "sloped")) {
    return null;
  }

  const tangent = segmentTangent(segment);
  if (!tangent) {
    return null;
  }

  let rotation = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
  if (!allowsUpsideDown(options, styleChain)) {
    if (rotation > 90) {
      rotation -= 180;
    } else if (rotation <= -90) {
      rotation += 180;
    }
  }
  return rotation;
}

function allowsUpsideDown(options: NodeItem["options"], styleChain: StyleChainEntry[] = []): boolean {
  return resolveScopedBooleanOption(options, styleChain, "allow upside down") ?? false;
}

function resolveScopedBooleanOption(
  options: NodeItem["options"] | OptionListAst | undefined,
  styleChain: StyleChainEntry[],
  key: string
): boolean | null {
  const local = resolveBooleanOption(options, key);
  if (local != null) {
    return local;
  }

  let inherited: boolean | null = null;
  for (const styleEntry of styleChain) {
    for (const optionList of styleEntry.rawOptions) {
      const resolved = resolveBooleanOption(optionList, key);
      if (resolved != null) {
        inherited = resolved;
      }
    }
  }

  return inherited;
}

function resolveBooleanOption(options: NodeItem["options"] | OptionListAst | undefined, key: string): boolean | null {
  if (!options) {
    return null;
  }

  let seen = false;
  let value = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === key) {
      seen = true;
      value = true;
      continue;
    }
    if (entry.kind !== "kv" || entry.key !== key) {
      continue;
    }
    const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
    if (normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
      seen = true;
      value = true;
    } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
      seen = true;
      value = false;
    }
  }

  return seen ? value : null;
}

function expandNodePlacementOptions(options: OptionListAst | undefined, context: SemanticContext): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const frame = context.stack[context.stack.length - 1];
  const expandedLists = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  const expandedEntries: OptionEntry[] = [];
  const diagnostics: string[] = [];
  walkOptionEntriesWithCustomStyles(
    expandedLists,
    cloneCustomStyleRegistry(frame.customStyles),
    (entry) => {
      expandedEntries.push(entry);
    },
    diagnostics
  );
  if (expandedEntries.length === 0) {
    return options;
  }

  return {
    span: options.span,
    raw: options.raw,
    entries: expandedEntries
  };
}

function segmentTangent(segment: PlacementSegment): WorldPoint | null {
  let tangent: WorldPoint;
  if (segment.kind === "line") {
    tangent = wp(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
  } else if (segment.kind === "hv") {
    tangent = wp(segment.to.x - segment.bend.x, segment.to.y - segment.bend.y);
  } else if (segment.kind === "cubic") {
    tangent = wp(segment.to.x - segment.c2.x, segment.to.y - segment.c2.y);
    if (Math.hypot(tangent.x, tangent.y) <= 1e-9) {
      tangent = wp(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    }
  } else {
    tangent = wp(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
  }

  const len = Math.hypot(tangent.x, tangent.y);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }
  return wp(tangent.x / len, tangent.y / len);
}

function directionToAnchor(direction: WorldPoint): string {
  const len = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return "center";
  }
  const x = direction.x / len;
  const y = direction.y / len;

  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (absX <= 0.35) {
    return y >= 0 ? "north" : "south";
  }
  if (absY <= 0.35) {
    return x >= 0 ? "east" : "west";
  }
  if (x >= 0 && y >= 0) {
    return "north east";
  }
  if (x >= 0 && y < 0) {
    return "south east";
  }
  if (x < 0 && y >= 0) {
    return "north west";
  }
  return "south west";
}

function resolveTextColorAliases(text: string, context: SemanticContext, consumerStatementId: string): string {
  if (text.length === 0) {
    return text;
  }

  let resolved = replaceColorCommandAliases(text, "\\textcolor", context, consumerStatementId);
  resolved = replaceColorCommandAliases(resolved, "\\color", context, consumerStatementId);
  return resolved;
}

function replaceColorCommandAliases(
  text: string,
  command: "\\textcolor" | "\\color",
  context: SemanticContext,
  consumerStatementId: string
): string {
  const escapedCommand = command.replace("\\", "\\\\");
  const pattern = new RegExp(`${escapedCommand}(\\s*\\[[^\\]]*\\])?\\s*\\{([^{}]+)\\}`, "g");
  return text.replace(pattern, (fullMatch: string, modelPart = "", rawColorName: string = "") => {
    const resolved = resolveContextColorAliasValue(context, String(rawColorName), consumerStatementId);
    if (!resolved) {
      return fullMatch;
    }
    return `${command}${modelPart}{${resolved}}`;
  });
}

function resolveNodeElementTransform(center: WorldPoint, nodeTransform: WorldTransform): WorldTransform | undefined {
  const hasLinear =
    Math.abs(nodeTransform.a - 1) > 1e-9 ||
    Math.abs(nodeTransform.b) > 1e-9 ||
    Math.abs(nodeTransform.c) > 1e-9 ||
    Math.abs(nodeTransform.d - 1) > 1e-9;
  const hasTranslation = Math.abs(nodeTransform.e) > 1e-9 || Math.abs(nodeTransform.f) > 1e-9;
  if (!hasLinear && !hasTranslation) {
    return undefined;
  }

  const e = center.x - nodeTransform.a * center.x - nodeTransform.c * center.y + nodeTransform.e;
  const f = center.y - nodeTransform.b * center.x - nodeTransform.d * center.y + nodeTransform.f;
  return worldTransform(nodeTransform.a, nodeTransform.b, nodeTransform.c, nodeTransform.d, e, f);
}

function rotateNodeElementGeometry(element: SceneElement, center: WorldPoint, rotation: number): SceneElement {
  if (Math.abs(rotation) <= 1e-6 || element.kind === "Text") {
    return element;
  }

  if (element.kind === "Path") {
    return {
      ...element,
      commands: element.commands.map((command) => rotateScenePathCommand(command, center, rotation))
    };
  }

  if (element.kind === "Circle") {
    return {
      ...element,
      center: rotateWorldPointAround(element.center, center, rotation)
    };
  }

  const rotated = normalizeRotationDegrees((element.rotation ?? 0) + rotation);
  return {
    ...element,
    center: rotateWorldPointAround(element.center, center, rotation),
    rotation: Math.abs(rotated) > 1e-6 ? rotated : undefined
  };
}

function rotateScenePathCommand(command: ScenePathCommand, center: WorldPoint, rotation: number): ScenePathCommand {
  if (command.kind === "Z") {
    return { kind: "Z" };
  }

  if (command.kind === "M" || command.kind === "L") {
    return {
      kind: command.kind,
      to: rotateWorldPointAround(command.to, center, rotation)
    };
  }

  if (command.kind === "C") {
    return {
      kind: "C",
      c1: rotateWorldPointAround(command.c1, center, rotation),
      c2: rotateWorldPointAround(command.c2, center, rotation),
      to: rotateWorldPointAround(command.to, center, rotation)
    };
  }

  return {
    kind: "A",
    rx: command.rx,
    ry: command.ry,
    xAxisRotation: normalizeRotationDegrees(command.xAxisRotation + rotation),
    largeArc: command.largeArc,
    sweep: command.sweep,
    to: rotateWorldPointAround(command.to, center, rotation)
  };
}

function rotateWorldPointAround(point: WorldPoint, center: WorldPoint, degrees: number): WorldPoint {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return wp(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos);
}

function normalizeRotationDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }

  let normalized = degrees % 360;
  if (normalized <= -180) {
    normalized += 360;
  } else if (normalized > 180) {
    normalized -= 360;
  }
  return normalized;
}

function registerNodeSetMembership(nodeNames: string[], setNames: string[], context: SemanticContext): void {
  if (nodeNames.length === 0 || setNames.length === 0) {
    return;
  }

  for (const setName of setNames) {
    const existingMembers = context.namedNodeSets.get(setName);
    const members = existingMembers ? new Set(existingMembers) : new Set<string>();
    let changed = !existingMembers;
    for (const nodeName of nodeNames) {
      if (members.has(nodeName)) {
        continue;
      }
      members.add(nodeName);
      changed = true;
    }
    if (changed) {
      context.namedNodeSets.set(setName, members);
    }
  }
}

function collectSetNames(options: OptionListAst | undefined): string[] {
  if (!options) {
    return [];
  }
  const names: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "set") {
      continue;
    }
    const parts = splitTopLevelCommas(entry.valueRaw);
    for (const part of parts) {
      const normalized = normalizeOptionValue(part).trim();
      if (normalized.length > 0) {
        names.push(normalized);
      }
    }
  }
  return Array.from(new Set(names));
}

function hasTextWidthOption(options: OptionListAst | undefined): boolean {
  if (!options) {
    return false;
  }
  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === "text width") {
      return true;
    }
  }
  return false;
}

function makeGeneratedSetMemberName(item: NodeItem): string {
  const from = Math.max(0, item.span.from);
  const to = Math.max(0, item.span.to);
  return `graph_set_node_${from}_${to}`;
}

export {
  applyNameScope,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveNamedCoordinateBorderPointFromRawAlongAngle,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "./named-coordinates.js";
