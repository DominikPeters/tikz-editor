import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { collectSimpleTexResourceManifest, parseSimpleTexInlineNodes, parseSimpleTexParagraphIr, simpleTexInlineNodesToTokens } from "../packages/core/src/text/tex/ir.js";
import { computerModernTexMetricProvider, luaLatexDefaultTextFontProfile, texLength } from "../packages/core/src/text/tex/index.js";
import { layoutTexTransformBox } from "../packages/core/src/text/tex/text-box-transform.js";

const atPt = texLength(10.95);
const textProfile = { ...luaLatexDefaultTextFontProfile, defaultFontState: { ...luaLatexDefaultTextFontProfile.defaultFontState, family: "sans" as const } };
function transformBox(source: string) {
  const token = simpleTexInlineNodesToTokens(parseSimpleTexInlineNodes(source).nodes, textProfile.defaultFontState).find((item) => item.kind === "transform-box");
  if (!token?.transformBox) throw new Error("Expected a transform node.");
  return layoutTexTransformBox({ node: token.transformBox, fontState: token.fontState, atPt, metricProvider: computerModernTexMetricProvider, textFontProfile: textProfile, spaceGlueProfile: "font", tabularProfile: { baselineSkipPt: 13.6 } });
}

describe("graphicx source-backed text boxes", () => {
  it("uses graphicx box extents for rotation, scaling and reflection", () => {
    // LuaLaTeX/Beamer 11pt goldens from the stock graphics.sty box macros.
    const cases = [
      [String.raw`\rotatebox{90}{Alpha gp}`, 9.85501, 41.29245, 0],
      [String.raw`\scalebox{.8}{Alpha gp}`, 33.03407, 6.07945, 1.80457],
      [String.raw`\reflectbox{Alpha gp}`, 41.29245, 7.5993, 2.2557],
      [String.raw`\scalebox{-1}[-1]{Alpha gp}`, 41.29245, 2.2557, 7.5993],
    ] as const;
    for (const [source, width, height, depth] of cases) {
      const box = transformBox(source);
      expect(box.width, source).toBeCloseTo(width, 4);
      expect(box.height, source).toBeCloseTo(height, 4);
      expect(box.depth, source).toBeCloseTo(depth, 4);
    }
  });
  it("reproduces graphics.sty's integer resize divider and starred total height", () => {
    for (const [source, width, height, depth] of [
      [String.raw`\resizebox{70pt}{!}{Alpha gp}`, 70.0055, 12.88353, 3.82422],
      [String.raw`\resizebox{-70pt}{!}{Alpha gp}`, 70.49884, 3.85118, 12.97433],
      [String.raw`\resizebox{!}{12pt}{Alpha gp}`, 65.21, 12.00099, 3.56226],
      [String.raw`\resizebox*{!}{18pt}{Alpha gp}`, 75.43105, 13.88203, 4.1206],
    ] as const) {
      const box = transformBox(source);
      expect(box.width, source).toBeCloseTo(width, 4);
      expect(box.height, source).toBeCloseTo(height, 4);
      expect(box.depth, source).toBeCloseTo(depth, 4);
    }
  });
  it("retains minipage paragraph composition and c/t/b baselines", () => {
    for (const [option, height, depth] of [["", 11.57204, 7.19203], ["[t]", 6.07945, 12.68462], ["[b]", 16.9595, 1.80457]] as const) {
      const box = transformBox(String.raw`\scalebox{.8}{\begin{minipage}` + option + String.raw`{160pt}Alpha paragraph.\par Beta paragraph.\end{minipage}}`);
      expect(box.width).toBeCloseTo(128.00049, 4);
      expect(box.height).toBeCloseTo(height, 4);
      expect(box.depth).toBeCloseTo(depth, 4);
      expect(box.svgBody).toContain('data-line-index="1"');
    }
    const source = String.raw`\fontsize{10.95pt}{20pt}\selectfont\scalebox{.8}{\begin{minipage}{160pt}Alpha paragraph.\par Beta paragraph.\end{minipage}}`;
    const box = transformBox(source);
    const alpha = box.caretMap!.entries.find(entry => entry.sourceOffset === source.indexOf("Alpha"))!;
    const beta = box.caretMap!.entries.find(entry => entry.sourceOffset === source.indexOf("Beta"))!;
    expect(beta.y - alpha.y).toBeCloseTo(16, 4);
  });
  it("inventories graphics resources inside transformed paragraph and inline content", () => {
    const source = String.raw`\scalebox{.8}{\begin{minipage}{80pt}\includegraphics{one.png}\end{minipage}}\rotatebox{30}{\includegraphics{two.png}}`;
    const graphics = collectSimpleTexResourceManifest(parseSimpleTexParagraphIr(source)).graphics;
    expect(graphics.map(resource => resource.filename)).toEqual(["one.png", "two.png"]);
    for (const resource of graphics) expect(source.slice(resource.filenameStart, resource.filenameEnd)).toBe(resource.filename);
  });
  it("transforms carets while retaining their authored glyph source", () => {
    const source = String.raw`\rotatebox{90}{Alpha}`;
    const box = transformBox(source);
    const entries = box.caretMap!.entries;
    const first = entries.find((entry) => entry.sourceOffset === source.indexOf("Alpha"))!;
    const second = entries.find((entry) => entry.sourceOffset === source.indexOf("Alpha") + 1)!;
    expect(first.x).toBeCloseTo(second.x, 6);
    expect(first.y).toBeGreaterThan(second.y);
    for (const entry of entries) {
      expect(source.slice(entry.sourceSpan!.start, entry.sourceSpan!.end)).toHaveLength(1);
      expect(entry.hitBounds.xEnd).toBeGreaterThan(entry.hitBounds.xStart);
      expect(entry.sourceOffset).toBeGreaterThanOrEqual(entry.sourceSpan!.start);
      expect(entry.sourceOffset).toBeLessThanOrEqual(entry.sourceSpan!.end);
    }
    const nested = String.raw`\rotatebox{90}{\scalebox{.8}{Alpha}}`;
    const nestedBox = transformBox(nested);
    expect(nestedBox.caretMap!.entries.find((entry) => entry.sourceOffset === nested.indexOf("Alpha"))).toBeDefined();
  });
  it("contains unsupported transform content and arguments without losing sibling source", () => {
    for (const command of [String.raw`\scalebox{}{Missing}`, String.raw`\scalebox{.8}[]{Missing}`, String.raw`\rotatebox{ninety}{Missing}`, String.raw`\rotatebox[origin=bad]{90}{Missing}`, String.raw`\scalebox{.8}{\[x=1\]}`, String.raw`\scalebox{.8}{\begin{minipage}[c][40pt]{80pt}Missing\end{minipage}}`]) {
      const ir = parseSimpleTexParagraphIr(`Before ${command} After.`);
      expect(ir.nodes.find((node) => node.kind === "literal")?.text).toBe(command);
      expect(ir.nodes.filter((node) => node.kind === "text").map((node) => node.text).join(" ")).toContain("After.");
    }
    const unknown = parseSimpleTexParagraphIr(String.raw`\scalebox{.8}{\unknown{Missing}}`).nodes[0];
    expect(unknown.kind).toBe("transform-box");
    if (unknown.kind === "transform-box") expect(unknown.children[0]).toMatchObject({ kind: "literal", text: String.raw`\unknown{Missing}`, reason: "unsupported-command" });
  });
  it("renders the focused matrix using shared glyph paths without placeholders", async () => {
    const root = new URL("./fixtures/beamer/transforms/", import.meta.url);
    const prepared = prepareBeamerDocument(readFileSync(new URL("transforms.tex", root), "utf8"));
    const manifest = JSON.parse(readFileSync(new URL("cases.json", root), "utf8")) as { fidelity: { id: string; frame: number }[] };
    for (const fixture of manifest.fidelity) {
      const result = await prepared.renderFrame({ frameIndex: fixture.frame - 1, step: 1 });
      expect(result.layout.items.filter((item) => item.kind === "unsupported"), fixture.id).toEqual([]);
      expect(result.svg.svg, fixture.id).toContain("data-tex-transform");
      expect(result.svg.svg, fixture.id).toContain('data-tex-glyph="65"');
    }
  });
});
