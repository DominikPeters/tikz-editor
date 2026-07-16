import { useSyncExternalStore } from "react";

import type { AddonRuntime } from "@tikz-editor/core/addons/runtime";

import { setAddonScrubKeys } from "../ui/source-panel/number-scrubber";

/**
 * App-side holder for the active add-on runtime, mirroring the platform
 * adapter seam (platform/current.ts). The loader installs the runtime here;
 * the compute pipeline, edit dispatch, completion sources, and scrubber
 * read it. Consumers that must react to runtime changes (e.g. the compute
 * scheduler) subscribe via useAddonRuntimeRevision.
 */
let activeAddonRuntime: AddonRuntime | null = null;
let runtimeRevision = 0;
const listeners = new Set<() => void>();

export function setActiveAddonRuntime(runtime: AddonRuntime | null): void {
  activeAddonRuntime = runtime;
  runtimeRevision += 1;
  const tables = runtime
    ? [...runtime.engines.values()]
        .map((engine) => engine.completion?.scrubKeys)
        .filter((table): table is NonNullable<typeof table> => table != null)
    : [];
  setAddonScrubKeys(tables);
  for (const listener of listeners) {
    listener();
  }
}

export function getActiveAddonRuntime(): AddonRuntime | null {
  return activeAddonRuntime;
}

export function getAddonRuntimeRevision(): number {
  return runtimeRevision;
}

export function subscribeAddonRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: re-renders when the active add-on runtime changes. */
export function useAddonRuntimeRevision(): number {
  return useSyncExternalStore(subscribeAddonRuntime, getAddonRuntimeRevision);
}
