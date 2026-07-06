import type {
  ColorletStatement,
  DefineColorStatement,
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  PgfMathStatement,
  PgfkeysStatement,
  PathItem,
  PicOperationItem,
  Span,
  TikzLibraryStatement,
  TikzSetStatement,
  TikzStyleStatement,
  TikzFigure,
  Statement
} from "../ast/types.js";
import { pt } from "../coords/scalars.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { FEATURE_IDS } from "../capabilities/feature-ids.js";
import type { FeatureId } from "../capabilities/feature-ids.js";
import { expandForeachFigure } from "../foreach/index.js";
import {
  DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
  expandMacroBindings,
  isControlSequenceToken,
  type MacroBinding,
  type MacroExpansionTraceEvent,
  type MacroOriginFrame
} from "../macros/index.js";
import type {
  ExpansionSourceMap,
  ForeachOriginFrame as ExpansionForeachOriginFrame,
  ForeachStatementAttribution
} from "../foreach/types.js";
import { parseStatementsFromBodyWithMapping } from "../foreach/snippet-parse.js";
import {
  finalizeExpandedStatementElements,
  finalizeExpandedStatementHandles,
  mapExpansionSpan,
  remapDiagnostics
} from "./attribution.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import {
  beginStatementEffectTracking,
  readContextMacroBinding,
  resolveContextColorAliasValue,
  defineContextSymbol,
  createSemanticContext,
  currentFrame,
  endStatementEffectTracking,
  listContextSceneLayers,
  listContextRequiredLibraries,
  listContextSymbolDependencyEdges,
  listContextUnresolvedSymbols,
  markBackgroundLayerUsed,
  markDependencyOpaque,
  popFrame,
  pushFrame,
  requireContextLibrary,
  resolveContextSymbol,
  withDependencySource,
  writeContextColorAlias,
  writeContextMacroBinding,
  type SemanticContext,
  type SemanticStatementEffectSummary,
  type SemanticStatementSuffixSkipKind,
  type ProvenanceOptionList,
  type NodeDistanceSpec,
  type NodeQuotesMode
} from "./context.js";
import {
  collectBackgroundOptionEffects,
  extractOnBackgroundLayerOptionLayers,
  generateBackgroundHookElements,
  makeEveryOnBackgroundLayerOptionLayer
} from "./backgrounds.js";
import type { SemanticDependencyGraph } from "./dependencies.js";
import { evaluateRawCoordinate } from "./coords/evaluate.js";
import { parseLength } from "./coords/parse-length.js";
import { evaluatePathStatement } from "./path/evaluate.js";
import type { PlacementSegment } from "./path/types.js";
import { tangentAtPlacementSegment, resolvePathAttachedNodeSloped } from "./path/path-attached.js";
import { applyNameIntersectionsDirective, collectPathIntersectionDirectives, registerNamedPath } from "./path/intersections.js";
import { parseNodeDistance } from "./path/node-positioning.js";
import { DEFAULT_TEXT_FONT_SIZE, defaultStyle, commandDefaultStyle, parseStyleValueAsOptionList, resolveContextDelta } from "./style/resolve.js";
import { styleDiagnosticCode, styleDiagnosticSpan, type StyleDiagnostic } from "./style/diagnostics.js";
import { applyCustomStyleDefinition, cloneCustomStyleRegistry } from "./style/custom-styles.js";
import {
  applyPicDefinitionsFromOptionLists,
  clonePicDefinitionRegistry,
  resolvePicCode,
  type ResolvedPicCode
} from "./pics/registry.js";
import { expandOptionListMacros } from "./style/macro-options.js";
import { FONT_SIZE_COMMAND_FACTORS } from "./style/constants.js";
import { resolveDefineColorModel } from "./style/colors.js";
import { applyMatrix, identityMatrix, multiplyMatrix, rotationMatrix, translationMatrix } from "./transform.js";
import { worldTransform, type WorldTransform } from "../coords/transforms.js";
import { cloneResolvedStyle, cloneStyleChain, diffResolvedStyle, type StyleChainEntry, type StyleSourceRef, type StyleTraceLayerInput } from "./style-chain.js";
import { inferRequiredTikzLibraries } from "./required-tikz-libraries.js";
import { parseBooleanishNormalized } from "../utils/booleanish.js";
import { stripWrappingBraces } from "../utils/braces.js";
import { evaluatePgfMathExpression, formatPgfMathNumber } from "./pgfmath/evaluator.js";
import { withPgfMathRuntime } from "./pgfmath/runtime.js";
import { worldPoint, worldBounds } from "../coords/points.js";
import type { WorldBounds, WorldPoint } from "../coords/points.js";
import { resolveNodePositionFraction } from "./nodes/placement.js";
import type {
  EditHandle,
  EvaluateOptions,
  FeatureUsage,
  NodeAnchorTarget,
  SceneElement,
  SceneFigure,
  SceneClipPath,
  ScenePathCommand,
  SceneLayer,
  PicOriginFrame
} from "./types.js";
import { BACKGROUND_SCENE_LAYER, MAIN_SCENE_LAYER } from "./types.js";
import type { SemanticSymbolDependencyEdge, SemanticUnresolvedSymbol } from "./symbol-resolver.js";

export type EvaluateTikzResult = {
  scene: SceneFigure;
  diagnostics: Diagnostic[];
  featureUsage: FeatureUsage;
  editHandles: EditHandle[];
  nodeAnchorTargets: NodeAnchorTarget[];
  dependencies: SemanticDependencyGraph;
  sourceStatementFirstIndexBySourceId: Record<string, number>;
  colorAliases: ReadonlyMap<string, string>;
  symbolDependencyEdges: SemanticSymbolDependencyEdge[];
  unresolvedSymbols: SemanticUnresolvedSymbol[];
};

export type SemanticStatementEvaluationRecord = {
  statementId: string;
  sourceId: string;
  sourceSpan: { from: number; to: number };
  elements: SceneElement[];
  editHandles: EditHandle[];
  diagnostics: Diagnostic[];
  handleStart: number;
  handleEnd: number;
  diagnosticsStart: number;
  diagnosticsEnd: number;
  effectSummary: SemanticStatementEffectSummary;
};

export type SemanticEvaluationRun = {
  figure: TikzFigure;
  source: string;
  context: SemanticContext;
  diagnostics: Diagnostic[];
  featureUsage: FeatureUsage;
  expandedFigureBody: Statement[];
  sourceStatementSpanById: Map<string, { from: number; to: number }>;
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>;
  statementSourceMaps: WeakMap<Statement, ExpansionSourceMap>;
  pathItemForeachStack: WeakMap<PathItem, ExpansionForeachOriginFrame[]>;
  pathItemSourceMaps: WeakMap<PathItem, ExpansionSourceMap>;
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>;
  templateLocalIdByExpandedId: Map<string, string>;
  rootFramePushed: boolean;
  baseDiagnosticsCount: number;
};

function pushStyleDiagnostics(
  diagnostics: Diagnostic[],
  styleDiagnostics: readonly StyleDiagnostic[],
  messagePrefix: string,
  fallbackSpan: Span
): void {
  for (const styleDiagnostic of styleDiagnostics) {
    const code = styleDiagnosticCode(styleDiagnostic);
    diagnostics.push({
      severity: "warning",
      code,
      message: `${messagePrefix}: ${code}`,
      span: styleDiagnosticSpan(styleDiagnostic, fallbackSpan)
    });
  }
}

export function evaluateTikzFigure(figure: TikzFigure, source: string, opts: EvaluateOptions = {}): EvaluateTikzResult {
  const run = createSemanticEvaluationRun(figure, source, opts);
  const elementsByStatement: SceneElement[][] = [];
  for (let statementIndex = 0; statementIndex < run.expandedFigureBody.length; statementIndex += 1) {
    const evaluated = evaluateSemanticStatementByIndex(run, statementIndex);
    elementsByStatement.push(evaluated.elements);
  }
  return finalizeSemanticEvaluationRun(run, elementsByStatement);
}

export function createSemanticEvaluationRun(
  figure: TikzFigure,
  source: string,
  opts: EvaluateOptions = {}
): SemanticEvaluationRun {
  const diagnostics: Diagnostic[] = [];
  const featureUsage = initializeFeatureUsage();
  markForeachFeaturesFromFigure(figure, featureUsage);
  const context = createSemanticContext(
    defaultStyle(),
    identityMatrix(),
    opts.textEngine ?? null,
    source,
    opts.sourceFingerprint
  );
  const expanded = withPgfMathRuntime(
    { rng: context.mathRandom },
    () => expandForeachFigure(figure, source, opts.maxForeachExpansions ?? 10_000)
  );
  const prePictureContextStatements = expanded.figureBody.filter((statement) =>
    isPrePictureContextStatement(statement, figure, expanded.statementAttribution, expanded.statementSourceMaps)
  );
  const activeExpandedFigureBody = expanded.figureBody.filter((statement) =>
    !isPrePictureContextStatement(statement, figure, expanded.statementAttribution, expanded.statementSourceMaps)
  );
  for (const diagnostic of expanded.diagnostics) {
    diagnostics.push({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      span: diagnostic.span
    });
  }

  for (const statement of prePictureContextStatements) {
    const contextStatement = remapPrePictureContextStatement(statement, expanded.statementSourceMaps.get(statement));
    withDependencySource(context, statement.id, () =>
      withPgfMathRuntime(
        { rng: context.mathRandom },
        () => evaluateStatement(contextStatement, context, diagnostics, featureUsage, expanded.statementMacroAttribution)
      )
    );
  }
  const parent = currentFrame(context);
  const rootCustomStyles = cloneCustomStyleRegistry(parent.customStyles);
  const figureSourceRef: StyleSourceRef = {
    sourceId: `figure:${figure.span.from}:${figure.span.to}`,
    sourceSpan: figure.options?.span ?? figure.span,
    sourceKind: "figure-options",
    label: "figure"
  };
  const rootOptionLayers = buildRootPictureOptionLayers(figure, parent, context, figureSourceRef);
  const rootFramePushed = rootOptionLayers.length > 0;
  if (rootFramePushed) {
    markFeature(featureUsage, "options_structured", "supported");
    const rootPicDefinitions = clonePicDefinitionRegistry(parent.picDefinitions);
    applyPicDefinitionsFromOptionLists(
      rootPicDefinitions,
      rootOptionLayers.flatMap((layer) => layer.rawOptions),
      figureSourceRef
    );
    const rootDelta = resolveContextDelta(
      parent.style,
      parent.transform,
      rootOptionLayers,
      rootCustomStyles,
      (raw) => evaluateRawCoordinate(raw, context).world,
      parent.styleChain,
      (raw) => resolveContextColorAliasValue(context, raw)
    );
    if (containsCmOption(rootDelta.expandedOptionLists)) {
      markFeature(featureUsage, "transform_cm", "supported");
    }
    const rootMeta = resolveFrameMeta(parent, rootDelta.expandedOptionLists, figureSourceRef);
    if (collectBackgroundOptionEffects(context, rootDelta.expandedOptionLists, figureSourceRef)) {
      markFeature(featureUsage, "backgrounds_library", "supported");
    }
    pushFrame(context, {
      style: rootDelta.style,
      styleChain: rootDelta.chain,
      transform: rootDelta.transform,
      layer: parent.layer,
      clipChain: [...parent.clipChain],
      pictureSizeRelevant: parent.pictureSizeRelevant,
      customStyles: rootCustomStyles,
      picDefinitions: rootPicDefinitions,
      colorAliases: new Map(parent.colorAliases),
      macroBindings: new Map(parent.macroBindings),
      namePrefix: rootMeta.namePrefix,
      nameSuffix: rootMeta.nameSuffix,
      nodeLayerMode: rootMeta.nodeLayerMode,
      onGrid: rootMeta.onGrid,
      nodeDistance: rootMeta.nodeDistance,
      nodeQuotesMode: rootMeta.nodeQuotesMode,
      labelPosition: rootMeta.labelPosition,
      pinPosition: rootMeta.pinPosition,
      labelDistancePt: rootMeta.labelDistancePt,
      pinDistancePt: rootMeta.pinDistancePt,
      pinEdgeRaw: rootMeta.pinEdgeRaw,
      transformShape: rootMeta.transformShape,
      ...cloneFrameStyleBuckets(rootMeta),
      treeLevel: rootMeta.treeLevel,
      treeLevelDistancePt: rootMeta.treeLevelDistancePt,
      treeSiblingDistancePt: rootMeta.treeSiblingDistancePt,
      treeCurrentLevelSiblingDistancePt: rootMeta.treeCurrentLevelSiblingDistancePt,
      treeGrowDirectionDegrees: rootMeta.treeGrowDirectionDegrees,
      treeGrowReverse: rootMeta.treeGrowReverse,
      treeGrowthParentAnchor: rootMeta.treeGrowthParentAnchor,
      treeParentAnchor: rootMeta.treeParentAnchor,
      treeChildAnchor: rootMeta.treeChildAnchor,
      treeMissing: rootMeta.treeMissing,
      treeEveryChildStyles: rootMeta.treeEveryChildStyles,
      treeEveryChildNodeStyles: rootMeta.treeEveryChildNodeStyles,
      treeLevelStyleTemplateLayers: rootMeta.treeLevelStyleTemplateLayers,
      treeLevelStyleLayers: rootMeta.treeLevelStyleLayers.map((entry) => ({
        level: entry.level,
        layers: [...entry.layers]
      })),
      treeDeferredGrowthFunction: rootMeta.treeDeferredGrowthFunction,
      treeDeferredEdgeFromParentPath: rootMeta.treeDeferredEdgeFromParentPath,
      treeDeferredEdgeFromParentMacro: rootMeta.treeDeferredEdgeFromParentMacro
    });
    pushStyleDiagnostics(diagnostics, rootDelta.diagnostics, "Figure option issue", figureSourceRef.sourceSpan ?? figure.span);
  }

  return {
    figure,
    source,
    context,
    diagnostics,
    featureUsage,
    expandedFigureBody: activeExpandedFigureBody,
    sourceStatementSpanById: buildSourceStatementSpanById(figure.body),
    statementAttribution: expanded.statementAttribution,
    statementSourceMaps: expanded.statementSourceMaps,
    pathItemForeachStack: expanded.pathItemForeachStack,
    pathItemSourceMaps: expanded.pathItemSourceMaps,
    statementMacroAttribution: expanded.statementMacroAttribution,
    templateLocalIdByExpandedId: expanded.templateLocalIdByExpandedId,
    rootFramePushed,
    baseDiagnosticsCount: diagnostics.length
  };
}

export function evaluateSemanticStatementByIndex(
  run: SemanticEvaluationRun,
  statementIndex: number
): SemanticStatementEvaluationRecord {
  const statement = run.expandedFigureBody[statementIndex];
  if (!statement) {
    throw new Error(`Statement index ${statementIndex} is out of bounds`);
  }
  const handleStart = run.context.editHandles.length;
  const diagnosticsStart = run.diagnostics.length;
  const beforeCurrentPoint = run.context.currentPoint ? { ...run.context.currentPoint } : null;
  const beforePathStartPoint = run.context.pathStartPoint ? { ...run.context.pathStartPoint } : null;
  beginStatementEffectTracking(run.context);
  const statementElements = withDependencySource(run.context, statement.id, () =>
    withPgfMathRuntime(
      { rng: run.context.mathRandom },
      () => evaluateStatement(statement, run.context, run.diagnostics, run.featureUsage, run.statementMacroAttribution)
    )
  );
  const sourceId = run.statementAttribution.get(statement)?.sourceId ?? statement.id;
  const statementSourceMap = run.statementSourceMaps.get(statement);
  const sourceSpan = statementSourceMap
    ? mapExpansionSpan(statementSourceMap, statement.span)
    : run.sourceStatementSpanById.get(sourceId) ?? statement.span;
  const elements = finalizeStatementElements(
    finalizeExpandedStatementElements({
      statement,
      elements: statementElements,
      statementAttribution: run.statementAttribution,
      statementSourceMap,
      pathItemForeachStack: run.pathItemForeachStack,
      pathItemSourceMaps: run.pathItemSourceMaps,
      statementMacroAttribution: run.statementMacroAttribution,
      templateLocalIdByExpandedId: run.templateLocalIdByExpandedId
    }),
    run.context.sourceFingerprint
  );
  finalizeExpandedStatementHandles({
    statement,
    handles: run.context.editHandles,
    startIndex: handleStart,
    statementAttribution: run.statementAttribution,
    statementSourceMap,
    pathItemSourceMaps: run.pathItemSourceMaps,
    source: run.context.source
  });
  const editHandles = finalizeStatementEditHandles(
    run.context.editHandles.slice(handleStart),
    run.context.sourceFingerprint,
    run.context.source
  );
  for (let index = 0; index < editHandles.length; index += 1) {
    run.context.editHandles[handleStart + index] = editHandles[index];
  }
  remapDiagnostics(run.diagnostics, diagnosticsStart, statementSourceMap, {
    statement,
    elements,
    pathItemSourceMaps: run.pathItemSourceMaps
  });
  const diagnostics = run.diagnostics.slice(diagnosticsStart);
  const statementMacroStack = run.statementMacroAttribution.get(statement);
  if (statementMacroStack && statementMacroStack.length > 0) {
    for (const origin of statementMacroStack) {
      resolveContextSymbol(run.context, "macro", origin.macroName, statement.id);
    }
  }
  const effectSummary = endStatementEffectTracking(run.context, {
    beforeCurrentPoint,
    beforePathStartPoint,
    requiresSequentialContext: statement.kind !== "Path"
  });
  const opaqueReasons = extractElementOpaqueReasons(elements);
  if (opaqueReasons.length > 0) {
    effectSummary.opaque = true;
    effectSummary.opaqueReasons = opaqueReasons;
  }
  effectSummary.suffixSkipKind = classifyStatementSuffixSkipKind(statement, opaqueReasons);
  return {
    statementId: statement.id,
    sourceId,
    sourceSpan,
    elements,
    editHandles,
    diagnostics,
    handleStart,
    handleEnd: run.context.editHandles.length,
    diagnosticsStart,
    diagnosticsEnd: run.diagnostics.length,
    effectSummary
  };
}

export function finalizeSemanticEvaluationRun(
  run: SemanticEvaluationRun,
  elementsByStatement: readonly SceneElement[][]
): EvaluateTikzResult {
  const elements: SceneElement[] = [];
  for (const statementElements of elementsByStatement) {
    elements.push(...statementElements);
  }

  const colorAliases = new Map(currentFrame(run.context).colorAliases);
  const contentBounds = run.context.pictureBounds ?? computeBounds(elements) ?? null;
  const generatedBackground = generateBackgroundHookElements(
    run.context,
    contentBounds,
    run.context.sourceFingerprint
  );
  if (generatedBackground.elements.length > 0) {
    elements.push(...generatedBackground.elements);
  }
  if (generatedBackground.diagnostics.length > 0) {
    run.diagnostics.push(...generatedBackground.diagnostics);
  }

  if (run.rootFramePushed) {
    popFrame(run.context);
  }

  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    elements[index] = {
      ...element,
      layer: element.layer || MAIN_SCENE_LAYER,
      runtimeId: element.runtimeId ?? element.id,
      sourceRef: {
        ...element.sourceRef,
        sourceFingerprint: run.context.sourceFingerprint
      }
    };
  }

  for (let index = 0; index < run.context.editHandles.length; index += 1) {
    const handle = run.context.editHandles[index];
    if (!handle) {
      continue;
    }
    run.context.editHandles[index] = {
      ...handle,
      runtimeId: handle.runtimeId ?? handle.id
    };
  }

  markOpaqueDependencySources(elements, run.context);
  const layers = listContextSceneLayers(run.context);
  const orderedElements = orderSceneElementsByLayer(elements, layers);
  const inferredRequiredLibraries = inferRequiredTikzLibraries({
    featureUsage: run.featureUsage,
    elements: orderedElements
  });
  for (const libraryName of inferredRequiredLibraries) {
    requireContextLibrary(run.context, libraryName, null);
  }
  const requiredTikzLibraries = listContextRequiredLibraries(run.context);

  return {
    scene: {
      kind: "SceneFigure",
      span: run.figure.span,
      requiredTikzLibraries,
      layers,
      elements: orderedElements,
      bounds:
        generatedBackground.elements.length > 0
          ? computeBounds(orderedElements) ?? run.context.pictureBounds ?? undefined
          : run.context.pictureBounds ?? computeBounds(orderedElements),
      hasStatefulGraphicsState:
        run.featureUsage.path_clipping === "used-supported" ||
        run.featureUsage.use_as_bounding_box === "used-supported" ||
        run.featureUsage.backgrounds_library === "used-supported" ||
        run.context.backgroundState.used
    },
    diagnostics: run.diagnostics,
    featureUsage: run.featureUsage,
    editHandles: run.context.editHandles,
    nodeAnchorTargets: collectNodeAnchorTargets(run.context),
    dependencies: run.context.dependencyBuilder.build(),
    sourceStatementFirstIndexBySourceId: buildSourceStatementFirstIndexBySourceId(run),
    colorAliases,
    symbolDependencyEdges: listContextSymbolDependencyEdges(run.context),
    unresolvedSymbols: listContextUnresolvedSymbols(run.context)
  };
}

function buildSourceStatementFirstIndexBySourceId(run: SemanticEvaluationRun): Record<string, number> {
  const bySourceId = new Map<string, number>();
  for (let index = 0; index < run.expandedFigureBody.length; index += 1) {
    const statement = run.expandedFigureBody[index];
    const attributed = run.statementAttribution.get(statement);
    const sourceId = attributed?.sourceId ?? statement.id;
    const previous = bySourceId.get(sourceId);
    if (previous == null || index < previous) {
      bySourceId.set(sourceId, index);
    }
  }
  return Object.fromEntries([...bySourceId.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function buildRootPictureOptionLayers(
  figure: TikzFigure,
  parent: ReturnType<typeof currentFrame>,
  context: SemanticContext,
  figureSourceRef: StyleSourceRef
): StyleTraceLayerInput[] {
  const layers: StyleTraceLayerInput[] = [];
  if (parent.customStyles.has("every picture")) {
    const everyPictureOptions = parseStyleValueAsOptionList("every picture");
    if (everyPictureOptions) {
      layers.push({
        kind: "scope",
        sourceRef: {
          sourceId: figureSourceRef.sourceId,
          sourceSpan: figure.span,
          sourceKind: "figure-options",
          label: "every picture"
        },
        rawOptions: [everyPictureOptions]
      });
    }
  }

  if (figure.options) {
    layers.push({
      kind: "scope",
      sourceRef: figureSourceRef,
      rawOptions: expandOptionListMacros(
        [figure.options],
        parent.macroBindings,
        context.macroTraceCollector ?? undefined
      )
    });
  }
  return layers;
}

function isPrePictureContextStatement(
  statement: Statement,
  figure: TikzFigure,
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>,
  statementSourceMaps: WeakMap<Statement, ExpansionSourceMap>
): boolean {
  return resolveAuthoredStatementSpan(statement, statementAttribution, statementSourceMaps).to <= figure.span.from;
}

function resolveAuthoredStatementSpan(
  statement: Statement,
  statementAttribution: WeakMap<Statement, ForeachStatementAttribution>,
  statementSourceMaps: WeakMap<Statement, ExpansionSourceMap>
): Span {
  const sourceMap = statementSourceMaps.get(statement);
  if (sourceMap) {
    return mapExpansionSpan(sourceMap, statement.span);
  }

  return statementAttribution.get(statement)?.sourceSpan ?? statement.span;
}

function remapPrePictureContextStatement(
  statement: Statement,
  sourceMap: ExpansionSourceMap | undefined
): Statement {
  if (!sourceMap) {
    return statement;
  }
  return remapSpansDeepWithExpansionSourceMap(statement, sourceMap) as Statement;
}

function remapSpansDeepWithExpansionSourceMap(value: unknown, sourceMap: ExpansionSourceMap): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => remapSpansDeepWithExpansionSourceMap(entry, sourceMap));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  let nextRecord: Record<string, unknown> | null = null;
  if (isSpanLikeRecord(record)) {
    const mapped = sourceMap.mapSpan({ from: record.from, to: record.to }) ?? sourceMap.sourceSpan;
    nextRecord = {
      ...record,
      from: mapped.from,
      to: mapped.to
    };
  }

  const sourceRecord = nextRecord ?? record;
  for (const [key, nested] of Object.entries(sourceRecord)) {
    const mapped = remapSpansDeepWithExpansionSourceMap(nested, sourceMap);
    if (mapped !== nested) {
      nextRecord ??= { ...sourceRecord };
      nextRecord[key] = mapped;
    }
  }

  return nextRecord ?? value;
}

function isSpanLikeRecord(record: Record<string, unknown>): record is Record<string, unknown> & Span {
  return typeof record.from === "number" && typeof record.to === "number";
}

function buildSourceStatementSpanById(
  statements: readonly Statement[]
): Map<string, { from: number; to: number }> {
  const spans = new Map<string, { from: number; to: number }>();
  const visit = (statement: Statement) => {
    spans.set(statement.id, { ...statement.span });
    if (statement.kind === "Scope") {
      for (const nested of statement.body) {
        visit(nested);
      }
    }
  };
  for (const statement of statements) {
    visit(statement);
  }
  return spans;
}

function finalizeStatementElements(
  elements: SceneElement[],
  sourceFingerprint: string
): SceneElement[] {
  return elements.map((element) => ({
    ...element,
    layer: element.layer || MAIN_SCENE_LAYER,
    runtimeId: element.runtimeId ?? element.id,
    sourceRef: {
      ...element.sourceRef,
      sourceFingerprint
    }
  }));
}

function assignSceneElementLayer(elements: SceneElement[], layer: string): SceneElement[] {
  return elements.map((element) => ({
    ...element,
    layer
  }));
}

function orderSceneElementsByLayer(elements: SceneElement[], layers: readonly SceneLayer[]): SceneElement[] {
  const layerOrder = new Map(layers.map((layer) => [layer.name, layer.order]));
  const fallbackOrder = layerOrder.get(MAIN_SCENE_LAYER) ?? Number.MAX_SAFE_INTEGER;
  return elements
    .map((element, index) => ({
      element,
      index,
      order: layerOrder.get(element.layer || MAIN_SCENE_LAYER) ?? fallbackOrder
    }))
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.element);
}

function finalizeStatementEditHandles(
  handles: EditHandle[],
  sourceFingerprint: string,
  source: string
): EditHandle[] {
  return handles.map((handle) => ({
    ...handle,
    runtimeId: handle.runtimeId ?? handle.id,
    sourceText: source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to),
    sourceRef: {
      ...handle.sourceRef,
      sourceFingerprint
    }
  }));
}

function extractElementOpaqueReasons(
  elements: readonly SceneElement[]
): Array<"foreach-origin" | "macro-origin"> {
  const reasons = new Set<"foreach-origin" | "macro-origin">();
  for (const element of elements) {
    const origin = element.origin;
    if (!origin) {
      continue;
    }
    if (origin.foreachStack.length > 0) {
      reasons.add("foreach-origin");
    }
    if (origin.macroStack && origin.macroStack.length > 0) {
      reasons.add("macro-origin");
    }
  }
  return [...reasons].sort();
}

function classifyStatementSuffixSkipKind(
  statement: Statement,
  opaqueReasons: ReadonlyArray<"foreach-origin" | "macro-origin">
): SemanticStatementSuffixSkipKind {
  if (opaqueReasons.includes("macro-origin")) {
    return "unsafe";
  }
  if (statement.kind === "Path") {
    if (opaqueReasons.length === 0) {
      return "safe";
    }
    if (opaqueReasons.length === 1 && opaqueReasons[0] === "foreach-origin") {
      return "foreach-origin-safe";
    }
    return "unsafe";
  }
  if (statement.kind === "Scope") {
    if (!isScopeBodySuffixSkipSafe(statement.body)) {
      return "unsafe";
    }
    return "scope-safe";
  }
  return "unsafe";
}

function isScopeBodySuffixSkipSafe(body: readonly Statement[]): boolean {
  for (const statement of body) {
    if (statement.kind === "Path") {
      continue;
    }
    if (statement.kind === "Scope" && isScopeBodySuffixSkipSafe(statement.body)) {
      continue;
    }
    return false;
  }
  return true;
}

export function collectNodeAnchorTargets(context: SemanticContext): NodeAnchorTarget[] {
  const BASIC_ANCHORS = new Set([
    "center",
    "north",
    "south",
    "east",
    "west",
    "north east",
    "north west",
    "south east",
    "south west"
  ]);

  const targets: NodeAnchorTarget[] = [];
  const seen = new Set<string>();
  const anchorsByNode = new Map<string, Array<{ anchor: string; world: WorldPoint }>>();

  for (const [coordinateName, world] of context.namedCoordinates) {
    const dot = coordinateName.indexOf(".");
    if (dot <= 0 || dot >= coordinateName.length - 1) {
      continue;
    }
    const nodeName = coordinateName.slice(0, dot);
    const anchor = coordinateName.slice(dot + 1).trim();
    if (anchor.length === 0) {
      continue;
    }
    const existing = anchorsByNode.get(nodeName);
    if (existing) {
      existing.push({ anchor, world });
    } else {
      anchorsByNode.set(nodeName, [{ anchor, world }]);
    }
  }

  for (const [nodeName, geometry] of context.namedNodeGeometries) {
    const addTarget = (anchor: string, world: WorldPoint) => {
      const normalizedAnchor = anchor.trim().toLowerCase();
      if (normalizedAnchor.length === 0) {
        return;
      }
      const key = `${nodeName}\u0000${normalizedAnchor}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      targets.push({
        nodeName,
        nodeSourceId: geometry.sourceId,
        anchor: normalizedAnchor,
        world: worldPoint(pt(world.x), pt(world.y)),
        tier: BASIC_ANCHORS.has(normalizedAnchor) ? "basic" : "special"
      });
    };

    addTarget("center", context.namedCoordinates.get(nodeName) ?? geometry.center);
    const anchors = anchorsByNode.get(nodeName);
    if (!anchors) {
      continue;
    }
    for (const entry of anchors) {
      addTarget(entry.anchor, entry.world);
    }
  }

  return targets;
}

function markOpaqueDependencySources(
  elements: SceneElement[],
  context: ReturnType<typeof createSemanticContext>
): void {
  const reasonsBySource = new Map<string, Set<"foreach-origin" | "macro-origin">>();

  for (const element of elements) {
    const origin = element.origin;
    if (!origin) {
      continue;
    }

    let reasons = reasonsBySource.get(element.sourceRef.sourceId);
    if (!reasons) {
      reasons = new Set();
      reasonsBySource.set(element.sourceRef.sourceId, reasons);
    }

    if (origin.foreachStack.length > 0) {
      reasons.add("foreach-origin");
    }
    if (origin.macroStack && origin.macroStack.length > 0) {
      reasons.add("macro-origin");
    }
  }

  for (const [sourceId, reasons] of reasonsBySource) {
    for (const reason of reasons) {
      markDependencyOpaque(context, sourceId, reason);
    }
  }
}

function evaluateStatement(
  statement: Statement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  featureUsage: FeatureUsage,
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>
): SceneElement[] {
  if (statement.kind === "Path") {
    markFeature(featureUsage, "path_statement", "supported");
    const parent = currentFrame(context);
    const commandSourceRef: StyleSourceRef = {
      sourceId: statement.id,
      sourceSpan: statement.span,
      sourceKind: "path-statement",
      label: statement.command
    };
    const commandStyleBefore = cloneResolvedStyle(parent.style);
    const baseStyle = { ...parent.style, ...commandDefaultStyle(statement.command, parent.style) };
    const commandDefaultEntry = {
      kind: "global" as const,
      sourceRef: {
        sourceId: statement.id,
        sourceSpan: statement.span,
        sourceKind: "command-default",
        label: statement.command
      },
      rawOptions: [],
      before: commandStyleBefore,
      after: cloneResolvedStyle(baseStyle),
      resolvedContributions: diffResolvedStyle(commandStyleBefore, baseStyle)
    };
    const baseChain = [...cloneStyleChain(parent.styleChain), commandDefaultEntry];
    const optionLists = statement.options ? [statement.options] : [];
    const expandedOptionLists = expandOptionListMacros(
      optionLists,
      parent.macroBindings,
      context.macroTraceCollector ?? undefined
    );
    if (optionLists.length > 0) {
      markFeature(featureUsage, "options_structured", "supported");
      if (containsCmOption(expandedOptionLists)) {
        markFeature(featureUsage, "transform_cm", "supported");
      }
    }
    const scopedCustomStyles = cloneCustomStyleRegistry(parent.customStyles);
    const scopedPicDefinitions = clonePicDefinitionRegistry(parent.picDefinitions);
    applyPicDefinitionsFromOptionLists(scopedPicDefinitions, expandedOptionLists, commandSourceRef);
    const resolved = resolveContextDelta(
      baseStyle,
      parent.transform,
      [
        {
          kind: "command",
          sourceRef: commandSourceRef,
          rawOptions: expandedOptionLists
        }
      ],
      scopedCustomStyles,
      (raw) => evaluateRawCoordinate(raw, context).world,
      baseChain,
      (raw) => resolveContextColorAliasValue(context, raw)
    );
    const frameMeta = resolveFrameMeta(parent, resolved.expandedOptionLists, commandSourceRef);

    if (statement.command === "shade" || statement.command === "shadedraw" || resolved.style.shadeEnabled) {
      markFeature(featureUsage, "path_shading", "supported");
    }
    const hasUnsupportedPattern = resolved.diagnostics.some((diagnostic) =>
      styleDiagnosticCode(diagnostic).startsWith("unsupported-pattern:")
    );
    if (statement.command === "pattern" || resolved.style.fillPattern || hasUnsupportedPattern) {
      markFeature(featureUsage, "path_patterns", hasUnsupportedPattern ? "unsupported" : "supported");
    }
    if (resolved.style.shadowLayers.length > 0) {
      markFeature(featureUsage, "path_shadows", "supported");
    }

    pushStyleDiagnostics(diagnostics, resolved.diagnostics, "Path option issue", statement.span);
    if (resolved.style.markerStart || resolved.style.markerEnd) {
      markFeature(featureUsage, "arrow_tips", "supported");
    }
    const intersectionDirectives = collectPathIntersectionDirectives(resolved.expandedOptionLists);
    if (intersectionDirectives.namedPathNames.length > 0 || intersectionDirectives.nameIntersections) {
      markFeature(featureUsage, "named_coordinates", "supported");
    }
    for (const code of intersectionDirectives.diagnostics) {
      diagnostics.push({
        severity: "warning",
        code,
        message: `Path option issue: ${code}`,
        span: statement.span
      });
    }

    pushFrame(context, {
      style: resolved.style,
      styleChain: resolved.chain,
      transform: resolved.transform,
      layer: parent.layer,
      clipChain: [...parent.clipChain],
      pictureSizeRelevant: parent.pictureSizeRelevant,
      customStyles: scopedCustomStyles,
      picDefinitions: scopedPicDefinitions,
      colorAliases: new Map(parent.colorAliases),
      macroBindings: new Map(parent.macroBindings),
      namePrefix: frameMeta.namePrefix,
      nameSuffix: frameMeta.nameSuffix,
      nodeLayerMode: frameMeta.nodeLayerMode,
      onGrid: frameMeta.onGrid,
      nodeDistance: frameMeta.nodeDistance,
      nodeQuotesMode: frameMeta.nodeQuotesMode,
      labelPosition: frameMeta.labelPosition,
      pinPosition: frameMeta.pinPosition,
      labelDistancePt: frameMeta.labelDistancePt,
      pinDistancePt: frameMeta.pinDistancePt,
      pinEdgeRaw: frameMeta.pinEdgeRaw,
      transformShape: frameMeta.transformShape,
      ...cloneFrameStyleBuckets(frameMeta),
      treeLevel: frameMeta.treeLevel,
      treeLevelDistancePt: frameMeta.treeLevelDistancePt,
      treeSiblingDistancePt: frameMeta.treeSiblingDistancePt,
      treeCurrentLevelSiblingDistancePt: frameMeta.treeCurrentLevelSiblingDistancePt,
      treeGrowDirectionDegrees: frameMeta.treeGrowDirectionDegrees,
      treeGrowReverse: frameMeta.treeGrowReverse,
      treeGrowthParentAnchor: frameMeta.treeGrowthParentAnchor,
      treeParentAnchor: frameMeta.treeParentAnchor,
      treeChildAnchor: frameMeta.treeChildAnchor,
      treeMissing: frameMeta.treeMissing,
      treeEveryChildStyles: frameMeta.treeEveryChildStyles,
      treeEveryChildNodeStyles: frameMeta.treeEveryChildNodeStyles,
      treeLevelStyleTemplateLayers: frameMeta.treeLevelStyleTemplateLayers,
      treeLevelStyleLayers: frameMeta.treeLevelStyleLayers.map((entry) => ({
        level: entry.level,
        layers: [...entry.layers]
      })),
      treeDeferredGrowthFunction: frameMeta.treeDeferredGrowthFunction,
      treeDeferredEdgeFromParentPath: frameMeta.treeDeferredEdgeFromParentPath,
      treeDeferredEdgeFromParentMacro: frameMeta.treeDeferredEdgeFromParentMacro
    });
    const previousTraceCollector = context.macroTraceCollector;
    const statementMacroTrace: MacroExpansionTraceEvent[] = [];
    context.macroTraceCollector = statementMacroTrace;
    try {
      if (intersectionDirectives.nameIntersections) {
        const directiveDiagnostics = applyNameIntersectionsDirective(intersectionDirectives.nameIntersections, context);
        for (const code of directiveDiagnostics) {
          diagnostics.push({
            severity: "warning",
            code,
            message: `Path intersection issue: ${code}`,
            span: intersectionDirectives.nameIntersections.span
          });
        }
      }

      const elements = assignSceneElementLayer(
        evaluatePathStatement(
        statement,
        context,
        resolved.style,
        (featureId, status) => { markFeature(featureUsage, featureId, status); },
        (code, message, from, to) => {
          diagnostics.push({
            severity: code.startsWith("unsupported") ? "warning" : "error",
            code,
            message,
            span: { from, to }
          });
        },
        {
          evaluatePicOperation: (item, placement, segment) =>
            evaluatePicOperationInStatement(item, placement, segment, context, diagnostics, featureUsage, statementMacroAttribution)
        }
        ),
        currentFrame(context).layer
      );
      const evaluatedClipChain = currentFrame(context).clipChain;
      if (clipChainChanged(parent.clipChain, evaluatedClipChain)) {
        parent.clipChain = cloneClipChain(evaluatedClipChain);
      }
      parent.pictureSizeRelevant = currentFrame(context).pictureSizeRelevant;
      for (const name of intersectionDirectives.namedPathNames) {
        registerNamedPath(name, elements, context);
      }
      const originStack = extractStatementMacroOriginStack(statementMacroTrace);
      if (originStack.length > 0) {
        statementMacroAttribution.set(statement, originStack);
      }
      if (
        elements.some(
          (element) => element.kind === "Path" && (element.style.markerStart != null || element.style.markerEnd != null)
        )
      ) {
        markFeature(featureUsage, "arrow_tips", "supported");
      }
      return elements;
    } finally {
      context.macroTraceCollector = previousTraceCollector;
      popFrame(context);
    }
  }

  if (statement.kind === "Scope") {
    markFeature(featureUsage, "scope_statement", "supported");
    const parent = currentFrame(context);
    const scopeSourceRef: StyleSourceRef = {
      sourceId: statement.id,
      sourceSpan: statement.span,
      sourceKind: "scope-statement",
      label: "scope"
    };
    const optionLists = statement.options ? [statement.options] : [];
    const expandedOptionLists = expandOptionListMacros(
      optionLists,
      parent.macroBindings,
      context.macroTraceCollector ?? undefined
    );
    if (optionLists.length > 0) {
      markFeature(featureUsage, "options_structured", "supported");
      if (containsCmOption(expandedOptionLists)) {
        markFeature(featureUsage, "transform_cm", "supported");
      }
    }
    const scopedCustomStyles = cloneCustomStyleRegistry(parent.customStyles);
    const scopedPicDefinitions = clonePicDefinitionRegistry(parent.picDefinitions);
    applyPicDefinitionsFromOptionLists(scopedPicDefinitions, expandedOptionLists, scopeSourceRef);
    const resolved = resolveContextDelta(
      parent.style,
      parent.transform,
      [
        {
          kind: "scope",
          sourceRef: scopeSourceRef,
          rawOptions: expandedOptionLists
        }
      ],
      scopedCustomStyles,
      (raw) => evaluateRawCoordinate(raw, context).world,
      parent.styleChain,
      (raw) => resolveContextColorAliasValue(context, raw)
    );
    let scopeResolved = resolved;
    let frameMeta = resolveFrameMeta(parent, resolved.expandedOptionLists, scopeSourceRef);
    let scopeLayer = parent.layer;
    const backgroundLayerOptionLayers = extractOnBackgroundLayerOptionLayers(resolved.expandedOptionLists, scopeSourceRef);
    const backgroundDiagnostics: StyleDiagnostic[] = [];
    if (backgroundLayerOptionLayers.length > 0) {
      markFeature(featureUsage, "backgrounds_library", "supported");
      markBackgroundLayerUsed(context);
      scopeLayer = BACKGROUND_SCENE_LAYER;
      const everyLayer = makeEveryOnBackgroundLayerOptionLayer(scopeSourceRef);
      scopeResolved = resolveContextDelta(
        resolved.style,
        resolved.transform,
        [everyLayer, ...backgroundLayerOptionLayers].map((layer) => ({
          kind: "scope" as const,
          sourceRef: layer.sourceRef,
          rawOptions: layer.rawOptions
        })),
        scopedCustomStyles,
        (raw) => evaluateRawCoordinate(raw, context).world,
        resolved.chain,
        (raw) => resolveContextColorAliasValue(context, raw)
      );
      frameMeta = resolveFrameMeta(frameMeta, scopeResolved.expandedOptionLists, scopeSourceRef);
      backgroundDiagnostics.push(...scopeResolved.diagnostics);
    }
    pushFrame(context, {
      style: scopeResolved.style,
      styleChain: scopeResolved.chain,
      transform: scopeResolved.transform,
      layer: scopeLayer,
      clipChain: [...parent.clipChain],
      pictureSizeRelevant: parent.pictureSizeRelevant,
      customStyles: scopedCustomStyles,
      picDefinitions: scopedPicDefinitions,
      colorAliases: new Map(parent.colorAliases),
      macroBindings: new Map(parent.macroBindings),
      namePrefix: frameMeta.namePrefix,
      nameSuffix: frameMeta.nameSuffix,
      nodeLayerMode: frameMeta.nodeLayerMode,
      onGrid: frameMeta.onGrid,
      nodeDistance: frameMeta.nodeDistance,
      nodeQuotesMode: frameMeta.nodeQuotesMode,
      labelPosition: frameMeta.labelPosition,
      pinPosition: frameMeta.pinPosition,
      labelDistancePt: frameMeta.labelDistancePt,
      pinDistancePt: frameMeta.pinDistancePt,
      pinEdgeRaw: frameMeta.pinEdgeRaw,
      transformShape: frameMeta.transformShape,
      ...cloneFrameStyleBuckets(frameMeta),
      treeLevel: frameMeta.treeLevel,
      treeLevelDistancePt: frameMeta.treeLevelDistancePt,
      treeSiblingDistancePt: frameMeta.treeSiblingDistancePt,
      treeCurrentLevelSiblingDistancePt: frameMeta.treeCurrentLevelSiblingDistancePt,
      treeGrowDirectionDegrees: frameMeta.treeGrowDirectionDegrees,
      treeGrowReverse: frameMeta.treeGrowReverse,
      treeGrowthParentAnchor: frameMeta.treeGrowthParentAnchor,
      treeParentAnchor: frameMeta.treeParentAnchor,
      treeChildAnchor: frameMeta.treeChildAnchor,
      treeMissing: frameMeta.treeMissing,
      treeEveryChildStyles: frameMeta.treeEveryChildStyles,
      treeEveryChildNodeStyles: frameMeta.treeEveryChildNodeStyles,
      treeLevelStyleTemplateLayers: frameMeta.treeLevelStyleTemplateLayers,
      treeLevelStyleLayers: frameMeta.treeLevelStyleLayers.map((entry) => ({
        level: entry.level,
        layers: [...entry.layers]
      })),
      treeDeferredGrowthFunction: frameMeta.treeDeferredGrowthFunction,
      treeDeferredEdgeFromParentPath: frameMeta.treeDeferredEdgeFromParentPath,
      treeDeferredEdgeFromParentMacro: frameMeta.treeDeferredEdgeFromParentMacro
    });
    pushStyleDiagnostics(diagnostics, resolved.diagnostics, "Scope option issue", statement.span);
    pushStyleDiagnostics(diagnostics, backgroundDiagnostics, "Scope background option issue", statement.span);
    const nested = statement.body.flatMap((entry) =>
      evaluateStatement(entry, context, diagnostics, featureUsage, statementMacroAttribution)
    );
    popFrame(context);
    return nested;
  }

  if (statement.kind === "Foreach") {
    markFeature(featureUsage, "foreach_statement", "supported");
    return [];
  }

  if (statement.kind === "MacroDefinition") {
    applyMacroDefinitionStatement(statement, context);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "MacroAlias") {
    applyMacroAliasStatement(statement, context);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "MacroCommandDefinition") {
    applyMacroCommandDefinitionStatement(statement, context, diagnostics);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "PgfMath") {
    applyPgfMathStatement(statement, context, diagnostics, featureUsage);
    return [];
  }

  if (statement.kind === "TikzSet") {
    applyTikzSetStatement(statement, context, diagnostics, featureUsage);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "TikzStyle") {
    applyTikzStyleStatement(statement, context, diagnostics);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "Pgfkeys") {
    applyPgfkeysStatement(statement, context, diagnostics, featureUsage);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "TikzLibrary") {
    applyTikzLibraryStatement(statement, context, diagnostics);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "Colorlet") {
    applyColorletStatement(statement, context, diagnostics);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (statement.kind === "DefineColor") {
    applyDefineColorStatement(statement, context, diagnostics);
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  if (
    statement.kind === "UnknownStatement"
    && applyStandaloneCommandStatement(statement.raw, context, diagnostics, statement.span, featureUsage)
  ) {
    markFeature(featureUsage, "unknown_statement", "supported");
    return [];
  }

  markFeature(featureUsage, "unknown_statement", "unsupported");
  diagnostics.push({
    severity: "warning",
    code: "unsupported-statement",
    message: describeUnsupportedStatement(statement.raw),
    span: statement.span
  });
  return [];
}

function evaluatePicOperationInStatement(
  item: PicOperationItem,
  placement: WorldPoint,
  segment: PlacementSegment | null,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  featureUsage: FeatureUsage,
  statementMacroAttribution: WeakMap<Statement, MacroOriginFrame[]>
): { behindElements: SceneElement[]; frontElements: SceneElement[] } {
  const parent = currentFrame(context);
  const resolvedCode = resolvePicCode(item, parent.picDefinitions);
  if (resolvedCode.kind === "not-found") {
    markFeature(featureUsage, "pic_operation", "unsupported");
    diagnostics.push({
      severity: "warning",
      code: "unsupported-pic-operation",
      message: resolvedCode.reason,
      span: item.typeSpan ?? item.span
    });
    return { behindElements: [], frontElements: [] };
  }

  if (resolvedCode.unresolvedParameters) {
    markFeature(featureUsage, "pic_operation", "unsupported");
    diagnostics.push({
      severity: "warning",
      code: "unsupported-parameterized-pic",
      message: "Parameterized pic definitions are not supported yet.",
      span: resolvedCode.codeSpan ?? item.typeSpan ?? item.span
    });
    return { behindElements: [], frontElements: [] };
  }

  const recursionKey = makePicRecursionKey(item, resolvedCode);
  if (context.picEvaluationStack.includes(recursionKey) || context.picEvaluationStack.length >= 32) {
    markFeature(featureUsage, "pic_operation", "unsupported");
    diagnostics.push({
      severity: "warning",
      code: "recursive-pic-operation",
      message: `Pic '${item.typeRaw.trim() || "unnamed"}' appears to expand recursively.`,
      span: item.typeSpan ?? item.span
    });
    return { behindElements: [], frontElements: [] };
  }

  const picSourceRef: StyleSourceRef = {
    sourceId: item.id,
    sourceSpan: item.optionsSpan ?? item.span,
    sourceKind: "pic-operation",
    label: "pic"
  };
  const expandedItemOptions = item.options
    ? expandOptionListMacros([item.options], parent.macroBindings, context.macroTraceCollector ?? undefined)
    : [];
  const picStyleLayers: StyleTraceLayerInput[] = [
    ...parent.everyPicStyles.map((layer): StyleTraceLayerInput => ({
      kind: "scope",
      sourceRef: layer.sourceRef,
      rawOptions: expandOptionListMacros([layer.options], parent.macroBindings, context.macroTraceCollector ?? undefined)
    })),
    ...(expandedItemOptions.length > 0
      ? [
          {
            kind: "command" as const,
            sourceRef: picSourceRef,
            rawOptions: expandedItemOptions
          }
        ]
      : [])
  ];

  const noParentShapeTransform = resolvePicPlacementTransform(
    translationMatrix(placement.x, placement.y),
    item,
    segment,
    parent.styleChain
  );
  const picCustomStyles = cloneCustomStyleRegistry(parent.customStyles);
  const picDefinitions = clonePicDefinitionRegistry(parent.picDefinitions);
  applyPicDefinitionsFromOptionLists(
    picDefinitions,
    picStyleLayers.flatMap((layer) => layer.rawOptions),
    picSourceRef
  );
  let resolvedPicStyle = resolveContextDelta(
    parent.style,
    noParentShapeTransform,
    picStyleLayers,
    picCustomStyles,
    (raw) => evaluateRawCoordinate(raw, context).world,
    parent.styleChain,
    (raw) => resolveContextColorAliasValue(context, raw)
  );
  let frameMeta = resolveFrameMeta(parent, resolvedPicStyle.expandedOptionLists, picSourceRef);

  if (frameMeta.transformShape) {
    resolvedPicStyle = resolveContextDelta(
      parent.style,
      resolvePicPlacementTransform(
        worldTransform(parent.transform.a, parent.transform.b, parent.transform.c, parent.transform.d, placement.x, placement.y),
        item,
        segment,
        parent.styleChain
      ),
      picStyleLayers,
      picCustomStyles,
      (raw) => evaluateRawCoordinate(raw, context).world,
      parent.styleChain,
      (raw) => resolveContextColorAliasValue(context, raw)
    );
    frameMeta = resolveFrameMeta(parent, resolvedPicStyle.expandedOptionLists, picSourceRef);
  }
  if (resolvedCode.codeLayer === "background" && resolvedPicStyle.style.fill == null) {
    const inheritedFill = recoverInheritedFillColor(parent.styleChain);
    if (inheritedFill != null) {
      resolvedPicStyle = {
        ...resolvedPicStyle,
        style: {
          ...resolvedPicStyle.style,
          fill: inheritedFill
        }
      };
    }
  }

  pushStyleDiagnostics(diagnostics, resolvedPicStyle.diagnostics, "Pic option issue", item.optionsSpan ?? item.span);
  if (containsCmOption(resolvedPicStyle.expandedOptionLists)) {
    markFeature(featureUsage, "transform_cm", "supported");
  }

  const parsed = parseStatementsFromBodyWithMapping(
    resolvedCode.codeRaw,
    resolvedCode.codeSpan ?? { from: 0, to: resolvedCode.codeRaw.length }
  );
  for (const diagnostic of parsed.parseResult.diagnostics) {
    if (diagnostic.severity !== "error") {
      continue;
    }
    diagnostics.push({
      severity: "warning",
      code: diagnostic.code ?? "pic-code-parse-error",
      message: `Pic code parse issue: ${diagnostic.message}`,
      span: parsed.sourceMapper.mapSpan(diagnostic.span) ?? resolvedCode.codeSpan ?? item.span
    });
  }

  const picFrame = {
    ...parent,
    ...frameMeta,
    style: resolvedPicStyle.style,
    styleChain: resolvedPicStyle.chain,
    transform: resolvedPicStyle.transform,
    clipChain: [...parent.clipChain],
    customStyles: picCustomStyles,
    picDefinitions,
    colorAliases: new Map(parent.colorAliases),
    macroBindings: new Map(parent.macroBindings),
    namePrefix: item.name ? `${frameMeta.namePrefix}${item.name}` : frameMeta.namePrefix,
    nameSuffix: frameMeta.nameSuffix,
    treeLevelStyleLayers: frameMeta.treeLevelStyleLayers.map((entry) => ({
      level: entry.level,
      layers: [...entry.layers]
    }))
  };

  const handleStart = context.editHandles.length;
  const previousCurrentPoint = context.currentPoint;
  const previousPathStartPoint = context.pathStartPoint;
  const elements: SceneElement[] = [];
  const picOrigin = makePicOriginFrame(item, resolvedCode);
  context.picEvaluationStack.push(recursionKey);
  pushFrame(context, picFrame);
  try {
    context.currentPoint = placement;
    context.pathStartPoint = placement;
    for (const statement of parsed.parseResult.figure.body) {
      elements.push(
        ...withDependencySource(context, item.id, () =>
          withPgfMathRuntime(
            { rng: context.mathRandom },
            () => evaluateStatement(statement, context, diagnostics, featureUsage, statementMacroAttribution)
          )
        )
      );
    }
  } finally {
    popFrame(context);
    context.picEvaluationStack.pop();
    context.currentPoint = previousCurrentPoint;
    context.pathStartPoint = previousPathStartPoint;
    context.editHandles.splice(handleStart);
  }

  const stamped = elements.map((element, index) =>
    stampPicElement(element, index, item, picOrigin, parsed.sourceMapper, resolvedCode.codeSpan)
  );
  if (frameMeta.nodeLayerMode === "behind" || resolvedCode.codeLayer === "background") {
    return { behindElements: stamped, frontElements: [] };
  }
  void segment;
  return { behindElements: [], frontElements: stamped };
}

function resolvePicPlacementTransform(
  base: WorldTransform,
  item: PicOperationItem,
  segment: PlacementSegment | null,
  styleChain: readonly StyleChainEntry[]
): WorldTransform {
  if (!segment || !resolvePathAttachedNodeSloped(item.options, styleChain)) {
    return base;
  }

  const fraction = resolveNodePositionFraction(item.options) ?? 0.5;
  const tangent = tangentAtPlacementSegment(segment, fraction);
  if (!Number.isFinite(tangent.x) || !Number.isFinite(tangent.y) || Math.hypot(tangent.x, tangent.y) <= 1e-9) {
    return base;
  }
  return multiplyMatrix(base, rotationMatrix((Math.atan2(tangent.y, tangent.x) * 180) / Math.PI));
}

function recoverInheritedFillColor(styleChain: readonly StyleChainEntry[]): string | null {
  for (let index = styleChain.length - 1; index >= 0; index -= 1) {
    const entry = styleChain[index];
    if (entry?.after.fill != null) {
      return entry.after.fill;
    }
    if (entry?.before.fill != null) {
      return entry.before.fill;
    }
  }
  return null;
}

function makePicRecursionKey(item: PicOperationItem, resolvedCode: ResolvedPicCode & { kind: "found" }): string {
  return [
    item.typeRaw.trim(),
    resolvedCode.sourceRef.sourceId,
    resolvedCode.codeSpan?.from ?? "?",
    resolvedCode.codeSpan?.to ?? "?"
  ].join(":");
}

function makePicOriginFrame(item: PicOperationItem, resolvedCode: ResolvedPicCode & { kind: "found" }): PicOriginFrame {
  return {
    invocationId: item.id,
    invocationSpan: { ...item.span },
    picType: item.typeRaw.trim(),
    codeSpan: resolvedCode.codeSpan ? { ...resolvedCode.codeSpan } : undefined,
    codeSource: resolvedCode.source,
    parameterized: resolvedCode.parameterized
  };
}

function stampPicElement(
  element: SceneElement,
  index: number,
  item: PicOperationItem,
  picOrigin: PicOriginFrame,
  sourceMapper: { mapSpan: (span: { from: number; to: number }) => { from: number; to: number } | null },
  codeSpan: { from: number; to: number } | undefined
): SceneElement {
  const localTargetId = element.origin?.picTemplateLocalTargetId ?? element.identityRef?.sourceId ?? element.sourceRef.sourceId;
  const identitySpan = element.identityRef?.sourceSpan ?? element.sourceRef.sourceSpan;
  const mappedIdentitySpan = sourceMapper.mapSpan(identitySpan) ?? codeSpan ?? item.span;
  const sourceRef = {
    ...element.sourceRef,
    sourceId: item.id,
    sourceSpan: item.span
  };
  const origin = {
    foreachStack: element.origin?.foreachStack ?? [],
    foreachTemplateLocalTargetId: element.origin?.foreachTemplateLocalTargetId,
    picStack: [...(element.origin?.picStack ?? []), picOrigin],
    picTemplateLocalTargetId: localTargetId,
    macroStack: element.origin?.macroStack
  };
  const base = {
    ...element,
    id: `scene-pic:${item.id}:${index}:${element.id}`,
    runtimeId: `scene-pic:${item.id}:${index}:${element.runtimeId ?? element.id}`,
    sourceRef,
    identityRef: {
      sourceId: localTargetId,
      sourceSpan: mappedIdentitySpan,
      sourceKind: "pic-expanded-element"
    },
    origin
  };

  if (base.kind === "Text" && base.textSourceSpan) {
    return {
      ...base,
      textSourceSpan: sourceMapper.mapSpan(base.textSourceSpan) ?? base.textSourceSpan
    };
  }
  return base;
}

function applyPgfMathStatement(
  statement: PgfMathStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  featureUsage: FeatureUsage
): void {
  markFeature(featureUsage, "pgfmath_expression", "supported");
  const frame = currentFrame(context);

  if (statement.commandRaw === "\\pgfmathsetseed") {
    markFeature(featureUsage, "pgfmath_seed_commands", "supported");
    const expressionRaw = statement.argsRaw[0] ?? "";
    const expressionSpan = statement.argsSpan[0] ?? statement.span;
    const expanded = expandMacroBindings(expressionRaw, frame.macroBindings, {
      maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
      trace: context.macroTraceCollector ?? undefined
    });
    if (containsPgfMathRandomToken(expanded)) {
      markFeature(featureUsage, "pgfmath_random_functions", "supported");
    }
    const evaluated = evaluatePgfMathExpression(expanded, { rng: context.mathRandom });
    if (evaluated.ok === false) {
      diagnostics.push({
        severity: "warning",
        code: `invalid-pgfmathsetseed:${evaluated.code}`,
        message: "\\pgfmathsetseed failed: " + evaluated.message,
        span: expressionSpan
      });
      return;
    }
    context.mathRandom.setSeed(Math.trunc(evaluated.quantity.value));
    return;
  }

  if (statement.commandRaw === "\\pgfmathparse") {
    const expressionRaw = statement.argsRaw[0] ?? "";
    const expressionSpan = statement.argsSpan[0] ?? statement.span;
    const expanded = expandMacroBindings(expressionRaw, frame.macroBindings, {
      maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
      trace: context.macroTraceCollector ?? undefined
    });
    if (containsPgfMathRandomToken(expanded)) {
      markFeature(featureUsage, "pgfmath_random_functions", "supported");
    }
    const evaluated = evaluatePgfMathExpression(expanded, { rng: context.mathRandom });
    if (evaluated.ok === false) {
      diagnostics.push({
        severity: "warning",
        code: `invalid-pgfmathparse:${evaluated.code}`,
        message: "\\pgfmathparse failed: " + evaluated.message,
        span: expressionSpan
      });
      return;
    }
    writeContextMacroBinding(context, "\\pgfmathresult", {
      kind: "text",
      value: formatPgfMathNumber(evaluated.quantity.value),
      provenance: []
    });
    return;
  }

  const targetRaw = statement.argsRaw[0] ?? "";
  const targetSpan = statement.argsSpan[0] ?? statement.span;
  const target = normalizeMacroName(targetRaw);
  if (target == null) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-pgfmathsetmacro-target",
      message: "\\pgfmathsetmacro requires a control-sequence macro target.",
      span: targetSpan
    });
    return;
  }

  const expressionRaw = statement.argsRaw[1] ?? "";
  const expressionSpan = statement.argsSpan[1] ?? statement.span;
  const expanded = expandMacroBindings(expressionRaw, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  if (containsPgfMathRandomToken(expanded)) {
    markFeature(featureUsage, "pgfmath_random_functions", "supported");
  }
  const evaluated = evaluatePgfMathExpression(expanded, { rng: context.mathRandom });
  if (evaluated.ok === false) {
    diagnostics.push({
      severity: "warning",
      code: `invalid-pgfmathsetmacro:${evaluated.code}`,
      message: "\\pgfmathsetmacro failed: " + evaluated.message,
      span: expressionSpan
    });
    return;
  }

  writeContextMacroBinding(context, target, {
    kind: "text",
    value: formatPgfMathNumber(evaluated.quantity.value),
    provenance: []
  });
}

function describeUnsupportedStatement(raw: string): string {
  const command = parseLeadingCommandName(raw) ?? parseStandaloneCommandName(raw);
  if (command) {
    return `Unknown or unsupported command \`${command}\`; this editor will ignore the statement. Check for a typo or unsupported TikZ command.`;
  }
  return "Unsupported statement; this editor will ignore it. Check for a typo or unsupported TikZ syntax.";
}

function applyStandaloneCommandStatement(
  raw: string,
  context: ReturnType<typeof createSemanticContext>,
  _diagnostics: Diagnostic[],
  _span: { from: number; to: number },
  _featureUsage: FeatureUsage
): boolean {
  const command = parseStandaloneCommandName(raw);
  if (command) {
    const fontFactor = FONT_SIZE_COMMAND_FACTORS[command];
    if (fontFactor != null) {
      const frame = currentFrame(context);
      frame.style = {
        ...frame.style,
        fontSize: DEFAULT_TEXT_FONT_SIZE * fontFactor
      };
      return true;
    }
  }

  return false;
}

function applyTikzSetStatement(
  statement: TikzSetStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  featureUsage: FeatureUsage
): void {
  applyOptionListsToCurrentFrame([statement.optionList], context, diagnostics, statement.span, statement.commandRaw, statement.id, featureUsage);
}

function applyPgfkeysStatement(
  statement: PgfkeysStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  featureUsage: FeatureUsage
): void {
  const normalized = normalizePgfkeysOptionList(statement.optionList);
  applyOptionListsToCurrentFrame([normalized], context, diagnostics, statement.span, statement.commandRaw, statement.id, featureUsage);
}

function applyTikzStyleStatement(
  statement: TikzStyleStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[]
): void {
  const styleName = statement.styleNameRaw.trim();
  if (styleName.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-tikzstyle-name",
      message: "TikZ style statement is missing a style name.",
      span: statement.styleNameSpan ?? statement.span
    });
    return;
  }

  const frame = currentFrame(context);
  applyCustomStyleDefinition(frame.customStyles, styleName, statement.definitionKind, statement.optionList, {
    sourceId: statement.id,
    sourceSpan: statement.span,
    sourceKind: "legacy-tikzstyle",
    label: styleName
  });

  const legacyBucket = LEGACY_TIKZSTYLE_BUCKET_BY_NAME[styleName];
  if (legacyBucket) {
    const parsedLayer = parseProvenanceStyleLayer(
      {
        kind: "kv",
        key: styleName,
        valueRaw: statement.optionList.raw,
        span: statement.optionList.span,
        keySpan: statement.styleNameSpan ?? statement.span,
        valueSpan: statement.optionList.span,
        raw: `${styleName}=${statement.optionList.raw}`
      },
      {
        sourceId: statement.id,
        sourceSpan: statement.span,
        sourceKind: "legacy-tikzstyle",
        label: styleName
      }
    );
    if (parsedLayer) {
      if (statement.definitionKind === "append") {
        frame[legacyBucket] = [...frame[legacyBucket], parsedLayer];
      } else {
        frame[legacyBucket] = [parsedLayer];
      }
    }
  }
  defineContextSymbol(context, {
    kind: "style",
    name: styleName,
    statementId: statement.id,
    span: statement.span
  });
}

function applyTikzLibraryStatement(
  statement: TikzLibraryStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[]
): void {
  if (statement.libraries.length > 0) {
    for (const library of statement.libraries) {
      const normalized = library.trim();
      if (normalized.length === 0) {
        continue;
      }
      defineContextSymbol(context, {
        kind: "library",
        name: normalized,
        statementId: statement.id,
        span: statement.span
      });
    }
    return;
  }
  diagnostics.push({
    severity: "warning",
    code: "invalid-tikzlibrary",
    message: "\\usetikzlibrary requires at least one library name.",
    span: statement.librariesSpan ?? statement.span
  });
}

function applyColorletStatement(
  statement: ColorletStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[]
): void {
  const name = normalizeColorAliasName(statement.nameRaw);
  if (!name) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-colorlet-name",
      message: "\\colorlet requires a non-empty color name.",
      span: statement.nameSpan ?? statement.span
    });
    return;
  }
  const rawValue = statement.valueRaw.trim();
  if (rawValue.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-colorlet-value",
      message: "\\colorlet requires a non-empty color expression.",
      span: statement.valueSpan ?? statement.span
    });
    return;
  }

  const frame = currentFrame(context);
  const expandedValue = expandMacroBindings(rawValue, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  writeContextColorAlias(context, name, expandedValue, {
    statementId: statement.id,
    span: statement.span
  });

  const optionList = parseStyleValueAsOptionList(expandedValue);
  if (optionList) {
    applyCustomStyleDefinition(frame.customStyles, name, "style", optionList, {
      sourceId: statement.id,
      sourceSpan: statement.span,
      sourceKind: "colorlet",
      label: name
    });
  }
}

function applyDefineColorStatement(
  statement: DefineColorStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[]
): void {
  const name = normalizeColorAliasName(statement.nameRaw);
  if (!name) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-definecolor-name",
      message: "\\definecolor requires a non-empty color name.",
      span: statement.nameSpan ?? statement.span
    });
    return;
  }
  const modelRaw = statement.modelRaw.trim();
  const specificationRaw = statement.specificationRaw.trim();
  if (modelRaw.length === 0 || specificationRaw.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-definecolor-args",
      message: "\\definecolor requires model and specification arguments.",
      span: statement.modelSpan ?? statement.specificationSpan ?? statement.span
    });
    return;
  }

  const frame = currentFrame(context);
  const expandedModel = expandMacroBindings(modelRaw, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const expandedSpecification = expandMacroBindings(specificationRaw, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const resolvedValue = resolveDefineColorModel(expandedModel, expandedSpecification);
  if (!resolvedValue) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-definecolor-model",
      message: `Could not resolve \\definecolor model '${expandedModel}'.`,
      span: statement.modelSpan ?? statement.span
    });
    return;
  }

  writeContextColorAlias(context, name, resolvedValue, {
    statementId: statement.id,
    span: statement.span
  });
  const optionList = parseStyleValueAsOptionList(resolvedValue);
  if (optionList) {
    applyCustomStyleDefinition(frame.customStyles, name, "style", optionList, {
      sourceId: statement.id,
      sourceSpan: statement.span,
      sourceKind: "definecolor",
      label: name
    });
  }
}

function applyOptionListsToCurrentFrame(
  optionLists: OptionListAst[],
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[],
  span: { from: number; to: number },
  sourceLabel: string,
  sourceId = `standalone:${span.from}:${span.to}`,
  featureUsage?: FeatureUsage
): void {
  const frame = currentFrame(context);
  const expandedOptionLists = expandOptionListMacros(optionLists, frame.macroBindings, context.macroTraceCollector ?? undefined);
  const sourceRef: StyleSourceRef = {
    sourceId,
    sourceSpan: span,
    sourceKind: "standalone-command",
    label: sourceLabel
  };
  const resolved = resolveContextDelta(
    frame.style,
    frame.transform,
    [
      {
        kind: "scope",
        sourceRef,
        rawOptions: expandedOptionLists
      }
    ],
    frame.customStyles,
    (raw) => evaluateRawCoordinate(raw, context).world,
    frame.styleChain,
    (raw) => resolveContextColorAliasValue(context, raw)
  );
  frame.style = resolved.style;
  frame.styleChain = resolved.chain;
  frame.transform = resolved.transform;
  applyPicDefinitionsFromOptionLists(frame.picDefinitions, expandedOptionLists, sourceRef);
  if (featureUsage && collectBackgroundOptionEffects(context, resolved.expandedOptionLists, sourceRef)) {
    markFeature(featureUsage, "backgrounds_library", "supported");
  }

  const frameMeta = resolveFrameMeta(frame, resolved.expandedOptionLists, sourceRef);
  frame.namePrefix = frameMeta.namePrefix;
  frame.nameSuffix = frameMeta.nameSuffix;
  frame.nodeLayerMode = frameMeta.nodeLayerMode;
  frame.onGrid = frameMeta.onGrid;
  frame.nodeDistance = frameMeta.nodeDistance;
  frame.nodeQuotesMode = frameMeta.nodeQuotesMode;
  frame.labelPosition = frameMeta.labelPosition;
  frame.pinPosition = frameMeta.pinPosition;
  frame.labelDistancePt = frameMeta.labelDistancePt;
  frame.pinDistancePt = frameMeta.pinDistancePt;
  frame.pinEdgeRaw = frameMeta.pinEdgeRaw;
  frame.transformShape = frameMeta.transformShape;
  assignFrameStyleBuckets(frame, frameMeta);
  frame.treeLevel = frameMeta.treeLevel;
  frame.treeLevelDistancePt = frameMeta.treeLevelDistancePt;
  frame.treeSiblingDistancePt = frameMeta.treeSiblingDistancePt;
  frame.treeCurrentLevelSiblingDistancePt = frameMeta.treeCurrentLevelSiblingDistancePt;
  frame.treeGrowDirectionDegrees = frameMeta.treeGrowDirectionDegrees;
  frame.treeGrowReverse = frameMeta.treeGrowReverse;
  frame.treeGrowthParentAnchor = frameMeta.treeGrowthParentAnchor;
  frame.treeParentAnchor = frameMeta.treeParentAnchor;
  frame.treeChildAnchor = frameMeta.treeChildAnchor;
  frame.treeMissing = frameMeta.treeMissing;
  frame.treeEveryChildStyles = frameMeta.treeEveryChildStyles;
  frame.treeEveryChildNodeStyles = frameMeta.treeEveryChildNodeStyles;
  frame.treeLevelStyleTemplateLayers = frameMeta.treeLevelStyleTemplateLayers;
  frame.treeLevelStyleLayers = frameMeta.treeLevelStyleLayers.map((entry) => ({
    level: entry.level,
    layers: [...entry.layers]
  }));
  frame.treeDeferredGrowthFunction = frameMeta.treeDeferredGrowthFunction;
  frame.treeDeferredEdgeFromParentPath = frameMeta.treeDeferredEdgeFromParentPath;
  frame.treeDeferredEdgeFromParentMacro = frameMeta.treeDeferredEdgeFromParentMacro;

  pushStyleDiagnostics(diagnostics, resolved.diagnostics, `${sourceLabel} option issue`, span);
}

function applyMacroDefinitionStatement(
  statement: MacroDefinitionStatement,
  context: ReturnType<typeof createSemanticContext>
): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }

  writeContextMacroBinding(context, name, {
    kind: "text",
    value: statement.valueRaw,
    provenance: [buildMacroOriginFrame(name, statement.id, statement.span, statement.commandRaw)]
  }, {
    statementId: statement.id,
    span: statement.span
  });
}

function applyMacroAliasStatement(statement: MacroAliasStatement, context: ReturnType<typeof createSemanticContext>): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }

  const frame = currentFrame(context);
  const targetRaw = statement.targetRaw.trim();
  if (targetRaw.length === 0) {
    return;
  }

  const aliasOrigin = buildMacroOriginFrame(name, statement.id, statement.span, statement.commandRaw);
  const binding: MacroBinding = isControlSequenceToken(targetRaw) ? (() => {
    const targetBinding = readContextMacroBinding(context, targetRaw, statement.id);
    if (targetBinding) {
      const cloned = cloneMacroBinding(targetBinding);
      cloned.provenance.push(aliasOrigin);
      return cloned;
    }
    return {
      kind: "text",
      value: targetRaw,
      provenance: [aliasOrigin]
    };
  })() : {
      kind: "text",
      value: expandMacroBindings(targetRaw, frame.macroBindings, {
        maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH
      }),
      provenance: [aliasOrigin]
    };

  writeContextMacroBinding(context, name, binding, {
    statementId: statement.id,
    span: statement.span
  });
}

function applyMacroCommandDefinitionStatement(
  statement: MacroCommandDefinitionStatement,
  context: ReturnType<typeof createSemanticContext>,
  diagnostics: Diagnostic[]
): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }
  if (statement.commandRaw === "\\providecommand" && readContextMacroBinding(context, name, statement.id) != null) {
    return;
  }

  const parameterCount = clampMacroParameterCount(statement.arity, diagnostics, statement);
  const optionalFirstArgDefault = resolveOptionalFirstArgDefault(statement, parameterCount, diagnostics);
  const origin = buildMacroOriginFrame(name, statement.id, statement.span, statement.commandRaw);
  const binding: MacroBinding =
    parameterCount === 0
      ? {
          kind: "text",
          value: statement.bodyRaw,
          provenance: [origin]
        }
      : {
          kind: "callable",
          parameterCount,
          optionalFirstArgDefault,
          body: statement.bodyRaw,
          provenance: [origin]
        };
  writeContextMacroBinding(context, name, binding, {
    statementId: statement.id,
    span: statement.span
  });
}

function clampMacroParameterCount(arity: number, diagnostics: Diagnostic[], statement: MacroCommandDefinitionStatement): number {
  if (arity <= 9) {
    return Math.max(0, arity);
  }

  diagnostics.push({
    severity: "warning",
    code: "unsupported-macro-arity",
    message: `Only up to 9 macro parameters are supported; ${statement.commandRaw} ${statement.nameRaw} will use 9.`,
    span: statement.aritySpan ?? statement.span
  });
  return 9;
}

function cloneMacroBinding(binding: MacroBinding): MacroBinding {
  if (binding.kind === "text") {
    return {
      kind: "text",
      value: binding.value,
      provenance: cloneMacroOriginStack(binding.provenance)
    };
  }

  return {
    kind: "callable",
    parameterCount: binding.parameterCount,
    optionalFirstArgDefault: binding.optionalFirstArgDefault,
    body: binding.body,
    provenance: cloneMacroOriginStack(binding.provenance)
  };
}

function resolveOptionalFirstArgDefault(
  statement: MacroCommandDefinitionStatement,
  parameterCount: number,
  diagnostics: Diagnostic[]
): string | undefined {
  const defaultRaw = statement.optionalDefaultRaw;
  if (defaultRaw == null) {
    return undefined;
  }

  if (parameterCount <= 0) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-macro-default-arg",
      message: `${statement.commandRaw} ${statement.nameRaw} declares a default argument but has no parameters.`,
      span: statement.optionalDefaultSpan ?? statement.span
    });
    return undefined;
  }

  return defaultRaw;
}

function buildMacroOriginFrame(
  macroName: string,
  definitionId: string,
  definitionSpan: { from: number; to: number },
  commandRaw: MacroOriginFrame["commandRaw"]
): MacroOriginFrame {
  return {
    macroName,
    definitionId,
    definitionSpan,
    commandRaw
  };
}

function extractStatementMacroOriginStack(trace: MacroExpansionTraceEvent[]): MacroOriginFrame[] {
  if (trace.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const ordered: MacroOriginFrame[] = [];
  for (const event of trace) {
    for (const origin of event.provenance) {
      const key = `${origin.definitionId}:${origin.macroName}:${origin.commandRaw}:${origin.definitionSpan.from}:${origin.definitionSpan.to}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      ordered.push({
        macroName: origin.macroName,
        definitionId: origin.definitionId,
        definitionSpan: {
          from: origin.definitionSpan.from,
          to: origin.definitionSpan.to
        },
        commandRaw: origin.commandRaw
      });
    }
  }
  return ordered;
}

function clipChainChanged(previous: readonly SceneClipPath[], next: readonly SceneClipPath[]): boolean {
  if (previous.length !== next.length) {
    return true;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return true;
    }
  }
  return false;
}

function cloneClipChain(clipChain: readonly SceneClipPath[]): SceneClipPath[] {
  return clipChain.map((clipPath) => ({
    ...clipPath,
    sourceRef: { ...clipPath.sourceRef },
    commands: clipPath.commands.map((command) => {
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
    })
  }));
}

function cloneMacroOriginStack(stack: MacroOriginFrame[]): MacroOriginFrame[] {
  return stack.map((origin) => ({
    macroName: origin.macroName,
    definitionId: origin.definitionId,
    definitionSpan: {
      from: origin.definitionSpan.from,
      to: origin.definitionSpan.to
    },
    commandRaw: origin.commandRaw
  }));
}

function normalizeMacroName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isControlSequenceToken(trimmed)) {
    return null;
  }
  return trimmed;
}

function parseStandaloneCommandName(raw: string): string | null {
  const stripped = stripOptionalTrailingSemicolon(raw.trim());
  if (!/^\\[A-Za-z@]+$/.test(stripped)) {
    return null;
  }
  return stripped;
}

function parseLeadingCommandName(raw: string): string | null {
  return raw.trim().match(/^(\\[A-Za-z@]+)/)?.[1] ?? null;
}

function normalizePgfkeysOptionList(list: OptionListAst): OptionListAst {
  let inTikzDirectory = false;
  const entries: OptionListAst["entries"] = [];
  for (const entry of list.entries) {
    if (entry.kind === "unknown") {
      const normalizedRaw = entry.raw.trim().toLowerCase();
      if (normalizedRaw === "/tikz/.cd" || normalizedRaw === ".cd") {
        inTikzDirectory = normalizedRaw === "/tikz/.cd" || inTikzDirectory;
      }
      continue;
    }

    if (entry.key === "/tikz/.cd" || entry.key === ".cd") {
      inTikzDirectory = entry.key === "/tikz/.cd" || inTikzDirectory;
      continue;
    }

    let normalizedKey: string | null = null;
    if (entry.key.startsWith("/tikz/")) {
      normalizedKey = entry.key.slice("/tikz/".length);
    } else if (inTikzDirectory && !entry.key.startsWith("/")) {
      normalizedKey = entry.key;
    }

    if (!normalizedKey || normalizedKey.length === 0) {
      continue;
    }

    if (entry.kind === "flag") {
      entries.push({ ...entry, key: normalizedKey });
      continue;
    }
    entries.push({ ...entry, key: normalizedKey });
  }

  return {
    ...list,
    entries
  };
}

function stripOptionalTrailingSemicolon(raw: string): string {
  return raw.endsWith(";") ? raw.slice(0, -1).trim() : raw;
}

function normalizeColorAliasName(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function computeBounds(elements: SceneElement[]): WorldBounds | undefined {
  const points: WorldPoint[] = [];

  for (const element of elements) {
    if (element.kind === "Path") {
      points.push(...pathBoundsPoints(element.commands).map((point) => applyOptionalTransform(point, element.transform)));
      continue;
    }

    if (element.kind === "Circle") {
      const min = worldPoint(pt(element.center.x - element.radius), pt(element.center.y - element.radius));
      const max = worldPoint(pt(element.center.x + element.radius), pt(element.center.y + element.radius));
      pushRectCorners(points, min, max, element.transform);
      continue;
    }

    if (element.kind === "Ellipse") {
      const rotation = ((element.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const extentX = Math.sqrt(element.rx * element.rx * cos * cos + element.ry * element.ry * sin * sin);
      const extentY = Math.sqrt(element.rx * element.rx * sin * sin + element.ry * element.ry * cos * cos);
      const min = worldPoint(pt(element.center.x - extentX), pt(element.center.y - extentY));
      const max = worldPoint(pt(element.center.x + extentX), pt(element.center.y + extentY));
      pushRectCorners(points, min, max, element.transform);
      continue;
    }

    const lineCount = Math.max(1, element.text.split("\n").length);
    const textHeight = element.textBlockHeight ?? lineCount * element.style.fontSize * 1.15;
    const textWidth = element.textBlockWidth ?? estimateTextWidth(element.text, element.style.fontSize);
    const halfWidth = textWidth / 2;
    const halfHeight = textHeight / 2;
    const rotation = (element.rotation ?? 0) * (Math.PI / 180);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const corners = [
      worldPoint(pt(-halfWidth), pt(-halfHeight)),
      worldPoint(pt(halfWidth), pt(-halfHeight)),
      worldPoint(pt(halfWidth), pt(halfHeight)),
      worldPoint(pt(-halfWidth), pt(halfHeight))
    ];
    for (const corner of corners) {
      const rotatedCorner = worldPoint(
        pt(element.position.x + corner.x * cos - corner.y * sin),
        pt(element.position.y + corner.x * sin + corner.y * cos)
      );
      points.push(applyOptionalTransform(rotatedCorner, element.transform));
    }
  }

  if (points.length === 0) {
    return undefined;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function applyOptionalTransform(
  point: WorldPoint,
  transform: SceneElement["transform"]
): WorldPoint {
  if (!transform) {
    return point;
  }
  const transformed = applyMatrix(transform, point);
  return worldPoint(pt(transformed.x), pt(transformed.y));
}

function pushRectCorners(
  points: WorldPoint[],
  min: WorldPoint,
  max: WorldPoint,
  transform: SceneElement["transform"]
): void {
  const corners = [
    worldPoint(pt(min.x), pt(min.y)),
    worldPoint(pt(max.x), pt(min.y)),
    worldPoint(pt(max.x), pt(max.y)),
    worldPoint(pt(min.x), pt(max.y))
  ];
  for (const corner of corners) {
    points.push(applyOptionalTransform(corner, transform));
  }
}

function estimateTextWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return maxChars * fontSize * 0.7;
}

function pathBoundsPoints(commands: ScenePathCommand[]): WorldPoint[] {
  const points: WorldPoint[] = [];
  let current: WorldPoint | null = null;
  let subpathStart: WorldPoint | null = null;

  for (const command of commands) {
    if (command.kind === "M") {
      current = command.to;
      subpathStart = command.to;
      points.push(command.to);
      continue;
    }

    if (command.kind === "L") {
      current = command.to;
      points.push(command.to);
      continue;
    }

    if (command.kind === "C") {
      points.push(command.to);
      if (current) {
        points.push(...cubicExtremaPoints(current, command.c1, command.c2, command.to));
      }
      current = command.to;
      continue;
    }

    if (command.kind === "A") {
      points.push(command.to);
      if (current) {
        points.push(...arcExtremaPoints(current, command));
      }
      current = command.to;
      continue;
    }

    if (command.kind === "Z" && subpathStart) {
      points.push(subpathStart);
      current = subpathStart;
    }
  }

  return points;
}

function cubicExtremaPoints(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint): WorldPoint[] {
  const roots = new Set<number>();
  for (const axis of ["x", "y"] as const) {
    for (const root of cubicExtremaRoots(p0[axis], p1[axis], p2[axis], p3[axis])) {
      roots.add(root);
    }
  }
  return [...roots].map((t) => cubicPoint(p0, p1, p2, p3, t));
}

function cubicExtremaRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = -p0 + p1;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) {
      return [];
    }
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const sqrt = Math.sqrt(discriminant);
  return [(-b + sqrt) / (2 * a), (-b - sqrt) / (2 * a)].filter((t) => t > 0 && t < 1);
}

function cubicPoint(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, t: number): WorldPoint {
  const u = 1 - t;
  return worldPoint(
    pt(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x),
    pt(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y)
  );
}

type ArcUnitVector = Readonly<{ x: number; y: number }>;
type ArcBoundsCommand = Extract<ScenePathCommand, { kind: "A" }>;

function arcUnitVector(x: number, y: number): ArcUnitVector {
  return { x, y };
}

function arcExtremaPoints(
  from: WorldPoint,
  arc: ArcBoundsCommand
): WorldPoint[] {
  const solution = solveArcCenter(from, arc);
  if (!solution) {
    return [];
  }

  const { center, rx, ry, phi, theta1, deltaTheta } = solution;
  const theta2 = theta1 + deltaTheta;
  const candidates = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const points: WorldPoint[] = [];

  for (const candidate of candidates) {
    if (!angleOnArc(candidate, theta1, theta2, arc.sweep)) {
      continue;
    }
    points.push(pointOnEllipse(center, rx, ry, phi, candidate));
  }

  return points;
}

function solveArcCenter(
  from: WorldPoint,
  arc: ArcBoundsCommand
): {
  center: WorldPoint;
  rx: number;
  ry: number;
  phi: number;
  theta1: number;
  deltaTheta: number;
} | null {
  let rx = Math.abs(arc.rx);
  let ry = Math.abs(arc.ry);
  if (rx <= 1e-9 || ry <= 1e-9) {
    return null;
  }

  const phi = (arc.xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (from.x - arc.to.x) / 2;
  const dy2 = (from.y - arc.to.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const denominator = rx2 * y1p2 + ry2 * x1p2;
  if (denominator <= 1e-12) {
    return null;
  }

  const sign = arc.largeArc === arc.sweep ? -1 : 1;
  const factorBase = Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / denominator);
  const factor = sign * Math.sqrt(factorBase);
  const cxp = factor * ((rx * y1p) / ry);
  const cyp = factor * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + arc.to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + arc.to.y) / 2;

  const startUnit = arcUnitVector((x1p - cxp) / rx, (y1p - cyp) / ry);
  const endUnit = arcUnitVector((-x1p - cxp) / rx, (-y1p - cyp) / ry);
  const theta1 = angleFromUnit(startUnit);
  let deltaTheta = angleBetweenUnits(startUnit, endUnit);

  if (!arc.sweep && deltaTheta > 0) {
    deltaTheta -= 2 * Math.PI;
  } else if (arc.sweep && deltaTheta < 0) {
    deltaTheta += 2 * Math.PI;
  }

  return {
    center: worldPoint(pt(cx), pt(cy)),
    rx,
    ry,
    phi,
    theta1,
    deltaTheta
  };
}

function pointOnEllipse(
  center: WorldPoint,
  rx: number,
  ry: number,
  phi: number,
  theta: number
): WorldPoint {
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return worldPoint(
    pt(center.x + rx * cosTheta * cosPhi - ry * sinTheta * sinPhi),
    pt(center.y + rx * cosTheta * sinPhi + ry * sinTheta * cosPhi)
  );
}

function angleFromUnit(unit: ArcUnitVector): number {
  return Math.atan2(unit.y, unit.x);
}

function angleBetweenUnits(from: ArcUnitVector, to: ArcUnitVector): number {
  const cross = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y;
  return Math.atan2(cross, dot);
}

function normalizeAngle(angle: number): number {
  const twoPi = 2 * Math.PI;
  let normalized = angle % twoPi;
  if (normalized < 0) {
    normalized += twoPi;
  }
  return normalized;
}

function angleOnArc(angle: number, start: number, end: number, sweep: boolean): boolean {
  const epsilon = 1e-9;
  const a = normalizeAngle(angle);
  const s = normalizeAngle(start);
  let e = normalizeAngle(end);

  if (sweep) {
    if (e < s) {
      e += 2 * Math.PI;
    }
    const aa = a < s ? a + 2 * Math.PI : a;
    return aa >= s - epsilon && aa <= e + epsilon;
  }

  if (e > s) {
    e -= 2 * Math.PI;
  }
  const aa = a > s ? a - 2 * Math.PI : a;
  return aa <= s + epsilon && aa >= e - epsilon;
}

function containsCmOption(optionLists: OptionListAst[]): boolean {
  for (const list of optionLists) {
    for (const entry of list.entries) {
      if (!isCmOptionEntry(entry)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function isCmOptionEntry(entry: OptionEntry): boolean {
  return entry.kind === "kv" && (entry.key === "cm" || entry.key === "/tikz/cm");
}

export function initializeFeatureUsage(): FeatureUsage {
  const usage: FeatureUsage = {};
  for (const featureId of FEATURE_IDS) {
    usage[featureId] = "unused";
  }
  return usage;
}

function markFeature(featureUsage: FeatureUsage, featureId: FeatureId, status: "supported" | "unsupported"): void {
  if (!(featureId in featureUsage)) {
    return;
  }

  const current = featureUsage[featureId];
  if (status === "unsupported") {
    featureUsage[featureId] = "used-unsupported";
    return;
  }

  if (current !== "used-unsupported") {
    featureUsage[featureId] = "used-supported";
  }
}

function markForeachFeaturesFromFigure(figure: TikzFigure, featureUsage: FeatureUsage): void {
  const walkPathItems = (items: PathItem[]): void => {
    for (const item of items) {
      if (item.kind === "PathForeach") {
        markFeature(featureUsage, "foreach_path_operation", "supported");
      } else if (item.kind === "Node" && item.foreachClauses && item.foreachClauses.length > 0) {
        markFeature(featureUsage, "foreach_node_operation", "supported");
      } else if (item.kind === "ChildOperation") {
        if (item.foreachClauses && item.foreachClauses.length > 0) {
          markFeature(featureUsage, "foreach_path_operation", "supported");
        }
        walkPathItems(item.body);
      }
    }
  };

  const walkStatement = (statement: Statement): void => {
    if (statement.kind === "Foreach") {
      markFeature(featureUsage, "foreach_statement", "supported");
      markPgfMathFeaturesFromOptionList(statement.options, featureUsage);
      if (containsPgfMathRandomToken(statement.headerRaw ?? "")) {
        markFeature(featureUsage, "pgfmath_random_functions", "supported");
      }
      if (statement.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "evaluate")) {
        markFeature(featureUsage, "pgfmath_expression", "supported");
      }
      return;
    }

    if (statement.kind === "Scope") {
      for (const nested of statement.body) {
        walkStatement(nested);
      }
      return;
    }

    if (statement.kind === "PgfMath") {
      markFeature(featureUsage, "pgfmath_expression", "supported");
      if (statement.commandRaw === "\\pgfmathsetseed") {
        markFeature(featureUsage, "pgfmath_seed_commands", "supported");
      }
      if (statement.argsRaw.some((arg) => containsPgfMathRandomToken(arg))) {
        markFeature(featureUsage, "pgfmath_random_functions", "supported");
      }
      return;
    }

    if (statement.kind !== "Path") {
      return;
    }

    walkPathItems(statement.items);
  };

  for (const statement of figure.body) {
    walkStatement(statement);
  }
}

function markPgfMathFeaturesFromOptionList(optionList: OptionListAst | undefined, featureUsage: FeatureUsage): void {
  if (!optionList) {
    return;
  }

  for (const entry of optionList.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key !== "evaluate") {
      continue;
    }
    markFeature(featureUsage, "pgfmath_expression", "supported");
    if (containsPgfMathRandomToken(entry.valueRaw)) {
      markFeature(featureUsage, "pgfmath_random_functions", "supported");
    }
  }
}

function containsPgfMathRandomToken(input: string): boolean {
  const normalized = input.toLowerCase();
  return /\b(?:rnd|rand|random)\b/.test(normalized);
}

type FrameStyleBuckets = {
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
};

const FRAME_STYLE_BUCKET_KEYS = [
  "everyNodeStyles",
  "everyTextNodePartStyles",
  "everyFitStyles",
  "everyPicStyles",
  "everyRectangleNodeStyles",
  "everyCircleNodeStyles",
  "everyDiamondNodeStyles",
  "everyTrapeziumNodeStyles",
  "everyIsoscelesTriangleNodeStyles",
  "everyKiteNodeStyles",
  "everyDartNodeStyles",
  "everyCircularSectorNodeStyles",
  "everyCylinderNodeStyles",
  "everyCloudNodeStyles",
  "everyStarburstNodeStyles",
  "everySignalNodeStyles",
  "everyTapeNodeStyles",
  "everyRectangleCalloutNodeStyles",
  "everyEllipseCalloutNodeStyles",
  "everyCloudCalloutNodeStyles",
  "everySingleArrowNodeStyles",
  "everyDoubleArrowNodeStyles"
] as const satisfies readonly (keyof FrameStyleBuckets)[];

const FRAME_STYLE_BUCKET_BY_STYLE_KEY: Record<string, keyof FrameStyleBuckets> = {
  "every node/.style": "everyNodeStyles",
  "every text node part/.style": "everyTextNodePartStyles",
  "every fit/.style": "everyFitStyles",
  "every pic/.style": "everyPicStyles",
  "every rectangle node/.style": "everyRectangleNodeStyles",
  "every circle node/.style": "everyCircleNodeStyles",
  "every diamond node/.style": "everyDiamondNodeStyles",
  "every trapezium node/.style": "everyTrapeziumNodeStyles",
  "every isosceles triangle node/.style": "everyIsoscelesTriangleNodeStyles",
  "every kite node/.style": "everyKiteNodeStyles",
  "every dart node/.style": "everyDartNodeStyles",
  "every circular sector node/.style": "everyCircularSectorNodeStyles",
  "every cylinder node/.style": "everyCylinderNodeStyles",
  "every cloud node/.style": "everyCloudNodeStyles",
  "every starburst node/.style": "everyStarburstNodeStyles",
  "every signal node/.style": "everySignalNodeStyles",
  "every tape node/.style": "everyTapeNodeStyles",
  "every rectangle callout node/.style": "everyRectangleCalloutNodeStyles",
  "every ellipse callout node/.style": "everyEllipseCalloutNodeStyles",
  "every cloud callout node/.style": "everyCloudCalloutNodeStyles",
  "every single arrow node/.style": "everySingleArrowNodeStyles",
  "every double arrow node/.style": "everyDoubleArrowNodeStyles"
};

const FRAME_STYLE_BUCKET_BY_APPEND_KEY: Record<string, keyof FrameStyleBuckets> = {
  "every node/.append style": "everyNodeStyles",
  "every text node part/.append style": "everyTextNodePartStyles",
  "every fit/.append style": "everyFitStyles",
  "every pic/.append style": "everyPicStyles",
  "every rectangle node/.append style": "everyRectangleNodeStyles",
  "every circle node/.append style": "everyCircleNodeStyles",
  "every diamond node/.append style": "everyDiamondNodeStyles",
  "every trapezium node/.append style": "everyTrapeziumNodeStyles",
  "every isosceles triangle node/.append style": "everyIsoscelesTriangleNodeStyles",
  "every kite node/.append style": "everyKiteNodeStyles",
  "every dart node/.append style": "everyDartNodeStyles",
  "every circular sector node/.append style": "everyCircularSectorNodeStyles",
  "every cylinder node/.append style": "everyCylinderNodeStyles",
  "every cloud node/.append style": "everyCloudNodeStyles",
  "every starburst node/.append style": "everyStarburstNodeStyles",
  "every signal node/.append style": "everySignalNodeStyles",
  "every tape node/.append style": "everyTapeNodeStyles",
  "every rectangle callout node/.append style": "everyRectangleCalloutNodeStyles",
  "every ellipse callout node/.append style": "everyEllipseCalloutNodeStyles",
  "every cloud callout node/.append style": "everyCloudCalloutNodeStyles",
  "every single arrow node/.append style": "everySingleArrowNodeStyles",
  "every double arrow node/.append style": "everyDoubleArrowNodeStyles"
};

const LEGACY_TIKZSTYLE_BUCKET_BY_NAME: Record<string, keyof FrameStyleBuckets> = {
  "every node": "everyNodeStyles",
  "every text node part": "everyTextNodePartStyles",
  "every fit": "everyFitStyles",
  "every pic": "everyPicStyles",
  "every rectangle node": "everyRectangleNodeStyles",
  "every circle node": "everyCircleNodeStyles",
  "every diamond node": "everyDiamondNodeStyles",
  "every trapezium node": "everyTrapeziumNodeStyles",
  "every isosceles triangle node": "everyIsoscelesTriangleNodeStyles",
  "every kite node": "everyKiteNodeStyles",
  "every dart node": "everyDartNodeStyles",
  "every circular sector node": "everyCircularSectorNodeStyles",
  "every cylinder node": "everyCylinderNodeStyles",
  "every cloud node": "everyCloudNodeStyles",
  "every starburst node": "everyStarburstNodeStyles",
  "every signal node": "everySignalNodeStyles",
  "every tape node": "everyTapeNodeStyles",
  "every rectangle callout node": "everyRectangleCalloutNodeStyles",
  "every ellipse callout node": "everyEllipseCalloutNodeStyles",
  "every cloud callout node": "everyCloudCalloutNodeStyles",
  "every single arrow node": "everySingleArrowNodeStyles",
  "every double arrow node": "everyDoubleArrowNodeStyles"
};

const INHERITED_NODE_LAYOUT_KEYS = new Set([
  "inner sep",
  "inner xsep",
  "inner ysep",
  "outer sep",
  "outer xsep",
  "outer ysep",
  "minimum width",
  "minimum height",
  "minimum size"
]);

type TreeMetaBuckets = {
  treeEveryChildStyles: ProvenanceOptionList[];
  treeEveryChildNodeStyles: ProvenanceOptionList[];
  treeLevelStyleTemplateLayers: ProvenanceOptionList[];
  treeLevelStyleLayers: Array<{ level: number; layers: ProvenanceOptionList[] }>;
};

const TREE_STYLE_BUCKET_BY_STYLE_KEY: Record<string, keyof Omit<TreeMetaBuckets, "treeLevelStyleLayers">> = {
  "every child/.style": "treeEveryChildStyles",
  "every child node/.style": "treeEveryChildNodeStyles",
  "level/.style": "treeLevelStyleTemplateLayers"
};

const TREE_STYLE_BUCKET_BY_APPEND_KEY: Record<string, keyof Omit<TreeMetaBuckets, "treeLevelStyleLayers">> = {
  "every child/.append style": "treeEveryChildStyles",
  "every child node/.append style": "treeEveryChildNodeStyles",
  "level/.append style": "treeLevelStyleTemplateLayers"
};

function cloneFrameStyleBuckets(base: FrameStyleBuckets): FrameStyleBuckets {
  const buckets = {} as FrameStyleBuckets;
  for (const key of FRAME_STYLE_BUCKET_KEYS) {
    buckets[key] = [...base[key]];
  }
  return buckets;
}

function assignFrameStyleBuckets(target: FrameStyleBuckets, source: FrameStyleBuckets): void {
  for (const key of FRAME_STYLE_BUCKET_KEYS) {
    target[key] = source[key];
  }
}

export function resolveFrameMeta(
  base: {
    namePrefix: string;
    nameSuffix: string;
    nodeLayerMode: "front" | "behind";
    onGrid: boolean;
    nodeDistance: NodeDistanceSpec;
    nodeQuotesMode: NodeQuotesMode;
    labelPosition: string;
    pinPosition: string;
    labelDistancePt: number;
    pinDistancePt: number;
    pinEdgeRaw: string | null;
    transformShape: boolean;
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
    treeDeferredGrowthFunction: boolean;
    treeDeferredEdgeFromParentPath: boolean;
    treeDeferredEdgeFromParentMacro: boolean;
  } & FrameStyleBuckets &
    TreeMetaBuckets,
  optionLists: OptionListAst[],
  sourceRef: StyleSourceRef
): {
  namePrefix: string;
  nameSuffix: string;
  nodeLayerMode: "front" | "behind";
  onGrid: boolean;
  nodeDistance: NodeDistanceSpec;
  nodeQuotesMode: NodeQuotesMode;
  labelPosition: string;
  pinPosition: string;
  labelDistancePt: number;
  pinDistancePt: number;
  pinEdgeRaw: string | null;
  transformShape: boolean;
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
  treeDeferredGrowthFunction: boolean;
  treeDeferredEdgeFromParentPath: boolean;
  treeDeferredEdgeFromParentMacro: boolean;
} & FrameStyleBuckets &
  TreeMetaBuckets {
  let namePrefix = base.namePrefix;
  let nameSuffix = base.nameSuffix;
  let nodeLayerMode = base.nodeLayerMode;
  let onGrid = base.onGrid;
  let nodeDistance = base.nodeDistance;
  let nodeQuotesMode = base.nodeQuotesMode;
  let labelPosition = base.labelPosition;
  let pinPosition = base.pinPosition;
  let labelDistancePt = base.labelDistancePt;
  let pinDistancePt = base.pinDistancePt;
  let pinEdgeRaw = base.pinEdgeRaw;
  let transformShape = base.transformShape;
  let treeLevel = base.treeLevel;
  let treeLevelDistancePt = base.treeLevelDistancePt;
  let treeSiblingDistancePt = base.treeSiblingDistancePt;
  let treeCurrentLevelSiblingDistancePt = base.treeCurrentLevelSiblingDistancePt;
  let treeGrowDirectionDegrees = base.treeGrowDirectionDegrees;
  let treeGrowReverse = base.treeGrowReverse;
  let treeGrowthParentAnchor = base.treeGrowthParentAnchor;
  let treeParentAnchor = base.treeParentAnchor;
  let treeChildAnchor = base.treeChildAnchor;
  let treeMissing = base.treeMissing;
  let treeDeferredGrowthFunction = base.treeDeferredGrowthFunction;
  let treeDeferredEdgeFromParentPath = base.treeDeferredEdgeFromParentPath;
  let treeDeferredEdgeFromParentMacro = base.treeDeferredEdgeFromParentMacro;

  const styleBuckets = cloneFrameStyleBuckets(base);
  const treeBuckets: TreeMetaBuckets = {
    treeEveryChildStyles: [...base.treeEveryChildStyles],
    treeEveryChildNodeStyles: [...base.treeEveryChildNodeStyles],
    treeLevelStyleTemplateLayers: [...base.treeLevelStyleTemplateLayers],
    treeLevelStyleLayers: base.treeLevelStyleLayers.map((entry) => ({
      level: entry.level,
      layers: [...entry.layers]
    }))
  };

  for (const list of optionLists) {
    for (const entry of list.entries) {
      if (entry.kind === "flag") {
        if (entry.key === "behind path") {
          nodeLayerMode = "behind";
        } else if (entry.key === "in front of path") {
          nodeLayerMode = "front";
        } else if (entry.key === "on grid") {
          onGrid = true;
        } else if (entry.key === "quotes mean pin") {
          nodeQuotesMode = "pin";
        } else if (entry.key === "quotes mean label") {
          nodeQuotesMode = "label";
        } else if (entry.key === "transform shape") {
          transformShape = true;
        } else if (entry.key === "missing") {
          treeMissing = true;
        } else if (entry.key === "grow'") {
          treeGrowReverse = true;
          treeCurrentLevelSiblingDistancePt = 0;
        } else if (entry.key === "growth function") {
          treeDeferredGrowthFunction = true;
        } else if (entry.key === "edge from parent path") {
          treeDeferredEdgeFromParentPath = true;
        } else if (entry.key === "edge from parent macro") {
          treeDeferredEdgeFromParentMacro = true;
        }
        continue;
      }

      if (entry.kind !== "kv") {
        continue;
      }

      if (entry.key === "name prefix") {
        namePrefix = stripWrappingBraces(entry.valueRaw);
        continue;
      }
      if (entry.key === "name suffix") {
        nameSuffix = stripWrappingBraces(entry.valueRaw);
        continue;
      }

      if (entry.key === "behind path") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          nodeLayerMode = parsed ? "behind" : "front";
        }
        continue;
      }

      if (entry.key === "in front of path") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          nodeLayerMode = parsed ? "front" : "behind";
        }
        continue;
      }

      if (entry.key === "on grid") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          onGrid = parsed;
        }
        continue;
      }

      if (entry.key === "node distance") {
        const parsed = parseNodeDistance(entry.valueRaw);
        if (parsed) {
          nodeDistance = parsed;
        }
        continue;
      }

      if (entry.key === "label position") {
        const normalized = normalizeLabelPinPosition(entry.valueRaw);
        if (normalized.length > 0) {
          labelPosition = normalized;
        }
        continue;
      }

      if (entry.key === "pin position") {
        const normalized = normalizeLabelPinPosition(entry.valueRaw);
        if (normalized.length > 0) {
          pinPosition = normalized;
        }
        continue;
      }

      if (entry.key === "label distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          labelDistancePt = parsed;
        }
        continue;
      }

      if (entry.key === "pin distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          pinDistancePt = parsed;
        }
        continue;
      }

      if (entry.key === "pin edge") {
        pinEdgeRaw = entry.valueRaw;
        continue;
      }

      if (entry.key === "quotes mean pin") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed == null || parsed) {
          nodeQuotesMode = "pin";
        } else {
          nodeQuotesMode = "label";
        }
        continue;
      }

      if (entry.key === "quotes mean label") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed == null || parsed) {
          nodeQuotesMode = "label";
        } else {
          nodeQuotesMode = "pin";
        }
        continue;
      }

      if (entry.key === "transform shape") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          transformShape = parsed;
        }
        continue;
      }

      if (entry.key === "nodes") {
        const parsedLayer = parseProvenanceStyleLayer(entry, sourceRef);
        if (parsedLayer) {
          styleBuckets.everyNodeStyles = [...styleBuckets.everyNodeStyles, parsedLayer];
        }
        continue;
      }

      if (INHERITED_NODE_LAYOUT_KEYS.has(entry.key)) {
        styleBuckets.everyNodeStyles = [
          ...styleBuckets.everyNodeStyles,
          parseProvenanceSingleOptionLayer(entry, sourceRef)
        ];
        continue;
      }

      if (entry.key === "level distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          treeLevelDistancePt = parsed;
        }
        continue;
      }

      if (entry.key === "sibling distance") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null && Number.isFinite(parsed)) {
          treeSiblingDistancePt = parsed;
          treeCurrentLevelSiblingDistancePt = null;
        }
        continue;
      }

      if (entry.key === "grow") {
        const parsed = parseTreeGrowDirection(entry.valueRaw);
        if (parsed != null) {
          treeGrowDirectionDegrees = parsed;
        }
        treeCurrentLevelSiblingDistancePt = 0;
        continue;
      }

      if (entry.key === "grow'") {
        const parsed = parseTreeGrowDirection(entry.valueRaw);
        if (parsed != null) {
          treeGrowDirectionDegrees = parsed;
        }
        treeGrowReverse = true;
        treeCurrentLevelSiblingDistancePt = 0;
        continue;
      }

      if (entry.key === "growth parent anchor") {
        const normalized = normalizeTreeAnchor(entry.valueRaw);
        if (normalized.length > 0) {
          treeGrowthParentAnchor = normalized;
        }
        continue;
      }

      if (entry.key === "parent anchor") {
        const normalized = normalizeTreeAnchor(entry.valueRaw);
        if (normalized.length > 0) {
          treeParentAnchor = normalized;
        }
        continue;
      }

      if (entry.key === "child anchor") {
        const normalized = normalizeTreeAnchor(entry.valueRaw);
        if (normalized.length > 0) {
          treeChildAnchor = normalized;
        }
        continue;
      }

      if (entry.key === "missing") {
        const parsed = parseBoolish(entry.valueRaw);
        if (parsed != null) {
          treeMissing = parsed;
        }
        continue;
      }

      if (entry.key === "level") {
        const parsed = parseTreeLevel(entry.valueRaw);
        if (parsed != null) {
          treeLevel = parsed;
        }
        continue;
      }

      if (entry.key === "growth function") {
        const parsed = parseBoolish(entry.valueRaw);
        treeDeferredGrowthFunction = parsed ?? true;
        continue;
      }

      if (entry.key === "edge from parent path") {
        const parsed = parseBoolish(entry.valueRaw);
        treeDeferredEdgeFromParentPath = parsed ?? true;
        continue;
      }

      if (entry.key === "edge from parent macro") {
        const parsed = parseBoolish(entry.valueRaw);
        treeDeferredEdgeFromParentMacro = parsed ?? true;
        continue;
      }

      const replaceBucket = FRAME_STYLE_BUCKET_BY_STYLE_KEY[entry.key];
      if (replaceBucket) {
        const parsedLayer = parseProvenanceStyleLayer(entry, sourceRef);
        if (parsedLayer) {
          styleBuckets[replaceBucket] = [parsedLayer];
        }
        continue;
      }

      const treeReplaceBucket = TREE_STYLE_BUCKET_BY_STYLE_KEY[entry.key];
      if (treeReplaceBucket) {
        const parsedLayer = parseProvenanceStyleLayer(entry, sourceRef);
        if (parsedLayer) {
          treeBuckets[treeReplaceBucket] = [parsedLayer];
        }
        continue;
      }

      const parsedLevelStyle = parseTreeLevelStyleKey(entry.key);
      if (parsedLevelStyle) {
        const parsedLayer = parseProvenanceStyleLayer(entry, sourceRef);
        if (parsedLayer) {
          treeBuckets.treeLevelStyleLayers = updateTreeLevelStyleLayers(
            treeBuckets.treeLevelStyleLayers,
            parsedLevelStyle.level,
            parsedLayer,
            parsedLevelStyle.append
          );
        }
        continue;
      }

      const appendBucket = FRAME_STYLE_BUCKET_BY_APPEND_KEY[entry.key];
      if (appendBucket) {
        const parsedLayer = parseProvenanceStyleLayer(entry, sourceRef);
        if (parsedLayer) {
          styleBuckets[appendBucket] = [...styleBuckets[appendBucket], parsedLayer];
        }
        continue;
      }

      const treeAppendBucket = TREE_STYLE_BUCKET_BY_APPEND_KEY[entry.key];
      if (treeAppendBucket) {
        const parsedLayer = parseProvenanceStyleLayer(entry, sourceRef);
        if (parsedLayer) {
          treeBuckets[treeAppendBucket] = [...treeBuckets[treeAppendBucket], parsedLayer];
        }
      }
    }
  }

  return {
    namePrefix,
    nameSuffix,
    nodeLayerMode,
    onGrid,
    nodeDistance,
    nodeQuotesMode,
    labelPosition,
    pinPosition,
    labelDistancePt,
    pinDistancePt,
    pinEdgeRaw,
    transformShape,
    treeLevel,
    treeLevelDistancePt,
    treeSiblingDistancePt,
    treeCurrentLevelSiblingDistancePt,
    treeGrowDirectionDegrees,
    treeGrowReverse,
    treeGrowthParentAnchor,
    treeParentAnchor,
    treeChildAnchor,
    treeMissing,
    treeDeferredGrowthFunction,
    treeDeferredEdgeFromParentPath,
    treeDeferredEdgeFromParentMacro,
    ...styleBuckets,
    ...treeBuckets
  };
}

function parseTreeGrowDirection(raw: string): number | null {
  const normalized = stripWrappingBraces(raw).trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  const canonical = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const compact = canonical.replace(/\s+/g, "");

  switch (canonical) {
    case "right":
    case "east":
      return 0;
    case "up":
    case "north":
      return 90;
    case "left":
    case "west":
      return 180;
    case "down":
    case "south":
      return -90;
    case "north east":
      return 45;
    case "north west":
      return 135;
    case "south east":
      return -45;
    case "south west":
      return -135;
    default:
      break;
  }

  switch (compact) {
    case "northeast":
      return 45;
    case "northwest":
      return 135;
    case "southeast":
      return -45;
    case "southwest":
      return -135;
    default:
      break;
  }

  const parsed = Number(canonical);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return null;
}

function parseTreeLevel(raw: string): number | null {
  const normalized = stripWrappingBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.trunc(parsed));
}

function normalizeTreeAnchor(raw: string): string {
  return stripWrappingBraces(raw).trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function parseTreeLevelStyleKey(key: string): { level: number; append: boolean } | null {
  const match = key.match(/^level\s+(\d+)\s*\/\.(style|append style)$/);
  if (!match) {
    return null;
  }

  const parsedLevel = Number(match[1]);
  if (!Number.isFinite(parsedLevel)) {
    return null;
  }

  return {
    level: Math.max(0, Math.trunc(parsedLevel)),
    append: match[2] === "append style"
  };
}

function updateTreeLevelStyleLayers(
  layers: Array<{ level: number; layers: ProvenanceOptionList[] }>,
  level: number,
  layer: ProvenanceOptionList,
  append: boolean
): Array<{ level: number; layers: ProvenanceOptionList[] }> {
  const next = layers.map((entry) => ({
    level: entry.level,
    layers: [...entry.layers]
  }));
  const index = next.findIndex((entry) => entry.level === level);
  if (index < 0) {
    next.push({ level, layers: [layer] });
    next.sort((left, right) => left.level - right.level);
    return next;
  }

  if (append) {
    next[index] = {
      level,
      layers: [...next[index].layers, layer]
    };
  } else {
    next[index] = {
      level,
      layers: [layer]
    };
  }

  return next;
}

function parseProvenanceStyleLayer(
  entry: Extract<OptionListAst["entries"][number], { kind: "kv" }>,
  sourceRef: StyleSourceRef
): ProvenanceOptionList | null {
  const valueOffset = resolveOptionValueStartOffset(entry);
  const parsed = parseStyleValueAsOptionList(entry.valueRaw, valueOffset);
  if (!parsed) {
    return null;
  }
  return {
    options: parsed,
    sourceRef: {
      sourceId: sourceRef.sourceId,
      sourceSpan: entry.span,
      sourceKind: sourceRef.sourceKind,
      label: entry.key
    }
  };
}

function parseProvenanceSingleOptionLayer(
  entry: Extract<OptionListAst["entries"][number], { kind: "kv" }>,
  sourceRef: StyleSourceRef
): ProvenanceOptionList {
  return {
    options: {
      span: entry.span,
      raw: `[${entry.raw}]`,
      entries: [entry]
    },
    sourceRef: {
      sourceId: sourceRef.sourceId,
      sourceSpan: entry.span,
      sourceKind: sourceRef.sourceKind,
      label: entry.key
    }
  };
}

function resolveOptionValueStartOffset(entry: Extract<OptionListAst["entries"][number], { kind: "kv" }>): number {
  if (entry.valueSpan) {
    return entry.valueSpan.from;
  }
  return entry.span.from;
}

function parseBoolish(raw: string): boolean | null {
  return parseBooleanishNormalized(raw);
}

function normalizeLabelPinPosition(raw: string): string {
  return stripWrappingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
}
