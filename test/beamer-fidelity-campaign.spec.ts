import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusGraphicsResolver } from "../scripts/lib/beamer-corpus.mjs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { priorityFidelityFailures } from "../scripts/lib/beamer-priority-contracts.mjs";

for (const campaign of ["fidelity-campaign", "fidelity-campaign-wave2", "fidelity-campaign-wave3", "fidelity-campaign-wave4", "fidelity-campaign-wave5", "fidelity-campaign-wave6", "fuzz-findings-v2", "fuzz-findings-v3", "fuzz-findings-v4", "fuzz-findings-v5", "fuzz-findings-v6", "fuzz-findings-v7", "fuzz-findings-v8", "fuzz-findings-v9", "fuzz-findings-v10", "fuzz-findings-v11", "fuzz-findings-v12", "fuzz-findings-v13", "fuzz-findings-v14", "fuzz-findings-v15", "fuzz-findings-v16", "fuzz-findings-v17", "fuzz-findings-v18", "fuzz-findings-v19", "fuzz-findings-v20", "fuzz-findings-v21", "fuzz-findings-v22", "fuzz-findings-v23", "fuzz-findings-v24", "fuzz-findings-v25", "fuzz-findings-v26", "fuzz-findings-v27", "fuzz-findings-v28", "fuzz-findings-v29", "fuzz-findings-v30", "fuzz-findings-v31", "fuzz-findings-v32", "fuzz-findings-v33", "fuzz-findings-v34", "fuzz-findings-v35", "fuzz-findings-v36", "fuzz-findings-v37", "fuzz-original-seed-20261106"]) {
  const root = new URL(`./fixtures/beamer/${campaign}/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("cases.json", root), "utf8")) as { fidelity: { id: string; file: string; frame: number; pages: number }[] };

  describe(`${campaign}: independent TeX regressions`, () => {
    for (const fixture of manifest.fidelity) {
      it(fixture.id, async () => {
        const source = readFileSync(new URL(fixture.file, root), "utf8");
        const oracle = JSON.parse(readFileSync(new URL(fixture.file.replace(/\.tex$/u, ".oracle.json"), root), "utf8")) as {
          sourceSha256: string; pages: OracleBeamerPageTrace[];
        };
        expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
        const temporary = mkdtempSync(join(tmpdir(), "beamer-campaign-"));
        try {
          const graphics = corpusGraphicsResolver(source, fileURLToPath(new URL(fixture.file, root)), temporary);
          const pages = await prepareBeamerDocument(source).renderFramePages({ frameIndex: fixture.frame - 1, graphicsResolver: graphics.resolver });
          expect(pages.pageCount).toBe(fixture.pages);
          expect(oracle.pages).toHaveLength(fixture.pages);
          for (const [index, page] of pages.pages.entries()) {
            expect(page.diagnostics).toEqual([]);
            expect(page.layout.items.some(item => item.kind === "unsupported")).toBe(false);
            expect(page.svg.svg).not.toContain("data-tex-literal=");
            const native = buildNativeBeamerPageTrace(page, computerModernTexMetricProvider);
            const comparison = compareBeamerPageTraces(native, oracle.pages[index]);
            if (fixture.id === "metropolis-fira-styles") {
              const faces = ["firasans-light", "firasans-lightitalic", "firasans-regular", "firasans-italic"];
              expect(new Set(native.glyphs.map(glyph => glyph.fontName))).toEqual(new Set(faces));
              expect(new Set(oracle.pages[index].glyphs.map(glyph => glyph.fontName))).toEqual(new Set(faces));
            }
            expect(priorityFidelityFailures({ input: { overlayStepCount: fixture.pages }, oracle: { page: { pageCount: oracle.pages.length } }, structural: comparison }, { pages: fixture.pages })).toEqual([]);
          }
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      });
    }
  });
}
