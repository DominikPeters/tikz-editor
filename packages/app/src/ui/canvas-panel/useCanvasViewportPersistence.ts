import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject
} from "react";
import { px, viewportPoint } from "@tikz-editor/core/coords/index";

import type { CanvasDragKind, CanvasTransform } from "../../store/types";
import { clamp, viewportToSvgPoint } from "./geometry";
import { documentIdFromRootKey, rootKey } from "../../root-key";
import type { CanvasDispatch, CanvasSnapshot, ValueSetter } from "./types";

type FigureViewportState = {
  transform: CanvasTransform;
  fitToContentModeActive: boolean;
};

export type UseCanvasViewportPersistenceArgs = {
  baseSvgResult: CanvasSnapshot["svg"];
  svgResult: CanvasSnapshot["svg"];
  viewportSize: { width: number; height: number };
  fitPadding?: number;
  dispatch: CanvasDispatch;
  dispatchCanvasTransform: (transform: CanvasTransform) => void;
  activeDocumentId: string;
  activeRootId: string | null;
  snapshotActiveRootId: string | null;
  tabOrder: readonly string[];
  canvasTransform: CanvasTransform;
  fitToContentModeActive: boolean;
  fitToContentModeActiveRef: MutableRefObject<boolean>;
  setFitToContentModeActive: ValueSetter<boolean>;
  viewportRef: RefObject<HTMLDivElement | null>;
  canvasTransformRef: MutableRefObject<CanvasTransform>;
  fitToContentRequestToken: number;
  zoomRequestToken: number;
  zoomRequestDirection: "in" | "out" | null;
  zoomScaleRequestToken: number;
  zoomScaleRequestValue: number | null;
  activeCanvasDragKind: CanvasDragKind | null;
  activeSourceScrubSourceId: string | null;
  snapshotSource: string;
  source: string;
  lastEditChangeToken: number;
  MIN_SCALE: number;
  MAX_SCALE: number;
};

export function useCanvasViewportPersistence({
  baseSvgResult,
  svgResult,
  viewportSize,
  fitPadding = 44,
  dispatch,
  dispatchCanvasTransform,
  activeDocumentId,
  activeRootId,
  snapshotActiveRootId,
  tabOrder,
  canvasTransform,
  fitToContentModeActive,
  fitToContentModeActiveRef,
  setFitToContentModeActive,
  viewportRef,
  canvasTransformRef,
  fitToContentRequestToken,
  zoomRequestToken,
  zoomRequestDirection,
  zoomScaleRequestToken,
  zoomScaleRequestValue,
  activeCanvasDragKind,
  activeSourceScrubSourceId,
  snapshotSource,
  source,
  lastEditChangeToken,
  MIN_SCALE,
  MAX_SCALE
}: UseCanvasViewportPersistenceArgs): { maxZoomScale: number; viewportStateReadyRef: MutableRefObject<boolean> } {
  const viewportStateByFigureKeyRef = useRef(new Map<string, FigureViewportState>());
  const previousFigureViewportKeyRef = useRef<string | null>(null);
  const pendingFirstVisitAutoFitKeyRef = useRef<string | null>(null);
  const ownedFigureViewportKeyRef = useRef<string | null>(null);
  const awaitingSnapshotKeyRef = useRef<string | null>(null);
  const awaitingSnapshotTransformRef = useRef<CanvasTransform | null>(null);
  const pendingViewportCommitRef = useRef<FigureViewportState | null>(null);
  const pendingCommitRenderTransformRef = useRef<CanvasTransform | null>(null);
  const viewportStateReadyRef = useRef(false);
  const snapshotMatchesActive = snapshotActiveRootId === activeRootId && snapshotSource === source;

  const fitToContentScale = useMemo(
    () => computeFitToContentScale(
      baseSvgResult?.viewBox ?? svgResult?.viewBox,
      viewportSize.width,
      viewportSize.height,
      MIN_SCALE,
      MAX_SCALE,
      fitPadding
    ),
    [baseSvgResult, fitPadding, MAX_SCALE, MIN_SCALE, svgResult, viewportSize.height, viewportSize.width]
  );

  useEffect(() => {
    dispatch({ type: "SET_CANVAS_FIT_TO_CONTENT_SCALE", scale: fitToContentScale });
  }, [dispatch, fitToContentScale]);

  const maxZoomScale = Math.max(MAX_SCALE, fitToContentScale == null ? MAX_SCALE : fitToContentScale * 2);

  const fitToContent = useCallback((): boolean => {
    if (!snapshotMatchesActive) return false;
    const fitViewBox = baseSvgResult?.viewBox ?? svgResult?.viewBox;
    const renderViewBox = svgResult?.viewBox ?? fitViewBox;
    if (!fitViewBox || !renderViewBox || !viewportRef.current) return false;

    const viewportWidth = viewportRef.current.clientWidth;
    const viewportHeight = viewportRef.current.clientHeight;

    const scale = computeFitToContentScale(fitViewBox, viewportWidth, viewportHeight, MIN_SCALE, MAX_SCALE, fitPadding);
    if (scale == null) {
      return false;
    }

    const fitLeft = (viewportWidth - fitViewBox.width * scale) / 2;
    const fitTop = (viewportHeight - fitViewBox.height * scale) / 2;
    const translateX = fitLeft - (fitViewBox.x - renderViewBox.x) * scale;
    const translateY = fitTop - (fitViewBox.y - renderViewBox.y) * scale;

    const next = { translateX, translateY, scale };
    dispatchCanvasTransform(next);
    canvasTransformRef.current = next;
    return true;
  }, [baseSvgResult, canvasTransformRef, dispatchCanvasTransform, fitPadding, MAX_SCALE, MIN_SCALE, snapshotMatchesActive, svgResult, viewportRef]);

  const activeFigureViewportKey = useMemo(
    () => rootKey(activeDocumentId, activeRootId),
    [activeDocumentId, activeRootId]
  );
  const saveFigureViewportState = useCallback(
    (key: string, transform: CanvasTransform, fitToContentActive: boolean) => {
      viewportStateByFigureKeyRef.current.set(key, {
        transform: {
          translateX: transform.translateX,
          translateY: transform.translateY,
          scale: transform.scale
        },
        fitToContentModeActive: fitToContentActive
      });
    },
    []
  );

  useEffect(() => {
    const openDocuments = new Set(tabOrder);
    for (const key of viewportStateByFigureKeyRef.current.keys()) {
      const documentId = documentIdFromRootKey(key);
      if (!openDocuments.has(documentId)) {
        viewportStateByFigureKeyRef.current.delete(key);
        if (pendingFirstVisitAutoFitKeyRef.current === key) {
          pendingFirstVisitAutoFitKeyRef.current = null;
        }
      }
    }
  }, [tabOrder]);

  useLayoutEffect(() => {
    const previousKey = previousFigureViewportKeyRef.current;
    if (previousKey !== activeFigureViewportKey) {
      if (previousKey && ownedFigureViewportKeyRef.current === previousKey && pendingViewportCommitRef.current === null) {
        saveFigureViewportState(previousKey, canvasTransformRef.current, fitToContentModeActiveRef.current);
      }
      previousFigureViewportKeyRef.current = activeFigureViewportKey;
      ownedFigureViewportKeyRef.current = null;
      awaitingSnapshotKeyRef.current = activeFigureViewportKey;
      awaitingSnapshotTransformRef.current = canvasTransformRef.current;
      pendingViewportCommitRef.current = null;
      viewportStateReadyRef.current = false;
      const savedState = viewportStateByFigureKeyRef.current.get(activeFigureViewportKey);
      pendingFirstVisitAutoFitKeyRef.current = savedState ? null : activeFigureViewportKey;
      const nextFitMode = savedState?.fitToContentModeActive ?? true;
      if (fitToContentModeActiveRef.current !== nextFitMode) setFitToContentModeActive(nextFitMode);
      fitToContentModeActiveRef.current = nextFitMode;
    }

    // A manual gesture while waiting takes ownership. The later SVG must not
    // revive either the first-visit fit or a previously saved transform.
    const manualTakeoverWhileWaiting = awaitingSnapshotKeyRef.current === activeFigureViewportKey &&
      !fitToContentModeActiveRef.current &&
      (pendingFirstVisitAutoFitKeyRef.current === activeFigureViewportKey ||
        (awaitingSnapshotTransformRef.current !== null && !sameTransform(canvasTransformRef.current, awaitingSnapshotTransformRef.current)));
    if (manualTakeoverWhileWaiting) {
      pendingFirstVisitAutoFitKeyRef.current = null;
      awaitingSnapshotKeyRef.current = null;
      pendingViewportCommitRef.current = null;
      ownedFigureViewportKeyRef.current = activeFigureViewportKey;
      saveFigureViewportState(activeFigureViewportKey, canvasTransformRef.current, false);
    }

    if (awaitingSnapshotKeyRef.current === activeFigureViewportKey) {
      if (!snapshotMatchesActive) {
        viewportStateReadyRef.current = false;
        return;
      }
      const savedState = viewportStateByFigureKeyRef.current.get(activeFigureViewportKey);
      if (savedState) {
        if (fitToContentModeActiveRef.current !== savedState.fitToContentModeActive) setFitToContentModeActive(savedState.fitToContentModeActive);
        fitToContentModeActiveRef.current = savedState.fitToContentModeActive;
        dispatchCanvasTransform(savedState.transform);
        canvasTransformRef.current = savedState.transform;
        pendingViewportCommitRef.current = savedState;
        pendingCommitRenderTransformRef.current = canvasTransform;
      } else {
        if (!fitToContent()) {
          viewportStateReadyRef.current = false;
          return;
        }
        pendingViewportCommitRef.current = { transform: canvasTransformRef.current, fitToContentModeActive: true };
        pendingCommitRenderTransformRef.current = canvasTransform;
      }
      pendingFirstVisitAutoFitKeyRef.current = null;
      awaitingSnapshotKeyRef.current = null;
      ownedFigureViewportKeyRef.current = activeFigureViewportKey;
    }

    const pending = pendingViewportCommitRef.current;
    if (pending) {
      const matches = sameTransform(canvasTransform, pending.transform) && fitToContentModeActive === pending.fitToContentModeActive;
      const manualTakeover = !fitToContentModeActiveRef.current &&
        (pending.fitToContentModeActive || canvasTransform !== pendingCommitRenderTransformRef.current);
      if (!matches && !manualTakeover) {
        viewportStateReadyRef.current = false;
        return;
      }
      pendingViewportCommitRef.current = null;
    }
    viewportStateReadyRef.current = ownedFigureViewportKeyRef.current === activeFigureViewportKey && snapshotActiveRootId === activeRootId;
  }, [
    activeFigureViewportKey,
    activeRootId,
    canvasTransform,
    canvasTransformRef,
    dispatchCanvasTransform,
    fitToContent,
    fitToContentModeActiveRef,
    fitToContentModeActive,
    saveFigureViewportState,
    setFitToContentModeActive,
    snapshotActiveRootId,
    snapshotMatchesActive,
    viewportSize.height,
    viewportSize.width
  ]);

  useEffect(() => {
    if (!viewportStateReadyRef.current || ownedFigureViewportKeyRef.current !== activeFigureViewportKey) {
      return;
    }
    // Layout effects may already have assigned a restored transform/fit mode.
    // Never save the old render's props over that newly owned state.
    saveFigureViewportState(activeFigureViewportKey, canvasTransformRef.current, fitToContentModeActiveRef.current);
  }, [activeFigureViewportKey, canvasTransform, canvasTransformRef, fitToContentModeActive, fitToContentModeActiveRef, saveFigureViewportState]);

  const handledFitRequestRef = useRef(0);
  const queuedFitRequestRef = useRef<{ token: number; key: string } | null>(null);
  useEffect(() => {
    if (fitToContentRequestToken <= 0) {
      return;
    }
    if (fitToContentRequestToken === handledFitRequestRef.current) {
      return;
    }
    if (queuedFitRequestRef.current?.token !== fitToContentRequestToken) queuedFitRequestRef.current = { token: fitToContentRequestToken, key: activeFigureViewportKey };
    if (queuedFitRequestRef.current.key !== activeFigureViewportKey) {
      handledFitRequestRef.current = fitToContentRequestToken;
      queuedFitRequestRef.current = null;
      return;
    }
    if (!snapshotMatchesActive || !viewportStateReadyRef.current) return;
    if (!fitToContentModeActiveRef.current) {
      setFitToContentModeActive(true);
    }
    if (fitToContent()) {
      pendingViewportCommitRef.current = null;
      handledFitRequestRef.current = fitToContentRequestToken;
      queuedFitRequestRef.current = null;
    }
  }, [activeFigureViewportKey, fitToContent, fitToContentModeActiveRef, fitToContentRequestToken, setFitToContentModeActive, snapshotMatchesActive, viewportSize.height, viewportSize.width]);

  const handledZoomRequestRef = useRef(0);
  const queuedZoomRequestRef = useRef<{ token: number; key: string } | null>(null);
  useEffect(() => {
    if (zoomRequestToken <= 0) {
      return;
    }
    if (zoomRequestToken === handledZoomRequestRef.current) {
      return;
    }
    if (queuedZoomRequestRef.current?.token !== zoomRequestToken) queuedZoomRequestRef.current = { token: zoomRequestToken, key: activeFigureViewportKey };
    if (queuedZoomRequestRef.current.key !== activeFigureViewportKey) {
      handledZoomRequestRef.current = zoomRequestToken;
      queuedZoomRequestRef.current = null;
      return;
    }
    if (!zoomRequestDirection || !svgResult || !viewportRef.current) {
      return;
    }
    if (snapshotMatchesActive && !viewportStateReadyRef.current) return;
    const viewportWidth = viewportRef.current.clientWidth;
    const viewportHeight = viewportRef.current.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    handledZoomRequestRef.current = zoomRequestToken;
    queuedZoomRequestRef.current = null;

    const currentTransform = canvasTransformRef.current;
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const zoomFactor = zoomRequestDirection === "in" ? 1.15 : 1 / 1.15;
    const nextScale = clamp(currentTransform.scale * zoomFactor, MIN_SCALE, maxZoomScale);
    if (Math.abs(nextScale - currentTransform.scale) < 1e-9) {
      return;
    }

    const svgPoint = viewportToSvgPoint(
      viewportPoint(px(centerX), px(centerY)),
      currentTransform,
      svgResult.viewBox
    );
    const translateX = centerX - (svgPoint.x - svgResult.viewBox.x) * nextScale;
    const translateY = centerY - (svgPoint.y - svgResult.viewBox.y) * nextScale;

    if (fitToContentModeActiveRef.current) {
      setFitToContentModeActive(false);
    }
    pendingViewportCommitRef.current = null;
    dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
  }, [
    activeFigureViewportKey,
    canvasTransformRef,
    dispatchCanvasTransform,
    fitToContentModeActiveRef,
    maxZoomScale,
    MIN_SCALE,
    setFitToContentModeActive,
    svgResult,
    viewportRef,
    viewportSize.height,
    viewportSize.width,
    zoomRequestDirection,
    zoomRequestToken,
    snapshotMatchesActive
  ]);

  const handledZoomScaleRequestRef = useRef(0);
  const queuedZoomScaleRequestRef = useRef<{ token: number; key: string } | null>(null);
  useEffect(() => {
    if (zoomScaleRequestToken <= 0) {
      return;
    }
    if (zoomScaleRequestToken === handledZoomScaleRequestRef.current) {
      return;
    }
    if (queuedZoomScaleRequestRef.current?.token !== zoomScaleRequestToken) queuedZoomScaleRequestRef.current = { token: zoomScaleRequestToken, key: activeFigureViewportKey };
    if (queuedZoomScaleRequestRef.current.key !== activeFigureViewportKey) {
      handledZoomScaleRequestRef.current = zoomScaleRequestToken;
      queuedZoomScaleRequestRef.current = null;
      return;
    }
    if (!svgResult || !viewportRef.current || zoomScaleRequestValue == null) {
      return;
    }
    if (snapshotMatchesActive && !viewportStateReadyRef.current) return;
    const viewportWidth = viewportRef.current.clientWidth;
    const viewportHeight = viewportRef.current.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    handledZoomScaleRequestRef.current = zoomScaleRequestToken;
    queuedZoomScaleRequestRef.current = null;

    const currentTransform = canvasTransformRef.current;
    const nextScale = clamp(zoomScaleRequestValue, MIN_SCALE, maxZoomScale);
    if (Math.abs(nextScale - currentTransform.scale) < 1e-9) {
      return;
    }

    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const svgPoint = viewportToSvgPoint(
      viewportPoint(px(centerX), px(centerY)),
      currentTransform,
      svgResult.viewBox
    );
    const translateX = centerX - (svgPoint.x - svgResult.viewBox.x) * nextScale;
    const translateY = centerY - (svgPoint.y - svgResult.viewBox.y) * nextScale;

    if (fitToContentModeActiveRef.current) {
      setFitToContentModeActive(false);
    }
    pendingViewportCommitRef.current = null;
    dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
  }, [
    activeFigureViewportKey,
    canvasTransformRef,
    dispatchCanvasTransform,
    fitToContentModeActiveRef,
    maxZoomScale,
    MIN_SCALE,
    setFitToContentModeActive,
    svgResult,
    viewportRef,
    viewportSize.height,
    viewportSize.width,
    zoomScaleRequestToken,
    zoomScaleRequestValue,
    snapshotMatchesActive
  ]);

  useEffect(() => {
    if (!fitToContentModeActive) {
      return;
    }
    if (!fitToContentModeActiveRef.current) {
      return;
    }
    if (!viewportStateReadyRef.current) return;
    if (!svgResult) {
      return;
    }
    if (activeCanvasDragKind || activeSourceScrubSourceId) {
      return;
    }
    if (snapshotSource !== source) {
      return;
    }
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    fitToContent();
  }, [
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    fitToContent,
    fitToContentModeActive,
    fitToContentModeActiveRef,
    lastEditChangeToken,
    snapshotSource,
    source,
    svgResult,
    viewportSize.height,
    viewportSize.width
  ]);

  return { maxZoomScale, viewportStateReadyRef };
}

function sameTransform(left: CanvasTransform, right: CanvasTransform): boolean {
  return Math.abs(left.translateX - right.translateX) < 1e-9 &&
    Math.abs(left.translateY - right.translateY) < 1e-9 &&
    Math.abs(left.scale - right.scale) < 1e-9;
}

function computeFitToContentScale(
  fitViewBox: { width: number; height: number } | null | undefined,
  viewportWidth: number,
  viewportHeight: number,
  minScale: number,
  maxScale: number,
  padding: number
): number | null {
  if (
    !fitViewBox ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    fitViewBox.width <= 0 ||
    fitViewBox.height <= 0
  ) {
    return null;
  }
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  return clamp(
    Math.min(availableWidth / fitViewBox.width, availableHeight / fitViewBox.height),
    minScale,
    maxScale
  );
}
