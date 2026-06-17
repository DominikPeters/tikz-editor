import type {
  TexMathDisplayAlignment,
  TexMathBox,
  TexMathBreakpoint,
  TexMathConstructRange,
  TexMathBoxProvider,
  TexMathDisplayLabel,
} from "../layout-inline-items.js";
import { roundTexPt } from "../fonts/units.js";
import type { TexMathFontProfile } from "./font-profile.js";
import type { TexMathAlignedNucleus, TexMathAlignedRowLabel, TexMathAtom, TexMathList } from "./ir.js";
import {
  layoutTexMathList,
  resolveDefaultTexMathFontProfileForList,
  setTexMathHListWidth,
  type TexMathChildHListLayoutItem,
  type TexMathGlueLayoutItem,
  type TexMathHList,
  type TexMathHListItem,
} from "./layout.js";
import {
  parseTexMath,
  parseTexMathAlignedBody,
  parseTexMathDisplayBody,
} from "./parser.js";
import {
  renderTexMathHListSvgBody,
} from "./render-svg.js";
import {
  normalizeTexMathAtomClasses,
} from "./spacing.js";

const TEX_DISPLAY_ALIGNMENT_SINGLE_ROW_TRAILING_WIDTH_PT = 10;
const TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT = 10;
const TEX_DISPLAY_ALIGNMENT_MIN_TAG_SEP_PT = 5;
const TEX_DISPLAY_ALIGNMENT_COLLIDING_TAG_SHIFT_PT = 12;
const TEX_DISPLAY_ALIGNMENT_STANDARD_ROW_DEPTH_PT = 3.600037;
const TEX_DISPLAY_ALIGNMENT_SHIFTED_TAG_STRUT_HEIGHT_PT = 8.4;
const TEX_DISPLAY_ALIGNMENT_SHIFTED_TAG_LINE_SKIP_PT = 1;
const TEX_MULTLINE_GAP_PT = 10;

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
    readonly displayLabel?: TexMathDisplayLabel;
  },
  style: "text" | "display",
  cache: Map<string, TexMathBox | null>,
  configuredFontProfile: TexMathFontProfile | undefined,
  baseAtPt: number
): TexMathBox | null {
  const key = `${style}:${params.delimiter}:${params.contentStart}:${params.targetWidth ?? "natural"}:${params.displayLabel?.text ?? ""}:${params.content}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const parsed = parseMathBoxContent(params, style);
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
  const measuredHList = style === "display" &&
    params.targetWidth !== undefined &&
    laidOut.hlist.width > params.targetWidth
    ? setTexMathHListWidth(laidOut.hlist, params.targetWidth)
    : laidOut.hlist;
  const displayLabel = style === "display"
    ? displayLabelForMathList(parsed.list) ?? (displayTagSuppressedForMathList(parsed.list) ? null : params.displayLabel ?? null)
    : null;
  const hlist = displayLabel
    ? addDisplayMathTag(measuredHList, displayLabel, params.targetWidth ?? measuredHList.width, fontProfile, baseAtPt)
    : measuredHList;
  const box = {
    source: params.source,
    content: params.content,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    width: hlist.width,
    height: hlist.height,
    depth: hlist.depth,
    ...mathHListFlex(hlist.items, 0, hlist.width),
    caretStops: buildInlineMathCaretStops(hlist, params),
    constructRanges: buildInlineMathConstructRanges(hlist),
    breakpoints: buildInlineMathBreakpoints(parsed.list, hlist),
    svgBody: renderTexMathHListSvgBody(hlist, { fontProfile }),
    hlist,
    fontProfile,
  } satisfies TexMathBox;
  cache.set(key, box);
  return box;
}

function displayLabelForMathList(list: TexMathList): TexMathAlignedRowLabel | null {
  if (list.displayLabels?.length) {
    return list.displayLabels[0] ?? null;
  }
  if (list.items.length !== 1) {
    return null;
  }
  const item = list.items[0];
  if (item?.kind !== "atom" || item.nucleus.kind !== "list") {
    return null;
  }
  return displayLabelForMathList(item.nucleus.list);
}

function displayTagSuppressedForMathList(list: TexMathList): boolean {
  if (list.suppressDisplayTag) {
    return true;
  }
  if (list.items.length !== 1) {
    return false;
  }
  const item = list.items[0];
  return item?.kind === "atom" &&
    item.nucleus.kind === "list" &&
    displayTagSuppressedForMathList(item.nucleus.list);
}

function addDisplayMathTag(
  hlist: TexMathHList,
  label: TexMathAlignedRowLabel,
  targetWidth: number,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): TexMathHList {
  const tag = layoutDisplayAlignmentTag(label, hlist.sourceSpan.start, fontProfile, baseAtPt);
  if (!tag) {
    return hlist;
  }
  const width = roundTexPt(Math.max(
    targetWidth,
    hlist.width + tag.width + 2 * TEX_DISPLAY_ALIGNMENT_MIN_TAG_SEP_PT
  ));
  const mathX = roundTexPt(Math.max(0, (width - hlist.width) / 2));
  const tagX = roundTexPt(Math.max(0, width - tag.width));
  const mathItems = offsetMathHListItems(hlist.items, mathX);
  const mathRight = mathItemsRightEdge(mathItems);
  const tagCollides = mathRight + TEX_DISPLAY_ALIGNMENT_MIN_TAG_SEP_PT > tagX;
  const tagRenderShiftY = tagCollides
    ? displayAlignmentShiftedTagRenderShift(hlist.depth)
    : 0;
  const tagMetricShiftY = tagCollides
    ? displayAlignmentShiftedTagMetricShift(hlist.depth, hlist.depth)
    : 0;
  return {
    ...hlist,
    width,
    height: Math.max(hlist.height, tag.height),
    depth: Math.max(hlist.depth + tagMetricShiftY, tagMetricShiftY + tag.depth),
    items: [
      ...mathItems,
      ...offsetMathHListItems(tag.items, tagX, tagRenderShiftY),
    ],
  };
}

function mathHListFlex(
  items: readonly TexMathHListItem[],
  xStart: number,
  xEnd: number
): { readonly stretch?: number; readonly shrink?: number } {
  let stretch = 0;
  let shrink = 0;
  collectMathHListFlex(items, 0, xStart, xEnd, (item) => {
    stretch += item.stretch;
    shrink += item.shrink;
  });
  return {
    ...(stretch > 0 ? { stretch: roundTexPt(stretch) } : {}),
    ...(shrink > 0 ? { shrink: roundTexPt(shrink) } : {}),
  };
}

function collectMathHListFlex(
  items: readonly TexMathHListItem[],
  originX: number,
  xStart: number,
  xEnd: number,
  push: (item: TexMathGlueLayoutItem) => void
): void {
  for (const item of items) {
    const itemX = originX + item.x;
    if (item.kind === "glue") {
      if (itemX >= xStart && itemX < xEnd) {
        push(item);
      }
      continue;
    }
    if (item.kind === "hlist") {
      collectMathHListFlex(item.items, itemX, xStart, xEnd, push);
    }
  }
}

function mathHListFlexBeforeX(
  items: readonly TexMathHListItem[],
  x: number
): { readonly stretchBefore?: number; readonly shrinkBefore?: number } {
  const flex = mathHListFlex(items, 0, x);
  return {
    ...(flex.stretch ? { stretchBefore: flex.stretch } : {}),
    ...(flex.shrink ? { shrinkBefore: flex.shrink } : {}),
  };
}

interface MathItemExtent {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly xStart: number;
  readonly xEnd: number;
  readonly isConstructMarker: boolean;
}

function buildInlineMathConstructRanges(hlist: TexMathHList): readonly TexMathConstructRange[] {
  const extents = collectMathItemExtents(hlist.items, 0);
  const constructSpans = extents.filter((extent) => extent.isConstructMarker);
  return constructSpans.map((construct) => {
    let xStart = construct.xStart;
    let xEnd = construct.xEnd;
    for (const extent of extents) {
      if (
        extent.sourceStart >= construct.sourceStart &&
        extent.sourceEnd <= construct.sourceEnd
      ) {
        xStart = Math.min(xStart, extent.xStart);
        xEnd = Math.max(xEnd, extent.xEnd);
      }
    }
    return {
      sourceStart: construct.sourceStart,
      sourceEnd: construct.sourceEnd,
      xStart: roundTexPt(Math.max(0, Math.min(hlist.width, xStart))),
      xEnd: roundTexPt(Math.max(0, Math.min(hlist.width, xEnd))),
    };
  }).filter((range, index, ranges) =>
    range.sourceEnd > range.sourceStart &&
    range.xEnd > range.xStart &&
    ranges.findIndex((candidate) =>
      candidate.sourceStart === range.sourceStart &&
      candidate.sourceEnd === range.sourceEnd &&
      candidate.xStart === range.xStart &&
      candidate.xEnd === range.xEnd
    ) === index
  );
}

function buildInlineMathBreakpoints(
  list: TexMathList,
  hlist: TexMathHList
): readonly TexMathBreakpoint[] {
  const normalized = normalizeTexMathAtomClasses(list);
  const atomItems = normalized.items.filter((item): item is TexMathAtom => item.kind === "atom");
  if (atomItems.length < 2) {
    return [];
  }

  const extents = collectMathItemExtents(hlist.items, 0);
  return atomItems.flatMap((atom, index) => {
    if (index >= atomItems.length - 1) {
      return [];
    }
    if (atom.atomClass !== "bin" && atom.atomClass !== "rel") {
      return [];
    }
    const x = mathSourceSpanEndX(atom.sourceSpan.start, atom.sourceSpan.end, extents, hlist.width);
    if (x === null) {
      return [];
    }
    const postBreakGlue = discardableMathGlueAfterSourceOffset(hlist.items, atom.sourceSpan.end, x);
    return [{
      kind: atom.atomClass === "bin" ? "binary" : "relation",
      sourceOffset: atom.sourceSpan.end,
      x,
      penalty: atom.atomClass === "bin" ? 700 : 500,
      ...mathHListFlexBeforeX(hlist.items, x),
      ...(postBreakGlue ? { postBreakGlue } : {}),
    }];
  });
}

function mathSourceSpanEndX(
  sourceStart: number,
  sourceEnd: number,
  extents: readonly MathItemExtent[],
  hlistWidth: number
): number | null {
  let xEnd: number | null = null;
  for (const extent of extents) {
    if (extent.sourceEnd < extent.sourceStart) {
      continue;
    }
    if (extent.sourceStart < sourceStart || extent.sourceEnd > sourceEnd) {
      continue;
    }
    if (extent.sourceStart === sourceEnd && extent.sourceEnd === sourceEnd) {
      continue;
    }
    xEnd = xEnd === null ? extent.xEnd : Math.max(xEnd, extent.xEnd);
  }
  return xEnd === null
    ? null
    : roundTexPt(Math.max(0, Math.min(hlistWidth, xEnd)));
}

function discardableMathGlueAfterSourceOffset(
  items: readonly TexMathHListItem[],
  sourceOffset: number,
  x: number
): { readonly width: number; readonly stretch: number; readonly shrink: number } | null {
  let width = 0;
  let stretch = 0;
  let shrink = 0;
  for (const item of items) {
    if (
      item.kind !== "glue" ||
      item.sourceSpan.start !== sourceOffset ||
      item.sourceSpan.end !== sourceOffset ||
      item.x < x - 1e-6
    ) {
      continue;
    }
    width += item.width;
    stretch += item.stretch;
    shrink += item.shrink;
  }
  const roundedWidth = roundTexPt(width);
  if (roundedWidth <= 0) {
    return null;
  }
  return {
    width: roundedWidth,
    stretch: roundTexPt(stretch),
    shrink: roundTexPt(shrink),
  };
}

function collectMathItemExtents(
  items: readonly TexMathHListItem[],
  originX: number
): readonly MathItemExtent[] {
  const extents: MathItemExtent[] = [];
  for (const item of items) {
    const xStart = roundTexPt(originX + item.x);
    const xEnd = roundTexPt(xStart + Math.max(0, item.width));
    extents.push({
      sourceStart: item.sourceSpan.start,
      sourceEnd: item.sourceSpan.end,
      xStart,
      xEnd,
      isConstructMarker: item.kind === "rule",
    });
    if (item.kind === "hlist") {
      extents.push(...collectMathItemExtents(item.items, xStart));
    }
  }
  return extents;
}

function buildInlineMathCaretStops(
  hlist: TexMathHList,
  params: {
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly contentStart: number;
    readonly contentEnd: number;
  }
): readonly number[] {
  const rawLength = Math.max(0, params.sourceEnd - params.sourceStart);
  const stops = Array.from({ length: rawLength + 1 }, () => Number.NaN);
  const setStop = (rawOffset: number, x: number) => {
    const index = rawOffset - params.sourceStart;
    if (index < 0 || index >= stops.length || !Number.isFinite(x)) {
      return;
    }
    const clamped = roundTexPt(Math.max(0, Math.min(hlist.width, x)));
    stops[index] = Number.isFinite(stops[index])
      ? Math.max(stops[index], clamped)
      : clamped;
  };

  for (let rawOffset = params.sourceStart; rawOffset <= params.contentStart; rawOffset += 1) {
    setStop(rawOffset, 0);
  }
  for (let rawOffset = params.contentEnd; rawOffset <= params.sourceEnd; rawOffset += 1) {
    setStop(rawOffset, hlist.width);
  }

  addMathItemCaretStops(hlist.items, 0, setStop);
  interpolateMissingCaretStops(stops, hlist.width);
  enforceMonotoneCaretStops(stops, hlist.width);
  return stops.map((stop) => roundTexPt(stop));
}

function addMathItemCaretStops(
  items: readonly TexMathHListItem[],
  originX: number,
  setStop: (rawOffset: number, x: number) => void
): void {
  for (const item of items) {
    const x = roundTexPt(originX + item.x);
    if (item.kind === "hlist") {
      addMathItemCaretStops(item.items, x, setStop);
      continue;
    }
    if (item.kind === "rule") {
      continue;
    }
    if (item.kind === "glyph" && mathGlyphCoversConstructSpan(item)) {
      continue;
    }
    addMathSourceSpanCaretStops(item.sourceSpan.start, item.sourceSpan.end, x, item.width, setStop);
  }
}

function mathGlyphCoversConstructSpan(item: Extract<TexMathHListItem, { readonly kind: "glyph" }>): boolean {
  return item.sourceSpan.end - item.sourceSpan.start > Math.max(1, item.text.length);
}

function addMathSourceSpanCaretStops(
  start: number,
  end: number,
  x: number,
  width: number,
  setStop: (rawOffset: number, x: number) => void
): void {
  const spanLength = Math.max(0, end - start);
  if (spanLength === 0) {
    setStop(start, x);
    return;
  }
  for (let rawOffset = start; rawOffset <= end; rawOffset += 1) {
    const t = (rawOffset - start) / spanLength;
    setStop(rawOffset, roundTexPt(x + width * t));
  }
}

function interpolateMissingCaretStops(stops: number[], width: number): void {
  if (stops.length === 0) {
    return;
  }
  if (!Number.isFinite(stops[0])) {
    stops[0] = 0;
  }
  if (!Number.isFinite(stops[stops.length - 1])) {
    stops[stops.length - 1] = width;
  }
  let lastKnown = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (Number.isFinite(stops[index])) {
      const start = stops[lastKnown] ?? 0;
      const end = stops[index] ?? start;
      const gap = index - lastKnown;
      for (let fill = lastKnown + 1; fill < index; fill += 1) {
        const t = (fill - lastKnown) / gap;
        stops[fill] = roundTexPt(start + (end - start) * t);
      }
      lastKnown = index;
    }
  }
}

function enforceMonotoneCaretStops(stops: number[], width: number): void {
  let previous = 0;
  for (let index = 0; index < stops.length; index += 1) {
    const value = Number.isFinite(stops[index]) ? stops[index] : previous;
    previous = roundTexPt(Math.max(previous, Math.min(width, value)));
    stops[index] = previous;
  }
  if (stops.length > 0) {
    stops[stops.length - 1] = roundTexPt(width);
  }
}

function parseMathBoxContent(params: {
  readonly content: string;
  readonly delimiter: string;
  readonly contentStart: number;
}, style: "text" | "display") {
  if (texMathDisplayAlignmentDelimiter(params.delimiter)) {
    return parseTexMathAlignedBody(params.content, {
      sourceOffset: params.contentStart,
      columnSeparation: displayAlignmentColumnSeparation(params.delimiter),
      suppressTerminalEllipsisGlue: style === "display",
    });
  }
  if (style === "display" && texMathSingleDisplayBodyDelimiter(params.delimiter)) {
    return parseTexMathDisplayBody(params.content, {
      sourceOffset: params.contentStart,
      suppressTerminalEllipsisGlue: true,
    });
  }
  return parseTexMath(params.content, {
    sourceOffset: params.contentStart,
    suppressTerminalEllipsisGlue: style === "display",
  });
}

function texMathSingleDisplayBodyDelimiter(delimiter: string): boolean {
  return delimiter === "equation" || delimiter === "equation-star";
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
  if (!texMathDisplayAlignmentDelimiter(params.delimiter)) {
    return null;
  }
  const parsed = parseTexMathAlignedBody(params.content, {
    sourceOffset: params.contentStart,
    columnSeparation: displayAlignmentColumnSeparation(params.delimiter),
    suppressTerminalEllipsisGlue: true,
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
  if (params.delimiter === "multline-star") {
    const rows = alignedRows.map((row, rowIndex) => {
      const rowWidth = mathItemsRightEdge(row.items);
      const rowOffset = multlineRowOffset(rowWidth, rowIndex, alignedRows.length, params.targetWidth, row.multlineShove);
      const rowHList: TexMathHList = {
        kind: "math-hlist",
        style: laidOut.hlist.style,
        width: params.targetWidth,
        height: row.height,
        depth: row.depth,
        sourceSpan: row.sourceSpan,
        items: offsetMathHListItems(row.items, rowOffset),
      };
      return {
        rowIndex,
        x: 0,
        source: params.source,
        content: params.content,
        sourceStart: row.sourceSpan.start,
        sourceEnd: row.sourceSpan.end,
        contentStart: row.sourceSpan.start,
        contentEnd: row.sourceSpan.end,
        width: rowHList.width,
        height: rowHList.height,
        depth: rowHList.depth,
        caretStops: buildInlineMathCaretStops(rowHList, {
          sourceStart: row.sourceSpan.start,
          sourceEnd: row.sourceSpan.end,
          contentStart: row.sourceSpan.start,
          contentEnd: row.sourceSpan.end,
        }),
        constructRanges: buildInlineMathConstructRanges(rowHList),
        breakpoints: buildInlineMathBreakpoints(parsed.list, rowHList),
        svgBody: renderTexMathHListSvgBody(rowHList, { fontProfile }),
        hlist: rowHList,
        fontProfile,
      };
    });
    return {
      source: params.source,
      content: params.content,
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      contentStart: params.contentStart,
      contentEnd: params.contentEnd,
      delimiter: params.delimiter,
      width: params.targetWidth,
      rows,
    };
  }
  if (params.delimiter === "gather-star") {
    const rowOffset = roundTexPt(Math.max(0, (params.targetWidth - laidOut.hlist.width) / 2));
    const rows = alignedRows.map((row, rowIndex) => {
      const rowHList: TexMathHList = {
        kind: "math-hlist",
        style: laidOut.hlist.style,
        width: params.targetWidth,
        height: row.height,
        depth: row.depth,
        sourceSpan: row.sourceSpan,
        items: offsetMathHListItems(row.items, rowOffset),
      };
      return {
        rowIndex,
        x: 0,
        source: params.source,
        content: params.content,
        sourceStart: row.sourceSpan.start,
        sourceEnd: row.sourceSpan.end,
        contentStart: row.sourceSpan.start,
        contentEnd: row.sourceSpan.end,
        width: rowHList.width,
        height: rowHList.height,
        depth: rowHList.depth,
        caretStops: buildInlineMathCaretStops(rowHList, {
          sourceStart: row.sourceSpan.start,
          sourceEnd: row.sourceSpan.end,
          contentStart: row.sourceSpan.start,
          contentEnd: row.sourceSpan.end,
        }),
        constructRanges: buildInlineMathConstructRanges(rowHList),
        breakpoints: buildInlineMathBreakpoints(parsed.list, rowHList),
        svgBody: renderTexMathHListSvgBody(rowHList, { fontProfile }),
        hlist: rowHList,
        fontProfile,
      };
    });
    return {
      source: params.source,
      content: params.content,
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      contentStart: params.contentStart,
      contentEnd: params.contentEnd,
      delimiter: params.delimiter,
      width: params.targetWidth,
      rows,
    };
  }
  const alignedNucleus = alignedNucleusFromList(parsed.list);
  const pairCount = displayAlignmentPairCount(alignedRows);
  const rowTagWidths = displayAlignmentRowTagWidths(alignedNucleus, fontProfile, baseAtPt);
  const dimensions = displayAlignmentDimensions({
    measuredWidth: laidOut.hlist.width,
    pairCount,
    rowCount: alignedRows.length,
    rows: alignedRows,
    rowTagWidths,
    targetWidth: params.targetWidth,
  });
  const hasAlignmentTags = alignedNucleus?.rows.some((row) => (row.labels?.length ?? 0) > 0) ?? false;
  const forcedRowWidth = hasAlignmentTags
    ? alignedRows.length > 1
      ? Math.max(dimensions.rowWidth, dimensions.targetWidth)
      : dimensions.targetWidth
    : null;
  const rows = alignedRows.map((row, rowIndex) => {
    const taggedRow = addDisplayAlignmentTag(
      row,
      alignedNucleus?.rows[rowIndex]?.labels?.[0] ?? null,
      dimensions,
      fontProfile,
      baseAtPt,
      forcedRowWidth,
      alignedRows.length,
      displayAlignmentRowLineDepth(alignedRows, rowIndex)
    );
    const rowHList: TexMathHList = {
      kind: "math-hlist",
      style: laidOut.hlist.style,
      width: taggedRow.width,
      height: taggedRow.height,
      depth: taggedRow.depth,
      sourceSpan: row.sourceSpan,
      items: taggedRow.items,
    };
    return {
      rowIndex,
      x: 0,
      source: params.source,
      content: params.content,
      sourceStart: row.sourceSpan.start,
      sourceEnd: row.sourceSpan.end,
      contentStart: row.sourceSpan.start,
      contentEnd: row.sourceSpan.end,
      width: taggedRow.width,
      height: taggedRow.height,
      depth: taggedRow.depth,
      caretStops: buildInlineMathCaretStops(rowHList, {
        sourceStart: row.sourceSpan.start,
        sourceEnd: row.sourceSpan.end,
        contentStart: row.sourceSpan.start,
        contentEnd: row.sourceSpan.end,
      }),
      constructRanges: buildInlineMathConstructRanges(rowHList),
      breakpoints: buildInlineMathBreakpoints(parsed.list, rowHList),
      svgBody: renderTexMathHListSvgBody(rowHList, { fontProfile }),
      hlist: rowHList,
      fontProfile,
    };
  });
  return {
    source: params.source,
    content: params.content,
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    delimiter: params.delimiter,
    width: Math.max(dimensions.rowWidth, ...rows.map((row) => row.width)),
    rows,
  };
}

function texMathDisplayAlignmentDelimiter(
  delimiter: string
): delimiter is "align-star" | "gather-star" | "multline-star" {
  return delimiter === "align-star" ||
    delimiter === "gather-star" ||
    delimiter === "multline-star";
}

function displayAlignmentColumnSeparation(delimiter: "align-star" | "gather-star" | "multline-star"):
  "align" | "gather" | "multline" {
  if (delimiter === "gather-star") {
    return "gather";
  }
  if (delimiter === "multline-star") {
    return "multline";
  }
  return "align";
}

function multlineRowOffset(
  rowWidth: number,
  rowIndex: number,
  rowCount: number,
  targetWidth: number,
  shove?: "left" | "right"
): number {
  if (shove === "left") {
    return TEX_MULTLINE_GAP_PT;
  }
  if (shove === "right") {
    return roundTexPt(Math.max(0, targetWidth - rowWidth - TEX_MULTLINE_GAP_PT));
  }
  if (rowCount <= 1) {
    return roundTexPt(Math.max(0, (targetWidth - rowWidth) / 2));
  }
  if (rowIndex === 0) {
    return TEX_MULTLINE_GAP_PT;
  }
  if (rowIndex === rowCount - 1) {
    return roundTexPt(Math.max(0, targetWidth - rowWidth - TEX_MULTLINE_GAP_PT));
  }
  return roundTexPt(Math.max(0, (targetWidth - rowWidth) / 2));
}

function alignedNucleusFromList(list: TexMathList): TexMathAlignedNucleus | null {
  const item = list.items[0];
  if (item?.kind !== "atom" || item.nucleus.kind !== "aligned") {
    return null;
  }
  return item.nucleus;
}

function displayAlignmentRowTagWidths(
  alignedNucleus: TexMathAlignedNucleus | null,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): readonly number[] {
  return (alignedNucleus?.rows ?? []).map((row) => {
    const label = row.labels?.[0];
    if (!label) {
      return 0;
    }
    const tag = layoutDisplayAlignmentTag(label, row.sourceSpan.start, fontProfile, baseAtPt);
    return tag ? roundTexPt(tag.width) : 0;
  });
}

function layoutDisplayAlignmentTag(
  label: TexMathAlignedRowLabel,
  rowStart: number,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): TexMathHList | null {
  const tagSource = String.raw`\text{(` + label.text + ")}";
  const parsedTag = parseTexMath(tagSource, {
    sourceOffset: Math.max(rowStart, label.sourceSpan.end - tagSource.length),
  });
  if (parsedTag.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return null;
  }
  const tag = layoutTexMathList(parsedTag.list, {
    style: "text",
    fontProfile,
    baseAtPt,
  });
  return tag.supported ? tag.hlist : null;
}

function addDisplayAlignmentTag(
  row: TexMathChildHListLayoutItem,
  label: TexMathAlignedRowLabel | null,
  dimensions: TexDisplayAlignmentDimensions,
  fontProfile: TexMathFontProfile,
  baseAtPt: number,
  forcedRowWidth: number | null = null,
  rowCount = 1,
  tagLineDepth = row.depth
): Pick<TexMathHList, "width" | "height" | "depth" | "items"> {
  let rowItems = displayAlignmentRowItems(row.items, dimensions);
  const baseWidth = forcedRowWidth ?? dimensions.rowWidth;
  if (!label) {
    return {
      width: baseWidth,
      height: row.height,
      depth: row.depth,
      items: rowItems,
    };
  }
  const tag = layoutDisplayAlignmentTag(label, row.sourceSpan.start, fontProfile, baseAtPt);
  if (!tag) {
    return {
      width: baseWidth,
      height: row.height,
      depth: row.depth,
      items: rowItems,
    };
  }
  if (dimensions.pairCount === 1 && rowCount === 1) {
    const rowFieldWidth = roundTexPt(Math.max(0, row.width - TEX_DISPLAY_ALIGNMENT_SINGLE_ROW_TRAILING_WIDTH_PT));
    const rowRequiresShiftedTag = rowFieldWidth + tag.width + 2 * TEX_DISPLAY_ALIGNMENT_MIN_TAG_SEP_PT > dimensions.targetWidth;
    const tagClearanceCollides = dimensions.eqnShift + rowFieldWidth + 2 * tag.width > dimensions.targetWidth;
    const tagAdjustedEqnShift = !rowRequiresShiftedTag && tagClearanceCollides
      ? roundTexPt(Math.max(0, (dimensions.targetWidth - rowFieldWidth - tag.width) / 2))
      : null;
    if (tagAdjustedEqnShift !== null && tagAdjustedEqnShift < dimensions.eqnShift) {
      rowItems = offsetMathHListItems(rowItems, tagAdjustedEqnShift - dimensions.eqnShift);
    }
  }
  const width = Math.max(baseWidth, dimensions.targetWidth);
  const tagX = Math.max(0, roundTexPt(dimensions.targetWidth - tag.width));
  const rowRight = mathItemsRightEdge(rowItems);
  const tagCollides = rowRight > tagX;
  const tagRenderShiftY = tagCollides
    ? displayAlignmentShiftedTagRenderShift(tagLineDepth)
    : 0;
  const tagMetricShiftY = tagCollides
    ? displayAlignmentShiftedTagMetricShift(row.depth, tagLineDepth)
    : 0;
  return {
    width,
    height: Math.max(row.height, tag.height),
    depth: Math.max(row.depth + tagMetricShiftY, tagMetricShiftY + tag.depth),
    items: [
      ...rowItems,
      ...offsetMathHListItems(tag.items, tagX, tagRenderShiftY),
    ],
  };
}

function displayAlignmentRowLineDepth(
  rows: readonly TexMathChildHListLayoutItem[],
  rowIndex: number
): number {
  const rowDepth = rows[rowIndex]?.depth ?? 0;
  if (rowIndex !== 0) {
    return rowDepth;
  }
  // amsmath's measuring pass leaves \lineht@ at the maximum measured row depth.
  // The first real row inherits that value until its fields exceed it.
  return Math.max(rowDepth, ...rows.map((row) => row.depth));
}

function displayAlignmentShiftedTagRenderShift(lineDepth: number): number {
  // amsmath's right-side \place@tag uses a vtop whose first null box depth is
  // \lineht@. The following tag box gets normal
  // baseline spacing when possible and falls back to \lineskip for deep rows.
  const depthPlusTagStrut = lineDepth + TEX_DISPLAY_ALIGNMENT_SHIFTED_TAG_STRUT_HEIGHT_PT;
  return roundTexPt(depthPlusTagStrut <= TEX_DISPLAY_ALIGNMENT_COLLIDING_TAG_SHIFT_PT + 0.001
    ? TEX_DISPLAY_ALIGNMENT_COLLIDING_TAG_SHIFT_PT
    : depthPlusTagStrut + TEX_DISPLAY_ALIGNMENT_SHIFTED_TAG_LINE_SKIP_PT);
}

function displayAlignmentShiftedTagMetricShift(rowDepth: number, lineDepth: number): number {
  const vtopDepth = displayAlignmentShiftedTagRenderShift(lineDepth) +
    TEX_DISPLAY_ALIGNMENT_STANDARD_ROW_DEPTH_PT;
  return roundTexPt(Math.max(0, vtopDepth - rowDepth));
}

interface TexDisplayAlignmentDimensions {
  readonly eqnShift: number;
  readonly alignSep: number;
  readonly pairCount: number;
  readonly rowWidth: number;
  readonly targetWidth: number;
}

function displayAlignmentDimensions(params: {
  readonly measuredWidth: number;
  readonly pairCount: number;
  readonly rowCount: number;
  readonly rows: readonly TexMathChildHListLayoutItem[];
  readonly rowTagWidths: readonly number[];
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
  let eqnShift: number;
  let alignSep: number;
  if (flexible >= TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT) {
    eqnShift = flexible;
    alignSep = flexible;
  } else {
    alignSep = TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT;
    eqnShift = Math.max(
      0,
      roundTexPt((params.targetWidth - totalFieldWidth - alignSepCount * alignSep) / 2)
    );
  }
  if (params.pairCount > 1 && params.rowTagWidths.some((width) => width > 0)) {
    ({ eqnShift, alignSep } = applyAmsmathCenteredRightTagClearance({
      eqnShift,
      alignSep,
      pairCount: params.pairCount,
      rows: params.rows,
      rowTagWidths: params.rowTagWidths,
      targetWidth: params.targetWidth,
    }));
  }
  return {
    eqnShift,
    alignSep,
    pairCount: params.pairCount,
    rowWidth: roundTexPt(eqnShift + totalFieldWidth + alignSepCount * alignSep),
    targetWidth: params.targetWidth,
  };
}

function applyAmsmathCenteredRightTagClearance(params: {
  readonly eqnShift: number;
  readonly alignSep: number;
  readonly pairCount: number;
  readonly rows: readonly TexMathChildHListLayoutItem[];
  readonly rowTagWidths: readonly number[];
  readonly targetWidth: number;
}): { readonly eqnShift: number; readonly alignSep: number } {
  let eqnShift = params.eqnShift;
  let alignSep = params.alignSep;
  const maxColumnWidths = displayAlignmentMaxColumnWidths(params.rows);
  const alignSepCount = Math.max(0, params.pairCount - 1);
  for (let rowIndex = params.rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const tagWidth = params.rowTagWidths[rowIndex] ?? 0;
    if (tagWidth <= 0) {
      continue;
    }
    const fieldWidths = displayAlignmentFieldWidths(params.rows[rowIndex]?.items ?? []);
    const rowPairIndex = Math.floor(Math.max(0, fieldWidths.length - 1) / 2);
    const rowAlignSepCount = Math.min(alignSepCount, rowPairIndex);
    const rowFlexibleSlotCount = params.pairCount + 1 - alignSepCount + rowAlignSepCount;
    const rowWidthBeforeTag = amsmathRightTagRowWidth(fieldWidths, maxColumnWidths);
    const equationAndTagWidth = roundTexPt(rowWidthBeforeTag + tagWidth);
    const minimumClearanceWidth = roundTexPt(
      equationAndTagWidth +
      rowAlignSepCount * TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT +
      2 * TEX_DISPLAY_ALIGNMENT_MIN_TAG_SEP_PT
    );
    if (minimumClearanceWidth > params.targetWidth) {
      continue;
    }
    const currentClearanceWidth = roundTexPt(
      eqnShift +
      equationAndTagWidth +
      rowAlignSepCount * alignSep +
      tagWidth
    );
    if (currentClearanceWidth <= params.targetWidth) {
      continue;
    }
    const candidate = roundTexPt(
      (params.targetWidth - equationAndTagWidth) / rowFlexibleSlotCount
    );
    if (candidate < TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT) {
      alignSep = TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT;
      eqnShift = roundTexPt(Math.max(
        0,
        (params.targetWidth - equationAndTagWidth - rowAlignSepCount * alignSep) / 2
      ));
      continue;
    }
    if (candidate < eqnShift) {
      eqnShift = Math.max(0, candidate);
    }
    if (candidate < alignSep) {
      alignSep = candidate;
    }
  }
  return { eqnShift, alignSep };
}

function displayAlignmentMaxColumnWidths(
  rows: readonly TexMathChildHListLayoutItem[]
): readonly number[] {
  const maxWidths: number[] = [];
  for (const row of rows) {
    const widths = displayAlignmentFieldWidths(row.items);
    for (let index = 0; index < widths.length; index += 1) {
      maxWidths[index] = roundTexPt(Math.max(maxWidths[index] ?? 0, widths[index] ?? 0));
    }
  }
  return maxWidths;
}

function displayAlignmentFieldWidths(
  items: readonly TexMathHListItem[]
): readonly number[] {
  return items
    .filter((item): item is TexMathChildHListLayoutItem =>
      item.kind === "hlist" && item.role === "aligned-cell"
    )
    .map((item) => item.width);
}

function amsmathRightTagRowWidth(
  fieldWidths: readonly number[],
  maxColumnWidths: readonly number[]
): number {
  let carry = 0;
  let width = 0;
  for (let index = 0; index < fieldWidths.length; index += 1) {
    const fieldWidth = fieldWidths[index] ?? 0;
    const maxColumnWidth = maxColumnWidths[index] ?? 0;
    if (fieldWidth > 0) {
      width += carry;
      if (index % 2 === 0) {
        width += maxColumnWidth;
        carry = 0;
      } else {
        width += fieldWidth;
        carry = maxColumnWidth - fieldWidth;
      }
    } else {
      carry += maxColumnWidth;
    }
  }
  return roundTexPt(width);
}

function offsetMathHListItems(
  items: readonly TexMathHListItem[],
  offsetX: number,
  offsetY = 0
): readonly TexMathHListItem[] {
  return items.map((item) => {
    const x = roundTexPt(item.x + offsetX);
    if (item.kind === "glyph" || item.kind === "rule") {
      return {
        ...item,
        x,
        y: roundTexPt(item.y + offsetY),
      };
    }
    if (item.kind === "hlist") {
      return {
        ...item,
        x,
        y: roundTexPt(item.y + offsetY),
        items: offsetMathHListItems(item.items, 0, 0),
      };
    }
    return {
      ...item,
      x,
    };
  });
}

function mathItemsRightEdge(items: readonly TexMathHListItem[]): number {
  let right = 0;
  for (const item of items) {
    right = Math.max(right, item.x + item.width);
  }
  return roundTexPt(right);
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
