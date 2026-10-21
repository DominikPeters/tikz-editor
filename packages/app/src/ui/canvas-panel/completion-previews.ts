import { useSyncExternalStore } from "react";
import { mathCompletionPreview, type CommandTable } from "@tikz-editor/core/editing/commands/index";
import {
  texGlyphOutlineGeneration,
  texGlyphOutlinesLoading,
  withTexGlyphOutlines
} from "@tikz-editor/core/text/tex/fonts/glyph-outlines";

type Preview = ReturnType<typeof mathCompletionPreview>;

/**
 * Rendered previews of math completions in the command chip (V2), cached
 * per command table and name. A preview drawn while its font's outlines
 * were still loading is blank: once they arrive, the generation changes,
 * the cache is dropped, and the chip draws them again.
 */
const previews = new WeakMap<CommandTable, Map<string, Preview>>();
let cachedGeneration = -1;
const listeners = new Set<() => void>();
let waiting = false;

/** `generation`: the outline generation the caller renders at (useCompletionPreviewGeneration). */
export function completionPreview(commands: CommandTable, name: string, generation: number): Preview {
  if (cachedGeneration !== generation) {
    cachedGeneration = generation;
    previews.delete(commands);
  }
  let byName = previews.get(commands);
  if (!byName) {
    byName = new Map();
    previews.set(commands, byName);
  }
  if (!byName.has(name)) {
    byName.set(name, mathCompletionPreview(commands, name));
    if (texGlyphOutlinesLoading()) {
      notifyWhenLoaded();
    }
  }
  return byName.get(name) ?? null;
}

function notifyWhenLoaded(): void {
  if (waiting) {
    return;
  }
  waiting = true;
  void withTexGlyphOutlines(() => null, 2).finally(() => {
    waiting = false;
    for (const listener of listeners) {
      listener();
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The outline generation, which changes when outlines a preview waited for arrive. */
export function useCompletionPreviewGeneration(): number {
  return useSyncExternalStore(subscribe, texGlyphOutlineGeneration);
}
