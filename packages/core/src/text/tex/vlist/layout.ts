import { roundTexPt } from "../fonts/units.js";
import {
  texLength,
  texVListLocalX,
  texVListLocalY,
  texVListX,
  texVListY,
  translateTexVListX,
  type TexLength,
  type TexVListLocalX,
  type TexVListLocalY,
  type TexVListX,
  type TexVListY,
} from "../coordinates.js";
import type { TexParagraphAlignment } from "../ir.js";
import type {
  PositionedTexVListItem,
  TexBoxMetrics,
  TexGlueItem,
  TexGlueOrder,
  TexVBoxItem,
  TexVBoxBaseline,
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
  /** Inline displacement relative to the containing VList origin. */
  readonly x?: TexVListLocalX;
  readonly y?: TexVListY;
  readonly advance?: TexLength;
  /** Cursor movement measured from the incoming cursor, independent of y. */
  readonly cursorAdvance?: TexLength;
}

export type TexVListItemMeasurer = (
  item: TexVListItem,
  cursor: TexVListY,
  index: number,
  items: readonly TexVListItem[],
  path: readonly number[]
) => MeasuredTexVListItem | null;

interface TexVListLayoutContext {
  readonly inlineScopeWidth?: TexLength;
  readonly paragraphAlignment?: TexParagraphAlignment;
}

export function computeTexVListNaturalTotalHeight(
  items: readonly TexVListItem[],
  measureItem: TexVListItemMeasurer
): TexLength {
  return texLength(
    layoutTexVListItems(items, measureItem, null, texVListY(0)).cursor
  );
}

export function layoutTexVListItems(
  items: readonly TexVListItem[],
  measureItem: TexVListItemMeasurer,
  glueSet: TexVListGlueSet | null,
  startCursor: TexVListY,
  pathPrefix: readonly number[] = [],
  xOffset: TexVListX = texVListX(0),
  context: TexVListLayoutContext = {}
): { readonly positioned: readonly PositionedTexVListItem[]; readonly cursor: TexVListY } {
  const positioned: PositionedTexVListItem[] = [];
  let cursor = startCursor;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const path = [...pathPrefix, index];
    if (item.kind === "glue") {
      const size = texVListAdjustedGlueSize(item, glueSet);
      positioned.push({
        item,
        path,
        x: xOffset,
        y: cursor,
        metrics: {
          width: texLength(0),
          height: texLength(Math.max(0, size)),
          depth: texLength(0),
        },
      });
      cursor = texVListY(roundTexPt(cursor + size));
      continue;
    }

    const measured = measureItem(item, cursor, index, items, path) ?? measuredBoxMetricsForVListItem(item);
    if (measured) {
      const y = measured.y ?? cursor;
      const advance = measured.advance ?? measured.metrics.height + measured.metrics.depth;
      positioned.push({
        item,
        path,
        x: texVListX(roundTexPt(translateTexVListX(
          xOffset,
          measured.x ?? texVListLocalX(0)
        ))),
        y,
        metrics: measured.metrics,
      });
      cursor = measured.cursorAdvance === undefined
        ? texVListY(roundTexPt(y + advance))
        : texVListY(roundTexPt(cursor + measured.cursorAdvance));
      continue;
    }

    if (item.kind === "vbox") {
      const top = cursor;
      const itemX = texVListLocalX(materialVBoxInlineX(item, context));
      const nested = layoutTexVBoxItem(
        item,
        measureItem,
        top,
        path,
        texVListX(roundTexPt(translateTexVListX(xOffset, itemX))),
        context
      );
      positioned.push({
        item,
        path,
        x: texVListX(roundTexPt(translateTexVListX(xOffset, itemX))),
        y: top,
        metrics: nested.metrics,
        baseline: nested.baseline,
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
  top: TexVListY,
  path: readonly number[],
  xOffset: TexVListX,
  context: TexVListLayoutContext
): {
  readonly children: readonly PositionedTexVListItem[];
  readonly metrics: TexBoxMetrics;
  readonly baseline: TexVBoxBaseline;
  readonly cursor: TexVListY;
} {
  const leftMarginWidth = item.layout?.leftMarginWidth ?? texLength(0);
  const rightMarginWidth = item.layout?.rightMarginWidth ?? texLength(0);
  const targetWidth = finiteTexDimen(item.width);
  const childXOffset = texVListX(roundTexPt(translateTexVListX(
    xOffset,
    texVListLocalX(leftMarginWidth)
  )));
  const childScopeWidth = texVListChildInlineScopeWidth(
    context.inlineScopeWidth,
    targetWidth,
    leftMarginWidth,
    rightMarginWidth
  );
  const natural = layoutTexVListItems(
    item.items,
    measureItem,
    null,
    top,
    path,
    childXOffset,
    {
      ...context,
      ...(childScopeWidth !== undefined ? { inlineScopeWidth: childScopeWidth } : {}),
    }
  );
  const naturalHeight = texLength(roundTexPt(natural.cursor - top));
  const targetHeight = finiteTexDimen(item.height);
  const glueSet = texVListGlueSetForTargetHeight(
    item.items,
    naturalHeight,
    targetHeight
  );
  const laidOut = glueSet
    ? layoutTexVListItems(
        item.items,
        measureItem,
        glueSet,
        top,
        path,
        childXOffset,
        {
          ...context,
          ...(childScopeWidth !== undefined ? { inlineScopeWidth: childScopeWidth } : {}),
        }
      )
    : natural;
  const laidOutHeight = texLength(roundTexPt(laidOut.cursor - top));
  const advance = targetHeight ?? laidOutHeight;
  const childOffset = targetHeight === undefined
    ? texVListLocalY(0)
    : texVListRootVerticalOffset(laidOutHeight, targetHeight, item.alignment);
  const children = offsetPositionedTexVListItems(laidOut.positioned, childOffset);
  const cursor = texVListY(roundTexPt(top + advance));
  const baselineY = baselineYForVBox(children, top);
  return {
    children,
    metrics: metricsForVBox(
      children,
      top,
      cursor,
      xOffset,
      leftMarginWidth,
      rightMarginWidth,
      targetWidth
    ),
    baseline: baselineY === null
      ? { kind: "none" }
      : { kind: "explicit", y: texVListLocalY(roundTexPt(baselineY - top)) },
    cursor,
  };
}

function materialVBoxInlineX(
  item: TexVBoxItem,
  context: TexVListLayoutContext
): TexVListLocalX {
  if (!item.material) {
    return texVListLocalX(0);
  }
  const scopeWidth = context.inlineScopeWidth;
  const boxWidth = finiteTexDimen(item.width);
  if (scopeWidth === undefined || boxWidth === undefined) {
    return texVListLocalX(0);
  }
  const available = Math.max(0, scopeWidth - boxWidth);
  const alignment = context.paragraphAlignment;
  if (alignment === "ragged-left") {
    return texVListLocalX(roundTexPt(available));
  }
  if (alignment === "center") {
    return texVListLocalX(roundTexPt(available / 2));
  }
  return texVListLocalX(0);
}

function texVListChildInlineScopeWidth(
  inheritedWidth: TexLength | undefined,
  targetWidth: TexLength | undefined,
  leftMarginWidth: TexLength,
  rightMarginWidth: TexLength
): TexLength | undefined {
  const outerWidth = targetWidth ?? inheritedWidth;
  return outerWidth === undefined
    ? undefined
    : texLength(Math.max(0, outerWidth - leftMarginWidth - rightMarginWidth));
}

export function measuredBoxMetricsForVListItem(item: TexVListItem): MeasuredTexVListItem | null {
  if (item.kind === "placeholder") {
    return { metrics: item.estimated };
  }
  if (item.kind === "display-math") {
    return {
      x: texVListLocalX(Math.max(0, roundTexPt((item.targetWidth - item.box.width) / 2))),
      metrics: {
        width: item.box.width,
        height: item.box.height,
        depth: item.box.depth,
      },
    };
  }
  if (item.kind === "hbox") {
    return {
      x: item.x,
      metrics: item.box.metrics,
      advance: item.advance,
    };
  }
  if (item.kind === "penalty") {
    return {
      metrics: {
        width: texLength(0),
        height: texLength(0),
        depth: texLength(0),
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
  naturalHeight: TexLength,
  targetHeight: TexLength,
  verticalAlign: TexVListLayoutOptions["verticalAlign"]
): TexVListLocalY {
  const extra = Math.max(0, targetHeight - naturalHeight);
  if (extra === 0 || !verticalAlign || verticalAlign === "top") {
    return texVListLocalY(0);
  }
  if (verticalAlign === "center") {
    return texVListLocalY(roundTexPt(extra / 2));
  }
  return texVListLocalY(roundTexPt(extra));
}

export function offsetPositionedTexVListItems(
  items: readonly PositionedTexVListItem[],
  dy: TexVListLocalY
): readonly PositionedTexVListItem[] {
  if (dy === 0) {
    return items;
  }
  return items.map((item) => ({
    ...item,
    y: texVListY(roundTexPt(item.y + dy)),
    children: item.children
      ? offsetPositionedTexVListItems(item.children, dy)
      : undefined,
  }));
}

export function texVListGlueSetForTargetHeight(
  items: readonly TexVListItem[],
  naturalHeight: TexLength,
  targetHeight: TexLength | undefined
): TexVListGlueSet | null {
  if (!Number.isFinite(targetHeight) || targetHeight === undefined) {
    return null;
  }
  const delta = texLength(roundTexPt(targetHeight - naturalHeight));
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
    ? { sign: "shrink", order, ratio: Math.min((0 - delta) / amount, 1) }
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
): TexLength {
  return texVListGlueItems(items).reduce<TexLength>((sum, item) => {
    const itemOrder = sign === "stretch"
      ? item.stretchOrder ?? "normal"
      : item.shrinkOrder ?? "normal";
    if (itemOrder !== order) {
      return sum;
    }
    return texLength(
      sum + Math.max(0, sign === "stretch" ? item.stretch ?? 0 : item.shrink ?? 0)
    );
  }, texLength(0));
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
): TexLength {
  if (!glueSet) {
    return item.size;
  }
  if (glueSet.sign === "stretch") {
    const order = item.stretchOrder ?? "normal";
    if (order !== glueSet.order) {
      return item.size;
    }
    return texLength(item.size + Math.max(0, item.stretch ?? 0) * glueSet.ratio);
  }
  const order = item.shrinkOrder ?? "normal";
  if (order !== glueSet.order) {
    return item.size;
  }
  return texLength(item.size - Math.max(0, item.shrink ?? 0) * glueSet.ratio);
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

function finiteTexDimen(value: TexLength | string | undefined): TexLength | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function metricsForVBox(
  positioned: readonly PositionedTexVListItem[],
  top: TexVListY,
  bottom: TexVListY,
  xOffset: TexVListX = texVListX(0),
  leftMarginWidth: TexLength = texLength(0),
  rightMarginWidth: TexLength = texLength(0),
  targetWidth: TexLength | undefined = undefined
): TexBoxMetrics {
  const baselineY = baselineYForVBox(positioned, top) ?? top;
  const contentRight = Math.max(
    leftMarginWidth,
    ...positioned.map((item) => item.x - xOffset + item.metrics.width)
  );
  const naturalWidth = texLength(roundTexPt(contentRight + rightMarginWidth));
  const width = targetWidth ?? naturalWidth;
  return {
    width,
    height: texLength(roundTexPt(Math.max(0, baselineY - top))),
    depth: texLength(roundTexPt(Math.max(0, bottom - baselineY))),
  };
}

function baselineYForVBox(
  positioned: readonly PositionedTexVListItem[],
  top: TexVListY
): TexVListY | null {
  const firstBox = positioned.find((item) =>
    item.item.kind !== "glue" &&
    (item.item.kind !== "hbox" || item.item.affectsVBoxBaseline !== false)
  );
  if (!firstBox) {
    return null;
  }
  if (firstBox.baseline?.kind === "explicit") {
    return texVListY(roundTexPt(firstBox.y + firstBox.baseline.y));
  }
  if (firstBox.baseline?.kind === "none") {
    return top;
  }
  return texVListY(roundTexPt(firstBox.y + firstBox.metrics.height));
}

export function texVListBaselineY(
  firstLineTop: TexVListY | null,
  firstLineAscent: TexLength | null | undefined
): TexVListY | null {
  if (firstLineTop === null) {
    return null;
  }
  return texVListY(roundTexPt(firstLineTop + (firstLineAscent ?? texLength(0))));
}

export function metricsForRootBox(
  width: TexLength,
  totalHeight: TexLength,
  baselineY: TexVListY | null
): TexBoxMetrics {
  if (baselineY === null) {
    return { width, height: texLength(0), depth: totalHeight };
  }
  return {
    width,
    height: texLength(baselineY),
    depth: texLength(roundTexPt(Math.max(0, totalHeight - baselineY))),
  };
}
