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
import type { CanvasDispatch, CanvasSnapshot, ValueSetter } from "./types";

type FigureViewportState = {
  transform: CanvasTransform;
  fitToContentModeActive: boolean;
};

export type UseCanvasViewportPersistenceArgs = {
  baseSvgResult: CanvasSnapshot["svg"];
  svgResult: CanvasSnapshot["svg"];
  viewportSize: { width: number; height: number };
  dispatch: CanvasDispatch;
  dispatchCanvasTransform: (transform: CanvasTransform) => void;
  activeDocumentId: string;
  activeFigureId: string | null;
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
  dispatch,
  dispatchCanvasTransform,
  activeDocumentId,
  activeFigureId,
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
}: UseCanvasViewportPersistenceArgs): { maxZoomScale: number } {
  const viewportStateByFigureKeyRef = useRef(new Map<string, FigureViewportState>());
  const visitedFigureKeysRef = useRef(new Set<string>());
  const previousFigureViewportKeyRef = useRef<string | null>(null);
  const pendingFirstVisitAutoFitKeyRef = useRef<string | null>(null);

  const fitToContentScale = useMemo(
    () => computeFitToContentScale(
      baseSvgResult?.viewBox ?? svgResult?.viewBox,
      viewportSize.width,
      viewportSize.height,
      MIN_SCALE,
      MAX_SCALE
    ),
    [baseSvgResult, MAX_SCALE, MIN_SCALE, svgResult, viewportSize.height, viewportSize.width]
  );

  useEffect(() => {
    dispatch({ type: "SET_CANVAS_FIT_TO_CONTENT_SCALE", scale: fitToContentScale });
  }, [dispatch, fitToContentScale]);

  const maxZoomScale = Math.max(MAX_SCALE, fitToContentScale == null ? MAX_SCALE : fitToContentScale * 2);

  const fitToContent = useCallback((): boolean => {
    const fitViewBox = baseSvgResult?.viewBox ?? svgResult?.viewBox;
    const renderViewBox = svgResult?.viewBox ?? fitViewBox;
    if (!fitViewBox || !renderViewBox || !viewportRef.current) return false;

    const viewportWidth = viewportRef.current.clientWidth;
    const viewportHeight = viewportRef.current.clientHeight;

    const scale = computeFitToContentScale(fitViewBox, viewportWidth, viewportHeight, MIN_SCALE, MAX_SCALE);
    if (scale == null) {
      return false;
    }

    const fitLeft = (viewportWidth - fitViewBox.width * scale) / 2;
    const fitTop = (viewportHeight - fitViewBox.height * scale) / 2;
    const translateX = fitLeft - (fitViewBox.x - renderViewBox.x) * scale;
    const translateY = fitTop - (fitViewBox.y - renderViewBox.y) * scale;

    dispatchCanvasTransform({ translateX, translateY, scale });
    return true;
  }, [baseSvgResult, dispatchCanvasTransform, MAX_SCALE, MIN_SCALE, svgResult, viewportRef]);

  const activeFigureViewportKey = useMemo(
    () => makeFigureViewportKey(activeDocumentId, activeFigureId),
    [activeDocumentId, activeFigureId]
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
      visitedFigureKeysRef.current.add(key);
    },
    []
  );

  useEffect(() => {
    const openDocuments = new Set(tabOrder);
    for (const key of viewportStateByFigureKeyRef.current.keys()) {
      const delimiter = key.indexOf("::");
      const documentId = delimiter >= 0 ? key.slice(0, delimiter) : key;
      if (!openDocuments.has(documentId)) {
        viewportStateByFigureKeyRef.current.delete(key);
        visitedFigureKeysRef.current.delete(key);
        if (pendingFirstVisitAutoFitKeyRef.current === key) {
          pendingFirstVisitAutoFitKeyRef.current = null;
        }
      }
    }
  }, [tabOrder]);

  useLayoutEffect(() => {
    const pendingAutoFit = pendingFirstVisitAutoFitKeyRef.current === activeFigureViewportKey;
    if (previousFigureViewportKeyRef.current === activeFigureViewportKey && !pendingAutoFit) {
      return;
    }

    const previousKey = previousFigureViewportKeyRef.current;
    if (previousKey && previousKey !== activeFigureViewportKey) {
      const previousTransform = canvasTransformRef.current;
      saveFigureViewportState(previousKey, previousTransform, fitToContentModeActiveRef.current);
    }

    const savedState = viewportStateByFigureKeyRef.current.get(activeFigureViewportKey);
    if (savedState) {
      pendingFirstVisitAutoFitKeyRef.current = null;
      if (fitToContentModeActiveRef.current !== savedState.fitToContentModeActive) {
        setFitToContentModeActive(savedState.fitToContentModeActive);
      }
      dispatchCanvasTransform(savedState.transform);
      previousFigureViewportKeyRef.current = activeFigureViewportKey;
      return;
    }

    const hasVisited = visitedFigureKeysRef.current.has(activeFigureViewportKey);
    if (!hasVisited || pendingAutoFit) {
      visitedFigureKeysRef.current.add(activeFigureViewportKey);
      if (!fitToContentModeActiveRef.current) {
        setFitToContentModeActive(true);
      }
      const didFit = fitToContent();
      previousFigureViewportKeyRef.current = activeFigureViewportKey;
      if (didFit) {
        pendingFirstVisitAutoFitKeyRef.current = null;
      } else {
        pendingFirstVisitAutoFitKeyRef.current = activeFigureViewportKey;
      }
      return;
    }

    pendingFirstVisitAutoFitKeyRef.current = null;
    previousFigureViewportKeyRef.current = activeFigureViewportKey;
  }, [
    activeFigureViewportKey,
    canvasTransformRef,
    dispatchCanvasTransform,
    fitToContent,
    fitToContentModeActiveRef,
    saveFigureViewportState,
    setFitToContentModeActive
  ]);

  useEffect(() => {
    if (previousFigureViewportKeyRef.current !== activeFigureViewportKey) {
      return;
    }
    if (!visitedFigureKeysRef.current.has(activeFigureViewportKey)) {
      return;
    }
    if (pendingFirstVisitAutoFitKeyRef.current === activeFigureViewportKey) {
      return;
    }
    saveFigureViewportState(activeFigureViewportKey, canvasTransform, fitToContentModeActive);
  }, [activeFigureViewportKey, canvasTransform, fitToContentModeActive, saveFigureViewportState]);

  const handledFitRequestRef = useRef(0);
  useEffect(() => {
    if (fitToContentRequestToken <= 0) {
      return;
    }
    if (fitToContentRequestToken === handledFitRequestRef.current) {
      return;
    }
    handledFitRequestRef.current = fitToContentRequestToken;
    if (!fitToContentModeActiveRef.current) {
      setFitToContentModeActive(true);
    }
    fitToContent();
  }, [fitToContent, fitToContentModeActiveRef, fitToContentRequestToken, setFitToContentModeActive]);

  const handledZoomRequestRef = useRef(0);
  useEffect(() => {
    if (zoomRequestToken <= 0) {
      return;
    }
    if (zoomRequestToken === handledZoomRequestRef.current) {
      return;
    }
    handledZoomRequestRef.current = zoomRequestToken;
    if (!zoomRequestDirection || !svgResult || !viewportRef.current) {
      return;
    }

    const currentTransform = canvasTransformRef.current;
    const centerX = viewportRef.current.clientWidth / 2;
    const centerY = viewportRef.current.clientHeight / 2;
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
    dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
  }, [
    canvasTransformRef,
    dispatchCanvasTransform,
    fitToContentModeActiveRef,
    maxZoomScale,
    MIN_SCALE,
    setFitToContentModeActive,
    svgResult,
    viewportRef,
    zoomRequestDirection,
    zoomRequestToken
  ]);

  const handledZoomScaleRequestRef = useRef(0);
  useEffect(() => {
    if (zoomScaleRequestToken <= 0) {
      return;
    }
    if (zoomScaleRequestToken === handledZoomScaleRequestRef.current) {
      return;
    }
    handledZoomScaleRequestRef.current = zoomScaleRequestToken;
    if (!svgResult || !viewportRef.current || zoomScaleRequestValue == null) {
      return;
    }

    const currentTransform = canvasTransformRef.current;
    const nextScale = clamp(zoomScaleRequestValue, MIN_SCALE, maxZoomScale);
    if (Math.abs(nextScale - currentTransform.scale) < 1e-9) {
      return;
    }

    const centerX = viewportRef.current.clientWidth / 2;
    const centerY = viewportRef.current.clientHeight / 2;
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
    dispatchCanvasTransform({ translateX, translateY, scale: nextScale });
  }, [
    canvasTransformRef,
    dispatchCanvasTransform,
    fitToContentModeActiveRef,
    maxZoomScale,
    MIN_SCALE,
    setFitToContentModeActive,
    svgResult,
    viewportRef,
    zoomScaleRequestToken,
    zoomScaleRequestValue
  ]);

  useEffect(() => {
    if (!fitToContentModeActive) {
      return;
    }
    if (!fitToContentModeActiveRef.current) {
      return;
    }
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

  return { maxZoomScale };
}

function computeFitToContentScale(
  fitViewBox: { width: number; height: number } | null | undefined,
  viewportWidth: number,
  viewportHeight: number,
  minScale: number,
  maxScale: number
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
  const availableWidth = Math.max(1, viewportWidth - 44 * 2);
  const availableHeight = Math.max(1, viewportHeight - 44 * 2);
  return clamp(
    Math.min(availableWidth / fitViewBox.width, availableHeight / fitViewBox.height),
    minScale,
    maxScale
  );
}

function makeFigureViewportKey(documentId: string, figureId: string | null): string {
  return `${documentId}::${figureId ?? "__all__"}`;
}
