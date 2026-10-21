import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const fixtures = new URL("./fixtures/beamer/footnotes-fidelity/", import.meta.url);

describe("Beamer frame footnotes against LuaLaTeX", () => {
  for (const name of ["leading", "inline", "multiple", "wrapped", "explicit", "frame-column", "frame-block", "block-auto", "overlay", "counters"]) {
    it(`matches glyphs, font sizes, rules and frame packing: ${name}`, async () => {
      const source = readFileSync(new URL(`${name}.tex`, fixtures), "utf8");
      const oracle = JSON.parse(readFileSync(new URL(`${name}.oracle.json`, fixtures), "utf8")) as {
        sourceSha256: string; pages: Array<{ frameIndex?: number; step: number; trace: OracleBeamerPageTrace }>;
      };
      expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
      for (const { frameIndex, step, trace } of oracle.pages) {
        const result = await renderBeamerFrame(source, { frameIndex, step });
        expect(result.diagnostics).toEqual([]);
        expect(result.svg.svg).not.toContain('data-tex-literal=');
        const native = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
        const { summary } = compareBeamerPageTraces(native, trace);
        expect(summary).toMatchObject({
          unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
          unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0,
          excludedOracleTextLines: 0, glyphCodeMatch: true, fontMatch: true,
        });
        expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.001);
        expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.001);
        expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.01);
        const notes = result.layout.paragraphs.filter((paragraph) => paragraph.role === "footnote");
        expect(notes.length).toBe(trace.lines.filter((line) => /^\d+$/u.test(line.text) && line.glyphs.every((glyph) => glyph.fontSize === 6)).length);
        for (const line of native.lines) {
          const expected = trace.lines.find((candidate) => candidate.text === line.text && Math.abs(candidate.baselineY - line.baselineY) < .001);
          expect(expected).toBeDefined();
          for (const [index, glyph] of line.glyphs.entries()) {
            expect(Math.abs(glyph.fontSize - expected!.glyphs[index].fontSize)).toBeLessThan(.001);
          }
        }
        if (name === "wrapped") {
          expect(notes[0].report.lines.length).toBeGreaterThan(1);
          expect(notes[0].links?.[0]?.destination).toEqual({ kind: "external", url: "https://example.org" });
        }
        if (name === "overlay" && step === 1) {
          expect(summary.coveredOverlayTextLines).toBe(2);
          expect(notes[0].editableTextSpans).toEqual([]);
        }
      }
    });
  }

  it("retains direct body ownership and keeps generated marks atomic", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}Alpha\footnote{Direct note.} Beta.\end{frame}\end{document}`;
    const result = await renderBeamerFrame(source);
    const note = result.layout.paragraphs.find((paragraph) => paragraph.role === "footnote")!;
    const direct = source.indexOf("Direct note.");
    expect(note.editableTextSpans.some((entry) => entry.span.from <= direct && entry.span.to >= direct + "Direct note.".length)).toBe(true);
    expect(result.layout.paragraphs.filter((paragraph) => paragraph.role === "body").flatMap((paragraph) => paragraph.editableTextSpans).some((entry) => entry.span.from <= direct && direct < entry.span.to)).toBe(false);
    expect(note.atomicRenderSpans.length).toBeGreaterThan(0);
  });

  it("keeps automatic counters across frames and resets them across overlay renders", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}First\footnote{One.}\end{frame}
\begin{frame}Second\footnote<2>{Two.}\end{frame}\end{document}`;
    for (const step of [1, 2]) {
      const result = await renderBeamerFrame(source, { frameIndex: 1, step });
      const native = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
      expect(native.lines.filter((line) => line.role === "body" && /^\d+$/u.test(line.text)).map((line) => line.text)).toEqual(["2"]);
    }
  });
});
