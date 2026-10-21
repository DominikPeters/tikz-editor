import type { AppSettings } from "./types";
import {
  DEFAULT_SETTINGS, UI_FONT_SIZE_MIN_PX, UI_FONT_SIZE_MAX_PX,
  EDITOR_FONT_SIZE_MIN_PX, EDITOR_FONT_SIZE_MAX_PX, CANVAS_HANDLE_SIZE_OPTIONS,
  CANVAS_ZOOM_SPEED_MIN, CANVAS_ZOOM_SPEED_MAX,
  MIN_FORMATTER_MAX_LINE_LENGTH, MAX_FORMATTER_MAX_LINE_LENGTH
} from "./types";
import { getActiveEditorPlatform } from "../platform/current";

const STORAGE_KEY = "tikz-editor:settings";
const SETTINGS_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readSection(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readOption<T extends string | number>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function readNumber(value: unknown, fallback: number, min: number, max: number, round = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, round ? Math.round(value) : value));
}

export function loadSettings(): AppSettings {
  try {
    const raw = getActiveEditorPlatform().persistence.load(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsedRaw = JSON.parse(raw) as unknown;
    if (!isRecord(parsedRaw)) {
      return DEFAULT_SETTINGS;
    }
    const parsedCandidate = parsedRaw.settings;
    if (!isRecord(parsedCandidate)) {
      return DEFAULT_SETTINGS;
    }
    // Keep the existing field-based compatibility policy: legacy and newer envelopes
    // can contribute recognized valid fields; absent/unknown fields use current defaults.
    const general = readSection(parsedCandidate.general);
    const editor = readSection(parsedCandidate.editor);
    const canvas = readSection(parsedCandidate.canvas);
    const colorPicker = readSection(parsedCandidate.colorPicker);
    return {
      general: {
        uiFontSizePx: readNumber(general.uiFontSizePx, DEFAULT_SETTINGS.general.uiFontSizePx,
          UI_FONT_SIZE_MIN_PX, UI_FONT_SIZE_MAX_PX, true),
        colorScheme: readOption(general.colorScheme, ["system", "light", "dark"], DEFAULT_SETTINGS.general.colorScheme),
        canvasInvert: readBoolean(general.canvasInvert, DEFAULT_SETTINGS.general.canvasInvert)
      },
      editor: {
        wordWrap: readBoolean(editor.wordWrap, DEFAULT_SETTINGS.editor.wordWrap),
        fontSize: readNumber(editor.fontSize, DEFAULT_SETTINGS.editor.fontSize,
          EDITOR_FONT_SIZE_MIN_PX, EDITOR_FONT_SIZE_MAX_PX, true),
        lineNumbers: readBoolean(editor.lineNumbers, DEFAULT_SETTINGS.editor.lineNumbers),
        indentSize: readOption(editor.indentSize, [2, 4], DEFAULT_SETTINGS.editor.indentSize),
        formatterReflowLongOptions: readBoolean(editor.formatterReflowLongOptions, DEFAULT_SETTINGS.editor.formatterReflowLongOptions),
        formatterMaxLineLength: readNumber(editor.formatterMaxLineLength, DEFAULT_SETTINGS.editor.formatterMaxLineLength,
          MIN_FORMATTER_MAX_LINE_LENGTH, MAX_FORMATTER_MAX_LINE_LENGTH, true)
      },
      canvas: {
        gridSize: readOption(canvas.gridSize, ["fine", "standard", "coarse"], DEFAULT_SETTINGS.canvas.gridSize),
        handleSizePx: readOption(canvas.handleSizePx, CANVAS_HANDLE_SIZE_OPTIONS, DEFAULT_SETTINGS.canvas.handleSizePx),
        zoomSpeed: readNumber(canvas.zoomSpeed, DEFAULT_SETTINGS.canvas.zoomSpeed, CANVAS_ZOOM_SPEED_MIN, CANVAS_ZOOM_SPEED_MAX),
        snapHapticsEnabled: readBoolean(canvas.snapHapticsEnabled, DEFAULT_SETTINGS.canvas.snapHapticsEnabled),
        textEditPlacement: readOption(canvas.textEditPlacement, ["popup", "bar"], DEFAULT_SETTINGS.canvas.textEditPlacement)
      },
      colorPicker: {
        accuracy: readOption(colorPicker.accuracy, ["approximate", "exact"], DEFAULT_SETTINGS.colorPicker.accuracy)
      }
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
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
