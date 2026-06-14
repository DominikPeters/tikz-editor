import {
  computerModernTexMetricProvider,
  type DefaultComputerModernMathFont,
} from "../fonts/computer-modern.js";
import {
  luaLatexDefaultTextFontProfile,
  type TexTextFontProfile,
} from "../fonts/text-profile.js";
import type {
  ResolvedTexFont,
  TexMetricProvider,
} from "../fonts/types.js";
import type { TexMathStyle } from "./ir.js";

export type TexMathFontFamily =
  | "operators"
  | "letters"
  | "symbols"
  | "extension";

export interface TexMathFontRequest {
  readonly family: TexMathFontFamily;
  readonly style: TexMathStyle;
  readonly baseAtPt?: number;
}

export interface TexMathFontManifestEntry {
  readonly family: TexMathFontFamily;
  readonly text: DefaultComputerModernMathFont;
  readonly script: DefaultComputerModernMathFont;
  readonly scriptscript: DefaultComputerModernMathFont;
}

export interface TexMathParameters {
  readonly axisHeight: number;
  readonly num1: number;
  readonly num2: number;
  readonly num3: number;
  readonly denom1: number;
  readonly denom2: number;
  readonly sup1: number;
  readonly sup2: number;
  readonly sup3: number;
  readonly sub1: number;
  readonly sub2: number;
  readonly supDrop: number;
  readonly subDrop: number;
  readonly delim1: number;
  readonly delim2: number;
  readonly defaultRuleThickness: number;
  readonly bigOpSpacing1: number;
  readonly bigOpSpacing2: number;
  readonly bigOpSpacing3: number;
  readonly bigOpSpacing4: number;
  readonly bigOpSpacing5: number;
}

export interface TexMathFontProfile {
  readonly id: string;
  readonly label: string;
  readonly engine: "lualatex";
  readonly preamble: readonly string[];
  readonly textFontProfile: TexTextFontProfile;
  readonly metricProvider: TexMetricProvider;
  readonly manifest: readonly TexMathFontManifestEntry[];
  readonly parameters: TexMathParameters;
  readonly resolveMathFontId: (
    family: TexMathFontFamily,
    style: TexMathStyle
  ) => DefaultComputerModernMathFont;
  readonly resolveMathFont: (request: TexMathFontRequest) => ResolvedTexFont;
}

const defaultManifest = [
  {
    family: "operators",
    text: "cmr10",
    script: "cmr7",
    scriptscript: "cmr5",
  },
  {
    family: "letters",
    text: "cmmi10",
    script: "cmmi7",
    scriptscript: "cmmi5",
  },
  {
    family: "symbols",
    text: "cmsy10",
    script: "cmsy7",
    scriptscript: "cmsy5",
  },
  {
    family: "extension",
    text: "cmex10",
    script: "cmex10",
    scriptscript: "cmex10",
  },
] as const satisfies readonly TexMathFontManifestEntry[];

export function luaLatexDefaultMathFontId(
  family: TexMathFontFamily,
  style: TexMathStyle
): DefaultComputerModernMathFont {
  const entry = defaultManifest.find((item) => item.family === family);
  if (!entry) {
    throw new Error(`Unknown TeX math font family '${family}'.`);
  }
  if (style === "script") {
    return entry.script;
  }
  if (style === "scriptscript") {
    return entry.scriptscript;
  }
  return entry.text;
}

export const luaLatexDefaultMathFontProfile: TexMathFontProfile = {
  id: "lualatex-default-math",
  label: "LuaLaTeX Default Computer Modern Math",
  engine: "lualatex",
  preamble: [],
  textFontProfile: luaLatexDefaultTextFontProfile,
  metricProvider: computerModernTexMetricProvider,
  manifest: defaultManifest,
  parameters: createLuaLatexDefaultMathParameters(computerModernTexMetricProvider),
  resolveMathFontId: luaLatexDefaultMathFontId,
  resolveMathFont: ({ family, style, baseAtPt = 10 }) => {
    const fontId = luaLatexDefaultMathFontId(family, style);
    const atPt = family === "extension"
      ? baseAtPt
      : baseAtPt * mathStyleScale(style);
    return computerModernTexMetricProvider.resolveFont({ fontId, atPt });
  },
};

export const defaultTexMathFontProfile = luaLatexDefaultMathFontProfile;

function createLuaLatexDefaultMathParameters(
  metricProvider: TexMetricProvider
): TexMathParameters {
  const symbols = metricProvider.resolveFont({ fontId: "cmsy10", atPt: 10 });
  const extension = metricProvider.resolveFont({ fontId: "cmex10", atPt: 10 });
  return {
    axisHeight: requiredFontdimen(symbols, "axisheight"),
    num1: requiredFontdimen(symbols, "num1"),
    num2: requiredFontdimen(symbols, "num2"),
    num3: requiredFontdimen(symbols, "num3"),
    denom1: requiredFontdimen(symbols, "denom1"),
    denom2: requiredFontdimen(symbols, "denom2"),
    sup1: requiredFontdimen(symbols, "sup1"),
    sup2: requiredFontdimen(symbols, "sup2"),
    sup3: requiredFontdimen(symbols, "sup3"),
    sub1: requiredFontdimen(symbols, "sub1"),
    sub2: requiredFontdimen(symbols, "sub2"),
    supDrop: requiredFontdimen(symbols, "supdrop"),
    subDrop: requiredFontdimen(symbols, "subdrop"),
    delim1: requiredFontdimen(symbols, "delim1"),
    delim2: requiredFontdimen(symbols, "delim2"),
    defaultRuleThickness: requiredFontdimen(extension, "defaultrulethickness"),
    bigOpSpacing1: requiredFontdimen(extension, "bigopspacing1"),
    bigOpSpacing2: requiredFontdimen(extension, "bigopspacing2"),
    bigOpSpacing3: requiredFontdimen(extension, "bigopspacing3"),
    bigOpSpacing4: requiredFontdimen(extension, "bigopspacing4"),
    bigOpSpacing5: requiredFontdimen(extension, "bigopspacing5"),
  };
}

function requiredFontdimen(font: ResolvedTexFont, name: string): number {
  const value = font.data.fontdimen[name];
  if (value === undefined) {
    throw new Error(`Font '${font.id}' is missing required math fontdimen '${name}'.`);
  }
  return value;
}

function mathStyleScale(style: TexMathStyle): number {
  if (style === "script") {
    return 0.7;
  }
  if (style === "scriptscript") {
    return 0.5;
  }
  return 1;
}
