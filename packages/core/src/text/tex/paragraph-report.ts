import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type {
  LineReport,
  ParagraphLayoutReport,
} from "../knuth-plass/paragraph/report.js";
import type {
  GreedyLine,
  ParagraphRun,
} from "../knuth-plass/paragraph/types.js";
import { roundTexPt } from "./fonts/units.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
} from "./fonts/types.js";
import type { TexParagraphAlignment } from "./ir.js";
import type { TexLayoutLabelItem } from "./layout-inline-items.js";
import {
  texLayoutGlyphItemDepth,
  texLayoutGlyphItemHeight,
  texLayoutGlyphItemWidth,
  texLayoutMathItemWidth,
} from "./vlist/list-attachments.js";
import type { TexLineLabel } from "./vlist/index.js";
import { texInterwordGlueForSpaceFactor } from "./space-glue.js";
import type { TexLineBox } from "./vlist/index.js";

export interface TexParagraphReportBuildResult {
  readonly report: ParagraphLayoutReport;
  readonly lineBoxes: readonly TexLineBox[];
}

export function buildTexParagraphReport(params: {
  paragraphId: string;
  width: number;
  alignment: TexParagraphAlignment;
  runs: readonly ParagraphRun[];
  lines: readonly GreedyLine[];
  shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  runWidths: ReadonlyMap<number, number>;
  lineLabels: ReadonlyMap<number, TexLineLabel>;
  linebreakingMode: "feasible" | "overfull";
  layoutMode: KnuthPlassLayoutMode;
  font: ResolvedTexFont;
  metricProvider: TexMetricProvider;
  errors: readonly string[];
}): TexParagraphReportBuildResult {
  const runReports = params.runs.map((run) => ({
    runIndex: run.runIndex,
    kind: run.kind,
    sourceStart: run.sourceStart,
    sourceEnd: run.sourceEnd,
    width: params.runWidths.get(run.runIndex) ?? 0,
    text: run.kind === "text" || run.kind === "space" ? run.text : undefined,
  }));
  const builtLines = params.lines.map((line) => buildTexLineReport(line, params));
  return {
    report: {
      paragraphId: params.paragraphId,
      width: params.width,
      alignment: params.alignment,
      layoutMode: params.layoutMode,
      lines: builtLines.map((line) => line.report),
      runs: runReports,
      errors: [...params.errors],
      internalMode: "canonical",
      internalDegradeReason: null,
      externalFallbackUsed: false,
      linebreakingMode: params.linebreakingMode,
    },
    lineBoxes: builtLines.map((line) => line.lineBox),
  };
}

function buildTexLineReport(
  line: GreedyLine,
  params: {
    width: number;
    runs: readonly ParagraphRun[];
    shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
    metricProvider: TexMetricProvider;
    runWidths: ReadonlyMap<number, number>;
    lineLabels: ReadonlyMap<number, TexLineLabel>;
    font: ResolvedTexFont;
  }
): { readonly report: LineReport; readonly lineBox: TexLineBox } {
  const segments: LineReport["segments"] = [];
  let x = line.xOffset ?? 0;
  let ascent = 0;
  let descent = 0;
  const label = params.lineLabels.get(line.lineIndex);
  if (label) {
    const labelReport = buildTexLineLabelSegments(label, params.metricProvider);
    segments.push(...labelReport.segments);
    ascent = Math.max(ascent, labelReport.ascent);
    descent = Math.max(descent, labelReport.descent);
  }
  if (line.startPendingText) {
    const runFont = params.shapedRuns.get(line.startRun)?.font ?? params.font;
    const shaped = params.metricProvider.shapeText(line.startPendingText, runFont);
    const metrics = texShapedRunMetrics(shaped);
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
    segments.push({
      runIndex: line.startRun,
      kind: "text",
      role: params.runs[line.startRun]?.role,
      text: line.startPendingText,
      startOffset: 0,
      endOffset: line.startPendingText.length,
      sourceStartRaw: line.startPendingSourceStart,
      sourceEndRaw: line.startPendingSourceEnd,
      sourceKind: "text",
      fontId: runFont.id,
      x,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => roundTexPt(x + stop)),
    });
    x = roundTexPt(x + shaped.width);
  }
  for (let runIndex = line.startRun; runIndex <= line.endRun; runIndex++) {
    const run = params.runs[runIndex];
    if (!run) {
      continue;
    }
    if (run.kind === "text") {
      const startOffset = runIndex === line.startRun ? line.startTextOffset : 0;
      const breakDiscretionary =
        line.break?.kind === "hyphen" && line.break.runIndex === runIndex
          ? line.break.discretionary
          : undefined;
      const endOffset = runIndex === line.endRun && line.endTextOffset !== null
        ? breakDiscretionary?.replaceStart ?? line.endTextOffset
        : run.text.length;
      if (endOffset <= startOffset) {
        continue;
      }
      const shaped = params.shapedRuns.get(run.runIndex);
      if (!shaped) {
        throw new Error(`Missing shaped TeX run for report run ${run.runIndex}.`);
      }
      const startX = shaped.caretStops[startOffset];
      const endX = shaped.caretStops[endOffset];
      if (startX === undefined || endX === undefined) {
        throw new Error(
          `Missing TeX caret stop while building report segment ${run.runIndex}:${startOffset}-${endOffset}.`
        );
      }
      const width = roundTexPt(endX - startX);
      const caretStops = shaped.caretStops.slice(startOffset, endOffset + 1)
        .map((stop) => roundTexPt(x + stop - startX));
      const metrics = texShapedSliceMetrics(shaped, startOffset, endOffset);
      ascent = Math.max(ascent, metrics.ascent);
      descent = Math.max(descent, metrics.descent);
      segments.push({
        runIndex: run.runIndex,
        kind: "text",
        role: run.role,
        text: run.text.slice(startOffset, endOffset),
        startOffset,
        endOffset,
        sourceStartRaw: run.sourceStart + startOffset,
        sourceEndRaw: run.sourceStart + endOffset,
        sourceKind: "text",
        fontId: shaped.font.id,
        x,
        width,
        caretStops,
      });
      x = roundTexPt(x + width);
      continue;
    }

    if (run.kind === "math") {
      const width = params.runWidths.get(run.runIndex) ?? 0;
      const box = texMathBoxFromWrapper(run.wrapper);
      ascent = Math.max(ascent, box?.height ?? 0);
      descent = Math.max(descent, box?.depth ?? 0);
      segments.push({
        runIndex: run.runIndex,
        kind: "math",
        role: run.role,
        text: box?.content ?? "",
        sourceStartRaw: run.sourceStart,
        sourceEndRaw: run.sourceEnd,
        sourceKind: "math",
        x,
        width,
        caretStops: [x, roundTexPt(x + width)],
        mathSvgBody: box?.svgBody,
      });
      x = roundTexPt(x + width);
      continue;
    }

    let width = params.runWidths.get(run.runIndex) ?? 0;
    if (run.kind === "space" && (line.spaceCount ?? 0) > 0) {
      const ratio = line.glueSetRatio ?? 0;
      const stretch = run.texGlue?.stretch;
      const shrink = run.texGlue?.shrink;
      if (ratio > 0 && typeof stretch === "number" && Number.isFinite(stretch)) {
        width = Math.max(0, width + ratio * stretch);
      } else if (ratio < 0 && typeof shrink === "number" && Number.isFinite(shrink)) {
        width = Math.max(0, width + ratio * shrink);
      }
    }
    segments.push({
      runIndex: run.runIndex,
      kind: "space",
      role: run.role,
      text: " ",
      sourceStartRaw: run.sourceStart,
      sourceEndRaw: run.sourceEnd,
      sourceKind: "text",
      x,
      width,
      caretStops: [x, roundTexPt(x + width)],
    });
    x = roundTexPt(x + width);
  }

  if (line.break?.kind === "hyphen" && line.break.discretionary) {
    const discretionary = line.break.discretionary;
    const splitOffset = line.break.splitOffset ?? discretionary.replaceStart;
    const sourceStartRaw = line.break.sourceOffset -
      Math.max(0, splitOffset - discretionary.replaceStart);
    const runFont = params.shapedRuns.get(line.break.runIndex)?.font ?? params.font;
    const shaped = params.metricProvider.shapeText(
      discretionary.preBreakText,
      runFont
    );
    const metrics = texShapedRunMetrics(shaped);
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
    segments.push({
      runIndex: line.break.runIndex,
      kind: "text",
      role: params.runs[line.break.runIndex]?.role,
      text: discretionary.preBreakText,
      startOffset: discretionary.replaceStart,
      endOffset: splitOffset,
      sourceStartRaw,
      sourceEndRaw: line.break.sourceOffset,
      sourceKind: "text",
      fontId: runFont.id,
      x,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => roundTexPt(x + stop)),
    });
    x = roundTexPt(x + shaped.width);
  } else if (line.break?.kind === "hyphen" && line.break.visibleHyphen) {
    const runFont = params.shapedRuns.get(line.break.runIndex)?.font ?? params.font;
    const width = params.metricProvider.shapeText("-", runFont).width;
    const metrics = texShapedRunMetrics(params.metricProvider.shapeText("-", runFont));
    ascent = Math.max(ascent, metrics.ascent);
    descent = Math.max(descent, metrics.descent);
    const insertedWidth = line.break.width ?? width;
    const hyphenX = roundTexPt(x + insertedWidth - width);
    segments.push({
      runIndex: line.break.runIndex,
      kind: "text",
      role: params.runs[line.break.runIndex]?.role,
      text: "-",
      startOffset: line.break.splitOffset ?? 0,
      endOffset: line.break.splitOffset ?? 0,
      sourceStartRaw: line.break.sourceOffset,
      sourceEndRaw: line.break.sourceOffset,
      sourceKind: "text",
      fontId: runFont.id,
      x: hyphenX,
      width,
      caretStops: [hyphenX, roundTexPt(hyphenX + width)],
    });
    x = roundTexPt(x + insertedWidth);
  }

  const xStart = line.xOffset ?? 0;
  const report: LineReport = {
    lineIndex: line.lineIndex,
    startRun: line.startRun,
    endRun: line.endRun,
    width: line.lineNaturalWidth ?? line.width,
    targetWidth: line.targetWidth ?? params.width,
    naturalWidth: line.lineNaturalWidth ?? line.width,
    glueSetRatio: line.glueSetRatio ?? 0,
    badness: line.badness ?? 0,
    spaceCount: line.spaceCount ?? 0,
    spaceDeltaPerGap: line.spaceDeltaPerGap ?? 0,
    ascent: roundTexPt(ascent),
    descent: roundTexPt(descent),
    xStart,
    xEnd: x,
    break: line.break,
    segments,
  };
  return {
    report,
    lineBox: {
      lineIndex: report.lineIndex,
      y: 0,
      targetWidth: report.targetWidth,
      metrics: {
        width: report.targetWidth,
        height: report.ascent,
        depth: report.descent,
      },
      lineLeading: report.break?.lineLeading,
    },
  };
}

function texMathBoxFromWrapper(
  wrapper: ParagraphRun["wrapper"]
): {
  readonly content: string;
  readonly height: number;
  readonly depth: number;
  readonly svgBody?: string;
} | null {
  if (!wrapper || typeof wrapper !== "object") {
    return null;
  }
  const box = wrapper.texMathBox;
  if (!box || typeof box !== "object") {
    return null;
  }
  const typedBox = box as {
    readonly content?: unknown;
    readonly height?: unknown;
    readonly depth?: unknown;
    readonly svgBody?: unknown;
  };
  return {
    content: typeof typedBox.content === "string" ? typedBox.content : "",
    height: Number(typedBox.height) || 0,
    depth: Number(typedBox.depth) || 0,
    svgBody: typeof typedBox.svgBody === "string" ? typedBox.svgBody : undefined,
  };
}

function buildTexLineLabelSegments(
  label: TexLineLabel,
  metricProvider: TexMetricProvider
): {
  readonly segments: LineReport["segments"];
  readonly ascent: number;
  readonly descent: number;
} {
  const segments: LineReport["segments"] = [];
  const width = texLayoutItemsNaturalWidth(label.label.items, metricProvider);
  let x = roundTexPt(label.label.rightEdge - width);
  let ascent = 0;
  let descent = 0;
  for (const item of label.label.items) {
    if (item.kind === "glyph") {
      const glyphWidth = texLayoutGlyphItemWidth(item);
      ascent = Math.max(ascent, texLayoutGlyphItemHeight(item));
      descent = Math.max(descent, texLayoutGlyphItemDepth(item));
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "text",
        role: "list-label",
        text: item.text,
        startOffset: 0,
        endOffset: item.text.length,
        fontId: item.font.id,
        glyphCode: item.code,
        x,
        width: glyphWidth,
        caretStops: [x, roundTexPt(x + glyphWidth)],
      });
      x = roundTexPt(x + glyphWidth);
      continue;
    }
    if (item.kind === "forced-break") {
      continue;
    }
    if (item.kind === "text") {
      const shaped = metricProvider.shapeText(item.text, item.font);
      const metrics = texShapedRunMetrics(shaped);
      ascent = Math.max(ascent, metrics.ascent);
      descent = Math.max(descent, metrics.descent);
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "text",
        role: "list-label",
        text: item.text,
        startOffset: 0,
        endOffset: item.text.length,
        fontId: item.font.id,
        x,
        width: shaped.width,
        caretStops: shaped.caretStops.map((stop) => roundTexPt(x + stop)),
      });
      x = roundTexPt(x + shaped.width);
      continue;
    }
    if (item.kind === "math") {
      const mathWidth = texLayoutMathItemWidth(item);
      ascent = Math.max(ascent, item.box.height);
      descent = Math.max(descent, item.box.depth);
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "math",
        role: "list-label",
        text: item.content,
        sourceStartRaw: item.sourceStart,
        sourceEndRaw: item.sourceEnd,
        sourceKind: "math",
        x,
        width: mathWidth,
        caretStops: [x, roundTexPt(x + mathWidth)],
        mathSvgBody: item.box.svgBody,
      });
      x = roundTexPt(x + mathWidth);
      continue;
    }

    const glue = texInterwordGlueForSpaceFactor(
      item.font,
      item.spaceFactor,
      item.spaceGlueProfile
    );
    segments.push({
      runIndex: label.lineRunIndex,
      kind: "space",
      role: "list-label",
      text: " ",
      x,
      width: glue.width,
      caretStops: [x, roundTexPt(x + glue.width)],
    });
    x = roundTexPt(x + glue.width);
  }
  return { segments, ascent, descent };
}

function texShapedSliceMetrics(
  shaped: ShapedTexTextRun,
  startOffset: number,
  endOffset: number
): { readonly ascent: number; readonly descent: number } {
  let ascent = 0;
  let descent = 0;
  for (const item of shaped.items) {
    if (
      item.kind !== "glyph" ||
      item.sourceEnd <= startOffset + shaped.sourceStart ||
      item.sourceStart >= endOffset + shaped.sourceStart
    ) {
      continue;
    }
    ascent = Math.max(ascent, item.height);
    descent = Math.max(descent, item.depth);
  }
  return { ascent, descent };
}

function texShapedRunMetrics(
  shaped: ShapedTexTextRun
): { readonly ascent: number; readonly descent: number } {
  let ascent = 0;
  let descent = 0;
  for (const item of shaped.items) {
    if (item.kind !== "glyph") {
      continue;
    }
    ascent = Math.max(ascent, item.height);
    descent = Math.max(descent, item.depth);
  }
  return { ascent, descent };
}

function texLayoutItemsNaturalWidth(
  items: readonly TexLayoutLabelItem[],
  metricProvider: TexMetricProvider
): number {
  let width = 0;
  for (const item of items) {
    if (item.kind === "glyph") {
      width += texLayoutGlyphItemWidth(item);
      continue;
    }
    if (item.kind === "forced-break") {
      continue;
    }
    if (item.kind === "text") {
      width += metricProvider.shapeText(item.text, item.font).width;
      continue;
    }
    if (item.kind === "math") {
      width += texLayoutMathItemWidth(item);
      continue;
    }
    width += texInterwordGlueForSpaceFactor(
      item.font,
      item.spaceFactor,
      item.spaceGlueProfile
    ).width;
  }
  return roundTexPt(width);
}
