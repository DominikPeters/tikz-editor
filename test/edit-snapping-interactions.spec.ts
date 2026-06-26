import { describe, expect, it } from "vitest";
import type { SceneCircle, SceneElement } from "../packages/core/src/semantic/types.js";
import {
  buildSnapContext,
  selectionSnapPointsFromBounds,
  snapHandlePosition,
  snapSelectionTranslation,
  snapToolPointer
} from "../packages/core/src/edit/snapping/index.js";
import { wb, wp } from "./coords-helpers.js";

function makeCircle(sourceId: string, centerX: number, centerY: number, radius: number): SceneElement {
  const circle: SceneCircle = {
    kind: "Circle",
    id: `circle:${sourceId}`,
    runtimeId: `runtime:circle:${sourceId}`,
    layer: "main",
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "test-fingerprint"
    },
    style: {} as SceneCircle["style"],
    styleChain: [],
    center: wp(centerX, centerY),
    radius
  };

  return circle;
}

function selection(minX: number, minY: number, maxX: number, maxY: number) {
  const bounds = wb(minX, minY, maxX, maxY);
  return {
    bounds,
    snapPoints: selectionSnapPointsFromBounds(bounds)
  };
}

describe("snapping interaction wrappers", () => {
  it("returns snapped selection delta for element drag", () => {
    const scene = [makeCircle("ref", 30, 30, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["moving"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapSelectionTranslation({
      context,
      selection: selection(15, 15, 25, 25),
      rawDelta: wp(4, 4)
    });

    expect(result.snappedDelta).toEqual(wp(5, 5));
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("returns snapped world position for handle drag", () => {
    const scene = [makeCircle("ref", 20, 20, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapHandlePosition({
      context,
      point: wp(19.5, 20.5)
    });

    expect(result.snappedPoint?.x).toBeCloseTo(20, 6);
    expect(result.snappedPoint?.y).toBeCloseTo(20, 6);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("snaps add-node pointer placement", () => {
    const scene = [makeCircle("ref", 12, 9, 3)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapToolPointer({
      context,
      pointer: wp(11.4, 9.3),
      kind: "node"
    });

    expect(result.snappedPoint?.x).toBeCloseTo(12, 6);
    expect(result.snappedPoint?.y).toBeCloseTo(9, 6);
  });

  it("snaps rectangle and circle creation drag pointers", () => {
    const scene = [makeCircle("ref", 20, 5, 5)]; // bounds corner around (15,0) and (25,10)
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false } }
    });

    const rect = snapToolPointer({
      context,
      pointer: wp(14, 9),
      kind: "rect-corner",
      anchor: wp(0, 0)
    });
    const circle = snapToolPointer({
      context,
      pointer: wp(14, 9),
      kind: "circle-edge",
      anchor: wp(0, 0)
    });

    expect(rect.snappedPoint?.x).toBeCloseTo(15, 6);
    expect(rect.snappedPoint?.y).toBeCloseTo(10, 6);
    expect(circle.snappedPoint?.x).toBeCloseTo(15, 6);
    expect(circle.snappedPoint?.y).toBeCloseTo(10, 6);
  });

  it("snaps anchored shape pointer even when anchor is already aligned", () => {
    const scene = [makeCircle("ref", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const rect = snapToolPointer({
      context,
      pointer: wp(4.2, -1.6),
      kind: "rect-corner",
      anchor: wp(0, 0)
    });

    expect(rect.snappedPoint?.x).toBeCloseTo(5, 6);
    expect(rect.lines.some((line) => line.type === "points" && line.axis === "x")).toBe(true);
  });

  it("snaps line endpoint pointers", () => {
    const scene = [makeCircle("ref", 40, 10, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapToolPointer({
      context,
      pointer: wp(44.2, 9.6),
      kind: "line-end",
      anchor: wp(0, 0)
    });

    expect(result.snappedPoint?.x).toBeCloseTo(45, 6);
    expect(result.snappedPoint?.y).toBeCloseTo(10, 6);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("does not suggest handle snap targets from itself when no other references exist", () => {
    const scene = [makeCircle("self", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["self"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const result = snapHandlePosition({
      context,
      point: wp(4.4, 0.2),
      sourceId: "self"
    });

    expect(result.snappedPoint).toEqual(wp(4.4, 0.2));
    expect(result.lines).toEqual([]);
  });
});
