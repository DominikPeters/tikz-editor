import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import css from "./Modal.module.css";

type SheetSize = "sm" | "md" | "lg" | "xl" | "auto";

type CommonModalProps = {
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  dataTestId?: string;
  closeOnEscape?: boolean;
  children: ReactNode;
};

type SheetProps = CommonModalProps & {
  variant?: "sheet";
  size?: SheetSize;
  closeOnBackdrop?: boolean;
};

type PanelProps = CommonModalProps & {
  variant: "panel";
  draggable?: boolean;
  resizable?: boolean;
  closeOnBackdrop?: boolean;
  initialWidth?: number;
  initialHeight?: number;
};

type ModalProps = SheetProps | PanelProps;

const SHEET_SIZE_CLASS: Record<SheetSize, string> = {
  sm: css.sizeSm,
  md: css.sizeMd,
  lg: css.sizeLg,
  xl: css.sizeXl,
  auto: css.sizeAuto
};

export function Modal(props: ModalProps) {
  if (props.variant === "panel") {
    return <ModalPanel {...props} />;
  }
  return <ModalSheet {...props} />;
}

function ModalSheet({
  onClose,
  size = "md",
  labelledBy,
  describedBy,
  className,
  dataTestId,
  closeOnEscape = true,
  closeOnBackdrop = true,
  children
}: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    function onCancel(event: Event): void {
      event.preventDefault();
      if (closeOnEscape) {
        onClose();
      }
    }
    dialog.addEventListener("cancel", onCancel);
    return () => { dialog.removeEventListener("cancel", onCancel); };
  }, [closeOnEscape, onClose]);

  function onDialogPointerDown(event: ReactPointerEvent<HTMLDialogElement>): void {
    if (!closeOnBackdrop) {
      return;
    }
    if (event.target === dialogRef.current) {
      onClose();
    }
  }

  const classes = [css.sheet, SHEET_SIZE_CLASS[size], className].filter(Boolean).join(" ");

  return (
    <dialog
      ref={dialogRef}
      className={classes}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      data-testid={dataTestId}
      onPointerDown={onDialogPointerDown}
    >
      {children}
    </dialog>
  );
}

function ModalPanel({
  onClose,
  labelledBy,
  describedBy,
  className,
  dataTestId,
  closeOnEscape = true,
  closeOnBackdrop = false,
  draggable = false,
  resizable = false,
  initialWidth,
  initialHeight,
  children
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    if (!closeOnEscape) {
      return;
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => { window.removeEventListener("keydown", onKeyDown, { capture: true }); };
  }, [closeOnEscape, onClose]);

  useEffect(() => {
    if (!draggable) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      const dragState = dragStateRef.current;
      if (dragState?.pointerId !== event.pointerId) {
        return;
      }
      setOffset((current) => ({
        x: current.x + (event.clientX - dragState.startX),
        y: current.y + (event.clientY - dragState.startY)
      }));
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
      };
    }

    function onPointerUp(event: PointerEvent): void {
      if (dragStateRef.current?.pointerId === event.pointerId) {
        dragStateRef.current = null;
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [draggable]);

  function onPanelLayerPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!closeOnBackdrop) {
      return;
    }
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function onPanelPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!draggable) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest?.("[data-modal-drag-handle='true']")) {
      return;
    }
    if (target.closest("button, input, textarea, [contenteditable='true']")) {
      return;
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    panelRef.current?.setPointerCapture?.(event.pointerId);
  }

  const style = useMemo<CSSProperties>(() => {
    const out: CSSProperties = {
      transform: `translate(${offset.x}px, ${offset.y}px)`
    };
    if (initialWidth) {
      out.width = initialWidth;
    }
    if (initialHeight) {
      out.height = initialHeight;
    }
    return out;
  }, [offset.x, offset.y, initialWidth, initialHeight]);

  const classes = [
    css.panelWrap,
    resizable ? css.panelResizable : "",
    draggable ? css.panelDraggable : "",
    className
  ].filter(Boolean).join(" ");

  const layerClasses = [css.panelLayer, closeOnBackdrop ? "" : css.panelLayerPassive].filter(Boolean).join(" ");

  return (
    <div className={layerClasses} onPointerDown={onPanelLayerPointerDown}>
      <div
        ref={panelRef}
        className={classes}
        role="dialog"
        aria-modal="false"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        data-testid={dataTestId}
        style={style}
        onPointerDown={onPanelPointerDown}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

type ModalHeaderProps = {
  title: ReactNode;
  titleId?: string;
  trailing?: ReactNode;
  showCloseButton?: boolean;
  onClose?: () => void;
  closeAriaLabel?: string;
  draggable?: boolean;
  className?: string;
};

function ModalHeader({
  title,
  titleId,
  trailing,
  showCloseButton = false,
  onClose,
  closeAriaLabel = "Close",
  draggable = false,
  className
}: ModalHeaderProps) {
  const classes = [css.header, draggable ? css.headerDraggable : "", className].filter(Boolean).join(" ");
  return (
    <header
      className={classes}
      data-modal-drag-handle={draggable ? "true" : undefined}
    >
      <div className={css.headerText}>
        <h2 id={titleId} className={css.title}>{title}</h2>
      </div>
      {(trailing || showCloseButton) ? (
        <div className={css.headerTrailing}>
          {trailing}
          {showCloseButton && onClose ? (
            <button
              type="button"
              className={css.closeIconButton}
              aria-label={closeAriaLabel}
              onClick={onClose}
              onPointerDown={(event) => { event.stopPropagation(); }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

// ── Body ────────────────────────────────────────────────────────────────────

type ModalBodyProps = {
  children: ReactNode;
  padding?: "default" | "compact" | "none";
  className?: string;
  scroll?: boolean;
};

function ModalBody({ children, padding = "default", className, scroll = true }: ModalBodyProps) {
  const paddingClass =
    padding === "none" ? css.bodyPadNone :
    padding === "compact" ? css.bodyPadCompact :
    css.bodyPadDefault;
  const classes = [css.body, paddingClass, scroll ? css.bodyScroll : "", className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}

// ── Footer ──────────────────────────────────────────────────────────────────

type ModalFooterProps = {
  children: ReactNode;
  className?: string;
  align?: "end" | "between" | "start";
};

function ModalFooter({ children, className, align = "end" }: ModalFooterProps) {
  const alignClass =
    align === "between" ? css.footerBetween :
    align === "start" ? css.footerStart :
    css.footerEnd;
  const classes = [css.footer, alignClass, className].filter(Boolean).join(" ");
  return <footer className={classes}>{children}</footer>;
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ModalButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
};

const PrimaryButton = forwardRef<HTMLButtonElement, ModalButtonProps>(function PrimaryButton(
  { className, ...rest },
  ref
) {
  const classes = [css.btn, css.btnPrimary, className].filter(Boolean).join(" ");
  return <button ref={ref} className={classes} {...rest} type="button" />;
});

const SecondaryButton = forwardRef<HTMLButtonElement, ModalButtonProps>(function SecondaryButton(
  { className, ...rest },
  ref
) {
  const classes = [css.btn, css.btnSecondary, className].filter(Boolean).join(" ");
  return <button ref={ref} className={classes} {...rest} type="button" />;
});

const DangerButton = forwardRef<HTMLButtonElement, ModalButtonProps>(function DangerButton(
  { className, ...rest },
  ref
) {
  const classes = [css.btn, css.btnDanger, className].filter(Boolean).join(" ");
  return <button ref={ref} className={classes} {...rest} type="button" />;
});

const GhostButton = forwardRef<HTMLButtonElement, ModalButtonProps>(function GhostButton(
  { className, ...rest },
  ref
) {
  const classes = [css.btn, css.btnGhost, className].filter(Boolean).join(" ");
  return <button ref={ref} className={classes} {...rest} type="button" />;
});

// ── Attach ──────────────────────────────────────────────────────────────────

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
Modal.PrimaryButton = PrimaryButton;
Modal.SecondaryButton = SecondaryButton;
Modal.DangerButton = DangerButton;
Modal.GhostButton = GhostButton;
