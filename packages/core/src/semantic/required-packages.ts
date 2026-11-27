import { FEATURE_IDS, type FeatureId } from "../capabilities/feature-ids.js";
import type { FeatureUsage } from "./types.js";

const PGFPLOTS_FEATURES: readonly FeatureId[] = FEATURE_IDS.filter((featureId) => featureId.startsWith("pgfplots_"));

/**
 * The LaTeX packages beyond `tikz` a picture needs, from what it used: any
 * pgfplots axis, plot or setting needs `pgfplots`. The parallel of
 * `inferRequiredTikzLibraries` for packages.
 */
export function inferRequiredPackages(featureUsage: FeatureUsage): string[] {
  const used = (featureId: FeatureId): boolean => {
    const state = featureUsage[featureId];
    return state === "used-supported" || state === "used-unsupported";
  };
  return PGFPLOTS_FEATURES.some(used) ? ["pgfplots"] : [];
}
