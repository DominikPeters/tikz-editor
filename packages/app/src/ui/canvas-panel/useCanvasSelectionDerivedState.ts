import { useMemo } from "react";
import type { PathItem, Statement } from "tikz-editor/ast/types";
import type { ResizeRole } from "tikz-editor/edit/actions";
import { FIT_DIRECT_MANIPULATION_BLOCK_REASON, sourceUsesFitNodeFromParseResult } from "tikz-editor/edit/fit";
import { resolvePropertyTargetFromParseResult } from "tikz-editor/edit/property-target";
import { resolveTransformInspectorMutationContextFromOptionEntries } from "tikz-editor/edit/inspector";
import { collectSourceWorldBounds } from "tikz-editor/edit/snapping";
import type { NodeAnchorTarget, SceneElement, ScenePath, SceneText } from "tikz-editor/semantic/types";
import {
  computeVisibleRanges,
  resizeCursorForVector,
  vectorLengthSquared,
  worldToSvgPoint,
  type VisibleRanges
} from "./geometry";
import { boundsFromPoints } from "./interaction-helpers";
import { computeDragCapability } from "./drag-capability";
import { deriveCurveControlLines } from "./curve-controls";
import { buildHitRegions, type HitRegion } from "./hit-regions";
import { resolveResizeFrameForSource } from "./resize-frames";
import { resolveResizeFrameFromBounds } from "./resize-frames";
import { RESIZE_FRAME_CORNER_ROLES } from "./resize-frames";
import { resolveRotateHandlePosition } from "./rotate-handle";
import { augmentScopeOverlayWithMatrices, buildScopeOverlayIndex } from "./scope-overlay";
import type { MatrixCellAnchorHint } from "./endpoint-anchor-snap";
import {
  collectMatrixStatementSourceIds,
  collectSourceBounds,
  getHandleCursor,
  preferredNodeBoundsForSource,
  isTextOnlyNodeSource,
  resolveAdornmentOwnerBoundaryPoint,
  resolveBoundsEdgePointToward,
  resolveScenePathShapeHint,
  resizeCursorForRole,
  sourceHasSingleResizablePathShape
} from "./panel-helpers";

export type UseCanvasSelectionDerivedStateArgs = {
  [key: string]: any;
};

const SIDE_RESIZE_HANDLE_MIN_DIMENSION_PX = 96;

export function useCanvasSelectionDerivedState(args: UseCanvasSelectionDerivedStateArgs) {
  const {
    snapshot,
    selectedElementIds,
    collapsedDensePathSourceIds,
    svgResult,
    canvasTransform,
    marqueeDraft,
    toolMode,
    viewportSize,
    ROTATE_HANDLE_OFFSET_PX
  } = args;

  const selectedHandles = useMemo(
    () => snapshot.editHandles.filter((handle: any) => selectedElementIds.has(handle.sourceRef.sourceId)),
    [snapshot.editHandles, selectedElementIds]
  );
  const selectedNodeSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const handle of selectedHandles as any[]) {
      if (handle.kind === "node-position") {
        ids.add(handle.sourceRef.sourceId);
      }
    }
    return ids;
  }, [selectedHandles]);
  const nodeAnchorTargets = useMemo<readonly NodeAnchorTarget[]>(
    () => snapshot.semanticResult?.nodeAnchorTargets ?? [],
    [snapshot.semanticResult]
  );
  const matrixSourceIds = useMemo(() => {
    const figure = snapshot.parseResult?.figure;
    if (!figure) {
      return new Set<string>();
    }
    return collectMatrixStatementSourceIds(figure.body);
  }, [snapshot.parseResult]);
  const matrixCellSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      const cellId = element.matrixCell?.cellSourceId;
      if (cellId) {
        ids.add(cellId);
      }
    }
    return ids;
  }, [snapshot.scene]);
  const treeChildSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      const tc = element.treeChild;
      if (tc) {
        ids.add(tc.childSourceId);
      }
    }
    return ids;
  }, [snapshot.scene]);
  const treeRootSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      const tc = element.treeChild;
      if (tc) {
        ids.add(tc.treeRootSourceId);
      }
    }
    return ids;
  }, [snapshot.scene]);

  const dragCapability = useMemo(
    () => computeDragCapability(snapshot.editHandles),
    [snapshot.editHandles]
  );
  const fitNodeSourceIds = useMemo(() => {
    const ids = new Set<string>();
    if (!snapshot.parseResult) {
      return ids;
    }
    const allSourceIds = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      allSourceIds.add(element.sourceRef.sourceId);
    }
    for (const sourceId of allSourceIds) {
      if (sourceUsesFitNodeFromParseResult(snapshot.source, snapshot.parseResult, sourceId)) {
        ids.add(sourceId);
      }
    }
    return ids;
  }, [snapshot.parseResult, snapshot.scene, snapshot.source]);
  const pathAttachedNodeSourceIds = useMemo(() => {
    const figure = snapshot.parseResult?.figure;
    if (!figure) {
      return new Set<string>();
    }
    return collectPathAttachedNodeSourceIds(figure.body);
  }, [snapshot.parseResult]);
  const directManipulationDisabledReasonBySourceId = useMemo(() => {
    const reasons = new Map<string, string>();
    for (const sourceId of fitNodeSourceIds) {
      reasons.set(sourceId, FIT_DIRECT_MANIPULATION_BLOCK_REASON);
    }
    return reasons;
  }, [fitNodeSourceIds]);
  const adornmentTargetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      if (element.adornment?.targetId) {
        ids.add(element.adornment.targetId);
      }
    }
    return ids;
  }, [snapshot.scene]);

  const sceneTextByRegionKey = useMemo(() => {
    const elements = snapshot.scene?.elements ?? [];
    const byRegionKey = new Map<string, SceneText>();
    for (const element of elements) {
      if (element.kind !== "Text") {
        continue;
      }
      byRegionKey.set(`hit:${element.id}`, element);
    }
    return byRegionKey;
  }, [snapshot.scene]);

  const sourceBoundsSvg = useMemo(() => {
    if (!snapshot.scene || !svgResult) {
      return new Map<string, any>();
    }
    return collectSourceBounds(snapshot.scene.elements, svgResult.viewBox);
  }, [snapshot.scene, svgResult]);

  const matrixCellAnchorHints = useMemo<readonly MatrixCellAnchorHint[]>(() => {
    const sourceBoundsWorld = snapshot.scene
      ? collectSourceWorldBounds(snapshot.scene.elements)
      : new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
    const byCellId = new Map<string, MatrixCellAnchorHint>();
    for (const element of snapshot.scene?.elements ?? []) {
      const matrixCell = element.matrixCell;
      if (!matrixCell) {
        continue;
      }
      const existing = byCellId.get(matrixCell.cellSourceId);
      if (existing) {
        continue;
      }
      const bounds = sourceBoundsWorld.get(matrixCell.cellSourceId);
      if (!bounds) {
        continue;
      }
      byCellId.set(matrixCell.cellSourceId, {
        matrixSourceId: matrixCell.matrixSourceId,
        cellSourceId: matrixCell.cellSourceId,
        row: matrixCell.row,
        column: matrixCell.column,
        bounds: {
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY
        }
      });
    }
    return [...byCellId.values()];
  }, [snapshot.scene]);

  const scopeOverlay = useMemo(
    () =>
      augmentScopeOverlayWithMatrices(
        buildScopeOverlayIndex(snapshot.parseResult?.figure.body, sourceBoundsSvg),
        snapshot.scene?.elements,
        sourceBoundsSvg
      ),
    [snapshot.parseResult, snapshot.scene, sourceBoundsSvg]
  );

  const movableScopeSourceIds = useMemo(() => {
    const ids = new Set<string>();
    if (!snapshot.parseResult) {
      return ids;
    }

    for (const scopeId of scopeOverlay.scopesById.keys()) {
      const resolved = resolvePropertyTargetFromParseResult(snapshot.source, snapshot.parseResult, scopeId);
      if (resolved.kind === "found") {
        ids.add(scopeId);
      }
    }

    return ids;
  }, [scopeOverlay.scopesById, snapshot.parseResult, snapshot.source]);

  const draggableSourceIds = useMemo(() => {
    const ids = new Set<string>(dragCapability.draggableSourceIds);
    for (const fitId of fitNodeSourceIds) {
      ids.delete(fitId);
    }
    for (const matrixCellId of matrixCellSourceIds) {
      ids.delete(matrixCellId);
    }
    for (const treeChildId of treeChildSourceIds) {
      ids.delete(treeChildId);
    }
    for (const sourceId of matrixSourceIds) {
      ids.add(sourceId);
    }
    for (const sourceId of treeRootSourceIds) {
      ids.add(sourceId);
    }
    for (const scopeId of movableScopeSourceIds) {
      ids.add(scopeId);
    }
    for (const targetId of adornmentTargetIds) {
      ids.add(targetId);
    }
    for (const nodeId of pathAttachedNodeSourceIds) {
      ids.add(nodeId);
    }
    return ids;
  }, [adornmentTargetIds, dragCapability.draggableSourceIds, fitNodeSourceIds, matrixCellSourceIds, matrixSourceIds, movableScopeSourceIds, pathAttachedNodeSourceIds, treeChildSourceIds, treeRootSourceIds]);

  const selectionBounds = useMemo(() => {
    const selected: Array<{ sourceId: string; bounds: any }> = [];
    for (const sourceId of selectedElementIds) {
      const fallbackBounds = sourceBoundsSvg.get(sourceId) ?? scopeOverlay.boundsByScopeId.get(sourceId);
      const bounds =
        snapshot.scene && svgResult && (
          selectedNodeSourceIds.has(sourceId)
          || treeChildSourceIds.has(sourceId)
          || treeRootSourceIds.has(sourceId)
        )
          ? preferredNodeBoundsForSource(snapshot.scene.elements, sourceId, svgResult.viewBox, fallbackBounds ?? null)
          : fallbackBounds;
      if (!bounds) {
        continue;
      }
      selected.push({ sourceId, bounds });
    }
    return selected;
  }, [scopeOverlay.boundsByScopeId, selectedElementIds, selectedNodeSourceIds, snapshot.scene, sourceBoundsSvg, svgResult, treeChildSourceIds, treeRootSourceIds]);

  const selectedScopeHitBounds = useMemo(() => {
    return selectionBounds
      .filter((entry) => movableScopeSourceIds.has(entry.sourceId) && scopeOverlay.scopesById.has(entry.sourceId))
      .map((entry) => ({ scopeId: entry.sourceId, bounds: entry.bounds }));
  }, [movableScopeSourceIds, scopeOverlay.scopesById, selectionBounds]);

  const selectionBoundsBySource = useMemo(() => {
    const bySource = new Map<string, any>();
    for (const entry of selectionBounds as any[]) {
      bySource.set(entry.sourceId, entry.bounds);
    }
    return bySource;
  }, [selectionBounds]);

  const interactionBoundsSvgBySource = useMemo(() => {
    const bySource = new Map<string, any>(sourceBoundsSvg);
    for (const [scopeId, bounds] of scopeOverlay.boundsByScopeId) {
      bySource.set(scopeId, { ...bounds, sourceId: scopeId });
    }
    return bySource;
  }, [scopeOverlay.boundsByScopeId, sourceBoundsSvg]);

  const resizablePathShapeSourceIds = useMemo(() => {
    if (!snapshot.scene) {
      return new Set<string>();
    }

    const result = new Set<string>();
    const statements = snapshot.parseResult?.figure.body;
    for (const sourceId of selectionBoundsBySource.keys()) {
      if (matrixSourceIds.has(sourceId)) {
        continue;
      }
      if (matrixCellSourceIds.has(sourceId)) {
        continue;
      }
      if (treeChildSourceIds.has(sourceId)) {
        continue;
      }
      if (sourceHasSingleResizablePathShape(snapshot.scene.elements, snapshot.editHandles, sourceId, statements)) {
        result.add(sourceId);
      }
    }
    return result;
  }, [matrixCellSourceIds, matrixSourceIds, selectionBoundsBySource, snapshot.editHandles, snapshot.parseResult, snapshot.scene, treeChildSourceIds]);

  const nodeResizeSourceIds = useMemo(() => {
    const sourceIds = new Set<string>();
    for (const handle of selectedHandles as any[]) {
      if (
        handle.kind === "node-position"
        && !matrixSourceIds.has(handle.sourceRef.sourceId)
        && !matrixCellSourceIds.has(handle.sourceRef.sourceId)
        && !fitNodeSourceIds.has(handle.sourceRef.sourceId)
      ) {
        sourceIds.add(handle.sourceRef.sourceId);
      }
    }
    for (const sourceId of selectedElementIds) {
      if (pathAttachedNodeSourceIds.has(sourceId)) {
        sourceIds.add(sourceId);
      }
    }
    return sourceIds;
  }, [fitNodeSourceIds, matrixCellSourceIds, matrixSourceIds, pathAttachedNodeSourceIds, selectedElementIds, selectedHandles, treeChildSourceIds]);

  const scopeResizeSourceIds = useMemo(() => {
    const sourceIds = new Set<string>();
    for (const sourceId of selectedElementIds) {
      if (!movableScopeSourceIds.has(sourceId)) {
        continue;
      }
      const resolvedTarget = snapshot.parseResult
        ? resolvePropertyTargetFromParseResult(snapshot.source, snapshot.parseResult, sourceId)
        : { kind: "not-found" as const };
      const transformContext =
        resolvedTarget.kind === "found"
          ? resolveTransformInspectorMutationContextFromOptionEntries(resolvedTarget.target.options?.entries)
          : resolveTransformInspectorMutationContextFromOptionEntries(null);
      if (Math.abs(transformContext.values.rotate) > 1e-6) {
        continue;
      }
      const bounds = scopeOverlay.boundsByScopeId.get(sourceId);
      if (!bounds) {
        continue;
      }
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;
      if (width <= 1e-6 || height <= 1e-6) {
        continue;
      }
      sourceIds.add(sourceId);
    }
    return sourceIds;
  }, [movableScopeSourceIds, scopeOverlay.boundsByScopeId, selectedElementIds, snapshot.parseResult, snapshot.source]);

  const resizeFrameSourceIds = useMemo(() => {
    const sourceIds = new Set<string>(resizablePathShapeSourceIds);
    for (const sourceId of nodeResizeSourceIds) {
      sourceIds.add(sourceId);
    }
    for (const sourceId of selectedElementIds) {
      if (matrixSourceIds.has(sourceId)) {
        sourceIds.add(sourceId);
      }
    }
    for (const sourceId of selectedElementIds) {
      if (matrixCellSourceIds.has(sourceId)) {
        sourceIds.add(sourceId);
      }
    }
    for (const sourceId of selectedElementIds) {
      if (treeChildSourceIds.has(sourceId)) {
        sourceIds.add(sourceId);
      }
    }
    for (const sourceId of scopeResizeSourceIds) {
      sourceIds.add(sourceId);
    }
    return sourceIds;
  }, [matrixCellSourceIds, matrixSourceIds, nodeResizeSourceIds, resizablePathShapeSourceIds, scopeResizeSourceIds, selectedElementIds, treeChildSourceIds]);

  const matrixSelectionSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sourceId of selectionBoundsBySource.keys()) {
      if (matrixSourceIds.has(sourceId)) {
        ids.add(sourceId);
      }
    }
    return ids;
  }, [matrixSourceIds, selectionBoundsBySource]);

  const selectionFrameSourceIds = useMemo(() => {
    const ids = new Set<string>(resizeFrameSourceIds);
    for (const sourceId of matrixSelectionSourceIds) {
      ids.add(sourceId);
    }
    return ids;
  }, [matrixSelectionSourceIds, resizeFrameSourceIds]);

  const scopeSelectionSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sourceId of selectedElementIds) {
      if (scopeOverlay.scopesById.has(sourceId)) {
        ids.add(sourceId);
      }
    }
    return ids;
  }, [scopeOverlay.scopesById, selectedElementIds]);

  const selectionBoxSourceIds = useMemo(() => {
    const ids = new Set<string>(selectionFrameSourceIds);
    for (const sourceId of scopeSelectionSourceIds) {
      ids.add(sourceId);
    }
    return ids;
  }, [scopeSelectionSourceIds, selectionFrameSourceIds]);

  const resizeFramesBySource = useMemo(() => {
    const frames = new Map<string, ReturnType<typeof resolveResizeFrameForSource>>();
    if (!snapshot.scene || !svgResult) {
      return frames;
    }
    const statements = snapshot.parseResult?.figure.body;
    for (const sourceId of resizeFrameSourceIds) {
      if (scopeResizeSourceIds.has(sourceId)) {
        const scopeBounds = scopeOverlay.boundsByScopeId.get(sourceId);
        const frame = scopeBounds
          ? resolveResizeFrameFromBounds(sourceId, scopeBounds, svgResult.viewBox)
          : null;
        frames.set(sourceId, frame);
        continue;
      }
      const path = snapshot.scene.elements.find(
        (element: any): element is ScenePath => element.sourceRef.sourceId === sourceId && element.kind === "Path"
      );
      const pathShapeHint = path ? resolveScenePathShapeHint(path, statements, sourceId) : undefined;
      const frame = resolveResizeFrameForSource(
        snapshot.scene.elements,
        snapshot.editHandles,
        sourceId,
        svgResult.viewBox,
        pathShapeHint
      );
      frames.set(sourceId, frame);
    }
    return frames;
  }, [resizeFrameSourceIds, scopeOverlay.boundsByScopeId, scopeResizeSourceIds, snapshot.editHandles, snapshot.parseResult, snapshot.scene, svgResult]);

  const selectionBoxes = useMemo(() => {
    const textOnlyNodeSelectionSourceIds = new Set<string>();
    if (snapshot.scene) {
      for (const sourceId of selectedNodeSourceIds) {
        if (isTextOnlyNodeSource(snapshot.scene.elements, sourceId)) {
          textOnlyNodeSelectionSourceIds.add(sourceId);
        }
      }
    }

    const boxes = [...selectionBoxSourceIds]
      .map((sourceId) => {
        const resizeFrame = resizeFramesBySource.get(sourceId) ?? null;
        if (resizeFrame) {
          return {
            key: `selection-box:${sourceId}`,
            sourceId,
            isAdornment: sourceId.startsWith("node-adornment:"),
            dashed: textOnlyNodeSelectionSourceIds.has(sourceId),
            kind: "polygon" as const,
            points: resizeFrame.polygonSvg
          };
        }
        const bounds = selectionBoundsBySource.get(sourceId);
        return bounds
          ? {
              key: `selection-box:${sourceId}`,
              sourceId,
              isAdornment: sourceId.startsWith("node-adornment:"),
              dashed: textOnlyNodeSelectionSourceIds.has(sourceId),
              kind: "axis-aligned" as const,
              ...bounds
            }
          : null;
      })
      .filter((bounds): bounds is NonNullable<typeof bounds> => bounds != null);
    return boxes;
  }, [resizeFramesBySource, selectedNodeSourceIds, selectionBoundsBySource, selectionBoxSourceIds, snapshot.scene]);

  const selectedAdornmentConnectors = useMemo(() => {
    if (!snapshot.scene || !svgResult) {
      return [];
    }
    const highlightedAdornmentTargetIds = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const adornment = element.adornment;
      if (!adornment?.ownerPoint) {
        continue;
      }
      if (selectedElementIds.has(adornment.targetId) || selectedElementIds.has(element.sourceRef.sourceId)) {
        highlightedAdornmentTargetIds.add(adornment.targetId);
      }
    }
    const connectors: Array<{ key: string; kind: "label" | "pin"; x1: number; y1: number; x2: number; y2: number }> = [];
    const seen = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const adornment = element.adornment;
      if (
        !adornment ||
        adornment.kind !== "label" ||
        !highlightedAdornmentTargetIds.has(adornment.targetId) ||
        !adornment.ownerPoint ||
        seen.has(adornment.targetId)
      ) {
        continue;
      }
      const bounds = selectionBoundsBySource.get(adornment.targetId);
      if (!bounds) {
        continue;
      }
      const labelCenterWorld = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: svgResult.viewBox.y + svgResult.viewBox.height - (((bounds.minY + bounds.maxY) / 2) - svgResult.viewBox.y)
      };
      const connectorOwnerPoint = resolveAdornmentOwnerBoundaryPoint(
        adornment.ownerGeometry,
        adornment.ownerPoint,
        labelCenterWorld
      );
      const owner = worldToSvgPoint(connectorOwnerPoint, svgResult.viewBox);
      const labelEdge = resolveBoundsEdgePointToward(bounds, owner);
      connectors.push({
        key: `adornment-connector:${adornment.targetId}`,
        kind: adornment.kind,
        x1: owner.x,
        y1: owner.y,
        x2: labelEdge.x,
        y2: labelEdge.y
      });
      seen.add(adornment.targetId);
    }
    return connectors;
  }, [selectedElementIds, selectionBoundsBySource, snapshot.scene, svgResult]);

  const adornmentHighlightBoxes = useMemo(() => {
    if (!snapshot.scene) {
      return [];
    }
    const boxes: Array<{ key: string; minX: number; minY: number; maxX: number; maxY: number }> = [];
    const seen = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const targetId = element.adornment?.targetId;
      if (!targetId || seen.has(targetId)) {
        continue;
      }
      if (!selectedElementIds.has(targetId) && !selectedElementIds.has(element.sourceRef.sourceId)) {
        continue;
      }
      const bounds = selectionBoundsBySource.get(targetId);
      if (!bounds) {
        continue;
      }
      boxes.push({
        key: `adornment-highlight:${targetId}`,
        ...bounds
      });
      seen.add(targetId);
    }
    return boxes;
  }, [selectedElementIds, selectionBoundsBySource, snapshot.scene]);

  const curveControlLines = useMemo(
    () =>
      snapshot.scene
        ? deriveCurveControlLines(snapshot.scene.elements, selectedElementIds, snapshot.editHandles).filter(
            (line) => !collapsedDensePathSourceIds.has(line.sourceId)
          )
        : [],
    [collapsedDensePathSourceIds, selectedElementIds, snapshot.editHandles, snapshot.scene]
  );

  const marqueeBounds = useMemo(() => {
    if (!svgResult || !marqueeDraft) return null;
    return boundsFromPoints(
      worldToSvgPoint(marqueeDraft.startWorld, svgResult.viewBox),
      worldToSvgPoint(marqueeDraft.currentWorld, svgResult.viewBox)
    );
  }, [marqueeDraft, svgResult]);

  const collapsedDensePathEndpointsBySource = useMemo(() => {
    const endpointsBySource = new Map<string, { start: { x: number; y: number }; end: { x: number; y: number } }>();
    if (!snapshot.scene || collapsedDensePathSourceIds.size === 0) {
      return endpointsBySource;
    }
    for (const element of snapshot.scene.elements) {
      if (element.kind !== "Path" || !collapsedDensePathSourceIds.has(element.sourceRef.sourceId)) {
        continue;
      }
      let start: { x: number; y: number } | null = null;
      let end: { x: number; y: number } | null = null;
      for (const command of element.commands) {
        if (command.kind === "M") {
          if (!start) {
            start = command.to;
          }
          end = command.to;
          continue;
        }
        if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
          if (!start) {
            start = command.to;
          }
          end = command.to;
        }
      }
      if (start && end) {
        endpointsBySource.set(element.sourceRef.sourceId, { start, end });
      }
    }
    return endpointsBySource;
  }, [collapsedDensePathSourceIds, snapshot.scene]);

  const handleDisplays = useMemo((): any[] => {
    if (!svgResult) return [];

    const displays: any[] = [];
    const resizeHandleSourceIds = new Set<string>(resizeFrameSourceIds);
    const singleSelectedSourceId =
      selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
    const rotateHandleSourceId =
      toolMode === "select" &&
      singleSelectedSourceId &&
      resizeHandleSourceIds.has(singleSelectedSourceId) &&
      !fitNodeSourceIds.has(singleSelectedSourceId) &&
      !matrixSourceIds.has(singleSelectedSourceId) &&
      !matrixCellSourceIds.has(singleSelectedSourceId) &&
      !scopeResizeSourceIds.has(singleSelectedSourceId)
        ? singleSelectedSourceId
        : null;

    for (const handle of selectedHandles as any[]) {
      if (handle.kind === "node-position") {
        continue;
      }

      if (collapsedDensePathSourceIds.has(handle.sourceRef.sourceId)) {
        if (handle.kind !== "path-point") {
          continue;
        }
        const endpoints = collapsedDensePathEndpointsBySource.get(handle.sourceRef.sourceId);
        if (!endpoints) {
          continue;
        }
        const matchesStart = distanceSquared(handle.world, endpoints.start) <= 1e-6;
        const matchesEnd = distanceSquared(handle.world, endpoints.end) <= 1e-6;
        if (!matchesStart && !matchesEnd) {
          continue;
        }
        const point = worldToSvgPoint(handle.world, svgResult.viewBox);
        displays.push({
          key: `dense-endpoint:${handle.sourceRef.sourceId}:${handle.id}`,
          x: point.x,
          y: point.y,
          cursor: draggableSourceIds.has(handle.sourceRef.sourceId) ? "move" : "not-allowed",
          kind: "move-element",
          elementId: handle.sourceRef.sourceId
        });
        continue;
      }

      if (handle.kind === "path-point" && treeChildSourceIds.has(handle.sourceRef.sourceId)) {
        continue;
      }

      if (handle.kind === "path-point" && resizablePathShapeSourceIds.has(handle.sourceRef.sourceId)) {
        continue;
      }

      const point = worldToSvgPoint(handle.world, svgResult.viewBox);
      const isDraggable = dragCapability.draggableHandleIds.has(handle.id);
      displays.push({
        key: `handle:${handle.id}`,
        x: point.x,
        y: point.y,
        cursor: isDraggable ? getHandleCursor(handle, snapshot.scene, snapshot.editHandles) : "not-allowed",
        kind: "move-handle",
        handle
      });
    }

    for (const sourceId of resizeHandleSourceIds) {
      const resizeFrame = resizeFramesBySource.get(sourceId) ?? null;
      if (resizeFrame) {
        const resizeDisabled =
          fitNodeSourceIds.has(sourceId)
          || treeChildSourceIds.has(sourceId)
          || matrixSourceIds.has(sourceId)
          || matrixCellSourceIds.has(sourceId);
        displays.push(
          ...buildResizeHandleDisplaysForFrame({
            sourceId,
            resizeFrame,
            canvasScale: canvasTransform.scale,
            resizeDisabled
          })
        );
        continue;
      }

      const fallbackBounds = selectionBoundsBySource.get(sourceId) ?? null;
      const bounds = preferredNodeBoundsForSource(
        snapshot.scene?.elements ?? [],
        sourceId,
        svgResult.viewBox,
        fallbackBounds
      );
      if (!bounds) {
        if (resizablePathShapeSourceIds.has(sourceId)) {
          continue;
        }
        const fallback = (selectedHandles as any[]).find((handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position");
        if (!fallback) continue;
        const point = worldToSvgPoint(fallback.world, svgResult.viewBox);
        displays.push({
          key: `node-handle:${sourceId}:center`,
          x: point.x,
          y: point.y,
          cursor: draggableSourceIds.has(sourceId) ? "move" : "not-allowed",
          kind: "move-element",
          elementId: sourceId
        });
        continue;
      }

      const resizeDisabled =
        fitNodeSourceIds.has(sourceId)
        || treeChildSourceIds.has(sourceId)
        || matrixSourceIds.has(sourceId)
        || matrixCellSourceIds.has(sourceId);
      displays.push(
        ...buildResizeHandleDisplaysForBounds({
          sourceId,
          bounds,
          canvasScale: canvasTransform.scale,
          resizeDisabled
        })
      );
    }

    if (rotateHandleSourceId) {
      const rotateFrame = resizeFramesBySource.get(rotateHandleSourceId) ?? null;
      if (rotateFrame) {
        const rotateHandlePosition = resolveRotateHandlePosition(
          rotateFrame,
          canvasTransform.scale,
          ROTATE_HANDLE_OFFSET_PX
        );
        displays.push({
          key: `node-handle:${rotateHandleSourceId}:rotate`,
          x: rotateHandlePosition.handleSvg.x,
          y: rotateHandlePosition.handleSvg.y,
          anchorX: rotateHandlePosition.anchorSvg.x,
          anchorY: rotateHandlePosition.anchorSvg.y,
          centerWorld: { ...rotateFrame.centerWorld },
          cursor: "grab",
          kind: "rotate-element",
          elementId: rotateHandleSourceId
        });
      }
    }

    return displays;
  }, [ROTATE_HANDLE_OFFSET_PX, canvasTransform.scale, collapsedDensePathEndpointsBySource, collapsedDensePathSourceIds, dragCapability.draggableHandleIds, draggableSourceIds, fitNodeSourceIds, matrixCellSourceIds, matrixSourceIds, pathAttachedNodeSourceIds, resizablePathShapeSourceIds, resizeFrameSourceIds, resizeFramesBySource, scopeResizeSourceIds, selectedElementIds, selectedHandles, selectionBoundsBySource, snapshot.editHandles, snapshot.scene, svgResult, toolMode, treeChildSourceIds]);

  const hitRegions = useMemo(() => {
    if (!snapshot.scene || !svgResult) return [];
    const matrixEdgeRegions = buildMatrixEdgeHitRegions(snapshot.scene.elements, sourceBoundsSvg, canvasTransform.scale);
    const regions = buildHitRegions(snapshot.scene.elements, svgResult.viewBox, canvasTransform.scale, selectedScopeHitBounds);
    // Matrix edge selectors must stay behind regular hit regions so nearby elements keep precedence.
    return [...matrixEdgeRegions, ...regions];
  }, [canvasTransform.scale, selectedScopeHitBounds, snapshot.scene, sourceBoundsSvg, svgResult]);

  const visibleRanges = useMemo<VisibleRanges | null>(() => {
    if (!svgResult || viewportSize.width <= 0 || viewportSize.height <= 0) return null;
    return computeVisibleRanges(svgResult.viewBox, canvasTransform, viewportSize.width, viewportSize.height);
  }, [svgResult, canvasTransform, viewportSize]);

  const viewportWorldBounds = useMemo(
    () =>
      visibleRanges
        ? {
            minX: visibleRanges.worldMinX,
            minY: visibleRanges.worldMinY,
            maxX: visibleRanges.worldMaxX,
            maxY: visibleRanges.worldMaxY
          }
        : null,
    [visibleRanges]
  );

  return {
    selectedHandles,
    nodeAnchorTargets,
    matrixCellAnchorHints,
    matrixSourceIds,
    dragCapability,
    directManipulationDisabledReasonBySourceId,
    adornmentTargetIds,
    draggableSourceIds,
    selectionBounds,
    sceneTextByRegionKey,
    sourceBoundsSvg,
    interactionBoundsSvgBySource,
    selectionBoundsBySource,
    resizablePathShapeSourceIds,
    nodeResizeSourceIds,
    resizeFrameSourceIds,
    matrixSelectionSourceIds,
    selectionFrameSourceIds,
    resizeFramesBySource,
    selectionBoxes,
    selectedAdornmentConnectors,
    adornmentHighlightBoxes,
    curveControlLines,
    marqueeBounds,
    handleDisplays,
    hitRegions,
    visibleRanges,
    viewportWorldBounds,
    scopeOverlay
  };
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function collectPathAttachedNodeSourceIds(statements: readonly Statement[]): Set<string> {
  const ids = new Set<string>();

  const collectFromPathItems = (items: readonly PathItem[]): void => {
    for (const item of items) {
      if (item.kind === "Node") {
        ids.add(item.id);
        continue;
      }
      if (item.kind === "ToOperation" || item.kind === "EdgeOperation") {
        for (const node of item.nodes ?? []) {
          ids.add(node.id);
        }
        continue;
      }
      if (item.kind === "ChildOperation") {
        collectFromPathItems(item.body);
      }
    }
  };

  const collectFromStatements = (entries: readonly Statement[]): void => {
    for (const statement of entries) {
      if (statement.kind === "Scope") {
        collectFromStatements(statement.body);
        continue;
      }
      if (statement.kind !== "Path" || statement.command === "node") {
        continue;
      }
      collectFromPathItems(statement.items);
    }
  };

  collectFromStatements(statements);
  return ids;
}

function shouldShowSideResizeHandles(
  boundsSvg: { minX: number; minY: number; maxX: number; maxY: number },
  canvasScale: number
): boolean {
  const widthPx = Math.max(0, boundsSvg.maxX - boundsSvg.minX) * Math.max(canvasScale, 1e-6);
  const heightPx = Math.max(0, boundsSvg.maxY - boundsSvg.minY) * Math.max(canvasScale, 1e-6);
  return Math.min(widthPx, heightPx) >= SIDE_RESIZE_HANDLE_MIN_DIMENSION_PX;
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function buildResizeHandleDisplaysForFrame({
  sourceId,
  resizeFrame,
  canvasScale,
  resizeDisabled
}: {
  sourceId: string;
  resizeFrame: {
    centerWorld: { x: number; y: number };
    boundsSvg: { minX: number; minY: number; maxX: number; maxY: number };
    cornersByRole: Record<"top-left" | "top-right" | "bottom-right" | "bottom-left", { world: { x: number; y: number }; svg: { x: number; y: number } }>;
  };
  canvasScale: number;
  resizeDisabled: boolean;
}): any[] {
  const displays: any[] = [];
  const topLeft = resizeFrame.cornersByRole["top-left"].svg;
  const topRight = resizeFrame.cornersByRole["top-right"].svg;
  const frameRotationDeg = (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI;
  for (const role of RESIZE_FRAME_CORNER_ROLES) {
    const corner = resizeFrame.cornersByRole[role];
    const resizeVector = {
      x: corner.world.x - resizeFrame.centerWorld.x,
      y: corner.world.y - resizeFrame.centerWorld.y
    };
    displays.push({
      key: `node-handle:${sourceId}:${role}`,
      x: corner.svg.x,
      y: corner.svg.y,
      cursor:
        resizeDisabled
          ? "not-allowed"
          : (
              vectorLengthSquared(resizeVector) > 1e-12
                ? resizeCursorForVector(resizeVector)
                : resizeCursorForRole(role)
            ),
      kind: "resize-element",
      elementId: sourceId,
      role,
      rotationDeg: frameRotationDeg
    });
  }

  if (!shouldShowSideResizeHandles(resizeFrame.boundsSvg, canvasScale)) {
    return displays;
  }

  const edgeHandles: Array<{
    role: Extract<ResizeRole, "top" | "right" | "bottom" | "left">;
    svg: { x: number; y: number };
    world: { x: number; y: number };
  }> = [
    {
      role: "top",
      svg: midpoint(resizeFrame.cornersByRole["top-left"].svg, resizeFrame.cornersByRole["top-right"].svg),
      world: midpoint(resizeFrame.cornersByRole["top-left"].world, resizeFrame.cornersByRole["top-right"].world)
    },
    {
      role: "right",
      svg: midpoint(resizeFrame.cornersByRole["top-right"].svg, resizeFrame.cornersByRole["bottom-right"].svg),
      world: midpoint(resizeFrame.cornersByRole["top-right"].world, resizeFrame.cornersByRole["bottom-right"].world)
    },
    {
      role: "bottom",
      svg: midpoint(resizeFrame.cornersByRole["bottom-left"].svg, resizeFrame.cornersByRole["bottom-right"].svg),
      world: midpoint(resizeFrame.cornersByRole["bottom-left"].world, resizeFrame.cornersByRole["bottom-right"].world)
    },
    {
      role: "left",
      svg: midpoint(resizeFrame.cornersByRole["top-left"].svg, resizeFrame.cornersByRole["bottom-left"].svg),
      world: midpoint(resizeFrame.cornersByRole["top-left"].world, resizeFrame.cornersByRole["bottom-left"].world)
    }
  ];
  for (const edgeHandle of edgeHandles) {
    const resizeVector = {
      x: edgeHandle.world.x - resizeFrame.centerWorld.x,
      y: edgeHandle.world.y - resizeFrame.centerWorld.y
    };
    displays.push({
      key: `node-handle:${sourceId}:${edgeHandle.role}`,
      x: edgeHandle.svg.x,
      y: edgeHandle.svg.y,
      cursor:
        resizeDisabled
          ? "not-allowed"
          : (
              vectorLengthSquared(resizeVector) > 1e-12
                ? resizeCursorForVector(resizeVector)
                : resizeCursorForRole(edgeHandle.role)
            ),
      kind: "resize-element",
      elementId: sourceId,
      role: edgeHandle.role,
      rotationDeg: frameRotationDeg
    });
  }

  return displays;
}

function buildResizeHandleDisplaysForBounds({
  sourceId,
  bounds,
  canvasScale,
  resizeDisabled
}: {
  sourceId: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  canvasScale: number;
  resizeDisabled: boolean;
}): any[] {
  const displays: any[] = [];
  const cornerRoles: Array<{
    role: Extract<ResizeRole, "top-left" | "top-right" | "bottom-left" | "bottom-right">;
    x: number;
    y: number;
  }> = [
    { role: "top-left", x: bounds.minX, y: bounds.minY },
    { role: "top-right", x: bounds.maxX, y: bounds.minY },
    { role: "bottom-left", x: bounds.minX, y: bounds.maxY },
    { role: "bottom-right", x: bounds.maxX, y: bounds.maxY }
  ];
  for (const corner of cornerRoles) {
    displays.push({
      key: `node-handle:${sourceId}:${corner.role}`,
      x: corner.x,
      y: corner.y,
      cursor: resizeDisabled ? "not-allowed" : resizeCursorForRole(corner.role),
      kind: "resize-element",
      elementId: sourceId,
      role: corner.role,
      rotationDeg: 0
    });
  }

  if (!shouldShowSideResizeHandles(bounds, canvasScale)) {
    return displays;
  }

  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const edgeRoles: Array<{
    role: Extract<ResizeRole, "top" | "right" | "bottom" | "left">;
    x: number;
    y: number;
    cursor: "ns-resize" | "ew-resize";
  }> = [
    { role: "top", x: midX, y: bounds.minY, cursor: "ns-resize" },
    { role: "right", x: bounds.maxX, y: midY, cursor: "ew-resize" },
    { role: "bottom", x: midX, y: bounds.maxY, cursor: "ns-resize" },
    { role: "left", x: bounds.minX, y: midY, cursor: "ew-resize" }
  ];
  for (const edge of edgeRoles) {
    displays.push({
      key: `node-handle:${sourceId}:${edge.role}`,
      x: edge.x,
      y: edge.y,
      cursor: resizeDisabled ? "not-allowed" : edge.cursor,
      kind: "resize-element",
      elementId: sourceId,
      role: edge.role,
      rotationDeg: 0
    });
  }

  return displays;
}

function buildMatrixEdgeHitRegions(
  elements: readonly SceneElement[],
  boundsBySource: ReadonlyMap<string, { minX: number; minY: number; maxX: number; maxY: number }>,
  scale: number
): HitRegion[] {
  const byCell = new Map<
    string,
    { matrixSourceId: string; row: number; column: number; cellSourceId: string; bounds: { minX: number; minY: number; maxX: number; maxY: number } }
  >();
  for (const element of elements) {
    const matrixCell = element.matrixCell;
    if (!matrixCell) {
      continue;
    }
    const existing = byCell.get(matrixCell.cellSourceId);
    if (existing) {
      continue;
    }
    const bounds = boundsBySource.get(matrixCell.cellSourceId);
    if (!bounds) {
      continue;
    }
    byCell.set(matrixCell.cellSourceId, {
      matrixSourceId: matrixCell.matrixSourceId,
      row: matrixCell.row,
      column: matrixCell.column,
      cellSourceId: matrixCell.cellSourceId,
      bounds
    });
  }

  const byMatrix = new Map<
    string,
    {
      rows: Map<number, string[]>;
      columns: Map<number, string[]>;
      boundsByRow: Map<number, { minX: number; minY: number; maxX: number; maxY: number }>;
      boundsByColumn: Map<number, { minX: number; minY: number; maxX: number; maxY: number }>;
      matrixMinX: number;
      matrixMinY: number;
      matrixMaxX: number;
      matrixMaxY: number;
    }
  >();
  for (const cell of byCell.values()) {
    const current = byMatrix.get(cell.matrixSourceId) ?? {
      rows: new Map<number, string[]>(),
      columns: new Map<number, string[]>(),
      boundsByRow: new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>(),
      boundsByColumn: new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>(),
      matrixMinX: Number.POSITIVE_INFINITY,
      matrixMinY: Number.POSITIVE_INFINITY,
      matrixMaxX: Number.NEGATIVE_INFINITY,
      matrixMaxY: Number.NEGATIVE_INFINITY
    };

    const rowIds = current.rows.get(cell.row) ?? [];
    rowIds.push(cell.cellSourceId);
    current.rows.set(cell.row, rowIds);
    const columnIds = current.columns.get(cell.column) ?? [];
    columnIds.push(cell.cellSourceId);
    current.columns.set(cell.column, columnIds);

    const rowBounds = current.boundsByRow.get(cell.row);
    current.boundsByRow.set(
      cell.row,
      rowBounds
        ? {
            minX: Math.min(rowBounds.minX, cell.bounds.minX),
            minY: Math.min(rowBounds.minY, cell.bounds.minY),
            maxX: Math.max(rowBounds.maxX, cell.bounds.maxX),
            maxY: Math.max(rowBounds.maxY, cell.bounds.maxY)
          }
        : { ...cell.bounds }
    );
    const columnBounds = current.boundsByColumn.get(cell.column);
    current.boundsByColumn.set(
      cell.column,
      columnBounds
        ? {
            minX: Math.min(columnBounds.minX, cell.bounds.minX),
            minY: Math.min(columnBounds.minY, cell.bounds.minY),
            maxX: Math.max(columnBounds.maxX, cell.bounds.maxX),
            maxY: Math.max(columnBounds.maxY, cell.bounds.maxY)
          }
        : { ...cell.bounds }
    );
    current.matrixMinX = Math.min(current.matrixMinX, cell.bounds.minX);
    current.matrixMinY = Math.min(current.matrixMinY, cell.bounds.minY);
    current.matrixMaxX = Math.max(current.matrixMaxX, cell.bounds.maxX);
    current.matrixMaxY = Math.max(current.matrixMaxY, cell.bounds.maxY);
    byMatrix.set(cell.matrixSourceId, current);
  }

  const gap = 8 / Math.max(scale, 1e-3);
  const strip = 12 / Math.max(scale, 1e-3);
  const regions: HitRegion[] = [];

  for (const [matrixSourceId, matrix] of byMatrix.entries()) {
    if (!Number.isFinite(matrix.matrixMinX) || !Number.isFinite(matrix.matrixMinY) || !Number.isFinite(matrix.matrixMaxX) || !Number.isFinite(matrix.matrixMaxY)) {
      continue;
    }

    const rowEntries = [...matrix.rows.entries()].sort((a, b) => a[0] - b[0]);
    for (const [row, ids] of rowEntries) {
      const rowBounds = matrix.boundsByRow.get(row);
      if (!rowBounds || ids.length === 0) {
        continue;
      }
      const selectionIds = [...new Set(ids)].sort();
      regions.push({
        shape: "rect",
        key: `matrix-edge:${matrixSourceId}:row:${row}`,
        sourceId: matrixSourceId,
        targetId: matrixSourceId,
        x: matrix.matrixMinX - gap - strip,
        y: rowBounds.minY,
        width: strip,
        height: Math.max(0, rowBounds.maxY - rowBounds.minY),
        cx: matrix.matrixMinX - gap - (strip / 2),
        cy: (rowBounds.minY + rowBounds.maxY) / 2,
        rotation: 0,
        pointerMode: "fill",
        interactionMode: "move",
        matrixEdgeSelection: {
          kind: "row",
          matrixSourceId,
          selectionIds,
          cursor: "e-resize"
        }
      });
    }

    const columnEntries = [...matrix.columns.entries()].sort((a, b) => a[0] - b[0]);
    for (const [column, ids] of columnEntries) {
      const columnBounds = matrix.boundsByColumn.get(column);
      if (!columnBounds || ids.length === 0) {
        continue;
      }
      const selectionIds = [...new Set(ids)].sort();
      regions.push({
        shape: "rect",
        key: `matrix-edge:${matrixSourceId}:column:${column}`,
        sourceId: matrixSourceId,
        targetId: matrixSourceId,
        x: columnBounds.minX,
        y: matrix.matrixMinY - gap - strip,
        width: Math.max(0, columnBounds.maxX - columnBounds.minX),
        height: strip,
        cx: (columnBounds.minX + columnBounds.maxX) / 2,
        cy: matrix.matrixMinY - gap - (strip / 2),
        rotation: 0,
        pointerMode: "fill",
        interactionMode: "move",
        matrixEdgeSelection: {
          kind: "column",
          matrixSourceId,
          selectionIds,
          cursor: "s-resize"
        }
      });
    }
  }

  return regions;
}
