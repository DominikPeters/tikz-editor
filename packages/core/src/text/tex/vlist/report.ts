import type { KnuthPlassLayoutMode } from "../../knuth-plass/index.js";
import type { ParagraphLayoutReport } from "../../knuth-plass/paragraph/report.js";
import type {
  GreedyLine,
  ParagraphRun,
} from "../../knuth-plass/paragraph/types.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
} from "../fonts/types.js";
import type { TexParagraphAlignment } from "../ir.js";
import type { TexLayoutLabel } from "../layout-inline-items.js";
import { buildTexParagraphReport } from "../paragraph-report.js";
import {
  combineTexBrokenLayoutParagraphs,
  type TexBrokenLayoutParagraph,
} from "./combined-paragraph-breaks.js";
import type {
  TexLayoutReport,
  TexVListParagraphBoxMeasurement,
  TexVListParagraphHorizontalLayout,
  TexVListParagraphLineAssignment,
  TexVListDocument,
  TexVListLayout,
  TexVListLayoutOptions,
} from "./types.js";
import {
  computeTexVListNaturalTotalHeight,
  layoutTexVListItems,
  metricsForRootBox,
  offsetPositionedTexVListItems,
  texVListBaselineY,
  texVListGlueSetForTargetHeight,
  texVListRootVerticalOffset,
} from "./layout.js";
import {
  createMeasuredParagraphVListMeasurer,
  createTexVListParagraphHorizontalLayoutsFromLineBoxes,
  texVListParagraphMeasurementFromHorizontalLayout,
  texVListParagraphMeasurementMap,
  validateTexVListParagraphMeasurements,
} from "./paragraph-measurement.js";
import {
  resolveDisplayMathVerticalGlueInVList,
} from "./spacing.js";
import { texVListBoxLayoutReport } from "./box-report.js";
import {
  assertAllReportLinesPlaced,
  texVListLinePlacements,
  texVListParagraphPlacements,
} from "./placements.js";

export interface TexVListMeasuredParagraphLayoutOptions extends TexVListLayoutOptions {
  readonly lineHeight: number;
  readonly firstLineIndex?: number;
  readonly firstLineAscent?: number;
  readonly paragraphMeasurements: readonly TexVListParagraphBoxMeasurement[];
  readonly reports?: readonly (TexLayoutReport | ParagraphLayoutReport)[];
  readonly errors?: readonly string[];
}

export interface TexVListHorizontalParagraphLayoutOptions extends TexVListLayoutOptions {
  readonly lineHeight: number;
  readonly firstLineIndex?: number;
  readonly firstLineAscent?: number;
  readonly paragraphLayouts: readonly TexVListParagraphHorizontalLayout[];
  readonly reports?: readonly (TexLayoutReport | ParagraphLayoutReport)[];
  readonly errors?: readonly string[];
}

export interface TexVListParagraphReportAssemblyResult {
  readonly report: ParagraphLayoutReport;
  readonly layout: TexVListLayout;
}

export interface TexVListCombinedParagraphReportInput {
  readonly runs: readonly ParagraphRun[];
  readonly lines: readonly GreedyLine[];
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly runWidths: ReadonlyMap<number, number>;
  readonly lineLabels: ReadonlyMap<number, {
    readonly label: TexLayoutLabel;
    readonly lineRunIndex: number;
  }>;
  readonly paragraphLineSpans: readonly {
    readonly blockIndex: number;
    readonly vlistPath: readonly number[];
    readonly lineIndices: readonly number[];
  }[];
  readonly errors: readonly string[];
  readonly linebreakingMode: "feasible" | "overfull";
}

export interface TexVListCombinedParagraphReportAssemblyOptions extends TexVListLayoutOptions {
  readonly paragraphId: string;
  readonly alignment: TexParagraphAlignment;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly font: ResolvedTexFont;
  readonly metricProvider: TexMetricProvider;
  readonly combined: TexVListCombinedParagraphReportInput;
}

export interface TexVListBrokenParagraphReportAssemblyOptions extends TexVListLayoutOptions {
  readonly paragraphId: string;
  readonly alignment: TexParagraphAlignment;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly font: ResolvedTexFont;
  readonly metricProvider: TexMetricProvider;
  readonly entries: readonly TexBrokenLayoutParagraph[];
  readonly initialErrors?: readonly string[];
}

export interface TexVListBrokenParagraphReportLaidOutResult extends TexVListParagraphReportAssemblyResult {
  readonly status: "laid-out";
  readonly combined: TexVListCombinedParagraphReportInput;
}

export interface TexVListBrokenParagraphReportEmptyResult {
  readonly status: "empty";
  readonly combined: TexVListCombinedParagraphReportInput;
}

export type TexVListBrokenParagraphReportAssemblyResult =
  | TexVListBrokenParagraphReportLaidOutResult
  | TexVListBrokenParagraphReportEmptyResult;

const LATEX_NORMAL_BASELINESKIP_EM = 1.2;
const LATEX_NORMAL_STRUT_HEIGHT_EM = 0.85;

export function layoutTexVListFromBrokenParagraphs(
  document: TexVListDocument,
  options: TexVListBrokenParagraphReportAssemblyOptions
): TexVListBrokenParagraphReportAssemblyResult {
  const combined = combineTexBrokenLayoutParagraphs({
    entries: options.entries,
    initialErrors: options.initialErrors,
  });
  if (combined.runs.length === 0 || combined.lines.length === 0) {
    return {
      status: "empty",
      combined,
    };
  }
  return {
    status: "laid-out",
    ...layoutTexVListFromCombinedParagraphReport(document, {
      width: options.width,
      height: options.height,
      verticalAlign: options.verticalAlign,
      paragraphId: options.paragraphId,
      alignment: options.alignment,
      layoutMode: options.layoutMode,
      font: options.font,
      metricProvider: options.metricProvider,
      combined,
    }),
    combined,
  };
}

export function layoutTexVListFromCombinedParagraphReport(
  document: TexVListDocument,
  options: TexVListCombinedParagraphReportAssemblyOptions
): TexVListParagraphReportAssemblyResult {
  const paragraphLineAssignments = texVListParagraphLineAssignmentsFromSpans(
    options.combined.paragraphLineSpans
  );
  const builtReport = buildTexParagraphReport({
    paragraphId: options.paragraphId,
    width: options.width,
    alignment: options.alignment,
    runs: options.combined.runs,
    lines: options.combined.lines,
    shapedRuns: options.combined.shapedRuns,
    runWidths: options.combined.runWidths,
    lineLabels: options.combined.lineLabels,
    linebreakingMode: options.combined.linebreakingMode,
    layoutMode: options.layoutMode,
    font: options.font,
    metricProvider: options.metricProvider,
    errors: options.combined.errors,
  });
  const horizontalLayout = createTexVListParagraphHorizontalLayoutsFromLineBoxes({
    report: builtReport.report,
    lineBoxes: builtReport.lineBoxes,
    paragraphLineAssignments,
    lineHeight: texLatexNormalParagraphLineHeight(options.font),
  });
  const layout = layoutTexVListFromHorizontalParagraphs(document, {
    width: options.width,
    height: options.height,
    verticalAlign: options.verticalAlign,
    lineHeight: texLatexNormalParagraphLineHeight(options.font),
    firstLineIndex: horizontalLayout.report.lines[0]?.lineIndex,
    firstLineAscent: texLatexNormalFirstLineAscent(
      builtReport.report,
      options.font
    ),
    paragraphLayouts: horizontalLayout.paragraphLayouts,
    reports: [horizontalLayout.report],
    errors: horizontalLayout.report.errors,
  });
  assertAllReportLinesPlaced(horizontalLayout.report.lines, layout.linePlacements);
  return {
    report: horizontalLayout.report,
    layout,
  };
}

function texVListParagraphLineAssignmentsFromSpans(
  spans: TexVListCombinedParagraphReportInput["paragraphLineSpans"]
): readonly TexVListParagraphLineAssignment[] {
  return spans.map((span) => ({
    blockIndex: span.blockIndex,
    vlistPath: [...span.vlistPath],
    lineIndices: [...span.lineIndices],
  }));
}

function texLatexNormalParagraphLineHeight(font: ResolvedTexFont): number {
  return font.atPt * LATEX_NORMAL_BASELINESKIP_EM;
}

function texLatexNormalFirstLineAscent(
  report: ParagraphLayoutReport,
  font: ResolvedTexFont
): number {
  return Math.max(
    font.atPt * LATEX_NORMAL_STRUT_HEIGHT_EM,
    ...report.lines.map((line) => Number(line.ascent) || 0)
  );
}

export function layoutTexVListFromHorizontalParagraphs(
  document: TexVListDocument,
  options: TexVListHorizontalParagraphLayoutOptions
): TexVListLayout {
  return layoutTexVListFromMeasuredParagraphs(document, {
    ...options,
    paragraphMeasurements: options.paragraphLayouts.map(
      texVListParagraphMeasurementFromHorizontalLayout
    ),
  });
}

export function layoutTexVListFromMeasuredParagraphs(
  document: TexVListDocument,
  options: TexVListMeasuredParagraphLayoutOptions
): TexVListLayout {
  validateTexVListParagraphMeasurements(document, options.paragraphMeasurements);
  const paragraphMeasurements = texVListParagraphMeasurementMap(options.paragraphMeasurements);
  const resolvedDocument = resolveDisplayMathVerticalGlueInVList(
    document,
    paragraphMeasurements,
    { lineHeight: options.lineHeight }
  );
  const measurer = createMeasuredParagraphVListMeasurer(paragraphMeasurements);
  const naturalTotalHeight = computeTexVListNaturalTotalHeight(
    resolvedDocument.items,
    measurer
  );
  const glueSet = texVListGlueSetForTargetHeight(
    resolvedDocument.items,
    naturalTotalHeight,
    options.height
  );
  const laidOut = layoutTexVListItems(
    resolvedDocument.items,
    measurer,
    glueSet,
    0
  );

  const naturalLaidOutHeight = laidOut.cursor;
  const totalHeight = Number.isFinite(options.height) && options.height !== undefined
    ? Math.max(options.height, naturalLaidOutHeight)
    : naturalLaidOutHeight;
  const rootOffset = texVListRootVerticalOffset(
    naturalLaidOutHeight,
    totalHeight,
    options.verticalAlign
  );
  const shiftedItems = offsetPositionedTexVListItems(laidOut.positioned, rootOffset);
  const linePlacements = texVListLinePlacements(
    shiftedItems,
    paragraphMeasurements,
    options.lineHeight
  );
  const firstLineTop = options.firstLineIndex !== undefined
    ? linePlacements.find((placement) => placement.lineIndex === options.firstLineIndex)?.y ?? null
    : null;
  const shiftedBaselineY = texVListBaselineY(
    firstLineTop,
    options.firstLineAscent ?? 0
  );
  const metrics = metricsForRootBox(options.width, totalHeight, shiftedBaselineY);
  const baseline = shiftedBaselineY === null ? { kind: "none" } as const : { kind: "explicit", y: shiftedBaselineY } as const;
  return {
    metrics,
    baseline,
    items: shiftedItems,
    boxReport: texVListBoxLayoutReport(shiftedItems, metrics, baseline),
    paragraphPlacements: texVListParagraphPlacements(
      shiftedItems,
      paragraphMeasurements
    ),
    linePlacements,
    reports: options.reports ?? [],
    errors: [...options.errors ?? []],
  };
}
