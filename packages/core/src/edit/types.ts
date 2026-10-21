import type { EditedSource, TikzFragment } from "./fragment.js";
import type { Span } from "../ast/types.js";
import type { WorldPoint } from "../coords/points.js";

export type TikzEdit =
  | { kind: "updateCoordinate"; targetId: string; x: string; y: string }
  | { kind: "updateNodeText"; targetId: string; text: string };

export type ApplyEditResult = {
  source: string;
  changedSpans: Span[];
};

/** High-level editing intent (world coordinates, handle-based). */
export type EditIntent = { kind: "move"; handleId: string; newWorld: WorldPoint };

/** Result of applying an edit intent. */
export type EditIntentResult =
  | { kind: "success"; newSource: EditedSource; patches: SourcePatch[]; changedSourceIds?: string[] }
  | { kind: "unsupported"; reason: string; handleId: string }
  | { kind: "error"; message: string };

/**
 * A source text patch recording what was replaced and where.
 * For any patch list returned by edit actions, every `oldSpan` is relative to
 * the same pre-edit source text.
 */
export type SourcePatch = {
  oldSpan: Span;
  newSpan: Span;
  replacement: TikzFragment;
};
