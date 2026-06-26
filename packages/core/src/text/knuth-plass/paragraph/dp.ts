import { englishDefaults } from '../languages/en.js';
import type { ParagraphModel } from './items.js';
import type { DiscretionaryMeasurement } from './measure.js';
import type { BreakDecision, GreedyLine, TextRun } from './types.js';

export interface DpResult {
  lines: GreedyLine[];
  errors: string[];
  canProceed: boolean;
  totalCost: number;
  mode: 'feasible' | 'overfull';
}

export interface DpOptions {
  tolerance?: number;
  linepenalty?: number;
  adjdemerits?: number;
  doublehyphendemerits?: number;
  finalhyphendemerits?: number;
  leftskipWidth?: number;
  leftskipStretch?: number;
  leftskipShrink?: number;
  rightskipWidth?: number;
  rightskipStretch?: number;
  rightskipShrink?: number;
  emergencyStretch?: number;
  firstLineIndentWidth?: number;
  forcedBreakIndentWidth?: number;
  forcedBreakUsesParfill?: boolean;
  forcedBreakTerminalDemerits?: boolean;
  parfillskipWidth?: number;
  parfillskipStretch?: number;
  parfillskipShrink?: number;
  preventOverflow?: boolean;
  allowInfeasible?: boolean;
  allowLastResortOverfull?: boolean;
}

interface Cursor {
  runIndex: number;
  textOffset: number;
  pendingText?: string;
  pendingSourceStart?: number;
  pendingSourceEnd?: number;
  pendingWidth?: number;
}

interface SpacePenalty {
  penalty: number;
  sourceOffset: number;
}

interface ForcedPenalty {
  penalty: number;
  sourceOffset: number;
  lineLeading?: string;
}

interface GlueMetrics {
  stretch: number;
  shrink: number;
}

interface TextPenalty {
  penalty: number;
  sourceOffset: number;
  splitOffset: number;
  visibleHyphen: boolean;
  width: number;
  flagged: boolean;
  hyphenSource?: 'automatic' | 'explicit';
  discretionary?: DiscretionaryMeasurement;
}

interface BreakCandidate {
  endRun: number;
  endTextOffset: number | null;
  naturalWidth: number;
  spaceCount: number;
  spaceWidth: number;
  stretch: number;
  shrink: number;
  break: BreakDecision | null;
  breakPenalty: number;
  flagged: boolean;
  nextCursor: Cursor;
}

interface CandidateScore {
  badness: number;
  fitnessClass: FitnessClass;
  demerits: number;
  ratio: number;
  delta: number;
  lineNaturalWidth: number;
  spaceDeltaPerGap: number;
  xOffset: number;
  constraintViolation: boolean;
  artificial?: boolean;
}

interface ActiveChoice {
  candidate: BreakCandidate;
  fitnessClass: FitnessClass;
  score: CandidateScore;
}

interface ActiveState {
  id: number;
  cursor: Cursor;
  lineNumber: number;
  previousFitnessClass: FitnessClass | null;
  previousFlagged: boolean;
  cost: number;
  previousStateId: number | null;
  incomingChoice: ActiveChoice | null;
}

interface Breakpoint {
  key: string;
  runIndex: number;
  textOffset: number;
  kind: 'space' | 'hyphen' | 'forced' | 'final';
}

interface BreakpointBest {
  cost: number;
  fromState: ActiveState;
  choice: ActiveChoice;
}

type FitnessClass = 0 | 1 | 2 | 3; // very loose, loose, decent, tight

const MAX_RUNS_FOR_DP = 3000;
const MAX_BREAKPOINTS_FOR_DP = 1200;
const MAX_ESTIMATED_EDGES = 2_000_000;
const MAX_DP_STATES = 20000;
const INITIAL_FITNESS_CLASS: FitnessClass = 2; // TeX's root active node is decent_fit.
const FITNESS_CLASSES: readonly FitnessClass[] = [0, 1, 2, 3];
const SP_PER_PT = 65536;
const TEX_INF_BAD = 10000;
const DIMEN_EPSILON_PT = 2 / SP_PER_PT;

function toScaledPoint(value: number): number {
  return Math.max(0, Math.round(Math.abs(value) * SP_PER_PT));
}

function texBadness(delta: number, glue: number): number {
  const t = toScaledPoint(delta);
  const s = toScaledPoint(glue);
  if (t === 0) {
    return 0;
  }
  if (s <= 0) {
    return TEX_INF_BAD;
  }

  let r: number;
  if (t <= 7230584) {
    r = Math.floor((t * 297) / s);
  } else if (s >= 1663497) {
    r = Math.floor(t / Math.floor(s / 297));
  } else {
    r = t;
  }

  if (r > 1290) {
    return TEX_INF_BAD;
  }
  return Math.floor((r * r * r + 0o400000) / 0o1000000);
}

function badnessFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return TEX_INF_BAD;
  }
  return texBadness(Math.abs(ratio), 1);
}

function fitnessClassForBadness(
  badness: number,
  adjustment: 'stretch' | 'shrink' | 'none'
): FitnessClass {
  if (adjustment === 'stretch') {
    if (badness > 12) {
      return badness > 99 ? 0 : 1;
    }
    return 2;
  }
  if (adjustment === 'shrink') {
    return badness > 12 ? 3 : 2;
  }
  return 2;
}

function incompatibleFitness(a: FitnessClass, b: FitnessClass): boolean {
  return Math.abs(a - b) > 1;
}

function runWidth(model: ParagraphModel, runIndex: number): number {
  return model.runWidths.get(runIndex) ?? 0;
}

function normalizeCursor(
  model: ParagraphModel,
  cursor: Cursor,
  forcedPenalties: Map<number, ForcedPenalty>
): Cursor {
  let { runIndex, textOffset } = cursor;
  const pending = cursor.pendingText
    ? {
        pendingText: cursor.pendingText,
        pendingSourceStart: cursor.pendingSourceStart,
        pendingSourceEnd: cursor.pendingSourceEnd,
        pendingWidth: cursor.pendingWidth,
      }
    : {};

  while (runIndex < model.runs.length) {
    const run = model.runs[runIndex];
    if (run.kind === 'space') {
      if (forcedPenalties.has(runIndex)) {
        return { runIndex, textOffset: 0 };
      }
      runIndex += 1;
      textOffset = 0;
      continue;
    }

    if (run.kind === 'text') {
      if (textOffset >= run.text.length) {
        runIndex += 1;
        textOffset = 0;
        continue;
      }
      return { runIndex, textOffset, ...pending };
    }

    return { runIndex, textOffset: 0, ...pending };
  }

  return { runIndex: model.runs.length, textOffset: 0, ...pending };
}

function collectSpacePenalties(model: ParagraphModel): Map<number, SpacePenalty> {
  const map = new Map<number, SpacePenalty>();

  for (const item of model.items) {
    if (item.kind !== 'penalty') continue;
    if (item.payload.breakKind !== 'space') continue;
    if (item.penalty >= 10_000) continue;

    const runIndex = item.payload.runIndex;
    const existing = map.get(runIndex);
    if (!existing || item.penalty < existing.penalty) {
      map.set(runIndex, {
        penalty: item.penalty,
        sourceOffset: item.payload.sourceOffset,
      });
    }
  }

  return map;
}

function collectForcedPenalties(model: ParagraphModel): Map<number, ForcedPenalty> {
  const map = new Map<number, ForcedPenalty>();

  for (const item of model.items) {
    if (item.kind !== 'penalty') continue;
    if (item.payload.breakKind !== 'forced') continue;
    if (item.penalty > -10_000) continue;

    const runIndex = item.payload.runIndex;
    map.set(runIndex, {
      penalty: item.penalty,
      sourceOffset: item.payload.sourceOffset,
      lineLeading:
        item.payload.breakRef?.kind === 'mspace'
          ? item.payload.breakRef.lineLeading
          : undefined,
    });
  }

  return map;
}

function collectGlueMetrics(model: ParagraphModel): Map<number, GlueMetrics> {
  const map = new Map<number, GlueMetrics>();

  for (const item of model.items) {
    if (item.kind !== 'glue') continue;
    map.set(item.payload.runIndex, {
      stretch: item.stretch,
      shrink: item.shrink,
    });
  }

  return map;
}

function collectTextPenalties(model: ParagraphModel): Map<number, TextPenalty[]> {
  const map = new Map<number, TextPenalty[]>();

  for (const item of model.items) {
    if (item.kind !== 'penalty') continue;
    if (item.payload.breakKind !== 'hyphen') continue;
    if (item.penalty >= 10_000) continue;
    if (item.payload.splitOffset === undefined) continue;

    const runIndex = item.payload.runIndex;
    const list = map.get(runIndex) ?? [];
    list.push({
      penalty: item.penalty,
      sourceOffset: item.payload.sourceOffset,
      splitOffset: item.payload.splitOffset,
      visibleHyphen: item.payload.visibleHyphen,
      width: item.width,
      flagged: !!item.flagged,
      hyphenSource: item.payload.hyphenSource,
      discretionary: item.payload.discretionary,
    });
    map.set(runIndex, list);
  }

  for (const [runIndex, list] of map) {
    list.sort((a, b) => a.splitOffset - b.splitOffset);
    const deduped: TextPenalty[] = [];

    for (const item of list) {
      const prev = deduped.at(-1);
      if (prev?.splitOffset !== item.splitOffset) {
        deduped.push(item);
      } else if (item.penalty < prev.penalty) {
        deduped[deduped.length - 1] = item;
      }
    }

    map.set(runIndex, deduped);
  }

  return map;
}

function textSliceWidth(
  model: ParagraphModel,
  run: TextRun,
  start: number,
  end: number
): number {
  if (end <= start) return 0;
  if (model.measurement.measureSlice) {
    return model.measurement.measureSlice(run.text, start, end, run.wrapper);
  }
  const endWidth = model.measurement.measurePrefix(run.text, end, run.wrapper);
  const startWidth = model.measurement.measurePrefix(run.text, start, run.wrapper);
  return endWidth - startWidth;
}

function generateCandidates(
  model: ParagraphModel,
  startCursor: Cursor,
  forcedPenalties: Map<number, ForcedPenalty>,
  spacePenalties: Map<number, SpacePenalty>,
  glueMetrics: Map<number, GlueMetrics>,
  textPenalties: Map<number, TextPenalty[]>
): BreakCandidate[] {
  const candidates: BreakCandidate[] = [];
  const cursor = normalizeCursor(model, startCursor, forcedPenalties);

  if (cursor.runIndex >= model.runs.length) {
    return candidates;
  }

  let naturalWidth = 0;
  let spaceCount = 0;
  let spaceWidth = 0;
  let stretch = 0;
  let shrink = 0;

  let naturalWidthWithoutTrailingSpaces = 0;
  let spaceCountWithoutTrailingSpaces = 0;
  let spaceWidthWithoutTrailingSpaces = 0;
  let stretchWithoutTrailingSpaces = 0;
  let shrinkWithoutTrailingSpaces = 0;
  let lastNonSpaceRun = -1;
  let stoppedAtForcedBoundary = false;

  if (cursor.pendingText) {
    naturalWidth = cursor.pendingWidth ?? model.measurement.measureText(cursor.pendingText, null);
    naturalWidthWithoutTrailingSpaces = naturalWidth;
    lastNonSpaceRun = cursor.runIndex;
  }

  for (let runIndex = cursor.runIndex; runIndex < model.runs.length; runIndex++) {
    const run = model.runs[runIndex];

    if (run.kind === 'text') {
      const offset = runIndex === cursor.runIndex ? cursor.textOffset : 0;
      const runTextPenalties = textPenalties.get(runIndex) ?? [];

      for (const textPenalty of runTextPenalties) {
        if (textPenalty.splitOffset <= offset || textPenalty.splitOffset >= run.text.length) {
          continue;
        }

        const replaceStart = textPenalty.discretionary?.replaceStart ?? textPenalty.splitOffset;
        if (replaceStart < offset) {
          continue;
        }
        const prefixWidth = textSliceWidth(model, run, offset, replaceStart);
        const preBreakWidth = textPenalty.discretionary?.preBreakWidth ?? textPenalty.width;
        const discretionary = textPenalty.discretionary;
        const nextTextOffset = discretionary?.postBreakText
          ? discretionary.replaceEnd
          : textPenalty.splitOffset;
        const pendingText = discretionary?.postBreakText ?? undefined;
        candidates.push({
          endRun: runIndex,
          endTextOffset: textPenalty.splitOffset,
          naturalWidth: naturalWidth + prefixWidth + preBreakWidth,
          spaceCount,
          spaceWidth,
          stretch,
          shrink,
          break: {
            kind: 'hyphen',
            runIndex,
            sourceOffset: textPenalty.sourceOffset,
            visibleHyphen: textPenalty.visibleHyphen,
            splitOffset: textPenalty.splitOffset,
            hyphenSource: textPenalty.hyphenSource,
            flagged: textPenalty.flagged,
            width: textPenalty.width,
            discretionary: textPenalty.discretionary,
          },
          breakPenalty: textPenalty.penalty,
          flagged: textPenalty.flagged,
          nextCursor: normalizeCursor(model, {
            runIndex,
            textOffset: nextTextOffset,
            pendingText,
            pendingSourceStart: pendingText
              ? run.sourceStart + textPenalty.splitOffset
              : undefined,
            pendingSourceEnd: pendingText
              ? run.sourceStart + (discretionary?.replaceEnd ?? textPenalty.splitOffset)
              : undefined,
            pendingWidth: pendingText
              ? model.measurement.measureText(pendingText, run.wrapper)
              : undefined,
          }, forcedPenalties),
        });
      }

      const remaining = textSliceWidth(model, run, offset, run.text.length);
      naturalWidth += remaining;
      naturalWidthWithoutTrailingSpaces = naturalWidth;
      spaceCountWithoutTrailingSpaces = spaceCount;
      spaceWidthWithoutTrailingSpaces = spaceWidth;
      stretchWithoutTrailingSpaces = stretch;
      shrinkWithoutTrailingSpaces = shrink;
      lastNonSpaceRun = runIndex;
      continue;
    }

    if (run.kind === 'space') {
      const forcedPenalty = forcedPenalties.get(runIndex);
      if (forcedPenalty) {
        const isEmptyLine = runIndex === cursor.runIndex && lastNonSpaceRun < cursor.runIndex;
        const forcedWidth = isEmptyLine ? runWidth(model, runIndex) : 0;
        candidates.push({
          endRun: isEmptyLine ? runIndex : Math.max(cursor.runIndex, runIndex - 1),
          endTextOffset: null,
          naturalWidth: isEmptyLine ? forcedWidth : naturalWidthWithoutTrailingSpaces,
          spaceCount: isEmptyLine ? 0 : spaceCountWithoutTrailingSpaces,
          spaceWidth: isEmptyLine ? 0 : spaceWidthWithoutTrailingSpaces,
          stretch: isEmptyLine ? 0 : stretchWithoutTrailingSpaces,
          shrink: isEmptyLine ? 0 : shrinkWithoutTrailingSpaces,
          break: {
            kind: 'forced',
            runIndex,
            sourceOffset: forcedPenalty.sourceOffset,
            visibleHyphen: false,
            flagged: false,
            lineLeading: forcedPenalty.lineLeading,
          },
          breakPenalty: forcedPenalty.penalty,
          flagged: false,
          nextCursor: normalizeCursor(model, {
            runIndex: runIndex + 1,
            textOffset: 0,
          }, forcedPenalties),
        });
        stoppedAtForcedBoundary = true;
        break;
      }

      const spacePenalty = spacePenalties.get(runIndex);
      const previousRun = runIndex > 0 ? model.runs[runIndex - 1] : null;
      if (spacePenalty && previousRun && previousRun.kind !== 'space') {
        candidates.push({
          endRun: runIndex - 1,
          endTextOffset: null,
          naturalWidth,
          spaceCount,
          spaceWidth,
          stretch,
          shrink,
          break: {
            kind: 'space',
            runIndex,
            sourceOffset: spacePenalty.sourceOffset,
            visibleHyphen: false,
            flagged: false,
          },
          breakPenalty: spacePenalty.penalty,
          flagged: false,
          nextCursor: normalizeCursor(model, {
            runIndex: runIndex + 1,
            textOffset: 0,
          }, forcedPenalties),
        });
      }

      const width = runWidth(model, runIndex);
      naturalWidth += width;
      spaceCount += 1;
      spaceWidth += width;
      const glue = glueMetrics.get(runIndex);
      stretch += glue?.stretch ?? 0;
      shrink += glue?.shrink ?? 0;
      continue;
    }

    if (run.kind === 'penalty') {
      const spacePenalty = spacePenalties.get(runIndex);
      const previousRun = runIndex > 0 ? model.runs[runIndex - 1] : null;
      if (spacePenalty && previousRun && previousRun.kind !== 'space') {
        candidates.push({
          endRun: Math.max(cursor.runIndex, runIndex - 1),
          endTextOffset: null,
          naturalWidth,
          spaceCount,
          spaceWidth,
          stretch,
          shrink,
          break: {
            kind: 'space',
            runIndex,
            sourceOffset: spacePenalty.sourceOffset,
            visibleHyphen: false,
            flagged: false,
          },
          breakPenalty: spacePenalty.penalty,
          flagged: false,
          nextCursor: normalizeCursor(model, {
            runIndex: runIndex + 1,
            textOffset: 0,
          }, forcedPenalties),
        });
      }
      continue;
    }

    naturalWidth += runWidth(model, runIndex);
    stretch += run.texGlue?.stretch ?? 0;
    shrink += run.texGlue?.shrink ?? 0;
    naturalWidthWithoutTrailingSpaces = naturalWidth;
    spaceCountWithoutTrailingSpaces = spaceCount;
    spaceWidthWithoutTrailingSpaces = spaceWidth;
    stretchWithoutTrailingSpaces = stretch;
    shrinkWithoutTrailingSpaces = shrink;
    lastNonSpaceRun = runIndex;
  }

  if (!stoppedAtForcedBoundary && lastNonSpaceRun >= cursor.runIndex) {
    candidates.push({
      endRun: lastNonSpaceRun,
      endTextOffset: null,
      naturalWidth: naturalWidthWithoutTrailingSpaces,
      spaceCount: spaceCountWithoutTrailingSpaces,
      spaceWidth: spaceWidthWithoutTrailingSpaces,
      stretch: stretchWithoutTrailingSpaces,
      shrink: shrinkWithoutTrailingSpaces,
      break: null,
      breakPenalty: -10_000,
      flagged: false,
      nextCursor: { runIndex: model.runs.length, textOffset: 0 },
    });
  }

  return candidates;
}

function lineIndentWidth(
  options: Pick<DpOptions, 'firstLineIndentWidth' | 'forcedBreakIndentWidth'>,
  isFirstLine: boolean,
  followsForcedBreak: boolean
): number {
  if (isFirstLine) {
    return options.firstLineIndentWidth ?? 0;
  }
  return followsForcedBreak ? options.forcedBreakIndentWidth ?? 0 : 0;
}

function scoreCandidate(
  candidate: BreakCandidate,
  width: number,
  tolerance: number,
  options: Required<
    Pick<
      DpOptions,
      | 'linepenalty'
      | 'leftskipWidth'
      | 'leftskipStretch'
      | 'leftskipShrink'
      | 'rightskipWidth'
      | 'rightskipStretch'
      | 'rightskipShrink'
      | 'emergencyStretch'
      | 'firstLineIndentWidth'
      | 'forcedBreakIndentWidth'
      | 'forcedBreakUsesParfill'
      | 'parfillskipWidth'
      | 'parfillskipStretch'
      | 'parfillskipShrink'
      | 'preventOverflow'
      | 'allowInfeasible'
    >
  >,
  isFirstLine: boolean,
  followsForcedBreak: boolean,
  isLastLine: boolean
): CandidateScore | null {
  const isForcedBreak = candidate.break?.kind === 'forced';
  const usesParfill = isLastLine || (isForcedBreak && options.forcedBreakUsesParfill);
  const indentWidth = lineIndentWidth(options, isFirstLine, followsForcedBreak);
  const lineNaturalWidth =
    candidate.naturalWidth +
    options.leftskipWidth +
    options.rightskipWidth +
    indentWidth +
    (usesParfill ? options.parfillskipWidth : 0);

  const totalStretch =
    candidate.stretch +
    options.leftskipStretch +
    options.rightskipStretch +
    options.emergencyStretch +
    (usesParfill ? options.parfillskipStretch : 0);
  const outputStretch =
    candidate.stretch +
    options.leftskipStretch +
    options.rightskipStretch +
    (usesParfill ? options.parfillskipStretch : 0);
  const totalShrink =
    candidate.shrink +
    options.leftskipShrink +
    options.rightskipShrink +
    (usesParfill ? options.parfillskipShrink : 0);

  const rawDelta = width - lineNaturalWidth;
  const delta = Math.abs(rawDelta) <= DIMEN_EPSILON_PT ? 0 : rawDelta;
  let ratio = 0;
  let badness = 0;
  let feasible = true;
  let constraintViolation = false;
  let adjustment: 'stretch' | 'shrink' | 'none' = 'none';

  if (delta > 0) {
    adjustment = 'stretch';
    if (!Number.isFinite(totalStretch)) {
      ratio = 0;
      badness = 0;
    } else if (totalStretch <= 0) {
      feasible = false;
      if (options.allowInfeasible) {
        ratio = Number.POSITIVE_INFINITY;
        badness = 10_000;
      } else {
        ratio = Number.POSITIVE_INFINITY;
        badness = 10_000;
      }
    } else {
      ratio = delta / totalStretch;
      badness = texBadness(delta, totalStretch);
    }
  } else if (delta < 0) {
    adjustment = 'shrink';
    const overflow = -delta;
    if (!Number.isFinite(totalShrink) || totalShrink <= 0 || overflow > totalShrink) {
      feasible = false;
      if (options.allowInfeasible) {
        ratio = delta / Math.max(width, 1);
        badness = badnessFromRatio(ratio);
      } else {
        ratio = Number.NEGATIVE_INFINITY;
        badness = TEX_INF_BAD + 1;
      }
    } else {
      ratio = delta / totalShrink;
      badness = texBadness(overflow, totalShrink);
    }
  }

  const forcedLooseBreak = isForcedBreak && delta >= 0;

  if (!feasible && !options.allowInfeasible && !forcedLooseBreak) {
    return null;
  }

  if (delta < 0 && options.preventOverflow && !options.allowInfeasible) {
    return null;
  }

  if (badness > tolerance && !options.allowInfeasible && !forcedLooseBreak) {
    return null;
  }

  if (options.allowInfeasible) {
    if (!feasible || (delta < 0 && options.preventOverflow) || badness > tolerance) {
      constraintViolation = true;
    }
    // In canonical overfull mode we still want TeX-like behavior for ragged
    // paragraph profiles: overflowing a line should be a last resort.
    if (delta < 0 && (!feasible || options.preventOverflow)) {
      const overflow = -delta;
      badness += 20_000 + Math.floor((overflow / Math.max(width, 1)) * 10_000);
    }
    if (delta < 0 && candidate.spaceWidth > 0) {
      const overflowAfterSpaceClamp = Math.max(0, -delta - candidate.spaceWidth);
      if (overflowAfterSpaceClamp > 0) {
        badness +=
          20_000 +
          Math.floor((overflowAfterSpaceClamp / Math.max(width, 1)) * 10_000);
      }
    }

    if (!Number.isFinite(ratio)) {
      badness = Math.max(badness, 20_000);
    } else {
      const severity = Math.max(0, Math.abs(ratio) - 4.64);
      if (severity > 0) {
        badness += Math.floor(100 * severity * severity + 0.5);
      }
    }

    const isLikelyJustified =
      options.leftskipStretch === 0 &&
      options.leftskipShrink === 0 &&
      options.rightskipStretch === 0 &&
      options.rightskipShrink === 0;
    if (isLikelyJustified && !isLastLine && candidate.spaceCount === 0) {
      badness += 20_000;
    }
  }

  const fitnessClass = fitnessClassForBadness(badness, adjustment);
  const linePenalty = options.linepenalty + badness;
  const penalty = isLastLine || isForcedBreak ? -10_000 : candidate.breakPenalty;

  if (penalty >= 10_000) {
    return null;
  }

  const outputRatio =
    delta > 0
      ? !Number.isFinite(outputStretch)
        ? 0
        : outputStretch > 0
          ? delta / outputStretch
          : ratio
      : delta < 0
        ? !Number.isFinite(totalShrink)
          ? 0
          : totalShrink > 0
            ? delta / totalShrink
            : ratio
        : 0;

  const base = Math.abs(linePenalty) >= 10_000 ? 100_000_000 : linePenalty * linePenalty;
  let demerits = base;

  if (penalty >= 0) {
    demerits += penalty * penalty;
  } else if (penalty > -10_000) {
    demerits -= penalty * penalty;
  }

  let xOffset = options.leftskipWidth + indentWidth;
  if (delta > 0 && !Number.isFinite(outputStretch)) {
    const infiniteLeftskip = !Number.isFinite(options.leftskipStretch) ? 1 : 0;
    const infiniteRightskip = !Number.isFinite(options.rightskipStretch) ? 1 : 0;
    const infiniteParfill =
      usesParfill && !Number.isFinite(options.parfillskipStretch) ? 1 : 0;
    const infiniteStretch =
      infiniteLeftskip + infiniteRightskip + infiniteParfill;
    if (infiniteStretch > 0 && infiniteLeftskip > 0) {
      xOffset += delta / infiniteStretch;
    }
  } else if (
    outputRatio > 0 &&
    Number.isFinite(outputRatio) &&
    Number.isFinite(options.leftskipStretch) &&
    options.leftskipStretch !== 0
  ) {
    xOffset += outputRatio * options.leftskipStretch;
  } else if (
    outputRatio < 0 &&
    Number.isFinite(outputRatio) &&
    Number.isFinite(options.leftskipShrink) &&
    options.leftskipShrink !== 0
  ) {
    xOffset += outputRatio * options.leftskipShrink;
  }

  return {
    badness,
    fitnessClass,
    demerits,
    ratio: outputRatio,
    delta,
    lineNaturalWidth,
    spaceDeltaPerGap:
      candidate.spaceCount > 0
        ? outputRatio > 0
          ? Number.isFinite(candidate.stretch)
            ? (outputRatio * candidate.stretch) / candidate.spaceCount
            : 0
          : outputRatio < 0
            ? Number.isFinite(candidate.shrink)
              ? (outputRatio * candidate.shrink) / candidate.spaceCount
              : 0
            : 0
        : 0,
    xOffset: Number.isFinite(xOffset) ? xOffset : 0,
    constraintViolation,
  };
}

function breakpointKeyForCandidate(candidate: BreakCandidate): string {
  if (!candidate.break) {
    return 'final';
  }
  if (candidate.break.kind === 'hyphen') {
    return `hyphen:${candidate.break.runIndex}:${candidate.break.splitOffset ?? -1}`;
  }
  return `${candidate.break.kind}:${candidate.break.runIndex}`;
}

function collectBreakpoints(params: {
  model: ParagraphModel;
  forcedPenalties: Map<number, ForcedPenalty>;
  spacePenalties: Map<number, SpacePenalty>;
  textPenalties: Map<number, TextPenalty[]>;
}): Breakpoint[] {
  const breakpoints = new Map<string, Breakpoint>();
  for (const runIndex of params.spacePenalties.keys()) {
    const key = `space:${runIndex}`;
    breakpoints.set(key, { key, runIndex, textOffset: 0, kind: 'space' });
  }
  for (const runIndex of params.forcedPenalties.keys()) {
    const key = `forced:${runIndex}`;
    breakpoints.set(key, { key, runIndex, textOffset: 0, kind: 'forced' });
  }
  for (const [runIndex, penalties] of params.textPenalties) {
    for (const penalty of penalties) {
      const key = `hyphen:${runIndex}:${penalty.splitOffset}`;
      breakpoints.set(key, {
        key,
        runIndex,
        textOffset: penalty.splitOffset,
        kind: 'hyphen',
      });
    }
  }
  breakpoints.set('final', {
    key: 'final',
    runIndex: params.model.runs.length,
    textOffset: 0,
    kind: 'final',
  });

  return [...breakpoints.values()].sort((a, b) => {
    if (a.runIndex !== b.runIndex) {
      return a.runIndex - b.runIndex;
    }
    if (a.textOffset !== b.textOffset) {
      return a.textOffset - b.textOffset;
    }
    return a.key.localeCompare(b.key);
  });
}

function totalCostForTransition(
  state: ActiveState,
  candidate: BreakCandidate,
  score: CandidateScore,
  options: Required<
    Pick<
      DpOptions,
      | 'adjdemerits'
      | 'doublehyphendemerits'
      | 'finalhyphendemerits'
      | 'forcedBreakTerminalDemerits'
    >
  >,
  isLastLine: boolean
): number {
  if (score.artificial) {
    return state.cost;
  }
  let totalCost = state.cost + score.demerits;
  if (
    state.previousFitnessClass !== null &&
    incompatibleFitness(state.previousFitnessClass, score.fitnessClass)
  ) {
    totalCost += options.adjdemerits;
  }
  if (state.previousFlagged) {
    if (
      isLastLine ||
      (options.forcedBreakTerminalDemerits && candidate.break?.kind === 'forced')
    ) {
      totalCost += options.finalhyphendemerits;
    } else if (candidate.flagged) {
      totalCost += options.doublehyphendemerits;
    }
  }
  return totalCost;
}

function candidateIsTooTightForFuture(
  candidate: BreakCandidate,
  width: number,
  options: Required<
    Pick<
      DpOptions,
      | 'leftskipWidth'
      | 'leftskipShrink'
      | 'rightskipWidth'
      | 'rightskipShrink'
      | 'firstLineIndentWidth'
      | 'forcedBreakIndentWidth'
      | 'forcedBreakUsesParfill'
      | 'parfillskipWidth'
      | 'parfillskipShrink'
      | 'preventOverflow'
      | 'allowInfeasible'
    >
  >,
  isFirstLine: boolean,
  followsForcedBreak: boolean,
  isLastLine: boolean
): boolean {
  if (options.allowInfeasible) {
    return false;
  }
  const isForcedBreak = candidate.break?.kind === 'forced';
  const usesParfill = isLastLine || (isForcedBreak && options.forcedBreakUsesParfill);
  const indentWidth = lineIndentWidth(options, isFirstLine, followsForcedBreak);
  const lineNaturalWidth =
    candidate.naturalWidth +
    options.leftskipWidth +
    options.rightskipWidth +
    indentWidth +
    (usesParfill ? options.parfillskipWidth : 0);
  const totalShrink =
    candidate.shrink +
    options.leftskipShrink +
    options.rightskipShrink +
    (usesParfill ? options.parfillskipShrink : 0);
  return lineNaturalWidth > width + totalShrink + DIMEN_EPSILON_PT;
}

function artificialOverfullScore(
  candidate: BreakCandidate,
  width: number,
  options: Required<
    Pick<
      DpOptions,
      | 'leftskipWidth'
      | 'leftskipStretch'
      | 'leftskipShrink'
      | 'rightskipWidth'
      | 'rightskipStretch'
      | 'rightskipShrink'
      | 'firstLineIndentWidth'
      | 'forcedBreakIndentWidth'
      | 'forcedBreakUsesParfill'
      | 'parfillskipWidth'
      | 'parfillskipStretch'
      | 'parfillskipShrink'
    >
  >,
  isFirstLine: boolean,
  followsForcedBreak: boolean,
  isLastLine: boolean
): CandidateScore {
  const isForcedBreak = candidate.break?.kind === 'forced';
  const usesParfill = isLastLine || (isForcedBreak && options.forcedBreakUsesParfill);
  const indentWidth = lineIndentWidth(options, isFirstLine, followsForcedBreak);
  const lineNaturalWidth =
    candidate.naturalWidth +
    options.leftskipWidth +
    options.rightskipWidth +
    indentWidth +
    (usesParfill ? options.parfillskipWidth : 0);
  const totalShrink =
    candidate.shrink +
    options.leftskipShrink +
    options.rightskipShrink +
    (usesParfill ? options.parfillskipShrink : 0);
  const rawDelta = width - lineNaturalWidth;
  const delta = Math.abs(rawDelta) <= DIMEN_EPSILON_PT ? 0 : rawDelta;
  const ratio = totalShrink > 0 && Number.isFinite(totalShrink)
    ? delta / totalShrink
    : Number.NEGATIVE_INFINITY;
  let xOffset = options.leftskipWidth + indentWidth;
  if (
    ratio < 0 &&
    Number.isFinite(ratio) &&
    Number.isFinite(options.leftskipShrink) &&
    options.leftskipShrink !== 0
  ) {
    xOffset += ratio * options.leftskipShrink;
  }

  return {
    badness: TEX_INF_BAD + 1,
    fitnessClass: 3,
    demerits: 0,
    ratio,
    delta,
    lineNaturalWidth,
    spaceDeltaPerGap:
      candidate.spaceCount > 0 && Number.isFinite(ratio) && Number.isFinite(candidate.shrink)
        ? (ratio * candidate.shrink) / candidate.spaceCount
        : 0,
    xOffset: Number.isFinite(xOffset) ? xOffset : 0,
    constraintViolation: true,
    artificial: true,
  };
}

export function breakWithDp(
  model: ParagraphModel,
  width: number,
  options: DpOptions = {}
): DpResult {
  const errors: string[] = [];

  if (width <= 0) {
    return {
      lines: [],
      errors: ['Target width is non-positive; DP linebreaking skipped.'],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'overfull' : 'feasible',
    };
  }

  if (model.runs.length > MAX_RUNS_FOR_DP) {
    return {
      lines: [],
      errors: [
        `Pathological DP size: ${model.runs.length} runs exceeds limit ${MAX_RUNS_FOR_DP}.`,
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'overfull' : 'feasible',
    };
  }

  const forcedPenalties = collectForcedPenalties(model);
  const firstCursor = normalizeCursor(
    model,
    { runIndex: 0, textOffset: 0 },
    forcedPenalties
  );
  if (firstCursor.runIndex >= model.runs.length) {
    return {
      lines: [],
      errors: ['Paragraph has no breakable content after trimming leading spaces.'],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'overfull' : 'feasible',
    };
  }

  const spacePenalties = collectSpacePenalties(model);
  const glueMetrics = collectGlueMetrics(model);
  const textPenalties = collectTextPenalties(model);

  const totalBreakpoints =
    forcedPenalties.size +
    spacePenalties.size +
    [...textPenalties.values()].reduce((sum, list) => sum + list.length, 0);

  if (totalBreakpoints > MAX_BREAKPOINTS_FOR_DP) {
    return {
      lines: [],
      errors: [
        `Pathological DP size: ${totalBreakpoints} breakpoints exceeds limit ${MAX_BREAKPOINTS_FOR_DP}.`,
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'overfull' : 'feasible',
    };
  }

  const estimatedEdges =
    (model.runs.length + totalBreakpoints + 1) * (totalBreakpoints + 1);
  if (estimatedEdges > MAX_ESTIMATED_EDGES) {
    return {
      lines: [],
      errors: [
        `Pathological DP graph: estimated ${estimatedEdges} edges exceeds limit ${MAX_ESTIMATED_EDGES}.`,
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: options.allowInfeasible ? 'overfull' : 'feasible',
    };
  }

  const resolvedOptions = {
    tolerance: options.tolerance ?? englishDefaults.tolerance,
    linepenalty: options.linepenalty ?? englishDefaults.linepenalty,
    adjdemerits: options.adjdemerits ?? englishDefaults.adjdemerits,
    doublehyphendemerits:
      options.doublehyphendemerits ?? englishDefaults.doublehyphendemerits,
    finalhyphendemerits:
      options.finalhyphendemerits ?? englishDefaults.finalhyphendemerits,
    leftskipWidth: options.leftskipWidth ?? 0,
    leftskipStretch: options.leftskipStretch ?? 0,
    leftskipShrink: options.leftskipShrink ?? 0,
    rightskipWidth: options.rightskipWidth ?? 0,
    rightskipStretch: options.rightskipStretch ?? width,
    rightskipShrink: options.rightskipShrink ?? 0,
    emergencyStretch: options.emergencyStretch ?? 0,
    firstLineIndentWidth: options.firstLineIndentWidth ?? 0,
    forcedBreakIndentWidth: options.forcedBreakIndentWidth ?? 0,
    forcedBreakUsesParfill: options.forcedBreakUsesParfill ?? false,
    forcedBreakTerminalDemerits: options.forcedBreakTerminalDemerits ?? false,
    parfillskipWidth: options.parfillskipWidth ?? 0,
    parfillskipStretch: options.parfillskipStretch ?? Number.POSITIVE_INFINITY,
    parfillskipShrink: options.parfillskipShrink ?? 0,
    preventOverflow: options.preventOverflow ?? false,
    allowInfeasible: options.allowInfeasible ?? false,
    allowLastResortOverfull: options.allowLastResortOverfull ?? false,
  };

  const breakpoints = collectBreakpoints({
    model,
    forcedPenalties,
    spacePenalties,
    textPenalties,
  });
  const states = new Map<number, ActiveState>();
  let activeStates: ActiveState[] = [];
  let nextStateId = 1;
  const rootState: ActiveState = {
    id: 0,
    cursor: firstCursor,
    lineNumber: 1,
    previousFitnessClass: INITIAL_FITNESS_CLASS,
    previousFlagged: false,
    cost: 0,
    previousStateId: null,
    incomingChoice: null,
  };
  states.set(0, rootState);
  activeStates.push(rootState);
  let bestFinal:
    | {
        cost: number;
        fromStateId: number;
        choice: ActiveChoice;
      }
    | null = null;

  for (const breakpoint of breakpoints) {
    if (activeStates.length === 0) {
      break;
    }

    const newStates: ActiveState[] = [];
    const deactivatedStateIds = new Set<number>();

    const bestByFitness = new Map<FitnessClass, BreakpointBest>();
    let minimumDemerits = Infinity;

    for (let stateIndex = 0; stateIndex < activeStates.length; stateIndex++) {
      const state = activeStates[stateIndex];
      const candidate = generateCandidates(
        model,
        state.cursor,
        forcedPenalties,
        spacePenalties,
        glueMetrics,
        textPenalties
      ).find((item) => breakpointKeyForCandidate(item) === breakpoint.key);
      if (!candidate) {
        continue;
      }

      const isLastLine = breakpoint.kind === 'final';
      const isFirstLine = state.lineNumber === 1;
      const followsForcedBreak = state.incomingChoice?.candidate.break?.kind === 'forced';
      const score = scoreCandidate(
        candidate,
        width,
        resolvedOptions.tolerance,
        resolvedOptions,
        isFirstLine,
        followsForcedBreak,
        isLastLine
      );
      if (!score) {
        const tooTight = candidateIsTooTightForFuture(
          candidate,
          width,
          resolvedOptions,
          isFirstLine,
          followsForcedBreak,
          isLastLine
        );
        if (tooTight) {
          deactivatedStateIds.add(state.id);
        }
        if (
          resolvedOptions.allowLastResortOverfull &&
          tooTight &&
          !Number.isFinite(minimumDemerits) &&
          stateIndex === activeStates.length - 1 &&
          activeStates
            .slice(0, stateIndex)
            .every((previousState) => deactivatedStateIds.has(previousState.id))
        ) {
          const artificialScore = artificialOverfullScore(
            candidate,
            width,
            resolvedOptions,
            isFirstLine,
            followsForcedBreak,
            isLastLine
          );
          const choice: ActiveChoice = {
            candidate,
            fitnessClass: artificialScore.fitnessClass,
            score: artificialScore,
          };
          if (isLastLine) {
            bestFinal = {
              cost: state.cost,
              fromStateId: state.id,
              choice,
            };
            continue;
          }
          bestByFitness.set(artificialScore.fitnessClass, {
            cost: state.cost,
            fromState: state,
            choice,
          });
          minimumDemerits = state.cost;
        }
        continue;
      }

      const choice: ActiveChoice = {
        candidate,
        fitnessClass: score.fitnessClass,
        score,
      };
      const totalCost = totalCostForTransition(
        state,
        candidate,
        score,
        resolvedOptions,
        isLastLine
      );
      const candidateNextCursor = normalizeCursor(
        model,
        candidate.nextCursor,
        forcedPenalties
      );
      const isTerminalForcedBreak =
        breakpoint.kind === 'forced' &&
        candidateNextCursor.runIndex >= model.runs.length;
      if (isLastLine || isTerminalForcedBreak) {
        if (
          bestFinal === null ||
          totalCost < bestFinal.cost ||
          totalCost === bestFinal.cost
        ) {
          bestFinal = {
            cost: totalCost,
            fromStateId: state.id,
            choice,
          };
        }
        continue;
      }

      const existing = bestByFitness.get(score.fitnessClass);
      if (
        !existing ||
        totalCost < existing.cost ||
        totalCost === existing.cost
      ) {
        bestByFitness.set(score.fitnessClass, {
          cost: totalCost,
          fromState: state,
          choice,
        });
      }
      if (totalCost < minimumDemerits) {
        minimumDemerits = totalCost;
      }
    }

    if (Number.isFinite(minimumDemerits)) {
      const activeThreshold = minimumDemerits + Math.abs(resolvedOptions.adjdemerits);
      for (const fitnessClass of FITNESS_CLASSES) {
        const best = bestByFitness.get(fitnessClass);
        if (!best) {
          continue;
        }
        if (best.cost > activeThreshold) {
          continue;
        }
        const nextCursor = normalizeCursor(
          model,
          best.choice.candidate.nextCursor,
          forcedPenalties
        );
        const allocatedStateId = nextStateId++;
        const nextState: ActiveState = {
          id: allocatedStateId,
          cursor: nextCursor,
          lineNumber: best.fromState.lineNumber + 1,
          previousFitnessClass: fitnessClass,
          previousFlagged: best.choice.candidate.flagged,
          cost: best.cost,
          previousStateId: best.fromState.id,
          incomingChoice: best.choice,
        };
        states.set(allocatedStateId, nextState);
        newStates.push(nextState);
        if (states.size > MAX_DP_STATES) {
          return {
            lines: [],
            errors: [`DP state limit exceeded (${MAX_DP_STATES}).`],
            canProceed: false,
            totalCost: Infinity,
            mode: resolvedOptions.allowInfeasible ? 'overfull' : 'feasible',
          };
        }
      }
    }

    if (breakpoint.kind === 'forced') {
      activeStates = newStates;
    } else {
      activeStates = [
        ...activeStates.filter((state) => !deactivatedStateIds.has(state.id)),
        ...newStates,
      ];
    }
  }

  if (!bestFinal || !Number.isFinite(bestFinal.cost)) {
    return {
      lines: [],
      errors: [
        'DP failed to find a valid linebreak sequence.',
        'No valid candidate transitions were found.',
      ],
      canProceed: false,
      totalCost: Infinity,
      mode: resolvedOptions.allowInfeasible ? 'overfull' : 'feasible',
    };
  }

  const reversedChoices: ActiveChoice[] = [bestFinal.choice];
  let stateId: number | null = bestFinal.fromStateId;
  const seen = new Set<number>();
  while (stateId !== null) {
    if (seen.has(stateId)) {
      return {
        lines: [],
        errors: ['DP reconstruction loop detected.'],
        canProceed: false,
        totalCost: Infinity,
        mode: resolvedOptions.allowInfeasible ? 'overfull' : 'feasible',
      };
    }
    seen.add(stateId);
    const state = states.get(stateId);
    if (!state) {
      return {
        lines: [],
        errors: [`DP reconstruction failed at state ${stateId}.`],
        canProceed: false,
        totalCost: Infinity,
        mode: resolvedOptions.allowInfeasible ? 'overfull' : 'feasible',
      };
    }
    if (state.incomingChoice) {
      reversedChoices.push(state.incomingChoice);
    }
    stateId = state.previousStateId;
  }

  const choices = reversedChoices.reverse();
  const lines: GreedyLine[] = [];
  let currentCursor = firstCursor;
  let usedConstraintViolation = false;

  for (let lineIndex = 0; lineIndex < choices.length; lineIndex++) {
    const normalizedCursor = normalizeCursor(model, currentCursor, forcedPenalties);
    const { candidate, score } = choices[lineIndex];
    usedConstraintViolation ||= score.constraintViolation;
    lines.push({
      lineIndex,
      startRun: normalizedCursor.runIndex,
      startTextOffset: normalizedCursor.textOffset,
      startPendingText: normalizedCursor.pendingText,
      startPendingSourceStart: normalizedCursor.pendingSourceStart,
      startPendingSourceEnd: normalizedCursor.pendingSourceEnd,
      endRun: candidate.endRun,
      endTextOffset: candidate.endTextOffset,
      width: candidate.naturalWidth,
      targetWidth: width,
      lineNaturalWidth: score.lineNaturalWidth,
      glueSetRatio: score.ratio,
      badness: score.badness,
      spaceCount: candidate.spaceCount,
      spaceDeltaPerGap: score.spaceDeltaPerGap,
      xOffset: score.xOffset,
      break: candidate.break,
    });
    if (!candidate.break) {
      break;
    }
    currentCursor = candidate.nextCursor;
  }

  return {
    lines,
    errors,
    canProceed: true,
    totalCost: bestFinal.cost,
    mode: usedConstraintViolation ? 'overfull' : 'feasible',
  };
}
