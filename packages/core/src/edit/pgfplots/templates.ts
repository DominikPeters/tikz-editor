/**
 * Insert templates for pgfplots axes (design/pgfplots.md Phase 6). The texts
 * are ours. The document gains `\pgfplotsset{compat=1.18}` (and, in a full
 * document, `\usepackage{pgfplots}`) when it has none, so the inserted axis
 * renders with the semantics the editor implements (design 4.5).
 */
import { userText, type EditedSource, type TikzFragment } from "../fragment.js";
import { replaceSpan } from "../patch.js";
import { CHART_KINDS, type ChartKindId } from "./chart-kinds.js";

/** The insert templates are the chart kinds (chart-kinds.ts), one list for every insert command. */
export type PgfplotsTemplateKind = ChartKindId;

export const PGFPLOTS_TEMPLATES: Record<PgfplotsTemplateKind, { label: string; text: string }> = Object.fromEntries(
  CHART_KINDS.map((kind) => [kind.id, { label: kind.label, text: kind.template }])
) as Record<PgfplotsTemplateKind, { label: string; text: string }>;

const COMPAT_RE = /\\pgfplotsset\s*\{[^{}]*\bcompat\s*=/u;

/**
 * Adds what an axis needs to the document: `\pgfplotsset{compat=1.18}` when
 * no compat is set, after `\usepackage{pgfplots}` in a full document (which
 * is added after the last `\usepackage` when missing), before the first
 * picture otherwise. Returns the source unchanged when nothing is needed.
 */
export function ensurePgfplotsSetup(source: string): EditedSource {
  let next = source;
  if (/\\documentclass\b/u.test(next)) {
    // Back to front: each insertion leaves the offsets before it valid.
    for (const insertion of [...pgfplotsPreambleInsertions(next)].reverse()) {
      next = replaceSpan(next, { from: insertion.at, to: insertion.at }, insertion.text).source;
    }
  } else if (!COMPAT_RE.test(next)) {
    const picture = /\\begin\{tikzpicture\}/u.exec(next);
    const at = picture ? picture.index : 0;
    next = replaceSpan(next, { from: at, to: at }, userText("\\pgfplotsset{compat=1.18}\n", "pasted-tikz")).source;
  }
  // The edits above only insert text; the result is the source with them.
  return replaceSpan(next, { from: 0, to: 0 }, userText("", "pasted-tikz")).source;
}

/**
 * What a full document's preamble needs for an axis (a standalone picture, a
 * deck): `\usepackage{pgfplots}` after the last `\usepackage` (or the class
 * line) when no package loads it, then `\pgfplotsset{compat=1.18}` when no
 * compat is set. Insertions in the source as given, in source order; empty
 * when nothing is needed or the source has no `\documentclass`.
 */
export function pgfplotsPreambleInsertions(source: string): Array<{ at: number; text: TikzFragment }> {
  const classLine = /^[^%\n]*\\documentclass[^\n]*$/mu.exec(source);
  if (!classLine) return [];
  const beginDocument = /\\begin\s*\{document\}/u.exec(source);
  const preamble = source.slice(0, beginDocument ? beginDocument.index : source.length);
  const compat = COMPAT_RE.test(source) ? "" : "\n\\pgfplotsset{compat=1.18}";
  const use = /^[^%\n]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\bpgfplots\b[^}]*\}[^\n]*$/mu.exec(preamble);
  const after = use ?? [...preamble.matchAll(/^[^%\n]*\\usepackage[^\n]*$/gmu)].at(-1) ?? classLine;
  const text = `${use ? "" : "\n\\usepackage{pgfplots}"}${compat}`;
  return text ? [{ at: after.index + after[0].length, text: userText(text, "pasted-tikz") }] : [];
}
