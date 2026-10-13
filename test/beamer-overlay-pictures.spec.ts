import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { renderTikzToSvgAsync } from "../packages/core/src/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

const source = readFileSync(new URL("./fixtures/beamer/overlay-pictures-fidelity/pictures.tex", import.meta.url), "utf8");
const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/overlay-pictures-fidelity/pictures.oracle.json", import.meta.url), "utf8")) as {
  sourceSha256: string;
  pages: Array<OracleBeamerPageTrace & { frame: number; step: number }>;
};

describe("Beamer overlay pictures", () => {
  it.each(oracle.pages.map(page => [page.frame, page.step] as const))("matches the pinned LuaLaTeX glyphs of frame %i, step %i", async (frame, step) => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
    const rendered = await renderBeamerFrame(source, { frameIndex: frame - 1, step });
    expect(rendered.diagnostics).toEqual([]);
    const page = oracle.pages.find(entry => entry.frame === frame && entry.step === step)!;
    const comparison = compareBeamerPageTraces(buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider), page);
    const summary = comparison.summary;
    expect(summary.glyphCodeMatch).toBe(true);
    expect(summary.fontMatch).toBe(true);
    expect(summary.unmatchedNativeTextLines).toBe(0);
    // TeX also traces a picture \uncover covers; the native frame does not draw it.
    const text = comparison.text as { unmatchedOracle: Array<{ text: string }> };
    expect(text.unmatchedOracle.map(line => line.text)).toEqual(frame === 10 && step === 2 ? ["Three"] : []);
    expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.001);
    expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.001);
  });

  it("publishes overlay pictures as page-placed pictures with their document root ids", async () => {
    const rendered = await renderBeamerFrame(source, { frameIndex: 0 });
    const pictures = rendered.layout.items.filter(item => item.kind === "tikzpicture");
    expect(pictures).toHaveLength(1);
    expect(pictures[0]).toMatchObject({ overlayPicture: true, rootId: "frame:0:tikzpicture:0" });
    expect(rendered.layout.embeddedTikz[0].overlayPicture).toBe(true);
    // The page rectangle is drawn around the page.
    expect(pictures[0].bounds.x).toBeLessThan(0);
    expect(pictures[0].bounds.x + pictures[0].bounds.width).toBeGreaterThan(rendered.layout.page.page.width);
  });

  it("draws no picture that an overlay specification removes or covers", async () => {
    const first = await renderBeamerFrame(source, { frameIndex: 9, step: 1 });
    expect(first.layout.items.filter(item => item.kind === "tikzpicture")).toEqual([]);
    const second = await renderBeamerFrame(source, { frameIndex: 9, step: 2 });
    expect(second.layout.items.filter(item => item.kind === "tikzpicture")).toHaveLength(1);
  });
});

describe("TikZ overlay and current page", () => {
  it("leaves overlay material out of the picture's size", async () => {
    const rendered = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}[remember picture]
\draw (0,0) rectangle (1,1);
\draw[overlay] (0,0) -- (5,5);
\begin{scope}[overlay]\node at (-4,-4) {X};\end{scope}
\end{tikzpicture}`, { svg: { padding: 0 } });
    expect([...rendered.parse.diagnostics, ...rendered.semantic.diagnostics]).toEqual([]);
    const bounds = rendered.semantic.scene.bounds!;
    expect(bounds.minX).toBeCloseTo(-0.2, 3);
    expect(bounds.maxX).toBeCloseTo(28.6528, 3);
  });

  it("places current page's anchors on the page it is given", async () => {
    const rendered = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}[shift={(current page.center)}]
\draw[line width=0] (current page.south west) -- (current page.north east);
\end{tikzpicture}`, { svg: { padding: 0 }, evaluate: { currentPage: { minX: -10, minY: -200, maxX: 300, maxY: 20 } } });
    expect([...rendered.parse.diagnostics, ...rendered.semantic.diagnostics]).toEqual([]);
    const bounds = rendered.semantic.scene.bounds!;
    // Named anchors are world points: the shift does not move them.
    expect([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]).toEqual([-10, -200, 300, 20]);
  });

  it("reports current page as unknown when the picture's page is not known", async () => {
    const rendered = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}\node at (current page.center) {X};\end{tikzpicture}`);
    expect(rendered.semantic.diagnostics.map(diagnostic => diagnostic.code)).toContain("unknown-named-coordinate:current page.center");
  });
});
