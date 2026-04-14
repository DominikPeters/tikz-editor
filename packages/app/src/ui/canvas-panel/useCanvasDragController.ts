import { useEffect, useRef } from "react";
import type { AdornmentOwnerGeometry } from "tikz-editor/ast/types";
import type { EditAction } from "tikz-editor/edit/actions";
import { parseEditableTargetId } from "tikz-editor/edit/editable-targets";
import { formatNumber } from "tikz-editor/edit/format";
import { worldToLocal } from "tikz-editor/edit/coords";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import { parseLength } from "tikz-editor/semantic/coords/parse-length";
import { intersectRayWithPolygon } from "tikz-editor/semantic/nodes/shape-geometry";
import {
  collectSelectionGeometryFromBounds,
  snapHandlePosition,
  snapSelectionTranslation,
  snapToolPointer,
  type SnapLine
} from "tikz-editor/edit/snapping";
import type { EditHandle, NodeAnchorTarget, Point, SceneElement } from "tikz-editor/semantic/types";
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

import {
  boundsFromPoints,
  createBezierTemplateFromBend,
  createTemplateForToolDrag,
  DEFAULT_GRID_TOOL_STEP_PT,
  formatTooltipAngleRow,
  formatTooltipGridCountRow,
  formatTooltipLengthRows,
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
import { resolveEndpointAnchorSnap, type MatrixCellAnchorHint } from "./endpoint-anchor-snap";
import { clientToWorldPoint, distanceSquared, worldToSvgPoint } from "./geometry";
import { PATH_TOOL_BEND_DRAG_THRESHOLD_PX, type PathToolGestureSegment } from "./path-tool";
import { resolveAddShapeOriginFromDrag } from "./add-shape-draft";
import { angleDeg, normalizeSignedDeg, resolveDraggedRotateDeg } from "./rotate-handle";
import type { ResizeFrame } from "./resize-frames";
import { resolveScopeAwareMarqueeSelection, type ScopeOverlayIndex } from "./scope-overlay";
import { toolCreateSnapKind } from "../tool-config";
import type {
  Bounds,
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
      world: Point,
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

    function pointChanged(a: Point, b: Point): boolean {
      return Math.abs(a.x - b.x) > SNAP_FEEDBACK_EPSILON || Math.abs(a.y - b.y) > SNAP_FEEDBACK_EPSILON;
    }

    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (drag.kind === "pan") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-pan-move",
          snapshotMatchesSource: snapshotSource === source,
          dragKind: "pan",
          rawDelta: { x: deltaX, y: deltaY },
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

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);
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
        const rows = formatTooltipLengthRows(size.width, size.height);
        if (drag.toolMode === "addGrid") {
          const counts = resolveGridTooltipCounts(drag.startWorld, drag.currentWorld);
          rows.push(formatTooltipGridCountRow(counts.columns, counts.rows));
        }
        setDragTooltip({
          kind: "tool-create",
          anchor: { x: event.clientX, y: event.clientY },
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
        const nextPoints = appendFreehandSamplePoint(world);
        if (nextPoints) {
          drag.points = nextPoints;
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
            ? projectResizeDimensionsFromOppositeCorner(world, drag.initialFrame, drag.role)
            : projectResizeDimensionsFromCenter(
              world,
              drag.initialFrame,
              drag.preserveAspectRatio,
              drag.preserveAspectDuringResize || event.shiftKey
            );
        setDragTooltip({
          kind: "resize",
          anchor: { x: event.clientX, y: event.clientY },
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
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        maybeTriggerSnapFeedback(false);
        const currentPointerAngleDeg = angleDeg(drag.centerWorld, world);
        const nextRotate = resolveDraggedRotateDeg({
          baseRotateDeg: drag.baseRotateDeg,
          startPointerAngleDeg: drag.startPointerAngleDeg,
          currentPointerAngleDeg,
          shiftKey: event.shiftKey,
          ctrlOrMetaKey: ctrlOrMeta,
          shiftSnapStepDeg: ROTATE_SHIFT_SNAP_STEP_DEG,
          magneticSnapStepDeg: ROTATE_SOFT_SNAP_STEP_DEG,
          magneticSnapThresholdDeg: ROTATE_SOFT_SNAP_THRESHOLD_DEG,
          roundToInteger: true
        });
        logSnapDebug({
          phase: "drag-rotate-move",
          snapshotMatchesSource: true,
          dragKind: "rotate",
          rawPoint: world,
          lines: []
        });
        setDragTooltip({
          kind: "rotate",
          anchor: { x: event.clientX, y: event.clientY },
          rows: [formatTooltipAngleRow(nextRotate)]
        });

        if (Math.abs(normalizeSignedDeg(nextRotate - drag.lastAppliedRotateDeg)) <= 1e-6) {
          return;
        }

        const ok = applyActionWithFeedback(
          {
            kind: "setProperty",
            elementId: drag.elementId,
            level: "command",
            key: "rotate",
            value: Math.abs(nextRotate) <= 1e-6 ? "" : formatNumber(nextRotate),
            clearKeys: ["/tikz/rotate"]
          },
          drag.historyMergeKey
        );
        if (ok.sourceChanged) {
          drag.lastAppliedRotateDeg = nextRotate;
        }
        return;
      }

      if (drag.kind === "element") {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
        if (drag.elementIds.length === 1) {
          const rawWorld = world;
          const dragStartWorld = drag.startWorld;
          const parsedTarget = parseEditableTargetId(drag.elementIds[0]!);
          if (parsedTarget.kind === "node-adornment") {
            let adornmentDrag = drag.adornmentDrag;
            if (!adornmentDrag) {
              const adornmentElements =
                snapshotScene?.elements.filter((element) => element.adornment?.targetId === parsedTarget.id) ?? [];
              const adornmentElement = selectPrimaryAdornmentElement(adornmentElements);
              const adornmentTextElement = adornmentElements.find((element): element is Extract<SceneElement, { kind: "Text" }> => element.kind === "Text");
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
                    pointerOffsetFromCenter: {
                      x: dragStartWorld.x - bodyDragBox.center.x,
                      y: dragStartWorld.y - bodyDragBox.center.y
                    },
                    halfWidth: Math.max(0.5, bodyDragBox.width / 2),
                    halfHeight: Math.max(0.5, bodyDragBox.height / 2)
                  }
                : undefined;
              adornmentDrag = {
                ownerPoint,
                ownerGeometry: adornmentElement?.adornment?.ownerGeometry,
                allowCenter: adornmentElement?.adornment?.kind === "label",
                pointerOffsetFromReference: {
                  x: dragStartWorld.x - referenceWorld.x,
                  y: dragStartWorld.y - referenceWorld.y
                },
                textDrag
              };
              drag.adornmentDrag = adornmentDrag;
            }
            const placementPoint = adornmentDrag.textDrag
              ? rawWorld
              : applyAdornmentPointerOffset(rawWorld, adornmentDrag.pointerOffsetFromReference);
            const placement = resolveAdornmentDragPlacement(placementPoint, adornmentDrag.ownerPoint, adornmentDrag.ownerGeometry, {
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
                newWorld: placementPoint,
                angleRaw: placement.angleRaw,
                distancePt: placement.distancePt
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
            const center = resolvePrimarySourceCenter(snapshotScene?.elements ?? [], drag.elementIds[0]!);
            if (handle?.pathAttachmentContext && center) {
              const initialAnchorPoint = pointAtPlacementSegment(
                handle.pathAttachmentContext.segment,
                handle.pathAttachmentContext.pos
              );
              pathAttachedNodeDrag = {
                nodeId: drag.elementIds[0]!,
                hostPathSourceId: handle.pathAttachmentContext.hostPathSourceId,
                pointerOffsetFromCenter: {
                  x: dragStartWorld.x - center.x,
                  y: dragStartWorld.y - center.y
                },
                initialCenter: center,
                initialAnchorPoint,
                initialAnchorOffset: {
                  x: center.x - initialAnchorPoint.x,
                  y: center.y - initialAnchorPoint.y
                },
                initialDistancePt:
                  handle.pathAttachmentContext.regime.kind === "explicit-direction"
                    ? resolvePathAttachedDirectionalDistancePt(source, drag.elementIds[0]!, handle.pathAttachmentContext.regime.direction)
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
                      drag.elementIds[0]!,
                      handle.pathAttachmentContext.regime.direction
                    );
                    return Math.max(0, initialDirectionalOffset - initialDistancePt);
                  })(),
                segment: handle.pathAttachmentContext.segment,
                regime: handle.pathAttachmentContext.regime,
                lastPreviewDelta: { x: 0, y: 0 }
              };
              drag.pathAttachedNodeDrag = pathAttachedNodeDrag;
            }
          }
          if (pathAttachedNodeDrag) {
            const desiredCenter = {
              x: rawWorld.x - pathAttachedNodeDrag.pointerOffsetFromCenter.x,
              y: rawWorld.y - pathAttachedNodeDrag.pointerOffsetFromCenter.y
            };
            const closest = closestPointOnPlacementSegment(pathAttachedNodeDrag.segment, desiredCenter);
            const snapped = resolvePathPositionPreset(closest.t, pathAttachedNodeDrag.segment);
            const targetPoint = pointAtPlacementSegment(pathAttachedNodeDrag.segment, snapped.snappedT);
            const currentCenter =
              resolvePrimarySourceCenter(snapshotScene?.elements ?? [], pathAttachedNodeDrag.nodeId) ??
              pathAttachedNodeDrag.initialCenter;
            const anchorOffset = pathAttachedNodeDrag.initialAnchorOffset;
            const previewCenter = {
              x: targetPoint.x + anchorOffset.x,
              y: targetPoint.y + anchorOffset.y
            };
            const tangent = tangentAtPlacementSegment(pathAttachedNodeDrag.segment, snapped.snappedT);
            const previewDelta = {
              x: previewCenter.x - currentCenter.x,
              y: previewCenter.y - currentCenter.y
            };
            const tangentLength = Math.hypot(tangent.x, tangent.y);
            const tangentUnit =
              tangentLength > 1e-6
                ? { x: tangent.x / tangentLength, y: tangent.y / tangentLength }
                : { x: 1, y: 0 };
            const tangentialDelta =
              previewDelta.x * tangentUnit.x + previewDelta.y * tangentUnit.y;
            const normalPreviewDelta = {
              x: previewDelta.x - tangentialDelta * tangentUnit.x,
              y: previewDelta.y - tangentialDelta * tangentUnit.y
            };
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
            const offset = {
              x: desiredCenter.x - targetPoint.x,
              y: desiredCenter.y - targetPoint.y
            };
            const cross = tangent.x * offset.y - tangent.y * offset.x;
            let sideUpdate:
              | { kind: "auto-side"; side: "left" | "right" }
              | { kind: "explicit-direction"; direction: string };
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
            } else {
              const resolvedDirection = resolveDraggedPathAttachedNodeDirection(
                targetPoint,
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
            }
            const placementKey =
              `${formatNumber(snapped.snappedT)}:${sideUpdate.kind}:${sideUpdate.kind === "auto-side" ? sideUpdate.side : sideUpdate.direction}` +
              (distanceUpdatePt == null ? "" : `:${formatNumber(distanceUpdatePt)}`);
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
                distanceUpdatePt
              },
              drag.historyMergeKey
            );
            pathAttachedNodeDrag.lastAppliedPlacementKey = placementKey;
            return;
          }
        }
        const rawTotalDelta = {
          x: world.x - drag.startWorld.x,
          y: world.y - drag.startWorld.y
        };
        const snapped = drag.snapContext && drag.initialSelection
          ? snapSelectionTranslation({
              context: drag.snapContext,
              selection: drag.initialSelection,
              rawDelta: rawTotalDelta,
              modifiers: { ctrlOrMeta }
            })
          : {
              snappedDelta: rawTotalDelta,
              offset: undefined,
              lines: [] as SnapLine[]
            };
        const totalDelta = snapped.snappedDelta ?? rawTotalDelta;
        const actualTotalDelta = drag.lastAppliedTotalDelta;
        const incremental = {
          x: totalDelta.x - actualTotalDelta.x,
          y: totalDelta.y - actualTotalDelta.y
        };
        setSnapLines(snapped.lines);
        maybeTriggerSnapFeedback(snapped.lines.length > 0);
        logSnapDebug({
          phase: "drag-element-move",
          snapshotMatchesSource: true,
          dragKind: "element",
          context: drag.snapContext,
          rawDelta: rawTotalDelta,
          snappedDelta: totalDelta,
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
            delta: incremental
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
        nextWorld = snapGridResizePoint(nextWorld, drag.gridResizeSnap);
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

    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      resetSnapFeedbackState();
      suppressNextBackgroundClickRef.current = true;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      const currentSvg = svgResultRef.current;
      const world =
        currentSvg == null
          ? null
          : clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);

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
        const finalPointerWorld = finalEndpointAnchor?.world ?? rawFinalWorld;
        const snapKind = toolCreateSnapKind(drag.toolMode);
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: finalPointerWorld,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: finalPointerWorld, lines: [] as SnapLine[] };
        const snappedWorld = snapped.snappedPoint ?? finalPointerWorld;
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
                        anchor: drag.startEndpointAnchor.anchor
                      }
                    }
                  : {}),
                ...(rawTemplate.to && finalEndpointAnchor
                  ? {
                      toAnchor: {
                        nodeName: finalEndpointAnchor.nodeName,
                        anchor: finalEndpointAnchor.anchor
                      }
                    }
                  : {})
              }
            : rawTemplate;
        const insertionAt =
          drag.toolMode === "addShape"
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

        queueSelectionForAddedElement({
          x: (drag.startWorld.x + drag.endWorld.x) / 2,
          y: (drag.startWorld.y + drag.endWorld.y) / 2
        });
        const template = createBezierTemplateFromBend(drag.startWorld, drag.endWorld, finalBend);
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
        let nextPoints: Point[] | null = null;
        if (world) {
          nextPoints = appendFreehandSamplePoint(world);
          if (nextPoints) {
            drag.points = nextPoints;
          }
          setToolCursorWorld(world);
        }
        setSnapLines([]);
        finalizeFreehandDraft(nextPoints ?? undefined);
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
              anchor: drag.activeEndpointAnchor.anchor
            },
            drag.historyMergeKey
          );
        }
      }

      setNodeAnchorOverlay(null);
      setSnapLines([]);
      setDragTooltip(null);
      setDragState(null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    applyActionWithFeedback,
    dispatch,
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
    nodeAnchorTargets,
    matrixCellAnchorHints,
    scopeOverlay,
    source,
    sourceBoundsSvgRef,
    svgResult,
    svgResultRef
  ]);
}

function snapGridResizePoint(point: Point, config: GridResizeSnapConfig): Point {
  const localPoint = worldToLocal(point, config.transform);
  const anchorLocal = worldToLocal(config.anchorWorld, config.transform);
  if (!localPoint || !anchorLocal) {
    return point;
  }

  const snappedLocal = {
    x: anchorLocal.x + snapDeltaToStep(localPoint.x - anchorLocal.x, config.stepX),
    y: anchorLocal.y + snapDeltaToStep(localPoint.y - anchorLocal.y, config.stepY)
  };
  return applyMatrix(config.transform, snappedLocal);
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

function resolveAdornmentDragReferenceWorld(element: SceneElement | null): Point | null {
  if (!element?.adornment) {
    return null;
  }
  return resolveAdornmentReferenceWorld(element.adornment);
}

function resolveAdornmentReferenceWorld(adornment: NonNullable<SceneElement["adornment"]>): Point | null {
  const ownerCenter = adornment.ownerGeometry?.center ?? adornment.ownerPoint;
  if (!ownerCenter) {
    return null;
  }
  const parsedAngle = parseAdornmentAngleDegrees(adornment.angleRaw);
  if (parsedAngle == null) {
    return null;
  }
  if (parsedAngle.kind === "center") {
    return { ...ownerCenter };
  }
  const radians = (parsedAngle.degrees * Math.PI) / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const borderDistance = resolveAdornmentOwnerBorderDistance(adornment.ownerGeometry, direction);
  const distancePt = Math.max(0, adornment.distancePt ?? 0);
  return {
    x: ownerCenter.x + direction.x * (borderDistance + distancePt),
    y: ownerCenter.y + direction.y * (borderDistance + distancePt)
  };
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
    return { kind: "angle", degrees: namedDegrees[normalized]! };
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

export function applyAdornmentPointerOffset(pointerWorld: Point, pointerOffsetFromReference: Point): Point {
  return {
    x: pointerWorld.x - pointerOffsetFromReference.x,
    y: pointerWorld.y - pointerOffsetFromReference.y
  };
}

export function resolveAdornmentDragPlacement(
  point: Point,
  ownerPoint: Point,
  ownerGeometry: AdornmentOwnerGeometry | undefined,
  options: {
    allowCenter: boolean;
    textDrag?: {
      pointerOffsetFromCenter: Point;
      halfWidth: number;
      halfHeight: number;
    };
  }
): { angleRaw: string; distancePt: number } | null {
  if (options.textDrag) {
    const desiredCenter = {
      x: point.x - options.textDrag.pointerOffsetFromCenter.x,
      y: point.y - options.textDrag.pointerOffsetFromCenter.y
    };
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

  const resolvedReferencePoint = point;
  const center = ownerGeometry?.center ?? ownerPoint;
  const dx = resolvedReferencePoint.x - center.x;
  const dy = resolvedReferencePoint.y - center.y;
  const radius = Math.sqrt(dx * dx + dy * dy);
  if (options.allowCenter && radius <= ADORNMENT_CENTER_SNAP_THRESHOLD_PT) {
    return { angleRaw: "center", distancePt: 0 };
  }

  const placement = derivePlacementFromReferencePoint(resolvedReferencePoint, ownerPoint, ownerGeometry);
  if (options.allowCenter && placement.radialDistanceFromCenter <= placement.borderDistance + ADORNMENT_CENTER_SNAP_THRESHOLD_PT) {
    return { angleRaw: "center", distancePt: 0 };
  }
  return {
    angleRaw: formatAdornmentAngle(placement.angleDeg),
    distancePt: placement.distancePt
  };
}

function resolvePlacementFromDesiredCenter(input: {
  desiredCenter: Point;
  ownerPoint: Point;
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
    const desiredReference = {
      x: input.desiredCenter.x + anchorOffset.x,
      y: input.desiredCenter.y + anchorOffset.y
    };
    const projectedDistance =
      (desiredReference.x - geometry.borderPoint.x) * geometry.shiftDirection.x +
      (desiredReference.y - geometry.borderPoint.y) * geometry.shiftDirection.y;
    const distancePt = Math.max(0, projectedDistance);
    const referencePoint = {
      x: geometry.borderPoint.x + geometry.shiftDirection.x * distancePt,
      y: geometry.borderPoint.y + geometry.shiftDirection.y * distancePt
    };
    const resolvedCenter = {
      x: referencePoint.x - anchorOffset.x,
      y: referencePoint.y - anchorOffset.y
    };
    const errorSq = distanceSquared(resolvedCenter, input.desiredCenter);
    if (!best || errorSq < best.errorSq) {
      best = {
        angleDeg: normalizeDegrees(angleDeg),
        distancePt,
        anchor,
        borderDistance: geometry.borderDistance,
        radialDistanceFromCenter: Math.max(
          0,
          (referencePoint.x - geometry.ownerCenter.x) * geometry.polarDirection.x +
            (referencePoint.y - geometry.ownerCenter.y) * geometry.polarDirection.y
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
  ownerPoint: Point,
  ownerGeometry: AdornmentOwnerGeometry | undefined
): {
  ownerCenter: Point;
  polarDirection: Point;
  borderDistance: number;
  borderPoint: Point;
  shiftDirection: Point;
  anchor: string;
} {
  const ownerCenter = ownerGeometry?.center ?? ownerPoint;
  const normalizedAngle = normalizeDegrees(angleDeg);
  const polarDirection = pointOnUnitCircle(normalizedAngle);
  const borderDistance = resolveAdornmentOwnerBorderDistance(ownerGeometry, polarDirection);
  const borderPoint = {
    x: ownerCenter.x + polarDirection.x * borderDistance,
    y: ownerCenter.y + polarDirection.y * borderDistance
  };
  const centerToBorder = {
    x: borderPoint.x - ownerCenter.x,
    y: borderPoint.y - ownerCenter.y
  };
  const centerToBorderLength = Math.hypot(centerToBorder.x, centerToBorder.y);
  const shiftDirection = centerToBorderLength <= ADORNMENT_OWNER_CENTER_EPSILON
    ? polarDirection
    : {
        x: centerToBorder.x / centerToBorderLength,
        y: centerToBorder.y / centerToBorderLength
      };
  const anchor = centerToBorderLength <= ADORNMENT_OWNER_CENTER_EPSILON
    ? anchorFacingAway(normalizedAngle)
    : autoAnchorFromVector({ x: shiftDirection.y, y: -shiftDirection.x });
  return {
    ownerCenter,
    polarDirection,
    borderDistance,
    borderPoint,
    shiftDirection,
    anchor
  };
}

function derivePlacementFromReferencePoint(
  referencePoint: Point,
  ownerPoint: Point,
  ownerGeometry: AdornmentOwnerGeometry | undefined
): {
  angleDeg: number;
  distancePt: number;
  anchor: string;
  borderDistance: number;
  radialDistanceFromCenter: number;
  referencePoint: Point;
} {
  const ownerCenter = ownerGeometry?.center ?? ownerPoint;
  const angleDeg = normalizeDegrees((Math.atan2(referencePoint.y - ownerCenter.y, referencePoint.x - ownerCenter.x) * 180) / Math.PI);
  const polarDirection = pointOnUnitCircle(angleDeg);
  const borderDistance = resolveAdornmentOwnerBorderDistance(ownerGeometry, polarDirection);
  const borderPoint = {
    x: ownerCenter.x + polarDirection.x * borderDistance,
    y: ownerCenter.y + polarDirection.y * borderDistance
  };
  const centerToBorder = {
    x: borderPoint.x - ownerCenter.x,
    y: borderPoint.y - ownerCenter.y
  };
  const centerToBorderLength = Math.hypot(centerToBorder.x, centerToBorder.y);
  const simple = centerToBorderLength <= ADORNMENT_OWNER_CENTER_EPSILON;
  const shiftDirection = simple
    ? polarDirection
    : {
        x: centerToBorder.x / centerToBorderLength,
        y: centerToBorder.y / centerToBorderLength
      };
  const radialDistanceFromCenter = Math.max(0, (referencePoint.x - ownerCenter.x) * polarDirection.x + (referencePoint.y - ownerCenter.y) * polarDirection.y);
  const distancePt = Math.max(
    0,
    (referencePoint.x - borderPoint.x) * shiftDirection.x +
      (referencePoint.y - borderPoint.y) * shiftDirection.y
  );
  const anchor = simple
    ? anchorFacingAway(angleDeg)
    : autoAnchorFromVector({ x: shiftDirection.y, y: -shiftDirection.x });
  const resolvedReferencePoint = {
    x: borderPoint.x + shiftDirection.x * distancePt,
    y: borderPoint.y + shiftDirection.y * distancePt
  };
  return {
    angleDeg,
    distancePt,
    anchor,
    borderDistance,
    radialDistanceFromCenter,
    referencePoint: resolvedReferencePoint
  };
}

function pointOnUnitCircle(angleDeg: number): Point {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function autoAnchorFromVector(vector: Point): string {
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
  direction: Point
): number {
  if (!ownerGeometry || ownerGeometry.shape === "coordinate") {
    return 0;
  }
  if (ownerGeometry.anchorPolygon && ownerGeometry.anchorPolygon.length >= 3) {
    const hit = intersectRayWithPolygon({ x: 0, y: 0 }, direction, ownerGeometry.anchorPolygon);
    return hit ? Math.sqrt(hit.x * hit.x + hit.y * hit.y) : 0;
  }
  if (ownerGeometry.shape === "circle") {
    const transform = ownerGeometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const localLen = Math.hypot(localDirection.x, localDirection.y);
    if (!Number.isFinite(localLen) || localLen <= 1e-9) {
      return 0;
    }
    const radius = Math.max(0, ownerGeometry.anchorRadius);
    const localPoint = {
      x: (localDirection.x / localLen) * radius,
      y: (localDirection.y / localLen) * radius
    };
    const mapped = transform ? applyMatrixToVector(transform, localPoint) : localPoint;
    return Math.hypot(mapped.x, mapped.y);
  }
  if (ownerGeometry.shape === "rectangle") {
    const transform = ownerGeometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const hw = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const hh = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.max(Math.abs(localDirection.x) / hw, Math.abs(localDirection.y) / hh);
    if (!Number.isFinite(scale)) {
      return 0;
    }
    const localPoint = {
      x: localDirection.x * scale,
      y: localDirection.y * scale
    };
    const mapped = transform ? applyMatrixToVector(transform, localPoint) : localPoint;
    return Math.hypot(mapped.x, mapped.y);
  }
  if (ownerGeometry.shape === "ellipse") {
    const transform = ownerGeometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return direction;
      const inverse = inverseMatrix(transform);
      if (!inverse) return direction;
      return applyMatrixToVector(inverse, direction);
    })();
    const rx = Math.max(ownerGeometry.anchorHalfWidth, 1e-6);
    const ry = Math.max(ownerGeometry.anchorHalfHeight, 1e-6);
    const scale = 1 / Math.sqrt((localDirection.x * localDirection.x) / (rx * rx) + (localDirection.y * localDirection.y) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return 0;
    }
    const localPoint = {
      x: localDirection.x * scale,
      y: localDirection.y * scale
    };
    const mapped = transform ? applyMatrixToVector(transform, localPoint) : localPoint;
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

function anchorOffsetFromCenter(anchor: string, halfWidth: number, halfHeight: number): Point {
  switch (anchor) {
    case "west":
      return { x: -halfWidth, y: 0 };
    case "east":
      return { x: halfWidth, y: 0 };
    case "north":
      return { x: 0, y: halfHeight };
    case "south":
      return { x: 0, y: -halfHeight };
    case "north west":
      return { x: -halfWidth, y: halfHeight };
    case "north east":
      return { x: halfWidth, y: halfHeight };
    case "south west":
      return { x: -halfWidth, y: -halfHeight };
    case "south east":
      return { x: halfWidth, y: -halfHeight };
    default:
      return { x: 0, y: 0 };
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

function resizeFrameWorldBounds(frame: ResizeFrame): { minX: number; minY: number; maxX: number; maxY: number } {
  const worldCorners = [
    frame.cornersByRole["top-left"].world,
    frame.cornersByRole["top-right"].world,
    frame.cornersByRole["bottom-right"].world,
    frame.cornersByRole["bottom-left"].world
  ];
  return {
    minX: Math.min(...worldCorners.map((corner) => corner.x)),
    minY: Math.min(...worldCorners.map((corner) => corner.y)),
    maxX: Math.max(...worldCorners.map((corner) => corner.x)),
    maxY: Math.max(...worldCorners.map((corner) => corner.y))
  };
}

function resolveAdornmentBodyDragBox(
  elements: readonly SceneElement[]
): { center: Point; width: number; height: number } | null {
  let bounds: Bounds | null = null;
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
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    },
    width: Math.max(1, bounds.maxX - bounds.minX),
    height: Math.max(1, bounds.maxY - bounds.minY)
  };
}

function resolvePrimarySourceCenter(
  elements: readonly SceneElement[],
  sourceId: string
): Point | null {
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
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
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

function elementBoundsInWorld(element: SceneElement): Bounds | null {
  if (element.kind === "Path") {
    const bounds = pathBoundsInWorld(element);
    return bounds ? applyTransformToBounds(bounds, element.transform) : null;
  }
  if (element.kind === "Circle") {
    return applyTransformToBounds({
      minX: element.center.x - element.radius,
      minY: element.center.y - element.radius,
      maxX: element.center.x + element.radius,
      maxY: element.center.y + element.radius
    }, element.transform);
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

function pathBoundsInWorld(path: Extract<SceneElement, { kind: "Path" }>): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: Point | null = null;

  const includePoint = (point: Point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of path.commands) {
    if (command.kind === "Z") continue;
    if (command.kind === "C") {
      includePoint(command.c1);
      includePoint(command.c2);
    }
    if (command.kind === "A") {
      if (previous) {
        includePoint({ x: previous.x - command.rx, y: previous.y - command.ry });
        includePoint({ x: previous.x + command.rx, y: previous.y + command.ry });
      }
      includePoint({ x: command.to.x - command.rx, y: command.to.y - command.ry });
      includePoint({ x: command.to.x + command.rx, y: command.to.y + command.ry });
      previous = command.to;
      continue;
    }
    includePoint(command.to);
    previous = command.to;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function computeRotatedRectLikeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): Bounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minY: cy - extentY,
    maxY: cy + extentY
  };
}

function computeRotatedRectBoundsLocal(cx: number, cy: number, width: number, height: number, rotation: number): Bounds {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (Math.abs(rotation) <= 1e-6) {
    return {
      minX: cx - halfWidth,
      maxX: cx + halfWidth,
      minY: cy - halfHeight,
      maxY: cy + halfHeight
    };
  }
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;
  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minY: cy - extentY,
    maxY: cy + extentY
  };
}

function applyTransformToBounds(bounds: Bounds, transform: SceneElement["transform"]): Bounds {
  if (!transform) {
    return bounds;
  }
  const corners = [
    applyMatrix(transform, { x: bounds.minX, y: bounds.minY }),
    applyMatrix(transform, { x: bounds.minX, y: bounds.maxY }),
    applyMatrix(transform, { x: bounds.maxX, y: bounds.minY }),
    applyMatrix(transform, { x: bounds.maxX, y: bounds.maxY })
  ];
  let next = {
    minX: corners[0]!.x,
    minY: corners[0]!.y,
    maxX: corners[0]!.x,
    maxY: corners[0]!.y
  };
  for (const corner of corners.slice(1)) {
    next = mergeWorldBounds(next, {
      minX: corner!.x,
      minY: corner!.y,
      maxX: corner!.x,
      maxY: corner!.y
    });
  }
  return next;
}

function mergeWorldBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}
