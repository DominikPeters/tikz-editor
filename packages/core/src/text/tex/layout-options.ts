import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type { TexSpaceGlueProfile } from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import type { DocumentGraphicsResolver } from "../../graphics/types.js";
import type { TexLength } from "./coordinates.js";
import type { TexDimensionContext } from "./dimensions.js";

/**
 * A generated list marker measured in ems of the surrounding paragraph font.
 *
 * SVG coordinates use the native math renderer's 100-units-per-TeX-point,
 * baseline-at-zero convention. A negative depth models TeX constructs such
 * as a raised Beamer marker without losing the marker's painted box geometry.
 */
export interface TexListMarkerProfile {
  readonly svgBody: string;
  readonly widthEm: number;
  readonly heightEm: number;
  readonly depthEm: number;
  /**
   * Additional horizontal displacement of the marker's label box.
   *
   * This models template wrappers such as Beamer inmargin's zero-width
   * `\llap`, independently from the list body's `\leftmargin`.
   */
  readonly rightEdgeOffsetEm?: number;
  /** Optional font glyph used instead of an authored SVG marker shape. */
  readonly glyph?: Readonly<{
    text: string;
    code: number;
    fontId: string;
    fontSizePt: number;
    color: string;
    /** Baseline offset from the surrounding marker baseline. */
    baselineOffsetEm: number;
  }>;
  /** Painted sub-rectangle relative to the marker box's top-left corner. */
  readonly paintBoundsEm?: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  /** Optional text projected over a decorated enumerate marker. */
  readonly projectedText?: Readonly<{
    text: string;
    fontId: string;
    fontSizePt: number;
    color: string;
    xEm: number;
    /** Baseline offset from the surrounding marker baseline. */
    baselineOffsetEm: number;
  }>;
  /** The marker paint is a path; structural traces compare its text only. */
  readonly traceAsGlyph?: boolean;
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
  readonly bibliographyMargins?: ReadonlyMap<number, number>;
  readonly bibliographyParsepPt?: number;
  readonly topsepPtByDepth: readonly number[];
  readonly topsepStretchPtByDepth?: readonly number[];
  readonly topsepShrinkPtByDepth?: readonly number[];
  readonly partopsepPtByDepth: readonly number[];
  readonly itemsepPtByDepth: readonly number[];
  readonly itemsepStretchPtByDepth?: readonly number[];
  readonly itemsepShrinkPtByDepth?: readonly number[];
  readonly parsepPtByDepth: readonly number[];
  readonly parsepStretchPtByDepth?: readonly number[];
  readonly parsepShrinkPtByDepth?: readonly number[];
  readonly initialItemBaselineAdjustmentPt: number;
  readonly itemizeMarkersByDepth?: readonly TexListMarkerProfile[];
  readonly resolveEnumerateMarker?: (
    itemIndex: number,
    labelDepth: number
  ) => TexListMarkerProfile | undefined;
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
  /**
   * Some outer environments enter horizontal mode before their first source
   * token. If that token is display math, TeX ships a zero-sized line and
   * consequently selects the short display skips.
   */
  readonly leadingDisplay?: Readonly<{
    readonly emptyLineBaselineSkipPt: number;
  }>;
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
  /** Ambient TeX dimension registers, resolved before inline box lowering. */
  readonly dimensionContext?: TexDimensionContext;
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
  readonly graphicsResolver?: DocumentGraphicsResolver;
}
