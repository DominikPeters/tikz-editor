/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appCallbacks, mountFileApp, unmountFileApp } from "./app-file-operations-fixtures.js";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";
import { useEditorStore } from "../../packages/app/src/store/store.js";
import type { EditorPlatform } from "../../packages/app/src/platform/types.js";

const previousPlatform = getActiveEditorPlatform(), previousState = useEditorStore.getState();
afterEach(async () => {
  await unmountFileApp(); vi.useRealTimers();
  setActiveEditorPlatform(previousPlatform); useEditorStore.setState(previousState, true);
});
function quit() { (appCallbacks.current as typeof appCallbacks.current & { onRequestQuitApp: () => void }).onRequestQuitApp(); }

async function mount(decision: "save" | "discard" | "cancel", saveStatus: "saved" | "cancelled" = "saved") {
  const values = new Map<string, string>(), writes: string[] = [];
  const close = vi.fn(async () => {}), confirm = vi.fn(async () => decision);
  const save = vi.fn(async (_text: string, options?: { suggestedName?: string }) => ({ status: saveStatus, fileRef: { kind: "virtual" as const, name: options?.suggestedName ?? "Untitled.tex" } }));
  const platform: EditorPlatform = { id: "desktop-macos", persistence: { load: key => values.get(key) ?? null,
    save: (key, value) => { values.set(key, value); if (key === "tikz-editor:workspace") writes.push(value); } },
    window: { close, confirmUnsavedChanges: confirm }, files: { saveText: save } };
  const id = await mountFileApp(platform, "initial dirty source");
  return { id, close, confirm, save, values, writes };
}

describe("native Quit through App's existing close policy", () => {
  it("Cancel keeps dirty documents open without invoking native termination", async () => {
    const app = await mount("cancel");
    await act(async () => { quit(); });
    expect(app.confirm).toHaveBeenCalledOnce(); expect(app.close).not.toHaveBeenCalled(); expect(app.save).not.toHaveBeenCalled();
    expect(useEditorStore.getState().documents[app.id].dirty).toBe(true);
  });
  it("Discard flushes the last debounced recovery source before native termination", async () => {
    const app = await mount("discard");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => { useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "latest unsaved recovery" }); });
    expect(app.values.get("tikz-editor:workspace") ?? "").not.toContain("latest unsaved recovery");
    const before = app.writes.length;
    app.close.mockImplementation(async () => { expect(app.values.get("tikz-editor:workspace")).toContain("latest unsaved recovery"); });
    await act(async () => { quit(); });
    expect(app.close).toHaveBeenCalledOnce(); expect(app.save).not.toHaveBeenCalled();
    expect(app.writes).toHaveLength(before + 1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(app.writes).toHaveLength(before + 1);
  });
  it("Save writes all dirty documents before accepting native termination", async () => {
    const app = await mount("save");
    await act(async () => {
      useEditorStore.getState().dispatch({ type: "NEW_DOCUMENT", source: "second initial", title: "Second" });
      useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "second dirty source" });
    });
    app.close.mockImplementation(async () => { expect(app.save).toHaveBeenCalledTimes(2); expect(Object.values(useEditorStore.getState().documents).every(doc => !doc.dirty)).toBe(true); });
    await act(async () => { quit(); });
    expect(app.save.mock.calls.map(call => call[0])).toEqual(["initial dirty source", "second dirty source"]);
    expect(app.close).toHaveBeenCalledOnce();
  });
  it("a cancelled file save keeps the native app open", async () => {
    const app = await mount("save", "cancelled");
    await act(async () => { quit(); });
    expect(app.save).toHaveBeenCalledOnce(); expect(app.close).not.toHaveBeenCalled();
  });
});
