import { useEffect, useState } from "react";
import { getActiveEditorPlatform } from "../platform/current";
import { useSettingsStore } from "../settings/useSettingsStore";
import {
  CANVAS_HANDLE_SIZE_OPTIONS, CANVAS_ZOOM_SPEED_MIN, CANVAS_ZOOM_SPEED_MAX, CANVAS_ZOOM_SPEED_STEP,
  EDITOR_FONT_SIZE_OPTIONS, UI_FONT_SIZE_OPTIONS, MIN_FORMATTER_MAX_LINE_LENGTH, MAX_FORMATTER_MAX_LINE_LENGTH,
  type CanvasTextEditPlacement, type ColorPickerAccuracy, type ColorScheme, type GridSize
} from "../settings/types";
import { Modal } from "./Modal";
import css from "./SettingsModal.module.css";

type CategoryId = "general" | "editor" | "canvas";

const CATEGORIES: { id: CategoryId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Code Editor" },
  { id: "canvas", label: "Canvas" }
];

let rememberedCategory: CategoryId = "general";

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryId>(rememberedCategory);
  const [formatterMaxLineLengthInput, setFormatterMaxLineLengthInput] = useState<string | null>(null);
  const automaticUpdates = useAutomaticUpdateChecksSetting();

  const selectCategory = (id: CategoryId) => {
    rememberedCategory = id;
    setActiveCategory(id);
  };
  const settings = useSettingsStore((s) => s.settings);
  const updateGeneralSettings = useSettingsStore((s) => s.updateGeneralSettings);
  const updateEditorSettings = useSettingsStore((s) => s.updateEditorSettings);
  const updateCanvasSettings = useSettingsStore((s) => s.updateCanvasSettings);
  const updateColorPickerSettings = useSettingsStore((s) => s.updateColorPickerSettings);
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
      void automaticUpdates.reset();
      return;
    }
    if (activeCategory === "editor") {
      resetEditorSettings();
      setFormatterMaxLineLengthInput(null);
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
                      {UI_FONT_SIZE_OPTIONS.map((size) => (
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
                  <AutomaticUpdateChecksSetting preference={automaticUpdates} />
                </div>
                <div className={css.resetRow}>
                  <button
                    type="button"
                    className={css.resetButton}
                    data-testid="settings-reset-general"
                    disabled={automaticUpdates.busy || (automaticUpdates.available && automaticUpdates.enabled === null)}
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
                      {CANVAS_HANDLE_SIZE_OPTIONS.map((size, index) => (
                        <option key={size} value={size}>{["Small", "Medium", "Large"][index]}</option>
                      ))}
                    </select>
                  </div>

                  <div className={css.settingRow}>
                    <label className={css.settingLabel} htmlFor="setting-text-edit-placement">
                      Text Editing Surface
                      <span className={css.settingDesc}>
                        Where canvas text editing shows the source. Long buffers always use the docked bar.
                      </span>
                    </label>
                    <select
                      id="setting-text-edit-placement"
                      className={css.select}
                      value={settings.canvas.textEditPlacement}
                      onChange={(e) => {
                        updateCanvasSettings({
                          textEditPlacement: e.target.value as CanvasTextEditPlacement
                        });
                      }}
                    >
                      <option value="popup">Floating popup</option>
                      <option value="bar">Docked bar</option>
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
                      min={CANVAS_ZOOM_SPEED_MIN}
                      max={CANVAS_ZOOM_SPEED_MAX}
                      step={CANVAS_ZOOM_SPEED_STEP}
                      list="zoom-speed-ticks"
                      value={settings.canvas.zoomSpeed}
                      onChange={(e) => { updateCanvasSettings({ zoomSpeed: Number(e.target.value) }); }}
                    />
                    <datalist id="zoom-speed-ticks">
                      <option value={0.0045} />
                    </datalist>
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

function useAutomaticUpdateChecksSetting() {
  const updates = getActiveEditorPlatform().updates;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    if (updates?.getAutomaticUpdateChecks) {
      void updates.getAutomaticUpdateChecks().then((value) => {
        if (!disposed) setEnabled(value);
      }).catch(() => {
        if (!disposed) setError("Could not load update preferences.");
      });
    }
    return () => { disposed = true; };
  }, [updates]);

  const save = async (value: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await updates?.setAutomaticUpdateChecks?.(value);
      setEnabled(value);
    } catch {
      setError("Could not save update preferences.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!updates?.resetAutomaticUpdateChecks) return;
    setBusy(true);
    setError(null);
    try {
      setEnabled(await updates.resetAutomaticUpdateChecks());
    } catch {
      setError("Could not reset update preferences.");
    } finally {
      setBusy(false);
    }
  };

  return {
    available: Boolean(updates?.getAutomaticUpdateChecks && updates.setAutomaticUpdateChecks),
    enabled, busy, error, save, reset
  };
}

function AutomaticUpdateChecksSetting({ preference }: { preference: ReturnType<typeof useAutomaticUpdateChecksSetting> }) {
  const { available, enabled, busy, error, save } = preference;
  if (!available) return null;

  return (
    <div className={css.settingRow}>
      <label className={css.settingLabel} htmlFor="setting-automatic-update-checks">
        Automatically Check for Updates on Startup
        {error ? <span className={css.settingDesc} role="alert">{error}</span> : null}
      </label>
      <input
        id="setting-automatic-update-checks"
        type="checkbox"
        className={css.checkbox}
        checked={enabled ?? false}
        disabled={enabled === null || busy}
        onChange={(event) => { void save(event.target.checked); }}
      />
    </div>
  );
}
