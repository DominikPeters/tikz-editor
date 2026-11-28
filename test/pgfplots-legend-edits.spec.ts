// Structural edits of plots keep each plot's legend entry with it, through the
// association the renderer draws (pgfplots/legend.ts `associateLegend`,
// design/pgfplots-behaviour.md L4). Each case: exact source after the edit,
// and the re-evaluated pairing of plot (by colour) and legend text.
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { getAxisEvaluations } from "../packages/core/src/pgfplots/evaluate-axis.js";
import { PGFPLOTS_LEGEND_ENTRY_KEY, buildPgfplotsInspectorDescriptor } from "../packages/core/src/edit/pgfplots/inspector.js";
import type { Statement } from "../packages/core/src/ast/types.js";
import { nestedStatements } from "../packages/core/src/ast/walk.js";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import type { EditorState } from "../packages/app/src/store/types.js";

const PREAMBLE = "\\pgfplotsset{compat=1.18}\n";
const COLOURS: Record<string, string> = { "#ff0000": "red", "#00ff00": "green", "#0000ff": "blue", "#808080": "gray" };
const DATA: Record<string, string> = { red: "(0,0) (1,1)", green: "(0,1) (1,2)", blue: "(0,2) (1,3)", gray: "(0,3) (1,4)" };
const LABEL: Record<string, string> = { red: "Red", green: "Green", blue: "Blue" };

function evaluate(source: string) {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  return { parsed, result: evaluateTikzFigure(parsed.figure, source) };
}

function axisId(source: string): string {
  const find = (body: readonly Statement[]): string | null => {
    for (const s of body) {
      if (s.kind === "Axis") return s.id;
      const nested = nestedStatements(s);
      const inner = nested ? find(nested) : null;
      if (inner) return inner;
    }
    return null;
  };
  const id = find(parseTikz(source, { includeContextDefinitions: true }).figure.body);
  if (!id) throw new Error("no axis");
  return id;
}

function run(source: string, action: Record<string, unknown>) {
  const { result } = evaluate(source);
  return applyEditAction(source, result.editHandles, action as unknown as EditAction);
}

function edit(source: string, action: Record<string, unknown>): string {
  const result = run(source, action);
  if (result.kind !== "success" && result.kind !== "partial") throw new Error(`edit failed: ${result.kind === "error" ? result.message : result.reason}`);
  return result.newSource;
}

/** Drawn legend pairs as `colour=text`, in image order (re-evaluated). */
function pairing(source: string): string[] {
  const { result } = evaluate(source);
  const axis = getAxisEvaluations(result.scene)[0];
  if (!axis) throw new Error("no axis");
  return axis.legend.images.flatMap((image, i) => {
    const pair = axis.legend.pairing[i];
    if (!pair?.drawn || pair.entry === null) return [];
    const path = result.scene.elements.find((e) => e.id === `scene-path:${image.sourceId}:line`);
    const colour = COLOURS[path?.style.stroke ?? ""] ?? image.sourceId;
    return [`${colour}=${axis.legend.entries[pair.entry]?.text ?? ""}`];
  });
}

const plotLine = (colour: string) => `\\addplot[${colour}] coordinates {${DATA[colour] ?? ""}};`;
const picture = (options: string, body: string[]) => `${PREAMBLE}\\begin{tikzpicture}\n\\begin{axis}${options}\n${body.join("\n")}\n\\end{axis}\n\\end{tikzpicture}`;

/** Each legend form as a source generator for an order of plots. */
const FORMS: Record<string, (order: string[]) => string> = {
  "\\addlegendentry after each plot": (order) => picture("", order.flatMap((c) => [plotLine(c), `\\addlegendentry{${LABEL[c] ?? ""}}`])),
  "\\addlegendentry written apart": (order) => picture("", [...order.map(plotLine), ...order.map((c) => `\\addlegendentry{${LABEL[c] ?? ""}}`)]),
  "legend entries": (order) => picture(`[legend entries={${order.map((c) => LABEL[c] ?? "").join(",")}}, xmin=0]`, order.map(plotLine)),
  "\\legend": (order) => picture("", [...order.map(plotLine), `\\legend{${order.map((c) => LABEL[c] ?? "").join(", ")}}`])
};

const BASE = ["red", "green", "blue"];
const ACTIONS: Array<{ name: string; action: (id: string) => Record<string, unknown>; order: string[] }> = [
  { name: "delete first", action: (id) => ({ kind: "deleteElements", elementIds: [`${id}:plot:0`] }), order: ["green", "blue"] },
  { name: "delete middle", action: (id) => ({ kind: "deleteElements", elementIds: [`${id}:plot:1`] }), order: ["red", "blue"] },
  { name: "delete last", action: (id) => ({ kind: "deleteElements", elementIds: [`${id}:plot:2`] }), order: ["red", "green"] },
  { name: "move up", action: (id) => ({ kind: "reorderElements", elementIds: [`${id}:plot:1`], direction: "sendBackward" }), order: ["green", "red", "blue"] },
  { name: "move down", action: (id) => ({ kind: "reorderElements", elementIds: [`${id}:plot:1`], direction: "bringForward" }), order: ["red", "blue", "green"] }
];

describe("pgfplots legend entries follow their plots", () => {
  for (const [form, make] of Object.entries(FORMS)) {
    describe(form, () => {
      const source = make(BASE);
      it("draws the base pairing", () => {
        expect(pairing(source)).toEqual(["red=Red", "green=Green", "blue=Blue"]);
      });
      for (const { name, action, order } of ACTIONS) {
        it(name, () => {
          const after = edit(source, action(axisId(source)));
          expect(after).toBe(make(order));
          expect(pairing(after)).toEqual(order.map((c) => `${c}=${LABEL[c] ?? ""}`));
        });
      }
    });
  }

  it("a forget plot has no entry and keeps none; the others keep theirs", () => {
    const source = picture("[legend entries={Red,Green,Blue}]", [plotLine("red"), "\\addplot[gray, forget plot] coordinates {(0,3) (1,4)};", plotLine("green"), plotLine("blue")]);
    expect(pairing(source)).toEqual(["red=Red", "green=Green", "blue=Blue"]);
    const id = axisId(source);
    const deleted = edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:2`] });
    expect(deleted).toBe(source.replace("Red,Green,Blue", "Red,Blue").replace(`${plotLine("green")}\n`, ""));
    expect(pairing(deleted)).toEqual(["red=Red", "blue=Blue"]);
    const forget = edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:1`] });
    expect(pairing(forget)).toEqual(["red=Red", "green=Green", "blue=Blue"]);
    const moved = edit(source, { kind: "reorderElements", elementIds: [`${id}:plot:3`], direction: "sendToBack" });
    expect(pairing(moved)).toEqual(["blue=Blue", "red=Red", "green=Green"]);
  });

  it("more plots than entries: a plot without an entry moved before others gets an empty item", () => {
    const source = picture("[legend entries={Red,Green}]", BASE.map(plotLine));
    const id = axisId(source);
    const front = edit(source, { kind: "reorderElements", elementIds: [`${id}:plot:2`], direction: "sendToBack" });
    expect(front).toBe(picture("[legend entries={,Red,Green}]", ["blue", "red", "green"].map(plotLine)));
    expect(pairing(front)).toEqual(["red=Red", "green=Green"]);
    expect(pairing(edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:0`] }))).toEqual(["green=Green"]);
    expect(edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:2`] })).toBe(picture("[legend entries={Red,Green}]", ["red", "green"].map(plotLine)));
  });

  it("more entries than plots: the extra entries stay at the end", () => {
    const source = picture("", [...BASE.map(plotLine), "\\legend{Red,Green,Blue,Extra}"]);
    const id = axisId(source);
    expect(edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:1`] })).toBe(picture("", [...["red", "blue"].map(plotLine), "\\legend{Red,Blue,Extra}"]));
    const moved = edit(source, { kind: "reorderElements", elementIds: [`${id}:plot:0`], direction: "bringToFront" });
    expect(moved).toBe(picture("", [...["green", "blue", "red"].map(plotLine), "\\legend{Green,Blue,Red,Extra}"]));
  });

  it("empty entries move with their plots", () => {
    const source = picture("", [...BASE.map(plotLine), "\\legend{Red,,Blue}"]);
    const id = axisId(source);
    expect(pairing(source)).toEqual(["red=Red", "blue=Blue"]);
    const down = edit(source, { kind: "reorderElements", elementIds: [`${id}:plot:1`], direction: "bringForward" });
    expect(down).toBe(picture("", [...["red", "blue", "green"].map(plotLine), "\\legend{Red,Blue,}"]));
    expect(pairing(down)).toEqual(["red=Red", "blue=Blue"]);
    expect(edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:0`] })).toBe(picture("", [...["green", "blue"].map(plotLine), "\\legend{,Blue}"]));
  });

  it("\\legend beats legend entries: only the list in use changes", () => {
    const source = picture("[legend entries={A,B,C}]", [...BASE.map(plotLine), "\\legend{Red,Green,Blue}"]);
    const id = axisId(source);
    const after = edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:1`] });
    expect(after).toBe(picture("[legend entries={A,B,C}]", [...["red", "blue"].map(plotLine), "\\legend{Red,Blue}"]));
    expect(pairing(after)).toEqual(["red=Red", "blue=Blue"]);
  });

  it("\\addlegendimage takes an entry of the list; plots after it keep theirs", () => {
    const source = picture("[legend entries={Image,Red,Green}]", ["\\addlegendimage{gray}", plotLine("red"), plotLine("green")]);
    const id = axisId(source);
    const after = edit(source, { kind: "deleteElements", elementIds: [`${id}:plot:0`] });
    expect(after).toBe(picture("[legend entries={Image,Green}]", ["\\addlegendimage{gray}", plotLine("green")]));
    expect(pairing(after).slice(1)).toEqual(["green=Green"]);
  });

  it("an emptied list removes its key or statement", () => {
    const single = picture("[legend entries={Red}, xmin=0]", [plotLine("red"), plotLine("green")]);
    expect(edit(single, { kind: "deleteElements", elementIds: [`${axisId(single)}:plot:0`] })).toBe(picture("[xmin=0]", [plotLine("green")]));
    const only = picture("[legend entries={Red}]", [plotLine("red")]);
    expect(edit(only, { kind: "deleteElements", elementIds: [`${axisId(only)}:plot:0`] })).toBe(`${PREAMBLE}\\begin{tikzpicture}\n\\begin{axis}\n\\end{axis}\n\\end{tikzpicture}`);
    const legend = picture("", [plotLine("red"), plotLine("green"), "\\legend{Red}"]);
    expect(edit(legend, { kind: "deleteElements", elementIds: [`${axisId(legend)}:plot:0`] })).toBe(picture("", [plotLine("green")]));
  });

  it("attached \\addlegendentry: a plot without one moved before others gets an empty entry (partial)", () => {
    const source = picture("", [plotLine("red"), "\\addlegendentry{Red}", plotLine("green"), "\\addlegendentry{Green}", plotLine("blue")]);
    const id = axisId(source);
    const result = run(source, { kind: "reorderElements", elementIds: [`${id}:plot:2`], direction: "sendToBack" });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.newSource).toBe(picture("", [plotLine("blue"), "\\addlegendentry{}", plotLine("red"), "\\addlegendentry{Red}", plotLine("green"), "\\addlegendentry{Green}"]));
    expect(pairing(result.newSource)).toEqual(["blue=", "red=Red", "green=Green"]);
  });
});

describe("the inspector's legend entry edits the entry where it is written", () => {
  const descriptorValue = (source: string, plot: number) => {
    const { result } = evaluate(source);
    const descriptor = buildPgfplotsInspectorDescriptor(source, `${axisId(source)}:plot:${String(plot)}`, result.scene.elements);
    const property = descriptor?.sections.flatMap((s) => s.properties).find((p) => p.id === "pgfplots-plot-legend-entry");
    return property && "value" in property ? property.value : undefined;
  };
  const set = (source: string, plot: number, value: string) => edit(source, { kind: "setProperty", elementId: `${axisId(source)}:plot:${String(plot)}`, key: PGFPLOTS_LEGEND_ENTRY_KEY, value });

  for (const [form, make] of Object.entries(FORMS)) {
    it(`reads and writes the entry (${form})`, () => {
      const source = make(BASE);
      expect(descriptorValue(source, 1)).toBe("Green");
      const after = set(source, 1, "Lime");
      expect(after).toBe(make(BASE).replace("{Green}", "{Lime}").replace("Green", "Lime"));
      expect(pairing(after)).toEqual(["red=Red", "green=Lime", "blue=Blue"]);
    });
  }

  it("creates an entry at the plot's index in the list in use, padded with empty items", () => {
    const source = picture("[legend entries={Red}]", BASE.map(plotLine));
    expect(descriptorValue(source, 2)).toBe("");
    const after = set(source, 2, "Blue");
    expect(after).toBe(picture("[legend entries={Red,,Blue}]", BASE.map(plotLine)));
    expect(pairing(after)).toEqual(["red=Red", "blue=Blue"]);
    const legend = picture("", [...BASE.map(plotLine), "\\legend{Red}"]);
    expect(set(legend, 2, "Blue")).toBe(picture("", [...BASE.map(plotLine), "\\legend{Red,,Blue}"]));
  });

  it("creates an \\addlegendentry where it pairs with the plot", () => {
    const none = picture("", BASE.map(plotLine));
    expect(set(none, 0, "Red")).toBe(picture("", [plotLine("red"), "\\addlegendentry{Red}", plotLine("green"), plotLine("blue")]));
    const later = set(none, 2, "Blue");
    expect(later).toBe(picture("", [plotLine("red"), plotLine("green"), plotLine("blue"), "\\legend{,,Blue}"]));
    expect(pairing(later)).toEqual(["blue=Blue"]);
    const attached = picture("", [plotLine("red"), "\\addlegendentry{Red}", plotLine("green"), plotLine("blue")]);
    expect(set(attached, 1, "Green")).toBe(picture("", [plotLine("red"), "\\addlegendentry{Red}", plotLine("green"), "\\addlegendentry{Green}", plotLine("blue")]));
    const apart = picture("", [...BASE.map(plotLine), "\\addlegendentry{Red}"]);
    expect(set(apart, 1, "Green")).toBe(picture("", [...BASE.map(plotLine), "\\addlegendentry{Red}", "\\addlegendentry{Green}"]));
  });

  it("clearing an entry: list items are emptied (no pair) or removed at the end; a last \\addlegendentry is removed", () => {
    const source = picture("[legend entries={Red,Green,Blue}]", BASE.map(plotLine));
    expect(set(source, 1, "")).toBe(picture("[legend entries={Red,,Blue}]", BASE.map(plotLine)));
    expect(set(source, 2, "")).toBe(picture("[legend entries={Red,Green}]", BASE.map(plotLine)));
    const attached = FORMS["\\addlegendentry after each plot"]?.(BASE) ?? "";
    expect(set(attached, 2, "")).toBe(picture("", [plotLine("red"), "\\addlegendentry{Red}", plotLine("green"), "\\addlegendentry{Green}", plotLine("blue")]));
  });
});

describe("each legend-carrying plot edit is one undo step (editor reducer history)", () => {
  const cases: Array<[string, (id: string) => Record<string, unknown>]> = [
    ["delete", (id) => ({ kind: "deleteElements", elementIds: [`${id}:plot:0`] })],
    ["reorder", (id) => ({ kind: "reorderElements", elementIds: [`${id}:plot:1`], direction: "bringForward" })],
    ["legend entry", (id) => ({ kind: "setProperty", elementId: `${id}:plot:2`, key: PGFPLOTS_LEGEND_ENTRY_KEY, value: "Navy" })]
  ];
  for (const [form, make] of Object.entries(FORMS)) {
    for (const [name, action] of cases) {
      it(`${name} (${form})`, () => {
        const source = make(BASE);
        const initial: EditorState = { ...makeInitialState(), source, snapshot: { ...makeEmptySnapshot(source), source } };
        const edited = editorReducer(initial, { type: "APPLY_EDIT_ACTION", action: action(axisId(source)) as unknown as EditAction });
        expect(edited.source).not.toBe(source);
        expect(edited.history).toHaveLength(1);
        expect(edited.history[0]?.sourceBefore).toBe(source);
        expect(edited.history[0]?.sourceAfter).toBe(edited.source);
        const undone = editorReducer(edited, { type: "UNDO" });
        expect(undone.source).toBe(source);
        expect(editorReducer(undone, { type: "REDO" }).source).toBe(edited.source);
      });
    }
  }
});
