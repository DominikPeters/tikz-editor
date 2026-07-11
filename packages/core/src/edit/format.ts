export { PT_PER_CM, CM_PER_PT } from "../coords/source.js";

export type NumberFormatOptions = {
  fractionDigits?: number;
};

export type DragFormatPrecision = "default" | "fine";

export const NUMBER_FORMAT_PRESETS = {
  pointDimension: { fractionDigits: 0 },
  pointDimensionFine: { fractionDigits: 1 },
  pointDistance: { fractionDigits: 0 },
  pointDistanceFine: { fractionDigits: 1 }
} as const satisfies Record<string, NumberFormatOptions>;

export function pointDimensionFormatOptions(precision: DragFormatPrecision | undefined): NumberFormatOptions {
  return precision === "fine" ? NUMBER_FORMAT_PRESETS.pointDimensionFine : NUMBER_FORMAT_PRESETS.pointDimension;
}

export function pointDistanceFormatOptions(precision: DragFormatPrecision | undefined): NumberFormatOptions {
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
