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
  | "extension"
  | "amsSymbolsA"
  | "amsSymbolsB";

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
  readonly stackNumUp: TexMathStyleParameterValues;
  readonly stackDenomDown: TexMathStyleParameterValues;
  readonly stackVGap: TexMathStyleParameterValues;
}

export interface TexMathStyleParameterValues {
  readonly display: number;
  readonly text: number;
  readonly script: number;
  readonly scriptscript: number;
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

const amsMathManifest = [
  ...defaultManifest.slice(0, 3),
  {
    family: "extension",
    text: "cmex10",
    script: "cmex7",
    scriptscript: "cmex7",
  },
  {
    family: "amsSymbolsA",
    text: "msam10",
    script: "msam7",
    scriptscript: "msam5",
  },
  {
    family: "amsSymbolsB",
    text: "msbm10",
    script: "msbm7",
    scriptscript: "msbm5",
  },
] as const satisfies readonly TexMathFontManifestEntry[];

export function luaLatexDefaultMathFontId(
  family: TexMathFontFamily,
  style: TexMathStyle
): DefaultComputerModernMathFont {
  return resolveManifestFontId(defaultManifest, family, style);
}

export function luaLatexAmsMathFontId(
  family: TexMathFontFamily,
  style: TexMathStyle
): DefaultComputerModernMathFont {
  return resolveManifestFontId(amsMathManifest, family, style);
}

function resolveManifestFontId(
  manifest: readonly TexMathFontManifestEntry[],
  family: TexMathFontFamily,
  style: TexMathStyle
): DefaultComputerModernMathFont {
  const entry = manifest.find((item) => item.family === family);
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

function createComputerModernMathFontProfile(options: {
  readonly id: string;
  readonly label: string;
  readonly preamble: readonly string[];
  readonly manifest: readonly TexMathFontManifestEntry[];
  readonly resolveMathFontId: (family: TexMathFontFamily, style: TexMathStyle) => DefaultComputerModernMathFont;
}): TexMathFontProfile {
  return {
    id: options.id,
    label: options.label,
    engine: "lualatex",
    preamble: options.preamble,
    textFontProfile: luaLatexDefaultTextFontProfile,
    metricProvider: computerModernTexMetricProvider,
    manifest: options.manifest,
    parameters: createLuaLatexDefaultMathParameters(computerModernTexMetricProvider),
    resolveMathFontId: options.resolveMathFontId,
    resolveMathFont: ({ family, style, baseAtPt = 10 }) => {
      const fontId = options.resolveMathFontId(family, style);
      const atPt = mathFontAtPt(family, fontId, style, baseAtPt);
      return computerModernTexMetricProvider.resolveFont({ fontId, atPt });
    },
  };
}

export const luaLatexDefaultMathFontProfile: TexMathFontProfile = createComputerModernMathFontProfile({
  id: "lualatex-default-math",
  label: "LuaLaTeX Default Computer Modern Math",
  preamble: [],
  manifest: defaultManifest,
  resolveMathFontId: luaLatexDefaultMathFontId,
});

export const luaLatexAmsMathFontProfile: TexMathFontProfile = createComputerModernMathFontProfile({
  id: "lualatex-ams-math",
  label: "LuaLaTeX AMS Computer Modern Math",
  preamble: [String.raw`\usepackage{amsmath,amssymb}`],
  manifest: amsMathManifest,
  resolveMathFontId: luaLatexAmsMathFontId,
});

export const defaultTexMathFontProfile = luaLatexDefaultMathFontProfile;

function mathFontAtPt(
  family: TexMathFontFamily,
  fontId: DefaultComputerModernMathFont,
  style: TexMathStyle,
  baseAtPt: number
): number {
  if (family === "extension" && fontId === "cmex10") {
    return baseAtPt;
  }
  return baseAtPt * mathStyleScale(style);
}

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
    stackNumUp: {
      display: 6.76508,
      text: 4.4373,
      script: 3.29843,
      scriptscript: 2.52066,
    },
    stackDenomDown: {
      display: 6.85951,
      text: 3.44841,
      script: 2.4095,
      scriptscript: 2.65953,
    },
    stackVGap: {
      display: 2.79985,
      text: 1.19994,
      script: 1.01994,
      scriptscript: 0.72853,
    },
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
