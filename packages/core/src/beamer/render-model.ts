import type { Span } from "../ast/types.js";
import type { TcolorboxGeometry, TcolorboxPlan } from "./tcolorbox.js";
import type {
  BeamerBlockBodyNode,
  BeamerColumnBodyNode,
  BeamerParagraphBodyNode,
  BeamerTheoremBodyNode,
  BeamerTitlePageBodyNode,
  BeamerColumnsBodyNode,
  BeamerContentsBodyNode,
} from "./content-types.js";
import type {
  BeamerBlockTemplatePlan,
  BeamerTitlePageTemplatePlan,
  ResolvedBeamerTheme,
} from "./theme/types.js";
import type {
  BeamerEmbeddedTikzLayout,
  BeamerParagraphLayout,
  BeamerRect,
} from "./types.js";
import type { BeamerOverlayVisibility } from "./overlay.js";
import type { BeamerUnsupportedPlaceholder } from "./unsupported-placeholder.js";

export type PreparedUnsupportedFlowItem = {
  kind: "unsupported";
  visibility: BeamerOverlayVisibility;
  placeholder: BeamerUnsupportedPlaceholder;
  height: number;
};

export type LaidParagraph = {
  layout: BeamerParagraphLayout;
  svgBody: string;
  height: number;
  listMarkers: readonly {
    id: string;
    sourceSpan?: Span;
    bounds: BeamerRect;
    traceAsGlyph: boolean;
    visibility: "visible" | "hidden";
  }[];
};

export type PreparedBlock = {
  theme?: ResolvedBeamerTheme;
  node: BeamerBlockBodyNode | BeamerTheoremBodyNode;
  plan: BeamerBlockTemplatePlan;
  width: number;
  title: LaidParagraph | null;
  packageBox?: { plan: TcolorboxPlan; geometry: TcolorboxGeometry };
  body: LaidParagraph | null;
  /** Mixed supported text and bounded source cards, positioned within the body. */
  bodyFlow: { items: PositionedFrameFlowItem[]; extent: number } | null;
  titleXOffset: number;
  titleTop: number;
  titleAscent: number;
  titleDepth: number;
  titleBackgroundHeight: number;
  bodyBackgroundTop: number;
  bodyParagraphTop: number;
  bodyBackgroundHeight: number;
  backgroundTop: number;
  backgroundBottom: number;
  naturalHeight: number;
  flowBoxHeight: number;
  endingDepth: number;
};

export type PreparedTitlePage = {
  node: BeamerTitlePageBodyNode;
  plan: BeamerTitlePageTemplatePlan;
  width: number;
  text: readonly {
    paragraph: LaidParagraph;
    x: number;
    top: number;
    colorRole: string;
    fillWeight: number;
  }[];
  boxes: readonly {
    bounds: BeamerRect;
    colorRole: string;
    rounded: boolean;
  }[];
  naturalHeight: number;
  leadingFillWeight: number;
  trailingFillWeight: number;
  /** The template's leading \vbox{}, one \baselineskip below the previous baseline (colorbox styles). */
  leadingEmptyBoxPt?: number;
};

export type PreparedColumns = {
  baselineSkip?: number;
  kind: "columns";
  visibility: BeamerOverlayVisibility;
  node: BeamerColumnsBodyNode;
  columns: PreparedColumnContent[];
  box: Pick<ColumnVerticalBox, "height" | "depth">;
};

/** A column body is one vertical list: its text (with its boxes inline), or a source card. */
export type PreparedColumnFlowItem =
  | PreparedUnsupportedFlowItem
  | {
      kind: "paragraph";
      visibility: BeamerOverlayVisibility;
      paragraph: LaidParagraph;
      leadingSkipPt?: number;
      startsWithVerticalEnvironment?: boolean;
      replacesColumnHeadSkip?: boolean;
      advanceHeight: number;
      trailingSkipPt: number;
      /** The vertical list's final glue, which \endminipage's \unskip removes when the column ends. */
      closingEnvironmentSkipPt?: number;
    };

/** A TikZ picture prepared for painting as an inline box. */
export type PreparedTikzPicture = {
  kind: "tikzpicture";
  visibility: BeamerOverlayVisibility;
  id: string;
  sourceSpan: Span;
  horizontalAlignment: "left" | "center" | "right";
  width: number;
  height: number;
  model: BeamerEmbeddedTikzLayout["model"];
  coveredModel?: BeamerEmbeddedTikzLayout["model"];
  viewBox: BeamerEmbeddedTikzLayout["viewBox"];
  /** Painted statements under an overlay rule, with their bounds in the picture's SVG coordinates. */
  ruledShapes?: readonly { sourceSpan: Span; bounds: { x: number; y: number; width: number; height: number } }[];
};

export type PreparedColumnContent = {
  column: BeamerColumnBodyNode;
  width: number;
  flow: PreparedColumnFlowItem[];
  naturalHeight: number;
  box: ColumnVerticalBox;
};

/** Template material laid out in the frame's vertical list as boxes separated by \vfill glue. */
export type PreparedTemplateFlowItem =
  | { kind: "contents"; visibility: BeamerOverlayVisibility; contents: PreparedContents }
  | {
      kind: "title-page";
      visibility: BeamerOverlayVisibility;
      titlePage: PreparedTitlePage;
    };

export type PreparedFrameFlowItem =
  | PreparedUnsupportedFlowItem
  | {
      kind: "paragraph";
      visibility: BeamerOverlayVisibility;
      node: BeamerParagraphBodyNode;
      paragraph: LaidParagraph;
      naturalHeight: number;
      /** Painted material of embedded boxes above the paragraph's top and below its natural bottom. */
      visualTopInset?: number;
      visualBottomInset?: number;
      boxHeight: number;
      startingBaselineSkip: number;
      endingDepth: number;
      /** The vertical list ends with an alignment's closing skip. */
      closesWithTrivlistSkip?: boolean;
    };

export type PreparedBlockFlowBox = {
  kind: "block";
  visibility: BeamerOverlayVisibility;
  node: BeamerBlockBodyNode | BeamerTheoremBodyNode;
  block: PreparedBlock;
};

/** A block or columns box, laid out as one box of the vertical list whose text holds it. */
export type PreparedFlowBox = PreparedColumns | PreparedBlockFlowBox;

export type PositionedFrameFlowItem = {
  item: PreparedFrameFlowItem;
  contentTop: number;
  referenceY: number;
  visualTop: number;
  visualBottom: number;
};

export type PreparedContents = {
  node: BeamerContentsBodyNode;
  rows: { paragraph: LaidParagraph; x: number; top: number; fillWeight: number; colorRole: string;
    marker?: { bounds: BeamerRect; markup: string }; number?: { paragraph: LaidParagraph; x: number; top: number } }[];
  naturalHeight: number;
  fillWeight: number;
};

/**
 * TeX vertical boxes are positioned by a reference line, not their visual
 * top. Content may protrude above that line (notably Beamer's `[T]` columns),
 * so keep the box dimensions and the content/reference relationship separate.
 */
export type ColumnVerticalBox = {
  height: number;
  depth: number;
  referenceFromContentTop: number;
};
