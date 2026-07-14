import { texLength, type TexLength } from "./coordinates.js";

export function texDimensionUnitFactor(unit: string): number | null {
  switch (unit) {
    case "pt":
      return 1;
    case "in":
      return 72.27;
    case "pc":
      return 12;
    case "cm":
      return 72.27 / 2.54;
    case "mm":
      return 72.27 / 25.4;
    case "bp":
      return 72.27 / 72;
    case "dd":
      return 1238 / 1157;
    case "cc":
      return 12 * 1238 / 1157;
    case "sp":
      return 1 / 65536;
    default:
      return null;
  }
}

export function parseTexDimensionText(text: string): TexLength | null {
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z]{2})\s*$/.exec(text);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  const factor = texDimensionUnitFactor(match[2] ?? "");
  return Number.isFinite(number) && factor !== null
    ? texLength(number * factor)
    : null;
}
