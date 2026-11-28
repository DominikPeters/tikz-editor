// Editing pgfplots axes (design/pgfplots.md section 8, Phase 6): every action
// is checked as source before -> action -> exact source after -> re-evaluated
// geometry.
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { readAxisEditInfo } from "../packages/core/src/edit/pgfplots/axis-actions.js";
import { buildPgfplotsInspectorDescriptor, PGFPLOTS_EXPRESSION_KEY, PGFPLOTS_LEGEND_ENTRY_KEY } from "../packages/core/src/edit/pgfplots/inspector.js";
import { resolvePropertyTarget } from "../packages/core/src/edit/property-target.js";
import type { PgfplotsAxisEditInfo, SceneElement } from "../packages/core/src/semantic/types.js";
import type { Statement } from "../packages/core/src/ast/types.js";
import { nestedStatements } from "../packages/core/src/ast/walk.js";

const PREAMBLE = "\\pgfplotsset{compat=1.18}\n";

function evaluate(source: string) {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  return evaluateTikzFigure(parsed.figure, source);
}

function info(source: string, axisId = "axis:0"): PgfplotsAxisEditInfo {
  const found = readAxisEditInfo(evaluate(source).scene.elements, axisId);
  if (!found) throw new Error("no axis geometry");
  return found;
}

function worldBox(i: PgfplotsAxisEditInfo) {
  const { a, b, c, d, e, f } = i.frame;
  const w = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
  return { sw: w(i.box.x0, i.box.y0), ne: w(i.box.x1, i.box.y1) };
}

function apply(source: string, action: Record<string, unknown>): string {
  const result = applyEditAction(source, evaluate(source).editHandles, action as unknown as EditAction);
  if (result.kind !== "success" && result.kind !== "partial") throw new Error(`edit failed: ${result.kind === "error" ? result.message : result.reason}`);
  return result.newSource;
}

function picture(body: string) {
  return `${PREAMBLE}\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
}

const AXIS_ID = (source: string) => {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const find = (body: readonly Statement[]): string | null => {
    for (const s of body) {
      if (s.kind === "Axis") return s.id;
      const nested = nestedStatements(s);
      const inner = nested ? find(nested) : null;
      if (inner) return inner;
    }
    return null;
  };
  const id = find(parsed.figure.body);
  if (!id) throw new Error("no axis");
  return id;
};

describe("pgfplots editing: move", () => {
  it("adds at= in cm to an axis without one; the box moves by exactly the delta", () => {
    const source = picture(String.raw`\begin{axis}[xmin=0, xmax=1, % range
  ymin=0, ymax=1]
\addplot coordinates {(0,0) (1,1)};
\end{axis}`);
    const id = AXIS_ID(source);
    const before = worldBox(info(source, id));
    const delta = { x: 28.452755, y: -14.226378 };
    const after = apply(source, { kind: "moveElements", elementIds: [id], delta });
    expect(after).toBe(source.replace("ymin=0, ymax=1]", "ymin=0, ymax=1,\n  at={(1cm,-0.5cm)}]"));
    const moved = worldBox(info(after, id));
    expect(moved.sw.x - before.sw.x).toBeCloseTo(delta.x, 1);
    expect(moved.sw.y - before.sw.y).toBeCloseTo(delta.y, 1);
    expect(moved.ne.x - before.ne.x).toBeCloseTo(delta.x, 1);
  });

  it("updates an existing at=, keeping its unit and anchor=", () => {
    const source = picture(String.raw`\begin{axis}[anchor=north east, at={(10pt,20pt)}, width=6cm]
\addplot {x};
\end{axis}`);
    const id = AXIS_ID(source);
    const before = worldBox(info(source, id));
    const after = apply(source, { kind: "moveElements", elementIds: [id], delta: { x: 5, y: -10 } });
    expect(after).toBe(source.replace("at={(10pt,20pt)}", "at={(15pt,10pt)}"));
    const moved = worldBox(info(after, id));
    expect(moved.ne.x - before.ne.x).toBeCloseTo(5, 3);
    expect(moved.ne.y - before.ne.y).toBeCloseTo(-10, 3);
  });

  it("writes a unitless at= through the parent's x/y vectors, in a shifted scope", () => {
    const source = picture(String.raw`\begin{scope}[xshift=2cm, x=2cm, y=1cm]
\begin{axis}[at={(1,1)}]
\addplot {x};
\end{axis}
\end{scope}`);
    const id = AXIS_ID(source);
    const before = worldBox(info(source, id));
    const delta = { x: 56.905512, y: 28.452756 };
    const after = apply(source, { kind: "moveElements", elementIds: [id], delta });
    expect(after).toBe(source.replace("at={(1,1)}", "at={(2,2)}"));
    const moved = worldBox(info(after, id));
    expect(moved.sw.x - before.sw.x).toBeCloseTo(delta.x, 2);
    expect(moved.sw.y - before.sw.y).toBeCloseTo(delta.y, 2);
  });
});

describe("pgfplots editing: resize", () => {
  it("dragging the right edge writes width (and pins the implied height) so the edge lands under the pointer", () => {
    const source = picture(String.raw`\begin{axis}[width=8cm]
\addplot {x};
\end{axis}`);
    const id = AXIS_ID(source);
    const i = info(source, id);
    const { bbox } = i;
    const after = apply(source, { kind: "resizeElement", elementId: id, role: "right", newWorld: { x: bbox.maxX + 28.452756, y: (bbox.minY + bbox.maxY) / 2 }, referenceBounds: bbox });
    // A2: height was implied by width (8cm * 207/240 = 6.9cm); it is pinned.
    expect(after).toBe(source.replace("[width=8cm]", "[width=9cm, height=6.9cm]"));
    const j = info(after, id);
    expect(j.box.x1 - j.box.x0).toBeCloseTo(i.box.x1 - i.box.x0 + 28.452756, 1);
    expect(j.box.y1 - j.box.y0).toBeCloseTo(i.box.y1 - i.box.y0, 1);
    expect(j.box.x0).toBeCloseTo(i.box.x0, 6);
  });

  it("with scale only axis the box is width/height; dragging the left edge keeps the right edge (rewrites at)", () => {
    const source = picture(String.raw`\begin{axis}[scale only axis, width=100pt, height=80pt]
\addplot {x};
\end{axis}`);
    const id = AXIS_ID(source);
    const i = info(source, id);
    const after = apply(source, { kind: "resizeElement", elementId: id, role: "left", newWorld: { x: i.bbox.minX - 20, y: 0 }, referenceBounds: i.bbox });
    expect(after).toBe(source.replace("height=80pt]", "height=80pt, at={(-20pt,0pt)}]").replace("width=100pt", "width=120pt"));
    const j = info(after, id);
    expect(j.box.x1 - j.box.x0).toBeCloseTo(120, 6);
    expect(j.box.x1).toBeCloseTo(i.box.x1, 6);
  });

  it("a corner drag without width/height writes both in cm (45pt allowance inverted)", () => {
    const source = picture(String.raw`\begin{axis}
\addplot {x};
\end{axis}`);
    const id = AXIS_ID(source);
    const i = info(source, id);
    const after = apply(source, { kind: "resizeElement", elementId: id, role: "top-right", newWorld: { x: i.bbox.maxX + 10, y: i.bbox.maxY + 20 }, referenceBounds: i.bbox });
    const j = info(after, id);
    expect(after).toMatch(/\\begin\{axis\}\[width=[\d.]+cm, height=[\d.]+cm\]/u);
    expect(j.box.x1 - j.box.x0).toBeCloseTo(195 + 10, 0);
    expect(j.box.y1 - j.box.y0).toBeCloseTo(162 + 20, 0);
  });
});

describe("pgfplots editing: property targets", () => {
  it("resolves the axis, its descriptions and plots", () => {
    const source = picture(String.raw`\begin{axis}[xlabel=$x$]
\addplot coordinates {(0,0) (1,1)};
\addplot+[red] {x};
\addplot[blue] {x};
\end{axis}`);
    const id = AXIS_ID(source);
    const axisTarget = resolvePropertyTarget(source, id);
    expect(axisTarget.kind === "found" && axisTarget.target.kind).toBe("pgfplots-axis");
    const label = resolvePropertyTarget(source, `${id}:xlabel`);
    expect(label.kind === "found" && label.target.kind).toBe("pgfplots-axis");
    const plot = resolvePropertyTarget(source, `${id}:plot:0`);
    expect(plot.kind === "found" && plot.target.kind).toBe("pgfplots-plot");
  });

  it("G2: a mark on a plot without options keeps the cycle list (\\addplot+[…]); explicit lists are edited in place", () => {
    const source = picture(String.raw`\begin{axis}
\addplot coordinates {(0,0) (1,1)};
\addplot[blue, % keep
  thick] {x};
\end{axis}`);
    const id = AXIS_ID(source);
    const once = apply(source, { kind: "setProperty", elementId: `${id}:plot:0`, level: "command", key: "mark", value: "square*" });
    expect(once).toBe(source.replace("\\addplot coordinates", "\\addplot+[mark=square*] coordinates"));
    // The cycle list colour stays: the line is still blue (cycle entry 0).
    const line = evaluate(once).scene.elements.find((e: SceneElement) => e.sourceRef.sourceId === `${id}:plot:0` && e.id.endsWith(":line"));
    expect(line?.style.stroke).toBe("#0000ff");
    const twice = apply(once, { kind: "setProperty", elementId: `${id}:plot:1`, level: "command", key: "mark", value: "*" });
    expect(twice).toBe(once.replace("thick]", "thick,\n  mark=*]"));
    const removed = apply(twice, { kind: "setProperty", elementId: `${id}:plot:0`, level: "command", key: "mark", value: "" });
    expect(removed).toBe(twice.replace("\\addplot+[mark=square*] coordinates", "\\addplot+ coordinates"));
  });

  it("writes axis keys into the axis options", () => {
    const source = picture(String.raw`\begin{axis}[ymin=0]
\addplot {x};
\end{axis}`);
    const id = AXIS_ID(source);
    expect(apply(source, { kind: "setProperty", elementId: id, level: "command", key: "xlabel", value: "{Time}" }))
      .toBe(source.replace("[ymin=0]", "[ymin=0, xlabel={Time}]"));
    expect(apply(source, { kind: "setProperty", elementId: id, level: "command", key: "ymin", value: "" }))
      .toBe(source.replace("[ymin=0]", ""));
  });
});

describe("pgfplots editing: structure", () => {
  const SOURCE = picture(String.raw`\begin{axis}[title=T, xlabel={$t$}]
\addplot coordinates {(0,0) (1,1)};
\addlegendentry{first}
\draw (0,0) -- (1,1);
\addplot {x^2};
\addlegendentry{second}
\addplot {x};
\end{axis}`);

  it("deleting a plot removes it with the legend entry right after it", () => {
    const id = AXIS_ID(SOURCE);
    expect(apply(SOURCE, { kind: "deleteElements", elementIds: [`${id}:plot:0`] }))
      .toBe(SOURCE.replace("\\addplot coordinates {(0,0) (1,1)};\n\\addlegendentry{first}\n", ""));
    expect(apply(SOURCE, { kind: "deleteElements", elementIds: [`${id}:plot:2`] }))
      .toBe(SOURCE.replace("\\addplot {x};\n", ""));
  });

  it("deleting a selected title or label removes its key", () => {
    const id = AXIS_ID(SOURCE);
    expect(apply(SOURCE, { kind: "deleteElements", elementIds: [`${id}:title`] }))
      .toBe(SOURCE.replace("[title=T, xlabel={$t$}]", "[xlabel={$t$}]"));
  });

  it("reordering moves a plot with its legend entry; other statements stay", () => {
    const id = AXIS_ID(SOURCE);
    const after = apply(SOURCE, { kind: "reorderElements", elementIds: [`${id}:plot:0`], direction: "bringForward" });
    expect(after).toBe(picture(String.raw`\begin{axis}[title=T, xlabel={$t$}]
\addplot {x^2};
\addlegendentry{second}
\draw (0,0) -- (1,1);
\addplot coordinates {(0,0) (1,1)};
\addlegendentry{first}
\addplot {x};
\end{axis}`));
    const front = apply(SOURCE, { kind: "reorderElements", elementIds: [`${id}:plot:0`], direction: "bringToFront" });
    expect(front.indexOf("\\addplot {x};")).toBeLessThan(front.indexOf("coordinates"));
  });
});

describe("pgfplots editing: descriptions and legend", () => {
  it("description and legend texts are sub-selections with spans into the source", () => {
    const source = picture(String.raw`\begin{axis}[xlabel={Time}, ylabel=Speed, title={Run}, legend entries={a,b}]
\addplot coordinates {(0,0) (1,1)};
\addplot coordinates {(0,1) (1,0)};
\end{axis}`);
    const id = AXIS_ID(source);
    const texts = evaluate(source).scene.elements.filter((e) => e.kind === "Text");
    const bySource = (sourceId: string) => texts.filter((t) => t.sourceRef.sourceId === sourceId);
    for (const [part, text] of [["xlabel", "Time"], ["ylabel", "Speed"], ["title", "Run"]] as const) {
      const [element] = bySource(`${id}:${part}`);
      expect(element?.kind === "Text" && element.textSourceSpan && source.slice(element.textSourceSpan.from, element.textSourceSpan.to)).toBe(text);
    }
    const legend = bySource(`${id}:legend`).flatMap((t) => (t.kind === "Text" && t.textSourceSpan ? [source.slice(t.textSourceSpan.from, t.textSourceSpan.to)] : []));
    expect(legend).toEqual(["a", "b"]);
    // Tick labels stay with the axis and are not editable text.
    expect(texts.some((t) => t.sourceRef.sourceId === id && t.kind === "Text" && !t.textSourceSpan)).toBe(true);
  });

  it("\\addlegendentry text has its span", () => {
    const source = picture(String.raw`\begin{axis}
\addplot coordinates {(0,0) (1,1)};
\addlegendentry{$x^2$ fit}
\end{axis}`);
    const id = AXIS_ID(source);
    const entry = evaluate(source).scene.elements.find((e) => e.kind === "Text" && e.sourceRef.sourceId === `${id}:legend` && e.textSourceSpan);
    expect(entry?.kind === "Text" && entry.textSourceSpan && source.slice(entry.textSourceSpan.from, entry.textSourceSpan.to)).toBe("$x^2$ fit");
  });

  it("dragging the legend writes legend style at/anchor in axis description coordinates", () => {
    const source = picture(String.raw`\begin{axis}[legend style={font=\small}]
\addplot coordinates {(0,0) (1,1)};
\addlegendentry{a}
\end{axis}`);
    const id = AXIS_ID(source);
    const i = info(source, id);
    const w = i.box.x1 - i.box.x0; const h = i.box.y1 - i.box.y0;
    const after = apply(source, { kind: "moveElements", elementIds: [`${id}:legend`], delta: { x: -0.3 * w, y: -0.4 * h } });
    expect(after).toBe(source.replace("legend style={font=\\small}", "legend style={font=\\small, at={(0.68,0.58)}, anchor=north east}"));
    const j = info(after, id);
    expect(j.legend && i.legend && j.legend.bbox.maxX - i.legend.bbox.maxX).toBeCloseTo(-0.3 * w, 0);
    expect(j.legend && i.legend && j.legend.bbox.maxY - i.legend.bbox.maxY).toBeCloseTo(-0.4 * h, 0);
  });

  it("a legend dropped near a legend pos preset snaps to it and drops the conflicting at", () => {
    const source = picture(String.raw`\begin{axis}[legend style={at={(0.5,0.5)}, anchor=center}]
\addplot coordinates {(0,0) (1,1)};
\addlegendentry{a}
\end{axis}`);
    const id = AXIS_ID(source);
    const i = info(source, id);
    if (!i.legend) throw new Error("no legend");
    const w = i.box.x1 - i.box.x0; const h = i.box.y1 - i.box.y0;
    // Move the legend's south west corner to (0.03, 0.03) of the box, give or take a little.
    const dx = i.box.x0 + 0.035 * w - i.legend.bbox.minX;
    const dy = i.box.y0 + 0.025 * h - i.legend.bbox.minY;
    const after = apply(source, { kind: "moveElements", elementIds: [`${id}:legend`], delta: { x: dx, y: dy } });
    expect(after).toBe(source.replace("legend style={at={(0.5,0.5)}, anchor=center}", "legend pos=south west"));
  });
});

describe("pgfplots editing: log and reversed axes", () => {
  it("point handles on a log axis write data values through the inverse map", () => {
    const source = picture(String.raw`\begin{axis}[ymode=log, xmin=0, xmax=4, ymin=1, ymax=10000]
\addplot coordinates {(1,10) (2,100) (3,1000)};
\end{axis}`);
    const id = AXIS_ID(source);
    const result = evaluate(source);
    const handles = result.editHandles.filter((h) => h.sourceRef.sourceId === `${id}:plot:0`);
    expect(handles.map((h) => h.sourceText)).toEqual(["(1,10)", "(2,100)", "(3,1000)"]);
    const i = info(source, id);
    expect(i.linear).toBe(false);
    const decade = i.box.y1 - i.box.y0; // four decades over the box height
    const handle = handles[1];
    if (!handle) throw new Error("no handle");
    const moved = applyEditAction(source, result.editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: { x: handle.world.x, y: handle.world.y + decade / 4 }, bypassSnapping: true } as unknown as EditAction);
    expect(moved.kind === "success" && moved.newSource).toBe(source.replace("(2,100)", "(2,1000)"));
  });

  it("a reversed axis moves and resizes like any other", () => {
    const source = picture(String.raw`\begin{axis}[x dir=reverse, width=8cm]
\addplot coordinates {(0,0) (1,1)};
\end{axis}`);
    const id = AXIS_ID(source);
    const before = worldBox(info(source, id));
    const moved = apply(source, { kind: "moveElements", elementIds: [id], delta: { x: 28.452756, y: 0 } });
    expect(moved).toBe(source.replace("width=8cm]", "width=8cm, at={(1cm,0cm)}]"));
    expect(worldBox(info(moved, id)).sw.x - before.sw.x).toBeCloseTo(28.452756, 2);
    const i = info(source, id);
    const resized = apply(source, { kind: "resizeElement", elementId: id, role: "right", newWorld: { x: i.bbox.maxX + 28.452756, y: 0 }, referenceBounds: i.bbox });
    expect(resized).toBe(source.replace("[x dir=reverse, width=8cm]", "[x dir=reverse, width=9cm, height=6.9cm]"));
  });

  it("an axis equal axis resizes through width/height: its units come from the ratio, not from x=/y= (behaviour AA1)", () => {
    const source = picture(String.raw`\begin{axis}[axis equal, width=8cm]
\addplot coordinates {(0,0) (1,1)};
\end{axis}`);
    const id = AXIS_ID(source);
    const i = info(source, id);
    expect(i.size.xUnit).toBeUndefined();
    const resized = apply(source, { kind: "resizeElement", elementId: id, role: "right", newWorld: { x: i.bbox.maxX + 28.452756, y: 0 }, referenceBounds: i.bbox });
    expect(resized).toBe(source.replace("[axis equal, width=8cm]", "[axis equal, width=9cm, height=6.9cm]"));
    // `axis equal` keeps the box (limits widen), so the edge follows the drag.
    const j = info(resized, id);
    expect(j.box.x1 - j.box.x0).toBeCloseTo(i.box.x1 - i.box.x0 + 28.452756, 1);
  });
});

describe("pgfplots editing: inserting and deleting data points", () => {
  const SOURCE = picture(String.raw`\begin{axis}[xmin=0, xmax=4, ymin=0, ymax=4]
\addplot coordinates {(1,1) (2,3) (3,2)};
\end{axis}`);
  it("deletes the point a handle stands for", () => {
    const id = AXIS_ID(SOURCE);
    const result = evaluate(SOURCE);
    const handles = result.editHandles.filter((h) => h.sourceRef.sourceId === `${id}:plot:0`);
    for (const [index, expected] of [[0, "{(2,3) (3,2)}"], [1, "{(1,1) (3,2)}"], [2, "{(1,1) (2,3)}"]] as const) {
      const handle = handles[index];
      if (!handle) throw new Error("no handle");
      const after = applyEditAction(SOURCE, result.editHandles, { kind: "deletePathPoint", elementId: `${id}:plot:0`, handleId: handle.id });
      expect(after.kind === "success" && after.newSource).toBe(SOURCE.replace("{(1,1) (2,3) (3,2)}", expected));
    }
  });
  it("inserts a point after a segment's first point, in data units", () => {
    const id = AXIS_ID(SOURCE);
    const result = evaluate(SOURCE);
    const i = info(SOURCE, id);
    const world = { x: i.frame.e + i.map.origin.x + 1.5 * i.map.xUnit.x, y: i.frame.f + i.map.origin.y + 2 * i.map.yUnit.y };
    const after = applyEditAction(SOURCE, result.editHandles, { kind: "insertPathPoint", elementId: `${id}:plot:0`, segmentIndex: 0, point: world } as unknown as EditAction);
    expect(after.kind === "success" && after.newSource).toBe(SOURCE.replace("(1,1) (2,3)", "(1,1) (1.5,2) (2,3)"));
  });
});

describe("pgfplots editing: data points", () => {
  it("coordinates plots have point handles that write data units", () => {
    const source = picture(String.raw`\begin{axis}[xmin=0, xmax=4, ymin=0, ymax=4]
\addplot coordinates {(1,1) (2,3) (3,2)};
\end{axis}`);
    const id = AXIS_ID(source);
    const result = evaluate(source);
    const handles = result.editHandles.filter((h) => h.sourceRef.sourceId === `${id}:plot:0`);
    expect(handles.map((h) => h.sourceText)).toEqual(["(1,1)", "(2,3)", "(3,2)"]);
    const i = info(source, id);
    const unitX = i.map.xUnit.x; const unitY = i.map.yUnit.y;
    const handle = handles[1];
    if (!handle) throw new Error("no handle");
    const moved = applyEditAction(source, result.editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: { x: handle.world.x + 0.5 * unitX, y: handle.world.y - unitY }, bypassSnapping: true } as unknown as EditAction);
    expect(moved.kind === "success" && moved.newSource).toBe(source.replace("(2,3)", "(2.5,2)"));
  });
});

describe("pgfplots editing: inspector", () => {
  const SOURCE = picture(String.raw`\begin{axis}[xmin=0, xlabel=Time]
\addplot coordinates {(0,0) (1,1)};
\addlegendentry{data}
\addplot[red, domain=0:2] {x^2};
\end{axis}`);

  it("axis sections read authored values and show computed limits as placeholders (plain labels)", () => {
    const id = AXIS_ID(SOURCE);
    const descriptor = buildPgfplotsInspectorDescriptor(SOURCE, id, evaluate(SOURCE).scene.elements);
    const props = new Map(descriptor?.sections.flatMap((s) => s.properties.map((p) => [p.id, p] as const)));
    const xmin = props.get("pgfplots-xmin"); const xmax = props.get("pgfplots-xmax");
    expect(xmin?.kind === "text" && xmin.value).toBe("0");
    expect(xmax?.kind === "text" && [xmax.value, xmax.label, xmax.placeholder]).toEqual(["", "X max", expect.stringMatching(/^[\d.]+$/u)]);
    expect(xmin?.kind === "text" && xmin.placeholder).toMatch(/^-?[\d.]+$/u);
    const width = props.get("pgfplots-width");
    expect(width?.kind === "text" && [width.label, width.placeholder]).toEqual(["Width", "240pt"]);
    const tick = props.get("pgfplots-xtick-distance");
    expect(tick?.kind === "text" && [tick.label, tick.placeholder]).toEqual(["X tick distance", "Auto"]);
    for (const property of descriptor?.sections.flatMap((s) => s.properties) ?? []) expect(property.label).not.toMatch(/auto|\(/iu);
    expect(props.get("pgfplots-xlabel")?.kind === "text" && (props.get("pgfplots-xlabel") as { value: string }).value).toBe("Time");
    expect(descriptor?.sections.map((s) => s.id)).toEqual(["pgfplots-elements", "pgfplots-labels", "pgfplots-size", "pgfplots-limits", "pgfplots-axes", "pgfplots-legend"]);
  });

  it("plot sections: cycle-list defaults, legend entry, expression", () => {
    const id = AXIS_ID(SOURCE);
    const elements = evaluate(SOURCE).scene.elements;
    const first = buildPgfplotsInspectorDescriptor(SOURCE, `${id}:plot:0`, elements);
    const p0 = new Map(first?.sections.flatMap((s) => s.properties.map((p) => [p.id, p] as const)));
    const mark = p0.get("pgfplots-plot-mark");
    expect(mark?.kind === "enum" && [mark.value, mark.options[0]?.label]).toEqual(["default", "Default (*)"]);
    expect((p0.get("pgfplots-plot-color") as { value: string }).value).toBe("blue");
    expect((p0.get("pgfplots-plot-legend-entry") as { value: string }).value).toBe("data");
    const second = buildPgfplotsInspectorDescriptor(SOURCE, `${id}:plot:1`, elements);
    const p1 = new Map(second?.sections.flatMap((s) => s.properties.map((p) => [p.id, p] as const)));
    expect((p1.get("pgfplots-plot-expression") as { value: string }).value).toBe("x^2");
    expect((p1.get("pgfplots-plot-domain") as { value: string }).value).toBe("0:2");
    expect(p1.get("pgfplots-plot-samples")).toMatchObject({ label: "Samples", value: "", placeholder: "25" });
    expect(p1.get("pgfplots-plot-color")?.label).toBe("Color");
  });

  it("writes: braced text, auto/default removal, legend entry insert/edit/remove, expression", () => {
    const id = AXIS_ID(SOURCE);
    const set = (src: string, elementId: string, key: string, value: string) => apply(src, { kind: "setProperty", elementId, level: "command", key, value });
    expect(set(SOURCE, id, "xlabel", "Time, s")).toBe(SOURCE.replace("xlabel=Time", "xlabel={Time, s}"));
    expect(set(SOURCE, id, "xmin", "auto")).toBe(SOURCE.replace("xmin=0, ", ""));
    expect(set(SOURCE, id, "grid", "major")).toBe(SOURCE.replace("xlabel=Time]", "xlabel=Time, grid=major]"));
    expect(set(set(SOURCE, id, "grid", "major"), id, "grid", "none")).toBe(SOURCE);
    expect(set(SOURCE, id, "xmode", "log")).toBe(SOURCE.replace("xlabel=Time]", "xlabel=Time, xmode=log]"));
    expect(set(SOURCE, `${id}:plot:0`, PGFPLOTS_LEGEND_ENTRY_KEY, "measured")).toBe(SOURCE.replace("{data}", "{measured}"));
    expect(set(SOURCE, `${id}:plot:0`, PGFPLOTS_LEGEND_ENTRY_KEY, "")).toBe(SOURCE.replace("\n\\addlegendentry{data}", ""));
    expect(set(SOURCE, `${id}:plot:1`, PGFPLOTS_LEGEND_ENTRY_KEY, "square")).toBe(SOURCE.replace("{x^2};", "{x^2};\n\\addlegendentry{square}"));
    expect(set(SOURCE, `${id}:plot:1`, PGFPLOTS_EXPRESSION_KEY, "sin(deg(x))")).toBe(SOURCE.replace("{x^2}", "{sin(deg(x))}"));
    expect(set(SOURCE, `${id}:plot:1`, "color", "blue")).toBe(SOURCE.replace("[red, domain=0:2]", "[red, domain=0:2, color=blue]"));
    expect(set(SOURCE, `${id}:plot:0`, "only marks", "true")).toBe(SOURCE.replace("\\addplot coordinates", "\\addplot+[only marks] coordinates"));
    expect(set(set(SOURCE, `${id}:plot:1`, "mark", "square"), `${id}:plot:1`, "mark", "default")).toBe(SOURCE);
  });
});

describe("pgfplots editing: insert templates", () => {
  it("adds compat once, appends the axis beside existing content and selects it", () => {
    const bare = "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
    const result = applyEditAction(bare, [], { kind: "insertPgfplotsTemplate", template: "function" });
    if (result.kind !== "success") throw new Error("insert failed");
    expect(result.newSource).toBe(`\\pgfplotsset{compat=1.18}\n\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n  ${String.raw`\begin{axis}[at={(2cm,0cm)}, xlabel={$x$}, ylabel={$f(x)$}, domain=-2:2, samples=50]
    \addplot {x^2 - 1};
    \addlegendentry{$x^2 - 1$}
  \end{axis}`}\n\\end{tikzpicture}`);
    expect(result.selectedSourceIds).toEqual([AXIS_ID(result.newSource)]);
    const twice = applyEditAction(result.newSource, [], { kind: "insertPgfplotsTemplate", template: "data" });
    if (twice.kind !== "success") throw new Error("insert failed");
    expect(twice.newSource.match(/compat=1\.18/gu)).toHaveLength(1);
    const evaluated = evaluate(twice.newSource);
    expect(evaluated.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(evaluated.scene.elements.some((e) => /^axis:\d+:plot:0$/u.test(e.sourceRef.sourceId))).toBe(true);
  });

  it("in a full document adds \\usepackage{pgfplots} and compat to the preamble", () => {
    const doc = "\\documentclass{article}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\n\\end{tikzpicture}\n\\end{document}";
    const result = applyEditAction(doc, [], { kind: "insertPgfplotsTemplate", template: "bar" });
    if (result.kind !== "success") throw new Error("insert failed");
    expect(result.newSource.startsWith("\\documentclass{article}\n\\usepackage{tikz}\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=1.18}\n\\begin{document}")).toBe(true);
    expect(result.newSource).toContain("\\begin{axis}[ybar, ymin=0");
    const kept = applyEditAction(result.newSource, [], { kind: "insertPgfplotsTemplate", template: "bar" });
    if (kept.kind !== "success") throw new Error("insert failed");
    expect(kept.newSource.match(/usepackage\{pgfplots\}/gu)).toHaveLength(1);
  });
});
