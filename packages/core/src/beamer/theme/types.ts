import type { Diagnostic } from "../../diagnostics/types.js";
import type { Span } from "../../ast/types.js";
import type {
  BeamerBlockEnvironment,
} from "../content-types.js";
import type {
  BeamerDelimitedSourceValue,
  BeamerDocumentModel,
  BeamerFrameModel,
  BeamerThemeKind,
  BeamerThemeUseModel,
} from "../types.js";
import type { BeamerPageGeometry, BeamerRect } from "../types.js";

export type BeamerThemeFontRole =
  | "normal-text"
  | "frame-title"
  | "frame-subtitle"
  | "footline"
  | "block-title"
  | "block-body";

export type BeamerThemeFont = {
  family: "serif" | "sans" | "monospace";
  series: "medium" | "bold";
  shape: "upright" | "italic" | "slanted" | "small-caps";
  sizePt: number;
  lineHeightPt: number;
  /**
   * Records a source-requested face which the current native profile
   * substitutes. The layout engine still uses the resolved family above.
   */
  substitutedFor?: string;
};

export type BeamerThemeColor = {
  parent?: string;
  fg?: string;
  bg?: string;
};

export type ResolvedBeamerThemeColor = {
  fg?: string;
  bg?: string;
};

export type BeamerThemeDimensions = {
  textMarginLeftPt: number;
  textMarginRightPt: number;
};

export type BeamerThemeTemplateRef = {
  id: string;
  options: Readonly<Record<string, string | boolean>>;
};

export type BeamerThemeTemplates = {
  headline: BeamerThemeTemplateRef;
  footline: BeamerThemeTemplateRef;
  frameTitle: BeamerThemeTemplateRef;
  titlePage: BeamerThemeTemplateRef;
  sectionPage: BeamerThemeTemplateRef;
  block: BeamerThemeTemplateRef;
  bullets: readonly [
    BeamerThemeTemplateRef,
    BeamerThemeTemplateRef,
    BeamerThemeTemplateRef,
  ];
  enumerations: readonly [
    BeamerThemeTemplateRef,
    BeamerThemeTemplateRef,
    BeamerThemeTemplateRef,
  ];
};

export type BeamerThemeComponentProvenance = {
  kind: BeamerThemeKind | "class-defaults";
  name: string;
  source: BeamerThemeUseModel | null;
};

/**
 * Fully reduced theme state consumed by frame composition.
 *
 * Theme names are intentionally absent from the renderer-facing decisions:
 * structural variation is represented by template references, while colors,
 * fonts, dimensions, and options are resolved data.
 */
export type ResolvedBeamerTheme = {
  id: string;
  colors: Readonly<Record<string, BeamerThemeColor>>;
  fonts: Readonly<Record<BeamerThemeFontRole, BeamerThemeFont>>;
  dimensions: Readonly<BeamerThemeDimensions>;
  templates: Readonly<BeamerThemeTemplates>;
  options: Readonly<Record<string, string | boolean>>;
  appliedComponents: readonly BeamerThemeComponentProvenance[];
  diagnostics: readonly Diagnostic[];
};

export type BeamerThemeUse = {
  kind: BeamerThemeKind;
  name: string;
  options: Readonly<Record<string, string | boolean>>;
  source: BeamerThemeUseModel;
};

export type BeamerTemplateTextSource =
  | {
      kind: "mapped";
      value: BeamerDelimitedSourceValue;
    }
  | {
      kind: "derived";
      text: string;
      sourceSpan: Span;
    };

export type BeamerTemplatePrimitive =
  | {
      kind: "fill";
      id: string;
      sourceSpan: Span;
      bounds: BeamerRect;
      colorRole: string;
    }
  | {
      kind: "text";
      id: string;
      sourceSpan: Span;
      bounds: BeamerRect;
      source: BeamerTemplateTextSource;
      fontRole: BeamerThemeFontRole;
      colorRole: string;
      alignment: "left" | "center" | "right";
      verticalAlignment: "top" | "center" | "bottom";
      /** Optional absolute page baseline for single-line template text. */
      baselineY?: number;
      /** Fixed interword glue for template-generated spacing such as `\,`. */
      interwordSpacePt?: number;
    };

export type BeamerFrameChromePlan = {
  topInset: number;
  bottomInset: number;
  primitives: BeamerTemplatePrimitive[];
};

export type BeamerFrameTemplateContext = {
  document: BeamerDocumentModel;
  frame: BeamerFrameModel;
  frameIndex: number;
  totalFrames: number;
  step: number;
  page: BeamerPageGeometry;
  theme: ResolvedBeamerTheme;
};

export type BeamerBlockTemplatePlan = {
  templateId: string;
  style: "default" | "rounded" | "modern";
  shadow: boolean;
  titleColorRole: string;
  bodyColorRole: string;
  titleFontRole: "block-title";
  bodyFontRole: "block-body";
  /**
   * Source-derived box constants. Rounded blocks use bp because their PGF
   * paths are specified in bp in beamerbaseboxes.sty.
   */
  geometry: {
    beforeSkipPt: number;
    afterSkipPt: number;
    outerBleedPt: number;
    roundedTopInsetPt: number;
    titleDepthFloorPt: number;
    titleExtraHeightPt: number;
    transitionHeightPt: number;
    bodyTopPaddingPt: number;
    bodyExtraHeightPt: number;
    boxBottomAdvancePt: number;
    cornerRadiusPt: number;
    shadowExtentPt: number;
  };
};

export type BeamerBlockTemplateContext = {
  environment: BeamerBlockEnvironment;
  theme: ResolvedBeamerTheme;
};
