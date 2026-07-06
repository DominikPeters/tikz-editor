import { px } from "../../coords/scalars.js";
import type { Px } from "../../coords/scalars.js";
import type { WorldBounds, WorldPoint } from "../../coords/points.js";
import type { SceneElement } from "../../semantic/types.js";

export type Axis = "x" | "y";

export type SnapSettings = {
  thresholdPx: Px;
  grid: {
    enabled: boolean;
    minorTargetPx: Px;
  };
  points: {
    enabled: boolean;
  };
  gaps: {
    enabled: boolean;
    maxPairsPerAxis: number;
  };
  bypassWithCtrlOrMeta: boolean;
  viewportPaddingPx: Px;
};

export const GRID_MINOR_TARGET_PX = 22;

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  thresholdPx: px(8),
  grid: {
    enabled: true,
    minorTargetPx: px(GRID_MINOR_TARGET_PX)
  },
  points: {
    enabled: true
  },
  gaps: {
    enabled: true,
    maxPairsPerAxis: 100000
  },
  bypassWithCtrlOrMeta: true,
  viewportPaddingPx: px(12)
};

export type SnapSettingsPatch = {
  thresholdPx?: Px;
  grid?: Partial<SnapSettings["grid"]>;
  points?: Partial<SnapSettings["points"]>;
  gaps?: Partial<SnapSettings["gaps"]>;
  bypassWithCtrlOrMeta?: boolean;
  viewportPaddingPx?: Px;
};

export type SnapModifiers = {
  ctrlOrMeta: boolean;
};

export type SnapPointRole = "corner" | "center";

export type SnapPoint = WorldPoint & {
  sourceId: string;
  role: SnapPointRole;
};

/**
 * A selection-side snap point. Points with a role only match reference points
 * of the same role (corners align with corners, centers with centers);
 * role-less points (e.g. the free pointer during tool use) match anything.
 */
export type SelectionSnapPoint = WorldPoint & {
  role?: SnapPointRole;
};

export type SnapBounds = WorldBounds & {
  sourceId: string;
};

export type Gap = {
  startBounds: SnapBounds;
  endBounds: SnapBounds;
  startSide: [WorldPoint, WorldPoint];
  endSide: [WorldPoint, WorldPoint];
  overlap: [number, number];
  length: number;
};

export type SnapGuides = {
  x: number[];
  y: number[];
};

export type SnapGuideInput = {
  x?: readonly number[];
  y?: readonly number[];
};

export type SnapContext = {
  zoom: number;
  viewportWorld: WorldBounds | null;
  selectedSourceIds: string[];
  guides: SnapGuides;
  referencePoints: SnapPoint[];
  referenceBounds: SnapBounds[];
  visibleGaps: {
    horizontal: Gap[];
    vertical: Gap[];
  };
  settings: SnapSettings;
};

export type SnapLine =
  | {
      /**
       * One alignment guide per snapped coordinate: `points` holds every
       * aligned point (selection and references) sorted along the line, so
       * renderers can draw a single full span. `role` styles center
       * alignments differently from edge/corner alignments. `sourceIds` are
       * the distinct reference elements on the line, for labelling.
       */
      type: "points";
      axis: Axis;
      role?: SnapPointRole;
      points: WorldPoint[];
      sourceIds?: string[];
    }
  | {
      type: "gap";
      direction: "horizontal" | "vertical";
      gapKind: "center" | "equal";
      segments: Array<[WorldPoint, WorldPoint]>;
    }
  | { type: "pointer"; axis: Axis; from: WorldPoint; to: WorldPoint; sourceIds?: string[] };

export type SnapResult = {
  offset: WorldPoint;
  snappedPoint?: WorldPoint;
  snappedDelta?: WorldPoint;
  lines: SnapLine[];
};

export type SelectionGeometry = {
  bounds: WorldBounds;
  snapPoints: SelectionSnapPoint[];
};

export type BuildSnapContextInput = {
  sceneElements: SceneElement[];
  selectedSourceIds: readonly string[];
  zoom: number;
  viewportWorld?: WorldBounds | null;
  guides?: SnapGuideInput;
  settings?: SnapSettingsPatch;
};

export type SnapSelectionTranslationInput = {
  context: SnapContext;
  selection: SelectionGeometry;
  rawDelta: WorldPoint;
  modifiers?: SnapModifiers;
  settings?: SnapSettingsPatch;
  enabledAxis?: Axis | null;
};

export type SnapHandlePositionInput = {
  context: SnapContext;
  point: WorldPoint;
  sourceId?: string;
  allowSelfSnap?: boolean;
  modifiers?: SnapModifiers;
  settings?: SnapSettingsPatch;
};

export type SnapKeyboardNudgeInput = {
  anchor: WorldPoint | null;
  axis: Axis;
  direction: -1 | 1;
  step: number;
};

export type SnapToolPointerKind = "node" | "line-end" | "rect-corner" | "circle-edge";

export type SnapToolPointerInput = {
  context: SnapContext;
  pointer: WorldPoint;
  kind: SnapToolPointerKind;
  anchor?: WorldPoint;
  modifiers?: SnapModifiers;
  settings?: SnapSettingsPatch;
};

export type PointSnapCandidate = {
  kind: "point" | "grid" | "guide";
  axis: Axis;
  from: WorldPoint;
  to: WorldPoint;
  offset: number;
  key: number;
  role?: SnapPointRole;
  sourceId?: string;
};

export type GapSnapDirection =
  | "center_horizontal"
  | "center_vertical"
  | "side_left"
  | "side_right"
  | "side_top"
  | "side_bottom";

export type GapSnapCandidate = {
  kind: "gap";
  axis: Axis;
  direction: GapSnapDirection;
  gap: Gap;
  offset: number;
};

export type AxisSnapCandidate = PointSnapCandidate | GapSnapCandidate;

export type AxisSnapBuckets = {
  x: AxisSnapCandidate[];
  y: AxisSnapCandidate[];
};

export type AxisMinOffset = {
  x: number;
  y: number;
};
