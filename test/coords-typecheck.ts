import type {
  FrameLocalPoint,
  SvgPoint,
  ViewportPoint,
  WorldBounds,
  WorldPoint,
  WorldVector
} from "../packages/core/src/coords/index";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report";
import type {
  CaretBaseParams,
  CaretHitResult
} from "../packages/core/src/text/knuth-plass/editor/hitmap";
import {
  documentOffsetToTextarea,
  textareaOffsetToDocument,
  type DocumentSourceOffset,
  type LayoutSourceOffset,
  type TextareaOffset
} from "../packages/core/src/text/source-coordinates";
import {
  offsetTexHBoxLocalX,
  offsetTexHBoxLocalY,
  projectTexHBoxXToLine,
  projectTexLineXToVList,
  translateTexHBoxX,
  translateTexHBoxY,
  translateTexVListX,
  translateTexVListY,
  type TexHBoxLocalX,
  type TexHBoxLocalY,
  type TexHBoxOffsetX,
  type TexHBoxOffsetY,
  TexHBoxX,
  type TexHBoxY,
  TexLength,
  type TexLineLocalX,
  TexLineX,
  TexLineY,
  type TexMuLength,
  TexVListLocalX,
  type TexVListLocalY,
  TexVListX,
  TexVListY
} from "../packages/core/src/text/tex/coordinates";
import type {
  TexMathItem,
  TexMathNucleus
} from "../packages/core/src/text/tex/math/ir";
import {
  offsetTexMathHListItem,
  setTexMathHListWidth,
  type TexMathGlyphLayoutItem,
  type TexMathHList,
  type TexMathHListItem,
  type TexMathRuleLayoutItem
} from "../packages/core/src/text/tex/math/layout";
import type {
  PositionedTexVListItem,
  TexVListLinePlacement,
  TexVListParagraphLineOffset
} from "../packages/core/src/text/tex/vlist/types";

type TexMathPtKern = Extract<
  TexMathItem,
  { readonly kind: "kern"; readonly command: "kern" }
>;
type TexMathMuKern = Extract<
  TexMathItem,
  { readonly kind: "kern"; readonly command: "mkern" }
>;
type TexMathRule = Extract<TexMathNucleus, { readonly kind: "rule" }>;
type TexMathShiftBox = Extract<
  TexMathNucleus,
  { readonly kind: "shift-box" }
>;
type TexMathText = Extract<TexMathNucleus, { readonly kind: "text" }>;
type LineMathCaretEntry = NonNullable<
  ParagraphLayoutReport["lines"][number]["segments"][number]["mathCaretEntries"]
>[number];
type DocumentCaretSourceStart =
  CaretBaseParams<"document">["sourceTextStartOffset"];

declare const frameLocalPointValue: FrameLocalPoint;
declare const svgPointValue: SvgPoint;
declare const viewportPointValue: ViewportPoint;
declare const worldBoundsValue: WorldBounds;
declare const worldPointValue: WorldPoint;
declare const worldVectorValue: WorldVector;
declare const texHBoxLocalXValue: TexHBoxLocalX;
declare const texHBoxLocalYValue: TexHBoxLocalY;
declare const texHBoxOffsetXValue: TexHBoxOffsetX;
declare const texHBoxOffsetYValue: TexHBoxOffsetY;
declare const texHBoxXValue: TexHBoxX;
declare const texHBoxYValue: TexHBoxY;
declare const texLengthValue: TexLength;
declare const texLineLocalXValue: TexLineLocalX;
declare const texLineXValue: TexLineX;
declare const texLineYValue: TexLineY;
declare const texMuLengthValue: TexMuLength;
declare const texVListLocalXValue: TexVListLocalX;
declare const texVListLocalYValue: TexVListLocalY;
declare const texVListXValue: TexVListX;
declare const texVListYValue: TexVListY;
declare const paragraphReportValue: ParagraphLayoutReport;
declare const layoutParagraphReportValue: ParagraphLayoutReport<"layout">;
declare const documentParagraphReportValue: ParagraphLayoutReport<"document">;
declare const layoutSourceOffsetValue: LayoutSourceOffset;
declare const documentSourceOffsetValue: DocumentSourceOffset;
declare const textareaOffsetValue: TextareaOffset;
declare const documentCaretHitResultValue: CaretHitResult<"document">;
declare const lineReportValue: ParagraphLayoutReport["lines"][number];
declare const lineSegmentValue: ParagraphLayoutReport["lines"][number]["segments"][number];
declare const lineMathCaretEntryValue: LineMathCaretEntry;
declare const mathPtKernValue: TexMathPtKern;
declare const mathMuKernValue: TexMathMuKern;
declare const mathRuleValue: TexMathRule;
declare const mathShiftBoxValue: TexMathShiftBox;
declare const mathTextValue: TexMathText;
declare const mathGlyphItemValue: TexMathGlyphLayoutItem;
declare const mathRuleItemValue: TexMathRuleLayoutItem;
declare const mathHListValue: TexMathHList;
declare const positionedVListItemValue: PositionedTexVListItem;
declare const vlistLinePlacementValue: TexVListLinePlacement;
declare const vlistParagraphLineOffsetValue: TexVListParagraphLineOffset;

const sameWorldPoint: WorldPoint = worldPointValue;
const sameWorldVector: WorldVector = worldVectorValue;
const sameWorldBounds: WorldBounds = worldBoundsValue;
const sameTexLength: TexLength = texLengthValue;
const reportWidth: TexLength = paragraphReportValue.width;
const layoutReportSourceStart: LayoutSourceOffset | undefined =
  layoutParagraphReportValue.lines[0]?.segments[0]?.sourceStartRaw;
const documentReportSourceStart: DocumentSourceOffset | undefined =
  documentParagraphReportValue.lines[0]?.segments[0]?.sourceStartRaw;
const convertedDocumentOffset: DocumentSourceOffset = textareaOffsetToDocument(
  textareaOffsetValue,
  { from: 10, to: 20 }
);
const convertedTextareaOffset: TextareaOffset = documentOffsetToTextarea(
  documentSourceOffsetValue,
  { from: 10, to: 20 }
);
const documentCaretSourceStart: DocumentCaretSourceStart =
  documentSourceOffsetValue;
const documentCaretHitOffset: DocumentSourceOffset | null =
  documentCaretHitResultValue.offset;
const reportLineX: TexLineX = lineReportValue.xStart;
const reportLineWidth: TexLength = lineReportValue.width;
const reportLineAscent: TexLength = lineReportValue.ascent;
const reportSegmentX: TexLineX = lineSegmentValue.x;
const reportSegmentWidth: TexLength = lineSegmentValue.width;
const reportMathCaretX: TexLineX = lineMathCaretEntryValue.x;
const reportMathCaretY: TexLineY = lineMathCaretEntryValue.y;
const reportMathCaretHeight: TexLength = lineMathCaretEntryValue.height;
const mathPtKernWidth: TexLength = mathPtKernValue.widthPt;
const mathMuKernWidth: TexMuLength = mathMuKernValue.mu;
const mathRuleWidth: TexLength = mathRuleValue.width;
const mathRuleRaise: TexHBoxOffsetY = mathRuleValue.raise;
const mathShiftAmount: TexLength = mathShiftBoxValue.amount;
const mathTextBoxWidth: TexLength | undefined = mathTextValue.boxWidth;
const mathGlyphLocalX: TexHBoxLocalX = mathGlyphItemValue.x;
const mathGlyphLocalY: TexHBoxLocalY = mathGlyphItemValue.y;
const mathGlyphWidth: TexLength = mathGlyphItemValue.width;
const mathRuleLocalX: TexHBoxLocalX = mathRuleItemValue.x;
const mathRuleLocalY: TexHBoxLocalY = mathRuleItemValue.y;
const mathHListWidth: TexLength = mathHListValue.width;
const positionedVListX: TexVListX = positionedVListItemValue.x;
const positionedVListY: TexVListY = positionedVListItemValue.y;
const positionedVListWidth: TexLength = positionedVListItemValue.metrics.width;
const vlistLineX: TexVListX = vlistLinePlacementValue.x;
const vlistLineY: TexVListY = vlistLinePlacementValue.y;
const vlistLineHeight: TexLength = vlistLinePlacementValue.height;
const vlistParagraphLineY: TexVListLocalY = vlistParagraphLineOffsetValue.y;

const translatedHBoxX: TexHBoxX = translateTexHBoxX(
  texHBoxXValue,
  texHBoxLocalXValue
);
const translatedHBoxY: TexHBoxY = translateTexHBoxY(
  texHBoxYValue,
  texHBoxLocalYValue
);
const offsetHBoxLocalX: TexHBoxLocalX = offsetTexHBoxLocalX(
  texHBoxLocalXValue,
  texHBoxOffsetXValue
);
const offsetHBoxLocalY: TexHBoxLocalY = offsetTexHBoxLocalY(
  texHBoxLocalYValue,
  texHBoxOffsetYValue
);
const translatedVListX: TexVListX = translateTexVListX(
  texVListXValue,
  texVListLocalXValue
);
const translatedVListY: TexVListY = translateTexVListY(
  texVListYValue,
  texVListLocalYValue
);
const projectedLineX: TexLineX = projectTexHBoxXToLine(
  texHBoxXValue,
  texHBoxXValue,
  texLineXValue
);
const projectedVListX: TexVListX = projectTexLineXToVList(
  texLineXValue,
  texLineXValue,
  texVListXValue
);
const resizedMathHList: TexMathHList = setTexMathHListWidth(
  mathHListValue,
  texLengthValue
);
const offsetMathHListItem: TexMathHListItem = offsetTexMathHListItem(
  mathGlyphItemValue,
  texHBoxOffsetXValue,
  texHBoxOffsetYValue
);

// @ts-expect-error world and svg spaces are distinct
const worldPointAsSvgPoint: SvgPoint = worldPointValue;

// @ts-expect-error world and viewport spaces are distinct
const worldPointAsViewportPoint: ViewportPoint = worldPointValue;

// @ts-expect-error frame-local and world spaces are distinct
const frameLocalAsWorldPoint: WorldPoint = frameLocalPointValue;

// @ts-expect-error points and vectors are distinct
const worldPointAsVector: WorldVector = worldPointValue;

// @ts-expect-error vectors and points are distinct
const worldVectorAsPoint: WorldPoint = worldVectorValue;

// @ts-expect-error raw numbers must be branded at a TeX geometry boundary
const rawNumberAsTexLength: TexLength = 12;

// @ts-expect-error raw numbers must be branded at a source-coordinate boundary
const rawNumberAsDocumentSourceOffset: DocumentSourceOffset = 12;

// @ts-expect-error caret source views require a branded start offset
const rawNumberAsDocumentCaretSourceStart: DocumentCaretSourceStart = 12;

// @ts-expect-error layout and document source-coordinate spaces are distinct
const layoutOffsetAsDocumentOffset: DocumentSourceOffset = layoutSourceOffsetValue;

// @ts-expect-error textarea and layout source-coordinate spaces are distinct
const textareaOffsetAsLayoutOffset: LayoutSourceOffset = textareaOffsetValue;

const invalidDocumentToTextarea = documentOffsetToTextarea(
  // @ts-expect-error explicit conversions require an offset in the declared source space
  layoutSourceOffsetValue,
  { from: 10, to: 20 }
);

// @ts-expect-error report source offsets retain the report's coordinate-space parameter
const documentReportAsLayoutReport: ParagraphLayoutReport<"layout"> =
  documentParagraphReportValue;

// @ts-expect-error raw numbers cannot enter HList-local geometry
const rawNumberAsTexHBoxLocalX: TexHBoxLocalX = 12;

// @ts-expect-error raw numbers cannot enter math IR point geometry
const rawNumberAsMathRuleWidth: TexMathRule["width"] = 12;

// @ts-expect-error TeX point lengths and math-unit lengths are distinct
const texLengthAsMuLength: TexMuLength = texLengthValue;

// @ts-expect-error math-unit lengths cannot enter point-space IR geometry
const texMuLengthAsMathShiftAmount: TexMathShiftBox["amount"] = texMuLengthValue;

// @ts-expect-error root VList positions and child-local offsets are distinct
const texVListXAsLocalX: TexVListLocalX = texVListXValue;

// @ts-expect-error child-local offsets are not root VList positions
const texVListLocalXAsRootX: TexVListX = texVListLocalXValue;

// @ts-expect-error HBox-local and paragraph-line positions are distinct
const texHBoxXAsLineX: TexLineX = texHBoxXValue;

// @ts-expect-error HList-local positions and HBox-root positions are distinct
const texHBoxLocalXAsRootX: TexHBoxX = texHBoxLocalXValue;

// @ts-expect-error signed offsets are not HList-local positions
const texHBoxOffsetXAsLocalX: TexHBoxLocalX = texHBoxOffsetXValue;

// @ts-expect-error paragraph-line local offsets and HList-local positions are distinct
const texLineLocalXAsHBoxLocalX: TexHBoxLocalX = texLineLocalXValue;

// @ts-expect-error paragraph-line and root VList block positions are distinct
const texLineYAsVListY: TexVListY = texLineYValue;

const invalidTranslatedHBoxX = translateTexHBoxX(
  texHBoxXValue,
  // @ts-expect-error HBox transforms require an HList-local inline position
  texVListLocalXValue
);

const invalidOffsetHBoxLocalX = offsetTexHBoxLocalX(
  texHBoxLocalXValue,
  // @ts-expect-error local HBox repositioning requires a signed HBox offset
  texLengthValue
);

const invalidTranslatedVListY = translateTexVListY(
  texVListYValue,
  // @ts-expect-error VList translation requires a VList-local block displacement
  texHBoxLocalYValue
);

const invalidProjectedLineX = projectTexHBoxXToLine(
  texHBoxXValue,
  // @ts-expect-error projection requires an origin in the source HBox space
  texLineXValue,
  texLineXValue
);

const invalidResizedMathHList = setTexMathHListWidth(
  mathHListValue,
  // @ts-expect-error HList target width must be a branded TeX point length
  12
);

const invalidOffsetMathHListItemX = offsetTexMathHListItem(
  mathGlyphItemValue,
  // @ts-expect-error HList item repositioning requires a signed inline offset
  texHBoxLocalXValue,
  texHBoxOffsetYValue
);

const invalidOffsetMathHListItemY = offsetTexMathHListItem(
  mathGlyphItemValue,
  texHBoxOffsetXValue,
  // @ts-expect-error HList item repositioning requires a signed vertical offset
  texLengthValue
);

void sameWorldPoint;
void sameWorldVector;
void sameWorldBounds;
void sameTexLength;
void reportWidth;
void layoutReportSourceStart;
void documentReportSourceStart;
void convertedDocumentOffset;
void convertedTextareaOffset;
void documentCaretSourceStart;
void documentCaretHitOffset;
void reportLineX;
void reportLineWidth;
void reportLineAscent;
void reportSegmentX;
void reportSegmentWidth;
void reportMathCaretX;
void reportMathCaretY;
void reportMathCaretHeight;
void mathPtKernWidth;
void mathMuKernWidth;
void mathRuleWidth;
void mathRuleRaise;
void mathShiftAmount;
void mathTextBoxWidth;
void mathGlyphLocalX;
void mathGlyphLocalY;
void mathGlyphWidth;
void mathRuleLocalX;
void mathRuleLocalY;
void mathHListWidth;
void positionedVListX;
void positionedVListY;
void positionedVListWidth;
void vlistLineX;
void vlistLineY;
void vlistLineHeight;
void vlistParagraphLineY;
void translatedHBoxX;
void translatedHBoxY;
void offsetHBoxLocalX;
void offsetHBoxLocalY;
void translatedVListX;
void translatedVListY;
void projectedLineX;
void projectedVListX;
void resizedMathHList;
void offsetMathHListItem;
void worldPointAsSvgPoint;
void worldPointAsViewportPoint;
void frameLocalAsWorldPoint;
void worldPointAsVector;
void worldVectorAsPoint;
void rawNumberAsTexLength;
void rawNumberAsDocumentSourceOffset;
void rawNumberAsDocumentCaretSourceStart;
void layoutOffsetAsDocumentOffset;
void textareaOffsetAsLayoutOffset;
void invalidDocumentToTextarea;
void documentReportAsLayoutReport;
void rawNumberAsTexHBoxLocalX;
void rawNumberAsMathRuleWidth;
void texLengthAsMuLength;
void texMuLengthAsMathShiftAmount;
void texVListXAsLocalX;
void texVListLocalXAsRootX;
void texHBoxXAsLineX;
void texHBoxLocalXAsRootX;
void texHBoxOffsetXAsLocalX;
void texLineLocalXAsHBoxLocalX;
void texLineYAsVListY;
void invalidTranslatedHBoxX;
void invalidOffsetHBoxLocalX;
void invalidTranslatedVListY;
void invalidProjectedLineX;
void invalidResizedMathHList;
void invalidOffsetMathHListItemX;
void invalidOffsetMathHListItemY;
void svgPointValue;
void viewportPointValue;
void texLineXValue;
void texMuLengthValue;
void texVListYValue;
