import type { TexVListLayout } from "./types.js";

export interface RegisteredTexVListLayout {
  readonly paragraphId: string;
  readonly layout: TexVListLayout;
}

const texVListLayoutsByContext =
  new WeakMap<object, Map<string, TexVListLayout>>();

// Paragraph ids derive from position-anchored cache keys, so edits and drag
// frames register fresh ids continually; cap the registry instead of growing
// for the session lifetime.
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
    new Map<string, TexVListLayout>();
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
  texVListLayoutsByContext.set(layoutContext, existing);
}

export function getTexVListLayouts(
  layoutContext: unknown
): RegisteredTexVListLayout[] {
  if (!layoutContext || typeof layoutContext !== "object") {
    return [];
  }
  const layouts = texVListLayoutsByContext.get(layoutContext);
  if (!layouts) {
    return [];
  }
  return [...layouts.entries()].map(([paragraphId, layout]) => ({
    paragraphId,
    layout,
  }));
}

export function getTexVListLayout(
  layoutContext: unknown,
  paragraphId: string | null | undefined
): TexVListLayout | null {
  if (!layoutContext || typeof layoutContext !== "object" || !paragraphId) {
    return null;
  }
  return texVListLayoutsByContext.get(layoutContext)?.get(paragraphId) ?? null;
}
