import { useLayoutEffect } from "react";
import type { AssistantApi } from "../platform/types";
import { useEditorStore } from "../store/store";

/** Retire native sessions only after a document has actually been removed. */
export function useClosedDocumentAssistantCleanup(assistant: AssistantApi | undefined): void {
  useLayoutEffect(() => {
    const resetDocumentThread = assistant?.resetDocumentThread;
    if (!resetDocumentThread) return;
    return useEditorStore.subscribe((state, previous) => {
      // Source edits update document records frequently; only tab membership
      // changes can remove a document, so keep this off the editing hot path.
      if (state.tabOrder === previous.tabOrder || state.documents === previous.documents) return;
      for (const [documentId, removed] of Object.entries(previous.documents)) {
        if (!removed || state.documents[documentId]) continue;
        const params = { documentId, sessionGeneration: removed.assistantSessionGeneration + 1 };
        // Advance ownership so an ensure/start already in flight cannot restore
        // a closed document's watcher or assistant session after this reset.
        void (async () => {
          try {
            await resetDocumentThread(params);
          } catch (error) {
            console.info("[tikz-editor] Closed document assistant cleanup failed.", error);
          }
        })();
      }
    });
  }, [assistant]);
}
