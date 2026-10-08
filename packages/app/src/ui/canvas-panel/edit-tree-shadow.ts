import { useMemo } from "react";
import { createCommandTable, type CommandTable } from "@tikz-editor/core/editing/commands/index";
import { buildEditTree, checkEditTree, type EditTree } from "@tikz-editor/core/editing/tree/index";
import type { DeckActiveFrame } from "../../compute";

type EditingEnvironment = DeckActiveFrame["editingEnvironment"];

const IS_CHECKED = import.meta.env.DEV || import.meta.env.MODE === "test";

const DEFAULT_COMMANDS = createCommandTable();

/** Violations already reported, so a broken tree is logged once, not per keystroke. */
const reportedViolations = new Set<string>();

/**
 * Shadow mode (design/canvas-editing-architecture.md, migration step 3):
 * the EditTree of a scope session's buffer, rebuilt on every revision but
 * not yet driving the UI. Dev and test builds check its invariants and log
 * each distinct violation once.
 */
export function useEditTreeShadow(
  text: string | null,
  environment: EditingEnvironment | null
): EditTree | null {
  const commands = useMemo<CommandTable>(
    () => (environment ? createCommandTable(environment) : DEFAULT_COMMANDS),
    [environment]
  );
  return useMemo(() => {
    if (text == null) {
      return null;
    }
    const tree = buildEditTree(text, { commands });
    if (IS_CHECKED) {
      reportEditTreeViolations(tree);
    }
    return tree;
  }, [text, commands]);
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
