import {
  luaLatexDefaultTextFontProfile,
  type SimpleTexFontState,
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
