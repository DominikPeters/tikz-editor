import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderBeamerFrame, scanBeamerDocument, buildBeamerCaretStopDomain } from "../packages/core/src/beamer/index.js";
import { beamerFrameShrinkScale, beamerFrameShrinkWidth, crampedBeamerListProfile, inverseTransformBeamerPoint, resolveBeamerFrameShrink, transformBeamerPoint } from "../packages/core/src/beamer/frame-shrink.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace, compareBeamerPageTraces, type OracleBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { buildSelectionRects } from "../packages/app/src/ui/builds-panel/build-selection.js";

const source = readFileSync(new URL("./fixtures/beamer/frame-shrink-fidelity/shrink.tex", import.meta.url), "utf8");
const oracle = JSON.parse(readFileSync(new URL("./fixtures/beamer/frame-shrink-fidelity/shrink.oracle.json", import.meta.url), "utf8")) as { sourceSha256: string; pages: OracleBeamerPageTrace[] };

describe("Beamer frame shrink", () => {
  it.each([0, 1, 2])("matches pinned primary glyph paint, axes and rules for frame %i", async frameIndex => {
    expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
    const rendered = await renderBeamerFrame(source, { frameIndex });
    expect(rendered.diagnostics).toEqual([]);
    const summary = compareBeamerPageTraces(buildNativeBeamerPageTrace(rendered, computerModernTexMetricProvider), oracle.pages[frameIndex]).summary;
    expect(summary.glyphCodeMatch).toBe(true);
    expect(summary.fontMatch).toBe(true);
    expect(summary.transformMatch).toBe(true);
    expect(summary.unmatchedNativeTextLines).toBe(0);
    expect(summary.unmatchedOracleTextLines).toBe(0);
    expect(summary.unmatchedNativeRectangles).toBe(0);
    expect(summary.unmatchedOracleRules).toBe(0);
    expect(summary.maxAbsoluteGlyphDxPt).toBeLessThan(.001);
    expect(summary.maxAbsoluteGlyphDyPt).toBeLessThan(.001);
    expect(summary.maxRectangleEdgeDeltaPt).toBeLessThan(.001);
  });
  it("uses Beamer's scaled-point minimum and integer reciprocal arithmetic", () => {
    const document = scanBeamerDocument(source);
    const shrink = resolveBeamerFrameShrink(document.frames[0])!;
    expect(shrink).toEqual({ minimumScale: .80011, widthMultiplier: 1.2549 });
    expect(beamerFrameShrinkWidth(20138549 / 65536, shrink)).toBe(25271826 / 65536);
    expect(beamerFrameShrinkScale(shrink, 62.52432, 246.26038)).toBe(.80011);
    expect(beamerFrameShrinkScale(shrink, 400.75, 246.26038)).toBe(.61565);
    expect(resolveBeamerFrameShrink(document.frames[1])).toEqual({ minimumScale: 1, widthMultiplier: 1 });
    expect(resolveBeamerFrameShrink(document.frames[2])).toBeNull();
  });

  it("retains captured list boundary glue while zeroing the live itemsep", () => {
    const profile = { leftMarginEmByDepth: [2], topsepPtByDepth: [3, 2], partopsepPtByDepth: [0], itemsepPtByDepth: [3, 2], parsepPtByDepth: [0], initialItemBaselineAdjustmentPt: 0 };
    expect(crampedBeamerListProfile(profile)).toMatchObject({ topsepPtByDepth: [3, 2], itemsepPtByDepth: [0, 0], itemsepStretchPtByDepth: [0, 0], itemsepShrinkPtByDepth: [0, 0] });
    expect(profile.itemsepPtByDepth).toEqual([3, 2]);
  });

  it("composes body paint with math/graphicx glyphs and preserves unscaled title fonts", async () => {
    const render = await renderBeamerFrame(source);
    const trace = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider);
    expect(render.diagnostics).toEqual([]);
    expect(render.layout.bodyTransform?.slice(0, 4)).toEqual([.80011, 0, 0, .80011]);
    const bodyGlyphs = trace.glyphs.filter(glyph => glyph.role === "body");
    expect(bodyGlyphs.some(glyph => glyph.transform?.[0] === .80011)).toBe(true);
    expect(bodyGlyphs.find(glyph => glyph.code === 65 && glyph.transform?.[0] === 0)?.transform).toEqual([0, -.80011, .80011, 0]);
    for (const glyph of trace.glyphs.filter(glyph => glyph.role === "frame-title" || glyph.role === "frame-subtitle")) expect(glyph.transform).toBeUndefined();
    expect(render.layout.paragraphs.filter(paragraph => paragraph.role === "body").every(paragraph => paragraph.transformedLayout != null)).toBe(true);
  });

  it("keeps authored caret offsets and selection geometry in painted page coordinates", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}[shrink=20]{Title}Alpha beta gamma.\par Delta epsilon.\end{frame}\end{document}`;
    const render = await renderBeamerFrame(source);
    const paragraph = render.layout.paragraphs.find(paragraph => paragraph.role === "body")!;
    const transformed = paragraph.transformedLayout!;
    const intrinsic = { ...paragraph, bounds: transformed.intrinsicBounds, transformedLayout: undefined };
    const original = buildBeamerCaretStopDomain({ source, paragraphs: [intrinsic] });
    const painted = buildBeamerCaretStopDomain({ source, paragraphs: [paragraph] });
    expect(original.rows.length).toBeGreaterThan(0);
    expect(painted.offsets).toEqual(original.offsets);
    original.rows.forEach((row, index) => {
      const paintedRow = painted.rows[index];
      expect(paintedRow.height).toBeCloseTo(row.height * .80011, 8);
      row.stops.forEach((stop, stopIndex) => {
        const point = transformBeamerPoint(transformed.paintTransform, { x: stop.x, y: row.y });
        expect(paintedRow.stops[stopIndex].x).toBeCloseTo(point.x, 8);
        expect(paintedRow.y).toBeCloseTo(point.y, 8);
        expect(inverseTransformBeamerPoint(transformed.paintTransform, point)).toEqual(expect.objectContaining({ x: expect.closeTo(stop.x, 8), y: expect.closeTo(row.y, 8) }));
      });
    });
    const span = { from: source.indexOf("Alpha beta"), to: source.indexOf("Alpha beta") + "Alpha beta".length };
    const rectangles = buildSelectionRects(render.layout, source, [span]);
    expect(rectangles).toHaveLength(1);
    expect(rectangles[0].y).toBeCloseTo(painted.rows[0].y, 8);
    expect(rectangles[0].height).toBeCloseTo(painted.rows[0].height, 8);
  });
});
