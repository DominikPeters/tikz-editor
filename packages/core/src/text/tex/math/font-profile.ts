import {
  computerModernTexMetricProvider,
  type DefaultComputerModernMathFont,
} from "../fonts/computer-modern.js";
import {
  luaLatexDefaultTextFontProfile,
  type TexTextFontProfile,
} from "../fonts/text-profile.js";
import { texLength, type TexLength } from "../coordinates.js";
import type {
  ResolvedTexFont,
  TexMetricProvider,
} from "../fonts/types.js";
import type {
  TexMathAlphabetCommand,
  TexMathStyle,
} from "./ir.js";

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
  /**
   * The source symbol whose TeX math family is being resolved.
   *
   * Most math font profiles only need the family. Classes such as Beamer,
   * however, redeclare literal Latin letters and digits through dedicated
   * symbol fonts while leaving Greek letters in the ordinary `letters`
   * family. Keeping the symbol available here models that distinction
   * without assigning a fake global family to either set of glyphs.
   */
  readonly symbolText?: string;
}

export interface TexMathAlphabetFontRequest {
  readonly alphabet: TexMathAlphabetCommand;
  readonly style: TexMathStyle;
  readonly baseAtPt: TexLength;
  readonly text: string;
}

export interface TexMathFontManifestEntry {
  readonly family: TexMathFontFamily;
  readonly text: DefaultComputerModernMathFont;
  readonly script: DefaultComputerModernMathFont;
  readonly scriptscript: DefaultComputerModernMathFont;
}

export interface TexMathParameters {
  readonly axisHeight: TexLength;
  readonly num1: TexLength;
  readonly num2: TexLength;
  readonly num3: TexLength;
  readonly denom1: TexLength;
  readonly denom2: TexLength;
  readonly sup1: TexLength;
  readonly sup2: TexLength;
  readonly sup3: TexLength;
  readonly sub1: TexLength;
  readonly sub2: TexLength;
  readonly supDrop: TexLength;
  readonly subDrop: TexLength;
  readonly delim1: TexLength;
  readonly delim2: TexLength;
  readonly defaultRuleThickness: TexLength;
  readonly bigOpSpacing1: TexLength;
  readonly bigOpSpacing2: TexLength;
  readonly bigOpSpacing3: TexLength;
  readonly bigOpSpacing4: TexLength;
  readonly bigOpSpacing5: TexLength;
  readonly stackNumUp: TexMathStyleParameterValues;
  readonly stackDenomDown: TexMathStyleParameterValues;
  readonly stackVGap: TexMathStyleParameterValues;
}

export interface TexMathStyleParameterValues {
  readonly display: TexLength;
  readonly text: TexLength;
  readonly script: TexLength;
  readonly scriptscript: TexLength;
}

export interface TexMathLayoutParameters {
  /** LaTeX's current `\strutbox` height used by array-like environments. */
  readonly arrayStrutHeight: TexLength;
  /** LaTeX's current `\strutbox` depth used by array-like environments. */
  readonly arrayStrutDepth: TexLength;
  /** Current surrounding `\baselineskip` used by AMS display alignments. */
  readonly alignedBaselineSkip: TexLength;
  /** Current `\lineskip` before amsmath applies `\openup\jot`. */
  readonly alignedLineSkip: TexLength;
  /** Current `\lineskiplimit` before amsmath applies `\openup\jot`. */
  readonly alignedLineSkipLimit: TexLength;
  /** AMS alignment `\jot`, applied through `\openup`. */
  readonly alignedJot: TexLength;
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
  readonly layoutParameters: TexMathLayoutParameters;
  readonly resolveMathFontId: (
    family: TexMathFontFamily,
    style: TexMathStyle
  ) => DefaultComputerModernMathFont;
  /**
   * Resolve TeX's text/script/scriptscript font size for the active text size.
   *
   * LaTeX declares exact math sizes for its standard text sizes and only uses
   * the 0.7/0.5 fallback ratios for undeclared sizes.
   */
  readonly resolveMathStyleAtPt: (
    style: TexMathStyle,
    baseAtPt: TexLength
  ) => TexLength;
  readonly resolveMathFont: (request: TexMathFontRequest) => ResolvedTexFont;
  /**
   * Optional class/package override for math alphabets such as `\mathbf`.
   * Returning null retains the profile-independent LaTeX alphabet mapping.
   */
  readonly resolveMathAlphabetFont?: (
    request: TexMathAlphabetFontRequest
  ) => ResolvedTexFont | null;
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
  readonly amsFontSelection?: boolean;
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
    layoutParameters: {
      arrayStrutHeight: texLength(8.399963),
      arrayStrutDepth: texLength(3.600037),
      alignedBaselineSkip: texLength(12),
      alignedLineSkip: texLength(1),
      alignedLineSkipLimit: texLength(0),
      alignedJot: texLength(3),
    },
    resolveMathFontId: options.resolveMathFontId,
    resolveMathStyleAtPt: luaLatexMathStyleAtPt,
    resolveMathFont: ({ family, style, baseAtPt: requestedBaseAtPt }) => {
      const baseAtPt = texLength(requestedBaseAtPt ?? 10);
      const atPt = mathFontAtPt(
        family,
        options.resolveMathFontId(family, style),
        style,
        baseAtPt,
        luaLatexMathStyleAtPt
      );
      const fontId = resolveComputerModernMathOpticalFont(
        family,
        atPt,
        options.amsFontSelection ?? false
      );
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
  amsFontSelection: true,
});

export const defaultTexMathFontProfile = luaLatexDefaultMathFontProfile;

function mathFontAtPt(
  family: TexMathFontFamily,
  fontId: DefaultComputerModernMathFont,
  style: TexMathStyle,
  baseAtPt: TexLength,
  resolveMathStyleAtPt: TexMathFontProfile["resolveMathStyleAtPt"]
): TexLength {
  if (family === "extension" && fontId === "cmex10") {
    return texLength(baseAtPt);
  }
  return resolveMathStyleAtPt(style, baseAtPt);
}

/**
 * Apply the optical-size rules from LaTeX's Computer Modern `.fd` files.
 *
 * A math style first chooses an actual point size through `\DeclareMathSizes`;
 * NFSS then chooses the design for that size. Those are distinct operations:
 * at a 10.95 pt text size, for example, script math is 8 pt and uses `cmmi8`,
 * not `cmmi7` enlarged to 8 pt.
 */
function resolveComputerModernMathOpticalFont(
  family: TexMathFontFamily,
  atPt: TexLength,
  amsFontSelection: boolean
): DefaultComputerModernMathFont {
  if (family === "operators") {
    if (atPt < 5.5) return "cmr5";
    if (atPt < 6.5) return "cmr6";
    if (atPt < 7.5) return "cmr7";
    if (atPt < 8.5) return "cmr8";
    if (atPt < 9.5) return "cmr9";
    if (atPt < 11.5) return "cmr10";
    if (atPt < 15.84) return "cmr12";
    return "cmr17";
  }
  if (family === "letters") {
    if (atPt < 5.5) return "cmmi5";
    if (atPt < 6.5) return "cmmi6";
    if (atPt < 7.5) return "cmmi7";
    if (atPt < 8.5) return "cmmi8";
    if (atPt < 9.5) return "cmmi9";
    if (atPt < 11.5) return "cmmi10";
    return "cmmi12";
  }
  if (family === "symbols") {
    if (atPt < 5.5) return "cmsy5";
    if (atPt < 6.5) return "cmsy6";
    if (atPt < 7.5) return "cmsy7";
    if (atPt < 8.5) return "cmsy8";
    if (atPt < 9.5) return "cmsy9";
    return "cmsy10";
  }
  if (family === "extension") {
    if (!amsFontSelection) return "cmex10";
    if (atPt < 8) return "cmex7";
    if (atPt < 9) return "cmex8";
    if (atPt < 9.5) return "cmex9";
    return "cmex10";
  }
  if (family === "amsSymbolsA") {
    if (atPt < 6) return "msam5";
    if (atPt < 8) return "msam7";
    return "msam10";
  }
  if (atPt < 6) return "msbm5";
  if (atPt < 8) return "msbm7";
  return "msbm10";
}

const latexDeclaredMathSizes = [
  { text: 5, script: 5, scriptscript: 5 },
  { text: 6, script: 5, scriptscript: 5 },
  { text: 7, script: 5, scriptscript: 5 },
  { text: 8, script: 6, scriptscript: 5 },
  { text: 9, script: 6, scriptscript: 5 },
  { text: 10, script: 7, scriptscript: 5 },
  { text: 10.95, script: 8, scriptscript: 6 },
  { text: 12, script: 8, scriptscript: 6 },
  { text: 14.4, script: 10, scriptscript: 7 },
  { text: 17.28, script: 12, scriptscript: 10 },
  { text: 20.74, script: 14.4, scriptscript: 12 },
  { text: 24.88, script: 20.74, scriptscript: 17.28 },
] as const;

/**
 * The default declarations from LaTeX's `fontmath.ltx`.
 *
 * NFSS keys these declarations by the exact current font size. The small
 * tolerance only absorbs decimal representation at our typed-point boundary.
 */
export function luaLatexMathStyleAtPt(
  style: TexMathStyle,
  baseAtPt: TexLength
): TexLength {
  if (style === "display" || style === "text") {
    return texLength(baseAtPt);
  }
  const declaration = latexDeclaredMathSizes.find(
    (entry) => Math.abs(entry.text - baseAtPt) < 0.005
  );
  if (declaration) {
    return texLength(
      style === "script" ? declaration.script : declaration.scriptscript
    );
  }
  return texLength(baseAtPt * mathStyleScale(style));
}

function createLuaLatexDefaultMathParameters(
  metricProvider: TexMetricProvider
): TexMathParameters {
  const symbols = metricProvider.resolveFont({ fontId: "cmsy10", atPt: texLength(10) });
  const extension = metricProvider.resolveFont({ fontId: "cmex10", atPt: texLength(10) });
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
    stackNumUp: texMathStyleParameterValues({
      display: 6.76508,
      text: 4.4373,
      script: 3.29843,
      scriptscript: 2.52066,
    }),
    stackDenomDown: texMathStyleParameterValues({
      display: 6.85951,
      text: 3.44841,
      script: 2.4095,
      scriptscript: 2.65953,
    }),
    stackVGap: texMathStyleParameterValues({
      display: 2.79985,
      text: 1.19994,
      script: 1.01994,
      scriptscript: 0.72853,
    }),
  };
}

function requiredFontdimen(font: ResolvedTexFont, name: string): TexLength {
  const value = font.data.fontdimen[name];
  if (value === undefined) {
    throw new Error(`Font '${font.id}' is missing required math fontdimen '${name}'.`);
  }
  return texLength(value);
}

function texMathStyleParameterValues(values: {
  readonly display: number;
  readonly text: number;
  readonly script: number;
  readonly scriptscript: number;
}): TexMathStyleParameterValues {
  return {
    display: texLength(values.display),
    text: texLength(values.text),
    script: texLength(values.script),
    scriptscript: texLength(values.scriptscript),
  };
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
