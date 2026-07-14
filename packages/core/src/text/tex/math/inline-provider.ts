import type {
  TexMathDisplayAlignment,
  TexMathDisplayAlignmentIntertext,
  TexMathBox,
  TexMathBreakpoint,
  TexMathCaretDiagnostic,
  TexMathCaretEntry,
  TexMathCaretMap,
  TexMathConstructRange,
  TexMathBoxProvider,
  TexMathDisplayLabel,
} from "../layout-inline-items.js";
import { roundTexPt } from "../fonts/units.js";
import {
  texHBoxX,
  texHBoxY,
  type TexHBoxX,
  type TexHBoxY,
} from "../coordinates.js";
import type { TexMathFontProfile } from "./font-profile.js";
import type {
  TexMathAlignedNucleus,
  TexMathAlignedRowLabel,
  TexMathAtom,
  TexMathList,
  TexMathPenalty,
  TexMathSourceSpan,
} from "./ir.js";
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
  parseTexMathDisplayBody,
} from "./parser.js";
import {
  renderTexMathHListSvgBody,
  texMathGlyphVisualBounds,
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
const TEX_DISPLAY_ALIGNMENT_OVERFULL_BODY_TOLERANCE_PT = 1;
const TEX_DISPLAY_ALIGNMENT_TAGGED_ROW_OVERFULL_TOLERANCE_PT = 10;
const TEX_MULTLINE_GAP_PT = 10;
const TEX_MULTLINE_TAG_GAP_PT = 10;

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
  const caretMap = buildInlineMathCaretMap(hlist, params, fontProfile);
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
    ...mathHListFlex(hlist.items, texHBoxX(0), texHBoxX(hlist.width)),
    caretMap,
    caretStops: projectInlineMathCaretStops(caretMap, hlist.width),
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
  xStart: TexHBoxX,
  xEnd: TexHBoxX
): { readonly stretch?: number; readonly shrink?: number } {
  let stretch = 0;
  let shrink = 0;
  for (const item of items) {
    if (item.kind !== "glue" || item.x < xStart || item.x >= xEnd) {
      continue;
    }
    stretch += item.stretch;
    shrink += item.shrink;
  }
  return {
    ...(stretch > 0 ? { stretch: roundTexPt(stretch) } : {}),
    ...(shrink > 0 ? { shrink: roundTexPt(shrink) } : {}),
  };
}

function mathHListFlexBeforeX(
  items: readonly TexMathHListItem[],
  x: TexHBoxX
): { readonly stretchBefore?: number; readonly shrinkBefore?: number } {
  const flex = mathHListFlex(items, texHBoxX(0), x);
  return {
    ...(flex.stretch ? { stretchBefore: flex.stretch } : {}),
    ...(flex.shrink ? { shrinkBefore: flex.shrink } : {}),
  };
}

interface MathItemExtent {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly xStart: TexHBoxX;
  readonly xEnd: TexHBoxX;
  readonly isConstructMarker: boolean;
}

function buildInlineMathConstructRanges(hlist: TexMathHList): readonly TexMathConstructRange[] {
  const extents = collectMathItemExtents(hlist.items, texHBoxX(0));
  const constructSpans = extents.filter((extent) => extent.isConstructMarker);
  return constructSpans.map((construct) => {
    let xStart = construct.xStart;
    let xEnd = construct.xEnd;
    for (const extent of extents) {
      if (
        extent.sourceStart >= construct.sourceStart &&
        extent.sourceEnd <= construct.sourceEnd
      ) {
        xStart = texHBoxX(Math.min(xStart, extent.xStart));
        xEnd = texHBoxX(Math.max(xEnd, extent.xEnd));
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
  const penaltyItems = normalized.items.filter((item): item is TexMathPenalty => item.kind === "penalty");
  if (atomItems.length < 2 && penaltyItems.length === 0) {
    return [];
  }

  const extents = collectMathItemExtents(hlist.items, texHBoxX(0));
  const breakpoints: TexMathBreakpoint[] = [];
  for (let index = 0; index < atomItems.length - 1; index += 1) {
    const atom = atomItems[index];
    if (!atom || (atom.atomClass !== "bin" && atom.atomClass !== "rel")) {
      continue;
    }
    const x = mathSourceSpanEndX(atom.sourceSpan.start, atom.sourceSpan.end, extents, hlist.width);
    if (x === null) {
      continue;
    }
    const postBreakGlue = discardableMathGlueAfterSourceOffset(hlist.items, atom.sourceSpan.end, x);
    breakpoints.push({
      kind: atom.atomClass === "bin" ? "binary" : "relation",
      sourceOffset: atom.sourceSpan.end,
      x,
      penalty: atom.atomClass === "bin" ? 700 : 500,
      ...mathHListFlexBeforeX(hlist.items, x),
      ...(postBreakGlue ? { postBreakGlue } : {}),
    });
  }
  for (const penalty of penaltyItems) {
    const x = mathSourceOffsetX(penalty.sourceSpan.start, extents, hlist.width);
    breakpoints.push({
      kind: "penalty",
      sourceOffset: penalty.sourceSpan.end,
      x,
      penalty: penalty.penalty,
      ...mathHListFlexBeforeX(hlist.items, x),
    });
  }
  return breakpoints.sort((left, right) =>
    left.x === right.x
      ? left.sourceOffset - right.sourceOffset
      : left.x - right.x
  );
}

function mathSourceSpanEndX(
  sourceStart: number,
  sourceEnd: number,
  extents: readonly MathItemExtent[],
  hlistWidth: number
): TexHBoxX | null {
  let xEnd: TexHBoxX | null = null;
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
    xEnd = xEnd === null
      ? extent.xEnd
      : texHBoxX(Math.max(xEnd, extent.xEnd));
  }
  return xEnd === null
    ? null
    : texHBoxX(roundTexPt(Math.max(0, Math.min(hlistWidth, xEnd))));
}

function mathSourceOffsetX(
  sourceOffset: number,
  extents: readonly MathItemExtent[],
  hlistWidth: number
): TexHBoxX {
  let x = texHBoxX(0);
  for (const extent of extents) {
    if (extent.sourceEnd <= sourceOffset) {
      x = texHBoxX(Math.max(x, extent.xEnd));
    }
  }
  return texHBoxX(roundTexPt(Math.max(0, Math.min(hlistWidth, x))));
}

function discardableMathGlueAfterSourceOffset(
  items: readonly TexMathHListItem[],
  sourceOffset: number,
  x: TexHBoxX
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
  originX: TexHBoxX
): readonly MathItemExtent[] {
  const extents: MathItemExtent[] = [];
  for (const item of items) {
    const xStart = texHBoxX(roundTexPt(originX + item.x));
    const xEnd = texHBoxX(roundTexPt(xStart + Math.max(0, item.width)));
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

function buildInlineMathCaretMap(
  hlist: TexMathHList,
  params: {
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly contentStart: number;
    readonly contentEnd: number;
  },
  fontProfile: TexMathFontProfile
): TexMathCaretMap {
  const entries: TexMathCaretEntry[] = [];
  const addEntry = (entry: TexMathCaretEntry) => {
    if (!Number.isFinite(entry.sourceOffset) || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) {
      return;
    }
    entries.push({
      ...entry,
      sourceOffset: Math.max(params.sourceStart, Math.min(params.sourceEnd, Math.floor(entry.sourceOffset))),
      x: roundTexPt(Math.max(0, Math.min(hlist.width, entry.x))),
      y: roundTexPt(entry.y),
      height: roundTexPt(Math.max(0, entry.height)),
      depth: roundTexPt(Math.max(0, entry.depth)),
      hitBounds: normalizeCaretHitBounds(entry.hitBounds, hlist.width),
    });
  };

  addLinearMathCaretMapEntries({
    sourceStart: params.sourceStart,
    sourceEnd: params.contentStart,
    xStart: 0,
    xEnd: 0,
    y: 0,
    height: hlist.height,
    depth: hlist.depth,
    hitBounds: boxCaretHitBounds(0, 0, hlist.width, hlist.height, hlist.depth),
    kind: "math-boundary",
    priority: 0,
    addEntry,
  });
  addLinearMathCaretMapEntries({
    sourceStart: params.contentEnd,
    sourceEnd: params.sourceEnd,
    xStart: hlist.width,
    xEnd: hlist.width,
    y: 0,
    height: hlist.height,
    depth: hlist.depth,
    hitBounds: boxCaretHitBounds(0, 0, hlist.width, hlist.height, hlist.depth),
    kind: "math-boundary",
    priority: 0,
    addEntry,
  });
  addMathItemCaretMapEntries(
    hlist.items,
    texHBoxX(0),
    texHBoxY(0),
    fontProfile,
    addEntry
  );

  const dedupedEntries = dedupeMathCaretEntries(entries);
  const diagnostics = mathCaretMapCoverageDiagnostics(dedupedEntries, params);
  return {
    sourceStart: params.sourceStart,
    sourceEnd: params.sourceEnd,
    contentStart: params.contentStart,
    contentEnd: params.contentEnd,
    entries: dedupedEntries,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function addMathItemCaretMapEntries(
  items: readonly TexMathHListItem[],
  originX: TexHBoxX,
  originY: TexHBoxY,
  fontProfile: TexMathFontProfile,
  addEntry: (entry: TexMathCaretEntry) => void
): void {
  addEnclosureConstructCaretMapEntries(items, originX, originY, fontProfile, addEntry);
  addFractionCaretMapEntries(items, originX, originY, addEntry);
  for (const item of items) {
    const x = texHBoxX(roundTexPt(originX + item.x));
    if (item.kind === "hlist") {
      const y = texHBoxY(roundTexPt(originY + item.y));
      const kind = mathCaretEntryKindForHListRole(item.role);
      const hitBounds = mathItemCaretHitBounds(item, originX, originY, fontProfile);
      addEntry(mathCaretEntry(item.sourceSpan.start, x, y, item.height, item.depth, hitBounds, kind, item.sourceSpan, 50));
      addEntry(mathCaretEntry(
        item.sourceSpan.end,
        texHBoxX(roundTexPt(x + item.width)),
        y,
        item.height,
        item.depth,
        hitBounds,
        kind,
        item.sourceSpan,
        50
      ));
      addMathItemCaretMapEntries(item.items, x, y, fontProfile, addEntry);
      continue;
    }
    if (item.kind === "glyph") {
      if (mathGlyphCoversConstructSpan(item)) {
        continue;
      }
      const y = texHBoxY(roundTexPt(originY + item.y));
      const hitBounds = mathItemCaretHitBounds(item, originX, originY, fontProfile);
      const caretY = texHBoxY(roundTexPt(Math.min(Math.max(y, hitBounds.yStart), hitBounds.yEnd)));
      addLinearMathCaretMapEntries({
        sourceStart: item.sourceSpan.start,
        sourceEnd: item.sourceSpan.end,
        xStart: x,
        xEnd: texHBoxX(roundTexPt(x + item.width)),
        y: caretY,
        height: Math.max(0, caretY - hitBounds.yStart),
        depth: Math.max(0, hitBounds.yEnd - caretY),
        hitBounds,
        kind: "glyph-boundary",
        sourceSpan: item.sourceSpan,
        priority: 100,
        addEntry,
      });
      continue;
    }
    if (item.kind === "rule") {
      continue;
    }
    if (item.kind === "middle-delimiter") {
      const hitBounds = boxCaretHitBounds(x, originY, 0, 0, 0);
      addEntry(mathCaretEntry(
        item.commandSourceSpan.start,
        x,
        originY,
        0,
        0,
        hitBounds,
        "command",
        item.commandSourceSpan,
        40
      ));
      addEntry(mathCaretEntry(
        item.delimiterSourceSpan.end,
        x,
        originY,
        0,
        0,
        hitBounds,
        "command",
        item.delimiterSourceSpan,
        40
      ));
      continue;
    }

    const kind = item.sourceSpan.end > item.sourceSpan.start + 1 ? "command" : "synthetic-boundary";
    addLinearMathCaretMapEntries({
      sourceStart: item.sourceSpan.start,
      sourceEnd: item.sourceSpan.end,
      xStart: x,
      xEnd: texHBoxX(roundTexPt(x + item.width)),
      y: originY,
      height: 0,
      depth: 0,
      hitBounds: boxCaretHitBounds(x, originY, item.width, 0, 0),
      kind,
      sourceSpan: item.sourceSpan,
      priority: kind === "command" ? 40 : 10,
      addEntry,
    });
  }
}

function addEnclosureConstructCaretMapEntries(
  items: readonly TexMathHListItem[],
  originX: TexHBoxX,
  originY: TexHBoxY,
  fontProfile: TexMathFontProfile,
  addEntry: (entry: TexMathCaretEntry) => void
): void {
  const added = new Set<string>();
  for (const item of items) {
    if (item.kind !== "rule" || !mathEnclosureRuleRoles.has(item.role)) {
      continue;
    }
    const body = enclosureConstructBody(items, item);
    if (!body) {
      continue;
    }
    const commandEnd = body.sourceSpan.start;
    if (commandEnd <= item.sourceSpan.start) {
      continue;
    }
    const key = `${item.sourceSpan.start}:${commandEnd}`;
    if (added.has(key)) {
      continue;
    }
    added.add(key);
    const constructBounds = enclosureConstructHitBounds(items, item, body, originX, originY, fontProfile);
    const y = originY;
    addLinearMathCaretMapEntries({
      sourceStart: item.sourceSpan.start,
      sourceEnd: commandEnd,
      xStart: constructBounds.xStart,
      xEnd: roundTexPt(originX + body.x),
      y,
      height: Math.max(0, y - constructBounds.yStart),
      depth: Math.max(0, constructBounds.yEnd - y),
      hitBounds: constructBounds,
      kind: "command",
      sourceSpan: {
        start: item.sourceSpan.start,
        end: commandEnd,
      },
      priority: 45,
      addEntry,
    });
  }
}

const mathEnclosureRuleRoles: ReadonlySet<Extract<TexMathHListItem, { readonly kind: "rule" }>["role"]> = new Set([
  "radical-rule",
  "overline-rule",
  "underline-rule",
  "boxed-rule",
]);

function enclosureConstructBody(
  items: readonly TexMathHListItem[],
  rule: Extract<TexMathHListItem, { readonly kind: "rule" }>
): TexMathChildHListLayoutItem | null {
  const candidates = items.filter((item): item is TexMathChildHListLayoutItem =>
    item.kind === "hlist" &&
    item.sourceSpan.start > rule.sourceSpan.start &&
    item.sourceSpan.end > item.sourceSpan.start
  );
  if (rule.role === "boxed-rule") {
    return candidates.find((item) => item.role === "boxed-body") ?? null;
  }
  return candidates.find((item) =>
    item.role === "nucleus" &&
    rangesOverlapOrTouch(item.sourceSpan.start, item.sourceSpan.end, rule.sourceSpan.start, rule.sourceSpan.end + 1)
  ) ?? null;
}

function rangesOverlapOrTouch(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function enclosureConstructHitBounds(
  items: readonly TexMathHListItem[],
  rule: Extract<TexMathHListItem, { readonly kind: "rule" }>,
  body: TexMathChildHListLayoutItem,
  originX: TexHBoxX,
  originY: TexHBoxY,
  fontProfile: TexMathFontProfile
): TexMathCaretEntry["hitBounds"] {
  const bounds: TexMathCaretEntry["hitBounds"][] = [];
  for (const item of items) {
    if (
      item === body ||
      (
        item.sourceSpan.start === rule.sourceSpan.start &&
        item.sourceSpan.end === rule.sourceSpan.end
      )
    ) {
      bounds.push(mathItemCaretHitBounds(item, originX, originY, fontProfile));
    }
  }
  if (bounds.length === 0) {
    return mathItemCaretHitBounds(body, originX, originY, fontProfile);
  }
  return unionCaretHitBounds(...bounds);
}

function mathItemCaretHitBounds(
  item: TexMathHListItem,
  originX: TexHBoxX,
  originY: TexHBoxY,
  fontProfile: TexMathFontProfile
): TexMathCaretEntry["hitBounds"] {
  const x = originX + item.x;
  if (item.kind === "rule") {
    return ruleCaretHitBounds(x, originY + item.y, item.width, item.height);
  }
  if (item.kind === "glyph") {
    const visualBounds = texMathGlyphVisualBounds(item, fontProfile, originX, originY);
    return visualBounds
      ? {
        xStart: roundTexPt(Math.min(x, visualBounds.xStart)),
        xEnd: roundTexPt(Math.max(x + item.width, visualBounds.xEnd)),
        yStart: roundTexPt(visualBounds.yStart),
        yEnd: roundTexPt(visualBounds.yEnd),
      }
      : boxCaretHitBounds(x, originY + item.y, item.width, item.height, item.depth);
  }
  if (item.kind === "hlist") {
    return boxCaretHitBounds(x, originY + item.y, item.width, item.height, item.depth);
  }
  return boxCaretHitBounds(x, originY, item.width, 0, 0);
}

function addFractionCaretMapEntries(
  items: readonly TexMathHListItem[],
  originX: TexHBoxX,
  originY: TexHBoxY,
  addEntry: (entry: TexMathCaretEntry) => void
): void {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.kind !== "rule" || item.role !== "fraction-rule") {
      continue;
    }
    const numerator = adjacentFractionCaretChild(items, index, -1, item.sourceSpan);
    const denominator = adjacentFractionCaretChild(items, index, 1, item.sourceSpan);
    if (!numerator || !denominator) {
      continue;
    }
    const xStart = texHBoxX(roundTexPt(originX + item.x));
    const xEnd = texHBoxX(roundTexPt(xStart + item.width));
    const y = texHBoxY(roundTexPt(originY + item.y));
    const hitBounds = unionCaretHitBounds(
      boxCaretHitBounds(originX + numerator.x, originY + numerator.y, numerator.width, numerator.height, numerator.depth),
      ruleCaretHitBounds(xStart, y, item.width, item.height),
      boxCaretHitBounds(originX + denominator.x, originY + denominator.y, denominator.width, denominator.height, denominator.depth)
    );
    for (let rawOffset = item.sourceSpan.start; rawOffset <= numerator.sourceSpan.start; rawOffset += 1) {
      addEntry(mathCaretEntry(
        rawOffset,
        xStart,
        originY,
        originY - hitBounds.yStart,
        hitBounds.yEnd - originY,
        hitBounds,
        "command",
        item.sourceSpan,
        40
      ));
    }
    for (let rawOffset = numerator.sourceSpan.end; rawOffset <= denominator.sourceSpan.start; rawOffset += 1) {
      const x = texHBoxX(roundTexPt((xStart + xEnd) / 2));
      addEntry(mathCaretEntry(
        rawOffset,
        x,
        originY,
        originY - hitBounds.yStart,
        hitBounds.yEnd - originY,
        hitBounds,
        "group-boundary",
        item.sourceSpan,
        45
      ));
    }
    for (let rawOffset = denominator.sourceSpan.end; rawOffset <= item.sourceSpan.end; rawOffset += 1) {
      addEntry(mathCaretEntry(
        rawOffset,
        xEnd,
        originY,
        originY - hitBounds.yStart,
        hitBounds.yEnd - originY,
        hitBounds,
        "construct-boundary",
        item.sourceSpan,
        45
      ));
    }
  }
}

function adjacentFractionCaretChild(
  items: readonly TexMathHListItem[],
  ruleIndex: number,
  direction: -1 | 1,
  fractionSpan: TexMathSourceSpan
): TexMathChildHListLayoutItem | null {
  for (let index = ruleIndex + direction; index >= 0 && index < items.length; index += direction) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.kind !== "hlist") {
      if (item.kind === "kern" && item.reason === "fraction-kern") {
        continue;
      }
      return null;
    }
    return item.sourceSpan.start >= fractionSpan.start &&
      item.sourceSpan.end <= fractionSpan.end
      ? item
      : null;
  }
  return null;
}

function addLinearMathCaretMapEntries(params: {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly xStart: number;
  readonly xEnd: number;
  readonly y: number;
  readonly height: number;
  readonly depth: number;
  readonly hitBounds: TexMathCaretEntry["hitBounds"];
  readonly kind: TexMathCaretEntry["kind"];
  readonly sourceSpan?: TexMathSourceSpan;
  readonly priority: number;
  readonly addEntry: (entry: TexMathCaretEntry) => void;
}): void {
  const spanLength = Math.max(0, params.sourceEnd - params.sourceStart);
  if (spanLength === 0) {
    params.addEntry(mathCaretEntry(
      params.sourceStart,
      params.xStart,
      params.y,
      params.height,
      params.depth,
      params.hitBounds,
      params.kind,
      params.sourceSpan,
      params.priority
    ));
    return;
  }
  for (let rawOffset = params.sourceStart; rawOffset <= params.sourceEnd; rawOffset += 1) {
    const t = (rawOffset - params.sourceStart) / spanLength;
    params.addEntry(mathCaretEntry(
      rawOffset,
      roundTexPt(params.xStart + (params.xEnd - params.xStart) * t),
      params.y,
      params.height,
      params.depth,
      params.hitBounds,
      params.kind,
      params.sourceSpan,
      params.priority
    ));
  }
}

function mathCaretEntry(
  sourceOffset: number,
  x: number,
  y: number,
  height: number,
  depth: number,
  hitBounds: TexMathCaretEntry["hitBounds"],
  kind: TexMathCaretEntry["kind"],
  sourceSpan: TexMathSourceSpan | undefined,
  priority: number
): TexMathCaretEntry {
  return {
    sourceOffset,
    x,
    y,
    height,
    depth,
    hitBounds,
    kind,
    ...(sourceSpan ? { sourceSpan } : {}),
    priority,
  };
}

function mathCaretEntryKindForHListRole(
  role: TexMathChildHListLayoutItem["role"]
): TexMathCaretEntry["kind"] {
  return mathConstructBoundaryHListRoles.has(role)
    ? "construct-boundary"
    : "group-boundary";
}

const mathConstructBoundaryHListRoles: ReadonlySet<TexMathChildHListLayoutItem["role"]> = new Set([
  "superscript",
  "subscript",
  "limit-superscript",
  "limit-subscript",
  "radical-degree",
  "var-limit-row",
]);

function boxCaretHitBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  depth: number
): TexMathCaretEntry["hitBounds"] {
  return {
    xStart: roundTexPt(x),
    xEnd: roundTexPt(x + Math.max(0, width)),
    yStart: roundTexPt(y - Math.max(0, height)),
    yEnd: roundTexPt(y + Math.max(0, depth)),
  };
}

function ruleCaretHitBounds(
  x: number,
  y: number,
  width: number,
  height: number
): TexMathCaretEntry["hitBounds"] {
  return {
    xStart: roundTexPt(x),
    xEnd: roundTexPt(x + Math.max(0, width)),
    yStart: roundTexPt(y),
    yEnd: roundTexPt(y + Math.max(0, height)),
  };
}

function unionCaretHitBounds(
  ...bounds: readonly TexMathCaretEntry["hitBounds"][]
): TexMathCaretEntry["hitBounds"] {
  return {
    xStart: roundTexPt(Math.min(...bounds.map((bound) => bound.xStart))),
    xEnd: roundTexPt(Math.max(...bounds.map((bound) => bound.xEnd))),
    yStart: roundTexPt(Math.min(...bounds.map((bound) => bound.yStart))),
    yEnd: roundTexPt(Math.max(...bounds.map((bound) => bound.yEnd))),
  };
}

function normalizeCaretHitBounds(
  bounds: TexMathCaretEntry["hitBounds"],
  hlistWidth: number
): TexMathCaretEntry["hitBounds"] {
  const xStart = Math.max(0, Math.min(hlistWidth, bounds.xStart));
  const xEnd = Math.max(xStart, Math.min(hlistWidth, bounds.xEnd));
  const yStart = Math.min(bounds.yStart, bounds.yEnd);
  const yEnd = Math.max(bounds.yStart, bounds.yEnd);
  return {
    xStart: roundTexPt(xStart),
    xEnd: roundTexPt(xEnd),
    yStart: roundTexPt(yStart),
    yEnd: roundTexPt(yEnd),
  };
}

function dedupeMathCaretEntries(entries: readonly TexMathCaretEntry[]): readonly TexMathCaretEntry[] {
  const sorted = [...entries].sort((left, right) =>
    left.sourceOffset === right.sourceOffset
      ? (right.priority ?? 0) - (left.priority ?? 0) ||
        left.y - right.y ||
        left.x - right.x ||
        left.kind.localeCompare(right.kind)
      : left.sourceOffset - right.sourceOffset
  );
  return sorted.filter((entry, index, allEntries) =>
    allEntries.findIndex((candidate) =>
      candidate.sourceOffset === entry.sourceOffset &&
      candidate.x === entry.x &&
      candidate.y === entry.y &&
      candidate.height === entry.height &&
      candidate.depth === entry.depth &&
      candidate.kind === entry.kind &&
      candidate.hitBounds.xStart === entry.hitBounds.xStart &&
      candidate.hitBounds.xEnd === entry.hitBounds.xEnd &&
      candidate.hitBounds.yStart === entry.hitBounds.yStart &&
      candidate.hitBounds.yEnd === entry.hitBounds.yEnd
    ) === index
  );
}

function mathCaretMapCoverageDiagnostics(
  entries: readonly TexMathCaretEntry[],
  params: {
    readonly sourceStart: number;
    readonly sourceEnd: number;
  }
): readonly TexMathCaretDiagnostic[] {
  const coveredOffsets = new Set(entries.map((entry) => entry.sourceOffset));
  const diagnostics: TexMathCaretDiagnostic[] = [];
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;
  const flushRange = () => {
    if (rangeStart === null || rangeEnd === null) {
      return;
    }
    diagnostics.push({
      code: "incomplete-math-caret-geometry",
      message: `No 2-D math caret entry was generated for source offset${rangeStart === rangeEnd ? "" : "s"} ${
        rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`
      }.`,
      sourceSpan: {
        start: Math.max(params.sourceStart, Math.min(params.sourceEnd, rangeStart)),
        end: Math.max(params.sourceStart, Math.min(params.sourceEnd, rangeEnd + 1)),
      },
    });
    rangeStart = null;
    rangeEnd = null;
  };

  for (let sourceOffset = params.sourceStart; sourceOffset <= params.sourceEnd; sourceOffset += 1) {
    if (coveredOffsets.has(sourceOffset)) {
      flushRange();
      continue;
    }
    rangeStart ??= sourceOffset;
    rangeEnd = sourceOffset;
  }
  flushRange();
  return diagnostics;
}

function projectInlineMathCaretStops(
  caretMap: TexMathCaretMap,
  width: number
): readonly number[] {
  const rawLength = Math.max(0, caretMap.sourceEnd - caretMap.sourceStart);
  const stops = Array.from({ length: rawLength + 1 }, () => Number.NaN);
  const entriesByOffset = new Map<number, TexMathCaretEntry[]>();
  for (const entry of caretMap.entries) {
    const entries = entriesByOffset.get(entry.sourceOffset) ?? [];
    entries.push(entry);
    entriesByOffset.set(entry.sourceOffset, entries);
  }

  for (let rawOffset = caretMap.sourceStart; rawOffset <= caretMap.sourceEnd; rawOffset += 1) {
    const entry = projectedMathCaretEntry(entriesByOffset.get(rawOffset) ?? [], caretMap);
    if (!entry) {
      continue;
    }
    const index = rawOffset - caretMap.sourceStart;
    stops[index] = roundTexPt(Math.max(0, Math.min(width, entry.x)));
  }

  enforceMonotoneProjectedCaretStops(stops, width);
  return stops.map((stop) => roundTexPt(stop));
}

function projectedMathCaretEntry(
  entries: readonly TexMathCaretEntry[],
  caretMap: TexMathCaretMap
): TexMathCaretEntry | null {
  if (entries.length === 0) {
    return null;
  }
  return [...entries].sort((left, right) =>
    projectedMathCaretEntryScore(right, caretMap) - projectedMathCaretEntryScore(left, caretMap) ||
    left.x - right.x ||
    left.y - right.y
  )[0] ?? null;
}

function projectedMathCaretEntryScore(
  entry: TexMathCaretEntry,
  caretMap: TexMathCaretMap
): number {
  if (
    entry.kind === "math-boundary" &&
    (entry.sourceOffset <= caretMap.sourceStart || entry.sourceOffset >= caretMap.contentEnd)
  ) {
    return 10_000;
  }
  if (entry.kind === "math-boundary") {
    return 0;
  }
  const spanLength = Math.max(0, (entry.sourceSpan?.end ?? entry.sourceOffset) - (entry.sourceSpan?.start ?? entry.sourceOffset));
  return spanLength * 100 + projectedMathCaretKindScore(entry.kind) + (entry.priority ?? 0) / 100;
}

function projectedMathCaretKindScore(kind: TexMathCaretEntry["kind"]): number {
  switch (kind) {
    case "construct-boundary":
      return 60;
    case "group-boundary":
      return 50;
    case "command":
      return 40;
    case "glyph-boundary":
      return 30;
    case "synthetic-boundary":
      return 10;
    case "math-boundary":
      return 0;
  }
}

function enforceMonotoneProjectedCaretStops(stops: number[], width: number): void {
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

function mathGlyphCoversConstructSpan(item: Extract<TexMathHListItem, { readonly kind: "glyph" }>): boolean {
  return item.sourceSpan.end - item.sourceSpan.start > Math.max(1, item.text.length);
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
      allowDisplayBreak: style === "display",
      allowIntertext: style === "display",
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
    readonly displayLabels?: readonly (TexMathDisplayLabel | null)[];
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
    allowDisplayBreak: true,
    allowIntertext: true,
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
  const intertexts = displayAlignmentIntertexts(alignedRows);
  if (params.delimiter === "multline" || params.delimiter === "multline-star") {
    const alignedNucleus = alignedNucleusFromList(parsed.list);
    const multlineLabel = params.delimiter === "multline"
      ? multlineDisplayLabel(alignedNucleus, params.displayLabels)
      : null;
    const rows = alignedRows.map((row, rowIndex) => {
      const rowWidth = mathItemsRightEdge(row.items);
      const isTaggedRow = rowIndex === alignedRows.length - 1 && multlineLabel !== null;
      const tag = isTaggedRow
        ? layoutDisplayAlignmentTag(multlineLabel, row.sourceSpan.start, fontProfile, baseAtPt)
        : null;
      const shiftTag = tag !== null && multlineRightTagCollides(rowWidth, tag.width, params.targetWidth);
      const rowSourceSpan = tag && multlineLabel
        ? {
          start: Math.min(row.sourceSpan.start, multlineLabel.sourceSpan.start),
          end: Math.max(row.sourceSpan.end, multlineLabel.sourceSpan.end),
        }
        : row.sourceSpan;
      const rowOffset = multlineRowOffset(
        rowWidth,
        rowIndex,
        alignedRows.length,
        params.targetWidth,
        row.multlineShove,
        tag?.width ?? 0,
        shiftTag
      );
      const packedRow = packMultlineRowToDisplayWidth(
        row,
        Math.max(0, params.targetWidth - rowOffset)
      );
      const rowItems = offsetMathHListItems(packedRow.items, rowOffset);
      const taggedRow = tag
        ? addMultlineDisplayTag(
          row,
          rowItems,
          tag,
          params.targetWidth,
          shiftTag,
          displayAlignmentRowLineDepth(alignedRows, rowIndex)
        )
        : {
          width: params.targetWidth,
          height: row.height,
          depth: row.depth,
          items: rowItems,
        };
      const rowHList: TexMathHList = {
        kind: "math-hlist",
        style: laidOut.hlist.style,
        width: taggedRow.width,
        height: taggedRow.height,
        depth: taggedRow.depth,
        sourceSpan: rowSourceSpan,
        items: taggedRow.items,
      };
      const caretMap = buildInlineMathCaretMap(rowHList, {
        sourceStart: rowSourceSpan.start,
        sourceEnd: rowSourceSpan.end,
        contentStart: rowSourceSpan.start,
        contentEnd: rowSourceSpan.end,
      }, fontProfile);
      return {
        rowIndex,
        x: 0,
        source: params.source,
        content: params.content,
        sourceStart: rowSourceSpan.start,
        sourceEnd: rowSourceSpan.end,
        contentStart: rowSourceSpan.start,
        contentEnd: rowSourceSpan.end,
        width: taggedRow.width,
        height: taggedRow.height,
        depth: taggedRow.depth,
        caretMap,
        caretStops: projectInlineMathCaretStops(caretMap, rowHList.width),
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
      ...(intertexts.length > 0 ? { intertexts } : {}),
    };
  }
  if (params.delimiter === "gather" || params.delimiter === "gather-star") {
    const alignedNucleus = alignedNucleusFromList(parsed.list);
    const rows = alignedRows.map((row, rowIndex) => {
      const label = params.delimiter === "gather"
        ? displayAlignmentRowLabel(alignedNucleus, params.displayLabels, rowIndex)
        : null;
      const tag = label
        ? layoutDisplayAlignmentTag(label, row.sourceSpan.start, fontProfile, baseAtPt)
        : null;
      const tagPlacement = gatherRowPlacement(row.items, tag?.width ?? 0, params.targetWidth);
      const rowItems = offsetMathHListItems(row.items, tagPlacement.rowOffset);
      const taggedRow = params.delimiter === "gather"
        ? addGatherDisplayTag(
          row,
          rowItems,
          tag,
          tagPlacement?.shiftTag ?? null,
          params.targetWidth
        )
        : {
          width: params.targetWidth,
          height: row.height,
          depth: row.depth,
          items: rowItems,
        };
      const rowHList: TexMathHList = {
        kind: "math-hlist",
        style: laidOut.hlist.style,
        width: taggedRow.width,
        height: taggedRow.height,
        depth: taggedRow.depth,
        sourceSpan: row.sourceSpan,
        items: taggedRow.items,
      };
      const caretMap = buildInlineMathCaretMap(rowHList, {
        sourceStart: row.sourceSpan.start,
        sourceEnd: row.sourceSpan.end,
        contentStart: row.sourceSpan.start,
        contentEnd: row.sourceSpan.end,
      }, fontProfile);
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
        caretMap,
        caretStops: projectInlineMathCaretStops(caretMap, rowHList.width),
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
      ...(intertexts.length > 0 ? { intertexts } : {}),
    };
  }
  const alignedNucleus = alignedNucleusFromList(parsed.list);
  const pairCount = displayAlignmentPairCount(alignedRows);
  const rowTagWidths = displayAlignmentRowTagWidths(alignedNucleus, params.displayLabels, fontProfile, baseAtPt);
  const dimensions = displayAlignmentDimensions({
    measuredWidth: laidOut.hlist.width,
    mode: displayAlignmentDimensionMode(params.delimiter),
    pairCount,
    rowCount: alignedRows.length,
    rows: alignedRows,
    rowTagWidths,
    targetWidth: params.targetWidth,
  });
  const hasAlignmentTags = alignedRows.some((_, rowIndex) =>
    displayAlignmentRowLabel(alignedNucleus, params.displayLabels, rowIndex) !== null
  );
  const hasExplicitAlignmentTags = alignedRows.some((_, rowIndex) =>
    displayAlignmentRowLabel(alignedNucleus, params.displayLabels, rowIndex)?.explicit === true
  );
  const explicitStarAlignmentTagsAffectWidth =
    hasExplicitAlignmentTags && params.delimiter === "align-star";
  const hasUntaggedAlignmentRows = alignedRows.some((_, rowIndex) =>
    displayAlignmentRowLabel(alignedNucleus, params.displayLabels, rowIndex) === null
  );
  const overfullBodyWidth = displayAlignmentOverfullBodyWidth(
    alignedRows,
    dimensions,
    (rowIndex) => {
      const label = displayAlignmentRowLabel(alignedNucleus, params.displayLabels, rowIndex);
      if (label === null) {
        return true;
      }
      if (label.explicit === true && explicitStarAlignmentTagsAffectWidth) {
        const row = alignedRows[rowIndex];
        const rowRightEdge = row
          ? mathItemsRightEdge(displayAlignmentRowItems(row.items, dimensions))
          : dimensions.targetWidth;
        return rowRightEdge <= dimensions.targetWidth +
          TEX_DISPLAY_ALIGNMENT_TAGGED_ROW_OVERFULL_TOLERANCE_PT;
      }
      if (
        hasExplicitAlignmentTags ||
        label.explicit === true ||
        !hasUntaggedAlignmentRows
      ) {
        return false;
      }
      const row = alignedRows[rowIndex];
      const rowRightEdge = row
        ? mathItemsRightEdge(displayAlignmentRowItems(row.items, dimensions))
        : dimensions.targetWidth;
      return rowRightEdge > dimensions.targetWidth +
        TEX_DISPLAY_ALIGNMENT_TAGGED_ROW_OVERFULL_TOLERANCE_PT;
    }
  );
  const forcedRowWidth = hasAlignmentTags
    ? overfullBodyWidth
    : null;
  const rows = alignedRows.map((row, rowIndex) => {
    const taggedRow = addDisplayAlignmentTag(
      row,
      displayAlignmentRowLabel(alignedNucleus, params.displayLabels, rowIndex),
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
    const caretMap = buildInlineMathCaretMap(rowHList, {
      sourceStart: row.sourceSpan.start,
      sourceEnd: row.sourceSpan.end,
      contentStart: row.sourceSpan.start,
      contentEnd: row.sourceSpan.end,
    }, fontProfile);
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
      caretMap,
      caretStops: projectInlineMathCaretStops(caretMap, rowHList.width),
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
    width: Math.max(
      hasAlignmentTags ? dimensions.targetWidth : dimensions.rowWidth,
      ...rows.map((row) => row.width)
    ),
    rows,
    ...(intertexts.length > 0 ? { intertexts } : {}),
  };
}

function packMultlineRowToDisplayWidth(
  row: TexMathChildHListLayoutItem,
  targetWidth: number
): TexMathHList {
  const rowWidth = mathItemsRightEdge(row.items);
  const hlist: TexMathHList = {
    kind: "math-hlist",
    style: "display",
    width: rowWidth,
    height: row.height,
    depth: row.depth,
    sourceSpan: row.sourceSpan,
    items: row.items,
  };
  if (rowWidth <= targetWidth) {
    return hlist;
  }
  return packTexMathHListToWidthThroughSingleChild(hlist, targetWidth);
}

function packTexMathHListToWidthThroughSingleChild(
  hlist: TexMathHList,
  targetWidth: number
): TexMathHList {
  if (texMathHListHasGlueFlex(hlist)) {
    return setTexMathHListWidth(hlist, targetWidth);
  }
  const child = hlist.items.length === 1 ? hlist.items[0] : null;
  if (child?.kind !== "hlist") {
    return setTexMathHListWidth(hlist, targetWidth);
  }
  const packedChild = packTexMathHListToWidthThroughSingleChild(
    {
      kind: "math-hlist",
      style: hlist.style,
      width: child.width,
      height: child.height,
      depth: child.depth,
      sourceSpan: child.sourceSpan,
      items: child.items,
    },
    Math.max(0, targetWidth - child.x)
  );
  return {
    ...hlist,
    width: roundTexPt(targetWidth),
    items: [{
      ...child,
      width: packedChild.width,
      height: packedChild.height,
      depth: packedChild.depth,
      items: packedChild.items,
    }],
  };
}

function texMathHListHasGlueFlex(hlist: TexMathHList): boolean {
  return hlist.items.some((item) =>
    item.kind === "glue" && (item.stretch > 0 || item.shrink > 0)
  );
}

function displayAlignmentIntertexts(
  rows: readonly TexMathChildHListLayoutItem[]
): NonNullable<TexMathDisplayAlignment["intertexts"]> {
  const intertexts: TexMathDisplayAlignmentIntertext[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    if (!row.intertextsBefore?.length) {
      continue;
    }
    for (const intertext of row.intertextsBefore) {
      intertexts.push({
        beforeRowIndex: rowIndex,
        text: intertext.text,
        parts: intertext.parts,
        sourceStart: intertext.sourceSpan.start,
        sourceEnd: intertext.sourceSpan.end,
        contentStart: intertext.textSourceSpan.start,
        contentEnd: intertext.textSourceSpan.end,
      });
    }
  }
  return intertexts;
}

function displayAlignmentRowLabel(
  alignedNucleus: TexMathAlignedNucleus | null,
  displayLabels: readonly (TexMathDisplayLabel | null)[] | undefined,
  rowIndex: number
): TexMathAlignedRowLabel | null {
  return alignedNucleus?.rows[rowIndex]?.labels?.[0] ??
    displayLabels?.[rowIndex] ??
    null;
}

type TexDisplayAlignmentDelimiter =
  | "align"
  | "align-star"
  | "flalign"
  | "flalign-star"
  | "gather"
  | "gather-star"
  | "multline"
  | "multline-star";

function texMathDisplayAlignmentDelimiter(
  delimiter: string
): delimiter is TexDisplayAlignmentDelimiter {
  return delimiter === "align" ||
    delimiter === "align-star" ||
    delimiter === "flalign" ||
    delimiter === "flalign-star" ||
    delimiter === "gather" ||
    delimiter === "gather-star" ||
    delimiter === "multline" ||
    delimiter === "multline-star";
}

function displayAlignmentColumnSeparation(delimiter: TexDisplayAlignmentDelimiter):
  "align" | "flalign" | "gather" | "multline" {
  if (delimiter === "gather" || delimiter === "gather-star") {
    return "gather";
  }
  if (delimiter === "multline" || delimiter === "multline-star") {
    return "multline";
  }
  if (delimiter === "flalign" || delimiter === "flalign-star") {
    return "flalign";
  }
  return "align";
}

function displayAlignmentDimensionMode(delimiter: TexDisplayAlignmentDelimiter): "centered" | "flush" {
  return delimiter === "flalign" || delimiter === "flalign-star" ? "flush" : "centered";
}

function multlineRowOffset(
  rowWidth: number,
  rowIndex: number,
  rowCount: number,
  targetWidth: number,
  shove?: "left" | "right",
  rightTagWidth = 0,
  shiftedRightTag = false
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
    if (rightTagWidth > 0 && !shiftedRightTag) {
      return roundTexPt(Math.max(0, targetWidth - rowWidth - rightTagWidth - TEX_MULTLINE_TAG_GAP_PT));
    }
    return roundTexPt(Math.max(0, targetWidth - rowWidth - TEX_MULTLINE_GAP_PT));
  }
  return roundTexPt(Math.max(0, (targetWidth - rowWidth) / 2));
}

function multlineDisplayLabel(
  alignedNucleus: TexMathAlignedNucleus | null,
  displayLabels: readonly (TexMathDisplayLabel | null)[] | undefined
): TexMathAlignedRowLabel | null {
  return alignedNucleus?.rows.find((row) => (row.labels?.length ?? 0) > 0)?.labels?.[0] ??
    displayLabels?.find((label): label is TexMathDisplayLabel => label !== null) ??
    null;
}

function gatherRowPlacement(
  items: readonly TexMathHListItem[],
  tagWidth: number,
  targetWidth: number
): {
  readonly rowOffset: number;
  readonly shiftTag: boolean;
} {
  const leftEdge = mathItemsLeftEdge(items);
  const rowWidth = roundTexPt(Math.max(0, mathItemsRightEdge(items) - leftEdge));
  const shiftTag = 2 * TEX_DISPLAY_ALIGNMENT_MIN_TAG_SEP_PT + rowWidth + tagWidth > targetWidth;
  let eqnShift = roundTexPt(Math.max(0, targetWidth - rowWidth));
  if (!shiftTag && eqnShift < 4 * tagWidth) {
    eqnShift = roundTexPt(Math.max(0, eqnShift - tagWidth));
  }
  return {
    rowOffset: roundTexPt(Math.max(0, eqnShift / 2) - leftEdge),
    shiftTag,
  };
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
  displayLabels: readonly (TexMathDisplayLabel | null)[] | undefined,
  fontProfile: TexMathFontProfile,
  baseAtPt: number
): readonly number[] {
  const rowCount = Math.max(alignedNucleus?.rows.length ?? 0, displayLabels?.length ?? 0);
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = alignedNucleus?.rows[rowIndex] ?? null;
    const label = displayAlignmentRowLabel(alignedNucleus, displayLabels, rowIndex);
    if (!label) {
      return 0;
    }
    const tag = layoutDisplayAlignmentTag(
      label,
      row?.sourceSpan.start ?? label.sourceSpan.start,
      fontProfile,
      baseAtPt
    );
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
  return tag.supported ? remapMathHListSourceSpan(tag.hlist, label.sourceSpan) : null;
}

function remapMathHListSourceSpan(
  hlist: TexMathHList,
  sourceSpan: TexMathSourceSpan
): TexMathHList {
  return {
    ...hlist,
    sourceSpan,
    items: hlist.items.map((item): TexMathHListItem => {
      if (item.kind === "hlist") {
        return {
          ...item,
          sourceSpan,
          items: remapMathHListItemsSourceSpan(item.items, sourceSpan),
        };
      }
      return {
        ...item,
        sourceSpan,
      };
    }),
  };
}

function remapMathHListItemsSourceSpan(
  items: readonly TexMathHListItem[],
  sourceSpan: TexMathSourceSpan
): readonly TexMathHListItem[] {
  return items.map((item): TexMathHListItem => {
    if (item.kind === "hlist") {
      return {
        ...item,
        sourceSpan,
        items: remapMathHListItemsSourceSpan(item.items, sourceSpan),
      };
    }
    return {
      ...item,
      sourceSpan,
    };
  });
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
  const tagX = Math.max(0, roundTexPt(dimensions.targetWidth - tag.width));
  const rowRight = mathItemsRightEdge(rowItems);
  const width = Math.max(baseWidth, dimensions.targetWidth);
  const tagCollides = displayAlignmentRightTagMustShift(row.items, tag.width, dimensions) || rowRight > tagX;
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

function addGatherDisplayTag(
  row: TexMathChildHListLayoutItem,
  rowItems: readonly TexMathHListItem[],
  tag: TexMathHList | null,
  shiftTag: boolean | null,
  targetWidth: number
): Pick<TexMathHList, "width" | "height" | "depth" | "items"> {
  if (!tag) {
    return {
      width: targetWidth,
      height: row.height,
      depth: row.depth,
      items: rowItems,
    };
  }
  const tagX = Math.max(0, roundTexPt(targetWidth - tag.width));
  const rowRight = mathItemsRightEdge(rowItems);
  const tagCollides = shiftTag ?? rowRight > tagX;
  const tagRenderShiftY = tagCollides
    ? TEX_DISPLAY_ALIGNMENT_COLLIDING_TAG_SHIFT_PT
    : 0;
  const depth = tagCollides
    ? Math.max(
        row.depth,
        TEX_DISPLAY_ALIGNMENT_COLLIDING_TAG_SHIFT_PT +
          TEX_DISPLAY_ALIGNMENT_STANDARD_ROW_DEPTH_PT
      )
    : row.depth;
  return {
    width: targetWidth,
    height: row.height,
    depth: roundTexPt(depth),
    items: [
      ...rowItems,
      ...offsetMathHListItems(tag.items, tagX, tagRenderShiftY),
    ],
  };
}

function multlineRightTagCollides(
  rowWidth: number,
  tagWidth: number,
  targetWidth: number
): boolean {
  return rowWidth + tagWidth + TEX_MULTLINE_TAG_GAP_PT > targetWidth;
}

function addMultlineDisplayTag(
  row: TexMathChildHListLayoutItem,
  rowItems: readonly TexMathHListItem[],
  tag: TexMathHList,
  targetWidth: number,
  shiftTag: boolean,
  tagLineDepth = row.depth
): Pick<TexMathHList, "width" | "height" | "depth" | "items"> {
  const tagX = Math.max(0, roundTexPt(targetWidth - tag.width));
  const tagRenderShiftY = shiftTag
    ? displayAlignmentShiftedTagRenderShift(tagLineDepth)
    : 0;
  const tagMetricShiftY = shiftTag
    ? displayAlignmentShiftedTagMetricShift(row.depth, tagLineDepth)
    : 0;
  return {
    width: Math.max(targetWidth, mathItemsRightEdge(rowItems), roundTexPt(tagX + tag.width)),
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
  readonly maxColumnWidths: readonly number[];
}

function displayAlignmentDimensions(params: {
  readonly measuredWidth: number;
  readonly mode: "centered" | "flush";
  readonly pairCount: number;
  readonly rowCount: number;
  readonly rows: readonly TexMathChildHListLayoutItem[];
  readonly rowTagWidths: readonly number[];
  readonly targetWidth: number;
}): TexDisplayAlignmentDimensions {
  const alignSepCount = Math.max(0, params.pairCount - 1);
  const maxColumnWidths = displayAlignmentMaxColumnWidths(params.rows);
  const fixedPairGapWidth = alignSepCount * TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT;
  const trailingWidth = params.rowCount === 1
    ? TEX_DISPLAY_ALIGNMENT_SINGLE_ROW_TRAILING_WIDTH_PT
    : 0;
  const totalFieldWidth = roundTexPt(Math.max(
    0,
    params.measuredWidth - fixedPairGapWidth - trailingWidth
  ));
  if (params.mode === "flush" && params.pairCount > 1) {
    let alignSep = roundTexPt((params.targetWidth - totalFieldWidth) / alignSepCount);
    if (alignSep < TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT) {
      alignSep = TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT;
    }
    return {
      eqnShift: 0,
      alignSep,
      pairCount: params.pairCount,
      maxColumnWidths,
      rowWidth: roundTexPt(totalFieldWidth + alignSepCount * alignSep),
      targetWidth: params.targetWidth,
    };
  }

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
  if (params.rowTagWidths.some((width) => width > 0)) {
    ({ eqnShift, alignSep } = applyAmsmathCenteredRightTagClearance({
      eqnShift,
      alignSep,
      pairCount: params.pairCount,
      maxColumnWidths,
      rows: params.rows,
      rowTagWidths: params.rowTagWidths,
      targetWidth: params.targetWidth,
    }));
  }
  return {
    eqnShift,
    alignSep,
    pairCount: params.pairCount,
    maxColumnWidths,
    rowWidth: roundTexPt(eqnShift + totalFieldWidth + alignSepCount * alignSep),
    targetWidth: params.targetWidth,
  };
}

function applyAmsmathCenteredRightTagClearance(params: {
  readonly eqnShift: number;
  readonly alignSep: number;
  readonly pairCount: number;
  readonly maxColumnWidths: readonly number[];
  readonly rows: readonly TexMathChildHListLayoutItem[];
  readonly rowTagWidths: readonly number[];
  readonly targetWidth: number;
}): { readonly eqnShift: number; readonly alignSep: number } {
  let eqnShift = params.eqnShift;
  let alignSep = params.alignSep;
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
    const rowWidthBeforeTag = amsmathRightTagRowWidth(fieldWidths, params.maxColumnWidths);
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

function displayAlignmentRightTagMustShift(
  rowItems: readonly TexMathHListItem[],
  tagWidth: number,
  dimensions: TexDisplayAlignmentDimensions
): boolean {
  if (tagWidth <= 0) {
    return false;
  }
  const alignSepCount = Math.max(0, dimensions.pairCount - 1);
  const fieldWidths = displayAlignmentFieldWidths(rowItems);
  const rowPairIndex = Math.floor(Math.max(0, fieldWidths.length - 1) / 2);
  const rowAlignSepCount = Math.min(alignSepCount, rowPairIndex);
  const rowWidthBeforeTag = amsmathRightTagRowWidth(fieldWidths, dimensions.maxColumnWidths);
  const equationAndTagWidth = roundTexPt(rowWidthBeforeTag + tagWidth);
  const minimumClearanceWidth = roundTexPt(
    equationAndTagWidth +
    rowAlignSepCount * TEX_DISPLAY_ALIGNMENT_MIN_ALIGN_SEP_PT +
    2 * TEX_DISPLAY_ALIGNMENT_MIN_TAG_SEP_PT
  );
  return minimumClearanceWidth > dimensions.targetWidth;
}

function displayAlignmentOverfullBodyWidth(
  rows: readonly TexMathChildHListLayoutItem[],
  dimensions: TexDisplayAlignmentDimensions,
  includeRow: (rowIndex: number) => boolean
): number {
  const includedBodyWidth = roundTexPt(Math.max(
    dimensions.targetWidth,
    ...rows.map((row, rowIndex) =>
      includeRow(rowIndex)
        ? mathItemsRightEdge(displayAlignmentRowItems(row.items, dimensions))
        : dimensions.targetWidth
    )
  ));
  if (includedBodyWidth <= dimensions.targetWidth + TEX_DISPLAY_ALIGNMENT_OVERFULL_BODY_TOLERANCE_PT) {
    return dimensions.targetWidth;
  }
  return roundTexPt(Math.max(
    includedBodyWidth,
    ...rows.map((row) =>
      mathItemsRightEdge(displayAlignmentRowItems(row.items, dimensions))
    )
  ));
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

function mathItemsLeftEdge(items: readonly TexMathHListItem[]): number {
  if (items.length === 0) {
    return 0;
  }
  let left = Number.POSITIVE_INFINITY;
  for (const item of items) {
    left = Math.min(left, item.x);
  }
  return roundTexPt(Number.isFinite(left) ? left : 0);
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
