import { useEffect, useRef, type ReactNode } from "react";
import css from "./ToolbarToolPopup.module.css";

export function ToolbarToolPopup({
  open,
  onClose,
  popup,
  children,
  popupTestId,
  popupClassName
}: {
  open: boolean;
  onClose: () => void;
  popup: ReactNode;
  children: ReactNode;
  popupTestId?: string;
  popupClassName?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (!rootRef.current?.contains(target)) {
        onClose();
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("pointerdown", onPointerDown); };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [onClose, open]);

  return (
    <div className={css.root} ref={rootRef}>
      {children}
      {open ? (
        <div
          className={[css.popup, popupClassName ?? ""].filter(Boolean).join(" ")}
          role="dialog"
          aria-label="Tool options"
          data-testid={popupTestId}
        >
          {popup}
        </div>
      ) : null}
    </div>
  );
}

export function ToolbarPopupSection({
  title,
  children
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className={css.section}>
      {title ? <div className={css.sectionTitle}>{title}</div> : null}
      {children}
    </section>
  );
}

export type ToolbarPopupVisualChoice = {
  id: string;
  label: string;
  previewSvg?: string | null;
};

export function ToolbarPopupVisualChoiceGrid({
  choices,
  selectedId,
  onSelect,
  testIdPrefix
}: {
  choices: readonly ToolbarPopupVisualChoice[];
  selectedId: string;
  onSelect: (id: string) => void;
  testIdPrefix?: string;
}) {
  return (
    <div className={css.visualChoiceGrid} role="listbox" aria-label="Node shapes">
      {choices.map((choice) => {
        const selected = choice.id === selectedId;
        const testId = testIdPrefix ? `${testIdPrefix}-${choice.id.replace(/\s+/g, "-")}` : undefined;
        return (
          <button
            key={choice.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid={testId}
            className={[css.visualChoiceButton, selected ? css.visualChoiceButtonSelected : ""].filter(Boolean).join(" ")}
            onClick={() => { onSelect(choice.id); }}
            title={choice.label}
          >
            <span className={css.visualChoicePreview} aria-hidden="true">
              {choice.previewSvg ? <span dangerouslySetInnerHTML={{ __html: choice.previewSvg }} /> : choice.label[0]}
            </span>
            <span className={css.visualChoiceLabel}>{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}
