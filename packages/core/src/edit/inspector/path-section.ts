import type { ArrowTipWriteContext } from "../property-write-builders.js";
import { normalizeOptionKey } from "../option-key.js";
import { uniqueStrings } from "../statement-find.js";
import { parseLength } from "../../semantic/coords/parse-length.js";
import {
  findTopLevelCharacter,
  parseStyleValueAsOptionList,
  stripEnclosingBraces
} from "../../semantic/style/option-utils.js";
import type { ArrowMarker, ArrowTipKind, SceneElement } from "../../semantic/types.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import {
  clampRoundedCornersRadius,
  computePathRoundedCornersMax,
  normalizeRoundedCornersMax,
  pathHasRoundableCorner
} from "./rounded-corners.js";
import {
  ARROW_DEFAULT_CLEAR_KEYS,
  ARROW_OPTION_KEY,
  ARROW_TIP_OPTIONS,
  PATH_MORPHING_DECORATION_OPTIONS,
  PATH_MORPHING_DECORATION_SUBOPTIONS_BY_PRESET,
  PATH_MORPHING_DECORATION_SUBOPTION_SPECS,
  ROUNDED_CORNERS_DEFAULT_RADIUS
} from "./presets.js";
import { computePathStrokeControlVisibility } from "./path-stroke-visibility.js";
import type {
  ArrowTipPresetId,
  ArrowTipSide,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationSuboptionSpec
} from "./presets.js";
import type { InspectorSectionBuildContext, SectionBuilder } from "./section-builder.js";
import type { ArrowTipWriteTarget, InspectorProperty } from "./types.js";

const ROUNDED_CORNERS_MIN = 0.1;

export const buildPathSection: SectionBuilder = (context) => {
  if (context.element.kind !== "Path") return null;
  const element = context.element;
  const roundedCornersSourceCommands = element.undecoratedCommands ?? element.commands;
  const roundedCornersEnabled = element.style.roundedCorners != null && element.style.roundedCorners > 0;
  const pathHasCornerThatCanBeRounded = pathHasRoundableCorner(roundedCornersSourceCommands);
  const roundedCornersMax = normalizeRoundedCornersMax(computePathRoundedCornersMax(roundedCornersSourceCommands));
  const roundedCornersDefaultRadius = clampRoundedCornersRadius(ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax);
  const roundedCornersRadius = roundedCornersEnabled
    ? clampRoundedCornersRadius(element.style.roundedCorners ?? ROUNDED_CORNERS_DEFAULT_RADIUS, roundedCornersMax)
    : roundedCornersDefaultRadius;
  const roundedCornersDisableRequiresSharpCorners = resolveRoundedCornersDisableRequiresSharpCorners(context, element);
  const pathMorphingPreset = resolvePathMorphingDecorationPreset(context, element.style.decoration);
  const pathMorphingSuboptions = resolvePathMorphingDecorationSuboptionProperties(
    context,
    pathMorphingPreset,
    element.style.decoration
  );
  const properties: InspectorProperty[] = [
    {
      kind: "pathMorphingDecoration",
      id: "path-morphing-decoration",
      label: "Path morphing",
      value: pathMorphingPreset,
      options: PATH_MORPHING_DECORATION_OPTIONS,
      previewLineWidth: element.style.lineWidth,
      write: context.writeProperty("decorate")
    },
    ...pathMorphingSuboptions
  ];

  const pathStrokeVisibility = computePathStrokeControlVisibility(element.commands, element.style.dashArray);
  if (pathStrokeVisibility.showLineJoin && (pathHasCornerThatCanBeRounded || roundedCornersEnabled)) {
    properties.push({
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
      write: context.writeProperty("rounded corners")
    });
  }

  if (pathSupportsArrowTipEditing(element.commands)) {
    const arrowWrite = makeArrowTipWriteTarget(context, element);
    properties.push(
      {
        kind: "arrowTip",
        id: "arrow-tip-start",
        label: "Begin arrow type",
        side: "start",
        value: arrowPresetFromMarker(element.style.markerStart),
        options: ARROW_TIP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: arrowWrite
      },
      {
        kind: "arrowTip",
        id: "arrow-tip-end",
        label: "End arrow type",
        side: "end",
        value: arrowPresetFromMarker(element.style.markerEnd),
        options: ARROW_TIP_OPTIONS,
        previewLineWidth: element.style.lineWidth,
        write: arrowWrite
      }
    );
  }

  return {
    id: "path",
    title: "Path",
    sourceLevel: "command",
    properties
  };
};

function makeArrowTipWriteTarget(
  context: InspectorSectionBuildContext,
  element: Extract<SceneElement, { kind: "Path" }>
): ArrowTipWriteTarget {
  return {
    ...context.writeProperty(ARROW_OPTION_KEY),
    arrowContext: resolveArrowWriteContext(context, element)
  };
}

function resolveArrowWriteContext(
  context: InspectorSectionBuildContext,
  element: Extract<SceneElement, { kind: "Path" }>
): ArrowTipWriteContext {
  const clearKeySet = new Set<string>(ARROW_DEFAULT_CLEAR_KEYS);
  let startRaw = arrowMarkerFallbackRaw(element.style.markerStart, "start");
  let endRaw = arrowMarkerFallbackRaw(element.style.markerEnd, "end");
  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;

  let lastParsed: { startRaw: string; endRaw: string } | null = null;
  for (const entry of options?.entries ?? []) {
    if (entry.kind === "kv") {
      const entryKey = normalizeOptionKey(entry.key);
      if (entryKey !== ARROW_OPTION_KEY) continue;
      clearKeySet.add(entryKey);
      const parsed = splitArrowSpecificationRaw(entry.valueRaw);
      if (parsed) lastParsed = parsed;
      continue;
    }
    if (entry.kind !== "flag") continue;
    const parsed = splitArrowSpecificationRaw(entry.raw);
    if (!parsed) continue;
    clearKeySet.add(normalizeOptionKey(entry.key));
    lastParsed = parsed;
  }

  if (lastParsed) {
    startRaw = lastParsed.startRaw;
    endRaw = lastParsed.endRaw;
  }
  return { startRaw, endRaw, clearKeys: [...clearKeySet] };
}

function splitArrowSpecificationRaw(raw: string): { startRaw: string; endRaw: string } | null {
  const normalized = stripEnclosingBraces(raw.trim());
  const splitIndex = findTopLevelCharacter(normalized, "-");
  if (splitIndex < 0) return null;
  return {
    startRaw: normalized.slice(0, splitIndex).trim(),
    endRaw: normalized.slice(splitIndex + 1).trim()
  };
}

function resolvePathMorphingDecorationSuboptionProperties(
  context: InspectorSectionBuildContext,
  preset: PathMorphingDecorationPresetId,
  decoration: { params: Record<string, string> }
): Array<Extract<InspectorProperty, { kind: "number" }>> {
  if (preset === "none" || preset === "custom") return [];
  const suboptionKeys = PATH_MORPHING_DECORATION_SUBOPTIONS_BY_PRESET[preset];
  if (!suboptionKeys || suboptionKeys.length === 0) return [];

  return suboptionKeys.map((suboptionKey) => {
    const spec = PATH_MORPHING_DECORATION_SUBOPTION_SPECS[suboptionKey];
    return {
      kind: "number",
      id: spec.id,
      label: spec.label,
      value: resolvePathMorphingDecorationSuboptionValue(spec, decoration.params),
      step: spec.step,
      unit: spec.unit,
      clearKeys: uniqueStrings(spec.clearKeys),
      write: context.writeProperty(spec.writeKey)
    };
  });
}

function resolvePathMorphingDecorationSuboptionValue(
  spec: PathMorphingDecorationSuboptionSpec,
  params: Record<string, string>
): number {
  const rawValue = params[spec.decorationKey];
  if (!rawValue) return spec.defaultValue;
  if (spec.unit === "pt") return parseLength(rawValue, "pt") ?? spec.defaultValue;
  const parsed = Number(stripEnclosingBraces(rawValue).trim());
  return Number.isFinite(parsed) ? parsed : spec.defaultValue;
}

function resolvePathMorphingDecorationPreset(
  context: InspectorSectionBuildContext,
  styleDecoration: { enabled: boolean; name: string | null }
): PathMorphingDecorationPresetId {
  const fallback = pathMorphingDecorationPresetFromStyle(styleDecoration);
  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;
  if (!options) return fallback;

  let decorateEnabled = styleDecoration.enabled;
  let decorationName = canonicalDecorationName(styleDecoration.name);
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (key === "decorate" || key === "/tikz/decorate") decorateEnabled = true;
      continue;
    }
    if (entry.kind !== "kv") continue;
    const key = normalizeOptionKey(entry.key);
    if (key === "decorate" || key === "/tikz/decorate") {
      const parsed = parseDecorationBoolean(entry.valueRaw);
      if (parsed != null) decorateEnabled = parsed;
    } else if (key === "decoration" || key === "/pgf/decoration") {
      const parsedName = parseDecorationNameFromOptionValue(entry.valueRaw);
      if (parsedName) decorationName = parsedName;
    } else if (key === "/pgf/decoration/name" || key === "/pgf/decorations/name" || key === "name") {
      const parsedName = canonicalDecorationName(stripEnclosingBraces(entry.valueRaw));
      if (parsedName) decorationName = parsedName;
    }
  }

  if (!decorateEnabled || !decorationName || decorationName === "none") return "none";
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
      } else if (entry.kind === "flag") {
        const key = normalizeOptionKey(entry.key);
        if (key === "decorate" || key === "mirror" || key === "path has corners" || key === "reverse path") {
          continue;
        }
        return canonicalDecorationName(entry.key);
      }
    }
  }

  const normalized = stripEnclosingBraces(valueRaw).trim();
  if (normalized.length === 0) return null;
  const firstComma = findTopLevelCharacter(normalized, ",");
  const firstPart = firstComma >= 0 ? normalized.slice(0, firstComma).trim() : normalized;
  const equalsIndex = findTopLevelCharacter(firstPart, "=");
  if (equalsIndex < 0) return canonicalDecorationName(firstPart);
  const key = normalizeOptionKey(firstPart.slice(0, equalsIndex));
  if (key !== "name" && key !== "/pgf/decoration/name" && key !== "/pgf/decorations/name") return null;
  return canonicalDecorationName(stripEnclosingBraces(firstPart.slice(equalsIndex + 1)));
}

function arrowPresetFromMarker(marker: ArrowMarker | null): ArrowTipPresetId {
  if (!marker || marker.tips.length === 0) return "none";
  if (marker.tips.length !== 1) return "custom";
  return arrowPresetFromKind(marker.tips[0].kind);
}

function arrowPresetFromKind(kind: ArrowTipKind): ArrowTipPresetId {
  if (kind === "to" || kind === "cm-rightarrow") return "arrow";
  if (kind === "stealth") return "stealth";
  if (kind === "latex") return "latex";
  if (kind === "triangle") return "triangle";
  if (kind === "circle") return "circle";
  if (kind === "square") return "square";
  if (kind === "kite") return "kite";
  if (kind === "bar") return "bar";
  if (kind === "hooks") return "hooks";
  return "custom";
}

function arrowMarkerFallbackRaw(marker: ArrowMarker | null, side: ArrowTipSide): string {
  const preset = arrowPresetFromMarker(marker);
  return preset !== "custom"
    ? arrowPresetSideRaw(preset, side)
    : marker!.tips.map((tip) => arrowKindCanonicalRaw(tip.kind, side)).join(" ");
}

function arrowKindCanonicalRaw(kind: ArrowTipKind, side: ArrowTipSide): string {
  if (kind === "to" || kind === "cm-rightarrow") return side === "start" ? "<" : ">";
  if (kind === "stealth") return "Stealth";
  if (kind === "latex") return "Latex";
  if (kind === "triangle") return "Triangle";
  if (kind === "circle") return "Circle";
  if (kind === "square") return "Square";
  if (kind === "kite") return "Kite";
  if (kind === "bar") return "Bar";
  if (kind === "hooks") return "Hooks";
  if (kind === "implies") return "Implies";
  if (kind === "straight-barb") return "Straight Barb";
  if (kind === "arc-barb") return "Arc Barb";
  if (kind === "tee-barb") return "Tee Barb";
  if (kind === "rays") return "Rays";
  if (kind === "round-cap") return "Round Cap";
  if (kind === "butt-cap") return "Butt Cap";
  if (kind === "triangle-cap") return "Triangle Cap";
  return "To";
}

function arrowPresetSideRaw(preset: Exclude<ArrowTipPresetId, "custom">, side: ArrowTipSide): string {
  if (preset === "none") return "";
  if (preset === "arrow") return side === "start" ? "<" : ">";
  if (preset === "stealth") return "Stealth";
  if (preset === "latex") return "Latex";
  if (preset === "triangle") return "Triangle";
  if (preset === "circle") return "Circle";
  if (preset === "square") return "Square";
  if (preset === "kite") return "Kite";
  if (preset === "bar") return "Bar";
  return "Hooks";
}

function resolveRoundedCornersDisableRequiresSharpCorners(
  context: InspectorSectionBuildContext,
  element: Extract<SceneElement, { kind: "Path" }>
): boolean {
  const commandEntry =
    (context.targetId
      ? [...element.styleChain].reverse().find(
          (entry) => entry.kind === "command" && entry.sourceRef?.sourceId === context.targetId
        )
      : undefined) ??
    [...element.styleChain].reverse().find((entry) => entry.kind === "command");
  if (!commandEntry) return true;
  const inheritedRoundedCorners = commandEntry.before.roundedCorners;
  return inheritedRoundedCorners != null && inheritedRoundedCorners > 0;
}

function pathSupportsArrowTipEditing(commands: Extract<SceneElement, { kind: "Path" }>["commands"]): boolean {
  if (commands.some((command) => command.kind === "Z")) return false;
  return commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

function pathMorphingDecorationPresetFromStyle(style: {
  enabled: boolean;
  name: string | null;
}): PathMorphingDecorationPresetId {
  if (!style.enabled) return "none";
  const canonicalName = canonicalDecorationName(style.name);
  if (!canonicalName || canonicalName === "none") return "none";
  const matching = PATH_MORPHING_DECORATION_OPTIONS.find((option) => option.value === canonicalName);
  return matching ? matching.value : "custom";
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}
