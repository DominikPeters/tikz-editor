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
import type {
  TexLayoutReport,
  TexLineBox,
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
import { prepareSimpleTexVList } from "./prepare-simple.js";
import {
  createMeasuredParagraphVListMeasurer,
  createTexVListHorizontalParagraphReportLayout,
  measureTexVListParagraphBoxesFromReport,
  texVListParagraphMeasurementFromHorizontalLayout,
  texVListParagraphMeasurementMap,
  validateTexVListParagraphLineAssignments,
  validateTexVListParagraphMeasurements,
} from "./paragraph-measurement.js";
import { texVListBoxLayoutReport } from "./box-report.js";
import {
  assertAllReportLinesPlaced,
  texVListLinePlacements,
  texVListParagraphPlacements,
} from "./placements.js";

export interface TexVListParagraphReportLayoutOptions extends TexVListLayoutOptions {
  readonly lineHeight: number;
  readonly firstLineAscent?: number;
  readonly paragraphLineAssignments: readonly TexVListParagraphLineAssignment[];
}

export interface SimpleTexVListParagraphReportLayoutOptions extends TexVListParagraphReportLayoutOptions {
  readonly font: ResolvedTexFont;
}

export interface SimpleTexVListHorizontalParagraphReportLayoutOptions extends TexVListLayoutOptions {
  readonly font: ResolvedTexFont;
  readonly report: ParagraphLayoutReport;
  readonly lineBoxes: readonly TexLineBox[];
  readonly paragraphLineAssignments: readonly TexVListParagraphLineAssignment[];
}

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

export interface TexVListParagraphReportLayoutResult {
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
  readonly paragraphLineAssignments: readonly TexVListParagraphLineAssignment[];
  readonly errors: readonly string[];
  readonly linebreakingMode: "feasible" | "overfull";
}

export interface TexVListCombinedParagraphReportLayoutOptions extends TexVListLayoutOptions {
  readonly paragraphId: string;
  readonly alignment: TexParagraphAlignment;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly font: ResolvedTexFont;
  readonly metricProvider: TexMetricProvider;
  readonly combined: TexVListCombinedParagraphReportInput;
}

const LATEX_NORMAL_BASELINESKIP_EM = 1.2;
const LATEX_NORMAL_STRUT_HEIGHT_EM = 0.85;

export function layoutTexVListFromCombinedParagraphReport(
  document: TexVListDocument,
  options: TexVListCombinedParagraphReportLayoutOptions
): TexVListParagraphReportLayoutResult {
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
  return layoutTexVListFromHorizontalParagraphReport(document, {
    width: options.width,
    height: options.height,
    verticalAlign: options.verticalAlign,
    font: options.font,
    report: builtReport.report,
    lineBoxes: builtReport.lineBoxes,
    paragraphLineAssignments: options.combined.paragraphLineAssignments,
  });
}

export function layoutTexVListFromHorizontalParagraphReport(
  document: TexVListDocument,
  options: TexVListLayoutOptions & {
    readonly font: ResolvedTexFont;
    readonly report: ParagraphLayoutReport;
    readonly lineBoxes: readonly TexLineBox[];
    readonly paragraphLineAssignments: readonly TexVListParagraphLineAssignment[];
  }
): TexVListParagraphReportLayoutResult {
  validateTexVListParagraphLineAssignments(
    document,
    options.paragraphLineAssignments
  );
  const lineHeight = texLatexNormalParagraphLineHeight(options.font);
  const firstLineAscent = texLatexNormalFirstLineAscent(
    options.report,
    options.font
  );
  const horizontalLayout = createTexVListHorizontalParagraphReportLayout({
    report: options.report,
    lineBoxes: options.lineBoxes,
    paragraphLineAssignments: options.paragraphLineAssignments,
    lineHeight,
  });
  const layout = layoutTexVListFromHorizontalParagraphs(document, {
    width: options.width,
    height: options.height,
    verticalAlign: options.verticalAlign,
    lineHeight,
    firstLineIndex: horizontalLayout.report.lines[0]?.lineIndex,
    firstLineAscent,
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

export function layoutSimpleTexVListFromHorizontalParagraphReport(
  document: TexVListDocument,
  options: SimpleTexVListHorizontalParagraphReportLayoutOptions
): TexVListParagraphReportLayoutResult {
  return layoutTexVListFromHorizontalParagraphReport(
    prepareSimpleTexVList(document, options.font).normalized,
    options
  );
}

export function layoutTexVListFromParagraphReport(
  document: TexVListDocument,
  report: ParagraphLayoutReport,
  options: TexVListParagraphReportLayoutOptions
): TexVListLayout {
  validateTexVListParagraphLineAssignments(
    document,
    options.paragraphLineAssignments
  );
  const paragraphMeasurements = measureTexVListParagraphBoxesFromReport(
    report,
    options.lineHeight,
    options.paragraphLineAssignments
  );
  const layout = layoutTexVListFromMeasuredParagraphs(document, {
    ...options,
    firstLineIndex: report.lines[0]?.lineIndex,
    paragraphMeasurements,
    reports: report.lines.length > 0 ? [report] : [],
    errors: report.errors,
  });
  assertAllReportLinesPlaced(report.lines, layout.linePlacements);
  return layout;
}

export function layoutSimpleTexVListFromParagraphReport(
  document: TexVListDocument,
  report: ParagraphLayoutReport,
  options: SimpleTexVListParagraphReportLayoutOptions
): TexVListLayout {
  return layoutTexVListFromParagraphReport(
    prepareSimpleTexVList(document, options.font).normalized,
    report,
    options
  );
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
  const measurer = createMeasuredParagraphVListMeasurer(paragraphMeasurements);
  const naturalTotalHeight = computeTexVListNaturalTotalHeight(
    document.items,
    measurer
  );
  const glueSet = texVListGlueSetForTargetHeight(
    document.items,
    naturalTotalHeight,
    options.height
  );
  const laidOut = layoutTexVListItems(
    document.items,
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
