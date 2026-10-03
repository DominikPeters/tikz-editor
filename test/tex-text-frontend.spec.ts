import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { analyzeSimpleTexParagraph, parseSimpleTexInlineNodes, parseSimpleTexParagraphIr, simpleTexInlineNodesToTokens } from "../packages/core/src/text/tex/ir.js";
import { computerModernTexMetricProvider, luaLatexDefaultTextFontProfile, texLength } from "../packages/core/src/text/tex/index.js";
import { layoutTexTabularBox } from "../packages/core/src/text/tex/tabular/layout.js";
import { buildNativeBeamerPageTrace } from "../scripts/lib/beamer-frame-compare.mjs";

async function trace(body: string) {
  const source = String.raw`\documentclass{beamer}\begin{document}\begin{frame}[plain,t]` + "\n" + body + "\n" + String.raw`\end{frame}\end{document}`;
  const result = await prepareBeamerDocument(source).renderFrame();
  expect(result.diagnostics).toEqual([]);
  expect(result.svg.svg).not.toContain("data-tex-literal=");
  return buildNativeBeamerPageTrace(result, computerModernTexMetricProvider);
}

function tableBoxes(source: string) {
  const profile = { ...luaLatexDefaultTextFontProfile, defaultFontState: { ...luaLatexDefaultTextFontProfile.defaultFontState, family: "sans" as const } };
  return simpleTexInlineNodesToTokens(parseSimpleTexInlineNodes(source).nodes, profile.defaultFontState).filter(token => token.kind === "tabular").map(token => {
    if (!token.table) throw new Error("Missing table.");
    return layoutTexTabularBox({ table: token.table, source, sourceStart: token.sourceStart, sourceEnd: token.sourceEnd, fontState: token.fontState, metricProvider: computerModernTexMetricProvider, atPt: texLength(10.95), textFontProfile: profile, spaceGlueProfile: "font", tabularProfile: { baselineSkipPt: 13.6 } });
  });
}

describe("TeX source whitespace, local list registers and stock URL breaks", () => {
  it("paints tab-indented tables exactly like spaces while preserving authored cell spans", async () => {
    const source = "\\begin{block}{Values}\n\\begin{tabular}{lr}\n\tAlpha&12\\\\\n\tBeta&345\\\\\n\\end{tabular}\n\\end{block}";
    const tabs = await trace(source);
    const spaces = await trace(source.replaceAll("\t", " "));
    expect(tabs.glyphs).toEqual(spaces.glyphs);
    expect(tabs.rectangles).toEqual(spaces.rectangles);
    const table = parseSimpleTexParagraphIr(source.slice(source.indexOf("\\begin{tabular}"), source.indexOf("\\end{tabular}") + "\\end{tabular}".length)).nodes[0];
    expect(table.kind).toBe("tabular");
    if (table.kind === "tabular") for (const item of table.table.items) if (item.kind === "row") for (const cell of item.cells) expect(table.text.slice(cell.sourceStart, cell.sourceEnd)).toBe(cell.text);
  });
  it("accepts CRLF source whitespace but keeps genuinely unsupported control characters contained", () => {
    expect(analyzeSimpleTexParagraph("Alpha\r\n\tBeta", 100).fallbackReason).toBeNull();
    expect(analyzeSimpleTexParagraph("Alpha\u0001Beta", 100).fallbackReason).toContain("U+1");
  });
  it("executes numeric def and starred renewcommand arraystretch with ordinary group scoping", () => {
    const table = String.raw`\begin{tabular}{lr}Alpha&12\\Beta&345\\Gamma&6\end{tabular}`;
    for (const declaration of [String.raw`\def\arraystretch{1.5}`, String.raw`\def \arraystretch {.5}`, String.raw`\renewcommand*{\arraystretch}{1.5}`]) {
      const boxes = tableBoxes("{" + declaration + table + "}" + table);
      const stretch = declaration.includes(".5}") && !declaration.includes("1.5}") ? .5 : 1.5;
      const total = boxes[0].height + boxes[0].depth;
      if (stretch === 1.5) expect(total).toBeCloseTo(3 * 13.6 * stretch, 3);
      else {
        // Glyph ascenders/descenders exceed the half-size row strut.
        expect(total).toBeGreaterThan(3 * 13.6 * stretch);
        expect(total).toBeLessThan(3 * 13.6);
      }
      expect(boxes[1].height + boxes[1].depth).toBeCloseTo(3 * 13.6, 3);
    }
    const unsupportedDefinition = parseSimpleTexParagraphIr(String.raw`\def\arraystretch#1{#1}`);
    expect(unsupportedDefinition.nodes.map(node => node.text).join("")).toBe(String.raw`\def\arraystretch#1{#1}`);
    expect(unsupportedDefinition.nodes.some(node => node.kind === "literal")).toBe(true);
    expect(unsupportedDefinition.nodes.some(node => node.kind === "style-declaration")).toBe(false);
  });
  it("consumes register-only list prefixes and uses the assigned item and paragraph glue", async () => {
    const native = await trace(String.raw`\begin{itemize}\setlength{\itemsep}{8pt}\setlength{\parskip}{0pt}\setlength{\parsep}{0pt}\item Alpha\item Beta\end{itemize}`);
    const alpha = native.lines.find(line => line.text === "Alpha")!;
    const beta = native.lines.find(line => line.text === "Beta")!;
    expect(beta.baselineY - alpha.baselineY).toBeCloseTo(21.6, 5);
    expect(native.lines.every(line => !line.text.includes("setlength"))).toBe(true);
  });
  it("keeps parsep and the active parskip distinct after list entry", async () => {
    for (const [assignment, gap] of [[String.raw`\setlength{\parsep}{9pt}`, 16.6], [String.raw`\setlength{\parskip}{2pt}`, 18.6]] as const) {
      const native = await trace(String.raw`\begin{itemize}` + assignment + String.raw`\item Alpha\item Beta\end{itemize}`);
      expect(native.lines.find(line => line.text === "Beta")!.baselineY - native.lines.find(line => line.text === "Alpha")!.baselineY).toBeCloseTo(gap, 5);
    }
  });
  it("retains raw URL glyph ownership and stock punctuation penalties without hyphen breaks", () => {
    const source = String.raw`\url{https://example.org/alpha_beta/foo-bar?a=1&b=2}`;
    const tokens = simpleTexInlineNodesToTokens(parseSimpleTexInlineNodes(source).nodes);
    expect(tokens.filter(token => token.kind === "text").map(token => token.text).join("")).toBe("https://example.org/alpha_beta/foo-bar?a=1&b=2");
    for (const token of tokens.filter(token => token.kind === "text")) expect(source.slice(token.sourceStart, token.sourceEnd)).toBe(token.text);
    const penalties = tokens.filter(token => token.kind === "penalty");
    expect(penalties.map(token => token.penalty)).toContain(500);
    expect(penalties.map(token => token.penalty)).toContain(700);
    expect(penalties.some(token => source[token.sourceStart - 1] === "-")).toBe(false);
    expect(penalties.every(token => token.sourceStart === token.sourceEnd)).toBe(true);
  });
  it("wraps an ordinary long Beamer URL at underscores while retaining its full glyph sequence", async () => {
    const value = "https://example.org/wiki/Metody_numeryczne_fizyki/Aproksymacja/Additional_section";
    const native = await trace(String.raw`More: \url{` + value + "}");
    const lines = native.lines.filter(line => line.role === "body");
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("More:https://example.org/wiki/Metody_numeryczne_");
    expect(lines[1].text).toBe("fizyki/Aproksymacja/Additional_section");
    expect(lines.map(line => line.text).join("")).toBe("More:" + value);
  });
});
