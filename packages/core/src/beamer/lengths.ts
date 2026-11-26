import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText, type MappedText } from "../text/source-map.js";
import { evaluateTexLengthExpression, texDecimalTimesDimensionPt } from "../text/tex/dimensions.js";
import { beamerClassPagePt } from "./geometry.js";
import { scanBeamerPoster } from "./poster.js";
import { preambleCommandScope } from "./preamble-edit-context.js";
import { beamerControlSequencesIn, beamerRequiredArgumentAfter, beamerSourceValueTokens, createBeamerSyntaxContext, type BeamerSyntaxContext } from "./syntax.js";
import type { BeamerDocumentModel } from "./types.js";

/** User length registers at the end of the preamble, in TeX points, by name without backslash. */
export type BeamerLengthRegisters = ReadonlyMap<string, number>;

const TEX_POINTS_PER_CM = 72.27 / 2.54;
// beamer.cls (and beamerposter) pass hmargin=1cm to geometry.
const GEOMETRY_HMARGINS_PT = 2 * TEX_POINTS_PER_CM;

/**
 * Execute the preamble's literal top-level length assignments in order:
 * `\newlength`, `\setlength` and `\addtolength`. Built-in registers have
 * the values TeX gives them in the preamble: `\paperwidth` and `\textwidth`
 * follow the class and beamerposter (and later assignments), while
 * `\linewidth` and `\columnwidth` keep the class's text width until the
 * document starts. `em` and `ex` are those of the class's normal font.
 */
export function scanBeamerLengthRegisters(
  document: BeamerDocumentModel,
  fontUnits: { readonly em: number; readonly ex: number },
  context: BeamerSyntaxContext = createBeamerSyntaxContext(document.source)
): { registers: BeamerLengthRegisters; diagnostics: readonly Diagnostic[] } {
  const registers = new Map<string, number>();
  const diagnostics: Diagnostic[] = [];
  const preamble = document.source.slice(document.preamble.span.from, document.preamble.span.to);
  if (!/\\(?:newlength|setlength|addtolength)(?![A-Za-z@])/u.test(preamble)) return { registers, diagnostics };
  const classPage = beamerClassPagePt(document);
  const builtin = new Map<string, number>([
    ["paperwidth", classPage.widthPt], ["paperheight", classPage.heightPt],
    ["textwidth", classPage.widthPt - GEOMETRY_HMARGINS_PT],
    ["linewidth", classPage.widthPt - GEOMETRY_HMARGINS_PT],
    ["columnwidth", classPage.widthPt - GEOMETRY_HMARGINS_PT],
  ]);
  const poster = scanBeamerPoster(document, context);
  const lookup = (name: string) => registers.get(name) ?? builtin.get(name);
  const unsupported = (span: Span, message: string) =>
    diagnostics.push({ severity: "warning", code: "beamer-length-unsupported", message, span });
  const limit = document.preamble.span.to;
  for (const command of beamerControlSequencesIn(context, document.preamble.span)) {
    if (command.from === poster?.span.from) {
      builtin.set("paperwidth", poster.geometryPaper.widthPt);
      builtin.set("paperheight", poster.geometryPaper.heightPt);
      builtin.set("textwidth", poster.geometryPaper.widthPt - GEOMETRY_HMARGINS_PT);
      continue;
    }
    if (command.name !== "newlength" && command.name !== "setlength" && command.name !== "addtolength") continue;
    const scope = preambleCommandScope(document, { from: command.from, to: command.to }, context);
    if (scope === "macro") continue;
    const target = beamerRequiredArgumentAfter(context, command.to, limit);
    const name = target ? /^\s*\\([A-Za-z@]+)\s*$/u.exec(beamerSourceValueTokens(context, target))?.[1] : undefined;
    const value = command.name === "newlength" || !target ? null : beamerRequiredArgumentAfter(context, target.span.to, limit);
    const span = { from: command.from, to: (value ?? target)?.span.to ?? command.to };
    if (scope !== "top-level") { unsupported(span, "Length assignments inside a group or conditional are not supported in this preview."); continue; }
    if (!name) { unsupported(span, "This length assignment's target is not a register name."); continue; }
    if (command.name === "newlength") { if (!registers.has(name)) registers.set(name, 0); continue; }
    if (!value) continue;
    const evaluated = evaluateTexLengthExpression(beamerSourceValueTokens(context, value), lookup, fontUnits);
    if (evaluated === null) { unsupported(span, "This length expression is not supported in this preview."); continue; }
    const next = command.name === "addtolength" ? (lookup(name) ?? 0) + evaluated : evaluated;
    if (builtin.has(name)) builtin.set(name, next);
    else registers.set(name, Math.round(next * 65536) / 65536);
  }
  return { registers, diagnostics };
}

/**
 * Replace uses of user length registers in text (`\colwidth`,
 * `0.5\colwidth`) by their values, so that dimension arguments such as
 * `\includegraphics[width=\colwidth]` or `\hspace{\sepwidth}` resolve. The
 * generated value owns the use's source range.
 */
export function projectBeamerLengthRegisters(mapped: MappedText, registers: BeamerLengthRegisters | undefined): MappedText {
  if (!registers || registers.size === 0) return mapped;
  const names = [...registers.keys()].filter(name => mapped.text.includes(`\\${name}`));
  if (names.length === 0) return mapped;
  const pattern = new RegExp(String.raw`(?<![\\A-Za-z@])([+-]?(?:\d+(?:\.\d*)?|\.\d+))?\s*\\(${names.map(name => name.replace(/[@]/gu, "\\@")).join("|")})(?![A-Za-z@])`, "gu");
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const match of mapped.text.matchAll(pattern)) {
    // A control word directly before the use (\setlength{\colwidth}...) is a
    // target, not a value: leave assignments and definitions alone.
    const before = mapped.text.slice(Math.max(0, match.index - 12), match.index);
    if (/\\(?:setlength|addtolength|newlength|settowidth|settoheight)\s*\{\s*$/u.test(before)) continue;
    const base = registers.get(match[2] ?? "") ?? 0;
    const value = match[1] === undefined ? base : texDecimalTimesDimensionPt(match[1], base) ?? base;
    const end = match.index + match[0].length;
    const owner = projectInputRange(mapped.sourceMap, match.index, end);
    parts.push(sliceMappedText(mapped, cursor, match.index),
      createGeneratedMappedText(`${Number(value.toFixed(5))}pt`, "length register", owner.kind === "source-range" ? { from: owner.from, to: owner.to } : undefined));
    cursor = end;
  }
  if (cursor === 0) return mapped;
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}

/** A dimension that may use user length registers, for column widths and the like. */
export function resolveBeamerLengthExpression(
  expression: string,
  widths: { readonly textWidth: number; readonly paperWidth: number; readonly lineWidth?: number },
  registers: BeamerLengthRegisters | undefined
): number | null {
  const builtin: Readonly<Record<string, number>> = {
    textwidth: widths.textWidth, linewidth: widths.lineWidth ?? widths.textWidth,
    columnwidth: widths.lineWidth ?? widths.textWidth, paperwidth: widths.paperWidth,
  };
  return evaluateTexLengthExpression(expression, name => registers?.get(name) ?? builtin[name]);
}
