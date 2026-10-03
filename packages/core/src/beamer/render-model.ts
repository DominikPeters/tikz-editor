import type { Span } from "../ast/types.js";
import type { TcolorboxGeometry, TcolorboxPlan } from "./tcolorbox.js";
import type {
  BeamerBlockBodyNode,
  BeamerColumnBodyNode,
  BeamerFrameBodyNode,
  BeamerParagraphBodyNode,
  BeamerTheoremBodyNode,
  BeamerTitlePageBodyNode,
  BeamerColumnsBodyNode,
} from "./content-types.js";
import type {
  BeamerBlockTemplatePlan,
  BeamerTitlePageTemplatePlan,
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

export type PreparedTitlePageMetadataBox = {
  field: "author" | "institute" | "date";
  paragraph: LaidParagraph | null;
  /** Box top measured from the title-page group top, like plan.titleBoxTopPt. */
  topPt: number;
  /** Colorbox height: 2*sep padding plus the laid content extent. */
  heightPt: number;
};

export type PreparedTitlePage = {
  node: BeamerTitlePageBodyNode;
  plan: BeamerTitlePageTemplatePlan;
  width: number;
  title: LaidParagraph | null;
  subtitle: LaidParagraph | null;
  /** Author/institute/date colorboxes of the default template, in order. */
  metadataBoxes: readonly PreparedTitlePageMetadataBox[];
  naturalHeight: number;
  leadingFillWeight: number;
  trailingFillWeight: number;
};

export type PreparedColumnFlowItem =
  | PreparedUnsupportedFlowItem
  | {
      kind: "paragraph";
      visibility: BeamerOverlayVisibility;
      paragraph: LaidParagraph;
      leadingSkipPt?: number;
      advanceHeight: number;
      trailingSkipPt: number;
    }
  | {
      kind: "vertical-space";
      visibility: BeamerOverlayVisibility;
      node: Extract<BeamerFrameBodyNode, { kind: "vertical-space" }>;
      height: number;
      relativeUnitPt?: number;
    }
  | {
      kind: "tikzpicture";
      visibility: BeamerOverlayVisibility;
      id: string;
      sourceSpan: Span;
      horizontalAlignment: "left" | "center";
      width: number;
      height: number;
      model: BeamerEmbeddedTikzLayout["model"];
      viewBox: BeamerEmbeddedTikzLayout["viewBox"];
    }
  | {
      kind: "block";
      visibility: BeamerOverlayVisibility;
      block: PreparedBlock;
      height: number;
      leadingSkipPt?: number;
    };

export type PreparedColumnContent = {
  column: BeamerColumnBodyNode;
  width: number;
  flow: PreparedColumnFlowItem[];
  naturalHeight: number;
  box: ColumnVerticalBox;
};

export type PreparedFrameFlowItem =
  | PreparedUnsupportedFlowItem
  | {
      kind: "title-page";
      visibility: BeamerOverlayVisibility;
      titlePage: PreparedTitlePage;
    }
  | {
      kind: "vertical-space";
      visibility: BeamerOverlayVisibility;
      node: Extract<BeamerFrameBodyNode, { kind: "vertical-space" }>;
      height: number;
      relativeUnitPt?: number;
    }
  | {
      kind: "paragraph";
      visibility: BeamerOverlayVisibility;
      node: BeamerParagraphBodyNode;
      paragraph: LaidParagraph;
      naturalHeight: number;
      boxHeight: number;
      startingBaselineSkip: number;
      leadingAdjustment: number;
      endingDepth: number;
      trailingListGlue: {
        naturalPt: number;
        shrinkPt: number;
      };
      /**
       * TeX vertical glue preserves `\prevdepth`. When a paragraph-owned
       * `\vspace` is followed by a columns hbox, retain the depth of the box
       * immediately preceding that glue rather than the enclosing vlist's
       * zero depth.
       */
      trailingVerticalSpacePreviousDepth: number | null;
    }
  | {
      kind: "columns";
      visibility: BeamerOverlayVisibility;
      node: BeamerColumnsBodyNode;
      columns: PreparedColumnContent[];
      box: Pick<ColumnVerticalBox, "height" | "depth">;
    }
  | {
      kind: "block";
      visibility: BeamerOverlayVisibility;
      node: BeamerBlockBodyNode | BeamerTheoremBodyNode;
      block: PreparedBlock;
      naturalHeight: number;
      boxHeight: number;
      endingDepth: number;
    }
  | {
      kind: "tikzpicture";
      visibility: BeamerOverlayVisibility;
      node: Extract<BeamerFrameBodyNode, { kind: "tikzpicture" }>;
      tikz: Extract<PreparedColumnFlowItem, { kind: "tikzpicture" }>;
      naturalHeight: number;
      boxHeight: number;
      contentInsetTop: number;
      endingDepth: number;
      surroundingGlue: {
        top: {
          naturalPt: number;
          shrinkPt: number;
        };
        bottom: {
          naturalPt: number;
          shrinkPt: number;
        };
      };
    };

export type PositionedFrameFlowItem = {
  item: PreparedFrameFlowItem;
  contentTop: number;
  referenceY: number;
  visualTop: number;
  visualBottom: number;
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
