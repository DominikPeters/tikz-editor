import type { NodeItem } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import type { ParseTikzResult } from "../parser/index.js";
import { walkStatements } from "../ast/walk.js";

export type DocumentSymbols = {
  nodeNames: string[];
  styleNames: string[];
  coordinateNames: string[];
};

export type SymbolSnapshot = {
  parseResult: Pick<ParseTikzResult, "source" | "figure"> | null;
};

export function collectSymbols(snapshot: SymbolSnapshot): DocumentSymbols {
  const parseResult = snapshot.parseResult;
  if (!parseResult) {
    return {
      nodeNames: [],
      styleNames: [],
      coordinateNames: []
    };
  }

  const nodeNames = new Set<string>();
  const coordinateNames = new Set<string>();
  const styleNames = new Set<string>();

  walkStatements(parseResult.figure.body, {
    onStatement: (statement) => {
      if (statement.kind === "TikzSet" || statement.kind === "Pgfkeys") {
        collectStyleSymbolsFromOptions(statement.optionList.entries, styleNames);
      } else if (statement.kind === "TikzStyle") {
        addTrimmedSymbol(styleNames, normalizeStyleName(statement.styleNameRaw));
      }
    },
    onNode: (node) => {
      collectNodeIdentifiers(node, nodeNames);
    },
    onCoordinateOperation: (item) => {
      addTrimmedSymbol(coordinateNames, item.name);
    }
  });

  return {
    nodeNames: [...nodeNames].sort(compareSymbolName),
    styleNames: [...styleNames].sort(compareSymbolName),
    coordinateNames: [...coordinateNames].sort(compareSymbolName)
  };
}

function collectNodeIdentifiers(node: NodeItem, nodeNames: Set<string>): void {
  addTrimmedSymbol(nodeNames, node.name);
  if (!node.name) {
    const inferred = inferNodeNameFromTemplate(node.templateRaw, node.atRaw);
    addTrimmedSymbol(nodeNames, inferred);
  }
  for (const alias of node.aliases ?? []) {
    addTrimmedSymbol(nodeNames, alias);
  }
}

function collectStyleSymbolsFromOptions(entries: readonly OptionEntry[], styleNames: Set<string>): void {
  for (const entry of entries) {
    if (entry.kind !== "kv" && entry.kind !== "flag") {
      continue;
    }
    addTrimmedSymbol(styleNames, styleNameFromOptionKey(entry.key));
  }
}

function styleNameFromOptionKey(key: string): string | null {
  const normalizedKey = key.trim().toLowerCase();
  const styleMatch = normalizedKey.match(/^(.*?)\/\.(style|append style|prefix style)$/);
  if (!styleMatch) {
    return null;
  }

  return normalizeStyleName(styleMatch[1] ?? "");
}

function normalizeStyleName(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith("/tikz/")) {
    normalized = normalized.slice("/tikz/".length);
  } else if (normalized.startsWith("/pgf/")) {
    normalized = normalized.slice("/pgf/".length);
  }
  return normalized.trim();
}

function inferNodeNameFromTemplate(templateRaw: string, atRaw: string | undefined): string | null {
  const match = templateRaw.match(/\(\s*([A-Za-z_][A-Za-z0-9:_-]*)\s*\)/);
  if (!match) {
    return null;
  }

  const inferred = match[1]?.trim() ?? "";
  if (inferred.length === 0) {
    return null;
  }

  if (atRaw?.replace(/\s+/g, "") === `(${inferred})`) {
    return null;
  }

  return inferred;
}

function addTrimmedSymbol(target: Set<string>, value: string | null | undefined): void {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }
  target.add(trimmed);
}

function compareSymbolName(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

export { resolveDocHoverTarget } from "./doc-hover.js";
export type { DocHoverTarget, DocHoverTargetKind, ResolveDocHoverTargetInput } from "./doc-hover.js";
