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
