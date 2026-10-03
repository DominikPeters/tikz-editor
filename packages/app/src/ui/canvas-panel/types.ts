import type { DocumentEditSession } from "../../edit-session";
import type { EditGeometrySession } from "@tikz-editor/core/edit/geometry-session";
import type { AdornmentOwnerGeometry, Span, Statement } from "@tikz-editor/core/ast/types";
import type { ComplexPathSegment } from "@tikz-editor/core/edit/element-templates";
import type { EditAction, MoveElementsBaseline, ResizeRole } from "@tikz-editor/core/edit/actions";
import type { PathRectangleResizeBaseline } from "@tikz-editor/core/edit/actions/resize-element";
import type { EditParseOptions } from "@tikz-editor/core/edit/parse-options";
import type { AxisSnapBuckets, SelectionGeometry, SnapContext, SnapLine } from "@tikz-editor/core/edit/snapping";
import type { EditHandle, NodeAnchorTarget, SceneElement, SceneText } from "@tikz-editor/core/semantic/types";
import type { SvgViewBox } from "@tikz-editor/core/svg/index";
import type { NodeTextLayoutKind } from "@tikz-editor/core/text/types";
import type { FrameTransform } from "@tikz-editor/core/coords/index";
import type { Dispatch, SetStateAction } from "react";

import type { SessionSnapshot } from "../../compute";
import type { CanvasTransform, EditorAction } from "../../store/types";
import type { CanvasContextMenuTarget } from "../../context-menu";
import type { ToolCreateMode } from "../tool-config";
import type { ClientPoint, SvgBounds, SvgPoint, ViewportBounds, ViewportPoint, WorldBounds, WorldPoint, WorldVector } from "../coords/types";
import type { HitRegion } from "./hit-regions";
import type { ResizeFrame } from "./resize-frames";
import type { MatrixCellAnchorHint } from "./endpoint-anchor-snap";

export type GuideOrientation = "vertical" | "horizontal";

export type CanvasDispatch = (action: EditorAction) => void;

export type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type ValueSetter<T> = (value: T) => void;

export type CanvasSnapshot = SessionSnapshot;

export type CanvasSvgResult = SessionSnapshot["svg"];

export type CanvasSvgRenderModel = SessionSnapshot["svgModel"];

export type CanvasEditParseOptions = EditParseOptions;

export type ApplyActionWithFeedbackFn = (
  action: EditAction,
  historyMergeKey?: string,
  sourceOverride?: string,
  geometry?: EditGeometrySession,
  recordInHistory?: boolean
) => ApplyActionFeedback;

export type CanvasContextMenuState = {
  target: CanvasContextMenuTarget;
  anchor: ViewportPoint;
  handleIdOverride?: string | null;
  includeEditEquationForSingleNode?: boolean;
  nodePositioningAction?: "position-relative" | "convert-absolute" | null;
  includePathSubmenuForSingleSelection?: boolean;
  includeFlattenForeach?: boolean;
  includeMatrixMultiRemoveRow?: boolean;
  includeMatrixMultiRemoveColumn?: boolean;
  includeMatrixMultiInsertRowAbove?: boolean;
  includeMatrixMultiInsertRowBelow?: boolean;
  includeMatrixMultiInsertColumnLeft?: boolean;
  includeMatrixMultiInsertColumnRight?: boolean;
};

export type GuidesState = {
  vertical: number[];
  horizontal: number[];
};

export type GuidePreview = {
  orientation: GuideOrientation;
  value: number;
  hideValue?: number;
  visible?: boolean;
};

export type GuideDragState = {
  pointerId: number;
  orientation: GuideOrientation;
  source: "ruler" | "guide";
  sourceValue?: number;
  value: number;
  overViewport: boolean;
  overDeleteZone: boolean;
};

export type SelectionAnchorRatio = Readonly<{
  x: number;
  y: number;
}>;

export type GridResizeSnapConfig = {
  anchorWorld: WorldPoint;
  stepX: number;
  stepY: number;
  transform: FrameTransform;
};

export type DragTooltipRow = {
  label: string;
  value: string;
};

export type DragTooltipState = {
  kind: "resize" | "rotate" | "tool-create";
  anchor: ClientPoint;
  rows: DragTooltipRow[];
};

export type PendingTouchViewport = {
  pointerId: number;
  startClient: ClientPoint;
  additiveSelection: boolean;
  startTransform: CanvasTransform;
  timer: ReturnType<typeof setTimeout>;
};

export type MagnifierState = {
  pointerId: number;
  center: ViewportPoint;
};

export type DragState =
  | {
      kind: "element";
      geometry?: EditGeometrySession;
      didEdit?: boolean;
      pointerId: number;
      elementIds: string[];
      startWorld: WorldPoint;
      adornmentDragFromText?: boolean;
      lastAppliedTotalDelta: WorldVector;
      baseline: MoveElementsBaseline;
      latestSource: string;
      editSession?: DocumentEditSession;
      snapTargets?: AxisSnapBuckets;
      adornmentDrag?: {
        ownerPoint: WorldPoint;
        ownerGeometry?: AdornmentOwnerGeometry;
        allowCenter: boolean;
        pointerOffsetFromReference: WorldVector;
        textDrag?: {
          pointerOffsetFromCenter: WorldVector;
          halfWidth: number;
          halfHeight: number;
        };
      };
      pathAttachedNodeDrag?: {
        nodeId: string;
        hostPathSourceId: string;
        pointerOffsetFromCenter: WorldVector;
        initialCenter: WorldPoint;
        initialAnchorPoint: WorldPoint;
        initialAnchorOffset: WorldVector;
        initialDistancePt: number;
        initialDirectionalAnchorPt: number;
        position: number;
        segment: NonNullable<EditHandle["pathAttachmentContext"]>["segment"];
        regime: NonNullable<EditHandle["pathAttachmentContext"]>["regime"];
        lastPreviewDelta?: WorldVector;
        lastAppliedPlacementKey?: string;
      };
      snapContext: SnapContext | null;
      initialSelection: SelectionGeometry | null;
      selectionAnchorRatio: SelectionAnchorRatio | null;
      historyMergeKey: string;
    }
  | {
      kind: "resize";
      geometry?: EditGeometrySession;
      didEdit?: boolean;
      rectangleBaseline: PathRectangleResizeBaseline | null;
      latestSource: string;
      editSession?: DocumentEditSession;
      snapContext: SnapContext | null;
      snapTargets?: AxisSnapBuckets;
      snapPoint?: WorldPoint;
      pointerId: number;
      elementId: string;
      role: ResizeRole;
      movingCornerRole?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
      cursor: string;
      preserveAspectRatio: number | null;
      initialFrame: ResizeFrame;
      initialScopeTransform:
        | {
            xscale: number;
            yscale: number;
            xshift: number;
            yshift: number;
          }
        | null;
      measurementMode: "center" | "opposite-corner";
      preserveAspectDuringResize: boolean;
      historyMergeKey: string;
    }
  | {
      kind: "rotate";
      geometry?: EditGeometrySession;
      didEdit?: boolean;
      pointerId: number;
      elementId: string;
      sourceId: string;
      cursor: string;
      centerWorld: WorldPoint;
      startPointerAngleDeg: number;
      centerPivotWorld: WorldPoint;
      startCenterPivotPointerAngleDeg: number;
      baseRotateDeg: number;
      lastAppliedRotateDeg: number;
      lastAppliedRotateMode: "property" | "origin" | "center-pivot";
      activeRotateMode: "property" | "origin" | "center-pivot";
      lastPointerClient: ClientPoint;
      lastPointerWorld: WorldPoint;
      preEditBaselineSource: string;
      latestSource: string;
      editSession?: DocumentEditSession;
      historyMergeKey: string;
    }
  | {
      kind: "handle";
      geometry?: EditGeometrySession;
      didEdit?: boolean;
      latestSource: string;
      editSession?: DocumentEditSession;
      snapTargets?: AxisSnapBuckets;
      pointerId: number;
      handleId: string;
      handleEditingId?: string;
      sourceId: string;
      handleKind: EditHandle["kind"];
      cursor: string;
      lastKnownWorld: WorldPoint;
      snapContext: SnapContext | null;
      gridResizeSnap: GridResizeSnapConfig | null;
      historyMergeKey: string;
      activeEndpointAnchor: NodeAnchorTarget | null;
      nodeAnchorTargets: readonly NodeAnchorTarget[];
      matrixCellAnchorHints: readonly MatrixCellAnchorHint[];
    }
  | {
      kind: "pan";
      pointerId: number;
      startClient: ClientPoint;
      startTransform: CanvasTransform;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startWorld: WorldPoint;
      currentWorld: WorldPoint;
      additive: boolean;
      baseSelectedIds: string[];
    }
  | {
      kind: "tool-create";
      pointerId: number;
      toolMode: ToolCreateMode;
      startWorld: WorldPoint;
      startEndpointAnchor: NodeAnchorTarget | null;
      rawCurrentWorld: WorldPoint;
      currentWorld: WorldPoint;
      activeEndpointAnchor: NodeAnchorTarget | null;
      snapContext: SnapContext | null;
      previousToolTargets?: AxisSnapBuckets;
    }
  | {
      kind: "tool-bezier-bend";
      pointerId: number;
      startWorld: WorldPoint;
      endWorld: WorldPoint;
      rawCurrentWorld: WorldPoint;
      currentWorld: WorldPoint;
      snapContext: SnapContext | null;
      previousToolTargets?: AxisSnapBuckets;
    }
  | {
      kind: "tool-path-segment";
      pointerId: number;
      startWorld: WorldPoint;
      endWorld: WorldPoint;
      endEndpointAnchor: NodeAnchorTarget | null;
      startPointerWorld: WorldPoint;
      rawBendWorld: WorldPoint;
      bendWorld: WorldPoint;
      isBending: boolean;
      snapContext: SnapContext | null;
      previousToolTargets?: AxisSnapBuckets;
    }
  | {
      kind: "tool-freehand";
      pointerId: number;
      points: WorldPoint[];
      minSampleDistanceWorld: number;
    }
  ;

export type PendingAddedSelection = {
  beforeIds: Set<string>;
  preferredWorld: WorldPoint;
  preferredSourceId?: string;
};

export type PendingBezier = {
  startWorld: WorldPoint;
  endWorld: WorldPoint;
};

export type PathAppendTarget = {
  elementId: string;
  end: "start" | "end";
};

export type PathToolDraft = {
  startWorld: WorldPoint;
  segments: ComplexPathSegment[];
  appendTarget?: PathAppendTarget;
};

export type FreehandToolDraft = {
  points: WorldPoint[];
  minSampleDistanceWorld: number;
};

export type TextSelectionOverlay = {
  sourceId: string;
  selectionStart: number;
  selectionEnd: number;
  caret: TextSelectionOverlayBox | null;
  rects: TextSelectionOverlayBox[];
};

export type TextSelectionOverlayBox = {
  bounds: ViewportBounds;
  center?: ViewportPoint;
  rotationDeg?: number;
};

/**
 * One rendered paragraph inside a scope-wide editing session, in flow
 * order: enough to route document offsets and pointer positions to the
 * paragraph that renders them.
 */
export type ScopeParagraphRef = {
  paragraphId: string;
  /** Paragraph layout span in document coordinates. */
  sourceSpan: Span;
  /** Paragraph bounds in SVG/page coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
};

export type TextEditingSession = {
  sourceId: string;
  sceneTextId: string;
  sourceSpan: Span;
  workingSource: string;
  /**
   * Structure-free document spans inside the buffer that may be masked for
   * the structural parse while their content is transiently invalid.
   * Null means the whole buffer is structure-free (TikZ node sessions).
   */
  maskRanges: readonly Span[] | null;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  historyMergeKey: string;
  usesTex: boolean;
  paragraphId: string | null;
  renderSourceText: string;
  layoutKind: NodeTextLayoutKind;
  region: Extract<HitRegion, { shape: "rect" }>;
  popupAnchorBox?: SvgBounds;
  isForeachTemplateEdit: boolean;
  editMode: "default" | "inline-typo";
  /** True when the buffer is a Beamer edit scope spanning many paragraphs. */
  isScopeSession: boolean;
};

export type NodeAnchorOverlayState = {
  visibleAnchors: NodeAnchorTarget[];
  snappedAnchor: NodeAnchorTarget | null;
  anchorStateBySourceId?: ReadonlyMap<string, { disabled?: boolean }>;
  radiusScale?: number;
};

export type NodePositionLinkDisplay = {
  key: string;
  from: WorldPoint;
  to: WorldPoint;
  sourceId: string;
  targetSourceId?: string;
};

export type EditableTextTarget = {
  sourceId: string;
  sceneTextId: string;
  sourceSpan: Span;
  text: string;
  /**
   * Structure-free document spans inside the buffer (e.g. Beamer editable
   * runs). When present, only the range containing an edit is masked for
   * structural parsing; when absent the whole buffer is masked.
   */
  structuralMaskRanges?: readonly Span[];
  /**
   * Rendered paragraphs covered by the buffer, in flow order. Present on
   * Beamer scope targets; hit-testing and selection overlays resolve
   * against the paragraph containing the pointer or offset.
   */
  scopeParagraphs?: readonly ScopeParagraphRef[];
  /**
   * When the clicked region renders an atomic construct (macro output,
   * embedded tikzpicture, graphics), the session opens with this document
   * span selected instead of resolving a caret from the pointer.
   */
  atomicSelectionSpan?: Span;
  /** Complete paragraph source used by report-driven hit testing. */
  layoutSourceSpan?: Span;
  /** Complete paragraph text used by report-driven hit testing. */
  layoutSourceText?: string;
  renderSourceText: string;
  usesTex: boolean;
  paragraphId: string | null;
  layoutKind: NodeTextLayoutKind;
  style: Pick<
    SceneText["style"],
    "fontSize" | "fontStyle" | "fontWeight" | "fontFamily" | "textAlign"
  >;
  totalWidth: number;
  region: Extract<HitRegion, { shape: "rect" }>;
  popupAnchorBox?: SvgBounds;
  isForeachTemplateEdit?: boolean;
  editMode?: "default" | "inline-typo";
};

export type SnapDebugLogInput = {
  phase: string;
  note?: string;
  snapshotMatchesSource: boolean;
  dragKind: DragState["kind"] | null;
  context?: SnapContext | null;
  rawPoint?: WorldPoint | null;
  rawDelta?: WorldPoint | null;
  snappedPoint?: WorldPoint | null;
  snappedDelta?: WorldPoint | null;
  offset?: WorldPoint | null;
  lines?: readonly SnapLine[];
};

export type ApplyActionFeedback = {
  sourceChanged: boolean;
  newSource?: string;
};

export type SelectionBounds = {
  sourceId: string;
  bounds: SvgBounds;
};

export type SourceBoundsMap = ReadonlyMap<string, SvgBounds>;

export type ScopeHitBounds = {
  scopeId: string;
  bounds: WorldBounds;
};

export type SelectionBoxDisplay =
  | {
      key: string;
      sourceId: string;
      isAdornment: boolean;
      dashed?: boolean;
      kind: "axis-aligned";
      bounds: SvgBounds;
    }
  | {
      key: string;
      sourceId: string;
      isAdornment: boolean;
      dashed?: boolean;
      kind: "polygon";
      points: ReadonlyArray<SvgPoint>;
    };

export type AdornmentConnectorDisplay = {
  key: string;
  kind: "label" | "pin";
  from: SvgPoint;
  to: SvgPoint;
};

export type AdornmentHighlightBox = {
  key: string;
  bounds: SvgBounds;
};

export type HandleDisplay =
  | {
      key: string;
      point: SvgPoint;
      cursor: string;
      kind: "move-handle";
      handle: EditHandle;
    }
  | {
      key: string;
      point: SvgPoint;
      cursor: string;
      kind: "move-element";
      elementId: string;
    }
  | {
      key: string;
      point: SvgPoint;
      cursor: string;
      kind: "resize-element";
      elementId: string;
      role: ResizeRole;
      rotationDeg: number;
    }
  | {
      key: string;
      point: SvgPoint;
      anchor: SvgPoint;
      centerWorld: WorldPoint;
      centerPivotWorld: WorldPoint;
      cursor: string;
      kind: "rotate-element";
      elementId: string;
    };

export type OverlaySelectionState = {
  selectionBounds: SelectionBounds[];
  selectionBoundsBySource: ReadonlyMap<string, SvgBounds>;
  interactionBoundsSvgBySource: ReadonlyMap<string, SvgBounds>;
  selectedScopeHitBounds: ScopeHitBounds[];
  selectionBoxes: SelectionBoxDisplay[];
  selectedAdornmentConnectors: AdornmentConnectorDisplay[];
  adornmentHighlightBoxes: AdornmentHighlightBox[];
  marqueeBounds: SvgBounds | null;
  handleDisplays: HandleDisplay[];
  viewportWorldBounds: WorldBounds | null;
};

export type SceneSnapshot = { elements: SceneElement[] } | null;

export type SvgSnapshot = { viewBox: SvgViewBox } | null;

export type StatementList = readonly Statement[];
