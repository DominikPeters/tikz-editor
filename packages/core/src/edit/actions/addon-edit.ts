import type { AddonEditResult, AddonSourcePatch } from "@tikz-editor/addon-api";

import { createHostEditContext } from "../../addons/edit-context.js";
import type { AddonRuntime } from "../../addons/runtime.js";
import { parseTikzForEdit, type EditParseOptions } from "../parse-options.js";
import type { SourcePatch } from "../types.js";

export type AddonEditActionInput = {
  kind: "addonEdit";
  addonId: string;
  /** Plain-data edit description understood by the add-on's applyEdit hook. */
  edit: unknown;
};

export type AddonEditActionResult =
  | { kind: "success"; newSource: string; patches: SourcePatch[]; selectedSourceIds?: string[]; changedSourceIds?: string[] }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; message: string };

export function applyAddonEditAction(
  source: string,
  action: AddonEditActionInput,
  runtime: AddonRuntime | null | undefined,
  parseOptions: EditParseOptions
): AddonEditActionResult {
  const engine = runtime?.engineById(action.addonId);
  if (!engine?.applyEdit) {
    return { kind: "unsupported", reason: `No active add-on engine handles edits for "${action.addonId}"` };
  }

  const parseResult = parseTikzForEdit(source, { ...parseOptions, addons: parseOptions.addons ?? runtime });
  const context = createHostEditContext({ source, figureBody: parseResult.figure.body });

  let result: AddonEditResult;
  try {
    result = engine.applyEdit(action.edit, context);
  } catch (error) {
    return {
      kind: "error",
      message: `Add-on "${action.addonId}" failed to apply edit: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (result.kind === "unsupported") {
    return { kind: "unsupported", reason: result.reason ?? `Add-on "${action.addonId}" does not support this edit` };
  }
  if (result.kind === "error") {
    return { kind: "error", message: result.message };
  }
  if (result.patches.length === 0) {
    return { kind: "unsupported", reason: "Add-on edit produced no changes" };
  }

  const applied = applyAddonPatches(source, result.patches);
  if (!applied) {
    return { kind: "error", message: `Add-on "${action.addonId}" produced overlapping or out-of-range patches` };
  }

  return {
    kind: "success",
    newSource: applied.newSource,
    patches: applied.patches,
    selectedSourceIds: result.selectedSourceIds,
    changedSourceIds: result.changedSourceIds
  };
}

function applyAddonPatches(
  source: string,
  patches: readonly AddonSourcePatch[]
): { newSource: string; patches: SourcePatch[] } | null {
  const sorted = [...patches].sort((left, right) => left.span.from - right.span.from);
  let previousEnd = -1;
  for (const patch of sorted) {
    if (
      patch.span.from < 0 ||
      patch.span.to > source.length ||
      patch.span.from > patch.span.to ||
      patch.span.from < previousEnd
    ) {
      return null;
    }
    previousEnd = patch.span.to;
  }

  let newSource = "";
  let cursor = 0;
  let delta = 0;
  const sourcePatches: SourcePatch[] = [];
  for (const patch of sorted) {
    newSource += source.slice(cursor, patch.span.from) + patch.replacement;
    cursor = patch.span.to;
    sourcePatches.push({
      oldSpan: { from: patch.span.from, to: patch.span.to },
      newSpan: {
        from: patch.span.from + delta,
        to: patch.span.from + delta + patch.replacement.length
      },
      replacement: patch.replacement
    });
    delta += patch.replacement.length - (patch.span.to - patch.span.from);
  }
  newSource += source.slice(cursor);

  return { newSource, patches: sourcePatches };
}
