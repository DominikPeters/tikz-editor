import type { MeasurementService } from './measure.js';
import type { AppliedBreak } from './applyBreaks.js';
import type { AnyWrapper, GreedyLine, ParagraphRun } from './types.js';
import type { ParagraphAlignment } from '../alignment.js';
import type { KnuthPlassLayoutMode } from '../install.js';

export interface ParagraphLayoutReport {
  paragraphId: string;
  width: number;
  alignment: ParagraphAlignment;
  layoutMode: KnuthPlassLayoutMode;
  lines: LineReport[];
  runs: RunReport[];
  errors: string[];
  internalMode: 'canonical' | 'degraded';
  internalDegradeReason: string | null;
  externalFallbackUsed: boolean;
  linebreakingMode: 'feasible' | 'overfull' | 'unknown';
}

export interface LineSegmentReport {
  runIndex: number;
  kind: 'text' | 'space' | 'math';
  text?: string;
  startOffset?: number;
  endOffset?: number;
  sourceStartRaw?: number;
  sourceEndRaw?: number;
  sourceKind?: 'text' | 'math';
  role?: 'list-label';
  fontId?: string;
  glyphCode?: number;
  x: number;
  width: number;
  caretStops?: number[];
}

export interface LineReport {
  lineIndex: number;
  startRun: number;
  endRun: number;
  width: number;
  targetWidth: number;
  naturalWidth: number;
  glueSetRatio: number;
  badness: number;
  spaceCount: number;
  spaceDeltaPerGap: number;
  ascent: number;
  descent: number;
  xStart: number;
  xEnd: number;
  break: BreakReport | null;
  segments: LineSegmentReport[];
}

export interface BreakReport {
  kind: 'space' | 'hyphen' | 'forced';
  runIndex: number;
  sourceOffset: number;
  visibleHyphen: boolean;
  lineLeading?: string;
  hyphenSource?: 'automatic' | 'explicit';
  splitOffset?: number;
  width?: number;
}

export interface RunReport {
  runIndex: number;
  kind: 'text' | 'space' | 'math';
  sourceStart?: number;
  sourceEnd?: number;
  width: number;
  text?: string;
}

export interface BuildReportInput {
  paragraphId: string;
  width: number;
  alignment: ParagraphAlignment;
  layoutMode: KnuthPlassLayoutMode;
  runs: ParagraphRun[];
  runWidths: Map<number, number>;
  lines: GreedyLine[];
  appliedBreaks: AppliedBreak[];
  measurement?: MeasurementService;
  errors?: string[];
  internalMode?: 'canonical' | 'degraded';
  internalDegradeReason?: string | null;
  externalFallbackUsed?: boolean;
  linebreakingMode?: 'feasible' | 'overfull' | 'unknown';
  lineMetrics?: Array<{ ascent: number; descent: number }>;
}

const textSegmentWrapperBySegment = new WeakMap<object, AnyWrapper>();
const textSegmentCaretStopsCache = new WeakMap<object, number[]>();

function textSliceWidth(
  measurement: MeasurementService | undefined,
  run: Extract<ParagraphRun, { kind: 'text' }>,
  start: number,
  end: number,
  fullWidth: number
): number {
  if (end <= start) {
    return 0;
  }

  if (measurement) {
    const endWidth = measurement.measurePrefix(run.text, end, run.wrapper);
    const startWidth = measurement.measurePrefix(run.text, start, run.wrapper);
    return endWidth - startWidth;
  }

  if (!run.text.length) {
    return 0;
  }

  return (fullWidth * (end - start)) / run.text.length;
}

export function getOrBuildTextSegmentCaretStops(
  segment: LineSegmentReport
): number[] | null {
  if (segment.kind !== 'text') {
    return Array.isArray(segment.caretStops) ? segment.caretStops : null;
  }

  if (Array.isArray(segment.caretStops)) {
    return segment.caretStops;
  }

  const cached = textSegmentCaretStopsCache.get(segment);
  if (cached) {
    return cached;
  }

  const wrapper = textSegmentWrapperBySegment.get(segment);
  if (!wrapper || typeof wrapper.textWidth !== 'function' || typeof segment.text !== 'string') {
    return null;
  }

  const stops = Array.from({ length: segment.text.length + 1 }, () => 0);
  stops[0] = segment.x;
  for (let i = 1; i <= segment.text.length; i++) {
    const width = Number(wrapper.textWidth(segment.text.slice(0, i))) || 0;
    stops[i] = segment.x + width;
  }
  segment.caretStops = stops;
  textSegmentCaretStopsCache.set(segment, stops);
  return stops;
}

export function buildParagraphLayoutReport({
  paragraphId,
  width,
  alignment,
  layoutMode,
  runs,
  runWidths,
  lines,
  appliedBreaks,
  measurement,
  errors = [],
  internalMode = 'canonical',
  internalDegradeReason = null,
  externalFallbackUsed = false,
  linebreakingMode = 'unknown',
  lineMetrics = [],
}: BuildReportInput): ParagraphLayoutReport {
  const breakByLine = new Map<number, AppliedBreak>();
  for (const entry of appliedBreaks) {
    breakByLine.set(entry.lineIndex, entry);
  }

  const runReports: RunReport[] = runs.map((run) => ({
    runIndex: run.runIndex,
    kind: run.kind,
    sourceStart: run.sourceStart,
    sourceEnd: run.sourceEnd,
    width: runWidths.get(run.runIndex) ?? 0,
    text: run.kind === 'text' || run.kind === 'space' ? run.text : undefined,
  }));

  const lineReports: LineReport[] = lines.map((line) => {
    const appliedBreak = breakByLine.get(line.lineIndex) ?? null;
    const resolvedBreak = appliedBreak ?? line.break ?? null;
    const segments: LineSegmentReport[] = [];
    const xStart = line.xOffset ?? 0;
    let x = xStart;

    for (let i = line.startRun; i <= line.endRun && i < runReports.length; i++) {
      const run = runs.at(i);
      if (!run) continue;

      if (run.kind === 'text') {
        const startOffset = i === line.startRun ? line.startTextOffset : 0;
        const endOffset =
          i === line.endRun && line.endTextOffset !== null
            ? line.endTextOffset
            : run.text.length;

        if (endOffset <= startOffset) {
          continue;
        }

        const segmentWidth = textSliceWidth(
          measurement,
          run,
          startOffset,
          endOffset,
          runWidths.get(run.runIndex) ?? 0
        );

        const segment: LineSegmentReport = {
          runIndex: run.runIndex,
          kind: run.kind,
          text: run.text.slice(startOffset, endOffset),
          startOffset,
          endOffset,
          x,
          width: segmentWidth,
        };
        textSegmentWrapperBySegment.set(segment, run.wrapper);
        segments.push(segment);
        x += segmentWidth;
        continue;
      }

      let segmentWidth = runWidths.get(run.runIndex) ?? 0;
      if (run.kind === 'space' && (line.spaceCount ?? 0) > 0) {
        const ratio = line.glueSetRatio ?? 0;
        const stretch = run.texGlue?.stretch;
        const shrink = run.texGlue?.shrink;
        if (ratio > 0 && typeof stretch === 'number' && Number.isFinite(stretch)) {
          segmentWidth = Math.max(0, segmentWidth + ratio * stretch);
        } else if (ratio < 0 && typeof shrink === 'number' && Number.isFinite(shrink)) {
          segmentWidth = Math.max(0, segmentWidth + ratio * shrink);
        } else if (Number.isFinite(line.spaceDeltaPerGap ?? 0)) {
          segmentWidth = Math.max(
            0,
            segmentWidth + (line.spaceDeltaPerGap ?? 0)
          );
        }
      }
      segments.push({
        runIndex: run.runIndex,
        kind: run.kind,
        text: run.kind === 'space' ? run.text : undefined,
        x,
        width: segmentWidth,
        caretStops:
          run.kind === 'space'
            ? [x, x + segmentWidth]
            : [x, x + segmentWidth],
      });
      x += segmentWidth;
    }

    if (resolvedBreak?.kind === 'hyphen' && resolvedBreak.visibleHyphen) {
      const hyphenRun = runs.at(resolvedBreak.runIndex);
      const hyphenWidth =
        hyphenRun?.kind === 'text' && measurement
          ? measurement.measureText('-', hyphenRun.wrapper)
          : 0;
      if (hyphenWidth > 0) {
        const insertedWidth = resolvedBreak.width ?? hyphenWidth;
        const hyphenX = x + insertedWidth - hyphenWidth;
        segments.push({
          runIndex: resolvedBreak.runIndex,
          kind: 'text',
          text: '-',
          x: hyphenX,
          width: hyphenWidth,
          caretStops: [hyphenX, hyphenX + hyphenWidth],
        });
        x += insertedWidth;
      }
    }

    const metrics = lineMetrics[line.lineIndex] ?? { ascent: 0, descent: 0 };

    return {
      lineIndex: line.lineIndex,
      startRun: line.startRun,
      endRun: line.endRun,
      width: line.lineNaturalWidth ?? line.width,
      targetWidth: line.targetWidth ?? width,
      naturalWidth: line.lineNaturalWidth ?? line.width,
      glueSetRatio: line.glueSetRatio ?? 0,
      badness: line.badness ?? 0,
      spaceCount: line.spaceCount ?? 0,
      spaceDeltaPerGap: line.spaceDeltaPerGap ?? 0,
      ascent: Number.isFinite(metrics.ascent) ? metrics.ascent : 0,
      descent: Number.isFinite(metrics.descent) ? metrics.descent : 0,
      xStart,
      xEnd: x,
      segments,
      break: resolvedBreak
        ? {
            kind: resolvedBreak.kind,
            runIndex: resolvedBreak.runIndex,
            sourceOffset: resolvedBreak.sourceOffset,
            visibleHyphen: resolvedBreak.visibleHyphen,
            lineLeading: resolvedBreak.lineLeading,
            hyphenSource: resolvedBreak.hyphenSource,
            splitOffset: resolvedBreak.splitOffset,
            width: resolvedBreak.width,
          }
        : null,
    };
  });

  return {
    paragraphId,
    width,
    alignment,
    layoutMode,
    lines: lineReports,
    runs: runReports,
    errors,
    internalMode,
    internalDegradeReason,
    externalFallbackUsed,
    linebreakingMode,
  };
}
