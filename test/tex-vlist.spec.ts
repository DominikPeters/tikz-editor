import { describe, expect, it } from "vitest";
import {
  analyzeSimpleTexParagraph,
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  createSimpleTexLayoutDocumentIr,
  layoutSimpleTexParagraph,
  luaLatexDefaultTextFontProfile,
  parseSimpleTexParagraphIr,
} from "../packages/core/src/text/tex/index.js";
import {
  simpleTexInlineNodesToLayoutItems,
} from "../packages/core/src/text/tex/layout-inline-items.js";
import type { NodeTextGraphicsResolver } from "../packages/core/src/text/types.js";
import { texInterwordGlueForSpaceFactor } from "../packages/core/src/text/tex/space-glue.js";
import {
  addParagraphVerticalGlueToVList,
  attachTexHBoxesBeforeVListParagraphs,
  breakSimpleTexLayoutDocumentParagraphs,
  computeTexVListNaturalTotalHeight,
  findPositionedTexVListItemByPath,
  flattenPositionedTexVListItems,
  getTexVListLayoutFromOutputJax,
  getTexVListLayoutsFromOutputJax,
  groupSimpleTexVListScopes,
  layoutTexVListItems,
  layoutTexVListFromBrokenParagraphs,
  layoutTexVListFromCombinedParagraphReport,
  layoutTexVListFromHorizontalParagraphs,
  layoutTexVListFromMeasuredParagraphs,
  lowerSimpleTexBlockItemsToVList,
  lowerSimpleTexBlocksToVList,
  materializeDisplayMathVerticalGlueInVList,
  materializeParagraphVerticalGlueInVList,
  normalizeSimpleTexVList,
  planSimpleTexParagraphVerticalSkips,
  prepareTexLayoutParagraphsFromVList,
  prepareSimpleTexLayoutDocument,
  prepareSimpleTexVList,
  registerTexVListLayoutsOnOutputJax,
  texListItemParagraphAttachments,
  texVListBoxLayoutReport,
  texParagraphScopeContext,
  texVListGlueSetForTargetHeight,
  texVListParagraphItems,
  combineTexBrokenLayoutParagraphs,
  validateTexVListParagraphMeasurements,
  type TexVListParagraphBoxMeasurement,
  type TexVListItemMeasurer,
  type TexVListItem,
} from "../packages/core/src/text/tex/vlist/index.js";

describe("TeX vlist lowering", () => {
  it("lowers parsed paragraph blocks into V0 vlist paragraph items", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha Beta \par \noindent Gamma \\[7pt] Delta`
    );
    const vlist = lowerSimpleTexBlocksToVList(parsed.blocks);

    expect(vlist.kind).toBe("vlist");
    expect(vlist.sourceSpan).toEqual({
      start: parsed.blocks[0]?.sourceStart,
      end: parsed.blocks.at(-1)?.sourceEnd,
    });
    expect(vlist.items).toHaveLength(2);
    expect(vlist.items.map((item) => item.kind)).toEqual(["paragraph", "paragraph"]);
    expect(vlist.items[0]).toMatchObject({
      kind: "paragraph",
      blockIndex: 0,
      paragraph: {
        blockIndex: 0,
        text: "Alpha Beta",
        noIndent: false,
      },
      sourceSpan: {
        start: parsed.blocks[0]?.sourceStart,
        end: parsed.blocks[0]?.sourceEnd,
      },
    });
    expect(vlist.items[1]).toMatchObject({
      kind: "paragraph",
      blockIndex: 1,
      paragraph: {
        blockIndex: 1,
        text: String.raw`Gamma \\[7pt] Delta`,
        noIndent: true,
      },
      sourceSpan: {
        start: parsed.blocks[1]?.sourceStart,
        end: parsed.blocks[1]?.sourceEnd,
      },
    });
    expect(vlist.items[1]?.kind === "paragraph" ? vlist.items[1].paragraph.noIndent : false).toBe(true);
  });

  it("preserves quote/list metadata when lowering simple TeX blocks to vlist", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote}\begin{enumerate}\item Alpha\item Beta\end{enumerate}\end{quote}`
    );
    const vlist = lowerSimpleTexBlocksToVList(parsed.blocks);

    expect(vlist.items).toHaveLength(2);
    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? {
            text: item.paragraph.text,
            quoteDepth: item.paragraph.quoteDepth,
            listKind: item.paragraph.listContext?.kind,
            itemIndex: item.paragraph.listContext?.itemIndex,
          }
        : null
    )).toEqual([
      { text: "Alpha", quoteDepth: 1, listKind: "enumerate", itemIndex: 1 },
      { text: "Beta", quoteDepth: 1, listKind: "enumerate", itemIndex: 2 },
    ]);
  });

  it("lowers center and flush environments as scoped trivlist paragraphs", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{center}Beta\end{center} \par \begin{flushleft}Gamma\end{flushleft} \par \begin{flushright}Delta\end{flushright} \par Epsilon`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font,
      options: { width: 120 },
    });
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      font
    );

    expect(parsed.unsupportedCommand).toBe(false);
    expect(layout.paragraphPlans.map((plan) => ({
      text: plan.segment.text,
      alignment: plan.alignment,
      alignmentProfile: plan.alignmentProfile,
      allowParagraphIndent: plan.breakContext.scopePolicy.allowParagraphIndent,
    }))).toEqual([
      {
        text: "Alpha",
        alignment: "ragged-right",
        alignmentProfile: undefined,
        allowParagraphIndent: true,
      },
      {
        text: "Beta",
        alignment: "center",
        alignmentProfile: "latex-declaration",
        allowParagraphIndent: false,
      },
      {
        text: "Gamma",
        alignment: "ragged-right",
        alignmentProfile: "latex-declaration",
        allowParagraphIndent: false,
      },
      {
        text: "Delta",
        alignment: "ragged-left",
        alignmentProfile: "latex-declaration",
        allowParagraphIndent: false,
      },
      {
        text: "Epsilon",
        alignment: "ragged-right",
        alignmentProfile: undefined,
        allowParagraphIndent: true,
      },
    ]);
    expect(grouped.items.map((item) =>
      item.kind === "vbox"
        ? {
            kind: item.kind,
            role: item.role,
            children: item.items.map((child) =>
              child.kind === "paragraph" ? child.paragraph.text : child.kind
            ),
          }
        : item.kind === "paragraph"
          ? { kind: item.kind, text: item.paragraph.text }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "vbox",
        role: { kind: "trivlist", envName: "center", depth: 1, alignment: "center" },
        children: ["Beta"],
      },
      {
        kind: "vbox",
        role: { kind: "trivlist", envName: "flushleft", depth: 1, alignment: "ragged-right" },
        children: ["Gamma"],
      },
      {
        kind: "vbox",
        role: { kind: "trivlist", envName: "flushright", depth: 1, alignment: "ragged-left" },
        children: ["Delta"],
      },
      { kind: "paragraph", text: "Epsilon" },
    ]);
  });

  it("parses and lowers display math as source-spanned vlist items", () => {
    const source = String.raw`Alpha \[\sum_i^n\] Beta $$x^2$$ \begin{equation*}y^2\end{equation*} \begin{align*}a&=b\\c&=d\end{align*} \begin{gather*}e=f\\g=h\end{gather*} \begin{multline*}i=j\\k+l=m\\n=o\end{multline*}`;
    const parsed = parseSimpleTexParagraphIr(source);

    expect(parsed.nodes.map((node) => node.kind)).toEqual([
      "text",
      "space",
      "display-math",
      "space",
      "text",
      "space",
      "display-math",
      "space",
      "display-math",
      "space",
      "display-math",
      "space",
      "display-math",
      "space",
      "display-math",
    ]);
    expect(parsed.items.map((item) => item.kind)).toEqual([
      "paragraph",
      "display-math",
      "paragraph",
      "display-math",
      "display-math",
      "display-math",
      "display-math",
      "display-math",
    ]);

    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items, {
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      width: 120,
    });

    expect(vlist.items[1]).toMatchObject({
      kind: "display-math",
      sourceSpan: {
        start: source.indexOf(String.raw`\[`),
        end: source.indexOf(String.raw`\]`) + 2,
      },
      delimiter: "bracket",
      content: String.raw`\sum_i^n`,
      contentStart: source.indexOf(String.raw`\sum`),
      contentEnd: source.indexOf(String.raw`\]`),
      targetWidth: 120,
      box: {
        width: expect.closeTo(14.44448, 5),
      },
    });
    expect(vlist.items[3]).toMatchObject({
      kind: "display-math",
      delimiter: "double-dollar",
      content: "x^2",
    });
    expect(vlist.items[4]).toMatchObject({
      kind: "display-math",
      delimiter: "equation-star",
      content: "y^2",
      sourceSpan: {
        start: source.indexOf(String.raw`\begin{equation*}`),
        end: source.indexOf(String.raw`\end{equation*}`) + String.raw`\end{equation*}`.length,
      },
      contentStart: source.indexOf("y^2"),
      contentEnd: source.indexOf(String.raw`\end{equation*}`),
    });
    expect(vlist.items[5]).toMatchObject({
      kind: "display-alignment",
      delimiter: "align-star",
      content: String.raw`a&=b\\c&=d`,
      sourceSpan: {
        start: source.indexOf(String.raw`\begin{align*}`),
        end: source.indexOf(String.raw`\end{align*}`) + String.raw`\end{align*}`.length,
      },
      contentStart: source.indexOf("a&=b"),
      contentEnd: source.indexOf(String.raw`\end{align*}`),
      alignment: {
        width: expect.any(Number),
        rows: [
          { rowIndex: 0, width: expect.any(Number) },
          { rowIndex: 1, width: expect.any(Number) },
        ],
      },
    });
    expect(vlist.items[6]).toMatchObject({
      kind: "display-alignment",
      delimiter: "gather-star",
      content: String.raw`e=f\\g=h`,
      sourceSpan: {
        start: source.indexOf(String.raw`\begin{gather*}`),
        end: source.indexOf(String.raw`\end{gather*}`) + String.raw`\end{gather*}`.length,
      },
      contentStart: source.indexOf("e=f"),
      contentEnd: source.indexOf(String.raw`\end{gather*}`),
      alignment: {
        width: expect.any(Number),
        rows: [
          { rowIndex: 0, width: expect.any(Number) },
          { rowIndex: 1, width: expect.any(Number) },
        ],
      },
    });
    expect(vlist.items[7]).toMatchObject({
      kind: "display-alignment",
      delimiter: "multline-star",
      content: String.raw`i=j\\k+l=m\\n=o`,
      sourceSpan: {
        start: source.indexOf(String.raw`\begin{multline*}`),
        end: source.indexOf(String.raw`\end{multline*}`) + String.raw`\end{multline*}`.length,
      },
      contentStart: source.indexOf("i=j"),
      contentEnd: source.indexOf(String.raw`\end{multline*}`),
      alignment: {
        width: expect.any(Number),
        rows: [
          { rowIndex: 0, width: expect.any(Number) },
          { rowIndex: 1, width: expect.any(Number) },
          { rowIndex: 2, width: expect.any(Number) },
        ],
      },
    });
  });

  it("lowers numbered gather and multline display math to display alignment items", () => {
    const source = String.raw`Alpha \begin{gather}a=b\\c=d\end{gather} Beta \begin{multline}x=y\\z=w\end{multline} Gamma`;
    const parsed = parseSimpleTexParagraphIr(source);

    expect(parsed.items.map((item) => item.kind)).toEqual([
      "paragraph",
      "display-math",
      "paragraph",
      "display-math",
      "paragraph",
    ]);

    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items, {
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      width: 120,
    });

    expect(vlist.items[1]).toMatchObject({
      kind: "display-alignment",
      sourceSpan: {
        start: source.indexOf(String.raw`\begin{gather}`),
        end: source.indexOf(String.raw`\end{gather}`) + String.raw`\end{gather}`.length,
      },
      delimiter: "gather",
      alignment: {
        delimiter: "gather",
        rows: [
          { rowIndex: 0, width: expect.any(Number) },
          { rowIndex: 1, width: expect.any(Number) },
        ],
      },
    });
    expect(vlist.items[3]).toMatchObject({
      kind: "display-alignment",
      sourceSpan: {
        start: source.indexOf(String.raw`\begin{multline}`),
        end: source.indexOf(String.raw`\end{multline}`) + String.raw`\end{multline}`.length,
      },
      delimiter: "multline",
      alignment: {
        delimiter: "multline",
        rows: [
          { rowIndex: 0, width: expect.any(Number) },
          { rowIndex: 1, width: expect.any(Number) },
        ],
      },
    });
  });

  it("centers measured display math items in the vlist width", () => {
    const source = String.raw`\[\sum_i^n\]`;
    const parsed = parseSimpleTexParagraphIr(source);
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items, {
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      width: 120,
    });
    const layout = layoutTexVListItems(
      vlist.items,
      () => null,
      null,
      0
    );
    const display = layout.positioned[0];

    expect(display).toMatchObject({
      item: { kind: "display-math" },
      x: expect.closeTo((120 - 14.44448) / 2, 5),
      y: 0,
      metrics: {
        width: expect.closeTo(14.44448, 5),
      },
    });
    expect(texVListBoxLayoutReport(
      layout.positioned,
      { width: 120, height: 0, depth: display?.metrics.height ?? 0 },
      { kind: "none" }
    ).items[0]).toMatchObject({
      itemKind: "display-math",
      displayMath: {
        delimiter: "bracket",
        contentStart: 2,
        contentEnd: 10,
      },
    });
  });

  it("materializes LaTeX article display skips around display math items", () => {
    const source = String.raw`Alpha \[\sum_i^n\] Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items, {
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      width: 120,
    });
    const materialized = materializeDisplayMathVerticalGlueInVList(vlist);

    expect(materialized.items.map((item) =>
      item.kind === "glue"
        ? {
            kind: item.kind,
            size: item.size,
            stretch: item.stretch,
            shrink: item.shrink,
            origin: item.origin,
            sourceSpan: item.sourceSpan,
          }
        : item.kind === "paragraph"
          ? { kind: item.kind, text: item.paragraph.text }
          : {
              kind: item.kind,
              sourceSpan: item.sourceSpan,
            }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "glue",
        size: 10,
        stretch: 2,
        shrink: 5,
        origin: { kind: "display-math-boundary", side: "above" },
        sourceSpan: {
          start: source.indexOf(String.raw`\[`),
          end: source.indexOf(String.raw`\]`) + 2,
        },
      },
      {
        kind: "display-math",
        sourceSpan: {
          start: source.indexOf(String.raw`\[`),
          end: source.indexOf(String.raw`\]`) + 2,
        },
      },
      {
        kind: "glue",
        size: 10,
        stretch: 2,
        shrink: 5,
        origin: { kind: "display-math-boundary", side: "below" },
        sourceSpan: {
          start: source.indexOf(String.raw`\[`),
          end: source.indexOf(String.raw`\]`) + 2,
        },
      },
      { kind: "paragraph", text: "Beta" },
    ]);
  });

  it("reports display skips in paragraph-display-paragraph vlist layouts", () => {
    const source = String.raw`Alpha \[\sum_i^n\] Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const font = computerModernTexMetricProvider.resolveFont();
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items, {
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      width: 120,
    });
    const prepared = prepareSimpleTexVList(vlist, font);
    const layout = layoutTexVListFromMeasuredParagraphs(prepared.normalized, {
      width: 120,
      lineHeight: 12,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0],
          lineIndices: [0],
          lineOffsets: [{ lineIndex: 0, y: 0 }],
          lastLinePreDisplaySize: 35,
          standardMetrics: { width: 120, height: 8.5, depth: 3.5 },
          ruleLeadingMetrics: { width: 120, height: 8.5, depth: 3.5 },
          standardAdvance: 12,
          ruleLeadingAdvance: 12,
        },
        {
          blockIndex: 1,
          vlistPath: [4],
          lineIndices: [1],
          lineOffsets: [{ lineIndex: 1, y: 0 }],
          standardMetrics: { width: 120, height: 8.5, depth: 3.5 },
          ruleLeadingMetrics: { width: 120, height: 8.5, depth: 3.5 },
          standardAdvance: 12,
          ruleLeadingAdvance: 12,
        },
      ],
    });
    const boxReport = layout.boxReport;

    expect(boxReport.items.map((item) => ({
      kind: item.itemKind,
      y: item.y,
      height: item.height,
      depth: item.depth,
      glue: item.glue,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: 8.5, depth: 3.5, glue: undefined },
      {
        kind: "glue",
        y: 12,
        height: 0,
        depth: 0,
        glue: {
          size: 0,
          stretch: 3,
          shrink: 0,
          stretchOrder: "normal",
          shrinkOrder: "normal",
          origin: { kind: "display-math-boundary", side: "above", variant: "short" },
        },
      },
      {
        kind: "glue",
        y: 12,
        height: 1,
        depth: 0,
        glue: {
          size: 1,
          stretchOrder: "normal",
          shrinkOrder: "normal",
          origin: { kind: "display-math-interline", side: "above" },
        },
      },
      {
        kind: "display-math",
        y: 13,
        height: expect.closeTo(16.51395, 5),
        depth: expect.closeTo(12.798677, 5),
        glue: undefined,
      },
      {
        kind: "glue",
        y: expect.closeTo(42.312627, 5),
        height: 6,
        depth: 0,
        glue: {
          size: 6,
          stretch: 3,
          shrink: 3,
          stretchOrder: "normal",
          shrinkOrder: "normal",
          origin: { kind: "display-math-boundary", side: "below", variant: "short" },
        },
      },
      {
        kind: "glue",
        y: expect.closeTo(48.312627, 5),
        height: 1,
        depth: 0,
        glue: {
          size: 1,
          stretchOrder: "normal",
          shrinkOrder: "normal",
          origin: { kind: "display-math-interline", side: "below" },
        },
      },
      {
        kind: "paragraph",
        y: expect.closeTo(49.312627, 5),
        height: 8.5,
        depth: 3.5,
        glue: undefined,
      },
    ]);
  });

  it("uses TeX font-space glue for flush environments directly inside lists", () => {
    const source = String.raw`\begin{enumerate}\item Manual position final source canvas. \begin{flushleft}Epsilon paper gamma shape, paper gamma.\end{flushleft}\end{enumerate}`;
    const parsed = parseSimpleTexParagraphIr(source);
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "justified",
      font,
      options: { width: 120 },
    });

    expect(layout.paragraphPlans.map((plan) => ({
      text: plan.segment.text,
      alignment: plan.alignment,
      width: plan.breakContext.width,
      spaceGlueProfile: plan.spaceGlueProfile,
      leftMarginWidth: plan.breakContext.scopePolicy.leftMarginWidth,
      rightMarginWidth: plan.breakContext.scopePolicy.rightMarginWidth,
      hasLabel: plan.lineLabel != null,
    }))).toEqual([
      {
        text: "Manual position final source canvas.",
        alignment: "justified",
        width: undefined,
        spaceGlueProfile: "font",
        leftMarginWidth: 25,
        rightMarginWidth: 0,
        hasLabel: true,
      },
      {
        text: "Epsilon paper gamma shape, paper gamma.",
        alignment: "ragged-right",
        width: undefined,
        spaceGlueProfile: "font",
        leftMarginWidth: 25,
        rightMarginWidth: 0,
        hasLabel: false,
      },
    ]);

    const result = layoutSimpleTexParagraph(source, {
      width: 120,
      alignment: "justified",
      parindent: 0,
      tikzTextWidthNode: true,
      metricProvider: computerModernTexMetricProvider,
    });
    expect(result.report?.lines.map(reportLineText)).toEqual([
      "1.Manual position final",
      "source canvas.",
      "Epsilon paper gamma",
      "shape, paper gamma.",
    ]);
  });

  it("keeps list labels for lists nested inside flush environments", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{flushleft}\begin{itemize}\item Alpha beta gamma\end{itemize}\end{flushleft}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "justified",
      font,
      options: { width: 120 },
    });

    expect(layout.paragraphPlans.map((plan) => ({
      text: plan.segment.text,
      alignment: plan.alignment,
      width: plan.breakContext.width,
      leftMarginWidth: plan.breakContext.scopePolicy.leftMarginWidth,
      hasLabel: plan.lineLabel != null,
    }))).toEqual([
      {
        text: "Alpha beta gamma",
        alignment: "ragged-right",
        width: undefined,
        leftMarginWidth: 25,
        hasLabel: true,
      },
    ]);
  });

  it("keeps TikZ fixed spaces for root flush environments in text-width nodes", () => {
    const source = String.raw`\begin{flushleft} Kernel compact compact shape computer beta, table direct pattern document alpha logic. \end{flushleft}`;
    const result = layoutSimpleTexParagraph(source, {
      width: 260,
      alignment: "ragged-left",
      parindent: 15,
      tikzTextWidthNode: true,
      metricProvider: computerModernTexMetricProvider,
    });

    expect(result.report?.lines.map(reportLineText)).toEqual([
      "Kernel compact compact shape computer beta, table",
      "direct pattern document alpha logic.",
    ]);
  });

  it("keeps normal display skips when the preceding line reaches the display", () => {
    const source = String.raw`Alpha Beta Gamma \[\sum_i^n\] Delta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const font = computerModernTexMetricProvider.resolveFont();
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items, {
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      width: 120,
    });
    const prepared = prepareSimpleTexVList(vlist, font);
    const layout = layoutTexVListFromMeasuredParagraphs(prepared.normalized, {
      width: 120,
      lineHeight: 12,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0],
          lineIndices: [0],
          lineOffsets: [{ lineIndex: 0, y: 0 }],
          lastLinePreDisplaySize: 90,
          standardMetrics: { width: 120, height: 8.5, depth: 3.5 },
          ruleLeadingMetrics: { width: 120, height: 8.5, depth: 3.5 },
          standardAdvance: 12,
          ruleLeadingAdvance: 12,
        },
        {
          blockIndex: 1,
          vlistPath: [4],
          lineIndices: [1],
          lineOffsets: [{ lineIndex: 1, y: 0 }],
          standardMetrics: { width: 120, height: 8.5, depth: 3.5 },
          ruleLeadingMetrics: { width: 120, height: 8.5, depth: 3.5 },
          standardAdvance: 12,
          ruleLeadingAdvance: 12,
        },
      ],
    });

    expect(layout.boxReport.items.filter((item) =>
      item.glue?.origin?.kind === "display-math-boundary"
    ).map((item) => item.glue)).toEqual([
      {
        size: 10,
        stretch: 2,
        shrink: 5,
        stretchOrder: "normal",
        shrinkOrder: "normal",
        origin: { kind: "display-math-boundary", side: "above", variant: "normal" },
      },
      {
        size: 10,
        stretch: 2,
        shrink: 5,
        stretchOrder: "normal",
        shrinkOrder: "normal",
        origin: { kind: "display-math-boundary", side: "below", variant: "normal" },
      },
    ]);
  });

  it("uses explicit placeholders for unsupported display math formulas", () => {
    const source = String.raw`\[\unknown{x}\]`;
    const parsed = parseSimpleTexParagraphIr(source);
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items, {
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      width: 120,
    });

    expect(vlist.items).toEqual([
      expect.objectContaining({
        kind: "placeholder",
        sourceSpan: { start: 0, end: source.length },
        reason: "TeX display math rendering is not implemented for this formula.",
        literalText: source,
      }),
    ]);
    const placeholder = vlist.items[0];
    if (placeholder?.kind !== "placeholder") {
      throw new Error("expected placeholder item");
    }
    expect(placeholder.estimated.width).toBeGreaterThan(0);
  });

  it("lowers explicit vertical glue commands into vlist glue", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \smallskip Beta \par \medskip Gamma \par \bigskip Delta \par \vspace{7pt} Epsilon \par \vskip -2pt Zeta`
    );
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items);

    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? {
            kind: item.kind,
            text: item.paragraph.text,
          }
        : {
            kind: item.kind,
            size: item.kind === "glue" ? item.size : undefined,
            origin: item.kind === "glue" ? item.origin : undefined,
            stretch: item.kind === "glue" ? item.stretch : undefined,
            shrink: item.kind === "glue" ? item.shrink : undefined,
          }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "glue",
        size: 3,
        origin: { kind: "explicit-command", command: "smallskip" },
        stretch: 1,
        shrink: 1,
      },
      { kind: "paragraph", text: "Beta" },
      {
        kind: "glue",
        size: 6,
        origin: { kind: "explicit-command", command: "medskip" },
        stretch: 2,
        shrink: 2,
      },
      { kind: "paragraph", text: "Gamma" },
      {
        kind: "glue",
        size: 12,
        origin: { kind: "explicit-command", command: "bigskip" },
        stretch: 4,
        shrink: 4,
      },
      { kind: "paragraph", text: "Delta" },
      {
        kind: "glue",
        size: 7,
        origin: { kind: "explicit-command", command: "vspace" },
        stretch: undefined,
        shrink: undefined,
      },
      { kind: "paragraph", text: "Epsilon" },
      {
        kind: "glue",
        size: -2,
        origin: { kind: "explicit-command", command: "vskip" },
        stretch: undefined,
        shrink: undefined,
      },
      { kind: "paragraph", text: "Zeta" },
    ]);
  });

  it("lowers explicit TeX hrule commands into vlist rules", () => {
    const source = String.raw`Alpha \par \hrule width 24pt height 2pt depth 1pt Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const ruleStart = source.indexOf(String.raw`\hrule`);
    const ruleEnd = source.indexOf("Beta");

    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items);
    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : item.kind === "rule"
          ? {
              kind: item.kind,
              width: item.width,
              height: item.height,
              depth: item.depth,
              sourceSpan: item.sourceSpan,
            }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "rule",
        width: 24,
        height: 2,
        depth: 1,
        sourceSpan: { start: ruleStart, end: ruleEnd },
      },
      { kind: "paragraph", text: "Beta" },
    ]);
  });

  it("lowers explicit TeX penalty commands into vlist penalties", () => {
    const source = String.raw`Alpha \par \penalty -50 Beta`;
    const parsed = parseSimpleTexParagraphIr(source);
    const penaltyStart = source.indexOf(String.raw`\penalty`);
    const penaltyEnd = source.indexOf(" Beta");

    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items);
    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : item.kind === "penalty"
          ? {
              kind: item.kind,
              penalty: item.penalty,
              sourceSpan: item.sourceSpan,
            }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "penalty",
        penalty: -50,
        sourceSpan: { start: penaltyStart, end: penaltyEnd },
      },
      { kind: "paragraph", text: "Beta" },
    ]);
  });

  it("lowers parbox commands into explicit-width nested vboxes", () => {
    const source = String.raw`\parbox[t]{40pt}{Alpha \par \begin{quote}Beta\end{quote}}`;
    const parsed = parseSimpleTexParagraphIr(source);
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items);

    expect(vlist.items).toHaveLength(1);
    expect(vlist.items[0]).toMatchObject({
      kind: "vbox",
      width: 40,
      alignment: "top",
      sourceSpan: {
        start: 0,
        end: source.length,
      },
    });
    const prepared = prepareSimpleTexVList(
      vlist,
      computerModernTexMetricProvider.resolveFont()
    );
    const parbox = prepared.normalized.items[0];
    if (parbox?.kind !== "vbox") {
      throw new Error("expected parbox vbox");
    }
    expect(parbox.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : item.kind === "vbox"
          ? { kind: item.kind, role: item.role }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      { kind: "vbox", role: { kind: "quote", depth: 1 } },
    ]);
  });

  it("uses parbox width as the descendant paragraph line width", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\parbox{55pt}{Alpha Beta Gamma Delta}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: { width: 200 },
    });

    expect(layout.paragraphPlans).toHaveLength(1);
    expect(layout.paragraphPlans[0]?.breakContext.width).toBe(55);
    expect(layout.paragraphPlans[0]?.breakContext.scopePolicy.leftMarginWidth).toBe(0);
    expect(layout.paragraphPlans[0]?.breakContext.scopePolicy.rightMarginWidth).toBe(0);
    expect(layout.paragraphPlans[0]?.breakContext.scopePolicy.allowParagraphIndent).toBe(false);
    expect(layout.paragraphPlans[0]?.breakContext.scopePolicy.allowForcedBreakIndent).toBe(false);
  });

  it("restores material box paragraph parameters from the current TeX scope", () => {
    const rightParsed = parseSimpleTexParagraphIr(
      String.raw`\parbox{55pt}{Alpha Beta Gamma Delta}`
    );
    const rightLayout = createSimpleTexLayoutDocumentIr({
      blocks: rightParsed.blocks,
      items: rightParsed.items,
      defaultAlignment: "ragged-left",
      font: computerModernTexMetricProvider.resolveFont(),
      options: { width: 200 },
    });
    expect(rightLayout.paragraphPlans[0]).toMatchObject({
      alignment: "justified",
      spaceGlueProfile: "tikz-fixed",
      breakContext: {
        scopePolicy: {
          finalHyphenDemerits: 0,
        },
      },
    });

    const justifiedParsed = parseSimpleTexParagraphIr(
      String.raw`\begin{minipage}{55pt}Alpha Beta Gamma Delta\end{minipage}`
    );
    const justifiedLayout = createSimpleTexLayoutDocumentIr({
      blocks: justifiedParsed.blocks,
      items: justifiedParsed.items,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: { width: 200 },
    });
    expect(justifiedLayout.paragraphPlans[0]).toMatchObject({
      alignment: "justified",
      spaceGlueProfile: "font",
      breakContext: {
        scopePolicy: {
          finalHyphenDemerits: 5000,
        },
      },
    });
  });

  it("lays out parbox content through the public simple TeX layout path", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\parbox{55pt}{Alpha Beta Gamma Delta}`,
      { width: 200 }
    );

    expect(result.supported).toBe(true);
    const parbox = result.vlistLayout?.items[0];
    expect(parbox).toMatchObject({
      item: { kind: "vbox" },
      metrics: { width: 55 },
    });
    expect(result.vlistLayout?.linePlacements.length).toBeGreaterThan(1);
  });

  it("lowers minipage environments through the same explicit-width vbox path", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{minipage}[t]{100pt}Alpha \par \begin{quote}Beta\end{quote}\end{minipage}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: { width: 200 },
    });

    expect(layout.vlist.items).toHaveLength(1);
    expect(layout.vlist.items[0]).toMatchObject({
      kind: "vbox",
      width: 100,
      alignment: "top",
    });
    expect(layout.paragraphPlans.map((plan) => ({
      text: plan.segment.text,
      width: plan.breakContext.width,
      left: plan.breakContext.scopePolicy.leftMarginWidth,
      right: plan.breakContext.scopePolicy.rightMarginWidth,
    }))).toEqual([
      { text: "Alpha", width: 100, left: 0, right: 0 },
      { text: "Beta", width: 100, left: 25, right: 25 },
    ]);
  });

  it("uses material box width once for quote and list paragraph skips", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\parbox{140pt}{\begin{quote}Alpha Beta\end{quote}\par\begin{itemize}\item Gamma Delta\end{itemize}}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: { width: 240 },
    });

    expect(layout.paragraphPlans.map((plan) => ({
      text: plan.segment.text,
      width: plan.breakContext.width,
      left: plan.breakContext.scopePolicy.leftMarginWidth,
      right: plan.breakContext.scopePolicy.rightMarginWidth,
      rightskipMode: plan.breakContext.scopePolicy.rightskipStretchMode,
    }))).toEqual([
      {
        text: "Alpha Beta",
        width: 140,
        left: 25,
        right: 25,
        rightskipMode: "ragged-right-infinite-otherwise-zero",
      },
      {
        text: "Gamma Delta",
        width: 140,
        left: 25,
        right: 0,
        rightskipMode: "default",
      },
    ]);
  });

  it("lays out minipage content through the public simple TeX layout path", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{minipage}{55pt}Alpha Beta Gamma Delta\end{minipage}`,
      { width: 200 }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.items[0]).toMatchObject({
      item: { kind: "vbox" },
      metrics: { width: 55 },
    });
    expect(result.vlistLayout?.linePlacements.length).toBeGreaterThan(1);
  });

  it("lays out text-mode mbox as one unbreakable inline hbox", () => {
    const plain = layoutSimpleTexParagraph(String.raw`A\mbox{b}Z`, {
      width: 200,
      parindent: 0,
    });
    const spaced = layoutSimpleTexParagraph(String.raw`A\mbox{ b }Z`, {
      width: 200,
      parindent: 0,
    });

    expect(plain.supported).toBe(true);
    expect(spaced.supported).toBe(true);
    const plainBox = plain.report?.lines.flatMap((line) => line.segments).find((segment) =>
      segment.kind === "math" && segment.sourceKind === "text"
    );
    const spacedBox = spaced.report?.lines.flatMap((line) => line.segments).find((segment) =>
      segment.kind === "math" && segment.sourceKind === "text"
    );
    const font = luaLatexDefaultTextFontProfile.resolveTextFont(
      luaLatexDefaultTextFontProfile.defaultFontState,
      10,
      computerModernTexMetricProvider
    );
    const spaceWidth = texInterwordGlueForSpaceFactor(font, 1000, "font").width;

    expect(plainBox).toMatchObject({
      kind: "math",
      text: "b",
      sourceStartRaw: 1,
      sourceEndRaw: 9,
      sourceKind: "text",
    });
    expect(spacedBox).toMatchObject({
      kind: "math",
      text: " b ",
      sourceStartRaw: 1,
      sourceEndRaw: 11,
      sourceKind: "text",
    });
    expect(spacedBox?.width ?? 0).toBeCloseTo((plainBox?.width ?? 0) + 2 * spaceWidth, 1);
    expect(spacedBox?.mathSvgBody).toContain("data-tex-math-hlist");
  });

  it("lays out text-mode makebox with fixed widths", () => {
    const result = layoutSimpleTexParagraph(String.raw`A\makebox[20pt][r]{b}Z`, {
      width: 200,
      parindent: 0,
    });

    expect(result.supported).toBe(true);
    const segments = result.report?.lines[0]?.segments ?? [];
    const box = segments.find((segment) =>
      segment.kind === "math" && segment.sourceKind === "text"
    );
    const z = segments.find((segment) =>
      segment.kind === "text" && segment.text === "Z"
    );
    expect(box).toMatchObject({
      kind: "math",
      text: "b",
      sourceKind: "text",
      width: 20,
    });
    expect(z?.x).toBeCloseTo((box?.x ?? 0) + 20, 6);
  });

  it("lays out text-mode llap and rlap as zero-width inline hboxes", () => {
    const llap = layoutSimpleTexParagraph(String.raw`A\llap{b}Z`, {
      width: 200,
      parindent: 0,
    });
    const rlap = layoutSimpleTexParagraph(String.raw`A\rlap{b}Z`, {
      width: 200,
      parindent: 0,
    });

    expect(llap.supported).toBe(true);
    expect(rlap.supported).toBe(true);
    const llapSegments = llap.report?.lines[0]?.segments ?? [];
    const rlapSegments = rlap.report?.lines[0]?.segments ?? [];
    const llapBox = llapSegments.find((segment) =>
      segment.kind === "math" && segment.sourceKind === "text"
    );
    const rlapBox = rlapSegments.find((segment) =>
      segment.kind === "math" && segment.sourceKind === "text"
    );
    const llapZ = llapSegments.find((segment) =>
      segment.kind === "text" && segment.text === "Z"
    );
    const rlapZ = rlapSegments.find((segment) =>
      segment.kind === "text" && segment.text === "Z"
    );
    expect(llapBox?.width).toBeCloseTo(0, 6);
    expect(rlapBox?.width).toBeCloseTo(0, 6);
    expect(llapZ?.x).toBeCloseTo(llapBox?.x ?? 0, 6);
    expect(rlapZ?.x).toBeCloseTo(rlapBox?.x ?? 0, 6);
    expect(llapBox?.mathSvgBody).toContain("data-tex-math-hlist");
    expect(rlapBox?.mathSvgBody).toContain("data-tex-math-hlist");
  });

  it("lays out text-mode fbox and framebox with TeX frame dimensions", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\mbox{g}\fbox{g}\framebox{g}\framebox[20pt][r]{g}`
    );
    const block = parsed.blocks[0];

    expect(block).toBeDefined();
    const boxes = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile
        ).filter((item) => item.kind === "text-box")
      : [];
    const natural = boxes[0]?.box;
    const fbox = boxes[1]?.box;
    const framebox = boxes[2]?.box;
    const fixed = boxes[3]?.box;
    const fixedRules = fixed?.hlist?.items.filter((item) => item.kind === "rule") ?? [];
    const fixedBody = fixed?.hlist?.items.find((item) =>
      item.kind === "hlist" && item.role === "boxed-body"
    );
    const fixedGlyph = fixedBody?.kind === "hlist"
      ? fixedBody.items.find((item) => item.kind === "glyph")
      : undefined;

    expect(boxes).toHaveLength(4);
    for (const box of [fbox, framebox]) {
      expect(box?.width).toBeCloseTo((natural?.width ?? 0) + 6.8, 6);
      expect(box?.height).toBeCloseTo((natural?.height ?? 0) + 3.4, 6);
      expect(box?.depth).toBeCloseTo((natural?.depth ?? 0) + 3.4, 6);
      expect(box?.hlist?.items.map((item) => item.kind)).toEqual([
        "rule",
        "rule",
        "kern",
        "hlist",
        "kern",
        "rule",
        "rule",
      ]);
      expect(box?.hlist?.items[2]).toMatchObject({
        kind: "kern",
        x: 0.4,
        width: 3,
      });
      expect(box?.hlist?.items[3]).toMatchObject({
        kind: "hlist",
        role: "boxed-body",
        x: 3.4,
      });
      expect(box?.hlist?.items[4]).toMatchObject({
        kind: "kern",
        x: expect.closeTo((natural?.width ?? 0) + 3.4, 6),
        width: 3,
      });
    }
    expect(fixed).toMatchObject({
      width: 20,
      height: expect.closeTo((natural?.height ?? 0) + 3.4, 6),
      depth: expect.closeTo((natural?.depth ?? 0) + 3.4, 6),
    });
    expect(fixed?.hlist?.items[0]).toMatchObject({
      kind: "rule",
      width: 20,
      height: 0.4,
    });
    expect(fixedRules[2]).toMatchObject({
      kind: "rule",
      x: 19.6,
      width: 0.4,
    });
    expect(fixedBody).toMatchObject({
      kind: "hlist",
      role: "boxed-body",
      x: 3,
      width: expect.closeTo(20 - 6, 6),
    });
    expect(fixedGlyph?.kind === "glyph" ? fixedGlyph.x : undefined)
      .toBeCloseTo(20 - 6 - (natural?.width ?? 0), 6);
  });

  it("lays out colored LR boxes with fboxsep and an optional fboxrule frame", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\mbox{g}\colorbox{yellow}{g}\fcolorbox{red}{blue}{g}`
    );
    const block = parsed.blocks[0];
    const boxes = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile
        ).filter((item) => item.kind === "text-box")
      : [];
    const natural = boxes[0]?.box;
    const colorbox = boxes[1]?.box;
    const fcolorbox = boxes[2]?.box;
    const colorRules = colorbox?.hlist?.items.filter((item) => item.kind === "rule") ?? [];
    const framedRules = fcolorbox?.hlist?.items.filter((item) => item.kind === "rule") ?? [];

    expect(colorbox?.width).toBeCloseTo((natural?.width ?? 0) + 6, 6);
    expect(colorbox?.height).toBeCloseTo((natural?.height ?? 0) + 3, 6);
    expect(colorbox?.depth).toBeCloseTo((natural?.depth ?? 0) + 3, 6);
    expect(colorRules).toMatchObject([
      { role: "colorbox-background", color: "#ffff00", x: 0 },
    ]);
    expect(fcolorbox?.width).toBeCloseTo((natural?.width ?? 0) + 6.8, 6);
    expect(fcolorbox?.height).toBeCloseTo((natural?.height ?? 0) + 3.4, 6);
    expect(fcolorbox?.depth).toBeCloseTo((natural?.depth ?? 0) + 3.4, 6);
    expect(framedRules[0]).toMatchObject({ role: "colorbox-background", color: "#0000ff" });
    expect(framedRules.slice(1)).toHaveLength(4);
    expect(framedRules.slice(1).every((rule) => rule.color === "#ff0000")).toBe(true);
  });

  it("keeps unsupported makebox dimensions outside the simple text path", () => {
    const analysis = analyzeSimpleTexParagraph(String.raw`A\makebox[\width]{b}Z`, 120);
    const framebox = analyzeSimpleTexParagraph(String.raw`A\framebox[\width]{b}Z`, 120);

    expect(analysis.ir?.unsupportedCommand).toBe(true);
    expect(analysis.fallbackReason).toBe("Paragraph contains TeX syntax that is not supported by the simple text path.");
    expect(framebox.ir?.unsupportedCommand).toBe(true);
    expect(framebox.fallbackReason).toBe("Paragraph contains TeX syntax that is not supported by the simple text path.");
  });

  it("lays out text-mode rule as an inline TeX rule box", () => {
    const analysis = analyzeSimpleTexParagraph(String.raw`\rule[3pt]{12pt}{2pt} Alpha`, 120);
    const parsed = parseSimpleTexParagraphIr(String.raw`A\rule[3pt]{12pt}{2pt}Z`);
    const block = parsed.blocks[0];

    expect(analysis.fallbackReason).toBeNull();
    expect(block).toBeDefined();
    const items = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile
        )
      : [];
    const ruleTextBox = items.find((item) =>
      item.kind === "text-box" && item.command === "rule"
    );
    const ruleBox = ruleTextBox?.kind === "text-box" ? ruleTextBox.box : undefined;
    const ruleItem = ruleBox?.hlist?.items.find((item) => item.kind === "rule");

    expect(ruleBox).toMatchObject({
      sourceKind: "text",
      width: 12,
      height: 5,
      depth: 0,
    });
    expect(ruleItem).toMatchObject({
      kind: "rule",
      role: "literal-rule",
      x: 0,
      y: -5,
      width: 12,
      height: 2,
    });
  });

  it("lays out resolved includegraphics as an inline TeX SVG image box", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`A\includegraphics[width=40pt,height=30pt,keepaspectratio]{fig}Z`
    );
    const block = parsed.blocks[0];
    const graphicsResolver: NodeTextGraphicsResolver = {
      cacheKey: "test-image-v1",
      resolve: () => ({
        status: "resolved",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
        naturalWidthPt: 20,
        naturalHeightPt: 10,
        revision: "r1",
        resolvedPath: "/tmp/fig.png",
      }),
    };
    const items = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile,
          graphicsResolver
        )
      : [];
    const graphicsItem = items.find((item) =>
      item.kind === "text-box" && item.command === "includegraphics"
    );
    const box = graphicsItem?.kind === "text-box" ? graphicsItem.box : undefined;

    expect(box).toMatchObject({
      sourceKind: "text",
      content: "fig",
      width: 40,
      height: 20,
      depth: 0,
    });
    expect(box?.hlist).toBeUndefined();
    expect(box?.svgBody).toContain('data-tex-includegraphics="true"');
    expect(box?.svgBody).toContain('<image x="0" y="-2000" width="4000" height="2000"');
    expect(box?.svgBody).toContain('href="data:image/png;base64,aW1hZ2U="');
    expect(box?.svgBody).not.toContain("/tmp/fig.png");
  });

  it("lays out includegraphics trim, clip, and viewport crop boxes", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\includegraphics[trim=10pt 5pt 20pt 15pt]{fig}\includegraphics[trim=10pt 5pt 20pt 15pt,width=45pt]{fig}\includegraphics[trim=10pt 5pt 20pt 15pt,width=45pt,height=60pt,keepaspectratio]{fig}\includegraphics[trim=10pt 5pt 20pt 15pt,clip]{fig}\includegraphics[viewport=10pt 5pt 100pt 65pt,clip]{fig}`
    );
    const block = parsed.blocks[0];
    const graphicsResolver: NodeTextGraphicsResolver = {
      cacheKey: "test-cropped-image-v1",
      resolve: () => ({
        status: "resolved",
        mimeType: "image/png",
        dataBase64: "aW1hZ2U=",
        naturalWidthPt: 120,
        naturalHeightPt: 80,
        revision: "r1",
        resolvedPath: "/tmp/fig.png",
      }),
    };
    const boxes = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile,
          graphicsResolver
        ).filter((item): item is Extract<typeof item, { kind: "text-box" }> =>
          item.kind === "text-box" && item.command === "includegraphics"
        )
      : [];

    expect(boxes).toHaveLength(5);
    expect(boxes[0]?.box).toMatchObject({ width: 90, height: 60, depth: 0 });
    expect(boxes[1]?.box).toMatchObject({ width: 45, height: 30, depth: 0 });
    expect(boxes[2]?.box).toMatchObject({ width: 45, height: 30, depth: 0 });
    expect(boxes[3]?.box).toMatchObject({ width: 90, height: 60, depth: 0 });
    expect(boxes[4]?.box).toMatchObject({ width: 90, height: 60, depth: 0 });
    expect(boxes[0]?.box.svgBody).toContain(
      '<svg x="0" y="-6000" width="9000" height="6000" overflow="visible" viewBox="1000 1500 9000 6000" preserveAspectRatio="none">'
    );
    expect(boxes[0]?.box.svgBody).toContain('<image x="0" y="0" width="12000" height="8000"');
    expect(boxes[3]?.box.svgBody).toContain('overflow="hidden" viewBox="1000 1500 9000 6000"');
    expect(boxes[4]?.box.svgBody).toContain('overflow="hidden" viewBox="1000 1500 9000 6000"');
    expect(boxes[0]?.box.svgBody).not.toContain("/tmp/fig.png");
  });

  it("lays out missing includegraphics placeholders with draft-like fallback dimensions", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\includegraphics{missing}\includegraphics[width=20pt]{missing}\includegraphics[height=12pt]{missing}\includegraphics[width=20pt,height=12pt]{missing}`
    );
    const block = parsed.blocks[0];
    const boxes = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile
        ).filter((item): item is Extract<typeof item, { kind: "text-box" }> =>
          item.kind === "text-box" && item.command === "includegraphics"
        )
      : [];

    expect(boxes).toHaveLength(4);
    expect(boxes[0]?.box.width).toBeCloseTo(28.452756, 5);
    expect(boxes[0]?.box.height).toBeCloseTo(28.452756, 5);
    expect(boxes[1]?.box.width).toBeCloseTo(20, 6);
    expect(boxes[1]?.box.height).toBeCloseTo(28.452756, 5);
    expect(boxes[2]?.box.width).toBeCloseTo(28.452756, 5);
    expect(boxes[2]?.box.height).toBeCloseTo(12, 6);
    expect(boxes[3]?.box.width).toBeCloseTo(20, 6);
    expect(boxes[3]?.box.height).toBeCloseTo(12, 6);
    expect(boxes[0]?.box.svgBody).toContain('data-tex-includegraphics="placeholder"');
    expect(boxes[0]?.box.svgBody).toContain('data-tex-includegraphics-status="missing"');
  });

  it("lays out text-mode raisebox with natural and explicit dimensions", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\mbox{g}\raisebox{3pt}{g}\raisebox{3pt}[2pt][4pt]{g}`
    );
    const block = parsed.blocks[0];

    expect(block).toBeDefined();
    const boxes = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile
        ).filter((item) => item.kind === "text-box")
      : [];
    const plain = boxes[0]?.box;
    const raised = boxes[1]?.box;
    const explicit = boxes[2]?.box;

    expect(raised?.width).toBeCloseTo(plain?.width ?? 0, 6);
    expect(raised?.height).toBeCloseTo((plain?.height ?? 0) + 3, 6);
    expect(raised?.depth).toBeCloseTo(Math.max(0, (plain?.depth ?? 0) - 3), 6);
    expect(raised?.hlist?.items[0]).toMatchObject({
      kind: "hlist",
      y: -3,
    });
    expect(explicit).toMatchObject({
      width: plain?.width,
      height: 2,
      depth: 4,
    });
    expect(explicit?.hlist?.items[0]).toMatchObject({
      kind: "hlist",
      y: -3,
    });
  });

  it("keeps unsupported rule and raisebox dimensions outside the simple text path", () => {
    const rule = analyzeSimpleTexParagraph(String.raw`A\rule{1em}{1pt}Z`, 120);
    const raisebox = analyzeSimpleTexParagraph(String.raw`A\raisebox{\height}{x}Z`, 120);
    const raiseboxEmptyHeightWithDepth = analyzeSimpleTexParagraph(String.raw`A\raisebox{1pt}[][2pt]{x}Z`, 120);

    expect(rule.ir?.unsupportedCommand).toBe(true);
    expect(rule.fallbackReason).toBe("Paragraph contains TeX syntax that is not supported by the simple text path.");
    expect(raisebox.ir?.unsupportedCommand).toBe(true);
    expect(raisebox.fallbackReason).toBe("Paragraph contains TeX syntax that is not supported by the simple text path.");
    expect(raiseboxEmptyHeightWithDepth.ir?.unsupportedCommand).toBe(true);
    expect(raiseboxEmptyHeightWithDepth.fallbackReason).toBe("Paragraph contains TeX syntax that is not supported by the simple text path.");
  });

  it("lays out text-mode phantom and smash dimension boxes", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\mbox{g}\phantom{g}\hphantom{g}\vphantom{g}\smash{g}`
    );
    const block = parsed.blocks[0];

    expect(block).toBeDefined();
    const boxes = block
      ? simpleTexInlineNodesToLayoutItems(
          block.nodes,
          block.sourceStart,
          block.sourceEnd,
          10,
          computerModernTexMetricProvider,
          "font",
          undefined,
          undefined,
          luaLatexDefaultTextFontProfile
        ).filter((item) => item.kind === "text-box")
      : [];
    const natural = boxes[0]?.box;
    const phantom = boxes[1]?.box;
    const hphantom = boxes[2]?.box;
    const vphantom = boxes[3]?.box;
    const smash = boxes[4]?.box;

    expect(boxes).toHaveLength(5);
    expect(natural?.hlist?.items.length).toBeGreaterThan(0);
    expect(phantom).toMatchObject({
      width: natural?.width,
      height: natural?.height,
      depth: natural?.depth,
    });
    expect(phantom?.hlist?.items).toEqual([]);
    expect(hphantom).toMatchObject({
      width: natural?.width,
      height: 0,
      depth: 0,
    });
    expect(hphantom?.hlist?.items).toEqual([]);
    expect(vphantom).toMatchObject({
      width: 0,
      height: natural?.height,
      depth: natural?.depth,
    });
    expect(vphantom?.hlist?.items).toEqual([]);
    expect(smash).toMatchObject({
      width: natural?.width,
      height: 0,
      depth: 0,
    });
    expect(smash?.hlist?.items.length).toBe(natural?.hlist?.items.length);
  });

  it("keeps smashed-only paragraph lines at zero height and depth", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Editor model chapter future. \smash{actual alignment} \smash{document} Layout compact document.`,
      {
        width: 150,
        alignment: "center",
        parindent: 15,
        mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
        textFontProfile: luaLatexDefaultTextFontProfile,
      }
    );

    expect(result.supported).toBe(true);
    const smashedLine = result.report?.lines[1];
    expect(smashedLine).toMatchObject({
      ascent: 0,
      descent: 0,
    });
    expect(smashedLine?.segments.map((segment) => segment.kind)).toEqual([
      "math",
      "space",
      "math",
    ]);
    expect(result.vlistLayout?.linePlacements.map((placement) => ({
      y: placement.y,
      height: placement.height,
    }))).toEqual([
      { y: 0, height: 8.99 },
      { y: 19.05, height: 0 },
      { y: 24.11, height: 8.99 },
    ]);
  });

  it("lays out inline math inside text-mode mbox content", () => {
    const source = String.raw`Alpha \mbox{node $x$} Omega`;
    const result = layoutSimpleTexParagraph(source, {
      width: 200,
      parindent: 0,
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });

    expect(result.supported).toBe(true);
    const box = result.report?.lines.flatMap((line) => line.segments).find((segment) =>
      segment.kind === "math" && segment.sourceKind === "text"
    );
    expect(box).toMatchObject({
      text: "node $x$",
      sourceStartRaw: source.indexOf(String.raw`\mbox`),
      sourceEndRaw: source.indexOf(" Omega"),
      sourceKind: "text",
    });
    expect(box?.mathSvgBody).toContain('data-tex-font="cmmi10"');
  });

  it("lowers block-position unsupported commands as literal paragraphs", () => {
    const source = String.raw`Alpha \par \unsupportedgraphics[width=1cm]{plot.pdf} \par Beta`;
    const parsed = parseSimpleTexParagraphIr(source);

    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items);
    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      { kind: "paragraph", text: String.raw`\unsupportedgraphics[width=1cm]{plot.pdf}` },
      { kind: "paragraph", text: "Beta" },
    ]);
  });

  it("groups scoped unsupported commands into quote vboxes as literal paragraphs", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote}\unsupportedgraphics{plot.pdf} \par Alpha\end{quote}`
    );
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlockItemsToVList(parsed.items),
      computerModernTexMetricProvider.resolveFont()
    );

    expect(parsed.unsupportedCommand).toBe(false);
    expect(grouped.items).toHaveLength(1);
    const quote = grouped.items[0];
    expect(quote).toMatchObject({
      kind: "vbox",
      role: { kind: "quote", depth: 1 },
    });
    if (quote?.kind !== "vbox") {
      throw new Error("expected quote vbox");
    }
    expect(quote.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: String.raw`\unsupportedgraphics{plot.pdf}` },
      { kind: "paragraph", text: "Alpha" },
    ]);
  });

  it("groups explicit vertical primitives into quote vboxes", () => {
    const source = String.raw`\begin{quote}Alpha \par \vspace{7pt} Beta \par \hrule width 24pt height 2pt depth 1pt Gamma\end{quote}`;
    const parsed = parseSimpleTexParagraphIr(source);
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlockItemsToVList(parsed.items),
      computerModernTexMetricProvider.resolveFont()
    );

    expect(grouped.items).toHaveLength(1);
    const quote = grouped.items[0];
    expect(quote).toMatchObject({
      kind: "vbox",
      role: { kind: "quote", depth: 1 },
    });
    if (quote?.kind !== "vbox") {
      throw new Error("expected quote vbox");
    }
    expect(quote.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : item.kind === "glue"
          ? {
              kind: item.kind,
              size: item.size,
              command: item.origin?.kind === "explicit-command" ? item.origin.command : null,
              scopeKinds: item.scopePath?.map((role) => role.kind),
            }
          : item.kind === "rule"
            ? {
                kind: item.kind,
                width: item.width,
                height: item.height,
                depth: item.depth,
                scopeKinds: item.scopePath?.map((role) => role.kind),
              }
            : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "glue",
        size: 7,
        command: "vspace",
        scopeKinds: ["quote"],
      },
      { kind: "paragraph", text: "Beta" },
      {
        kind: "rule",
        width: 24,
        height: 2,
        depth: 1,
        scopeKinds: ["quote"],
      },
      { kind: "paragraph", text: "Gamma" },
    ]);
  });

  it("groups explicit vertical primitives into the owning list-item vbox", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{itemize}\item Alpha \par \vspace{7pt} More\item Beta\end{itemize}`
    );
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlockItemsToVList(parsed.items),
      computerModernTexMetricProvider.resolveFont()
    );
    const list = grouped.items[0];
    if (list?.kind !== "vbox" || list.role?.kind !== "list") {
      throw new Error("expected list vbox");
    }
    const firstItem = list.items[0];
    const secondItem = list.items[1];
    if (
      firstItem?.kind !== "vbox" ||
      firstItem.role?.kind !== "list-item" ||
      secondItem?.kind !== "vbox" ||
      secondItem.role?.kind !== "list-item"
    ) {
      throw new Error("expected list-item vboxes");
    }

    expect(firstItem.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : item.kind === "glue"
          ? {
              kind: item.kind,
              size: item.size,
              command: item.origin?.kind === "explicit-command" ? item.origin.command : null,
              scopeKinds: item.scopePath?.map((role) => role.kind),
            }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "glue",
        size: 7,
        command: "vspace",
        scopeKinds: ["list", "list-item"],
      },
      { kind: "paragraph", text: "More" },
    ]);
    expect(secondItem.items.map((item) =>
      item.kind === "paragraph" ? { kind: item.kind, text: item.paragraph.text } : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Beta" },
    ]);
  });
});

describe("TeX vlist scopes", () => {
  it("derives paragraph scope context from vbox ancestors", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote}\begin{enumerate}\item Alpha\end{enumerate}\end{quote}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });
    const grouped = groupSimpleTexVListScopes(
      layout.vlist,
      computerModernTexMetricProvider.resolveFont()
    );
    const quoteBox = grouped.items[0];
    const listBox = quoteBox?.kind === "vbox" ? quoteBox.items[0] : undefined;
    const listItemBox = listBox?.kind === "vbox" ? listBox.items[0] : undefined;
    if (quoteBox?.kind !== "vbox" || listBox?.kind !== "vbox" || listItemBox?.kind !== "vbox") {
      throw new Error("expected nested quote/list/list-item vboxes");
    }

    expect(texParagraphScopeContext([quoteBox, listBox, listItemBox])).toMatchObject({
      policy: {
        fallbackAlignment: "justified",
        preserveRaggedRight: true,
        raggedRightProfile: "latex-quote",
        resetInheritedAlignment: true,
        resetSpaceGlueProfile: true,
      },
      layout: {
        leftMarginWidth: 47,
        rightMarginWidth: 25,
      },
      quoteContextActive: true,
      listContextActive: true,
      listItemLayout: {
        itemIndex: 1,
        label: {
          kind: "default",
          placement: "margin",
          content: { kind: "text", text: "1." },
          rightEdge: 42,
        },
      },
    });
  });

  it("groups quote and list paragraph ranges as structural vboxes", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote}\begin{enumerate}\item Alpha\item Beta\end{enumerate}\end{quote}`
    );
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });
    const grouped = groupSimpleTexVListScopes(
      layout.vlist,
      computerModernTexMetricProvider.resolveFont()
    );

    expect(grouped.items).toHaveLength(1);
    const quoteBox = grouped.items[0];
    expect(quoteBox).toMatchObject({
      kind: "vbox",
      role: { kind: "quote", depth: 1 },
      sourceSpan: {
        start: parsed.blocks[0]?.sourceStart,
        end: parsed.blocks[1]?.sourceEnd,
      },
    });
    if (quoteBox?.kind !== "vbox") {
      throw new Error("expected quote vbox");
    }
    expect(quoteBox.items).toHaveLength(1);
    const listBox = quoteBox.items[0];
    expect(listBox).toMatchObject({
      kind: "vbox",
      role: {
        kind: "list",
        listKind: "enumerate",
        depth: 2,
        labelDepth: 1,
        ownLeftMarginEm: 2.2,
        totalLeftMarginEm: 2.2,
      },
      sourceSpan: {
        start: parsed.blocks[0]?.sourceStart,
        end: parsed.blocks[1]?.sourceEnd,
      },
    });
    if (listBox?.kind !== "vbox") {
      throw new Error("expected list vbox");
    }
    expect(listBox.items.map((item) =>
      item.kind === "vbox"
        ? {
            kind: item.kind,
            role: item.role,
            layout: item.layout,
            children: item.items.map((child) =>
              child.kind === "paragraph"
                ? { kind: child.kind, text: child.paragraph.text }
                : { kind: child.kind, size: child.kind === "glue" ? child.size : undefined }
            ),
          }
        : { kind: item.kind }
    )).toEqual([
      {
        kind: "vbox",
        role: {
          kind: "list-item",
          listKind: "enumerate",
          depth: 2,
          labelDepth: 1,
          itemIndex: 1,
        },
        layout: {
          leftMarginWidth: 0,
          rightMarginWidth: 0,
          listItem: {
            itemIndex: 1,
            label: {
              kind: "default",
              placement: "margin",
              content: { kind: "text", text: "1." },
              rightEdge: 42,
            },
          },
        },
        children: [
          { kind: "glue", size: 13 },
          { kind: "hbox", size: undefined },
          { kind: "paragraph", text: "Alpha" },
        ],
      },
      {
        kind: "vbox",
        role: {
          kind: "list-item",
          listKind: "enumerate",
          depth: 2,
          labelDepth: 1,
          itemIndex: 2,
        },
        layout: {
          leftMarginWidth: 0,
          rightMarginWidth: 0,
          listItem: {
            itemIndex: 2,
            label: {
              kind: "default",
              placement: "margin",
              content: { kind: "text", text: "2." },
              rightEdge: 42,
            },
          },
        },
        children: [
          { kind: "glue", size: 4 },
          { kind: "hbox", size: undefined },
          { kind: "paragraph", text: "Beta" },
        ],
      },
    ]);
    expect(flattenVListLeaves(grouped.items)).toEqual(flattenVListLeaves(layout.vlist.items));
  });

  it("groups quotation paragraph ranges as quote structural vboxes", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quotation}Alpha\par Beta\end{quotation}`
    );
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      computerModernTexMetricProvider.resolveFont()
    );

    expect(parsed.unsupportedCommand).toBe(false);
    expect(grouped.items).toHaveLength(1);
    const quoteBox = grouped.items[0];
    expect(quoteBox).toMatchObject({
      kind: "vbox",
      role: { kind: "quote", depth: 1 },
      sourceSpan: {
        start: parsed.blocks[0]?.sourceStart,
        end: parsed.blocks[1]?.sourceEnd,
      },
    });
    if (quoteBox?.kind !== "vbox") {
      throw new Error("expected quotation vbox");
    }
    expect(quoteBox.items.map((item) =>
      item.kind === "paragraph"
        ? { kind: item.kind, text: item.paragraph.text }
        : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      { kind: "paragraph", text: "Beta" },
    ]);
  });

  it("records list item label source metadata on list-item vboxes", () => {
    const source = String.raw`\begin{enumerate}\item[Step] Alpha\end{enumerate}\begin{description}\item[Term] Beta\end{description}`;
    const parsed = parseSimpleTexParagraphIr(source);
    const layout = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });
    const grouped = groupSimpleTexVListScopes(
      layout.vlist,
      computerModernTexMetricProvider.resolveFont()
    );

    const listItemLayouts = collectVListBoxes(grouped.items)
      .filter((item) => item.role?.kind === "list-item")
      .map((item) => ({
        role: item.role,
        listItem: item.layout?.listItem,
      }));

    expect(listItemLayouts).toEqual([
      {
        role: {
          kind: "list-item",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
        },
        listItem: {
          itemIndex: 1,
          label: {
            kind: "custom",
            placement: "margin",
            content: { kind: "source" },
            rightEdge: 20,
            sourceSpan: {
              start: source.indexOf("Step"),
              end: source.indexOf("Step") + "Step".length,
            },
          },
        },
      },
      {
        role: {
          kind: "list-item",
          listKind: "description",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
        },
        listItem: {
          itemIndex: 1,
          label: {
            kind: "description",
            placement: "inline",
            content: { kind: "source" },
            fontState: {
              family: "roman",
              series: "bold",
              shape: "upright",
            },
            rightEdge: 20,
            sourceSpan: {
              start: source.indexOf("Term"),
              end: source.indexOf("Term") + "Term".length,
            },
          },
          description: {
            labelFirstLineIndentWidth: -20,
            bodyFirstLineIndentWidth: -25,
          },
        },
      },
    ]);
    expect(collectVListBoxes(layout.vlist.items)
      .filter((item) => item.role?.kind === "list-item" && item.role.listKind === "description")
      .map((item) => ({
        labelKind: item.layout?.listItem?.label?.kind,
        descriptionLabelFirstLineIndentWidth: item.layout?.listItem?.description?.labelFirstLineIndentWidth,
        descriptionBodyFirstLineIndentWidth: item.layout?.listItem?.description?.bodyFirstLineIndentWidth,
      }))
    ).toEqual([
      {
        labelKind: "description",
        descriptionLabelFirstLineIndentWidth: -20,
        descriptionBodyFirstLineIndentWidth: -25,
      },
    ]);
  });

  it("builds list label hbox attachments from list-item vbox metadata", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{enumerate}\item Alpha\end{enumerate}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      font
    );
    const paragraph = texVListParagraphItems(grouped.items)[0];
    const listItemBox = collectVListBoxes(grouped.items)
      .find((item) => item.role?.kind === "list-item");
    if (!paragraph || !listItemBox) {
      throw new Error("expected list paragraph and list-item vbox");
    }

    const attachments = texListItemParagraphAttachments({
      blockIndex: paragraph.blockIndex,
      segmentIndex: 0,
      listContext: paragraph.paragraph.listContext,
      listItemLayout: listItemBox.layout?.listItem,
      font,
      metricProvider: computerModernTexMetricProvider,
      spaceGlueProfile: "font",
      inlineNodesToItems: simpleTexInlineNodesToLayoutItems,
    });

    expect(attachments.marginLabel).toMatchObject({
      rightEdge: 20,
      sourceStart: 0,
      sourceEnd: 0,
    });
    expect(attachments.marginLabelHBox).toMatchObject({
      kind: "hbox",
      role: {
        kind: "list-label",
        labelKind: "default",
        placement: "margin",
        listKind: "enumerate",
        depth: 1,
        labelDepth: 1,
        itemIndex: 1,
        blockIndex: 0,
      },
      x: expect.any(Number),
      advance: 0,
      affectsVBoxBaseline: false,
      box: {
        metrics: {
          width: expect.any(Number),
          height: expect.any(Number),
          depth: expect.any(Number),
        },
      },
    });
  });

  it("prepares scoped paragraph plans through the vlist API", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{enumerate}\item Alpha\end{enumerate}`
    );
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

    expect(preparation.layoutMode).toBe("wrap");
    expect(preparation.paragraphPlans).toHaveLength(1);
    expect(preparation.paragraphPlans[0]).toMatchObject({
      blockIndex: 0,
      vlistPath: [0, 0, 2],
      segmentIndex: 0,
      segment: { text: "Alpha" },
      breakContext: {
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
    expect(flattenVListLeaves(preparation.vlist.items)).toEqual([
      "glue:13",
      "hbox",
      "paragraph:Alpha",
    ]);
  });

  it("breaks scoped paragraph plans through the vlist API", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote}Alpha Beta\end{quote}`
    );
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

    const result = breakSimpleTexLayoutDocumentParagraphs({
      layoutIr: preparation,
      font,
      metricProvider: computerModernTexMetricProvider,
      options: { width: 90 },
    });

    expect(result.status).toBe("broken");
    if (result.status !== "broken") {
      return;
    }
    expect(result.entries).toHaveLength(1);
    expect(preparation.paragraphPlans[0]?.breakContext).toMatchObject({
      scopePolicy: {
        leftMarginWidth: 25,
        rightMarginWidth: 25,
        allowParagraphIndent: true,
        allowForcedBreakIndent: true,
        forceParfillStretch: true,
        suppressRaggedLeftCenterLeftskipStretch: true,
        rightskipStretchMode: "ragged-right-infinite-otherwise-zero",
      },
    });
    expect(result.entries[0]?.paragraph).toEqual({
      blockIndex: 0,
      vlistPath: [0, 1],
      forcedBreakAfter: undefined,
    });
    expect(result.entries[0]?.broken.lines[0]).toMatchObject({
      lineIndex: 0,
      targetWidth: 90,
      xOffset: 25,
    });
  });

  it("prepares simple TeX documents through the vlist API", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{itemize}\item Beta\end{itemize}`
    );
    const font = computerModernTexMetricProvider.resolveFont();

    const preparation = prepareSimpleTexLayoutDocument({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font,
      metricProvider: computerModernTexMetricProvider,
      options: {},
    });

    expect(preparation.kind).toBe("simple-tex-layout-document-preparation");
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
      text: plan.segment.text,
      leftMarginWidth: plan.breakContext.scopePolicy.leftMarginWidth,
      hasLabel: plan.lineLabel != null,
    }))).toEqual([
      { text: "Alpha", leftMarginWidth: 0, hasLabel: false },
      { text: "Beta", leftMarginWidth: 25, hasLabel: true },
    ]);
  });

  it("attaches hboxes before matching paragraph items inside nested vlists", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote} Alpha \par Beta \end{quote}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const prepared = prepareSimpleTexVList(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      font
    );
    const label = {
      kind: "hbox",
      role: {
        kind: "list-label",
        labelKind: "default",
        placement: "margin",
        listKind: "enumerate",
        depth: 1,
        labelDepth: 1,
        itemIndex: 1,
        blockIndex: 1,
      },
      box: {
        metrics: { width: 5, height: 7, depth: 2 },
        renderItems: [],
      },
    } as const;

    const attached = attachTexHBoxesBeforeVListParagraphs(
      prepared.normalized,
      [{ vlistPath: [0, 3], hbox: label }]
    );

    expect(flattenVListLeaves(attached.vlist.items)).toEqual([
      "glue:10",
      "paragraph:Alpha",
      "glue:4",
      "hbox",
      "paragraph:Beta",
    ]);
    expect(attached.paragraphPathRemaps).toEqual([
      { from: [0, 1], to: [0, 1] },
      { from: [0, 3], to: [0, 4] },
    ]);
  });
});

describe("TeX vlist spacing", () => {
  it("inserts named vlist glue before paragraph items from paragraph skip facts", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`Alpha \par Beta \par Gamma`);
    const vlist = addParagraphVerticalGlueToVList(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      [
        { blockIndex: 0, vlistPath: [0], segmentIndex: 0, quoteSize: 0, listSize: 0, size: 0 },
        { blockIndex: 1, vlistPath: [1], segmentIndex: 0, quoteSize: 10, listSize: 0, size: 10 },
        { blockIndex: 1, vlistPath: [1], segmentIndex: 1, quoteSize: 99, listSize: 0, size: 99 },
        { blockIndex: 2, vlistPath: [2], segmentIndex: 0, quoteSize: 0, listSize: 4, size: 4 },
      ]
    );

    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? {
            kind: item.kind,
            text: item.paragraph.text,
          }
        : {
            kind: item.kind,
            size: item.kind === "glue" ? item.size : undefined,
            origin: item.kind === "glue" ? item.origin : undefined,
          }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "glue",
        size: 10,
        origin: {
          kind: "quote-boundary",
          beforeBlockIndex: 1,
        },
      },
      { kind: "paragraph", text: "Beta" },
      {
        kind: "glue",
        size: 4,
        origin: {
          kind: "list-boundary",
          beforeBlockIndex: 2,
        },
      },
      { kind: "paragraph", text: "Gamma" },
    ]);
  });

  it("plans article quote/list vertical skips from vlist paragraph items", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`
    );
    const vlist = lowerSimpleTexBlocksToVList(parsed.blocks);
    const skips = planSimpleTexParagraphVerticalSkips(
      vlist.items,
      computerModernTexMetricProvider.resolveFont()
    );

    expect(skips).toEqual([
      { blockIndex: 0, vlistPath: [0], segmentIndex: 0, quoteSize: 0, listSize: 0, size: 0 },
      { blockIndex: 1, vlistPath: [1], segmentIndex: 0, quoteSize: 10, listSize: 0, size: 10 },
      { blockIndex: 2, vlistPath: [2], segmentIndex: 0, quoteSize: 4, listSize: 0, size: 4 },
      { blockIndex: 3, vlistPath: [3], segmentIndex: 0, quoteSize: 10, listSize: 0, size: 10 },
    ]);
  });

  it("plans LaTeX trivlist vertical skips for center environments", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{center} Beta \par Gamma \end{center} \par Delta`
    );
    const replacementParsed = parseSimpleTexParagraphIr(
      String.raw`\begin{center} Alpha \end{center} \par \begin{flushleft} Beta \end{flushleft}`
    );
    const vlist = lowerSimpleTexBlocksToVList(parsed.blocks);
    const replacementVList = lowerSimpleTexBlocksToVList(replacementParsed.blocks);
    const replacementTikzNodeVList = lowerSimpleTexBlocksToVList(replacementParsed.blocks, {
      tikzTextWidthNode: true,
    });
    const font = computerModernTexMetricProvider.resolveFont();
    const skips = planSimpleTexParagraphVerticalSkips(vlist.items, font);
    const replacementSkips = planSimpleTexParagraphVerticalSkips(replacementVList.items, font);
    const replacementTikzNodeSkips = planSimpleTexParagraphVerticalSkips(
      replacementTikzNodeVList.items,
      font
    );
    const materialized = materializeParagraphVerticalGlueInVList(vlist, font);

    expect(skips.map((skip) => ({
      blockIndex: skip.blockIndex,
      vlistPath: skip.vlistPath,
      quoteSize: skip.quoteSize,
      listSize: skip.listSize,
      trivlistSize: skip.trivlistSize ?? 0,
      size: skip.size,
    }))).toEqual([
      { blockIndex: 0, vlistPath: [0], quoteSize: 0, listSize: 0, trivlistSize: 0, size: 0 },
      { blockIndex: 1, vlistPath: [1], quoteSize: 0, listSize: 0, trivlistSize: 10, size: 10 },
      { blockIndex: 2, vlistPath: [2], quoteSize: 0, listSize: 0, trivlistSize: 0, size: 0 },
      { blockIndex: 3, vlistPath: [3], quoteSize: 0, listSize: 0, trivlistSize: 10, size: 10 },
    ]);
    expect(replacementSkips.map((skip) => ({
      blockIndex: skip.blockIndex,
      trivlistSize: skip.trivlistSize ?? 0,
      size: skip.size,
    }))).toEqual([
      { blockIndex: 0, trivlistSize: 10, size: 10 },
      { blockIndex: 1, trivlistSize: 10, size: 10 },
    ]);
    expect(replacementTikzNodeSkips.map((skip) => ({
      blockIndex: skip.blockIndex,
      trivlistSize: skip.trivlistSize ?? 0,
      size: skip.size,
    }))).toEqual([
      { blockIndex: 0, trivlistSize: 8, size: 8 },
      { blockIndex: 1, trivlistSize: 10, size: 10 },
    ]);
    expect(materialized.items.map((item) =>
      item.kind === "glue"
        ? {
            kind: item.kind,
            size: item.size,
            origin: item.origin,
            scopeKinds: item.scopePath?.map((role) => role.kind),
          }
        : item.kind === "paragraph"
          ? { kind: item.kind, text: item.paragraph.text }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "glue",
        size: 10,
        origin: {
          kind: "trivlist-boundary",
          beforeBlockIndex: 1,
        },
        scopeKinds: ["trivlist"],
      },
      { kind: "paragraph", text: "Beta" },
      { kind: "paragraph", text: "Gamma" },
      {
        kind: "glue",
        size: 10,
        origin: {
          kind: "trivlist-boundary",
          beforeBlockIndex: 3,
        },
        scopeKinds: undefined,
      },
      { kind: "paragraph", text: "Delta" },
    ]);
  });

  it("uses itemsep only for a list item following a nested trivlist", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{enumerate}\item Alpha \begin{center}Beta \par Gamma\end{center}\item Delta\end{enumerate}`
    );
    const vlist = lowerSimpleTexBlocksToVList(parsed.blocks, {
      tikzTextWidthNode: true,
    });
    const font = computerModernTexMetricProvider.resolveFont();
    const skips = planSimpleTexParagraphVerticalSkips(vlist.items, font);

    expect(skips.map((skip) => ({
      blockIndex: skip.blockIndex,
      listSize: skip.listSize,
      trivlistSize: skip.trivlistSize ?? 0,
      size: skip.size,
    }))).toEqual([
      { blockIndex: 0, listSize: 11, trivlistSize: 0, size: 11 },
      { blockIndex: 1, listSize: 4, trivlistSize: 8, size: 12 },
      { blockIndex: 2, listSize: 4, trivlistSize: 0, size: 4 },
      { blockIndex: 3, listSize: 4, trivlistSize: 8, size: 12 },
    ]);
  });

  it("keeps named skip commands inside centered trivlist scopes", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{center}\smallskip Alpha \par \medskip Beta \par \bigskip Gamma\end{center}`
    );
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlockItemsToVList(parsed.items),
      computerModernTexMetricProvider.resolveFont()
    );
    const center = grouped.items[0];

    expect(parsed.unsupportedCommand).toBe(false);
    expect(center).toMatchObject({
      kind: "vbox",
      role: { kind: "trivlist", envName: "center", alignment: "center" },
    });
    expect(center?.kind === "vbox" ? center.items.map((item) =>
      item.kind === "glue"
        ? {
            kind: item.kind,
            command: item.origin?.kind === "explicit-command"
              ? item.origin.command
              : undefined,
            size: item.size,
          }
        : item.kind === "paragraph"
          ? { kind: item.kind, text: item.paragraph.text }
          : { kind: item.kind }
    ) : []).toEqual([
      { kind: "glue", command: "smallskip", size: 3 },
      { kind: "paragraph", text: "Alpha" },
      { kind: "glue", command: "medskip", size: 6 },
      { kind: "paragraph", text: "Beta" },
      { kind: "glue", command: "bigskip", size: 12 },
      { kind: "paragraph", text: "Gamma" },
    ]);
  });

  it("reuses the quote entry topsepadd when leaving a TikZ text-width node quote", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote} Beta \end{quote} \par Delta`
    );
    const vlist = lowerSimpleTexBlocksToVList(parsed.blocks, {
      tikzTextWidthNode: true,
    });
    const skips = planSimpleTexParagraphVerticalSkips(
      vlist.items,
      computerModernTexMetricProvider.resolveFont()
    );

    expect(skips).toEqual([
      { blockIndex: 0, vlistPath: [0], segmentIndex: 0, quoteSize: 8, listSize: 0, size: 8 },
      { blockIndex: 1, vlistPath: [1], segmentIndex: 0, quoteSize: 8, listSize: 0, size: 8 },
    ]);
  });

  it("stretches explicit vfill glue to the requested vlist height", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`Alpha \par \vfill Beta`);
    const document = lowerSimpleTexBlockItemsToVList(parsed.items);

    const layout = layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      height: 40,
      lineHeight: 12,
      firstLineIndex: 0,
      firstLineAscent: 7,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0],
          lineIndices: [0],
          lineOffsets: [{ lineIndex: 0, y: 0 }],
          standardMetrics: { width: 30, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 30, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
        {
          blockIndex: 1,
          vlistPath: [2],
          lineIndices: [1],
          lineOffsets: [{ lineIndex: 1, y: 0 }],
          standardMetrics: { width: 25, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 25, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
      ],
    });

    expect(document.items.map((item) =>
      item.kind === "glue"
        ? {
            kind: item.kind,
            size: item.size,
            stretch: item.stretch,
            stretchOrder: item.stretchOrder,
            origin: item.origin,
          }
        : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph" },
      {
        kind: "glue",
        size: 0,
        stretch: 1,
        stretchOrder: "fill",
        origin: { kind: "explicit-command", command: "vfill" },
      },
      { kind: "paragraph" },
    ]);
    expect(layout.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.metrics.height,
      depth: item.metrics.depth,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: 7, depth: 3 },
      { kind: "glue", y: 10, height: 18, depth: 0 },
      { kind: "glue", y: 28, height: 2, depth: 0 },
      { kind: "paragraph", y: 30, height: 7, depth: 3 },
    ]);
    expect(layout.linePlacements).toEqual([
      { lineIndex: 0, x: 0, y: 0, height: 12 },
      { lineIndex: 1, x: 0, y: 30, height: 12 },
    ]);
    expect(layout.metrics).toEqual({ width: 100, height: 7, depth: 33 });
  });

  it("materializes named paragraph boundary glue through the vlist transform", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par \begin{itemize}\item Gamma\end{itemize}\end{quote}`
    );
    const baseVList = lowerSimpleTexBlocksToVList(parsed.blocks);
    const vlist = materializeParagraphVerticalGlueInVList(
      baseVList,
      computerModernTexMetricProvider.resolveFont()
    );

    expect(vlist.items.map((item) =>
      item.kind === "paragraph"
        ? {
            kind: item.kind,
            text: item.paragraph.text,
          }
        : item.kind === "glue"
          ? {
              kind: item.kind,
              size: item.size,
              origin: item.origin,
              scopeKinds: item.scopePath?.map((role) => role.kind),
            }
          : { kind: item.kind }
    )).toEqual([
      { kind: "paragraph", text: "Alpha" },
      {
        kind: "glue",
        size: 10,
        origin: {
          kind: "quote-boundary",
          beforeBlockIndex: 1,
        },
        scopeKinds: ["quote"],
      },
      { kind: "paragraph", text: "Beta" },
      {
        kind: "glue",
        size: 10,
        origin: {
          kind: "list-boundary",
          beforeBlockIndex: 2,
        },
        scopeKinds: ["quote", "list", "list-item"],
      },
      { kind: "paragraph", text: "Gamma" },
    ]);
  });

  it("materializes paragraph boundary glue inside pre-grouped vboxes", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      font
    );

    const skips = planSimpleTexParagraphVerticalSkips(grouped.items, font);
    const materialized = materializeParagraphVerticalGlueInVList(grouped, font);
    const quote = materialized.items[1];

    expect(skips.map((skip) => ({
      blockIndex: skip.blockIndex,
      size: skip.size,
      quoteSize: skip.quoteSize,
      listSize: skip.listSize,
    }))).toEqual([
      { blockIndex: 0, size: 0, quoteSize: 0, listSize: 0 },
      { blockIndex: 1, size: 10, quoteSize: 10, listSize: 0 },
      { blockIndex: 2, size: 4, quoteSize: 4, listSize: 0 },
      { blockIndex: 3, size: 10, quoteSize: 10, listSize: 0 },
    ]);
    expect(materialized.items.map((item) => item.kind)).toEqual([
      "paragraph",
      "vbox",
      "glue",
      "paragraph",
    ]);
    expect(quote?.kind === "vbox" ? flattenVListLeaves(quote.items) : null).toEqual([
      "glue:10",
      "paragraph:Beta",
      "glue:4",
      "paragraph:Gamma",
    ]);
    expect(flattenVListLeaves(materialized.items)).toEqual([
      "paragraph:Alpha",
      "glue:10",
      "paragraph:Beta",
      "glue:4",
      "paragraph:Gamma",
      "glue:10",
      "paragraph:Delta",
    ]);
  });

  it("plans paragraph boundary glue from grouped vbox roles", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par \begin{itemize}\item Gamma \par More\item Delta\end{itemize}\end{quote}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      font
    );
    const scrubbed = {
      ...grouped,
      items: stripParagraphScopeMetadata(grouped.items),
    };

    expect(planSimpleTexParagraphVerticalSkips(scrubbed.items, font).map((skip) => ({
      blockIndex: skip.blockIndex,
      vlistPath: skip.vlistPath,
      quoteSize: skip.quoteSize,
      listSize: skip.listSize,
      size: skip.size,
    }))).toEqual([
      { blockIndex: 0, vlistPath: [0], quoteSize: 0, listSize: 0, size: 0 },
      { blockIndex: 1, vlistPath: [1, 0], quoteSize: 10, listSize: 0, size: 10 },
      { blockIndex: 2, vlistPath: [1, 1, 0, 0], quoteSize: 0, listSize: 10, size: 10 },
      { blockIndex: 3, vlistPath: [1, 1, 0, 1], quoteSize: 0, listSize: 2, size: 2 },
      { blockIndex: 4, vlistPath: [1, 1, 1, 0], quoteSize: 0, listSize: 4, size: 4 },
    ]);

    expect(flattenVListLeaves(materializeParagraphVerticalGlueInVList(scrubbed, font).items)).toEqual([
      "paragraph:Alpha",
      "glue:10",
      "paragraph:Beta",
      "glue:10",
      "paragraph:Gamma",
      "glue:2",
      "paragraph:More",
      "glue:4",
      "paragraph:Delta",
    ]);
  });

  it("uses outside-list topsep when exiting a first-level list nested in quote", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote} Before \par \begin{itemize}\item Item\end{itemize} \par After\end{quote}`
    );
    const font = computerModernTexMetricProvider.resolveFont();
    const grouped = groupSimpleTexVListScopes(
      lowerSimpleTexBlocksToVList(parsed.blocks),
      font
    );
    const scrubbed = {
      ...grouped,
      items: stripParagraphScopeMetadata(grouped.items),
    };

    expect(planSimpleTexParagraphVerticalSkips(scrubbed.items, font).map((skip) => ({
      blockIndex: skip.blockIndex,
      quoteSize: skip.quoteSize,
      listSize: skip.listSize,
      size: skip.size,
    }))).toEqual([
      { blockIndex: 0, quoteSize: 10, listSize: 0, size: 10 },
      { blockIndex: 1, quoteSize: 0, listSize: 10, size: 10 },
      { blockIndex: 2, quoteSize: 0, listSize: 10, size: 10 },
    ]);
  });

  it("normalizes simple TeX vlists by materializing boundary glue and grouping scopes", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \par \begin{itemize}\item Gamma\end{itemize}\end{quote}`
    );
    const baseVList = lowerSimpleTexBlocksToVList(parsed.blocks);
    const font = computerModernTexMetricProvider.resolveFont();
    const prepared = prepareSimpleTexVList(baseVList, font);
    const normalized = normalizeSimpleTexVList(baseVList, font);

    expect(flattenVListLeaves(prepared.materialized.items)).toEqual([
      "paragraph:Alpha",
      "glue:10",
      "paragraph:Beta",
      "glue:10",
      "paragraph:Gamma",
    ]);
    expect(prepared.normalized).toEqual(normalized);
    expect(normalized).toEqual(
      prepareSimpleTexVList(baseVList, font).normalized
    );

    expect(normalized.items.map((item) => ({
      kind: item.kind,
      role: item.kind === "vbox" ? item.role : undefined,
      layout: item.kind === "vbox" ? item.layout : undefined,
    }))).toEqual([
      { kind: "paragraph", role: undefined, layout: undefined },
      {
        kind: "vbox",
        role: { kind: "quote", depth: 1 },
        layout: {
          leftMarginWidth: 25,
          rightMarginWidth: 25,
          paragraphPolicy: {
            fallbackAlignment: "justified",
            preserveRaggedRight: true,
            raggedRightProfile: "latex-quote",
          },
        },
      },
    ]);
    const quote = normalized.items[1];
    expect(quote?.kind === "vbox" ? quote.items.map((item) => ({
      kind: item.kind,
      role: item.kind === "vbox" ? item.role : undefined,
      layout: item.kind === "vbox" ? item.layout : undefined,
      size: item.kind === "glue" ? item.size : undefined,
    })) : null).toEqual([
      { kind: "glue", role: undefined, layout: undefined, size: 10 },
      { kind: "paragraph", role: undefined, layout: undefined, size: undefined },
      {
        kind: "vbox",
        role: { kind: "list", listKind: "itemize", depth: 2, labelDepth: 1, ownLeftMarginEm: 2.2, totalLeftMarginEm: 2.2 },
        layout: {
          leftMarginWidth: 22,
          rightMarginWidth: 0,
          list: {
            ownLeftMarginWidth: 22,
            labelRightEdge: 17,
            descriptionLabelSepWidth: 5,
          },
          paragraphPolicy: {
            resetInheritedAlignment: true,
            resetAlignmentSource: "latex-list",
            resetSpaceGlueProfile: true,
          },
        },
        size: undefined,
      },
    ]);
    expect(flattenVListLeaves(normalized.items)).toEqual([
      "paragraph:Alpha",
      "glue:10",
      "paragraph:Beta",
      "glue:10",
      "paragraph:Gamma",
    ]);
    expect(texVListParagraphItems(normalized.items).map((item) => item.paragraph.text)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });
});

describe("TeX vlist layout", () => {
  it("lays out generic vlist items using caller-provided measurements", () => {
    const parsed = parseSimpleTexParagraphIr("Alpha");
    const paragraph = lowerSimpleTexBlocksToVList(parsed.blocks).items[0];
    if (!paragraph || paragraph.kind !== "paragraph") {
      throw new Error("expected paragraph vlist item");
    }
    const items: readonly TexVListItem[] = [
      paragraph,
      {
        kind: "glue",
        size: 5,
        stretch: 5,
        stretchOrder: "normal",
      },
      {
        kind: "rule",
        width: 10,
        height: 2,
        depth: 1,
      },
    ];
    const measureItem: TexVListItemMeasurer = (item, cursor) =>
      item.kind === "paragraph"
        ? {
            y: cursor,
            advance: 10,
            metrics: {
              width: 42,
              height: 7,
              depth: 3,
            },
          }
        : null;

    expect(computeTexVListNaturalTotalHeight(items, measureItem)).toBe(18);

    const laidOut = layoutTexVListItems(
      items,
      measureItem,
      { sign: "stretch", order: "normal", ratio: 2 },
      0
    );

    expect(laidOut.cursor).toBe(28);
    expect(laidOut.positioned.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      metrics: item.metrics,
    }))).toEqual([
      {
        kind: "paragraph",
        y: 0,
        metrics: { width: 42, height: 7, depth: 3 },
      },
      {
        kind: "glue",
        y: 10,
        metrics: { width: 0, height: 15, depth: 0 },
      },
      {
        kind: "rule",
        y: 25,
        metrics: { width: 10, height: 2, depth: 1 },
      },
    ]);
  });

  it("preserves source spans in positioned vlist box reports", () => {
    const source = String.raw`Alpha \par \smallskip Beta \par \hrule width 24pt height 2pt depth 1pt \unsupportedgraphics{plot.pdf}`;
    const parsed = parseSimpleTexParagraphIr(source);
    const vlist = lowerSimpleTexBlockItemsToVList(parsed.items);
    const measureItem: TexVListItemMeasurer = (item, cursor) =>
      item.kind === "paragraph"
        ? {
            y: cursor,
            advance: 12,
            metrics: {
              width: 40,
              height: 7,
              depth: 5,
            },
          }
        : null;
    const laidOut = layoutTexVListItems(vlist.items, measureItem, null, 0);
    const boxReport = texVListBoxLayoutReport(
      laidOut.positioned,
      { width: 100, height: 7, depth: laidOut.cursor - 7 },
      { kind: "explicit", y: 7 }
    );

    expect(boxReport.items.map((item) => ({
      kind: item.itemKind,
      source: item.sourceSpan
        ? source.slice(item.sourceSpan.start, item.sourceSpan.end).trim()
        : null,
    }))).toEqual([
      { kind: "paragraph", source: "Alpha" },
      { kind: "glue", source: String.raw`\smallskip` },
      { kind: "paragraph", source: "Beta" },
      {
        kind: "rule",
        source: String.raw`\hrule width 24pt height 2pt depth 1pt`,
      },
      { kind: "paragraph", source: String.raw`\unsupportedgraphics{plot.pdf}` },
    ]);
  });

  it("carries nested vbox margins into positioned box geometry", () => {
    const parsed = parseSimpleTexParagraphIr("Alpha");
    const paragraph = lowerSimpleTexBlocksToVList(parsed.blocks).items[0];
    if (!paragraph || paragraph.kind !== "paragraph") {
      throw new Error("expected paragraph vlist item");
    }
    const document = {
      kind: "vlist",
      items: [
        {
          kind: "vbox",
          layout: {
            leftMarginWidth: 5,
            rightMarginWidth: 3,
          },
          items: [paragraph],
        },
      ],
    } satisfies {
      readonly kind: "vlist";
      readonly items: readonly TexVListItem[];
    };

    const layout = layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      lineHeight: 12,
      firstLineIndex: 0,
      firstLineAscent: 7,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0, 0],
          lineIndices: [0],
          lineOffsets: [{ lineIndex: 0, y: 0 }],
          standardMetrics: { width: 20, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 20, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
      ],
    });

    expect(flattenPositionedTexVListItems(layout.items).map((item) => ({
      kind: item.item.kind,
      path: item.path,
      x: item.x,
      y: item.y,
      metrics: item.metrics,
    }))).toEqual([
      {
        kind: "vbox",
        path: [0],
        x: 0,
        y: 0,
        metrics: { width: 28, height: 7, depth: 3 },
      },
      {
        kind: "paragraph",
        path: [0, 0],
        x: 5,
        y: 0,
        metrics: { width: 20, height: 7, depth: 3 },
      },
    ]);
    expect(layout.boxReport.items.map((item) => ({
      itemKind: item.itemKind,
      path: item.path,
      children: item.children,
      x: item.x,
      width: item.width,
      blockIndex: item.blockIndex,
    }))).toEqual([
      { itemKind: "vbox", path: [0], children: undefined, x: 0, width: 28, blockIndex: undefined },
      { itemKind: "paragraph", path: [0, 0], children: undefined, x: 5, width: 20, blockIndex: 0 },
    ]);
    expect(layout.boxReport.tree.map((item) => ({
      itemKind: item.itemKind,
      path: item.path,
      children: item.children?.map((child) => ({
        itemKind: child.itemKind,
        path: child.path,
        x: child.x,
        width: child.width,
        blockIndex: child.blockIndex,
      })),
    }))).toEqual([
      {
        itemKind: "vbox",
        path: [0],
        children: [
          { itemKind: "paragraph", path: [0, 0], x: 5, width: 20, blockIndex: 0 },
        ],
      },
    ]);
  });

  it("lays out paragraph vlist items from explicit measured boxes", () => {
    const parsed = parseSimpleTexParagraphIr("Alpha");
    const paragraph = lowerSimpleTexBlocksToVList(parsed.blocks).items[0];
    if (!paragraph || paragraph.kind !== "paragraph") {
      throw new Error("expected paragraph vlist item");
    }
    const document = {
      kind: "vlist",
      items: [
        paragraph,
        {
          kind: "glue",
          size: 4,
          stretch: 2,
          stretchOrder: "normal",
        },
        {
          ...paragraph,
          blockIndex: 1,
          paragraph: {
            ...paragraph.paragraph,
            blockIndex: 1,
          },
        },
      ],
    } satisfies {
      readonly kind: "vlist";
      readonly items: readonly TexVListItem[];
    };

    const layout = layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      height: 32,
      lineHeight: 12,
      firstLineIndex: 0,
      firstLineAscent: 7,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0],
          lineIndices: [0],
          lineOffsets: [{ lineIndex: 0, y: 0 }],
          standardMetrics: { width: 80, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 80, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
        {
          blockIndex: 1,
          vlistPath: [2],
          lineIndices: [1],
          lineOffsets: [{ lineIndex: 1, y: 0 }],
          standardMetrics: { width: 90, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 90, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
      ],
    });

    expect(layout.linePlacements).toEqual([
      { lineIndex: 0, x: 0, y: 0, height: 12 },
      { lineIndex: 1, x: 0, y: 22, height: 12 },
    ]);
    expect(layout.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      lineIndices: placement.lineIndices,
      y: placement.y,
      metrics: placement.metrics,
    }))).toEqual([
      {
        blockIndex: 0,
        lineIndices: [0],
        y: 0,
        metrics: { width: 80, height: 7, depth: 3 },
      },
      {
        blockIndex: 1,
        lineIndices: [1],
        y: 22,
        metrics: { width: 90, height: 7, depth: 3 },
      },
    ]);
    expect(layout.metrics).toEqual({ width: 100, height: 7, depth: 25 });
    expect(layout.boxReport).toEqual({
      kind: "tex-vlist-boxes",
      metrics: { width: 100, height: 7, depth: 25 },
      baseline: { kind: "explicit", y: 7 },
      tree: [
        {
          itemKind: "paragraph",
          path: [0],
          sourceSpan: { start: 0, end: 5 },
          x: 0,
          y: 0,
          width: 80,
          height: 7,
          depth: 3,
          totalHeight: 10,
          blockIndex: 0,
        },
        {
          itemKind: "glue",
          path: [1],
          x: 0,
          y: 10,
          width: 0,
          height: 12,
          depth: 0,
          totalHeight: 12,
          glue: {
            size: 4,
            stretch: 2,
            stretchOrder: "normal",
          },
        },
        {
          itemKind: "paragraph",
          path: [2],
          sourceSpan: { start: 0, end: 5 },
          x: 0,
          y: 22,
          width: 90,
          height: 7,
          depth: 3,
          totalHeight: 10,
          blockIndex: 1,
        },
      ],
      items: [
        {
          itemKind: "paragraph",
          path: [0],
          sourceSpan: { start: 0, end: 5 },
          x: 0,
          y: 0,
          width: 80,
          height: 7,
          depth: 3,
          totalHeight: 10,
          blockIndex: 0,
        },
        {
          itemKind: "glue",
          path: [1],
          x: 0,
          y: 10,
          width: 0,
          height: 12,
          depth: 0,
          totalHeight: 12,
          glue: {
            size: 4,
            stretch: 2,
            stretchOrder: "normal",
          },
        },
        {
          itemKind: "paragraph",
          path: [2],
          sourceSpan: { start: 0, end: 5 },
          x: 0,
          y: 22,
          width: 90,
          height: 7,
          depth: 3,
          totalHeight: 10,
          blockIndex: 1,
        },
      ],
    });

    expect(() => layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      lineHeight: 12,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0],
          lineIndices: [0],
          lineOffsets: [{ lineIndex: 1, y: 0 }],
          standardMetrics: { width: 80, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 80, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
        {
          blockIndex: 1,
          vlistPath: [2],
          lineIndices: [1],
          lineOffsets: [{ lineIndex: 1, y: 0 }],
          standardMetrics: { width: 90, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 90, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
      ],
    })).toThrow("missing line offset 0");
    expect(() => layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      lineHeight: 12,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0],
          lineIndices: [0],
          lineOffsets: [
            { lineIndex: 0, y: 0 },
            { lineIndex: 0, y: 2 },
          ],
          standardMetrics: { width: 80, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 80, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
        {
          blockIndex: 1,
          vlistPath: [2],
          lineIndices: [1],
          lineOffsets: [{ lineIndex: 1, y: 0 }],
          standardMetrics: { width: 90, height: 7, depth: 5 },
          ruleLeadingMetrics: { width: 90, height: 7, depth: 3 },
          standardAdvance: 12,
          ruleLeadingAdvance: 10,
        },
      ],
    })).toThrow("duplicate line offset 0");
  });

  it("keeps parent vlist glue setting out of nested vboxes", () => {
    const items: readonly TexVListItem[] = [
      {
        kind: "glue",
        size: 2,
        stretch: 4,
        stretchOrder: "normal",
      },
      {
        kind: "vbox",
        items: [
          {
            kind: "glue",
            size: 3,
            stretch: 100,
            stretchOrder: "normal",
          },
          {
            kind: "rule",
            width: 10,
            height: 2,
            depth: 1,
          },
        ],
      },
    ];

    const naturalHeight = computeTexVListNaturalTotalHeight(items, () => null);
    const glueSet = texVListGlueSetForTargetHeight(items, naturalHeight, 18);
    const laidOut = layoutTexVListItems(items, () => null, glueSet, 0);
    const nested = laidOut.positioned[1];

    expect(glueSet).toEqual({
      sign: "stretch",
      order: "normal",
      ratio: 2.5,
    });
    expect(laidOut.cursor).toBe(18);
    expect(laidOut.positioned.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.metrics.height,
      depth: item.metrics.depth,
    }))).toEqual([
      { kind: "glue", y: 0, height: 12, depth: 0 },
      { kind: "vbox", y: 12, height: 5, depth: 1 },
    ]);
    expect(nested?.children?.map((item) => ({
      kind: item.item.kind,
      path: item.path,
      y: item.y,
      height: item.metrics.height,
      depth: item.metrics.depth,
    }))).toEqual([
      { kind: "glue", path: [1, 0], y: 12, height: 3, depth: 0 },
      { kind: "rule", path: [1, 1], y: 15, height: 2, depth: 1 },
    ]);
    expect(flattenPositionedTexVListItems(laidOut.positioned).map((item) => ({
      kind: item.item.kind,
      path: item.path,
    }))).toEqual([
      { kind: "glue", path: [0] },
      { kind: "vbox", path: [1] },
      { kind: "glue", path: [1, 0] },
      { kind: "rule", path: [1, 1] },
    ]);
    expect(findPositionedTexVListItemByPath(laidOut.positioned, [1, 1])?.item.kind).toBe("rule");
    expect(findPositionedTexVListItemByPath(laidOut.positioned, [])).toBeNull();
    expect(findPositionedTexVListItemByPath(laidOut.positioned, [1, 9])).toBeNull();
  });

  it("sets local glue inside explicit-height vboxes", () => {
    const items: readonly TexVListItem[] = [
      {
        kind: "vbox",
        height: 20,
        items: [
          {
            kind: "rule",
            width: 10,
            height: 2,
            depth: 1,
          },
          {
            kind: "glue",
            size: 3,
            stretch: 5,
            stretchOrder: "normal",
          },
          {
            kind: "rule",
            width: 8,
            height: 1,
            depth: 0,
          },
        ],
      },
      {
        kind: "glue",
        size: 1,
        stretch: 99,
        stretchOrder: "normal",
      },
    ];

    const laidOut = layoutTexVListItems(items, () => null, null, 0);
    const nested = laidOut.positioned[0];

    expect(laidOut.cursor).toBe(21);
    expect(nested?.metrics).toEqual({
      width: 10,
      height: 2,
      depth: 18,
    });
    expect(nested?.children?.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.metrics.height,
      depth: item.metrics.depth,
    }))).toEqual([
      { kind: "rule", y: 0, height: 2, depth: 1 },
      { kind: "glue", y: 3, height: 16, depth: 0 },
      { kind: "rule", y: 19, height: 1, depth: 0 },
    ]);
  });

  it("reports local baselines for nested explicit-height vboxes", () => {
    const items: readonly TexVListItem[] = [
      {
        kind: "vbox",
        height: 10,
        alignment: "bottom",
        items: [
          {
            kind: "rule",
            width: 10,
            height: 2,
            depth: 1,
          },
        ],
      },
    ];

    const laidOut = layoutTexVListItems(items, () => null, null, 0);
    const vbox = laidOut.positioned[0];
    if (!vbox) {
      throw new Error("expected positioned vbox");
    }
    const boxReport = texVListBoxLayoutReport(
      laidOut.positioned,
      { width: 10, height: 9, depth: 1 },
      { kind: "explicit", y: 9 }
    );

    expect(vbox.baseline).toEqual({ kind: "explicit", y: 9 });
    expect(boxReport.tree[0]).toMatchObject({
      itemKind: "vbox",
      baseline: { kind: "explicit", y: 9 },
      height: 9,
      depth: 1,
    });
    expect(boxReport.items[0]).toMatchObject({
      itemKind: "vbox",
      baseline: { kind: "explicit", y: 9 },
    });
  });

  it("aligns natural children inside explicit-height vboxes without stretch glue", () => {
    const items: readonly TexVListItem[] = [
      {
        kind: "vbox",
        height: 10,
        alignment: "bottom",
        items: [
          {
            kind: "rule",
            width: 10,
            height: 2,
            depth: 1,
          },
        ],
      },
    ];

    const laidOut = layoutTexVListItems(items, () => null, null, 0);
    const nested = laidOut.positioned[0];

    expect(laidOut.cursor).toBe(10);
    expect(nested?.metrics).toEqual({
      width: 10,
      height: 9,
      depth: 1,
    });
    expect(nested?.children?.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.metrics.height,
      depth: item.metrics.depth,
    }))).toEqual([
      { kind: "rule", y: 7, height: 2, depth: 1 },
    ]);
  });

  it("uses strut-like previous depth before material vboxes", () => {
    const document = {
      kind: "vlist",
      items: [{
        kind: "vbox",
        material: { command: "minipage" },
        width: 90,
        items: [
          {
            kind: "paragraph",
            sourceSpan: { start: 0, end: 5 },
            blockIndex: 0,
            paragraph: {
              blockIndex: 0,
              text: "Alpha",
              sourceSpan: { start: 0, end: 5 },
              nodes: [],
              noIndent: false,
              quoteDepth: 0,
              quotationDepth: 0,
            },
          },
          {
            kind: "vbox",
            material: { command: "parbox" },
            width: 70,
            items: [{
              kind: "paragraph",
              sourceSpan: { start: 6, end: 10 },
              blockIndex: 1,
              paragraph: {
                blockIndex: 1,
                text: "Beta",
                sourceSpan: { start: 6, end: 10 },
                nodes: [],
                noIndent: false,
                quoteDepth: 0,
                quotationDepth: 0,
              },
            }],
          },
        ],
      }],
    } as const;

    const layout = layoutTexVListFromMeasuredParagraphs(document, {
      width: 120,
      lineHeight: 12,
      paragraphMeasurements: [
        {
          blockIndex: 0,
          vlistPath: [0, 0],
          lineIndices: [0, 1, 2],
          lineOffsets: [
            { lineIndex: 0, y: 0, metrics: { width: 90, height: 7, depth: 0.1 } },
            { lineIndex: 1, y: 12, metrics: { width: 90, height: 7, depth: 0.1 } },
            { lineIndex: 2, y: 24, metrics: { width: 90, height: 7, depth: 0.1 } },
          ],
          lastLineMetrics: { width: 90, height: 7, depth: 0.1 },
          standardMetrics: { width: 90, height: 7, depth: 24.1 },
          ruleLeadingMetrics: { width: 90, height: 7, depth: 24.1 },
          standardAdvance: 31.1,
          ruleLeadingAdvance: 31.1,
        },
        {
          blockIndex: 1,
          vlistPath: [0, 1, 0],
          lineIndices: [3],
          lineOffsets: [
            { lineIndex: 3, y: 0, metrics: { width: 70, height: 7, depth: 3 } },
          ],
          lastLineMetrics: { width: 70, height: 7, depth: 3 },
          standardMetrics: { width: 70, height: 7, depth: 3 },
          ruleLeadingMetrics: { width: 70, height: 7, depth: 3 },
          standardAdvance: 10,
          ruleLeadingAdvance: 10,
        },
      ],
    });

    expect(layout.linePlacements.map((line) => ({
      lineIndex: line.lineIndex,
      y: line.y,
    }))).toEqual([
      { lineIndex: 0, y: 0 },
      { lineIndex: 1, y: 12 },
      { lineIndex: 2, y: 24 },
      { lineIndex: 3, y: 32.1 },
    ]);
  });
});

describe("TeX vlist report assembly", () => {
  it("derives simple horizontal line metrics from the vlist font", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`Alpha \par Beta`);
    const rawVList = lowerSimpleTexBlocksToVList(parsed.blocks);
    const font = computerModernTexMetricProvider.resolveFont({
      fontId: "cmr10",
      atPt: 20,
    });
    const document = prepareSimpleTexVList(rawVList, font).normalized;
    const layout = layoutTexVListFromHorizontalParagraphs(document, {
      width: 100,
      lineHeight: 24,
      firstLineIndex: 0,
      firstLineAscent: 17,
      paragraphLayouts: [
        horizontalParagraphLayout(0, [0], 100, 7, 17),
        horizontalParagraphLayout(1, [1], 100, 7, 17),
      ],
    });

    expect(layout.baseline).toEqual({ kind: "explicit", y: 17 });
    expect(layout.linePlacements).toEqual([
      { lineIndex: 0, x: 0, y: 0, height: 24 },
      { lineIndex: 1, x: 0, y: 24, height: 24 },
    ]);
    expect(layout.metrics).toEqual({
      width: 100,
      height: 17,
      depth: 31,
    });
  });

  it("prepares raw simple TeX vlists before measured layout", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \par \begin{quote} Beta \end{quote} \par Delta`
    );
    const rawVList = lowerSimpleTexBlocksToVList(parsed.blocks);
    const font = computerModernTexMetricProvider.resolveFont();
    const document = prepareSimpleTexVList(rawVList, font).normalized;

    const layout = layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      lineHeight: 12,
      firstLineIndex: 0,
      firstLineAscent: 7,
      paragraphMeasurements: [
        paragraphMeasurement(0, [0], { width: 100, height: 7, depth: 5 }),
        paragraphMeasurement(1, [1], { width: 100, height: 7, depth: 5 }, [1, 1]),
        paragraphMeasurement(2, [2], { width: 100, height: 7, depth: 5 }, [3]),
      ],
    });

    expect(layout.linePlacements.map((placement) => placement.y)).toEqual([
      0,
      22,
      44,
    ]);
    expect(layout.items.map((item) => item.item.kind)).toEqual([
      "paragraph",
      "vbox",
      "glue",
      "glue",
      "paragraph",
    ]);
    expect(layout.items[1]?.item.kind === "vbox" ? layout.items[1].item.role : null)
      .toEqual({ kind: "quote", depth: 1 });
    expect(layout.items[1]?.children?.map((item) => item.item.kind)).toEqual([
      "glue",
      "glue",
      "paragraph",
    ]);
  });

  it("validates measured vlist paragraphs against paragraph items", () => {
    const parsed = parseSimpleTexParagraphIr(String.raw`Alpha \par Beta`);
    const document = lowerSimpleTexBlocksToVList(parsed.blocks);
    const measurement = (
      blockIndex: number,
      lineIndex = blockIndex,
      vlistPath: readonly number[] = [blockIndex]
    ) => ({
      blockIndex,
      vlistPath,
      lineIndices: [lineIndex],
      lineOffsets: [{ lineIndex, y: 0 }],
      standardMetrics: { width: 80, height: 7, depth: 5 },
      ruleLeadingMetrics: { width: 80, height: 7, depth: 3 },
      standardAdvance: 12,
      ruleLeadingAdvance: 10,
    });

    expect(() => validateTexVListParagraphMeasurements(document, [
      measurement(0),
      measurement(1),
    ])).not.toThrow();
    expect(() => validateTexVListParagraphMeasurements(document, [
      measurement(0),
    ])).toThrow("missing paragraph path 1");
    expect(() => validateTexVListParagraphMeasurements(document, [
      measurement(0),
      measurement(0, 1),
      measurement(1, 2),
    ])).toThrow("duplicate path 0");
    expect(() => validateTexVListParagraphMeasurements(document, [
      measurement(0),
      measurement(1),
      measurement(99),
    ])).toThrow("missing paragraph path 99");
  });

  it("uses measured paragraph line ownership when laying out vlist items", () => {
    const document = {
      kind: "vlist",
      items: [
        {
          kind: "paragraph",
          sourceSpan: { start: 0, end: 5 },
          blockIndex: 0,
          paragraph: {
            blockIndex: 0,
            text: "Alpha",
            sourceSpan: { start: 0, end: 5 },
            nodes: [],
            noIndent: false,
            quoteDepth: 0,
          },
        },
        {
          kind: "paragraph",
          sourceSpan: { start: 0, end: 5 },
          blockIndex: 1,
          paragraph: {
            blockIndex: 1,
            text: "Beta",
            sourceSpan: { start: 0, end: 5 },
            nodes: [],
            noIndent: false,
            quoteDepth: 0,
          },
        },
      ],
    } satisfies {
      readonly kind: "vlist";
      readonly items: readonly TexVListItem[];
    };

    const layout = layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      lineHeight: 12,
      firstLineIndex: 0,
      firstLineAscent: 7,
      paragraphMeasurements: [
        paragraphMeasurement(0, [0], { width: 100, height: 7, depth: 5 }),
        paragraphMeasurement(1, [1], { width: 100, height: 7, depth: 5 }),
      ],
    });

    expect(layout.linePlacements.map((placement) => placement.y)).toEqual([0, 12]);
    expect(layout.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      lineIndices: placement.lineIndices,
      y: placement.y,
      metrics: placement.metrics,
      sourceSpan: placement.sourceSpan,
    }))).toEqual([
      {
        blockIndex: 0,
        lineIndices: [0],
        y: 0,
        metrics: { width: 100, height: 7, depth: 5 },
        sourceSpan: { start: 0, end: 5 },
      },
      {
        blockIndex: 1,
        lineIndices: [1],
        y: 12,
        metrics: { width: 100, height: 7, depth: 5 },
        sourceSpan: { start: 0, end: 5 },
      },
    ]);
    expect(layout.items.map((item) => ({
      blockIndex: item.item.kind === "paragraph" ? item.item.blockIndex : null,
      y: item.y,
      height: item.metrics.height,
      depth: item.metrics.depth,
      interlineBoundary: item.item.kind === "glue" &&
        item.item.origin?.kind === "paragraph-boundary-interline"
        ? item.item.origin.boundary
        : undefined,
    }))).toEqual([
      { blockIndex: 0, y: 0, height: 7, depth: 5, interlineBoundary: undefined },
      { blockIndex: null, y: 12, height: 0, depth: 0, interlineBoundary: "plain" },
      { blockIndex: 1, y: 12, height: 7, depth: 5, interlineBoundary: undefined },
    ]);

    expect(() => layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      lineHeight: 12,
      paragraphMeasurements: [
        paragraphMeasurement(0, [0], { width: 100, height: 7, depth: 5 }),
      ],
    })).toThrow("missing paragraph path 1");
    expect(() => layoutTexVListFromMeasuredParagraphs(document, {
      width: 100,
      lineHeight: 12,
      paragraphMeasurements: [
        paragraphMeasurement(0, [0], { width: 100, height: 7, depth: 5 }),
        {
          ...paragraphMeasurement(1, [1], { width: 100, height: 7, depth: 5 }),
          lineOffsets: [
            { lineIndex: 1, y: 0 },
            { lineIndex: 99, y: 0 },
          ],
        },
      ],
    })).toThrow("stray line offset 99");

    const firstParagraph = document.items[0];
    if (!firstParagraph || firstParagraph.kind !== "paragraph") {
      throw new Error("expected paragraph vlist item");
    }
    const mismatchedDocument = {
      kind: "vlist",
      items: [
        {
          ...firstParagraph,
          paragraph: {
            ...firstParagraph.paragraph,
            blockIndex: 99,
          },
        },
      ],
    } satisfies {
      readonly kind: "vlist";
      readonly items: readonly TexVListItem[];
    };
    expect(() => layoutTexVListFromMeasuredParagraphs(mismatchedDocument, {
      width: 100,
      lineHeight: 12,
      paragraphMeasurements: [
        paragraphMeasurement(99, [0], { width: 100, height: 7, depth: 5 }, [0]),
      ],
    })).toThrow("measurement path 0 block identity mismatch");
  });

  it("merges combined paragraph line ownership by vlist path", () => {
    const broken = {
      runs: [],
      lines: [{
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: 0,
        width: 0,
        break: null,
      }],
      runWidths: new Map(),
      shapedRuns: new Map(),
      errors: [],
      linebreakingMode: "feasible" as const,
    };
    const combined = combineTexBrokenLayoutParagraphs({
      entries: [0, 1].map(() => ({
        paragraph: { blockIndex: 0, vlistPath: [0] },
        broken,
      })),
    });

    expect(combined.paragraphLineSpans).toEqual([
      { blockIndex: 0, vlistPath: [0], lineIndices: [0, 1] },
    ]);
    expect("paragraphLineAssignments" in combined).toBe(false);
    expect(combineTexBrokenLayoutParagraphs({
      entries: [
        { paragraph: { blockIndex: 0, vlistPath: [0] }, broken },
        { paragraph: { blockIndex: 0, vlistPath: [1] }, broken },
      ],
    }).paragraphLineSpans).toEqual([
      { blockIndex: 0, vlistPath: [0], lineIndices: [0] },
      { blockIndex: 0, vlistPath: [1], lineIndices: [1] },
    ]);
    expect(() => combineTexBrokenLayoutParagraphs({
      entries: [
        { paragraph: { blockIndex: 0, vlistPath: [0] }, broken },
        { paragraph: { blockIndex: 1, vlistPath: [0] }, broken },
      ],
    })).toThrow("line span block mismatch");
  });

  it("combines broken paragraph entries for vlist report assembly", () => {
    const parsed = parseSimpleTexParagraphIr("Alpha");
    const document = lowerSimpleTexBlocksToVList(parsed.blocks);
    const metricProvider = computerModernTexMetricProvider;
    const font = metricProvider.resolveFont();
    const shaped = metricProvider.shapeText("Alpha", font);

    const reportAssembly = layoutTexVListFromBrokenParagraphs(document, {
      paragraphId: "tex:vlist-broken-report",
      width: 100,
      alignment: "ragged-right",
      layoutMode: "wrap",
      font,
      metricProvider,
      entries: [{
        paragraph: {
          blockIndex: 0,
          vlistPath: [0],
        },
        broken: {
          runs: [{
            kind: "text",
            runIndex: 0,
            sourceStart: 0,
            sourceEnd: 5,
            text: "Alpha",
            wrapper: {},
            childIndex: 0,
            wordIndex: 0,
          }],
          lines: [{
            lineIndex: 0,
            startRun: 0,
            startTextOffset: 0,
            endRun: 0,
            endTextOffset: 5,
            width: shaped.width,
            targetWidth: 100,
            lineNaturalWidth: shaped.width,
            break: null,
          }],
          shapedRuns: new Map([[0, shaped]]),
          runWidths: new Map([[0, shaped.width]]),
          errors: ["paragraph warning"],
          linebreakingMode: "feasible",
        },
      }],
      initialErrors: ["initial warning"],
    });

    if (reportAssembly.status !== "laid-out") {
      throw new Error("expected broken paragraph report assembly to produce a layout");
    }
    expect(reportAssembly.combined.errors).toEqual([
      "initial warning",
      "paragraph warning",
    ]);
    expect(reportAssembly.report).toMatchObject({
      paragraphId: "tex:vlist-broken-report",
      lines: [{ lineIndex: 0 }],
      errors: ["initial warning", "paragraph warning"],
    });
    expect(reportAssembly.layout.reports).toEqual([reportAssembly.report]);
  });

  it("returns an explicit empty result for broken paragraph entries without lines", () => {
    const parsed = parseSimpleTexParagraphIr("Alpha");
    const document = lowerSimpleTexBlocksToVList(parsed.blocks);
    const metricProvider = computerModernTexMetricProvider;
    const font = metricProvider.resolveFont();

    const reportAssembly = layoutTexVListFromBrokenParagraphs(document, {
      paragraphId: "tex:vlist-empty-broken-report",
      width: 100,
      alignment: "ragged-right",
      layoutMode: "wrap",
      font,
      metricProvider,
      entries: [],
      initialErrors: ["no text"],
    });

    expect(reportAssembly).toMatchObject({
      status: "empty",
      combined: {
        runs: [],
        lines: [],
        errors: ["no text"],
      },
    });
  });

  it("builds paragraph reports through vlist combined report assembly", () => {
    const parsed = parseSimpleTexParagraphIr("Alpha");
    const document = lowerSimpleTexBlocksToVList(parsed.blocks);
    const metricProvider = computerModernTexMetricProvider;
    const font = metricProvider.resolveFont();
    const shaped = metricProvider.shapeText("Alpha", font);

    const reportAssembly = layoutTexVListFromCombinedParagraphReport(document, {
      paragraphId: "tex:vlist-combined-report",
      width: 100,
      alignment: "ragged-right",
      layoutMode: "wrap",
      font,
      metricProvider,
      combined: {
        runs: [{
          kind: "text",
          runIndex: 0,
          sourceStart: 0,
          sourceEnd: 5,
          text: "Alpha",
          wrapper: {},
          childIndex: 0,
          wordIndex: 0,
        }],
        lines: [{
          lineIndex: 0,
          startRun: 0,
          startTextOffset: 0,
          endRun: 0,
          endTextOffset: 5,
          width: shaped.width,
          targetWidth: 100,
          lineNaturalWidth: shaped.width,
          break: null,
        }],
        shapedRuns: new Map([[0, shaped]]),
        runWidths: new Map([[0, shaped.width]]),
        lineLabels: new Map(),
        paragraphLineSpans: [
          { blockIndex: 0, vlistPath: [0], lineIndices: [0] },
        ],
        errors: [],
        linebreakingMode: "feasible",
      },
    });

    expect(reportAssembly.report).toMatchObject({
      paragraphId: "tex:vlist-combined-report",
      width: 100,
      lines: [{
        lineIndex: 0,
        targetWidth: 100,
        segments: [{
          kind: "text",
          text: "Alpha",
          sourceStartRaw: 0,
          sourceEndRaw: 5,
        }],
      }],
    });
    expect(reportAssembly.layout.paragraphPlacements).toEqual([expect.objectContaining({
      blockIndex: 0,
      lineIndices: [0],
      x: 0,
      y: 0,
    })]);
    expect(reportAssembly.layout.linePlacements).toEqual([expect.objectContaining({
      lineIndex: 0,
      x: 0,
      y: 0,
    })]);
    expect(reportAssembly.layout.reports).toEqual([reportAssembly.report]);
  });
});

describe("TeX vlist layout registry", () => {
  it("registers positioned vlist layouts by paragraph id on an output jax", () => {
    const outputJax = {};
    const items = [] as const;
    const baseline = { kind: "explicit", y: 7 } as const;
    const layout = {
      metrics: { width: 42, height: 7, depth: 3 },
      baseline,
      items,
      boxReport: texVListBoxLayoutReport(items, { width: 42, height: 7, depth: 3 }, baseline),
      paragraphPlacements: [],
      linePlacements: [],
      reports: [],
      errors: [],
    };
    const replacement = {
      ...layout,
      metrics: { width: 24, height: 5, depth: 2 },
      boxReport: texVListBoxLayoutReport(items, { width: 24, height: 5, depth: 2 }, baseline),
    };

    expect(getTexVListLayoutsFromOutputJax(outputJax)).toEqual([]);
    registerTexVListLayoutsOnOutputJax(outputJax, [
      { paragraphId: "tex:a", layout },
      { paragraphId: "", layout },
    ]);
    registerTexVListLayoutsOnOutputJax(outputJax, [
      { paragraphId: "tex:a", layout: replacement },
    ]);

    expect(getTexVListLayoutFromOutputJax(outputJax, "tex:a")).toBe(replacement);
    expect(getTexVListLayoutFromOutputJax(outputJax, "tex:missing")).toBeNull();
    expect(getTexVListLayoutsFromOutputJax(outputJax)).toEqual([
      { paragraphId: "tex:a", layout: replacement },
    ]);
    expect(getTexVListLayoutsFromOutputJax(null)).toEqual([]);
  });
});

function reportLineText(line: { readonly segments: readonly { readonly text?: string }[] }): string {
  return line.segments.map((segment) => segment.text ?? "").join("").trimEnd();
}

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

function stripParagraphScopeMetadata(items: readonly TexVListItem[]): readonly TexVListItem[] {
  return items.map((item) => {
    if (item.kind === "vbox") {
      return {
        ...item,
        items: stripParagraphScopeMetadata(item.items),
      };
    }
    if (item.kind === "paragraph") {
      return {
        ...item,
        paragraph: {
          ...item.paragraph,
          quoteDepth: 0,
          listContext: undefined,
        },
      };
    }
    return item;
  });
}

function paragraphMeasurement(
  blockIndex: number,
  lineIndices: readonly number[],
  metrics: TexVListParagraphBoxMeasurement["standardMetrics"],
  vlistPath: readonly number[] = [blockIndex]
): TexVListParagraphBoxMeasurement {
  const advance = metrics.height + metrics.depth;
  return {
    blockIndex,
    vlistPath,
    lineIndices,
    lineOffsets: lineIndices.map((lineIndex, index) => ({
      lineIndex,
      y: index * advance,
    })),
    standardMetrics: metrics,
    ruleLeadingMetrics: metrics,
    standardAdvance: advance,
    ruleLeadingAdvance: advance,
  };
}

function horizontalParagraphLayout(
  blockIndex: number,
  lineIndices: readonly number[],
  width: number,
  height: number,
  depth: number,
  vlistPath: readonly number[] = [blockIndex]
) {
  return {
    blockIndex,
    vlistPath,
    lineIndices,
    horizontal: {
      metrics: {
        width,
        height,
        depth,
      },
      lines: lineIndices.map((lineIndex, index) => ({
        lineIndex,
        y: index * (height + depth),
        targetWidth: width,
        metrics: {
          width,
          height,
          depth,
        },
      })),
      renderItems: [],
    },
  };
}
