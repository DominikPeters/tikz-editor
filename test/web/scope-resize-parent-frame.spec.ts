/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { createEditGeometrySession } from "../../packages/core/src/edit/geometry-session.js";
import { pt, worldPoint, worldBounds } from "../../packages/core/src/coords/index.js";
import { useCanvasSelectionDerivedState, type UseCanvasSelectionDerivedStateArgs } from "../../packages/app/src/ui/canvas-panel/useCanvasSelectionDerivedState.js";
import { projectResizePointer } from "../../packages/app/src/ui/canvas-panel/resize-constraints.js";
import { resolveTransformInspectorMutationContext } from "../../packages/core/src/edit/property-write-builders.js";

let root: Root | undefined;
let derived: ReturnType<typeof useCanvasSelectionDerivedState>;
function Harness({ args }: { args: UseCanvasSelectionDerivedStateArgs }) {
  derived = useCanvasSelectionDerivedState(args);
  return null;
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

it.each([
  ["rotate=30", ""],
  ["cm={1,.2,.3,1,(1,0)}", ""],
  ["rotate=20,xscale=2,yscale=.8", ""],
  ["rotate=30", "xshift=1cm,scale=2"],
  ["rotate=30", "scale=2,xshift=1cm"]
])("scope handles and edits share the parent frame: %s / %s", async (parentOptions, ownOptions) => {
  const source = String.raw`\begin{tikzpicture}\begin{scope}[` + parentOptions + String.raw`]\begin{scope}[` + ownOptions
    + String.raw`]\draw (1,1) rectangle (3,2);\end{scope}\end{scope}\end{tikzpicture}`;
  const rendered = renderTikzToSvg(source);
  const args: UseCanvasSelectionDerivedStateArgs = {
    snapshot: { source, scene: rendered.semantic.scene, editHandles: rendered.semantic.editHandles,
      parseResult: rendered.parse, semanticResult: rendered.semantic },
    selectedElementIds: new Set(["scope:1"]), collapsedDensePathSourceIds: new Set(), svgResult: rendered.svg,
    canvasTransform: { translateX: 0, translateY: 0, scale: 2 }, marqueeDraft: null,
    toolMode: "select", viewportSize: { width: 800, height: 600 }, ROTATE_HANDLE_OFFSET_PX: 28
  };
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(React.createElement(Harness, { args })));
  const frame = derived.resizeFramesBySource.get("scope:1");
  expect(frame).toBeTruthy();
  if (!frame) throw new Error("Missing scope resize frame");
  const frames = derived.resizeFramesBySource;
  await act(async () => root!.render(React.createElement(Harness, { args: {
    ...args, canvasTransform: { translateX: 20, translateY: 30, scale: 3 }
  } })));
  expect(derived.resizeFramesBySource).toBe(frames);
  const right = worldPoint(pt((frame.cornersByRole["top-right"].world.x + frame.cornersByRole["bottom-right"].world.x) / 2),
    pt((frame.cornersByRole["top-right"].world.y + frame.cornersByRole["bottom-right"].world.y) / 2));
  const fixed = worldPoint(pt((frame.cornersByRole["top-left"].world.x + frame.cornersByRole["bottom-left"].world.x) / 2),
    pt((frame.cornersByRole["top-left"].world.y + frame.cornersByRole["bottom-left"].world.y) / 2));
  const pointerConfig = { initialFrame: frame, movingCornerRole: undefined, role: "right" as const,
    measurementMode: "opposite-corner" as const, preserveAspectDuringResize: false };
  expect(projectResizePointer(pointerConfig, right, false).point.x).toBeCloseTo(right.x, 8);
  expect(projectResizePointer(pointerConfig, right, false).point.y).toBeCloseTo(right.y, 8);
  const geometry = createEditGeometrySession({ source, parsed: rendered.parse, semantic: rendered.semantic });
  const corners = Object.values(frame.cornersByRole).map(corner => corner.world);
  const referenceBounds = worldBounds(pt(Math.min(...corners.map(point => point.x))), pt(Math.min(...corners.map(point => point.y))),
    pt(Math.max(...corners.map(point => point.x))), pt(Math.max(...corners.map(point => point.y))));
  const referenceScopeTransform = resolveTransformInspectorMutationContext(source, "scope:1").values;
  const unchanged = applyEditAction(source, rendered.semantic.editHandles, {
    kind: "resizeElement", elementId: "scope:1", role: "right", newWorld: right, formatPrecision: "snapped", referenceBounds, referenceScopeTransform
  }, { geometry });
  expect(unchanged.kind).not.toBe("error");
  if (unchanged.kind === "success" || unchanged.kind === "partial") {
    expect(unchanged.newSource).toBe(source);
  }
  const target = worldPoint(pt(right.x + (right.x - fixed.x) / 2), pt(right.y + (right.y - fixed.y) / 2));
  const result = applyEditAction(source, rendered.semantic.editHandles, {
    kind: "resizeElement", elementId: "scope:1", role: "right",
    newWorld: projectResizePointer(pointerConfig, target, false).point, formatPrecision: "snapped", referenceBounds, referenceScopeTransform
  }, { geometry });
  expect(result.kind).toBe("success");
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  const next = renderTikzToSvg(result.newSource);
  const nextArgs = { ...args, snapshot: { source: result.newSource, scene: next.semantic.scene,
    editHandles: next.semantic.editHandles, parseResult: next.parse, semanticResult: next.semantic }, svgResult: next.svg };
  await act(async () => root!.render(React.createElement(Harness, { args: nextArgs })));
  const resized = derived.resizeFramesBySource.get("scope:1")!;
  const nextFixed = worldPoint(pt((resized.cornersByRole["top-left"].world.x + resized.cornersByRole["bottom-left"].world.x) / 2),
    pt((resized.cornersByRole["top-left"].world.y + resized.cornersByRole["bottom-left"].world.y) / 2));
  const nextRight = worldPoint(pt((resized.cornersByRole["top-right"].world.x + resized.cornersByRole["bottom-right"].world.x) / 2),
    pt((resized.cornersByRole["top-right"].world.y + resized.cornersByRole["bottom-right"].world.y) / 2));
  expect(nextFixed.x).toBeCloseTo(fixed.x, 6); expect(nextFixed.y).toBeCloseTo(fixed.y, 6);
  expect(nextRight.x).toBeCloseTo(target.x, 6); expect(nextRight.y).toBeCloseTo(target.y, 6);
});
