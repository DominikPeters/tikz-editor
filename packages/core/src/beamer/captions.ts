import { resolveBeamerColumnWidth } from "./column-dimensions.js";
import { requireDefined } from "../utils/invariants.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { Span } from "../ast/types.js";
import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import { getTexSyntaxIndex, matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText, type MappedText } from "../text/source-map.js";
import { resolveBeamerThemeColor } from "./theme/resolve.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";
import { beamerNamedFontSize } from "./theme/font-sizes.js";

export interface BeamerCaptionLayoutOptions {
  readonly widthPt: number;
  readonly diagnostics?: Diagnostic[];
  /** Measures a font-selected caption as unbroken inline material. */
  readonly measure: (tex: string) => number;
}

/** Beamer floats are centered text flow, rather than deferred LaTeX floats. */
export function projectBeamerCaptions(mapped: MappedText, source: string, theme?: ResolvedBeamerTheme, layout?: BeamerCaptionLayoutOptions): MappedText {
  if (!/\\(?:begin\s*\{(?:figure|table)\}|setbeamertemplate(?![A-Za-z@]))/u.test(mapped.text)) return mapped;
  const syntax = getTexSyntaxIndex(mapped.text, beamerDocumentParser);
  const floats = [...matchTexSyntaxEnvironments(syntax).values()].filter(env => env.name === "figure" || env.name === "table");
  const subfigures = [...matchTexSyntaxEnvironments(syntax).values()].filter(env => env.name === "subfigure");
  const replacements: { span: Span; value: MappedText }[] = [];
  const documentSyntax = getTexSyntaxIndex(source, beamerDocumentParser);
  const documentEnvironments = [...matchTexSyntaxEnvironments(documentSyntax).values()];
  const captionPackage = documentSyntax.controls.some(command => {
    if (command.name !== "usepackage" && command.name !== "RequirePackage") return false;
    const option = documentSyntax.argumentAfter(command.span.to, "optional", source.length);
    const names = documentSyntax.argumentAfter(option?.span.to ?? command.span.to, "required", source.length);
    return names != null && source.slice(names.contentSpan.from, names.contentSpan.to)
      .split(",").some(name => name.trim() === "caption" || name.trim() === "subcaption");
  });
  const documentFloats = documentEnvironments.filter(env => env.name === "figure" || env.name === "table");
  const templateScopes = [...documentSyntax.groups, ...documentEnvironments];
  const documentSubfigures = documentEnvironments.filter(env => env.name === "subfigure");
  const captions = documentSyntax.controls.filter(command => command.name === "caption" &&
    !documentSubfigures.some(env => env.contentSpan.from <= command.span.from && command.span.to <= env.contentSpan.to));
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
  const captionFont = beamerNamedFontSize(String(theme?.options["class-font-size"] ?? "11"), "small");
  const captionFontDeclaration = `\\fontsize{${captionFont.sizePt}pt}{${captionFont.lineHeightPt}pt}\\selectfont`;
  for (const env of subfigures) {
    const float = floats.find(float => float.contentSpan.from <= env.span.from && env.span.to <= float.contentSpan.to);
    if (!float || !captionPackage || !layout) continue;
    const option = syntax.argumentAfter(env.begin.span.to, "optional", env.end.span.from);
    const widthArg = syntax.argumentAfter(option?.span.to ?? env.begin.span.to, "required", env.end.span.from);
    const width = widthArg && resolveBeamerColumnWidth(mapped.text.slice(widthArg.contentSpan.from, widthArg.contentSpan.to), layout.widthPt, layout.widthPt);
    const alignment = option ? mapped.text.slice(option.contentSpan.from, option.contentSpan.to).trim() : "b";
    const configured = documentSyntax.controls.some(command => command.name === "captionsetup" || ((command.name === "usepackage" || command.name === "RequirePackage") && (() => {
      const option = documentSyntax.argumentAfter(command.span.to, "optional", source.length);
      const names = option && documentSyntax.argumentAfter(option.span.to, "required", source.length);
      return names != null && source.slice(names.contentSpan.from, names.contentSpan.to).split(",").some(name => ["caption", "subcaption"].includes(name.trim()));
    })()));
    const panelCaptions = syntax.controlsIn(env.contentSpan).filter(command => command.name === "caption");
    if (!widthArg || width == null || width > layout.widthPt || alignment !== "b" || configured || panelCaptions.length !== 1 || panelCaptions[0]?.starSpan) {
      const hit = projectInputRange(mapped.sourceMap, env.span.from, env.span.to);
      layout.diagnostics?.push({ severity: "warning", code: "beamer-subfigure-unsupported", message: "Subfigures support explicit widths, bottom alignment and one default numbered caption per image panel; custom caption settings and other panel forms remain literal.", span: hit.kind === "source-range" ? { from: hit.from, to: hit.to } : { from: 0, to: 0 } });
      continue;
    }
    const panelIndex = subfigures.filter(panel => float.contentSpan.from <= panel.span.from && panel.span.from < env.span.from).length;
    const label = String.fromCharCode(97 + panelIndex);
    const font = beamerNamedFontSize(String(theme?.options["class-font-size"] ?? "11"), "footnotesize");
    const parts: MappedText[] = [generated(`\\scalebox{1}{\\begin{minipage}[${alignment}]{${width}pt}`, env.begin.span)];
    let cursor = widthArg.span.to;
    for (const command of syntax.controlsIn({ from: cursor, to: env.end.span.from })) {
      if (command.name !== "caption") continue;
      const short = syntax.argumentAfter(command.span.to, "optional", env.end.span.from);
      const argument = syntax.argumentAfter(short?.span.to ?? command.span.to, "required", env.end.span.from);
      if (!argument) continue;
      const span = { from: command.span.from, to: argument.span.to };
      const content = sliceMappedText(mapped, argument.contentSpan.from, argument.contentSpan.to);
      const prefix = `\\fontsize{${font.sizePt}pt}{${font.lineHeightPt}pt}\\selectfont`;
      const labelText = command.starSpan ? "" : `{\\color{${captionColor}}(${label})} `;
      const fits = layout.measure(`${prefix}${labelText}${content.text}`) <= width;
      parts.push(sliceMappedText(mapped, cursor, command.span.from),
        generated(`\\par\\vskip6pt\\nointerlineskip\\begin{minipage}[b]{${width}pt}\\${fits ? "centering" : "raggedright"}${prefix}\\strut{}${labelText}`, span),
        content, generated("\\strut\\end{minipage}\\par\\vskip7pt", span));
      cursor = argument.span.to;
    }
    parts.push(sliceMappedText(mapped, cursor, env.end.span.from), generated("\\end{minipage}}", env.end.span));
    replacements.push({ span: env.span, value: concatMappedText(parts) });
  }
  for (const float of floats) {
    const panels = subfigures.filter(panel => float.contentSpan.from <= panel.span.from && panel.span.to <= float.contentSpan.to);
    const widths = panels.map(panel => {
      const option = syntax.argumentAfter(panel.begin.span.to, "optional", panel.end.span.from);
      const arg = syntax.argumentAfter(option?.span.to ?? panel.begin.span.to, "required", panel.end.span.from);
      return arg && layout ? resolveBeamerColumnWidth(mapped.text.slice(arg.contentSpan.from, arg.contentSpan.to), layout.widthPt, layout.widthPt) : null;
    });
    if (layout && panels.length > 1 && widths.every(width => width !== null)) {
      const free = Math.max(0, layout.widthPt - widths.reduce((sum, width) => sum + width, 0));
      const fills = syntax.controlsIn(float.contentSpan).filter(command => command.name === "hfill" && !panels.some(panel => panel.span.from <= command.span.from && command.span.to <= panel.span.to));
      for (const fill of fills) {
        let to = fill.span.to; while (/\s/u.test(mapped.text[to] ?? "") && to < float.end.span.from) to++;
        replacements.push({ span: { from: fill.span.from, to }, value: generated(`\\makebox[${free / fills.length}pt]{}`, fill.span) });
      }
    }
  }
  for (const env of floats) {
    const placement = syntax.argumentAfter(env.begin.span.to, "optional", env.end.span.from);
    replacements.push({ span: { from: env.begin.span.from, to: placement?.span.to ?? env.begin.span.to }, value: generated("\\par\\penalty10000\\begin{center}\\penalty10000", env.begin.span) });
    replacements.push({ span: env.end.span, value: generated("\\par\\penalty10000\\end{center}", env.end.span) });
    for (const command of syntax.controlsIn(env.contentSpan)) {
      if (subfigures.some(panel => panel.contentSpan.from <= command.span.from && command.span.to <= panel.contentSpan.to)) continue;
      if (command.name === "centering") {
        replacements.push({ span: command.span, value: generated("", command.span) });
        continue;
      }
      if (command.name !== "caption") continue;
      // Stock Beamer has no starred caption command; the caption package
      // supplies it. Keep unsupported authored syntax visible otherwise.
      if (command.starSpan && !captionPackage) continue;
      const optional = syntax.argumentAfter(command.span.to, "optional", env.contentSpan.to);
      const argument = syntax.argumentAfter(optional?.span.to ?? command.span.to, "required", env.contentSpan.to);
      if (!argument?.complete) continue;
      const span = { from: command.span.from, to: argument.span.to };
      const hit = projectInputRange(mapped.sourceMap, span.from, span.to);
      const sourceStart = hit.kind === "source-range" ? hit.from : 0;
      const name = env.name === "figure" ? "Figure" : "Table";
      const unnumbered = captionPackage && command.starSpan != null;
      const number = captions.filter(caption => !(captionPackage && caption.starSpan != null) && caption.span.from <= sourceStart && documentFloats.some(float => float.name === env.name && float.contentSpan.from <= caption.span.from && caption.span.to <= float.contentSpan.to)).length;
      const numbered = templateAt("caption", sourceStart, "default") === "numbered";
      const separatorName = templateAt("caption label separator", sourceStart, "colon");
      const separator = ({ none: "", colon: ":\\ ", period: ".\\ ", space: "\\ ", quad: "\\quad\\ ", endash: "\\ --\\ " } as Record<string, string>)[separatorName] ?? ":\\ ";
      // \caption applies \ignorespaces, including leading comments/newlines.
      const leadingTrivia = requireDefined(/^(?:\s|%[^\r\n]*(?:\r\n|\r|\n|$))*/u.exec(mapped.text.slice(argument.contentSpan.from, argument.contentSpan.to)), "Expected an internal captions value")[0].length;
      const content = sliceMappedText(mapped, argument.contentSpan.from + leadingTrivia, argument.contentSpan.to);
      const label = unnumbered ? "" : `{\\color{${captionColor}}${name}${numbered ? `~${number}` : ""}${captionPackage && content.text === "" ? "" : separator}}`;
      if (captionPackage && layout) {
        // caption3.sty uses a bottom-aligned \parbox, initial/final struts,
        // and singlelinecheck. Its Beamer adapter centers a short caption
        // and keeps a longer paragraph ragged right.
        const font = captionFontDeclaration;
        const fits = layout.measure(`${font}{}${label}${content.text}`) <= layout.widthPt;
        replacements.push({ span, value: concatMappedText([
          generated(`\\par\\vskip7pt\\nointerlineskip\\begin{minipage}[b]{${layout.widthPt}pt}\\${fits ? "centering" : "raggedright"}${font}\\strut{}${label}`, span),
          content,
          generated("\\strut\\end{minipage}\\par\\vskip7pt", span),
        ]) });
        continue;
      }
      // beamerbaselocalstructure.sty: both caption skips are 7pt; the
      // default caption font is \small and its short caption is an hbox.
      replacements.push({ span, value: concatMappedText([
        generated(`\\par\\vskip7pt{${captionFontDeclaration}\\mbox{${label}`, span),
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
