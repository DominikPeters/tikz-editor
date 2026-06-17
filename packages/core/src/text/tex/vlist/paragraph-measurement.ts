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
  TexVListParagraphBoxMeasurement,
  TexVListParagraphHorizontalLayout,
  TexVListParagraphLineAssignment,
} from "./types.js";
import { texVListParagraphEntries } from "./traversal.js";

const latexNormalLineSkipPt = 1;

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
  const paragraphsByBlockIndex = texVListParagraphBlockIndexMap(document);
  const measuredKeys = new Set<string>();
  const measuredBlockIndices = new Set<number>();
  for (const measurement of measurements) {
    const key = texVListPathKey(measurement.vlistPath);
    if (measuredKeys.has(key)) {
      throw new Error(
        `TeX vlist paragraph measurements contain duplicate path ${key}.`
      );
    }
    const pathParagraph = paragraphs.get(key);
    const paragraph = pathParagraph?.blockIndex === measurement.blockIndex
      ? pathParagraph
      : paragraphsByBlockIndex.get(measurement.blockIndex);
    if (!paragraph && pathParagraph) {
      throw new Error(
        `TeX vlist paragraph measurement path ${key} block identity mismatch: item ${pathParagraph.blockIndex}, measurement ${measurement.blockIndex}.`
      );
    }
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
    measuredBlockIndices.add(measurement.blockIndex);
  }

  for (const [key, paragraph] of paragraphs.entries()) {
    if (!measuredKeys.has(key) && !measuredBlockIndices.has(paragraph.blockIndex)) {
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
  const lastLine = lines.at(-1);
  const ruleLeadingBottom = lastLine
    ? roundTexPt(lastLine.y + lastLine.metrics.height + lastLine.metrics.depth)
    : 0;
  return {
    blockIndex: paragraph.blockIndex,
    vlistPath: paragraph.vlistPath,
    lineIndices,
    lineOffsets: lines.map((line) => ({
      lineIndex: line.lineIndex,
      y: line.y,
      metrics: line.metrics,
    })),
    lastLinePreDisplaySize: lastLine?.preDisplaySize,
    ...(lastLine ? { lastLineMetrics: lastLine.metrics } : {}),
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
  const paragraphMeasurementsByBlockIndex = texVListParagraphMeasurementBlockIndexMap(
    paragraphMeasurements
  );
  return (item, cursor, index, items, path) => {
    if (item.kind !== "paragraph") {
      return null;
    }
    const key = texVListPathKey(path);
    const pathMeasurement = paragraphMeasurements.get(key);
    const measurement = pathMeasurement?.blockIndex === item.paragraph.blockIndex
      ? pathMeasurement
      : paragraphMeasurementsByBlockIndex.get(item.paragraph.blockIndex);
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
    return {
      y: cursor,
      advance: measurement.ruleLeadingAdvance,
      metrics: measurement.ruleLeadingMetrics,
    };
  };
}

function texVListParagraphMeasurementBlockIndexMap(
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>
): ReadonlyMap<number, TexVListParagraphBoxMeasurement> {
  const byBlockIndex = new Map<number, TexVListParagraphBoxMeasurement>();
  for (const measurement of paragraphMeasurements.values()) {
    if (!byBlockIndex.has(measurement.blockIndex)) {
      byBlockIndex.set(measurement.blockIndex, measurement);
    }
  }
  return byBlockIndex;
}

function texHorizontalLayoutForParagraphAssignment(
  assignment: TexVListParagraphLineAssignment,
  lineBoxByIndex: ReadonlyMap<number, TexLineBox>,
  lineHeight: number
): TexHorizontalLayout {
  const lines: TexLineBox[] = [];
  let previousLine: TexLineBox | undefined;
  for (const lineIndex of assignment.lineIndices) {
    const line = lineBoxByIndex.get(lineIndex);
    if (!line) {
      throw new Error(`TeX horizontal paragraph block ${assignment.blockIndex} references missing line ${lineIndex}.`);
    }
    const y = previousLine
      ? roundTexPt(
          previousLine.y +
          previousLine.metrics.height +
          previousLine.metrics.depth +
          texParagraphInterlineGlueSize(
            previousLine.metrics.depth,
            line.metrics.height,
            lineHeight
          ) +
          texLineLeadingPt(previousLine.lineLeading)
        )
      : 0;
    const placedLine = {
      ...line,
      y,
    };
    lines.push(placedLine);
    previousLine = placedLine;
  }
  return {
    metrics: texHorizontalParagraphMetricsFromLineBoxes(lines),
    lines,
    renderItems: [],
  };
}

function texHorizontalParagraphMetricsFromLineBoxes(
  lines: readonly TexLineBox[]
): TexHorizontalLayout["metrics"] {
  const firstLine = lines[0];
  const baselineY = firstLine?.metrics.height ?? 0;
  const lastLine = lines.at(-1);
  const bottom = lastLine
    ? roundTexPt(lastLine.y + lastLine.metrics.height + lastLine.metrics.depth)
    : 0;
  return paragraphBoxMetrics(
    Math.max(0, ...lines.map((line) => line.targetWidth)),
    baselineY,
    bottom
  );
}

function texParagraphInterlineGlueSize(
  previousDepth: number,
  nextHeight: number,
  lineHeight: number
): number {
  const baselineGlue = roundTexPt(lineHeight - previousDepth - nextHeight);
  return baselineGlue < 0 ? latexNormalLineSkipPt : baselineGlue;
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

function texVListParagraphBlockIndexMap(
  document: TexVListDocument
): ReadonlyMap<number, TexParagraphItem> {
  const paragraphs = new Map<number, TexParagraphItem>();
  for (const entry of texVListParagraphEntries(document.items)) {
    paragraphs.set(entry.item.blockIndex, entry.item);
  }
  return paragraphs;
}

function texLineLeadingPt(lineLeading: string | undefined): number {
  if (!lineLeading) {
    return 0;
  }
  return parseLength(lineLeading, "pt") ?? 0;
}
