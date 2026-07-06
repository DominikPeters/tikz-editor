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
