import type { TexVListLayout } from "./types.js";

export interface RegisteredTexVListLayout {
  readonly paragraphId: string;
  readonly layout: TexVListLayout;
}

const texVListLayoutsByOutputJax = new WeakMap<object, Map<string, TexVListLayout>>();

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
      existing.set(entry.paragraphId, entry.layout);
    }
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
