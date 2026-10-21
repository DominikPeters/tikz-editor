import { getActiveDocument, requireDocumentSession } from "../../packages/app/src/store/document-sessions.js";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FuzzDocument } from "./compute-fuzz.js";
import type { ModuleMock } from "./compute-instances.js";
import { generateStoreOps, runStoreOps } from "./store-fuzz.js";
import type { EditorAction, EditorState } from "../../packages/app/src/store/types.js";

// Each sabotage breaks the store the way a real bug would; the store fuzzer
// must catch every one within a small budget.

const fixture = (path: string): FuzzDocument => ({ label: path, source: readFileSync(`test/fixtures/${path}`, "utf8") });
const documents = [fixture("multi-figure-basic.tex"), fixture("multi-figure-paper.tex")];

type Reducer = (state: EditorState, action: EditorAction) => EditorState;

/** Wraps the store's reducer; `wrap` sees each action before the real reducer does. */
function reducerMock(wrap: (reduce: Reducer) => Reducer): ModuleMock {
  return {
    path: "../../packages/app/src/store/reducer.js",
    factory: async (importOriginal) => {
      const original = await importOriginal() as typeof import("../../packages/app/src/store/reducer.js");
      return { ...original, editorReducer: wrap(original.editorReducer) };
    }
  };
}

const SABOTAGES: { name: string; mocks: ModuleMock[] }[] = [
  {
    name: "a save that lands late marks the current text as saved",
    mocks: [reducerMock((reduce) => (state, action) => action.type === "MARK_DOCUMENT_SAVED" && action.savedSource !== undefined
      ? reduce(state, { ...action, savedSource: state.documents[action.documentId ?? state.activeDocumentId]?.source ?? action.savedSource })
      : reduce(state, action))]
  },
  {
    name: "undo goes back one entry too far",
    mocks: [reducerMock((reduce) => (state, action) => {
      if (action.type !== "UNDO") return reduce(state, action);
      const doc = getActiveDocument(state);
      return reduce(doc.historyIndex >= 1 ? reduce(state, action) : state, action);
    })]
  },
  {
    name: "edits run against a stale snapshot without the catching-up guard",
    mocks: [reducerMock((reduce) => (state, action) => {
      if (action.type !== "APPLY_EDIT_ACTION") return reduce(state, action);
      const id = action.documentId ?? state.activeDocumentId;
      const doc = requireDocumentSession(state.documents, id);
      return reduce({ ...state, documents: { ...state.documents, [id]: { ...doc, editingTargetsStale: false } } }, action);
    }), {
      path: "../../packages/app/src/edit-execution.js",
      factory: async (importOriginal) => {
        const original = await importOriginal() as typeof import("../../packages/app/src/edit-execution.js");
        return { ...original, executeDocumentEdit: ((context, action, options) =>
          original.executeDocumentEdit({ ...context, snapshot: { ...context.snapshot, activeRootId: context.activeRootId } }, action, options)) as typeof original.executeDocumentEdit };
      }
    }]
  }
];

beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });

describe("store fuzzer catches sabotaged store behaviour", () => {
  for (const sabotage of SABOTAGES) {
    it(sabotage.name, async () => {
      let caught = false;
      for (let seed = 1; seed <= 8 && !caught; seed += 1) {
        const result = await runStoreOps(documents.slice(seed % 2), generateStoreOps(9000 + seed, 60), sabotage.mocks);
        caught = result.failure != null && result.failure.invariant !== "threw";
      }
      expect(caught).toBe(true);
    }, 900_000);
  }
});
