import { normalizeOptionKey } from "../option-key.js";
import type { ShadowMutationContext } from "../property-write-builders.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import { normalizeColor } from "../../semantic/style/colors.js";
import { parseStyleValueAsOptionList, stripEnclosingBraces } from "../../semantic/style/option-utils.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../../semantic/types.js";
import { colorOptionsForValue, normalizeInspectorColorValue } from "./color-syntax.js";
import { SHADOW_PRESET_DEFAULTS, SHADOW_PRESET_OPTIONS } from "./presets.js";
import type { ShadowPresetId } from "./presets.js";
import type { InspectorProperty, SetPropertyWriteTarget } from "./types.js";
import type { InspectorSectionBuildContext, SectionBuilder } from "./section-builder.js";

export const buildShadowSection: SectionBuilder = (context) => {
  const shadowLayer = context.element.style.shadowLayers[0] ?? null;
  const shadowPreset = resolveShadowPreset(context);
  const shadowOverrides = resolveShadowOptionOverrides(context);
  const defaults = SHADOW_PRESET_DEFAULTS[shadowPreset !== "none" ? shadowPreset : "drop-shadow"];
  const shadowColor =
    shadowOverrides.color != null
      ? resolveShadowOverrideColorValue(shadowOverrides.color, defaults.color)
      : resolveShadowInspectorColorValue(
          shadowLayer?.style.fill ?? defaults.color,
          defaults.color,
          context.colorAliases
        );
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
    ...context.writeProperty("drop shadow"),
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
      write: context.writeProperty("drop shadow")
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
      },
      {
        kind: "number",
        id: "shadow-opacity",
        label: "Opacity",
        value: shadowContext.opacity,
        step: 0.05,
        min: 0,
        max: 1,
        write: shadowWrite()
      }
    );
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

  return {
    id: "shadow",
    title: "Shadow",
    sourceLevel: "command",
    properties: shadowProperties
  };
};

function resolveShadowPreset(context: InspectorSectionBuildContext): ShadowPresetId {
  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;
  for (const entry of options?.entries ?? []) {
    const key = entry.kind === "flag" || entry.kind === "kv" ? normalizeOptionKey(entry.key) : null;
    if (key === "drop shadow") return "drop-shadow";
    if (key === "copy shadow" || key === "double copy shadow") return "copy-shadow";
    if (key === "circular drop shadow") return "circular-drop-shadow";
    if (key === "circular glow") return "circular-glow";
    if (key === "general shadow") return "drop-shadow";
  }
  return "none";
}

function resolveShadowOptionOverrides(
  context: InspectorSectionBuildContext
): Partial<Omit<ShadowMutationContext, "preset">> {
  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;
  let overrides: Partial<Omit<ShadowMutationContext, "preset">> = {};
  for (const entry of options?.entries ?? []) {
    const key = entry.kind === "flag" || entry.kind === "kv" ? normalizeOptionKey(entry.key) : null;
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
    if (!nested) continue;
    const nextOverrides: Partial<Omit<ShadowMutationContext, "preset">> = {};
    for (const nestedEntry of nested.entries) {
      if (nestedEntry.kind !== "kv") continue;
      const nestedKey = normalizeOptionKey(nestedEntry.key);
      if (nestedKey === "shadow xshift" || nestedKey === "shadow yshift") {
        const parsed = parseLength(nestedEntry.valueRaw, "pt");
        if (parsed != null) {
          if (nestedKey === "shadow xshift") nextOverrides.xshiftPt = parsed;
          else nextOverrides.yshiftPt = parsed;
        }
      } else if (nestedKey === "shadow scale" || nestedKey === "opacity") {
        const parsed = Number(stripEnclosingBraces(nestedEntry.valueRaw).trim());
        if (Number.isFinite(parsed)) {
          if (nestedKey === "shadow scale") nextOverrides.scale = parsed;
          else nextOverrides.opacity = parsed;
        }
      } else if (nestedKey === "fill") {
        const rawColor = stripEnclosingBraces(nestedEntry.valueRaw).trim();
        if (rawColor.length > 0) nextOverrides.color = rawColor;
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
  if (!rawColor) return defaultColor;
  const trimmed = rawColor.trim();
  if (trimmed.length === 0 || trimmed === SHADOW_INHERIT_FILL || trimmed === SHADOW_INHERIT_STROKE) {
    return defaultColor;
  }

  const resolveAlias = (candidate: string): string | null => colorAliases.get(candidate.trim().toLowerCase()) ?? null;
  const normalizedRaw = normalizeInspectorColorValue(normalizeColor(trimmed, { resolveAlias }));
  if (defaultColor) {
    const normalizedDefault = normalizeInspectorColorValue(normalizeColor(defaultColor, { resolveAlias }));
    if (normalizedRaw != null && normalizedRaw === normalizedDefault) return defaultColor;
  }
  return normalizeInspectorColorValue(trimmed) ?? trimmed;
}

function resolveShadowOverrideColorValue(
  rawColor: string | null | undefined,
  defaultColor: string | null
): string | null {
  if (!rawColor) return defaultColor;
  const trimmed = rawColor.trim();
  return trimmed.length === 0 || trimmed === SHADOW_INHERIT_FILL || trimmed === SHADOW_INHERIT_STROKE
    ? defaultColor
    : trimmed;
}
