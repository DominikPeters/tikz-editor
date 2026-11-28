import { describe, expect, it } from "vitest";
import {
  createMinimalTikzSourceArtifact,
  createStandaloneLatexExportArtifact,
  DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME,
  normalizeStandaloneLatexExportFileName,
  STANDALONE_LATEX_EXPORT_MIME_TYPE
} from "../packages/core/src/export/index.js";

describe("standalone latex export helpers", () => {
  it("defaults to the standard export file name", () => {
    expect(normalizeStandaloneLatexExportFileName()).toBe(DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME);
    expect(normalizeStandaloneLatexExportFileName("   ")).toBe(DEFAULT_STANDALONE_LATEX_EXPORT_FILE_NAME);
  });

  it("appends the tex extension when omitted", () => {
    expect(normalizeStandaloneLatexExportFileName("diagram")).toBe("diagram.tex");
    expect(normalizeStandaloneLatexExportFileName("  diagram  ")).toBe("diagram.tex");
  });

  it("preserves an existing tex extension", () => {
    expect(normalizeStandaloneLatexExportFileName("diagram.tex")).toBe("diagram.tex");
    expect(normalizeStandaloneLatexExportFileName("diagram.TEX")).toBe("diagram.TEX");
  });

  it("exports a standalone document and infers required libraries", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- (1,0);
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.mimeType).toBe(STANDALONE_LATEX_EXPORT_MIME_TYPE);
    expect(artifact.text).toContain("\\documentclass{standalone}");
    expect(artifact.text).toContain("\\usepackage{tikz}");
    expect(artifact.text).toContain("\\usetikzlibrary{arrows.meta}");
    expect(artifact.text).toContain("\\begin{tikzpicture}");
    expect(artifact.text).toContain("\\end{document}");
  });

  it("includes reachable macro definitions in the standalone output", () => {
    const source = String.raw`\def\edgeend{(1,0)}
\begin{tikzpicture}
  \draw (0,0) -- \edgeend;
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.text).toContain(String.raw`\def\edgeend{(1,0)}`);
    expect(artifact.text).toContain(String.raw`\draw (0,0) -- \edgeend;`);
  });

  it("includes transitive macro aliases and command definitions used by the active figure", () => {
    const source = String.raw`\def\base{(1,0)}
\let\edgeend\base
\newcommand{\twostep}[1][\edgeend]{#1 -- (2,0)}
\begin{tikzpicture}
  \draw (0,0) -- \twostep;
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0",
      documentClassOptions: ["tikz", " border=2pt ", "tikz", ""]
    });

    expect(artifact.text).toContain(String.raw`\documentclass[tikz,border=2pt]{standalone}`);
    expect(artifact.text).toContain(String.raw`\def\base{(1,0)}`);
    expect(artifact.text).toContain(String.raw`\let\edgeend\base`);
    expect(artifact.text).toContain(String.raw`\newcommand{\twostep}[1][\edgeend]{#1 -- (2,0)}`);
  });

  it("creates a minimal editable TikZ source for an active figure", () => {
    const source = String.raw`\def\usedlabel{A}
\def\unused{Z}
\colorlet{accent}{blue}
\tikzset{accent line/.style={draw=accent,line width=2pt}}
This paragraph belongs to the paper, not the figure.
\begin{tikzpicture}
  \draw[accent line] (0,0) -- (1,0);
  \node at (0,0) {\usedlabel};
\end{tikzpicture}`;
    const artifact = createMinimalTikzSourceArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.complete).toBe(true);
    expect(artifact.text).toContain(String.raw`\def\usedlabel{A}`);
    expect(artifact.text).not.toContain(String.raw`\def\unused{Z}`);
    expect(artifact.text).toContain(String.raw`\colorlet{accent}{blue}`);
    expect(artifact.text).toContain(String.raw`\tikzset{accent line/.style={draw=accent,line width=2pt}}`);
    expect(artifact.text).not.toContain("This paragraph belongs to the paper");
    expect(artifact.text).toContain(String.raw`\begin{tikzpicture}`);
    expect(artifact.text).toContain(String.raw`\draw[accent line] (0,0) -- (1,0);`);
    expect(artifact.text).toContain(String.raw`\node at (0,0) {\usedlabel};`);
  });

  it("includes transitive style and color definitions used by the active figure", () => {
    const source = String.raw`\colorlet{accent}{blue}
\tikzset{accent line/.style={draw=accent,line width=2pt}}
\begin{tikzpicture}
  \draw[accent line] (0,0) -- (1,0);
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.complete).toBe(true);
    expect(artifact.text).toContain(String.raw`\colorlet{accent}{blue}`);
    expect(artifact.text).toContain(String.raw`\tikzset{accent line/.style={draw=accent,line width=2pt}}`);
  });

  it("exports figures that contain scoped nested statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.complete).toBe(true);
    expect(artifact.text).toContain(String.raw`\begin{scope}[xshift=1cm]`);
    expect(artifact.text).toContain(String.raw`\draw (0,0) -- (1,0);`);
  });

  it("falls back to the whole source when no active figure is selected or the id is stale", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;

    const noActive = createStandaloneLatexExportArtifact({ source, activeFigureId: null });
    const staleActive = createStandaloneLatexExportArtifact({ source, activeFigureId: "figure:stale" });

    expect(noActive.text.match(/\\begin\{tikzpicture\}/g)).toHaveLength(2);
    expect(staleActive.text.match(/\\begin\{tikzpicture\}/g)).toHaveLength(1);
  });

  it("includes diagnostics comments and marks incomplete exports for unresolved symbols", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (missing) -- (1,0;
\end{tikzpicture}`;
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0"
    });

    expect(artifact.complete).toBe(false);
    expect(artifact.diagnostics.length).toBeGreaterThan(0);
    expect(artifact.text).toContain("% tikz-editor standalone export diagnostics:");
    expect(artifact.text).toMatch(/% - \(error\) .+:/);
  });

  it("creates a standalone latex artifact", () => {
    const artifact = createStandaloneLatexExportArtifact({
      source: String.raw`\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}`,
      activeFigureId: "figure:0",
      fileName: "preview"
    });

    expect(artifact.fileName).toBe("preview.tex");
    expect(artifact.mimeType).toBe(STANDALONE_LATEX_EXPORT_MIME_TYPE);
    expect(artifact.complete).toBe(true);
    expect(artifact.diagnostics).toEqual([]);
  });
});

describe("standalone latex export: definitions the picture needs", () => {
  const exportFirst = (source: string) => createStandaloneLatexExportArtifact({ source, activeFigureId: "figure:0" });
  const preambleOf = (text: string) => text.slice(0, text.indexOf("\\begin{document}"));

  it("carries a preamble \\pgfplotstableread, after the \\pgfplotstableset that formats it", () => {
    const source = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\pgfplotstableset{col sep=comma}
\pgfplotstableread{
x,y
0,1
1,2
}\mytable
\pgfplotstableread{
x,y
5,5
}\unusedtable
\begin{document}
\begin{tikzpicture}
\begin{axis}
\addplot table [x=x, y=y] {\mytable};
\end{axis}
\end{tikzpicture}
\end{document}`;
    const artifact = exportFirst(source);
    const preamble = preambleOf(artifact.text);
    expect(artifact.complete).toBe(true);
    expect(artifact.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(preamble).toContain("\\pgfplotstableset{col sep=comma}\n\\pgfplotstableread{\nx,y\n0,1\n1,2\n}\\mytable");
    expect(artifact.text).not.toContain("\\unusedtable");
  });

  it("reports a table read from a file: the export references it by name and is incomplete", () => {
    const source = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\pgfplotstableread{measurements.dat}\measured
\begin{document}
\begin{tikzpicture}
\begin{axis}
\addplot table {\measured};
\addplot table {other.csv};
\end{axis}
\end{tikzpicture}
\end{document}`;
    const artifact = exportFirst(source);
    expect(artifact.text).toContain("\\pgfplotstableread{measurements.dat}\\measured");
    expect(artifact.complete).toBe(false);
    const files = artifact.diagnostics.filter((diagnostic) => diagnostic.code === "standalone-export-external-file");
    expect(files.map((diagnostic) => diagnostic.symbolName)).toEqual(["measurements.dat", "other.csv"]);
    expect(artifact.text).toMatch(/% - \(warning\) standalone-export-external-file: The picture reads the data file 'measurements\.dat'/u);
  });

  it("carries \\pgfmathsetmacro, length registers, colours and declared functions the axis uses, and nothing unused", () => {
    const source = String.raw`\documentclass{article}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\definecolor{brand}{RGB}{200,40,40}
\definecolor{unusedcolor}{RGB}{0,0,0}
\pgfmathsetmacro{\yupper}{3*2}
\newlength{\plotwidth}
\setlength{\plotwidth}{6cm}
\newlength{\unusedlength}
\pgfmathdeclarefunction{sq}{1}{\pgfmathparse{(#1)^2}}
\pgfplotsset{cycle list={{brand}}}
\begin{document}
\begin{tikzpicture}
\begin{axis}[width=\plotwidth, ymax=\yupper]
\addplot {sq(x)};
\end{axis}
\end{tikzpicture}
\end{document}`;
    const preamble = preambleOf(exportFirst(source).text);
    for (const line of ["\\definecolor{brand}{RGB}{200,40,40}", "\\pgfmathsetmacro{\\yupper}{3*2}", "\\newlength{\\plotwidth}\n\\setlength{\\plotwidth}{6cm}", "\\pgfmathdeclarefunction{sq}{1}{\\pgfmathparse{(#1)^2}}", "\\pgfplotsset{cycle list={{brand}}}"]) {
      expect(preamble).toContain(line);
    }
    expect(preamble).not.toContain("unusedcolor");
    expect(preamble).not.toContain("\\unusedlength");
  });

  it("carries a preamble macro whose statement id equals one in the picture, and does not repeat the picture's own", () => {
    const source = String.raw`\documentclass{article}
\usepackage{tikz}
\def\b{2}
\begin{document}
\begin{tikzpicture}
\def\a{1}
\draw (0,0) -- (\a,\b);
\end{tikzpicture}
\end{document}`;
    const artifact = exportFirst(source);
    expect(preambleOf(artifact.text)).toContain("\\def\\b{2}");
    expect(artifact.text.split("\\def\\a{1}").length - 1).toBe(1);
  });

  it("does not carry definitions local to another picture", () => {
    const source = String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
\def\a{1}
\draw (0,0) -- (\a,0);
\end{tikzpicture}
\begin{tikzpicture}
\draw (0,0) -- (\a,1);
\end{tikzpicture}
\end{document}`;
    const artifact = createStandaloneLatexExportArtifact({ source, activeFigureId: "figure:1" });
    expect(preambleOf(artifact.text)).not.toContain("\\def\\a");
  });

  it("never reports internal state bindings as macros", () => {
    const plot = exportFirst(String.raw`\begin{tikzpicture}\begin{axis}\addplot {x^2};\end{axis}\end{tikzpicture}`);
    const numbers = exportFirst(String.raw`\begin{tikzpicture}
\pgfkeys{/pgf/number format/precision=1}
\node {\pgfmathprintnumber{3.14159}};
\end{tikzpicture}`);
    for (const artifact of [plot, numbers]) {
      expect(artifact.diagnostics.filter((diagnostic) => diagnostic.code === "unresolved-symbol")).toEqual([]);
      expect(artifact.complete).toBe(true);
    }
  });
});
