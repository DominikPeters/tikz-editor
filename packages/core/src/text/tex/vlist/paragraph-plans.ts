import type { KnuthPlassLayoutMode } from "../../knuth-plass/index.js";
import type { ResolvedTexFont, TexMetricProvider } from "../fonts/types.js";
import { simpleTexInlineNodesToLayoutItems } from "../layout-inline-items.js";
import type {
  TexLayoutInlineItem,
  TexLayoutLabel,
} from "../layout-inline-items.js";
import type { TexLayoutIrOptions } from "../layout-options.js";
import {
  texHBoxX,
  texLength,
  texVListX,
  type TexLength,
} from "../coordinates.js";
import {
  TexParagraphLayoutState,
} from "../layout-state.js";
import type {
  TexParagraphBreakScopePolicy,
  TexParagraphRightskipStretchMode,
} from "../paragraph-break.js";
import {
  splitSimpleTexParagraphSegments,
  type SimpleTexParagraphSegment,
  type TexAlignmentProfile,
  type TexParagraphAlignment,
  type TexSpaceGlueProfile,
} from "../ir.js";
import { attachTexHBoxesBeforeVListParagraphs } from "./attachments.js";
import type {
  TexHBoxBeforeParagraphAttachment,
  TexVListPathRemap,
} from "./attachments.js";
import {
  texListItemParagraphAttachments,
} from "./list-attachments.js";
import {
  texParagraphScopeContext,
} from "./paragraph-scope.js";
import { texVListPathKey } from "./paths.js";
import {
  texVListParagraphEntries,
} from "./traversal.js";
import type {
  TexParagraphItem,
  TexVListDocument,
} from "./types.js";

export interface TexLayoutParagraphPreparation {
  readonly vlist: TexVListDocument;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly paragraphPlans: readonly TexLayoutParagraphPlan[];
}

export interface TexLayoutParagraphPlan {
  readonly blockIndex: number;
  readonly vlistPath: readonly number[];
  readonly segmentIndex: number;
  readonly segment: SimpleTexParagraphSegment;
  readonly alignment: TexParagraphAlignment;
  readonly alignmentProfile?: TexAlignmentProfile;
  readonly inheritedAlignment: TexParagraphAlignment;
  readonly inheritedAlignmentProfile?: TexAlignmentProfile;
  readonly spaceGlueProfile: TexSpaceGlueProfile;
  readonly inlinePrefixItems: readonly TexLayoutInlineItem[];
  readonly breakContext: TexLayoutParagraphBreakContext;
  readonly overfullSingleLineFallback?: boolean;
  readonly lineLabel?: TexLayoutParagraphLineLabel;
}

export interface TexLayoutParagraphBreakContext {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly width?: TexLength;
  readonly firstLineIndentWidth?: TexLength;
  readonly forcedBreakIndentWidth?: TexLength;
  readonly scopePolicy: TexParagraphBreakScopePolicy;
}

export interface TexLayoutParagraphLineLabel {
  readonly blockIndex: number;
  readonly segmentIndex: number;
  readonly label: TexLayoutLabel;
}

export interface TexLayoutParagraphPreparationParams {
  readonly vlist: TexVListDocument;
  readonly defaultAlignment: TexParagraphAlignment;
  readonly font: ResolvedTexFont;
  readonly metricProvider: TexMetricProvider;
  readonly options: TexLayoutIrOptions;
}

export function prepareTexLayoutParagraphsFromVList(
  params: TexLayoutParagraphPreparationParams
): TexLayoutParagraphPreparation {
  const paragraphPlans: TexLayoutParagraphPlan[] = [];
  const paragraphEntries = texVListParagraphEntries(params.vlist.items);
  const paragraphItems = paragraphEntries.map((entry) => entry.item);
  const marginLabelHBoxAttachments: TexHBoxBeforeParagraphAttachment[] = [];
  const paragraphState = new TexParagraphLayoutState(
    params.defaultAlignment,
    params.options
  );
  const finalParagraphBlockIndex = finalVListParagraphBlockIndex(paragraphItems);
  let layoutMode: KnuthPlassLayoutMode = "wrap";

  for (const entry of paragraphEntries) {
    const paragraph = entry.item.paragraph;
    const scopeContext = texParagraphScopeContext(entry.ancestors);
    const suppressAncestorBreakMargins =
      paragraph.ignoreAncestorBreakMargins === true ||
      paragraph.useScopedLineWidth === true;
    const scopedLineWidth = texParagraphScopedLineWidth(
      scopeContext,
      params.options.width,
      paragraph.useScopedLineWidth === true
    );
    const scopedBreakWidth = paragraph.useScopedLineWidth === true
      ? scopedLineWidth
      : scopeContext.layout.scopedWidth;
    const breakScopeContext = suppressAncestorBreakMargins
      ? texParagraphScopeContextWithoutBreakMargins(scopeContext)
      : scopedBreakWidth !== undefined && scopeContext.layout.scopedWidth !== undefined
        ? texParagraphScopeContextWithBreakMargins(
            scopeContext,
            scopeContext.layout.scopedLeftMarginWidth ?? texLength(0),
            scopeContext.layout.scopedRightMarginWidth ?? texLength(0)
          )
      : scopeContext;
    const blockIndex = paragraph.blockIndex;
    const paragraphStateResult = paragraphState.resolveParagraph({
      paragraph,
      scopePolicy: scopeContext.policy,
      finalParagraphInNode: blockIndex === finalParagraphBlockIndex,
    });
    const segments = splitSimpleTexParagraphSegments(
      paragraph,
      params.options,
      paragraphStateResult.alignment,
      blockIndex
    );
    const spaceGlueProfile = paragraph.spaceGlueProfile ?? paragraphStateResult.spaceGlueProfile;
    if (segments.some((segment) => segment.forcedBreakAfter)) {
      layoutMode = "wrapped-explicit";
    }

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const listAttachments = texListItemParagraphAttachments({
        blockIndex,
        segmentIndex,
        listContext: suppressAncestorBreakMargins
          ? undefined
          : paragraph.listContext,
        listItemLayout: suppressAncestorBreakMargins
          ? undefined
          : scopeContext.listItemLayout,
        font: params.font,
        metricProvider: params.metricProvider,
        spaceGlueProfile,
        inlineNodesToItems: simpleTexInlineNodesToLayoutItems,
        graphicsResolver: params.options.graphicsResolver,
        textFontProfile: params.options.textFontProfile,
        paragraphOriginX: texVListX(scopeContext.layout.leftMarginWidth),
      });
      if (listAttachments.marginLabelHBox) {
        marginLabelHBoxAttachments.push({
          vlistPath: entry.path,
          hbox: listAttachments.marginLabelHBox,
        });
      }
      const quotationPrefix = texQuotationFirstLinePrefix({
        segment,
        font: params.font,
      });
      paragraphPlans.push({
        blockIndex,
        vlistPath: entry.path,
        segmentIndex,
        segment,
        alignment: paragraphStateResult.alignment,
        alignmentProfile: paragraphStateResult.alignmentProfile,
        inheritedAlignment: paragraphStateResult.inheritedAlignment,
        inheritedAlignmentProfile: paragraphStateResult.inheritedAlignmentProfile,
        spaceGlueProfile,
        inlinePrefixItems: [
          ...listAttachments.inlineLabelItems,
          ...quotationPrefix.inlinePrefixItems,
        ],
        ...(paragraph.overfullSingleLineFallback === true
          ? { overfullSingleLineFallback: true }
          : {}),
        breakContext: {
          blockIndex,
          segmentIndex,
          ...(scopedBreakWidth !== undefined ? { width: scopedBreakWidth } : {}),
          firstLineIndentWidth: listAttachments.firstLineIndentWidth ??
            quotationPrefix.firstLineIndentWidth,
          ...(quotationPrefix.forcedBreakIndentWidth !== undefined
            ? { forcedBreakIndentWidth: quotationPrefix.forcedBreakIndentWidth }
            : {}),
          scopePolicy: texParagraphBreakScopePolicy(
            breakScopeContext,
            paragraphStateResult.finalHyphenDemerits
          ),
        },
        ...(listAttachments.marginLabel
          ? {
              lineLabel: {
                blockIndex,
                segmentIndex,
                label: listAttachments.marginLabel,
              },
            }
          : {}),
      });
    }
  }

  const attachmentResult = attachTexHBoxesBeforeVListParagraphs(
    params.vlist,
    marginLabelHBoxAttachments
  );

  return {
    vlist: attachmentResult.vlist,
    layoutMode,
    paragraphPlans: remapParagraphPlanPaths(
      paragraphPlans,
      attachmentResult.paragraphPathRemaps
    ),
  };
}

function texParagraphScopedLineWidth(
  scopeContext: ReturnType<typeof texParagraphScopeContext>,
  rootWidth: TexLength | undefined,
  useScopedLineWidth: boolean
): TexLength | undefined {
  if (useScopedLineWidth) {
    return rootWidth === undefined
      ? undefined
      : texLength(Math.max(
          0,
          rootWidth -
            scopeContext.layout.leftMarginWidth -
            scopeContext.layout.rightMarginWidth
        ));
  }
  return scopeContext.layout.scopedLineWidth;
}

function texQuotationFirstLinePrefix(params: {
  readonly segment: SimpleTexParagraphSegment;
  readonly font: ResolvedTexFont;
}): {
  readonly inlinePrefixItems: readonly TexLayoutInlineItem[];
  readonly firstLineIndentWidth?: TexLength;
  readonly forcedBreakIndentWidth?: TexLength;
} {
  const indentWidth = params.segment.firstLineIndentEm === undefined
    ? undefined
    : texLength(params.segment.firstLineIndentEm * params.font.atPt);
  if (indentWidth === undefined) {
    return { inlinePrefixItems: [] };
  }
  if (params.segment.quotationItemFirstParagraph === true) {
    const sourceStart = params.segment.sourceStart;
    return {
      inlinePrefixItems: [
        {
          kind: "math",
          role: "list-label",
          text: "",
          content: "",
          delimiter: "dollar",
          sourceStart,
          sourceEnd: sourceStart,
          contentStart: sourceStart,
          contentEnd: sourceStart,
          box: {
            source: "",
            content: "",
            sourceStart,
            sourceEnd: sourceStart,
            contentStart: sourceStart,
            contentEnd: sourceStart,
            width: indentWidth,
            height: texLength(0),
            depth: texLength(0),
            caretStops: [texHBoxX(0), texHBoxX(indentWidth)],
          },
        },
        {
          kind: "penalty",
          role: "list-label",
          sourceStart,
          sourceEnd: sourceStart,
          penalty: 0,
        },
      ],
      forcedBreakIndentWidth: indentWidth,
    };
  }
  return {
    inlinePrefixItems: [],
    firstLineIndentWidth: indentWidth,
  };
}

function texParagraphScopeContextWithoutBreakMargins(
  scopeContext: ReturnType<typeof texParagraphScopeContext>
): ReturnType<typeof texParagraphScopeContext> {
  return {
    ...scopeContext,
    layout: {
      leftMarginWidth: texLength(0),
      rightMarginWidth: texLength(0),
    },
    quoteContextActive: false,
    listContextActive: false,
    listItemLayout: undefined,
  };
}

function texParagraphScopeContextWithBreakMargins(
  scopeContext: ReturnType<typeof texParagraphScopeContext>,
  leftMarginWidth: TexLength,
  rightMarginWidth: TexLength
): ReturnType<typeof texParagraphScopeContext> {
  return {
    ...scopeContext,
    layout: {
      leftMarginWidth,
      rightMarginWidth,
    },
  };
}

function remapParagraphPlanPaths(
  plans: readonly TexLayoutParagraphPlan[],
  paragraphPathRemaps: readonly TexVListPathRemap[]
): readonly TexLayoutParagraphPlan[] {
  const pathRemapByOriginalPath = new Map<string, readonly number[]>();
  for (const remap of paragraphPathRemaps) {
    const key = texVListPathKey(remap.from);
    if (pathRemapByOriginalPath.has(key)) {
      throw new Error(
        `TeX paragraph preparation found duplicate paragraph path ${key}.`
      );
    }
    pathRemapByOriginalPath.set(key, remap.to);
  }
  return plans.map((plan) => {
    const key = texVListPathKey(plan.vlistPath);
    const vlistPath = pathRemapByOriginalPath.get(key);
    if (!vlistPath) {
      throw new Error(
        `TeX paragraph preparation lost paragraph path ${key}.`
      );
    }
    return {
      ...plan,
      vlistPath,
    };
  });
}

function texParagraphBreakScopePolicy(
  scopeContext: ReturnType<typeof texParagraphScopeContext>,
  finalHyphenDemerits?: number
): TexParagraphBreakScopePolicy {
  const inList = scopeContext.listContextActive;
  const inQuote = scopeContext.quoteContextActive;
  const rightskipStretchMode: TexParagraphRightskipStretchMode = inQuote
    ? "ragged-right-infinite-otherwise-zero"
    : inList
      ? scopeContext.materialContextActive
        ? "default"
        : "ragged-right-infinite-center-zero"
      : "default";

  return {
    leftMarginWidth: scopeContext.layout.leftMarginWidth,
    rightMarginWidth: scopeContext.layout.rightMarginWidth,
    ...(finalHyphenDemerits !== undefined ? { finalHyphenDemerits } : {}),
    allowParagraphIndent: scopeContext.policy.allowParagraphIndent !== false && !inList,
    allowForcedBreakIndent: scopeContext.policy.allowForcedBreakIndent !== false && !inList,
    forceParfillStretch: inQuote || inList,
    suppressRaggedLeftCenterLeftskipStretch: inQuote || inList,
    rightskipStretchMode,
  };
}

function finalVListParagraphBlockIndex(
  items: readonly TexParagraphItem[]
): number | undefined {
  return items.at(-1)?.paragraph.blockIndex;
}
