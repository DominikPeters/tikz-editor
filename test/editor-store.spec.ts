import { afterEach, describe, expect, it, vi } from "vitest";
import { wp } from "./coords-helpers.js";

async function loadStoreWithMemoryPersistence(seed?: string): Promise<{
  map: Map<string, string>;
  useEditorStore: typeof import("../packages/app/src/store/store.js").useEditorStore;
}> {
  vi.resetModules();
  const map = new Map<string, string>();
  if (seed) {
    map.set("tikz-editor:workspace", seed);
  }
  const { setActiveEditorPlatform } = await import("../packages/app/src/platform/current.js");
  setActiveEditorPlatform({
    id: "test",
    persistence: {
      load: (key) => map.get(key) ?? null,
      save: (key, value) => {
        map.set(key, value);
      }
    }
  });
  const { useEditorStore } = await import("../packages/app/src/store/store.js");
  return { map, useEditorStore };
}

function readSavedWorkspace(map: Map<string, string>) {
  return JSON.parse(map.get("tikz-editor:workspace") ?? "{}") as {
    documents: Array<{
      id: string;
      source: string;
      savedSource?: string;
      fileRef?: unknown;
      diskRevision?: unknown;
      lastKnownDiskSource?: string | null;
      externalChangeStatus?: string;
    }>;
    tabOrder: string[];
    activeDocumentId: string;
  };
}

describe("editor store persistence decisions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("persists high-frequency source edits immediately outside the browser", async () => {
    const { map, useEditorStore } = await loadStoreWithMemoryPersistence();

    useEditorStore.getState().dispatch({
      type: "CODE_EDITED",
      source: "\\begin{tikzpicture}\\draw (0,0)--(1,1);\\end{tikzpicture}"
    });

    const saved = readSavedWorkspace(map);
    expect(saved.documents).toHaveLength(1);
    expect(saved.documents[0]?.source).toContain("\\draw");
  }, 15_000);

  it("debounces browser source edits, installs one unload flusher, and ignores ephemeral selection changes", async () => {
    const timeoutCallbacks: Array<() => void> = [];
    const windowMock = {
      setTimeout: vi.fn((callback: () => void) => {
        timeoutCallbacks.push(callback);
        return timeoutCallbacks.length;
      }),
      clearTimeout: vi.fn(),
      addEventListener: vi.fn()
    };
    vi.stubGlobal("window", windowMock);
    const { map, useEditorStore } = await loadStoreWithMemoryPersistence();

    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "first edit" });
    expect(map.has("tikz-editor:workspace")).toBe(false);

    useEditorStore.getState().dispatch({ type: "CODE_EDITED", source: "second edit" });
    expect(windowMock.addEventListener).toHaveBeenCalledTimes(2);
    expect(windowMock.clearTimeout).toHaveBeenCalledWith(1);
    expect(map.has("tikz-editor:workspace")).toBe(false);

    timeoutCallbacks[1]?.();
    expect(readSavedWorkspace(map).documents[0]?.source).toBe("second edit");
    const savedAfterFlush = map.get("tikz-editor:workspace");

    useEditorStore.getState().dispatch({ type: "SELECT", id: "path:0", additive: false });
    expect(map.get("tikz-editor:workspace")).toBe(savedAfterFlush);
  });

  it("persists new documents and linked-file metadata without a pending debounce timer", async () => {
    const { map, useEditorStore } = await loadStoreWithMemoryPersistence();

    useEditorStore.getState().dispatch({
      type: "NEW_DOCUMENT",
      source: "\\draw (1,1)--(2,2);",
      title: "Linked"
    });
    const created = readSavedWorkspace(map);
    expect(created.documents).toHaveLength(2);
    const activeId = created.activeDocumentId;

    useEditorStore.getState().dispatch({
      type: "MARK_DOCUMENT_SAVED",
      documentId: activeId,
      fileRef: {
        kind: "file",
        name: "linked.tex",
        path: "/tmp/linked.tex",
        provider: "desktop-fs"
      },
      diskRevision: { hash: "abc", mtimeMs: 10, size: 20 },
      lastKnownDiskSource: "\\draw (1,1)--(2,2);"
    });

    const saved = readSavedWorkspace(map);
    const active = saved.documents.find((doc) => doc.id === activeId);
    expect(active).toMatchObject({
      savedSource: "\\draw (1,1)--(2,2);",
      fileRef: {
        kind: "file",
        name: "linked.tex",
        path: "/tmp/linked.tex",
        provider: "desktop-fs"
      },
      diskRevision: { hash: "abc", mtimeMs: 10, size: 20 },
      lastKnownDiskSource: "\\draw (1,1)--(2,2);",
      externalChangeStatus: "none"
    });

    useEditorStore.getState().dispatch({
      type: "MARK_DOCUMENT_SAVED",
      documentId: activeId,
      fileRef: {
        kind: "browser-file",
        name: "bound.tex",
        handleId: "handle-1",
        provider: "browser-fsa"
      },
      diskRevision: { hash: "def", mtimeMs: 11, size: 20 },
      lastKnownDiskSource: "\\draw (1,1)--(2,2);"
    });
    const rebound = readSavedWorkspace(map).documents.find((doc) => doc.id === activeId);
    expect(rebound).toMatchObject({
      fileRef: {
        kind: "browser-file",
        name: "bound.tex",
        handleId: "handle-1",
        provider: "browser-fsa"
      },
      diskRevision: { hash: "def", mtimeMs: 11, size: 20 }
    });

    useEditorStore.getState().dispatch({
      type: "SET_DOCUMENT_LINKED_FILE_STATUS",
      documentId: activeId,
      externalChangeStatus: "changed",
      diskRevision: null,
      lastKnownDiskSource: null
    });
    const stale = readSavedWorkspace(map).documents.find((doc) => doc.id === activeId);
    expect(stale).toMatchObject({
      diskRevision: null,
      lastKnownDiskSource: null,
      externalChangeStatus: "changed"
    });
  });

  it("persists committed edit actions immediately when no drag or scrub is active", async () => {
    const { map, useEditorStore } = await loadStoreWithMemoryPersistence();
    const state = useEditorStore.getState();

    useEditorStore.getState().dispatch({
      type: "APPLY_EDIT_ACTION",
      action: { kind: "moveElement", elementId: "path:0", delta: wp(1, 1) },
      precomputedSource: state.source,
      precomputedResult: {
        kind: "success",
        newSource: "committed edit",
        patches: [{
          oldSpan: { from: 0, to: state.source.length },
          newSpan: { from: 0, to: "committed edit".length },
          replacement: "committed edit"
        }],
        changedSourceIds: ["path:0"]
      }
    });

    expect(readSavedWorkspace(map).documents[0]?.source).toBe("committed edit");
  });

  it("detects persisted file reference and revision changes when other document fields are stable", async () => {
    const { map, useEditorStore } = await loadStoreWithMemoryPersistence();
    const state = useEditorStore.getState();
    const documentId = state.activeDocumentId;
    const source = state.source;
    const baseDoc = state.documents[documentId];

    useEditorStore.setState({
      ...state,
      documents: {
        ...state.documents,
        [documentId]: {
          ...baseDoc,
          title: "stable.tex",
          savedSource: source,
          fileRef: {
            kind: "file",
            name: "stable.tex",
            path: "/tmp/a.tex",
            provider: "desktop-fs"
          },
          diskRevision: { hash: "a", mtimeMs: 1, size: 2 }
        }
      }
    });

    useEditorStore.getState().dispatch({
      type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK",
      source,
      fileRef: {
        kind: "file",
        name: "stable.tex",
        path: "/tmp/b.tex",
        provider: "desktop-fs"
      },
      diskRevision: { hash: "b", mtimeMs: 1, size: 2 }
    });

    expect(readSavedWorkspace(map).documents[0]).toMatchObject({
      fileRef: {
        kind: "file",
        name: "stable.tex",
        path: "/tmp/b.tex",
        provider: "desktop-fs"
      },
      diskRevision: { hash: "b", mtimeMs: 1, size: 2 }
    });

    const rebound = useEditorStore.getState();
    const reboundDoc = rebound.documents[documentId];
    useEditorStore.setState({
      ...rebound,
      documents: {
        ...rebound.documents,
        [documentId]: {
          ...reboundDoc,
          title: "stable.tex",
          savedSource: source,
          fileRef: null,
          diskRevision: null
        }
      }
    });

    useEditorStore.getState().dispatch({
      type: "REPLACE_DOCUMENT_SOURCE_FROM_DISK",
      source,
      fileRef: {
        kind: "browser-file",
        name: "stable.tex",
        handleId: "handle-2",
        provider: "browser-fsa"
      },
      diskRevision: { hash: "c" }
    });

    expect(readSavedWorkspace(map).documents[0]).toMatchObject({
      fileRef: {
        kind: "browser-file",
        name: "stable.tex",
        handleId: "handle-2",
        provider: "browser-fsa"
      },
      diskRevision: { hash: "c" }
    });
  });
});
