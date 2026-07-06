import type { WorldTransform } from "../coords/transforms.js";
import type { WorldPoint, WorldBounds } from "../coords/points.js";
import type { OptionListAst } from "../options/types.js";
import type { NodeTextEngine } from "../text/types.js";
import type { MacroBinding, MacroExpansionTraceEvent } from "../macros/index.js";
import { parseLength } from "./coords/parse-length.js";
import type { EditHandle, ResolvedStyle, SceneClipPath, SceneElement, SceneLayer } from "./types.js";
import { BACKGROUND_SCENE_LAYER, MAIN_SCENE_LAYER } from "./types.js";
import type { CustomStyleRegistry } from "./style/custom-styles.js";
import { createDefaultCustomStyleRegistry } from "./style/custom-styles.js";
import type { PicDefinitionRegistry } from "./pics/registry.js";
import { createDefaultPicDefinitionRegistry } from "./pics/registry.js";
import { computeSourceFingerprint } from "../utils/source-fingerprint.js";
import type { StyleChainEntry, StyleSourceRef } from "./style-chain.js";
import { cloneResolvedStyle } from "./style-chain.js";
import { PersistentMap, type PersistentMapSnapshot } from "./persistent-map.js";
import {
  SemanticDependencyGraphBuilder,
  type SemanticDependencyGraphBuilderState,
  type SemanticDependencyOpaqueReason,
  type SemanticDependencyResourceKind
} from "./dependencies.js";
import {
  createSemanticSymbolResolver,
  defineSemanticSymbol,
  exportSemanticSymbolResolverState,
  requireSemanticLibrary,
  resolveSemanticSymbol,
  importSemanticSymbolResolverState,
  popSemanticSymbolScope,
  pushSemanticSymbolScope,
  type SemanticSymbolDefinition,
  type SemanticSymbolDependencyEdge,
  type SemanticSymbolKind,
  type SemanticSymbolResolver,
  type SemanticUnresolvedSymbol,
  type SemanticSymbolResolverState
} from "./symbol-resolver.js";
import { createPgfRandom, type PgfRandom } from "./pgfmath/rng.js";

export type NodeLayerMode = "front" | "behind";
export type NodeDistanceValue =
  | {
      kind: "dimension";
      value: number;
    }
  | {
      kind: "number";
      value: number;
    };

export type NodeDistanceSpec =
  | {
      kind: "single";
      value: NodeDistanceValue;
    }
  | {
      kind: "pair";
      vertical: NodeDistanceValue;
      horizontal: NodeDistanceValue;
    };

export type NodeQuotesMode = "label" | "pin";

export type NamedNodeGeometry = {
  sourceId?: string;
  shape:
    | "rectangle"
    | "rounded rectangle"
    | "chamfered rectangle"
    | "cross out"
    | "strike out"
    | "circle"
    | "magnifying glass"
    | "circle split"
    | "circle solidus"
    | "ellipse split"
    | "diamond split"
    | "rectangle split"
    | "ellipse"
    | "diamond"
    | "trapezium"
    | "semicircle"
    | "regular polygon"
    | "star"
    | "isosceles triangle"
    | "kite"
    | "dart"
    | "circular sector"
    | "cylinder"
    | "cloud"
    | "starburst"
    | "signal"
    | "tape"
    | "rectangle callout"
    | "ellipse callout"
    | "cloud callout"
    | "single arrow"
    | "double arrow"
    | "coordinate";
  center: WorldPoint;
  anchorTransform?: WorldTransform;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  diamondAspect?: number;
  trapeziumLeftAngle?: number;
  trapeziumRightAngle?: number;
  shapeBorderRotate?: number;
  trapeziumStretches?: boolean;
  trapeziumStretchesBody?: boolean;
  anchorPolygon?: WorldPoint[];
};

export type ProvenanceOptionList = {
  options: OptionListAst;
  sourceRef: StyleSourceRef;
};

export type SemanticContextFrame = {
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  transform: WorldTransform;
  layer: string;
  clipChain: SceneClipPath[];
  pictureSizeRelevant: boolean;
  customStyles: CustomStyleRegistry;
  picDefinitions: PicDefinitionRegistry;
  colorAliases: Map<string, string>;
  macroBindings: Map<string, MacroBinding>;
  namePrefix: string;
  nameSuffix: string;
  nodeLayerMode: NodeLayerMode;
  onGrid: boolean;
  nodeDistance: NodeDistanceSpec;
  nodeQuotesMode: NodeQuotesMode;
  labelPosition: string;
  pinPosition: string;
  labelDistancePt: number;
  pinDistancePt: number;
  pinEdgeRaw: string | null;
  transformShape: boolean;
  everyNodeStyles: ProvenanceOptionList[];
  everyTextNodePartStyles: ProvenanceOptionList[];
  everyFitStyles: ProvenanceOptionList[];
  everyPicStyles: ProvenanceOptionList[];
  everyRectangleNodeStyles: ProvenanceOptionList[];
  everyCircleNodeStyles: ProvenanceOptionList[];
  everyDiamondNodeStyles: ProvenanceOptionList[];
  everyTrapeziumNodeStyles: ProvenanceOptionList[];
  everyIsoscelesTriangleNodeStyles: ProvenanceOptionList[];
  everyKiteNodeStyles: ProvenanceOptionList[];
  everyDartNodeStyles: ProvenanceOptionList[];
  everyCircularSectorNodeStyles: ProvenanceOptionList[];
  everyCylinderNodeStyles: ProvenanceOptionList[];
  everyCloudNodeStyles: ProvenanceOptionList[];
  everyStarburstNodeStyles: ProvenanceOptionList[];
  everySignalNodeStyles: ProvenanceOptionList[];
  everyTapeNodeStyles: ProvenanceOptionList[];
  everyRectangleCalloutNodeStyles: ProvenanceOptionList[];
  everyEllipseCalloutNodeStyles: ProvenanceOptionList[];
  everyCloudCalloutNodeStyles: ProvenanceOptionList[];
  everySingleArrowNodeStyles: ProvenanceOptionList[];
  everyDoubleArrowNodeStyles: ProvenanceOptionList[];
  treeLevel: number;
  treeLevelDistancePt: number;
  treeSiblingDistancePt: number;
  treeCurrentLevelSiblingDistancePt: number | null;
  treeGrowDirectionDegrees: number;
  treeGrowReverse: boolean;
  treeGrowthParentAnchor: string;
  treeParentAnchor: string;
  treeChildAnchor: string;
  treeMissing: boolean;
  treeEveryChildStyles: ProvenanceOptionList[];
  treeEveryChildNodeStyles: ProvenanceOptionList[];
  treeLevelStyleTemplateLayers: ProvenanceOptionList[];
  treeLevelStyleLayers: Array<{ level: number; layers: ProvenanceOptionList[] }>;
  treeDeferredGrowthFunction: boolean;
  treeDeferredEdgeFromParentPath: boolean;
  treeDeferredEdgeFromParentMacro: boolean;
};

export type SemanticContext = {
  stack: SemanticContextFrame[];
  source: string;
  sourceFingerprint: string;
  layers: Map<string, SceneLayer>;
  backgroundState: SemanticBackgroundState;
  pictureBounds: WorldBounds | null;
  namedCoordinates: PersistentMap<string, WorldPoint>;
  namedNodeSets: PersistentMap<string, Set<string>>;
  namedCoordinateRewriteHandles: PersistentMap<string, string>;
  namedNodeGeometries: PersistentMap<string, NamedNodeGeometry>;
  namedPaths: PersistentMap<string, SceneElement[]>;
  currentPoint: WorldPoint | null;
  pathStartPoint: WorldPoint | null;
  textEngine: NodeTextEngine | null;
  macroTraceCollector: MacroExpansionTraceEvent[] | null;
  picEvaluationStack: string[];
  editHandles: EditHandle[];
  dependencyBuilder: SemanticDependencyGraphBuilder;
  dependencyActiveSourceId: string | null;
  statementEffectTracker: SemanticStatementEffectTracker | null;
  symbolResolver: SemanticSymbolResolver;
  mathRandom: PgfRandom;
};

export type SemanticBackgroundHookKind = "rectangle" | "grid" | "top" | "bottom" | "left" | "right";

export type SemanticBackgroundHook = {
  kind: SemanticBackgroundHookKind;
  sourceRef: StyleSourceRef;
  sequence: number;
};

export type SemanticBackgroundState = {
  used: boolean;
  innerFrameXSep: number;
  innerFrameYSep: number;
  outerFrameXSep: number;
  outerFrameYSep: number;
  hooks: SemanticBackgroundHook[];
  nextHookSequence: number;
};

export type SemanticStatementConsumedResource = {
  kind: SemanticDependencyResourceKind;
  key: string;
};

export type SemanticStatementSuffixSkipKind =
  | "safe"
  | "scope-safe"
  | "foreach-origin-safe"
  | "unsafe";

export type SemanticStatementEffectSummary = {
  producesNamedCoordinates: Array<{ key: string; point: WorldPoint }>;
  producesNamedNodeGeometries: Array<{ key: string; geometry: NamedNodeGeometry }>;
  producesNamedPaths: string[];
  consumesNamedResources: SemanticStatementConsumedResource[];
  mutatesCurrentPoint: boolean;
  nextCurrentPoint: WorldPoint | null;
  mutatesPathStartPoint: boolean;
  nextPathStartPoint: WorldPoint | null;
  requiresSequentialContext: boolean;
  suffixSkipKind: SemanticStatementSuffixSkipKind;
  opaque: boolean;
  opaqueReasons: SemanticDependencyOpaqueReason[];
};

export type SemanticContextSnapshot = {
  stack: SemanticContextFrame[];
  layers: SceneLayer[];
  backgroundState: SemanticBackgroundState;
  pictureBounds: WorldBounds | null;
  namedCoordinatesState: PersistentMapSnapshot<string, WorldPoint>;
  namedNodeSetsState: PersistentMapSnapshot<string, Set<string>>;
  namedCoordinateRewriteHandlesState: PersistentMapSnapshot<string, string>;
  namedNodeGeometriesState: PersistentMapSnapshot<string, NamedNodeGeometry>;
  namedPathsState: PersistentMapSnapshot<string, SceneElement[]>;
  currentPoint: WorldPoint | null;
  pathStartPoint: WorldPoint | null;
  editHandles: EditHandle[] | null;
  editHandlesLength: number;
  dependencyBuilderState: SemanticDependencyGraphBuilderState;
  dependencyActiveSourceId: string | null;
  symbolResolverState: SemanticSymbolResolverState;
  mathRandomSeed: number;
};

export type SnapshotSemanticContextOptions = {
  editHandlesMode?: "clone" | "length";
};

export type RestoreSemanticContextOptions = {
  editHandleSource?: readonly EditHandle[];
};

type SemanticStatementEffectTracker = {
  producedNamedCoordinates: Map<string, WorldPoint>;
  producedNamedNodeGeometries: Map<string, NamedNodeGeometry>;
  producedNamedPaths: Set<string>;
  consumedNamedResources: Map<string, SemanticStatementConsumedResource>;
  opaqueReasons: Set<SemanticDependencyOpaqueReason>;
};

export function createSemanticContext(
  initialStyle: ResolvedStyle,
  initialTransform: WorldTransform,
  textEngine: NodeTextEngine | null = null,
  source = "",
  sourceFingerprint = computeSourceFingerprint(source)
): SemanticContext {
  const defaultNodeDistance = 28.4527559055;
  const defaultTreeDistance = 15 * 2.84527559055;
  const clonedStyle = cloneResolvedStyle(initialStyle);
  const defaultBackgroundState = createDefaultSemanticBackgroundState();
  const defaultGlobalSource: StyleSourceRef = {
    sourceId: "__global__",
    sourceKind: "global-default",
    label: "TikZ defaults"
  };
  return {
    stack: [
      {
        style: clonedStyle,
        styleChain: [
          {
            kind: "global",
            sourceRef: defaultGlobalSource,
            rawOptions: [],
            before: cloneResolvedStyle(clonedStyle),
            after: cloneResolvedStyle(clonedStyle),
            resolvedContributions: cloneResolvedStyle(clonedStyle)
          }
        ],
        transform: initialTransform,
        layer: MAIN_SCENE_LAYER,
        clipChain: [],
        pictureSizeRelevant: true,
        customStyles: createDefaultCustomStyleRegistry(),
        picDefinitions: createDefaultPicDefinitionRegistry(),
        colorAliases: new Map(),
        macroBindings: new Map(),
        namePrefix: "",
        nameSuffix: "",
        nodeLayerMode: "front",
        onGrid: false,
        nodeDistance: {
          kind: "pair",
          vertical: { kind: "dimension", value: defaultNodeDistance },
          horizontal: { kind: "dimension", value: defaultNodeDistance }
        },
        nodeQuotesMode: "label",
        labelPosition: "above",
        pinPosition: "above",
        labelDistancePt: 0,
        pinDistancePt: 12.9,
        pinEdgeRaw: null,
        transformShape: false,
        everyNodeStyles: [],
        everyTextNodePartStyles: [],
        everyFitStyles: [],
        everyPicStyles: [],
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
        everyDoubleArrowNodeStyles: [],
        treeLevel: 0,
        treeLevelDistancePt: defaultTreeDistance,
        treeSiblingDistancePt: defaultTreeDistance,
        treeCurrentLevelSiblingDistancePt: null,
        treeGrowDirectionDegrees: -90,
        treeGrowReverse: false,
        treeGrowthParentAnchor: "center",
        treeParentAnchor: "border",
        treeChildAnchor: "border",
        treeMissing: false,
        treeEveryChildStyles: [],
        treeEveryChildNodeStyles: [],
        treeLevelStyleTemplateLayers: [],
        treeLevelStyleLayers: [],
        treeDeferredGrowthFunction: false,
        treeDeferredEdgeFromParentPath: false,
        treeDeferredEdgeFromParentMacro: false
      }
    ],
    source,
    sourceFingerprint,
    layers: createDefaultSceneLayerMap(),
    backgroundState: defaultBackgroundState,
    pictureBounds: null,
    namedCoordinates: new PersistentMap<string, WorldPoint>(),
    namedNodeSets: new PersistentMap<string, Set<string>>(),
    namedCoordinateRewriteHandles: new PersistentMap<string, string>(),
    namedNodeGeometries: new PersistentMap<string, NamedNodeGeometry>(),
    namedPaths: new PersistentMap<string, SceneElement[]>(),
    currentPoint: null,
    pathStartPoint: null,
    textEngine,
    macroTraceCollector: null,
    picEvaluationStack: [],
    editHandles: [],
    dependencyBuilder: new SemanticDependencyGraphBuilder(),
    dependencyActiveSourceId: null,
    statementEffectTracker: null,
    symbolResolver: createSemanticSymbolResolver(),
    mathRandom: createPgfRandom(1)
  };
}

export function createDefaultSemanticBackgroundState(): SemanticBackgroundState {
  return {
    used: false,
    innerFrameXSep: parseLength("1ex", "pt") ?? 4.3,
    innerFrameYSep: parseLength("1ex", "pt") ?? 4.3,
    outerFrameXSep: 0,
    outerFrameYSep: 0,
    hooks: [],
    nextHookSequence: 0
  };
}

function createDefaultSceneLayerMap(): Map<string, SceneLayer> {
  return new Map([[MAIN_SCENE_LAYER, { name: MAIN_SCENE_LAYER, order: 0 }]]);
}

export function markBackgroundLayerUsed(context: SemanticContext): void {
  context.backgroundState.used = true;
  context.layers.set(BACKGROUND_SCENE_LAYER, { name: BACKGROUND_SCENE_LAYER, order: 0 });
  context.layers.set(MAIN_SCENE_LAYER, { name: MAIN_SCENE_LAYER, order: 1 });
}

export function listContextSceneLayers(context: SemanticContext): SceneLayer[] {
  return [...context.layers.values()].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.name.localeCompare(right.name);
  });
}

export function currentFrame(context: SemanticContext): SemanticContextFrame {
  return context.stack[context.stack.length - 1];
}

export function pushFrame(context: SemanticContext, frame: SemanticContextFrame): void {
  context.stack.push(frame);
  pushSemanticSymbolScope(context.symbolResolver);
}

export function popFrame(context: SemanticContext): void {
  if (context.stack.length > 1) {
    context.stack.pop();
    popSemanticSymbolScope(context.symbolResolver);
  }
}

export function snapshotSemanticContext(
  context: SemanticContext,
  options: SnapshotSemanticContextOptions = {}
): SemanticContextSnapshot {
  const editHandlesMode = options.editHandlesMode ?? "clone";
  return {
    stack: structuredClone(context.stack),
    layers: listContextSceneLayers(context),
    backgroundState: structuredClone(context.backgroundState),
    pictureBounds: context.pictureBounds ? { ...context.pictureBounds } : null,
    namedCoordinatesState: context.namedCoordinates.snapshot(),
    namedNodeSetsState: context.namedNodeSets.snapshot(),
    namedCoordinateRewriteHandlesState: context.namedCoordinateRewriteHandles.snapshot(),
    namedNodeGeometriesState: context.namedNodeGeometries.snapshot(),
    namedPathsState: context.namedPaths.snapshot(),
    currentPoint: context.currentPoint ? { ...context.currentPoint } : null,
    pathStartPoint: context.pathStartPoint ? { ...context.pathStartPoint } : null,
    editHandles:
      editHandlesMode === "clone" ? structuredClone(context.editHandles) : null,
    editHandlesLength: context.editHandles.length,
    dependencyBuilderState: context.dependencyBuilder.exportState(),
    dependencyActiveSourceId: context.dependencyActiveSourceId,
    symbolResolverState: exportSemanticSymbolResolverState(context.symbolResolver),
    mathRandomSeed: context.mathRandom.getSeed()
  };
}

export function restoreSemanticContext(
  context: SemanticContext,
  snapshot: SemanticContextSnapshot,
  options: RestoreSemanticContextOptions = {}
): void {
  context.stack = structuredClone(snapshot.stack);
  context.layers = new Map(snapshot.layers.map((layer) => [layer.name, { ...layer }]));
  context.backgroundState = structuredClone(snapshot.backgroundState);
  context.pictureBounds = snapshot.pictureBounds ? { ...snapshot.pictureBounds } : null;
  context.namedCoordinates.restore(snapshot.namedCoordinatesState);
  context.namedNodeSets.restore(snapshot.namedNodeSetsState);
  context.namedCoordinateRewriteHandles.restore(snapshot.namedCoordinateRewriteHandlesState);
  context.namedNodeGeometries.restore(snapshot.namedNodeGeometriesState);
  context.namedPaths.restore(snapshot.namedPathsState);
  context.currentPoint = snapshot.currentPoint ? { ...snapshot.currentPoint } : null;
  context.pathStartPoint = snapshot.pathStartPoint ? { ...snapshot.pathStartPoint } : null;
  if (snapshot.editHandles) {
    context.editHandles = snapshot.editHandles.slice();
  } else {
    const source = options.editHandleSource;
    if (!source || snapshot.editHandlesLength > source.length) {
      throw new Error("Missing edit handle source for compact semantic context restore");
    }
    context.editHandles = source.slice(0, snapshot.editHandlesLength);
  }
  context.dependencyBuilder.importState(snapshot.dependencyBuilderState);
  context.dependencyActiveSourceId = snapshot.dependencyActiveSourceId;
  importSemanticSymbolResolverState(context.symbolResolver, snapshot.symbolResolverState);
  context.mathRandom.setSeed(snapshot.mathRandomSeed);
  context.statementEffectTracker = null;
}

export function retargetEditHandlesSourceFingerprint(
  handles: EditHandle[],
  sourceFingerprint: string
): void {
  for (let index = 0; index < handles.length; index += 1) {
    const handle = handles[index];
    if (!handle || handle.sourceRef.sourceFingerprint === sourceFingerprint) {
      continue;
    }
    handles[index] = {
      ...handle,
      sourceRef: {
        ...handle.sourceRef,
        sourceFingerprint
      }
    };
  }
}

export function withDependencySource<T>(
  context: SemanticContext,
  sourceId: string,
  fn: () => T
): T {
  const previous = context.dependencyActiveSourceId;
  context.dependencyBuilder.ensureSourceNode(sourceId);
  context.dependencyActiveSourceId = sourceId;
  try {
    return fn();
  } finally {
    context.dependencyActiveSourceId = previous;
  }
}

export function defineContextSymbol(
  context: SemanticContext,
  definition: SemanticSymbolDefinition
): void {
  defineSemanticSymbol(context.symbolResolver, definition);
}

export function resolveContextSymbol(
  context: SemanticContext,
  kind: SemanticSymbolKind,
  name: string,
  explicitConsumerStatementId?: string | null
): SemanticSymbolDefinition | null {
  const consumerStatementId = explicitConsumerStatementId ?? context.dependencyActiveSourceId ?? null;
  return resolveSemanticSymbol(context.symbolResolver, kind, name, consumerStatementId);
}

export function requireContextLibrary(
  context: SemanticContext,
  libraryName: string,
  explicitConsumerStatementId?: string | null
): void {
  const consumerStatementId = explicitConsumerStatementId ?? context.dependencyActiveSourceId ?? null;
  requireSemanticLibrary(context.symbolResolver, libraryName, consumerStatementId);
}

export function listContextSymbolDependencyEdges(context: SemanticContext): SemanticSymbolDependencyEdge[] {
  return [...context.symbolResolver.dependencyEdges.values()].sort((left, right) => {
    if (left.consumerStatementId !== right.consumerStatementId) {
      return left.consumerStatementId.localeCompare(right.consumerStatementId);
    }
    if (left.providerStatementId !== right.providerStatementId) {
      return left.providerStatementId.localeCompare(right.providerStatementId);
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.name.localeCompare(right.name);
  });
}

export function listContextUnresolvedSymbols(context: SemanticContext): SemanticUnresolvedSymbol[] {
  return [...context.symbolResolver.unresolvedSymbols.values()].sort((left, right) => {
    if (left.consumerStatementId !== right.consumerStatementId) {
      return left.consumerStatementId.localeCompare(right.consumerStatementId);
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.name.localeCompare(right.name);
  });
}

export function listContextRequiredLibraries(context: SemanticContext): string[] {
  return [...context.symbolResolver.requiredLibraries].sort((left, right) => left.localeCompare(right));
}

export function writeContextMacroBinding(
  context: SemanticContext,
  name: string,
  binding: MacroBinding,
  definition?: { statementId: string; span: { from: number; to: number } }
): void {
  const frame = currentFrame(context);
  frame.macroBindings.set(name, binding);
  if (definition) {
    defineContextSymbol(context, {
      kind: "macro",
      name,
      statementId: definition.statementId,
      span: definition.span
    });
  }
}

export function readContextMacroBinding(
  context: SemanticContext,
  name: string,
  explicitConsumerStatementId?: string | null
): MacroBinding | undefined {
  void resolveContextSymbol(context, "macro", name, explicitConsumerStatementId);
  const frame = currentFrame(context);
  return frame.macroBindings.get(name);
}

export function deleteContextMacroBinding(context: SemanticContext, name: string): void {
  const frame = currentFrame(context);
  frame.macroBindings.delete(name);
}

export function writeContextColorAlias(
  context: SemanticContext,
  name: string,
  value: string,
  definition?: { statementId: string; span: { from: number; to: number } }
): void {
  const normalized = normalizeColorAliasKey(name);
  if (!normalized) {
    return;
  }
  const frame = currentFrame(context);
  frame.colorAliases.set(normalized, value);
  if (definition) {
    defineContextSymbol(context, {
      kind: "color",
      name: normalized,
      statementId: definition.statementId,
      span: definition.span
    });
  }
}

export function resolveContextColorAliasValue(
  context: SemanticContext,
  rawColorName: string,
  explicitConsumerStatementId?: string | null
): string | null {
  const initialKey = normalizeColorAliasKey(rawColorName);
  if (!initialKey) {
    return null;
  }
  const consumerStatementId = explicitConsumerStatementId ?? context.dependencyActiveSourceId ?? null;
  const frame = currentFrame(context);
  if (!frame.colorAliases.has(initialKey)) {
    return null;
  }
  void resolveContextSymbol(context, "color", initialKey, consumerStatementId);
  let resolved = frame.colorAliases.get(initialKey);
  if (!resolved) {
    return null;
  }

  const seen = new Set<string>([initialKey]);
  while (true) {
    const nextKey = normalizeColorAliasKey(resolved);
    if (!nextKey || seen.has(nextKey)) {
      break;
    }
    if (!frame.colorAliases.has(nextKey)) {
      break;
    }
    void resolveContextSymbol(context, "color", nextKey, consumerStatementId);
    const nextResolved = frame.colorAliases.get(nextKey);
    if (!nextResolved) {
      break;
    }
    seen.add(nextKey);
    resolved = nextResolved;
  }
  return resolved;
}

function normalizeColorAliasKey(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

export function recordDependencyProducer(
  context: SemanticContext,
  resourceKind: SemanticDependencyResourceKind,
  resourceKey: string,
  explicitSourceId?: string
): void {
  const sourceId = explicitSourceId ?? context.dependencyActiveSourceId;
  if (!sourceId) {
    return;
  }
  const tracker = context.statementEffectTracker;
  if (tracker) {
    if (resourceKind === "named-path") {
      tracker.producedNamedPaths.add(resourceKey);
    }
  }
  context.dependencyBuilder.addProducer(sourceId, resourceKind, resourceKey);
}

export function recordDependencyConsumer(
  context: SemanticContext,
  resourceKind: SemanticDependencyResourceKind,
  resourceKey: string,
  explicitSourceId?: string
): void {
  const sourceId = explicitSourceId ?? context.dependencyActiveSourceId;
  if (!sourceId) {
    return;
  }
  const tracker = context.statementEffectTracker;
  if (tracker) {
    tracker.consumedNamedResources.set(`${resourceKind}\u0000${resourceKey}`, {
      kind: resourceKind,
      key: resourceKey
    });
  }
  context.dependencyBuilder.addConsumer(sourceId, resourceKind, resourceKey);
}

export function markDependencyOpaque(
  context: SemanticContext,
  sourceId: string,
  reason: SemanticDependencyOpaqueReason
): void {
  const tracker = context.statementEffectTracker;
  if (tracker && (context.dependencyActiveSourceId == null || context.dependencyActiveSourceId === sourceId)) {
    tracker.opaqueReasons.add(reason);
  }
  context.dependencyBuilder.markSourceOpaque(sourceId, reason);
}

export function writeNamedCoordinate(
  context: SemanticContext,
  name: string,
  point: WorldPoint,
  explicitSourceId?: string
): void {
  context.namedCoordinates.set(name, point);
  const tracker = context.statementEffectTracker;
  if (tracker) {
    tracker.producedNamedCoordinates.set(name, { ...point });
  }
  recordDependencyProducer(context, "named-coordinate", name, explicitSourceId);
}

export function readNamedCoordinate(
  context: SemanticContext,
  name: string,
  explicitSourceId?: string
): WorldPoint | undefined {
  const point = context.namedCoordinates.get(name);
  if (point != null) {
    recordDependencyConsumer(context, "named-coordinate", name, explicitSourceId);
  }
  return point;
}

export function writeNamedNodeGeometry(
  context: SemanticContext,
  name: string,
  geometry: NamedNodeGeometry,
  explicitSourceId?: string
): void {
  context.namedNodeGeometries.set(name, geometry);
  const tracker = context.statementEffectTracker;
  if (tracker) {
    tracker.producedNamedNodeGeometries.set(name, structuredClone(geometry));
  }
  recordDependencyProducer(context, "named-node-geometry", name, explicitSourceId);
}

export function readNamedNodeGeometry(
  context: SemanticContext,
  name: string,
  explicitSourceId?: string
): NamedNodeGeometry | undefined {
  const geometry = context.namedNodeGeometries.get(name);
  if (geometry != null) {
    recordDependencyConsumer(context, "named-node-geometry", name, explicitSourceId);
  }
  return geometry;
}

export function appendNamedPathElements(
  context: SemanticContext,
  name: string,
  elements: SceneElement[],
  producerSourceIds: Iterable<string>
): void {
  const existing = context.namedPaths.get(name) ?? [];
  context.namedPaths.set(name, [...existing, ...elements]);
  const tracker = context.statementEffectTracker;
  if (tracker) {
    tracker.producedNamedPaths.add(name);
  }
  for (const sourceId of producerSourceIds) {
    context.dependencyBuilder.addProducer(sourceId, "named-path", name);
  }
}

export function readNamedPath(
  context: SemanticContext,
  name: string,
  explicitSourceId?: string
): SceneElement[] | undefined {
  const elements = context.namedPaths.get(name);
  if (elements != null) {
    recordDependencyConsumer(context, "named-path", name, explicitSourceId);
  }
  return elements;
}

export function beginStatementEffectTracking(context: SemanticContext): void {
  context.statementEffectTracker = {
    producedNamedCoordinates: new Map<string, WorldPoint>(),
    producedNamedNodeGeometries: new Map<string, NamedNodeGeometry>(),
    producedNamedPaths: new Set<string>(),
    consumedNamedResources: new Map<string, SemanticStatementConsumedResource>(),
    opaqueReasons: new Set<SemanticDependencyOpaqueReason>()
  };
}

export function endStatementEffectTracking(
  context: SemanticContext,
  options: {
    beforeCurrentPoint: WorldPoint | null;
    beforePathStartPoint: WorldPoint | null;
    requiresSequentialContext: boolean;
  }
): SemanticStatementEffectSummary {
  const tracker = context.statementEffectTracker;
  context.statementEffectTracker = null;
  if (!tracker) {
    return {
      producesNamedCoordinates: [],
      producesNamedNodeGeometries: [],
      producesNamedPaths: [],
      consumesNamedResources: [],
      mutatesCurrentPoint: pointsDiffer(options.beforeCurrentPoint, context.currentPoint),
      nextCurrentPoint: context.currentPoint ? { ...context.currentPoint } : null,
      mutatesPathStartPoint: pointsDiffer(options.beforePathStartPoint, context.pathStartPoint),
      nextPathStartPoint: context.pathStartPoint ? { ...context.pathStartPoint } : null,
      requiresSequentialContext: options.requiresSequentialContext,
      suffixSkipKind: "unsafe",
      opaque: false,
      opaqueReasons: []
    };
  }
  return {
    producesNamedCoordinates: [...tracker.producedNamedCoordinates.entries()].map(([key, point]) => ({
      key,
      point: { ...point }
    })),
    producesNamedNodeGeometries: [...tracker.producedNamedNodeGeometries.entries()].map(([key, geometry]) => ({
      key,
      geometry: structuredClone(geometry)
    })),
    producesNamedPaths: [...tracker.producedNamedPaths],
    consumesNamedResources: [...tracker.consumedNamedResources.values()].sort((left, right) => {
      const leftKey = `${left.kind}\u0000${left.key}`;
      const rightKey = `${right.kind}\u0000${right.key}`;
      return leftKey.localeCompare(rightKey);
    }),
    mutatesCurrentPoint: pointsDiffer(options.beforeCurrentPoint, context.currentPoint),
    nextCurrentPoint: context.currentPoint ? { ...context.currentPoint } : null,
    mutatesPathStartPoint: pointsDiffer(options.beforePathStartPoint, context.pathStartPoint),
    nextPathStartPoint: context.pathStartPoint ? { ...context.pathStartPoint } : null,
    requiresSequentialContext: options.requiresSequentialContext,
    suffixSkipKind: "unsafe",
    opaque: tracker.opaqueReasons.size > 0,
    opaqueReasons: [...tracker.opaqueReasons].sort()
  };
}

export function applyStatementEffectSummary(
  context: SemanticContext,
  summary: SemanticStatementEffectSummary,
  options: { sourceId?: string } = {}
): void {
  const sourceId = options.sourceId;
  if (sourceId) {
    context.dependencyBuilder.ensureSourceNode(sourceId);
  }
  for (const produced of summary.producesNamedCoordinates) {
    context.namedCoordinates.set(produced.key, { ...produced.point });
    recordDependencyProducer(context, "named-coordinate", produced.key, sourceId);
  }
  for (const produced of summary.producesNamedNodeGeometries) {
    context.namedNodeGeometries.set(produced.key, structuredClone(produced.geometry));
    recordDependencyProducer(context, "named-node-geometry", produced.key, sourceId);
  }
  for (const producedPath of summary.producesNamedPaths) {
    recordDependencyProducer(context, "named-path", producedPath, sourceId);
  }
  for (const consumed of summary.consumesNamedResources) {
    recordDependencyConsumer(context, consumed.kind, consumed.key, sourceId);
  }
  if (sourceId) {
    for (const reason of summary.opaqueReasons) {
      markDependencyOpaque(context, sourceId, reason);
    }
  }
  context.currentPoint = summary.nextCurrentPoint ? { ...summary.nextCurrentPoint } : null;
  context.pathStartPoint = summary.nextPathStartPoint ? { ...summary.nextPathStartPoint } : null;
}

function pointsDiffer(left: WorldPoint | null, right: WorldPoint | null): boolean {
  if (left == null || right == null) {
    return left !== right;
  }
  return left.x !== right.x || left.y !== right.y;
}
