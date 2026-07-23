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

export interface TexDisplayMathGlueProfile {
  readonly sizePt: number;
  readonly stretchPt: number;
  readonly shrinkPt: number;
}

/**
 * Class- and font-size-owned TeX display parameters.
 *
 * LaTeX installs these registers as part of size selection, so consumers such
 * as Beamer must be able to replace the article/10pt defaults without
 * changing the generic VList algorithm.
 */
export interface TexDisplayMathLayoutProfile {
  readonly above: Readonly<{
    normal: TexDisplayMathGlueProfile;
    short: TexDisplayMathGlueProfile;
  }>;
  readonly below: Readonly<{
    normal: TexDisplayMathGlueProfile;
    short: TexDisplayMathGlueProfile;
  }>;
}

export interface TexLayoutIrOptions {
  readonly width?: TexLength;
  readonly parindent?: TexLength;
  readonly rightskipStretch?: TexLength;
  readonly baselineSkip?: TexLength;
  readonly initialPreviousDepth?: TexLength;
  readonly listProfile?: TexListLayoutProfile;
  readonly displayMathProfile?: TexDisplayMathLayoutProfile;
  readonly tikzTextWidthNode?: boolean;
  readonly spaceGlueProfile?: TexSpaceGlueProfile;
  readonly textFontProfile?: TexTextFontProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
}
