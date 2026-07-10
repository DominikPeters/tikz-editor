import type { NodeFontMutationContext } from "../property-write-builders.js";
import {
  PATH_ATTACHED_NODE_POSITION_VALUE_KEY,
  PATH_ATTACHED_NODE_SIDE_KEY
} from "../path-attached-node-keys.js";
import { normalizeOptionKey } from "../option-key.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { PATH_POSITION_PRESETS, resolvePathPositionPreset } from "../../semantic/path/path-attached.js";
import { DEFAULT_TEXT_FONT_SIZE } from "../../semantic/style/constants.js";
import { parseFontStyle, stripEnclosingBraces } from "../../semantic/style/option-utils.js";
import type { ResolvedStyle, SceneElement } from "../../semantic/types.js";
import { colorOptionsForValue, normalizeInspectorColorValue, resolveColorSyntaxValue } from "./color-syntax.js";
import {
  CURATED_NODE_SHAPE_SET,
  NODE_FONT_CUSTOM_NOTE,
  NODE_FONT_SIZE_EPSILON,
  NODE_FONT_SIZE_PRESETS,
  NODE_INNER_SEP_CONFLICT_NOTE,
  NODE_INNER_SEP_DEFAULT,
  NODE_MINIMUM_DIMENSION_CONFLICT_NOTE,
  NODE_MINIMUM_DIMENSION_DEFAULT,
  NODE_SHAPE_CUSTOM_NOTE,
  NODE_SHAPE_KEY,
  NODE_SHAPE_KNOWN_SET,
  NODE_SHAPE_OPTIONS
} from "./presets.js";
import type { NodeFontFamilyId, NodeFontSizePresetId, NodeShapePresetId } from "./presets.js";
import { resolveNodeShapeAdaptiveControls, type ShapeAdaptiveControl } from "./shape-adaptive-controls.js";
import type { InspectorSectionBuildContext, SectionBuilder } from "./section-builder.js";
import type { InspectorProperty, NodeTextAlignInspectorValue } from "./types.js";

const NODE_TARGET_KINDS = new Set(["node-item", "matrix-cell", "tree-child"]);

type NodeInspectorState = {
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
};

export const buildNodeSection: SectionBuilder = (context) => {
  if (!context.targetKind || !NODE_TARGET_KINDS.has(context.targetKind)) return null;
  const state = resolveNodeInspectorState(context);
  const textColor = normalizeInspectorColorValue(context.element.style.textColor);
  const textColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["text", "color"],
    textColor,
    context.colorAliases,
    context.element.styleChain
  );
  const shapeAdaptiveProperties = state.shapeAdaptiveControls.map((control) =>
    shapeAdaptiveInspectorProperty(context, control)
  );

  return {
    id: "node",
    title: "Node",
    sourceLevel: "command",
    properties: [
      {
        kind: "nodeShape",
        id: "node-shape",
        label: "Shape",
        value: state.shape,
        options: NODE_SHAPE_OPTIONS,
        note: state.shapeNote,
        write: context.writeProperty(NODE_SHAPE_KEY)
      },
      ...shapeAdaptiveProperties,
      {
        kind: "length",
        id: "node-inner-sep",
        label: "Inner sep",
        value: state.innerSep,
        step: 0.1,
        unit: "pt",
        defaultValue: NODE_INNER_SEP_DEFAULT,
        note: state.innerSepNote,
        write: context.writeProperty("inner sep")
      },
      {
        kind: "length",
        id: "node-minimum-width",
        label: "Minimum width",
        value: state.minimumWidth,
        step: 0.1,
        unit: "pt",
        defaultValue: NODE_MINIMUM_DIMENSION_DEFAULT,
        note: state.minimumWidthNote,
        minimumDimensionsContext: {
          minimumWidth: state.minimumWidth,
          minimumHeight: state.minimumHeight
        },
        write: context.writeProperty("minimum width")
      },
      {
        kind: "length",
        id: "node-minimum-height",
        label: "Minimum height",
        value: state.minimumHeight,
        step: 0.1,
        unit: "pt",
        defaultValue: NODE_MINIMUM_DIMENSION_DEFAULT,
        note: state.minimumHeightNote,
        minimumDimensionsContext: {
          minimumWidth: state.minimumWidth,
          minimumHeight: state.minimumHeight
        },
        write: context.writeProperty("minimum height")
      },
      {
        kind: "nodeTextAlign",
        id: "node-text-align",
        label: "Text align",
        value: state.textAlign,
        clearKeys: ["align"],
        write: context.writeProperty("align")
      },
      ...(state.showTextWidth
        ? [
            {
              kind: "optionalLength" as const,
              id: "node-text-width",
              label: "Text width",
              value: state.textWidth,
              step: 0.1,
              unit: "pt" as const,
              clearKeys: ["text width"],
              write: context.writeProperty("text width")
            }
          ]
        : []),
      {
        kind: "nodeFont",
        id: "node-font",
        label: "Font",
        family: state.font.family,
        weight: state.font.weight,
        style: state.font.style,
        sizePreset: state.font.sizePreset,
        customSizePt: state.font.customSizePt,
        sizeOptions: NODE_FONT_SIZE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label })),
        context: state.font.context,
        note: state.font.note,
        write: context.writeProperty(state.font.context.key)
      },
      {
        kind: "color",
        id: "node-text-color",
        label: "Text color",
        value: textColor,
        syntaxValue: textColorSyntax,
        options: colorOptionsForValue(textColor),
        write: context.writeProperty("text")
      }
    ]
  };
};

export const buildPathAttachedNodeSection: SectionBuilder = (context) => {
  if (context.targetKind !== "node-item" || !context.targetId || !context.element.pathAttachment) return null;
  const attachment = context.element.pathAttachment;
  const snapped = resolvePathPositionPreset(attachment.pos, attachment.segment, {
    normalizedThreshold: 0.02,
    worldThresholdPt: 8
  });
  const regime = attachment.regime;
  const positionPreset = snapped.preset ?? "custom";
  const matchedPreset = PATH_POSITION_PRESETS.find((preset) => preset.key === positionPreset);
  const sideLabel = regime.kind === "neutral" ? null : regime.kind === "auto-side" ? "Preferred side" : "Side";
  const sideValue = regime.kind === "neutral" ? null : regime.kind === "auto-side" ? regime.side : regime.direction;
  const sideOptions =
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
              ];

  return {
    id: "path-attached-node",
    title: "Attachment",
    sourceLevel: "command",
    properties: [
      {
        kind: "slider",
        id: "path-attached-node-position",
        label: "Position",
        value: attachment.pos,
        min: 0,
        max: 1,
        step: 0.01,
        ticks: PATH_POSITION_PRESETS.map((preset) => ({ value: preset.t, label: preset.label })),
        displayLabel: matchedPreset ? matchedPreset.label : attachment.pos.toFixed(2),
        write: context.writeProperty(PATH_ATTACHED_NODE_POSITION_VALUE_KEY)
      },
      ...(sideLabel && sideValue
        ? [
            {
              kind: "enum" as const,
              id: "path-attached-node-side",
              label: sideLabel,
              value: sideValue,
              options: sideOptions,
              write: context.writeProperty(PATH_ATTACHED_NODE_SIDE_KEY)
            }
          ]
        : []),
      {
        kind: "boolean",
        id: "path-attached-node-sloped",
        label: "Sloped",
        value: attachment.sloped,
        clearKeys: ["sloped"],
        write: context.writeProperty("sloped")
      }
    ]
  };
};

function shapeAdaptiveInspectorProperty(
  context: InspectorSectionBuildContext,
  control: ShapeAdaptiveControl
): InspectorProperty {
  const write = context.writeProperty(control.writeKey);
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
}

function resolveNodeInspectorState(context: InspectorSectionBuildContext): NodeInspectorState {
  const style: Pick<ResolvedStyle, "fontFamily" | "fontWeight" | "fontStyle" | "fontSize"> = context.element.style;
  const fallbackShape = nodeShapeFallbackFromElementKind(context.element.kind);
  const fallbackFontSize = Number.isFinite(style.fontSize) && style.fontSize > 0 ? style.fontSize : DEFAULT_TEXT_FONT_SIZE;
  const fallbackFontSizePreset = nodeFontSizePresetFromFontSize(fallbackFontSize);
  const state: NodeInspectorState = {
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
      context: { key: "node font", clearKeys: ["font"], fallbackCustomSizePt: fallbackFontSize }
    }
  };

  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;
  if (!options) return state;

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

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (NODE_SHAPE_KNOWN_SET.has(key)) rawShape = key;
      continue;
    }
    if (entry.kind !== "kv") continue;
    const key = normalizeOptionKey(entry.key);
    if (key === NODE_SHAPE_KEY) {
      rawShape = normalizeShapeRawValue(entry.valueRaw);
    } else if (key === "inner sep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        innerXSep = parsed;
        innerYSep = parsed;
        sawAxisSpecificInnerSep = false;
      }
    } else if (key === "inner xsep" || key === "inner ysep") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null && parsed >= 0) {
        if (key === "inner xsep") innerXSep = parsed;
        else innerYSep = parsed;
        sawAxisSpecificInnerSep = true;
      }
    } else if (key === "minimum width" || key === "minimum height" || key === "minimum size") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        if (key === "minimum width") minimumWidth = Math.max(0, parsed);
        else if (key === "minimum height") minimumHeight = Math.max(0, parsed);
        else minimumSize = Math.max(0, parsed);
      }
    } else if (key === "text width") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) textWidth = Math.max(0, parsed);
    } else if (key === "align") {
      const parsed = parseNodeTextAlignInspectorValue(entry.valueRaw);
      if (parsed != null) textAlign = parsed;
      sawAlignOption = true;
    } else if (key === "font" || key === "node font") {
      selectedFontKey = key;
      selectedFontRaw = entry.valueRaw;
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
  if (state.shape !== "custom") state.shapeAdaptiveControls = resolveNodeShapeAdaptiveControls(state.shape, options);
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
      if (parsedFont.fontFamily) state.font.family = parsedFont.fontFamily;
      if (parsedFont.fontWeight) state.font.weight = parsedFont.fontWeight;
      if (parsedFont.fontStyle) state.font.style = parsedFont.fontStyle;
      const parsedFontSize = Number.isFinite(parsedFont.fontSize) && (parsedFont.fontSize ?? 0) > 0
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
  if (kind === "Circle") return "circle";
  if (kind === "Ellipse") return "ellipse";
  return "rectangle";
}

function normalizeShapeRawValue(raw: string): string {
  return stripEnclosingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
}

function parseNodeTextAlignInspectorValue(raw: string): NodeTextAlignInspectorValue | null {
  const normalized = stripEnclosingBraces(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized === "left" || normalized === "flush left") return "left";
  if (normalized === "center" || normalized === "flush center") return "center";
  if (normalized === "right" || normalized === "flush right") return "right";
  if (normalized === "justify") return "justify";
  if (normalized === "none") return "unset";
  return null;
}

function nodeFontSizePresetFromFontSize(fontSize: number): NodeFontSizePresetId {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return "normalsize";
  for (const preset of NODE_FONT_SIZE_PRESETS) {
    if (Math.abs(DEFAULT_TEXT_FONT_SIZE * preset.scale - fontSize) <= NODE_FONT_SIZE_EPSILON) {
      return preset.value;
    }
  }
  return "custom";
}
