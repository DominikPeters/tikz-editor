import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import css from "./RenderedTooltip.module.css";

type TooltipPosition = {
  left: number;
  top: number;
};

type TooltipAnchor = {
  x: number;
  y: number;
};

type TooltipBoundary = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type RenderedTooltipProps = {
  content?: ReactNode;
  children?: ReactNode;
  block?: boolean;
  open?: boolean;
  anchor?: TooltipAnchor | null;
  boundary?: TooltipBoundary | null;
  className?: string;
  "data-testid"?: string;
};

const VIEWPORT_PADDING_PX = 8;
const CURSOR_OFFSET_X_PX = 12;
const CURSOR_OFFSET_Y_PX = 16;

function clampTooltipPosition(
  tooltipWidth: number,
  tooltipHeight: number,
  anchor: TooltipAnchor,
  boundary: TooltipBoundary | null
): TooltipPosition {
  const limitLeft = boundary ? boundary.left + VIEWPORT_PADDING_PX : VIEWPORT_PADDING_PX;
  const limitTop = boundary ? boundary.top + VIEWPORT_PADDING_PX : VIEWPORT_PADDING_PX;
  const limitRight = boundary ? boundary.right - VIEWPORT_PADDING_PX : window.innerWidth - VIEWPORT_PADDING_PX;
  const limitBottom = boundary ? boundary.bottom - VIEWPORT_PADDING_PX : window.innerHeight - VIEWPORT_PADDING_PX;
  const preferredLeft = anchor.x + CURSOR_OFFSET_X_PX;
  const clampedLeft = Math.min(
    Math.max(preferredLeft, limitLeft),
    limitRight - tooltipWidth
  );
  const preferredTop = anchor.y + CURSOR_OFFSET_Y_PX;
  const clampedTop = Math.min(
    Math.max(preferredTop, limitTop),
    limitBottom - tooltipHeight
  );

  return { left: clampedLeft, top: clampedTop };
}

export function RenderedTooltip({
  content,
  children,
  block = false,
  open,
  anchor = null,
  boundary = null,
  className,
  "data-testid": dataTestId
}: RenderedTooltipProps) {
  const hasContent = content != null && !(typeof content === "string" && content.trim().length === 0);
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const lastPointerRef = useRef<TooltipAnchor | null>(null);
  const boundaryRef = useRef<TooltipBoundary | null>(null);
  const isOpen = isControlled ? open : uncontrolledOpen;

  boundaryRef.current = boundary;

  const closeTooltip = useCallback(() => {
    if (!isControlled) {
      setUncontrolledOpen(false);
    }
  }, [isControlled]);

  const updatePosition = useCallback(() => {
    const tooltipElement = tooltipRef.current;
    const activeAnchor = anchor ?? lastPointerRef.current;
    if (!tooltipElement || !activeAnchor) {
      return;
    }

    const rect = tooltipElement.getBoundingClientRect();
    setPosition(clampTooltipPosition(rect.width, rect.height, activeAnchor, boundaryRef.current));
  }, [anchor]);

  const updatePointerPosition = useCallback((event: PointerEvent<HTMLElement>) => {
    if (isControlled) {
      return;
    }
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
    if (isOpen) {
      updatePosition();
    }
  }, [isControlled, isOpen, updatePosition]);

  useLayoutEffect(() => {
    if (!isOpen || !hasContent) {
      return;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [hasContent, isOpen, updatePosition]);

  if (!hasContent) {
    return <>{children}</>;
  }

  function handlePointerEnter(event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "touch") {
      return;
    }
    updatePointerPosition(event);
    if (!isControlled) {
      setUncontrolledOpen(true);
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "touch") {
      return;
    }
    updatePointerPosition(event);
  }

  function handlePointerLeave(): void {
    closeTooltip();
  }

  function handleFocus(): void {
    // Focus interactions (including opening dropdowns via keyboard) should hide tooltip.
    closeTooltip();
  }

  function handleBlur(event: FocusEvent<HTMLElement>): void {
    const nextFocusedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (nextFocusedTarget && event.currentTarget.contains(nextFocusedTarget)) {
      return;
    }
    closeTooltip();
  }

  const AnchorTag = block ? "div" : "span";
  const tooltip = isOpen
    ? createPortal(
      <div
        ref={tooltipRef}
        className={[css.tooltip, className ?? ""].filter(Boolean).join(" ")}
        style={{ left: `${position.left}px`, top: `${position.top}px` }}
        role="tooltip"
        data-testid={dataTestId}
      >
        {content}
      </div>,
      document.body
    )
    : null;

  if (isControlled && !children) {
    return tooltip;
  }

  return (
    <AnchorTag
      className={block ? css.anchorBlock : css.anchorInline}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPointerDown={closeTooltip}
      onKeyDown={closeTooltip}
    >
      {children}
      {tooltip}
    </AnchorTag>
  );
}
