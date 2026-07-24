import type {
  LaidParagraph,
  PositionedFrameFlowItem,
  PreparedFrameFlowItem,
} from "./render-model.js";

const TEX_LINE_SKIP_PT = 1;

/**
 * Position already-measured frame material using TeX's `\prevdepth` and
 * baseline-skip rules. Theme planning and paint are deliberately absent from
 * this module; callers provide only the active normal-text baseline skip.
 */
export function positionPreparedFrameFlow(
  flow: readonly PreparedFrameFlowItem[],
  baselineSkip: number,
  fillUnit = 0
): { items: PositionedFrameFlowItem[]; extent: number } {
  const items: PositionedFrameFlowItem[] = [];
  let cursor = 0;
  let previousDepth = 0;
  for (let index = 0; index < flow.length; index += 1) {
    const item = flow[index];
    if (item.kind === "title-page") {
      const contentTop =
        cursor + item.titlePage.leadingFillWeight * fillUnit;
      const visualBottom =
        contentTop + item.titlePage.naturalHeight;
      items.push({
        item,
        contentTop,
        referenceY: contentTop,
        visualTop: contentTop,
        visualBottom,
      });
      cursor =
        visualBottom + item.titlePage.trailingFillWeight * fillUnit;
      previousDepth = 0;
      continue;
    }
    if (item.kind === "vertical-space") {
      items.push({
        item,
        contentTop: cursor,
        referenceY: cursor,
        visualTop: cursor,
        visualBottom: cursor,
      });
      cursor += item.height;
      previousDepth = 0;
      continue;
    }
    if (item.kind === "paragraph") {
      const glue = verticalInterlineGlue(
        previousDepth,
        item.boxHeight,
        item.startingBaselineSkip
      ) + item.leadingAdjustment;
      const referenceY = cursor + glue + item.boxHeight;
      const contentTop = referenceY - item.boxHeight;
      const visualBottom = contentTop + item.naturalHeight;
      items.push({
        item,
        contentTop,
        referenceY,
        visualTop: contentTop,
        visualBottom,
      });
      cursor = visualBottom;
      previousDepth = item.endingDepth;
      if (
        item.trailingVerticalSpacePreviousDepth != null &&
        flow[index + 1]?.kind === "columns"
      ) {
        previousDepth = item.trailingVerticalSpacePreviousDepth;
      }
      continue;
    }
    if (item.kind === "block") {
      const glue = verticalInterlineGlue(
        previousDepth,
        item.boxHeight,
        baselineSkip
      );
      const referenceY = cursor + glue + item.boxHeight;
      const contentTop = referenceY - item.boxHeight;
      const visualBottom = contentTop + item.naturalHeight;
      items.push({
        item,
        contentTop,
        referenceY,
        visualTop: contentTop,
        visualBottom,
      });
      cursor = visualBottom + item.block.plan.geometry.afterSkipPt;
      previousDepth = item.endingDepth;
      continue;
    }
    if (item.kind === "tikzpicture") {
      const glue = verticalInterlineGlue(
        previousDepth,
        item.boxHeight,
        baselineSkip
      );
      const referenceY = cursor + glue + item.boxHeight;
      const contentTop = referenceY - item.boxHeight;
      const visualBottom = contentTop + item.naturalHeight;
      items.push({
        item,
        contentTop,
        referenceY,
        visualTop: contentTop,
        visualBottom,
      });
      cursor = visualBottom;
      previousDepth = item.endingDepth;
      continue;
    }
    const glue = verticalInterlineGlue(
      previousDepth,
      item.box.height,
      baselineSkip
    );
    const referenceY = cursor + glue + item.box.height;
    const columnTops = item.columns.map(
      (column) => referenceY - column.box.referenceFromContentTop
    );
    const visualTop = Math.min(...columnTops);
    const visualBottom = Math.max(
      ...item.columns.map(
        (column, columnIndex) =>
          columnTops[columnIndex] + column.naturalHeight
      )
    );
    items.push({
      item,
      contentTop: visualTop,
      referenceY,
      visualTop,
      visualBottom,
    });
    cursor = referenceY + item.box.depth;
    previousDepth = item.box.depth;
  }
  return { items, extent: cursor };
}

export function paragraphEndingMaterialDepth(
  paragraph: LaidParagraph
): number {
  const items = paragraph.layout.vlistLayout.boxReport.items;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    // TeX glue and penalties do not reset \prevdepth. This matters when a
    // list's trailing glue is followed by the default block template: the
    // block title line still computes its inter-line glue from the final
    // list hbox.
    if (item.itemKind === "glue" || item.itemKind === "penalty") {
      continue;
    }
    return Number(item.depth);
  }
  return 0;
}

export function paragraphStartingMaterialHeight(
  paragraph: LaidParagraph
): number {
  const first = paragraph.layout.vlistLayout.boxReport.items.find(
    (item) => item.itemKind !== "glue" && item.itemKind !== "penalty"
  );
  if (first?.itemKind === "hbox") {
    // A frame-leading display is preceded by Beamer's shipped empty line.
    // Its zero-sized hbox sits after one baseline of explicit vertical
    // material, so the outer frame vbox references the bottom of that prefix
    // rather than the ascent of the later first prose line.
    return Number(first.y + first.height);
  }
  const firstLine = paragraph.layout.report.lines[0];
  if (firstLine) {
    return Number(firstLine.ascent);
  }
  return Number(first?.height ?? paragraph.layout.vlistLayout.metrics.height);
}

export function previousDepthBeforeTrailingVerticalSpace(
  paragraph: LaidParagraph
): number | null {
  const items = paragraph.layout.vlistLayout.boxReport.items;
  const trailing = items.at(-1);
  if (
    trailing?.itemKind !== "glue" ||
    trailing.glue?.origin?.kind !== "explicit-command" ||
    trailing.glue.origin.command !== "vspace"
  ) {
    return null;
  }
  for (let index = items.length - 2; index >= 0; index -= 1) {
    const item = items[index];
    if (item.itemKind === "glue" || item.itemKind === "penalty") {
      continue;
    }
    if (
      item.itemKind === "hbox" &&
      item.hboxRole?.kind === "display-empty-line"
    ) {
      return Number(item.depth);
    }
    if (item.itemKind === "paragraph" || item.itemKind === "vbox") {
      return paragraphLastLineDepth(paragraph);
    }
    return Number(item.depth);
  }
  return 0;
}

export function trailingBeamerTrivlistSkip(source: string): number {
  const endPattern = /\\end\s*\{\s*(?:center|flushleft|flushright)\s*\}/gu;
  let lastEnd = -1;
  for (const match of source.matchAll(endPattern)) {
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd < 0) {
    return 0;
  }
  const suffix = source.slice(lastEnd);
  return /^(?:\s|\\vspace\*?\s*\{[^{}]*\})*$/u.test(suffix) ? 9 : 0;
}

export function trailingBeamerListSkip(source: string): number {
  const endPattern =
    /\\end\s*\{\s*(?:itemize|enumerate|description)\s*\}/gu;
  let lastEnd = -1;
  for (const match of source.matchAll(endPattern)) {
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd < 0) {
    return 0;
  }
  const suffix = source.slice(lastEnd);
  return /^(?:\s|\\vspace\*?\s*\{[^{}]*\})*$/u.test(suffix) ? 3 : 0;
}

export function leadingBeamerTrivlistAdjustment(
  source: string,
  paragraph: LaidParagraph
): number {
  if (
    !/\\begin\s*\{\s*(?:center|flushleft|flushright)\s*\}/u.test(source)
  ) {
    return 0;
  }
  const boundary = paragraph.layout.vlistLayout.boxReport.items.find(
    (item) =>
      item.itemKind === "glue" &&
      item.glue?.origin?.kind === "trivlist-boundary"
  );
  return Math.max(0, 9 - Number(boundary?.height ?? 9));
}

export function paragraphLastLineDepth(paragraph: LaidParagraph): number {
  return Number(paragraph.layout.report.lines.at(-1)?.descent ?? 0);
}

function verticalInterlineGlue(
  previousDepth: number,
  height: number,
  baselineSkip: number
): number {
  const candidate = baselineSkip - previousDepth - height;
  return candidate >= 0 ? candidate : TEX_LINE_SKIP_PT;
}
