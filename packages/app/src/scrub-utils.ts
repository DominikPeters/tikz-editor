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

export function computeScrubbedValue(input: ComputeScrubbedValueInput): number {
  const pixelsPerStep = pixelsPerStepForModifiers(input.modifiers);
  const deltaSteps = Math.round((input.currentX - input.startX) / pixelsPerStep);
  const unclampedValue = input.startValue + deltaSteps * input.step;
  return clamp(unclampedValue, input.min, input.max);
}

export function formatScrubNumber(value: number, precision: number, minDisplayPrecision: number): string {
  const normalized = Math.abs(value) < 1e-10 ? 0 : value;
  if (precision <= 0) {
    return String(Math.round(normalized));
  }

  const fixed = normalized.toFixed(precision);
  const dotIndex = fixed.indexOf(".");
  if (dotIndex === -1) {
    return fixed;
  }

  const intPart = fixed.slice(0, dotIndex);
  let fraction = fixed.slice(dotIndex + 1);
  while (fraction.length > minDisplayPrecision && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }

  return fraction.length > 0 ? `${intPart}.${fraction}` : intPart;
}

export function fractionDigits(text: string): number {
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e");
  const dotIndex = mantissa.indexOf(".");
  const digits = dotIndex === -1 ? 0 : mantissa.length - dotIndex - 1;
  return Math.min(100, Math.max(0, digits - Number(exponent)));
}
