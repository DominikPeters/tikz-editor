/**
 * PGF's layers (pgfcorelayers.code.tex, manual "Layered Graphics"):
 * `\pgfdeclarelayer`, `\pgfsetlayers` and `{pgfonlayer}`, the mechanism the
 * `backgrounds` library's `on background layer` is built on.
 *
 * A layer's content is collected in a box of its own and the boxes are
 * painted at the end of the picture in the order of the layer list in force
 * at the picture's top level then. The content is built where it stands, so
 * TeX-level state carries in (the coordinate transformation, styles, text
 * colour, node names, the picture's bounding box), while the PDF graphic
 * state set by the enclosing scopes does not: the box is painted outside
 * them, with the picture's initial state, and `{pgfonlayer}` resets the line
 * width. Clips of the enclosing scopes do not reach it either.
 */
import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { SemanticContext } from "./context.js";
import { currentFrame, markBackgroundLayerUsed } from "./context.js";
import { defaultStyle } from "./style/defaults.js";
import type { ResolvedStyle, SceneClipPath, SceneElement, SceneLayer } from "./types.js";
import { BACKGROUND_SCENE_LAYER, MAIN_SCENE_LAYER } from "./types.js";

/** PGF's layer that discards its content without an error (`\pgfdiscardlayername`). */
export const DISCARD_LAYER = "discard";

/** Content PGF loses: `{pgfonlayer}{main}` from another layer (the main box is rebuilt around it). */
export const LOST_LAYER = "\u0000lost";

export function declareLayer(context: SemanticContext, name: string): void {
  if (!context.layerState.declared.includes(name)) context.layerState.declared.push(name);
}

/**
 * `\pgfsetlayers{list}`: before the picture it sets the document's list; in
 * the picture it holds to the end of the enclosing group, and the list at the
 * picture's top level when the picture ends is the one painted.
 */
export function setLayerList(context: SemanticContext, names: readonly string[]): void {
  if (context.stack.length <= 1) {
    context.layerState.list = [...names];
    context.layerState.listSource = "explicit";
    return;
  }
  currentFrame(context).layerList = [...names];
}

/** The `\pgfsetlayers` list in force at the current point. */
export function effectiveLayerList(context: SemanticContext): readonly string[] {
  for (let index = context.stack.length - 1; index >= 0; index -= 1) {
    const list = context.stack[index]?.layerList;
    if (list) return list;
  }
  return context.layerState.list;
}

export type LayerEntry = {
  /** The layer the content goes to. */
  layer: string;
  /** Whether the content leaves the current layer: a new box, with the graphic state reset. */
  switched: boolean;
  /**
   * Whether the layer was found. `\pgfonlayer` then sets the line width to
   * 0.4pt before it opens the layer's box, in the enclosing stream: the
   * content starts at 0.4pt even on the same layer, and so does what follows
   * the environment in the enclosing PDF scope (checked against pdfTeX).
   */
  declared: boolean;
  /** The clips in force on that layer. */
  clipChain: readonly SceneClipPath[];
};

/**
 * What `\pgfonlayer{name}` does here, with TeX's errors as diagnostics.
 * `implicitBackground`: the `background` layer may be used without a
 * visible declaration (a key of the `backgrounds` library, or a picture whose
 * preamble the editor does not see; the exporter loads the library then).
 */
export function enterLayer(
  context: SemanticContext,
  name: string,
  span: Span,
  diagnostics: Diagnostic[]
): LayerEntry {
  const frame = currentFrame(context);
  const state = context.layerState;
  if (!state.declared.includes(name)) {
    if (name === BACKGROUND_SCENE_LAYER) {
      // The `backgrounds` library's layer: assume the library, as its keys do.
      markBackgroundLayerUsed(context);
      return enterLayer(context, name, span, diagnostics);
    }
    diagnostics.push({
      severity: "error",
      code: "pgf-layer-undeclared",
      message: `Layer \`${name}\` is not declared.`,
      span
    });
    return { layer: frame.layer, switched: false, declared: false, clipChain: frame.clipChain };
  }
  if (name === frame.layer) {
    // "we are already on this layer": a group, nothing more.
    return { layer: frame.layer, switched: false, declared: true, clipChain: frame.clipChain };
  }
  if (name === MAIN_SCENE_LAYER) {
    diagnostics.push({
      severity: "warning",
      code: "pgf-layer-main-lost",
      message: "Content put on the `main` layer from another layer is lost.",
      span
    });
    return { layer: LOST_LAYER, switched: true, declared: true, clipChain: [] };
  }
  if (name !== DISCARD_LAYER && !effectiveLayerList(context).includes(name)) {
    diagnostics.push({
      severity: "error",
      code: "pgf-layer-not-listed",
      message: `Layer \`${name}\` is not in \`\\pgfsetlayers{${effectiveLayerList(context).join(",")}}\`.`,
      span
    });
  }
  return { layer: name, switched: true, declared: true, clipChain: state.clipChains[name] ?? [] };
}

/**
 * The style a layer's content starts from: the TikZ-level settings carry in
 * (text colour, fonts, styles), the graphic state the enclosing scopes put
 * in the PDF stream does not, and `{pgfonlayer}` resets the line width to
 * 0.4pt. Checked against pdfTeX: a `[red, dashed, line width=3pt,
 * opacity=.5, draw=red, fill=yellow]` scope leaves strokes and fills on the
 * layer black, solid, 0.4pt and opaque; node text keeps the colour.
 */
export function resetLayerGraphicState(style: ResolvedStyle): ResolvedStyle {
  const initial = defaultStyle();
  return {
    ...style,
    stroke: initial.stroke,
    fill: initial.fill,
    fillPattern: initial.fillPattern,
    patternColor: initial.patternColor,
    drawExplicit: initial.drawExplicit,
    fillRule: initial.fillRule,
    lineWidth: initial.lineWidth,
    dashArray: initial.dashArray,
    dashOffset: initial.dashOffset,
    lineCap: initial.lineCap,
    lineJoin: initial.lineJoin,
    opacity: initial.opacity,
    strokeOpacity: initial.strokeOpacity,
    fillOpacity: initial.fillOpacity,
    textOpacity: initial.textOpacity
  };
}

/** The style `\pgfonlayer` leaves: the line width reset (see `LayerEntry.declared`), the rest as `switched` says. */
export function layerEntryStyle(style: ResolvedStyle, entry: LayerEntry): ResolvedStyle {
  if (entry.switched) return resetLayerGraphicState(style);
  return entry.declared ? { ...style, lineWidth: PGF_LAYER_LINE_WIDTH } : style;
}

export const PGF_LAYER_LINE_WIDTH = 0.4;

/** A layer's content ends: clips it set outside a scope hold for its later content. */
export function leaveLayer(context: SemanticContext, layer: string, clipChain: readonly SceneClipPath[]): void {
  if (layer === LOST_LAYER) return;
  context.layerState.clipChains[layer] = clipChain.map((clip) => ({ ...clip, commands: [...clip.commands] }));
}

/**
 * The picture's layers in paint order, and its elements without the content
 * of layers PGF does not paint (a layer missing from the final list, the
 * `discard` layer, content lost to `main`). Such content still counted for
 * the bounding box when it was built.
 */
export function finalizeLayers(
  context: SemanticContext,
  finalList: readonly string[],
  elements: SceneElement[],
  diagnostics: Diagnostic[]
): { layers: SceneLayer[]; elements: SceneElement[] } {
  const layers = finalList.map((name, order) => ({ name, order }));
  const painted = new Set(finalList);
  const reported = new Set<string>();
  const kept: SceneElement[] = [];
  for (const element of elements) {
    const layer = element.layer || MAIN_SCENE_LAYER;
    if (painted.has(layer)) {
      kept.push(element);
      continue;
    }
    if (layer !== DISCARD_LAYER && layer !== LOST_LAYER && !reported.has(layer)) {
      reported.add(layer);
      const span = element.sourceRef.sourceSpan;
      diagnostics.push({
        severity: "warning",
        code: "pgf-layer-not-painted",
        message: `Layer \`${layer}\` is not in \`\\pgfsetlayers{${finalList.join(",")}}\` and is not drawn.`,
        span
      });
    }
  }
  void context;
  return { layers, elements: kept };
}
