import { FEATURE_IDS, type FeatureId } from "./feature-ids.js";
import { capabilityMatrix } from "./matrix.js";
import type { CapabilityRow } from "./types.js";

type CapabilityLayer = keyof Pick<CapabilityRow, "parser" | "semantic" | "svg" | "edit">;

function featuresSupportedBy(layer: CapabilityLayer): readonly FeatureId[] {
  return FEATURE_IDS.filter((featureId) => {
    const status = capabilityMatrix[featureId][layer];
    return status !== "none" && status !== "not-applicable";
  });
}

export const parserFeatureRegistry = featuresSupportedBy("parser");
export const semanticFeatureRegistry = featuresSupportedBy("semantic");
export const svgFeatureRegistry = featuresSupportedBy("svg");
export const editFeatureRegistry = featuresSupportedBy("edit");
