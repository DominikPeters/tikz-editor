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

export interface TexTextFontProfile {
  readonly id: string;
  readonly label: string;
  readonly engine: "tex" | "lualatex";
  readonly encoding: "OT1" | "TU";
  readonly metricProvider: TexMetricProvider;
  readonly defaultFontState: SimpleTexFontState;
  readonly resolveTextFontId: (state: SimpleTexFontState, atPt?: TexLength) => DefaultComputerModernTextFont;
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
  readonly resolveTextFontId: (state: SimpleTexFontState, atPt?: TexLength) => DefaultComputerModernTextFont;
}): TexTextFontProfile {
  return {
    ...params,
    metricProvider: computerModernTexMetricProvider,
    resolveTextFont: (state, atPt, metricProvider = computerModernTexMetricProvider) => ({
      ...metricProvider.resolveFont({
        fontId: params.resolveTextFontId(state, atPt),
        atPt: state.sizePt ?? atPt,
      }),
      ...(state.color ? { color: state.color } : {}),
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

export function luaLatexDefaultFontIdForState(
  state: SimpleTexFontState,
  atPt = texLength(10)
): DefaultComputerModernTextFont {
  if (state.shape === "small-caps" && state.series === "bold") {
    if (state.family === "typewriter") {
      return "lmmonolt10-bold";
    }
    if (state.family === "sans") {
      return "lmsans10-bold";
    }
    if (atPt <= 5) {
      return "lmroman5-bold";
    }
    if (atPt <= 7) {
      return "lmroman7-bold";
    }
    return "lmroman10-bold";
  }
  if (state.shape === "small-caps") {
    return state.family === "typewriter" ? "lmmonocaps10-regular" : "lmromancaps10-regular";
  }
  if (state.family === "typewriter") {
    if (state.series === "bold" && (state.shape === "italic" || state.shape === "slanted")) {
      return "lmmonolt10-boldoblique";
    }
    if (state.series === "bold") {
      return "lmmonolt10-bold";
    }
    if (state.shape === "italic") {
      return "lmmono10-italic";
    }
    if (state.shape === "slanted") {
      return "lmmonoslant10-regular";
    }
    return atPt <= 8 ? "lmmono8-regular" : "lmmono10-regular";
  }
  if (state.family === "sans") {
    if (state.series === "bold" && state.shape === "italic") {
      return "lmsans10-boldoblique";
    }
    if (state.series === "bold" && state.shape === "slanted") {
      return "lmsans10-boldoblique";
    }
    if (state.series === "bold") {
      return "lmsans10-bold";
    }
    if (state.shape === "italic") {
      return atPt <= 8 ? "lmsans8-oblique" : "lmsans10-oblique";
    }
    if (state.shape === "slanted") {
      return atPt <= 8 ? "lmsans8-oblique" : "lmsans10-oblique";
    }
    return atPt <= 8 ? "lmsans8-regular" : "lmsans10-regular";
  }
  if (state.series === "bold" && state.shape === "italic") {
    return "lmroman10-bolditalic";
  }
  if (state.series === "bold" && state.shape === "slanted") {
    return "lmromanslant10-bold";
  }
  if (state.series === "bold") {
    if (atPt <= 5) {
      return "lmroman5-bold";
    }
    if (atPt <= 7) {
      return "lmroman7-bold";
    }
    return "lmroman10-bold";
  }
  if (state.shape === "italic") {
    if (atPt <= 7) {
      return "lmroman7-italic";
    }
    return "lmroman10-italic";
  }
  if (state.shape === "slanted") {
    return atPt <= 8 ? "lmromanslant8-regular" : "lmromanslant10-regular";
  }
  if (atPt <= 5) {
    return "lmroman5-regular";
  }
  if (atPt <= 7) {
    return "lmroman7-regular";
  }
  return "lmroman10-regular";
}
