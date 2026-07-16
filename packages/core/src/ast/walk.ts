import type { CoordinateOperationItem, NodeItem, PathItem, Statement } from "./types.js";

export type AstWalkVisitor = {
  onStatement?: (statement: Statement) => void;
  onPathItem?: (item: PathItem) => void;
  onNode?: (node: NodeItem) => void;
  onCoordinateOperation?: (item: CoordinateOperationItem) => void;
};

export function walkStatements(statements: readonly Statement[], visitor: AstWalkVisitor): void {
  for (const statement of statements) {
    visitor.onStatement?.(statement);
    if (statement.kind === "Path") {
      walkPathItems(statement.items, visitor);
      continue;
    }
    if (statement.kind === "Scope") {
      walkStatements(statement.body, visitor);
    }
    if (statement.kind === "AddonEnvironment" && statement.body) {
      walkStatements(statement.body, visitor);
    }
  }
}

export function walkPathItems(items: readonly PathItem[], visitor: AstWalkVisitor): void {
  for (const item of items) {
    visitor.onPathItem?.(item);

    if (item.kind === "Node") {
      visitor.onNode?.(item);
      continue;
    }

    if (item.kind === "CoordinateOperation") {
      visitor.onCoordinateOperation?.(item);
      continue;
    }

    if ((item.kind === "ToOperation" || item.kind === "EdgeOperation" || item.kind === "EdgeFromParentOperation") && item.nodes) {
      for (const node of item.nodes) {
        visitor.onNode?.(node);
      }
      continue;
    }

    if (item.kind === "ChildOperation") {
      walkPathItems(item.body, visitor);
    }
  }
}
