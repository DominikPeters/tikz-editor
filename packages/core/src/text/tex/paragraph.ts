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

export type TexParagraphAlignment = ParagraphAlignment;
type TexSpaceGlueProfile = "font" | "tikz-fixed";

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

interface SimpleToken {
  readonly kind: "text" | "space" | "forced-break";
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly lineLeading?: string;
}

interface SimpleParagraphBlock {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly noIndent: boolean;
  readonly alignment?: TexParagraphAlignment;
  readonly alignmentProfile?: "latex-declaration";
}

interface SimpleParagraphSegment {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly noIndent: boolean;
  readonly forcedBreakAfter?: {
    readonly sourceOffset: number;
    readonly lineLeading?: string;
  };
}

interface SimpleParagraphBlockScanResult {
  readonly blocks: readonly SimpleParagraphBlock[];
  readonly unsupportedCommand: boolean;
}

interface TexParagraphBreakResult {
  readonly lines: readonly GreedyLine[];
  readonly runs: readonly ParagraphRun[];
  readonly runWidths: ReadonlyMap<number, number>;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly errors: readonly string[];
  readonly linebreakingMode: "feasible" | "overfull";
}

const unsupportedPattern = /[$&{}_^~#%]/;
const whitespacePattern = /[ \n]+/;
const paragraphBreakPattern = /^\n(?: *\n)+/;
const lineLeadingOptionPattern =
  /^\[\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:pt|pc|in|bp|cm|mm|dd|cc|sp|em|ex|mu)\s*\]/i;
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
  const blocks = splitSimpleTexParagraphBlocks(text).blocks;
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
  const reportAlignment = blocks[0]?.alignment ?? defaultAlignment;
  const combinedRuns: ParagraphRun[] = [];
  const combinedLines: GreedyLine[] = [];
  const combinedRunWidths = new Map<number, number>();
  const errors: string[] = [];
  let linebreakingMode: "feasible" | "overfull" = "feasible";
  let layoutMode: KnuthPlassLayoutMode = "wrap";
  let runIndexOffset = 0;
  let lineIndexOffset = 0;
  let activeAlignment = defaultAlignment;
  let activeAlignmentProfile: "latex-declaration" | undefined;
  let activeSpaceGlueProfile = texInitialSpaceGlueProfile(defaultAlignment);

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const inheritedAlignment = activeAlignment;
    const inheritedAlignmentProfile = activeAlignmentProfile;
    const alignment = block.alignment ?? activeAlignment;
    const alignmentProfile = block.alignment
      ? block.alignmentProfile
      : activeAlignmentProfile;
    if (block.alignment) {
      activeAlignment = block.alignment;
      activeAlignmentProfile = block.alignmentProfile;
      if (
        block.alignmentProfile === "latex-declaration" &&
        options.tikzTextWidthNode === true
      ) {
        activeSpaceGlueProfile = "tikz-fixed";
      }
    }
    const segments = splitSimpleTexParagraphSegments(
      block,
      options,
      alignment,
      blockIndex
    );
    if (segments.some((segment) => segment.forcedBreakAfter)) {
      layoutMode = "wrapped-explicit";
    }

    for (const segment of segments) {
      const blockShapedRuns = new Map<number, ShapedTexTextRun>();
      const tokens = tokenizeSimpleTexParagraph(segment.text, segment.sourceStart);
      const runs = tokensToRuns(
        tokens,
        font,
        blockShapedRuns,
        activeSpaceGlueProfile
      );
      if (!runs.some((run) => run.kind === "text")) {
        continue;
      }

      const broken = breakTexParagraphRuns({
        runs,
        shapedRuns: blockShapedRuns,
        measurement,
        options,
        alignment,
        alignmentProfile,
        inheritedAlignment,
        inheritedAlignmentProfile,
        noIndent: segment.noIndent,
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
        const forcedBreak =
          segment.forcedBreakAfter && line.lineIndex === broken.lines.length - 1
            ? createForcedBreakDecision(
                line.endRun + runIndexOffset + 1,
                segment.forcedBreakAfter
              )
            : undefined;
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
      alignment: reportAlignment,
      runs: combinedRuns,
      lines: combinedLines,
      shapedRuns,
      runWidths: combinedRunWidths,
      linebreakingMode,
      layoutMode,
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
  readonly alignmentProfile?: "latex-declaration";
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: "latex-declaration";
  readonly noIndent: boolean;
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
    params.inheritedAlignmentProfile
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
  forcedBreak: NonNullable<SimpleParagraphSegment["forcedBreakAfter"]>
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

export function getSimpleTexFallbackReason(text: string, width: number): string | null {
  if (!Number.isFinite(width) || width <= 0) {
    return "Paragraph width must be positive.";
  }
  if (unsupportedPattern.test(text)) {
    return "Paragraph contains TeX syntax that is not supported by the simple text path.";
  }
  if (splitSimpleTexParagraphBlocks(text).unsupportedCommand) {
    return "Paragraph contains TeX syntax that is not supported by the simple text path.";
  }
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\\") {
      const lineBreak = scanSimpleTexLineBreak(text, index);
      const paragraphCommand = scanSimpleTexParagraphCommand(text, index);
      if (lineBreak) {
        index = lineBreak.end - 1;
        continue;
      }
      if (paragraphCommand) {
        index = paragraphCommand.end - 1;
        continue;
      }
      if (!lineBreak) {
        return "Paragraph contains TeX syntax that is not supported by the simple text path.";
      }
    }
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

function scanSimpleTexLineBreak(
  text: string,
  start: number
): { end: number; lineLeading?: string } | null {
  if (text[start] !== "\\" || text[start + 1] !== "\\") {
    return null;
  }

  let end = start + 2;
  const rest = text.slice(end);
  if (rest.startsWith("[")) {
    const match = rest.match(lineLeadingOptionPattern);
    if (!match) {
      return null;
    }
    const full = match[0] ?? "";
    end += full.length;
    return {
      end,
      lineLeading: full.slice(1, -1).trim(),
    };
  }
  return { end };
}

function scanSimpleTexParagraphCommand(
  text: string,
  start: number
): { kind: "par" | "noindent"; end: number } | { kind: "alignment"; alignment: TexParagraphAlignment; end: number } | null {
  const parEnd = scanSimpleTexControlWord(text, start, "par");
  if (parEnd !== null) {
    return { kind: "par", end: parEnd };
  }
  const noIndentEnd = scanSimpleTexControlWord(text, start, "noindent");
  if (noIndentEnd !== null) {
    return { kind: "noindent", end: noIndentEnd };
  }
  return scanSimpleTexAlignmentCommand(text, start);
}

function scanSimpleTexAlignmentCommand(
  text: string,
  start: number
): { kind: "alignment"; alignment: TexParagraphAlignment; end: number } | null {
  const raggedRightEnd = scanSimpleTexControlWord(text, start, "raggedright");
  if (raggedRightEnd !== null) {
    return { kind: "alignment", alignment: "ragged-right", end: raggedRightEnd };
  }
  const raggedLeftEnd = scanSimpleTexControlWord(text, start, "raggedleft");
  if (raggedLeftEnd !== null) {
    return { kind: "alignment", alignment: "ragged-left", end: raggedLeftEnd };
  }
  const centeringEnd = scanSimpleTexControlWord(text, start, "centering");
  if (centeringEnd !== null) {
    return { kind: "alignment", alignment: "center", end: centeringEnd };
  }
  return null;
}

function scanSimpleTexControlWord(text: string, start: number, word: string): number | null {
  if (text[start] !== "\\") {
    return null;
  }
  const end = start + 1 + word.length;
  if (text.slice(start + 1, end) !== word) {
    return null;
  }
  const next = text[end] ?? "";
  return next && /[A-Za-z]/.test(next) ? null : end;
}

function splitSimpleTexParagraphBlocks(text: string): SimpleParagraphBlockScanResult {
  const blocks: SimpleParagraphBlock[] = [];
  let unsupportedCommand = false;

  const skipWhitespace = (start: number): number => {
    let index = start;
    while (index < text.length && (text[index] === " " || text[index] === "\n")) {
      index += 1;
    }
    return index;
  };

  const consumeParagraphPrefix = (
    start: number
  ): {
    start: number;
    noIndent: boolean;
    alignment?: TexParagraphAlignment;
    alignmentProfile?: "latex-declaration";
  } => {
    let index = skipWhitespace(start);
    let noIndent = false;
    let alignment: TexParagraphAlignment | undefined;
    let alignmentProfile: "latex-declaration" | undefined;
    while (index < text.length) {
      const command = scanSimpleTexParagraphCommand(text, index);
      if (command?.kind === "noindent") {
        noIndent = true;
        index = skipWhitespace(command.end);
        continue;
      }
      if (command?.kind === "alignment") {
        noIndent = true;
        alignment = command.alignment;
        alignmentProfile = "latex-declaration";
        index = skipWhitespace(command.end);
        continue;
      }
      break;
    }
    return {
      start: index,
      noIndent,
      alignment,
      alignmentProfile,
    };
  };

  const pushBlock = (
    rawStart: number,
    rawEnd: number,
    noIndent: boolean,
    alignment?: TexParagraphAlignment,
    alignmentProfile?: "latex-declaration"
  ) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && (text[start] === " " || text[start] === "\n")) {
      start += 1;
    }
    while (end > start && (text[end - 1] === " " || text[end - 1] === "\n")) {
      end -= 1;
    }
    if (start < end) {
      blocks.push({
        text: text.slice(start, end),
        sourceStart: start,
        sourceEnd: end,
        noIndent,
        alignment,
        alignmentProfile,
      });
    }
  };

  let prefix = consumeParagraphPrefix(0);
  let blockStart = prefix.start;
  let currentNoIndent = prefix.noIndent;
  let index = blockStart;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      const lineBreak = scanSimpleTexLineBreak(text, index);
      if (lineBreak) {
        index = lineBreak.end;
        continue;
      }
      const paragraphCommand = scanSimpleTexParagraphCommand(text, index);
      if (paragraphCommand?.kind === "par") {
        pushBlock(
          blockStart,
          index,
          currentNoIndent,
          prefix.alignment,
          prefix.alignmentProfile
        );
        prefix = consumeParagraphPrefix(paragraphCommand.end);
        blockStart = prefix.start;
        currentNoIndent = prefix.noIndent;
        index = blockStart;
        continue;
      }
      unsupportedCommand = true;
      break;
    }

    if (char === "\n") {
      const match = paragraphBreakPattern.exec(text.slice(index));
      if (match) {
        pushBlock(
          blockStart,
          index,
          currentNoIndent,
          prefix.alignment,
          prefix.alignmentProfile
        );
        prefix = consumeParagraphPrefix(index + match[0].length);
        blockStart = prefix.start;
        currentNoIndent = prefix.noIndent;
        index = blockStart;
        continue;
      }
    }

    index += 1;
  }
  if (!unsupportedCommand) {
    pushBlock(
      blockStart,
      text.length,
      currentNoIndent,
      prefix.alignment,
      prefix.alignmentProfile
    );
  }
  return { blocks, unsupportedCommand };
}

function splitSimpleTexParagraphSegments(
  block: SimpleParagraphBlock,
  options: TexParagraphLayoutOptions,
  alignment: TexParagraphAlignment,
  blockIndex: number
): SimpleParagraphSegment[] {
  const initialNoIndent = block.noIndent || (options.tikzTextWidthNode === true && blockIndex === 0);
  if (alignment === "justified") {
    return [{
      text: block.text,
      sourceStart: block.sourceStart,
      sourceEnd: block.sourceEnd,
      noIndent: initialNoIndent,
    }];
  }

  const segments: SimpleParagraphSegment[] = [];
  let segmentStart = 0;
  let noIndent = initialNoIndent;
  let index = 0;

  const pushSegment = (
    rawStart: number,
    rawEnd: number,
    segmentNoIndent: boolean,
    forcedBreakAfter?: SimpleParagraphSegment["forcedBreakAfter"]
  ) => {
    let start = rawStart;
    let end = rawEnd;
    while (start < end && (block.text[start] === " " || block.text[start] === "\n")) {
      start += 1;
    }
    while (end > start && (block.text[end - 1] === " " || block.text[end - 1] === "\n")) {
      end -= 1;
    }
    if (start < end) {
      segments.push({
        text: block.text.slice(start, end),
        sourceStart: block.sourceStart + start,
        sourceEnd: block.sourceStart + end,
        noIndent: segmentNoIndent,
        forcedBreakAfter,
      });
    }
  };

  while (index < block.text.length) {
    if (block.text[index] !== "\\") {
      index += 1;
      continue;
    }
    const lineBreak = scanSimpleTexLineBreak(block.text, index);
    if (!lineBreak) {
      index += 1;
      continue;
    }

    pushSegment(segmentStart, index, noIndent, {
      sourceOffset: block.sourceStart + index,
      lineLeading: lineBreak.lineLeading,
    });
    index = lineBreak.end;
    while (index < block.text.length && (block.text[index] === " " || block.text[index] === "\n")) {
      index += 1;
    }
    segmentStart = index;
    noIndent = noIndentAfterForcedBreak(options, alignment);
  }

  pushSegment(segmentStart, block.text.length, noIndent);
  return segments;
}

function noIndentAfterForcedBreak(
  options: TexParagraphLayoutOptions,
  alignment: TexParagraphAlignment
): boolean {
  return !(
    options.tikzTextWidthNode === true &&
    alignment !== "justified" &&
    Number.isFinite(options.parindent) &&
    options.parindent !== undefined &&
    options.parindent > 0
  );
}

function tokenizeSimpleTexParagraph(text: string, sourceOffset: number): SimpleToken[] {
  const tokens: SimpleToken[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      const lineBreak = scanSimpleTexLineBreak(text, index);
      if (!lineBreak) {
        break;
      }
      while (tokens.at(-1)?.kind === "space") {
        tokens.pop();
      }
      tokens.push({
        kind: "forced-break",
        text: text.slice(index, lineBreak.end),
        sourceStart: sourceOffset + index,
        sourceEnd: sourceOffset + lineBreak.end,
        lineLeading: lineBreak.lineLeading,
      });
      index = lineBreak.end;
      while (index < text.length && (text[index] === " " || text[index] === "\n")) {
        index += 1;
      }
      continue;
    }
    if (char === " " || char === "\n") {
      const start = index;
      while (index < text.length && (text[index] === " " || text[index] === "\n")) {
        index += 1;
      }
      tokens.push({
        kind: "space",
        text: " ",
        sourceStart: sourceOffset + start,
        sourceEnd: sourceOffset + index,
      });
      continue;
    }
    const start = index;
    while (
      index < text.length &&
      text[index] !== "\\" &&
      !whitespacePattern.test(text[index] ?? "")
    ) {
      index += 1;
    }
    tokens.push({
      kind: "text",
      text: text.slice(start, index),
      sourceStart: sourceOffset + start,
      sourceEnd: sourceOffset + index,
    });
  }
  return tokens;
}

function tokensToRuns(
  tokens: readonly SimpleToken[],
  font: ResolvedTexFont,
  shapedRuns: Map<number, ShapedTexTextRun>,
  spaceGlueProfile: TexSpaceGlueProfile
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
      : texInterwordGlueForSpaceFactor(font, spaceFactor, spaceGlueProfile);
    runs.push({
      kind: "space",
      runIndex,
      sourceStart: token.sourceStart,
      sourceEnd: token.sourceEnd,
      text: " ",
      wrapper: syntheticWrapper,
      breakRef: createSimpleBreakRef(forced, token.lineLeading),
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

function texInitialSpaceGlueProfile(
  alignment: TexParagraphAlignment
): TexSpaceGlueProfile {
  return alignment === "justified" ? "font" : "tikz-fixed";
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
  alignmentProfile?: "latex-declaration",
  inheritedAlignment?: TexParagraphAlignment,
  inheritedAlignmentProfile?: "latex-declaration"
): DpOptions {
  const latexRagged = alignment === "ragged-right" || alignment === "ragged-left";
  const latexDeclaration = alignmentProfile === "latex-declaration";
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
    leftskipWidth: 0,
    leftskipStretch:
      alignment === "ragged-left" || alignment === "center" ? skipStretch : 0,
    leftskipShrink: 0,
    rightskipWidth: 0,
    rightskipStretch:
      alignment === "ragged-right" || alignment === "center" ? skipStretch : 0,
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
  alignmentProfile?: "latex-declaration",
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
    break: line.break,
    segments,
  };
}
