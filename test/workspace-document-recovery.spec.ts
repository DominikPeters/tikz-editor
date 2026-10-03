import { afterEach, describe, expect, it } from "vitest";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import { loadWorkspaceSeed, saveWorkspace } from "../packages/app/src/store/workspace-storage";
import { hydrateWorkspaceStateFromSeed } from "../packages/app/src/store/workspace-state";

const KEY = "tikz-editor:workspace";
const previousPlatform = getActiveEditorPlatform();
afterEach(() => setActiveEditorPlatform(previousPlatform));

const documents = [
  { id: "a", title: "A", source: "first unsaved", savedSource: "first saved", activeRootId: "figure:a" },
  { id: "b", title: "B", source: "second unsaved", savedSource: "second saved", activeRootId: "figure:b", assistantThreadId: "thread:b" },
  { id: "c", title: "C", source: "third unsaved", savedSource: "third saved" }
];

describe("workspace document recovery", () => {
  for (const workspaceVersion of [1, 3, 4]) {
    for (const tabOrder of [["b"], ["missing", "b", "b"], ["missing"], []]) {
      it(`retains all sources through v${workspaceVersion} load/hydrate/save for ${JSON.stringify(tabOrder)}`, () => {
        const values = new Map([[KEY, JSON.stringify({ workspaceVersion, documents, tabOrder,
          activeDocumentId: "c", recentDocumentIds: ["c", "missing", "b", "c"] })]]);
        setActiveEditorPlatform({ id: "recovery", persistence: {
          load: (key) => values.get(key) ?? null, save: (key, value) => { values.set(key, value); }
        } });
        const order = tabOrder.includes("b") ? ["b", "a", "c"] : ["a", "b", "c"];
        const seed = loadWorkspaceSeed()!;
        expect(seed.tabOrder).toEqual(order);
        expect(seed.activeDocumentId).toBe("c");
        expect(seed.recentDocumentIds).toEqual(["c", "b"]);
        const workspace = hydrateWorkspaceStateFromSeed(seed);
        expect(workspace.tabOrder).toEqual(order);
        expect(workspace.activeDocumentId).toBe("c");
        expect(workspace.recentDocumentIds).toEqual(["c", "b"]);
        expect(workspace.documents.b).toMatchObject({ ...documents[1], dirty: true });
        saveWorkspace(workspace);
        const reloaded = loadWorkspaceSeed()!;
        expect(reloaded.tabOrder).toEqual(order);
        expect(reloaded.activeDocumentId).toBe("c");
        expect(reloaded.recentDocumentIds).toEqual(["c", "b"]);
        for (const document of documents) {
          expect(reloaded.documents.find((doc) => doc.id === document.id)).toMatchObject(document);
        }
      });
    }
  }

  it("normalizes a direct hydration seed independently of the storage loader", () => {
    const workspace = hydrateWorkspaceStateFromSeed({ workspaceVersion: 4, documents,
      tabOrder: ["b", "missing", "b"], activeDocumentId: "c", recentDocumentIds: ["c", "b", "c", "missing"] });
    expect(workspace.tabOrder).toEqual(["b", "a", "c"]);
    expect(workspace.activeDocumentId).toBe("c");
    expect(workspace.recentDocumentIds).toEqual(["c", "b"]);
  });

  it("retains documents when saving a partial state that bypassed hydration", () => {
    const values = new Map<string, string>();
    setActiveEditorPlatform({ id: "recovery", persistence: {
      load: (key) => values.get(key) ?? null, save: (key, value) => { values.set(key, value); }
    } });
    const workspace = hydrateWorkspaceStateFromSeed({ workspaceVersion: 4, documents,
      tabOrder: ["b"], activeDocumentId: "c", recentDocumentIds: ["c", "b"] });
    saveWorkspace({ ...workspace, tabOrder: ["b", "b", "missing"] });
    expect(loadWorkspaceSeed()).toMatchObject({ tabOrder: ["b", "a", "c"], activeDocumentId: "c", recentDocumentIds: ["c", "b"] });
    expect(loadWorkspaceSeed()!.documents).toHaveLength(3);
  });

  it("uses the first visible recovered tab when active and recent references are invalid", () => {
    const workspace = hydrateWorkspaceStateFromSeed({ workspaceVersion: 4, documents,
      tabOrder: ["b", "b"], activeDocumentId: "missing", recentDocumentIds: ["missing"] });
    expect(workspace.tabOrder).toEqual(["b", "a", "c"]);
    expect(workspace.activeDocumentId).toBe("b");
    expect(workspace.recentDocumentIds).toEqual(["b"]);
  });
});
