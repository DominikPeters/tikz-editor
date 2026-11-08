import { requireDefined } from "../utils/invariants.js";
import type { SvgRenderModel } from "./types.js";

const urlReferenceAttributes = new Set([
  "fill", "stroke", "filter", "clip-path", "mask", "marker", "marker-start", "marker-mid", "marker-end", "cursor", "style"
]);

/** Give each embedded picture its own SVG definitions and fragment references. */
export function namespaceSvgModel(model: SvgRenderModel, namespace: string): SvgRenderModel {
  // Escape underscores too, making this encoding injective for arbitrary names.
  const prefix = `tikz-${namespace.replace(/[^A-Za-z0-9-]/gu, char => `_${requireDefined(char.codePointAt(0), "Expected an internal namespace value").toString(16)}_`)}-`;
  const ids = new Map<string, string>();
  for (const markup of [...model.defs, ...model.parts.map(part => part.markup)]) {
    mapSvgAttributes(markup, (name, value) => {
      if (name === "id") ids.set(value, prefix + value);
      return value;
    });
  }
  if (ids.size === 0) return model;
  const rewrite = (markup: string): string => mapSvgAttributes(markup, (name, value) => {
    if (name === "id") return ids.get(value) ?? value;
    if (name === "href" || name === "xlink:href") {
      const id = value.startsWith("#") ? ids.get(value.slice(1)) : undefined;
      return id ? `#${id}` : value;
    }
    if (name === "aria-labelledby" || name === "aria-describedby") return value.replace(/\S+/gu, id => ids.get(id) ?? id);
    if (!urlReferenceAttributes.has(name)) return value;
    return value.replace(/url\(\s*(["']?)#([^\s"'()]+)\1\s*\)/gu,
      (whole: string, quote: string, id: string) => ids.has(id) ? `url(${quote}#${requireDefined(ids.get(id), "Expected an internal namespace value")}${quote})` : whole);
  });
  const defs = model.defs.map(rewrite);
  return { ...model, defs, defsFingerprint: defs.join(""), parts: model.parts.map(part => {
    const markup = rewrite(part.markup);
    return markup === part.markup ? part : { ...part, markup, fingerprint: markup };
  }) };
}

/** Generated SVG has quoted attributes. Keep text, comments, and other values
 * outside the rewrite, even when they contain strings resembling attributes. */
function mapSvgAttributes(markup: string, map: (name: string, value: string) => string): string {
  return markup.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(?:[^<>"']|"[^"]*"|'[^']*')*>/gu, tag => {
    if (!/^<[A-Za-z]/u.test(tag)) return tag;
    return tag.replace(/(\s+)([^\s=/>]+)(\s*=\s*)(["'])([\s\S]*?)\4/gu,
      (whole: string, space: string, name: string, equals: string, quote: string, value: string) => {
        const next = map(name, value);
        return next === value ? whole : `${space}${name}${equals}${quote}${next}${quote}`;
      });
  });
}
