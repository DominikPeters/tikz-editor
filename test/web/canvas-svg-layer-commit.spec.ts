/** @vitest-environment jsdom */
import React, { act, useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CanvasSVGLayer } from "../../packages/app/src/ui/canvas-panel/CanvasSVGLayer";
import type { SvgRenderModel } from "../../packages/core/src/svg/types";

afterEach(() => vi.unstubAllGlobals());

it("installs the new slide SVG before its parent measures the committed canvas", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  const seenDuringLayout: string[] = [];
  const onFallback = vi.fn();
  const model = (name: string): SvgRenderModel => ({
    viewBox: { x: 0, y: 0, width: 100, height: 100 }, defs: [], defsFingerprint: "", diagnostics: [],
    parts: [{ partId: name, sourceId: name, elementId: null, order: 0,
      markup: `<g><text>${name}</text></g>`, fingerprint: name }]
  });
  function Harness({ value }: { value: SvgRenderModel }) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => { seenDuringLayout.push(hostRef.current?.querySelector("text")?.textContent ?? "missing"); }, [value]);
    return React.createElement(CanvasSVGLayer, { model: value, forceReplaceAll: false, showTransparencyGrid: false,
      showDocumentBounds: true, onFallback, hostRef });
  }
  act(() => { root.render(React.createElement(Harness, { value: model("first") })); });
  act(() => { root.render(React.createElement(Harness, { value: model("second") })); });
  expect(seenDuringLayout).toEqual(["first", "second"]);
  act(() => { root.unmount(); });
});
