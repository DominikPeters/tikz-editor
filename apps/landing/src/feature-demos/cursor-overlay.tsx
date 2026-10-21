import { forwardRef, memo } from "react";

export type CursorStyle =
  | "pointer"
  | "move"
  | "rotate"
  | "crosshair"
  | "grab"
  | "grabbing"
  | "ew-resize"
  | "ns-resize"
  | "nwse-resize"
  | "nesw-resize"
  | "text";

export type CursorOverlayProps = {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
  cursor: CursorStyle;
  scale?: number;
};

export type CursorOverlayFrame = {
  x: number;
  y: number;
  visible: boolean;
  cursor: CursorStyle;
};

export type CursorOverlayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const STROKE_COLOR = "#111111";
const FILL_COLOR = "#ffffff";
const STROKE_WIDTH = 1.2;

type CursorDef = {
  paths: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    strokeLinecap?: "round" | "square" | "butt";
    strokeLinejoin?: "round" | "miter" | "bevel";
  }>;
  offsetX?: number;
  offsetY?: number;
  size?: number;
};

const CURSOR_DEFS: Record<CursorStyle, CursorDef> = {
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
  move: {
    paths: [
      {
        d: "M12 2 L8 6 L10.5 6 L10.5 10.5 L6 10.5 L6 8 L2 12 L6 16 L6 13.5 L10.5 13.5 L10.5 18 L8 18 L12 22 L16 18 L13.5 18 L13.5 13.5 L18 13.5 L18 16 L22 12 L18 8 L18 10.5 L13.5 10.5 L13.5 6 L16 6 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },
  rotate: {
    paths: [
      {
        d: "M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z",
        fill: STROKE_COLOR
      },
      {
        d: "M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466",
        fill: STROKE_COLOR
      }
    ],
    size: 16,
    offsetX: -8,
    offsetY: -8
  },
  crosshair: {
    paths: [
      {
        d: "M2 12 L10 12 M14 12 L22 12",
        stroke: STROKE_COLOR,
        strokeWidth: 1.5,
        strokeLinecap: "round"
      },
      {
        d: "M12 2 L12 10 M12 14 L12 22",
        stroke: STROKE_COLOR,
        strokeWidth: 1.5,
        strokeLinecap: "round"
      },
      {
        d: "M12 12 m-1.5 0 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0",
        fill: STROKE_COLOR
      }
    ],
    offsetX: -12,
    offsetY: -12
  },
  grab: {
    paths: [
      {
        d: "M8 14 L8 9 Q8 7.5 9.5 7.5 Q11 7.5 11 9 L11 8 Q11 6.5 12.5 6.5 Q14 6.5 14 8 L14 8.5 Q14 7 15.5 7 Q17 7 17 8.5 L17 10 Q17 8.5 18.5 8.5 Q20 8.5 20 10 L20 16 Q20 21 15 21 L12 21 Q7 21 7 16 L7 14 Q7 12.5 8 12.5 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      },
      {
        d: "M11 9 L11 13 M14 8.5 L14 13 M17 10 L17 13",
        stroke: STROKE_COLOR,
        strokeWidth: 0.8,
        strokeLinecap: "round"
      }
    ],
    offsetX: -10,
    offsetY: -8
  },
  grabbing: {
    paths: [
      {
        d: "M7 15 Q7 11 9 11 L9 10.5 Q9 9 10.5 9 Q12 9 12 10.5 L12 10 Q12 8.5 13.5 8.5 Q15 8.5 15 10 L15 10.5 Q15 9 16.5 9 Q18 9 18 10.5 L18 11 Q18 9.5 19.5 9.5 Q21 9.5 21 11 L21 16 Q21 21 16 21 L12 21 Q7 21 7 16 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      },
      {
        d: "M10.5 11 L10.5 13 M13.5 10.5 L13.5 13 M16.5 11 L16.5 13",
        stroke: STROKE_COLOR,
        strokeWidth: 0.8,
        strokeLinecap: "round"
      }
    ],
    offsetX: -11,
    offsetY: -10
  },
  "ew-resize": {
    paths: [
      {
        d: "M2 12 L8 7 L8 10.5 L16 10.5 L16 7 L22 12 L16 17 L16 13.5 L8 13.5 L8 17 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },
  "ns-resize": {
    paths: [
      {
        d: "M12 2 L17 8 L13.5 8 L13.5 16 L17 16 L12 22 L7 16 L10.5 16 L10.5 8 L7 8 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },
  "nwse-resize": {
    paths: [
      {
        d: "M3 3 L3 10 L5.5 7.5 L10 12 L7.5 14.5 L14.5 14.5 L14.5 7.5 L12 10 L7.5 5.5 L10 3 Z M21 21 L21 14 L18.5 16.5 L14 12 L16.5 9.5 L9.5 9.5 L9.5 16.5 L12 14 L16.5 18.5 L14 21 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },
  "nesw-resize": {
    paths: [
      {
        d: "M21 3 L14 3 L16.5 5.5 L12 10 L9.5 7.5 L9.5 14.5 L16.5 14.5 L14 12 L18.5 7.5 L21 10 Z M3 21 L10 21 L7.5 18.5 L12 14 L14.5 16.5 L14.5 9.5 L7.5 9.5 L10 12 L5.5 16.5 L3 14 Z",
        fill: FILL_COLOR,
        stroke: STROKE_COLOR,
        strokeWidth: 1,
        strokeLinejoin: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  },
  text: {
    paths: [
      {
        d: "M8 4 L16 4 M12 4 L12 20 M8 20 L16 20",
        stroke: STROKE_COLOR,
        strokeWidth: 2,
        strokeLinecap: "round"
      }
    ],
    offsetX: -12,
    offsetY: -12
  }
};

export function applyCursorOverlayFrame(target: SVGGElement, frame: CursorOverlayFrame, scale = 1): void {
  const def = CURSOR_DEFS[frame.cursor];
  const transform = `translate3d(${frame.x}px, ${frame.y}px, 0) scale(${scale})`;
  const glyphTransform = `translate(${def.offsetX ?? 0} ${def.offsetY ?? 0})`;
  const opacity = frame.visible ? "1" : "0";

  const previous = LAST_CURSOR_DOM_FRAME.get(target);
  if (previous?.transform !== transform) {
    target.style.transform = transform;
  }
  const glyph = cursorGlyphFor(target);
  if (glyph && (previous?.glyphTransform !== glyphTransform)) {
    glyph.setAttribute("transform", glyphTransform);
  }
  if (previous?.opacity !== opacity) {
    target.style.opacity = opacity;
  }
  LAST_CURSOR_DOM_FRAME.set(target, { glyphTransform, transform, opacity });
}

const LAST_CURSOR_DOM_FRAME = new WeakMap<SVGGElement, { glyphTransform: string; transform: string; opacity: string }>();
const CURSOR_GLYPHS = new WeakMap<SVGGElement, SVGGElement | null>();

export function getCursorOverlayBounds(cursor: CursorStyle, x: number, y: number, scale = 1): CursorOverlayBounds {
  const def = CURSOR_DEFS[cursor];
  const size = def.size ?? 24;
  return {
    x: x + (def.offsetX ?? 0) * scale,
    y: y + (def.offsetY ?? 0) * scale,
    width: size * scale,
    height: size * scale
  };
}

function cursorGlyphFor(target: SVGGElement): SVGGElement | null {
  if (!CURSOR_GLYPHS.has(target)) {
    CURSOR_GLYPHS.set(target, target.querySelector<SVGGElement>("[data-landing-cursor-glyph]"));
  }
  return CURSOR_GLYPHS.get(target) ?? null;
}

export const CursorOverlay = memo(forwardRef<SVGGElement, CursorOverlayProps>(function CursorOverlay(
  { x, y, visible, cursor, scale = 1 }: CursorOverlayProps,
  ref
) {
  const def = CURSOR_DEFS[cursor];
  const size = def.size ?? 24;

  return (
    <g
      ref={ref}
      aria-hidden
      data-cursor-visible={visible ? "true" : "false"}
      data-cursor-scale={scale}
      data-cursor-x={x}
      data-cursor-y={y}
      data-landing-cursor
      style={{
        pointerEvents: "none",
        transformBox: "view-box",
        transformOrigin: "0 0",
        transition: "opacity 120ms linear",
        willChange: "transform, opacity"
      }}
    >
      <g data-landing-cursor-glyph>
        <rect x="0" y="0" width={size} height={size} fill="none" />
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
      </g>
    </g>
  );
}));
