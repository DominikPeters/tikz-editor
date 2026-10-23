import { create } from "zustand";
import { getActiveEditorPlatform } from "../platform/current";
import { isRecord } from "../validation";

// Which side-panel sections the user has collapsed, keyed by a stable section
// id ("inspector:stroke"). Persisted so a collapsed section stays collapsed
// across selections and reloads.
const STORAGE_KEY = "tikz-editor:collapsed-sections";

function loadCollapsed(): ReadonlySet<string> {
  try {
    const raw = getActiveEditorPlatform().persistence.load(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.collapsed)) return new Set();
    return new Set(parsed.collapsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function saveCollapsed(collapsed: ReadonlySet<string>): void {
  try {
    getActiveEditorPlatform().persistence.save(STORAGE_KEY, JSON.stringify({ collapsed: [...collapsed] }));
  } catch {
    // Persistence is best effort; the in-memory state still applies.
  }
}

type SectionCollapseStore = {
  collapsed: ReadonlySet<string>;
  toggle: (sectionId: string) => void;
};

export const useSectionCollapseStore = create<SectionCollapseStore>((set) => ({
  collapsed: loadCollapsed(),
  toggle: (sectionId) => {
    set((state) => {
      const next = new Set(state.collapsed);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      saveCollapsed(next);
      return { collapsed: next };
    });
  }
}));

export function useSectionCollapsed(sectionId: string | undefined): boolean {
  return useSectionCollapseStore((state) => sectionId !== undefined && state.collapsed.has(sectionId));
}
