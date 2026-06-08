import { describe, expect, it } from "vitest";
import {
  computerModernTexMetricProvider,
  createSimpleTexLayoutDocumentIr,
  parseSimpleTexParagraphIr,
} from "../packages/core/src/text/tex/index.js";

describe("simple TeX paragraph IR", () => {
  it("splits paragraphs while preserving source-level text commands", () => {
    const ir = parseSimpleTexParagraphIr(
      String.raw`Alpha Beta \par \noindent Gamma \\[7pt] Delta`
    );

    expect(ir).toMatchObject({
      kind: "simple-tex-paragraph",
      unsupportedCommand: false,
    });
    expect(ir.nodes.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "text",
      "space",
      "paragraph-break",
      "space",
      "noindent",
      "space",
      "text",
      "space",
      "line-break",
      "space",
      "text",
    ]);
    expect(ir.blocks).toHaveLength(2);
    expect(ir.blocks[0]).toMatchObject({
      text: "Alpha Beta",
      noIndent: false,
    });
    expect(ir.blocks[0]?.nodes.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "text",
    ]);
    expect(ir.blocks[1]).toMatchObject({
      text: String.raw`Gamma \\[7pt] Delta`,
      noIndent: true,
    });
    expect(ir.blocks[1]?.nodes.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "line-break",
      "space",
      "text",
    ]);
  });

  it("records paragraph-local alignment declarations", () => {
    const ir = parseSimpleTexParagraphIr(String.raw`\centering Alpha \par Beta`);

    expect(ir.nodes[0]).toMatchObject({
      kind: "alignment",
      alignment: "center",
      alignmentProfile: "latex-declaration",
    });
    expect(ir.blocks).toHaveLength(2);
    expect(ir.blocks[0]).toMatchObject({
      text: "Alpha",
      noIndent: true,
      alignment: "center",
      alignmentProfile: "latex-declaration",
    });
    expect(ir.blocks[1]).toMatchObject({
      text: "Beta",
      noIndent: false,
    });
  });

  it("reports unsupported control sequences without emitting a partial tail block", () => {
    const ir = parseSimpleTexParagraphIr(String.raw`Alpha \emph{Beta} Gamma`);

    expect(ir.unsupportedCommand).toBe(true);
    expect(ir.nodes).toContainEqual(expect.objectContaining({
      kind: "unsupported-command",
      text: String.raw`\emph`,
    }));
    expect(ir.blocks).toEqual([]);
  });

  it("records quote environment boundaries and paragraph quote depth", () => {
    const ir = parseSimpleTexParagraphIr(
      String.raw`Alpha \begin{quote} Beta \end{quote} Gamma`
    );

    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.filter((node) => node.kind === "environment-boundary"))
      .toEqual([
        expect.objectContaining({ boundary: "begin", name: "quote" }),
        expect.objectContaining({ boundary: "end", name: "quote" }),
      ]);
    expect(ir.blocks.map((block) => ({
      text: block.text,
      quoteDepth: block.quoteDepth,
      noIndent: block.noIndent,
    }))).toEqual([
      { text: "Alpha", quoteDepth: 0, noIndent: false },
      { text: "Beta", quoteDepth: 1, noIndent: true },
      { text: "Gamma", quoteDepth: 0, noIndent: false },
    ]);
  });

  it("materializes spacefactor state in layout paragraph IR", () => {
    const parsed = parseSimpleTexParagraphIr("Alpha. Beta Gamma");
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs).toHaveLength(1);
    const spaces = layout.paragraphs[0]?.items.filter((item) => item.kind === "space") ?? [];
    expect(spaces.map((space) => space.spaceFactor)).toEqual([3000, 1000]);
    expect(spaces.map((space) => space.spaceGlueProfile)).toEqual(["font", "font"]);
  });

  it("materializes LaTeX article quote margins in layout paragraph IR", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`\begin{quote} Alpha Beta \end{quote}`);
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: {},
    });

    expect(layout.paragraphs).toHaveLength(1);
    expect(layout.paragraphs[0]).toMatchObject({
      quoteDepth: 1,
      noIndent: true,
      alignment: "ragged-right",
      alignmentProfile: "latex-quote",
      leftMarginWidth: 2.5 * font.atPt,
      rightMarginWidth: 2.5 * font.atPt,
      verticalSkipBefore: 10,
    });
  });

  it("materializes LaTeX quote list vertical skips in layout paragraph IR", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      quoteDepth: paragraph.quoteDepth,
      verticalSkipBefore: paragraph.verticalSkipBefore,
    }))).toEqual([
      { text: "Alpha", quoteDepth: 0, verticalSkipBefore: 0 },
      { text: "Beta", quoteDepth: 1, verticalSkipBefore: 10 },
      { text: "Gamma", quoteDepth: 1, verticalSkipBefore: 4 },
      { text: "Delta", quoteDepth: 0, verticalSkipBefore: 10 },
    ]);
  });

  it("resets right and center alignment declarations inside quote layout IR", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`\begin{quote} Alpha Beta \end{quote}`);
    const font = computerModernTexMetricProvider.resolveFont();

    for (const defaultAlignment of ["ragged-left", "center"] as const) {
      const layout = createSimpleTexLayoutDocumentIr({
        blocks: parsed.blocks,
        defaultAlignment,
        font,
        options: {},
      });

      expect(layout.paragraphs[0]).toMatchObject({
        quoteDepth: 1,
        alignment: "justified",
        alignmentProfile: undefined,
      });
    }
  });

  it("materializes forced breaks in layout paragraph IR", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`Alpha \\[7pt] Beta`);
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.layoutMode).toBe("wrapped-explicit");
    expect(layout.paragraphs).toHaveLength(2);
    expect(layout.paragraphs[0]?.forcedBreakAfter).toMatchObject({
      lineLeading: "7pt",
    });
    expect(layout.paragraphs[0]?.items.map((item) => item.kind)).toEqual(["text"]);
    expect(layout.paragraphs[1]?.items.map((item) => item.kind)).toEqual(["text"]);
  });

  it("keeps forced breaks inside centered quote blocks in quote-local paragraph mode", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote} Alpha \\[7pt] Beta Gamma \end{quote}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "center",
      font: computerModernTexMetricProvider.resolveFont(),
      options: { tikzTextWidthNode: true, parindent: 10 },
    });

    expect(layout.paragraphs).toHaveLength(1);
    expect(layout.paragraphs[0]).toMatchObject({
      alignment: "justified",
      noIndent: true,
    });
    expect(layout.paragraphs[0]?.items.map((item) => item.kind)).toEqual([
      "text",
      "forced-break",
      "text",
      "space",
      "text",
    ]);
  });
});
