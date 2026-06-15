import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  getKnuthPlassCaretFromPoint,
  getKnuthPlassPlaceholderGeometry,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  getKnuthPlassVListBoxFromPoint,
  getKnuthPlassVListBoxGeometry,
  getKnuthPlassVListGeometrySnapshot,
  getKnuthPlassVListItemFromPoint,
  getKnuthPlassVListItemGeometry,
  getKnuthPlassVListLabelFromPoint,
  getKnuthPlassVListLabelGeometry,
  getKnuthPlassVListParagraphGeometry,
  getKnuthPlassVListTreeHitFromSnapshot,
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import { clientPoint, px } from "../packages/core/src/coords/index.js";
import {
  classicComputerModernTextFontProfile,
  computerModernTexMetricProvider,
  createTexDerivedInlineMathBoxProvider,
  createSimpleTexLayoutDocumentIr,
  layoutSimpleTexParagraph,
  parseSimpleTexParagraphIr,
  type TexMathBoxProvider,
} from "../packages/core/src/text/tex/index.js";
import {
  groupSimpleTexVListScopes,
  layoutTexVListFromMeasuredParagraphs,
  registerTexVListLayoutsOnOutputJax,
  texVListBoxLayoutReport,
  type PositionedTexVListItem,
  type TexBoxMetrics,
  type TexVListDocument,
  type TexVListLayout,
  type TexVListParagraphBoxMeasurement,
  type TexVBoxBaseline,
} from "../packages/core/src/text/tex/vlist/index.js";
import { preloadEnglishHyphenator } from "../packages/core/src/text/knuth-plass/paragraph/hyphenate.js";

function relayoutFromExistingVListLayout(
  document: TexVListDocument,
  layout: TexVListLayout | null | undefined,
  options: {
    readonly width: number;
    readonly height?: number;
    readonly verticalAlign?: "top" | "center" | "bottom";
    readonly lineHeight: number;
    readonly firstLineAscent: number;
  }
): TexVListLayout | null {
  if (!layout) {
    return null;
  }
  const linePlacementsByIndex = new Map(
    layout.linePlacements.map((placement) => [placement.lineIndex, placement])
  );
  const paragraphMeasurements: TexVListParagraphBoxMeasurement[] =
    layout.paragraphPlacements.map((placement) => {
      const advance = placement.metrics.height + placement.metrics.depth;
      return {
        blockIndex: placement.blockIndex,
        vlistPath: placement.vlistPath,
        lineIndices: placement.lineIndices,
        lineOffsets: placement.lineIndices.map((lineIndex) => ({
          lineIndex,
          y: (linePlacementsByIndex.get(lineIndex)?.y ?? placement.y) - placement.y,
        })),
        standardMetrics: placement.metrics,
        ruleLeadingMetrics: placement.metrics,
        standardAdvance: advance,
        ruleLeadingAdvance: advance,
      };
    });
  return layoutTexVListFromMeasuredParagraphs(document, {
    width: options.width,
    height: options.height,
    verticalAlign: options.verticalAlign,
    lineHeight: options.lineHeight,
    firstLineIndex: layout.linePlacements[0]?.lineIndex,
    firstLineAscent: options.firstLineAscent,
    paragraphMeasurements,
    reports: layout.reports,
    errors: layout.errors,
  });
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

function makeDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pickFuzzItem<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length) % items.length]!;
}

function makeFakeInlineMathBoxProvider(
  widthForContent: (content: string) => number = (content) => 8 + content.length * 4
): TexMathBoxProvider {
  return {
    getInlineMathBox: (params) => ({
      source: params.source,
      content: params.content,
      sourceStart: params.sourceStart,
      sourceEnd: params.sourceEnd,
      contentStart: params.contentStart,
      contentEnd: params.contentEnd,
      width: widthForContent(params.content),
      height: 7,
      depth: 2,
      svgBody: `<g data-fake-inline-math="${params.content}"></g>`,
    }),
  };
}

function makeFakeInlineMathTex2Svg(unitWidth = 1): (tex: string) => {
  readonly querySelector: () => { readonly getAttribute: (name: string) => string | null };
} {
  return (tex: string) => {
    const content = /\\textstyle\{([\s\S]*)\}/.exec(tex)?.[1] ?? tex;
    const width = Math.max(0, content.length * unitWidth);
    return {
      querySelector: () => ({
        getAttribute: (name: string) => (name === "viewBox" ? `0 0 ${width} 1` : null),
      }),
    };
  };
}

type TexHitMapFuzzCase = {
  readonly id: string;
  readonly source: string;
  readonly width: number;
  readonly offsets: readonly number[];
};

type TexMathHitMapFuzzOffset = {
  readonly offset: number;
  readonly kind: "text" | "math";
};

type TexMathHitMapFuzzCase = {
  readonly id: string;
  readonly source: string;
  readonly width: number;
  readonly offsets: readonly TexMathHitMapFuzzOffset[];
};

function buildTexHitMapFuzzCase(index: number): TexHitMapFuzzCase {
  const random = makeDeterministicRandom(0x54584d00 + index);
  const words = [
    "Alpha",
    "beta",
    "canvas",
    "delta",
    "editor",
    "focus",
    "gamma",
    "layout",
    "metric",
    "stable",
    "test",
    "vector",
  ];
  const commands = ["textsf", "textbf", "textit", "textsc"] as const;
  const declarations = ["it", "bf", "sf", "sc"] as const;
  const offsets: number[] = [];
  let source = "";

  const appendSeparator = () => {
    if (source.length > 0 && !/[\s{]$/.test(source)) {
      source += " ";
    }
  };
  const appendTrackedWord = (word: string) => {
    const start = source.length;
    source += word;
    if (word.length > 1) {
      offsets.push(start + 1);
    }
    if (word.length > 3) {
      offsets.push(start + Math.floor(word.length / 2));
      offsets.push(start + word.length - 1);
    }
  };
  const appendPlainWord = () => {
    appendSeparator();
    appendTrackedWord(pickFuzzItem(words, random));
  };
  const appendCommand = () => {
    appendSeparator();
    const command = pickFuzzItem(commands, random);
    source += `\\${command}{`;
    appendTrackedWord(pickFuzzItem(words, random));
    if (random() < 0.55) {
      source += " ";
      appendTrackedWord(pickFuzzItem(words, random));
    }
    source += "}";
  };
  const appendNestedCommand = () => {
    appendSeparator();
    const outer = pickFuzzItem(commands, random);
    const inner = pickFuzzItem(commands, random);
    source += `\\${outer}{`;
    appendTrackedWord(pickFuzzItem(words, random));
    source += ` \\${inner}{`;
    appendTrackedWord(pickFuzzItem(words, random));
    source += "}}";
  };
  const appendDeclarationGroup = () => {
    appendSeparator();
    const declaration = pickFuzzItem(declarations, random);
    source += `{\\${declaration} `;
    appendTrackedWord(pickFuzzItem(words, random));
    if (random() < 0.45) {
      source += " ";
      appendTrackedWord(pickFuzzItem(words, random));
    }
    source += "}";
  };
  const appendForcedBreak = () => {
    appendSeparator();
    source += random() < 0.5 ? String.raw`\\` : String.raw`\\[7pt]`;
    source += " ";
  };

  const tokenCount = 5 + Math.floor(random() * 4);
  const breakAt = 1 + Math.floor(random() * (tokenCount - 2));
  for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
    if (tokenIndex === breakAt || (tokenIndex > 1 && tokenIndex < tokenCount - 1 && random() < 0.12)) {
      appendForcedBreak();
    }
    const variant = random();
    if (variant < 0.3) {
      appendPlainWord();
    } else if (variant < 0.62) {
      appendCommand();
    } else if (variant < 0.84) {
      appendNestedCommand();
    } else {
      appendDeclarationGroup();
    }
  }

  return {
    id: `tex-hitmap-fuzz-${index}`,
    source,
    width: pickFuzzItem([70, 90, 120, 150], random),
    offsets: [...new Set(offsets)].sort((left, right) => left - right),
  };
}

function buildTexMathHitMapFuzzCase(index: number): TexMathHitMapFuzzCase {
  const random = makeDeterministicRandom(0x4d415448 + index);
  const words = [
    "Alpha",
    "beta",
    "canvas",
    "delta",
    "editor",
    "focus",
    "gamma",
    "layout",
    "metric",
    "stable",
  ];
  const formulas = [
    "x-y",
    "x^2",
    String.raw`\frac{1}{2}`,
    String.raw`\sqrt{x}`,
    String.raw`\hat{x}^2`,
    String.raw`\vec{z}_y`,
  ];
  const offsets: TexMathHitMapFuzzOffset[] = [];
  let source = "";

  const appendSeparator = () => {
    if (source.length > 0 && !/\s$/.test(source)) {
      source += " ";
    }
  };
  const appendWord = () => {
    appendSeparator();
    const word = pickFuzzItem(words, random);
    const start = source.length;
    source += word;
    offsets.push({ offset: start + Math.max(1, Math.floor(word.length / 2)), kind: "text" });
    if (word.length > 3) {
      offsets.push({ offset: start + word.length - 1, kind: "text" });
    }
  };
  const appendMath = () => {
    appendSeparator();
    const formula = pickFuzzItem(formulas, random);
    const delimiter = random() < 0.5 ? "dollar" : "paren";
    const rawStart = source.length;
    if (delimiter === "dollar") {
      source += `$${formula}$`;
      const contentStart = rawStart + 1;
      offsets.push({ offset: contentStart + Math.floor(formula.length / 2), kind: "math" });
      offsets.push({ offset: contentStart + formula.length, kind: "math" });
      return;
    }
    source += String.raw`\(` + formula + String.raw`\)`;
    const contentStart = rawStart + 2;
    offsets.push({ offset: contentStart + Math.floor(formula.length / 2), kind: "math" });
    offsets.push({ offset: contentStart + formula.length, kind: "math" });
  };
  const appendForcedBreak = () => {
    appendSeparator();
    source += random() < 0.5 ? String.raw`\\` : String.raw`\\[7pt]`;
    source += " ";
  };

  const tokenCount = 7 + Math.floor(random() * 4);
  const breakAt = 2 + Math.floor(random() * Math.max(1, tokenCount - 4));
  for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex++) {
    if (tokenIndex === breakAt || (tokenIndex > 2 && tokenIndex < tokenCount - 1 && random() < 0.1)) {
      appendForcedBreak();
    }
    if (tokenIndex === 1 || tokenIndex === tokenCount - 2 || random() < 0.42) {
      appendMath();
    } else {
      appendWord();
    }
  }

  const uniqueOffsets = new Map<number, TexMathHitMapFuzzOffset>();
  for (const entry of offsets) {
    if (entry.offset > 0 && entry.offset < source.length) {
      uniqueOffsets.set(entry.offset, entry);
    }
  }

  return {
    id: `tex-math-hitmap-fuzz-${index}`,
    source,
    width: pickFuzzItem([55, 70, 90, 120], random),
    offsets: [...uniqueOffsets.values()].sort((left, right) => left.offset - right.offset),
  };
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

  it("maps editor caret hits inside inline font command arguments to argument source offsets", async () => {
    const sourceText = String.raw`Hi this is a \textsf{test}.`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:styled-hit-test",
      width: 120,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(true);
    const report = result.report;
    expect(report).toBeTruthy();
    const segment = report?.lines
      .flatMap((line) => line.segments)
      .find((entry) => entry.kind === "text" && entry.text === "test");
    expect(segment?.sourceStartRaw).toBe(sourceText.indexOf("test"));
    expect(segment?.sourceEndRaw).toBe(sourceText.indexOf("test") + "test".length);

    const caretStops = segment?.caretStops ?? [];
    const betweenEAndS = caretStops[2];
    expect(Number.isFinite(betweenEAndS)).toBe(true);

    const outputJax = { linebreaks: { getReports: () => report ? [report] : [] } };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 120, bottom: 10 }, report?.width ?? 120),
      ],
    };

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:styled-hit-test",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(betweenEAndS ?? 0), px(2)),
    });

    expect(caret).toMatchObject({
      ok: true,
      offset: sourceText.indexOf("test") + 2,
      kind: "text",
    });
  });

  it("keeps editor hit testing usable after a TeX forced line break with styled text", async () => {
    const sourceText = String.raw`Hi this is a \textsf{test}. \\ And another.`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:styled-forced-break-hitmap",
      width: 120,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
    });
    expect(result.supported).toBe(true);
    const report = result.report;
    const vlistLayout = result.vlistLayout;
    expect(report).toBeTruthy();
    expect(vlistLayout).toBeTruthy();
    expect(report?.lines).toHaveLength(2);
    expect(report?.lines[0]?.break).toMatchObject({
      kind: "forced",
      sourceOffset: sourceText.indexOf(String.raw`\\`),
    });

    const outputJax = { linebreaks: { getReports: () => report ? [report] : [] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:styled-forced-break-hitmap",
      layout: vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: report?.width ?? 120 } },
      querySelectorAll: () => {
        throw new Error("registered vlist geometry should avoid rendered linebox queries");
      },
    };

    const anotherOffset = sourceText.indexOf("another") + 3;
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:styled-forced-break-hitmap",
      sourceText,
      containerElement,
      offset: anotherOffset,
    });
    expect(point.error?.message ?? null).toBeNull();
    expect(point).toMatchObject({
      ok: true,
      offset: anotherOffset,
      lineIndex: 1,
      kind: "text",
    });

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:styled-forced-break-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret).toMatchObject({
      ok: true,
      offset: anotherOffset,
      lineIndex: 1,
      kind: "text",
    });

    const selection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:styled-forced-break-hitmap",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("test"),
      endOffset: sourceText.indexOf("another") + "another".length,
    });
    expect(selection.ok).toBe(true);
    expect(selection.rects).toHaveLength(2);
  });

  it("fuzzes TeX-derived editor hit maps for styled text and forced breaks", async () => {
    const cases = Array.from({ length: 40 }, (_, index) => buildTexHitMapFuzzCase(index));
    for (const testCase of cases) {
      const result = layoutSimpleTexParagraph(testCase.source, {
        paragraphId: testCase.id,
        width: testCase.width,
        parindent: 0,
        hyphenator: { hyphenate: () => [] },
      });
      expect(result.supported, testCase.source).toBe(true);
      expect(result.report, testCase.source).toBeTruthy();
      expect(result.vlistLayout, testCase.source).toBeTruthy();
      expect(testCase.offsets.length, testCase.source).toBeGreaterThan(0);

      const report = result.report!;
      const outputJax = { linebreaks: { getReports: () => [report] } };
      registerTexVListLayoutsOnOutputJax(outputJax, [{
        paragraphId: testCase.id,
        layout: result.vlistLayout!,
      }]);
      const containerElement = {
        getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        viewBox: { baseVal: { width: report.width } },
        querySelectorAll: () => {
          throw new Error("registered vlist geometry should avoid rendered linebox queries");
        },
      };

      const sampledOffsets = testCase.offsets.filter((_, index) => index % 3 === 0).slice(0, 8);
      for (const offset of sampledOffsets) {
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          offset,
        });
        expect(point.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset}`).toBeNull();
        expect(point, `${testCase.id}: ${testCase.source} @ ${offset}`).toMatchObject({
          ok: true,
          offset,
          kind: "text",
        });

        const caret = await getKnuthPlassCaretFromPoint(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
        });
        expect(caret.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset}`).toBeNull();
        expect(caret, `${testCase.id}: ${testCase.source} @ ${offset}`).toMatchObject({
          ok: true,
          offset,
          kind: "text",
        });
      }

      const rangeStart = testCase.offsets[0]!;
      const rangeEnd = testCase.offsets[testCase.offsets.length - 1]!;
      if (rangeEnd > rangeStart) {
        const selection = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          startOffset: rangeStart,
          endOffset: rangeEnd,
        });
        expect(selection.error?.message ?? null, `${testCase.id}: ${testCase.source}`).toBeNull();
        expect(selection.ok, `${testCase.id}: ${testCase.source}`).toBe(true);
        expect(selection.rects.length, `${testCase.id}: ${testCase.source}`).toBeGreaterThan(0);
      }
    }
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
      textFontProfile: classicComputerModernTextFontProfile,
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
      textFontProfile: classicComputerModernTextFontProfile,
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
      textFontProfile: classicComputerModernTextFontProfile,
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

  it("positions simple discretionary hyphens with TeX font kerns", () => {
    const font = computerModernTexMetricProvider.resolveFont();
    const result = layoutSimpleTexParagraph("manual", {
      paragraphId: "tex:discretionary-hyphen-kern",
      width: 23,
      tolerance: 9999,
      hyphenator: { hyphenate: () => [3] },
      font,
    });

    expect(result.supported).toBe(true);
    expect(lineTexts(result.report)).toEqual(["man-", "ual"]);
    const firstLineSegments = result.report?.lines[0]?.segments ?? [];
    const prefixSegment = firstLineSegments.find((segment) => segment.text === "man");
    const hyphenSegment = firstLineSegments.find((segment) => segment.text === "-");
    const hyphenWidth = computerModernTexMetricProvider.shapeText("-", font).width;
    const expectedHyphenX = (prefixSegment?.x ?? 0) +
      (prefixSegment?.width ?? 0) +
      (result.report?.lines[0]?.break?.width ?? hyphenWidth) -
      hyphenWidth;
    expect(Math.abs((hyphenSegment?.x ?? 0) - expectedHyphenX)).toBeLessThan(0.005);
    expect(hyphenSegment?.x).not.toBeCloseTo(
      (prefixSegment?.x ?? 0) + (prefixSegment?.width ?? 0),
      6
    );
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
    expect(result.vlistLayout?.linePlacements[0]?.y).toBe(10);
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
      19.1,
      30.04,
      47.31,
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
      depth: 45.86,
    });
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 19.1, 30.04, 47.31]);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      lineIndices: placement.lineIndices,
      y: placement.y,
    }))).toEqual([
      { blockIndex: 0, lineIndices: [0], y: 0 },
      { blockIndex: 1, lineIndices: [1], y: 19.1 },
      { blockIndex: 2, lineIndices: [2], y: 30.04 },
      { blockIndex: 3, lineIndices: [3], y: 47.31 },
    ]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      role: item.item.kind === "vbox" ? item.item.role : undefined,
      y: item.y,
      height: item.metrics.height,
    }))).toEqual([
      { kind: "paragraph", role: undefined, y: 0, height: expect.closeTo(7.16, 2) },
      { kind: "vbox", role: { kind: "quote", depth: 1 }, y: 9.1, height: expect.closeTo(16.83, 2) },
      { kind: "glue", role: undefined, y: 37.31, height: 10 },
      { kind: "paragraph", role: undefined, y: 47.31, height: expect.closeTo(6.94, 2) },
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
    expect(relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    )?.linePlacements.map((placement) => placement.y)).toEqual([0, 19.1, 30.04, 47.31]);
    const groupedLayout = relayoutFromExistingVListLayout(
      groupSimpleTexVListScopes(
        layoutIr.vlist,
        computerModernTexMetricProvider.resolveFont()
      ),
      result.vlistLayout,
      {
        width: 150,
        lineHeight: 12,
        firstLineAscent: 8.5,
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
      linePlacementYs: [0, 19.1, 30.04, 47.31],
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 19, 26.27]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      depth: item.metrics.depth,
    }))).toEqual([
      { kind: "paragraph", y: 0, depth: expect.closeTo(19.11, 2) },
      { kind: "paragraph", y: 26.27, depth: expect.closeTo(0.22, 2) },
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12.1, 26.04]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      stretch: item.item.kind === "glue" ? item.item.stretch : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha", stretch: undefined },
      { kind: "glue", y: 9.1, height: 3, text: undefined, stretch: 1 },
      { kind: "paragraph", y: 12.1, height: undefined, text: "Beta", stretch: undefined },
      { kind: "glue", y: 19.04, height: 7, text: undefined, stretch: undefined },
      { kind: "paragraph", y: 26.04, height: undefined, text: "Gamma", stretch: undefined },
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12.1]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      width: item.item.kind === "rule" ? item.metrics.width : undefined,
      height: item.item.kind === "rule" ? item.metrics.height : undefined,
      depth: item.item.kind === "rule" ? item.metrics.depth : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, width: undefined, height: undefined, depth: undefined, text: "Alpha" },
      { kind: "rule", y: 9.1, width: 24, height: 2, depth: 1, text: undefined },
      { kind: "paragraph", y: 12.1, width: undefined, height: undefined, depth: undefined, text: "Beta" },
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 9.1]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "penalty" ? item.metrics.height : undefined,
      depth: item.item.kind === "penalty" ? item.metrics.depth : undefined,
      penalty: item.item.kind === "penalty" ? item.item.penalty : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, depth: undefined, penalty: undefined, text: "Alpha" },
      { kind: "penalty", y: 9.1, height: 0, depth: 0, penalty: -50, text: undefined },
      { kind: "paragraph", y: 9.1, height: undefined, depth: undefined, penalty: undefined, text: "Beta" },
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 5.1, 10.04]);
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      size: item.item.kind === "glue" ? item.item.size : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha", size: undefined },
      { kind: "glue", y: 9.1, height: 0, text: undefined, size: -4 },
      { kind: "paragraph", y: 5.1, height: undefined, text: "Beta", size: undefined },
      { kind: "glue", y: 12.04, height: 0, text: undefined, size: -2 },
      { kind: "paragraph", y: 10.04, height: undefined, text: "Gamma", size: undefined },
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
      depth: 7.6,
    });
    expect(result.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      height: item.item.kind === "glue" ? item.metrics.height : undefined,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
    }))).toEqual([
      { kind: "paragraph", y: 0, height: undefined, text: "Alpha" },
      { kind: "glue", y: 9.1, height: 7, text: undefined },
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 12.1]);

    const constrained = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 60,
        lineHeight: 12,
        firstLineAscent: 8.5,
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
      linePlacementYs: [0, 53.06],
      metrics: { width: 150, height: 8.5, depth: 51.5 },
      items: [
        { kind: "paragraph", y: 0, height: undefined, stretchOrder: undefined, size: undefined, text: "Alpha" },
        { kind: "glue", y: 9.1, height: 3, stretchOrder: "normal", size: 3, text: undefined },
        { kind: "glue", y: 12.1, height: 40.96, stretchOrder: "fill", size: 0, text: undefined },
        { kind: "paragraph", y: 53.06, height: undefined, stretchOrder: undefined, size: undefined, text: "Beta" },
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 15.1]);

    const stretched = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 32,
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );
    const shrunk = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 27,
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );

    expect(stretched?.linePlacements.map((placement) => placement.y)).toEqual([0, 25.06]);
    expect(stretched?.items.map((item) =>
      item.item.kind === "glue" ? item.metrics.height : null
    )).toEqual([null, 15.96, null]);
    expect(stretched?.metrics).toEqual({ width: 150, height: 8.5, depth: 23.5 });

    expect(shrunk?.linePlacements.map((placement) => placement.y)).toEqual([0, 20.06]);
    expect(shrunk?.items.map((item) =>
      item.item.kind === "glue" ? item.metrics.height : null
    )).toEqual([null, 10.96, null]);
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
    expect(result.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 9.1]);

    const center = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 50,
        verticalAlign: "center",
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );
    const bottom = relayoutFromExistingVListLayout(
      layoutIr.vlist,
      result.vlistLayout,
      {
        width: 150,
        height: 50,
        verticalAlign: "bottom",
        lineHeight: 12,
        firstLineAscent: 8.5,
      }
    );

    expect(center && {
      baseline: center.baseline,
      linePlacementYs: center.linePlacements.map((placement) => placement.y),
      metrics: center.metrics,
      itemY: center.items.map((item) => item.y),
    }).toEqual({
      baseline: { kind: "explicit", y: 25.48 },
      linePlacementYs: [16.98, 26.08],
      metrics: { width: 150, height: 25.48, depth: 24.52 },
      itemY: [16.98, 26.08],
    });
    expect(bottom && {
      baseline: bottom.baseline,
      linePlacementYs: bottom.linePlacements.map((placement) => placement.y),
      metrics: bottom.metrics,
      itemY: bottom.items.map((item) => item.y),
    }).toEqual({
      baseline: { kind: "explicit", y: 42.46 },
      linePlacementYs: [33.96, 43.06],
      metrics: { width: 150, height: 42.46, depth: 7.54 },
      itemY: [33.96, 43.06],
    });
  });

  it("positions placeholder vlist items between supported paragraphs", () => {
    const source = String.raw`Alpha \par \includegraphics[width=1cm]{plot.pdf} \par Beta`;
    const placeholderStart = source.indexOf(String.raw`\includegraphics`);
    const placeholderEnd = source.indexOf(String.raw` \par Beta`);
    const parsed = parseSimpleTexParagraphIr(source);
    const supported = layoutSimpleTexParagraph(source, {
      paragraphId: "tex:vlist-placeholder-reference",
      width: 150,
      alignment: "ragged-right",
      fallbackPolicy: "placeholder",
    });

    expect(parsed.unsupportedCommand).toBe(true);
    expect(supported.supported).toBe(true);
    const vlistLayout = supported.vlistLayout;

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
      linePlacementYs: [0, 21.1],
      metrics: { width: 150, height: 8.5, depth: 19.54 },
      items: [
        {
          kind: "paragraph",
          y: 0,
          metrics: expect.objectContaining({ height: expect.closeTo(7.16, 2) }),
          text: "Alpha",
          reason: undefined,
          sourceSpan: { start: 0, end: 5 },
        },
        {
          kind: "placeholder",
          y: 9.1,
          metrics: { width: 0, height: 8.5, depth: 3.5 },
          text: undefined,
          reason: "Unsupported TeX command in vertical mode.",
          sourceSpan: { start: placeholderStart, end: placeholderEnd },
        },
        {
          kind: "paragraph",
          y: 21.1,
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
    expect(partialResult.vlistLayout?.linePlacements.map((placement) => placement.y)).toEqual([0, 21.1]);
    expect(partialResult.vlistLayout?.items.map((item) => ({
      kind: item.item.kind,
      y: item.y,
      text: item.item.kind === "paragraph" ? item.item.paragraph.text : undefined,
      sourceSpan: item.item.sourceSpan,
    }))).toEqual([
      { kind: "paragraph", y: 0, text: "Alpha", sourceSpan: { start: 0, end: 5 } },
      {
        kind: "placeholder",
        y: 9.1,
        text: undefined,
        sourceSpan: {
          start: source.indexOf(String.raw`\includegraphics`),
          end: source.indexOf(String.raw` \par Beta`),
        },
      },
      {
        kind: "paragraph",
        y: 21.1,
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
      { kind: "glue", size: 10, text: undefined },
      { kind: "paragraph", size: undefined, text: "Alpha" },
    ]);
  });

  it("does not infer TeX vlist box geometry from rendered SVG metadata without a registered layout", () => {
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
          "data-tex-list-kind": "enumerate",
          "data-tex-list-label-depth": "9",
          "data-tex-list-left-margin-em": "99",
          "data-tex-list-item-index": "99",
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
      makeVListBoxElement(
        { left: 30, top: 24, right: 50, bottom: 34 },
        {
          "data-tex-vbox-role": "list-item",
          "data-tex-vlist-path": "0.2.0",
          "data-tex-local-x": "13",
          "data-tex-local-y": "19",
          "data-tex-local-width": "16",
          "data-tex-local-height": "5",
          "data-tex-list-kind": "enumerate",
          "data-tex-vbox-depth": "2",
          "data-tex-list-label-depth": "1",
          "data-tex-list-item-index": "1",
          "data-source-start": "20",
          "data-source-end": "30",
        }
      ),
    ];

    expect(getKnuthPlassVListBoxGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-vbox="true"]' ? boxes : [],
      } as any,
    })).toEqual([]);
    expect(getKnuthPlassVListBoxFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-vbox="true"]' ? boxes : [],
      } as any,
      clientPoint: clientPoint(px(40), px(30)),
    })).toBeNull();
    expect(getKnuthPlassVListBoxFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === '[data-tex-vbox="true"]' ? boxes : [],
      } as any,
      clientPoint: clientPoint(px(5), px(5)),
    })).toBeNull();
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
    expect(getKnuthPlassVListBoxFromPoint({
      outputJax,
      paragraphId: "tex:registered-vbox",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist box hit-testing should not query DOM metadata");
        },
      } as any,
      clientPoint: clientPoint(px(40), px(80)),
    })).toEqual(expect.objectContaining({
      role: "list-item",
      vlistPath: [0, 0, 0],
      sourceStart: 20,
      sourceEnd: 30,
    }));
    expect(getKnuthPlassVListBoxFromPoint({
      outputJax,
      paragraphId: "tex:registered-vbox",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
      } as any,
      clientPoint: clientPoint(px(4), px(4)),
    })).toBeNull();
  });

  it("reads TeX paragraph placement geometry from registered vlist layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-paragraph-placements",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [
          {
            blockIndex: 0,
            vlistPath: [0],
            sourceSpan: { start: 0, end: 5 },
            lineIndices: [0],
            x: 0,
            y: 3,
            metrics: { width: 80, height: 7, depth: 5 },
          },
          {
            blockIndex: 1,
            vlistPath: [1],
            sourceSpan: { start: 7, end: 16 },
            lineIndices: [1, 2],
            x: 6,
            y: 19,
            metrics: { width: 90, height: 8, depth: 16 },
          },
        ],
        linePlacements: [
          { lineIndex: 0, x: 0, y: 3, height: 12 },
          { lineIndex: 1, x: 6, y: 19, height: 12 },
          { lineIndex: 2, x: 6, y: 31, height: 12 },
        ],
        reports: [],
        errors: [],
        items: [],
      }),
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
        localLeft: 6,
        localRight: 96,
        localTop: 19,
        localBottom: 43,
        lineIndices: [1, 2],
        sourceStart: 7,
        sourceEnd: 16,
        clientLeft: 22,
        clientRight: 202,
        clientTop: 77,
        clientBottom: 149,
      },
    ]);
  });

  it("does not infer TeX placeholder geometry from rendered SVG metadata without a registered layout", () => {
    const placeholders = [
      makeVListBoxElement(
        { left: 120, top: 44, right: 40, bottom: 12 },
        {
          "data-tex-vlist-item": "placeholder",
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
          "data-tex-vlist-item": "placeholder",
          "data-tex-placeholder-reason": "empty",
          "data-source-start": "1",
          "data-source-end": "2",
        }
      ),
    ];

    expect(getKnuthPlassPlaceholderGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? placeholders : [],
      } as any,
    })).toEqual([]);
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

  it("does not infer generic TeX vlist item geometry from rendered SVG metadata without a registered layout", () => {
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
          "data-tex-hbox-role": "list-label",
          "data-tex-list-label-kind": "custom",
          "data-tex-list-label-placement": "margin",
          "data-tex-list-kind": "enumerate",
          "data-tex-vbox-depth": "2",
          "data-tex-list-label-depth": "1",
          "data-tex-list-item-index": "3",
          "data-tex-list-label-block-index": "8",
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
    })).toEqual([]);
    expect(getKnuthPlassVListLabelGeometry({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
    })).toEqual([]);
    expect(getKnuthPlassVListItemFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(16), px(36)),
    })).toBeNull();
    expect(getKnuthPlassVListItemFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(5), px(5)),
    })).toBeNull();
    expect(getKnuthPlassVListLabelFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(40), px(20)),
    })).toBeNull();
    expect(getKnuthPlassVListLabelFromPoint({
      containerElement: {
        querySelectorAll: (selector: string) =>
          selector === "[data-tex-vlist-item]" ? items : [],
      } as any,
      clientPoint: clientPoint(px(39), px(42)),
    })).toBeNull();
  });

  it("does not build a TeX vlist geometry snapshot from rendered SVG metadata without a registered layout", () => {
    const boxes = [
      makeVListBoxElement(
        { left: 10, top: 20, right: 80, bottom: 60 },
        {
          "data-tex-vbox-role": "list",
          "data-tex-vlist-path": "0",
          "data-tex-local-x": "4",
          "data-tex-local-y": "5",
          "data-tex-local-width": "20",
          "data-tex-local-height": "12",
          "data-tex-list-kind": "itemize",
          "data-tex-vbox-depth": "1",
          "data-tex-list-label-depth": "0",
          "data-tex-list-left-margin-em": "2.5",
        }
      ),
    ];
    const items = [
      makeVListBoxElement(
        { left: 12, top: 24, right: 32, bottom: 36 },
        {
          "data-tex-vlist-item": "hbox",
          "data-tex-vlist-path": "0.0",
          "data-tex-hbox-role": "list-label",
          "data-tex-list-label-kind": "default",
          "data-tex-list-label-placement": "margin",
          "data-tex-list-kind": "itemize",
          "data-tex-vbox-depth": "1",
          "data-tex-list-label-depth": "0",
          "data-tex-list-item-index": "0",
          "data-tex-list-label-block-index": "3",
        }
      ),
      makeVListBoxElement(
        { left: 40, top: 44, right: 120, bottom: 76 },
        {
          "data-tex-vlist-item": "placeholder",
          "data-tex-vlist-path": "0.1",
          "data-tex-placeholder-reason": "Unsupported TeX command in vertical mode.",
          "data-source-start": "11",
          "data-source-end": "48",
        }
      ),
    ];

    const snapshot = getKnuthPlassVListGeometrySnapshot({
      containerElement: {
        querySelectorAll: (selector: string) => {
          if (selector === '[data-tex-vbox="true"]') {
            return boxes;
          }
          if (selector === "[data-tex-vlist-item]") {
            return items;
          }
          return [];
        },
      } as any,
    });

    expect(snapshot.source).toBe("empty");
    expect(snapshot.boxes).toEqual([]);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.labels).toEqual([]);
    expect(snapshot.placeholders).toEqual([]);
    expect(snapshot.paragraphs).toEqual([]);
    expect(snapshot.tree).toEqual([]);
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
              role: {
                kind: "list-label",
                labelKind: "default",
                placement: "margin",
                listKind: "enumerate",
                depth: 1,
                labelDepth: 1,
                itemIndex: 2,
                blockIndex: 0,
              },
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
        hboxRole: "list-label",
        listLabelKind: "default",
        listLabelPlacement: "margin",
        listKind: "enumerate",
        listDepth: 1,
        listLabelDepth: 1,
        listItemIndex: 2,
        listLabelBlockIndex: 0,
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
        hboxRole: null,
        listLabelKind: null,
        listLabelPlacement: null,
        listKind: null,
        listDepth: null,
        listLabelDepth: null,
        listItemIndex: null,
        listLabelBlockIndex: null,
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
        hboxRole: null,
        listLabelKind: null,
        listLabelPlacement: null,
        listKind: null,
        listDepth: null,
        listLabelDepth: null,
        listItemIndex: null,
        listLabelBlockIndex: null,
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
        hboxRole: null,
        listLabelKind: null,
        listLabelPlacement: null,
        listKind: null,
        listDepth: null,
        listLabelDepth: null,
        listItemIndex: null,
        listLabelBlockIndex: null,
        clientLeft: 46,
        clientRight: 64,
        clientTop: 83,
        clientBottom: 101,
      },
    ]);
    expect(getKnuthPlassVListLabelGeometry({
      outputJax,
      paragraphId: "tex:registered-items",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist label geometry should not query DOM metadata");
        },
      } as any,
    })).toEqual([
      expect.objectContaining({
        kind: "hbox",
        hboxRole: "list-label",
        vlistPath: [0],
        listLabelKind: "default",
        listLabelPlacement: "margin",
        listKind: "enumerate",
        listDepth: 1,
        listLabelDepth: 1,
        listItemIndex: 2,
        listLabelBlockIndex: 0,
      }),
    ]);
    expect(getKnuthPlassVListItemFromPoint({
      outputJax,
      paragraphId: "tex:registered-items",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist item hit-testing should not query DOM metadata");
        },
      } as any,
      clientPoint: clientPoint(px(50), px(90)),
    })).toEqual(expect.objectContaining({
      kind: "placeholder",
      vlistPath: [1, 2],
      sourceStart: 40,
      sourceEnd: 52,
      placeholderReason: "Unsupported TeX command in vertical mode.",
    }));
  });

  it("uses vlist tree depth for registered item hit-testing when bounds tie", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-item-depth-hit",
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
              kind: "placeholder",
              sourceSpan: { start: 10, end: 90 },
              reason: "Outer fallback.",
              estimated: { width: 20, height: 8, depth: 2 },
            },
            path: [0],
            x: 4,
            y: 5,
            metrics: { width: 20, height: 8, depth: 2 },
            children: [
              {
                item: {
                  kind: "rule",
                  sourceSpan: { start: 30, end: 40 },
                  width: 20,
                  height: 8,
                  depth: 2,
                },
                path: [0, 0],
                x: 4,
                y: 5,
                metrics: { width: 20, height: 8, depth: 2 },
              },
            ],
          },
        ],
      }),
    }]);

    expect(getKnuthPlassVListItemFromPoint({
      outputJax,
      paragraphId: "tex:registered-item-depth-hit",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist item depth hit-testing should not query DOM metadata");
        },
      } as any,
      clientPoint: clientPoint(px(20), px(40)),
    })).toEqual(expect.objectContaining({
      kind: "rule",
      vlistPath: [0, 0],
      sourceStart: 30,
      sourceEnd: 40,
    }));
  });

  it("hits registered TeX vlist labels and resolves their paragraph owner", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-label-hit",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [{
          blockIndex: 2,
          vlistPath: [1],
          sourceSpan: { start: 14, end: 30 },
          lineIndices: [0],
          x: 25,
          y: 3,
          metrics: { width: 60, height: 7, depth: 3 },
        }],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "hbox",
              role: {
                kind: "list-label",
                labelKind: "default",
                placement: "margin",
                listKind: "enumerate",
                depth: 1,
                labelDepth: 1,
                itemIndex: 3,
                blockIndex: 2,
              },
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
        ],
      }),
    }]);

    const containerElement = {
      getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
      querySelectorAll: () => {
        throw new Error("registered vlist label hit-testing should not query DOM metadata");
      },
    } as any;

    expect(getKnuthPlassVListLabelFromPoint({
      outputJax,
      paragraphId: "tex:registered-label-hit",
      containerElement,
      clientPoint: clientPoint(px(20), px(34)),
    })).toEqual({
      label: expect.objectContaining({
        kind: "hbox",
        hboxRole: "list-label",
        listLabelBlockIndex: 2,
        sourceStart: null,
        sourceEnd: null,
      }),
      paragraph: expect.objectContaining({
        blockIndex: 2,
        sourceStart: 14,
        sourceEnd: 30,
      }),
    });
    expect(getKnuthPlassVListLabelFromPoint({
      outputJax,
      paragraphId: "tex:registered-label-hit",
      containerElement,
      clientPoint: clientPoint(px(44), px(34)),
    })).toBeNull();
  });

  it("builds a coherent TeX vlist geometry snapshot from registered positioned layouts", () => {
    const outputJax = {};
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:registered-snapshot",
      layout: registeredLayoutWithBoxReport({
        metrics: { width: 100, height: 20, depth: 10 },
        baseline: { kind: "explicit", y: 8 },
        paragraphPlacements: [{
          blockIndex: 2,
          vlistPath: [0, 2],
          sourceSpan: { start: 14, end: 30 },
          lineIndices: [0],
          x: 25,
          y: 3,
          metrics: { width: 60, height: 7, depth: 3 },
        }],
        linePlacements: [],
        reports: [],
        errors: [],
        items: [
          {
            item: {
              kind: "vbox",
              role: {
                kind: "list",
                listKind: "enumerate",
                depth: 1,
                labelDepth: 1,
                ownLeftMarginEm: 2,
                totalLeftMarginEm: 2,
              },
              items: [],
            },
            path: [0],
            x: 0,
            y: 0,
            metrics: { width: 30, height: 10, depth: 5 },
            children: [
              {
                item: {
                  kind: "hbox",
                  role: {
                    kind: "list-label",
                    labelKind: "default",
                    placement: "margin",
                    listKind: "enumerate",
                    depth: 1,
                    labelDepth: 1,
                    itemIndex: 2,
                    blockIndex: 2,
                  },
                  box: {
                    metrics: { width: 12, height: 3, depth: 1 },
                    renderItems: [],
                  },
                },
                path: [0, 0],
                x: 2,
                y: 3,
                metrics: { width: 12, height: 3, depth: 1 },
              },
              {
                item: {
                  kind: "placeholder",
                  sourceSpan: { start: 40, end: 52 },
                  reason: "Unsupported TeX command in vertical mode.",
                  estimated: { width: 9, height: 4, depth: 2 },
                },
                path: [0, 1],
                x: 18,
                y: 21,
                metrics: { width: 9, height: 4, depth: 2 },
              },
              {
                item: {
                  kind: "paragraph",
                  sourceSpan: { start: 14, end: 30 },
                  blockIndex: 2,
                  paragraph: {
                    blockIndex: 2,
                    text: "Paragraph body",
                    sourceSpan: { start: 14, end: 30 },
                    nodes: [],
                    noIndent: false,
                    quoteDepth: 0,
                  },
                },
                path: [0, 2],
                x: 25,
                y: 3,
                metrics: { width: 60, height: 7, depth: 3 },
              },
            ],
          },
        ],
      }),
    }]);

    const snapshot = getKnuthPlassVListGeometrySnapshot({
      outputJax,
      paragraphId: "tex:registered-snapshot",
      containerElement: {
        getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 3, e: 10, f: 20 }),
        querySelectorAll: () => {
          throw new Error("registered vlist snapshot should not query DOM metadata");
        },
      } as any,
    });

    expect(snapshot.source).toBe("registered");
    expect(snapshot.boxes).toEqual([
      expect.objectContaining({
        role: "list",
        vlistPath: [0],
        listKind: "enumerate",
      }),
    ]);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.labels).toEqual([
      expect.objectContaining({
        hboxRole: "list-label",
        listLabelBlockIndex: 2,
      }),
    ]);
    expect(snapshot.paragraphs).toEqual([
      expect.objectContaining({
        blockIndex: 2,
        vlistPath: [0, 2],
        sourceStart: 14,
        sourceEnd: 30,
      }),
    ]);
    expect(snapshot.placeholders).toEqual([
      expect.objectContaining({
        reason: "Unsupported TeX command in vertical mode.",
        vlistPath: [0, 1],
        sourceStart: 40,
        sourceEnd: 52,
      }),
    ]);
    expect(snapshot.tree).toEqual([
      expect.objectContaining({
        itemKind: "vbox",
        vlistPath: [0],
        box: expect.objectContaining({
          role: "list",
          listKind: "enumerate",
        }),
        item: null,
        paragraph: null,
        children: [
          expect.objectContaining({
            itemKind: "hbox",
            vlistPath: [0, 0],
            item: expect.objectContaining({
              hboxRole: "list-label",
              listLabelBlockIndex: 2,
            }),
            paragraph: null,
          }),
          expect.objectContaining({
            itemKind: "placeholder",
            vlistPath: [0, 1],
            item: expect.objectContaining({
              placeholderReason: "Unsupported TeX command in vertical mode.",
            }),
            paragraph: null,
          }),
          expect.objectContaining({
            itemKind: "paragraph",
            vlistPath: [0, 2],
            item: null,
            paragraph: expect.objectContaining({
              blockIndex: 2,
              sourceStart: 14,
              sourceEnd: 30,
            }),
          }),
        ],
      }),
    ]);
    expect(getKnuthPlassVListTreeHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(px(20), px(34)),
    })).toEqual(expect.objectContaining({
      path: [
        expect.objectContaining({ itemKind: "vbox", vlistPath: [0] }),
        expect.objectContaining({ itemKind: "hbox", vlistPath: [0, 0] }),
      ],
      box: expect.objectContaining({
        role: "list",
        vlistPath: [0],
      }),
      item: expect.objectContaining({
        hboxRole: "list-label",
        vlistPath: [0, 0],
      }),
      label: expect.objectContaining({
        hboxRole: "list-label",
        listLabelBlockIndex: 2,
      }),
      labelParagraph: expect.objectContaining({
        blockIndex: 2,
        sourceStart: 14,
        sourceEnd: 30,
      }),
    }));
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
      fontId: "lmroman10-regular",
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
        listItem: item.listItem,
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
        listItem: {
          itemIndex: 1,
          label: {
            kind: "default",
            placement: "margin",
            content: { kind: "text", text: "1." },
            rightEdge: 20,
          },
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
        listItem: {
          itemIndex: 2,
          label: {
            kind: "default",
            placement: "margin",
            content: { kind: "text", text: "2." },
            rightEdge: 20,
          },
        },
        sourceSpan: {
          start: expect.any(Number),
          end: expect.any(Number),
        },
      },
    ]);
    expect(result.vlistLayout?.boxReport.items
      .filter((item) => item.itemKind === "hbox")
      .map((item) => ({
        path: item.path,
        hboxRole: item.hboxRole,
        width: item.width,
        totalHeight: item.totalHeight,
      }))).toEqual([
      {
        path: [0, 0, 1],
        hboxRole: {
          kind: "list-label",
          labelKind: "default",
          placement: "margin",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
          blockIndex: 0,
        },
        width: expect.any(Number),
        totalHeight: expect.any(Number),
      },
      {
        path: [0, 1, 1],
        hboxRole: {
          kind: "list-label",
          labelKind: "default",
          placement: "margin",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 2,
          blockIndex: 2,
        },
        width: expect.any(Number),
        totalHeight: expect.any(Number),
      },
    ]);
    const listBox = result.vlistLayout?.boxReport.tree.find((item) =>
      item.role?.kind === "list"
    );
    expect(listBox?.children?.map((item) => ({
      itemKind: item.itemKind,
      path: item.path,
      role: item.role?.kind,
    }))).toEqual([
      { itemKind: "vbox", path: [0, 0], role: "list-item" },
      { itemKind: "vbox", path: [0, 1], role: "list-item" },
    ]);
    expect(listBox?.children?.[0]?.children?.map((item) => ({
      itemKind: item.itemKind,
      path: item.path,
      blockIndex: item.blockIndex,
      hboxRole: item.hboxRole?.kind,
    }))).toEqual([
      { itemKind: "glue", path: [0, 0, 0], blockIndex: undefined, hboxRole: undefined },
      { itemKind: "hbox", path: [0, 0, 1], blockIndex: undefined, hboxRole: "list-label" },
      { itemKind: "paragraph", path: [0, 0, 2], blockIndex: 0, hboxRole: undefined },
      { itemKind: "glue", path: [0, 0, 3], blockIndex: undefined, hboxRole: undefined },
      { itemKind: "paragraph", path: [0, 0, 4], blockIndex: 1, hboxRole: undefined },
    ]);
    expect(result.vlistLayout?.paragraphPlacements.map((placement) => ({
      blockIndex: placement.blockIndex,
      vlistPath: placement.vlistPath,
    }))).toEqual([
      { blockIndex: 0, vlistPath: [0, 0, 2] },
      { blockIndex: 1, vlistPath: [0, 0, 4] },
      { blockIndex: 2, vlistPath: [0, 1, 2] },
    ]);
  });

  it("renders custom item labels and nested list margins", () => {
    const source = String.raw`\begin{enumerate}\item[Step] Alpha \begin{enumerate}\item Nested\end{enumerate}\end{enumerate}`;
    const result = layoutSimpleTexParagraph(
      source,
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
      fontId: "lmroman10-regular",
    });
    expect(result.report?.lines[1]?.segments[0]).toMatchObject({
      kind: "text",
      text: "(a)",
      fontId: "lmroman10-regular",
    });
    expect(result.vlistLayout?.boxReport.items
      .filter((item) => item.itemKind === "hbox")
      .map((item) => ({
        path: item.path,
        hboxRole: item.hboxRole,
        sourceSpan: item.sourceSpan,
      }))).toEqual([
      {
        path: [0, 0, 1],
        hboxRole: {
          kind: "list-label",
          labelKind: "custom",
          placement: "margin",
          listKind: "enumerate",
          depth: 1,
          labelDepth: 1,
          itemIndex: 1,
          blockIndex: 0,
        },
        sourceSpan: {
          start: source.indexOf("Step"),
          end: source.indexOf("Step") + "Step".length,
        },
      },
      {
        path: [1, 0, 1],
        hboxRole: {
          kind: "list-label",
          labelKind: "default",
          placement: "margin",
          listKind: "enumerate",
          depth: 2,
          labelDepth: 2,
          itemIndex: 1,
          blockIndex: 1,
        },
        sourceSpan: undefined,
      },
    ]);
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
      role: "list-label",
      text: "Term",
      fontId: "lmroman10-bold",
      x: expect.closeTo(5, 6),
    });
    expect(result.report?.lines[0]?.segments[1]).toMatchObject({
      kind: "text",
      text: "Alpha",
      fontId: "lmroman10-regular",
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
        { text: "–", fontId: "lmroman10-bold", glyphCode: 0x2013 },
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
      17.16,
      30.26,
      45.2,
      60.14,
      77.19,
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
        { text: "A", fontId: "lmroman10-regular" },
        { text: "B", fontId: "lmroman10-italic" },
        { text: "C", fontId: "lmroman10-regular" },
        { text: "D", fontId: "lmroman10-bolditalic" },
        { text: "E", fontId: "lmroman10-bold" },
        { text: "F", fontId: "lmroman10-regular" },
        { text: "G", fontId: "lmsans10-regular" },
        { text: "H", fontId: "lmsans10-bold" },
        { text: "I", fontId: "lmsans10-boldoblique" },
        { text: "J", fontId: "lmromancaps10-regular" },
        { text: "K", fontId: "lmromancaps10-regular" },
        { text: "L", fontId: "lmromancaps10-regular" },
        { text: "M", fontId: "lmromancaps10-regular" },
        { text: "N", fontId: "lmromancaps10-regular" },
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
        { text: "A", fontId: "lmroman10-regular" },
        { text: "B", fontId: "lmroman10-italic" },
        { text: "C", fontId: "lmroman10-bold" },
        { text: "D", fontId: "lmroman10-italic" },
        { text: "E", fontId: "lmroman10-italic" },
        { text: "F", fontId: "lmroman10-bolditalic" },
        { text: "G", fontId: "lmsans10-regular" },
        { text: "H", fontId: "lmroman10-bold" },
        { text: "I", fontId: "lmsans10-bold" },
        { text: "J", fontId: "lmromancaps10-regular" },
        { text: "K", fontId: "lmromancaps10-regular" },
        { text: "L", fontId: "lmromancaps10-regular" },
        { text: "M", fontId: "lmromancaps10-regular" },
        { text: "N", fontId: "lmroman10-italic" },
        { text: "O", fontId: "lmroman10-regular" },
        { text: "P", fontId: "lmroman10-italic" },
        { text: "Q", fontId: "lmroman10-regular" },
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
    expect(centered.report?.lines[0]?.xStart).toBeCloseTo(34.9285, 5);
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
      textFontProfile: classicComputerModernTextFontProfile,
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

  it("lays out inline math as an atomic TeX run when a math box provider is available", () => {
    const sourceText = String.raw`Alpha $x^2$ beta \(y+1\).`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: makeFakeInlineMathBoxProvider((content) => content === "x^2" ? 23 : 19),
    });

    expect(result.supported).toBe(true);
    expect(result.report?.runs.map((run) => run.kind)).toEqual([
      "text",
      "space",
      "math",
      "space",
      "text",
      "space",
      "math",
      "text",
    ]);
    const mathSegments = result.report?.lines.flatMap((line) => line.segments)
      .filter((segment) => segment.kind === "math") ?? [];
    expect(mathSegments).toHaveLength(2);
    expect(mathSegments[0]).toMatchObject({
      text: "x^2",
      sourceStartRaw: sourceText.indexOf("$x^2$"),
      sourceEndRaw: sourceText.indexOf("$x^2$") + "$x^2$".length,
      sourceKind: "math",
      width: 23,
      mathSvgBody: `<g data-fake-inline-math="x^2"></g>`,
    });
    expect(mathSegments[1]).toMatchObject({
      text: "y+1",
      sourceStartRaw: sourceText.indexOf(String.raw`\(y+1\)`),
      sourceEndRaw: sourceText.indexOf(String.raw`\(y+1\)`) + String.raw`\(y+1\)`.length,
      sourceKind: "math",
      width: 19,
      mathSvgBody: `<g data-fake-inline-math="y+1"></g>`,
    });
    expect(result.report?.lines[0]?.ascent).toBeGreaterThanOrEqual(7);
    expect(result.report?.lines[0]?.descent).toBeGreaterThanOrEqual(2);
  });

  it("maps editor caret positions inside TeX-derived inline math source spans", async () => {
    const sourceText = String.raw`Alpha $xyz$ beta`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-hitmap",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: makeFakeInlineMathBoxProvider(() => 30),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    const mathSegment = report?.lines[0]?.segments.find((segment) => segment.kind === "math");
    expect(mathSegment).toBeTruthy();

    const outputJax = {
      tex2svg: makeFakeInlineMathTex2Svg(1),
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 160, bottom: 10 }, report?.width ?? 160),
      ],
    };
    const offsetInsideMath = sourceText.indexOf("xyz") + 2;
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:inline-math-hitmap",
      sourceText,
      containerElement,
      offset: offsetInsideMath,
    });
    expect(point.error?.message ?? null).toBeNull();
    expect(point).toMatchObject({
      ok: true,
      offset: offsetInsideMath,
      kind: "math",
    });
    expect(point.lineLocalX).toBeCloseTo(
      (mathSegment?.x ?? 0) + (2 / 3) * (mathSegment?.width ?? 0),
      6
    );

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:inline-math-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret.error?.message ?? null).toBeNull();
    expect(caret).toMatchObject({
      ok: true,
      offset: offsetInsideMath,
      kind: "math",
    });
  });

  it("maps supported TeX-derived inline math carets without MathJax prefix measurement", async () => {
    const sourceText = String.raw`Alpha $x-y$ beta`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-real-hitmap",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    const mathSegments = report?.lines[0]?.segments.filter((segment) => segment.kind === "math") ?? [];
    const mathContentStart = sourceText.indexOf("x-y");
    const mathContentEnd = mathContentStart + "x-y".length;
    const mathCaretStops = new Map<number, number>();
    for (const segment of mathSegments) {
      const rawStart = segment.sourceStartRaw ?? mathContentStart;
      for (const [index, stop] of (segment.caretStops ?? []).entries()) {
        const rawOffset = rawStart + index;
        if (rawOffset >= mathContentStart && rawOffset <= mathContentEnd) {
          mathCaretStops.set(rawOffset, stop);
        }
      }
    }
    for (let offset = mathContentStart; offset <= mathContentEnd; offset += 1) {
      expect(Number.isFinite(mathCaretStops.get(offset))).toBe(true);
    }

    const outputJax = {
      tex2svg: () => {
        throw new Error("MathJax prefix measurement should not be used for TeX-derived math.");
      },
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 160, bottom: 10 }, report?.width ?? 160),
      ],
    };
    const offsetBeforeMinus = sourceText.indexOf("-");
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:inline-math-real-hitmap",
      sourceText,
      containerElement,
      offset: offsetBeforeMinus,
    });
    expect(point.error?.message ?? null).toBeNull();
    expect(point).toMatchObject({
      ok: true,
      offset: offsetBeforeMinus,
      kind: "math",
      snappedToMathPrefix: false,
    });
    expect(point.lineLocalX).toBeCloseTo(mathCaretStops.get(offsetBeforeMinus) ?? 0, 6);

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:inline-math-real-hitmap",
      sourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret.error?.message ?? null).toBeNull();
    expect(caret).toMatchObject({
      ok: true,
      offset: offsetBeforeMinus,
      kind: "math",
      snappedToMathPrefix: false,
    });
  });

  it("expands selections inside non-linear TeX-derived math to whole construct bounds", async () => {
    const sourceText = String.raw`$\frac{1}{2}$ and $\sqrt{x}$`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-construct-selection",
      width: 160,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    const mathSegments = report?.lines[0]?.segments.filter((segment) => segment.kind === "math") ?? [];
    const fractionConstruct = mathSegments[0]?.mathConstructRanges?.[0];
    const radicalConstruct = mathSegments[1]?.mathConstructRanges?.[0];
    expect(fractionConstruct).toBeTruthy();
    expect(radicalConstruct).toBeTruthy();

    const outputJax = {
      tex2svg: () => {
        throw new Error("MathJax prefix measurement should not be used for TeX-derived math selections.");
      },
      linebreaks: { getReports: () => report ? [report] : [] },
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report?.width ?? 160, bottom: 10 }, report?.width ?? 160),
      ],
    };

    const numeratorSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-construct-selection",
      sourceText,
      containerElement,
      startOffset: sourceText.indexOf("1"),
      endOffset: sourceText.indexOf("1") + 1,
    });
    expect(numeratorSelection.error?.message ?? null).toBeNull();
    expect(numeratorSelection.ok).toBe(true);
    expect(numeratorSelection.rects).toHaveLength(1);
    expect(Number(numeratorSelection.rects[0]?.bounds.minX)).toBeCloseTo(fractionConstruct?.xStart ?? 0, 6);
    expect(Number(numeratorSelection.rects[0]?.bounds.maxX)).toBeCloseTo(fractionConstruct?.xEnd ?? 0, 6);

    const radicandSelection = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: "tex:inline-math-construct-selection",
      sourceText,
      containerElement,
      startOffset: sourceText.lastIndexOf("x"),
      endOffset: sourceText.lastIndexOf("x") + 1,
    });
    expect(radicandSelection.error?.message ?? null).toBeNull();
    expect(radicandSelection.ok).toBe(true);
    expect(radicandSelection.rects).toHaveLength(1);
    expect(Number(radicandSelection.rects[0]?.bounds.minX)).toBeCloseTo(radicalConstruct?.xStart ?? 0, 6);
    expect(Number(radicandSelection.rects[0]?.bounds.maxX)).toBeCloseTo(radicalConstruct?.xEnd ?? 0, 6);
  });

  it("fuzzes editor hit maps for mixed TeX-derived text and inline math", async () => {
    const cases = Array.from({ length: 32 }, (_, index) => buildTexMathHitMapFuzzCase(index));
    for (const testCase of cases) {
      const result = layoutSimpleTexParagraph(testCase.source, {
        paragraphId: testCase.id,
        width: testCase.width,
        parindent: 0,
        hyphenator: { hyphenate: () => [] },
        mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
      });
      expect(result.supported, testCase.source).toBe(true);
      expect(result.report, testCase.source).toBeTruthy();
      expect(testCase.offsets.length, testCase.source).toBeGreaterThan(0);

      const report = result.report!;
      const outputJax = {
        tex2svg: () => {
          throw new Error("MathJax prefix measurement should not be used for TeX-derived mixed hit-map fuzz.");
        },
        linebreaks: { getReports: () => [report] },
      };
      const containerElement = {
        querySelectorAll: () => report.lines.map((line, lineIndex) =>
          makeLineElement(
            {
              left: 0,
              top: lineIndex * 12,
              right: report.width,
              bottom: lineIndex * 12 + 10,
            },
            report.width
          )
        ),
      };

      const sampledOffsets = testCase.offsets.filter((_, index) => index % 2 === 0).slice(0, 10);
      for (const { offset, kind } of sampledOffsets) {
        const point = await getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          offset,
        });
        expect(point.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset}`).toBeNull();
        expect(point, `${testCase.id}: ${testCase.source} @ ${offset}`).toMatchObject({
          ok: true,
          offset,
          kind,
        });

        const caret = await getKnuthPlassCaretFromPoint(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
        });
        expect(caret.error?.message ?? null, `${testCase.id}: ${testCase.source} @ ${offset}`).toBeNull();
        expect(caret, `${testCase.id}: ${testCase.source} @ ${offset}`).toMatchObject({
          ok: true,
          offset,
          kind,
        });
      }

      const rangeStart = testCase.offsets[0]?.offset ?? 0;
      const rangeEnd = testCase.offsets.at(-1)?.offset ?? 0;
      if (rangeEnd > rangeStart) {
        const selection = await getKnuthPlassSelectionRects(outputJax, {
          paragraphId: testCase.id,
          sourceText: testCase.source,
          containerElement,
          startOffset: rangeStart,
          endOffset: rangeEnd,
        });
        expect(selection.error?.message ?? null, `${testCase.id}: ${testCase.source}`).toBeNull();
        expect(selection.ok, `${testCase.id}: ${testCase.source}`).toBe(true);
        expect(selection.rects.length, `${testCase.id}: ${testCase.source}`).toBeGreaterThan(0);
      }
    }
  });

  it("reports whole-node fallback for inline math without a math box provider", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha $x$`, {
      paragraphId: "tex:fallback",
      width: 100,
    });

    expect(result.supported).toBe(false);
    expect(result.report).toBeNull();
    expect(result.fallbackReason).toContain("inline math");
    expect(result.errors).toEqual([result.fallbackReason]);
  });

  it("reports whole-node fallback when the inline math box provider cannot measure a formula", () => {
    const result = layoutSimpleTexParagraph(String.raw`Alpha $x$`, {
      paragraphId: "tex:math-provider-fallback",
      width: 100,
      mathBoxProvider: { getInlineMathBox: () => null },
    });

    expect(result.supported).toBe(false);
    expect(result.report).toBeNull();
    expect(result.fallbackReason).toContain("Missing TeX inline math box");
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
      textFontProfile: classicComputerModernTextFontProfile,
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

  it("uses registered vlist geometry for nested quote/list text editing", async () => {
    const sourceText = String.raw`\begin{quote}\begin{itemize}\item Alpha\end{itemize}\end{quote}`;
    const hitmapSourceText = "Alpha";
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:nested-vlist-hitmap",
      width: 160,
      alignment: "ragged-right",
      hyphenator: { hyphenate: () => [] },
    });
    const report = result.report;
    const vlistLayout = result.vlistLayout;
    expect(report).not.toBeNull();
    expect(vlistLayout).not.toBeNull();
    expect(vlistLayout?.paragraphPlacements[0]).toMatchObject({
      blockIndex: 0,
      x: 47,
      y: 13,
      vlistPath: [0, 0, 0, 2],
    });
    expect(vlistLayout?.linePlacements[0]).toMatchObject({
      lineIndex: 0,
      x: 47,
      y: 13,
    });
    expect(report?.lines[0]).toMatchObject({
      lineIndex: 0,
      xStart: 47,
    });

    const outputJax = { linebreaks: { getReports: () => [report as ParagraphLayoutReport] } };
    registerTexVListLayoutsOnOutputJax(outputJax, [{
      paragraphId: "tex:nested-vlist-hitmap",
      layout: vlistLayout!,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: report?.width ?? 1 } },
      querySelectorAll: () => {
        throw new Error("registered nested vlist geometry should avoid rendered linebox queries");
      },
    };
    const alphaOffset = 2;
    const point = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: "tex:nested-vlist-hitmap",
      sourceText: hitmapSourceText,
      containerElement,
      offset: alphaOffset,
    });
    expect(point).toMatchObject({
      ok: true,
      offset: alphaOffset,
      lineIndex: 0,
      kind: "text",
    });
    expect(point.lineLocalX).toBeGreaterThan(47);
    expect(point.clientPoint?.x).toBeCloseTo(point.lineLocalX ?? 0, 6);
    expect(point.clientPoint?.y).toBeCloseTo(19, 6);

    const caret = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: "tex:nested-vlist-hitmap",
      sourceText: hitmapSourceText,
      containerElement,
      clientPoint: clientPoint(px(point.clientPoint?.x ?? 0), px(point.clientPoint?.y ?? 0)),
    });
    expect(caret).toMatchObject({
      ok: true,
      lineIndex: 0,
      offset: alphaOffset,
      kind: "text",
    });
  });
});
