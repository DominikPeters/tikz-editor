import { expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser";
import { makeEmptySnapshot } from "../packages/app/src/compute";
import { buildFigureContext } from "../packages/app/src/ui/assistant-tool-handlers";

const SOURCE = String.raw`% document preamble
\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}
% between figures
\begin{tikzpicture}
\draw (2,2) -- (3,3);
\end{tikzpicture}`;

it("keeps assistant inventory and active excerpt on the parser's one-based lines", () => {
  const parsed = parseTikz(SOURCE);
  expect(parsed.figures.map(f => [f.startLine, f.endLine])).toEqual([[2, 4], [6, 8]]);
  const snapshot = { ...makeEmptySnapshot(SOURCE), figures: parsed.figures, activeRootId: parsed.figures[1].id };
  const context = buildFigureContext(SOURCE, snapshot);
  expect(context).toContain("Figure 1: lines 2–4");
  expect(context).toContain("Figure 2: lines 6–8 (active)");
  expect(context).toContain(String.raw`6: \begin{tikzpicture}`);
});

it("includes line one without shifting it when the first figure is active", () => {
  const source = SOURCE.slice(SOURCE.indexOf("\\begin"));
  const parsed = parseTikz(source);
  const context = buildFigureContext(source, {
    ...makeEmptySnapshot(source), figures: parsed.figures, activeRootId: parsed.figures[0].id
  });
  expect(context).toContain("Figure 1: lines 1–3 (active)");
  expect(context).toContain("Figure 2: lines 5–7");
  expect(context).toContain(String.raw`1: \begin{tikzpicture}`);
});

it("does not add multi-figure instructions for a single figure", () => {
  const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
  const figures = parseTikz(source).figures;
  expect(buildFigureContext(source, {
    ...makeEmptySnapshot(source), figures, activeRootId: figures[0].id
  })).toBeNull();
});

it("does not invent an active figure when its root is absent from the inventory", () => {
  const figures = parseTikz(SOURCE).figures;
  expect(buildFigureContext(SOURCE, {
    ...makeEmptySnapshot(SOURCE), figures, activeRootId: "missing-root"
  })).toBeNull();
});
