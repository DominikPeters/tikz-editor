import { scanBeamerDocumentClass } from "../beamer/scan.js";

/**
 * The editing mode a document selects. Mode follows the file: a
 * `\documentclass{beamer}` source is a Beamer deck whose roots are frames;
 * everything else is a TikZ document whose roots are standalone pictures.
 */
export type DocumentKind = "tikz" | "beamer";

export function detectDocumentKind(source: string): DocumentKind {
  const documentClass = scanBeamerDocumentClass(source);
  return documentClass?.className.value.trim() === "beamer"
    ? "beamer"
    : "tikz";
}
