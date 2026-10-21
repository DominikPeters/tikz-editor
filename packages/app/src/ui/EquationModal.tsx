import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import css from "./EquationModal.module.css";

type EquationModalMode = "insert" | "edit";

type EquationModalProps = {
  mode: EquationModalMode;
  initialLatex?: string;
  onClose: () => void;
  onConfirm: (latex: string) => void;
  onValueChange?: (latex: string) => void;
};

type MathFieldElementLike = HTMLElement & {
  value: string;
};

function isMathFieldElement(element: HTMLElement): element is MathFieldElementLike {
  return "value" in element && typeof element.value === "string";
}

type LibraryPhase = "loading" | "ready" | "error";

let mathLiveLoadPromise: Promise<void> | null = null;
let mathLiveLoaded = false;
const MATHLIVE_MODAL_LAYER_ZINDEX = "350";

async function ensureMathLiveLoaded(): Promise<void> {
  if (mathLiveLoaded) {
    return;
  }
  if (mathLiveLoadPromise) {
    return mathLiveLoadPromise;
  }
  mathLiveLoadPromise = (async () => {
    await import("mathlive/fonts.css");
    await import("mathlive");
    mathLiveLoaded = true;
  })();
  return mathLiveLoadPromise;
}

export function EquationModal({ mode, initialLatex = "", onClose, onConfirm, onValueChange }: EquationModalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mathFieldRef = useRef<MathFieldElementLike | null>(null);
  const [phase, setPhase] = useState<LibraryPhase>("loading");
  const [value, setValue] = useState(initialLatex);

  useEffect(() => {
    setValue(initialLatex);
  }, [initialLatex]);

  useEffect(() => {
    onValueChange?.(value);
  }, [onValueChange, value]);

  useEffect(() => {
    let cancelled = false;
    ensureMathLiveLoaded()
      .then(() => {
        if (!cancelled) {
          setPhase("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPhase("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const targets = [document.documentElement, document.body];
    const previous = targets.map((target) => ({
      target,
      suggestionZIndex: target.style.getPropertyValue("--suggestion-zindex"),
      keyboardZIndex: target.style.getPropertyValue("--keyboard-zindex")
    }));

    for (const { target } of previous) {
      target.style.setProperty("--suggestion-zindex", MATHLIVE_MODAL_LAYER_ZINDEX);
      target.style.setProperty("--keyboard-zindex", MATHLIVE_MODAL_LAYER_ZINDEX);
    }

    return () => {
      for (const entry of previous) {
        if (entry.suggestionZIndex) {
          entry.target.style.setProperty("--suggestion-zindex", entry.suggestionZIndex);
        } else {
          entry.target.style.removeProperty("--suggestion-zindex");
        }
        if (entry.keyboardZIndex) {
          entry.target.style.setProperty("--keyboard-zindex", entry.keyboardZIndex);
        } else {
          entry.target.style.removeProperty("--keyboard-zindex");
        }
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== "ready") {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }

    host.innerHTML = "";
    const field = document.createElement("math-field");
    if (!isMathFieldElement(field)) throw new Error("MathLive did not register its equation field");
    field.className = css.mathField ?? "";
    field.value = value;

    const onInput = () => {
      setValue(field.value);
    };
    field.addEventListener("input", onInput);
    host.appendChild(field);
    field.focus();
    mathFieldRef.current = field;

    return () => {
      field.removeEventListener("input", onInput);
      if (mathFieldRef.current === field) {
        mathFieldRef.current = null;
      }
    };
  }, [phase, value]);

  useEffect(() => {
    if (phase !== "ready") {
      return;
    }
    const field = mathFieldRef.current;
    if (!field || field.value === value) {
      return;
    }
    field.value = value;
  }, [phase, value]);

  const title = mode === "insert" ? "Insert Equation" : "Edit Equation";
  const confirmLabel = mode === "insert" ? "Insert" : "Save";
  const canConfirm = useMemo(() => value.trim().length > 0 && phase === "ready", [phase, value]);

  return (
    <Modal
      variant="panel"
      onClose={onClose}
      labelledBy="equation-title"
      dataTestId="equation-modal"
      draggable
      resizable
      closeOnBackdrop
      initialWidth={720}
      className={css.dialog ?? ""}
    >
      <Modal.Header
        title={title}
        titleId="equation-title"
        draggable
        showCloseButton
        onClose={onClose}
        closeAriaLabel="Close equation editor"
      />

      <Modal.Body>
        {phase === "loading" ? <div className={css.status} data-select="text">Loading equation editor…</div> : null}
        {phase === "error" ? <div className={css.statusError} data-select="text">Failed to load equation editor.</div> : null}
        <div className={css.editorHost} ref={hostRef} />
      </Modal.Body>

      <Modal.Footer>
        <Modal.SecondaryButton onClick={onClose}>Cancel</Modal.SecondaryButton>
        <Modal.PrimaryButton
          disabled={!canConfirm}
          onClick={() => {
            if (!canConfirm) {
              return;
            }
            onConfirm(value);
          }}
        >
          {confirmLabel}
        </Modal.PrimaryButton>
      </Modal.Footer>
    </Modal>
  );
}
