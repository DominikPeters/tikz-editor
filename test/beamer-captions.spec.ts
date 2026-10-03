import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { projectBeamerCaptions } from "../packages/core/src/beamer/captions.js";
import { createIdentityMappedText, projectInputRange } from "../packages/core/src/text/source-map.js";

describe("Beamer stock float captions", () => {
  it("matches the image caption and surrounding prose on the retained LuaLaTeX baselines", async () => {
    const source = readFileSync(new URL("./fixtures/beamer/corpus-priorities/flow.tex", import.meta.url), "utf8");
    const result = await prepareBeamerDocument(source).renderFrame({ frameIndex: 6, graphicsResolver: {
      cacheKey: "caption-fixture", resolve: () => ({ status: "resolved", dataBase64: readFileSync(new URL("./fixtures/beamer/corpus-priorities/test-image.png", import.meta.url)).toString("base64"), mimeType: "image/png", naturalWidthPt: 64.24, naturalHeightPt: 32.12, revision: "caption-image" }),
    } });
    const trace = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
    for (const [text, baseline] of [["Beforethefigure.", 85.046509], ["Figure:Alphaimage", 150.024567], ["Afterthefigure.", 179.624573]] as const) {
      const line = trace.lines.find(line => line.text === text)!;
      expect(line, text).toBeDefined();
      expect(Math.abs(line.baselineY - baseline)).toBeLessThan(.01);
    }
    expect(trace.lines.find(line => line.text === "Figure:Alphaimage")!.glyphs.every(glyph => glyph.fontSize === 10)).toBe(true);
    expect(result.svg.svg).toContain("#3333b3");
    expect(result.layout.items.some(item => item.kind === "unsupported")).toBe(false);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains both float boundary skips between consecutive figures", async () => {
    const source = readFileSync(new URL("./fixtures/beamer/captions-fidelity/numbered.tex", import.meta.url), "utf8");
    const result = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0 });
    const trace = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
    for (const [text, baseline] of [["Before.", 13.410202], ["Figure1.Alpha", 56.610214], ["Figure2.Beta", 117.270218], ["After.", 146.870224]] as const) {
      const line = trace.lines.find(line => line.text === text)!;
      expect(line, text).toBeDefined();
      expect(Math.abs(line.baselineY - baseline)).toBeLessThan(.01);
    }
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves caption source ownership and the stock optional-short-text behavior", () => {
    const source = String.raw`\begin{figure}[ht]\centering\rule{20pt}{10pt}\caption[Short]{Long title}\end{figure}`;
    const mapped = projectBeamerCaptions(createIdentityMappedText(source, 0), source);
    expect(mapped.text).toContain("Long title");
    expect(mapped.text).not.toContain("Short");
    expect(mapped.text).not.toContain("\\centering");
    const start = mapped.text.indexOf("Long title");
    expect(projectInputRange(mapped.sourceMap, start, start + 10)).toMatchObject({ kind: "source-range", from: source.indexOf("Long title"), to: source.indexOf("Long title") + 10 });
  });

  it("ignores leading caption whitespace and restores frame/group-local templates", () => {
    const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}\setbeamertemplate{caption}[numbered]\begin{figure}\caption{
 % caption comment
 Alpha}\end{figure}\end{frame}
\begin{frame}\begin{figure}\caption{Beta}\end{figure}
{\setbeamertemplate{caption label separator}[period]\begin{figure}\caption{Gamma}\end{figure}}
\begin{figure}\caption{Delta}\end{figure}\end{frame}\end{document}`;
    for (const [word, label] of [["Alpha", "Figure~1:"], ["Beta", "Figure:"], ["Gamma", "Figure."], ["Delta", "Figure:"]] as const) {
      const start = source.lastIndexOf("\\begin{figure}", source.indexOf(word));
      const end = source.indexOf("\\end{figure}", start) + "\\end{figure}".length;
      const mapped = projectBeamerCaptions(createIdentityMappedText(source.slice(start, end), start), source);
      expect(mapped.text).toContain(label + "\\ }");
      expect(mapped.text).not.toContain("caption comment");
      expect(mapped.text).toContain("}" + word);
    }
  });

  it("uses separate figure/table counters and the stock numbered/period templates", () => {
    const source = String.raw`\documentclass{beamer}\setbeamertemplate{caption}[numbered]\setbeamertemplate{caption label separator}[period]
\begin{document}\begin{frame}Before.\begin{figure}\rule{20pt}{10pt}\caption{First}\end{figure}
\begin{table}\begin{tabular}{c}A\end{tabular}\caption{Table}\end{table}\end{frame}
\begin{frame}Before.\begin{figure}\rule{20pt}{10pt}\caption{Second}\end{figure}\end{frame}\end{document}`;
    const second = source.indexOf("\\begin{figure}", source.indexOf("\\caption{Table}"));
    const mapped = projectBeamerCaptions(createIdentityMappedText(source.slice(second, source.indexOf("\\end{figure}", second) + 12), second), source);
    expect(mapped.text).toContain("Figure~2.\\ ");
    expect(mapped.text).toContain("Second");
  });
});
