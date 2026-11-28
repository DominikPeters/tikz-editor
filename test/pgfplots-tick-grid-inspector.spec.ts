// The axis inspector's Ticks and Grid lines groups (packages/core/src/edit/pgfplots/inspector.ts):
// each control is one key, or one setting inside a style key; the written forms were
// checked against LuaLaTeX (experiment E27, scripts/pgfplots-oracle/experiments/e27-tick-grid-cases.ts).
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { buildPgfplotsInspectorDescriptor, pgfplotsSubstyleKey } from "../packages/core/src/edit/pgfplots/inspector.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import type { EditorState } from "../packages/app/src/store/types.js";

const source = "\\begin{tikzpicture}\n\\begin{axis}[xlabel=x, grid=major]\n\\addplot coordinates {(0,0.12) (1,0.57) (2,0.31)};\n\\end{axis}\n\\end{tikzpicture}";
const AXIS = "axis:0";
const set = (text: string, key: string, value: string): string => {
  const result = applyEditAction(text, [], { kind: "setProperty", elementId: AXIS, level: "command", key, value });
  if (result.kind !== "success") throw new Error(`setProperty ${key} failed: ${result.kind === "unsupported" ? result.reason : result.kind}`);
  return result.newSource;
};
const options = (text: string) => /\\begin\{axis\}\[(.*)\]/u.exec(text)?.[1];

function evaluate(text: string) {
  const result = evaluateTikzFigure(parseTikz(text).figure, text);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code !== "pgfplots-compat")).toEqual([]);
  return result;
}

describe("Ticks group", () => {
  it("positions and labels are braced lists; clearing removes the key", () => {
    const next = set(set(source, "xtick", "0,1,2"), "xticklabels", "a,b,c");
    expect(options(next)).toBe("xlabel=x, grid=major, xtick={0,1,2}, xticklabels={a,b,c}");
    const labels = getAxisEvaluations(evaluate(next).scene)[0]?.labels.filter((label) => label.role === "xtick").map((label) => label.text);
    expect(labels).toEqual(["a", "b", "c"]);
    expect(set(next, "xticklabels", "")).toBe(set(source, "xtick", "0,1,2"));
  });

  it("label size, colour and rotation are settings of the tick label styles; other settings stay", () => {
    const sized = set(source, pgfplotsSubstyleKey("tick label style", "font"), "\\small");
    expect(options(sized)).toBe("xlabel=x, grid=major, tick label style={font=\\small}");
    const coloured = set(sized, pgfplotsSubstyleKey("tick label style", "color"), "red");
    expect(options(coloured)).toBe("xlabel=x, grid=major, tick label style={font=\\small, color=red}");
    expect(options(set(coloured, pgfplotsSubstyleKey("tick label style", "font"), ""))).toBe("xlabel=x, grid=major, tick label style={color=red}");
    expect(set(set(coloured, pgfplotsSubstyleKey("tick label style", "font"), ""), pgfplotsSubstyleKey("tick label style", "color"), "")).toBe(source);
    const rotated = set(source, pgfplotsSubstyleKey("xticklabel style", "rotate"), "45");
    expect(options(rotated)).toBe("xlabel=x, grid=major, xticklabel style={rotate=45}");
    evaluate(rotated);
    // The inspector reads them back.
    const descriptor = buildPgfplotsInspectorDescriptor(coloured, AXIS, evaluate(coloured).scene.elements);
    const ticks = descriptor?.sections.find((section) => section.id === "pgfplots-ticks");
    expect(ticks?.properties.map((property) => [property.label, (property as { value: unknown }).value])).toEqual([
      ["X tick step", ""], ["Y tick step", ""], ["X ticks", ""], ["Y ticks", ""], ["X tick labels", ""],
      ["Label size", "\\small"], ["Label color", "red"], ["X rotation", ""], ["Numbers", ""], ["Precision", ""]
    ]);
  });

  it("number format: fixed point is a bare flag, precision a key", () => {
    const fixed = set(source, "/pgf/number format/fixed", "fixed");
    expect(options(fixed)).toBe("xlabel=x, grid=major, /pgf/number format/fixed");
    const precise = set(fixed, "/pgf/number format/precision", "3");
    expect(options(precise)).toBe("xlabel=x, grid=major, /pgf/number format/fixed, /pgf/number format/precision=3");
    expect(options(set(precise, "/pgf/number format/fixed", ""))).toBe("xlabel=x, grid=major, /pgf/number format/precision=3");
  });
});

describe("Grid lines group", () => {
  it("colour and dash are settings of `grid style`; the minor colour of `minor grid style`", () => {
    const dashed = set(source, pgfplotsSubstyleKey("grid style", "dash"), "dashed");
    expect(options(dashed)).toBe("xlabel=x, grid=major, grid style={dashed}");
    const coloured = set(dashed, pgfplotsSubstyleKey("grid style", "color"), "blue!50");
    expect(options(coloured)).toBe("xlabel=x, grid=major, grid style={dashed, color=blue!50}");
    expect(options(set(coloured, pgfplotsSubstyleKey("grid style", "dash"), "dotted"))).toBe("xlabel=x, grid=major, grid style={color=blue!50, dotted}");
    const grid = evaluate(coloured).scene.elements.find((element) => element.kind === "Path" && element.id.includes("grid"));
    expect(grid?.kind === "Path" ? grid.style.dashArray : null).not.toBeNull();
    expect(options(set(source, pgfplotsSubstyleKey("minor grid style", "color"), "gray!30"))).toBe("xlabel=x, grid=major, minor grid style={color=gray!30}");
  });
});

describe("one undo step each", () => {
  it.each<[string, string]>([[pgfplotsSubstyleKey("tick label style", "font"), "\\small"], ["xtick", "0,1"], [pgfplotsSubstyleKey("grid style", "dash"), "dashed"], ["/pgf/number format/fixed", "fixed"]])("%s", (key, value) => {
    const action: EditAction = { kind: "setProperty", elementId: AXIS, level: "command", key, value };
    const initial: EditorState = { ...makeInitialState(), source, snapshot: { ...makeEmptySnapshot(source), source } };
    const edited = editorReducer(initial, { type: "APPLY_EDIT_ACTION", action });
    expect(edited.history).toHaveLength(1);
    expect(editorReducer(edited, { type: "UNDO" }).source).toBe(source);
  });
});
