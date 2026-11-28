/**
 * TikZ `plot` marks: `\tikz@@@plot` (tikz.code.tex) replays the plot stream
 * through `\pgfplothandlermark` (or `\pgfplothandlermarklisted`) after the
 * path, inside `\pgfinterruptpath\pgfscope`, with `every mark` (`mark
 * options`) applied. Each selected point gets
 * `{\pgftransformshift{<point>}\tikz@transform\pgfuseplotmark{<mark>}}`.
 *
 * Consequences reproduced here, all checked against pdflatex output:
 * - marks sit in the node box, so they paint after the whole path;
 * - the canvas transform in force (path `rotate`, `xscale`, ...) applies to
 *   the mark shapes, and `mark options` transforms apply on top, local to
 *   each mark; line widths never scale;
 * - the graphic state is inherited: line width, dash pattern (a dashed plot
 *   has dashed marks unless `mark options={solid}`), opacity;
 * - the stroke colour is the path's `draw` colour or else the current colour,
 *   the fill colour the path's `fill` colour or else the current colour;
 *   `draw=none`/`fill=none` do not stop a mark painting.
 */
import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { worldTransform, type WorldTransform } from "../../coords/transforms.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import { currentFrame, resolveContextColorAliasValue } from "../context.js";
import { evaluateTransformCoordinate } from "../coords/evaluate.js";
import type { StyleChainEntry } from "../style-chain.js";
import { normalizeColor } from "../style/colors.js";
import { cloneCustomStyleRegistry, normalizeCustomStyleName } from "../style/custom-styles.js";
import { defaultStyle } from "../style/defaults.js";
import { resolveContextDelta } from "../style/resolve.js";
import { identityMatrix, multiplyMatrix } from "../transform.js";
import type { ResolvedStyle, SceneElement, ScenePath, ScenePathCommand } from "../types.js";
import { makePath } from "./elements.js";
import type { PlotSettings } from "./plot.js";
import {
  isPlotMarkName,
  plotMarkPrimitives,
  plotMarkRequiresLibrary,
  selectPlotMarkIndices,
  type PlotMarkPrimitive,
  type PlotMarkSegment
} from "./plot-marks.js";
import type { DiagnosticPushFn, FeatureMarkFn } from "./types.js";

type MarkStyleResolution = {
  style: ResolvedStyle;
  /** `mark options` transform, local to each mark (identity based). */
  localTransform: WorldTransform;
  markColor: string | null;
};

const IDENTITY_EPSILON = 1e-9;

function markOptionLists(settings: PlotSettings, context: SemanticContext): OptionListAst[] {
  if (settings.markOptions) return settings.markOptions;
  // A `\tikzset{every mark/.style=...}` lives in the custom style registry.
  const defined = currentFrame(context).customStyles.get(normalizeCustomStyleName("every mark"));
  return defined && defined.length > 0 ? [parseOptionListRaw("[every mark]")] : [];
}

/** The stroke/fill colours `\pgfusepathq*` paint with, after the path's own options. */
function markBaseStyle(pathStyle: ResolvedStyle): ResolvedStyle {
  const pristine = defaultStyle();
  return {
    ...pathStyle,
    stroke: pathStyle.stroke ?? pathStyle.textColor ?? "black",
    fill: pathStyle.fill ?? pathStyle.textColor ?? "black",
    fillPattern: null,
    drawExplicit: true,
    clip: false,
    useAsBoundingBox: false,
    roundedCorners: null,
    shortenStart: 0,
    shortenEnd: 0,
    markerStart: null,
    markerEnd: null,
    doubleStroke: false,
    shadeEnabled: false,
    shadowLayers: [],
    decoration: pristine.decoration,
    decorationPreActions: [],
    decorationPostActions: []
  };
}

function resolveMarkStyle(
  pathStyle: ResolvedStyle,
  settings: PlotSettings,
  context: SemanticContext,
  pushDiagnostic: DiagnosticPushFn,
  span: { from: number; to: number }
): MarkStyleResolution {
  const frame = currentFrame(context);
  const base = markBaseStyle(pathStyle);
  const lists = markOptionLists(settings, context);
  let markColorRaw = settings.markColor;
  for (const list of lists) {
    for (const entry of list.entries) {
      if (entry.kind === "kv" && (entry.key === "mark color" || entry.key === "/pgf/mark color")) {
        const value = entry.valueRaw.trim();
        markColorRaw = value.length === 0 ? null : value;
      }
    }
  }
  const resolved = lists.length === 0
    ? { style: base, transform: identityMatrix(), diagnostics: [] }
    : resolveContextDelta(
        base,
        identityMatrix(),
        [{ kind: "named-style", styleName: "every mark", rawOptions: lists }],
        cloneCustomStyleRegistry(frame.customStyles),
        (raw, basis) => evaluateTransformCoordinate(raw, context, basis),
        [],
        (raw) => resolveContextColorAliasValue(context, raw),
        frame.axisBasis
      );
  for (const diagnostic of resolved.diagnostics) {
    pushDiagnostic(diagnostic.code, `Plot mark options: ${diagnostic.code}`, span.from, span.to);
  }
  // `draw=none` / `fill=none` change TikZ's path mode only; marks still paint.
  const style: ResolvedStyle = {
    ...resolved.style,
    stroke: resolved.style.stroke ?? resolved.style.textColor ?? base.stroke,
    fill: resolved.style.fill ?? resolved.style.textColor ?? base.fill
  };
  const markColor = markColorRaw == null || markColorRaw === "none"
    ? markColorRaw
    : normalizeColor(markColorRaw, {
        currentColor: style.textColor ?? style.stroke ?? "black",
        resolveAlias: (raw) => resolveContextColorAliasValue(context, raw)
      });
  return { style, localTransform: resolved.transform, markColor };
}

function transformSegments(segments: readonly PlotMarkSegment[], matrix: WorldTransform, at: WorldPoint): ScenePathCommand[] {
  const map = (x: number, y: number): WorldPoint =>
    worldPoint(pt(at.x + matrix.a * x + matrix.c * y + matrix.e), pt(at.y + matrix.b * x + matrix.d * y + matrix.f));
  return segments.map((segment): ScenePathCommand => {
    switch (segment.op) {
      case "M":
        return { kind: "M", to: map(segment.x, segment.y) };
      case "L":
        return { kind: "L", to: map(segment.x, segment.y) };
      case "C":
        return { kind: "C", c1: map(segment.x1, segment.y1), c2: map(segment.x2, segment.y2), to: map(segment.x, segment.y) };
      case "Z":
        return { kind: "Z" };
    }
  });
}

function primitiveStyle(primitive: Exclude<PlotMarkPrimitive, { kind: "text" }>, markStyle: ResolvedStyle): ResolvedStyle {
  if (primitive.kind === "shade") {
    return { ...markStyle, stroke: null, drawExplicit: false, fill: primitive.ballColor, shadeEnabled: true, shading: "ball", ballColor: primitive.ballColor };
  }
  return { ...markStyle, stroke: primitive.stroke, drawExplicit: primitive.stroke != null, fill: primitive.fill, shadeEnabled: false };
}

/**
 * Build the scene paths for a plot's marks. `canvasTransform` is the
 * transform in force at the plot (only its linear part matters: the points
 * are already in world coordinates).
 */
export function emitPlotMarks(params: {
  statementId: string;
  itemId: string;
  span: { from: number; to: number };
  points: readonly WorldPoint[];
  settings: PlotSettings;
  pathStyle: ResolvedStyle;
  styleChain: StyleChainEntry[];
  canvasTransform: WorldTransform;
  context: SemanticContext;
  markFeature: FeatureMarkFn;
  pushDiagnostic: DiagnosticPushFn;
}): SceneElement[] {
  const { statementId, itemId, span, points, settings, pathStyle, styleChain, canvasTransform, context, markFeature, pushDiagnostic } = params;
  const name = settings.mark;
  if (name == null || points.length === 0) return [];
  if (!isPlotMarkName(name)) {
    markFeature("plot_marks", "unsupported");
    pushDiagnostic(`unknown-plot-mark:${name}`, `Unknown plot mark \`${name}\`.`, span.from, span.to);
    return [];
  }
  if (plotMarkRequiresLibrary(name)) markFeature("plot_marks_library", "supported");

  const resolution = resolveMarkStyle(pathStyle, settings, context, pushDiagnostic, span);
  const linear = worldTransform(canvasTransform.a, canvasTransform.b, canvasTransform.c, canvasTransform.d, 0, 0);
  const matrix = multiplyMatrix(linear, resolution.localTransform);
  const linearIdentity =
    Math.abs(matrix.a - 1) < IDENTITY_EPSILON && Math.abs(matrix.b) < IDENTITY_EPSILON &&
    Math.abs(matrix.c) < IDENTITY_EPSILON && Math.abs(matrix.d - 1) < IDENTITY_EPSILON;
  const primitives = plotMarkPrimitives(name, {
    size: settings.markSize,
    strokeColor: resolution.style.stroke ?? "black",
    fillColor: resolution.style.fill ?? "black",
    markColor: resolution.markColor,
    ballColor: resolution.style.ballColor,
    textMark: settings.textMark,
    textMarkStyle: settings.textMarkStyle,
    textMarkAsNode: settings.textMarkAsNode,
    linearIdentity
  }) ?? [];

  if (primitives.some((primitive) => primitive.kind === "text")) {
    markFeature("plot_marks", "unsupported");
    pushDiagnostic("unsupported-plot-mark:text", "The `text` plot mark is not rendered yet.", span.from, span.to);
    return [];
  }
  markFeature("plot_marks", "supported");

  const selected = selectPlotMarkIndices(points.length, {
    repeat: settings.markRepeat,
    phase: settings.markPhase,
    indices: settings.markIndices
  });
  const elements: SceneElement[] = [];
  for (const pointIndex of selected) {
    const point = points[pointIndex];
    if (!point) continue;
    primitives.forEach((primitive, primitiveIndex) => {
      if (primitive.kind === "text") return;
      const path: ScenePath = makePath(
        statementId,
        `${itemId}:mark:${String(pointIndex)}:${String(primitiveIndex)}`,
        primitiveStyle(primitive, resolution.style),
        styleChain,
        span
      );
      path.commands = transformSegments(primitive.segments, matrix, point);
      elements.push(path);
    });
  }
  if (elements.length > 0) markFeature("svg_path", "supported");
  return elements;
}
