import { FEATURE_IDS, type FeatureId } from "./feature-ids.js";
import { capabilityMatrix } from "./matrix.js";
import type { CapabilityRow } from "./types.js";

type CapabilityLayer = keyof Pick<CapabilityRow, "parser" | "semantic" | "svg" | "edit">;

function featuresSupportedBy(layer: CapabilityLayer): readonly FeatureId[] {
  // Beamer document features participate here even when the TikZ semantic
  // evaluator does not apply; their renderer contracts have dedicated tests.
  // Manual bibliography stock templates share the existing bibliography ID.
  return FEATURE_IDS.filter((featureId) => {
    const status = capabilityMatrix[featureId][layer];
    return status !== "none" && status !== "not-applicable";
  });
}

export const parserFeatureRegistry = featuresSupportedBy("parser");
export const semanticFeatureRegistry = featuresSupportedBy("semantic");
export const svgFeatureRegistry = featuresSupportedBy("svg");
// Includes source-based Beamer overlay edits and direct column/image/spacing resizing; these do not add a TikZ SVG feature.
export const editFeatureRegistry = featuresSupportedBy("edit");
