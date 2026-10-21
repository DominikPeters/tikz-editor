import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { parseSimpleTexInlineNodes, parseSimpleTexParagraphIr, simpleTexInlineNodesToTokens } from "../packages/core/src/text/tex/ir.js";
import { layoutTexTabularBox } from "../packages/core/src/text/tex/tabular/layout.js";
import { parseTexTabular, parseTexTabularPreamble } from "../packages/core/src/text/tex/tabular/parser.js";
import { computerModernTexMetricProvider, luaLatexDefaultTextFontProfile, texLength, renderTexParagraphSvgBody, layoutSimpleTexParagraph } from "../packages/core/src/text/tex/index.js";
import type { TexMathHListItem } from "../packages/core/src/text/tex/math/layout.js";

const atPt = texLength(10.95);
const textProfile = { ...luaLatexDefaultTextFontProfile, defaultFontState: { ...luaLatexDefaultTextFontProfile.defaultFontState, family: "sans" as const } };
function tableBox(source: string, size = atPt) {
  const table = simpleTexInlineNodesToTokens(parseSimpleTexInlineNodes(source).nodes, textProfile.defaultFontState).find((node) => node.kind === "tabular");
  if (table?.kind !== "tabular" || !table.table) throw new Error("Expected a source-backed tabular node.");
  return layoutTexTabularBox({ table: table.table, source, sourceStart: 0, sourceEnd: source.length, atPt: size, fontState: table.fontState, metricProvider: computerModernTexMetricProvider, textFontProfile: textProfile, spaceGlueProfile: "font", tabularProfile: { baselineSkipPt: size === 10 ? 12 : 13.6, booktabsFontSizePt: 10.95, booktabsXHeightPt: 4.8618 } });
}
function glyphs(items: readonly TexMathHListItem[]): { text: string; x: number; y: number; from: number; to: number }[] {
  return items.flatMap((item) => item.kind === "glyph" ? [{ text: item.text, x: Number(item.x), y: Number(item.y), from: item.sourceSpan.start, to: item.sourceSpan.end }] : item.kind === "hlist" ? glyphs(item.items).map((g) => ({ ...g, x: g.x + item.x, y: g.y + item.y })) : []);
}

describe("source-backed LaTeX tabular and booktabs boxes", () => {
  it("uses LuaLaTeX struts and the text-style math axis for c/t/b boxes", () => {
    // Goldens from stock Beamer11pt + Latin Modern LuaLaTeX, not inferred from renderer output.
    const centered = tableBox(String.raw`\begin{tabular}{lr}A&B\\C&D\end{tabular}`);
    expect(centered.width).toBeCloseTo(39.20958, 4);
    expect(centered.height).toBeCloseTo(16.33748, 4);
    expect(centered.depth).toBeCloseTo(10.86250, 4);
    const top = tableBox(String.raw`\begin{tabular}[t]{lr}A&B\\C&D\end{tabular}`);
    expect(top.height).toBeCloseTo(9.51996, 4);
    expect(top.depth).toBeCloseTo(17.68002, 4);
    const bottom = tableBox(String.raw`\begin{tabular}[b]{lr}A&B\\C&D\end{tabular}`);
    expect(bottom.height).toBeCloseTo(23.11995, 4);
    expect(bottom.depth).toBeCloseTo(4.08003, 4);
  });
  it("keeps package-load booktabs lengths when the table font becomes small", () => {
    const source = String.raw`\begin{tabular}{lr}\toprule A&B\\\midrule C&D\\\bottomrule\end{tabular}`;
    const normal = tableBox(source);
    const small = tableBox(source, texLength(10));
    const rules = (box: typeof normal) => box.hlist!.items.filter((item) => item.kind === "rule");
    expect(rules(normal).map((rule) => rule.height)).toEqual(rules(small).map((rule) => rule.height));
    expect(normal.height + normal.depth).toBeCloseTo(39.70919, 3);
    expect(small.height + small.depth).toBeCloseTo(36.50921, 3);
  });
  it("fixes register em lengths when assigned before later size changes", () => {
    const table = String.raw`\begin{tabular}{lr}A&B\\C&D\end{tabular}`;
    const normalThenSmall = tableBox(String.raw`\setlength{\tabcolsep}{1em}\fontsize{10pt}{12pt}\selectfont` + table);
    expect(normalThenSmall.width - tableBox(table, texLength(10)).width).toBeCloseTo(4 * (10.95 - 6), 4);
    const smallThenNormal = tableBox(String.raw`\fontsize{10pt}{12pt}\selectfont\setlength{\tabcolsep}{1em}\fontsize{10.95pt}{13.6pt}\selectfont` + table);
    expect(smallThenNormal.width - tableBox(table).width).toBeCloseTo(4 * (10 - 6), 4);
  });
  it("retains assigned column padding through normal and legacy font resets", () => {
    const table = String.raw`\begin{tabular}{lr}Alpha&1\\Beta&22\end{tabular}`;
    const assignment = String.raw`\setlength{\tabcolsep}{10pt}`;
    for (const command of ["normalfont", "it", "bf", "rm", "sf", "sl", "sc", "tt"]) {
      const selected = `\\${command} ${table}`;
      expect(tableBox(assignment + selected).width - tableBox(selected).width, command).toBeCloseTo(4 * (10 - 6), 4);
    }
    const selected = String.raw`\textnormal{` + table + "}";
    expect(tableBox(assignment + selected).width - tableBox(selected).width).toBeCloseTo(4 * (10 - 6), 4);
  });
  it("keeps adjacent trimmed cmidrules on one rule row", () => {
    const box = tableBox(String.raw`\begin{tabular}{lcr}Alpha&Beta&Gamma\\\cmidrule(lr){1-2}\cmidrule(l{2pt}r{3pt}){3-3}One&Two&Three\end{tabular}`);
    const rules = box.hlist!.items.filter((item) => item.kind === "rule");
    expect(rules).toHaveLength(2);
    expect(rules[0].y).toBeCloseTo(rules[1].y, 6);
    expect(rules[0].x).toBeCloseTo(5.47499, 4);
    expect(rules[1].width).toBeGreaterThan(0);
    expect(box.height + box.depth).toBeCloseTo(32.63331, 3);
  });
  it("centers zero-width kernel vertical rules on both outer table edges", () => {
    const box = tableBox(String.raw`\begin{tabular}{|l|r|}Alpha&1\\Beta&22\end{tabular}`);
    const rules = box.hlist!.items.filter((item) => item.kind === "rule");
    expect(rules).toHaveLength(6);
    for (const rule of [rules[0], rules[3]]) expect(rule.x + rule.width / 2).toBeCloseTo(0, 5);
    for (const rule of [rules[2], rules[5]]) expect(rule.x + rule.width / 2).toBeCloseTo(box.width, 5);
  });
  it("splits cells outside braces, escaped separators, comments and nested tables", () => {
    const source = String.raw`\begin{tabular}{lc}{Alpha \& Beta}&\begin{tabular}{c}One\\Two\end{tabular}\\ Gamma&3\end{tabular}`;
    const node = parseSimpleTexParagraphIr(source).nodes[0];
    expect(node.kind).toBe("tabular");
    if (node.kind !== "tabular") return;
    const rows = node.table.items.filter((item) => item.kind === "row");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.cells.length)).toEqual([2, 2]);
    expect(rows[0].cells[1].text).toBe(String.raw`\begin{tabular}{c}One\\Two\end{tabular}`);
    expect(tableBox(source).hlist).toBeTruthy();
    const commented = String.raw`\begin{tabular}{lr}Alpha% & ignored` + "\n" + String.raw`&1\\Beta&2\end{tabular}`;
    expect(tableBox(commented).hlist).toBeTruthy();
  });
  it("preserves exact source ownership for every cell glyph", () => {
    const source = String.raw`\begin{tabular}{lr}Alpha & 1\\ Beta & 22\end{tabular}`;
    const box = tableBox(source);
    for (const glyph of glyphs(box.hlist!.items)) expect(source.slice(glyph.from, glyph.to)).toBe(glyph.text);
    expect(box.sourceStart).toBe(0);
    expect(box.sourceEnd).toBe(source.length);
    expect(box.caretMap?.entries.length).toBeGreaterThan(0);
    const beta = source.indexOf("Beta");
    const betaCaret = box.caretMap!.entries.find((entry) => entry.sourceOffset === beta)!;
    const alphaCaret = box.caretMap!.entries.find((entry) => entry.sourceOffset === source.indexOf("Alpha"))!;
    expect(betaCaret.y - alphaCaret.y).toBeCloseTo(13.6, 4);
    const wrapped = tableBox(String.raw`\begin{tabular}{p{35pt}r}Alpha Beta Gamma Delta&1\end{tabular}`);
    const wrappedSource = wrapped.source;
    expect(wrapped.caretMap!.entries.some((entry) => wrappedSource.slice(entry.sourceSpan!.start, entry.sourceSpan!.end) === "G")).toBe(true);
    expect(wrapped.caretMap!.entries.find((entry) => entry.sourceOffset === wrappedSource.indexOf("Gamma"))!.y).toBeGreaterThan(wrapped.caretMap!.entries.find((entry) => entry.sourceOffset === wrappedSource.indexOf("Alpha"))!.y);
  });
  it("keeps inserted and repeated preamble glyphs owned by their authored declarations", () => {
    for (const source of [
      String.raw`\begin{tabular}{l@{ : }r}Alpha&1\\Beta&2\end{tabular}`,
      String.raw`\begin{tabular}{*{2}{>{Hello}l<{End}}}Alpha&Beta\\Gamma&Delta\end{tabular}`,
      String.raw`\begin{tabular}{>{Hello}p{80pt}<{End}}Alpha Beta\end{tabular}`,
      String.raw`\begin{tabular}{lr}\multicolumn{2}{>{Hello}c<{End}}{Heading}\end{tabular}`,
    ]) {
      const box = tableBox(source);
      for (const glyph of glyphs(box.hlist!.items)) expect(source.slice(glyph.from, glyph.to), glyph.text).toBe(glyph.text);
      for (const entry of box.caretMap!.entries) expect(entry.sourceOffset).toBeGreaterThanOrEqual(entry.sourceSpan!.start);
    }
  });
  it("contains unsupported or malformed column specifications as source literals", () => {
    const source = String.raw`Before \begin{tabular}{X}Alpha & Beta\end{tabular} after.`;
    const ir = parseSimpleTexParagraphIr(source);
    const literal = ir.nodes.find((node) => node.kind === "literal");
    expect(literal?.text).toBe(String.raw`\begin{tabular}{X}Alpha & Beta\end{tabular}`);
    expect(ir.nodes.some((node) => node.kind === "tabular")).toBe(false);
    const siunitx = parseSimpleTexParagraphIr(String.raw`Before \begin{tabular}{lS}Alpha & 1\end{tabular} after.`);
    expect(siunitx.nodes.find((node) => node.kind === "literal")?.text).toBe(String.raw`\begin{tabular}{lS}Alpha & 1\end{tabular}`);
    expect(siunitx.nodes.filter((node) => node.kind === "text").map((node) => node.text).join(" ")).toContain("after.");
    expect(() => parseTexTabularPreamble("p")).toThrow("width");
    expect(() => parseTexTabular("{lr}A&B", 0, 7)).not.toThrow();
  });
  it("retains unsupported LR cell material and surrounding source instead of filtering it out", () => {
    const source = String.raw`Before \begin{tabular}{l}A\parbox{30pt}{MissingText}B\end{tabular} after.`;
    const ir = parseSimpleTexParagraphIr(source);
    const literal = ir.nodes.find((node) => node.kind === "literal");
    expect(literal?.text).toContain("MissingText");
    expect(literal?.text).toContain(String.raw`\begin{tabular}`);
    expect(ir.nodes.filter((node) => node.kind === "text").map((node) => node.text).join(" ")).toContain("Before");
    expect(ir.nodes.filter((node) => node.kind === "text").map((node) => node.text).join(" ")).toContain("after.");
    const font = textProfile.resolveTextFont(textProfile.defaultFontState, atPt, computerModernTexMetricProvider);
    const layout = layoutSimpleTexParagraph(source, { width: 300, font, textFontProfile: textProfile, metricProvider: computerModernTexMetricProvider });
    expect(layout.report?.lines.flatMap((line) => line.segments).map((segment) => segment.text).join(" ")).toContain("MissingText");
    expect(layout.report?.lines.flatMap((line) => line.segments).some((segment) => segment.literal?.reason === "unsupported-command")).toBe(true);
  });
  it("preserves unsupported paragraph displays and multicolumn inserts as explicit source literals", () => {
    for (const table of [String.raw`\begin{tabular}{p{50pt}}\[x=1\]\end{tabular}`, String.raw`\begin{tabular}{p{50pt}}\begin{itemize}\item Item\end{itemize}\end{tabular}`, String.raw`\begin{tabular}{lr}\multicolumn{2}{@{Start}c@{End}}{Heading}\end{tabular}`, String.raw`\begin{tabular}{>{\parbox{30pt}{MissingText}}l}Alpha\end{tabular}`]) {
      const source = `Before ${table} after.`;
      const ir = parseSimpleTexParagraphIr(source);
      expect(ir.nodes.find((node) => node.kind === "literal")?.text).toBe(table);
      expect(ir.nodes.filter((node) => node.kind === "text").map((node) => node.text).join(" ")).toContain("after.");
    }
  });
  it("paints real glyph paths and rule rectangles through the shared paragraph backend", () => {
    const source = String.raw`\begin{tabular}{lr}\toprule Alpha&1\\\midrule Beta&22\\\bottomrule\end{tabular}`;
    const font = luaLatexDefaultTextFontProfile.resolveTextFont(luaLatexDefaultTextFontProfile.defaultFontState, atPt, computerModernTexMetricProvider);
    const layout = layoutSimpleTexParagraph(source, { width: 300, font, textFontProfile: luaLatexDefaultTextFontProfile, metricProvider: computerModernTexMetricProvider, tabularProfile: { baselineSkipPt: 13.6 } });
    expect(layout.supported).toBe(true);
    const svg = renderTexParagraphSvgBody(layout.report!, { lineHeightPt: texLength(13.6), metricProvider: computerModernTexMetricProvider, vlistLayout: layout.vlistLayout });
    expect(svg).toContain('data-tex-rule="array-rule"');
    expect(svg).toContain('data-tex-glyph="65"');
    expect(layout.report!.errors).toEqual([]);
  });
  it("covers every original matrix frame with native glyphs and no placeholders", async () => {
    const root = new URL("./fixtures/beamer/tables/", import.meta.url);
    const source = readFileSync(new URL("tables.tex", root), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("cases.json", root), "utf8")) as { fidelity: { id: string; frame: number; file: string }[] };
    expect(scanBeamerDocument(source).frames).toHaveLength(manifest.fidelity.filter((fixture) => fixture.file === "tables.tex").length);
    const prepared = new Map(manifest.fidelity.map((fixture) => [fixture.file, prepareBeamerDocument(readFileSync(new URL(fixture.file, root), "utf8"))]));
    for (const fixture of manifest.fidelity) {
      const render = await prepared.get(fixture.file)!.renderFrame({ frameIndex: fixture.frame - 1, step: 1 });
      expect(render.layout.items.filter((item) => item.kind === "unsupported"), fixture.id).toEqual([]);
      expect(render.layout.paragraphs.length, fixture.id).toBeGreaterThan(0);
      expect(render.svg.svg, fixture.id).toContain("data-tex-math-hlist");
    }
  }, 30000);
});
