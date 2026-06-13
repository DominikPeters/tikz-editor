import { parseLength } from "../../../semantic/coords/parse-length.js";
import { roundTexPt } from "../fonts/units.js";
import type {
  LineReport,
  ParagraphLayoutReport,
} from "../../knuth-plass/paragraph/report.js";
import type {
  TexParagraphItem,
  TexSourceSpan,
  TexVListDocument,
  TexVListItem,
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
  type TexVListItemMeasurer,
} from "./layout.js";

export interface TexVListParagraphReportLayoutOptions extends TexVListLayoutOptions {
  readonly lineHeight: number;
  readonly firstLineAscent?: number;
}

export function layoutTexVListFromParagraphReport(
  document: TexVListDocument,
  report: ParagraphLayoutReport,
  options: TexVListParagraphReportLayoutOptions
): TexVListLayout {
  const naturalTotalHeight = computeTexVListNaturalTotalHeight(
    document.items,
    createParagraphReportVListMeasurer(report, options.lineHeight)
  );
  const glueSet = texVListGlueSetForTargetHeight(
    document.items,
    naturalTotalHeight,
    options.height
  );
  const lineTops: number[] = [];
  const measurer = createParagraphReportVListMeasurer(
    report,
    options.lineHeight,
    lineTops
  );
  const reports = report.lines.length > 0 ? [report] : [];
  const laidOut = layoutTexVListItems(
    document.items,
    measurer,
    glueSet,
    0
  );

  const firstLine = report.lines[0];
  const firstLineTop = firstLine ? lineTops[firstLine.lineIndex] ?? 0 : null;
  const baselineY = texVListBaselineY(
    firstLineTop,
    options.firstLineAscent ?? texLineAscent(firstLine)
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
  const shiftedBaselineY = baselineY === null ? null : roundTexPt(baselineY + rootOffset);
  const shiftedLineTops = rootOffset === 0
    ? lineTops
    : lineTops.map((top) => roundTexPt(top + rootOffset));
  const metrics = metricsForRootBox(options.width, totalHeight, shiftedBaselineY);
  return {
    metrics,
    baseline: shiftedBaselineY === null ? { kind: "none" } : { kind: "explicit", y: shiftedBaselineY },
    items: offsetPositionedTexVListItems(laidOut.positioned, rootOffset),
    lineTops: shiftedLineTops,
    reports,
    errors: [...report.errors],
  };
}

export function computeTexVListLineTops(
  document: TexVListDocument,
  report: ParagraphLayoutReport,
  lineHeight: number
): readonly number[] {
  const lineTops: number[] = [];
  layoutTexVListItems(
    document.items,
    createParagraphReportVListMeasurer(report, lineHeight, lineTops),
    null,
    0
  );
  return lineTops;
}

function createParagraphReportVListMeasurer(
  report: ParagraphLayoutReport,
  lineHeight: number,
  lineTops?: number[]
): TexVListItemMeasurer {
  return (item, cursor, index, items) => {
    if (item.kind !== "paragraph") {
      return null;
    }
    const matchingLines = linesForParagraphItem(item, report.lines);
    if (matchingLines.length === 0) {
      return null;
    }

    const top = cursor;
    let lineCursor = cursor;
    let lastLineTop = cursor;
    for (const line of matchingLines) {
      lastLineTop = lineCursor;
      if (lineTops) {
        lineTops[line.lineIndex] = roundTexPt(lineCursor);
      }
      lineCursor = roundTexPt(
        lineCursor + lineHeight + texLineLeadingPt(line.break?.lineLeading)
      );
    }

    const firstLine = matchingLines[0];
    const firstLineTop = firstLine ? lineTops?.[firstLine.lineIndex] ?? top : top;
    const baselineY = roundTexPt(firstLineTop + texLineAscent(firstLine));
    const lastLine = matchingLines.at(-1);
    const baselineAscent = texLineAscent(firstLine);
    const bottom = shouldUseActualParagraphBottomBeforeNextItem(items, index)
      ? roundTexPt(lastLineTop + baselineAscent + texLineDescent(lastLine))
      : lineCursor;
    return {
      y: top,
      advance: roundTexPt(bottom - top),
      metrics: {
        width: Math.max(0, ...matchingLines.map((line) => line.targetWidth)),
        height: roundTexPt(Math.max(0, baselineY - top)),
        depth: roundTexPt(Math.max(0, bottom - baselineY)),
      },
    };
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

function linesForParagraphItem(
  item: TexParagraphItem,
  lines: readonly LineReport[]
): readonly LineReport[] {
  return lines.filter((line) => lineOverlapsSourceSpan(line, item.paragraph.sourceSpan));
}

function lineOverlapsSourceSpan(line: LineReport, span: TexSourceSpan): boolean {
  const lineSpan = lineSourceSpan(line);
  if (!lineSpan) {
    return false;
  }
  return lineSpan.start < span.end && lineSpan.end > span.start;
}

function lineSourceSpan(line: LineReport): TexSourceSpan | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const segment of line.segments) {
    if (typeof segment.sourceStartRaw !== "number" || typeof segment.sourceEndRaw !== "number") {
      continue;
    }
    start = Math.min(start, segment.sourceStartRaw);
    end = Math.max(end, segment.sourceEndRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return { start, end };
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
