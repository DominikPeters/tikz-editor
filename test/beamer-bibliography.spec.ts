import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const fixtures = new URL("./fixtures/beamer/bibliography-fidelity/", import.meta.url);

describe("Beamer bibliography fidelity to LuaLaTeX", () => {
  for (const name of ["default", "text", "book", "online", "triangle", "wrapped-small", "footnotesize", "mixed"]) {
    it(`matches LuaLaTeX glyphs and geometry: ${name}`, async () => {
      const source = readFileSync(new URL(`${name}.tex`, fixtures), "utf8");
      const oracle = JSON.parse(readFileSync(new URL(`${name}.oracle.json`, fixtures), "utf8")) as {
        sourceSha256: string; trace: OracleBeamerPageTrace;
      };
      expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
      const result = await renderBeamerFrame(source);
      expect(result.diagnostics).toEqual([]);
      expect(result.svg.svg).not.toContain('data-tex-literal=');
      const native = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
      const { summary } = compareBeamerPageTraces(native, oracle.trace);
      expect(summary).toMatchObject({
        unmatchedNativeRectangles: 0, unmatchedOracleRules: 0,
        unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0,
        excludedOracleTextLines: 0, glyphCodeMatch: true, fontMatch: true,
      });
      expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(0.001);
      expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(0.001);
      expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(0.001);
      // The shared comparison checks font identity; also pin its point size.
      for (const line of native.lines) {
        const expected = oracle.trace.lines.find((candidate) => candidate.text === line.text && Math.abs(candidate.baselineY - line.baselineY) < 0.001)!;
        expect(expected).toBeDefined();
        for (const [index, glyph] of line.glyphs.entries()) {
          expect(Math.abs(glyph.fontSize - expected.glyphs[index].fontSize)).toBeLessThan(0.001);
        }
      }
      if (["default", "book", "online"].includes(name)) {
        expect(result.svg.svg.match(/data-tex-includegraphics="true"/gu)).toHaveLength(2);
        expect(result.svg.svg).toContain("data:image/svg+xml;base64,");
      }
      if (name === "text") {
        // Generated labels must be painted, not merely measured.
        expect(result.svg.svg).toContain('data-tex-glyph="91"');
        const segments = result.layout.paragraphs.flatMap((p) => p.report.lines.flatMap((line) => line.segments));
        const color = (text: string) => segments.find((segment) => segment.text === text)?.color;
        // beamercolorthemedefault.sty: structure, normal text,
        // structure.fg!65!bg for location and note.
        expect(color("Author.")).toBe("#3333b3");
        expect(color("manually")).toBe("#000000");
        expect(color("Journal")).toBe("#7a7acd");
        expect(color("note.")).toBe("#7a7acd");
      }
    });
  }
  it("keeps frame-local stock template selections scoped", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}
\setbeamertemplate{bibliography item}[text]
\begin{thebibliography}{9}\bibitem{one} One.\end{thebibliography}
\end{frame}
\begin{frame}
\begin{thebibliography}{9}\bibitem{two} Two.\end{thebibliography}
\end{frame}
\end{document}`;
    const first = await renderBeamerFrame(source);
    const second = await renderBeamerFrame(source, { frameIndex: 1 });
    expect(first.diagnostics).toEqual([]);
    expect(first.svg.svg).not.toContain('data-tex-includegraphics="true"');
    expect(first.svg.svg).toContain('data-tex-glyph="91"');
    expect(second.svg.svg).toContain('data-tex-includegraphics="true"');
  });
});
