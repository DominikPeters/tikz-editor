import { describe, expect, it } from "vitest";
import { worldPoint } from "../packages/core/src/coords/points.js";
import { pt } from "../packages/core/src/coords/scalars.js";
import { worldToSvgTransform } from "../packages/core/src/coords/transforms.js";
import { computeSvgPathBounds, transformSvgBounds } from "../packages/core/src/svg/geometry.js";
import { emitSvg } from "../packages/core/src/svg/emit.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import type { ScenePathCommand } from "../packages/core/src/semantic/types.js";

const point = (x: number, y: number) => worldPoint(pt(x), pt(y));
const origin = point(0, 0);
const closed: ScenePathCommand[] = [
  { kind: "M", to: origin }, { kind: "L", to: point(100, 0) },
  { kind: "L", to: point(100, 100) }, { kind: "Z" }
];
const cubic: ScenePathCommand = { kind: "C", c1: point(-100, -100), c2: point(-100, 0), to: origin };
const arc: ScenePathCommand = { kind: "A", rx: 10, ry: 5, xAxisRotation: 0, largeArc: false, sweep: false, to: point(-20, 0) };
const viewBox = { y: 0, height: 0 };

describe("SVG path bounds after closepath", () => {
  it("starts a following cubic at the last moveto and includes its analytic extrema", () => {
    const bounds = computeSvgPathBounds([...closed, cubic], viewBox)!;
    expect(bounds.minX).toBeCloseTo(-75, 9);
    expect(bounds.maxY).toBeCloseTo(400 / 9, 9);
    expect(bounds.maxX).toBe(100);
    expect(bounds.minY).toBe(-100);
  });

  it("starts a following elliptical arc at the closed subpath origin", () => {
    const bounds = computeSvgPathBounds([...closed, arc], viewBox)!;
    expect(bounds.minX).toBeCloseTo(-20, 9);
    expect(bounds.maxY).toBeCloseTo(5, 9);
    expect(bounds.maxX).toBe(100);
    expect(bounds.minY).toBe(-100);
  });

  it.each([
    ["cubic", cubic], ["arc", arc],
    ["rotated arc", { ...arc, xAxisRotation: 37, largeArc: true, sweep: true }],
    ["degenerate arc", { ...arc, rx: 0 }], ["line", { kind: "L", to: point(-20, -20) }]
  ] satisfies Array<[string, ScenePathCommand]>)("matches an explicit move reset before a following %s", (_label, following) => {
    for (const box of [viewBox, { y: 17, height: 203 }]) {
      const implicit = computeSvgPathBounds([...closed, following], box);
      const explicit = computeSvgPathBounds([...closed, { kind: "M", to: origin }, following], box);
      expect(implicit).toEqual(explicit);
    }
  });

  it("updates the closepath origin for each new subpath", () => {
    const nextOrigin = point(-200, 10);
    const following: ScenePathCommand = { kind: "C", c1: point(-300, -90), c2: point(-300, 10), to: nextOrigin };
    const prefix: ScenePathCommand[] = [...closed, { kind: "M", to: nextOrigin }, { kind: "L", to: point(-100, 110) }, { kind: "Z" }];
    expect(computeSvgPathBounds([...prefix, following], viewBox)?.minX).toBeCloseTo(-275, 9);
    expect(computeSvgPathBounds([...prefix, following], viewBox)).toEqual(
      computeSvgPathBounds([...prefix, { kind: "M", to: nextOrigin }, following], viewBox)
    );
  });

  it("keeps the origin through repeated closes and later drawable commands", () => {
    expect(computeSvgPathBounds([...closed, { kind: "Z" }, cubic, { kind: "Z" }, arc], viewBox)).toEqual(
      computeSvgPathBounds([...closed, { kind: "M", to: origin }, cubic, { kind: "M", to: origin }, arc], viewBox)
    );
  });

  it("keeps corrected bounds under an affine element transform and shifted viewBox", () => {
    const box = { y: 17, height: 203 };
    const transform = worldToSvgTransform(1.2, .3, -.7, -.9, 15, 22);
    const implicit = computeSvgPathBounds([...closed, cubic, { kind: "Z" }, arc], box)!;
    const explicit = computeSvgPathBounds([...closed, { kind: "M", to: origin }, cubic, { kind: "M", to: origin }, arc], box)!;
    expect(transformSvgBounds(implicit, transform)).toEqual(transformSvgBounds(explicit, transform));
  });

  it("preserves empty and move-only controls without inventing a closepath origin", () => {
    expect(computeSvgPathBounds([], viewBox)).toBeNull();
    expect(computeSvgPathBounds([{ kind: "Z" }], viewBox)).toBeNull();
    expect(computeSvgPathBounds([{ kind: "M", to: point(3, 7) }, { kind: "Z" }], viewBox)).toEqual({ minX: 3, maxX: 3, minY: -7, maxY: -7 });
  });

  it("uses the corrected direct ScenePath bounds to position its SVG shading", () => {
    const result = renderTikzToSvg(String.raw`\begin{tikzpicture}\shade[top color=red,bottom color=blue] (0,0) rectangle (1,1);\end{tikzpicture}`);
    const path = result.semantic.scene.elements.find(element => element.kind === "Path");
    if (path?.kind !== "Path") throw new Error("Expected shaded path");
    const scene = result.semantic.scene;
    const emit = (commands: ScenePathCommand[]) => emitSvg({ ...scene, elements: [{ ...path, commands }] }, { viewBox: { x: -100, y: 0, width: 200, height: 200 } });
    const implicit = emit([...closed, cubic]);
    const explicit = emit([...closed, { kind: "M", to: origin }, cubic]);
    const gradient = (svg: string) => svg.match(/<linearGradient[^>]*gradientTransform="([^"]+)"/)?.[1];
    expect(gradient(implicit.svg)).toBeDefined();
    expect(gradient(implicit.svg)).toEqual(gradient(explicit.svg));
    expect(gradient(implicit.svg)).toMatch(/^translate\(12\.5 /);
  });
});
