import { FEATURE_IDS, type FeatureId } from "./feature-ids.js";
import { capabilityMatrix } from "./matrix.js";
import type { CapabilityRow } from "./types.js";

type CapabilityLayer = keyof Pick<CapabilityRow, "parser" | "semantic" | "svg" | "edit">;

function featuresSupportedBy(layer: CapabilityLayer): readonly FeatureId[] {
  // Beamer document features participate here even when the TikZ semantic
  // evaluator does not apply; their renderer contracts have dedicated tests.
  // Manual bibliography stock templates share the existing bibliography ID.
  // Source-backed tabular and booktabs share the text alignment ID.
  // Literal mathcodes, scoped math alphabets and class font substitutions share one ID.
  // Graphicx text/paragraph transforms share the text transform box ID.
  // Ordered xslant/yslant shorthands share the affine transform_cm contract.
  // Frame footnote projection and stock insertion share the footnote ID.
  // Speaker notes have a separate presenter-only extraction and audience exclusion contract.
  // Dirac math, default scientific quantities and preformatted source each have bounded contracts.
  // Subfigure composition extends the float/caption contract.
  // Stock figure/table captions share their source-backed flow capability.
  // Automatic frame splitting and stock continuation titles share one ID.
  // Frame, column and nested block/theorem source cards share the placeholder ID.
  // Embedded picture context and isolated SVG definitions share the overlay picture ID.
  // Measured titles/subtitles, eight class display/list profiles and columns; preamble color roles and basic tcolorbox
  // composition have separate document-renderer contracts.
  // Measured stock/modern headings and class-sized list/math flow share frame flow.
  // Footer/sidebar metadata, stock contents, fixed overlay areas, centering and
  // modern progress paint extend that bounded flow contract. Dove/serif and
  // professionalfonts extend the registered stock theme/color/font contracts.
  // Native Fira Sans typography shares stock modern theme contracts; scoped block
  // role declarations extend the existing color/titlepage document contracts.
  // Literal enumerate mini templates and their list editing contract have a dedicated ID.
  return FEATURE_IDS.filter((featureId) => {
    const status = capabilityMatrix[featureId][layer];
    return status !== "none" && status !== "not-applicable";
  });
}

export const parserFeatureRegistry = featuresSupportedBy("parser");
export const semanticFeatureRegistry = featuresSupportedBy("semantic");
export const svgFeatureRegistry = featuresSupportedBy("svg");
// Includes source-based Beamer slide management and clipboard edits with dependency and concrete macro effect analysis (unknown uses stay quiet), document inspector theme/page/navigation/short-metadata/color-side writes, list reveal/mini-template edits, image replacement, overlay timing, drawing-layer creation/editing and direct column/image/spacing resizing; these do not add a TikZ SVG feature.
export const editFeatureRegistry = featuresSupportedBy("edit");
