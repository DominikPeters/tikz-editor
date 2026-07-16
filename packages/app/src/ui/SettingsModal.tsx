import { useState } from "react";
import { useSettingsStore } from "../settings/useSettingsStore";
import { EDITOR_FONT_SIZE_OPTIONS, type ColorPickerAccuracy, type ColorScheme, type GridSize, type MathJaxFont } from "../settings/types";
import { Modal } from "./Modal";
import { AddonSettingsPanel } from "./AddonSettingsPanel";
import css from "./SettingsModal.module.css";

type CategoryId = "general" | "editor" | "canvas" | "addons";

const MATHJAX_FONTS: { value: MathJaxFont; label: string }[] = [
  { value: "mathjax-newcm",   label: "New Computer Modern (default)" },
  { value: "mathjax-asana",   label: "Asana Math" },
  { value: "mathjax-bonum",   label: "Gyre Bonum" },
  { value: "mathjax-dejavu",  label: "DejaVu" },
  { value: "mathjax-fira",    label: "Fira / Fira Math" },
  { value: "mathjax-modern",  label: "Latin Modern" },
  { value: "mathjax-pagella", label: "Gyre Pagella" },
  { value: "mathjax-schola",  label: "Gyre Schola" },
  { value: "mathjax-stix2",   label: "STIX2" },
  { value: "mathjax-termes",  label: "Gyre Termes" },
  { value: "mathjax-tex",     label: "TeX (classic MathJax v3)" },
];

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Code Editor" },
  { id: "canvas", label: "Canvas" },
  { id: "addons", label: "Add-ons" }
];

let rememberedCategory: CategoryId = "general";
const MIN_FORMATTER_MAX_LINE_LENGTH = 40;
const MAX_FORMATTER_MAX_LINE_LENGTH = 240;

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>(rememberedCategory);
  const [formatterMaxLineLengthInput, setFormatterMaxLineLengthInput] = useState<string | null>(null);

  const selectCategory = (id: CategoryId) => {
    rememberedCategory = id;
    setActiveCategory(id);
  };
  const settings = useSettingsStore((s) => s.settings);
  const updateGeneralSettings = useSettingsStore((s) => s.updateGeneralSettings);
  const updateEditorSettings = useSettingsStore((s) => s.updateEditorSettings);
  const updateCanvasSettings = useSettingsStore((s) => s.updateCanvasSettings);
  const updateColorPickerSettings = useSettingsStore((s) => s.updateColorPickerSettings);
  const updateRenderingSettings = useSettingsStore((s) => s.updateRenderingSettings);
  const resetGeneralSettings = useSettingsStore((s) => s.resetGeneralSettings);
  const resetEditorSettings = useSettingsStore((s) => s.resetEditorSettings);
  const resetCanvasSettings = useSettingsStore((s) => s.resetCanvasSettings);
  const formatterMaxLineLengthValue = formatterMaxLineLengthInput ?? String(settings.editor.formatterMaxLineLength);

  const commitFormatterMaxLineLength = () => {
    const parsed = Number(formatterMaxLineLengthValue);
    const clamped = Number.isFinite(parsed)
      ? Math.max(MIN_FORMATTER_MAX_LINE_LENGTH, Math.min(MAX_FORMATTER_MAX_LINE_LENGTH, Math.round(parsed)))
      : settings.editor.formatterMaxLineLength;

    updateEditorSettings({ formatterMaxLineLength: clamped });
    setFormatterMaxLineLengthInput(null);
  };

  const resetActiveCategoryToDefaults = () => {
    if (activeCategory === "general") {
      resetGeneralSettings();
      return;
    }
    if (activeCategory === "editor") {
      resetEditorSettings();
      setFormatterMaxLineLengthInput(null);
      return;
    }
    if (activeCategory === "addons") {
      return;
    }
    resetCanvasSettings();
  };

  return (
    <Modal
      onClose={onClose}
      size="lg"
      labelledBy="settings-title"
      dataTestId="settings-modal"
      className={css.dialog}
    >
      <Modal.Header
        title="Settings"
        titleId="settings-title"
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close settings"
      />

      <Modal.Body padding="none" scroll={false}>
        <div className={css.bodyLayout}>
          <nav className={css.sidebar}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={[css.navItem, activeCategory === cat.id ? css.navItemActive : ""].filter(Boolean).join(" ")}
                onClick={() => { selectCategory(cat.id); }}
                data-testid={`settings-category-${cat.id}`}
              >
                {cat.label}
              </button>
            ))}
          </nav>

          <div className={css.content}>
            {activeCategory === "addons" && <AddonSettingsPanel />}
            {activeCategory === "general" && (
              <div className={css.panel}>
                <div className={css.panelTitle}>General</div>
                <div className={css.settingsGroup}>
                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-ui-font-size">
                      UI Font Size
                      <span className={css.settingDesc}>Adjusts app chrome text size.</span>
                    </label>
                    <select
                      id="setting-ui-font-size"
                      className={css.select}
                      value={settings.general.uiFontSizePx}
                      onChange={(e) => { updateGeneralSettings({ uiFontSizePx: Number(e.target.value) }); }}
                    >
                      {[10, 11, 12, 13, 14].map((size) => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-color-scheme">
                      Color Scheme
                      <span className={css.settingDesc}>Controls light/dark mode for the app UI.</span>
                    </label>
                    <select
                      id="setting-color-scheme"
                      className={css.select}
                      value={settings.general.colorScheme}
                      onChange={(e) => { updateGeneralSettings({ colorScheme: e.target.value as ColorScheme }); }}
                    >
                      <option value="system">System (default)</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-canvas-invert">
                      Invert Canvas in Dark Mode
                      <span className={css.settingDesc}>
                        Applies brightness inversion to the diagram in dark mode, keeping hue intact.
                      </span>
                    </label>
                    <input
                      id="setting-canvas-invert"
                      type="checkbox"
                      className={css.checkbox}
                      checked={settings.general.canvasInvert}
                      onChange={(e) => { updateGeneralSettings({ canvasInvert: e.target.checked }); }}
                    />
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-color-picker-accuracy">
                      Color Picker Precision
                      <span className={css.settingDesc}>
                        Approximate uses faster integer mixes. Exact enables higher-precision white-tail mixes.
                      </span>
                    </label>
                    <select
                      id="setting-color-picker-accuracy"
                      className={css.select}
                      value={settings.colorPicker.accuracy}
                      onChange={(e) => { updateColorPickerSettings({ accuracy: e.target.value as ColorPickerAccuracy }); }}
                    >
                      <option value="approximate">Approximate (default)</option>
                      <option value="exact">Exact</option>
                    </select>
                  </div>
                </div>
                <div className={css.resetRow}>
                  <button
                    type="button"
                    className={css.resetButton}
                    data-testid="settings-reset-general"
                    onClick={resetActiveCategoryToDefaults}
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>
            )}

            {activeCategory === "editor" && (
              <div className={css.panel}>
                <div className={css.panelTitle}>Code Editor</div>
                <div className={css.settingsGroup}>
                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-word-wrap">
                      Word Wrap
                      <span className={css.settingDesc}>Wrap long lines in the source editor.</span>
                    </label>
                    <input
                      id="setting-word-wrap"
                      type="checkbox"
                      className={css.checkbox}
                      checked={settings.editor.wordWrap}
                      onChange={(e) => { updateEditorSettings({ wordWrap: e.target.checked }); }}
                    />
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-line-numbers">
                      Line Numbers
                      <span className={css.settingDesc}>Show line numbers in the source editor.</span>
                    </label>
                    <input
                      id="setting-line-numbers"
                      type="checkbox"
                      className={css.checkbox}
                      checked={settings.editor.lineNumbers}
                      onChange={(e) => { updateEditorSettings({ lineNumbers: e.target.checked }); }}
                    />
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-font-size">
                      Font Size
                      <span className={css.settingDesc}>Source editor font size.</span>
                    </label>
                    <select
                      id="setting-font-size"
                      className={css.select}
                      value={settings.editor.fontSize}
                      onChange={(e) => { updateEditorSettings({ fontSize: Number(e.target.value) }); }}
                    >
                      {EDITOR_FONT_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>{size}px</option>
                      ))}
                    </select>
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-indent-size">
                      Indent Size
                      <span className={css.settingDesc}>Spaces inserted by Tab and formatting.</span>
                    </label>
                    <select
                      id="setting-indent-size"
                      className={css.select}
                      value={settings.editor.indentSize}
                      onChange={(e) => { updateEditorSettings({ indentSize: Number(e.target.value) as 2 | 4 }); }}
                    >
                      <option value={2}>2 spaces</option>
                      <option value={4}>4 spaces</option>
                    </select>
                  </div>
                </div>

                <div className={css.panelTitle}>Formatter</div>
                <div className={css.settingsGroup}>
                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-formatter-reflow-long-options">
                      Reflow Long Option Lists
                      <span className={css.settingDesc}>Split long option lists into one entry per line while formatting.</span>
                    </label>
                    <input
                      id="setting-formatter-reflow-long-options"
                      type="checkbox"
                      className={css.checkbox}
                      checked={settings.editor.formatterReflowLongOptions}
                      onChange={(e) => { updateEditorSettings({ formatterReflowLongOptions: e.target.checked }); }}
                    />
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-formatter-max-line-length">
                      Max Line Length
                      <span className={css.settingDesc}>Longer option lists are reflowed when this limit is exceeded.</span>
                    </label>
                    <input
                      id="setting-formatter-max-line-length"
                      type="number"
                      className={css.numberInput}
                      min={MIN_FORMATTER_MAX_LINE_LENGTH}
                      max={MAX_FORMATTER_MAX_LINE_LENGTH}
                      value={formatterMaxLineLengthValue}
                      onChange={(e) => { setFormatterMaxLineLengthInput(e.target.value); }}
                      onBlur={commitFormatterMaxLineLength}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          commitFormatterMaxLineLength();
                        }
                      }}
                    />
                  </div>
                </div>
                <div className={css.resetRow}>
                  <button
                    type="button"
                    className={css.resetButton}
                    data-testid="settings-reset-editor"
                    onClick={resetActiveCategoryToDefaults}
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>
            )}

            {activeCategory === "canvas" && (
              <div className={css.panel}>
                <div className={css.panelTitle}>Canvas</div>
                <div className={css.settingsGroup}>
                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-grid-size">
                      Grid Size
                      <span className={css.settingDesc}>Controls how fine or coarse the snap grid is.</span>
                    </label>
                    <select
                      id="setting-grid-size"
                      className={css.select}
                      value={settings.canvas.gridSize}
                      onChange={(e) => { updateCanvasSettings({ gridSize: e.target.value as GridSize }); }}
                    >
                      <option value="fine">Fine</option>
                      <option value="standard">Standard</option>
                      <option value="coarse">Coarse</option>
                    </select>
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-handle-size">
                      Edit Handle Size
                      <span className={css.settingDesc}>Controls the size of draggable edit handles.</span>
                    </label>
                    <select
                      id="setting-handle-size"
                      className={css.select}
                      value={settings.canvas.handleSizePx}
                      onChange={(e) => { updateCanvasSettings({ handleSizePx: Number(e.target.value) }); }}
                    >
                      <option value={7}>Small</option>
                      <option value={9}>Medium</option>
                      <option value={11}>Large</option>
                    </select>
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-zoom-speed">
                      Zoom Speed
                      <span className={css.settingDesc}>
                        Slow ↔ Fast ({settings.canvas.zoomSpeed.toFixed(4)})
                      </span>
                    </label>
                    <input
                      id="setting-zoom-speed"
                      className={css.range}
                      type="range"
                      min={0.0015}
                      max={0.009}
                      step={0.0005}
                      list="zoom-speed-ticks"
                      value={settings.canvas.zoomSpeed}
                      onChange={(e) => { updateCanvasSettings({ zoomSpeed: Number(e.target.value) }); }}
                    />
                    <datalist id="zoom-speed-ticks">
                      <option value={0.0045} />
                    </datalist>
                  </div>
                </div>

                <div className={css.panelTitle}>Rendering</div>
                <div className={css.settingsGroup}>
                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-mathjax-font">
                      Math Font
                      <span className={css.settingDesc}>Font used to render math in text nodes.</span>
                    </label>
                    <select
                      id="setting-mathjax-font"
                      className={css.select}
                      value={settings.rendering.mathJaxFont}
                      onChange={(e) => { updateRenderingSettings({ mathJaxFont: e.target.value as MathJaxFont }); }}
                    >
                      {MATHJAX_FONTS.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className={css.fontPreviewRow}>
                    <img
                      key={settings.rendering.mathJaxFont}
                      className={css.fontPreviewImg}
                      src={`${import.meta.env.BASE_URL}font-previews/${settings.rendering.mathJaxFont}.svg`}
                      alt={`Preview of ${settings.rendering.mathJaxFont}`}
                    />
                  </div>
                </div>

                <div className={css.resetRow}>
                  <button
                    type="button"
                    className={css.resetButton}
                    data-testid="settings-reset-canvas"
                    onClick={resetActiveCategoryToDefaults}
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}
