import { parseLength } from "../../../semantic/coords/parse-length.js";
import type { ParagraphLayoutReport } from "../../knuth-plass/paragraph/report.js";
import { roundTexPt } from "../fonts/units.js";
import type { TexVListItemMeasurer } from "./layout.js";
import { texVListPathKey } from "./paths.js";
import type {
  TexBoxMetrics,
  TexHorizontalLayout,
  TexLineBox,
  TexParagraphItem,
  TexVListDocument,
  TexVListItem,
  TexVListParagraphBoxMeasurement,
  TexVListParagraphHorizontalLayout,
  TexVListParagraphLineAssignment,
} from "./types.js";
import { texVListParagraphEntries } from "./traversal.js";

export interface TexVListParagraphHorizontalLayouts {
  readonly report: ParagraphLayoutReport;
  readonly paragraphLayouts: readonly TexVListParagraphHorizontalLayout[];
}

export function createTexVListParagraphHorizontalLayoutsFromLineBoxes(params: {
  readonly report: ParagraphLayoutReport;
  readonly lineBoxes: readonly TexLineBox[];
  readonly paragraphLineAssignments: readonly TexVListParagraphLineAssignment[];
  readonly lineHeight: number;
}): TexVListParagraphHorizontalLayouts {
  const lineBoxByIndex = new Map(params.lineBoxes.map((line) => [line.lineIndex, line]));
  return {
    report: params.report,
    paragraphLayouts: params.paragraphLineAssignments.map((assignment) => ({
      blockIndex: assignment.blockIndex,
      vlistPath: assignment.vlistPath,
      lineIndices: assignment.lineIndices,
      horizontal: texHorizontalLayoutForParagraphAssignment(
        assignment,
        lineBoxByIndex,
        params.lineHeight
      ),
    })),
  };
}

export function validateTexVListParagraphMeasurements(
  document: TexVListDocument,
  measurements: readonly TexVListParagraphBoxMeasurement[]
): void {
  const paragraphs = texVListParagraphIdentityMap(document);
  const measuredKeys = new Set<string>();
  for (const measurement of measurements) {
    const key = texVListPathKey(measurement.vlistPath);
    if (measuredKeys.has(key)) {
      throw new Error(
        `TeX vlist paragraph measurements contain duplicate path ${key}.`
      );
    }
    const paragraph = paragraphs.get(key);
    if (!paragraph) {
      throw new Error(
        `TeX vlist paragraph measurement references missing paragraph path ${key}.`
      );
    }
    if (paragraph.blockIndex !== measurement.blockIndex) {
      throw new Error(
        `TeX vlist paragraph measurement path ${key} block identity mismatch: item ${paragraph.blockIndex}, measurement ${measurement.blockIndex}.`
      );
    }
    measuredKeys.add(key);
  }

  for (const key of paragraphs.keys()) {
    if (!measuredKeys.has(key)) {
      throw new Error(
        `TeX vlist paragraph measurements are missing paragraph path ${key}.`
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
    vlistPath: paragraph.vlistPath,
    lineIndices,
    lineOffsets: lines.map((line) => ({
      lineIndex: line.lineIndex,
      y: line.y,
    })),
    lastLinePreDisplaySize: lastLine?.preDisplaySize,
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
): ReadonlyMap<string, TexVListParagraphBoxMeasurement> {
  const byPath = new Map<string, TexVListParagraphBoxMeasurement>();
  for (const measurement of measurements) {
    const key = texVListPathKey(measurement.vlistPath);
    if (byPath.has(key)) {
      throw new Error(
        `TeX vlist layout received duplicate paragraph measurement for path ${key}.`
      );
    }
    byPath.set(key, measurement);
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
  return byPath;
}

export function createMeasuredParagraphVListMeasurer(
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>
): TexVListItemMeasurer {
  return (item, cursor, index, items, path) => {
    if (item.kind !== "paragraph") {
      return null;
    }
    const key = texVListPathKey(path);
    const measurement = paragraphMeasurements.get(key);
    if (!measurement) {
      throw new Error(
        `TeX vlist layout is missing paragraph measurement for path ${key}.`
      );
    }
    if (measurement.blockIndex !== item.paragraph.blockIndex) {
      throw new Error(
        `TeX vlist paragraph measurement path ${key} block identity mismatch: item ${item.paragraph.blockIndex}, measurement ${measurement.blockIndex}.`
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

function texVListParagraphIdentityMap(
  document: TexVListDocument
): ReadonlyMap<string, TexParagraphItem> {
  const paragraphs = new Map<string, TexParagraphItem>();
  for (const entry of texVListParagraphEntries(document.items)) {
    paragraphs.set(texVListPathKey(entry.path), entry.item);
  }
  return paragraphs;
}

function texLineLeadingPt(lineLeading: string | undefined): number {
  if (!lineLeading) {
    return 0;
  }
  return parseLength(lineLeading, "pt") ?? 0;
}
