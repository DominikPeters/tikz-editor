import { useMemo } from "react";
import { createCommandTable, type CommandTable } from "@tikz-editor/core/editing/commands/index";
import { createEditViewCache, type EditView, type EditViewOptions } from "@tikz-editor/core/editing/position/index";
import { checkEditTree, type EditTree } from "@tikz-editor/core/editing/tree/index";
import type { DeckActiveFrame } from "../../compute";

type EditingEnvironment = DeckActiveFrame["editingEnvironment"];

const IS_CHECKED = import.meta.env.DEV || import.meta.env.MODE === "test";

const DEFAULT_COMMANDS = createCommandTable();

/**
 * Edit views of canvas session buffers, shared by the render path and the
 * intent resolver so that a buffer is bound once per revision.
 */
const editViews = createEditViewCache();

/** Trees already checked, and violations already reported (logged once, not per keystroke). */
const checkedTrees = new WeakSet<EditTree>();
const reportedViolations = new Set<string>();

/** Command tables by environment content: a re-rendered frame brings an equal but new environment object. */
const commandTables = new Map<string, CommandTable>();

function environmentKey(environment: EditingEnvironment): string {
  const macros = [...environment.macros].map(([name, binding]) =>
    binding.kind === "text"
      ? `${name}=${binding.value}`
      : `${name}/${binding.parameterCount}[${binding.optionalFirstArgDefault ?? ""}]` +
        `${binding.provenance.at(-1)?.commandRaw ?? ""}=${binding.body}`
  );
  return `${environment.theorems.join(",")}\n${macros.join("\n")}`;
}

function commandsFor(environment: EditingEnvironment | null): CommandTable {
  if (!environment) {
    return DEFAULT_COMMANDS;
  }
  const key = environmentKey(environment);
  let table = commandTables.get(key);
  if (!table) {
    if (commandTables.size > 16) {
      commandTables.clear();
    }
    table = createCommandTable(environment);
    commandTables.set(key, table);
  }
  return table;
}

/** The command table for the active frame's interpretation environment (stable while its content is). */
export function useEditCommands(environment: EditingEnvironment | null): CommandTable {
  return useMemo(() => commandsFor(environment), [environment]);
}

/** The edit view of a buffer text (cached). Dev and test builds check the tree's invariants. */
export function canvasEditView(text: string, commands: CommandTable, visibility?: EditViewOptions): EditView {
  const view = editViews(text, commands, visibility);
  if (IS_CHECKED && !checkedTrees.has(view.tree)) {
    checkedTrees.add(view.tree);
    reportEditTreeViolations(view.tree);
  }
  return view;
}

/**
 * The EditTree of a scope session's buffer, rebuilt on every revision in
 * the render path, so the resolver usually finds it already built.
 */
export function useEditTree(text: string | null, commands: CommandTable): EditTree | null {
  return useMemo(() => (text == null ? null : canvasEditView(text, commands).tree), [text, commands]);
}

function reportEditTreeViolations(tree: EditTree): void {
  for (const violation of checkEditTree(tree)) {
    if (reportedViolations.has(violation)) {
      continue;
    }
    reportedViolations.add(violation);
    console.error(`[edit-tree] ${violation}\nin buffer: ${JSON.stringify(tree.text.slice(0, 200))}`);
  }
}
