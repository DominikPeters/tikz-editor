import { createContext, createElement, useContext, type ReactNode } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { editorReducer, makeInitialState, type WorkspaceSeed } from "./reducer";
import type { EditorState, EditorAction } from "./types";
import { loadWorkspaceSeed, saveWorkspace } from "./workspace-storage";

export type EditorStore = EditorState & {
  dispatch: (action: EditorAction) => void;
};

export type EditorStoreApi = StoreApi<EditorStore>;

export type CreateEditorStoreOptions = {
  seed?: WorkspaceSeed;
  persist?: boolean;
};

export function createEditorStore(options: CreateEditorStoreOptions = {}): EditorStoreApi {
  const store = createStore<EditorStore>((set) => ({
    ...makeInitialState(options.seed),
    dispatch: (action: EditorAction) => set((state) => editorReducer(state, action))
  }));
  if (options.persist) {
    store.subscribe((next) => {
      saveWorkspace({
        workspaceVersion: next.workspaceVersion,
        documents: next.documents,
        tabOrder: next.tabOrder,
        activeDocumentId: next.activeDocumentId,
        recentDocumentIds: next.recentDocumentIds
      });
    });
  }
  return store;
}

// Default store for the main app. Eagerly constructed so module-level consumers
// (tests, main.tsx bootstrap) can grab it directly. Embeds create their own
// store via createEditorStore() and provide it through EditorStoreProvider.
export const defaultEditorStore: EditorStoreApi = createEditorStore({
  seed: loadWorkspaceSeed() ?? undefined,
  persist: true
});

const EditorStoreContext = createContext<EditorStoreApi | null>(null);

export function EditorStoreProvider({
  store,
  children
}: {
  store: EditorStoreApi;
  children?: ReactNode;
}) {
  return createElement(EditorStoreContext.Provider, { value: store }, children);
}

export function useEditorStoreApi(): EditorStoreApi {
  const api = useContext(EditorStoreContext);
  if (!api) {
    throw new Error(
      "EditorStoreProvider is missing. Wrap your app in <EditorStoreProvider store={...}> before using useEditorStore or useEditorStoreApi."
    );
  }
  return api;
}

export function useEditorStore<T>(selector: (state: EditorStore) => T): T {
  const api = useEditorStoreApi();
  return useStore(api, selector);
}
