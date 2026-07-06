import { describe, expect, it } from "vitest";
import { pt, svgBounds, svgPoint, worldPoint } from "../../packages/core/src/coords/index.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import type { EditHandle } from "../../packages/core/src/semantic/types.js";
import { identityMatrix } from "../../packages/core/src/semantic/transform.js";
import {
  createBezierTemplateFromBend,
  resolveHandleIdForDrag,
  resolveBezierControlsFromBend,
  projectResizeDimensionsFromOppositeCorner,
  snapPointDeltaToAxisStepMultiples
} from "../../packages/app/src/ui/canvas-panel/interaction-helpers.js";
import type { ResizeFrame } from "../../packages/app/src/ui/canvas-panel/resize-frames.js";

const cm = (value: number): number => value * PT_PER_CM;
const wp = (x: number, y: number) => worldPoint(pt(x), pt(y));

type Point = { x: number; y: number };

function cubicMidpoint(p0: Point, p1: Point, p2: Point, p3: Point): Point {
  return {
    x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
    y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8
  };
}

function makePathPointHandle(
  id: string,
  sourceId: string,
  world: ReturnType<typeof wp>
): EditHandle {
  return {
    id,
    runtimeId: `runtime:${id}`,
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "fp"
    },
    kind: "path-point",
    world,
    transform: identityMatrix(),
    sourceText: "",
    coordinateForm: "cartesian",
    rewriteMode: "direct"
  } as EditHandle;
}

function makeResizeFrame(width: number, height: number): ResizeFrame {
  const sp = (x: number, y: number) => svgPoint(pt(x), pt(y));
  const point = (x: number, y: number) => ({ world: wp(x, y), svg: sp(x, y) });
  return {
    sourceId: "path:0",
    centerWorld: wp(width / 2, height / 2),
    centerSvg: sp(width / 2, height / 2),
    cornersByRole: {
      "top-left": point(0, height),
      "top-right": point(width, height),
      "bottom-left": point(0, 0),
      "bottom-right": point(width, 0)
    },
    polygonSvg: [
      sp(0, height),
      sp(width, height),
      sp(width, 0),
      sp(0, 0)
    ],
    boundsSvg: svgBounds(pt(0), pt(0), pt(width), pt(height))
  };
}

describe("interaction-helpers bezier math", () => {
  it("yields straight one-third/two-third controls for zero bend", () => {
    const start = wp(cm(0), cm(0));
    const end = wp(cm(3), cm(0));
    const bend = wp(cm(1.5), cm(0));

    const result = resolveBezierControlsFromBend(start, end, bend);
    expect(result.control1.x).toBeCloseTo(cm(1), 6);
    expect(result.control1.y).toBeCloseTo(cm(0), 6);
    expect(result.control2.x).toBeCloseTo(cm(2), 6);
    expect(result.control2.y).toBeCloseTo(cm(0), 6);
  });

  it("mirrors control offsets for opposite bend directions", () => {
    const start = wp(cm(0), cm(0));
    const end = wp(cm(3), cm(0));
    const bendUp = wp(cm(1.5), cm(1));
    const bendDown = wp(cm(1.5), cm(-1));

    const up = resolveBezierControlsFromBend(start, end, bendUp);
    const down = resolveBezierControlsFromBend(start, end, bendDown);

    expect(up.control1.x).toBeCloseTo(down.control1.x, 6);
    expect(up.control2.x).toBeCloseTo(down.control2.x, 6);
    expect(up.control1.y).toBeCloseTo(-down.control1.y, 6);
    expect(up.control2.y).toBeCloseTo(-down.control2.y, 6);
  });

  it("produces controls whose cubic midpoint matches the bend point", () => {
    const start = wp(cm(0), cm(0));
    const end = wp(cm(4), cm(0));
    const bend = wp(cm(2), cm(1.25));

    const result = resolveBezierControlsFromBend(start, end, bend);
    const midpoint = cubicMidpoint(start, result.control1, result.control2, result.endWorld);

    expect(midpoint.x).toBeCloseTo(bend.x, 6);
    expect(midpoint.y).toBeCloseTo(bend.y, 6);
  });

  it("creates a bezier template with explicit controls", () => {
    const template = createBezierTemplateFromBend(
      wp(cm(0), cm(0)),
      wp(cm(3), cm(0)),
      wp(cm(1.5), cm(1))
    );

    expect(template.kind).toBe("bezier");
    if (template.kind !== "bezier") {
      throw new Error("Expected bezier template.");
    }
    expect(template.control1).toBeDefined();
    expect(template.control2).toBeDefined();
    expect(template.to).toBeDefined();
  });

  it("preserves creation stroke color on bezier templates", () => {
    const template = createBezierTemplateFromBend(
      wp(cm(0), cm(0)),
      wp(cm(3), cm(0)),
      wp(cm(1.5), cm(1)),
      { strokeColor: "red" }
    );

    expect(template.strokeColor).toBe("red");
  });
});

describe("interaction-helpers step snapping", () => {
  it("snaps point deltas to integer multiples per axis", () => {
    const snapped = snapPointDeltaToAxisStepMultiples(
      wp(10, 20),
      wp(13.2, 26.1),
      2,
      5
    );
    expect(snapped.x).toBe(14);
    expect(snapped.y).toBe(25);
  });

  it("keeps axis unchanged when step is non-positive", () => {
    const snapped = snapPointDeltaToAxisStepMultiples(
      wp(10, 20),
      wp(13.2, 26.1),
      0,
      -1
    );
    expect(snapped.x).toBe(13.2);
    expect(snapped.y).toBe(26.1);
  });
});

describe("interaction-helpers resize projection", () => {
  it("preserves opposite-corner resize dimensions when requested", () => {
    const frame = makeResizeFrame(cm(2), cm(1));
    const dimensions = projectResizeDimensionsFromOppositeCorner(
      wp(cm(-1), cm(2)),
      frame,
      "top-left",
      0.5,
      true
    );

    expect(dimensions.width).toBeCloseTo(cm(4), 6);
    expect(dimensions.height).toBeCloseTo(cm(2), 6);
  });
});

describe("resolveHandleIdForDrag", () => {
  it("rebinds to nearest same-kind handle when source ids are renumbered", () => {
    const drag: any = {
      kind: "handle",
      handleId: "old-handle",
      sourceId: "path:0",
      handleKind: "path-point",
      lastKnownWorld: wp(10, 10)
    };
    const handles: EditHandle[] = [
      makePathPointHandle("node-h", "path:0", wp(200, 200)),
      makePathPointHandle("line-h", "path:1", wp(10.2, 9.8))
    ];

    const resolved = resolveHandleIdForDrag(drag, handles);

    expect(resolved).toBe("line-h");
    expect(drag.handleId).toBe("line-h");
    expect(drag.sourceId).toBe("path:1");
  });
});
