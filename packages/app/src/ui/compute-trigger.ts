import type { CanvasDragKind } from "../store/types";

export function dragKindToComputeTrigger(
  dragKind: CanvasDragKind | null
): "drag-element" | "drag-handle" | "other" {
  if (dragKind === "element" || dragKind === "resize" || dragKind === "rotate") {
    return "drag-element";
  }
  if (dragKind === "handle") {
    return "drag-handle";
  }
  return "other";
}

export function computeTrigger(
  dragKind: CanvasDragKind | null,
  sourceScrubSourceId: string | null
): "drag-element" | "drag-handle" | "other" {
  const dragTrigger = dragKindToComputeTrigger(dragKind);
  if (dragTrigger !== "other") {
    return dragTrigger;
  }
  if (sourceScrubSourceId) {
    return "drag-element";
  }
  return "other";
}

/** Canvas drags, source scrubs and inspector scrubs render with the viewBox frozen. */
export function isInteractiveEdit(state: {
  readonly activeCanvasDragKind: CanvasDragKind | null;
  readonly activeSourceScrubSourceId: string | null;
  readonly activeInspectorEditDocumentId: string | null;
  readonly activeDocumentId: string;
}): boolean {
  return computeTrigger(state.activeCanvasDragKind, state.activeSourceScrubSourceId) !== "other" ||
    state.activeInspectorEditDocumentId === state.activeDocumentId;
}
