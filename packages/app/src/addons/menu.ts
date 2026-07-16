import type { AppMenuDefinition, AppMenuItem } from "../app-menu";

import { getActiveAddonRuntime } from "./registry";
import { listAddonToolTemplates } from "./templates";

/**
 * Insert-menu items contributed by active add-ons, in add-on-id order.
 * Actions referencing unknown template ids are dropped.
 */
export function buildAddonInsertMenuItems(): AppMenuItem[] {
  const runtime = getActiveAddonRuntime();
  if (!runtime) {
    return [];
  }
  const templateIds = new Set(listAddonToolTemplates().map((template) => template.id));
  const items: AppMenuItem[] = [];
  for (const [, ui] of [...runtime.uis.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const contribution = ui.insertMenu;
    if (!contribution) {
      continue;
    }
    if (contribution.kind === "item") {
      const action = contribution.item;
      if (!templateIds.has(action.action.templateId)) {
        continue;
      }
      items.push({ kind: "command", commandId: action.commandId, label: action.label });
      continue;
    }
    const actions = contribution.items.filter((action) => templateIds.has(action.action.templateId));
    if (actions.length === 0) {
      continue;
    }
    items.push({
      kind: "submenu",
      label: contribution.label,
      items: actions.map((action) => ({
        kind: "command" as const,
        commandId: action.commandId,
        label: action.label
      }))
    });
  }
  return items;
}

/** Append add-on contributions to the Insert section, separator-prefixed. */
export function appendAddonMenuItems(definition: AppMenuDefinition): AppMenuDefinition {
  const addonItems = buildAddonInsertMenuItems();
  if (addonItems.length === 0) {
    return definition;
  }
  return definition.map((section) =>
    section.id === "insert"
      ? { ...section, items: [...section.items, { kind: "separator" as const }, ...addonItems] }
      : section
  );
}
