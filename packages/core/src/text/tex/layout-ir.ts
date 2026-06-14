import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type { ResolvedTexFont, TexMetricProvider } from "./fonts/types.js";
import {
  computerModernTexMetricProvider,
} from "./fonts/computer-modern.js";
import {
  prepareTexLayoutParagraphsFromVList,
  type TexLayoutParagraphPlan,
  type TexLayoutParagraphPreparation,
} from "./layout-paragraph-preparation.js";
import type { TexLayoutIrOptions } from "./layout-options.js";
import {
  texInitialReportAlignment,
} from "./layout-state.js";
import type {
  SimpleTexBlockItem,
  SimpleTexParagraphBlock,
  TexParagraphAlignment,
} from "./ir.js";
import {
  lowerSimpleTexBlockItemsToVList,
  lowerSimpleTexBlocksToVList,
  prepareSimpleTexVList,
  type TexVListDocument,
} from "./vlist/index.js";

export type {
  TexLayoutParagraphBreakContext,
  TexLayoutParagraphLineLabel,
} from "./layout-paragraph-preparation.js";
export type {
  TexLayoutParagraphPlan,
} from "./layout-paragraph-preparation.js";

export interface SimpleTexLayoutDocumentPreparation {
  readonly kind: "simple-tex-layout-document-preparation";
  readonly rawVList: TexVListDocument;
  readonly materializedVList: TexVListDocument;
  readonly normalizedVList: TexVListDocument;
  readonly vlist: TexVListDocument;
  readonly reportAlignment: TexParagraphAlignment;
  readonly paragraphPreparation: TexLayoutParagraphPreparation;
}

export interface SimpleTexLayoutDocumentIr {
  readonly kind: "simple-tex-layout-document";
  readonly rawVList: TexVListDocument;
  readonly materializedVList: TexVListDocument;
  readonly normalizedVList: TexVListDocument;
  readonly vlist: TexVListDocument;
  readonly reportAlignment: TexParagraphAlignment;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly paragraphPlans: readonly TexLayoutParagraphPlan[];
}

export function prepareSimpleTexLayoutDocument(params: {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items?: readonly SimpleTexBlockItem[];
  readonly defaultAlignment: TexParagraphAlignment;
  readonly font: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly options: TexLayoutIrOptions;
}): SimpleTexLayoutDocumentPreparation {
  const metricProvider = params.metricProvider ?? computerModernTexMetricProvider;
  const baseVList = params.items
    ? lowerSimpleTexBlockItemsToVList(params.items)
    : lowerSimpleTexBlocksToVList(params.blocks);
  const preparedVList = prepareSimpleTexVList(baseVList, params.font);
  const paragraphPreparation = prepareTexLayoutParagraphsFromVList({
    vlist: preparedVList.normalized,
    defaultAlignment: params.defaultAlignment,
    font: params.font,
    metricProvider,
    options: params.options,
  });
  return {
    kind: "simple-tex-layout-document-preparation",
    rawVList: baseVList,
    materializedVList: preparedVList.materialized,
    normalizedVList: preparedVList.normalized,
    vlist: paragraphPreparation.vlist,
    reportAlignment: texInitialReportAlignment(
      params.blocks[0],
      params.defaultAlignment,
      params.options
    ),
    paragraphPreparation,
  };
}

export function createSimpleTexLayoutDocumentIr(params: {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items?: readonly SimpleTexBlockItem[];
  readonly defaultAlignment: TexParagraphAlignment;
  readonly font: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly options: TexLayoutIrOptions;
}): SimpleTexLayoutDocumentIr {
  const preparation = prepareSimpleTexLayoutDocument(params);
  return createSimpleTexLayoutDocumentIrFromPreparation(preparation);
}

export function createSimpleTexLayoutDocumentIrFromPreparation(
  preparation: SimpleTexLayoutDocumentPreparation
): SimpleTexLayoutDocumentIr {
  return {
    kind: "simple-tex-layout-document",
    rawVList: preparation.rawVList,
    materializedVList: preparation.materializedVList,
    normalizedVList: preparation.normalizedVList,
    vlist: preparation.paragraphPreparation.vlist,
    reportAlignment: preparation.reportAlignment,
    layoutMode: preparation.paragraphPreparation.layoutMode,
    paragraphPlans: preparation.paragraphPreparation.paragraphPlans,
  };
}
