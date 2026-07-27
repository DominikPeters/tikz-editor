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
    const ir = parseSimpleTexParagraphIr("50% comment\n& more_stuff");
    const literals = literalNodes(ir.nodes);
    expect(literals.map((node) => node.text)).toEqual(["&", "_"]);
    expect(literals.every((node) => node.reason === "unsupported-character")).toBe(true);
    expect(ir.nodes).toContainEqual(
      expect.objectContaining({ kind: "comment", text: "% comment\n" })
    );
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
    expect(
      analyzeSimpleTexParagraph("50% comment\n& more_stuff", 200).fallbackReason
    ).toBeNull();
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
    const { createTexNodeTextEngine } = await import(
      "../packages/core/src/text/tex-node-text-engine.js"
    );
    const engine = await createTexNodeTextEngine();

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
    const result = layoutSimpleTexParagraph("50& off", {
      paragraphId: "tex:literal-ampersand",
      width: 200,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(true);
    const segments = result.report?.lines.flatMap((line) => line.segments) ?? [];
    const literalSegments = segments.filter((segment) => segment.literal);
    expect(literalSegments).toHaveLength(1);
    expect(literalSegments[0].text).toBe("&");
    expect(literalSegments[0].literal?.reason).toBe("unsupported-character");
  });
});

describe("list material before the first \\item", () => {
  const enumerateWith = (body: string): string =>
    `My list:\n\\begin{enumerate}\n${body}\n\\end{enumerate} `;

  it("keeps every half-typed \\item prefix out of whole-node fallback", () => {
    // "\\" alone scans as a control space, so it has no visible material;
    // the rest must surface as literal runs.
    for (const midEdit of ["\\", "\\i", "\\it", "\\ite", "stray text"]) {
      const analysis = analyzeSimpleTexParagraph(enumerateWith(midEdit), 100);
      expect(analysis.fallbackReason, `body: ${midEdit}`).toBeNull();
      expect(analysis.ir?.unsupportedCommand, `body: ${midEdit}`).toBe(false);
    }
  });

  it("renders pre-item material as literal runs instead of degrading the node", () => {
    for (const midEdit of ["\\i", "\\it", "\\ite", "stray text"]) {
      const analysis = analyzeSimpleTexParagraph(enumerateWith(midEdit), 100);
      const preItemBlock = analysis.ir?.blocks.find((block) =>
        block.nodes.some((node) => node.kind === "literal")
      );
      expect(preItemBlock, `body: ${midEdit}`).toBeDefined();
      const literals = literalNodes(preItemBlock!.nodes);
      expect(literals.length, `body: ${midEdit}`).toBeGreaterThan(0);
      // Nodes that were already literal (e.g. the unknown command `\i`)
      // keep their own reason; everything else is wrapped as missing-item
      // malformed input.
      expect(
        literals.every(
          (node) =>
            node.reason === "unsupported-command" ||
            (node.reason === "malformed-input" && node.detail === "missing \\item")
        ),
        `body: ${midEdit}`
      ).toBe(true);
    }
  });

  it("keeps a completed \\item fully supported", () => {
    const analysis = analyzeSimpleTexParagraph(enumerateWith("\\item first"), 100);
    expect(analysis.fallbackReason).toBeNull();
    const literals = analysis.ir?.blocks.flatMap((block) => literalNodes(block.nodes)) ?? [];
    expect(literals).toHaveLength(0);
  });

  it("keeps an empty list body supported", () => {
    expect(analyzeSimpleTexParagraph(enumerateWith(""), 100).fallbackReason).toBeNull();
  });
});

describe("malformed TeX environments", () => {
  it("contains an unterminated list and its orphan item as literal runs", () => {
    const source = String.raw`\begin{enumerate}
\item Alpha`;
    const analysis = analyzeSimpleTexParagraph(source, 100);
    const literals = analysis.ir?.blocks.flatMap((block) =>
      literalNodes(block.nodes)
    ) ?? [];

    expect(analysis.fallbackReason).toBeNull();
    expect(analysis.ir?.unsupportedCommand).toBe(false);
    expect(literals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        text: String.raw`\begin{enumerate}`,
        reason: "malformed-input",
        detail: String.raw`missing \end{enumerate}`,
      }),
      expect.objectContaining({
        text: String.raw`\item `,
        reason: "malformed-input",
        detail: String.raw`\item outside matched list environment`,
      }),
    ]));
  });

  it("contains mismatched list boundaries without aborting layout", () => {
    const source = String.raw`\begin{enumerate}
\item Alpha
\end{itemize}`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:mismatched-list-environment",
      width: 140,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    const literalText = result.report?.lines.flatMap((line) => line.segments)
      .filter((segment) => segment.literal)
      .map((segment) => segment.text)
      .join("") ?? "";

    expect(result.supported).toBe(true);
    expect(literalText).toContain(String.raw`\begin{enumerate}`);
    expect(literalText).toContain(String.raw`\item`);
    expect(literalText).toContain(String.raw`\end{itemize}`);
  });

  it("keeps a correctly matched inner environment structural", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`\begin{quote}Before \begin{center}Inner\end{center} After\end{quotation}`
    );

    expect(parsed.unsupportedCommand).toBe(false);
    expect(parsed.nodes.filter((node) => node.kind === "environment-boundary"))
      .toEqual([
        expect.objectContaining({ boundary: "begin", name: "center" }),
        expect.objectContaining({ boundary: "end", name: "center" }),
      ]);
    expect(parsed.blocks.find((block) => block.text === "Inner")?.scopePath)
      .toEqual([
        expect.objectContaining({ kind: "trivlist", envName: "center" }),
      ]);
  });

  it("renders an unexpected supported environment end as malformed source", () => {
    const parsed = parseSimpleTexParagraphIr(
      String.raw`Alpha \end{enumerate} Omega`
    );

    expect(literalNodes(parsed.nodes)).toContainEqual(expect.objectContaining({
      text: String.raw`\end{enumerate}`,
      reason: "malformed-input",
      detail: String.raw`unexpected \end{enumerate}`,
    }));
    expect(parsed.unsupportedCommand).toBe(false);
  });

  it.each([
    [String.raw`\begin{enumerate`, String.raw`incomplete \begin{enumerate}`],
    [String.raw`\end{enumerate`, String.raw`incomplete \end{enumerate}`],
    [String.raw`\begin{minipage`, String.raw`incomplete \begin{minipage}`],
  ])("contains an incomplete environment delimiter: %s", (source, detail) => {
    const parsed = parseSimpleTexParagraphIr(source);

    expect(literalNodes(parsed.nodes)).toEqual([
      expect.objectContaining({
        text: source,
        reason: "malformed-input",
        detail,
        sourceStart: 0,
        sourceEnd: source.length,
      }),
    ]);
    expect(parsed.unsupportedCommand).toBe(false);
  });
});
