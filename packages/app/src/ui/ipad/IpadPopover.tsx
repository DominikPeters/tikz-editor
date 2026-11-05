import { useEffect, useRef, type ReactNode } from "react";
import { RiCheckLine } from "@remixicon/react";
import css from "./IpadPopover.module.css";

export type IpadPopoverAlign = "start" | "center" | "end";

export function IpadPopover({
  open,
  onClose,
  align = "center",
  direction = "down",
  ariaLabel,
  trigger,
  children,
  testId
}: {
  open: boolean;
  onClose: () => void;
  align?: IpadPopoverAlign;
  direction?: "down" | "up";
  ariaLabel: string;
  trigger: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node) || hostRef.current?.contains(target)) {
        return;
      }
      onClose();
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  return (
    <div ref={hostRef} className={css.host}>
      {trigger}
      {open ? (
        <div
          className={css.popover}
          data-align={align}
          data-direction={direction}
          role="dialog"
          aria-label={ariaLabel}
          data-testid={testId}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function IpadMenu({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <div className={css.menu} role="menu" aria-label={ariaLabel}>
      {children}
    </div>
  );
}

export function IpadMenuItem({
  label,
  icon = null,
  checked,
  disabled = false,
  onSelect,
  testId
}: {
  label: string;
  icon?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      className={css.menuItem}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
    >
      <span className={css.menuItemLabel}>{label}</span>
      {checked ? (
        <span className={css.menuItemCheck} aria-hidden><RiCheckLine size={18} /></span>
      ) : icon ? <span className={css.menuItemIcon} aria-hidden>{icon}</span> : null}
    </button>
  );
}

export function IpadMenuSeparator() {
  return <div className={css.menuSeparator} role="separator" />;
}
