import { findAddonStatement } from "@tikz-editor/core/addons/edit-context";
import type { ParseTikzResult } from "@tikz-editor/core/parser/index";

import type { AddonMenuCommandId, AppMenuItem } from "../app-menu";
import type { CommandBinding } from "../ui/editor-command-runtime";
import type { EditorAction } from "../store/types";
import { getActiveAddonRuntime } from "./registry";

/** Add-on context-menu contribution for one open: items plus their per-open bindings. */
export type AddonContextMenu = {
  items: readonly AppMenuItem[];
  bindings: ReadonlyMap<AddonMenuCommandId, CommandBinding>;
};

/**
 * Build the add-on context-menu contribution for a right-clicked claimed
 * statement: calls the owning add-on's contextMenu builder with the
 * statement and click position, and wires each returned item's plain-data
 * edit to an addonEdit dispatch. Null when the click is not on a claimed
 * statement or nothing is contributed.
 */
export function buildAddonContextMenu(
  parseResult: ParseTikzResult | null,
  clickedSourceId: string | null,
  world: { x: number; y: number } | null,
  dispatch: (action: EditorAction) => void
): AddonContextMenu | null {
  if (
    !clickedSourceId ||
    (!clickedSourceId.startsWith("addon-command:") && !clickedSourceId.startsWith("addon-environment:"))
  ) {
    return null;
  }
  const runtime = getActiveAddonRuntime();
  const body = parseResult?.figure.body;
  if (!runtime || !body || !world) {
    return null;
  }
  const statement = findAddonStatement(body, clickedSourceId);
  if (!statement) {
    return null;
  }
  const ui = runtime.uis.get(statement.addonId);
  if (!ui?.contextMenu) {
    return null;
  }
  let contributed;
  try {
    contributed = ui.contextMenu(statement, { world: { x: world.x, y: world.y } });
  } catch {
    return null;
  }

  const items: AppMenuItem[] = [];
  const bindings = new Map<AddonMenuCommandId, CommandBinding>();
  for (const entry of contributed) {
    if (!entry.commandId.startsWith("addon:") || bindings.has(entry.commandId)) {
      continue;
    }
    const edit = entry.edit;
    items.push({ kind: "command", commandId: entry.commandId, label: entry.label });
    bindings.set(entry.commandId, {
      enabled: true,
      run: () => {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          action: { kind: "addonEdit", addonId: statement.addonId, edit }
        });
      }
    });
  }
  return items.length > 0 ? { items, bindings } : null;
}
