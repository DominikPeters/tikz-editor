import type { Span } from "../ast/types.js";
import { buildBeamerCaretStopDomain } from "./caret-stops.js";
import type {
  BeamerFrameLayoutItem,
  BeamerListItemTopology,
  BeamerListTopology,
  BeamerParagraphLayout,
  BeamerRect,
} from "./types.js";

/**
 * Selectable-object topology for one Beamer frame (design doc "Object
 * layer"): structural nodes with published geometry and stable-within-render
 * ids. Objects are never in front of text — they are reached by the Esc
 * ladder, caret traversal, or clicks on non-text renders. Environment-backed
 * kinds come from the frame layout items; list and item nodes are
 * synthesized from the engine-published list topology with bounds from the
 * caret-stop rows and list-marker geometry. Parent links follow source-span
 * nesting, which is exactly the Esc ladder order
 * (item → list → block → column → columns).
 */
export type BeamerObjectKind =
  | "block"
  | "columns"
  | "column"
  | "graphics"
  | "tikzpicture"
  | "list"
  | "item";

export type BeamerObjectListItemContext = {
  readonly list: BeamerListTopology;
  readonly item: BeamerListItemTopology;
  readonly index: number;
};

export type BeamerObjectNode = {
  readonly id: string;
  readonly kind: BeamerObjectKind;
  /** Full source extent; items span `\item` through their content end. */
  readonly sourceSpan: Span;
  /** Page-frame geometry in pt (union of rendered rows for list kinds). */
  readonly bounds: BeamerRect;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  /** Engine topology behind a `"list"` node. */
  readonly list?: BeamerListTopology;
  /** Engine topology behind an `"item"` node. */
  readonly listItem?: BeamerObjectListItemContext;
};

export type BeamerObjectIndex = {
  /** Sorted by `sourceSpan.from`, parents before their children. */
  readonly nodes: readonly BeamerObjectNode[];
  readonly byId: ReadonlyMap<string, BeamerObjectNode>;
  /**
   * List-marker layout item id → owning item object id. Markers carry the
   * label hbox's source range (the whole list), so clicking a bullet
   * resolves through this geometric association, not through source spans.
   */
  readonly objectIdByMarkerId: ReadonlyMap<string, string>;
};

const LAYOUT_OBJECT_KINDS: ReadonlySet<string> = new Set([
  "block",
  "columns",
  "column",
  "graphics",
  "tikzpicture",
]);

type MutableNode = {
  id: string;
  kind: BeamerObjectKind;
  sourceSpan: Span;
  bounds: BeamerRect | null;
  parentId: string | null;
  childIds: string[];
  list?: BeamerListTopology;
  listItem?: BeamerObjectListItemContext;
};

function unionRect(left: BeamerRect | null, right: BeamerRect): BeamerRect {
  if (!left) {
    return right;
  }
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(left.x + left.width, right.x + right.width) - x,
    height: Math.max(left.y + left.height, right.y + right.height) - y,
  };
}

function spanContains(outer: Span, inner: Span): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

function spanLength(span: Span): number {
  return span.to - span.from;
}

export function buildBeamerObjectIndex(args: {
  items: readonly BeamerFrameLayoutItem[];
  paragraphs: readonly BeamerParagraphLayout[];
  source: string;
}): BeamerObjectIndex {
  const nodes: MutableNode[] = [];

  for (const item of args.items) {
    if (!LAYOUT_OBJECT_KINDS.has(item.kind) || item.visibility === "hidden") {
      continue;
    }
    nodes.push({
      id: item.id,
      kind: item.kind as BeamerObjectKind,
      sourceSpan: item.sourceSpan,
      bounds: item.bounds,
      parentId: null,
      childIds: [],
    });
  }

  // List/item nodes: spans from the engine topology, geometry from the
  // rendered caret rows plus the marker boxes attached to each `\item`.
  const markers = args.items.filter(
    (item) => item.kind === "list-marker" && item.visibility !== "hidden"
  );
  const chromeParagraphIds = new Set(
    args.paragraphs
      .filter(
        (paragraph) =>
          paragraph.role === "headline" || paragraph.role === "footline"
      )
      .map((paragraph) => paragraph.paragraphId)
  );
  const domain = buildBeamerCaretStopDomain({
    paragraphs: args.paragraphs.filter(
      (paragraph) => !chromeParagraphIds.has(paragraph.paragraphId)
    ),
    source: args.source,
  });

  const objectIdByMarkerId = new Map<string, string>();
  for (const paragraph of args.paragraphs) {
    if (chromeParagraphIds.has(paragraph.paragraphId)) {
      continue;
    }
    // The item's first rendered row band, for marker association below.
    const firstRowBandById = new Map<string, { y: number; height: number }>();
    const paragraphItemNodes: MutableNode[] = [];
    const listRecords: { listId: string; list: BeamerListTopology; itemNodes: MutableNode[] }[] = [];
    for (const list of paragraph.listStructure ?? []) {
      const listId = `${paragraph.paragraphId}:list:${list.beginSpan.from}`;
      const itemNodes: MutableNode[] = [];
      for (let index = 0; index < list.items.length; index += 1) {
        const item = list.items[index];
        const span: Span = {
          from: item.commandSpan.from,
          to: item.contentSpan.to,
        };
        let bounds: BeamerRect | null = null;
        let firstRowBand: { y: number; height: number } | null = null;
        for (const row of domain.rows) {
          if (row.paragraphId !== paragraph.paragraphId) {
            continue;
          }
          let minX: number | null = null;
          let maxX = 0;
          for (const stop of row.stops) {
            if (stop.offset < span.from || stop.offset > span.to) {
              continue;
            }
            minX = minX == null ? stop.x : Math.min(minX, stop.x);
            maxX = Math.max(maxX, stop.x);
          }
          if (minX != null) {
            bounds = unionRect(bounds, {
              x: minX,
              y: row.y,
              width: Math.max(1, maxX - minX),
              height: row.height,
            });
            if (!firstRowBand || row.y < firstRowBand.y) {
              firstRowBand = { y: row.y, height: row.height };
            }
          }
        }
        if (!bounds) {
          // No rendered geometry on this step (covered overlay content):
          // the object cannot be shown or clicked, so it is not published.
          continue;
        }
        const node: MutableNode = {
          id: `${paragraph.paragraphId}:item:${item.commandSpan.from}`,
          kind: "item",
          sourceSpan: span,
          bounds,
          parentId: null,
          childIds: [],
          listItem: { list, item, index },
        };
        if (firstRowBand) {
          firstRowBandById.set(node.id, firstRowBand);
        }
        itemNodes.push(node);
        paragraphItemNodes.push(node);
      }
      if (itemNodes.length) {
        listRecords.push({ listId, list, itemNodes });
      }
    }
    // Markers carry the label hbox's source range (the whole list), so the
    // association is geometric: a marker belongs to the item on whose first
    // rendered line it sits. Nested items win over the outer item whose
    // content contains them because only one item's first line holds it.
    for (const marker of markers) {
      if (marker.parentId !== paragraph.paragraphId) {
        continue;
      }
      const centerY = marker.bounds.y + marker.bounds.height / 2;
      let best: MutableNode | null = null;
      let bestHeight = Number.POSITIVE_INFINITY;
      for (const node of paragraphItemNodes) {
        const band = firstRowBandById.get(node.id);
        if (!band || centerY < band.y - 1 || centerY > band.y + band.height + 1) {
          continue;
        }
        if (band.height < bestHeight) {
          best = node;
          bestHeight = band.height;
        }
      }
      if (best) {
        best.bounds = unionRect(best.bounds, marker.bounds);
        objectIdByMarkerId.set(marker.id, best.id);
      }
    }
    for (const record of listRecords) {
      let listBounds: BeamerRect | null = null;
      for (const node of record.itemNodes) {
        listBounds = unionRect(listBounds, node.bounds as BeamerRect);
      }
      nodes.push({
        id: record.listId,
        kind: "list",
        sourceSpan: { from: record.list.beginSpan.from, to: record.list.endSpan.to },
        bounds: listBounds,
        parentId: null,
        childIds: [],
        list: record.list,
      });
      nodes.push(...record.itemNodes);
    }
  }

  // Parent = the smallest strictly containing node span; this is the Esc
  // ladder relation (item → list → block → column → columns) computed
  // uniformly instead of per-kind.
  for (const node of nodes) {
    let parent: MutableNode | null = null;
    for (const candidate of nodes) {
      if (
        candidate === node ||
        !spanContains(candidate.sourceSpan, node.sourceSpan) ||
        spanLength(candidate.sourceSpan) === spanLength(node.sourceSpan)
      ) {
        continue;
      }
      if (
        !parent ||
        spanLength(candidate.sourceSpan) < spanLength(parent.sourceSpan)
      ) {
        parent = candidate;
      }
    }
    if (parent) {
      node.parentId = parent.id;
      parent.childIds.push(node.id);
    }
  }

  nodes.sort((left, right) => {
    if (left.sourceSpan.from !== right.sourceSpan.from) {
      return left.sourceSpan.from - right.sourceSpan.from;
    }
    return spanLength(right.sourceSpan) - spanLength(left.sourceSpan);
  });
  for (const node of nodes) {
    node.childIds.sort();
  }

  const finalNodes = nodes as unknown as BeamerObjectNode[];
  return {
    nodes: finalNodes,
    byId: new Map(finalNodes.map((node) => [node.id, node])),
    objectIdByMarkerId,
  };
}

/**
 * The innermost object whose source span contains `offset` — the Esc
 * ladder's first rung from a caret. Inclusive at both span ends, matching
 * caret conventions.
 */
export function beamerObjectAtOffset(
  index: BeamerObjectIndex,
  offset: number
): BeamerObjectNode | null {
  let best: BeamerObjectNode | null = null;
  for (const node of index.nodes) {
    if (node.sourceSpan.from > offset || offset > node.sourceSpan.to) {
      continue;
    }
    if (
      !best ||
      spanLength(node.sourceSpan) < spanLength(best.sourceSpan) ||
      (spanLength(node.sourceSpan) === spanLength(best.sourceSpan) &&
        node.sourceSpan.from > best.sourceSpan.from)
    ) {
      best = node;
    }
  }
  return best;
}
