import { describe, expect, it } from "vitest";

import {
  buildNativeBeamerPageTrace,
  compareBeamerPageTraces,
  type BeamerTraceGlyph,
  type NativeBeamerPageTrace,
  type OracleBeamerPageTrace,
} from "../scripts/lib/beamer-frame-compare.mjs";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";

const COORDINATE_SYSTEM = {
  unit: "tex-pt",
  origin: "top-left",
  yAxis: "down",
} as const;

function glyph(overrides: Partial<BeamerTraceGlyph> = {}): BeamerTraceGlyph {
  return {
    code: 72,
    x: 10,
    y: 20,
    width: 7,
    height: 7,
    depth: 0,
    fontName: "lmsans10-regular",
    fontSize: 10,
    ...overrides,
  };
}

describe("Beamer structural frame comparison", () => {
  it("traces standalone display and alignment math glyph rows", async () => {
    const render = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Math}
Display rows:
\[
  x_1 = 2
\]
\[
  y = 3
\]
\end{frame}
\end{document}`);
    const trace = buildNativeBeamerPageTrace(
      render,
      computerModernTexMetricProvider
    );
    const displayLines = trace.lines.filter((line) =>
      line.id.includes(":display:")
    );

    expect(displayLines).toHaveLength(3);
    expect(displayLines.flatMap((line) => line.glyphs).map((item) => item.fontName))
      .toContain("lmsans10-oblique");
    expect(displayLines.flatMap((line) => line.glyphs).map((item) => item.fontName))
      .toContain("cmss10");
  });

  it("splits inline math scripts into the same baseline rows as LuaTeX", async () => {
    const render = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Math}Inline $x_1$ script.\end{frame}
\end{document}`);
    const trace = buildNativeBeamerPageTrace(
      render,
      computerModernTexMetricProvider
    );
    const bodyLines = trace.lines.filter((line) => line.role === "body");

    expect(bodyLines).toHaveLength(2);
    expect(bodyLines.some((line) =>
      line.glyphs.some((item) => item.fontSize === 8)
    )).toBe(true);
    for (const line of bodyLines) {
      expect(line.glyphs.every((item) => item.y === line.baselineY)).toBe(true);
    }
  });

  it("traces projected enumerate labels as independently sized glyphs", async () => {
    const render = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\usetheme{Madrid}
\begin{document}
\begin{frame}{Steps}
\begin{enumerate}
\item Alpha
\item Beta
\end{enumerate}
\end{frame}
\end{document}`);
    const trace = buildNativeBeamerPageTrace(
      render,
      computerModernTexMetricProvider
    );
    const projected = trace.lines
      .filter((line) => line.id.includes(":label:"))
      .flatMap((line) => line.glyphs)
      .filter((item) =>
        item.fontName === "lmsans8-regular" && item.fontSize === 6
      );

    expect(projected.map((item) => item.code)).toEqual([49, 50]);
  });

  it("includes theme-owned list marker paint boxes in the native trace", () => {
    const trace = buildNativeBeamerPageTrace({
      layout: {
        coordinateSystem: COORDINATE_SYSTEM,
        page: {
          page: { x: 0, y: 0, width: 160, height: 90 },
        },
        items: [{
          id: "frame:0:list:0:marker:0",
          kind: "list-marker",
          bounds: { x: 12, y: 24, width: 5, height: 5 },
        }],
        paragraphs: [],
        embeddedTikz: [],
      },
    } as never, computerModernTexMetricProvider);

    expect(trace.rectangles).toEqual([{
      id: "frame:0:list:0:marker:0",
      role: "list-marker",
      x: 12,
      y: 24,
      width: 5,
      height: 5,
    }]);
  });

  it("reports rectangle edges and absolute page glyph deltas", () => {
    const native: NativeBeamerPageTrace = {
      coordinateSystem: COORDINATE_SYSTEM,
      page: { x: 0, y: 0, width: 160, height: 90 },
      untracedRegions: [{
        kind: "embedded-tikz",
        itemId: "tikz:0",
        bounds: { x: 80, y: 20, width: 60, height: 50 },
      }],
      rectangles: [{
        id: "frame:0:frame-title:background",
        role: "frame-title",
        x: 0,
        y: 0,
        width: 160,
        height: 12,
      }],
      lines: [{
        id: "frame:0:body:line:0",
        paragraphId: "frame:0:body",
        role: "body",
        lineIndex: 0,
        sourceSpan: { from: 10, to: 11 },
        text: "H",
        x: 10,
        baselineY: 20,
        glyphs: [glyph()],
      }],
      glyphs: [],
    };
    const oracle: OracleBeamerPageTrace = {
      coordinateSystem: COORDINATE_SYSTEM,
      page: { x: 0, y: 0, width: 160, height: 90 },
      shipoutOrigin: { x: -72.27, y: -72.27 },
      boxes: [],
      rules: [{
        path: "root.1",
        x: 0,
        y: 0,
        width: 160,
        height: 10,
        depth: 0,
        totalHeight: 10,
      }],
      glyphs: [],
      lines: [
        {
          text: "H",
          x: 9.5,
          baselineY: 18,
          glyphs: [glyph({ x: 9.5, y: 18 })],
        },
        {
          text: "diagram",
          x: 100,
          baselineY: 40,
          glyphs: [glyph({ x: 100, y: 40 })],
        },
      ],
    };

    const comparison = compareBeamerPageTraces(native, oracle);

    expect(comparison.summary).toEqual({
      matchedRectangles: 1,
      unmatchedNativeRectangles: 0,
      unmatchedOracleRules: 0,
      maxRectangleEdgeDeltaPt: 2,
      matchedTextLines: 1,
      unmatchedNativeTextLines: 0,
      unmatchedOracleTextLines: 0,
      excludedOracleTextLines: 1,
      comparedGlyphs: 1,
      maxAbsoluteGlyphDxPt: 0.5,
      maxAbsoluteGlyphDyPt: 2,
      glyphCodeMatch: true,
      fontMatch: true,
    });
  });
});
