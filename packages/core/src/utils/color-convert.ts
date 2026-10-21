export type RgbColor = { r: number; g: number; b: number };

export function hexToRgb(hex: string): RgbColor {
  const normalized = hex.replace(/^#/u, "");
  const value = normalized.length === 3
    ? normalized.split("").map((character) => character + character).join("")
    : normalized;
  const parsed = Number.parseInt(value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

export function rgbToHex(rgb: RgbColor): string {
  const components = [rgb.r, rgb.g, rgb.b].map((component) =>
    Math.round(Math.max(0, Math.min(255, component)))
      .toString(16)
      .padStart(2, "0")
  );
  return `#${components.join("")}`;
}
