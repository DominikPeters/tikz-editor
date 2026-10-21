import { describe, expect, it } from "vitest";

import {
  addPoint,
  clonePathCommand,
  clonePoint,
  commandFromSegment,
  commandsToSegments,
  createPathSampleCursor,
  flattenSubpaths,
  hasDrawablePathCommands,
  lengthOfVector,
  normalizeVector,
  perpendicular,
  sampleFrameFromEndExtrapolated,
  sampleFrameFromStartExtrapolated,
  samplePointFromStartExtrapolated,
  scaleVector,
  sliceSegment,
  splitPathIntoSubpaths,
  subtractPoint,
  totalSegmentLength
} from "../packages/core/src/geometry/path-sampler.js";
import { worldPoint, worldVector } from "../packages/core/src/coords/points.js";
import { pt } from "../packages/core/src/coords/scalars.js";
import type { PathSegment } from "../packages/core/src/geometry/path-sampler.js";
import type { ScenePathCommand } from "../packages/core/src/semantic/types.js";

const wp = (x: number, y: number) => worldPoint(pt(x), pt(y));
const expectArcSegment = (segment: PathSegment | undefined): Extract<PathSegment, { kind: "A" }> => {
  expect(segment?.kind).toBe("A");
  if (!segment || segment.kind !== "A") {
    throw new Error("Expected arc segment");
  }
  return segment;
};

describe("geometry path sampler primitives", () => {
  it("clones, splits, and flattens mixed path commands without aliasing source points", () => {
    const commands: ScenePathCommand[] = [
      { kind: "M", to: wp(0, 0) },
      { kind: "L", to: wp(10, 0) },
      { kind: "C", c1: wp(12, 0), c2: wp(12, 8), to: wp(20, 8) },
      { kind: "A", rx: 5, ry: 3, xAxisRotation: 30, largeArc: false, sweep: true, to: wp(25, 10) },
      { kind: "Z" },
      { kind: "M", to: wp(-1, -1) },
      { kind: "L", to: wp(-2, -2) }
    ];

    const subpaths = splitPathIntoSubpaths(commands);
    expect(subpaths).toHaveLength(2);
    expect(flattenSubpaths(subpaths)).toEqual(commands);
    expect(flattenSubpaths(subpaths)[1]).not.toBe(commands[1]);
    expect(hasDrawablePathCommands(commands)).toBe(true);
    expect(hasDrawablePathCommands([{ kind: "M", to: wp(0, 0) }, { kind: "Z" }])).toBe(false);
    expect(clonePathCommand({ kind: "Z" })).toEqual({ kind: "Z" });
    expect(clonePoint(wp(3, 4))).toEqual({ x: 3, y: 4 });

    const afterClose = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "Z" },
      { kind: "L", to: wp(4, 4) },
      { kind: "L", to: wp(8, 4) }
    ]);
    expect(afterClose).toHaveLength(1);
    expect(afterClose[0]?.from).toEqual({ x: 4, y: 4 });
  });

  it("samples lines from both ends and extrapolates beyond path bounds", () => {
    const segments = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "L", to: wp(10, 0) },
      { kind: "L", to: wp(10, 10) }
    ]);

    expect(totalSegmentLength(segments)).toBe(20);
    expect(sampleFrameFromStartExtrapolated([], 1)).toBeNull();
    expect(sampleFrameFromEndExtrapolated([], 1)).toBeNull();
    expect(samplePointFromStartExtrapolated([], 1)).toBeNull();
    expect(sampleFrameFromStartExtrapolated(segments, -3)?.point).toEqual({ x: -3, y: 0 });
    expect(sampleFrameFromStartExtrapolated(segments, 15)?.point).toEqual({ x: 10, y: 5 });
    expect(sampleFrameFromStartExtrapolated(segments, 24)?.point).toEqual({ x: 10, y: 14 });
    expect(sampleFrameFromEndExtrapolated(segments, -2)?.point).toEqual({ x: 10, y: 12 });
    expect(sampleFrameFromEndExtrapolated(segments, 15)?.point).toEqual({ x: 5, y: 0 });
    expect(sampleFrameFromEndExtrapolated(segments, 25)?.point).toEqual({ x: -5, y: 0 });
    expect(samplePointFromStartExtrapolated(segments, 8)).toEqual({ x: 8, y: 0 });
  });

  it("walks sequential sample cursors in both directions without changing sampled frames", () => {
    const commands: ScenePathCommand[] = [{ kind: "M", to: wp(0, 0) }];
    for (let index = 1; index <= 256; index += 1) {
      commands.push({ kind: "L", to: wp(index, 0) });
    }
    const segments = commandsToSegments(commands);

    const forward = createPathSampleCursor(segments);
    expect(forward.segmentIndex).toBeNull();
    for (let index = 0; index < segments.length; index += 1) {
      const distance = index + 0.5;
      expect(forward.sampleFrameFromStartExtrapolated(distance)).toEqual(
        sampleFrameFromStartExtrapolated(segments, distance)
      );
      expect(forward.segmentIndex).toBe(index);
    }

    const backward = createPathSampleCursor(segments);
    expect(backward.segmentIndex).toBeNull();
    for (let index = 0; index < segments.length; index += 1) {
      const distanceFromEnd = index + 0.5;
      expect(backward.sampleFrameFromEndExtrapolated(distanceFromEnd)).toEqual(
        sampleFrameFromEndExtrapolated(segments, distanceFromEnd)
      );
      expect(backward.segmentIndex).toBe(segments.length - index - 1);
    }
  });

  it("handles vector math and zero-length normalization fallbacks", () => {
    const vector = subtractPoint(wp(9, 4), wp(3, 1));
    expect(vector).toEqual({ x: 6, y: 3 });
    expect(addPoint(wp(3, 1), vector)).toEqual({ x: 9, y: 4 });
    expect(scaleVector(vector, -2)).toEqual({ x: -12, y: -6 });
    expect(lengthOfVector(vector)).toBeCloseTo(Math.sqrt(45), 12);
    expect(normalizeVector(worldVector(pt(0), pt(0)))).toEqual({ x: 1, y: 0 });
    expect(perpendicular(worldVector(pt(2), pt(5)))).toEqual({ x: -5, y: 2 });
  });

  it("slices line, cubic, and degenerate arc segments across difficult bounds", () => {
    const [line, cubic, degenerateArc] = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "L", to: wp(10, 0) },
      { kind: "C", c1: wp(10, 10), c2: wp(20, 10), to: wp(20, 0) },
      { kind: "A", rx: 0, ry: 4, xAxisRotation: 0, largeArc: false, sweep: true, to: wp(30, 0) }
    ]);

    expect(sliceSegment(line, 5, 5)).toBeNull();
    const slicedLine = sliceSegment(line, -5, 4);
    expect(slicedLine?.kind).toBe("L");
    expect(slicedLine?.from).toEqual({ x: 0, y: 0 });
    expect(slicedLine?.to).toEqual({ x: 4, y: 0 });

    const slicedCubic = sliceSegment(cubic, cubic.length * 0.2, cubic.length * 0.8);
    expect(slicedCubic?.kind).toBe("C");
    expect(slicedCubic?.from.x).toBeGreaterThan(10);
    expect(slicedCubic?.to.x).toBeLessThan(20);
    expect(slicedCubic ? commandFromSegment(slicedCubic).kind : "M").toBe("C");
    expect(sampleFrameFromStartExtrapolated([cubic], cubic.length / 2)?.point.y).toBeGreaterThan(5);
    expect(sliceSegment(cubic, 0, cubic.length)?.kind).toBe("C");
    expect(sliceSegment(cubic, 0, cubic.length / 2)?.to.x).toBeLessThan(20);
    expect(sliceSegment(cubic, cubic.length / 2, cubic.length)?.from.x).toBeGreaterThan(10);

    const zeroStartDerivativeCubic = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "C", c1: wp(0, 0), c2: wp(5, 10), to: wp(10, 0) }
    ])[0];
    expect(sampleFrameFromStartExtrapolated([zeroStartDerivativeCubic], 0)?.tangent.x).toBeGreaterThan(0);

    const degenerateArcSegment = expectArcSegment(degenerateArc);
    expect(degenerateArcSegment.arc).toBeNull();
    const slicedDegenerateArc = sliceSegment(degenerateArcSegment, 3, 7);
    expect(slicedDegenerateArc?.kind).toBe("L");
    expect(slicedDegenerateArc?.from.x).toBeCloseTo(23, 12);
    expect(slicedDegenerateArc?.to.x).toBeCloseTo(27, 12);
    expect(sampleFrameFromStartExtrapolated([degenerateArcSegment], 5)?.point.x).toBeCloseTo(25, 12);
    const [zeroRyArc] = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "A", rx: 4, ry: 0, xAxisRotation: 0, largeArc: false, sweep: true, to: wp(8, 0) }
    ]);
    const zeroRyArcSegment = expectArcSegment(zeroRyArc);
    expect(zeroRyArcSegment.arc).toBeNull();
    expect(commandFromSegment(line)).toEqual({ kind: "L", to: { x: 10, y: 0 } });
  });

  it("falls back gracefully for zero-length cubics and coincident arcs", () => {
    const [zeroCubic, zeroArc] = commandsToSegments([
      { kind: "M", to: wp(3, 3) },
      { kind: "C", c1: wp(3, 3), c2: wp(3, 3), to: wp(3, 3) },
      { kind: "A", rx: 4, ry: 4, xAxisRotation: 0, largeArc: false, sweep: true, to: wp(3, 3) }
    ]);

    expect(zeroCubic.length).toBe(0);
    expect(sampleFrameFromStartExtrapolated([zeroCubic], 0)?.tangent).toEqual({ x: 1, y: 0 });
    expect(sliceSegment(zeroCubic, 0, 1)).toBeNull();
    const zeroArcSegment = expectArcSegment(zeroArc);
    expect(zeroArcSegment.arc).not.toBeNull();
    expect(zeroArcSegment.length).toBe(0);
    expect(sampleFrameFromStartExtrapolated([zeroArcSegment], 0)?.point).toEqual({ x: 3, y: 3 });
    expect(sliceSegment(zeroArcSegment, 0, 1)).toBeNull();
  });

  it("samples and slices rotated large arcs with radius correction", () => {
    const [arc] = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "A", rx: 1, ry: 2, xAxisRotation: 45, largeArc: true, sweep: false, to: wp(20, 0) }
    ]);

    const arcSegment = expectArcSegment(arc);
    expect(arcSegment.arc).not.toBeNull();
    expect(arcSegment.length).toBeGreaterThan(20);

    const midFrame = sampleFrameFromStartExtrapolated([arcSegment], arcSegment.length / 2);
    expect(midFrame?.point.x).toBeGreaterThan(1);
    expect(midFrame?.point.x).toBeLessThan(19);
    expect(midFrame?.normal.x).toBeCloseTo(-midFrame!.tangent.y, 12);

    const slicedArc = sliceSegment(arcSegment, arcSegment.length * 0.1, arcSegment.length * 0.9);
    expect(slicedArc?.kind).toBe("A");
    expect(slicedArc?.length).toBeLessThan(arcSegment.length);
    const slicedArcSegment = expectArcSegment(slicedArc ?? undefined);
    expect(slicedArcSegment.command.sweep).toBe(false);
    expect(slicedArcSegment.command.xAxisRotation).toBe(45);
    expect(commandFromSegment(arcSegment)).toEqual({
      kind: "A",
      rx: 1,
      ry: 2,
      xAxisRotation: 45,
      largeArc: true,
      sweep: false,
      to: { x: 20, y: 0 }
    });
  });

  it("samples sweep arcs whose endpoint conversion requires positive delta normalization", () => {
    const [arc] = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "A", rx: 8, ry: 5, xAxisRotation: 0, largeArc: true, sweep: true, to: wp(6, 0) }
    ]);

    const arcSegment = expectArcSegment(arc);
    expect(arcSegment.arc?.deltaAngle).toBeGreaterThan(Math.PI);
    const frame = sampleFrameFromStartExtrapolated([arcSegment], arcSegment.length / 3);
    expect(frame?.point.x).toBeGreaterThanOrEqual(-8);
    expect(frame?.point.x).toBeLessThanOrEqual(8);
  });

  it("keeps cursor sampling bit-for-bit equivalent across cached curves and direction changes", () => {
    const segments = commandsToSegments([
      { kind: "M", to: wp(0, 0) },
      { kind: "C", c1: wp(4, 12), c2: wp(9, -7), to: wp(14, 3) },
      { kind: "L", to: wp(19, 3) },
      { kind: "A", rx: 7, ry: 4, xAxisRotation: 25, largeArc: false, sweep: true, to: wp(28, 1) }
    ]);
    const total = totalSegmentLength(segments);
    const distances = [total * 0.07, total * 0.31, total * 0.58, total * 0.93, total * 0.42];
    const cursor = createPathSampleCursor(segments);

    for (const distance of distances) {
      expect(cursor.sampleFrameFromStartExtrapolated(distance)).toEqual(
        sampleFrameFromStartExtrapolated(segments, distance)
      );
    }
    for (const distance of distances) {
      expect(cursor.sampleFrameFromEndExtrapolated(distance)).toEqual(
        sampleFrameFromEndExtrapolated(segments, distance)
      );
    }
  });

  it("starts new segments when draw commands appear before an explicit move", () => {
    const segments = commandsToSegments([
      { kind: "L", to: wp(5, 5) },
      { kind: "L", to: wp(8, 9) }
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.from).toEqual({ x: 5, y: 5 });
    expect(segments[0]?.to).toEqual({ x: 8, y: 9 });
  });
});
