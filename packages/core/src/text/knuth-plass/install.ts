import { KnuthPlassVisitor } from './KnuthPlassVisitor.js';
import type { ParagraphLayoutReport } from './paragraph/report.js';
import type { ParagraphAlignment } from './alignment.js';
import {
  clearKnuthPlassCaretMappingCache,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  type CaretFromPointParams,
  type CaretHitResult,
  type LineRangeFromPointResult,
  type CaretPointResult,
  type PointFromOffsetParams,
  type SelectionRectsParams,
  type SelectionRectsResult,
} from './editor/hitmap.js';

export type OutputJaxName = 'svg' | 'chtml';
export type KnuthPlassLayoutMode =
  | 'wrap'
  | 'fixed-lines'
  | 'wrapped-explicit';

export interface WrappedTextGap {
  sourceStart: number;
  widthEm: number;
  stretchEm?: number;
  shrinkEm?: number;
  spaceFactor?: number;
}

export interface KnuthPlassConfig {
  alignment?: ParagraphAlignment;
  layoutMode?: KnuthPlassLayoutMode;
  wrappedTextGaps?: WrappedTextGap[];
  pretolerance?: number;
  tolerance?: number;
  linepenalty?: number;
  hyphenpenalty?: number;
  exhyphenpenalty?: number;
  adjdemerits?: number;
  doublehyphendemerits?: number;
  finalhyphendemerits?: number;
  lefthyphenmin?: number;
  righthyphenmin?: number;
}

export interface MathJaxOutputConfig {
  linebreaks?: {
    LinebreakVisitor?: typeof KnuthPlassVisitor;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MathJaxConfigLike {
  svg?: MathJaxOutputConfig;
  chtml?: MathJaxOutputConfig;
  [key: string]: unknown;
}

interface MathJaxOutputJaxLike {
  knuthPlassOptions?: KnuthPlassConfig;
  linebreaks?: {
    getReports?(): ParagraphLayoutReport[];
  };
}

const supplementalReportsByOutputJax = new WeakMap<object, Map<string, ParagraphLayoutReport>>();

export function installKnuthPlassVisitor(
  config: MathJaxConfigLike,
  outputs: OutputJaxName[] = ['svg']
): MathJaxConfigLike {
  for (const output of outputs) {
    const outputConfig = (config[output] ??= {});
    const linebreaks = (outputConfig.linebreaks ??= {});
    linebreaks.LinebreakVisitor = KnuthPlassVisitor;
  }

  return config;
}

export function setKnuthPlassOptionsOnOutputJax(
  outputJax: unknown,
  options: KnuthPlassConfig | null | undefined
): void {
  if (!outputJax || typeof outputJax !== 'object') {
    return;
  }
  if (!options || typeof options !== 'object') {
    return;
  }

  const target = outputJax as MathJaxOutputJaxLike;
  const existing =
    target.knuthPlassOptions && typeof target.knuthPlassOptions === 'object'
      ? target.knuthPlassOptions
      : {};

  target.knuthPlassOptions = {
    ...existing,
    ...options,
  };
}

export function getKnuthPlassReportsFromOutputJax(
  outputJax: unknown
): ParagraphLayoutReport[] {
  if (!outputJax || typeof outputJax !== 'object') {
    return [];
  }

  const target = outputJax as MathJaxOutputJaxLike;
  const fromVisitor = target.linebreaks?.getReports?.();
  const reports = Array.isArray(fromVisitor) ? [...fromVisitor] : [];
  const supplemental = supplementalReportsByOutputJax.get(outputJax);
  if (supplemental) {
    const seen = new Set(reports.map((report) => report.paragraphId));
    for (const report of supplemental.values()) {
      if (!seen.has(report.paragraphId)) {
        reports.push(report);
      }
    }
  }
  return reports;
}

export function registerKnuthPlassReportsOnOutputJax(
  outputJax: unknown,
  reports: readonly ParagraphLayoutReport[]
): void {
  if (!outputJax || typeof outputJax !== 'object' || reports.length === 0) {
    return;
  }
  const existing = supplementalReportsByOutputJax.get(outputJax) ?? new Map<string, ParagraphLayoutReport>();
  for (const report of reports) {
    existing.set(report.paragraphId, report);
  }
  supplementalReportsByOutputJax.set(outputJax, existing);
}

export {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  clearKnuthPlassCaretMappingCache,
  type CaretFromPointParams,
  type PointFromOffsetParams,
  type SelectionRectsParams,
  type CaretHitResult,
  type LineRangeFromPointResult,
  type CaretPointResult,
  type SelectionRectsResult,
};
