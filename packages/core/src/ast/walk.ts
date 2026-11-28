import type {
  AxisBodyItem,
  AxisCommand,
  AxisStatement,
  CoordinateOperationItem,
  NodeItem,
  PathItem,
  Statement
} from "./types.js";

const AXIS_COMMAND_KINDS: ReadonlySet<string> = new Set<AxisCommand["kind"]>([
  "AddPlot",
  "AddLegendEntry",
  "AddLegendImage",
  "Legend",
  "PgfplotsExtra",
  "AxisScopeBegin",
  "AxisScopeEnd"
]);

/** Whether an axis body item is an axis command (`\addplot`, a legend command) rather than a statement. */
export function isAxisCommand(item: AxisBodyItem): item is AxisCommand {
  return AXIS_COMMAND_KINDS.has(item.kind);
}

/** The TikZ statements of an axis body, in order, without its axis commands. */
export function axisBodyStatements(axis: AxisStatement): Statement[] {
  return axis.body.filter((item): item is Statement => !isAxisCommand(item));
}

/**
 * The statements directly inside a container: a scope's body, or the TikZ
 * statements of an axis (its axis commands are not statements). Null for any
 * other statement.
 */
export function nestedStatements(statement: Statement): readonly Statement[] | null {
  if (statement.kind === "Scope") return statement.body;
  if (statement.kind === "Axis") return axisBodyStatements(statement);
  return null;
}

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
      continue;
    }
    // An axis is a container: its TikZ statements are visited; its axis
    // commands (and their trailing paths) are not statements.
    if (statement.kind === "Axis") {
      walkStatements(axisBodyStatements(statement), visitor);
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
