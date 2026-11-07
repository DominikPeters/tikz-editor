import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "./syntax.js";
import { resolveBeamerThemeColorRgb } from "./theme/resolve.js";
import { beamerColorRgbToCss, type BeamerColorRgb } from "./theme/color-declarations.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";

/** usebeamercolor updates the local bg alias. Nested block color expressions
 * are evaluated against that alias, with unrounded xcolor channels. */
export function createBeamerAmbientBlockTheme(source: string, baseAt: (offset: number) => ResolvedBeamerTheme): (offset: number) => ResolvedBeamerTheme {
  const context = createBeamerSyntaxContext(source);
  const blocks = [...matchTexSyntaxEnvironments(context.syntax).values()]
    .filter(env => ["block", "alertblock", "exampleblock"].includes(env.name))
    .sort((a, b) => a.begin.span.from - b.begin.span.from);
  const cache = new Map<number, ResolvedBeamerTheme>();
  const withBackground = (theme: ResolvedBeamerTheme, bg: BeamerColorRgb): ResolvedBeamerTheme => ({ ...theme,
    colorAliases: { ...theme.colorAliases, bg: beamerColorRgbToCss(bg) },
    colorAliasRgb: { ...theme.colorAliasRgb, bg },
  });
  return offset => {
    const cached = cache.get(offset);
    if (cached) return cached;
    const base = baseAt(offset);
    let bg: BeamerColorRgb = resolveBeamerThemeColorRgb(base, "normal text", "bg") ?? [1, 1, 1];
    for (const env of blocks) {
      if (env.begin.span.from >= offset || env.end.span.from <= offset) continue;
      const title = beamerRequiredArgumentAfter(context, env.begin.span.to, env.contentSpan.to);
      const part = title && offset < title.span.to ? "title" : "body";
      const suffix = env.name === "alertblock" ? " alerted" : env.name === "exampleblock" ? " example" : "";
      bg = resolveBeamerThemeColorRgb(withBackground(baseAt(env.begin.span.from), bg), `block ${part}${suffix}`, "bg") ?? bg;
    }
    const result = withBackground(base, bg);
    cache.set(offset, result);
    return result;
  };
}
