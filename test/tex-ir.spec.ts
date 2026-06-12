import { describe, expect, it } from "vitest";
import {
  analyzeSimpleTexParagraph,
  computerModernTexMetricProvider,
  createSimpleTexLayoutDocumentIr,
  parseSimpleTexParagraphIr,
} from "../packages/core/src/text/tex/index.js";

describe("simple TeX paragraph IR", () => {
  it("analyzes fallback eligibility and IR in one pass", () => {
    const analysis = analyzeSimpleTexParagraph(String.raw`Alpha \textit{Beta}`, 120);

    expect(analysis.fallbackReason).toBeNull();
    expect(analysis.ir?.blocks).toHaveLength(1);
    expect(analysis.ir?.unsupportedCommand).toBe(false);

    const unsupported = analyzeSimpleTexParagraph(String.raw`Alpha $x$`, 120);
    expect(unsupported.ir).toBeNull();
    expect(unsupported.fallbackReason).toContain("TeX syntax");
  });

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

  it("records nested inline font commands in source IR", () => {
    const ir = parseSimpleTexParagraphIr(
      String.raw`Alpha \textbf{Beta \textit{Gamma}} \textsf{\textsc{Delta}}`
    );

    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "font-command",
      "space",
      "font-command",
    ]);
    const command = ir.nodes[2];
    expect(command).toMatchObject({
      kind: "font-command",
      command: "textbf",
    });
    if (command?.kind !== "font-command") {
      throw new Error("expected font command node");
    }
    expect(command.children.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "font-command",
    ]);
    expect(command.children[2]).toMatchObject({
      kind: "font-command",
      command: "textit",
    });
    expect(ir.nodes[4]).toMatchObject({
      kind: "font-command",
      command: "textsf",
    });
  });

  it("records scoped old-style font declarations in source IR", () => {
    const ir = parseSimpleTexParagraphIr(
      String.raw`Alpha {\it Beta {\bf Gamma} Beta} {\sffamily Delta \scshape Epsilon}`
    );

    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "group",
      "space",
      "group",
    ]);
    const italicGroup = ir.nodes[2];
    expect(italicGroup).toMatchObject({
      kind: "group",
    });
    if (italicGroup?.kind !== "group") {
      throw new Error("expected group node");
    }
    expect(italicGroup.children.map((node) => node.kind)).toEqual([
      "font-declaration",
      "text",
      "space",
      "group",
      "space",
      "text",
    ]);
    expect(italicGroup.children[0]).toMatchObject({
      kind: "font-declaration",
      command: "it",
    });
    expect(italicGroup.children[3]).toMatchObject({
      kind: "group",
    });
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

  it("records LaTeX list item context and optional labels", () => {
    const ir = parseSimpleTexParagraphIr(
      String.raw`\begin{enumerate}\item Alpha \item[Custom] Beta \begin{itemize}\item Gamma\end{itemize}\end{enumerate}`
    );

    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.filter((node) => node.kind === "environment-boundary"))
      .toEqual([
        expect.objectContaining({ boundary: "begin", name: "enumerate" }),
        expect.objectContaining({ boundary: "begin", name: "itemize" }),
        expect.objectContaining({ boundary: "end", name: "itemize" }),
        expect.objectContaining({ boundary: "end", name: "enumerate" }),
      ]);
    expect(ir.nodes.filter((node) => node.kind === "item")).toHaveLength(3);
    expect(ir.blocks.map((block) => ({
      text: block.text,
      noIndent: block.noIndent,
      listContext: block.listContext && {
        kind: block.listContext.kind,
        depth: block.listContext.depth,
        labelDepth: block.listContext.labelDepth,
        itemIndex: block.listContext.itemIndex,
        totalLeftMarginEm: block.listContext.totalLeftMarginEm,
        showLabel: block.listContext.showLabel,
        labelText: block.listContext.label?.nodes.map((node) => node.text).join(""),
      },
    }))).toEqual([
      {
        text: "Alpha",
        noIndent: true,
        listContext: {
          kind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
          totalLeftMarginEm: 2.5,
          showLabel: true,
          labelText: undefined,
        },
      },
      {
        text: "Beta",
        noIndent: true,
        listContext: {
          kind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 2,
          totalLeftMarginEm: 2.5,
          showLabel: true,
          labelText: "Custom",
        },
      },
      {
        text: "Gamma",
        noIndent: true,
        listContext: {
          kind: "itemize",
          depth: 2,
          labelDepth: 1,
          itemIndex: 1,
          totalLeftMarginEm: 4.7,
          showLabel: true,
          labelText: undefined,
        },
      },
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

  it("materializes nested inline font commands as Computer Modern font runs", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`A \textit{B \emph{C} \textbf{D}} \textnormal{\textbf{E}} \textrm{F} \textsf{G \textbf{H \textit{I}} \textsc{J}} \textsc{K \textsf{L} \textbf{M}} \textsf{\textbf{\textsc{N}}}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs).toHaveLength(1);
    expect(layout.paragraphs[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => ({ text: item.text, font: item.font.id }))).toEqual([
        { text: "A", font: "cmr10" },
        { text: "B", font: "cmti10" },
        { text: "C", font: "cmr10" },
        { text: "D", font: "cmbxti10" },
        { text: "E", font: "cmbx10" },
        { text: "F", font: "cmr10" },
        { text: "G", font: "cmss10" },
        { text: "H", font: "cmssbx10" },
        { text: "I", font: "cmssbx10" },
        { text: "J", font: "cmcsc10" },
        { text: "K", font: "cmcsc10" },
        { text: "L", font: "cmcsc10" },
        { text: "M", font: "cmbx10" },
        { text: "N", font: "cmssbx10" },
      ]);
  });

  it("maps LuaLaTeX textnormal regular text to Latin Modern Roman", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`A \textnormal{B}`);
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => ({ text: item.text, font: item.font.id }))).toEqual([
        { text: "A", font: "cmr10" },
        { text: "B", font: "lmroman10-regular" },
      ]);
  });

  it("materializes scoped font declarations as local Computer Modern font runs", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`A {\it B {\bf C} D} {\itshape E {\bfseries F}} {\sf G {\bf H} {\bfseries I} {\sc J}} {\scshape K {\sffamily L} {\bfseries M}} {\em N {\em O} P} Q`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs).toHaveLength(1);
    expect(layout.paragraphs[0]?.items
      .filter((item) => item.kind === "text")
      .map((item) => ({ text: item.text, font: item.font.id }))).toEqual([
        { text: "A", font: "cmr10" },
        { text: "B", font: "cmti10" },
        { text: "C", font: "cmbx10" },
        { text: "D", font: "cmti10" },
        { text: "E", font: "cmti10" },
        { text: "F", font: "cmbxti10" },
        { text: "G", font: "cmss10" },
        { text: "H", font: "cmbx10" },
        { text: "I", font: "cmssbx10" },
        { text: "J", font: "cmcsc10" },
        { text: "K", font: "cmcsc10" },
        { text: "L", font: "cmcsc10" },
        { text: "M", font: "cmbx10" },
        { text: "N", font: "cmti10" },
        { text: "O", font: "cmr10" },
        { text: "P", font: "cmti10" },
        { text: "Q", font: "cmr10" },
      ]);
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
      verticalSkipBefore: 13,
    });
  });

  it("materializes LaTeX article list margins and labels in layout paragraph IR", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{enumerate}\item Alpha \item Beta \begin{enumerate}\item Gamma\end{enumerate}\end{enumerate}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: {},
    });

    expect(layout.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      leftMarginWidth: paragraph.leftMarginWidth,
      rightMarginWidth: paragraph.rightMarginWidth,
      label: paragraph.label?.items
        .filter((item) => item.kind === "text")
        .map((item) => item.text)
        .join(""),
      labelRightEdge: paragraph.label?.rightEdge,
    }))).toEqual([
      {
        text: "Alpha",
        leftMarginWidth: 2.5 * font.atPt,
        rightMarginWidth: 0,
        label: "1.",
        labelRightEdge: 2 * font.atPt,
      },
      {
        text: "Beta",
        leftMarginWidth: 2.5 * font.atPt,
        rightMarginWidth: 0,
        label: "2.",
        labelRightEdge: 2 * font.atPt,
      },
      {
        text: "Gamma",
        leftMarginWidth: 4.7 * font.atPt,
        rightMarginWidth: 0,
        label: "(a)",
        labelRightEdge: 4.2 * font.atPt,
      },
    ]);
  });

  it("materializes LaTeX article itemize labels as explicit TeX glyphs", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{itemize}\item Alpha \begin{itemize}\item Beta \begin{itemize}\item Gamma \begin{itemize}\item Delta\end{itemize}\end{itemize}\end{itemize}\end{itemize}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs.map((paragraph) => paragraph.label?.items[0]))
      .toMatchObject([
        { kind: "glyph", text: "•", code: 0x2022, font: { id: "lmroman10-regular" } },
        { kind: "glyph", text: "–", code: 0x2013, font: { id: "lmroman10-regular" } },
        { kind: "glyph", text: "*", code: 42, font: { id: "tcrm1000" } },
        { kind: "glyph", text: ".", code: 183, font: { id: "tcrm1000" } },
      ]);
  });

  it("materializes natural LaTeX article list vertical spacing in layout paragraph IR", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Before \par \begin{itemize}\item Alpha \par More \item Beta \begin{itemize}\item Nested\end{itemize}\end{itemize} \par After`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      verticalSkipBefore: paragraph.verticalSkipBefore,
    }))).toEqual([
      { text: "Before", verticalSkipBefore: 0 },
      { text: "Alpha", verticalSkipBefore: 10 },
      { text: "More", verticalSkipBefore: 4 },
      { text: "Beta", verticalSkipBefore: 8 },
      { text: "Nested", verticalSkipBefore: 8 },
      { text: "After", verticalSkipBefore: 10 },
    ]);
  });

  it("materializes depth-aware LaTeX list transition spacing", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{itemize}\item A \begin{itemize}\item B \begin{itemize}\item C\item D\end{itemize}\item E\end{itemize}\item F\end{itemize}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      verticalSkipBefore: paragraph.verticalSkipBefore,
    }))).toEqual([
      { text: "A", verticalSkipBefore: 13 },
      { text: "B", verticalSkipBefore: 8 },
      { text: "C", verticalSkipBefore: 4 },
      { text: "D", verticalSkipBefore: 2 },
      { text: "E", verticalSkipBefore: 4 },
      { text: "F", verticalSkipBefore: 8 },
    ]);
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

  it("does not double-count quote and nested list entry spacing", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote}\begin{itemize}\item Alpha\item Beta\end{itemize}\end{quote}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphs.map((paragraph) => ({
      text: paragraph.text,
      quoteDepth: paragraph.quoteDepth,
      verticalSkipBefore: paragraph.verticalSkipBefore,
    }))).toEqual([
      { text: "Alpha", quoteDepth: 1, verticalSkipBefore: 13 },
      { text: "Beta", quoteDepth: 1, verticalSkipBefore: 4 },
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
