import { describe, expect, it } from "vitest";
import { texLength } from "../packages/core/src/text/tex/coordinates.js";
import { normalizeNodeTextFontSize } from "../packages/core/src/semantic/nodes/normalize-text.js";
import {
  parseSimpleTexParagraphIr,
  simpleTexInlineNodesToTokens,
  type SimpleTexInlineNode,
} from "../packages/core/src/text/tex/ir.js";
import { simpleTexInlineTokensToLayoutItems } from "../packages/core/src/text/tex/layout-inline-items.js";
import { layoutSimpleTexParagraph } from "../packages/core/src/text/tex/layout-simple.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";
import { defaultTexTextFontProfile } from "../packages/core/src/text/tex/fonts/text-profile.js";
import { createTexParagraphRunAdapter } from "../packages/core/src/text/tex/paragraph-runs.js";
import { renderSimpleTexParagraphDebugSvgBody } from "../packages/core/src/text/mathjax-engine.js";

describe("native TeX text styling", () => {
  it("parses scoped and declaration colors with source-backed children", () => {
    const source = String.raw`a \textcolor{red}{bc} {\color{blue}de} f`;
    const ir = parseSimpleTexParagraphIr(source);
    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.map((node) => node.kind)).toContain("color-command");

    const tokens = simpleTexInlineNodesToTokens(
      ir.nodes.filter((node): node is SimpleTexInlineNode =>
        node.kind !== "paragraph-break" && node.kind !== "unsupported-command" &&
        node.kind !== "display-math" && node.kind !== "noindent" &&
        node.kind !== "alignment" && node.kind !== "environment-boundary" &&
        node.kind !== "item" && node.kind !== "vertical-glue" &&
        node.kind !== "vertical-rule" && node.kind !== "penalty" && node.kind !== "box"
      )
    );
    const styled = tokens.filter((token) => token.kind === "text");
    expect(styled.map((token) => [token.text, token.fontState.color])).toEqual([
      ["a", undefined],
      ["bc", "#ff0000"],
      ["de", "#0000ff"],
      ["f", undefined],
    ]);
    expect(styled[1]).toMatchObject({ sourceStart: 18, sourceEnd: 20 });
  });

  it("keeps size declarations scoped and supports explicit fontsize", () => {
    const source = String.raw`a {\small b} c \fontsize{7pt}{8pt}\selectfont d`;
    const ir = parseSimpleTexParagraphIr(source);
    expect(ir.unsupportedCommand).toBe(false);
    const tokens = simpleTexInlineNodesToTokens(ir.nodes as readonly SimpleTexInlineNode[]);
    const text = tokens.filter((token) => token.kind === "text");
    expect(text[0]?.fontState.sizePt).toBeUndefined();
    expect(text[1]?.fontState.sizePt).toBeCloseTo(9.96264 * 0.9, 5);
    expect(text[2]?.fontState.sizePt).toBeUndefined();
    expect(text[3]?.fontState.sizePt).toBeCloseTo(7, 5);
  });

  it("propagates color and point size through layout reports and SVG", () => {
    const source = String.raw`plain \textcolor{red}{red} {\Large large}`;
    const layout = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:styled",
      width: 300,
      hyphenator: { hyphenate: () => [] },
    });
    expect(layout.supported).toBe(true);
    const segments = layout.report?.lines.flatMap((line) => line.segments) ?? [];
    expect(segments.find((segment) => segment.text === "red")?.color).toBe("#ff0000");
    expect(segments.find((segment) => segment.text === "large")?.fontAtPt)
      .toBeCloseTo(9.96264 * 1.44, 5);

    const svg = renderSimpleTexParagraphDebugSvgBody({ text: source, width: 300 });
    expect(svg).toContain('<g fill="#ff0000">');
    expect(svg).toContain("scale(1.43462)");

    const mathSvg = renderSimpleTexParagraphDebugSvgBody({
      text: String.raw`\textcolor{blue}{$x$}`,
      width: 100,
    });
    expect(mathSvg).toContain('<g fill="#0000ff" stroke="#0000ff">');
  });

  it("renders colorbox paints independently while preserving nested foreground styles", () => {
    const svg = renderSimpleTexParagraphDebugSvgBody({
      text: String.raw`\colorbox{yellow}{a \textcolor{blue}{b} $x$} \fcolorbox{red}{white}{c}`,
      width: 300,
    });
    expect(svg).not.toBeNull();
    const body = svg ?? "";

    expect(body).toContain('data-tex-rule="colorbox-background"');
    expect(body).toContain('fill="#ffff00" stroke="none"');
    expect(body).toContain('fill="#ffffff" stroke="none"');
    expect(body.match(/data-tex-rule="boxed-rule"/g)).toHaveLength(4);
    expect(body).toContain('fill="#ff0000" stroke="none"');
    expect(body).toContain('fill="#0000ff" stroke="#0000ff"');
  });

  it("resolves named colors without shifting source spans or following carets", () => {
    const source = String.raw`\textcolor{brand}{inside} \colorbox{paper}{boxed} tail`;
    const layout = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:color-alias-spans",
      width: 300,
      hyphenator: { hyphenate: () => [] },
      colorResolver: {
        cacheKey: "brand=#123456;paper=#fedcba",
        resolve: (name) => ({ brand: "#123456", paper: "#fedcba" })[name] ?? null,
      },
    });
    const segments = layout.report?.lines.flatMap((line) => line.segments) ?? [];
    const inside = segments.find((segment) => segment.kind === "text" && segment.text === "inside");
    const box = segments.find((segment) => segment.kind === "math" && segment.sourceKind === "text");
    const tail = segments.find((segment) => segment.kind === "text" && segment.text === "tail");
    const boxStart = source.indexOf(String.raw`\colorbox`);
    const boxEnd = boxStart + String.raw`\colorbox{paper}{boxed}`.length;

    expect(layout.supported).toBe(true);
    expect(inside).toMatchObject({
      sourceStartRaw: source.indexOf("inside"),
      sourceEndRaw: source.indexOf("inside") + "inside".length,
      color: "#123456",
    });
    expect(box).toMatchObject({ sourceStartRaw: boxStart, sourceEndRaw: boxEnd });
    expect(box?.caretStops).toHaveLength(boxEnd - boxStart + 1);
    expect(tail).toMatchObject({
      sourceStartRaw: source.indexOf("tail"),
      sourceEndRaw: source.length,
    });
  });

  it("only promotes a leading size declaration to the node style", () => {
    expect(normalizeNodeTextFontSize(String.raw`{\small lead {\Large nested}}`, 10)).toEqual({
      text: "lead {\\Large nested}",
      fontSizePt: 9.96264 * 0.9,
    });
    expect(normalizeNodeTextFontSize(String.raw`lead {\small nested}`, 10)).toEqual({
      text: "lead {\\small nested}",
      fontSizePt: 10,
    });
  });

  it("keeps bare typewriter declarations on the native path", () => {
    const ir = parseSimpleTexParagraphIr(String.raw`{\ttfamily code} and {\tt legacy}`);
    expect(ir.unsupportedCommand).toBe(false);
    const tokens = simpleTexInlineNodesToTokens(ir.nodes as readonly SimpleTexInlineNode[]);
    expect(tokens.filter((token) => token.text === "code" || token.text === "legacy")
      .every((token) => token.fontState.family === "typewriter")).toBe(true);
  });

  it("lowers standard TeX prose spelling to source-backed native text", () => {
    const source = String.raw`\%\&\_\#\$\{\} \textbackslash{} ` +
      "``quoted'' -- --- " + String.raw`\ldots\ text~tie`;
    const ir = parseSimpleTexParagraphIr(source);
    expect(ir.unsupportedCommand).toBe(false);
    const tokens = simpleTexInlineNodesToTokens(ir.nodes as readonly SimpleTexInlineNode[]);
    expect(tokens.filter((token) => token.kind === "text").map((token) => token.text).join(""))
      .toBe("%&_#${}\\“quoted”–—…texttie");
    const tie = tokens.find((token) => token.nonBreaking);
    expect(tie).toMatchObject({ kind: "space", text: " ", sourceStart: source.indexOf("~") });
    expect(tokens.some((token) => token.literal)).toBe(false);

    const svg = renderSimpleTexParagraphDebugSvgBody({ text: source, width: 300 });
    expect(svg).not.toContain("data-tex-literal");
  });

  it("keeps TeX ties as stretchable interword glue without a break opportunity", () => {
    const source = String.raw`left~right`;
    const ir = parseSimpleTexParagraphIr(source);
    const tokens = simpleTexInlineNodesToTokens(ir.nodes as readonly SimpleTexInlineNode[]);
    const items = simpleTexInlineTokensToLayoutItems({
      tokens,
      atPt: texLength(10),
      metricProvider: computerModernTexMetricProvider,
      spaceGlueProfile: "font",
      textFontProfile: defaultTexTextFontProfile,
      trimEdges: false,
    });
    const runs = createTexParagraphRunAdapter(
      computerModernTexMetricProvider.resolveFont(),
      computerModernTexMetricProvider
    ).layoutItemsToRuns(items).runs;
    const tie = runs.find((run) => run.kind === "space");
    expect(tie?.kind).toBe("space");
    if (tie?.kind !== "space") throw new Error("Expected a TeX tie space run.");
    expect(tie.texGlue).toMatchObject({ breakPenalty: 10_000 });
    expect(tie.texGlue?.stretch).toBeGreaterThan(0);
    expect(tie.texGlue?.shrink).toBeGreaterThan(0);
  });

  it("renders ensuremath, text super/subscripts, and prose underline natively", () => {
    const source = String.raw`Area\textsuperscript{2} H\textsubscript{2}O \underline{under} \ensuremath{x^2}`;
    const ir = parseSimpleTexParagraphIr(source);
    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.filter((node) => node.kind === "raisebox")).toMatchObject([
      { relativeLiftEm: 0.45, childFontScale: 0.7, content: "2" },
      { relativeLiftEm: -0.2, childFontScale: 0.7, content: "2" },
    ]);
    expect(ir.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "mbox", command: "underline", content: "under" }),
      expect.objectContaining({ kind: "math", content: "x^2" }),
    ]));

    const svg = renderSimpleTexParagraphDebugSvgBody({ text: source, width: 300 });
    expect(svg).toContain('data-tex-rule="underline-rule"');
    expect(svg).toContain('data-tex-inline-math="true"');
    expect(svg).not.toContain("data-tex-literal");
  });

  it("supports Latin Extended-A and common normalized accent clusters", () => {
    const source = "ŷŶ ũŨ ẽẼ ĩĨ i\u0303";
    const ir = parseSimpleTexParagraphIr(source);
    expect(ir.unsupportedCommand).toBe(false);
    const svg = renderSimpleTexParagraphDebugSvgBody({ text: source, width: 300 });
    expect(svg).not.toContain("data-tex-literal");
    expect(svg).toContain("data-tex-glyph=\"7869\"");
  });
});
