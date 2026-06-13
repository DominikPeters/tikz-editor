import { roundTexPt } from "../fonts/units.js";
import type {
  PositionedTexVListItem,
  TexBoxMetrics,
  TexGlueItem,
  TexGlueOrder,
  TexVBoxItem,
  TexVListItem,
  TexVListLayoutOptions,
} from "./types.js";

export interface TexVListGlueSet {
  readonly sign: "stretch" | "shrink";
  readonly order: TexGlueOrder;
  readonly ratio: number;
}

export interface MeasuredTexVListItem {
  readonly metrics: TexBoxMetrics;
  readonly y?: number;
  readonly advance?: number;
}

export type TexVListItemMeasurer = (
  item: TexVListItem,
  cursor: number,
  index: number,
  items: readonly TexVListItem[]
) => MeasuredTexVListItem | null;

export function computeTexVListNaturalTotalHeight(
  items: readonly TexVListItem[],
  measureItem: TexVListItemMeasurer
): number {
  return layoutTexVListItems(items, measureItem, null, 0).cursor;
}

export function layoutTexVListItems(
  items: readonly TexVListItem[],
  measureItem: TexVListItemMeasurer,
  glueSet: TexVListGlueSet | null,
  startCursor: number
): { readonly positioned: readonly PositionedTexVListItem[]; readonly cursor: number } {
  const positioned: PositionedTexVListItem[] = [];
  let cursor = startCursor;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.kind === "glue") {
      const size = texVListAdjustedGlueSize(item, glueSet);
      positioned.push({
        item,
        x: 0,
        y: cursor,
        metrics: {
          width: 0,
          height: Math.max(0, size),
          depth: 0,
        },
      });
      cursor = roundTexPt(cursor + size);
      continue;
    }

    const measured = measureItem(item, cursor, index, items) ?? measuredBoxMetricsForVListItem(item);
    if (measured) {
      const y = measured.y ?? cursor;
      const advance = measured.advance ?? measured.metrics.height + measured.metrics.depth;
      positioned.push({
        item,
        x: 0,
        y,
        metrics: measured.metrics,
      });
      cursor = roundTexPt(y + advance);
      continue;
    }

    if (item.kind === "vbox") {
      const top = cursor;
      const nested = layoutTexVBoxItem(item, measureItem, top);
      positioned.push({
        item,
        x: 0,
        y: top,
        metrics: nested.metrics,
        children: nested.children,
      });
      cursor = nested.cursor;
    }
  }
  return { positioned, cursor };
}

function layoutTexVBoxItem(
  item: TexVBoxItem,
  measureItem: TexVListItemMeasurer,
  top: number
): {
  readonly children: readonly PositionedTexVListItem[];
  readonly metrics: TexBoxMetrics;
  readonly cursor: number;
} {
  const natural = layoutTexVListItems(item.items, measureItem, null, top);
  const naturalHeight = roundTexPt(natural.cursor - top);
  const targetHeight = finiteTexDimen(item.height);
  const glueSet = texVListGlueSetForTargetHeight(
    item.items,
    naturalHeight,
    targetHeight
  );
  const laidOut = glueSet
    ? layoutTexVListItems(item.items, measureItem, glueSet, top)
    : natural;
  const laidOutHeight = roundTexPt(laidOut.cursor - top);
  const advance = targetHeight ?? laidOutHeight;
  const childOffset = targetHeight === undefined
    ? 0
    : texVListRootVerticalOffset(laidOutHeight, targetHeight, item.alignment);
  const children = offsetPositionedTexVListItems(laidOut.positioned, childOffset);
  const cursor = roundTexPt(top + advance);
  return {
    children,
    metrics: metricsForVBox(children, top, cursor),
    cursor,
  };
}

export function measuredBoxMetricsForVListItem(item: TexVListItem): MeasuredTexVListItem | null {
  if (item.kind === "placeholder") {
    return { metrics: item.estimated };
  }
  if (item.kind === "hbox") {
    return { metrics: item.box.metrics };
  }
  if (item.kind === "penalty") {
    return {
      metrics: {
        width: 0,
        height: 0,
        depth: 0,
      },
    };
  }
  if (item.kind === "rule") {
    return {
      metrics: {
        width: item.width,
        height: item.height,
        depth: item.depth,
      },
    };
  }
  return null;
}

export function texVListRootVerticalOffset(
  naturalHeight: number,
  targetHeight: number,
  verticalAlign: TexVListLayoutOptions["verticalAlign"]
): number {
  const extra = Math.max(0, targetHeight - naturalHeight);
  if (extra === 0 || !verticalAlign || verticalAlign === "top") {
    return 0;
  }
  if (verticalAlign === "center") {
    return roundTexPt(extra / 2);
  }
  return roundTexPt(extra);
}

export function offsetPositionedTexVListItems(
  items: readonly PositionedTexVListItem[],
  dy: number
): readonly PositionedTexVListItem[] {
  if (dy === 0) {
    return items;
  }
  return items.map((item) => ({
    ...item,
    y: roundTexPt(item.y + dy),
    children: item.children
      ? offsetPositionedTexVListItems(item.children, dy)
      : undefined,
  }));
}

export function texVListGlueSetForTargetHeight(
  items: readonly TexVListItem[],
  naturalHeight: number,
  targetHeight: number | undefined
): TexVListGlueSet | null {
  if (!Number.isFinite(targetHeight) || targetHeight === undefined) {
    return null;
  }
  const delta = roundTexPt(targetHeight - naturalHeight);
  if (delta === 0) {
    return null;
  }
  if (delta > 0) {
    const order = texVListHighestGlueOrder(items, "stretch");
    if (!order) {
      return null;
    }
    const amount = texVListGlueAmount(items, "stretch", order);
    return amount > 0
      ? { sign: "stretch", order, ratio: delta / amount }
      : null;
  }

  const order = texVListHighestGlueOrder(items, "shrink");
  if (!order) {
    return null;
  }
  const amount = texVListGlueAmount(items, "shrink", order);
  return amount > 0
    ? { sign: "shrink", order, ratio: Math.min(-delta / amount, 1) }
    : null;
}

function texVListHighestGlueOrder(
  items: readonly TexVListItem[],
  sign: "stretch" | "shrink"
): TexGlueOrder | null {
  let best: TexGlueOrder | null = null;
  for (const item of texVListGlueItems(items)) {
    const amount = sign === "stretch" ? item.stretch : item.shrink;
    if (!(amount && amount > 0)) {
      continue;
    }
    const order = sign === "stretch"
      ? item.stretchOrder ?? "normal"
      : item.shrinkOrder ?? "normal";
    if (!best || texGlueOrderRank(order) > texGlueOrderRank(best)) {
      best = order;
    }
  }
  return best;
}

function texVListGlueAmount(
  items: readonly TexVListItem[],
  sign: "stretch" | "shrink",
  order: TexGlueOrder
): number {
  return texVListGlueItems(items).reduce((sum, item) => {
    const itemOrder = sign === "stretch"
      ? item.stretchOrder ?? "normal"
      : item.shrinkOrder ?? "normal";
    if (itemOrder !== order) {
      return sum;
    }
    return sum + Math.max(0, sign === "stretch" ? item.stretch ?? 0 : item.shrink ?? 0);
  }, 0);
}

function texVListGlueItems(items: readonly TexVListItem[]): TexGlueItem[] {
  const glues: TexGlueItem[] = [];
  for (const item of items) {
    if (item.kind === "glue") {
      glues.push(item);
    }
  }
  return glues;
}

function texVListAdjustedGlueSize(
  item: TexGlueItem,
  glueSet: TexVListGlueSet | null
): number {
  if (!glueSet) {
    return item.size;
  }
  if (glueSet.sign === "stretch") {
    const order = item.stretchOrder ?? "normal";
    if (order !== glueSet.order) {
      return item.size;
    }
    return item.size + Math.max(0, item.stretch ?? 0) * glueSet.ratio;
  }
  const order = item.shrinkOrder ?? "normal";
  if (order !== glueSet.order) {
    return item.size;
  }
  return item.size - Math.max(0, item.shrink ?? 0) * glueSet.ratio;
}

function texGlueOrderRank(order: TexGlueOrder): number {
  if (order === "filll") {
    return 3;
  }
  if (order === "fill") {
    return 2;
  }
  if (order === "fil") {
    return 1;
  }
  return 0;
}

function finiteTexDimen(value: number | string | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function metricsForVBox(
  positioned: readonly PositionedTexVListItem[],
  top: number,
  bottom: number
): TexBoxMetrics {
  const firstBox = positioned.find((item) => item.item.kind !== "glue");
  const baselineY = firstBox
    ? firstBox.y + firstBox.metrics.height
    : top;
  const width = Math.max(0, ...positioned.map((item) => item.metrics.width));
  return {
    width,
    height: roundTexPt(Math.max(0, baselineY - top)),
    depth: roundTexPt(Math.max(0, bottom - baselineY)),
  };
}

export function texVListBaselineY(
  firstLineTop: number | null,
  firstLineAscent: number | null | undefined
): number | null {
  if (firstLineTop === null) {
    return null;
  }
  return roundTexPt(firstLineTop + (firstLineAscent ?? 0));
}

export function metricsForRootBox(
  width: number,
  totalHeight: number,
  baselineY: number | null
): TexBoxMetrics {
  if (baselineY === null) {
    return { width, height: 0, depth: totalHeight };
  }
  return {
    width,
    height: baselineY,
    depth: roundTexPt(Math.max(0, totalHeight - baselineY)),
  };
}
