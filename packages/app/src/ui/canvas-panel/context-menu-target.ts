import type { CanvasContextMenuTarget } from "../../context-menu";
import { resolvePropertyTarget } from "@tikz-editor/core/edit/property-target";
import { parseTikzForEdit, type EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { PathStatement, Statement } from "@tikz-editor/core/ast/types";
import type { ToolMode } from "../../store/types";
import { clamp } from "./geometry";

export type ContextMenuSelectionAction =
  | { kind: "preserve" }
  | { kind: "clear" }
  | { kind: "select-only"; sourceId: string };

export type ResolveCanvasContextMenuTargetInput = {
  source: string;
  toolMode: ToolMode;
  clickedSourceId: string | null;
  selectedElementIds: ReadonlySet<string>;
  parseOptions?: EditParseOptions;
};

export type ResolveCanvasContextMenuTargetResult = {
  target: CanvasContextMenuTarget;
  selectionAction: ContextMenuSelectionAction;
};

export function resolveCanvasContextMenuTarget(
  input: ResolveCanvasContextMenuTargetInput
): ResolveCanvasContextMenuTargetResult {
  const { clickedSourceId, selectedElementIds, source, parseOptions } = input;

  if (!clickedSourceId) {
    return {
      target: "canvas-empty",
      selectionAction: { kind: "clear" }
    };
  }

  if (selectedElementIds.has(clickedSourceId)) {
    const matrixContextKind = resolveMatrixContextKind(source, clickedSourceId, parseOptions);
    const treeTarget = isTreeContextTarget(source, clickedSourceId, parseOptions);
    return {
      target:
        selectedElementIds.size > 1
          ? "selection-multi"
          : matrixContextKind === "matrix-statement"
            ? "selection-single-matrix"
            : matrixContextKind === "matrix-cell"
              ? "selection-single-matrix-cell"
          : isNodeContextTarget(source, clickedSourceId, parseOptions)
            ? (treeTarget ? "selection-single-node-tree" : "selection-single-node")
            : (treeTarget ? "selection-single-tree" : "selection-single"),
      selectionAction: { kind: "preserve" }
    };
  }

  const matrixContextKind = resolveMatrixContextKind(source, clickedSourceId, parseOptions);
  const treeTarget = isTreeContextTarget(source, clickedSourceId, parseOptions);
  return {
    target: matrixContextKind === "matrix-statement"
      ? "selection-single-matrix"
      : matrixContextKind === "matrix-cell"
        ? "selection-single-matrix-cell"
      : isNodeContextTarget(source, clickedSourceId, parseOptions)
      ? (treeTarget ? "selection-single-node-tree" : "selection-single-node")
      : (treeTarget ? "selection-single-tree" : "selection-single"),
    selectionAction: { kind: "select-only", sourceId: clickedSourceId }
  };
}

function isNodeContextTarget(source: string, targetId: string, parseOptions: EditParseOptions | undefined): boolean {
  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind === "not-found") {
    return false;
  }
  return (
    resolved.target.kind === "node-item" ||
    (resolved.target.kind === "path-statement" && resolved.target.pathCommand === "node")
  );
}

function isTreeContextTarget(source: string, targetId: string, parseOptions: EditParseOptions | undefined): boolean {
  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind === "not-found") {
    return false;
  }
  if (resolved.target.kind === "tree-child") {
    return true;
  }
  if (resolved.target.kind !== "path-statement") {
    return false;
  }
  const parsed = parseTikzForEdit(source, {
    ...parseOptions,
  });
  const statement = findPathStatementById(parsed.figure.body, targetId);
  if (!statement) {
    return false;
  }
  return statement.items.some((item) => item.kind === "ChildOperation");
}

function resolveMatrixContextKind(
  source: string,
  targetId: string,
  parseOptions: EditParseOptions | undefined
): "matrix-statement" | "matrix-cell" | null {
  const resolved = resolvePropertyTarget(source, targetId, parseOptions);
  if (resolved.kind === "not-found") {
    return null;
  }
  if (resolved.target.kind === "matrix-statement") {
    return "matrix-statement";
  }
  if (resolved.target.kind === "matrix-cell") {
    return "matrix-cell";
  }
  return null;
}

function findPathStatementById(statements: readonly Statement[], sourceId: string): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
      continue;
    }
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
  }
  return null;
}

export type ContextMenuAnchor = {
  x: number;
  y: number;
};

export type ContextMenuSize = {
  width: number;
  height: number;
};

export type ContextMenuBounds = {
  width: number;
  height: number;
};

export function clampContextMenuAnchor(
  anchor: ContextMenuAnchor,
  menuSize: ContextMenuSize,
  bounds: ContextMenuBounds,
  padding = 4
): ContextMenuAnchor {
  const maxX = Math.max(padding, bounds.width - menuSize.width - padding);
  const maxY = Math.max(padding, bounds.height - menuSize.height - padding);

  return {
    x: clamp(anchor.x, padding, maxX),
    y: clamp(anchor.y, padding, maxY)
  };
}
