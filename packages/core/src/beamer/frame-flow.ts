import { requireArrayValue } from "../utils/collections.js";
import type {
  LaidParagraph,
  PositionedFrameFlowItem,
  PreparedFrameFlowItem,
} from "./render-model.js";
import { flattenPositionedTexVListItems } from "../text/tex/vlist/traversal.js";
import { tcolorboxSurroundingSpacing } from "./tcolorbox.js";

const TEX_LINE_SKIP_PT = 1;

/** TeX uses the size active at the end of the first paragraph. */
export function paragraphStartingBaselineSkip(paragraph: LaidParagraph, fallback: number): number {
  const first = flattenPositionedTexVListItems(paragraph.layout.vlistLayout.items)
    .find(positioned => positioned.item.kind === "paragraph" || positioned.item.kind === "display-math" || positioned.item.kind === "display-alignment");
  if (first?.item.kind === "display-math" || first?.item.kind === "display-alignment") {
    return Number(first.item.baselineSkip ?? fallback);
  }
  // In centering and ragged scopes `\\` ends the paragraph early: the glue above the
  // first line uses the baselineskip in force there, not at the paragraph's end.
  if (first?.item.kind !== "paragraph") return fallback;
  const value = first.item.paragraph.startingBaselineSkip ?? first.item.paragraph.baselineSkip;
  return value !== undefined ? Number(value) : fallback;
}

/**
 * `\vfill` glue in a frame-level paragraph chunk. The frame body is a vbox
 * set to the frame text height, so this glue stretches in proportion to its
 * order-2 weight, competing with the frame's own top/bottom skips
 * (beamerbaseframe.sty `\beamer@frametopskip`, `\beamer@framebottomskip`).
 * Beamer's body splitter makes `\vfill` lead its chunk, so only glue before
 * the first and after the last material box is placed; glue between boxes of
 * one chunk is not (it would need per-line shifting inside the paragraph).
 */
export function paragraphFillWeights(paragraph: LaidParagraph): { leading: number; trailing: number; materialless: boolean } {
  const items = paragraph.layout.vlistLayout.boxReport.items;
  const isMaterial = (kind: string) => kind !== "glue" && kind !== "penalty" && kind !== "vbox";
  const first = items.findIndex(item => isMaterial(item.itemKind));
  const last = items.reduce((found, item, index) => isMaterial(item.itemKind) ? index : found, -1);
  let leading = 0;
  let trailing = 0;
  for (const [index, item] of items.entries()) {
    if (item.itemKind !== "glue" || item.glue?.stretchOrder !== "fill") continue;
    const weight = Number(item.glue.stretch ?? 0);
    if (first < 0 || index < first) leading += weight;
    else if (index > last) trailing += weight;
  }
  return { leading, trailing, materialless: first < 0 };
}

/**
 * The `\parskip` glue TeX puts before an item of a vertical list that
 * something already precedes: each paragraph that starts (a text paragraph, or
 * a picture, whose box begins one) gets it. Columns start with `\par` and an
 * hbox in vertical mode, and blocks with `\par\vskip`, so neither does. A
 * picture inside a centering environment starts its paragraph inside the
 * trivlist: the list's `\@topsep` carries the parskip too (`\addvspace` of
 * `\@topsep` and of `-\parskip`; the second never merges away), so it counts twice.
 */
function paragraphSkipBefore(item: PreparedFrameFlowItem, parskipPt: number): number {
  if (item.kind === "paragraph") return paragraphFillWeights(item.paragraph).materialless ? 0 : parskipPt;
  if (item.kind === "tikzpicture") return item.surroundingGlue.top.naturalPt > 0 ? 2 * parskipPt : parskipPt;
  return 0;
}

/**
 * Position already-measured frame material using TeX's `\prevdepth` and
 * baseline-skip rules. Theme planning and paint are deliberately absent from
 * this module; callers provide only the active normal-text baseline skip.
 */
export function positionPreparedFrameFlow(
  flow: readonly PreparedFrameFlowItem[],
  baselineSkip: number,
  fillUnit = 0,
  initialPreviousDepth: number | null = 0,
  parskipPt = 0
): { items: PositionedFrameFlowItem[]; extent: number } {
  const items: PositionedFrameFlowItem[] = [];
  let cursor = 0;
  let previousDepth = initialPreviousDepth;
  for (const [index, item] of flow.entries()) {
    if (parskipPt !== 0 && index > 0) cursor += paragraphSkipBefore(item, parskipPt);
    if (item.kind === "contents") {
      const bottom = cursor + item.contents.naturalHeight + item.contents.fillWeight * fillUnit;
      items.push({ item, contentTop: cursor, referenceY: bottom, visualTop: cursor, visualBottom: bottom });
      cursor = bottom;
      previousDepth = 0;
      continue;
    }
    if (item.kind === "title-page") {
      // The template starts with an empty vbox. Its baseline glue consumes
      // the preceding depth, just like any other box in TeX's vertical list.
      const contentTop =
        cursor - (item.titlePage.plan.style === "colorbox" || item.titlePage.plan.style === "rounded" ? previousDepth ?? 0 : 0) + item.titlePage.leadingFillWeight * fillUnit;
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
      if (previousDepth != null) previousDepth = 0;
      continue;
    }
    if (item.kind === "unsupported") {
      const contentTop = cursor + (previousDepth == null ? 0 : TEX_LINE_SKIP_PT);
      const visualBottom = contentTop + item.height;
      items.push({
        item,
        contentTop,
        referenceY: visualBottom,
        visualTop: contentTop,
        visualBottom,
      });
      cursor = visualBottom;
      previousDepth = 0;
      continue;
    }
    if (item.kind === "paragraph") {
      const fill = paragraphFillWeights(item.paragraph);
      if (fill.materialless) {
        // Only vertical glue (`\vfill` chunk): no box, so no baselineskip
        // glue is inserted and \prevdepth is untouched.
        const contentTop = cursor;
        cursor += item.naturalHeight + (fill.leading + fill.trailing) * fillUnit;
        items.push({ item, contentTop, referenceY: contentTop, visualTop: contentTop, visualBottom: cursor });
        continue;
      }
      cursor += fill.leading * fillUnit;
      const firstBox = item.paragraph.layout.vlistLayout.boxReport.items.find(
        material => material.itemKind !== "glue" && material.itemKind !== "penalty" && material.itemKind !== "vbox"
      );
      // A leading display's empty line already includes its full baseline
      // skip in the measured paragraph prefix. Consume the preceding depth
      // there, rather than adding another minimum lineskip outside the box.
      const leadingDisplay = firstBox?.hboxRole?.kind === "display-empty-line" && firstBox.hboxRole.position === "before-display";
      const glue = (leadingDisplay
        ? -(previousDepth ?? 0)
        : verticalInterlineGlue(previousDepth, item.boxHeight, item.startingBaselineSkip)) + item.leadingAdjustment;
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
      cursor = visualBottom + fill.trailing * fillUnit;
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
      if (item.block.packageBox) {
        const previousItem = flow[index - 1];
        const previousBox = previousItem?.kind === "block" ? previousItem.block.packageBox : undefined;
        const spacing = tcolorboxSurroundingSpacing(item.block.packageBox.plan, { baselineSkipPt: baselineSkip, previousDepthPt: previousDepth,
          ...(previousBox && !previousBox.plan.noBeforeAfter ? { previousAfterSkipPt: previousBox.plan.afterSkipPt } : {}) });
        const contentTop = cursor + spacing.beforePt;
        const visualBottom = contentTop + item.naturalHeight;
        items.push({ item, contentTop, referenceY: visualBottom, visualTop: contentTop, visualBottom });
        cursor = visualBottom + spacing.afterPt;
        previousDepth = spacing.endingDepthPt;
        continue;
      }
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
      item.baselineSkip ?? baselineSkip
    );
    const referenceY = cursor + glue + item.box.height;
    const columnTops = item.columns.map(
      (column) => referenceY - column.box.referenceFromContentTop
    );
    const visualTop = Math.min(...columnTops);
    const visualBottom = Math.max(
      ...item.columns.map(
        (column, columnIndex) =>
          requireArrayValue(columnTops, columnIndex) + column.naturalHeight
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
    const item = requireArrayValue(items, index);
    // TeX glue and penalties do not reset \prevdepth. This matters when a
    // list's trailing glue is followed by the default block template: the
    // block title line still computes its inter-line glue from the final
    // list hbox.
    if (item.itemKind === "glue" || item.itemKind === "penalty") {
      continue;
    }
    if (item.itemKind === "paragraph" || item.itemKind === "vbox") {
      // A multi-line list item is reported as a nested vbox whose aggregate
      // depth includes every line below its reference baseline. TeX
      // `\prevdepth` after the list tracks only the final line's depth.
      return paragraphLastLineDepth(paragraph);
    }
    return Number(item.depth);
  }
  return 0;
}

export function paragraphStartingMaterialHeight(
  paragraph: LaidParagraph
): number {
  const first = paragraph.layout.vlistLayout.boxReport.items.find(
    (item) => item.itemKind !== "glue" && item.itemKind !== "penalty" && item.itemKind !== "vbox"
  );
  if (first?.itemKind === "hbox" && first.hboxRole?.kind !== "list-label") {
    // A frame-leading display is preceded by Beamer's shipped empty line.
    // Its zero-sized hbox sits after one baseline of explicit vertical
    // material, so the outer frame vbox references the bottom of that prefix
    // rather than the ascent of the later first prose line.
    return Number(first.hboxRole?.kind === "external-flow" ? first.height : first.y + first.height);
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
    const item = requireArrayValue(items, index);
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

export function trailingBeamerTrivlistSkip(source: string, topsepPt = 9): number {
  const endPattern = /\\end\s*\{\s*(?:center|flushleft|flushright|figure|table)\s*\}/gu;
  let lastEnd = -1;
  for (const match of source.matchAll(endPattern)) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < 0) {
    return 0;
  }
  const suffix = source.slice(lastEnd);
  return /^(?:\s|\}|\\par(?![A-Za-z@])|\\vspace\*?\s*\{[^{}]*\})*$/u.test(suffix) ? topsepPt : 0;
}

export function trailingBeamerListSkip(source: string, topsepPt = 3): number {
  const endPattern =
    /\\end\s*\{\s*(?:itemize|enumerate|description)\s*\}/gu;
  let lastEnd = -1;
  for (const match of source.matchAll(endPattern)) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < 0) {
    return 0;
  }
  const suffix = source.slice(lastEnd);
  return /^(?:\s|\}|\\par(?![A-Za-z@])|\\vspace\*?\s*\{[^{}]*\})*$/u.test(suffix) ? topsepPt : 0;
}

export function leadingBeamerTrivlistAdjustment(
  source: string,
  paragraph: LaidParagraph,
  topsepPt = 9
): number {
  if (
    !/\\begin\s*\{\s*(?:center|flushleft|flushright|figure|table)\s*\}/u.test(source)
  ) {
    return 0;
  }
  const boundary = paragraph.layout.vlistLayout.boxReport.items.find(
    (item) =>
      item.itemKind === "glue" &&
      item.glue?.origin?.kind === "trivlist-boundary"
  );
  const firstMaterial = paragraph.layout.vlistLayout.boxReport.items.find(item =>
    item.itemKind !== "glue" && item.itemKind !== "penalty" && item.itemKind !== "vbox");
  if (boundary && firstMaterial && boundary.y > firstMaterial.y) return 0;
  return Math.max(0, topsepPt - Number(boundary?.height ?? topsepPt));
}

export function paragraphLastLineDepth(paragraph: LaidParagraph): number {
  return Number(paragraph.layout.report.lines.at(-1)?.descent ?? 0);
}

function verticalInterlineGlue(
  previousDepth: number | null,
  height: number,
  baselineSkip: number
): number {
  if (previousDepth == null) return 0;
  // TeX compares assigned dimensions in scaled points, not binary floats.
  const candidate = baselineSkip - previousDepth - height;
  const assignedCandidate = Math.round(candidate * 65_536) / 65_536;
  return assignedCandidate >= 0 ? Math.max(0, candidate) : TEX_LINE_SKIP_PT;
}
