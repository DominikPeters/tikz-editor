import type { Span } from "../ast/types.js";
import type {
  BeamerBlockBodyNode,
  BeamerColumnBodyNode,
  BeamerFrameBodyNode,
  BeamerParagraphBodyNode,
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

export type LaidParagraph = {
  layout: BeamerParagraphLayout;
  svgBody: string;
  height: number;
  listMarkers: readonly {
    id: string;
    bounds: BeamerRect;
    traceAsGlyph: boolean;
  }[];
};

export type PreparedBlock = {
  node: BeamerBlockBodyNode;
  plan: BeamerBlockTemplatePlan;
  width: number;
  title: LaidParagraph;
  body: LaidParagraph | null;
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
  title: LaidParagraph | null;
  subtitle: LaidParagraph | null;
  naturalHeight: number;
  leadingFillWeight: number;
  trailingFillWeight: number;
};

export type PreparedColumnFlowItem =
  | {
      kind: "paragraph";
      paragraph: LaidParagraph;
      advanceHeight: number;
      trailingSkipPt: number;
    }
  | {
      kind: "vertical-space";
      height: number;
    }
  | {
      kind: "tikzpicture";
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
      block: PreparedBlock;
      height: number;
    };

export type PreparedColumnContent = {
  column: BeamerColumnBodyNode;
  width: number;
  flow: PreparedColumnFlowItem[];
  naturalHeight: number;
  box: ColumnVerticalBox;
};

export type PreparedFrameFlowItem =
  | {
      kind: "title-page";
      titlePage: PreparedTitlePage;
    }
  | {
      kind: "vertical-space";
      node: Extract<BeamerFrameBodyNode, { kind: "vertical-space" }>;
      height: number;
    }
  | {
      kind: "paragraph";
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
      node: BeamerColumnsBodyNode;
      columns: PreparedColumnContent[];
      box: Pick<ColumnVerticalBox, "height" | "depth">;
    }
  | {
      kind: "block";
      node: BeamerBlockBodyNode;
      block: PreparedBlock;
      naturalHeight: number;
      boxHeight: number;
      endingDepth: number;
    }
  | {
      kind: "tikzpicture";
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
