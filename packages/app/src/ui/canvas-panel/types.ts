import type { AdornmentOwnerGeometry, Span, Statement } from "tikz-editor/ast/types";
import type { ComplexPathSegment } from "tikz-editor/edit/element-templates";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type { SelectionGeometry, SnapContext, SnapLine } from "tikz-editor/edit/snapping";
import type { EditHandle, NodeAnchorTarget, Point, SceneElement, SceneText } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/index";
import type { NodeTextLayoutKind } from "tikz-editor/text/types";

import type { CanvasTransform } from "../../store/types";
import type { ToolCreateMode } from "../tool-config";
import type { HitRegion } from "./hit-regions";
import type { ResizeFrame } from "./resize-frames";

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type GuideOrientation = "vertical" | "horizontal";

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

export type GridResizeSnapConfig = {
  anchorWorld: Point;
  stepX: number;
  stepY: number;
  transform: EditHandle["transform"];
};

export type DragTooltipRow = {
  label: string;
  value: string;
};

export type DragTooltipState = {
  kind: "resize" | "rotate" | "tool-create";
  anchor: {
    x: number;
    y: number;
  };
  rows: DragTooltipRow[];
};

export type PendingTouchViewport = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  additiveSelection: boolean;
  startTransform: CanvasTransform;
  timer: ReturnType<typeof setTimeout>;
};

export type DragState =
  | {
      kind: "element";
      pointerId: number;
      elementIds: string[];
      startWorld: Point;
      adornmentDragFromText?: boolean;
      lastAppliedTotalDelta: Point;
      adornmentDrag?: {
        ownerPoint: Point;
        ownerGeometry?: AdornmentOwnerGeometry;
        allowCenter: boolean;
        pointerOffsetFromReference: Point;
        textDrag?: {
          pointerOffsetFromCenter: Point;
          halfWidth: number;
          halfHeight: number;
        };
      };
      pathAttachedNodeDrag?: {
        nodeId: string;
        hostPathSourceId: string;
        pointerOffsetFromCenter: Point;
        initialCenter: Point;
        initialAnchorPoint: Point;
        initialAnchorOffset: Point;
        initialDistancePt: number;
        initialDirectionalAnchorPt: number;
        segment: NonNullable<EditHandle["pathAttachmentContext"]>["segment"];
        regime: NonNullable<EditHandle["pathAttachmentContext"]>["regime"];
        lastPreviewDelta?: Point;
        lastAppliedPlacementKey?: string;
      };
      snapContext: SnapContext | null;
      initialSelection: SelectionGeometry | null;
      selectionAnchorRatio: { x: number; y: number } | null;
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
      cursor: string;
      centerWorld: Point;
      startPointerAngleDeg: number;
      baseRotateDeg: number;
      lastAppliedRotateDeg: number;
      historyMergeKey: string;
    }
  | {
      kind: "handle";
      pointerId: number;
      handleId: string;
      sourceId: string;
      handleKind: EditHandle["kind"];
      cursor: string;
      lastKnownWorld: Point;
      snapContext: SnapContext | null;
      gridResizeSnap: GridResizeSnapConfig | null;
      historyMergeKey: string;
      activeEndpointAnchor: NodeAnchorTarget | null;
    }
  | {
      kind: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startTransform: CanvasTransform;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startWorld: Point;
      currentWorld: Point;
      additive: boolean;
      baseSelectedIds: string[];
    }
  | {
      kind: "tool-create";
      pointerId: number;
      toolMode: ToolCreateMode;
      startWorld: Point;
      startEndpointAnchor: NodeAnchorTarget | null;
      rawCurrentWorld: Point;
      currentWorld: Point;
      activeEndpointAnchor: NodeAnchorTarget | null;
      snapContext: SnapContext | null;
    }
  | {
      kind: "tool-bezier-bend";
      pointerId: number;
      startWorld: Point;
      endWorld: Point;
      rawCurrentWorld: Point;
      currentWorld: Point;
      snapContext: SnapContext | null;
    }
  | {
      kind: "tool-path-segment";
      pointerId: number;
      startWorld: Point;
      endWorld: Point;
      endEndpointAnchor: NodeAnchorTarget | null;
      startPointerWorld: Point;
      rawBendWorld: Point;
      bendWorld: Point;
      isBending: boolean;
      snapContext: SnapContext | null;
    }
  | {
      kind: "tool-freehand";
      pointerId: number;
      points: Point[];
      minSampleDistanceWorld: number;
    }
  ;

export type PendingAddedSelection = {
  beforeIds: Set<string>;
  preferredWorld: Point;
  preferredSourceId?: string;
};

export type PendingBezier = {
  startWorld: Point;
  endWorld: Point;
};

export type PathAppendTarget = {
  elementId: string;
  end: "start" | "end";
};

export type PathToolDraft = {
  startWorld: Point;
  segments: ComplexPathSegment[];
  appendTarget?: PathAppendTarget;
};

export type FreehandToolDraft = {
  points: Point[];
  minSampleDistanceWorld: number;
};

export type TextSelectionOverlay = {
  sourceId: string;
  selectionStart: number;
  selectionEnd: number;
  caret:
    | {
        left: number;
        top: number;
        height: number;
        centerX?: number;
        centerY?: number;
        rotationDeg?: number;
      }
    | null;
  rects: Array<{
    left: number;
    top: number;
    width: number;
    height: number;
    centerX?: number;
    centerY?: number;
    rotationDeg?: number;
  }>;
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
  paragraphId: string | null;
  renderSourceText: string;
  layoutKind: NodeTextLayoutKind;
  region: Extract<HitRegion, { shape: "rect" }>;
  popupAnchorBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type NodeAnchorOverlayState = {
  visibleAnchors: NodeAnchorTarget[];
  snappedAnchor: NodeAnchorTarget | null;
};

export type EditableTextTarget = {
  sourceId: string;
  sceneTextId: string;
  sourceSpan: Span;
  text: string;
  renderSourceText: string;
  paragraphId: string | null;
  layoutKind: NodeTextLayoutKind;
  style: SceneText["style"];
  totalWidth: number;
  region: Extract<HitRegion, { shape: "rect" }>;
  popupAnchorBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type SnapDebugLogInput = {
  phase: string;
  note?: string;
  snapshotMatchesSource: boolean;
  dragKind: DragState["kind"] | null;
  context?: SnapContext | null;
  rawPoint?: Point | null;
  rawDelta?: Point | null;
  snappedPoint?: Point | null;
  snappedDelta?: Point | null;
  offset?: Point | null;
  lines?: readonly SnapLine[];
};

export type ApplyActionFeedback = {
  sourceChanged: boolean;
};

export type SelectionBounds = {
  sourceId: string;
  bounds: Bounds;
};

export type SourceBoundsMap = ReadonlyMap<string, Bounds>;

export type SceneSnapshot = { elements: SceneElement[] } | null;

export type SvgSnapshot = { viewBox: SvgViewBox } | null;

export type StatementList = readonly Statement[];
