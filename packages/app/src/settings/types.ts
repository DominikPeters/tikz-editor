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

export type CanvasTextEditPlacement = "popup" | "bar";

export type CanvasSettings = {
  gridSize: GridSize;
  handleSizePx: number;
  zoomSpeed: number;
  snapHapticsEnabled: boolean;
  /**
   * Where canvas text editing shows its source surface: a floating popup
   * near the edited content or a bar docked to the canvas bottom edge.
   * Large scope buffers always fall back to the bar.
   */
  textEditPlacement: CanvasTextEditPlacement;
};

export type AppSettings = {
  general: GeneralSettings;
  editor: EditorSettings;
  canvas: CanvasSettings;
  colorPicker: {
    accuracy: ColorPickerAccuracy;
  };
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

export const UI_FONT_SIZE_MIN_PX = 10;
export const UI_FONT_SIZE_MAX_PX = 14;
export const UI_FONT_SIZE_OPTIONS = Array.from(
  { length: UI_FONT_SIZE_MAX_PX - UI_FONT_SIZE_MIN_PX + 1 },
  (_, index) => UI_FONT_SIZE_MIN_PX + index
);
export const CANVAS_HANDLE_SIZE_OPTIONS = [7, 9, 11] as const;
export const CANVAS_ZOOM_SPEED_MIN = 0.0015;
export const CANVAS_ZOOM_SPEED_MAX = 0.009;
export const CANVAS_ZOOM_SPEED_STEP = 0.0005;
export const MIN_FORMATTER_MAX_LINE_LENGTH = 40;
export const MAX_FORMATTER_MAX_LINE_LENGTH = 240;

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
    snapHapticsEnabled: true,
    textEditPlacement: "popup"
  },
  colorPicker: {
    accuracy: "approximate"
  }
};
