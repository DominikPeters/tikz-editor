import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type {
  BreakReport,
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
  texLayoutTextBoxItemWidth,
} from "./vlist/list-attachments.js";
import type { TexLineLabel } from "./vlist/index.js";
import { texInterwordGlueForSpaceFactor } from "./space-glue.js";
import type { TexLineBox } from "./vlist/index.js";
import {
  projectTexHBoxXToLine,
  projectTexHBoxYToLine,
  texHBoxX,
  texHBoxY,
  texLength,
  texLineX,
  texLineY,
  texVListLocalY,
  type TexHBoxX,
  type TexHBoxY,
  type TexLength,
  type TexLineX,
  type TexLineY,
} from "./coordinates.js";

export interface TexParagraphReportBuildResult {
  readonly report: ParagraphLayoutReport;
  readonly lineBoxes: readonly TexLineBox[];
}

export function buildTexParagraphReport(params: {
  paragraphId: string;
  width: TexLength;
  alignment: TexParagraphAlignment;
  runs: readonly ParagraphRun[];
  lines: readonly GreedyLine[];
  shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  runWidths: ReadonlyMap<number, TexLength>;
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
    width: params.runWidths.get(run.runIndex) ?? texLength(0),
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
    width: TexLength;
    runs: readonly ParagraphRun[];
    shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
    metricProvider: TexMetricProvider;
    runWidths: ReadonlyMap<number, TexLength>;
    lineLabels: ReadonlyMap<number, TexLineLabel>;
    font: ResolvedTexFont;
  }
): { readonly report: LineReport; readonly lineBox: TexLineBox } {
  const segments: LineReport["segments"] = [];
  let x = texLineX(line.xOffset ?? 0);
  let ascent = texLength(0);
  let descent = texLength(0);
  const label = params.lineLabels.get(line.lineIndex);
  if (label) {
    const labelReport = buildTexLineLabelSegments(label, params.metricProvider);
    segments.push(...labelReport.segments);
    ascent = texLength(Math.max(ascent, labelReport.ascent));
    descent = texLength(Math.max(descent, labelReport.descent));
  }
  if (line.startPendingText) {
    const runFont = params.shapedRuns.get(line.startRun)?.font ?? params.font;
    const shaped = params.metricProvider.shapeText(line.startPendingText, runFont);
    const metrics = texShapedRunMetrics(shaped);
    ascent = texLength(Math.max(ascent, metrics.ascent));
    descent = texLength(Math.max(descent, metrics.descent));
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
      fontAtPt: runFont.atPt,
      ...(runFont.color ? { color: runFont.color } : {}),
      x,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => projectRoundedTexHBoxXToLine(
        stop,
        texHBoxX(0),
        x
      )),
    });
    x = texLineX(roundTexPt(x + shaped.width));
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
      const width = texLength(roundTexPt(endX - startX));
      const caretStops = shaped.caretStops.slice(startOffset, endOffset + 1)
        .map((stop) => projectRoundedTexHBoxXToLine(stop, startX, x));
      const metrics = texShapedSliceMetrics(shaped, startOffset, endOffset);
      ascent = texLength(Math.max(ascent, metrics.ascent));
      descent = texLength(Math.max(descent, metrics.descent));
      segments.push({
        runIndex: run.runIndex,
        kind: "text",
        role: run.role,
        ...(run.literal ? { literal: run.literal } : {}),
        text: run.text.slice(startOffset, endOffset),
        startOffset,
        endOffset,
        sourceStartRaw: run.sourceStart + startOffset,
        sourceEndRaw: run.sourceStart + endOffset,
        sourceKind: "text",
        fontId: shaped.font.id,
        fontAtPt: shaped.font.atPt,
        ...(shaped.font.color ? { color: shaped.font.color } : {}),
        x,
        width,
        caretStops,
      });
      x = texLineX(roundTexPt(x + width));
      continue;
    }

    if (run.kind === "math") {
      const continuationLineStart = isContinuationLineStartMath(line, runIndex, x);
      const coalesced = coalescedSameLineMathSegment(runIndex, line, params, x, continuationLineStart);
      if (coalesced) {
        segments.push(coalesced.segment);
        ascent = texLength(Math.max(ascent, coalesced.ascent));
        descent = texLength(Math.max(descent, coalesced.descent));
        x = texLineX(roundTexPt(x + coalesced.segment.width));
        runIndex = coalesced.endRunIndex;
        continue;
      }
      const naturalWidth = params.runWidths.get(run.runIndex) ?? texLength(0);
      const width = adjustedTexGlueWidth(naturalWidth, run.texGlue, line.glueSetRatio ?? 0);
      const box = texMathBoxFromWrapper(run.wrapper);
      ascent = texLength(Math.max(ascent, box?.height ?? texLength(0)));
      descent = texLength(Math.max(descent, box?.depth ?? texLength(0)));
      segments.push({
        runIndex: run.runIndex,
        kind: "math",
        role: run.role,
        text: box?.content ?? "",
        sourceStartRaw: run.sourceStart,
        sourceEndRaw: run.sourceEnd,
        sourceKind: box?.sourceKind ?? "math",
        x,
        width,
        caretStops: texMathBoxCaretStops(box, x, width),
        mathConstructRanges: texMathBoxConstructRanges(box, x, width),
        mathCaretEntries: texMathBoxCaretEntries(box, x, width),
        mathBreakpoints: texMathBoxBreakpoints(box, x, width),
        mathSvgBody: texMathBoxSvgBody(box, width, {
          omitLineInitialOperator: continuationLineStart && box?.sourceStart === box?.contentStart,
        }),
      });
      x = texLineX(roundTexPt(x + width));
      continue;
    }

    if (run.kind === "penalty") {
      continue;
    }

    const naturalWidth = params.runWidths.get(run.runIndex) ?? texLength(0);
    const width = isTexTextKernSpace(run.wrapper)
      ? naturalWidth
      : adjustedTexGlueWidth(
        naturalWidth,
        run.kind === "space" && (line.spaceCount ?? 0) > 0 ? run.texGlue : undefined,
        line.glueSetRatio ?? 0
      );
    const isHiddenGlue = isTexHiddenGlueSpace(run.wrapper);
    segments.push({
      runIndex: run.runIndex,
      kind: "space",
      role: run.role,
      text: isHiddenGlue ? "" : " ",
      sourceStartRaw: run.sourceStart,
      sourceEndRaw: run.sourceEnd,
      sourceKind: isHiddenGlue ? "math" : "text",
      x,
      width,
      caretStops: [x, texLineX(roundTexPt(x + width))],
    });
    x = texLineX(roundTexPt(x + width));
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
    ascent = texLength(Math.max(ascent, metrics.ascent));
    descent = texLength(Math.max(descent, metrics.descent));
    const isSimpleInsertedDiscretionary =
      discretionary.replaceStart === splitOffset &&
      discretionary.replaceEnd === splitOffset &&
      discretionary.replaceText.length === 0 &&
      discretionary.postBreakText.length === 0;
    const insertedWidth = line.break.width ?? discretionary.insertedWidth;
    const segmentX = isSimpleInsertedDiscretionary
      ? texLineX(roundTexPt(x + insertedWidth - shaped.width))
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
      fontAtPt: runFont.atPt,
      ...(runFont.color ? { color: runFont.color } : {}),
      x: segmentX,
      width: shaped.width,
      caretStops: shaped.caretStops.map((stop) => projectRoundedTexHBoxXToLine(
        stop,
        texHBoxX(0),
        segmentX
      )),
    });
    x = texLineX(roundTexPt(
      x + (isSimpleInsertedDiscretionary ? insertedWidth : shaped.width)
    ));
  } else if (line.break?.kind === "hyphen" && line.break.visibleHyphen) {
    const runFont = params.shapedRuns.get(line.break.runIndex)?.font ?? params.font;
    const width = params.metricProvider.shapeText("-", runFont).width;
    const metrics = texShapedRunMetrics(params.metricProvider.shapeText("-", runFont));
    ascent = texLength(Math.max(ascent, metrics.ascent));
    descent = texLength(Math.max(descent, metrics.descent));
    const insertedWidth = line.break.width ?? width;
    const hyphenX = texLineX(roundTexPt(x + insertedWidth - width));
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
      fontAtPt: runFont.atPt,
      ...(runFont.color ? { color: runFont.color } : {}),
      x: hyphenX,
      width,
      caretStops: [hyphenX, texLineX(roundTexPt(hyphenX + width))],
    });
    x = texLineX(roundTexPt(x + insertedWidth));
  }

  const xStart = texLineX(line.xOffset ?? 0);
  const breakReport: BreakReport | null = line.break
    ? (() => {
        const { width: breakWidth, ...breakFields } = line.break;
        return {
          ...breakFields,
          ...(breakWidth !== undefined
            ? { width: texLength(breakWidth) }
            : {}),
        };
      })()
    : null;
  const report: LineReport = {
    lineIndex: line.lineIndex,
    startRun: line.startRun,
    endRun: line.endRun,
    width: texLength(line.lineNaturalWidth ?? line.width),
    targetWidth: texLength(line.targetWidth ?? params.width),
    naturalWidth: texLength(line.lineNaturalWidth ?? line.width),
    glueSetRatio: line.glueSetRatio ?? 0,
    badness: line.badness ?? 0,
    spaceCount: line.spaceCount ?? 0,
    spaceDeltaPerGap: texLength(line.spaceDeltaPerGap ?? 0),
    ascent: texLength(roundTexPt(ascent)),
    descent: texLength(roundTexPt(descent)),
    xStart,
    xEnd: x,
    break: breakReport,
    segments,
  };
  return {
    report,
    lineBox: {
      lineIndex: report.lineIndex,
      y: texVListLocalY(0),
      targetWidth: texLength(report.targetWidth),
      metrics: {
        width: texLength(report.targetWidth),
        height: texLength(report.ascent),
        depth: texLength(report.descent),
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
    runWidths: ReadonlyMap<number, TexLength>;
  },
  x: TexLineX,
  omitLineInitialOperator: boolean
): {
  readonly segment: LineReport["segments"][number];
  readonly ascent: TexLength;
  readonly descent: TexLength;
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
  let width = texLength(0);
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
      width = texLength(roundTexPt(width + adjustedTexGlueWidth(
        params.runWidths.get(run.runIndex) ?? texLength(0),
        (line.spaceCount ?? 0) > 0 ? run.texGlue : undefined,
        line.glueSetRatio ?? 0
      )));
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
    width = texLength(roundTexPt(width + adjustedTexGlueWidth(
      params.runWidths.get(run.runIndex) ?? texLength(0),
      run.texGlue,
      line.glueSetRatio ?? 0
    )));
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
      sourceKind: rootBox.sourceKind ?? "math",
      x,
      width,
      caretStops: texMathBoxCaretStops(rootBox, x, width),
      mathConstructRanges: texMathBoxConstructRanges(rootBox, x, width),
      mathCaretEntries: texMathBoxCaretEntries(rootBox, x, width),
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
  x: TexLineX
): boolean {
  return line.lineIndex > 0 &&
    runIndex === line.startRun &&
    Math.abs(x - (line.xOffset ?? 0)) < 1e-6;
}

function isTexHiddenGlueSpace(wrapper: unknown): boolean {
  return isTexMathGlueSpace(wrapper) || isTexTextKernSpace(wrapper);
}

function isTexMathGlueSpace(wrapper: unknown): boolean {
  return Boolean(
    wrapper &&
    typeof wrapper === "object" &&
    (wrapper as { readonly texMathGlueSpace?: unknown }).texMathGlueSpace
  );
}

function isTexTextKernSpace(wrapper: unknown): boolean {
  return Boolean(
    wrapper &&
    typeof wrapper === "object" &&
    (wrapper as { readonly texTextKernSpace?: unknown }).texTextKernSpace
  );
}

function adjustedTexGlueWidth(
  naturalWidth: TexLength,
  texGlue: {
    readonly stretch: number;
    readonly shrink: number;
  } | undefined,
  ratio: number
): TexLength {
  // An overfull line with no available shrink has TeX's sentinel ratio
  // -Infinity. Multiplying it by a zero glue component would turn a valid
  // natural width into NaN and poison all following caret geometry.
  if (!Number.isFinite(ratio)) {
    return naturalWidth;
  }
  if (ratio > 0 && typeof texGlue?.stretch === "number" && Number.isFinite(texGlue.stretch)) {
    return texLength(roundTexPt(Math.max(0, naturalWidth + ratio * texGlue.stretch)));
  }
  if (ratio < 0 && typeof texGlue?.shrink === "number" && Number.isFinite(texGlue.shrink)) {
    return texLength(roundTexPt(Math.max(0, naturalWidth + ratio * texGlue.shrink)));
  }
  return naturalWidth;
}

function texLinePreDisplaySize(
  line: LineReport,
  font: ResolvedTexFont
): TexLength {
  const latexArticleListLeftMarginEm = 2.5;
  if (line.spaceCount > 0 && Math.abs(line.glueSetRatio) > 1e-9) {
    return texLength(Number.POSITIVE_INFINITY);
  }
  if (texLineHasInlineListLabel(line)) {
    return texLength(roundTexPt(
      Math.max(0, line.xEnd + 2 * font.atPt - latexArticleListLeftMarginEm * font.atPt)
    ));
  }
  return texLength(roundTexPt(Math.max(0, line.xEnd - line.xStart) + 2 * font.atPt));
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
): TexMathBox | null {
  if (!wrapper || typeof wrapper !== "object") {
    return null;
  }
  const box = wrapper.texMathBox;
  if (!box || typeof box !== "object") {
    return null;
  }
  const typedBox = box as {
    readonly source?: unknown;
    readonly content?: unknown;
    readonly sourceStart?: unknown;
    readonly sourceEnd?: unknown;
    readonly contentStart?: unknown;
    readonly contentEnd?: unknown;
    readonly sourceKind?: unknown;
    readonly width?: unknown;
    readonly height?: unknown;
    readonly depth?: unknown;
    readonly caretMap?: unknown;
    readonly caretStops?: unknown;
    readonly constructRanges?: unknown;
    readonly breakpoints?: unknown;
    readonly svgBody?: unknown;
    readonly hlist?: unknown;
    readonly fontProfile?: unknown;
    readonly color?: unknown;
    readonly rootBox?: unknown;
  };
  return {
    source: typeof typedBox.source === "string" ? typedBox.source : "",
    content: typeof typedBox.content === "string" ? typedBox.content : "",
    sourceStart: Number(typedBox.sourceStart) || 0,
    sourceEnd: Number(typedBox.sourceEnd) || 0,
    contentStart: Number(typedBox.contentStart) || 0,
    contentEnd: Number(typedBox.contentEnd) || 0,
    sourceKind: typedBox.sourceKind === "text" || typedBox.sourceKind === "math"
      ? typedBox.sourceKind
      : undefined,
    width: texLength(Number(typedBox.width) || 0),
    height: texLength(Number(typedBox.height) || 0),
    depth: texLength(Number(typedBox.depth) || 0),
    caretMap: typeof typedBox.caretMap === "object" && typedBox.caretMap !== null
      ? typedBox.caretMap as TexMathBox["caretMap"]
      : undefined,
    caretStops: Array.isArray(typedBox.caretStops)
      ? typedBox.caretStops
          .filter((stop): stop is number => Number.isFinite(stop))
          .map(texHBoxX)
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
    color: typeof typedBox.color === "string" ? typedBox.color : undefined,
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
  readonly ascent: TexLength;
  readonly descent: TexLength;
} {
  const segments: LineReport["segments"] = [];
  const width = texLayoutItemsNaturalWidth(label.label.items, metricProvider);
  let x = texLineX(roundTexPt(label.label.rightEdge - width));
  let ascent = texLength(0);
  let descent = texLength(0);
  for (const item of label.label.items) {
    if (item.kind === "glyph") {
      const glyphWidth = texLayoutGlyphItemWidth(item);
      ascent = texLength(Math.max(ascent, texLayoutGlyphItemHeight(item)));
      descent = texLength(Math.max(descent, texLayoutGlyphItemDepth(item)));
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "text",
        role: "list-label",
        text: item.text,
        startOffset: 0,
        endOffset: item.text.length,
        fontId: item.font.id,
        fontAtPt: item.font.atPt,
        ...(item.font.color ? { color: item.font.color } : {}),
        glyphCode: item.code,
        x,
        width: glyphWidth,
        caretStops: [x, texLineX(roundTexPt(x + glyphWidth))],
      });
      x = texLineX(roundTexPt(x + glyphWidth));
      continue;
    }
    if (item.kind === "forced-break") {
      continue;
    }
    if (item.kind === "text") {
      const shaped = metricProvider.shapeText(item.text, item.font);
      const metrics = texShapedRunMetrics(shaped);
      ascent = texLength(Math.max(ascent, metrics.ascent));
      descent = texLength(Math.max(descent, metrics.descent));
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "text",
        role: "list-label",
        text: item.text,
        startOffset: 0,
        endOffset: item.text.length,
        fontId: item.font.id,
        fontAtPt: item.font.atPt,
        ...(item.font.color ? { color: item.font.color } : {}),
        x,
        width: shaped.width,
        caretStops: shaped.caretStops.map((stop) => projectRoundedTexHBoxXToLine(
          stop,
          texHBoxX(0),
          x
        )),
      });
      x = texLineX(roundTexPt(x + shaped.width));
      continue;
    }
    if (item.kind === "kern") {
      x = texLineX(roundTexPt(x + item.width));
      continue;
    }
    if (item.kind === "math") {
      const mathWidth = texLayoutMathItemWidth(item);
      ascent = texLength(Math.max(ascent, item.box.height));
      descent = texLength(Math.max(descent, item.box.depth));
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "math",
        role: "list-label",
        text: item.content,
        sourceStartRaw: item.sourceStart,
        sourceEndRaw: item.sourceEnd,
        sourceKind: item.box.sourceKind ?? "math",
        x,
        width: mathWidth,
        caretStops: texMathBoxCaretStops(item.box, x, mathWidth),
        mathConstructRanges: texMathBoxConstructRanges(item.box, x, mathWidth),
        mathCaretEntries: texMathBoxCaretEntries(item.box, x, mathWidth),
        mathBreakpoints: texMathBoxBreakpoints(item.box, x, mathWidth),
        mathSvgBody: texMathBoxSvgBody(item.box, mathWidth),
      });
      x = texLineX(roundTexPt(x + mathWidth));
      continue;
    }
    if (item.kind === "text-box") {
      const boxWidth = texLayoutTextBoxItemWidth(item);
      ascent = texLength(Math.max(ascent, item.box.height));
      descent = texLength(Math.max(descent, item.box.depth));
      segments.push({
        runIndex: label.lineRunIndex,
        kind: "math",
        role: "list-label",
        text: item.content,
        sourceStartRaw: item.sourceStart,
        sourceEndRaw: item.sourceEnd,
        sourceKind: item.box.sourceKind ?? "text",
        x,
        width: boxWidth,
        caretStops: texMathBoxCaretStops(item.box, x, boxWidth),
        mathConstructRanges: texMathBoxConstructRanges(item.box, x, boxWidth),
        mathCaretEntries: texMathBoxCaretEntries(item.box, x, boxWidth),
        mathBreakpoints: texMathBoxBreakpoints(item.box, x, boxWidth),
        mathSvgBody: texMathBoxSvgBody(item.box, boxWidth),
      });
      x = texLineX(roundTexPt(x + boxWidth));
      continue;
    }
    if (item.kind === "penalty") {
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
      caretStops: [x, texLineX(roundTexPt(x + glue.width))],
    });
    x = texLineX(roundTexPt(x + glue.width));
  }
  return { segments, ascent, descent };
}

function texMathBoxSvgBody(
  box: {
    readonly contentStart: number;
    readonly width: TexLength;
    readonly svgBody?: string;
    readonly hlist?: TexMathHList;
    readonly fontProfile?: TexMathFontProfile;
    readonly color?: string;
  } | null | undefined,
  width: TexLength,
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
    const body = renderTexMathHListSvgBody(
      hlist,
      { fontProfile: box.fontProfile }
    );
    return box.color ? wrapTexSvgColor(body, box.color) : body;
  }
  return box.svgBody && box.color ? wrapTexSvgColor(box.svgBody, box.color) : box.svgBody;
}

function wrapTexSvgColor(body: string, color: string): string {
  return `<g fill="${color.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" stroke="${color.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">${body}</g>`;
}

function omitLineInitialDiscardedMathOperator(
  hlist: TexMathHList,
  contentStart: number
): TexMathHList {
  const filtered = hlist.items.filter((item, index, items) =>
    !isLineInitialDiscardedMathOperator(item, index, items, contentStart)
  );
  if (filtered.length === hlist.items.length) {
    return hlist;
  }
  return {
    ...hlist,
    items: filtered,
  };
}

function isLineInitialDiscardedMathOperator(
  item: TexMathHListItem | undefined,
  index: number,
  items: readonly TexMathHListItem[],
  contentStart: number
): boolean {
  if (item?.kind !== "glyph") {
    return false;
  }
  if ((item.text === "+" || item.text === "=") && item.sourceSpan.start === contentStart) {
    return true;
  }
  if (isOpeningDelimiterGlyph(item)) {
    return true;
  }
  return (item.text === "+" || item.text === "=") &&
    (isCompositeMathBoundaryItem(previousVisibleMathItem(items, index)) ||
      isCompositeMathBoundaryItem(nextVisibleMathItem(items, index)));
}

function isOpeningDelimiterGlyph(item: TexMathHListItem): boolean {
  return item.kind === "glyph" &&
    item.family === "operators" &&
    item.fontId === "cmr10" &&
    item.text === "\\sqrt" &&
    (item.code === 40 || item.code === 91);
}

function previousVisibleMathItem(
  items: readonly TexMathHListItem[],
  index: number
): TexMathHListItem | undefined {
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = items[candidateIndex];
    if (isVisibleMathItem(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function nextVisibleMathItem(
  items: readonly TexMathHListItem[],
  index: number
): TexMathHListItem | undefined {
  for (let candidateIndex = index + 1; candidateIndex < items.length; candidateIndex += 1) {
    const candidate = items[candidateIndex];
    if (isVisibleMathItem(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isVisibleMathItem(item: TexMathHListItem | undefined): item is TexMathHListItem {
  return item?.kind === "glyph" || item?.kind === "hlist" || item?.kind === "rule";
}

function isCompositeMathBoundaryItem(item: TexMathHListItem | undefined): boolean {
  if (!item) {
    return false;
  }
  if (item.kind === "rule") {
    return true;
  }
  if (item.kind === "hlist") {
    return item.role === "nucleus";
  }
  return isGeneratedDelimiterGlyph(item);
}

function isGeneratedDelimiterGlyph(item: TexMathHListItem): boolean {
  if (item.kind !== "glyph" || item.text !== "\\sqrt") {
    return false;
  }
  if (item.family === "operators" && item.fontId === "cmr10") {
    return item.code === 40 || item.code === 41 || item.code === 91 || item.code === 93;
  }
  return item.family === "extension";
}

function texMathBoxCaretStops(
  box: { readonly caretStops?: readonly TexHBoxX[] } | null | undefined,
  x: TexLineX,
  width: TexLength
): TexLineX[] {
  const localStops = box?.caretStops;
  if (!isFiniteNumberArray(localStops) || localStops.length === 0) {
    return [x, texLineX(roundTexPt(x + width))];
  }
  return localStops.map((stop) => projectRoundedTexHBoxXToLine(
    texHBoxX(Math.max(0, Math.min(width, stop))),
    texHBoxX(0),
    x
  ));
}

function isFiniteNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((entry) => Number.isFinite(entry));
}

function texMathBoxConstructRanges(
  box: {
    readonly constructRanges?: readonly {
      readonly sourceStart: number;
      readonly sourceEnd: number;
      readonly xStart: TexHBoxX;
      readonly xEnd: TexHBoxX;
    }[];
  } | null | undefined,
  x: TexLineX,
  width: TexLength
): LineReport["segments"][number]["mathConstructRanges"] {
  const ranges = box?.constructRanges;
  if (!ranges?.length) {
    return undefined;
  }
  return ranges.map((range) => ({
    sourceStartRaw: range.sourceStart,
    sourceEndRaw: range.sourceEnd,
    xStart: projectRoundedTexHBoxXToLine(
      texHBoxX(Math.max(0, Math.min(width, range.xStart))),
      texHBoxX(0),
      x
    ),
    xEnd: projectRoundedTexHBoxXToLine(
      texHBoxX(Math.max(0, Math.min(width, range.xEnd))),
      texHBoxX(0),
      x
    ),
  }));
}

function texMathBoxCaretEntries(
  box: {
    readonly caretMap?: TexMathBox["caretMap"];
  } | null | undefined,
  x: TexLineX,
  width: TexLength
): LineReport["segments"][number]["mathCaretEntries"] {
  const entries = box?.caretMap?.entries;
  if (!entries?.length) {
    return undefined;
  }
  return entries.map((entry) => ({
    sourceOffsetRaw: entry.sourceOffset,
    ...(entry.sourceSpan ? {
      sourceStartRaw: entry.sourceSpan.start,
      sourceEndRaw: entry.sourceSpan.end,
    } : {}),
    x: projectRoundedTexHBoxXToLine(
      texHBoxX(Math.max(0, Math.min(width, entry.x))),
      texHBoxX(0),
      x
    ),
    y: projectRoundedTexMathHBoxYToLine(entry.y),
    height: texLength(roundTexPt(entry.height)),
    depth: texLength(roundTexPt(entry.depth)),
    kind: entry.kind,
    ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
    hitBounds: {
      xStart: projectRoundedTexHBoxXToLine(
        texHBoxX(Math.max(0, Math.min(width, entry.hitBounds.xStart))),
        texHBoxX(0),
        x
      ),
      xEnd: projectRoundedTexHBoxXToLine(
        texHBoxX(Math.max(0, Math.min(width, entry.hitBounds.xEnd))),
        texHBoxX(0),
        x
      ),
      yStart: projectRoundedTexMathHBoxYToLine(entry.hitBounds.yStart),
      yEnd: projectRoundedTexMathHBoxYToLine(entry.hitBounds.yEnd),
    },
  }));
}

function texMathBoxBreakpoints(
  box: {
    readonly breakpoints?: readonly {
      readonly kind: "binary" | "relation" | "penalty";
      readonly sourceOffset: number;
      readonly x: TexHBoxX;
      readonly penalty: number;
    }[];
  } | null | undefined,
  x: TexLineX,
  width: TexLength
): LineReport["segments"][number]["mathBreakpoints"] {
  const breakpoints = box?.breakpoints;
  if (!breakpoints?.length) {
    return undefined;
  }
  return breakpoints.map((breakpoint) => ({
    kind: breakpoint.kind,
    sourceOffsetRaw: breakpoint.sourceOffset,
    x: projectRoundedTexHBoxXToLine(
      texHBoxX(Math.max(0, Math.min(width, breakpoint.x))),
      texHBoxX(0),
      x
    ),
    penalty: breakpoint.penalty,
  }));
}

function projectRoundedTexHBoxXToLine(
  position: TexHBoxX,
  hboxOrigin: TexHBoxX,
  lineOrigin: TexLineX
): TexLineX {
  return texLineX(roundTexPt(projectTexHBoxXToLine(
    position,
    hboxOrigin,
    lineOrigin
  )));
}

function projectRoundedTexMathHBoxYToLine(position: TexHBoxY): TexLineY {
  return texLineY(roundTexPt(projectTexHBoxYToLine(
    position,
    texHBoxY(0),
    texLineY(0)
  )));
}

function parseTexMathConstructRanges(value: unknown): {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly xStart: TexHBoxX;
  readonly xEnd: TexHBoxX;
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
      ? [{
          sourceStart,
          sourceEnd,
          xStart: texHBoxX(xStart),
          xEnd: texHBoxX(xEnd),
        }]
      : [];
  });
  return ranges.length > 0 ? ranges : undefined;
}

function parseTexMathBreakpoints(value: unknown): {
  readonly kind: "binary" | "relation" | "penalty";
  readonly sourceOffset: number;
  readonly x: TexHBoxX;
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
      ? [{ kind, sourceOffset, x: texHBoxX(x), penalty }]
      : [];
  });
  return breakpoints.length > 0 ? breakpoints : undefined;
}

function texShapedSliceMetrics(
  shaped: ShapedTexTextRun,
  startOffset: number,
  endOffset: number
): { readonly ascent: TexLength; readonly descent: TexLength } {
  let ascent = texLength(0);
  let descent = texLength(0);
  for (const item of shaped.items) {
    if (
      item.kind !== "glyph" ||
      item.sourceEnd <= startOffset + shaped.sourceStart ||
      item.sourceStart >= endOffset + shaped.sourceStart
    ) {
      continue;
    }
    ascent = texLength(Math.max(ascent, item.height));
    descent = texLength(Math.max(descent, item.depth));
  }
  return { ascent, descent };
}

function texShapedRunMetrics(
  shaped: ShapedTexTextRun
): { readonly ascent: TexLength; readonly descent: TexLength } {
  let ascent = texLength(0);
  let descent = texLength(0);
  for (const item of shaped.items) {
    if (item.kind !== "glyph") {
      continue;
    }
    ascent = texLength(Math.max(ascent, item.height));
    descent = texLength(Math.max(descent, item.depth));
  }
  return { ascent, descent };
}

function texLayoutItemsNaturalWidth(
  items: readonly TexLayoutLabelItem[],
  metricProvider: TexMetricProvider
): TexLength {
  let width = texLength(0);
  for (const item of items) {
    if (item.kind === "glyph") {
      width = texLength(width + texLayoutGlyphItemWidth(item));
      continue;
    }
    if (item.kind === "forced-break") {
      continue;
    }
    if (item.kind === "text") {
      width = texLength(width + metricProvider.shapeText(item.text, item.font).width);
      continue;
    }
    if (item.kind === "kern") {
      width = texLength(width + item.width);
      continue;
    }
    if (item.kind === "math") {
      width = texLength(width + texLayoutMathItemWidth(item));
      continue;
    }
    if (item.kind === "text-box") {
      width = texLength(width + texLayoutTextBoxItemWidth(item));
      continue;
    }
    if (item.kind === "penalty") {
      continue;
    }
    width = texLength(width + texInterwordGlueForSpaceFactor(
      item.font,
      item.spaceFactor,
      item.spaceGlueProfile
    ).width);
  }
  return texLength(roundTexPt(width));
}
