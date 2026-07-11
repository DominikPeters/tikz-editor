import { describe, expect, it } from "vitest";
import {
  analyzeSimpleTexParagraph,
  parseSimpleTexParagraphIr,
  simpleTexInlineNodesToTokens,
  type SimpleTexInlineNode,
  type SimpleTexLiteralNode,
} from "../packages/core/src/text/tex/ir.js";
import { layoutSimpleTexParagraph } from "../packages/core/src/text/tex/layout-simple.js";
import { createTexDerivedInlineMathBoxProvider } from "../packages/core/src/text/tex/math/inline-provider.js";

function literalNodes(nodes: readonly unknown[]): SimpleTexLiteralNode[] {
  return (nodes as SimpleTexInlineNode[]).filter(
    (node): node is SimpleTexLiteralNode => node.kind === "literal"
  );
}

describe("simple TeX literal runs", () => {
  it("parses an unknown command into a literal node instead of rejecting the paragraph", () => {
    const ir = parseSimpleTexParagraphIr("This is a \\tex");
    const literals = literalNodes(ir.nodes);
    expect(literals).toHaveLength(1);
    expect(literals[0]).toMatchObject({
      kind: "literal",
      reason: "unsupported-command",
      text: "\\tex",
      detail: "\\tex",
      sourceStart: 10,
      sourceEnd: 14,
    });
    expect(ir.unsupportedCommand).toBe(false);
  });

  it("keeps an unknown command's balanced arguments inside the literal span", () => {
    const ir = parseSimpleTexParagraphIr("a \\foo{bar baz}[x] b");
    const literals = literalNodes(ir.nodes);
    expect(literals).toHaveLength(1);
    expect(literals[0].text).toBe("\\foo{bar baz}[x]");
    expect(literals[0].detail).toBe("\\foo");
  });

  it("parses unsupported direct characters as single-char literal nodes", () => {
    const ir = parseSimpleTexParagraphIr("50% off & more_stuff");
    const literals = literalNodes(ir.nodes);
    expect(literals.map((node) => node.text)).toEqual(["%", "&", "_"]);
    expect(literals.every((node) => node.reason === "unsupported-character")).toBe(true);
    expect(ir.unsupportedCommand).toBe(false);
  });

  it("parses stray braces and dollars as malformed-input literals", () => {
    const ir = parseSimpleTexParagraphIr("a } b { c $ d");
    const literals = literalNodes(ir.nodes);
    expect(literals.map((node) => node.text)).toEqual(["}", "{", "$"]);
    expect(literals.every((node) => node.reason === "malformed-input")).toBe(true);
  });

  it("no longer reports a fallback reason for unknown commands or direct characters", () => {
    expect(analyzeSimpleTexParagraph("This is a \\tex", 200).fallbackReason).toBeNull();
    expect(analyzeSimpleTexParagraph("50% off & more_stuff", 200).fallbackReason).toBeNull();
  });

  it("supports catalogued accented prose and falls back honestly for missing scripts", () => {
    expect(analyzeSimpleTexParagraph("café", 200).fallbackReason).toBeNull();
    const missingScript = layoutSimpleTexParagraph("漢", {
      width: 200,
      alignment: "ragged-right",
    });
    expect(missingScript.supported).toBe(false);
    expect(missingScript.fallbackReason).toMatch(/no TFM metric/);
  });

  it("lowers literal nodes to typewriter tokens, splitting embedded spaces", () => {
    const ir = parseSimpleTexParagraphIr("\\foo{bar baz}");
    const tokens = simpleTexInlineNodesToTokens(
      ir.nodes.filter((node): node is SimpleTexInlineNode => node.kind === "literal")
    );
    expect(tokens.map((token) => [token.kind, token.text])).toEqual([
      ["text", "\\foo{bar"],
      ["space", " "],
      ["text", "baz}"],
    ]);
    expect(tokens.every((token) => token.fontState.family === "typewriter")).toBe(true);
    expect(tokens.every((token) => token.literal?.reason === "unsupported-command")).toBe(true);
    expect(tokens[0].sourceStart).toBe(0);
    expect(tokens[0].sourceEnd).toBe(8);
    expect(tokens[2].sourceStart).toBe(9);
    expect(tokens[2].sourceEnd).toBe(13);
  });

  it("lays out a paragraph containing an unknown command through the TeX path", () => {
    const result = layoutSimpleTexParagraph("This is a \\tex", {
      paragraphId: "tex:literal-smoke",
      width: 200,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(true);
    const segments = result.report?.lines.flatMap((line) => line.segments) ?? [];
    const literalSegments = segments.filter((segment) => segment.literal);
    expect(literalSegments).toHaveLength(1);
    expect(literalSegments[0]).toMatchObject({
      kind: "text",
      text: "\\tex",
      literal: { reason: "unsupported-command", detail: "\\tex" },
      sourceStartRaw: 10,
      sourceEndRaw: 14,
    });
    expect(literalSegments[0].fontId).toMatch(/mono|tt/);
    expect(literalSegments[0].caretStops?.length).toBe(5);
  });

  it("contains a math span with a parse error as a literal run instead of failing the node", () => {
    const source = String.raw`before $\frac{a}{b$ after`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:literal-math-error",
      width: 300,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    expect(result.supported).toBe(true);
    const segments = result.report?.lines.flatMap((line) => line.segments) ?? [];
    const literalSegments = segments.filter((segment) => segment.literal);
    expect(literalSegments.length).toBeGreaterThan(0);
    expect(literalSegments.every((segment) => segment.literal?.reason === "math-error")).toBe(true);
    const literalText = literalSegments.map((segment) => segment.text).join("");
    expect(literalText).toBe(String.raw`$\frac{a}{b$`);
    const plainTexts = segments
      .filter((segment) => segment.kind === "text" && !segment.literal)
      .map((segment) => segment.text);
    expect(plainTexts).toContain("before");
    expect(plainTexts).toContain("after");
  });

  it("contains math with unknown commands as literal runs (no silent atom drops)", () => {
    for (const source of [
      String.raw`x $\unknowncmd + y$ z`,
      String.raw`x $\frac{\unknowncmd}{b}$ z`,
      String.raw`x $y^{\unknowncmd}$ z`,
      String.raw`x $\sqrt{\unknowncmd}$ z`,
    ]) {
      const result = layoutSimpleTexParagraph(source, {
        paragraphId: `tex:literal-math-unknown-${source.length}`,
        width: 300,
        hyphenator: { hyphenate: () => [] },
        mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      });
      expect(result.supported).toBe(true);
      const segments = result.report?.lines.flatMap((line) => line.segments) ?? [];
      const literalText = segments
        .filter((segment) => segment.literal)
        .map((segment) => segment.text)
        .join(" ");
      const mathSegments = segments.filter((segment) => segment.kind === "math");
      // Either the whole span is contained as a literal run, or it rendered as
      // math — but the unknown command must never silently vanish.
      if (mathSegments.length > 0) {
        throw new Error(
          `Expected literal containment for ${source}, got math segments: ` +
          mathSegments.map((segment) => segment.text).join(", ")
        );
      }
      expect(literalText.replaceAll(" ", "")).toContain("\\unknowncmd");
    }
  });

  it("marks literal runs with data-tex-literal in rendered engine SVG", async () => {
    const target = globalThis as {
      window?: unknown;
      document?: unknown;
      MathJax?: unknown;
    };
    target.window = {};
    target.document = {};
    target.MathJax = {
      tex2svg: () => {
        throw new Error("MathJax should not be needed for literal runs");
      },
      startup: {},
    };
    const { createMathJaxNodeTextEngine } = await import(
      "../packages/core/src/text/mathjax-engine.js"
    );
    const engine = await createMathJaxNodeTextEngine();

    const measured = engine.measure({
      text: "This is a \\tex",
      textWidthPt: null,
      fontStyle: "normal",
      fontWeight: "normal",
      fontFamily: "serif",
      fontSizePt: 10,
    });
    expect(measured).not.toBeNull();
    const payload = engine.renderFromCache(measured!.cacheKey);
    expect(payload).not.toBeNull();
    expect(payload!.body).toContain('data-tex-literal="unsupported-command"');
    expect(payload!.body).toContain('data-source-start="10"');
  });

  it("lays out unsupported direct characters with caret stops and literal metadata", () => {
    const result = layoutSimpleTexParagraph("50% off", {
      paragraphId: "tex:literal-percent",
      width: 200,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(true);
    const segments = result.report?.lines.flatMap((line) => line.segments) ?? [];
    const literalSegments = segments.filter((segment) => segment.literal);
    expect(literalSegments).toHaveLength(1);
    expect(literalSegments[0].text).toBe("%");
    expect(literalSegments[0].literal?.reason).toBe("unsupported-character");
  });
});
