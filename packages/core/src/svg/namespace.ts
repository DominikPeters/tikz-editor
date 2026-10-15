import { requireArrayValue } from "../utils/collections.js";
import type { SvgRenderModel } from "./types.js";

/** Give each embedded picture its own SVG definitions and fragment references. */
export function namespaceSvgModel(model: SvgRenderModel, namespace: string): SvgRenderModel {
  // Escape underscores too, making this encoding injective for arbitrary names.
  const prefix = `tikz-${namespace.replace(/[^A-Za-z0-9-]/gu, char => `_${char.codePointAt(0)!.toString(16)}_`)}-`;
  const ids = new Map<string, string>();
  const idAttribute = /(\s)id\s*=\s*(["'])([^"']+)\2/gu;
  for (const markup of [...model.defs, ...model.parts.map(part => part.markup)]) {
    for (const match of markup.matchAll(idAttribute)) ids.set(requireArrayValue(match, 3), prefix + match[3]);
  }
  if (ids.size === 0) return model;
  const rewrite = (markup: string): string => markup
    .replace(idAttribute, (_, space: string, quote: string, id: string) => `${space}id=${quote}${ids.get(id) ?? id}${quote}`)
    .replace(/url\(\s*(["']?)#([^\s"'()]+)\1\s*\)/gu,
      (whole: string, quote: string, id: string) => ids.has(id) ? `url(${quote}#${ids.get(id)!}${quote})` : whole)
    .replace(/(\s(?:xlink:)?href\s*=\s*)(["'])#([^"']+)\2/gu,
      (whole: string, attribute: string, quote: string, id: string) => ids.has(id) ? `${attribute}${quote}#${ids.get(id)!}${quote}` : whole)
    .replace(/(\saria-(?:labelledby|describedby)\s*=\s*)(["'])([^"']+)\2/gu,
      (_, attribute: string, quote: string, references: string) => `${attribute}${quote}${references.replace(/\S+/gu, id => ids.get(id) ?? id)}${quote}`);
  const defs = model.defs.map(rewrite);
  return { ...model, defs, defsFingerprint: defs.join(""), parts: model.parts.map(part => {
    const markup = rewrite(part.markup);
    return markup === part.markup ? part : { ...part, markup, fingerprint: markup };
  }) };
}
