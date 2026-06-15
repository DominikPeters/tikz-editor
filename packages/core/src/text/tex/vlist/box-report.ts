import { roundTexPt } from "../fonts/units.js";
import type {
  PositionedTexVListItem,
  TexBoxMetrics,
  TexSourceSpan,
  TexVListBoxLayoutReport,
  TexVListBoxReportItem,
} from "./types.js";

export function texVListBoxLayoutReport(
  items: readonly PositionedTexVListItem[],
  metrics: TexBoxMetrics,
  baseline: TexVListBoxLayoutReport["baseline"]
): TexVListBoxLayoutReport {
  const tree = items.map(texVListBoxReportTreeItem);
  return {
    kind: "tex-vlist-boxes",
    metrics,
    baseline,
    tree,
    items: flattenTexVListBoxReportItems(tree),
  };
}

function texVListBoxReportTreeItem(
  item: PositionedTexVListItem
): TexVListBoxReportItem {
  const report = texVListBoxReportItem(item);
  const children = item.children?.map(texVListBoxReportTreeItem) ?? [];
  return children.length > 0
    ? { ...report, children }
    : report;
}

function texVListBoxReportItem(
  item: PositionedTexVListItem
): Omit<TexVListBoxReportItem, "children"> {
  const sourceSpan = texVListItemSourceSpan(item);
  const report: TexVListBoxReportItem = {
    itemKind: item.item.kind,
    path: item.path ?? [],
    ...(sourceSpan ? { sourceSpan } : {}),
    x: item.x,
    y: item.y,
    width: item.metrics.width,
    height: item.metrics.height,
    depth: item.metrics.depth,
    totalHeight: roundTexPt(item.metrics.height + item.metrics.depth),
    ...(item.item.kind === "paragraph" ? { blockIndex: item.item.blockIndex } : {}),
    ...(item.item.kind === "vbox" && item.baseline ? { baseline: item.baseline } : {}),
    ...(item.item.kind === "hbox" && item.item.role ? { hboxRole: item.item.role } : {}),
    ...(item.item.kind === "vbox" && item.item.role ? { role: item.item.role } : {}),
    ...(item.item.kind === "vbox" && item.item.layout?.listItem
      ? { listItem: item.item.layout.listItem }
      : {}),
    ...(item.item.kind === "glue" ? {
      glue: {
        size: item.item.size,
        ...(item.item.stretch !== undefined ? { stretch: item.item.stretch } : {}),
        ...(item.item.shrink !== undefined ? { shrink: item.item.shrink } : {}),
        ...(item.item.stretchOrder !== undefined ? { stretchOrder: item.item.stretchOrder } : {}),
        ...(item.item.shrinkOrder !== undefined ? { shrinkOrder: item.item.shrinkOrder } : {}),
        ...(item.item.origin !== undefined ? { origin: item.item.origin } : {}),
      },
    } : {}),
    ...(item.item.kind === "penalty" ? { penalty: item.item.penalty } : {}),
    ...(item.item.kind === "placeholder" ? { placeholderReason: item.item.reason } : {}),
    ...(item.item.kind === "display-math" ? {
      displayMath: {
        delimiter: item.item.delimiter,
        contentStart: item.item.contentStart,
        contentEnd: item.item.contentEnd,
      },
    } : {}),
  };
  return report;
}

function flattenTexVListBoxReportItems(
  items: readonly TexVListBoxReportItem[]
): readonly TexVListBoxReportItem[] {
  const flat: TexVListBoxReportItem[] = [];
  for (const item of items) {
    const { children: _children, ...flatItem } = item;
    flat.push(flatItem);
    if (item.children?.length) {
      flat.push(...flattenTexVListBoxReportItems(item.children));
    }
  }
  return flat;
}

function texVListItemSourceSpan(
  item: PositionedTexVListItem
): TexSourceSpan | undefined {
  return "sourceSpan" in item.item ? item.item.sourceSpan : undefined;
}
