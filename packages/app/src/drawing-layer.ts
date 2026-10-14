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

/** Load TikZ with the first drawing in a deck that has not loaded it yet. */
export function drawingLayerPackageInsertion(source: string): { at: number; text: string } | null {
  const context = createBeamerSyntaxContext(source);
  const document = scanBeamerDocument(source);
  if (!document.documentSpan) return null;
  const preamble = document.preamble.span;
  const loaded = context.syntax.controlsIn(preamble).some(control => {
    if (control.name !== "usepackage" && control.name !== "RequirePackage") return false;
    const optional = context.syntax.argumentAfter(control.span.to, "optional", preamble.to);
    const names = context.syntax.argumentAfter(optional?.span.to ?? control.span.to, "required", preamble.to);
    return names?.complete === true && source.slice(names.contentSpan.from, names.contentSpan.to)
      .split(",").some(name => name.trim() === "tikz" || name.trim() === "pgfplots" || name.trim() === "tikz-cd");
  });
  return loaded ? null : { at: preamble.to, text: (source[preamble.to - 1] === "\n" ? "" : "\n") + "\\usepackage{tikz}\n" };
}
