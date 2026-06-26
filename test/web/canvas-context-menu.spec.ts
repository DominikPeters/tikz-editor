/** @vitest-environment jsdom */

import React, { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP_MENU_COMMAND_IDS } from "../../packages/app/src/app-menu/index.js";
import { buildCanvasContextMenuDefinition } from "../../packages/app/src/context-menu/index.js";
import { CanvasContextMenu } from "../../packages/app/src/ui/CanvasContextMenu.js";
import type { CommandBindings } from "../../packages/app/src/ui/editor-command-runtime.js";

describe("CanvasContextMenu", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 600 });
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  it("hides Flatten foreach when the menu definition omits it", () => {
    const bindings = makeBindings();
    bindings[APP_MENU_COMMAND_IDS.FLATTEN_FOREACH] = {
      enabled: true,
      run: () => undefined
    };

    renderMenu(bindings, false);

    expect(document.body.textContent).not.toContain("Flatten foreach");
    expect(document.body.querySelector(`[data-testid="canvas-context-cmd-${APP_MENU_COMMAND_IDS.FLATTEN_FOREACH}"]`)).toBeNull();
  });

  it("shows Flatten foreach when the menu definition includes it", () => {
    const bindings = makeBindings();
    bindings[APP_MENU_COMMAND_IDS.FLATTEN_FOREACH] = {
      enabled: true,
      run: () => undefined
    };

    renderMenu(bindings, true);

    expect(document.body.textContent).toContain("Flatten foreach");
    expect(document.body.querySelector(`[data-testid="canvas-context-cmd-${APP_MENU_COMMAND_IDS.FLATTEN_FOREACH}"]`)).not.toBeNull();
  });

  it("positions the portaled menu in viewport coordinates", () => {
    host.getBoundingClientRect = vi.fn(() => ({
      x: 100,
      y: 50,
      top: 50,
      right: 900,
      bottom: 650,
      left: 100,
      width: 800,
      height: 600,
      toJSON: () => ({})
    }) as DOMRect);

    renderMenu(makeBindings(), false);

    const menu = document.body.querySelector<HTMLElement>("[data-testid='canvas-context-menu']");
    expect(menu?.style.left).toBe("120px");
    expect(menu?.style.top).toBe("70px");
  });

  it("carries app UI scale variables into the portaled menu", () => {
    host.style.setProperty("--app-ui-font-size", "13px");
    host.style.setProperty("--app-ui-scale", "1.1818");

    renderMenu(makeBindings(), false);

    const menu = document.body.querySelector<HTMLElement>("[data-testid='canvas-context-menu']");
    expect(menu?.style.getPropertyValue("--app-ui-font-size")).toBe("13px");
    expect(menu?.style.getPropertyValue("--app-ui-scale")).toBe("1.1818");
  });

  function renderMenu(bindings: CommandBindings, includeFlattenForeach: boolean): void {
    const containerRef = createRef<HTMLElement | null>();
    containerRef.current = host;
    act(() => {
      root.render(
        React.createElement(CanvasContextMenu, {
          open: true,
          anchor: { x: 20, y: 20 },
          target: "selection-single",
          bindings,
          onClose: () => undefined,
          onCommandRun: () => undefined,
          containerRef,
          definition: buildCanvasContextMenuDefinition({ includeFlattenForeach })
        })
      );
    });
  }
});

function makeBindings(): CommandBindings {
  return Object.fromEntries(
    Object.values(APP_MENU_COMMAND_IDS).map((commandId) => [
      commandId,
      {
        enabled: true,
        run: () => undefined
      }
    ])
  ) as unknown as CommandBindings;
}
