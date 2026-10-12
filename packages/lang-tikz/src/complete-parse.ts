import { forceParsing, syntaxTreeAvailable } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

const SLICE_MS = 8;

function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(callback);
    return () => { cancelIdleCallback(handle); };
  }
  const handle = setTimeout(callback, 0);
  return () => { clearTimeout(handle); };
}

/**
 * CodeMirror parses at most 100 000 characters past the viewport, and an edit
 * to such a partial tree restarts every nested parse in it (each picture, each
 * node text) from scratch: 15 ms a key in a long paper. Finish the parse in
 * idle slices instead, so each edit reparses only around itself.
 */
export const completeSyntaxTree: Extension = ViewPlugin.fromClass(
  class {
    private cancel: (() => void) | null = null;

    constructor(private readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.schedule();
    }

    destroy(): void {
      this.cancel?.();
      this.cancel = null;
    }

    private schedule(): void {
      if (this.cancel || syntaxTreeAvailable(this.view.state, this.view.state.doc.length)) return;
      this.cancel = whenIdle(() => {
        this.cancel = null;
        if (!forceParsing(this.view, this.view.state.doc.length, SLICE_MS)) this.schedule();
      });
    }
  }
);
