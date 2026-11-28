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

/**
 * The scopes around each item of an axis body (behaviour AC5), as the ids of
 * their begin markers joined outermost first ("" outside any scope).
 */
export function axisScopePaths(axis: AxisStatement): Map<string, string> {
  const paths = new Map<string, string>();
  const stack: string[] = [];
  for (const item of axis.body) {
    if (item.kind === "AxisScopeEnd") {
      const at = stack.lastIndexOf(item.beginId);
      if (at >= 0) stack.length = at;
    }
    paths.set(item.id, stack.join("/"));
    if (item.kind === "AxisScopeBegin") stack.push(item.id);
  }
  return paths;
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

/**
 * The ids with each selected PGF environment (`{pgfonlayer}{name}`, ...)
 * replaced by the statements in it, recursively: such an environment takes
 * no TikZ options, so an edit that would write them on a scope (a move)
 * edits its statements instead.
 */
export function expandPgfEnvironmentIds(statements: readonly Statement[], ids: readonly string[]): string[] {
  const environments = new Map<string, readonly Statement[]>();
  const visit = (body: readonly Statement[]): void => {
    for (const statement of body) {
      if (statement.kind === "Scope" && statement.environment) environments.set(statement.id, statement.body);
      const nested = nestedStatements(statement);
      if (nested) visit(nested);
    }
  };
  visit(statements);
  if (environments.size === 0) return [...ids];
  const expanded: string[] = [];
  const push = (id: string): void => {
    const body = environments.get(id);
    if (!body) {
      if (!expanded.includes(id)) expanded.push(id);
      return;
    }
    for (const statement of body) push(statement.id);
  };
  for (const id of ids) push(id);
  return expanded;
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
