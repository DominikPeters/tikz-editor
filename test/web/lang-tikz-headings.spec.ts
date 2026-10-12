/** @vitest-environment jsdom */

import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { beamer, tex } from "@tikz-editor/lang-tikz";

function headings(doc: string, language = beamer()): string[] {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [language] }), parent: document.body });
  ensureSyntaxTree(view.state, doc.length, 5_000);
  // Re-run the plugins against the completed tree.
  view.dispatch({});
  const titles = Array.from(view.dom.querySelectorAll(".cm-tex-heading")).map((element) => element.textContent ?? "");
  view.destroy();
  return titles;
}

describe("TeX heading titles", () => {
  it("marks section, frame title and subtitle arguments past stars, overlays and options", () => {
    const doc = String.raw`\section*{Introduction}
\subsection[short]{A longer title}
\begin{frame}<2>[fragile]{Overview}{A subtitle}
  Prose with {a group} and \textbf{bold}.
  \frametitle<3>{Late title}
\end{frame}
\begin{frame} % comment
  {Next-line title}

  {Not a subtitle after a blank line}
\end{frame}
\section
  {Body}`;
    expect(headings(doc)).toEqual(["Introduction", "A longer title", "Overview", "A subtitle", "Late title", "Next-line title", "Body"]);
  });

  it("marks sectioning titles in plain TeX documents", () => {
    expect(headings(String.raw`\section{Results} text \paragraph{Aside} more`, tex())).toEqual(["Results", "Aside"]);
  });
});
