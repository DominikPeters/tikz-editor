import type { AddonTemplate } from "@tikz-editor/addon-api";

import { getActiveAddonRuntime } from "./registry";

export type AddonToolTemplate = AddonTemplate & { addonId: string };

/** All templates contributed by active add-ons, in add-on-id order. */
export function listAddonToolTemplates(): AddonToolTemplate[] {
  const runtime = getActiveAddonRuntime();
  if (!runtime) {
    return [];
  }
  const templates: AddonToolTemplate[] = [];
  for (const [addonId, ui] of [...runtime.uis.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const template of ui.templates ?? []) {
      templates.push({ ...template, addonId });
    }
  }
  return templates;
}
