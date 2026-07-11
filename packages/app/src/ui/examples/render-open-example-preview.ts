import type { TikzOpenExample } from "./open-example-catalog";
import type { renderTikzToSvgAsync as renderTikzToSvgAsyncType } from "@tikz-editor/core/render/index";

export type OpenExamplePreview = {
  exampleId: string;
  svg: string | null;
  warningCount: number;
  errorCount: number;
  errorMessage: string | null;
};

type RenderTikzToSvgAsync = typeof renderTikzToSvgAsyncType;

async function renderOpenExamplePreviewWithRenderer(
  example: TikzOpenExample,
  renderTikzToSvgAsync: RenderTikzToSvgAsync
): Promise<OpenExamplePreview> {
  try {
    const result = await renderTikzToSvgAsync(example.source, {
      parse: { recover: true },
      svg: { padding: 18 }
    });
    const parseErrors = result.parse.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const semanticErrors = result.semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const renderErrors = result.renderDiagnostics.filter((diagnostic) => diagnostic.severity === "error");
    const parseWarnings = result.parse.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    const semanticWarnings = result.semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
    const renderWarnings = result.renderDiagnostics.filter((diagnostic) => diagnostic.severity === "warning");

    const errorCount = parseErrors.length + semanticErrors.length + renderErrors.length;
    const warningCount = parseWarnings.length + semanticWarnings.length + renderWarnings.length;
    const errorMessage =
      parseErrors[0]?.message ??
      semanticErrors[0]?.message ??
      renderErrors[0]?.message ??
      null;

    return {
      exampleId: example.id,
      svg: result.svg.svg,
      warningCount,
      errorCount,
      errorMessage
    };
  } catch (error) {
    return {
      exampleId: example.id,
      svg: null,
      warningCount: 0,
      errorCount: 1,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function renderOpenExamplePreview(example: TikzOpenExample): Promise<OpenExamplePreview> {
  const { renderTikzToSvgAsync } = await import("@tikz-editor/core/render/index");
  return renderOpenExamplePreviewWithRenderer(example, renderTikzToSvgAsync);
}

export async function renderOpenExamplePreviews(
  examples: readonly TikzOpenExample[]
): Promise<OpenExamplePreview[]> {
  const { renderTikzToSvgAsync } = await import("@tikz-editor/core/render/index");
  return Promise.all(
    examples.map((example) => renderOpenExamplePreviewWithRenderer(example, renderTikzToSvgAsync))
  );
}
