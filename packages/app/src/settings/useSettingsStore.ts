import { create } from "zustand";
import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, saveSettings } from "./storage";

type SettingsStore = {
  settings: AppSettings;
  updateGeneralSettings: (patch: Partial<AppSettings["general"]>) => void;
  updateEditorSettings: (patch: Partial<AppSettings["editor"]>) => void;
  updateCanvasSettings: (patch: Partial<AppSettings["canvas"]>) => void;
  updateColorPickerSettings: (patch: Partial<AppSettings["colorPicker"]>) => void;
  resetGeneralSettings: () => void;
  resetEditorSettings: () => void;
  resetCanvasSettings: () => void;
};

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: loadSettings(),
  updateGeneralSettings: (patch) => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        general: { ...state.settings.general, ...patch }
      };
      saveSettings(next);
      return { settings: next };
    });
  },
  updateEditorSettings: (patch) => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        editor: { ...state.settings.editor, ...patch }
      };
      saveSettings(next);
      return { settings: next };
    });
  },
  updateCanvasSettings: (patch) => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        canvas: { ...state.settings.canvas, ...patch }
      };
      saveSettings(next);
      return { settings: next };
    });
  },
  updateColorPickerSettings: (patch) => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        colorPicker: { ...state.settings.colorPicker, ...patch }
      };
      saveSettings(next);
      return { settings: next };
    });
  },
  resetGeneralSettings: () => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        general: { ...DEFAULT_SETTINGS.general },
        colorPicker: { ...DEFAULT_SETTINGS.colorPicker }
      };
      saveSettings(next);
      return { settings: next };
    });
  },
  resetEditorSettings: () => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        editor: { ...DEFAULT_SETTINGS.editor }
      };
      saveSettings(next);
      return { settings: next };
    });
  },
  resetCanvasSettings: () => {
    set((state) => {
      const next: AppSettings = {
        ...state.settings,
        canvas: { ...DEFAULT_SETTINGS.canvas }
      };
      saveSettings(next);
      return { settings: next };
    });
  }
}));
