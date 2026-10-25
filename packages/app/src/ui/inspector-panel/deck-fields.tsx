import { useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import type {
  DeckInspectorColor,
  DeckInspectorCommand,
  DeckInspectorField,
  DeckInspectorWrite,
} from "@tikz-editor/core/beamer/index";
import { CustomDropdown } from "../CustomDropdown";
import css from "./InspectorPanel.module.css";

export type DeckFieldCommit = (write: DeckInspectorWrite, value: string | number | boolean | null) => void;
export type DeckFieldScrub = (
  event: ReactPointerEvent<HTMLElement>,
  field: Extract<DeckInspectorField, { kind: "number" }>
) => void;

/**
 * One deck inspector row. A field without a `write` is one the editor can
 * show but not change yet; it renders disabled with its real value.
 */
export function DeckField(props: {
  field: DeckInspectorField;
  onCommit: DeckFieldCommit;
  onBeginScrub?: DeckFieldScrub;
  onCommand?: (command: DeckInspectorCommand) => void;
}): JSX.Element {
  const { field, onCommit, onBeginScrub, onCommand } = props;
  const write = field.write;
  const commit = (value: string | number | boolean | null): void => {
    if (write) onCommit(write, value);
  };
  switch (field.kind) {
    case "enum":
      return (
        <div className={css.property}>
          <div className={css.propertyLabel}>{field.label}</div>
          <CustomDropdown
            ariaLabel={field.label}
            value={field.value}
            options={[...field.options]}
            disabled={write == null}
            onChange={(next) => { commit(next); }}
          />
        </div>
      );
    case "boolean":
      return (
        <div className={`${css.property} ${css.deckBooleanProperty}`}>
          <label className={css.checkboxControl}>
            <input
              className={css.checkboxInput}
              type="checkbox"
              checked={field.value}
              disabled={write == null}
              onChange={(event) => { commit(event.currentTarget.checked); }}
            />
            <span className={css.checkboxLabel}>{field.label}</span>
          </label>
        </div>
      );
    case "text":
      return <DeckTextField field={field} onCommit={commit} />;
    case "number":
      return <DeckNumberField field={field} onCommit={commit} {...(onBeginScrub ? { onBeginScrub } : {})} />;
    case "color":
      return <DeckColorField field={field} />;
    case "button":
      return (
        <div className={`${css.property} ${css.deckBooleanProperty}`}>
          <button
            type="button"
            className={css.deckCommandButton}
            disabled={onCommand == null}
            onClick={() => { onCommand?.(field.command); }}
          >
            {field.label}
          </button>
        </div>
      );
    case "message":
      return <p className={css.deckObjectMessage}>{field.text}</p>;
    case "code":
      return (
        <div className={`${css.property} ${css.deckBooleanProperty}`}>
          <pre className={css.deckCode} aria-label={field.label}>{field.text}</pre>
        </div>
      );
  }
}

function DeckTextField(props: {
  field: Extract<DeckInspectorField, { kind: "text" }>;
  onCommit: (value: string) => void;
}): JSX.Element {
  const { field, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = (value: string): void => {
    setDraft(null);
    if (value !== field.value) {
      onCommit(value);
    }
  };
  return (
    <div className={css.property}>
      <div className={css.propertyLabel}>{field.label}</div>
      <div className={css.controlRow}>
        <input
          className={css.textInput}
          type="text"
          aria-label={field.label}
          value={draft ?? field.value}
          placeholder={field.placeholder}
          disabled={field.write == null}
          title={field.write == null && field.value.length > 0 ? field.value : undefined}
          onChange={(event) => { setDraft(event.currentTarget.value); }}
          onBlur={(event) => {
            if (draft != null) {
              commitDraft(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}

function DeckNumberField(props: {
  field: Extract<DeckInspectorField, { kind: "number" }>;
  onCommit: (value: number | null) => void;
  onBeginScrub?: DeckFieldScrub;
}): JSX.Element {
  const { field, onCommit, onBeginScrub } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const scrubbable = field.value != null && field.write != null && onBeginScrub != null;
  const commitDraft = (raw: string): void => {
    setDraft(null);
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      if (field.value != null) {
        onCommit(null);
      }
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed === field.value) {
      return;
    }
    onCommit(parsed);
  };
  return (
    <div className={css.property}>
      <div
        className={
          scrubbable
            ? `${css.propertyLabel} ${css.propertyLabelScrubbable}`
            : css.propertyLabel
        }
        onPointerDown={(event) => { if (scrubbable) onBeginScrub(event, field); }}
      >
        {field.label}
      </div>
      <div className={css.controlRow}>
        <input
          className={css.numberInput}
          type="number"
          aria-label={field.label}
          step={field.step}
          min={field.min}
          max={field.max}
          value={draft ?? (field.value != null ? String(field.value) : "")}
          placeholder={field.value == null ? field.placeholder ?? "Auto" : undefined}
          disabled={field.write == null}
          onChange={(event) => { setDraft(event.currentTarget.value); }}
          onBlur={(event) => {
            if (draft != null) {
              commitDraft(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
        {field.unit ? <span className={css.unitLabel}>{field.unit}</span> : null}
      </div>
    </div>
  );
}

/**
 * A Beamer color role. Roles with both sides show a sample of the text color
 * on the fill, the way the theme paints them; one-sided roles show a swatch.
 * The value reads as the preamble wrote it, or in italics when it comes from
 * the theme (the inspector's convention for inherited values).
 */
function DeckColorField(props: {
  field: Extract<DeckInspectorField, { kind: "color" }>;
}): JSX.Element {
  const { field } = props;
  const fg = field.fg ?? null;
  const bg = field.bg ?? null;
  const both = field.fg !== undefined && field.bg !== undefined;
  const shown = both ? bg ?? fg : fg ?? bg;
  const describe = (color: DeckInspectorColor | null): string => color?.expression ?? color?.css ?? "none";
  const valueText = both && fg && bg ? `${describe(fg)} on ${describe(bg)}` : describe(shown);
  const inherited = field.origin === "theme";
  return (
    <div className={css.property}>
      <div className={css.propertyLabel}>{field.label}</div>
      <div
        className={css.deckColorValue}
        title={`${valueText} — ${inherited ? "from the theme" : "set in the preamble"}`}
      >
        {both ? (
          <span
            className={css.deckColorSample}
            style={{ background: bg?.css ?? field.backdrop ?? "transparent", color: fg?.css ?? "inherit" }}
            aria-hidden="true"
          >
            Aa
          </span>
        ) : (
          <span
            className={css.deckColorSwatch}
            style={{ background: shown?.css ?? "transparent" }}
            aria-hidden="true"
          />
        )}
        <span className={inherited ? `${css.deckColorText} ${css.provenanceValue}` : css.deckColorText}>
          {valueText}
        </span>
      </div>
    </div>
  );
}
