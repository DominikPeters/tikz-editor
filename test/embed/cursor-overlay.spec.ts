/** @vitest-environment jsdom */

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CursorOverlay } from "../../packages/app/src/embed/CursorOverlay";

describe("CursorOverlay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("applies transform, visibility, and pressed styling from cursor frame state", async () => {
    await act(async () => {
      root.render(
        React.createElement(CursorOverlay, {
          x: 10,
          y: 20,
          visible: true,
          pressed: false
        })
      );
    });

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    if (!svg) {
      throw new Error("Expected cursor svg");
    }
    expect(svg.style.transform).toContain("translate(10px, 20px)");
    expect(svg.style.opacity).toBe("1");
    expect(svg.style.pointerEvents).toBe("none");
    expect(svg.style.filter).toContain("0 1px 1px");

    await act(async () => {
      root.render(
        React.createElement(CursorOverlay, {
          x: 30,
          y: 40,
          visible: false,
          pressed: true
        })
      );
    });

    expect(svg.style.transform).toContain("translate(30px, 40px)");
    expect(svg.style.opacity).toBe("0");
    expect(svg.style.filter).toContain("0 0 3px");
  });
});
