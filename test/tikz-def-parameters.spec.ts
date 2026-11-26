import { describe, expect, it } from "vitest";

import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const render = (code: string) => renderTikzToSvg(code, { parse: { includeContextDefinitions: true } });
const errors = (code: string) => {
  const result = render(code);
  return [...result.parse.diagnostics, ...result.semantic.diagnostics].filter(d => d.severity === "error" && d.code !== "parse-error");
};

describe("\\def with a parameter text", () => {
  it("defines a macro that takes arguments", () => {
    const code = String.raw`\begin{tikzpicture}
\def\box#1#2{\draw (#1,0) rectangle +(0.4,#2);}
\box{0}{1};
\box{1}{2};
\end{tikzpicture}`;
    const result = render(code);
    expect(result.parse.diagnostics.filter(d => d.severity === "error")).toEqual([]);
    expect(result.semantic.scene.elements).toHaveLength(2);
  });
});

describe("\\foreach over a macro list", () => {
  it("iterates the text of a list macro (pgffor expands it once)", () => {
    const code = String.raw`\begin{tikzpicture}
\def\Toks{0/a,1/b,2/c}
\foreach \i/\ch in \Toks {
  \draw (\i*0.5, 1) rectangle +(0.4,0.4);
}
\end{tikzpicture}`;
    expect(render(code).semantic.scene.elements).toHaveLength(3);
    expect(errors(code)).toEqual([]);
  });
});

describe("\\expandafter\\def inside a macro body", () => {
  it("gives the name the first expansion of its argument", () => {
    const code = String.raw`\begin{tikzpicture}
\pgfmathsetmacro{\left}{-1}
\def\Toks{0/a,1/b,2/c}
\def\Panel#1#2{%
  \expandafter\def\expandafter\Row\expandafter{#1}%
  \foreach \i/\ch in \Row {
    \pgfmathsetmacro{\x}{\left + \i * 0.5}
    \draw (\x, #2) rectangle +(0.4,0.4);
  }
}
\begin{scope}[shift={(0,0)}]
  \Panel{\Toks}{1}
\end{scope}
\begin{scope}[shift={(3,0)}]
  \Panel{\Toks}{2}
\end{scope}
\end{tikzpicture}`;
    const result = render(code);
    expect(result.semantic.scene.elements).toHaveLength(6);
    expect(result.semantic.diagnostics).toEqual([]);
  });

  it("is a definition statement at the top level too", () => {
    const code = String.raw`\begin{tikzpicture}
\def\Toks{0/a,1/b}
\expandafter\def\expandafter\Row\expandafter{\Toks}
\foreach \i/\ch in \Row { \draw (\i,0) circle (0.2); }
\end{tikzpicture}`;
    expect(render(code).semantic.scene.elements).toHaveLength(2);
  });
});
