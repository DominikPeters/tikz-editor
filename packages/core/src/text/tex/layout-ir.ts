import type { KnuthPlassLayoutMode } from "../knuth-plass/index.js";
import type { ResolvedTexFont, TexMetricProvider } from "./fonts/types.js";
import {
  computerModernTexMetricProvider,
} from "./fonts/computer-modern.js";
import {
  buildTexLayoutParagraphsFromPreparation,
  prepareTexLayoutParagraphsFromVList,
  type TexLayoutParagraphIr,
  type TexLayoutParagraphPreparation,
} from "./layout-paragraphs.js";
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

export type { TexLayoutParagraphIr } from "./layout-paragraphs.js";

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
  readonly paragraphs: readonly TexLayoutParagraphIr[];
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
  const metricProvider = params.metricProvider ?? computerModernTexMetricProvider;
  const preparation = prepareSimpleTexLayoutDocument(params);
  return createSimpleTexLayoutDocumentIrFromPreparation(
    preparation,
    { font: params.font, metricProvider }
  );
}

export function createSimpleTexLayoutDocumentIrFromPreparation(
  preparation: SimpleTexLayoutDocumentPreparation,
  params: {
    readonly font: ResolvedTexFont;
    readonly metricProvider: TexMetricProvider;
  }
): SimpleTexLayoutDocumentIr {
  const paragraphBuild = buildTexLayoutParagraphsFromPreparation(
    preparation.paragraphPreparation,
    params
  );

  return {
    kind: "simple-tex-layout-document",
    rawVList: preparation.rawVList,
    materializedVList: preparation.materializedVList,
    normalizedVList: preparation.normalizedVList,
    vlist: paragraphBuild.vlist,
    reportAlignment: preparation.reportAlignment,
    layoutMode: paragraphBuild.layoutMode,
    paragraphs: paragraphBuild.paragraphs,
  };
}
