import { beforeAll, describe, expect, it } from "vitest";
import { renderBeamerFrame } from "../packages/core/src/beamer/index.js";
import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";
import type { NodeTextEngine } from "../packages/core/src/text/types.js";
import {
  computerModernTexMetricProvider,
  DEFAULT_COMPUTER_MODERN_TEXT_FONTS,
  luaLatexDefaultTextFontProfile,
  texLength,
} from "../packages/core/src/text/tex/index.js";

const boundaries = [[14.4, 12], [15.49, 12], [15.5, 17], [24.88, 17]] as const;
const profileCases = boundaries.flatMap(([size, optical]) => (["upright", "slanted", "italic"] as const).map(shape => ({ size, optical, shape })));
const renderCases = boundaries.flatMap(([size, optical]) => (["normal", "italic"] as const).map(style => ({ size, optical, style })));
let engine: NodeTextEngine;
beforeAll(async () => { engine = await createTexNodeTextEngine(); });

describe("Latin Modern sans optical size 17", () => {
  // Installed tulmss.fd: m/n and m/sl use <11-15.5>12, <15.5->17;
  // m/it substitutes m/sl. Bold stays on the 10pt design at every size.
  it.each(profileCases)("selects and resolves $shape at $size pt", ({ size, optical, shape }) => {
      const font = luaLatexDefaultTextFontProfile.resolveTextFont({ family: "sans", series: "medium", shape }, texLength(size));
      expect(font.id).toBe(`lmsans${optical}-${shape === "upright" ? "regular" : "oblique"}`);
      expect(font.atPt).toBe(size);
      expect(DEFAULT_COMPUTER_MODERN_TEXT_FONTS).toContain(font.id);
      expect(font.data.glyphs?.[120]).toBeTruthy();
    });

  it.each(["upright", "slanted", "italic"] as const)("retains the declared bold %s policy at Huge", shape => {
    expect(luaLatexDefaultTextFontProfile.resolveTextFontId({ family: "sans", series: "bold", shape }, texLength(24.88)))
      .toBe(shape === "upright" ? "lmsans10-bold" : "lmsans10-boldoblique");
  });

  it.each(["upright", "slanted"] as const)("uses 17pt advances and source ligatures for %s prose", shape => {
    const font = luaLatexDefaultTextFontProfile.resolveTextFont({ family: "sans", series: "medium", shape }, texLength(24.88));
    // Actual LuaTeX OpenType metric extraction: x advance 0.432em.
    expect(computerModernTexMetricProvider.shapeText("x", font).width).toBeCloseTo(10.74816, 5);
    const shaped = computerModernTexMetricProvider.shapeText("office", font);
    expect(shaped.items.filter(item => item.kind === "glyph").map(item => item.code)).toEqual([111, 0xfb03, 99, 101]);
    expect(shaped.sourceCaretStops.map(stop => stop.sourceOffset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(shaped.caretStops.at(-1)).toBeCloseTo(shaped.width, 6);
  });

  it.each(renderCases)("renders native $style sans nodes at $size pt with the selected outlines", ({ size, optical, style }) => {
      const metrics = engine.measure({ text: "office", textWidthPt: null, fontFamily: "sans", fontStyle: style,
        fontWeight: "normal", fontSizePt: size });
      expect(metrics).not.toBeNull();
      if (!metrics) throw new Error("Expected supported sans measurement");
      const rendered = engine.renderFromCache(metrics.cacheKey);
      expect(rendered).not.toBeNull();
      const faces = [...new Set([...rendered!.body.matchAll(/data-tex-font="([^"]+)"/g)].map(match => match[1]))];
      expect(faces).toEqual([`lmsans${optical}-${style === "normal" ? "regular" : "oblique"}`]);
      const font = luaLatexDefaultTextFontProfile.resolveTextFont({ family: "sans", series: "medium", shape: style === "normal" ? "upright" : "italic" }, texLength(size));
      expect(metrics.width).toBeCloseTo(computerModernTexMetricProvider.shapeText("office", font).width, 6);
    });

  it("uses the Huge 17pt design for Beamer text and sans math with the retained LuaLaTeX width", async () => {
    const page = await renderBeamerFrame(String.raw`\documentclass{beamer}\begin{document}\begin{frame}\Huge x $x$\end{frame}\end{document}`);
    expect(page.diagnostics).toEqual([]);
    const body = page.layout.paragraphs.find(paragraph => paragraph.role === "body")!;
    const math = body.report.lines.flatMap(line => line.segments).find(segment => segment.kind === "math")!;
    // Retained TEXT-003-HUGE-INLINE oracle: advance + oblique italic correction.
    expect(math.width).toBeCloseTo(13.08688, 4);
    expect(page.svg.svg).toContain('data-tex-font="lmsans17-regular"');
    expect(page.svg.svg).toContain('data-tex-font="lmsans17-oblique"');
  });
});
