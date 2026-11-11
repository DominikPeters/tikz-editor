export { PT_PER_CM, CM_PER_PT } from "../coords/source.js";

export type NumberFormatOptions = {
  fractionDigits?: number;
};

export type DragFormatPrecision = "default" | "fine" | "snapped";

export const NUMBER_FORMAT_PRESETS = {
  pointDimension: { fractionDigits: 0 },
  pointDimensionFine: { fractionDigits: 1 },
  pointDistance: { fractionDigits: 0 },
  pointDistanceFine: { fractionDigits: 1 }
} as const satisfies Record<string, NumberFormatOptions>;

export function pointDimensionFormatOptions(precision: DragFormatPrecision | undefined): NumberFormatOptions {
  if (precision === "snapped") return { fractionDigits: 7 };
  return precision === "fine" ? NUMBER_FORMAT_PRESETS.pointDimensionFine : NUMBER_FORMAT_PRESETS.pointDimension;
}

export function pointDistanceFormatOptions(precision: DragFormatPrecision | undefined): NumberFormatOptions {
  if (precision === "snapped") return { fractionDigits: 7 };
  return precision === "fine" ? NUMBER_FORMAT_PRESETS.pointDistanceFine : NUMBER_FORMAT_PRESETS.pointDistance;
}

export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const fractionDigits = options.fractionDigits ?? 2;
  const scale = 10 ** fractionDigits;
  const rounded = fractionDigits === 0 ? Math.round(value) : Math.round(value * scale) / scale;
  const normalized = Math.abs(rounded) < 1e-9 ? 0 : rounded;
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }
  return normalized.toFixed(fractionDigits).replace(/\.?0+$/, "");
}

/**
 * The shortest decimal within `tolerance` of `value`: what a gesture as
 * precise as `tolerance` meant. `1.4972` with tolerance `0.01` is `1.5`;
 * with `0.001` it is `1.497`. Ties within the same number of decimals go to
 * the nearest. A non-positive tolerance falls back to six decimals.
 */
export function shortestDecimal(value: number, tolerance: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (!(tolerance > 0)) return formatNumber(value, { fractionDigits: 6 });
  for (let digits = 0; digits <= 12; digits++) {
    const scale = 10 ** digits;
    const rounded = Math.round(value * scale) / scale;
    if (Math.abs(rounded - value) <= tolerance) return formatNumber(rounded, { fractionDigits: digits });
  }
  return formatNumber(value, { fractionDigits: 12 });
}

/**
 * How precisely an edit's numbers are meant, in world pt: how far a written
 * point may lie from the exact one. Pointer gestures are as precise as half a
 * screen pixel; an edit that only re-expresses geometry (`reparameterize`)
 * must not visibly move it.
 */
export const POINTER_TOLERANCE_PT = 0.375;
export const EXACT_TOLERANCE_PT = 0.0001;
/**
 * Commands that re-express geometry without a pointer (convert to absolute,
 * align, figure bounds) must not visibly move it: about 0.005cm.
 */
export const COMMAND_TOLERANCE_PT = 0.2;

let currentWriteTolerance = POINTER_TOLERANCE_PT;

/** Runs `run` with numbers written to `tolerancePt` (edits are synchronous). */
export function withWriteTolerance<T>(tolerancePt: number, run: () => T): T {
  const previous = currentWriteTolerance;
  currentWriteTolerance = tolerancePt > 0 && Number.isFinite(tolerancePt) ? tolerancePt : POINTER_TOLERANCE_PT;
  try {
    return run();
  } finally {
    currentWriteTolerance = previous;
  }
}

/** The tolerance of the edit being applied, in world pt. */
export function writeTolerancePt(): number {
  return currentWriteTolerance;
}

/** The world tolerance for a drag of the given precision. */
export function dragTolerancePt(precision: DragFormatPrecision | undefined, pointerTolerancePt = POINTER_TOLERANCE_PT): number {
  if (precision === "snapped") return EXACT_TOLERANCE_PT;
  return precision === "fine" ? pointerTolerancePt / 10 : pointerTolerancePt;
}
