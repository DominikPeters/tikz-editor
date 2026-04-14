import { useCallback, useEffect, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { buildSnapContext, snapToolPointer, type SnapLine } from "tikz-editor/edit/snapping";
import { type NodeAnchorTarget, type Point } from "tikz-editor/semantic/types";
import { resolveEndpointAnchorSnap } from "./endpoint-anchor-snap";
import { clientToWorldPoint, distanceSquared } from "./geometry";
import { createPathToolDraft, pathToolCloseRadiusWorld, pathToolCurrentPoint, pathToolShouldClose } from "./path-tool";
import { resolvePathEndpointSnap } from "./path-endpoint-snap";
import { createFreehandToolDraft } from "./freehand-tool";
import { isToolCreateMode } from "../tool-config";
import type { DragState, PendingTouchViewport } from "./types";

export type UseCanvasToolInteractionsArgs = {
  [key: string]: any;
};

export function useCanvasToolInteractions(args: UseCanvasToolInteractionsArgs) {
  const {
    viewportRef,
    resolveWorldFromViewportClient,
    toolMode,
    setTextEditingSession,
    startMarqueeSelection,
    pendingTouchViewportRef,
    suppressNextBackgroundClickRef,
    svgResult,
    setDragState,
    canvasTransform,
    interactionSvgRef,
    pendingBezier,
    snapshot,
    source,
    setWarning,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    viewportWorldBounds,
    nodeAnchorTargets,
    matrixCellAnchorHints,
    setToolCursorWorld,
    setPathDraft,
    setPathSegmentDraft,
    setToolDraft,
    setBezierBendDraft,
    setPendingBezier,
    setNodeAnchorOverlay,
    setFreehandDraft,
    setMagnifierState,
    setDragCursorLock,
    magnifierState,
    pathDraftRef,
    finalizePathDraft,
    queueSelectionForAddedElement,
    applyActionWithFeedback,
    pendingAddedSelectionRef,
    dispatch,
    selectedAddShape,
    selectedAddMatrixRows,
    selectedAddMatrixColumns,
    pathDraft,
    pathSegmentDraft,
    dragRef,
    toolDraft,
    bezierBendDraft,
    freehandDraft,
    parseOptions
  } = args;
  const beginToolPointerDown = useCallback(
    (input: {
      pointerId: number;
      world: Point;
      ctrlOrMeta: boolean;
      preventDefault: () => void;
      stopPropagation?: () => void;
    }) => {
      const { pointerId, world, ctrlOrMeta, preventDefault, stopPropagation } = input;
      if (toolMode === "addBucket") {
        setToolCursorWorld(null);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        setWarning("Cannot fill the tikzpicture background.");
        preventDefault();
        return;
      }
      const drawDragKind: DragState["kind"] =
        toolMode === "addPath"
          ? "tool-path-segment"
          : toolMode === "addFreehand"
            ? "tool-freehand"
          : toolMode === "addBezier" && pendingBezier
            ? "tool-bezier-bend"
            : "tool-create";
      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before starting a draw gesture.");
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-start",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: drawDragKind,
          rawPoint: world,
          lines: []
        });
        return;
      }
      const shouldSnapToolStart = toolMode !== "addFreehand";
      const toolSnapContext = shouldSnapToolStart && snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: [],
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      const startSnapResult = toolSnapContext && shouldSnapToolStart
        ? snapToolPointer({
            context: toolSnapContext,
            pointer: world,
            kind: toolMode === "addPath" ? "line-end" : "node",
            modifiers: { ctrlOrMeta }
          })
        : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
      const snappedStart = startSnapResult.snappedPoint ?? world;
      const lineToolStartAnchorSnap =
        toolMode === "addLine" || toolMode === "addArrow" || toolMode === "addPath"
          ? resolveEndpointAnchorSnap({
              pointerWorld: world,
              zoom: toolSnapContext?.zoom ?? canvasTransform.scale,
              nodeAnchorTargets,
              matrixCellAnchorHints
            })
          : null;
      const startEndpointAnchor = lineToolStartAnchorSnap?.snappedAnchor ?? null;
      const resolvedStart = startEndpointAnchor?.world ?? snappedStart;

      setToolCursorWorld(resolvedStart);
      preventDefault();

      if (toolMode === "addFreehand") {
        const nextFreehandDraft = createFreehandToolDraft(resolvedStart, canvasTransform.scale);
        setPathDraft(null);
        setPathSegmentDraft(null);
        setToolDraft(null);
        setBezierBendDraft(null);
        setPendingBezier(null);
        setSnapLines([]);
        setNodeAnchorOverlay(null);
        setFreehandDraft(nextFreehandDraft);
        const nextFreehandDrag: Extract<DragState, { kind: "tool-freehand" }> = {
          kind: "tool-freehand",
          pointerId,
          points: nextFreehandDraft.points,
          minSampleDistanceWorld: nextFreehandDraft.minSampleDistanceWorld
        };
        setDragState(nextFreehandDrag);
        logSnapDebug({
          phase: "tool-freehand-start",
          snapshotMatchesSource: true,
          dragKind: "tool-freehand",
          rawPoint: world,
          snappedPoint: resolvedStart,
          lines: []
        });
        return;
      }

      if (toolMode === "addPath") {
        const activeDraft = pathDraftRef.current;
        if (!activeDraft) {
          // Check if click is near an endpoint of an existing open path
          const endpointSnap = snapshot.editHandles.length > 0
            ? resolvePathEndpointSnap({
                pointerWorld: resolvedStart,
                zoom: canvasTransform.scale,
                editHandles: snapshot.editHandles,
                source,
                parseOptions
              })
            : null;
          const appendTarget = endpointSnap
            ? { elementId: endpointSnap.elementId, end: endpointSnap.end }
            : undefined;
          const draftStart = endpointSnap ? endpointSnap.world : resolvedStart;
          setPathDraft(
            createPathToolDraft(
              draftStart,
              appendTarget,
              endpointSnap || !startEndpointAnchor
                ? undefined
                : {
                    nodeName: startEndpointAnchor.nodeName,
                    anchor: startEndpointAnchor.anchor
                  }
            )
          );
          setPathSegmentDraft(null);
          setToolDraft(null);
          setBezierBendDraft(null);
          setSnapLines(startSnapResult.lines);
          logSnapDebug({
            phase: "tool-path-start",
            snapshotMatchesSource: true,
            dragKind: null,
            context: toolSnapContext,
            rawPoint: world,
            snappedPoint: draftStart,
            offset: startSnapResult.offset,
            lines: startSnapResult.lines
          });
          return;
        }

        const closeRadiusWorld = pathToolCloseRadiusWorld(canvasTransform.scale);
        if (pathToolShouldClose(activeDraft, resolvedStart, closeRadiusWorld)) {
          finalizePathDraft(true);
          return;
        }

        const segmentStart = pathToolCurrentPoint(activeDraft);
        if (distanceSquared(segmentStart, resolvedStart) <= 1e-6) {
          setSnapLines(startSnapResult.lines);
          return;
        }

        const midpoint = {
          x: (segmentStart.x + resolvedStart.x) / 2,
          y: (segmentStart.y + resolvedStart.y) / 2
        };
        const nextPathSegmentDraft: Extract<DragState, { kind: "tool-path-segment" }> = {
          kind: "tool-path-segment",
          pointerId,
          startWorld: segmentStart,
          endWorld: resolvedStart,
          endEndpointAnchor: startEndpointAnchor,
          startPointerWorld: resolvedStart,
          rawBendWorld: midpoint,
          bendWorld: midpoint,
          isBending: false,
          snapContext: toolSnapContext
        };
        setNodeAnchorOverlay(null);
        setToolDraft(null);
        setBezierBendDraft(null);
        setPathSegmentDraft(nextPathSegmentDraft);
        setDragState(nextPathSegmentDraft);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-path-segment-start",
          snapshotMatchesSource: true,
          dragKind: "tool-path-segment",
          context: toolSnapContext,
          rawPoint: world,
          snappedPoint: resolvedStart,
          offset: startSnapResult.offset,
          lines: startSnapResult.lines
        });
        return;
      }

      if (toolMode === "addBezier" && pendingBezier) {
        const bendSnap = toolSnapContext
          ? snapToolPointer({
              context: toolSnapContext,
              pointer: world,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        const bendStart = bendSnap.snappedPoint ?? world;
        setToolCursorWorld(bendStart);
        setSnapLines([]);
        const nextBendDraft: Extract<DragState, { kind: "tool-bezier-bend" }> = {
          kind: "tool-bezier-bend",
          pointerId,
          startWorld: pendingBezier.startWorld,
          endWorld: pendingBezier.endWorld,
          rawCurrentWorld: bendStart,
          currentWorld: bendStart,
          snapContext: toolSnapContext
        };
        setDragState(nextBendDraft);
        setBezierBendDraft(nextBendDraft);
        logSnapDebug({
          phase: "tool-bezier-bend-start",
          snapshotMatchesSource: true,
          dragKind: "tool-bezier-bend",
          context: toolSnapContext,
          rawPoint: world,
          snappedPoint: bendStart,
          offset: bendSnap.offset,
          lines: bendSnap.lines
        });
        return;
      }

      if (toolMode === "addNode" || toolMode === "addMatrix") {
        preventDefault();
        stopPropagation?.();
        const snapResult = toolSnapContext
            ? snapToolPointer({
                context: toolSnapContext,
                pointer: world,
                kind: "node",
                modifiers: { ctrlOrMeta }
              })
            : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        const nodeAt = snapResult.snappedPoint ?? world;
        setSnapLines(snapResult.lines);
        logSnapDebug({
          phase: "tool-add-node",
          snapshotMatchesSource: true,
          dragKind: null,
          context: toolSnapContext,
          rawPoint: world,
          snappedPoint: nodeAt,
          offset: snapResult.offset,
          lines: snapResult.lines
        });
        if (toolMode !== "addMatrix") {
          queueSelectionForAddedElement(nodeAt);
        }
        const ok = applyActionWithFeedback({
          kind: "addElement",
          template: toolMode === "addShape"
            ? { kind: "node", shape: selectedAddShape, text: "" }
            : toolMode === "addMatrix"
              ? {
                  kind: "matrix",
                  rows: selectedAddMatrixRows,
                  columns: selectedAddMatrixColumns,
                  matrixKind: "nodes"
                }
              : { kind: "node" },
          at: nodeAt
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }
        if (ok.sourceChanged) {
          suppressNextBackgroundClickRef.current = true;
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolDraft(null);
          setToolCursorWorld(null);
          setSnapLines([]);
        }
        return;
      }

      if (isToolCreateMode(toolMode)) {
        setSnapLines([]);
        const nextDraft: Extract<DragState, { kind: "tool-create" }> = {
          kind: "tool-create",
          pointerId,
          toolMode,
          startWorld: resolvedStart,
          startEndpointAnchor,
          rawCurrentWorld: resolvedStart,
          currentWorld: resolvedStart,
          activeEndpointAnchor: null,
          snapContext: toolSnapContext
        };
        setNodeAnchorOverlay(
          lineToolStartAnchorSnap && lineToolStartAnchorSnap.visibleAnchors.length > 0
            ? lineToolStartAnchorSnap
            : null
        );
        setBezierBendDraft(null);
        setDragState(nextDraft);
        setToolDraft(nextDraft);
        logSnapDebug({
          phase: "tool-start",
          snapshotMatchesSource: true,
          dragKind: "tool-create",
          context: toolSnapContext,
          rawPoint: world,
          snappedPoint: resolvedStart,
          lines: []
        });
      }
    },
    [
      applyActionWithFeedback,
      canvasTransform.scale,
      dispatch,
      finalizePathDraft,
      logSnapDebug,
      matrixCellAnchorHints,
      nodeAnchorTargets,
      parseOptions,
      pathDraftRef,
      pendingAddedSelectionRef,
      pendingBezier,
      queueSelectionForAddedElement,
      selectedAddMatrixColumns,
      selectedAddMatrixRows,
      selectedAddShape,
      setBezierBendDraft,
      setDragState,
      setFreehandDraft,
      setNodeAnchorOverlay,
      setPathDraft,
      setPathSegmentDraft,
      setPendingBezier,
      setSnapLines,
      setToolCursorWorld,
      setToolDraft,
      setWarning,
      snapGuideInput,
      snapSettingsPatch,
      snapshot.editHandles,
      snapshot.scene,
      snapshot.source,
      source,
      suppressNextBackgroundClickRef,
      toolMode,
      viewportWorldBounds
    ]
  );

  const finalizePendingTouchViewportTap = useCallback(
    (pointerId: number) => {
      const pending = pendingTouchViewportRef.current;
      if (!pending || pending.pointerId !== pointerId) return false;
      clearTimeout(pending.timer);
      pendingTouchViewportRef.current = null;
      if (!pending.additiveSelection) {
        dispatch({ type: "CLEAR_SELECTION" });
      }
      return true;
    },
    [dispatch, pendingTouchViewportRef]
  );

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const pending = pendingTouchViewportRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      const dx = event.clientX - pending.startClientX;
      const dy = event.clientY - pending.startClientY;
      if (dx * dx + dy * dy > 16) {
        clearTimeout(pending.timer);
        pendingTouchViewportRef.current = null;
        setDragState({
          kind: "pan",
          pointerId: pending.pointerId,
          startClientX: pending.startClientX,
          startClientY: pending.startClientY,
          startTransform: pending.startTransform
        });
      }
    }

    function onPointerUp(event: PointerEvent) {
      finalizePendingTouchViewportTap(event.pointerId);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      const pending = pendingTouchViewportRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        pendingTouchViewportRef.current = null;
      }
    };
  }, [finalizePendingTouchViewportTap, setDragState]);

  const onViewportPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      if (event.button !== 0 || event.target !== event.currentTarget) {
        return;
      }
      if (toolMode !== "select") {
        if (toolMode === "magnify") {
          return;
        }
        const world = resolveWorldFromViewportClient(event.clientX, event.clientY);
        if (!world) {
          return;
        }
        setTextEditingSession(null);
        beginToolPointerDown({
          pointerId: event.pointerId,
          world,
          ctrlOrMeta: event.ctrlKey || event.metaKey,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation()
        });
        return;
      }
      setTextEditingSession(null);
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      if (startMarqueeSelection(event.pointerId, event.clientX, event.clientY, additiveSelection)) {
        event.preventDefault();
      }
    },
    [beginToolPointerDown, resolveWorldFromViewportClient, setTextEditingSession, startMarqueeSelection, toolMode, viewportRef]
  );

  const onBackgroundClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement | SVGSVGElement>) => {
      if (suppressNextBackgroundClickRef.current) {
        suppressNextBackgroundClickRef.current = false;
        return;
      }
      if (toolMode !== "select" || event.target !== event.currentTarget) {
        return;
      }
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        return;
      }
      dispatch({ type: "CLEAR_SELECTION" });
    },
    [dispatch, suppressNextBackgroundClickRef, toolMode]
  );

  const onInteractionPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      setTextEditingSession(null);
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      if (!svgResult) return;

      if (toolMode === "magnify" && event.button === 0) {
        setNodeAnchorOverlay(null);
        setToolCursorWorld(null);
        setSnapLines([]);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Ignore capture failures; magnifier still works while the pointer remains over the canvas.
        }
        const viewport = viewportRef.current;
        if (!viewport) {
          return;
        }
        const rect = viewport.getBoundingClientRect();
        setMagnifierState({
          pointerId: event.pointerId,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        });
        setDragCursorLock("none");
        event.preventDefault();
        return;
      }

      const canPan = event.button === 1 || (event.button === 0 && event.altKey);
      if (canPan) {
        setDragState({
          kind: "pan",
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startTransform: canvasTransform
        });
        event.preventDefault();
        return;
      }

      if (event.button === 0 && toolMode !== "select") {
        const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
        if (!world) {
          return;
        }
        beginToolPointerDown({
          pointerId: event.pointerId,
          world,
          ctrlOrMeta: event.ctrlKey || event.metaKey,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation()
        });
        return;
      }

      if (toolMode === "select" && event.button === 0 && event.target === event.currentTarget) {
        if (event.pointerType === "touch") {
          const pending = pendingTouchViewportRef.current;
          if (!event.isPrimary || (pending && pending.pointerId !== event.pointerId)) {
            if (pending) {
              clearTimeout(pending.timer);
              pendingTouchViewportRef.current = null;
            }
            if (dragRef.current?.kind === "pan" || dragRef.current?.kind === "marquee") {
              setDragState(null);
            }
            event.preventDefault();
            return;
          }
          // On touch: moving immediately pans the canvas; marquee only opens after a long press.
          const touchPointerId = event.pointerId;
          const touchClientX = event.clientX;
          const touchClientY = event.clientY;
          const timer = setTimeout(() => {
            if (pendingTouchViewportRef.current?.pointerId === touchPointerId) {
              pendingTouchViewportRef.current = null;
              startMarqueeSelection(touchPointerId, touchClientX, touchClientY, additiveSelection);
            }
          }, 400);
          pendingTouchViewportRef.current = {
            pointerId: touchPointerId,
            startClientX: touchClientX,
            startClientY: touchClientY,
            additiveSelection,
            startTransform: canvasTransform,
            timer
          };
          event.preventDefault();
        } else {
          if (startMarqueeSelection(event.pointerId, event.clientX, event.clientY, additiveSelection)) {
            event.preventDefault();
          }
        }
      }
    },
    [
      applyActionWithFeedback,
      beginToolPointerDown,
      canvasTransform,
      dispatch,
      setDragState,
      svgResult,
      startMarqueeSelection,
      toolMode,
      interactionSvgRef,
      setMagnifierState,
      setDragCursorLock,
      setTextEditingSession,
      viewportRef,
      pendingTouchViewportRef
    ]
  );

  const onInteractionPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!svgResult || toolMode === "select") {
        setNodeAnchorOverlay(null);
        return;
      }
      if (toolMode === "magnify") {
        const magnifier = magnifierState;
        if (!magnifier || magnifier.pointerId !== event.pointerId) {
          setNodeAnchorOverlay(null);
          setToolCursorWorld(null);
          setSnapLines([]);
          return;
        }
        const viewport = viewportRef.current;
        if (!viewport) {
          return;
        }
        const rect = viewport.getBoundingClientRect();
        setMagnifierState({
          pointerId: magnifier.pointerId,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        });
        event.preventDefault();
        return;
      }
      if (toolMode === "addBucket") {
        setToolCursorWorld(null);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        return;
      }
      if (pathSegmentDraft) {
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        setNodeAnchorOverlay(null);
        return;
      }
      if (toolMode === "addFreehand") {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-move",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: dragRef.current?.kind ?? null,
          rawPoint: world,
          lines: []
        });
        return;
      }
      if (!snapshot.scene || snapshot.source !== source) {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-move",
          note: !snapshot.scene ? "no scene available" : "stale snapshot/source mismatch",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: null,
          rawPoint: world,
          lines: []
        });
        return;
      }

      const snapContext = buildSnapContext({
        sceneElements: snapshot.scene.elements,
        selectedSourceIds: [],
        guides: snapGuideInput,
        settings: snapSettingsPatch,
        zoom: canvasTransform.scale,
        viewportWorld: viewportWorldBounds
      });
      const snapped = snapToolPointer({
        context: snapContext,
        pointer: world,
        kind: toolMode === "addPath" ? "line-end" : "node",
        modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
      });
      const showNodeAnchors =
        !toolDraft &&
        !bezierBendDraft &&
        !pathSegmentDraft &&
        (toolMode === "addLine" || toolMode === "addArrow" || toolMode === "addPath");
      const hoverEndpointAnchorOverlay = showNodeAnchors
        ? resolveEndpointAnchorSnap({
            pointerWorld: world,
            zoom: snapContext.zoom,
            nodeAnchorTargets,
            matrixCellAnchorHints
          })
        : null;
      const hoverEndpointAnchor = hoverEndpointAnchorOverlay?.snappedAnchor ?? null;
      const hoverPathEndpoint =
        toolMode === "addPath" && !pathDraft && !pathSegmentDraft
          ? resolvePathEndpointSnap({
              pointerWorld: snapped.snappedPoint ?? world,
              zoom: canvasTransform.scale,
              editHandles: snapshot.editHandles,
              source,
              parseOptions
            })
          : null;
      const combinedOverlay = mergePathEndpointIntoOverlay(hoverEndpointAnchorOverlay, hoverPathEndpoint);
      setNodeAnchorOverlay(
        combinedOverlay && combinedOverlay.visibleAnchors.length > 0
          ? combinedOverlay
          : null
      );
      const closeCandidateWorld =
        toolMode === "addPath" &&
        pathDraft &&
        pathToolShouldClose(
          pathDraft,
          snapped.snappedPoint ?? world,
          pathToolCloseRadiusWorld(canvasTransform.scale)
        )
          ? pathDraft.startWorld
          : null;
      setToolCursorWorld(
        closeCandidateWorld ?? hoverPathEndpoint?.world ?? hoverEndpointAnchor?.world ?? snapped.snappedPoint ?? world
      );
      if (!toolDraft && !bezierBendDraft && !pathSegmentDraft) {
        setSnapLines(snapped.lines);
      }
      logSnapDebug({
        phase: "tool-hover-move",
        snapshotMatchesSource: true,
        dragKind: toolDraft ? "tool-create" : bezierBendDraft ? "tool-bezier-bend" : pathSegmentDraft ? "tool-path-segment" : null,
        context: snapContext,
        rawPoint: world,
        snappedPoint: snapped.snappedPoint ?? world,
        offset: snapped.offset,
        lines: snapped.lines
      });
    },
    [
      canvasTransform.scale,
      logSnapDebug,
      nodeAnchorTargets,
      matrixCellAnchorHints,
      snapshot.scene,
      snapshot.source,
      source,
      setNodeAnchorOverlay,
      svgResult,
      bezierBendDraft,
      pathDraft,
      pathSegmentDraft,
      toolDraft,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportWorldBounds,
      interactionSvgRef,
      dragRef,
      setSnapLines,
      setToolCursorWorld,
      parseOptions,
      magnifierState,
      setMagnifierState,
      viewportRef
    ]
  );

  const onInteractionPointerLeave = useCallback(() => {
    if (toolMode === "magnify") {
      if (!magnifierState) {
        setNodeAnchorOverlay(null);
        setToolCursorWorld(null);
        setSnapLines([]);
      }
      return;
    }
    if (toolMode === "select" || toolDraft || bezierBendDraft || pathSegmentDraft || freehandDraft) {
      return;
    }
    setNodeAnchorOverlay(null);
    setToolCursorWorld(null);
    setSnapLines([]);
  }, [bezierBendDraft, freehandDraft, magnifierState, pathSegmentDraft, setNodeAnchorOverlay, setSnapLines, setToolCursorWorld, toolDraft, toolMode]);

  const onInteractionPointerEnter = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!svgResult || toolMode === "select") {
        setNodeAnchorOverlay(null);
        return;
      }
      if (toolMode === "magnify") {
        if (!magnifierState || magnifierState.pointerId !== event.pointerId) {
          setNodeAnchorOverlay(null);
          setToolCursorWorld(null);
          setSnapLines([]);
        }
        return;
      }
      if (toolMode === "addBucket") {
        setToolCursorWorld(null);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        return;
      }
      if (pathSegmentDraft) {
        return;
      }
      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        setNodeAnchorOverlay(null);
        return;
      }
      if (toolMode === "addFreehand") {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-enter",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: dragRef.current?.kind ?? null,
          rawPoint: world,
          lines: []
        });
        return;
      }
      if (!snapshot.scene || snapshot.source !== source) {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-enter",
          note: !snapshot.scene ? "no scene available" : "stale snapshot/source mismatch",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: null,
          rawPoint: world,
          lines: []
        });
        return;
      }

      const snapContext = buildSnapContext({
        sceneElements: snapshot.scene.elements,
        selectedSourceIds: [],
        guides: snapGuideInput,
        settings: snapSettingsPatch,
        zoom: canvasTransform.scale,
        viewportWorld: viewportWorldBounds
      });
      const snapped = snapToolPointer({
        context: snapContext,
        pointer: world,
        kind: toolMode === "addPath" ? "line-end" : "node",
        modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
      });
      const showNodeAnchorsEnter =
        !toolDraft &&
        !bezierBendDraft &&
        !pathSegmentDraft &&
        (toolMode === "addLine" || toolMode === "addArrow" || toolMode === "addPath");
      const hoverEndpointAnchorOverlay = showNodeAnchorsEnter
        ? resolveEndpointAnchorSnap({
            pointerWorld: world,
            zoom: snapContext.zoom,
            nodeAnchorTargets,
            matrixCellAnchorHints
          })
        : null;
      const hoverEndpointAnchor = hoverEndpointAnchorOverlay?.snappedAnchor ?? null;
      const hoverPathEndpointEnter =
        toolMode === "addPath" && !pathDraft && !pathSegmentDraft
          ? resolvePathEndpointSnap({
              pointerWorld: snapped.snappedPoint ?? world,
              zoom: canvasTransform.scale,
              editHandles: snapshot.editHandles,
              source,
              parseOptions
            })
          : null;
      const combinedOverlayEnter = mergePathEndpointIntoOverlay(hoverEndpointAnchorOverlay, hoverPathEndpointEnter);
      setNodeAnchorOverlay(
        combinedOverlayEnter && combinedOverlayEnter.visibleAnchors.length > 0
          ? combinedOverlayEnter
          : null
      );
      const closeCandidateWorld =
        toolMode === "addPath" &&
        pathDraft &&
        pathToolShouldClose(
          pathDraft,
          snapped.snappedPoint ?? world,
          pathToolCloseRadiusWorld(canvasTransform.scale)
        )
          ? pathDraft.startWorld
          : null;
      setToolCursorWorld(
        closeCandidateWorld ?? hoverPathEndpointEnter?.world ?? hoverEndpointAnchor?.world ?? snapped.snappedPoint ?? world
      );
      if (!toolDraft && !bezierBendDraft && !pathSegmentDraft) {
        setSnapLines(snapped.lines);
      }
      logSnapDebug({
        phase: "tool-hover-enter",
        snapshotMatchesSource: true,
        dragKind: toolDraft ? "tool-create" : bezierBendDraft ? "tool-bezier-bend" : pathSegmentDraft ? "tool-path-segment" : null,
        context: snapContext,
        rawPoint: world,
        snappedPoint: snapped.snappedPoint ?? world,
        offset: snapped.offset,
        lines: snapped.lines
      });
    },
    [
      canvasTransform.scale,
      logSnapDebug,
      nodeAnchorTargets,
      matrixCellAnchorHints,
      snapshot.scene,
      snapshot.source,
      source,
      setNodeAnchorOverlay,
      svgResult,
      bezierBendDraft,
      pathDraft,
      pathSegmentDraft,
      toolDraft,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportWorldBounds,
      interactionSvgRef,
      dragRef,
      setSnapLines,
      setToolCursorWorld,
      parseOptions,
      magnifierState,
      toolMode
    ]
  );

  const onInteractionPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (toolMode === "magnify") {
        const magnifier = magnifierState;
        if (magnifier && magnifier.pointerId === event.pointerId) {
          setNodeAnchorOverlay(null);
          setToolCursorWorld(null);
          setSnapLines([]);
          setMagnifierState(null);
          setDragCursorLock(null);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }
      if (event.pointerType !== "touch") {
        return;
      }
      finalizePendingTouchViewportTap(event.pointerId);
    },
    [
      finalizePendingTouchViewportTap,
      magnifierState,
      setDragCursorLock,
      setMagnifierState,
      setNodeAnchorOverlay,
      setSnapLines,
      setToolCursorWorld,
      toolMode
    ]
  );

  const onInteractionLostPointerCapture = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (toolMode !== "magnify") {
        return;
      }
      const magnifier = magnifierState;
      if (!magnifier || magnifier.pointerId !== event.pointerId) {
        return;
      }
      setNodeAnchorOverlay(null);
      setToolCursorWorld(null);
      setSnapLines([]);
      setMagnifierState(null);
      setDragCursorLock(null);
    },
    [magnifierState, setDragCursorLock, setMagnifierState, setNodeAnchorOverlay, setSnapLines, setToolCursorWorld, toolMode]
  );

  const onViewportPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") {
        return;
      }
      finalizePendingTouchViewportTap(event.pointerId);
    },
    [finalizePendingTouchViewportTap]
  );

  return {
    onBackgroundClick,
    onViewportPointerDown,
    onViewportPointerUp,
    onInteractionPointerDown,
    onInteractionPointerUp,
    onInteractionLostPointerCapture,
    onInteractionPointerMove,
    onInteractionPointerLeave,
    onInteractionPointerEnter
  };
}

function mergePathEndpointIntoOverlay(
  nodeOverlay: { visibleAnchors: NodeAnchorTarget[]; snappedAnchor: NodeAnchorTarget | null } | null,
  pathEndpoint: { elementId: string; end: string; world: Point } | null
): { visibleAnchors: NodeAnchorTarget[]; snappedAnchor: NodeAnchorTarget | null } | null {
  if (!pathEndpoint && !nodeOverlay) return null;

  // Create a synthetic NodeAnchorTarget for the path endpoint
  const pathEndpointAnchor: NodeAnchorTarget | null = pathEndpoint
    ? {
        nodeName: `__path:${pathEndpoint.elementId}`,
        anchor: pathEndpoint.end,
        world: pathEndpoint.world,
        tier: "basic" as const
      }
    : null;

  const visibleAnchors = [
    ...(nodeOverlay?.visibleAnchors ?? []),
    ...(pathEndpointAnchor ? [pathEndpointAnchor] : [])
  ];

  // The snapped anchor: prefer path endpoint (it's the append target) over node anchors
  const snappedAnchor = pathEndpointAnchor ?? nodeOverlay?.snappedAnchor ?? null;

  return { visibleAnchors, snappedAnchor };
}
