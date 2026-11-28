/**
 * Insert templates for pgfplots axes (design/pgfplots.md Phase 6). The texts
 * are ours. The document gains `\pgfplotsset{compat=1.18}` (and, in a full
 * document, `\usepackage{pgfplots}`) when it has none, so the inserted axis
 * renders with the semantics the editor implements (design 4.5).
 */
import { userText, type EditedSource } from "../fragment.js";
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
  const hasDocumentClass = /\\documentclass\b/u.test(next);
  if (hasDocumentClass && !/\\usepackage(?:\[[^\]]*\])?\{[^}]*\bpgfplots\b[^}]*\}/u.test(next)) {
    const lastUse = [...next.matchAll(/^[^%\n]*\\usepackage[^\n]*$/gmu)].at(-1);
    const classLine = /^[^%\n]*\\documentclass[^\n]*$/mu.exec(next);
    const after = lastUse ?? classLine;
    const at = after ? after.index + after[0].length : 0;
    next = replaceSpan(next, { from: at, to: at }, userText("\n\\usepackage{pgfplots}", "pasted-tikz")).source;
  }
  if (!COMPAT_RE.test(next)) {
    if (hasDocumentClass) {
      const use = /^[^%\n]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\bpgfplots\b[^}]*\}[^\n]*$/mu.exec(next);
      const at = use ? use.index + use[0].length : 0;
      next = replaceSpan(next, { from: at, to: at }, userText("\n\\pgfplotsset{compat=1.18}", "pasted-tikz")).source;
    } else {
      const picture = /\\begin\{tikzpicture\}/u.exec(next);
      const at = picture ? picture.index : 0;
      next = replaceSpan(next, { from: at, to: at }, userText("\\pgfplotsset{compat=1.18}\n", "pasted-tikz")).source;
    }
  }
  // The edits above only insert text; the result is the source with them.
  return replaceSpan(next, { from: 0, to: 0 }, userText("", "pasted-tikz")).source;
}
