import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { computerModernTexMetricProvider, layoutSimpleTexParagraph, texLength } from "../packages/core/src/text/tex/index.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";
import { projectBeamerCaptions } from "../packages/core/src/beamer/captions.js";
import { createIdentityMappedText, projectInputRange } from "../packages/core/src/text/source-map.js";

describe("Beamer stock float captions", () => {
  it("matches the package's starred caption baseline and keeps its label absent", async () => {
    const source = readFileSync(new URL("./fixtures/beamer/corpus-followups/tables-caption-star.tex", import.meta.url), "utf8");
    const result = await prepareBeamerDocument(source).renderFrame();
    const trace = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
    expect(result.diagnostics).toEqual([]);
    const caption = trace.lines.find(line => line.text === "Anordinaryunnumberedplot.")!;
    expect(caption).toBeDefined();
    expect(Math.abs(caption.baselineY - 55.090424)).toBeLessThan(.01);
    expect(Math.abs(caption.x - 164.747055)).toBeLessThan(.02);
    expect(caption.glyphs.every(glyph => glyph.fontSize === 10)).toBe(true);
    expect(trace.lines.every(line => !line.text.includes("Figure"))).toBe(true);
  });

  it("keeps short and long package captions scoped and does not advance the figure counter for stars", async () => {
    const source = readFileSync(new URL("./fixtures/beamer/captions-fidelity/package-default.tex", import.meta.url), "utf8");
    const document = prepareBeamerDocument(source);
    const numbered = await document.renderFrame({ frameIndex: 1 });
    const numberedTrace = buildNativeBeamerPageTrace(numbered, computerModernTexMetricProvider);
    expect(numbered.diagnostics).toEqual([]);
    expect(numberedTrace.lines.map(line => line.text)).toEqual(["Before.", "Figure1:Alphaplot.", "Unnumberedaside.", "Figure2:Betaplot.", "After."]);
    expect(numberedTrace.lines.at(-1)!.x).toBeCloseTo(numberedTrace.lines[0].x, 5);
    const long = await document.renderFrame({ frameIndex: 2 });
    const longTrace = buildNativeBeamerPageTrace(long, computerModernTexMetricProvider);
    expect(long.diagnostics).toEqual([]);
    const captionLines = longTrace.lines.slice(1, -1);
    expect(captionLines.length).toBeGreaterThan(1);
    expect(captionLines.every(line => Math.abs(line.x - longTrace.lines[0].x) < .001)).toBe(true);
    expect(captionLines.every(line => line.glyphs.every(glyph => glyph.fontSize === 10))).toBe(true);
    for (const [index, baseline] of [13.410202, 51.410172, 63.410172, 75.410172, 105.010178].entries()) {
      expect(Math.abs(longTrace.lines[index].baselineY - baseline)).toBeLessThan(.01);
    }
  });

  it("recognizes the subcaption package and selects the class's small caption font", async () => {
    for (const [file, fontSize] of [["package-subcaption", 10], ["package-class14", 12]] as const) {
      const source = readFileSync(new URL(`./fixtures/beamer/captions-fidelity/${file}.tex`, import.meta.url), "utf8");
      const result = await prepareBeamerDocument(source).renderFrame();
      const trace = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
      expect(result.diagnostics).toEqual([]);
      expect(trace.lines[1].glyphs.every(glyph => glyph.fontSize === fontSize)).toBe(true);
      expect(trace.lines[1].x).toBeGreaterThan(trace.lines[0].x);
      expect(trace.lines.at(-1)!.x).toBeCloseTo(trace.lines[0].x, 5);
    }
  });

  it("preserves authored starred-caption ranges and contains stars without a supplying package", () => {
    const float = String.raw`\begin{figure}\rule{20pt}{10pt}\caption*{Authored caption}\end{figure}`;
    const source = String.raw`\documentclass{beamer}\usepackage{caption}` + float;
    const mapped = projectBeamerCaptions(createIdentityMappedText(float, source.indexOf(float)), source, undefined, { widthPt: 100, measure: () => 50 });
    const start = mapped.text.indexOf("Authored caption");
    expect(projectInputRange(mapped.sourceMap, start, start + 16)).toMatchObject({ kind: "source-range", from: source.indexOf("Authored caption"), to: source.indexOf("Authored caption") + 16 });
    expect(projectBeamerCaptions(createIdentityMappedText(float, 0), float).text).toContain(String.raw`\caption*{Authored caption}`);
  });

  it("builds a zero-paint strut from the selected baseline and suppresses only the next interline glue", () => {
    const strut = layoutSimpleTexParagraph(String.raw`\fontsize{10pt}{12pt}\selectfont\strut{}Alpha\strut`, { width: texLength(100) });
    expect(strut.supported).toBe(true);
    expect(strut.report!.lines[0].ascent).toBeCloseTo(8.399963, 6);
    expect(strut.report!.lines[0].descent).toBeCloseTo(3.600037, 6);
    expect(strut.report!.lines[0].segments.filter(segment => segment.kind === "math").every(segment => !segment.mathSvgBody?.includes("<rect"))).toBe(true);
    const spacedStrut = layoutSimpleTexParagraph(String.raw`\fontsize{10pt}{12pt}\selectfont\strut Alpha\strut`, { width: texLength(100) });
    expect(spacedStrut.report!.lines[0].naturalWidth).toBeCloseTo(strut.report!.lines[0].naturalWidth, 6);
    const noInterline = layoutSimpleTexParagraph(String.raw`Alpha\par\nointerlineskip\vskip2pt Beta\par Gamma`, { width: texLength(100), baselineSkip: 12 });
    expect(noInterline.supported).toBe(true);
    const paragraphs = noInterline.vlistLayout!.paragraphPlacements;
    expect(paragraphs[1].y).toBeCloseTo(paragraphs[0].y + paragraphs[0].metrics.height + paragraphs[0].metrics.depth + 2, 5);
    expect(paragraphs[2].y + paragraphs[2].metrics.height - paragraphs[1].y - paragraphs[1].metrics.height).toBeCloseTo(12, 5);
  });

  it("centers an inner minipage without leaking its alignment to outer paragraphs", () => {
    const result = layoutSimpleTexParagraph(String.raw`Before\par\begin{minipage}[b]{70pt}\centering Alpha\end{minipage}\par After`, { width: texLength(100), tikzTextWidthNode: true, alignment: "ragged-right" });
    expect(result.supported).toBe(true);
    expect(result.report!.lines.map(line => line.xStart)).toEqual([0, 21.8, 0]);
  });

  it("uses a bottom minipage's last line depth for the following interline glue", () => {
    const result = layoutSimpleTexParagraph(String.raw`Before\par\begin{minipage}[b]{40pt}\fontsize{10pt}{12pt}\selectfont\strut{}Alpha Beta Gamma Delta\strut\end{minipage}\par After`, { width: texLength(100), baselineSkip: 12 });
    expect(result.supported).toBe(true);
    const box = result.vlistLayout!.boxReport.items.find(item => item.itemKind === "vbox")!;
    expect(box.height).toBeCloseTo(44.399963, 6);
    expect(box.depth).toBeCloseTo(3.600037, 6);
    const before = result.vlistLayout!.linePlacements.at(-2)!;
    const after = result.vlistLayout!.linePlacements.at(-1)!;
    expect(after.y + result.report!.lines[after.lineIndex].ascent - before.y - result.report!.lines[before.lineIndex].ascent).toBeCloseTo(12, 5);
  });

  it("omits the package separator for an empty numbered caption", async () => {
    const source = String.raw`\documentclass{beamer}\usepackage{caption}\setbeamertemplate{caption}[numbered]\begin{document}\begin{frame}[plain,t]Before.\begin{figure}\rule{40pt}{12pt}\caption{}\end{figure}After.\end{frame}\end{document}`;
    const result = await prepareBeamerDocument(source).renderFrame();
    expect(result.diagnostics).toEqual([]);
    const trace = buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
    expect(trace.lines.map(line => line.text)).toEqual(["Before.", "Figure1", "After."]);
  });

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
