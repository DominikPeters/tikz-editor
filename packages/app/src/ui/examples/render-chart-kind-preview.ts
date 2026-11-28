import { CHART_KINDS, chartKindDocument } from "@tikz-editor/core/edit/pgfplots/chart-kinds";
import { renderOpenExamplePreviews, type OpenExamplePreview } from "./render-open-example-preview";

/**
 * Thumbnails for the toolbar's chart gallery: each chart kind's template
 * rendered by the editor itself, as the Open Example previews are
 * (apps/web/scripts/generate-chart-kind-previews.ts writes them out).
 */
export async function renderChartKindPreviews(): Promise<OpenExamplePreview[]> {
  return renderOpenExamplePreviews(CHART_KINDS.map((kind) => ({
    id: kind.id,
    title: kind.label,
    description: "",
    source: chartKindDocument(kind.id),
    featureLabels: []
  })));
}
