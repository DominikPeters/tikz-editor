import { describe, expect, it } from "vitest";
import { normalizeNodeTextFontSize } from "../packages/core/src/semantic/nodes/normalize-text.js";
import {
  parseSimpleTexParagraphIr,
  simpleTexInlineNodesToTokens,
  type SimpleTexInlineNode,
} from "../packages/core/src/text/tex/ir.js";
import { layoutSimpleTexParagraph } from "../packages/core/src/text/tex/layout-simple.js";
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
});
