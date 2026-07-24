import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveEditorPlatform } from "../packages/app/src/platform/current.js";
import {
  loadDockLayout,
  loadUserWorkspaces,
  loadWorkspaceSeed,
  saveDockLayout,
  saveUserWorkspaces,
  saveWorkspace
} from "../packages/app/src/store/workspace-storage.js";

function setupMemoryPersistence(seed?: string) {
  const map = new Map<string, string>();
  if (seed) {
    map.set("tikz-editor:workspace", seed);
  }
  setActiveEditorPlatform({
    id: "test",
    persistence: {
      load: (key) => map.get(key) ?? null,
      save: (key, value) => {
        map.set(key, value);
      }
    }
  });
  return map;
}

describe("workspace storage migration", () => {
  beforeEach(() => {
    setupMemoryPersistence();
    vi.restoreAllMocks();
  });

  it("returns null for empty, malformed, unsupported, or unusable workspace payloads", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(loadWorkspaceSeed()).toBeNull();

    setupMemoryPersistence("{bad json");
    expect(loadWorkspaceSeed()).toBeNull();

    setupMemoryPersistence(JSON.stringify({ workspaceVersion: 99, documents: [] }));
    expect(loadWorkspaceSeed()).toBeNull();

    setupMemoryPersistence(JSON.stringify({
      workspaceVersion: 3,
      documents: [
        { id: "missing-source", title: "Bad" },
        { source: "missing id" }
      ],
      tabOrder: [],
      activeDocumentId: "missing-source",
      recentDocumentIds: []
    }));
    expect(loadWorkspaceSeed()).toBeNull();

    setupMemoryPersistence(JSON.stringify({
      workspaceVersion: 3,
      documents: [{ id: "doc-1", title: "Doc", source: "\\draw (0,0)--(1,1);" }],
      tabOrder: ["doc-1"],
      activeDocumentId: "doc-1"
    }));
    expect(loadWorkspaceSeed()).toBeNull();
  });

  it("migrates v1 fileRef payloads into current seed shape", () => {
    const map = setupMemoryPersistence(JSON.stringify({
      workspaceVersion: 1,
      documents: [
        {
          id: "doc-1",
          title: "Doc",
          source: "\\draw (0,0)--(1,1);",
          savedSource: "\\draw (0,0)--(1,1);",
          fileRef: { kind: "file", name: "old.tex" },
          assistantThreadId: "thr_123",
          assistantWorkspacePath: "/tmp/codex/doc-1",
          assistantFigurePath: "/tmp/codex/doc-1/figure.tex",
          assistantPreviewPath: "/tmp/codex/doc-1/current.png"
        }
      ],
      tabOrder: ["doc-1"],
      activeDocumentId: "doc-1",
      recentDocumentIds: ["doc-1"]
    }));
    expect(map.get("tikz-editor:workspace")).toBeTruthy();

    const seed = loadWorkspaceSeed();
    expect(seed).not.toBeNull();
    expect(seed?.workspaceVersion).toBe(4);
    expect(seed?.documents[0]?.fileRef?.kind).toBe("file");
    expect(seed?.documents[0]?.fileRef?.name).toBe("old.tex");
    expect(seed?.documents[0]?.assistantThreadId).toBe("thr_123");
  });

  it("normalizes invalid optional document metadata while migrating", () => {
    setupMemoryPersistence(JSON.stringify({
      workspaceVersion: 3,
      documents: [
        {
          id: "doc-1",
          title: "   ",
          source: "\\draw (0,0)--(1,1);",
          savedSource: 42,
          activeFigureId: 123,
          fileRef: { kind: "unknown", name: " virtual.tex ", provider: "bad" },
          diskRevision: { hash: "", mtimeMs: "bad", size: "bad" },
          lastKnownDiskSource: 123,
          externalChangeStatus: "wat",
          assistantThreadId: 123,
          assistantWorkspacePath: false,
          assistantFigurePath: [],
          assistantPreviewPath: {}
        },
        {
          id: "doc-2",
          title: "Doc 2",
          source: "\\draw (1,1)--(2,2);",
          fileRef: { kind: "desktop-file", name: "" },
          diskRevision: { hash: "abc", mtimeMs: 10, size: 20 },
          externalChangeStatus: "permission-needed"
        }
      ],
      tabOrder: ["missing", "doc-2"],
      activeDocumentId: "missing",
      recentDocumentIds: ["doc-2", "missing", 3]
    }));

    const seed = loadWorkspaceSeed();
    expect(seed?.activeDocumentId).toBe("doc-2");
    expect(seed?.tabOrder).toEqual(["doc-2"]);
    expect(seed?.recentDocumentIds).toEqual(["doc-2"]);
    expect(seed?.documents[0]).toMatchObject({
      id: "doc-1",
      title: "Untitled",
      activeRootId: null,
      savedSource: "\\draw (0,0)--(1,1);",
      diskRevision: null,
      lastKnownDiskSource: null,
      externalChangeStatus: "none",
      assistantThreadId: null,
      assistantWorkspacePath: null,
      assistantFigurePath: null,
      assistantPreviewPath: null
    });
    expect(seed?.documents[0]?.fileRef).toEqual({
      kind: "virtual",
      name: " virtual.tex ",
      handleId: undefined,
      path: undefined,
      provider: undefined
    });
    expect(seed?.documents[1]?.fileRef).toBeNull();
    expect(seed?.documents[1]?.diskRevision).toEqual({ hash: "abc", mtimeMs: 10, size: 20 });
    expect(seed?.documents[1]?.externalChangeStatus).toBe("permission-needed");
  });

  it("migrates legacy payload defaults and complete desktop file metadata", () => {
    setupMemoryPersistence(JSON.stringify({
      documents: [
        {
          id: "doc-1",
          title: "Legacy",
          source: "\\draw (0,0)--(1,1);",
          activeFigureId: "figure:0",
          fileRef: {
            kind: "file",
            name: "legacy.tex",
            path: "/tmp/legacy.tex",
            provider: "desktop-fs"
          },
          diskRevision: { hash: "abc" },
          lastKnownDiskSource: "\\draw (0,0)--(1,1);",
          externalChangeStatus: "changed"
        }
      ],
      tabOrder: ["missing"],
      activeDocumentId: "missing",
      recentDocumentIds: []
    }));

    const seed = loadWorkspaceSeed();
    expect(seed).toMatchObject({
      workspaceVersion: 4,
      tabOrder: ["doc-1"],
      activeDocumentId: "doc-1",
      recentDocumentIds: []
    });
    expect(seed?.documents[0]).toMatchObject({
      activeRootId: "figure:0",
      fileRef: {
        kind: "file",
        name: "legacy.tex",
        path: "/tmp/legacy.tex",
        provider: "desktop-fs"
      },
      diskRevision: { hash: "abc", mtimeMs: undefined, size: undefined },
      lastKnownDiskSource: "\\draw (0,0)--(1,1);",
      externalChangeStatus: "changed"
    });
  });

  it("migrates v3 activeFigureId payloads to activeRootId", () => {
    setupMemoryPersistence(JSON.stringify({
      workspaceVersion: 3,
      documents: [
        {
          id: "doc-1",
          title: "Doc",
          source: "\\begin{tikzpicture}\\end{tikzpicture}",
          activeFigureId: "figure:1"
        }
      ],
      tabOrder: ["doc-1"],
      activeDocumentId: "doc-1",
      recentDocumentIds: ["doc-1"]
    }));

    const seed = loadWorkspaceSeed();
    expect(seed?.workspaceVersion).toBe(4);
    expect(seed?.documents[0]?.activeRootId).toBe("figure:1");
  });

  it("returns null without logging when console info is unavailable", () => {
    const originalInfo = console.info;
    Object.defineProperty(console, "info", {
      value: undefined,
      configurable: true
    });

    setupMemoryPersistence("{bad json");
    expect(loadWorkspaceSeed()).toBeNull();

    Object.defineProperty(console, "info", {
      value: originalInfo,
      configurable: true
    });
  });

  it("round-trips browser file refs with handle metadata", () => {
    saveWorkspace({
      workspaceVersion: 3,
      documents: {
        "doc-1": {
          id: "doc-1",
          title: "Doc",
          source: "\\draw (0,0)--(1,1);",
          activeRootId: null,
          savedSource: "\\draw (0,0)--(1,1);",
          fileRef: {
            kind: "browser-file",
            name: "bound.tex",
            handleId: "handle-123",
            provider: "browser-fsa"
          },
          assistantThreadId: "thr_saved",
          assistantWorkspacePath: "/tmp/codex/doc-1",
          assistantFigurePath: "/tmp/codex/doc-1/figure.tex",
          assistantPreviewPath: "/tmp/codex/doc-1/current.png"
        }
      },
      tabOrder: ["doc-1"],
      activeDocumentId: "doc-1",
      recentDocumentIds: ["doc-1"]
    });

    const seed = loadWorkspaceSeed();
    expect(seed?.documents[0]?.fileRef).toEqual({
      kind: "browser-file",
      name: "bound.tex",
      handleId: "handle-123",
      provider: "browser-fsa"
    });
    expect(seed?.documents[0]?.assistantThreadId).toBe("thr_saved");
    expect(seed?.recentDocumentIds).toEqual(["doc-1"]);
  });

  it("ignores missing tab documents during save and handles persistence write failures", () => {
    const map = setupMemoryPersistence();
    saveWorkspace({
      workspaceVersion: 3,
      documents: {
        "doc-1": {
          id: "doc-1",
          title: "Doc",
          source: "\\draw (0,0)--(1,1);",
          activeRootId: "figure:0",
          savedSource: "\\draw (0,0)--(1,1);",
          fileRef: null,
          diskRevision: undefined,
          lastKnownDiskSource: undefined,
          externalChangeStatus: undefined,
          assistantThreadId: null,
          assistantWorkspacePath: null,
          assistantFigurePath: null,
          assistantPreviewPath: null
        }
      },
      tabOrder: ["missing", "doc-1"],
      activeDocumentId: "doc-1",
      recentDocumentIds: ["doc-1"]
    });

    const saved = JSON.parse(map.get("tikz-editor:workspace") ?? "{}");
    expect(saved.documents).toHaveLength(1);
    expect(saved.documents[0]).toMatchObject({
      id: "doc-1",
      activeRootId: "figure:0",
      diskRevision: null,
      lastKnownDiskSource: null,
      externalChangeStatus: "none"
    });

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    setActiveEditorPlatform({
      id: "throw-save",
      persistence: {
        load: () => null,
        save: () => {
          throw new Error("disk full");
        }
      }
    });
    expect(() => saveWorkspace({
      workspaceVersion: 3,
      documents: {},
      tabOrder: [],
      activeDocumentId: "missing",
      recentDocumentIds: []
    })).not.toThrow();
    expect(info).toHaveBeenCalledWith(
      "[tikz-editor] Failed to save workspace state.",
      expect.any(Error)
    );
  });

  it("persists dock layouts and user workspaces defensively", () => {
    const map = setupMemoryPersistence();
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(loadDockLayout()).toBeNull();
    map.set("tikz-editor:dock-layout", "{bad json");
    expect(loadDockLayout()).toBeNull();
    map.set("tikz-editor:dock-layout", JSON.stringify({ global: {} }));
    expect(loadDockLayout()).toBeNull();

    saveDockLayout({ global: {}, borders: [], layout: { type: "row", children: [] } });
    expect(loadDockLayout()).toEqual({ global: {}, borders: [], layout: { type: "row", children: [] } });

    expect(loadUserWorkspaces()).toEqual([]);
    map.set("tikz-editor:user-workspaces", "{bad json");
    expect(loadUserWorkspaces()).toEqual([]);
    map.set("tikz-editor:user-workspaces", JSON.stringify({
      version: 1,
      items: [
        { id: "ok", name: "Saved", json: { global: {}, layout: { type: "row", children: [] } }, createdAt: 1 },
        { id: "bad", name: 2, json: {}, createdAt: 1 },
        { id: "bad2", name: "No JSON", createdAt: 1 }
      ]
    }));
    expect(loadUserWorkspaces()).toEqual([
      { id: "ok", name: "Saved", json: { global: {}, layout: { type: "row", children: [] } }, createdAt: 1 }
    ]);

    saveUserWorkspaces([{ id: "next", name: "Next", json: { global: {}, layout: { type: "row", children: [] } }, createdAt: 2 }]);
    expect(loadUserWorkspaces()).toEqual([
      { id: "next", name: "Next", json: { global: {}, layout: { type: "row", children: [] } }, createdAt: 2 }
    ]);

    map.set("tikz-editor:user-workspaces", JSON.stringify({ version: 2, items: [] }));
    expect(loadUserWorkspaces()).toEqual([]);

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    setActiveEditorPlatform({
      id: "throw-layout-save",
      persistence: {
        load: () => null,
        save: () => {
          throw new Error("no quota");
        }
      }
    });
    expect(() => saveDockLayout({ global: {}, borders: [], layout: { type: "row", children: [] } })).not.toThrow();
    expect(() => saveUserWorkspaces([])).not.toThrow();
    expect(info).toHaveBeenCalledWith("[tikz-editor] Failed to save dock layout.", expect.any(Error));
    expect(info).toHaveBeenCalledWith("[tikz-editor] Failed to save user workspaces.", expect.any(Error));
  });
});
