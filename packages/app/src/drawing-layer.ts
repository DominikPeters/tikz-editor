import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { beamerOverlayPicturesIn, scanBeamerDocument } from "@tikz-editor/core/beamer/index";
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
