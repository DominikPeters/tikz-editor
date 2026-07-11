import { useCallback, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { clientPoint as makeClientPoint, px } from "@tikz-editor/core/coords/index";
import type { EditHandle } from "@tikz-editor/core/semantic/types";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import type { ClientPoint } from "../coords/types";
import type { CanvasTransform } from "../../store/types";
import { resolveScopeAwareContextMenuTarget, type ScopeOverlayIndex } from "./scope-overlay";
import { clientToWorldPoint } from "./geometry";
import type { CanvasSnapshot } from "./types";
import type { HitRegion } from "./hit-regions";

export type UseCanvasSelectionInteractionsArgs = {
  openCanvasContextMenuAt: (clientPoint: ClientPoint, clickedSourceId: string | null, clickedHandleId?: string | null) => void;
  closeTextEditingSession: () => void;
  selectedElementIds: ReadonlySet<string>;
  scopeOverlay: ScopeOverlayIndex;
  focusedScopeId: string | null;
  snapshot: CanvasSnapshot;
  svgResult: CanvasSnapshot["svg"];
  interactionSvgRef: RefObject<SVGSVGElement | null>;
  canvasTransform: CanvasTransform;
};

export function useCanvasSelectionInteractions(args: UseCanvasSelectionInteractionsArgs) {
  const {
    openCanvasContextMenuAt,
    closeTextEditingSession,
    selectedElementIds,
    scopeOverlay,
    focusedScopeId,
    snapshot,
    svgResult,
    interactionSvgRef,
    canvasTransform
  } = args;

  const onElementContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: HitRegion, handleId?: string | null) => {
      event.preventDefault();
      event.stopPropagation();
      const hitSourceId = typeof region?.sourceId === "string" ? region.sourceId : sourceId;
      const resolvedSourceId = resolveScopeAwareContextMenuTarget({
        hitTargetId: sourceId,
        hitSourceId,
        selectedSourceIds: selectedElementIds,
        scopeOverlay,
        focusedScopeId
      });

      let resolvedHandleId = handleId ?? null;
      const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));
      if (!resolvedHandleId && resolvedSourceId && svgResult) {
        resolvedHandleId = findNearestPathPointHandle(
          clientPoint,
          resolvedSourceId,
          snapshot.editHandles,
          interactionSvgRef.current,
          svgResult.viewBox,
          canvasTransform.scale
        );
      }

      openCanvasContextMenuAt(clientPoint, resolvedSourceId, resolvedHandleId);
    },
    [focusedScopeId, openCanvasContextMenuAt, scopeOverlay, selectedElementIds, snapshot.editHandles, svgResult, interactionSvgRef, canvasTransform.scale]
  );

  const onCanvasContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement | HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      closeTextEditingSession();
      openCanvasContextMenuAt(makeClientPoint(px(event.clientX), px(event.clientY)), null);
    },
    [closeTextEditingSession, openCanvasContextMenuAt]
  );

  return {
    onElementContextMenu,
    onCanvasContextMenu
  };
}

/** Threshold in screen pixels for snapping right-click to nearest path-point handle. */
const CONTEXT_MENU_HANDLE_THRESHOLD_PX = 12;

function findNearestPathPointHandle(
  clientPoint: ClientPoint,
  sourceId: string,
  editHandles: readonly EditHandle[],
  svgElement: SVGSVGElement | null,
  viewBox: SvgViewBox,
  zoom: number
): string | null {
  const world = clientToWorldPoint(clientPoint, svgElement, viewBox);
  if (!world) return null;

  const thresholdWorld = CONTEXT_MENU_HANDLE_THRESHOLD_PX / zoom;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const handle of editHandles) {
    if (handle.sourceRef.sourceId !== sourceId || handle.kind !== "path-point") continue;
    const dist = Math.hypot(handle.world.x - world.x, handle.world.y - world.y);
    if (dist < bestDist && dist <= thresholdWorld) {
      bestDist = dist;
      bestId = handle.id;
    }
  }

  return bestId;
}
