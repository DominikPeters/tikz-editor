import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import type { SessionSnapshot } from "./compute";

/**
 * The drawing layer a drawing tool opens on a slide: the frame's overlay
 * picture new shapes go into. That is the last one on the page with
 * `remember picture` (the page is its coordinate frame), else the last one;
 * a frame without any gets layer 0, which the first shape creates. Null
 * unless the root is a Beamer frame.
 */
export function deckDrawingLayerRootId(activeRootId: string | null, snapshot: SessionSnapshot): string | null {
  const ref = parseDocumentRootId(activeRootId ?? "");
  if (ref?.kind !== "beamer-frame") return null;
  const frame = snapshot.deck?.activeFrame;
  const layers = frame?.frameIndex === ref.index
    ? frame.layout.embeddedTikz.flatMap((picture) => picture.overlay ? [picture.overlay] : [])
    : [];
  const layer = layers.filter((candidate) => candidate.rememberPicture).at(-1) ?? layers.at(-1);
  return layer?.rootId ?? formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: ref.index, index: 0, layer: true });
}
