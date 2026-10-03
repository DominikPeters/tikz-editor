// Mirrors cursor semantics used by the editor runtime:
// - dragCursorForState() in packages/app/src/ui/canvas-panel/panel-helpers.ts
// - resizeCursorForRole() and resizeCursorForVector() in the same module/geometry.ts

import type { CursorStyle } from "./cursor-overlay";

export const CURSOR_FOR_DRAG = {
  element: "move",
  pan: "grabbing",
  toolCreate: "crosshair"
} as const satisfies Record<string, CursorStyle>;

export const CURSOR_FOR_HANDLE_ROLE = {
  left: "ew-resize",
  right: "ew-resize",
  top: "ns-resize",
  bottom: "ns-resize",
  topLeft: "nwse-resize",
  bottomRight: "nwse-resize",
  topRight: "nesw-resize",
  bottomLeft: "nesw-resize"
} as const satisfies Record<string, CursorStyle>;
