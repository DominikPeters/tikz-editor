import { beamerDocumentParser } from "@tikz-editor/lezer-tex";
import type { Span } from "../ast/types.js";
import {
  concatMappedText, createIdentityMappedText, createMappedText,
  projectInputRange, sliceMappedText, type MappedText, type TextSourceProjection,
} from "../text/source-map.js";
import {
  getTexSyntaxIndex, matchTexSyntaxEnvironments, type TexSyntaxIndex,
} from "../text/tex/syntax-index.js";
import { computerModernTexMetricProvider } from "../text/tex/index.js";
import { createBeamerTexMathFontProfile, createBeamerTexTextFontProfile } from "./theme/font.js";
import type { BeamerThemeFont } from "./theme/types.js";
import type { BeamerDocumentModel, BeamerFrameModel } from "./types.js";
import { resolveBeamerOverlaySpanVisibility, type BeamerOverlayModel } from "./overlay.js";

export type BeamerFootnote = {
  span: Span;
  bodySpan: Span;
  number: number;
};

export type BeamerFootnoteIndex = ReadonlyMap<number, BeamerFootnote>;

function generatedFootnoteText(text: string, note: BeamerFootnote): MappedText {
  const projection: TextSourceProjection = { kind: "macro-generated", invocation: note.span, macroName: "footnote" };
  return createMappedText(text,
    Array.from({ length: text.length }, () => projection),
    Array.from({ length: text.length + 1 }, () => ({ kind: "range" as const, ...note.span, policy: "macro" as const, projection })));
}

/** Ordinary frame notes and explicit [frame] notes escape minipage insertion. */
export function buildBeamerFrameFootnotes(
  document: BeamerDocumentModel,
  syntax: TexSyntaxIndex,
  frame: BeamerFrameModel,
  overlaysByFrameId?: ReadonlyMap<string, BeamerOverlayModel>,
  step = 1,
  blocksAreMinipages = false
): BeamerFootnoteIndex {
  const notes = new Map<number, BeamerFootnote>();
  if (!syntax.controlsIn(frame.bodySpan).some((command) => command.name === "footnote")) return notes;
  const environments = [...matchTexSyntaxEnvironments(syntax).values()];
  const minipageEnvironments = new Set(["column", "minipage", ...(blocksAreMinipages
    ? ["block", "alertblock", "exampleblock", "proof", ...document.preamble.theoremDeclarations.map((declaration) => declaration.name)]
    : [])]);
  let counter = 0;
  for (const candidate of document.frames) {
    for (const command of syntax.controlsIn(candidate.bodySpan)) {
      if (command.name !== "footnote") continue;
      const overlays = overlaysByFrameId?.get(candidate.id);
      // Earlier frames leave the counter from their final overlay page;
      // \only removes an invocation, whereas \uncover still executes it.
      if (overlays && resolveBeamerOverlaySpanVisibility(overlays, command.span,
        candidate.id === frame.id ? step : overlays.stepCount) === "removed") continue;
      const overlay = syntax.argumentAfter(command.span.to, "overlay", candidate.bodySpan.to);
      const optional = syntax.argumentAfter(overlay?.span.to ?? command.span.to, "optional", candidate.bodySpan.to);
      const trailingOverlay = !overlay && optional ? syntax.argumentAfter(optional.span.to, "overlay", candidate.bodySpan.to) : null;
      const body = syntax.argumentAfter(trailingOverlay?.span.to ?? optional?.span.to ?? overlay?.span.to ?? command.span.to, "required", candidate.bodySpan.to);
      if (!body?.complete) continue;
      const option = optional ? syntax.source.slice(optional.contentSpan.from, optional.contentSpan.to) : "";
      const minipage = environments.some((env) => minipageEnvironments.has(env.name) && env.contentSpan.from <= command.span.from && command.span.to <= env.contentSpan.to);
      if (minipage && !option.split(",").some((part) => /^\s*frame(?:\s*=\s*true)?\s*$/u.test(part))) continue;
      const explicitNumber = option.split(",").find((part) => /^\s*\d+\s*$/u.test(part));
      const number = explicitNumber == null ? ++counter : Number(explicitNumber);
      if (candidate.id === frame.id) notes.set(command.span.from, {
        span: { from: command.span.from, to: body.span.to }, bodySpan: body.contentSpan, number,
      });
    }
    if (candidate.id === frame.id) break;
  }
  return notes;
}

/** LaTeX uses a scriptsize text hbox on an empty math superscript nucleus. */
export function beamerFootnoteMarkTex(number: number, font: BeamerThemeFont): string {
  const math = createBeamerTexMathFontProfile(font);
  const scriptSize = math.resolveMathFont({ family: "operators", style: "script", baseAtPt: font.sizePt }).atPt;
  const symbols = math.resolveMathFont({ family: "symbols", style: "text", baseAtPt: font.sizePt });
  const lift = Math.round((symbols.data.fontdimen.sup2 ?? 0) * symbols.atPt * 65536) / 65536;
  const profile = createBeamerTexTextFontProfile({ ...font, series: "medium", shape: "upright" });
  const markFont = profile.resolveTextFont(profile.defaultFontState, scriptSize, computerModernTexMetricProvider);
  const width = computerModernTexMetricProvider.shapeText(String(number), markFont).width + .5;
  const family = font.family === "sans" ? "sffamily" : font.family === "monospace" ? "ttfamily" : "rmfamily";
  return `\\makebox[${width}pt][l]{\\raisebox{${lift}pt}{\\${family}\\mdseries\\upshape\\fontsize{${scriptSize}pt}{${scriptSize}pt}\\selectfont ${number}}}`;
}

/** Replace the command by its source-addressed mark; the body is inserted once at frame bottom. */
export function projectBeamerFootnotes(mapped: MappedText, notes: BeamerFootnoteIndex | undefined, font: BeamerThemeFont): MappedText {
  if (!notes?.size || !/\\footnote(?![A-Za-z@])/u.test(mapped.text)) return mapped;
  const syntax = getTexSyntaxIndex(mapped.text, beamerDocumentParser);
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const command of syntax.controls) {
    if (command.name !== "footnote" || command.span.from < cursor) continue;
    const owner = projectInputRange(mapped.sourceMap, command.span.from, command.span.to);
    if (owner.kind !== "source-range") continue;
    const note = notes.get(owner.from);
    if (!note) continue;
    const overlay = syntax.argumentAfter(command.span.to, "overlay", mapped.text.length);
    const optional = syntax.argumentAfter(overlay?.span.to ?? command.span.to, "optional", mapped.text.length);
    const trailingOverlay = !overlay && optional ? syntax.argumentAfter(optional.span.to, "overlay", mapped.text.length) : null;
    const body = syntax.argumentAfter(trailingOverlay?.span.to ?? optional?.span.to ?? overlay?.span.to ?? command.span.to, "required", mapped.text.length);
    if (!body?.complete) continue;
    parts.push(sliceMappedText(mapped, cursor, command.span.from));
    parts.push(generatedFootnoteText(beamerFootnoteMarkTex(note.number, font), note));
    cursor = body.span.to;
  }
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

export function beamerFootnoteTextMapped(source: string, note: BeamerFootnote, font: BeamerThemeFont, projectedBody?: MappedText): MappedText {
  const body = projectedBody ?? createIdentityMappedText(source.slice(note.bodySpan.from, note.bodySpan.to), note.bodySpan.from);
  const start = body.text.length - body.text.trimStart().length;
  const end = body.text.trimEnd().length;
  return concatMappedText([
    generatedFootnoteText(`\\makebox[${1.8 * font.sizePt}pt][r]{${beamerFootnoteMarkTex(note.number, font)}}\\rule{0pt}{7.7pt}`, note),
    sliceMappedText(body, start, Math.max(start, end)),
    // The stock template's final strut contributes its depth even on short notes.
    generatedFootnoteText(`\\rule[-${.3 * font.lineHeightPt}pt]{0pt}{0pt}`, note),
  ]);
}
