// The plot data grid (packages/core/src/edit/pgfplots/plot-data.ts): what the grid
// shows, the exact source after each change (only the named text changes; new rows
// copy their neighbours' separators), the re-evaluated scene, one undo step.
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { readPlotDataGrid, type PlotDataChange } from "../packages/core/src/edit/pgfplots/plot-data.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import type { EditorState } from "../packages/app/src/store/types.js";

const picture = (axisOptions: string, body: string) => `\\begin{tikzpicture}\n\\begin{axis}[${axisOptions}]\n${body}\n\\end{axis}\n\\end{tikzpicture}`;

function plotId(source: string, index = 0): string {
  const axis = parseTikz(source, { includeContextDefinitions: true }).figure.body.find((statement) => statement.kind === "Axis");
  if (axis?.kind !== "Axis") throw new Error("no axis");
  return `${axis.id}:plot:${String(index)}`;
}

function run(source: string, change: PlotDataChange, index = 0) {
  return applyEditAction(source, [], { kind: "editPlotData", plotId: plotId(source, index), change });
}

function edit(source: string, change: PlotDataChange, index = 0): string {
  const result = run(source, change, index);
  if (result.kind !== "success") throw new Error(`edit failed: ${result.kind === "unsupported" ? result.reason : result.kind}`);
  return result.newSource;
}

function evaluatedLimits(source: string) {
  const result = evaluateTikzFigure(parseTikz(source).figure, source);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return getAxisEvaluations(result.scene)[0]?.layout.limits;
}

describe("coordinates", () => {
  const source = picture("xmin=0", "  \\addplot coordinates {\n    (0,1) (1,2) % first two\n    (2,{2*1.5})\n  };");

  it("shows x and y, an expression as written", () => {
    expect(readPlotDataGrid(source, plotId(source))).toMatchObject({ kind: "coordinates", columns: [{ id: "x" }, { id: "y" }], rows: [["0", "1"], ["1", "2"], ["2", "{2*1.5}"]] });
  });

  it("a cell edit rewrites one component; the comment and line breaks stay", () => {
    const next = edit(source, { type: "set", row: 1, column: 1, value: "5" });
    expect(next).toBe(source.replace("(1,2)", "(1,5)"));
    expect(evaluatedLimits(next)?.ymax).toBeGreaterThanOrEqual(5);
    expect(edit(source, { type: "set", row: 2, column: 1, value: "sqrt(2)" })).toBe(source.replace("{2*1.5}", "{sqrt(2)}"));
    // A comma would split the coordinate: braced.
    expect(edit(source, { type: "set", row: 0, column: 1, value: "max(1,2)" })).toBe(source.replace("(0,1)", "(0,{max(1,2)})"));
  });

  it("new rows copy the separator of their neighbours", () => {
    expect(edit(source, { type: "insertRow", at: 1, values: ["0.5", "1.5"] })).toBe(source.replace("(0,1) (1,2)", "(0,1) (0.5,1.5) (1,2)"));
    // At the end: after the last point, with the separator before it (a line break here).
    expect(edit(source, { type: "insertRow", at: 3, values: ["3", "4"] })).toBe(source.replace("(2,{2*1.5})", "(2,{2*1.5})\n    (3,4)"));
  });

  it("deletes rows with their separator", () => {
    expect(edit(source, { type: "deleteRows", rows: [1] })).toBe(source.replace("(0,1) (1,2)", "(0,1)"));
    expect(edit(source, { type: "deleteRows", rows: [0] })).toBe(source.replace("(0,1) (1,2)", "(1,2)"));
    expect(run(source, { type: "deleteRows", rows: [0, 1, 2] }).kind).toBe("unsupported");
  });

  it("pastes a block, adding rows past the end", () => {
    expect(edit(source, { type: "paste", row: 1, column: 0, values: [["7", "8"], ["9", "10"], ["11", "12"]] }))
      .toBe(source.replace("(1,2)", "(7,8)").replace("(2,{2*1.5})", "(9,10)\n    (11,12)"));
  });

  it("error parts and meta are columns when present", () => {
    const errors = picture("", "  \\addplot+[error bars/.cd, y dir=both, y explicit] coordinates {(0,1) +- (0,0.2) (1,2) +- (0,0.3)};");
    const grid = readPlotDataGrid(errors, plotId(errors));
    expect(grid.kind === "coordinates" ? grid.columns.map((column) => column.label) : null).toEqual(["x", "y", "+- x", "+- y"]);
    expect(edit(errors, { type: "set", row: 1, column: 3, value: "0.5" })).toBe(errors.replace("+- (0,0.3)", "+- (0,0.5)"));
    const meta = picture("", "  \\addplot+[scatter, only marks] coordinates {(0,1) [a] (1,2) [b]};");
    expect(edit(meta, { type: "set", row: 0, column: 2, value: "c" })).toBe(meta.replace("[a]", "[c]"));
  });
});

describe("symbolic x coordinates", () => {
  const source = picture("ybar, symbolic x coords={Q1,Q2,Q3}, xtick=data", "  \\addplot coordinates {(Q1,3) (Q2,5) (Q3,4)};");

  it("a new category is added to `symbolic x coords` in the same edit", () => {
    const next = edit(source, { type: "insertRow", at: 3, values: ["Q4", "6"] });
    expect(next).toBe(source.replace("{Q1,Q2,Q3}", "{Q1,Q2,Q3,Q4}").replace("(Q3,4)", "(Q3,4) (Q4,6)"));
    expect(evaluatedLimits(next)?.xmax).toBeGreaterThan(3);
    expect(edit(source, { type: "set", row: 0, column: 0, value: "Q2" })).toBe(source.replace("(Q1,3)", "(Q2,3)"));
  });

  it("refuses when the list comes from a style", () => {
    const styled = `\\pgfplotsset{quarters/.style={symbolic x coords={Q1,Q2}}}\n${picture("quarters", "  \\addplot coordinates {(Q1,3) (Q2,5)};")}`;
    const result = run(styled, { type: "set", row: 0, column: 0, value: "Q9" });
    expect(result.kind === "unsupported" ? result.reason : "").toMatch(/symbolic x coords/u);
  });
});

describe("inline tables", () => {
  const source = picture("", "  \\addplot table [x=t, y expr=\\thisrow{v}*2] {\n    t   v\n    0   1.0\n    1   1.5 % noisy\n    2   3.0\n  };");

  it("shows the header and the cells", () => {
    expect(readPlotDataGrid(source, plotId(source))).toMatchObject({ kind: "table", headerEditable: true, columns: [{ label: "t" }, { label: "v" }], rows: [["0", "1.0"], ["1", "1.5"], ["2", "3.0"]] });
  });

  it("cell edits keep the alignment of untouched rows", () => {
    expect(edit(source, { type: "set", row: 1, column: 1, value: "1.75" })).toBe(source.replace("1   1.5 %", "1   1.75 %"));
  });

  it("renaming a column renames the plot's references", () => {
    expect(edit(source, { type: "renameColumn", column: 1, name: "speed" })).toBe(source.replace("    t   v\n", "    t   speed\n").replace("\\thisrow{v}", "\\thisrow{speed}"));
    expect(edit(source, { type: "renameColumn", column: 0, name: "time" })).toBe(source.replace("x=t,", "x=time,").replace("    t   v\n", "    time   v\n"));
  });

  it("rows: insert copies the separators, delete removes the line, a comment line stays", () => {
    expect(edit(source, { type: "insertRow", at: 3, values: ["3", "2.5"] })).toBe(source.replace("    2   3.0\n", "    2   3.0\n    3   2.5\n"));
    expect(edit(source, { type: "insertRow", at: 0, values: ["-1", "0.5"] })).toBe(source.replace("    0   1.0\n", "    -1   0.5\n    0   1.0\n"));
    expect(edit(source, { type: "deleteRows", rows: [1] })).toBe(source.replace("    1   1.5 % noisy\n", ""));
  });

  it("`row sep=\\\\` and `col sep=comma` are kept", () => {
    const crcr = picture("", "  \\addplot table [row sep=\\\\, col sep=comma] {\n    x,y \\\\\n    0,1 \\\\\n    1,2 \\\\\n  };");
    expect(edit(crcr, { type: "set", row: 1, column: 1, value: "4" })).toBe(crcr.replace("1,2 \\\\", "1,4 \\\\"));
    expect(edit(crcr, { type: "insertRow", at: 2, values: ["2", "3"] })).toBe(crcr.replace("    1,2 \\\\\n", "    1,2 \\\\\n    2,3 \\\\\n"));
    expect(edit(crcr, { type: "deleteRows", rows: [0] })).toBe(crcr.replace("    0,1 \\\\\n", ""));
  });

  it("a shared `\\pgfplotstableread` table says so; its data is edited where it is read", () => {
    const shared = `\\begin{tikzpicture}\n\\pgfplotstableread{\n  a b c\n  0 1 2\n  1 2 1\n}\\mytable\n\\begin{axis}\n  \\addplot table [x=a, y=b] {\\mytable};\n  \\addplot table [x=a, y=c] {\\mytable};\n\\end{axis}\n\\end{tikzpicture}`;
    const grid = readPlotDataGrid(shared, plotId(shared, 1));
    expect(grid.kind === "table" ? grid.note : "").toMatch(/used by 2 plots/u);
    expect(edit(shared, { type: "set", row: 0, column: 2, value: "5" }, 1)).toBe(shared.replace("0 1 2", "0 1 5"));
  });

  it("file tables are read-only with the file name; expression plots have no grid", () => {
    const file = picture("", "  \\addplot table {data.dat};");
    expect(readPlotDataGrid(file, plotId(file))).toMatchObject({ kind: "readonly", reason: expect.stringContaining("data.dat") });
    const expression = picture("", "  \\addplot {x^2};");
    expect(readPlotDataGrid(expression, plotId(expression)).kind).toBe("none");
  });
});

describe("one undo step per change (a paste included)", () => {
  const source = picture("", "  \\addplot coordinates {(0,1) (1,2)};");
  it.each<[string, PlotDataChange]>([
    ["cell", { type: "set", row: 0, column: 1, value: "3" }],
    ["paste", { type: "paste", row: 0, column: 0, values: [["5", "6"], ["7", "8"], ["9", "10"]] }],
    ["insert row", { type: "insertRow", at: 2, values: ["2", "2"] }],
    ["delete row", { type: "deleteRows", rows: [0] }]
  ])("%s", (_name, change) => {
    const action: EditAction = { kind: "editPlotData", plotId: plotId(source), change };
    const initial: EditorState = { ...makeInitialState(), source, snapshot: { ...makeEmptySnapshot(source), source } };
    const edited = editorReducer(initial, { type: "APPLY_EDIT_ACTION", action });
    expect(edited.source).not.toBe(source);
    expect(edited.history).toHaveLength(1);
    expect(editorReducer(edited, { type: "UNDO" }).source).toBe(source);
  });
});

describe("large data", () => {
  it("reads and edits a 20,000-row inline table quickly", () => {
    const rows = Array.from({ length: 20000 }, (_, index) => `    ${String(index)} ${String((index * 7) % 13)}`).join("\n");
    const source = picture("", `  \\addplot table {\n    x y\n${rows}\n  };`);
    const id = plotId(source);
    const started = performance.now();
    const grid = readPlotDataGrid(source, id);
    const read = performance.now() - started;
    expect(grid.kind === "table" ? grid.rows.length : 0).toBe(20000);
    const editStarted = performance.now();
    const next = edit(source, { type: "set", row: 19999, column: 1, value: "42" });
    const commit = performance.now() - editStarted;
    expect(next.endsWith("    19999 42\n  };\n\\end{axis}\n\\end{tikzpicture}")).toBe(true);
    // Generous bounds for a loaded CI machine; the measured numbers are in the report.
    expect(read).toBeLessThan(2000);
    expect(commit).toBeLessThan(2000);
  });
});
