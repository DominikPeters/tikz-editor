import type { AddonInspectorSection } from "@tikz-editor/addon-api";
import { findAddonStatement } from "@tikz-editor/core/addons/edit-context";
import type { ParseTikzResult } from "@tikz-editor/core/parser/index";

import { getActiveAddonRuntime } from "./registry";

export type AddonInspectorModel = {
  addonId: string;
  sourceId: string;
  sections: AddonInspectorSection[];
};

/**
 * Build the add-on inspector sections for a single selected claimed
 * statement, or null when the selection is not an add-on statement, no
 * runtime is active, or the add-on contributes no inspector.
 */
export function buildAddonInspectorModel(
  parseResult: ParseTikzResult | null,
  selectedSourceIds: readonly string[]
): AddonInspectorModel | null {
  if (selectedSourceIds.length !== 1) {
    return null;
  }
  const sourceId = selectedSourceIds[0];
  if (!sourceId.startsWith("addon-command:") && !sourceId.startsWith("addon-environment:")) {
    return null;
  }
  const runtime = getActiveAddonRuntime();
  const body = parseResult?.figure.body;
  if (!runtime || !body) {
    return null;
  }
  const statement = findAddonStatement(body, sourceId);
  if (!statement) {
    return null;
  }
  const ui = runtime.uis.get(statement.addonId);
  if (!ui?.inspector) {
    return null;
  }
  try {
    const sections = ui.inspector(statement);
    return sections.length > 0 ? { addonId: statement.addonId, sourceId, sections } : null;
  } catch {
    return null;
  }
}
