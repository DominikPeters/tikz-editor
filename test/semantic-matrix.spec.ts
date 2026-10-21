import { describe, expect, it } from "vitest";

import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import {
  parseMatrixRowsForEdit,
  resolveMatrixCellEditTarget,
  resolveMatrixMode
} from "../packages/core/src/semantic/nodes/matrix.js";
import { evaluateSemantic } from "./semantic/helpers.js";

describe("semantic matrix nodes", () => {
  it.each([
    [String.raw`A & B \\` + "\n% trailing & \\\\ } [ ( 🐱\n", ["A", "B"], [2]],
    ["% leading } [ & \\\\ 🐱\n" + String.raw`|[draw]| A & B \\` + "\n% row comment & \\\\\n" + String.raw`C & D \\`, ["A", "B", "C", "D"], [2, 2]],
    [String.raw`A &` + "\n% ignored & \\\\ { [\n" + String.raw`B \\`, ["A", "B"], [2]],
    [String.raw`A\% & B \\` + "\r\n% trailing comment\r\n", [String.raw`A\%`, "B"], [2]],
    [String.raw`A &` + "\n% empty cell\n" + String.raw`\\`, ["A"], [2]]
  ] as const)("ignores comments in matrix structure while retaining source spans: %s", (body, labels, columns) => {
    const source = String.raw`\begin{tikzpicture}\matrix (m) [matrix of nodes,nodes in empty cells,nodes={draw}] {${body}};\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    expect(result.diagnostics).toEqual([]);
    const texts = result.scene.elements.filter(element => element.kind === "Text").filter(element => element.matrixCell);
    expect(texts.map(element => element.text)).toEqual(labels);
    for (const element of texts) {
      expect(source.slice(element.matrixCell!.textSpan.from, element.matrixCell!.textSpan.to)).toBe(element.text);
    }
    expect(parseMatrixRowsForEdit(body, "&", 200).rows.map(row => row.cells.length)).toEqual(columns);
    const expectedCells = columns.reduce((sum, count) => sum + count, 0);
    expect(result.scene.elements.filter(element => element.kind === "Path" && element.matrixCell)).toHaveLength(expectedCells);
  });

  it("keeps explicit empty rows after comment-only trivia", () => {
    const body = String.raw`A & B \\` + "\n% empty row follows & \\\\\n" + String.raw`\\` + "\n% trailing comment\n";
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}\matrix [matrix of nodes,nodes in empty cells,nodes={draw}] {${body}};\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.elements.filter(element => element.kind === "Path" && element.matrixCell)).toHaveLength(4);
    expect(parseMatrixRowsForEdit(body, "&", 0).rows.map(row => row.cells.length)).toEqual([2, 1]);
  });

  it("preserves commented cell prefixes and explicit node edit spans", () => {
    const body = "% leading 🐱 [ & \\\\\n" + String.raw`|[draw,` + "% ] | ignored\n" + String.raw`fill=red]|` + "% cell text\n A & % second cell\n" + String.raw`\node` + "% before options\n" + String.raw`[draw]` + "% before text\n" + String.raw`{B}; \\`;
    const mode = resolveMatrixMode(parseOptionListRaw("[matrix of nodes]"));
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}\matrix [matrix of nodes] {${body}};\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.elements.filter(element => element.kind === "Text").map(element => element.text)).toEqual(["A", "B"]);
    for (const [column, label] of [[1, "A"], [2, "B"]] as const) {
      const target = resolveMatrixCellEditTarget(body, { from: 200, to: 200 + body.length }, mode, 1, column);
      expect(target).not.toBeNull();
      expect(body.slice(target!.textSpan.from - 200, target!.textSpan.to - 200)).toBe(label);
    }
    const target = resolveMatrixCellEditTarget(body, { from: 200, to: 200 + body.length }, mode, 1, 1);
    expect(body.slice(target!.optionSpan!.from - 200, target!.optionSpan!.to - 200)).toBe("[draw,% ] | ignored\nfill=red]");
  });

  it.each([
    String.raw`& & \\ & & \\ & & \\`,
    String.raw`A & & \\ & & \\ & & \\`,
    String.raw`& & \\ & & \\ A & & \\`,
    String.raw`& & \\ & & \\ & &`
  ])("preserves explicitly separated empty rows in %s (#31)", body => {
    const source = String.raw`\begin{tikzpicture}
\matrix (test) [matrix of nodes,nodes in empty cells,nodes={draw=red,minimum height=1cm,minimum width=1cm},draw] {${body}};
\draw (test-3-3) -- (test-1-1);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    expect(result.diagnostics).toEqual([]);
    const boxes = result.scene.elements.filter(element => element.kind === "Path" && element.id.includes(":matrix-cell:"));
    expect(boxes).toHaveLength(9);
    const mode = resolveMatrixMode(parseOptionListRaw("[matrix of nodes,nodes in empty cells]"));
    expect(parseMatrixRowsForEdit(body, mode.cellSeparator, 200).rows.map(row => row.cells.length)).toEqual([3, 3, 3]);
    const target = resolveMatrixCellEditTarget(body, { from: 200, to: 200 + body.length }, mode, 3, 3);
    expect(target).not.toBeNull();
    expect(body.slice(target!.textSpan.from - 200, target!.textSpan.to - 200)).toBe("");
  });

  it("keeps empty single-cell rows and their row gap overrides (#31)", () => {
    const body = String.raw`\\[4pt] \\[6pt] \\`;
    expect(parseMatrixRowsForEdit(body, "&", 0).rows.map(row => row.cells.length)).toEqual([1, 1, 1]);
    const source = String.raw`\begin{tikzpicture}\matrix (m) [matrix of nodes,nodes in empty cells,nodes={draw,minimum height=1cm}] {${body}};\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.elements.filter(element => element.kind === "Path" && element.id.includes(":matrix-cell:"))).toHaveLength(3);
  });

  it("pads ragged rows with empty cell structures (#31)", () => {
    const source = String.raw`\begin{tikzpicture}
\matrix [matrix of nodes,nodes in empty cells,nodes={draw}] { A & B \\ C \\ & \\ };
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.scene.elements.filter(element => element.kind === "Path" && element.id.includes(":matrix-cell:"))).toHaveLength(6);
  });

  it("renders matrix containers through the supported node shape dispatch", () => {
    const shapes = [
      "chamfered rectangle",
      "cross out",
      "strike out",
      "magnifying glass",
      "circle split",
      "circle solidus",
      "ellipse split",
      "diamond split",
      "rectangle split, rectangle split parts=3",
      "rectangle split, rectangle split parts=3, rectangle split horizontal",
      "circle",
      "ellipse",
      "diamond",
      "trapezium",
      "semicircle",
      "isosceles triangle",
      "kite",
      "dart",
      "circular sector",
      "cylinder",
      "regular polygon, regular polygon sides=6",
      "star",
      "cloud",
      "starburst",
      "signal",
      "tape",
      "rectangle callout, callout absolute pointer={(8pt,4pt)}",
      "ellipse callout, callout absolute pointer={(8pt,4pt)}",
      "cloud callout, callout absolute pointer={(8pt,4pt)}",
      "single arrow",
      "double arrow",
      "rectangle"
    ];

    for (const shape of shapes) {
      const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,draw,${shape},minimum width=1cm,minimum height=8mm] (m) {
    A & B \\
  };
\end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const unsupported = result.diagnostics.filter((diagnostic) => diagnostic.code?.startsWith("unsupported-option-key"));
      expect(unsupported, shape).toEqual([]);

      const containerElements = result.scene.elements.filter((element) => element.kind !== "Text");
      expect(containerElements.length, shape).toBeGreaterThan(0);
    }
  });

  it("keeps prefixed and explicit matrix cell names and aliases addressable", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,nodes={draw}] (m) {
    |[name=first,alias=firstAlias]| A & |(second)| \node[alias=secondAlias] at (1,2) {B}; \\
  };
  \draw (first) -- (firstAlias) -- (m-1-1) -- (second) -- (secondAlias) -- (m-1-2);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code?.startsWith("unknown-named-coordinate:"))).toBe(false);
    const labels = result.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""))
      .sort();
    expect(labels).toEqual(["A", "B"]);
  });

  it("resolves matrix mode key variants and spacing semantics", () => {
    const mode = resolveMatrixMode(
      parseOptionListRaw(String.raw`[
        matrix=true,
        matrix of math nodes=on,
        nodes in empty cells,
        row sep={between origins,2pt,between borders,3pt},
        column sep={between origins,4pt},
        ampersand replacement=\&,
        nodes={draw,name=fromNodes,alias=fromAlias},
        matrix anchor=north_east
      ]`)
    );

    expect(mode.enabled).toBe(true);
    expect(mode.matrixOfNodes).toBe(true);
    expect(mode.matrixKind).toBe("math-nodes");
    expect(mode.textMode).toBe("math");
    expect(mode.includeEmptyCells).toBe(true);
    expect(mode.cellSeparator).toBe(String.raw`\&`);
    expect(mode.rowSep).toEqual({ gap: 5, betweenOrigins: false });
    expect(mode.columnSep).toEqual({ gap: 4, betweenOrigins: true });
    expect(mode.matrixAnchor).toBe("north east");
    expect(mode.nodesOption?.entries.map((entry) => entry.kind === "unknown" ? entry.raw : entry.key)).toEqual([
      "draw",
      "name",
      "alias"
    ]);
  });

  it("resolves matrix cell edit spans across prefixes, separators, and invalid targets", () => {
    const mode = resolveMatrixMode(parseOptionListRaw(String.raw`[matrix of nodes,nodes in empty cells]`));
    const body = String.raw`
      |[draw,name=left]| A & |(right)| \node[alias=r] at (1,2) {B}; \\
       C & \\
    `;
    const baseOffset = 200;
    const rows = parseMatrixRowsForEdit(body, mode.cellSeparator, baseOffset);
    expect(rows.rows.map((row) => row.cells.length)).toEqual([2, 2]);

    const first = resolveMatrixCellEditTarget(body, { from: baseOffset, to: baseOffset + body.length }, mode, 1, 1);
    expect(first?.textMode).toBe("text");
    expect(first?.optionSpan).toBeDefined();
    expect(body.slice((first?.textSpan.from ?? 0) - baseOffset, (first?.textSpan.to ?? 0) - baseOffset)).toBe("A");

    const explicit = resolveMatrixCellEditTarget(body, { from: baseOffset, to: baseOffset + body.length }, mode, 1, 2);
    expect(body.slice((explicit?.textSpan.from ?? 0) - baseOffset, (explicit?.textSpan.to ?? 0) - baseOffset)).toBe("B");

    expect(resolveMatrixCellEditTarget(body, { from: baseOffset, to: baseOffset + body.length }, mode, 0, 1)).toBeNull();
    expect(resolveMatrixCellEditTarget(body, { from: baseOffset, to: baseOffset + body.length }, mode, 3, 1)).toBeNull();
  });
});
