import type { BeamerObjectNode } from "@tikz-editor/core/beamer/index";
import type { Span } from "@tikz-editor/core/ast/types";

/**
 * What insertions from outside the canvas (menus, paste, drop) need from it:
 * the text caret of an open deck editing session, and a selection to make
 * once the inserted object has rendered.
 */
export type DeckCaret = { readonly documentId: string; readonly frameId: string; readonly offset: number };
/** Applies once the frame shows `source`, the document the insertion made. */
export type DeckPendingReselect = { readonly frameId: string; readonly kind: BeamerObjectNode["kind"]; readonly span: Span; readonly source: string };

let caretReader: (() => DeckCaret | null) | null = null;
let pendingReselect: DeckPendingReselect | null = null;

export function registerDeckCaretReader(reader: () => DeckCaret | null): () => void {
  caretReader = reader;
  return () => { if (caretReader === reader) caretReader = null; };
}

/** The caret of the open deck text session, closing the session. */
export function takeDeckCaret(): DeckCaret | null {
  return caretReader?.() ?? null;
}

export function requestDeckReselect(request: DeckPendingReselect): void {
  pendingReselect = request;
}

export function peekDeckReselect(): DeckPendingReselect | null {
  return pendingReselect;
}

export function clearDeckReselect(request: DeckPendingReselect): void {
  if (pendingReselect === request) pendingReselect = null;
}
