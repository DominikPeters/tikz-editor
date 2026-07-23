import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type { TexSpaceGlueProfile } from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import type { NodeTextGraphicsResolver } from "../types.js";
import type { TexLength } from "./coordinates.js";

/**
 * A generated list marker measured in ems of the surrounding paragraph font.
 *
 * SVG coordinates use the same 1000-units-per-em, baseline-at-zero convention
 * as native math SVG bodies. A negative depth models TeX constructs such as a
 * raised Beamer marker without losing the marker's painted box geometry.
 */
export interface TexListMarkerProfile {
  readonly svgBody: string;
  readonly widthEm: number;
  readonly heightEm: number;
  readonly depthEm: number;
}

/**
 * Resolved LaTeX list parameters for a document profile.
 *
 * Margins remain font-relative because the class definitions use `em`;
 * vertical lengths are absolute TeX points after the active size command has
 * selected `\@listi`, `\@listii`, and `\@listiii`.
 */
export interface TexListLayoutProfile {
  readonly leftMarginEmByDepth: readonly number[];
  readonly topsepPtByDepth: readonly number[];
  readonly partopsepPtByDepth: readonly number[];
  readonly itemsepPtByDepth: readonly number[];
  readonly parsepPtByDepth: readonly number[];
  readonly initialItemBaselineAdjustmentPt: number;
  readonly itemizeMarkersByDepth?: readonly TexListMarkerProfile[];
}

export interface TexLayoutIrOptions {
  readonly width?: TexLength;
  readonly parindent?: TexLength;
  readonly rightskipStretch?: TexLength;
  readonly baselineSkip?: TexLength;
  readonly initialPreviousDepth?: TexLength;
  readonly listProfile?: TexListLayoutProfile;
  readonly tikzTextWidthNode?: boolean;
  readonly spaceGlueProfile?: TexSpaceGlueProfile;
  readonly textFontProfile?: TexTextFontProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
}
