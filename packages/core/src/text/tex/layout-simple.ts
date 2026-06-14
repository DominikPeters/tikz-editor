import type { Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import type { ParagraphLayoutReport } from "../knuth-plass/paragraph/report.js";
import { computerModernTexMetricProvider } from "./fonts/computer-modern.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
} from "./fonts/types.js";
import {
  analyzeSimpleTexParagraph,
  type SimpleTexNode,
  type TexParagraphAlignment,
} from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import {
  breakSimpleTexLayoutDocumentParagraphs,
  createSimpleTexLayoutDocumentIrFromPreparation,
  layoutTexVListFromBrokenParagraphs,
  prepareSimpleTexLayoutDocument,
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
  readonly tikzTextWidthNode?: boolean;
  readonly fallbackPolicy?: "whole-node" | "placeholder";
  readonly hyphenator?: Hyphenator | null;
  readonly mathBoxProvider?: TexMathBoxProvider;
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
  const analysis = analyzeSimpleTexParagraph(text, options.width);
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

  const metricProvider = options.metricProvider ?? computerModernTexMetricProvider;
  const font = options.font ?? metricProvider.resolveFont();
  const layoutOptions: TexParagraphLayoutOptions = { ...options, font, metricProvider };
  const paragraphId = options.paragraphId ?? "tex:paragraph";
  const defaultAlignment = options.alignment ?? "ragged-right";
  const blocks = analysis.ir?.blocks ?? [];
  if (analysis.ir && simpleTexNodesContainInlineMath(analysis.ir.nodes) && !options.mathBoxProvider) {
    const reason = "Paragraph contains inline math but no TeX math box provider is available.";
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

  const layoutPreparation = prepareSimpleTexLayoutDocument({
    blocks,
    items: analysis.ir?.items,
    defaultAlignment,
    font,
    metricProvider,
    options: layoutOptions,
  });
  const layoutIr = createSimpleTexLayoutDocumentIrFromPreparation(layoutPreparation);
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

  return {
    supported: true,
    report: reportAssembly.report,
    vlistLayout: reportAssembly.layout,
    fallbackReason: null,
    shapedRuns: reportAssembly.combined.shapedRuns,
    errors: reportAssembly.combined.errors,
  };
}

function simpleTexNodesContainInlineMath(nodes: readonly SimpleTexNode[]): boolean {
  for (const node of nodes) {
    if (node.kind === "math") {
      return true;
    }
    if (
      (node.kind === "font-command" || node.kind === "group") &&
      simpleTexNodesContainInlineMath(node.children)
    ) {
      return true;
    }
    if (
      node.kind === "item" &&
      node.labelNodes &&
      simpleTexNodesContainInlineMath(node.labelNodes)
    ) {
      return true;
    }
  }
  return false;
}
