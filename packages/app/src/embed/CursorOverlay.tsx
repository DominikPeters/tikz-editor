import { memo } from "react";
import type { CursorStyle } from "./demo-script";

export type CursorOverlayProps = {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
  cursor: CursorStyle;
};

// Shared styling for cursor SVGs.
const STROKE_COLOR = "#111111";
const FILL_COLOR = "#ffffff";
const STROKE_WIDTH = 1.2;

// Each cursor is a 24x24 SVG. The hotspot is at (0, 0) for pointer-style cursors
// or centered for symmetric cursors. Translate accordingly in the parent.
type CursorDef = {
  // SVG path(s) for the cursor shape
  paths: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeLinecap?: "round" | "square" | "butt";
    strokeLinejoin?: "round" | "miter" | "bevel";
  }>;
  // Offset from cursor position to SVG origin (default 0,0)
  offsetX?: number;
  offsetY?: number;
  // Viewbox size (default 24)
  size?: number;
};

const CURSOR_DEFS: Record<CursorStyle, CursorDef> = {
  // Default pointer arrow
  pointer: {
    paths: [
      {
        d: "M3 2 L3 19 L8 14 L11 20 L14 19 L11 13 L18 13 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: STROKE_WIDTH,
        strokeLinejoin: "round"
      }
    ]
  },

  // 4-way move cursor (arrows pointing in all directions)
  move: {
    paths: [
      {
        // Four arrows from center
        d: `M12 2 L8 6 L10.5 6 L10.5 10.5 L6 10.5 L6 8 L2 12 L6 16 L6 13.5 L10.5 13.5 L10.5 18 L8 18 L12 22 L16 18 L13.5 18 L13.5 13.5 L18 13.5 L18 16 L22 12 L18 8 L18 10.5 L13.5 10.5 L13.5 6 L16 6 Z`,
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },

  // Crosshair for drawing tools
  crosshair: {
    paths: [
      {
        // Horizontal line
        d: "M2 12 L10 12 M14 12 L22 12",
        stroke: STROKE_COLOR,
        strokeWidth: 1.5,
        strokeLinecap: "round"
      },
      {
        // Vertical line
        d: "M12 2 L12 10 M12 14 L12 22",
        stroke: STROKE_COLOR,
        strokeWidth: 1.5,
        strokeLinecap: "round"
      },
      {
        // Center dot
        d: "M12 12 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0",
        fill: STROKE_COLOR
      }
    ],
    offsetX: -12,
    offsetY: -12
  },

  // Open hand (grab)
  grab: {
    paths: [
      {
        // Palm and fingers
        d: `M8 14 L8 9 Q8 7.5 9.5 7.5 Q11 7.5 11 9 L11 8 Q11 6.5 12.5 6.5 Q14 6.5 14 8 L14 8.5 Q14 7 15.5 7 Q17 7 17 8.5 L17 10 Q17 8.5 18.5 8.5 Q20 8.5 20 10 L20 16 Q20 21 15 21 L12 21 Q7 21 7 16 L7 14 Q7 12.5 8 12.5 Z`,
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      },
      {
        // Finger separations
        d: "M11 9 L11 13 M14 8.5 L14 13 M17 10 L17 13",
        stroke: STROKE_COLOR,
        strokeWidth: 0.8,
        strokeLinecap: "round"
      }
    ],
    offsetX: -10,
    offsetY: -8
  },

  // Closed hand (grabbing)
  grabbing: {
    paths: [
      {
        // Closed fist
        d: `M7 15 Q7 11 9 11 L9 10.5 Q9 9 10.5 9 Q12 9 12 10.5 L12 10 Q12 8.5 13.5 8.5 Q15 8.5 15 10 L15 10.5 Q15 9 16.5 9 Q18 9 18 10.5 L18 11 Q18 9.5 19.5 9.5 Q21 9.5 21 11 L21 16 Q21 21 16 21 L12 21 Q7 21 7 16 Z`,
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      },
      {
        // Knuckle lines
        d: "M10.5 11 L10.5 13 M13.5 10.5 L13.5 13 M16.5 11 L16.5 13",
        stroke: STROKE_COLOR,
        strokeWidth: 0.8,
        strokeLinecap: "round"
      }
    ],
    offsetX: -11,
    offsetY: -10
  },

  // Horizontal resize (east-west)
  "ew-resize": {
    paths: [
      {
        d: `M2 12 L8 7 L8 10.5 L16 10.5 L16 7 L22 12 L16 17 L16 13.5 L8 13.5 L8 17 Z`,
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },

  // Vertical resize (north-south)
  "ns-resize": {
    paths: [
      {
        d: `M12 2 L17 8 L13.5 8 L13.5 16 L17 16 L12 22 L7 16 L10.5 16 L10.5 8 L7 8 Z`,
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },

  // Diagonal resize (northwest-southeast)
  "nwse-resize": {
    paths: [
      {
        d: `M3 3 L3 10 L5.5 7.5 L10 12 L7.5 14.5 L14.5 14.5 L14.5 7.5 L12 10 L7.5 5.5 L10 3 Z M21 21 L21 14 L18.5 16.5 L14 12 L16.5 9.5 L9.5 9.5 L9.5 16.5 L12 14 L16.5 18.5 L14 21 Z`,
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },

  // Diagonal resize (northeast-southwest)
  "nesw-resize": {
    paths: [
      {
        d: `M21 3 L14 3 L16.5 5.5 L12 10 L9.5 7.5 L9.5 14.5 L16.5 14.5 L14 12 L18.5 7.5 L21 10 Z M3 21 L10 21 L7.5 18.5 L12 14 L14.5 16.5 L14.5 9.5 L7.5 9.5 L10 12 L5.5 16.5 L3 14 Z`,
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },

  // Text cursor (I-beam)
  text: {
    paths: [
      {
        // I-beam shape
        d: `M8 4 L16 4 M12 4 L12 20 M8 20 L16 20`,
        stroke: STROKE_COLOR,
        strokeWidth: 2,
        strokeLinecap: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  }
};

export const CursorOverlay = memo(function CursorOverlay({
  x,
  y,
  visible,
  pressed,
  cursor
}: CursorOverlayProps) {
  const def = CURSOR_DEFS[cursor] ?? CURSOR_DEFS.pointer;
  const size = def.size ?? 24;
  const offsetX = def.offsetX ?? 0;
  const offsetY = def.offsetY ?? 0;

  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate(${x + offsetX}px, ${y + offsetY}px)`,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 120ms linear",
        filter: pressed
          ? "drop-shadow(0 0 3px rgba(0,0,0,0.6))"
          : "drop-shadow(0 1px 1px rgba(0,0,0,0.4))"
      }}
    >
      {def.paths.map((path, i) => (
        <path
          key={i}
          d={path.d}
          fill={path.fill ?? "none"}
          stroke={path.stroke ?? "none"}
          strokeWidth={path.strokeWidth}
          strokeLinecap={path.strokeLinecap}
          strokeLinejoin={path.strokeLinejoin}
        />
      ))}
    </svg>
  );
});
