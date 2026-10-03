import type { TexTabularLayoutProfile } from "./tabular/types.js";
import type { Hyphenator } from "../knuth-plass/paragraph/hyphenate.js";
import type { ParagraphLayoutReport } from "../knuth-plass/paragraph/report.js";
import type { TextSourceMap } from "../source-map.js";
import type { SourceCoordinateSpace } from "../source-coordinates.js";
import type { DocumentGraphicsResolver } from "../../graphics/types.js";
import type { NodeTextColorResolver } from "../types.js";
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
import type {
  TexDisplayMathLayoutProfile,
  TexListLayoutProfile,
  TexLayoutIrOptions,
} from "./layout-options.js";
import {
  analyzeSimpleTexParagraph,
  type SimpleTexListTopology,
  type SimpleTexMathNode,
  type SimpleTexNode,
  type TexParagraphAlignment,
  type TexSpaceGlueProfile,
} from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import {
  remapParagraphLayoutReportSourceMap,
  remapSimpleTexListStructureSourceMap,
  remapTexVListLayoutSourceMap,
} from "./source-map-report.js";
import {
  breakSimpleTexLayoutDocumentParagraphs,
  createSimpleTexLayoutScopeIrFromPreparation,
  layoutTexVListFromBrokenParagraphs,
  prepareSimpleTexLayoutScope,
  type TexVListLayout,
} from "./vlist/index.js";
import { texLength } from "./coordinates.js";
import {
  texDimensionContextForFont,
  type TexDimensionContext,
} from "./dimensions.js";

export interface TexParagraphLayoutOptions {
  readonly namedFontSizes?: TexLayoutIrOptions["namedFontSizes"];
  readonly paragraphId?: string;
  readonly width: number;
  /**
   * Ambient document/minipage dimension registers. Omitted registers default
   * to the paragraph width; font-relative units come from the active font.
   */
  readonly dimensionContext?: Partial<TexDimensionContext> | null;
  /** Optional enclosing vertical-box target used to set VList glue. */
  readonly height?: number;
  readonly alignment?: TexParagraphAlignment;
  readonly font?: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly tolerance?: number;
  readonly pretolerance?: number;
  readonly parindent?: number;
  readonly rightskipStretch?: number;
  /** Absolute `\baselineskip` in TeX points. */
  readonly baselineSkip?: number;
  /** Depth of a preceding box outside this source-backed layout fragment. */
  readonly initialPreviousDepth?: number;
  readonly listProfile?: TexListLayoutProfile;
  readonly displayMathProfile?: TexDisplayMathLayoutProfile;
  readonly tabularProfile?: TexTabularLayoutProfile;
  readonly tikzTextWidthNode?: boolean;
  readonly spaceGlueProfile?: TexSpaceGlueProfile;
  readonly fallbackPolicy?: "whole-node" | "placeholder";
  readonly hyphenator?: Hyphenator | null;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: DocumentGraphicsResolver;
  readonly colorResolver?: NodeTextColorResolver;
  readonly textFontProfile?: TexTextFontProfile;
  readonly sourceMap?: TextSourceMap;
}

export interface TexParagraphLayoutResult<Space extends SourceCoordinateSpace = SourceCoordinateSpace> {
  readonly supported: boolean;
  readonly report: ParagraphLayoutReport<Space> | null;
  readonly vlistLayout?: TexVListLayout<Space>;
  readonly fallbackReason: string | null;
  readonly shapedRuns: ReadonlyMap<number, ShapedTexTextRun>;
  readonly errors: readonly string[];
  /**
   * List-environment topology the chunk scan retained (design/
   * beamer-canvas-editing.md, "Item topology comes from the text engine"),
   * in the same coordinate space as the report. Absent when the chunk has
   * no lists or the scan aborted.
   */
  readonly listStructure?: readonly SimpleTexListTopology[];
}

export function layoutSimpleTexParagraph(
  text: string,
  options: TexParagraphLayoutOptions & { readonly sourceMap: TextSourceMap }
): TexParagraphLayoutResult<"document">;
export function layoutSimpleTexParagraph(
  text: string,
  options: TexParagraphLayoutOptions & { readonly sourceMap?: undefined }
): TexParagraphLayoutResult<"layout">;
export function layoutSimpleTexParagraph(
  text: string,
  options: TexParagraphLayoutOptions
): TexParagraphLayoutResult {
  const textFontProfile = options.textFontProfile ?? defaultTexTextFontProfile;
  const metricProvider = options.metricProvider ?? textFontProfile.metricProvider ?? computerModernTexMetricProvider;
  const defaultAtPt = metricProvider.resolveFont().atPt;
  const font = options.font ?? textFontProfile.resolveTextFont(
    textFontProfile.defaultFontState,
    defaultAtPt,
    metricProvider
  );
  const analysis = analyzeSimpleTexParagraph(
    text,
    options.width,
    options.colorResolver?.resolve.bind(options.colorResolver),
    {
      listLeftMarginEmByDepth: options.listProfile?.leftMarginEmByDepth,
      bibliographyMargins: options.listProfile?.bibliographyMargins,
      colorResolverCacheKey: options.colorResolver?.cacheKey,
      fontSizePt: font.atPt,
      baselineSkipPt: options.baselineSkip,
      namedFontSizes: options.namedFontSizes,
    }
  );
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

  const defaultWidth = options.dimensionContext === null
    ? texLength(0)
    : texLength(options.width);
  const dimensionContext = texDimensionContextForFont(
    {
      linewidth: defaultWidth,
      textwidth: defaultWidth,
      columnwidth: defaultWidth,
      paperwidth: defaultWidth,
      em: texLength(font.atPt),
      ex: texLength(font.atPt * 0.43),
      ...options.dimensionContext,
    },
    font
  );
  const {
    width: inputWidth,
    height: inputHeight,
    parindent: inputParindent,
    rightskipStretch: inputRightskipStretch,
    baselineSkip: inputBaselineSkip,
    initialPreviousDepth: inputInitialPreviousDepth,
    ...otherOptions
  } = options;
  const layoutOptions = {
    ...otherOptions,
    width: texLength(inputWidth),
    dimensionContext,
    ...(inputHeight !== undefined
      ? { height: texLength(inputHeight) }
      : {}),
    ...(inputParindent !== undefined
      ? { parindent: texLength(inputParindent) }
      : {}),
    ...(inputRightskipStretch !== undefined
      ? { rightskipStretch: texLength(inputRightskipStretch) }
      : {}),
    ...(inputBaselineSkip !== undefined
      ? { baselineSkip: texLength(inputBaselineSkip) }
      : {}),
    ...(inputInitialPreviousDepth !== undefined
      ? { initialPreviousDepth: texLength(inputInitialPreviousDepth) }
      : {}),
    font,
    metricProvider,
  };
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
  // Display equations and other vertical material need no prose paragraph.
  // Their boxes still pass through the same vlist layout and SVG renderer.
  if (blocks.length === 0 && (analysis.ir?.items.length ?? 0) === 0) {
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
    width: texLength(options.width),
    height: layoutOptions.height,
    alignment: layoutIr.reportAlignment,
    layoutMode: layoutIr.layoutMode,
    font,
    metricProvider,
    entries: paragraphBreaks.entries,
    initialErrors: errors,
    baselineSkip: layoutOptions.baselineSkip,
    initialPreviousDepth: layoutOptions.initialPreviousDepth,
    displayMathProfile: layoutOptions.displayMathProfile,
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
  const listStructure = remapSimpleTexListStructureSourceMap(
    analysis.ir?.listStructure,
    options.sourceMap
  );
  return {
    supported: true,
    report,
    vlistLayout,
    fallbackReason: null,
    shapedRuns: reportAssembly.combined.shapedRuns,
    errors: reportAssembly.combined.errors,
    ...(listStructure ? { listStructure } : {}),
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
