import type { Span } from "../ast/types.js";
import { getKnuthPlassParagraphCaretStops } from "../text/knuth-plass/index.js";
import type { BeamerListTopology, BeamerParagraphLayout } from "./types.js";

/**
 * Ordered rendered-caret-stop domain for one Beamer edit scope: the offsets
 * a canvas caret may occupy, with row geometry for vertical motion. Built
 * from the same stop pass the click hit-map uses, then gated by the scope's
 * editable spans (which already exclude hidden overlay content, list
 * chrome, and read-only macro-argument glyphs) and collapsed over atomic
 * render spans so arrow motion treats macro output and embedded objects as
 * single steps.
 */
export type BeamerCaretStop = {
  readonly offset: number;
  /** Page-frame x (paragraph bounds applied) in pt. */
  readonly x: number;
};

export type BeamerCaretRow = {
  readonly paragraphId: string;
  /** Page-frame top/height of the rendered line, in pt. */
  readonly y: number;
  readonly height: number;
  /** Sorted by x ascending, ties by offset; offsets unique per row. */
  readonly stops: readonly BeamerCaretStop[];
};

export type BeamerCaretDomainParagraph = {
  readonly paragraphId: string;
  readonly role: BeamerParagraphLayout["role"];
  readonly span: Span;
};

export type BeamerCaretDomain = {
  /** The source text the domain was built against. */
  readonly source: string;
  /** Rendered rows in vertical page order. */
  readonly rows: readonly BeamerCaretRow[];
  /** Global horizontal-motion domain: unique offsets in source order. */
  readonly offsets: readonly number[];
  /** Atomic spans (macro invocations, atomic renders), sorted by `from`. */
  readonly atomSpans: readonly Span[];
  /** Engine-published list topology across the scope, sorted by `beginSpan.from`. */
  readonly lists: readonly BeamerListTopology[];
  /** Rendered math islands (inline and display), sorted by `from`. */
  readonly mathSpans: readonly Span[];
  /** Per-paragraph role and span, for structural-key context checks. */
  readonly paragraphs: readonly BeamerCaretDomainParagraph[];
};

type MutableRow = {
  paragraphId: string;
  y: number;
  height: number;
  stops: { offset: number; x: number }[];
};

export function buildBeamerCaretStopDomain(args: {
  paragraphs: readonly BeamerParagraphLayout[];
  source: string;
}): BeamerCaretDomain {
  const rows: MutableRow[] = [];
  const offsetSet = new Set<number>();
  const atomByRange = new Map<string, Span>();
  const listByRange = new Map<string, BeamerListTopology>();
  const mathByRange = new Map<string, Span>();
  const paragraphs: BeamerCaretDomainParagraph[] = [];

  for (const paragraph of args.paragraphs) {
    paragraphs.push({
      paragraphId: paragraph.paragraphId,
      role: paragraph.role,
      span: paragraph.sourceSpan,
    });
    for (const list of paragraph.listStructure ?? []) {
      listByRange.set(`${list.beginSpan.from}:${list.endSpan.to}`, list);
    }
    for (const editable of paragraph.editableTextSpans) {
      if (editable.kind === "math" && editable.span.to > editable.span.from) {
        mathByRange.set(`${editable.span.from}:${editable.span.to}`, editable.span);
      }
    }
    const paragraphSpan = paragraph.sourceSpan;
    const sourceText = args.source.slice(paragraphSpan.from, paragraphSpan.to);
    if (!sourceText) {
      continue;
    }
    const atomSpans: Span[] = [
      ...paragraph.atomicRenderSpans.map((atom) => atom.span),
      ...(paragraph.macroArgumentRuns ?? []).map((run) => run.invocationSpan),
    ];
    for (const span of atomSpans) {
      if (span.to > span.from) {
        atomByRange.set(`${span.from}:${span.to}`, span);
        offsetSet.add(span.from);
        offsetSet.add(span.to);
      }
    }
    const editableSpans = paragraph.editableTextSpans.map((span) => span.span);
    if (!editableSpans.length && !atomSpans.length) {
      continue;
    }
    const stopLines = getKnuthPlassParagraphCaretStops({
      report: paragraph.report,
      sourceText,
      sourceTextStartOffset: paragraphSpan.from,
      vlistItems: paragraph.vlistLayout.items,
    });
    if (stopLines.error) {
      // A paragraph the hit map cannot align contributes no rendered stops;
      // callers fall back to source-style motion for it.
      continue;
    }
    const placementByLineIndex = new Map(
      paragraph.vlistLayout.linePlacements.map((placement) => [
        placement.lineIndex,
        placement,
      ])
    );
    const isCaretOffset = (offset: number): boolean => {
      if (offset < paragraphSpan.from || offset > paragraphSpan.to) {
        return false;
      }
      // Atom interiors collapse to their endpoints.
      for (const span of atomSpans) {
        if (span.from < offset && offset < span.to) {
          return false;
        }
      }
      if (editableSpans.some((span) => span.from <= offset && offset <= span.to)) {
        return true;
      }
      return atomSpans.some((span) => span.from === offset || span.to === offset);
    };

    for (const line of stopLines.lines) {
      let y: number;
      let height: number;
      if (line.kind === "display-math" && line.display) {
        y = paragraph.bounds.y + line.display.y;
        height = line.display.height;
      } else {
        const placement = placementByLineIndex.get(line.lineIndex);
        if (!placement) {
          continue;
        }
        y = paragraph.bounds.y + Number(placement.y);
        height = Math.max(1, Number(placement.height));
      }
      const seenOffsets = new Set<number>();
      const stops: { offset: number; x: number }[] = [];
      for (const stop of line.stops) {
        if (!isCaretOffset(stop.offset) || seenOffsets.has(stop.offset)) {
          continue;
        }
        seenOffsets.add(stop.offset);
        stops.push({ offset: stop.offset, x: paragraph.bounds.x + stop.x });
        offsetSet.add(stop.offset);
      }
      if (stops.length) {
        rows.push({ paragraphId: paragraph.paragraphId, y, height, stops });
      }
    }
  }

  rows.sort((left, right) => {
    if (Math.abs(left.y - right.y) > 0.5) {
      return left.y - right.y;
    }
    const leftX = left.stops[0]?.x ?? 0;
    const rightX = right.stops[0]?.x ?? 0;
    return leftX - rightX;
  });

  return {
    source: args.source,
    rows,
    offsets: [...offsetSet].sort((left, right) => left - right),
    atomSpans: [...atomByRange.values()].sort((left, right) => left.from - right.from),
    lists: [...listByRange.values()].sort(
      (left, right) => left.beginSpan.from - right.beginSpan.from
    ),
    mathSpans: [...mathByRange.values()].sort((left, right) => left.from - right.from),
    paragraphs,
  };
}

function nearestDomainIndex(offsets: readonly number[], offset: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (offsets[mid] < offset) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/**
 * The next caret offset in source order, or null at the domain edge. Atom
 * interiors are not in the domain, so traversal over macro output and
 * embedded objects is a single step by construction.
 */
export function nextBeamerCaretOffset(
  domain: BeamerCaretDomain,
  offset: number,
  direction: -1 | 1
): number | null {
  const offsets = domain.offsets;
  if (!offsets.length) {
    return null;
  }
  if (direction > 0) {
    const index = nearestDomainIndex(offsets, offset + 1);
    const candidate = offsets[index];
    return candidate != null && candidate > offset ? candidate : null;
  }
  const index = nearestDomainIndex(offsets, offset);
  if (offsets[index] < offset) {
    // Every domain offset is below `offset`; the last one is the previous stop.
    return offsets[index];
  }
  const candidate = offsets[index - 1];
  return candidate != null && candidate < offset ? candidate : null;
}

type RowPosition = { rowIndex: number; stopIndex: number };

/**
 * The row a caret at `offset` sits on. A line-boundary offset belongs to
 * two rows; prefer the row where it is the row start — the same preference
 * the caret overlay's offset→point mapping applies.
 */
export function beamerCaretRowForOffset(
  domain: BeamerCaretDomain,
  offset: number
): RowPosition | null {
  let best: RowPosition | null = null;
  let bestScore = -1;
  for (let rowIndex = 0; rowIndex < domain.rows.length; rowIndex += 1) {
    const stops = domain.rows[rowIndex].stops;
    for (let stopIndex = 0; stopIndex < stops.length; stopIndex += 1) {
      if (stops[stopIndex].offset !== offset) {
        continue;
      }
      const score = stopIndex === 0 ? 2 : stopIndex === stops.length - 1 ? 1 : 0;
      if (score > bestScore) {
        best = { rowIndex, stopIndex };
        bestScore = score;
      }
    }
  }
  return best;
}

function nearestStopInRow(row: BeamerCaretRow, x: number): BeamerCaretStop {
  let best = row.stops[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stop of row.stops) {
    const distance = Math.abs(stop.x - x);
    if (
      distance < bestDistance - 1e-6 ||
      (Math.abs(distance - bestDistance) <= 1e-6 && stop.offset < best.offset)
    ) {
      best = stop;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Vertical caret motion by rendered rows: the nearest-x stop on the
 * adjacent row, clamping to the row's start/end at the domain's edges
 * (textarea convention for first/last line).
 *
 * `goalX` is the sticky goal column: consecutive vertical presses pass the
 * returned `goalX` back in, so stepping through a short row does not decay
 * the horizontal position. Pass null when the caret arrived by any other
 * means (click, typing, horizontal motion) — the current stop's x becomes
 * the new goal. Clamping to a row edge is an explicit horizontal move and
 * resets the goal to the edge's x.
 */
export function verticalBeamerCaretOffset(
  domain: BeamerCaretDomain,
  offset: number,
  direction: -1 | 1,
  goalX: number | null = null
): { offset: number; goalX: number } | null {
  const position = beamerCaretRowForOffset(domain, offset);
  if (!position) {
    return null;
  }
  const row = domain.rows[position.rowIndex];
  const effectiveGoalX = goalX ?? row.stops[position.stopIndex].x;
  const targetRow = domain.rows[position.rowIndex + direction];
  if (!targetRow) {
    const edge = direction < 0 ? row.stops[0] : row.stops[row.stops.length - 1];
    return edge.offset === offset ? null : { offset: edge.offset, goalX: edge.x };
  }
  return {
    offset: nearestStopInRow(targetRow, effectiveGoalX).offset,
    goalX: effectiveGoalX,
  };
}

/** Home/End: the visual start/end stop of the caret's rendered row. */
export function beamerCaretRowEdgeOffset(
  domain: BeamerCaretDomain,
  offset: number,
  edge: "start" | "end"
): number | null {
  const position = beamerCaretRowForOffset(domain, offset);
  if (!position) {
    return null;
  }
  const stops = domain.rows[position.rowIndex].stops;
  return (edge === "start" ? stops[0] : stops[stops.length - 1]).offset;
}

/**
 * The atomic span a Backspace (side "before") or forward Delete (side
 * "after") at `offset` would bite into — the select-then-delete trigger.
 */
export function beamerCaretAtomBeside(
  domain: BeamerCaretDomain,
  offset: number,
  side: "before" | "after"
): Span | null {
  for (const span of domain.atomSpans) {
    if (side === "before" ? span.to === offset : span.from === offset) {
      return span;
    }
  }
  return null;
}

/** Clamp an arbitrary offset onto the nearest domain offset. */
export function nearestBeamerCaretOffset(
  domain: BeamerCaretDomain,
  offset: number
): number | null {
  const offsets = domain.offsets;
  if (!offsets.length) {
    return null;
  }
  const index = nearestDomainIndex(offsets, offset);
  const upper = offsets[Math.min(index, offsets.length - 1)];
  const lower = offsets[Math.max(0, index - 1)];
  return Math.abs(upper - offset) <= Math.abs(offset - lower) ? upper : lower;
}
