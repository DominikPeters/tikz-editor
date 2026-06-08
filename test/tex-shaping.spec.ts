import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import { clientPoint, px } from "../packages/core/src/coords/index.js";
import {
  computerModernTexMetricProvider,
  layoutSimpleTexParagraph,
} from "../packages/core/src/text/tex/index.js";
import { preloadEnglishHyphenator } from "../packages/core/src/text/knuth-plass/paragraph/hyphenate.js";

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

    expect(computerModernTexMetricProvider.shapeText("A", cmr10).width).toBeCloseTo(7.50002, 5);
    expect(computerModernTexMetricProvider.shapeText("A", cmbx10).width).toBeGreaterThan(7.50002);
    expect(computerModernTexMetricProvider.shapeText("iiii", cmtt10).width).toBeCloseTo(
      computerModernTexMetricProvider.shapeText("mmmm", cmtt10).width,
      6
    );
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
    expect(result.report?.lines[0]?.verticalSkipBefore).toBe(10);
    for (const line of result.report?.lines ?? []) {
      expect(line.xStart).toBeCloseTo(25, 5);
      expect(line.xEnd).toBeLessThanOrEqual(95.00001);
    }
  });

  it("reports LaTeX quote list vertical skips across paragraph boundaries", () => {
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
    expect(result.report?.lines.map((line) => line.verticalSkipBefore ?? 0)).toEqual([
      0,
      10,
      4,
      10,
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
