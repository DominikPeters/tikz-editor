import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, renderBeamerFramePages } from "../packages/core/src/beamer/render.js";
import { scanBeamerDocument } from "../packages/core/src/beamer/scan.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const fixtures = new URL("./fixtures/beamer/continuations-fidelity/", import.meta.url);

describe("Beamer continuation pages against full-document LuaLaTeX", () => {
  for (const name of ["forced", "automatic", "top", "bottom", "plain", "paragraphs", "nested-lists", "horizontal-break", "final-footnotes", "blocks", "display", "from-second", "single-frame-check", "unnumbered", "counters"]) {
    it(`matches page correspondence, glyphs, fonts and rules: ${name}`, async () => {
      const source = readFileSync(new URL(`${name}.tex`, fixtures), "utf8");
      const oracle = JSON.parse(readFileSync(new URL(`${name}.oracle.json`, fixtures), "utf8")) as {
        sourceSha256: string; pages: Array<{ frameIndex: number; continuation?: number; step: number; trace: OracleBeamerPageTrace }>;
      };
      expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
      const prepared = prepareBeamerDocument(source);
      for (const frameIndex of new Set(oracle.pages.map(page => page.frameIndex))) {
        const expectedPages = oracle.pages.filter(page => page.frameIndex === frameIndex);
        const result = await prepared.renderFramePages({ frameIndex });
        expect(result.pageCount).toBe(expectedPages.length);
        expect(result.stepCount).toBe(1);
        expect(result.diagnostics).toEqual([]);
        for (const [index, page] of result.pages.entries()) {
          expect(page.layout.continuation).toEqual(expectedPages[index].continuation ? { index: index + 1, count: result.pageCount } : undefined);
          expect(page.svg.svg).not.toContain("data-tex-literal=");
          const native = buildNativeBeamerPageTrace(page, computerModernTexMetricProvider);
          const { summary } = compareBeamerPageTraces(native, expectedPages[index].trace);
          expect(summary).toMatchObject({
            unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
            unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0,
            excludedOracleTextLines: 0, glyphCodeMatch: true, fontMatch: true,
          });
          expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.02);
          expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.01);
          expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.01);
          if (name === "final-footnotes") expect(page.layout.paragraphs.filter(paragraph => paragraph.role === "footnote").length).toBe(index === result.pageCount - 1 ? 2 : 0);
        }
      }
    });
  }

  it("scans the split factor and exposes continuation pages separately from overlays", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}[allowframebreaks=.8]{Pages}Alpha.\newpage Beta.\end{frame}
\begin{frame}{Overlays}Alpha.\pause Beta.\end{frame}\end{document}`;
    expect(scanBeamerDocument(source).frames.map(frame => frame.options?.allowFrameBreaks)).toEqual([.8, undefined]);
    const prepared = prepareBeamerDocument(source);
    expect(prepared.frameStepCount(0)).toBe(1);
    expect(prepared.frameStepCount(1)).toBe(2);
    const split = await prepared.renderFramePages();
    expect(split.pageCount).toBe(2);
    expect(split.pages.map(page => page.layout.step)).toEqual([1, 1]);
    expect((await prepared.renderFrame({ continuation: 2 })).svg.svg).toBe(split.pages[1].svg.svg);
    await expect(prepared.renderFrame({ continuation: 3 })).rejects.toThrow("outside");
    const overlays = await prepared.renderFramePages({ frameIndex: 1 });
    expect(overlays.pageCount).toBe(2);
    expect(overlays.pages.map(page => page.layout.continuation)).toEqual([undefined, undefined]);
  });

  it("retains direct source ownership after splitting a paragraph", async () => {
    const source = readFileSync(new URL("horizontal-break.tex", fixtures), "utf8");
    const result = await renderBeamerFramePages(source);
    const owned = result.pages.flatMap(page => page.layout.paragraphs.filter(paragraph => paragraph.role === "body").flatMap(paragraph => paragraph.editableTextSpans));
    expect(owned.length).toBeGreaterThan(0);
    const text = source.indexOf("Beta");
    expect(owned.some(entry => entry.span.from <= text && text < entry.span.to)).toBe(true);
    expect(result.pages.every(page => page.layout.paragraphs.filter(paragraph => paragraph.role === "body").every(paragraph => paragraph.sourceSpan.from <= paragraph.sourceSpan.to))).toBe(true);
  });
});
