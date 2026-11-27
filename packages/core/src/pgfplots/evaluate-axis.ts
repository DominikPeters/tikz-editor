/**
 * The pgfplots axis evaluator: runs the staged pipeline of
 * design/pgfplots.md 4.2 for one `AxisStatement` and emits its scene
 * elements (stage 6) in the paint order measured in behaviour C1.
 *
 * Stages 1–5 live in model.ts, data.ts, limits.ts, ticks.ts and layout.ts
 * and are pure; this module is the impure shell: it evaluates styles and
 * synthetic label nodes through the ordinary TikZ evaluator (supplied by
 * the host as `evaluateStatement`), installs the axis coordinate systems
 * and the data map for embedded TikZ, and registers the axis as a node.
 */
import type { AddPlotStatement, AxisStatement, PathStatement, Span, Statement } from "../ast/types.js";
import type { FeatureId } from "../capabilities/feature-ids.js";
import { worldBounds, worldPoint, worldVector, type WorldPoint } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import { worldTransform, type WorldTransform } from "../coords/transforms.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionListAst } from "../options/types.js";
import { parseTikz } from "../parser/index.js";
import {
  currentFrame,
  extendPictureBounds,
  popFrame,
  pushFrame,
  readContextMacroBinding,
  resolveContextColorAliasValue,
  writeNamedCoordinate,
  writeNamedNodeGeometry,
  type CoordinateSystemResolver,
  type NodeGeometryProbe,
  type SemanticContext,
  type SemanticContextFrame
} from "../semantic/context.js";
import { evaluateRawCoordinate, evaluateTransformCoordinate } from "../semantic/coords/evaluate.js";
import { applyPgfNumberFormatKey } from "../semantic/pgfmath/number-format.js";
import { readPgfNumberFormat } from "../semantic/pgfmath/print-number-text.js";
import { makePath } from "../semantic/path/elements.js";
import { isPlotMarkName, plotMarkPrimitives, type PlotMarkSegment } from "../semantic/path/plot-marks.js";
import type { StyleTraceLayerInput } from "../semantic/style-chain.js";
import { cloneCustomStyleRegistry } from "../semantic/style/custom-styles.js";
import { commandDefaultStyle } from "../semantic/style/defaults.js";
import { expandMacroBindings } from "../macros/index.js";
import { expandOptionListMacros } from "../semantic/style/macro-options.js";
import { resolveContextDelta } from "../semantic/style/resolve.js";
import { applyMatrix, inverseMatrix, multiplyMatrix } from "../semantic/transform.js";
import type { FeatureUsage, ResolvedStyle, SceneClipPath, SceneElement, ScenePath, ScenePathCommand } from "../semantic/types.js";
import { applyPgfMathScopeOptions, readPgfMathScope } from "../semantic/pgfmath/scope.js";
import { collectPlotData, filterPlotPoints, type PlotMathEnvironment, type PlotPoint } from "./data.js";
import { emitLegend, type LegendImageSource, type LegendMarks } from "./legend-emit.js";
import { plotHandlerCommands } from "./plot-handlers.js";
import { flattenStyleEntries, keyUsesToOptionList, styleLists, type PgfplotsKeyUse } from "./keys.js";
import { boxSize as computeAxisLayoutSize, boxSizeWithoutLimits, computeAxisLayout, extendAxisLayout, type AxisLayout, type Box, type LabelGeometry, type LabelRequest, type LabelRole, type Point, type Segment } from "./layout.js";
import { computeLimits } from "./limits.js";
import { COLOR_CYCLE_LIST, readPgfNumber, resolveAxisModel, resolvePlotModel, stripBraces, type AxisModel, type PlotModel } from "./model.js";
import { computeTicks, dataTickValues, type DirectionTicks } from "./ticks.js";

/** The macro binding that carries `\pgfplotsset` payloads in scope (like the number format state). */
export const PGFPLOTS_SETTINGS_BINDING = "\\pgfplots settings state";

export type AxisHost = {
  /** The ordinary statement evaluator (paths, scopes, …) in the current frame. */
  evaluateStatement: (statement: Statement) => SceneElement[];
  diagnostics: Diagnostic[];
  markFeature: (id: FeatureId, status: "supported" | "unsupported") => void;
  featureUsage: FeatureUsage;
};

/** Everything the evaluator produced for one axis, kept for the oracle adapter and editing. */
export type AxisEvaluation = {
  axisId: string;
  model: AxisModel;
  layout: AxisLayout;
  /** World transform of the frame the layout coordinates are in. */
  frameTransform: WorldTransform;
  labels: Array<{ role: LabelRole; tickPosition?: number; probe: NodeGeometryProbe | null; text: string; textBox?: { origin: Point; width: number; height: number; depth: number }; cell?: { row: number; column: number } }>;
  /** The axis clip (C3), when `clip=true`. */
  clip: SceneClipPath | null;
};

const axisEvaluations = new WeakMap<SemanticContext, AxisEvaluation[]>();
const sceneAxisEvaluations = new WeakMap<object, readonly AxisEvaluation[]>();

/** Keeps the context's axis evaluations with the scene that the run produced. */
export function rememberAxisEvaluations(scene: object, context: SemanticContext): void {
  const list = axisEvaluations.get(context);
  if (list && list.length > 0) sceneAxisEvaluations.set(scene, list);
}

/** The axes of an evaluated scene (full evaluations only), for the oracle adapter and editing. */
export function getAxisEvaluations(scene: object): readonly AxisEvaluation[] {
  return sceneAxisEvaluations.get(scene) ?? [];
}

/** The axes evaluated so far in this context, in order (for tests and the oracle adapter). */
export function listAxisEvaluations(context: SemanticContext): readonly AxisEvaluation[] {
  return axisEvaluations.get(context) ?? [];
}

/** The `\pgfplotsset` payloads in scope, oldest first. */
export function readPgfplotsSettings(context: SemanticContext): OptionListAst[] {
  const binding = readContextMacroBinding(context, PGFPLOTS_SETTINGS_BINDING);
  if (binding?.kind !== "text" || binding.value.length === 0) return [];
  return binding.value.split("\u0000").map((raw) => parseOptionListRaw(`[${raw}]`));
}

/** The last `compat=` in the settings, if any. */
export function readPgfplotsCompat(settings: readonly OptionListAst[]): string | undefined {
  let compat: string | undefined;
  for (const list of settings) for (const entry of list.entries) {
    if (entry.kind === "kv" && entry.key.replace(/^\/pgfplots\//u, "") === "compat") compat = stripBraces(entry.valueRaw);
  }
  return compat;
}

function compatBelow111(compat: string): boolean {
  if (compat === "newest") return false;
  const match = /^(\d+)\.(\d+)/u.exec(compat);
  if (!match) return true;
  const major = Number(match[1]); const minor = Number(match[2]);
  return major < 1 || (major === 1 && minor < 11);
}

function p(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

type ResolvedFrameStyle = { style: ResolvedStyle; transform: WorldTransform; diagnostics: string[] };

function resolveStyle(
  context: SemanticContext,
  frame: SemanticContextFrame,
  baseStyle: ResolvedStyle,
  lists: OptionListAst[],
  sourceId: string,
  span: Span
): ResolvedFrameStyle {
  if (lists.length === 0) return { style: baseStyle, transform: frame.transform, diagnostics: [] };
  const layers: StyleTraceLayerInput[] = [{ kind: "scope", sourceRef: { sourceId, sourceSpan: span, sourceKind: "pgfplots", label: "pgfplots" }, rawOptions: lists }];
  const resolved = resolveContextDelta(
    baseStyle, frame.transform, layers, cloneCustomStyleRegistry(frame.customStyles),
    (raw, basis) => evaluateTransformCoordinate(raw, context, basis), frame.styleChain,
    (raw) => resolveContextColorAliasValue(context, raw), frame.axisBasis
  );
  return { style: resolved.style, transform: resolved.transform, diagnostics: resolved.diagnostics.map((d) => (typeof d === "string" ? d : d.code)) };
}

function drawBase(style: ResolvedStyle): ResolvedStyle {
  return { ...style, ...commandDefaultStyle("draw", style) };
}

/** A frame for evaluating statements inside the axis. */
function childFrame(parent: SemanticContextFrame, overrides: Partial<SemanticContextFrame>): SemanticContextFrame {
  return {
    ...parent,
    customStyles: cloneCustomStyleRegistry(parent.customStyles),
    colorAliases: parent.colorAliases.fork(),
    macroBindings: parent.macroBindings.fork(),
    everyPathStyles: [...parent.everyPathStyles],
    everyNodeStyles: [...parent.everyNodeStyles],
    everyTextNodePartStyles: [...parent.everyTextNodePartStyles],
    everyFitStyles: [...parent.everyFitStyles],
    everyPicStyles: [...parent.everyPicStyles],
    everyShapeNodeStyles: new Map(parent.everyShapeNodeStyles),
    ...overrides
  };
}

function segmentsToCommands(segments: readonly Segment[], toWorld: (p: Point) => WorldPoint): ScenePathCommand[] {
  return segments.flatMap((s): ScenePathCommand[] => [{ kind: "M", to: toWorld(s.from) }, { kind: "L", to: toWorld(s.to) }]);
}

function dedupeWarnings(diagnostics: Diagnostic[], items: ReadonlyArray<{ key: string; span: Span }>, seen: Set<string>, code: string, message: (key: string) => string): void {
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    diagnostics.push({ severity: "warning", code: `${code}:${item.key}`, message: message(item.key), span: item.span });
  }
}

const NUMBER_FORMAT_PREFIX = "/pgf/number format/";

/** Evaluates one axis; returns its scene elements in paint order. */
export function evaluateAxisStatement(source: AxisStatement, context: SemanticContext, host: AxisHost): SceneElement[] {
  const { diagnostics, markFeature } = host;
  const parent = currentFrame(context);
  // Option values may use macros (`width=\figwidth`), expanded as TikZ options are.
  const expand = (list: OptionListAst): OptionListAst => expandOptionListMacros([list], parent.macroBindings, context.macroTraceCollector ?? undefined)[0] ?? list;
  const axis: AxisStatement = {
    ...source,
    ...(source.options ? { options: expand(source.options) } : {}),
    body: source.body.map((item) => (item.kind === "AddPlot" && item.options ? { ...item, options: expand(item.options) } : item))
  };
  const settings = readPgfplotsSettings(context).map(expand);
  const bodySettings = axis.body.flatMap((item) => (item.kind === "PgfplotsSet" ? [expand(item.optionList)] : []));
  markFeature("pgfplots_axis", "supported");

  if (axis.environment !== "axis") {
    markFeature("pgfplots_log_axes", "unsupported");
    diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-axis", message: `Logarithmic axes (\`${axis.environment}\`) are not rendered yet; this editor skips the environment and everything inside it.`, span: axis.beginSpan });
    return [];
  }
  const compat = readPgfplotsCompat(settings);
  // Per axis, so a statement's diagnostics do not depend on what was evaluated before it (incremental replay).
  if (compat === undefined || compatBelow111(compat)) {
    diagnostics.push({
      severity: "warning", code: "pgfplots-compat",
      message: compat === undefined
        ? "No `\\pgfplotsset{compat=…}` is in effect; pgfplots then uses its oldest label placement. This editor renders compat=1.18 semantics: add `\\pgfplotsset{compat=1.18}` to the preamble to match."
        : `\`compat=${compat}\` is older than 1.11; this editor renders compat=1.18 semantics. Set \`compat=1.18\` to match.`,
      span: axis.beginSpan
    });
  }

  // Stage 1.
  const model = resolveAxisModel({ axis, settings, bodySettings });
  const warned = new Set<string>();
  dedupeWarnings(diagnostics, model.unsupported, warned, "unsupported-pgfplots-key", (key) => `pgfplots key \`${key}\` is not supported yet; it is ignored.`);
  for (const bad of model.invalid) {
    diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:${bad.key}`, message: `Cannot read \`${bad.key}=${bad.value}\`; it is ignored.`, span: bad.span });
  }

  // The axis scope: TikZ keys given to the axis (`thick`, `font=\small`, `xshift`).
  const axisTikz = model.tikzOptions.filter((use) => !use.key.startsWith("/pgf/"));
  const axisScope = resolveStyle(context, parent, parent.style, axisTikz.length > 0 ? [keyUsesToOptionList(axisTikz)] : [], axis.id, axis.span);
  dedupeWarnings(diagnostics, axisScope.diagnostics.filter((code) => code.startsWith("unsupported-option-key:")).map((code) => ({ key: code.slice("unsupported-option-key:".length), span: axis.optionsSpan ?? axis.beginSpan })), warned, "unsupported-pgfplots-key", (key) => `Key \`${key}\` is neither a supported pgfplots key nor a TikZ key; it is ignored.`);
  const axisFrame = childFrame(parent, { style: axisScope.style, transform: axisScope.transform });
  // `declare function` and `trig format` given to the axis hold for everything in it.
  const pgfmathScopeKeys = (uses: readonly PgfplotsKeyUse[]) => uses.filter((use) => /^(?:\/pgf\/)?(?:declare function|trig format)$/u.test(use.key)).map((use) => ({ ...use, key: use.key.replace(/^\/pgf\//u, "") }));
  const axisPgfmath = pgfmathScopeKeys(model.tikzOptions);
  if (axisPgfmath.length > 0) applyPgfMathScopeOptions(axisFrame.macroBindings, [keyUsesToOptionList(axisPgfmath)]);
  const frameTransform = axisScope.transform;
  const toWorld = (q: Point): WorldPoint => applyMatrix(frameTransform, p(q.x, q.y));
  const inverse = inverseMatrix(frameTransform) ?? frameTransform;
  const toLocal = (w: WorldPoint): Point => { const q = applyMatrix(inverse, w); return { x: q.x, y: q.y }; };

  let numberFormat = readPgfNumberFormat(parent.macroBindings);
  const applyNumberFormat = (uses: readonly PgfplotsKeyUse[]) => {
    for (const use of uses) {
      if (!use.key.startsWith(NUMBER_FORMAT_PREFIX)) continue;
      numberFormat = applyPgfNumberFormatKey(numberFormat, use.key.slice(NUMBER_FORMAT_PREFIX.length), use.value).format;
    }
  };
  applyNumberFormat(model.tikzOptions);

  // Stage 2.
  const plotStatements = axis.body.filter((item) => item.kind === "AddPlot");
  const plots: Array<{ model: PlotModel; points: PlotPoint[] | null }> = [];
  // `forget plot` uses the current cycle list entry without advancing it (manual markers-meta.tex, `every legend image post` example).
  let cycleCounter = 0;
  plotStatements.forEach((statement) => {
    const plot = resolvePlotModel(model, statement, cycleCounter);
    if (!plot.forget) cycleCounter += 1;
    dedupeWarnings(diagnostics, plot.unsupported, warned, "unsupported-pgfplots-key", (key) => `pgfplots key \`${key}\` is not supported yet; it is ignored.`);
    for (const bad of plot.invalid) diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:${bad.key}`, message: `Cannot read \`${bad.key}=${bad.value}\`; it is ignored.`, span: bad.span });
    const data = collectPlotData(statement, plot, context.source, (text) => expandMacroBindings(text, parent.macroBindings), plotMathEnvironment(axisFrame, plot));
    const input = statement.input.kind;
    if (data.kind === "unsupported") {
      markFeature(input === "coordinates" ? "pgfplots_addplot_coordinates" : input === "table" ? "pgfplots_addplot_table" : input === "other" ? "pgfplots_addplot_other_inputs" : "pgfplots_addplot_expression", "unsupported");
      diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-plot", message: `This plot is not drawn: ${data.reason} is not supported yet.`, span: data.span });
      plots.push({ model: plot, points: null });
      return;
    }
    markFeature(input === "coordinates" ? "pgfplots_addplot_coordinates" : input === "table" ? "pgfplots_addplot_table" : "pgfplots_addplot_expression", "supported");
    if (statement.trailingPath) {
      diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-trailing-path", message: "Path operations after an `\\addplot` input (`\\closedcycle`, `node[pos=…]`) are not drawn yet.", span: statement.trailingPath.span });
    }
    plots.push({ model: plot, points: filterPlotPoints(data.points, plot) });
    if (plot.handler !== "sharp" || plot.markRepeat !== 1 || plot.markPhase !== 1 || plot.markIndices || model.cycleListShift !== 0 || model.cycleList.join("\n") !== COLOR_CYCLE_LIST.join("\n")) markFeature("pgfplots_plot_styles", "supported");
  });
  for (const item of axis.body) {
    if (item.kind === "PgfplotsExtra") {
      diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-extra", message: "`\\pgfplotsextra` is not evaluated.", span: item.span });
    }
  }

  // Stage 3.
  const drawn = plots.flatMap((plot) => (plot.points && !plot.model.forget ? [plot.points] : plot.points ? [plot.points] : []));
  const limitsResult = computeLimits(model, drawn, boxSizeWithoutLimits(model));
  if (limitsResult.kind === "inverted") {
    diagnostics.push({ severity: "error", code: "pgfplots-inverted-limits", message: `${limitsResult.axis}min (${String(limitsResult.min)}) is larger than ${limitsResult.axis}max (${String(limitsResult.max)}); pgfplots cannot draw this axis.`, span: axis.optionsSpan ?? axis.beginSpan });
    return [];
  }
  const limits = limitsResult.limits;

  // Stage 4 needs the box length (A2): computed by the layout's size model.
  const size = boxSizeOf(model, limits);
  const tickFor = (letter: "x" | "y"): DirectionTicks => {
    const styleUses = flattenStyleEntries(styleLists(model.styles, ["every tick label", `every ${letter} tick label`]), model.styles);
    const before = numberFormat;
    applyNumberFormat(styleUses);
    const result = computeTicks({
      dir: model[letter], lo: letter === "x" ? limits.xmin : limits.ymin, hi: letter === "x" ? limits.xmax : limits.ymax,
      length: letter === "x" ? size.width : size.height, data: dataTickValues(drawn, letter), numberFormat,
      listBase: limitsResult.tickBase[letter]
    });
    numberFormat = before;
    if (result.kind === "invalid") {
      diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:${letter}tick`, message: `Cannot read the tick list \`${result.what}\`; no ticks are drawn.`, span: axis.optionsSpan ?? axis.beginSpan });
      return { major: [], minor: [], scaleExponent: 0, labelled: false };
    }
    return result.ticks;
  };
  const ticks = { x: tickFor("x"), y: tickFor("y") };
  markFeature("pgfplots_ticks", "supported");
  if (model.x.label || model.y.label || model.title) markFeature("pgfplots_axis_descriptions", "supported");
  if (axis.body.some((item) => item.kind !== "AddPlot" && item.kind !== "AddLegendEntry" && item.kind !== "AddLegendImage" && item.kind !== "Legend" && item.kind !== "PgfplotsExtra" && item.kind !== "PgfplotsSet")) markFeature("pgfplots_axis_coordinates", "supported");

  // Label measurement through the node pipeline.
  const labelFrame = childFrame(axisFrame, { pictureSizeRelevant: false });
  const labelStatements = new Map<LabelRequest, PathStatement | null>();
  const evaluateLabel = (request: LabelRequest, at: Point, emit: boolean, frame: SemanticContextFrame = labelFrame): { elements: SceneElement[]; probe: NodeGeometryProbe | null } => {
    let statement = labelStatements.get(request);
    if (statement === undefined) {
      statement = buildLabelStatement(request, model, axis);
      labelStatements.set(request, statement);
    }
    if (!statement) return { elements: [], probe: null };
    const positioned = withLabelPosition(statement, at);
    const handleStart = context.editHandles.length;
    const diagnosticsStart = diagnostics.length;
    let probe: NodeGeometryProbe | null = null;
    const previousProbe = context.nodeGeometryProbe;
    context.nodeGeometryProbe = (report) => { probe ??= report; };
    pushFrame(context, frame);
    let elements: SceneElement[];
    try {
      elements = host.evaluateStatement(positioned);
    } finally {
      popFrame(context);
      context.nodeGeometryProbe = previousProbe;
      context.editHandles.length = handleStart;
    }
    if (!emit) diagnostics.length = diagnosticsStart;
    else {
      for (let i = diagnosticsStart; i < diagnostics.length; i += 1) {
        const d = diagnostics[i];
        if (d) diagnostics[i] = { ...d, span: request.role === "xlabel" ? model.x.label?.span ?? axis.beginSpan : request.role === "ylabel" ? model.y.label?.span ?? axis.beginSpan : request.role === "title" ? model.title?.span ?? axis.beginSpan : axis.optionsSpan ?? axis.beginSpan };
      }
    }
    return { elements: elements.map((element) => attributeTo(element, axis.id, axis.span)), probe };
  };
  const measure = (request: LabelRequest): LabelGeometry | null => {
    const { probe } = evaluateLabel(request, request.at, false);
    if (!probe) return null;
    return probeGeometry(probe, toLocal);
  };

  const labelStyles: Record<LabelRole, OptionListAst[]> = {
    xtick: styleLists(model.styles, ["every tick label", "every x tick label"]),
    ytick: styleLists(model.styles, ["every tick label", "every y tick label"]),
    xscale: styleLists(model.styles, ["every tick label", "every x tick label", "every x tick scale label"]),
    yscale: styleLists(model.styles, ["every tick label", "every y tick label", "every y tick scale label"]),
    xlabel: styleLists(model.styles, ["every axis label", "every axis x label"]),
    ylabel: styleLists(model.styles, ["every axis label", "every axis y label"]),
    title: styleLists(model.styles, ["every axis title"]),
    legend: [],
    "legend-entry": []
  };

  // Plot styles (needed for marks in F1 and for emission).
  const plotStyles = plots.map((plot) => {
    if (!plot.points) return null;
    const resolved = resolveStyle(context, axisFrame, drawBase(axisScope.style), plot.model.pathKeys.length > 0 ? [keyUsesToOptionList(plot.model.pathKeys)] : [], plot.model.statement.id, plot.model.statement.span);
    dedupeWarnings(diagnostics, resolved.diagnostics.filter((code) => code.startsWith("unsupported-option-key:")).map((code) => ({ key: code.slice("unsupported-option-key:".length), span: plot.model.statement.optionsSpan ?? plot.model.statement.span })), warned, "unsupported-pgfplots-key", (key) => `Key \`${key}\` is neither a supported pgfplots key nor a TikZ key; it is ignored.`);
    return resolved.style;
  });
  const marksFor = (plotModel: PlotModel, base: ResolvedStyle, warn: boolean): LegendMarks | null => {
    const mark = plotModel.mark;
    if (mark === null) return null;
    if (!isPlotMarkName(mark)) {
      if (warn) diagnostics.push({ severity: "warning", code: `unknown-plot-mark:${mark}`, message: `PGF defines no plot mark named \`${mark}\`; no marks are drawn.`, span: plotModel.statement.span });
      return null;
    }
    const markBase: ResolvedStyle = { ...base, stroke: base.stroke ?? base.textColor ?? "black", fill: base.fill ?? base.textColor ?? "black", drawExplicit: true, markerStart: null, markerEnd: null };
    const lists = plotModel.markKeys.length > 0 ? [keyUsesToOptionList(plotModel.markKeys)] : [];
    const resolved = resolveStyle(context, axisFrame, markBase, lists, plotModel.statement.id, plotModel.statement.span);
    const style = { ...resolved.style, stroke: resolved.style.stroke ?? resolved.style.textColor ?? markBase.stroke, fill: resolved.style.fill ?? resolved.style.textColor ?? markBase.fill };
    // `mark options={scale=…}` scales the mark's geometry (PGF transforms the mark; line widths stay).
    const markScale = plotModel.markKeys.reduce((f, use) => (use.key === "scale" ? f * (readPgfNumber(use.value ?? "") ?? 1) : f), 1);
    const primitives = plotMarkPrimitives(mark, { size: plotModel.markSize ?? 2, strokeColor: style.stroke ?? "black", fillColor: style.fill ?? "black" })
      ?.map((primitive) => (primitive.kind === "path" && markScale !== 1 ? { ...primitive, segments: primitive.segments.map((seg) => scaleMarkSegment(seg, markScale)) } : primitive));
    if (!primitives || primitives.some((primitive) => primitive.kind !== "path")) {
      if (warn) diagnostics.push({ severity: "warning", code: `unsupported-plot-mark:${mark}`, message: `The \`${mark}\` mark is not drawn in axes yet.`, span: plotModel.statement.span });
      return null;
    }
    return { style, primitives: primitives.flatMap((primitive) => (primitive.kind === "path" ? [primitive] : [])) };
  };
  const markStyles = plots.map((plot, index) => {
    const base = plotStyles[index];
    if (!plot.points || !base) return null;
    return marksFor(plot.model, base, true);
  });

  const insideBox = (q: Point, box: { x0: number; y0: number; x1: number; y1: number }) => {
    const eps = 1e-6 * Math.max(1, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
    return q.x >= box.x0 - eps && q.x <= box.x1 + eps && q.y >= box.y0 - eps && q.y <= box.y1 + eps;
  };

  const tickStyleNames = (letter: "x" | "y", kind: "major" | "minor") => ["every tick", `every ${kind} tick`, `every ${letter} tick`, `every ${kind} ${letter} tick`];
  const elementStyle = (names: string[]): ResolvedStyle => {
    const uses = flattenStyleEntries(styleLists(model.styles, names), model.styles);
    return resolveStyle(context, axisFrame, drawBase(axisScope.style), uses.length > 0 ? [keyUsesToOptionList(uses)] : [], axis.id, axis.span).style;
  };

  // Stage 5.
  // `at` is a point of the enclosing picture; TikZ shifts given to the axis (`xshift`) apply on top of it.
  const parentInverse = inverseMatrix(parent.transform) ?? parent.transform;
  const atWorld = model.at ? evaluateTransformCoordinateInFrame(model.at, context, parent) : null;
  const at = atWorld ? applyMatrix(parentInverse, atWorld) : null;
  if (model.at && !at) diagnostics.push({ severity: "warning", code: "invalid-pgfplots-value:at", message: `Cannot read \`at=${model.at}\`; the axis is placed at the origin.`, span: axis.optionsSpan ?? axis.beginSpan });
  const baseLayout = computeAxisLayout({
    model, limits, ticks, labelStyles, lineWidth: axisScope.style.lineWidth,
    tickLineWidth: (letter, kind) => elementStyle(tickStyleNames(letter, kind)).lineWidth,
    at: at ? { x: at.x, y: at.y } : null,
    measure,
    markBounds: (map) => {
      let box: Box | null = null;
      const area = { x0: map(limits.xmin, limits.ymin).x, y0: map(limits.xmin, limits.ymin).y, x1: map(limits.xmax, limits.ymax).x, y1: map(limits.xmax, limits.ymax).y };
      plots.forEach((plot, index) => {
        const marks = markStyles[index];
        if (!marks || !plot.points) return;
        const extent = segmentsBounds(marks.primitives.flatMap((primitive) => primitive.segments));
        if (!extent) return;
        let streamIndex = 0;
        for (const point of plot.points) {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
          streamIndex += 1;
          if (!markSelected(plot.model, streamIndex)) continue;
          const q = map(point.x, point.y);
          if (!insideBox(q, area)) continue;
          box = unionBox(box, { minX: q.x + extent.minX, minY: q.y + extent.minY, maxX: q.x + extent.maxX, maxY: q.y + extent.maxY });
        }
      });
      return box;
    }
  });

  // Stage 6: emission in C1 order.
  let layout = baseLayout;
  const { x0, y0, x1, y1 } = layout.box;
  const mapPoint = (x: number, y: number): Point => ({ x: layout.map.origin.x + x * layout.map.xUnit.x, y: layout.map.origin.y + y * layout.map.yUnit.y });
  const elements: SceneElement[] = [];
  const axisPath = (itemId: string, style: ResolvedStyle, commands: ScenePathCommand[]): ScenePath => {
    const path = makePath(axis.id, itemId, style, axisFrame.styleChain, axis.span);
    path.commands = commands;
    path.clipChain = [...parent.clipChain];
    path.pictureSizeRelevant = false;
    return path;
  };
  const decorations: SceneElement[] = [];
  const gridOrder: Array<["x" | "y", "minor" | "major"]> = [["x", "minor"], ["x", "major"], ["y", "minor"], ["y", "major"]];
  for (const [letter, kind] of gridOrder) {
    const segments = layout.grid[letter][kind];
    if (segments.length === 0) continue;
    const style = elementStyle(["every axis grid", `every ${kind} grid`, `every axis ${letter} grid`, `every ${kind} ${letter} grid`]);
    decorations.push(axisPath(`grid:${letter}:${kind}`, style, segmentsToCommands(segments, toWorld)));
  }
  for (const [letter, kind] of gridOrder) {
    const segments = layout.tickMarks[letter][kind];
    if (segments.length === 0) continue;
    const style = elementStyle(tickStyleNames(letter, kind));
    decorations.push(axisPath(`ticks:${letter}:${kind}`, style, segmentsToCommands(segments, toWorld)));
  }
  decorations.push(axisPath("box", drawBase(axisScope.style), [
    { kind: "M", to: toWorld({ x: x0, y: y0 }) }, { kind: "L", to: toWorld({ x: x0, y: y1 }) },
    { kind: "L", to: toWorld({ x: x1, y: y1 }) }, { kind: "L", to: toWorld({ x: x1, y: y0 }) },
    { kind: "L", to: toWorld({ x: x0, y: y0 }) }, { kind: "Z" }
  ]));
  const labelRecords: AxisEvaluation["labels"] = [];
  const tickLabelElements: SceneElement[] = [];
  const descriptionElements: SceneElement[] = [];
  for (const placed of layout.labels) {
    const { elements: labelElements, probe } = evaluateLabel(placed.request, placed.request.at, true);
    labelRecords.push({ role: placed.request.role, ...(placed.request.tickPosition === undefined ? {} : { tickPosition: placed.request.tickPosition }), probe, text: placed.request.text });
    (placed.request.role === "xlabel" || placed.request.role === "ylabel" || placed.request.role === "title" ? descriptionElements : tickLabelElements).push(...labelElements);
  }

  // Clip (C3) and the content under it: plots and embedded TikZ in source order.
  const clip: SceneClipPath = {
    id: `scene-clip:${axis.id}`,
    sourceRef: { sourceId: axis.id, sourceSpan: axis.span },
    commands: [
      { kind: "M", to: toWorld({ x: x0, y: y0 }) }, { kind: "L", to: toWorld({ x: x1, y: y0 }) },
      { kind: "L", to: toWorld({ x: x1, y: y1 }) }, { kind: "L", to: toWorld({ x: x0, y: y1 }) }, { kind: "Z" }
    ],
    fillRule: "nonzero"
  };
  const contentClip = model.clip ? [...parent.clipChain, clip] : [...parent.clipChain];
  const dataTransform = multiplyMatrix(frameTransform, worldTransform(1, 0, 0, 1, layout.map.origin.x, layout.map.origin.y));
  const contentFrame = childFrame(axisFrame, {
    transform: dataTransform,
    axisBasis: { x: worldVector(pt(layout.map.xUnit.x), pt(0)), y: worldVector(pt(0), pt(layout.map.yUnit.y)) },
    clipChain: contentClip,
    pictureSizeRelevant: model.clip ? false : parent.pictureSizeRelevant
  });
  const content: SceneElement[] = [];
  const markElements: SceneElement[] = [];
  const previousSystems = context.coordinateSystems;
  context.coordinateSystems = new Map([...(previousSystems ?? []), ...axisCoordinateSystems(layout, toWorld)]);
  pushFrame(context, contentFrame);
  try {
    let plotIndex = 0;
    for (const item of axis.body) {
      if (item.kind === "AddPlot") {
        const plot = plots[plotIndex];
        const style = plotStyles[plotIndex];
        const marks = markStyles[plotIndex];
        plotIndex += 1;
        if (!plot?.points || !style) continue;
        const statement = plot.model.statement;
        if (!plot.model.onlyMarks) {
          // P1: the plot handler (sharp, smooth, const, jump, comb) on the canvas points.
          const canvas = plot.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).map((point) => ({ p: mapPoint(point.x, point.y), jump: point.jump }));
          const commands: ScenePathCommand[] = plotHandlerCommands(canvas, plot.model.handler, {
            tension: plot.model.tension,
            combBase: (q) => (plot.model.handler === "xcomb" ? { x: mapPoint(0, 0).x, y: q.y } : { x: q.x, y: mapPoint(0, 0).y })
          }).map((c): ScenePathCommand => (c.kind === "C" ? { kind: "C", c1: toWorld(c.c1), c2: toWorld(c.c2), to: toWorld(c.to) } : { kind: c.kind, to: toWorld(c.to) }));
          if (commands.some((command) => command.kind !== "M")) {
            const path = makePath(statement.id, "line", style, axisFrame.styleChain, statement.span);
            path.commands = commands;
            path.clipChain = [...contentClip];
            path.pictureSizeRelevant = false;
            content.push(path);
          }
        }
        if (marks) {
          let n = 0;
          let streamIndex = 0;
          for (const point of plot.points) {
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
            streamIndex += 1;
            if (!markSelected(plot.model, streamIndex)) continue;
            const q = mapPoint(point.x, point.y);
            if (!insideBox(q, layout.box)) continue;
            marks.primitives.forEach((primitive, primitiveIndex) => {
              const markStyle: ResolvedStyle = { ...marks.style, stroke: primitive.stroke, drawExplicit: primitive.stroke !== null, fill: primitive.fill, dashArray: marks.style.dashArray };
              const path = makePath(statement.id, `mark:${String(n)}:${String(primitiveIndex)}`, markStyle, axisFrame.styleChain, statement.span);
              path.commands = primitive.segments.map((segment) => markCommand(segment, q, toWorld));
              path.clipChain = [...parent.clipChain];
              path.pictureSizeRelevant = false;
              markElements.push(path);
            });
            n += 1;
          }
        }
        continue;
      }
      if (item.kind === "AddLegendEntry" || item.kind === "AddLegendImage" || item.kind === "Legend" || item.kind === "PgfplotsExtra" || item.kind === "PgfplotsSet") continue;
      const nested = host.evaluateStatement(item);
      content.push(...nested.map((element) => ({ ...element, clipChain: element.clipChain && element.clipChain.length > 0 ? element.clipChain : [...contentClip] })));
    }
  } finally {
    popFrame(context);
    context.coordinateSystems = previousSystems;
  }

  // F1: with clip=false, plots and embedded TikZ count for the axis' box (half their line width outset).
  if (!model.clip) {
    let extra: Box | null = null;
    for (const element of content) {
      const b = elementBounds(element);
      if (b) {
        const corners = [toLocal(p(b.minX, b.minY)), toLocal(p(b.maxX, b.maxY))];
        extra = unionBox(extra, { minX: Math.min(corners[0]?.x ?? 0, corners[1]?.x ?? 0), minY: Math.min(corners[0]?.y ?? 0, corners[1]?.y ?? 0), maxX: Math.max(corners[0]?.x ?? 0, corners[1]?.x ?? 0), maxY: Math.max(corners[0]?.y ?? 0, corners[1]?.y ?? 0) });
      }
    }
    layout = extendAxisLayout(layout, extra);
  }

  // The legend (behaviour L), painted after the descriptions; it counts for the axis' box (F1).
  const legendImagePost = styleLists(model.styles, ["every legend image post"]);
  const legendImages: LegendImageSource[] = [];
  {
    let plotIndex = 0;
    let cycle = 0;
    for (const item of axis.body) {
      if (item.kind === "AddPlot") {
        const plot = plots[plotIndex];
        plotIndex += 1;
        if (!plot || plot.model.forget) continue;
        cycle = plot.model.cycleIndex + 1;
        legendImages.push({ plot: resolvePlotModel(model, item, plot.model.cycleIndex, legendImagePost), sourceId: item.id, span: item.span });
      } else if (item.kind === "AddLegendImage") {
        // `\addlegendimage{opts}` acts as `\addplot[opts]` for the legend only; the plot index does not advance (manual).
        const synthetic: AddPlotStatement = { kind: "AddPlot", id: item.id, axisId: item.axisId, plotIndex: -1, span: item.span, commandSpan: item.span, dimension: 2, increment: false, options: item.options, input: { kind: "other", span: item.span, name: "legend image", nameSpan: item.span, raw: "" }, terminated: true };
        legendImages.push({ plot: resolvePlotModel(model, synthetic, cycle, legendImagePost), sourceId: item.id, span: item.span });
      }
    }
  }
  const legendResult = emitLegend({
    axis, model, images: legendImages, diagnostics,
    pathStyle: (plotModel, legendKeys) => resolveStyle(context, axisFrame, drawBase(axisScope.style), [...legendKeys, ...plotModel.pathKeys].length > 0 ? [keyUsesToOptionList([...legendKeys, ...plotModel.pathKeys])] : [], plotModel.statement.id, plotModel.statement.span).style,
    marks: (plotModel, base) => marksFor(plotModel, base, false),
    frameWith: (uses) => uses.length === 0 ? labelFrame : childFrame(labelFrame, { style: resolveStyle(context, labelFrame, labelFrame.style, [keyUsesToOptionList(uses)], axis.id, axis.span).style }),
    node: (request, frame, emit) => {
      const { elements: nodeElements, probe } = evaluateLabel(request, request.at, emit, frame);
      return { elements: nodeElements, probe, geometry: probe ? probeGeometry(probe, toLocal) : null };
    },
    path: (sourceId, itemId, style, span, commands) => {
      const path = makePath(sourceId, itemId, style, axisFrame.styleChain, span);
      path.commands = commands.map((c): ScenePathCommand => c.kind === "Z" ? { kind: "Z" } : c.kind === "C" ? { kind: "C", c1: toWorld(c.c1), c2: toWorld(c.c2), to: toWorld(c.to) } : { kind: c.kind, to: toWorld(c.to) });
      path.clipChain = [...parent.clipChain];
      path.pictureSizeRelevant = false;
      return path;
    },
    box: layout.box,
    resolvePoint: (raw) => resolveLegendPoint(raw, layout, context, axisFrame, toLocal),
    expand: (text) => expandMacroBindings(text, parent.macroBindings)
  });
  const legendElements = legendResult?.elements ?? [];
  if (legendResult) {
    markFeature("pgfplots_legend", "supported");
    layout = extendAxisLayout(layout, legendResult.bbox);
    labelRecords.push({ role: "legend", probe: legendResult.probe, text: legendResult.text, textBox: legendResult.textBox });
    for (const entry of legendResult.entries) labelRecords.push({ role: "legend-entry", tickPosition: entry.index, probe: entry.probe, text: entry.text, cell: { row: entry.row, column: entry.column } });
  }

  if (model.axisOnTop) elements.push(...content, ...decorations, ...tickLabelElements, ...markElements, ...descriptionElements, ...legendElements);
  else elements.push(...decorations, ...tickLabelElements, ...content, ...markElements, ...descriptionElements, ...legendElements);

  // F1: the axis' box extends the picture; `current axis` and `name=` become nodes.
  const worldBox = transformBox(layout.bbox, toWorld);
  extendPictureBounds(context, worldBox);
  registerAxisNode(context, "current axis", layout, toWorld, axis.id);
  if (model.name) registerAxisNode(context, model.name, layout, toWorld, axis.id);

  const evaluation: AxisEvaluation = { axisId: axis.id, model, layout, frameTransform, labels: labelRecords, clip: model.clip ? clip : null };
  const list = axisEvaluations.get(context) ?? [];
  list.push(evaluation);
  axisEvaluations.set(context, list);
  return elements;
}

/** World bounds of an element: path vertices and control points outset by half the line width when stroked, node boxes. */
function elementBounds(element: SceneElement): Box | null {
  const half = element.style.stroke && element.style.stroke !== "none" ? element.style.lineWidth / 2 : 0;
  if (element.kind === "Path") {
    let box: Box | null = null;
    for (const command of element.commands) {
      const points = command.kind === "C" ? [command.c1, command.c2, command.to] : command.kind === "Z" ? [] : [command.to];
      for (const q of points) box = unionBox(box, { minX: q.x - half, minY: q.y - half, maxX: q.x + half, maxY: q.y + half });
    }
    return box;
  }
  if (element.kind === "Circle") return { minX: element.center.x - element.radius - half, minY: element.center.y - element.radius - half, maxX: element.center.x + element.radius + half, maxY: element.center.y + element.radius + half };
  if (element.kind === "Ellipse") {
    const r = Math.max(element.rx, element.ry) + half;
    return { minX: element.center.x - r, minY: element.center.y - r, maxX: element.center.x + r, maxY: element.center.y + r };
  }
  const w = (element.nodeVisualWidth ?? 0) / 2; const h = (element.nodeVisualHeight ?? 0) / 2;
  const c = element.nodeVisualCenter ?? element.position;
  return { minX: c.x - w, minY: c.y - h, maxX: c.x + w, maxY: c.y + h };
}

/** Functions and trig format for a plot's expressions: the axis scope, the plot's own `declare function`, then `trig format plots`. */
function plotMathEnvironment(axisFrame: SemanticContextFrame, plot: PlotModel): PlotMathEnvironment {
  let bindings = axisFrame.macroBindings;
  if (plot.pgfmathKeys.length > 0) {
    bindings = bindings.fork();
    applyPgfMathScopeOptions(bindings, [keyUsesToOptionList(plot.pgfmathKeys)]);
  }
  const scope = readPgfMathScope(bindings);
  return {
    ...(scope.functions ? { functions: scope.functions } : {}),
    trigFormat: plot.trigFormatPlots ?? scope.trigFormat ?? "deg"
  };
}

/**
 * The legend's `at`: a plain pair is `axis description cs` (manual "Legend
 * Appearance": "relative to the axis rectangle (unless units like cm or pt
 * are specified explicitly)"); `(… cs:…)` and other TikZ coordinates are
 * read in the axis frame.
 */
function resolveLegendPoint(raw: string, layout: AxisLayout, context: SemanticContext, frame: SemanticContextFrame, toLocal: (w: WorldPoint) => Point): Point | null {
  const text = stripBraces(raw).trim();
  const inner = text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text;
  const parts = splitArgs(inner);
  const { x0, y0, x1, y1 } = layout.box;
  if (parts.length === 2 && !inner.includes("cs:")) {
    const ax = readNumber(parts[0] ?? ""); const ay = readNumber(parts[1] ?? "");
    if (ax !== null && ay !== null) return { x: x0 + ax * (x1 - x0), y: y0 + ay * (y1 - y0) };
  }
  const cs = /^\s*(axis description|rel axis|axis)\s+cs:(.*)$/u.exec(inner);
  if (cs) {
    const pair = splitArgs(cs[2] ?? "");
    const ax = readNumber(pair[0] ?? ""); const ay = readNumber(pair[1] ?? "");
    if (ax === null || ay === null) return null;
    if (cs[1] === "axis") return { x: layout.map.origin.x + ax * layout.map.xUnit.x, y: layout.map.origin.y + ay * layout.map.yUnit.y };
    return { x: x0 + ax * (x1 - x0), y: y0 + ay * (y1 - y0) };
  }
  const world = evaluateTransformCoordinateInFrame(text, context, frame);
  return world ? toLocal(world) : null;
}

/** P3: `mark indices` (1-based), else `mark repeat`/`mark phase` (TikZ: the phase-th point, then every repeat-th). */
function markSelected(plot: PlotModel, index: number): boolean {
  if (plot.markIndices) return plot.markIndices.includes(index);
  return index >= plot.markPhase && (index - plot.markPhase) % plot.markRepeat === 0;
}

function scaleMarkSegment(segment: PlotMarkSegment, f: number): PlotMarkSegment {
  if (segment.op === "Z") return segment;
  if (segment.op === "C") return { ...segment, x1: segment.x1 * f, y1: segment.y1 * f, x2: segment.x2 * f, y2: segment.y2 * f, x: segment.x * f, y: segment.y * f };
  return { ...segment, x: segment.x * f, y: segment.y * f };
}

function boxSizeOf(model: AxisModel, limits: { xmin: number; xmax: number; ymin: number; ymax: number }): { width: number; height: number } {
  const layoutSize = computeAxisLayoutSize(model, limits);
  return layoutSize;
}


function evaluateTransformCoordinateInFrame(raw: string, context: SemanticContext, frame: SemanticContextFrame): WorldPoint | null {
  pushFrame(context, frame);
  try {
    const text = raw.trim();
    return evaluateRawCoordinateWorld(text.startsWith("(") ? text : `(${text})`, context);
  } finally {
    popFrame(context);
  }
}


function evaluateRawCoordinateWorld(raw: string, context: SemanticContext): WorldPoint | null {
  return evaluateRawCoordinate(raw, context).world;
}

function markCommand(segment: PlotMarkSegment, at: Point, toWorld: (q: Point) => WorldPoint): ScenePathCommand {
  const w = (x: number, y: number) => toWorld({ x: at.x + x, y: at.y + y });
  switch (segment.op) {
    case "M": return { kind: "M", to: w(segment.x, segment.y) };
    case "L": return { kind: "L", to: w(segment.x, segment.y) };
    case "C": return { kind: "C", c1: w(segment.x1, segment.y1), c2: w(segment.x2, segment.y2), to: w(segment.x, segment.y) };
    case "Z": return { kind: "Z" };
  }
}

function segmentsBounds(segments: readonly PlotMarkSegment[]): Box | null {
  let box: Box | null = null;
  const add = (x: number, y: number) => { box = unionBox(box, { minX: x, minY: y, maxX: x, maxY: y }); };
  for (const s of segments) {
    if (s.op === "M" || s.op === "L") add(s.x, s.y);
    else if (s.op === "C") { add(s.x1, s.y1); add(s.x2, s.y2); add(s.x, s.y); }
  }
  return box;
}

function unionBox(a: Box | null, b: Box): Box {
  if (!a) return b;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

function transformBox(box: Box, toWorld: (q: Point) => WorldPoint) {
  const corners = [toWorld({ x: box.minX, y: box.minY }), toWorld({ x: box.maxX, y: box.minY }), toWorld({ x: box.minX, y: box.maxY }), toWorld({ x: box.maxX, y: box.maxY })];
  const xs = corners.map((c) => c.x); const ys = corners.map((c) => c.y);
  return worldBounds(pt(Math.min(...xs)), pt(Math.min(...ys)), pt(Math.max(...xs)), pt(Math.max(...ys)));
}

function probeGeometry(probe: NodeGeometryProbe, toLocal: (w: WorldPoint) => Point): LabelGeometry {
  const names = ["center", "north", "south", "east", "west", "north east", "north west", "south east", "south west", "base", "base west", "base east", "mid", "mid west", "mid east"];
  const anchors: Record<string, Point> = {};
  for (const name of names) anchors[name] = toLocal(probe.anchor(name));
  // The border without outer sep: the anchor rectangle shrunk by it, in the node's own frame.
  const corners = ["north east", "north west", "south east", "south west"].map((name) => anchors[name] ?? { x: 0, y: 0 });
  const center = anchors.center ?? { x: 0, y: 0 };
  const { a, b, c, d } = probe.linear;
  const shrink = (q: Point, sxSign: number, sySign: number): Point => ({
    x: q.x - (a * sxSign * probe.outerXSep + c * sySign * probe.outerYSep),
    y: q.y - (b * sxSign * probe.outerXSep + d * sySign * probe.outerYSep)
  });
  const signs: Array<[number, number]> = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  const inner = corners.map((q, i) => shrink(q, signs[i]?.[0] ?? 0, signs[i]?.[1] ?? 0));
  void center;
  const xs = inner.map((q) => q.x); const ys = inner.map((q) => q.y);
  return { anchors, border: { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) } };
}

/** Generated label elements belong to the axis; their text is not canvas-editable (no text span into the document). */
function attributeTo(element: SceneElement, sourceId: string, span: Span): SceneElement {
  const copy: SceneElement = { ...element, sourceRef: { sourceId, sourceSpan: span } };
  if (copy.kind === "Text") delete copy.textSourceSpan;
  return copy;
}

/** `\path node[<styles>,<placement>] at (0pt,0pt) {<text>};`, parsed once per label; ids and spans belong to the axis. */
function buildLabelStatement(request: LabelRequest, model: AxisModel, axis: AxisStatement): PathStatement | null {
  const uses = flattenStyleEntries(request.styles, model.styles).filter((use) => !use.key.startsWith("/pgf/number format/"));
  const options = [...uses.map((use) => (use.value === null ? use.key : `${use.key}=${use.value}`)), request.placement].filter((s) => s.length > 0).join(",");
  const source = `\\begin{tikzpicture}\\path node[${options}] at (0pt,0pt) {${request.text}};\\end{tikzpicture}`;
  const parsed = parseTikz(source, { recover: true });
  const statement = parsed.figure.body.find((entry): entry is PathStatement => entry.kind === "Path");
  if (!statement) return null;
  const id = `${axis.id}:label:${request.role}${request.tickPosition === undefined ? "" : `:${String(request.tickPosition)}`}`;
  const anchor = axis.beginSpan;
  return relabel(statement, id, anchor);
}

function relabel(statement: PathStatement, id: string, anchor: Span): PathStatement {
  const remap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== "object") return value;
    // This AST-only walker copies plain records (spans, ids) and keeps every other field.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) out[key] = remap(nested);
    if (typeof record.from === "number" && typeof record.to === "number") {
      const length = record.to - record.from;
      out.from = anchor.from;
      out.to = anchor.from + Math.max(0, length);
    }
    // Generated items get ids under the label's own id, so scene ids stay unique and stable.
    if (typeof record.id === "string" && typeof record.kind === "string") out.id = `${id}/${record.id}`;
    return out;
  };
  // The walker preserves the statement's discriminants and fields, replacing only spans and ids.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const relabeled = remap(statement) as PathStatement;
  return { ...relabeled, id };
}

function withLabelPosition(statement: PathStatement, at: Point): PathStatement {
  const raw = `(${String(at.x)}pt,${String(at.y)}pt)`;
  return {
    ...statement,
    items: statement.items.map((item) => (item.kind === "Node" ? { ...item, atRaw: raw } : item))
  };
}

function axisCoordinateSystems(layout: AxisLayout, toWorld: (q: Point) => WorldPoint): Array<[string, CoordinateSystemResolver]> {
  const { x0, y0, x1, y1 } = layout.box;
  const parsePair = (raw: string): [string, string] | null => {
    const parts = splitArgs(raw);
    const named = new Map<string, string>();
    const positional: string[] = [];
    for (const part of parts) {
      const eq = part.indexOf("=");
      if (eq > 0) named.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
      else positional.push(part);
    }
    const x = named.get("x") ?? positional[0];
    const y = named.get("y") ?? positional[1];
    return x !== undefined && y !== undefined ? [x, y] : null;
  };
  const numeric = (raw: string): number | null => {
    const n = readNumber(raw);
    return n;
  };
  const axisCs: CoordinateSystemResolver = (raw) => {
    const pair = parsePair(raw);
    const x = pair ? numeric(pair[0]) : null;
    const y = pair ? numeric(pair[1]) : null;
    if (x === null || y === null) return { error: `axis cs:${raw}` };
    return { point: toWorld({ x: layout.map.origin.x + x * layout.map.xUnit.x, y: layout.map.origin.y + y * layout.map.yUnit.y }) };
  };
  const relCs: CoordinateSystemResolver = (raw) => {
    const pair = parsePair(raw);
    const x = pair ? numeric(pair[0]) : null;
    const y = pair ? numeric(pair[1]) : null;
    if (x === null || y === null) return { error: `rel axis cs:${raw}` };
    return { point: toWorld({ x: x0 + x * (x1 - x0), y: y0 + y * (y1 - y0) }) };
  };
  return [["axis", axisCs], ["rel axis", relCs], ["axis description", relCs]];
}


function readNumber(raw: string): number | null {
  return readPgfNumber(raw);
}

function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0; let current = "";
  for (const c of raw) {
    if (c === "{" || c === "(") depth += 1;
    if (c === "}" || c === ")") depth -= 1;
    if (c === "," && depth === 0) { out.push(current.trim()); current = ""; continue; }
    current += c;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function registerAxisNode(context: SemanticContext, name: string, layout: AxisLayout, toWorld: (q: Point) => WorldPoint, sourceId: string): void {
  const { x0, y0, x1, y1 } = layout.box;
  const center = toWorld({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  writeNamedNodeGeometry(context, name, {
    sourceId,
    shape: "rectangle",
    center,
    anchorHalfWidth: (x1 - x0) / 2,
    anchorHalfHeight: (y1 - y0) / 2,
    anchorRadius: Math.max(x1 - x0, y1 - y0) / 2
  }, sourceId);
  for (const [anchor, q] of Object.entries(layout.anchors)) writeNamedCoordinate(context, `${name}.${anchor}`, toWorld(q), sourceId);
}

export type { Point };
