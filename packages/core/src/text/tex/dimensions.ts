import { texLength, type TexLength } from "./coordinates.js";
import type { ResolvedTexFont } from "./fonts/types.js";

export const TEX_CONTEXTUAL_DIMENSION_REFERENCES = [
  "linewidth",
  "textwidth",
  "columnwidth",
  "paperwidth",
  "em",
  "ex",
] as const;

export type TexContextualDimensionReference =
  (typeof TEX_CONTEXTUAL_DIMENSION_REFERENCES)[number];

/**
 * A TeX dimension before layout registers and the active font are known.
 *
 * Keep this distinct from `TexLength`: a `TexLength` is already an absolute
 * scalar in TeX points, while a contextual expression must survive until the
 * containing paragraph/column/page establishes its registers.
 */
export type TexDimensionExpression =
  | {
      readonly kind: "absolute";
      readonly raw: string;
      readonly value: TexLength;
    }
  | {
      readonly kind: "contextual";
      readonly raw: string;
      readonly factor: number;
      readonly reference: TexContextualDimensionReference;
    };

export interface TexDimensionContext {
  readonly linewidth: TexLength;
  readonly textwidth: TexLength;
  readonly columnwidth: TexLength;
  readonly paperwidth: TexLength;
  readonly em: TexLength;
  readonly ex: TexLength;
}

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

// TeX's unit table (tex.web §458): a unit is num/denom points.
const TEX_UNIT_RATIOS: Readonly<Record<string, readonly [number, number]>> = {
  pt: [1, 1], in: [7227, 100], pc: [12, 1], cm: [7227, 254], mm: [7227, 2540],
  bp: [7227, 7200], dd: [1238, 1157], cc: [14856, 1157],
};

/**
 * A decimal dimension as TeX scans it (tex.web §448–§458): the fraction is
 * rounded to 2^-16 with `round_decimals`, the unit applied with
 * `xn_over_d`, and the result kept in scaled points. `84.1cm` is
 * 2392.876938pt here, not the 2392.876772pt of the real-number product.
 */
export function texScannedDimensionPt(decimal: string, unit: string): number | null {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/u.exec(decimal);
  if (!match || (!match[2] && !match[3])) return null;
  // Number("") is 0: an empty integer part, as in ".5cm".
  if (unit === "sp") return (match[1] === "-" ? -1 : 1) * Number(match[2] ?? "") / 65536;
  const ratio = TEX_UNIT_RATIOS[unit];
  if (!ratio) return null;
  const negative = match[1] === "-";
  let integer = Number(match[2] ?? "");
  // round_decimals: at most 17 fraction digits matter.
  const digits = (match[3] ?? "").slice(0, 17);
  let a = 0;
  for (let k = digits.length - 1; k >= 0; k -= 1) a = Math.floor((a + Number(digits[k]) * 131072) / 10);
  let fraction = Math.floor((a + 1) / 2);
  const [num, denom] = ratio;
  if (num !== 1 || denom !== 1) {
    const product = integer * num;
    const remainder = product % denom;
    integer = Math.floor(product / denom);
    fraction = Math.floor((num * fraction + 65536 * remainder) / denom);
    integer += Math.floor(fraction / 65536);
    fraction %= 65536;
  }
  const scaled = integer * 65536 + fraction;
  return (negative ? -scaled : scaled) / 65536;
}

/**
 * `<decimal>\register` as TeX scans it (tex.web §455): the fraction is
 * rounded to 2^-16 and the product truncated to scaled points, so
 * `.333333\paperwidth` is 0.333328 of the width, not a third.
 */
export function texDecimalTimesDimensionPt(decimal: string, dimensionPt: number): number | null {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/u.exec(decimal);
  if (!match || (!match[2] && !match[3])) return null;
  const digits = (match[3] ?? "").slice(0, 17);
  let a = 0;
  for (let k = digits.length - 1; k >= 0; k -= 1) a = Math.floor((a + Number(digits[k]) * 131072) / 10);
  const fraction = Math.floor((a + 1) / 2);
  const integer = Number(match[2] ?? "");
  const value = Math.round(dimensionPt * 65536);
  const magnitude = Math.abs(value);
  const product = integer * magnitude + Math.floor(magnitude * fraction / 65536);
  const negative = (match[1] === "-") !== (value < 0);
  return (negative ? -product : product) / 65536;
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

export function parseTexDimensionExpression(
  text: string
): TexDimensionExpression | null {
  const raw = text;
  const normalized = stripBalancedDimensionBraceLayers(text).trim();
  const absolute = parseTexDimensionText(normalized);
  if (absolute !== null) {
    return {
      kind: "absolute",
      raw,
      value: absolute,
    };
  }

  const registerMatch =
    /^([+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)\s*)?)\\(linewidth|textwidth|columnwidth|paperwidth)\s*$/u.exec(
      normalized
    );
  if (registerMatch) {
    const factor = contextualDimensionFactor(registerMatch[1] ?? "");
    const reference = registerMatch[2];
    if (reference !== "linewidth" && reference !== "textwidth" && reference !== "columnwidth" && reference !== "paperwidth") return null;
    return factor === null
      ? null
      : {
          kind: "contextual",
          raw,
          factor,
          reference,
        };
  }

  const fontUnitMatch =
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(em|ex)\s*$/u.exec(normalized);
  if (!fontUnitMatch) {
    return null;
  }
  const reference = fontUnitMatch[2];
  if (reference !== "em" && reference !== "ex") return null;
  const factor = Number(fontUnitMatch[1]);
  return Number.isFinite(factor)
    ? {
        kind: "contextual",
        raw,
        factor,
        reference,
      }
    : null;
}

export function resolveTexDimensionExpression(
  expression: TexDimensionExpression,
  context: TexDimensionContext
): TexLength {
  return expression.kind === "absolute"
    ? expression.value
    : texLength(expression.factor * context[expression.reference]);
}

export function texDimensionContextForFont(
  context: TexDimensionContext,
  font: ResolvedTexFont
): TexDimensionContext {
  const quad = font.data.fontdimen.quad;
  const xheight = font.data.fontdimen.xheight;
  return {
    ...context,
    em: texLength(font.atPt * (
      typeof quad === "number" && Number.isFinite(quad) ? quad : 1
    )),
    ex: texLength(font.atPt * (
      typeof xheight === "number" && Number.isFinite(xheight) ? xheight : 0.43
    )),
  };
}

function contextualDimensionFactor(raw: string): number | null {
  const normalized = raw.trim();
  if (normalized === "" || normalized === "+") {
    return 1;
  }
  if (normalized === "-") {
    return -1;
  }
  const factor = Number(normalized);
  return Number.isFinite(factor) ? factor : null;
}

function stripBalancedDimensionBraceLayers(text: string): string {
  let trimmed = text.trim();
  while (hasSingleBalancedDimensionBraceLayer(trimmed)) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function hasSingleBalancedDimensionBraceLayer(trimmed: string): boolean {
  if (
    trimmed.length < 2 ||
    trimmed[0] !== "{" ||
    trimmed[trimmed.length - 1] !== "}"
  ) {
    return false;
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
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== trimmed.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

/**
 * A length expression as `\setlength` with calc, `\addtolength` or
 * `\dimexpr ... \relax` reads it: terms of `[decimal]\register` or
 * `<decimal><unit>`, joined by `+` and `-`, each optionally multiplied or
 * divided by a number (`*2`, `/3`, `*\real{0.5}`). Factors and units are
 * scanned to scaled points as TeX does. `lookup` gives a register's current
 * value in points; an unknown register makes the expression unsupported.
 */
export function evaluateTexLengthExpression(
  text: string,
  lookup: (name: string) => number | undefined,
  fontUnits?: { readonly em: number; readonly ex: number }
): number | null {
  let rest = stripBalancedDimensionBraceLayers(text).trim();
  const dimexpr = /^\\dimexpr(?![A-Za-z@])([\s\S]*?)(?:\\relax(?![A-Za-z@]))?\s*$/u.exec(rest);
  if (dimexpr) rest = (dimexpr[1] ?? "").trim();
  if (!rest) return null;
  let totalSp = 0;
  let first = true;
  const term = /^\s*([+-])?\s*(\d*(?:\.\d*)?)\s*(?:\\([A-Za-z@]+)|([A-Za-z]{2}))\s*/u;
  const scale = /^\s*([*/])\s*(?:\\real\s*\{\s*([+-]?\d*(?:\.\d*)?)\s*\}|([+-]?\d*(?:\.\d*)?))\s*/u;
  while (rest.length > 0) {
    const match = term.exec(rest);
    if (!match || (!first && !match[1])) return null;
    first = false;
    rest = rest.slice(match[0].length);
    const negative = match[1] === "-";
    const decimal = match[2] ?? "";
    let valuePt: number | null;
    if (match[3] !== undefined) {
      const name = match[3];
      const base = name === "relax" ? undefined : lookup(name);
      if (base === undefined) return null;
      valuePt = decimal === "" ? base : texDecimalTimesDimensionPt(decimal, base);
    } else {
      const unit = match[4] ?? "";
      if ((unit === "em" || unit === "ex") && fontUnits) {
        valuePt = texDecimalTimesDimensionPt(decimal === "" ? "1" : decimal, fontUnits[unit]);
      } else {
        valuePt = decimal === "" ? null : texScannedDimensionPt(decimal, unit);
      }
    }
    if (valuePt === null) return null;
    let sp = Math.round(valuePt * 65536);
    for (let factor = scale.exec(rest); factor; factor = scale.exec(rest)) {
      rest = rest.slice(factor[0].length);
      const number = Number(factor[2] ?? factor[3] ?? "");
      if (!Number.isFinite(number) || (factor[1] === "/" && number === 0)) return null;
      sp = Math.round(factor[1] === "*" ? sp * number : sp / number);
    }
    totalSp += negative ? -sp : sp;
  }
  return totalSp / 65536;
}
