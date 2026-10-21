import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { applyMatrix, inverseMatrix } from "../packages/core/src/semantic/transform.js";
import { worldTransform } from "../packages/core/src/coords/transforms.js";
import type { SceneElement } from "../packages/core/src/semantic/types.js";
import { expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

afterEach(() => vi.restoreAllMocks());

const shapes = [
  ["rectangle", "(0,0) rectangle (2,1)"],
  ["circle", "(1,.5) circle (.7cm)"],
  ["ellipse", "(1,.5) ellipse (.7cm and .4cm)"]
] as const;
const frames = [
  ["no parent", "", ""],
  ["scope shift", "", "xshift=1cm,yshift=-.3cm"],
  ["scope scale", "", "scale=2"],
  ["scope rotation", "", "rotate=15"],
  ["scope anisotropic scale", "", "xscale=2,yscale=.8"],
  ["scope shear", "", "cm={1,0,.3,1,(0,0)}"],
  ["ordered scope affine", "", "rotate=20,xscale=2,yscale=.8,xshift=.3cm"],
  ["picture shift", "xshift=1cm", ""],
  ["picture affine", "xscale=2,rotate=20,cm={1,.2,0,1,(.2,.1)}", ""]
] as const;

function snapshot(source: string, activeFigureId?: string) {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true, activeFigureId });
  const semantic = evaluator.evaluateTikzFigure(parsed.figure, source);
  const elementId = semantic.scene.elements.find(element => !element.adornment && element.kind !== "Text")!.sourceRef.sourceId;
  return { source, parsed, semantic, elementId };
}

function geometryValues(element: SceneElement): number[] {
  const transform = element.transform;
  const pointValues = (point: { x: number; y: number }) => {
    const transformed = transform ? applyMatrix(transform, wp(point.x, point.y)) : point;
    return [transformed.x, transformed.y];
  };
  if (element.kind === "Path") return element.commands.flatMap(command => {
    if (command.kind === "M" || command.kind === "L") return pointValues(command.to);
    if (command.kind === "C") return [...pointValues(command.c1), ...pointValues(command.c2), ...pointValues(command.to)];
    if (command.kind === "A") return [...pointValues(command.to), command.rx, command.ry, command.xAxisRotation];
    return [];
  });
  if (element.kind === "Circle") return [...pointValues(element.center), element.radius];
  if (element.kind === "Ellipse") return [...pointValues(element.center), element.rx, element.ry, element.rotation ?? 0];
  throw new Error("Expected path shape");
}

function expectSamePose(beforeSource: string, afterSource: string, activeFigureId?: string) {
  const before = snapshot(beforeSource, activeFigureId).semantic.scene.elements.filter(element => element.kind !== "Text");
  const after = snapshot(afterSource, activeFigureId).semantic.scene.elements.filter(element => element.kind !== "Text");
  expect(after.map(element => element.kind)).toEqual(before.map(element => element.kind));
  before.forEach((element, index) => {
    const values = geometryValues(element), actual = geometryValues(after[index]);
    expect(actual).toHaveLength(values.length);
    actual.forEach((value, i) => expect(Math.abs(value - values[i]), afterSource).toBeLessThan(.001));
  });
}

describe("center-pivot rotation in inherited coordinate frames", () => {
  for (const [shape, syntax] of shapes) {
    it.each(frames)(`${shape} retains fresh geometry at the same angle: %s`, (_name, picture, scope) => {
      const source = `\\begin{tikzpicture}[${picture}]\\begin{scope}[${scope}]\\draw[rotate=30] ${syntax};\\end{scope}\\end{tikzpicture}`;
      const baseline = snapshot(source);
      const result = applyEditAction(source, baseline.semantic.editHandles, {
        kind: "rotateElement", elementId: baseline.elementId, mode: "center-pivot", angleDeg: 30, baselineSource: source
      });
      if (shape === "circle" && baseline.semantic.scene.elements[0].kind === "Ellipse") {
        expect(result.kind).toBe("unsupported");
        return;
      }
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      expectSamePose(source, result.newSource);
      expectPatchesReconstructSource(source, result);
    });

    it.each([
      "draw=red", "xshift=1cm", "scale=2", "cm={1,0,.3,1,(0,0)}", "rotate=15", "xscale=2,yscale=.8"
    ])(`${shape} preserves named transforms on either side of authored rotation: %s`, style => {
      for (const options of ["styled,rotate=30", "rotate=30,styled"]) {
        const source = `\\begin{tikzpicture}\\tikzset{styled/.style={${style}}}\\draw[${options}] ${syntax};\\end{tikzpicture}`;
        const baseline = snapshot(source);
        const result = applyEditAction(source, baseline.semantic.editHandles, {
          kind: "rotateElement", elementId: baseline.elementId, mode: "center-pivot", angleDeg: 30, baselineSource: source
        });
        if (shape === "circle" && baseline.semantic.scene.elements[0].kind === "Ellipse") {
          expect(result.kind).toBe("unsupported");
          continue;
        }
        if (result.kind !== "success") throw new Error(JSON.stringify(result));
        expectSamePose(source, result.newSource);
        expectPatchesReconstructSource(source, result);
        expect(result.newSource).toContain(`styled/.style={${style}}`);
      }
    });
  }

  it("changes the authored local angle under nonuniform scale without adding compensating transforms", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=20]\begin{scope}[xscale=2,yscale=.8]\draw[rotate=30] (0,0) rectangle (2,1);\end{scope}\end{tikzpicture}`;
    const baseline = snapshot(source);
    const handles = baseline.semantic.editHandles.filter(handle => handle.sourceRef.sourceId === baseline.elementId);
    const geometry = createEditGeometrySession(baseline);
    const parent = geometry.parentFrame(baseline.elementId)!;
    const parentMatrix = worldTransform(parent.a, parent.b, parent.c, parent.d, parent.e, parent.f);
    const inverse = inverseMatrix(parentMatrix)!;
    const local = handles.map(handle => applyMatrix(inverse, handle.world));
    const pivot = wp((local[0].x + local[1].x) / 2, (local[0].y + local[1].y) / 2);
    const expected = local.map(point => {
      const x = point.x - pivot.x, y = point.y - pivot.y, angle = 35 * Math.PI / 180;
      return applyMatrix(parentMatrix, wp(pivot.x + x * Math.cos(angle) - y * Math.sin(angle),
        pivot.y + x * Math.sin(angle) + y * Math.cos(angle)));
    });
    const result = applyEditAction(source, [], { kind: "rotateElement", elementId: baseline.elementId,
      mode: "center-pivot", angleDeg: 65, baselineSource: source }, { geometry });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    const actual = snapshot(result.newSource).semantic.editHandles;
    actual.forEach((handle, i) => expect(Math.hypot(handle.world.x - expected[i].x, handle.world.y - expected[i].y)).toBeLessThan(.001));
    expect(result.newSource).toContain("rotate around={65:");
    expect(result.newSource).not.toContain("cm=");
  });

  it("reuses the immutable gesture frame through repeated angles and zero", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=2]\begin{scope}[rotate=15,cm={1,0,.3,1,(.2,.1)}]\draw[rotate=30] (0,0) rectangle (2,1);\end{scope}\draw (10,10) -- (11,11);\end{tikzpicture}`;
    const baseline = snapshot(source);
    const geometry = createEditGeometrySession(baseline);
    geometry.prepare(baseline.elementId);
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    const statementEvaluate = vi.spyOn(evaluator, "evaluateSemanticStatementByIndex");
    let current = source;
    for (const angleDeg of [65, 0, -15, 30]) {
      const action = { kind: "rotateElement" as const, elementId: baseline.elementId,
        mode: "center-pivot" as const, angleDeg, baselineSource: source };
      fullEvaluate.mockClear(); statementEvaluate.mockClear();
      const result = applyEditAction(current, [], action, { geometry });
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      expect(fullEvaluate).not.toHaveBeenCalled();
      expect(statementEvaluate).not.toHaveBeenCalled();
      const expected = applyEditAction(source, baseline.semantic.editHandles, action);
      if (expected.kind !== "success") throw new Error(JSON.stringify(expected));
      expect(result.newSource).toBe(expected.newSource);
      expectPatchesReconstructSource(current, result);
      current = result.newSource;
    }
    expectSamePose(source, current);
  });

  it("retains a nested named scope frame in the active figure", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate=30] (7,7) rectangle (9,8);\end{tikzpicture}
\begin{tikzpicture}[rotate=10]\tikzset{scaled/.style={xscale=2,rotate=20}}\begin{scope}[scaled]\begin{scope}[xshift=.5cm]\draw[rotate=30] (0,0) rectangle (2,1);\end{scope}\end{scope}\end{tikzpicture}`;
    const baseline = snapshot(source, "figure:1");
    const result = applyEditAction(source, baseline.semantic.editHandles, { kind: "rotateElement",
      elementId: baseline.elementId, mode: "center-pivot", angleDeg: 30, baselineSource: source }, { parseOptions: { activeFigureId: "figure:1" } });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain("(7,7) rectangle (9,8)");
    expectSamePose(source, result.newSource, "figure:1");
  });

  it.each(["xshift=1cm", "scale=2", "cm={1,0,.3,1,(0,0)}", "rotate=15,rotate=30", "rotate=15,rotate around={30:(1,.5)}"])("keeps unsupported path-transform boundaries: %s", options => {
    const source = `\\begin{tikzpicture}\\draw[${options}] (0,0) rectangle (2,1);\\end{tikzpicture}`;
    const result = applyEditAction(source, [], { kind: "rotateElement", elementId: "path:0", mode: "center-pivot", angleDeg: 30 });
    expect(result.kind).toBe("unsupported");
  });

  it("rejects a property target belonging to another shape", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate=30] (0,0) rectangle (2,1);\draw (3,3) rectangle (4,4);\end{tikzpicture}`;
    const result = applyEditAction(source, [], { kind: "rotateElement", elementId: "path:0", targetId: "path:1", mode: "center-pivot", angleDeg: 30 });
    expect(result.kind).toBe("unsupported");
  });

  it("preserves pose with fine Cartesian and polar coordinate spelling under a large parent scale", () => {
    const source = String.raw`\begin{tikzpicture}[scale=10]\draw[rotate=30.123456] (20:1.0001) rectangle (35:2.0001);\end{tikzpicture}`;
    const result = applyEditAction(source, [], { kind: "rotateElement", elementId: "path:0", mode: "center-pivot", angleDeg: 30.123456 });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expectSamePose(source, result.newSource);
    expect(result.newSource).toContain(":");
  });
});
