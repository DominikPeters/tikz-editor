import type {
  MacroAliasStatement,
  MacroCommandDefinitionStatement,
  MacroDefinitionStatement,
  Statement,
} from "../ast/types.js";
import { isControlSequenceToken } from "./expand.js";
import type {
  MacroBinding,
  MacroOriginFrame,
} from "./types.js";

export type MacroBindingStatement =
  | MacroDefinitionStatement
  | MacroAliasStatement
  | MacroCommandDefinitionStatement;

export function collectMacroDefinition(
  statement: MacroDefinitionStatement,
  bindings: Map<string, MacroBinding>
): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }
  bindings.set(name, {
    kind: "text",
    value: statement.valueRaw,
    provenance: [originFor(statement, name)],
  });
}

export function collectMacroCommandDefinition(
  statement: MacroCommandDefinitionStatement,
  bindings: Map<string, MacroBinding>
): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }
  if (statement.commandRaw === "\\providecommand" && bindings.has(name)) {
    return;
  }
  const parameterCount = Math.min(Math.max(0, statement.arity), 9);
  const provenance = [originFor(statement, name)];
  bindings.set(
    name,
    parameterCount === 0
      ? {
        kind: "text",
        value: statement.bodyRaw,
        provenance,
      }
      : {
        kind: "callable",
        parameterCount,
        optionalFirstArgDefault: statement.optionalDefaultRaw,
        body: statement.bodyRaw,
        provenance,
      }
  );
}

export function collectMacroAlias(
  statement: MacroAliasStatement,
  bindings: Map<string, MacroBinding>
): void {
  const name = normalizeMacroName(statement.nameRaw);
  if (!name) {
    return;
  }
  const targetRaw = statement.targetRaw.trim();
  if (targetRaw.length === 0) {
    return;
  }
  const origin = originFor(statement, name);
  if (isControlSequenceToken(targetRaw)) {
    const existing = bindings.get(targetRaw);
    if (existing) {
      bindings.set(name, cloneBindingWithOrigin(existing, origin));
      return;
    }
  }
  bindings.set(name, {
    kind: "text",
    value: targetRaw,
    provenance: [origin],
  });
}

/**
 * Compile parsed TeX macro definitions into the shared expansion contract.
 *
 * Callers choose the visible statement sequence; this helper preserves source
 * order and mirrors `\providecommand`/`\let` behavior while remaining neutral
 * about the caller's scoping model.
 */
export function collectMacroBindings(
  statements: readonly Statement[]
): Map<string, MacroBinding> {
  const bindings = new Map<string, MacroBinding>();
  for (const statement of statements) {
    if (statement.kind === "MacroDefinition") {
      collectMacroDefinition(statement, bindings);
    } else if (statement.kind === "MacroCommandDefinition") {
      collectMacroCommandDefinition(statement, bindings);
    } else if (statement.kind === "MacroAlias") {
      collectMacroAlias(statement, bindings);
    } else if (statement.kind === "Scope") {
      const scoped = collectMacroBindings(statement.body);
      for (const [name, binding] of scoped) {
        bindings.set(name, binding);
      }
    }
  }
  return bindings;
}

function normalizeMacroName(raw: string): string | null {
  const trimmed = raw.trim();
  return isControlSequenceToken(trimmed) ? trimmed : null;
}

function originFor(
  statement: MacroBindingStatement,
  macroName: string
): MacroOriginFrame {
  return {
    macroName,
    definitionId: statement.id,
    definitionSpan: statement.span,
    commandRaw: statement.commandRaw,
  };
}

function cloneBindingWithOrigin(
  binding: MacroBinding,
  origin: MacroOriginFrame
): MacroBinding {
  return binding.kind === "text"
    ? {
      kind: "text",
      value: binding.value,
      provenance: [...binding.provenance, origin],
    }
    : {
      kind: "callable",
      parameterCount: binding.parameterCount,
      optionalFirstArgDefault: binding.optionalFirstArgDefault,
      body: binding.body,
      provenance: [...binding.provenance, origin],
    };
}
