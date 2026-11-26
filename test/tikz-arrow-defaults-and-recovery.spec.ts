import { describe, expect, it } from "vitest";

import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const render = (code: string) => renderTikzToSvg(code, { parse: { includeContextDefinitions: true } });
const paths = (code: string) => render(code).svg.svg.match(/<path [^>]*>/gu) ?? [];

describe("`>` shorthand tips are looked up when the path is drawn", () => {
  const draw = (options: string) => paths(String.raw`\begin{tikzpicture}\draw[${options}] (0,0) -- (2,0);\end{tikzpicture}`).join("\n");

  it("->, >=latex gives the same arrow as >=latex, ->", () => {
    expect(draw("->, >=latex")).toBe(draw(">=latex, ->"));
    expect(draw("->, >=latex")).toBe(draw("-latex"));
  });

  it("sizes PGF's latex tip from the line width at the end of the option list", () => {
    expect(draw("-latex, line width=1pt")).toBe(draw("line width=1pt, -latex"));
    expect(draw("->, >=latex, line width=1pt")).toBe(draw("line width=1pt, ->, >=latex"));
  });

  it("keeps arrows.meta's Latex distinct from PGF's latex", () => {
    expect(draw("-Latex")).not.toBe(draw("-latex"));
  });
});

describe("rounded rectangle that fills and draws", () => {
  it("starts its outline on the rounded start corner", () => {
    const [filled] = paths(String.raw`\begin{tikzpicture}\path[fill=white, draw=black, rounded corners=3pt] (0,0) rectangle (2,1);\end{tikzpicture}`);
    const [stroked] = paths(String.raw`\begin{tikzpicture}\path[draw=black, rounded corners=3pt] (0,0) rectangle (2,1);\end{tikzpicture}`);
    const d = (path: string | undefined) => /d="([^"]*)"/u.exec(path ?? "")?.[1] ?? "";
    // The last move is where the outline closes to: the rounded exit of the start corner.
    expect(d(filled).split("M ").pop()).toBe(d(stroked).split("M ").pop());
  });
});

describe("a macro call that ends its scope", () => {
  it("is not an error without a semicolon", () => {
    const code = String.raw`\begin{tikzpicture}
\def\P#1{\draw (#1,0) -- (#1,1);}
\begin{scope}[shift={(0,0)}]
  \P{1}
\end{scope}
\end{tikzpicture}`;
    const result = render(code);
    expect(result.parse.diagnostics).toEqual([]);
    expect(result.semantic.scene.elements).toHaveLength(1);
  });
});
