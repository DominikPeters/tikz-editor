import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  __getKnuthPlassCaretMappingCacheSize,
  clearKnuthPlassCaretMappingCache,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects,
  getKnuthPlassVListGeometrySnapshot,
  getKnuthPlassVListSourceHitFromSnapshot
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import {
  registerParagraphLayoutReports
} from "../packages/core/src/text/knuth-plass/report-registry.js";
import { parseSourceSpans } from "../packages/core/src/text/knuth-plass/editor/sourceParser.js";
import { clientPoint, px } from "../packages/core/src/coords/index.js";
import {
  createTexDerivedInlineMathBoxProvider,
  layoutSimpleTexParagraph
} from "../packages/core/src/text/tex/index.js";
import { registerTexVListLayouts, texVListBoxLayoutReport } from "../packages/core/src/text/tex/vlist/index.js";

type NumericFixture<T> = T extends number
  ? number
  : T extends readonly (infer Item)[]
    ? NumericFixture<Item>[]
    : T extends object
      ? { [Key in keyof T]: NumericFixture<T[Key]> }
      : T;

function coordinateFixture<T>(value: NumericFixture<T>): T {
  return value as unknown as T;
}

function paragraphReportFixture(
  value: Omit<
    NumericFixture<ParagraphLayoutReport<"layout">>,
    "sourceCoordinateSpace" | "sourceMappingMode"
  >
): ParagraphLayoutReport<"layout"> {
  return coordinateFixture<ParagraphLayoutReport<"layout">>({
    ...value,
    sourceCoordinateSpace: "layout",
    sourceMappingMode: "reconstructed",
  });
}

function texVListBoxReportFixture(
  items: NumericFixture<Parameters<typeof texVListBoxLayoutReport>[0]>,
  metrics: NumericFixture<Parameters<typeof texVListBoxLayoutReport>[1]>,
  baseline: NumericFixture<Parameters<typeof texVListBoxLayoutReport>[2]>
): ReturnType<typeof texVListBoxLayoutReport> {
  return texVListBoxLayoutReport(
    coordinateFixture<Parameters<typeof texVListBoxLayoutReport>[0]>(items),
    coordinateFixture<Parameters<typeof texVListBoxLayoutReport>[1]>(metrics),
    coordinateFixture<Parameters<typeof texVListBoxLayoutReport>[2]>(baseline)
  );
}

function makeLineElement(
  bounds: { left: number; top: number; right: number; bottom: number },
  viewBoxWidth: number,
  matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
): any {
  return {
    getBoundingClientRect: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top
    }),
    getScreenCTM: () => matrix,
    ownerSVGElement: {
      viewBox: {
        baseVal: {
          width: viewBoxWidth
        }
      }
    }
  };
}

function makeTwoLineReport(): ParagraphLayoutReport<"layout"> {
  return paragraphReportFixture({
    paragraphId: "paragraph:1",
    width: 17,
    alignment: "ragged-right",
    layoutMode: "wrap",
    lines: [
      {
        lineIndex: 0,
        startRun: 0,
        endRun: 0,
        width: 11,
        targetWidth: 11,
        naturalWidth: 11,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0,
        xEnd: 11,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "text",
            text: "Hello World",
            startOffset: 0,
            endOffset: 11,
            x: 0,
            width: 11,
            caretStops: Array.from({ length: 12 }, (_, index) => index)
          }
        ]
      },
      {
        lineIndex: 1,
        startRun: 0,
        endRun: 0,
        width: 6,
        targetWidth: 6,
        naturalWidth: 6,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0,
        xEnd: 6,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "text",
            text: " Again",
            startOffset: 11,
            endOffset: 17,
            x: 0,
            width: 6,
            caretStops: Array.from({ length: 7 }, (_, index) => index)
          }
        ]
      }
    ],
    runs: [
      {
        runIndex: 0,
        kind: "text",
        sourceStart: 0,
        sourceEnd: 17,
        width: 17,
        text: "Hello World Again"
      }
    ],
    errors: [],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: "feasible"
  });
}

function makeSingleLineReport(): ParagraphLayoutReport<"layout"> {
  const report = makeTwoLineReport();
  return paragraphReportFixture({
    ...report,
    width: 11,
    lines: [report.lines[0]],
    runs: [
      {
        runIndex: 0,
        kind: "text",
        sourceStart: 0,
        sourceEnd: 11,
        width: 11,
        text: "Hello World"
      }
    ]
  });
}

function makeExplicitMultilineMathReport(): ParagraphLayoutReport<"layout"> {
  return paragraphReportFixture({
    paragraphId: "paragraph:math",
    width: 3.478,
    alignment: "center",
    layoutMode: "fixed-lines",
    lines: [
      {
        lineIndex: 0,
        startRun: 0,
        endRun: 0,
        width: 0.572,
        targetWidth: 0.572,
        naturalWidth: 0.572,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 1.453,
        xEnd: 2.025,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "math",
            x: 1.453,
            width: 0.572,
            caretStops: [1.453, 2.025]
          }
        ]
      },
      {
        lineIndex: 1,
        startRun: 2,
        endRun: 2,
        width: 3.476,
        targetWidth: 3.476,
        naturalWidth: 3.476,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0.001,
        xEnd: 3.477,
        break: null,
        segments: [
          {
            runIndex: 2,
            kind: "text",
            text: "variable",
            startOffset: 0,
            endOffset: 8,
            x: 0.001,
            width: 3.476,
            caretStops: [0.001, 0.529, 1.029, 1.421, 1.699, 2.199, 2.755, 3.033, 3.477]
          }
        ]
      }
    ],
    runs: [
      {
        runIndex: 0,
        kind: "math",
        sourceStart: 0,
        sourceEnd: 3,
        width: 0.572
      },
      {
        runIndex: 1,
        kind: "space",
        sourceStart: 3,
        sourceEnd: 5,
        width: 0,
        text: " "
      },
      {
        runIndex: 2,
        kind: "text",
        sourceStart: 5,
        sourceEnd: 13,
        width: 3.476,
        text: "variable"
      }
    ],
    errors: [],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: "feasible"
  });
}

function makeSegmentedSingleLineReport(
  paragraphId: string,
  width: number,
  runs: NumericFixture<ParagraphLayoutReport["runs"]>,
  segments: NumericFixture<ParagraphLayoutReport["lines"][number]["segments"]>
): ParagraphLayoutReport<"layout"> {
  return paragraphReportFixture({
    paragraphId,
    width,
    alignment: "ragged-right",
    layoutMode: "wrap",
    lines: [
      {
        lineIndex: 0,
        startRun: runs[0]?.runIndex ?? 0,
        endRun: runs.at(-1)?.runIndex ?? 0,
        width,
        targetWidth: width,
        naturalWidth: width,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: runs.filter((run) => run.kind === "space").length,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0,
        xEnd: width,
        break: null,
        segments
      }
    ],
    runs,
    errors: [],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: "feasible"
  });
}

function attributes(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (name: string) => values.get(name),
    set: (name: string, value: unknown) => {
      values.set(name, value);
    },
    values
  };
}

function wrapperNode(kind: string, attrs = attributes()): any {
  return {
    kind,
    attributes: attrs,
    isKind: (candidate: string) => candidate === kind
  };
}

describe("knuth-plass hitmap line ranges", () => {
  it("returns invalid-params for incomplete caret mapping requests", async () => {
    const layoutContext = {
      linebreaks: {
        getReports: () => []
      }
    };

    await expect(
      getKnuthPlassCaretFromPoint(layoutContext, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        clientPoint: clientPoint(px(0), px(0))
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassPointFromOffset(layoutContext, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        offset: 0
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassSelectionRects(layoutContext, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        startOffset: 0,
        endOffset: 1
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassLineRangeFromPoint(layoutContext, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        clientPoint: clientPoint(px(0), px(0))
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassPointFromOffset(layoutContext, {
        paragraphId: "paragraph:1",
        sourceText: 1 as never,
        containerElement: {},
        offset: 0
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassSelectionRects(layoutContext, {
        paragraphId: "paragraph:1",
        sourceText: "Hello",
        containerElement: null as never,
        startOffset: 0,
        endOffset: 1
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
  });

  it("uses supplemental output jax reports for caret hit testing", async () => {
    const report = makeSingleLineReport();
    const layoutContext = {};
    registerParagraphLayoutReports(layoutContext, [report]);
    const containerElement = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        right: 11,
        bottom: 10,
        width: 11,
        height: 10
      }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      querySelectorAll: () => [makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width)]
    };

    await expect(
      getKnuthPlassCaretFromPoint(layoutContext, {
        paragraphId: report.paragraphId,
        sourceText: "Hello World",
        containerElement,
        clientPoint: clientPoint(px(4.6), px(2))
      })
    ).resolves.toMatchObject({
      ok: true,
      paragraphId: report.paragraphId,
      lineIndex: 0
    });
  });

  it("reports missing paragraphs and geometry build failures through each exported mapper", async () => {
    const missingLayoutContext = {
      linebreaks: {
        getReports: () => []
      }
    };
    const request = {
      paragraphId: "missing",
      sourceText: "Hello",
      containerElement: {},
      clientPoint: clientPoint(px(0), px(0))
    };

    await expect(getKnuthPlassCaretFromPoint(missingLayoutContext, request)).resolves.toEqual({
      ok: false,
      paragraphId: "missing",
      offset: null,
      lineIndex: null,
      kind: null,
      error: {
        code: "paragraph-not-found",
        paragraphId: "missing",
        message: "Paragraph 'missing' was not found in Knuth-Plass reports."
      }
    });
    await expect(getKnuthPlassPointFromOffset(missingLayoutContext, {
      paragraphId: "missing",
      sourceText: "Hello",
      containerElement: {},
      offset: 0
    })).resolves.toEqual({
      ok: false,
      paragraphId: "missing",
      offset: null,
      lineIndex: null,
      lineLocalX: null,
      clientPoint: null,
      rotationDeg: null,
      kind: null,
      error: {
        code: "paragraph-not-found",
        paragraphId: "missing",
        message: "Paragraph 'missing' was not found in Knuth-Plass reports."
      }
    });
    await expect(getKnuthPlassSelectionRects(missingLayoutContext, {
      paragraphId: "missing",
      sourceText: "Hello",
      containerElement: {},
      startOffset: 0,
      endOffset: 1
    })).resolves.toEqual({
      ok: false,
      paragraphId: "missing",
      startOffset: 0,
      endOffset: 0,
      rects: [],
      error: {
        code: "paragraph-not-found",
        paragraphId: "missing",
        message: "Paragraph 'missing' was not found in Knuth-Plass reports."
      }
    });
    await expect(getKnuthPlassLineRangeFromPoint(null, request)).resolves.toEqual({
      ok: false,
      paragraphId: "missing",
      lineIndex: null,
      lineStartOffset: null,
      lineEndOffset: null,
      error: {
        code: "paragraph-not-found",
        paragraphId: "missing",
        message: "Paragraph 'missing' was not found in Knuth-Plass reports."
      }
    });
    await expect(getKnuthPlassLineRangeFromPoint({
      linebreaks: {
        getReports: () => "not an array"
      }
    }, request)).resolves.toMatchObject({
      ok: false,
      error: { code: "paragraph-not-found" }
    });

    const report = makeSingleLineReport();
    const geometryFailureLayoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const badContainer = {
      querySelectorAll: () => []
    };

    await expect(getKnuthPlassCaretFromPoint(geometryFailureLayoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: badContainer,
      clientPoint: clientPoint(px(0), px(0))
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassPointFromOffset(geometryFailureLayoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: badContainer,
      offset: 0
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassSelectionRects(geometryFailureLayoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: badContainer,
      startOffset: 0,
      endOffset: 1
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassLineRangeFromPoint(geometryFailureLayoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: true as never,
      clientPoint: clientPoint(px(0), px(0))
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassLineRangeFromPoint(geometryFailureLayoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: {},
      clientPoint: clientPoint(px(0), px(0))
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });

    clearKnuthPlassCaretMappingCache();
    expect(__getKnuthPlassCaretMappingCacheSize(null)).toBe(0);
  });

  it("returns visual line offsets for a point", async () => {
    const report = makeTwoLineReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 6, bottom: 22 }, report.width)
      ]
    };

    const result = await getKnuthPlassLineRangeFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(3), px(16))
    });

    expect(result).toEqual({
      ok: true,
      paragraphId: "paragraph:1",
      lineIndex: 1,
      lineStartOffset: 11,
      lineEndOffset: 17,
      error: null
    });

    const beforeLine = await getKnuthPlassLineRangeFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(-5), px(2))
    });
    const afterLine = await getKnuthPlassLineRangeFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(20), px(16))
    });

    expect(beforeLine).toMatchObject({ ok: true, lineIndex: 0 });
    expect(afterLine.ok).toBe(true);
  });

  it("maps caret points to the nearest measured stop and reuses cached geometry", async () => {
    const report = makeTwoLineReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 11, bottom: 22, width: 11, height: 22 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 6, bottom: 22 }, report.width)
      ]
    };

    clearKnuthPlassCaretMappingCache(layoutContext);
    const result = await getKnuthPlassCaretFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(4.6), px(2))
    });
    const cached = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      offset: 999
    });

    expect(result).toMatchObject({
      ok: true,
      paragraphId: "paragraph:1",
      offset: 5,
      lineIndex: 0,
      kind: "text",
      error: null
    });
    expect(cached.ok).toBe(true);
    expect(cached.offset).toBe(17);
    expect(__getKnuthPlassCaretMappingCacheSize(layoutContext)).toBe(1);

    clearKnuthPlassCaretMappingCache(layoutContext);
    expect(__getKnuthPlassCaretMappingCacheSize(layoutContext)).toBe(0);
  });

  it("uses TeX-provided inline math stops for source carets inside delimiter spans", async () => {
    const sourceText = String.raw`node $x=y$`;
    const result = layoutSimpleTexParagraph(sourceText, {
      paragraphId: "tex:inline-math-source-caret",
      width: 100,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    const report = result.report;
    expect(result.supported).toBe(true);
    expect(report).toBeTruthy();
    if (!report) {
      throw new Error("expected TeX-derived paragraph report");
    }
    const mathSegment = report.lines[0]?.segments.find((segment) => segment.kind === "math");
    expect(mathSegment?.caretStops).toBeTruthy();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: report.width, bottom: 10 }, report.width)
      ]
    };
    const offsetBeforeY = sourceText.indexOf("y");
    const expectedEntry = mathSegment?.mathCaretEntries?.find((entry) =>
      entry.sourceOffsetRaw === offsetBeforeY &&
      entry.sourceStartRaw === offsetBeforeY
    );
    expect(expectedEntry).toBeTruthy();

    const point = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText,
      containerElement,
      offset: offsetBeforeY
    });

    expect(point).toMatchObject({
      ok: true,
      offset: offsetBeforeY,
      kind: "math",
    });
    expect(point.lineLocalX).toBeCloseTo(expectedEntry?.x ?? 0, 6);
  });

  it("uses registered TeX vlist line placements for caret geometry without linebox DOM", async () => {
    const report = makeTwoLineReport();
    const shiftedLine = report.lines[1];
    const shiftedSegment = shiftedLine?.segments[0];
    if (shiftedLine && shiftedSegment?.kind === "text") {
      shiftedLine.xStart = coordinateFixture<typeof shiftedLine.xStart>(5);
      shiftedLine.xEnd = coordinateFixture<typeof shiftedLine.xEnd>(11);
      shiftedSegment.x = coordinateFixture<typeof shiftedSegment.x>(5);
      shiftedSegment.caretStops = coordinateFixture<typeof shiftedSegment.caretStops>(
        Array.from({ length: 7 }, (_, index) => 5 + index)
      );
    }
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    type RegisteredLayout = Parameters<typeof registerTexVListLayouts>[1][number]["layout"];
    registerTexVListLayouts(layoutContext, [{
      paragraphId: report.paragraphId,
      layout: {
        metrics: coordinateFixture<RegisteredLayout["metrics"]>({ width: report.width, height: 8, depth: 16 }),
        baseline: coordinateFixture<RegisteredLayout["baseline"]>({ kind: "explicit", y: 8 }),
        items: [],
        boxReport: texVListBoxReportFixture(
          [],
          { width: report.width, height: 8, depth: 16 },
          { kind: "explicit", y: 8 }
        ),
        paragraphPlacements: coordinateFixture<RegisteredLayout["paragraphPlacements"]>([
          {
            blockIndex: 0,
            vlistPath: [0],
            sourceSpan: { start: 0, end: 17 },
            sourceHitPolicy: "caret",
            lineIndices: [0, 1],
            x: 0,
            y: 0,
            metrics: { width: report.width, height: 8, depth: 16 }
          }
        ]),
        linePlacements: coordinateFixture<RegisteredLayout["linePlacements"]>([
          { lineIndex: 0, x: 0, y: 0, height: 10 },
          { lineIndex: 1, x: 5, y: 12, height: 10 }
        ]),
        graphicsPlacements: [],
        reports: [report],
        errors: []
      }
    }]);
    const containerElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 17, bottom: 22, width: 17, height: 22 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      viewBox: { baseVal: { width: report.width } },
      querySelectorAll: () => {
        throw new Error("registered line placements should avoid rendered linebox queries");
      }
    };

    clearKnuthPlassCaretMappingCache(layoutContext);
    const point = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      offset: 12
    });
    const hit = await getKnuthPlassCaretFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(7), px(16))
    });

    expect(point).toMatchObject({
      ok: true,
      lineIndex: 1,
      lineLocalX: 6,
      clientPoint: { x: 6, y: 17 }
    });
    expect(hit).toMatchObject({
      ok: true,
      lineIndex: 1,
      offset: 13,
      kind: "text"
    });
  });

  it("maps display alignment intertext paragraph hits back to the intertext source span", () => {
    const source = String.raw`Alpha \begin{align*}a&=b\\\intertext{words}c&=d\end{align*} Beta`;
    const paragraphId = "paragraph:intertext-hit";
    const layout = layoutSimpleTexParagraph(source, {
      paragraphId,
      width: 180,
      parindent: 0,
      hyphenator: { hyphenate: () => [] },
      mathBoxProvider: createTexDerivedInlineMathBoxProvider(),
    });
    expect(layout.supported).toBe(true);
    expect(layout.vlistLayout).toBeTruthy();
    if (!layout.vlistLayout) {
      throw new Error("expected intertext vlist layout");
    }

    const layoutContext = {};
    registerTexVListLayouts(layoutContext, [{
      paragraphId,
      layout: layout.vlistLayout,
    }]);
    const containerElement = {
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };

    const intertextStart = source.indexOf("{words}") + 1;
    const intertextEnd = intertextStart + "words".length;
    const snapshot = getKnuthPlassVListGeometrySnapshot({
      layoutContext,
      paragraphId,
      containerElement: containerElement,
    });
    const intertextParagraph = snapshot.paragraphs.find((paragraph) =>
      paragraph.sourceStart === intertextStart && paragraph.sourceEnd === intertextEnd
    );
    expect(intertextParagraph).toBeTruthy();
    if (!intertextParagraph) {
      throw new Error("expected registered intertext paragraph geometry");
    }

    const hit = getKnuthPlassVListSourceHitFromSnapshot({
      snapshot,
      clientPoint: clientPoint(
        px((intertextParagraph.clientLeft + intertextParagraph.clientRight) / 2),
        px((intertextParagraph.clientTop + intertextParagraph.clientBottom) / 2)
      ),
    });

    expect(hit).toEqual({
      offset: intertextStart,
      selectionRange: {
        start: intertextStart,
        end: intertextEnd,
      },
    });
  });

  it("uses the paragraph root as single-line fallback geometry", async () => {
    const report = makeSingleLineReport();
    const lineElement = makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width);
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [],
      querySelector: (selector: string) => selector === "[data-paragraph-id]" ? lineElement : null
    };

    const result = await getKnuthPlassLineRangeFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement,
      clientPoint: clientPoint(px(5), px(2))
    });

    expect(result).toEqual({
      ok: true,
      paragraphId: "paragraph:1",
      lineIndex: 0,
      lineStartOffset: 0,
      lineEndOffset: 11,
      error: null
    });

    const overflowFallback = await getKnuthPlassLineRangeFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: {
        querySelectorAll: () => [],
        querySelector: (selector: string) => selector === "[data-overflow=\"linebreak\"]" ? lineElement : null
      },
      clientPoint: clientPoint(px(5), px(2))
    });
    expect(overflowFallback.ok).toBe(true);
  });

  it("invalidates cached maps when container geometry changes", async () => {
    const report = makeSingleLineReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    let containerWidth = 11;
    const containerElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: containerWidth, bottom: 10, width: containerWidth, height: 10 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width)
      ]
    };

    clearKnuthPlassCaretMappingCache(layoutContext);
    const first = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement,
      offset: 4
    });
    containerWidth = 12;
    const second = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement,
      offset: 5
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(__getKnuthPlassCaretMappingCacheSize(layoutContext)).toBe(1);

    const invalidSnapshotContainer = {
      getBoundingClientRect: () => ({ left: Number.NaN, top: 0, right: 11, bottom: 10, width: 11, height: 10 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width)
      ]
    };
    const invalidSnapshot = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: invalidSnapshotContainer,
      offset: 4
    });
    expect(invalidSnapshot.ok).toBe(true);
  });

  it("returns paragraph-not-found when reports do not include the paragraph", async () => {
    const result = await getKnuthPlassLineRangeFromPoint(
      {
        linebreaks: {
          getReports: () => []
        }
      },
      {
        paragraphId: "missing",
        sourceText: "Hello",
        containerElement: {},
        clientPoint: clientPoint(px(0), px(0))
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("paragraph-not-found");
  });

  it("maps source parse and alignment failures to specific errors", async () => {
    const report = makeSingleLineReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width)
      ]
    };

    const sourceParse = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "$unterminated",
      containerElement,
      offset: 0
    });
    expect(sourceParse.ok).toBe(false);
    expect(sourceParse.error?.code).toBe("source-parse-error");

    const missingRuns = await getKnuthPlassPointFromOffset(
      {
        linebreaks: {
          getReports: () => [{ ...report, runs: [] }]
        }
      },
      {
        paragraphId: report.paragraphId,
        sourceText: "Hello World",
        containerElement,
        offset: 0
      }
    );
    expect(missingRuns.ok).toBe(false);
    expect(missingRuns.error?.code).toBe("alignment-error");

    const nonArrayRuns = await getKnuthPlassPointFromOffset(
      {
        linebreaks: {
          getReports: () => [{ ...report, runs: "not-runs" }]
        }
      },
      {
        paragraphId: report.paragraphId,
        sourceText: "Hello World",
        containerElement,
        offset: 0
      }
    );
    expect(nonArrayRuns.ok).toBe(false);
    expect(nonArrayRuns.error?.code).toBe("alignment-error");
  });

  it("returns geometry-error when line geometry cannot be resolved", async () => {
    const report = makeTwoLineReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const result = await getKnuthPlassLineRangeFromPoint(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement: {
        querySelectorAll: () => []
      },
      clientPoint: clientPoint(px(0), px(0))
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("geometry-error");
  });

  it("classifies malformed rendered line geometry as geometry errors", async () => {
    const baseReport = makeSingleLineReport();
    const cases: Array<{
      name: string;
      report?: ParagraphLayoutReport;
      element: any;
    }> = [
      {
        name: "missing rect",
        element: {
          getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
          ownerSVGElement: { viewBox: { baseVal: { width: baseReport.width } } }
        }
      },
      {
        name: "missing screen transform",
        element: {
          getBoundingClientRect: () => ({ left: 0, top: 0, right: 11, bottom: 10, width: 11, height: 10 }),
          getScreenCTM: () => null,
          ownerSVGElement: { viewBox: { baseVal: { width: baseReport.width } } }
        }
      },
      {
        name: "non-invertible transform",
        element: {
          getBoundingClientRect: () => ({ left: 0, top: 0, right: 11, bottom: 10, width: 11, height: 10 }),
          getScreenCTM: () => ({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }),
          ownerSVGElement: { viewBox: { baseVal: { width: baseReport.width } } }
        }
      },
      {
        name: "missing viewBox",
        element: {
          getBoundingClientRect: () => ({ left: 0, top: 0, right: 11, bottom: 10, width: 11, height: 10 }),
          getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
          ownerSVGElement: { viewBox: { baseVal: { width: 0 } } }
        }
      },
      {
        name: "invalid report width",
        report: paragraphReportFixture({ ...baseReport, width: 0 }),
        element: {
          getBoundingClientRect: () => ({ left: 0, top: 0, right: 11, bottom: 10, width: 11, height: 10 }),
          getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
          ownerSVGElement: { viewBox: { baseVal: { width: 11 } } }
        }
      },
      {
        name: "collapsed rect",
        element: {
          getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 10, width: 0, height: 10 }),
          getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
          ownerSVGElement: { viewBox: { baseVal: { width: baseReport.width } } }
        }
      },
      {
        name: "invalid line metadata",
        report: paragraphReportFixture({
          ...baseReport,
          lines: [{ ...baseReport.lines[0], xStart: 5, xEnd: 4 }]
        }),
        element: {
          getBoundingClientRect: () => ({ left: 0, top: 0, right: 11, bottom: 10, width: 11, height: 10 }),
          getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
          ownerSVGElement: { viewBox: { baseVal: { width: baseReport.width } } }
        }
      }
    ];

    for (const testCase of cases) {
      const report = testCase.report ?? baseReport;
      const result = await getKnuthPlassPointFromOffset(
        {
          linebreaks: {
            getReports: () => [report]
          }
        },
        {
          paragraphId: report.paragraphId,
          sourceText: "Hello World",
          containerElement: {
            querySelectorAll: () => [testCase.element]
          },
          offset: 0
        }
      );

      expect(result.error?.code, testCase.name).toBe("geometry-error");
    }
  });

  it("classifies source alignment and math measurement failures", async () => {
    const baseReport = makeSingleLineReport();
    const lineElement = makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, baseReport.width);
    const containerElement = {
      querySelectorAll: () => [lineElement]
    };
    const missingCaretStops = paragraphReportFixture({
      ...baseReport,
      lines: [
        {
          ...baseReport.lines[0],
          segments: [{ ...baseReport.lines[0].segments[0], caretStops: undefined }]
        }
      ]
    });
    const missingTextOffsets = paragraphReportFixture({
      ...baseReport,
      lines: [
        {
          ...baseReport.lines[0],
          segments: [
            {
              runIndex: 0,
              kind: "text",
              text: "Hello",
              x: 0,
              width: 5
            }
          ]
        }
      ]
    });
    const mismatchedSpace = paragraphReportFixture({
      ...baseReport,
      runs: [
        { runIndex: 0, kind: "space", sourceStart: 0, sourceEnd: 1, width: 1, text: " " }
      ],
      lines: [
        {
          ...baseReport.lines[0],
          segments: [{ runIndex: 0, kind: "space", text: " ", x: 0, width: 1, caretStops: [0, 1] }]
        }
      ]
    });
    const mismatchedMath = paragraphReportFixture({
      ...baseReport,
      runs: [
        { runIndex: 0, kind: "math", sourceStart: 0, sourceEnd: 1, width: 1 }
      ],
      lines: [
        {
          ...baseReport.lines[0],
          segments: [{ runIndex: 0, kind: "math", x: 0, width: 1, caretStops: [0, 1] }]
        }
      ]
    });

    for (const report of [missingCaretStops, missingTextOffsets, mismatchedSpace, mismatchedMath]) {
      const result = await getKnuthPlassPointFromOffset(
        {
          linebreaks: {
            getReports: () => [report]
          }
        },
        {
          paragraphId: report.paragraphId,
          sourceText: "Hello World",
          containerElement,
          offset: 0
        }
      );
      expect(result.error?.code).toBe("alignment-error");
    }

    const explicitReportWithoutSegmentRanges = coordinateFixture<ParagraphLayoutReport<"layout">>({
      ...baseReport,
      sourceCoordinateSpace: "layout",
      sourceMappingMode: "explicit",
    });
    const missingExplicitRange = await getKnuthPlassPointFromOffset(
      { linebreaks: { getReports: () => [explicitReportWithoutSegmentRanges] } },
      {
        paragraphId: explicitReportWithoutSegmentRanges.paragraphId,
        sourceText: "Hello World",
        containerElement,
        offset: 0,
      }
    );
    expect(missingExplicitRange).toMatchObject({
      ok: false,
      error: {
        code: "alignment-error",
        message: expect.stringContaining("has no source range"),
      },
    });

    const mathReport = makeExplicitMultilineMathReport();
    const mathMeasurement = await getKnuthPlassPointFromOffset(
      {
        linebreaks: {
          getReports: () => [mathReport]
        }
      },
      {
        paragraphId: mathReport.paragraphId,
        sourceText: String.raw`$x$\\variable`,
        containerElement: {
          querySelectorAll: () => [
            makeLineElement({ left: 0, top: 0, right: 1, bottom: 10 }, mathReport.width),
            makeLineElement({ left: 0, top: 12, right: 3.476, bottom: 22 }, mathReport.width)
          ]
        },
        offset: 1
      }
    );

    expect(mathMeasurement.error?.code).toBe("alignment-error");
  });

  it("reports malformed hitmaps with no lines or out-of-bounds stops", async () => {
    const noLinesReport: ParagraphLayoutReport = {
      ...makeSingleLineReport(),
      lines: []
    };
    const noLinesOutput = {
      linebreaks: {
        getReports: () => [noLinesReport]
      }
    };
    const noLinesContainer = {
      querySelectorAll: () => []
    };

    await expect(getKnuthPlassCaretFromPoint(noLinesOutput, {
      paragraphId: noLinesReport.paragraphId,
      sourceText: "Hello World",
      containerElement: noLinesContainer,
      clientPoint: clientPoint(px(0), px(0))
    })).resolves.toMatchObject({ ok: false, error: { code: "alignment-error" } });
    await expect(getKnuthPlassPointFromOffset(noLinesOutput, {
      paragraphId: noLinesReport.paragraphId,
      sourceText: "Hello World",
      containerElement: noLinesContainer,
      offset: 0
    })).resolves.toMatchObject({ ok: false, error: { code: "alignment-error" } });
    await expect(getKnuthPlassSelectionRects(noLinesOutput, {
      paragraphId: noLinesReport.paragraphId,
      sourceText: "Hello World",
      containerElement: noLinesContainer,
      startOffset: 0,
      endOffset: 1
    })).resolves.toMatchObject({ ok: false, error: { code: "alignment-error" } });
    await expect(getKnuthPlassLineRangeFromPoint(noLinesOutput, {
      paragraphId: noLinesReport.paragraphId,
      sourceText: "Hello World",
      containerElement: noLinesContainer,
      clientPoint: clientPoint(px(0), px(0))
    })).resolves.toMatchObject({ ok: false, error: { code: "alignment-error" } });

    const outOfBoundsReport = paragraphReportFixture({
      ...makeSingleLineReport(),
      width: 1,
      lines: [
        {
          ...makeSingleLineReport().lines[0],
          width: 1,
          targetWidth: 1,
          naturalWidth: 1,
          xEnd: 1,
          segments: [
            {
              runIndex: 0,
              kind: "text",
              text: "A",
              startOffset: 0,
              endOffset: 1,
              x: 0,
              width: 1,
              caretStops: [0, 1]
            }
          ]
        }
      ],
      runs: [
        {
          runIndex: 0,
          kind: "text",
          sourceStart: 0,
          sourceEnd: 1,
          width: 1,
          text: "A"
        }
      ]
    });
    await expect(getKnuthPlassCaretFromPoint({
      linebreaks: {
        getReports: () => [outOfBoundsReport]
      }
    }, {
      paragraphId: outOfBoundsReport.paragraphId,
      sourceText: "",
      containerElement: {
        querySelectorAll: () => [
          makeLineElement({ left: 0, top: 0, right: 1, bottom: 10 }, outOfBoundsReport.width)
        ]
      },
      clientPoint: clientPoint(px(1), px(0))
    })).resolves.toMatchObject({ ok: false, error: { code: "alignment-error" } });
  });

  it("handles collapsed and reversed selection ranges", async () => {
    const report = makeTwoLineReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 6, bottom: 22 }, report.width)
      ]
    };

    const collapsed = await getKnuthPlassSelectionRects(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      startOffset: 4,
      endOffset: 4
    });
    expect(collapsed).toMatchObject({ ok: true, startOffset: 4, endOffset: 4, rects: [] });

    const reversed = await getKnuthPlassSelectionRects(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      startOffset: 15,
      endOffset: 3
    });
    expect(reversed.ok).toBe(true);
    expect(reversed.startOffset).toBe(3);
    expect(reversed.endOffset).toBe(15);
    expect(reversed.rects.map((rect) => rect.lineIndex)).toEqual([0, 1]);

    const collapsedLineReport = paragraphReportFixture({
      ...makeSingleLineReport(),
      lines: [
        {
          ...makeSingleLineReport().lines[0],
          xEnd: 0
        }
      ]
    });
    const collapsedLineSelection = await getKnuthPlassSelectionRects({
      linebreaks: {
        getReports: () => [collapsedLineReport]
      }
    }, {
      paragraphId: collapsedLineReport.paragraphId,
      sourceText: "Hello World",
      containerElement: {
        querySelectorAll: () => [
          makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, collapsedLineReport.width)
        ]
      },
      startOffset: 0,
      endOffset: 11
    });
    expect(collapsedLineSelection.ok).toBe(true);
    expect(collapsedLineSelection.rects[0]?.bounds.maxY).toBe(10);

    const zeroSegmentReport = paragraphReportFixture({
      ...makeSingleLineReport(),
      lines: [
        {
          ...makeSingleLineReport().lines[0],
          segments: [
            {
              ...makeSingleLineReport().lines[0].segments[0],
              caretStops: Array.from({ length: 12 }, () => 0)
            }
          ]
        }
      ]
    });
    const zeroSegmentSelection = await getKnuthPlassSelectionRects({
      linebreaks: {
        getReports: () => [zeroSegmentReport]
      }
    }, {
      paragraphId: zeroSegmentReport.paragraphId,
      sourceText: "Hello World",
      containerElement: {
        querySelectorAll: () => [
          makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, zeroSegmentReport.width)
        ]
      },
      startOffset: 0,
      endOffset: 11
    });
    expect(zeroSegmentSelection.ok).toBe(true);
    expect(zeroSegmentSelection.rects).toEqual([]);

    const visualOnlyGapReport = makeSegmentedSingleLineReport(
      "paragraph:visual-gap",
      6,
      [
        { runIndex: 0, kind: "text", sourceStart: 0, sourceEnd: 1, width: 1, text: "A" },
        { runIndex: 1, kind: "text", sourceStart: 1, sourceEnd: 5, width: 4, text: "BCDE" },
        { runIndex: 2, kind: "text", sourceStart: 5, sourceEnd: 6, width: 1, text: "F" }
      ],
      [
        { runIndex: 0, kind: "text", text: "A", startOffset: 0, endOffset: 1, x: 0, width: 1, caretStops: [0, 1] },
        { runIndex: 1, kind: "text", text: "BCDE", x: 1, width: 4, caretStops: [1, 5] },
        { runIndex: 2, kind: "text", text: "F", startOffset: 0, endOffset: 1, x: 5, width: 1, caretStops: [5, 6] }
      ]
    );
    const visualOnlyGapSelection = await getKnuthPlassSelectionRects({
      linebreaks: {
        getReports: () => [visualOnlyGapReport]
      }
    }, {
      paragraphId: visualOnlyGapReport.paragraphId,
      sourceText: "ABCDEF",
      containerElement: {
        querySelectorAll: () => [
          makeLineElement({ left: 0, top: 0, right: 6, bottom: 10 }, visualOnlyGapReport.width)
        ]
      },
      startOffset: 2,
      endOffset: 4
    });
    expect(visualOnlyGapSelection).toMatchObject({
      ok: true,
      startOffset: 2,
      endOffset: 4,
      rects: []
    });
  });

  it("prefers visible hyphen line-end stops and rotated selection geometry", async () => {
    const hyphenReport = paragraphReportFixture({
      paragraphId: "paragraph:hyphen",
      width: 11,
      alignment: "ragged-right",
      layoutMode: "wrap",
      lines: [
        {
          lineIndex: 0,
          startRun: 0,
          endRun: 0,
          width: 3,
          targetWidth: 3,
          naturalWidth: 3,
          glueSetRatio: 0,
          badness: 0,
          spaceCount: 0,
          spaceDeltaPerGap: 0,
          ascent: 8,
          descent: 2,
          xStart: 0,
          xEnd: 3,
          break: { kind: "hyphen", runIndex: 0, sourceOffset: 2, visibleHyphen: true, splitOffset: 2 },
          segments: [
            { runIndex: 0, kind: "text", text: "hy", startOffset: 0, endOffset: 2, x: 0, width: 2, caretStops: [0, 1, 2] },
            { runIndex: 0, kind: "text", text: "-", x: 2, width: 1, caretStops: [2, 3] }
          ]
        },
        {
          lineIndex: 1,
          startRun: 0,
          endRun: 0,
          width: 9,
          targetWidth: 9,
          naturalWidth: 9,
          glueSetRatio: 0,
          badness: 0,
          spaceCount: 0,
          spaceDeltaPerGap: 0,
          ascent: 8,
          descent: 2,
          xStart: 0,
          xEnd: 9,
          break: null,
          segments: [
            { runIndex: 0, kind: "text", text: "phenation", startOffset: 2, endOffset: 11, x: 0, width: 9, caretStops: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }
          ]
        }
      ],
      runs: [
        { runIndex: 0, kind: "text", sourceStart: 0, sourceEnd: 11, width: 11, text: "hyphenation" }
      ],
      errors: [],
      internalMode: "canonical",
      internalDegradeReason: null,
      externalFallbackUsed: false,
      linebreakingMode: "feasible"
    });
    const hyphenOutput = {
      linebreaks: {
        getReports: () => [hyphenReport]
      }
    };
    const hyphenContainer = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 3, bottom: 10 }, hyphenReport.width),
        makeLineElement({ left: 0, top: 12, right: 9, bottom: 22 }, hyphenReport.width)
      ]
    };

    const hyphenPoint = await getKnuthPlassPointFromOffset(hyphenOutput, {
      paragraphId: hyphenReport.paragraphId,
      sourceText: "hyphenation",
      containerElement: hyphenContainer,
      offset: 2
    });
    expect(hyphenPoint).toMatchObject({
      ok: true,
      lineIndex: 0,
      lineLocalX: 2,
      kind: "text"
    });

    const rotatedReport = makeSingleLineReport();
    const rotatedOutput = {
      linebreaks: {
        getReports: () => [rotatedReport]
      }
    };
    const rotated = await getKnuthPlassSelectionRects(rotatedOutput, {
      paragraphId: rotatedReport.paragraphId,
      sourceText: "Hello World",
      containerElement: {
        querySelectorAll: () => [
          makeLineElement(
            { left: -5, top: 0, right: 5, bottom: 11 },
            rotatedReport.width,
            { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }
          )
        ]
      },
      startOffset: 0,
      endOffset: 11
    });

    expect(rotated.ok).toBe(true);
    expect(rotated.rects[0]?.rotationDeg).toBe(90);
    expect(rotated.rects[0]?.bounds.maxX).toBeGreaterThan(rotated.rects[0]?.bounds.minX ?? 0);

    const fallbackHeight = await getKnuthPlassSelectionRects(rotatedOutput, {
      paragraphId: rotatedReport.paragraphId,
      sourceText: "Hello World",
      containerElement: {
        querySelectorAll: () => [
          makeLineElement(
            { left: 0, top: 0, right: 11, bottom: 1 },
            rotatedReport.width,
            { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
          )
        ]
      },
      startOffset: 0,
      endOffset: 11
    });
    expect(fallbackHeight.ok).toBe(true);
    expect(fallbackHeight.rects[0]?.bounds.maxY).toBe(1);

    const diagonalFallbackHeight = await getKnuthPlassSelectionRects(rotatedOutput, {
      paragraphId: rotatedReport.paragraphId,
      sourceText: "Hello World",
      containerElement: {
        querySelectorAll: () => [
          makeLineElement(
            { left: 0, top: 0, right: 20, bottom: 1 },
            rotatedReport.width,
            { a: 1, b: 1, c: -1, d: 1, e: 0, f: 0 }
          )
        ]
      },
      startOffset: 0,
      endOffset: 11
    });
    expect(diagonalFallbackHeight.ok).toBe(true);
    expect(diagonalFallbackHeight.rects[0]?.bounds.maxY).toBeGreaterThan(
      diagonalFallbackHeight.rects[0]?.bounds.minY ?? 0
    );
  });

  it("rejects explicit multiline math reports without native caret geometry", async () => {
    const report = makeExplicitMultilineMathReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 1, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 3.476, bottom: 22 }, report.width)
      ]
    };
    const sourceText = String.raw`$x$\\variable`;

    const point = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText,
      containerElement,
      offset: 1
    });

    expect(point).toMatchObject({
      ok: false,
      error: { code: "alignment-error" }
    });
  });

  it("maps literal spaces and TeX linebreak commands as space-like source ranges", async () => {
    const spaceReport = makeSegmentedSingleLineReport(
      "paragraph:spaces",
      4,
      [
        { runIndex: 0, kind: "text", sourceStart: 0, sourceEnd: 1, width: 1, text: "A" },
        { runIndex: 1, kind: "space", sourceStart: 1, sourceEnd: 3, width: 2, text: "  " },
        { runIndex: 2, kind: "text", sourceStart: 3, sourceEnd: 4, width: 1, text: "B" }
      ],
      [
        { runIndex: 0, kind: "text", text: "A", startOffset: 0, endOffset: 1, x: 0, width: 1, caretStops: [0, 1] },
        { runIndex: 1, kind: "space", text: "  ", x: 1, width: 2, caretStops: [1, 2, 3] },
        { runIndex: 2, kind: "text", text: "B", startOffset: 0, endOffset: 1, x: 3, width: 1, caretStops: [3, 4] }
      ]
    );
    const spaceOutput = {
      linebreaks: {
        getReports: () => [spaceReport]
      }
    };
    const spaceContainer = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 4, bottom: 10 }, spaceReport.width)
      ]
    };

    await expect(getKnuthPlassCaretFromPoint(spaceOutput, {
      paragraphId: spaceReport.paragraphId,
      sourceText: "A  B",
      containerElement: spaceContainer,
      clientPoint: clientPoint(px(2.4), px(3))
    })).resolves.toMatchObject({
      ok: true,
      offset: 2,
      kind: "space"
    });

    const linebreakSource = String.raw`A\\*[2pt]B`;
    const linebreakReport = makeSegmentedSingleLineReport(
      "paragraph:linebreak-space",
      3,
      [
        { runIndex: 0, kind: "text", sourceStart: 0, sourceEnd: 1, width: 1, text: "A" },
        { runIndex: 1, kind: "space", sourceStart: 1, sourceEnd: 9, width: 1, text: "" },
        { runIndex: 2, kind: "text", sourceStart: 9, sourceEnd: 10, width: 1, text: "B" }
      ],
      [
        { runIndex: 0, kind: "text", text: "A", startOffset: 0, endOffset: 1, x: 0, width: 1, caretStops: [0, 1] },
        { runIndex: 1, kind: "space", text: "", x: 1, width: 1, caretStops: [] },
        { runIndex: 2, kind: "text", text: "B", startOffset: 0, endOffset: 1, x: 2, width: 1, caretStops: [2, 3] }
      ]
    );
    const linebreakOutput = {
      linebreaks: {
        getReports: () => [linebreakReport]
      }
    };
    const linebreakContainer = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 3, bottom: 10 }, linebreakReport.width)
      ]
    };

    const linebreakPoint = await getKnuthPlassPointFromOffset(linebreakOutput, {
      paragraphId: linebreakReport.paragraphId,
      sourceText: linebreakSource,
      containerElement: linebreakContainer,
      offset: 5
    });
    expect(linebreakPoint).toMatchObject({
      ok: true,
      kind: "space"
    });

    const linebreakRects = await getKnuthPlassSelectionRects(linebreakOutput, {
      paragraphId: linebreakReport.paragraphId,
      sourceText: linebreakSource,
      containerElement: linebreakContainer,
      startOffset: 1,
      endOffset: 9
    });
    expect(linebreakRects.ok).toBe(true);
    expect(linebreakRects.rects).toHaveLength(1);
  });

  it("does not synthesize caret geometry for adjacent math segments", async () => {
    const mathReport = makeSegmentedSingleLineReport(
      "paragraph:adjacent-math",
      2,
      [
        { runIndex: 0, kind: "math", sourceStart: 0, sourceEnd: 2, width: 1 },
        { runIndex: 1, kind: "math", sourceStart: 2, sourceEnd: 4, width: 1 }
      ],
      [
        { runIndex: 0, kind: "math", x: 0, width: 1, caretStops: [0, 1] },
        { runIndex: 1, kind: "math", x: 1, width: 1, caretStops: [1, 2] }
      ]
    );
    const layoutContext = {
      linebreaks: {
        getReports: () => [mathReport]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 2, bottom: 10 }, mathReport.width)
      ]
    };

    const middle = await getKnuthPlassPointFromOffset(layoutContext, {
      paragraphId: mathReport.paragraphId,
      sourceText: "$xy$",
      containerElement,
      offset: 2
    });
    const hit = await getKnuthPlassCaretFromPoint(layoutContext, {
      paragraphId: mathReport.paragraphId,
      sourceText: "$xy$",
      containerElement,
      clientPoint: clientPoint(px(1.6), px(2))
    });

    expect(middle).toMatchObject({
      ok: false,
      error: { code: "alignment-error" }
    });
    expect(hit).toMatchObject({
      ok: false,
      error: { code: "alignment-error" }
    });
  });

  it("handles nullish mapper params without throwing", async () => {
    const layoutContext = {
      linebreaks: {
        getReports: () => []
      }
    };

    await expect(getKnuthPlassCaretFromPoint(layoutContext, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
    await expect(getKnuthPlassPointFromOffset(layoutContext, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
    await expect(getKnuthPlassSelectionRects(layoutContext, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
    await expect(getKnuthPlassLineRangeFromPoint(layoutContext, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
  });

  it("rejects selections over math without native caret geometry", async () => {
    const report = makeExplicitMultilineMathReport();
    const layoutContext = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 1, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 3.476, bottom: 22 }, report.width)
      ]
    };

    const rects = await getKnuthPlassSelectionRects(layoutContext, {
      paragraphId: report.paragraphId,
      sourceText: String.raw`$x$\\variable`,
      containerElement,
      startOffset: 0,
      endOffset: 13
    });

    expect(rects).toMatchObject({
      ok: false,
      error: { code: "alignment-error" }
    });
  });
});
