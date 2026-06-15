import type {
  TexMathDisplayAlignment,
  TexMathBox,
  TexMathBoxProvider,
} from "../layout-inline-items.js";
import { roundTexPt } from "../fonts/units.js";
import {
  defaultTexMathFontProfile,
  type TexMathFontProfile,
} from "./font-profile.js";
import {
  layoutTexMathList,
  type TexMathChildHListLayoutItem,
  type TexMathHList,
  type TexMathHListItem,
} from "./layout.js";
import {
  parseTexMath,
  parseTexMathAlignedBody,
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
    getDisplayMathAlignment: (params) => {
      return getDisplayMathAlignment(params, fontProfile, baseAtPt);
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
  const parsed = parseMathBoxContent(params);
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

function parseMathBoxContent(params: {
  readonly content: string;
  readonly delimiter: string;
  readonly contentStart: number;
}) {
  if (params.delimiter === "align-star") {
    return parseTexMathAlignedBody(params.content, {
      sourceOffset: params.contentStart,
    });
  }
  return parseTexMath(params.content, {
    sourceOffset: params.contentStart,
  });
}

function getDisplayMathAlignment(
  params: {
    readonly source: string;
    readonly content: string;
    readonly delimiter: string;
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly contentStart: number;
    readonly contentEnd: number;
    readonly targetWidth: number;
  },
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): TexMathDisplayAlignment | null {
  if (params.delimiter !== "align-star") {
    return null;
  }
  const parsed = parseTexMathAlignedBody(params.content, {
    sourceOffset: params.contentStart,
  });
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return null;
  }
  const laidOut = layoutTexMathList(parsed.list, {
    style: "display",
    fontProfile,
    baseAtPt,
  });
  if (!laidOut.supported) {
    return null;
  }
  const alignedRows = laidOut.hlist.items.filter((item): item is TexMathChildHListLayoutItem =>
    item.kind === "hlist" && item.role === "aligned-row"
  );
  if (alignedRows.length === 0) {
    return null;
  }
  const leftOffset = Math.max(0, roundTexPt((params.targetWidth - laidOut.hlist.width) / 2));
  const rowWidth = roundTexPt(leftOffset + laidOut.hlist.width);
  return {
    source: params.source,
    content: params.content,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    delimiter: "align-star",
    width: rowWidth,
    rows: alignedRows.map((row, rowIndex) => {
      const rowHList: TexMathHList = {
        kind: "math-hlist",
        style: laidOut.hlist.style,
        width: rowWidth,
        height: row.height,
        depth: row.depth,
        sourceSpan: row.sourceSpan,
        items: shiftTexMathHListItems(row.items, leftOffset),
      };
      return {
        rowIndex,
        x: 0,
        source: params.source,
        content: params.content,
        sourceStart: row.sourceSpan.start,
        sourceEnd: row.sourceSpan.end,
        width: rowWidth,
        height: row.height,
        depth: row.depth,
        svgBody: renderTexMathHListSvgBody(rowHList, { fontProfile }),
      };
    }),
  };
}

function shiftTexMathHListItems(
  items: readonly TexMathHListItem[],
  dx: number
): readonly TexMathHListItem[] {
  if (dx === 0) {
    return items;
  }
  return items.map((item) => {
    if (item.kind === "hlist") {
      return {
        ...item,
        x: roundTexPt(item.x + dx),
        items: shiftTexMathHListItems(item.items, dx),
      };
    }
    return {
      ...item,
      x: roundTexPt(item.x + dx),
    };
  });
}
