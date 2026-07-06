import type { OptionListAst } from "../options/types.js";
import type { PathStatement } from "../ast/types.js";
import type { ParseTikzResult } from "../parser/index.js";
import { normalizeOptionKey } from "./option-key.js";
import { resolvePropertyTargetFromParseResult, type PropertyTarget } from "./property-target.js";
import { findPathStatementById } from "./statement-find.js";

export const FIT_DIRECT_MANIPULATION_BLOCK_REASON =
  "This node uses fit; drag move/resize/rotate is disabled. Edit fit=(...) targets instead.";

export function optionListUsesFit(options: OptionListAst | undefined): boolean {
  if (!options) {
    return false;
  }
  return options.entries.some(
    (entry) => (entry.kind === "flag" || entry.kind === "kv") && normalizeOptionKey(entry.key) === "fit"
  );
}

export function propertyTargetUsesFit(target: Pick<PropertyTarget, "options">): boolean {
  return optionListUsesFit(target.options);
}

export function sourceUsesFitNodeFromParseResult(
  source: string,
  parseResult: ParseTikzResult | null | undefined,
  sourceId: string
): boolean {
  if (!parseResult || sourceId.trim().length === 0) {
    return false;
  }
  const statement = findPathStatementById(parseResult.figure.body, sourceId);
  if (statement && pathStatementUsesFit(statement)) {
    return true;
  }
  const resolved = resolvePropertyTargetFromParseResult(source, parseResult, sourceId);
  return resolved.kind === "found" && propertyTargetUsesFit(resolved.target);
}

function pathStatementUsesFit(statement: PathStatement): boolean {
  return statement.items.some((item) => item.kind === "Node" && optionListUsesFit(item.options));
}
