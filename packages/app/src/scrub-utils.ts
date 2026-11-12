export const SCRUB_ACTIVATION_DELTA_PX = 5;

export type ScrubModifierState = {
  shiftKey: boolean;
  altKey: boolean;
};

export type ComputeScrubbedValueInput = {
  startX: number;
  currentX: number;
  startValue: number;
  step: number;
  min?: number;
  max?: number;
  modifiers: ScrubModifierState;
};

export function shouldStartScrub(deltaX: number): boolean {
  return Math.abs(deltaX) >= SCRUB_ACTIVATION_DELTA_PX;
}

export function pixelsPerStepForModifiers(modifiers: ScrubModifierState): number {
  let pixelsPerStep = 8;
  if (modifiers.shiftKey) {
    pixelsPerStep *= 4;
  }
  if (modifiers.altKey) {
    pixelsPerStep = Math.max(1, pixelsPerStep / 4);
  }
  return pixelsPerStep;
}

export function clamp(value: number, min?: number, max?: number): number {
  if (min != null && value < min) {
    return min;
  }
  if (max != null && value > max) {
    return max;
  }
  return value;
}

/**
 * The value after scrubbing by whole steps. Once it moves, it moves on the
 * step's grid (from 0.37 by 0.1: 0.4, 0.5, … or 0.3, 0.2, …) and is rounded
 * to the step's decimals, so scrubbing writes `0.3`, never
 * `0.30000000000000004` or `0.47`.
 */
export function computeScrubbedValue(input: ComputeScrubbedValueInput): number {
  const pixelsPerStep = pixelsPerStepForModifiers(input.modifiers);
  const deltaSteps = Math.round((input.currentX - input.startX) / pixelsPerStep);
  const { startValue, step } = input;
  if (deltaSteps === 0 || !(step > 0) || !Number.isFinite(step)) return clamp(startValue + deltaSteps * step, input.min, input.max);
  const units = startValue / step;
  // An off-grid start counts its own partial step as the first one.
  const base = deltaSteps > 0 ? Math.floor(units + 1e-9) : Math.ceil(units - 1e-9);
  const decimals = Math.min(12, fractionDigits(String(step)));
  return clamp(Number(((base + deltaSteps) * step).toFixed(decimals)), input.min, input.max);
}

/** A scrubbed value as written: rounded to `precision` decimals, without trailing zeros. */
export function formatScrubNumber(value: number, precision: number): string {
  const normalized = Math.abs(value) < 1e-10 ? 0 : value;
  if (precision <= 0) return String(Math.round(normalized));
  const fixed = normalized.toFixed(precision).replace(/0+$/u, "").replace(/\.$/u, "");
  return fixed === "-0" ? "0" : fixed;
}

export function fractionDigits(text: string): number {
  const [mantissa = "", exponent = "0"] = text.toLowerCase().split("e");
  const dotIndex = mantissa.indexOf(".");
  const digits = dotIndex === -1 ? 0 : mantissa.length - dotIndex - 1;
  return Math.min(100, Math.max(0, digits - Number(exponent)));
}
