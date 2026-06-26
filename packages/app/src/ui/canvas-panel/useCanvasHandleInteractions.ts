import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { clientPoint as makeClientPoint, px } from "tikz-editor/coords/index";
import {
  resolveTransformInspectorMutationContext,
  resolveTransformInspectorMutationContextFromOptionEntries
} from "tikz-editor/edit/property-write-builders";
import { buildSnapContext, type SnapGuideInput, type SnapLine, type SnapSettingsPatch } from "tikz-editor/edit/snapping";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type { EditHandle, SceneElement, ScenePath } from "tikz-editor/semantic/types";
import type { WorldBounds, WorldPoint } from "../coords/types";
import type { NodeItem } from "tikz-editor/ast/types";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import type { CanvasTransform, ToolMode } from "../../store/types";
import { clientToWorldPoint } from "./geometry";
import { isAdditiveSelectionModifier, isResizeHandleAdditiveSelectionModifier } from "./selection-modifiers";
import { resolveResizeFrameForSource, type ResizeFrame } from "./resize-frames";
import { angleDeg } from "./rotate-handle";
import { resolveFrameBasis } from "./interaction-helpers";
import {
  ellipseAspectRatioForSource,
  findPathStatementById,
  getHandleCursor,
  makeMergeKey,
  resolveGridResizeSnapForHandleDrag,
  resolveScenePathShapeHint,
  resizeCursorForRole
} from "./panel-helpers";
import type { DragCapability } from "./drag-capability";
import type {
  CanvasDispatch,
  CanvasEditParseOptions,
  CanvasSnapshot,
  DragState,
  NodeAnchorOverlayState,
  SnapDebugLogInput,
  StateSetter,
  ValueSetter
} from "./types";

export type UseCanvasHandleInteractionsArgs = {
  svgResult: CanvasSnapshot["svg"];
  toolMode: ToolMode;
  viewportRef: RefObject<HTMLDivElement | null>;
  dispatch: CanvasDispatch;
  closeTextEditingSession: () => void;
  setNodeAnchorOverlay: StateSetter<NodeAnchorOverlayState | null>;
  selectedElementIds: ReadonlySet<string>;
  dragCapability: DragCapability;
  directManipulationDisabledReasonBySourceId?: ReadonlyMap<string, string>;
  snapshot: CanvasSnapshot;
  source: string;
  setWarning: StateSetter<string | null>;
  setSnapLines: StateSetter<SnapLine[]>;
  logSnapDebug: (input: SnapDebugLogInput) => void;
  snapGuideInput: SnapGuideInput;
  snapSettingsPatch: SnapSettingsPatch;
  canvasTransform: CanvasTransform;
  viewportWorldBounds: WorldBounds | null;
  resizeFramesBySource: ReadonlyMap<string, ResizeFrame | null>;
  setDragState: ValueSetter<DragState | null>;
  interactionSvgRef: RefObject<SVGSVGElement | null>;
  parseOptions?: CanvasEditParseOptions;
};

function isCornerResizeRole(role: ResizeRole): role is Extract<ResizeRole, "top-left" | "top-right" | "bottom-left" | "bottom-right"> {
  return role === "top-left" || role === "top-right" || role === "bottom-left" || role === "bottom-right";
}

function aspectRatioForResizeFrame(frame: ResizeFrame): number | null {
  const basis = resolveFrameBasis(frame);
  return basis.width > 1e-6 && basis.height > 1e-6
    ? basis.height / basis.width
    : null;
}

function normalizeResizeRoleForNodeShapeFrame(role: ResizeRole, frame: ResizeFrame, enabled: boolean): ResizeRole {
  if (!enabled || !isCornerResizeRole(role)) {
    return role;
  }
  const corner = frame.cornersByRole[role].world;
  const vector = {
    x: corner.x - frame.centerWorld.x,
    y: corner.y - frame.centerWorld.y
  };
  const absX = Math.abs(vector.x);
  const absY = Math.abs(vector.y);
  const major = Math.max(absX, absY);
  const minor = Math.min(absX, absY);
  if (major <= 1e-6) {
    return role;
  }

  // Shapes like diamonds expose N/E/S/W points through corner roles; route them as axis-resize roles.
  if (minor > major * 0.1) {
    return role;
  }
  if (absX >= absY) {
    return vector.x >= 0 ? "right" : "left";
  }
  return vector.y >= 0 ? "top" : "bottom";
}

export function useCanvasHandleInteractions(args: UseCanvasHandleInteractionsArgs) {
  const {
    svgResult,
    toolMode,
    viewportRef,
    dispatch,
    closeTextEditingSession,
    setNodeAnchorOverlay,
    selectedElementIds,
    dragCapability,
    directManipulationDisabledReasonBySourceId,
    snapshot,
    source,
    setWarning,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    resizeFramesBySource,
    setDragState,
    interactionSvgRef,
    parseOptions
  } = args;

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = isAdditiveSelectionModifier(event);

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      closeTextEditingSession();
      setNodeAnchorOverlay(null);
      dispatch({ type: "SET_ACTIVE_HANDLE", handleId: handle.id });

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: handle.sourceRef.sourceId, additive: true });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(handle.sourceRef.sourceId)) {
        dispatch({ type: "SELECT", id: handle.sourceRef.sourceId, additive: false });
      }

      if (!dragCapability.draggableHandleIds.has(handle.id)) {
        const reason = directManipulationDisabledReasonBySourceId?.get(handle.sourceRef.sourceId);
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
          phase: "drag-start-handle",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "handle",
          rawPoint: handle.world,
          lines: []
        });
        return;
      }

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: [handle.sourceRef.sourceId],
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      setSnapLines([]);
      const handleCursor = getHandleCursor(handle, snapshot.scene, snapshot.editHandles);
      const gridResizeSnap = resolveGridResizeSnapForHandleDrag(
        handle,
        snapshot.editHandles,
        snapshot.parseResult?.figure.body
      );

      setDragState({
        kind: "handle",
        pointerId: event.pointerId,
        handleId: handle.id,
        sourceId: handle.sourceRef.sourceId,
        handleKind: handle.kind,
        cursor: handleCursor,
        lastKnownWorld: { ...handle.world },
        snapContext,
        gridResizeSnap,
        historyMergeKey: makeMergeKey("drag-handle", handle.id, event.pointerId),
        activeEndpointAnchor: null
      });
      logSnapDebug({
        phase: "drag-start-handle",
        snapshotMatchesSource: true,
        dragKind: "handle",
        context: snapContext,
        rawPoint: handle.world,
        lines: []
      });
    },
    [
      canvasTransform.scale,
      directManipulationDisabledReasonBySourceId,
      dispatch,
      dragCapability.draggableHandleIds,
      logSnapDebug,
      selectedElementIds,
      setDragState,
      setNodeAnchorOverlay,
      setSnapLines,
      closeTextEditingSession,
      setWarning,
      snapshot.editHandles,
      snapshot.parseResult,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportRef,
      viewportWorldBounds
    ]
  );

  const onResizeHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, role: ResizeRole, cursor: string) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      if (cursor === "not-allowed") {
        const reason = directManipulationDisabledReasonBySourceId?.get(sourceId);
        if (reason) {
          setWarning(reason);
        }
        setSnapLines([]);
        return;
      }
      const propertyTarget = resolvePropertyTarget(source, sourceId, parseOptions);
      if (
        sourceId.includes(":tree-child:")
        || sourceId.includes(":matrix-cell:")
        || (propertyTarget.kind !== "not-found" && propertyTarget.target.kind === "matrix-statement")
      ) {
        // Tree descendants, matrix cells, and matrix statements intentionally show corner handles for visual consistency,
        // but resize drag is not enabled yet.
        return;
      }
      const additiveSelection = isResizeHandleAdditiveSelectionModifier(event);

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      closeTextEditingSession();

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: sourceId, additive: true });
        return;
      }

      const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));
      const world = clientToWorldPoint(clientPoint, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-resize",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "resize",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      const statements = snapshot.parseResult?.figure.body;
      const sourceElements = snapshot.scene?.elements.filter((element) => element.sourceRef.sourceId === sourceId) ?? [];
      const pathElement = sourceElements.find((element): element is ScenePath => element.kind === "Path");
      const pathShapeHint = pathElement ? resolveScenePathShapeHint(pathElement, statements, sourceId) : undefined;
      const isCircleResizeSource =
        pathShapeHint === "circle" || sourceElements.some((element) => element.kind === "Circle");
      const initialScopeTransform = sourceId.startsWith("scope:")
        ? resolveTransformInspectorMutationContext(source, sourceId, parseOptions).values
        : null;
      const initialFrame =
        resizeFramesBySource?.get(sourceId) ??
        resolveResizeFrameForSource(
          snapshot.scene?.elements ?? [],
          snapshot.editHandles,
          sourceId,
          svgResult.viewBox,
          pathShapeHint
        );
      if (!initialFrame) {
        setWarning("Resize tooltip needs a resolvable resize frame.");
        return;
      }
      const normalizedRole = normalizeResizeRoleForNodeShapeFrame(
        role,
        initialFrame,
        pathElement != null && pathShapeHint == null
      );
      const frameAspectRatio = aspectRatioForResizeFrame(initialFrame);

      setSnapLines([]);
      setDragState({
        kind: "resize",
        pointerId: event.pointerId,
        elementId: sourceId,
        role: normalizedRole,
        cursor: cursor || resizeCursorForRole(normalizedRole),
        preserveAspectRatio: isCircleResizeSource
          ? 1
          : ellipseAspectRatioForSource(snapshot.scene?.elements ?? [], sourceId) ?? frameAspectRatio,
        initialFrame,
        initialScopeTransform,
        measurementMode: pathShapeHint === "rectangle" || sourceId.startsWith("scope:") ? "opposite-corner" : "center",
        preserveAspectDuringResize: isCircleResizeSource,
        historyMergeKey: makeMergeKey("drag-resize", `${sourceId}:${normalizedRole}`, event.pointerId)
      });
      logSnapDebug({
        phase: "drag-start-resize",
        snapshotMatchesSource: true,
        dragKind: "resize",
        rawPoint: world,
        lines: []
      });
    },
    [
      dispatch,
      interactionSvgRef,
      logSnapDebug,
      resizeFramesBySource,
      selectedElementIds,
      setDragState,
      setSnapLines,
      closeTextEditingSession,
      setWarning,
      directManipulationDisabledReasonBySourceId,
      snapshot.editHandles,
      snapshot.parseResult,
      snapshot.scene,
      snapshot.source,
      parseOptions,
      source,
      svgResult,
      toolMode,
      viewportRef
    ]
  );

  const resolveRotateWriteTargetIdInternal = useCallback(
    (sourceId: string): string => {
      const statements = snapshot.parseResult?.figure.body;
      if (statements) {
        const statement = findPathStatementById(statements, sourceId);
        if (statement?.command === "node") {
          const inlineNode = statement.items.find((item): item is NodeItem => item.kind === "Node");
          if (inlineNode) {
            return inlineNode.id;
          }
        }
      }

      const sourceElements: SceneElement[] = snapshot.scene?.elements.filter((element) => element.sourceRef.sourceId === sourceId) ?? [];
      const preferredElements = sourceElements.filter((element) => element.kind !== "Text");
      const candidates = preferredElements.length > 0 ? preferredElements : sourceElements;
      let fallbackTargetId: string | null = null;
      for (const element of candidates) {
        const commandEntry = [...element.styleChain].reverse().find((entry) => entry.kind === "command");
        const targetId = commandEntry?.sourceRef?.sourceId?.trim();
        if (!targetId) {
          continue;
        }
        const resolvedTarget = resolvePropertyTarget(source, targetId, parseOptions);
        if (resolvedTarget.kind !== "found") {
          continue;
        }
        if (resolvedTarget.target.kind === "node-item") {
          return targetId;
        }
        if (resolvedTarget.target.options) {
          return targetId;
        }
        fallbackTargetId ??= targetId;
      }
      return fallbackTargetId ?? sourceId;
    },
    [parseOptions, snapshot.parseResult, snapshot.scene, source]
  );

  const onRotateHandlePointerDown = useCallback(
    (
      event: ReactPointerEvent<SVGElement>,
      sourceId: string,
      centerWorld: WorldPoint,
      centerPivotWorld: WorldPoint,
      cursor: string
    ) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      if (cursor === "not-allowed") {
        const reason = directManipulationDisabledReasonBySourceId?.get(sourceId);
        if (reason) {
          setWarning(reason);
        }
        setSnapLines([]);
        return;
      }

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      closeTextEditingSession();
      setNodeAnchorOverlay(null);

      const clientPoint = makeClientPoint(px(event.clientX), px(event.clientY));
      const world = clientToWorldPoint(clientPoint, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-rotate",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "rotate",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      const rotateTargetId = resolveRotateWriteTargetIdInternal(sourceId);
      const resolvedRotateTarget = resolvePropertyTarget(source, rotateTargetId, parseOptions);
      const transformContext =
        resolvedRotateTarget.kind === "found"
          ? resolveTransformInspectorMutationContextFromOptionEntries(resolvedRotateTarget.target.options?.entries)
          : resolveTransformInspectorMutationContextFromOptionEntries(null);
      const baseRotateDeg = transformContext.values.rotate;
      const startPointerAngleDeg = angleDeg(centerWorld, world);
      const startCenterPivotPointerAngleDeg = angleDeg(centerPivotWorld, world);

      setSnapLines([]);
      setDragState({
        kind: "rotate",
        pointerId: event.pointerId,
        elementId: rotateTargetId,
        sourceId,
        cursor: cursor === "not-allowed" ? "not-allowed" : "grabbing",
        centerWorld,
        startPointerAngleDeg,
        centerPivotWorld,
        startCenterPivotPointerAngleDeg,
        baseRotateDeg,
        lastAppliedRotateDeg: baseRotateDeg,
        lastAppliedRotateMode: "property",
        activeRotateMode: "property",
        lastPointerClient: makeClientPoint(px(event.clientX), px(event.clientY)),
        lastPointerWorld: world,
        preEditBaselineSource: source,
        latestSource: source,
        historyMergeKey: makeMergeKey("drag-rotate", sourceId, event.pointerId)
      });
      logSnapDebug({
        phase: "drag-start-rotate",
        snapshotMatchesSource: true,
        dragKind: "rotate",
        rawPoint: world,
        lines: []
      });
    },
    [
      dispatch,
      interactionSvgRef,
      logSnapDebug,
      parseOptions,
      resolveRotateWriteTargetIdInternal,
      selectedElementIds,
      directManipulationDisabledReasonBySourceId,
      setDragState,
      setNodeAnchorOverlay,
      setSnapLines,
      closeTextEditingSession,
      setWarning,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      viewportRef
    ]
  );

  return {
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    resolveRotateWriteTargetId: resolveRotateWriteTargetIdInternal
  };
}
