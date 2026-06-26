import type { OptionEntry } from "../options/types.js";
import { parseDirectionalKey } from "./path/node-positioning.js";
import type { FeatureUsage, SceneElement } from "./types.js";

export type InferRequiredTikzLibrariesInput = {
  featureUsage: FeatureUsage;
  elements: readonly SceneElement[];
};

const DECORATION_FEATURE_TO_LIBRARY: Record<string, string> = {
  decoration_pathmorphing: "decorations.pathmorphing",
  decoration_pathreplacing: "decorations.pathreplacing",
  decoration_fractals: "decorations.fractals",
  decoration_shape_marks: "decorations.shapes",
  decoration_shape_backgrounds: "decorations.shapes",
  decoration_footprints: "decorations.footprints"
};

const SHAPE_FEATURE_TO_LIBRARY: Record<string, string> = {
  shape_rounded_rectangle: "shapes.misc",
  shape_chamfered_rectangle: "shapes.misc",
  shape_cross_out: "shapes.misc",
  shape_strike_out: "shapes.misc",
  shape_magnifying_glass: "shapes.symbols",
  shape_circle_split: "shapes.multipart",
  shape_circle_solidus: "shapes.multipart",
  shape_ellipse_split: "shapes.multipart",
  shape_diamond_split: "shapes.multipart",
  shape_rectangle_split: "shapes.multipart",
  shape_diamond: "shapes.geometric",
  shape_trapezium: "shapes.geometric",
  shape_semicircle: "shapes.geometric",
  shape_regular_polygon: "shapes.geometric",
  shape_star: "shapes.geometric",
  shape_isosceles_triangle: "shapes.geometric",
  shape_kite: "shapes.geometric",
  shape_dart: "shapes.geometric",
  shape_circular_sector: "shapes.geometric",
  shape_cylinder: "shapes.geometric",
  shape_cloud: "shapes.symbols",
  shape_starburst: "shapes.symbols",
  shape_signal: "shapes.symbols",
  shape_tape: "shapes.symbols",
  shape_rectangle_callout: "shapes.callouts",
  shape_ellipse_callout: "shapes.callouts",
  shape_cloud_callout: "shapes.callouts",
  shape_single_arrow: "shapes.arrows",
  shape_double_arrow: "shapes.arrows"
};

function isFeatureUsed(featureUsage: FeatureUsage, featureId: string): boolean {
  const state = featureUsage[featureId];
  return state === "used-supported" || state === "used-unsupported";
}

function hasPositioningOfSyntax(raw: string): boolean {
  return /\bof\b/i.test(raw);
}

function isPositioningEntry(entry: OptionEntry): boolean {
  if (entry.kind !== "kv") {
    return false;
  }
  const directional = parseDirectionalKey(entry.key);
  if (!directional) {
    return false;
  }
  if (directional.legacyOf) {
    return true;
  }
  return hasPositioningOfSyntax(entry.valueRaw);
}

function elementUsesPositioningLibrary(element: SceneElement): boolean {
  return element.styleChain.some((layer) =>
    layer.rawOptions.some((optionList) => optionList.entries.some((entry) => isPositioningEntry(entry)))
  );
}

function elementUsesPatternsMeta(element: SceneElement): boolean {
  const pattern = element.style.fillPattern;
  return (
    pattern?.kind === "meta-lines" ||
    pattern?.kind === "meta-hatch" ||
    pattern?.kind === "meta-dots" ||
    pattern?.kind === "meta-stars"
  );
}

function elementUsesPatternsLegacy(element: SceneElement): boolean {
  return element.style.fillPattern?.kind === "legacy";
}

export function inferRequiredTikzLibraries(input: InferRequiredTikzLibrariesInput): string[] {
  const { featureUsage, elements } = input;
  const required = new Set<string>();

  if (isFeatureUsed(featureUsage, "arrow_tips")) {
    required.add("arrows.meta");
  }
  if (isFeatureUsed(featureUsage, "matrix_node")) {
    required.add("matrix");
  }
  if (isFeatureUsed(featureUsage, "fit_node")) {
    required.add("fit");
  }
  if (isFeatureUsed(featureUsage, "graph_operation")) {
    required.add("graphs");
  }
  if (isFeatureUsed(featureUsage, "backgrounds_library") || elements.some((element) => element.layer === "background")) {
    required.add("backgrounds");
  }

  const decorationRootUsed =
    isFeatureUsed(featureUsage, "decorate_operation") ||
    isFeatureUsed(featureUsage, "decorate_option") ||
    Object.keys(DECORATION_FEATURE_TO_LIBRARY).some((featureId) => isFeatureUsed(featureUsage, featureId));
  if (decorationRootUsed) {
    required.add("decorations");
  }

  for (const [featureId, libraryName] of Object.entries(DECORATION_FEATURE_TO_LIBRARY)) {
    if (isFeatureUsed(featureUsage, featureId)) {
      required.add(libraryName);
    }
  }

  for (const [featureId, libraryName] of Object.entries(SHAPE_FEATURE_TO_LIBRARY)) {
    if (isFeatureUsed(featureUsage, featureId)) {
      required.add(libraryName);
    }
  }

  for (const element of elements) {
    if (elementUsesPatternsLegacy(element)) {
      required.add("patterns");
    }
    if (elementUsesPatternsMeta(element)) {
      required.add("patterns.meta");
    }
    if (elementUsesPositioningLibrary(element)) {
      required.add("positioning");
    }
  }

  return [...required].sort((left, right) => left.localeCompare(right));
}
