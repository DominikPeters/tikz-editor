import { englishDefaults } from "../knuth-plass/languages/en.js";
import type { ParagraphAlignment } from "../knuth-plass/alignment.js";
import { createEnglishHyphenator, type Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import { breakWithDp, type DpOptions } from "../knuth-plass/paragraph/dp.js";
import { runsToItems } from "../knuth-plass/paragraph/items.js";
import type { MeasurementService } from "../knuth-plass/paragraph/measure.js";
import type { LineReport, ParagraphLayoutReport } from "../knuth-plass/paragraph/report.js";
import type {
  AnyWrapper,
  BreakRef,
  GreedyLine,
  ParagraphRun,
  SpaceRun,
  TextRun,
} from "../knuth-plass/paragraph/types.js";
import { computerModernTexMetricProvider } from "./fonts/computer-modern.js";
import { roundTexPt, tfmToPt } from "./fonts/units.js";
import type { ResolvedTexFont, ShapedTexTextRun } from "./fonts/types.js";

export type TexParagraphAlignment = ParagraphAlignment;

export interface TexParagraphLayoutOptions {
  readonly paragraphId?: string;
  readonly width: number;
  readonly alignment?: TexParagraphAlignment;
  readonly font?: ResolvedTexFont;
  readonly tolerance?: number;
  readonly pretolerance?: number;
  readonly hyphenator?: Hyphenator | null;
}

export interface TexParagraphLayoutResult {
  readonly supported: boolean;
  readonly report: ParagraphLayoutReport | null;
  readonly fallbackReason: string | null;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly errors: readonly string[];
}

interface SimpleToken {
  readonly kind: "text" | "space" | "forced-break";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

const unsupportedPattern = /[\\$&{}_^~#%]/;
const whitespacePattern = /[ \n]+/;
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
  const alignment = options.alignment ?? "ragged-right";
  const shapedRuns = new Map<number, ShapedTexTextRun>();
  const tokens = tokenizeSimpleTexParagraph(text);
  const runs = tokensToRuns(tokens, font, shapedRuns, alignment);
  if (!runs.some((run) => run.kind === "text")) {
    return {
      supported: false,
      report: null,
      fallbackReason: "Paragraph contains no text runs.",
      shapedRuns,
      errors: [],
    };
  }

  const measurement = createTexParagraphMeasurement(font);
  const pass1Model = runsToItems(runs, measurement, {
    enableAutomaticHyphenation: false,
    hyphenator: null,
  });
  const dpOptions = texParagraphDpOptions(options, alignment);
  const pass1 = breakWithDp(pass1Model, options.width, {
    ...dpOptions,
    tolerance: options.pretolerance ?? englishDefaults.pretolerance,
  });
  const tolerance = options.tolerance ?? texParagraphTolerance(alignment);
  const pass2Model = pass1.canProceed && pass1.lines.length
    ? pass1Model
    : runsToItems(runs, measurement, {
      hyphenator: options.hyphenator ?? createEnglishHyphenator(),
      enableAutomaticHyphenation: true,
      hyphenpenalty: englishDefaults.hyphenpenalty,
      exhyphenpenalty: englishDefaults.exhyphenpenalty,
    });
  const strictPass2 = pass1.canProceed && pass1.lines.length
    ? pass1
    : breakWithDp(pass2Model, options.width, {
      ...dpOptions,
      tolerance,
    });
  const emergencyStretch = texParagraphEmergencyStretch(options, alignment);
  const emergencyPass = strictPass2.canProceed && strictPass2.lines.length
    ? strictPass2
    : emergencyStretch > 0
      ? breakWithDp(pass2Model, options.width, {
        ...dpOptions,
        tolerance,
        emergencyStretch,
      })
      : strictPass2;
  const pass2 = strictPass2.canProceed && strictPass2.lines.length
    ? strictPass2
    : emergencyPass.canProceed && emergencyPass.lines.length
      ? emergencyPass
    : breakWithDp(pass2Model, options.width, {
      ...dpOptions,
      tolerance,
      emergencyStretch,
      allowInfeasible: alignment !== "justified",
    });

  if (!pass2.canProceed || pass2.lines.length === 0) {
    return {
      supported: false,
      report: null,
      fallbackReason: `TeX paragraph breaker failed: ${[...pass1Model.errors, ...pass2Model.errors, ...pass1.errors, ...pass2.errors].join("; ") || "no solution"}`,
      shapedRuns,
      errors: [...pass1Model.errors, ...pass2Model.errors, ...pass1.errors, ...pass2.errors],
    };
  }

  return {
    supported: true,
    report: buildTexParagraphReport({
      paragraphId,
      width: options.width,
      alignment,
      runs,
      lines: pass2.lines,
      shapedRuns,
      runWidths: pass2Model.runWidths,
      linebreakingMode: pass2.mode,
      font,
      errors: [...pass2Model.errors, ...pass2.errors],
    }),
    fallbackReason: null,
    shapedRuns,
    errors: [...pass2Model.errors, ...pass2.errors],
  };
}

export function getSimpleTexFallbackReason(text: string, width: number): string | null {
  if (!Number.isFinite(width) || width <= 0) {
    return "Paragraph width must be positive.";
  }
  if (unsupportedPattern.test(text)) {
    return "Paragraph contains TeX syntax that is not supported by the simple text path.";
  }
  for (let index = 0; index < text.length; index++) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint > 0x7e || (codePoint < 0x20 && codePoint !== 0x0a)) {
      return `Paragraph contains unsupported OT1 character U+${codePoint.toString(16).toUpperCase()}.`;
    }
  }
  return null;
}

function tokenizeSimpleTexParagraph(text: string): SimpleToken[] {
  const tokens: SimpleToken[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\n") {
      tokens.push({ kind: "forced-break", text: "\n", sourceStart: index, sourceEnd: index + 1 });
      index += 1;
      continue;
    }
    if (char === " ") {
      const start = index;
      while (index < text.length && text[index] === " ") {
        index += 1;
      }
      tokens.push({ kind: "space", text: " ", sourceStart: start, sourceEnd: index });
      continue;
    }
    const start = index;
    while (
      index < text.length &&
      !whitespacePattern.test(text[index] ?? "")
    ) {
      index += 1;
    }
    tokens.push({ kind: "text", text: text.slice(start, index), sourceStart: start, sourceEnd: index });
  }
  return tokens;
}

function tokensToRuns(
  tokens: readonly SimpleToken[],
  font: ResolvedTexFont,
  shapedRuns: Map<number, ShapedTexTextRun>,
  alignment: TexParagraphAlignment
): ParagraphRun[] {
  const runs: ParagraphRun[] = [];
  let spaceFactor = 1000;
  let hasSeenText = false;
  for (const token of tokens) {
    if (token.kind === "space" && !hasSeenText) {
      continue;
    }
    const runIndex = runs.length;
    if (token.kind === "text") {
      const shaped = computerModernTexMetricProvider.shapeText(token.text, font, {
        sourceStart: token.sourceStart,
      });
      const wrapper: AnyWrapper = {};
      shapedRunByWrapper.set(wrapper, shaped);
      shapedRuns.set(runIndex, shaped);
      runs.push({
        kind: "text",
        runIndex,
        sourceStart: token.sourceStart,
        sourceEnd: token.sourceEnd,
        text: token.text,
        wrapper,
        childIndex: runIndex,
        wordIndex: 0,
      } satisfies TextRun);
      spaceFactor = updateSpaceFactorForText(spaceFactor, token.text);
      hasSeenText = true;
      continue;
    }

    const forced = token.kind === "forced-break";
    const glue = forced
      ? { width: 0, stretch: 0, shrink: 0 }
      : texInterwordGlueForSpaceFactor(font, spaceFactor, alignment);
    runs.push({
      kind: "space",
      runIndex,
      sourceStart: token.sourceStart,
      sourceEnd: token.sourceEnd,
      text: " ",
      wrapper: syntheticWrapper,
      breakRef: createSimpleBreakRef(forced),
      texGlue: glue,
    } satisfies SpaceRun);
  }
  while (runs.at(-1)?.kind === "space") {
    runs.pop();
  }
  return runs;
}

function texInterwordGlueForSpaceFactor(
  font: ResolvedTexFont,
  spaceFactor: number,
  alignment: TexParagraphAlignment
): NonNullable<SpaceRun["texGlue"]> {
  const normalized = Number.isFinite(spaceFactor) && spaceFactor > 0 ? spaceFactor : 1000;
  if (alignment !== "justified") {
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

function updateSpaceFactorForText(current: number, text: string): number {
  let spaceFactor = current;
  for (const char of text) {
    const sfcode = defaultTexSfcode(char);
    if (sfcode === 0) {
      continue;
    }
    spaceFactor = sfcode > 1000 && spaceFactor < 1000 ? 1000 : sfcode;
  }
  return spaceFactor;
}

function defaultTexSfcode(char: string): number {
  if (char >= "A" && char <= "Z") {
    return 999;
  }
  if (char === "." || char === "?" || char === "!") {
    return 3000;
  }
  if (char === ":") {
    return 2000;
  }
  if (char === ";") {
    return 1500;
  }
  if (char === ",") {
    return 1250;
  }
  if (char === ")" || char === "]" || char === "'" || char === '"') {
    return 0;
  }
  return 1000;
}

function createSimpleBreakRef(forced: boolean): BreakRef {
  return {
    kind: "mspace",
    wrapper: syntheticWrapper,
    linebreak: forced ? "newline" : "auto",
    isForcedLineBreak: forced,
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
  alignment: TexParagraphAlignment
): DpOptions {
  const latexRagged = alignment === "ragged-right" || alignment === "ragged-left";
  const skipStretch = 2 * (options.font?.atPt ?? computerModernTexMetricProvider.resolveFont().atPt);
  return {
    linepenalty: englishDefaults.linepenalty,
    adjdemerits: englishDefaults.adjdemerits,
    doublehyphendemerits: englishDefaults.doublehyphendemerits,
    finalhyphendemerits: latexRagged
      ? LATEX_RAGGED_FINAL_HYPHEN_DEMERITS
      : englishDefaults.finalhyphendemerits,
    leftskipWidth: 0,
    leftskipStretch:
      alignment === "ragged-left" || alignment === "center" ? skipStretch : 0,
    leftskipShrink: 0,
    rightskipWidth: 0,
    rightskipStretch:
      alignment === "ragged-right" || alignment === "center" ? skipStretch : 0,
    rightskipShrink: 0,
    parfillskipWidth: 0,
    parfillskipStretch:
      alignment === "ragged-right" || alignment === "justified"
        ? Number.POSITIVE_INFINITY
        : 0,
    parfillskipShrink: 0,
    preventOverflow: false,
  };
}

function texParagraphTolerance(alignment: TexParagraphAlignment): number {
  // TikZ text-width nodes are built in a LaTeX minipage. LaTeX's
  // \@arrayparboxrestore applies \sloppy before TikZ installs the alignment
  // action, and non-justified alignment actions do not reset \tolerance.
  return alignment !== "justified"
    ? LATEX_PARBOX_SLOPPY_TOLERANCE
    : englishDefaults.tolerance;
}

function texParagraphEmergencyStretch(
  options: TexParagraphLayoutOptions,
  alignment: TexParagraphAlignment
): number {
  if (alignment === "justified") {
    return 0;
  }
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
  linebreakingMode: "feasible" | "overfull";
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
    layoutMode: "wrap",
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
    font: ResolvedTexFont;
  }
): LineReport {
  const segments: LineReport["segments"] = [];
  let x = line.xOffset ?? 0;
  for (let runIndex = line.startRun; runIndex <= line.endRun; runIndex++) {
    const run = params.runs[runIndex];
    if (!run) {
      continue;
    }
    if (run.kind === "text") {
      const startOffset = runIndex === line.startRun ? line.startTextOffset : 0;
      const endOffset = runIndex === line.endRun && line.endTextOffset !== null
        ? line.endTextOffset
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
    if (
      run.kind === "space" &&
      (line.spaceCount ?? 0) > 0 &&
      Number.isFinite(line.spaceDeltaPerGap ?? 0)
    ) {
      width = Math.max(0, width + (line.spaceDeltaPerGap ?? 0));
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

  if (line.break?.kind === "hyphen" && line.break.visibleHyphen) {
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
    break: line.break,
    segments,
  };
}
