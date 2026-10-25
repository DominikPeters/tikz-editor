import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from "react";
import type { Span } from "@tikz-editor/core/ast/types";
import type {
  DeckInspectorCommand,
  DeckInspectorField,
  DeckInspectorWrite,
} from "@tikz-editor/core/beamer/index";
import { CustomDropdown } from "../CustomDropdown";
import { ColorPickerField } from "../ColorPicker";
import { BASIC_PICKER_COLORS } from "../../colors/color-palette";
import css from "./InspectorPanel.module.css";

export type DeckFieldCommit = (write: DeckInspectorWrite, value: string | number | boolean | null) => void;
export type DeckFieldScrub = (
  event: ReactPointerEvent<HTMLElement>,
  field: Extract<DeckInspectorField, { kind: "number" }>
) => void;

/**
 * One deck inspector row. A field without a `write` is one the editor can
 * show but not change yet; it renders disabled with its real value. Its
 * reason shows once per blocker (`showReadOnlyNote`), not under every field
 * the blocker disables.
 */
type DeckFieldProps = {
  field: DeckInspectorField;
  onCommit: DeckFieldCommit;
  onBeginScrub?: DeckFieldScrub;
  onCommand?: (command: DeckInspectorCommand) => void;
  showReadOnlyNote?: boolean;
};

export function DeckField(props: DeckFieldProps): JSX.Element {
  const readOnly = props.showReadOnlyNote === false ? null : props.field.readOnly;
  return <>
    <DeckFieldControl {...props} />
    {readOnly ? <DeckReadOnlyNote reason={readOnly.reason} span={readOnly.span} {...(props.onCommand ? { onCommand: props.onCommand } : {})} /> : null}
  </>;
}

export function DeckReadOnlyNote(props: { reason: string; span: Span; onCommand?: (command: DeckInspectorCommand) => void }): JSX.Element {
  const { reason, span, onCommand } = props;
  return (
    <p className={css.deckReadOnlyReason}>
      {reason}{" "}
      {onCommand ? <button type="button" className={css.deckInfoLink} onClick={() => { onCommand({ kind: "revealSource", span }); }}>Show in Source</button> : null}
    </p>
  );
}

function DeckFieldControl(props: DeckFieldProps): JSX.Element {
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
      return <DeckColorField field={field} onCommit={onCommit} />;
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
  const skipBlur = useRef(false);
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
            if (skipBlur.current) { skipBlur.current = false; return; }
            if (draft != null) {
              commitDraft(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              skipBlur.current = true;
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              skipBlur.current = true;
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
  const skipBlur = useRef(false);
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
            if (skipBlur.current) { skipBlur.current = false; return; }
            if (draft != null) {
              commitDraft(event.currentTarget.value);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              skipBlur.current = true;
              commitDraft(event.currentTarget.value);
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              skipBlur.current = true;
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
 * A Beamer color role: one picker per side the role is shown with, text
 * color first. A value reads as the preamble wrote it, or in italics when it
 * comes from the theme (the inspector's convention for inherited values); a
 * side the preamble sets offers "Use Theme Color" in its picker.
 */
function DeckColorField(props: {
  field: Extract<DeckInspectorField, { kind: "color" }>;
  onCommit: DeckFieldCommit;
}): JSX.Element {
  const { field, onCommit } = props;
  const both = field.fg !== undefined && field.bg !== undefined;
  const sides = (["fg", "bg"] as const).filter(side => field[side] !== undefined);
  return (
    <div className={css.property}>
      <div className={css.propertyLabel}>{field.label}</div>
      <div className={`${css.controlRow} ${css.deckColorRow}`}>
        {sides.map(side => {
          const color = field[side] ?? null;
          const label = both ? `${field.label} ${side === "fg" ? "text" : "fill"}` : field.label;
          const inherited = color?.role !== undefined && color.role !== field.role;
          const origin = inherited ? `inherited from ${color.role}` : color?.origin === "preamble" ? "set in the preamble" : "from the theme";
          const write = { kind: "setColor" as const, role: field.role, side };
          return (
            <div key={side} className={css.deckColorSide} title={`${both ? `${side === "fg" ? "Text" : "Fill"}: ` : ""}${color?.expression ?? color?.css ?? "none"} — ${origin}`}>
              <ColorPickerField ariaLabel={label} options={BASIC_PICKER_COLORS}
                namedColorSwatches={field.namedColorSwatches} value={color?.css ?? null}
                resolvedValue={color?.css ?? null}
                syntaxValue={color?.expression === "" ? "none" : color?.expression ?? null}
                triggerLabelClassName={color?.origin === "theme" || inherited ? css.provenanceValue ?? "" : ""}
                preserveNamedColorSpelling commitOnRelease swatchOnly={both} disabled={field.write === null}
                {...(field.write && field.resetSides.includes(side) ? { resetLabel: "Use Theme Color", onReset: () => { onCommit(write, null); } } : {})}
                onChange={value => { onCommit(write, value === "none" ? "" : value); }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
