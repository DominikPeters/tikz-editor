export type DragPatchModeFullReason =
  | "path-attached-node"
  | "opaque-invalidation"
  | "svg-patch-fallback"
  | "viewbox-change";

export function recordDragPatchModeFullReason(
  reason: DragPatchModeFullReason,
  detail: Record<string, unknown> = {}
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent("tikz-editor:drag-patch-mode-full", {
    detail: {
      reason,
      ...detail
    }
  }));
}
