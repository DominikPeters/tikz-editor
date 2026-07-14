const SAFE_AREA_BOTTOM_CSS_VALUE = "var(--ipad-safe-area-bottom, env(safe-area-inset-bottom, 0px))";

function parseCssPixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

export function readSafeAreaBottom(): number {
  if (typeof document === "undefined") {
    return 0;
  }
  const direct = parseCssPixelValue(getComputedStyle(document.documentElement).getPropertyValue("--ipad-safe-area-bottom"));
  if (direct != null) {
    return direct;
  }
  if (!document.body) {
    return 0;
  }
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingBottom = SAFE_AREA_BOTTOM_CSS_VALUE;
  document.body.append(probe);
  const resolved = parseCssPixelValue(getComputedStyle(probe).paddingBottom) ?? 0;
  probe.remove();
  return resolved;
}
