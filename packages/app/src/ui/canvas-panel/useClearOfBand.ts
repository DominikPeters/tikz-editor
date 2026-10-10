import { useLayoutEffect, useState, type RefObject } from "react";

/** Space between a popup and the lines it keeps clear, px. */
export const BAND_GAP_PX = 4;

/** Viewport px: the lines a popup must leave visible. */
export type ClearBand = { readonly top: number; readonly bottom: number };

/**
 * Where a popup goes so the text it edits stays visible: above or below
 * the band, whichever has room for it as it now is (the preferred side
 * when both or neither do), and inside its container horizontally.
 * `size` changes when the popup's own size may have (a field or panel
 * coming and going), so the side is chosen again.
 */
export function useClearOfBand(
  root: RefObject<HTMLElement | null>,
  band: ClearBand,
  prefer: "above" | "below",
  preferredLeft: number,
  size: unknown
): { readonly side: "above" | "below"; readonly left: number; readonly style: { left: number; top?: number; bottom?: string } } {
  const [side, setSide] = useState(prefer);
  const [left, setLeft] = useState(preferredLeft);
  useLayoutEffect(() => {
    const element = root.current;
    const container = element?.offsetParent;
    if (!element || !(container instanceof HTMLElement)) {
      return;
    }
    const height = element.offsetHeight;
    const fits = (candidate: "above" | "below") => candidate === "above"
      ? band.top - BAND_GAP_PX - height >= 0
      : band.bottom + BAND_GAP_PX + height <= container.clientHeight;
    const other = prefer === "above" ? "below" : "above";
    const next = fits(prefer) || !fits(other) ? prefer : other;
    if (next !== side) {
      setSide(next);
    }
    const clamped = Math.max(BAND_GAP_PX, Math.min(preferredLeft, container.clientWidth - element.offsetWidth - BAND_GAP_PX));
    if (clamped !== left) {
      setLeft(clamped);
    }
  }, [root, prefer, preferredLeft, band.top, band.bottom, side, left, size]);
  return {
    side,
    left,
    style: side === "above"
      ? { left, bottom: `calc(100% - ${band.top - BAND_GAP_PX}px)` }
      : { left, top: band.bottom + BAND_GAP_PX },
  };
}
