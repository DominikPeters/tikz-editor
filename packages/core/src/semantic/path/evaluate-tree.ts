import type { WorldPoint } from "../../coords/points.js";
import type { EdgeOperationItem, PathStatement, Span } from "../../ast/types.js";
import {
  readNamedCoordinate,
  resolveContextColorAliasValue,
  withDependencySource,
  writeNamedCoordinate,
  type SemanticContext
} from "../context.js";
import type { ResolvedStyle, SceneElement, TreeChildInfo } from "../types.js";
import type { StyleTraceLayerInput } from "../style-chain.js";
import { pointAtPlacementSegment, resolveNodePositionFraction } from "../nodes/placement.js";
import { parseCoordinateOperation } from "./parsers.js";
import { applyEdgeOperation } from "./to-operation.js";
import { hasDrawablePathSegments } from "./elements.js";
import { formatPointCoordinateRaw, hasNamedTreeRootNode, splitChildBodyAndTrailingEdgeFromParent } from "./tree-child.js";
import {
  collectDeferredTreeHookDiagnostics,
  collectTreeChildCluster,
  computeTreeChildOrigin,
  makeTreeAutoName,
  prepareChildBodyWithRoot,
  resolveNamedTreeAnchorPoint,
  resolveTreeLevelStyleLayers
} from "./tree.js";
import { applyNameScope } from "../nodes/evaluate.js";
import { cloneCustomStyleRegistry } from "../style/custom-styles.js";
import { applyPicDefinitionsFromOptionLists, clonePicDefinitionRegistry } from "../pics/registry.js";
import { resolveContextDelta, type parseStyleValueAsOptionList } from "../style/resolve.js";
import { styleDiagnosticCode, styleDiagnosticSpan, type StyleDiagnostic } from "../style/diagnostics.js";
import { resolveFrameMeta } from "../evaluate.js";
import type { DiagnosticPushFn, FeatureMarkFn } from "./types.js";

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

function extractTreeRootSourceId(statementId: string): string {
  const idx = statementId.indexOf(":tree-child:");
  return idx >= 0 ? statementId.slice(0, idx) : statementId;
}

function absolutizeTreeChildSpan(
  source: string,
  span: { from: number; to: number } | undefined,
  parentStatementSpan: { from: number; to: number },
  raw: string
): { from: number; to: number } | undefined {
  if (!span) {
    return undefined;
  }
  if (raw.length > 0 && source.slice(span.from, span.to) === raw) {
    return { from: span.from, to: span.to };
  }
  if (raw.length > 0) {
    const parentSlice = source.slice(parentStatementSpan.from, parentStatementSpan.to);
    const rawOffset = parentSlice.indexOf(raw);
    if (rawOffset >= 0) {
      return {
        from: parentStatementSpan.from + rawOffset,
        to: parentStatementSpan.from + rawOffset + raw.length
      };
    }
  }
  return {
    from: parentStatementSpan.from + span.from,
    to: parentStatementSpan.from + span.to
  };
}

export type TreeParentCandidate = { nameRaw: string | null; point: WorldPoint; span: { from: number; to: number } } | null;

export function handleChildOperationCluster(params: {
  statement: PathStatement;
  index: number;
  treeParentCandidate: TreeParentCandidate;
  treeFrameState: SemanticContext["stack"][number];
  context: SemanticContext;
  defaultPathOrigin: WorldPoint;
  drawEdgeOptions: ReturnType<typeof parseStyleValueAsOptionList>;
  edgeFromParentStyleOptions: ReturnType<typeof parseStyleValueAsOptionList>;
  markFeature: FeatureMarkFn;
  pushDiagnostic: DiagnosticPushFn;
  emittedTreeHookDiagnostics: Set<string>;
  evaluatePathStatement: (
    statement: PathStatement,
    context: SemanticContext,
    style: ResolvedStyle,
    markFeature: FeatureMarkFn,
    pushDiagnostic: DiagnosticPushFn,
    options?: { honorInitialCurrentPoint?: boolean }
  ) => SceneElement[];
  frontNodeElements: SceneElement[];
  evaluateRawCoordinateWorld: (rawCoordinate: string) => WorldPoint | null;
}): { consumed: number; treeParentCandidate: TreeParentCandidate } {
  const {
    statement,
    index,
    context,
    defaultPathOrigin,
    drawEdgeOptions,
    edgeFromParentStyleOptions,
    markFeature,
    pushDiagnostic,
    emittedTreeHookDiagnostics,
    evaluatePathStatement,
    frontNodeElements,
    evaluateRawCoordinateWorld
  } = params;
  let treeParentCandidate = params.treeParentCandidate;

  const cluster = collectTreeChildCluster(statement.items, index);
  if (cluster.children.length === 0 || cluster.consumed <= 0) {
    return { consumed: 0, treeParentCandidate };
  }

  if (!treeParentCandidate && statement.command === "coordinate") {
    const coordinateRootPoint = context.currentPoint ?? defaultPathOrigin;
    treeParentCandidate = {
      nameRaw: null,
      point: coordinateRootPoint,
      span: statement.span
    };
  }

  const firstItem = statement.items[index];
  if (!treeParentCandidate) {
    if (firstItem) {
      pushDiagnostic(
        "tree-child-without-parent",
        "`child` operations require a preceding parent node or coordinate in the same path.",
        firstItem.span.from,
        firstItem.span.to
      );
    }
    return { consumed: cluster.consumed, treeParentCandidate };
  }

  const parentFrame = params.treeFrameState;
  markFeature("child_operation", "supported");
  markFeature("tree_layout_keys", "supported");
  if (parentFrame.treeEveryChildStyles.length > 0 || parentFrame.treeEveryChildNodeStyles.length > 0) {
    markFeature("tree_every_child_styles", "supported");
  }
  if (parentFrame.treeLevelStyleTemplateLayers.length > 0 || parentFrame.treeLevelStyleLayers.length > 0) {
    markFeature("tree_level_styles", "supported");
  }
  if (parentFrame.treeGrowthParentAnchor !== "center") {
    markFeature("tree_anchor_keys", "supported");
  }
  if (parentFrame.treeDeferredGrowthFunction || parentFrame.treeDeferredEdgeFromParentPath || parentFrame.treeDeferredEdgeFromParentMacro) {
    markFeature("tree_deferred_hooks", "unsupported");
  }
  const clusterChildCount = cluster.children.length;

  for (let childIndex = 0; childIndex < cluster.children.length; childIndex += 1) {
    const child = cluster.children[childIndex];
    const childIndexOneBased = childIndex + 1;
    const defaultChildLevel = parentFrame.treeLevel + 1;
    const childSourceRef = {
      sourceId: child.id,
      sourceSpan: child.optionsSpan ?? child.span,
      sourceKind: "tree-child-operation",
      label: "child"
    } as const;

    const childCustomStyles = cloneCustomStyleRegistry(parentFrame.customStyles);
    const styleLayers: StyleTraceLayerInput[] = [];
    for (const layer of parentFrame.treeEveryChildStyles) {
      styleLayers.push({
        kind: "scope",
        sourceRef: layer.sourceRef,
        rawOptions: [layer.options]
      });
    }
    for (const layer of resolveTreeLevelStyleLayers(parentFrame, defaultChildLevel)) {
      styleLayers.push({
        kind: "scope",
        sourceRef: layer.sourceRef,
        rawOptions: [layer.options]
      });
    }
    if (child.options) {
      styleLayers.push({
        kind: "scope",
        sourceRef: childSourceRef,
        rawOptions: [child.options]
      });
    }
    const childPicDefinitions = clonePicDefinitionRegistry(parentFrame.picDefinitions);
    applyPicDefinitionsFromOptionLists(
      childPicDefinitions,
      styleLayers.flatMap((layer) => layer.rawOptions),
      childSourceRef
    );

    const resolvedChildStyle = resolveContextDelta(
      parentFrame.style,
      parentFrame.transform,
      styleLayers,
      childCustomStyles,
      evaluateRawCoordinateWorld,
      parentFrame.styleChain,
      (raw) => resolveContextColorAliasValue(context, raw)
    );
    for (const diagnostic of resolvedChildStyle.diagnostics) {
      pushStyleDiagnostic(pushDiagnostic, diagnostic, "Tree child option issue", child.span);
    }

    const childMetaBase = {
      ...parentFrame,
      treeLevel: defaultChildLevel,
      treeCurrentLevelSiblingDistancePt: null,
      treeMissing: false
    };
    const childFrameMeta = resolveFrameMeta(childMetaBase, resolvedChildStyle.expandedOptionLists, childSourceRef);
    if (childFrameMeta.treeLevel !== defaultChildLevel) {
      markFeature("tree_level_styles", "supported");
    }
    if (
      childFrameMeta.treeParentAnchor !== "border" ||
      childFrameMeta.treeChildAnchor !== "border" ||
      childFrameMeta.treeGrowthParentAnchor !== "center"
    ) {
      markFeature("tree_anchor_keys", "supported");
    }
    if (
      childFrameMeta.treeDeferredGrowthFunction ||
      childFrameMeta.treeDeferredEdgeFromParentPath ||
      childFrameMeta.treeDeferredEdgeFromParentMacro
    ) {
      markFeature("tree_deferred_hooks", "unsupported");
    }
    for (const deferredDiagnostic of collectDeferredTreeHookDiagnostics(childFrameMeta, child.span)) {
      if (emittedTreeHookDiagnostics.has(deferredDiagnostic.code)) {
        continue;
      }
      emittedTreeHookDiagnostics.add(deferredDiagnostic.code);
      pushDiagnostic(deferredDiagnostic.code, deferredDiagnostic.message, deferredDiagnostic.span.from, deferredDiagnostic.span.to);
    }

    const effectiveSiblingDistancePt = childFrameMeta.treeCurrentLevelSiblingDistancePt ?? childFrameMeta.treeSiblingDistancePt;
    const tentativeOrigin = computeTreeChildOrigin(
      treeParentCandidate.point,
      childFrameMeta.treeLevelDistancePt,
      effectiveSiblingDistancePt,
      childIndexOneBased,
      clusterChildCount,
      childFrameMeta.treeGrowDirectionDegrees,
      childFrameMeta.treeGrowReverse
    );
    const parentGrowthAnchorPoint =
      treeParentCandidate.nameRaw && treeParentCandidate.nameRaw.trim().length > 0
        ? resolveNamedTreeAnchorPoint(
            context,
            treeParentCandidate.nameRaw,
            childFrameMeta.treeGrowthParentAnchor,
            treeParentCandidate.point,
            tentativeOrigin
          )
        : treeParentCandidate.point;
    const childOrigin = computeTreeChildOrigin(
      parentGrowthAnchorPoint,
      childFrameMeta.treeLevelDistancePt,
      effectiveSiblingDistancePt,
      childIndexOneBased,
      clusterChildCount,
      childFrameMeta.treeGrowDirectionDegrees,
      childFrameMeta.treeGrowReverse
    );

    if (childFrameMeta.treeMissing) {
      markFeature("tree_missing_child", "supported");
      continue;
    }

    const generatedRootName = makeTreeAutoName(
      treeParentCandidate.nameRaw,
      statement.id,
      child.id,
      childIndexOneBased,
      childFrameMeta.treeLevel
    );
    const rootWasNamedBefore = hasNamedTreeRootNode(child.body);
    const preparedRoot = prepareChildBodyWithRoot(child, generatedRootName);
    if (preparedRoot.rootNameRaw === generatedRootName && !rootWasNamedBefore) {
      markFeature("tree_auto_naming", "supported");
    }
    const splitBody = splitChildBodyAndTrailingEdgeFromParent(preparedRoot.body);

    const childFrame = {
      ...parentFrame,
      style: resolvedChildStyle.style,
      styleChain: resolvedChildStyle.chain,
      transform: resolvedChildStyle.transform,
      customStyles: childCustomStyles,
      picDefinitions: childPicDefinitions,
      colorAliases: new Map(parentFrame.colorAliases),
      macroBindings: new Map(parentFrame.macroBindings),
      namePrefix: childFrameMeta.namePrefix,
      nameSuffix: childFrameMeta.nameSuffix,
      nodeLayerMode: childFrameMeta.nodeLayerMode,
      onGrid: childFrameMeta.onGrid,
      nodeDistance: childFrameMeta.nodeDistance,
      nodeQuotesMode: childFrameMeta.nodeQuotesMode,
      labelPosition: childFrameMeta.labelPosition,
      pinPosition: childFrameMeta.pinPosition,
      labelDistancePt: childFrameMeta.labelDistancePt,
      pinDistancePt: childFrameMeta.pinDistancePt,
      pinEdgeRaw: childFrameMeta.pinEdgeRaw,
      transformShape: childFrameMeta.transformShape,
      everyNodeStyles: childFrameMeta.everyNodeStyles,
      everyTextNodePartStyles: childFrameMeta.everyTextNodePartStyles,
      everyFitStyles: childFrameMeta.everyFitStyles,
      everyPicStyles: childFrameMeta.everyPicStyles,
      everyRectangleNodeStyles: childFrameMeta.everyRectangleNodeStyles,
      everyCircleNodeStyles: childFrameMeta.everyCircleNodeStyles,
      everyDiamondNodeStyles: childFrameMeta.everyDiamondNodeStyles,
      everyTrapeziumNodeStyles: childFrameMeta.everyTrapeziumNodeStyles,
      everyIsoscelesTriangleNodeStyles: childFrameMeta.everyIsoscelesTriangleNodeStyles,
      everyKiteNodeStyles: childFrameMeta.everyKiteNodeStyles,
      everyDartNodeStyles: childFrameMeta.everyDartNodeStyles,
      everyCircularSectorNodeStyles: childFrameMeta.everyCircularSectorNodeStyles,
      everyCylinderNodeStyles: childFrameMeta.everyCylinderNodeStyles,
      everyCloudNodeStyles: childFrameMeta.everyCloudNodeStyles,
      everyStarburstNodeStyles: childFrameMeta.everyStarburstNodeStyles,
      everySignalNodeStyles: childFrameMeta.everySignalNodeStyles,
      everyTapeNodeStyles: childFrameMeta.everyTapeNodeStyles,
      everyRectangleCalloutNodeStyles: childFrameMeta.everyRectangleCalloutNodeStyles,
      everyEllipseCalloutNodeStyles: childFrameMeta.everyEllipseCalloutNodeStyles,
      everyCloudCalloutNodeStyles: childFrameMeta.everyCloudCalloutNodeStyles,
      everySingleArrowNodeStyles: childFrameMeta.everySingleArrowNodeStyles,
      everyDoubleArrowNodeStyles: childFrameMeta.everyDoubleArrowNodeStyles,
      treeLevel: childFrameMeta.treeLevel,
      treeLevelDistancePt: childFrameMeta.treeLevelDistancePt,
      treeSiblingDistancePt: childFrameMeta.treeSiblingDistancePt,
      treeCurrentLevelSiblingDistancePt: childFrameMeta.treeCurrentLevelSiblingDistancePt,
      treeGrowDirectionDegrees: childFrameMeta.treeGrowDirectionDegrees,
      treeGrowReverse: childFrameMeta.treeGrowReverse,
      treeGrowthParentAnchor: childFrameMeta.treeGrowthParentAnchor,
      treeParentAnchor: childFrameMeta.treeParentAnchor,
      treeChildAnchor: childFrameMeta.treeChildAnchor,
      treeMissing: childFrameMeta.treeMissing,
      treeEveryChildStyles: childFrameMeta.treeEveryChildStyles,
      treeEveryChildNodeStyles: childFrameMeta.treeEveryChildNodeStyles,
      treeLevelStyleTemplateLayers: childFrameMeta.treeLevelStyleTemplateLayers,
      treeLevelStyleLayers: childFrameMeta.treeLevelStyleLayers.map(
        (entry: { level: number; layers: typeof childFrameMeta.treeEveryChildStyles }) => ({
          level: entry.level,
          layers: [...entry.layers]
        })
      ),
      treeDeferredGrowthFunction: childFrameMeta.treeDeferredGrowthFunction,
      treeDeferredEdgeFromParentPath: childFrameMeta.treeDeferredEdgeFromParentPath,
      treeDeferredEdgeFromParentMacro: childFrameMeta.treeDeferredEdgeFromParentMacro
    };

    const savedCurrentPoint = context.currentPoint;
    const savedPathStartPoint = context.pathStartPoint;
    context.stack.push(childFrame);
    try {
      context.currentPoint = childOrigin;
      context.pathStartPoint = childOrigin;
      const scopedChildRootName = applyNameScope(preparedRoot.rootNameRaw, context);
      const childStatement: PathStatement = {
        kind: "Path",
        id: `${statement.id}:tree-child:${childIndexOneBased}:${child.id}`,
        span: child.span,
        command: "path",
        options: undefined,
        items: splitBody.body
      };
      const childElements = withDependencySource(context, childStatement.id, () =>
        evaluatePathStatement(childStatement, context, resolvedChildStyle.style, markFeature, pushDiagnostic, {
          honorInitialCurrentPoint: true
        })
      );

      const treeRootSourceId = extractTreeRootSourceId(statement.id);
      const childOperationSpan =
        absolutizeTreeChildSpan(context.source, child.span, statement.span, child.raw) ?? child.span;
      const childBodySpan = absolutizeTreeChildSpan(
        context.source,
        child.bodySpan,
        statement.span,
        child.bodyRaw
      );
      const childOptionsSpan = absolutizeTreeChildSpan(
        context.source,
        child.optionsSpan,
        statement.span,
        child.options?.raw ?? ""
      );
      const treeChildInfo: TreeChildInfo = {
        treeRootSourceId,
        parentSourceId: statement.id,
        childOperationId: child.id,
        childSourceId: childStatement.id,
        childIndex,
        level: childFrameMeta.treeLevel,
        childOperationSpan,
        bodySpan: childBodySpan,
        optionsSpan: childOptionsSpan
      };
      for (const el of childElements) {
        // Preserve nested child metadata from recursive evaluations.
        // Only stamp elements that belong to this synthetic child statement.
        if (el.sourceRef.sourceId === childStatement.id) {
          el.treeChild = treeChildInfo;
        }
      }

      frontNodeElements.push(...childElements);

      const childRootPoint = readNamedCoordinate(context, scopedChildRootName) ?? childOrigin;
      const parentAnchorPoint =
        treeParentCandidate.nameRaw && treeParentCandidate.nameRaw.trim().length > 0
          ? resolveNamedTreeAnchorPoint(
              context,
              treeParentCandidate.nameRaw,
              childFrameMeta.treeParentAnchor,
              treeParentCandidate.point,
              childRootPoint
            )
          : treeParentCandidate.point;
      const childAnchorPoint = resolveNamedTreeAnchorPoint(
        context,
        scopedChildRootName,
        childFrameMeta.treeChildAnchor,
        childRootPoint,
        parentAnchorPoint
      );

      const edgeSpec = splitBody.trailingEdge;
      if (edgeSpec) {
        markFeature("edge_from_parent_operation", "supported");
      }
      const materializedEdge: EdgeOperationItem = {
        kind: "EdgeOperation",
        id: `${child.id}:edge-from-parent:${childIndexOneBased}`,
        span: edgeSpec?.span ?? child.span,
        optionsSpan: edgeSpec?.optionsSpan,
        options: edgeSpec?.options,
        nodes: edgeSpec?.nodes,
        target: {
          kind: "coordinate",
          raw: formatPointCoordinateRaw(childAnchorPoint)
        },
        raw: edgeSpec?.raw ?? "edge from parent"
      };

      const edgeOptionLayers: StyleTraceLayerInput[] = [];
      if (drawEdgeOptions) {
        edgeOptionLayers.push({
          kind: "command",
          sourceRef: {
            sourceId: materializedEdge.id,
            sourceSpan: materializedEdge.span,
            sourceKind: "tree-edge-default",
            label: "draw"
          },
          rawOptions: [drawEdgeOptions]
        });
      }
      if (edgeFromParentStyleOptions) {
        edgeOptionLayers.push({
          kind: "command",
          sourceRef: {
            sourceId: materializedEdge.id,
            sourceSpan: materializedEdge.span,
            sourceKind: "tree-edge-default",
            label: "edge from parent"
          },
          rawOptions: [edgeFromParentStyleOptions]
        });
      }
      if (materializedEdge.options) {
        edgeOptionLayers.push({
          kind: "command",
          sourceRef: {
            sourceId: materializedEdge.id,
            sourceSpan: materializedEdge.optionsSpan ?? materializedEdge.span,
            sourceKind: "tree-edge-options",
            label: "edge from parent"
          },
          rawOptions: [materializedEdge.options]
        });
      }

      const activeTreeFrame = context.stack[context.stack.length - 1];
      const resolvedTreeEdgeStyle = resolveContextDelta(
        activeTreeFrame.style,
        activeTreeFrame.transform,
        edgeOptionLayers,
        activeTreeFrame.customStyles,
        evaluateRawCoordinateWorld,
        activeTreeFrame.styleChain,
        (raw) => resolveContextColorAliasValue(context, raw)
      );
      for (const diagnostic of resolvedTreeEdgeStyle.diagnostics) {
        const code = styleDiagnosticCode(diagnostic);
        if (code === "unsupported-option-flag:edge from parent") {
          continue;
        }
        pushStyleDiagnostic(pushDiagnostic, diagnostic, "Tree edge option issue", materializedEdge.span);
      }

      const edgeHandlesStart = context.editHandles.length;
      const handledEdge = applyEdgeOperation(
        materializedEdge,
        context,
        statement,
        resolvedTreeEdgeStyle.style,
        resolvedTreeEdgeStyle.chain,
        markFeature,
        pushDiagnostic,
        parentAnchorPoint
      );
      for (let handleIndex = edgeHandlesStart; handleIndex < context.editHandles.length; handleIndex += 1) {
        const handle = context.editHandles[handleIndex];
        if (handle?.sourceRef.sourceId !== statement.id) {
          continue;
        }
        context.editHandles[handleIndex] = {
          ...handle,
          sourceRef: {
            ...handle.sourceRef,
            // Keep tree-edge coordinate handles bound to the synthetic child statement
            // so moving the tree root does not rewrite raw child-operation spans.
            sourceId: childStatement.id
          }
        };
      }
      const edgeElements: SceneElement[] = [];
      if (handledEdge.activePath && hasDrawablePathSegments(handledEdge.activePath)) {
        edgeElements.push(...handledEdge.behindNodeElements, handledEdge.activePath, ...handledEdge.frontNodeElements);
      } else {
        edgeElements.push(...handledEdge.behindNodeElements, ...handledEdge.frontNodeElements);
      }
      for (const el of edgeElements) {
        el.treeChild = treeChildInfo;
      }
      frontNodeElements.push(...edgeElements);
      for (const coordinateOperation of splitBody.trailingCoordinateOperations) {
        const operationName = coordinateOperation.name?.trim();
        const parsedName = operationName === undefined || operationName.length === 0 ? parseCoordinateOperation(coordinateOperation.raw)?.name : operationName;
        if (!parsedName) {
          pushDiagnostic(
            "invalid-coordinate-operation",
            "Could not parse coordinate operation.",
            coordinateOperation.span.from,
            coordinateOperation.span.to
          );
          continue;
        }

        const placementFraction = resolveNodePositionFraction(coordinateOperation.options) ?? 0.5;
        const capturePoint = handledEdge.segment ? pointAtPlacementSegment(handledEdge.segment, placementFraction) : childAnchorPoint;
        writeNamedCoordinate(context, applyNameScope(parsedName, context), capturePoint);
        markFeature("named_coordinates", "supported");
      }
    } finally {
      context.currentPoint = savedCurrentPoint;
      context.pathStartPoint = savedPathStartPoint;
      context.stack.pop();
    }
  }

  return { consumed: cluster.consumed, treeParentCandidate };
}
