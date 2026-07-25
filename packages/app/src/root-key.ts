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
