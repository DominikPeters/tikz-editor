import { useEffect, useRef, useState } from "react";
import { getActiveEditorPlatform } from "../platform/current";
import { Modal } from "../ui/Modal";
import settingsCss from "../ui/SettingsModal.module.css";
import { launchPresentation } from "./launch";
import { loadPresentationOptions, presentationService, savePresentationOptions } from "./service";
import type { PresentationDisplay, PresentationOptions } from "./types";
import css from "./PresentationControls.module.css";

export function PresentationOptionsModal({ onClose, active }: { onClose: () => void; active: boolean }) {
  const [options, setOptions] = useState(loadPresentationOptions);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [displays, setDisplays] = useState<PresentationDisplay[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState<"current" | "beginning">("current");
  const desktop = getActiveEditorPlatform().id.startsWith("desktop");
  const showPresenter = options.mode === "rehearse" || (options.showPresenter ?? (!desktop || options.mode === "window" || displays.length > 1));
  useEffect(() => {
    let disposed = false;
    void getActiveEditorPlatform().presentation?.displays().then(value => {
      if (disposed) return;
      setDisplays(value);
      const previous = optionsRef.current;
      if (previous.audienceDisplay && !value.some(display => display.id === previous.audienceDisplay)) {
        setError("The previous audience display isn’t connected. Choose a display below.");
        setOptions(current => ({ ...current, audienceDisplay: null }));
      }
      if (previous.presenterDisplay && !value.some(display => display.id === previous.presenterDisplay)) {
        setError("The previous presenter display isn’t connected. Choose a display below.");
        setOptions(current => ({ ...current, presenterDisplay: null }));
      }
    }).catch(() => { if (!disposed) setError("Couldn’t read the connected displays."); });
    return () => { disposed = true; };
  }, []);
  const patch = (value: Partial<PresentationOptions>) => { setOptions(previous => ({ ...previous, ...value })); };
  return <Modal onClose={onClose} size="md" labelledBy="presentation-options-title" dataTestId="presentation-options">
    <form className={css.options} onSubmit={event => {
      event.preventDefault(); savePresentationOptions(options);
      if (active) {
        void presentationService.recoverOutput(options.audienceDisplay).then(onClose).catch(error_ => { setError(error_ instanceof Error ? error_.message : "Couldn’t restore the audience output."); });
      } else { onClose(); launchPresentation(from, undefined, options); }
    }}>
      <Modal.Header
        title="Presentation Options"
        titleId="presentation-options-title"
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close presentation options"
      />
      <Modal.Body>
        {error ? <p className={css.optionsError} role="status">{error}</p> : null}
        {!active ? <div className={settingsCss.settingsGroup}>
          <div className={settingsCss.settingRow}>
            <label className={settingsCss.settingLabel} htmlFor="presentation-start-from">Start from</label>
            <select id="presentation-start-from" className={settingsCss.select} value={from} onChange={event => { setFrom(event.target.value as "current" | "beginning"); }}>
              <option value="current">Current Slide</option><option value="beginning">Beginning</option>
            </select>
          </div>
          <div className={settingsCss.settingRow}>
            <label className={settingsCss.settingLabel} htmlFor="presentation-mode">Present</label>
            <select id="presentation-mode" className={settingsCss.select} aria-label="Presentation mode" value={options.mode} onChange={event => { patch({ mode: event.target.value as PresentationOptions["mode"] }); }}>
              <option value="display">On a Display</option><option value="window">In a Window</option><option value="rehearse">Rehearse</option>
            </select>
          </div>
        </div> : null}
        {desktop ? <div className={settingsCss.settingsGroup}>
          {active || options.mode !== "rehearse" ? <div className={settingsCss.settingRow}>
            <label className={settingsCss.settingLabel} htmlFor="presentation-audience-display">Audience display</label>
            <select id="presentation-audience-display" className={[settingsCss.select, css.displaySelect].join(" ")} value={options.audienceDisplay ?? ""} onChange={event => { patch({ audienceDisplay: event.target.value || null }); setError(null); }}>
              <option value="">Default Display</option>{displays.map((display, index) => <option key={display.id} value={display.id}>{index + 1}. {display.name}{display.primary ? " (Main)" : ""} · {display.width} × {display.height}</option>)}
            </select>
          </div> : null}
          {getActiveEditorPlatform().presentation?.identifyDisplays ? <div className={[settingsCss.settingRow, css.identifyRow].join(" ")}>
            <Modal.SecondaryButton onClick={() => {
              void getActiveEditorPlatform().presentation?.identifyDisplays?.().catch(error_ => { setError(error_ instanceof Error ? error_.message : "Couldn’t identify the displays."); });
            }}>Identify Displays</Modal.SecondaryButton>
          </div> : null}
        </div> : null}
        {!desktop && options.mode === "display" ? <p className={settingsCss.settingDesc}>Move the audience window to your display, then enter fullscreen there.</p> : null}
        {!active ?
          <div className={settingsCss.settingsGroup}>
            <div className={settingsCss.settingRow}>
              <label className={settingsCss.settingLabel} htmlFor="presentation-show-presenter">Show Presenter View</label>
              <input id="presentation-show-presenter" className={settingsCss.checkbox} type="checkbox" checked={showPresenter} onChange={event => { patch({ showPresenter: event.target.checked }); }} disabled={options.mode === "rehearse"} />
            </div>
            {desktop && showPresenter ? <div className={settingsCss.settingRow}>
              <label className={settingsCss.settingLabel} htmlFor="presentation-presenter-display">Presenter display</label>
              <select id="presentation-presenter-display" className={[settingsCss.select, css.displaySelect].join(" ")} value={options.presenterDisplay ?? ""} onChange={event => { patch({ presenterDisplay: event.target.value || null }); }}>
                <option value="">Main Display</option>{displays.map((display, index) => <option key={display.id} value={display.id}>{index + 1}. {display.name}</option>)}
              </select>
            </div> : null}
            <div className={settingsCss.settingRow}>
              <label className={settingsCss.settingLabel} htmlFor="presentation-countdown">
                Countdown budget
                <span className={settingsCss.settingDesc}>Optional, in minutes.</span>
              </label>
              <input id="presentation-countdown" className={settingsCss.numberInput} type="number" min="1" max="1440" aria-label="Countdown budget" value={options.countdownMinutes ?? ""} onChange={event => { patch({ countdownMinutes: event.target.value ? Math.max(1, Math.min(1440, Number(event.target.value))) : null }); }} />
            </div>
          </div>
        : null}
      </Modal.Body>
      <Modal.Footer>
        <Modal.SecondaryButton onClick={onClose}>Cancel</Modal.SecondaryButton>
        <Modal.PrimaryButton type="submit">{active ? "Show Audience Output" : options.mode === "rehearse" ? "Rehearse" : "Start Presentation"}</Modal.PrimaryButton>
      </Modal.Footer>
    </form>
  </Modal>;
}
