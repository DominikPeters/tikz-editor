import { describe, expect, it } from "vitest";
import { rootAtSourceLine } from "../packages/app/src/external-source-location";

describe("external editor figure selection", () => {
  const source = String.raw`\documentclass{article}
% \begin{tikzpicture} comment
\newcommand{\template}[1]{\begin{tikzpicture}\node{#1};\end{tikzpicture}}
\begin{document}
\begin{tikzpicture}\draw (0,0)--(1,1);\end{tikzpicture}
Text.
\begin{tikzpicture}\node{Second};\end{tikzpicture}
\end{document}`;
  it("selects the requested root and excludes macro templates/comments", () => {
    expect(rootAtSourceLine(source, 5)).toBe("figure:0");
    expect(rootAtSourceLine(source, 7)).toBe("figure:1");
    for (const line of [undefined, 0, -1, 1.5, 2, 3, 6, 100]) expect(rootAtSourceLine(source, line)).toBeNull();
  });
  it("refuses ambiguous same-line figures", () => {
    expect(rootAtSourceLine(String.raw`\begin{tikzpicture}\end{tikzpicture}\begin{tikzpicture}\end{tikzpicture}`, 1)).toBeNull();
  });
  it("selects a picture inside the appropriate Beamer frame", () => {
    const deck = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{First}
\begin{tikzpicture}\node{First};\end{tikzpicture}
\end{frame}
\begin{frame}{Second}
\begin{tikzpicture}\node{Second};\end{tikzpicture}
\end{frame}
\end{document}`;
    expect(rootAtSourceLine(deck, 7)).toBe("frame:1:tikzpicture:0");
  });
});
