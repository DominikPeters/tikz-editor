import { KnuthPlassVisitor } from './KnuthPlassVisitor.js';
import type { ParagraphAlignment } from './alignment.js';
import {
  getKnuthPlassReportsFromOutputJax,
  registerKnuthPlassReportsOnOutputJax,
} from './report-registry.js';
import {
  clearKnuthPlassCaretMappingCache,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPlaceholderGeometry,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  getKnuthPlassVListBoxGeometry,
  getKnuthPlassVListItemGeometry,
  getKnuthPlassVListParagraphGeometry,
  type CaretFromPointParams,
  type CaretHitResult,
  type LineRangeFromPointResult,
  type CaretPointResult,
  type PlaceholderGeometry,
  type PlaceholderGeometryParams,
  type PointFromOffsetParams,
  type SelectionRectsParams,
  type SelectionRectsResult,
  type VListBoxGeometry,
  type VListBoxGeometryParams,
  type VListItemGeometry,
  type VListItemGeometryParams,
  type VListParagraphGeometry,
  type VListParagraphGeometryParams,
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
}

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

export {
  getKnuthPlassReportsFromOutputJax,
  registerKnuthPlassReportsOnOutputJax,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPlaceholderGeometry,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  getKnuthPlassVListBoxGeometry,
  getKnuthPlassVListItemGeometry,
  getKnuthPlassVListParagraphGeometry,
  clearKnuthPlassCaretMappingCache,
  type CaretFromPointParams,
  type PointFromOffsetParams,
  type SelectionRectsParams,
  type CaretHitResult,
  type LineRangeFromPointResult,
  type CaretPointResult,
  type PlaceholderGeometry,
  type PlaceholderGeometryParams,
  type SelectionRectsResult,
  type VListBoxGeometry,
  type VListBoxGeometryParams,
  type VListItemGeometry,
  type VListItemGeometryParams,
  type VListParagraphGeometry,
  type VListParagraphGeometryParams,
};
