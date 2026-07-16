import type { AddonRuntime } from "@tikz-editor/core";

import { setAddonScrubKeys } from "../ui/source-panel/number-scrubber";

/**
 * App-side holder for the active add-on runtime, mirroring the platform
 * adapter seam (platform/current.ts). The loader installs the runtime here;
 * the compute pipeline, completion sources, and scrubber read it.
 */
let activeAddonRuntime: AddonRuntime | null = null;

export function setActiveAddonRuntime(runtime: AddonRuntime | null): void {
  activeAddonRuntime = runtime;
  const tables = runtime
    ? [...runtime.engines.values()]
        .map((engine) => engine.completion?.scrubKeys)
        .filter((table): table is NonNullable<typeof table> => table != null)
    : [];
  setAddonScrubKeys(tables);
}

export function getActiveAddonRuntime(): AddonRuntime | null {
  return activeAddonRuntime;
}
