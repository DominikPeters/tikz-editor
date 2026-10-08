import type { CommandTable } from "../commands/table.js";
import { buildEditTree } from "../tree/build.js";
import type { EditTree, NodeId } from "../tree/types.js";
import { createEditView, type EditView } from "./view.js";

export type EditViewCache = (text: string, commands: CommandTable, hidden?: ReadonlySet<NodeId>) => EditView;

/**
 * The edit view of a buffer text, built once per text and command table
 * (and per set of hidden nodes, which only changes with the rendered
 * step). A session asks for the same few texts repeatedly (the tree in
 * render, the resolver per intent, the result of an edit), so a handful of
 * recent entries is enough; trees are shared between views of one text.
 */
export function createEditViewCache(size = 4): EditViewCache {
  const entries: { text: string; commands: CommandTable; hiddenKey: string; view: EditView }[] = [];
  return (text, commands, hidden) => {
    const hiddenKey = hidden ? [...hidden].sort((left, right) => left - right).join(",") : "";
    const index = entries.findIndex((entry) =>
      entry.text === text && entry.commands === commands && entry.hiddenKey === hiddenKey
    );
    if (index >= 0) {
      const [entry] = entries.splice(index, 1);
      entries.unshift(entry);
      return entry.view;
    }
    const tree: EditTree = entries.find((entry) => entry.text === text && entry.commands === commands)?.view.tree ??
      buildEditTree(text, { commands });
    const view = createEditView(tree, { hidden });
    entries.unshift({ text, commands, hiddenKey, view });
    entries.length = Math.min(entries.length, size);
    return view;
  };
}
