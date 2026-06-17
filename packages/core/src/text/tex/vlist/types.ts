import type { ParagraphLayoutReport } from "../../knuth-plass/paragraph/report.js";
import type {
  SimpleTexListKind,
  SimpleTexListContext,
  SimpleTexFontState,
  SimpleTexDisplayMathDelimiter,
  SimpleTexSegmentInput,
  SimpleTexVerticalGlueCommandName,
  TexAlignmentProfile,
  TexParagraphAlignment,
  TexSpaceGlueProfile,
} from "../ir.js";
import type { TexMathBox } from "../layout-inline-items.js";
import type { TexMathDisplayAlignment } from "../layout-inline-items.js";

export interface TexSourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface TexBoxMetrics {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export type TexVBoxBaseline =
  | { readonly kind: "first-line" }
  | { readonly kind: "center" }
  | { readonly kind: "explicit"; readonly y: number }
  | { readonly kind: "none" };

export type TexGlueOrder = "normal" | "fil" | "fill" | "filll";
export type TexDimenExpr = number | string;
export type TexDisplayMathSkipVariant = "normal" | "short";

export type TexGlueOrigin =
  | {
      readonly kind: "explicit-command";
      readonly command: SimpleTexVerticalGlueCommandName;
    }
  | {
      readonly kind: "quote-boundary";
      readonly beforeBlockIndex: number;
    }
  | {
      readonly kind: "list-boundary";
      readonly beforeBlockIndex: number;
    }
  | {
      readonly kind: "paragraph-boundary-interline";
      readonly boundary: "plain" | "quote" | "list";
    }
  | {
      readonly kind: "display-math-boundary";
      readonly side: "above" | "below";
      readonly variant?: TexDisplayMathSkipVariant;
    }
  | {
      readonly kind: "display-math-interline";
      readonly side: "above" | "below";
      readonly purpose?: "align-top-correction" | "align-row-baseline" | "align-structural";
    }
  | {
      readonly kind: "display-alignment-intertext-skip";
      readonly side: "above" | "below";
    }
  | {
      readonly kind: "display-alignment-intertext-leading";
    };

export interface TexLineBox {
  readonly lineIndex: number;
  readonly sourceSpan?: TexSourceSpan;
  readonly y: number;
  readonly targetWidth: number;
  readonly metrics: TexBoxMetrics;
  readonly lineLeading?: string;
  readonly preDisplaySize?: number;
}

export type TexRenderItem =
  | {
      readonly kind: "tex-glyph-run";
      readonly text: string;
      readonly fontId: string;
      readonly atPt: number;
      readonly x: number;
      readonly baseline: number;
    }
  | {
      readonly kind: "tex-glyph";
      readonly text: string;
      readonly code: number;
      readonly fontId: string;
      readonly atPt: number;
      readonly x: number;
      readonly baseline: number;
    }
  | {
      readonly kind: "tex-math-svg";
      readonly svgBody: string;
      readonly x: number;
      readonly baseline: number;
    };

export interface TexHitMap {
  readonly kind: string;
  readonly sourceStart?: number;
  readonly sourceEnd?: number;
  readonly contentStart?: number;
  readonly contentEnd?: number;
  readonly width?: number;
  readonly height?: number;
  readonly depth?: number;
  readonly caretStops?: readonly number[];
  readonly constructRanges?: TexMathBox["constructRanges"];
  readonly breakpoints?: TexMathBox["breakpoints"];
}

export interface TexHorizontalLayout {
  readonly metrics: TexBoxMetrics;
  readonly lines?: readonly TexLineBox[];
  readonly renderItems: readonly TexRenderItem[];
  readonly hitMap?: TexHitMap;
}

export interface TexVListParagraphHorizontalLayout {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly lineIndices: readonly number[];
  readonly horizontal: TexHorizontalLayout;
}

export interface TexParagraphInput extends SimpleTexSegmentInput {
  readonly blockIndex: number;
  readonly alignment?: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly spaceGlueProfile?: TexSpaceGlueProfile;
  readonly listContext?: SimpleTexListContext;
  readonly ignoreAncestorBreakMargins?: boolean;
  readonly useScopedLineWidth?: boolean;
  readonly overfullSingleLineFallback?: boolean;
}

export interface TexParagraphItem {
  readonly kind: "paragraph";
  readonly sourceSpan: TexSourceSpan;
  readonly blockIndex: number;
  readonly paragraph: TexParagraphInput;
}

export type TexHBoxRole = {
  readonly kind: "list-label";
  readonly labelKind: TexVBoxListItemLabelKind;
  readonly placement: TexVBoxListItemLabelPlacement;
  readonly listKind: SimpleTexListKind;
  readonly depth: number;
  readonly labelDepth: number;
  readonly itemIndex: number;
  readonly blockIndex: number;
} | {
  readonly kind: "display-align-row";
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly rowIndex: number;
};

export interface TexHBoxItem {
  readonly kind: "hbox";
  readonly sourceSpan?: TexSourceSpan;
  readonly scopePath?: readonly TexVBoxRole[];
  readonly role?: TexHBoxRole;
  readonly x?: number;
  readonly advance?: number;
  readonly affectsVBoxBaseline?: boolean;
  readonly box: TexHorizontalLayout;
}

export type TexVBoxRole =
  | { readonly kind: "quote"; readonly depth: number }
  | {
      readonly kind: "list";
      readonly listKind: SimpleTexListKind;
      readonly depth: number;
      readonly labelDepth: number;
      readonly ownLeftMarginEm: number;
      readonly totalLeftMarginEm: number;
    }
  | {
      readonly kind: "list-item";
      readonly listKind: SimpleTexListKind;
      readonly depth: number;
      readonly labelDepth: number;
      readonly itemIndex: number;
    };

export interface TexVBoxLayout {
  readonly leftMarginWidth: number;
  readonly rightMarginWidth: number;
  readonly list?: TexVBoxListLayout;
  readonly listItem?: TexVBoxListItemLayout;
  readonly paragraphPolicy?: TexVBoxParagraphPolicy;
}

export interface TexVBoxListLayout {
  readonly ownLeftMarginWidth: number;
  readonly labelRightEdge: number;
  readonly descriptionLabelSepWidth: number;
}

export type TexVBoxListItemLabelKind = "default" | "custom" | "description";
export type TexVBoxListItemLabelPlacement = "margin" | "inline";
export type TexVBoxListItemLabelContent =
  | { readonly kind: "source" }
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "glyph";
      readonly text: string;
      readonly code: number;
      readonly fontId: string;
    };

export interface TexVBoxListItemLabelBox {
  readonly kind: TexVBoxListItemLabelKind;
  readonly placement: TexVBoxListItemLabelPlacement;
  readonly content: TexVBoxListItemLabelContent;
  readonly fontState?: SimpleTexFontState;
  readonly rightEdge?: number;
  readonly sourceSpan?: TexSourceSpan;
}

export interface TexVBoxListItemDescriptionLayout {
  readonly labelFirstLineIndentWidth: number;
  readonly bodyFirstLineIndentWidth: number;
}

export interface TexVBoxListItemLayout {
  readonly itemIndex: number;
  readonly label?: TexVBoxListItemLabelBox;
  readonly description?: TexVBoxListItemDescriptionLayout;
}

export interface TexVBoxParagraphPolicy {
  readonly fallbackAlignment?: TexParagraphAlignment;
  readonly preserveRaggedRight?: boolean;
  readonly raggedRightProfile?: TexAlignmentProfile;
  readonly resetInheritedAlignment?: boolean;
  readonly resetSpaceGlueProfile?: boolean;
}

export interface TexVBoxItem {
  readonly kind: "vbox";
  readonly sourceSpan?: TexSourceSpan;
  readonly role?: TexVBoxRole;
  readonly layout?: TexVBoxLayout;
  readonly width?: TexDimenExpr;
  readonly height?: TexDimenExpr;
  readonly items: readonly TexVListItem[];
  readonly alignment?: "top" | "center" | "bottom";
}

export interface TexGlueItem {
  readonly kind: "glue";
  readonly sourceSpan?: TexSourceSpan;
  readonly scopePath?: readonly TexVBoxRole[];
  readonly origin?: TexGlueOrigin;
  readonly size: number;
  readonly stretch?: number;
  readonly shrink?: number;
  readonly stretchOrder?: TexGlueOrder;
  readonly shrinkOrder?: TexGlueOrder;
}

export interface TexPenaltyItem {
  readonly kind: "penalty";
  readonly sourceSpan?: TexSourceSpan;
  readonly scopePath?: readonly TexVBoxRole[];
  readonly penalty: number;
}

export interface TexRuleItem {
  readonly kind: "rule";
  readonly sourceSpan?: TexSourceSpan;
  readonly scopePath?: readonly TexVBoxRole[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface TexPlaceholderItem {
  readonly kind: "placeholder";
  readonly sourceSpan: TexSourceSpan;
  readonly scopePath?: readonly TexVBoxRole[];
  readonly reason: string;
  readonly estimated: TexBoxMetrics;
}

export interface TexDisplayMathItem {
  readonly kind: "display-math";
  readonly sourceSpan: TexSourceSpan;
  readonly scopePath?: readonly TexVBoxRole[];
  readonly text: string;
  readonly content: string;
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly targetWidth: number;
  readonly box: TexMathBox;
}

export interface TexDisplayAlignmentItem {
  readonly kind: "display-alignment";
  readonly sourceSpan: TexSourceSpan;
  readonly scopePath?: readonly TexVBoxRole[];
  readonly text: string;
  readonly content: string;
  readonly delimiter: SimpleTexDisplayMathDelimiter;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly targetWidth: number;
  readonly alignment: TexMathDisplayAlignment;
}

export type TexVListItem =
  | TexParagraphItem
  | TexHBoxItem
  | TexVBoxItem
  | TexGlueItem
  | TexPenaltyItem
  | TexRuleItem
  | TexDisplayMathItem
  | TexDisplayAlignmentItem
  | TexPlaceholderItem;

export interface TexVListDocument {
  readonly kind: "vlist";
  readonly sourceSpan?: TexSourceSpan;
  readonly items: readonly TexVListItem[];
}

export interface PositionedTexVListItem {
  readonly item: TexVListItem;
  readonly path: readonly number[];
  readonly x: number;
  readonly y: number;
  readonly metrics: TexBoxMetrics;
  readonly baseline?: TexVBoxBaseline;
  readonly children?: readonly PositionedTexVListItem[];
}

export interface TexVListBoxReportItem {
  readonly itemKind: TexVListItem["kind"];
  readonly path: readonly number[];
  readonly children?: readonly TexVListBoxReportItem[];
  readonly sourceSpan?: TexSourceSpan;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly totalHeight: number;
  readonly blockIndex?: number;
  readonly baseline?: TexVBoxBaseline;
  readonly role?: TexVBoxRole;
  readonly hboxRole?: TexHBoxRole;
  readonly listItem?: TexVBoxListItemLayout;
  readonly glue?: {
    readonly size: number;
    readonly stretch?: number;
    readonly shrink?: number;
    readonly stretchOrder?: TexGlueOrder;
    readonly shrinkOrder?: TexGlueOrder;
    readonly origin?: TexGlueOrigin;
  };
  readonly penalty?: number;
  readonly placeholderReason?: string;
  readonly displayMath?: {
    readonly delimiter: SimpleTexDisplayMathDelimiter;
    readonly contentStart: number;
    readonly contentEnd: number;
  };
}

export interface TexVListBoxLayoutReport {
  readonly kind: "tex-vlist-boxes";
  readonly metrics: TexBoxMetrics;
  readonly baseline: TexVBoxBaseline;
  readonly tree: readonly TexVListBoxReportItem[];
  readonly items: readonly TexVListBoxReportItem[];
}

export type TexLayoutReport = TexVListBoxLayoutReport;

export interface TexVListLayout {
  readonly metrics: TexBoxMetrics;
  readonly baseline: TexVBoxBaseline;
  readonly items: readonly PositionedTexVListItem[];
  readonly boxReport: TexVListBoxLayoutReport;
  readonly paragraphPlacements: readonly TexVListParagraphPlacement[];
  readonly linePlacements: readonly TexVListLinePlacement[];
  readonly reports: readonly (TexLayoutReport | ParagraphLayoutReport)[];
  readonly errors: readonly string[];
}

export interface TexVListLayoutOptions {
  readonly width: number;
  readonly height?: number;
  readonly verticalAlign?: "top" | "center" | "bottom";
}

export interface TexVListParagraphLineAssignment {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly lineIndices: readonly number[];
}

export interface TexVListParagraphLineOffset {
  readonly lineIndex: number;
  readonly y: number;
  readonly metrics?: TexBoxMetrics;
}

export interface TexVListParagraphBoxMeasurement {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly lineIndices: readonly number[];
  readonly lineOffsets: readonly TexVListParagraphLineOffset[];
  readonly lastLinePreDisplaySize?: number;
  readonly standardMetrics: TexBoxMetrics;
  readonly ruleLeadingMetrics: TexBoxMetrics;
  readonly lastLineMetrics?: TexBoxMetrics;
  readonly standardAdvance: number;
  readonly ruleLeadingAdvance: number;
}

export interface TexVListParagraphPlacement {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly sourceSpan: TexSourceSpan;
  readonly lineIndices: readonly number[];
  readonly x: number;
  readonly y: number;
  readonly metrics: TexBoxMetrics;
}

export interface TexVListLinePlacement {
  readonly lineIndex: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
}
