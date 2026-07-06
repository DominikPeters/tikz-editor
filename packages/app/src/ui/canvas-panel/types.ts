import type { AdornmentOwnerGeometry, Span, Statement } from "tikz-editor/ast/types";
import type { ComplexPathSegment } from "tikz-editor/edit/element-templates";
import type { EditAction, ResizeRole } from "tikz-editor/edit/actions";
import type { EditParseOptions } from "tikz-editor/edit/parse-options";
import type { SelectionGeometry, SnapContext, SnapLine } from "tikz-editor/edit/snapping";
import type { EditHandle, NodeAnchorTarget, SceneElement, SceneText } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/index";
import type { NodeTextLayoutKind } from "tikz-editor/text/types";
import type { FrameTransform } from "tikz-editor/coords/index";
import type { Dispatch, SetStateAction } from "react";

import type { SessionSnapshot } from "../../compute";
import type { CanvasTransform, EditorAction } from "../../store/types";
import type { CanvasContextMenuTarget } from "../../context-menu";
import type { ToolCreateMode } from "../tool-config";
import type { ClientPoint, SvgBounds, SvgPoint, ViewportBounds, ViewportPoint, WorldBounds, WorldPoint, WorldVector } from "../coords/types";
import type { HitRegion } from "./hit-regions";
import type { ResizeFrame } from "./resize-frames";

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
  sourceOverride?: string
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
      pointerId: number;
      elementIds: string[];
      startWorld: WorldPoint;
      adornmentDragFromText?: boolean;
      lastAppliedTotalDelta: WorldVector;
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
      pointerId: number;
      elementId: string;
      role: ResizeRole;
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
      historyMergeKey: string;
    }
  | {
      kind: "handle";
      pointerId: number;
      handleId: string;
      sourceId: string;
      handleKind: EditHandle["kind"];
      cursor: string;
      lastKnownWorld: WorldPoint;
      snapContext: SnapContext | null;
      gridResizeSnap: GridResizeSnapConfig | null;
      historyMergeKey: string;
      activeEndpointAnchor: NodeAnchorTarget | null;
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
    }
  | {
      kind: "tool-bezier-bend";
      pointerId: number;
      startWorld: WorldPoint;
      endWorld: WorldPoint;
      rawCurrentWorld: WorldPoint;
      currentWorld: WorldPoint;
      snapContext: SnapContext | null;
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

export type TextEditingSession = {
  sourceId: string;
  sceneTextId: string;
  sourceSpan: Span;
  workingSource: string;
  text: string;
  selectionStart: number;
  selectionEnd: number;
  historyMergeKey: string;
  usesMathJax: boolean;
  paragraphId: string | null;
  renderSourceText: string;
  layoutKind: NodeTextLayoutKind;
  region: Extract<HitRegion, { shape: "rect" }>;
  popupAnchorBox?: SvgBounds;
  isForeachTemplateEdit: boolean;
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
  renderSourceText: string;
  usesMathJax: boolean;
  paragraphId: string | null;
  layoutKind: NodeTextLayoutKind;
  style: SceneText["style"];
  totalWidth: number;
  region: Extract<HitRegion, { shape: "rect" }>;
  popupAnchorBox?: SvgBounds;
  isForeachTemplateEdit?: boolean;
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
