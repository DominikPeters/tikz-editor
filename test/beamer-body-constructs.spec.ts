import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/render.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const read = (name: string) => readFileSync(new URL(`./fixtures/beamer/body-constructs/${name}`, import.meta.url), "utf8");
const oracle = JSON.parse(read("oracle.json")) as { pages: Array<{ name: string; trace: OracleBeamerPageTrace }> };

// Oracle traces are LuaLaTeX 2026 pages of hspace.tex (\hspace, \hspace*, \quad, \qquad, \enspace, \, with
// em/ex/pt/cm and \linewidth factors, wrapping and discarding at breaks) and boxed-title.tex (\tcbset style with
// enhanced skin and `attach boxed title to top left`, two consecutive boxes).
describe("body constructs against LuaLaTeX", () => {
  for (const page of oracle.pages) it(`matches ${page.name}`, async () => {
    const result = await prepareBeamerDocument(read(`${page.name}.tex`)).renderFrame({ frameIndex: 0 });
    expect(result.diagnostics).toEqual([]);
    expect(result.svg.svg).not.toContain("data-tex-literal=");
    const { summary } = compareBeamerPageTraces(buildNativeBeamerPageTrace(result, computerModernTexMetricProvider), page.trace);
    expect(summary).toMatchObject({ unmatchedNativeRectangles: 0, unmatchedOracleRules: 0, unmatchedNativeTextLines: 0, unmatchedOracleTextLines: 0, glyphCodeMatch: true, fontMatch: true, transformMatch: true });
    expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.02);
    expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.01);
  });
  it("keeps \\hspace* and \\vspace{\\fill} out of the literal fallback", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}{T}A\hspace*{2em}B\hspace{1cm}C\quad D.\vspace*{\fill}\end{frame}\end{document}`;
    const result = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0 });
    expect(result.svg.svg).not.toContain("data-tex-literal=");
  });
});
