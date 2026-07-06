import type { PathStatement, Statement } from "../ast/types.js";

export function findPathStatementById(
  statements: readonly Statement[],
  sourceId: string
): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function normalizeNonEmptyUniqueStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export const normalizeElementIds = normalizeNonEmptyUniqueStrings;
export const uniqueStrings = normalizeNonEmptyUniqueStrings;
