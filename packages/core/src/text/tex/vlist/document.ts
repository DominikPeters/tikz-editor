import type { KnuthPlassLayoutMode } from "../../knuth-plass/index.js";
import {
  computerModernTexMetricProvider,
} from "../fonts/computer-modern.js";
import type { ResolvedTexFont, TexMetricProvider } from "../fonts/types.js";
import type {
  SimpleTexBlockItem,
  SimpleTexParagraphBlock,
  TexParagraphAlignment,
} from "../ir.js";
import type { TexLayoutIrOptions } from "../layout-options.js";
import {
  texInitialReportAlignment,
} from "../layout-state.js";
import {
  lowerSimpleTexBlockItemsToVList,
  lowerSimpleTexBlocksToVList,
} from "./lower-simple.js";
import {
  prepareTexLayoutParagraphsFromVList,
  type TexLayoutParagraphPlan,
  type TexLayoutParagraphPreparation,
} from "./paragraph-plans.js";
import {
  prepareSimpleTexVList,
} from "./prepare-simple.js";
import type { TexVListDocument } from "./types.js";

export interface SimpleTexLayoutScopePreparation {
  readonly kind: "simple-tex-layout-document-preparation";
  readonly rawVList: TexVListDocument;
  readonly materializedVList: TexVListDocument;
  readonly normalizedVList: TexVListDocument;
  readonly vlist: TexVListDocument;
  readonly reportAlignment: TexParagraphAlignment;
  readonly paragraphPreparation: TexLayoutParagraphPreparation;
}

export interface SimpleTexLayoutScopeIr {
  readonly kind: "simple-tex-layout-document";
  readonly rawVList: TexVListDocument;
  readonly materializedVList: TexVListDocument;
  readonly normalizedVList: TexVListDocument;
  readonly vlist: TexVListDocument;
  readonly reportAlignment: TexParagraphAlignment;
  readonly layoutMode: KnuthPlassLayoutMode;
  readonly paragraphPlans: readonly TexLayoutParagraphPlan[];
}

export interface SimpleTexLayoutScopePreparationParams {
  readonly blocks: readonly SimpleTexParagraphBlock[];
  readonly items?: readonly SimpleTexBlockItem[];
  readonly defaultAlignment: TexParagraphAlignment;
  readonly font: ResolvedTexFont;
  readonly metricProvider?: TexMetricProvider;
  readonly options: TexLayoutIrOptions;
}

export type SimpleTexLayoutDocumentPreparation = SimpleTexLayoutScopePreparation;
export type SimpleTexLayoutDocumentIr = SimpleTexLayoutScopeIr;
export type SimpleTexLayoutDocumentPreparationParams = SimpleTexLayoutScopePreparationParams;

export function prepareSimpleTexLayoutScope(
  params: SimpleTexLayoutScopePreparationParams
): SimpleTexLayoutScopePreparation {
  const metricProvider = params.metricProvider ?? computerModernTexMetricProvider;
  const baseVList = params.items
    ? lowerSimpleTexBlockItemsToVList(params.items, {
        font: params.font,
        mathBoxProvider: params.options.mathBoxProvider,
        graphicsResolver: params.options.graphicsResolver,
        width: params.options.width,
        tikzTextWidthNode: params.options.tikzTextWidthNode,
      })
    : lowerSimpleTexBlocksToVList(params.blocks, {
        font: params.font,
        mathBoxProvider: params.options.mathBoxProvider,
        graphicsResolver: params.options.graphicsResolver,
        width: params.options.width,
        tikzTextWidthNode: params.options.tikzTextWidthNode,
      });
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

export function prepareSimpleTexLayoutDocument(
  params: SimpleTexLayoutDocumentPreparationParams
): SimpleTexLayoutDocumentPreparation {
  return prepareSimpleTexLayoutScope(params);
}

export function createSimpleTexLayoutScopeIr(
  params: SimpleTexLayoutScopePreparationParams
): SimpleTexLayoutScopeIr {
  const preparation = prepareSimpleTexLayoutScope(params);
  return createSimpleTexLayoutScopeIrFromPreparation(preparation);
}

export function createSimpleTexLayoutDocumentIr(
  params: SimpleTexLayoutDocumentPreparationParams
): SimpleTexLayoutDocumentIr {
  return createSimpleTexLayoutScopeIr(params);
}

export function createSimpleTexLayoutScopeIrFromPreparation(
  preparation: SimpleTexLayoutScopePreparation
): SimpleTexLayoutScopeIr {
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

export function createSimpleTexLayoutDocumentIrFromPreparation(
  preparation: SimpleTexLayoutDocumentPreparation
): SimpleTexLayoutDocumentIr {
  return createSimpleTexLayoutScopeIrFromPreparation(preparation);
}
