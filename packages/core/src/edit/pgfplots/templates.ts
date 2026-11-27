/**
 * Insert templates for pgfplots axes (design/pgfplots.md Phase 6). The texts
 * are ours. The document gains `\pgfplotsset{compat=1.18}` (and, in a full
 * document, `\usepackage{pgfplots}`) when it has none, so the inserted axis
 * renders with the semantics the editor implements (design 4.5).
 */
import { userText, type EditedSource } from "../fragment.js";
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
  const hasDocumentClass = /\\documentclass\b/u.test(next);
  if (hasDocumentClass && !/\\usepackage(?:\[[^\]]*\])?\{[^}]*\bpgfplots\b[^}]*\}/u.test(next)) {
    const lastUse = [...next.matchAll(/^[^%\n]*\\usepackage[^\n]*$/gmu)].at(-1);
    const classLine = /^[^%\n]*\\documentclass[^\n]*$/mu.exec(next);
    const after = lastUse ?? classLine;
    const at = after ? (after.index ?? 0) + after[0].length : 0;
    next = replaceSpan(next, { from: at, to: at }, userText("\n\\usepackage{pgfplots}", "pasted-tikz")).source;
  }
  if (!COMPAT_RE.test(next)) {
    if (hasDocumentClass) {
      const use = /^[^%\n]*\\usepackage(?:\[[^\]]*\])?\{[^}]*\bpgfplots\b[^}]*\}[^\n]*$/mu.exec(next);
      const at = use ? (use.index ?? 0) + use[0].length : 0;
      next = replaceSpan(next, { from: at, to: at }, userText("\n\\pgfplotsset{compat=1.18}", "pasted-tikz")).source;
    } else {
      const picture = /\\begin\{tikzpicture\}/u.exec(next);
      const at = picture?.index ?? 0;
      next = replaceSpan(next, { from: at, to: at }, userText("\\pgfplotsset{compat=1.18}\n", "pasted-tikz")).source;
    }
  }
  // The edits above only insert text; the result is the source with them.
  return replaceSpan(next, { from: 0, to: 0 }, userText("", "pasted-tikz")).source;
}
