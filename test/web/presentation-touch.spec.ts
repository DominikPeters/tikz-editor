/** @vitest-environment jsdom */

import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useAudienceTouchGestures, type AudienceTouchHandlers } from "../../packages/app/src/presentation/touch.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(handlers: AudienceTouchHandlers): HTMLElement {
  function Audience() {
    const root = useRef<HTMLElement | null>(null);
    const ref = useRef<AudienceTouchHandlers | null>(handlers);
    useAudienceTouchGestures(root, ref);
    return createElement("main", { ref: root });
  }
  const container = document.createElement("div");
  document.body.append(container);
  act(() => { createRoot(container).render(createElement(Audience)); });
  const element = container.querySelector("main");
  if (!element) throw new Error("not mounted");
  return element;
}

function tap(element: HTMLElement, x: number, y: number): void {
  for (const type of ["pointerdown", "pointerup"]) {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.assign(event, { pointerId: 1, pointerType: "touch" });
    element.dispatchEvent(event);
  }
}

describe("audience taps", () => {
  // A 4:3 slide letterboxed on a wide screen: x 100..900.
  const slide = new DOMRect(100, 0, 800, 600);

  it("goes back on the slide's left quarter, forward elsewhere, and shows the controls off the slide", () => {
    const handlers = { next: vi.fn(), previous: vi.fn(), end: vi.fn(), showControls: vi.fn(), slideRect: () => slide };
    const element = mount(handlers);
    tap(element, 150, 300);
    expect(handlers.previous).toHaveBeenCalledTimes(1);
    tap(element, 500, 300);
    expect(handlers.next).toHaveBeenCalledTimes(1);
    tap(element, 50, 300);
    tap(element, 950, 300);
    expect(handlers.showControls).toHaveBeenCalledTimes(2);
    expect(handlers.next).toHaveBeenCalledTimes(1);
    expect(handlers.previous).toHaveBeenCalledTimes(1);
  });
});
