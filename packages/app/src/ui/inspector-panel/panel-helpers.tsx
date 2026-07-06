import { formatNumber } from "tikz-editor/edit/format";
import {
  LINE_WIDTH_PRESETS,
  ROUNDED_CORNERS_DEFAULT_RADIUS,
  type ArrowTipPresetId,
  type ArrowTipSide,
  type DashStylePresetId,
  type FillModePresetId,
  type FillPatternPresetId,
  type FillPatternMetaOptionKey,
  type FillShadingPresetId,
  type InspectorDescriptor,
  type InspectorProperty,
  type LineCapPresetId,
  type LineJoinPresetId,
  type NodeFontFamilyId,
  type NodeTextAlignInspectorValue,
  type NodeFontSizePresetId,
  type NodeShapePresetId,
  type PathMorphingDecorationPresetId,
  type SetPropertyWriteTarget,
  type ShadowPresetId,
  type ShadowPresetOption
} from "tikz-editor/edit/inspector";
import type {
  ArrowTipWriteTarget,
  FillPatternOptionMutationContext,
  NodeFontMutationContext,
  NodeMinimumDimensionsMutationContext,
  ShadowMutationContext
} from "tikz-editor/edit/property-write-builders";
import type { StylesCascadeModel } from "tikz-editor/edit/styles-cascade";
import { makeDefaultArrowMarker } from "tikz-editor/semantic/style/arrows";
import type { ArrowTipKind } from "tikz-editor/semantic/types";
import { renderArrowTipPreviewPaths } from "tikz-editor/svg/arrows/preview";
import { renderPathMorphingDecorationPreviewSvg } from "tikz-editor/svg/decorations/preview";
import { renderFillPatternPreviewSvg } from "tikz-editor/svg/patterns/preview";
import type { CustomDropdownItem, CustomDropdownOption } from "../CustomDropdown";
import css from "./InspectorPanel.module.css";

export type MultiInspectorNumberProperty = {
  kind: "number";
  id: string;
  label: string;
  value: number;
  mixed: boolean;
  step: number;
  min?: number;
  minExclusive?: number;
  max?: number;
  unit?: string;
  defaultValue?: number;
  clearKeys?: string[];
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorLengthProperty = {
  kind: "length";
  id: string;
  label: string;
  value: number;
  mixed: boolean;
  step: number;
  unit: "pt";
  defaultValue?: number;
  clearKeys?: string[];
  writes: SetPropertyWriteTarget[];
  note?: string;
  minimumDimensionsContexts?: NodeMinimumDimensionsMutationContext[];
  readOnlyReason?: string;
};

export type MultiInspectorOptionalLengthProperty = {
  kind: "optionalLength";
  id: string;
  label: string;
  value: number | null;
  mixed: boolean;
  step: number;
  unit: "pt";
  clearKeys?: string[];
  writes: SetPropertyWriteTarget[];
  note?: string;
  readOnlyReason?: string;
};

export type MultiInspectorEnumProperty = {
  kind: "enum";
  id: string;
  label: string;
  value: string;
  mixed: boolean;
  options: Array<{ value: string; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorBooleanProperty = {
  kind: "boolean";
  id: string;
  label: string;
  value: boolean;
  mixed: boolean;
  trueValue?: string;
  falseValue?: string;
  clearKeys?: string[];
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorColorProperty = {
  kind: "color";
  id: string;
  label: string;
  value: string | null;
  syntaxValue: string | null;
  mixed: boolean;
  options: string[];
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorLineWidthProperty = {
  kind: "lineWidth";
  id: string;
  label: string;
  value: number;
  averageValue: number;
  mixed: boolean;
  min: number;
  max: number;
  step: number;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorDashStyleProperty = {
  kind: "dashStyle";
  id: string;
  label: string;
  value: DashStylePresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<DashStylePresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorLineCapProperty = {
  kind: "lineCap";
  id: string;
  label: string;
  value: LineCapPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<LineCapPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorLineJoinProperty = {
  kind: "lineJoin";
  id: string;
  label: string;
  value: LineJoinPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorPathMorphingDecorationProperty = {
  kind: "pathMorphingDecoration";
  id: string;
  label: string;
  value: PathMorphingDecorationPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorFillModeProperty = {
  kind: "fillMode";
  id: string;
  label: string;
  value: FillModePresetId;
  mixed: boolean;
  options: Array<{ value: Exclude<FillModePresetId, "custom">; label: string }>;
  contexts: Array<{
    fillColor: string | null;
    patternColor: string | null;
    shading: FillShadingPresetId;
    pattern: FillPatternPresetId;
  }>;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorFillShadingProperty = {
  kind: "fillShading";
  id: string;
  label: string;
  value: FillShadingPresetId;
  mixed: boolean;
  options: Array<{ value: Exclude<FillShadingPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  note?: string;
  readOnlyReason?: string;
};

export type MultiInspectorFillPatternProperty = {
  kind: "fillPattern";
  id: string;
  label: string;
  value: FillPatternPresetId;
  mixed: boolean;
  options: Array<{ value: Exclude<FillPatternPresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  note?: string;
  readOnlyReason?: string;
};

export type MultiInspectorFillPatternOptionProperty = {
  kind: "fillPatternOption";
  id: string;
  label: string;
  option: FillPatternMetaOptionKey;
  value: number;
  mixed: boolean;
  step: number;
  unit?: string;
  contexts: FillPatternOptionMutationContext[];
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorRoundedCornersProperty = {
  kind: "roundedCorners";
  id: string;
  label: string;
  enabled: boolean;
  anyEnabled: boolean;
  disableRequiresSharpCorners: boolean;
  radius: number;
  averageRadius: number;
  defaultRadius: number;
  min: number;
  max: number;
  step: number;
  mixed: boolean;
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorNodeShapeProperty = {
  kind: "nodeShape";
  id: string;
  label: string;
  value: NodeShapePresetId;
  mixed: boolean;
  options: Array<{ value: Exclude<NodeShapePresetId, "custom">; label: string }>;
  writes: SetPropertyWriteTarget[];
  note?: string;
  readOnlyReason?: string;
};

export type MultiInspectorNodeTextAlignProperty = {
  kind: "nodeTextAlign";
  id: string;
  label: string;
  value: NodeTextAlignInspectorValue;
  mixed: boolean;
  writes: SetPropertyWriteTarget[];
  clearKeys?: string[];
  readOnlyReason?: string;
};

export type MultiInspectorNodeFontProperty = {
  kind: "nodeFont";
  id: string;
  label: string;
  family: NodeFontFamilyId;
  familyMixed: boolean;
  weight: "normal" | "bold";
  weightMixed: boolean;
  style: "normal" | "italic";
  styleMixed: boolean;
  sizePreset: NodeFontSizePresetId;
  sizePresetMixed: boolean;
  customSizePt: number | null;
  sizeOptions: Array<{ value: Exclude<NodeFontSizePresetId, "custom">; label: string }>;
  contexts: Array<{
    context: NodeFontMutationContext;
    values: {
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
    };
  }>;
  writes: SetPropertyWriteTarget[];
  notes: string[];
  readOnlyReason?: string;
};

export type MultiInspectorArrowTipProperty = {
  kind: "arrowTip";
  id: string;
  label: string;
  side: ArrowTipSide;
  value: ArrowTipPresetId;
  mixed: boolean;
  previewLineWidth: number;
  options: Array<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>;
  writes: ArrowTipWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorShadowPresetProperty = {
  kind: "shadowPreset";
  id: string;
  label: string;
  value: ShadowPresetId;
  mixed: boolean;
  options: ShadowPresetOption[];
  contexts: ShadowMutationContext[];
  writes: SetPropertyWriteTarget[];
  readOnlyReason?: string;
};

export type MultiInspectorProperty =
  | MultiInspectorEnumProperty
  | MultiInspectorBooleanProperty
  | MultiInspectorNumberProperty
  | MultiInspectorLengthProperty
  | MultiInspectorOptionalLengthProperty
  | MultiInspectorColorProperty
  | MultiInspectorNodeTextAlignProperty
  | MultiInspectorNodeShapeProperty
  | MultiInspectorNodeFontProperty
  | MultiInspectorLineWidthProperty
  | MultiInspectorDashStyleProperty
  | MultiInspectorLineCapProperty
  | MultiInspectorLineJoinProperty
  | MultiInspectorPathMorphingDecorationProperty
  | MultiInspectorFillModeProperty
  | MultiInspectorFillShadingProperty
  | MultiInspectorFillPatternProperty
  | MultiInspectorFillPatternOptionProperty
  | MultiInspectorRoundedCornersProperty
  | MultiInspectorArrowTipProperty
  | MultiInspectorShadowPresetProperty;

export type MultiInspectorSection = {
  id: string;
  title: string;
  sourceLevel: InspectorDescriptor["sections"][number]["sourceLevel"];
  properties: MultiInspectorProperty[];
};

export type MultiInspectorModel = {
  selectionCount: number;
  elementKinds: string[];
  sections: MultiInspectorSection[];
};

export type InspectorPropertyProvenance =
  | {
      kind: "inherited";
      sourceLabel: string;
      tooltip: string;
    }
  | {
      kind: "default";
      tooltip: string;
    };

export type InspectorPropertyProvenanceMap = Record<string, InspectorPropertyProvenance>;

export const VALUE_EPSILON = 1e-6;
export const LINE_WIDTH_CUSTOM_OPTION_VALUE = "__custom-line-width__";
export const LINE_WIDTH_MIXED_OPTION_VALUE = "__mixed-line-width__";
export const LINE_WIDTH_PRESET_EPSILON = 0.02;
export const ARROW_TIP_MIXED_OPTION_VALUE = "__mixed-arrow-tip__";
export const DASH_STYLE_MIXED_OPTION_VALUE = "__mixed-dash-style__";
export const LINE_CAP_MIXED_OPTION_VALUE = "__mixed-line-cap__";
export const LINE_JOIN_MIXED_OPTION_VALUE = "__mixed-line-join__";
export const PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE = "__mixed-path-morphing-decoration__";
export const FILL_MODE_MIXED_OPTION_VALUE = "__mixed-fill-mode__";
export const FILL_SHADING_MIXED_OPTION_VALUE = "__mixed-fill-shading__";
export const FILL_PATTERN_MIXED_OPTION_VALUE = "__mixed-fill-pattern__";
export const NODE_SHAPE_MIXED_OPTION_VALUE = "__mixed-node-shape__";
export const NODE_FONT_SIZE_MIXED_OPTION_VALUE = "__mixed-node-font-size__";
export const SHADOW_PRESET_MIXED_OPTION_VALUE = "__mixed-shadow-preset__";
export const NODE_FONT_SIZE_PT_BY_PRESET: Record<Exclude<NodeFontSizePresetId, "custom">, number> = {
  tiny: 5,
  scriptsize: 7,
  footnotesize: 8,
  small: 9,
  normalsize: 10,
  large: 12,
  Large: 14.4,
  LARGE: 17.28,
  huge: 20.74,
  Huge: 24.88
};
export const META_FILL_PATTERN_PRESETS = new Set<Exclude<FillPatternPresetId, "custom">>([
  "Lines",
  "Hatch",
  "Dots",
  "Stars"
]);
export const SHADOW_PARAM_PROPERTY_IDS = new Set([
  "shadow-xshift",
  "shadow-yshift",
  "shadow-scale",
  "shadow-opacity",
  "shadow-color"
]);

export const STROKE_MORE_OPTIONS_PROPERTY_IDS = new Set(["line-cap", "line-join", "stroke-opacity"]);
export const PATH_MORPHING_SUBOPTION_PROPERTY_IDS = new Set([
  "path-morphing-segment-length",
  "path-morphing-amplitude",
  "path-morphing-aspect"
]);
export const FILL_MORE_OPTIONS_PROPERTY_IDS = new Set(["fill-opacity"]);
export const OPTIONAL_MULTI_PROPERTY_IDS = new Set([
  ...STROKE_MORE_OPTIONS_PROPERTY_IDS,
  ...FILL_MORE_OPTIONS_PROPERTY_IDS,
  ...PATH_MORPHING_SUBOPTION_PROPERTY_IDS,
  ...SHADOW_PARAM_PROPERTY_IDS,
  "rounded-corners"
]);
export const FILL_ADVANCED_PROPERTY_IDS = new Set([
  "fill-mode",
  "fill-shading",
  "fill-pattern",
  "fill-axis-top-color",
  "fill-axis-bottom-color",
  "fill-shading-angle",
  "fill-radial-inner-color",
  "fill-radial-outer-color",
  "fill-ball-color",
  "fill-pattern-color",
  "fill-pattern-angle",
  "fill-pattern-distance",
  "fill-pattern-xshift",
  "fill-pattern-yshift",
  "fill-pattern-line-width",
  "fill-pattern-radius",
  "fill-pattern-points"
]);
export const COMPACT_PAIR_IDS = new Set([
  "xshift:yshift",
  "xscale:yscale",
  "grid-xstep:grid-ystep",
  "node-minimum-width:node-minimum-height",
  "node-text-align:node-text-width",
  "shadow-xshift:shadow-yshift"
]);
export type LineWidthDropdownValue = string;
export type ArrowTipDropdownValue = ArrowTipPresetId | typeof ARROW_TIP_MIXED_OPTION_VALUE;
export type DashStyleDropdownValue = DashStylePresetId | typeof DASH_STYLE_MIXED_OPTION_VALUE;
export type LineCapDropdownValue = LineCapPresetId | typeof LINE_CAP_MIXED_OPTION_VALUE;
export type LineJoinDropdownValue = LineJoinPresetId | typeof LINE_JOIN_MIXED_OPTION_VALUE;
export type FillModeDropdownValue = FillModePresetId | typeof FILL_MODE_MIXED_OPTION_VALUE;
export type FillShadingDropdownValue = FillShadingPresetId | typeof FILL_SHADING_MIXED_OPTION_VALUE;
export type FillPatternDropdownValue = FillPatternPresetId | typeof FILL_PATTERN_MIXED_OPTION_VALUE;
export type NodeShapeDropdownValue = NodeShapePresetId | typeof NODE_SHAPE_MIXED_OPTION_VALUE;
export type NodeFontSizeDropdownValue = NodeFontSizePresetId | typeof NODE_FONT_SIZE_MIXED_OPTION_VALUE;
export type PathMorphingDecorationDropdownValue =
  | PathMorphingDecorationPresetId
  | typeof PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE;
export type ShadowPresetDropdownValue = ShadowPresetId | typeof SHADOW_PRESET_MIXED_OPTION_VALUE;

export const LINE_WIDTH_PRESET_BY_LABEL = new Map<string, number>(
  LINE_WIDTH_PRESETS.map((preset) => [preset.label, preset.value] as const)
);
export const LINE_WIDTH_DROPDOWN_OPTIONS: Array<CustomDropdownOption<LineWidthDropdownValue>> = [
  ...LINE_WIDTH_PRESETS.map((preset) => ({
    value: preset.label,
    label: preset.label
  })),
  {
    value: LINE_WIDTH_CUSTOM_OPTION_VALUE,
    label: "Custom line width"
  }
];
export function isStrokeMoreOptionsPropertyId(propertyId: string): boolean {
  return STROKE_MORE_OPTIONS_PROPERTY_IDS.has(propertyId);
}

export function isFillMoreOptionsPropertyId(propertyId: string): boolean {
  return FILL_MORE_OPTIONS_PROPERTY_IDS.has(propertyId);
}

export function isFillAdvancedPropertyId(propertyId: string): boolean {
  return FILL_ADVANCED_PROPERTY_IDS.has(propertyId);
}

export function isPathMorphingSuboptionPropertyId(propertyId: string): boolean {
  return PATH_MORPHING_SUBOPTION_PROPERTY_IDS.has(propertyId);
}

export function shouldAutoShowStrokeMoreOptions(property: InspectorProperty | MultiInspectorProperty): boolean {
  if (property.kind === "lineCap") {
    return property.value !== "butt" || ("mixed" in property && property.mixed);
  }
  if (property.kind === "lineJoin") {
    return property.value !== "miter" || ("mixed" in property && property.mixed);
  }
  if (property.kind === "number" && property.id === "stroke-opacity") {
    return property.value !== 1 || ("mixed" in property && property.mixed);
  }
  return false;
}

export function shouldAutoShowFillMoreOptions(property: InspectorProperty | MultiInspectorProperty): boolean {
  if (property.kind === "number" && property.id === "fill-opacity") {
    return property.value !== 1 || ("mixed" in property && property.mixed);
  }
  return false;
}

export function shouldAutoShowFillAdvancedOptions(property: InspectorProperty | MultiInspectorProperty): boolean {
  if (property.kind === "fillMode") {
    return property.value !== "solid" || ("mixed" in property && property.mixed);
  }
  if (property.kind === "fillShading" || property.kind === "fillPattern" || property.kind === "fillPatternOption") {
    return true;
  }
  return false;
}

export function shouldRenderCompactPair(
  left: InspectorProperty | MultiInspectorProperty | undefined,
  right: InspectorProperty | MultiInspectorProperty | undefined
): boolean {
  if (!left || !right) {
    return false;
  }
  const isNumberPair = left.kind === "number" && right.kind === "number";
  const isLengthPair = left.kind === "length" && right.kind === "length";
  const isNodeTextLayoutPair = left.kind === "nodeTextAlign" && right.kind === "optionalLength";
  if (!isNumberPair && !isLengthPair && !isNodeTextLayoutPair) {
    return false;
  }
  return COMPACT_PAIR_IDS.has(`${left.id}:${right.id}`);
}

export function buildMultiInspectorModel(descriptors: InspectorDescriptor[], selectionCount: number): MultiInspectorModel {
  if (descriptors.length === 0) {
    return {
      selectionCount,
      elementKinds: [],
      sections: []
    };
  }

  const first = descriptors[0];
  const sections: MultiInspectorSection[] = [];

  for (const baseSection of first.sections) {
    const matchingSections = descriptors
      .map((descriptor) => descriptor.sections.find((section) => section.id === baseSection.id))
      .filter((section): section is NonNullable<typeof section> => section != null);
    if (matchingSections.length !== descriptors.length) {
      continue;
    }

    const orderedPropertyIds: string[] = [];
    const seenPropertyIds = new Set<string>();
    for (const property of baseSection.properties) {
      if (seenPropertyIds.has(property.id)) {
        continue;
      }
      seenPropertyIds.add(property.id);
      orderedPropertyIds.push(property.id);
    }
    for (const section of matchingSections) {
      for (const property of section.properties) {
        if (seenPropertyIds.has(property.id)) {
          continue;
        }
        seenPropertyIds.add(property.id);
        orderedPropertyIds.push(property.id);
      }
    }

    const properties: MultiInspectorProperty[] = [];
    for (const propertyId of orderedPropertyIds) {
      const matchingProperties = matchingSections
        .map((section) => section.properties.find((property) => property.id === propertyId))
        .filter((property): property is InspectorProperty => property != null);
      if (matchingProperties.length === 0) {
        continue;
      }
      const allowPartial = OPTIONAL_MULTI_PROPERTY_IDS.has(propertyId);
      if (!allowPartial && matchingProperties.length !== descriptors.length) {
        continue;
      }
      const kinds = new Set(matchingProperties.map((property) => property.kind));
      if (kinds.size !== 1) {
        continue;
      }

      const multi = buildMultiInspectorProperty(matchingProperties);
      if (multi) {
        properties.push(multi);
      }
    }

    if (properties.length > 0) {
      sections.push({
        id: baseSection.id,
        title: baseSection.title,
        sourceLevel: baseSection.sourceLevel,
        properties
      });
    }
  }

  return {
    selectionCount,
    elementKinds: dedupeStrings(descriptors.map((descriptor) => descriptor.elementKind)),
    sections
  };
}

export function buildInspectorPropertyProvenanceMap(model: StylesCascadeModel): InspectorPropertyProvenanceMap {
  const map: InspectorPropertyProvenanceMap = {};
  for (const section of model.sections) {
    for (const declaration of section.declarations) {
      if (declaration.status !== "active" || declaration.propertyId == null || map[declaration.propertyId]) {
        continue;
      }

      if (section.kind === "command") {
        continue;
      }

      if (section.kind === "default") {
        map[declaration.propertyId] = {
          kind: "default",
          tooltip: "TikZ default"
        };
        continue;
      }

      const sourceLabel = section.title.trim() || "parent style";
      map[declaration.propertyId] = {
        kind: "inherited",
        sourceLabel,
        tooltip: `set by ${sourceLabel}`
      };
    }
  }
  return map;
}

export function resolveConsensusPropertyProvenance(
  propertyId: string,
  perElementProvenance: readonly InspectorPropertyProvenanceMap[],
  selectionCount: number
): InspectorPropertyProvenance | null {
  if (selectionCount <= 1 || perElementProvenance.length !== selectionCount) {
    return null;
  }

  let consensus: InspectorPropertyProvenance | null = null;
  for (const map of perElementProvenance) {
    const provenance = map[propertyId];
    if (!provenance) {
      return null;
    }
    if (!consensus) {
      consensus = provenance;
      continue;
    }
    if (consensus.kind !== provenance.kind) {
      return null;
    }
    if (consensus.kind === "inherited") {
      if (provenance.kind !== "inherited" || consensus.sourceLabel !== provenance.sourceLabel) {
        return null;
      }
    }
  }

  return consensus;
}

export function buildMultiInspectorPropertyProvenanceMap(
  model: MultiInspectorModel | null,
  perElementProvenance: readonly InspectorPropertyProvenanceMap[],
  selectionCount: number
): InspectorPropertyProvenanceMap {
  if (!model || selectionCount <= 1 || perElementProvenance.length !== selectionCount) {
    return {};
  }

  const map: InspectorPropertyProvenanceMap = {};
  for (const section of model.sections) {
    for (const property of section.properties) {
      if ("mixed" in property && property.mixed) {
        continue;
      }
      const consensus = resolveConsensusPropertyProvenance(property.id, perElementProvenance, selectionCount);
      if (consensus) {
        map[property.id] = consensus;
      }
    }
  }
  return map;
}

export function buildMultiInspectorProperty(properties: InspectorProperty[]): MultiInspectorProperty | null {
  const base = properties[0];
  if (!base) {
    return null;
  }

  if (base.kind === "enum") {
    const sameKind = properties.every((property) => property.kind === "enum");
    if (!sameKind) return null;
    const enumProperties = properties;
    const writes = enumProperties.map((property) => property.write);
    return {
      kind: "enum",
      id: base.id,
      label: base.label,
      value: enumProperties[0]?.value ?? "",
      mixed: !allValuesEqual(enumProperties.map((property) => property.value)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "boolean") {
    const sameKind = properties.every((property) => property.kind === "boolean");
    if (!sameKind) return null;
    const booleanProperties = properties;
    const writes = booleanProperties.map((property) => property.write);
    const clearKeys = allValuesEqual(booleanProperties.map((property) => (property.clearKeys ?? []).join("\n")))
      ? booleanProperties[0]?.clearKeys
      : undefined;
    const trueValue = allValuesEqual(booleanProperties.map((property) => property.trueValue ?? "true"))
      ? (booleanProperties[0]?.trueValue ?? undefined)
      : undefined;
    const falseValue = allValuesEqual(booleanProperties.map((property) => property.falseValue ?? "false"))
      ? (booleanProperties[0]?.falseValue ?? undefined)
      : undefined;
    return {
      kind: "boolean",
      id: base.id,
      label: base.label,
      value: booleanProperties[0]?.value ?? false,
      mixed: !allValuesEqual(booleanProperties.map((property) => property.value)),
      trueValue,
      falseValue,
      clearKeys,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "number") {
    const sameKind = properties.every((property) => property.kind === "number");
    if (!sameKind) return null;
    const numberProperties = properties;
    const writes = numberProperties
      .map((property) => property.write)
      .filter((write): write is SetPropertyWriteTarget => write?.mode === "setProperty");
    const clearKeys = allValuesEqual(numberProperties.map((property) => (property.clearKeys ?? []).join("\n")))
      ? numberProperties[0]?.clearKeys
      : undefined;

    return {
      kind: "number",
      id: base.id,
      label: base.label,
      value: numberProperties[0]?.value ?? 0,
      mixed: !numbersAreEqual(numberProperties.map((property) => property.value)),
      step: base.step,
      min: numberProperties.every((property) => property.min != null)
        ? Math.max(...numberProperties.map((property) => property.min as number))
        : undefined,
      minExclusive: numberProperties.every((property) => property.minExclusive != null)
        ? Math.max(...numberProperties.map((property) => property.minExclusive as number))
        : undefined,
      max: numberProperties.every((property) => property.max != null)
        ? Math.min(...numberProperties.map((property) => property.max as number))
        : undefined,
      unit: base.unit,
      defaultValue: consensusDefaultValue(numberProperties),
      clearKeys,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "length") {
    const sameKind = properties.every((property) => property.kind === "length");
    if (!sameKind) return null;
    const lengthProperties = properties;
    const values = lengthProperties.map((property) => property.value);
    const writes = lengthProperties.map((property) => property.write);
    const notes = lengthProperties.map((property) => property.note ?? null);
    const clearKeys = allValuesEqual(lengthProperties.map((property) => (property.clearKeys ?? []).join("\n")))
      ? lengthProperties[0]?.clearKeys
      : undefined;

    return {
      kind: "length",
      id: base.id,
      label: base.label,
      value: values[0] ?? 0,
      mixed: !numbersAreEqual(values),
      step: base.step,
      unit: base.unit,
      defaultValue: consensusDefaultValue(lengthProperties),
      clearKeys,
      writes,
      note: allValuesEqual(notes) ? (notes[0] ?? undefined) : undefined,
      minimumDimensionsContexts: lengthProperties.map((property) => property.minimumDimensionsContext).every((context) => context != null)
        ? (lengthProperties.map((property) => property.minimumDimensionsContext as NodeMinimumDimensionsMutationContext))
        : undefined,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "optionalLength") {
    const sameKind = properties.every((property) => property.kind === "optionalLength");
    if (!sameKind) return null;
    const optionalLengthProperties = properties;
    const values = optionalLengthProperties.map((property) => property.value);
    const writes = optionalLengthProperties.map((property) => property.write);
    const notes = optionalLengthProperties.map((property) => property.note ?? null);
    const clearKeys = allValuesEqual(optionalLengthProperties.map((property) => (property.clearKeys ?? []).join("\n")))
      ? optionalLengthProperties[0]?.clearKeys
      : undefined;

    return {
      kind: "optionalLength",
      id: base.id,
      label: base.label,
      value: values[0] ?? null,
      mixed: !allValuesEqual(values),
      step: base.step,
      unit: base.unit,
      clearKeys,
      writes,
      note: allValuesEqual(notes) ? (notes[0] ?? undefined) : undefined,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "nodeShape") {
    const sameKind = properties.every((property) => property.kind === "nodeShape");
    if (!sameKind) return null;
    const shapeProperties = properties;
    const values = shapeProperties.map((property) => property.value);
    const writes = shapeProperties.map((property) => property.write);
    const notes = shapeProperties.map((property) => property.note ?? null);

    return {
      kind: "nodeShape",
      id: base.id,
      label: base.label,
      value: values[0] ?? "rectangle",
      mixed: !allValuesEqual(values),
      options: base.options,
      writes,
      note: allValuesEqual(notes) ? (notes[0] ?? undefined) : undefined,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "nodeTextAlign") {
    const sameKind = properties.every((property) => property.kind === "nodeTextAlign");
    if (!sameKind) return null;
    const alignProperties = properties;
    const values = alignProperties.map((property) => property.value);
    const writes = alignProperties.map((property) => property.write);
    const clearKeys = allValuesEqual(alignProperties.map((property) => (property.clearKeys ?? []).join("\n")))
      ? alignProperties[0]?.clearKeys
      : undefined;

    return {
      kind: "nodeTextAlign",
      id: base.id,
      label: base.label,
      value: values[0] ?? "unset",
      mixed: !allValuesEqual(values),
      writes,
      clearKeys,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "nodeFont") {
    const sameKind = properties.every((property) => property.kind === "nodeFont");
    if (!sameKind) return null;
    const fontProperties = properties;
    const writes = fontProperties.map((property) => property.write);
    const families = fontProperties.map((property) => property.family);
    const weights = fontProperties.map((property) => property.weight);
    const styles = fontProperties.map((property) => property.style);
    const sizePresets = fontProperties.map((property) => property.sizePreset);
    const customSizes = fontProperties.map((property) => property.customSizePt);
    const notes = dedupeStrings(
      fontProperties
        .map((property) => property.note?.trim() ?? "")
        .filter((note) => note.length > 0)
    );

    return {
      kind: "nodeFont",
      id: base.id,
      label: base.label,
      family: families[0] ?? "serif",
      familyMixed: !allValuesEqual(families),
      weight: weights[0] ?? "normal",
      weightMixed: !allValuesEqual(weights),
      style: styles[0] ?? "normal",
      styleMixed: !allValuesEqual(styles),
      sizePreset: sizePresets[0] ?? "normalsize",
      sizePresetMixed: !allValuesEqual(sizePresets),
      customSizePt:
        allValuesEqual(customSizes) && sizePresets[0] === "custom"
          ? (customSizes[0] ?? null)
          : null,
      sizeOptions: base.sizeOptions,
      contexts: fontProperties.map((property) => ({
        context: property.context,
        values: {
          family: property.family,
          weight: property.weight,
          style: property.style,
          sizePreset: property.sizePreset,
          customSizePt: property.customSizePt
        }
      })),
      writes,
      notes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "color") {
    const sameKind = properties.every((property) => property.kind === "color");
    if (!sameKind) return null;
    const colorProperties = properties;
    const values = colorProperties.map((property) => property.value);
    const syntaxValues = colorProperties.map((property) => property.syntaxValue);
    const mixed = !allValuesEqual(values) || !allValuesEqual(syntaxValues);
    const writes = colorProperties.map((property) => property.write);

    return {
      kind: "color",
      id: base.id,
      label: base.label,
      value: mixed ? null : (values[0] ?? null),
      syntaxValue: mixed ? null : (syntaxValues[0] ?? null),
      mixed,
      options: dedupeStrings(colorProperties.flatMap((property) => property.options)),
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "fillMode") {
    const sameKind = properties.every((property) => property.kind === "fillMode");
    if (!sameKind) return null;
    const fillModeProperties = properties;
    const values = fillModeProperties.map((property) => property.value);
    const writes = fillModeProperties.map((property) => property.write);

    return {
      kind: "fillMode",
      id: base.id,
      label: base.label,
      value: values[0] ?? "solid",
      mixed: !allValuesEqual(values),
      options: base.options,
      contexts: fillModeProperties.map((property) => property.context),
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "fillShading") {
    const sameKind = properties.every((property) => property.kind === "fillShading");
    if (!sameKind) return null;
    const fillShadingProperties = properties;
    const values = fillShadingProperties.map((property) => property.value);
    const notes = fillShadingProperties.map((property) => property.note ?? null);
    const writes = fillShadingProperties.map((property) => property.write);

    return {
      kind: "fillShading",
      id: base.id,
      label: base.label,
      value: values[0] ?? "axis",
      mixed: !allValuesEqual(values),
      options: base.options,
      writes,
      note: allValuesEqual(notes) ? (notes[0] ?? undefined) : undefined,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "fillPattern") {
    const sameKind = properties.every((property) => property.kind === "fillPattern");
    if (!sameKind) return null;
    const fillPatternProperties = properties;
    const values = fillPatternProperties.map((property) => property.value);
    const notes = fillPatternProperties.map((property) => property.note ?? null);
    const writes = fillPatternProperties.map((property) => property.write);

    return {
      kind: "fillPattern",
      id: base.id,
      label: base.label,
      value: values[0] ?? "dots",
      mixed: !allValuesEqual(values),
      options: base.options,
      writes,
      note: allValuesEqual(notes) ? (notes[0] ?? undefined) : undefined,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "fillPatternOption") {
    const sameKind = properties.every((property) => property.kind === "fillPatternOption");
    if (!sameKind) return null;
    const fillPatternOptionProperties = properties;
    const values = fillPatternOptionProperties.map((property) => property.value);
    const writes = fillPatternOptionProperties.map((property) => property.write);

    return {
      kind: "fillPatternOption",
      id: base.id,
      label: base.label,
      option: base.option,
      value: values[0] ?? 0,
      mixed: !numbersAreEqual(values),
      step: base.step,
      unit: base.unit,
      contexts: fillPatternOptionProperties.map((property) => property.context),
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "lineWidth") {
    const sameKind = properties.every((property) => property.kind === "lineWidth");
    if (!sameKind) return null;
    const widthProperties = properties;
    const values = widthProperties.map((property) => property.value);
    const writes = widthProperties.map((property) => property.write);

    return {
      kind: "lineWidth",
      id: base.id,
      label: base.label,
      value: values[0] ?? 0,
      averageValue: averageNumbers(values),
      mixed: !numbersAreEqual(values),
      min: base.min,
      max: base.max,
      step: base.step,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "dashStyle") {
    const sameKind = properties.every((property) => property.kind === "dashStyle");
    if (!sameKind) return null;
    const dashProperties = properties;
    const values = dashProperties.map((property) => property.value);
    const writes = dashProperties.map((property) => property.write);

    return {
      kind: "dashStyle",
      id: base.id,
      label: base.label,
      value: values[0] ?? "solid",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(dashProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "lineCap") {
    const sameKind = properties.every((property) => property.kind === "lineCap");
    if (!sameKind) return null;
    const lineCapProperties = properties;
    const values = lineCapProperties.map((property) => property.value);
    const writes = lineCapProperties.map((property) => property.write);

    return {
      kind: "lineCap",
      id: base.id,
      label: base.label,
      value: values[0] ?? "butt",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(lineCapProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "lineJoin") {
    const sameKind = properties.every((property) => property.kind === "lineJoin");
    if (!sameKind) return null;
    const lineJoinProperties = properties;
    const values = lineJoinProperties.map((property) => property.value);
    const writes = lineJoinProperties.map((property) => property.write);

    return {
      kind: "lineJoin",
      id: base.id,
      label: base.label,
      value: values[0] ?? "miter",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(lineJoinProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "pathMorphingDecoration") {
    const sameKind = properties.every((property) => property.kind === "pathMorphingDecoration");
    if (!sameKind) return null;
    const pathMorphingProperties = properties;
    const values = pathMorphingProperties.map((property) => property.value);
    const writes = pathMorphingProperties.map((property) => property.write);

    return {
      kind: "pathMorphingDecoration",
      id: base.id,
      label: base.label,
      value: values[0] ?? "none",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(pathMorphingProperties.map((property) => property.previewLineWidth)),
      options: base.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "roundedCorners") {
    const sameKind = properties.every((property) => property.kind === "roundedCorners");
    if (!sameKind) return null;
    const roundedProperties = properties;
    const enabledValues = roundedProperties.map((property) => property.enabled);
    const writes = roundedProperties.map((property) => property.write);
    const anyEnabled = enabledValues.some(Boolean);
    const min = Math.max(...roundedProperties.map((property) => property.min));
    const max = Math.max(min, Math.min(...roundedProperties.map((property) => property.max)));
    const defaultRadius = clampNumber(
      roundedProperties[0]?.defaultRadius ?? ROUNDED_CORNERS_DEFAULT_RADIUS,
      min,
      max
    );
    const enabledRadii = roundedProperties
      .filter((property) => property.enabled)
      .map((property) => clampNumber(property.radius, min, max));
    const averageEnabledRadius = enabledRadii.length > 0 ? averageNumbers(enabledRadii) : defaultRadius;
    const radiusValues = roundedProperties.map((property) =>
      property.enabled ? clampNumber(property.radius, min, max) : defaultRadius
    );
    const mixed = !allValuesEqual(enabledValues) || (anyEnabled && !numbersAreEqual(enabledRadii));

    return {
      kind: "roundedCorners",
      id: base.id,
      label: base.label,
      enabled: enabledValues.every(Boolean),
      anyEnabled,
      disableRequiresSharpCorners: roundedProperties.some((property) => property.disableRequiresSharpCorners),
      radius: radiusValues[0] ?? defaultRadius,
      averageRadius: averageEnabledRadius,
      defaultRadius,
      min,
      max,
      step: base.step,
      mixed,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "arrowTip") {
    const sameKind = properties.every((property) => property.kind === "arrowTip");
    if (!sameKind) return null;
    const arrowBase = base;
    const arrowProperties = properties;
    const values = arrowProperties.map((property) => property.value);
    const writes = arrowProperties.map((property) => property.write);

    return {
      kind: "arrowTip",
      id: arrowBase.id,
      label: arrowBase.label,
      side: arrowBase.side,
      value: values[0] ?? "none",
      mixed: !allValuesEqual(values),
      previewLineWidth: averageNumbers(arrowProperties.map((property) => property.previewLineWidth)),
      options: arrowBase.options,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  if (base.kind === "shadowPreset") {
    const sameKind = properties.every((property) => property.kind === "shadowPreset");
    if (!sameKind) return null;
    const shadowBase = base;
    const shadowProperties = properties;
    const values = shadowProperties.map((property) => property.value);
    const writes = shadowProperties.map((property) => property.write);
    const contexts = shadowProperties.map((property) => property.context);

    return {
      kind: "shadowPreset",
      id: shadowBase.id,
      label: shadowBase.label,
      value: values[0] ?? "none",
      mixed: !allValuesEqual(values),
      options: shadowBase.options,
      contexts,
      writes,
      readOnlyReason: deriveReadOnlyReason(writes)
    };
  }

  return null;
}

function consensusDefaultValue(properties: ReadonlyArray<{ defaultValue?: number }>): number | undefined {
  const values = properties.map((property) => property.defaultValue);
  if (values.some((value) => value == null)) {
    return undefined;
  }
  const numericValues = values as number[];
  return numbersAreEqual(numericValues) ? numericValues[0] : undefined;
}

export function deriveReadOnlyReason(
  writes: readonly Pick<SetPropertyWriteTarget, "writable" | "elementId" | "reason">[]
): string | undefined {
  if (writes.some((write) => write.writable && write.elementId.length > 0)) {
    return undefined;
  }

  const firstReason = writes.find((write) => (write.reason ?? "").trim().length > 0)?.reason;
  if (firstReason) {
    return firstReason;
  }

  return "This property is read-only for the current selection.";
}

export function numbersAreEqual(values: readonly number[]): boolean {
  if (values.length <= 1) return true;
  const first = values[0] ?? 0;
  return values.every((value) => Math.abs(value - first) <= VALUE_EPSILON);
}

export function averageNumbers(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function allValuesEqual(values: readonly unknown[]): boolean {
  if (values.length <= 1) return true;
  const first = values[0];
  return values.every((value) => value === first);
}

export function lineWidthPresetLabelFromValue(value: number): string | null {
  for (const preset of LINE_WIDTH_PRESETS) {
    if (Math.abs(preset.value - value) <= LINE_WIDTH_PRESET_EPSILON) {
      return preset.label;
    }
  }
  return null;
}

export function lineWidthValueLabel(value: LineWidthDropdownValue): string {
  if (value === LINE_WIDTH_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === LINE_WIDTH_CUSTOM_OPTION_VALUE) {
    return "Custom line width";
  }
  return LINE_WIDTH_PRESET_BY_LABEL.has(value) ? value : "Custom line width";
}

export function lineWidthPreviewLineWidth(value: LineWidthDropdownValue, fallbackLineWidth: number): number {
  if (value === LINE_WIDTH_CUSTOM_OPTION_VALUE || value === LINE_WIDTH_MIXED_OPTION_VALUE) {
    return fallbackLineWidth;
  }
  return LINE_WIDTH_PRESET_BY_LABEL.get(value) ?? fallbackLineWidth;
}

export function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
}

export function sameOrderedStringArrays(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

export function toNodeShapeDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<NodeShapePresetId, "custom">; label: string }>
): Array<CustomDropdownOption<NodeShapeDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function nodeShapeValueLabel(
  value: NodeShapeDropdownValue,
  options: ReadonlyArray<{ value: Exclude<NodeShapePresetId, "custom">; label: string }>
): string {
  if (value === NODE_SHAPE_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableNodeShapeValue(
  value: NodeShapeDropdownValue
): value is Exclude<NodeShapePresetId, "custom"> {
  return value !== "custom" && value !== NODE_SHAPE_MIXED_OPTION_VALUE;
}

export function toNodeFontSizeDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<NodeFontSizePresetId, "custom">; label: string }>
): Array<CustomDropdownOption<NodeFontSizeDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function nodeFontSizeValueLabel(
  value: NodeFontSizeDropdownValue,
  options: ReadonlyArray<{ value: Exclude<NodeFontSizePresetId, "custom">; label: string }>,
  customSizePt: number | null
): string {
  if (value === NODE_FONT_SIZE_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return Number.isFinite(customSizePt) && (customSizePt ?? 0) > 0
      ? `Custom (${formatNumber(customSizePt as number)}pt)`
      : "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function nodeFontSizePresetPtLabel(value: Exclude<NodeFontSizePresetId, "custom">): string {
  const pt = NODE_FONT_SIZE_PT_BY_PRESET[value];
  return `${formatNumber(pt)}pt`;
}

export function isSelectableNodeFontSizeValue(
  value: NodeFontSizeDropdownValue
): value is Exclude<NodeFontSizePresetId, "custom"> {
  return value !== "custom" && value !== NODE_FONT_SIZE_MIXED_OPTION_VALUE;
}

export function nodeFontButtonClass(active: boolean, mixed: boolean): string {
  return [
    css.nodeFontIconButton,
    active ? css.nodeFontIconButtonActive : "",
    mixed ? css.nodeFontIconButtonMixed : ""
  ]
    .filter(Boolean)
    .join(" ");
}

export function toFillModeDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<FillModePresetId, "custom">; label: string }>
): Array<CustomDropdownOption<FillModeDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function fillModeValueLabel(
  value: FillModeDropdownValue,
  options: ReadonlyArray<{ value: Exclude<FillModePresetId, "custom">; label: string }>
): string {
  if (value === FILL_MODE_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableFillModeValue(
  value: FillModeDropdownValue
): value is Exclude<FillModePresetId, "custom"> {
  return value !== "custom" && value !== FILL_MODE_MIXED_OPTION_VALUE;
}

export function toFillShadingDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<FillShadingPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<FillShadingDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function fillShadingValueLabel(
  value: FillShadingDropdownValue,
  options: ReadonlyArray<{ value: Exclude<FillShadingPresetId, "custom">; label: string }>
): string {
  if (value === FILL_SHADING_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableFillShadingValue(
  value: FillShadingDropdownValue
): value is Exclude<FillShadingPresetId, "custom"> {
  return value !== "custom" && value !== FILL_SHADING_MIXED_OPTION_VALUE;
}

export function toFillPatternDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<FillPatternPresetId, "custom">; label: string }>
): Array<CustomDropdownItem<FillPatternDropdownValue>> {
  const metaOptions = options.filter((option) => isMetaFillPatternPreset(option.value));
  const legacyOptions = options.filter((option) => !isMetaFillPatternPreset(option.value));
  const dropdownOptions: Array<CustomDropdownItem<FillPatternDropdownValue>> = [
    ...metaOptions.map((option) => ({
      value: option.value,
      label: option.label
    }))
  ];
  if (metaOptions.length > 0 && legacyOptions.length > 0) {
    dropdownOptions.push({ kind: "separator", id: "fill-pattern-dropdown-divider" });
  }
  dropdownOptions.push(
    ...legacyOptions.map((option) => ({
      value: option.value,
      label: option.label
    }))
  );
  return dropdownOptions;
}

export function fillPatternValueLabel(
  value: FillPatternDropdownValue,
  options: ReadonlyArray<{ value: Exclude<FillPatternPresetId, "custom">; label: string }>
): string {
  if (value === FILL_PATTERN_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableFillPatternValue(
  value: FillPatternDropdownValue
): value is Exclude<FillPatternPresetId, "custom"> {
  return value !== "custom" && value !== FILL_PATTERN_MIXED_OPTION_VALUE;
}

export function isMetaFillPatternPreset(value: Exclude<FillPatternPresetId, "custom">): boolean {
  return META_FILL_PATTERN_PRESETS.has(value);
}

export function fillPatternPreviewPreset(
  value: FillPatternDropdownValue
): Exclude<FillPatternPresetId, "custom"> {
  if (value === FILL_PATTERN_MIXED_OPTION_VALUE || value === "custom") {
    return "Lines";
  }
  return value;
}

export function toDashStyleDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<DashStylePresetId, "custom">; label: string }>
): Array<CustomDropdownOption<DashStyleDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function dashStyleValueLabel(
  value: DashStyleDropdownValue,
  options: ReadonlyArray<{ value: Exclude<DashStylePresetId, "custom">; label: string }>
): string {
  if (value === DASH_STYLE_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableDashStyleValue(
  value: DashStyleDropdownValue
): value is Exclude<DashStylePresetId, "custom"> {
  return value !== "custom" && value !== DASH_STYLE_MIXED_OPTION_VALUE;
}

export function dashStylePreviewPreset(value: DashStyleDropdownValue): Exclude<DashStylePresetId, "custom"> {
  if (value === DASH_STYLE_MIXED_OPTION_VALUE || value === "custom") {
    return "dashed";
  }
  return value;
}

export function toLineCapDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<LineCapPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<LineCapDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function lineCapValueLabel(
  value: LineCapDropdownValue,
  options: ReadonlyArray<{ value: Exclude<LineCapPresetId, "custom">; label: string }>
): string {
  if (value === LINE_CAP_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableLineCapValue(
  value: LineCapDropdownValue
): value is Exclude<LineCapPresetId, "custom"> {
  return value !== "custom" && value !== LINE_CAP_MIXED_OPTION_VALUE;
}

export function lineCapPreviewPreset(value: LineCapDropdownValue): Exclude<LineCapPresetId, "custom"> {
  if (value === LINE_CAP_MIXED_OPTION_VALUE || value === "custom") {
    return "butt";
  }
  return value;
}

export function toLineJoinDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<LineJoinDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function lineJoinValueLabel(
  value: LineJoinDropdownValue,
  options: ReadonlyArray<{ value: Exclude<LineJoinPresetId, "custom">; label: string }>
): string {
  if (value === LINE_JOIN_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableLineJoinValue(
  value: LineJoinDropdownValue
): value is Exclude<LineJoinPresetId, "custom"> {
  return value !== "custom" && value !== LINE_JOIN_MIXED_OPTION_VALUE;
}

export function lineJoinPreviewPreset(value: LineJoinDropdownValue): Exclude<LineJoinPresetId, "custom"> {
  if (value === LINE_JOIN_MIXED_OPTION_VALUE || value === "custom") {
    return "miter";
  }
  return value;
}

export function toPathMorphingDecorationDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<PathMorphingDecorationDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function pathMorphingDecorationValueLabel(
  value: PathMorphingDecorationDropdownValue,
  options: ReadonlyArray<{ value: Exclude<PathMorphingDecorationPresetId, "custom">; label: string }>
): string {
  if (value === PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectablePathMorphingDecorationValue(
  value: PathMorphingDecorationDropdownValue
): value is Exclude<PathMorphingDecorationPresetId, "custom"> {
  return value !== "custom" && value !== PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE;
}

export function pathMorphingDecorationPreviewPreset(
  value: PathMorphingDecorationDropdownValue
): Exclude<PathMorphingDecorationPresetId, "custom"> {
  if (value === PATH_MORPHING_DECORATION_MIXED_OPTION_VALUE || value === "custom") {
    return "zigzag";
  }
  return value;
}

export function toArrowTipDropdownOptions(
  options: ReadonlyArray<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>
): Array<CustomDropdownOption<ArrowTipDropdownValue>> {
  return options.map((option) => ({
    value: option.value,
    label: option.label
  }));
}

export function arrowTipValueLabel(
  value: ArrowTipDropdownValue,
  options: ReadonlyArray<{ value: Exclude<ArrowTipPresetId, "custom">; label: string }>
): string {
  if (value === ARROW_TIP_MIXED_OPTION_VALUE) {
    return "Mixed";
  }
  if (value === "custom") {
    return "Custom";
  }
  return options.find((option) => option.value === value)?.label ?? "Custom";
}

export function isSelectableArrowTipValue(
  value: ArrowTipDropdownValue
): value is Exclude<ArrowTipPresetId, "custom"> {
  return value !== "custom" && value !== ARROW_TIP_MIXED_OPTION_VALUE;
}

export function toShadowPresetDropdownOptions(
  options: ShadowPresetOption[]
): Array<CustomDropdownOption<ShadowPresetDropdownValue>> {
  return [
    { value: "none", label: "None" },
    ...options.map((option) => ({ value: option.value, label: option.label }))
  ];
}

export function shadowPresetValueLabel(
  value: ShadowPresetDropdownValue,
  options: ShadowPresetOption[]
): string {
  if (value === SHADOW_PRESET_MIXED_OPTION_VALUE) return "Mixed";
  if (value === "none") return "None";
  return options.find((o) => o.value === value)?.label ?? value;
}

export function isSelectableShadowPresetValue(
  value: ShadowPresetDropdownValue
): value is ShadowPresetId {
  return value !== SHADOW_PRESET_MIXED_OPTION_VALUE;
}

export function arrowTipPreviewPreset(value: ArrowTipDropdownValue): Exclude<ArrowTipPresetId, "custom"> {
  if (value === ARROW_TIP_MIXED_OPTION_VALUE || value === "custom") {
    return "arrow";
  }
  return value;
}

export function LineWidthPreview({ lineWidth }: { lineWidth: number }) {
  const strokeWidth = Math.max(1, Math.min(12, lineWidth * 2));
  return (
    <svg className={css.lineWidthSvg} viewBox="0 0 56 16" aria-hidden="true" focusable="false">
      <line x1={4} y1={8} x2={52} y2={8} className={css.lineWidthSvgLine} style={{ strokeWidth }} />
    </svg>
  );
}

export function DashStylePreview({
  preset,
  lineWidth
}: {
  preset: Exclude<DashStylePresetId, "custom">;
  lineWidth: number;
}) {
  const dashArray = dashStyleDashArrayForPreview(preset, lineWidth);
  const strokeWidth = Math.max(1, Math.min(3.2, lineWidth * 1.4));
  return (
    <svg className={css.dashStyleSvg} viewBox="0 0 56 16" aria-hidden="true" focusable="false">
      <line
        x1={4}
        y1={8}
        x2={52}
        y2={8}
        className={css.dashStyleSvgLine}
        style={dashArray ? { strokeDasharray: dashArray, strokeWidth } : { strokeWidth }}
      />
    </svg>
  );
}

export function dashStyleDashArrayForPreview(
  preset: Exclude<DashStylePresetId, "custom">,
  lineWidth: number
): string | undefined {
  if (preset === "solid") {
    return undefined;
  }
  if (preset === "dashed") {
    return "3 3";
  }
  if (preset === "densely dashed") {
    return "4 2";
  }
  if (preset === "loosely dashed") {
    return "6 4";
  }
  if (preset === "dotted") {
    return `${formatNumber(lineWidth)} 2`;
  }
  if (preset === "densely dotted") {
    return `${formatNumber(lineWidth)} 1`;
  }
  return `${formatNumber(lineWidth)} 4`;
}

export function LineCapPreview({
  preset
}: {
  preset: Exclude<LineCapPresetId, "custom">;
  lineWidth: number;
}) {
  const strokeWidth = 8;
  const baseStart = 18;
  const baseEnd = 46;
  const y = 10;
  return (
    <svg className={css.lineCapSvg} viewBox="0 0 64 20" aria-hidden="true" focusable="false">
      <line x1={baseStart} y1={2} x2={baseStart} y2={18} className={css.lineCapSvgGuide} />
      <line x1={baseEnd} y1={2} x2={baseEnd} y2={18} className={css.lineCapSvgGuide} />
      <line
        x1={baseStart}
        y1={y}
        x2={baseEnd}
        y2={y}
        className={css.lineCapSvgLine}
        style={{ strokeLinecap: preset, strokeWidth }}
      />
      <line x1={baseStart} y1={y} x2={baseEnd} y2={y} className={css.lineCapSvgCenter} />
    </svg>
  );
}

export function LineJoinPreview({
  preset
}: {
  preset: Exclude<LineJoinPresetId, "custom">;
  lineWidth: number;
}) {
  const strokeWidth = 8;
  const points = "8,16 24,4 40,16 56,4";
  return (
    <svg className={css.lineJoinSvg} viewBox="0 0 64 20" aria-hidden="true" focusable="false">
      <polyline
        points={points}
        className={css.lineJoinSvgLine}
        style={{ strokeLinejoin: preset, strokeWidth, strokeMiterlimit: 10 }}
      />
      <polyline points={points} className={css.lineJoinSvgCenter} />
    </svg>
  );
}

export function PathMorphingDecorationPreview({
  preset,
  lineWidth
}: {
  preset: Exclude<PathMorphingDecorationPresetId, "custom">;
  lineWidth: number;
}) {
  const svgMarkup = renderPathMorphingDecorationPreviewSvg(preset, lineWidth);
  return (
    <span
      className={css.pathMorphingDecorationSvg}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}

export function FillPatternPreview({
  preset
}: {
  preset: Exclude<FillPatternPresetId, "custom">;
}) {
  const svgMarkup = renderFillPatternPreviewSvg(preset);
  return (
    <span
      className={css.fillPatternSvg}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
}

export function ArrowTipPreview({
  side,
  preset,
  lineWidth
}: {
  side: ArrowTipSide;
  preset: Exclude<ArrowTipPresetId, "custom">;
  lineWidth: number;
}) {
  const y = 8;
  const lineMin = 4;
  const lineMax = 52;
  const strokeWidth = Math.max(1, Math.min(3.2, lineWidth * 1.4));
  const tipScale = 2.35;
  const tipKind = arrowTipKindForPreview(preset);
  const marker = tipKind ? makeDefaultArrowMarker(tipKind, lineWidth) : null;
  const tip = marker?.tips[0] ?? null;
  const preview = tip ? renderArrowTipPreviewPaths(tip, lineWidth, "currentColor", { anchor: "back" }) : null;
  const previewPaths = preview?.paths ?? [];
  const directionScale = side === "start" ? -1 : 1;
  const rawForwardExtentPx = preview ? Math.max(0, preview.xBounds.max * tipScale) : 0;
  const maxForwardExtentPx = Math.max(0, lineMax - lineMin - 10);
  const forwardExtentPx = Math.min(rawForwardExtentPx, maxForwardExtentPx);
  const tipX = side === "start" ? lineMin + forwardExtentPx : lineMax - forwardExtentPx;
  const shaftStart = side === "start" ? tipX : lineMin;
  const shaftEnd = side === "start" ? lineMax : tipX;

  return (
    <svg className={css.arrowTipSvg} viewBox="0 0 56 16" aria-hidden="true" focusable="false">
      <line
        x1={shaftStart}
        y1={y}
        x2={shaftEnd}
        y2={y}
        className={css.arrowTipSvgLine}
        style={{ strokeWidth }}
      />
      {previewPaths.length > 0 ? (
        <g transform={`translate(${tipX} ${y}) scale(${directionScale * tipScale} ${-tipScale})`}>
          {previewPaths.map((path, index) => (
            <path
              // preview path order is deterministic from core arrow shape generation
              key={`${preset}:${index}`}
              d={path.d}
              stroke={path.stroke}
              fill={path.fill}
              strokeWidth={path.strokeWidth}
              strokeLinecap={path.lineCap}
              strokeLinejoin={path.lineJoin}
            />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

export function arrowTipKindForPreview(preset: Exclude<ArrowTipPresetId, "custom">): ArrowTipKind | null {
  if (preset === "none") {
    return null;
  }
  if (preset === "arrow") {
    return "cm-rightarrow";
  }
  if (preset === "stealth") {
    return "stealth";
  }
  if (preset === "latex") {
    return "latex";
  }
  if (preset === "triangle") {
    return "triangle";
  }
  if (preset === "circle") {
    return "circle";
  }
  if (preset === "square") {
    return "square";
  }
  if (preset === "kite") {
    return "kite";
  }
  if (preset === "bar") {
    return "bar";
  }
  return "hooks";
}
