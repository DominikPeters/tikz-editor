import type { Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import type { ParagraphLayoutReport } from "../knuth-plass/paragraph/report.js";
import type { TextSourceMap } from "../source-map.js";
import type { NodeTextColorResolver, NodeTextGraphicsResolver } from "../types.js";
import { computerModernTexMetricProvider } from "./fonts/computer-modern.js";
import {
  defaultTexTextFontProfile,
  type TexTextFontProfile,
} from "./fonts/text-profile.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
} from "./fonts/types.js";
import {
  analyzeSimpleTexParagraph,
  type SimpleTexMathNode,
  type SimpleTexNode,
  type TexParagraphAlignment,
  type TexSpaceGlueProfile,
} from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import { remapParagraphLayoutReportSourceMap, remapTexVListLayoutSourceMap } from "./source-map-report.js";
import {
  breakSimpleTexLayoutDocumentParagraphs,
  createSimpleTexLayoutScopeIrFromPreparation,
  layoutTexVListFromBrokenParagraphs,
  prepareSimpleTexLayoutScope,
  type TexVListLayout,
} from "./vlist/index.js";

export interface TexParagraphLayoutOptions {
  readonly paragraphId?: string;
  readonly width: number;
  readonly alignment?: TexParagraphAlignment;
  readonly font?: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly tolerance?: number;
  readonly pretolerance?: number;
  readonly parindent?: number;
  readonly rightskipStretch?: number;
  readonly tikzTextWidthNode?: boolean;
  readonly spaceGlueProfile?: TexSpaceGlueProfile;
  readonly fallbackPolicy?: "whole-node" | "placeholder";
  readonly hyphenator?: Hyphenator | null;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
  readonly colorResolver?: NodeTextColorResolver;
  readonly textFontProfile?: TexTextFontProfile;
  readonly sourceMap?: TextSourceMap;
}

export interface TexParagraphLayoutResult {
  readonly supported: boolean;
  readonly report: ParagraphLayoutReport | null;
  readonly vlistLayout?: TexVListLayout;
  readonly fallbackReason: string | null;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly errors: readonly string[];
}

export function layoutSimpleTexParagraph(
  text: string,
  options: TexParagraphLayoutOptions
): TexParagraphLayoutResult {
  const analysis = analyzeSimpleTexParagraph(text, options.width, options.colorResolver?.resolve.bind(options.colorResolver));
  const fallbackReason = analysis.fallbackReason;
  const usePlaceholderFallback =
    fallbackReason !== null &&
    options.fallbackPolicy === "placeholder" &&
    analysis.ir?.partialFallbackSupported === true;
  if (fallbackReason && !usePlaceholderFallback) {
    return {
      supported: false,
      report: null,
      fallbackReason,
      shapedRuns: new Map(),
      errors: [fallbackReason],
    };
  }

  const textFontProfile = options.textFontProfile ?? defaultTexTextFontProfile;
  const metricProvider = options.metricProvider ?? textFontProfile.metricProvider ?? computerModernTexMetricProvider;
  const defaultAtPt = metricProvider.resolveFont().atPt;
  const font = options.font ?? textFontProfile.resolveTextFont(
    textFontProfile.defaultFontState,
    defaultAtPt,
    metricProvider
  );
  const layoutOptions: TexParagraphLayoutOptions = { ...options, font, metricProvider };
  const paragraphId = options.paragraphId ?? "tex:paragraph";
  const defaultAlignment = options.alignment ?? "ragged-right";
  const blocks = analysis.ir?.blocks ?? [];
  const unsupportedInlineMath = analysis.ir ? findFirstInlineMathNode(analysis.ir.nodes) : null;
  if (unsupportedInlineMath && !options.mathBoxProvider) {
    const reason = `TeX math rendering is not implemented for inline math at source range ${unsupportedInlineMath.sourceStart}-${unsupportedInlineMath.sourceEnd}.`;
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns: new Map(),
      errors: [reason],
    };
  }
  if (blocks.length === 0) {
    const reason = "Paragraph contains no text runs.";
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns: new Map(),
      errors: [reason],
    };
  }

  let layoutIr: ReturnType<typeof createSimpleTexLayoutScopeIrFromPreparation>;
  try {
    const layoutPreparation = prepareSimpleTexLayoutScope({
      blocks,
      items: analysis.ir?.items,
      defaultAlignment,
      font,
      metricProvider,
      options: layoutOptions,
    });
    layoutIr = createSimpleTexLayoutScopeIrFromPreparation(layoutPreparation);
  } catch (error) {
    const reason = error instanceof Error && error.message
      ? error.message
      : "TeX paragraph preparation failed.";
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns: new Map(),
      errors: [reason],
    };
  }
  const errors: string[] = usePlaceholderFallback && fallbackReason
    ? [fallbackReason]
    : [];

  let paragraphBreaks: ReturnType<typeof breakSimpleTexLayoutDocumentParagraphs>;
  try {
    paragraphBreaks = breakSimpleTexLayoutDocumentParagraphs({
      layoutIr,
      font,
      metricProvider,
      options: layoutOptions,
      initialErrors: errors,
    });
  } catch (error) {
    const reason = error instanceof Error && error.message
      ? error.message
      : "TeX paragraph layout failed.";
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns: new Map(),
      errors: [reason],
    };
  }
  if (paragraphBreaks.status === "failed") {
    return {
      supported: false,
      report: null,
      fallbackReason: paragraphBreaks.fallbackReason,
      shapedRuns: paragraphBreaks.shapedRuns,
      errors: paragraphBreaks.errors,
    };
  }

  const reportAssembly = layoutTexVListFromBrokenParagraphs(layoutIr.vlist, {
    paragraphId,
    width: options.width,
    alignment: layoutIr.reportAlignment,
    layoutMode: layoutIr.layoutMode,
    font,
    metricProvider,
    entries: paragraphBreaks.entries,
    initialErrors: errors,
  });
  if (reportAssembly.status === "empty") {
    const reason = "Paragraph contains no text runs.";
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns: reportAssembly.combined.shapedRuns,
      errors: [...reportAssembly.combined.errors, reason],
    };
  }

  const report = remapParagraphLayoutReportSourceMap(reportAssembly.report, options.sourceMap);
  const vlistLayout = remapTexVListLayoutSourceMap(reportAssembly.layout, options.sourceMap);
  return {
    supported: true,
    report,
    vlistLayout,
    fallbackReason: null,
    shapedRuns: reportAssembly.combined.shapedRuns,
    errors: reportAssembly.combined.errors,
  };
}

function findFirstInlineMathNode(nodes: readonly SimpleTexNode[]): SimpleTexMathNode | null {
  for (const node of nodes) {
    if (node.kind === "math") {
      return node;
    }
    if (
      node.kind === "font-command" ||
      node.kind === "group" ||
      node.kind === "mbox" ||
      node.kind === "raisebox" ||
      node.kind === "dimension-box"
    ) {
      const childMath = findFirstInlineMathNode(node.children);
      if (childMath) {
        return childMath;
      }
    }
    if (node.kind === "item" && node.labelNodes) {
      const labelMath = findFirstInlineMathNode(node.labelNodes);
      if (labelMath) {
        return labelMath;
      }
    }
  }
  return null;
}
