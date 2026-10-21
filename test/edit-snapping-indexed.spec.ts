import { expect, it } from "vitest";
import { pt } from "../packages/core/src/coords/scalars.js";
import { px } from "../packages/core/src/coords/scalars.js";
import { wb, wp } from "./coords-helpers.js";
import { createPointIndex, createBoundsIndex } from "../packages/core/src/edit/snapping/spatial-index.js";
import { buildVisibleGaps } from "../packages/core/src/edit/snapping/gap-snaps.js";
import { buildSnapContext, snapHandlePosition, snapSelectionTranslation, selectionSnapPointsFromBounds } from "../packages/core/src/edit/snapping/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import type { SnapBounds } from "../packages/core/src/edit/snapping/types.js";

function context() {
  const source = String.raw`\begin{tikzpicture}\draw (0,0) rectangle (10,5);\end{tikzpicture}`;
  return buildSnapContext({ sceneElements: evaluateTikzFigure(parseTikz(source).figure, source).scene.elements,
    selectedSourceIds: [], zoom: 1, settings: { grid: { enabled: false }, gaps: { enabled: false }, thresholdPx: px(8) } });
}
it("retains an alignment beyond acquisition range and releases beyond 12 screen pixels", () => {
  const ctx = context();
  const first = snapHandlePosition({ context: ctx, point: wp(6, -50) });
  expect(first.snappedPoint?.x).toBe(0);
  const held = snapHandlePosition({ context: ctx, point: wp(10, -50), previousTargets: first.targets });
  expect(held.snappedPoint?.x).toBe(0);
  const released = snapHandlePosition({ context: ctx, point: wp(13, -50), previousTargets: held.targets });
  expect(released.snappedPoint?.x).toBe(13);
  expect(released.targets?.x).toHaveLength(0);
  const bypass = snapHandlePosition({ context: ctx, point: wp(7, -50), previousTargets: held.targets, modifiers: { ctrlOrMeta: true } });
  expect(bypass.snappedPoint?.x).toBe(7); expect(bypass.targets).toBeUndefined(); expect(bypass.lines).toHaveLength(0);
});
it("switches to a clearly closer target and preserves constrained resize directions", () => {
  const ctx = context(); ctx.referencePoints = [{ ...wp(0, 0), sourceId: "a", role: "corner" }, { ...wp(10, 0), sourceId: "b", role: "corner" }];
  const first = snapHandlePosition({ context: ctx, point: wp(1, 20) });
  const jitter = snapHandlePosition({ context: ctx, point: wp(5.5, 20), previousTargets: first.targets });
  expect(jitter.snappedPoint?.x).toBe(0);
  const switched = snapHandlePosition({ context: ctx, point: wp(8, 20), previousTargets: jitter.targets });
  expect(switched.snappedPoint?.x).toBe(10);
  const direction = { x: pt(1), y: pt(1) } as any;
  const diagonal = snapHandlePosition({ context: ctx, point: wp(6, 26), direction, previousTargets: switched.targets });
  expect(diagonal.snappedPoint!.x - 6).toBe(diagonal.snappedPoint!.y - 26);
});
it("retains the same selection anchor while translating", () => {
  const ctx = context(); const bounds = wb(30, -90, 50, -70);
  const selection = { bounds, snapPoints: selectionSnapPointsFromBounds(bounds) };
  const first = snapSelectionTranslation({ context: ctx, selection, rawDelta: wp(-25, 0) });
  const held = snapSelectionTranslation({ context: ctx, selection, rawDelta: wp(-20, 0), previousTargets: first.targets });
  expect(first.snappedDelta?.x).toBe(-30); expect(held.snappedDelta?.x).toBe(-30);
});
it("indexes axis bands without discarding far-away aligned points", () => {
  let seed = 193;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const points = Array.from({ length: 3000 }, () => wp(random() * 10000, random() * 10000));
  points.push(wp(5, 100000));
  const query = createPointIndex(points);
  for (let i = 0; i < 100; i++) {
    const point = i === 0 ? wp(5, 0) : wp(random() * 10000, random() * 10000);
    expect(query(point, 8, 8)).toEqual(points.filter(p => Math.abs(p.x - point.x) <= 8 || Math.abs(p.y - point.y) <= 8));
  }
});
it("matches exhaustive rectangle intersection and unobstructed gap discovery", () => {
  const boxes: SnapBounds[] = Array.from({ length: 80 }, (_, i) => ({ ...wb((i % 10) * 20, Math.floor(i / 10) * 17, (i % 10) * 20 + 7, Math.floor(i / 10) * 17 + 8), sourceId: String(i) }));
  const query = createBoundsIndex(boxes);
  for (const b of boxes) {
    const region = wb(b.minX - 9, b.minY - 8, b.maxX + 16, b.maxY + 17);
    const intersects = boxes.filter(o => o.minX <= region.maxX && o.maxX >= region.minX && o.minY <= region.maxY && o.maxY >= region.minY);
    expect(new Set(query(region))).toEqual(new Set(intersects));
  }
  const gaps = buildVisibleGaps(boxes, 100000);
  expect(gaps.horizontal).toHaveLength(8 * 9); expect(gaps.vertical).toHaveLength(7 * 10);
  for (const gap of gaps.horizontal) expect(gap.endBounds.minX - gap.startBounds.minX).toBe(20);
  for (const gap of gaps.vertical) expect(gap.endBounds.minY - gap.startBounds.minY).toBe(17);
});
it("retains all reference owners when overlapping bounds form one spacing unit", () => {
  const bounds = [{ ...wb(0, 0, 10, 10), sourceId: "outer" }, { ...wb(2, 2, 4, 4), sourceId: "inner" }, { ...wb(20, 0, 30, 10), sourceId: "right" }];
  const gaps = buildVisibleGaps(bounds, 10000).horizontal;
  expect(gaps).toHaveLength(1);
  expect(new Set(gaps[0].startBounds.sourceIds)).toEqual(new Set(["outer", "inner"]));
});
