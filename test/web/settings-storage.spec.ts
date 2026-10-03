import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "../../packages/app/src/settings/storage.js";
import { DEFAULT_SETTINGS } from "../../packages/app/src/settings/types.js";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current.js";
import { createBrowserPlatformAdapter } from "../../apps/web/src/platform/browser-platform.js";

const STORAGE_KEY = "tikz-editor:settings";

describe("settings storage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map<string, string>();
    setActiveEditorPlatform(createBrowserPlatformAdapter({
      storage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        }
      }
    }));
  });

  it("fills new formatter settings from defaults for legacy settings objects", () => {
    const storage = new Map<string, string>();
    setActiveEditorPlatform(createBrowserPlatformAdapter({
      storage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    }));
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        settings: {
          editor: {
            wordWrap: true,
            fontSize: 13,
            lineNumbers: false,
            indentSize: 4
          }
        }
      })
    );

    const loaded = loadSettings();
    expect(loaded.editor.wordWrap).toBe(true);
    expect(loaded.editor.indentSize).toBe(4);
    expect(loaded.editor.formatterReflowLongOptions).toBe(DEFAULT_SETTINGS.editor.formatterReflowLongOptions);
    expect(loaded.editor.formatterMaxLineLength).toBe(DEFAULT_SETTINGS.editor.formatterMaxLineLength);
  });

  it("clamps formatter max line length when loading persisted values", () => {
    const storage = new Map<string, string>();
    setActiveEditorPlatform(createBrowserPlatformAdapter({
      storage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    }));
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        settings: {
          editor: {
            formatterMaxLineLength: 999
          }
        }
      })
    );

    const loaded = loadSettings();
    expect(loaded.editor.formatterMaxLineLength).toBe(240);
  });

  it("defaults invalid fields independently while keeping valid sibling values", () => {
    store.set(STORAGE_KEY, JSON.stringify({ settingsVersion: 1, settings: {
      general: { colorScheme: "invalid", uiFontSizePx: "14", canvasInvert: true },
      editor: { wordWrap: "false", fontSize: 15, lineNumbers: false, indentSize: 3,
        formatterReflowLongOptions: null, formatterMaxLineLength: 110 },
      canvas: { gridSize: "invalid", zoomSpeed: null, handleSizePx: 8, snapHapticsEnabled: false,
        textEditPlacement: "invalid" },
      colorPicker: { accuracy: "exact" }
    } }));
    expect(loadSettings()).toEqual({
      general: { ...DEFAULT_SETTINGS.general, canvasInvert: true },
      editor: { ...DEFAULT_SETTINGS.editor, fontSize: 15, lineNumbers: false, formatterMaxLineLength: 110 },
      canvas: { ...DEFAULT_SETTINGS.canvas, snapHapticsEnabled: false },
      colorPicker: { accuracy: "exact" }
    });
  });

  it("rejects malformed sections while preserving other valid categories", () => {
    store.set(STORAGE_KEY, JSON.stringify({ settings: {
      general: { colorScheme: "dark", canvasInvert: "true" }, editor: [15], canvas: "invalid",
      colorPicker: { accuracy: null }
    } }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS,
      general: { ...DEFAULT_SETTINGS.general, colorScheme: "dark" }
    });
  });

  it("rejects non-boolean values for every persisted boolean setting", () => {
    store.set(STORAGE_KEY, JSON.stringify({ settings: {
      general: { canvasInvert: 1 },
      editor: { wordWrap: "true", lineNumbers: 0, formatterReflowLongOptions: {} },
      canvas: { snapHapticsEnabled: null }
    } }));
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects malformed settings envelopes", () => {
    for (const payload of [null, [], { settings: null }, { settings: [] }, { settings: 3 }]) {
      store.set(STORAGE_KEY, JSON.stringify(payload));
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    }
  });

  it.each([
    { name: "lower", input: -100, ui: 10, editor: 8, formatter: 40, zoom: 0.0015 },
    { name: "upper", input: 1000, ui: 14, editor: 20, formatter: 240, zoom: 0.009 }
  ])("clamps finite numerical values to the existing $name control bounds", ({ input, ui, editor, formatter, zoom }) => {
    store.set(STORAGE_KEY, JSON.stringify({ settings: {
      general: { uiFontSizePx: input }, editor: { fontSize: input, formatterMaxLineLength: input },
      canvas: { zoomSpeed: input }
    } }));
    const loaded = loadSettings();
    expect(loaded.general.uiFontSizePx).toBe(ui);
    expect(loaded.editor.fontSize).toBe(editor);
    expect(loaded.editor.formatterMaxLineLength).toBe(formatter);
    expect(loaded.canvas.zoomSpeed).toBe(zoom);
  });

  it("rounds integer controls but preserves finite zoom values between steps", () => {
    store.set(STORAGE_KEY, JSON.stringify({ settings: {
      general: { uiFontSizePx: 12.6 }, editor: { fontSize: 13.2, formatterMaxLineLength: 85.6 },
      canvas: { handleSizePx: 11, zoomSpeed: 0.004321 }
    } }));
    const loaded = loadSettings();
    expect(loaded.general.uiFontSizePx).toBe(13);
    expect(loaded.editor.fontSize).toBe(13);
    expect(loaded.editor.formatterMaxLineLength).toBe(86);
    expect(loaded.canvas.handleSizePx).toBe(11);
    expect(loaded.canvas.zoomSpeed).toBe(0.004321);
  });

  it("defaults non-finite JSON numbers before they reach consumers", () => {
    store.set(STORAGE_KEY, '{"settings":{"general":{"uiFontSizePx":1e999},"editor":{"fontSize":-1e999,"formatterMaxLineLength":1e999},"canvas":{"zoomSpeed":1e999},"colorPicker":{"accuracy":"bad"}}}');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it.each([undefined, 1, 2])("keeps recognized settings compatible with envelope version %s", (settingsVersion) => {
    store.set(STORAGE_KEY, JSON.stringify({ settingsVersion, settings: {
      general: { colorScheme: "light", uiFontSizePx: 14 },
      editor: { fontSize: 9, wordWrap: false, formatterReflowLongOptions: false, indentSize: 4 },
      canvas: { gridSize: "fine", textEditPlacement: "bar" },
      unknownFutureCategory: { enabled: true }
    } }));
    const loaded = loadSettings();
    expect(loaded).toEqual({
      general: { ...DEFAULT_SETTINGS.general, colorScheme: "light", uiFontSizePx: 14 },
      editor: { ...DEFAULT_SETTINGS.editor, fontSize: 9, wordWrap: false, formatterReflowLongOptions: false, indentSize: 4 },
      canvas: { ...DEFAULT_SETTINGS.canvas, gridSize: "fine", textEditPlacement: "bar" },
      colorPicker: DEFAULT_SETTINGS.colorPicker
    });
  });

  it("round trips all recognized valid fields using the current envelope", () => {
    const settings = {
      general: { uiFontSizePx: 10, colorScheme: "dark" as const, canvasInvert: true },
      editor: { wordWrap: false, fontSize: 20, lineNumbers: false, indentSize: 4 as const,
        formatterReflowLongOptions: false, formatterMaxLineLength: 240 },
      canvas: { gridSize: "coarse" as const, handleSizePx: 7, zoomSpeed: 0.009,
        snapHapticsEnabled: false, textEditPlacement: "bar" as const },
      colorPicker: { accuracy: "exact" as const }
    };
    saveSettings(settings);
    expect(JSON.parse(store.get(STORAGE_KEY)!).settingsVersion).toBe(1);
    expect(loadSettings()).toEqual(settings);
  });
});
