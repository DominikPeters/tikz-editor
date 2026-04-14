import type { StyleLevel } from "./actions.js";
import { TREE_CHILD_NODE_READONLY_KEYS, TREE_ROOT_LAYOUT_KEYS } from "./tree-editing.js";
import {
  makeForeachTemplateTargetId,
  resolvePropertyTarget,
  type PropertyTargetResolution
} from "./property-target.js";
import type { EditParseOptions } from "./parse-options.js";
import {
  collectInspectorColorAliases,
  colorOptionsForValue,
  normalizeInspectorColorValue,
  resolveColorSyntaxValue
} from "./inspector/color-syntax.js";
import { normalizeOptionKey } from "./option-key.js";
import {
  clampRoundedCornersRadius,
  computePathRoundedCornersMax,
  normalizeRoundedCornersMax,
  pathHasRoundableCorner
} from "./inspector/rounded-corners.js";
import { parseTikz } from "../parser/index.js";
import type { PathItem, PathStatement, Statement } from "../ast/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import {
  findTopLevelCharacter,
  parseFontStyle,
  parseStyleValueAsOptionList,
  stripEnclosingBraces
} from "../semantic/style/option-utils.js";
import { parseCoordinateLike, parseLength } from "../semantic/coords/parse-length.js";
import { DEFAULT_TEXT_FONT_SIZE } from "../semantic/style/constants.js";
import { normalizeColor } from "../semantic/style/colors.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../semantic/types.js";
import { CM_PER_PT, formatNumber } from "./format.js";
import {
  ARROW_DEFAULT_CLEAR_KEYS,
  ARROW_OPTION_KEY,
  ARROW_TIP_OPTIONS,
  AXIS_SHADING_CONFLICT_CLEAR_KEYS,
  BALL_SHADING_CONFLICT_CLEAR_KEYS,
  CURATED_NODE_SHAPE_SET,
  DASH_PATTERN_EPSILON,
  DASH_STYLE_OPTIONS,
  DASH_STYLE_PRESET_CLEAR_KEYS,
  DEFAULT_META_PATTERN_DISTANCE,
  DEFAULT_META_PATTERN_RADIUS,
  DEFAULT_META_PATTERN_STARS_DISTANCE,
  DEFAULT_META_PATTERN_STARS_RADIUS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_CLEAR_KEYS,
  FILL_PATTERN_OPTIONS,
  FILL_PATTERN_PRESET_BY_LOWER,
  FILL_SHADING_CLEAR_KEYS,
  FILL_SHADING_OPTIONS,
  FILL_STYLE_CUSTOM_NOTE,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS,
  LINE_WIDTH_PRESETS,
  META_FILL_PATTERN_PRESET_BY_KIND,
  META_FILL_PATTERN_PRESET_BY_LOWER,
  META_FILL_PATTERN_PRESETS,
  NODE_FONT_CUSTOM_NOTE,
  NODE_FONT_FAMILY_COMMAND,
  NODE_FONT_KEYS,
  NODE_FONT_PRESET_BY_ID,
  NODE_FONT_SIZE_EPSILON,
  NODE_FONT_SIZE_PRESETS,
  NODE_FONT_STYLE_COMMAND,
  NODE_FONT_WEIGHT_COMMAND,
  NODE_INNER_SEP_CLEAR_KEYS,
  NODE_INNER_SEP_CONFLICT_NOTE,
  NODE_INNER_SEP_DEFAULT,
  NODE_MINIMUM_DIMENSION_CLEAR_KEYS,
  NODE_MINIMUM_DIMENSION_CONFLICT_NOTE,
  NODE_MINIMUM_DIMENSION_DEFAULT,
  NODE_SHAPE_CUSTOM_NOTE,
  NODE_SHAPE_KEY,
  NODE_SHAPE_KNOWN_KEYS,
  NODE_SHAPE_KNOWN_SET,
  NODE_SHAPE_OPTIONS,
  PATH_MORPHING_DECORATION_CLEAR_KEYS,
  PATH_MORPHING_DECORATION_OPTIONS,
  PATH_MORPHING_DECORATION_SUBOPTIONS_BY_PRESET,
  PATH_MORPHING_DECORATION_SUBOPTION_SPECS,
  RADIAL_SHADING_CONFLICT_CLEAR_KEYS,
  ROUNDED_CORNERS_CLEAR_KEYS,
  ROUNDED_CORNERS_DEFAULT_RADIUS,
  SHADOW_ALL_KEYS,
  SHADOW_PRESET_DEFAULTS,
  SHADOW_PRESET_OPTIONS,
  SHADOW_PRESET_TIKZ_KEY,
  SHADING_ACTIVATION_KEYS
} from "./inspector/presets.js";
import {
  ADORNMENT_ANGLE_PROPERTY_KEY,
  ADORNMENT_DISTANCE_PROPERTY_KEY,
  ADORNMENT_TEXT_PROPERTY_KEY,
  PIN_EDGE_DRAW_PROPERTY_KEY,
  PIN_EDGE_LINE_WIDTH_PROPERTY_KEY
} from "./adornment-keys.js";
import {
  PATH_ATTACHED_NODE_POSITION_VALUE_KEY,
  PATH_ATTACHED_NODE_SIDE_KEY
} from "./path-attached-node-keys.js";
import { PATH_POSITION_PRESETS, resolvePathPositionPreset } from "../semantic/path/path-attached.js";
import type {
  ArrowTipPresetId,
  ArrowTipPresetOption,
  ArrowTipSide,
  DashStylePresetId,
  DashStylePresetOption,
  FillModePresetId,
  FillModePresetOption,
  FillPatternMetaFamilyId,
  FillPatternMetaOptionKey,
  FillPatternMetaValues,
  FillPatternPresetId,
  FillPatternPresetOption,
  FillShadingPresetId,
  FillShadingPresetOption,
  LineCapPresetId,
  LineCapPresetOption,
  LineJoinPresetId,
  LineJoinPresetOption,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeFontSizePresetOption,
  NodeShapePresetId,
  NodeShapePresetOption,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationPresetOption,
  PathMorphingDecorationSuboptionKey,
  PathMorphingDecorationSuboptionSpec,
  ShadowPresetId,
  ShadowPresetOption
} from "./inspector/presets.js";
import type {
  ArrowMarker,
  ArrowTipKind,
  EditHandle,
  ResolvedStyle,
  ResolvedPattern,
  SceneElement,
  ScenePathCommand
} from "../semantic/types.js";
import { parseBooleanishNormalized } from "../utils/booleanish.js";
import {
  resolveNodeShapeGeometryParams,
  type SignalDirection
} from "../semantic/nodes/shape-geometry.js";
import type { StyleChainEntry } from "../semantic/style-chain.js";
export { TIKZPICTURE_GLOBAL_TARGET_ID } from "./property-target.js";
export type {
  ArrowTipPresetId,
  ArrowTipPresetOption,
  ArrowTipSide,
  DashStylePresetId,
  DashStylePresetOption,
  FillModePresetId,
  FillModePresetOption,
  FillPatternMetaFamilyId,
  FillPatternMetaOptionKey,
  FillPatternMetaValues,
  FillPatternPresetId,
  FillPatternPresetOption,
  FillShadingPresetId,
  FillShadingPresetOption,
  LineCapPresetId,
  LineCapPresetOption,
  LineJoinPresetId,
  LineJoinPresetOption,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeFontSizePresetOption,
  NodeShapePresetId,
  NodeShapePresetOption,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationPresetOption,
  ShadowPresetId,
  ShadowPresetOption
} from "./inspector/presets.js";
export {
  DASH_STYLE_OPTIONS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_OPTIONS,
  FILL_SHADING_OPTIONS,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS,
  LINE_WIDTH_PRESETS,
  NODE_INNER_SEP_DEFAULT,
  NODE_SHAPE_OPTIONS,
  ROUNDED_CORNERS_DEFAULT_RADIUS,
  SHADOW_PRESET_DEFAULTS,
  SHADOW_PRESET_OPTIONS
} from "./inspector/presets.js";

type InspectorTargetResolver = (targetId: string) => PropertyTargetResolution;

function createInspectorTargetResolver(
  source: string,
  parseOptions: EditParseOptions = {}
): InspectorTargetResolver {
  const cache = new Map<string, PropertyTargetResolution>();
  return (targetId: string) => {
    const cached = cache.get(targetId);
    if (cached) {
      return cached;
    }
    const resolved = resolvePropertyTarget(source, targetId, parseOptions);
    cache.set(targetId, resolved);
    return resolved;
  };
}

export type ArrowTipWriteContext = {
  startRaw: string;
  endRaw: string;
  clearKeys: string[];
};

export type ArrowTipWriteTarget = SetPropertyWriteTarget & {
  arrowContext: ArrowTipWriteContext;
};

export type ArrowTipSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type DashStyleSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type LineCapSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type LineJoinSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type PathMorphingDecorationSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type RoundedCornersSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type FillModeMutationContext = {
  fillColor: string | null;
  patternColor: string | null;
  shading: FillShadingPresetId;
  pattern: FillPatternPresetId;
};

export type FillModeSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type FillShadingSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type FillPatternSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type FillPatternOptionMutationContext = {
  family: FillPatternMetaFamilyId;
  values: FillPatternMetaValues;
};

export type FillPatternOptionSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeShapeSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeInnerSepSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeMinimumDimensionKey = "minimum width" | "minimum height";

export type NodeMinimumDimensionsMutationContext = {
  minimumWidth: number;
  minimumHeight: number;
};

export type NodeMinimumDimensionSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeFontMutationContext = {
  key: "font" | "node font";
  clearKeys: string[];
  fallbackCustomSizePt: number;
};

export type NodeFontSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type TransformInspectorKey = "xshift" | "yshift" | "xscale" | "yscale" | "rotate";

export type TransformInspectorValues = {
  xshift: number;
  yshift: number;
  xscale: number;
  yscale: number;
  rotate: number;
};

export type TransformInspectorPresence = {
  shift: boolean;
  scale: boolean;
  xshift: boolean;
  yshift: boolean;
  xscale: boolean;
  yscale: boolean;
  rotate: boolean;
};

export type TransformInspectorMutationContext = {
  values: TransformInspectorValues;
  presence?: TransformInspectorPresence;
};

export type TransformSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type InspectorSnapshot = {
  source: string;
  editHandles?: EditHandle[];
  parseOptions?: EditParseOptions;
};

export type ShadowMutationContext = {
  preset: ShadowPresetId;
  xshiftPt: number;
  yshiftPt: number;
  scale: number;
  opacity: number;
  color: string | null;
};

export type ShadowSetPropertyMutation = {
  key: string;
  value: string;
  clearKeys: string[];
};

export type NodeTextAlignInspectorValue = "unset" | "left" | "center" | "right" | "justify";

export type SetPropertyWriteTarget = {
  mode: "setProperty";
  elementId: string;
  level: StyleLevel;
  key: string;
  transformContext?: {
    key: TransformInspectorKey;
    values: TransformInspectorValues;
    presence?: TransformInspectorPresence;
  };
  shadowContext?: ShadowMutationContext;
  writable: boolean;
  reason?: string;
};

export type InspectorProperty =
  | {
      kind: "text";
      id: string;
      label: string;
      value: string;
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "enum";
      id: string;
      label: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "boolean";
      id: string;
      label: string;
      value: boolean;
      trueValue?: string;
      falseValue?: string;
      clearKeys?: string[];
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "number";
      id: string;
      label: string;
      value: number;
      step: number;
      min?: number;
      max?: number;
      unit?: string;
      clearKeys?: string[];
      write?: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "length";
      id: string;
      label: string;
      value: number;
      step: number;
      unit: "pt";
      clearKeys?: string[];
      write: SetPropertyWriteTarget;
      note?: string;
      minimumDimensionsContext?: NodeMinimumDimensionsMutationContext;
      readOnlyReason?: string;
    }
  | {
      kind: "slider";
      id: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      ticks?: ReadonlyArray<{ value: number; label?: string }>;
      displayLabel?: string;
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "optionalLength";
      id: string;
      label: string;
      value: number | null;
      step: number;
      unit: "pt";
      clearKeys?: string[];
      write: SetPropertyWriteTarget;
      note?: string;
      readOnlyReason?: string;
    }
  | {
      kind: "color";
      id: string;
      label: string;
      value: string | null;
      syntaxValue: string | null;
      options: string[];
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineWidth";
      id: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      presetLabel: string | null;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "dashStyle";
      id: string;
      label: string;
      value: DashStylePresetId;
      options: DashStylePresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineCap";
      id: string;
      label: string;
      value: LineCapPresetId;
      options: LineCapPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineJoin";
      id: string;
      label: string;
      value: LineJoinPresetId;
      options: LineJoinPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "pathMorphingDecoration";
      id: string;
      label: string;
      value: PathMorphingDecorationPresetId;
      options: PathMorphingDecorationPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "fillMode";
      id: string;
      label: string;
      value: FillModePresetId;
      options: FillModePresetOption[];
      context: FillModeMutationContext;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "fillShading";
      id: string;
      label: string;
      value: FillShadingPresetId;
      options: FillShadingPresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "fillPattern";
      id: string;
      label: string;
      value: FillPatternPresetId;
      options: FillPatternPresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "nodeTextAlign";
      id: string;
      label: string;
      value: NodeTextAlignInspectorValue;
      write: SetPropertyWriteTarget;
      clearKeys?: string[];
      readOnlyReason?: string;
    }
  | {
      kind: "nodeShape";
      id: string;
      label: string;
      value: NodeShapePresetId;
      options: NodeShapePresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "nodeFont";
      id: string;
      label: string;
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
      sizeOptions: NodeFontSizePresetOption[];
      context: NodeFontMutationContext;
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "fillPatternOption";
      id: string;
      label: string;
      option: FillPatternMetaOptionKey;
      value: number;
      step: number;
      unit?: string;
      context: FillPatternOptionMutationContext;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "roundedCorners";
      id: string;
      label: string;
      enabled: boolean;
      disableRequiresSharpCorners: boolean;
      radius: number;
      defaultRadius: number;
      min: number;
      max: number;
      step: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "arrowTip";
      id: string;
      label: string;
      side: ArrowTipSide;
      value: ArrowTipPresetId;
      options: ArrowTipPresetOption[];
      previewLineWidth: number;
      write: ArrowTipWriteTarget;
    }
  | {
      kind: "shadowPreset";
      id: string;
      label: string;
      value: ShadowPresetId;
      options: ShadowPresetOption[];
      context: ShadowMutationContext;
      write: SetPropertyWriteTarget;
    };

export type InspectorSection = {
  id: string;
  title: string;
  sourceLevel: StyleLevel;
  properties: InspectorProperty[];
};

export type InspectorDescriptor = {
  elementKind: "path" | "circle" | "ellipse" | "text" | "scope";
  elementId: string;
  writeTargetId: string | null;
  readOnlyReason?: string;
  infoNote?: string;
  sections: InspectorSection[];
};

const ROUNDED_CORNERS_MIN = 0.1;
const DEFAULT_TRANSFORM_INSPECTOR_VALUES: TransformInspectorValues = {
  xshift: 0,
  yshift: 0,
  xscale: 1,
  yscale: 1,
  rotate: 0
};
const SHIFT_CLEAR_KEYS = ["shift", "/tikz/shift"] as const;
const SCALE_CLEAR_KEYS = ["scale", "/tikz/scale"] as const;
const ROTATE_CLEAR_KEYS = ["/tikz/rotate"] as const;
const GRID_DEFAULT_STEP_CM = 1;
const GRID_STEP_CLEAR_KEYS = ["xstep", "x step", "ystep", "y step"] as const;
const GRID_XSTEP_CLEAR_KEYS = ["x step"] as const;
const GRID_YSTEP_CLEAR_KEYS = ["y step"] as const;
const FOREACH_TEMPLATE_INFO_NOTE = "Editing the foreach template. Changes apply to all iterations.";
const FOREACH_VARIABLE_READONLY_REASON = "This property depends on foreach iteration variables and is read-only.";
const TRANSFORM_KEY_ALIAS_CLEAR_KEYS: Record<TransformInspectorKey, readonly string[]> = {
  xshift: ["/tikz/xshift"],
  yshift: ["/tikz/yshift"],
  xscale: ["/tikz/xscale"],
  yscale: ["/tikz/yscale"],
  rotate: ["/tikz/rotate"]
};

type ShapeAdaptiveControlBase = {
  id: string;
  label: string;
  writeKey: string;
};

type ShapeAdaptiveNumberControl = ShapeAdaptiveControlBase & {
  kind: "number";
  value: number;
  step: number;
  min?: number;
  max?: number;
  unit?: string;
  clearKeys?: string[];
};

type ShapeAdaptiveLengthControl = ShapeAdaptiveControlBase & {
  kind: "length";
  value: number;
  step: number;
  clearKeys?: string[];
};

type ShapeAdaptiveEnumControl = ShapeAdaptiveControlBase & {
  kind: "enum";
  value: string;
  options: Array<{ value: string; label: string }>;
};

type ShapeAdaptiveBooleanControl = ShapeAdaptiveControlBase & {
  kind: "boolean";
  value: boolean;
  trueValue?: string;
  falseValue?: string;
  clearKeys?: string[];
};

type ShapeAdaptiveControl =
  | ShapeAdaptiveNumberControl
  | ShapeAdaptiveLengthControl
  | ShapeAdaptiveEnumControl
  | ShapeAdaptiveBooleanControl;

const SIGNAL_DIRECTION_ENUM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "nowhere", label: "Nowhere" },
  { value: "north", label: "North" },
  { value: "south", label: "South" },
  { value: "east", label: "East" },
  { value: "west", label: "West" },
  { value: "north and south", label: "North and south" },
  { value: "east and west", label: "East and west" }
];

const TAPE_BEND_ENUM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "in and out", label: "In and out" },
  { value: "out and in", label: "Out and in" },
  { value: "none", label: "None" }
];

function resolveNodeShapeAdaptiveControls(
  shape: Exclude<NodeShapePresetId, "custom">,
  options: OptionListAst | undefined
): ShapeAdaptiveControl[] {
  const geometry = resolveNodeShapeGeometryParams(options);
  const controls: ShapeAdaptiveControl[] = [];
  const idPrefix = `node-shape-${shape.replace(/\s+/g, "-")}`;
  const addRotation = shapeSupportsShapeBorderRotate(shape);

  if (shape === "diamond") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-aspect`,
      label: "Aspect",
      writeKey: "aspect",
      value: geometry.diamondAspect,
      step: 0.05,
      min: 0.05
    });
  } else if (shape === "trapezium") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-left-angle`,
        label: "Left angle",
        writeKey: "trapezium left angle",
        value: geometry.trapeziumLeftAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "number",
        id: `${idPrefix}-right-angle`,
        label: "Right angle",
        writeKey: "trapezium right angle",
        value: geometry.trapeziumRightAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "boolean",
        id: `${idPrefix}-stretches`,
        label: "Stretches",
        writeKey: "trapezium stretches",
        value: geometry.trapeziumStretches
      },
      {
        kind: "boolean",
        id: `${idPrefix}-stretches-body`,
        label: "Stretches body",
        writeKey: "trapezium stretches body",
        value: geometry.trapeziumStretchesBody
      }
    );
  } else if (shape === "regular polygon") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-sides`,
      label: "Sides",
      writeKey: "regular polygon sides",
      value: geometry.regularPolygonSides,
      step: 1,
      min: 3
    });
  } else if (shape === "star") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-points`,
        label: "Points",
        writeKey: "star points",
        value: geometry.starPoints,
        step: 1,
        min: 2
      },
      {
        kind: "number",
        id: `${idPrefix}-point-ratio`,
        label: "Point ratio",
        writeKey: "star point ratio",
        value: geometry.starPointRatio,
        step: 0.05,
        min: 0.05,
        clearKeys: ["star point height"]
      },
      {
        kind: "length",
        id: `${idPrefix}-point-height`,
        label: "Point height",
        writeKey: "star point height",
        value: geometry.starPointHeightPt,
        step: 0.1,
        clearKeys: ["star point ratio"]
      }
    );
  } else if (shape === "isosceles triangle") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-apex-angle`,
        label: "Apex angle",
        writeKey: "isosceles triangle apex angle",
        value: geometry.isoscelesTriangleApexAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "boolean",
        id: `${idPrefix}-stretches`,
        label: "Stretches",
        writeKey: "isosceles triangle stretches",
        value: geometry.isoscelesTriangleStretches
      }
    );
  } else if (shape === "kite") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-upper-vertex-angle`,
        label: "Upper vertex angle",
        writeKey: "kite upper vertex angle",
        value: geometry.kiteUpperVertexAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "number",
        id: `${idPrefix}-lower-vertex-angle`,
        label: "Lower vertex angle",
        writeKey: "kite lower vertex angle",
        value: geometry.kiteLowerVertexAngle,
        step: 1,
        unit: "deg"
      }
    );
  } else if (shape === "dart") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-tip-angle`,
        label: "Tip angle",
        writeKey: "dart tip angle",
        value: geometry.dartTipAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "number",
        id: `${idPrefix}-tail-angle`,
        label: "Tail angle",
        writeKey: "dart tail angle",
        value: geometry.dartTailAngle,
        step: 1,
        unit: "deg"
      }
    );
  } else if (shape === "circular sector") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-angle`,
      label: "Sector angle",
      writeKey: "circular sector angle",
      value: geometry.circularSectorAngle,
      step: 1,
      unit: "deg"
    });
  } else if (shape === "cylinder") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-aspect`,
      label: "Aspect",
      writeKey: "aspect",
      value: geometry.cylinderAspect,
      step: 0.05,
      min: 0.05
    });
  } else if (shape === "cloud") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-aspect`,
        label: "Aspect",
        writeKey: "aspect",
        value: geometry.diamondAspect,
        step: 0.05,
        min: 0.05
      },
      {
        kind: "number",
        id: `${idPrefix}-puffs`,
        label: "Puffs",
        writeKey: "cloud puffs",
        value: geometry.cloudPuffs,
        step: 1,
        min: 2
      },
      {
        kind: "number",
        id: `${idPrefix}-puff-arc`,
        label: "Puff arc",
        writeKey: "cloud puff arc",
        value: geometry.cloudPuffArc,
        step: 1,
        unit: "deg"
      },
      {
        kind: "boolean",
        id: `${idPrefix}-ignores-aspect`,
        label: "Ignore aspect",
        writeKey: "cloud ignores aspect",
        value: geometry.cloudIgnoresAspect
      }
    );
  } else if (shape === "starburst") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-points`,
        label: "Points",
        writeKey: "starburst points",
        value: geometry.starburstPoints,
        step: 1,
        min: 2
      },
      {
        kind: "length",
        id: `${idPrefix}-point-height`,
        label: "Point height",
        writeKey: "starburst point height",
        value: geometry.starburstPointHeightPt,
        step: 0.1
      },
      {
        kind: "number",
        id: `${idPrefix}-random-seed`,
        label: "Random seed",
        writeKey: "random starburst",
        value: geometry.randomStarburstSeed,
        step: 1,
        min: 0
      }
    );
  } else if (shape === "signal") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-pointer-angle`,
        label: "Pointer angle",
        writeKey: "signal pointer angle",
        value: geometry.signalPointerAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "enum",
        id: `${idPrefix}-to`,
        label: "Signal to",
        writeKey: "signal to",
        value: signalDirectionsToEnumValue(geometry.signalToSides),
        options: SIGNAL_DIRECTION_ENUM_OPTIONS
      },
      {
        kind: "enum",
        id: `${idPrefix}-from`,
        label: "Signal from",
        writeKey: "signal from",
        value: signalDirectionsToEnumValue(geometry.signalFromSides),
        options: SIGNAL_DIRECTION_ENUM_OPTIONS
      }
    );
  } else if (shape === "tape") {
    controls.push(
      {
        kind: "enum",
        id: `${idPrefix}-bend-top`,
        label: "Bend top",
        writeKey: "tape bend top",
        value: geometry.tapeBendTop,
        options: TAPE_BEND_ENUM_OPTIONS
      },
      {
        kind: "enum",
        id: `${idPrefix}-bend-bottom`,
        label: "Bend bottom",
        writeKey: "tape bend bottom",
        value: geometry.tapeBendBottom,
        options: TAPE_BEND_ENUM_OPTIONS
      },
      {
        kind: "length",
        id: `${idPrefix}-bend-height`,
        label: "Bend height",
        writeKey: "tape bend height",
        value: geometry.tapeBendHeightPt,
        step: 0.1
      }
    );
  } else if (shape === "single arrow") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-tip-angle`,
        label: "Tip angle",
        writeKey: "single arrow tip angle",
        value: geometry.singleArrowTipAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "length",
        id: `${idPrefix}-head-extend`,
        label: "Head extend",
        writeKey: "single arrow head extend",
        value: geometry.singleArrowHeadExtendPt,
        step: 0.1
      },
      {
        kind: "length",
        id: `${idPrefix}-head-indent`,
        label: "Head indent",
        writeKey: "single arrow head indent",
        value: geometry.singleArrowHeadIndentPt,
        step: 0.1
      }
    );
  } else if (shape === "double arrow") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-tip-angle`,
        label: "Tip angle",
        writeKey: "double arrow tip angle",
        value: geometry.doubleArrowTipAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "length",
        id: `${idPrefix}-head-extend`,
        label: "Head extend",
        writeKey: "double arrow head extend",
        value: geometry.doubleArrowHeadExtendPt,
        step: 0.1
      },
      {
        kind: "length",
        id: `${idPrefix}-head-indent`,
        label: "Head indent",
        writeKey: "double arrow head indent",
        value: geometry.doubleArrowHeadIndentPt,
        step: 0.1
      }
    );
  }

  if (addRotation) {
    controls.push({
      kind: "number",
      id: `${idPrefix}-border-rotate`,
      label: "Border rotate",
      writeKey: "shape border rotate",
      value: geometry.shapeBorderRotate,
      step: 1,
      unit: "deg"
    });
  }

  return controls;
}

function shapeSupportsShapeBorderRotate(shape: Exclude<NodeShapePresetId, "custom">): boolean {
  return (
    shape === "trapezium"
    || shape === "semicircle"
    || shape === "regular polygon"
    || shape === "star"
    || shape === "isosceles triangle"
    || shape === "kite"
    || shape === "dart"
    || shape === "circular sector"
    || shape === "cylinder"
    || shape === "cloud"
    || shape === "starburst"
    || shape === "single arrow"
    || shape === "double arrow"
  );
}

function signalDirectionsToEnumValue(sides: SignalDirection[]): string {
  if (sides.length === 0) {
    return "nowhere";
  }
  const unique = Array.from(new Set(sides));
  if (unique.length === 1) {
    return unique[0];
  }
  const sorted = [...unique].sort();
  if (sorted.length === 2 && sorted[0] === "east" && sorted[1] === "west") {
    return "east and west";
  }
  if (sorted.length === 2 && sorted[0] === "north" && sorted[1] === "south") {
    return "north and south";
  }
  return unique[0] ?? "nowhere";
}

export function buildArrowTipSetPropertyMutation(
  context: ArrowTipWriteContext,
  side: ArrowTipSide,
  value: Exclude<ArrowTipPresetId, "custom">
): ArrowTipSetPropertyMutation {
  const nextStartRaw = side === "start" ? arrowPresetSideRaw(value, "start") : context.startRaw;
  const nextEndRaw = side === "end" ? arrowPresetSideRaw(value, "end") : context.endRaw;
  const serialized = serializeArrowSides(nextStartRaw, nextEndRaw);

  return {
    key: serialized.key,
    value: serialized.value,
    clearKeys: uniqueStrings([...ARROW_DEFAULT_CLEAR_KEYS, ...context.clearKeys])
  };
}

export function buildDashStyleSetPropertyMutation(
  value: Exclude<DashStylePresetId, "custom">
): DashStyleSetPropertyMutation {
  return {
    key: value,
    value: "true",
    clearKeys: uniqueStrings(DASH_STYLE_PRESET_CLEAR_KEYS)
  };
}

export function buildLineCapSetPropertyMutation(
  value: Exclude<LineCapPresetId, "custom">
): LineCapSetPropertyMutation {
  return {
    key: "line cap",
    value: value === "square" ? "projecting" : value,
    clearKeys: []
  };
}

export function buildLineJoinSetPropertyMutation(
  value: Exclude<LineJoinPresetId, "custom">
): LineJoinSetPropertyMutation {
  return {
    key: "line join",
    value,
    clearKeys: []
  };
}

export function buildFillModeSetPropertyMutations(
  value: Exclude<FillModePresetId, "custom">,
  context: Partial<FillModeMutationContext> = {}
): FillModeSetPropertyMutation[] {
  const fillColor = normalizeFillMutationColor(context.fillColor, "black");
  const patternColor = normalizeFillMutationColor(context.patternColor, "black");
  const nextShading = selectCuratedShadingPreset(context.shading);
  const nextPattern = selectCuratedPatternPreset(context.pattern);

  if (value === "solid") {
    return [
      {
        key: "fill",
        value: fillColor,
        clearKeys: uniqueStrings([...FILL_PATTERN_CLEAR_KEYS, ...FILL_SHADING_CLEAR_KEYS])
      }
    ];
  }

  if (value === "gradient") {
    const clearKeys = uniqueStrings(FILL_PATTERN_CLEAR_KEYS);
    return [
      {
        key: "shade",
        value: "true",
        clearKeys
      },
      {
        key: "shading",
        value: nextShading,
        clearKeys
      }
    ];
  }

  const clearKeys = uniqueStrings(FILL_SHADING_CLEAR_KEYS);
  return [
    {
      key: "pattern",
      value: nextPattern,
      clearKeys
    },
    {
      key: "pattern color",
      value: patternColor,
      clearKeys
    }
  ];
}

export function buildFillShadingSetPropertyMutations(
  value: Exclude<FillShadingPresetId, "custom">
): FillShadingSetPropertyMutation[] {
  const conflictClearKeys = uniqueStrings(
    value === "axis"
      ? AXIS_SHADING_CONFLICT_CLEAR_KEYS
      : value === "radial"
        ? RADIAL_SHADING_CONFLICT_CLEAR_KEYS
        : BALL_SHADING_CONFLICT_CLEAR_KEYS
  );

  return [
    {
      key: "shade",
      value: "true",
      clearKeys: []
    },
    {
      key: "shading",
      value,
      clearKeys: conflictClearKeys
    }
  ];
}

export function buildFillPatternSetPropertyMutation(
  value: Exclude<FillPatternPresetId, "custom">
): FillPatternSetPropertyMutation {
  return {
    key: "pattern",
    value,
    clearKeys: []
  };
}

export function buildFillPatternOptionSetPropertyMutation(
  context: FillPatternOptionMutationContext,
  option: FillPatternMetaOptionKey,
  value: number
): FillPatternOptionSetPropertyMutation {
  const nextValues = {
    ...context.values,
    [fillPatternMetaValueKey(option)]: sanitizeFillPatternMetaOptionValue(option, value, context.values)
  };

  return {
    key: "pattern",
    value: serializeFillPatternMetaPattern(context.family, nextValues),
    clearKeys: []
  };
}

export function buildPathMorphingDecorationSetPropertyMutations(
  value: Exclude<PathMorphingDecorationPresetId, "custom">
): PathMorphingDecorationSetPropertyMutation[] {
  const clearKeys = uniqueStrings(PATH_MORPHING_DECORATION_CLEAR_KEYS);
  const clearKeysWithoutDecorate = clearKeys.filter((key) => key !== "decorate");

  if (value === "none") {
    return [
      {
        key: "decorate",
        value: "false",
        clearKeys: clearKeysWithoutDecorate
      }
    ];
  }

  return [
    {
      key: "decorate",
      value: "true",
      clearKeys: clearKeysWithoutDecorate
    },
    {
      key: "decoration",
      value,
      clearKeys: clearKeysWithoutDecorate
    }
  ];
}

export function buildRoundedCornersSetPropertyMutation(
  enabled: boolean,
  radius: number = ROUNDED_CORNERS_DEFAULT_RADIUS,
  disableRequiresSharpCorners = true
): RoundedCornersSetPropertyMutation {
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : ROUNDED_CORNERS_DEFAULT_RADIUS;
  const clearKeys = uniqueStrings(ROUNDED_CORNERS_CLEAR_KEYS);

  if (!enabled) {
    if (!disableRequiresSharpCorners) {
      return {
        key: "rounded corners",
        value: "",
        clearKeys
      };
    }
    return {
      key: "sharp corners",
      value: "true",
      clearKeys: clearKeys.filter((key) => key !== "sharp corners")
    };
  }

  return {
    key: "rounded corners",
    value:
      Math.abs(safeRadius - ROUNDED_CORNERS_DEFAULT_RADIUS) <= 1e-6
        ? "true"
        : `${formatInspectorLength(safeRadius)}pt`,
    clearKeys: clearKeys.filter((key) => key !== "rounded corners")
  };
}

export function buildNodeShapeSetPropertyMutation(
  value: Exclude<NodeShapePresetId, "custom">
): NodeShapeSetPropertyMutation {
  return {
    key: NODE_SHAPE_KEY,
    value,
    clearKeys: uniqueStrings([...NODE_SHAPE_KNOWN_KEYS])
  };
}

export function buildNodeInnerSepSetPropertyMutation(value: number): NodeInnerSepSetPropertyMutation {
  const safe = Number.isFinite(value) && value >= 0 ? value : NODE_INNER_SEP_DEFAULT;
  return {
    key: "inner sep",
    value: `${formatInspectorLength(safe)}pt`,
    clearKeys: uniqueStrings([...NODE_INNER_SEP_CLEAR_KEYS])
  };
}

export function buildNodeMinimumDimensionSetPropertyMutations(
  context: NodeMinimumDimensionsMutationContext,
  editedKey: NodeMinimumDimensionKey,
  nextValue: number
): NodeMinimumDimensionSetPropertyMutation[] {
  if (!Number.isFinite(nextValue)) {
    return [];
  }

  const safeWidth = Number.isFinite(context.minimumWidth) && context.minimumWidth >= 0
    ? context.minimumWidth
    : NODE_MINIMUM_DIMENSION_DEFAULT;
  const safeHeight = Number.isFinite(context.minimumHeight) && context.minimumHeight >= 0
    ? context.minimumHeight
    : NODE_MINIMUM_DIMENSION_DEFAULT;
  const safeNextValue = Math.max(0, normalizeTinyNumber(nextValue));
  const nextDimensions = {
    minimumWidth: safeWidth,
    minimumHeight: safeHeight
  };
  if (editedKey === "minimum width") {
    nextDimensions.minimumWidth = safeNextValue;
  } else {
    nextDimensions.minimumHeight = safeNextValue;
  }

  const companionKey: NodeMinimumDimensionKey = editedKey === "minimum width" ? "minimum height" : "minimum width";
  const companionValue = companionKey === "minimum width" ? nextDimensions.minimumWidth : nextDimensions.minimumHeight;
  const mutations: NodeMinimumDimensionSetPropertyMutation[] = [
    {
      key: editedKey,
      value: `${formatInspectorLength(safeNextValue)}pt`,
      clearKeys: uniqueStrings([...NODE_MINIMUM_DIMENSION_CLEAR_KEYS])
    }
  ];

  if (Math.abs(companionValue - NODE_MINIMUM_DIMENSION_DEFAULT) > 1e-6) {
    mutations.push({
      key: companionKey,
      value: `${formatInspectorLength(companionValue)}pt`,
      clearKeys: uniqueStrings([...NODE_MINIMUM_DIMENSION_CLEAR_KEYS])
    });
  }

  return mutations;
}

export function buildNodeFontSetPropertyMutation(
  context: NodeFontMutationContext,
  values: {
    family: NodeFontFamilyId;
    weight: "normal" | "bold";
    style: "normal" | "italic";
    sizePreset: NodeFontSizePresetId;
    customSizePt: number | null;
  }
): NodeFontSetPropertyMutation {
  const preset = values.sizePreset === "custom" ? null : NODE_FONT_PRESET_BY_ID.get(values.sizePreset);
  const safeCustomSize =
    Number.isFinite(values.customSizePt) && (values.customSizePt ?? 0) > 0
      ? (values.customSizePt as number)
      : context.fallbackCustomSizePt;
  const commandParts: string[] = [];

  if (preset != null) {
    if (preset.value !== "normalsize") {
      commandParts.push(preset.command);
    }
  } else {
    commandParts.push(
      `\\fontsize{${formatInspectorLength(safeCustomSize)}pt}{${formatInspectorLength(safeCustomSize * 1.2)}pt}\\selectfont`
    );
  }

  if (values.family !== "serif") {
    commandParts.push(NODE_FONT_FAMILY_COMMAND[values.family]);
  }
  if (values.weight !== "normal") {
    commandParts.push(NODE_FONT_WEIGHT_COMMAND[values.weight]);
  }
  if (values.style !== "normal") {
    commandParts.push(NODE_FONT_STYLE_COMMAND[values.style]);
  }

  return {
    key: context.key,
    value: commandParts.join(""),
    clearKeys: uniqueStrings(context.clearKeys)
  };
}

export function resolveTransformInspectorMutationContext(
  source: string,
  targetId: string | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): TransformInspectorMutationContext {
  if (!targetId) {
    return resolveTransformInspectorMutationContextFromOptionEntries(null);
  }

  const resolved = resolveTarget(targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return resolveTransformInspectorMutationContextFromOptionEntries(null);
  }

  return resolveTransformInspectorMutationContextFromOptionEntries(resolved.target.options.entries);
}

export function resolveTransformInspectorMutationContextFromOptionEntries(
  entries: readonly OptionEntry[] | null | undefined
): TransformInspectorMutationContext {
  const values = cloneTransformInspectorValues(DEFAULT_TRANSFORM_INSPECTOR_VALUES);
  const presence = createEmptyTransformInspectorPresence();

  for (const entry of entries ?? []) {
    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeOptionKey(entry.key);
    if (key === "scale" || key === "/tikz/scale") {
      presence.scale = true;
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.xscale = parsed;
        values.yscale = parsed;
      }
      continue;
    }

    if (key === "xscale" || key === "/tikz/xscale") {
      presence.xscale = true;
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.xscale = parsed;
      }
      continue;
    }

    if (key === "yscale" || key === "/tikz/yscale") {
      presence.yscale = true;
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.yscale = parsed;
      }
      continue;
    }

    if (key === "shift" || key === "/tikz/shift") {
      presence.shift = true;
      const parsed = parseShiftTransformValue(entry.valueRaw);
      if (parsed) {
        values.xshift = parsed.x;
        values.yshift = parsed.y;
      }
      continue;
    }

    if (key === "xshift" || key === "/tikz/xshift") {
      presence.xshift = true;
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        values.xshift = parsed;
      }
      continue;
    }

    if (key === "yshift" || key === "/tikz/yshift") {
      presence.yshift = true;
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        values.yshift = parsed;
      }
      continue;
    }

    if (key === "rotate" || key === "/tikz/rotate") {
      presence.rotate = true;
      const parsed = parseTransformScalar(entry.valueRaw);
      if (parsed != null) {
        values.rotate = parsed;
      }
    }
  }

  return { values, presence };
}

export function resolveTransformInspectorValues(
  source: string,
  targetId: string | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): TransformInspectorValues {
  return resolveTransformInspectorMutationContext(source, targetId, parseOptions, resolveTarget).values;
}

export function buildTransformSetPropertyMutations(
  current: TransformInspectorValues | TransformInspectorMutationContext,
  editedKey: TransformInspectorKey,
  nextValue: number
): TransformSetPropertyMutation[] {
  if (!Number.isFinite(nextValue)) {
    return [];
  }

  const mutationContext = coerceTransformInspectorMutationContext(current);
  const currentValues = mutationContext.values;
  const sanitizedCurrent = sanitizeTransformInspectorValues(currentValues);
  const safeNextValue = normalizeTinyNumber(nextValue);

  if (editedKey === "xshift" || editedKey === "yshift") {
    const nextValues = {
      ...sanitizedCurrent,
      [editedKey]: safeNextValue
    };
    const companionKey: "xshift" | "yshift" = editedKey === "xshift" ? "yshift" : "xshift";
    const mutations: TransformSetPropertyMutation[] = [
      buildTransformMutation(
        editedKey,
        nextValues[editedKey],
        DEFAULT_TRANSFORM_INSPECTOR_VALUES[editedKey],
        [...SHIFT_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS[editedKey]]
      )
    ];

    const companionValue = nextValues[companionKey];
    const companionDefault = DEFAULT_TRANSFORM_INSPECTOR_VALUES[companionKey];
    if (shouldSetTransformCompanion(mutationContext, companionKey, companionValue, companionDefault, "shift")) {
      mutations.push(
        buildTransformMutation(
          companionKey,
          companionValue,
          companionDefault,
          TRANSFORM_KEY_ALIAS_CLEAR_KEYS[companionKey]
        )
      );
    } else if (shouldClearTransformCompanion(mutationContext, companionKey, companionDefault)) {
      mutations.push(buildTransformMutation(companionKey, companionDefault, companionDefault, TRANSFORM_KEY_ALIAS_CLEAR_KEYS[companionKey]));
    }

    return mutations;
  }

  if (editedKey === "xscale" || editedKey === "yscale") {
    const nextValues = {
      ...sanitizedCurrent,
      [editedKey]: safeNextValue
    };
    const companionKey: "xscale" | "yscale" = editedKey === "xscale" ? "yscale" : "xscale";
    const mutations: TransformSetPropertyMutation[] = [
      buildTransformMutation(
        editedKey,
        nextValues[editedKey],
        DEFAULT_TRANSFORM_INSPECTOR_VALUES[editedKey],
        [...SCALE_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS[editedKey]]
      )
    ];

    const companionValue = nextValues[companionKey];
    const companionDefault = DEFAULT_TRANSFORM_INSPECTOR_VALUES[companionKey];
    if (shouldSetTransformCompanion(mutationContext, companionKey, companionValue, companionDefault, "scale")) {
      mutations.push(
        buildTransformMutation(
          companionKey,
          companionValue,
          companionDefault,
          TRANSFORM_KEY_ALIAS_CLEAR_KEYS[companionKey]
        )
      );
    } else if (shouldClearTransformCompanion(mutationContext, companionKey, companionDefault)) {
      mutations.push(buildTransformMutation(companionKey, companionDefault, companionDefault, TRANSFORM_KEY_ALIAS_CLEAR_KEYS[companionKey]));
    }

    return mutations;
  }

  return [
    buildTransformMutation(
      "rotate",
      safeNextValue,
      DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate,
      ROTATE_CLEAR_KEYS
    )
  ];
}

const SHADOW_EPS = 0.001;

export function buildShadowMutationContextForPreset(preset: ShadowPresetId): ShadowMutationContext {
  if (preset === "none") {
    return {
      preset,
      xshiftPt: 0,
      yshiftPt: 0,
      scale: 1,
      opacity: 1,
      color: null
    };
  }

  const defaults = SHADOW_PRESET_DEFAULTS[preset];
  return {
    preset,
    xshiftPt: defaults.xshiftPt,
    yshiftPt: defaults.yshiftPt,
    scale: defaults.scale,
    opacity: defaults.opacity ?? 1,
    color: defaults.color
  };
}

export function buildShadowSetPropertyMutations(
  nextContext: ShadowMutationContext
): ShadowSetPropertyMutation[] {
  const allKeys = [...SHADOW_ALL_KEYS] as string[];

  if (nextContext.preset === "none") {
    return [{ key: allKeys[0], value: "", clearKeys: allKeys }];
  }

  const tikzKey = SHADOW_PRESET_TIKZ_KEY[nextContext.preset];
  const defaults = SHADOW_PRESET_DEFAULTS[nextContext.preset];
  const defaultOpacity = defaults.opacity ?? 1;
  const otherClearKeys = allKeys.filter((k) => k !== tikzKey);
  const sanitizedColor =
    nextContext.color === SHADOW_INHERIT_FILL || nextContext.color === SHADOW_INHERIT_STROKE
      ? defaults.color
      : nextContext.color;

  const opts: string[] = [];

  if (Math.abs(nextContext.xshiftPt - defaults.xshiftPt) > SHADOW_EPS) {
    opts.push(`shadow xshift=${formatNumber(nextContext.xshiftPt)}pt`);
  }
  if (Math.abs(nextContext.yshiftPt - defaults.yshiftPt) > SHADOW_EPS) {
    opts.push(`shadow yshift=${formatNumber(nextContext.yshiftPt)}pt`);
  }
  if (Math.abs(nextContext.scale - defaults.scale) > SHADOW_EPS) {
    opts.push(`shadow scale=${formatNumber(nextContext.scale)}`);
  }
  if (Math.abs(nextContext.opacity - defaultOpacity) > SHADOW_EPS) {
    opts.push(`opacity=${formatNumber(nextContext.opacity)}`);
  }
  if (defaults.color !== null && sanitizedColor !== null && sanitizedColor !== defaults.color) {
    opts.push(`fill=${sanitizedColor}`);
  }

  return [{ key: tikzKey, value: opts.length === 0 ? "true" : `{${opts.join(",")}}`, clearKeys: otherClearKeys }];
}

function resolveMatrixSpacingPt(options: OptionListAst | undefined, key: "row sep" | "column sep"): number {
  const entry = options?.entries.find((candidate) => candidate.kind === "kv" && candidate.key === key);
  if (!entry || entry.kind !== "kv") {
    return 0;
  }
  const tokens = entry.valueRaw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  let sum = 0;
  for (const token of tokens) {
    const parsed = parseLength(token, "pt");
    if (parsed != null) {
      sum += parsed;
    }
  }
  return sum;
}

function resolveMatrixColorOption(options: OptionListAst | undefined, key: "draw" | "fill"): string | null {
  const entry = options?.entries.find((candidate) => candidate.kind === "kv" && candidate.key === key);
  if (!entry || entry.kind !== "kv") {
    return null;
  }
  const normalized = entry.valueRaw.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionHasNormalizedKey(options: OptionListAst | undefined, key: string): boolean {
  const normalizedKey = normalizeOptionKey(key);
  return (
    options?.entries.some(
      (entry) =>
        (entry.kind === "flag" || entry.kind === "kv")
        && normalizeOptionKey(entry.key) === normalizedKey
    ) ?? false
  );
}

function resolveTreeLengthOptionPt(options: OptionListAst | undefined, key: "level distance" | "sibling distance"): number {
  const normalizedKey = normalizeOptionKey(key);
  const entry = options?.entries.find(
    (candidate) =>
      candidate.kind === "kv"
      && normalizeOptionKey(candidate.key) === normalizedKey
  );
  if (!entry || entry.kind !== "kv") {
    return 0;
  }
  const parsed = parseLength(entry.valueRaw, "pt");
  return parsed != null && Number.isFinite(parsed) ? parsed : 0;
}

function resolveTreeGrowOption(options: OptionListAst | undefined): string {
  const growEntry = options?.entries.find(
    (candidate) =>
      candidate.kind === "kv"
      && normalizeOptionKey(candidate.key) === "grow"
  );
  if (!growEntry || growEntry.kind !== "kv") {
    return "down";
  }
  const normalized = growEntry.valueRaw.trim();
  return normalized.length > 0 ? normalized : "down";
}

export function buildMatrixInspectorDescriptor(
  source: string,
  matrixId: string,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InspectorDescriptor | null {
  const resolved = resolveTarget(matrixId);
  if (resolved.kind === "not-found" || resolved.target.kind !== "matrix-statement") {
    return null;
  }

  const writable = true;
  const readOnlyReason = undefined;
  const transformContext = resolveTransformInspectorMutationContext(source, matrixId, parseOptions, resolveTarget);
  const transformValues = transformContext.values;
  const rowSepPt = resolveMatrixSpacingPt(resolved.target.options, "row sep");
  const columnSepPt = resolveMatrixSpacingPt(resolved.target.options, "column sep");
  const drawColor = resolveMatrixColorOption(resolved.target.options, "draw");
  const fillColor = resolveMatrixColorOption(resolved.target.options, "fill");

  return {
    elementKind: "path",
    elementId: matrixId,
    writeTargetId: matrixId,
    readOnlyReason,
    sections: [
      {
        id: "transform",
        title: "Transform",
        sourceLevel: "command",
        properties: [
          {
            kind: "number",
            id: "xshift",
            label: "X shift",
            value: transformValues.xshift,
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "xshift",
              transformContext: {
                key: "xshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yshift",
            label: "Y shift",
            value: transformValues.yshift,
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "yshift",
              transformContext: {
                key: "yshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "xscale",
            label: "X scale",
            value: transformValues.xscale,
            step: 0.1,
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "xscale",
              transformContext: {
                key: "xscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yscale",
            label: "Y scale",
            value: transformValues.yscale,
            step: 0.1,
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "yscale",
              transformContext: {
                key: "yscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "rotate",
            label: "Rotate",
            value: transformValues.rotate,
            step: 1,
            unit: "deg",
            write: {
              mode: "setProperty",
              elementId: matrixId,
              level: "command",
              key: "rotate",
              transformContext: {
                key: "rotate",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          }
        ]
      },
      {
        id: "matrix",
        title: "Matrix",
        sourceLevel: "command",
        properties: [
          {
            kind: "length",
            id: "matrix-row-sep",
            label: "Row sep",
            value: rowSepPt,
            step: 0.1,
            unit: "pt",
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "row sep", writable, reason: readOnlyReason }
          },
          {
            kind: "length",
            id: "matrix-column-sep",
            label: "Column sep",
            value: columnSepPt,
            step: 0.1,
            unit: "pt",
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "column sep", writable, reason: readOnlyReason }
          },
          {
            kind: "color",
            id: "matrix-draw",
            label: "Draw",
            value: drawColor,
            syntaxValue: drawColor,
            options: colorOptionsForValue(drawColor),
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "draw", writable, reason: readOnlyReason }
          },
          {
            kind: "color",
            id: "matrix-fill",
            label: "Fill",
            value: fillColor,
            syntaxValue: fillColor,
            options: colorOptionsForValue(fillColor),
            write: { mode: "setProperty", elementId: matrixId, level: "command", key: "fill", writable, reason: readOnlyReason }
          }
        ]
      }
    ]
  };
}

const TREE_GROW_DIRECTION_OPTIONS = [
  { value: "down", label: "Down" },
  { value: "up", label: "Up" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" }
];

export function buildTreeInspectorDescriptor(
  source: string,
  sourceId: string,
  element: SceneElement | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InspectorDescriptor | null {
  const resolvedRootTarget = resolveTarget(sourceId);
  if (resolvedRootTarget.kind === "not-found" || resolvedRootTarget.target.kind !== "path-statement") {
    return null;
  }

  const rootStatement =
    parseOptions.analysisView &&
    parseOptions.analysisView.source === source &&
    parseOptions.analysisView.activeFigureId === parseOptions.activeFigureId
      ? parseOptions.analysisView.findPathStatement(sourceId)
      : findPathStatementInSource(source, sourceId, parseOptions);
  if (!rootStatement) {
    return null;
  }
  const hasChildren = rootStatement.items.some((item) => item.kind === "ChildOperation");
  if (!hasChildren) {
    return null;
  }

  const rootNode = rootStatement.items.find((item): item is Extract<PathItem, { kind: "Node" }> => item.kind === "Node");
  if (!rootNode) {
    return null;
  }

  const rootNodeElement = element
    ? ({
        ...element,
        sourceRef: {
          ...element.sourceRef,
          sourceId: rootNode.id
        }
      } as SceneElement)
    : null;
  const rootNodeDescriptor = rootNodeElement
    ? getInspectorDescriptor(rootNodeElement, {
        source,
        parseOptions
      }, resolveTarget)
    : null;
  const nodeSections = rootNodeDescriptor
    ? rootNodeDescriptor.sections.filter((section) => section.id !== "transform")
    : [];

  const writable = true;
  const readOnlyReason = undefined;
  const transformContext = resolveTransformInspectorMutationContext(source, sourceId, parseOptions, resolveTarget);
  const transformValues = transformContext.values;

  const resolveRootLayoutWriteTargetId = (key: string): string => {
    if (!TREE_ROOT_LAYOUT_KEYS.has(normalizeOptionKey(key))) {
      return sourceId;
    }
    if (optionHasNormalizedKey(resolvedRootTarget.target.options, key)) {
      return sourceId;
    }
    if (optionHasNormalizedKey(rootNode.options, key)) {
      return rootNode.id;
    }
    return sourceId;
  };
  const resolveRootLayoutValue = (key: "level distance" | "sibling distance"): number => {
    if (optionHasNormalizedKey(resolvedRootTarget.target.options, key)) {
      return resolveTreeLengthOptionPt(resolvedRootTarget.target.options, key);
    }
    if (optionHasNormalizedKey(rootNode.options, key)) {
      return resolveTreeLengthOptionPt(rootNode.options, key);
    }
    return 0;
  };
  const growValue = optionHasNormalizedKey(resolvedRootTarget.target.options, "grow")
    ? resolveTreeGrowOption(resolvedRootTarget.target.options)
    : resolveTreeGrowOption(rootNode.options);

  return {
    elementKind: "path",
    elementId: sourceId,
    writeTargetId: sourceId,
    readOnlyReason,
    sections: [
      {
        id: "transform",
        title: "Transform",
        sourceLevel: "command",
        properties: [
          {
            kind: "number",
            id: "xshift",
            label: "X shift",
            value: transformValues.xshift,
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "xshift",
              transformContext: {
                key: "xshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yshift",
            label: "Y shift",
            value: transformValues.yshift,
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "yshift",
              transformContext: {
                key: "yshift",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "xscale",
            label: "X scale",
            value: transformValues.xscale,
            step: 0.1,
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "xscale",
              transformContext: {
                key: "xscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "yscale",
            label: "Y scale",
            value: transformValues.yscale,
            step: 0.1,
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "yscale",
              transformContext: {
                key: "yscale",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "number",
            id: "rotate",
            label: "Rotate",
            value: transformValues.rotate,
            step: 1,
            unit: "deg",
            write: {
              mode: "setProperty",
              elementId: sourceId,
              level: "command",
              key: "rotate",
              transformContext: {
                key: "rotate",
                values: cloneTransformInspectorValues(transformContext.values),
                presence: transformContext.presence ? { ...transformContext.presence } : undefined
              },
              writable,
              reason: readOnlyReason
            }
          }
        ]
      },
      {
        id: "tree-layout",
        title: "Tree Layout",
        sourceLevel: "command",
        properties: [
          {
            kind: "enum",
            id: "tree-grow",
            label: "Grow",
            value: growValue,
            options: TREE_GROW_DIRECTION_OPTIONS,
            write: {
              mode: "setProperty",
              elementId: resolveRootLayoutWriteTargetId("grow"),
              level: "command",
              key: "grow",
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "length",
            id: "tree-level-distance",
            label: "Level distance",
            value: resolveRootLayoutValue("level distance"),
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: resolveRootLayoutWriteTargetId("level distance"),
              level: "command",
              key: "level distance",
              writable,
              reason: readOnlyReason
            }
          },
          {
            kind: "length",
            id: "tree-sibling-distance",
            label: "Sibling distance",
            value: resolveRootLayoutValue("sibling distance"),
            step: 0.1,
            unit: "pt",
            write: {
              mode: "setProperty",
              elementId: resolveRootLayoutWriteTargetId("sibling distance"),
              level: "command",
              key: "sibling distance",
              writable,
              reason: readOnlyReason
            }
          }
        ]
      },
      ...nodeSections
    ]
  };
}

export function getInspectorDescriptor(
  element: SceneElement,
  snapshot: InspectorSnapshot,
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(snapshot.source, snapshot.parseOptions)
): InspectorDescriptor {
  const inlineTarget = resolveInlineWriteTarget(element, snapshot.source, snapshot.parseOptions, resolveTarget);
  const resolvedInlineTarget =
    inlineTarget.targetId != null
      ? resolveTarget(inlineTarget.targetId)
      : null;
  const colorAliases = snapshot.parseOptions?.colorAliases ?? collectInspectorColorAliases(snapshot.source);
  const transformContext = resolveTransformInspectorMutationContext(
    snapshot.source,
    inlineTarget.targetId,
    snapshot.parseOptions,
    resolveTarget
  );
  const transformValues = transformContext.values;
  const strokeColor = normalizeInspectorColorValue(element.style.stroke);
  const strokeColorSyntax = resolveColorSyntaxValue(
    resolvedInlineTarget,
    ["draw", "color"],
    strokeColor,
    colorAliases,
    element.styleChain
  );
  const fillColor = normalizeInspectorColorValue(element.style.fill);
  const fillColorSyntax = resolveColorSyntaxValue(
    resolvedInlineTarget,
    ["fill", "color"],
    fillColor,
    colorAliases,
    element.styleChain
  );
  const patternColor = normalizeInspectorColorValue(element.style.patternColor);
  const patternColorSyntax = resolveColorSyntaxValue(
    resolvedInlineTarget,
    ["pattern color"],
    patternColor,
    colorAliases,
    element.styleChain
  );
  const fillPaintState = resolveFillPaintState(
    snapshot.source,
    inlineTarget.targetId,
    element.style,
    snapshot.parseOptions,
    resolveTarget
  );
  const textColor = normalizeInspectorColorValue(element.style.textColor);
  const textColorSyntax = resolveColorSyntaxValue(
    resolvedInlineTarget,
    ["text", "color"],
    textColor,
    colorAliases,
    element.styleChain
  );
  const pathStrokeVisibility =
    element.kind === "Path"
      ? computePathStrokeControlVisibility(element.commands, element.style.dashArray)
      : null;
  const pathFillVisibility = element.kind === "Path" ? pathSupportsFillEditing(element.commands) : true;
  const nodeInspectorState =
    inlineTarget.targetKind === "node-item" || inlineTarget.targetKind === "matrix-cell" || inlineTarget.targetKind === "tree-child"
      ? resolveNodeInspectorState(snapshot.source, inlineTarget.targetId, element.style, element.kind, snapshot.parseOptions, resolveTarget)
      : null;
  const pathAttachedNodeInspectorState =
    inlineTarget.targetKind === "node-item" && inlineTarget.targetId && element.pathAttachment
      ? (() => {
          const snapped = resolvePathPositionPreset(element.pathAttachment.pos, element.pathAttachment.segment, {
            normalizedThreshold: 0.02,
            worldThresholdPt: 8
          });
          const regime = element.pathAttachment.regime;
          return {
            positionPreset: snapped.preset ?? "custom",
            customPosition: element.pathAttachment.pos,
            sideLabel:
              regime.kind === "neutral"
                ? null
                : regime.kind === "auto-side"
                  ? "Preferred side"
                  : "Side",
            sideValue:
              regime.kind === "neutral"
                ? null
                : regime.kind === "auto-side"
                  ? regime.side
                  : regime.direction,
            sideOptions:
              regime.kind === "neutral"
                ? []
                : regime.kind === "auto-side"
                ? [
                    { value: "left", label: "Left" },
                    { value: "right", label: "Right" }
                  ]
                : regime.family === "base"
                  ? [
                      { value: "base left", label: "Base left" },
                      { value: "base right", label: "Base right" }
                    ]
                  : regime.family === "mid"
                    ? [
                        { value: "mid left", label: "Mid left" },
                        { value: "mid right", label: "Mid right" }
                      ]
                    : [
                        { value: "above", label: "Above" },
                        { value: "below", label: "Below" },
                        { value: "left", label: "Left" },
                        { value: "right", label: "Right" },
                        { value: "above left", label: "Above left" },
                        { value: "above right", label: "Above right" },
                        { value: "below left", label: "Below left" },
                        { value: "below right", label: "Below right" }
                      ],
            sloped: element.pathAttachment.sloped
          };
        })()
      : null;

  if (inlineTarget.targetKind === "node-adornment" && inlineTarget.targetId) {
    const adornmentState = resolveAdornmentInspectorState(
      snapshot.source,
      inlineTarget.targetId,
      element.style,
      snapshot.parseOptions,
      resolveTarget
    );
    if (adornmentState) {
      const sections: InspectorSection[] = [
        {
          id: "adornment",
          title: adornmentState.kind === "pin" ? "Pin" : "Label",
          sourceLevel: "command",
          properties: [
            {
              kind: "text",
              id: "adornment-text",
              label: "Text",
              value: adornmentState.text,
              write: makeSetPropertyWriteTarget(inlineTarget, ADORNMENT_TEXT_PROPERTY_KEY)
            },
            {
              kind: "number",
              id: "adornment-angle",
              label: "Angle",
              value: adornmentState.angleDeg,
              step: 1,
              unit: "deg",
              write: makeSetPropertyWriteTarget(inlineTarget, ADORNMENT_ANGLE_PROPERTY_KEY)
            },
            {
              kind: "length",
              id: "adornment-distance",
              label: adornmentState.kind === "pin" ? "Pin distance" : "Label distance",
              value: adornmentState.distancePt,
              step: 0.1,
              unit: "pt",
              write: makeSetPropertyWriteTarget(inlineTarget, ADORNMENT_DISTANCE_PROPERTY_KEY)
            },
            {
              kind: "color",
              id: "adornment-text-color",
              label: "Text color",
              value: textColor,
              syntaxValue: textColorSyntax,
              options: colorOptionsForValue(textColor),
              write: makeSetPropertyWriteTarget(inlineTarget, "text")
            },
            {
              kind: "color",
              id: "adornment-draw-color",
              label: "Draw",
              value: strokeColor,
              syntaxValue: strokeColorSyntax,
              options: colorOptionsForValue(strokeColor),
              write: makeSetPropertyWriteTarget(inlineTarget, "draw")
            },
            {
              kind: "color",
              id: "adornment-fill-color",
              label: "Fill",
              value: fillColor,
              syntaxValue: fillColorSyntax,
              options: colorOptionsForValue(fillColor),
              write: makeSetPropertyWriteTarget(inlineTarget, "fill")
            }
          ]
        }
      ];

      if (adornmentState.kind === "pin") {
        sections.push({
          id: "pin-edge",
          title: "Pin Edge",
          sourceLevel: "command",
          properties: [
            {
              kind: "color",
              id: "pin-edge-color",
              label: "Color",
              value: adornmentState.pinEdge.draw,
              syntaxValue: adornmentState.pinEdge.draw,
              options: colorOptionsForValue(adornmentState.pinEdge.draw),
              write: makeSetPropertyWriteTarget(inlineTarget, PIN_EDGE_DRAW_PROPERTY_KEY)
            },
            {
              kind: "length",
              id: "pin-edge-line-width",
              label: "Line width",
              value: adornmentState.pinEdge.lineWidthPt,
              step: 0.1,
              unit: "pt",
              write: makeSetPropertyWriteTarget(inlineTarget, PIN_EDGE_LINE_WIDTH_PROPERTY_KEY)
            }
          ]
        });
      }

      return {
        elementKind: normalizeElementKind(element.kind),
        elementId: element.sourceRef.sourceId,
        writeTargetId: inlineTarget.targetId,
        readOnlyReason: inlineTarget.reason,
        infoNote: inlineTarget.infoNote,
        sections: applyForeachVariableReadOnlyToSections(sections, inlineTarget, resolveTarget)
      };
    }
  }

  const sections: InspectorSection[] = [
    {
      id: "transform",
      title: "Transform",
      sourceLevel: "command",
      properties: [
        {
          kind: "number",
          id: "xshift",
          label: "X shift",
          value: transformValues.xshift,
          step: 0.1,
          unit: "pt",
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "xshift", transformContext)
        },
        {
          kind: "number",
          id: "yshift",
          label: "Y shift",
          value: transformValues.yshift,
          step: 0.1,
          unit: "pt",
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "yshift", transformContext)
        },
        {
          kind: "number",
          id: "xscale",
          label: "X scale",
          value: transformValues.xscale,
          step: 0.1,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "xscale", transformContext)
        },
        {
          kind: "number",
          id: "yscale",
          label: "Y scale",
          value: transformValues.yscale,
          step: 0.1,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "yscale", transformContext)
        },
        {
          kind: "number",
          id: "rotate",
          label: "Rotate",
          value: transformValues.rotate,
          step: 1,
          unit: "deg",
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "rotate", transformContext)
        }
      ]
    },
    {
      id: "stroke",
      title: "Stroke",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "stroke-color",
          label: "Color",
          value: strokeColor,
          syntaxValue: strokeColorSyntax,
          options: colorOptionsForValue(strokeColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "draw")
        },
        {
          kind: "lineWidth",
          id: "line-width",
          label: "Line width",
          value: element.style.lineWidth,
          min: 0.1,
          max: 6,
          step: 0.1,
          presetLabel: lineWidthPresetLabel(element.style.lineWidth),
          write: makeSetPropertyWriteTarget(inlineTarget, "line width")
        },
        {
          kind: "dashStyle",
          id: "dash-style",
          label: "Dash style",
          value: dashStylePresetFromStyle(element.style.dashArray, element.style.lineWidth),
          options: DASH_STYLE_OPTIONS,
          previewLineWidth: element.style.lineWidth,
          write: makeSetPropertyWriteTarget(inlineTarget, "solid")
        }
      ]
    }
  ];
  if (nodeInspectorState) {
    const shapeAdaptiveProperties: InspectorProperty[] = nodeInspectorState.shapeAdaptiveControls.map((control) => {
      const write = makeSetPropertyWriteTarget(inlineTarget, control.writeKey);
      if (control.kind === "number") {
        return {
          kind: "number",
          id: control.id,
          label: control.label,
          value: control.value,
          step: control.step,
          min: control.min,
          max: control.max,
          unit: control.unit,
          clearKeys: control.clearKeys,
          write
        };
      }
      if (control.kind === "length") {
        return {
          kind: "length",
          id: control.id,
          label: control.label,
          value: control.value,
          step: control.step,
          unit: "pt",
          clearKeys: control.clearKeys,
          write
        };
      }
      if (control.kind === "enum") {
        return {
          kind: "enum",
          id: control.id,
          label: control.label,
          value: control.value,
          options: control.options,
          write
        };
      }
      return {
        kind: "boolean",
        id: control.id,
        label: control.label,
        value: control.value,
        trueValue: control.trueValue,
        falseValue: control.falseValue,
        clearKeys: control.clearKeys,
        write
      };
    });

    sections.splice(1, 0, {
      id: "node",
      title: "Node",
      sourceLevel: "command",
      properties: [
        {
          kind: "nodeShape",
          id: "node-shape",
          label: "Shape",
          value: nodeInspectorState.shape,
          options: NODE_SHAPE_OPTIONS,
          note: nodeInspectorState.shapeNote,
          write: makeSetPropertyWriteTarget(inlineTarget, NODE_SHAPE_KEY)
        },
        ...shapeAdaptiveProperties,
        {
          kind: "length",
          id: "node-inner-sep",
          label: "Inner sep",
          value: nodeInspectorState.innerSep,
          step: 0.1,
          unit: "pt",
          note: nodeInspectorState.innerSepNote,
          write: makeSetPropertyWriteTarget(inlineTarget, "inner sep")
        },
        {
          kind: "length",
          id: "node-minimum-width",
          label: "Minimum width",
          value: nodeInspectorState.minimumWidth,
          step: 0.1,
          unit: "pt",
          note: nodeInspectorState.minimumWidthNote,
          minimumDimensionsContext: {
            minimumWidth: nodeInspectorState.minimumWidth,
            minimumHeight: nodeInspectorState.minimumHeight
          },
          write: makeSetPropertyWriteTarget(inlineTarget, "minimum width")
        },
        {
          kind: "length",
          id: "node-minimum-height",
          label: "Minimum height",
          value: nodeInspectorState.minimumHeight,
          step: 0.1,
          unit: "pt",
          note: nodeInspectorState.minimumHeightNote,
          minimumDimensionsContext: {
            minimumWidth: nodeInspectorState.minimumWidth,
            minimumHeight: nodeInspectorState.minimumHeight
          },
          write: makeSetPropertyWriteTarget(inlineTarget, "minimum height")
        },
        {
          kind: "nodeTextAlign",
          id: "node-text-align",
          label: "Text align",
          value: nodeInspectorState.textAlign,
          clearKeys: ["align"],
          write: makeSetPropertyWriteTarget(inlineTarget, "align")
        },
        ...(nodeInspectorState.showTextWidth
          ? [
              {
                kind: "optionalLength" as const,
                id: "node-text-width",
                label: "Text width",
                value: nodeInspectorState.textWidth,
                step: 0.1,
                unit: "pt" as const,
                clearKeys: ["text width"],
                write: makeSetPropertyWriteTarget(inlineTarget, "text width")
              }
            ]
          : []),
        {
          kind: "nodeFont",
          id: "node-font",
          label: "Font",
          family: nodeInspectorState.font.family,
          weight: nodeInspectorState.font.weight,
          style: nodeInspectorState.font.style,
          sizePreset: nodeInspectorState.font.sizePreset,
          customSizePt: nodeInspectorState.font.customSizePt,
          sizeOptions: NODE_FONT_SIZE_PRESETS.map((preset) => ({
            value: preset.value,
            label: preset.label
          })),
          context: nodeInspectorState.font.context,
          note: nodeInspectorState.font.note,
          write: makeSetPropertyWriteTarget(inlineTarget, nodeInspectorState.font.context.key)
        },
        {
          kind: "color",
          id: "node-text-color",
          label: "Text color",
          value: textColor,
          syntaxValue: textColorSyntax,
          options: colorOptionsForValue(textColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "text")
        }
      ]
    });
  }
  if (pathAttachedNodeInspectorState) {
    const positionTicks = PATH_POSITION_PRESETS.map((preset) => ({ value: preset.t, label: preset.label }));
    const matchedPreset = PATH_POSITION_PRESETS.find(
      (preset) => preset.key === pathAttachedNodeInspectorState.positionPreset
    );
    const positionDisplayLabel = matchedPreset
      ? matchedPreset.label
      : pathAttachedNodeInspectorState.customPosition.toFixed(2);
    sections.splice(2, 0, {
      id: "path-attached-node",
      title: "Attachment",
      sourceLevel: "command",
      properties: [
        {
          kind: "slider",
          id: "path-attached-node-position",
          label: "Position",
          value: pathAttachedNodeInspectorState.customPosition,
          min: 0,
          max: 1,
          step: 0.01,
          ticks: positionTicks,
          displayLabel: positionDisplayLabel,
          write: makeSetPropertyWriteTarget(inlineTarget, PATH_ATTACHED_NODE_POSITION_VALUE_KEY)
        },
        ...(pathAttachedNodeInspectorState.sideLabel && pathAttachedNodeInspectorState.sideValue
          ? [
              {
                kind: "enum" as const,
                id: "path-attached-node-side",
                label: pathAttachedNodeInspectorState.sideLabel,
                value: pathAttachedNodeInspectorState.sideValue,
                options: pathAttachedNodeInspectorState.sideOptions,
                write: makeSetPropertyWriteTarget(inlineTarget, PATH_ATTACHED_NODE_SIDE_KEY)
              }
            ]
          : []),
        {
          kind: "boolean",
          id: "path-attached-node-sloped",
          label: "Sloped",
          value: pathAttachedNodeInspectorState.sloped,
          clearKeys: ["sloped"],
          write: makeSetPropertyWriteTarget(inlineTarget, "sloped")
        }
      ]
    });
  }
  if (pathFillVisibility) {
    const fillProperties: InspectorProperty[] = [
      {
        kind: "color",
        id: "fill-color",
        label: "Color",
        value: fillColor,
        syntaxValue: fillColorSyntax,
        options: colorOptionsForValue(fillColor),
        write: makeSetPropertyWriteTarget(inlineTarget, "fill")
      },
      {
        kind: "fillMode",
        id: "fill-mode",
        label: "Mode",
        value: fillPaintState.mode,
        options: FILL_MODE_OPTIONS,
        context: {
          fillColor: fillColorSyntax ?? fillColor,
          patternColor: patternColorSyntax ?? patternColor,
          shading: fillPaintState.shading,
          pattern: fillPaintState.pattern
        },
        write: makeSetPropertyWriteTarget(inlineTarget, "fill")
      }
    ];

    if (fillPaintState.mode === "gradient") {
      fillProperties.push({
        kind: "fillShading",
        id: "fill-shading",
        label: "Shading",
        value: fillPaintState.shading,
        options: FILL_SHADING_OPTIONS,
        note: fillPaintState.shading === "custom" ? FILL_STYLE_CUSTOM_NOTE : undefined,
        write: makeSetPropertyWriteTarget(inlineTarget, "shading")
      });

      if (fillPaintState.shading === "axis") {
        const topColor = normalizeInspectorColorValue(element.style.axisTopColor);
        const topColorSyntax = resolveColorSyntaxValue(
          resolvedInlineTarget,
          ["top color", "left color"],
          topColor,
          colorAliases,
          element.styleChain
        );
        const bottomColor = normalizeInspectorColorValue(element.style.axisBottomColor);
        const bottomColorSyntax = resolveColorSyntaxValue(
          resolvedInlineTarget,
          ["bottom color", "right color"],
          bottomColor,
          colorAliases,
          element.styleChain
        );
        fillProperties.push({
          kind: "color",
          id: "fill-axis-top-color",
          label: "Start color",
          value: topColor,
          syntaxValue: topColorSyntax,
          options: colorOptionsForValue(topColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "top color")
        });
        fillProperties.push({
          kind: "color",
          id: "fill-axis-bottom-color",
          label: "End color",
          value: bottomColor,
          syntaxValue: bottomColorSyntax,
          options: colorOptionsForValue(bottomColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "bottom color")
        });
        fillProperties.push({
          kind: "number",
          id: "fill-shading-angle",
          label: "Angle",
          value: element.style.shadingAngle,
          step: 1,
          unit: "deg",
          write: makeSetPropertyWriteTarget(inlineTarget, "shading angle")
        });
      } else if (fillPaintState.shading === "radial") {
        const innerColor = normalizeInspectorColorValue(element.style.radialInnerColor);
        const innerColorSyntax = resolveColorSyntaxValue(
          resolvedInlineTarget,
          ["inner color"],
          innerColor,
          colorAliases,
          element.styleChain
        );
        const outerColor = normalizeInspectorColorValue(element.style.radialOuterColor);
        const outerColorSyntax = resolveColorSyntaxValue(
          resolvedInlineTarget,
          ["outer color"],
          outerColor,
          colorAliases,
          element.styleChain
        );
        fillProperties.push({
          kind: "color",
          id: "fill-radial-inner-color",
          label: "Inner color",
          value: innerColor,
          syntaxValue: innerColorSyntax,
          options: colorOptionsForValue(innerColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "inner color")
        });
        fillProperties.push({
          kind: "color",
          id: "fill-radial-outer-color",
          label: "Outer color",
          value: outerColor,
          syntaxValue: outerColorSyntax,
          options: colorOptionsForValue(outerColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "outer color")
        });
      } else if (fillPaintState.shading === "ball") {
        const ballColor = normalizeInspectorColorValue(element.style.ballColor);
        const ballColorSyntax = resolveColorSyntaxValue(
          resolvedInlineTarget,
          ["ball color"],
          ballColor,
          colorAliases,
          element.styleChain
        );
        fillProperties.push({
          kind: "color",
          id: "fill-ball-color",
          label: "Ball color",
          value: ballColor,
          syntaxValue: ballColorSyntax,
          options: colorOptionsForValue(ballColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "ball color")
        });
      }
    } else if (fillPaintState.mode === "pattern") {
      fillProperties.push({
        kind: "fillPattern",
        id: "fill-pattern",
        label: "Pattern",
        value: fillPaintState.pattern,
        options: FILL_PATTERN_OPTIONS,
        note: fillPaintState.pattern === "custom" ? FILL_STYLE_CUSTOM_NOTE : undefined,
        write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
      });
      fillProperties.push({
        kind: "color",
        id: "fill-pattern-color",
        label: "Pattern color",
        value: patternColor,
        syntaxValue: patternColorSyntax,
        options: colorOptionsForValue(patternColor),
        write: makeSetPropertyWriteTarget(inlineTarget, "pattern color")
      });

      const fillPatternOptionContext = resolveFillPatternOptionMutationContext(
        element.style.fillPattern,
        fillPaintState.pattern,
        element.style.lineWidth
      );
      if (fillPatternOptionContext) {
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-angle",
          label: "Angle",
          option: "angle",
          value: fillPatternOptionContext.values.angle,
          step: 1,
          unit: "deg",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-distance",
          label: "Distance",
          option: "distance",
          value: fillPatternOptionContext.values.distance,
          step: 0.1,
          unit: "pt",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-xshift",
          label: "X shift",
          option: "xshift",
          value: fillPatternOptionContext.values.xshift,
          step: 0.1,
          unit: "pt",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });
        fillProperties.push({
          kind: "fillPatternOption",
          id: "fill-pattern-yshift",
          label: "Y shift",
          option: "yshift",
          value: fillPatternOptionContext.values.yshift,
          step: 0.1,
          unit: "pt",
          context: fillPatternOptionContext,
          write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
        });

        if (fillPatternOptionContext.family === "Lines" || fillPatternOptionContext.family === "Hatch") {
          fillProperties.push({
            kind: "fillPatternOption",
            id: "fill-pattern-line-width",
            label: "Line width",
            option: "line width",
            value: fillPatternOptionContext.values.lineWidth,
            step: 0.1,
            unit: "pt",
            context: fillPatternOptionContext,
            write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
          });
        }

        if (fillPatternOptionContext.family === "Dots" || fillPatternOptionContext.family === "Stars") {
          fillProperties.push({
            kind: "fillPatternOption",
            id: "fill-pattern-radius",
            label: "Radius",
            option: "radius",
            value: fillPatternOptionContext.values.radius,
            step: 0.1,
            unit: "pt",
            context: fillPatternOptionContext,
            write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
          });
        }

        if (fillPatternOptionContext.family === "Stars") {
          fillProperties.push({
            kind: "fillPatternOption",
            id: "fill-pattern-points",
            label: "Points",
            option: "points",
            value: fillPatternOptionContext.values.points,
            step: 1,
            context: fillPatternOptionContext,
            write: makeSetPropertyWriteTarget(inlineTarget, "pattern")
          });
        }
      }
    }

    fillProperties.push({
      kind: "number",
      id: "fill-opacity",
      label: "Opacity",
      value: element.style.fillOpacity,
      step: 0.05,
      min: 0,
      max: 1,
      write: makeSetPropertyWriteTarget(inlineTarget, "fill opacity")
    });
    sections.push({
      id: "fill",
      title: "Fill",
      sourceLevel: "command",
      properties: fillProperties
    });
  }

  const strokeSection = sections.find((section) => section.id === "stroke");
  if (strokeSection && pathStrokeVisibility) {
    if (pathStrokeVisibility.showLineCap) {
      strokeSection.properties.push({
        kind: "lineCap",
        id: "line-cap",
        label: "Line cap",
        value: lineCapPresetFromStyle(element.style.lineCap),
        options: LINE_CAP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: makeSetPropertyWriteTarget(inlineTarget, "line cap")
      });
    }
    if (pathStrokeVisibility.showLineJoin) {
      strokeSection.properties.push({
        kind: "lineJoin",
        id: "line-join",
        label: "Line join",
        value: lineJoinPresetFromStyle(element.style.lineJoin),
        options: LINE_JOIN_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: makeSetPropertyWriteTarget(inlineTarget, "line join")
      });
    }
    strokeSection.properties.push({
      kind: "number",
      id: "stroke-opacity",
      label: "Opacity",
      value: element.style.strokeOpacity,
      step: 0.05,
      min: 0,
      max: 1,
      write: makeSetPropertyWriteTarget(inlineTarget, "draw opacity")
    });
  }

  if (element.kind === "Path") {
    const roundedCornersSourceCommands = element.undecoratedCommands ?? element.commands;
    const roundedCornersEnabled = element.style.roundedCorners != null && element.style.roundedCorners > 0;
    const pathHasCornerThatCanBeRounded = pathHasRoundableCorner(roundedCornersSourceCommands);
    const roundedCornersMax = normalizeRoundedCornersMax(computePathRoundedCornersMax(roundedCornersSourceCommands));
    const roundedCornersDefaultRadius = clampRoundedCornersRadius(ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax);
    const roundedCornersRadius = roundedCornersEnabled
      ? clampRoundedCornersRadius(element.style.roundedCorners ?? ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax)
      : roundedCornersDefaultRadius;
    const roundedCornersDisableRequiresSharpCorners = resolveRoundedCornersDisableRequiresSharpCorners(
      element,
      inlineTarget.targetId
    );
    const gridInspectorState = resolveGridInspectorState(element, snapshot.source, snapshot.parseOptions);
    const pathMorphingPreset = resolvePathMorphingDecorationPreset(
      snapshot.source,
      inlineTarget.targetId,
      element.style.decoration,
      snapshot.parseOptions,
      resolveTarget
    );
    const pathMorphingSuboptions = resolvePathMorphingDecorationSuboptionProperties(
      pathMorphingPreset,
      element.style.decoration,
      inlineTarget
    );
    const pathSection: InspectorSection = {
      id: "path",
      title: "Path",
      sourceLevel: "command",
      properties: [
        {
          kind: "pathMorphingDecoration",
          id: "path-morphing-decoration",
          label: "Path morphing",
          value: pathMorphingPreset,
          options: PATH_MORPHING_DECORATION_OPTIONS,
          previewLineWidth: element.style.lineWidth,
          write: makeSetPropertyWriteTarget(inlineTarget, "decorate")
        },
        ...pathMorphingSuboptions
      ]
    };

    if (pathStrokeVisibility?.showLineJoin && (pathHasCornerThatCanBeRounded || roundedCornersEnabled)) {
      pathSection.properties.push({
        kind: "roundedCorners",
        id: "rounded-corners",
        label: "Rounded corners",
        enabled: roundedCornersEnabled,
        disableRequiresSharpCorners: roundedCornersDisableRequiresSharpCorners,
        radius: roundedCornersRadius,
        defaultRadius: roundedCornersDefaultRadius,
        min: ROUNDED_CORNERS_MIN,
        max: roundedCornersMax,
        step: 0.1,
        write: makeSetPropertyWriteTarget(inlineTarget, "rounded corners")
      });
    }

    if (pathSupportsArrowTipEditing(element.commands)) {
      const arrowWrite = makeArrowTipWriteTarget(inlineTarget, element, snapshot.source, snapshot.parseOptions);
      pathSection.properties.push({
        kind: "arrowTip",
        id: "arrow-tip-start",
        label: "Begin arrow type",
        side: "start",
        value: arrowPresetFromMarker(element.style.markerStart),
        options: ARROW_TIP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: arrowWrite
      });
      pathSection.properties.push({
        kind: "arrowTip",
        id: "arrow-tip-end",
        label: "End arrow type",
        side: "end",
        value: arrowPresetFromMarker(element.style.markerEnd),
        options: ARROW_TIP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: arrowWrite
      });
    }

    sections.splice(2, 0, pathSection);

    if (gridInspectorState) {
      const gridWriteTarget = makeSetPropertyWriteTargetForElementId(inlineTarget, gridInspectorState.keywordId, "step");
      const gridSection: InspectorSection = {
        id: "grid",
        title: "Grid",
        sourceLevel: "command",
        properties: [
          {
            kind: "number",
            id: "grid-step",
            label: "Step",
            value: gridInspectorState.step,
            step: 0.1,
            unit: "cm",
            clearKeys: uniqueStrings(GRID_STEP_CLEAR_KEYS),
            write: gridWriteTarget
          },
          {
            kind: "number",
            id: "grid-xstep",
            label: "X step",
            value: gridInspectorState.xstep,
            step: 0.1,
            unit: "cm",
            clearKeys: uniqueStrings(GRID_XSTEP_CLEAR_KEYS),
            write: makeSetPropertyWriteTargetForElementId(inlineTarget, gridInspectorState.keywordId, "xstep")
          },
          {
            kind: "number",
            id: "grid-ystep",
            label: "Y step",
            value: gridInspectorState.ystep,
            step: 0.1,
            unit: "cm",
            clearKeys: uniqueStrings(GRID_YSTEP_CLEAR_KEYS),
            write: makeSetPropertyWriteTargetForElementId(inlineTarget, gridInspectorState.keywordId, "ystep")
          }
        ]
      };

      const strokeSectionIndex = sections.findIndex((section) => section.id === "stroke");
      if (strokeSectionIndex >= 0) {
        sections.splice(strokeSectionIndex, 0, gridSection);
      } else {
        sections.push(gridSection);
      }
    }
  }

  if (element.kind === "Text" && !nodeInspectorState) {
    sections.push({
      id: "text",
      title: "Text",
      sourceLevel: "command",
      properties: [
        {
          kind: "color",
          id: "text-color",
          label: "Color",
          value: textColor,
          syntaxValue: textColorSyntax,
          options: colorOptionsForValue(textColor),
          write: makeSetPropertyWriteTarget(inlineTarget, "text")
        }
      ]
    });
  }

  // Shadow section
  {
    const shadowLayer = element.style.shadowLayers[0] ?? null;
    const shadowPreset = resolveShadowPreset(
      snapshot.source,
      inlineTarget.targetId,
      snapshot.parseOptions,
      resolveTarget
    );
    const shadowOverrides = resolveShadowOptionOverrides(
      snapshot.source,
      inlineTarget.targetId,
      snapshot.parseOptions,
      resolveTarget
    );
    const defaults = SHADOW_PRESET_DEFAULTS[shadowPreset !== "none" ? shadowPreset : "drop-shadow"];
    const shadowColor =
      shadowOverrides.color != null
        ? resolveShadowOverrideColorValue(shadowOverrides.color, defaults.color)
        : resolveShadowInspectorColorValue(shadowLayer?.style.fill ?? defaults.color, defaults.color, colorAliases);

    const shadowContext: ShadowMutationContext = {
      preset: shadowPreset,
      xshiftPt: shadowOverrides.xshiftPt ?? shadowLayer?.xshift ?? defaults.xshiftPt,
      yshiftPt: shadowOverrides.yshiftPt ?? shadowLayer?.yshift ?? defaults.yshiftPt,
      scale: shadowOverrides.scale ?? shadowLayer?.scale ?? defaults.scale,
      opacity:
        shadowOverrides.opacity ??
        shadowLayer?.style.fillOpacity ??
        shadowLayer?.style.strokeOpacity ??
        defaults.opacity ??
        1,
      color: shadowColor
    };

    const shadowWrite = (): SetPropertyWriteTarget => ({
      ...makeSetPropertyWriteTarget(inlineTarget, "drop shadow"),
      shadowContext
    });

    const shadowProperties: InspectorProperty[] = [
      {
        kind: "shadowPreset",
        id: "shadow-preset",
        label: "Shadow",
        value: shadowPreset,
        options: SHADOW_PRESET_OPTIONS,
        context: shadowContext,
        write: makeSetPropertyWriteTarget(inlineTarget, "drop shadow")
      }
    ];

    if (shadowPreset !== "none") {
      shadowProperties.push(
        {
          kind: "length",
          id: "shadow-xshift",
          label: "X offset",
          value: shadowContext.xshiftPt,
          step: 1,
          unit: "pt",
          write: shadowWrite()
        },
        {
          kind: "length",
          id: "shadow-yshift",
          label: "Y offset",
          value: shadowContext.yshiftPt,
          step: 1,
          unit: "pt",
          write: shadowWrite()
        },
        {
          kind: "number",
          id: "shadow-scale",
          label: "Scale",
          value: shadowContext.scale,
          step: 0.05,
          write: shadowWrite()
        }
      );
      shadowProperties.push({
        kind: "number",
        id: "shadow-opacity",
        label: "Opacity",
        value: shadowContext.opacity,
        step: 0.05,
        min: 0,
        max: 1,
        write: shadowWrite()
      });
      if (defaults.color !== null) {
        shadowProperties.push({
          kind: "color",
          id: "shadow-color",
          label: "Color",
          value: shadowContext.color,
          syntaxValue: shadowContext.color,
          options: colorOptionsForValue(shadowContext.color),
          write: shadowWrite()
        });
      }
    }

    sections.push({
      id: "shadow",
      title: "Shadow",
      sourceLevel: "command",
      properties: shadowProperties
    });
  }

  if (inlineTarget.targetKind === "tree-child" || inlineTarget.targetKind === "matrix-cell") {
    const transformSectionIndex = sections.findIndex((section) => section.id === "transform");
    if (transformSectionIndex >= 0) {
      sections.splice(transformSectionIndex, 1);
    }
  }

  return {
    elementKind: normalizeElementKind(element.kind),
    elementId: element.sourceRef.sourceId,
    writeTargetId: inlineTarget.targetId,
    readOnlyReason: inlineTarget.reason,
    infoNote: inlineTarget.infoNote,
    sections: applyForeachVariableReadOnlyToSections(sections, inlineTarget, resolveTarget)
  };
}

function makeSetPropertyWriteTarget(
  inlineTarget: InlineWriteTarget,
  key: string
): SetPropertyWriteTarget {
  return makeSetPropertyWriteTargetForElementId(inlineTarget, inlineTarget.targetId, key);
}

function makeSetPropertyWriteTargetForElementId(
  inlineTarget: InlineWriteTarget,
  elementId: string | null,
  key: string
): SetPropertyWriteTarget {
  const normalizedKey = normalizeOptionKey(key);
  const treeChildWritable =
    inlineTarget.targetKind !== "tree-child"
    || !TREE_CHILD_NODE_READONLY_KEYS.has(normalizedKey);
  const writable = inlineTarget.writable && elementId != null && treeChildWritable;
  const reason =
    !treeChildWritable
      ? "This tree-child property is read-only."
      : inlineTarget.reason;
  return {
    mode: "setProperty",
    elementId: elementId ?? "",
    level: "command",
    key,
    writable,
    reason
  };
}

function makeTransformSetPropertyWriteTarget(
  inlineTarget: InlineWriteTarget,
  key: TransformInspectorKey,
  context: TransformInspectorMutationContext
): SetPropertyWriteTarget {
  return {
    ...makeSetPropertyWriteTarget(inlineTarget, key),
    transformContext: {
      key,
      values: cloneTransformInspectorValues(context.values),
      presence: context.presence ? { ...context.presence } : undefined
    }
  };
}

function makeArrowTipWriteTarget(
  inlineTarget: InlineWriteTarget,
  element: Extract<SceneElement, { kind: "Path" }>,
  source: string,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): ArrowTipWriteTarget {
  return {
    ...makeSetPropertyWriteTarget(inlineTarget, ARROW_OPTION_KEY),
    arrowContext: resolveArrowWriteContext(source, inlineTarget.targetId, element, parseOptions, resolveTarget)
  };
}

function collectForeachVariableNames(
  foreachStack: ReadonlyArray<{ bindings: Record<string, string> }>
): string[] {
  const names = new Set<string>();
  for (const frame of foreachStack) {
    for (const name of Object.keys(frame.bindings)) {
      const normalized = name.trim();
      if (normalized.length > 0) {
        names.add(normalized);
      }
    }
  }
  return [...names];
}

function applyForeachVariableReadOnlyToSections(
  sections: InspectorSection[],
  inlineTarget: InlineWriteTarget,
  resolveTarget: InspectorTargetResolver
): InspectorSection[] {
  if (
    inlineTarget.targetKind !== "foreach-template"
    || !inlineTarget.targetId
    || (inlineTarget.foreachVariableNames?.length ?? 0) === 0
  ) {
    return sections;
  }

  const resolved = resolveTarget(inlineTarget.targetId);
  const options = resolved.kind === "found" ? resolved.target.options : undefined;
  if (!options || options.entries.length === 0) {
    return sections;
  }

  return sections.map((section) => ({
    ...section,
    properties: section.properties.map((property) =>
      inspectorPropertyDependsOnForeachVariables(property, options, inlineTarget.foreachVariableNames ?? [])
        ? makeInspectorPropertyForeachReadOnly(property)
        : property
    )
  }));
}

function makeInspectorPropertyForeachReadOnly(property: InspectorProperty): InspectorProperty {
  return {
    ...(property as InspectorProperty & { readOnlyReason?: string }),
    write: {
      ...property.write,
      writable: false,
      reason: FOREACH_VARIABLE_READONLY_REASON
    },
    readOnlyReason: FOREACH_VARIABLE_READONLY_REASON
  } as InspectorProperty;
}

function inspectorPropertyDependsOnForeachVariables(
  property: InspectorProperty,
  options: OptionListAst,
  foreachVariableNames: readonly string[]
): boolean {
  const candidateKeys = inspectorPropertyCandidateKeys(property);
  if (candidateKeys.length === 0 || foreachVariableNames.length === 0) {
    return false;
  }
  const normalizedKeys = new Set(
    candidateKeys
      .map((key) => normalizeOptionKey(key))
      .filter((key) => key.length > 0)
  );
  if (normalizedKeys.size === 0) {
    return false;
  }
  const foreachVariableSet = new Set(foreachVariableNames);
  return options.entries.some((entry) => {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      return false;
    }
    if (!normalizedKeys.has(normalizeOptionKey(entry.key))) {
      return false;
    }
    return optionEntryContainsForeachVariable(entry.raw, foreachVariableSet);
  });
}

function inspectorPropertyCandidateKeys(property: InspectorProperty): string[] {
  switch (property.kind) {
    case "dashStyle":
      return [...DASH_STYLE_PRESET_CLEAR_KEYS];
    case "lineCap":
    case "lineJoin":
      return [property.write.key];
    case "pathMorphingDecoration":
      return [...PATH_MORPHING_DECORATION_CLEAR_KEYS];
    case "fillMode":
      return uniqueStrings(["fill", ...FILL_PATTERN_CLEAR_KEYS, ...FILL_SHADING_CLEAR_KEYS]);
    case "fillShading":
      return uniqueStrings([
        "shade",
        "shading",
        ...AXIS_SHADING_CONFLICT_CLEAR_KEYS,
        ...RADIAL_SHADING_CONFLICT_CLEAR_KEYS,
        ...BALL_SHADING_CONFLICT_CLEAR_KEYS
      ]);
    case "fillPattern":
    case "fillPatternOption":
      return ["pattern"];
    case "roundedCorners":
      return [...ROUNDED_CORNERS_CLEAR_KEYS];
    case "nodeShape":
      return [...NODE_SHAPE_KNOWN_KEYS];
    case "nodeFont":
      return uniqueStrings([property.context.key, ...property.context.clearKeys]);
    case "nodeTextAlign":
      return uniqueStrings([property.write.key, ...(property.clearKeys ?? [])]);
    case "arrowTip":
      return uniqueStrings([...ARROW_DEFAULT_CLEAR_KEYS, ...property.write.arrowContext.clearKeys]);
    case "shadowPreset":
      return [...SHADOW_ALL_KEYS];
    case "number": {
      const write = property.write as SetPropertyWriteTarget;
      if (write.transformContext) {
        return transformPropertyCandidateKeys(write.transformContext.key);
      }
      return uniqueStrings([write.key, ...("clearKeys" in property && property.clearKeys ? property.clearKeys : [])]);
    }
    case "length":
    case "optionalLength":
    case "boolean":
      return uniqueStrings([property.write.key, ...("clearKeys" in property && property.clearKeys ? property.clearKeys : [])]);
    case "text":
    case "enum":
    case "color":
    case "lineWidth":
      return [property.write.key];
  }
  return [];
}

function transformPropertyCandidateKeys(key: TransformInspectorKey): string[] {
  if (key === "xshift" || key === "yshift") {
    return uniqueStrings([key, ...SHIFT_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS[key]]);
  }
  if (key === "xscale" || key === "yscale") {
    return uniqueStrings([key, ...SCALE_CLEAR_KEYS, ...TRANSFORM_KEY_ALIAS_CLEAR_KEYS[key]]);
  }
  return uniqueStrings([key, ...ROTATE_CLEAR_KEYS]);
}

function optionEntryContainsForeachVariable(raw: string, foreachVariableSet: ReadonlySet<string>): boolean {
  const controlSequences = raw.match(/\\(?:[A-Za-z@]+|.)/gu) ?? [];
  return controlSequences.some((token) => foreachVariableSet.has(token));
}

function resolveArrowWriteContext(
  source: string,
  targetId: string | null,
  element: Extract<SceneElement, { kind: "Path" }>,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): ArrowTipWriteContext {
  const clearKeySet = new Set<string>(ARROW_DEFAULT_CLEAR_KEYS);
  let startRaw = arrowMarkerFallbackRaw(element.style.markerStart, "start");
  let endRaw = arrowMarkerFallbackRaw(element.style.markerEnd, "end");

  if (!targetId) {
    return {
      startRaw,
      endRaw,
      clearKeys: [...clearKeySet]
    };
  }

  const resolved = resolveTarget(targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return {
      startRaw,
      endRaw,
      clearKeys: [...clearKeySet]
    };
  }

  let lastParsed: { startRaw: string; endRaw: string } | null = null;
  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "kv") {
      const entryKey = normalizeOptionKey(entry.key);
      if (entryKey !== ARROW_OPTION_KEY) {
        continue;
      }
      clearKeySet.add(entryKey);
      const parsed = splitArrowSpecificationRaw(entry.valueRaw);
      if (parsed) {
        lastParsed = parsed;
      }
      continue;
    }

    if (entry.kind !== "flag") {
      continue;
    }

    const parsed = splitArrowSpecificationRaw(entry.raw);
    if (!parsed) {
      continue;
    }
    clearKeySet.add(normalizeOptionKey(entry.key));
    lastParsed = parsed;
  }

  if (lastParsed) {
    startRaw = lastParsed.startRaw;
    endRaw = lastParsed.endRaw;
  }

  return {
    startRaw,
    endRaw,
    clearKeys: [...clearKeySet]
  };
}

function splitArrowSpecificationRaw(raw: string): { startRaw: string; endRaw: string } | null {
  const normalized = stripEnclosingBraces(raw.trim());
  const splitIndex = findTopLevelCharacter(normalized, "-");
  if (splitIndex < 0) {
    return null;
  }

  return {
    startRaw: normalized.slice(0, splitIndex).trim(),
    endRaw: normalized.slice(splitIndex + 1).trim()
  };
}

function resolveFillPaintState(
  source: string,
  targetId: string | null,
  style: {
    shadeEnabled: boolean;
    shading: string;
    fillPattern: ResolvedPattern | null;
  },
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): { mode: FillModePresetId; shading: FillShadingPresetId; pattern: FillPatternPresetId } {
  const fallbackShading = style.shadeEnabled ? fillShadingPresetFromStyleName(style.shading) : "axis";
  const fallbackPattern = fillPatternPresetFromResolvedPattern(style.fillPattern);

  let patternActive = style.fillPattern != null;
  let shadingActive = style.shadeEnabled;
  let shading: FillShadingPresetId = fallbackShading;
  let pattern: FillPatternPresetId = fallbackPattern;
  let sawPatternOption = false;
  let sawShadingOption = false;

  if (targetId) {
    const resolved = resolveTarget(targetId);
    if (resolved.kind !== "not-found" && resolved.target.options) {
      for (const entry of resolved.target.options.entries) {
        if (entry.kind === "flag") {
          const key = normalizeOptionKey(entry.key);
          if (key === "pattern" || key === "/tikz/pattern") {
            patternActive = true;
            sawPatternOption = true;
            if (pattern === "custom") {
              pattern = "dots";
            }
            continue;
          }
          if (key === "shade" || key === "/tikz/shade") {
            shadingActive = true;
            sawShadingOption = true;
            continue;
          }
          continue;
        }

        if (entry.kind !== "kv") {
          continue;
        }

        const key = normalizeOptionKey(entry.key);
        if (key === "pattern" || key === "/tikz/pattern") {
          sawPatternOption = true;
          const normalizedPatternValue = stripEnclosingBraces(entry.valueRaw).trim().toLowerCase();
          if (normalizedPatternValue === "none") {
            patternActive = false;
            continue;
          }
          patternActive = true;
          pattern = fillPatternPresetFromRaw(entry.valueRaw);
          continue;
        }

        if (key === "shade" || key === "/tikz/shade") {
          const parsedShade = parseInspectorBoolean(entry.valueRaw);
          if (parsedShade != null) {
            sawShadingOption = true;
            shadingActive = parsedShade;
          }
          continue;
        }

        if (key === "shading" || key === "/tikz/shading") {
          sawShadingOption = true;
          shadingActive = true;
          shading = fillShadingPresetFromStyleName(entry.valueRaw);
          continue;
        }

        if (!SHADING_ACTIVATION_KEYS.has(key)) {
          continue;
        }

        sawShadingOption = true;
        shadingActive = true;
        const inferred = fillShadingPresetFromActivationKey(key);
        if (inferred) {
          shading = inferred;
        }
      }
    }
  }

  if (sawPatternOption && patternActive && pattern === "custom") {
    return { mode: "pattern", shading, pattern };
  }
  if (sawPatternOption && patternActive) {
    return { mode: "pattern", shading, pattern: pattern === "custom" ? "dots" : pattern };
  }
  if (patternActive) {
    return { mode: "pattern", shading, pattern };
  }
  if (sawShadingOption && shadingActive) {
    return { mode: "gradient", shading, pattern };
  }
  if (shadingActive) {
    return { mode: "gradient", shading, pattern };
  }
  return { mode: "solid", shading, pattern };
}

export function fillShadingPresetFromStyleName(raw: string): FillShadingPresetId {
  const normalized = stripEnclosingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "axis") {
    return "axis";
  }
  if (normalized === "radial") {
    return "radial";
  }
  if (normalized === "ball") {
    return "ball";
  }
  return "custom";
}

export function fillPatternPresetFromResolvedPattern(pattern: ResolvedPattern | null): FillPatternPresetId {
  if (!pattern) {
    return "dots";
  }
  if (pattern.kind === "legacy") {
    const resolved = FILL_PATTERN_PRESET_BY_LOWER.get(pattern.name.toLowerCase());
    return resolved ?? "custom";
  }
  return META_FILL_PATTERN_PRESET_BY_KIND[pattern.kind] ?? "custom";
}

export function fillPatternPresetFromRaw(raw: string): FillPatternPresetId {
  const name = extractPatternName(raw);
  if (!name) {
    return "dots";
  }
  const metaMatch = META_FILL_PATTERN_PRESET_BY_LOWER.get(name.toLowerCase()) ?? null;
  if (metaMatch) {
    return metaMatch;
  }
  const match = FILL_PATTERN_PRESET_BY_LOWER.get(name.toLowerCase());
  return match ?? "custom";
}

function resolveFillPatternOptionMutationContext(
  pattern: ResolvedPattern | null,
  fallbackPatternPreset: FillPatternPresetId,
  fallbackLineWidth: number
): FillPatternOptionMutationContext | null {
  if (pattern?.kind === "meta-lines") {
    return {
      family: "Lines",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: pattern.lineWidth,
        radius: DEFAULT_META_PATTERN_RADIUS,
        points: 5
      }
    };
  }
  if (pattern?.kind === "meta-hatch") {
    return {
      family: "Hatch",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: pattern.lineWidth,
        radius: DEFAULT_META_PATTERN_RADIUS,
        points: 5
      }
    };
  }
  if (pattern?.kind === "meta-dots") {
    return {
      family: "Dots",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
        radius: pattern.radius,
        points: 5
      }
    };
  }
  if (pattern?.kind === "meta-stars") {
    return {
      family: "Stars",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
        radius: pattern.radius,
        points: pattern.points
      }
    };
  }

  const fallbackFamily = fillPatternMetaFamilyFromPreset(fallbackPatternPreset);
  if (!fallbackFamily) {
    return null;
  }
  return {
    family: fallbackFamily,
    values: defaultFillPatternMetaValues(fallbackFamily, fallbackLineWidth)
  };
}

function extractPatternName(raw: string): string | null {
  const normalized = stripEnclosingBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const bracketIndex = findTopLevelOpenBracket(normalized);
  const name = bracketIndex >= 0 ? normalized.slice(0, bracketIndex).trim() : normalized;
  return name.length > 0 ? name : null;
}

function findTopLevelOpenBracket(input: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        return index;
      }
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
  }

  return -1;
}

function parseInspectorBoolean(raw: string): boolean | null {
  return parseBooleanishNormalized(stripEnclosingBraces(raw), {
    allowOnOff: true,
    allowNoneAsFalse: true,
    empty: true
  });
}

function fillShadingPresetFromActivationKey(key: string): FillShadingPresetId | null {
  if (
    key === "inner color" ||
    key === "/tikz/inner color" ||
    key === "outer color" ||
    key === "/tikz/outer color"
  ) {
    return "radial";
  }
  if (key === "ball color" || key === "/tikz/ball color") {
    return "ball";
  }
  if (
    key === "lower left" ||
    key === "/tikz/lower left" ||
    key === "lower right" ||
    key === "/tikz/lower right" ||
    key === "upper left" ||
    key === "/tikz/upper left" ||
    key === "upper right" ||
    key === "/tikz/upper right"
  ) {
    return "custom";
  }
  if (
    key === "top color" ||
    key === "/tikz/top color" ||
    key === "middle color" ||
    key === "/tikz/middle color" ||
    key === "bottom color" ||
    key === "/tikz/bottom color" ||
    key === "left color" ||
    key === "/tikz/left color" ||
    key === "right color" ||
    key === "/tikz/right color" ||
    key === "shading angle" ||
    key === "/tikz/shading angle"
  ) {
    return "axis";
  }
  return null;
}

function normalizeFillMutationColor(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function selectCuratedShadingPreset(value: FillShadingPresetId | undefined): Exclude<FillShadingPresetId, "custom"> {
  return value === "axis" || value === "radial" || value === "ball" ? value : "axis";
}

function selectCuratedPatternPreset(value: FillPatternPresetId | undefined): Exclude<FillPatternPresetId, "custom"> {
  return value && value !== "custom" ? value : "dots";
}

function fillPatternMetaFamilyFromPreset(preset: FillPatternPresetId): FillPatternMetaFamilyId | null {
  if (preset === "Lines" || preset === "Hatch" || preset === "Dots" || preset === "Stars") {
    return preset;
  }
  return null;
}

function fillPatternMetaValueKey(option: FillPatternMetaOptionKey): keyof FillPatternMetaValues {
  if (option === "line width") {
    return "lineWidth";
  }
  return option;
}

function sanitizeFillPatternMetaOptionValue(
  option: FillPatternMetaOptionKey,
  value: number,
  fallbackValues: FillPatternMetaValues
): number {
  if (!Number.isFinite(value)) {
    return fallbackValues[fillPatternMetaValueKey(option)];
  }

  if (option === "points") {
    return Math.max(2, Math.round(value));
  }
  if (option === "distance" || option === "line width" || option === "radius") {
    return Math.max(0, normalizeTinyNumber(value));
  }
  return normalizeTinyNumber(value);
}

function defaultFillPatternMetaValues(
  family: FillPatternMetaFamilyId,
  fallbackLineWidth: number
): FillPatternMetaValues {
  const defaultDistance = family === "Stars" ? DEFAULT_META_PATTERN_STARS_DISTANCE : DEFAULT_META_PATTERN_DISTANCE;
  const defaultRadius = family === "Stars" ? DEFAULT_META_PATTERN_STARS_RADIUS : DEFAULT_META_PATTERN_RADIUS;
  return {
    angle: 0,
    distance: defaultDistance,
    xshift: 0,
    yshift: 0,
    lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
    radius: defaultRadius,
    points: 5
  };
}

function normalizeFillPatternLineWidthFallback(value: number): number {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  return 0.4;
}

function serializeFillPatternMetaPattern(family: FillPatternMetaFamilyId, values: FillPatternMetaValues): string {
  const options = [
    `angle=${formatInspectorLength(values.angle)}`,
    `distance=${formatInspectorLength(values.distance)}pt`,
    `xshift=${formatInspectorLength(values.xshift)}pt`,
    `yshift=${formatInspectorLength(values.yshift)}pt`
  ];

  if (family === "Lines" || family === "Hatch") {
    options.push(`line width=${formatInspectorLength(values.lineWidth)}pt`);
  } else {
    options.push(`radius=${formatInspectorLength(values.radius)}pt`);
    if (family === "Stars") {
      options.push(`points=${Math.max(2, Math.round(values.points))}`);
    }
  }

  return `{${family}[${options.join(",")}]}`
}

function resolvePathMorphingDecorationSuboptionProperties(
  preset: PathMorphingDecorationPresetId,
  decoration: { params: Record<string, string> },
  inlineTarget: { targetId: string | null; targetKind: string | null; writable: boolean; reason?: string }
): Array<Extract<InspectorProperty, { kind: "number" }>> {
  if (preset === "none" || preset === "custom") {
    return [];
  }

  const suboptionKeys = PATH_MORPHING_DECORATION_SUBOPTIONS_BY_PRESET[preset];
  if (!suboptionKeys || suboptionKeys.length === 0) {
    return [];
  }

  return suboptionKeys.map((suboptionKey) => {
    const spec = PATH_MORPHING_DECORATION_SUBOPTION_SPECS[suboptionKey];
    const value = resolvePathMorphingDecorationSuboptionValue(spec, decoration.params);
    return {
      kind: "number",
      id: spec.id,
      label: spec.label,
      value,
      step: spec.step,
      unit: spec.unit,
      clearKeys: uniqueStrings(spec.clearKeys),
      write: makeSetPropertyWriteTarget(inlineTarget, spec.writeKey)
    };
  });
}

function resolvePathMorphingDecorationSuboptionValue(
  spec: PathMorphingDecorationSuboptionSpec,
  params: Record<string, string>
): number {
  const rawValue = params[spec.decorationKey];
  if (!rawValue) {
    return spec.defaultValue;
  }

  if (spec.unit === "pt") {
    const parsedLength = parseLength(rawValue, "pt");
    return parsedLength ?? spec.defaultValue;
  }

  const parsed = Number(stripEnclosingBraces(rawValue).trim());
  return Number.isFinite(parsed) ? parsed : spec.defaultValue;
}

function resolveShadowPreset(
  source: string,
  targetId: string | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): ShadowPresetId {
  if (!targetId) {
    return "none";
  }

  const resolved = resolveTarget(targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return "none";
  }

  for (const entry of resolved.target.options.entries) {
    const key =
      entry.kind === "flag" || entry.kind === "kv" ? normalizeOptionKey(entry.key) : null;
    if (!key) {
      continue;
    }
    if (key === "drop shadow") return "drop-shadow";
    if (key === "copy shadow" || key === "double copy shadow") return "copy-shadow";
    if (key === "circular drop shadow") return "circular-drop-shadow";
    if (key === "circular glow") return "circular-glow";
    if (key === "general shadow") return "drop-shadow";
  }

  return "none";
}

function resolveShadowOptionOverrides(
  source: string,
  targetId: string | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): Partial<Omit<ShadowMutationContext, "preset">> {
  if (!targetId) {
    return {};
  }

  const resolved = resolveTarget(targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return {};
  }

  let overrides: Partial<Omit<ShadowMutationContext, "preset">> = {};
  for (const entry of resolved.target.options.entries) {
    const key =
      entry.kind === "flag" || entry.kind === "kv" ? normalizeOptionKey(entry.key) : null;
    if (
      key !== "drop shadow" &&
      key !== "copy shadow" &&
      key !== "double copy shadow" &&
      key !== "circular drop shadow" &&
      key !== "circular glow" &&
      key !== "general shadow"
    ) {
      continue;
    }

    if (entry.kind !== "kv") {
      overrides = {};
      continue;
    }

    const nested = parseStyleValueAsOptionList(entry.valueRaw);
    if (!nested) {
      continue;
    }

    const nextOverrides: Partial<Omit<ShadowMutationContext, "preset">> = {};
    for (const nestedEntry of nested.entries) {
      if (nestedEntry.kind !== "kv") {
        continue;
      }
      const nestedKey = normalizeOptionKey(nestedEntry.key);
      if (nestedKey === "shadow xshift") {
        const parsed = parseLength(nestedEntry.valueRaw, "pt");
        if (parsed != null) {
          nextOverrides.xshiftPt = parsed;
        }
        continue;
      }
      if (nestedKey === "shadow yshift") {
        const parsed = parseLength(nestedEntry.valueRaw, "pt");
        if (parsed != null) {
          nextOverrides.yshiftPt = parsed;
        }
        continue;
      }
      if (nestedKey === "shadow scale") {
        const parsed = Number(stripEnclosingBraces(nestedEntry.valueRaw).trim());
        if (Number.isFinite(parsed)) {
          nextOverrides.scale = parsed;
        }
        continue;
      }
      if (nestedKey === "opacity") {
        const parsed = Number(stripEnclosingBraces(nestedEntry.valueRaw).trim());
        if (Number.isFinite(parsed)) {
          nextOverrides.opacity = parsed;
        }
        continue;
      }
      if (nestedKey === "fill") {
        const rawColor = stripEnclosingBraces(nestedEntry.valueRaw).trim();
        if (rawColor.length > 0) {
          nextOverrides.color = rawColor;
        }
      }
    }
    overrides = nextOverrides;
  }

  return overrides;
}

function resolveShadowInspectorColorValue(
  rawColor: string | null | undefined,
  defaultColor: string | null,
  colorAliases: ReadonlyMap<string, string>
): string | null {
  if (!rawColor) {
    return defaultColor;
  }

  const trimmed = rawColor.trim();
  if (
    trimmed.length === 0 ||
    trimmed === SHADOW_INHERIT_FILL ||
    trimmed === SHADOW_INHERIT_STROKE
  ) {
    return defaultColor;
  }

  const resolveAlias = (candidate: string): string | null => colorAliases.get(candidate.trim().toLowerCase()) ?? null;
  const normalizedRaw = normalizeInspectorColorValue(normalizeColor(trimmed, { resolveAlias }));
  if (defaultColor) {
    const normalizedDefault = normalizeInspectorColorValue(normalizeColor(defaultColor, { resolveAlias }));
    if (normalizedRaw != null && normalizedRaw === normalizedDefault) {
      return defaultColor;
    }
  }

  return normalizeInspectorColorValue(trimmed) ?? trimmed;
}

function resolveShadowOverrideColorValue(
  rawColor: string | null | undefined,
  defaultColor: string | null
): string | null {
  if (!rawColor) {
    return defaultColor;
  }

  const trimmed = rawColor.trim();
  if (
    trimmed.length === 0 ||
    trimmed === SHADOW_INHERIT_FILL ||
    trimmed === SHADOW_INHERIT_STROKE
  ) {
    return defaultColor;
  }

  return trimmed;
}

function resolvePathMorphingDecorationPreset(
  source: string,
  targetId: string | null,
  styleDecoration: { enabled: boolean; name: string | null },
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): PathMorphingDecorationPresetId {
  const fallback = pathMorphingDecorationPresetFromStyle(styleDecoration);
  if (!targetId) {
    return fallback;
  }

  const resolved = resolveTarget(targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return fallback;
  }

  let decorateEnabled = styleDecoration.enabled;
  let decorationName = canonicalDecorationName(styleDecoration.name);

  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (key === "decorate" || key === "/tikz/decorate") {
        decorateEnabled = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeOptionKey(entry.key);
    if (key === "decorate" || key === "/tikz/decorate") {
      const parsed = parseDecorationBoolean(entry.valueRaw);
      if (parsed != null) {
        decorateEnabled = parsed;
      }
      continue;
    }

    if (key === "decoration" || key === "/pgf/decoration") {
      const parsedName = parseDecorationNameFromOptionValue(entry.valueRaw);
      if (parsedName) {
        decorationName = parsedName;
      }
      continue;
    }

    if (key === "/pgf/decoration/name" || key === "/pgf/decorations/name" || key === "name") {
      const parsedName = canonicalDecorationName(stripEnclosingBraces(entry.valueRaw));
      if (parsedName) {
        decorationName = parsedName;
      }
    }
  }

  if (!decorateEnabled) {
    return "none";
  }
  if (!decorationName || decorationName === "none") {
    return "none";
  }

  const matching = PATH_MORPHING_DECORATION_OPTIONS.find((option) => option.value === decorationName);
  return matching ? matching.value : "custom";
}

function parseDecorationBoolean(raw: string): boolean | null {
  return parseBooleanishNormalized(stripEnclosingBraces(raw), { allowOnOff: true, empty: true });
}

function parseDecorationNameFromOptionValue(valueRaw: string): string | null {
  const nested = parseStyleValueAsOptionList(valueRaw);
  if (nested) {
    for (const entry of nested.entries) {
      if (entry.kind === "kv") {
        const key = normalizeOptionKey(entry.key);
        if (key === "name" || key === "/pgf/decoration/name" || key === "/pgf/decorations/name") {
          return canonicalDecorationName(stripEnclosingBraces(entry.valueRaw));
        }
        continue;
      }
      if (entry.kind === "flag") {
        const key = normalizeOptionKey(entry.key);
        if (key === "decorate" || key === "mirror" || key === "path has corners" || key === "reverse path") {
          continue;
        }
        return canonicalDecorationName(entry.key);
      }
    }
  }

  const normalized = stripEnclosingBraces(valueRaw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const firstComma = findTopLevelCharacter(normalized, ",");
  const firstPart = firstComma >= 0 ? normalized.slice(0, firstComma).trim() : normalized;
  const equalsIndex = findTopLevelCharacter(firstPart, "=");
  if (equalsIndex >= 0) {
    const key = normalizeOptionKey(firstPart.slice(0, equalsIndex));
    const valuePart = firstPart.slice(equalsIndex + 1);
    if (key === "name" || key === "/pgf/decoration/name" || key === "/pgf/decorations/name") {
      return canonicalDecorationName(stripEnclosingBraces(valuePart));
    }
    return null;
  }
  return canonicalDecorationName(firstPart);
}

function serializeArrowSides(startRaw: string, endRaw: string): { key: string; value: string } {
  const normalizedStart = startRaw.trim();
  const normalizedEnd = endRaw.trim();

  if (normalizedStart.length === 0 && normalizedEnd.length === 0) {
    return { key: "-", value: "true" };
  }
  if (normalizedStart.length === 0 && normalizedEnd === ">") {
    return { key: "->", value: "true" };
  }
  if (normalizedStart === "<" && normalizedEnd.length === 0) {
    return { key: "<-", value: "true" };
  }
  if (normalizedStart === "<" && normalizedEnd === ">") {
    return { key: "<->", value: "true" };
  }

  return {
    key: ARROW_OPTION_KEY,
    value: `${startRaw}-${endRaw}`
  };
}

function arrowPresetFromMarker(marker: ArrowMarker | null): ArrowTipPresetId {
  if (!marker || marker.tips.length === 0) {
    return "none";
  }
  if (marker.tips.length !== 1) {
    return "custom";
  }

  const tip = marker.tips[0];
  if (!tip) {
    return "none";
  }
  return arrowPresetFromKind(tip.kind);
}

function arrowPresetFromKind(kind: ArrowTipKind): ArrowTipPresetId {
  if (kind === "to" || kind === "cm-rightarrow") {
    return "arrow";
  }
  if (kind === "stealth") {
    return "stealth";
  }
  if (kind === "latex") {
    return "latex";
  }
  if (kind === "triangle") {
    return "triangle";
  }
  if (kind === "circle") {
    return "circle";
  }
  if (kind === "square") {
    return "square";
  }
  if (kind === "kite") {
    return "kite";
  }
  if (kind === "bar") {
    return "bar";
  }
  if (kind === "hooks") {
    return "hooks";
  }
  return "custom";
}

function arrowMarkerFallbackRaw(marker: ArrowMarker | null, side: ArrowTipSide): string {
  const preset = arrowPresetFromMarker(marker);
  if (preset !== "custom") {
    return arrowPresetSideRaw(preset, side);
  }
  if (!marker || marker.tips.length === 0) {
    return "";
  }

  return marker.tips.map((tip) => arrowKindCanonicalRaw(tip.kind, side)).join(" ");
}

function arrowKindCanonicalRaw(kind: ArrowTipKind, side: ArrowTipSide): string {
  if (kind === "to" || kind === "cm-rightarrow") {
    return side === "start" ? "<" : ">";
  }
  if (kind === "stealth") {
    return "Stealth";
  }
  if (kind === "latex") {
    return "Latex";
  }
  if (kind === "triangle") {
    return "Triangle";
  }
  if (kind === "circle") {
    return "Circle";
  }
  if (kind === "square") {
    return "Square";
  }
  if (kind === "kite") {
    return "Kite";
  }
  if (kind === "bar") {
    return "Bar";
  }
  if (kind === "hooks") {
    return "Hooks";
  }
  if (kind === "implies") {
    return "Implies";
  }
  if (kind === "straight-barb") {
    return "Straight Barb";
  }
  if (kind === "arc-barb") {
    return "Arc Barb";
  }
  if (kind === "tee-barb") {
    return "Tee Barb";
  }
  if (kind === "rays") {
    return "Rays";
  }
  if (kind === "round-cap") {
    return "Round Cap";
  }
  if (kind === "butt-cap") {
    return "Butt Cap";
  }
  if (kind === "triangle-cap") {
    return "Triangle Cap";
  }
  return "To";
}

function arrowPresetSideRaw(preset: Exclude<ArrowTipPresetId, "custom">, side: ArrowTipSide): string {
  if (preset === "none") {
    return "";
  }
  if (preset === "arrow") {
    return side === "start" ? "<" : ">";
  }
  if (preset === "stealth") {
    return "Stealth";
  }
  if (preset === "latex") {
    return "Latex";
  }
  if (preset === "triangle") {
    return "Triangle";
  }
  if (preset === "circle") {
    return "Circle";
  }
  if (preset === "square") {
    return "Square";
  }
  if (preset === "kite") {
    return "Kite";
  }
  if (preset === "bar") {
    return "Bar";
  }
  return "Hooks";
}

function resolveGridInspectorState(
  element: SceneElement,
  source: string,
  parseOptions: EditParseOptions = {}
): { keywordId: string; step: number; xstep: number; ystep: number } | null {
  const pathStatement = findPathStatementInSource(source, element.sourceRef.sourceId, parseOptions);
  if (!pathStatement) {
    return null;
  }

  const gridKeywords = collectGridKeywords(pathStatement.items);
  if (gridKeywords.length !== 1) {
    return null;
  }

  const gridKeyword = gridKeywords[0];
  if (!gridKeyword) {
    return null;
  }
  const values = resolveGridStepValuesFromStyleChainAndOptions(element.styleChain, gridKeyword.options);
  return {
    keywordId: gridKeyword.keyword.id,
    step: values.step,
    xstep: values.xstep,
    ystep: values.ystep
  };
}

function findPathStatementInSource(source: string, sourceId: string, parseOptions: EditParseOptions = {}): PathStatement | null {
  if (
    parseOptions.analysisView &&
    parseOptions.analysisView.source === source &&
    parseOptions.analysisView.activeFigureId === parseOptions.activeFigureId
  ) {
    return parseOptions.analysisView.findPathStatement(sourceId);
  }
  const parsed = parseTikz(source, {
    recover: true,
    activeFigureId: parseOptions.activeFigureId,
  });
  return findPathStatementById(parsed.figure.body, sourceId);
}

function findPathStatementById(statements: Statement[], sourceId: string): PathStatement | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function collectGridKeywords(
  items: readonly PathItem[]
): Array<{ keyword: Extract<PathItem, { kind: "PathKeyword" }>; options: Extract<PathItem, { kind: "PathOption" }> | null }> {
  const collected: Array<{ keyword: Extract<PathItem, { kind: "PathKeyword" }>; options: Extract<PathItem, { kind: "PathOption" }> | null }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.kind === "PathKeyword" && item.keyword === "grid") {
      const next = items[index + 1];
      collected.push({
        keyword: item,
        options: next?.kind === "PathOption" ? next : null
      });
      continue;
    }
    if (item.kind === "ChildOperation") {
      collected.push(...collectGridKeywords(item.body));
    }
  }

  return collected;
}

function resolveGridStepValuesFromStyleChainAndOptions(
  styleChain: readonly StyleChainEntry[],
  optionItem: Extract<PathItem, { kind: "PathOption" }> | null
): { step: number; xstep: number; ystep: number } {
  const optionLists = [
    ...styleChain.flatMap((entry) => entry.rawOptions),
    ...(optionItem ? [optionItem.options] : [])
  ];

  return resolveGridStepValuesFromOptionLists(optionLists);
}

function resolveGridStepValuesFromOptionLists(optionLists: readonly OptionListAst[]): { step: number; xstep: number; ystep: number } {
  let xstep = GRID_DEFAULT_STEP_CM;
  let ystep = GRID_DEFAULT_STEP_CM;

  for (const optionList of optionLists) {
    for (const entry of optionList.entries) {
      if (entry.kind !== "kv") {
        continue;
      }

      const key = normalizeOptionKey(entry.key);
      if (key === "step") {
        const parsed = parseGridStepValueCm(entry.valueRaw);
        if (!parsed) {
          continue;
        }
        xstep = parsed.x;
        ystep = parsed.y;
        continue;
      }

      if (key === "xstep" || key === "x step") {
        const parsed = parseGridLengthCm(entry.valueRaw);
        if (parsed != null) {
          xstep = parsed;
        }
        continue;
      }

      if (key === "ystep" || key === "y step") {
        const parsed = parseGridLengthCm(entry.valueRaw);
        if (parsed != null) {
          ystep = parsed;
        }
      }
    }
  }

  return {
    step: Math.abs(xstep - ystep) <= 1e-6 ? xstep : GRID_DEFAULT_STEP_CM,
    xstep,
    ystep
  };
}

function parseGridStepValueCm(raw: string): { step: number | null; x: number; y: number } | null {
  const pair = parseCoordinateLike(raw);
  if (pair) {
    const x = parseGridLengthCm(pair.x);
    const y = parseGridLengthCm(pair.y);
    if (x == null || y == null) {
      return null;
    }
    return {
      step: Math.abs(x - y) <= 1e-6 ? x : null,
      x,
      y
    };
  }

  const scalar = parseGridLengthCm(raw);
  if (scalar == null) {
    return null;
  }
  return {
    step: scalar,
    x: scalar,
    y: scalar
  };
}

function parseGridLengthCm(raw: string): number | null {
  const parsedPt = parseLength(raw, "cm");
  if (parsedPt == null || !Number.isFinite(parsedPt) || parsedPt <= 0) {
    return null;
  }
  return normalizeTinyNumber(parsedPt * CM_PER_PT);
}

function resolveNodeInspectorState(
  source: string,
  targetId: string | null,
  style: Pick<ResolvedStyle, "fontFamily" | "fontWeight" | "fontStyle" | "fontSize">,
  elementKind: SceneElement["kind"],
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): {
  shape: NodeShapePresetId;
  shapeNote?: string;
  shapeAdaptiveControls: ShapeAdaptiveControl[];
  innerSep: number;
  innerSepNote?: string;
  textAlign: NodeTextAlignInspectorValue;
  showTextWidth: boolean;
  textWidth: number | null;
  minimumWidth: number;
  minimumWidthNote?: string;
  minimumHeight: number;
  minimumHeightNote?: string;
  font: {
    family: NodeFontFamilyId;
    weight: "normal" | "bold";
    style: "normal" | "italic";
    sizePreset: NodeFontSizePresetId;
    customSizePt: number | null;
    context: NodeFontMutationContext;
    note?: string;
  };
} {
  const fallbackShape = nodeShapeFallbackFromElementKind(elementKind);
  const fallbackFontSize =
    Number.isFinite(style.fontSize) && style.fontSize > 0 ? style.fontSize : DEFAULT_TEXT_FONT_SIZE;
  const fallbackFontSizePreset = nodeFontSizePresetFromFontSize(fallbackFontSize);
  const state: {
    shape: NodeShapePresetId;
    shapeNote?: string;
    shapeAdaptiveControls: ShapeAdaptiveControl[];
    innerSep: number;
    innerSepNote?: string;
    textAlign: NodeTextAlignInspectorValue;
    showTextWidth: boolean;
    textWidth: number | null;
    minimumWidth: number;
    minimumWidthNote?: string;
    minimumHeight: number;
    minimumHeightNote?: string;
    font: {
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
      context: NodeFontMutationContext;
      note?: string;
    };
  } = {
    shape: fallbackShape,
    shapeAdaptiveControls: [],
    innerSep: NODE_INNER_SEP_DEFAULT,
    textAlign: "unset",
    showTextWidth: false,
    textWidth: null,
    minimumWidth: NODE_MINIMUM_DIMENSION_DEFAULT,
    minimumHeight: NODE_MINIMUM_DIMENSION_DEFAULT,
    font: {
      family: style.fontFamily,
      weight: style.fontWeight,
      style: style.fontStyle,
      sizePreset: fallbackFontSizePreset,
      customSizePt: fallbackFontSizePreset === "custom" ? fallbackFontSize : null,
      context: {
        key: "node font",
        clearKeys: ["font"],
        fallbackCustomSizePt: fallbackFontSize
      }
    }
  };

  if (!targetId) {
    return state;
  }

  const resolved = resolveTarget(targetId);
  if (resolved.kind === "not-found" || !resolved.target.options) {
    return state;
  }

  let rawShape: string | null = null;
  let innerXSep = NODE_INNER_SEP_DEFAULT;
  let innerYSep = NODE_INNER_SEP_DEFAULT;
  let sawAxisSpecificInnerSep = false;
  let minimumWidth = NODE_MINIMUM_DIMENSION_DEFAULT;
  let minimumHeight = NODE_MINIMUM_DIMENSION_DEFAULT;
  let minimumSize: number | null = null;
  let textAlign: NodeTextAlignInspectorValue = "unset";
  let sawAlignOption = false;
  let textWidth: number | null = null;
  let selectedFontKey: "font" | "node font" | null = null;
  let selectedFontRaw: string | null = null;

  for (const entry of resolved.target.options.entries) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (NODE_SHAPE_KNOWN_SET.has(key)) {
        rawShape = key;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    const key = normalizeOptionKey(entry.key);
    if (key === NODE_SHAPE_KEY) {
      rawShape = normalizeShapeRawValue(entry.valueRaw);
      continue;
    }
    if (key === "inner sep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        innerXSep = parsed;
        innerYSep = parsed;
        sawAxisSpecificInnerSep = false;
      }
      continue;
    }
    if (key === "inner xsep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        innerXSep = parsed;
        sawAxisSpecificInnerSep = true;
      }
      continue;
    }
    if (key === "inner ysep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        innerYSep = parsed;
        sawAxisSpecificInnerSep = true;
      }
      continue;
    }
    if (key === "minimum width") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        minimumWidth = Math.max(0, parsed);
      }
      continue;
    }
    if (key === "text width") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        textWidth = Math.max(0, parsed);
      }
      continue;
    }
    if (key === "align") {
      const parsed = parseNodeTextAlignInspectorValue(entry.valueRaw);
      if (parsed != null) {
        textAlign = parsed;
      }
      sawAlignOption = true;
      continue;
    }
    if (key === "minimum height") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        minimumHeight = Math.max(0, parsed);
      }
      continue;
    }
    if (key === "minimum size") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        minimumSize = Math.max(0, parsed);
      }
      continue;
    }
    if (key === "font" || key === "node font") {
      selectedFontKey = key;
      selectedFontRaw = entry.valueRaw;
      continue;
    }
  }

  if (rawShape != null) {
    if (CURATED_NODE_SHAPE_SET.has(rawShape as Exclude<NodeShapePresetId, "custom">)) {
      state.shape = rawShape as Exclude<NodeShapePresetId, "custom">;
    } else {
      state.shape = "custom";
      state.shapeNote = NODE_SHAPE_CUSTOM_NOTE;
    }
  }

  if (state.shape !== "custom") {
    state.shapeAdaptiveControls = resolveNodeShapeAdaptiveControls(state.shape, resolved.target.options);
  }

  state.innerSep = (innerXSep + innerYSep) / 2;
  if (sawAxisSpecificInnerSep || Math.abs(innerXSep - innerYSep) > 1e-6) {
    state.innerSepNote = NODE_INNER_SEP_CONFLICT_NOTE;
  }
  state.minimumWidth = Math.max(minimumWidth, minimumSize ?? minimumWidth);
  state.minimumHeight = Math.max(minimumHeight, minimumSize ?? minimumHeight);
  state.textAlign = textAlign;
  state.textWidth = textWidth;
  state.showTextWidth = textWidth != null || sawAlignOption;
  if (minimumSize != null) {
    state.minimumWidthNote = NODE_MINIMUM_DIMENSION_CONFLICT_NOTE;
    state.minimumHeightNote = NODE_MINIMUM_DIMENSION_CONFLICT_NOTE;
  }

  let fallbackCustomSizePt = fallbackFontSize;
  if (selectedFontRaw != null) {
    const parsedFont = parseFontStyle(selectedFontRaw);
    if (parsedFont == null) {
      state.font.note = NODE_FONT_CUSTOM_NOTE;
    } else {
      if (parsedFont.fontFamily) {
        state.font.family = parsedFont.fontFamily;
      }
      if (parsedFont.fontWeight) {
        state.font.weight = parsedFont.fontWeight;
      }
      if (parsedFont.fontStyle) {
        state.font.style = parsedFont.fontStyle;
      }
      const parsedFontSize =
        Number.isFinite(parsedFont.fontSize) && (parsedFont.fontSize ?? 0) > 0
          ? (parsedFont.fontSize as number)
          : fallbackFontSize;
      fallbackCustomSizePt = parsedFontSize;
      const parsedSizePreset = nodeFontSizePresetFromFontSize(parsedFontSize);
      state.font.sizePreset = parsedSizePreset;
      state.font.customSizePt = parsedSizePreset === "custom" ? parsedFontSize : null;
    }
  } else if (state.font.sizePreset === "custom" && Number.isFinite(state.font.customSizePt)) {
    fallbackCustomSizePt = state.font.customSizePt as number;
  }

  const preferredFontKey = selectedFontKey ?? "node font";
  state.font.context = {
    key: preferredFontKey,
    clearKeys: preferredFontKey === "font" ? ["node font"] : ["font"],
    fallbackCustomSizePt
  };

  return state;
}

function nodeShapeFallbackFromElementKind(kind: SceneElement["kind"]): Exclude<NodeShapePresetId, "custom"> {
  if (kind === "Circle") {
    return "circle";
  }
  if (kind === "Ellipse") {
    return "ellipse";
  }
  return "rectangle";
}

type InlineWriteTarget = {
  targetId: string | null;
  targetKind: string | null;
  writable: boolean;
  reason?: string;
  infoNote?: string;
  foreachVariableNames?: string[];
};

function normalizeShapeRawValue(raw: string): string {
  return stripEnclosingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
}

function parseNodeTextAlignInspectorValue(raw: string): NodeTextAlignInspectorValue | null {
  const normalized = stripEnclosingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "left" || normalized === "flush left") {
    return "left";
  }
  if (normalized === "center" || normalized === "flush center") {
    return "center";
  }
  if (normalized === "right" || normalized === "flush right") {
    return "right";
  }
  if (normalized === "justify") {
    return "justify";
  }
  if (normalized === "none") {
    return "unset";
  }
  return null;
}

function nodeFontSizePresetFromFontSize(fontSize: number): NodeFontSizePresetId {
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return "normalsize";
  }
  for (const preset of NODE_FONT_SIZE_PRESETS) {
    const expected = DEFAULT_TEXT_FONT_SIZE * preset.scale;
    if (Math.abs(expected - fontSize) <= NODE_FONT_SIZE_EPSILON) {
      return preset.value;
    }
  }
  return "custom";
}

function resolveInlineWriteTarget(
  element: SceneElement,
  source: string,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InlineWriteTarget {
  if (element.origin?.macroStack && element.origin.macroStack.length > 0) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This element comes from a macro expansion and is read-only in the Phase 2 inspector."
    };
  }

  const foreachStack = element.origin?.foreachStack ?? [];
  const foreachVariableNames = collectForeachVariableNames(foreachStack);
  if (foreachStack.length > 0) {
    if (element.adornment) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "Adornment selections from \\foreach expansions are read-only in the Phase 2 inspector.",
        foreachVariableNames
      };
    }

    const templateLocalTargetId = element.origin?.foreachTemplateLocalTargetId;
    const loopId = element.sourceRef.sourceId.startsWith("foreach:") ? element.sourceRef.sourceId : null;
    if (templateLocalTargetId && loopId) {
      const nestedLoopLocalIds = foreachStack.slice(1).map((frame) => frame.loopId);
      const targetId = makeForeachTemplateTargetId(loopId, templateLocalTargetId, nestedLoopLocalIds);
      const resolved = resolveTarget(targetId);
      if (resolved.kind === "found") {
        return {
          targetId,
          targetKind: resolved.target.kind,
          writable: true,
          infoNote: FOREACH_TEMPLATE_INFO_NOTE,
          foreachVariableNames
        };
      }
    }

    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This element comes from a \\foreach expansion and is read-only in the Phase 2 inspector.",
      foreachVariableNames
    };
  }

  const styleChainCommandSourceId =
    [...element.styleChain].reverse().find((entry) => entry.kind === "command")?.sourceRef?.sourceId ?? null;
  const elementSourceId = element.sourceRef.sourceId;
  const prefersSourceTarget =
    elementSourceId.includes(":tree-child:");
  const candidateTargetIds = [
    element.adornment?.targetId ?? null,
    prefersSourceTarget ? elementSourceId : styleChainCommandSourceId,
    prefersSourceTarget ? styleChainCommandSourceId : elementSourceId
  ].filter((candidate, index, all): candidate is string => Boolean(candidate) && all.indexOf(candidate) === index);

  for (const targetId of candidateTargetIds) {
    const resolved = resolveTarget(targetId);
    if (resolved.kind === "found") {
      if (resolved.target.kind === "matrix-cell") {
        if (!resolved.target.matrixOfNodes) {
          return {
            targetId,
            targetKind: resolved.target.kind,
            writable: false,
            reason: "Cell property editing is only available for matrix node cells."
          };
        }
        return {
          targetId,
          targetKind: resolved.target.kind,
          writable: true
        };
      }
      if (resolved.target.kind === "tree-child") {
        if (resolved.target.treeChildForeach) {
          return {
            targetId,
            targetKind: resolved.target.kind,
            writable: false,
            reason: "Tree child editing is read-only for child foreach expansions."
          };
        }
        if (
          !resolved.target.treeNodeId
          || !resolved.target.treeNodeTextSpan
          || resolved.target.treeChildInsertOffset == null
          || resolved.target.treeNodeInsertOffset == null
        ) {
          return {
            targetId,
            targetKind: resolved.target.kind,
            writable: false,
            reason: "Tree child source spans could not be resolved for editing."
          };
        }
        return {
          targetId,
          targetKind: resolved.target.kind,
          writable: true
        };
      }
      return {
        targetId,
        targetKind: resolved.target.kind,
        writable: true
      };
    }
  }

  const fallbackTargetId = candidateTargetIds[0] ?? null;
  if (!fallbackTargetId) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "Inline command options could not be resolved for this element."
    };
  }

  return {
    targetId: fallbackTargetId,
    targetKind: null,
    writable: false,
    reason: "Inline command options could not be resolved for this element."
  };
}

function resolveRoundedCornersDisableRequiresSharpCorners(
  element: SceneElement,
  targetId: string | null
): boolean {
  const commandEntry =
    (targetId
      ? [...element.styleChain].reverse().find(
          (entry) => entry.kind === "command" && entry.sourceRef?.sourceId === targetId
        )
      : undefined) ??
    [...element.styleChain].reverse().find((entry) => entry.kind === "command");
  if (!commandEntry) {
    return true;
  }
  const inheritedRoundedCorners = commandEntry.before.roundedCorners;
  return inheritedRoundedCorners != null && inheritedRoundedCorners > 0;
}

function resolveAdornmentInspectorState(
  source: string,
  targetId: string,
  style: ResolvedStyle,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): {
  kind: "label" | "pin";
  text: string;
  angleDeg: number;
  distancePt: number;
  distanceExplicit: boolean;
  pinEdge: {
    draw: string | null;
    lineWidthPt: number;
    dashStyle: DashStylePresetId;
  };
} | null {
  const resolved = resolveTarget(targetId);
  if (resolved.kind === "not-found" || resolved.target.kind !== "node-adornment") {
    return null;
  }

  const angleDeg = parseAdornmentAngleForInspector(resolved.target.angleRaw ?? "center");
  const text = resolved.target.textSpan
    ? stripEnclosingBraces(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to))
    : "";
  const pinEdge = resolvePinEdgeInspectorState(resolved.target.pinEdgeRaw ?? null);

  return {
    kind: resolved.target.adornmentKind ?? "label",
    text,
    angleDeg,
    distancePt: resolved.target.distancePt ?? resolved.target.defaultDistancePt ?? 0,
    distanceExplicit: resolved.target.distanceExplicit ?? false,
    pinEdge: {
      draw: pinEdge.draw,
      lineWidthPt: pinEdge.lineWidthPt ?? style.lineWidth,
      dashStyle: pinEdge.dashStyle
    }
  };
}

function parseAdornmentAngleForInspector(raw: string): number {
  const normalized = raw.trim().toLowerCase();
  const keyword =
    normalized === "center" || normalized === "centered" ? 0 :
    normalized === "right" || normalized === "east" ? 0 :
    normalized === "above right" || normalized === "north east" ? 45 :
    normalized === "above" || normalized === "north" ? 90 :
    normalized === "above left" || normalized === "north west" ? 135 :
    normalized === "left" || normalized === "west" ? 180 :
    normalized === "below left" || normalized === "south west" ? -135 :
    normalized === "below" || normalized === "south" ? -90 :
    normalized === "below right" || normalized === "south east" ? -45 :
    null;
  if (keyword != null) {
    return keyword;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function resolvePinEdgeInspectorState(pinEdgeRaw: string | null): {
  draw: string | null;
  lineWidthPt: number | null;
  dashStyle: DashStylePresetId;
} {
  const options = pinEdgeRaw ? parseStyleValueAsOptionList(pinEdgeRaw) : null;
  let draw: string | null = null;
  let lineWidthPt: number | null = null;
  let dashStyle: DashStylePresetId = "solid";

  for (const entry of options?.entries ?? []) {
    if (entry.kind === "flag") {
      const normalized = normalizeOptionKey(entry.key);
      if (
        normalized === "dashed" ||
        normalized === "densely dashed" ||
        normalized === "loosely dashed" ||
        normalized === "dotted" ||
        normalized === "densely dotted" ||
        normalized === "loosely dotted"
      ) {
        dashStyle = normalized as DashStylePresetId;
      } else if (isLikelyColorValue(entry.key)) {
        draw = entry.key.trim();
      }
      continue;
    }
    if (entry.kind !== "kv") {
      continue;
    }
    const key = normalizeOptionKey(entry.key);
    if (key === "draw" || key === "color") {
      draw = entry.valueRaw.trim() || null;
      continue;
    }
    if (key === "line width") {
      lineWidthPt = parseLength(entry.valueRaw, "pt");
      continue;
    }
    if (
      key === "solid" ||
      key === "dashed" ||
      key === "densely dashed" ||
      key === "loosely dashed" ||
      key === "dotted" ||
      key === "densely dotted" ||
      key === "loosely dotted"
    ) {
      dashStyle = key as DashStylePresetId;
    }
  }

  return { draw, lineWidthPt, dashStyle };
}

function isLikelyColorValue(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed === "none" || /^[a-z][a-z0-9._:@!-]*$/i.test(trimmed) || /^#[0-9a-f]{3,8}$/i.test(trimmed);
}

function normalizeElementKind(kind: SceneElement["kind"]): InspectorDescriptor["elementKind"] {
  if (kind === "Path") return "path";
  if (kind === "Circle") return "circle";
  if (kind === "Ellipse") return "ellipse";
  return "text";
}

function pathSupportsArrowTipEditing(commands: ScenePathCommand[]): boolean {
  // PGF only applies path arrow tips to open paths with endpoints.
  if (commands.some((command) => command.kind === "Z")) {
    return false;
  }
  return commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

function pathSupportsFillEditing(commands: ScenePathCommand[]): boolean {
  type OpenSubpathState = {
    hasCurveOrArc: boolean;
    segmentCount: number;
    points: Array<{ x: number; y: number }>;
  };

  const POLYGON_AREA_EPSILON = 1e-9;
  let subpath: OpenSubpathState | null = null;

  const flushOpenSubpath = (): boolean => {
    if (!subpath) {
      return false;
    }
    if (subpath.hasCurveOrArc && subpath.segmentCount >= 1) {
      return true;
    }
    if (subpath.segmentCount < 2) {
      return false;
    }
    return Math.abs(polygonSignedArea(subpath.points)) > POLYGON_AREA_EPSILON;
  };

  for (const command of commands) {
    if (command.kind === "M") {
      if (flushOpenSubpath()) {
        return true;
      }
      subpath = {
        hasCurveOrArc: false,
        segmentCount: 0,
        points: [command.to]
      };
      continue;
    }

    if (command.kind === "Z") {
      return true;
    }

    if (!subpath) {
      continue;
    }

    if (command.kind === "L") {
      subpath.segmentCount += 1;
      subpath.points.push(command.to);
      continue;
    }

    if (command.kind === "C" || command.kind === "A") {
      subpath.hasCurveOrArc = true;
      subpath.segmentCount += 1;
      subpath.points.push(command.to);
    }
  }

  return flushOpenSubpath();
}

function polygonSignedArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (!current || !next) {
      continue;
    }
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

export function lineWidthPresetLabel(value: number): string | null {
  for (const preset of LINE_WIDTH_PRESETS) {
    if (Math.abs(preset.value - value) <= 0.02) {
      return preset.label;
    }
  }
  return null;
}

export function dashStylePresetFromStyle(dashArray: number[] | null, lineWidth: number): DashStylePresetId {
  if (!dashArray || dashArray.length === 0) {
    return "solid";
  }
  if (dashArray.length !== 2) {
    return "custom";
  }
  const [first, second] = dashArray;
  if (first == null || second == null) {
    return "custom";
  }
  if (closeEnough(first, 3) && closeEnough(second, 3)) {
    return "dashed";
  }
  if (closeEnough(first, 4) && closeEnough(second, 2)) {
    return "densely dashed";
  }
  if (closeEnough(first, 6) && closeEnough(second, 4)) {
    return "loosely dashed";
  }
  if (closeEnough(first, lineWidth) && closeEnough(second, 2)) {
    return "dotted";
  }
  if (closeEnough(first, lineWidth) && closeEnough(second, 1)) {
    return "densely dotted";
  }
  if (closeEnough(first, lineWidth) && closeEnough(second, 4)) {
    return "loosely dotted";
  }
  return "custom";
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= DASH_PATTERN_EPSILON;
}

export function lineCapPresetFromStyle(value: "butt" | "round" | "square"): LineCapPresetId {
  if (value === "butt" || value === "round" || value === "square") {
    return value;
  }
  return "custom";
}

export function lineJoinPresetFromStyle(value: "miter" | "round" | "bevel"): LineJoinPresetId {
  if (value === "miter" || value === "round" || value === "bevel") {
    return value;
  }
  return "custom";
}

function pathMorphingDecorationPresetFromStyle(style: {
  enabled: boolean;
  name: string | null;
}): PathMorphingDecorationPresetId {
  if (!style.enabled) {
    return "none";
  }
  const canonicalName = canonicalDecorationName(style.name);
  if (!canonicalName || canonicalName === "none") {
    return "none";
  }

  const matching = PATH_MORPHING_DECORATION_OPTIONS.find((option) => option.value === canonicalName);
  return matching ? matching.value : "custom";
}

function computePathStrokeControlVisibility(
  commands: ScenePathCommand[],
  dashArray: number[] | null
): { showLineCap: boolean; showLineJoin: boolean } {
  const hasDash = !!dashArray && dashArray.length > 0;
  let openSubpathHasSegments = false;
  let hasJoin = false;
  let segmentCountInSubpath = 0;

  for (const command of commands) {
    if (command.kind === "M") {
      if (segmentCountInSubpath >= 1) {
        openSubpathHasSegments = true;
      }
      if (segmentCountInSubpath >= 2) {
        hasJoin = true;
      }
      segmentCountInSubpath = 0;
      continue;
    }

    if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
      segmentCountInSubpath += 1;
      if (segmentCountInSubpath >= 2) {
        hasJoin = true;
      }
      continue;
    }

    if (command.kind === "Z") {
      if (segmentCountInSubpath >= 1) {
        hasJoin = true;
      }
      segmentCountInSubpath = 0;
    }
  }

  if (segmentCountInSubpath >= 1) {
    openSubpathHasSegments = true;
  }
  if (segmentCountInSubpath >= 2) {
    hasJoin = true;
  }

  return {
    showLineCap: hasDash || openSubpathHasSegments,
    showLineJoin: hasJoin
  };
}

function parseTransformScalar(raw: string): number | null {
  const parsed = Number(stripEnclosingBraces(raw).trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return normalizeTinyNumber(parsed);
}

function parseShiftTransformValue(raw: string): { x: number; y: number } | null {
  const normalized = stripEnclosingBraces(raw).trim();
  const coordinate = parseCoordinateLike(normalized);
  if (!coordinate) {
    return null;
  }

  const x = parseLength(coordinate.x, "cm");
  const y = parseLength(coordinate.y, "cm");
  if (x == null || y == null) {
    return null;
  }

  return {
    x: normalizeTinyNumber(x),
    y: normalizeTinyNumber(y)
  };
}

function cloneTransformInspectorValues(values: TransformInspectorValues): TransformInspectorValues {
  return {
    xshift: values.xshift,
    yshift: values.yshift,
    xscale: values.xscale,
    yscale: values.yscale,
    rotate: values.rotate
  };
}

function createEmptyTransformInspectorPresence(): TransformInspectorPresence {
  return {
    shift: false,
    scale: false,
    xshift: false,
    yshift: false,
    xscale: false,
    yscale: false,
    rotate: false
  };
}

function coerceTransformInspectorMutationContext(
  current: TransformInspectorValues | TransformInspectorMutationContext
): TransformInspectorMutationContext {
  if ("values" in current) {
    return {
      values: cloneTransformInspectorValues(current.values),
      presence: current.presence ? { ...current.presence } : createEmptyTransformInspectorPresence()
    };
  }
  return {
    values: cloneTransformInspectorValues(current),
    presence: createEmptyTransformInspectorPresence()
  };
}

function shouldSetTransformCompanion(
  context: TransformInspectorMutationContext,
  companionKey: "xshift" | "yshift" | "xscale" | "yscale",
  companionValue: number,
  companionDefault: number,
  shorthandKey: "shift" | "scale"
): boolean {
  if (Math.abs(companionValue - companionDefault) <= 1e-6) {
    return false;
  }
  const presence = context.presence ?? createEmptyTransformInspectorPresence();
  return presence[shorthandKey] || !presence[companionKey];
}

function shouldClearTransformCompanion(
  context: TransformInspectorMutationContext,
  companionKey: "xshift" | "yshift" | "xscale" | "yscale",
  companionDefault: number
): boolean {
  const presence = context.presence ?? createEmptyTransformInspectorPresence();
  if (!presence[companionKey]) {
    return false;
  }
  return Math.abs(context.values[companionKey] - companionDefault) <= 1e-6;
}

function sanitizeTransformInspectorValues(values: TransformInspectorValues): TransformInspectorValues {
  return {
    xshift: Number.isFinite(values.xshift) ? normalizeTinyNumber(values.xshift) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.xshift,
    yshift: Number.isFinite(values.yshift) ? normalizeTinyNumber(values.yshift) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.yshift,
    xscale: Number.isFinite(values.xscale) ? normalizeTinyNumber(values.xscale) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.xscale,
    yscale: Number.isFinite(values.yscale) ? normalizeTinyNumber(values.yscale) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.yscale,
    rotate: Number.isFinite(values.rotate) ? normalizeTinyNumber(values.rotate) : DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate
  };
}

function normalizeTinyNumber(value: number): number {
  return Math.abs(value) <= 1e-9 ? 0 : value;
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function buildTransformMutation(
  key: TransformInspectorKey,
  value: number,
  defaultValue: number,
  clearKeys: readonly string[]
): TransformSetPropertyMutation {
  const normalizedValue = normalizeTinyNumber(value);
  const isDefault = Math.abs(normalizedValue - defaultValue) <= 1e-6;
  return {
    key,
    value: isDefault ? "" : formatInspectorLength(normalizedValue) + (key === "xshift" || key === "yshift" ? "pt" : ""),
    clearKeys: uniqueStrings(isDefault ? [key, ...clearKeys] : clearKeys)
  };
}

function formatInspectorLength(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const normalized = Math.abs(rounded) < 1e-9 ? 0 : rounded;
  return Number(normalized.toFixed(2)).toString();
}
