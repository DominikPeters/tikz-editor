import { describe, expect, it } from "vitest";
import { worldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { appendArcCommand } from "../../packages/core/src/semantic/path/arc.js";
import {
  approximatePlacementSegmentLength,
  closestPointOnPlacementSegment,
  pointAtPlacementSegment,
  tangentAtPlacementSegment
} from "../../packages/core/src/semantic/path/path-attached.js";
import { evaluateSemantic, firstElementOfKind } from "./helpers.js";

const cm = 28.4527559055;
const p = (x: number, y: number) => worldPoint(pt(x), pt(y));

describe("arc placement frames", () => {
  it.each([
    { options: "xscale=2", x: 2, y: 1, dx: -2, dy: 1 },
    { options: "rotate=90", x: -1, y: 1, dx: -1, dy: -1 },
    { options: "scale=2", x: 2, y: 2, dx: -2, dy: 2 },
    { options: "xscale=-1", x: -1, y: 1, dx: 1, dy: 1 },
    { options: "cm={1,0,.5,1,(0,0)}", x: 1.5, y: 1, dx: -.5, dy: 1 }
  ])("places a sloped midpoint with $options", ({ options, x, y, dx, dy }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${options}]
      \draw (1,0) arc(0:90:1) node[pos=.5,sloped,anchor=center] {x};
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    expect(node?.position.x).toBeCloseTo(x * Math.SQRT1_2 * cm, 4);
    expect(node?.position.y).toBeCloseTo(y * Math.SQRT1_2 * cm, 4);
    const segment = node?.pathAttachment?.segment;
    if (!segment) throw new Error("Missing arc attachment");
    const tangent = tangentAtPlacementSegment(segment, .5);
    expect(Math.atan2(tangent.y, tangent.x)).toBeCloseTo(Math.atan2(dy, dx), 5);
  });

  it.each([
    { outer: "xscale=2", pos: .25, angle: -67.5, local: "" },
    { outer: "xscale=2", pos: .75, angle: -22.5, local: "" },
    { outer: "rotate=90", pos: .25, angle: -67.5, local: "" },
    { outer: "rotate=90", pos: .75, angle: -22.5, local: "" },
    { outer: "", pos: .25, angle: 112.5, local: "allow upside down" },
    { outer: "", pos: .75, angle: 172.5, local: "allow upside down,rotate=15" }
  ])("rotates the actual arc node at $pos in $outer with $local", ({ outer, pos, angle, local }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${outer}]
      \draw (1,0) arc(0:90:1) node[pos=${pos},sloped,anchor=center,${local}] {x};
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    if (!node?.transform) throw new Error("Missing sloped node transform");
    const radians = angle * Math.PI / 180;
    expect(node.transform.a).toBeCloseTo(Math.cos(radians), 6);
    expect(node.transform.b).toBeCloseTo(Math.sin(radians), 6);
    expect(node.transform.c).toBeCloseTo(-Math.sin(radians), 6);
    expect(node.transform.d).toBeCloseTo(Math.cos(radians), 6);
  });

  it.each([
    { inherited: "pos=.25", pos: .25, angle: -67.5 },
    { inherited: "near end", pos: .75, angle: -22.5 }
  ])("uses inherited $inherited for arc position and glyph slope", ({ inherited, pos, angle }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[xscale=2,every node/.style={${inherited}}]
      \draw (1,0) arc(0:90:1) node[sloped,anchor=center] {x};
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    expect(node?.position.x).toBeCloseTo(2 * cm * Math.cos(pos * Math.PI / 2), 4);
    expect(node?.position.y).toBeCloseTo(cm * Math.sin(pos * Math.PI / 2), 4);
    if (!node?.transform) throw new Error("Missing inherited sloped node transform");
    expect(Math.atan2(node.transform.b, node.transform.a) * 180 / Math.PI).toBeCloseTo(angle, 6);
  });

  it("retains the ancestor CTM around the local arc slope with transform shape", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[xscale=2,transform shape]
      \draw (1,0) arc(0:90:1) node[pos=.25,sloped,anchor=center] {x};
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    if (!node?.transform) throw new Error("Missing transformed sloped node");
    const radians = -67.5 * Math.PI / 180;
    expect(node.transform.a).toBeCloseTo(2 * Math.cos(radians), 6);
    expect(node.transform.b).toBeCloseTo(Math.sin(radians), 6);
    expect(node.transform.c).toBeCloseTo(-2 * Math.sin(radians), 6);
    expect(node.transform.d).toBeCloseTo(Math.cos(radians), 6);
  });

  it.each([
    { outer: "rotate=90", dx: 1, dy: -1 },
    { outer: "xscale=-1", dx: -1, dy: 1 }
  ])("keeps auto labels on the world-space left side with $outer", ({ outer, dx, dy }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${outer}]
      \draw (1,0) arc(0:90:1) node[pos=.25,auto] {x};
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    const segment = node?.pathAttachment?.segment;
    if (!node || !segment) throw new Error("Missing auto arc node");
    const target = pointAtPlacementSegment(segment, .25);
    expect((node.position.x - target.x) * dx).toBeGreaterThan(0);
    expect((node.position.y - target.y) * dy).toBeGreaterThan(0);
  });

  it("uses the same reflected affine axes for sampling, length, and drag projection", () => {
    const { segment, endpoint } = appendArcCommand([], p(23, 4),
      { startAngle: 0, endAngle: 90, rx: 10, ry: 5 },
      { a: 2, b: 1, c: .5, d: -3 });
    const midpoint = pointAtPlacementSegment(segment, .5);
    expect(midpoint.x).toBeCloseTo(3 + 22.5 * Math.SQRT1_2, 6);
    expect(midpoint.y).toBeCloseTo(-6 - 5 * Math.SQRT1_2, 6);
    const tangent = tangentAtPlacementSegment(segment, .5);
    expect(tangent.x).toBeCloseTo(-17.5 * Math.SQRT1_2, 6);
    expect(tangent.y).toBeCloseTo(-25 * Math.SQRT1_2, 6);
    expect(pointAtPlacementSegment(segment, 0)).toEqual(p(23, 4));
    expect(pointAtPlacementSegment(segment, 1)).toEqual(endpoint);
    // Preserve the average-axis-radius approximation, measured in world space.
    expect(approximatePlacementSegmentLength(segment)).toBeCloseTo(
      Math.PI / 4 * (Math.hypot(20, 10) + Math.hypot(2.5, -15)), 6);
    for (const t of [.3, -.4, 1.4]) {
      const target = pointAtPlacementSegment(segment, t);
      const closest = closestPointOnPlacementSegment(segment, target, { extrapolate: true, referenceT: t });
      expect(closest.t).toBeCloseTo(t, 6);
      expect(closest.point.x).toBeCloseTo(target.x, 6);
      expect(closest.point.y).toBeCloseTo(target.y, 6);
    }
    expect(closestPointOnPlacementSegment(segment, pointAtPlacementSegment(segment, .3)).t).toBeCloseTo(.3, 6);
  });

  it.each([
    { a: 0, b: 0, c: 0, d: 2 },
    { a: 0, b: 0, c: 0, d: 0 }
  ])("keeps collapsed arc helpers finite for %j", (transform) => {
    const { segment } = appendArcCommand([], p(3, 4),
      { startAngle: 0, endAngle: 90, rx: 10, ry: 5 }, transform);
    const point = pointAtPlacementSegment(segment, .5);
    const tangent = tangentAtPlacementSegment(segment, .5);
    const closest = closestPointOnPlacementSegment(segment, p(9, 12));
    expect([point.x, point.y, tangent.x, tangent.y, closest.t, closest.point.x, closest.point.y,
      approximatePlacementSegmentLength(segment)].every(Number.isFinite)).toBe(true);
  });
});

describe("named transformation origins", () => {
  it.each([
    { option: "shift={(A)}", outer: "scale=2", x: 2, y: 0 },
    { option: "cm={1,0,0,1,(A)}", outer: "scale=2", x: 2, y: 0 },
    { option: "rotate around={90:(A)}", outer: "scale=2", x: 2, y: -2 },
    { option: "shift={(A)}", outer: "scale=2,xshift=1cm,yshift=.5cm", x: 4, y: 1 },
    { option: "cm={1,0,0,1,(A)}", outer: "scale=2,xshift=1cm,yshift=.5cm", x: 4, y: 1 },
    { option: "rotate around={90:(A)}", outer: "scale=2,xshift=1cm,yshift=.5cm", x: 4, y: -1 },
    { option: "rotate=90,shift={(A)}", outer: "scale=2,xshift=1cm,yshift=.5cm", x: 4, y: 1 }
  ])("resolves $option in the current $outer frame", ({ option, outer, x, y }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${outer}]
      \coordinate (A) at (1,0);
      \begin{scope}[${option}]\node[anchor=center] at (0,0) {x};\end{scope}
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    expect(node?.position.x).toBeCloseTo(x * cm, 4);
    expect(node?.position.y).toBeCloseTo(y * cm, 4);
  });

  it.each([
    { option: "shift={(1,0)}", x: 2, y: 0 },
    { option: "cm={1,0,0,1,(1,0)}", x: 2, y: 0 },
    { option: "rotate around={90:(1,0)}", x: 2, y: -2 }
  ])("keeps $option numeric coordinates local", ({ option, x, y }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[scale=2]
      \begin{scope}[${option}]\node[anchor=center] at (0,0) {x};\end{scope}
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    expect(node?.position.x).toBeCloseTo(x * cm, 4);
    expect(node?.position.y).toBeCloseTo(y * cm, 4);
  });

  it.each([
    { option: "shift={(0:1cm)}", x: 0, y: 1 },
    { option: "cm={1,0,0,1,(0:1cm)}", x: 0, y: 1 },
    { option: "rotate around={90:(0:1cm)}", x: 1, y: 1 }
  ])("preserves numeric polar $option after an earlier rotation", ({ option, x, y }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
      \begin{scope}[rotate=90,${option}]\node[anchor=center] at (0,0) {x};\end{scope}
      \end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const node = firstElementOfKind(result.scene.elements, "Text");
    expect(node?.position.x).toBeCloseTo(x * cm, 4);
    expect(node?.position.y).toBeCloseTo(y * cm, 4);
  });
});
