/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResolvedColorScheme } from "../../packages/app/src/settings/useResolvedColorScheme";
import { useSettingsStore } from "../../packages/app/src/settings/useSettingsStore";
import { DEFAULT_SETTINGS } from "../../packages/app/src/settings/types";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current";

describe("resolved color scheme", () => {
  let dark: boolean;
  let host: HTMLDivElement;
  let root: Root;
  let originalSettings: typeof DEFAULT_SETTINGS;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  function Theme() { return React.createElement("span", null, useResolvedColorScheme()); }
  const render = async () => { await act(async () => { root.render(React.createElement(Theme)); }); };
  const choose = async (colorScheme: "light" | "dark" | "system") => {
    await act(async () => { useSettingsStore.getState().updateGeneralSettings({ colorScheme }); });
  };
  const changeOS = async (matches: boolean) => {
    dark = matches;
    await act(async () => { for (const listener of listeners) listener({ matches }); });
  };

  beforeEach(() => {
    originalSettings = useSettingsStore.getState().settings;
    dark = false;
    listeners.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("matchMedia", () => ({ get matches() { return dark; },
      addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.delete(fn) }));
    window.matchMedia = globalThis.matchMedia;
    setActiveEditorPlatform({ id: "theme-test", persistence: { load: () => null, save() {} } });
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    useSettingsStore.setState({ settings: originalSettings });
    vi.unstubAllGlobals();
  });

  it.each(["light", "dark"] as const)("samples the current OS preference when returning from explicit %s to system", async (explicit) => {
    await choose(explicit);
    dark = explicit === "dark";
    await render();
    expect(host.textContent).toBe(explicit);
    expect(listeners.size).toBe(0);
    await changeOS(explicit === "light");
    await choose("system");
    expect(host.textContent).toBe(explicit === "light" ? "dark" : "light");
    expect(listeners.size).toBe(1);
  });

  it("uses the initial OS preference and follows live changes while system is selected", async () => {
    dark = true;
    await render();
    expect(host.textContent).toBe("dark");
    await changeOS(false);
    expect(host.textContent).toBe("light");
    await changeOS(true);
    expect(host.textContent).toBe("dark");
  });

  it("removes the listener on explicit selection and on unmount", async () => {
    await render();
    expect(listeners.size).toBe(1);
    await choose("light");
    expect(listeners.size).toBe(0);
    await changeOS(true);
    expect(host.textContent).toBe("light");
    await choose("system");
    expect(host.textContent).toBe("dark");
    expect(listeners.size).toBe(1);
    await act(async () => { root.unmount(); });
    expect(listeners.size).toBe(0);
    root = createRoot(host);
  });
});
