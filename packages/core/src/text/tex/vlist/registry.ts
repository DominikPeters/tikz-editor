import type { TexVListLayout } from "./types.js";

export interface RegisteredTexVListLayout {
  readonly paragraphId: string;
  readonly layout: TexVListLayout;
}

const texVListLayoutsByOutputJax = new WeakMap<object, Map<string, TexVListLayout>>();

// Paragraph ids derive from position-anchored cache keys, so edits and drag
// frames register fresh ids continually; cap the registry (evicting the least
// recently registered ids) instead of growing for the session lifetime.
const TEX_VLIST_REGISTRY_LIMIT = 4096;

export function registerTexVListLayoutsOnOutputJax(
  outputJax: unknown,
  layouts: readonly RegisteredTexVListLayout[]
): void {
  if (!outputJax || typeof outputJax !== "object" || layouts.length === 0) {
    return;
  }
  const existing = texVListLayoutsByOutputJax.get(outputJax) ?? new Map<string, TexVListLayout>();
  for (const entry of layouts) {
    if (entry.paragraphId.length > 0) {
      existing.delete(entry.paragraphId);
      existing.set(entry.paragraphId, entry.layout);
    }
  }
  while (existing.size > TEX_VLIST_REGISTRY_LIMIT) {
    const oldest = existing.keys().next();
    if (oldest.done) {
      break;
    }
    existing.delete(oldest.value);
  }
  texVListLayoutsByOutputJax.set(outputJax, existing);
}

export function getTexVListLayoutsFromOutputJax(
  outputJax: unknown
): RegisteredTexVListLayout[] {
  if (!outputJax || typeof outputJax !== "object") {
    return [];
  }
  const layouts = texVListLayoutsByOutputJax.get(outputJax);
  if (!layouts) {
    return [];
  }
  return [...layouts.entries()].map(([paragraphId, layout]) => ({
    paragraphId,
    layout,
  }));
}

export function getTexVListLayoutFromOutputJax(
  outputJax: unknown,
  paragraphId: string | null | undefined
): TexVListLayout | null {
  if (!outputJax || typeof outputJax !== "object" || !paragraphId) {
    return null;
  }
  return texVListLayoutsByOutputJax.get(outputJax)?.get(paragraphId) ?? null;
}
