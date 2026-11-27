/**
 * Document lengths in axis options (`width=0.48\linewidth`, `\axisdefaultwidth`,
 * user registers set with `\setlength`), behaviour section Y.
 *
 * The values come from, in order: the host (a Beamer frame knows the width
 * the picture is set in), the document class and its options as LuaLaTeX
 * gives them (measured, Y1), and LaTeX's article class at 10pt for a bare
 * picture or an unknown class, which is then reported.
 */
import { evaluateTexLengthExpression, texDecimalTimesDimensionPt } from "../text/tex/dimensions.js";

export type DocumentLengths = {
  textwidth: number;
  textheight: number;
  linewidth: number;
  columnwidth: number;
  paperwidth: number;
  paperheight: number;
};

/** What the evaluator substitutes, and whether a value was assumed rather than known. */
export type DocumentLengthEnvironment = {
  lengths: DocumentLengths;
  /** User length registers (`\newlength` + `\setlength`), pt, by name without backslash. */
  registers: ReadonlyMap<string, number>;
  /** Set when the class is not one of the measured ones: what was assumed instead. */
  assumption?: string;
};

const LETTER = { paperwidth: 614.295, paperheight: 794.96999 };
const A4 = { paperwidth: 597.50787, paperheight: 845.04684 };

/**
 * Y1 — LuaLaTeX (TeX Live 2023) values of `\textwidth`, `\textheight`,
 * `\columnwidth` after `\begin{document}` for the standard classes, by size
 * option and paper (letter unless `a4paper`); `twocolumn` sets `\columnwidth`
 * to (textwidth − 10pt)/2. `\linewidth` equals `\columnwidth` in the body.
 */
const ARTICLE: Record<string, { textwidth: number; textheight: number; twocolumnWidth: number }> = {
  "10pt/letter": { textwidth: 345, textheight: 550, twocolumnWidth: 469 },
  "11pt/letter": { textwidth: 360, textheight: 541.40024, twocolumnWidth: 469 },
  "12pt/letter": { textwidth: 390, textheight: 548.5, twocolumnWidth: 469 },
  "10pt/a4": { textwidth: 345, textheight: 598, twocolumnWidth: 452 },
  "11pt/a4": { textwidth: 360, textheight: 595.80026, twocolumnWidth: 452 },
  "12pt/a4": { textwidth: 390, textheight: 592, twocolumnWidth: 452 }
};

const MAXDIMEN = 16383.99998;

export const ARTICLE_10PT_LENGTHS: DocumentLengths = { textwidth: 345, textheight: 550, linewidth: 345, columnwidth: 345, ...LETTER };

/** The lengths of the document's class, or article 10pt with the reason it was assumed. */
export function documentClassLengths(source: string): { lengths: DocumentLengths; assumption?: string } {
  const match = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{\s*([^{}\s]+)\s*\}/u.exec(stripComments(source.slice(0, 20000)));
  if (!match) return { lengths: ARTICLE_10PT_LENGTHS, assumption: "no document class (a bare picture): LaTeX's article class at 10pt" };
  const options = (match[1] ?? "").split(",").map((o) => o.trim());
  const cls = match[2] ?? "";
  const size = options.find((o) => /^1[012]pt$/u.test(o)) ?? "10pt";
  const a4 = options.includes("a4paper");
  const paper = a4 ? A4 : LETTER;
  const twocolumn = options.includes("twocolumn");
  const article = ARTICLE[`${size}/${a4 ? "a4" : "letter"}`] ?? ARTICLE["10pt/letter"];
  if (!article) return { lengths: ARTICLE_10PT_LENGTHS };
  if (cls === "article" || cls === "standalone") {
    // standalone: article's widths; its \textheight is \maxdimen (measured).
    const textwidth = twocolumn && cls === "article" ? article.twocolumnWidth : article.textwidth;
    const column = twocolumn && cls === "article" ? (textwidth - 10) / 2 : textwidth;
    return { lengths: { textwidth, textheight: cls === "standalone" ? MAXDIMEN : article.textheight, linewidth: column, columnwidth: column, ...paper } };
  }
  if (cls === "amsart") return { lengths: { textwidth: 360, textheight: 584, linewidth: 360, columnwidth: 360, ...paper } };
  if (cls === "beamer") return { lengths: { textwidth: 307.28987, textheight: 269.14662, linewidth: 307.28987, columnwidth: 307.28987, paperwidth: 364.19536, paperheight: 273.14662 } };
  return { lengths: ARTICLE_10PT_LENGTHS, assumption: `the document class \`${cls}\` is not one the editor knows: LaTeX's article class at 10pt` };
}

function stripComments(text: string): string {
  return text.replace(/(?<!\\)%[^\n]*/gu, "");
}

/**
 * Y2 — user registers: `\newlength{\a}` (0pt), `\setlength{\a}{…}`,
 * `\addtolength{\a}{…}`, executed in source order before `limit`; values may
 * use the document lengths and earlier registers (`0.45\textwidth`).
 */
export function scanLengthRegisters(source: string, limit: number, lengths: DocumentLengths): Map<string, number> {
  const registers = new Map<string, number>();
  const text = stripComments(source.slice(0, limit));
  if (!/\\(?:newlength|setlength|addtolength)(?![A-Za-z@])/u.test(text)) return registers;
  const lookup = (name: string): number | undefined => registers.get(name) ?? builtinLength(name, lengths);
  const pattern = /\\(newlength|setlength|addtolength)\s*(?:\{\s*\\([A-Za-z@]+)\s*\}|\\([A-Za-z@]+))(?:\s*\{((?:[^{}]|\{[^{}]*\})*)\})?/gu;
  for (const match of text.matchAll(pattern)) {
    const name = match[2] ?? match[3] ?? "";
    if (match[1] === "newlength") { if (!registers.has(name)) registers.set(name, 0); continue; }
    if (match[4] === undefined) continue;
    const value = evaluateTexLengthExpression(match[4], lookup);
    if (value === null) continue;
    registers.set(name, match[1] === "setlength" ? value : (registers.get(name) ?? builtinLength(name, lengths) ?? 0) + value);
  }
  return registers;
}

function builtinLength(name: string, lengths: DocumentLengths): number | undefined {
  switch (name) {
    case "textwidth": return lengths.textwidth;
    case "textheight": return lengths.textheight;
    case "linewidth": return lengths.linewidth;
    case "columnwidth": return lengths.columnwidth;
    case "paperwidth": return lengths.paperwidth;
    case "paperheight": return lengths.paperheight;
    // pgfplots' documented defaults (behaviour A1).
    case "axisdefaultwidth": return 240;
    case "axisdefaultheight": return 207;
    default: return undefined;
  }
}

const DOCUMENT_NAMES = new Set(["textwidth", "textheight", "linewidth", "columnwidth", "paperwidth", "paperheight"]);

/**
 * Replaces `<factor>\name` by its value in pt (TeX's decimal × dimension
 * rounding) for the document lengths, `\axisdefaultwidth/height` and user
 * registers. Returns the text and the document lengths it used.
 */
export function substituteDocumentLengths(raw: string, env: DocumentLengthEnvironment): { text: string; used: string[] } {
  if (!raw.includes("\\")) return { text: raw, used: [] };
  const used: string[] = [];
  const text = raw.replace(/([+-]?(?:\d+(?:\.\d*)?|\.\d+))?\s*\\([A-Za-z@]+)(?![A-Za-z@])/gu, (whole, factor: string | undefined, name: string) => {
    // `\axisdefaultwidth` is a macro holding `240pt`, not a register: a factor
    // before it is concatenated as text (`0.8\axisdefaultwidth` = 0.8240pt, E18).
    if ((name === "axisdefaultwidth" || name === "axisdefaultheight") && !env.registers.has(name)) {
      return `${factor ?? ""}${name === "axisdefaultwidth" ? "240" : "207"}pt`;
    }
    const base = env.registers.get(name) ?? builtinLength(name, env.lengths);
    if (base === undefined) return whole;
    if (DOCUMENT_NAMES.has(name) && !env.registers.has(name)) used.push(name);
    const value = factor === undefined ? base : texDecimalTimesDimensionPt(factor, base) ?? Number(factor) * base;
    return `${Number(value.toFixed(5))}pt`;
  });
  return { text, used };
}
