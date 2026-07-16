import type { AppSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { getActiveEditorPlatform } from "../platform/current";

const STORAGE_KEY = "tikz-editor:settings";
const SETTINGS_VERSION = 1;
const MIN_FORMATTER_MAX_LINE_LENGTH = 40;
const MAX_FORMATTER_MAX_LINE_LENGTH = 240;

export function loadSettings(): AppSettings {
  try {
    const raw = getActiveEditorPlatform().persistence.load(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsedRaw = JSON.parse(raw) as unknown;
    if (parsedRaw == null || typeof parsedRaw !== "object") {
      return DEFAULT_SETTINGS;
    }
    const parsedCandidate = (parsedRaw as { settings?: unknown }).settings;
    if (parsedCandidate == null || typeof parsedCandidate !== "object") {
      return DEFAULT_SETTINGS;
    }
    const parsed = parsedCandidate as Partial<AppSettings>;
    const parsedFormatterMaxLineLength =
      typeof parsed.editor?.formatterMaxLineLength === "number"
        ? clampFormatterMaxLineLength(parsed.editor.formatterMaxLineLength)
        : DEFAULT_SETTINGS.editor.formatterMaxLineLength;
    return {
      general: {
        ...DEFAULT_SETTINGS.general,
        ...parsed.general
      },
      editor: {
        ...DEFAULT_SETTINGS.editor,
        ...parsed.editor,
        formatterMaxLineLength: parsedFormatterMaxLineLength
      },
      canvas: {
        ...DEFAULT_SETTINGS.canvas,
        ...parsed.canvas
      },
      colorPicker: {
        ...DEFAULT_SETTINGS.colorPicker,
        ...parsed.colorPicker
      },
      rendering: {
        ...DEFAULT_SETTINGS.rendering,
        ...parsed.rendering
      },
      addons: {
        ...DEFAULT_SETTINGS.addons,
        ...parsed.addons,
        installed: {
          ...DEFAULT_SETTINGS.addons.installed,
          ...parsed.addons?.installed
        }
      }
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function clampFormatterMaxLineLength(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.editor.formatterMaxLineLength;
  }
  const rounded = Math.round(value);
  return Math.max(MIN_FORMATTER_MAX_LINE_LENGTH, Math.min(MAX_FORMATTER_MAX_LINE_LENGTH, rounded));
}

export function saveSettings(settings: AppSettings): void {
  try {
    getActiveEditorPlatform().persistence.save(
      STORAGE_KEY,
      JSON.stringify({
        settingsVersion: SETTINGS_VERSION,
        settings
      })
    );
  } catch {
    // storage unavailable — ignore
  }
}
