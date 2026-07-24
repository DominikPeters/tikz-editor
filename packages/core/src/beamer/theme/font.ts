import {
  computerModernTexMetricProvider,
  luaLatexAmsMathFontProfile,
  luaLatexDefaultTextFontProfile,
  texLength,
  type SimpleTexFontState,
  type TexMathFontProfile,
  type TexTextFontProfile,
} from "../../text/tex/index.js";
import type { BeamerThemeFont } from "./types.js";

/**
 * Adapt a resolved Beamer font role to the generic LuaLaTeX text frontend.
 *
 * In Beamer, `normal` family means the role's inherited family (normally
 * sans), whereas the generic text profile's normal family is Roman.
 */
export function createBeamerTexTextFontProfile(
  role: BeamerThemeFont
): TexTextFontProfile {
  const normalize = (state: SimpleTexFontState): SimpleTexFontState => {
    if (state.family !== "normal") {
      return state;
    }
    return {
      ...state,
      family:
        role.family === "serif"
          ? "roman"
          : role.family === "monospace"
            ? "typewriter"
            : "sans",
      series:
        state.series === "medium" && role.series === "bold"
          ? "bold"
          : state.series,
      shape:
        state.shape === "upright" && role.shape !== "upright"
          ? role.shape
          : state.shape,
    };
  };
  return {
    ...luaLatexDefaultTextFontProfile,
    id: `lualatex-beamer-${role.family}-${role.series}-${role.shape}`,
    label: `LuaLaTeX Beamer ${role.family}`,
    resolveTextFontId(state, atPt) {
      return luaLatexDefaultTextFontProfile.resolveTextFontId(
        normalize(state),
        atPt
      );
    },
    resolveTextFont(state, atPt, metricProvider) {
      return luaLatexDefaultTextFontProfile.resolveTextFont(
        normalize(state),
        atPt,
        metricProvider
      );
    },
  };
}

/**
 * Reproduce Beamer's default sans-math substitutions.
 *
 * `beamerbasefont.sty` replaces the operators symbol font with `cmss`, then
 * declares literal digits and Latin letters through the active sans text
 * family. It deliberately leaves Greek letters, symbols, large operators,
 * and AMS symbols in their ordinary Computer Modern math families.
 */
export function createBeamerTexMathFontProfile(
  role: BeamerThemeFont
): TexMathFontProfile {
  const base = luaLatexAmsMathFontProfile;
  const textFontProfile = createBeamerTexTextFontProfile(role);
  return {
    ...base,
    id: `${base.id}-beamer-${role.family}-${role.series}-${role.shape}`,
    label: `${base.label} with Beamer font substitutions`,
    textFontProfile,
    layoutParameters: {
      arrayStrutHeight: texLength(role.lineHeightPt * 0.7),
      arrayStrutDepth: texLength(role.lineHeightPt * 0.3),
      alignedBaselineSkip: texLength(role.lineHeightPt),
      alignedLineSkip: base.layoutParameters.alignedLineSkip,
      alignedLineSkipLimit: base.layoutParameters.alignedLineSkipLimit,
      alignedJot: base.layoutParameters.alignedJot,
    },
    resolveMathFont(request) {
      const baseAtPt = texLength(request.baseAtPt ?? 10);
      const atPt = base.resolveMathStyleAtPt(request.style, baseAtPt);
      if (/^[A-Za-z]$/.test(request.symbolText ?? "")) {
        return textFontProfile.resolveTextFont(
          {
            ...textFontProfile.defaultFontState,
            family: "normal",
            series: "medium",
            shape: "italic",
          },
          atPt,
          computerModernTexMetricProvider
        );
      }
      if (/^[0-9]$/.test(request.symbolText ?? "")) {
        return textFontProfile.resolveTextFont(
          {
            ...textFontProfile.defaultFontState,
            family: "normal",
            series: "medium",
            shape: "upright",
          },
          atPt,
          computerModernTexMetricProvider
        );
      }
      if (request.family === "operators") {
        return computerModernTexMetricProvider.resolveFont({
          fontId: atPt <= 8 ? "cmss8" : "cmss10",
          atPt,
        });
      }
      return base.resolveMathFont(request);
    },
    resolveMathAlphabetFont(request) {
      if (
        request.alphabet !== "mathbf" ||
        !/^[A-Za-z0-9]$/.test(request.text)
      ) {
        return base.resolveMathAlphabetFont?.(request) ?? null;
      }
      return textFontProfile.resolveTextFont(
        {
          ...textFontProfile.defaultFontState,
          family: "normal",
          series: "bold",
          shape: "upright",
        },
        base.resolveMathStyleAtPt(request.style, request.baseAtPt),
        computerModernTexMetricProvider
      );
    },
  };
}
