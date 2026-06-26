import { describe, expect, it } from "vitest";
import type {
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathCommand,
  SceneText
} from "../packages/core/src/semantic/types.js";
import { worldTransform } from "../packages/core/src/coords/transforms.js";
import {
  buildSnapContext,
  collectSelectionGeometry,
  collectSelectionGeometryFromBounds,
  collectSourceWorldBounds,
  pickGridStepPt,
  resolveSnapSettings,
  selectionSnapPointsFromBounds,
  snapHandlePosition,
  snapKeyboardNudge,
  snapSelectionTranslation,
  snapToolPointer,
  snapToNextMultiple
} from "../packages/core/src/edit/snapping/index.js";
import {
  boundsFromPoints,
  boundsIntersect,
  collectSourceReferenceBounds,
  expandBounds,
  rangeIntersection,
  shiftPathCommand
} from "../packages/core/src/edit/snapping/geometry.js";
import { collectGridSnaps } from "../packages/core/src/edit/snapping/grid-snaps.js";
import { buildVisibleGaps, collectGapSnaps, createGapSnapLines } from "../packages/core/src/edit/snapping/gap-snaps.js";
import type { AxisMinOffset, AxisSnapBuckets, Gap, SelectionGeometry } from "../packages/core/src/edit/snapping/types.js";
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

function makePath(sourceId: string, commands: ScenePathCommand[]): SceneElement {
  const path: ScenePath = {
    kind: "Path",
    id: `path:${sourceId}`,
    runtimeId: `runtime:path:${sourceId}`,
    layer: "main",
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "test-fingerprint"
    },
    style: {} as ScenePath["style"],
    styleChain: [],
    commands
  };

  return path;
}

function makeEllipse(sourceId: string, centerX: number, centerY: number, rx: number, ry: number): SceneElement {
  const ellipse: SceneEllipse = {
    kind: "Ellipse",
    id: `ellipse:${sourceId}`,
    runtimeId: `runtime:ellipse:${sourceId}`,
    layer: "main",
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "test-fingerprint"
    },
    style: {} as SceneEllipse["style"],
    styleChain: [],
    center: wp(centerX, centerY),
    rx,
    ry,
    rotation: 30
  };

  return ellipse;
}

function makeText(sourceId: string, text: string, x: number, y: number): SceneText {
  const textElement: SceneText = {
    kind: "Text",
    id: `text:${sourceId}`,
    runtimeId: `runtime:text:${sourceId}`,
    layer: "main",
    sourceRef: {
      sourceId,
      sourceSpan: { from: 0, to: 0 },
      sourceFingerprint: "test-fingerprint"
    },
    style: { fontSize: 10 } as SceneText["style"],
    styleChain: [],
    position: wp(x, y),
    text,
    rotation: 45
  };

  return textElement;
}

function selectionFromBounds(minX: number, minY: number, maxX: number, maxY: number): SelectionGeometry {
  const bounds = wb(minX, minY, maxX, maxY);
  return {
    bounds,
    snapPoints: selectionSnapPointsFromBounds(bounds)
  };
}

function gapBetween(
  startBounds: Gap["startBounds"],
  endBounds: Gap["endBounds"],
  axis: "x" | "y"
): Gap {
  if (axis === "x") {
    return {
      startBounds,
      endBounds,
      startSide: [wp(startBounds.maxX, startBounds.minY), wp(startBounds.maxX, startBounds.maxY)],
      endSide: [wp(endBounds.minX, endBounds.minY), wp(endBounds.minX, endBounds.maxY)],
      overlap: [Math.max(startBounds.minY, endBounds.minY), Math.min(startBounds.maxY, endBounds.maxY)],
      length: endBounds.minX - startBounds.maxX
    };
  }

  return {
    startBounds,
    endBounds,
    startSide: [wp(startBounds.minX, startBounds.maxY), wp(startBounds.maxX, startBounds.maxY)],
    endSide: [wp(endBounds.minX, endBounds.minY), wp(endBounds.maxX, endBounds.minY)],
    overlap: [Math.max(startBounds.minX, endBounds.minX), Math.min(startBounds.maxX, endBounds.maxX)],
    length: endBounds.minY - startBounds.maxY
  };
}

describe("edit snapping core", () => {
  it("snaps to nearest point on both axes", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const snapped = snapHandlePosition({
      context,
      point: wp(99, 101)
    });

    expect(snapped.snappedPoint?.x).toBeCloseTo(100, 6);
    expect(snapped.snappedPoint?.y).toBeCloseTo(100, 6);
    expect(snapped.lines.length).toBeGreaterThan(0);
  });

  it("uses zoom-scaled threshold", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];

    const zoom1 = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const zoom2 = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 2,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const snappedAtZoom1 = snapHandlePosition({
      context: zoom1,
      point: wp(111, 100)
    });

    const snappedAtZoom2 = snapHandlePosition({
      context: zoom2,
      point: wp(111, 100)
    });

    expect(snappedAtZoom1.snappedPoint?.x).toBeCloseTo(105, 6);
    expect(snappedAtZoom2.snappedPoint?.x).toBeCloseTo(111, 6);
  });

  it("bypasses snapping when ctrl/cmd modifier is active", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const raw = wp(99, 101);
    const snapped = snapHandlePosition({
      context,
      point: raw,
      modifiers: { ctrlOrMeta: true }
    });

    expect(snapped.snappedPoint).toEqual(raw);
    expect(snapped.lines).toEqual([]);
  });

  it("bypasses selection translation snapping when ctrl/cmd modifier is active", () => {
    const context = buildSnapContext({
      sceneElements: [makeCircle("ref", 100, 100, 5)],
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });
    const rawDelta = wp(7, 7);

    const snapped = snapSelectionTranslation({
      context,
      selection: selectionFromBounds(90, 90, 94, 94),
      rawDelta,
      modifiers: { ctrlOrMeta: true }
    });

    expect(snapped.snappedDelta).toEqual(rawDelta);
    expect(snapped.lines).toEqual([]);
  });

  it("recomputes exact guide lines after snapping", () => {
    const scene = [makeCircle("ref", 100, 100, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const selection = selectionFromBounds(90, 90, 94, 94);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: wp(7, 7)
    });

    expect(snapped.snappedDelta?.x).toBeCloseTo(6, 6);
    expect(snapped.snappedDelta?.y).toBeCloseTo(6, 6);
    expect(snapped.lines.some((line) => line.type === "points")).toBe(true);
  });

  it("supports grid step selection and next-multiple snapping", () => {
    const gridStep = pickGridStepPt(1, 22);
    expect(gridStep).toBeGreaterThan(0);
    expect(pickGridStepPt(1e-9, 22)).toBeCloseTo(50 * 28.4527559055, 6);

    expect(snapToNextMultiple(10, 2, 1)).toBe(12);
    expect(snapToNextMultiple(10, 2, -1)).toBe(8);
    expect(snapToNextMultiple(10.1, 2, 1)).toBe(12);
    expect(snapToNextMultiple(10.1, 2, -1)).toBe(10);
    expect(snapToNextMultiple(10, 0, 1)).toBe(10);
    expect(snapToNextMultiple(10, -2, 1)).toBe(8);

    const context = buildSnapContext({
      sceneElements: [],
      selectedSourceIds: [],
      zoom: 1
    });

    const snapped = snapHandlePosition({
      context,
      point: wp(gridStep + 3, 0)
    });

    expect(snapped.snappedPoint?.x).toBeCloseTo(gridStep, 6);
    expect(snapped.lines).toEqual([]);
  });

  it("collects direct grid snaps with invalid steps and axis gating", () => {
    const emptyNearest: AxisSnapBuckets = { x: [], y: [] };
    const emptyMinOffset: AxisMinOffset = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
    collectGridSnaps({
      selectionPoints: [wp(3, 4)],
      minOffset: emptyMinOffset,
      nearest: emptyNearest,
      gridStep: 0
    });
    expect(emptyNearest).toEqual({ x: [], y: [] });

    const nearest: AxisSnapBuckets = { x: [], y: [] };
    const minOffset: AxisMinOffset = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
    collectGridSnaps({
      selectionPoints: [wp(3, 4)],
      minOffset,
      nearest,
      gridStep: 2,
      enabledAxis: "y"
    });
    expect(nearest.x).toEqual([]);
    expect(nearest.y).toHaveLength(1);
    expect(nearest.y[0]).toMatchObject({ kind: "grid", axis: "y", offset: 0 });
  });

  it("normalizes partial snap settings, guides, selected references, and viewport filters", () => {
    const settings = resolveSnapSettings({ points: { enabled: false } });
    expect(settings.points.enabled).toBe(false);
    expect(settings.grid.enabled).toBe(true);

    const context = buildSnapContext({
      sceneElements: [
        makeCircle("selected", 0, 0, 5),
        makeCircle("visible", 20, 0, 5),
        makeCircle("outside", 1e9, 0, 5)
      ],
      selectedSourceIds: ["selected"],
      zoom: 0,
      viewportWorld: wb(0, -20, 40, 20),
      guides: {
        x: [10, 10.0000004, Number.POSITIVE_INFINITY, Number.NaN],
        y: [5, Number.NEGATIVE_INFINITY, 5]
      },
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    expect(context.zoom).toBe(1e-6);
    expect(context.referenceBounds.map((bounds) => bounds.sourceId)).toEqual(["visible"]);
    expect(context.guides).toEqual({ x: [10], y: [5] });
    expect(context.visibleGaps).toEqual({ horizontal: [], vertical: [] });
  });

  it("snaps selection translations to the grid when no point or gap target is nearer", () => {
    const context = buildSnapContext({
      sceneElements: [],
      selectedSourceIds: [],
      zoom: 1
    });

    const snapped = snapSelectionTranslation({
      context,
      selection: selectionFromBounds(3, 5, 13, 15),
      rawDelta: wp(0, 0)
    });

    expect(snapped.snappedDelta?.x).toBeCloseTo(-3, 6);
    expect(snapped.snappedDelta?.y).toBeCloseTo(-5, 6);
  });

  it("snaps to explicit guide lines", () => {
    const context = buildSnapContext({
      sceneElements: [],
      selectedSourceIds: [],
      zoom: 1,
      guides: { x: [40], y: [15] },
      settings: { points: { enabled: false }, grid: { enabled: false }, gaps: { enabled: false } }
    });

    const snapped = snapHandlePosition({
      context,
      point: wp(44.2, 12.8)
    });

    expect(snapped.snappedPoint).toEqual(wp(40, 15));
  });

  it("supports gap center snapping", () => {
    const scene = [
      makeCircle("a", 5, 5, 5),   // bounds x=[0,10]
      makeCircle("b", 45, 5, 5)   // bounds x=[40,50]
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { points: { enabled: false }, grid: { enabled: false } }
    });

    const selection = selectionFromBounds(13, 0, 23, 10);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: wp(0, 0)
    });

    expect(snapped.snappedDelta?.x).toBeCloseTo(7, 6);
    expect(snapped.lines.some((line) => line.type === "gap")).toBe(true);
  });

  it("supports gap duplicate-spacing snapping", () => {
    const scene = [
      makeCircle("a", 5, 5, 5),    // bounds x=[0,10]
      makeCircle("b", 25, 5, 5)    // bounds x=[20,30], gap=10
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { points: { enabled: false }, grid: { enabled: false } }
    });

    const selection = selectionFromBounds(37, 0, 47, 10);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: wp(0, 0)
    });

    expect(snapped.snappedDelta?.x).toBeCloseTo(3, 6);
    expect(snapped.lines.some((line) => line.type === "gap")).toBe(true);
  });

  it("dedupes gap guide segments", () => {
    const scene = [
      makeCircle("a", 5, 5, 5),
      makeCircle("b", 25, 5, 5),
      makeCircle("c", 45, 5, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { points: { enabled: false }, grid: { enabled: false } }
    });

    const selection = selectionFromBounds(37, 0, 47, 10);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta: wp(0, 0)
    });

    const keys = new Set<string>();
    for (const line of snapped.lines) {
      if (line.type !== "gap") continue;
      for (const segment of line.segments) {
        const a = `${segment[0].x.toFixed(4)},${segment[0].y.toFixed(4)}`;
        const b = `${segment[1].x.toFixed(4)},${segment[1].y.toFixed(4)}`;
        const key = a <= b ? `${a}|${b}` : `${b}|${a}`;
        keys.add(key);
      }
    }

    const segmentCount = snapped.lines
      .filter((line) => line.type === "gap")
      .reduce((sum, line) => sum + line.segments.length, 0);

    expect(keys.size).toBe(segmentCount);
  });

  it("excludes self-source handle snapping by default", () => {
    const scene = [
      makeCircle("self", 0, 0, 5),
      makeCircle("other", 100, 0, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const withoutSelf = snapHandlePosition({
      context,
      point: wp(4, 0),
      sourceId: "self"
    });

    const withSelf = snapHandlePosition({
      context,
      point: wp(4, 0),
      sourceId: "self",
      allowSelfSnap: true
    });

    expect(withoutSelf.snappedPoint?.x).toBeCloseTo(4, 6);
    expect(withSelf.snappedPoint?.x).toBeCloseTo(5, 6);
  });

  it("keeps keyboard nudge directional intent", () => {
    const snapped = snapKeyboardNudge({
      anchor: wp(0, 0),
      axis: "x",
      direction: 1,
      step: 2
    });

    expect((snapped.snappedDelta?.x ?? 0) > 0).toBe(true);
    expect(snapped.snappedDelta?.y ?? 0).toBe(0);
  });

  it("does not snap keyboard nudges to nearby targets", () => {
    const rawStep = 2;
    const snapped = snapKeyboardNudge({
      anchor: wp(0, 0),
      axis: "x",
      direction: 1,
      step: rawStep
    });

    expect(snapped.snappedDelta).toEqual(wp(rawStep, 0));
    expect(snapped.offset).toEqual(wp(0, 0));
    expect(snapped.lines).toEqual([]);
  });

  it("falls back to the raw keyboard step when the anchor is already on the next grid multiple", () => {
    const snapped = snapKeyboardNudge({
      anchor: wp(4, 4),
      axis: "y",
      direction: 1,
      step: 2
    });

    expect(snapped.snappedDelta).toEqual(wp(0, 2));
  });

  it("snaps anchored tool pointers with only the movable pointer as the snap driver", () => {
    const context = buildSnapContext({
      sceneElements: [makeCircle("target", 50, 50, 5)],
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const snapped = snapToolPointer({
      context,
      kind: "rect-corner",
      anchor: wp(50, 50),
      pointer: wp(54, 50)
    });

    expect(snapped.snappedPoint).toEqual(wp(55, 50));
    expect(snapped.lines.some((line) => line.type === "pointer")).toBe(true);
  });

  it("bypasses tool pointer snapping when ctrl/cmd is active", () => {
    const context = buildSnapContext({
      sceneElements: [makeCircle("target", 50, 50, 5)],
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const pointer = wp(54, 50);
    const snapped = snapToolPointer({
      context,
      kind: "node",
      pointer,
      modifiers: { ctrlOrMeta: true }
    });

    expect(snapped.snappedPoint).toEqual(pointer);
    expect(snapped.lines).toEqual([]);
  });

  it("uses the generic tool pointer path for unanchored shape tools", () => {
    const context = buildSnapContext({
      sceneElements: [makeCircle("target", 50, 50, 5)],
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const snapped = snapToolPointer({
      context,
      kind: "circle-edge",
      pointer: wp(54, 50)
    });

    expect(snapped.snappedPoint).toEqual(wp(55, 50));
  });

  it("does not suggest snap targets when only selected-source geometry exists", () => {
    const scene = [makeCircle("self", 10, 10, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["self"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const selection = selectionFromBounds(5, 5, 15, 15);
    const rawDelta = wp(1.25, -0.75);
    const snapped = snapSelectionTranslation({
      context,
      selection,
      rawDelta
    });

    expect(snapped.snappedDelta).toEqual(rawDelta);
    expect(snapped.lines).toEqual([]);
  });

  it("excludes selected sources from all reference targets", () => {
    const scene = [
      makeCircle("a", 0, 0, 5),
      makeCircle("b", 20, 0, 5),
      makeCircle("c", 40, 0, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["b"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    expect(context.referencePoints.every((point) => point.sourceId !== "b")).toBe(true);
    expect(context.referenceBounds.every((bounds) => bounds.sourceId !== "b")).toBe(true);
  });

  it("excludes open paths from reference snap targets", () => {
    const scene = [
      makePath("open", [
        { kind: "M", to: wp(-20, 0) },
        { kind: "L", to: wp(20, 0) }
      ]),
      makePath("closed", [
        { kind: "M", to: wp(30, 30) },
        { kind: "L", to: wp(50, 30) },
        { kind: "L", to: wp(50, 50) },
        { kind: "L", to: wp(30, 50) },
        { kind: "Z" }
      ])
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    expect(context.referenceBounds.map((bounds) => bounds.sourceId)).toEqual(["closed"]);
    expect(context.referencePoints.every((point) => point.sourceId !== "open")).toBe(true);
  });

  it("is stateless across calls and only depends on current input", () => {
    const scene = [makeCircle("ref", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["moving"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const moving = selectionFromBounds(-12.5, -54.1, 11.1, -13.6);

    const near = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: wp(0, 0)
    });
    const far = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: wp(200, 200)
    });
    const nearAgain = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: wp(0, 0)
    });

    expect(nearAgain).toEqual(near);
    expect(far.lines).toEqual([]);
  });

  it("emits point guides only from current snapped points and current references", () => {
    const scene = [makeCircle("ref", 0, 0, 5)];
    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: ["moving"],
      zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });

    const moving = selectionFromBounds(-12.5, -54.1, 11.1, -13.6);
    const snapped = snapSelectionTranslation({
      context,
      selection: moving,
      rawDelta: wp(0, 0)
    });
    const delta = snapped.snappedDelta ?? wp(0, 0);

    const toKey = (x: number, y: number) => `${x.toFixed(6)},${y.toFixed(6)}`;
    const snappedSelectionPoints = moving.snapPoints.map((point) => toKey(point.x + delta.x, point.y + delta.y));
    const referencePoints = context.referencePoints.map((point) => toKey(point.x, point.y));
    const allowedPointKeys = new Set([...snappedSelectionPoints, ...referencePoints]);

    const pointLines = snapped.lines.filter((line) => line.type === "points");
    expect(pointLines.length).toBeGreaterThan(0);

    for (const line of pointLines) {
      for (const point of line.points) {
        expect(allowedPointKeys.has(toKey(point.x, point.y))).toBe(true);
      }
    }
  });

  it("collects transformed bounds across paths, ellipses, text, and matrix cells", () => {
    const transformedCircle = makeCircle("circle", 5, 5, 5);
    transformedCircle.transform = worldTransform(1, 0, 0, 1, 10, -2);

    const matrixText = makeText("cell", "ab\nc", 30, 10);
    matrixText.matrixCell = {
      matrixSourceId: "matrix",
      cellSourceId: "cell",
      row: 0,
      column: 0,
      textMode: "text",
      textSpan: { from: 0, to: 0 },
      cellSpan: { from: 0, to: 0 }
    };

    const scene: SceneElement[] = [
      transformedCircle,
      makeEllipse("ellipse", 20, 20, 6, 2),
      makePath("curve", [
        { kind: "M", to: wp(0, 0) },
        { kind: "C", c1: wp(10, 30), c2: wp(20, -10), to: wp(30, 0) },
        { kind: "A", rx: 4, ry: 6, xAxisRotation: 0, largeArc: false, sweep: true, to: wp(40, 5) },
        { kind: "Z" }
      ]),
      matrixText,
      {
        ...makeCircle("ignored", 0, 0, 100),
        adornment: {
          targetId: "target",
          kind: "label" as const,
          ownerSourceId: "owner",
          ownerNodeId: "node",
          adornmentIndex: 0,
          optionSpan: { from: 0, to: 0 },
          valueSpan: { from: 0, to: 0 },
          textSpan: { from: 0, to: 0 },
          angleRaw: "0",
          distancePt: 0,
          defaultDistancePt: 0,
          distanceExplicit: false
        }
      },
      { ...makeCircle("   ", 0, 0, 1) }
    ];

    const boundsBySource = collectSourceWorldBounds(scene);
    expect(boundsBySource.get("circle")).toMatchObject({ minX: 10, minY: -2, maxX: 20, maxY: 8 });
    expect(boundsBySource.has("ignored")).toBe(false);
    expect(boundsBySource.has("")).toBe(false);
    expect(boundsBySource.get("ellipse")?.maxX).toBeGreaterThan(25);
    expect(boundsBySource.get("curve")?.maxY).toBeGreaterThanOrEqual(30);
    expect(boundsBySource.get("matrix")).toMatchObject({
      minX: boundsBySource.get("cell")?.minX,
      minY: boundsBySource.get("cell")?.minY,
      maxX: boundsBySource.get("cell")?.maxX,
      maxY: boundsBySource.get("cell")?.maxY
    });

    const selection = collectSelectionGeometry(scene, ["circle", "matrix"]);
    expect(selection?.bounds.minX).toBeCloseTo(10, 6);
    expect(selection?.snapPoints).toHaveLength(5);
    expect(collectSelectionGeometryFromBounds(boundsBySource, ["missing"])).toBeNull();
    expect(collectSourceReferenceBounds(scene).get("matrix")).toMatchObject({
      minX: boundsBySource.get("cell")?.minX
    });
  });

  it("covers primitive snapping geometry helpers and command shifting", () => {
    expect(boundsFromPoints(wp(5, -1), wp(-2, 7))).toEqual(wb(-2, -1, 5, 7));
    expect(expandBounds(wb(0, 1, 2, 3), 4)).toEqual(wb(-4, -3, 6, 7));
    expect(boundsIntersect(wb(0, 0, 1, 1), wb(2, 2, 3, 3))).toBe(false);
    expect(rangeIntersection([0, 1], [2, 3])).toBeNull();

    expect(shiftPathCommand({ kind: "Z" }, wp(3, 4))).toEqual({ kind: "Z" });
    expect(shiftPathCommand({ kind: "M", to: wp(1, 2) }, wp(3, 4))).toEqual({ kind: "M", to: wp(4, 6) });
    expect(shiftPathCommand({ kind: "A", rx: 1, ry: 2, xAxisRotation: 0, largeArc: false, sweep: true, to: wp(1, 2) }, wp(3, 4))).toMatchObject({ to: wp(4, 6) });
    expect(shiftPathCommand({ kind: "C", c1: wp(0, 0), c2: wp(1, 1), to: wp(2, 2) }, wp(3, 4))).toMatchObject({
      c1: wp(3, 4),
      c2: wp(4, 5),
      to: wp(5, 6)
    });
  });

  it("returns null selection bounds for empty paths and estimates unrotated text bounds", () => {
    const emptyPath = makePath("empty", [{ kind: "Z" }]);
    const text = makeText("plain", "", 10, 10);
    text.rotation = 0;
    const boundsBySource = collectSourceWorldBounds([emptyPath, text]);

    expect(boundsBySource.has("empty")).toBe(false);
    expect(boundsBySource.get("plain")).toMatchObject({ minX: 10, maxX: 10, minY: 4.25, maxY: 15.75 });
  });

  it("generates vertical center and equal gap guides with axis gating", () => {
    const scene = [
      makeCircle("top", 5, 5, 5),
      makeCircle("bottom", 5, 45, 5),
      makeCircle("left", -30, 5, 5),
      makeCircle("right", 40, 5, 5)
    ];

    const context = buildSnapContext({
      sceneElements: scene,
      selectedSourceIds: [],
      zoom: 1,
      settings: { points: { enabled: false }, grid: { enabled: false } }
    });

    const selection = selectionFromBounds(0, 13, 10, 23);
    const vertical = snapSelectionTranslation({
      context,
      selection,
      rawDelta: wp(0, 0),
      enabledAxis: "y"
    });

    expect(vertical.snappedDelta?.y).toBeCloseTo(7, 6);
    expect(vertical.snappedDelta?.x).toBe(0);
    expect(vertical.lines.some((line) => line.type === "gap" && line.direction === "vertical")).toBe(true);

    const horizontalBlocked = snapSelectionTranslation({
      context,
      selection,
      rawDelta: wp(0, 0),
      enabledAxis: "x"
    });

    expect(horizontalBlocked.snappedDelta?.y).toBe(0);
  });

  it("ignores vertical gap snaps when the moved selection no longer overlaps the gap", () => {
    const top = { ...wb(0, 0, 10, 10), sourceId: "top" };
    const bottom = { ...wb(0, 30, 10, 40), sourceId: "bottom" };
    const nearest: AxisSnapBuckets = { x: [], y: [] };
    const minOffset: AxisMinOffset = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };

    collectGapSnaps({
      selectionBounds: wb(20, 15, 25, 20),
      visibleGaps: { horizontal: [], vertical: [gapBetween(top, bottom, "y")] },
      minOffset,
      nearest
    });

    expect(nearest).toEqual({ x: [], y: [] });
  });

  it("creates equal gap line geometry for left, top, and bottom side candidates", () => {
    const left = { ...wb(0, 0, 10, 10), sourceId: "left" };
    const right = { ...wb(30, 0, 40, 10), sourceId: "right" };
    const top = { ...wb(0, 0, 10, 10), sourceId: "top" };
    const bottom = { ...wb(0, 30, 10, 40), sourceId: "bottom" };
    const horizontalGap = gapBetween(left, right, "x");
    const verticalGap = gapBetween(top, bottom, "y");
    const horizontalLines = createGapSnapLines(wb(15, 0, 20, 10), [
      { kind: "gap", axis: "x", direction: "side_left", gap: horizontalGap, offset: 0 }
    ]);
    const verticalLines = createGapSnapLines(wb(0, 15, 10, 20), [
      { kind: "gap", axis: "y", direction: "side_top", gap: verticalGap, offset: 0 },
      { kind: "gap", axis: "y", direction: "side_bottom", gap: verticalGap, offset: 0 }
    ]);
    const lines = [...horizontalLines, ...verticalLines];

    expect(lines).toHaveLength(3);
    expect(lines.some((line) => line.type === "gap" && line.direction === "horizontal")).toBe(true);
    expect(lines.some((line) => line.type === "gap" && line.direction === "vertical")).toBe(true);
  });

  it("drops gap snap candidates that no longer overlap the snapped selection", () => {
    const left = { ...wb(0, 0, 10, 10), sourceId: "left" };
    const right = { ...wb(30, 0, 40, 10), sourceId: "right" };
    const gap = gapBetween(left, right, "x");

    const lines = createGapSnapLines(wb(20, 20, 25, 25), [
      { kind: "gap", axis: "x", direction: "center_horizontal", gap, offset: 0 }
    ]);

    expect(lines).toEqual([]);
  });

  it("honors visible gap pair limits and requires overlapping opposing sides", () => {
    const referenceBounds = [
      { ...wb(0, 0, 10, 10), sourceId: "a" },
      { ...wb(20, 30, 30, 40), sourceId: "no-overlap" },
      { ...wb(40, 0, 50, 10), sourceId: "b" },
      { ...wb(80, 0, 90, 10), sourceId: "c" }
    ];

    const limited = buildVisibleGaps(referenceBounds, 1);
    expect(limited.horizontal).toHaveLength(0);

    const unlimited = buildVisibleGaps(referenceBounds, 100);
    expect(unlimited.horizontal.map((gap) => [gap.startBounds.sourceId, gap.endBounds.sourceId])).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"]
    ]);
    expect(unlimited.vertical).toHaveLength(0);
  });
});
