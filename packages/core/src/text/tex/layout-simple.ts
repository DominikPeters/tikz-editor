import type { Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import type { ParagraphLayoutReport } from "../knuth-plass/paragraph/report.js";
import { computerModernTexMetricProvider } from "./fonts/computer-modern.js";
import type {
  ResolvedTexFont,
  ShapedTexTextRun,
  TexMetricProvider,
} from "./fonts/types.js";
import { analyzeSimpleTexParagraph, type TexParagraphAlignment } from "./ir.js";
import {
  createSimpleTexLayoutDocumentIrFromPreparation,
  prepareSimpleTexLayoutDocument,
} from "./layout-ir.js";
import {
  combineTexBrokenLayoutParagraphs,
  type TexBrokenLayoutParagraph,
} from "./layout-report-aggregate.js";
import { breakTexParagraphRuns } from "./paragraph-break.js";
import { createTexParagraphRunAdapter } from "./paragraph-runs.js";
import {
  layoutTexVListFromCombinedParagraphReport,
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

  const runAdapter = createTexParagraphRunAdapter(font, metricProvider);
  const layoutPreparation = prepareSimpleTexLayoutDocument({
    blocks,
    items: analysis.ir?.items,
    defaultAlignment,
    font,
    metricProvider,
    options: layoutOptions,
  });
  const layoutIr = createSimpleTexLayoutDocumentIrFromPreparation(
    layoutPreparation,
    { font, metricProvider }
  );
  const brokenEntries: TexBrokenLayoutParagraph[] = [];
  const errors: string[] = usePlaceholderFallback && fallbackReason
    ? [fallbackReason]
    : [];

  for (const paragraph of layoutIr.paragraphs) {
    const { runs, shapedRuns: blockShapedRuns } = runAdapter.layoutItemsToRuns(paragraph.items);
    if (!runs.some((run) => run.kind === "text")) {
      continue;
    }

    const broken = breakTexParagraphRuns({
      runs,
      shapedRuns: blockShapedRuns,
      measurement: runAdapter.measurement,
      options: layoutOptions,
      alignment: paragraph.alignment,
      alignmentProfile: paragraph.alignmentProfile,
      inheritedAlignment: paragraph.inheritedAlignment,
      inheritedAlignmentProfile: paragraph.inheritedAlignmentProfile,
      noIndent: paragraph.noIndent,
      firstLineIndentWidth: paragraph.firstLineIndentWidth,
      leftMarginWidth: paragraph.leftMarginWidth,
      rightMarginWidth: paragraph.rightMarginWidth,
      quoteContextActive: paragraph.quoteDepth > 0,
      listContextActive: paragraph.listContext !== undefined,
    });
    if (!broken) {
      return {
        supported: false,
        report: null,
        fallbackReason: "TeX paragraph breaker failed: no solution",
        shapedRuns: combineTexBrokenLayoutParagraphs({
          entries: brokenEntries,
          initialErrors: errors,
        }).shapedRuns,
        errors,
      };
    }
    brokenEntries.push({ paragraph, broken });
  }

  const combined = combineTexBrokenLayoutParagraphs({
    entries: brokenEntries,
    initialErrors: errors,
  });
  if (combined.runs.length === 0 || combined.lines.length === 0) {
    const reason = "Paragraph contains no text runs.";
    return {
      supported: false,
      report: null,
      fallbackReason: reason,
      shapedRuns: combined.shapedRuns,
      errors: [...combined.errors, reason],
    };
  }

  const reportLayout = layoutTexVListFromCombinedParagraphReport(layoutPreparation.vlist, {
    paragraphId,
    width: options.width,
    alignment: layoutIr.reportAlignment,
    layoutMode: layoutIr.layoutMode,
    font,
    metricProvider,
    combined,
  });

  return {
    supported: true,
    report: reportLayout.report,
    vlistLayout: reportLayout.layout,
    fallbackReason: null,
    shapedRuns: combined.shapedRuns,
    errors: combined.errors,
  };
}
