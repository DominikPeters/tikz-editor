/** @vitest-environment jsdom */
import React, { act, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CanvasTransform } from "../../packages/app/src/store/types";
import type { CanvasSnapshot } from "../../packages/app/src/ui/canvas-panel/types";
import { useCanvasViewportPersistence } from "../../packages/app/src/ui/canvas-panel/useCanvasViewportPersistence";
import { useCanvasViewportEffects } from "../../packages/app/src/ui/canvas-panel/useCanvasViewportEffects";
import { expandSvgViewBox } from "../../packages/app/src/ui/canvas-panel/viewport-view-box";
import { rootKey } from "../../packages/app/src/root-key";

const firstSvg = { viewBox: { x: -14, y: -14, width: 28, height: 28 } } as NonNullable<CanvasSnapshot["svg"]>;
const secondSvg = { viewBox: { x: -228, y: -143, width: 456, height: 286 } } as NonNullable<CanvasSnapshot["svg"]>;
const firstManual = { translateX: 130, translateY: 70, scale: 1.8 };
const secondManual = { translateX: 25, translateY: 48, scale: .82 };
const noop = () => {};
type Input = { documentId: string; rootId: string; snapshotRootId: string; svg: CanvasSnapshot["svg"]; infinite: boolean;
  tabOrder: string[]; source: string; snapshotSource: string; width: number; height: number; fitPadding?: number };
let root: Root, host: HTMLDivElement, viewport: HTMLDivElement;
let api: { transform: CanvasTransform; fit: boolean; input: Input; manual: (next: CanvasTransform) => void;
  setInput: React.Dispatch<React.SetStateAction<Input>>; fitRequest: () => void; zoom: () => void; zoomScale: () => void };
const writes: Array<{ root: string; snapshotRoot: string; fit: boolean; transform: CanvasTransform; stack: string }> = [];

function Harness() {
  const [input, setInput] = useState<Input>({ documentId: "doc", rootId: "figure:0", snapshotRootId: "figure:0", svg: firstSvg,
    infinite: true, tabOrder: ["doc"], source: "source", snapshotSource: "source", width: 800, height: 600 });
  const [transform, setTransform] = useState({ translateX: 0, translateY: 0, scale: 1 });
  const [fit, setFit] = useState(true);
  const [fitToken, setFitToken] = useState(0), [zoomToken, setZoomToken] = useState(0), [zoomScaleToken, setZoomScaleToken] = useState(0);
  const svg = useMemo(() => input.svg && input.infinite
    ? { ...input.svg, viewBox: expandSvgViewBox(input.svg.viewBox, { width: input.width, height: input.height }, transform.scale) }
    : input.svg, [input, transform.scale]);
  const transformRef = useRef(transform), fitRef = useRef(fit), svgRef = useRef(svg), viewportRef = useRef(viewport);
  const previousViewBoxRef = useRef(null), dragRef = useRef(null), pendingTouchRef = useRef(null);
  // Match CanvasPanel: callback closes over the current render; layout refresh
  // precedes persistence, and compensation is registered after persistence.
  const dispatchTransform = useCallback((next: CanvasTransform) => {
    if (Math.abs(transform.translateX - next.translateX) < 1e-9 && Math.abs(transform.translateY - next.translateY) < 1e-9 && Math.abs(transform.scale - next.scale) < 1e-9) return;
    writes.push({ root: input.rootId, snapshotRoot: input.snapshotRootId, fit: fitRef.current, transform: next, stack: new Error().stack ?? "" });
    setTransform(next);
  }, [input.rootId, input.snapshotRootId, transform.scale, transform.translateX, transform.translateY]);
  const setFitMode = useCallback((next: boolean) => { fitRef.current = next; setFit(next); }, []);
  useLayoutEffect(() => { transformRef.current = transform; fitRef.current = fit; svgRef.current = svg; });
  const { viewportStateReadyRef } = useCanvasViewportPersistence({ baseSvgResult: input.svg, svgResult: svg, viewportSize: { width: input.width, height: input.height },
    fitPadding: input.fitPadding,
    dispatch: noop, dispatchCanvasTransform: dispatchTransform, activeDocumentId: input.documentId, activeRootId: input.rootId,
    snapshotActiveRootId: input.snapshotRootId,
    tabOrder: input.tabOrder, canvasTransform: transform, fitToContentModeActive: fit, fitToContentModeActiveRef: fitRef,
    setFitToContentModeActive: setFitMode, viewportRef, canvasTransformRef: transformRef, fitToContentRequestToken: fitToken,
    zoomRequestToken: zoomToken, zoomRequestDirection: "in", zoomScaleRequestToken: zoomScaleToken, zoomScaleRequestValue: .82,
    activeCanvasDragKind: null, activeSourceScrubSourceId: null, snapshotSource: input.snapshotSource, source: input.source,
    lastEditChangeToken: 0, MIN_SCALE: .001, MAX_SCALE: 4 });
  useCanvasViewportEffects({ canvasContextKey: rootKey(input.documentId, input.rootId), viewportStateReadyRef, dragRef, pendingTouchViewportRef: pendingTouchRef,
    setDragState: noop, setToolDraft: noop, setToolCursorWorld: noop, viewportRef, setViewportSize: noop, canvasTransformRef: transformRef,
    svgResult: svg, svgResultRef: svgRef, fitToContentModeActiveRef: fitRef, previousViewBoxRef, dispatchCanvasTransform: dispatchTransform,
    zoomSpeed: .001, MIN_SCALE: .001, MAX_SCALE: 4, setFitToContentModeActive: setFitMode });
  api = { transform, fit, input, manual: next => { setFitMode(false); setTransform(next); }, setInput,
    fitRequest: () => setFitToken(value => value + 1), zoom: () => setZoomToken(value => value + 1), zoomScale: () => setZoomScaleToken(value => value + 1) };
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  writes.length = 0;
  viewport = document.createElement("div");
  Object.defineProperties(viewport, { clientWidth: { get: () => api?.input.width ?? 800 }, clientHeight: { get: () => api?.input.height ?? 600 } });
  viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} });
  host = document.createElement("div"); document.body.append(viewport, host); root = createRoot(host);
  await act(async () => { root.render(React.createElement(Harness)); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); viewport.remove(); host.remove(); vi.unstubAllGlobals(); });

async function manual(next: CanvasTransform) {
  // Like the unchanged Chrome test, settle after expansion responds to scale.
  for (let index = 0; index < 3; index += 1) await act(async () => { api.manual(next); });
  expect(api.transform).toEqual(next);
  expect(api.fit).toBe(false);
}
async function select(rootId: string, svg: CanvasSnapshot["svg"], asynchronous = true) {
  if (asynchronous) await act(async () => { api.setInput(input => ({ ...input, rootId })); });
  await act(async () => { api.setInput(input => ({ ...input, rootId, snapshotRootId: rootId, svg })); });
}

it("restores the entire manual transform and fit mode with delayed SVG and expanded viewBoxes", async () => {
  await manual(firstManual);
  await select("figure:1", secondSvg);
  await manual(secondManual);
  writes.length = 0;
  await select("figure:0", firstSvg);
  expect(api.fit).toBe(false);
  expect(api.transform, JSON.stringify(writes.map(write => ({ ...write, stack: write.stack.split("\n").filter(line => line.includes("useCanvasViewport")) })), null, 2)).toEqual(firstManual);
  await select("figure:1", secondSvg);
  expect(api.fit).toBe(false);
  expect(api.transform).toEqual(secondManual);
});

function expectFit(base: NonNullable<CanvasSnapshot["svg"]>, padding = 44) {
  const expectedScale = Math.min(4, (api.input.width - padding * 2) / base.viewBox.width, (api.input.height - padding * 2) / base.viewBox.height);
  expect(api.fit).toBe(true);
  expect(api.transform.scale).toBeCloseTo(expectedScale);
  const rendered = api.input.infinite ? expandSvgViewBox(base.viewBox, { width: api.input.width, height: api.input.height }, api.transform.scale) : base.viewBox;
  // The base content is centered in the viewport even when the rendered box expands.
  expect(api.transform.translateX + (base.viewBox.x - rendered.x) * api.transform.scale).toBeCloseTo((api.input.width - base.viewBox.width * api.transform.scale) / 2);
  expect(api.transform.translateY + (base.viewBox.y - rendered.y) * api.transform.scale).toBeCloseTo((api.input.height - base.viewBox.height * api.transform.scale) / 2);
}

it("fits slide pages with smaller margins on first visit, explicit fit, and resize", async () => {
  await act(async () => {
    api.setInput(input => ({ ...input, rootId: "frame:0", snapshotRootId: "frame:0", svg: secondSvg, infinite: false, fitPadding: 12 }));
  });
  expectFit(secondSvg, 12);
  await manual(secondManual);
  await act(async () => { api.fitRequest(); });
  expectFit(secondSvg, 12);
  await act(async () => { api.setInput(input => ({ ...input, width: 900, height: 500 })); });
  expectFit(secondSvg, 12);
});

it.each([true, false])("restores exact saved states through repeated simultaneous root/SVG switches with infinite canvas %s", async infinite => {
  await act(async () => { api.setInput(input => ({ ...input, infinite })); });
  await manual(firstManual);
  await select("figure:1", secondSvg, false); await manual(secondManual);
  for (let count = 0; count < 5; count += 1) {
    await select("figure:0", firstSvg, false); expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(false);
    await select("figure:1", secondSvg, false); expect(api.transform).toEqual(secondManual); expect(api.fit).toBe(false);
  }
});

it("retains each figure's fit/manual mode rather than saving passive old-render mode", async () => {
  await manual(firstManual);
  await select("figure:1", secondSvg); expectFit(secondSvg);
  await select("figure:0", firstSvg); expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(false);
  await select("figure:1", secondSvg); expectFit(secondSvg);
  await manual(secondManual);
  await select("figure:0", firstSvg); await act(async () => { api.fitRequest(); }); expectFit(firstSvg);
  await select("figure:1", secondSvg); expect(api.transform).toEqual(secondManual); expect(api.fit).toBe(false);
  await select("figure:0", firstSvg); expectFit(firstSvg);
});

it("waits for the selected root before a first-visit fit", async () => {
  await manual(firstManual); writes.length = 0;
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1" })); });
  expect(writes).toEqual([]); expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(true);
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); });
  expectFit(secondSvg);
});

it("waits for both the root and current document source before fitting", async () => {
  await manual(firstManual); writes.length = 0;
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1", snapshotRootId: "figure:1", source: "new-source", svg: secondSvg })); });
  expect(writes).toEqual([]); expect(api.transform).toEqual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, snapshotSource: "new-source" })); });
  expectFit(secondSvg);
});

it("fits a delayed first visit after the viewport becomes measurable", async () => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1", snapshotRootId: "figure:1", svg: secondSvg, width: 0, height: 0 })); });
  expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(true);
  await act(async () => { api.setInput(input => ({ ...input, width: 800, height: 600 })); });
  expectFit(secondSvg);
});

it.each([null, firstSvg])("lets manual interaction take over a delayed first visit with initial SVG %j", async svg => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1", svg })); });
  await manual(secondManual);
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); });
  expect(api.transform).toEqual(secondManual); expect(api.fit).toBe(false);
  await select("figure:0", firstSvg); expect(api.transform).toEqual(firstManual);
  await select("figure:1", secondSvg); expect(api.transform).toEqual(secondManual); expect(api.fit).toBe(false);
});

it("honors zoom takeover while waiting and does not auto-fit when the new SVG arrives", async () => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1" })); });
  await act(async () => { api.zoom(); });
  const zoomed = api.transform;
  expect(zoomed.scale).toBeCloseTo(firstManual.scale * 1.15); expect(api.fit).toBe(false);
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); });
  expect(api.transform).toEqual(zoomed); expect(api.fit).toBe(false);
});

it("defers an explicit fit request until the selected SVG arrives after manual takeover", async () => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1" })); });
  await manual(secondManual);
  await act(async () => { api.fitRequest(); });
  expect(api.transform).toEqual(secondManual);
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); });
  expectFit(secondSvg);
});

it("ignores stale arriving roots during rapid first-visit switches without inventing saved states", async () => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1" })); });
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:2" })); });
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); });
  expect(api.transform).toEqual(firstManual);
  await select("figure:0", firstSvg); expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(false);
  await select("figure:1", secondSvg); expectFit(secondSvg);
});

it("does not overwrite a visited root when rapidly returning before its matching snapshot", async () => {
  await manual(firstManual); await select("figure:1", secondSvg); await manual(secondManual); await select("figure:0", firstSvg);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1" })); });
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:0" })); });
  expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(false);
  await select("figure:1", secondSvg); expect(api.transform).toEqual(secondManual); expect(api.fit).toBe(false);
});

it("keeps viewport ownership separate for documents with the same root and delayed different sources", async () => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, documentId: "other", source: "other-source", tabOrder: ["doc", "other"] })); });
  expect(api.transform).toEqual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, snapshotSource: "other-source", svg: secondSvg })); }); expectFit(secondSvg);
  await manual(secondManual);
  await act(async () => { api.setInput(input => ({ ...input, documentId: "doc", source: "source" })); });
  expect(api.transform).toEqual(secondManual);
  await act(async () => { api.setInput(input => ({ ...input, snapshotSource: "source", svg: firstSvg })); });
  expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(false);
  await act(async () => { api.setInput(input => ({ ...input, documentId: "other", source: "other-source", snapshotSource: "other-source", svg: secondSvg })); });
  expect(api.transform).toEqual(secondManual); expect(api.fit).toBe(false);
});

it("separates document viewport memory even when source and root IDs are identical", async () => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, documentId: "other", svg: secondSvg, tabOrder: ["doc", "other"] })); });
  await manual(secondManual);
  await act(async () => { api.setInput(input => ({ ...input, documentId: "doc", svg: firstSvg })); });
  expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(false);
  await act(async () => { api.setInput(input => ({ ...input, documentId: "other", svg: secondSvg })); });
  expect(api.transform).toEqual(secondManual); expect(api.fit).toBe(false);
});

it("discards viewport memory when a document closes", async () => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, documentId: "other", svg: secondSvg, tabOrder: ["doc", "other"] })); });
  await manual(secondManual);
  await act(async () => { api.setInput(input => ({ ...input, tabOrder: ["other"] })); });
  await act(async () => { api.setInput(input => ({ ...input, documentId: "doc", svg: firstSvg, tabOrder: ["other", "doc"] })); });
  expectFit(firstSvg);
});

it("disposes saved states on unmount so a new canvas starts in fit mode", async () => {
  await manual(firstManual);
  await act(async () => { root.render(null); });
  await act(async () => { root.render(React.createElement(Harness)); });
  expectFit(firstSvg);
});

it.each([true, false])("retains same-root manual content compensation with infinite canvas %s", async infinite => {
  await act(async () => { api.setInput(input => ({ ...input, infinite })); });
  await manual({ translateX: 10, translateY: 20, scale: 1 });
  await act(async () => { api.setInput(input => ({ ...input, source: "edited" })); });
  expect(api.transform).toEqual({ translateX: 10, translateY: 20, scale: 1 });
  await act(async () => { api.setInput(input => ({ ...input, snapshotSource: "edited", svg: secondSvg })); });
  expect(api.transform).toEqual({ translateX: -204, translateY: -109, scale: 1 }); expect(api.fit).toBe(false);
});

it("keeps automatic fit mode after matching same-root content changes", async () => {
  expectFit(firstSvg);
  await act(async () => { api.setInput(input => ({ ...input, source: "edited" })); });
  await act(async () => { api.setInput(input => ({ ...input, snapshotSource: "edited", svg: secondSvg })); });
  expectFit(secondSvg);
});

it.each(["wheel", "pinch"] as const)("lets a fresh %s gesture replace a visited manual viewport while its SVG is pending", async gesture => {
  await manual(firstManual); await select("figure:1", secondSvg); await manual(secondManual); await select("figure:0", firstSvg);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1" })); });
  await act(async () => {
    if (gesture === "wheel") viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 300, cancelable: true }));
    else {
      const touch = (type: string, pointerId: number, clientX: number) => {
        const event = new Event(type, { cancelable: true }); Object.assign(event, { pointerType: "touch", pointerId, clientX, clientY: 100 });
        (type === "pointerdown" ? viewport : window).dispatchEvent(event);
      };
      touch("pointerdown", 1, 100); touch("pointerdown", 2, 200); touch("pointermove", 2, 250);
    }
  });
  const newer = api.transform;
  expect(newer.scale).not.toBe(firstManual.scale); expect(api.fit).toBe(false);
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); });
  expect(api.transform).toEqual(newer); expect(api.fit).toBe(false);
  await select("figure:0", firstSvg); expect(api.transform).toEqual(firstManual);
  await select("figure:1", secondSvg); expect(api.transform).toEqual(newer); expect(api.fit).toBe(false);
});

it("applies a queued fit to a visited manual root after restoration commits", async () => {
  await manual(firstManual); await select("figure:1", secondSvg); await manual(secondManual); await select("figure:0", firstSvg);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1" })); });
  await act(async () => { api.fitRequest(); });
  expect(api.transform).toEqual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); }); expectFit(secondSvg);
  await select("figure:0", firstSvg); expect(api.transform).toEqual(firstManual);
  await select("figure:1", secondSvg); expectFit(secondSvg);
});

it.each(["zoom", "zoomScale"] as const)("defers an explicit %s request when SVG is absent instead of consuming it", async request => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1", svg: null })); });
  await act(async () => { api[request](); });
  expect(api.transform).toEqual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, snapshotRootId: "figure:1", svg: secondSvg })); });
  const fittedScale = Math.min((800 - 88) / 456, (600 - 88) / 286);
  expect(api.transform.scale).toBeCloseTo(request === "zoom" ? fittedScale * 1.15 : .82); expect(api.fit).toBe(false);
  const applied = api.transform;
  await select("figure:0", firstSvg); await select("figure:1", secondSvg);
  expect(api.transform).toEqual(applied); expect(api.fit).toBe(false);
});

it.each(["fitRequest", "zoom", "zoomScale"] as const)("retires a deferred %s request when its figure changes", async request => {
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1", svg: null })); });
  await act(async () => { api[request](); });
  await select("figure:0", firstSvg);
  expect(api.transform).toEqual(firstManual); expect(api.fit).toBe(false);
  await select("figure:1", secondSvg); expectFit(secondSvg);
});

it("fits a delayed measured viewport with document bounds shown", async () => {
  await act(async () => { api.setInput(input => ({ ...input, infinite: false })); }); await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, rootId: "figure:1", snapshotRootId: "figure:1", svg: secondSvg, width: 0, height: 0 })); });
  await act(async () => { api.fitRequest(); });
  expect(api.transform).toEqual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, width: 800, height: 600 })); }); expectFit(secondSvg);
});

it.each(["zoom", "zoomScale"] as const)("waits for both viewport dimensions before applying %s around the measured center once", async request => {
  await act(async () => { api.setInput(input => ({ ...input, infinite: false })); });
  await manual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, width: 0, height: 0 })); });
  await act(async () => { api[request](); });
  expect(api.transform).toEqual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, width: 800 })); });
  expect(api.transform).toEqual(firstManual);
  await act(async () => { api.setInput(input => ({ ...input, height: 600 })); });
  const scale = request === "zoom" ? firstManual.scale * 1.15 : .82;
  expect(api.transform.scale).toBeCloseTo(scale);
  expect(api.transform.translateX).toBeCloseTo(400 - (400 - firstManual.translateX) * scale / firstManual.scale);
  expect(api.transform.translateY).toBeCloseTo(300 - (300 - firstManual.translateY) * scale / firstManual.scale);
  expect(api.fit).toBe(false);
  const applied = api.transform;
  await act(async () => { api.setInput(input => ({ ...input, width: 900, height: 700 })); });
  expect(api.transform).toEqual(applied);
});
