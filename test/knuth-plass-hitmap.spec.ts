import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  __getKnuthPlassCaretMappingCacheSize,
  clearKnuthPlassCaretMappingCache,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import {
  getKnuthPlassReportsFromOutputJax,
  installKnuthPlassVisitor,
  setKnuthPlassOptionsOnOutputJax
} from "../packages/core/src/text/knuth-plass/install.js";
import { KnuthPlassVisitor } from "../packages/core/src/text/knuth-plass/KnuthPlassVisitor.js";
import {
  createMathPrefixCache,
  finalizePrefixWidthTable,
  findNearestPrefixIndexFromTable,
  hasDanglingMathScriptOperator,
  normalizeMathSourceForCache,
  readPrefixUnitsFromTable,
  scanTeXPrefixState,
  seedPrefixWidthTable,
  stabilizePrefixForMeasurement
} from "../packages/core/src/text/knuth-plass/editor/mathPrefix.js";
import { parseSourceSpans } from "../packages/core/src/text/knuth-plass/editor/sourceParser.js";
import { clientPoint, px } from "../packages/core/src/coords/index.js";

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

function makeTwoLineReport(): ParagraphLayoutReport {
  return {
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
  };
}

function makeSingleLineReport(): ParagraphLayoutReport {
  const report = makeTwoLineReport();
  return {
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
  };
}

function makeExplicitMultilineMathReport(): ParagraphLayoutReport {
  return {
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
  };
}

function makeSegmentedSingleLineReport(
  paragraphId: string,
  width: number,
  runs: ParagraphLayoutReport["runs"],
  segments: ParagraphLayoutReport["lines"][number]["segments"]
): ParagraphLayoutReport {
  return {
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
  };
}

function makeTex2Svg(width: number): () => { querySelector: () => { getAttribute: (name: string) => string | null } } {
  return () => ({
    querySelector: () => ({
      getAttribute: (name: string) => (name === "viewBox" ? `0 0 ${width} 1` : null)
    })
  });
}

function makeVisitor(): any {
  const visitor = Object.create(KnuthPlassVisitor.prototype);
  visitor.reportByWrapper = new WeakMap();
  visitor.paragraphIdByWrapper = new WeakMap();
  visitor.originalMtextTextByWrapper = new WeakMap();
  visitor.originalMspaceWidthByWrapper = new WeakMap();
  visitor.nextParagraphNumber = 1;
  visitor.reports = [];
  return visitor;
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

describe("knuth-plass math prefix helpers", () => {
  it("parses escaped and delimited math source spans", () => {
    const parsed = parseSourceSpans(String.raw`pre \$x \(a\) mid $b\$c$ post`);

    expect(parsed.error).toBeNull();
    expect(parsed.spans.map((span) => span.kind)).toEqual(["text", "math", "text", "math", "text"]);
    expect(parsed.spans[1]).toMatchObject({
      kind: "math",
      delimiter: "paren",
      content: "a"
    });
    expect(parsed.spans[3]).toMatchObject({
      kind: "math",
      delimiter: "dollar",
      content: String.raw`b\$c`
    });

    expect(parseSourceSpans(String.raw`\) stray`).error).toMatchObject({
      code: "unexpected-close-delimiter",
      index: 0
    });
    expect(parseSourceSpans("text $x").error).toMatchObject({
      code: "unclosed-math",
      index: 5
    });
    expect(parseSourceSpans(String.raw`text \(x`).error).toMatchObject({
      code: "unclosed-math",
      index: 5
    });
    expect(parseSourceSpans(String.raw`\\) escaped close`).spans).toEqual([
      {
        kind: "text",
        rawStart: 0,
        rawEnd: 17,
        text: String.raw`\\) escaped close`
      }
    ]);
  });

  it("stabilizes incomplete TeX prefixes for measurement", () => {
    expect(hasDanglingMathScriptOperator("   ")).toBe(false);
    expect(hasDanglingMathScriptOperator("x^   ")).toBe(true);
    expect(hasDanglingMathScriptOperator(String.raw`x\^`)).toBe(false);
    expect(hasDanglingMathScriptOperator("plain")).toBe(false);

    expect(scanTeXPrefixState(String.raw`\(\left(x`).inMath).toBe(true);
    expect(scanTeXPrefixState(String.raw`\(\left(x`).unclosedLeftCount).toBe(1);
    expect(scanTeXPrefixState(String.raw`\) stray`).mathMode).toBe("none");
    expect(scanTeXPrefixState(String.raw`\right. outside`).unclosedLeftCount).toBe(0);
    expect(scanTeXPrefixState(String.raw`$x$`).mathMode).toBe("none");
    expect(scanTeXPrefixState("\\").trailingEscape).toBe(true);
    expect(scanTeXPrefixState("{x").braceDepth).toBe(1);

    expect(stabilizePrefixForMeasurement("\\(\\left{x^")).toBe("\\(\\left{x^}\\right.\\)");
    expect(stabilizePrefixForMeasurement("$x^")).toBe("$x^{}$");
    expect(stabilizePrefixForMeasurement("$x\\")).toBe("$x\\phantom{}$");
    expect(stabilizePrefixForMeasurement("{x")).toBe("{x}");
  });

  it("normalizes prefix width tables and nearest-index lookup", () => {
    expect(seedPrefixWidthTable(3, 9)).toEqual([0, Number.NaN, Number.NaN, 9]);
    expect(finalizePrefixWidthTable([], 10)).toEqual([]);
    expect(finalizePrefixWidthTable([5, Number.NaN, -1, 20], 12)).toEqual([0, 0, 0, 12]);

    expect(readPrefixUnitsFromTable(Number.POSITIVE_INFINITY, 4, 20, [0, 5, 10, 15, 20])).toBe(0);
    expect(readPrefixUnitsFromTable(1, 0, 20, [])).toBe(0);
    expect(readPrefixUnitsFromTable(2, 4, 20, [0, 5, 10, 15, 20])).toBe(10);
    expect(readPrefixUnitsFromTable(2, 4, 20, [])).toBe(10);

    expect(findNearestPrefixIndexFromTable(8, 4, 20, [])).toBe(2);
    expect(findNearestPrefixIndexFromTable(5, 4, 20, [0, Number.NaN, 10, 15, 20])).toBe(1);
    expect(findNearestPrefixIndexFromTable(11, 4, 20, [0, 4, 12, 17, 20])).toBe(2);
    expect(findNearestPrefixIndexFromTable(0, 0, 20, [])).toBe(0);
    expect(normalizeMathSourceForCache("dollar", "  x   +   y ")).toBe("dollar:x + y");
  });

  it("builds, caches, and evicts measured math prefix tables", async () => {
    let calls = 0;
    const cache = createMathPrefixCache(1);
    const outputJax = {
      tex2svg: (tex: string) => {
        calls += 1;
        return {
          querySelector: () => ({
            getAttribute: (name: string) => (name === "viewBox" ? `0 0 ${tex.length} 1` : null)
          })
        };
      }
    };

    const first = await cache.getOrBuild(outputJax, {
      kind: "math",
      rawStart: 0,
      rawEnd: 0,
      source: "",
      delimiter: "dollar",
      content: String.raw`\alpha x`,
      contentStart: 1,
      contentEnd: 9,
    });
    const second = await cache.getOrBuild(outputJax, {
      kind: "math",
      rawStart: 0,
      rawEnd: 0,
      source: "",
      delimiter: "dollar",
      content: String.raw` \alpha x `,
      contentStart: 1,
      contentEnd: 11,
    });
    const third = await cache.getOrBuild(outputJax, {
      kind: "math",
      rawStart: 0,
      rawEnd: 0,
      source: "",
      delimiter: "paren",
      content: String.raw`\beta`,
      contentStart: 2,
      contentEnd: 7,
    });

    expect(first[0]).toBe(0);
    expect(first[first.length - 1]).toBe(1);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(calls).toBeGreaterThan(0);

    const fallback = await cache.getOrBuild({
      tex2svg: () => ({
        firstElementChild: {
          getAttribute: (name: string) => (name === "width" ? "0" : null),
          getBBox: () => ({ width: 0 })
        }
      })
    }, {
      kind: "math",
      rawStart: 0,
      rawEnd: 0,
      source: "",
      delimiter: "paren",
      content: String.raw`\bad`,
      contentStart: 2,
      contentEnd: 6,
    });
    expect(fallback).toEqual([0, 0.25, 0.5, 0.75, 1]);

    const widthFallbacks = await Promise.all([
      createMathPrefixCache().getOrBuild({
        tex2svg: () => ({ viewBox: { baseVal: { width: 3 } } })
      }, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
      }),
      createMathPrefixCache().getOrBuild({
        tex2svg: () => ({ getAttribute: (name: string) => name === "width" ? "4" : null })
      }, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
      }),
      createMathPrefixCache().getOrBuild({
        tex2svg: () => ({ getBBox: () => ({ width: 5 }) })
      }, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
      }),
      createMathPrefixCache().getOrBuild({
        tex2svg: () => null
      }, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
      }),
      createMathPrefixCache().getOrBuild({
        tex2svg: () => {
          throw new Error("render failed");
        }
      }, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
      }),
      createMathPrefixCache().getOrBuild({
        tex2svg: () => ({ getAttribute: () => null })
      }, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "",
        contentStart: 1,
        contentEnd: 1,
      })
    ]);
    expect(widthFallbacks.slice(0, 3)).toEqual([[0, 1], [0, 1], [0, 1]]);
    expect(widthFallbacks[3]).toEqual([0, 1]);
    expect(widthFallbacks[4]).toEqual([0, 1]);
    expect(widthFallbacks[5]).toEqual([0]);

    await expect(cache.getOrBuild({}, {
      kind: "math",
      rawStart: 0,
      rawEnd: 0,
      source: "",
      delimiter: "dollar",
      content: "x",
      contentStart: 1,
      contentEnd: 2,
    })).rejects.toThrow("No tex2svg");
    await expect(cache.getOrBuild(null, {
      kind: "math",
      rawStart: 0,
      rawEnd: 0,
      source: "",
      delimiter: "dollar",
      content: "x",
      contentStart: 1,
      contentEnd: 2,
    })).rejects.toThrow("No tex2svg");
  });

  it("can measure through the global MathJax adaptor runtime", async () => {
    const previousMathJax = (globalThis as { MathJax?: unknown }).MathJax;
    try {
      (globalThis as { MathJax?: unknown }).MathJax = {
        startup: {
          adaptor: {}
        },
        tex2svg: () => ({ querySelector: () => ({ getAttribute: (name: string) => name === "viewBox" ? "0 0 3 1" : null }) })
      };
      await expect(createMathPrefixCache().getOrBuild(null, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
      })).resolves.toEqual([0, 1]);

      (globalThis as { MathJax?: unknown }).MathJax = {
        startup: {
          adaptor: {
            firstChild: () => ({ kind: "svg" }),
            getAttribute: (_node: unknown, name: string) => (name === "viewBox" ? "0 0 7 1" : null)
          }
        }
      };
      const table = await createMathPrefixCache().getOrBuild({
        mathjax: {
          tex2svg: () => ({})
        }
      }, {
        kind: "math",
        rawStart: 0,
        rawEnd: 0,
        source: "",
        delimiter: "dollar",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
      });

      expect(table).toEqual([0, 1]);
    } finally {
      (globalThis as { MathJax?: unknown }).MathJax = previousMathJax;
    }
  });
});

describe("knuth-plass install helpers", () => {
  it("installs visitors, merges output options, and reads reports defensively", () => {
    const config = installKnuthPlassVisitor(
      {
        svg: {
          linebreaks: {
            existing: true
          }
        }
      },
      ["svg", "chtml"]
    );

    expect(config.svg?.linebreaks?.existing).toBe(true);
    expect(config.svg?.linebreaks?.LinebreakVisitor).toBe(KnuthPlassVisitor);
    expect(config.chtml?.linebreaks?.LinebreakVisitor).toBe(KnuthPlassVisitor);

    const outputJax = {
      knuthPlassOptions: {
        tolerance: 20
      },
      linebreaks: {
        getReports: () => [makeSingleLineReport()]
      }
    };
    setKnuthPlassOptionsOnOutputJax(outputJax, {
      tolerance: 100,
      alignment: "center"
    });
    setKnuthPlassOptionsOnOutputJax(null, { tolerance: 5 });
    setKnuthPlassOptionsOnOutputJax(outputJax, null);

    expect(outputJax.knuthPlassOptions).toMatchObject({
      tolerance: 100,
      alignment: "center"
    });
    expect(getKnuthPlassReportsFromOutputJax(outputJax)).toHaveLength(1);
    expect(getKnuthPlassReportsFromOutputJax(null)).toEqual([]);
    expect(getKnuthPlassReportsFromOutputJax({ linebreaks: { getReports: () => "nope" } })).toEqual([]);
  });

  it("merges visitor options and restores captured wrapper state defensively", () => {
    KnuthPlassVisitor.configure(null);
    KnuthPlassVisitor.configure({ alignment: "center", tolerance: 7 });
    const visitor = makeVisitor();

    expect(visitor.getLatestReport()).toBeNull();
    expect(visitor.getReportFor(null)).toBeNull();
    expect(visitor["getKnuthPlassOptions"]({
      jax: {
        knuthPlassOptions: {
          layoutMode: "fixed-lines",
          pretolerance: 3
        }
      }
    })).toMatchObject({
      alignment: "center",
      layoutMode: "fixed-lines",
      pretolerance: 3,
      tolerance: 7
    });
    expect(visitor["getKnuthPlassOptions"]({ jax: { knuthPlassOptions: "bad" } })).toMatchObject({
      alignment: "center",
      tolerance: 7
    });
    expect(visitor["getKnuthPlassOptions"]({})).toMatchObject({
      alignment: "center",
      tolerance: 7
    });
    expect(visitor["resolveKnuthPlassOptions"]({})).toMatchObject({
      alignment: "ragged-right",
      layoutMode: "wrap"
    });

    const resolved = visitor["resolveKnuthPlassOptions"]({
      alignment: "ragged-left",
      layoutMode: "wrapped-explicit",
      pretolerance: 1,
      tolerance: 2,
      linepenalty: 3,
      hyphenpenalty: 4,
      exhyphenpenalty: 5,
      adjdemerits: 6,
      doublehyphendemerits: 7,
      finalhyphendemerits: 8,
      lefthyphenmin: 1,
      righthyphenmin: 2
    });
    expect(resolved).toMatchObject({
      alignment: "ragged-left",
      layoutMode: "wrapped-explicit",
      pretolerance: 1,
      righthyphenmin: 2
    });

    const textAttrs = attributes();
    let text = "Alpha";
    let textInvalidations = 0;
    let wrapperInvalidations = 0;
    let clearCount = 0;
    const textChild = {
      node: wrapperNode("text", textAttrs),
      invalidateBBox: () => {
        textInvalidations++;
      }
    };
    textChild.node.getText = () => text;
    textChild.node.setText = (next: string) => {
      text = next;
    };
    const mtext = {
      node: wrapperNode("mtext"),
      childNodes: [
        textChild,
        { node: wrapperNode("mi") },
        { node: wrapperNode("text") }
      ],
      clearBreakPoints: () => {
        clearCount++;
      },
      invalidateBBox: () => {
        wrapperInvalidations++;
      },
      textWidth: (value: string) => value.length
    };
    visitor["captureOriginalMtextState"](null);
    visitor["captureOriginalMtextState"]({ node: wrapperNode("mi") });
    visitor["captureOriginalMtextState"](mtext);
    visitor["captureOriginalMtextState"](mtext);
    text = "Changed";

    const mspaceAttrs = attributes({ width: "2em" });
    const mspaceStyles: string[] = [];
    let mspaceInvalidations = 0;
    const mspace = {
      node: wrapperNode("mspace", mspaceAttrs),
      getBBox: () => ({ w: 0 }),
      setBreakStyle: (style: string) => {
        mspaceStyles.push(style);
      },
      invalidateBBox: () => {
        mspaceInvalidations++;
      }
    };
    visitor["captureOriginalMspaceStateFromRuns"]([
      {
        kind: "space",
        runIndex: 0,
        sourceStart: 0,
        sourceEnd: 1,
        text: " ",
        wrapper: mspace,
        breakRef: { kind: "mspace", wrapper: mspace }
      },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 1,
        sourceEnd: 2,
        text: " ",
        wrapper: {},
        breakRef: { kind: "mtext-space", wrapper: mtext, childIndex: 0, wordIndex: 0 }
      },
      {
        kind: "space",
        runIndex: 2,
        sourceStart: 2,
        sourceEnd: 3,
        text: " ",
        wrapper: { node: wrapperNode("mspace", attributes({ width: 3 })) },
        breakRef: { kind: "mspace", wrapper: { node: wrapperNode("mspace", attributes({ width: 3 })) } }
      }
    ]);
    mspaceAttrs.set("width", "9em");

    const paragraph: any = { node: wrapperNode("mrow"), childNodes: [mtext, mspace] };
    paragraph.childNodes.push(paragraph);
    visitor["restoreParagraphWrapperState"](paragraph);
    visitor["restoreMtextWrapper"]({ node: wrapperNode("mtext"), childNodes: [] });
    visitor["restoreMspaceWrapper"]({ node: wrapperNode("mspace") });
    visitor["captureOriginalMtextState"]({ node: wrapperNode("mtext") });
    visitor["restoreParagraphWrapperState"](null);
    visitor["restoreMtextWrapper"]({ node: wrapperNode("mtext") });
    visitor["restoreMspaceWrapper"]({ node: { attributes: { set: "bad" } } });

    expect(text).toBe("Alpha");
    expect(mspaceAttrs.values.get("width")).toBe("2em");
    expect(textInvalidations).toBeGreaterThan(0);
    expect(wrapperInvalidations).toBeGreaterThan(0);
    expect(clearCount).toBeGreaterThan(0);
    expect(mspaceStyles).toContain("");
    expect(mspaceInvalidations).toBeGreaterThan(0);
  });

  it("reads line metrics, paragraph ids, and reports from visitor helpers", () => {
    const visitor = makeVisitor();

    const lineWrapper = {
      lineBBox: [
        { h: 7, d: 3 },
        { h: Number.NaN, d: "bad" }
      ]
    };
    const paragraph = { childNodes: [lineWrapper] };
    expect(visitor["readLineMetrics"](paragraph, 2)).toEqual([
      { ascent: 7, descent: 3 },
      { ascent: 0, descent: 0 }
    ]);

    const generated = visitor["getParagraphId"](null);
    const wrapper = {};
    const first = visitor["getParagraphId"](wrapper);
    const second = visitor["getParagraphId"](wrapper);
    expect(generated).not.toBe(first);
    expect(second).toBe(first);

    visitor["saveReport"](
      wrapper,
      10,
      [],
      new Map(),
      [{ lineIndex: 0, startRun: 0, startTextOffset: 0, endRun: 0, endTextOffset: null, width: 0, break: null }],
      [],
      ["manual"],
      undefined,
      "degraded",
      "unit-test",
      true,
      "unknown",
      "center",
      "fixed-lines"
    );
    expect(visitor.getLatestReport()).toMatchObject({
      paragraphId: first,
      alignment: "center",
      layoutMode: "fixed-lines",
      internalMode: "degraded",
      internalDegradeReason: "unit-test",
      externalFallbackUsed: true
    });
    expect(visitor.getReportFor(wrapper)).toBe(visitor.getLatestReport());
    expect(visitor.getReportFor({})).toBeNull();
    expect(visitor["isEligibleParboxParagraph"]({})).toBe(false);
    expect(visitor["isEligibleParboxParagraph"]({ parent: { node: wrapperNode("mrow") } })).toBe(false);
    expect(visitor["isEligibleParboxParagraph"]({
      parent: {
        node: wrapperNode("mpadded", attributes({ "data-overflow": "clip", width: "8em" }))
      }
    })).toBe(false);
    expect(visitor["isEligibleParboxParagraph"]({
      parent: {
        node: wrapperNode("mpadded", attributes({ "data-overflow": "linebreak", width: " " }))
      }
    })).toBe(false);
    expect(visitor["isEligibleParboxParagraph"]({
      parent: {
        node: wrapperNode("mpadded", attributes({ "data-overflow": "linebreak", width: "8em" }))
      }
    })).toBe(true);
  });

  it("patches MathJax wrapper bbox and line placement methods", () => {
    const visitor = makeVisitor();
    let originalBBoxCalls = 0;
    class MpaddedWrapper {
      computeBBox(bbox: { w?: number }, _recompute = false): void {
        originalBBoxCalls++;
        bbox.w ??= 8;
      }
    }
    visitor["patchMpaddedWrapperComputeBBox"]({
      nodeMap: new Map([["mpadded", MpaddedWrapper]])
    });
    visitor["patchMpaddedWrapperComputeBBox"]({});
    visitor["patchMpaddedWrapperComputeBBox"]({
      nodeMap: new Map([["mpadded", MpaddedWrapper]])
    });
    visitor["patchMpaddedWrapperComputeBBox"]({
      nodeMap: new Map([["mpadded", class {}]])
    });

    const overflowAttrs = attributes({ "data-overflow": "linebreak", width: "6em" });
    const nonOverflow = new MpaddedWrapper() as any;
    nonOverflow.node = wrapperNode("mpadded", attributes({ "data-overflow": "clip" }));
    nonOverflow.computeBBox({});

    const missingChild = new MpaddedWrapper() as any;
    missingChild.node = wrapperNode("mpadded", overflowAttrs);
    missingChild.childNodes = [];
    missingChild.computeBBox({});

    const childWidths: number[] = [];
    const child = {
      breakToWidth: (width: number) => {
        childWidths.push(width);
      }
    };
    const wrongVisitor = new MpaddedWrapper() as any;
    wrongVisitor.node = wrapperNode("mpadded", overflowAttrs);
    wrongVisitor.childNodes = [child];
    wrongVisitor.jax = { linebreaks: {} };
    wrongVisitor.computeBBox({});

    const originalEligibility = visitor.isEligibleParboxParagraph.bind(visitor);
    visitor.isEligibleParboxParagraph = () => false;
    const ineligible = new MpaddedWrapper() as any;
    ineligible.node = wrapperNode("mpadded", overflowAttrs);
    ineligible.childNodes = [child];
    ineligible.jax = { linebreaks: visitor };
    ineligible.computeBBox({});

    visitor.isEligibleParboxParagraph = () => true;
    const configuredWidth = new MpaddedWrapper() as any;
    configuredWidth.node = wrapperNode("mpadded", overflowAttrs);
    configuredWidth.childNodes = [child];
    configuredWidth.containerWidth = 0;
    configuredWidth.jax = { linebreaks: visitor };
    configuredWidth.computeBBox({});

    const measuredWidth = new MpaddedWrapper() as any;
    measuredWidth.node = wrapperNode("mpadded", attributes({ "data-overflow": "linebreak" }));
    measuredWidth.childNodes = [child];
    measuredWidth.jax = { linebreaks: visitor };
    measuredWidth.setBBoxDimens = (bbox: { w?: number }) => {
      bbox.w = Number(bbox.w ?? 0) + 1;
    };
    let childPWidth: number | null = null;
    measuredWidth.setChildPWidths = (_recompute: boolean, width: number) => {
      childPWidth = width;
    };
    measuredWidth.computeBBox({}, true);

    const noWidth = new MpaddedWrapper() as any;
    noWidth.node = wrapperNode("mpadded", attributes({ "data-overflow": "linebreak" }));
    noWidth.childNodes = [child];
    noWidth.jax = { linebreaks: visitor };
    noWidth.computeBBox({ w: 0 });
    visitor.isEligibleParboxParagraph = originalEligibility;

    expect(originalBBoxCalls).toBeGreaterThanOrEqual(5);
    expect(childWidths).toContain(6);
    expect(childWidths).toContain(8);
    expect(childPWidth).toBe(8);

    let originalPlaceCalls = 0;
    class MrowWrapper {
      placeLines(_parents: unknown[]): void {
        originalPlaceCalls++;
      }
    }
    visitor["patchMrowWrapperPlaceLines"]({
      nodeMap: new Map([["mrow", MrowWrapper]])
    });
    visitor["patchMrowWrapperPlaceLines"]({});
    visitor["patchMrowWrapperPlaceLines"]({
      nodeMap: new Map([["mrow", MrowWrapper]])
    });
    visitor["patchMrowWrapperPlaceLines"]({
      nodeMap: new Map([["mrow", class {}]])
    });

    const noParagraph = new MrowWrapper() as any;
    noParagraph.parent = { node: wrapperNode("mpadded", attributes()) };
    noParagraph.placeLines([]);

    const badLines = new MrowWrapper() as any;
    badLines.parent = { node: wrapperNode("mpadded", attributes({ "data-paragraph-id": "paragraph:1" })) };
    badLines.lineBBox = null;
    badLines.placeLines([]);

    const placed: Array<{ x: number; y: number; parent: unknown }> = [];
    const placedWrapper = new MrowWrapper() as any;
    placedWrapper.parent = { node: wrapperNode("mpadded", attributes({ "data-paragraph-id": "paragraph:1" })) };
    placedWrapper.lineBBox = [
      { h: 4, d: 1, L: 2, lineLeading: 0.5 },
      { h: 3, d: Number.NaN, L: 5, lineLeading: Number.NaN }
    ];
    placedWrapper.dh = 10;
    placedWrapper.place = (x: number, y: number, parent: unknown) => {
      placed.push({ x, y, parent });
    };
    visitor["reportByWrapper"].set(placedWrapper, makeTwoLineReport());
    placedWrapper.jax = { linebreaks: visitor };
    placedWrapper.placeLines(["first", "second", "missing"]);

    const fallbackPlaced: Array<{ x: number; y: number }> = [];
    const fallbackWrapper = new MrowWrapper() as any;
    fallbackWrapper.parent = { node: wrapperNode("mpadded", attributes({ "data-paragraph-id": "paragraph:other" })) };
    fallbackWrapper.lineBBox = [{ h: 1, d: 1, L: 7 }];
    fallbackWrapper.place = (x: number, y: number) => {
      fallbackPlaced.push({ x, y });
    };
    fallbackWrapper.jax = { linebreaks: {} };
    fallbackWrapper.placeLines(["only"]);

    expect(originalPlaceCalls).toBe(2);
    expect(placed.map((entry) => entry.x)).toEqual([0, 0]);
    expect(fallbackPlaced[0]?.x).toBe(7);
  });
});

describe("knuth-plass hitmap line ranges", () => {
  it("returns invalid-params for incomplete caret mapping requests", async () => {
    const outputJax = {
      linebreaks: {
        getReports: () => []
      }
    };

    await expect(
      getKnuthPlassCaretFromPoint(outputJax, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        clientPoint: clientPoint(px(0), px(0))
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassPointFromOffset(outputJax, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        offset: 0
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassSelectionRects(outputJax, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        startOffset: 0,
        endOffset: 1
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassLineRangeFromPoint(outputJax, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        clientPoint: clientPoint(px(0), px(0))
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassPointFromOffset(outputJax, {
        paragraphId: "paragraph:1",
        sourceText: 1 as never,
        containerElement: {},
        offset: 0
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassSelectionRects(outputJax, {
        paragraphId: "paragraph:1",
        sourceText: "Hello",
        containerElement: null as never,
        startOffset: 0,
        endOffset: 1
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
  });

  it("reports missing paragraphs and geometry build failures through each exported mapper", async () => {
    const missingOutputJax = {
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

    await expect(getKnuthPlassCaretFromPoint(missingOutputJax, request)).resolves.toMatchObject({
      ok: false,
      error: { code: "paragraph-not-found" }
    });
    await expect(getKnuthPlassPointFromOffset(missingOutputJax, {
      paragraphId: "missing",
      sourceText: "Hello",
      containerElement: {},
      offset: 0
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "paragraph-not-found" }
    });
    await expect(getKnuthPlassSelectionRects(missingOutputJax, {
      paragraphId: "missing",
      sourceText: "Hello",
      containerElement: {},
      startOffset: 0,
      endOffset: 1
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "paragraph-not-found" }
    });
    await expect(getKnuthPlassLineRangeFromPoint(null, request)).resolves.toMatchObject({
      ok: false,
      error: { code: "paragraph-not-found" }
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
    const geometryFailureOutputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const badContainer = {
      querySelectorAll: () => []
    };

    await expect(getKnuthPlassCaretFromPoint(geometryFailureOutputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: badContainer,
      clientPoint: clientPoint(px(0), px(0))
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassPointFromOffset(geometryFailureOutputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: badContainer,
      offset: 0
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassSelectionRects(geometryFailureOutputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: badContainer,
      startOffset: 0,
      endOffset: 1
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassLineRangeFromPoint(geometryFailureOutputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement: true as never,
      clientPoint: clientPoint(px(0), px(0))
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "geometry-error" }
    });
    await expect(getKnuthPlassLineRangeFromPoint(geometryFailureOutputJax, {
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
    const outputJax = {
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

    const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
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

    const beforeLine = await getKnuthPlassLineRangeFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(-5), px(2))
    });
    const afterLine = await getKnuthPlassLineRangeFromPoint(outputJax, {
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
    const outputJax = {
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

    clearKnuthPlassCaretMappingCache(outputJax);
    const result = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(4.6), px(2))
    });
    const cached = await getKnuthPlassPointFromOffset(outputJax, {
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
      snappedToMathPrefix: false,
      error: null
    });
    expect(cached.ok).toBe(true);
    expect(cached.offset).toBe(17);
    expect(__getKnuthPlassCaretMappingCacheSize(outputJax)).toBe(1);

    clearKnuthPlassCaretMappingCache(outputJax);
    expect(__getKnuthPlassCaretMappingCacheSize(outputJax)).toBe(0);
  });

  it("uses the paragraph root as single-line fallback geometry", async () => {
    const report = makeSingleLineReport();
    const lineElement = makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width);
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [],
      querySelector: (selector: string) => selector === "[data-paragraph-id]" ? lineElement : null
    };

    const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
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

    const overflowFallback = await getKnuthPlassLineRangeFromPoint(outputJax, {
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
    const outputJax = {
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

    clearKnuthPlassCaretMappingCache(outputJax);
    const first = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement,
      offset: 4
    });
    containerWidth = 12;
    const second = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement,
      offset: 5
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(__getKnuthPlassCaretMappingCacheSize(outputJax)).toBe(1);

    const invalidSnapshotContainer = {
      getBoundingClientRect: () => ({ left: Number.NaN, top: 0, right: 11, bottom: 10, width: 11, height: 10 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width)
      ]
    };
    const invalidSnapshot = await getKnuthPlassPointFromOffset(outputJax, {
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
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width)
      ]
    };

    const sourceParse = await getKnuthPlassPointFromOffset(outputJax, {
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
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
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
        report: { ...baseReport, width: 0 },
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
        report: {
          ...baseReport,
          lines: [{ ...baseReport.lines[0], xStart: 5, xEnd: 4 }]
        },
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
    const missingCaretStops: ParagraphLayoutReport = {
      ...baseReport,
      lines: [
        {
          ...baseReport.lines[0],
          segments: [{ ...baseReport.lines[0].segments[0], caretStops: undefined }]
        }
      ]
    };
    const missingTextOffsets: ParagraphLayoutReport = {
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
    };
    const mismatchedSpace: ParagraphLayoutReport = {
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
    };
    const mismatchedMath: ParagraphLayoutReport = {
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
    };

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

    expect(mathMeasurement.error?.code).toBe("math-measurement-error");
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

    const outOfBoundsReport: ParagraphLayoutReport = {
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
    };
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
    const outputJax = {
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

    const collapsed = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      startOffset: 4,
      endOffset: 4
    });
    expect(collapsed).toMatchObject({ ok: true, startOffset: 4, endOffset: 4, rects: [] });

    const reversed = await getKnuthPlassSelectionRects(outputJax, {
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

    const collapsedLineReport: ParagraphLayoutReport = {
      ...makeSingleLineReport(),
      lines: [
        {
          ...makeSingleLineReport().lines[0],
          xEnd: 0
        }
      ]
    };
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

    const zeroSegmentReport: ParagraphLayoutReport = {
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
    };
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
    const hyphenReport: ParagraphLayoutReport = {
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
    };
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

  it("resolves normalized explicit multiline math caret points through the paragraph hitmap", async () => {
    const report = makeExplicitMultilineMathReport();
    const outputJax = {
      tex2svg: makeTex2Svg(1),
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

    const points = await Promise.all(
      [0, 1, 2, 3, 4].map((offset) =>
        getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: report.paragraphId,
          sourceText,
          containerElement,
          offset
        })
      )
    );

    for (const point of points) {
      expect(point.ok).toBe(true);
      expect(point.error).toBeNull();
      expect(point.clientPoint).not.toBeNull();
    }

    expect(points[0].clientPoint?.x).toBe(points[1].clientPoint?.x);
    expect(points[2].clientPoint?.x).toBe(points[3].clientPoint?.x);
    expect((points[2].clientPoint?.x ?? 0)).toBeGreaterThan(points[1].clientPoint?.x ?? 0);
    expect(points[4].lineIndex).toBe(1);
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

  it("groups adjacent math visual segments into one source span", async () => {
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
    const outputJax = {
      tex2svg: makeTex2Svg(2),
      linebreaks: {
        getReports: () => [mathReport]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 2, bottom: 10 }, mathReport.width)
      ]
    };

    const middle = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: mathReport.paragraphId,
      sourceText: "$xy$",
      containerElement,
      offset: 2
    });
    const hit = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: mathReport.paragraphId,
      sourceText: "$xy$",
      containerElement,
      clientPoint: clientPoint(px(1.6), px(2))
    });

    expect(middle).toMatchObject({
      ok: true,
      kind: "math",
      snappedToMathPrefix: true
    });
    expect(hit).toMatchObject({
      ok: true,
      kind: "math",
      snappedToMathPrefix: true
    });
  });

  it("handles nullish mapper params without throwing", async () => {
    const outputJax = {
      linebreaks: {
        getReports: () => []
      }
    };

    await expect(getKnuthPlassCaretFromPoint(outputJax, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
    await expect(getKnuthPlassPointFromOffset(outputJax, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
    await expect(getKnuthPlassSelectionRects(outputJax, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
    await expect(getKnuthPlassLineRangeFromPoint(outputJax, null)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid-params" }
    });
  });

  it("returns selection rects for normalized explicit multiline math source", async () => {
    const report = makeExplicitMultilineMathReport();
    const outputJax = {
      tex2svg: makeTex2Svg(1),
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

    const rects = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: String.raw`$x$\\variable`,
      containerElement,
      startOffset: 0,
      endOffset: 13
    });

    expect(rects.ok).toBe(true);
    expect(rects.rects).toHaveLength(2);
  });
});
