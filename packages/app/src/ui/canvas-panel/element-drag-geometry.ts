import { pt, worldBounds } from "@tikz-editor/core/coords/index";
import {
  collectSelectionGeometryFromBounds,
  collectSourceWorldBounds,
  type SelectionGeometry
} from "@tikz-editor/core/edit/snapping";
import type { SceneElement } from "@tikz-editor/core/semantic/types";
import type { WorldBounds } from "../coords/types";
import type { ScopeOverlayIndex } from "./scope-overlay";

/** Use the same scope envelopes when starting a drag and validating its guides. */
export function collectElementDragGeometry(
  elements: SceneElement[],
  selectedIds: readonly string[],
  scopeOverlay: ScopeOverlayIndex
): SelectionGeometry | null {
  const sourceBounds = collectSourceWorldBounds(elements);
  const interactionBounds = new Map(sourceBounds);
  for (const scopeId of selectedIds) {
    if (!scopeOverlay.scopesById.has(scopeId)) continue;
    let merged: WorldBounds | null = null;
    for (const [sourceId, bounds] of sourceBounds) {
      if (!scopeOverlay.ancestorScopeIdsBySourceId.get(sourceId)?.includes(scopeId)) continue;
      merged = merged
        ? worldBounds(
            pt(Math.min(merged.minX, bounds.minX)), pt(Math.min(merged.minY, bounds.minY)),
            pt(Math.max(merged.maxX, bounds.maxX)), pt(Math.max(merged.maxY, bounds.maxY))
          )
        : bounds;
    }
    if (merged) interactionBounds.set(scopeId, { ...merged, sourceId: scopeId });
  }
  return collectSelectionGeometryFromBounds(interactionBounds, selectedIds);
}
