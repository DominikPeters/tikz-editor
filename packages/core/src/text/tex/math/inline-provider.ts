import type {
  TexMathDisplayAlignment,
  TexMathBox,
  TexMathBoxProvider,
} from "../layout-inline-items.js";
import { roundTexPt } from "../fonts/units.js";
import type { TexMathFontProfile } from "./font-profile.js";
import {
  layoutTexMathList,
  resolveDefaultTexMathFontProfileForList,
  setTexMathHListWidth,
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

const TEX_DISPLAY_ALIGNMENT_SINGLE_ROW_TRAILING_WIDTH_PT = 10;
const TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT = 10;

export interface TexDerivedInlineMathBoxProviderOptions {
  readonly fontProfile?: TexMathFontProfile;
  readonly baseAtPt?: number;
}

export function createTexDerivedInlineMathBoxProvider(
  options: TexDerivedInlineMathBoxProviderOptions = {}
): TexMathBoxProvider {
  const configuredFontProfile = options.fontProfile;
  const baseAtPt = options.baseAtPt ?? 10;
  const cache = new Map<string, TexMathBox | null>();
  return {
    getInlineMathBox: (params) => {
      return getMathBox(params, "text", cache, configuredFontProfile, baseAtPt);
    },
    getDisplayMathBox: (params) => {
      return getMathBox(params, "display", cache, configuredFontProfile, baseAtPt);
    },
    getDisplayMathAlignment: (params) => {
      return getDisplayMathAlignment(params, configuredFontProfile, baseAtPt);
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
    readonly targetWidth?: number;
  },
  style: "text" | "display",
  cache: Map<string, TexMathBox | null>,
  configuredFontProfile: TexMathFontProfile | undefined,
  baseAtPt: number
): TexMathBox | null {
  const key = `${style}:${params.delimiter}:${params.contentStart}:${params.targetWidth ?? "natural"}:${params.content}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = parseMathBoxContent(params);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    cache.set(key, null);
    return null;
  }
  const fontProfile = configuredFontProfile ?? resolveDefaultTexMathFontProfileForList(parsed.list);
  const laidOut = layoutTexMathList(parsed.list, {
    style,
    fontProfile,
    baseAtPt,
  });
  if (!laidOut.supported) {
    cache.set(key, null);
    return null;
  }
  const hlist = style === "display" &&
    params.targetWidth !== undefined &&
    laidOut.hlist.width > params.targetWidth
    ? setTexMathHListWidth(laidOut.hlist, params.targetWidth)
    : laidOut.hlist;
  const box = {
    source: params.source,
    content: params.content,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    width: hlist.width,
    height: hlist.height,
    depth: hlist.depth,
    svgBody: renderTexMathHListSvgBody(hlist, { fontProfile }),
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
  configuredFontProfile: TexMathFontProfile | undefined,
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
  const fontProfile = configuredFontProfile ?? resolveDefaultTexMathFontProfileForList(parsed.list);
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
  const pairCount = displayAlignmentPairCount(alignedRows);
  const dimensions = displayAlignmentDimensions({
    measuredWidth: laidOut.hlist.width,
    pairCount,
    rowCount: alignedRows.length,
    targetWidth: params.targetWidth,
  });
  return {
    source: params.source,
    content: params.content,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    delimiter: "align-star",
    width: dimensions.rowWidth,
    rows: alignedRows.map((row, rowIndex) => {
      const rowHList: TexMathHList = {
        kind: "math-hlist",
        style: laidOut.hlist.style,
        width: dimensions.rowWidth,
        height: row.height,
        depth: row.depth,
        sourceSpan: row.sourceSpan,
        items: displayAlignmentRowItems(row.items, dimensions),
      };
      return {
        rowIndex,
        x: 0,
        source: params.source,
        content: params.content,
        sourceStart: row.sourceSpan.start,
        sourceEnd: row.sourceSpan.end,
        width: dimensions.rowWidth,
        height: row.height,
        depth: row.depth,
        svgBody: renderTexMathHListSvgBody(rowHList, { fontProfile }),
      };
    }),
  };
}

interface TexDisplayAlignmentDimensions {
  readonly eqnShift: number;
  readonly alignSep: number;
  readonly rowWidth: number;
}

function displayAlignmentDimensions(params: {
  readonly measuredWidth: number;
  readonly pairCount: number;
  readonly rowCount: number;
  readonly targetWidth: number;
}): TexDisplayAlignmentDimensions {
  const alignSepCount = Math.max(0, params.pairCount - 1);
  const fixedPairGapWidth = alignSepCount * TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT;
  const trailingWidth = params.rowCount === 1
    ? TEX_DISPLAY_ALIGNMENT_SINGLE_ROW_TRAILING_WIDTH_PT
    : 0;
  const totalFieldWidth = roundTexPt(Math.max(
    0,
    params.measuredWidth - fixedPairGapWidth - trailingWidth
  ));
  const flexible = roundTexPt((params.targetWidth - totalFieldWidth) / (params.pairCount + 1));
  if (flexible >= TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT) {
    return {
      eqnShift: flexible,
      alignSep: flexible,
      rowWidth: roundTexPt(totalFieldWidth + params.pairCount * flexible),
    };
  }
  const alignSep = TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT;
  const eqnShift = Math.max(
    0,
    roundTexPt((params.targetWidth - totalFieldWidth - alignSepCount * alignSep) / 2)
  );
  return {
    eqnShift,
    alignSep,
    rowWidth: roundTexPt(eqnShift + totalFieldWidth + alignSepCount * alignSep),
  };
}

function displayAlignmentPairCount(
  rows: readonly TexMathChildHListLayoutItem[]
): number {
  const columnCount = Math.max(
    0,
    ...rows.map((row) => row.items.filter((item) =>
      item.kind === "hlist" && item.role === "aligned-cell"
    ).length)
  );
  return Math.max(1, Math.ceil(columnCount / 2));
}

function displayAlignmentRowItems(
  items: readonly TexMathHListItem[],
  dimensions: TexDisplayAlignmentDimensions
): readonly TexMathHListItem[] {
  let cellIndex = 0;
  return items.map((item) => {
    if (item.kind === "hlist" && item.role === "aligned-cell") {
      const pairIndex = Math.floor(cellIndex / 2);
      cellIndex += 1;
      return {
        ...item,
        x: roundTexPt(
          item.x +
          dimensions.eqnShift +
          pairIndex * (dimensions.alignSep - TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT)
        ),
      };
    }
    return {
      ...item,
      x: roundTexPt(item.x + dimensions.eqnShift),
    };
  });
}
