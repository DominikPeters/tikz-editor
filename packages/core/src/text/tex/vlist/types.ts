import type { ParagraphLayoutReport } from "../../knuth-plass/paragraph/report.js";
import type {
  SimpleTexListKind,
  SimpleTexListContext,
  SimpleTexSegmentInput,
  SimpleTexVerticalGlueCommandName,
  TexAlignmentProfile,
  TexParagraphAlignment,
} from "../ir.js";

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

export type TexGlueOrigin =
  | {
      readonly kind: "explicit-command";
      readonly command: SimpleTexVerticalGlueCommandName;
    }
  | {
      readonly kind: "paragraph-boundary";
      readonly beforeBlockIndex: number;
      readonly quoteSize: number;
      readonly listSize: number;
    };

export interface TexLineBox {
  readonly lineIndex: number;
  readonly sourceSpan?: TexSourceSpan;
  readonly y: number;
  readonly targetWidth: number;
  readonly metrics: TexBoxMetrics;
  readonly lineLeading?: string;
}

export interface TexRenderItem {
  readonly kind: string;
}

export interface TexHitMap {
  readonly kind: string;
}

export interface TexHorizontalLayout {
  readonly metrics: TexBoxMetrics;
  readonly lines?: readonly TexLineBox[];
  readonly renderItems: readonly TexRenderItem[];
  readonly hitMap?: TexHitMap;
}

export interface TexVListParagraphHorizontalLayout {
  readonly blockIndex: number;
  readonly lineIndices: readonly number[];
  readonly horizontal: TexHorizontalLayout;
}

export interface TexParagraphInput extends SimpleTexSegmentInput {
  readonly blockIndex: number;
  readonly alignment?: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly listContext?: SimpleTexListContext;
}

export interface TexParagraphItem {
  readonly kind: "paragraph";
  readonly sourceSpan: TexSourceSpan;
  readonly blockIndex: number;
  readonly paragraph: TexParagraphInput;
}

export interface TexHBoxItem {
  readonly kind: "hbox";
  readonly sourceSpan?: TexSourceSpan;
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
  readonly paragraphPolicy?: TexVBoxParagraphPolicy;
}

export interface TexVBoxListLayout {
  readonly ownLeftMarginWidth: number;
  readonly labelRightEdge: number;
  readonly descriptionLabelSepWidth: number;
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

export type TexVListItem =
  | TexParagraphItem
  | TexHBoxItem
  | TexVBoxItem
  | TexGlueItem
  | TexPenaltyItem
  | TexRuleItem
  | TexPlaceholderItem;

export interface TexVListDocument {
  readonly kind: "vlist";
  readonly sourceSpan?: TexSourceSpan;
  readonly items: readonly TexVListItem[];
}

export interface PositionedTexVListItem {
  readonly item: TexVListItem;
  readonly path?: readonly number[];
  readonly x: number;
  readonly y: number;
  readonly metrics: TexBoxMetrics;
  readonly children?: readonly PositionedTexVListItem[];
}

export interface TexVListBoxReportItem {
  readonly itemKind: TexVListItem["kind"];
  readonly path: readonly number[];
  readonly sourceSpan?: TexSourceSpan;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly totalHeight: number;
  readonly blockIndex?: number;
  readonly role?: TexVBoxRole;
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
}

export interface TexVListBoxLayoutReport {
  readonly kind: "tex-vlist-boxes";
  readonly metrics: TexBoxMetrics;
  readonly baseline: TexVBoxBaseline;
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
  readonly lineIndices: readonly number[];
}

export interface TexVListParagraphLineOffset {
  readonly lineIndex: number;
  readonly y: number;
}

export interface TexVListParagraphBoxMeasurement {
  readonly blockIndex: number;
  readonly lineIndices: readonly number[];
  readonly lineOffsets: readonly TexVListParagraphLineOffset[];
  readonly standardMetrics: TexBoxMetrics;
  readonly ruleLeadingMetrics: TexBoxMetrics;
  readonly standardAdvance: number;
  readonly ruleLeadingAdvance: number;
}

export interface TexVListParagraphPlacement {
  readonly blockIndex: number;
  readonly vlistPath?: readonly number[];
  readonly sourceSpan: TexSourceSpan;
  readonly lineIndices: readonly number[];
  readonly y: number;
  readonly metrics: TexBoxMetrics;
}

export interface TexVListLinePlacement {
  readonly lineIndex: number;
  readonly y: number;
  readonly height: number;
}
