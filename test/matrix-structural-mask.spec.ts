import { describe, expect, it } from "vitest";

import { resolvePropertyTargetFromParseResult } from "../packages/core/src/edit/property-target.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

function resolveTarget(result: ReturnType<typeof renderTikzToSvg>, targetId: string) {
  const resolution = resolvePropertyTargetFromParseResult(result.parse.source, result.parse, targetId);
  expect(resolution.kind).toBe("found");
  if (resolution.kind !== "found") throw new Error(resolution.reason);
  return resolution.target;
}

describe("matrix cell structural masks", () => {
  const unfinishedTexts = [String.raw`\textbf{`, "}", "\\", "&", "\\\\", "[", "(", "|[draw]|", "word;"];

  for (const matrixKind of ["matrix of nodes", "matrix of math nodes", "explicit nodes"]) {
    for (const cellIndex of [0, 1, 2, 3]) {
      it(`preserves cells and edit spans for ${matrixKind}, cell ${cellIndex + 1}`, () => {
        for (const text of unfinishedTexts) {
          const cellTexts = ["A", "B", "C", "D"];
          cellTexts[cellIndex] = text;
          const marker = "EDITED_CELL_TEXT";
          const cells = cellTexts.map((value, index) => {
            const content = index === cellIndex ? marker : value;
            return matrixKind === "explicit nodes" ? `\\node[draw] {${content}};` : content;
          });
          const template = String.raw`\begin{tikzpicture}
  \matrix[${matrixKind === "explicit nodes" ? "matrix" : matrixKind},nodes={draw}] {
    ${cells[0]} & ${cells[1]} \\
    ${cells[2]} & ${cells[3]} \\
  };
  \node at (3,0) {Later};
\end{tikzpicture}`;
          const from = template.indexOf(marker);
          const source = template.replace(marker, text);
          const result = renderTikzToSvg(source, { parse: { structuralMasks: [{ from, to: from + text.length }] } });
          const renderedCells = result.semantic.scene.elements.filter((element) => element.matrixCell);
          expect(new Set(renderedCells.map((element) => element.sourceRef.sourceId)).size, text).toBe(4);
          expect(result.semantic.scene.elements.some((element) => element.kind === "Text" && element.text === "Later"), text).toBe(true);

          for (let index = 0; index < cellTexts.length; index += 1) {
            const row = Math.floor(index / 2) + 1;
            const column = index % 2 + 1;
            const targetId = `node:0:0:matrix-cell:${row}:${column}`;
            const target = resolveTarget(result, targetId);
            expect(target?.kind, text).toBe("matrix-cell");
            expect(source.slice(target.textSpan!.from, target.textSpan!.to), text).toBe(cellTexts[index]);
            const renderedCell = renderedCells.find((element) => element.sourceRef.sourceId === targetId);
            expect(renderedCell?.matrixCell?.textSpan, text).toEqual(target.textSpan);
          }
        }
      });
    }
  }

  it("preserves cell prefixes, replacement separators and spacing around unfinished text", () => {
    const text = String.raw`\textbf{`;
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,ampersand replacement=\&] {
    A \&[2pt] |[draw]| ${text} \\[3pt]
    C \& D \\
  };
\end{tikzpicture}`;
    const from = source.indexOf(text);
    const result = renderTikzToSvg(source, { parse: { structuralMasks: [{ from, to: from + text.length }] } });
    const target = resolveTarget(result, "node:0:0:matrix-cell:1:2");
    expect(source.slice(target.textSpan!.from, target.textSpan!.to)).toBe(text);
    expect(source.slice(target.optionsSpan!.from, target.optionsSpan!.to)).toBe("[draw]");
    expect(result.semantic.scene.elements.filter((element) => element.kind === "Text" && element.matrixCell)).toHaveLength(4);
  });

  it("returns to ordinary matrix parsing after the text is balanced", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {\textbf{bold} & B \\ C & D \\};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);
    expect(result.semantic.scene.elements.filter((element) => element.kind === "Text" && element.matrixCell)).toHaveLength(4);
    const target = resolveTarget(result, "node:0:0:matrix-cell:1:1");
    expect(source.slice(target.textSpan!.from, target.textSpan!.to)).toBe(String.raw`\textbf{bold}`);
  });
});
