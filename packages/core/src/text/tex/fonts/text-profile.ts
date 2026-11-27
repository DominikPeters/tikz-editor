import type { SimpleTexFontState } from "../ir.js";
import {
  computerModernTexMetricProvider,
  type DefaultComputerModernTextFont,
} from "./computer-modern.js";
import type {
  ResolvedTexFont,
  TexMetricProvider,
} from "./types.js";
import { texLength, type TexLength } from "../coordinates.js";

/** A generated text font, or a runtime OpenType font (runtime-registry.ts). */
export type TexTextFontId = DefaultComputerModernTextFont | `otf:${string}`;

export interface TexTextFontProfile {
  readonly id: string;
  readonly label: string;
  readonly engine: "tex" | "lualatex";
  readonly encoding: "OT1" | "TU";
  readonly metricProvider: TexMetricProvider;
  readonly defaultFontState: SimpleTexFontState;
  readonly resolveTextFontId: (state: SimpleTexFontState, atPt?: TexLength) => TexTextFontId;
  readonly resolveTextFont: (
    state: SimpleTexFontState,
    atPt: TexLength,
    metricProvider?: TexMetricProvider
  ) => ResolvedTexFont;
}

const classicDefaultFontState: SimpleTexFontState = {
  family: "roman",
  series: "medium",
  shape: "upright",
};

const luaLatexDefaultFontState: SimpleTexFontState = {
  family: "normal",
  series: "medium",
  shape: "upright",
};

function makeTextFontProfile(params: {
  readonly id: string;
  readonly label: string;
  readonly engine: TexTextFontProfile["engine"];
  readonly encoding: TexTextFontProfile["encoding"];
  readonly defaultFontState: SimpleTexFontState;
  readonly resolveTextFontId: (state: SimpleTexFontState, atPt?: TexLength) => TexTextFontId;
}): TexTextFontProfile {
  return {
    ...params,
    metricProvider: computerModernTexMetricProvider,
    resolveTextFont: (state, atPt, metricProvider = computerModernTexMetricProvider) => {
      const resolvedAtPt = state.sizePt ?? atPt;
      return {
        ...metricProvider.resolveFont({
          fontId: params.resolveTextFontId(state, resolvedAtPt),
          atPt: resolvedAtPt,
        }),
        ...(state.color ? { color: state.color } : {}),
      };
    },
  };
}

export const classicComputerModernTextFontProfile = makeTextFontProfile({
  id: "classic-computer-modern-ot1",
  label: "Classic Computer Modern OT1",
  engine: "tex",
  encoding: "OT1",
  defaultFontState: classicDefaultFontState,
  resolveTextFontId: classicComputerModernFontIdForState,
});

export const luaLatexDefaultTextFontProfile = makeTextFontProfile({
  id: "lualatex-default-tu",
  label: "LuaLaTeX Default Latin Modern TU",
  engine: "lualatex",
  encoding: "TU",
  defaultFontState: luaLatexDefaultFontState,
  resolveTextFontId: luaLatexDefaultFontIdForState,
});

export const defaultTexTextFontProfile = luaLatexDefaultTextFontProfile;

export function classicComputerModernFontIdForState(
  state: SimpleTexFontState,
  _atPt = texLength(10)
): DefaultComputerModernTextFont {
  if (
    state.family === "normal" &&
    state.series === "medium" &&
    state.shape === "upright"
  ) {
    return "lmroman10-regular";
  }
  if (state.family === "sans") {
    if (state.series === "bold") {
      return "cmssbx10";
    }
    if (state.shape === "small-caps") {
      return "cmcsc10";
    }
    if (state.shape === "italic") {
      return "cmssi10";
    }
    if (state.shape === "slanted") {
      return "cmssi10";
    }
    return "cmss10";
  }
  if (state.family === "typewriter") {
    return "cmtt10";
  }
  if (state.series === "bold" && state.shape === "small-caps") {
    return "cmbx10";
  }
  if (state.series === "bold" && state.shape === "italic") {
    return "cmbxti10";
  }
  if (state.series === "bold") {
    return "cmbx10";
  }
  if (state.shape === "small-caps") {
    return "cmcsc10";
  }
  if (state.shape === "italic") {
    return "cmti10";
  }
  if (state.shape === "slanted") {
    return "cmti10";
  }
  return "cmr10";
}

/**
 * Optical size of a TU Latin Modern Roman face at `atPt`, from LaTeX's
 * tulmr.fd. NFSS size ranges are half-open: `<8.5-9.5>` covers
 * 8.5 <= size < 9.5. Checked against LuaLaTeX's `\fontname` for every size
 * command of the 10/11/12pt classes and at the range boundaries
 * (design/pgfplots-behaviour.md K4).
 */
export function lmRomanOpticalSize(atPt: number): 5 | 6 | 7 | 8 | 9 | 10 | 12 | 17 {
  return atPt < 5.5 ? 5 : atPt < 6.5 ? 6 : atPt < 7.5 ? 7 : atPt < 8.5 ? 8 : atPt < 9.5 ? 9 : atPt < 11 ? 10 : atPt < 15 ? 12 : 17;
}

/**
 * LuaLaTeX's default text font (TU encoding, Latin Modern) for a font state,
 * following tulmr.fd, tulmss.fd and tulmtt.fd with NFSS's substitutions.
 */
export function luaLatexDefaultFontIdForState(
  state: SimpleTexFontState,
  atPt = texLength(10)
): DefaultComputerModernTextFont {
  if (state.family === "typewriter") {
    // tulmtt.fd: bold (b, and bx by ssub) is lmmonolt10 at every size; the
    // undeclared bold small-caps shape falls back to the series' n shape.
    if (state.series === "bold") {
      return state.shape === "italic" || state.shape === "slanted" ? "lmmonolt10-boldoblique" : "lmmonolt10-bold";
    }
    if (state.shape === "small-caps") {
      return "lmmonocaps10-regular";
    }
    if (state.shape === "italic") {
      return "lmmono10-italic";
    }
    if (state.shape === "slanted") {
      return "lmmonoslant10-regular";
    }
    return atPt < 8.5 ? "lmmono8-regular" : atPt < 9.5 ? "lmmono9-regular" : atPt < 11 ? "lmmono10-regular" : "lmmono12-regular";
  }
  if (state.family === "sans") {
    // tulmss.fd: bold is lmsans10 at every size; m/sc substitutes lmr/m/sc;
    // bx/sc is undeclared and falls back to bx/n.
    if (state.series === "bold") {
      return state.shape === "italic" || state.shape === "slanted" ? "lmsans10-boldoblique" : "lmsans10-bold";
    }
    if (state.shape === "small-caps") {
      return "lmromancaps10-regular";
    }
    const size = atPt < 8.5 ? 8 : atPt < 9.5 ? 9 : atPt < 11 ? 10 : atPt < 15.5 ? 12 : 17;
    const shape = state.shape === "italic" || state.shape === "slanted" ? "oblique" : "regular";
    return `lmsans${size}-${shape}`;
  }
  // Roman, the document default: tulmr.fd.
  const size = lmRomanOpticalSize(atPt);
  if (state.series === "bold") {
    if (state.shape === "italic") {
      return "lmroman10-bolditalic";
    }
    if (state.shape === "slanted") {
      return "lmromanslant10-bold";
    }
    // bx/n has no 17pt design (<11-> is lmroman12-bold); bx/sc is
    // undeclared and falls back to bx/n at the same size.
    return `lmroman${size === 17 ? 12 : size}-bold`;
  }
  if (state.shape === "small-caps") {
    return "lmromancaps10-regular";
  }
  if (state.shape === "italic") {
    const italic = size === 5 || size === 6 ? 7 : size === 17 ? 12 : size;
    return `lmroman${italic}-italic`;
  }
  if (state.shape === "slanted") {
    const slant = size === 5 || size === 6 || size === 7 ? 8 : size;
    return `lmromanslant${slant}-regular`;
  }
  return `lmroman${size}-regular`;
}
