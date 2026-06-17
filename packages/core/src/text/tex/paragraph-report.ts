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
import type {
  TexLayoutLabelItem,
  TexMathBox,
} from "./layout-inline-items.js";
import {
  renderTexMathHListSvgBody,
} from "./math/render-svg.js";
import {
  setTexMathHListWidth,
  type TexMathHList,
  type TexMathHListItem,
} from "./math/layout.js";
import type { TexMathFontProfile } from "./math/font-profile.js";
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
      const continuationLineStart = isContinuationLineStartMath(line, runIndex, x);
      const coalesced = coalescedSameLineMathSegment(runIndex, line, params, x, continuationLineStart);
      if (coalesced) {
        segments.push(coalesced.segment);
        ascent = Math.max(ascent, coalesced.ascent);
        descent = Math.max(descent, coalesced.descent);
        x = roundTexPt(x + coalesced.segment.width);
        runIndex = coalesced.endRunIndex;
        continue;
      }
      const naturalWidth = params.runWidths.get(run.runIndex) ?? 0;
      const width = adjustedTexGlueWidth(naturalWidth, run.texGlue, line.glueSetRatio ?? 0);
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
        caretStops: texMathBoxCaretStops(box, x, width),
        mathConstructRanges: texMathBoxConstructRanges(box, x, width),
        mathBreakpoints: texMathBoxBreakpoints(box, x, width),
        mathSvgBody: texMathBoxSvgBody(box, width, {
          omitLineInitialOperator: continuationLineStart && box?.sourceStart === box?.contentStart,
        }),
      });
      x = roundTexPt(x + width);
      continue;
    }

    if (run.kind === "penalty") {
      continue;
    }

    const width = adjustedTexGlueWidth(
      params.runWidths.get(run.runIndex) ?? 0,
      run.kind === "space" && (line.spaceCount ?? 0) > 0 ? run.texGlue : undefined,
      line.glueSetRatio ?? 0
    );
    const isMathGlue = isTexMathGlueSpace(run.wrapper);
    segments.push({
      runIndex: run.runIndex,
      kind: "space",
      role: run.role,
      text: isMathGlue ? "" : " ",
      sourceStartRaw: run.sourceStart,
      sourceEndRaw: run.sourceEnd,
      sourceKind: isMathGlue ? "math" : "text",
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
    const isSimpleInsertedDiscretionary =
      discretionary.replaceStart === splitOffset &&
      discretionary.replaceEnd === splitOffset &&
      discretionary.replaceText.length === 0 &&
      discretionary.postBreakText.length === 0;
    const insertedWidth = line.break.width ?? discretionary.insertedWidth;
    const segmentX = isSimpleInsertedDiscretionary
      ? roundTexPt(x + insertedWidth - shaped.width)
      : x;
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
      x: segmentX,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => roundTexPt(segmentX + stop)),
    });
    x = roundTexPt(x + (isSimpleInsertedDiscretionary ? insertedWidth : shaped.width));
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
      preDisplaySize: texLinePreDisplaySize(report, params.font),
    },
  };
}

function coalescedSameLineMathSegment(
  startRunIndex: number,
  line: GreedyLine,
  params: {
    runs: readonly ParagraphRun[];
    runWidths: ReadonlyMap<number, number>;
  },
  x: number,
  omitLineInitialOperator: boolean
): {
  readonly segment: LineReport["segments"][number];
  readonly ascent: number;
  readonly descent: number;
  readonly endRunIndex: number;
} | null {
  const firstRun = params.runs[startRunIndex];
  if (firstRun?.kind !== "math") {
    return null;
  }
  const firstBox = texMathBoxFromWrapper(firstRun.wrapper);
  const rootBox = firstBox?.rootBox ?? null;
  if (rootBox === null) {
    return null;
  }
  if (firstBox?.sourceStart !== rootBox.contentStart) {
    return null;
  }

  let runIndex = startRunIndex;
  let endRunIndex = startRunIndex;
  let width = 0;
  let sourceEnd = firstBox.sourceEnd;
  while (runIndex <= line.endRun) {
    const run = params.runs[runIndex];
    if (!run) {
      break;
    }
    if (run.kind === "penalty") {
      endRunIndex = runIndex;
      runIndex += 1;
      continue;
    }
    if (run.kind === "space" && isTexMathGlueSpace(run.wrapper)) {
      width = roundTexPt(width + adjustedTexGlueWidth(
        params.runWidths.get(run.runIndex) ?? 0,
        (line.spaceCount ?? 0) > 0 ? run.texGlue : undefined,
        line.glueSetRatio ?? 0
      ));
      endRunIndex = runIndex;
      runIndex += 1;
      continue;
    }
    if (run.kind !== "math") {
      break;
    }
    const box = texMathBoxFromWrapper(run.wrapper);
    if (box?.rootBox !== rootBox) {
      break;
    }
    width = roundTexPt(width + adjustedTexGlueWidth(
      params.runWidths.get(run.runIndex) ?? 0,
      run.texGlue,
      line.glueSetRatio ?? 0
    ));
    sourceEnd = Math.max(sourceEnd, box.sourceEnd);
    endRunIndex = runIndex;
    runIndex += 1;
  }

  if (sourceEnd !== rootBox.contentEnd) {
    return null;
  }
  return {
    segment: {
      runIndex: firstRun.runIndex,
      kind: "math",
      role: firstRun.role,
      text: rootBox.content,
      sourceStartRaw: rootBox.contentStart,
      sourceEndRaw: rootBox.contentEnd,
      sourceKind: "math",
      x,
      width,
      caretStops: texMathBoxCaretStops(rootBox, x, width),
      mathConstructRanges: texMathBoxConstructRanges(rootBox, x, width),
      mathBreakpoints: texMathBoxBreakpoints(rootBox, x, width),
      mathSvgBody: texMathBoxSvgBody(rootBox, width, { omitLineInitialOperator }),
    },
    ascent: rootBox.height,
    descent: rootBox.depth,
    endRunIndex,
  };
}

function isContinuationLineStartMath(
  line: GreedyLine,
  runIndex: number,
  x: number
): boolean {
  return line.lineIndex > 0 &&
    runIndex === line.startRun &&
    Math.abs(x - (line.xOffset ?? 0)) < 1e-6;
}

function isTexMathGlueSpace(wrapper: unknown): boolean {
  return Boolean(
    wrapper &&
    typeof wrapper === "object" &&
    (wrapper as { readonly texMathGlueSpace?: unknown }).texMathGlueSpace
  );
}

function adjustedTexGlueWidth(
  naturalWidth: number,
  texGlue: { readonly stretch: number; readonly shrink: number } | undefined,
  ratio: number
): number {
  if (ratio > 0 && typeof texGlue?.stretch === "number" && Number.isFinite(texGlue.stretch)) {
    return roundTexPt(Math.max(0, naturalWidth + ratio * texGlue.stretch));
  }
  if (ratio < 0 && typeof texGlue?.shrink === "number" && Number.isFinite(texGlue.shrink)) {
    return roundTexPt(Math.max(0, naturalWidth + ratio * texGlue.shrink));
  }
  return naturalWidth;
}

function texLinePreDisplaySize(
  line: LineReport,
  font: ResolvedTexFont
): number {
  const latexArticleListLeftMarginEm = 2.5;
  if (line.spaceCount > 0 && Math.abs(line.glueSetRatio) > 1e-9) {
    return Number.POSITIVE_INFINITY;
  }
  if (texLineHasInlineListLabel(line)) {
    return roundTexPt(Math.max(0, line.xEnd + 2 * font.atPt - latexArticleListLeftMarginEm * font.atPt));
  }
  return roundTexPt(Math.max(0, line.xEnd - line.xStart) + 2 * font.atPt);
}

function texLineHasInlineListLabel(line: LineReport): boolean {
  const labelIndex = line.segments.findIndex((segment) => segment.role === "list-label");
  if (labelIndex < 0) {
    return false;
  }
  const labelSegment = line.segments[labelIndex];
  const bodySegment = line.segments.slice(labelIndex + 1).find((segment) =>
    segment.role !== "list-label" && typeof segment.x === "number"
  );
  if (!labelSegment || !bodySegment) {
    return false;
  }
  return Math.abs(bodySegment.x - (labelSegment.x + labelSegment.width)) < 1e-6;
}

function texMathBoxFromWrapper(
  wrapper: Extract<ParagraphRun, { kind: "math" }>["wrapper"]
): {
  readonly content: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly caretStops?: readonly number[];
  readonly constructRanges?: readonly {
    readonly sourceStart: number;
    readonly sourceEnd: number;
    readonly xStart: number;
    readonly xEnd: number;
  }[];
  readonly breakpoints?: readonly {
    readonly kind: "binary" | "relation" | "penalty";
    readonly sourceOffset: number;
    readonly x: number;
    readonly penalty: number;
  }[];
  readonly svgBody?: string;
  readonly hlist?: TexMathHList;
  readonly fontProfile?: TexMathFontProfile;
  readonly rootBox?: TexMathBox;
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
    readonly sourceStart?: unknown;
    readonly sourceEnd?: unknown;
    readonly contentStart?: unknown;
    readonly contentEnd?: unknown;
    readonly width?: unknown;
    readonly height?: unknown;
    readonly depth?: unknown;
    readonly caretStops?: unknown;
    readonly constructRanges?: unknown;
    readonly breakpoints?: unknown;
    readonly svgBody?: unknown;
    readonly hlist?: unknown;
    readonly fontProfile?: unknown;
    readonly rootBox?: unknown;
  };
  return {
    content: typeof typedBox.content === "string" ? typedBox.content : "",
    sourceStart: Number(typedBox.sourceStart) || 0,
    sourceEnd: Number(typedBox.sourceEnd) || 0,
    contentStart: Number(typedBox.contentStart) || 0,
    contentEnd: Number(typedBox.contentEnd) || 0,
    width: Number(typedBox.width) || 0,
    height: Number(typedBox.height) || 0,
    depth: Number(typedBox.depth) || 0,
    caretStops: Array.isArray(typedBox.caretStops)
      ? typedBox.caretStops.filter((stop): stop is number => Number.isFinite(stop))
      : undefined,
    constructRanges: parseTexMathConstructRanges(typedBox.constructRanges),
    breakpoints: parseTexMathBreakpoints(typedBox.breakpoints),
    svgBody: typeof typedBox.svgBody === "string" ? typedBox.svgBody : undefined,
    hlist: typeof typedBox.hlist === "object" && typedBox.hlist !== null
      ? typedBox.hlist as TexMathHList
      : undefined,
    fontProfile: typeof typedBox.fontProfile === "object" && typedBox.fontProfile !== null
      ? typedBox.fontProfile as TexMathFontProfile
      : undefined,
    rootBox: typeof typedBox.rootBox === "object" && typedBox.rootBox !== null
      ? typedBox.rootBox as TexMathBox
      : undefined,
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
        caretStops: texMathBoxCaretStops(item.box, x, mathWidth),
        mathConstructRanges: texMathBoxConstructRanges(item.box, x, mathWidth),
        mathBreakpoints: texMathBoxBreakpoints(item.box, x, mathWidth),
        mathSvgBody: texMathBoxSvgBody(item.box, mathWidth),
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

function texMathBoxSvgBody(
  box: {
    readonly contentStart: number;
    readonly width: number;
    readonly svgBody?: string;
    readonly hlist?: TexMathHList;
    readonly fontProfile?: TexMathFontProfile;
  } | null | undefined,
  width: number,
  options: { readonly omitLineInitialOperator?: boolean } = {}
): string | undefined {
  if (!box) {
    return undefined;
  }
  if (box.hlist && box.fontProfile) {
    const resized = Math.abs(width - box.width) > 1e-6
      ? setTexMathHListWidth(box.hlist, width)
      : box.hlist;
    const hlist = options.omitLineInitialOperator
      ? omitLineInitialDiscardedMathOperator(resized, box.contentStart)
      : resized;
    return renderTexMathHListSvgBody(
      hlist,
      { fontProfile: box.fontProfile }
    );
  }
  return box.svgBody;
}

function omitLineInitialDiscardedMathOperator(
  hlist: TexMathHList,
  contentStart: number
): TexMathHList {
  const first = hlist.items[0];
  if (!isLineInitialDiscardedMathOperator(first, contentStart)) {
    return hlist;
  }
  return {
    ...hlist,
    items: hlist.items.slice(1),
  };
}

function isLineInitialDiscardedMathOperator(
  item: TexMathHListItem | undefined,
  contentStart: number
): boolean {
  return item?.kind === "glyph" &&
    (item.text === "+" || item.text === "=") &&
    item.sourceSpan.start === contentStart;
}

function texMathBoxCaretStops(
  box: { readonly caretStops?: readonly number[] } | null | undefined,
  x: number,
  width: number
): number[] {
  const localStops = box?.caretStops;
  if (!isFiniteNumberArray(localStops) || localStops.length === 0) {
    return [x, roundTexPt(x + width)];
  }
  return localStops.map((stop) => roundTexPt(x + Math.max(0, Math.min(width, stop))));
}

function isFiniteNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((entry) => Number.isFinite(entry));
}

function texMathBoxConstructRanges(
  box: {
    readonly constructRanges?: readonly {
      readonly sourceStart: number;
      readonly sourceEnd: number;
      readonly xStart: number;
      readonly xEnd: number;
    }[];
  } | null | undefined,
  x: number,
  width: number
): LineReport["segments"][number]["mathConstructRanges"] {
  const ranges = box?.constructRanges;
  if (!ranges?.length) {
    return undefined;
  }
  return ranges.map((range) => ({
    sourceStartRaw: range.sourceStart,
    sourceEndRaw: range.sourceEnd,
    xStart: roundTexPt(x + Math.max(0, Math.min(width, range.xStart))),
    xEnd: roundTexPt(x + Math.max(0, Math.min(width, range.xEnd))),
  }));
}

function texMathBoxBreakpoints(
  box: {
    readonly breakpoints?: readonly {
      readonly kind: "binary" | "relation" | "penalty";
      readonly sourceOffset: number;
      readonly x: number;
      readonly penalty: number;
    }[];
  } | null | undefined,
  x: number,
  width: number
): LineReport["segments"][number]["mathBreakpoints"] {
  const breakpoints = box?.breakpoints;
  if (!breakpoints?.length) {
    return undefined;
  }
  return breakpoints.map((breakpoint) => ({
    kind: breakpoint.kind,
    sourceOffsetRaw: breakpoint.sourceOffset,
    x: roundTexPt(x + Math.max(0, Math.min(width, breakpoint.x))),
    penalty: breakpoint.penalty,
  }));
}

function parseTexMathConstructRanges(value: unknown): {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly xStart: number;
  readonly xEnd: number;
}[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ranges = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as {
      readonly sourceStart?: unknown;
      readonly sourceEnd?: unknown;
      readonly xStart?: unknown;
      readonly xEnd?: unknown;
    };
    const sourceStart = Number(candidate.sourceStart);
    const sourceEnd = Number(candidate.sourceEnd);
    const xStart = Number(candidate.xStart);
    const xEnd = Number(candidate.xEnd);
    return Number.isFinite(sourceStart) &&
      Number.isFinite(sourceEnd) &&
      Number.isFinite(xStart) &&
      Number.isFinite(xEnd) &&
      sourceEnd > sourceStart &&
      xEnd > xStart
      ? [{ sourceStart, sourceEnd, xStart, xEnd }]
      : [];
  });
  return ranges.length > 0 ? ranges : undefined;
}

function parseTexMathBreakpoints(value: unknown): {
  readonly kind: "binary" | "relation" | "penalty";
  readonly sourceOffset: number;
  readonly x: number;
  readonly penalty: number;
}[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const breakpoints = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as {
      readonly kind?: unknown;
      readonly sourceOffset?: unknown;
      readonly x?: unknown;
      readonly penalty?: unknown;
    };
    const kind: "binary" | "relation" | "penalty" | null =
      candidate.kind === "binary" || candidate.kind === "relation" || candidate.kind === "penalty"
      ? candidate.kind
      : null;
    const sourceOffset = Number(candidate.sourceOffset);
    const x = Number(candidate.x);
    const penalty = Number(candidate.penalty);
    return kind &&
      Number.isFinite(sourceOffset) &&
      Number.isFinite(x) &&
      Number.isFinite(penalty)
      ? [{ kind, sourceOffset, x, penalty }]
      : [];
  });
  return breakpoints.length > 0 ? breakpoints : undefined;
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
