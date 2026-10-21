import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { isFrameLocalCoordinateEditHandle } from "../packages/core/src/semantic/types.js";
import * as editParser from "../packages/core/src/edit/parse-options.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type ResizeRole } from "../packages/core/src/edit/actions.js";
import { preparePathRectangleResize, projectPathRectangleResize } from "../packages/core/src/edit/actions/resize-element.js";
import { buildSnapContext, pointerSnapLines, snapHandlePosition } from "../packages/core/src/edit/snapping/index.js";
import { applyFrameTransform, frameLocalPoint, pt, worldVector } from "../packages/core/src/coords/index.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

function prepare(body: string) {
  const source = `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
  const parsed = parseTikz(source);
  const semantic = evaluator.evaluateTikzFigure(parsed.figure, source);
  const elementId = semantic.scene.elements[0].sourceRef.sourceId;
  const baseline = preparePathRectangleResize(source, parsed.figure.body, semantic.scene.elements, semantic.editHandles, elementId)!;
  expect(baseline).not.toBeNull();
  return { source, semantic, elementId, baseline };
}

afterEach(() => vi.restoreAllMocks());

describe("rectangle resize drag sessions", () => {
  it("rewrites from the baseline without parsing/evaluating on each move and restores original spelling", () => {
    const { source: original, baseline, elementId } = prepare(String.raw`\draw (3.000,2.000) rectangle (5.000,1.000);`);
    const evaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    const parse = vi.spyOn(editParser, "parseTikzForEdit");
    let source = original;
    // Cross the fixed corner, change coordinate lengths, then return home.
    for (const [x, y] of [[12.346, 4.567], [2, 0], [5, 2]]) {
      const result = applyEditAction(source, [], {
        kind: "resizeElement", elementId, rectangleBaseline: baseline,
        role: "top-right", newWorld: wp(cm(x), cm(y))
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") throw new Error(result.kind);
      expectPatchesReconstructSource(source, result);
      expect(result.changedSourceIds).toEqual([elementId]);
      source = result.newSource;
    }
    expect(source).toBe(original);
    expect(evaluate).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([
    String.raw`\draw (3,2) rectangle (5,1);`,
    String.raw`\draw (3,2) rectangle ++(2,-1);`,
    String.raw`\draw[rotate=30,xscale=2,yscale=0.5] (3,2) rectangle (5,1);`,
    String.raw`\draw[xslant=0.3] (3,2) rectangle (5,1);`
  ])("preserves normal resize semantics with prepared geometry: %s", (body) => {
    const { source, baseline, elementId, semantic } = prepare(body);
    for (const role of ["top-right", "bottom-left", "left", "top"] as ResizeRole[]) {
      for (const preserveAspect of [true, false]) {
        const action = { kind: "resizeElement" as const, elementId, role, newWorld: wp(cm(6), cm(4)), preserveAspect };
        const ordinary = applyEditAction(source, semantic.editHandles, action);
        const prepared = applyEditAction(source, [], { ...action, rectangleBaseline: baseline });
        expect(prepared).toEqual(ordinary);
      }
    }
  });

  it("snaps an aspect-locked corner along its diagonal in a nonuniform transformed frame", () => {
    const { baseline, elementId } = prepare(String.raw`\draw[rotate=30,xscale=2,yscale=0.5] (3,2) rectangle (5,1);`);
    const handle = baseline.context.startHandle;
    if (!isFrameLocalCoordinateEditHandle(handle)) throw new Error("Expected local rectangle coordinate");
    const transform = handle.frame;
    const point = applyFrameTransform(transform, frameLocalPoint(pt(cm(6.9)), pt(cm(2.95))));
    const action = { elementId, role: "top-right" as const, newWorld: point, preserveAspect: true };
    const projected = projectPathRectangleResize(action, baseline.context)!;
    const target = applyFrameTransform(transform, frameLocalPoint(pt(cm(7)), pt(cm(3))));
    const context = buildSnapContext({ sceneElements: [], selectedSourceIds: [], zoom: 1,
      guides: { y: [target.y] }, settings: { grid: { enabled: false } } });
    const snap = snapHandlePosition({ context, point: projected.point, direction: projected.direction });
    expect(snap.snappedPoint!.x).toBeCloseTo(target.x, 5);
    expect(snap.snappedPoint!.y).toBeCloseTo(target.y, 5);
    const final = projectPathRectangleResize({ ...action, newWorld: snap.snappedPoint! }, baseline.context)!;
    expect(final.point.x).toBeCloseTo(target.x, 5);
    expect(final.point.y).toBeCloseTo(target.y, 5);
  });

  it("ignores stationary edge coordinates and unreachable targets", () => {
    const context = buildSnapContext({ sceneElements: [], selectedSourceIds: [], zoom: 1,
      guides: { x: [100], y: [50] }, settings: { grid: { enabled: false } } });
    const snap = snapHandlePosition({ context, point: wp(97, 50), direction: worldVector(pt(1), pt(0)) });
    expect(snap.snappedPoint).toEqual(wp(100, 50));
    expect(snap.targets!.y).toEqual([]);
    expect(snap.lines.every(line => line.type !== "gap" && line.axis === "x")).toBe(true);
    const unreachable = snapHandlePosition({ context, point: wp(97, 30), direction: worldVector(pt(0.01), pt(1)) });
    expect(unreachable.snappedPoint).toEqual(wp(97, 30));
    expect(unreachable.lines).toEqual([]);
  });

  it("drops guides when coordinate rounding misses the retained target and supports bypass", () => {
    const context = buildSnapContext({ sceneElements: [], selectedSourceIds: [], zoom: 1,
      guides: { x: [cm(1.234), cm(1.23)] }, settings: { grid: { enabled: false } } });
    context.referencePoints = [
      { ...wp(cm(1.234), 0), sourceId: "reference", role: "corner" },
      { ...wp(cm(1.23), -10), sourceId: "nearby", role: "corner" }
    ];
    const point = wp(cm(1.234), cm(2));
    const snap = snapHandlePosition({ context, point });
    expect(snap.lines.length).toBeGreaterThan(0);
    expect(pointerSnapLines(context, wp(cm(1.23), cm(2)), snap.targets!)).toEqual([]);
    const bypass = snapHandlePosition({ context, point, modifiers: { ctrlOrMeta: true } });
    expect(bypass.snappedPoint).toEqual(point);
    expect(bypass.lines).toEqual([]);
    expect(bypass.targets).toBeUndefined();
  });
});
