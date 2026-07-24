/**
 * Document-root identity codec.
 *
 * A document is a list of roots: standalone TikZ pictures in a TikZ
 * document, frames (with nested TikZ pictures) in a Beamer deck. Roots are
 * addressed by stable string ids whose wire shapes are owned exclusively by
 * this module — no other code may construct or parse root id strings.
 *
 * Wire formats:
 * - `figure:${index}` — a standalone TikZ picture root.
 * - `frame:${index}` — a Beamer frame root.
 * - `frame:${frameIndex}:tikzpicture:${index}` — a TikZ picture nested in a
 *   Beamer frame.
 *
 * Ids may carry a descendant suffix after the root prefix (for example
 * `figure:2:node:5`); parsing resolves the owning root.
 */

export type DocumentRootRef =
  | { readonly kind: "tikz-figure"; readonly index: number }
  | { readonly kind: "beamer-frame"; readonly index: number }
  | {
      readonly kind: "beamer-frame-tikz";
      readonly frameIndex: number;
      readonly index: number;
    };

export type DocumentRootKind = DocumentRootRef["kind"];

export function formatDocumentRootId(ref: DocumentRootRef): string {
  switch (ref.kind) {
    case "tikz-figure":
      return `figure:${ref.index}`;
    case "beamer-frame":
      return `frame:${ref.index}`;
    case "beamer-frame-tikz":
      return `frame:${ref.frameIndex}:tikzpicture:${ref.index}`;
  }
}

/**
 * Resolve the root reference owning an id. Accepts bare root ids and ids
 * with a descendant suffix; returns null for ids outside the root
 * namespace.
 */
export function parseDocumentRootId(id: string): DocumentRootRef | null {
  const segments = id.trim().split(":");
  const index = parseIndexSegment(segments[1]);
  if (index === null) {
    return null;
  }
  if (segments[0] === "figure") {
    return { kind: "tikz-figure", index };
  }
  if (segments[0] === "frame") {
    if (segments[2] === "tikzpicture") {
      const nestedIndex = parseIndexSegment(segments[3]);
      if (nestedIndex !== null) {
        return { kind: "beamer-frame-tikz", frameIndex: index, index: nestedIndex };
      }
    }
    return { kind: "beamer-frame", index };
  }
  return null;
}

/**
 * The zero-based inventory position of a standalone TikZ figure root, or
 * null when the id does not belong to one.
 */
export function tikzFigureIndexFromRootId(id: string): number | null {
  const ref = parseDocumentRootId(id);
  return ref?.kind === "tikz-figure" ? ref.index : null;
}

function parseIndexSegment(segment: string | undefined): number | null {
  if (segment === undefined || !/^\d+$/u.test(segment)) {
    return null;
  }
  const parsed = Number.parseInt(segment, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
