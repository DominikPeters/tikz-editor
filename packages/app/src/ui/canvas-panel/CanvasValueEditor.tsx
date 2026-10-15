import { requireArrayValue } from "@tikz-editor/core/utils/collections";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ValueKind } from "@tikz-editor/core/editing/operations/index";
import { BASIC_PICKER_COLORS } from "../../colors/color-palette";
import { useProjectNamedColorSwatches } from "../../colors/project-named-colors";
import { ColorPicker } from "../ColorPicker";
import css from "./CanvasPanel.module.css";
import { useClearOfBand, type ClearBand } from "./useClearOfBand";

export type CanvasValueEditorField = {
  readonly kind: ValueKind;
  readonly open: string;
  readonly close: string;
  readonly optional: boolean;
};

/**
 * The value editor (O8): a command in source form with a field for each
 * value (`\href{▢}{…}`), at the caret for a command being written, or at
 * a construct's tag for the values it has. ⏎ writes; Esc writes nothing;
 * ⇥ moves between fields; a `}` typed at a field's end closes it, as in
 * source.
 */
export type CanvasValueEditorModel = {
  /** Identity: a new key starts the fields over. */
  readonly key: string;
  readonly command: string;
  /** The command's arguments in order: a field, or source shown as it stands (`{…}`). */
  readonly parts: readonly ({ readonly type: "field"; readonly field: number } | { readonly type: "text"; readonly text: string })[];
  readonly fields: readonly CanvasValueEditorField[];
  readonly initial: readonly string[];
  /** Viewport px: the editor's left edge. */
  readonly left: number;
  /**
   * Viewport px: the lines the editor must leave visible (the construct
   * whose values it edits, or the caret's or selection's lines). It goes
   * above or below them, its colour picker on the same side.
   */
  readonly band: ClearBand;
  /** The side to take when both have room: above for a construct's tag, below the caret for a new command. */
  readonly prefer: "above" | "below";
  /** Why the values cannot be written, by field; null when they can. */
  readonly problems: (values: readonly string[]) => readonly (string | null)[] | null;
  readonly onSubmit: (values: readonly string[], viaBrace: boolean) => void;
  readonly onCancel: () => void;
};

const HINTS: Record<ValueKind, string> = {
  color: "colour",
  url: "URL",
  dimension: "length",
  "label-key": "key",
  overlay: "slides",
  options: "options",
  spec: "columns",
  value: "",
};

/** Whether the braces in a field's text are all closed, so a `}` typed now closes the field. */
function closed(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
    } else if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
    }
  }
  return depth <= 0;
}

export function CanvasValueEditor({ model }: { model: CanvasValueEditorModel }) {
  const [values, setValues] = useState<string[]>(() => [...model.initial]);
  const [focused, setFocused] = useState(0);
  const [problems, setProblems] = useState<readonly (string | null)[] | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const root = useRef<HTMLDivElement | null>(null);
  const namedColorSwatches = useProjectNamedColorSwatches();

  // (In a colour model, `[rgb]`, the colour is numbers, which the picker does not write.)
  const inModel = model.fields.some((field, index) => field.open === "[" && requireArrayValue(values, index).trim() !== "");
  const showsPicker = model.fields[focused]?.kind === "color" && !inModel;
  const focusedValue = values[focused];
  const pickerValue = focusedValue === undefined || focusedValue.length === 0 ? null : focusedValue;

  const placement = useClearOfBand(root, model.band, model.prefer, model.left, showsPicker);

  useEffect(() => {
    const input = inputs.current[0];
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const focus = (index: number) => {
    const input = inputs.current[index];
    input?.focus({ preventScroll: true });
    input?.select();
  };

  const submit = (viaBrace: boolean) => {
    const found = model.problems(values);
    if (found) {
      setProblems(found);
      const first = found.findIndex((problem) => problem != null);
      focus(first >= 0 ? first : 0);
      return;
    }
    model.onSubmit(values, viaBrace);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, index: number) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submit(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      model.onCancel();
    } else if (event.key === "Tab" && model.fields.length > 1) {
      event.preventDefault();
      focus((index + (event.shiftKey ? model.fields.length - 1 : 1)) % model.fields.length);
    } else if (event.key === "}" && closed(requireArrayValue(values, index))) {
      event.preventDefault();
      if (index + 1 < model.fields.length) {
        focus(index + 1);
      } else {
        submit(true);
      }
    }
  };

  const problem = problems?.find((each) => each != null) ?? null;
  return (
    <div
      ref={root}
      className={placement.side === "above" ? css.valueEditorAbove : css.valueEditor}
      style={placement.style}
      data-side={placement.side}
      data-canvas-value-editor=""
      data-testid="canvas-value-editor"
      onPointerDown={(event) => { event.stopPropagation(); }}
    >
      <div className={css.valueEditorSyntax}>
        <span>\{model.command}</span>
        {model.parts.map((part, partIndex) => {
          if (part.type === "text") {
            return <span key={partIndex} className={css.valueEditorFixed}>{part.text}</span>;
          }
          const index = part.field;
          const field = requireArrayValue(model.fields, index);
          return (
            <span key={partIndex}>
              {field.open}
              <input
                ref={(element) => { inputs.current[index] = element; }}
                className={problems?.[index] ? css.valueEditorInputProblem : css.valueEditorInput}
                value={values[index]}
                placeholder={HINTS[field.kind] || (field.optional ? "optional" : "")}
                spellCheck={false}
                autoComplete="off"
                aria-label={`${HINTS[field.kind] || "value"} of \\${model.command}`}
                data-testid={`canvas-value-editor-field-${index}`}
                style={{ width: `${Math.max(4, Math.max(requireArrayValue(values, index).length, (HINTS[field.kind] || "").length) + 1)}ch` }}
                onFocus={() => { setFocused(index); }}
                onChange={(event) => {
                  const next = [...values];
                  next[index] = event.target.value;
                  setValues(next);
                  setProblems(null);
                }}
                onKeyDown={(event) => { handleKeyDown(event, index); }}
              />
              {field.close}
            </span>
          );
        })}
      </div>
      {problem ? <div className={css.valueEditorProblem} role="alert">{problem}</div> : null}
      {showsPicker ? (
        <div className={css.valueEditorColor}>
          <ColorPicker
            ariaLabel={`Colour of \\${model.command}`}
            options={BASIC_PICKER_COLORS}
            namedColorSwatches={namedColorSwatches}
            value={pickerValue}
            syntaxValue={pickerValue}
            onChange={(next) => {
              const updated = [...values];
              updated[focused] = next;
              setValues(updated);
              setProblems(null);
              focus(focused);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
