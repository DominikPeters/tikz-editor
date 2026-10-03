import type { EditGeometrySession } from "@tikz-editor/core/edit/geometry-session";
import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clientPoint, px, pt, worldVector } from "@tikz-editor/core/coords/index";
import { buildSnapContext, type SnapGuideInput, type SnapLine, type SnapSettingsPatch } from "@tikz-editor/core/edit/snapping";
import type { Span } from "@tikz-editor/core/ast/types";
import { maskSourceOutsideSpan } from "@tikz-editor/core/document/masking";
import type { EditHandle, SceneElement } from "@tikz-editor/core/semantic/types";
import type { ClientPoint, WorldBounds, WorldPoint } from "../coords/types";
import { resolveEligibleExplicitPath, type ExplicitPathAnalysis } from "@tikz-editor/core/edit/path-editing";
import { closestPointOnLine, closestPointOnCubic } from "@tikz-editor/core/edit/curve-math";
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
import { parseWindowRootId } from "../../root-inventory";
import { collectElementDragGeometry } from "./element-drag-geometry";

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
  prepareEditGeometry: () => EditGeometrySession | undefined;
  nestedFigureSpan?: Span | null;
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
  activeRootId: string | null;
  parseOptions: CanvasEditParseOptions;
  onNodePositionTargetPick?: (targetId: string) => boolean;
  /** Deck object-layer selection for regions carrying a `deckObjectId`. */
  onDeckObjectSelect?: (objectId: string) => void;
  /** Double-click on a deck object region (nested figure entry). */
  onDeckObjectActivate?: (objectId: string) => void;
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
    prepareEditGeometry,
    nestedFigureSpan,
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
    activeRootId,
    parseOptions,
    onNodePositionTargetPick,
    onDeckObjectSelect,
    onDeckObjectActivate
  } = args;

  const lastDeckObjectPressRef = useRef<{ objectId: string; at: number } | null>(null);
  const pendingScopeDrillRef = useRef<{
    pointerId: number;
    startClient: ClientPoint;
    selectedScopeId: string;
    hitSourceId: string;
    dragIds: string[];
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
            dependencies: snapshot.semanticResult?.dependencies,
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      const initialSelection = collectElementDragGeometry(snapshot.scene?.elements ?? [], draggedIds, scopeOverlay);
      const selectionAnchorRatio = initialSelection
        ? selectionAnchorRatioFromPoint(initialSelection.bounds, world)
        : null;
      setSnapLines([]);

      setDragState({
        kind: "element",
        geometry: prepareEditGeometry(),
        pointerId,
        elementIds: draggedIds,
        startWorld: world,
        adornmentDragFromText:
          draggedIds.length === 1 && draggedIds[0]?.startsWith("node-adornment:")
            ? options.adornmentDragFromText === true
            : undefined,
        lastAppliedTotalDelta: worldVector(pt(0), pt(0)),
        baseline: {
          source: nestedFigureSpan ? maskSourceOutsideSpan(source, nestedFigureSpan) : source,
          editHandles: snapshot.editHandles,
          sourceFingerprint: parseOptions.sourceFingerprint
        },
        latestSource: source,
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
      nestedFigureSpan,
      parseOptions.sourceFingerprint,
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
      snapshot.editHandles,
      snapshot.semanticResult,
      snapshot.source,
      source,
      prepareEditGeometry,
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

    window.addEventListener("pointermove", onWorldPointerMove);
    window.addEventListener("pointerup", onWorldPointerUp);
    window.addEventListener("pointercancel", onWorldPointerUp);
    return () => {
      window.removeEventListener("pointermove", onWorldPointerMove);
      window.removeEventListener("pointerup", onWorldPointerUp);
      window.removeEventListener("pointercancel", onWorldPointerUp);
    };
  }, [dispatch, interactionSvgRef, scopeOverlay, selectedElementIds, setSnapLines, startElementDrag, svgResult]);

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
      if (
        region?.shape === "rect" &&
        region.deckObjectId != null &&
        onDeckObjectSelect &&
        event.button === 0
      ) {
        // Deck object layer: clicking chrome or a non-text render selects
        // the object instead of opening a text session.
        event.preventDefault();
        event.stopPropagation();
        suppressNextBackgroundClickRef.current = true;
        viewportRef.current?.focus({ preventScroll: true });
        closeTextEditingSession();
        // Chromium reports `detail: 0` on pointerdown, so double clicks are
        // detected by hand: a second press on the same object within the
        // double-click window activates it (nested figure entry for
        // embedded tikzpictures) instead of re-selecting.
        const now = performance.now();
        const previousPress = lastDeckObjectPressRef.current;
        lastDeckObjectPressRef.current = { objectId: region.deckObjectId, at: now };
        if (
          onDeckObjectActivate &&
          previousPress?.objectId === region.deckObjectId &&
          now - previousPress.at < 500
        ) {
          lastDeckObjectPressRef.current = null;
          onDeckObjectActivate(region.deckObjectId);
          return;
        }
        onDeckObjectSelect(region.deckObjectId);
        return;
      }
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
        dispatch({ type: "SELECT", id: targetId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(targetId, scopeOverlay)
        });
        beginCanvasTextInteraction(event, textTarget);
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
      onDeckObjectSelect,
      onDeckObjectActivate,
      expandedDensePathSourceId,
      resolveEditableTextTarget,
      selectedElementIds,
      suppressNextBackgroundClickRef,
      setExpandedDensePathSourceId,
      setSnapLines,
      closeTextEditingSession,
      startElementDrag,
      scopeOverlay,
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
          activeRootId: parseWindowRootId(activeRootId, snapshot.figures.length)
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
    [svgResult, snapshot, source, parseOptions, activeRootId, interactionSvgRef, canvasTransform.scale, applyActionWithFeedback]
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
