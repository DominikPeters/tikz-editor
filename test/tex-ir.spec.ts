import { describe, expect, it } from "vitest";
import {
  analyzeSimpleTexParagraph,
  classicComputerModernTextFontProfile,
  computerModernTexMetricProvider,
  createSimpleTexLayoutDocumentIr,
  createSimpleTexLayoutDocumentIrFromPreparation,
  luaLatexDefaultTextFontProfile,
  prepareSimpleTexLayoutDocument,
  prepareTexLayoutParagraphsFromVList,
  parseSimpleTexParagraphIr,
  texLayoutItemsForParagraphPlan,
} from "../packages/core/src/text/tex/index.js";
import {
  lowerSimpleTexBlocksToVList,
  prepareSimpleTexVList,
  texVListParagraphItems,
  type TexVListItem,
} from "../packages/core/src/text/tex/vlist/index.js";

describe("simple TeX paragraph IR", () => {
  it("analyzes fallback eligibility and IR in one pass", () => {
    const analysis = analyzeSimpleTexParagraph(String.raw`Alpha \textit{Beta}`, 120);

    expect(analysis.fallbackReason).toBeNull();
    expect(analysis.ir?.blocks).toHaveLength(1);
    expect(analysis.ir?.unsupportedCommand).toBe(false);

    const inlineMath = analyzeSimpleTexParagraph(String.raw`Alpha $x$`, 120);
    expect(inlineMath.ir?.unsupportedCommand).toBe(false);
    expect(inlineMath.fallbackReason).toBeNull();
  });

  it("parses display math delimiters as vertical block items", () => {
    const source = String.raw`Alpha $$x^2$$ \[y^2\] \begin{equation}z^2\end{equation} \begin{align}a&=b\end{align}`;
    const parsed = parseSimpleTexParagraphIr(source);
    const displayItems = parsed.items.filter((item) => item.kind === "display-math");

    expect(parsed.unsupportedCommand).toBe(false);
    expect(displayItems.map((item) => item.delimiter)).toEqual([
      "double-dollar",
      "bracket",
      "equation",
      "align",
    ]);
    expect(displayItems.map((item) => item.content)).toEqual([
      "x^2",
      "y^2",
      "z^2",
      "a&=b",
    ]);
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

  it("parses vertical glue commands as non-paragraph block items", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \smallskip \noindent Beta \par \medskip Gamma \par \bigskip Delta \par \vspace{7pt} Epsilon \par \vskip 5pt plus 2pt minus 1pt Zeta \par \vfill Eta \par \vspace*{-4pt} Theta`
    );

    expect(parsed.unsupportedCommand).toBe(false);
    expect(parsed.blocks.map((block) => block.text)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Epsilon",
      "Zeta",
      "Eta",
      "Theta",
    ]);
    expect(parsed.items.map((item) =>
      item.kind === "vertical-glue"
        ? {
            kind: item.kind,
            command: item.command,
            size: item.size,
            stretch: item.stretch,
            shrink: item.shrink,
            stretchOrder: item.stretchOrder,
          }
        : {
            kind: item.kind,
            text: item.kind === "paragraph" ? item.block.text : undefined,
          }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "vertical-glue",
        command: "smallskip",
        size: 3,
        stretch: 1,
        shrink: 1,
        stretchOrder: "normal",
      },
      { kind: "paragraph", text: "Beta" },
      {
        kind: "vertical-glue",
        command: "medskip",
        size: 6,
        stretch: 2,
        shrink: 2,
        stretchOrder: "normal",
      },
      { kind: "paragraph", text: "Gamma" },
      {
        kind: "vertical-glue",
        command: "bigskip",
        size: 12,
        stretch: 4,
        shrink: 4,
        stretchOrder: "normal",
      },
      { kind: "paragraph", text: "Delta" },
      {
        kind: "vertical-glue",
        command: "vspace",
        size: 7,
        stretch: undefined,
        shrink: undefined,
        stretchOrder: "normal",
      },
      { kind: "paragraph", text: "Epsilon" },
      {
        kind: "vertical-glue",
        command: "vskip",
        size: 5,
        stretch: 2,
        shrink: 1,
        stretchOrder: "normal",
      },
      { kind: "paragraph", text: "Zeta" },
      {
        kind: "vertical-glue",
        command: "vfill",
        size: 0,
        stretch: 1,
        shrink: undefined,
        stretchOrder: "fill",
      },
      { kind: "paragraph", text: "Eta" },
      {
        kind: "vertical-glue",
        command: "vspace",
        size: -4,
        stretch: undefined,
        shrink: undefined,
        stretchOrder: "normal",
      },
      { kind: "paragraph", text: "Theta" },
    ]);
  });

  it("rejects vertical glue in the middle of a paragraph instead of approximating vadjust", () => {
    const analysis = analyzeSimpleTexParagraph(String.raw`Alpha \smallskip Beta`, 120);

    expect(analysis.ir?.unsupportedCommand).toBe(true);
    expect(analysis.fallbackReason).toContain("not supported");
  });

  it("parses explicit TeX hrule commands as vertical rule block items", () => {
    const source = String.raw`Alpha \par \hrule width 24pt height 2pt depth 1pt Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const ruleStart = source.indexOf(String.raw`\hrule`);
    const ruleEnd = source.indexOf("Beta");

    expect(parsed.unsupportedCommand).toBe(false);
    expect(parsed.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.block.text }
        : item.kind === "vertical-rule"
          ? {
              kind: item.kind,
              width: item.width,
              height: item.height,
              depth: item.depth,
              sourceStart: item.sourceStart,
              sourceEnd: item.sourceEnd,
            }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "vertical-rule",
        width: 24,
        height: 2,
        depth: 1,
        sourceStart: ruleStart,
        sourceEnd: ruleEnd,
      },
      { kind: "paragraph", text: "Beta" },
    ]);

  });

  it("parses explicit TeX penalty commands as penalty block items", () => {
    const source = String.raw`Alpha \par \penalty -50 Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const penaltyStart = source.indexOf(String.raw`\penalty`);
    const penaltyEnd = source.indexOf(" Beta");

    expect(parsed.unsupportedCommand).toBe(false);
    expect(parsed.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.block.text }
        : item.kind === "penalty"
          ? {
              kind: item.kind,
              penalty: item.penalty,
              sourceStart: item.sourceStart,
              sourceEnd: item.sourceEnd,
            }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "penalty",
        penalty: -50,
        sourceStart: penaltyStart,
        sourceEnd: penaltyEnd,
      },
      { kind: "paragraph", text: "Beta" },
    ]);

  });

  it("preserves block-position unsupported commands as placeholder block items", () => {
    const source = String.raw`Alpha \par \includegraphics[width=1cm]{plot.pdf} \par Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const placeholderStart = source.indexOf(String.raw`\includegraphics`);
    const placeholderEnd = source.indexOf(String.raw` \par Beta`);

    expect(parsed.unsupportedCommand).toBe(true);
    expect(parsed.partialFallbackSupported).toBe(true);
    expect(parsed.blocks.map((block) => block.text)).toEqual(["Alpha", "Beta"]);
    expect(parsed.items.map((item) =>
      item.kind === "placeholder"
        ? {
            kind: item.kind,
            text: item.text,
            sourceStart: item.sourceStart,
            sourceEnd: item.sourceEnd,
            reason: item.reason,
          }
        : item.kind === "paragraph"
          ? {
              kind: item.kind,
              text: item.block.text,
            }
        : {
            kind: item.kind,
          }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "placeholder",
        text: String.raw`\includegraphics[width=1cm]{plot.pdf}`,
        sourceStart: placeholderStart,
        sourceEnd: placeholderEnd,
        reason: "Unsupported TeX command in vertical mode.",
      },
      { kind: "paragraph", text: "Beta" },
    ]);

  });

  it("routes layout paragraph IR through V0 vlist paragraph items", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`Alpha \\[7pt] Beta \par Gamma`);
    const vlist = lowerSimpleTexBlocksToVList(parsed.blocks);
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? {
            blockIndex: item.blockIndex,
            sourceSpan: item.sourceSpan,
          }
        : null
    )).toEqual([
      {
        blockIndex: 0,
        sourceSpan: {
          start: parsed.blocks[0]?.sourceStart,
          end: parsed.blocks[0]?.sourceEnd,
        },
      },
      {
        blockIndex: 1,
        sourceSpan: {
          start: parsed.blocks[1]?.sourceStart,
          end: parsed.blocks[1]?.sourceEnd,
        },
      },
    ]);
    expect(layout.layoutMode).toBe("wrapped-explicit");
    expect(layout.paragraphPlans.map((plan) => ({
      blockIndex: plan.blockIndex,
      segmentIndex: plan.segmentIndex,
      text: plan.segment.text,
    }))).toEqual([
      { blockIndex: 0, segmentIndex: 0, text: "Alpha" },
      { blockIndex: 0, segmentIndex: 1, text: "Beta" },
      { blockIndex: 1, segmentIndex: 0, text: "Gamma" },
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

  it("records inline math delimiters and source spans in source IR", () => {
    const source = String.raw`Alpha $x^2_y$ and \(z+1\).`;
    const ir = parseSimpleTexParagraphIr(source);

    expect(ir.unsupportedCommand).toBe(false);
    expect(ir.nodes.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "math",
      "space",
      "text",
      "space",
      "math",
      "text",
    ]);
    expect(ir.nodes[2]).toMatchObject({
      kind: "math",
      delimiter: "dollar",
      text: "$x^2_y$",
      content: "x^2_y",
      sourceStart: source.indexOf("$x^2_y$"),
      sourceEnd: source.indexOf("$x^2_y$") + "$x^2_y$".length,
      contentStart: source.indexOf("x^2_y"),
      contentEnd: source.indexOf("x^2_y") + "x^2_y".length,
    });
    expect(ir.nodes[6]).toMatchObject({
      kind: "math",
      delimiter: "paren",
      text: String.raw`\(z+1\)`,
      content: "z+1",
      sourceStart: source.indexOf(String.raw`\(z+1\)`),
      sourceEnd: source.indexOf(String.raw`\(z+1\)`) + String.raw`\(z+1\)`.length,
      contentStart: source.indexOf("z+1"),
      contentEnd: source.indexOf("z+1") + "z+1".length,
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
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font,
      options: { textFontProfile: classicComputerModernTextFontProfile },
    });

    expect(layout.paragraphPlans).toHaveLength(1);
    const spaces = layout.paragraphPlans[0]
      ? texLayoutItemsForParagraphPlan(layout.paragraphPlans[0], {
          atPt: font.atPt,
          metricProvider: computerModernTexMetricProvider,
          textFontProfile: classicComputerModernTextFontProfile,
        }).filter((item) => item.kind === "space")
      : [];
    expect(spaces.map((space) => space.spaceFactor)).toEqual([3000, 1000]);
    expect(spaces.map((space) => space.spaceGlueProfile)).toEqual(["font", "font"]);
  });

  it("materializes nested inline font commands as Computer Modern font runs", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`A \textit{B \emph{C} \textbf{D}} \textnormal{\textbf{E}} \textrm{F} \textsf{G \textbf{H \textit{I}} \textsc{J}} \textsc{K \textsf{L} \textbf{M}} \textsf{\textbf{\textsc{N}}}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font,
      options: { textFontProfile: classicComputerModernTextFontProfile },
    });

    expect(layout.paragraphPlans).toHaveLength(1);
    expect(layout.paragraphPlans[0] && texLayoutItemsForParagraphPlan(layout.paragraphPlans[0], {
      atPt: font.atPt,
      metricProvider: computerModernTexMetricProvider,
      textFontProfile: classicComputerModernTextFontProfile,
    })
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

  it("maps LuaLaTeX regular textnormal text to Latin Modern Roman", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`A \textnormal{B}`);
    const font = luaLatexDefaultTextFontProfile.resolveTextFont(
      luaLatexDefaultTextFontProfile.defaultFontState,
      10,
      computerModernTexMetricProvider
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font,
      options: { textFontProfile: luaLatexDefaultTextFontProfile },
    });

    expect(layout.paragraphPlans[0] && texLayoutItemsForParagraphPlan(layout.paragraphPlans[0], {
      atPt: font.atPt,
      metricProvider: computerModernTexMetricProvider,
      textFontProfile: luaLatexDefaultTextFontProfile,
    })
      .filter((item) => item.kind === "text")
      .map((item) => ({ text: item.text, font: item.font.id }))).toEqual([
        { text: "A", font: "lmroman10-regular" },
        { text: "B", font: "lmroman10-regular" },
      ]);
  });

  it("can materialize inline font commands through the LuaLaTeX default text profile", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`A \textit{B \emph{C} \textbf{D}} \textnormal{\textbf{E}} \textrm{F} \textsf{G \textbf{H \textit{I}} \textsc{J}} \textsc{K \textsf{L} \textbf{M}} \textsf{\textbf{\textsc{N}}}`
    );
    const font = luaLatexDefaultTextFontProfile.resolveTextFont(
      luaLatexDefaultTextFontProfile.defaultFontState,
      10,
      computerModernTexMetricProvider
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font,
      options: { textFontProfile: luaLatexDefaultTextFontProfile },
    });

    expect(layout.paragraphPlans).toHaveLength(1);
    expect(layout.paragraphPlans[0] && texLayoutItemsForParagraphPlan(layout.paragraphPlans[0], {
      atPt: font.atPt,
      metricProvider: computerModernTexMetricProvider,
      textFontProfile: luaLatexDefaultTextFontProfile,
    })
      .filter((item) => item.kind === "text")
      .map((item) => ({ text: item.text, font: item.font.id }))).toEqual([
        { text: "A", font: "lmroman10-regular" },
        { text: "B", font: "lmroman10-italic" },
        { text: "C", font: "lmroman10-regular" },
        { text: "D", font: "lmroman10-bolditalic" },
        { text: "E", font: "lmroman10-bold" },
        { text: "F", font: "lmroman10-regular" },
        { text: "G", font: "lmsans10-regular" },
        { text: "H", font: "lmsans10-bold" },
        { text: "I", font: "lmsans10-boldoblique" },
        { text: "J", font: "lmromancaps10-regular" },
        { text: "K", font: "lmromancaps10-regular" },
        { text: "L", font: "lmromancaps10-regular" },
        { text: "M", font: "lmromancaps10-regular" },
        { text: "N", font: "lmromancaps10-regular" },
      ]);
  });

  it("materializes scoped font declarations as local Computer Modern font runs", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`A {\it B {\bf C} D} {\itshape E {\bfseries F}} {\sf G {\bf H} {\bfseries I} {\sc J}} {\scshape K {\sffamily L} {\bfseries M}} {\em N {\em O} P} Q`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font,
      options: { textFontProfile: classicComputerModernTextFontProfile },
    });

    expect(layout.paragraphPlans).toHaveLength(1);
    expect(layout.paragraphPlans[0] && texLayoutItemsForParagraphPlan(layout.paragraphPlans[0], {
      atPt: font.atPt,
      metricProvider: computerModernTexMetricProvider,
      textFontProfile: classicComputerModernTextFontProfile,
    })
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

  it("materializes LaTeX article quote margins in layout metadata", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`\begin{quote} Alpha Beta \end{quote}`);
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: { textFontProfile: classicComputerModernTextFontProfile },
    });

    expect(layout.paragraphPlans).toHaveLength(1);
    expect(layout.paragraphPlans[0]).toMatchObject({
      segment: { noIndent: true },
      alignment: "ragged-right",
      alignmentProfile: "latex-quote",
    });
    expect(layout.paragraphPlans[0]?.breakContext).toMatchObject({
      scopePolicy: {
        leftMarginWidth: 2.5 * font.atPt,
        rightMarginWidth: 2.5 * font.atPt,
        allowParagraphIndent: true,
        allowForcedBreakIndent: true,
        forceParfillStretch: true,
        suppressRaggedLeftCenterLeftskipStretch: true,
        rightskipStretchMode: "ragged-right-infinite-otherwise-zero",
      },
    });
    expect(flattenVListLeaves(layout.vlist.items)).toEqual([
      "glue:10",
      "paragraph:Alpha Beta",
    ]);
  });

  it("materializes LaTeX article list margins and labels in layout metadata", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{enumerate}\item Alpha \item Beta \begin{enumerate}\item Gamma\end{enumerate}\end{enumerate}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: { textFontProfile: classicComputerModernTextFontProfile },
    });

    expect(layout.paragraphPlans.map((plan) => {
      const lineLabel = plan.lineLabel;
      const breakContext = plan.breakContext;
      const label = lineLabel?.label;
      return {
        text: plan.segment.text,
        leftMarginWidth: breakContext?.scopePolicy.leftMarginWidth,
        rightMarginWidth: breakContext?.scopePolicy.rightMarginWidth,
        label: label?.items
          .filter((item) => item.kind === "text")
          .map((item) => item.text)
          .join(""),
        labelRightEdge: label?.rightEdge,
      };
    })).toEqual([
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
    expect(collectVListBoxes(layout.vlist.items)
      .filter((item) => item.role?.kind === "list-item")
      .map((item) => item.layout?.listItem?.label?.rightEdge)
    ).toEqual(layout.paragraphPlans.flatMap((plan) =>
      plan.lineLabel ? [plan.lineLabel.label.rightEdge] : []
    ));
  });

  it("materializes LaTeX article description labels as in-flow hanging labels", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{description}\item[Term] Alpha \item Plain\end{description}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: { textFontProfile: classicComputerModernTextFontProfile },
    });

    expect(layout.paragraphPlans.map((plan) => {
      const breakContext = plan.breakContext;
      return {
        text: plan.segment.text,
        allowParagraphIndent: breakContext?.scopePolicy.allowParagraphIndent,
        leftMarginWidth: breakContext?.scopePolicy.leftMarginWidth,
        firstLineIndentWidth: breakContext?.firstLineIndentWidth,
        textItems: texLayoutItemsForParagraphPlan(plan, {
          atPt: font.atPt,
          metricProvider: computerModernTexMetricProvider,
          textFontProfile: classicComputerModernTextFontProfile,
        })
          .filter((item) => item.kind === "text")
          .map((item) => ({ text: item.text, font: item.font.id })),
      };
    })).toEqual([
      {
        text: "Alpha",
        allowParagraphIndent: false,
        leftMarginWidth: 2.5 * font.atPt,
        firstLineIndentWidth: -2 * font.atPt,
        textItems: [
          { text: "Term", font: "cmbx10" },
          { text: "Alpha", font: "cmr10" },
        ],
      },
      {
        text: "Plain",
        allowParagraphIndent: false,
        leftMarginWidth: 2.5 * font.atPt,
        firstLineIndentWidth: -2.5 * font.atPt,
        textItems: [
          { text: "Plain", font: "cmr10" },
        ],
      },
    ]);
    expect(layout.paragraphPlans.flatMap((plan) =>
      plan.lineLabel ? [plan.lineLabel] : []
    )).toEqual([]);
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

    expect(layout.paragraphPlans.flatMap((plan) =>
      plan.lineLabel ? [plan.lineLabel.label.items[0]] : []
    ))
      .toMatchObject([
        { kind: "glyph", text: "•", code: 0x2022, font: { id: "lmroman10-regular" } },
        { kind: "glyph", text: "–", code: 0x2013, font: { id: "lmroman10-bold" } },
        { kind: "glyph", text: "*", code: 42, font: { id: "tcrm1000" } },
        { kind: "glyph", text: ".", code: 183, font: { id: "tcrm1000" } },
      ]);
    expect(collectVListBoxes(layout.vlist.items)
      .filter((item) => item.role?.kind === "list-item")
      .map((item) => item.layout?.listItem?.label?.content)
    ).toEqual([
      { kind: "glyph", text: "•", code: 0x2022, fontId: "lmroman10-regular" },
      { kind: "glyph", text: "–", code: 0x2013, fontId: "lmroman10-bold" },
      { kind: "glyph", text: "*", code: 42, fontId: "tcrm1000" },
      { kind: "glyph", text: ".", code: 183, fontId: "tcrm1000" },
    ]);
  });

  it("materializes natural LaTeX article list vertical spacing as vlist glue", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Before \par \begin{itemize}\item Alpha \par More \item Beta \begin{itemize}\item Nested\end{itemize}\end{itemize} \par After`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(flattenVListLeaves(layout.vlist.items)).toEqual([
      "paragraph:Before",
      "glue:10",
      "hbox",
      "paragraph:Alpha",
      "glue:4",
      "paragraph:More",
      "glue:8",
      "hbox",
      "paragraph:Beta",
      "glue:8",
      "hbox",
      "paragraph:Nested",
      "glue:10",
      "paragraph:After",
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

    expect(flattenVListLeaves(layout.vlist.items)).toEqual([
      "glue:13",
      "hbox",
      "paragraph:A",
      "glue:8",
      "hbox",
      "paragraph:B",
      "glue:4",
      "hbox",
      "paragraph:C",
      "glue:2",
      "hbox",
      "paragraph:D",
      "glue:4",
      "hbox",
      "paragraph:E",
      "glue:8",
      "hbox",
      "paragraph:F",
    ]);
  });

  it("materializes LaTeX quote list vertical skips as vlist glue", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.paragraphPlans.map((plan) => ({
      text: plan.segment.text,
      quoteRightskipMode: plan.breakContext.scopePolicy.rightskipStretchMode,
    }))).toEqual([
      { text: "Alpha", quoteRightskipMode: "default" },
      { text: "Beta", quoteRightskipMode: "ragged-right-infinite-otherwise-zero" },
      { text: "Gamma", quoteRightskipMode: "ragged-right-infinite-otherwise-zero" },
      { text: "Delta", quoteRightskipMode: "default" },
    ]);
    expect(flattenVListLeaves(layout.vlist.items)).toEqual([
      "paragraph:Alpha",
      "glue:10",
      "paragraph:Beta",
      "glue:4",
      "paragraph:Gamma",
      "glue:10",
      "paragraph:Delta",
    ]);
  });

  it("mirrors computed paragraph vertical skips as explicit vlist glue", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(flattenVListLeaves(layout.vlist.items)).toEqual([
      "paragraph:Alpha",
      "glue:10",
      "paragraph:Beta",
      "glue:4",
      "paragraph:Gamma",
      "glue:10",
      "paragraph:Delta",
    ]);
  });

  it("derives layout paragraph IR from normalized vlist paragraph order", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par \begin{itemize}\item Gamma\end{itemize}\end{quote}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(layout.rawVList.items.map((item) => item.kind)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(layout.vlist.items.map((item) => item.kind)).toEqual(["paragraph", "vbox"]);
    expect(layout.paragraphPlans.map((plan) => plan.segment.text)).toEqual(
      texVListParagraphItems(layout.vlist.items).map((item) => item.paragraph.text)
    );
  });

  it("prepares simple TeX layout documents as one vlist object with paragraph plans", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{itemize}\item Beta\end{itemize}`
    );
    const font = computerModernTexMetricProvider.resolveFont();

    const preparation = prepareSimpleTexLayoutDocument({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: {},
    });

    expect(preparation.rawVList.items.map((item) => item.kind)).toEqual([
      "paragraph",
      "paragraph",
    ]);
    expect(preparation.materializedVList.items.map((item) => item.kind)).toEqual([
      "paragraph",
      "glue",
      "paragraph",
    ]);
    expect(preparation.normalizedVList.items.map((item) => item.kind)).toEqual([
      "paragraph",
      "vbox",
    ]);
    expect(flattenVListLeaves(preparation.vlist.items)).toEqual([
      "paragraph:Alpha",
      "glue:10",
      "hbox",
      "paragraph:Beta",
    ]);
    expect(preparation.paragraphPreparation.paragraphPlans.map((plan) => ({
      blockIndex: plan.blockIndex,
      text: plan.segment.text,
      leftMarginWidth: plan.breakContext.scopePolicy.leftMarginWidth,
    }))).toEqual([
      { blockIndex: 0, text: "Alpha", leftMarginWidth: 0 },
      { blockIndex: 1, text: "Beta", leftMarginWidth: 25 },
    ]);
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: {},
    });
    expectParagraphPlansCoverVListParagraphs(layout);
  });

  it("builds equivalent layout document IR from an existing preparation object", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{center} Beta \end{center}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const params = {
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right" as const,
      font,
      metricProvider: computerModernTexMetricProvider,
      options: {},
    };
    const preparation = prepareSimpleTexLayoutDocument(params);

    const direct = createSimpleTexLayoutDocumentIr(params);
    const fromPreparation = createSimpleTexLayoutDocumentIrFromPreparation(preparation);

    expect(preparation.reportAlignment).toBe(direct.reportAlignment);
    expect(fromPreparation).toEqual(direct);
  });

  it("prepares paragraph layout plans and attaches list label hboxes before IR projection", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`\begin{itemize}\item Alpha\end{itemize}`);
    const font = computerModernTexMetricProvider.resolveFont();
    const prepared = prepareSimpleTexVList(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      font
    );

    const preparation = prepareTexLayoutParagraphsFromVList({
      vlist: prepared.normalized,
      defaultAlignment: "ragged-right",
      font,
      metricProvider: computerModernTexMetricProvider,
      options: {},
    });
    const leaves = flattenVListLeaves(preparation.vlist.items);

    expect(preparation.paragraphPlans).toHaveLength(1);
    expect(preparation.paragraphPlans[0]).toMatchObject({
      blockIndex: 0,
      segmentIndex: 0,
      segment: { text: "Alpha" },
      breakContext: {
        blockIndex: 0,
        segmentIndex: 0,
        scopePolicy: {
          leftMarginWidth: 25,
          rightMarginWidth: 0,
          allowParagraphIndent: false,
          allowForcedBreakIndent: false,
          forceParfillStretch: true,
          suppressRaggedLeftCenterLeftskipStretch: true,
          rightskipStretchMode: "ragged-right-infinite-center-zero",
        },
      },
      lineLabel: {
        blockIndex: 0,
        segmentIndex: 0,
      },
    });
    expect(preparation.paragraphPlans[0]?.lineLabel?.label).toBeDefined();
    expect(leaves.indexOf("hbox")).toBeGreaterThanOrEqual(0);
    expect(leaves.indexOf("hbox")).toBeLessThan(leaves.indexOf("paragraph:Alpha"));
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

    expect(layout.paragraphPlans.map((plan) => ({
      text: plan.segment.text,
      quoteRightskipMode: plan.breakContext.scopePolicy.rightskipStretchMode,
    }))).toEqual([
      { text: "Alpha", quoteRightskipMode: "ragged-right-infinite-otherwise-zero" },
      { text: "Beta", quoteRightskipMode: "ragged-right-infinite-otherwise-zero" },
    ]);
    expect(flattenVListLeaves(layout.vlist.items)).toEqual([
      "glue:13",
      "hbox",
      "paragraph:Alpha",
      "glue:4",
      "hbox",
      "paragraph:Beta",
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

      expect(layout.paragraphPlans[0]).toMatchObject({
        alignment: "justified",
        alignmentProfile: undefined,
      });
      expect(layout.paragraphPlans[0]?.breakContext).toMatchObject({
        scopePolicy: {
          forceParfillStretch: true,
          rightskipStretchMode: "ragged-right-infinite-otherwise-zero",
        },
      });
    }
  });

  it("materializes forced breaks in layout paragraph IR", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`Alpha \\[7pt] Beta`);
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font,
      options: {},
    });

    expect(layout.layoutMode).toBe("wrapped-explicit");
    expect(layout.paragraphPlans).toHaveLength(2);
    expect(layout.paragraphPlans[0]?.segment.forcedBreakAfter).toMatchObject({
      lineLeading: "7pt",
    });
    expect(layout.paragraphPlans[0] && texLayoutItemsForParagraphPlan(layout.paragraphPlans[0], {
      atPt: font.atPt,
      metricProvider: computerModernTexMetricProvider,
    }).map((item) => item.kind)).toEqual(["text"]);
    expect(layout.paragraphPlans[1] && texLayoutItemsForParagraphPlan(layout.paragraphPlans[1], {
      atPt: font.atPt,
      metricProvider: computerModernTexMetricProvider,
    }).map((item) => item.kind)).toEqual(["text"]);
  });

  it("keeps forced breaks inside centered quote blocks in quote-local paragraph mode", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote} Alpha \\[7pt] Beta Gamma \end{quote}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "center",
      font,
      options: { tikzTextWidthNode: true, parindent: 10 },
    });

    expect(layout.paragraphPlans).toHaveLength(1);
    expect(layout.paragraphPlans[0]).toMatchObject({
      alignment: "justified",
      segment: { noIndent: true },
    });
    expect(layout.paragraphPlans[0] && texLayoutItemsForParagraphPlan(layout.paragraphPlans[0], {
      atPt: font.atPt,
      metricProvider: computerModernTexMetricProvider,
    }).map((item) => item.kind)).toEqual([
      "text",
      "forced-break",
      "text",
      "space",
      "text",
    ]);
  });
});

function flattenVListLeaves(items: readonly TexVListItem[]): readonly string[] {
  const leaves: string[] = [];
  for (const item of items) {
    if (item.kind === "vbox") {
      leaves.push(...flattenVListLeaves(item.items));
      continue;
    }
    if (item.kind === "paragraph") {
      leaves.push(`paragraph:${item.paragraph.text}`);
      continue;
    }
    if (item.kind === "glue") {
      leaves.push(`glue:${item.size}`);
      continue;
    }
    leaves.push(item.kind);
  }
  return leaves;
}

function collectVListBoxes(items: readonly TexVListItem[]): readonly Extract<TexVListItem, { kind: "vbox" }>[] {
  const boxes: Array<Extract<TexVListItem, { kind: "vbox" }>> = [];
  for (const item of items) {
    if (item.kind !== "vbox") {
      continue;
    }
    boxes.push(item);
    boxes.push(...collectVListBoxes(item.items));
  }
  return boxes;
}

function expectParagraphPlansCoverVListParagraphs(layout: {
  readonly vlist: {
    readonly items: readonly TexVListItem[];
  };
  readonly paragraphPlans: readonly {
    readonly blockIndex: number;
  }[];
}): void {
  expect(layout.paragraphPlans.map((plan) => plan.blockIndex)).toEqual(
    texVListParagraphItems(layout.vlist.items).map((item) => item.paragraph.blockIndex)
  );
}
