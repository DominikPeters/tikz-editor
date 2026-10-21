import { describe, expect, it } from "vitest";
import { buildSnapContext, pointerSnapLines, snapHandlePosition } from "../../packages/core/src/edit/snapping/index.js";
import { snapToolCreatePointer } from "../../packages/app/src/ui/canvas-panel/tool-pointer-snap.js";
import { projectResizePointer } from "../../packages/app/src/ui/canvas-panel/resize-constraints.js";
import { resolveResizeFrameForSource } from "../../packages/app/src/ui/canvas-panel/resize-frames.js";
import { resolveEndpointAnchorSnap } from "../../packages/app/src/ui/canvas-panel/endpoint-anchor-snap.js";
import { resolvePathEndpointSnap } from "../../packages/app/src/ui/canvas-panel/path-endpoint-snap.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { wp } from "../coords-helpers.js";

function context(x = 57, y = 29) {
  const context = buildSnapContext({ sceneElements: [], selectedSourceIds: [], zoom: 1,
    settings: { grid: { enabled: false }, gaps: { enabled: false } } });
  context.referencePoints = [{ ...wp(x, y), sourceId: "reference", role: "corner" }];
  return context;
}

describe("constraint-aware pointer snapping", () => {
  it("snaps a Shift square along its diagonal and never shows the old y target", () => {
    const result = snapToolCreatePointer({ context: context(), start: wp(0, 0), pointer: wp(55, 28),
      mode: "addRect", shiftKey: true, bypass: false });
    expect(result.snappedPoint).toEqual(wp(57, 57));
    expect(result.lines.some(line => line.type === "points" && line.axis === "x")).toBe(true);
    expect(result.lines.some(line => line.type === "points" && line.axis === "y")).toBe(false);
  });

  it("grid quantization cannot leave a guide at an unreachable coordinate", () => {
    const result = snapToolCreatePointer({ context: context(60, 30), start: wp(0, 0), pointer: wp(59, 30),
      mode: "addGrid", shiftKey: false, bypass: false });
    expect(result.snappedPoint.x).not.toBe(60);
    expect(result.lines).toEqual([]);
    const bypass = snapToolCreatePointer({ context: context(), start: wp(0, 0), pointer: wp(55, 28),
      mode: "addGrid", shiftKey: false, bypass: true });
    expect(bypass.snappedPoint).toEqual(wp(55, 28));
  });

  it("bypass keeps a Shift constraint while disabling magnetic alignment", () => {
    const result = snapToolCreatePointer({ context: context(), start: wp(0, 0), pointer: wp(55, 28),
      mode: "addRect", shiftKey: true, bypass: true });
    expect(result.snappedPoint).toEqual(wp(55, 55));
    expect(result.lines).toEqual([]);
  });

  it("projects a rotated ellipse side onto its actual axis", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate=30,xslant=.3] (0,0) ellipse (1cm and .5cm);\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source).figure, source);
    const frame = resolveResizeFrameForSource(semantic.scene.elements, semantic.editHandles, "path:0", {x:0,y:0,width:200,height:200})!;
    const drag = { initialFrame: frame, role: "right" as const, measurementMode: "center" as const, preserveAspectDuringResize: false };
    const projected = projectResizePointer(drag, wp(40, 32), false);
    expect(projected.direction).not.toBeNull();
    const snap = snapHandlePosition({ context: context(42, 100), point: projected.point, direction: projected.direction });
    const again = projectResizePointer(drag, snap.snappedPoint!, false);
    expect(again.point.x).toBeCloseTo(snap.snappedPoint!.x, 8);
    expect(again.point.y).toBeCloseTo(snap.snappedPoint!.y, 8);
  });

  it("diamond vertices resize along the node axis", () => {
    const source = String.raw`\begin{tikzpicture}\node[shape=diamond,aspect=1,draw,minimum width=2cm,minimum height=2cm] {};\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source).figure, source);
    const frame = resolveResizeFrameForSource(semantic.scene.elements, semantic.editHandles, "path:0", {x:0,y:0,width:200,height:200})!;
    const movingCornerRole = (Object.keys(frame.cornersByRole) as Array<keyof typeof frame.cornersByRole>)
      .find(role => Math.abs(frame.cornersByRole[role].world.y - frame.centerWorld.y) < 1e-6 && frame.cornersByRole[role].world.x > frame.centerWorld.x)!;
    expect(movingCornerRole).toBeDefined();
    const projected = projectResizePointer({ initialFrame: frame, movingCornerRole, role: "right", measurementMode: "center", preserveAspectDuringResize: false }, wp(80, 20), false);
    expect(projected.point.x).toBeCloseTo(80, 6);
    expect(projected.point.y).toBeCloseTo(frame.centerWorld.y, 6);
    expect(projected.direction!.y).toBeCloseTo(0, 6);
  });

  it("node anchors and existing path endpoints honor bypass", () => {
    const source = String.raw`\begin{tikzpicture}\node[draw] (a) at (0,0) {};\draw (2,0) -- (3,0);\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source).figure, source);
    const anchor = semantic.nodeAnchorTargets[0];
    expect(resolveEndpointAnchorSnap({ pointerWorld: anchor.world, zoom: 1, nodeAnchorTargets: semantic.nodeAnchorTargets }).snappedAnchor).not.toBeNull();
    expect(resolveEndpointAnchorSnap({ pointerWorld: anchor.world, zoom: 1, nodeAnchorTargets: semantic.nodeAnchorTargets, bypass: true }).snappedAnchor).toBeNull();
    const endpoint = semantic.editHandles.at(-1)!;
    expect(resolvePathEndpointSnap({ pointerWorld: endpoint.world, zoom: 1, editHandles: semantic.editHandles, source })).not.toBeNull();
    expect(resolvePathEndpointSnap({ pointerWorld: endpoint.world, zoom: 1, editHandles: semantic.editHandles, source, bypass: true })).toBeNull();
  });

  it("path-attached nodes can pass a preset without being pulled onto it", () => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (5,0) node[pos=.2,above] {A};\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const path = parsed.figure.body[0];
    if (path.kind !== "Path") throw new Error("path");
    const node = path.items.find(item => item.kind === "Node")!;
    const result = applyEditAction(source, [], { kind: "movePathAttachedNode", nodeId: node.id, hostPathSourceId: path.id,
      pos: .501, snapToPreset: false, preserveRegime: true });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain("pos=0.501");
  });

  it("guide validation drops targets after a structural constraint changes the point", () => {
    const snapContext = context();
    const snap = snapHandlePosition({ context: snapContext, point: wp(56, 28) });
    expect(pointerSnapLines(snapContext, wp(60, 31), snap.targets!)).toEqual([]);
  });
});
