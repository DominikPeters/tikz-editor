import { COLOR_HEX, NAMED_COLORS } from "./constants.js";
import { normalizeOptionValue } from "./option-utils.js";
import { hexToRgb, rgbToHex } from "../../utils/color-convert.js";
import { clamp01 } from "../../utils/math.js";

export { clamp01 } from "../../utils/math.js";

export type ColorAliasResolver = (rawColorName: string) => string | null;

export function normalizeColor(raw: string, opts: { currentColor?: string | null; resolveAlias?: ColorAliasResolver } = {}): string {
  const resolveAlias = opts.resolveAlias;
  const normalizedInput = normalizeOptionValue(raw).toLowerCase();
  const normalized = resolveAliasesInMixedColorExpression(normalizedInput, resolveAlias);
  const currentColor = resolveCurrentColor(opts.currentColor);
  const resolvedAlias = resolveAliasReference(normalized, resolveAlias);
  if (resolvedAlias && resolvedAlias !== normalized) {
    return normalizeColor(resolvedAlias, opts);
  }
  if (normalized === "none") {
    return "none";
  }
  if (normalized === ".") {
    return currentColor ?? "black";
  }
  const mixed = parseMixedColor(normalized, currentColor, resolveAlias);
  if (mixed) {
    return mixed;
  }
  if (NAMED_COLORS.has(normalized)) {
    return COLOR_HEX[normalized] ?? normalized;
  }
  if (normalized.startsWith("#")) {
    return normalized;
  }
  const modelColor = parseXcolorModelColor(normalized);
  if (modelColor) {
    return modelColor;
  }
  return normalized || "black";
}

export function resolveDefineColorModel(modelRaw: string, specificationRaw: string): string | null {
  const model = modelRaw.trim();
  if (model.length === 0) {
    return null;
  }

  if (model === "RGB") {
    const components = parseComponentList(specificationRaw, 3);
    if (!components) {
      return null;
    }
    return rgbToHex({
      r: clamp01(components[0] / 255) * 255,
      g: clamp01(components[1] / 255) * 255,
      b: clamp01(components[2] / 255) * 255
    });
  }

  if (model === "HSB") {
    const components = parseComponentList(specificationRaw, 3);
    if (!components) {
      return null;
    }
    return hsbToHex(components[0] / 240, components[1] / 240, components[2] / 240);
  }

  if (model === "Gray") {
    const components = parseComponentList(specificationRaw, 1);
    if (!components) {
      return null;
    }
    return rgbToHex({
      r: clamp01(components[0] / 15) * 255,
      g: clamp01(components[0] / 15) * 255,
      b: clamp01(components[0] / 15) * 255
    });
  }

  const normalizedModel = model.toLowerCase();
  if (normalizedModel === "html") {
    const normalizedSpec = specificationRaw.trim().replace(/\s+/g, "").replace(/^#/, "");
    if (!/^[0-9a-f]{6}$/i.test(normalizedSpec)) {
      return null;
    }
    return `#${normalizedSpec.toLowerCase()}`;
  }

  if (normalizedModel === "rgb") {
    const components = parseComponentList(specificationRaw, 3);
    if (!components) {
      return null;
    }
    return rgbToHex({
      r: clamp01(components[0]) * 255,
      g: clamp01(components[1]) * 255,
      b: clamp01(components[2]) * 255
    });
  }

  if (normalizedModel === "gray") {
    const components = parseComponentList(specificationRaw, 1);
    if (!components) {
      return null;
    }
    return rgbToHex({
      r: clamp01(components[0]) * 255,
      g: clamp01(components[0]) * 255,
      b: clamp01(components[0]) * 255
    });
  }

  if (normalizedModel === "cmy") {
    const components = parseComponentList(specificationRaw, 3);
    if (!components) {
      return null;
    }

    const c = clamp01(components[0]);
    const m = clamp01(components[1]);
    const y = clamp01(components[2]);
    return rgbToHex({
      r: (1 - c) * 255,
      g: (1 - m) * 255,
      b: (1 - y) * 255
    });
  }

  if (normalizedModel === "cmyk") {
    const components = parseComponentList(specificationRaw, 4);
    if (!components) {
      return null;
    }

    const c = clamp01(components[0]);
    const m = clamp01(components[1]);
    const y = clamp01(components[2]);
    const k = clamp01(components[3]);
    return rgbToHex({
      r: (1 - c) * (1 - k) * 255,
      g: (1 - m) * (1 - k) * 255,
      b: (1 - y) * (1 - k) * 255
    });
  }

  if (normalizedModel === "hsb") {
    const components = parseComponentList(specificationRaw, 3);
    if (!components) {
      return null;
    }
    return hsbToHex(components[0], components[1], components[2]);
  }

  return null;
}

export function normalizeShadingName(raw: string): string {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  return normalized.replace(/\s+/g, " ").trim();
}

export function mixNormalizedColors(first: string, second: string, ratio: number): string | null {
  const c1 = toRgbColor(first);
  const c2 = toRgbColor(second);
  if (!c1 || !c2) {
    return null;
  }

  const t = clamp01(ratio);
  return rgbToHex({
    r: Math.round(c1.r * t + c2.r * (1 - t)),
    g: Math.round(c1.g * t + c2.g * (1 - t)),
    b: Math.round(c1.b * t + c2.b * (1 - t))
  });
}

export function resolveColorToCss(
  raw: string,
  opts: { currentColor?: string | null; resolveAlias?: ColorAliasResolver } = {}
): string | null {
  const normalized = normalizeColor(raw, opts);
  if (normalized === "none") {
    return null;
  }
  return toRgbColor(normalized) ? normalized : null;
}

function toRgbColor(color: string): { r: number; g: number; b: number } | null {
  const normalized = color.trim().toLowerCase();
  if (normalized in COLOR_HEX) {
    return hexToRgb(COLOR_HEX[normalized]);
  }
  if (/^#[0-9a-f]{3}$/i.test(normalized) || /^#[0-9a-f]{6}$/i.test(normalized)) {
    return hexToRgb(normalized);
  }
  return null;
}

function parseComponentList(raw: string, count: number): number[] | null {
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length !== count) {
    return null;
  }

  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return values;
}

function hsbToHex(hueRaw: number, saturationRaw: number, brightnessRaw: number): string {
  const hue = (((hueRaw % 1) + 1) % 1) * 6;
  const saturation = clamp01(saturationRaw);
  const brightness = clamp01(brightnessRaw);
  const section = Math.floor(hue);
  const fraction = hue - section;
  const p = brightness * (1 - saturation);
  const q = brightness * (1 - saturation * fraction);
  const t = brightness * (1 - saturation * (1 - fraction));

  const [r, g, b] = (() => {
    switch (section % 6) {
      case 0:
        return [brightness, t, p];
      case 1:
        return [q, brightness, p];
      case 2:
        return [p, brightness, t];
      case 3:
        return [p, q, brightness];
      case 4:
        return [t, p, brightness];
      default:
        return [brightness, p, q];
    }
  })();

  return rgbToHex({
    r: r * 255,
    g: g * 255,
    b: b * 255
  });
}

function parseMixedColor(raw: string, currentColor: string | null, resolveAlias?: ColorAliasResolver): string | null {
  const parts = raw.split("!").map((part) => part.trim());
  if (parts.length <= 1 || !parts[0]) {
    return null;
  }

  let current = toRgbColor(resolveMixedColorToken(parts[0], currentColor, "black", resolveAlias));
  if (!current) {
    return null;
  }

  let cursor = 1;
  while (cursor < parts.length) {
    const percentageRaw = parts[cursor];
    const percentage = Number(percentageRaw);
    if (!percentageRaw || !Number.isFinite(percentage)) {
      return null;
    }
    cursor += 1;

    const mixColorName = parts[cursor] && parts[cursor].length > 0 ? parts[cursor] : "white";
    if (parts[cursor] && parts[cursor].length > 0) {
      cursor += 1;
    }

    const mixColor = toRgbColor(resolveMixedColorToken(mixColorName, currentColor, "white", resolveAlias));
    if (!mixColor) {
      return null;
    }

    const t = clamp01(percentage / 100);
    current = {
      r: current.r * t + mixColor.r * (1 - t),
      g: current.g * t + mixColor.g * (1 - t),
      b: current.b * t + mixColor.b * (1 - t)
    };
  }

  return rgbToHex(current);
}

function resolveMixedColorToken(
  token: string,
  currentColor: string | null,
  fallback: string,
  resolveAlias?: ColorAliasResolver
): string {
  const relative = resolveRelativeColorReference(token, currentColor, fallback);
  const resolvedAlias = resolveAliasReference(relative, resolveAlias);
  if (!resolvedAlias || resolvedAlias === relative) {
    return relative;
  }
  return normalizeColor(resolvedAlias, { currentColor, resolveAlias });
}

function resolveAliasesInMixedColorExpression(raw: string, resolveAlias?: ColorAliasResolver): string {
  if (!resolveAlias || !raw.includes("!")) {
    return raw;
  }

  const parts = raw.split("!");
  let changed = false;
  for (let index = 0; index < parts.length; index += 2) {
    const token = parts[index]?.trim() ?? "";
    if (!token || token === ".") {
      continue;
    }

    const resolvedAlias = resolveAliasReference(token, resolveAlias);
    if (!resolvedAlias || resolvedAlias === token) {
      continue;
    }

    parts[index] = resolvedAlias;
    changed = true;
  }

  return changed ? parts.join("!") : raw;
}

function resolveAliasReference(raw: string, resolveAlias?: ColorAliasResolver): string | null {
  if (!resolveAlias) {
    return null;
  }
  const resolved = resolveAlias(raw);
  if (!resolved) {
    return null;
  }
  const normalized = normalizeOptionValue(resolved).toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseXcolorModelColor(raw: string): string | null {
  const unwrapped = unwrapSingleBracePair(raw);
  const rgbBodyMatch = unwrapped.match(/^rgb(?:\s*,\s*255)?\s*:\s*(.+)$/i);
  if (!rgbBodyMatch) {
    return null;
  }

  const components = parseNamedRgbComponents(rgbBodyMatch[1] ?? "");
  if (!components) {
    return null;
  }

  const max = Math.max(components.r, components.g, components.b);
  const scale = max > 1 ? 255 : 1;
  return rgbToHex({
    r: (components.r / scale) * 255,
    g: (components.g / scale) * 255,
    b: (components.b / scale) * 255
  });
}

function parseNamedRgbComponents(raw: string): { r: number; g: number; b: number } | null {
  const values = new Map<string, number>();
  const entries = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const match = entry.match(/^([a-z]+)\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/i);
    if (!match) {
      return null;
    }
    const channel = match[1].toLowerCase();
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      return null;
    }
    values.set(channel, value);
  }

  return {
    r: values.get("red") ?? 0,
    g: values.get("green") ?? 0,
    b: values.get("blue") ?? 0
  };
}

function unwrapSingleBracePair(raw: string): string {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return trimmed;
  }

  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== trimmed.length - 1) {
        return trimmed;
      }
      if (depth < 0) {
        return trimmed;
      }
    }
  }

  return depth === 0 ? trimmed.slice(1, -1).trim() : trimmed;
}

function resolveRelativeColorReference(token: string, currentColor: string | null, fallback: string): string {
  return token === "." ? currentColor ?? fallback : token;
}

function resolveCurrentColor(color: string | null | undefined): string | null {
  if (!color) {
    return null;
  }
  const normalized = color.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "." || normalized === "none") {
    return null;
  }
  if (normalized in COLOR_HEX) {
    return COLOR_HEX[normalized];
  }
  if (/^#[0-9a-f]{3}$/i.test(normalized) || /^#[0-9a-f]{6}$/i.test(normalized)) {
    return normalized;
  }
  return parseMixedColor(normalized, null) ?? normalized;
}
