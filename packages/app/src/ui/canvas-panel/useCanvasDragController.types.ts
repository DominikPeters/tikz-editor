import type { EditAction } from "tikz-editor/edit/actions";
import type { SnapLine } from "tikz-editor/edit/snapping";
import type { EditHandle, NodeAnchorTarget, SceneElement } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/index";

import type { ScopeOverlayIndex } from "./scope-overlay";
import type { MatrixCellAnchorHint } from "./endpoint-anchor-snap";
import type { ResizeFrame } from "./resize-frames";
import type { PathToolGestureSegment } from "./path-tool";
import type {
  ApplyActionFeedback,
  DragState,
  DragTooltipState,
  GridResizeSnapConfig,
  NodeAnchorOverlayState,
  PendingAddedSelection,
  PendingBezier,
  SnapDebugLogInput,
  SourceBoundsMap
} from "./types";
import type { WorldPoint } from "../coords/types";
import type { EditorAction } from "../../store/types";

export type UseCanvasDragControllerParams = {
  applyActionWithFeedback: (action: EditAction, mergeKey?: string, sourceOverride?: string) => ApplyActionFeedback;
  dispatch: (action: EditorAction) => void;
  dispatchCanvasTransform: (transform: { translateX: number; translateY: number; scale: number }) => void;
  logSnapDebug: (input: SnapDebugLogInput) => void;
  queueSelectionForAddedElement: (preferredWorld: WorldPoint, preferredSourceId?: string) => void;
  snapshotSource: string;
  snapshotScene: { elements: SceneElement[] } | null;
  snapshotEditHandles: EditHandle[];
  nodeAnchorTargets: readonly NodeAnchorTarget[];
  matrixCellAnchorHints: readonly MatrixCellAnchorHint[];
  source: string;
  svgResult: { viewBox: SvgViewBox } | null;
  dragRef: { current: DragState | null };
  suppressNextBackgroundClickRef: { current: boolean };
  svgResultRef: { current: { viewBox: SvgViewBox } | null };
  interactionSvgRef: { current: SVGSVGElement | null };
  liveResizeFramesRef: { current: ReadonlyMap<string, ResizeFrame | null> };
  selectedElementIdsRef: { current: ReadonlySet<string> };
  sourceBoundsSvgRef: { current: SourceBoundsMap };
  scopeOverlay: ScopeOverlayIndex;
  pendingAddedSelectionRef: { current: PendingAddedSelection | null };
  setDragState: (drag: DragState | null) => void;
  setSnapLines: (lines: SnapLine[]) => void;
  setToolDraft: (draft: Extract<DragState, { kind: "tool-create" }> | null) => void;
  setBezierBendDraft: (draft: Extract<DragState, { kind: "tool-bezier-bend" }> | null) => void;
  setPathSegmentDraft: (draft: Extract<DragState, { kind: "tool-path-segment" }> | null) => void;
  commitPathToolSegment: (segment: PathToolGestureSegment) => void;
  appendFreehandSamplePoint: (point: WorldPoint) => WorldPoint[] | null;
  finalizeFreehandDraft: (overridePoints?: WorldPoint[]) => void;
  setPendingBezier: (pending: PendingBezier | null) => void;
  setToolCursorWorld: (point: WorldPoint | null) => void;
  setMarqueeDraft: (draft: Extract<DragState, { kind: "marquee" }> | null) => void;
  setNodeAnchorOverlay: (overlay: NodeAnchorOverlayState | null) => void;
  setDragTooltip: (tooltip: DragTooltipState | null) => void;
  setWarning: (warning: string | null) => void;
  setPathAttachedNodePreview: (preview: { sourceId: string; dx: number; dy: number } | null) => void;
  selectedAddShape: string;
  creationStrokeColor: string;
  creationFillColor: string;
  onSnapFeedback?: () => void;
};

export type CanvasGridResizeSnapConfig = GridResizeSnapConfig;
