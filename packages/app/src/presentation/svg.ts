import { useId, useMemo } from "react";

/** Multiple previews share one DOM; SVG clip/gradient IDs must remain local to their slot. */
export function scopePresentationSvg(svg: string, prefix: string): string {
  const ids = new Set(Array.from(svg.matchAll(/\sid=(["'])(.*?)\1/gu), match => match[2]));
  if (!ids.size) return svg;
  return svg
    .replace(/(\s)id=(["'])(.*?)\2/gu, (_match, space: string, quote: string, id: string) => `${space}id=${quote}${prefix}-${id}${quote}`)
    .replace(/url\((["']?)#([^)'"\s]+)\1\)/gu, (match: string, quote: string, id: string) => ids.has(id) ? `url(${quote}#${prefix}-${id}${quote})` : match)
    .replace(/(\s(?:xlink:)?href=)(["'])#([^"']+)\2/gu, (match: string, attr: string, quote: string, id: string) => ids.has(id) ? `${attr}${quote}#${prefix}-${id}${quote}` : match);
}
export function usePresentationSvg(svg: string | null): string {
  const id = useId().replace(/[^A-Za-z0-9_-]/gu, "");
  return useMemo(() => svg ? scopePresentationSvg(svg, `presentation-${id}`) : "", [svg, id]);
}
