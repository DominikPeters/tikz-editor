import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OPEN_EXAMPLE_CATALOG } from "../../packages/app/src/ui/examples/open-example-catalog.js";
import { GENERATED_OPEN_EXAMPLE_PREVIEWS } from "../../packages/app/src/ui/examples/generated-open-example-previews.js";
import { renderOpenExamplePreviews } from "../../packages/app/src/ui/examples/render-open-example-preview.js";

describe("open example preview rendering", () => {
  it("generated preview map covers all examples", () => {
    const generatedIds = Object.keys(GENERATED_OPEN_EXAMPLE_PREVIEWS).sort();
    const catalogIds = OPEN_EXAMPLE_CATALOG.map((example) => example.id).sort();
    expect(generatedIds).toEqual(catalogIds);
  });

  it("generated previews stay in sync with live rendering output", async () => {
    const freshPreviews = await renderOpenExamplePreviews(OPEN_EXAMPLE_CATALOG);
    for (const fresh of freshPreviews) {
      const generated = GENERATED_OPEN_EXAMPLE_PREVIEWS[fresh.exampleId];
      expect(generated, `missing generated preview for ${fresh.exampleId}`).toBeDefined();
      if (!generated) {
        continue;
      }
      expect(generated.errorCount, `${fresh.exampleId}: errorCount mismatch`).toBe(fresh.errorCount);
      expect(generated.warningCount, `${fresh.exampleId}: warningCount mismatch`).toBe(fresh.warningCount);
      expect(generated.errorMessage, `${fresh.exampleId}: errorMessage mismatch`).toBe(fresh.errorMessage);
      expect(hashText(generated.svg), `${fresh.exampleId}: svg hash mismatch`).toBe(hashText(fresh.svg));
    }
  }, 45000);
});

function hashText(value: string | null): string {
  return createHash("sha256").update(value ?? "").digest("hex");
}
