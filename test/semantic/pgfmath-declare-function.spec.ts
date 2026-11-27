import { describe, expect, it } from "vitest";

import { evaluateSemantic, elementsOfKind } from "./helpers.js";
import type { SceneElement } from "../../packages/core/src/semantic/types.js";

const CM = 28.4527559055;

function pathPoints(elements: readonly SceneElement[]): Array<{ x: number; y: number }> {
  const path = elementsOfKind(elements, "Path")[0];
  if (!path) return [];
  return path.commands.flatMap((command) => ("to" in command && command.to ? [command.to] : []));
}

function texts(elements: readonly SceneElement[]): string[] {
  return elementsOfKind(elements, "Text").map((entry) => entry.text);
}

describe("declare function in TikZ documents", () => {
  it("plots a function declared on the picture", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[declare function={f(\x)=\x*\x;}]
  \draw plot[domain=0:2,samples=5] (\x,{f(\x)});
\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const points = pathPoints(result.scene.elements);
    expect(points).toHaveLength(5);
    for (const point of points) {
      const x = point.x / CM;
      expect(Math.abs(point.y) / CM).toBeCloseTo(x * x, 6);
    }
    expect(Math.abs(points[4]?.y ?? 0) / CM).toBeCloseTo(4, 6);
  });

  it("keeps declared functions local to their scope", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
  \begin{scope}[declare function={g(\a,\b)=\a+2*\b; c=3;}]
    \node at (0,0) {\pgfmathparse{g(1,c)}\pgfmathresult};
    \pgfmathsetmacro{\inside}{g(1,c)};
    \node at (1,0) {\inside};
    \begin{scope}[declare function={c=10;}]
      \pgfmathsetmacro{\nested}{g(1,c)};
      \node at (2,0) {\nested};
    \end{scope}
    \pgfmathsetmacro{\after}{c};
    \node at (3,0) {\after};
  \end{scope}
  \pgfmathsetmacro{\outside}{c};
\end{tikzpicture}`);
    const values = texts(result.scene.elements);
    expect(values).toContain("7");
    expect(values).toContain("21");
    expect(values).toContain("3");
    // Redeclaring a visible function is an error in TeX (it still redefines).
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "pgfmath-function-exists")).toBe(true);
    // Outside the scope `c` is unknown again, as in TeX.
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-pgfmathsetmacro:unknown-function")).toBe(true);
  });

  it("applies declarations made on a path and reads parameters as inserted text", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
  \draw[declare function={h(\x)=\x^2;}] (0,0) -- ({h(-2)},{h(3)});
\end{tikzpicture}`);
    const points = pathPoints(result.scene.elements);
    // PGF substitutes "-2" into "\x^2", which reads -(2^2).
    expect((points[1]?.x ?? 0) / CM).toBeCloseTo(-4, 6);
    expect(Math.abs(points[1]?.y ?? 0) / CM).toBeCloseTo(9, 6);
  });

  it("does not expand an outer \\x inside a function body", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
  \def\x{5}
  \draw[declare function={sq(\x)=\x*\x;}] (0,0) -- ({sq(3)},\x);
\end{tikzpicture}`);
    const points = pathPoints(result.scene.elements);
    expect((points[1]?.x ?? 0) / CM).toBeCloseTo(9, 6);
    expect(Math.abs(points[1]?.y ?? 0) / CM).toBeCloseTo(5, 6);
  });

  it("switches trigonometric functions to radians with trig format=rad", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
  \begin{scope}[trig format=rad]
    \pgfmathsetmacro{\r}{sin(pi/2)+cos(pi)};
    \node at (0,0) {\r};
    \pgfmathsetmacro{\a}{atan2(1,1)};
    \node at (1,0) {\a};
  \end{scope}
  \pgfmathsetmacro{\d}{sin(90)};
  \node at (2,0) {\d};
\end{tikzpicture}`);
    const values = texts(result.scene.elements);
    expect(values).toContain("0");
    expect(values).toContain("0.785398163397");
    expect(values).toContain("1");
    expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("unsupported-option-key"))).toBe(false);
  });

  it("stores text results of \\pgfmathparse", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
  \pgfmathparse{hex(255)};
  \node at (0,0) {\pgfmathresult};
  \pgfmathsetmacro{\pick}{{"a","b","c"}[1]};
  \node at (1,0) {\pick};
\end{tikzpicture}`);
    expect(texts(result.scene.elements)).toEqual(expect.arrayContaining(["ff", "b"]));
  });

  it("reports malformed declarations", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[declare function={f(x)=x;}]
  \draw (0,0) -- (1,1);
\end{tikzpicture}`);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-declare-function")).toBe(true);
  });
});
