import type {
  AddonHandleView,
  AddonOptionMutation,
  AddonSourcePatch,
  HostEditContext
} from "@tikz-editor/addon-api";

import type { AddonCommandStatement, AddonEnvironmentStatement, Statement } from "../ast/types.js";
import type { AddonEditHandle } from "../semantic/types.js";
import { applyOptionMutationsToTarget, type OptionMutation } from "../edit/option-mutations.js";
import type { PropertyTarget } from "../edit/property-target.js";
import { parseOptionListRaw } from "../options/parse.js";

export type AddonStatement = AddonEnvironmentStatement | AddonCommandStatement;

/** Convert a core add-on edit handle into the plain view passed to engine.planHandleDrag. */
export function toAddonHandleView(handle: AddonEditHandle): AddonHandleView {
  return {
    id: handle.id,
    addonId: handle.addonId,
    role: handle.role,
    world: { x: handle.world.x, y: handle.world.y },
    data: handle.data,
    sourceId: handle.sourceRef.sourceId,
    sourceSpan: { from: handle.sourceRef.sourceSpan.from, to: handle.sourceRef.sourceSpan.to }
  };
}

export type CreateHostEditContextInput = {
  source: string;
  figureBody: readonly Statement[];
};

export function createHostEditContext(input: CreateHostEditContextInput): HostEditContext {
  const { source } = input;

  const findStatement = (sourceId: string): AddonStatement | null => findAddonStatement(input.figureBody, sourceId);

  return {
    source,
    slice: (span) => source.slice(span.from, span.to),
    parseOptionList: (raw, from = 0) => parseOptionListRaw(raw, from),
    findStatement: (sourceId) => findStatement(sourceId),
    rewriteOptionList: (statement, mutations) =>
      rewriteAddonOptionList(source, statement as unknown as AddonStatement, mutations)
  };
}

export function findAddonStatement(statements: readonly Statement[], sourceId: string): AddonStatement | null {
  for (const statement of statements) {
    if ((statement.kind === "AddonEnvironment" || statement.kind === "AddonCommand") && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findAddonStatement(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
    if (statement.kind === "AddonEnvironment" && statement.body) {
      const nested = findAddonStatement(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function rewriteAddonOptionList(
  source: string,
  statement: AddonStatement,
  mutations: AddonOptionMutation[]
): AddonSourcePatch | null {
  if (mutations.length === 0) {
    return null;
  }
  const mutationMap = new Map<string, OptionMutation>();
  for (const mutation of mutations) {
    mutationMap.set(
      mutation.key,
      mutation.value == null ? { kind: "remove" } : { kind: "set", value: mutation.value }
    );
  }

  const insertOffset =
    statement.kind === "AddonEnvironment"
      ? statement.span.from + `\\begin{${statement.envName}}`.length
      : statement.argsSpan.from;
  let options = statement.kind === "AddonEnvironment" ? statement.options : undefined;
  if (statement.kind === "AddonCommand") {
    const argsRaw = source.slice(statement.argsSpan.from, statement.argsSpan.to);
    if (argsRaw.trimStart().startsWith("[")) {
      options = parseOptionListRaw(argsRaw, statement.argsSpan.from);
    }
  }
  const target = {
    id: statement.id,
    kind: "statement",
    span: statement.span,
    options,
    optionsSpan: options?.span,
    optionsFormat: "bracketed",
    insertOffset
  } as unknown as PropertyTarget;

  const applied = applyOptionMutationsToTarget(source, target, mutationMap);
  if (!applied) {
    return null;
  }
  return {
    span: { from: applied.patch.oldSpan.from, to: applied.patch.oldSpan.to },
    replacement: applied.patch.replacement
  };
}
