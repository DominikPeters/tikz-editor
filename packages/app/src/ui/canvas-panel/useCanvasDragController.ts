import { useEffect, useRef } from "react";
import type { AdornmentOwnerGeometry } from "tikz-editor/ast/types";
import {
  applyFrameTransform,
  frameLocalPoint,
  worldPoint,
  worldVector,
  worldBounds,
  worldTransform,
  clientPoint,
  pt,
  px
} from "tikz-editor/coords/index";
import { parseEditableTargetId } from "tikz-editor/edit/editable-targets";
import { formatNumber } from "tikz-editor/edit/format";
import { worldToLocal } from "tikz-editor/edit/coords";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import { intersectRayWithPolygon } from "tikz-editor/semantic/nodes/shape-geometry";
import {
  snapHandlePosition,
  snapSelectionTranslation,
  snapToolPointer,
  type SnapLine
} from "tikz-editor/edit/snapping";
import type { SceneElement } from "tikz-editor/semantic/types";
import type { WorldPoint, WorldVector } from "../coords/types";
import { applyMatrix, applyMatrixToVector, inverseMatrix } from "tikz-editor/semantic/transform";
import {
  closestPointOnPlacementSegment,
  pointAtPlacementSegment,
  resolveDraggedPathAttachedNodeDirection,
  resolvePathAttachedDirectionUnit,
  resolvePathPositionPreset,
  tangentAtPlacementSegment
} from "tikz-editor/semantic/path/path-attached";
import type { SvgViewBox } from "tikz-editor/svg/index";
import type { ClientPoint, WorldBounds } from "../coords/types";

import {
  boundsFromPoints,
  createBezierTemplateFromBend,
  createTemplateForToolDrag,
  DEFAULT_GRID_TOOL_STEP_PT,
  formatTooltipAngleRow,
  formatTooltipGridCountRow,
  formatTooltipLengthRows,
  formatToolCreateLengthRows,
  projectResizeDimensionsFromCenter,
  projectResizeDimensionsFromOppositeCorner,
  resolveFrameBasis,
  resolveHandleIdForDrag,
  resolveGridTooltipCounts,
  resolveToolCreateSize,
  snapPointDeltaToAxisStepMultiples,
  resolveToolCreateCurrentWorld
} from "./interaction-helpers";
import { resolveHandleDragAction, shouldCommitHandleAnchorOnPointerUp } from "./handle-drag-actions";
import { resolveEndpointAnchorSnap } from "./endpoint-anchor-snap";
import { clientToWorldPoint, distanceSquared, worldToSvgPoint } from "./geometry";
import { PATH_TOOL_BEND_DRAG_THRESHOLD_PX } from "./path-tool";
import { resolveAddShapeOriginFromDrag } from "./add-shape-draft";
import { angleDeg, normalizeSignedDeg, resolveDraggedRotateDeg } from "./rotate-handle";
import type { ResizeFrame } from "./resize-frames";
import { resolveScopeAwareMarqueeSelection } from "./scope-overlay";
import { toolCreateSnapKind } from "../tool-config";
import type {
  DragState,
  GridResizeSnapConfig
} from "./types";
import type { NodeAnchorOverlayState } from "./types";
import type { UseCanvasDragControllerParams } from "./useCanvasDragController.types";

const ROTATE_SHIFT_SNAP_STEP_DEG = 15;
const ROTATE_SOFT_SNAP_STEP_DEG = 90;
const ROTATE_SOFT_SNAP_THRESHOLD_DEG = 7;
const ADORNMENT_CENTER_SNAP_THRESHOLD_PT = 1;
const GRID_RESIZE_STEP_EPSILON = 1e-9;
const SNAP_FEEDBACK_EPSILON = 1e-6;
const ADORNMENT_OWNER_CENTER_EPSILON = 1e-6;
const MIN_SHAPE_DRAG_DIMENSION_PT = 0.1 * 28.4527559055;

function clientPointFromEvent(event: Pick<PointerEvent, "clientX" | "clientY">): ClientPoint {
  return clientPoint(px(event.clientX), px(event.clientY));
}

function makeWorldPoint(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

function makeWorldVector(x: number, y: number): WorldVector {
  return worldVector(pt(x), pt(y));
}

export function useCanvasDragController(params: UseCanvasDragControllerParams) {
  const {
    applyActionWithFeedback,
    dispatch,
    dispatchCanvasTransform,
    logSnapDebug,
    queueSelectionForAddedElement,
    snapshotSource,
    snapshotScene,
    snapshotEditHandles,
    nodeAnchorTargets,
    matrixCellAnchorHints,
    source,
    svgResult,
    dragRef,
    suppressNextBackgroundClickRef,
    svgResultRef,
    interactionSvgRef,
    liveResizeFramesRef,
    selectedElementIdsRef,
    sourceBoundsSvgRef,
    scopeOverlay,
    pendingAddedSelectionRef,
    setDragState,
    setSnapLines,
    setToolDraft,
    setBezierBendDraft,
    setPathSegmentDraft,
    commitPathToolSegment,
    appendFreehandSamplePoint,
    finalizeFreehandDraft,
    setPendingBezier,
    setToolCursorWorld,
    setMarqueeDraft,
    setNodeAnchorOverlay,
    setDragTooltip,
    setWarning,
    setPathAttachedNodePreview,
    selectedAddShape,
    creationStrokeColor,
    creationFillColor,
    onSnapFeedback
  } = params;
  const wasSnappedRef = useRef(false);

  useEffect(() => {
    function sameIdsAsCurrentSelection(ids: readonly string[]): boolean {
      const currentSelection = selectedElementIdsRef.current;
      if (currentSelection.size !== ids.length) {
        return false;
      }
      for (const id of ids) {
        if (!currentSelection.has(id)) {
          return false;
        }
      }
      return true;
    }

    function commitMarqueeSelection(
      drag: Extract<DragState, { kind: "marquee" }>,
      world: WorldPoint,
      currentSvg: { viewBox: SvgViewBox }
    ) {
      const selection = boundsFromPoints(
        worldToSvgPoint(drag.startWorld, currentSvg.viewBox),
        worldToSvgPoint(world, currentSvg.viewBox)
      );
      const hitIds = resolveScopeAwareMarqueeSelection({
        selectionBounds: selection,
        sourceBoundsById: sourceBoundsSvgRef.current,
        scopeOverlay
      });
      const nextIds = drag.additive
        ? [...new Set([...drag.baseSelectedIds, ...hitIds])]
        : hitIds;
      if (sameIdsAsCurrentSelection(nextIds)) {
        return;
      }
      dispatch({ type: "SELECT_RANGE", ids: nextIds });
    }

    function maybeTriggerSnapFeedback(snapped: boolean) {
      if (snapped && !wasSnappedRef.current) {
        onSnapFeedback?.();
      }
      wasSnappedRef.current = snapped;
    }

    function resetSnapFeedbackState() {
      wasSnappedRef.current = false;
    }

    function applyRotateDragUpdate(
      drag: Extract<DragState, { kind: "rotate" }>,
      input: {
        phase: string;
        shiftKey: boolean;
        ctrlOrMetaKey: boolean;
        altKey: boolean;
        tooltipAnchor: ClientPoint;
        rawPoint: WorldPoint;
      }
    ) {
      setNodeAnchorOverlay(null);
      setSnapLines([]);
      maybeTriggerSnapFeedback(false);
      const rotateMode: "property" | "origin" | "center-pivot" = input.altKey
        ? "center-pivot"
        : drag.activeRotateMode === "center-pivot"
          ? "origin"
          : drag.activeRotateMode;
      const useCenterPivotAngle = rotateMode === "center-pivot";
      const currentPointerAngleDeg = angleDeg(
        useCenterPivotAngle ? drag.centerPivotWorld : drag.centerWorld,
        input.rawPoint
      );
      const nextRotate = resolveDraggedRotateDeg({
        baseRotateDeg: drag.baseRotateDeg,
        startPointerAngleDeg: useCenterPivotAngle
          ? drag.startCenterPivotPointerAngleDeg
          : drag.startPointerAngleDeg,
        currentPointerAngleDeg,
        shiftKey: input.shiftKey,
        ctrlOrMetaKey: input.ctrlOrMetaKey,
        shiftSnapStepDeg: ROTATE_SHIFT_SNAP_STEP_DEG,
        magneticSnapStepDeg: ROTATE_SOFT_SNAP_STEP_DEG,
        magneticSnapThresholdDeg: ROTATE_SOFT_SNAP_THRESHOLD_DEG,
        roundToInteger: true
      });
      logSnapDebug({
        phase: input.phase,
        snapshotMatchesSource: true,
        dragKind: "rotate",
        rawPoint: input.rawPoint,
        lines: []
      });
      setDragTooltip({
        kind: "rotate",
        anchor: input.tooltipAnchor,
        rows: [formatTooltipAngleRow(nextRotate)]
      });

      if (
        Math.abs(normalizeSignedDeg(nextRotate - drag.lastAppliedRotateDeg)) <= 1e-6 &&
        rotateMode === drag.lastAppliedRotateMode
      ) {
        return;
      }

      const ok = applyActionWithFeedback(
        {
          kind: "rotateElement",
          elementId: drag.sourceId,
          targetId: rotateMode === "property" ? drag.elementId : drag.sourceId,
          angleDeg: nextRotate,
          mode: rotateMode,
          baselineSource: drag.preEditBaselineSource
        },
        drag.historyMergeKey,
        drag.latestSource
      );
      if (ok.sourceChanged) {
        drag.lastAppliedRotateDeg = nextRotate;
        drag.lastAppliedRotateMode = rotateMode;
        drag.activeRotateMode = rotateMode === "center-pivot" ? "center-pivot" : rotateMode;
        if (ok.newSource) {
          drag.latestSource = ok.newSource;
        }
      }
    }

    function pointChanged(a: WorldPoint, b: WorldPoint): boolean {
      return Math.abs(a.x - b.x) > SNAP_FEEDBACK_EPSILON || Math.abs(a.y - b.y) > SNAP_FEEDBACK_EPSILON;
    }

    function onWorldPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (event.pointerId !== drag?.pointerId) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const formatPrecision = event.altKey ? "fine" : undefined;

      if (drag.kind === "pan") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const deltaX = event.clientX - drag.startClient.x;
        const deltaY = event.clientY - drag.startClient.y;
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-pan-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "pan",
          rawDelta: makeWorldPoint(deltaX, deltaY),
          lines: []
        });

        dispatchCanvasTransform({
          ...drag.startTransform,
          translateX: drag.startTransform.translateX + deltaX,
          translateY: drag.startTransform.translateY + deltaY
        });
        maybeTriggerSnapFeedback(false);
        return;
      }

      const currentSvg = svgResultRef.current;
      if (!currentSvg) {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        maybeTriggerSnapFeedback(false);
        return;
      }

      const world = clientToWorldPoint(clientPointFromEvent(event), interactionSvgRef.current, currentSvg.viewBox);
      if (!world) {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        maybeTriggerSnapFeedback(false);
        return;
      }

      if (drag.kind === "tool-create") {
        const snapKind = toolCreateSnapKind(drag.toolMode);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: world,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        let nextRawWorld = snapped.snappedPoint ?? world;
        let endpointAnchorOverlay: NodeAnchorOverlayState | null = null;
        if (drag.toolMode === "addLine" || drag.toolMode === "addArrow") {
          endpointAnchorOverlay = resolveEndpointAnchorSnap({
            pointerWorld: world,
            zoom: drag.snapContext?.zoom ?? 1,
            nodeAnchorTargets,
            matrixCellAnchorHints
          });
          drag.activeEndpointAnchor = endpointAnchorOverlay.snappedAnchor;
          if (endpointAnchorOverlay.snappedAnchor) {
            nextRawWorld = endpointAnchorOverlay.snappedAnchor.world;
          }
        } else {
          drag.activeEndpointAnchor = null;
        }
        drag.rawCurrentWorld = nextRawWorld;
        drag.currentWorld = resolveToolCreateCurrentWorld(
          drag.startWorld,
          drag.rawCurrentWorld,
          drag.toolMode,
          event.shiftKey
        );
        if (drag.toolMode === "addGrid" && !ctrlOrMeta) {
          drag.currentWorld = snapPointDeltaToAxisStepMultiples(
            drag.startWorld,
            drag.currentWorld,
            DEFAULT_GRID_TOOL_STEP_PT,
            DEFAULT_GRID_TOOL_STEP_PT
          );
        }
        setNodeAnchorOverlay(
          endpointAnchorOverlay && endpointAnchorOverlay.visibleAnchors.length > 0
            ? endpointAnchorOverlay
            : null
        );
        setToolDraft({ ...drag });
        const size = resolveToolCreateSize(drag.toolMode, drag.startWorld, drag.currentWorld);
        const rows = formatToolCreateLengthRows(drag.toolMode, size);
        if (drag.toolMode === "addGrid") {
          const counts = resolveGridTooltipCounts(drag.startWorld, drag.currentWorld);
          rows.push(formatTooltipGridCountRow(counts.columns, counts.rows));
        }
        setDragTooltip({
          kind: "tool-create",
          anchor: clientPointFromEvent(event),
          rows
        });
        setToolCursorWorld(drag.currentWorld);
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0 || endpointAnchorOverlay?.snappedAnchor != null);
        logSnapDebug({
          phase: "drag-tool-create-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-create",
          context: drag.snapContext,
          rawPoint: world,
          snappedPoint: drag.currentWorld,
          offset: snapped.offset,
          lines: snapped.lines
        });
        return;
      }

      if (drag.kind === "tool-bezier-bend") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: world,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        drag.rawCurrentWorld = snapped.snappedPoint ?? world;
        drag.currentWorld = drag.rawCurrentWorld;
        setBezierBendDraft({ ...drag });
        setToolCursorWorld(drag.currentWorld);
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0);
        logSnapDebug({
          phase: "drag-bezier-bend-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-bezier-bend",
          context: drag.snapContext,
          rawPoint: world,
          snappedPoint: drag.currentWorld,
          offset: snapped.offset,
          lines: snapped.lines
        });
        return;
      }

      if (drag.kind === "tool-path-segment") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: world,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        drag.rawBendWorld = snapped.snappedPoint ?? world;
        drag.bendWorld = drag.rawBendWorld;
        if (!drag.isBending) {
          const thresholdWorld = PATH_TOOL_BEND_DRAG_THRESHOLD_PX / Math.max(drag.snapContext?.zoom ?? 1, 1e-3);
          drag.isBending = distanceSquared(drag.rawBendWorld, drag.startPointerWorld) > thresholdWorld * thresholdWorld;
        }
        setPathSegmentDraft({ ...drag });
        setToolCursorWorld(drag.endWorld);
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0);
        logSnapDebug({
          phase: "drag-tool-path-segment-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-path-segment",
          context: drag.snapContext,
          rawPoint: world,
          snappedPoint: drag.bendWorld,
          offset: snapped.offset,
          lines: snapped.lines
        });
        return;
      }

      if (drag.kind === "tool-freehand") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const nextWorldPoints = appendFreehandSamplePoint(world);
        if (nextWorldPoints) {
          drag.points = nextWorldPoints;
        }
        setToolCursorWorld(world);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        logSnapDebug({
          phase: "drag-tool-freehand-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "tool-freehand",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (drag.kind === "marquee") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        drag.currentWorld = world;
        setMarqueeDraft({ ...drag });
        if (distanceSquared(world, drag.startWorld) > 0.25) {
          commitMarqueeSelection(drag, world, currentSvg);
        }
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        logSnapDebug({
          phase: "drag-marquee-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "marquee",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (!svgResult || (snapshotSource !== source && drag.kind !== "resize")) {
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        logSnapDebug({
          phase: "drag-move",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: drag.kind,
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (drag.kind === "resize") {
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        const liveFrame = liveResizeFramesRef.current.get(drag.elementId) ?? null;
        const liveDimensions = liveFrame ? resolveFrameBasis(liveFrame) : null;
        const dimensions = liveDimensions
          ? { width: liveDimensions.width, height: liveDimensions.height }
          : drag.measurementMode === "opposite-corner"
            ? projectResizeDimensionsFromOppositeCorner(
              world,
              drag.initialFrame,
              drag.role,
              drag.preserveAspectRatio,
              drag.preserveAspectDuringResize || event.shiftKey
            )
            : projectResizeDimensionsFromCenter(
              world,
              drag.initialFrame,
              drag.preserveAspectRatio,
              drag.preserveAspectDuringResize || event.shiftKey
            );
        setDragTooltip({
          kind: "resize",
          anchor: clientPointFromEvent(event),
          rows: formatTooltipLengthRows(dimensions.width, dimensions.height)
        });
        logSnapDebug({
          phase: "drag-resize-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "resize",
          rawPoint: world,
          lines: []
        });

        applyActionWithFeedback(
          {
            kind: "resizeElement",
            elementId: drag.elementId,
            role: drag.role,
            newWorld: world,
            preserveAspect: event.shiftKey,
            preserveAspectRatio: drag.preserveAspectRatio ?? undefined,
            formatPrecision,
            referenceBounds: resizeFrameWorldBounds(drag.initialFrame),
            referenceScopeTransform: drag.elementId.startsWith("scope:")
              ? drag.initialScopeTransform ?? undefined
              : undefined
          },
          drag.historyMergeKey
        );
        return;
      }

      if (drag.kind === "rotate") {
        const pointerClient = clientPointFromEvent(event);
        drag.lastPointerClient = pointerClient;
        drag.lastPointerWorld = world;
        applyRotateDragUpdate(drag, {
          phase: "drag-rotate-move",
          shiftKey: event.shiftKey,
          ctrlOrMetaKey: ctrlOrMeta,
          altKey: event.altKey,
          tooltipAnchor: pointerClient,
          rawPoint: world
        });
        return;
      }

      if (drag.kind === "element") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        if (drag.elementIds.length === 1) {
          const rawWorld = world;
          const dragStartWorld = drag.startWorld;
          const parsedTarget = parseEditableTargetId(drag.elementIds[0]);
          if (parsedTarget.kind === "node-adornment") {
            let adornmentDrag = drag.adornmentDrag;
            if (!adornmentDrag) {
              const adornmentElements =
                snapshotScene?.elements.filter((element) => element.adornment?.targetId === parsedTarget.id) ?? [];
              const adornmentElement = selectPrimaryAdornmentElement(adornmentElements);
              const ownerPoint = adornmentElement?.adornment?.ownerPoint;
              if (!ownerPoint) {
                setSnapLines([]);
                maybeTriggerSnapFeedback(false);
                return;
              }
              const referenceWorld = resolveAdornmentDragReferenceWorld(adornmentElement);
              if (!referenceWorld) {
                setSnapLines([]);
                maybeTriggerSnapFeedback(false);
                return;
              }
              const bodyDragBox = resolveAdornmentBodyDragBox(adornmentElements);
              const textDrag = bodyDragBox
                ? {
                    pointerOffsetFromCenter: makeWorldVector(
                      dragStartWorld.x - bodyDragBox.center.x,
                      dragStartWorld.y - bodyDragBox.center.y
                    ),
                    halfWidth: Math.max(0.5, bodyDragBox.width / 2),
                    halfHeight: Math.max(0.5, bodyDragBox.height / 2)
                  }
                : undefined;
              adornmentDrag = {
                ownerPoint,
                ownerGeometry: adornmentElement?.adornment?.ownerGeometry,
                allowCenter: adornmentElement?.adornment?.kind === "label",
                pointerOffsetFromReference: makeWorldVector(
                  dragStartWorld.x - referenceWorld.x,
                  dragStartWorld.y - referenceWorld.y
                ),
                textDrag
              };
              drag.adornmentDrag = adornmentDrag;
            }
            if (!adornmentDrag) {
              setSnapLines([]);
              maybeTriggerSnapFeedback(false);
              return;
            }
            const placementWorldPoint = adornmentDrag.textDrag
              ? rawWorld
              : applyAdornmentWorldPointerOffset(rawWorld, adornmentDrag.pointerOffsetFromReference);
            const placement = resolveAdornmentDragPlacement(placementWorldPoint, adornmentDrag.ownerPoint, adornmentDrag.ownerGeometry, {
              allowCenter: adornmentDrag.allowCenter,
              textDrag: adornmentDrag.textDrag
            });
            if (!placement) {
              setSnapLines([]);
              maybeTriggerSnapFeedback(false);
              return;
            }
            setSnapLines([]);
            maybeTriggerSnapFeedback(false);
            applyActionWithFeedback(
              {
                kind: "moveAdornment",
                targetId: parsedTarget.id,
                ownerPoint: adornmentDrag.ownerPoint,
                newWorld: placementWorldPoint,
                angleRaw: placement.angleRaw,
                distancePt: placement.distancePt,
                formatPrecision
              },
              drag.historyMergeKey
            );
            return;
          }
          let pathAttachedNodeDrag = drag.pathAttachedNodeDrag;
          if (!pathAttachedNodeDrag) {
            const handle = snapshotEditHandles.find(
              (candidate) =>
                candidate.sourceRef.sourceId === drag.elementIds[0] &&
                candidate.kind === "node-position" &&
                candidate.pathAttachmentContext
            );
            const center = resolvePrimarySourceCenter(snapshotScene?.elements ?? [], drag.elementIds[0]);
            if (handle?.pathAttachmentContext && center) {
              const initialAnchorPoint = pointAtPlacementSegment(
                handle.pathAttachmentContext.segment,
                handle.pathAttachmentContext.pos
              );
              pathAttachedNodeDrag = {
                nodeId: drag.elementIds[0],
                hostPathSourceId: handle.pathAttachmentContext.hostPathSourceId,
                pointerOffsetFromCenter: makeWorldVector(dragStartWorld.x - center.x, dragStartWorld.y - center.y),
                initialCenter: center,
                initialAnchorPoint,
                initialAnchorOffset: makeWorldVector(center.x - initialAnchorPoint.x, center.y - initialAnchorPoint.y),
                initialDistancePt:
                  handle.pathAttachmentContext.regime.kind === "explicit-direction"
                    ? resolvePathAttachedDirectionalDistancePt(source, drag.elementIds[0], handle.pathAttachmentContext.regime.direction)
                    : 0,
                initialDirectionalAnchorPt:
                  (() => {
                    if (handle.pathAttachmentContext.regime.kind !== "explicit-direction") {
                      return 0;
                    }
                    const initialDirectionUnit = resolvePathAttachedDirectionUnit(handle.pathAttachmentContext.regime.direction);
                    const initialDirectionalOffset =
                      (center.x - initialAnchorPoint.x) * initialDirectionUnit.x +
                      (center.y - initialAnchorPoint.y) * initialDirectionUnit.y;
                    const initialDistancePt = resolvePathAttachedDirectionalDistancePt(
                      source,
                      drag.elementIds[0],
                      handle.pathAttachmentContext.regime.direction
                    );
                    return Math.max(0, initialDirectionalOffset - initialDistancePt);
                  })(),
                segment: handle.pathAttachmentContext.segment,
                regime: handle.pathAttachmentContext.regime,
                lastPreviewDelta: makeWorldVector(0, 0)
              };
              drag.pathAttachedNodeDrag = pathAttachedNodeDrag;
            }
          }
          if (pathAttachedNodeDrag) {
            const desiredCenter = makeWorldPoint(
              rawWorld.x - pathAttachedNodeDrag.pointerOffsetFromCenter.x,
              rawWorld.y - pathAttachedNodeDrag.pointerOffsetFromCenter.y
            );
            const closest = closestPointOnPlacementSegment(pathAttachedNodeDrag.segment, desiredCenter);
            const snapped = resolvePathPositionPreset(closest.t, pathAttachedNodeDrag.segment);
            const targetWorldPoint = pointAtPlacementSegment(pathAttachedNodeDrag.segment, snapped.snappedT);
            const currentCenter =
              resolvePrimarySourceCenter(snapshotScene?.elements ?? [], pathAttachedNodeDrag.nodeId) ??
              pathAttachedNodeDrag.initialCenter;
            const anchorOffset = pathAttachedNodeDrag.initialAnchorOffset;
            const previewCenter = makeWorldPoint(targetWorldPoint.x + anchorOffset.x, targetWorldPoint.y + anchorOffset.y);
            const tangent = tangentAtPlacementSegment(pathAttachedNodeDrag.segment, snapped.snappedT);
            const previewDelta = makeWorldVector(previewCenter.x - currentCenter.x, previewCenter.y - currentCenter.y);
            const tangentLength = Math.hypot(tangent.x, tangent.y);
            const tangentUnit =
              tangentLength > 1e-6
                ? makeWorldVector(tangent.x / tangentLength, tangent.y / tangentLength)
                : makeWorldVector(1, 0);
            const tangentialDelta =
              previewDelta.x * tangentUnit.x + previewDelta.y * tangentUnit.y;
            const normalPreviewDelta = makeWorldVector(
              previewDelta.x - tangentialDelta * tangentUnit.x,
              previewDelta.y - tangentialDelta * tangentUnit.y
            );
            const previousPreviewDelta = pathAttachedNodeDrag.lastPreviewDelta;
            if (
              !previousPreviewDelta ||
              Math.abs(previousPreviewDelta.x - normalPreviewDelta.x) > 1e-6 ||
              Math.abs(previousPreviewDelta.y - normalPreviewDelta.y) > 1e-6
            ) {
              setPathAttachedNodePreview({
                sourceId: pathAttachedNodeDrag.nodeId,
                dx: normalPreviewDelta.x,
                dy: normalPreviewDelta.y
              });
              pathAttachedNodeDrag.lastPreviewDelta = normalPreviewDelta;
            }
            const offset = makeWorldVector(desiredCenter.x - targetWorldPoint.x, desiredCenter.y - targetWorldPoint.y);
            const cross = tangent.x * offset.y - tangent.y * offset.x;
            let sideUpdate:
              | { kind: "auto-side"; side: "left" | "right" }
              | { kind: "explicit-direction"; direction: string }
              | undefined;
            let distanceUpdatePt: number | undefined;
            if (pathAttachedNodeDrag.regime.kind === "auto-side") {
              sideUpdate = {
                kind: "auto-side",
                side:
                  Math.abs(cross) <= 1e-6
                    ? pathAttachedNodeDrag.regime.side
                    : cross >= 0
                      ? "left"
                      : "right"
              };
            } else if (pathAttachedNodeDrag.regime.kind === "explicit-direction") {
              const resolvedDirection = resolveDraggedPathAttachedNodeDirection(
                targetWorldPoint,
                desiredCenter,
                pathAttachedNodeDrag.regime
              );
              sideUpdate = {
                kind: "explicit-direction",
                direction: resolvedDirection
              };
              const directionUnit = resolvePathAttachedDirectionUnit(resolvedDirection);
              const desiredDirectionalOffset = offset.x * directionUnit.x + offset.y * directionUnit.y;
              distanceUpdatePt = Math.max(0, desiredDirectionalOffset - pathAttachedNodeDrag.initialDirectionalAnchorPt);
            } else {
              sideUpdate = undefined;
            }
            const placementKey =
              `${formatNumber(snapped.snappedT)}:${sideUpdate == null ? "neutral" : sideUpdate.kind}:${sideUpdate == null ? "" : sideUpdate.kind === "auto-side" ? sideUpdate.side : sideUpdate.direction}` +
              (distanceUpdatePt == null ? "" : `:${formatNumber(distanceUpdatePt)}:${formatPrecision ?? "default"}`);
            setSnapLines([]);
            maybeTriggerSnapFeedback(Boolean(snapped.preset));
            if (pathAttachedNodeDrag.lastAppliedPlacementKey === placementKey) {
              return;
            }
            applyActionWithFeedback(
              {
                kind: "movePathAttachedNode",
                nodeId: pathAttachedNodeDrag.nodeId,
                hostPathSourceId: pathAttachedNodeDrag.hostPathSourceId,
                pos: snapped.snappedT,
                preserveRegime: true,
                sideUpdate,
                distanceUpdatePt,
                formatPrecision
              },
              drag.historyMergeKey
            );
            pathAttachedNodeDrag.lastAppliedPlacementKey = placementKey;
            return;
          }
        }
        const rawTotalDelta = makeWorldVector(world.x - drag.startWorld.x, world.y - drag.startWorld.y);
        const snapped = drag.snapContext && drag.initialSelection
          ? snapSelectionTranslation({
              context: drag.snapContext,
              selection: drag.initialSelection,
              rawDelta: makeWorldPoint(rawTotalDelta.x, rawTotalDelta.y),
              modifiers: { ctrlOrMeta }
            })
          : {
              snappedDelta: makeWorldPoint(rawTotalDelta.x, rawTotalDelta.y),
              offset: undefined,
              lines: [] as SnapLine[]
            };
        const totalDelta = snapped.snappedDelta
          ? makeWorldVector(snapped.snappedDelta.x, snapped.snappedDelta.y)
          : rawTotalDelta;
        const actualTotalDelta = drag.lastAppliedTotalDelta;
        const incremental = makeWorldVector(totalDelta.x - actualTotalDelta.x, totalDelta.y - actualTotalDelta.y);
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0);
        logSnapDebug({
          phase: "drag-element-move",
          snapshotMatchesSource: true,
          dragKind: "element",
          context: drag.snapContext,
          rawDelta: makeWorldPoint(rawTotalDelta.x, rawTotalDelta.y),
          snappedDelta: makeWorldPoint(totalDelta.x, totalDelta.y),
          offset: snapped.offset,
          lines: snapped.lines
        });

        if (Math.abs(incremental.x) < 1e-6 && Math.abs(incremental.y) < 1e-6) {
          return;
        }

        const result = applyActionWithFeedback(
          {
            kind: "moveElements",
            elementIds: drag.elementIds,
            delta: makeWorldPoint(incremental.x, incremental.y),
            formatPrecision
          },
          drag.historyMergeKey
        );
        if (result.sourceChanged) {
          drag.lastAppliedTotalDelta = totalDelta;
        }
        return;
      }

      const resolvedHandleId = resolveHandleIdForDrag(drag, snapshotEditHandles);
      if (!resolvedHandleId) {
        drag.activeEndpointAnchor = null;
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        setWarning("Handle is no longer available after recompute. Release and drag again.");
        maybeTriggerSnapFeedback(false);
        return;
      }

      const snapped = drag.snapContext
        ? snapHandlePosition({
            context: drag.snapContext,
            point: world,
            sourceId: drag.sourceId,
            modifiers: { ctrlOrMeta }
          })
        : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
      let nextWorld = snapped.snappedPoint ?? world;
      let endpointAnchorOverlay: NodeAnchorOverlayState | null = null;
      if (drag.handleKind === "path-point") {
        endpointAnchorOverlay = resolveEndpointAnchorSnap({
          pointerWorld: world,
          zoom: drag.snapContext?.zoom ?? 1,
          nodeAnchorTargets,
          matrixCellAnchorHints
        });
        drag.activeEndpointAnchor = endpointAnchorOverlay.snappedAnchor;
        if (endpointAnchorOverlay.snappedAnchor) {
          nextWorld = endpointAnchorOverlay.snappedAnchor.world;
        }
      } else {
        drag.activeEndpointAnchor = null;
      }
      const beforeGridResizeWorld = nextWorld;
      if (drag.gridResizeSnap && !ctrlOrMeta) {
        nextWorld = snapGridResizeWorldPoint(nextWorld, drag.gridResizeSnap);
      }
      setNodeAnchorOverlay(endpointAnchorOverlay && endpointAnchorOverlay.visibleAnchors.length > 0 ? endpointAnchorOverlay : null);
      setDragTooltip(null);
      setSnapLines(snapped.lines);
      maybeTriggerSnapFeedback(
        snapped.lines.length > 0 ||
          endpointAnchorOverlay?.snappedAnchor != null ||
          pointChanged(beforeGridResizeWorld, nextWorld)
      );
      logSnapDebug({
        phase: "drag-handle-move",
        snapshotMatchesSource: true,
        dragKind: "handle",
        context: drag.snapContext,
        rawPoint: world,
        snappedPoint: nextWorld,
        offset: snapped.offset,
        lines: snapped.lines
      });

      const ok = applyActionWithFeedback(
        resolveHandleDragAction({
          handleId: resolvedHandleId,
          newWorld: nextWorld,
          activeEndpointAnchor: drag.activeEndpointAnchor
        }),
        drag.historyMergeKey
      );
      if (ok.sourceChanged) {
        drag.lastKnownWorld = nextWorld;
      }
    }

    function onWorldPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (event.pointerId !== drag?.pointerId) return;
      resetSnapFeedbackState();
      suppressNextBackgroundClickRef.current = true;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      const currentSvg = svgResultRef.current;
      const world =
        currentSvg == null
          ? null
          : clientToWorldPoint(clientPointFromEvent(event), interactionSvgRef.current, currentSvg.viewBox);

      if (drag.kind === "marquee") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const finalWorld = world ?? drag.currentWorld;
        const deltaSq = distanceSquared(finalWorld, drag.startWorld);
        const isClickOnly = deltaSq <= 0.25;

        if (isClickOnly) {
          if (!drag.additive) {
            dispatch({ type: "CLEAR_SELECTION" });
          }
        } else if (currentSvg) {
          commitMarqueeSelection(drag, finalWorld, currentSvg);
          suppressNextBackgroundClickRef.current = true;
        }

        setMarqueeDraft(null);
        setSnapLines([]);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-create") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const rawFinalWorld = world ?? drag.rawCurrentWorld;
        const finalEndpointAnchor =
          drag.toolMode === "addLine" || drag.toolMode === "addArrow"
            ? world
              ? resolveEndpointAnchorSnap({
                  pointerWorld: world,
                  zoom: drag.snapContext?.zoom ?? 1,
                  nodeAnchorTargets,
                  matrixCellAnchorHints
                }).snappedAnchor
              : drag.activeEndpointAnchor
            : null;
        const finalWorldPointerWorld = finalEndpointAnchor?.world ?? rawFinalWorld;
        const snapKind = toolCreateSnapKind(drag.toolMode);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: finalWorldPointerWorld,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: finalWorldPointerWorld, lines: [] as SnapLine[] };
        const snappedWorld = snapped.snappedPoint ?? finalWorldPointerWorld;
        let finalWorld = resolveToolCreateCurrentWorld(
          drag.startWorld,
          snappedWorld,
          drag.toolMode,
          event.shiftKey
        );
        if (drag.toolMode === "addGrid" && !ctrlOrMeta) {
          finalWorld = snapPointDeltaToAxisStepMultiples(
            drag.startWorld,
            finalWorld,
            DEFAULT_GRID_TOOL_STEP_PT,
            DEFAULT_GRID_TOOL_STEP_PT
          );
        }
        if (finalEndpointAnchor && (drag.toolMode === "addLine" || drag.toolMode === "addArrow")) {
          finalWorld = finalEndpointAnchor.world;
        }
        setSnapLines(snapped.lines);
        setToolCursorWorld(finalWorld);

        if (drag.toolMode === "addBezier") {
          setPendingBezier({
            startWorld: drag.startWorld,
            endWorld: finalWorld
          });
          setToolCursorWorld(null);
          setToolDraft(null);
          setBezierBendDraft(null);
          setSnapLines([]);
          setDragState(null);
          return;
        }

        const rawTemplate = createTemplateForToolDrag(drag.toolMode, drag.startWorld, finalWorld, {
          selectedAddShape,
          strokeColor: creationStrokeColor,
          fillColor: creationFillColor
        });
        const template =
          rawTemplate.kind === "line"
            ? {
                ...rawTemplate,
                ...(drag.startEndpointAnchor
                  ? {
                      fromAnchor: {
                        nodeName: drag.startEndpointAnchor.nodeName,
                        nodeSourceId: drag.startEndpointAnchor.nodeSourceId,
                        anchor: drag.startEndpointAnchor.anchor
                      }
                    }
                  : {}),
                ...(rawTemplate.to && finalEndpointAnchor
                  ? {
                      toAnchor: {
                        nodeName: finalEndpointAnchor.nodeName,
                        nodeSourceId: finalEndpointAnchor.nodeSourceId,
                        anchor: finalEndpointAnchor.anchor
                      }
                    }
                  : {})
              }
            : rawTemplate;
        const hasShapeDrag =
          drag.toolMode === "addShape" &&
          Math.max(Math.abs(finalWorld.x - drag.startWorld.x), Math.abs(finalWorld.y - drag.startWorld.y)) >= MIN_SHAPE_DRAG_DIMENSION_PT;
        const insertionAt =
          drag.toolMode === "addShape" && hasShapeDrag
            ? resolveAddShapeOriginFromDrag(selectedAddShape, drag.startWorld, finalWorld)
            : drag.startWorld;
        queueSelectionForAddedElement(insertionAt);
        const ok = applyActionWithFeedback({
          kind: "addElement",
          template,
          at: insertionAt
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }

        if (ok.sourceChanged) {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
        }
        setToolDraft(null);
        setSnapLines([]);
        setBezierBendDraft(null);
        setPendingBezier(null);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-bezier-bend") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const rawFinalWorld = world ?? drag.rawCurrentWorld;
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: rawFinalWorld,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: rawFinalWorld, lines: [] as SnapLine[] };
        const finalBend = snapped.snappedPoint ?? rawFinalWorld;
        setSnapLines(snapped.lines);
        setToolCursorWorld(finalBend);

        queueSelectionForAddedElement(makeWorldPoint((drag.startWorld.x + drag.endWorld.x) / 2, (drag.startWorld.y + drag.endWorld.y) / 2));
        const template = createBezierTemplateFromBend(drag.startWorld, drag.endWorld, finalBend, {
          strokeColor: creationStrokeColor
        });
        const ok = applyActionWithFeedback({
          kind: "addElement",
          template,
          at: drag.startWorld
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }

        if (ok.sourceChanged) {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
        }
        setPendingBezier(null);
        setBezierBendDraft(null);
        setToolDraft(null);
        setSnapLines([]);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-path-segment") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const rawFinalBend = world ?? drag.rawBendWorld;
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: rawFinalBend,
              kind: "line-end",
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: rawFinalBend, lines: [] as SnapLine[] };
        const finalBend = snapped.snappedPoint ?? rawFinalBend;
        const thresholdWorld = PATH_TOOL_BEND_DRAG_THRESHOLD_PX / Math.max(drag.snapContext?.zoom ?? 1, 1e-3);
        const asBezier =
          drag.isBending || distanceSquared(finalBend, drag.startPointerWorld) > thresholdWorld * thresholdWorld;

        commitPathToolSegment({
          endWorld: drag.endWorld,
          endAnchor: drag.endEndpointAnchor
            ? {
                nodeName: drag.endEndpointAnchor.nodeName,
                nodeSourceId: drag.endEndpointAnchor.nodeSourceId,
                anchor: drag.endEndpointAnchor.anchor
              }
            : undefined,
          bendWorld: finalBend,
          asBezier
        });
        setPathSegmentDraft(null);
        setToolCursorWorld(drag.endWorld);
        setSnapLines(snapped.lines);
        setDragState(null);
        return;
      }

      if (drag.kind === "tool-freehand") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        let nextWorldPoints: WorldPoint[] | null = null;
        if (world) {
          nextWorldPoints = appendFreehandSamplePoint(world);
          if (nextWorldPoints) {
            drag.points = nextWorldPoints;
          }
          setToolCursorWorld(world);
        }
        setSnapLines([]);
        finalizeFreehandDraft(nextWorldPoints ?? undefined);
        return;
      }

      if (
        drag.kind === "handle" &&
        shouldCommitHandleAnchorOnPointerUp({
          snapshotSource,
          source,
          activeEndpointAnchor: drag.activeEndpointAnchor
        })
      ) {
        const resolvedHandleId = resolveHandleIdForDrag(drag, snapshotEditHandles);
        if (resolvedHandleId && drag.activeEndpointAnchor) {
          applyActionWithFeedback(
            {
              kind: "connectHandle",
              handleId: resolvedHandleId,
              nodeName: drag.activeEndpointAnchor.nodeName,
              nodeSourceId: drag.activeEndpointAnchor.nodeSourceId,
              anchor: drag.activeEndpointAnchor.anchor
            },
            drag.historyMergeKey
          );
        }
      }

      const cleanupElementIds = propertyCleanupElementIdsForDrag(drag);
      if ("historyMergeKey" in drag && typeof drag.historyMergeKey === "string" && cleanupElementIds.length > 0) {
        dispatch({
          type: "APPLY_EDIT_ACTION",
          action: { kind: "cleanupPropertyWrites", elementIds: cleanupElementIds },
          historyMergeKey: drag.historyMergeKey,
          parseOptions: { propertyWriteMode: "drag-end" }
        });
      }

      setNodeAnchorOverlay(null);
      setSnapLines([]);
      setDragTooltip(null);
      setDragState(null);
    }

    function isAltModifierEvent(event: KeyboardEvent): boolean {
      return event.key === "Alt" || event.key === "AltGraph" || event.code === "AltLeft" || event.code === "AltRight";
    }

    function applyRotateModifierKeyTransition(event: KeyboardEvent, altKey: boolean) {
      const drag = dragRef.current;
      if (drag?.kind !== "rotate") {
        return;
      }
      const altEvent = isAltModifierEvent(event);
      const exitingCenterPivot = !altKey && !event.altKey && drag.activeRotateMode === "center-pivot";
      const enteringCenterPivot = altKey && event.altKey && drag.activeRotateMode !== "center-pivot";
      if (!altEvent && !exitingCenterPivot && !enteringCenterPivot) {
        return;
      }
      event.preventDefault();
      applyRotateDragUpdate(drag, {
        phase: "drag-rotate-modifier",
        shiftKey: event.shiftKey,
        ctrlOrMetaKey: event.ctrlKey || event.metaKey,
        altKey,
        tooltipAnchor: drag.lastPointerClient,
        rawPoint: drag.lastPointerWorld
      });
    }

    function onWorldKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }
      applyRotateModifierKeyTransition(event, true);
    }

    function onWorldKeyUp(event: KeyboardEvent) {
      applyRotateModifierKeyTransition(event, false);
    }

    window.addEventListener("pointermove", onWorldPointerMove);
    window.addEventListener("pointerup", onWorldPointerUp);
    window.addEventListener("pointercancel", onWorldPointerUp);
    window.addEventListener("keydown", onWorldKeyDown, true);
    window.addEventListener("keyup", onWorldKeyUp, true);

    return () => {
      window.removeEventListener("pointermove", onWorldPointerMove);
      window.removeEventListener("pointerup", onWorldPointerUp);
      window.removeEventListener("pointercancel", onWorldPointerUp);
      window.removeEventListener("keydown", onWorldKeyDown, true);
      window.removeEventListener("keyup", onWorldKeyUp, true);
    };
  }, [
    applyActionWithFeedback,
    creationFillColor,
    creationStrokeColor,
    dispatch,
    dispatchCanvasTransform,
    dragRef,
    interactionSvgRef,
    liveResizeFramesRef,
    logSnapDebug,
    onSnapFeedback,
    pendingAddedSelectionRef,
    queueSelectionForAddedElement,
    selectedAddShape,
    selectedElementIdsRef,
    setMarqueeDraft,
    setDragTooltip,
    setNodeAnchorOverlay,
    setPathAttachedNodePreview,
    setDragState,
    setSnapLines,
    setBezierBendDraft,
    setPathSegmentDraft,
    commitPathToolSegment,
    appendFreehandSamplePoint,
    finalizeFreehandDraft,
    setPendingBezier,
    setToolCursorWorld,
    setToolDraft,
    setWarning,
    snapshotEditHandles,
    snapshotScene,
    snapshotSource,
    suppressNextBackgroundClickRef,
    nodeAnchorTargets,
    matrixCellAnchorHints,
    scopeOverlay,
    source,
    sourceBoundsSvgRef,
    svgResult,
    svgResultRef
  ]);
}

function propertyCleanupElementIdsForDrag(drag: DragState): string[] {
  switch (drag.kind) {
    case "element":
      return drag.elementIds;
    case "resize":
    case "rotate":
      return [drag.elementId];
    case "handle":
      return [drag.sourceId];
    case "tool-create":
    case "pan":
    case "marquee":
    case "tool-bezier-bend":
    case "tool-path-segment":
    case "tool-freehand":
      return [];
  }
}

function snapGridResizeWorldPoint(point: WorldPoint, config: GridResizeSnapConfig): WorldPoint {
  const localWorldPoint = worldToLocal(point, config.transform);
  const anchorLocal = worldToLocal(config.anchorWorld, config.transform);
  if (!localWorldPoint || !anchorLocal) {
    return point;
  }

  const snappedLocal = frameLocalPoint(
    pt(anchorLocal.x + snapDeltaToStep(localWorldPoint.x - anchorLocal.x, config.stepX)),
    pt(anchorLocal.y + snapDeltaToStep(localWorldPoint.y - anchorLocal.y, config.stepY))
  );
  return applyFrameTransform(config.transform, snappedLocal);
}

function snapDeltaToStep(delta: number, step: number): number {
  if (!(step > GRID_RESIZE_STEP_EPSILON)) {
    return delta;
  }
  return Math.round(delta / step) * step;
}

function selectPrimaryAdornmentElement(elements: readonly SceneElement[]): SceneElement | null {
  return (
    elements.find((element) => element.kind === "Text") ??
    elements.find((element) => element.kind === "Circle" || element.kind === "Ellipse") ??
    elements[0] ??
    null
  );
}

function resolveAdornmentDragReferenceWorld(element: SceneElement | null): WorldPoint | null {
  if (!element?.adornment) {
    return null;
  }
  return resolveAdornmentReferenceWorld(element.adornment);
}

function resolveAdornmentReferenceWorld(adornment: NonNullable<SceneElement["adornment"]>): WorldPoint | null {
  const ownerCenter = adornment.ownerGeometry
    ? makeWorldPoint(adornment.ownerGeometry.center.x, adornment.ownerGeometry.center.y)
    : adornment.ownerPoint;
  if (!ownerCenter) {
    return null;
  }
  const parsedAngle = parseAdornmentAngleDegrees(adornment.angleRaw);
  if (parsedAngle == null) {
    return null;
  }
  if (parsedAngle.kind === "center") {
    return makeWorldPoint(ownerCenter.x, ownerCenter.y);
  }
  const radians = (parsedAngle.degrees * Math.PI) / 180;
  const direction = makeWorldPoint(Math.cos(radians), Math.sin(radians));
  const borderDistance = resolveAdornmentOwnerBorderDistance(adornment.ownerGeometry, direction);
  const distancePt = Math.max(0, adornment.distancePt ?? 0);
  return makeWorldPoint(
    ownerCenter.x + direction.x * (borderDistance + distancePt),
    ownerCenter.y + direction.y * (borderDistance + distancePt)
  );
}

function parseAdornmentAngleDegrees(raw: string | undefined): { kind: "center" } | { kind: "angle"; degrees: number } | null {
  const normalized = raw?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  if (normalized.length === 0) {
    return null;
  }
  if (normalized === "center" || normalized === "centered") {
    return { kind: "center" };
  }
  const namedDegrees: Record<string, number> = {
    right: 0,
    "above right": 45,
    above: 90,
    "above left": 135,
    left: 180,
    "below left": 225,
    below: 270,
    "below right": 315,
    east: 0,
    "north east": 45,
    north: 90,
    "north west": 135,
    west: 180,
    "south west": 225,
    south: 270,
    "south east": 315
  };
  if (normalized in namedDegrees) {
    return { kind: "angle", degrees: namedDegrees[normalized] };
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  let degrees = numeric % 360;
  if (degrees < 0) {
    degrees += 360;
  }
  return { kind: "angle", degrees };
}

export function applyAdornmentWorldPointerOffset(pointerWorld: WorldPoint, pointerOffsetFromReference: WorldVector): WorldPoint {
  return makeWorldPoint(
    pointerWorld.x - pointerOffsetFromReference.x,
    pointerWorld.y - pointerOffsetFromReference.y
  );
}

export function resolveAdornmentDragPlacement(
  point: WorldPoint,
  ownerPoint: WorldPoint,
  ownerGeometry: AdornmentOwnerGeometry | undefined,
  options: {
    allowCenter: boolean;
    textDrag?: {
      pointerOffsetFromCenter: WorldVector;
      halfWidth: number;
      halfHeight: number;
    };
  }
): { angleRaw: string; distancePt: number } | null {
  if (options.textDrag) {
    const desiredCenter = makeWorldPoint(
      point.x - options.textDrag.pointerOffsetFromCenter.x,
      point.y - options.textDrag.pointerOffsetFromCenter.y
    );
    const bodyPlacement = resolvePlacementFromDesiredCenter({
      desiredCenter,
      ownerPoint,
      ownerGeometry,
      halfWidth: options.textDrag.halfWidth,
      halfHeight: options.textDrag.halfHeight
    });
    if (!bodyPlacement) {
      return null;
    }
    if (
      options.allowCenter &&
      bodyPlacement.radialDistanceFromCenter <= bodyPlacement.borderDistance + ADORNMENT_CENTER_SNAP_THRESHOLD_PT
    ) {
      return { angleRaw: "center", distancePt: 0 };
    }
    return {
      angleRaw: formatAdornmentAngle(bodyPlacement.angleDeg),
      distancePt: bodyPlacement.distancePt
    };
  }

  const resolvedReferenceWorldPoint = point;
  const center = ownerGeometry ? makeWorldPoint(ownerGeometry.center.x, ownerGeometry.center.y) : ownerPoint;
  const dx = resolvedReferenceWorldPoint.x - center.x;
  const dy = resolvedReferenceWorldPoint.y - center.y;
  const radius = Math.sqrt(dx * dx + dy * dy);
  if (options.allowCenter && radius <= ADORNMENT_CENTER_SNAP_THRESHOLD_PT) {
    return { angleRaw: "center", distancePt: 0 };
  }

  const placement = derivePlacementFromReferenceWorldPoint(resolvedReferenceWorldPoint, ownerPoint, ownerGeometry);
  if (options.allowCenter && placement.radialDistanceFromCenter <= placement.borderDistance + ADORNMENT_CENTER_SNAP_THRESHOLD_PT) {
    return { angleRaw: "center", distancePt: 0 };
  }
  return {
    angleRaw: formatAdornmentAngle(placement.angleDeg),
    distancePt: placement.distancePt
  };
}

function resolvePlacementFromDesiredCenter(input: {
  desiredCenter: WorldPoint;
  ownerPoint: WorldPoint;
  ownerGeometry: AdornmentOwnerGeometry | undefined;
  halfWidth: number;
  halfHeight: number;
}): {
  angleDeg: number;
  distancePt: number;
  anchor: string;
  borderDistance: number;
  radialDistanceFromCenter: number;
} | null {
  type PlacementSearchResult = {
    angleDeg: number;
    distancePt: number;
    anchor: string;
    borderDistance: number;
    radialDistanceFromCenter: number;
    errorSq: number;
  };
  let best: PlacementSearchResult | null = null;

  const tryAngle = (angleDeg: number) => {
    const geometry = derivePlacementGeometryForAngle(angleDeg, input.ownerPoint, input.ownerGeometry);
    const anchor = geometry.anchor;
    const anchorOffset = anchorOffsetFromCenter(anchor, input.halfWidth, input.halfHeight);
    const desiredReference = makeWorldPoint(
      input.desiredCenter.x + anchorOffset.x,
      input.desiredCenter.y + anchorOffset.y
    );
    const projectedDistance =
      (desiredReference.x - geometry.borderWorldPoint.x) * geometry.shiftDirection.x +
      (desiredReference.y - geometry.borderWorldPoint.y) * geometry.shiftDirection.y;
    const distancePt = Math.max(0, projectedDistance);
    const referenceWorldPoint = makeWorldPoint(
      geometry.borderWorldPoint.x + geometry.shiftDirection.x * distancePt,
      geometry.borderWorldPoint.y + geometry.shiftDirection.y * distancePt
    );
    const resolvedCenter = makeWorldPoint(
      referenceWorldPoint.x - anchorOffset.x,
      referenceWorldPoint.y - anchorOffset.y
    );
    const errorSq = distanceSquared(resolvedCenter, input.desiredCenter);
    if (!best || errorSq < best.errorSq) {
      best = {
        angleDeg: normalizeDegrees(angleDeg),
        distancePt,
        anchor,
        borderDistance: geometry.borderDistance,
        radialDistanceFromCenter: Math.max(
          0,
          (referenceWorldPoint.x - geometry.ownerCenter.x) * geometry.polarDirection.x +
            (referenceWorldPoint.y - geometry.ownerCenter.y) * geometry.polarDirection.y
        ),
        errorSq
      };
    }
  };

  for (let angle = 0; angle < 360; angle += 1) {
    tryAngle(angle);
  }
  if (!best) {
    return null;
  }
  const coarseBest = (best as PlacementSearchResult).angleDeg;
  for (let angle = coarseBest - 1; angle <= coarseBest + 1; angle += 0.1) {
    tryAngle(angle);
  }
  const refinedBest = best as PlacementSearchResult;
  return {
    angleDeg: refinedBest.angleDeg,
    distancePt: refinedBest.distancePt,
    anchor: refinedBest.anchor,
    borderDistance: refinedBest.borderDistance,
    radialDistanceFromCenter: refinedBest.radialDistanceFromCenter
  };
}

function derivePlacementGeometryForAngle(
  angleDeg: number,
  ownerPoint: WorldPoint,
  ownerGeometry: AdornmentOwnerGeometry | undefined
): {
  ownerCenter: WorldPoint;
  polarDirection: WorldPoint;
  borderDistance: number;
  borderWorldPoint: WorldPoint;
  shiftDirection: WorldPoint;
  anchor: string;
} {
  const ownerCenter = ownerGeometry ? makeWorldPoint(ownerGeometry.center.x, ownerGeometry.center.y) : ownerPoint;
  const normalizedAngle = normalizeDegrees(angleDeg);
  const polarDirection = pointOnUnitCircle(normalizedAngle);
  const borderDistance = resolveAdornmentOwnerBorderDistance(ownerGeometry, polarDirection);
  const borderWorldPoint = makeWorldPoint(
    ownerCenter.x + polarDirection.x * borderDistance,
    ownerCenter.y + polarDirection.y * borderDistance
  );
  const centerToBorder = makeWorldVector(borderWorldPoint.x - ownerCenter.x, borderWorldPoint.y - ownerCenter.y);
  const centerToBorderLength = Math.hypot(centerToBorder.x, centerToBorder.y);
  const shiftDirection = centerToBorderLength <= ADORNMENT_OWNER_CENTER_EPSILON
    ? polarDirection
    : makeWorldPoint(centerToBorder.x / centerToBorderLength, centerToBorder.y / centerToBorderLength);
  const anchor = centerToBorderLength <= ADORNMENT_OWNER_CENTER_EPSILON
    ? anchorFacingAway(normalizedAngle)
        : autoAnchorFromVector(makeWorldPoint(shiftDirection.y, -Number(shiftDirection.x)));
  return {
    ownerCenter,
    polarDirection,
    borderDistance,
    borderWorldPoint,
    shiftDirection,
    anchor
  };
}

function derivePlacementFromReferenceWorldPoint(
  referenceWorldPoint: WorldPoint,
  ownerPoint: WorldPoint,
  ownerGeometry: AdornmentOwnerGeometry | undefined
): {
  angleDeg: number;
  distancePt: number;
  anchor: string;
  borderDistance: number;
  radialDistanceFromCenter: number;
  referenceWorldPoint: WorldPoint;
} {
  const ownerCenter = ownerGeometry ? makeWorldPoint(ownerGeometry.center.x, ownerGeometry.center.y) : ownerPoint;
  const angleDeg = normalizeDegrees((Math.atan2(referenceWorldPoint.y - ownerCenter.y, referenceWorldPoint.x - ownerCenter.x) * 180) / Math.PI);
  const polarDirection = pointOnUnitCircle(angleDeg);
  const borderDistance = resolveAdornmentOwnerBorderDistance(ownerGeometry, polarDirection);
  const borderWorldPoint = makeWorldPoint(
    ownerCenter.x + polarDirection.x * borderDistance,
    ownerCenter.y + polarDirection.y * borderDistance
  );
  const centerToBorder = makeWorldVector(borderWorldPoint.x - ownerCenter.x, borderWorldPoint.y - ownerCenter.y);
  const centerToBorderLength = Math.hypot(centerToBorder.x, centerToBorder.y);
  const simple = centerToBorderLength <= ADORNMENT_OWNER_CENTER_EPSILON;
  const shiftDirection = simple
    ? polarDirection
    : makeWorldPoint(centerToBorder.x / centerToBorderLength, centerToBorder.y / centerToBorderLength);
  const radialDistanceFromCenter = Math.max(0, (referenceWorldPoint.x - ownerCenter.x) * polarDirection.x + (referenceWorldPoint.y - ownerCenter.y) * polarDirection.y);
  const distancePt = Math.max(
    0,
    (referenceWorldPoint.x - borderWorldPoint.x) * shiftDirection.x +
      (referenceWorldPoint.y - borderWorldPoint.y) * shiftDirection.y
  );
  const anchor = simple
    ? anchorFacingAway(angleDeg)
    : autoAnchorFromVector(makeWorldPoint(shiftDirection.y, -Number(shiftDirection.x)));
  const resolvedReferenceWorldPoint = makeWorldPoint(
    borderWorldPoint.x + shiftDirection.x * distancePt,
    borderWorldPoint.y + shiftDirection.y * distancePt
  );
  return {
    angleDeg,
    distancePt,
    anchor,
    borderDistance,
    radialDistanceFromCenter,
    referenceWorldPoint: resolvedReferenceWorldPoint
  };
}

function pointOnUnitCircle(angleDeg: number): WorldPoint {
  const radians = (angleDeg * Math.PI) / 180;
  return makeWorldPoint(Math.cos(radians), Math.sin(radians));
}

function autoAnchorFromVector(vector: WorldPoint): string {
  const x = vector.x;
  const y = vector.y;
  if (x > 0.05) {
    if (y > 0.05) return "south east";
    if (y < -0.05) return "south west";
    return "south";
  }
  if (x < -0.05) {
    if (y > 0.05) return "north east";
    if (y < -0.05) return "north west";
    return "north";
  }
  return y > 0 ? "east" : "west";
}

function resolveAdornmentOwnerBorderDistance(
  ownerGeometry: AdornmentOwnerGeometry | undefined,
  direction: WorldPoint
): number {
  if (!ownerGeometry || ownerGeometry.shape === "coordinate") {
    return 0;
  }
  const anchorPolygon = ownerGeometry.anchorPolygon?.map((point) => makeWorldPoint(point.x, point.y));
  if (anchorPolygon && anchorPolygon.length >= 3) {
    const hit = intersectRayWithPolygon(makeWorldPoint(0, 0), makeWorldVector(direction.x, direction.y), anchorPolygon);
    return hit ? Math.sqrt(hit.x * hit.x + hit.y * hit.y) : 0;
  }
  if (ownerGeometry.shape === "circle") {
    const transform = ownerGeometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(worldTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f));
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const localLen = Math.hypot(localDirection.x, localDirection.y);
    if (!Number.isFinite(localLen) || localLen <= 1e-9) {
      return 0;
    }
    const radius = Math.max(0, ownerGeometry.anchorRadius);
    const localWorldPoint = makeWorldPoint((localDirection.x / localLen) * radius, (localDirection.y / localLen) * radius);
    const mapped = transform
      ? applyMatrixToVector(worldTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f), localWorldPoint)
      : localWorldPoint;
    return Math.hypot(mapped.x, mapped.y);
  }
  if (ownerGeometry.shape === "rectangle") {
    const transform = ownerGeometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(worldTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f));
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const hw = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const hh = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.max(Math.abs(localDirection.x) / hw, Math.abs(localDirection.y) / hh);
    if (!Number.isFinite(scale)) {
      return 0;
    }
    const localWorldPoint = makeWorldPoint(localDirection.x * scale, localDirection.y * scale);
    const mapped = transform
      ? applyMatrixToVector(worldTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f), localWorldPoint)
      : localWorldPoint;
    return Math.hypot(mapped.x, mapped.y);
  }
  if (ownerGeometry.shape === "ellipse") {
    const transform = ownerGeometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(worldTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f));
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const rx = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const ry = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.sqrt((localDirection.x * localDirection.x) / (rx * rx) + (localDirection.y * localDirection.y) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return 0;
    }
    const localWorldPoint = makeWorldPoint(localDirection.x * scale, localDirection.y * scale);
    const mapped = transform
      ? applyMatrixToVector(worldTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f), localWorldPoint)
      : localWorldPoint;
    return Math.hypot(mapped.x, mapped.y);
  }
  return 0;
}

function formatAdornmentAngle(rawDegrees: number): string {
  return formatNumber(normalizeDegrees(rawDegrees));
}

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}

function anchorFacingAway(degrees: number): string {
  const normalized = normalizeDegrees(degrees);
  if (normalized < 4 || normalized >= 356) {
    return "west";
  }
  if (normalized < 87) {
    return "south west";
  }
  if (normalized < 94) {
    return "south";
  }
  if (normalized < 177) {
    return "south east";
  }
  if (normalized < 184) {
    return "east";
  }
  if (normalized < 267) {
    return "north east";
  }
  if (normalized < 274) {
    return "north";
  }
  return "north west";
}

function anchorOffsetFromCenter(anchor: string, halfWidth: number, halfHeight: number): WorldPoint {
  switch (anchor) {
    case "west":
      return worldPoint(pt(-halfWidth), pt(0));
    case "east":
      return worldPoint(pt(halfWidth), pt(0));
    case "north":
      return worldPoint(pt(0), pt(halfHeight));
    case "south":
      return worldPoint(pt(0), pt(-halfHeight));
    case "north west":
      return worldPoint(pt(-halfWidth), pt(halfHeight));
    case "north east":
      return worldPoint(pt(halfWidth), pt(halfHeight));
    case "south west":
      return worldPoint(pt(-halfWidth), pt(-halfHeight));
    case "south east":
      return worldPoint(pt(halfWidth), pt(-halfHeight));
    default:
      return worldPoint(pt(0), pt(0));
  }
}

function resolveSceneTextWidth(text: Extract<SceneElement, { kind: "Text" }>): number {
  if (text.textBlockWidth != null && Number.isFinite(text.textBlockWidth)) {
    return Math.max(1, text.textBlockWidth);
  }
  const maxChars = text.text.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
  return Math.max(1, maxChars * text.style.fontSize * 0.7);
}

function resolveSceneTextHeight(text: Extract<SceneElement, { kind: "Text" }>): number {
  if (text.textBlockHeight != null && Number.isFinite(text.textBlockHeight)) {
    return Math.max(1, text.textBlockHeight);
  }
  return Math.max(1, text.text.split("\n").length) * text.style.fontSize * 1.15;
}

function resizeFrameWorldBounds(frame: ResizeFrame): WorldBounds {
  const worldCorners = [
    frame.cornersByRole["top-left"].world,
    frame.cornersByRole["top-right"].world,
    frame.cornersByRole["bottom-right"].world,
    frame.cornersByRole["bottom-left"].world
  ];
  return worldBounds(
    pt(Math.min(...worldCorners.map((corner) => corner.x))),
    pt(Math.min(...worldCorners.map((corner) => corner.y))),
    pt(Math.max(...worldCorners.map((corner) => corner.x))),
    pt(Math.max(...worldCorners.map((corner) => corner.y)))
  );
}

function resolveAdornmentBodyDragBox(
  elements: readonly SceneElement[]
): { center: WorldPoint; width: number; height: number } | null {
  let bounds: WorldBounds | null = null;
  for (const element of elements) {
    if (element.kind === "Path" && element.id.includes(":pin-edge:")) {
      continue;
    }
    const next = elementBoundsInWorld(element);
    if (!next) {
      continue;
    }
    bounds = bounds ? mergeWorldBounds(bounds, next) : next;
  }
  if (!bounds) {
    return null;
  }
  return {
    center: makeWorldPoint((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2),
    width: Math.max(1, bounds.maxX - bounds.minX),
    height: Math.max(1, bounds.maxY - bounds.minY)
  };
}

function resolvePrimarySourceCenter(
  elements: readonly SceneElement[],
  sourceId: string
): WorldPoint | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    if (element.sourceRef.sourceId !== sourceId || element.adornment) {
      continue;
    }
    const bounds = elementBoundsInWorld(element);
    if (!bounds) {
      continue;
    }
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return makeWorldPoint((minX + maxX) / 2, (minY + maxY) / 2);
}

function resolvePathAttachedDirectionalDistancePt(source: string, nodeId: string, direction: string): number {
  const resolved = resolvePropertyTarget(source, nodeId);
  if (resolved.kind !== "found" || resolved.target.kind !== "node-item" || !resolved.target.options) {
    return 0;
  }
  const normalizedDirection = normalizeDirectionKey(direction);
  let distancePt: number | null = null;
  for (const entry of resolved.target.options.entries) {
    if (entry.kind !== "kv" || normalizeDirectionKey(entry.key) !== normalizedDirection) {
      continue;
    }
    const parsed = parseLength(entry.valueRaw, "pt");
    if (parsed == null || !Number.isFinite(parsed)) {
      continue;
    }
    distancePt = Math.max(0, parsed);
  }
  return distancePt ?? 0;
}

function normalizeDirectionKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function elementBoundsInWorld(element: SceneElement): WorldBounds | null {
  if (element.kind === "Path") {
    const bounds = pathBoundsInWorld(element);
    return bounds ? applyTransformToBounds(bounds, element.transform) : null;
  }
  if (element.kind === "Circle") {
    return applyTransformToBounds(
      worldBounds(
        pt(element.center.x - element.radius),
        pt(element.center.y - element.radius),
        pt(element.center.x + element.radius),
        pt(element.center.y + element.radius)
      ),
      element.transform
    );
  }
  if (element.kind === "Ellipse") {
    return applyTransformToBounds(
      computeRotatedRectLikeEllipseBounds(element.center.x, element.center.y, element.rx, element.ry, element.rotation ?? 0),
      element.transform
    );
  }
  return applyTransformToBounds(
    computeRotatedRectBoundsLocal(
      element.position.x,
      element.position.y,
      resolveSceneTextWidth(element),
      resolveSceneTextHeight(element),
      element.rotation ?? 0
    ),
    element.transform
  );
}

function pathBoundsInWorld(path: Extract<SceneElement, { kind: "Path" }>): WorldBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: WorldPoint | null = null;

  const includeWorldPoint = (point: WorldPoint) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of path.commands) {
    if (command.kind === "Z") continue;
    if (command.kind === "C") {
      includeWorldPoint(command.c1);
      includeWorldPoint(command.c2);
    }
    if (command.kind === "A") {
      if (previous) {
        includeWorldPoint(makeWorldPoint(previous.x - command.rx, previous.y - command.ry));
        includeWorldPoint(makeWorldPoint(previous.x + command.rx, previous.y + command.ry));
      }
      includeWorldPoint(makeWorldPoint(command.to.x - command.rx, command.to.y - command.ry));
      includeWorldPoint(makeWorldPoint(command.to.x + command.rx, command.to.y + command.ry));
      previous = command.to;
      continue;
    }
    includeWorldPoint(command.to);
    previous = command.to;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function computeRotatedRectLikeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): WorldBounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
  return worldBounds(pt(cx - extentX), pt(cy - extentY), pt(cx + extentX), pt(cy + extentY));
}

function computeRotatedRectBoundsLocal(cx: number, cy: number, width: number, height: number, rotation: number): WorldBounds {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (Math.abs(rotation) <= 1e-6) {
    return worldBounds(pt(cx - halfWidth), pt(cy - halfHeight), pt(cx + halfWidth), pt(cy + halfHeight));
  }
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;
  return worldBounds(pt(cx - extentX), pt(cy - extentY), pt(cx + extentX), pt(cy + extentY));
}

function applyTransformToBounds(bounds: WorldBounds, transform: SceneElement["transform"]): WorldBounds {
  if (!transform) {
    return bounds;
  }
  const corners = [
    applyMatrix(transform, worldPoint(bounds.minX, bounds.minY)),
    applyMatrix(transform, worldPoint(bounds.minX, bounds.maxY)),
    applyMatrix(transform, worldPoint(bounds.maxX, bounds.minY)),
    applyMatrix(transform, worldPoint(bounds.maxX, bounds.maxY))
  ];
  let next = worldBounds(corners[0].x, corners[0].y, corners[0].x, corners[0].y);
  for (const corner of corners.slice(1)) {
    next = mergeWorldBounds(next, worldBounds(corner.x, corner.y, corner.x, corner.y));
  }
  return next;
}

function mergeWorldBounds(a: WorldBounds, b: WorldBounds): WorldBounds {
  return worldBounds(
    pt(Math.min(a.minX, b.minX)),
    pt(Math.min(a.minY, b.minY)),
    pt(Math.max(a.maxX, b.maxX)),
    pt(Math.max(a.maxY, b.maxY))
  );
}
