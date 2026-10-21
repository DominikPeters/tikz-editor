import type { TexVListLayout } from "./types.js";
import { getTextLayoutReportProvider } from "../../layout-context.js";
import { TexWeightedLruCache } from "../cache.js";
import { estimateVListLayoutBytes } from "../../layout-cache-size.js";

export interface RegisteredTexVListLayout {
  readonly paragraphId: string;
  readonly layout: TexVListLayout;
}

const texVListLayoutsByContext =
  new WeakMap<object, TexWeightedLruCache<string, RegisteredTexVListLayout>>();

// Standalone layouts use this registry; render/frame layouts share the
// lifetime of their owned entries through a context provider.
const TEX_VLIST_REGISTRY_LIMIT = 4096;

export function registerTexVListLayouts(
  layoutContext: unknown,
  layouts: readonly RegisteredTexVListLayout[]
): void {
  if (
    !layoutContext ||
    typeof layoutContext !== "object" ||
    layouts.length === 0
  ) {
    return;
  }
  const existing =
    texVListLayoutsByContext.get(layoutContext) ??
    new TexWeightedLruCache<string, RegisteredTexVListLayout>(TEX_VLIST_REGISTRY_LIMIT, 32 * 1024 * 1024, { retainOversizedEntry: true });
  for (const entry of layouts) {
    if (entry.paragraphId.length > 0) {
      existing.set(entry.paragraphId, entry, entry.paragraphId.length * 2 + estimateVListLayoutBytes(entry.layout));
    }
  }
  texVListLayoutsByContext.set(layoutContext, existing);
}

export function getTexVListLayouts(
  layoutContext: unknown
): RegisteredTexVListLayout[] {
  if (!layoutContext || typeof layoutContext !== "object") {
    return [];
  }
  const layouts = texVListLayoutsByContext.get(layoutContext);
  const registered = [...(layouts?.values() ?? [])];
  const owned = getTextLayoutReportProvider(layoutContext)?.getVListLayouts();
  if (!owned) return registered;
  const byId = new Map(registered.map((entry) => [entry.paragraphId, entry]));
  for (const entry of owned) byId.set(entry.paragraphId, entry);
  return [...byId.values()];
}

export function getTexVListLayout(
  layoutContext: unknown,
  paragraphId: string | null | undefined
): TexVListLayout | null {
  if (!layoutContext || typeof layoutContext !== "object" || !paragraphId) {
    return null;
  }
  return getTextLayoutReportProvider(layoutContext)?.getVListLayout(paragraphId) ??
    texVListLayoutsByContext.get(layoutContext)?.get(paragraphId)?.layout ?? null;
}
