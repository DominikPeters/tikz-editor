import type { CSSProperties } from "react";

type RangeFillStyle = CSSProperties & { "--fill": string };

/** The --fill position for a `controls.module.css` slider: how far along its track the value sits. */
export function rangeFillStyle(value: number, min: number, max: number): RangeFillStyle {
  const span = max - min;
  const fraction = span > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  return { "--fill": `${(fraction * 100).toFixed(2)}%` };
}
