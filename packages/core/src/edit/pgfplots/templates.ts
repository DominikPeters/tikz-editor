/**
 * Insert templates for pgfplots axes (design/pgfplots.md Phase 6). The texts
 * are ours. The document gains `\pgfplotsset{compat=1.18}` (and, in a full
 * document, `\usepackage{pgfplots}`) when it has none, so the inserted axis
 * renders with the semantics the editor implements (design 4.5).
 */
import { userText, type EditedSource, type TikzFragment } from "../fragment.js";
import { replaceSpan } from "../patch.js";

export type PgfplotsTemplateKind = "function" | "data" | "bar";

export const PGFPLOTS_TEMPLATES: Record<PgfplotsTemplateKind, { label: string; text: string }> = {
  function: {
    label: "Function Plot",
    text: String.raw`\begin{axis}[xlabel={$x$}, ylabel={$f(x)$}, domain=-2:2, samples=50]
  \addplot {x^2 - 1};
  \addlegendentry{$x^2 - 1$}
\end{axis}`
  },
  data: {
    label: "Data Plot",
    text: String.raw`\begin{axis}[xlabel={Time}, ylabel={Value}]
  \addplot coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1) (4,4.8)};
  \addlegendentry{Measurements}
\end{axis}`
  },
  bar: {
    label: "Bar Chart",
    text: String.raw`\begin{axis}[ybar, ymin=0, xlabel={Quarter}, ylabel={Sales},
  symbolic x coords={Q1,Q2,Q3,Q4}, xtick=data]
  \addplot coordinates {(Q1,3) (Q2,5) (Q3,4) (Q4,6)};
\end{axis}`
  }
};

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
