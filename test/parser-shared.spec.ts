import { describe, expect, it } from "vitest";

import {
  resolveActiveFigureSpan,
  scanFigureSpans
} from "../packages/core/src/parser/shared.js";
import { tikzFigureIndexFromRootId } from "../packages/core/src/document/root-id.js";

describe("parser shared helpers", () => {
  it("falls back to the first figure for malformed active figure ids", () => {
    const spans = [
      { from: 10, to: 20 },
      { from: 30, to: 40 }
    ];

    expect(tikzFigureIndexFromRootId("figure:not-a-number")).toBeNull();
    expect(tikzFigureIndexFromRootId(" not-a-figure:1 ")).toBeNull();
    expect(resolveActiveFigureSpan(spans, "figure:not-a-number")).toEqual(spans[0]);
  });

  it("scans only concrete tikzpicture figure spans", () => {
    const source = String.raw`\tikzset{every picture/.style={}}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}[baseline]
  \node {x};
\end{tikzpicture}`;

    const spans = scanFigureSpans(source);

    expect(spans).toHaveLength(2);
    expect(source.slice(spans[0]?.from, spans[0]?.to)).toContain("\\draw");
    expect(source.slice(spans[1]?.from, spans[1]?.to)).toContain("\\node");
  });
});
