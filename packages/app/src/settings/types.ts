export type EditorSettings = {
  wordWrap: boolean;
  fontSize: number;
  lineNumbers: boolean;
  indentSize: 2 | 4;
  formatterReflowLongOptions: boolean;
  formatterMaxLineLength: number;
};

export type ColorPickerAccuracy = "approximate" | "exact";

export type GridSize = "fine" | "standard" | "coarse";

export type ColorScheme = "system" | "light" | "dark";

export type GeneralSettings = {
  uiFontSizePx: number;
  colorScheme: ColorScheme;
  canvasInvert: boolean;
};

export type CanvasSettings = {
  gridSize: GridSize;
  handleSizePx: number;
  zoomSpeed: number;
  snapHapticsEnabled: boolean;
};

export type MathJaxFont =
  | "mathjax-newcm"
  | "mathjax-asana"
  | "mathjax-bonum"
  | "mathjax-dejavu"
  | "mathjax-fira"
  | "mathjax-modern"
  | "mathjax-pagella"
  | "mathjax-schola"
  | "mathjax-stix2"
  | "mathjax-termes"
  | "mathjax-tex";

export type RenderingSettings = {
  mathJaxFont: MathJaxFont;
};

export type AddonInstallSource = { kind: "builtin" } | { kind: "url"; url: string; integrity?: string };

export type InstalledAddonSettings = {
  enabled: boolean;
  source: AddonInstallSource;
  /** The add-on's own version, recorded at install time. */
  version: string;
  /** The add-on's own settings bag (plain data). */
  settings?: unknown;
};

export type AddonsSettings = {
  installed: Record<string, InstalledAddonSettings>;
};

export type AppSettings = {
  general: GeneralSettings;
  editor: EditorSettings;
  canvas: CanvasSettings;
  colorPicker: {
    accuracy: ColorPickerAccuracy;
  };
  rendering: RenderingSettings;
  addons: AddonsSettings;
};

export const GRID_SIZE_MINOR_TARGET_PX: Record<GridSize, number> = {
  fine: 12,
  standard: 22,
  coarse: 44
};

export const EDITOR_FONT_SIZE_MIN_PX = 8;
export const EDITOR_FONT_SIZE_MAX_PX = 20;
export const EDITOR_FONT_SIZE_OPTIONS = Array.from(
  { length: EDITOR_FONT_SIZE_MAX_PX - EDITOR_FONT_SIZE_MIN_PX + 1 },
  (_, index) => EDITOR_FONT_SIZE_MIN_PX + index
);

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    uiFontSizePx: 11,
    colorScheme: "system",
    canvasInvert: false
  },
  editor: {
    wordWrap: true,
    fontSize: 12,
    lineNumbers: true,
    indentSize: 2,
    formatterReflowLongOptions: true,
    formatterMaxLineLength: 100
  },
  canvas: {
    gridSize: "standard",
    handleSizePx: 9,
    zoomSpeed: 0.0045,
    snapHapticsEnabled: true
  },
  colorPicker: {
    accuracy: "approximate"
  },
  rendering: {
    mathJaxFont: "mathjax-newcm"
  },
  addons: {
    installed: {}
  }
};
