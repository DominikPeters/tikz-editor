import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/fixed-flow-fidelity/flow.oracle.json", import.meta.url), "utf8")) as {
  sourceFiles: Record<string, string>;
  pages: Array<{ id: string; file: string; frameIndex: number; step: number; trace: OracleBeamerPageTrace }>;
};

describe("Beamer column glue, scoped sizes and stock block flow against LuaLaTeX", () => {
  for (const page of oracle.pages) {
    it(`matches exact paint and glyph geometry: ${page.id}`, async () => {
      const source = readFileSync(new URL(`./fixtures/beamer/corpus-followups/${page.file}`, import.meta.url), "utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceFiles[page.file]);
      const result = await prepareBeamerDocument(source).renderFrame(page);
      expect(result.diagnostics).toEqual([]);
      const { summary } = compareBeamerPageTraces(buildNativeBeamerPageTrace(result, computerModernTexMetricProvider), page.trace);
      expect(summary).toMatchObject({ unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
        unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, excludedOracleTextLines: 0,
        glyphCodeMatch: true, fontMatch: true, transformMatch: true });
      // The renderer comparison gate uses .02pt, including TeX's fixed-point
      // dimension rounding when columns multiply \textwidth.
      expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.02);
      expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.01);
      expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.01);
    });
  }
});
