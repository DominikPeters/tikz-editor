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
import type { AddPlotStatement, AxisBodyItem, AxisStatement, PathStatement, Span, Statement } from "../ast/types.js";
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
  readContextStateBinding,
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
import type { FeatureUsage, PgfplotsAxisEditInfo, ResolvedStyle, SceneClipPath, SceneElement, ScenePath, ScenePathCommand } from "../semantic/types.js";
import { createEditHandle } from "../semantic/edit-handles.js";
import { axisDescriptionTextSpan, axisSubSelectionId } from "./edit-ids.js";
import { applyPgfMathScopeOptions, readPgfMathScope } from "../semantic/pgfmath/scope.js";
import { collectPlotData, filterPlotPoints, type PlotMathEnvironment, type PlotPoint } from "./data.js";
import { cachedPlotData, stableKeyText } from "./eval-cache.js";
import { axisLegendEntries, emitLegend, type LegendImageSource, type LegendMarks } from "./legend-emit.js";
import { associateLegend, type LegendAssociation } from "./legend.js";
import { plotHandlerCommands } from "./plot-handlers.js";
import { flattenStyleEntries, keyUsesToOptionList, styleLists, type PgfplotsKeyUse } from "./keys.js";
import { applyUnitVectorRatio, axisLineCoordinate, boxSize as computeAxisLayoutSize, boxSizeWithoutLimits, computeAxisLayout, extendAxisLayout, type AxisLayout, type Box, type LabelGeometry, type LabelRequest, type LabelRole, type Point, type Segment } from "./layout.js";
import { computeLimits } from "./limits.js";
import { renderPathWithArrows } from "../svg/arrows/render.js";
import { COLOR_CYCLE_LIST, isSurveyPlotKey, readLength, readPgfNumber, resolveAxisModel, resolvePlotModel, splitTopLevelList, stripBraces, type AxisModel, type PlotModel } from "./model.js";
import { readPgfplotsTableFile, readPgfplotsTableMacro } from "./table-io.js";
import { formatPgfNumber } from "../semantic/pgfmath/number-format.js";
import { normalizeColor } from "../semantic/style/colors.js";
import { barCorners, barGroups, barRects, stackPlots } from "./bars.js";
import { documentClassLengths, scanLengthRegisters, substituteDocumentLengths, type DocumentLengthEnvironment } from "./document-lengths.js";
import { computeExtraTicks, computeLogTicks, computeTicks, dataTickValues, type DirectionTicks } from "./ticks.js";
import { internalBase, internalLimitsModel, toInternal } from "./scale.js";

/** The macro binding that carries `\pgfplotsset` payloads in scope (like the number format state). */
export const PGFPLOTS_SETTINGS_BINDING = "\\pgfplots settings state";

/**
 * The cache key of a plot's data (design 4.3): the plot's text with macros
 * expanded, its resolved model and math environment, table keys and symbolic
 * coordinates, without source positions. Null (no caching) for tables read
 * from files or macros, and for expressions with random numbers.
 */
function plotDataCacheKey(
  statement: AddPlotStatement,
  plot: PlotModel,
  source: string,
  bindings: Parameters<typeof expandMacroBindings>[1],
  env: PlotMathEnvironment,
  io: { tableKeys: readonly { raw: string }[]; symbolic: unknown }
): string | null {
  const input = statement.input;
  if (input.kind === "other" || (input.kind === "table" && input.source.kind !== "inline")) return null;
  const text = expandMacroBindings(source.slice(statement.span.from, statement.span.to), bindings);
  if (/\b(?:rand|rnd|random)\b/u.test(text)) return null;
  const parts = [stableKeyText(plot), stableKeyText(env), stableKeyText(io.tableKeys.map((entry) => entry.raw)), stableKeyText(io.symbolic)];
  if (parts.includes(null)) return null;
  return [text, ...parts].join("\u0000");
}

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
  /**
   * The canvas transformation applied to the evaluated elements (behaviour Z1),
   * when the picture's TikZ transformation has a linear part. Label probes and
   * label geometry are in the untransformed frame; map them with this.
   */
  canvas?: WorldTransform;
  /** The plot-to-legend association as drawn (L4): shared with the edit actions. */
  legend: LegendAssociation;
};

const axisEvaluations = new WeakMap<SemanticContext, AxisEvaluation[]>();
const sceneAxisEvaluations = new WeakMap<object, readonly AxisEvaluation[]>();

/** Keeps the context's axis evaluations with the scene that the run produced. */
export function rememberAxisEvaluations(scene: object, context: SemanticContext): void {
  const list = axisEvaluations.get(context);
  if (list && list.length > 0) {
    sceneAxisEvaluations.set(scene, list);
    // Editing code often holds only the element list of the scene.
    const elements = "elements" in scene ? scene.elements : undefined;
    if (Array.isArray(elements)) sceneAxisEvaluations.set(elements, list);
  }
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
  const value = readContextStateBinding(context, PGFPLOTS_SETTINGS_BINDING);
  if (value === undefined || value.length === 0) return [];
  return value.split("\u0000").map((raw) => parseOptionListRaw(`[${raw}]`));
}

/** The last `compat=` in the settings, if any. */
export function readPgfplotsCompat(settings: readonly OptionListAst[]): string | undefined {
  let compat: string | undefined;
  for (const list of settings) for (const entry of list.entries) {
    if (entry.kind === "kv" && entry.key.replace(/^\/pgfplots\//u, "") === "compat") compat = stripBraces(entry.valueRaw);
  }
  return compat;
}

function compatBelow(compat: string, majorLimit: number, minorLimit: number): boolean {
  if (compat === "newest") return false;
  const match = /^(\d+)\.(\d+)/u.exec(compat);
  if (!match) return true;
  const major = Number(match[1]); const minor = Number(match[2]);
  return major < majorLimit || (major === majorLimit && minor < minorLimit);
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

const TRANSFORM_KEY = /^(?:scale|xscale|yscale|rotate|cm|xslant|yslant|shift|xshift|yshift|shift only|reset cm|transform canvas|rotate around)$/u;

/**
 * Behaviour AC1: the TikZ state an axis starts from. pgfplots begins the axis
 * with the line width back at 0.4pt and the stroke colour back at the current
 * colour (a `thick` or `draw=red` of the picture or of an enclosing scope
 * reaches nothing in the axis, not even embedded TikZ), then applies `every
 * picture` once more (its transformations: behaviour Z1, diagnosed). Colour,
 * text colour, font, dash pattern, opacity and the `every …` styles carry over.
 */
function axisEntryStyle(context: SemanticContext, outer: SemanticContextFrame, sourceId: string, span: Span): ResolvedStyle {
  const style = outer.style;
  const reset: ResolvedStyle = {
    ...style,
    lineWidth: 0.4,
    ...(style.drawExplicit ? { stroke: style.textColor ?? "black", drawExplicit: false } : {})
  };
  const lists = (outer.customStyles.get("every picture") ?? []).map((layer) => {
    const entries = layer.options.entries.filter((entry) => entry.kind === "unknown" || !TRANSFORM_KEY.test(entry.key.trim()));
    return entries.length === layer.options.entries.length ? layer.options : { ...layer.options, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` };
  }).filter((list) => list.entries.length > 0);
  if (lists.length === 0) return reset;
  return resolveStyle(context, outer, reset, expandOptionListMacros(lists, outer.macroBindings, context.macroTraceCollector ?? undefined), sourceId, span).style;
}

/** TikZ's `every path` in effect in a frame, macros expanded (behaviour AC2). */
function everyPathLists(context: SemanticContext, frame: SemanticContextFrame): OptionListAst[] {
  if (frame.everyPathStyles.length === 0) return [];
  return expandOptionListMacros(frame.everyPathStyles.map((layer) => layer.options), frame.macroBindings, context.macroTraceCollector ?? undefined);
}

/** TikZ's `every mark` in effect in a frame (behaviour AC3). */
function everyMarkLists(context: SemanticContext, frame: SemanticContextFrame): OptionListAst[] {
  const layers = frame.customStyles.get("every mark") ?? [];
  if (layers.length === 0) return [];
  return expandOptionListMacros(layers.map((layer) => layer.options), frame.macroBindings, context.macroTraceCollector ?? undefined);
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
  const outer = currentFrame(context);
  const t = outer.transform;
  const everyPicture = outer.customStyles.get("every picture") ?? [];
  if (everyPicture.some((layer) => layer.options.entries.some((entry) => entry.kind !== "unknown" && /^(?:scale|xscale|yscale|rotate|cm|xslant|yslant)$/u.test(entry.key.trim())))) {
    // Behaviour Z1: pgfplots applies `every picture` once more inside the axis, as a
    // coordinate transformation of its own drawing (box and tick lengths, not text).
    host.diagnostics.push({
      severity: "warning", code: "unsupported-pgfplots-every-picture-transform",
      message: "A transformation in `every picture` is applied twice to a pgfplots axis (once inside the axis, to its coordinates); this editor applies it once, so the axis is drawn too large.",
      span: source.beginSpan
    });
  }
  const linear = Math.abs(t.a - 1) > 1e-9 || Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9 || Math.abs(t.d - 1) > 1e-9;
  if (!linear) return evaluateAxisInFrame(source, context, host);
  // Behaviour Z1 (manual scaling.tex: "/tikz/scale ... will scale the complete
  // resulting image, including all text labels"): the axis is computed in an
  // untransformed frame at the picture origin, and the TikZ transformation in
  // effect (`\begin{tikzpicture}[scale=0.7]`) is applied to the result as a
  // canvas transformation (text, line widths and marks scale too).
  const origin = worldTransform(1, 0, 0, 1, t.e, t.f);
  const canvas = multiplyMatrix(t, inverseMatrix(origin) ?? origin);
  const savedBounds = context.pictureBounds;
  const tracker = context.statementEffectTracker;
  const savedTrackerBounds = tracker?.pictureBounds;
  const before = (axisEvaluations.get(context) ?? []).length;
  pushFrame(context, childFrame(outer, { transform: origin }));
  let elements: SceneElement[];
  try {
    elements = evaluateAxisInFrame(source, context, host);
  } finally {
    popFrame(context);
  }
  context.pictureBounds = savedBounds;
  if (tracker) tracker.pictureBounds = savedTrackerBounds ?? null;
  const outerClips = new Set(outer.clipChain.map((clip) => clip.id));
  const mappedClips = new Map<string, SceneClipPath>();
  const mapCommand = (command: ScenePathCommand): ScenePathCommand => {
    switch (command.kind) {
      case "Z": return command;
      case "C": return { ...command, c1: applyMatrix(canvas, command.c1), c2: applyMatrix(canvas, command.c2), to: applyMatrix(canvas, command.to) };
      case "A": return command;
      case "M": case "L": return { ...command, to: applyMatrix(canvas, command.to) };
    }
  };
  const mapClip = (clip: SceneClipPath): SceneClipPath => {
    if (outerClips.has(clip.id)) return clip;
    let mapped = mappedClips.get(clip.id);
    if (!mapped) { mapped = { ...clip, commands: clip.commands.map(mapCommand) }; mappedClips.set(clip.id, mapped); }
    return mapped;
  };
  const mappedElements = elements.map((element): SceneElement => ({
    ...element,
    transform: element.transform ? multiplyMatrix(canvas, element.transform) : canvas,
    ...(element.clipChain ? { clipChain: element.clipChain.map(mapClip) } : {}),
    // The edit geometry's frame maps local axis coordinates to the world: the canvas transformation applies to it too.
    ...(element.kind === "Path" && element.pgfplotsAxis ? { pgfplotsAxis: { ...element.pgfplotsAxis, frame: multiplyMatrix(canvas, worldTransform(element.pgfplotsAxis.frame.a, element.pgfplotsAxis.frame.b, element.pgfplotsAxis.frame.c, element.pgfplotsAxis.frame.d, element.pgfplotsAxis.frame.e, element.pgfplotsAxis.frame.f)) } } : {})
  }));
  const list = axisEvaluations.get(context) ?? [];
  for (let index = before; index < list.length; index += 1) {
    const evaluation = list[index];
    if (!evaluation) continue;
    const frameTransform = multiplyMatrix(canvas, evaluation.frameTransform);
    const toWorld = (q: Point): WorldPoint => applyMatrix(frameTransform, p(q.x, q.y));
    list[index] = { ...evaluation, frameTransform, canvas, clip: evaluation.clip ? mapClip(evaluation.clip) : null };
    extendPictureBounds(context, transformBox(evaluation.layout.bbox, toWorld));
    registerAxisNode(context, "current axis", evaluation.layout, toWorld, evaluation.axisId);
    if (evaluation.model.name) registerAxisNode(context, evaluation.model.name, evaluation.layout, toWorld, evaluation.axisId);
  }
  return mappedElements;
}

function evaluateAxisInFrame(source: AxisStatement, context: SemanticContext, host: AxisHost): SceneElement[] {
  const { diagnostics, markFeature } = host;
  const outer = currentFrame(context);
  // Macro definitions in the body (`\pgfmathsetmacro`, `\def`) take effect in
  // order for the plots after them; embedded TikZ is evaluated at `\end{axis}`
  // and sees the final values (behaviour V0, experiment E16). A brace group
  // keeps its definitions to itself (behaviour AB4).
  const bodyGroups = axisBodyGroupPaths(source, context.source);
  const parent = childFrame(outer, { style: axisEntryStyle(context, outer, source.id, source.beginSpan) });
  const plotBindings = new Map<AddPlotStatement, SemanticContextFrame["macroBindings"]>();
  const settingBindings = new Map<AxisBodyItem, SemanticContextFrame["macroBindings"]>();
  pushFrame(context, parent);
  const open: number[] = [];
  try {
    source.body.forEach((item, index) => {
      const path = bodyGroups[index] ?? [];
      while (open.length > path.length || (open.length > 0 && open[open.length - 1] !== path[open.length - 1])) { popFrame(context); open.pop(); }
      while (open.length < path.length) { pushFrame(context, childFrame(currentFrame(context), {})); open.push(path[open.length] ?? -1); }
      const bindings = currentFrame(context).macroBindings;
      if (isAxisDefinition(item)) host.evaluateStatement(item);
      else if (item.kind === "AddPlot") plotBindings.set(item, bindings.fork());
      else {
        if (bodySettingList(item)) settingBindings.set(item, bindings.fork());
        // AB2: TikZ style definitions in the body hold at `\end{axis}`, where plots and embedded TikZ are drawn.
        const tikz = tikzStyleDefinition(item);
        if (tikz) host.evaluateStatement(tikz);
      }
    });
  } finally {
    for (; open.length > 0; open.pop()) popFrame(context);
    popFrame(context);
  }
  // Option values may use macros (`width=\figwidth`), expanded as TikZ options are,
  // and document lengths (`width=0.48\linewidth`, behaviour Y).
  const lengthsEnv = documentLengthEnvironment(context, source.span.from);
  const usedLengths = new Set<string>();
  const withLengths = (list: OptionListAst): OptionListAst => {
    if (!list.raw.includes("\\")) return list;
    const entries = list.entries.map((entry) => {
      if (entry.kind !== "kv") return entry;
      const { text, used } = substituteDocumentLengths(entry.valueRaw, lengthsEnv);
      for (const name of used) usedLengths.add(name);
      return text === entry.valueRaw ? entry : { ...entry, valueRaw: text, raw: `${entry.key}=${text}` };
    });
    return { ...list, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` };
  };
  const expandWith = (list: OptionListAst, bindings: SemanticContextFrame["macroBindings"]): OptionListAst => withLengths(expandOptionListMacros([list], bindings, context.macroTraceCollector ?? undefined)[0] ?? list);
  const expand = (list: OptionListAst): OptionListAst => expandWith(list, outer.macroBindings);
  // AB2: the options of a plot are read when it is drawn (final macro values),
  // except the keys read at the `\addplot` (AB1: `domain=0:\a`).
  const expandPlotOptions = (list: OptionListAst, bindings: SemanticContextFrame["macroBindings"]): OptionListAst => {
    const late = expandWith(list, parent.macroBindings);
    if (bindings === parent.macroBindings || !list.entries.some((entry) => entry.kind !== "unknown" && isSurveyPlotKey(entry.key))) return late;
    const early = expandWith(list, bindings);
    if (early === late || early.entries.length !== late.entries.length) return early;
    const entries = late.entries.map((entry, i) => (entry.kind !== "unknown" && isSurveyPlotKey(entry.key) ? early.entries[i] ?? entry : entry));
    return { ...late, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` };
  };
  const expandedPlotBindings = new Map<AddPlotStatement, SemanticContextFrame["macroBindings"]>();
  const axis: AxisStatement = {
    ...source,
    ...(source.options ? { options: expand(source.options) } : {}),
    body: source.body.map((item) => {
      if (item.kind !== "AddPlot") return item;
      const bindings = plotBindings.get(item) ?? parent.macroBindings;
      const expanded: AddPlotStatement = {
        ...item,
        ...(item.options ? { options: expandPlotOptions(item.options, bindings) } : {}),
        ...(item.extraOptions ? { extraOptions: item.extraOptions.map((extra) => ({ ...extra, options: expandPlotOptions(extra.options, bindings) })) } : {})
      };
      expandedPlotBindings.set(expanded, bindings);
      return expanded;
    })
  };
  const bindingsOf = (statement: AddPlotStatement) => expandedPlotBindings.get(statement) ?? parent.macroBindings;
  const settings = readPgfplotsSettings(context).map(expand);
  if (usedLengths.size > 0 && lengthsEnv.assumption) {
    const values: Record<string, number> = { ...lengthsEnv.lengths };
    const named = [...usedLengths].sort().map((name) => `\\${name} = ${String(values[name])}pt`).join(", ");
    diagnostics.push({ severity: "warning", code: "pgfplots-assumed-document-length", message: `Document lengths are assumed: ${named} (${lengthsEnv.assumption}).`, span: axis.optionsSpan ?? axis.beginSpan });
  }
  // Behaviour AB: settings in the body, with the groups they sit in. The axis
  // and the drawing of the plots use the state at `\end{axis}` (top-level
  // settings only); keys read at an `\addplot` use the settings before it.
  const bodySettingsAll: Array<{ index: number; path: readonly number[]; list: OptionListAst }> = [];
  source.body.forEach((item, index) => {
    const raw = bodySettingList(item);
    if (!raw) return;
    const list = expandWith(raw, settingBindings.get(item) ?? parent.macroBindings);
    const limits = list.entries.filter((entry) => entry.kind !== "unknown" && LIMIT_KEYS.has(entry.key.replace(/^\/pgfplots\//u, "").trim()));
    for (const entry of limits) {
      // AB5: TeX stops with "Sorry, you can't change `xmin' in this context".
      diagnostics.push({ severity: "error", code: "pgfplots-limit-in-axis-body", message: `pgfplots cannot change \`${(entry.kind === "unknown" ? entry.raw : entry.key).replace(/^\/pgfplots\//u, "").trim()}\` inside the axis body (TeX stops with an error); give it to the axis options instead. It is ignored here.`, span: entry.span });
    }
    const entries = list.entries.filter((entry) => !limits.includes(entry));
    bodySettingsAll.push({ index, path: bodyGroups[index] ?? [], list: entries.length === list.entries.length ? list : { ...list, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` } });
  });
  const bodySettings = bodySettingsAll.filter((setting) => setting.path.length === 0).map((setting) => setting.list);
  markFeature("pgfplots_axis", "supported");

  const compat = readPgfplotsCompat(settings);
  // Per axis, so a statement's diagnostics do not depend on what was evaluated before it (incremental replay).
  if (compat === undefined || compatBelow111(compat)) {
    // Behaviour Z9 (manual preliminaries.tex, `compat/labels`, `compat/pgfpoint substitution`;
    // measured on the corpus: pre-1.3 documents differ visibly, 1.3-1.10 ones rarely).
    const pre13 = compat === undefined || compatBelow(compat, 1, 3);
    const what = pre13
      ? "axis labels are placed at a fixed offset from the axis instead of next to the tick labels (they move by a few points), and coordinates without a coordinate system in TikZ commands inside the axis are not `axis cs`"
      : "coordinates without a coordinate system in TikZ commands inside the axis are not `axis cs`; most other output is the same";
    diagnostics.push({
      severity: "warning", code: "pgfplots-compat",
      message: compat === undefined
        ? `No \`\\pgfplotsset{compat=…}\` is in effect, so pgfplots uses its pre-1.3 settings: ${what}. This editor renders compat=1.18 semantics: add \`\\pgfplotsset{compat=1.18}\` to the preamble to match.`
        : `\`compat=${compat}\` is older than 1.11: ${what}. This editor renders compat=1.18 semantics; set \`compat=1.18\` to match.`,
      span: axis.beginSpan
    });
  }

  // Stage 1.
  const model = resolveAxisModel({ axis, settings, bodySettings });
  const logAxis = model.x.mode === "log" || model.y.mode === "log";
  if (logAxis) markFeature("pgfplots_log_axes", "supported");
  const warned = new Set<string>();
  dedupeWarnings(diagnostics, model.unsupported, warned, "unsupported-pgfplots-key", (key) => `pgfplots key \`${key}\` is not supported yet; it is ignored.`);
  for (const bad of model.invalid) {
    diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:${bad.key}`, message: `Cannot read \`${bad.key}=${bad.value}\`; it is ignored.`, span: bad.span });
  }
  dedupeWarnings(diagnostics, (model.ignoredBodyKeys ?? []).filter((use) => !isBodyTextKey(use.key)), warned, "pgfplots-body-tikz-key", (key) => `TikZ key \`${key}\` set with \`\\pgfplotsset\` inside the axis body changes neither the plots nor the axis lines in TeX; it is ignored. Give it to the \`\\addplot\` or the axis options.`);
  // AB1/AB2: the axis model a plot is resolved with: drawing keys from the final
  // state, keys read at the `\addplot` from the settings in effect there.
  const capturedModels = new Map<string, PlotAxisModel>();
  const plotAxisModelAt = (bodyIndex: number): PlotAxisModel | null => {
    if (bodySettingsAll.length === 0) return null;
    const path = bodyGroups[bodyIndex] ?? [];
    const inEffect = bodySettingsAll.filter((setting) => setting.index < bodyIndex && setting.path.every((id, i) => path[i] === id));
    const key = inEffect.map((setting) => setting.index).join(",");
    let captured = capturedModels.get(key);
    if (!captured) {
      captured = plotAxisModel(model, resolveAxisModel({ axis, settings, bodySettings: inEffect.map((setting) => setting.list) }));
      capturedModels.set(key, captured);
    }
    return captured;
  };
  const plotModelAt = (bodyIndex: number, statement: AddPlotStatement, cycleIndex: number, extraLists: readonly OptionListAst[] = []): PlotModel => {
    const captured = plotAxisModelAt(bodyIndex);
    if (!captured) return resolvePlotModel(model, statement, cycleIndex, extraLists);
    const plot = resolvePlotModel(captured, statement, cycleIndex, extraLists);
    // AB2: a body-level `mark` is drawn from the final state, but only for plots that had a mark when they were read.
    const marks = (uses: readonly PgfplotsKeyUse[]) => uses.filter((use) => use.key === "mark").map((use) => use.value ?? "").join("\u0000");
    const capturedMarks = captured.capturedPlotDefaults;
    if (plot.mark !== null && marks(capturedMarks) !== marks(captured.plotDefaults)) {
      const early = resolvePlotModel({ ...captured, plotDefaults: [...captured.plotDefaults.filter((use) => use.key !== "mark"), ...capturedMarks.filter((use) => use.key === "mark")] }, statement, cycleIndex, extraLists);
      if (early.mark === null) plot.mark = null;
    }
    return plot;
  };

  // The axis scope: TikZ keys given to the axis (`thick`, `font=\small`, `xshift`).
  const axisTikz = model.tikzOptions.filter((use) => !use.key.startsWith("/pgf/"));
  const axisScope = resolveStyle(context, parent, parent.style, axisTikz.length > 0 ? [keyUsesToOptionList(axisTikz)] : [], axis.id, axis.span);
  dedupeWarnings(diagnostics, axisScope.diagnostics.filter((code) => code.startsWith("unsupported-option-key:")).map((code) => ({ key: code.slice("unsupported-option-key:".length), span: axis.optionsSpan ?? axis.beginSpan })), warned, "unsupported-pgfplots-key", (key) => `Key \`${key}\` is neither a supported pgfplots key nor a TikZ key; it is ignored.`);
  const axisFrame = childFrame(parent, { style: axisScope.style, transform: axisScope.transform });
  const everyMarkOption = axisTikz.find((use) => /^every mark\/\.(?:append )?style$/u.test(use.key.trim()));
  if (everyMarkOption) {
    // Behaviour AC3 (c-every-mark-axis-scale): given to the axis, `every mark` loses the cycle list's mark fill and its scale in TeX.
    diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-axis-every-mark", message: "`every mark` given to the axis options changes the marks differently in TeX (their fill becomes the line colour and a `scale` is lost); this editor applies it as TikZ would. Set it with `\\tikzset` or `mark options` instead.", span: everyMarkOption.origin.span });
  }
  if (axisFrame.everyNodeStyles.some((layer) => layer.options.entries.some((entry) => entry.kind !== "unknown" && entry.key.trim() === "draw" && (entry.kind === "flag" || entry.valueRaw.trim() !== "none")))) {
    // Behaviour AC4 (pre-every-node-draw): framed text moves the axis labels and the bounding box by the frame's outer sep in TeX.
    diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-every-node-draw", message: "`every node` with `draw` frames every text of the axis; this editor draws the frames but does not move the axis labels and the bounding box by the frames' line width as TeX does (up to about 1pt).", span: axis.beginSpan });
  }
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
    // `/pgf/number format/.cd, precision=3, /tikz/.cd` (pgfkeys `.cd`): relative keys after a
    // `.cd` live in that directory (behaviour Z6; tikzplotlib writes it in tick label styles).
    let directory: string | null = null;
    for (const use of uses) {
      const raw = use.key.trim();
      if (raw.endsWith("/.cd")) { directory = `${raw.slice(0, -"/.cd".length)}/`; continue; }
      const key = !raw.startsWith("/") && directory ? `${directory}${raw}` : raw;
      if (!key.startsWith(NUMBER_FORMAT_PREFIX)) continue;
      numberFormat = applyPgfNumberFormatKey(numberFormat, key.slice(NUMBER_FORMAT_PREFIX.length), use.value).format;
    }
  };
  applyNumberFormat(model.tikzOptions);

  // Stage 2.
  const plotStatements = axis.body.flatMap((item, index) => (item.kind === "AddPlot" ? [{ statement: item, index }] : []));
  const plots: Array<{ model: PlotModel; points: PlotPoint[] | null }> = [];
  // `forget plot` uses the current cycle list entry without advancing it (manual markers-meta.tex, `every legend image post` example).
  let cycleCounter = 0;
  plotStatements.forEach(({ statement, index: bodyIndex }) => {
    const plot = plotModelAt(bodyIndex, statement, cycleCounter);
    if (!plot.forget) cycleCounter += 1;
    dedupeWarnings(diagnostics, plot.unsupported, warned, "unsupported-pgfplots-key", (key) => `pgfplots key \`${key}\` is not supported yet; it is ignored.`);
    for (const bad of plot.invalid) diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:${bad.key}`, message: `Cannot read \`${bad.key}=${bad.value}\`; it is ignored.`, span: bad.span });
    const bindings = bindingsOf(statement);
    const mathEnvironment = { ...plotMathEnvironment(axisFrame, plot), ...(model.x.mode === "log" ? { logSamples: true } : {}) };
    const io = {
      tableKeys: [...(plotAxisModelAt(bodyIndex) ?? model).tableKeys, ...plot.tableKeys],
      readFile: (name: string) => readPgfplotsTableFile(context, name),
      tableMacro: (name: string) => readPgfplotsTableMacro(context, name),
      symbolic: { ...(model.x.symbolic ? { x: model.x.symbolic } : {}), ...(model.y.symbolic ? { y: model.y.symbolic } : {}) }
    };
    const data = cachedPlotData(plotDataCacheKey(statement, plot, context.source, bindings, mathEnvironment, io),
      () => collectPlotData(statement, plot, context.source, (text) => expandMacroBindings(text, bindings), mathEnvironment, io));
    const input = statement.input.kind;
    if (data.kind === "unavailable") {
      markFeature("pgfplots_addplot_table", "supported");
      diagnostics.push({ severity: "warning", code: data.code, message: data.message, span: data.span });
      plots.push({ model: plot, points: null });
      return;
    }
    if (data.kind === "unsupported") {
      markFeature(input === "coordinates" ? "pgfplots_addplot_coordinates" : input === "table" ? "pgfplots_addplot_table" : input === "other" ? "pgfplots_addplot_other_inputs" : "pgfplots_addplot_expression", "unsupported");
      diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-plot", message: `This plot is not drawn: ${data.reason} is not supported yet.`, span: data.span });
      plots.push({ model: plot, points: null });
      return;
    }
    markFeature(input === "coordinates" ? "pgfplots_addplot_coordinates" : input === "table" ? "pgfplots_addplot_table" : "pgfplots_addplot_expression", "supported");
    const unhandled = statement.trailingPath ? unsupportedTrailingItem(statement.trailingPath) : null;
    if (unhandled) {
      diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-trailing-path", message: `Path operation \`${unhandled.raw.trim()}\` after an \`\\addplot\` input is not drawn yet (\`\\closedcycle\`, \`-- (…)\`, \`-- cycle\`, \`node[pos=…]\` and \`coordinate[pos=…]\` are).`, span: unhandled.span });
    }
    for (const note of data.notes ?? []) {
      if (warned.has(note.code)) continue;
      warned.add(note.code);
      diagnostics.push({ severity: "warning", code: note.code, message: note.message, span: note.span });
    }
    // Log directions work in the logarithm (Q1); a point without one is
    // discarded (`unbounded coords=discard`, initially), its neighbours joined (Q2).
    const filtered = filterPlotPoints(data.points, plot);
    const points = logAxis
      ? filtered.flatMap((point) => {
        const x = toInternal(model.x, point.x); const y = toInternal(model.y, point.y);
        if ((Number.isFinite(point.x) && !Number.isFinite(x)) || (Number.isFinite(point.y) && !Number.isFinite(y))) return [];
        return [{ ...point, x, y }];
      })
      : filtered;
    plots.push({ model: plot, points });
    if (plot.handler !== "sharp" || plot.markRepeat !== 1 || plot.markPhase !== 1 || plot.markIndices || model.cycleListShift !== 0 || model.cycleList.join("\n") !== COLOR_CYCLE_LIST.join("\n")) markFeature("pgfplots_plot_styles", "supported");
  });
  for (const item of axis.body) {
    if (item.kind === "PgfplotsExtra") {
      diagnostics.push({ severity: "warning", code: "unsupported-pgfplots-extra", message: "`\\pgfplotsextra` is not evaluated.", span: item.span });
    }
  }

  // U6: stacked plots carry their stacked values from here on (limits, drawing, marks).
  const stacks = stackPlots(plots);
  for (const [index, stacked] of stacks) {
    const plot = plots[index];
    if (plot) plot.points = stacked.points;
  }
  const groups = barGroups(plots.map((plot) => (plot.points ? plot.model : null)), model.bar?.sep ?? model.barShiftAuto, model.bar?.kind.endsWith("interval") ?? false);

  // Stage 3.
  const drawn = plots.flatMap((plot) => (plot.points && !plot.model.forget ? [plot.points] : plot.points ? [plot.points] : []));
  // X2: error bar ends count for the limits (E20 `err-limits`).
  const errorEnds = plots.flatMap((plot) => (plot.points && plot.model.errorBars ? [errorBarSegments(plot.points, plot.model.errorBars).flatMap((bar) => [{ x: bar.to.x, y: bar.to.y, jump: false }])] : []));
  const limitsModel = internalLimitsModel(model);
  for (const bad of limitsModel.invalid) diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:${bad.key}`, message: `\`${bad.key}=${String(bad.value)}\` has no logarithm on a log axis; it is ignored.`, span: axis.optionsSpan ?? axis.beginSpan });
  const limitsResult = computeLimits(limitsModel.model, [...drawn, ...errorEnds], boxSizeWithoutLimits(model));
  if (limitsResult.kind === "inverted") {
    diagnostics.push({ severity: "error", code: "pgfplots-inverted-limits", message: `${limitsResult.axis}min (${String(limitsResult.min)}) is larger than ${limitsResult.axis}max (${String(limitsResult.max)}); pgfplots cannot draw this axis.`, span: axis.optionsSpan ?? axis.beginSpan });
    return [];
  }
  let limits = limitsResult.limits;
  // AA1: a unit vector ratio fixes both unit vectors (and may widen limits).
  const ratioScaling = applyUnitVectorRatio(model, limits);
  if (ratioScaling) {
    const widened = ratioScaling.limits;
    if (widened.xmin !== limits.xmin) limitsResult.tickBase.x = widened.xmin;
    if (widened.ymin !== limits.ymin) limitsResult.tickBase.y = widened.ymin;
    limits = widened;
    model.x = { ...model.x, unit: ratioScaling.unitX };
    model.y = { ...model.y, unit: ratioScaling.unitY };
    model.unitsFromRatio = true;
  }

  // Stage 4 needs the box length (A2): computed by the layout's size model.
  const size = boxSizeOf(model, limits);
  const tickFor = (letter: "x" | "y"): DirectionTicks => {
    const styleUses = flattenStyleEntries(styleLists(model.styles, ["every tick label", `every ${letter} tick label`]), model.styles);
    const before = numberFormat;
    applyNumberFormat(styleUses);
    const tickInput = {
      dir: model[letter], lo: letter === "x" ? limits.xmin : limits.ymin, hi: letter === "x" ? limits.xmax : limits.ymax,
      length: letter === "x" ? size.width : size.height, data: dataTickValues(drawn, letter), numberFormat,
      listBase: limitsResult.tickBase[letter],
      ...(ratioScaling?.shrunk[letter] ? { ratioShrunk: { keepStart: lowerLimitEnlarged(model[letter]) } } : {})
    };
    const result = model[letter].mode === "log" ? computeLogTicks(tickInput) : computeTicks(tickInput);
    const extra = result.kind === "ok" ? computeExtraTicks(tickInput) : [];
    numberFormat = before;
    if (extra === null) diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:extra ${letter} ticks`, message: "Cannot read the extra tick list; no extra ticks are drawn.", span: axis.optionsSpan ?? axis.beginSpan });
    if (result.kind === "invalid") {
      diagnostics.push({ severity: "warning", code: `invalid-pgfplots-value:${letter}tick`, message: `Cannot read the tick list \`${result.what}\`; no ticks are drawn.`, span: axis.optionsSpan ?? axis.beginSpan });
      return { major: [], minor: [], scaleExponent: 0, labelled: false };
    }
    return extra && extra.length > 0 ? { ...result.ticks, extra } : result.ticks;
  };
  const ticks = { x: symbolicTickLabels(tickFor("x"), model.x.symbolic), y: symbolicTickLabels(tickFor("y"), model.y.symbolic) };
  // T1: `xmajorticks=false` / `ticks=none|minor` drop the major ticks with their labels.
  for (const letter of ["x", "y"] as const) {
    if (!model[letter].majorTickMarks) ticks[letter] = { ...ticks[letter], major: [] };
  }
  // R1: a hidden direction (`axis x line=none`, `hide x axis`) has no ticks.
  for (const letter of ["x", "y"] as const) {
    if (model[letter].axisLine === "none") ticks[letter] = { ...ticks[letter], major: [], minor: [], extra: [] };
  }
  // R4: `hide obscured x ticks`: the ticks of a middle line where the other line crosses it.
  for (const letter of ["x", "y"] as const) {
    const other = letter === "x" ? "y" : "x";
    const dir = model[letter];
    if (dir.axisLine !== "middle" || !dir.hideObscuredTicks) continue;
    if (model[other].axisLine === "box" || model[other].axisLine === "none") continue;
    const at = axisLineCoordinate(model, limits, other);
    const range = letter === "x" ? limits.xmax - limits.xmin : limits.ymax - limits.ymin;
    ticks[letter] = { ...ticks[letter], major: ticks[letter].major.filter((tick) => Math.abs(tick.value - at) > 1e-9 * Math.abs(range)) };
  }
  markFeature("pgfplots_ticks", "supported");
  if (model.x.axisLine !== "box" || model.y.axisLine !== "box" || model.x.reverse || model.y.reverse) markFeature("pgfplots_axis_lines", "supported");
  if (plots.some((plot) => plot.points && plot.model.bar)) markFeature("pgfplots_bars", "supported");
  if (axis.body.some((item) => item.kind === "AddPlot" && item.trailingPath)) markFeature("pgfplots_area", "supported");
  if (plots.some((plot) => plot.points && plot.model.errorBars)) markFeature("pgfplots_error_bars", "supported");
  if (model.x.symbolic || model.y.symbolic) markFeature("pgfplots_symbolic_coords", "supported");
  if (plots.some((plot) => plot.points && plot.model.nodesNearCoords !== null)) markFeature("pgfplots_nodes_near_coords", "supported");
  if (usedLengths.size > 0) markFeature("pgfplots_document_lengths", "supported");
  if (model.x.label || model.y.label || model.title) markFeature("pgfplots_axis_descriptions", "supported");
  if (axis.body.some((item) => item.kind !== "AddPlot" && item.kind !== "AddLegendEntry" && item.kind !== "AddLegendImage" && item.kind !== "Legend" && item.kind !== "PgfplotsExtra" && item.kind !== "PgfplotsSet")) markFeature("pgfplots_axis_coordinates", "supported");

  // Label measurement through the node pipeline.
  // AB3: a colour or font set by a TikZ key at the top level of the body reaches all text the axis typesets.
  const bodyColour = bodyTextKeys(source, bodyGroups);
  const textStyle = bodyColour ? resolveStyle(context, axisFrame, axisFrame.style, [parseOptionListRaw(`[${bodyColour}]`)], axis.id, axis.span).style : axisFrame.style;
  const labelFrame = childFrame(axisFrame, { pictureSizeRelevant: false, style: textStyle });
  const labelStatements = new Map<LabelRequest, PathStatement | null>();
  const evaluateLabel = (request: LabelRequest, at: Point, emit: boolean, frame: SemanticContextFrame = labelFrame): { elements: SceneElement[]; probe: NodeGeometryProbe | null } => {
    let statement = labelStatements.get(request);
    if (statement === undefined) {
      statement = buildLabelStatement(request, model, axis);
      labelStatements.set(request, statement);
    }
    if (!statement) return { elements: [], probe: null };
    const shift = rotatedOffsets.get(labelKey(request));
    const positioned = withLabelPosition(statement, shift ? { x: at.x + shift.x, y: at.y + shift.y } : at);
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
    // Descriptions and the legend are sub-selections of the axis; their text keeps a span into the document when it is written there.
    const textSpan = request.textSpan ?? axisDescriptionTextSpan(request.role, model, source, context.source);
    const textSpanOk = textSpan !== undefined && context.source.slice(textSpan.from, textSpan.to) === request.text;
    const sourceId = axisSubSelectionId(axis.id, request.role);
    return { elements: elements.map((element) => attributeTo(element, sourceId, partSpan(request.role), textSpanOk ? textSpan : undefined)), probe };
  };
  // Each part points at its own source (the key or legend command), so editing identities tell them apart.
  const legendCommand = source.body.find((item) => item.kind === "AddLegendEntry" || item.kind === "Legend");
  const inDocument = (span: Span | undefined): span is Span => span !== undefined && span.from >= axis.span.from && span.to <= axis.span.to;
  const partSpan = (role: LabelRequest["role"]): Span => {
    if (role === "xlabel" || role === "ylabel" || role === "title") {
      const span = role === "xlabel" ? model.x.label?.span : role === "ylabel" ? model.y.label?.span : model.title?.span;
      return inDocument(span) ? span : axis.beginSpan;
    }
    if (role === "legend" || role === "legend-entry") return legendCommand?.span ?? axis.optionsSpan ?? axis.beginSpan;
    return axis.span;
  };
  // T4: a rotated tick label without its own anchor hangs by the edge of its
  // rotated box's canvas bounding box (outer sep included) facing the axis.
  const rotatedOffsets = new Map<string, Point>();
  const measure = (request: LabelRequest): LabelGeometry | null => {
    const { probe } = evaluateLabel(request, request.at, false);
    if (!probe) return null;
    const geometry = probeGeometry(probe, toLocal);
    const side = /anchor=(north|south|east|west)$/u.exec(request.placement)?.[1];
    if (!side || !isTickRole(request.role) || !rotatedWithoutAnchor(request, model)) return geometry;
    const corners = ["north east", "north west", "south east", "south west"].map((name) => geometry.anchors[name] ?? request.at);
    const xs = corners.map((q) => q.x); const ys = corners.map((q) => q.y);
    // The node was placed by its centre (placement anchor=center): offset it so the facing bbox edge meets `at`.
    const c = geometry.anchors.center ?? request.at;
    const offset = side === "north" ? { x: 0, y: -(Math.max(...ys) - c.y) } : side === "south" ? { x: 0, y: c.y - Math.min(...ys) }
      : side === "east" ? { x: -(Math.max(...xs) - c.x), y: 0 } : { x: c.x - Math.min(...xs), y: 0 };
    rotatedOffsets.set(labelKey(request), offset);
    const again = evaluateLabel(request, request.at, false).probe;
    return again ? probeGeometry(again, toLocal) : geometry;
  };

  const labelStyles: Record<LabelRole, OptionListAst[]> = {
    xtick: styleLists(model.styles, ["every tick label", "every x tick label"]),
    ytick: styleLists(model.styles, ["every tick label", "every y tick label"]),
    xextra: styleLists(model.styles, ["every tick label", "every x tick label"]),
    yextra: styleLists(model.styles, ["every tick label", "every y tick label"]),
    xscale: styleLists(model.styles, ["every tick label", "every x tick label", "every x tick scale label"]),
    yscale: styleLists(model.styles, ["every tick label", "every y tick label", "every y tick scale label"]),
    xlabel: styleLists(model.styles, ["every axis label", "every axis x label"]),
    ylabel: styleLists(model.styles, ["every axis label", "every axis y label"]),
    title: styleLists(model.styles, ["every axis title"]),
    legend: [],
    "legend-entry": [],
    "node near coord": []
  };

  // Plot styles (needed for marks in F1 and for emission). AC2: TikZ's `every
  // path` is applied when each path starts, after the plot's style (which
  // pgfplots sets as a scope), so it wins over it; marks are not paths and
  // keep the plot's style.
  const everyPath = everyPathLists(context, axisFrame);
  const withEveryPath = (style: ResolvedStyle, sourceId: string, span: Span): ResolvedStyle => everyPath.length === 0 ? style : resolveStyle(context, axisFrame, style, everyPath, sourceId, span).style;
  const plotBaseStyles = plots.map((plot) => {
    if (!plot.points) return null;
    const resolved = resolveStyle(context, axisFrame, drawBase(axisScope.style), plot.model.pathKeys.length > 0 ? [keyUsesToOptionList(plot.model.pathKeys)] : [], plot.model.statement.id, plot.model.statement.span);
    dedupeWarnings(diagnostics, resolved.diagnostics.filter((code) => code.startsWith("unsupported-option-key:")).map((code) => ({ key: code.slice("unsupported-option-key:".length), span: plot.model.statement.optionsSpan ?? plot.model.statement.span })), warned, "unsupported-pgfplots-key", (key) => `Key \`${key}\` is neither a supported pgfplots key nor a TikZ key; it is ignored.`);
    return resolved.style;
  });
  const plotStyles = plotBaseStyles.map((style, index) => (style ? withEveryPath(style, plots[index]?.model.statement.id ?? axis.id, plots[index]?.model.statement.span ?? axis.span) : null));
  const everyMark = everyMarkLists(context, axisFrame);
  const marksFor = (plotModel: PlotModel, base: ResolvedStyle, warn: boolean): LegendMarks | null => {
    const mark = plotModel.mark;
    if (mark === null) return null;
    if (!isPlotMarkName(mark)) {
      if (warn) diagnostics.push({ severity: "warning", code: `unknown-plot-mark:${mark}`, message: `PGF defines no plot mark named \`${mark}\`; no marks are drawn.`, span: plotModel.statement.span });
      return null;
    }
    const markBase: ResolvedStyle = { ...base, stroke: base.stroke ?? base.textColor ?? "black", fill: base.fill ?? base.textColor ?? "black", drawExplicit: true, markerStart: null, markerEnd: null };
    // AC3: TikZ's `every mark` first, then the plot's mark options (pgfplots appends them to it).
    const lists = [...everyMark, ...(plotModel.markKeys.length > 0 ? [keyUsesToOptionList(plotModel.markKeys)] : [])];
    const resolved = resolveStyle(context, axisFrame, markBase, lists, plotModel.statement.id, plotModel.statement.span);
    const style = { ...resolved.style, stroke: resolved.style.stroke ?? resolved.style.textColor ?? markBase.stroke, fill: resolved.style.fill ?? resolved.style.textColor ?? markBase.fill };
    // `mark options={scale=…}` scales the mark's geometry (PGF transforms the mark; line widths stay).
    const everyMarkScale = everyMark.flatMap((list) => list.entries).reduce((f, entry) => (entry.kind === "kv" && entry.key.trim() === "scale" ? f * (readPgfNumber(entry.valueRaw) ?? 1) : f), 1);
    const markScale = plotModel.markKeys.reduce((f, use) => (use.key === "scale" ? f * (readPgfNumber(use.value ?? "") ?? 1) : f), everyMarkScale);
    const primitives = plotMarkPrimitives(mark, { size: plotModel.markSize ?? 2, strokeColor: style.stroke ?? "black", fillColor: style.fill ?? "black" })
      ?.map((primitive) => (primitive.kind === "path" && markScale !== 1 ? { ...primitive, segments: primitive.segments.map((seg) => scaleMarkSegment(seg, markScale)) } : primitive));
    if (!primitives || primitives.some((primitive) => primitive.kind !== "path")) {
      if (warn) diagnostics.push({ severity: "warning", code: `unsupported-plot-mark:${mark}`, message: `The \`${mark}\` mark is not drawn in axes yet.`, span: plotModel.statement.span });
      return null;
    }
    return { style, primitives: primitives.flatMap((primitive) => (primitive.kind === "path" ? [primitive] : [])) };
  };
  const markStyles = plots.map((plot, index) => {
    const base = plotBaseStyles[index];
    if (!plot.points || !base) return null;
    return marksFor(plot.model, base, true);
  });

  /**
   * X3 - `nodes near coords`: a node per point, anchored `south` at the point
   * (or at the bar's end, shifted with the bar) for vertical alignment, `west`
   * for horizontal (xbar); `north`/`east` for negative values. The text is
   * `$\pgfmathprintnumber{meta}$` (meta = y, x for xbar) or the symbolic meta
   * as written, in the plot's colour, `every node near coord` applied
   * (fixture bars-nodes-near).
   */
  const nodesNearCoords = (plotModel: PlotModel, points: readonly PlotPoint[], barTops: Point[] | null): SceneElement[] => {
    const horizontal = plotModel.nodesNearCoordsAlign === "horizontal" || (plotModel.nodesNearCoordsAlign === "auto" && plotModel.bar?.kind.startsWith("x") === true);
    const colorKeys = plotModel.pathKeys.filter((use) => use.key === "color" || (use.value === null && isColorName(use.key)));
    const styles = [...(colorKeys.length > 0 ? [keyUsesToOptionList(colorKeys)] : []), ...(plotModel.nodeNearCoordKeys.length > 0 ? [keyUsesToOptionList(plotModel.nodeNearCoordKeys)] : [])];
    const symbolic = plotModel.pointMeta === "explicit symbolic";
    const out: SceneElement[] = [];
    points.forEach((point, index) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const value = plotModel.bar?.kind.startsWith("x") ? point.x : point.y;
      const metaValue = plotModel.pointMeta === "explicit" && point.meta !== undefined ? Number(point.meta) : value;
      const meta = symbolic ? point.meta ?? "" : `$${formatPgfNumber(metaValue, numberFormat).tex}$`;
      const template = plotModel.nodesNearCoords ?? "";
      const text = template === "\\pgfmathprintnumber{\\pgfplotspointmeta}" ? meta : template.split("\\pgfplotspointmeta").join(symbolic ? meta : String(metaValue));
      const at = barTops?.[index] ?? mapPoint(point.x, point.y);
      const negative = value < 0;
      const anchor = horizontal ? (negative ? "east" : "west") : (negative ? "north" : "south");
      const request: LabelRequest = { role: "node near coord", text, styles, placement: `anchor=${anchor}`, at };
      out.push(...evaluateLabel(request, at, true).elements);
    });
    return out;
  };

  /**
   * X2 - error bars, under the clip after the plot's line: per point, x then
   * y, plus then minus, a stroked bar from the point (plot colour and width,
   * `error bar style`) and the error mark at its end, rotated by the bar's
   * direction plus its `rotate` (initially 90), so `-` lies across the bar (E20 `err-*`).
   */
  const errorBarElements = (plotModel: PlotModel, points: readonly PlotPoint[], plotStyle: ResolvedStyle, markBaseStyle: ResolvedStyle, statement: AddPlotStatement): SceneElement[] => {
    const bars = plotModel.errorBars;
    if (!bars) return [];
    const out: SceneElement[] = [];
    const base: ResolvedStyle = { ...plotStyle, fill: null, markerStart: null, markerEnd: null };
    const barStyle = bars.barStyle.length > 0 ? resolveStyle(context, axisFrame, base, [keyUsesToOptionList(bars.barStyle)], statement.id, statement.span).style : base;
    const markParts = splitTopLevelList(bars.markOptions).filter((part) => part.length > 0);
    const rotateText = markParts.find((part) => /^rotate\s*=/u.test(part));
    const markRotate = rotateText ? readPgfNumber(rotateText.replace(/^rotate\s*=/u, "")) ?? 0 : 0;
    const markOther = markParts.filter((part) => part !== rotateText);
    // AC2: the error mark is a mark, not a path: `every path` does not reach it.
    const markStyleBase: ResolvedStyle = { ...markBaseStyle, markerStart: null, markerEnd: null, stroke: markBaseStyle.stroke ?? "black", fill: markBaseStyle.stroke ?? "black", drawExplicit: true };
    const markStyle = markOther.length > 0 ? resolveStyle(context, axisFrame, markStyleBase, [parseOptionListRaw(`[${markOther.join(",")}]`)], statement.id, statement.span).style : markStyleBase;
    const sizeText = markOther.find((part) => /^mark size\s*=/u.test(part));
    const markSize = sizeText ? readLength(sizeText.replace(/^mark size\s*=/u, "")) ?? 2 : plotModel.markSize ?? 2;
    const primitives = bars.mark && isPlotMarkName(bars.mark) ? plotMarkPrimitives(bars.mark, { size: markSize, strokeColor: markStyle.stroke ?? "black", fillColor: markStyle.fill ?? markStyle.stroke ?? "black" }) : null;
    errorBarSegments(points, bars).forEach((bar, n) => {
      const from = mapPoint(bar.from.x, bar.from.y);
      const to = mapPoint(bar.to.x, bar.to.y);
      const path = makePath(statement.id, `error:${String(n)}`, { ...barStyle, fill: null }, axisFrame.styleChain, statement.span);
      path.commands = [{ kind: "M", to: toWorld(from) }, { kind: "L", to: toWorld(to) }];
      path.clipChain = [...contentClip];
      path.pictureSizeRelevant = false;
      out.push(path);
      if (!primitives) return;
      // PGF's `-` runs from (s,0) to (-s,0); the mark turns with the bar, then by its own `rotate` (E20).
      const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + markRotate;
      const rad = (angle * Math.PI) / 180;
      const cos = Math.cos(rad); const sin = Math.sin(rad);
      const rotate = (x: number, y: number): Point => ({ x: to.x + x * cos - y * sin, y: to.y + x * sin + y * cos });
      primitives.forEach((primitive, index) => {
        if (primitive.kind !== "path") return;
        const markPath = makePath(statement.id, `error:${String(n)}:mark:${String(index)}`, { ...markStyle, stroke: primitive.stroke, fill: primitive.fill, drawExplicit: primitive.stroke !== null }, axisFrame.styleChain, statement.span);
        markPath.commands = primitive.segments.map((segment): ScenePathCommand => {
          switch (segment.op) {
            case "M": return { kind: "M", to: toWorld(rotate(segment.x, segment.y)) };
            case "L": return { kind: "L", to: toWorld(rotate(segment.x, segment.y)) };
            case "C": return { kind: "C", c1: toWorld(rotate(segment.x1, segment.y1)), c2: toWorld(rotate(segment.x2, segment.y2)), to: toWorld(rotate(segment.x, segment.y)) };
            case "Z": return { kind: "Z" };
          }
        });
        markPath.clipChain = [...contentClip];
        markPath.pictureSizeRelevant = false;
        out.push(markPath);
      });
    });
    return out;
  };

  /** W6: `node[pos=…]{…}` and `coordinate[pos=…] (name)` after the input sit on the plot path, by arc length in data units (E20 `node-pos`). */
  const trailingNodes = (trailing: PathStatement, plotModel: PlotModel, points: readonly PlotPoint[]): SceneElement[] => {
    const out: SceneElement[] = [];
    const colorKeys = plotModel.pathKeys.filter((use) => use.key === "color" || (use.value === null && isColorName(use.key)));
    trailing.items.forEach((item, index) => {
      if (item.kind !== "Node" && item.kind !== "CoordinateOperation") return;
      const optionsRaw = item.kind === "Node" ? item.options?.raw ?? "" : item.options?.raw ?? "";
      const entries = item.options?.entries ?? [];
      const posEntry = entries.find((entry) => entry.kind === "kv" && entry.key.trim() === "pos");
      const pos = posEntry?.kind === "kv" ? readPgfNumber(posEntry.valueRaw) : 1;
      const at = pointAlong(points, pos ?? 1);
      if (!at) return;
      const rest = entries.filter((entry) => entry !== posEntry).map((entry) => entry.raw).join(",");
      const keys = [...colorKeys.map((use) => (use.value === null ? use.key : `${use.key}=${use.value}`)), rest].filter((text) => text.length > 0).join(",");
      void optionsRaw;
      const name = item.kind === "Node" ? item.name : item.name;
      const text = item.kind === "Node" ? item.text : "";
      const statementSource = item.kind === "Node"
        ? `\\begin{tikzpicture}\\node[${keys}]${name ? ` (${name})` : ""} at (${String(at.x)},${String(at.y)}) {${text}};\\end{tikzpicture}`
        : `\\begin{tikzpicture}\\coordinate${name ? ` (${name})` : ""} at (${String(at.x)},${String(at.y)});\\end{tikzpicture}`;
      const parsed = parseTikz(statementSource, { recover: true });
      const synthetic = parsed.figure.body.find((entry): entry is PathStatement => entry.kind === "Path");
      if (!synthetic) return;
      const relabeled = relabel(synthetic, `${trailing.id}:pos:${String(index)}`, item.span);
      out.push(...host.evaluateStatement(relabeled).map((element) => ({ ...element, clipChain: element.clipChain && element.clipChain.length > 0 ? element.clipChain : [...contentClip] })));
    });
    return out;
  };

  const insideBox = (q: Point, box: { x0: number; y0: number; x1: number; y1: number }) => {
    const eps = 1e-6 * Math.max(1, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
    return q.x >= box.x0 - eps && q.x <= box.x1 + eps && q.y >= box.y0 - eps && q.y <= box.y1 + eps;
  };

  const tickStyleNames = (letter: "x" | "y", kind: "major" | "minor") => ["every tick", `every ${kind} tick`, `every ${letter} tick`, `every ${kind} ${letter} tick`];
  const elementStyle = (names: string[]): ResolvedStyle => {
    const uses = flattenStyleEntries(styleLists(model.styles, names), model.styles);
    // AC2: `every path` first, then the element's own style (pgfplots gives it as path options).
    const lists = [...everyPath, ...(uses.length > 0 ? [keyUsesToOptionList(uses)] : [])];
    return resolveStyle(context, axisFrame, drawBase(axisScope.style), lists, axis.id, axis.span).style;
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
      const lo = map(limits.xmin, limits.ymin); const hi = map(limits.xmax, limits.ymax);
      // Reversed directions (S1) swap the corners.
      const area = { x0: Math.min(lo.x, hi.x), y0: Math.min(lo.y, hi.y), x1: Math.max(lo.x, hi.x), y1: Math.max(lo.y, hi.y) };
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
          if (model.clip && !insideBox(q, area)) continue;
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
  // `axis background/.style={fill=white}`: the box, painted first (layer axis background, manual layers.tex).
  const backgroundUses = flattenStyleEntries(styleLists(model.styles, ["axis background"]), model.styles);
  if (backgroundUses.length > 0) {
    const base: ResolvedStyle = { ...axisScope.style, stroke: null, fill: null, drawExplicit: false };
    const background = resolveStyle(context, axisFrame, base, [keyUsesToOptionList(backgroundUses)], axis.id, axis.span).style;
    if ((background.fill && background.fill !== "none") || (background.stroke && background.stroke !== "none")) {
      decorations.push(axisPath("background", background, [
        { kind: "M", to: toWorld({ x: x0, y: y0 }) }, { kind: "L", to: toWorld({ x: x1, y: y0 }) },
        { kind: "L", to: toWorld({ x: x1, y: y1 }) }, { kind: "L", to: toWorld({ x: x0, y: y1 }) }, { kind: "Z" }
      ]));
    }
  }
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
  // Extra ticks are painted after all major tick labels: x marks, x labels, y marks, y labels (tick-extra).
  const extraMarks: Record<"x" | "y", SceneElement[]> = { x: [], y: [] };
  const extraLabels: Record<"x" | "y", SceneElement[]> = { x: [], y: [] };
  for (const letter of ["x", "y"] as const) {
    const segments = layout.extraTickMarks[letter];
    if (segments.length === 0) continue;
    const style = elementStyle([...tickStyleNames(letter, "major"), "every extra tick", `every extra ${letter} tick`]);
    extraMarks[letter].push(axisPath(`ticks:${letter}:extra`, style, segmentsToCommands(segments, toWorld)));
  }
  // C2 / R2: the axis lines, each with its `every outer/inner x axis line` style (arrow tips included).
  let tipBounds: Box | null = null;
  for (const [index, line] of layout.axisLines.entries()) {
    const names = line.letter === "both" ? ["every outer x axis line", "every outer y axis line"] : [`every ${line.inner ? "inner" : "outer"} ${line.letter} axis line`];
    const style = elementStyle(names);
    const commands: ScenePathCommand[] = line.commands.map((c) => (c.op === "Z" ? { kind: "Z" } : { kind: c.op, to: toWorld(c.p) }));
    const path = axisPath(index === 0 && line.letter === "both" ? "box" : `axis-line:${line.letter}:${String(index)}`, style, commands);
    decorations.push(path);
    if (style.markerStart || style.markerEnd) {
      for (const tip of renderPathWithArrows(path).tipPaths) {
        for (const command of tip.commands) {
          if (command.kind === "Z") continue;
          const q = toLocal(command.to);
          tipBounds = unionBox(tipBounds, { minX: q.x, minY: q.y, maxX: q.x, maxY: q.y });
        }
      }
    }
  }
  // F1: arrow tips count with their geometric extent (E21: the tip at the box corner).
  if (tipBounds) layout = extendAxisLayout(layout, tipBounds);
  const labelRecords: AxisEvaluation["labels"] = [];
  const tickLabelElements: SceneElement[] = [];
  const descriptionElements: SceneElement[] = [];
  for (const placed of layout.labels) {
    const { elements: labelElements, probe } = evaluateLabel(placed.request, placed.request.at, true);
    labelRecords.push({ role: placed.request.role, ...(placed.request.tickPosition === undefined ? {} : { tickPosition: placed.request.tickPosition }), probe, text: placed.request.text });
    const role = placed.request.role;
    (role === "xlabel" || role === "ylabel" || role === "title" ? descriptionElements : role === "xextra" ? extraLabels.x : role === "yextra" ? extraLabels.y : tickLabelElements).push(...labelElements);
  }
  tickLabelElements.push(...extraMarks.x, ...extraLabels.x, ...extraMarks.y, ...extraLabels.y);

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
    axisBasis: {
      x: worldVector(pt(layout.map.xUnit.x), pt(0)), y: worldVector(pt(0), pt(layout.map.yUnit.y)),
      // Bare coordinates in a log direction are data values: the resolver takes their logarithm (design 4.2).
      ...(logAxis ? { log: { ...(model.x.mode === "log" ? { x: internalBase(model.x) } : {}), ...(model.y.mode === "log" ? { y: internalBase(model.y) } : {}) } } : {})
    },
    clipChain: contentClip,
    pictureSizeRelevant: model.clip ? false : parent.pictureSizeRelevant,
    ...(bodyColour ? { style: textStyle } : {})
  });
  const content: SceneElement[] = [];
  const markElements: SceneElement[] = [];
  const previousSystems = context.coordinateSystems;
  context.coordinateSystems = new Map([...(previousSystems ?? []), ...axisCoordinateSystems(layout, toWorld, model)]);
  pushFrame(context, contentFrame);
  try {
    let plotIndex = 0;
    let stackedContentIndex: number | null = null;
    for (const item of axis.body) {
      if (item.kind === "AddPlot") {
        const plot = plots[plotIndex];
        const style = plotStyles[plotIndex];
        const marks = markStyles[plotIndex];
        plotIndex += 1;
        if (!plot?.points || !style) continue;
        const statement = plot.model.statement;
        pushPlotPointHandles(item, context);
        const bar = plot.model.bar;
        let barTops: Point[] | null = null;
        if (bar && !plot.model.onlyMarks) {
          // U2: one path per plot, a closed rectangle per bar, filled and stroked as the plot style says.
          const stack = stacks.get(plotIndex - 1);
          const group = groups.get(plotIndex - 1);
          const rects = barRects(plot.points, bar, {
            mapX: (x) => mapPoint(x, 0).x, mapY: (y) => mapPoint(0, y).y,
            unitX: layout.map.xUnit.x, unitY: layout.map.yUnit.y, limits: layout.limits,
            log: { x: model.x.mode === "log", y: model.y.mode === "log" }
          }, { ...(stack ? { base: stack.base } : {}), ...(group ? { group } : {}) });
          barTops = rects.map((rect) => (rect.vertical ? { x: (rect.x0 + rect.x1) / 2, y: rect.y1 } : { x: rect.x1, y: (rect.y0 + rect.y1) / 2 }));
          const commands: ScenePathCommand[] = rects.flatMap((rect): ScenePathCommand[] => {
            const corners = barCorners(rect).map((corner) => toWorld(corner));
            return [
              { kind: "M", to: corners[0] ?? toWorld({ x: 0, y: 0 }) },
              ...corners.slice(1).map((to): ScenePathCommand => ({ kind: "L", to })),
              { kind: "Z" }
            ];
          });
          if (commands.length > 0) {
            const path = makePath(statement.id, "bars", style, axisFrame.styleChain, statement.span);
            path.commands = commands;
            path.clipChain = [...contentClip];
            path.pictureSizeRelevant = false;
            // U6: stacked plots are painted last plot first (E19 `stacked`).
            if (plot.model.stack) {
              const first: number = stackedContentIndex ?? content.length;
              stackedContentIndex = first;
              content.splice(first, 0, path);
            } else content.push(path);
          }
        } else if (!plot.model.onlyMarks) {
          const stackIndex = plotIndex - 1;
          // P1: the plot handler (sharp, smooth, const, jump, comb) on the canvas points.
          const canvas = plot.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).map((point) => ({ p: mapPoint(point.x, point.y), jump: point.jump }));
          const commands: ScenePathCommand[] = plotHandlerCommands(canvas, plot.model.handler, {
            tension: plot.model.tension,
            combBase: (q) => (plot.model.handler === "xcomb" ? { x: mapPoint(0, 0).x, y: q.y } : { x: q.x, y: mapPoint(0, 0).y })
          }).map((c): ScenePathCommand => (c.kind === "C" ? { kind: "C", c1: toWorld(c.c1), c2: toWorld(c.c2), to: toWorld(c.to) } : { kind: c.kind, to: toWorld(c.to) }));
          if (statement.trailingPath) {
            // W1-W4: \closedcycle and path operations continue the plot's path.
            const previous = stacks.get(stackIndex) ? previousStackedPoints(plots, stacks, stackIndex) : null;
            commands.push(...trailingCommands(statement.trailingPath, plot.points, previous, plot.model.stack, layout, mapPoint, toWorld, { x: model.x.mode === "log", y: model.y.mode === "log" }));
          }
          if (commands.some((command) => command.kind !== "M")) {
            const path = makePath(statement.id, "line", style, axisFrame.styleChain, statement.span);
            path.commands = commands;
            path.clipChain = [...contentClip];
            path.pictureSizeRelevant = false;
            if (plot.model.stack) {
              const first: number = stackedContentIndex ?? content.length;
              stackedContentIndex = first;
              content.splice(first, 0, path);
            } else content.push(path);
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
            // Behaviour Z3: with `clip=false` marks outside the box are drawn too.
            if (model.clip && !insideBox(q, layout.box)) continue;
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
        if (plot.model.errorBars) content.push(...errorBarElements(plot.model, plot.points, style, plotBaseStyles[plotIndex - 1] ?? style, statement));
        if (statement.trailingPath) content.push(...trailingNodes(statement.trailingPath, plot.model, plot.points));
        if (plot.model.nodesNearCoords !== null) markElements.push(...nodesNearCoords(plot.model, plot.points, barTops));
        continue;
      }
      if (item.kind === "AddLegendEntry" || item.kind === "AddLegendImage" || item.kind === "Legend" || item.kind === "PgfplotsExtra" || item.kind === "PgfplotsSet" || item.kind === "TikzStyle") continue;
      if (item.kind === "TikzSet") {
        // Its style definitions and `/pgfplots/` keys were applied above (AB); the rest acts in order on embedded TikZ.
        const entries = item.optionList.entries.filter((entry) => entry.kind === "unknown" || (!entry.key.trim().startsWith("/pgfplots/") && !/\/\.[a-z ]+$/u.test(entry.key.trim())));
        if (entries.length > 0) host.evaluateStatement({ ...item, optionList: { ...item.optionList, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` } });
        continue;
      }
      // Applied in order before the plots were read (above); `\label` only names the plot for `\ref`.
      if (isAxisDefinition(item) || isLabelCommand(item)) continue;
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
    axis.body.forEach((item, bodyIndex) => {
      if (item.kind === "AddPlot") {
        const plot = plots[plotIndex];
        plotIndex += 1;
        if (!plot || plot.model.forget) return;
        cycle = plot.model.cycleIndex + 1;
        legendImages.push({ plot: plotModelAt(bodyIndex, item, plot.model.cycleIndex, legendImagePost), sourceId: item.id, span: item.span });
      } else if (item.kind === "AddLegendImage") {
        // `\addlegendimage{opts}` acts as `\addplot[opts]` for the legend only; the plot index does not advance (manual).
        const synthetic: AddPlotStatement = { kind: "AddPlot", id: item.id, axisId: item.axisId, plotIndex: -1, span: item.span, commandSpan: item.span, dimension: 2, increment: false, options: item.options, input: { kind: "other", span: item.span, name: "legend image", nameSpan: item.span, raw: "" }, terminated: true };
        legendImages.push({ plot: plotModelAt(bodyIndex, synthetic, cycle, legendImagePost), sourceId: item.id, span: item.span });
      }
    });
  }
  const legendResult = emitLegend({
    axis, model, images: legendImages, diagnostics,
    // AC2: a legend image is a path drawn with the plot's style; `every path` wins over it, and its marks follow it.
    pathStyle: (plotModel, legendKeys) => withEveryPath(resolveStyle(context, axisFrame, drawBase(axisScope.style), [...legendKeys, ...plotModel.pathKeys].length > 0 ? [keyUsesToOptionList([...legendKeys, ...plotModel.pathKeys])] : [], plotModel.statement.id, plotModel.statement.span).style, plotModel.statement.id, plotModel.statement.span),
    marks: (plotModel, base) => marksFor(plotModel, base, false),
    frameWith: (uses) => uses.length === 0 ? labelFrame : childFrame(labelFrame, { style: resolveStyle(context, labelFrame, labelFrame.style, [keyUsesToOptionList(uses)], axis.id, axis.span).style }),
    node: (request, frame, emit) => {
      const { elements: nodeElements, probe } = evaluateLabel(request, request.at, emit, frame);
      return { elements: nodeElements, probe, geometry: probe ? probeGeometry(probe, toLocal) : null };
    },
    path: (sourceId, itemId, style, span, commands) => {
      const path = makePath(sourceId, itemId, style, axisFrame.styleChain, span);
      // Legend images belong to the legend (a sub-selection of the axis), not to their plot.
      path.sourceRef = { ...path.sourceRef, sourceId: axisSubSelectionId(axis.id, "legend") };
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

  // The editing geometry rides on a carrier that paints nothing, so it does not depend on
  // what the axis draws (`hide axis`, `axis lines=none`, an empty or clipped axis).
  const editCarrier = makePath(axis.id, "edit", { ...axisScope.style, stroke: null, fill: null, drawExplicit: false, markerStart: null, markerEnd: null }, axisFrame.styleChain, axis.span);
  editCarrier.commands = [];
  editCarrier.editCarrier = true;
  editCarrier.pictureSizeRelevant = false;
  editCarrier.pgfplotsAxis = axisEditInfo(axis.id, model, layout, frameTransform, legendResult ? { bbox: legendResult.bbox, anchor: legendResult.anchor } : null, parent.axisBasis);
  elements.unshift(editCarrier);
  const legendAssociation = associateLegend(axisLegendEntries({ axis, model, expand: (text) => expandMacroBindings(text, parent.macroBindings) }),
    legendImages.map((image) => ({ sourceId: image.sourceId, kind: image.plot.statement.plotIndex < 0 ? "image" as const : "plot" as const })));
  const evaluation: AxisEvaluation = { axisId: axis.id, model, layout, frameTransform, labels: labelRecords, clip: model.clip ? clip : null, legend: legendAssociation };
  const list = axisEvaluations.get(context) ?? [];
  list.push(evaluation);
  axisEvaluations.set(context, list);
  return elements;
}

/** The document lengths for an axis starting at `from` (behaviour Y): the host's, else the class's; registers set before it. */
function documentLengthEnvironment(context: SemanticContext, from: number): DocumentLengthEnvironment {
  const known = context.documentLengths ?? {};
  const fromClass = documentClassLengths(context.source);
  const lengths = { ...fromClass.lengths, ...known };
  // The host's text width also fixes the line and column widths, unless it gave them.
  if (known.textwidth !== undefined) {
    lengths.linewidth = known.linewidth ?? known.textwidth;
    lengths.columnwidth = known.columnwidth ?? known.textwidth;
  }
  const registers = scanLengthRegisters(context.source, from, lengths);
  const assumption = known.textwidth === undefined ? fromClass.assumption : undefined;
  return { lengths, registers, ...(assumption ? { assumption } : {}) };
}

function isColorName(name: string): boolean {
  try {
    return /^#[0-9a-f]{6}$/iu.test(normalizeColor(name));
  } catch {
    return false;
  }
}

/** X1: tick labels on a symbolic axis are the names (text), the one at the nearest position (E20 `symbolic-partial`). */
function symbolicTickLabels(ticks: DirectionTicks, names: readonly string[] | undefined): DirectionTicks {
  if (!names) return ticks;
  return {
    ...ticks,
    scaleExponent: 0,
    major: ticks.major.map((tick) => {
      const name = names[Math.floor(tick.value + 0.5)];
      return { ...tick, label: name ?? "" };
    })
  };
}

/** X2: the error bars of a plot in data units: x before y, plus before minus, per point. */
function errorBarSegments(points: readonly PlotPoint[], bars: NonNullable<PlotModel["errorBars"]>): Array<{ from: Point; to: Point }> {
  const out: Array<{ from: Point; to: Point }> = [];
  for (const point of points) {
    for (const axisLetter of ["x", "y"] as const) {
      const d = bars[axisLetter];
      if (d.dir === "none") continue;
      const v = axisLetter === "x" ? point.x : point.y;
      const amount = (side: "Plus" | "Minus"): number | null => {
        if (d.mode === "fixed") return d.value;
        if (d.mode === "fixed relative") return d.value * Math.abs(v);
        const e = point.error?.[`${axisLetter}${side}`];
        if (e === undefined || !Number.isFinite(e)) return null;
        return d.mode === "explicit" ? e : e * Math.abs(v);
      };
      for (const side of ["Plus", "Minus"] as const) {
        if ((side === "Plus" && d.dir === "minus") || (side === "Minus" && d.dir === "plus")) continue;
        const e = amount(side);
        if (e === null) continue;
        const end = side === "Plus" ? v + e : v - e;
        out.push({ from: { x: point.x, y: point.y }, to: axisLetter === "x" ? { x: end, y: point.y } : { x: point.x, y: end } });
      }
    }
  }
  return out;
}

/** W6: the point at fraction `pos` of the polyline's arc length, in data units. */
function pointAlong(points: readonly PlotPoint[], pos: number): Point | null {
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finite.length === 0) return null;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < finite.length; i += 1) {
    const a = finite[i - 1]; const b = finite[i];
    if (!a || !b) continue;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(l);
    total += l;
  }
  const first = finite[0];
  if (!first || total === 0) return first ? { x: first.x, y: first.y } : null;
  let target = Math.min(Math.max(pos, 0), 1) * total;
  for (let i = 1; i < finite.length; i += 1) {
    const l = lengths[i - 1] ?? 0;
    const a = finite[i - 1]; const b = finite[i];
    if (!a || !b) continue;
    if (target <= l || i === finite.length - 1) {
      const t = l === 0 ? 0 : Math.min(target / l, 1);
      return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    target -= l;
  }
  return null;
}

/** The trailing items this evaluator draws: \closedcycle, `-- (…)`, `-- cycle`, nodes and coordinates with `pos`. */
function unsupportedTrailingItem(trailing: PathStatement): { raw: string; span: Span } | null {
  for (const item of trailing.items) {
    if (item.kind === "Node" || item.kind === "CoordinateOperation") continue;
    if (item.kind === "Coordinate" && item.relativePrefix === undefined) continue;
    if (item.kind === "PathKeyword" && (item.keyword === "--" || item.keyword === "cycle")) continue;
    if (item.kind === "PathComment" || item.kind === "PathOption") continue;
    if (item.kind === "UnknownPathItem" && /^\\closedcycle$/u.test(item.raw.trim())) continue;
    return { raw: "raw" in item && typeof item.raw === "string" ? item.raw : item.kind, span: item.span };
  }
  return null;
}

/** The stacked points of the stacked plot before `index` (W2: a stacked \closedcycle runs back along them). */
function previousStackedPoints(plots: ReadonlyArray<{ model: PlotModel; points: PlotPoint[] | null }>, stacks: ReadonlyMap<number, { points: PlotPoint[]; base: number[] }>, index: number): PlotPoint[] | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (stacks.has(i) && plots[i]?.model.stack === plots[index]?.model.stack) return plots[i]?.points ?? null;
  }
  return null;
}

/**
 * W1 - `\closedcycle`: from the last point down to the base line (y = 0
 * clamped into the limits, as for bars, E20 `closed-*`), back to the first
 * point's x, closed; for a stacked plot, back along the stacked plot below it
 * (W2). `-- (axis cs:…)`, `-- cycle` continue the path (W4).
 */
function trailingCommands(
  trailing: PathStatement,
  points: readonly PlotPoint[],
  previous: readonly PlotPoint[] | null,
  stack: "x" | "y" | undefined,
  layout: AxisLayout,
  mapPoint: (x: number, y: number) => Point,
  toWorld: (q: Point) => WorldPoint,
  log: { x: boolean; y: boolean } = { x: false, y: false }
): ScenePathCommand[] {
  const commands: ScenePathCommand[] = [];
  const finite = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const first = finite[0];
  const last = finite.at(-1);
  if (!first || !last) return commands;
  const { limits } = layout;
  for (const item of trailing.items) {
    if (item.kind === "UnknownPathItem" && /^\\closedcycle$/u.test(item.raw.trim())) {
      if (previous && previous.length > 0) {
        for (const point of [...previous].reverse()) commands.push({ kind: "L", to: toWorld(mapPoint(point.x, point.y)) });
      } else if (stack === "x") {
        // Q7: on a log direction the base is log origin 0 (data 1), not clamped.
        const base = log.x ? 0 : Math.min(Math.max(0, limits.xmin), limits.xmax);
        commands.push({ kind: "L", to: toWorld(mapPoint(base, last.y)) }, { kind: "L", to: toWorld(mapPoint(base, first.y)) });
      } else {
        const base = log.y ? 0 : Math.min(Math.max(0, limits.ymin), limits.ymax);
        commands.push({ kind: "L", to: toWorld(mapPoint(last.x, base)) }, { kind: "L", to: toWorld(mapPoint(first.x, base)) });
      }
      commands.push({ kind: "Z" });
    } else if (item.kind === "PathKeyword" && item.keyword === "cycle") {
      commands.push({ kind: "Z" });
    } else if (item.kind === "Coordinate" && item.relativePrefix === undefined) {
      const raw = item.raw.replace(/^\(|\)$/gu, "");
      const parts = raw.replace(/^\s*axis cs\s*:/u, "").split(",");
      const x = readPgfNumber(parts[0] ?? "");
      const y = readPgfNumber(parts[1] ?? "");
      if (x !== null && y !== null) commands.push({ kind: "L", to: toWorld(mapPoint(x, y)) });
    }
  }
  return commands;
}

/** Body statements that only define macros: applied in body order, before the plots read their data. */
/** Settings statements of the axis body as option lists (behaviour AB): `\pgfplotsset`, and the `/pgfplots/` keys (and `mark`) of `\tikzset`/`\pgfkeys`. */
function bodySettingList(item: AxisBodyItem): OptionListAst | null {
  if (item.kind === "PgfplotsSet") return item.optionList;
  if (item.kind !== "TikzSet" && item.kind !== "Pgfkeys") return null;
  const tikzset = item.kind === "TikzSet";
  const entries = item.optionList.entries.filter((entry) => entry.kind !== "unknown" && (entry.key.trim().startsWith("/pgfplots/") || (tikzset && /^(?:\/tikz\/)?mark$/u.test(entry.key.trim()))));
  if (entries.length === 0) return null;
  return { ...item.optionList, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` };
}

/**
 * The style definitions (`name/.style`, `.append style`, …) of a `\tikzset` in
 * the body, or a `\tikzstyle`; null when there are none. Other TikZ keys set
 * there reach nothing (AB3), `/pgfplots/` keys are settings (AB).
 */
function tikzStyleDefinition(item: AxisBodyItem): Statement | null {
  if (item.kind === "TikzStyle") return item;
  if (item.kind !== "TikzSet") return null;
  const entries = item.optionList.entries.filter((entry) => entry.kind !== "unknown" && !entry.key.trim().startsWith("/pgfplots/") && /\/\.[a-z ]+$/u.test(entry.key.trim()));
  if (entries.length === 0) return null;
  return entries.length === item.optionList.entries.length ? item : { ...item, optionList: { ...item.optionList, entries, raw: `[${entries.map((entry) => entry.raw).join(",")}]` } };
}

/**
 * AB3: text keys set by `\pgfplotsset`/`\tikzset` at the top level of the
 * body: the last colour (`green`, `color=…`, `text=…`, as `text=…`) and the
 * last `font=…`. They reach all text the axis typesets; null when none.
 */
function bodyTextKeys(axis: AxisStatement, groups: ReadonlyArray<readonly number[]>): string | null {
  const colours: string[] = [];
  const fonts: string[] = [];
  for (const [index, item] of axis.body.entries()) {
    if ((item.kind !== "PgfplotsSet" && item.kind !== "TikzSet") || (groups[index]?.length ?? 0) > 0) continue;
    for (const entry of item.optionList.entries) {
      if (entry.kind === "kv" && /^(?:\/tikz\/)?(?:color|text)$/u.test(entry.key.trim())) colours.push(entry.valueRaw.trim());
      else if (entry.kind === "kv" && /^(?:\/tikz\/)?font$/u.test(entry.key.trim())) fonts.push(entry.valueRaw.trim());
      else if (entry.kind === "flag" && isColorName(entry.key.trim())) colours.push(entry.key.trim());
    }
  }
  const colour = colours.at(-1);
  const font = fonts.at(-1);
  const keys = [...(colour ? [`text=${colour}`] : []), ...(font !== undefined ? [`font={${font}}`] : [])];
  return keys.length > 0 ? keys.join(",") : null;
}

/** Whether a TikZ key set in the body is one of the text keys of AB3. */
function isBodyTextKey(key: string): boolean {
  return /^(?:\/tikz\/)?(?:color|text|font)$/u.test(key.trim()) || isColorName(key.trim());
}

/** Limit keys pgfplots refuses inside the axis body (behaviour AB5). */
const LIMIT_KEYS = new Set(["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"]);

/**
 * Brace groups of the axis body (behaviour AB4). The parser reads the body
 * flat; a group's braces are the stray `{`/`}` between items. Per body item:
 * the ids of the groups around it, outermost first.
 */
function axisBodyGroupPaths(axis: AxisStatement, source: string): Array<readonly number[]> {
  const paths: Array<readonly number[]> = [];
  const stack: number[] = [];
  let next = 0;
  let current: readonly number[] = [];
  let pos = axis.bodySpan.from;
  const scan = (from: number, to: number): void => {
    for (let i = from; i < to; i += 1) {
      const ch = source[i];
      if (ch === "\\") { i += 1; continue; }
      if (ch === "%") { while (i < to && source[i] !== "\n") i += 1; continue; }
      if (ch === "{") { stack.push(next); next += 1; current = [...stack]; } else if (ch === "}" && stack.length > 0) { stack.pop(); current = [...stack]; }
    }
  };
  for (const item of axis.body) {
    if (item.span.from > pos) scan(pos, item.span.from);
    paths.push(current);
    pos = Math.max(pos, item.span.to);
  }
  return paths;
}

/** A plot's axis model (AB1/AB2): the final state, with the keys read at the `\addplot` taken from the settings in effect there. */
type PlotAxisModel = AxisModel & { capturedPlotDefaults: readonly PgfplotsKeyUse[] };
function plotAxisModel(final: AxisModel, captured: AxisModel): PlotAxisModel {
  const styles = new Map(final.styles);
  // `every axis plot no N` is installed when the plot is read (E24 c-every-axis-plot-no).
  for (const name of styles.keys()) if (name.startsWith("every axis plot no ")) styles.delete(name);
  for (const [name, lists] of captured.styles) if (name.startsWith("every axis plot no ")) styles.set(name, lists);
  return {
    ...final,
    styles,
    plotDefaults: [...captured.plotDefaults.filter((use) => isSurveyPlotKey(use.key)), ...final.plotDefaults.filter((use) => !isSurveyPlotKey(use.key))],
    cycleList: captured.cycleList,
    cycleListShift: captured.cycleListShift,
    tableKeys: captured.tableKeys,
    capturedPlotDefaults: captured.plotDefaults
  };
}

function isAxisDefinition(item: AxisBodyItem): item is Statement {
  return item.kind === "MacroDefinition" || item.kind === "MacroAlias" || item.kind === "MacroCommandDefinition" || item.kind === "PgfMath";
}

/** `\label{…}` after a plot: names it for `\ref` in the text; nothing to draw. */
function isLabelCommand(item: AxisBodyItem): boolean {
  return item.kind === "UnknownStatement" && !item.environment && /^\\label\s*\{/u.test(item.raw);
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

/** The lower limit was moved by `enlargelimits` (not given, enlargement on that side). */
function lowerLimitEnlarged(dir: AxisModel["x"]): boolean {
  if (dir.min !== undefined) return false;
  const spec = dir.enlarge;
  return spec.kind === "auto" || (spec.lower && spec.value > 0);
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

/** Generated label elements belong to the axis; their text is canvas-editable only where it is written in the document. */
function attributeTo(element: SceneElement, sourceId: string, span: Span, textSpan?: Span): SceneElement {
  const copy: SceneElement = { ...element, sourceRef: { sourceId, sourceSpan: span } };
  if (copy.kind === "Text") {
    if (textSpan) copy.textSourceSpan = { from: textSpan.from, to: textSpan.to };
    else delete copy.textSourceSpan;
  }
  return copy;
}

/**
 * Edit handles for the points of a `coordinates` plot (design 8): each
 * `(x,y)` is read in the content frame, whose transform is the data map on a
 * linear axis, so the coordinate writer rewrites it in data units.
 */
function pushPlotPointHandles(statement: AddPlotStatement, context: SemanticContext): void {
  if (statement.input.kind !== "coordinates") return;
  for (const point of statement.input.points) {
    const span = point.coordinateSpan;
    const raw = context.source.slice(span.from, span.to);
    if (!raw.startsWith("(") || !raw.endsWith(")") || point.components.length !== 2) continue;
    const evaluated = evaluateRawCoordinate(raw, context);
    if (!evaluated.world) continue;
    const handle = createEditHandle(evaluated, span, statement.id, "path-point", context);
    if (handle?.rewriteMode === "direct") context.editHandles.push(handle);
  }
}

function axisEditInfo(axisId: string, model: AxisModel, layout: AxisLayout, frame: WorldTransform, legend: { bbox: Box | null; anchor: string } | null, basis: { x: Point; y: Point }): PgfplotsAxisEditInfo {
  const point = (q: Point) => ({ x: q.x, y: q.y });
  return {
    axisId,
    frame: { a: frame.a, b: frame.b, c: frame.c, d: frame.d, e: frame.e, f: frame.f },
    box: { ...layout.box },
    bbox: { ...layout.bbox },
    anchors: Object.fromEntries(Object.entries(layout.anchors).map(([k, q]) => [k, point(q)])),
    anchor: model.anchor,
    map: { origin: point(layout.map.origin), xUnit: point(layout.map.xUnit), yUnit: point(layout.map.yUnit) },
    limits: { xmin: layout.limits.xmin, xmax: layout.limits.xmax, ymin: layout.limits.ymin, ymax: layout.limits.ymax },
    size: {
      ...(model.width === undefined ? {} : { width: model.width }),
      ...(model.height === undefined ? {} : { height: model.height }),
      scaleOnlyAxis: model.scaleOnlyAxis,
      scale: model.scale,
      // Units derived from a unit vector ratio are not authored: the box is
      // still sized by width/height, which a resize rewrites (AA1).
      ...(model.x.unit === undefined || model.unitsFromRatio ? {} : { xUnit: model.x.unit }),
      ...(model.y.unit === undefined || model.unitsFromRatio ? {} : { yUnit: model.y.unit })
    },
    ...(legend?.bbox ? { legend: { bbox: { ...legend.bbox }, anchor: legend.anchor } } : {}),
    linear: model.x.mode !== "log" && model.y.mode !== "log",
    parentBasis: { x: point(basis.x), y: point(basis.y) }
  };
}

/** `\path node[<styles>,<placement>] at (0pt,0pt) {<text>};`, parsed once per label; ids and spans belong to the axis. */
function buildLabelStatement(request: LabelRequest, model: AxisModel, axis: AxisStatement): PathStatement | null {
  const uses = flattenStyleEntries(request.styles, model.styles).filter((use) => !use.key.startsWith("/pgf/number format/"));
  // The placement is the style default (`anchor=near ticklabel`, `rotate=90` of the y label): the document's styles come after it and win (T4).
  const options = [nearTicklabelPlacement(request, uses), ...uses.map((use) => (use.value === null ? use.key : `${use.key}=${use.value}`))].filter((s) => s.length > 0).join(",");
  const source = `\\begin{tikzpicture}\\path node[${options}] at (0pt,0pt) {${request.text}};\\end{tikzpicture}`;
  const parsed = parseTikz(source, { recover: true });
  const statement = parsed.figure.body.find((entry): entry is PathStatement => entry.kind === "Path");
  if (!statement) return null;
  const id = `${axis.id}:label:${request.role}${request.tickPosition === undefined ? "" : `:${String(request.tickPosition)}`}`;
  const anchor = axis.beginSpan;
  return relabel(statement, id, anchor);
}

function labelKey(request: LabelRequest): string {
  return `${request.role}:${String(request.tickPosition ?? "")}`;
}

function isTickRole(role: LabelRole): boolean {
  return role === "xtick" || role === "ytick" || role === "xextra" || role === "yextra";
}

/** The label's styles rotate it and give no anchor of their own. */
function rotatedWithoutAnchor(request: LabelRequest, model: AxisModel): boolean {
  const uses = flattenStyleEntries(request.styles, model.styles);
  let rotation = 0;
  for (const use of uses) {
    if (use.key === "anchor") return false;
    if (use.key === "rotate" && use.value !== null) rotation += readPgfNumber(use.value) ?? 0;
  }
  return rotation % 360 !== 0;
}

/**
 * `anchor=near ticklabel` for a rotated tick label without an anchor of its
 * own (T4): placed by its centre, then offset in `measure` so that the edge
 * of its rotated box's canvas bounding box faces the axis at the tick.
 */
function nearTicklabelPlacement(request: LabelRequest, uses: readonly PgfplotsKeyUse[]): string {
  if (!isTickRole(request.role)) return request.placement;
  let rotation = 0;
  for (const use of uses) {
    if (use.key === "anchor") return request.placement;
    if (use.key === "rotate" && use.value !== null) rotation += readPgfNumber(use.value) ?? 0;
  }
  if (rotation % 360 === 0) return request.placement;
  return request.placement.replace(/anchor=(north|south|east|west)\b/u, "anchor=center");
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

function axisCoordinateSystems(layout: AxisLayout, toWorld: (q: Point) => WorldPoint, model: AxisModel): Array<[string, CoordinateSystemResolver]> {
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
    const xData = pair ? numeric(pair[0]) : null;
    const yData = pair ? numeric(pair[1]) : null;
    const x = xData === null ? null : toInternal(model.x, xData);
    const y = yData === null ? null : toInternal(model.y, yData);
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) return { error: `axis cs:${raw}` };
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
