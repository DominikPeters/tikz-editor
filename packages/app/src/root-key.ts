import { formatDocumentRootId, parseDocumentRootId } from "@tikz-editor/core/document/root-id";

/**
 * Canonical key for per-root ephemeral state maps (canvas viewport,
 * canvas interaction context, edit-analysis cache). One wire shape
 * everywhere: `${documentId}::${rootId}`, with the `document` sentinel for
 * "no specific root" (single-root documents or whole-document scope).
 *
 * Content-addressed caches (figure thumbnails) and per-document state
 * (navigator scroll) are intentionally not root-keyed.
 */
export function rootKey(
  documentId: string,
  rootId: string | null | undefined
): string {
  // null (explicitly no active root) and undefined (fall back to the first
  // root) select different parse windows and must not share a key.
  let suffix: string;
  if (rootId === null) {
    suffix = "none";
  } else if (rootId === undefined) {
    suffix = "default";
  } else {
    suffix = rootId;
  }
  return `${documentId}::${suffix}`;
}

export function documentIdFromRootKey(key: string): string {
  const delimiter = key.indexOf("::");
  return delimiter >= 0 ? key.slice(0, delimiter) : key;
}

/** A nested picture shares the overlay step of the slide it is edited on. */
export function deckStepRootKey(documentId: string, rootId: string | null | undefined): string {
  const ref = parseDocumentRootId(rootId ?? "");
  return rootKey(documentId, ref?.kind === "beamer-frame-tikz"
    ? formatDocumentRootId({ kind: "beamer-frame", index: ref.frameIndex })
    : rootId);
}

/**
 * The step asked for on a slide not stepped through yet: its last, the whole
 * slide as its thumbnail shows it. Readers clamp to the slide's step count.
 */
export const DECK_LAST_STEP = Number.MAX_SAFE_INTEGER;

/** The step asked for on a slide: the one last looked at, else its last. */
export function requestedDeckStep(steps: Readonly<Record<string, number>>, documentId: string, rootId: string | null | undefined): number {
  return steps[deckStepRootKey(documentId, rootId)] ?? DECK_LAST_STEP;
}
