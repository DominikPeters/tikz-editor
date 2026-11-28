import type { AppMenuCommandId, AppMenuItem } from "../app-menu/types.js";

export type CanvasContextMenuTarget =
  | "canvas-empty"
  | "selection-single"
  | "selection-single-tree"
  | "selection-single-node"
  | "selection-single-node-tree"
  | "selection-single-matrix"
  | "selection-single-matrix-cell"
  | "selection-single-path-point"
  | "selection-single-path-point-tree"
  | "selection-single-axis"
  | "selection-single-plot"
  | "selection-single-axis-part"
  | "selection-multi";

export type CanvasContextMenuCommandId = AppMenuCommandId;

export type CanvasContextMenuDefinition = Readonly<Record<CanvasContextMenuTarget, readonly AppMenuItem[]>>;
