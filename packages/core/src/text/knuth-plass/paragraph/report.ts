import type { MeasurementService } from './measure.js';
import type { AppliedBreak } from './applyBreaks.js';
import type { AnyWrapper, GreedyLine, ParagraphRun } from './types.js';
import type { ParagraphAlignment } from '../alignment.js';
import type { KnuthPlassLayoutMode } from '../install.js';
import type { TextSourceRangePolicy } from '../../source-map.js';
import {
  texLength,
  texLineX,
  type TexLength,
  type TexLineX,
  type TexLineY,
} from '../../tex/coordinates.js';
import {
  layoutSourceOffset,
  type SourceCoordinateSpace,
  type SourceOffset,
} from '../../source-coordinates.js';

export interface ParagraphLayoutReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  paragraphId: string;
  sourceCoordinateSpace: Space;
  sourceMappingMode: 'explicit' | 'reconstructed';
  width: TexLength;
  alignment: ParagraphAlignment;
  layoutMode: KnuthPlassLayoutMode;
  lines: LineReport<Space>[];
  runs: RunReport<Space>[];
  errors: string[];
  internalMode: 'canonical' | 'degraded';
  internalDegradeReason: string | null;
  externalFallbackUsed: boolean;
  linebreakingMode: 'feasible' | 'overfull' | 'unknown';
}

export interface LineSegmentReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  runIndex: number;
  kind: 'text' | 'space' | 'math';
  text?: string;
  startOffset?: number;
  endOffset?: number;
  sourceStartRaw?: SourceOffset<Space>;
  sourceEndRaw?: SourceOffset<Space>;
  sourceKind?: 'text' | 'math';
  sourceRangePolicy?: TextSourceRangePolicy;
  role?: 'list-label';
  literal?: {
    reason: string;
    detail?: string;
  };
  fontId?: string;
  fontAtPt?: TexLength;
  color?: string;
  glyphCode?: number;
  mathSvgBody?: string;
  mathConstructRanges?: LineMathConstructRangeReport<Space>[];
  mathCaretEntries?: LineMathCaretEntryReport<Space>[];
  mathBreakpoints?: LineMathBreakpointReport<Space>[];
  x: TexLineX;
  width: TexLength;
  caretStops?: TexLineX[];
}

export type LineMathCaretEntryKind =
  | 'math-boundary'
  | 'construct-boundary'
  | 'command'
  | 'group-boundary'
  | 'glyph-boundary'
  | 'synthetic-boundary';

export interface LineMathCaretEntryReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  sourceOffsetRaw: SourceOffset<Space>;
  sourceStartRaw?: SourceOffset<Space>;
  sourceEndRaw?: SourceOffset<Space>;
  x: TexLineX;
  y: TexLineY;
  height: TexLength;
  depth: TexLength;
  kind: LineMathCaretEntryKind;
  priority?: number;
  hitBounds: {
    xStart: TexLineX;
    xEnd: TexLineX;
    yStart: TexLineY;
    yEnd: TexLineY;
  };
}

export interface LineMathConstructRangeReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  sourceStartRaw: SourceOffset<Space>;
  sourceEndRaw: SourceOffset<Space>;
  xStart: TexLineX;
  xEnd: TexLineX;
}

export interface LineMathBreakpointReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  kind: 'binary' | 'relation' | 'penalty';
  sourceOffsetRaw: SourceOffset<Space>;
  x: TexLineX;
  penalty: number;
}

export interface LineReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  lineIndex: number;
  startRun: number;
  endRun: number;
  width: TexLength;
  targetWidth: TexLength;
  naturalWidth: TexLength;
  glueSetRatio: number;
  badness: number;
  spaceCount: number;
  spaceDeltaPerGap: TexLength;
  ascent: TexLength;
  descent: TexLength;
  xStart: TexLineX;
  xEnd: TexLineX;
  break: BreakReport<Space> | null;
  segments: LineSegmentReport<Space>[];
}

export interface BreakReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  kind: 'space' | 'hyphen' | 'forced';
  runIndex: number;
  sourceOffset: SourceOffset<Space>;
  visibleHyphen: boolean;
  lineLeading?: string;
  hyphenSource?: 'automatic' | 'explicit';
  splitOffset?: number;
  width?: TexLength;
}

export interface RunReport<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  runIndex: number;
  kind: 'text' | 'space' | 'math' | 'penalty';
  sourceStart?: SourceOffset<Space>;
  sourceEnd?: SourceOffset<Space>;
  width: TexLength;
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
const textSegmentCaretStopsCache = new WeakMap<object, TexLineX[]>();

function textSliceWidth(
  measurement: MeasurementService | undefined,
  run: Extract<ParagraphRun, { kind: 'text' }>,
  start: number,
  end: number,
  fullWidth: number
): TexLength {
  if (end <= start) {
    return texLength(0);
  }

  if (measurement) {
    const endWidth = measurement.measurePrefix(run.text, end, run.wrapper);
    const startWidth = measurement.measurePrefix(run.text, start, run.wrapper);
    return texLength(endWidth - startWidth);
  }

  if (!run.text.length) {
    return texLength(0);
  }

  return texLength((fullWidth * (end - start)) / run.text.length);
}

export function getOrBuildTextSegmentCaretStops(
  segment: LineSegmentReport
): TexLineX[] | null {
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

  const stops = Array.from(
    { length: segment.text.length + 1 },
    () => texLineX(0)
  );
  stops[0] = segment.x;
  for (let i = 1; i <= segment.text.length; i++) {
    const width = Number(wrapper.textWidth(segment.text.slice(0, i))) || 0;
    stops[i] = texLineX(segment.x + width);
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
}: BuildReportInput): ParagraphLayoutReport<"layout"> {
  const breakByLine = new Map<number, AppliedBreak>();
  for (const entry of appliedBreaks) {
    breakByLine.set(entry.lineIndex, entry);
  }

  const runReports: RunReport<"layout">[] = runs.map((run) => ({
    runIndex: run.runIndex,
    kind: run.kind,
    sourceStart: layoutSourceOffset(run.sourceStart),
    sourceEnd: layoutSourceOffset(run.sourceEnd),
    width: texLength(runWidths.get(run.runIndex) ?? 0),
    text: run.kind === 'text' || run.kind === 'space' ? run.text : undefined,
  }));

  const lineReports: LineReport<"layout">[] = lines.map((line) => {
    const appliedBreak = breakByLine.get(line.lineIndex) ?? null;
    const resolvedBreak = appliedBreak ?? line.break ?? null;
    const segments: LineSegmentReport<"layout">[] = [];
    const xStart = texLineX(line.xOffset ?? 0);
    let x: TexLineX = xStart;

    for (let i = line.startRun; i <= line.endRun && i < runReports.length; i++) {
      const run = runs.at(i);
      if (!run) continue;
      if (run.kind === 'penalty') continue;

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

        const segment: LineSegmentReport<"layout"> = {
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
        x = texLineX(x + segmentWidth);
        continue;
      }

      let segmentWidth = texLength(runWidths.get(run.runIndex) ?? 0);
      if (run.kind === 'space' && (line.spaceCount ?? 0) > 0) {
        const ratio = line.glueSetRatio ?? 0;
        const stretch = run.texGlue?.stretch;
        const shrink = run.texGlue?.shrink;
        if (ratio > 0 && typeof stretch === 'number' && Number.isFinite(stretch)) {
          segmentWidth = texLength(Math.max(0, segmentWidth + ratio * stretch));
        } else if (ratio < 0 && typeof shrink === 'number' && Number.isFinite(shrink)) {
          segmentWidth = texLength(Math.max(0, segmentWidth + ratio * shrink));
        } else if (Number.isFinite(line.spaceDeltaPerGap ?? 0)) {
          segmentWidth = texLength(Math.max(
            0,
            segmentWidth + (line.spaceDeltaPerGap ?? 0)
          ));
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
            ? [x, texLineX(x + segmentWidth)]
            : [x, texLineX(x + segmentWidth)],
      });
      x = texLineX(x + segmentWidth);
    }

    if (resolvedBreak?.kind === 'hyphen' && resolvedBreak.visibleHyphen) {
      const hyphenRun = runs.at(resolvedBreak.runIndex);
      const hyphenWidth = texLength(
        hyphenRun?.kind === 'text' && measurement
          ? measurement.measureText('-', hyphenRun.wrapper)
          : 0
      );
      if (hyphenWidth > 0) {
        const insertedWidth = texLength(resolvedBreak.width ?? hyphenWidth);
        const hyphenX = texLineX(x + insertedWidth - hyphenWidth);
        segments.push({
          runIndex: resolvedBreak.runIndex,
          kind: 'text',
          text: '-',
          x: hyphenX,
          width: hyphenWidth,
          caretStops: [hyphenX, texLineX(hyphenX + hyphenWidth)],
        });
        x = texLineX(x + insertedWidth);
      }
    }

    const metrics = lineMetrics[line.lineIndex] ?? { ascent: 0, descent: 0 };

    return {
      lineIndex: line.lineIndex,
      startRun: line.startRun,
      endRun: line.endRun,
      width: texLength(line.lineNaturalWidth ?? line.width),
      targetWidth: texLength(line.targetWidth ?? width),
      naturalWidth: texLength(line.lineNaturalWidth ?? line.width),
      glueSetRatio: line.glueSetRatio ?? 0,
      badness: line.badness ?? 0,
      spaceCount: line.spaceCount ?? 0,
      spaceDeltaPerGap: texLength(line.spaceDeltaPerGap ?? 0),
      ascent: texLength(Number.isFinite(metrics.ascent) ? metrics.ascent : 0),
      descent: texLength(Number.isFinite(metrics.descent) ? metrics.descent : 0),
      xStart,
      xEnd: x,
      segments,
      break: resolvedBreak
        ? {
            kind: resolvedBreak.kind,
            runIndex: resolvedBreak.runIndex,
            sourceOffset: layoutSourceOffset(resolvedBreak.sourceOffset),
            visibleHyphen: resolvedBreak.visibleHyphen,
            lineLeading: resolvedBreak.lineLeading,
            hyphenSource: resolvedBreak.hyphenSource,
            splitOffset: resolvedBreak.splitOffset,
            width: resolvedBreak.width === undefined
              ? undefined
              : texLength(resolvedBreak.width),
          }
        : null,
    };
  });

  return {
    paragraphId,
    sourceCoordinateSpace: "layout",
    sourceMappingMode: 'reconstructed',
    width: texLength(width),
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
