import { FEATURE_IDS, type FeatureId } from "../capabilities/feature-ids.js";
import type { FeatureUsage } from "./types.js";

const knownFeatures = new Set<string>(FEATURE_IDS);

export function initializeFeatureUsage(): FeatureUsage {
  const usage: FeatureUsage = {};
  for (const featureId of FEATURE_IDS) usage[featureId] = "unused";
  return usage;
}

/** Also supports sparse statement contributions; unsupported usage dominates. */
export function markFeatureUsage(usage: FeatureUsage, featureId: FeatureId, status: "supported" | "unsupported"): void {
  if (!knownFeatures.has(featureId)) return;
  if (status === "unsupported") usage[featureId] = "used-unsupported";
  else if (usage[featureId] !== "used-unsupported") usage[featureId] = "used-supported";
}

export function mergeFeatureUsage(target: FeatureUsage, contributions: FeatureUsage): void {
  for (const [featureId, state] of Object.entries(contributions)) {
    if (state === "used-unsupported") target[featureId] = state;
    else if (state === "used-supported" && target[featureId] !== "used-unsupported") target[featureId] = state;
  }
}
