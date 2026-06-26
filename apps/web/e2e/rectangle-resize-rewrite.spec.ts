import { expect, test } from "@playwright/test";
import { gotoApp, resetStorageBeforeNavigation } from "./helpers";
import { getSharedEditAnalysisSession, getSharedEditAnalysisView, resetSharedEditAnalysisManager } from "../../../packages/app/src/edit-analysis-manager";
import { worldPoint } from "../../../packages/core/src/coords/points";
import { pt } from "../../../packages/core/src/coords/scalars";
import { createEditAnalysisSession } from "../../../packages/core/src/edit/analysis";
import { applyEditAction } from "../../../packages/core/src/edit/actions";
import { PT_PER_CM } from "../../../packages/core/src/edit/format";
import { parseTikz } from "../../../packages/core/src/parser/index";

test.describe("rectangle resize source rewrite", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorageBeforeNavigation(page);
  });

  test("does not corrupt the rectangle target coordinate when analysis spans lag behind source text", async ({
    browserName,
    page
  }) => {
    test.skip(browserName !== "chromium", "The reported corruption appears in Chrome.");

    await gotoApp(page);

    const staleSource = "\\begin{tikzpicture}\n  \\draw (0,0) rectangle (1.34,1.1);\n\\end{tikzpicture}";
    const currentSource = "\\begin{tikzpicture}\n  \\draw (0,0) rectangle (1.35,1.09);\n\\end{tikzpicture}";

    const parsed = parseTikz(staleSource, {
      recover: true,
      includeContextDefinitions: true
    });
    resetSharedEditAnalysisManager();
    const analysisView = getSharedEditAnalysisView({
      documentId: "e2e-rectangle-resize",
      sourceRevision: 1,
      source: currentSource,
      activeFigureId: parsed.activeFigureId,
      snapshot: {
        source: staleSource,
        revision: 1,
        parseResult: parsed
      }
    });
    const session = getSharedEditAnalysisSession();
    const result = applyEditAction(
      currentSource,
      [],
      {
        kind: "resizeElement",
        elementId: "path:0",
        role: "top-right",
        newWorld: worldPoint(
          pt(1.35 * PT_PER_CM),
          pt(1.09 * PT_PER_CM)
        )
      },
      {
        parseOptions: {
          activeFigureId: parsed.activeFigureId,
          analysisView,
          analysisSession: session ?? createEditAnalysisSession(),
          propertyWriteMode: "drag-frame"
        }
      }
    );

    const nextSource =
      result.kind === "success" || result.kind === "partial"
        ? result.newSource
        : currentSource;

    expect(nextSource).toBe(currentSource);
  });
});
