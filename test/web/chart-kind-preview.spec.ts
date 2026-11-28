import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CHART_KINDS } from "../../packages/core/src/edit/pgfplots/chart-kinds.js";
import { GENERATED_CHART_KIND_PREVIEWS } from "../../packages/app/src/ui/examples/generated-chart-kind-previews.js";
import { renderChartKindPreviews } from "../../packages/app/src/ui/examples/render-chart-kind-preview.js";

const hash = (value: string | null) => createHash("sha256").update(value ?? "").digest("hex");

describe("chart gallery thumbnails", () => {
  it("cover every chart kind, render without diagnostics and match live rendering", async () => {
    expect(Object.keys(GENERATED_CHART_KIND_PREVIEWS).sort()).toEqual(CHART_KINDS.map((kind) => kind.id).sort());
    for (const fresh of await renderChartKindPreviews()) {
      const generated = GENERATED_CHART_KIND_PREVIEWS[fresh.exampleId];
      expect([fresh.errorCount, fresh.warningCount], fresh.exampleId).toEqual([0, 0]);
      expect(hash(generated?.svg ?? null), `${fresh.exampleId}: regenerate with npm run generate:example-previews in apps/web`).toBe(hash(fresh.svg));
    }
  }, 45000);
});
