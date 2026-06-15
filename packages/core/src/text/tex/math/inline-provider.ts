import type {
  TexMathBox,
  TexMathBoxProvider,
} from "../layout-inline-items.js";
import {
  defaultTexMathFontProfile,
  type TexMathFontProfile,
} from "./font-profile.js";
import {
  layoutTexMathList,
} from "./layout.js";
import {
  parseTexMath,
} from "./parser.js";
import {
  renderTexMathHListSvgBody,
} from "./render-svg.js";

export interface TexDerivedInlineMathBoxProviderOptions {
  readonly fontProfile?: TexMathFontProfile;
  readonly baseAtPt?: number;
}

export function createTexDerivedInlineMathBoxProvider(
  options: TexDerivedInlineMathBoxProviderOptions = {}
): TexMathBoxProvider {
  const fontProfile = options.fontProfile ?? defaultTexMathFontProfile;
  const baseAtPt = options.baseAtPt ?? 10;
  const cache = new Map<string, TexMathBox | null>();
  return {
    getInlineMathBox: (params) => {
      return getMathBox(params, "text", cache, fontProfile, baseAtPt);
    },
    getDisplayMathBox: (params) => {
      return getMathBox(params, "display", cache, fontProfile, baseAtPt);
    },
  };
}

function getMathBox(
  params: {
    readonly source: string;
    readonly content: string;
    readonly delimiter: string;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly contentStart: number;
    readonly contentEnd: number;
  },
  style: "text" | "display",
  cache: Map<string, TexMathBox | null>,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): TexMathBox | null {
  const key = `${style}:${params.delimiter}:${params.contentStart}:${params.content}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = parseTexMath(params.content, {
    sourceOffset: params.contentStart,
  });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    cache.set(key, null);
    return null;
  }
  const laidOut = layoutTexMathList(parsed.list, {
    style,
    fontProfile,
    baseAtPt,
  });
  if (!laidOut.supported) {
    cache.set(key, null);
    return null;
  }
  const box = {
    source: params.source,
    content: params.content,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    width: laidOut.hlist.width,
    height: laidOut.hlist.height,
    depth: laidOut.hlist.depth,
    svgBody: renderTexMathHListSvgBody(laidOut.hlist, { fontProfile }),
  } satisfies TexMathBox;
  cache.set(key, box);
  return box;
}
