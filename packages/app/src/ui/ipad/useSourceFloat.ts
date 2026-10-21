import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from "react";
import { isRecord } from "../../validation";
import { readSafeAreaBottom } from "./ipad-safe-area";

export type SourceFloatRect = { x: number; y: number; width: number; height: number };

type WorkspaceSize = { width: number; height: number };

/** height is null until the user resizes vertically; auto-fit to content applies until then. */
type StoredFloatRect = { x: number; y: number; width: number; height: number | null };

type HeaderDragState = {
  pointerId: number;
  mode: "float" | "pinned";
  grabOffsetX: number;
  grabOffsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};

type ResizeDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
};

const FLOAT_STORAGE_KEY = "tikz-editor-ipad-source-float";
const EDGE_MARGIN = 12;
const TOP_MARGIN = 10;
const MIN_FLOAT_WIDTH = 280;
const MAX_FLOAT_WIDTH = 640;
const MAX_FLOAT_WIDTH_FRACTION = 0.7;
const MIN_FLOAT_HEIGHT = 240;
/* Header + accessory bar + editor padding surrounding the text. */
const FLOAT_CHROME_HEIGHT = 104;
const SOURCE_LINE_HEIGHT = 21;
const DOCK_ZONE_WIDTH = 36;
const UNDOCK_DRAG_DISTANCE = 44;
const DRAG_SLOP = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readStoredFloatRect(): StoredFloatRect | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const stored = localStorage.getItem(FLOAT_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) {
      return null;
    }
    const { x, y, width, height } = parsed;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width)) {
      return null;
    }
    return { x, y, width, height: isFiniteNumber(height) ? height : null };
  } catch {
    return null;
  }
}

function storeFloatRect(value: StoredFloatRect): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(FLOAT_STORAGE_KEY, JSON.stringify({
      x: Math.round(value.x),
      y: Math.round(value.y),
      width: Math.round(value.width),
      height: value.height == null ? null : Math.round(value.height)
    }));
  } catch {
    // Persistence is nice-to-have; the floating panel still works for the session.
  }
}

function defaultFloatWidth(workspaceWidth: number): number {
  return Math.max(MIN_FLOAT_WIDTH, Math.min(workspaceWidth * 0.46, 520));
}

function autoFitHeight(lineCount: number): number {
  return lineCount * SOURCE_LINE_HEIGHT + FLOAT_CHROME_HEIGHT;
}

function clampRect(rect: SourceFloatRect, size: WorkspaceSize, safeAreaBottom: number): SourceFloatRect {
  const maxWidth = Math.min(MAX_FLOAT_WIDTH, size.width * MAX_FLOAT_WIDTH_FRACTION);
  const width = clamp(rect.width, MIN_FLOAT_WIDTH, Math.max(MIN_FLOAT_WIDTH, maxWidth));
  const maxHeight = size.height - TOP_MARGIN - EDGE_MARGIN - safeAreaBottom;
  const height = clamp(rect.height, MIN_FLOAT_HEIGHT, Math.max(MIN_FLOAT_HEIGHT, maxHeight));
  const x = clamp(rect.x, EDGE_MARGIN, Math.max(EDGE_MARGIN, size.width - width - EDGE_MARGIN));
  const y = clamp(rect.y, TOP_MARGIN, Math.max(TOP_MARGIN, size.height - height - EDGE_MARGIN - safeAreaBottom));
  return { x, y, width, height };
}

export type UseSourceFloatResult = {
  /** Rendered rect for the floating drawer; null until the workspace is measured. */
  rect: SourceFloatRect | null;
  dragging: boolean;
  resizing: boolean;
  settling: boolean;
  dockPreview: boolean;
  workspaceSize: WorkspaceSize | null;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSettled: () => void;
};

export function useSourceFloat(options: {
  workspaceRef: RefObject<HTMLDivElement | null>;
  visible: boolean;
  pinned: boolean;
  lineCount: number;
  onDock: (width: number) => void;
  onUndock: () => void;
}): UseSourceFloatResult {
  const { workspaceRef, visible, pinned, lineCount, onDock, onUndock } = options;

  const [stored, setStored] = useState<StoredFloatRect | null>(readStoredFloatRect);
  const [workspaceSize, setWorkspaceSize] = useState<WorkspaceSize | null>(null);
  const [safeAreaBottom, setSafeAreaBottom] = useState(0);
  const [liveRect, setLiveRect] = useState<SourceFloatRect | null>(null);
  const [headerTracking, setHeaderTracking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [settling, setSettling] = useState(false);
  const [dockPreview, setDockPreview] = useState(false);
  const [autoFitLines, setAutoFitLines] = useState(lineCount);

  const headerDragRef = useRef<HeaderDragState | null>(null);
  const resizeDragRef = useRef<ResizeDragState | null>(null);
  // Mirrors of liveRect/dockPreview that update immediately on pointer events,
  // so a pointerup that lands before React flushes the last move still commits
  // the final geometry rather than a stale render snapshot.
  const liveRectRef = useRef<SourceFloatRect | null>(null);
  const dockPreviewRef = useRef(false);
  const onDockRef = useRef(onDock);
  onDockRef.current = onDock;
  const onUndockRef = useRef(onUndock);
  onUndockRef.current = onUndock;
  const lineCountRef = useRef(lineCount);
  lineCountRef.current = lineCount;

  // Capture the content size whenever the floating panel opens so the panel
  // doesn't grow underneath the user while they type.
  const floatingOpen = visible && !pinned;
  useEffect(() => {
    if (floatingOpen) {
      setAutoFitLines(lineCountRef.current);
    }
  }, [floatingOpen]);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }
    const syncSize = () => {
      const rect = workspace.getBoundingClientRect();
      setWorkspaceSize({ width: rect.width, height: rect.height });
      setSafeAreaBottom(readSafeAreaBottom());
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(workspace);
    window.visualViewport?.addEventListener("resize", syncSize);
    window.addEventListener("orientationchange", syncSize);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", syncSize);
      window.removeEventListener("orientationchange", syncSize);
    };
  }, [workspaceRef]);

  const restRect: SourceFloatRect | null = workspaceSize
    ? clampRect(
        {
          x: stored?.x ?? EDGE_MARGIN,
          y: stored?.y ?? TOP_MARGIN,
          width: stored?.width ?? defaultFloatWidth(workspaceSize.width),
          height: stored?.height ?? autoFitHeight(autoFitLines)
        },
        workspaceSize,
        safeAreaBottom
      )
    : null;
  const rect = (dragging || resizing) && liveRect ? liveRect : restRect;

  const stateRef = useRef({ pinned, stored, safeAreaBottom, workspaceSize, restRect, autoFitLines });
  stateRef.current = { pinned, stored, safeAreaBottom, workspaceSize, restRect, autoFitLines };

  const setLive = useCallback((next: SourceFloatRect | null) => {
    liveRectRef.current = next;
    setLiveRect(next);
  }, []);

  const persistRect = useCallback((next: SourceFloatRect, explicitHeight: boolean) => {
    const previous = stateRef.current.stored;
    const nextStored: StoredFloatRect = {
      x: next.x,
      y: next.y,
      width: next.width,
      height: explicitHeight ? next.height : previous?.height ?? null
    };
    setStored(nextStored);
    storeFloatRect(nextStored);
  }, []);

  const onHeaderPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button")) {
      return;
    }
    const workspace = workspaceRef.current;
    if (!workspace || headerDragRef.current || resizeDragRef.current) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a routing optimization; the window listeners below cover the drag.
    }
    if (stateRef.current.pinned) {
      // Tear-off starts only after the drag passes the undock threshold.
      headerDragRef.current = {
        pointerId: event.pointerId,
        mode: "pinned",
        grabOffsetX: 0,
        grabOffsetY: 0,
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false
      };
      setHeaderTracking(true);
      return;
    }
    const current = stateRef.current.restRect;
    if (!current) {
      return;
    }
    const workspaceRect = workspace.getBoundingClientRect();
    headerDragRef.current = {
      pointerId: event.pointerId,
      mode: "float",
      grabOffsetX: event.clientX - workspaceRect.left - current.x,
      grabOffsetY: event.clientY - workspaceRect.top - current.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false
    };
    setHeaderTracking(true);
    setSettling(false);
    setDragging(true);
    setLive(current);
  }, [setLive, workspaceRef]);

  const moveHeaderDrag = useCallback((pointerId: number, clientX: number, clientY: number) => {
    const drag = headerDragRef.current;
    const workspace = workspaceRef.current;
    if (!workspace || drag?.pointerId !== pointerId) {
      return;
    }
    const dragDistance = Math.hypot(clientX - drag.startClientX, clientY - drag.startClientY);
    if (dragDistance > DRAG_SLOP) {
      drag.moved = true;
    }
    const workspaceRect = workspace.getBoundingClientRect();
    const size: WorkspaceSize = { width: workspaceRect.width, height: workspaceRect.height };
    const pointerX = clientX - workspaceRect.left;
    const pointerY = clientY - workspaceRect.top;
    const safeBottom = stateRef.current.safeAreaBottom;

    if (drag.mode === "pinned") {
      if (dragDistance < UNDOCK_DRAG_DISTANCE) {
        return;
      }
      // Tear the panel off the edge and continue the drag as a floating window.
      const storedRect = stateRef.current.stored;
      const width = clamp(
        storedRect?.width ?? defaultFloatWidth(size.width),
        MIN_FLOAT_WIDTH,
        Math.max(MIN_FLOAT_WIDTH, Math.min(MAX_FLOAT_WIDTH, size.width * MAX_FLOAT_WIDTH_FRACTION))
      );
      const height = storedRect?.height ?? autoFitHeight(stateRef.current.autoFitLines);
      drag.mode = "float";
      drag.grabOffsetX = clamp(pointerX, 40, width - 40);
      drag.grabOffsetY = 21;
      onUndockRef.current();
      setSettling(false);
      setDragging(true);
      setLive(clampRect(
        { x: pointerX - drag.grabOffsetX, y: pointerY - drag.grabOffsetY, width, height },
        size,
        safeBottom
      ));
      return;
    }

    const current = liveRectRef.current ?? stateRef.current.restRect;
    if (!current) {
      return;
    }
    setLive(clampRect(
      { ...current, x: pointerX - drag.grabOffsetX, y: pointerY - drag.grabOffsetY },
      size,
      safeBottom
    ));
    dockPreviewRef.current = pointerX <= DOCK_ZONE_WIDTH;
    setDockPreview(dockPreviewRef.current);
  }, [setLive, workspaceRef]);

  const finishHeaderDrag = useCallback((pointerId: number) => {
    const drag = headerDragRef.current;
    if (drag?.pointerId !== pointerId) {
      return;
    }
    headerDragRef.current = null;
    setHeaderTracking(false);
    if (drag.mode === "pinned") {
      // Never passed the tear-off threshold; the panel stays pinned.
      return;
    }
    const finalRect = liveRectRef.current ?? stateRef.current.restRect;
    const shouldDock = dockPreviewRef.current;
    dockPreviewRef.current = false;
    setDragging(false);
    setDockPreview(false);
    setLive(null);
    if (!finalRect) {
      return;
    }
    if (shouldDock) {
      onDockRef.current(finalRect.width);
      return;
    }
    if (drag.moved) {
      persistRect(finalRect, false);
    }
    setSettling(true);
  }, [persistRect, setLive]);

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (headerDragRef.current || resizeDragRef.current) {
      return;
    }
    const current = stateRef.current.restRect;
    if (!current) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a routing optimization; the window listeners below cover the drag.
    }
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: current.width,
      startHeight: current.height
    };
    setSettling(false);
    setResizing(true);
    setLive(current);
  }, [setLive]);

  const moveResizeDrag = useCallback((pointerId: number, clientX: number, clientY: number) => {
    const drag = resizeDragRef.current;
    if (drag?.pointerId !== pointerId) {
      return;
    }
    const current = liveRectRef.current;
    const size = stateRef.current.workspaceSize;
    if (!current || !size) {
      return;
    }
    const safeBottom = stateRef.current.safeAreaBottom;
    const maxWidth = Math.min(
      MAX_FLOAT_WIDTH,
      size.width * MAX_FLOAT_WIDTH_FRACTION,
      size.width - current.x - EDGE_MARGIN
    );
    const maxHeight = size.height - current.y - EDGE_MARGIN - safeBottom;
    setLive({
      ...current,
      width: clamp(drag.startWidth + clientX - drag.startClientX, MIN_FLOAT_WIDTH, Math.max(MIN_FLOAT_WIDTH, maxWidth)),
      height: clamp(drag.startHeight + clientY - drag.startClientY, MIN_FLOAT_HEIGHT, Math.max(MIN_FLOAT_HEIGHT, maxHeight))
    });
  }, [setLive]);

  const finishResizeDrag = useCallback((pointerId: number) => {
    const drag = resizeDragRef.current;
    if (drag?.pointerId !== pointerId) {
      return;
    }
    resizeDragRef.current = null;
    const finalRect = liveRectRef.current;
    setResizing(false);
    setLive(null);
    if (finalRect) {
      persistRect(finalRect, true);
    }
    setSettling(true);
  }, [persistRect, setLive]);

  useEffect(() => {
    if (!headerTracking && !resizing) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      event.preventDefault();
      moveHeaderDrag(event.pointerId, event.clientX, event.clientY);
      moveResizeDrag(event.pointerId, event.clientX, event.clientY);
    }

    function onPointerEnd(event: PointerEvent): void {
      finishHeaderDrag(event.pointerId);
      finishResizeDrag(event.pointerId);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [finishHeaderDrag, finishResizeDrag, headerTracking, moveHeaderDrag, moveResizeDrag, resizing]);

  const onSettled = useCallback(() => { setSettling(false); }, []);

  return {
    rect,
    dragging,
    resizing,
    settling,
    dockPreview,
    workspaceSize,
    onHeaderPointerDown,
    onResizePointerDown,
    onSettled
  };
}
