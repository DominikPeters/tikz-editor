import type { Diagnostic } from "../../diagnostics/types.js";
import type { Span } from "../../ast/types.js";
import type {
  BeamerBlockEnvironment,
} from "../content-types.js";
import type {
  BeamerDelimitedSourceValue,
  BeamerDocumentModel,
  BeamerFrameModel,
  BeamerSectionModel,
  BeamerThemeKind,
  BeamerThemeUseModel,
} from "../types.js";
import type { BeamerPageGeometry, BeamerRect } from "../types.js";

export type BeamerThemeFontRole =
  | "normal-text"
  | "title"
  | "subtitle"
  | "author"
  | "institute"
  | "date"
  | "frame-title"
  | "frame-subtitle"
  | "headline"
  | "section-in-head-foot"
  | "subsection-in-head-foot"
  | "title-in-sidebar"
  | "author-in-sidebar"
  | "section-in-sidebar"
  | "subsection-in-sidebar"
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
  /** Authored parent lists are visited in order, then the role's own fields. */
  parents?: readonly string[];
  use?: readonly string[];
  fg?: string;
  bg?: string;
  fgExpression?: { value: string; span: Span };
  bgExpression?: { value: string; span: Span };
  /** Optional unquantized RGB channels used when downstream xcolor mixes. */
  fgRgb?: readonly [number, number, number];
  /**
   * Deferred `foreground.fg!percentage!background.bg` mix.
   *
   * Beamer color declarations such as `navigation symbols` retain references
   * to other color roles. Keeping that relationship in the resolved theme
   * lets a later color theme update `structure` without requiring every
   * dependent role to be patched by hand.
   */
  fgMix?: {
    foregroundRole: string;
    backgroundRole: string;
    foregroundPercent: number;
  };
  /** Deferred background counterpart of `fgMix`. */
  bgMix?: {
    foregroundRole: string;
    backgroundRole: string;
    foregroundPercent: number;
  };
};

export type ResolvedBeamerThemeColor = {
  fg?: string;
  bg?: string;
};

export type BeamerThemeDimensions = {
  textMarginLeftPt: number;
  textMarginRightPt: number;
  listLeftMarginEmByDepth: readonly [number, number, number];
  sidebarWidthLeft:
    | { kind: "absolute"; valuePt: number }
    | { kind: "page-width"; ratio: number };
  sidebarWidthRight:
    | { kind: "absolute"; valuePt: number }
    | { kind: "page-width"; ratio: number };
};

export type BeamerThemeTemplateRef = {
  id: string;
  options: Readonly<Record<string, string | boolean | number>>;
};

export type BeamerThemeTemplates = {
  sidebar: BeamerThemeTemplateRef;
  headline: BeamerThemeTemplateRef;
  footline: BeamerThemeTemplateRef;
  navigationSymbols: BeamerThemeTemplateRef;
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
  /** Preamble xcolor definitions; colorlet aliases have declaration-time values. */
  colorAliases?: Readonly<Record<string, string>>;
  colorAliasRgb?: Readonly<Record<string, readonly [number, number, number]>>;
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

export type BeamerTemplatePathCommand =
  | {
      kind: "move";
      x: number;
      y: number;
    }
  | {
      kind: "line";
      x: number;
      y: number;
    }
  | {
      kind: "cubic";
      control1X: number;
      control1Y: number;
      control2X: number;
      control2Y: number;
      x: number;
      y: number;
    }
  | {
      kind: "close";
    };

export type BeamerTemplateVectorShape =
  | {
      kind: "path";
      commands: readonly BeamerTemplatePathCommand[];
      fillColorRole?: string;
      fillOpacity?: number;
      strokeColorRole?: string;
      strokeWidthPt?: number;
      lineCap?: "butt" | "round" | "square";
      lineJoin?: "miter" | "round" | "bevel";
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      fillColorRole?: string;
      fillOpacity?: number;
      fillGradient?: {
        direction: "horizontal" | "vertical";
        stops: readonly {
          offset: number;
          colorRole: string;
          paint: "foreground" | "background";
          opacity?: number;
        }[];
      };
      strokeColorRole?: string;
      strokeWidthPt?: number;
    }
  | {
      kind: "circle";
      cx: number;
      cy: number;
      radius: number;
      fillColorRole?: string;
      fillOpacity?: number;
      strokeColorRole?: string;
      strokeWidthPt?: number;
    };

export type BeamerTemplatePrimitive =
  | {
      kind: "fill";
      id: string;
      sourceSpan: Span;
      bounds: BeamerRect;
      colorRole: string;
      /** Color-box fills use the background; rules/hooks use the foreground. */
      paint?: "background" | "foreground";
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
      /** Templates such as sidebar metadata preserve whole-word wrapping. */
      disableAutomaticHyphenation?: boolean;
    }
  | {
      kind: "vector";
      id: string;
      sourceSpan: Span;
      bounds: BeamerRect;
      templateId: string;
      layoutKind:
        | "background"
        | "frame-title"
        | "navigation-symbols"
        | "mini-frame-navigation"
        | "headline-decoration";
      shapes: readonly BeamerTemplateVectorShape[];
    };

export type BeamerChromeTemplatePlan = {
  inset: number;
  primitives: BeamerTemplatePrimitive[];
};

export type BeamerFrameChromePlan = {
  topInset: number;
  headlineInset: number;
  frameTitleInset: number;
  bottomInset: number;
  primitives: BeamerTemplatePrimitive[];
};

/**
 * One frame entry in Beamer's document-wide navigation model.
 *
 * Beamer writes the equivalent information to its `.nav` file independently
 * from the outer theme which eventually consumes it.
 */
export type BeamerNavigationFrameEntry = {
  frame: BeamerFrameModel;
  frameIndex: number;
};

export type BeamerNavigationSubsectionEntry = {
  subsection: BeamerSectionModel;
  subsectionIndex: number;
  /** The short title when supplied, otherwise the long source title. */
  title: BeamerDelimitedSourceValue;
  frames: readonly BeamerNavigationFrameEntry[];
};

export type BeamerNavigationSectionEntry = {
  section: BeamerSectionModel;
  sectionIndex: number;
  /** The short title when supplied, otherwise the long source title. */
  title: BeamerDelimitedSourceValue;
  frames: readonly BeamerNavigationFrameEntry[];
  directFrames: readonly BeamerNavigationFrameEntry[];
  subsections: readonly BeamerNavigationSubsectionEntry[];
};

export type BeamerNavigationModel = {
  frames: readonly BeamerNavigationFrameEntry[];
  sections: readonly BeamerNavigationSectionEntry[];
  /** Frames before the first section, matching Beamer's section number zero. */
  unsectionedFrames: readonly BeamerNavigationFrameEntry[];
  /** Subsections encountered before any top-level section. */
  orphanSubsections: readonly BeamerNavigationSubsectionEntry[];
};

/**
 * Frame-local view over the immutable navigation model.
 *
 * Template planners receive this snapshot instead of reconstructing section
 * topology from source spans or frame arrays.
 */
export type BeamerFrameNavigationSnapshot = {
  model: BeamerNavigationModel;
  currentFrame: BeamerNavigationFrameEntry;
  currentSection: BeamerNavigationSectionEntry | null;
  currentSubsection: BeamerNavigationSubsectionEntry | null;
  frameIndexInSection: number | null;
  frameIndexInSubsection: number | null;
};

export type BeamerTitlePageTemplatePlan = {
  templateId: string;
  style: "colorbox" | "rounded" | "inmargin";
  shadow: boolean;
  outerBleedPt: number;
  titleBoxTopPt: number;
  titleBoxHeightPt: number;
  titleBaselineFromBoxTopPt: number;
  subtitleBaselineFromBoxTopPt: number;
};

export type BeamerFrameTemplateContext = {
  /** Measured strut-backed paragraphs for the stock frame-title color box. */
  measureFrameHeading?: (value: BeamerDelimitedSourceValue, role: "frame-title" | "frame-subtitle", width: number) => {
    firstHeight: number; extent: number; endingDepth: number; baselineSkip: number; xHeight: number;
  } | null;
  document: BeamerDocumentModel;
  frame: BeamerFrameModel;
  frameIndex: number;
  totalFrames: number;
  navigation: BeamerFrameNavigationSnapshot;
  step: number;
  page: BeamerPageGeometry;
  theme: ResolvedBeamerTheme;
};

export type BeamerBlockTemplatePlan = {
  templateId: string;
  style: "default" | "rounded" | "modern" | "inmargin";
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
    /**
     * Natural TeX vbox material. This is deliberately separate from the PGF
     * paint geometry above: beamerbaseboxes.sty mixes pt layout skips with bp
     * path coordinates.
     */
    boxTopSkipPt: number;
    titleBodyGapPt: number;
    /**
     * When set, the body colorbox establishes its first paragraph baseline
     * with this baseline skip after an empty vbox. `bodyInitialVSkipEx`
     * models the preceding ex-relative correction. This is the default
     * Beamer block template's `vmode` behavior; rounded blocks instead use
     * the fixed `bodyTopPaddingPt`.
     */
    bodyFirstBaselineSkipPt: number | null;
    bodyInitialVSkipEx: number;
    /**
     * Default blocks remain separate vertical-list material, so the outer
     * frame computes inter-line glue against the title line's ascent.
     * Rounded blocks are packaged as one box.
     */
    flowBoxHeight: "natural" | "title-ascent";
    /**
     * Explicit vertical glue after the default body colorbox preserves the
     * box's depth as TeX's `\prevdepth`. Rounded boxes raise their body hbox
     * and expose zero depth instead.
     */
    flowEndingDepth: "zero" | "body-last-line";
    bodyBottomRaisePt: number;
    boxBottomSkipPt: number;
    cornerRadiusPt: number;
    shadowExtentPt: number;
  };
};

export type BeamerBlockTemplateContext = {
  environment: BeamerBlockEnvironment;
  theme: ResolvedBeamerTheme;
};
