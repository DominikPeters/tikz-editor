import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

import type { AddonRuntime } from "@tikz-editor/core";

import { getActiveAddonRuntime } from "../../addons/registry";

/**
 * Completion source contributed by active add-ons: claimed environment names
 * after \begin{, claimed command names after a backslash, and the engines'
 * declarative option-key/value tables inside option lists of claimed
 * environments and commands.
 */
export function addonCompletion(context: CompletionContext): CompletionResult | null {
  const runtime = getActiveAddonRuntime();
  if (!runtime || runtime.engines.size === 0) {
    return null;
  }

  const environmentMatch = context.matchBefore(/\\begin\{[A-Za-z*]*/);
  if (environmentMatch) {
    const environments = collectClaimedEnvironments(runtime);
    if (environments.length === 0) {
      return null;
    }
    return {
      from: environmentMatch.from + "\\begin{".length,
      options: environments,
      validFor: /[A-Za-z*]*/
    };
  }

  const commandMatch = context.matchBefore(/\\[A-Za-z@]*/);
  if (commandMatch && (commandMatch.text.length >= 2 || context.explicit)) {
    const commands = collectClaimedCommands(runtime);
    if (commands.length === 0) {
      return null;
    }
    return {
      from: commandMatch.from,
      options: commands,
      validFor: /\\[A-Za-z@]*/
    };
  }

  const addonId = claimingAddonIdAt(runtime, context);
  if (!addonId) {
    return null;
  }
  const completion = runtime.engineById(addonId)?.completion;
  if (!completion) {
    return null;
  }

  const valueMatch = context.matchBefore(/([\w][\w ]*?)\s*=\s*[\w ]*/);
  if (valueMatch) {
    const keyMatch = /([\w][\w ]*?)\s*=\s*([\w ]*)$/.exec(valueMatch.text);
    if (keyMatch) {
      const key = keyMatch[1].trim().toLowerCase();
      const values = completion.valueMap?.[key];
      if (values && values.length > 0) {
        return {
          from: context.pos - keyMatch[2].length,
          options: values.map((value) => ({ label: value, type: "enum", detail: key })),
          validFor: /[\w ]*/
        };
      }
    }
    return null;
  }

  const wordMatch = context.matchBefore(/[A-Za-z][\w -]*/);
  if (wordMatch && (wordMatch.text.length >= 2 || context.explicit)) {
    const optionKeys = completion.optionKeys ?? [];
    if (optionKeys.length === 0) {
      return null;
    }
    return {
      from: wordMatch.from,
      options: optionKeys.map((key) => ({ label: key, type: "property", detail: "add-on option" })),
      validFor: /[A-Za-z][\w -]*/
    };
  }

  return null;
}

function collectClaimedEnvironments(runtime: AddonRuntime): Completion[] {
  const options: Completion[] = [];
  for (const engine of runtime.engines.values()) {
    for (const name of engine.manifest.triggers.environments ?? []) {
      options.push({ label: name, type: "keyword", detail: engine.manifest.displayName });
    }
  }
  return options;
}

function collectClaimedCommands(runtime: AddonRuntime): Completion[] {
  const options: Completion[] = [];
  for (const engine of runtime.engines.values()) {
    const triggers = engine.manifest.triggers;
    for (const name of [...(triggers.commands ?? []), ...(triggers.macroCommands ?? [])]) {
      const label = name.startsWith("\\") ? name : `\\${name}`;
      options.push({ label, type: "function", detail: engine.manifest.displayName });
    }
  }
  return options;
}

/**
 * Walk up from the completion position looking for an option list whose
 * enclosing statement is claimed by an add-on: a GenericEnvironment with a
 * claimed name, or an UnknownStatement whose leading command is claimed.
 */
function claimingAddonIdAt(runtime: AddonRuntime, context: CompletionContext): string | null {
  const tree = syntaxTree(context.state);
  let node: SyntaxNode | null = tree.resolveInner(context.pos, -1);
  let sawOptionContainer = false;
  while (node) {
    if (node.type.name === "OptionList" || node.type.name === "Group") {
      sawOptionContainer = true;
    }
    if (node.type.name === "GenericEnvironment" && sawOptionContainer) {
      const begin = node.getChild("BeginEnvGeneric");
      const beginText = begin ? context.state.doc.sliceString(begin.from, begin.to) : "";
      const nameMatch = /^\\begin\{([^}]*)\}$/.exec(beginText);
      const route = nameMatch ? runtime.engineForEnvironment(nameMatch[1].trim()) : null;
      if (route) {
        return route.addonId;
      }
    }
    if (node.type.name === "UnknownStatement" && sawOptionContainer) {
      const command = node.getChild("CommandName");
      const commandText = command ? context.state.doc.sliceString(command.from, command.to) : "";
      const route = commandText ? runtime.engineForCommand(commandText) : null;
      if (route) {
        return route.addonId;
      }
    }
    node = node.parent;
  }
  return null;
}
