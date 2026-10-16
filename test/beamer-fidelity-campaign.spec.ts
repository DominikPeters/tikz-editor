import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { priorityFidelityFailures } from "../scripts/lib/beamer-priority-contracts.mjs";

const root = new URL("./fixtures/beamer/fidelity-campaign/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("cases.json", root), "utf8")) as { fidelity: { id: string; file: string; frame: number; pages: number }[] };

describe("Beamer fidelity campaign: independent TeX regressions", () => {
  for (const fixture of manifest.fidelity) {
    it(fixture.id, async () => {
      const source = readFileSync(new URL(fixture.file, root), "utf8");
      const oracle = JSON.parse(readFileSync(new URL(fixture.file.replace(/\.tex$/u, ".oracle.json"), root), "utf8")) as {
        sourceSha256: string; pages: OracleBeamerPageTrace[];
      };
      expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
      const pages = await prepareBeamerDocument(source).renderFramePages({ frameIndex: fixture.frame - 1 });
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
          expect(new Set(oracle.pages[index]!.glyphs.map(glyph => glyph.fontName))).toEqual(new Set(faces));
        }
        expect(priorityFidelityFailures({ input: { overlayStepCount: fixture.pages }, oracle: { page: { pageCount: oracle.pages.length } }, structural: comparison }, { pages: fixture.pages })).toEqual([]);
      }
    });
  }
});
