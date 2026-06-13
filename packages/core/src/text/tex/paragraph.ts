import { englishDefaults } from "../knuth-plass/languages/en.js";
import type { ParagraphAlignment } from "../knuth-plass/alignment.js";
import { createEnglishHyphenator, type Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import { breakWithDp, type DpOptions } from "../knuth-plass/paragraph/dp.js";
import { runsToItems } from "../knuth-plass/paragraph/items.js";
import type { MeasurementService } from "../knuth-plass/paragraph/measure.js";
import type { LineReport, ParagraphLayoutReport } from "../knuth-plass/paragraph/report.js";
import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type {
  AnyWrapper,
  BreakDecision,
  BreakRef,
  GreedyLine,
  ParagraphRun,
  SpaceRun,
  TextRun,
} from "../knuth-plass/paragraph/types.js";
import { computerModernTexMetricProvider } from "./fonts/computer-modern.js";
import { roundTexPt, tfmToPt } from "./fonts/units.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
  TexGlyphBox,
  TexKern,
} from "./fonts/types.js";
import {
  analyzeSimpleTexParagraph,
  type TexAlignmentProfile,
  type TexSpaceGlueProfile,
} from "./ir.js";
import {
  createSimpleTexLayoutDocumentIr,
  type TexLayoutLabel,
  texLayoutGlyphItemDepth,
  texLayoutGlyphItemHeight,
  texLayoutGlyphItemWidth,
  type TexLayoutInlineItem,
  type TexLayoutLabelItem,
  type TexLayoutParagraphIr,
} from "./layout-ir.js";
import {
  layoutTexVListFromParagraphReport,
  type TexVListLayout,
} from "./vlist/index.js";

export type TexParagraphAlignment = ParagraphAlignment;
export { analyzeSimpleTexParagraph, getSimpleTexFallbackReason } from "./ir.js";

export interface TexParagraphLayoutOptions {
  readonly paragraphId?: string;
  readonly width: number;
  readonly alignment?: TexParagraphAlignment;
  readonly font?: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly tolerance?: number;
  readonly pretolerance?: number;
  readonly parindent?: number;
  readonly tikzTextWidthNode?: boolean;
  readonly fallbackPolicy?: "whole-node" | "placeholder";
  readonly hyphenator?: Hyphenator | null;
}

export interface TexParagraphLayoutResult {
  readonly supported: boolean;
  readonly report: ParagraphLayoutReport | null;
  readonly vlistLayout?: TexVListLayout;
  readonly fallbackReason: string | null;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly errors: readonly string[];
}

interface TexParagraphBreakResult {
  readonly lines: readonly GreedyLine[];
  readonly runs: readonly ParagraphRun[];
  readonly runWidths: ReadonlyMap<number, number>;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly errors: readonly string[];
  readonly linebreakingMode: "feasible" | "overfull";
}

interface TexLineLabel {
  readonly label: TexLayoutLabel;
  readonly lineRunIndex: number;
}

interface TexParagraphDpOptionParams {
  readonly options: TexParagraphLayoutOptions;
  readonly alignment: TexParagraphAlignment;
  readonly noIndent: boolean;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment?: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly quoteContextActive: boolean;
  readonly listContextActive: boolean;
}

const LATEX_RAGGED_FINAL_HYPHEN_DEMERITS = 0;
const LATEX_PARBOX_SLOPPY_TOLERANCE = 9999;
const LATEX_PARBOX_SLOPPY_EMERGENCY_STRETCH_EM = 3;
const LATEX_NORMAL_BASELINESKIP_EM = 1.2;
const LATEX_NORMAL_STRUT_HEIGHT_EM = 0.85;

// Boundary adapter for the legacy Knuth-Plass run model: text runs carry a
// wrapper identity, while the TeX path owns the shaped run data directly.
const syntheticWrapper: AnyWrapper = {};
const shapedRunByWrapper = new WeakMap<object, ShapedTexTextRun>();

export function layoutSimpleTexParagraph(
  text: string,
  options: TexParagraphLayoutOptions
): TexParagraphLayoutResult {
  const analysis = analyzeSimpleTexParagraph(text, options.width);
  const fallbackReason = analysis.fallbackReason;
  const usePlaceholderFallback =
    fallbackReason !== null &&
    options.fallbackPolicy === "placeholder" &&
    analysis.ir?.partialFallbackSupported === true;
  if (fallbackReason && !usePlaceholderFallback) {
    return {
      supported: false,
      report: null,
      fallbackReason,
      shapedRuns: new Map(),
      errors: [fallbackReason],
    };
  }

  const metricProvider = options.metricProvider ?? computerModernTexMetricProvider;
  const font = options.font ?? metricProvider.resolveFont();
  const layoutOptions: TexParagraphLayoutOptions = { ...options, font, metricProvider };
  const paragraphId = options.paragraphId ?? "tex:paragraph";
  const defaultAlignment = options.alignment ?? "ragged-right";
  const shapedRuns = new Map<number, ShapedTexTextRun>();
  const blocks = analysis.ir?.blocks ?? [];
  if (blocks.length === 0) {
    const reason = "Paragraph contains no text runs.";
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns,
      errors: [reason],
    };
  }

  const measurement = createTexParagraphMeasurement(font, metricProvider);
  const layoutIr = createSimpleTexLayoutDocumentIr({
    blocks,
    items: analysis.ir?.items,
    defaultAlignment,
    font,
    metricProvider,
    options: layoutOptions,
  });
  const combinedRuns: ParagraphRun[] = [];
  const combinedLines: GreedyLine[] = [];
  const combinedRunWidths = new Map<number, number>();
  const combinedLineLabels = new Map<number, TexLineLabel>();
  const errors: string[] = usePlaceholderFallback && fallbackReason
    ? [fallbackReason]
    : [];
  let linebreakingMode: "feasible" | "overfull" = "feasible";
  let runIndexOffset = 0;
  let lineIndexOffset = 0;

  for (const paragraph of layoutIr.paragraphs) {
    const blockShapedRuns = new Map<number, ShapedTexTextRun>();
    const runs = layoutItemsToRuns(paragraph.items, blockShapedRuns, metricProvider);
    if (!runs.some((run) => run.kind === "text")) {
      continue;
    }

    const broken = breakTexParagraphRuns({
      runs,
      shapedRuns: blockShapedRuns,
      measurement,
      options: layoutOptions,
      alignment: paragraph.alignment,
      alignmentProfile: paragraph.alignmentProfile,
      inheritedAlignment: paragraph.inheritedAlignment,
      inheritedAlignmentProfile: paragraph.inheritedAlignmentProfile,
      noIndent: paragraph.noIndent,
      leftMarginWidth: paragraph.leftMarginWidth,
      rightMarginWidth: paragraph.rightMarginWidth,
      quoteContextActive: paragraph.quoteDepth > 0,
      listContextActive: paragraph.listContext !== undefined,
    });
    if (!broken) {
      return {
        supported: false,
        report: null,
        fallbackReason: "TeX paragraph breaker failed: no solution",
        shapedRuns,
        errors,
      };
    }

    for (const run of broken.runs) {
      combinedRuns.push(offsetRun(run, runIndexOffset));
    }
    for (const [runIndex, width] of broken.runWidths) {
      combinedRunWidths.set(runIndex + runIndexOffset, width);
    }
    for (const [runIndex, shaped] of broken.shapedRuns) {
      shapedRuns.set(runIndex + runIndexOffset, shaped);
    }
    for (const line of broken.lines) {
      const combinedLineIndex = line.lineIndex + lineIndexOffset;
      const forcedBreak =
        paragraph.forcedBreakAfter && line.lineIndex === broken.lines.length - 1
          ? createForcedBreakDecision(
              line.endRun + runIndexOffset + 1,
              paragraph.forcedBreakAfter
            )
          : undefined;
      if (line.lineIndex === 0 && paragraph.label) {
        combinedLineLabels.set(combinedLineIndex, {
          label: paragraph.label,
          lineRunIndex: line.startRun + runIndexOffset,
        });
      }
      combinedLines.push(offsetLine(
        line,
        runIndexOffset,
        lineIndexOffset,
        forcedBreak
      ));
    }
    errors.push(...broken.errors);
    if (broken.linebreakingMode === "overfull") {
      linebreakingMode = "overfull";
    }
    runIndexOffset += broken.runs.length;
    lineIndexOffset += broken.lines.length;
  }

  if (combinedRuns.length === 0 || combinedLines.length === 0) {
    const reason = "Paragraph contains no text runs.";
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns,
      errors: [...errors, reason],
    };
  }

  const report = buildTexParagraphReport({
    paragraphId,
    width: options.width,
    alignment: layoutIr.reportAlignment,
    runs: combinedRuns,
    lines: combinedLines,
    shapedRuns,
    runWidths: combinedRunWidths,
    lineLabels: combinedLineLabels,
    linebreakingMode,
    layoutMode: layoutIr.layoutMode,
    font,
    metricProvider,
    errors,
  });
  const firstLineAscent = Math.max(
    font.atPt * LATEX_NORMAL_STRUT_HEIGHT_EM,
    ...report.lines.map((line) => Number(line.ascent) || 0)
  );
  const vlistLayout = layoutTexVListFromParagraphReport(
    layoutIr.vlist,
    report,
    {
      width: options.width,
      lineHeight: font.atPt * LATEX_NORMAL_BASELINESKIP_EM,
      firstLineAscent,
    }
  );

  return {
    supported: true,
    report,
    vlistLayout,
    fallbackReason: null,
    shapedRuns,
    errors,
  };
}

function breakTexParagraphRuns(params: {
  readonly runs: ParagraphRun[];
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly measurement: MeasurementService;
  readonly options: TexParagraphLayoutOptions;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly noIndent: boolean;
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly quoteContextActive: boolean;
  readonly listContextActive: boolean;
}): TexParagraphBreakResult | null {
  const pass1Model = runsToItems(params.runs, params.measurement, {
    enableAutomaticHyphenation: false,
    hyphenator: null,
  });
  const dpOptions = texParagraphDpOptions({
    options: params.options,
    alignment: params.alignment,
    noIndent: params.noIndent,
    alignmentProfile: params.alignmentProfile,
    inheritedAlignment: params.inheritedAlignment,
    inheritedAlignmentProfile: params.inheritedAlignmentProfile,
    leftMarginWidth: params.leftMarginWidth,
    rightMarginWidth: params.rightMarginWidth,
    quoteContextActive: params.quoteContextActive,
    listContextActive: params.listContextActive,
  });
  const pass1 = breakWithDp(pass1Model, params.options.width, {
    ...dpOptions,
    tolerance: params.options.pretolerance ?? englishDefaults.pretolerance,
  });

  let selectedModel = pass1Model;
  let selectedPass = pass1;
  if (!dpPassHasLines(selectedPass)) {
    const pass2Model = runsToItems(params.runs, params.measurement, {
      hyphenator: params.options.hyphenator ?? createEnglishHyphenator(),
      enableAutomaticHyphenation: true,
      hyphenpenalty: englishDefaults.hyphenpenalty,
      exhyphenpenalty: englishDefaults.exhyphenpenalty,
    });
    selectedModel = pass2Model;
    const tolerance = params.options.tolerance ?? texParagraphTolerance();
    const emergencyStretch = texParagraphEmergencyStretch(params.options);
    const passConfigs: Array<DpOptions & { readonly tolerance: number }> = [
      { ...dpOptions, tolerance },
    ];
    if (emergencyStretch > 0) {
      passConfigs.push({ ...dpOptions, tolerance, emergencyStretch });
    }
    passConfigs.push({
      ...dpOptions,
      tolerance,
      emergencyStretch,
      allowLastResortOverfull: true,
    });
    for (const passOptions of passConfigs) {
      selectedPass = breakWithDp(pass2Model, params.options.width, passOptions);
      if (dpPassHasLines(selectedPass)) {
        break;
      }
    }
  }

  if (!dpPassHasLines(selectedPass)) {
    return null;
  }

  return {
    lines: selectedPass.lines,
    runs: params.runs,
    runWidths: selectedModel.runWidths,
    shapedRuns: params.shapedRuns,
    errors: [...selectedModel.errors, ...selectedPass.errors],
    linebreakingMode: selectedPass.mode,
  };
}

function dpPassHasLines(
  pass: ReturnType<typeof breakWithDp>
): pass is ReturnType<typeof breakWithDp> & { readonly canProceed: true } {
  return pass.canProceed && pass.lines.length > 0;
}

function offsetRun(run: ParagraphRun, runIndexOffset: number): ParagraphRun {
  if (run.kind === "text") {
    return {
      ...run,
      runIndex: run.runIndex + runIndexOffset,
      childIndex: run.childIndex + runIndexOffset,
    };
  }
  if (run.kind === "space") {
    return {
      ...run,
      runIndex: run.runIndex + runIndexOffset,
    };
  }
  return {
    ...run,
    runIndex: run.runIndex + runIndexOffset,
  };
}

function offsetLine(
  line: GreedyLine,
  runIndexOffset: number,
  lineIndexOffset: number,
  breakOverride?: BreakDecision
): GreedyLine {
  return {
    ...line,
    lineIndex: line.lineIndex + lineIndexOffset,
    startRun: line.startRun + runIndexOffset,
    endRun: line.endRun + runIndexOffset,
    break: breakOverride ?? offsetBreakDecision(line.break, runIndexOffset),
  };
}

function offsetBreakDecision(
  breakDecision: BreakDecision | null,
  runIndexOffset: number
): BreakDecision | null {
  return breakDecision
    ? {
        ...breakDecision,
        runIndex: breakDecision.runIndex + runIndexOffset,
      }
    : null;
}

function createForcedBreakDecision(
  runIndex: number,
  forcedBreak: NonNullable<TexLayoutParagraphIr["forcedBreakAfter"]>
): BreakDecision {
  return {
    kind: "forced",
    runIndex,
    sourceOffset: forcedBreak.sourceOffset,
    visibleHyphen: false,
    flagged: false,
    lineLeading: forcedBreak.lineLeading,
  };
}

function layoutItemsToRuns(
  items: readonly TexLayoutInlineItem[],
  shapedRuns: Map<number, ShapedTexTextRun>,
  metricProvider: TexMetricProvider
): ParagraphRun[] {
  const runs: ParagraphRun[] = [];
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
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
        text: item.text,
        wrapper,
        childIndex: runIndex,
        wordIndex: 0,
      } satisfies TextRun);
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
      sourceStart: item.sourceStart,
      sourceEnd: item.sourceEnd,
      text: " ",
      wrapper: syntheticWrapper,
      breakRef: createSimpleBreakRef(forced, forced ? item.lineLeading : undefined),
      texGlue: glue,
    } satisfies SpaceRun);
  }
  return runs;
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

function texInterwordGlueForSpaceFactor(
  font: ResolvedTexFont,
  spaceFactor: number,
  spaceGlueProfile: TexSpaceGlueProfile
): NonNullable<SpaceRun["texGlue"]> {
  const normalized = Number.isFinite(spaceFactor) && spaceFactor > 0 ? spaceFactor : 1000;
  if (spaceGlueProfile === "tikz-fixed") {
    return {
      width: roundTexPt((normalized >= 2000 ? 0.5 : 0.3333) * font.atPt),
      stretch: 0,
      shrink: 0,
      spaceFactor: normalized,
    };
  }
  const baseSpace = tfmToPt(font, font.data.fontdimen.space);
  const extraSpace = tfmToPt(font, font.data.fontdimen.extraspace ?? 0);
  const baseStretch = tfmToPt(font, font.data.fontdimen.stretch);
  const baseShrink = tfmToPt(font, font.data.fontdimen.shrink);
  return {
    width: roundTexPt(baseSpace + (normalized >= 2000 ? extraSpace : 0)),
    stretch: roundTexPt(baseStretch * normalized / 1000),
    shrink: roundTexPt(baseShrink * 1000 / normalized),
    spaceFactor: normalized,
  };
}

function createSimpleBreakRef(forced: boolean, lineLeading?: string): BreakRef {
  return {
    kind: "mspace",
    wrapper: syntheticWrapper,
    linebreak: forced ? "newline" : "auto",
    isForcedLineBreak: forced,
    lineLeading,
  };
}

function createTexParagraphMeasurement(
  font: ResolvedTexFont,
  metricProvider: TexMetricProvider
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
    measureMath: () => 0,
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

function shapedRunForWrapper(wrapper: AnyWrapper | null | undefined): ShapedTexTextRun | null {
  return wrapper && typeof wrapper === "object" ? shapedRunByWrapper.get(wrapper) ?? null : null;
}

function texParagraphDpOptions(params: TexParagraphDpOptionParams): DpOptions {
  const {
    options,
    alignment,
    noIndent,
    alignmentProfile,
    inheritedAlignment,
    inheritedAlignmentProfile,
    leftMarginWidth,
    rightMarginWidth,
    quoteContextActive,
    listContextActive,
  } = params;
  const latexRagged = alignment === "ragged-right" || alignment === "ragged-left";
  const inheritedLatexRagged =
    inheritedAlignment === "ragged-right" || inheritedAlignment === "ragged-left";
  const latexDeclaration = alignmentProfile === "latex-declaration";
  const latexQuote = alignmentProfile === "latex-quote";
  const skipStretch = 2 * (
    options.font?.atPt ??
    options.metricProvider?.resolveFont().atPt ??
    computerModernTexMetricProvider.resolveFont().atPt
  );
  const inheritedParfillStretch =
    inheritedAlignment === undefined
      ? Number.POSITIVE_INFINITY
      : texParfillStretchForAlignment(inheritedAlignment, inheritedAlignmentProfile);
  return {
    linepenalty: englishDefaults.linepenalty,
    adjdemerits: englishDefaults.adjdemerits,
    doublehyphendemerits: englishDefaults.doublehyphendemerits,
    finalhyphendemerits: latexDeclaration || latexRagged || inheritedLatexRagged
      ? LATEX_RAGGED_FINAL_HYPHEN_DEMERITS
      : englishDefaults.finalhyphendemerits,
    leftskipWidth: leftMarginWidth,
    leftskipStretch:
      texDeclarationLeftskipStretch(
        alignment,
        latexDeclaration,
        quoteContextActive,
        listContextActive,
        skipStretch
      ),
    leftskipShrink: 0,
    rightskipWidth: rightMarginWidth,
    rightskipStretch: texDeclarationRightskipStretch(
      alignment,
      latexDeclaration,
      latexQuote,
      quoteContextActive,
      listContextActive,
      skipStretch
    ),
    rightskipShrink: 0,
    firstLineIndentWidth:
      !noIndent &&
      !listContextActive &&
      Number.isFinite(options.parindent) &&
      options.parindent &&
      options.parindent > 0
        ? options.parindent
        : 0,
    forcedBreakIndentWidth:
      options.tikzTextWidthNode === true &&
      alignment !== "justified" &&
      !listContextActive &&
      Number.isFinite(options.parindent) &&
      options.parindent &&
      options.parindent > 0
        ? options.parindent
        : 0,
    forcedBreakUsesParfill: true,
    forcedBreakTerminalDemerits: true,
    parfillskipWidth: 0,
    parfillskipStretch: texParfillStretchForAlignment(
      alignment,
      alignmentProfile,
      options.tikzTextWidthNode === true,
      inheritedParfillStretch,
      quoteContextActive,
      listContextActive
    ),
    parfillskipShrink: 0,
    preventOverflow: false,
  };
}

function texDeclarationLeftskipStretch(
  alignment: TexParagraphAlignment,
  latexDeclaration: boolean,
  quoteContextActive: boolean,
  listContextActive: boolean,
  fallbackStretch: number
): number {
  if (quoteContextActive && (alignment === "ragged-left" || alignment === "center")) {
    return 0;
  }
  if (listContextActive && (alignment === "ragged-left" || alignment === "center")) {
    return 0;
  }
  if (latexDeclaration && (alignment === "ragged-left" || alignment === "center")) {
    return Number.POSITIVE_INFINITY;
  }
  return alignment === "ragged-left" || alignment === "center" ? fallbackStretch : 0;
}

function texDeclarationRightskipStretch(
  alignment: TexParagraphAlignment,
  latexDeclaration: boolean,
  latexQuote: boolean,
  quoteContextActive: boolean,
  listContextActive: boolean,
  fallbackStretch: number
): number {
  if (quoteContextActive) {
    return alignment === "ragged-right" ? Number.POSITIVE_INFINITY : 0;
  }
  if (listContextActive && alignment === "ragged-right") {
    return Number.POSITIVE_INFINITY;
  }
  if (listContextActive && alignment === "center") {
    return 0;
  }
  if (
    (latexDeclaration || latexQuote) &&
    (alignment === "ragged-right" || alignment === "center")
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return alignment === "ragged-right" || alignment === "center" ? fallbackStretch : 0;
}

function texParfillStretchForAlignment(
  alignment: TexParagraphAlignment,
  alignmentProfile?: TexAlignmentProfile,
  tikzTextWidthNode = false,
  inheritedParfillStretch = Number.POSITIVE_INFINITY,
  quoteContextActive = false,
  listContextActive = false
): number {
  if (quoteContextActive) {
    return Number.POSITIVE_INFINITY;
  }
  if (listContextActive) {
    return Number.POSITIVE_INFINITY;
  }
  if (alignmentProfile === "latex-declaration") {
    if (alignment === "center" || alignment === "ragged-left") {
      return 0;
    }
    if (alignment === "ragged-right") {
      if (tikzTextWidthNode) {
        return Number.POSITIVE_INFINITY;
      }
      return inheritedParfillStretch;
    }
  }
  return alignment === "ragged-right" || alignment === "justified"
    ? Number.POSITIVE_INFINITY
    : 0;
}

function texParagraphTolerance(): number {
  // TikZ text-width nodes are built in a LaTeX minipage. LaTeX's
  // \@arrayparboxrestore applies \sloppy before TikZ installs the alignment
  // action. TikZ's justify action restores finite left/right skips but does
  // not reset \tolerance, so the effective tolerance remains sloppy.
  return LATEX_PARBOX_SLOPPY_TOLERANCE;
}

function texParagraphEmergencyStretch(options: TexParagraphLayoutOptions): number {
  const font = options.font ?? options.metricProvider?.resolveFont() ?? computerModernTexMetricProvider.resolveFont();
  return LATEX_PARBOX_SLOPPY_EMERGENCY_STRETCH_EM * font.atPt;
}

function buildTexParagraphReport(params: {
  paragraphId: string;
  width: number;
  alignment: TexParagraphAlignment;
  runs: readonly ParagraphRun[];
  lines: readonly GreedyLine[];
  shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  runWidths: ReadonlyMap<number, number>;
  lineLabels: ReadonlyMap<number, TexLineLabel>;
  linebreakingMode: "feasible" | "overfull";
  layoutMode: KnuthPlassLayoutMode;
  font: ResolvedTexFont;
  metricProvider: TexMetricProvider;
  errors: readonly string[];
}): ParagraphLayoutReport {
  const runReports = params.runs.map((run) => ({
    runIndex: run.runIndex,
    kind: run.kind,
    sourceStart: run.sourceStart,
    sourceEnd: run.sourceEnd,
    width: params.runWidths.get(run.runIndex) ?? 0,
    text: run.kind === "text" || run.kind === "space" ? run.text : undefined,
  }));
  const lines: LineReport[] = params.lines.map((line) => buildTexLineReport(line, params));
  return {
    paragraphId: params.paragraphId,
    width: params.width,
    alignment: params.alignment,
    layoutMode: params.layoutMode,
    lines,
    runs: runReports,
    errors: [...params.errors],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: params.linebreakingMode,
  };
}

function buildTexLineReport(
  line: GreedyLine,
  params: {
    width: number;
    runs: readonly ParagraphRun[];
    shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
    metricProvider: TexMetricProvider;
    runWidths: ReadonlyMap<number, number>;
    lineLabels: ReadonlyMap<number, TexLineLabel>;
    font: ResolvedTexFont;
  }
): LineReport {
  const segments: LineReport["segments"] = [];
  let x = line.xOffset ?? 0;
  let ascent = 0;
  let descent = 0;
  const label = params.lineLabels.get(line.lineIndex);
  if (label) {
    const labelReport = buildTexLineLabelSegments(label, params.metricProvider);
    segments.push(...labelReport.segments);
    ascent = Math.max(ascent, labelReport.ascent);
    descent = Math.max(descent, labelReport.descent);
  }
  if (line.startPendingText) {
    const runFont = params.shapedRuns.get(line.startRun)?.font ?? params.font;
    const shaped = params.metricProvider.shapeText(line.startPendingText, runFont);
    const metrics = texShapedRunMetrics(shaped);
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
    segments.push({
      runIndex: line.startRun,
      kind: "text",
      text: line.startPendingText,
      startOffset: 0,
      endOffset: line.startPendingText.length,
      sourceStartRaw: line.startPendingSourceStart,
      sourceEndRaw: line.startPendingSourceEnd,
      sourceKind: "text",
      fontId: runFont.id,
      x,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => roundTexPt(x + stop)),
    });
    x = roundTexPt(x + shaped.width);
  }
  for (let runIndex = line.startRun; runIndex <= line.endRun; runIndex++) {
    const run = params.runs[runIndex];
    if (!run) {
      continue;
    }
    if (run.kind === "text") {
      const startOffset = runIndex === line.startRun ? line.startTextOffset : 0;
      const breakDiscretionary =
        line.break?.kind === "hyphen" && line.break.runIndex === runIndex
          ? line.break.discretionary
          : undefined;
      const endOffset = runIndex === line.endRun && line.endTextOffset !== null
        ? breakDiscretionary?.replaceStart ?? line.endTextOffset
        : run.text.length;
      if (endOffset <= startOffset) {
        continue;
      }
      const shaped = params.shapedRuns.get(run.runIndex);
      if (!shaped) {
        throw new Error(`Missing shaped TeX run for report run ${run.runIndex}.`);
      }
      const startX = shaped.caretStops[startOffset];
      const endX = shaped.caretStops[endOffset];
      if (startX === undefined || endX === undefined) {
        throw new Error(
          `Missing TeX caret stop while building report segment ${run.runIndex}:${startOffset}-${endOffset}.`
        );
      }
      const width = roundTexPt(endX - startX);
      const caretStops = shaped.caretStops.slice(startOffset, endOffset + 1)
        .map((stop) => roundTexPt(x + stop - startX));
      const metrics = texShapedSliceMetrics(shaped, startOffset, endOffset);
      ascent = Math.max(ascent, metrics.ascent);
      descent = Math.max(descent, metrics.descent);
      segments.push({
        runIndex: run.runIndex,
        kind: "text",
        text: run.text.slice(startOffset, endOffset),
        startOffset,
        endOffset,
        sourceStartRaw: run.sourceStart + startOffset,
        sourceEndRaw: run.sourceStart + endOffset,
        sourceKind: "text",
        fontId: shaped.font.id,
        x,
        width,
        caretStops,
      });
      x = roundTexPt(x + width);
      continue;
    }

    let width = params.runWidths.get(run.runIndex) ?? 0;
    if (run.kind === "space" && (line.spaceCount ?? 0) > 0) {
      const ratio = line.glueSetRatio ?? 0;
      const stretch = run.texGlue?.stretch;
      const shrink = run.texGlue?.shrink;
      if (ratio > 0 && typeof stretch === "number" && Number.isFinite(stretch)) {
        width = Math.max(0, width + ratio * stretch);
      } else if (ratio < 0 && typeof shrink === "number" && Number.isFinite(shrink)) {
        width = Math.max(0, width + ratio * shrink);
      }
    }
    segments.push({
      runIndex: run.runIndex,
      kind: "space",
      text: " ",
      sourceStartRaw: run.sourceStart,
      sourceEndRaw: run.sourceEnd,
      sourceKind: "text",
      x,
      width,
      caretStops: [x, roundTexPt(x + width)],
    });
    x = roundTexPt(x + width);
  }

  if (line.break?.kind === "hyphen" && line.break.discretionary) {
    const discretionary = line.break.discretionary;
    const splitOffset = line.break.splitOffset ?? discretionary.replaceStart;
    const sourceStartRaw = line.break.sourceOffset -
      Math.max(0, splitOffset - discretionary.replaceStart);
    const runFont = params.shapedRuns.get(line.break.runIndex)?.font ?? params.font;
    const shaped = params.metricProvider.shapeText(
      discretionary.preBreakText,
      runFont
    );
    const metrics = texShapedRunMetrics(shaped);
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
    segments.push({
      runIndex: line.break.runIndex,
      kind: "text",
      text: discretionary.preBreakText,
      startOffset: discretionary.replaceStart,
      endOffset: splitOffset,
      sourceStartRaw,
      sourceEndRaw: line.break.sourceOffset,
      sourceKind: "text",
      fontId: runFont.id,
      x,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => roundTexPt(x + stop)),
    });
    x = roundTexPt(x + shaped.width);
  } else if (line.break?.kind === "hyphen" && line.break.visibleHyphen) {
    const runFont = params.shapedRuns.get(line.break.runIndex)?.font ?? params.font;
    const width = params.metricProvider.shapeText("-", runFont).width;
    const metrics = texShapedRunMetrics(params.metricProvider.shapeText("-", runFont));
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
    const insertedWidth = line.break.width ?? width;
    const hyphenX = roundTexPt(x + insertedWidth - width);
    segments.push({
      runIndex: line.break.runIndex,
      kind: "text",
      text: "-",
      startOffset: line.break.splitOffset ?? 0,
      endOffset: line.break.splitOffset ?? 0,
      sourceStartRaw: line.break.sourceOffset,
      sourceEndRaw: line.break.sourceOffset,
      sourceKind: "text",
      fontId: runFont.id,
      x: hyphenX,
      width,
      caretStops: [hyphenX, roundTexPt(hyphenX + width)],
    });
    x = roundTexPt(x + insertedWidth);
  }

  const xStart = line.xOffset ?? 0;
  return {
    lineIndex: line.lineIndex,
    startRun: line.startRun,
    endRun: line.endRun,
    width: line.lineNaturalWidth ?? line.width,
    targetWidth: line.targetWidth ?? params.width,
    naturalWidth: line.lineNaturalWidth ?? line.width,
    glueSetRatio: line.glueSetRatio ?? 0,
    badness: line.badness ?? 0,
    spaceCount: line.spaceCount ?? 0,
    spaceDeltaPerGap: line.spaceDeltaPerGap ?? 0,
    ascent: roundTexPt(ascent),
    descent: roundTexPt(descent),
    xStart,
    xEnd: x,
    break: line.break,
    segments,
  };
}

function buildTexLineLabelSegments(
  label: TexLineLabel,
  metricProvider: TexMetricProvider
): {
  readonly segments: LineReport["segments"];
  readonly ascent: number;
  readonly descent: number;
} {
  const segments: LineReport["segments"] = [];
  const width = texLayoutItemsNaturalWidth(label.label.items, metricProvider);
  let x = roundTexPt(label.label.rightEdge - width);
  let ascent = 0;
  let descent = 0;
  for (const item of label.label.items) {
    if (item.kind === "glyph") {
      const glyphWidth = texLayoutGlyphItemWidth(item);
      ascent = Math.max(ascent, texLayoutGlyphItemHeight(item));
      descent = Math.max(descent, texLayoutGlyphItemDepth(item));
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "text",
        text: item.text,
        startOffset: 0,
        endOffset: item.text.length,
        fontId: item.font.id,
        glyphCode: item.code,
        x,
        width: glyphWidth,
        caretStops: [x, roundTexPt(x + glyphWidth)],
      });
      x = roundTexPt(x + glyphWidth);
      continue;
    }
    if (item.kind === "forced-break") {
      continue;
    }
    if (item.kind === "text") {
      const shaped = metricProvider.shapeText(item.text, item.font);
      const metrics = texShapedRunMetrics(shaped);
      ascent = Math.max(ascent, metrics.ascent);
      descent = Math.max(descent, metrics.descent);
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "text",
        text: item.text,
        startOffset: 0,
        endOffset: item.text.length,
        fontId: item.font.id,
        x,
        width: shaped.width,
        caretStops: shaped.caretStops.map((stop) => roundTexPt(x + stop)),
      });
      x = roundTexPt(x + shaped.width);
      continue;
    }

    const glue = texInterwordGlueForSpaceFactor(
      item.font,
      item.spaceFactor,
      item.spaceGlueProfile
    );
    segments.push({
      runIndex: label.lineRunIndex,
      kind: "space",
      text: " ",
      x,
      width: glue.width,
      caretStops: [x, roundTexPt(x + glue.width)],
    });
    x = roundTexPt(x + glue.width);
  }
  return { segments, ascent, descent };
}

function texShapedSliceMetrics(
  shaped: ShapedTexTextRun,
  startOffset: number,
  endOffset: number
): { readonly ascent: number; readonly descent: number } {
  let ascent = 0;
  let descent = 0;
  for (const item of shaped.items) {
    if (
      item.kind !== "glyph" ||
      item.sourceEnd <= startOffset + shaped.sourceStart ||
      item.sourceStart >= endOffset + shaped.sourceStart
    ) {
      continue;
    }
    ascent = Math.max(ascent, item.height);
    descent = Math.max(descent, item.depth);
  }
  return { ascent, descent };
}

function texShapedRunMetrics(
  shaped: ShapedTexTextRun
): { readonly ascent: number; readonly descent: number } {
  let ascent = 0;
  let descent = 0;
  for (const item of shaped.items) {
    if (item.kind !== "glyph") {
      continue;
    }
    ascent = Math.max(ascent, item.height);
    descent = Math.max(descent, item.depth);
  }
  return { ascent, descent };
}

function texLayoutItemsNaturalWidth(
  items: readonly TexLayoutLabelItem[],
  metricProvider: TexMetricProvider
): number {
  let width = 0;
  for (const item of items) {
    if (item.kind === "glyph") {
      width += texLayoutGlyphItemWidth(item);
      continue;
    }
    if (item.kind === "forced-break") {
      continue;
    }
    if (item.kind === "text") {
      width += metricProvider.shapeText(item.text, item.font).width;
      continue;
    }
    width += texInterwordGlueForSpaceFactor(
      item.font,
      item.spaceFactor,
      item.spaceGlueProfile
    ).width;
  }
  return roundTexPt(width);
}
