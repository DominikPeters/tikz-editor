/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { loadSettings } from "../../packages/app/src/settings/storage";
import { useSettingsStore } from "../../packages/app/src/settings/useSettingsStore";
import { DEFAULT_SETTINGS } from "../../packages/app/src/settings/types";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { SettingsModal } from "../../packages/app/src/ui/SettingsModal";

it("opens each real settings page and edits a valid sibling after recovering malformed saved fields", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const originalSettings = useSettingsStore.getState().settings;
  const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value: function (this: HTMLDialogElement) { this.open = true; }
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true, value: function (this: HTMLDialogElement) { this.open = false; }
  });
  const saved = new Map<string, string>();
  saved.set("tikz-editor:settings", JSON.stringify({ settingsVersion: 1, settings: {
    general: { uiFontSizePx: "invalid", colorScheme: "invalid", canvasInvert: true },
    editor: { fontSize: null, indentSize: "invalid", lineNumbers: false },
    canvas: { zoomSpeed: null, gridSize: "invalid", handleSizePx: "invalid" }
  } }));
  setActiveEditorPlatform({ id: "settings-modal-test", persistence: {
    load: key => saved.get(key) ?? null, save: (key, value) => { saved.set(key, value); }
  } });
  useSettingsStore.setState({ settings: loadSettings() });
  const host = document.createElement("div"), root = createRoot(host);
  const category = async (name: string) => {
    const button = host.querySelector<HTMLButtonElement>(`[data-testid="settings-category-${name}"]`)!;
    await act(async () => { button.click(); });
  };
  try {
    await act(async () => { root.render(React.createElement(SettingsModal, { onClose() {} })); });
    await category("general");
    expect(host.querySelector<HTMLSelectElement>("#setting-ui-font-size")!.value).toBe("11");
    expect(host.querySelector<HTMLInputElement>("#setting-canvas-invert")!.checked).toBe(true);
    await category("editor");
    expect(host.querySelector<HTMLSelectElement>("#setting-indent-size")!.value).toBe("2");
    expect(host.querySelector<HTMLInputElement>("#setting-line-numbers")!.checked).toBe(false);
    await category("canvas");
    const zoom = host.querySelector<HTMLInputElement>("#setting-zoom-speed")!;
    expect(zoom.value).toBe(String(DEFAULT_SETTINGS.canvas.zoomSpeed));
    expect(host.textContent).toContain("Slow ↔ Fast (0.0045)");
    const grid = host.querySelector<HTMLSelectElement>("#setting-grid-size")!;
    await act(async () => { grid.value = "coarse"; grid.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(loadSettings().canvas.gridSize).toBe("coarse");
    expect(loadSettings().general.canvasInvert).toBe(true);
  } finally {
    await act(async () => { root.unmount(); });
    useSettingsStore.setState({ settings: originalSettings });
    if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
