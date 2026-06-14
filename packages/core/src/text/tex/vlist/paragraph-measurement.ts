import { parseLength } from "../../../semantic/coords/parse-length.js";
import type {
  LineReport,
  ParagraphLayoutReport,
} from "../../knuth-plass/paragraph/report.js";
import { roundTexPt } from "../fonts/units.js";
import type { TexVListItemMeasurer } from "./layout.js";
import type {
  TexBoxMetrics,
  TexHorizontalLayout,
  TexLineBox,
  TexVListDocument,
  TexVListItem,
  TexVListParagraphBoxMeasurement,
  TexVListParagraphHorizontalLayout,
  TexVListParagraphLineAssignment,
} from "./types.js";
import { texVListParagraphItems } from "./traversal.js";

export interface TexVListHorizontalParagraphReportLayout {
  readonly report: ParagraphLayoutReport;
  readonly paragraphLayouts: readonly TexVListParagraphHorizontalLayout[];
}

export function appendTexVListParagraphLineAssignment(
  assignments: TexVListParagraphLineAssignment[],
  blockIndex: number,
  lineIndices: readonly number[]
): void {
  const existingIndex = assignments.findIndex(
    (assignment) => assignment.blockIndex === blockIndex
  );
  if (existingIndex < 0) {
    assignments.push({
      blockIndex,
      lineIndices: [...lineIndices],
    });
    return;
  }
  const existing = assignments[existingIndex];
  if (!existing) {
    throw new Error(`Missing TeX vlist paragraph line assignment for block ${blockIndex}.`);
  }
  assignments[existingIndex] = {
    blockIndex,
    lineIndices: [...existing.lineIndices, ...lineIndices],
  };
}

export function createTexVListHorizontalParagraphReportLayout(params: {
  readonly report: ParagraphLayoutReport;
  readonly lineBoxes: readonly TexLineBox[];
  readonly paragraphLineAssignments: readonly TexVListParagraphLineAssignment[];
  readonly lineHeight: number;
}): TexVListHorizontalParagraphReportLayout {
  const lineBoxByIndex = new Map(params.lineBoxes.map((line) => [line.lineIndex, line]));
  return {
    report: params.report,
    paragraphLayouts: params.paragraphLineAssignments.map((assignment) => ({
      blockIndex: assignment.blockIndex,
      lineIndices: assignment.lineIndices,
      horizontal: texHorizontalLayoutForParagraphAssignment(
        assignment,
        lineBoxByIndex,
        params.lineHeight
      ),
    })),
  };
}

export function validateTexVListParagraphLineAssignments(
  document: TexVListDocument,
  assignments: readonly TexVListParagraphLineAssignment[]
): void {
  const paragraphBlocks = texVListParagraphBlockSet(document);

  const assignedBlocks = new Set<number>();
  for (const assignment of assignments) {
    if (assignedBlocks.has(assignment.blockIndex)) {
      throw new Error(
        `TeX vlist paragraph assignments contain duplicate block ${assignment.blockIndex}.`
      );
    }
    if (!paragraphBlocks.has(assignment.blockIndex)) {
      throw new Error(
        `TeX vlist paragraph assignment references missing paragraph block ${assignment.blockIndex}.`
      );
    }
    assignedBlocks.add(assignment.blockIndex);
  }

  for (const blockIndex of paragraphBlocks) {
    if (!assignedBlocks.has(blockIndex)) {
      throw new Error(
        `TeX vlist paragraph assignments are missing paragraph block ${blockIndex}.`
      );
    }
  }
}

export function validateTexVListParagraphMeasurements(
  document: TexVListDocument,
  measurements: readonly TexVListParagraphBoxMeasurement[]
): void {
  const paragraphBlocks = texVListParagraphBlockSet(document);
  const measuredBlocks = new Set<number>();
  for (const measurement of measurements) {
    if (measuredBlocks.has(measurement.blockIndex)) {
      throw new Error(
        `TeX vlist paragraph measurements contain duplicate block ${measurement.blockIndex}.`
      );
    }
    if (!paragraphBlocks.has(measurement.blockIndex)) {
      throw new Error(
        `TeX vlist paragraph measurement references missing paragraph block ${measurement.blockIndex}.`
      );
    }
    measuredBlocks.add(measurement.blockIndex);
  }

  for (const blockIndex of paragraphBlocks) {
    if (!measuredBlocks.has(blockIndex)) {
      throw new Error(
        `TeX vlist paragraph measurements are missing paragraph block ${blockIndex}.`
      );
    }
  }
}

export function texVListParagraphMeasurementFromHorizontalLayout(
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

export function texVListParagraphMeasurementMap(
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

export function createMeasuredParagraphVListMeasurer(
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

function texHorizontalLayoutForParagraphAssignment(
  assignment: TexVListParagraphLineAssignment,
  lineBoxByIndex: ReadonlyMap<number, TexLineBox>,
  lineHeight: number
): TexHorizontalLayout {
  let lineCursor = 0;
  const lines: TexLineBox[] = [];
  for (const lineIndex of assignment.lineIndices) {
    const line = lineBoxByIndex.get(lineIndex);
    if (!line) {
      throw new Error(`TeX horizontal paragraph block ${assignment.blockIndex} references missing line ${lineIndex}.`);
    }
    lines.push({
      ...line,
      y: roundTexPt(lineCursor),
    });
    lineCursor = roundTexPt(
      lineCursor + lineHeight + texLineLeadingPt(line.lineLeading)
    );
  }
  return {
    metrics: texHorizontalParagraphMetricsFromLineBoxes(lines, lineCursor),
    lines,
    renderItems: [],
  };
}

function texHorizontalParagraphMetricsFromLineBoxes(
  lines: readonly TexLineBox[],
  bottom: number
): TexHorizontalLayout["metrics"] {
  const firstLine = lines[0];
  const baselineY = firstLine?.metrics.height ?? 0;
  return paragraphBoxMetrics(
    Math.max(0, ...lines.map((line) => line.targetWidth)),
    baselineY,
    bottom
  );
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

function sameLineIndices(
  left: readonly number[],
  right: readonly number[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function texVListParagraphBlockSet(document: TexVListDocument): ReadonlySet<number> {
  const paragraphBlocks = new Set<number>();
  for (const paragraph of texVListParagraphItems(document.items)) {
    const blockIndex = paragraph.paragraph.blockIndex;
    if (paragraphBlocks.has(blockIndex)) {
      throw new Error(
        `TeX vlist document contains duplicate paragraph block ${blockIndex}.`
      );
    }
    paragraphBlocks.add(blockIndex);
  }
  return paragraphBlocks;
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
