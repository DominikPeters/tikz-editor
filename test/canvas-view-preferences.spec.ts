import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current";
import { DEFAULT_CANVAS_VIEW_PREFERENCES, loadCanvasViewPreferences, saveCanvasViewPreferences } from "../packages/app/src/store/canvas-view-preferences";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer";
import { useEditorStore } from "../packages/app/src/store/store";
import { loadWorkspaceSeed } from "../packages/app/src/store/workspace-storage";

const KEY = "tikz-editor:canvas-view-preferences";
const deck = String.raw`\documentclass{beamer}\begin{document}\begin{frame}Slide\begin{tikzpicture}\end{tikzpicture}\end{frame}\end{document}`;

describe("canvas view preferences", () => {
  let storage: Map<string, string>;
  const originalStore = useEditorStore.getState();
  beforeEach(() => {
    storage = new Map();
    setActiveEditorPlatform({ id: "canvas-view-test", persistence: {
      load: key => storage.get(key) ?? null,
      save: (key, value) => { storage.set(key, value); },
    } });
    useEditorStore.setState(makeInitialState());
  });
  afterEach(() => { useEditorStore.setState(originalStore, true); });

  it("remembers independent choices across tabs, nested drawings, and restart", () => {
    const { dispatch } = useEditorStore.getState();
    const tikzId = useEditorStore.getState().activeDocumentId;
    expect(useEditorStore.getState()).toMatchObject({ showGrid: true, showRulers: true });
    dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" });
    dispatch({ type: "TOGGLE_CANVAS_AID", aid: "rulers" });
    dispatch({ type: "NEW_DOCUMENT", source: deck });
    expect(useEditorStore.getState()).toMatchObject({ showGrid: false, showRulers: false });
    dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" });
    dispatch({ type: "SET_ACTIVE_ROOT", rootId: "frame:0:tikzpicture:0" });
    expect(useEditorStore.getState()).toMatchObject({ showGrid: true, showRulers: false });
    dispatch({ type: "NEW_DOCUMENT", source: deck });
    const beamerId = useEditorStore.getState().activeDocumentId;
    expect(useEditorStore.getState()).toMatchObject({ showGrid: true, showRulers: false });
    dispatch({ type: "SWITCH_DOCUMENT", documentId: tikzId });
    expect(useEditorStore.getState()).toMatchObject({ showGrid: false, showRulers: false });
    dispatch({ type: "SWITCH_DOCUMENT", documentId: beamerId });

    const restored = makeInitialState(loadWorkspaceSeed()!, loadCanvasViewPreferences());
    expect(restored).toMatchObject({ documentKind: "beamer", showGrid: true, showRulers: false });
    expect(editorReducer(restored, { type: "SWITCH_DOCUMENT", documentId: tikzId }))
      .toMatchObject({ showGrid: false, showRulers: false });
    expect(DEFAULT_CANVAS_VIEW_PREFERENCES.tikz).toEqual({ showGrid: true, showRulers: true });
  });

  it("follows document kind when the source changes", () => {
    const initial = makeInitialState();
    const beamer = editorReducer(initial, { type: "CODE_EDITED", source: deck });
    expect(beamer).toMatchObject({ showGrid: false, showRulers: false });
    const tikz = editorReducer(beamer, { type: "CODE_EDITED", source: initial.source });
    expect(tikz).toMatchObject({ showGrid: true, showRulers: true });
  });

  it("loads recognized boolean fields and falls back for missing or malformed data", () => {
    for (const raw of ["null", "[]", "{bad", '{"version":2,"preferences":{}}']) {
      storage.set(KEY, raw);
      expect(loadCanvasViewPreferences()).toEqual(DEFAULT_CANVAS_VIEW_PREFERENCES);
    }
    storage.set(KEY, JSON.stringify({ version: 1, preferences: {
      tikz: { showGrid: false, showRulers: "false" }, beamer: { showRulers: true },
    } }));
    expect(loadCanvasViewPreferences()).toEqual({
      tikz: { showGrid: false, showRulers: true }, beamer: { showGrid: false, showRulers: true },
    });
  });

  it("keeps defaults and session changes usable when storage is denied", () => {
    setActiveEditorPlatform({ id: "denied-canvas-view", persistence: {
      load() { throw new Error("Denied"); }, save() { throw new Error("Denied"); },
    } });
    expect(loadCanvasViewPreferences()).toEqual(DEFAULT_CANVAS_VIEW_PREFERENCES);
    expect(() => saveCanvasViewPreferences(DEFAULT_CANVAS_VIEW_PREFERENCES)).not.toThrow();
  });
});
