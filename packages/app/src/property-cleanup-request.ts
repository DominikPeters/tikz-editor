import type { EditAction } from "@tikz-editor/core/edit/actions";
import type { Span } from "@tikz-editor/core/ast/types";

export type PropertyCleanupTask = {
  source: string;
  elementIds: string[];
  activeFigureId?: string | null;
  /** Span in originalSource for property writes, or source for paint cleanup. */
  nestedFigureSpan?: Span | null;
  originalSource?: string;
  properties?: ReadonlyArray<Extract<EditAction, { kind: "setProperty" }>>;
};

export type DeferredPropertyCleanup = PropertyCleanupTask & {
  sourceRevision: number;
  historyMergeKey: string;
};
