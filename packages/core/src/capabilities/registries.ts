import { FEATURE_IDS, type FeatureId } from "./feature-ids.js";
import { capabilityMatrix } from "./matrix.js";
import type { CapabilityRow } from "./types.js";

type CapabilityLayer = keyof Pick<CapabilityRow, "parser" | "semantic" | "svg" | "edit">;

function featuresSupportedBy(layer: CapabilityLayer): readonly FeatureId[] {
  // Beamer document features participate here even when the TikZ semantic
  // evaluator does not apply; their renderer contracts have dedicated tests.
  // Manual bibliography stock templates share the existing bibliography ID.
  // Source-backed tabular and booktabs share the text alignment ID.
  // Genuine scoped math alphabets and class font substitutions share one ID.
  // Graphicx text/paragraph transforms share the text transform box ID.
  // Frame footnote projection and stock insertion share the footnote ID.
  // Stock figure/table captions share their source-backed flow capability.
  // Automatic frame splitting and stock continuation titles share one ID.
  // Frame, column and nested block/theorem source cards share the placeholder ID.
  // Headings/class sizes/columns, preamble color roles and basic tcolorbox
  // composition have separate document-renderer contracts.
  return FEATURE_IDS.filter((featureId) => {
    const status = capabilityMatrix[featureId][layer];
    return status !== "none" && status !== "not-applicable";
  });
}

export const parserFeatureRegistry = featuresSupportedBy("parser");
export const semanticFeatureRegistry = featuresSupportedBy("semantic");
export const svgFeatureRegistry = featuresSupportedBy("svg");
// Includes source-based Beamer slide management and clipboard edits with dependency and concrete macro effect analysis (unknown uses stay quiet), overlay edits and direct column/image/spacing resizing; these do not add a TikZ SVG feature.
export const editFeatureRegistry = featuresSupportedBy("edit");
