import type { FillPatternOptionMutationContext } from "../property-write-builders.js";
import { normalizeOptionKey } from "../option-key.js";
import {
  colorOptionsForValue,
  normalizeInspectorColorValue,
  resolveColorSyntaxValue
} from "./color-syntax.js";
import {
  DEFAULT_META_PATTERN_DISTANCE,
  DEFAULT_META_PATTERN_RADIUS,
  DEFAULT_META_PATTERN_STARS_DISTANCE,
  DEFAULT_META_PATTERN_STARS_RADIUS,
  FILL_MODE_OPTIONS,
  FILL_PATTERN_OPTIONS,
  FILL_SHADING_OPTIONS,
  FILL_STYLE_CUSTOM_NOTE,
  SHADING_ACTIVATION_KEYS
} from "./presets.js";
import type {
  FillModePresetId,
  FillPatternMetaFamilyId,
  FillPatternMetaValues,
  FillPatternPresetId,
  FillShadingPresetId
} from "./presets.js";
import {
  fillPatternPresetFromRaw,
  fillPatternPresetFromResolvedPattern,
  fillShadingPresetFromStyleName
} from "./preset-values.js";
import type { InspectorProperty } from "./types.js";
import type { ResolvedPattern, ScenePathCommand } from "../../semantic/types.js";
import { stripEnclosingBraces } from "../../semantic/style/option-utils.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import type { InspectorSectionBuildContext, SectionBuilder } from "./section-builder.js";

export const buildFillSection: SectionBuilder = (context) => {
  const { element } = context;
  if (element.kind === "Path" && !pathSupportsFillEditing(element.commands)) {
    return null;
  }

  const fillColor = normalizeInspectorColorValue(element.style.fill);
  const fillColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["fill", "color"],
    fillColor,
    context.colorAliases,
    element.styleChain
  );
  const patternColor = normalizeInspectorColorValue(element.style.patternColor);
  const patternColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["pattern color"],
    patternColor,
    context.colorAliases,
    element.styleChain
  );
  const fillPaintState = resolveFillPaintState(context);
  const fillProperties: InspectorProperty[] = [
    {
      kind: "color",
      id: "fill-color",
      label: "Color",
      value: fillColor,
      syntaxValue: fillColorSyntax,
      options: colorOptionsForValue(fillColor),
      write: context.writeProperty("fill")
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
      write: context.writeProperty("fill")
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
      write: context.writeProperty("shading")
    });

    if (fillPaintState.shading === "axis") {
      const topColor = normalizeInspectorColorValue(element.style.axisTopColor);
      const topColorSyntax = resolveColorSyntaxValue(
        context.resolvedTarget,
        ["top color", "left color"],
        topColor,
        context.colorAliases,
        element.styleChain
      );
      const bottomColor = normalizeInspectorColorValue(element.style.axisBottomColor);
      const bottomColorSyntax = resolveColorSyntaxValue(
        context.resolvedTarget,
        ["bottom color", "right color"],
        bottomColor,
        context.colorAliases,
        element.styleChain
      );
      fillProperties.push(
        {
          kind: "color",
          id: "fill-axis-top-color",
          label: "Start color",
          value: topColor,
          syntaxValue: topColorSyntax,
          options: colorOptionsForValue(topColor),
          write: context.writeProperty("top color")
        },
        {
          kind: "color",
          id: "fill-axis-bottom-color",
          label: "End color",
          value: bottomColor,
          syntaxValue: bottomColorSyntax,
          options: colorOptionsForValue(bottomColor),
          write: context.writeProperty("bottom color")
        },
        {
          kind: "number",
          id: "fill-shading-angle",
          label: "Angle",
          value: element.style.shadingAngle,
          step: 1,
          unit: "deg",
          write: context.writeProperty("shading angle")
        }
      );
    } else if (fillPaintState.shading === "radial") {
      const innerColor = normalizeInspectorColorValue(element.style.radialInnerColor);
      const innerColorSyntax = resolveColorSyntaxValue(
        context.resolvedTarget,
        ["inner color"],
        innerColor,
        context.colorAliases,
        element.styleChain
      );
      const outerColor = normalizeInspectorColorValue(element.style.radialOuterColor);
      const outerColorSyntax = resolveColorSyntaxValue(
        context.resolvedTarget,
        ["outer color"],
        outerColor,
        context.colorAliases,
        element.styleChain
      );
      fillProperties.push(
        {
          kind: "color",
          id: "fill-radial-inner-color",
          label: "Inner color",
          value: innerColor,
          syntaxValue: innerColorSyntax,
          options: colorOptionsForValue(innerColor),
          write: context.writeProperty("inner color")
        },
        {
          kind: "color",
          id: "fill-radial-outer-color",
          label: "Outer color",
          value: outerColor,
          syntaxValue: outerColorSyntax,
          options: colorOptionsForValue(outerColor),
          write: context.writeProperty("outer color")
        }
      );
    } else if (fillPaintState.shading === "ball") {
      const ballColor = normalizeInspectorColorValue(element.style.ballColor);
      const ballColorSyntax = resolveColorSyntaxValue(
        context.resolvedTarget,
        ["ball color"],
        ballColor,
        context.colorAliases,
        element.styleChain
      );
      fillProperties.push({
        kind: "color",
        id: "fill-ball-color",
        label: "Ball color",
        value: ballColor,
        syntaxValue: ballColorSyntax,
        options: colorOptionsForValue(ballColor),
        write: context.writeProperty("ball color")
      });
    }
  } else if (fillPaintState.mode === "pattern") {
    fillProperties.push(
      {
        kind: "fillPattern",
        id: "fill-pattern",
        label: "Pattern",
        value: fillPaintState.pattern,
        options: FILL_PATTERN_OPTIONS,
        note: fillPaintState.pattern === "custom" ? FILL_STYLE_CUSTOM_NOTE : undefined,
        write: context.writeProperty("pattern")
      },
      {
        kind: "color",
        id: "fill-pattern-color",
        label: "Pattern color",
        value: patternColor,
        syntaxValue: patternColorSyntax,
        options: colorOptionsForValue(patternColor),
        write: context.writeProperty("pattern color")
      }
    );

    const fillPatternOptionContext = resolveFillPatternOptionMutationContext(
      element.style.fillPattern,
      fillPaintState.pattern,
      element.style.lineWidth
    );
    if (fillPatternOptionContext) {
      fillProperties.push(
        makeFillPatternNumberProperty(context, fillPatternOptionContext, "angle", "fill-pattern-angle", "Angle", 1, "deg"),
        makeFillPatternNumberProperty(context, fillPatternOptionContext, "distance", "fill-pattern-distance", "Distance", 0.1, "pt"),
        makeFillPatternNumberProperty(context, fillPatternOptionContext, "xshift", "fill-pattern-xshift", "X shift", 0.1, "pt"),
        makeFillPatternNumberProperty(context, fillPatternOptionContext, "yshift", "fill-pattern-yshift", "Y shift", 0.1, "pt")
      );

      if (fillPatternOptionContext.family === "Lines" || fillPatternOptionContext.family === "Hatch") {
        fillProperties.push(
          makeFillPatternNumberProperty(
            context,
            fillPatternOptionContext,
            "line width",
            "fill-pattern-line-width",
            "Line width",
            0.1,
            "pt"
          )
        );
      }

      if (fillPatternOptionContext.family === "Dots" || fillPatternOptionContext.family === "Stars") {
        fillProperties.push(
          makeFillPatternNumberProperty(
            context,
            fillPatternOptionContext,
            "radius",
            "fill-pattern-radius",
            "Radius",
            0.1,
            "pt"
          )
        );
      }

      if (fillPatternOptionContext.family === "Stars") {
        fillProperties.push(
          makeFillPatternNumberProperty(
            context,
            fillPatternOptionContext,
            "points",
            "fill-pattern-points",
            "Points",
            1
          )
        );
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
    write: context.writeProperty("fill opacity")
  });

  return {
    id: "fill",
    title: "Fill",
    sourceLevel: "command",
    properties: fillProperties
  };
};

function makeFillPatternNumberProperty(
  context: InspectorSectionBuildContext,
  mutationContext: FillPatternOptionMutationContext,
  option: "angle" | "distance" | "xshift" | "yshift" | "line width" | "radius" | "points",
  id: string,
  label: string,
  step: number,
  unit?: string
): Extract<InspectorProperty, { kind: "fillPatternOption" }> {
  const valueKey = option === "line width" ? "lineWidth" : option;
  return {
    kind: "fillPatternOption",
    id,
    label,
    option,
    value: mutationContext.values[valueKey],
    step,
    unit,
    context: mutationContext,
    write: context.writeProperty("pattern")
  };
}

function resolveFillPaintState(
  context: InspectorSectionBuildContext
): { mode: FillModePresetId; shading: FillShadingPresetId; pattern: FillPatternPresetId } {
  const style = context.element.style;
  const fallbackShading = style.shadeEnabled ? fillShadingPresetFromStyleName(style.shading) : "axis";
  const fallbackPattern = fillPatternPresetFromResolvedPattern(style.fillPattern);

  let patternActive = style.fillPattern != null;
  let shadingActive = style.shadeEnabled;
  let shading: FillShadingPresetId = fallbackShading;
  let pattern: FillPatternPresetId = fallbackPattern;
  let sawPatternOption = false;
  let sawShadingOption = false;

  const options = context.resolvedTarget?.kind === "found" ? context.resolvedTarget.target.options : undefined;
  for (const entry of options?.entries ?? []) {
    if (entry.kind === "flag") {
      const key = normalizeOptionKey(entry.key);
      if (key === "pattern" || key === "/tikz/pattern") {
        patternActive = true;
        sawPatternOption = true;
        if (pattern === "custom") {
          pattern = "dots";
        }
      } else if (key === "shade" || key === "/tikz/shade") {
        shadingActive = true;
        sawShadingOption = true;
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
      } else {
        patternActive = true;
        pattern = fillPatternPresetFromRaw(entry.valueRaw);
      }
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
    shading = fillShadingPresetFromActivationKey(key) ?? shading;
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
  if ((sawShadingOption && shadingActive) || shadingActive) {
    return { mode: "gradient", shading, pattern };
  }
  return { mode: "solid", shading, pattern };
}

function resolveFillPatternOptionMutationContext(
  pattern: ResolvedPattern | null,
  fallbackPatternPreset: FillPatternPresetId,
  fallbackLineWidth: number
): FillPatternOptionMutationContext | null {
  if (pattern?.kind === "meta-lines" || pattern?.kind === "meta-hatch") {
    return {
      family: pattern.kind === "meta-lines" ? "Lines" : "Hatch",
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
  if (pattern?.kind === "meta-dots" || pattern?.kind === "meta-stars") {
    return {
      family: pattern.kind === "meta-dots" ? "Dots" : "Stars",
      values: {
        angle: pattern.angle,
        distance: pattern.distance,
        xshift: pattern.xshift,
        yshift: pattern.yshift,
        lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
        radius: pattern.radius,
        points: pattern.kind === "meta-stars" ? pattern.points : 5
      }
    };
  }

  const fallbackFamily = fillPatternMetaFamilyFromPreset(fallbackPatternPreset);
  return fallbackFamily
    ? { family: fallbackFamily, values: defaultFillPatternMetaValues(fallbackFamily, fallbackLineWidth) }
    : null;
}

function parseInspectorBoolean(raw: string): boolean | null {
  return parseBooleanishNormalized(stripEnclosingBraces(raw), {
    allowOnOff: true,
    allowNoneAsFalse: true,
    empty: true
  });
}

function fillShadingPresetFromActivationKey(key: string): FillShadingPresetId | null {
  if (["inner color", "/tikz/inner color", "outer color", "/tikz/outer color"].includes(key)) {
    return "radial";
  }
  if (key === "ball color" || key === "/tikz/ball color") {
    return "ball";
  }
  if (["lower left", "/tikz/lower left", "lower right", "/tikz/lower right", "upper left", "/tikz/upper left", "upper right", "/tikz/upper right"].includes(key)) {
    return "custom";
  }
  if (["top color", "/tikz/top color", "middle color", "/tikz/middle color", "bottom color", "/tikz/bottom color", "left color", "/tikz/left color", "right color", "/tikz/right color", "shading angle", "/tikz/shading angle"].includes(key)) {
    return "axis";
  }
  return null;
}

function fillPatternMetaFamilyFromPreset(preset: FillPatternPresetId): FillPatternMetaFamilyId | null {
  return preset === "Lines" || preset === "Hatch" || preset === "Dots" || preset === "Stars" ? preset : null;
}

function defaultFillPatternMetaValues(
  family: FillPatternMetaFamilyId,
  fallbackLineWidth: number
): FillPatternMetaValues {
  return {
    angle: 0,
    distance: family === "Stars" ? DEFAULT_META_PATTERN_STARS_DISTANCE : DEFAULT_META_PATTERN_DISTANCE,
    xshift: 0,
    yshift: 0,
    lineWidth: normalizeFillPatternLineWidthFallback(fallbackLineWidth),
    radius: family === "Stars" ? DEFAULT_META_PATTERN_STARS_RADIUS : DEFAULT_META_PATTERN_RADIUS,
    points: 5
  };
}

function normalizeFillPatternLineWidthFallback(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0.4;
}

function pathSupportsFillEditing(commands: ScenePathCommand[]): boolean {
  type OpenSubpathState = {
    hasCurveOrArc: boolean;
    segmentCount: number;
    points: Array<{ x: number; y: number }>;
  };

  const polygonAreaEpsilon = 1e-9;
  let subpath: OpenSubpathState | null = null;
  const flushOpenSubpath = (): boolean => {
    if (!subpath) return false;
    if (subpath.hasCurveOrArc && subpath.segmentCount >= 1) return true;
    if (subpath.segmentCount < 2) return false;
    return Math.abs(polygonSignedArea(subpath.points)) > polygonAreaEpsilon;
  };

  for (const command of commands) {
    if (command.kind === "M") {
      if (flushOpenSubpath()) return true;
      subpath = { hasCurveOrArc: false, segmentCount: 0, points: [command.to] };
    } else if (command.kind === "Z") {
      return true;
    } else if (subpath && command.kind === "L") {
      subpath.segmentCount += 1;
      subpath.points.push(command.to);
    } else if (subpath && (command.kind === "C" || command.kind === "A")) {
      subpath.hasCurveOrArc = true;
      subpath.segmentCount += 1;
      subpath.points.push(command.to);
    }
  }
  return flushOpenSubpath();
}

function polygonSignedArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}
