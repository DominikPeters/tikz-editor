import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOURCE, editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import {
  createDocumentSession,
  createInitialWorkspaceState,
  hydrateWorkspaceStateFromSeed,
  projectState,
  uiStateFromEditorState
} from "../packages/app/src/store/workspace-state.js";

describe("workspace model", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("initializes one active document session", () => {
    const state = makeInitialState();
    expect(state.tabOrder).toHaveLength(1);
    expect(state.documents[state.activeDocumentId]).toBeDefined();
    expect(state.source).toBe(state.documents[state.activeDocumentId]?.source);
    expect(state.source).toBe(DEFAULT_SOURCE);
    expect(state.workspaceVersion).toBe(3);
    expect(state.recentDocumentIds).toEqual([state.activeDocumentId]);
  });

  it("uses the default source for fresh documents and fallback sessions", () => {
    const initial = makeInitialState();
    const fresh = editorReducer(initial, { type: "NEW_DOCUMENT" });
    expect(fresh.source).toBe(DEFAULT_SOURCE);

    const closedAll = editorReducer(fresh, { type: "CLOSE_ALL_DOCUMENTS" });
    expect(closedAll.source).toBe(DEFAULT_SOURCE);

    const closedOnlyTab = editorReducer(makeInitialState(), { type: "CLOSE_DOCUMENT" });
    expect(closedOnlyTab.source).toBe(DEFAULT_SOURCE);
  });

  it("creates and switches documents", () => {
    const initial = makeInitialState();
    const withSecond = editorReducer(initial, { type: "NEW_DOCUMENT", source: "\\draw (0,0)--(1,0);", title: "Doc B" });
    expect(withSecond.tabOrder).toHaveLength(2);
    expect(withSecond.documents[withSecond.activeDocumentId]?.title).toBe("Doc B");

    const firstId = initial.activeDocumentId;
    const switched = editorReducer(withSecond, { type: "SWITCH_DOCUMENT", documentId: firstId });
    expect(switched.activeDocumentId).toBe(firstId);
    expect(switched.source).toBe(initial.source);
  });

  it("keeps history/source isolated per document", () => {
    const initial = makeInitialState();
    const firstId = initial.activeDocumentId;
    const withSecond = editorReducer(initial, { type: "NEW_DOCUMENT", source: "\\draw (2,2)--(3,3);", title: "Doc B" });
    const secondId = withSecond.activeDocumentId;

    const editedSecond = editorReducer(withSecond, { type: "CODE_EDITED", source: "\\draw (9,9)--(10,10);" });
    expect(editedSecond.documents[secondId]?.source).toContain("(9,9)");

    const switchedBack = editorReducer(editedSecond, { type: "SWITCH_DOCUMENT", documentId: firstId });
    expect(switchedBack.source).toBe(initial.source);
  });

  it("can restore transient source in an inactive document", () => {
    const initial = makeInitialState();
    const firstId = initial.activeDocumentId;
    const withSecond = editorReducer(initial, {
      type: "NEW_DOCUMENT",
      source: "\\draw (2,2)--(3,3);",
      title: "Doc B"
    });
    const secondId = withSecond.activeDocumentId;

    const restored = editorReducer(withSecond, {
      type: "SET_SOURCE_TRANSIENT",
      documentId: firstId,
      source: "\\draw (9,9)--(10,10);"
    });

    expect(restored.activeDocumentId).toBe(secondId);
    expect(restored.source).toBe(withSecond.source);
    expect(restored.documents[firstId]?.source).toBe("\\draw (9,9)--(10,10);");
  });

  it("closes tabs and falls back to a fresh doc after close-all", () => {
    const initial = makeInitialState();
    const withSecond = editorReducer(initial, { type: "NEW_DOCUMENT", source: "\\draw (2,2)--(3,3);", title: "Doc B" });
    const closedActive = editorReducer(withSecond, { type: "CLOSE_DOCUMENT" });
    expect(closedActive.tabOrder).toHaveLength(1);

    const closedAll = editorReducer(closedActive, { type: "CLOSE_ALL_DOCUMENTS" });
    expect(closedAll.tabOrder).toHaveLength(1);
    expect(closedAll.documents[closedAll.activeDocumentId]?.title).toContain("Untitled");
  });

  it("tracks dirty and save transitions per document", () => {
    const initial = makeInitialState();
    const edited = editorReducer(initial, { type: "CODE_EDITED", source: `${initial.source}\n% changed` });
    expect(edited.documents[edited.activeDocumentId]?.dirty).toBe(true);

    const saved = editorReducer(edited, {
      type: "MARK_DOCUMENT_SAVED",
      fileRef: { kind: "file", name: "diagram.tex" }
    });
    expect(saved.documents[saved.activeDocumentId]?.dirty).toBe(false);
    expect(saved.documents[saved.activeDocumentId]?.title).toBe("diagram.tex");
  });

  it("opens examples in a new tab session", () => {
    const initial = makeInitialState();
    const next = editorReducer(initial, {
      type: "NEW_DOCUMENT",
      source: "\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}",
      title: "Circle Example"
    });
    expect(next.tabOrder).toHaveLength(2);
    expect(next.documents[next.activeDocumentId]?.title).toBe("Circle Example");
    expect(next.recentDocumentIds[0]).toBe(next.activeDocumentId);
  });

  it("creates deterministic fallback ids and untitled names when browser UUIDs are unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Date, "now").mockReturnValue(12345);
    vi.spyOn(Math, "random").mockReturnValue(0.42);

    const doc = createDocumentSession({
      source: "\\draw (0,0)--(1,1);",
      title: "   "
    });

    expect(doc.id).toBe("doc-12345-420000");
    expect(doc.title).toBe("Untitled");
  });

  it("hydrates missing persisted workspace links to a usable active document", () => {
    const workspace = hydrateWorkspaceStateFromSeed({
      workspaceVersion: 3,
      documents: [
        { id: "doc-a", title: "A", source: "a" },
        { id: "doc-b", title: "B", source: "b" }
      ],
      tabOrder: ["missing", "doc-b"],
      activeDocumentId: "missing",
      recentDocumentIds: []
    });

    expect(workspace.activeDocumentId).toBe("doc-b");
    expect(workspace.tabOrder).toEqual(["doc-b"]);
    expect(workspace.recentDocumentIds).toEqual(["doc-b"]);
  });

  it("falls back to document order and active recents when persisted ordering is empty", () => {
    const workspace = hydrateWorkspaceStateFromSeed({
      workspaceVersion: 3,
      documents: [
        { id: "doc-a", title: "A", source: "a" },
        { id: "doc-b", title: "B", source: "b" }
      ],
      tabOrder: ["missing"],
      activeDocumentId: "doc-a",
      recentDocumentIds: []
    });

    expect(workspace.tabOrder).toEqual(["doc-a", "doc-b"]);
    expect(workspace.activeDocumentId).toBe("doc-a");
    expect(workspace.recentDocumentIds).toEqual(["doc-a"]);
  });

  it("projects malformed workspace state through active-document normalization", () => {
    const initial = makeInitialState();
    const ui = uiStateFromEditorState(initial);
    const workspace = createInitialWorkspaceState();
    const [documentId] = workspace.tabOrder;

    const projected = projectState({
      ...workspace,
      activeDocumentId: "missing",
      tabOrder: ["missing", documentId]
    }, ui);

    expect(projected.activeDocumentId).toBe(documentId);
    expect(projected.tabOrder).toEqual([documentId]);

    const replacement = projectState({
      ...workspace,
      documents: {},
      activeDocumentId: "missing",
      tabOrder: ["missing"],
      recentDocumentIds: ["missing"]
    }, ui);

    expect(replacement.tabOrder).toHaveLength(1);
    expect(replacement.documents[replacement.activeDocumentId]?.title).toContain("Untitled");
  });
});
