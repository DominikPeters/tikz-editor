import { memo } from "react";

export type CursorOverlayProps = {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
};

// Placeholder cursor art. The demo-authoring phase can swap this out or
// restyle via CSS targeting the root element.
export const CursorOverlay = memo(function CursorOverlay({ x, y, visible, pressed }: CursorOverlayProps) {
  return (
    <svg
      aria-hidden
      width={24}
      height={24}
      viewBox="0 0 24 24"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate(${x}px, ${y}px)`,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 120ms linear",
        filter: pressed ? "drop-shadow(0 0 3px rgba(0,0,0,0.6))" : "drop-shadow(0 1px 1px rgba(0,0,0,0.4))"
      }}
    >
      <path
        d="M3 2 L3 19 L8 14 L11 20 L14 19 L11 13 L18 13 Z"
        fill="#ffffff"
        stroke="#111111"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
});
