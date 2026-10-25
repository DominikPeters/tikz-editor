import { create } from "zustand";

/**
 * The theme the gallery is previewing on the canvas: a rendering of the
 * active slide under that theme, drawn over the page while a tile is hovered
 * or focused. The source never changes; the preview is only valid for the
 * document, slide and source it was rendered from.
 */
export type ThemePreview = {
  documentId: string;
  frameId: string;
  source: string;
  themeId: string;
  url: string;
};

type ThemePreviewStore = {
  preview: ThemePreview | null;
  show: (preview: ThemePreview) => void;
  clear: () => void;
};

export const useThemePreviewStore = create<ThemePreviewStore>((set) => ({
  preview: null,
  show: (preview) => { set({ preview }); },
  clear: () => { set({ preview: null }); },
}));
