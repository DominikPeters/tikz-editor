import type { CommandTable } from "../commands/table.js";
import { buildEditTree } from "../tree/build.js";
import { createEditView, type EditView } from "./view.js";

export type EditViewCache = (text: string, commands: CommandTable) => EditView;

/**
 * The edit view of a buffer text, built once per text and command table.
 * A session asks for the same few texts repeatedly (the shadow tree in
 * render, the resolver per intent, the result of an edit), so a handful
 * of recent entries is enough.
 */
export function createEditViewCache(size = 4): EditViewCache {
  const entries: { text: string; commands: CommandTable; view: EditView }[] = [];
  return (text, commands) => {
    const index = entries.findIndex((entry) => entry.text === text && entry.commands === commands);
    if (index >= 0) {
      const [entry] = entries.splice(index, 1);
      entries.unshift(entry);
      return entry.view;
    }
    const view = createEditView(buildEditTree(text, { commands }));
    entries.unshift({ text, commands, view });
    entries.length = Math.min(entries.length, size);
    return view;
  };
}
