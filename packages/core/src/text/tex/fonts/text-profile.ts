import type { SimpleTexFontState } from "../ir.js";
import {
  computerModernTexMetricProvider,
  type DefaultComputerModernTextFont,
} from "./computer-modern.js";
import type {
  ResolvedTexFont,
  TexMetricProvider,
} from "./types.js";

export interface TexTextFontProfile {
  readonly id: string;
  readonly label: string;
  readonly engine: "tex" | "lualatex";
  readonly encoding: "OT1" | "TU";
  readonly metricProvider: TexMetricProvider;
  readonly defaultFontState: SimpleTexFontState;
  readonly resolveTextFontId: (state: SimpleTexFontState) => DefaultComputerModernTextFont;
  readonly resolveTextFont: (
    state: SimpleTexFontState,
    atPt: number,
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
  readonly resolveTextFontId: (state: SimpleTexFontState) => DefaultComputerModernTextFont;
}): TexTextFontProfile {
  return {
    ...params,
    metricProvider: computerModernTexMetricProvider,
    resolveTextFont: (state, atPt, metricProvider = computerModernTexMetricProvider) =>
      metricProvider.resolveFont({
        fontId: params.resolveTextFontId(state),
        atPt,
      }),
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
  state: SimpleTexFontState
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
    return "cmss10";
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
  return "cmr10";
}

export function luaLatexDefaultFontIdForState(
  state: SimpleTexFontState
): DefaultComputerModernTextFont {
  if (state.shape === "small-caps") {
    return "lmromancaps10-regular";
  }
  if (state.family === "sans") {
    if (state.series === "bold" && state.shape === "italic") {
      return "lmsans10-boldoblique";
    }
    if (state.series === "bold") {
      return "lmsans10-bold";
    }
    if (state.shape === "italic") {
      return "lmsans10-oblique";
    }
    return "lmsans10-regular";
  }
  if (state.series === "bold" && state.shape === "italic") {
    return "lmroman10-bolditalic";
  }
  if (state.series === "bold") {
    return "lmroman10-bold";
  }
  if (state.shape === "italic") {
    return "lmroman10-italic";
  }
  return "lmroman10-regular";
}
