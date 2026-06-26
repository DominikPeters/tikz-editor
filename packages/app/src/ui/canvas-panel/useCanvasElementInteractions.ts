import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clientPoint, px, pt, worldBounds, worldVector } from "tikz-editor/coords/index";
import { buildSnapContext, collectSelectionGeometryFromBounds, collectSourceWorldBounds, type SnapBounds, type SnapGuideInput, type SnapLine, type SnapSettingsPatch } from "tikz-editor/edit/snapping";
import type { EditHandle, SceneElement } from "tikz-editor/semantic/types";
import type { ClientPoint, WorldBounds, WorldPoint } from "../coords/types";
import { resolveEligibleExplicitPath, type ExplicitPathAnalysis } from "tikz-editor/edit/path-editing";
import { closestPointOnLine, closestPointOnCubic } from "tikz-editor/edit/curve-math";
import type { CanvasTransform, ToolMode } from "../../store/types";
import { clientToWorldPoint } from "./geometry";
import { makeMergeKey, selectionAnchorRatioFromPoint } from "./panel-helpers";
import {
  isSourceWithinScope,
  type ScopeOverlayIndex,
  resolveFocusedScopeIdForSelection,
  resolveScopeAwarePointerDownTarget,
  resolveScopeAwarePointerUpDrillTarget
} from "./scope-overlay";
import type {
  ApplyActionWithFeedbackFn,
  CanvasDispatch,
  CanvasEditParseOptions,
  CanvasSnapshot,
  DragState,
  EditableTextTarget,
  SnapDebugLogInput,
  StateSetter,
  ValueSetter
} from "./types";
import type { HitRegion } from "./hit-regions";

export type UseCanvasElementInteractionsArgs = {
  svgResult: CanvasSnapshot["svg"];
  toolMode: ToolMode;
  selectedElementIds: ReadonlySet<string>;
  suppressNextBackgroundClickRef: MutableRefObject<boolean>;
  viewportRef: RefObject<HTMLDivElement | null>;
  beginCanvasTextInteraction: (event: ReactPointerEvent<SVGElement>, target: EditableTextTarget) => void;
  closeTextEditingSession: () => void;
  interactionSvgRef: RefObject<SVGSVGElement | null>;
  dispatch: CanvasDispatch;
  draggableSourceIds: ReadonlySet<string>;
  directManipulationDisabledReasonBySourceId?: ReadonlyMap<string, string>;
  snapshot: CanvasSnapshot;
  source: string;
  setWarning: StateSetter<string | null>;
  onBucketFillRegion: (region: HitRegion | undefined) => void;
  setSnapLines: StateSetter<SnapLine[]>;
  logSnapDebug: (input: SnapDebugLogInput) => void;
  snapGuideInput: SnapGuideInput;
  snapSettingsPatch: SnapSettingsPatch;
  canvasTransform: CanvasTransform;
  viewportWorldBounds: WorldBounds | null;
  setDragState: ValueSetter<DragState | null>;
  resolveEditableTextTarget: (targetId: string, region?: HitRegion) => EditableTextTarget | null;
  densePathSourceIds: ReadonlySet<string>;
  expandedDensePathSourceId: string | null;
  setExpandedDensePathSourceId: StateSetter<string | null>;
  scopeOverlay: ScopeOverlayIndex;
  focusedScopeId: string | null;
  applyActionWithFeedback: ApplyActionWithFeedbackFn;
  activeFigureId: string | null;
  parseOptions: CanvasEditParseOptions;
  onNodePositionTargetPick?: (targetId: string) => boolean;
};

function clientPointFromEvent(event: Pick<PointerEvent | ReactPointerEvent<SVGElement> | ReactMouseEvent<SVGElement>, "clientX" | "clientY">): ClientPoint {
  return clientPoint(px(event.clientX), px(event.clientY));
}

export function useCanvasElementInteractions(args: UseCanvasElementInteractionsArgs) {
  const {
    svgResult,
    toolMode,
    selectedElementIds,
    suppressNextBackgroundClickRef,
    viewportRef,
    beginCanvasTextInteraction,
    closeTextEditingSession,
    interactionSvgRef,
    dispatch,
    draggableSourceIds,
    directManipulationDisabledReasonBySourceId,
    snapshot,
    source,
    setWarning,
    onBucketFillRegion,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    setDragState,
    resolveEditableTextTarget,
    densePathSourceIds,
    expandedDensePathSourceId,
    setExpandedDensePathSourceId,
    scopeOverlay,
    focusedScopeId,
    applyActionWithFeedback,
    activeFigureId,
    parseOptions,
    onNodePositionTargetPick
  } = args;

  const pendingScopeDrillRef = useRef<{
    pointerId: number;
    startClient: ClientPoint;
    selectedScopeId: string;
    hitSourceId: string;
    dragIds: string[];
    moved: boolean;
    dragStarted: boolean;
  } | null>(null);
  const pendingTextInteractionRef = useRef<{
    pointerId: number;
    startClient: ClientPoint;
    targetId: string;
    textTarget: EditableTextTarget;
    dragIds: string[];
    wasSelectedOnWorldPointerDown: boolean;
    moved: boolean;
    dragStarted: boolean;
  } | null>(null);

  const startElementDrag = useCallback(
    (
      pointerId: number,
      world: WorldPoint,
      draggedIds: string[],
      options: { adornmentDragFromText?: boolean } = {}
    ) => {
      if (draggedIds.some((id) => !draggableSourceIds.has(id))) {
        const reason = draggedIds
          .map((id) => directManipulationDisabledReasonBySourceId?.get(id))
          .find((candidate): candidate is string => Boolean(candidate && candidate.trim().length > 0));
        if (reason) {
          setWarning(reason);
        }
        setSnapLines([]);
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-element",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "element",
          rawPoint: world,
          lines: []
        });
        return;
      }

      const snapExcludedSourceIds = collectSnapExcludedSourceIds(draggedIds, scopeOverlay, snapshot.scene?.elements);

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: snapExcludedSourceIds,
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      const worldBoundsBySource = snapshot.scene
        ? collectSourceWorldBounds(snapshot.scene.elements)
        : new Map<string, SnapBounds>();
      const worldInteractionBoundsBySource = new Map<string, SnapBounds>(worldBoundsBySource);
      for (const scopeId of scopeOverlay.scopesById.keys()) {
        let mergedBounds: WorldBounds | null = null;
        for (const [sourceId, sourceBounds] of worldBoundsBySource.entries()) {
          const ancestors = scopeOverlay.ancestorScopeIdsBySourceId.get(sourceId) ?? [];
          if (!ancestors.includes(scopeId)) {
            continue;
          }
          mergedBounds = mergedBounds
            ? worldBounds(
                pt(Math.min(mergedBounds.minX, sourceBounds.minX)),
                pt(Math.min(mergedBounds.minY, sourceBounds.minY)),
                pt(Math.max(mergedBounds.maxX, sourceBounds.maxX)),
                pt(Math.max(mergedBounds.maxY, sourceBounds.maxY))
              )
            : worldBounds(sourceBounds.minX, sourceBounds.minY, sourceBounds.maxX, sourceBounds.maxY);
        }
        if (!mergedBounds) {
          continue;
        }
        worldInteractionBoundsBySource.set(scopeId, Object.assign(worldBounds(
          mergedBounds.minX,
          mergedBounds.minY,
          mergedBounds.maxX,
          mergedBounds.maxY
        ), { sourceId: scopeId }));
      }

      const initialSelection = collectSelectionGeometryFromBounds(worldInteractionBoundsBySource, draggedIds);
      const selectionAnchorRatio = initialSelection
        ? selectionAnchorRatioFromPoint(initialSelection.bounds, world)
        : null;
      setSnapLines([]);

      setDragState({
        kind: "element",
        pointerId,
        elementIds: draggedIds,
        startWorld: world,
        adornmentDragFromText:
          draggedIds.length === 1 && draggedIds[0]?.startsWith("node-adornment:")
            ? options.adornmentDragFromText === true
            : undefined,
        lastAppliedTotalDelta: worldVector(pt(0), pt(0)),
        snapContext,
        initialSelection,
        selectionAnchorRatio,
        historyMergeKey: makeMergeKey(
          "drag-element",
          draggedIds.slice().sort().join(","),
          pointerId
        )
      });
      logSnapDebug({
        phase: "drag-start-element",
        snapshotMatchesSource: true,
        dragKind: "element",
        context: snapContext,
        rawPoint: world,
        lines: []
      });
    },
    [
      canvasTransform.scale,
      directManipulationDisabledReasonBySourceId,
      draggableSourceIds,
      logSnapDebug,
      scopeOverlay,
      setDragState,
      setSnapLines,
      setWarning,
      snapGuideInput,
      snapSettingsPatch,
      snapshot.scene,
      snapshot.source,
      source,
      viewportWorldBounds
    ]
  );

  useEffect(() => {
    function onWorldPointerMove(event: PointerEvent) {
      const pending = pendingScopeDrillRef.current;
      if (pending?.pointerId !== event.pointerId || pending.dragStarted) {
        return;
      }
      const clientPoint = clientPointFromEvent(event);
      const dx = clientPoint.x - pending.startClient.x;
      const dy = clientPoint.y - pending.startClient.y;
      if ((dx * dx) + (dy * dy) <= 16) {
        return;
      }
      pending.moved = true;
      if (pending.dragIds.length === 0 || !svgResult) {
        return;
      }
      const world = clientToWorldPoint(clientPoint, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }
      startElementDrag(event.pointerId, world, pending.dragIds);
      pending.dragStarted = true;
    }

    function onWorldPointerUp(event: PointerEvent) {
      const pending = pendingScopeDrillRef.current;
      if (pending?.pointerId !== event.pointerId) {
        return;
      }
      pendingScopeDrillRef.current = null;
      if (pending.moved) {
        return;
      }

      const selectedScopeId = selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
      if (!selectedScopeId || selectedScopeId !== pending.selectedScopeId) {
        return;
      }

      const drillTarget = resolveScopeAwarePointerUpDrillTarget({
        selectedScopeId,
        hitSourceId: pending.hitSourceId,
        scopeOverlay
      });
      if (!drillTarget || drillTarget === selectedScopeId) {
        return;
      }

      dispatch({ type: "SELECT", id: drillTarget, additive: false });
      dispatch({ type: "SET_FOCUSED_SCOPE", scopeId: resolveFocusedScopeIdForSelection(drillTarget, scopeOverlay) });
      setSnapLines([]);
    }

    function onTextWorldPointerMove(event: PointerEvent) {
      const pending = pendingTextInteractionRef.current;
      if (pending?.pointerId !== event.pointerId || pending.dragStarted) {
        return;
      }
      const clientPoint = clientPointFromEvent(event);
      const dx = clientPoint.x - pending.startClient.x;
      const dy = clientPoint.y - pending.startClient.y;
      if ((dx * dx) + (dy * dy) <= 16) {
        return;
      }
      pending.moved = true;
      if (!svgResult) {
        return;
      }
      const world = clientToWorldPoint(clientPoint, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }
      if (!pending.wasSelectedOnWorldPointerDown) {
        dispatch({ type: "SELECT", id: pending.targetId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(pending.targetId, scopeOverlay)
        });
      }
      closeTextEditingSession();
      startElementDrag(event.pointerId, world, pending.dragIds);
      pending.dragStarted = true;
    }

    function onTextWorldPointerUp(event: PointerEvent) {
      const pending = pendingTextInteractionRef.current;
      if (pending?.pointerId !== event.pointerId) {
        return;
      }
      pendingTextInteractionRef.current = null;
      if (pending.moved) {
        return;
      }
      dispatch({ type: "SELECT", id: pending.targetId, additive: false });
      dispatch({
        type: "SET_FOCUSED_SCOPE",
        scopeId: resolveFocusedScopeIdForSelection(pending.targetId, scopeOverlay)
      });
      beginCanvasTextInteraction(
        {
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          button: 0,
          detail: 1,
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId,
          currentTarget: {
            setPointerCapture() {
              // No-op for deferred text activation outside the original React event.
            }
          }
        } as unknown as ReactPointerEvent<SVGElement>,
        pending.textTarget
      );
    }

    window.addEventListener("pointermove", onWorldPointerMove);
    window.addEventListener("pointerup", onWorldPointerUp);
    window.addEventListener("pointercancel", onWorldPointerUp);
    window.addEventListener("pointermove", onTextWorldPointerMove);
    window.addEventListener("pointerup", onTextWorldPointerUp);
    window.addEventListener("pointercancel", onTextWorldPointerUp);
    return () => {
      window.removeEventListener("pointermove", onWorldPointerMove);
      window.removeEventListener("pointerup", onWorldPointerUp);
      window.removeEventListener("pointercancel", onWorldPointerUp);
      window.removeEventListener("pointermove", onTextWorldPointerMove);
      window.removeEventListener("pointerup", onTextWorldPointerUp);
      window.removeEventListener("pointercancel", onTextWorldPointerUp);
    };
  }, [beginCanvasTextInteraction, closeTextEditingSession, dispatch, interactionSvgRef, scopeOverlay, selectedElementIds, setSnapLines, startElementDrag, svgResult]);

  const onElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, targetId: string, region?: HitRegion) => {
      if (!svgResult) return;
      if (toolMode === "addBucket") {
        if (event.button !== 0) {
          return;
        }
        viewportRef.current?.focus({ preventScroll: true });
        closeTextEditingSession();
        event.preventDefault();
        event.stopPropagation();
        onBucketFillRegion(region);
        return;
      }
      if (toolMode !== "select") return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      const clientPoint = clientPointFromEvent(event);
      const hitSourceId = typeof region?.sourceId === "string" ? region.sourceId : targetId;
      const matrixEdgeSelection =
        region?.shape === "rect" && region.matrixEdgeSelection
          ? region.matrixEdgeSelection
          : null;
      const resolvedTargetId = resolveScopeAwarePointerDownTarget({
        hitTargetId: targetId,
        hitSourceId,
        scopeOverlay,
        focusedScopeId
      });

      viewportRef.current?.focus({ preventScroll: true });
      const alreadySelected = selectedElementIds.has(resolvedTargetId);

      if (event.button !== 0) {
        return;
      }

      if (onNodePositionTargetPick?.(resolvedTargetId)) {
        event.preventDefault();
        event.stopPropagation();
        suppressNextBackgroundClickRef.current = true;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      suppressNextBackgroundClickRef.current = true;

      if (!additiveSelection && matrixEdgeSelection && event.button === 0) {
        closeTextEditingSession();
        setExpandedDensePathSourceId(null);
        dispatch({ type: "SELECT_RANGE", ids: matrixEdgeSelection.selectionIds });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(matrixEdgeSelection.matrixSourceId, scopeOverlay)
        });
        setSnapLines([]);
        return;
      }

      const textTarget = resolvedTargetId === targetId ? resolveEditableTextTarget(targetId, region) : null;
      if (!additiveSelection && textTarget) {
        const draggedIds = alreadySelected && selectedElementIds.size > 0 ? [...selectedElementIds] : [resolvedTargetId];
        const supportsDeferredTextDrag = snapshot.editHandles.some(
          (handle: EditHandle) =>
            handle.sourceRef.sourceId === resolvedTargetId &&
            handle.kind === "node-position" &&
            handle.pathAttachmentContext != null
        );
        if (
          supportsDeferredTextDrag &&
          event.pointerType !== "touch" &&
          draggedIds.every((id) => draggableSourceIds.has(id))
        ) {
          pendingTextInteractionRef.current = {
            pointerId: event.pointerId,
            startClient: clientPoint,
            targetId: resolvedTargetId,
            textTarget,
            dragIds: draggedIds,
            wasSelectedOnWorldPointerDown: alreadySelected,
            moved: false,
            dragStarted: false
          };
        } else {
          dispatch({ type: "SELECT", id: targetId, additive: false });
          dispatch({
            type: "SET_FOCUSED_SCOPE",
            scopeId: resolveFocusedScopeIdForSelection(targetId, scopeOverlay)
          });
          beginCanvasTextInteraction(event, textTarget);
        }
        return;
      }

      const isAdornmentTarget = resolvedTargetId.startsWith("node-adornment:");
      closeTextEditingSession();

      // Keep dense-path expansion when re-clicking the same selected dense path.
      if (
        !additiveSelection &&
        !(expandedDensePathSourceId != null && resolvedTargetId === expandedDensePathSourceId)
      ) {
        setExpandedDensePathSourceId(null);
      }

      const singleSelectedId = selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
      const singleSelectedScopeId =
        singleSelectedId && scopeOverlay.scopesById.has(singleSelectedId) ? singleSelectedId : null;
      const shouldDeferScopeDrillToWorldPointerUp =
        !additiveSelection &&
        singleSelectedScopeId != null &&
        resolvedTargetId === singleSelectedScopeId &&
        isSourceWithinScope(singleSelectedScopeId, hitSourceId, scopeOverlay);

      const world = clientToWorldPoint(clientPoint, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: resolvedTargetId, additive: true });
        return;
      }

      if (shouldDeferScopeDrillToWorldPointerUp) {
        const canDragSelectedScope = draggableSourceIds.has(singleSelectedScopeId);
        pendingScopeDrillRef.current = {
          pointerId: event.pointerId,
          startClient: clientPoint,
          selectedScopeId: singleSelectedScopeId,
          hitSourceId,
          dragIds: canDragSelectedScope ? [singleSelectedScopeId] : [],
          moved: false,
          dragStarted: false
        };
        setSnapLines([]);
        return;
      }

      const draggedIds = alreadySelected && selectedElementIds.size > 0 ? [...selectedElementIds] : [resolvedTargetId];
      if (!alreadySelected) {
        dispatch({ type: "SELECT", id: resolvedTargetId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolvedTargetId, scopeOverlay)
        });
        if (isAdornmentTarget || event.pointerType === "touch") {
          // On touch: selecting an unselected element doesn't immediately start a drag;
          // the user can begin a new gesture to drag once it's selected.
          setSnapLines([]);
          return;
        }
      } else if (selectedElementIds.size === 1 && selectedElementIds.has(resolvedTargetId)) {
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolvedTargetId, scopeOverlay)
        });
      }

      const adornmentDragFromText =
        isAdornmentTarget &&
        region?.shape === "rect" &&
        typeof region.sceneTextKey === "string";
      startElementDrag(event.pointerId, world, draggedIds, { adornmentDragFromText });
    },
    [
      beginCanvasTextInteraction,
      dispatch,
      draggableSourceIds,
      focusedScopeId,
      interactionSvgRef,
      onBucketFillRegion,
      onNodePositionTargetPick,
      expandedDensePathSourceId,
      resolveEditableTextTarget,
      selectedElementIds,
      suppressNextBackgroundClickRef,
      setExpandedDensePathSourceId,
      setSnapLines,
      closeTextEditingSession,
      startElementDrag,
      scopeOverlay,
      snapshot.editHandles,
      svgResult,
      toolMode,
      viewportRef
    ]
  );

  const tryInsertPathWorldPoint = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string): boolean => {
      if (!svgResult || snapshot.source !== source) return false;

      const resolved = resolveEligibleExplicitPath(
        source,
        sourceId,
        parseOptions ?? {
          activeFigureId:
            activeFigureId ?? (snapshot.figures.length > 1 ? null : undefined)
        }
      );
      if (resolved.kind !== "eligible") return false;
      const analysis = resolved.analysis;

      const world = clientToWorldPoint(clientPointFromEvent(event), interactionSvgRef.current, svgResult.viewBox);
      if (!world) return false;

      const result = findClosestSegmentWorldPoint(snapshot.editHandles, sourceId, analysis, world);
      if (!result) return false;

      // Threshold: 12px screen distance
      const thresholdWorld = 12 / canvasTransform.scale;
      if (result.distance > thresholdWorld) return false;

      applyActionWithFeedback({
        kind: "insertPathPoint",
        elementId: sourceId,
        segmentIndex: result.segmentIndex,
        point: result.point
      });
      return true;
    },
    [svgResult, snapshot, source, parseOptions, activeFigureId, interactionSvgRef, canvasTransform.scale, applyActionWithFeedback]
  );

  const onElementDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGElement>, targetId: string, region?: HitRegion) => {
      if (toolMode !== "select") return;

      const sourceId = typeof region?.sourceId === "string" ? region.sourceId : targetId;
      const textTarget = resolveEditableTextTarget(targetId, region);

      event.preventDefault();
      event.stopPropagation();
      if (textTarget) {
        return;
      }
      viewportRef.current?.focus({ preventScroll: true });

      if (densePathSourceIds.has(sourceId)) {
        if (expandedDensePathSourceId === sourceId) {
          // Expanded dense paths should use double-click for point insertion first.
          if (tryInsertPathWorldPoint(event, sourceId)) {
            return;
          }
          // Missed insertion is a no-op; keep dense path expanded.
          return;
        }
        dispatch({ type: "SELECT", id: sourceId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(sourceId, scopeOverlay)
        });
        setExpandedDensePathSourceId(sourceId);
        closeTextEditingSession();
        return;
      }

      // Try to insert a point on a path segment
      if (tryInsertPathWorldPoint(event, sourceId)) {
        return;
      }
    },
    [
      dispatch,
      densePathSourceIds,
      scopeOverlay,
      setExpandedDensePathSourceId,
      closeTextEditingSession,
      toolMode,
      viewportRef,
      expandedDensePathSourceId,
      resolveEditableTextTarget,
      tryInsertPathWorldPoint
    ]
  );

  return {
    onElementPointerDown,
    onElementDoubleClick
  };
}

export function collectSnapExcludedSourceIds(
  draggedIds: readonly string[],
  scopeOverlay: ScopeOverlayIndex,
  sceneElements?: readonly SceneElement[]
): string[] {
  if (draggedIds.length === 0) {
    return [...draggedIds];
  }

  const selectedForSnap = new Set<string>(draggedIds);
  const draggedScopeIds = draggedIds.filter((id) => scopeOverlay.scopesById.has(id));
  if (draggedScopeIds.length > 0) {
    for (const [sourceId, ancestorScopeIds] of scopeOverlay.ancestorScopeIdsBySourceId.entries()) {
      if (draggedScopeIds.some((scopeId) => ancestorScopeIds.includes(scopeId))) {
        selectedForSnap.add(sourceId);
      }
    }
  }

  if (sceneElements && sceneElements.length > 0) {
    const candidateSourceIds = new Set(sceneElements.map((element) => element.sourceRef.sourceId));
    for (const candidateSourceId of candidateSourceIds) {
      for (const selectedSourceId of selectedForSnap) {
        if (isSyntheticTreeDescendantSourceId(candidateSourceId, selectedSourceId)) {
          selectedForSnap.add(candidateSourceId);
          break;
        }
      }
    }
  }

  return [...selectedForSnap];
}

function isSyntheticTreeDescendantSourceId(candidateSourceId: string, selectedSourceId: string): boolean {
  return candidateSourceId.startsWith(`${selectedSourceId}:tree-child:`);
}

function findClosestSegmentWorldPoint(
  editHandles: readonly EditHandle[],
  sourceId: string,
  analysis: ExplicitPathAnalysis,
  pointer: WorldPoint
): { segmentIndex: number; point: WorldPoint; distance: number } | null {
  let best: { segmentIndex: number; point: WorldPoint; distance: number } | null = null;

  for (let i = 0; i < analysis.segments.length; i++) {
    const seg = analysis.segments[i];
    const startW = resolveAnchorWorld(editHandles, sourceId, analysis.anchors[seg.startAnchorIndex]);
    const endW = resolveAnchorWorld(editHandles, sourceId, analysis.anchors[seg.endAnchorIndex]);
    if (!startW || !endW) continue;

    let closest: { point: WorldPoint };
    if (seg.kind === "line") {
      closest = closestPointOnLine(pointer, startW, endW);
    } else if (seg.kind === "cubic") {
      const c1Item = seg.control1Index != null ? analysis.statement.items[seg.control1Index] : null;
      const c2Item = seg.control2Index != null ? analysis.statement.items[seg.control2Index] : null;
      if (c1Item?.kind !== "Coordinate" || c2Item?.kind !== "Coordinate") continue;
      const c1W = resolveControlWorld(editHandles, sourceId, c1Item.span);
      const c2W = seg.usedAnd ? resolveControlWorld(editHandles, sourceId, c2Item.span) : c1W;
      if (!c1W || !c2W) continue;
      closest = closestPointOnCubic(pointer, startW, c1W, c2W, endW);
    } else {
      continue;
    }

    const dist = Math.hypot(closest.point.x - pointer.x, closest.point.y - pointer.y);
    if (!best || dist < best.distance) {
      best = { segmentIndex: i, point: closest.point, distance: dist };
    }
  }

  return best;
}

function resolveAnchorWorld(
  editHandles: readonly EditHandle[],
  sourceId: string,
  anchor: ExplicitPathAnalysis["anchors"][number]
): WorldPoint | null {
  const handle = editHandles.find(
    (h) =>
      h.sourceRef.sourceId === sourceId &&
      h.kind === "path-point" &&
      h.sourceRef.sourceSpan.from === anchor.item.span.from &&
      h.sourceRef.sourceSpan.to === anchor.item.span.to
  );
  return handle ? handle.world : null;
}

function resolveControlWorld(
  editHandles: readonly EditHandle[],
  sourceId: string,
  span: { from: number; to: number }
): WorldPoint | null {
  const handle = editHandles.find(
    (h) =>
      h.sourceRef.sourceId === sourceId &&
      h.kind === "path-control" &&
      h.sourceRef.sourceSpan.from === span.from &&
      h.sourceRef.sourceSpan.to === span.to
  );
  return handle ? handle.world : null;
}
