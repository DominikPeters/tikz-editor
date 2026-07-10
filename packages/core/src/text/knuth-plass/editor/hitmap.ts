import {
  getOrBuildTextSegmentCaretStops,
  type LineSegmentReport,
  type ParagraphLayoutReport,
} from '../paragraph/report.js';
import { px } from "../../../coords/scalars.js";
import {
  parseSourceSpans,
  type SourceSpan,
  type MathSourceSpan,
  type TextSourceSpan,
} from './sourceParser.js';
import {
  createMathPrefixCache,
  readPrefixUnitsFromTable,
} from './mathPrefix.js';
import { clientBounds, clientPoint as makeClientPoint } from '../../../coords/points.js';
import type { ClientBounds, ClientPoint } from '../../../coords/points.js';
import { clamp } from '../../../utils/math.js';

// The core package builds without the DOM lib; keep the editor hit-testing
// helpers structurally typed so they remain importable in Node-only builds.
type ClientRectLike = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};
type ScreenMatrixLike = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};
type SvgOwnerLike = {
  viewBox?: { baseVal?: { width?: number } };
};
type Element = {
  getBoundingClientRect?(): ClientRectLike;
  getScreenCTM?(): ScreenMatrixLike | null;
  ownerSVGElement?: SvgOwnerLike | null;
  querySelector?(selector: string): Element | null;
  querySelectorAll?(selector: string): ArrayLike<Element>;
};
type OutputJaxLike = {
  linebreaks?: {
    getReports?(): ParagraphLayoutReport[];
  };
};
type LineDirectionUnit = Readonly<{ x: number; y: number }>;

function lineDirectionUnit(x: number, y: number): LineDirectionUnit {
  return { x, y };
}

export interface CaretBaseParams {
  paragraphId: string;
  sourceText: string;
  containerElement: Element;
}

export interface CaretFromPointParams extends CaretBaseParams {
  clientPoint: ClientPoint;
}

export interface PointFromOffsetParams extends CaretBaseParams {
  offset: number;
}

export interface SelectionRectsParams extends CaretBaseParams {
  startOffset: number;
  endOffset: number;
}

export type CaretMappingErrorCode =
  | 'invalid-params'
  | 'paragraph-not-found'
  | 'source-parse-error'
  | 'alignment-error'
  | 'math-measurement-error'
  | 'geometry-error';

export interface CaretMappingError {
  code: CaretMappingErrorCode;
  paragraphId: string;
  message: string;
}

interface ResultBase {
  ok: boolean;
  paragraphId: string;
  error: CaretMappingError | null;
}

export interface CaretHitResult extends ResultBase {
  offset: number | null;
  lineIndex: number | null;
  kind: 'text' | 'space' | 'math' | null;
  snappedToMathPrefix: boolean;
}

export interface CaretPointResult extends ResultBase {
  offset: number | null;
  lineIndex: number | null;
  lineLocalX: number | null;
  clientPoint: ClientPoint | null;
  rotationDeg: number | null;
  kind: 'text' | 'space' | 'math' | null;
  snappedToMathPrefix: boolean;
}

export interface LineRangeFromPointResult extends ResultBase {
  lineIndex: number | null;
  lineStartOffset: number | null;
  lineEndOffset: number | null;
}

export interface SelectionRect {
  lineIndex: number;
  startOffset: number;
  endOffset: number;
  bounds: ClientBounds;
  center: ClientPoint;
  rotationDeg: number;
}

export interface SelectionRectsResult extends ResultBase {
  startOffset: number;
  endOffset: number;
  rects: SelectionRect[];
}

interface Stop {
  offset: number;
  x: number;
  kind: 'text' | 'space' | 'math';
  snappedToMathPrefix: boolean;
  lineStart: boolean;
  lineEnd: boolean;
}

interface LineGeometry {
  lineIndex: number;
  clientLeft: number;
  clientRight: number;
  clientTop: number;
  clientBottom: number;
  clientCenterY: number;
  reportToSvgScaleX: number;
  screenMatrix: { a: number; b: number; c: number; d: number; e: number; f: number };
  inverseScreenMatrix: { a: number; b: number; c: number; d: number; e: number; f: number };
}

interface LineHitMap extends LineGeometry {
  stopsByX: Stop[];
  stopsByOffset: Stop[];
  stopsByOffsetExact: Map<number, Stop[]>;
  minOffset: number;
  maxOffset: number;
  breakInfo: ParagraphLayoutReport['lines'][number]['break'];
  visibleHyphenBreakOffset: number | null;
}

interface ParagraphHitMap {
  report: ParagraphLayoutReport;
  sourceText: string;
  lines: LineHitMap[];
}

interface RunRawRange {
  rawStart: number;
  rawEnd: number;
  sourceKind: 'text' | 'math';
}

interface AlignedSegment {
  lineIndex: number;
  line: ParagraphLayoutReport['lines'][number];
  segment: LineSegmentReport;
  rawStart: number;
  rawEnd: number;
  sourceKind: 'text' | 'math';
  mathSpan?: MathSourceSpan;
}

interface CachedParagraphEntry {
  sourceText: string;
  report: ParagraphLayoutReport;
  containerElement: Element;
  containerGeometry: ContainerGeometrySnapshot | null;
  mapPromise: Promise<ParagraphHitMap>;
}

interface ContainerGeometrySnapshot {
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  matrixA: number;
  matrixB: number;
  matrixC: number;
  matrixD: number;
  matrixE: number;
  matrixF: number;
}

const EPSILON = 1e-6;
const mathPrefixCache = createMathPrefixCache();
let paragraphCacheByOutput = new WeakMap<object, Map<string, CachedParagraphEntry>>();

function readContainerGeometrySnapshot(containerElement: Element | null | undefined): ContainerGeometrySnapshot | null {
  if (!containerElement || typeof containerElement !== 'object') {
    return null;
  }
  const rect = containerElement.getBoundingClientRect?.();
  const matrix = containerElement.getScreenCTM?.();
  if (!rect || !matrix) {
    return null;
  }

  const rectLeft = Number(rect.left);
  const rectTop = Number(rect.top);
  const rectWidth = Number(rect.width);
  const rectHeight = Number(rect.height);
  const matrixA = Number(matrix.a);
  const matrixB = Number(matrix.b);
  const matrixC = Number(matrix.c);
  const matrixD = Number(matrix.d);
  const matrixE = Number(matrix.e);
  const matrixF = Number(matrix.f);

  if (
    !Number.isFinite(rectLeft) ||
    !Number.isFinite(rectTop) ||
    !Number.isFinite(rectWidth) ||
    !Number.isFinite(rectHeight) ||
    !Number.isFinite(matrixA) ||
    !Number.isFinite(matrixB) ||
    !Number.isFinite(matrixC) ||
    !Number.isFinite(matrixD) ||
    !Number.isFinite(matrixE) ||
    !Number.isFinite(matrixF)
  ) {
    return null;
  }

  return {
    rectLeft,
    rectTop,
    rectWidth,
    rectHeight,
    matrixA,
    matrixB,
    matrixC,
    matrixD,
    matrixE,
    matrixF,
  };
}

function sameContainerGeometry(
  left: ContainerGeometrySnapshot | null,
  right: ContainerGeometrySnapshot | null
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    Math.abs(left.rectLeft - right.rectLeft) <= EPSILON &&
    Math.abs(left.rectTop - right.rectTop) <= EPSILON &&
    Math.abs(left.rectWidth - right.rectWidth) <= EPSILON &&
    Math.abs(left.rectHeight - right.rectHeight) <= EPSILON &&
    Math.abs(left.matrixA - right.matrixA) <= EPSILON &&
    Math.abs(left.matrixB - right.matrixB) <= EPSILON &&
    Math.abs(left.matrixC - right.matrixC) <= EPSILON &&
    Math.abs(left.matrixD - right.matrixD) <= EPSILON &&
    Math.abs(left.matrixE - right.matrixE) <= EPSILON &&
    Math.abs(left.matrixF - right.matrixF) <= EPSILON
  );
}

function invalidParamsResult<T extends ResultBase>(
  paragraphId: string,
  base: Omit<T, keyof ResultBase>,
  message: string
): T {
  return {
    ...(base as object),
    ok: false,
    paragraphId,
    error: {
      code: 'invalid-params',
      paragraphId,
      message,
    },
  } as T;
}

function errorResult<T extends ResultBase>(
  paragraphId: string,
  base: Omit<T, keyof ResultBase>,
  code: CaretMappingErrorCode,
  message: string
): T {
  return {
    ...(base as object),
    ok: false,
    paragraphId,
    error: {
      code,
      paragraphId,
      message,
    },
  } as T;
}

function readReportsFromOutputJax(outputJax: unknown): ParagraphLayoutReport[] {
  if (!outputJax || typeof outputJax !== 'object') {
    return [];
  }

  const target = outputJax as OutputJaxLike;
  const fromVisitor = target.linebreaks?.getReports?.();
  if (Array.isArray(fromVisitor)) {
    return fromVisitor;
  }
  return [];
}

function findReportByParagraphId(
  outputJax: unknown,
  paragraphId: string
): { report: ParagraphLayoutReport | null; reports: ParagraphLayoutReport[] } {
  const reports = readReportsFromOutputJax(outputJax);
  const report = reports.find((entry) => entry.paragraphId === paragraphId) ?? null;
  return { report, reports };
}

function collectLineGeometryElements(
  containerElement: Element | null | undefined,
  expectedCount: number
): Element[] | null {
  if (!containerElement || typeof containerElement !== 'object') {
    return null;
  }

  const lineBoxes =
    typeof (containerElement).querySelectorAll === 'function'
      ? Array.from((containerElement).querySelectorAll('[data-mjx-linebox="true"]'))
      : [];
  if (lineBoxes.length === expectedCount) {
    return lineBoxes;
  }

  if (lineBoxes.length === 0 && expectedCount === 1) {
    const paragraphRoot =
      typeof (containerElement).querySelector === 'function'
        ? ((containerElement).querySelector('[data-paragraph-id]') ??
          (containerElement).querySelector('[data-overflow="linebreak"]'))
        : null;
    if (paragraphRoot) {
      return [paragraphRoot];
    }
  }

  return null;
}

function readLineGeometry(
  containerElement: Element,
  report: ParagraphLayoutReport
): LineGeometry[] {
  const sortedLines = [...report.lines].sort((a, b) => a.lineIndex - b.lineIndex);
  const geometryElements = collectLineGeometryElements(containerElement, sortedLines.length);
  if (!geometryElements) {
    throw new Error(
      `Expected ${sortedLines.length} rendered line geometry elements for paragraph '${report.paragraphId}'.`
    );
  }

  return sortedLines.map((line, index) => {
    const element = geometryElements.at(index);
    if (!element) {
      throw new Error(`Unable to read rendered element for line ${line.lineIndex}.`);
    }
    const rect = element.getBoundingClientRect?.();
    if (!rect) {
      throw new Error(`Unable to read client rect for line ${line.lineIndex}.`);
    }
    const screenMatrix = element.getScreenCTM?.();
    if (
      !screenMatrix ||
      !Number.isFinite(Number(screenMatrix.a)) ||
      !Number.isFinite(Number(screenMatrix.b)) ||
      !Number.isFinite(Number(screenMatrix.c)) ||
      !Number.isFinite(Number(screenMatrix.d)) ||
      !Number.isFinite(Number(screenMatrix.e)) ||
      !Number.isFinite(Number(screenMatrix.f))
    ) {
      throw new Error(`Unable to read screen transform for line ${line.lineIndex}.`);
    }
    const determinant = Number(screenMatrix.a) * Number(screenMatrix.d) - Number(screenMatrix.b) * Number(screenMatrix.c);
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) {
      throw new Error(`Non-invertible screen transform for line ${line.lineIndex}.`);
    }
    const ownerSvg = element.ownerSVGElement;
    const viewBoxWidth = Number(ownerSvg?.viewBox?.baseVal?.width);
    if (!Number.isFinite(viewBoxWidth) || viewBoxWidth <= EPSILON) {
      throw new Error(`Missing viewBox width for line ${line.lineIndex}.`);
    }
    const reportWidth = Number(report.width);
    if (!Number.isFinite(reportWidth) || reportWidth <= EPSILON) {
      throw new Error(`Invalid report width for line ${line.lineIndex}.`);
    }
    const inverseScreenMatrix = {
      a: Number(screenMatrix.d) / determinant,
      b: -Number(screenMatrix.b) / determinant,
      c: -Number(screenMatrix.c) / determinant,
      d: Number(screenMatrix.a) / determinant,
      e: (Number(screenMatrix.c) * Number(screenMatrix.f) - Number(screenMatrix.d) * Number(screenMatrix.e)) / determinant,
      f: (Number(screenMatrix.b) * Number(screenMatrix.e) - Number(screenMatrix.a) * Number(screenMatrix.f)) / determinant,
    };

    const left = Number(rect.left);
    const right = Number(rect.right);
    const top = Number(rect.top);
    const bottom = Number(rect.bottom);
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      !Number.isFinite(top) ||
      !Number.isFinite(bottom) ||
      right - left <= EPSILON ||
      bottom - top <= EPSILON
    ) {
      throw new Error(`Invalid client rect for line ${line.lineIndex}.`);
    }

    const lineStart = Number(line.xStart);
    const lineEnd = Number(line.xEnd);
    if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd) || lineEnd < lineStart - EPSILON) {
      throw new Error(`Line ${line.lineIndex} is missing valid xStart/xEnd metadata.`);
    }

    return {
      lineIndex: line.lineIndex,
      clientLeft: Math.min(left, right),
      clientRight: Math.max(left, right),
      clientTop: Math.min(top, bottom),
      clientBottom: Math.max(top, bottom),
      clientCenterY: (top + bottom) / 2,
      reportToSvgScaleX: viewBoxWidth / reportWidth,
      screenMatrix: {
        a: Number(screenMatrix.a),
        b: Number(screenMatrix.b),
        c: Number(screenMatrix.c),
        d: Number(screenMatrix.d),
        e: Number(screenMatrix.e),
        f: Number(screenMatrix.f),
      },
      inverseScreenMatrix,
    };
  });
}

function lineLocalClientPoint(
  line: LineGeometry,
  reportLine: ParagraphLayoutReport['lines'][number],
  x: number
): ClientPoint {
  const lineStart = Number(reportLine.xStart);
  const localReportX = x - lineStart;
  const svgX = localReportX * line.reportToSvgScaleX;
  return makeClientPoint(
    px(line.screenMatrix.a * svgX + line.screenMatrix.c * 0 + line.screenMatrix.e),
    px(line.screenMatrix.b * svgX + line.screenMatrix.d * 0 + line.screenMatrix.f)
  );
}

function lineTangentUnit(line: LineGeometry): LineDirectionUnit {
  const tangentLength = Math.hypot(line.screenMatrix.a, line.screenMatrix.b);
  return lineDirectionUnit(
    line.screenMatrix.a / tangentLength,
    line.screenMatrix.b / tangentLength,
  );
}

function lineNormalUnit(line: LineGeometry): LineDirectionUnit {
  const tangent = lineTangentUnit(line);
  return lineDirectionUnit(-tangent.y, tangent.x);
}

function lineBaselineOriginPoint(
  line: LineGeometry,
  reportLine: ParagraphLayoutReport['lines'][number]
): ClientPoint {
  const lineStart = Number(reportLine.xStart);
  return lineLocalClientPoint(line, reportLine, lineStart);
}

function lineBoxNormalOffset(
  line: LineGeometry,
  reportLine: ParagraphLayoutReport['lines'][number]
): number {
  const origin = lineBaselineOriginPoint(line, reportLine);
  const normal = lineNormalUnit(line);
  const lineBoxCenterX = (line.clientLeft + line.clientRight) / 2;
  const lineBoxCenterY = line.clientCenterY;
  return (
    (lineBoxCenterX - origin.x) * normal.x +
    (lineBoxCenterY - origin.y) * normal.y
  );
}

function lineClientHeight(
  line: LineGeometry,
  reportLine: ParagraphLayoutReport['lines'][number]
): number {
  const fallback = Math.max(1, line.clientBottom - line.clientTop);
  const reportLineWidth = Number(reportLine.xEnd) - Number(reportLine.xStart);
  if (!Number.isFinite(reportLineWidth) || reportLineWidth <= EPSILON) {
    return fallback;
  }
  const lineWidthScreen = reportLineWidth * line.reportToSvgScaleX * Math.hypot(line.screenMatrix.a, line.screenMatrix.b);
  const bboxHeight = Math.max(0, line.clientBottom - line.clientTop);
  const bboxWidth = Math.max(0, line.clientRight - line.clientLeft);
  const theta = Math.atan2(line.screenMatrix.b, line.screenMatrix.a);
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  let inferredHeight = Number.NaN;
  if (cos > EPSILON) {
    inferredHeight = (bboxHeight - lineWidthScreen * sin) / cos;
  } else if (sin > EPSILON) {
    inferredHeight = (bboxWidth - lineWidthScreen * cos) / sin;
  }
  if (!Number.isFinite(inferredHeight) || inferredHeight <= EPSILON) {
    return fallback;
  }
  return Math.max(1, Math.min(fallback, inferredHeight));
}

function clientToLineLocalX(
  line: LineGeometry,
  reportLine: ParagraphLayoutReport['lines'][number],
  clientPoint: ClientPoint
): number {
  const lineStart = Number(reportLine.xStart);
  const localX =
    line.inverseScreenMatrix.a * clientPoint.x +
    line.inverseScreenMatrix.c * clientPoint.y +
    line.inverseScreenMatrix.e;
  const reportX = localX / line.reportToSvgScaleX + lineStart;
  return reportX;
}

function annotateSegmentSource(
  segment: LineSegmentReport,
  rawStart: number,
  rawEnd: number,
  sourceKind: 'text' | 'math'
): void {
  const writable = segment as LineSegmentReport & {
    sourceStartRaw?: number;
    sourceEndRaw?: number;
    sourceKind?: 'text' | 'math';
  };
  writable.sourceStartRaw = rawStart;
  writable.sourceEndRaw = rawEnd;
  writable.sourceKind = sourceKind;
}

function buildRunRawRanges(
  report: ParagraphLayoutReport,
  spans: SourceSpan[],
  sourceText: string
): { runRawByIndex: Map<number, RunRawRange>; error: string | null } {
  const runRawByIndex = new Map<number, RunRawRange>();
  const runs = Array.isArray(report.runs) ? report.runs : [];
  if (!runs.length) {
    return {
      runRawByIndex,
      error: 'Paragraph report is missing run metadata required for caret alignment.',
    };
  }

  let spanIndex = 0;
  let spanOffset = 0;
  let activeMathSpan: MathSourceSpan | null = null;

  const currentSpan = (): SourceSpan | null => spans[spanIndex] ?? null;
  const nextTextStart = (): number | null => {
    let probeIndex = spanIndex;
    let probeOffset = spanOffset;
    for (;;) {
      const span = spans.at(probeIndex) ?? null;
      if (!span) return null;
      if (span.kind === 'math') {
        probeIndex += 1;
        probeOffset = span.rawEnd;
        continue;
      }
      const start = Math.max(probeOffset, span.rawStart);
      if (start >= span.rawEnd) {
        probeIndex += 1;
        probeOffset = span.rawEnd;
        continue;
      }
      return start;
    }
  };

  const advanceToNextText = (): TextSourceSpan | null => {
    for (;;) {
      const span = currentSpan();
      if (!span) return null;
      if (span.kind === 'math') {
        spanIndex += 1;
        spanOffset = span.rawEnd;
        continue;
      }
      const start = Math.max(spanOffset, span.rawStart);
      if (start >= span.rawEnd) {
        spanIndex += 1;
        spanOffset = span.rawEnd;
        continue;
      }
      spanOffset = start;
      return span;
    }
  };

  const consumeTextLike = (count: number): { rawStart: number; rawEnd: number } | null => {
    const need = Math.max(0, Math.floor(count));
    const first = advanceToNextText();
    if (first?.kind !== 'text') return null;
    const rawStart = Math.max(0, spanOffset);
    let remaining = need;
    while (remaining > 0) {
      const span = currentSpan();
      if (span?.kind !== 'text') return null;
      const start = Math.max(spanOffset, span.rawStart);
      const available = span.rawEnd - start;
      if (available <= 0) {
        spanIndex += 1;
        spanOffset = span.rawEnd;
        continue;
      }
      const take = Math.min(available, remaining);
      spanOffset = start + take;
      remaining -= take;
      if (spanOffset >= span.rawEnd) {
        spanIndex += 1;
      }
    }
    return { rawStart, rawEnd: spanOffset };
  };

  const consumeTeXLinebreakCommand = (start: number): number | null => {
    if (sourceText.charAt(start) !== '\\') {
      return null;
    }

    if (sourceText.charAt(start + 1) === '\\') {
      let cursor = start + 2;
      if (sourceText.charAt(cursor) === '*') {
        cursor += 1;
      }

      while (cursor < sourceText.length && /\s/.test(sourceText.charAt(cursor))) {
        cursor += 1;
      }

      if (sourceText.charAt(cursor) === '[') {
        cursor += 1;
        while (cursor < sourceText.length && sourceText.charAt(cursor) !== ']') {
          cursor += 1;
        }
        if (cursor >= sourceText.length) {
          return null;
        }
        cursor += 1;
      }

      return cursor;
    }

    const named = 'newline';
    if (sourceText.slice(start + 1, start + 1 + named.length) !== named) {
      return null;
    }

    const boundary = sourceText.charAt(start + 1 + named.length);
    if (/[A-Za-z]/.test(boundary)) {
      return null;
    }

    return start + 1 + named.length;
  };

  const consumeSpaceLike = (): { rawStart: number; rawEnd: number } | null => {
    const span = advanceToNextText();
    if (!span) return null;
    const start = Math.max(spanOffset, span.rawStart);
    if (start >= span.rawEnd) {
      return null;
    }

    const first = sourceText.charAt(start);
    let cursor = start;
    if (/\s/.test(first)) {
      while (cursor < sourceText.length && /\s/.test(sourceText.charAt(cursor))) {
        cursor += 1;
      }
    } else {
      const commandEnd = consumeTeXLinebreakCommand(start);
      if (!commandEnd) {
        return null;
      }
      cursor = commandEnd;
    }

    spanOffset = cursor;
    for (;;) {
      const current = currentSpan();
      if (current?.kind !== 'text') break;
      if (spanOffset < current.rawEnd) break;
      spanIndex += 1;
      spanOffset = current.rawEnd;
    }
    return { rawStart: start, rawEnd: cursor };
  };

  const consumeNextMath = (): MathSourceSpan | null => {
    for (;;) {
      const span = currentSpan();
      if (!span) return null;
      if (span.kind === 'math') {
        spanIndex += 1;
        spanOffset = span.rawEnd;
        activeMathSpan = span;
        return span;
      }
      const start = Math.max(spanOffset, span.rawStart);
      if (start < span.rawEnd) {
        const remaining = span.text.slice(start - span.rawStart);
        if (remaining.trim().length > 0) return null;
      }
      spanIndex += 1;
      spanOffset = span.rawEnd;
    }
  };

  const shouldExitActiveMath = (
    run: { kind: 'text' | 'space' | 'math'; text?: string },
    nextRun: { kind: 'text' | 'space' | 'math'; text?: string } | null
  ): boolean => {
    if (!activeMathSpan || run.kind === 'math') {
      return false;
    }
    if (nextRun?.kind === 'math') {
      return false;
    }
    const start = nextTextStart();
    if (!Number.isFinite(start)) {
      return false;
    }
    if (run.kind === 'space') {
      return /\s/.test(sourceText.charAt(start as number)) || consumeTeXLinebreakCommand(start as number) != null;
    }
    const text = String(run.text ?? '');
    return text.length > 0 && sourceText.startsWith(text, start as number);
  };

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    const nextRun = runs[runIndex + 1] ?? null;

    if (shouldExitActiveMath(run, nextRun)) {
      activeMathSpan = null;
    }

    const currentMathSpan = activeMathSpan as MathSourceSpan | null;
    if (currentMathSpan) {
      runRawByIndex.set(run.runIndex, {
        rawStart: currentMathSpan.rawStart,
        rawEnd: currentMathSpan.rawEnd,
        sourceKind: 'math',
      });
      continue;
    }

    if (run.kind === 'math') {
      const span = consumeNextMath();
      if (!span) {
        return {
          runRawByIndex: new Map(),
          error: `Failed to align math run ${run.runIndex} to source spans.`,
        };
      }
      runRawByIndex.set(run.runIndex, {
        rawStart: span.rawStart,
        rawEnd: span.rawEnd,
        sourceKind: 'math',
      });
      continue;
    }

    const consumed =
      run.kind === 'space'
        ? consumeSpaceLike()
        : consumeTextLike(Math.max(0, String(run.text ?? '').length));
    if (!consumed) {
      return {
        runRawByIndex: new Map(),
        error: `Failed to align ${run.kind} run ${run.runIndex} to source spans.`,
      };
    }
    runRawByIndex.set(run.runIndex, {
      rawStart: consumed.rawStart,
      rawEnd: consumed.rawEnd,
      sourceKind: 'text',
    });
  }

  return { runRawByIndex, error: null };
}

function alignSegmentsToSource(
  report: ParagraphLayoutReport,
  sourceText: string
): { aligned: AlignedSegment[]; error: string | null } {
  const parsed = parseSourceSpans(sourceText);
  if (parsed.error) {
    return {
      aligned: [],
      error: `${parsed.error.message} (index=${parsed.error.index})`,
    };
  }

  const mathSpanByRange = new Map<string, MathSourceSpan>();
  for (const span of parsed.spans) {
    if (span.kind === 'math') {
      mathSpanByRange.set(`${span.rawStart}:${span.rawEnd}`, span);
    }
  }

  const runRaw = buildRunRawRanges(report, parsed.spans, sourceText);
  if (runRaw.error) {
    return {
      aligned: [],
      error: runRaw.error,
    };
  }

  const aligned: AlignedSegment[] = [];
  const sortedLines = [...report.lines].sort((a, b) => a.lineIndex - b.lineIndex);

  for (let lineCursor = 0; lineCursor < sortedLines.length; lineCursor++) {
    const line = sortedLines[lineCursor];
    for (let segmentIndex = 0; segmentIndex < line.segments.length; segmentIndex++) {
      const segment = line.segments[segmentIndex];
      const runRange = runRaw.runRawByIndex.get(segment.runIndex);
      if (!runRange) {
        return {
          aligned: [],
          error: `Missing run alignment for runIndex=${segment.runIndex}.`,
        };
      }

      if (segment.kind === 'math') {
        const mathGroupStartIndex = segmentIndex;
        const groupStartX = segment.x;
        let groupEndX = segment.x + Math.max(0, segment.width);
        let groupRawStart = runRange.rawStart;
        let groupRawEnd = runRange.rawEnd;

        while (
          segmentIndex + 1 < line.segments.length &&
          line.segments[segmentIndex + 1]?.kind === 'math'
        ) {
          const next = line.segments[segmentIndex + 1];
          groupEndX = Math.max(groupEndX, next.x + Math.max(0, next.width));
          const nextRange = runRaw.runRawByIndex.get(next.runIndex);
          if (!nextRange) {
            return {
              aligned: [],
              error: `Missing run alignment for runIndex=${next.runIndex}.`,
            };
          }
          groupRawStart = Math.min(groupRawStart, nextRange.rawStart);
          groupRawEnd = Math.max(groupRawEnd, nextRange.rawEnd);
          segmentIndex += 1;
        }

        for (let i = mathGroupStartIndex; i <= segmentIndex; i++) {
          annotateSegmentSource(line.segments[i], groupRawStart, groupRawEnd, 'math');
        }

        const mathSpan = mathSpanByRange.get(`${groupRawStart}:${groupRawEnd}`);
        if (!mathSpan) {
          return {
            aligned: [],
            error: `Failed to align math segment ${groupRawStart}:${groupRawEnd} to parsed source span.`,
          };
        }

        aligned.push({
          lineIndex: line.lineIndex,
          line,
          segment: {
            runIndex: line.segments[mathGroupStartIndex]?.runIndex ?? segment.runIndex,
            kind: 'math',
            x: groupStartX,
            width: Math.max(0, groupEndX - groupStartX),
            caretStops: [groupStartX, Math.max(groupStartX, groupEndX)],
          },
          rawStart: groupRawStart,
          rawEnd: groupRawEnd,
          sourceKind: 'math',
          mathSpan,
        });
        continue;
      }

      if (segment.kind === 'space') {
        annotateSegmentSource(segment, runRange.rawStart, runRange.rawEnd, 'text');
        aligned.push({
          lineIndex: line.lineIndex,
          line,
          segment,
          rawStart: runRange.rawStart,
          rawEnd: runRange.rawEnd,
          sourceKind: 'text',
        });
        continue;
      }

      const hasStart = Number.isFinite(Number(segment.startOffset));
      const hasEnd = Number.isFinite(Number(segment.endOffset));
      if (!hasStart || !hasEnd) {
        // Synthetic visual-only text segments (e.g., the '-' rendered for a
        // visible-hyphen line break) carry prebuilt caretStops but no source
        // offsets. They have no source mapping; visibleHyphenBreakOffsetByLine
        // handles caret behavior at the break.
        if (Array.isArray(segment.caretStops)) {
          continue;
        }
        return {
          aligned: [],
          error: `Text segment for runIndex=${segment.runIndex} is missing strict startOffset/endOffset metadata.`,
        };
      }
      const startOffset = Math.max(0, Number(segment.startOffset));
      const endOffset = Math.max(startOffset, Number(segment.endOffset));
      const rawStart = runRange.rawStart + startOffset;
      const rawEnd = runRange.rawStart + endOffset;
      if (rawEnd > runRange.rawEnd + EPSILON) {
        return {
          aligned: [],
          error: `Text segment raw range exceeds run-aligned range for runIndex=${segment.runIndex}.`,
        };
      }
      annotateSegmentSource(segment, rawStart, rawEnd, 'text');
      aligned.push({
        lineIndex: line.lineIndex,
        line,
        segment,
        rawStart,
        rawEnd,
        sourceKind: 'text',
      });
    }
  }

  return { aligned, error: null };
}

function markLineEndpoints(stops: Stop[]): Stop[] {
  if (!stops.length) {
    return stops;
  }
  let minX = stops[0].x;
  let maxX = stops[0].x;
  for (const stop of stops) {
    minX = Math.min(minX, stop.x);
    maxX = Math.max(maxX, stop.x);
  }
  for (const stop of stops) {
    stop.lineStart = Math.abs(stop.x - minX) < EPSILON;
    stop.lineEnd = Math.abs(stop.x - maxX) < EPSILON;
  }
  return stops;
}

async function buildStopsByLine(
  outputJax: unknown,
  alignedSegments: AlignedSegment[]
): Promise<Map<number, Stop[]>> {
  const stopsByLine = new Map<number, Stop[]>();

  const addStop = (lineIndex: number, stop: Stop) => {
    const list = stopsByLine.get(lineIndex) ?? [];
    list.push(stop);
    stopsByLine.set(lineIndex, list);
  };

  for (const aligned of alignedSegments) {
    const rawLength = Math.max(0, aligned.rawEnd - aligned.rawStart);
    const segLeft = Number(aligned.segment.x) || 0;
    const segWidth = Math.max(0, Number(aligned.segment.width) || 0);

    if (aligned.sourceKind === 'math') {
      const span = aligned.mathSpan;
      if (!span) {
        throw new Error(`Missing parsed math span for line ${aligned.lineIndex}.`);
      }
      const table = await mathPrefixCache.getOrBuild(outputJax, span);
      for (let i = 0; i <= rawLength; i++) {
        const offset = aligned.rawStart + i;
        const ratio = offset <= span.contentStart
          ? 0
          : offset >= span.contentEnd
            ? 1
            : readPrefixUnitsFromTable(clamp(offset - span.contentStart, 0, span.content.length), span.content.length, 1, table);
        addStop(aligned.lineIndex, {
          offset,
          x: segLeft + ratio * segWidth,
          kind: 'math',
          snappedToMathPrefix: true,
          lineStart: false,
          lineEnd: false,
        });
      }
      continue;
    }

    if (aligned.segment.kind === 'space') {
      for (let i = 0; i <= rawLength; i++) {
        const t = rawLength > 0 ? i / rawLength : 0;
        addStop(aligned.lineIndex, {
          offset: aligned.rawStart + i,
          x: segLeft + segWidth * t,
          kind: 'space',
          snappedToMathPrefix: false,
          lineStart: false,
          lineEnd: false,
        });
      }
      continue;
    }

    const providedStops = (getOrBuildTextSegmentCaretStops(aligned.segment) ?? [])
      .map((value) => Number(value));
    if (
      providedStops.length !== rawLength + 1 ||
      !providedStops.every((value) => Number.isFinite(value))
    ) {
      throw new Error(
        `Text segment for runIndex=${aligned.segment.runIndex} is missing valid caretStops.`
      );
    }

    for (let i = 0; i <= rawLength; i++) {
      addStop(aligned.lineIndex, {
        offset: aligned.rawStart + i,
        x: providedStops[i],
        kind: 'text',
        snappedToMathPrefix: false,
        lineStart: false,
        lineEnd: false,
      });
    }
  }

  for (const [lineIndex, stops] of stopsByLine.entries()) {
    stops.sort((a, b) => {
      if (Math.abs(a.x - b.x) > EPSILON) {
        return a.x - b.x;
      }
      return a.offset - b.offset;
    });
    stopsByLine.set(lineIndex, markLineEndpoints(stops));
  }

  return stopsByLine;
}

function buildLineHitMaps(
  report: ParagraphLayoutReport,
  stopsByLine: Map<number, Stop[]>,
  geometryByLineIndex: Map<number, LineGeometry>,
  sourceLength: number,
  visibleHyphenBreakOffsetByLine: Map<number, number>
): LineHitMap[] {
  const lines = [...report.lines].sort((a, b) => a.lineIndex - b.lineIndex);
  return lines.map((line) => {
    const byX = [...(stopsByLine.get(line.lineIndex) ?? [])];
    if (!byX.length) {
      throw new Error(`No measured caret stops available for line ${line.lineIndex}.`);
    }
    const byOffset = [...byX].sort((a, b) => {
      if (a.offset !== b.offset) {
        return a.offset - b.offset;
      }
      return a.x - b.x;
    });
    const exact = new Map<number, Stop[]>();
    for (const stop of byOffset) {
      const list = exact.get(stop.offset) ?? [];
      list.push(stop);
      exact.set(stop.offset, list);
    }
    const minOffset = byOffset[0].offset;
    const maxOffset = byOffset[byOffset.length - 1].offset;
    const geometry = geometryByLineIndex.get(line.lineIndex);
    if (!geometry) {
      throw new Error(`Missing geometry for line ${line.lineIndex}.`);
    }

    return {
      ...geometry,
      stopsByX: byX,
      stopsByOffset: byOffset,
      stopsByOffsetExact: exact,
      minOffset,
      maxOffset,
      breakInfo: line.break,
      visibleHyphenBreakOffset: visibleHyphenBreakOffsetByLine.get(line.lineIndex) ?? null,
    };
  });
}

function buildVisibleHyphenBreakOffsetByLine(
  report: ParagraphLayoutReport,
  alignedSegments: AlignedSegment[]
): Map<number, number> {
  const byLine = new Map<number, number>();

  for (const line of report.lines) {
    if (line.break?.kind !== 'hyphen' || !line.break.visibleHyphen) {
      continue;
    }
    const candidates = alignedSegments.filter(
      (segment) =>
        segment.lineIndex === line.lineIndex &&
        segment.sourceKind === 'text' &&
        segment.segment.runIndex === line.break?.runIndex
    );
    if (!candidates.length) {
      continue;
    }
    byLine.set(
      line.lineIndex,
      Math.max(...candidates.map((candidate) => candidate.rawEnd))
    );
  }

  return byLine;
}

async function buildParagraphHitMap(
  outputJax: unknown,
  report: ParagraphLayoutReport,
  sourceText: string,
  containerElement: Element
): Promise<ParagraphHitMap> {
  const aligned = alignSegmentsToSource(report, sourceText);
  if (aligned.error) {
    throw new Error(aligned.error);
  }

  const lineGeometry = readLineGeometry(containerElement, report);
  const geometryByLineIndex = new Map(lineGeometry.map((entry) => [entry.lineIndex, entry]));
  const stopsByLine = await buildStopsByLine(outputJax, aligned.aligned);
  const visibleHyphenBreakOffsetByLine = buildVisibleHyphenBreakOffsetByLine(report, aligned.aligned);
  const lines = buildLineHitMaps(
    report,
    stopsByLine,
    geometryByLineIndex,
    sourceText.length,
    visibleHyphenBreakOffsetByLine
  );

  return {
    report,
    sourceText,
    lines,
  };
}

async function getParagraphHitMap(
  outputJax: unknown,
  report: ParagraphLayoutReport,
  sourceText: string,
  containerElement: Element
): Promise<ParagraphHitMap> {
  if (!outputJax || typeof outputJax !== 'object') {
    return buildParagraphHitMap(outputJax, report, sourceText, containerElement);
  }

  let map = paragraphCacheByOutput.get(outputJax);
  if (!map) {
    map = new Map<string, CachedParagraphEntry>();
    paragraphCacheByOutput.set(outputJax, map);
  }

  const existing = map.get(report.paragraphId);
  const containerGeometry = readContainerGeometrySnapshot(containerElement);
  if (
    existing?.report === report &&
    existing.sourceText === sourceText &&
    existing.containerElement === containerElement &&
    sameContainerGeometry(existing.containerGeometry, containerGeometry)
  ) {
    return existing.mapPromise;
  }

  const mapPromise = buildParagraphHitMap(outputJax, report, sourceText, containerElement).catch((error) => {
    const current = map.get(report.paragraphId);
    if (current?.mapPromise === mapPromise) {
      map.delete(report.paragraphId);
    }
    throw error;
  });

  map.set(report.paragraphId, {
    sourceText,
    report,
    containerElement,
    containerGeometry,
    mapPromise,
  });

  return mapPromise;
}

function nearestStopByX(stops: Stop[], x: number): Stop {
  let best = stops[0];
  let bestDistance = Math.abs(best.x - x);
  for (let i = 1; i < stops.length; i++) {
    const candidate = stops[i];
    const distance = Math.abs(candidate.x - x);
    if (distance < bestDistance - EPSILON) {
      best = candidate;
      bestDistance = distance;
      continue;
    }
    if (Math.abs(distance - bestDistance) < EPSILON && candidate.offset < best.offset) {
      best = candidate;
    }
  }
  return best;
}

function stopForOffset(line: LineHitMap, offset: number, preferLineStart: boolean): Stop | null {
  const exact = line.stopsByOffsetExact.get(offset) ?? [];
  if (!exact.length) {
    return null;
  }
  if (preferLineStart) {
    return exact.find((entry) => entry.lineStart) ?? exact[0];
  }
  return exact.find((entry) => entry.lineEnd) ?? exact[exact.length - 1];
}

function firstStopAtOrAfter(line: LineHitMap, offset: number): Stop | null {
  const exact = stopForOffset(line, offset, true);
  if (exact) {
    return exact;
  }
  for (const stop of line.stopsByOffset) {
    if (stop.offset > offset) {
      return stop;
    }
  }
  return null;
}

function lastStopAtOrBefore(line: LineHitMap, offset: number): Stop | null {
  const exact = stopForOffset(line, offset, false);
  if (exact) {
    return exact;
  }
  for (let index = line.stopsByOffset.length - 1; index >= 0; index -= 1) {
    const stop = line.stopsByOffset[index];
    if (stop.offset < offset) {
      return stop;
    }
  }
  return null;
}

function offsetPreferenceScore(line: LineHitMap, stop: Stop, offset: number): number {
  if (
    stop.lineEnd &&
    line.breakInfo?.kind === 'hyphen' &&
    line.breakInfo.visibleHyphen &&
    line.visibleHyphenBreakOffset === offset
  ) {
    return 3;
  }
  if (stop.lineStart) {
    return 2;
  }
  if (stop.lineEnd) {
    return 1;
  }
  return 0;
}

function findBestStopForOffset(lines: LineHitMap[], offset: number): { line: LineHitMap; stop: Stop } | null {
  let best: { line: LineHitMap; stop: Stop } | null = null;

  for (const line of lines) {
    const breakPrefersLineEnd =
      line.breakInfo?.kind === 'hyphen' &&
      line.breakInfo.visibleHyphen &&
      line.visibleHyphenBreakOffset === offset;
    const candidate = stopForOffset(line, offset, !breakPrefersLineEnd);
    if (!candidate) {
      continue;
    }
    if (!best) {
      best = { line, stop: candidate };
      continue;
    }
    const candidateScore = offsetPreferenceScore(line, candidate, offset);
    const bestScore = offsetPreferenceScore(best.line, best.stop, offset);
    if (candidateScore > bestScore) {
      best = { line, stop: candidate };
      continue;
    }
    if (candidateScore === bestScore && candidate.x < best.stop.x) {
      best = { line, stop: candidate };
    }
  }

  return best;
}

function findNearestStopForOffset(
  lines: LineHitMap[],
  offset: number
): { line: LineHitMap; stop: Stop } | null {
  let best: { line: LineHitMap; stop: Stop } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestScore = -1;

  for (const line of lines) {
    for (const stop of line.stopsByOffset) {
      const distance = Math.abs(stop.offset - offset);
      if (distance < bestDistance - EPSILON) {
        best = { line, stop };
        bestDistance = distance;
        bestScore = offsetPreferenceScore(line, stop, offset);
        continue;
      }

      if (Math.abs(distance - bestDistance) > EPSILON || !best) {
        continue;
      }

      const score = offsetPreferenceScore(line, stop, offset);
      if (score > bestScore) {
        best = { line, stop };
        bestScore = score;
        continue;
      }

      if (
        score === bestScore &&
        (stop.offset < best.stop.offset ||
          (stop.offset === best.stop.offset && stop.x < best.stop.x))
      ) {
        best = { line, stop };
      }
    }
  }

  return best;
}

function inferLineByClientPoint(
  hitMap: ParagraphHitMap,
  clientPoint: ClientPoint
): LineHitMap {
  const reportLineByIndex = new Map(
    hitMap.report.lines.map((line) => [line.lineIndex, line])
  );
  let best: LineHitMap | null = null;
  let bestNormalDistance = Number.POSITIVE_INFINITY;
  let bestOutsideDistance = Number.POSITIVE_INFINITY;
  let bestFallbackDistance = Number.POSITIVE_INFINITY;

  for (const line of hitMap.lines) {
    const reportLine = reportLineByIndex.get(line.lineIndex)!;

    const origin = lineBaselineOriginPoint(line, reportLine);
    const reportLineEnd = Number(reportLine.xEnd);
    const reportLineStart = Number(reportLine.xStart);
    const effectiveLineEnd =
      Number.isFinite(reportLineEnd)
        ? reportLineEnd
        : Number.isFinite(reportLineStart)
          ? reportLineStart
          : 0;
    const end = lineLocalClientPoint(line, reportLine, effectiveLineEnd);
    const tangent = lineTangentUnit(line);
    const normal = lineNormalUnit(line);
    const dx = clientPoint.x - origin.x;
    const dy = clientPoint.y - origin.y;
    const normalDistance = Math.abs(dx * normal.x + dy * normal.y);
    const tangentPosition = dx * tangent.x + dy * tangent.y;
    const lineLength = Math.max(0, Math.hypot(end.x - origin.x, end.y - origin.y));
    let outsideDistance = 0;
    if (tangentPosition < 0) {
      outsideDistance = -tangentPosition;
    } else if (tangentPosition > lineLength) {
      outsideDistance = tangentPosition - lineLength;
    }
    const fallbackDistance = Math.abs(clientPoint.y - line.clientCenterY);

    const betterNormal = normalDistance < bestNormalDistance - EPSILON;
    const tiedNormal = Math.abs(normalDistance - bestNormalDistance) <= EPSILON;
    const betterOutside = outsideDistance < bestOutsideDistance - EPSILON;
    const tiedOutside = Math.abs(outsideDistance - bestOutsideDistance) <= EPSILON;
    const betterFallback = fallbackDistance < bestFallbackDistance - EPSILON;

    if (
      !best ||
      betterNormal ||
      (tiedNormal && betterOutside) ||
      (tiedNormal && tiedOutside && betterFallback)
    ) {
      best = line;
      bestNormalDistance = normalDistance;
      bestOutsideDistance = outsideDistance;
      bestFallbackDistance = fallbackDistance;
    }
  }

  return best!;
}

function mapBuildFailureCode(message: string): CaretMappingErrorCode {
  if (/tex2svg/i.test(message)) {
    return 'math-measurement-error';
  }
  if (/opening|closing|parse/i.test(message)) {
    return 'source-parse-error';
  }
  if (/rect|svg|geometry|rendered line|screen transform|viewBox|report width|xStart|xEnd/i.test(message)) {
    return 'geometry-error';
  }
  return 'alignment-error';
}

export async function getKnuthPlassCaretFromPoint(
  outputJax: unknown,
  params: Partial<CaretFromPointParams> | null | undefined
): Promise<CaretHitResult> {
  const paragraphId = String(params?.paragraphId ?? '');
  if (!params || !paragraphId || typeof params.sourceText !== 'string' || !params.containerElement || !params.clientPoint) {
    return invalidParamsResult<CaretHitResult>(
      paragraphId,
      { offset: null, lineIndex: null, kind: null, snappedToMathPrefix: false },
      'Expected paragraphId, sourceText, containerElement, and clientPoint.'
    );
  }

  const { report } = findReportByParagraphId(outputJax, paragraphId);
  if (!report) {
    return errorResult<CaretHitResult>(
      paragraphId,
      { offset: null, lineIndex: null, kind: null, snappedToMathPrefix: false },
      'paragraph-not-found',
      `Paragraph '${paragraphId}' was not found in Knuth-Plass reports.`
    );
  }

  let hitMap: ParagraphHitMap;
  try {
    hitMap = await getParagraphHitMap(outputJax, report, params.sourceText, params.containerElement);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build paragraph caret map.';
    return errorResult<CaretHitResult>(
      paragraphId,
      { offset: null, lineIndex: null, kind: null, snappedToMathPrefix: false },
      mapBuildFailureCode(message),
      message
    );
  }

  if (!hitMap.lines.length) {
    return errorResult<CaretHitResult>(
      paragraphId,
      { offset: null, lineIndex: null, kind: null, snappedToMathPrefix: false },
      'alignment-error',
      'Paragraph hitmap contains no line data.'
    );
  }

  const line = inferLineByClientPoint(hitMap, params.clientPoint);
  const reportLine = hitMap.report.lines.find((entry) => entry.lineIndex === line.lineIndex)!;

  const lineX = clientToLineLocalX(line, reportLine, params.clientPoint);
  const stop = nearestStopByX(line.stopsByX, lineX);
  if (stop.offset < 0 || stop.offset > params.sourceText.length) {
    return errorResult<CaretHitResult>(
      paragraphId,
      { offset: null, lineIndex: null, kind: null, snappedToMathPrefix: false },
      'alignment-error',
      `Measured stop offset ${stop.offset} is outside source bounds.`
    );
  }

  return {
    ok: true,
    paragraphId,
    offset: stop.offset,
    lineIndex: line.lineIndex,
    kind: stop.kind,
    snappedToMathPrefix: stop.snappedToMathPrefix,
    error: null,
  };
}

export async function getKnuthPlassPointFromOffset(
  outputJax: unknown,
  params: Partial<PointFromOffsetParams> | null | undefined
): Promise<CaretPointResult> {
  const paragraphId = String(params?.paragraphId ?? '');
  if (!params || !paragraphId || typeof params.sourceText !== 'string' || !params.containerElement) {
    return invalidParamsResult<CaretPointResult>(
      paragraphId,
      {
        offset: null,
        lineIndex: null,
        lineLocalX: null,
        clientPoint: null,
        rotationDeg: null,
        kind: null,
        snappedToMathPrefix: false,
      },
      'Expected paragraphId, sourceText, containerElement, and offset.'
    );
  }

  const { report } = findReportByParagraphId(outputJax, paragraphId);
  if (!report) {
    return errorResult<CaretPointResult>(
      paragraphId,
      {
        offset: null,
        lineIndex: null,
        lineLocalX: null,
        clientPoint: null,
        rotationDeg: null,
        kind: null,
        snappedToMathPrefix: false,
      },
      'paragraph-not-found',
      `Paragraph '${paragraphId}' was not found in Knuth-Plass reports.`
    );
  }

  let hitMap: ParagraphHitMap;
  try {
    hitMap = await getParagraphHitMap(outputJax, report, params.sourceText, params.containerElement);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build paragraph caret map.';
    return errorResult<CaretPointResult>(
      paragraphId,
      {
        offset: null,
        lineIndex: null,
        lineLocalX: null,
        clientPoint: null,
        rotationDeg: null,
        kind: null,
        snappedToMathPrefix: false,
      },
      mapBuildFailureCode(message),
      message
    );
  }

  if (!hitMap.lines.length) {
    return errorResult<CaretPointResult>(
      paragraphId,
      {
        offset: null,
        lineIndex: null,
        lineLocalX: null,
        clientPoint: null,
        rotationDeg: null,
        kind: null,
        snappedToMathPrefix: false,
      },
      'alignment-error',
      'Paragraph hitmap contains no line data.'
    );
  }

  const targetOffset = clamp(Math.floor(params.offset ?? 0), 0, params.sourceText.length);
  const exact = findBestStopForOffset(hitMap.lines, targetOffset);
  const selected = exact ?? findNearestStopForOffset(hitMap.lines, targetOffset);
  if (!selected) {
    return errorResult<CaretPointResult>(
      paragraphId,
      {
        offset: null,
        lineIndex: null,
        lineLocalX: null,
        clientPoint: null,
        rotationDeg: null,
        kind: null,
        snappedToMathPrefix: false,
      },
      'alignment-error',
      `Offset ${targetOffset} has no measured caret stop.`
    );
  }

  const reportLine = hitMap.report.lines.find(
    (entry) => entry.lineIndex === selected.line.lineIndex
  )!;

  const baselinePoint = lineLocalClientPoint(selected.line, reportLine, selected.stop.x);
  const normal = lineNormalUnit(selected.line);
  const normalOffset = lineBoxNormalOffset(selected.line, reportLine);
  const clientPoint = makeClientPoint(
    px(baselinePoint.x + normal.x * normalOffset),
    px(baselinePoint.y + normal.y * normalOffset)
  );

  return {
    ok: true,
    paragraphId,
    offset: selected.stop.offset,
    lineIndex: selected.line.lineIndex,
    lineLocalX: selected.stop.x,
    clientPoint,
    rotationDeg: (Math.atan2(selected.line.screenMatrix.b, selected.line.screenMatrix.a) * 180) / Math.PI,
    kind: selected.stop.kind,
    snappedToMathPrefix: selected.stop.snappedToMathPrefix,
    error: null,
  };
}

export async function getKnuthPlassSelectionRects(
  outputJax: unknown,
  params: Partial<SelectionRectsParams> | null | undefined
): Promise<SelectionRectsResult> {
  const paragraphId = String(params?.paragraphId ?? '');
  if (!params || !paragraphId || typeof params.sourceText !== 'string' || !params.containerElement) {
    return invalidParamsResult<SelectionRectsResult>(
      paragraphId,
      {
        startOffset: 0,
        endOffset: 0,
        rects: [],
      },
      'Expected paragraphId, sourceText, containerElement, startOffset, and endOffset.'
    );
  }

  const { report } = findReportByParagraphId(outputJax, paragraphId);
  if (!report) {
    return errorResult<SelectionRectsResult>(
      paragraphId,
      {
        startOffset: 0,
        endOffset: 0,
        rects: [],
      },
      'paragraph-not-found',
      `Paragraph '${paragraphId}' was not found in Knuth-Plass reports.`
    );
  }

  let hitMap: ParagraphHitMap;
  try {
    hitMap = await getParagraphHitMap(outputJax, report, params.sourceText, params.containerElement);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build paragraph caret map.';
    return errorResult<SelectionRectsResult>(
      paragraphId,
      {
        startOffset: 0,
        endOffset: 0,
        rects: [],
      },
      mapBuildFailureCode(message),
      message
    );
  }

  if (!hitMap.lines.length) {
    return errorResult<SelectionRectsResult>(
      paragraphId,
      {
        startOffset: 0,
        endOffset: 0,
        rects: [],
      },
      'alignment-error',
      'Paragraph hitmap contains no line data.'
    );
  }

  const start = clamp(Math.floor(params.startOffset ?? 0), 0, params.sourceText.length);
  const end = clamp(Math.floor(params.endOffset ?? 0), 0, params.sourceText.length);
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  if (rangeStart === rangeEnd) {
    return {
      ok: true,
      paragraphId,
      startOffset: rangeStart,
      endOffset: rangeEnd,
      rects: [],
      error: null,
    };
  }

  const rects: SelectionRect[] = [];

  for (const line of hitMap.lines) {
    if (rangeEnd < line.minOffset || rangeStart > line.maxOffset) {
      continue;
    }

    const startStop = firstStopAtOrAfter(line, rangeStart);
    const endStop = lastStopAtOrBefore(line, rangeEnd);
    if (!startStop || !endStop) {
      continue;
    }
    if (endStop.offset < startStop.offset) {
      continue;
    }

    const reportLine = hitMap.report.lines.find((entry) => entry.lineIndex === line.lineIndex)!;

    const startPoint = lineLocalClientPoint(line, reportLine, startStop.x);
    const endPoint = lineLocalClientPoint(line, reportLine, endStop.x);
    const segmentWidth = Math.hypot(endPoint.x - startPoint.x, endPoint.y - startPoint.y);
    if (segmentWidth <= EPSILON) {
      continue;
    }
    const baselineCenterX = (startPoint.x + endPoint.x) / 2;
    const baselineCenterY = (startPoint.y + endPoint.y) / 2;
    const normal = lineNormalUnit(line);
    const normalOffset = lineBoxNormalOffset(line, reportLine);
    const centerX = baselineCenterX + normal.x * normalOffset;
    const centerY = baselineCenterY + normal.y * normalOffset;
    const height = lineClientHeight(line, reportLine);
    const left = centerX - segmentWidth / 2;

    rects.push({
      lineIndex: line.lineIndex,
      startOffset: startStop.offset,
      endOffset: endStop.offset,
      bounds: clientBounds(
        px(left),
        px(centerY - height / 2),
        px(left + Math.max(1, segmentWidth)),
        px(centerY + height / 2)
      ),
      center: makeClientPoint(px(centerX), px(centerY)),
      rotationDeg: (Math.atan2(line.screenMatrix.b, line.screenMatrix.a) * 180) / Math.PI,
    });
  }

  return {
    ok: true,
    paragraphId,
    startOffset: rangeStart,
    endOffset: rangeEnd,
    rects,
    error: null,
  };
}

export async function getKnuthPlassLineRangeFromPoint(
  outputJax: unknown,
  params: Partial<CaretFromPointParams> | null | undefined
): Promise<LineRangeFromPointResult> {
  const paragraphId = String(params?.paragraphId ?? '');
  if (!params || !paragraphId || typeof params.sourceText !== 'string' || !params.containerElement || !params.clientPoint) {
    return invalidParamsResult<LineRangeFromPointResult>(
      paragraphId,
      {
        lineIndex: null,
        lineStartOffset: null,
        lineEndOffset: null,
      },
      'Expected paragraphId, sourceText, containerElement, and clientPoint.'
    );
  }

  const { report } = findReportByParagraphId(outputJax, paragraphId);
  if (!report) {
    return errorResult<LineRangeFromPointResult>(
      paragraphId,
      {
        lineIndex: null,
        lineStartOffset: null,
        lineEndOffset: null,
      },
      'paragraph-not-found',
      `Paragraph '${paragraphId}' was not found in Knuth-Plass reports.`
    );
  }

  let hitMap: ParagraphHitMap;
  try {
    hitMap = await getParagraphHitMap(outputJax, report, params.sourceText, params.containerElement);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build paragraph caret map.';
    return errorResult<LineRangeFromPointResult>(
      paragraphId,
      {
        lineIndex: null,
        lineStartOffset: null,
        lineEndOffset: null,
      },
      mapBuildFailureCode(message),
      message
    );
  }

  if (!hitMap.lines.length) {
    return errorResult<LineRangeFromPointResult>(
      paragraphId,
      {
        lineIndex: null,
        lineStartOffset: null,
        lineEndOffset: null,
      },
      'alignment-error',
      'Paragraph hitmap contains no line data.'
    );
  }

  const line = inferLineByClientPoint(hitMap, params.clientPoint);
  const lineStartOffset = clamp(Math.floor(line.minOffset), 0, params.sourceText.length);
  const lineEndOffset = clamp(Math.floor(line.maxOffset), 0, params.sourceText.length);
  return {
    ok: true,
    paragraphId,
    lineIndex: line.lineIndex,
    lineStartOffset: Math.min(lineStartOffset, lineEndOffset),
    lineEndOffset: Math.max(lineStartOffset, lineEndOffset),
    error: null,
  };
}

export function clearKnuthPlassCaretMappingCache(outputJax?: unknown): void {
  if (outputJax && typeof outputJax === 'object') {
    paragraphCacheByOutput.delete(outputJax);
    return;
  }
  paragraphCacheByOutput = new WeakMap<object, Map<string, CachedParagraphEntry>>();
}

export function __getKnuthPlassCaretMappingCacheSize(outputJax: unknown): number {
  if (!outputJax || typeof outputJax !== 'object') {
    return 0;
  }
  return paragraphCacheByOutput.get(outputJax)?.size ?? 0;
}
