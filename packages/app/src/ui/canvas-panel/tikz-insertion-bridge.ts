import type { WorldPoint } from "@tikz-editor/core/coords/index";

/**
 * Where an insertion from outside the canvas (a menu command) goes in the
 * TikZ figure: the centre of what the canvas shows, in world coordinates.
 */
let viewCenterReader: (() => WorldPoint | null) | null = null;

export function registerTikzViewCenterReader(reader: () => WorldPoint | null): () => void {
  viewCenterReader = reader;
  return () => { if (viewCenterReader === reader) viewCenterReader = null; };
}

export function readTikzViewCenter(): WorldPoint | null {
  return viewCenterReader?.() ?? null;
}
