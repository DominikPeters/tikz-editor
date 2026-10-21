import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beamerCompiledPages, beamerTexEngine, createBeamerCompileDocument } from "../packages/core/src/beamer/index.js";

const runTex = process.env.BEAMER_ORACLE_TESTS === "1" && spawnSync("pdflatex", ["--version"], { stdio: "ignore" }).status === 0;

const deck = (preamble: string, body = "\\begin{frame}{A}\n  Text.\n\\end{frame}\n") =>
  `\\documentclass{beamer}\n${preamble}\\begin{document}\n${body}\\end{document}\n`;

describe("beamer compile engine", () => {
  it("follows a % !TEX program line, then what the preamble loads", () => {
    expect(beamerTexEngine(deck(""))).toBe("pdflatex");
    expect(beamerTexEngine(`% !TEX program = xelatex\n${deck("")}`)).toBe("xelatex");
    expect(beamerTexEngine(`%!TeX TS-program = LuaLaTeX\n${deck("\\usepackage{fontspec}\n")}`)).toBe("lualatex");
    expect(beamerTexEngine(`% !TEX program = pdflatex\n${deck("\\usepackage{fontspec}\n")}`)).toBe("pdflatex");
    expect(beamerTexEngine(deck("\\usepackage[T1]{fontenc}\n\\usepackage{amsmath,fontspec}\n"))).toBe("xelatex");
    expect(beamerTexEngine(deck("\\usepackage{fontspec}\n\\usepackage{luacode}\n"))).toBe("lualatex");
    expect(beamerTexEngine(deck("% \\usepackage{fontspec}\n"))).toBe("pdflatex");
  });
});

describe("beamer compile document", () => {
  it("marks each frame on a line of its own before \\end{frame}, or inline in a one-line frame", () => {
    const source = deck("\\usetheme{default}\n", [
      "\\begin{frame}[fragile]{Code}\n\\begin{verbatim}\nx\n\\end{verbatim}\n\\end{frame}\n",
      "\\begin{frame}{Inline}\\centering Text.\\end{frame}\n",
      "  \\begin{frame}\n    Indented.\n  \\end{frame}\n",
    ].join(""));
    const { text, engine } = createBeamerCompileDocument(source);
    expect(engine).toBe("pdflatex");
    expect(text).toContain("\\end{verbatim}\n\\TikzEditorFrame{0}%\n\\end{frame}");
    expect(text).toContain("\\centering Text.\\TikzEditorFrame{1}\\end{frame}");
    expect(text).toContain("    Indented.\n\\TikzEditorFrame{2}%\n  \\end{frame}");
    const preambleEnd = text.indexOf("\\begin{document}");
    expect(text.slice(0, preambleEnd)).toContain("\\AddToHook{shipout/before}");
    // Nothing else changes.
    const stripped = text.slice(0, text.indexOf("\n% TikZ Editor")) + text.slice(preambleEnd)
      .replace(/\\TikzEditorFrame\{\d+\}%\n/gu, "").replace(/\\TikzEditorFrame\{\d+\}/gu, "");
    expect(stripped).toBe(source);
  });

  it("finds each frame's pages past note pages and a later \\againframe", () => {
    const pages = beamerCompiledPages("page\npage 0\npage\npage 0\npage\npage 1\npage 0\npage 2\npage 2\n");
    expect(pages.pageCount).toBe(9);
    expect(pages.pageFrames).toEqual([null, 0, null, 0, null, 1, 0, 2, 2]);
    expect([...pages.framePages]).toEqual([[0, [2, 4]], [1, [6]], [2, [8, 9]]]);
  });

  it("reads pgfpages sheets as the PDF's pages", () => {
    const pages = beamerCompiledPages("page\npage\nsheet\npage 0\npage\nsheet\npage 0\npage\nsheet\n");
    expect(pages.pageFrames).toEqual([null, 0, 0]);
    expect(pages.framePages.get(0)).toEqual([2, 3]);
  });

  it.skipIf(!runTex)("maps pdflatex's pages to frames: builds, notes, breaks, \\againframe and section frames", () => {
    const source = String.raw`\documentclass{beamer}
\setbeameroption{show notes}
\AtBeginSection[]{\begin{frame}{Outline}\tableofcontents[currentsection]\end{frame}}
\begin{document}
\section{A}
\begin{frame}[label=eggs]{Eggs}
  First.\pause Second.\note{Say it.}
\end{frame}
\begin{frame}[fragile]{Code}
\begin{verbatim}
x = 1
\end{verbatim}
\end{frame}
\section{B}
\begin{frame}[allowframebreaks]{Long}
${Array.from({ length: 40 }, (_, line) => `  Line ${line}\\par`).join("\n")}
\end{frame}
\againframe<2>{eggs}
\begin{frame}{Last}\only<1>{a}\only<2>{b}\end{frame}
\end{document}
`;
    const directory = mkdtempSync(join(tmpdir(), "beamer-compile-"));
    try {
      writeFileSync(join(directory, "input.tex"), createBeamerCompileDocument(source).text);
      for (let run = 0; run < 2; run++) {
        execFileSync("pdflatex", ["-interaction=batchmode", "-halt-on-error", "input.tex"], { cwd: directory, stdio: "ignore" });
      }
      const pages = beamerCompiledPages(readFileSync(join(directory, "input.marks"), "utf8"));
      const pdfPages = /Output written on input\.pdf \((\d+) pages?/u.exec(readFileSync(join(directory, "input.log"), "utf8"))?.[1];
      expect(pages.pageCount).toBe(Number(pdfPages));
      // Outline, then eggs's two builds, each followed by its note page.
      expect(pages.framePages.get(0)).toEqual([2, 4]);
      expect(pages.pageFrames.slice(0, 5)).toEqual([null, 0, null, 0, null]);
      expect(pages.framePages.get(1)).toEqual([6]);
      expect(pages.framePages.get(2)?.length).toBeGreaterThan(1);
      expect(pages.framePages.get(3)).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
