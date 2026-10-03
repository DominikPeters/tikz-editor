import type { Span } from "../ast/types.js";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import { getTexSyntaxIndex, matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText, type MappedText } from "../text/source-map.js";
import { resolveBeamerThemeColor } from "./theme/resolve.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";

/** Beamer floats are centered text flow, rather than deferred LaTeX floats. */
export function projectBeamerCaptions(mapped: MappedText, source: string, theme?: ResolvedBeamerTheme): MappedText {
  if (!/\\(?:begin\s*\{(?:figure|table)\}|setbeamertemplate(?![A-Za-z@]))/u.test(mapped.text)) return mapped;
  const syntax = getTexSyntaxIndex(mapped.text, beamerDocumentParser);
  const floats = [...matchTexSyntaxEnvironments(syntax).values()].filter(env => env.name === "figure" || env.name === "table");
  const replacements: { span: Span; value: MappedText }[] = [];
  const documentSyntax = getTexSyntaxIndex(source, beamerDocumentParser);
  const documentEnvironments = [...matchTexSyntaxEnvironments(documentSyntax).values()];
  const documentFloats = documentEnvironments.filter(env => env.name === "figure" || env.name === "table");
  const templateScopes = [...documentSyntax.groups, ...documentEnvironments];
  const captions = documentSyntax.controls.filter(command => command.name === "caption");
  const templateAt = (role: string, offset: number, fallback: string) => {
    let template = fallback;
    for (const command of documentSyntax.controlsIn({ from: 0, to: offset })) {
      if (command.name !== "setbeamertemplate") continue;
      // Beamer restores frame/environment and ordinary brace-local settings.
      if (templateScopes.some(scope => scope.contentSpan.from <= command.span.from && command.span.from < scope.contentSpan.to && !(scope.contentSpan.from <= offset && offset < scope.contentSpan.to))) continue;
      const name = documentSyntax.argumentAfter(command.span.to, "required", offset);
      const option = name && documentSyntax.argumentAfter(name.span.to, "optional", offset);
      if (name && option && source.slice(name.contentSpan.from, name.contentSpan.to) === role) template = source.slice(option.contentSpan.from, option.contentSpan.to);
    }
    return template;
  };
  const generated = (text: string, owner: Span) => {
    const hit = projectInputRange(mapped.sourceMap, owner.from, owner.to);
    return createGeneratedMappedText(text, "Beamer float/caption", hit.kind === "source-range" ? { from: hit.from, to: hit.to } : undefined);
  };
  const captionColor = theme ? resolveBeamerThemeColor(theme, "caption name").fg ?? "#3333b3" : "#3333b3";
  for (const env of floats) {
    const placement = syntax.argumentAfter(env.begin.span.to, "optional", env.end.span.from);
    replacements.push({ span: { from: env.begin.span.from, to: placement?.span.to ?? env.begin.span.to }, value: generated("\\par\\penalty10000\\begin{center}\\penalty10000", env.begin.span) });
    replacements.push({ span: env.end.span, value: generated("\\par\\penalty10000\\end{center}", env.end.span) });
    for (const command of syntax.controlsIn(env.contentSpan)) {
      if (command.name === "centering") {
        replacements.push({ span: command.span, value: generated("", command.span) });
        continue;
      }
      if (command.name !== "caption") continue;
      const optional = syntax.argumentAfter(command.span.to, "optional", env.contentSpan.to);
      const argument = syntax.argumentAfter(optional?.span.to ?? command.span.to, "required", env.contentSpan.to);
      if (!argument?.complete) continue;
      const span = { from: command.span.from, to: argument.span.to };
      const hit = projectInputRange(mapped.sourceMap, span.from, span.to);
      const sourceStart = hit.kind === "source-range" ? hit.from : 0;
      const name = env.name === "figure" ? "Figure" : "Table";
      const number = captions.filter(caption => caption.span.from <= sourceStart && documentFloats.some(float => float.name === env.name && float.contentSpan.from <= caption.span.from && caption.span.to <= float.contentSpan.to)).length;
      const numbered = templateAt("caption", sourceStart, "default") === "numbered";
      const separatorName = templateAt("caption label separator", sourceStart, "colon");
      const separator = ({ none: "", colon: ":\\ ", period: ".\\ ", space: "\\ ", quad: "\\quad\\ ", endash: "\\ --\\ " } as Record<string, string>)[separatorName] ?? ":\\ ";
      // \caption applies \ignorespaces, including leading comments/newlines.
      const leadingTrivia = /^(?:\s|%[^\r\n]*(?:\r\n|\r|\n|$))*/u.exec(mapped.text.slice(argument.contentSpan.from, argument.contentSpan.to))![0].length;
      const content = sliceMappedText(mapped, argument.contentSpan.from + leadingTrivia, argument.contentSpan.to);
      // beamerbaselocalstructure.sty: both caption skips are 7pt; the
      // default caption font is \small and its short caption is an hbox.
      replacements.push({ span, value: concatMappedText([
        generated(`\\par\\vskip7pt{\\fontsize{10pt}{12pt}\\selectfont\\mbox{{\\color{${captionColor}}${name}${numbered ? `~${number}` : ""}${separator}}`, span),
        content,
        generated("}}\\par\\vskip7pt", span),
      ]) });
    }
  }
  for (const command of syntax.controls) {
    if (command.name !== "setbeamertemplate") continue;
    const role = syntax.argumentAfter(command.span.to, "required", mapped.text.length);
    const option = role && syntax.argumentAfter(role.span.to, "optional", mapped.text.length);
    if (!role || !option) continue;
    const name = mapped.text.slice(role.contentSpan.from, role.contentSpan.to).trim();
    const value = mapped.text.slice(option.contentSpan.from, option.contentSpan.to).trim();
    if ((name === "caption" && ["default", "numbered"].includes(value)) ||
      (name === "caption label separator" && ["none", "colon", "period", "space", "quad", "endash"].includes(value))) {
      replacements.push({ span: { from: command.span.from, to: option.span.to }, value: generated("", command.span) });
    }
  }
  if (!replacements.length) return mapped;
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const replacement of replacements.sort((a, b) => a.span.from - b.span.from)) {
    if (replacement.span.from < cursor) continue;
    parts.push(sliceMappedText(mapped, cursor, replacement.span.from), replacement.value);
    cursor = replacement.span.to;
  }
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}
