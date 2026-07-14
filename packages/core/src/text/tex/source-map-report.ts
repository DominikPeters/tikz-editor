import type {
  BreakReport,
  LineMathBreakpointReport,
  LineMathCaretEntryReport,
  LineMathConstructRangeReport,
  LineSegmentReport,
  ParagraphLayoutReport,
  RunReport
} from "../knuth-plass/paragraph/report.js";
import {
  projectInputOffset,
  projectInputRange,
  type TextSourceMap
} from "../source-map.js";
import {
  documentSourceOffset,
  type SourceCoordinateSpace,
} from "../source-coordinates.js";
import type { TexMathBox } from "./layout-inline-items.js";
import { texLength } from "./coordinates.js";
import type {
  PositionedTexVListItem,
  TexHitMap,
  TexHorizontalLayout,
  TexLineBox,
  TexSourceSpan,
  TexVListBoxLayoutReport,
  TexVListBoxReportItem,
  TexVListItem,
  TexVListLayout,
  TexVListParagraphPlacement
} from "./vlist/types.js";

export function remapParagraphLayoutReportSourceMap<Space extends SourceCoordinateSpace>(
  report: ParagraphLayoutReport<Space>,
  sourceMap: undefined
): ParagraphLayoutReport<Space>;
export function remapParagraphLayoutReportSourceMap(
  report: ParagraphLayoutReport<"layout">,
  sourceMap: TextSourceMap
): ParagraphLayoutReport<"document">;
export function remapParagraphLayoutReportSourceMap(
  report: ParagraphLayoutReport<"layout">,
  sourceMap: TextSourceMap | undefined
): ParagraphLayoutReport<"layout"> | ParagraphLayoutReport<"document">;
export function remapParagraphLayoutReportSourceMap<Space extends SourceCoordinateSpace>(
  report: ParagraphLayoutReport<Space>,
  sourceMap: TextSourceMap | undefined
): ParagraphLayoutReport<Space> | ParagraphLayoutReport<"document"> {
  if (!sourceMap) {
    return report;
  }
  return {
    ...report,
    sourceCoordinateSpace: "document",
    runs: report.runs.map((run) => remapRunReport(run, sourceMap)),
    lines: report.lines.map((line) => ({
      ...line,
      break: remapBreakReport(line.break, sourceMap),
      segments: line.segments.flatMap((segment) => remapLineSegmentReport(segment, sourceMap))
    }))
  };
}

export function remapTexVListLayoutSourceMap(
  layout: TexVListLayout<"layout">,
  sourceMap: undefined
): TexVListLayout<"layout">;
export function remapTexVListLayoutSourceMap(
  layout: TexVListLayout<"layout">,
  sourceMap: TextSourceMap
): TexVListLayout<"document">;
export function remapTexVListLayoutSourceMap(
  layout: TexVListLayout<"layout">,
  sourceMap: TextSourceMap | undefined
): TexVListLayout<"layout"> | TexVListLayout<"document">;
export function remapTexVListLayoutSourceMap(
  layout: TexVListLayout<"layout">,
  sourceMap: TextSourceMap | undefined
): TexVListLayout<"layout"> | TexVListLayout<"document"> {
  if (!sourceMap) {
    return layout;
  }
  const boxReport = remapTexVListBoxLayoutReport(layout.boxReport, sourceMap);
  return {
    ...layout,
    items: layout.items.map((item) => remapPositionedTexVListItem(item, sourceMap)),
    boxReport,
    paragraphPlacements: layout.paragraphPlacements.map((placement) =>
      remapTexVListParagraphPlacement(placement, sourceMap)
    ),
    reports: layout.reports.map((report) => {
      if ("paragraphId" in report) {
        return remapParagraphLayoutReportSourceMap(report, sourceMap);
      }
      if (report.kind === "tex-vlist-boxes") {
        return remapTexVListBoxLayoutReport(report, sourceMap);
      }
      return report;
    })
  };
}

function remapRunReport<Space extends SourceCoordinateSpace>(
  run: RunReport<Space>,
  sourceMap: TextSourceMap
): RunReport<"document"> {
  const sourceSpan = run.sourceStart == null || run.sourceEnd == null
    ? null
    : mapInputSpan(sourceMap, run.sourceStart, run.sourceEnd);
  const { sourceStart: _sourceStart, sourceEnd: _sourceEnd, ...rest } = run;
  return {
    ...rest,
    ...(sourceSpan ? {
      sourceStart: documentSourceOffset(sourceSpan.start),
      sourceEnd: documentSourceOffset(sourceSpan.end),
    } : {})
  };
}

function remapLineSegmentReport<Space extends SourceCoordinateSpace>(
  segment: LineSegmentReport<Space>,
  sourceMap: TextSourceMap
): readonly LineSegmentReport<"document">[] {
  const split = splitRemappedTextSegmentReport(segment, sourceMap);
  if (split) {
    return split;
  }
  const sourceProjection = segment.sourceStartRaw == null || segment.sourceEndRaw == null
    ? null
    : mapInputSpanWithPolicy(sourceMap, segment.sourceStartRaw, segment.sourceEndRaw);
  const {
    sourceStartRaw: _sourceStartRaw,
    sourceEndRaw: _sourceEndRaw,
    mathConstructRanges: _mathConstructRanges,
    mathCaretEntries: _mathCaretEntries,
    mathBreakpoints: _mathBreakpoints,
    ...rest
  } = segment;
  return [{
    ...rest,
    ...(sourceProjection ? {
      sourceStartRaw: documentSourceOffset(sourceProjection.start),
      sourceEndRaw: documentSourceOffset(sourceProjection.end),
      sourceRangePolicy: sourceProjection.policy,
    } : {}),
    mathConstructRanges: segment.mathConstructRanges?.map((range) =>
      remapLineMathConstructRangeReport(range, sourceMap)
    ),
    mathCaretEntries: segment.mathCaretEntries?.map((entry) =>
      remapLineMathCaretEntryReport(entry, sourceMap)
    ),
    mathBreakpoints: segment.mathBreakpoints?.map((breakpoint) =>
      remapLineMathBreakpointReport(breakpoint, sourceMap)
    ),
    mathSvgBody: segment.mathSvgBody
      ? remapSvgSourceDataAttributes(segment.mathSvgBody, sourceMap)
      : undefined
  }];
}

function splitRemappedTextSegmentReport<Space extends SourceCoordinateSpace>(
  segment: LineSegmentReport<Space>,
  sourceMap: TextSourceMap
): readonly LineSegmentReport<"document">[] | null {
  const text = segment.text;
  if (
    (segment.kind !== "text" && segment.kind !== "space") ||
    !text ||
    segment.sourceStartRaw == null ||
    segment.sourceEndRaw == null ||
    !Array.isArray(segment.caretStops) ||
    segment.caretStops.length < text.length + 1
  ) {
    return null;
  }

  const groups: Array<{ start: number; end: number }> = [];
  let groupStart = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || !canMergeProjectedTextChars(sourceMap, segment.sourceStartRaw, groupStart, index)) {
      groups.push({ start: groupStart, end: index });
      groupStart = index;
    }
  }

  return groups.map(({ start, end }) => {
    const sourceProjection = mapInputSpanWithPolicy(
      sourceMap,
      segment.sourceStartRaw! + start,
      segment.sourceStartRaw! + end
    );
    const xStart = segment.caretStops?.[start] ?? segment.x;
    const xEnd = segment.caretStops?.[end] ?? xStart;
    const {
      sourceStartRaw: _sourceStartRaw,
      sourceEndRaw: _sourceEndRaw,
      mathConstructRanges: _mathConstructRanges,
      mathCaretEntries: _mathCaretEntries,
      mathBreakpoints: _mathBreakpoints,
      ...rest
    } = segment;
    return {
      ...rest,
      text: text.slice(start, end),
      startOffset: segment.startOffset == null ? undefined : segment.startOffset + start,
      endOffset: segment.startOffset == null ? undefined : segment.startOffset + end,
      sourceStartRaw: documentSourceOffset(sourceProjection.start),
      sourceEndRaw: documentSourceOffset(sourceProjection.end),
      sourceRangePolicy: sourceProjection.policy,
      x: xStart,
      width: texLength(xEnd - xStart),
      caretStops: segment.caretStops?.slice(start, end + 1),
      mathConstructRanges: segment.mathConstructRanges?.map((range) =>
        remapLineMathConstructRangeReport(range, sourceMap)
      ),
      mathCaretEntries: segment.mathCaretEntries?.map((entry) =>
        remapLineMathCaretEntryReport(entry, sourceMap)
      ),
      mathBreakpoints: segment.mathBreakpoints?.map((breakpoint) =>
        remapLineMathBreakpointReport(breakpoint, sourceMap)
      ),
    };
  });
}

function canMergeProjectedTextChars(
  sourceMap: TextSourceMap,
  inputBase: number,
  groupStart: number,
  nextIndex: number
): boolean {
  const previous = projectInputRange(sourceMap, inputBase + nextIndex - 1, inputBase + nextIndex);
  const next = projectInputRange(sourceMap, inputBase + nextIndex, inputBase + nextIndex + 1);
  if (previous.kind !== "source-range" || next.kind !== "source-range") {
    return false;
  }
  return previous.policy === "caret" &&
    next.policy === "caret" &&
    previous.to === next.from &&
    projectInputRange(sourceMap, inputBase + groupStart, inputBase + nextIndex + 1).kind === "source-range";
}

function remapLineMathConstructRangeReport<Space extends SourceCoordinateSpace>(
  range: LineMathConstructRangeReport<Space>,
  sourceMap: TextSourceMap
): LineMathConstructRangeReport<"document"> {
  const sourceSpan = mapInputSpan(sourceMap, range.sourceStartRaw, range.sourceEndRaw);
  return {
    ...range,
    sourceStartRaw: documentSourceOffset(sourceSpan.start),
    sourceEndRaw: documentSourceOffset(sourceSpan.end)
  };
}

function remapLineMathCaretEntryReport<Space extends SourceCoordinateSpace>(
  entry: LineMathCaretEntryReport<Space>,
  sourceMap: TextSourceMap
): LineMathCaretEntryReport<"document"> {
  const sourceSpan = entry.sourceStartRaw == null || entry.sourceEndRaw == null
    ? null
    : mapInputSpan(sourceMap, entry.sourceStartRaw, entry.sourceEndRaw);
  const { sourceStartRaw: _sourceStartRaw, sourceEndRaw: _sourceEndRaw, ...rest } = entry;
  return {
    ...rest,
    sourceOffsetRaw: mapInputOffset(sourceMap, entry.sourceOffsetRaw),
    ...(sourceSpan ? {
      sourceStartRaw: documentSourceOffset(sourceSpan.start),
      sourceEndRaw: documentSourceOffset(sourceSpan.end),
    } : {})
  };
}

function remapLineMathBreakpointReport<Space extends SourceCoordinateSpace>(
  breakpoint: LineMathBreakpointReport<Space>,
  sourceMap: TextSourceMap
): LineMathBreakpointReport<"document"> {
  return {
    ...breakpoint,
    sourceOffsetRaw: mapInputOffset(sourceMap, breakpoint.sourceOffsetRaw)
  };
}

function remapBreakReport<Space extends SourceCoordinateSpace>(
  report: BreakReport<Space> | null,
  sourceMap: TextSourceMap
): BreakReport<"document"> | null {
  return report ? { ...report, sourceOffset: mapInputOffset(sourceMap, report.sourceOffset) } : null;
}

function remapPositionedTexVListItem(
  item: PositionedTexVListItem,
  sourceMap: TextSourceMap
): PositionedTexVListItem {
  return {
    ...item,
    item: remapTexVListItem(item.item, sourceMap),
    children: item.children?.map((child) => remapPositionedTexVListItem(child, sourceMap))
  };
}

function remapTexVListItem(item: TexVListItem, sourceMap: TextSourceMap): TexVListItem {
  const sourceSpan = item.sourceSpan ? mapTexSourceSpan(item.sourceSpan, sourceMap) : undefined;
  switch (item.kind) {
    case "paragraph":
      return {
        ...item,
        sourceSpan: sourceSpan ?? item.sourceSpan,
        paragraph: {
          ...item.paragraph,
          sourceSpan: mapTexSourceSpan(item.paragraph.sourceSpan, sourceMap)
        }
      };
    case "hbox":
      return {
        ...item,
        ...(sourceSpan ? { sourceSpan } : {}),
        box: remapTexHorizontalLayout(item.box, sourceMap)
      };
    case "vbox":
      return {
        ...item,
        ...(sourceSpan ? { sourceSpan } : {}),
        items: item.items.map((child) => remapTexVListItem(child, sourceMap))
      };
    case "display-math":
      return {
        ...item,
        sourceSpan: sourceSpan ?? item.sourceSpan,
        contentStart: mapInputOffset(sourceMap, item.contentStart),
        contentEnd: mapInputOffset(sourceMap, item.contentEnd),
        box: remapTexMathBox(item.box, sourceMap)
      };
    case "display-alignment":
      return {
        ...item,
        sourceSpan: sourceSpan ?? item.sourceSpan,
        contentStart: mapInputOffset(sourceMap, item.contentStart),
        contentEnd: mapInputOffset(sourceMap, item.contentEnd)
      };
    case "glue":
    case "penalty":
    case "rule":
      return {
        ...item,
        ...(sourceSpan ? { sourceSpan } : {})
      };
    case "placeholder":
      return {
        ...item,
        sourceSpan: sourceSpan ?? item.sourceSpan
      };
  }
}

function remapTexHorizontalLayout(
  layout: TexHorizontalLayout,
  sourceMap: TextSourceMap
): TexHorizontalLayout {
  return {
    ...layout,
    lines: layout.lines?.map((line) => remapTexLineBox(line, sourceMap)),
    hitMap: layout.hitMap ? remapTexHitMap(layout.hitMap, sourceMap) : undefined
  };
}

function remapTexLineBox(line: TexLineBox, sourceMap: TextSourceMap): TexLineBox {
  return {
    ...line,
    sourceSpan: line.sourceSpan ? mapTexSourceSpan(line.sourceSpan, sourceMap) : undefined
  };
}

function remapTexHitMap(hitMap: TexHitMap, sourceMap: TextSourceMap): TexHitMap {
  const sourceSpan = hitMap.sourceStart == null || hitMap.sourceEnd == null
    ? null
    : mapInputSpan(sourceMap, hitMap.sourceStart, hitMap.sourceEnd);
  const contentSpan = hitMap.contentStart == null || hitMap.contentEnd == null
    ? null
    : mapInputSpan(sourceMap, hitMap.contentStart, hitMap.contentEnd);
  return {
    ...hitMap,
    ...(sourceSpan ? { sourceStart: sourceSpan.start, sourceEnd: sourceSpan.end } : {}),
    ...(contentSpan ? { contentStart: contentSpan.start, contentEnd: contentSpan.end } : {}),
    constructRanges: hitMap.constructRanges?.map((range) => {
      const mapped = mapInputSpan(sourceMap, range.sourceStart, range.sourceEnd);
      return { ...range, sourceStart: mapped.start, sourceEnd: mapped.end };
    }),
    breakpoints: hitMap.breakpoints?.map((breakpoint) => ({
      ...breakpoint,
      sourceOffset: mapInputOffset(sourceMap, breakpoint.sourceOffset)
    }))
  };
}

function remapTexMathBox(box: TexMathBox, sourceMap: TextSourceMap): TexMathBox {
  const sourceSpan = mapInputSpan(sourceMap, box.sourceStart, box.sourceEnd);
  const contentSpan = mapInputSpan(sourceMap, box.contentStart, box.contentEnd);
  return {
    ...box,
    sourceStart: sourceSpan.start,
    sourceEnd: sourceSpan.end,
    contentStart: contentSpan.start,
    contentEnd: contentSpan.end,
    caretMap: box.caretMap
      ? {
          ...box.caretMap,
          sourceStart: sourceSpan.start,
          sourceEnd: sourceSpan.end,
          contentStart: contentSpan.start,
          contentEnd: contentSpan.end,
          entries: box.caretMap.entries.map((entry) => {
            const entrySpan = entry.sourceSpan
              ? mapInputSpan(sourceMap, entry.sourceSpan.start, entry.sourceSpan.end)
              : null;
            return {
              ...entry,
              sourceOffset: mapInputOffset(sourceMap, entry.sourceOffset),
              ...(entrySpan ? { sourceSpan: { start: entrySpan.start, end: entrySpan.end } } : {})
            };
          }),
          diagnostics: box.caretMap.diagnostics?.map((diagnostic) => {
            const diagnosticSpan = mapInputSpan(sourceMap, diagnostic.sourceSpan.start, diagnostic.sourceSpan.end);
            return {
              ...diagnostic,
              sourceSpan: { start: diagnosticSpan.start, end: diagnosticSpan.end }
            };
          })
        }
      : undefined,
    constructRanges: box.constructRanges?.map((range) => {
      const mapped = mapInputSpan(sourceMap, range.sourceStart, range.sourceEnd);
      return { ...range, sourceStart: mapped.start, sourceEnd: mapped.end };
    }),
    breakpoints: box.breakpoints?.map((breakpoint) => ({
      ...breakpoint,
      sourceOffset: mapInputOffset(sourceMap, breakpoint.sourceOffset)
    })),
    svgBody: box.svgBody ? remapSvgSourceDataAttributes(box.svgBody, sourceMap) : undefined,
    rootBox: box.rootBox ? remapTexMathBox(box.rootBox, sourceMap) : undefined
  };
}

function remapTexVListBoxLayoutReport(
  report: TexVListBoxLayoutReport,
  sourceMap: TextSourceMap
): TexVListBoxLayoutReport {
  const tree = report.tree.map((item) => remapTexVListBoxReportItem(item, sourceMap));
  return {
    ...report,
    tree,
    items: flattenTexVListBoxReportItems(tree)
  };
}

function remapTexVListBoxReportItem(
  item: TexVListBoxReportItem,
  sourceMap: TextSourceMap
): TexVListBoxReportItem {
  const sourceSpan = item.sourceSpan ? mapTexSourceSpan(item.sourceSpan, sourceMap) : undefined;
  return {
    ...item,
    ...(sourceSpan ? { sourceSpan } : {}),
    children: item.children?.map((child) => remapTexVListBoxReportItem(child, sourceMap)),
    displayMath: item.displayMath
      ? {
          ...item.displayMath,
          contentStart: mapInputOffset(sourceMap, item.displayMath.contentStart),
          contentEnd: mapInputOffset(sourceMap, item.displayMath.contentEnd)
        }
      : undefined
  };
}

function remapTexVListParagraphPlacement(
  placement: TexVListParagraphPlacement,
  sourceMap: TextSourceMap
): TexVListParagraphPlacement {
  return {
    ...placement,
    sourceSpan: mapTexSourceSpan(placement.sourceSpan, sourceMap)
  };
}

function mapTexSourceSpan(span: TexSourceSpan, sourceMap: TextSourceMap): TexSourceSpan {
  return mapInputSpan(sourceMap, span.start, span.end);
}

function mapInputSpan(sourceMap: TextSourceMap, start: number, end: number): TexSourceSpan {
  const hit = projectInputRange(sourceMap, start, end);
  if (hit.kind === "source-offset") {
    return { start: hit.offset, end: hit.offset };
  }
  if (hit.kind === "source-range") {
    return { start: hit.from, end: hit.to };
  }
  return { start, end };
}

function mapInputSpanWithPolicy(
  sourceMap: TextSourceMap,
  start: number,
  end: number
): TexSourceSpan & { readonly policy: "caret" | "select" | "macro" | "generated" | "unmapped" } {
  const hit = projectInputRange(sourceMap, start, end);
  if (hit.kind === "source-offset") {
    return { start: hit.offset, end: hit.offset, policy: "caret" };
  }
  if (hit.kind === "source-range") {
    return { start: hit.from, end: hit.to, policy: hit.policy };
  }
  return { start, end, policy: "unmapped" };
}

function mapInputOffset(sourceMap: TextSourceMap, offset: number) {
  const hit = projectInputOffset(sourceMap, offset);
  if (hit.kind === "source-offset") {
    return documentSourceOffset(hit.offset);
  }
  if (hit.kind === "source-range") {
    return documentSourceOffset(hit.from);
  }
  return documentSourceOffset(offset);
}

function remapSvgSourceDataAttributes(svgBody: string, sourceMap: TextSourceMap): string {
  return svgBody.replace(
    /data-source-start="(\d+)" data-source-end="(\d+)"/g,
    (_match, startRaw: string, endRaw: string) => {
      const mapped = mapInputSpan(sourceMap, Number(startRaw), Number(endRaw));
      return `data-source-start="${mapped.start}" data-source-end="${mapped.end}"`;
    }
  );
}

function flattenTexVListBoxReportItems(
  items: readonly TexVListBoxReportItem[]
): readonly TexVListBoxReportItem[] {
  return items.flatMap((item) => [
    item,
    ...flattenTexVListBoxReportItems(item.children ?? [])
  ]);
}
