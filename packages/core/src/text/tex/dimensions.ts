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
    const reference = registerMatch[2] as
      | "linewidth"
      | "textwidth"
      | "columnwidth"
      | "paperwidth";
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
  const factor = Number(fontUnitMatch[1]);
  return Number.isFinite(factor)
    ? {
        kind: "contextual",
        raw,
        factor,
        reference: fontUnitMatch[2] as "em" | "ex",
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
