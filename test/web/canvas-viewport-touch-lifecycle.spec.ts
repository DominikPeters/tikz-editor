/** @vitest-environment jsdom */
import React, { act, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasViewportPersistence } from "../../packages/app/src/ui/canvas-panel/useCanvasViewportPersistence";
import { useCanvasViewportEffects } from "../../packages/app/src/ui/canvas-panel/useCanvasViewportEffects";
import type { CanvasTransform } from "../../packages/app/src/store/types";
import type { CanvasSnapshot } from "../../packages/app/src/ui/canvas-panel/types";

let root: Root;
let viewport: HTMLDivElement;
let api: { transform: CanvasTransform; fit: boolean; setManual: (t: CanvasTransform) => void;
  setInput: React.Dispatch<React.SetStateAction<{ rootId: string; svg: CanvasSnapshot["svg"] }>>; replaceSurface: (next: HTMLDivElement) => void };
const firstSvg = { viewBox: { x: -14, y: -14, width: 28, height: 28 } } as CanvasSnapshot["svg"];
const secondSvg = { viewBox: { x: -228, y: -143, width: 456, height: 286 } } as CanvasSnapshot["svg"];
const noop = () => {};
const tabOrder = ["doc"];

function Harness() {
  const [input, setInput] = useState({ rootId: "figure:0", svg: firstSvg });
  const [transform, setTransform] = useState({ translateX: 0, translateY: 0, scale: 1 });
  const [fit, setFit] = useState(true);
  const transformRef = useRef(transform), fitRef = useRef(fit), svgRef = useRef(input.svg);
  const previousViewBoxRef = useRef(null), viewportRef = useRef(viewport), dragRef = useRef(null), pendingTouchRef = useRef(null);
  // These callbacks/ref refreshes have the same identity policy and order as CanvasPanel.
  const dispatchTransform = useCallback((next: CanvasTransform) => {
    if (Math.abs(transform.translateX - next.translateX) < 1e-9 && Math.abs(transform.translateY - next.translateY) < 1e-9 && Math.abs(transform.scale - next.scale) < 1e-9) return;
    setTransform(next);
  }, [transform.scale, transform.translateX, transform.translateY]);
  const setFitMode = useCallback((next: boolean) => { fitRef.current = next; setFit(next); }, []);
  useLayoutEffect(() => { transformRef.current = transform; fitRef.current = fit; svgRef.current = input.svg; });
  useCanvasViewportPersistence({ baseSvgResult: input.svg, svgResult: input.svg, viewportSize: { width: 800, height: 600 },
    dispatch: noop, dispatchCanvasTransform: dispatchTransform, activeDocumentId: "doc", activeRootId: input.rootId, tabOrder,
    canvasTransform: transform, fitToContentModeActive: fit, fitToContentModeActiveRef: fitRef, setFitToContentModeActive: setFitMode,
    viewportRef, canvasTransformRef: transformRef, fitToContentRequestToken: 0, zoomRequestToken: 0, zoomRequestDirection: null,
    zoomScaleRequestToken: 0, zoomScaleRequestValue: null, activeCanvasDragKind: null, activeSourceScrubSourceId: null,
    snapshotSource: "same-source", source: "same-source", lastEditChangeToken: 0, MIN_SCALE: .001, MAX_SCALE: 4 });
  useCanvasViewportEffects({ canvasContextKey: input.rootId, dragRef, pendingTouchViewportRef: pendingTouchRef, setDragState: noop, setToolDraft: noop,
    setToolCursorWorld: noop, viewportRef, setViewportSize: noop, canvasTransformRef: transformRef, svgResult: input.svg,
    svgResultRef: svgRef, fitToContentModeActiveRef: fitRef, previousViewBoxRef,
    dispatchCanvasTransform: dispatchTransform, zoomSpeed: .001, MIN_SCALE: .001, MAX_SCALE: 4, setFitToContentModeActive: setFitMode });
  api = { transform, fit, setManual: next => { setFitMode(false); setTransform(next); }, setInput, replaceSurface: next => { viewportRef.current = next; setInput(input => ({ ...input })); } };
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  viewport = document.createElement("div");
  Object.defineProperties(viewport, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
  document.body.appendChild(viewport);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(React.createElement(Harness)));
});
afterEach(async () => { await act(async () => root.unmount()); viewport.remove(); vi.unstubAllGlobals(); });

it("preserves each figure's manual scale through asynchronous root/SVG switches", async () => {
  const first = { translateX: 130, translateY: 70, scale: 1.8 };
  const second = { translateX: 25, translateY: 48, scale: .82 };
  await act(async () => api.setManual(first));
  await act(async () => api.setInput(input => ({ ...input, rootId: "figure:1" })));
  await act(async () => api.setInput(input => ({ ...input, svg: secondSvg })));
  await act(async () => api.setManual(second));
  await act(async () => api.setInput(input => ({ ...input, rootId: "figure:0" })));
  await act(async () => api.setInput(input => ({ ...input, svg: firstSvg })));
  expect(api.transform.scale).toBe(first.scale);
  await act(async () => api.setInput(input => ({ ...input, rootId: "figure:1" })));
  await act(async () => api.setInput(input => ({ ...input, svg: secondSvg })));
  expect(api.transform.scale).toBe(second.scale);
});

it("fits a newly seen figure and keeps a manual viewport after later content geometry changes", async () => {
  expect(api.fit).toBe(true);
  expect(api.transform.scale).toBe(4); // Small initial picture reaches the configured maximum.
  await act(async () => api.setInput({ rootId: "figure:1", svg: secondSvg }));
  expect(api.fit).toBe(true);
  expect(api.transform.scale).toBeCloseTo(Math.min((800 - 88) / 456, (600 - 88) / 286));
  await act(async () => api.setManual({ translateX: 10, translateY: 20, scale: 1 }));
  await act(async () => api.setInput({ rootId: "figure:1", svg: firstSvg }));
  expect(api.fit).toBe(false);
  expect(api.transform).toEqual({ translateX: 224, translateY: 149, scale: 1 });
});

function touch(type: string, pointerId: number, x: number) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerType: "touch", pointerId, clientX: x, clientY: 100 });
  (type === "pointerdown" ? viewport : window).dispatchEvent(event);
}

it("continues pinch scaling through multiple moves after React applies the first transform", async () => {
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => { touch("pointerdown", 1, 100); touch("pointerdown", 2, 200); });
  await act(async () => touch("pointermove", 2, 250));
  expect(api.transform.scale).toBeCloseTo(1.5);
  await act(async () => touch("pointermove", 2, 300));
  expect(api.transform.scale).toBeCloseTo(2);
});

it("clears touch inventory on blur so a fresh finger cannot pair with a cancelled old finger", async () => {
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => touch("pointerdown", 1, 100));
  await act(async () => window.dispatchEvent(new Event("blur")));
  await act(async () => { touch("pointerdown", 2, 200); touch("pointermove", 2, 250); });
  expect(api.transform.scale).toBe(1);
});


it("reanchors when a released finger is replaced during a three-finger gesture", async () => {
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => { touch("pointerdown", 1, 100); touch("pointerdown", 2, 200); });
  await act(async () => touch("pointermove", 2, 250));
  await act(async () => { touch("pointerdown", 3, 350); touch("pointerup", 1, 100); });
  await act(async () => touch("pointermove", 3, 450));
  expect(api.transform.scale).toBeCloseTo(3);
  await act(async () => touch("pointermove", 3, 1050));
  expect(api.transform.scale).toBe(4);
});

it("ignores unrelated cancellation and clears all pointers on an owned cancellation", async () => {
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => { touch("pointerdown", 1, 100); touch("pointerdown", 2, 200); });
  await act(async () => { touch("pointercancel", 99, 200); touch("pointermove", 2, 250); });
  expect(api.transform.scale).toBeCloseTo(1.5);
  await act(async () => touch("pointercancel", 1, 100));
  await act(async () => { touch("pointerdown", 3, 200); touch("pointermove", 3, 350); });
  expect(api.transform.scale).toBeCloseTo(1.5);
});

it("does not retain old touches across root changes", async () => {
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => touch("pointerdown", 1, 100));
  await act(async () => api.setInput(input => ({ ...input, rootId: "figure:1" })));
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => { touch("pointerdown", 2, 200); touch("pointermove", 2, 350); });
  expect(api.transform.scale).toBe(1);
});

it("does not retain old touches when the interaction surface is replaced", async () => {
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => touch("pointerdown", 1, 100));
  const oldSurface = viewport;
  viewport = oldSurface.cloneNode() as HTMLDivElement;
  viewport.getBoundingClientRect = oldSurface.getBoundingClientRect;
  document.body.appendChild(viewport);
  await act(async () => api.replaceSurface(viewport));
  await act(async () => { touch("pointerdown", 2, 200); touch("pointermove", 2, 350); });
  expect(api.transform.scale).toBe(1);
  oldSurface.remove();
});

it("removes touch listeners on unmount", async () => {
  await act(async () => api.setManual({ translateX: 0, translateY: 0, scale: 1 }));
  await act(async () => { touch("pointerdown", 1, 100); touch("pointerdown", 2, 200); });
  await act(async () => root.unmount());
  touch("pointermove", 2, 300);
  expect(api.transform.scale).toBe(1);
});
