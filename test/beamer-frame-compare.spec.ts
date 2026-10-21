import { readFileSync } from "node:fs";
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


  it("traces a clipped graphic's painted viewport instead of its intrinsic image extent", async () => {
    const render = await renderBeamerFrame(String.raw`\documentclass{beamer}\begin{document}\begin{frame}\mbox{\includegraphics[width=40pt,trim=50pt 0 0 0,clip]{crop.png}}\end{frame}\end{document}`, { graphicsResolver: {
      cacheKey: "crop-trace", resolve: () => ({ status: "resolved", mimeType: "image/png", dataBase64: readFileSync(new URL("./fixtures/beamer/corpus-priorities/test-image.png", import.meta.url)).toString("base64"), naturalWidthPt: 100, naturalHeightPt: 50, revision: "crop" }),
    } });
    const images = buildNativeBeamerPageTrace(render, computerModernTexMetricProvider).rectangles.filter(rect => rect.role === "image");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ width: 40, height: 40 });
    expect(render.diagnostics).toEqual([]);
  });

  it("traces native display math rules alongside theme rectangles", async () => {
    const render = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Math}
Fraction:
\[
  x = \frac{1}{2}
\]
\end{frame}
\end{document}`);
    const trace = buildNativeBeamerPageTrace(
      render,
      computerModernTexMetricProvider
    );

    expect(trace.rectangles).toContainEqual(
      expect.objectContaining({
        role: "fraction-rule",
        width: expect.any(Number),
        height: expect.any(Number),
      })
    );
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

  it("traces transformed TikZ labels with Beamer's actual script face", async () => {
    const render = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Diagram}
\begin{tikzpicture}
  \draw (0,0) -- (2,1) node[pos=.5,above,sloped] {$g(x)\le 0$};
  \node at (1,0) {$x^\star$};
\end{tikzpicture}
\end{frame}
\end{document}`);
    const trace = buildNativeBeamerPageTrace(
      render,
      computerModernTexMetricProvider
    );
    const embeddedGlyphs = trace.glyphs.filter(
      (item) => item.role === "embedded-tikz"
    );

    expect(trace.untracedRegions).toEqual([]);
    expect(trace.lines.some(
      (line) =>
        line.role === "embedded-tikz" &&
        line.text === "g(x)\u00140"
    )).toBe(true);
    expect(embeddedGlyphs).toContainEqual(expect.objectContaining({
      code: 63,
      fontName: "cmmi8",
      fontSize: 8,
    }));
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
    }, computerModernTexMetricProvider);

    expect(trace.rectangles).toEqual([{
      id: "frame:0:list:0:marker:0",
      role: "list-marker",
      x: 12,
      y: 24,
      width: 5,
      height: 5,
    }]);
  });

  it("includes all theme background items in the native rectangle contract", () => {
    const trace = buildNativeBeamerPageTrace({
      layout: {
        coordinateSystem: COORDINATE_SYSTEM,
        page: {
          page: { x: 0, y: 0, width: 160, height: 90 },
        },
        items: [{
          id: "frame:0:headline:section:hook-horizontal",
          kind: "background",
          bounds: { x: 8, y: 12, width: 5, height: 0.4 },
        }],
        paragraphs: [],
        embeddedTikz: [],
      },
    }, computerModernTexMetricProvider);

    expect(trace.rectangles).toEqual([{
      id: "frame:0:headline:section:hook-horizontal",
      role: "headline",
      x: 8,
      y: 12,
      width: 5,
      height: 0.4,
    }]);
  });

  it("traces source colorboxes activated by an aggregate color theme", async () => {
    const render = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\usetheme{Antibes}
\title{Deck}
\begin{document}
\begin{frame}
\titlepage
\begin{block}{Theorem}Body\end{block}
\end{frame}
\end{document}`);
    const trace = buildNativeBeamerPageTrace(
      render,
      computerModernTexMetricProvider
    );

    expect(trace.rectangles).toContainEqual(expect.objectContaining({
      id: "frame:0:title-page:0:title:background",
      role: "page",
    }));
    expect(trace.rectangles).toContainEqual(expect.objectContaining({
      id: "frame:0:block:0:title:background",
      role: "page",
    }));
    expect(trace.rectangles).toContainEqual(expect.objectContaining({
      id: "frame:0:block:0:body:background",
      role: "page",
    }));
  });

  it("clusters co-baseline theme paragraphs into the visual oracle line", async () => {
    const render = await renderBeamerFrame(String.raw`
\documentclass{beamer}
\useoutertheme{infolines}
\begin{document}
\section{Foundations}
\subsection{Overview}
\begin{frame}{Frame}Body\end{frame}
\end{document}`);
    const trace = buildNativeBeamerPageTrace(
      render,
      computerModernTexMetricProvider
    );

    expect(trace.lines).toContainEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^native:page-line:/),
        role: "headline",
        text: "FoundationsOverview",
        baselineY: expect.closeTo(7.059586, 6),
      })
    );
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
      coveredOverlayRules: 0,
      maxRectangleEdgeDeltaPt: 2,
      matchedTextLines: 1,
      unmatchedNativeTextLines: 0,
      unmatchedOracleTextLines: 0,
      excludedOracleTextLines: 1,
      coveredOverlayTextLines: 0,
      comparedGlyphs: 1,
      maxAbsoluteGlyphDxPt: 0.5,
      maxAbsoluteGlyphDyPt: 2,
      glyphCodeMatch: true,
      fontMatch: true,
      transformMatch: true,
    });
    const changedSize = { ...native, lines: native.lines.map(line => ({
      ...line, glyphs: line.glyphs.map(g => ({ ...g, fontSize: 9 })),
    })) };
    expect(compareBeamerPageTraces(changedSize, oracle).summary.fontMatch).toBe(false);
  });
  it("compares represented page-edge shading without treating PDF mask carriers as paint", () => {
    const page = { x: 0, y: 0, width: 160, height: 90 };
    const rectangle = { id: "transition", role: "other", x: 0, y: -.7, width: 160, height: 2.66 };
    const native: NativeBeamerPageTrace = {
      coordinateSystem: COORDINATE_SYSTEM, page, untracedRegions: [], rectangles: [rectangle], glyphs: [], lines: [],
    };
    const oracle: OracleBeamerPageTrace = {
      coordinateSystem: COORDINATE_SYSTEM, page, shipoutOrigin: { x: 0, y: 0 }, boxes: [], glyphs: [], lines: [],
      rules: [
        { ...rectangle, path: "transition", depth: 0, totalHeight: 2.66 },
        { path: "mask-carrier", x: 0, y: -70, width: 160, height: 80, depth: 0, totalHeight: 80 },
      ],
    };
    expect(compareBeamerPageTraces(native, oracle).summary).toMatchObject({ matchedRectangles: 1, unmatchedOracleRules: 0, maxRectangleEdgeDeltaPt: 0 });
    const shifted = { ...native, rectangles: [{ ...rectangle, y: -.75 }] };
    expect(compareBeamerPageTraces(shifted, oracle).summary.maxRectangleEdgeDeltaPt).toBe(.05);
    const resized = { ...native, rectangles: [{ ...rectangle, height: 3 }] };
    expect(compareBeamerPageTraces(resized, oracle).summary.unmatchedNativeRectangles).toBe(1);
  });

});
