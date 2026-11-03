import type { DocumentKind } from "@tikz-editor/core/document/kind";
import { getActiveEditorPlatform } from "../platform/current";
import { isRecord } from "../validation";

export type CanvasViewPreferences = Record<DocumentKind, { showGrid: boolean; showRulers: boolean }>;

export const DEFAULT_CANVAS_VIEW_PREFERENCES: CanvasViewPreferences = {
  tikz: { showGrid: true, showRulers: true },
  beamer: { showGrid: false, showRulers: false },
};

const STORAGE_KEY = "tikz-editor:canvas-view-preferences";

export function loadCanvasViewPreferences(): CanvasViewPreferences {
  try {
    const raw = getActiveEditorPlatform().persistence.load(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.preferences)) return DEFAULT_CANVAS_VIEW_PREFERENCES;
    const preferences = parsed.preferences;
    const read = (kind: DocumentKind) => {
      const candidate: unknown = preferences[kind];
      const defaults = DEFAULT_CANVAS_VIEW_PREFERENCES[kind];
      if (!isRecord(candidate)) return defaults;
      return {
        showGrid: typeof candidate.showGrid === "boolean" ? candidate.showGrid : defaults.showGrid,
        showRulers: typeof candidate.showRulers === "boolean" ? candidate.showRulers : defaults.showRulers,
      };
    };
    return { tikz: read("tikz"), beamer: read("beamer") };
  } catch {
    return DEFAULT_CANVAS_VIEW_PREFERENCES;
  }
}

export function saveCanvasViewPreferences(preferences: CanvasViewPreferences): void {
  try {
    getActiveEditorPlatform().persistence.save(STORAGE_KEY, JSON.stringify({ version: 1, preferences }));
  } catch {
    // Keep the current session usable when persistence is unavailable.
  }
}
