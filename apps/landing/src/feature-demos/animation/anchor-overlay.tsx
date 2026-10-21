import { forwardRef, memo } from "react";

export type RectBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnchorDot = {
  key: string;
  x: number;
  y: number;
  active?: boolean;
};

export function buildRectAnchorDots(bounds: RectBounds): AnchorDot[] {
  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = bounds.x + bounds.width;
  const y1 = bounds.y + bounds.height;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  return [
    { key: "c", x: xm, y: ym },
    { key: "nw", x: x0, y: y0 },
    { key: "n", x: xm, y: y0 },
    { key: "ne", x: x1, y: y0 },
    { key: "e", x: x1, y: ym },
    { key: "se", x: x1, y: y1 },
    { key: "s", x: xm, y: y1 },
    { key: "sw", x: x0, y: y1 },
    { key: "w", x: x0, y: ym }
  ];
}

export type AnchorOverlayProps = {
  anchors: AnchorDot[];
  visible?: boolean;
  radius?: number;
  strokeWidth?: number;
};

const ANCHOR_FILL = "rgba(60, 172, 83, 0.72)";
const ANCHOR_STROKE = "rgba(20, 117, 40, 0.92)";
const ACTIVE_FILL = "rgba(53, 194, 79, 0.9)";
const ACTIVE_STROKE = "rgba(16, 102, 34, 1)";

export function applyAnchorOverlayState(
  target: SVGGElement,
  anchors: readonly AnchorDot[],
  visible: boolean,
  activeKey: string | null,
  radius = 2.7
): void {
  const nextDisplay = visible ? "inline" : "none";
  if (target.style.display !== nextDisplay) {
    target.style.display = nextDisplay;
  }

  let circles = ANCHOR_CIRCLE_CACHE.get(target);
  if (!circles) {
    circles = Array.from(target.querySelectorAll<SVGCircleElement>("circle[data-anchor-key]"));
    ANCHOR_CIRCLE_CACHE.set(target, circles);
  }
  circles.forEach((circle, index) => {
    const anchor = anchors[index];
    if (!anchor) {
      return;
    }
    const active = visible && anchor.key === activeKey;
    setSvgAttrIfNeeded(circle, "r", String(active ? radius * 1.1 : radius * 0.85));
    setSvgAttrIfNeeded(circle, "fill", active ? ACTIVE_FILL : ANCHOR_FILL);
    setSvgAttrIfNeeded(circle, "stroke", active ? ACTIVE_STROKE : ANCHOR_STROKE);
  });
}

const ANCHOR_CIRCLE_CACHE = new WeakMap<SVGGElement, SVGCircleElement[]>();

function setSvgAttrIfNeeded(element: SVGElement, name: string, next: string): void {
  if (element.getAttribute(name) !== next) {
    element.setAttribute(name, next);
  }
}

export const AnchorOverlay = memo(forwardRef<SVGGElement, AnchorOverlayProps>(function AnchorOverlay({
  anchors,
  visible = true,
  radius = 2.7,
  strokeWidth = 0.34
}: AnchorOverlayProps, ref) {
  if (anchors.length === 0) {
    return null;
  }

  return (
    <g ref={ref} pointerEvents="none" style={{ display: visible ? "inline" : "none" }}>
      {anchors.map((anchor) => {
        const active = anchor.active ?? false;
        return (
          <circle
            key={anchor.key}
            data-anchor-key={anchor.key}
            cx={anchor.x}
            cy={anchor.y}
            r={active ? radius * 1.1 : radius * 0.85}
            fill={active ? ACTIVE_FILL : ANCHOR_FILL}
            stroke={active ? ACTIVE_STROKE : ANCHOR_STROKE}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}));
