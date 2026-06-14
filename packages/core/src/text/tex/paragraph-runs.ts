import type { MeasurementService } from "../knuth-plass/paragraph/measure.js";
import type {
  AnyWrapper,
  BreakRef,
  MathRun,
  ParagraphRun,
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
      } satisfies MathRun);
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
