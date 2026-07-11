import type { StyleChainEntry } from "../../semantic/style-chain.js";
import type { SceneElement } from "../../semantic/types.js";
import { stripEnclosingBraces } from "../../semantic/style/option-utils.js";
import { normalizeOptionKey } from "../option-key.js";
import { colorOptionsForValue, normalizeInspectorColorValue, resolveColorSyntaxValue } from "./color-syntax.js";
import {
  DASH_STYLE_OPTIONS,
  LINE_CAP_OPTIONS,
  LINE_JOIN_OPTIONS
} from "./presets.js";
import {
  dashStylePresetFromStyle,
  lineCapPresetFromStyle,
  lineJoinPresetFromStyle,
  lineWidthPresetLabel
} from "./preset-values.js";
import { computePathStrokeControlVisibility } from "./path-stroke-visibility.js";
import type { InspectorSectionBuildContext, SectionBuilder } from "./section-builder.js";
import type { InspectorSection } from "./types.js";

const NODE_TARGET_KINDS = new Set(["node-item", "matrix-cell", "tree-child"]);
const NODE_PAINT_STYLE_KINDS = new Set<StyleChainEntry["kind"]>(["every-node", "every-shape"]);
const NODE_PAINT_SOURCE_KINDS = new Set(["node-options"]);

export const buildStrokeSection: SectionBuilder = (context) => {
  const { element } = context;
  const strokeColor = normalizeInspectorColorValue(resolveInspectorStrokeColor(element, context.targetKind));
  const strokeColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["draw", "color"],
    strokeColor,
    context.colorAliases,
    element.styleChain
  );
  const strokeClearOnNoneKeys = resolveInspectorStrokeClearOnNoneKeys(context);
  const pathVisibility =
    element.kind === "Path"
      ? computePathStrokeControlVisibility(element.commands, element.style.dashArray)
      : null;

  const section: InspectorSection = {
    id: "stroke",
    title: "Stroke",
    sourceLevel: "command" as const,
    properties: [
      {
        kind: "color" as const,
        id: "stroke-color",
        label: "Color",
        value: strokeColor,
        syntaxValue: strokeColorSyntax,
        options: colorOptionsForValue(strokeColor),
        write: {
          ...context.writeProperty("draw"),
          clearOnNoneKeys: strokeClearOnNoneKeys
        }
      },
      {
        kind: "lineWidth" as const,
        id: "line-width",
        label: "Line width",
        value: element.style.lineWidth,
        min: 0.1,
        max: 6,
        step: 0.1,
        presetLabel: lineWidthPresetLabel(element.style.lineWidth),
        write: context.writeProperty("line width")
      },
      {
        kind: "dashStyle" as const,
        id: "dash-style",
        label: "Dash style",
        value: dashStylePresetFromStyle(element.style.dashArray, element.style.lineWidth),
        options: DASH_STYLE_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: context.writeProperty("solid")
      }
    ]
  };

  if (pathVisibility?.showLineCap) {
    section.properties.push({
      kind: "lineCap",
      id: "line-cap",
      label: "Line cap",
      value: lineCapPresetFromStyle(element.style.lineCap),
      options: LINE_CAP_OPTIONS,
      previewLineWidth: element.style.lineWidth,
      write: context.writeProperty("line cap")
    });
  }
  if (pathVisibility?.showLineJoin) {
    section.properties.push({
      kind: "lineJoin",
      id: "line-join",
      label: "Line join",
      value: lineJoinPresetFromStyle(element.style.lineJoin),
      options: LINE_JOIN_OPTIONS,
      previewLineWidth: element.style.lineWidth,
      write: context.writeProperty("line join")
    });
  }
  if (pathVisibility) {
    section.properties.push({
      kind: "number",
      id: "stroke-opacity",
      label: "Opacity",
      value: element.style.strokeOpacity,
      step: 0.05,
      min: 0,
      max: 1,
      defaultValue: 1,
      write: context.writeProperty("draw opacity")
    });
  }

  return section;
};

function resolveInspectorStrokeColor(element: SceneElement, targetKind: string | null): string | null {
  return shouldPresentNodeStrokeAsActive(element, targetKind) ? element.style.stroke : null;
}

function resolveInspectorStrokeClearOnNoneKeys(
  context: InspectorSectionBuildContext
): string[] | undefined {
  const { element, targetKind, resolvedTarget } = context;
  if (!shouldPresentNodeStrokeAsActive(element, targetKind)) return undefined;
  if (element.kind !== "Text" || !targetKind || !NODE_TARGET_KINDS.has(targetKind)) return undefined;

  const nodeOptionsEntry = [...element.styleChain].reverse().find(
    (entry) => entry.sourceRef?.sourceKind === "node-options"
  );
  if (!nodeOptionsEntry || nodeOptionsEntry.before.drawExplicit) return undefined;
  return targetHasDrawActivation(resolvedTarget) ? [] : undefined;
}

function shouldPresentNodeStrokeAsActive(element: SceneElement, targetKind: string | null): boolean {
  if (element.kind !== "Text" || !targetKind || !NODE_TARGET_KINDS.has(targetKind)) return true;

  let drawActive = false;
  for (const entry of element.styleChain) {
    if (isNodePaintStyleEntry(entry) && typeof entry.resolvedContributions.drawExplicit === "boolean") {
      drawActive = entry.resolvedContributions.drawExplicit;
    }
  }
  return drawActive && element.style.stroke != null && element.style.stroke !== "none";
}

function isNodePaintStyleEntry(entry: StyleChainEntry): boolean {
  return NODE_PAINT_STYLE_KINDS.has(entry.kind) ||
    (entry.sourceRef?.sourceKind != null && NODE_PAINT_SOURCE_KINDS.has(entry.sourceRef.sourceKind));
}

function targetHasDrawActivation(resolvedTarget: InspectorSectionBuildContext["resolvedTarget"]): boolean {
  if (resolvedTarget?.kind !== "found" || !resolvedTarget.target.options) return false;
  for (const entry of resolvedTarget.target.options.entries) {
    if (entry.kind !== "flag" && entry.kind !== "kv") continue;
    if (normalizeOptionKey(entry.key) !== "draw") continue;
    if (entry.kind === "flag") return true;
    return stripEnclosingBraces(entry.valueRaw).trim().toLowerCase() !== "none";
  }
  return false;
}
