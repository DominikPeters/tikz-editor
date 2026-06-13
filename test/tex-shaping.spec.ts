import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassPlaceholderGeometry,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  getKnuthPlassVListBoxGeometry,
  getKnuthPlassVListItemGeometry,
  getKnuthPlassVListParagraphGeometry,
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import { clientPoint, px } from "../packages/core/src/coords/index.js";
import {
  computerModernTexMetricProvider,
  createSimpleTexLayoutDocumentIr,
  groupSimpleTexVListScopes,
  layoutTexVListFromParagraphReport,
  layoutSimpleTexParagraph,
  parseSimpleTexParagraphIr,
  registerTexVListLayoutsOnOutputJax,
  texVListBoxLayoutReport,
  type PositionedTexVListItem,
  type TexBoxMetrics,
  type TexVBoxBaseline,
} from "../packages/core/src/text/tex/index.js";
import { preloadEnglishHyphenator } from "../packages/core/src/text/knuth-plass/paragraph/hyphenate.js";

function paragraphLineAssignmentsFromLayout(layout: {
  readonly paragraphPlacements: readonly {
    readonly blockIndex: number;
    readonly lineIndices: readonly number[];
  }[];
} | null | undefined): readonly { readonly blockIndex: number; readonly lineIndices: readonly number[] }[] {
  return layout?.paragraphPlacements.map((placement) => ({
    blockIndex: placement.blockIndex,
    lineIndices: [...placement.lineIndices],
  })) ?? [];
}

function registeredLayoutWithBoxReport<T extends {
  readonly items: readonly PositionedTexVListItem[];
  readonly metrics: TexBoxMetrics;
  readonly baseline: TexVBoxBaseline;
}>(layout: T): T & { readonly boxReport: ReturnType<typeof texVListBoxLayoutReport> } {
  return {
    ...layout,
    boxReport: texVListBoxLayoutReport(layout.items, layout.metrics, layout.baseline),
  };
}

function makeLineElement(
  bounds: { left: number; top: number; right: number; bottom: number },
  viewBoxWidth: number
): any {
  return {
    getBoundingClientRect: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    }),
    getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    ownerSVGElement: {
      viewBox: {
        baseVal: {
          width: viewBoxWidth,
        },
      },
    },
  };
}

function makeVListBoxElement(
  bounds: { left: number; top: number; right: number; bottom: number },
  attributes: Record<string, string>
): any {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    getBoundingClientRect: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    }),
  };
}

function makeShapedTextReport(text: string): ParagraphLayoutReport {
  const shaped = computerModernTexMetricProvider.shapeText(text);
  return {
    paragraphId: "tex:paragraph",
    width: shaped.width,
    alignment: "ragged-right",
    layoutMode: "wrap",
    lines: [
      {
        lineIndex: 0,
        startRun: 0,
        endRun: 0,
        width: shaped.width,
        targetWidth: shaped.width,
        naturalWidth: shaped.width,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0,
        xEnd: shaped.width,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "text",
            text,
            startOffset: 0,
            endOffset: text.length,
            x: 0,
            width: shaped.width,
            caretStops: [...shaped.caretStops],
          },
        ],
      },
    ],
    runs: [
      {
        runIndex: 0,
        kind: "text",
        sourceStart: 0,
        sourceEnd: text.length,
        width: shaped.width,
        text,
      },
    ],
    errors: [],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: "feasible",
  };
}

function lineTexts(report: ParagraphLayoutReport | null | undefined): string[] {
  return report?.lines.map((line) => line.segments.map((segment) => segment.text ?? "").join("")) ?? [];
}

function firstLineSpaceWidths(
  text: string,
  options: Parameters<typeof layoutSimpleTexParagraph>[1]
): number[] {
  const result = layoutSimpleTexParagraph(text, {
    hyphenator: { hyphenate: () => [] },
    ...options,
  });
  expect(result.supported).toBe(true);
  return result.report?.lines[0]?.segments
    .filter((segment) => segment.kind === "space")
    .map((segment) => segment.width) ?? [];
}

const texParagraphRegressionCases = [
  {
    id: "narrow-equal-cost-active-state",
    width: 120,
    text: "Hoyden hippopod grippal millionairism stereoroentgenography blurb parenchyma burro. Subflavor strophomenid reheap hatrail unlogicalness ptyalocele boris thermopleion cinematographer, yoop crownling paleolithy microbiosis, extrascientific quarrelsome, unstitch; saccharonate caste overuberous. Theomantic inexpressible housewifeliness, mussurana. Withhold primiparity macehead sighing. Timeling. Adenotomy. Calistheneum syndactyly chyliform; beaverboard corporosity myomatous enterohepatitis unretaliating, psychophysiologist mesorrhiny passulate criminological chondroid rubeoloid, notoriety macroglossia subjectible endomycetaceae found seabeach.",
    lines: [
      "Hoyden hippopod grip-",
      "pal millionairism stere-",
      "oroentgenography blurb",
      "parenchyma burro. Sub-",
      "flavor strophomenid re-",
      "heap hatrail unlogicalness",
      "ptyalocele boris thermo-",
      "pleion cinematographer,",
      "yoop crownling paleolithy",
      "microbiosis, extrascien-",
      "tific quarrelsome, un-",
      "stitch; saccharonate caste",
      "overuberous. Theomantic",
      "inexpressible housewifeli-",
      "ness, mussurana. With-",
      "hold primiparity macehead",
      "sighing. Timeling. Adeno-",
      "tomy. Calistheneum syn-",
      "dactyly chyliform; beaver-",
      "board corporosity myoma-",
      "tous enterohepatitis un-",
      "retaliating, psychophysi-",
      "ologist mesorrhiny passu-",
      "late criminological chon-",
      "droid rubeoloid, notoriety",
      "macroglossia subjectible",
      "endomycetaceae found",
      "seabeach.",
    ],
  },
  {
    id: "narrow-wiliness-active-state",
    width: 160,
    text: "Brushball. Refoment axillar ugarono ravenhood salmonid emboss, unequalize unenforcedly precipitatedly, draggy unshot gleg precollapse baillonella vomeronasal intercept birdcatching. Envenom. Yangtao. Taratantara thrimp. Oarcock. Unpocket silicious. Epineolithic. Intraneous toryweed. Thiocyano friend, sinuosity graphicalness, advancedness. Houseboat wiliness airliner; enouncement footwear benumbedness devitrify undercook ocellicystic indentwise turntable flaccidness arthropathy usucaptor riskfulness unheired antizymic, reparatory.",
    lines: [
      "Brushball. Refoment axillar",
      "ugarono ravenhood salmonid em-",
      "boss, unequalize unenforcedly pre-",
      "cipitatedly, draggy unshot gleg pre-",
      "collapse baillonella vomeronasal",
      "intercept birdcatching. Envenom.",
      "Yangtao. Taratantara thrimp. Oar-",
      "cock. Unpocket silicious. Epine-",
      "olithic. Intraneous toryweed. Thio-",
      "cyano friend, sinuosity graphical-",
      "ness, advancedness. Houseboat wili-",
      "ness airliner; enouncement footwear",
      "benumbedness devitrify undercook",
      "ocellicystic indentwise turntable",
      "flaccidness arthropathy usucap-",
      "tor riskfulness unheired antizymic,",
      "reparatory.",
    ],
  },
  {
    id: "narrow-overfull-final-tie",
    width: 80,
    text: "Provable katastatic vineyard undervaulted tutty, headworker ladyclock, racketlike. Peshwaship. Platymesocephalic determinator soporiferousness monocardian unexpounded verminicidal hylic unmotivatedness lionesque, shivaism ethicosocial. Boltless, guaconize procurer salinan pendent pancratiast cloyer weathergleam. Lauraldehyde thunderworm duodenotomy microcardius outcaste, imperial plotty predictor. Epoptes. Azotenesis.",
    lines: [
      "Provable",
      "katastatic vine-",
      "yard undervaulted",
      "tutty, headworker",
      "ladyclock, racket-",
      "like. Peshwaship.",
      "Platymesocephalic",
      "determinator",
      "soporiferousness",
      "monocardian",
      "unexpounded",
      "verminicidal hylic",
      "unmotivatedness",
      "lionesque, shiv-",
      "aism ethicosocial.",
      "Boltless, gua-",
      "conize procurer",
      "salinan pendent",
      "pancratiast cloyer",
      "weathergleam.",
      "Lauraldehyde",
      "thunderworm",
      "duodenotomy",
      "microcardius",
      "outcaste, imperial",
      "plotty predictor.",
      "Epoptes. Azoten-",
      "esis.",
    ],
  },
  {
    id: "normal-final-tie-regression",
    width: 200,
    text: "Panegyrical outseam fiberglas; nucleohistone. Orthosubstituted, prestigious abaiser geobiology, monodimetric brownwort, aequiculi peacock.",
    lines: [
      "Panegyrical outseam fiberglas; nucleohistone.",
      "Orthosubstituted, prestigious abaiser geo-",
      "biology, monodimetric brownwort, aequiculi",
      "peacock.",
    ],
  },
];

describe("Computer Modern OT1 text shaping", () => {
  it("uses vendored TFM widths for core Computer Modern fonts", () => {
    const cmr10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmr10" });
    const cmbx10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmbx10" });
    const cmtt10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmtt10" });
    const cmss10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmss10" });
    const cmcsc10 = computerModernTexMetricProvider.resolveFont({ fontId: "cmcsc10" });

    expect(computerModernTexMetricProvider.shapeText("A", cmr10).width).toBeCloseTo(7.50002, 5);
    expect(computerModernTexMetricProvider.shapeText("A", cmbx10).width).toBeGreaterThan(7.50002);
    expect(computerModernTexMetricProvider.shapeText("iiii", cmtt10).width).toBeCloseTo(
      computerModernTexMetricProvider.shapeText("mmmm", cmtt10).width,
      6
    );
    expect(computerModernTexMetricProvider.shapeText("Sans", cmss10).width).toBeGreaterThan(0);
    expect(computerModernTexMetricProvider.shapeText("Small", cmcsc10).width).toBeGreaterThan(0);
  });

  it("applies TeX ligature programs and keeps raw source caret stops", () => {
    const shaped = computerModernTexMetricProvider.shapeText("office");

    expect(shaped.items.filter((item) => item.kind === "glyph").map((item) => item.code)).toEqual([
      111,
      14,
      99,
      101,
    ]);
    expect(shaped.caretStops).toHaveLength("office".length + 1);
    expect(shaped.sourceCaretStops.map((stop) => stop.sourceOffset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(shaped.caretStops[0]).toBe(0);
    expect(shaped.caretStops.at(-1)).toBeCloseTo(shaped.width, 6);
  });

  it("applies TeX kern programs between shaped glyphs", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const unkerned = computerModernTexMetricProvider.shapeText("A", font).width
      + computerModernTexMetricProvider.shapeText("V", font).width;
    const shaped = computerModernTexMetricProvider.shapeText("AV", font);
    const kern = shaped.items.find((item) => item.kind === "kern");

    expect(kern).toBeDefined();
    expect(kern?.width).toBeLessThan(0);
    expect(shaped.width).toBeLessThan(unkerned);
    expect(shaped.caretStops[1]).toBeCloseTo(
      computerModernTexMetricProvider.shapeText("A", font).width + (kern?.width ?? 0),
      6
    );
  });

  it("uses the injected metric provider throughout paragraph layout", () => {
    const calls: string[] = [];
    const metricProvider = {
      resolveFont: (options?: Parameters<typeof computerModernTexMetricProvider.resolveFont>[0]) => {
        calls.push(`resolve:${options?.fontId ?? "default"}`);
        return computerModernTexMetricProvider.resolveFont(options);
      },
      shapeText: (
        text: string,
        font = computerModernTexMetricProvider.resolveFont(),
        options?: Parameters<typeof computerModernTexMetricProvider.shapeText>[2]
      ) => {
        calls.push(`shape:${text}`);
        return computerModernTexMetricProvider.shapeText(text, font, options);
      },
    };

    const result = layoutSimpleTexParagraph("Alpha Beta", {
      paragraphId: "tex:provider-seam",
      width: 80,
      metricProvider,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(calls.some((call) => call === "resolve:default")).toBe(true);
    expect(calls.some((call) => call === "shape:Alpha")).toBe(true);
    expect(calls.some((call) => call === "shape:Beta")).toBe(true);
  });

  it("feeds shaped caret stops into the existing editor hit-map path", async () => {
    const text = "office";
    const shaped = computerModernTexMetricProvider.shapeText(text);
    const report = makeShapedTextReport(text);
    const outputJax = { linebreaks: { getReports: () => [report] } };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: shaped.width, bottom: 10 }, report.width),
      ],
    };

    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: text,
      containerElement,
      offset: 3,
    });
    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: text,
      containerElement,
      clientPoint: clientPoint(px(shaped.caretStops[3]), px(2)),
    });
    const selection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: text,
      containerElement,
      startOffset: 1,
      endOffset: 4,
    });

    expect(point).toMatchObject({ ok: true, offset: 3, kind: "text" });
    expect(point.lineLocalX).toBeCloseTo(shaped.caretStops[3], 6);
    expect(caret).toMatchObject({ ok: true, offset: 3, kind: "text" });
    expect(selection.ok).toBe(true);
    const bounds = selection.rects[0]?.bounds;
    expect(Number(bounds?.minX)).toBeCloseTo(shaped.caretStops[1], 6);
    expect(Number(bounds?.maxX) - Number(bounds?.minX)).toBeCloseTo(
      shaped.caretStops[4] - shaped.caretStops[1],
      6
    );
  });
});

describe("simple TeX paragraph layout", () => {
  // These expected line arrays are cached LuaTeX oracle regressions. Refresh
  // them with `npm run compare:tex-paragraph` before changing the expectations.
  it.each(texParagraphRegressionCases)("matches cached LuaTeX paragraph oracle for $id", async ({ text, width, lines }) => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(text, {
      paragraphId: "tex:regression",
      width,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(lines);
  });

  it("matches TeX line breaks and hyphenation for a multi-sentence left-aligned paragraph", async () => {
    await preloadEnglishHyphenator();
    const text = "Consequat, mollis, vivamus, semper. Libero eget ipsum, metus augue. Etiam penatibus, justo. Integer sociis luctus pellentesque rhoncus vivamus montes metus vitae, massa, amet sem rhoncus nisi sed, feugiat. Augue ullamcorper amet sapien commodo semper tellus sed cras eleifend penatibus.";
    const result = layoutSimpleTexParagraph(text, {
      paragraphId: "tex:target",
      width: 120,
      tolerance: 200,
    });

    expect(result.supported).toBe(true);
    expect(result.report?.linebreakingMode).toBe("feasible");
    expect(lineTexts(result.report)).toEqual([
      "Consequat, mollis, vi-",
      "vamus, semper. Libero",
      "eget ipsum, metus augue.",
      "Etiam penatibus, justo.",
      "Integer sociis luctus pel-",
      "lentesque rhoncus viva-",
      "mus montes metus vitae,",
      "massa, amet sem rhoncus",
      "nisi sed, feugiat. Augue",
      "ullamcorper amet sapien",
      "commodo semper tellus",
      "sed cras eleifend penatibus.",
    ]);
  });

  it("renders TeX discretionary pre- and post-break material inside ligatures", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph("snuffless", {
      paragraphId: "tex:discretionary-ligature",
      width: 24,
      tolerance: 9999,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["snuff-", "less"]);
    expect(result.report?.lines[0]?.segments.map((segment) => segment.text)).toEqual([
      "snu",
      "ff-",
    ]);
    expect(result.report?.lines[1]?.segments.map((segment) => segment.text)).toEqual([
      "l",
      "ess",
    ]);
  });

  it("treats single newlines as interword spaces in simple TeX paragraphs", () => {
    const result = layoutSimpleTexParagraph("Alpha\nBeta Gamma", {
      paragraphId: "tex:newline-space",
      width: 150,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta Gamma"]);
  });

  it("treats TeX double backslash commands as forced line breaks", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \\ Beta`, {
      paragraphId: "tex:forced-break",
      width: 150,
      tolerance: 200,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines[0]?.break).toMatchObject({
      kind: "forced",
      lineLeading: undefined,
    });
  });

  it("preserves optional leading on TeX double backslash line breaks", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \\[7pt] Beta`, {
      paragraphId: "tex:forced-break-leading",
      width: 150,
      tolerance: 200,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta"]);
    expect(result.report?.lines[0]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "7pt",
    });
  });

  it("models TikZ text-width node indentation around par and forced line breaks", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta Gamma \par \noindent Delta \\[7pt] Epsilon`, {
      paragraphId: "tex:tikz-node-indent",
      width: 150,
      parindent: 10,
      tikzTextWidthNode: true,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta Gamma", "Delta", "Epsilon"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
      expect.closeTo(10, 6),
    ]);
  });

  it("breaks before a forced line break when the pre-break segment would be overfull", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta Gamma Delta \\ Epsilon`, {
      paragraphId: "tex:forced-break-overfull-prefix",
      width: 80,
      tikzTextWidthNode: true,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta", "Gamma Delta", "Epsilon"]);
    expect(result.report?.lines[1]?.break).toMatchObject({ kind: "forced" });
  });

  it("uses TeX paragraph-final linebreaking before non-justified forced breaks", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(String.raw`Actual careful normal paragraph natural quoted epsilon pattern. \\[4pt] Kernel editor natural modern spacing metric basic faithful shape spacing compact future,. Classic screen paragraph metric, precise careful lattice paper,.`, {
      paragraphId: "tex:forced-break-terminal-prefix",
      width: 120,
      parindent: 10,
      tikzTextWidthNode: true,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Actual careful normal",
      "paragraph natural quoted",
      "epsilon pattern.",
      "Kernel editor natural",
      "modern spacing metric ba-",
      "sic faithful shape spacing",
      "compact future,. Classic",
      "screen paragraph metric,",
      "precise careful lattice pa-",
      "per,.",
    ]);
    expect(result.report?.lines[2]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "4pt",
    });
  });

  it("does not indent the line after a forced break in justified TikZ text-width nodes", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta \\[7pt] Gamma Delta`, {
      paragraphId: "tex:justified-forced-break-indent",
      width: 240,
      alignment: "justified",
      parindent: 15,
      tikzTextWidthNode: true,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta", "Gamma Delta"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it("keeps justified forced breaks in one TeX paragraph for global demerits", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(String.raw`Model sample normal sentence anchor single pattern quoted output. \par \noindent Gamma beta position editor final faithful manual, hyphenation. \\[7pt] Quoted quoted canvas layout visible basic wide reader, sample chapter efficient.`, {
      paragraphId: "tex:justified-forced-break-demerits",
      width: 100,
      alignment: "justified",
      parindent: 10,
      tikzTextWidthNode: true,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Model sample normal",
      "sentence anchor single",
      "pattern quoted output.",
      "Gamma beta position",
      "editor final faithful",
      "manual, hyphenation.",
      "Quoted quoted canvas",
      "layout visible basic",
      "wide reader, sample",
      "chapter efficient.",
    ]);
    expect(result.report?.lines[5]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "7pt",
    });
  });

  it("distributes justified stretch according to each TeX space glue node", () => {
    const result = layoutSimpleTexParagraph(String.raw`Canvas position screen alignment rendering modern control language final. \par \noindent Precise quoted direct manual beta beta editor, paragraph normal output gamma. Editor paper screen table semantic layout.`, {
      paragraphId: "tex:justified-spacefactor-glue",
      width: 120,
      alignment: "justified",
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    const sentenceSpaceLine = result.report?.lines.find((line) =>
      line.segments.map((segment) => segment.text ?? "").join("") === "gamma. Editor paper"
    );
    expect(sentenceSpaceLine).toBeDefined();
    const spaces = sentenceSpaceLine?.segments.filter((segment) => segment.kind === "space") ?? [];
    expect(spaces).toHaveLength(2);
    expect(spaces[0]?.width).toBeGreaterThan((spaces[1]?.width ?? 0) * 2);
    const lastSegment = sentenceSpaceLine?.segments.at(-1);
    expect((lastSegment?.x ?? 0) + (lastSegment?.width ?? 0)).toBeCloseTo(120, 5);
  });

  it("uses TeX sentence spacefactor for justified final-line glue", () => {
    const normalSpace = firstLineSpaceWidths("Alpha Beta", {
      paragraphId: "tex:normal-spacefactor",
      width: 300,
      alignment: "justified",
    })[0];
    const [sentenceSpace, followingNormalSpace] = firstLineSpaceWidths("Alpha. Beta Gamma", {
      paragraphId: "tex:sentence-spacefactor",
      width: 300,
      alignment: "justified",
    });
    const [questionSpace, exclamationSpace] = firstLineSpaceWidths("Alpha? Beta! Gamma", {
      paragraphId: "tex:question-exclamation-spacefactor",
      width: 300,
      alignment: "justified",
    });

    expect(sentenceSpace).toBeGreaterThan(normalSpace ?? 0);
    expect(questionSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
    expect(exclamationSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
    expect(followingNormalSpace).toBeCloseTo(normalSpace ?? 0, 6);
  });

  it("matches TeX spacefactor for uppercase abbreviations and closing punctuation", () => {
    const normalSpace = firstLineSpaceWidths("Alpha Beta", {
      paragraphId: "tex:normal-spacefactor-baseline",
      width: 300,
      alignment: "justified",
    })[0];
    const sentenceSpace = firstLineSpaceWidths("Alpha. Beta", {
      paragraphId: "tex:sentence-spacefactor-baseline",
      width: 300,
      alignment: "justified",
    })[0];
    const [
      uppercasePeriodSpace,
      uppercaseWordSpace,
      uppercaseAcronymPeriodSpace,
      lowercaseWordSpace,
      closingParenSpace,
      followingNormalSpace,
      closingQuoteSpace,
    ] =
      firstLineSpaceWidths(String.raw`A. B NASA. Rover Alpha.) Beta Alpha." Gamma`, {
        paragraphId: "tex:uppercase-closing-spacefactor",
        width: 500,
        alignment: "justified",
      });

    expect(uppercasePeriodSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(uppercaseWordSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(uppercaseAcronymPeriodSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(lowercaseWordSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(closingParenSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
    expect(followingNormalSpace).toBeCloseTo(normalSpace ?? 0, 6);
    expect(closingQuoteSpace).toBeCloseTo(sentenceSpace ?? 0, 6);
  });

  it("scales justified stretch for comma, semicolon, and colon spacefactors", () => {
    const result = layoutSimpleTexParagraph(
      "Alpha, Beta; Gamma: Delta Epsilon Zeta Eta Theta Iota Kappa.",
      {
        paragraphId: "tex:punctuation-spacefactor-stretch",
        width: 130,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)[0]).toBe("Alpha, Beta; Gamma: Delta");
    const spaces = result.report?.lines[0]?.segments.filter((segment) => segment.kind === "space") ?? [];
    expect(spaces).toHaveLength(3);
    expect(spaces[1]?.width).toBeGreaterThan(spaces[0]?.width ?? 0);
    expect(spaces[2]?.width).toBeGreaterThan(spaces[1]?.width ?? 0);
  });

  it("uses TikZ fixed sentence spacing for non-justified text-width node glue", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const [sentenceSpace, normalSpace] = firstLineSpaceWidths("Alpha. Beta Gamma", {
      paragraphId: "tex:tikz-fixed-spacefactor",
      width: 300,
      alignment: "ragged-right",
      tikzTextWidthNode: true,
      font,
    });

    expect(sentenceSpace).toBeCloseTo(0.5 * font.atPt, 5);
    expect(normalSpace).toBeCloseTo(0.3333 * font.atPt, 5);
  });

  it("starts a fresh TeX paragraph after a blank line", () => {
    const result = layoutSimpleTexParagraph("Alpha\n\nGamma", {
      paragraphId: "tex:blank-line",
      width: 150,
      parindent: 10,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Gamma"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(10, 6),
      expect.closeTo(10, 6),
    ]);
  });

  it("treats TeX par commands as paragraph boundaries", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \par Gamma`, {
      paragraphId: "tex:par-command",
      width: 150,
      parindent: 10,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Gamma"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(10, 6),
      expect.closeTo(10, 6),
    ]);
  });

  it("suppresses paragraph indentation after TeX noindent commands", () => {
    const result = layoutSimpleTexParagraph(String.raw`\noindent Alpha \par Gamma \par \noindent Delta`, {
      paragraphId: "tex:noindent-command",
      width: 150,
      parindent: 10,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Gamma", "Delta"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(10, 6),
      expect.closeTo(0, 6),
    ]);
  });

  it("lays out LaTeX quote blocks with article-class list margins", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quote} Alpha Beta Gamma Delta Epsilon Zeta \end{quote}`,
      {
        paragraphId: "tex:quote-block",
        width: 120,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.report?.lines.length).toBeGreaterThan(1);
    expect(result.vlistLayout?.linePlacements[0]?.y).toBe(13);
    for (const line of result.report?.lines ?? []) {
      expect(line.xStart).toBeCloseTo(25, 5);
      expect(line.xEnd).toBeLessThanOrEqual(95.00001);
    }
  });

  it("positions LaTeX quote list vertical skips across paragraph boundaries", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`,
      {
        paragraphId: "tex:quote-vertical-skips",
        width: 150,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([
      0,
      22,
      38,
      60,
    ]);
  });

  it("exposes vlist layout metrics for quote/list vertical skips", () => {
    const source = String.raw`Alpha \par \begin{quote} Beta \par Gamma \end{quote} \par Delta`;
    const result = layoutSimpleTexParagraph(
      source,
      {
        paragraphId: "tex:vlist-quote-vertical-skips",
        width: 150,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.baseline).toEqual({ kind: "explicit", y: 8.5 });
    expect(result.vlistLayout?.metrics).toEqual({
      width: 150,
      height: 8.5,
      depth: 63.5,
    });
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 22, 38, 60]);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      lineIndices: placement.lineIndices,
      y: placement.y,
    }))).toEqual([
      { blockIndex: 0, lineIndices: [0], y: 0 },
      { blockIndex: 1, lineIndices: [1], y: 22 },
      { blockIndex: 2, lineIndices: [2], y: 38 },
      { blockIndex: 3, lineIndices: [3], y: 60 },
    ]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      role: item.item.kind === "vbox" ? item.item.role : undefined,
      y: item.y,
      height: item.metrics.height,
    }))).toEqual([
      { kind: "paragraph", role: undefined, y: 0, height: expect.closeTo(6.94, 2) },
      { kind: "vbox", role: { kind: "quote", depth: 1 }, y: 12, height: expect.closeTo(16.83, 2) },
      { kind: "glue", role: undefined, y: 50, height: 10 },
      { kind: "paragraph", role: undefined, y: 60, height: expect.closeTo(6.94, 2) },
    ]);
    expect(result.vlistLayout?.reports).toEqual([result.report]);

    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      defaultAlignment: "justified",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });
    expect(result.report).not.toBeNull();
    expect(result.report && layoutTexVListFromParagraphReport(
      layoutIr.vlist,
      result.report,
      {
        width: 150,
        lineHeight: 12,
        firstLineAscent: 8.5,
        paragraphLineAssignments: paragraphLineAssignmentsFromLayout(result.vlistLayout),
      }
    ).linePlacements.map((placement) => placement.y)).toEqual([0, 22, 38, 60]);
    const groupedLayout = result.report &&
      layoutTexVListFromParagraphReport(
        groupSimpleTexVListScopes(
          layoutIr.vlist,
          computerModernTexMetricProvider.resolveFont()
        ),
        result.report,
        {
          width: 150,
          lineHeight: 12,
          firstLineAscent: 8.5,
          paragraphLineAssignments: paragraphLineAssignmentsFromLayout(result.vlistLayout),
        }
      );
    expect(groupedLayout && {
      metrics: groupedLayout.metrics,
      linePlacementYs: groupedLayout.linePlacements.map((placement) => placement.y),
      items: groupedLayout.items.map((item) => ({
        kind: item.item.kind,
        role: item.item.kind === "vbox" ? item.item.role : undefined,
        y: item.y,
      })),
    }).toEqual({
      metrics: result.vlistLayout?.metrics,
      linePlacementYs: [0, 22, 38, 60],
      items: result.vlistLayout?.items.map((item) => ({
        kind: item.item.kind,
        role: item.item.kind === "vbox" ? item.item.role : undefined,
        y: item.y,
      })),
    });
  });

  it("positions vlist paragraph items across TeX forced-break leading", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \\[7pt] Beta \par Gamma`, {
      paragraphId: "tex:vlist-forced-break-leading",
      width: 150,
      alignment: "ragged-right",
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 19, 31]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      depth: item.metrics.depth,
    }))).toEqual([
      { kind: "paragraph", y: 0, depth: expect.closeTo(24.06, 2) },
      { kind: "paragraph", y: 31, depth: expect.closeTo(5.17, 2) },
    ]);
  });

  it("positions explicit vertical glue commands in the TeX vlist layout", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \smallskip Beta \par \vspace{7pt} Gamma`,
      {
        paragraphId: "tex:vlist-explicit-vertical-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 15, 34]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      stretch: item.item.kind === "glue" ? item.item.stretch : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha", stretch: undefined },
      { kind: "glue", y: 12, height: 3, text: undefined, stretch: 1 },
      { kind: "paragraph", y: 15, height: undefined, text: "Beta", stretch: undefined },
      { kind: "glue", y: 27, height: 7, text: undefined, stretch: undefined },
      { kind: "paragraph", y: 34, height: undefined, text: "Gamma", stretch: undefined },
    ]);
  });

  it("positions explicit TeX hrule commands in the vlist layout", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \hrule width 24pt height 2pt depth 1pt Beta`,
      {
        paragraphId: "tex:vlist-explicit-rule",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 11.8889]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      width: item.item.kind === "rule" ? item.metrics.width : undefined,
      height: item.item.kind === "rule" ? item.metrics.height : undefined,
      depth: item.item.kind === "rule" ? item.metrics.depth : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, width: undefined, height: undefined, depth: undefined, text: "Alpha" },
      { kind: "rule", y: 8.8889, width: 24, height: 2, depth: 1, text: undefined },
      { kind: "paragraph", y: 11.8889, width: undefined, height: undefined, depth: undefined, text: "Beta" },
    ]);
  });

  it("positions explicit TeX penalty commands as zero-height vlist items", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \penalty -50 Beta`,
      {
        paragraphId: "tex:vlist-explicit-penalty",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "penalty" ? item.metrics.height : undefined,
      depth: item.item.kind === "penalty" ? item.metrics.depth : undefined,
      penalty: item.item.kind === "penalty" ? item.item.penalty : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, depth: undefined, penalty: undefined, text: "Alpha" },
      { kind: "penalty", y: 12, height: 0, depth: 0, penalty: -50, text: undefined },
      { kind: "paragraph", y: 12, height: undefined, depth: undefined, penalty: undefined, text: "Beta" },
    ]);
  });

  it("honors negative explicit vertical glue in the TeX vlist layout", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \vspace{-4pt} Beta \par \vskip -2pt Gamma`,
      {
        paragraphId: "tex:vlist-negative-explicit-vertical-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 8, 18]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      size: item.item.kind === "glue" ? item.item.size : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha", size: undefined },
      { kind: "glue", y: 12, height: 0, text: undefined, size: -4 },
      { kind: "paragraph", y: 8, height: undefined, text: "Beta", size: undefined },
      { kind: "glue", y: 20, height: 0, text: undefined, size: -2 },
      { kind: "paragraph", y: 18, height: undefined, text: "Gamma", size: undefined },
    ]);
  });

  it("includes trailing vertical items in root vlist metrics", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Alpha \par \vspace{7pt}`,
      {
        paragraphId: "tex:vlist-trailing-vertical-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0]);
    expect(result.vlistLayout?.metrics).toEqual({
      width: 150,
      height: 8.5,
      depth: 10.5,
    });
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha" },
      { kind: "glue", y: 12, height: 7, text: undefined },
    ]);
  });

  it("sets vfill glue before lower-order finite stretch when a vlist target height is explicit", () => {
    const source = String.raw`Alpha \par \smallskip \vfill Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-vfill-natural",
      width: 150,
      alignment: "ragged-right",
    });
    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 15]);

    const constrained = result.report && layoutTexVListFromParagraphReport(
      layoutIr.vlist,
      result.report,
      {
        width: 150,
        height: 60,
        lineHeight: 12,
        firstLineAscent: 8.5,
        paragraphLineAssignments: paragraphLineAssignmentsFromLayout(result.vlistLayout),
      }
    );

    expect(constrained && {
      linePlacementYs: constrained.linePlacements.map((placement) => placement.y),
      metrics: constrained.metrics,
      items: constrained.items.map((item) => ({
        kind: item.item.kind,
        y: item.y,
        height: item.item.kind === "glue" ? item.metrics.height : undefined,
        stretchOrder: item.item.kind === "glue" ? item.item.stretchOrder : undefined,
        size: item.item.kind === "glue" ? item.item.size : undefined,
        text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      })),
    }).toEqual({
      linePlacementYs: [0, 48],
      metrics: { width: 150, height: 8.5, depth: 51.5 },
      items: [
        { kind: "paragraph", y: 0, height: undefined, stretchOrder: undefined, size: undefined, text: "Alpha" },
        { kind: "glue", y: 12, height: 3, stretchOrder: "normal", size: 3, text: undefined },
        { kind: "glue", y: 15, height: 33, stretchOrder: "fill", size: 0, text: undefined },
        { kind: "paragraph", y: 48, height: undefined, stretchOrder: undefined, size: undefined, text: "Beta" },
      ],
    });
  });

  it("sets finite vertical stretch and shrink under explicit vlist heights", () => {
    const source = String.raw`Alpha \par \vskip 6pt plus 2pt minus 3pt Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-finite-glue-set",
      width: 150,
      alignment: "ragged-right",
    });
    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 18]);

    const stretched = result.report && layoutTexVListFromParagraphReport(
      layoutIr.vlist,
      result.report,
      {
        width: 150,
        height: 32,
        lineHeight: 12,
        firstLineAscent: 8.5,
        paragraphLineAssignments: paragraphLineAssignmentsFromLayout(result.vlistLayout),
      }
    );
    const shrunk = result.report && layoutTexVListFromParagraphReport(
      layoutIr.vlist,
      result.report,
      {
        width: 150,
        height: 27,
        lineHeight: 12,
        firstLineAscent: 8.5,
        paragraphLineAssignments: paragraphLineAssignmentsFromLayout(result.vlistLayout),
      }
    );

    expect(stretched?.linePlacements.map((placement) => placement.y)).toEqual([0, 20]);
    expect(stretched?.items.map((item) =>
      item.item.kind === "glue" ? item.metrics.height : null
    )).toEqual([null, 8, null]);
    expect(stretched?.metrics).toEqual({ width: 150, height: 8.5, depth: 23.5 });

    expect(shrunk?.linePlacements.map((placement) => placement.y)).toEqual([0, 15]);
    expect(shrunk?.items.map((item) =>
      item.item.kind === "glue" ? item.metrics.height : null
    )).toEqual([null, 3, null]);
    expect(shrunk?.metrics).toEqual({ width: 150, height: 8.5, depth: 18.5 });
  });

  it("aligns a shorter vlist inside an explicit root height", () => {
    const source = String.raw`Alpha \par Beta`;
    const result = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-root-align",
      width: 150,
      alignment: "ragged-right",
    });
    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12]);

    const center = result.report && layoutTexVListFromParagraphReport(
      layoutIr.vlist,
      result.report,
      {
        width: 150,
        height: 50,
        verticalAlign: "center",
        lineHeight: 12,
        firstLineAscent: 8.5,
        paragraphLineAssignments: paragraphLineAssignmentsFromLayout(result.vlistLayout),
      }
    );
    const bottom = result.report && layoutTexVListFromParagraphReport(
      layoutIr.vlist,
      result.report,
      {
        width: 150,
        height: 50,
        verticalAlign: "bottom",
        lineHeight: 12,
        firstLineAscent: 8.5,
        paragraphLineAssignments: paragraphLineAssignmentsFromLayout(result.vlistLayout),
      }
    );

    expect(center && {
      baseline: center.baseline,
      linePlacementYs: center.linePlacements.map((placement) => placement.y),
      metrics: center.metrics,
      itemY: center.items.map((item) => item.y),
    }).toEqual({
      baseline: { kind: "explicit", y: 21.5 },
      linePlacementYs: [13, 25],
      metrics: { width: 150, height: 21.5, depth: 28.5 },
      itemY: [13, 25],
    });
    expect(bottom && {
      baseline: bottom.baseline,
      linePlacementYs: bottom.linePlacements.map((placement) => placement.y),
      metrics: bottom.metrics,
      itemY: bottom.items.map((item) => item.y),
    }).toEqual({
      baseline: { kind: "explicit", y: 34.5 },
      linePlacementYs: [26, 38],
      metrics: { width: 150, height: 34.5, depth: 15.5 },
      itemY: [26, 38],
    });
  });

  it("positions placeholder vlist items between supported paragraphs", () => {
    const source = String.raw`Alpha \par \includegraphics[width=1cm]{plot.pdf} \par Beta`;
    const placeholderStart = source.indexOf(String.raw`\includegraphics`);
    const placeholderEnd = source.indexOf(String.raw` \par Beta`);
    const supportedSource =
      source.slice(0, placeholderStart) +
      " ".repeat(placeholderEnd - placeholderStart) +
      source.slice(placeholderEnd);
    const parsed = parseSimpleTexParagraphIr(source);
    const layoutIr = createSimpleTexLayoutDocumentIr({
      blocks: parsed.blocks,
      items: parsed.items,
      defaultAlignment: "ragged-right",
      font: computerModernTexMetricProvider.resolveFont(),
      options: {},
    });
    const supported = layoutSimpleTexParagraph(supportedSource, {
      paragraphId: "tex:vlist-placeholder-reference",
      width: 150,
      alignment: "ragged-right",
    });

    expect(parsed.unsupportedCommand).toBe(true);
    expect(supported.supported).toBe(true);
    const vlistLayout = supported.report && layoutTexVListFromParagraphReport(
      layoutIr.vlist,
      supported.report,
      {
        width: 150,
        lineHeight: 12,
        firstLineAscent: 8.5,
        paragraphLineAssignments: paragraphLineAssignmentsFromLayout(supported.vlistLayout),
      }
    );

    expect(vlistLayout && {
      linePlacementYs: vlistLayout.linePlacements.map((placement) => placement.y),
      metrics: vlistLayout.metrics,
      items: vlistLayout.items.map((item) => ({
        kind: item.item.kind,
        y: item.y,
        metrics: item.metrics,
        text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
        reason: item.item.kind === "placeholder" ? item.item.reason : undefined,
        sourceSpan: item.item.sourceSpan,
      })),
    }).toEqual({
      linePlacementYs: [0, 24],
      metrics: { width: 150, height: 8.5, depth: 27.5 },
      items: [
        {
          kind: "paragraph",
          y: 0,
          metrics: expect.objectContaining({ height: expect.closeTo(6.94, 2) }),
          text: "Alpha",
          reason: undefined,
          sourceSpan: { start: 0, end: 5 },
        },
        {
          kind: "placeholder",
          y: 12,
          metrics: { width: 0, height: 8.5, depth: 3.5 },
          text: undefined,
          reason: "Unsupported TeX command in vertical mode.",
          sourceSpan: { start: placeholderStart, end: placeholderEnd },
        },
        {
          kind: "paragraph",
          y: 24,
          metrics: expect.objectContaining({ height: expect.closeTo(6.83, 2) }),
          text: "Beta",
          reason: undefined,
          sourceSpan: { start: source.indexOf("Beta"), end: source.length },
        },
      ],
    });
  });

  it("keeps whole-node fallback by default but supports opt-in placeholder fallback", () => {
    const source = String.raw`Alpha \par \includegraphics[width=1cm]{plot.pdf} \par Beta`;
    const defaultResult = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-placeholder-default-fallback",
      width: 150,
      alignment: "ragged-right",
    });
    const partialResult = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-placeholder-opt-in",
      width: 150,
      alignment: "ragged-right",
      fallbackPolicy: "placeholder",
    });

    expect(defaultResult.supported).toBe(false);
    expect(defaultResult.report).toBeNull();
    expect(defaultResult.fallbackReason).toContain("TeX syntax");

    expect(partialResult.supported).toBe(true);
    expect(partialResult.fallbackReason).toBeNull();
    expect(partialResult.report?.errors).toEqual([
      "Paragraph contains TeX syntax that is not supported by the simple text path.",
    ]);
    expect(lineTexts(partialResult.report)).toEqual(["Alpha", "Beta"]);
    expect(partialResult.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 24]);
    expect(partialResult.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      sourceSpan: item.item.sourceSpan,
    }))).toEqual([
      { kind: "paragraph", y: 0, text: "Alpha", sourceSpan: { start: 0, end: 5 } },
      {
        kind: "placeholder",
        y: 12,
        text: undefined,
        sourceSpan: {
          start: source.indexOf(String.raw`\includegraphics`),
          end: source.indexOf(String.raw` \par Beta`),
        },
      },
      {
        kind: "paragraph",
        y: 24,
        text: "Beta",
        sourceSpan: { start: source.indexOf("Beta"), end: source.length },
      },
    ]);
  });

  it("keeps explicit vertical glue inside quote vbox metadata", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quote}\smallskip Alpha\end{quote}`,
      {
        paragraphId: "tex:vlist-quote-explicit-glue",
        width: 150,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    const quote = result.vlistLayout?.items[0];
    expect(quote?.item).toMatchObject({
      kind: "vbox",
      role: { kind: "quote", depth: 1 },
    });
    expect(quote?.children?.map((item) => ({
      kind: item.item.kind,
      size: item.item.kind === "glue" ? item.item.size : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "glue", size: 3, text: undefined },
      { kind: "glue", size: 13, text: undefined },
      { kind: "paragraph", size: undefined, text: "Alpha" },
    ]);
  });

  it("reads TeX vlist box geometry from rendered SVG metadata", () => {
    const boxes = [
      makeVListBoxElement(
        { left: 100, top: 40, right: 20, bottom: 10 },
        {
          "data-tex-vbox-role": "quote",
          "data-tex-vlist-path": "0",
          "data-tex-local-x": "3",
          "data-tex-local-y": "5",
          "data-tex-local-width": "40",
          "data-tex-local-height": "12",
          "data-tex-vbox-depth": "1",
          "data-source-start": "7",
          "data-source-end": "42",
        }
      ),
      makeVListBoxElement(
        { left: 10, top: 20, right: 70, bottom: 90 },
        {
          "data-tex-vbox-role": "list",
          "data-tex-vlist-path": "0.2",
          "data-tex-local-x": "11",
          "data-tex-local-y": "17",
          "data-tex-local-width": "20",
          "data-tex-local-height": "8",
          "data-tex-list-kind": "enumerate",
          "data-tex-vbox-depth": "2",
          "data-tex-list-label-depth": "1",
          "data-tex-list-left-margin-em": "2.2",
          "data-source-start": "12",
          "data-source-end": "39",
        }
      ),
    ];

    expect(getKnuthPlassVListBoxGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-vbox="true"]' ? boxes : [],
      } as any,
    })).toEqual([
      {
        role: "quote",
        vlistPath: [0],
        localLeft: 3,
        localRight: 43,
        localTop: 5,
        localBottom: 17,
        depth: 1,
        listKind: null,
        listLabelDepth: null,
        listLeftMarginEm: null,
        listItemIndex: null,
        sourceStart: 7,
        sourceEnd: 42,
        clientLeft: 20,
        clientRight: 100,
        clientTop: 10,
        clientBottom: 40,
      },
      {
        role: "list",
        vlistPath: [0, 2],
        localLeft: 11,
        localRight: 31,
        localTop: 17,
        localBottom: 25,
        depth: 2,
        listKind: "enumerate",
        listLabelDepth: 1,
        listLeftMarginEm: 2.2,
        listItemIndex: null,
        sourceStart: 12,
        sourceEnd: 39,
        clientLeft: 10,
        clientRight: 70,
        clientTop: 20,
        clientBottom: 90,
      },
    ]);
  });

  it("reads TeX vlist box geometry from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-vbox",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "vbox",
              role: { kind: "quote", depth: 1 },
              sourceSpan: { start: 7, end: 42 },
              items: [],
            },
            path: [0],
            x: 3,
            y: 5,
            metrics: { width: 40, height: 8, depth: 4 },
            children: [
              {
                item: {
                  kind: "vbox",
                  role: {
                    kind: "list",
                    listKind: "enumerate",
                    depth: 2,
                    labelDepth: 1,
                    ownLeftMarginEm: 2.2,
                    totalLeftMarginEm: 2.2,
                  },
                  sourceSpan: { start: 12, end: 39 },
                  items: [],
                },
                path: [0, 0],
                x: 11,
                y: 17,
                metrics: { width: 20, height: 6, depth: 2 },
                children: [
                  {
                    item: {
                      kind: "vbox",
                      role: {
                        kind: "list-item",
                        listKind: "enumerate",
                        depth: 2,
                        labelDepth: 1,
                        itemIndex: 1,
                      },
                      sourceSpan: { start: 20, end: 30 },
                      items: [],
                    },
                    path: [0, 0, 0],
                    x: 13,
                    y: 19,
                    metrics: { width: 16, height: 3, depth: 2 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassVListBoxGeometry({
      outputJax,
      paragraphId: "tex:registered-vbox",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      {
        role: "quote",
        vlistPath: [0],
        localLeft: 3,
        localRight: 43,
        localTop: 5,
        localBottom: 17,
        depth: 1,
        listKind: null,
        listLabelDepth: null,
        listLeftMarginEm: null,
        listItemIndex: null,
        sourceStart: 7,
        sourceEnd: 42,
        clientLeft: 16,
        clientRight: 96,
        clientTop: 35,
        clientBottom: 71,
      },
      {
        role: "list",
        vlistPath: [0, 0],
        localLeft: 11,
        localRight: 31,
        localTop: 17,
        localBottom: 25,
        depth: 2,
        listKind: "enumerate",
        listLabelDepth: 1,
        listLeftMarginEm: 2.2,
        listItemIndex: null,
        sourceStart: 12,
        sourceEnd: 39,
        clientLeft: 32,
        clientRight: 72,
        clientTop: 71,
        clientBottom: 95,
      },
      {
        role: "list-item",
        vlistPath: [0, 0, 0],
        localLeft: 13,
        localRight: 29,
        localTop: 19,
        localBottom: 24,
        depth: 2,
        listKind: "enumerate",
        listLabelDepth: 1,
        listLeftMarginEm: null,
        listItemIndex: 1,
        sourceStart: 20,
        sourceEnd: 30,
        clientLeft: 36,
        clientRight: 68,
        clientTop: 77,
        clientBottom: 92,
      },
    ]);
  });

  it("reads TeX paragraph placement geometry from registered vlist layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-paragraph-placements",
      layout: {
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [
          {
            blockIndex: 0,
            vlistPath: [0],
            sourceSpan: { start: 0, end: 5 },
            lineIndices: [0],
            y: 3,
            metrics: { width: 80, height: 7, depth: 5 },
          },
          {
            blockIndex: 1,
            vlistPath: [1],
            sourceSpan: { start: 7, end: 16 },
            lineIndices: [1, 2],
            y: 19,
            metrics: { width: 90, height: 8, depth: 16 },
          },
        ],
        linePlacements: [
          { lineIndex: 0, y: 3, height: 12 },
          { lineIndex: 1, y: 19, height: 12 },
          { lineIndex: 2, y: 31, height: 12 },
        ],
        reports: [],
        errors: [],
        items: [],
      },
    }]);

    expect(getKnuthPlassVListParagraphGeometry({
      outputJax,
      paragraphId: "tex:registered-paragraph-placements",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered paragraph placement geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      {
        blockIndex: 0,
        vlistPath: [0],
        localLeft: 0,
        localRight: 80,
        localTop: 3,
        localBottom: 15,
        lineIndices: [0],
        sourceStart: 0,
        sourceEnd: 5,
        clientLeft: 10,
        clientRight: 170,
        clientTop: 29,
        clientBottom: 65,
      },
      {
        blockIndex: 1,
        vlistPath: [1],
        localLeft: 0,
        localRight: 90,
        localTop: 19,
        localBottom: 43,
        lineIndices: [1, 2],
        sourceStart: 7,
        sourceEnd: 16,
        clientLeft: 10,
        clientRight: 190,
        clientTop: 77,
        clientBottom: 149,
      },
    ]);
  });

  it("reads TeX placeholder geometry from rendered SVG metadata", () => {
    const placeholders = [
      makeVListBoxElement(
        { left: 120, top: 44, right: 40, bottom: 12 },
        {
          "data-tex-placeholder-reason": "Unsupported TeX command in vertical mode.",
          "data-tex-vlist-path": "1",
          "data-tex-local-x": "18",
          "data-tex-local-y": "21",
          "data-tex-local-width": "12",
          "data-tex-local-height": "6",
          "data-source-start": "11",
          "data-source-end": "48",
        }
      ),
      makeVListBoxElement(
        { left: 5, top: 5, right: 5, bottom: 20 },
        {
          "data-tex-placeholder-reason": "empty",
          "data-source-start": "1",
          "data-source-end": "2",
        }
      ),
    ];

    expect(getKnuthPlassPlaceholderGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-placeholder="true"]' ? placeholders : [],
      } as any,
    })).toEqual([
      {
        reason: "Unsupported TeX command in vertical mode.",
        vlistPath: [1],
        localLeft: 18,
        localRight: 30,
        localTop: 21,
        localBottom: 27,
        sourceStart: 11,
        sourceEnd: 48,
        clientLeft: 40,
        clientRight: 120,
        clientTop: 12,
        clientBottom: 44,
      },
    ]);
  });

  it("reads TeX placeholder geometry from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-placeholder",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "vbox",
              items: [],
            },
            path: [0],
            x: 0,
            y: 0,
            metrics: { width: 30, height: 10, depth: 5 },
            children: [
              {
                item: {
                  kind: "placeholder",
                  sourceSpan: { start: 11, end: 48 },
                  reason: "Unsupported TeX command in vertical mode.",
                  estimated: { width: 12, height: 4, depth: 2 },
                },
                path: [0, 0],
                x: 18,
                y: 21,
                metrics: { width: 12, height: 4, depth: 2 },
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassPlaceholderGeometry({
      outputJax,
      paragraphId: "tex:registered-placeholder",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered placeholder geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      {
        reason: "Unsupported TeX command in vertical mode.",
        vlistPath: [0, 0],
        localLeft: 18,
        localRight: 30,
        localTop: 21,
        localBottom: 27,
        sourceStart: 11,
        sourceEnd: 48,
        clientLeft: 46,
        clientRight: 70,
        clientTop: 83,
        clientBottom: 101,
      },
    ]);
  });

  it("reads generic TeX vlist item geometry from rendered SVG metadata", () => {
    const items = [
      makeVListBoxElement(
        { left: 20, top: 15, right: 80, bottom: 30 },
        {
          "data-tex-vlist-item": "hbox",
          "data-tex-vlist-path": "0",
          "data-tex-local-x": "2",
          "data-tex-local-y": "3",
          "data-tex-local-width": "12",
          "data-tex-local-height": "4",
          "data-source-start": "4",
          "data-source-end": "13",
        }
      ),
      makeVListBoxElement(
        { left: 12, top: 34, right: 22, bottom: 39 },
        {
          "data-tex-vlist-item": "rule",
          "data-tex-vlist-path": "1",
          "data-tex-local-x": "10",
          "data-tex-local-y": "12",
          "data-tex-local-width": "7",
          "data-tex-local-height": "3",
        }
      ),
      makeVListBoxElement(
        { left: 40, top: 44, right: 120, bottom: 76 },
        {
          "data-tex-vlist-item": "placeholder",
          "data-tex-vlist-path": "2",
          "data-tex-local-x": "18",
          "data-tex-local-y": "21",
          "data-tex-local-width": "9",
          "data-tex-local-height": "6",
          "data-tex-placeholder-reason": "Unsupported TeX command in vertical mode.",
          "data-source-start": "11",
          "data-source-end": "48",
        }
      ),
    ];

    expect(getKnuthPlassVListItemGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
    })).toEqual([
      {
        kind: "hbox",
        vlistPath: [0],
        localLeft: 2,
        localRight: 14,
        localTop: 3,
        localBottom: 7,
        sourceStart: 4,
        sourceEnd: 13,
        placeholderReason: null,
        clientLeft: 20,
        clientRight: 80,
        clientTop: 15,
        clientBottom: 30,
      },
      {
        kind: "rule",
        vlistPath: [1],
        localLeft: 10,
        localRight: 17,
        localTop: 12,
        localBottom: 15,
        sourceStart: null,
        sourceEnd: null,
        placeholderReason: null,
        clientLeft: 12,
        clientRight: 22,
        clientTop: 34,
        clientBottom: 39,
      },
      {
        kind: "placeholder",
        vlistPath: [2],
        localLeft: 18,
        localRight: 27,
        localTop: 21,
        localBottom: 27,
        sourceStart: 11,
        sourceEnd: 48,
        placeholderReason: "Unsupported TeX command in vertical mode.",
        clientLeft: 40,
        clientRight: 120,
        clientTop: 44,
        clientBottom: 76,
      },
    ]);
  });

  it("reads generic TeX vlist item geometry from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-items",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "hbox",
              sourceSpan: { start: 4, end: 13 },
              box: {
                metrics: { width: 12, height: 3, depth: 1 },
                renderItems: [],
              },
            },
            path: [0],
            x: 2,
            y: 3,
            metrics: { width: 12, height: 3, depth: 1 },
          },
          {
            item: {
              kind: "vbox",
              items: [],
            },
            path: [1],
            x: 0,
            y: 0,
            metrics: { width: 30, height: 10, depth: 5 },
            children: [
              {
                item: {
                  kind: "rule",
                  width: 7,
                  height: 2,
                  depth: 1,
                },
                path: [1, 0],
                x: 10,
                y: 12,
                metrics: { width: 7, height: 2, depth: 1 },
              },
              {
                item: {
                  kind: "penalty",
                  sourceSpan: { start: 20, end: 31 },
                  penalty: -50,
                },
                path: [1, 1],
                x: 14,
                y: 16,
                metrics: { width: 0, height: 0, depth: 0 },
              },
              {
                item: {
                  kind: "placeholder",
                  sourceSpan: { start: 40, end: 52 },
                  reason: "Unsupported TeX command in vertical mode.",
                  estimated: { width: 9, height: 4, depth: 2 },
                },
                path: [1, 2],
                x: 18,
                y: 21,
                metrics: { width: 9, height: 4, depth: 2 },
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassVListItemGeometry({
      outputJax,
      paragraphId: "tex:registered-items",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist item geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      {
        kind: "hbox",
        vlistPath: [0],
        localLeft: 2,
        localRight: 14,
        localTop: 3,
        localBottom: 7,
        sourceStart: 4,
        sourceEnd: 13,
        placeholderReason: null,
        clientLeft: 14,
        clientRight: 38,
        clientTop: 29,
        clientBottom: 41,
      },
      {
        kind: "rule",
        vlistPath: [1, 0],
        localLeft: 10,
        localRight: 17,
        localTop: 12,
        localBottom: 15,
        sourceStart: null,
        sourceEnd: null,
        placeholderReason: null,
        clientLeft: 30,
        clientRight: 44,
        clientTop: 56,
        clientBottom: 65,
      },
      {
        kind: "penalty",
        vlistPath: [1, 1],
        localLeft: 14,
        localRight: 14,
        localTop: 16,
        localBottom: 16,
        sourceStart: 20,
        sourceEnd: 31,
        placeholderReason: null,
        clientLeft: 38,
        clientRight: 38,
        clientTop: 68,
        clientBottom: 68,
      },
      {
        kind: "placeholder",
        vlistPath: [1, 2],
        localLeft: 18,
        localRight: 27,
        localTop: 21,
        localBottom: 27,
        sourceStart: 40,
        sourceEnd: 52,
        placeholderReason: "Unsupported TeX command in vertical mode.",
        clientLeft: 46,
        clientRight: 64,
        clientTop: 83,
        clientBottom: 101,
      },
    ]);
  });

  it("renders enumerate labels in the article list margin", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item Alpha Beta\item Gamma\end{enumerate}`,
      {
        paragraphId: "tex:enumerate-list",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["1.Alpha Beta", "2.Gamma"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(25, 6),
    ]);
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      text: "1.",
      fontId: "cmr10",
    });
    expect(result.report?.lines[0]?.segments[0]?.x ?? 0).toBeLessThan(20);
    expect(result.report?.lines[0]?.segments[1]).toMatchObject({
      kind: "text",
      text: "Alpha",
      x: expect.closeTo(25, 6),
    });
  });

  it("represents multi-paragraph list item bodies as nested vboxes", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item Alpha \par Beta\item Gamma\end{enumerate}`,
      {
        paragraphId: "tex:vlist-list-item-boxes",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.vlistLayout?.boxReport.items
      .filter((item) => item.role?.kind === "list-item")
      .map((item) => ({
        path: item.path,
        role: item.role,
        sourceSpan: item.sourceSpan,
      }))).toEqual([
      {
        path: [0, 0],
        role: {
          kind: "list-item",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
        },
        sourceSpan: {
          start: expect.any(Number),
          end: expect.any(Number),
        },
      },
      {
        path: [0, 1],
        role: {
          kind: "list-item",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 2,
        },
        sourceSpan: {
          start: expect.any(Number),
          end: expect.any(Number),
        },
      },
    ]);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      vlistPath: placement.vlistPath,
    }))).toEqual([
      { blockIndex: 0, vlistPath: [0, 0, 1] },
      { blockIndex: 1, vlistPath: [0, 0, 3] },
      { blockIndex: 2, vlistPath: [0, 1, 1] },
    ]);
  });

  it("renders custom item labels and nested list margins", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item[Step] Alpha \begin{enumerate}\item Nested\end{enumerate}\end{enumerate}`,
      {
        paragraphId: "tex:nested-list",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["StepAlpha", "(a)Nested"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(47, 6),
    ]);
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      text: "Step",
      fontId: "cmr10",
    });
    expect(result.report?.lines[1]?.segments[0]).toMatchObject({
      kind: "text",
      text: "(a)",
      fontId: "cmr10",
    });
  });

  it("renders description labels as bold in-flow labels with hanging continuation", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{description}\item[Term] Alpha Beta Gamma Delta Epsilon Zeta\item Plain Entry\end{description}`,
      {
        paragraphId: "tex:description-list",
        width: 90,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)[0]).toBe("TermAlpha Beta");
    expect(lineTexts(result.report).at(-1)).toBe("Plain Entry");
    expect(result.report?.lines[0]?.xStart).toEqual(expect.closeTo(5, 6));
    expect(result.report?.lines[1]?.xStart).toEqual(expect.closeTo(25, 6));
    expect(result.report?.lines.at(-1)?.xStart).toEqual(expect.closeTo(0, 6));
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      text: "Term",
      fontId: "cmbx10",
      x: expect.closeTo(5, 6),
    });
    expect(result.report?.lines[0]?.segments[1]).toMatchObject({
      kind: "text",
      text: "Alpha",
      fontId: "cmr10",
    });
  });

  it("renders first-slice itemize labels in the article list margin", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{itemize}\item Alpha\item Beta\end{itemize}`,
      {
        paragraphId: "tex:itemize-list",
        width: 150,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["•Alpha", "•Beta"]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(25, 6),
    ]);
    expect(result.report?.lines[0]?.segments[0]).toMatchObject({
      kind: "text",
      text: "•",
      fontId: "lmroman10-regular",
      glyphCode: 0x2022,
    });
  });

  it("renders nested itemize labels with LaTeX article font/code choices", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{itemize}\item Alpha \begin{itemize}\item Beta \begin{itemize}\item Gamma \begin{itemize}\item Delta\end{itemize}\end{itemize}\end{itemize}\end{itemize}`,
      {
        paragraphId: "tex:nested-itemize-list",
        width: 180,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.report?.lines.map((line) => line.segments[0]))
      .toMatchObject([
        { text: "•", fontId: "lmroman10-regular", glyphCode: 0x2022 },
        { text: "–", fontId: "lmroman10-regular", glyphCode: 0x2013 },
        { text: "*", fontId: "tcrm1000", glyphCode: 42 },
        { text: ".", fontId: "tcrm1000", glyphCode: 183 },
      ]);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual([
      expect.closeTo(25, 6),
      expect.closeTo(47, 6),
      expect.closeTo(65.7, 6),
      expect.closeTo(82.7, 6),
    ]);
  });

  it("positions natural LaTeX article list vertical spacing", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Before \par \begin{itemize}\item Alpha \par More \item Beta \begin{itemize}\item Nested\end{itemize}\end{itemize} \par After`,
      {
        paragraphId: "tex:list-vertical-spacing",
        width: 180,
        alignment: "ragged-right",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Before",
      "•Alpha",
      "More",
      "•Beta",
      "–Nested",
      "After",
    ]);
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([
      0,
      22,
      38,
      58,
      78,
      100,
    ]);
  });

  it("does not add TikZ forced-break paragraph indent inside list item bodies", async () => {
    await preloadEnglishHyphenator();
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item option precise model \textit{shape}. \item Language double double. \\[4pt] Result reader metric computer baseline language. \item Visible precise gamma shape epsilon. \par Control gamma sentence screen.\end{enumerate}`,
      {
        paragraphId: "tex:list-forced-break-indent",
        width: 220,
        alignment: "ragged-left",
        parindent: 15,
        tikzTextWidthNode: true,
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "1.option precise model shape.",
      "2.Language double double.",
      "Result reader metric computer baseline lan-",
      "guage.",
      "3.Visible precise gamma shape epsilon.",
      "Control gamma sentence screen.",
    ]);
    expect(result.report?.lines[1]?.break).toMatchObject({
      kind: "forced",
      lineLeading: "4pt",
    });
    expect(result.report?.lines[2]?.xStart).toBeCloseTo(25, 6);
  });

  it("uses LaTeX list ragged-right stretch for item line breaking", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{itemize}\item Computer compact alignment, normal baseline paper output classic.\end{itemize}`,
      {
        paragraphId: "tex:list-ragged-breaks",
        width: 180,
        alignment: "ragged-right",
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "•Computer compact alignment,",
      "normal baseline paper output",
      "classic.",
    ]);
  });

  it("uses LaTeX list ragged-left skips for item line breaking", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{enumerate}\item Careful control paragraph language local, chapter.\end{enumerate}`,
      {
        paragraphId: "tex:list-ragged-left-breaks",
        width: 120,
        alignment: "ragged-left",
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "1.Careful control para-",
      "graph language local,",
      "chapter.",
    ]);
  });

  it("preserves nested inline font command fonts in line segments", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`A \textit{B \emph{C} \textbf{D}} \textnormal{\textbf{E}} \textrm{F} \textsf{G \textbf{H \textit{I}} \textsc{J}} \textsc{K \textsf{L} \textbf{M}} \textsf{\textbf{\textsc{N}}}`,
      {
        paragraphId: "tex:inline-fonts",
        width: 500,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["A B C D E F G H I J K L M N"]);
    expect(result.report?.lines[0]?.segments
      .filter((segment) => segment.kind === "text")
      .map((segment) => ({ text: segment.text, fontId: segment.fontId }))).toEqual([
        { text: "A", fontId: "cmr10" },
        { text: "B", fontId: "cmti10" },
        { text: "C", fontId: "cmr10" },
        { text: "D", fontId: "cmbxti10" },
        { text: "E", fontId: "cmbx10" },
        { text: "F", fontId: "cmr10" },
        { text: "G", fontId: "cmss10" },
        { text: "H", fontId: "cmssbx10" },
        { text: "I", fontId: "cmssbx10" },
        { text: "J", fontId: "cmcsc10" },
        { text: "K", fontId: "cmcsc10" },
        { text: "L", fontId: "cmcsc10" },
        { text: "M", fontId: "cmbx10" },
        { text: "N", fontId: "cmssbx10" },
      ]);
  });

  it("preserves scoped font declaration fonts in line segments", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`A {\it B {\bf C} D} {\itshape E {\bfseries F}} {\sf G {\bf H} {\bfseries I} {\sc J}} {\scshape K {\sffamily L} {\bfseries M}} {\em N {\em O} P} Q`,
      {
        paragraphId: "tex:inline-font-declarations",
        width: 500,
        alignment: "justified",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["A B C D E F G H I J K L M N O P Q"]);
    expect(result.report?.lines[0]?.segments
      .filter((segment) => segment.kind === "text")
      .map((segment) => ({ text: segment.text, fontId: segment.fontId }))).toEqual([
        { text: "A", fontId: "cmr10" },
        { text: "B", fontId: "cmti10" },
        { text: "C", fontId: "cmbx10" },
        { text: "D", fontId: "cmti10" },
        { text: "E", fontId: "cmti10" },
        { text: "F", fontId: "cmbxti10" },
        { text: "G", fontId: "cmss10" },
        { text: "H", fontId: "cmbx10" },
        { text: "I", fontId: "cmssbx10" },
        { text: "J", fontId: "cmcsc10" },
        { text: "K", fontId: "cmcsc10" },
        { text: "L", fontId: "cmcsc10" },
        { text: "M", fontId: "cmbx10" },
        { text: "N", fontId: "cmti10" },
        { text: "O", fontId: "cmr10" },
        { text: "P", fontId: "cmti10" },
        { text: "Q", fontId: "cmr10" },
      ]);
  });

  it("uses LaTeX quote-local paragraph skips under centered nodes", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`\begin{quote} Alpha Beta Gamma Delta Epsilon Zeta \end{quote}`,
      {
        paragraphId: "tex:centered-quote-block",
        width: 120,
        alignment: "center",
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(result.supported).toBe(true);
    expect(result.report?.lines.length).toBeGreaterThan(1);
    expect(result.report?.lines.map((line) => line.xStart)).toEqual(
      Array.from({ length: result.report?.lines.length ?? 0 }, () => expect.closeTo(25, 5))
    );
  });

  it("honors TeX paragraph alignment declarations at paragraph start", () => {
    const centered = layoutSimpleTexParagraph(String.raw`\centering Alpha Beta`, {
      paragraphId: "tex:centering",
      width: 120,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    const raggedLeft = layoutSimpleTexParagraph(String.raw`\raggedleft Alpha Beta`, {
      paragraphId: "tex:raggedleft",
      width: 120,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    const raggedRight = layoutSimpleTexParagraph(String.raw`\raggedright Alpha Beta`, {
      paragraphId: "tex:raggedright",
      width: 120,
      alignment: "center",
      hyphenator: { hyphenate: () => [] },
    });

    expect(centered.supported).toBe(true);
    expect(centered.report?.alignment).toBe("center");
    expect(centered.report?.lines[0]?.xStart).toBeCloseTo(34.930645, 5);
    expect(raggedLeft.supported).toBe(true);
    expect(raggedLeft.report?.alignment).toBe("ragged-left");
    expect(raggedLeft.report?.lines[0]?.xEnd).toBeCloseTo(120, 5);
    expect(raggedRight.supported).toBe(true);
    expect(raggedRight.report?.alignment).toBe("ragged-right");
    expect(raggedRight.report?.lines[0]?.xStart).toBeCloseTo(0, 6);
  });

  it("allows paragraph alignment declarations after TeX paragraph boundaries", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha Beta \par \centering Gamma Delta`, {
      paragraphId: "tex:paragraph-centering",
      width: 120,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["Alpha Beta", "Gamma Delta"]);
    expect(result.report?.lines[0]?.xStart).toBeCloseTo(0, 6);
    expect(result.report?.lines[1]?.xStart).toBeGreaterThan(0);
    expect(result.report?.lines[1]?.xEnd).toBeLessThan(120);
  });

  it("keeps TikZ text-width alignment when LaTeX declarations appear after par", () => {
    const centeredInRightNode = layoutSimpleTexParagraph(
      String.raw`Alignment position baseline editor, beta. \par \centering Computer vector semantic visible wide manual, office beta, result basic final.`,
      {
        paragraphId: "tex:tikz-right-centering-declaration",
        width: 240,
        alignment: "ragged-left",
        parindent: 10,
        tikzTextWidthNode: true,
        hyphenator: { hyphenate: () => [] },
      }
    );
    const raggedRightInRightNode = layoutSimpleTexParagraph(
      String.raw`Normal table figure vector quoted, lattice wide compact result. \par \raggedright Paper normal basic, reader, quoted sentence wide manual normal lattice. Classic computer classic single screen faithful actual nested,.`,
      {
        paragraphId: "tex:tikz-right-raggedright-declaration",
        width: 240,
        alignment: "ragged-left",
        parindent: 15,
        tikzTextWidthNode: true,
        hyphenator: { hyphenate: () => [] },
      }
    );

    expect(centeredInRightNode.supported).toBe(true);
    expect(centeredInRightNode.report?.alignment).toBe("ragged-left");
    expect(lineTexts(centeredInRightNode.report)).toEqual([
      "Alignment position baseline editor, beta.",
      "Computer vector semantic visible wide",
      "manual, office beta, result basic final.",
    ]);
    expect(raggedRightInRightNode.supported).toBe(true);
    expect(raggedRightInRightNode.report?.alignment).toBe("ragged-left");
    expect(lineTexts(raggedRightInRightNode.report)).toEqual([
      "Normal table figure vector quoted,",
      "lattice wide compact result.",
      "Paper normal basic, reader, quoted sentence",
      "wide manual normal lattice. Classic computer",
      "classic single screen faithful actual nested,.",
    ]);
  });

  it("resets TikZ text-width declaration alignment for following list items", () => {
    const result = layoutSimpleTexParagraph(
      String.raw`Rendering anchor beta office wide sample precise alpha classic nested sample,. \par \raggedleft Kernel manual editor classic local. \textbf{anchor double pattern model screen} \textrm{rendering chapter chapter}. \par \begin{itemize}\item office direct normal \textit{rendering epsilon figure}. \item \textbf{final rendering modern} Anchor spacing vector result pattern position.\end{itemize}`,
      {
        paragraphId: "tex:tikz-declaration-list-reset",
        width: 120,
        alignment: "justified",
        parindent: 15,
        tikzTextWidthNode: true,
      }
    );

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual([
      "Rendering anchor beta of-",
      "fice wide sample precise al-",
      "pha classic nested sample,.",
      "Kernel manual editor",
      "classic local. anchor",
      "double pattern model",
      "screen rendering chapter",
      "chapter.",
      "•office direct normal",
      "rendering epsilon fig-",
      "ure.",
      "•final rendering",
      "modern Anchor",
      "spacing vector result",
      "pattern position.",
    ]);
  });

  it("falls back when TeX noindent appears inside a paragraph", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \noindent Beta`, {
      paragraphId: "tex:noindent-mid-paragraph",
      width: 150,
      parindent: 10,
    });

    expect(result.supported).toBe(false);
    expect(result.fallbackReason).toContain("TeX syntax");
  });

  it("falls back when TeX alignment declarations appear inside a paragraph", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha \centering Beta`, {
      paragraphId: "tex:centering-mid-paragraph",
      width: 150,
      hyphenator: { hyphenate: () => [] },
    });

    expect(result.supported).toBe(false);
    expect(result.fallbackReason).toContain("TeX syntax");
  });

  it("wraps plain text with TeX-shaped Computer Modern word widths", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const alphaWidth = computerModernTexMetricProvider.shapeText("Alpha", font).width;
    const betaWidth = computerModernTexMetricProvider.shapeText("Beta", font).width;
    const result = layoutSimpleTexParagraph("Alpha Beta", {
      paragraphId: "tex:wrap",
      width: Math.max(alphaWidth, betaWidth) + 0.01,
      font,
    });

    expect(result.supported).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.report?.lines).toHaveLength(2);
    expect(result.report?.lines[0]?.segments.map((segment) => segment.text).join("")).toBe("Alpha");
    expect(result.report?.lines[1]?.segments.map((segment) => segment.text).join("")).toBe("Beta");
    expect(result.report?.runs.filter((run) => run.kind === "text").map((run) => run.width)).toEqual(
      expect.arrayContaining([
        expect.closeTo(alphaWidth, 6),
        expect.closeTo(betaWidth, 6),
      ])
    );
  });

  it("reports whole-node fallback for unsupported TeX syntax", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha $x$`, {
      paragraphId: "tex:fallback",
      width: 100,
    });

    expect(result.supported).toBe(false);
    expect(result.report).toBeNull();
    expect(result.fallbackReason).toContain("TeX syntax");
    expect(result.errors).toEqual([result.fallbackReason]);
  });

  it("keeps current editor hit testing usable for TeX paragraph reports", async () => {
    const sourceText = "office AV To";
    const font = computerModernTexMetricProvider.resolveFont();
    const officeWidth = computerModernTexMetricProvider.shapeText("office", font).width;
    const avWidth = computerModernTexMetricProvider.shapeText("AV", font).width;
    const spaceWidth = font.data.fontdimen.space * font.atPt;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:hitmap",
      width: officeWidth + spaceWidth + avWidth + 0.01,
      font,
    });
    const report = result.report;
    expect(report).not.toBeNull();
    expect(report?.lines).toHaveLength(2);

    const outputJax = { linebreaks: { getReports: () => [report as ParagraphLayoutReport] } };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 0, bottom: 10 }, report?.width ?? 1),
        makeLineElement({ left: 0, top: 12, right: report?.width ?? 0, bottom: 22 }, report?.width ?? 1),
      ],
    };
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:hitmap",
      sourceText,
      containerElement,
      offset: 3,
    });
    const secondLinePoint = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:hitmap",
      sourceText,
      containerElement,
      offset: sourceText.length,
    });

    expect(point).toMatchObject({ ok: true, offset: 3, kind: "text", lineIndex: 0 });
    expect(point.lineLocalX).toBeCloseTo(
      computerModernTexMetricProvider.shapeText("office", font).caretStops[3],
      6
    );
    expect(secondLinePoint).toMatchObject({ ok: true, offset: sourceText.length, kind: "text", lineIndex: 1 });
  });
});
