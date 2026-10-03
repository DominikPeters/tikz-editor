import { evaluateTransformCoordinate } from "../coords/evaluate.js";
import type { WorldPoint } from "../../coords/points.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { worldTransform } from "../../coords/transforms.js";
import { applyMatrix, inverseMatrix } from "../transform.js";
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
import { resolveFrameMeta, resolvePathBoundary } from "../evaluate.js";
import type { DiagnosticPushFn, FeatureMarkFn, PathEvaluationOptions } from "./types.js";

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
    options?: PathEvaluationOptions
  ) => SceneElement[];
  frontNodeElements: SceneElement[];
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
    frontNodeElements
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
    const levelStyleLayers = resolveTreeLevelStyleLayers(parentFrame, defaultChildLevel).map(
      (layer): StyleTraceLayerInput => ({ kind: "scope", sourceRef: layer.sourceRef, rawOptions: [layer.options] })
    );
    const resolvedLevelStyle = resolveContextDelta(
      parentFrame.style,
      parentFrame.transform,
      levelStyleLayers,
      childCustomStyles,
      (raw, basis) => evaluateTransformCoordinate(raw, context, basis),
      parentFrame.styleChain,
      (raw) => resolveContextColorAliasValue(context, raw),
      parentFrame.axisBasis
    );
    const levelFrameMeta = resolveFrameMeta({
      ...parentFrame,
      treeLevel: defaultChildLevel,
      treeCurrentLevelSiblingDistancePt: null,
      treeMissing: false
    }, resolvedLevelStyle.expandedOptionLists, childSourceRef);
    const levelGrowthAnchorPoint = treeParentCandidate.nameRaw
      ? resolveNamedTreeAnchorPoint(
          context, treeParentCandidate.nameRaw, levelFrameMeta.treeGrowthParentAnchor,
          treeParentCandidate.point, treeParentCandidate.point
        )
      : treeParentCandidate.point;
    const styleLayers: StyleTraceLayerInput[] = [];
    for (const layer of levelFrameMeta.treeEveryChildStyles) {
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
      [...levelStyleLayers, ...styleLayers].flatMap((layer) => layer.rawOptions),
      childSourceRef
    );

    const resolvedChildStyle = resolveContextDelta(
      resolvedLevelStyle.style,
      // PGF applies level transforms before anchoring at the world parent;
      // every-child and local-child transforms then act around that origin.
      worldTransform(
        resolvedLevelStyle.transform.a, resolvedLevelStyle.transform.b,
        resolvedLevelStyle.transform.c, resolvedLevelStyle.transform.d,
        levelGrowthAnchorPoint.x, levelGrowthAnchorPoint.y
      ),
      styleLayers,
      childCustomStyles,
      (raw, basis) => evaluateTransformCoordinate(raw, context, basis),
      resolvedLevelStyle.chain,
      (raw) => resolveContextColorAliasValue(context, raw),
      resolvedLevelStyle.axisBasis
    );
    for (const diagnostic of [...resolvedLevelStyle.diagnostics, ...resolvedChildStyle.diagnostics]) {
      pushStyleDiagnostic(pushDiagnostic, diagnostic, "Tree child option issue", child.span);
    }

    const childFrameMeta = resolveFrameMeta(levelFrameMeta, resolvedChildStyle.expandedOptionLists, childSourceRef);
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
      worldPoint(pt(resolvedChildStyle.transform.e), pt(resolvedChildStyle.transform.f)),
      childFrameMeta.treeLevelDistancePt,
      effectiveSiblingDistancePt,
      childIndexOneBased,
      clusterChildCount,
      childFrameMeta.treeGrowDirectionDegrees,
      childFrameMeta.treeGrowReverse,
      resolvedChildStyle.transform
    );
    const parentGrowthAnchorPoint =
      treeParentCandidate.nameRaw && treeParentCandidate.nameRaw.trim().length > 0
        ? resolveNamedTreeAnchorPoint(
            context,
            treeParentCandidate.nameRaw,
            levelFrameMeta.treeGrowthParentAnchor,
            treeParentCandidate.point,
            tentativeOrigin
          )
        : treeParentCandidate.point;
    const childOrigin = computeTreeChildOrigin(
      worldPoint(
        pt(parentGrowthAnchorPoint.x + resolvedChildStyle.transform.e - levelGrowthAnchorPoint.x),
        pt(parentGrowthAnchorPoint.y + resolvedChildStyle.transform.f - levelGrowthAnchorPoint.y)
      ),
      childFrameMeta.treeLevelDistancePt,
      effectiveSiblingDistancePt,
      childIndexOneBased,
      clusterChildCount,
      childFrameMeta.treeGrowDirectionDegrees,
      childFrameMeta.treeGrowReverse,
      resolvedChildStyle.transform
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
      transform: worldTransform(
        resolvedChildStyle.transform.a, resolvedChildStyle.transform.b,
        resolvedChildStyle.transform.c, resolvedChildStyle.transform.d,
        childOrigin.x, childOrigin.y
      ),
      axisBasis: resolvedChildStyle.axisBasis,
      customStyles: childCustomStyles,
      picDefinitions: childPicDefinitions,
      colorAliases: parentFrame.colorAliases.fork(),
      macroBindings: parentFrame.macroBindings.fork(),
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
      everyPathStyles: childFrameMeta.everyPathStyles,
      everyNodeStyles: childFrameMeta.everyNodeStyles,
      everyTextNodePartStyles: childFrameMeta.everyTextNodePartStyles,
      everyFitStyles: childFrameMeta.everyFitStyles,
      everyPicStyles: childFrameMeta.everyPicStyles,
      everyShapeNodeStyles: childFrameMeta.everyShapeNodeStyles,
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
    let restPathFramePushed = false;
    context.stack.push(childFrame);
    try {
      let scopedChildRootName = applyNameScope(preparedRoot.rootNameRaw, context);
      const rootIndex = splitBody.body.findIndex((item) => item.kind === "Node");
      const childStatement: PathStatement = {
        kind: "Path",
        id: `${statement.id}:tree-child:${childIndexOneBased}:${child.id}`,
        span: child.span,
        command: "node",
        options: undefined,
        items: splitBody.body.slice(0, rootIndex + 1)
      };
      const makePathFrame = (command: "node" | "path") => {
        const sourceRef = { sourceId: childStatement.id, sourceSpan: child.span, sourceKind: "tree-generated-path", label: command };
        const { resolved, customStyles } = resolvePathBoundary(childFrame, context, command, sourceRef);
        for (const diagnostic of resolved.diagnostics) {
          pushStyleDiagnostic(pushDiagnostic, diagnostic, "Tree path option issue", child.span);
        }
        const picDefinitions = clonePicDefinitionRegistry(childFrame.picDefinitions);
        applyPicDefinitionsFromOptionLists(picDefinitions, resolved.expandedOptionLists, sourceRef);
        return {
          ...childFrame, ...resolveFrameMeta(childFrame, resolved.expandedOptionLists, sourceRef),
          style: resolved.style, styleChain: resolved.chain, transform: resolved.transform, axisBasis: resolved.axisBasis,
          customStyles, picDefinitions, colorAliases: childFrame.colorAliases.fork(), macroBindings: childFrame.macroBindings.fork()
        };
      };
      const nodePathFrame = makePathFrame("node");
      const childElements: SceneElement[] = [];
      context.stack.push(nodePathFrame);
      try {
        scopedChildRootName = applyNameScope(preparedRoot.rootNameRaw, context);
        context.currentPoint = worldPoint(pt(nodePathFrame.transform.e), pt(nodePathFrame.transform.f));
        context.pathStartPoint = context.currentPoint;
        childElements.push(...withDependencySource(context, childStatement.id, () =>
          evaluatePathStatement(childStatement, context, nodePathFrame.style, markFeature, pushDiagnostic, { honorInitialCurrentPoint: true })
        ));
      } finally {
        context.stack.pop();
      }

      // PGF emits a separate path after the generated node, including its
      // descendants/body and edge. Its every-path state starts from the child
      // scope, rather than retaining the node path's styles or transforms.
      const restPathFrame = makePathFrame("path");
      context.stack.push(restPathFrame);
      restPathFramePushed = true;
      context.currentPoint = worldPoint(pt(restPathFrame.transform.e), pt(restPathFrame.transform.f));
      context.pathStartPoint = context.currentPoint;
      const rootPoint = readNamedCoordinate(context, scopedChildRootName) ?? childOrigin;
      childElements.push(...withDependencySource(context, childStatement.id, () =>
        evaluatePathStatement({ ...childStatement, command: "path", items: splitBody.body.slice(rootIndex + 1) }, context, restPathFrame.style, markFeature, pushDiagnostic, {
          honorInitialCurrentPoint: true,
          initialTreeParentCandidate: { nameRaw: preparedRoot.rootNameRaw, point: rootPoint, span: preparedRoot.rootSpan }
        })
      ));

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
      const edgeTargetInverse = inverseMatrix(context.stack[context.stack.length - 1].transform);
      const materializedEdge: EdgeOperationItem = {
        kind: "EdgeOperation",
        id: `${child.id}:edge-from-parent:${childIndexOneBased}`,
        span: edgeSpec?.span ?? child.span,
        optionsSpan: edgeSpec?.optionsSpan,
        options: edgeSpec?.options,
        nodes: edgeSpec?.nodes,
        target: {
          kind: "coordinate",
          // The endpoint is already world-space; encode it in the active
          // child frame so ordinary coordinate evaluation applies the CTM once.
          raw: edgeTargetInverse
            ? formatPointCoordinateRaw(applyMatrix(edgeTargetInverse, childAnchorPoint))
            : `(${scopedChildRootName}${childFrameMeta.treeChildAnchor === "border" ? "" : `.${childFrameMeta.treeChildAnchor}`})`
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
        (raw, basis) => evaluateTransformCoordinate(raw, context, basis),
        activeTreeFrame.styleChain,
        (raw) => resolveContextColorAliasValue(context, raw),
        activeTreeFrame.axisBasis
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
      if (restPathFramePushed) context.stack.pop();
      context.stack.pop();
    }
  }

  return { consumed: cluster.consumed, treeParentCandidate };
}
