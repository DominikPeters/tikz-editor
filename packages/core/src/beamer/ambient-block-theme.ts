import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";
import { resolveBeamerThemeColorRgb } from "./theme/resolve.js";
import { beamerColorRgbToCss, type BeamerColorRgb } from "./theme/color-declarations.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";

/** Beamer block groups scope the bg alias and the local structure color.
 * Nested block expressions use the enclosing alias's unrounded channels. */
export function createBeamerAmbientBlockTheme(source: string, baseAt: (offset: number) => ResolvedBeamerTheme): (offset: number) => ResolvedBeamerTheme {
  const context = createBeamerSyntaxContext(source);
  const blocks = [...matchTexSyntaxEnvironments(context.syntax).values()]
    .filter(env => ["block", "alertblock", "exampleblock"].includes(env.name))
    .sort((a, b) => a.begin.span.from - b.begin.span.from);
  const cache = new Map<number, ResolvedBeamerTheme>();
  const withBlockColors = (theme: ResolvedBeamerTheme, bg: BeamerColorRgb, localStructureParent?: string): ResolvedBeamerTheme => ({ ...theme,
    ...(localStructureParent ? { colors: { ...theme.colors,
      "local structure": { ...theme.colors["local structure"], parent: localStructureParent } } } : {}),
    colorAliases: { ...theme.colorAliases, bg: beamerColorRgbToCss(bg) },
    colorAliasRgb: { ...theme.colorAliasRgb, bg },
  });
  return offset => {
    const cached = cache.get(offset);
    if (cached) return cached;
    const base = baseAt(offset);
    let bg: BeamerColorRgb = resolveBeamerThemeColorRgb(base, "normal text", "bg") ?? [1, 1, 1];
    let localStructureParent: string | undefined;
    for (const env of blocks) {
      if (env.begin.span.from > offset || env.end.span.from <= offset) continue;
      if (env.name === "alertblock") localStructureParent = "alerted text";
      if (env.name === "exampleblock") localStructureParent = "example text";
      // At the block's own begin, its colorbox still sees the enclosing bg.
      if (env.begin.span.from === offset) break;
      const title = beamerRequiredArgumentAfter(context, env.begin.span.to, env.contentSpan.to);
      const part = title && offset < title.span.to ? "title" : "body";
      const suffix = env.name === "alertblock" ? " alerted" : env.name === "exampleblock" ? " example" : "";
      bg = resolveBeamerThemeColorRgb(withBlockColors(baseAt(env.begin.span.from), bg, localStructureParent), `block ${part}${suffix}`, "bg") ?? bg;
    }
    const result = withBlockColors(base, bg, localStructureParent);
    cache.set(offset, result);
    return result;
  };
}
