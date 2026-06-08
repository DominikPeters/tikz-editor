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
import type { ResolvedTexFont, ShapedTexTextRun, TexGlyphBox } from "./fonts/types.js";
import {
  getSimpleTexFallbackReason,
  parseSimpleTexParagraphIr,
  type TexAlignmentProfile,
  type TexSpaceGlueProfile,
} from "./ir.js";
import {
  createSimpleTexLayoutDocumentIr,
  type TexLayoutInlineItem,
  type TexLayoutParagraphIr,
} from "./layout-ir.js";

export type TexParagraphAlignment = ParagraphAlignment;
export { getSimpleTexFallbackReason } from "./ir.js";

export interface TexParagraphLayoutOptions {
  readonly paragraphId?: string;
  readonly width: number;
  readonly alignment?: TexParagraphAlignment;
  readonly font?: ResolvedTexFont;
  readonly tolerance?: number;
  readonly pretolerance?: number;
  readonly parindent?: number;
  readonly tikzTextWidthNode?: boolean;
  readonly hyphenator?: Hyphenator | null;
}

export interface TexParagraphLayoutResult {
  readonly supported: boolean;
  readonly report: ParagraphLayoutReport | null;
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

const LATEX_RAGGED_FINAL_HYPHEN_DEMERITS = 0;
const LATEX_PARBOX_SLOPPY_TOLERANCE = 9999;
const LATEX_PARBOX_SLOPPY_EMERGENCY_STRETCH_EM = 3;

const syntheticWrapper: AnyWrapper = {};
const shapedRunByWrapper = new WeakMap<object, ShapedTexTextRun>();

export function layoutSimpleTexParagraph(
  text: string,
  options: TexParagraphLayoutOptions
): TexParagraphLayoutResult {
  const fallbackReason = getSimpleTexFallbackReason(text, options.width);
  if (fallbackReason) {
    return {
      supported: false,
      report: null,
      fallbackReason,
      shapedRuns: new Map(),
      errors: [],
    };
  }

  const font = options.font ?? computerModernTexMetricProvider.resolveFont();
  const paragraphId = options.paragraphId ?? "tex:paragraph";
  const defaultAlignment = options.alignment ?? "ragged-right";
  const shapedRuns = new Map<number, ShapedTexTextRun>();
  const blocks = parseSimpleTexParagraphIr(text).blocks;
  if (blocks.length === 0) {
    return {
      supported: false,
      report: null,
      fallbackReason: "Paragraph contains no text runs.",
      shapedRuns,
      errors: [],
    };
  }

  const measurement = createTexParagraphMeasurement(font);
  const layoutIr = createSimpleTexLayoutDocumentIr({
    blocks,
    defaultAlignment,
    font,
    options,
  });
  const combinedRuns: ParagraphRun[] = [];
  const combinedLines: GreedyLine[] = [];
  const combinedRunWidths = new Map<number, number>();
  const combinedLineVerticalSkipsBefore = new Map<number, number>();
  const errors: string[] = [];
  let linebreakingMode: "feasible" | "overfull" = "feasible";
  let runIndexOffset = 0;
  let lineIndexOffset = 0;

  for (const paragraph of layoutIr.paragraphs) {
    const blockShapedRuns = new Map<number, ShapedTexTextRun>();
    const runs = layoutItemsToRuns(paragraph.items, blockShapedRuns);
    if (!runs.some((run) => run.kind === "text")) {
      continue;
    }

    const broken = breakTexParagraphRuns({
      runs,
      shapedRuns: blockShapedRuns,
      measurement,
      options,
      alignment: paragraph.alignment,
      alignmentProfile: paragraph.alignmentProfile,
      inheritedAlignment: paragraph.inheritedAlignment,
      inheritedAlignmentProfile: paragraph.inheritedAlignmentProfile,
      noIndent: paragraph.noIndent,
      leftMarginWidth: paragraph.leftMarginWidth,
      rightMarginWidth: paragraph.rightMarginWidth,
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
      if (line.lineIndex === 0 && paragraph.verticalSkipBefore > 0) {
        combinedLineVerticalSkipsBefore.set(
          combinedLineIndex,
          paragraph.verticalSkipBefore
        );
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
    return {
      supported: false,
      report: null,
      fallbackReason: "Paragraph contains no text runs.",
      shapedRuns,
      errors,
    };
  }

  return {
    supported: true,
    report: buildTexParagraphReport({
      paragraphId,
      width: options.width,
      alignment: layoutIr.reportAlignment,
      runs: combinedRuns,
      lines: combinedLines,
      shapedRuns,
      runWidths: combinedRunWidths,
      lineVerticalSkipsBefore: combinedLineVerticalSkipsBefore,
      linebreakingMode,
      layoutMode: layoutIr.layoutMode,
      font,
      errors,
    }),
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
}): TexParagraphBreakResult | null {
  const pass1Model = runsToItems(params.runs, params.measurement, {
    enableAutomaticHyphenation: false,
    hyphenator: null,
  });
  const dpOptions = texParagraphDpOptions(
    params.options,
    params.alignment,
    params.noIndent,
    params.alignmentProfile,
    params.inheritedAlignment,
    params.inheritedAlignmentProfile,
    params.leftMarginWidth,
    params.rightMarginWidth
  );
  const pass1 = breakWithDp(pass1Model, params.options.width, {
    ...dpOptions,
    tolerance: params.options.pretolerance ?? englishDefaults.pretolerance,
  });
  const tolerance = params.options.tolerance ?? texParagraphTolerance(params.alignment);
  const pass2Model = pass1.canProceed && pass1.lines.length
    ? pass1Model
    : runsToItems(params.runs, params.measurement, {
      hyphenator: params.options.hyphenator ?? createEnglishHyphenator(),
      enableAutomaticHyphenation: true,
      hyphenpenalty: englishDefaults.hyphenpenalty,
      exhyphenpenalty: englishDefaults.exhyphenpenalty,
    });
  const strictPass2 = pass1.canProceed && pass1.lines.length
    ? pass1
    : breakWithDp(pass2Model, params.options.width, {
      ...dpOptions,
      tolerance,
    });
  const emergencyStretch = texParagraphEmergencyStretch(params.options, params.alignment);
  const emergencyPass = strictPass2.canProceed && strictPass2.lines.length
    ? strictPass2
    : emergencyStretch > 0
      ? breakWithDp(pass2Model, params.options.width, {
        ...dpOptions,
        tolerance,
        emergencyStretch,
      })
      : strictPass2;
  const pass2 = strictPass2.canProceed && strictPass2.lines.length
    ? strictPass2
    : emergencyPass.canProceed && emergencyPass.lines.length
      ? emergencyPass
    : breakWithDp(pass2Model, params.options.width, {
      ...dpOptions,
      tolerance,
      emergencyStretch,
      allowLastResortOverfull: true,
    });

  if (!pass2.canProceed || pass2.lines.length === 0) {
    return null;
  }

  return {
    lines: pass2.lines,
    runs: params.runs,
    runWidths: pass2Model.runWidths,
    shapedRuns: params.shapedRuns,
    errors: [...pass2Model.errors, ...pass2.errors],
    linebreakingMode: pass2.mode,
  };
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
  shapedRuns: Map<number, ShapedTexTextRun>
): ParagraphRun[] {
  const runs: ParagraphRun[] = [];
  for (const item of items) {
    const runIndex = runs.length;
    if (item.kind === "text") {
      const shaped = computerModernTexMetricProvider.shapeText(item.text, item.font, {
        sourceStart: item.sourceStart,
      });
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
    const glue = forced
      ? { width: 0, stretch: 0, shrink: 0 }
      : texInterwordGlueForSpaceFactor(
        item.font,
        item.spaceFactor,
        item.spaceGlueProfile
      );
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
  font: ResolvedTexFont
): MeasurementService {
  const spaceWidth = tfmToPt(font, font.data.fontdimen.space);
  const sliceWidthCache = new Map<string, number>();
  const measureTexSlice = (word: string, start: number, end: number): number => {
    const clampedStart = Math.max(0, Math.min(start, word.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, word.length));
    if (clampedEnd <= clampedStart) {
      return 0;
    }
    const key = `${clampedStart}:${clampedEnd}:${word}`;
    const cached = sliceWidthCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const width = computerModernTexMetricProvider.shapeText(
      word.slice(clampedStart, clampedEnd),
      font
    ).width;
    sliceWidthCache.set(key, width);
    return width;
  };
  const measureTexHyphenatedPrefix = (
    word: string,
    start: number,
    end: number,
    hyphen: string
  ): number => {
    const prefixWidth = measureTexSlice(word, start, end);
    const clampedStart = Math.max(0, Math.min(start, word.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, word.length));
    const prefix = word.slice(clampedStart, clampedEnd);
    return roundTexPt(
      computerModernTexMetricProvider.shapeText(prefix + hyphen, font).width - prefixWidth
    );
  };
  const measureTexDiscretionary = (
    word: string,
    start: number,
    end: number,
    hyphen: string,
    wrapper: AnyWrapper | null | undefined
  ) => {
    const clampedStart = Math.max(0, Math.min(start, word.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, word.length));
    const simpleInsertedWidth = measureTexHyphenatedPrefix(
      word,
      clampedStart,
      clampedEnd,
      hyphen
    );
    const shaped = shapedRunForWrapper(wrapper);
    const absoluteEnd = (shaped?.sourceStart ?? 0) + clampedEnd;
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
        replaceStart: clampedEnd,
        replaceEnd: clampedEnd,
        preBreakWidth: simpleInsertedWidth,
        sourcePrefixWidth: 0,
        insertedWidth: simpleInsertedWidth,
      };
    }

    const replaceStart = Math.max(0, ligature.sourceStart - shaped.sourceStart);
    const replaceEnd = Math.min(word.length, ligature.sourceEnd - shaped.sourceStart);
    const sourcePrefix = word.slice(replaceStart, clampedEnd);
    const preBreakText = `${sourcePrefix}${hyphen}`;
    const sourcePrefixWidth = measureTexSlice(word, replaceStart, clampedEnd);
    const preBreakWidth = computerModernTexMetricProvider.shapeText(preBreakText, font).width;
    const postBreakText = word.slice(clampedEnd, replaceEnd);
    const postBreakWidth = computerModernTexMetricProvider.shapeText(postBreakText, font).width;
    const replaceText = word.slice(replaceStart, replaceEnd);
    const replaceWidth = computerModernTexMetricProvider.shapeText(replaceText, font).width;

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
    measureText: (value) => value === " " ? spaceWidth : computerModernTexMetricProvider.shapeText(value, font).width,
    measureWord: (word, wrapper) => shapedRunForWrapper(wrapper)?.width ?? computerModernTexMetricProvider.shapeText(word, font).width,
    measureMath: () => 0,
    measurePrefix: (word, end, wrapper) => {
      const shaped = shapedRunForWrapper(wrapper);
      if (!shaped) {
        return computerModernTexMetricProvider.shapeText(word.slice(0, end), font).width;
      }
      const local = Math.max(0, Math.min(end, shaped.caretStops.length - 1));
      return shaped.caretStops[local] ?? 0;
    },
    measureSlice: (word, start, end) => measureTexSlice(word, start, end),
    measureHyphenatedPrefix: (word, start, end, hyphen) =>
      measureTexHyphenatedPrefix(word, start, end, hyphen),
    measureDiscretionary: (word, start, end, hyphen, wrapper) =>
      measureTexDiscretionary(word, start, end, hyphen, wrapper),
    precomputeWord: () => {},
    primeRuns: () => {},
    getStats: () => ({ textCacheEntries: 0, wordPrefixEntries: 0, mathCacheEntries: 0 }),
  };
}

function shapedRunForWrapper(wrapper: AnyWrapper | null | undefined): ShapedTexTextRun | null {
  return wrapper && typeof wrapper === "object" ? shapedRunByWrapper.get(wrapper) ?? null : null;
}

function texParagraphDpOptions(
  options: TexParagraphLayoutOptions,
  alignment: TexParagraphAlignment,
  noIndent = false,
  alignmentProfile?: TexAlignmentProfile,
  inheritedAlignment?: TexParagraphAlignment,
  inheritedAlignmentProfile?: TexAlignmentProfile,
  leftMarginWidth = 0,
  rightMarginWidth = 0
): DpOptions {
  const latexRagged = alignment === "ragged-right" || alignment === "ragged-left";
  const latexDeclaration = alignmentProfile === "latex-declaration";
  const latexQuote = alignmentProfile === "latex-quote";
  const skipStretch = 2 * (options.font?.atPt ?? computerModernTexMetricProvider.resolveFont().atPt);
  const inheritedParfillStretch =
    inheritedAlignment === undefined
      ? Number.POSITIVE_INFINITY
      : texParfillStretchForAlignment(inheritedAlignment, inheritedAlignmentProfile);
  return {
    linepenalty: englishDefaults.linepenalty,
    adjdemerits: englishDefaults.adjdemerits,
    doublehyphendemerits: englishDefaults.doublehyphendemerits,
    finalhyphendemerits: latexDeclaration || latexRagged
      ? LATEX_RAGGED_FINAL_HYPHEN_DEMERITS
      : englishDefaults.finalhyphendemerits,
    leftskipWidth: leftMarginWidth,
    leftskipStretch:
      alignment === "ragged-left" || alignment === "center" ? skipStretch : 0,
    leftskipShrink: 0,
    rightskipWidth: rightMarginWidth,
    rightskipStretch:
      latexQuote && alignment === "ragged-right"
        ? Number.POSITIVE_INFINITY
        : alignment === "ragged-right" || alignment === "center"
          ? skipStretch
          : 0,
    rightskipShrink: 0,
    firstLineIndentWidth:
      !noIndent && Number.isFinite(options.parindent) && options.parindent && options.parindent > 0
        ? options.parindent
        : 0,
    forcedBreakIndentWidth:
      options.tikzTextWidthNode === true &&
      alignment !== "justified" &&
      Number.isFinite(options.parindent) &&
      options.parindent &&
      options.parindent > 0
        ? options.parindent
        : 0,
    forcedBreakUsesParfill: true,
    parfillskipWidth: 0,
    parfillskipStretch: texParfillStretchForAlignment(
      alignment,
      alignmentProfile,
      options.tikzTextWidthNode === true,
      inheritedParfillStretch
    ),
    parfillskipShrink: 0,
    preventOverflow: false,
  };
}

function texParfillStretchForAlignment(
  alignment: TexParagraphAlignment,
  alignmentProfile?: TexAlignmentProfile,
  tikzTextWidthNode = false,
  inheritedParfillStretch = Number.POSITIVE_INFINITY
): number {
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

function texParagraphTolerance(_alignment: TexParagraphAlignment): number {
  // TikZ text-width nodes are built in a LaTeX minipage. LaTeX's
  // \@arrayparboxrestore applies \sloppy before TikZ installs the alignment
  // action. TikZ's justify action restores finite left/right skips but does
  // not reset \tolerance, so the effective tolerance remains sloppy.
  return LATEX_PARBOX_SLOPPY_TOLERANCE;
}

function texParagraphEmergencyStretch(
  options: TexParagraphLayoutOptions,
  _alignment: TexParagraphAlignment
): number {
  const font = options.font ?? computerModernTexMetricProvider.resolveFont();
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
  lineVerticalSkipsBefore: ReadonlyMap<number, number>;
  linebreakingMode: "feasible" | "overfull";
  layoutMode: KnuthPlassLayoutMode;
  font: ResolvedTexFont;
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
    runWidths: ReadonlyMap<number, number>;
    lineVerticalSkipsBefore: ReadonlyMap<number, number>;
    font: ResolvedTexFont;
  }
): LineReport {
  const segments: LineReport["segments"] = [];
  let x = line.xOffset ?? 0;
  if (line.startPendingText) {
    const shaped = computerModernTexMetricProvider.shapeText(line.startPendingText, params.font);
    segments.push({
      runIndex: line.startRun,
      kind: "text",
      text: line.startPendingText,
      startOffset: 0,
      endOffset: line.startPendingText.length,
      sourceStartRaw: line.startPendingSourceStart,
      sourceEndRaw: line.startPendingSourceEnd,
      sourceKind: "text",
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
      const startX = shaped?.caretStops[startOffset] ?? 0;
      const endX = shaped?.caretStops[endOffset] ?? startX;
      const width = roundTexPt(endX - startX);
      const caretStops = (shaped?.caretStops.slice(startOffset, endOffset + 1) ?? [0, width])
        .map((stop) => roundTexPt(x + stop - startX));
      segments.push({
        runIndex: run.runIndex,
        kind: "text",
        text: run.text.slice(startOffset, endOffset),
        startOffset,
        endOffset,
        sourceStartRaw: run.sourceStart + startOffset,
        sourceEndRaw: run.sourceStart + endOffset,
        sourceKind: "text",
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
      } else if (Number.isFinite(line.spaceDeltaPerGap ?? 0)) {
        width = Math.max(0, width + (line.spaceDeltaPerGap ?? 0));
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
    const shaped = computerModernTexMetricProvider.shapeText(
      discretionary.preBreakText,
      params.font
    );
    segments.push({
      runIndex: line.break.runIndex,
      kind: "text",
      text: discretionary.preBreakText,
      startOffset: discretionary.replaceStart,
      endOffset: splitOffset,
      sourceStartRaw,
      sourceEndRaw: line.break.sourceOffset,
      sourceKind: "text",
      x,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => roundTexPt(x + stop)),
    });
    x = roundTexPt(x + shaped.width);
  } else if (line.break?.kind === "hyphen" && line.break.visibleHyphen) {
    const width = computerModernTexMetricProvider.shapeText("-", params.font).width;
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
      x: hyphenX,
      width,
      caretStops: [hyphenX, roundTexPt(hyphenX + width)],
    });
    x = roundTexPt(x + insertedWidth);
  }

  const ascent = tfmToPt(params.font, params.font.data.fontdimen.xheight) * 1.6;
  const descent = tfmToPt(params.font, params.font.data.fontdimen.xheight) * 0.4;
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
    ascent,
    descent,
    xStart,
    xEnd: x,
    verticalSkipBefore: params.lineVerticalSkipsBefore.get(line.lineIndex),
    break: line.break,
    segments,
  };
}
