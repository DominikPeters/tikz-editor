import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const fixture = new URL("./fixtures/beamer/scoped-flow/scoped-flow.tex", import.meta.url);
const source = readFileSync(fixture, "utf8");
const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/scoped-flow/scoped-flow.oracle.json", import.meta.url), "utf8")) as {
  sourceSha256: string;
  pages: Array<{ frameIndex: number; step: number; trace: OracleBeamerPageTrace }>;
};

describe("Beamer declarations and scoped size/list flow against LuaLaTeX", () => {
  it("pins the source used for the checked-in shipout trace", () => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
  });
  for (const { frameIndex, step, trace } of oracle.pages) {
    it(`matches exact glyphs, markers, rules and packing: frame ${frameIndex + 1}, step ${step}`, async () => {
      const result = await prepareBeamerDocument(source).renderFrame({ frameIndex, step });
      expect(result.diagnostics).toEqual([]);
      expect(result.svg.svg).not.toContain("data-tex-literal=");
      const { summary } = compareBeamerPageTraces(buildNativeBeamerPageTrace(result, computerModernTexMetricProvider), trace);
      expect(summary).toMatchObject({ unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
        unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, excludedOracleTextLines: 0,
        glyphCodeMatch: true, fontMatch: true, transformMatch: true });
      expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.001);
      expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.001);
      expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.001);
    });
  }
  it("retains selected overprint text ownership and restores normal size outside a small environment", async () => {
    const document = prepareBeamerDocument(source);
    const overprint = await document.renderFrame({ frameIndex: 2, step: 2 });
    const start = source.indexOf("Second line.");
    expect(overprint.svg.svg).toContain(`data-source-start="${start}"`);
    expect(overprint.svg.svg).not.toContain(`data-source-start="${source.indexOf("Gamma.")}"`);
    const small = await document.renderFrame({ frameIndex: 3, step: 1 });
    const lines = buildNativeBeamerPageTrace(small, computerModernTexMetricProvider).lines;
    expect(lines.find(line => line.text === "Beta")!.glyphs.every(glyph => glyph.fontSize === 10)).toBe(true);
    expect(lines.find(line => line.text === "Deltaparagraph.")!.glyphs.every(glyph => glyph.fontSize === 10.95)).toBe(true);
  });
  it("matches normalsize sphere marker boxes and paint inside a small nested list", async () => {
    const markerSource = readFileSync(new URL("./fixtures/beamer/scoped-flow/ball-markers.tex", import.meta.url), "utf8");
    const markerOracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/scoped-flow/ball-markers.oracle.json", import.meta.url), "utf8")) as {
      sourceSha256: string; trace: OracleBeamerPageTrace;
    };
    expect(createHash("sha256").update(markerSource).digest("hex")).toBe(markerOracle.sourceSha256);
    const result = await prepareBeamerDocument(markerSource).renderFrame();
    const { summary } = compareBeamerPageTraces(buildNativeBeamerPageTrace(result, computerModernTexMetricProvider), markerOracle.trace);
    expect(summary).toMatchObject({ unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
      unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, glyphCodeMatch: true, fontMatch: true });
    expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.001);
    expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.001);
    expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.001);
    expect(result.svg.svg).toContain('data-beamer-list-marker="ball"');
    expect(result.layout.paragraphs.some(paragraph => paragraph.role === "footline")).toBe(false);
  });
});
