import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { BEAMER_TIKZ_LAYER_DEFINITION, beamerOverlayPicturesIn, scanBeamerDocument } from "@tikz-editor/core/beamer/index";
import { createBeamerSyntaxContext } from "@tikz-editor/core/beamer/syntax";
import type { SessionSnapshot } from "./compute";

/**
 * The drawing layer a drawing tool opens on a slide: the frame's overlay
 * picture new shapes go into. That is the last one on the page with
 * `remember picture` (the page is its coordinate frame), else the last one;
 * if none is visible, the next layer is created with the first shape. Null
 * unless the root is a Beamer frame.
 */
export function deckDrawingLayerRootId(activeRootId: string | null, snapshot: SessionSnapshot, source = snapshot.source): string | null {
  const ref = parseDocumentRootId(activeRootId ?? "");
  if (ref?.kind !== "beamer-frame") return null;
  const frame = snapshot.deck?.activeFrame;
  const layers = snapshot.source === source && frame?.frameIndex === ref.index
    ? frame.layout.embeddedTikz.flatMap((picture) => picture.overlay ? [picture.overlay] : [])
    : [];
  const layer = layers.filter((candidate) => candidate.rememberPicture).at(-1) ?? layers.at(-1);
  if (layer) return layer.rootId;
  const bodySpan = scanBeamerDocument(source).frames[ref.index]?.bodySpan;
  if (!bodySpan) return null;
  const index = beamerOverlayPicturesIn(createBeamerSyntaxContext(source), bodySpan).length;
  return formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: ref.index, index, layer: true });
}

/** A new drawing layer: inserted at `at`, with what the preamble needs for it. */
export type DrawingLayerInsertion = { at: number; text: string; preamble?: { at: number; text: string } | null };

/**
 * What the preamble needs for a first drawing: TikZ, unless a package already
 * loads it, and with `definesLayer` the `tikzlayer` definition, on the line
 * after TikZ's.
 */
export function drawingLayerPreambleInsertion(source: string, definesLayer: boolean): { at: number; text: string } | null {
  const context = createBeamerSyntaxContext(source);
  const document = scanBeamerDocument(source);
  if (!document.documentSpan) return null;
  const preamble = document.preamble.span;
  let loadedAt: number | null = null;
  for (const control of context.syntax.controlsIn(preamble)) {
    if (control.name !== "usepackage" && control.name !== "RequirePackage") continue;
    const optional = context.syntax.argumentAfter(control.span.to, "optional", preamble.to);
    const names = context.syntax.argumentAfter(optional?.span.to ?? control.span.to, "required", preamble.to);
    if (names?.complete === true && source.slice(names.contentSpan.from, names.contentSpan.to)
      .split(",").some(name => name.trim() === "tikz" || name.trim() === "pgfplots" || name.trim() === "tikz-cd")) {
      loadedAt = names.span.to;
    }
  }
  const definition = definesLayer ? BEAMER_TIKZ_LAYER_DEFINITION + "\n" : "";
  if (loadedAt != null) {
    if (!definition) return null;
    const lineEnd = source.indexOf("\n", loadedAt);
    return lineEnd >= 0 && lineEnd < preamble.to
      ? { at: lineEnd + 1, text: definition }
      : { at: preamble.to, text: (source[preamble.to - 1] === "\n" ? "" : "\n") + definition };
  }
  return { at: preamble.to, text: (source[preamble.to - 1] === "\n" ? "" : "\n") + "\\usepackage{tikz}\n" + definition };
}

/** The source with a drawing layer inserted (`at` counts in the source without it). */
export function insertDrawingLayer(source: string, insertion: DrawingLayerInsertion): string {
  const withLayer = source.slice(0, insertion.at) + insertion.text + source.slice(insertion.at);
  const preamble = insertion.preamble;
  return preamble ? withLayer.slice(0, preamble.at) + preamble.text + withLayer.slice(preamble.at) : withLayer;
}

/** Where the layer's text starts in `insertDrawingLayer`'s source. */
export function drawingLayerOffset(insertion: DrawingLayerInsertion): number {
  return insertion.at + (insertion.preamble?.text.length ?? 0);
}
