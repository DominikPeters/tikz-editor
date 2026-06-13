import { parseLength } from "../../../semantic/coords/parse-length.js";
import { roundTexPt } from "../fonts/units.js";
import type {
  LineReport,
  ParagraphLayoutReport,
} from "../../knuth-plass/paragraph/report.js";
import type {
  TexBoxMetrics,
  PositionedTexVListItem,
  TexLayoutReport,
  TexSourceSpan,
  TexVListBoxLayoutReport,
  TexVListBoxReportItem,
  TexVListParagraphBoxMeasurement,
  TexVListParagraphHorizontalLayout,
  TexVListParagraphLineAssignment,
  TexVListDocument,
  TexVListItem,
  TexVListLayout,
  TexVListLayoutOptions,
  TexVListParagraphPlacement,
  TexVListLinePlacement,
} from "./types.js";
import {
  computeTexVListNaturalTotalHeight,
  layoutTexVListItems,
  metricsForRootBox,
  offsetPositionedTexVListItems,
  texVListBaselineY,
  texVListGlueSetForTargetHeight,
  texVListRootVerticalOffset,
  type TexVListItemMeasurer,
} from "./layout.js";
import { flattenPositionedTexVListItems } from "./traversal.js";

export interface TexVListParagraphReportLayoutOptions extends TexVListLayoutOptions {
  readonly lineHeight: number;
  readonly firstLineAscent?: number;
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

export function layoutTexVListFromParagraphReport(
  document: TexVListDocument,
  report: ParagraphLayoutReport,
  options: TexVListParagraphReportLayoutOptions
): TexVListLayout {
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
  const paragraphMeasurements = paragraphMeasurementMap(options.paragraphMeasurements);
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

export function texVListBoxLayoutReport(
  items: readonly PositionedTexVListItem[],
  metrics: TexBoxMetrics,
  baseline: TexVListBoxLayoutReport["baseline"]
): TexVListBoxLayoutReport {
  return {
    kind: "tex-vlist-boxes",
    metrics,
    baseline,
    items: flattenPositionedTexVListItems(items).map(texVListBoxReportItem),
  };
}

function texVListBoxReportItem(
  item: PositionedTexVListItem
): TexVListBoxReportItem {
  const sourceSpan = texVListItemSourceSpan(item);
  const report: TexVListBoxReportItem = {
    itemKind: item.item.kind,
    path: item.path ?? [],
    ...(sourceSpan ? { sourceSpan } : {}),
    x: item.x,
    y: item.y,
    width: item.metrics.width,
    height: item.metrics.height,
    depth: item.metrics.depth,
    totalHeight: roundTexPt(item.metrics.height + item.metrics.depth),
    ...(item.item.kind === "paragraph" ? { blockIndex: item.item.blockIndex } : {}),
    ...(item.item.kind === "vbox" && item.item.role ? { role: item.item.role } : {}),
    ...(item.item.kind === "glue" ? {
      glue: {
        size: item.item.size,
        ...(item.item.stretch !== undefined ? { stretch: item.item.stretch } : {}),
        ...(item.item.shrink !== undefined ? { shrink: item.item.shrink } : {}),
        ...(item.item.stretchOrder !== undefined ? { stretchOrder: item.item.stretchOrder } : {}),
        ...(item.item.shrinkOrder !== undefined ? { shrinkOrder: item.item.shrinkOrder } : {}),
        ...(item.item.origin !== undefined ? { origin: item.item.origin } : {}),
      },
    } : {}),
    ...(item.item.kind === "penalty" ? { penalty: item.item.penalty } : {}),
    ...(item.item.kind === "placeholder" ? { placeholderReason: item.item.reason } : {}),
  };
  return report;
}

function texVListItemSourceSpan(
  item: PositionedTexVListItem
): TexSourceSpan | undefined {
  return "sourceSpan" in item.item ? item.item.sourceSpan : undefined;
}

function texVListLinePlacements(
  items: readonly PositionedTexVListItem[],
  paragraphMeasurements: ReadonlyMap<number, TexVListParagraphBoxMeasurement>,
  lineHeight: number
): readonly TexVListLinePlacement[] {
  const lineYByIndex = new Map<number, number>();
  for (const item of flattenPositionedTexVListItems(items)) {
    if (item.item.kind !== "paragraph") {
      continue;
    }
    const measurement = paragraphMeasurements.get(item.item.paragraph.blockIndex);
    if (!measurement) {
      throw new Error(
        `TeX vlist layout is missing paragraph measurement for block ${item.item.paragraph.blockIndex}.`
      );
    }
    for (const line of measurement.lineOffsets) {
      if (lineYByIndex.has(line.lineIndex)) {
        throw new Error(`TeX vlist layout placed line ${line.lineIndex} more than once.`);
      }
      lineYByIndex.set(line.lineIndex, roundTexPt(item.y + line.y));
    }
  }
  return Array.from(lineYByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([lineIndex, y]) => ({
      lineIndex,
      y,
      height: lineHeight,
    }));
}

function paragraphMeasurementMap(
  measurements: readonly TexVListParagraphBoxMeasurement[]
): ReadonlyMap<number, TexVListParagraphBoxMeasurement> {
  const byBlock = new Map<number, TexVListParagraphBoxMeasurement>();
  for (const measurement of measurements) {
    if (byBlock.has(measurement.blockIndex)) {
      throw new Error(
        `TeX vlist layout received duplicate paragraph measurement for block ${measurement.blockIndex}.`
      );
    }
    byBlock.set(measurement.blockIndex, measurement);
    const lineIndices = new Set(measurement.lineIndices);
    for (const lineIndex of measurement.lineIndices) {
      if (!measurement.lineOffsets.some((line) => line.lineIndex === lineIndex)) {
        throw new Error(
          `TeX vlist paragraph measurement for block ${measurement.blockIndex} is missing line offset ${lineIndex}.`
        );
      }
    }
    const seenLineOffsets = new Set<number>();
    for (const line of measurement.lineOffsets) {
      if (!lineIndices.has(line.lineIndex)) {
        throw new Error(
          `TeX vlist paragraph measurement for block ${measurement.blockIndex} has stray line offset ${line.lineIndex}.`
        );
      }
      if (seenLineOffsets.has(line.lineIndex)) {
        throw new Error(
          `TeX vlist paragraph measurement for block ${measurement.blockIndex} has duplicate line offset ${line.lineIndex}.`
        );
      }
      seenLineOffsets.add(line.lineIndex);
    }
  }
  return byBlock;
}

function assertAllReportLinesPlaced(
  lines: readonly LineReport[],
  linePlacements: readonly TexVListLinePlacement[]
): void {
  const placedLineIndices = new Set(linePlacements.map((placement) => placement.lineIndex));
  for (const line of lines) {
    if (!placedLineIndices.has(line.lineIndex)) {
      throw new Error(`TeX vlist layout did not place line ${line.lineIndex}.`);
    }
  }
}

function texVListParagraphPlacements(
  items: readonly PositionedTexVListItem[],
  paragraphMeasurements: ReadonlyMap<number, TexVListParagraphBoxMeasurement>
): readonly TexVListParagraphPlacement[] {
  const placements: TexVListParagraphPlacement[] = [];
  for (const item of flattenPositionedTexVListItems(items)) {
    if (item.item.kind !== "paragraph") {
      continue;
    }
    const measurement = paragraphMeasurements.get(item.item.paragraph.blockIndex);
    if (!measurement) {
      throw new Error(
        `TeX vlist layout is missing paragraph measurement for block ${item.item.paragraph.blockIndex}.`
      );
    }
    placements.push({
      blockIndex: item.item.paragraph.blockIndex,
      vlistPath: item.path,
      sourceSpan: item.item.sourceSpan,
      lineIndices: measurement.lineIndices,
      y: item.y,
      metrics: item.metrics,
    });
  }
  return placements;
}

function texVListParagraphMeasurementFromHorizontalLayout(
  paragraph: TexVListParagraphHorizontalLayout
): TexVListParagraphBoxMeasurement {
  const lines = paragraph.horizontal.lines ?? [];
  const lineIndices = lines.map((line) => line.lineIndex);
  if (!sameLineIndices(paragraph.lineIndices, lineIndices)) {
    throw new Error(`Measured horizontal paragraph block ${paragraph.blockIndex} line ownership changed.`);
  }
  const standardBottom = roundTexPt(
    paragraph.horizontal.metrics.height + paragraph.horizontal.metrics.depth
  );
  const firstLine = lines[0];
  const lastLine = lines.at(-1);
  const ruleLeadingBottom = lastLine
    ? roundTexPt(lastLine.y + (firstLine?.metrics.height ?? 0) + lastLine.metrics.depth)
    : 0;
  return {
    blockIndex: paragraph.blockIndex,
    lineIndices,
    lineOffsets: lines.map((line) => ({
      lineIndex: line.lineIndex,
      y: line.y,
    })),
    standardMetrics: paragraph.horizontal.metrics,
    ruleLeadingMetrics: paragraphBoxMetrics(
      paragraph.horizontal.metrics.width,
      paragraph.horizontal.metrics.height,
      ruleLeadingBottom
    ),
    standardAdvance: standardBottom,
    ruleLeadingAdvance: ruleLeadingBottom,
  };
}

function sameLineIndices(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createMeasuredParagraphVListMeasurer(
  paragraphMeasurements: ReadonlyMap<number, TexVListParagraphBoxMeasurement>
): TexVListItemMeasurer {
  return (item, cursor, index, items) => {
    if (item.kind !== "paragraph") {
      return null;
    }
    const measurement = paragraphMeasurements.get(item.paragraph.blockIndex);
    if (!measurement) {
      throw new Error(
        `TeX vlist report adapter is missing paragraph measurement for block ${item.paragraph.blockIndex}.`
      );
    }
    if (measurement.lineIndices.length === 0) {
      return null;
    }
    const useRuleLeadingBottom = shouldUseActualParagraphBottomBeforeNextItem(items, index);
    return {
      y: cursor,
      advance: useRuleLeadingBottom ? measurement.ruleLeadingAdvance : measurement.standardAdvance,
      metrics: useRuleLeadingBottom ? measurement.ruleLeadingMetrics : measurement.standardMetrics,
    };
  };
}

export function measureTexVListParagraphBoxesFromReport(
  report: ParagraphLayoutReport,
  lineHeight: number,
  paragraphLineAssignments: readonly TexVListParagraphLineAssignment[]
): readonly TexVListParagraphBoxMeasurement[] {
  const assignedLinesByBlock = paragraphLineAssignmentMap(
    paragraphLineAssignments,
    report.lines
  );
  const measurements = new Map<number, TexVListParagraphBoxMeasurement>();
  for (const [blockIndex, matchingLines] of assignedLinesByBlock) {
    if (matchingLines.length === 0) {
      measurements.set(blockIndex, {
        blockIndex,
        lineIndices: [],
        lineOffsets: [],
        standardMetrics: { width: 0, height: 0, depth: 0 },
        ruleLeadingMetrics: { width: 0, height: 0, depth: 0 },
        standardAdvance: 0,
        ruleLeadingAdvance: 0,
      });
      continue;
    }

    let lineCursor = 0;
    let lastLineTop = 0;
    const lineOffsets: TexVListParagraphBoxMeasurement["lineOffsets"][number][] = [];
    for (const line of matchingLines) {
      lastLineTop = lineCursor;
      lineOffsets.push({
        lineIndex: line.lineIndex,
        y: roundTexPt(lineCursor),
      });
      lineCursor = roundTexPt(
        lineCursor + lineHeight + texLineLeadingPt(line.break?.lineLeading)
      );
    }

    const firstLine = matchingLines[0];
    const baselineY = roundTexPt(texLineAscent(firstLine));
    const lastLine = matchingLines.at(-1);
    const baselineAscent = texLineAscent(firstLine);
    const standardBottom = lineCursor;
    const ruleLeadingBottom = roundTexPt(lastLineTop + baselineAscent + texLineDescent(lastLine));
    const width = Math.max(0, ...matchingLines.map((line) => line.targetWidth));
    measurements.set(blockIndex, {
      blockIndex,
      lineIndices: matchingLines.map((line) => line.lineIndex),
      lineOffsets,
      standardMetrics: paragraphBoxMetrics(width, baselineY, standardBottom),
      ruleLeadingMetrics: paragraphBoxMetrics(width, baselineY, ruleLeadingBottom),
      standardAdvance: standardBottom,
      ruleLeadingAdvance: ruleLeadingBottom,
    });
  }
  return Array.from(measurements.values());
}

function paragraphBoxMetrics(
  width: number,
  baselineY: number,
  bottom: number
): TexBoxMetrics {
  return {
    width,
    height: roundTexPt(Math.max(0, baselineY)),
    depth: roundTexPt(Math.max(0, bottom - baselineY)),
  };
}

function paragraphLineAssignmentMap(
  assignments: readonly TexVListParagraphLineAssignment[],
  lines: readonly LineReport[]
): ReadonlyMap<number, readonly LineReport[]> {
  const assigned = new Map<number, LineReport[]>();
  const lineByIndex = new Map(lines.map((line) => [line.lineIndex, line]));
  for (const assignment of assignments) {
    const blockLines: LineReport[] = [];
    for (const lineIndex of assignment.lineIndices) {
      const line = lineByIndex.get(lineIndex);
      if (!line) {
        throw new Error(`TeX vlist paragraph assignment references missing line ${lineIndex}.`);
      }
      blockLines.push(line);
    }
    assigned.set(assignment.blockIndex, blockLines);
  }
  return assigned;
}

function shouldUseActualParagraphBottomBeforeNextItem(
  items: readonly TexVListItem[],
  index: number
): boolean {
  return isRuleLeadingVerticalSequence(items.slice(index + 1));
}

function isRuleLeadingVerticalSequence(items: readonly TexVListItem[]): boolean {
  for (const item of items) {
    if (item.kind === "rule") {
      return true;
    }
    if (item.kind === "glue" || item.kind === "penalty") {
      continue;
    }
    if (item.kind === "vbox") {
      return isRuleLeadingVerticalSequence(item.items);
    }
    return false;
  }
  return false;
}

function texLineAscent(line: LineReport | undefined): number {
  return roundTexPt(Math.max(0, line?.ascent ?? 0));
}

function texLineDescent(line: LineReport | undefined): number {
  return roundTexPt(Math.max(0, line?.descent ?? 0));
}

function texLineLeadingPt(lineLeading: string | undefined): number {
  if (!lineLeading) {
    return 0;
  }
  return parseLength(lineLeading, "pt") ?? 0;
}
