import type { MeasurementService } from "../knuth-plass/paragraph/measure.js";
import type {
  AnyWrapper,
  BreakRef,
  MathRun,
  ParagraphRun,
  PenaltyRun,
  SpaceRun,
  TextRun,
} from "../knuth-plass/paragraph/types.js";
import { roundTexPt, tfmToPt } from "./fonts/units.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexGlyphBox,
  TexKern,
  TexMetricProvider,
} from "./fonts/types.js";
import type { TexLayoutInlineItem } from "./layout-inline-items.js";
import type { TexMathBox } from "./layout-inline-items.js";
import type { TexMathHList, TexMathHListItem } from "./math/layout.js";
import { texInterwordGlueForSpaceFactor } from "./space-glue.js";

export interface TexParagraphRunsLayout {
  readonly runs: ParagraphRun[];
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
}

export interface TexParagraphRunAdapter {
  readonly measurement: MeasurementService;
  readonly layoutItemsToRuns: (
    items: readonly TexLayoutInlineItem[]
  ) => TexParagraphRunsLayout;
}

export function createTexParagraphRunAdapter(
  font: ResolvedTexFont,
  metricProvider: TexMetricProvider
): TexParagraphRunAdapter {
  const syntheticWrapper: AnyWrapper = {};
  const shapedRunByWrapper = new WeakMap<object, ShapedTexTextRun>();

  const shapedRunForWrapper = (
    wrapper: AnyWrapper | null | undefined
  ): ShapedTexTextRun | null =>
    wrapper && typeof wrapper === "object" ? shapedRunByWrapper.get(wrapper) ?? null : null;

  return {
    measurement: createTexParagraphMeasurement(font, metricProvider, shapedRunForWrapper),
    layoutItemsToRuns: (items) =>
      layoutItemsToRuns(items, metricProvider, syntheticWrapper, shapedRunByWrapper),
  };
}

function layoutItemsToRuns(
  items: readonly TexLayoutInlineItem[],
  metricProvider: TexMetricProvider,
  syntheticWrapper: AnyWrapper,
  shapedRunByWrapper: WeakMap<object, ShapedTexTextRun>
): TexParagraphRunsLayout {
  const runs: ParagraphRun[] = [];
  const shapedRuns = new Map<number, ShapedTexTextRun>();
  let pendingItalicCorrection = 0;
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const runIndex = runs.length;
    if (item.kind === "text") {
      const nextItem = items[itemIndex + 1];
      const shapedBase = metricProvider.shapeText(item.text, item.font, {
        sourceStart: item.sourceStart,
      });
      const correction = item.italicCorrectionAfter
        ? trailingItalicCorrectionWidth(shapedBase)
        : 0;
      const moveCorrectionToSpace =
        correction > 0 &&
        nextItem?.kind === "space";
      const shaped = withTrailingItalicCorrection(
        shapedBase,
        correction,
        !moveCorrectionToSpace
      );
      pendingItalicCorrection = moveCorrectionToSpace ? correction : 0;
      const wrapper: AnyWrapper = {};
      shapedRunByWrapper.set(wrapper, shaped);
      shapedRuns.set(runIndex, shaped);
      runs.push({
        kind: "text",
        runIndex,
        role: item.role,
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
        text: item.text,
        wrapper,
        childIndex: runIndex,
        wordIndex: 0,
      } satisfies TextRun);
      continue;
    }

    if (item.kind === "math") {
      pendingItalicCorrection = 0;
      const fragments = mathBoxFragments(item.box);
      if (fragments.length > 1) {
        for (const [fragmentIndex, fragment] of fragments.entries()) {
          const fragmentRunIndex = runs.length;
          runs.push(mathRunForBox(
            fragment.box,
            fragmentRunIndex,
            item.role,
            fragment.sourceStart,
            fragment.sourceEnd
          ));
          if (fragmentIndex < fragments.length - 1 && fragment.breakAfter) {
            const breakRunIndex = runs.length;
            runs.push(mathBreakpointRun(
              breakRunIndex,
              item.role,
              fragment.breakAfter.sourceOffset,
              fragment.breakAfter.penalty
            ));
            if (fragment.breakAfter.postBreakGlue) {
              const glueRunIndex = runs.length;
              runs.push(mathGlueRun(
                glueRunIndex,
                item.role,
                fragment.breakAfter.sourceOffset,
                fragment.breakAfter.postBreakGlue
              ));
            }
          }
        }
        continue;
      }
      const wrapper: AnyWrapper = {
        getBBox: () => ({
          L: 0,
          R: 0,
          w: item.box.width,
          h: item.box.height,
          d: item.box.depth,
        }),
        getOuterBBox: () => ({
          L: 0,
          R: 0,
          w: item.box.width,
          h: item.box.height,
          d: item.box.depth,
        }),
        texMathBox: item.box,
      };
      runs.push({
        kind: "math",
        runIndex,
        role: item.role,
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
        wrapper,
        texGlue: {
          stretch: item.box.stretch ?? 0,
          shrink: item.box.shrink ?? 0,
        },
      } satisfies MathRun);
      continue;
    }

    if (item.kind === "text-box") {
      pendingItalicCorrection = 0;
      runs.push(mathRunForBox(
        item.box,
        runIndex,
        item.role,
        item.sourceStart,
        item.sourceEnd
      ));
      continue;
    }

    if (item.kind === "penalty") {
      pendingItalicCorrection = 0;
      runs.push({
        kind: "penalty",
        runIndex,
        role: item.role,
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
        penalty: item.penalty,
      } satisfies PenaltyRun);
      continue;
    }

    const forced = item.kind === "forced-break";
    const baseGlue = forced
      ? { width: 0, stretch: 0, shrink: 0 }
      : texInterwordGlueForSpaceFactor(
        item.font,
        item.spaceFactor,
        item.spaceGlueProfile
      );
    const glue = pendingItalicCorrection > 0 && !forced
      ? { ...baseGlue, width: roundTexPt(baseGlue.width + pendingItalicCorrection) }
      : baseGlue;
    pendingItalicCorrection = 0;
    runs.push({
      kind: "space",
      runIndex,
      role: item.role,
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
      text: " ",
      wrapper: syntheticWrapper,
      breakRef: createSimpleBreakRef(
        syntheticWrapper,
        forced,
        forced ? item.lineLeading : undefined
      ),
      texGlue: glue,
    } satisfies SpaceRun);
  }
  return { runs, shapedRuns };
}

function mathRunForBox(
  box: TexMathBox,
  runIndex: number,
  role: TexLayoutInlineItem["role"],
  sourceStart: number,
  sourceEnd: number
): MathRun {
  const wrapper: AnyWrapper = {
    getBBox: () => ({
      L: 0,
      R: 0,
      w: box.width,
      h: box.height,
      d: box.depth,
    }),
    getOuterBBox: () => ({
      L: 0,
      R: 0,
      w: box.width,
      h: box.height,
      d: box.depth,
    }),
    texMathBox: box,
  };
  return {
    kind: "math",
    runIndex,
    role,
    sourceStart,
    sourceEnd,
    wrapper,
    texGlue: {
      stretch: box.stretch ?? 0,
      shrink: box.shrink ?? 0,
    },
  };
}

function mathBreakpointRun(
  runIndex: number,
  role: TexLayoutInlineItem["role"],
  sourceOffset: number,
  breakPenalty: number
): PenaltyRun {
  return {
    kind: "penalty",
    runIndex,
    role,
    sourceStart: sourceOffset,
    sourceEnd: sourceOffset,
    penalty: breakPenalty,
  };
}

function mathGlueRun(
  runIndex: number,
  role: TexLayoutInlineItem["role"],
  sourceOffset: number,
  glue: { readonly width: number; readonly stretch: number; readonly shrink: number }
): SpaceRun {
  const wrapper: AnyWrapper = { texMathGlueSpace: true };
  return {
    kind: "space",
    runIndex,
    role,
    sourceStart: sourceOffset,
    sourceEnd: sourceOffset,
    text: " ",
    wrapper,
    breakRef: {
      kind: "mspace",
      wrapper,
    },
    texGlue: {
      width: glue.width,
      stretch: glue.stretch,
      shrink: glue.shrink,
      breakPenalty: 10_000,
    },
  };
}

interface TexMathBoxFragment {
  readonly box: TexMathBox;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly breakAfter?: {
    readonly sourceOffset: number;
    readonly penalty: number;
    readonly postBreakGlue?: {
      readonly width: number;
      readonly stretch: number;
      readonly shrink: number;
    };
  };
}

function mathBoxFragments(box: TexMathBox): readonly TexMathBoxFragment[] {
  const contentStart = box.contentStart;
  const contentEnd = box.contentEnd;
  const breakpoints = (box.breakpoints ?? [])
    .filter((breakpoint) =>
      Number.isFinite(breakpoint.x) &&
      breakpoint.x > 0 &&
      breakpoint.x < box.width &&
      breakpoint.sourceOffset > contentStart &&
      breakpoint.sourceOffset < contentEnd
    )
    .sort((a, b) => a.x - b.x);
  if (breakpoints.length === 0) {
    return [{ box, sourceStart: contentStart, sourceEnd: contentEnd }];
  }

  const fragments: TexMathBoxFragment[] = [];
  let previousX = 0;
  let previousSource = contentStart;
  for (const breakpoint of breakpoints) {
    const fragment = mathBoxFragment(box, previousX, breakpoint.x, previousSource, breakpoint.sourceOffset);
    if (fragment) {
      fragments.push({
        box: fragment,
        sourceStart: previousSource,
        sourceEnd: breakpoint.sourceOffset,
        breakAfter: {
          sourceOffset: breakpoint.sourceOffset,
          penalty: breakpoint.penalty,
          postBreakGlue: breakpoint.postBreakGlue,
        },
      });
    }
    previousX = roundTexPt(breakpoint.x + (breakpoint.postBreakGlue?.width ?? 0));
    previousSource = breakpoint.sourceOffset;
  }

  const tail = mathBoxFragment(box, previousX, box.width, previousSource, contentEnd);
  if (tail) {
    fragments.push({
      box: tail,
      sourceStart: previousSource,
      sourceEnd: contentEnd,
    });
  }

  return fragments.length > 1
    ? fragments
    : [{ box, sourceStart: contentStart, sourceEnd: contentEnd }];
}

function mathBoxFragment(
  box: TexMathBox,
  xStart: number,
  xEnd: number,
  sourceStart: number,
  sourceEnd: number
): TexMathBox | null {
  const width = roundTexPt(xEnd - xStart);
  if (width <= 0) {
    return null;
  }
  return {
    ...box,
    rootBox: box.rootBox ?? box,
    content: box.source.slice(
      Math.max(0, sourceStart - box.sourceStart),
      Math.max(0, sourceEnd - box.sourceStart)
    ),
    sourceStart,
    sourceEnd,
    contentStart: sourceStart,
    contentEnd: sourceEnd,
    width,
    stretch: fragmentMathFlex(box, xStart, xEnd, "stretch"),
    shrink: fragmentMathFlex(box, xStart, xEnd, "shrink"),
    caretStops: fragmentMathCaretStops(box, xStart, xEnd, sourceStart, sourceEnd),
    constructRanges: fragmentMathConstructRanges(box, xStart, xEnd),
    breakpoints: fragmentMathBreakpoints(box, xStart, xEnd),
    svgBody: box.svgBody && !box.hlist ? fragmentMathSvgBody(box, xStart, xEnd) : undefined,
    hlist: box.hlist ? fragmentMathHList(box.hlist, xStart, xEnd, width, sourceStart, sourceEnd) : undefined,
  };
}

function fragmentMathFlex(
  box: TexMathBox,
  xStart: number,
  xEnd: number,
  key: "stretch" | "shrink"
): number | undefined {
  const value = roundTexPt(
    mathFlexAtX(box, xEnd, key) - mathFlexAtX(box, xStart, key)
  );
  return value > 0 ? value : undefined;
}

function mathFlexAtX(
  box: TexMathBox,
  x: number,
  key: "stretch" | "shrink"
): number {
  const total = box[key] ?? 0;
  if (x <= 0 || total <= 0) {
    return 0;
  }
  if (x >= box.width) {
    return total;
  }
  const breakpoint = box.breakpoints?.find((candidate) =>
    Math.abs(candidate.x - x) < 1e-6
  );
  if (breakpoint) {
    return key === "stretch"
      ? breakpoint.stretchBefore ?? 0
      : breakpoint.shrinkBefore ?? 0;
  }
  const postBreakGlueBoundary = box.breakpoints?.find((candidate) =>
    candidate.postBreakGlue &&
    Math.abs(candidate.x + candidate.postBreakGlue.width - x) < 1e-6
  );
  if (postBreakGlueBoundary?.postBreakGlue) {
    const before = key === "stretch"
      ? postBreakGlueBoundary.stretchBefore ?? 0
      : postBreakGlueBoundary.shrinkBefore ?? 0;
    const glue = key === "stretch"
      ? postBreakGlueBoundary.postBreakGlue.stretch
      : postBreakGlueBoundary.postBreakGlue.shrink;
    return roundTexPt(before + glue);
  }
  if (box.width <= 0) {
    return 0;
  }
  const ratio = Math.max(0, Math.min(1, x / box.width));
  return roundTexPt(total * ratio);
}

function fragmentMathCaretStops(
  box: TexMathBox,
  xStart: number,
  xEnd: number,
  sourceStart: number,
  sourceEnd: number
): readonly number[] {
  const length = Math.max(0, sourceEnd - sourceStart);
  if (!box.caretStops?.length) {
    return [0, roundTexPt(xEnd - xStart)];
  }
  return Array.from({ length: length + 1 }, (_, offset) => {
    const rawOffset = sourceStart + offset;
    const originalIndex = rawOffset - box.sourceStart;
    const originalStop = box.caretStops?.[originalIndex] ?? xStart;
    return roundTexPt(Math.max(0, Math.min(xEnd - xStart, originalStop - xStart)));
  });
}

function fragmentMathConstructRanges(
  box: TexMathBox,
  xStart: number,
  xEnd: number
): TexMathBox["constructRanges"] {
  return box.constructRanges
    ?.map((range) => ({
      ...range,
      xStart: roundTexPt(Math.max(0, range.xStart - xStart)),
      xEnd: roundTexPt(Math.min(xEnd - xStart, range.xEnd - xStart)),
    }))
    .filter((range) => range.xEnd > range.xStart);
}

function fragmentMathBreakpoints(
  box: TexMathBox,
  xStart: number,
  xEnd: number
): TexMathBox["breakpoints"] {
  return box.breakpoints
    ?.filter((breakpoint) => breakpoint.x > xStart && breakpoint.x <= xEnd)
    .map((breakpoint) => ({
      ...breakpoint,
      x: roundTexPt(Math.max(0, Math.min(xEnd - xStart, breakpoint.x - xStart))),
    }));
}

function fragmentMathHList(
  hlist: TexMathHList,
  xStart: number,
  xEnd: number,
  width: number,
  sourceStart: number,
  sourceEnd: number
): TexMathHList {
  return {
    ...hlist,
    width,
    items: fragmentMathHListItems(
      hlist.items,
      xStart,
      xEnd,
      -xStart,
      sourceStart,
      sourceEnd
    ),
  };
}

function fragmentMathHListItems(
  items: readonly TexMathHListItem[],
  xStart: number,
  xEnd: number,
  xOffset: number,
  sourceStart: number,
  sourceEnd: number
): readonly TexMathHListItem[] {
  return items.flatMap((item): TexMathHListItem[] => {
    const itemStart = item.x;
    const itemEnd = item.x + item.width;
    if (itemEnd <= xStart || itemStart >= xEnd) {
      return [];
    }
    if (item.kind !== "hlist") {
      if (!mathSourceSpanOverlaps(item.sourceSpan.start, item.sourceSpan.end, sourceStart, sourceEnd)) {
        return [];
      }
      return [{
        ...item,
        x: roundTexPt(item.x + xOffset),
      }];
    }
    const childItems = fragmentMathHListItems(
      item.items,
      xStart - item.x,
      xEnd - item.x,
      0,
      sourceStart,
      sourceEnd
    );
    if (childItems.length === 0) {
      return [];
    }
    return [{
      ...item,
      x: roundTexPt(item.x + xOffset),
      items: childItems,
    }];
  });
}

function mathSourceSpanOverlaps(
  itemStart: number,
  itemEnd: number,
  sourceStart: number,
  sourceEnd: number
): boolean {
  if (itemEnd < itemStart) {
    return false;
  }
  if (itemStart === itemEnd) {
    return itemStart >= sourceStart && itemStart <= sourceEnd;
  }
  return itemStart < sourceEnd && itemEnd > sourceStart;
}

function fragmentMathSvgBody(
  box: TexMathBox,
  xStart: number,
  xEnd: number
): string | undefined {
  if (!box.svgBody) {
    return undefined;
  }
  const width = roundTexPt(xEnd - xStart);
  const yStart = -roundTexPt(box.height + 2) * 100;
  const height = roundTexPt(box.height + box.depth + 4) * 100;
  return [
    `<svg data-tex-math-fragment="true" x="0" y="${formatMathSvgNumber(yStart)}"`,
    ` width="${formatMathSvgNumber(width * 100)}" height="${formatMathSvgNumber(height)}"`,
    ` viewBox="${formatMathSvgNumber(xStart * 100)} ${formatMathSvgNumber(yStart)} ${formatMathSvgNumber(width * 100)} ${formatMathSvgNumber(height)}"`,
    ` overflow="hidden">`,
    box.svgBody,
    `</svg>`,
  ].join("");
}

function formatMathSvgNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number(value.toFixed(6)).toString();
}

function withTrailingItalicCorrection(
  shaped: ShapedTexTextRun,
  correction: number,
  enabled: boolean
): ShapedTexTextRun {
  if (!enabled || correction <= 0) {
    return shaped;
  }

  const width = roundTexPt(shaped.width + correction);
  const caretStops = [...shaped.caretStops];
  caretStops[caretStops.length - 1] = width;
  const sourceCaretStops = [...shaped.sourceCaretStops];
  sourceCaretStops[sourceCaretStops.length - 1] = {
    sourceOffset: shaped.sourceEnd,
    x: width,
  };
  return {
    ...shaped,
    width,
    items: [
      ...shaped.items,
      {
        kind: "kern",
        sourceStart: shaped.sourceEnd,
        sourceEnd: shaped.sourceEnd,
        width: correction,
      } satisfies TexKern,
    ],
    caretStops,
    sourceCaretStops,
  };
}

function trailingItalicCorrectionWidth(shaped: ShapedTexTextRun): number {
  return findLastTexGlyph(shaped.items)?.italicCorrection ?? 0;
}

function findLastTexGlyph(items: readonly ShapedTexTextRun["items"][number][]): TexGlyphBox | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "glyph") {
      return item;
    }
  }
  return null;
}

function createSimpleBreakRef(
  wrapper: AnyWrapper,
  forced: boolean,
  lineLeading?: string
): BreakRef {
  return {
    kind: "mspace",
    wrapper,
    linebreak: forced ? "newline" : "auto",
    isForcedLineBreak: forced,
    lineLeading,
  };
}

function createTexParagraphMeasurement(
  font: ResolvedTexFont,
  metricProvider: TexMetricProvider,
  shapedRunForWrapper: (wrapper: AnyWrapper | null | undefined) => ShapedTexTextRun | null
): MeasurementService {
  const spaceWidth = tfmToPt(font, font.data.fontdimen.space);
  const sliceWidthCache = new Map<string, number>();
  const measureTexSlice = (
    word: string,
    start: number,
    end: number,
    wrapper?: AnyWrapper | null
  ): number => {
    assertTexSliceRange(word, start, end, "measureTexSlice");
    const shaped = shapedRunForWrapper(wrapper);
    if (end <= start) {
      return 0;
    }
    if (shaped) {
      const startX = shaped.caretStops[start];
      const endX = shaped.caretStops[end];
      if (startX === undefined || endX === undefined) {
        throw new Error(`Missing TeX caret stop for slice ${start}:${end}.`);
      }
      return roundTexPt(endX - startX);
    }
    const sliceFont = font;
    const key = `${sliceFont.id}:${start}:${end}:${word}`;
    const cached = sliceWidthCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const width = metricProvider.shapeText(
      word.slice(start, end),
      sliceFont
    ).width;
    sliceWidthCache.set(key, width);
    return width;
  };
  const measureTexHyphenatedPrefix = (
    word: string,
    start: number,
    end: number,
    hyphen: string,
    wrapper?: AnyWrapper | null
  ): number => {
    assertTexSliceRange(word, start, end, "measureTexHyphenatedPrefix");
    const sliceFont = shapedRunForWrapper(wrapper)?.font ?? font;
    const prefixWidth = measureTexSlice(word, start, end, wrapper);
    const prefix = word.slice(start, end);
    return roundTexPt(
      metricProvider.shapeText(prefix + hyphen, sliceFont).width - prefixWidth
    );
  };
  const measureTexDiscretionary = (
    word: string,
    start: number,
    end: number,
    hyphen: string,
    wrapper: AnyWrapper | null | undefined
  ) => {
    assertTexSliceRange(word, start, end, "measureTexDiscretionary");
    const shaped = shapedRunForWrapper(wrapper);
    const runFont = shaped?.font ?? font;
    const simpleInsertedWidth = measureTexHyphenatedPrefix(
      word,
      start,
      end,
      hyphen,
      wrapper
    );
    const absoluteEnd = (shaped?.sourceStart ?? 0) + end;
    const ligature = shaped?.items.find((item): item is TexGlyphBox =>
      item.kind === "glyph" &&
      item.components.length > 1 &&
      item.sourceStart < absoluteEnd &&
      item.sourceEnd > absoluteEnd
    );

    if (!shaped || !ligature) {
      return {
        preBreakText: hyphen,
        postBreakText: "",
        replaceText: "",
        replaceStart: end,
        replaceEnd: end,
        preBreakWidth: simpleInsertedWidth,
        sourcePrefixWidth: 0,
        insertedWidth: simpleInsertedWidth,
      };
    }

    const replaceStart = Math.max(0, ligature.sourceStart - shaped.sourceStart);
    const replaceEnd = Math.min(word.length, ligature.sourceEnd - shaped.sourceStart);
    const sourcePrefix = word.slice(replaceStart, end);
    const preBreakText = `${sourcePrefix}${hyphen}`;
    const sourcePrefixWidth = measureTexSlice(word, replaceStart, end, wrapper);
    const preBreakWidth = metricProvider.shapeText(preBreakText, runFont).width;
    const postBreakText = word.slice(end, replaceEnd);
    const postBreakWidth = metricProvider.shapeText(postBreakText, runFont).width;
    const replaceText = word.slice(replaceStart, replaceEnd);
    const replaceWidth = metricProvider.shapeText(replaceText, runFont).width;

    return {
      preBreakText,
      postBreakText,
      replaceText,
      replaceStart,
      replaceEnd,
      preBreakWidth,
      sourcePrefixWidth,
      insertedWidth: roundTexPt(preBreakWidth + postBreakWidth - replaceWidth),
    };
  };
  return {
    measureText: (value) => value === " " ? spaceWidth : metricProvider.shapeText(value, font).width,
    measureWord: (word, wrapper) => shapedRunForWrapper(wrapper)?.width ?? metricProvider.shapeText(word, font).width,
    measureMath: (wrapper) => {
      const bbox =
        wrapper && typeof wrapper === "object" && typeof wrapper.getOuterBBox === "function"
          ? wrapper.getOuterBBox()
          : wrapper && typeof wrapper === "object" && typeof wrapper.getBBox === "function"
            ? wrapper.getBBox()
            : null;
      return roundTexPt(
        (Number(bbox?.L) || 0) +
        (Number(bbox?.w) || 0) +
        (Number(bbox?.R) || 0)
      );
    },
    measurePrefix: (word, end, wrapper) => {
      assertTexSliceRange(word, 0, end, "measurePrefix");
      const shaped = shapedRunForWrapper(wrapper);
      if (!shaped) {
        return metricProvider.shapeText(word.slice(0, end), font).width;
      }
      const stop = shaped.caretStops[end];
      if (stop === undefined) {
        throw new Error(`Missing TeX caret stop for prefix ${end}.`);
      }
      return stop;
    },
    measureSlice: (word, start, end, wrapper) => measureTexSlice(word, start, end, wrapper),
    measureHyphenatedPrefix: (word, start, end, hyphen, wrapper) =>
      measureTexHyphenatedPrefix(word, start, end, hyphen, wrapper),
    measureDiscretionary: (word, start, end, hyphen, wrapper) =>
      measureTexDiscretionary(word, start, end, hyphen, wrapper),
    precomputeWord: () => {},
    primeRuns: () => {},
    getStats: () => ({ textCacheEntries: 0, wordPrefixEntries: 0, mathCacheEntries: 0 }),
  };
}

function assertTexSliceRange(
  word: string,
  start: number,
  end: number,
  context: string
): void {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end > word.length
  ) {
    throw new Error(
      `${context} received out-of-range TeX slice ${start}:${end} for word length ${word.length}.`
    );
  }
}
