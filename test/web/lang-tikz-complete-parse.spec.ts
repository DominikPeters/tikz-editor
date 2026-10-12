/** @vitest-environment jsdom */

import { syntaxTreeAvailable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LRParser } from "@lezer/lr";
import { describe, expect, it } from "vitest";
import { tex } from "@tikz-editor/lang-tikz";

describe("complete syntax tree", () => {
  it("finishes parsing a long document in idle time, so edits reparse only around themselves", async () => {
    const section = String.raw`Some prose about the next figure, long enough to fill a few lines of text in the editor.
\begin{tikzpicture}
  \node[draw] (a) at (0,0) {Node $x_1$};
  \draw[->] (a) -- (1,1) node[right] {label};
\end{tikzpicture}
`;
    const doc = `\\documentclass{article}\n\\begin{document}\n${section.repeat(720)}\\end{document}\n`;
    expect(doc.length).toBeGreaterThan(150_000);
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [tex()] }), parent: document.body });
    for (let attempt = 0; attempt < 200 && !syntaxTreeAvailable(view.state, view.state.doc.length); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(true);

    const coldPictureParses: string[] = [];
    const createParse = LRParser.prototype.createParse;
    LRParser.prototype.createParse = function (input, fragments, ranges) {
      if (this.topNode.name === "TikzFile" && fragments.length === 0) coldPictureParses.push("TikzFile");
      return createParse.call(this, input, fragments, ranges);
    };
    try {
      const at = doc.indexOf("{label}") + 1;
      view.dispatch({ changes: { from: at, insert: "x" } });
      expect(syntaxTreeAvailable(view.state, view.state.doc.length)).toBe(true);
      expect(coldPictureParses).toEqual([]);
    } finally {
      LRParser.prototype.createParse = createParse;
      view.destroy();
    }
  }, 30_000);
});
