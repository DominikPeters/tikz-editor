import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEditAction, type EditActionResult } from "../packages/core/src/edit/actions.js";
import * as parser from "../packages/core/src/parser/index.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { applyMatrix } from "../packages/core/src/semantic/transform.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { planCenteredPivotMoves } from "../packages/core/src/edit/center-pivot-move.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/index.js";
import { planAlignDeltas, planDistributeDeltas } from "../packages/core/src/edit/arrange.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";
import type { WorldPoint } from "../packages/core/src/coords/points.js";

function evaluate(source: string) {
  const parsed = parser.parseTikz(source, { recover: true, includeContextDefinitions: true });
  return { source, parsed, semantic: evaluator.evaluateTikzFigure(parsed.figure, source) };
}
function success(result: EditActionResult) {
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  return result;
}
function geometryPoints(source: string): WorldPoint[][] {
  return evaluate(source).semantic.scene.elements.map(element => {
    if (element.kind === "Path") return element.commands.flatMap(command => command.kind === "M" || command.kind === "L" ? [command.to]
      : command.kind === "C" ? [command.c1, command.c2, command.to] : []).map(point => element.transform ? applyMatrix(element.transform, point) : point);
    if (element.kind === "Circle" || element.kind === "Ellipse") return [element.transform ? applyMatrix(element.transform, element.center) : element.center];
    return [];
  });
}
function expectTranslation(before: WorldPoint[], after: WorldPoint[], delta: WorldPoint, tolerance = .00015) {
  expect(after).toHaveLength(before.length);
  before.forEach((point, index) => {
    expect(Math.abs(after[index].x - point.x - delta.x)).toBeLessThan(tolerance);
    expect(Math.abs(after[index].y - point.y - delta.y)).toBeLessThan(tolerance);
  });
}
afterEach(() => vi.restoreAllMocks());

describe("element movement keeps centered pivots and coordinates in one new frame", () => {
  for (const shape of ["rectangle", "circle", "ellipse"] as const) {
    it.each([0, 30, 90, 180, -45])(`${shape} translates at angle %s and remains centered for the next edit`, angle => {
      const body = shape === "rectangle" ? "(0,0) rectangle (2,1)" : shape === "circle" ? "(1,.5) circle (.6cm)" : "(1,.5) ellipse (.8cm and .4cm)";
      const source = String.raw`\begin{tikzpicture}[xscale=2]\begin{scope}[rotate=30,yscale=3]\draw[rotate around={${angle}:(1,.5)}] ${body};\end{scope}\end{tikzpicture}`;
      const snapshot = evaluate(source), id = snapshot.semantic.editHandles[0].sourceRef.sourceId, delta = wp(10, -6);
      const before = geometryPoints(source)[0];
      const result = success(applyEditAction(source, snapshot.semantic.editHandles, { kind: "moveElement", elementId: id, delta }));
      expectPatchesReconstructSource(source, result);
      expectTranslation(before, geometryPoints(result.newSource)[0], delta);
      const fresh = evaluate(result.newSource);
      const plan = planCenteredPivotMoves(result.newSource, fresh.semantic.editHandles, new Map([[id, wp(1, 1)]]));
      expect(plan.kind).toBe("success");
      if (plan.kind === "success") expect(plan.framesBySource.has(id)).toBe(true);
      const noAngleChange = applyEditAction(result.newSource, fresh.semantic.editHandles,
        { kind: "rotateElement", elementId: id, mode: "center-pivot", angleDeg: angle, baselineSource: result.newSource });
      if (noAngleChange.kind === "success") expectTranslation(geometryPoints(result.newSource)[0], geometryPoints(noAngleChange.newSource)[0], wp(0, 0));
      else expect(noAngleChange).toMatchObject({ kind: "unsupported", reason: shape === "circle"
        ? "Center-pivot rotate requires explicit circle/ellipse source syntax." : "rotateElement would not change the source." });
      const beforeBounds = [...collectSourceWorldBounds(snapshot.semantic.scene.elements).values()][0];
      const afterBounds = [...collectSourceWorldBounds(fresh.semantic.scene.elements).values()][0];
      expect(afterBounds.maxX - afterBounds.minX).toBeCloseTo(beforeBounds.maxX - beforeBounds.minX, 3);
      expect(afterBounds.maxY - afterBounds.minY).toBeCloseTo(beforeBounds.maxY - beforeBounds.minY, 3);
    });
  }

  it("keeps a moved circle centered during a subsequent changed-angle gesture in a uniform parent frame", () => {
    const source = String.raw`\begin{tikzpicture}[scale=2]\begin{scope}[rotate=30]\draw[rotate around={30:(1,.5)}] (1,.5) circle (.6cm);\end{scope}\end{tikzpicture}`;
    const snapshot = evaluate(source), id = snapshot.semantic.editHandles[0].sourceRef.sourceId;
    const moved = success(applyEditAction(source, snapshot.semantic.editHandles, { kind: "moveElement", elementId: id, delta: wp(10, -6) }));
    const fresh = evaluate(moved.newSource);
    const rotated = success(applyEditAction(moved.newSource, fresh.semantic.editHandles,
      { kind: "rotateElement", elementId: id, mode: "center-pivot", angleDeg: 65, baselineSource: moved.newSource }));
    expectTranslation(geometryPoints(moved.newSource)[0], geometryPoints(rotated.newSource)[0], wp(0, 0));
  });

  it("preserves external pivots and unrelated authored option order", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[rotate=30,xscale=2]\draw[draw=blue,rotate=15,rotate around={90:(-2,-1)},xshift=3pt] (0,0) rectangle (2,1);\end{scope}\end{tikzpicture}`;
    const snapshot = evaluate(source), id = snapshot.semantic.editHandles[0].sourceRef.sourceId, delta = wp(cm(1), 0);
    const result = success(applyEditAction(source, snapshot.semantic.editHandles, { kind: "moveElement", elementId: id, delta }));
    expect(result.newSource).toContain("[draw=blue,rotate=15,rotate around={90:(-2,-1)},xshift=3pt]");
    expectTranslation(geometryPoints(source)[0], geometryPoints(result.newSource)[0], delta, .45);
  });

  it.each(["alignElements", "distributeElements"] as const)("uses each planned delta for %s", kind => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[rotate=30,xscale=2]\draw[rotate around={30:(1,.5)}] (0,0) rectangle (2,1);\draw[rotate around={90:(4,.5)}] (3,0) rectangle (5,1);\draw[rotate around={-45:(11,.5)}] (10,0) rectangle (12,1);\end{scope}\end{tikzpicture}`;
    const snapshot = evaluate(source), ids = [...new Set(snapshot.semantic.editHandles.map(handle => handle.sourceRef.sourceId))];
    const bounds = collectSourceWorldBounds(snapshot.semantic.scene.elements);
    const plan = kind === "alignElements" ? planAlignDeltas(bounds, ids, "bottom") : planDistributeDeltas(bounds, ids, "horizontal");
    if (plan.kind !== "success") throw new Error(JSON.stringify(plan));
    const action = kind === "alignElements" ? { kind, elementIds: ids, mode: "bottom" as const } : { kind, elementIds: ids, axis: "horizontal" as const };
    const result = success(applyEditAction(source, snapshot.semantic.editHandles, action));
    expectPatchesReconstructSource(source, result);
    const before = geometryPoints(source), after = geometryPoints(result.newSource);
    before.forEach((points, index) => expectTranslation(points, after[index], plan.deltas.get(ids[index])!));
  });

  it("moves multiple centered shapes through immutable frames without reparsing or reevaluating the paper", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=2]\begin{scope}[rotate=30]\draw[rotate around={90:(1,.5)}] (0,0) rectangle (2,1);\draw[rotate around={30:(4,.5)}] (4,.5) ellipse (.8cm and .4cm);\end{scope}\draw (10,10)--++(1,0);\end{tikzpicture}`;
    const snapshot = evaluate(source), ids = [...new Set(snapshot.semantic.editHandles.map(handle => handle.sourceRef.sourceId))].slice(0, 2);
    const geometry = createEditGeometrySession(snapshot);
    ids.forEach(id => geometry.prepare(id));
    const full = vi.spyOn(evaluator, "evaluateTikzFigure"), parse = vi.spyOn(parser, "parseTikz");
    let current = source;
    for (const delta of [wp(10, -6), wp(16, 3), wp(-8, 2), wp(0, 0)]) {
      full.mockClear(); parse.mockClear();
      const result = success(applyEditAction(current, [], { kind: "moveElements", elementIds: ids, delta,
        baseline: { source, editHandles: snapshot.semantic.editHandles } }, { geometry }));
      expect(full).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expectPatchesReconstructSource(current, result);
      current = result.newSource;
      const before = geometryPoints(source), after = geometryPoints(current);
      expectTranslation(before[0], after[0], delta);
      expectTranslation(before[1], after[1], delta);
      expectTranslation(before[2], after[2], wp(0, 0));
    }
    expect(current).toBe(source);
  });

  it("refuses a singular centered transform atomically", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate around={30:(0,0)},xscale=0] (-1,-1) rectangle (1,1);\end{tikzpicture}`;
    const snapshot = evaluate(source);
    expect(applyEditAction(source, snapshot.semantic.editHandles, { kind: "moveElement", elementId: "path:0", delta: wp(10, 0) }).kind).toBe("unsupported");
  });
});
