// Change Chart Type (packages/core/src/edit/pgfplots/chart-type.ts): the conversion
// matrix on the insert templates and hand-written charts (each offered switch was
// rendered by LuaLaTeX and compared with the editor: E26,
// scripts/pgfplots-oracle/experiments/e26-chart-type-cases.ts), reversibility, exact
// source edits, the re-evaluated scene and one undo step through the reducer.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { readChartTypeConversions, type ChartTypeConversion } from "../packages/core/src/edit/pgfplots/chart-type.js";
import { CHART_KINDS } from "../packages/core/src/edit/pgfplots/chart-kinds.js";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import type { EditorState } from "../packages/app/src/store/types.js";
import { CHART_TYPE_FIXTURES, CHART_TYPE_PREAMBLE } from "./fixtures/pgfplots/chart-type-fixtures.js";

const EXPECTED = JSON.parse(readFileSync(new URL("./fixtures/pgfplots/chart-type-matrix.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;
const PARSE = { includeContextDefinitions: true };

function evaluate(source: string) {
  const parsed = parseTikz(source, PARSE);
  return { parsed, result: evaluateTikzFigure(parsed.figure, source) };
}

function axisOf(source: string) {
  const axis = parseTikz(source, PARSE).figure.body.find((statement) => statement.kind === "Axis");
  if (axis?.kind !== "Axis") throw new Error("no axis");
  return axis;
}

/** `axis` and `plotN` → element ids. */
function targets(source: string): Array<[string, string]> {
  const axis = axisOf(source);
  return [["axis", axis.id], ...axis.body.filter((item) => item.kind === "AddPlot").map((plot, index): [string, string] => [`plot${String(index)}`, plot.id])];
}

function conversions(source: string, elementId: string): Array<ChartTypeConversion<string>> {
  const list = readChartTypeConversions(source, elementId, evaluate(source).result.scene.elements);
  if (!list) throw new Error(`no conversions for ${elementId}`);
  return list.options as Array<ChartTypeConversion<string>>;
}

function change(source: string, elementId: string, chartType: string): string {
  const result = applyEditAction(source, evaluate(source).result.editHandles, { kind: "changeChartType", elementId, chartType });
  if (result.kind !== "success") throw new Error(`changeChartType ${chartType} failed: ${result.kind === "error" ? result.message : result.kind === "unsupported" ? result.reason : ""}`);
  return result.newSource;
}

const summary = (options: Array<ChartTypeConversion<string>>) => options.map((option) => `${option.kind}${option.current ? "=" : option.available ? "+" : "-"}`).join(" ");

describe("the conversion matrix (each offered switch checked against LuaLaTeX, E26)", () => {
  it.each(CHART_TYPE_FIXTURES.map((fixture) => [fixture.id, fixture] as const))("%s", (id, fixture) => {
    const source = `${CHART_TYPE_PREAMBLE}${fixture.picture}`;
    const actual = Object.fromEntries(targets(source).map(([label, elementId]) => [label, summary(conversions(source, elementId))]));
    expect(actual).toEqual(EXPECTED[id]);
    // Every refusal says why.
    for (const [, elementId] of targets(source)) {
      for (const option of conversions(source, elementId)) if (!option.available) expect(option.reason.length).toBeGreaterThan(10);
    }
  });

  it("lists the insert gallery's kinds for an axis", () => {
    const source = `${CHART_TYPE_PREAMBLE}${CHART_TYPE_FIXTURES[1]?.picture ?? ""}`;
    expect(conversions(source, axisOf(source).id).map((option) => option.label)).toEqual(CHART_KINDS.map((kind) => kind.label));
  });
});

describe("reversibility", () => {
  // A → B → A gives back the exact source of every insert template, for every offered switch.
  const templates = CHART_TYPE_FIXTURES.filter((fixture) => fixture.id.startsWith("template-"));
  it.each(templates.map((fixture) => [fixture.id, fixture] as const))("%s: every offered switch and back is the exact source", (_id, fixture) => {
    const source = `${CHART_TYPE_PREAMBLE}${fixture.picture}`;
    for (const [, elementId] of targets(source)) {
      const options = conversions(source, elementId);
      const current = options.find((option) => option.current)?.kind;
      if (!current) continue;
      for (const option of options.filter((candidate) => candidate.available)) {
        const there = change(source, elementId, option.kind);
        expect(change(there, elementId, current), `${elementId} ${current} → ${option.kind} → ${current}`).toBe(source);
      }
    }
  });

  // Hand-written charts: the way back is offered and gives a source that draws the same.
  const real = CHART_TYPE_FIXTURES.filter((fixture) => fixture.id.startsWith("real-"));
  it.each(real.map((fixture) => [fixture.id, fixture] as const))("%s: every offered switch can be undone by switching back (same drawing)", (_id, fixture) => {
    const source = `${CHART_TYPE_PREAMBLE}${fixture.picture}`;
    const drawing = (text: string) => JSON.stringify(evaluate(text).result.scene.elements.map((element) => [element.kind, element.kind === "Path" ? element.style : null, element.kind === "Path" ? element.commands : null]));
    for (const [, elementId] of targets(source)) {
      const options = conversions(source, elementId);
      const current = options.find((option) => option.current)?.kind;
      if (!current) continue;
      for (const option of options.filter((candidate) => candidate.available)) {
        const back = change(change(source, elementId, option.kind), elementId, current);
        expect(drawing(back), `${elementId} ${current} → ${option.kind} → ${current}`).toBe(drawing(source));
      }
    }
  });
});

describe("exact edits", () => {
  const DATA = `${CHART_TYPE_PREAMBLE}\\begin{tikzpicture}\n${CHART_KINDS.find((kind) => kind.id === "data")?.template ?? ""}\n\\end{tikzpicture}`;
  const axisId = axisOf(DATA).id;
  const plotId = `${axisId}:plot:0`;
  const line = "  \\addplot coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1) (4,4.8)};";

  it("per plot: one key at the front of the list, `+[…]` when the plot had none", () => {
    expect(change(DATA, plotId, "scatter")).toBe(DATA.replace(line, "  \\addplot+[only marks] coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1) (4,4.8)};"));
    expect(change(DATA, plotId, "step")).toBe(DATA.replace(line, "  \\addplot+[const plot] coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1) (4,4.8)};"));
    expect(change(DATA, plotId, "area")).toBe(DATA.replace(line, "  \\addplot+[fill, fill opacity=0.3] coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1) (4,4.8)} \\closedcycle;"));
    // From one type to another: the old key goes, the new one comes, the rest stays.
    const scatter = change(DATA, plotId, "scatter");
    expect(change(scatter, plotId, "smooth")).toBe(DATA.replace(line, "  \\addplot+[smooth] coordinates {(0,1.2) (1,2.3) (2,2.9) (3,4.1) (4,4.8)};"));
  });

  it("axis: `ybar` at the front of the axis options; bar ↔ stacked replaces it in place", () => {
    const bar = change(DATA, axisId, "bar");
    expect(bar).toBe(DATA.replace("\\begin{axis}[xlabel={Time}", "\\begin{axis}[ybar, xlabel={Time}"));
    expect(change(bar, axisId, "stacked-bar")).toBe(DATA.replace("\\begin{axis}[xlabel={Time}", "\\begin{axis}[ybar stacked, xlabel={Time}"));
  });

  it("keeps user keys and comments in the option list", () => {
    const source = `${CHART_TYPE_PREAMBLE}\\begin{tikzpicture}\n\\begin{axis}[ymin=0]\n  \\addplot+[red, % colour\n    smooth, thick] coordinates {(0,1) (1,2) (2,1.5)};\n\\end{axis}\n\\end{tikzpicture}`;
    const id = `${axisOf(source).id}:plot:0`;
    expect(change(source, id, "line")).toBe(source.replace("    smooth, thick]", "    thick]"));
    expect(change(source, id, "scatter")).toBe(source.replace("\\addplot+[red, % colour\n    smooth, thick]", "\\addplot+[only marks, red, % colour\n    thick]"));
  });

  it("re-evaluates: bars are drawn as closed bar paths, an area is filled", () => {
    const bar = change(DATA, axisId, "bar");
    const plotPath = (source: string) => evaluate(source).result.scene.elements.find((element) => element.kind === "Path" && element.sourceRef.sourceId === plotId);
    const barPath = plotPath(bar);
    expect(barPath?.kind === "Path" ? barPath.style.fill : null).not.toBeNull();
    const area = plotPath(change(DATA, plotId, "area"));
    expect(area?.kind === "Path" ? area.style.fillOpacity : null).toBeCloseTo(0.3);
  });

  it("refuses with the reason in the action too", () => {
    const result = applyEditAction(DATA, [], { kind: "changeChartType", elementId: axisId, chartType: "semilogy" });
    expect(result.kind).toBe("unsupported");
    expect(result.kind === "unsupported" ? result.reason : "").toMatch(/Y scale/u);
  });
});

describe("one undo step", () => {
  const source = `${CHART_TYPE_PREAMBLE}\\begin{tikzpicture}\n${CHART_KINDS.find((kind) => kind.id === "bar")?.template ?? ""}\n\\end{tikzpicture}`;
  it.each([["axis to a line chart", "data"], ["axis to stacked bars", "stacked-bar"], ["axis to an area plot", "area"]])("%s", (_name, chartType) => {
    const action: EditAction = { kind: "changeChartType", elementId: axisOf(source).id, chartType };
    const initial: EditorState = { ...makeInitialState(), source, snapshot: { ...makeEmptySnapshot(source), source } };
    const edited = editorReducer(initial, { type: "APPLY_EDIT_ACTION", action });
    expect(edited.source).not.toBe(source);
    expect(edited.history).toHaveLength(1);
    const undone = editorReducer(edited, { type: "UNDO" });
    expect(undone.source).toBe(source);
    expect(editorReducer(undone, { type: "REDO" }).source).toBe(edited.source);
  });
});
