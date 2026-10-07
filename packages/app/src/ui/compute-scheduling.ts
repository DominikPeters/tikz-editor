import type { ComputeRequest, SessionSnapshot } from "../compute";
import type { CanvasDragKind, SourceChangeOrigin } from "../store/types";

export type ComputeSchedulingInput = {
  request: Omit<ComputeRequest, "id" | "schedulingTrigger">;
  sourceChangeOrigin: SourceChangeOrigin;
  dragKind: CanvasDragKind | null;
  sourceScrubActive: boolean;
  inspectorEditActive: boolean;
  canvasTextEditActive: boolean;
  assetRefreshToken: number;
  publishedDeckSnapshot?: SessionSnapshot | null;
};

export type ComputeSchedulingCause = "initial" | "document-switch" | "root-switch" | "overlay-step" |
  "file-context" | "asset-refresh" | "source-typing" | "assistant-update" | "disk-update" |
  "history" | "edit-command" | "canvas-text-edit" | "source-scrub" | "inspector-edit" |
  "drag-element" | "drag-handle" | "text-edit-state" | "interaction-state";

export type ComputeSchedulingPolicy = {
  cause: ComputeSchedulingCause;
  delayMs: number | null;
};

/** Classify the current transition, rather than metadata retained from an old edit. */
export function computeSchedulingPolicy(
  previous: ComputeSchedulingInput | null,
  current: ComputeSchedulingInput
): ComputeSchedulingPolicy {
  const immediate = (cause: ComputeSchedulingCause): ComputeSchedulingPolicy => ({ cause, delayMs: null });
  if (!previous) return immediate("initial");
  const before = previous.request, next = current.request;
  // Navigation must flush pending typing, even if the new source is still
  // unrendered or belongs to a different document with typing provenance.
  if (before.documentId !== next.documentId) return immediate("document-switch");
  if (before.activeRootId !== next.activeRootId) return immediate("root-switch");
  if (before.deckStep !== next.deckStep) return immediate("overlay-step");
  if (before.documentFileRef !== next.documentFileRef) return immediate("file-context");
  if (previous.assetRefreshToken !== current.assetRefreshToken) return immediate("asset-refresh");

  if (before.source !== next.source || before.sourceRevision !== next.sourceRevision) {
    // These can arrive rapidly but need continuous visual feedback. The
    // single-flight scheduler already coalesces superseded in-flight work.
    if (current.dragKind === "handle") return immediate("drag-handle");
    if (current.dragKind === "element" || current.dragKind === "resize" || current.dragKind === "rotate") {
      return immediate("drag-element");
    }
    if (current.sourceScrubActive) return immediate("source-scrub");
    if (current.inspectorEditActive) return immediate("inspector-edit");
    if (current.canvasTextEditActive) return immediate("canvas-text-edit");
    switch (current.sourceChangeOrigin) {
      case "source-editor": return { cause: "source-typing", delayMs: next.source.length > 80_000 ? 220 : 120 };
      case "assistant": return { cause: "assistant-update", delayMs: 60 };
      case "disk": return immediate("disk-update");
      case "history": return immediate("history");
      case "edit-command": return immediate("edit-command");
    }
  }
  if (before.textEditMaskSpan?.from !== next.textEditMaskSpan?.from ||
    before.textEditMaskSpan?.to !== next.textEditMaskSpan?.to) return immediate("text-edit-state");
  return immediate("interaction-state");
}
