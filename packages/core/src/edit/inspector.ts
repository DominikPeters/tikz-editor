import { TREE_CHILD_NODE_READONLY_KEYS } from "./tree-editing.js";
import {
  makeForeachTemplateTargetId,
  makePicTemplateTargetId,
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
import type { Span } from "../ast/types.js";
import type { OptionListAst } from "../options/types.js";
import {
  findTopLevelCharacter,
  parseFontStyle,
  parseStyleValueAsOptionList,
  stripEnclosingBraces
} from "../semantic/style/option-utils.js";
import { parseLength } from "../semantic/coords/parse-length.js";
import { DEFAULT_TEXT_FONT_SIZE } from "../semantic/style/constants.js";
import { normalizeColor } from "../semantic/style/colors.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../semantic/types.js";
import {
  cloneTransformInspectorValues,
  DEFAULT_TRANSFORM_INSPECTOR_VALUES,
  resolveTransformInspectorMutationContext,
  transformRotateInspectorLabel,
  transformPropertyCandidateKeys,
  type ArrowTipWriteContext,
  type FillPatternOptionMutationContext,
  type NodeFontMutationContext,
  type ShadowMutationContext,
  type TransformInspectorKey,
  type TransformInspectorMutationContext
} from "./property-write-builders.js";
import { uniqueStrings } from "./statement-find.js";
import {
  ARROW_DEFAULT_CLEAR_KEYS,
  ARROW_OPTION_KEY,
  ARROW_TIP_OPTIONS,
  AXIS_SHADING_CONFLICT_CLEAR_KEYS,
  BALL_SHADING_CONFLICT_CLEAR_KEYS,
  CURATED_NODE_SHAPE_SET,
  DASH_STYLE_OPTIONS,
  DASH_STYLE_PRESET_CLEAR_KEYS,
  DEFAULT_META_PATTERN_DISTANCE,
  DEFAULT_META_PATTERN_RADIUS,
  DEFAULT_META_PATTERN_STARS_DISTANCE,
  DEFAULT_META_PATTERN_STARS_RADIUS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_CLEAR_KEYS,
  FILL_PATTERN_OPTIONS,
  FILL_SHADING_CLEAR_KEYS,
  FILL_SHADING_OPTIONS,
  FILL_STYLE_CUSTOM_NOTE,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS,
  NODE_FONT_CUSTOM_NOTE,
  NODE_FONT_SIZE_EPSILON,
  NODE_FONT_SIZE_PRESETS,
  NODE_INNER_SEP_CONFLICT_NOTE,
  NODE_INNER_SEP_DEFAULT,
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
  ArrowTipSide,
  DashStylePresetId,
  FillModePresetId,
  FillPatternMetaFamilyId,
  FillPatternMetaValues,
  FillPatternPresetId,
  FillShadingPresetId,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeShapePresetId,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationSuboptionSpec,
  ShadowPresetId
} from "./inspector/presets.js";
import type {
  ArrowMarker,
  ArrowTipKind,
  ResolvedStyle,
  ResolvedPattern,
  SceneElement,
  ScenePathCommand
} from "../semantic/types.js";
import { parseBooleanishNormalized } from "../utils/booleanish.js";
import type { StyleChainEntry } from "../semantic/style-chain.js";
import {
  candidateKeysForProperty,
  propertyIdForWriteKey
} from "./property-registry.js";
import {
  resolveNodeShapeAdaptiveControls,
  type ShapeAdaptiveControl
} from "./inspector/shape-adaptive-controls.js";
import { resolveGridInspectorState } from "./inspector/grid-state.js";
import {
  dashStylePresetFromStyle,
  fillPatternPresetFromRaw,
  fillPatternPresetFromResolvedPattern,
  fillShadingPresetFromStyleName,
  lineCapPresetFromStyle,
  lineJoinPresetFromStyle,
  lineWidthPresetLabel
} from "./inspector/preset-values.js";
import {
  buildMatrixInspectorDescriptor as buildMatrixInspectorDescriptorBase,
  buildTreeInspectorDescriptor as buildTreeInspectorDescriptorBase
} from "./inspector/matrix-tree-descriptors.js";
import { createInspectorTargetResolver, type InspectorTargetResolver } from "./inspector/target-resolver.js";
import type {
  ArrowTipWriteTarget,
  InspectorDescriptor,
  InspectorProperty,
  InspectorSection,
  InspectorSnapshot,
  NodeTextAlignInspectorValue,
  SetPropertyWriteTarget
} from "./inspector/types.js";
export { TIKZPICTURE_GLOBAL_TARGET_ID } from "./property-target.js";
export type {
  ArrowTipWriteTarget,
  InspectorDescriptor,
  InspectorProperty,
  InspectorSection,
  InspectorSnapshot,
  NodeTextAlignInspectorValue,
  SetPropertyWriteTarget
} from "./inspector/types.js";
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
export {
  dashStylePresetFromStyle,
  fillPatternPresetFromRaw,
  fillPatternPresetFromResolvedPattern,
  fillShadingPresetFromStyleName,
  lineCapPresetFromStyle,
  lineJoinPresetFromStyle,
  lineWidthPresetLabel
} from "./inspector/preset-values.js";

const ROUNDED_CORNERS_MIN = 0.1;
const GRID_STEP_CLEAR_KEYS = ["xstep", "x step", "ystep", "y step"] as const;
const GRID_XSTEP_CLEAR_KEYS = ["x step"] as const;
const GRID_YSTEP_CLEAR_KEYS = ["y step"] as const;
const FOREACH_TEMPLATE_INFO_NOTE = "Editing the foreach template. Changes apply to all iterations.";
const PIC_INLINE_TEMPLATE_INFO_NOTE = "Editing this inline pic code. Changes apply to this invocation.";
const PIC_SHARED_TEMPLATE_INFO_NOTE = "Editing this shared pic template. Changes apply to all uses.";
const FOREACH_VARIABLE_READONLY_REASON = "This property depends on foreach iteration variables and is read-only.";
const NODE_TARGET_KINDS = new Set(["node-item", "matrix-cell", "tree-child"]);
const NODE_PAINT_STYLE_KINDS = new Set<StyleChainEntry["kind"]>(["every-node", "every-shape"]);
const NODE_PAINT_SOURCE_KINDS = new Set(["node-options"]);
const NODE_BACKED_SECTION_ORDER = ["transform", "node", "stroke", "fill", "path", "grid", "text", "shadow"] as const;
const PATH_SECTION_ORDER = ["transform", "grid", "path", "stroke", "fill", "text", "shadow"] as const;
const DEFAULT_SECTION_ORDER = ["transform", "stroke", "fill", "text", "shadow"] as const;

function resolveInspectorStrokeColor(element: SceneElement, targetKind: string | null): string | null {
  if (!shouldPresentNodeStrokeAsActive(element, targetKind)) {
    return null;
  }
  return element.style.stroke;
}

function resolveInspectorStrokeClearOnNoneKeys(
  element: SceneElement,
  targetKind: string | null,
  resolvedTarget: PropertyTargetResolution | null
): string[] | undefined {
  if (!shouldPresentNodeStrokeAsActive(element, targetKind)) {
    return undefined;
  }
  if (element.kind !== "Text" || !targetKind || !NODE_TARGET_KINDS.has(targetKind)) {
    return undefined;
  }
  const nodeOptionsEntry = [...element.styleChain].reverse().find(
    (entry) => entry.sourceRef?.sourceKind === "node-options"
  );
  if (!nodeOptionsEntry || nodeOptionsEntry.before.drawExplicit) {
    return undefined;
  }
  if (!targetHasDrawActivation(resolvedTarget)) {
    return undefined;
  }
  return [];
}

function shouldPresentNodeStrokeAsActive(element: SceneElement, targetKind: string | null): boolean {
  if (element.kind !== "Text" || !targetKind || !NODE_TARGET_KINDS.has(targetKind)) {
    return true;
  }

  let drawActive = false;
  for (const entry of element.styleChain) {
    if (!isNodePaintStyleEntry(entry)) {
      continue;
    }
    if (typeof entry.resolvedContributions.drawExplicit === "boolean") {
      drawActive = entry.resolvedContributions.drawExplicit;
    }
  }

  return drawActive && element.style.stroke != null && element.style.stroke !== "none";
}

function isNodePaintStyleEntry(entry: StyleChainEntry): boolean {
  if (NODE_PAINT_STYLE_KINDS.has(entry.kind)) {
    return true;
  }
  return entry.sourceRef?.sourceKind != null && NODE_PAINT_SOURCE_KINDS.has(entry.sourceRef.sourceKind);
}

function targetHasDrawActivation(resolvedTarget: PropertyTargetResolution | null): boolean {
  if (resolvedTarget?.kind !== "found" || !resolvedTarget.target.options) {
    return false;
  }
  for (const entry of resolvedTarget.target.options.entries) {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      continue;
    }
    const key = normalizeOptionKey(entry.key);
    if (key !== "draw") {
      continue;
    }
    if (entry.kind === "flag") {
      return true;
    }
    if (entry.kind === "kv") {
      const value = stripEnclosingBraces(entry.valueRaw).trim().toLowerCase();
      return value !== "none";
    }
  }
  return false;
}

function orderInspectorSections(
  sections: InspectorSection[],
  context: { nodeBacked: boolean; pathBacked: boolean }
): InspectorSection[] {
  const order = context.nodeBacked
    ? NODE_BACKED_SECTION_ORDER
    : context.pathBacked
      ? PATH_SECTION_ORDER
      : DEFAULT_SECTION_ORDER;
  const orderIndex = new Map<string, number>(order.map((id, index) => [id, index]));
  const originalIndex = new Map<InspectorSection, number>(
    sections.map((section, index) => [section, index])
  );
  return [...sections].sort((left, right) => {
    const leftOrder = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0);
  });
}

export function buildMatrixInspectorDescriptor(
  source: string,
  matrixId: string,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InspectorDescriptor | null {
  return buildMatrixInspectorDescriptorBase(source, matrixId, parseOptions, resolveTarget);
}

export function buildTreeInspectorDescriptor(
  source: string,
  sourceId: string,
  element: SceneElement | null,
  parseOptions: EditParseOptions = {},
  resolveTarget: InspectorTargetResolver = createInspectorTargetResolver(source, parseOptions)
): InspectorDescriptor | null {
  return buildTreeInspectorDescriptorBase(source, sourceId, element, parseOptions, resolveTarget, getInspectorDescriptor);
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
  const strokeColor = normalizeInspectorColorValue(resolveInspectorStrokeColor(element, inlineTarget.targetKind));
  const strokeColorSyntax = resolveColorSyntaxValue(
    resolvedInlineTarget,
    ["draw", "color"],
    strokeColor,
    colorAliases,
    element.styleChain
  );
  const strokeClearOnNoneKeys = resolveInspectorStrokeClearOnNoneKeys(
    element,
    inlineTarget.targetKind,
    resolvedInlineTarget
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
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xshift,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "xshift", transformContext)
        },
        {
          kind: "number",
          id: "yshift",
          label: "Y shift",
          value: transformValues.yshift,
          step: 0.1,
          unit: "pt",
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yshift,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "yshift", transformContext)
        },
        {
          kind: "number",
          id: "xscale",
          label: "X scale",
          value: transformValues.xscale,
          step: 0.1,
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xscale,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "xscale", transformContext)
        },
        {
          kind: "number",
          id: "yscale",
          label: "Y scale",
          value: transformValues.yscale,
          step: 0.1,
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yscale,
          write: makeTransformSetPropertyWriteTarget(inlineTarget, "yscale", transformContext)
        },
        {
          kind: "number",
          id: "rotate",
          label: transformRotateInspectorLabel(transformContext),
          value: transformValues.rotate,
          step: 1,
          unit: "deg",
          defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate,
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
          write: {
            ...makeSetPropertyWriteTarget(inlineTarget, "draw"),
            clearOnNoneKeys: strokeClearOnNoneKeys
          }
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
          defaultValue: NODE_INNER_SEP_DEFAULT,
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
          defaultValue: NODE_MINIMUM_DIMENSION_DEFAULT,
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
          defaultValue: NODE_MINIMUM_DIMENSION_DEFAULT,
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
      defaultValue: 1,
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
      defaultValue: 1,
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
            minExclusive: 0,
            defaultValue: 1,
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
            minExclusive: 0,
            defaultValue: 1,
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
            minExclusive: 0,
            defaultValue: 1,
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
    sections: applyForeachVariableReadOnlyToSections(
      orderInspectorSections(sections, {
        nodeBacked: nodeInspectorState != null,
        pathBacked: element.kind === "Path"
      }),
      inlineTarget,
      resolveTarget
    )
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
    propertyId: propertyIdForWriteKey(key) ?? undefined,
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
  const write = "write" in property ? property.write : undefined;
  const registryKeys = candidateKeysForProperty(write?.propertyId ?? property.id);
  if (registryKeys.length > 0) {
    return registryKeys;
  }
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
      if (write?.transformContext) {
        return transformPropertyCandidateKeys(write.transformContext.key);
      }
      return uniqueStrings([write?.key ?? "", ...("clearKeys" in property && property.clearKeys ? property.clearKeys : [])]);
    }
    case "length":
    case "optionalLength":
    case "slider":
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

function fillPatternMetaFamilyFromPreset(preset: FillPatternPresetId): FillPatternMetaFamilyId | null {
  if (preset === "Lines" || preset === "Hatch" || preset === "Dots" || preset === "Stars") {
    return preset;
  }
  return null;
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

function arrowPresetFromMarker(marker: ArrowMarker | null): ArrowTipPresetId {
  if (!marker || marker.tips.length === 0) {
    return "none";
  }
  if (marker.tips.length !== 1) {
    return "custom";
  }

  const tip = marker.tips[0];
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

  return marker!.tips.map((tip) => arrowKindCanonicalRaw(tip.kind, side)).join(" ");
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

function sourceSpanContainsMacroOrigin(
  source: string,
  span: Span,
  macroStack: readonly { macroName: string }[]
): boolean {
  const from = Math.max(0, Math.min(source.length, span.from));
  const to = Math.max(from, Math.min(source.length, span.to));
  const slice = source.slice(from, to);
  return macroStack.some((origin) => origin.macroName.length > 0 && slice.includes(origin.macroName));
}

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
  if (
    element.origin?.macroStack &&
    element.origin.macroStack.length > 0 &&
    sourceSpanContainsMacroOrigin(source, element.sourceRef.sourceSpan, element.origin.macroStack)
  ) {
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This element comes from a macro expansion and cannot be edited directly."
    };
  }

  const picStack = element.origin?.picStack ?? [];
  if (picStack.length > 0) {
    const picOrigin = picStack[picStack.length - 1];
    if (!picOrigin) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "This pic expansion cannot be edited from the inspector."
      };
    }
    if (picOrigin.parameterized) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "Parameterized pic templates are read-only."
      };
    }
    if (!picOrigin.codeSpan || !element.origin?.picTemplateLocalTargetId) {
      return {
        targetId: null,
        targetKind: null,
        writable: false,
        reason: "This pic template target could not be mapped back to source."
      };
    }
    const targetId = makePicTemplateTargetId(picOrigin.codeSpan, element.origin.picTemplateLocalTargetId);
    const resolved = resolveTarget(targetId);
    if (resolved.kind === "found") {
      return {
        targetId,
        targetKind: resolved.target.kind,
        writable: true,
        infoNote: picOrigin.codeSource === "inline" ? PIC_INLINE_TEMPLATE_INFO_NOTE : PIC_SHARED_TEMPLATE_INFO_NOTE
      };
    }
    return {
      targetId: null,
      targetKind: null,
      writable: false,
      reason: "This pic template target could not be mapped back to source."
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
        reason: "This adornment comes from a \\foreach expansion and cannot be edited directly.",
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
      reason: "This \\foreach expansion cannot be edited from the inspector.",
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
        dashStyle = normalized;
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
      dashStyle = key;
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
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
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

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}
