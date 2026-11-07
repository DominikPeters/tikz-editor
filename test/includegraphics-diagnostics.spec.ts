import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

describe("\\includegraphics key diagnostics", () => {
  it("reports keys the preview does not apply at their own spans in a TikZ figure", () => {
    const source = String.raw`\begin{tikzpicture}\node {\includegraphics[natwidth=10,width=foo,frobnicate,pagebox=artbox,pagebox=cropbox,alt={x},interpolate,angle=30,width=2cm]{a.png}};\end{tikzpicture}`;
    const diagnostics = renderTikzToSvg(source).semantic.diagnostics.filter((diagnostic) => diagnostic.code?.startsWith("includegraphics-"));

    expect(diagnostics.map((diagnostic) => [diagnostic.code, source.slice(diagnostic.span.from, diagnostic.span.to)])).toEqual([
      ["includegraphics-driver-key", "natwidth=10"],
      ["includegraphics-invalid-key", "width=foo"],
      ["includegraphics-unknown-key", "frobnicate"],
      ["includegraphics-undrawn-key", "pagebox=artbox"],
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
  });

  it("reports frame and embedded-picture image keys once each in Beamer", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}
\includegraphics[natheight=3]{a.png}
\begin{tikzpicture}\node {\includegraphics[decodearray=0 1]{b.png}};\end{tikzpicture}
\end{frame}
\end{document}`;
    const diagnostics = (await renderBeamerFrame(source)).diagnostics.filter((diagnostic) => diagnostic.code?.startsWith("includegraphics-"));

    expect(diagnostics.map((diagnostic) => [diagnostic.code, source.slice(diagnostic.span.from, diagnostic.span.to)])).toEqual([
      ["includegraphics-driver-key", "natheight=3"],
      ["includegraphics-undrawn-key", "decodearray=0 1"],
    ]);
  });
});
