import type { Span } from "../../ast/types.js";
import type { MappedText } from "../../text/source-map.js";
import { matchTexSyntaxEnvironments } from "../../text/tex/syntax-index.js";
import { createBeamerSyntaxContext } from "../syntax.js";
import type { BeamerDocumentModel } from "../types.js";
import { applyBeamerColorDeclaration, scanBeamerColorDeclarations } from "./color-declarations.js";
import { applyBeamerFontDeclaration, scanBeamerFontDeclarations } from "./font-declarations.js";
import { resolveBeamerThemeColor } from "./resolve.js";
import type { ResolvedBeamerTheme } from "./types.js";

export type BeamerScopedTheme = ReturnType<typeof createBeamerScopedTheme>;

/** Frame-local role assignments execute in source order and expire at their TeX group. */
export function createBeamerScopedTheme(document: BeamerDocumentModel, base: ResolvedBeamerTheme, span: Span) {
  const syntax = createBeamerSyntaxContext(document.source).syntax;
  const environments = [...matchTexSyntaxEnvironments(syntax).values()];
  const events = [...scanBeamerColorDeclarations(document, span, true), ...scanBeamerFontDeclarations(document, span, true)]
    .sort((a, b) => a.span.from - b.span.from).map(event => {
      let node = syntax.tree.resolveInner(event.span.from + 1, 1);
      let end = Math.min(span.to, ...environments.filter(environment =>
        environment.contentSpan.from <= event.span.from && event.span.to <= environment.contentSpan.to).map(environment => environment.contentSpan.to));
      while (node.parent) { node = node.parent; if (node.name === "Group") { end = Math.min(end, node.to); break; } }
      return { event, end };
    });
  return {
    at(offset: number): ResolvedBeamerTheme {
      const active = events.filter(({ event, end }) => event.span.to <= offset && offset < end);
      if (!active.length) return base;
      const state = { ...base, fonts: { ...base.fonts }, colors: { ...base.colors },
        colorAliases: { ...base.colorAliases }, colorAliasRgb: { ...base.colorAliasRgb }, diagnostics: [...base.diagnostics] };
      for (const { event } of active) {
        if (event.kind === "font-declaration") {
          state.fonts[event.role] = applyBeamerFontDeclaration(state.fonts[event.role], event, String(base.options["class-font-size"]));
        } else applyBeamerColorDeclaration(state, event, document.source, role => resolveBeamerThemeColor(state, role));
      }
      return state;
    },
    project(mapped: MappedText): MappedText {
      if (!events.length) return mapped;
      const text = mapped.text.split("").map((character, index) => {
        const origin = mapped.sourceMap.charOrigins[index];
        return origin?.kind === "direct" && events.some(({ event }) =>
          origin.from >= event.span.from && origin.to <= event.span.to) && character !== "\n" ? " " : character;
      }).join("");
      return { text, sourceMap: { ...mapped.sourceMap, inputText: text } };
    },
  };
}
