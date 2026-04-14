import type { AdornmentOwnerGeometry, CoordinateForm, Span } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import type { NodeTextEngine, NodeTextRenderInfo } from "../text/types.js";
import type { MacroOriginFrame } from "../macros/index.js";
import type { StyleChainEntry } from "./style-chain.js";
import type { PlacementSegment } from "./path/types.js";

export const SHADOW_INHERIT_STROKE = "__tikz-shadow-inherit-stroke__";
export const SHADOW_INHERIT_FILL = "__tikz-shadow-inherit-fill__";

export type Point = {
  x: number;
  y: number;
};

export type NodeAnchorTarget = {
  nodeName: string;
  anchor: string;
  world: Point;
  tier: "basic" | "special";
};

export type ArrowTipKind =
  | "to"
  | "cm-rightarrow"
  | "stealth"
  | "latex"
  | "triangle"
  | "bar"
  | "hooks"
  | "implies"
  | "straight-barb"
  | "arc-barb"
  | "tee-barb"
  | "kite"
  | "square"
  | "circle"
  | "rays"
  | "round-cap"
  | "butt-cap"
  | "triangle-cap";

export type ArrowTip = {
  kind: ArrowTipKind;
  open: boolean;
  round: boolean;
  reversed: boolean;
  bend: boolean;
  afterLineEnd: boolean;
  color: string | null;
  fill: string | null;
  length: number;
  width: number;
  inset: number | null;
  sep: number;
  lineWidth: number | null;
  arc: number | null;
  rayCount: number | null;
};

export type ArrowMarker = {
  tips: ArrowTip[];
};

export type TipsMode = "true" | "proper" | "on draw" | "on proper draw" | "never";

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

export type SceneFigure = {
  kind: "SceneFigure";
  span: Span;
  requiredTikzLibraries: readonly string[];
  elements: SceneElement[];
  bounds?: Bounds;
  hasStatefulGraphicsState?: boolean;
};

export type SceneAdornment = {
  targetId: string;
  kind: "label" | "pin";
  ownerSourceId: string;
  ownerNodeId: string;
  adornmentIndex: number;
  optionSpan: Span;
  valueSpan: Span;
  textSpan: Span;
  angleRaw: string;
  angleSpan?: Span;
  distancePt: number;
  defaultDistancePt: number;
  distanceExplicit: boolean;
  ownerPoint?: Point;
  ownerGeometry?: AdornmentOwnerGeometry;
};

export type PathAttachedNodePlacementRegime =
  | {
      kind: "neutral";
    }
  | {
      kind: "explicit-direction";
      direction: string;
      family: "cardinal-diagonal" | "base" | "mid";
    }
  | {
      kind: "auto-side";
      side: "left" | "right";
      swap: boolean;
      autoExplicit: boolean;
      swapExplicit: boolean;
    };

export type ScenePathAttachment = {
  hostPathSourceId: string;
  nodeSourceId: string;
  segment: PlacementSegment;
  pos: number;
  regime: PathAttachedNodePlacementRegime;
  sloped: boolean;
};

export type SceneElement = ScenePath | SceneCircle | SceneEllipse | SceneText;

export type SourceRef = {
  sourceId: string;
  sourceSpan: Span;
  sourceFingerprint: string;
};

export type MatrixCellInfo = {
  matrixSourceId: string;
  cellSourceId: string;
  row: number;
  column: number;
  textMode: "text" | "math";
  textSpan: Span;
  cellSpan: Span;
};

export type TreeChildInfo = {
  treeRootSourceId: string;
  parentSourceId: string;
  childOperationId: string;
  childSourceId: string;
  childIndex: number;
  level: number;
  childOperationSpan: Span;
  bodySpan?: Span;
  optionsSpan?: Span;
};

export type ScenePathCommand =
  | { kind: "M"; to: Point }
  | { kind: "L"; to: Point }
  | { kind: "C"; c1: Point; c2: Point; to: Point }
  | { kind: "A"; rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: Point }
  | { kind: "Z" };

export type SceneClipPath = {
  id: string;
  sourceRef: SourceRef;
  commands: ScenePathCommand[];
  fillRule: "nonzero" | "evenodd";
};

export type ScenePathShapeHint = "rectangle" | "circle" | "ellipse";

export type ScenePath = {
  kind: "Path";
  id: string;
  runtimeId: string;
  sourceRef: SourceRef;
  matrixCell?: MatrixCellInfo;
  treeChild?: TreeChildInfo;
  adornment?: SceneAdornment;
  pathAttachment?: ScenePathAttachment;
  origin?: SceneElementOrigin;
  shapeHint?: ScenePathShapeHint | null;
  undecoratedCommands?: ScenePathCommand[];
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  clipChain?: SceneClipPath[];
  commands: ScenePathCommand[];
  transform?: Matrix2D;
};

export type SceneCircle = {
  kind: "Circle";
  id: string;
  runtimeId: string;
  sourceRef: SourceRef;
  matrixCell?: MatrixCellInfo;
  treeChild?: TreeChildInfo;
  adornment?: SceneAdornment;
  pathAttachment?: ScenePathAttachment;
  origin?: SceneElementOrigin;
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  clipChain?: SceneClipPath[];
  center: Point;
  radius: number;
  transform?: Matrix2D;
};

export type SceneEllipse = {
  kind: "Ellipse";
  id: string;
  runtimeId: string;
  sourceRef: SourceRef;
  matrixCell?: MatrixCellInfo;
  treeChild?: TreeChildInfo;
  adornment?: SceneAdornment;
  pathAttachment?: ScenePathAttachment;
  origin?: SceneElementOrigin;
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  clipChain?: SceneClipPath[];
  center: Point;
  rx: number;
  ry: number;
  rotation?: number;
  transform?: Matrix2D;
};

export type SceneText = {
  kind: "Text";
  id: string;
  runtimeId: string;
  sourceRef: SourceRef;
  matrixCell?: MatrixCellInfo;
  treeChild?: TreeChildInfo;
  adornment?: SceneAdornment;
  pathAttachment?: ScenePathAttachment;
  textSourceSpan?: Span;
  textHasFixedWidth?: boolean;
  origin?: SceneElementOrigin;
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  clipChain?: SceneClipPath[];
  position: Point;
  text: string;
  textBlockWidth?: number;
  textBlockHeight?: number;
  nodeVisualWidth?: number;
  nodeVisualHeight?: number;
  textRenderInfo?: NodeTextRenderInfo;
  rotation?: number;
  transform?: Matrix2D;
};

export type ForeachOriginFrame = {
  loopId: string;
  loopSpan: Span;
  iterationIndex: number;
  bindings: Record<string, string>;
};

export type SceneElementOrigin = {
  foreachStack: ForeachOriginFrame[];
  foreachTemplateLocalTargetId?: string;
  macroStack?: MacroOriginFrame[];
};

export type ShadowFadeKind = "none" | "circle-fuzzy-edge-15";

export type ShadowPaintStyle = {
  stroke: string | null;
  fill: string | null;
  fillRule: "nonzero" | "evenodd";
  doubleStroke: boolean;
  doubleDistance: number;
  lineWidth: number;
  dashArray: number[] | null;
  dashOffset: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  opacity: number;
  strokeOpacity: number;
  fillOpacity: number;
  shadeEnabled: boolean;
  shading: string;
  shadingAngle: number;
  axisTopColor: string;
  axisMiddleColor: string;
  axisBottomColor: string;
  radialInnerColor: string;
  radialOuterColor: string;
  ballColor: string;
  bilinearLowerLeft: string;
  bilinearLowerRight: string;
  bilinearUpperLeft: string;
  bilinearUpperRight: string;
};

export type ShadowLayer = {
  scale: number;
  xshift: number;
  yshift: number;
  fade: ShadowFadeKind;
  style: ShadowPaintStyle;
};

export type DecorationStyle = {
  enabled: boolean;
  name: string | null;
  raise: number;
  mirror: boolean;
  transformRaw: string | null;
  pre: string;
  preLength: number;
  post: string;
  postLength: number;
  params: Record<string, string>;
};

export type LegacyPatternName =
  | "horizontal lines"
  | "vertical lines"
  | "north east lines"
  | "north west lines"
  | "grid"
  | "crosshatch"
  | "dots"
  | "crosshatch dots"
  | "fivepointed stars"
  | "sixpointed stars"
  | "bricks"
  | "checkerboard"
  | "checkerboard light gray"
  | "horizontal lines light gray"
  | "horizontal lines gray"
  | "horizontal lines dark gray"
  | "horizontal lines light blue"
  | "horizontal lines dark blue"
  | "crosshatch dots gray"
  | "crosshatch dots light steel blue";

export type ResolvedPattern =
  | {
      kind: "legacy";
      name: LegacyPatternName;
      inherentlyColored: boolean;
    }
  | {
      kind: "meta-lines";
      distance: number;
      angle: number;
      xshift: number;
      yshift: number;
      lineWidth: number;
    }
  | {
      kind: "meta-hatch";
      distance: number;
      angle: number;
      xshift: number;
      yshift: number;
      lineWidth: number;
    }
  | {
      kind: "meta-dots";
      distance: number;
      angle: number;
      xshift: number;
      yshift: number;
      radius: number;
    }
  | {
      kind: "meta-stars";
      distance: number;
      angle: number;
      xshift: number;
      yshift: number;
      radius: number;
      points: number;
    };

export type ResolvedStyle = {
  stroke: string | null;
  fill: string | null;
  fillPattern: ResolvedPattern | null;
  patternColor: string;
  fillRule: "nonzero" | "evenodd";
  clip: boolean;
  useAsBoundingBox: boolean;
  textColor: string | null;
  textOpacity: number;
  fontSize: number;
  fontStyle: "normal" | "italic";
  fontWeight: "normal" | "bold";
  fontFamily: "serif" | "sans" | "monospace";
  doubleStroke: boolean;
  doubleDistance: number;
  textAlign: "left" | "flush left" | "right" | "flush right" | "center" | "flush center" | "justify" | "none";
  // Whether draw mode was explicitly enabled via options (for example `draw`).
  drawExplicit: boolean;
  radius: number | null;
  xRadius: number | null;
  yRadius: number | null;
  roundedCorners: number | null;
  lineWidth: number;
  dashArray: number[] | null;
  dashOffset: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  markerStart: ArrowMarker | null;
  markerEnd: ArrowMarker | null;
  arrowShorthandStart: ArrowMarker;
  arrowShorthandEnd: ArrowMarker;
  tipsMode: TipsMode;
  opacity: number;
  strokeOpacity: number;
  fillOpacity: number;
  shadeEnabled: boolean;
  shading: string;
  shadingAngle: number;
  axisTopColor: string;
  axisMiddleColor: string;
  axisBottomColor: string;
  radialInnerColor: string;
  radialOuterColor: string;
  ballColor: string;
  bilinearLowerLeft: string;
  bilinearLowerRight: string;
  bilinearUpperLeft: string;
  bilinearUpperRight: string;
  shadowScale: number;
  shadowXShift: number;
  shadowYShift: number;
  shadowFade: ShadowFadeKind;
  everyShadowStyles: OptionListAst[];
  shadowLayers: ShadowLayer[];
  decoration: DecorationStyle;
  decorationPreActions: DecorationStyle[];
  decorationPostActions: DecorationStyle[];
};

export type FeatureUsageState = "unused" | "used-supported" | "used-unsupported";

export type FeatureUsage = Record<string, FeatureUsageState>;

export type EvaluateOptions = {
  defaultLengthUnit?: "cm" | "pt";
  maxForeachExpansions?: number;
  textEngine?: NodeTextEngine | null;
};

export type { CoordinateForm };

export type CurveEditHandleData =
  | {
      kind: "to-angle";
      operationItemId: string;
      role: "out" | "in";
      startWorld: Point;
      endWorld: Point;
      relative: boolean;
      baseHeading: number;
    }
  | {
      kind: "to-bend";
      operationItemId: string;
      startWorld: Point;
      endWorld: Point;
      baseHeading: number;
    };

export type EditHandleInsertion = {
  kind: "node-inline-at";
};

export type EditHandlePathAttachmentContext = {
  hostPathSourceId: string;
  segment: PlacementSegment;
  pos: number;
  regime: PathAttachedNodePlacementRegime;
  sloped: boolean;
};

export type EditHandle = {
  id: string;
  runtimeId: string;
  sourceRef: SourceRef;
  kind: "node-position" | "path-point" | "path-control" | "path-bend";
  world: Point;
  local?: Point;
  transform: Matrix2D;
  sourceText: string;
  coordinateForm: CoordinateForm;
  relativePrefix?: "+" | "++";
  relativeBaseWorld?: Point;
  rewriteMode: "direct" | "delta" | "positioning" | "unsupported";
  rewriteTargetHandleId?: string;
  pathAttachmentContext?: EditHandlePathAttachmentContext;
  curveEdit?: CurveEditHandleData;
  insertion?: EditHandleInsertion;
  positioningContext?: {
    direction: string;
    targetNodeName: string;
    targetCenter: Point;
    currentCenter: Point;
    legacyOf: boolean;
    anchorOffsetsByDirection?: Record<string, { targetAnchor: Point; currentAnchor: Point }>;
    /** Anchor half-dimensions for the target node (A), used for anchor compensation */
    targetAnchorHW: number;
    targetAnchorHH: number;
    /** Anchor half-dimensions for the current node (B), used for anchor compensation */
    currentAnchorHW: number;
    currentAnchorHH: number;
  };
};
