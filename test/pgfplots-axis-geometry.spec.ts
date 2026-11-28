// The edit geometry of a pgfplots axis does not depend on what the axis
// paints: it rides on a carrier element that paints nothing (ScenePath
// `editCarrier`), so axes with `hide axis`, no axis lines, invisible lines,
// no content or a clipped box still move and resize, also under a scope
// transformation. Each case: source before -> action -> source after ->
// re-evaluated geometry (the edit box and the painted plot line).
import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { readAxisEditInfo } from "../packages/core/src/edit/pgfplots/axis-actions.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import type { PgfplotsAxisEditInfo, ScenePath } from "../packages/core/src/semantic/types.js";

const PREAMBLE = "\\pgfplotsset{compat=1.18}\n";
const picture = (body: string) => `${PREAMBLE}\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

function evaluate(source: string) {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  return evaluateTikzFigure(parsed.figure, source);
}

function axisId(source: string): string {
  const match = /axis:\d+/u.exec(JSON.stringify(parseTikz(source, { includeContextDefinitions: true }).figure.body.flatMap(function ids(s: { id: string; body?: unknown[] }): string[] {
    return [s.id, ...((s.body ?? []) as Array<{ id: string; body?: unknown[] }>).flatMap(ids)];
  })));
  if (!match) throw new Error("no axis");
  return match[0];
}

function info(source: string, id: string): PgfplotsAxisEditInfo {
  const found = readAxisEditInfo(evaluate(source).scene.elements, id);
  if (!found) throw new Error("no axis edit geometry");
  return found;
}

const world = (i: PgfplotsAxisEditInfo, x: number, y: number) => ({ x: i.frame.a * x + i.frame.c * y + i.frame.e, y: i.frame.b * x + i.frame.d * y + i.frame.f });
function worldBox(i: PgfplotsAxisEditInfo) {
  const sw = world(i, i.box.x0, i.box.y0); const ne = world(i, i.box.x1, i.box.y1);
  return { minX: Math.min(sw.x, ne.x), minY: Math.min(sw.y, ne.y), maxX: Math.max(sw.x, ne.x), maxY: Math.max(sw.y, ne.y) };
}
function worldBBox(i: PgfplotsAxisEditInfo) {
  const a = world(i, i.bbox.minX, i.bbox.minY); const b = world(i, i.bbox.maxX, i.bbox.maxY);
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

/** First point of the painted plot line, in world coordinates (element transform applied). */
function plotStart(source: string, id: string) {
  const line = evaluate(source).scene.elements.find((e): e is ScenePath => e.kind === "Path" && e.id === `scene-path:${id}:plot:0:line`);
  const first = line?.commands[0];
  if (!line || !first || first.kind === "Z") throw new Error("no plot line");
  const t = line.transform;
  const p = first.to;
  return t ? { x: t.a * p.x + t.c * p.y + t.e, y: t.b * p.x + t.d * p.y + t.f } : { x: p.x, y: p.y };
}

function apply(source: string, action: Record<string, unknown>): string {
  const result = applyEditAction(source, evaluate(source).editHandles, action as unknown as EditAction);
  if (result.kind !== "success" && result.kind !== "partial") throw new Error(`edit failed: ${result.kind === "error" ? result.message : result.reason}`);
  return result.newSource;
}

const PLOT = "\\addplot coordinates {(0,0) (1,1)};";
const CASES: Array<{ name: string; body: (options: string) => string; at: string }> = [
  { name: "hide axis", body: (o) => `\\begin{axis}[hide axis${o}]\n${PLOT}\n\\end{axis}`, at: "hide axis" },
  { name: "hide x axis and hide y axis", body: (o) => `\\begin{axis}[hide x axis, hide y axis${o}]\n${PLOT}\n\\end{axis}`, at: "hide y axis" },
  { name: "axis lines=none", body: (o) => `\\begin{axis}[axis lines=none${o}]\n${PLOT}\n\\end{axis}`, at: "axis lines=none" },
  { name: "ticks=none, axis line style={draw=none}", body: (o) => `\\begin{axis}[ticks=none, axis line style={draw=none}${o}]\n${PLOT}\n\\end{axis}`, at: "axis line style={draw=none}" },
  { name: "empty axis", body: (o) => `\\begin{axis}[xmin=0, xmax=1, ymin=0, ymax=1${o}]\n\\end{axis}`, at: "ymax=1" },
  { name: "first path clipped away", body: (o) => `\\clip (-50,-50) rectangle (-40,-40);\n\\begin{axis}[xmin=0${o}]\n${PLOT}\n\\end{axis}`, at: "xmin=0" },
  { name: "scope with a transformation", body: (o) => `\\begin{scope}[shift={(1cm,2cm)}, scale=1.5]\n\\begin{axis}[hide axis${o}]\n${PLOT}\n\\end{axis}\n\\end{scope}`, at: "hide axis" },
  { name: "scope with a transformation, box drawn", body: (o) => `\\begin{scope}[shift={(1cm,2cm)}, scale=1.5]\n\\begin{axis}[xmin=0${o}]\n${PLOT}\n\\end{axis}\n\\end{scope}`, at: "xmin=0" }
];

describe("pgfplots axis edit geometry does not depend on painted decorations", () => {
  for (const { name, body, at } of CASES) {
    describe(name, () => {
      const source = picture(body(""));
      it("has edit geometry, and the carrier paints nothing", () => {
        const id = axisId(source);
        const scene = evaluate(source).scene;
        const carriers = scene.elements.filter((e): e is ScenePath => e.kind === "Path" && e.pgfplotsAxis?.axisId === id);
        expect(carriers).toHaveLength(1);
        expect(carriers[0]?.editCarrier).toBe(true);
        expect(carriers[0]?.commands).toEqual([]);
        expect(renderTikzToSvg(source).svg).not.toContain(carriers[0]?.id ?? "--");
      });

      it("moves: writes at= and the box and the plot move by the delta", () => {
        const id = axisId(source);
        const before = info(source, id);
        const delta = { x: 28.452755, y: -14.226378 };
        const after = apply(source, { kind: "moveElements", elementIds: [id], delta });
        expect(after).toBe(source.replace(at, `${at}, at={(${name.startsWith("scope with a transformation") ? "0.67cm,-0.33cm" : "1cm,-0.5cm"})}`));
        const box0 = worldBox(before); const box1 = worldBox(info(after, id));
        // `at` is written to the drag write tolerance (0.01cm; under the scope's scale=1.5, 0.15pt).
        const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.2);
        near(box1.minX - box0.minX, delta.x);
        near(box1.minY - box0.minY, delta.y);
        if (name !== "empty axis") {
          const p0 = plotStart(source, id); const p1 = plotStart(after, id);
          near(p1.x - p0.x, delta.x);
          near(p1.y - p0.y, delta.y);
        }
      });

      it("resizes: dragging the right edge writes width and the edge lands under the pointer", () => {
        const id = axisId(source);
        const before = info(source, id);
        const reference = worldBBox(before);
        const after = apply(source, { kind: "resizeElement", elementId: id, role: "right", newWorld: { x: reference.maxX + 28.452756, y: (reference.minY + reference.maxY) / 2 }, referenceBounds: reference });
        expect(after).toMatch(/width=[\d.]+cm, height=[\d.]+cm/u);
        const box0 = worldBox(before); const box1 = worldBox(info(after, id));
        // The width is written to the drag write tolerance (shortest decimal in cm): a few tenths of a point.
        expect(Math.abs(box1.maxX - box0.maxX - 28.452756)).toBeLessThan(0.3);
        expect(box1.minX).toBeCloseTo(box0.minX, 3);
        expect(Math.abs((box1.maxY - box1.minY) - (box0.maxY - box0.minY))).toBeLessThan(0.3);
      });
    });
  }

  it("warm (incremental) and cold evaluations carry the same edit geometry", () => {
    const source = picture(CASES[0]?.body("") ?? "");
    const id = axisId(source);
    const cold = info(source, id);
    const warm = info(source, id);
    expect(warm).toEqual(cold);
  });
});
