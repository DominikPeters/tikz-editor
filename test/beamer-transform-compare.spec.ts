import { describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

async function trace(body: string) {
  const rendered = await renderBeamerFrame(String.raw`\documentclass{beamer}\begin{document}\begin{frame}[plain,t]{}` + body + String.raw`\end{frame}\end{document}`);
  return buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
}

describe("painted graphicx trace contract", () => {
  it("groups rotated glyphs along their painted baseline with their original font size", async () => {
    const native = await trace(String.raw`Before \rotatebox{90}{Alpha} After.`);
    const word = native.lines.find((line) => line.text === "Alpha")!;
    expect(word).toBeDefined();
    expect(word.glyphs.map((glyph) => glyph.code)).toEqual([65, 108, 112, 104, 97]);
    for (const glyph of word.glyphs) {
      expect(glyph.transform).toEqual([0, -1, 1, 0]);
      expect(glyph.fontSize).toBe(10.95);
      expect(glyph.x).toBeCloseTo(word.glyphs[0].x, 6);
    }
    expect(word.glyphs[1].y).toBeLessThan(word.glyphs[0].y);
  });
  it("composes every ancestor matrix for nested anisotropic paint and rules", async () => {
    const native = await trace(String.raw`\scalebox{.5}[2]{\rotatebox{90}{Alpha\rule{15pt}{2pt}}}`);
    expect(native.glyphs[0]).toMatchObject({ transform: [0, -2, .5, 0], fontSize: 10.95 });
    expect(native.rectangles).toContainEqual(expect.objectContaining({ width: 1, height: 30 }));
    const mirrored = await trace(String.raw`\reflectbox{Alpha}`);
    expect(mirrored.lines[0].text).toBe("Alpha");
    expect(mirrored.glyphs[0].transform).toEqual([-1, 0, 0, 1]);
    expect(mirrored.glyphs[1].x).toBeLessThan(mirrored.glyphs[0].x);
  });
  it("fails the affine gate when origins and underlying fonts still match", async () => {
    const native = await trace(String.raw`\rotatebox{90}{Alpha}`);
    const oracle: OracleBeamerPageTrace = {
      coordinateSystem: native.coordinateSystem, page: native.page, shipoutOrigin: { x: 0, y: 0 },
      boxes: [], rules: [], glyphs: native.glyphs,
      lines: native.lines.map((line) => ({ ...line, glyphs: line.glyphs.map((glyph) => ({ ...glyph, transform: [1, 0, 0, 1] as const })) })),
    };
    const summary = compareBeamerPageTraces(native, oracle).summary;
    expect(summary.glyphCodeMatch).toBe(true);
    expect(summary.fontMatch).toBe(true);
    expect(summary.maxAbsoluteGlyphDxPt).toBe(0);
    expect(summary.maxAbsoluteGlyphDyPt).toBe(0);
    expect(summary.transformMatch).toBe(false);
  });
  it("removes only exact covered glyphs from mixed visible and covered oracle lines", async () => {
    const rendered = await renderBeamerFrame(String.raw`\documentclass{beamer}\begin{document}\begin{frame}[plain,t]{}\onslide<2->{Group} Tail\end{frame}\end{document}`, { step: 1 });
    const native = buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider);
    const glyphs = [...native.coveredLines!.flatMap(line => line.glyphs), ...native.glyphs].sort((left, right) => left.x - right.x);
    const oracle: OracleBeamerPageTrace = {
      coordinateSystem: native.coordinateSystem, page: native.page, shipoutOrigin: { x: 0, y: 0 }, boxes: [], rules: [], glyphs,
      lines: [{ text: "GroupTail", x: glyphs[0].x, baselineY: glyphs[0].y, glyphs }],
    };
    const summary = compareBeamerPageTraces(native, oracle).summary;
    expect(summary.coveredOverlayTextLines).toBe(1);
    expect(summary.matchedTextLines).toBe(1);
    expect(summary.unmatchedOracleTextLines).toBe(0);
    expect(summary.unmatchedNativeTextLines).toBe(0);
    expect(summary.comparedGlyphs).toBe(4);
    const wrongAxes = { ...native, coveredLines: native.coveredLines!.map(line => ({ ...line, glyphs: line.glyphs.map(glyph => ({ ...glyph, transform: [-1, 0, 0, 1] as const })) })) };
    expect(compareBeamerPageTraces(wrongAxes, oracle).summary.unmatchedOracleTextLines).toBe(1);
  });
});
