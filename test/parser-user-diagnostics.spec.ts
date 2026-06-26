import { describe, expect, it } from "vitest";

import type { Diagnostic } from "../packages/core/src/diagnostics/types.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

type ExpectedDiagnostic = {
  code: string;
  severity: Diagnostic["severity"];
  message: string;
};

function expectDiagnostic(diagnostics: readonly Diagnostic[], expected: ExpectedDiagnostic): void {
  expect(diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining(expected)
  ]));
}

function expectDiagnosticSourceSlice(
  source: string,
  diagnostics: readonly Diagnostic[],
  code: string,
  expectedSlice: string
): void {
  const diagnostic = diagnostics.find((item) => item.code === code);
  expect(diagnostic).toBeDefined();
  if (!diagnostic) {
    return;
  }
  expect(source.slice(diagnostic.span.from, diagnostic.span.to)).toBe(expectedSlice);
}

describe("parser diagnostics for common user mistakes", () => {
  it("explains that bare TikZ code needs a tikzpicture environment", () => {
    const source = String.raw`\draw (0,0) -- (1,0);`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "missing-tikzpicture",
      severity: "warning",
      message: "No tikzpicture environment found; wrap the code in `\\begin{tikzpicture}` ... `\\end{tikzpicture}`."
    });
  });

  it("points at the next command when a semicolon is missing between statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1)
  \node {A};
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "missing-semicolon",
      severity: "warning",
      message: "\\node starts before the previous statement ended; add a semicolon before \\node."
    });
  });

  it("uses a semicolon-specific message for a stray empty statement", () => {
    const source = String.raw`\begin{tikzpicture}
  ;
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "stray-token",
      severity: "error",
      message: "Unexpected semicolon; remove it or put it after a TikZ command."
    });
  });

  it("explains how to close an unfinished option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red, thick (0,0) -- (1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "parse-error",
      severity: "error",
      message: "Syntax error in option list. Check for missing commas or unmatched brackets."
    });
    expectDiagnostic(result.diagnostics, {
      code: "missing-option-close",
      severity: "warning",
      message: "Unclosed option list; add a closing `]` before the statement continues."
    });
  });

  it("mentions the likely missing scope terminator for an unclosed scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm]
    \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "parse-error",
      severity: "error",
      message: "Syntax error inside scope. Check for a missing \\end{scope}, unclosed groups, or missing semicolons."
    });
  });

  it("gives examples when a coordinate is malformed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,) -- (1,1);
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "malformed-coordinate",
      severity: "warning",
      message: "Malformed coordinate `(0,)`; use a named coordinate such as `(A)` or numeric parts such as `(0,0)`."
    });
  });

  it("shows the expected shape of a malformed newcommand definition", () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\foo}[bad]{x}
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "parse-error",
      severity: "error",
      message: "Syntax error in \\newcommand definition. Expected \\newcommand{\\name}[argCount]{body}."
    });
  });

  it("keeps the foreach header diagnostic when the list is not braced", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in 1,2,3 { \draw (\x,0) -- (\x,1); }
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "parse-error",
      severity: "error",
      message: "Syntax error in \\foreach statement. Check the variable list and body syntax."
    });
  });

  it("calls out the common foreach two-dot typo", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,..,3} { \draw (\x,0) -- (\x,1); }
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "invalid-foreach-range-ellipsis",
      severity: "error",
      message: "Invalid foreach range token `..`; use `...` (three dots), for example `{0,...,10}`."
    });
  });

  it("recognizes an unclosed node text group instead of falling back to a generic syntax error", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {Hello;
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "parse-error",
      severity: "error",
      message: "Unclosed node text; add a closing `}` before the end of the node statement."
    });
  });

  it("reports plain stray text inside a tikzpicture", () => {
    const source = String.raw`\begin{tikzpicture}
  hello world
\end{tikzpicture}`;
    const result = parseTikz(source);

    expectDiagnostic(result.diagnostics, {
      code: "stray-token",
      severity: "error",
      message: "Unexpected text `hello` in tikzpicture; start statements with a TikZ command such as \\draw, \\node, or \\path."
    });
  });

  it("surfaces semantic argument errors with specific command names", () => {
    const source = String.raw`\begin{tikzpicture}
  \colorlet{}{red}
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expectDiagnostic(result.semantic.diagnostics, {
      code: "invalid-colorlet-name",
      severity: "warning",
      message: "\\colorlet requires a non-empty color name."
    });
  });

  it("uses user-facing wording for unknown command typos", () => {
    const source = String.raw`\begin{tikzpicture}
  \drwa (0,0) -- (1,1);
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expectDiagnostic(result.semantic.diagnostics, {
      code: "unsupported-statement",
      severity: "warning",
      message: "Unknown or unsupported command `\\drwa`; this editor will ignore the statement. Check for a typo or unsupported TikZ command."
    });
  });

  it("points unsupported figure option keys at the key instead of the whole option list", () => {
    const source = String.raw`\begin{tikzpicture}[draw,definitely unsupported key=1,fill=red]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expectDiagnosticSourceSlice(
      source,
      result.semantic.diagnostics,
      "unsupported-option-key:definitely unsupported key",
      "definitely unsupported key"
    );
  });

  it("points invalid option values at the value token", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[xshift=bad,draw] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expectDiagnosticSourceSlice(source, result.semantic.diagnostics, "invalid-xshift:bad", "bad");
  });

  it("does not report handled frame style buckets as unsupported option keys", () => {
    const source = String.raw`\begin{tikzpicture}[every fit/.style={fill=red}]
  \node (a) at (0,0) {};
  \node[draw,fit=(a)] {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expect(result.semantic.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:every fit/.style")).toBe(false);
  });
});
