import type { ResolvedTexFont } from "../fonts/types.js";
import { roundTexPt } from "../fonts/units.js";
import {
  texHBoxX,
  texHBoxY,
  texLength,
  texVListY,
  type TexLength,
} from "../coordinates.js";
import {
  parseSimpleTexInlineNodes,
  type SimpleTexInlineNode,
  type SimpleTexListContext,
} from "../ir.js";
import type { TexMathTextPart } from "../math/ir.js";
import type { TexDisplayMathLayoutProfile } from "../layout-options.js";
import { layoutTexVListItems } from "./layout.js";
import { createMeasuredParagraphVListMeasurer } from "./paragraph-measurement.js";
import type {
  TexDisplayMathSkipVariant,
  TexDisplayAlignmentItem,
  TexDisplayMathItem,
  TexGlueItem,
  TexHBoxItem,
  TexParagraphItem,
  TexBoxMetrics,
  TexVBoxRole,
  TexVBoxItem,
  TexVListDocument,
  TexVListItem,
  TexVListParagraphBoxMeasurement,
} from "./types.js";

const latexArticleDisplaySkipsPt: TexDisplayMathLayoutProfile = {
  above: {
    normal: {
      sizePt: 10,
      stretchPt: 2,
      shrinkPt: 5,
    },
    short: {
      sizePt: 0,
      stretchPt: 3,
      shrinkPt: 0,
    },
  },
  below: {
    normal: {
      sizePt: 10,
      stretchPt: 2,
      shrinkPt: 5,
    },
    short: {
      sizePt: 6,
      stretchPt: 3,
      shrinkPt: 3,
    },
  },
} as const;

const latexAmsmathAlignTopCorrectionPt = texLength(-3);

type DisplayAlignmentGluePurpose =
  | "align-top-correction"
  | "align-row-baseline"
  | "align-structural";

export interface SimpleTexParagraphVerticalSkip {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly segmentIndex: number;
  readonly size: TexLength;
  readonly quoteSize: TexLength;
  readonly listSize: TexLength;
  readonly listStretch?: TexLength;
  readonly listShrink?: TexLength;
  readonly afterDisplayParagraphSkip?: boolean;
  readonly listExitAfterDisplay?: boolean;
  readonly trivlistSize?: TexLength;
  readonly trivlistAfterDisplay?: boolean;
}


export function materializeDisplayMathVerticalGlueInVList(
  vlist: TexVListDocument,
  profile: TexDisplayMathLayoutProfile = latexArticleDisplaySkipsPt,
  font?: ResolvedTexFont
): TexVListDocument {
  return {
    ...vlist,
    items: materializeDisplayMathVerticalGlueInItems(vlist.items, profile, font),
  };
}

function materializeDisplayMathVerticalGlueInItems(
  sourceItems: readonly TexVListItem[],
  profile: TexDisplayMathLayoutProfile,
  font?: ResolvedTexFont
): readonly TexVListItem[] {
  const items: TexVListItem[] = [];
  for (const [index, item] of sourceItems.entries()) {
    if (item.kind === "vbox") {
      items.push({
        ...item,
        items: materializeDisplayMathVerticalGlueInItems(item.items, profile, font),
      });
      continue;
    }
    if (item.kind === "display-math") {
      const previous = sourceItems[index - 1];
      // With no room for the label, TeX breaks it onto its own line. The
      // display then follows the remaining empty line of the paragraph.
      const overfullLabel = item.targetWidth === 0 && previous?.kind === "paragraph" &&
        previous.sourceSpan.start === previous.sourceSpan.end && previous.paragraph.listContext?.showLabel === true;
      const insertsEmptyLine = overfullLabel || ((index === 0 || item.startsAfterExplicitPar === true || followsVerticalModeBox(sourceItems, index)) && profile.leadingDisplay !== undefined);
      if (insertsEmptyLine) {
        items.push(leadingDisplayEmptyLineGlue(item, profile, index > 0));
        items.push(displayEmptyLineHBox(item, "before-display"));
      }
      items.push(displayMathBoundaryGlueItem(
        item,
        "above",
        profile,
        insertsEmptyLine ? "short" : undefined,
        overfullLabel ? undefined : font
      ));
      items.push(item);
      items.push(displayMathBoundaryGlueItem(item, "below", profile));
      continue;
    }
    if (item.kind === "display-alignment") {
      const startsParagraph = index === 0 || item.startsAfterExplicitPar === true || followsVerticalModeBox(sourceItems, index);
      if (startsParagraph && profile.leadingDisplay) {
        items.push(leadingDisplayEmptyLineGlue(item, profile, index > 0));
        items.push(displayEmptyLineHBox(item, "before-display"));
      }
      items.push(displayMathBoundaryGlueItem(
        item,
        "above",
        profile,
        startsParagraph && profile.leadingDisplay ? "short" : undefined,
        font
      ));
      items.push(...displayAlignmentMaterialItems(item, displayMathProfileForItem(item, profile)));
      items.push(displayMathBoundaryGlueItem(item, "below", profile));
      continue;
    }
    items.push(item);
  }
  return items;
}

/**
 * A display after a box appended in vertical mode (an embedded block or columns box, which end
 * with \par) starts a paragraph: TeX ships its empty first line and takes the short skips.
 */
function followsVerticalModeBox(items: readonly TexVListItem[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const previous = items[cursor];
    if (previous?.kind === "glue" || previous?.kind === "penalty") continue;
    return previous?.kind === "hbox" && previous.role?.kind === "external-flow";
  }
  return false;
}

function displayMathProfileForItem(
  item: TexDisplayMathItem | TexDisplayAlignmentItem,
  profile: TexDisplayMathLayoutProfile
): TexDisplayMathLayoutProfile {
  if (!item.displaySkipCommand) return profile;
  const override = profile.sizeOverrides?.[item.displaySkipCommand];
  if (override) return { ...profile, ...override };
  // size10/11/12.clo assign these registers only in normalsize, small and
  // footnotesize. Other size declarations and explicit fontsize inherit them.
  const classIndex = item.normalFontSizePt === 12 ? 2 :
    item.normalFontSizePt !== undefined && Math.abs(item.normalFontSizePt - 10.95) < .01 ? 1 : 0;
  const registers = ({
    normalsize: [[10, 2, 5, 3, 6, 3, 3], [11, 3, 6, 3, 6.5, 3.5, 3], [12, 3, 7, 3, 6.5, 3.5, 3]],
    small: [[8.5, 3, 4, 2, 4, 2, 2], [10, 2, 5, 3, 6, 3, 3], [11, 3, 6, 3, 6.5, 3.5, 3]],
    footnotesize: [[6, 2, 4, 1, 3, 1, 2], [8, 2, 4, 1, 4, 2, 2], [10, 2, 5, 3, 6, 3, 3]],
  } as const)[item.displaySkipCommand][classIndex];
  const [sizePt, stretchPt, shrinkPt, aboveShortStretch, belowShort, belowShortStretch, belowShortShrink] = registers;
  const normal = { sizePt, stretchPt, shrinkPt };
  return { ...profile,
    above: { normal, short: { sizePt: 0, stretchPt: aboveShortStretch, shrinkPt: 0 } },
    below: { normal, short: { sizePt: belowShort, stretchPt: belowShortStretch, shrinkPt: belowShortShrink } },
  };
}

function displayMathBoundaryGlueItem(
  item: TexDisplayMathItem | TexDisplayAlignmentItem,
  side: "above" | "below",
  profile: TexDisplayMathLayoutProfile,
  variant?: TexDisplayMathSkipVariant,
  font?: ResolvedTexFont
): TexGlueItem {
  profile = displayMathProfileForItem(item, profile);
  if (item.kind === "display-alignment" || item.box.fullDisplayWidth) variant = "normal";
  const materialWidth = item.kind === "display-math"
    ? item.box.displayContentWidth ?? item.box.width
    : item.alignment.width;
  const displayLeftEdge = texLength(roundTexPt(
    Math.max(0, (item.targetWidth - materialWidth) / 2)
  ));
  const alignment = item.precedingLineAlignment ?? item.scopePath?.filter(role => role.kind === "trivlist").at(-1)?.alignment;
  if (variant === "short" && (alignment === "center" || alignment === "ragged-left")) variant = "normal";
  // Even a zero-width line has TeX's two-quad pre-display allowance. A wide
  // equation in a narrow column can therefore require the normal skips.
  if (variant === "short" && font && displayLeftEdge <= 2 * (item.fontSizePt ?? font.atPt) * font.data.fontdimen.quad) variant = "normal";
  const skip = profile[side][variant ?? "normal"];
  return {
    kind: "glue",
    sourceSpan: item.sourceSpan,
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-math-boundary",
      side,
      ...(item.displaySkipCommand ? { profile } : {}),
      ...(item.baselineSkip !== undefined ? { baselineSkip: item.baselineSkip } : {}),
      ...(variant ? { variant } : {}),
      ...(side === "above" ? { displayLeftEdge } : {}),
    },
    size: texLength(skip.sizePt),
    stretch: texLength(skip.stretchPt),
    shrink: texLength(skip.shrinkPt),
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function leadingDisplayEmptyLineGlue(
  item: TexDisplayMathItem | TexDisplayAlignmentItem,
  profile: TexDisplayMathLayoutProfile,
  isInterior: boolean
): TexGlueItem {
  const suppressInitialBaseline = !isInterior && profile.leadingDisplay?.emptyLineBaselineSkipPt === 0;
  return {
    kind: "glue",
    sourceSpan: item.sourceSpan,
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-math-interline",
      side: "above",
      ...(!suppressInitialBaseline ? { purpose: "leading-empty-line-baseline" as const } : {}),
    },
    // A containing environment may already ship the leading line and request
    // zero additional baseline (for example Beamer column[T]'s colheadskip).
    size: texLength(suppressInitialBaseline
      ? 0 : item.baselineSkip ?? profile.leadingDisplay?.emptyLineBaselineSkipPt ?? 0),
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function displayEmptyLineHBox(
  item: TexDisplayMathItem | TexDisplayAlignmentItem,
  position: "before-display" | "after-display-vspace"
): TexHBoxItem {
  return {
    kind: "hbox",
    sourceSpan: item.sourceSpan,
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    role: {
      kind: "display-empty-line",
      position,
    },
    box: {
      metrics: {
        width: texLength(0),
        height: texLength(0),
        depth: texLength(0),
      },
      renderItems: [],
    },
  };
}

export function materialVBoxMetrics(
  item: TexVBoxItem,
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>
): TexBoxMetrics | undefined {
  if (!isMaterialTexVBoxItem(item)) {
    return undefined;
  }
  const laidOut = layoutTexVListItems(
    [item],
    createMeasuredParagraphVListMeasurer(paragraphMeasurements),
    null,
    texVListY(0)
  );
  return laidOut.positioned[0]?.metrics;
}

export function isMaterialTexVBoxItem(item: TexVBoxItem): boolean {
  return item.material !== undefined;
}

function displayAlignmentMaterialItems(
  item: TexDisplayAlignmentItem,
  profile: TexDisplayMathLayoutProfile
): readonly TexVListItem[] {
  const rows: TexVListItem[] = [];
  rows.push(displayAlignmentGlueItem(item, displayAlignmentTopCorrection(item), "align-top-correction"));
  rows.push(displayAlignmentGlueItem(item, texLength(0), "align-structural"));
  rows.push(displayAlignmentGlueItem(item, texLength(0), "align-row-baseline"));
  for (const row of item.alignment.rows) {
    if (row.rowIndex > 0) {
      rows.push(displayAlignmentGlueItem(item, texLength(0), "align-structural"));
      rows.push(displayAlignmentGlueItem(item, texLength(0), "align-row-baseline"));
    }
    for (const intertext of item.alignment.intertexts?.filter((candidate) => candidate.beforeRowIndex === row.rowIndex) ?? []) {
      rows.push(displayAlignmentIntertextSkipItem(
        item,
        intertext,
        "below",
        profile
      ));
      rows.push(displayAlignmentIntertextLeadingItem(item, intertext));
      rows.push(displayAlignmentIntertextParagraph(item, intertext));
      rows.push(displayAlignmentIntertextSkipItem(
        item,
        intertext,
        "above",
        profile
      ));
      rows.push(displayAlignmentGlueItem(item, texLength(0), "align-structural"));
      rows.push(displayAlignmentGlueItem(item, texLength(0), "align-row-baseline"));
    }
    rows.push(displayAlignmentRowHBox(item, row));
  }
  rows.push(displayAlignmentGlueItem(item, texLength(0), "align-structural"));
  return rows;
}

function displayAlignmentIntertextLeadingItem(
  item: TexDisplayAlignmentItem,
  intertext: NonNullable<TexDisplayAlignmentItem["alignment"]["intertexts"]>[number]
): TexGlueItem {
  return {
    kind: "glue",
    sourceSpan: {
      start: intertext.sourceStart,
      end: intertext.sourceEnd,
    },
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-alignment-intertext-leading",
      openedInterline: item.alignment.openedInterline,
    },
    size: texLength(0),
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function displayAlignmentIntertextSkipItem(
  item: TexDisplayAlignmentItem,
  intertext: NonNullable<TexDisplayAlignmentItem["alignment"]["intertexts"]>[number],
  side: "above" | "below",
  profile: TexDisplayMathLayoutProfile
): TexGlueItem {
  const skip = profile[side].normal;
  return {
    kind: "glue",
    sourceSpan: {
      start: intertext.sourceStart,
      end: intertext.sourceEnd,
    },
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-alignment-intertext-skip",
      side,
    },
    size: texLength(skip.sizePt),
    stretch: texLength(skip.stretchPt),
    shrink: texLength(skip.shrinkPt),
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function displayAlignmentIntertextParagraph(
  item: TexDisplayAlignmentItem,
  intertext: NonNullable<TexDisplayAlignmentItem["alignment"]["intertexts"]>[number]
): TexParagraphItem {
  const blockIndex = displayAlignmentIntertextBlockIndex(intertext.sourceStart);
  const parsed = displayAlignmentIntertextNodes(intertext.parts);
  const rawText = displayAlignmentIntertextRawText(intertext.parts);
  const nodes = parsed.unsupported
    ? displayAlignmentPlainTextNodes(intertext, rawText)
    : parsed.nodes;
  const sourceSpan = {
    start: intertext.contentStart,
    end: intertext.contentEnd,
  };
  const scope = displayAlignmentIntertextScope(item.scopePath);
  return {
    kind: "paragraph",
    sourceSpan,
    blockIndex,
    paragraph: {
      text: rawText,
      sourceSpan,
      ...(item.fontSizePt !== undefined ? { fontSizePt: item.fontSizePt } : {}),
      ...(item.baselineSkip !== undefined ? { baselineSkip: item.baselineSkip } : {}),
      nodes,
      noIndent: true,
      alignment: "justified",
      spaceGlueProfile: "font",
      sourceHitPolicy: "source-range",
      overfullSingleLineFallback: true,
      quoteDepth: scope.quoteDepth,
      ...(item.scopePath ? { scopePath: item.scopePath } : {}),
      ...(scope.listContext ? { listContext: scope.listContext } : {}),
      ...(scope.quoteDepth > 0 || scope.listContext ? { useScopedLineWidth: true } : {}),
      ...(scope.listContext ? {} : { ignoreAncestorBreakMargins: true }),
      blockIndex,
    },
  };
}

function displayAlignmentIntertextScope(
  scopePath: readonly TexVBoxRole[] | undefined
): {
  readonly quoteDepth: number;
  readonly listContext?: SimpleTexListContext;
} {
  const quoteDepth = scopePath?.filter((role) => role.kind === "quote").length ?? 0;
  const listRole = lastRoleOfKind(scopePath, "list");
  if (!listRole) {
    return { quoteDepth };
  }
  const itemRole = lastRoleOfKind(scopePath, "list-item");
  return {
    quoteDepth,
    listContext: {
      kind: listRole.listKind,
      depth: listRole.depth,
      labelDepth: listRole.labelDepth,
      itemIndex: itemRole?.itemIndex ?? 0,
      ownLeftMarginEm: listRole.ownLeftMarginEm,
      totalLeftMarginEm: listRole.totalLeftMarginEm,
      showLabel: false,
    },
  };
}

function lastRoleOfKind<K extends TexVBoxRole["kind"]>(
  scopePath: readonly TexVBoxRole[] | undefined,
  kind: K
): Extract<TexVBoxRole, { kind: K }> | undefined {
  if (!scopePath) {
    return undefined;
  }
  for (let index = scopePath.length - 1; index >= 0; index -= 1) {
    const role = scopePath[index];
    if (role && roleHasKind(role, kind)) return role;
  }
  return undefined;
}

function displayAlignmentIntertextBlockIndex(sourceStart: number): number {
  return -1_000_000 - Math.max(0, sourceStart);
}

export function displayAlignmentIntertextLeadingSize(
  previousDepth: TexLength,
  paragraph: TexVListParagraphBoxMeasurement | undefined,
  openedInterline: TexDisplayAlignmentItem["alignment"]["openedInterline"]
): TexLength {
  if (!paragraph) {
    return texLength(0);
  }
  const vboxHeight = paragraph.lineIndices.length > 1
    ? paragraph.ruleLeadingAdvance
    : paragraph.ruleLeadingMetrics.height;
  return texOpenedInterlineGlueSize(
    previousDepth,
    vboxHeight,
    openedInterline
  );
}

export function displayAlignmentPreviousDepth(
  paragraph: TexVListParagraphBoxMeasurement
): TexLength {
  return texParagraphLastLineDepth(paragraph);
}

export function texParagraphLastLineDepth(
  paragraph: TexVListParagraphBoxMeasurement
): TexLength {
  if (paragraph.lastLineMetrics) {
    return paragraph.lastLineMetrics.depth;
  }
  const lastLine = paragraph.lineOffsets.at(-1);
  if (lastLine?.metrics) {
    return lastLine.metrics.depth;
  }
  if (lastLine?.y === undefined) {
    return paragraph.ruleLeadingMetrics.depth;
  }
  return texLength(Math.max(0, roundTexPt(
    paragraph.ruleLeadingAdvance - lastLine.y - paragraph.ruleLeadingMetrics.height
  )));
}

function displayAlignmentPlainTextNodes(
  intertext: NonNullable<TexDisplayAlignmentItem["alignment"]["intertexts"]>[number],
  text: string
): readonly SimpleTexInlineNode[] {
  return text.length > 0
    ? [{
        kind: "text",
        text,
        sourceStart: intertext.contentStart,
        sourceEnd: intertext.contentEnd,
      }]
    : [];
}

function displayAlignmentIntertextNodes(
  parts: readonly TexMathTextPart[]
): { readonly nodes: readonly SimpleTexInlineNode[]; readonly unsupported: boolean } {
  const nodes: SimpleTexInlineNode[] = [];
  let unsupported = false;
  for (const part of parts) {
    if (part.kind === "text") {
      const parsed = parseSimpleTexInlineNodes(part.text, part.sourceSpan.start);
      nodes.push(...parsed.nodes);
      unsupported ||= parsed.unsupportedCommand;
      continue;
    }
    nodes.push({
      kind: "math",
      text: `$${part.content}$`,
      delimiter: "dollar",
      content: part.content,
      contentStart: part.contentSourceSpan.start,
      contentEnd: part.contentSourceSpan.end,
      sourceStart: part.sourceSpan.start,
      sourceEnd: part.sourceSpan.end,
    });
  }
  return { nodes, unsupported };
}

function displayAlignmentIntertextRawText(parts: readonly TexMathTextPart[]): string {
  return parts.map((part) =>
    part.kind === "text" ? part.text : `$${part.content}$`
  ).join("");
}

function displayAlignmentTopCorrection(item: TexDisplayAlignmentItem): TexLength {
  return item.delimiter === "multline" || item.delimiter === "multline-star"
    ? texLength(0)
    : latexAmsmathAlignTopCorrectionPt;
}

function displayAlignmentGlueItem(
  item: TexDisplayAlignmentItem,
  size: TexLength,
  purpose: DisplayAlignmentGluePurpose
): TexGlueItem {
  return {
    kind: "glue",
    sourceSpan: item.sourceSpan,
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    origin: {
      kind: "display-math-interline",
      side: "above",
      purpose,
      openedInterline: item.alignment.openedInterline,
    },
    size,
    stretchOrder: "normal",
    shrinkOrder: "normal",
  };
}

function displayAlignmentRowHBox(
  item: TexDisplayAlignmentItem,
  row: TexDisplayAlignmentItem["alignment"]["rows"][number]
): TexHBoxItem {
  return {
    kind: "hbox",
    sourceSpan: {
      start: row.sourceStart,
      end: row.sourceEnd,
    },
    ...(item.scopePath ? { scopePath: item.scopePath } : {}),
    role: {
      kind: "display-align-row",
      delimiter: item.delimiter,
      rowIndex: row.rowIndex,
    },
    x: row.x,
    box: {
      metrics: {
        width: row.width,
        height: row.height,
        depth: row.depth,
      },
      hitMap: {
        kind: "tex-math",
        sourceStart: row.sourceStart,
        sourceEnd: row.sourceEnd,
        contentStart: row.contentStart,
        contentEnd: row.contentEnd,
        width: row.width,
        height: row.height,
        depth: row.depth,
        ...(row.caretMap ? { caretMap: row.caretMap } : {}),
        ...(row.caretStops ? { caretStops: row.caretStops } : {}),
        ...(row.constructRanges ? { constructRanges: row.constructRanges } : {}),
        ...(row.breakpoints ? { breakpoints: row.breakpoints } : {}),
      },
      renderItems: row.svgBody
        ? [{
            kind: "tex-math-svg",
            svgBody: row.svgBody,
            x: texHBoxX(0),
            baseline: texHBoxY(row.height),
          }]
        : [],
    },
  };
}

export function displayMathSkipVariant(
  displayLeftEdge: TexLength,
  previousParagraphMeasurement: TexVListParagraphBoxMeasurement | undefined
): TexDisplayMathSkipVariant {
  // A display that starts a vertical list has no finite preceding-line width;
  // TeX consequently takes the normal display skips.
  if (!previousParagraphMeasurement) {
    return "normal";
  }
  const preDisplaySize = previousParagraphMeasurement.lastLinePreDisplaySize ??
    texLength(Number.NEGATIVE_INFINITY);
  // TeX.web chooses the normal skips when the centered display overlaps the
  // preceding line's pre-display size; otherwise it uses the short skips.
  return displayLeftEdge <= preDisplaySize ? "normal" : "short";
}

export function resolveDisplayMathBoundaryGlueItem(
  item: TexGlueItem,
  variant: TexDisplayMathSkipVariant,
  profile: TexDisplayMathLayoutProfile = latexArticleDisplaySkipsPt
): TexGlueItem {
  if (item.origin?.kind !== "display-math-boundary") {
    return item;
  }
  const skip = (item.origin.profile ?? profile)[item.origin.side][variant];
  const { profile: resolvedProfile, baselineSkip: resolvedBaseline, ...origin } = item.origin;
  void resolvedProfile;
  void resolvedBaseline;
  return {
    ...item,
    origin: { ...origin, variant },
    size: texLength(skip.sizePt),
    stretch: texLength(skip.stretchPt),
    shrink: texLength(skip.shrinkPt),
  };
}

export function texOpenedInterlineGlueSize(
  previousDepth: TexLength,
  nextHeight: TexLength,
  openedInterline: TexDisplayAlignmentItem["alignment"]["openedInterline"]
): TexLength {
  const baselineGlue = texLength(roundTexPt(
    openedInterline.baselineSkip - previousDepth - nextHeight
  ));
  return baselineGlue < openedInterline.lineSkipLimit
    ? openedInterline.lineSkip
    : baselineGlue;
}

function roleHasKind<K extends TexVBoxRole["kind"]>(role: TexVBoxRole, kind: K): role is Extract<TexVBoxRole, { kind: K }> {
  return role.kind === kind;
}
