// One-click chart element edits (packages/core/src/edit/pgfplots/chart-elements.ts):
// the inspector's Elements group and the canvas context menu use these actions.
// Each case: the exact source after the edit, the re-evaluated scene, and one
// undo step through the editor reducer.
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { buildPgfplotsInspectorDescriptor, pgfplotsElementKey } from "../packages/core/src/edit/pgfplots/inspector.js";
import { readAxisElements } from "../packages/core/src/edit/pgfplots/chart-elements.js";
import { CHART_KINDS, chartKindDocument } from "../packages/core/src/edit/pgfplots/chart-kinds.js";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import type { EditorState } from "../packages/app/src/store/types.js";

const PREAMBLE = "\\pgfplotsset{compat=1.18}\n";
const picture = (options: string, body: string[]) => `${PREAMBLE}\\begin{tikzpicture}\n\\begin{axis}${options}\n${body.join("\n")}\n\\end{axis}\n\\end{tikzpicture}`;
// Cases name the axis `axis:0`; ids count the statements before it (`\pgfplotsset`), so `real` maps them.
const AXIS = "axis:0";

function axisIdOf(source: string): string {
  const axis = parseTikz(source, { includeContextDefinitions: true }).figure.body.find((statement) => statement.kind === "Axis");
  return axis?.id ?? "axis:0";
}

function real<T>(source: string, value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll("axis:0", axisIdOf(source))) as T;
}

function canonical<T>(source: string, value: T): T {
  return JSON.parse(JSON.stringify(value).replaceAll(`${axisIdOf(source)}`, "axis:0")) as T;
}

function evaluate(source: string) {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  return evaluateTikzFigure(parsed.figure, source);
}

function run(source: string, action: EditAction) {
  const result = applyEditAction(source, evaluate(source).editHandles, real(source, action));
  return result.kind === "success" && result.selectedSourceIds ? { ...result, selectedSourceIds: canonical(source, result.selectedSourceIds) } : result;
}

function edit(source: string, action: EditAction): string {
  const result = run(source, action);
  if (result.kind !== "success" && result.kind !== "partial") throw new Error(`edit failed: ${result.kind === "error" ? result.message : result.reason}`);
  return result.newSource;
}

function drawnParts(source: string): string[] {
  const ids = new Set(evaluate(source).scene.elements.map((element) => element.sourceRef.sourceId).filter((id) => /^axis:\d+:(title|xlabel|ylabel|legend)$/u.test(id)));
  return canonical(source, [...ids].sort());
}

function legendTexts(source: string): string[] {
  const axis = getAxisEvaluations(evaluate(source).scene)[0];
  if (!axis) throw new Error("no axis");
  return axis.legend.pairing.flatMap((pair) => (pair.drawn && pair.entry !== null ? [axis.legend.entries[pair.entry]?.text ?? ""] : []));
}

function expectOneUndoStep(source: string, action: EditAction): void {
  const initial: EditorState = { ...makeInitialState(), source, snapshot: { ...makeEmptySnapshot(source), source } };
  const edited = editorReducer(initial, { type: "APPLY_EDIT_ACTION", action: real(source, action) });
  expect(edited.source).not.toBe(source);
  expect(edited.history).toHaveLength(1);
  expect(edited.history[0]?.sourceBefore).toBe(source);
  const undone = editorReducer(edited, { type: "UNDO" });
  expect(undone.source).toBe(source);
  expect(editorReducer(undone, { type: "REDO" }).source).toBe(edited.source);
}

const PLOTS = ["\\addplot[red] coordinates {(0,0) (1,1)};", "\\addplot coordinates {(0,1) (1,2)};"];

describe("chart elements: title and axis labels", () => {
  const source = picture("[xmin=0]", PLOTS);

  it("adding writes a placeholder text; removing deletes the key", () => {
    const withTitle = edit(source, { kind: "setAxisElement", axisId: AXIS, element: "title", visible: true });
    expect(withTitle).toBe(source.replace("[xmin=0]", "[xmin=0, title={Title}]"));
    expect(drawnParts(withTitle)).toEqual(["axis:0:title"]);
    expect(edit(withTitle, { kind: "setAxisElement", axisId: AXIS, element: "title", visible: false })).toBe(source);
    const withLabels = edit(edit(source, { kind: "setAxisElement", axisId: AXIS, element: "xlabel", visible: true }), { kind: "setAxisElement", axisId: AXIS, element: "ylabel", visible: true });
    expect(withLabels).toBe(source.replace("[xmin=0]", "[xmin=0, xlabel={$x$}, ylabel={$y$}]"));
    expect(drawnParts(withLabels)).toEqual(["axis:0:xlabel", "axis:0:ylabel"]);
  });

  it("selects the new element when asked (context menu), and leaves an existing one", () => {
    const result = run(source, { kind: "setAxisElement", axisId: AXIS, element: "title", visible: true, selectNew: true });
    expect(result.kind === "success" && result.selectedSourceIds).toEqual(["axis:0:title"]);
    const existing = picture("[title=Results]", PLOTS);
    const again = run(existing, { kind: "setAxisElement", axisId: AXIS, element: "title", visible: true });
    expect(again.kind === "success" && again.newSource).toBe(existing);
  });

  it("a title from a style is overridden with an empty value (the key is not in the axis to delete)", () => {
    const styled = `${PREAMBLE}\\pgfplotsset{every axis/.append style={title=Styled}}\n\\begin{tikzpicture}\n\\begin{axis}\n${PLOTS.join("\n")}\n\\end{axis}\n\\end{tikzpicture}`;
    expect(drawnParts(styled)).toEqual(["axis:0:title"]);
    const removed = edit(styled, { kind: "setAxisElement", axisId: AXIS, element: "title", visible: false });
    expect(removed).toBe(styled.replace("\\begin{axis}\n", "\\begin{axis}[title={}]\n"));
    expect(drawnParts(removed)).toEqual([]);
  });

  it("the inspector's Elements toggles write through the same action", () => {
    const set = (src: string, key: string, value: string) => edit(src, { kind: "setProperty", elementId: AXIS, level: "command", key, value });
    expect(set(source, pgfplotsElementKey("title"), "true")).toBe(source.replace("[xmin=0]", "[xmin=0, title={Title}]"));
    expect(set(picture("[xmin=0, xlabel=Time]", PLOTS), pgfplotsElementKey("xlabel"), "")).toBe(source);
    const descriptor = buildPgfplotsInspectorDescriptor(source, axisIdOf(source), evaluate(source).scene.elements);
    const elements = descriptor?.sections.find((section) => section.id === "pgfplots-elements");
    expect(elements?.properties.map((p) => [p.label, p.kind === "boolean" ? p.value : (p as { value: string }).value])).toEqual([
      ["Chart type", "data"], ["Title", false], ["X label", false], ["Y label", false], ["Legend", false], ["Grid", "none"]
    ]);
  });

  it("each toggle is one undo step", () => {
    expectOneUndoStep(source, { kind: "setAxisElement", axisId: AXIS, element: "xlabel", visible: true });
    expectOneUndoStep(picture("[title=A, xmin=0]", PLOTS), { kind: "setAxisElement", axisId: AXIS, element: "title", visible: false });
  });
});

describe("chart elements: legend", () => {
  it("showing adds an \\addlegendentry after each legend image (forget plot has none)", () => {
    const source = picture("", [...PLOTS, "\\addplot[forget plot] coordinates {(0,2) (1,3)};"]);
    const shown = edit(source, { kind: "setAxisElement", axisId: AXIS, element: "legend", visible: true });
    expect(shown).toBe(picture("", [PLOTS[0] ?? "", "\\addlegendentry{Series 1}", PLOTS[1] ?? "", "\\addlegendentry{Series 2}", "\\addplot[forget plot] coordinates {(0,2) (1,3)};"]));
    expect(legendTexts(shown)).toEqual(["Series 1", "Series 2"]);
    expect(drawnParts(shown)).toEqual(["axis:0:legend"]);
    expectOneUndoStep(source, { kind: "setAxisElement", axisId: AXIS, element: "legend", visible: true });
  });

  it("hiding removes the entries in each form; the result draws no legend", () => {
    const forms = [
      picture("", [PLOTS[0] ?? "", "\\addlegendentry{A}", PLOTS[1] ?? "", "\\addlegendentry{B}"]),
      picture("[legend entries={A,B}, xmin=0]", PLOTS),
      picture("", [...PLOTS, "\\legend{A, B}"])
    ];
    const expected = [picture("", PLOTS), picture("[xmin=0]", PLOTS), picture("", PLOTS)];
    forms.forEach((source, i) => {
      const hidden = edit(source, { kind: "setAxisElement", axisId: AXIS, element: "legend", visible: false });
      expect(hidden).toBe(expected[i]);
      expect(legendTexts(hidden)).toEqual([]);
      expectOneUndoStep(source, { kind: "setAxisElement", axisId: AXIS, element: "legend", visible: false });
    });
  });

  it("refuses to hide entries set in a style, and to show a legend without plots", () => {
    const styled = `${PREAMBLE}\\pgfplotsset{every axis/.append style={legend entries={A,B}}}\n\\begin{tikzpicture}\n\\begin{axis}\n${PLOTS.join("\n")}\n\\end{axis}\n\\end{tikzpicture}`;
    expect(run(styled, { kind: "setAxisElement", axisId: AXIS, element: "legend", visible: false }).kind).toBe("unsupported");
    const empty = picture("[xmin=0, xmax=1, ymin=0, ymax=1]", []);
    expect(run(empty, { kind: "setAxisElement", axisId: AXIS, element: "legend", visible: true }).kind).toBe("unsupported");
    expect(readAxisElements(empty, axisIdOf(empty), evaluate(empty).scene.elements)?.legend).toMatchObject({ present: false, enabled: false, reason: expect.any(String) });
  });
});

describe("chart elements: insert plot", () => {
  it("copies the last plot's data form with placeholder data, without its colour, plus a legend entry when the legend is shown", () => {
    const source = picture("", ["\\addplot+[red, only marks] coordinates {(0,0) (1,1)};", "\\addlegendentry{A}"]);
    const inserted = edit(source, { kind: "insertAxisPlot", axisId: AXIS });
    expect(inserted).toBe(picture("", ["\\addplot+[red, only marks] coordinates {(0,0) (1,1)};", "\\addlegendentry{A}", "\\addplot+[only marks] coordinates {(0,1) (1,2)};", "\\addlegendentry{Series 2}"]));
    expect(legendTexts(inserted)).toEqual(["A", "Series 2"]);
    const result = run(source, { kind: "insertAxisPlot", axisId: AXIS });
    expect(result.kind === "success" && result.selectedSourceIds).toEqual(["axis:0:plot:1"]);
    expectOneUndoStep(source, { kind: "insertAxisPlot", axisId: AXIS });
  });

  it("expression plots get `{x}`; symbolic coordinates keep their x; no legend, no entry", () => {
    const fn = picture("[domain=0:1]", ["\\addplot {x^2};"]);
    expect(edit(fn, { kind: "insertAxisPlot", axisId: AXIS })).toBe(picture("[domain=0:1]", ["\\addplot {x^2};", "\\addplot {x};"]));
    const bars = picture("[ybar, symbolic x coords={a,b}, xtick=data]", ["\\addplot coordinates {(a,3) (b,5)};"]);
    expect(edit(bars, { kind: "insertAxisPlot", axisId: AXIS })).toBe(picture("[ybar, symbolic x coords={a,b}, xtick=data]", ["\\addplot coordinates {(a,3) (b,5)};", "\\addplot coordinates {(a,4) (b,6)};"]));
    expect(evaluate(edit(bars, { kind: "insertAxisPlot", axisId: AXIS })).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("keeps \\closedcycle of an area plot", () => {
    const area = picture("", ["\\addplot+[fill] coordinates {(0,1) (1,2)} \\closedcycle;"]);
    expect(edit(area, { kind: "insertAxisPlot", axisId: AXIS })).toBe(picture("", ["\\addplot+[fill] coordinates {(0,1) (1,2)} \\closedcycle;", "\\addplot+[fill] coordinates {(0,2) (1,3)} \\closedcycle;"]));
  });
});

describe("chart elements: reset plot style", () => {
  it("removes only the keys the plot inspector manages; data keys stay", () => {
    const source = picture("", ["\\addplot[red, thick, dashed, mark=square*, mark size=3pt, smooth, domain=0:2, samples=10] {x^2};"]);
    expect(edit(source, { kind: "resetPlotStyle", plotId: "axis:0:plot:0" })).toBe(picture("", ["\\addplot[domain=0:2, samples=10] {x^2};"]));
    expectOneUndoStep(source, { kind: "resetPlotStyle", plotId: "axis:0:plot:0" });
  });

  it("an option list left empty goes, with the `+`", () => {
    for (const plot of ["\\addplot[color=red, only marks] coordinates {(0,0) (1,1)};", "\\addplot+[no markers, line width=2pt] coordinates {(0,0) (1,1)};"]) {
      expect(edit(picture("", [plot]), { kind: "resetPlotStyle", plotId: "axis:0:plot:0" })).toBe(picture("", ["\\addplot coordinates {(0,0) (1,1)};"]));
    }
    expect(run(picture("", ["\\addplot coordinates {(0,0) (1,1)};"]), { kind: "resetPlotStyle", plotId: "axis:0:plot:0" }).kind).toBe("unsupported");
  });
});

describe("chart kinds: one list for insert (and later type switching)", () => {
  it("every kind renders without diagnostics and inserts through the same action", () => {
    for (const kind of CHART_KINDS) {
      const document = chartKindDocument(kind.id);
      const parsed = parseTikz(document, { includeContextDefinitions: true });
      const result = evaluateTikzFigure(parsed.figure, document);
      expect([...parsed.diagnostics, ...result.diagnostics], kind.id).toEqual([]);
      expect(getAxisEvaluations(result.scene), kind.id).toHaveLength(1);
      const inserted = edit("\\begin{tikzpicture}\n\\end{tikzpicture}", { kind: "insertPgfplotsTemplate", template: kind.id });
      expect(inserted, kind.id).toContain(kind.template.split("\n")[0] ?? "");
    }
  });

  it("an inserted log-scale axis beside existing content gets its `at=`", () => {
    const inserted = edit("\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}", { kind: "insertPgfplotsTemplate", template: "semilogy" });
    expect(inserted).toMatch(/\\begin\{semilogyaxis\}\[at=\{\([\d.]+cm,[\d.]+cm\)\}, xlabel/u);
  });
});
