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
      const key = `${params.delimiter}:${params.contentStart}:${params.content}`;
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
        style: "text",
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
    },
  };
}
