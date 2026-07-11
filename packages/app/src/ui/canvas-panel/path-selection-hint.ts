import { resolveEligibleExplicitPath, type ExplicitPathAnalysis } from "@tikz-editor/core/edit/path-editing";
import type { EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { EditHandle, SceneElement } from "@tikz-editor/core/semantic/types";

export const DENSE_PATH_SEGMENT_THRESHOLD = 7;

export function collectDensePathSourceIds(elements: readonly SceneElement[] | null | undefined): Set<string> {
  const dense = new Set<string>();
  for (const element of elements ?? []) {
    if (element.kind !== "Path" || element.shapeHint != null) {
      continue;
    }
    let segmentCount = 0;
    for (const command of element.commands) {
      if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
        segmentCount += 1;
      }
    }
    if (segmentCount >= DENSE_PATH_SEGMENT_THRESHOLD) {
      dense.add(element.sourceRef.sourceId);
    }
  }
  return dense;
}

export function resolvePathSelectionHint(input: {
  source: string;
  selectedElementIds: ReadonlySet<string>;
  editHandles: readonly EditHandle[];
  elements: readonly SceneElement[] | null | undefined;
  collapsedDensePathSourceIds: ReadonlySet<string>;
  parseOptions: EditParseOptions;
}): string | null {
  const { source, selectedElementIds, editHandles, elements, collapsedDensePathSourceIds, parseOptions } = input;
  if (selectedElementIds.size !== 1) return null;
  const sourceId = [...selectedElementIds][0];
  const isNodeSource = editHandles.some(
    (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position"
  );
  if (isNodeSource) return null;
  const element = elements?.find((candidate) => candidate.sourceRef.sourceId === sourceId);
  if (element?.kind !== "Path") return null;
  const resolved = resolveEligibleExplicitPath(source, sourceId, parseOptions);
  if (resolved.kind !== "eligible") return null;
  if (resolved.analysis.segments.length === 0) return null;
  if (collapsedDensePathSourceIds.has(sourceId)) return "Double-click path to edit points.";
  if (!hasInsertablePathSegment(editHandles, sourceId, resolved.analysis)) return null;
  return "Double-click path to add a point.";
}

function hasInsertablePathSegment(
  editHandles: readonly EditHandle[],
  sourceId: string,
  analysis: ExplicitPathAnalysis
): boolean {
  const hasAnchorHandle = (anchorIndex: number) => {
    const anchor = analysis.anchors[anchorIndex];
    return Boolean(anchor && editHandles.some((handle) =>
      handle.sourceRef.sourceId === sourceId &&
      handle.kind === "path-point" &&
      handle.sourceRef.sourceSpan.from === anchor.item.span.from &&
      handle.sourceRef.sourceSpan.to === anchor.item.span.to
    ));
  };
  const hasControlHandle = (itemIndex: number | undefined) => {
    const item = itemIndex == null ? null : analysis.statement.items[itemIndex];
    return Boolean(item?.kind === "Coordinate" && editHandles.some((handle) =>
      handle.sourceRef.sourceId === sourceId &&
      handle.kind === "path-control" &&
      handle.sourceRef.sourceSpan.from === item.span.from &&
      handle.sourceRef.sourceSpan.to === item.span.to
    ));
  };

  return analysis.segments.some((segment) => {
    if (!hasAnchorHandle(segment.startAnchorIndex) || !hasAnchorHandle(segment.endAnchorIndex)) {
      return false;
    }
    if (segment.kind === "line") {
      return true;
    }
    return hasControlHandle(segment.control1Index) && (!segment.usedAnd || hasControlHandle(segment.control2Index));
  });
}
