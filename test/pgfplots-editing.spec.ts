// Editing pgfplots axes (design/pgfplots.md section 8, Phase 6): every action
// is checked as source before -> action -> exact source after -> re-evaluated
// geometry.
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { readAxisEditInfo } from "../packages/core/src/edit/pgfplots/axis-actions.js";
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

function apply(source: string, action: EditAction): string {
  const result = applyEditAction(source, evaluate(source).editHandles, action);
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
