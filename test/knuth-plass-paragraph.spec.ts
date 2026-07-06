import { describe, expect, it } from "vitest";

import { applyBreaks } from "../packages/core/src/text/knuth-plass/paragraph/applyBreaks.js";
import {
  TEX_INTERWORD_SHRINK_EM,
  TEX_INTERWORD_STRETCH_EM,
  TIKZ_RAGGED_SKIP_STRETCH_EM,
  buildAlignmentProfile
} from "../packages/core/src/text/knuth-plass/alignment.js";
import { collectBreakablePenalties, collectSpaceBreakpoints } from "../packages/core/src/text/knuth-plass/paragraph/breakpoints.js";
import { breakWithDp } from "../packages/core/src/text/knuth-plass/paragraph/dp.js";
import { greedyBreakParagraph } from "../packages/core/src/text/knuth-plass/paragraph/greedy.js";
import {
  createEnglishHyphenator,
  EnglishHyphenator,
  NoopHyphenator,
  preloadEnglishHyphenator
} from "../packages/core/src/text/knuth-plass/paragraph/hyphenate.js";
import { getBreakableRunIndices, runsToItems } from "../packages/core/src/text/knuth-plass/paragraph/items.js";
import { createMeasurementService } from "../packages/core/src/text/knuth-plass/paragraph/measure.js";
import {
  buildParagraphLayoutReport,
  getOrBuildTextSegmentCaretStops
} from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import { flattenParagraph } from "../packages/core/src/text/knuth-plass/paragraph/tokenize.js";
import type { GlueItem, Item, ParagraphModel, PenaltyItem } from "../packages/core/src/text/knuth-plass/paragraph/items.js";
import type { ParagraphRun, SpaceRun, TextRun } from "../packages/core/src/text/knuth-plass/paragraph/types.js";

const wrapper = {};

function node(kind: string, extra: Record<string, unknown> = {}) {
  return {
    isKind: (candidate: string) => candidate === kind,
    kind,
    ...extra
  };
}

function textChild(text: string) {
  return {
    node: node("text", {
      getText: () => text
    })
  };
}

function mutableTextChild(initialText: string) {
  let text = initialText;
  return {
    node: node("text", {
      getText: () => text,
      setText: (next: string) => {
        text = next;
      }
    }),
    get text() {
      return text;
    }
  };
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

function mtext(...children: any[]) {
  return {
    node: node("mtext"),
    childNodes: children,
    textWidth: (text: string) => text.length
  };
}

function mspace(attrs: Record<string, string> = {}) {
  return {
    node: node("mspace", {
      attributes: {
        get: (name: string) => attrs[name] ?? null
      }
    }),
    canBreak: true
  };
}

function mutableMtextWrapper(initialText: string, options: { exposeSetBreakAt?: boolean } = {}) {
  const child = mutableTextChild(initialText);
  const attrs = attributes();
  const breaks: unknown[] = [];
  let clearCount = 0;
  let invalidations = 0;
  let indentCalls = 0;
  const wrapper: any = {
    node: node("mtext", { attributes: attrs }),
    childNodes: [child],
    clearBreakPoints: () => {
      clearCount++;
    },
    computeLineBBox: () => ({
      getIndentData: () => {
        indentCalls++;
      }
    }),
    invalidateBBox: () => {
      invalidations++;
    },
    textWidth: (text: string) => text.length
  };
  if (options.exposeSetBreakAt !== false) {
    wrapper.setBreakAt = (index: unknown) => {
      breaks.push(index);
    };
  }
  return {
    wrapper,
    child,
    attrs,
    breaks,
    get clearCount() {
      return clearCount;
    },
    get invalidations() {
      return invalidations;
    },
    get indentCalls() {
      return indentCalls;
    }
  };
}

function mutableMspaceWrapper(initialWidth = "1em", bboxWidth = 1) {
  const attrs = attributes({ width: initialWidth });
  const styles: string[] = [];
  let invalidations = 0;
  const wrapper: any = {
    node: node("mspace", { attributes: attrs }),
    getBBox: () => ({ w: bboxWidth }),
    setBreakStyle: (style: string) => {
      styles.push(style);
    },
    invalidateBBox: () => {
      invalidations++;
    }
  };
  return {
    wrapper,
    attrs,
    styles,
    get invalidations() {
      return invalidations;
    }
  };
}

function textRun(runIndex: number, text: string, sourceStart: number): TextRun {
  return {
    kind: "text",
    runIndex,
    sourceStart,
    sourceEnd: sourceStart + text.length,
    text,
    wrapper,
    childIndex: 0,
    wordIndex: runIndex
  };
}

function spaceRun(runIndex: number, sourceStart: number): SpaceRun {
  return {
    kind: "space",
    runIndex,
    sourceStart,
    sourceEnd: sourceStart + 1,
    text: " ",
    wrapper,
    breakRef: {
      kind: "mtext-space",
      wrapper,
      childIndex: 0,
      wordIndex: runIndex
    }
  };
}

function model(runs: ParagraphRun[], widths: number[], items: Item[]): ParagraphModel {
  return {
    runs,
    items,
    runWidths: new Map(runs.map((run, index) => [run.runIndex, widths[index] ?? 0])),
    errors: [],
    measurement: {
      ...createMeasurementService(),
      measurePrefix: (_word: string, n: number) => n
    }
  };
}

function spacePenalty(runIndex: number, penalty = 0): PenaltyItem {
  return {
    kind: "penalty",
    width: 0,
    penalty,
    payload: {
      runIndex,
      breakKind: "space",
      sourceOffset: runIndex + 1,
      visibleHyphen: false
    }
  };
}

function forcedPenalty(runIndex: number): PenaltyItem {
  return {
    kind: "penalty",
    width: 0,
    penalty: -10000,
    payload: {
      runIndex,
      breakKind: "forced",
      sourceOffset: runIndex + 1,
      visibleHyphen: false
    }
  };
}

function hyphenPenalty(runIndex: number, splitOffset: number, penalty = 50): PenaltyItem {
  return {
    kind: "penalty",
    width: 1,
    penalty,
    flagged: true,
    payload: {
      runIndex,
      breakKind: "hyphen",
      sourceOffset: splitOffset,
      visibleHyphen: true,
      splitOffset,
      hyphenSource: "automatic"
    }
  };
}

function glue(runIndex: number, stretch = 1, shrink = 1): GlueItem {
  return {
    kind: "glue",
    width: 0,
    stretch,
    shrink,
    payload: { runIndex, breakRef: { kind: "mtext-space", wrapper, childIndex: 0, wordIndex: runIndex } }
  };
}

describe("knuth-plass paragraph helpers", () => {
  it("skips linebreaking and reports an error for non-positive target widths", () => {
    const runs = [textRun(0, "Alpha", 0), spaceRun(1, 5), textRun(2, "Beta", 6)];
    const result = greedyBreakParagraph(model(runs, [5, 1, 4], [spacePenalty(1)]), 0);

    expect(result.errors).toEqual(["Target width was non-positive; linebreaking was skipped."]);
    expect(result.lines).toEqual([
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 2,
        endTextOffset: null,
        width: 10,
        break: null
      }
    ]);
  });

  it("breaks greedily at spaces and skips leading spaces on following lines", () => {
    const runs = [
      textRun(0, "Aaaa", 0),
      spaceRun(1, 4),
      spaceRun(2, 5),
      textRun(3, "Bbbb", 6),
      spaceRun(4, 10),
      textRun(5, "Cccc", 11)
    ];
    const result = greedyBreakParagraph(
      model(runs, [4, 1, 1, 4, 1, 4], [spacePenalty(1), spacePenalty(2), spacePenalty(4)]),
      6
    );

    expect(result.errors).toEqual([]);
    expect(result.lines.map((line) => ({
      startRun: line.startRun,
      endRun: line.endRun,
      width: line.width,
      breakRun: line.break?.runIndex ?? null
    }))).toEqual([
      { startRun: 0, endRun: 1, width: 5, breakRun: 2 },
      { startRun: 3, endRun: 3, width: 4, breakRun: 4 },
      { startRun: 5, endRun: 5, width: 4, breakRun: null }
    ]);
  });

  it("keeps over-wide unbreakable runs as forced visual lines", () => {
    const runs = [textRun(0, "LongToken", 0), textRun(1, "Next", 9)];
    const result = greedyBreakParagraph(model(runs, [12, 4], []), 5);

    expect(result.lines.map((line) => [line.startRun, line.endRun, line.width, line.break])).toEqual([
      [0, 0, 12, null],
      [1, 1, 4, null]
    ]);
  });

  it("ignores non-space and forbidden penalties during greedy breaking", () => {
    const runs = [
      textRun(0, "Wide", 0),
      spaceRun(1, 4),
      textRun(2, "Next", 5),
      spaceRun(3, 9),
      textRun(4, "Tail", 10)
    ];
    const result = greedyBreakParagraph(
      {
        ...model(runs, [4, 1, 4, 1, 4], [
          { kind: "box", width: 4, payload: { runIndex: 0, runKind: "text", text: "Wide" } },
          { ...spacePenalty(1), payload: { ...spacePenalty(1).payload, breakKind: "hyphen" } },
          spacePenalty(3, 1_000_000)
        ]),
        runWidths: new Map([[0, 4], [1, 1], [2, 4], [3, 1]])
      },
      6
    );

    expect(result.errors).toEqual([]);
    expect(result.lines.map((line) => [line.startRun, line.endRun, line.width, line.break])).toEqual([
      [0, 1, 5, null],
      [2, 4, 5, null]
    ]);
  });

  it("collects breakable penalties and breakpoint run indices", () => {
    const items: Item[] = [
      { kind: "box", width: 4, payload: { runIndex: 0, runKind: "text", text: "A" } },
      spacePenalty(1, 9999),
      spacePenalty(2, 10000),
      { ...spacePenalty(3, -50), payload: { ...spacePenalty(3, -50).payload, breakKind: "hyphen" } }
    ];

    expect(collectBreakablePenalties(items).map((item) => item.payload.runIndex)).toEqual([1, 3]);
    expect(collectSpaceBreakpoints(items)).toEqual([1, 3]);
  });

  it("breaks paragraphs with DP at spaces, forced breaks, and hyphen penalties", () => {
    const runs = [
      textRun(0, "Alpha", 0),
      spaceRun(1, 5),
      textRun(2, "Beta", 6),
      spaceRun(3, 10),
      textRun(4, "Gamma", 11)
    ];
    const result = breakWithDp(
      model(runs, [5, 1, 4, 1, 5], [spacePenalty(1), glue(1, 5, 1), forcedPenalty(3)]),
      8,
      { tolerance: 10000 }
    );

    expect(result.canProceed).toBe(true);
    expect(result.lines.map((line) => line.break?.kind ?? null)).toEqual(["space", "forced", null]);
    expect(Number.isFinite(result.lines[0]?.spaceDeltaPerGap)).toBe(true);

    const hyphenRuns = [textRun(0, "hyphenation", 0)];
    const hyphenResult = breakWithDp(
      model(hyphenRuns, [11], [
        hyphenPenalty(0, 3, 500),
        hyphenPenalty(0, 3, 10),
        hyphenPenalty(0, 6, 20)
      ]),
      5,
      { tolerance: 10000, allowInfeasible: true, doublehyphendemerits: 1, finalhyphendemerits: 1 }
    );

    expect(hyphenResult.canProceed).toBe(true);
    expect(hyphenResult.lines[0]?.break).toMatchObject({
      kind: "hyphen",
      splitOffset: 3,
      visibleHyphen: true,
      hyphenSource: "automatic"
    });
    expect(hyphenResult.totalCost).toBeGreaterThan(0);
  });

  it("handles DP overfull scoring, skips, and forced empty-line candidates", () => {
    const runs = [
      spaceRun(0, 0),
      textRun(1, "Alpha", 1),
      spaceRun(2, 6),
      spaceRun(3, 7),
      textRun(4, "Beta", 8),
      {
        kind: "math",
        runIndex: 5,
        sourceStart: 12,
        sourceEnd: 13,
        wrapper
      } as ParagraphRun,
      spaceRun(6, 13),
      textRun(7, "Gamma", 14)
    ];
    const result = breakWithDp(
      model(runs, [1, 5, 1, 1, 4, 2, 1, 5], [
        forcedPenalty(0),
        spacePenalty(2),
        spacePenalty(3),
        glue(2, Number.POSITIVE_INFINITY, 1),
        glue(3, 0, Number.POSITIVE_INFINITY),
        hyphenPenalty(1, 1, 10),
        hyphenPenalty(1, 99, 1),
        hyphenPenalty(1, 2, 50),
        hyphenPenalty(1, 2, 5)
      ]),
      3,
      {
        allowInfeasible: true,
        preventOverflow: true,
        tolerance: 1,
        leftskipWidth: 0.5,
        leftskipStretch: 1,
        rightskipStretch: 0,
        rightskipShrink: 1,
        parfillskipStretch: 0,
        adjdemerits: 7,
        doublehyphendemerits: 11,
        finalhyphendemerits: 13
      }
    );

    expect(result.canProceed).toBe(true);
    expect(result.mode).toBe("overfull");
    expect(result.lines[0]).toMatchObject({
      startRun: 0,
      endRun: 0,
      width: 1,
      break: { kind: "forced", runIndex: 0 }
    });
    expect(result.lines.some((line) => line.break?.kind === "hyphen" && line.break.splitOffset === 2)).toBe(true);
    expect(result.lines.every((line) => line.break?.kind !== "space" || line.break.runIndex !== 3)).toBe(true);
    expect(result.lines.some((line) => line.xOffset !== 0)).toBe(true);
  });

  it("reports DP early exits for invalid widths and pathological inputs", () => {
    expect(breakWithDp(model([spaceRun(0, 0)], [1], []), 5).errors[0]).toContain("no breakable content");
    expect(breakWithDp(model([textRun(0, "x", 0)], [1], []), 0).errors[0]).toContain("non-positive");

    const tooManyRuns = Array.from({ length: 3001 }, (_, index) => textRun(index, "x", index));
    expect(breakWithDp(model(tooManyRuns, tooManyRuns.map(() => 1), []), 10).errors[0]).toContain("runs exceeds limit");

    const manyBreakpoints = Array.from({ length: 1201 }, (_, index) => spacePenalty(index));
    expect(breakWithDp(model([textRun(0, "x", 0)], [1], manyBreakpoints), 10).errors[0]).toContain("breakpoints exceeds limit");

    const manyRuns = Array.from({ length: 1420 }, (_, index) =>
      index % 2 === 0 ? textRun(index, "x", index) : spaceRun(index, index)
    );
    const manyEdges = Array.from({ length: 1199 }, (_, index) => spacePenalty(index * 2 + 1));
    expect(breakWithDp(model(manyRuns, manyRuns.map(() => 1), manyEdges), 10).errors[0]).toContain("estimated");

    const impossible = breakWithDp(
      model([textRun(0, "abcdef", 0), spaceRun(1, 6), textRun(2, "ghijkl", 7)], [6, 1, 6], [spacePenalty(1)]),
      2,
      { preventOverflow: true }
    );
    expect(impossible.canProceed).toBe(false);
    expect(impossible.errors[0]).toContain("failed to find");

    const noStretch = breakWithDp(
      model(
        [textRun(0, "a", 0), spaceRun(1, 1), textRun(2, "b", 2)],
        [1, 1, 1],
        [spacePenalty(1), glue(1, 0, 0)]
      ),
      10,
      { rightskipStretch: 0, parfillskipStretch: 0 }
    );
    expect(noStretch.canProceed).toBe(false);
    expect(noStretch.errors[0]).toContain("failed to find");
  });

  it("measures and caches text, prefixes, spaces, and math wrappers", () => {
    const measurement = createMeasurementService();
    const textWrapper = {
      textWidth: (text: string) => text.length * 2
    };
    const mathWrapper = {
      getOuterBBox: () => ({ L: 1, w: 5, R: 2 })
    };
    const fallbackMathWrapper = {
      getBBox: () => ({ L: 0.5, w: 2, R: 0.5 })
    };

    expect(() => measurement.measureText("x", {})).toThrow("Missing textWidth");
    expect(measurement.measureText("abc", textWrapper)).toBe(6);
    expect(measurement.measureWord("abc", textWrapper)).toBe(6);
    expect(measurement.measurePrefix("abcdef", 3, textWrapper)).toBe(6);
    expect(measurement.measurePrefix("abcdef", -1, textWrapper)).toBe(0);
    expect(measurement.measurePrefix("abcdef", 99, textWrapper)).toBe(12);
    expect(measurement.measureMath(null)).toBe(0);
    expect(measurement.measureMath(mathWrapper)).toBe(8);
    expect(measurement.measureMath(mathWrapper)).toBe(8);
    expect(measurement.measureMath(fallbackMathWrapper)).toBe(3);
    expect(measurement.measureMath({ getOuterBBox: () => ({ L: Number.NaN, R: 2 }) })).toBe(2);

    measurement.primeRuns([
      { ...textRun(0, "Prime", 0), wrapper: textWrapper },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 5,
        sourceEnd: 6,
        text: " ",
        wrapper: textWrapper,
        breakRef: { kind: "mtext-space", wrapper: textWrapper, childIndex: 0, wordIndex: 0 }
      },
      {
        kind: "space",
        runIndex: 2,
        sourceStart: 6,
        sourceEnd: 7,
        text: " ",
        wrapper: mathWrapper,
        breakRef: { kind: "mspace", wrapper: mathWrapper }
      },
      { kind: "math", runIndex: 3, sourceStart: 7, sourceEnd: 8, wrapper: fallbackMathWrapper }
    ]);

    expect(measurement.getStats().textCacheEntries).toBeGreaterThan(0);
    expect(measurement.getStats().wordPrefixEntries).toBeGreaterThan(0);
    expect(measurement.getStats().mathCacheEntries).toBe(3);
  });

  it("applies mtext hyphen and space breaks with alignment and indent hooks", () => {
    const text = mutableMtextWrapper("Alpha Beta Gamma");
    const parentAttrs = attributes();
    const paragraphWrapper = { parent: { node: node("mrow", { attributes: parentAttrs }) } };
    const originalText = new WeakMap<object, string[]>();
    originalText.set(text.wrapper, ["Alpha Beta Gamma"]);
    const runs: ParagraphRun[] = [
      { ...textRun(0, "Alpha", 0), wrapper: text.wrapper, childIndex: 0, wordIndex: 0 },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 5,
        sourceEnd: 6,
        text: " ",
        wrapper: text.wrapper,
        breakRef: { kind: "mtext-space", wrapper: text.wrapper, childIndex: 0, wordIndex: 0 }
      },
      { ...textRun(2, "Beta", 6), wrapper: text.wrapper, childIndex: 0, wordIndex: 1 },
      {
        kind: "space",
        runIndex: 3,
        sourceStart: 10,
        sourceEnd: 11,
        text: " ",
        wrapper: text.wrapper,
        breakRef: { kind: "mtext-space", wrapper: text.wrapper, childIndex: 0, wordIndex: 1 }
      },
      { ...textRun(4, "Gamma", 11), wrapper: text.wrapper, childIndex: 0, wordIndex: 2 }
    ];

    const result = applyBreaks(paragraphWrapper, runs, [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 5,
        break: {
          kind: "hyphen",
          runIndex: 0,
          sourceOffset: 2,
          visibleHyphen: true,
          splitOffset: 2
        }
      },
      {
        lineIndex: 1,
        startRun: 2,
        startTextOffset: 0,
        endRun: 3,
        endTextOffset: null,
        width: 5,
        break: {
          kind: "space",
          runIndex: 3,
          sourceOffset: 11,
          visibleHyphen: false
        }
      }
    ], {
      alignment: "center",
      paragraphId: "paragraph-a",
      originalMtextTextByWrapper: originalText
    });

    expect(result).toMatchObject({ canProceed: true, errors: [] });
    expect(result.appliedBreaks).toEqual([
      { lineIndex: 0, kind: "hyphen", runIndex: 0, sourceOffset: 2, visibleHyphen: true, splitOffset: 2 },
      { lineIndex: 1, kind: "space", runIndex: 3, sourceOffset: 11, visibleHyphen: false, splitOffset: undefined }
    ]);
    expect(text.child.text).toBe("Al- pha Beta Gamma");
    expect(text.breaks).toEqual([[0, 1], [0, 2]]);
    expect(text.attrs.values.get("indentalign")).toBe("center");
    expect(parentAttrs.values.get("data-align")).toBe("center");
    expect(parentAttrs.values.get("data-paragraph-id")).toBe("paragraph-a");
    expect(text.clearCount).toBeGreaterThan(0);
    text.wrapper.computeLineBBox(0);
    expect(text.indentCalls).toBe(1);
  });

  it("applies mspace widths, forced line-leading trims, and justified width adjustments", () => {
    const text = mutableMtextWrapper("[8pt]After");
    const adjustable = mutableMspaceWrapper("0.25em", 0.25);
    const forced = mutableMspaceWrapper("2em", 2);
    const paragraphWrapper = { parent: { node: node("mrow", { attributes: attributes() }) } };
    const originalMspace = new WeakMap<object, string | undefined>();
    originalMspace.set(adjustable.wrapper, "0.25em");
    originalMspace.set(forced.wrapper, "2em");
    const runs: ParagraphRun[] = [
      {
        kind: "space",
        runIndex: 0,
        sourceStart: 0,
        sourceEnd: 1,
        text: " ",
        wrapper: adjustable.wrapper,
        breakRef: { kind: "mspace", wrapper: adjustable.wrapper }
      },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 1,
        sourceEnd: 2,
        text: " ",
        wrapper: forced.wrapper,
        breakRef: {
          kind: "mspace",
          wrapper: forced.wrapper,
          isForcedLineBreak: true,
          lineLeading: "8pt",
          lineLeadingTrim: { wrapper: text.wrapper, childIndex: 0, wordIndex: 0, consumed: 5 }
        }
      },
      { ...textRun(2, "[8pt]After", 2), wrapper: text.wrapper, childIndex: 0, wordIndex: 0 }
    ];

    const result = applyBreaks(paragraphWrapper, runs, [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 1,
        spaceDeltaPerGap: 0.5,
        break: null
      },
      {
        lineIndex: 1,
        startRun: 1,
        startTextOffset: 0,
        endRun: 2,
        endTextOffset: null,
        width: 6,
        break: {
          kind: "forced",
          runIndex: 1,
          sourceOffset: 2,
          visibleHyphen: false,
          lineLeading: "8pt"
        }
      }
    ], {
      alignment: "justified",
      originalMspaceWidthByWrapper: originalMspace,
      wrappedTextGaps: [{ sourceStart: 0, widthEm: 0.75 }]
    });

    expect(result.canProceed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.appliedBreaks).toEqual([
      { lineIndex: 1, kind: "forced", runIndex: 1, sourceOffset: 2, visibleHyphen: false, lineLeading: "8pt" }
    ]);
    expect(adjustable.attrs.values.get("width")).toBe("0.75em");
    expect(adjustable.styles).toContain("");
    expect(forced.attrs.values.get("data-lineleading")).toBe("8pt");
    expect(forced.styles).toContain("before");
    expect(text.child.text).toBe("After");
  });

  it("rolls back mtext mutations when a break cannot be applied", () => {
    const text = mutableMtextWrapper("Alpha Beta", { exposeSetBreakAt: false });
    const originalText = new WeakMap<object, string[]>();
    originalText.set(text.wrapper, ["Alpha Beta"]);
    const paragraphWrapper = {};
    const runs: ParagraphRun[] = [
      { ...textRun(0, "Alpha", 0), wrapper: text.wrapper, childIndex: 0, wordIndex: 0 }
    ];

    const result = applyBreaks(paragraphWrapper, runs, [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 5,
        break: {
          kind: "hyphen",
          runIndex: 0,
          sourceOffset: 2,
          visibleHyphen: false,
          splitOffset: 2
        }
      }
    ], {
      originalMtextTextByWrapper: originalText
    });

    expect(result.canProceed).toBe(false);
    expect(result.appliedBreaks).toEqual([]);
    expect(result.errors).toEqual(["Target mtext wrapper does not expose setBreakAt()."]);
    expect(text.child.text).toBe("Alpha Beta");
    expect(text.clearCount).toBeGreaterThan(0);
  });

  it("normalizes duplicate split mutations before applying mtext breaks", () => {
    const text = mutableMtextWrapper("Alpha");
    const runs: ParagraphRun[] = [
      { ...textRun(0, "Alpha", 0), wrapper: text.wrapper, childIndex: 0, wordIndex: 0 }
    ];
    const lines = [false, true].map((visibleHyphen, lineIndex) => ({
      lineIndex,
      startRun: 0,
      startTextOffset: 0,
      endRun: 0,
      endTextOffset: null,
      width: 5,
      break: {
        kind: "hyphen" as const,
        runIndex: 0,
        sourceOffset: 2,
        visibleHyphen,
        splitOffset: 2
      }
    }));

    const result = applyBreaks({}, runs, lines);

    expect(result.canProceed).toBe(true);
    expect(text.child.text).toBe("Al- pha");
    expect(text.breaks).toEqual([[0, 1], [0, 1]]);
    expect(result.appliedBreaks.map((entry) => entry.visibleHyphen)).toEqual([false, true]);
  });

  it("reports invalid break decisions without mutating text", () => {
    const text = mutableMtextWrapper("Alpha");
    const space = mutableMspaceWrapper("1em", Number.NaN);
    const runs: ParagraphRun[] = [
      { ...textRun(0, "Alpha", 0), wrapper: text.wrapper, childIndex: 0, wordIndex: 0 },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 5,
        sourceEnd: 6,
        text: " ",
        wrapper: space.wrapper,
        breakRef: { kind: "mspace", wrapper: space.wrapper }
      }
    ];

    const result = applyBreaks({}, runs, [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 5,
        break: { kind: "hyphen", runIndex: 1, sourceOffset: 5, visibleHyphen: true, splitOffset: 1 }
      },
      {
        lineIndex: 1,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 5,
        break: { kind: "hyphen", runIndex: 0, sourceOffset: 5, visibleHyphen: true }
      },
      {
        lineIndex: 2,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 5,
        break: { kind: "forced", runIndex: 99, sourceOffset: 99, visibleHyphen: false, lineLeading: "3pt" }
      },
      {
        lineIndex: 3,
        startRun: 1,
        startTextOffset: 0,
        endRun: 1,
        endTextOffset: null,
        width: 1,
        break: { kind: "space", runIndex: 1, sourceOffset: 6, visibleHyphen: false }
      }
    ], {
      alignment: "ragged-left",
      wrappedTextGaps: [{ sourceStart: 1, widthEm: -1 }]
    });

    expect(result.canProceed).toBe(false);
    expect(result.appliedBreaks).toEqual([]);
    expect(result.errors).toEqual([
      "Hyphen break points to non-text run index 1.",
      "Hyphen break at run 0 is missing splitOffset."
    ]);
    expect(space.attrs.values.get("width")).toBe("0em");
    expect(space.styles).toContain("before");
  });

  it("reports wrapper mutation failures and restores touched mspace wrappers", () => {
    const originalMspace = new WeakMap<object, string | undefined>();
    const cases: Array<{
      name: string;
      wrapper: any;
      run: ParagraphRun;
      lineBreak: any;
      expectedError: string;
    }> = [
      {
        name: "missing child",
        wrapper: { node: node("mtext"), childNodes: [] },
        run: { ...textRun(0, "Alpha", 0), wrapper: { node: node("mtext"), childNodes: [] }, childIndex: 0, wordIndex: 0 },
        lineBreak: { kind: "hyphen", runIndex: 0, sourceOffset: 2, visibleHyphen: true, splitOffset: 2 } as never,
        expectedError: "Mutation failed: mtext child 0 is missing or not text."
      },
      {
        name: "missing getText",
        wrapper: { node: node("mtext"), childNodes: [{ node: node("text", { setText: () => undefined }) }] },
        run: { ...textRun(0, "Alpha", 0), wrapper: { node: node("mtext"), childNodes: [{ node: node("text", { setText: () => undefined }) }] }, childIndex: 0, wordIndex: 0 },
        lineBreak: { kind: "hyphen", runIndex: 0, sourceOffset: 2, visibleHyphen: true, splitOffset: 2 } as never,
        expectedError: "Mutation failed: child 0 does not expose getText()."
      },
      {
        name: "missing setText",
        wrapper: { node: node("mtext"), childNodes: [textChild("Alpha")] },
        run: { ...textRun(0, "Alpha", 0), wrapper: { node: node("mtext"), childNodes: [textChild("Alpha")] }, childIndex: 0, wordIndex: 0 },
        lineBreak: { kind: "hyphen", runIndex: 0, sourceOffset: 2, visibleHyphen: true, splitOffset: 2 } as never,
        expectedError: "Mutation failed: child 0 does not expose setText()."
      }
    ];

    for (const testCase of cases) {
      testCase.run = { ...testCase.run, wrapper: testCase.wrapper };
      const result = applyBreaks({}, [testCase.run], [
        {
          lineIndex: 0,
          startRun: 0,
          startTextOffset: 0,
          endRun: 0,
          endTextOffset: null,
          width: 5,
          break: testCase.lineBreak
        }
      ]);
      expect(result.errors, testCase.name).toEqual([testCase.expectedError]);
      expect(result.canProceed, testCase.name).toBe(false);
    }

    const trim = mutableMtextWrapper("Tiny");
    const badSplit = mutableMtextWrapper("Tiny");
    const mspaceWithoutAttrs = { node: node("mspace"), setBreakStyle: () => undefined };
    const restored = mutableMspaceWrapper("2em", 2);
    originalMspace.set(restored.wrapper, "2em");
    const trimRun: ParagraphRun = {
      kind: "space",
      runIndex: 0,
      sourceStart: 0,
      sourceEnd: 1,
      text: " ",
      wrapper: mspaceWithoutAttrs,
      breakRef: {
        kind: "mspace",
        wrapper: mspaceWithoutAttrs,
        isForcedLineBreak: true,
        lineLeadingTrim: { wrapper: trim.wrapper, childIndex: 0, wordIndex: 0, consumed: 99 }
      }
    };
    const splitRun = { ...textRun(1, "Tiny", 1), wrapper: badSplit.wrapper, childIndex: 0, wordIndex: 0 };
    const restoreRun: ParagraphRun = {
      kind: "space",
      runIndex: 2,
      sourceStart: 5,
      sourceEnd: 6,
      text: " ",
      wrapper: restored.wrapper,
      breakRef: { kind: "mspace", wrapper: restored.wrapper }
    };
    const result = applyBreaks({}, [trimRun, splitRun, restoreRun], [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 1,
        break: { kind: "forced", runIndex: 0, sourceOffset: 1, visibleHyphen: false }
      },
      {
        lineIndex: 1,
        startRun: 1,
        startTextOffset: 0,
        endRun: 1,
        endTextOffset: null,
        width: 4,
        break: { kind: "hyphen", runIndex: 1, sourceOffset: 1, visibleHyphen: true, splitOffset: 4 }
      }
    ], {
      originalMspaceWidthByWrapper: originalMspace
    });

    expect(result.canProceed).toBe(false);
    expect(result.errors[0]).toBe("Mutation failed: line-leading trim length 99 exceeds word 'Tiny'.");
    expect(restored.attrs.values.get("width")).toBe("2em");
  });

  it("covers applyBreaks defensive wrapper and fallback branches", () => {
    const noAttrsText = {
      node: node("mtext"),
      childNodes: [mutableTextChild("One Two")],
      clearBreakPoints: () => undefined
    };
    const adjustableWithoutAttrs = {
      node: node("mspace"),
      getOuterBBox: () => ({ w: 1 })
    };
    const styleOnlyMspace = {
      node: node("mspace"),
      setBreakStyle: () => undefined
    };
    const plainParagraph = {};
    const runs: ParagraphRun[] = [
      { ...textRun(0, "One", 0), wrapper: noAttrsText, childIndex: 0, wordIndex: 0 },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 3,
        sourceEnd: 4,
        text: " ",
        wrapper: adjustableWithoutAttrs,
        breakRef: { kind: "mspace", wrapper: adjustableWithoutAttrs }
      },
      {
        kind: "space",
        runIndex: 2,
        sourceStart: 4,
        sourceEnd: 5,
        text: " ",
        wrapper: styleOnlyMspace,
        breakRef: {
          kind: "mspace",
          wrapper: styleOnlyMspace,
          isForcedLineBreak: true,
          lineLeadingTrim: { wrapper: noAttrsText, childIndex: 0, wordIndex: 0, consumed: 0 }
        }
      }
    ];

    const first = applyBreaks(plainParagraph, runs, [
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 1,
        endTextOffset: null,
        width: 4,
        spaceDeltaPerGap: Number.NaN,
        break: { kind: "space", runIndex: 1, sourceOffset: 4, visibleHyphen: false }
      },
      {
        lineIndex: 1,
        startRun: 2,
        startTextOffset: 0,
        endRun: 2,
        endTextOffset: null,
        width: 1,
        break: { kind: "forced", runIndex: 2, sourceOffset: 5, visibleHyphen: false }
      }
    ], {
      alignment: "ragged-left",
      wrappedTextGaps: [
        { sourceStart: 1, widthEm: Number.NaN },
        { sourceStart: 1, widthEm: 0.25 }
      ]
    });
    const second = applyBreaks(plainParagraph, runs, [], { alignment: "ragged-left" });

    expect(first.canProceed).toBe(true);
    expect(first.appliedBreaks.map((entry) => entry.kind)).toEqual(["space", "forced"]);
    expect(second.canProceed).toBe(true);
  });

  it("rolls back malformed applyBreaks plans through defensive restoration paths", () => {
    const originalText = new WeakMap<object, string[]>();

    const nullWrapperResult = applyBreaks({}, [
      { ...textRun(0, "Alpha", 0), wrapper: null, childIndex: 0, wordIndex: 0 } as unknown as ParagraphRun
    ], [{
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: 0,
      endTextOffset: null,
      width: 5,
      break: { kind: "hyphen", runIndex: 0, sourceOffset: 2, visibleHyphen: true, splitOffset: 2 }
    }], { originalMtextTextByWrapper: originalText });
    expect(nullWrapperResult.canProceed).toBe(false);
    expect(nullWrapperResult.errors[0]).toContain("mtext child 0 is missing");

    const noSnapshotWrapper = { node: node("mtext"), childNodes: {} };
    const noSnapshotResult = applyBreaks({}, [
      { ...textRun(0, "Alpha", 0), wrapper: noSnapshotWrapper as never, childIndex: 0, wordIndex: 0 }
    ], [{
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: 0,
      endTextOffset: null,
      width: 5,
      break: { kind: "hyphen", runIndex: 0, sourceOffset: 2, visibleHyphen: true, splitOffset: 2 }
    }], { originalMtextTextByWrapper: originalText });
    expect(noSnapshotResult.canProceed).toBe(false);
    expect(noSnapshotResult.errors[0]).toContain("mtext child 0 is missing");

    const restoreWrapper = {
      node: node("mtext"),
      childNodes: [{ node: node("mi") }, mutableTextChild("Word")],
      clearBreakPoints: () => undefined,
      setBreakAt: () => undefined
    };
    originalText.set(restoreWrapper, []);
    const unmappableResult = applyBreaks({}, [
      { ...textRun(0, "Word", 0), wrapper: restoreWrapper, childIndex: 1, wordIndex: 0 }
    ], [{
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: 0,
      endTextOffset: null,
      width: 4,
      break: {
        kind: "hyphen",
        runIndex: 0,
        sourceOffset: 1,
        visibleHyphen: true,
        splitOffset: Number.NaN
      }
    }], { originalMtextTextByWrapper: originalText });
    expect(unmappableResult.canProceed).toBe(false);
    expect(unmappableResult.errors[0]).toContain("Failed to map mutated break index");

    const invalidSplit = mutableMtextWrapper("Word");
    const invalidSplitResult = applyBreaks({}, [
      { ...textRun(0, "Word", 0), wrapper: invalidSplit.wrapper, childIndex: 0, wordIndex: 0 }
    ], [{
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: 0,
      endTextOffset: null,
      width: 4,
      break: { kind: "hyphen", runIndex: 0, sourceOffset: 0, visibleHyphen: true, splitOffset: 0 }
    }]);
    expect(invalidSplitResult.errors[0]).toContain("splitOffset 0 invalid");

    const badWordIndex = mutableMtextWrapper("Word");
    const badWordResult = applyBreaks({}, [
      { ...textRun(0, "Word", 0), wrapper: badWordIndex.wrapper, childIndex: 0, wordIndex: -1 }
    ], [{
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: 0,
      endTextOffset: null,
      width: 4,
      break: { kind: "hyphen", runIndex: 0, sourceOffset: 1, visibleHyphen: true, splitOffset: 1 }
    }]);
    expect(badWordResult.errors[0]).toContain("wordIndex -1 out of range");

    const badTrim = mutableMtextWrapper("Word");
    const trimSpace = mutableMspaceWrapper("1em");
    const badTrimResult = applyBreaks({}, [{
      kind: "space",
      runIndex: 0,
      sourceStart: 0,
      sourceEnd: 1,
      text: " ",
      wrapper: trimSpace.wrapper,
      breakRef: {
        kind: "mspace",
        wrapper: trimSpace.wrapper,
        isForcedLineBreak: true,
        lineLeadingTrim: { wrapper: badTrim.wrapper, childIndex: 0, wordIndex: -1, consumed: 1 }
      }
    }], [{
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: 0,
      endTextOffset: null,
      width: 1,
      break: { kind: "forced", runIndex: 0, sourceOffset: 1, visibleHyphen: false }
    }]);
    expect(badTrimResult.errors[0]).toContain("line-leading trim wordIndex -1 out of range");

    const outerOnlyAttrs = attributes();
    const outerOnlyMspace = {
      node: node("mspace", { attributes: outerOnlyAttrs }),
      getOuterBBox: () => ({ w: Number.NaN }),
      invalidateBBox: () => undefined
    };
    const forcedMspace = mutableMspaceWrapper("1em");
    const oddSpace = {
      node: node("mspace"),
      setBreakStyle: () => undefined
    };
    const justifiedResult = applyBreaks({}, [
      {
        kind: "space",
        runIndex: 0,
        sourceStart: 0,
        sourceEnd: 1,
        text: " ",
        wrapper: null,
        breakRef: { kind: "mspace", wrapper: null }
      },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 1,
        sourceEnd: 2,
        text: " ",
        wrapper: outerOnlyMspace,
        breakRef: { kind: "mspace", wrapper: outerOnlyMspace }
      },
      {
        kind: "space",
        runIndex: 2,
        sourceStart: 2,
        sourceEnd: 3,
        text: " ",
        wrapper: forcedMspace.wrapper,
        breakRef: { kind: "mspace", wrapper: forcedMspace.wrapper, isForcedLineBreak: true }
      },
      {
        kind: "space",
        runIndex: 3,
        sourceStart: 3,
        sourceEnd: 4,
        text: " ",
        wrapper: oddSpace,
        breakRef: { kind: "custom", wrapper: oddSpace } as never
      }
    ] as ParagraphRun[], [{
      lineIndex: 0,
      startRun: 0,
      startTextOffset: 0,
      endRun: 3,
      endTextOffset: null,
      width: 4,
      spaceDeltaPerGap: 1,
      break: { kind: "forced", runIndex: 3, sourceOffset: 4, visibleHyphen: false }
    }], { alignment: "justified" });
    expect(justifiedResult.canProceed).toBe(true);
    expect(justifiedResult.appliedBreaks).toEqual([
      { lineIndex: 0, kind: "forced", runIndex: 3, sourceOffset: 4, visibleHyphen: false, lineLeading: undefined }
    ]);
    expect(outerOnlyAttrs.values.get("width")).toBe("1em");
  });

  it("builds items for text, spaces, forced breaks, math, hyphenation, and invalid runs", () => {
    const measurement = createMeasurementService();
    const textWrapper = {
      textWidth: (text: string) => text.length
    };
    const mathWrapper = {
      getOuterBBox: () => ({ L: 1, w: 5, R: 2 })
    };
    const hyphenator = {
      hyphenate: (word: string) => word === "pre-fix" ? [0, 3, 99] : []
    };
    const runs: ParagraphRun[] = [
      { ...textRun(0, "pre-fix", 0), wrapper: textWrapper },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 7,
        sourceEnd: 8,
        text: " ",
        wrapper: mathWrapper,
        breakRef: { kind: "mspace", wrapper: mathWrapper, isForcedLineBreak: true }
      },
      {
        kind: "space",
        runIndex: 2,
        sourceStart: 8,
        sourceEnd: 9,
        text: " ",
        wrapper: textWrapper,
        breakRef: { kind: "mtext-space", wrapper: textWrapper, childIndex: 0, wordIndex: 0 }
      },
      { kind: "math", runIndex: 3, sourceStart: 9, sourceEnd: 10, wrapper: mathWrapper },
      { kind: "unknown", runIndex: 4, sourceStart: 10, sourceEnd: 11, wrapper: textWrapper } as never
    ];

    const paragraph = runsToItems(runs, measurement, {
      enableAutomaticHyphenation: true,
      hyphenator,
      hyphenpenalty: 77,
      exhyphenpenalty: 88,
      spaceStretch: 2,
      spaceShrink: 1
    });

    expect(paragraph.errors).toEqual(["Unsupported run kind."]);
    expect(paragraph.runWidths.get(0)).toBe(7);
    expect(paragraph.runWidths.get(1)).toBe(8);
    expect(paragraph.items.some((item) => item.kind === "penalty" && item.payload.hyphenSource === "explicit")).toBe(true);
    expect(paragraph.items.some((item) => item.kind === "penalty" && item.payload.hyphenSource === "automatic")).toBe(true);
    expect(paragraph.items.some((item) => item.kind === "penalty" && item.payload.breakKind === "forced")).toBe(true);
    expect(paragraph.items.some((item) => item.kind === "glue" && item.stretch === 2 && item.shrink === 1)).toBe(true);
    expect(getBreakableRunIndices(paragraph.items)).toEqual(new Set([0, 1, 2]));

    const missingHyphenator = runsToItems([{ ...textRun(0, "prefix", 0), wrapper: textWrapper }], measurement, {
      enableAutomaticHyphenation: true
    });
    expect(missingHyphenator.errors[0]).toContain("no hyphenator");

    const noSplits = runsToItems([
      { ...textRun(0, "a", 0), wrapper: textWrapper },
      { ...textRun(1, "word", 1), wrapper: textWrapper }
    ], measurement, {
      enableAutomaticHyphenation: true,
      hyphenator: { hyphenate: () => [] }
    });
    expect(noSplits.errors).toEqual([]);
    expect(noSplits.items.filter((item) => item.kind === "penalty")).toHaveLength(0);
  });

  it("preloads and caches the English hyphenator", async () => {
    expect(new NoopHyphenator().hyphenate()).toEqual([]);
    expect(createEnglishHyphenator().hyphenate("hyphenation")).toEqual([]);

    const exceptionHyphenator = new EnglishHyphenator(
      { children: new Map(), values: null },
      new Map([["custom", [1, 3, 6]]])
    );
    expect(exceptionHyphenator.hyphenate("custom")).toEqual([3]);
    expect(exceptionHyphenator.hyphenate("Custom")).toBe(exceptionHyphenator.hyphenate("custom"));

    await preloadEnglishHyphenator();
    await preloadEnglishHyphenator();
    const defaultHyphenator = createEnglishHyphenator();
    const permissiveHyphenator = createEnglishHyphenator({ leftMin: 1, rightMin: 1 });

    expect(defaultHyphenator.hyphenate("hyphenation").length).toBeGreaterThan(0);
    expect(defaultHyphenator.hyphenate("hyphenation")).toBe(defaultHyphenator.hyphenate("Hyphenation"));
    expect(defaultHyphenator.hyphenate("blandit")).toEqual([4]);
    expect(defaultHyphenator.hyphenate("nonasciié")).toEqual([]);
    expect(permissiveHyphenator.hyphenate("cooperation").length).toBeGreaterThanOrEqual(
      defaultHyphenator.hyphenate("cooperation").length
    );
  });

  it("uses literal TikZ and TeX glue constants for paragraph alignment profiles", () => {
    expect(buildAlignmentProfile("ragged-right").rightskip.stretch).toBe(TIKZ_RAGGED_SKIP_STRETCH_EM);
    expect(buildAlignmentProfile("ragged-left").leftskip.stretch).toBe(TIKZ_RAGGED_SKIP_STRETCH_EM);
    expect(buildAlignmentProfile("center").leftskip.stretch).toBe(TIKZ_RAGGED_SKIP_STRETCH_EM);
    expect(buildAlignmentProfile("center").rightskip.stretch).toBe(TIKZ_RAGGED_SKIP_STRETCH_EM);
    expect(buildAlignmentProfile("justified").interwordStretch).toBe(TEX_INTERWORD_STRETCH_EM);
    expect(buildAlignmentProfile("justified").interwordShrink).toBe(TEX_INTERWORD_SHRINK_EM);
  });

  it("builds paragraph reports with measured partial text, glue, and visible hyphens", () => {
    const measurement = createMeasurementService();
    const textWrapper = {
      textWidth: (text: string) => text.length
    };
    const runs: ParagraphRun[] = [
      { ...textRun(0, "abcdef", 0), wrapper: textWrapper },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 6,
        sourceEnd: 7,
        text: " ",
        wrapper: textWrapper,
        breakRef: { kind: "mtext-space", wrapper: textWrapper, childIndex: 0, wordIndex: 0 }
      },
      { kind: "math", runIndex: 2, sourceStart: 7, sourceEnd: 10, wrapper: { getBBox: () => ({ w: 3 }) } }
    ];
    const report = buildParagraphLayoutReport({
      paragraphId: "p",
      width: 10,
      alignment: "ragged-right",
      layoutMode: "wrap",
      runs,
      runWidths: new Map([[0, 6], [1, 1], [2, 3]]),
      measurement,
      appliedBreaks: [{
        lineIndex: 0,
        kind: "hyphen",
        runIndex: 0,
        sourceOffset: 4,
        visibleHyphen: true,
        hyphenSource: "automatic",
        splitOffset: 4
      }],
      lineMetrics: [{ ascent: Number.NaN, descent: 2 }],
      lines: [{
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 1,
        endRun: 2,
        endTextOffset: null,
        width: 10,
        targetWidth: 12,
        lineNaturalWidth: 9,
        xOffset: 2,
        glueSetRatio: 0.5,
        badness: 10,
        spaceCount: 1,
        spaceDeltaPerGap: 2,
        break: null
      }]
    });

    expect(report.lines[0]?.segments.map((segment) => segment.kind)).toEqual(["text", "space", "math", "text"]);
    expect(report.lines[0]?.segments[0]).toMatchObject({ text: "bcdef", x: 2, width: 5 });
    expect(report.lines[0]?.segments[1]).toMatchObject({ width: 3 });
    expect(report.lines[0]?.segments[3]).toMatchObject({ text: "-", width: 1 });
    expect(report.lines[0]?.ascent).toBe(0);
    expect(report.lines[0]?.break).toMatchObject({ kind: "hyphen", splitOffset: 4 });

    const textSegment = report.lines[0]?.segments[0];
    expect(textSegment).toBeDefined();
    if (textSegment) {
      expect(getOrBuildTextSegmentCaretStops(textSegment)).toEqual([2, 3, 4, 5, 6, 7]);
      expect(getOrBuildTextSegmentCaretStops(textSegment)).toBe(textSegment.caretStops);
    }
    expect(getOrBuildTextSegmentCaretStops({ runIndex: 1, kind: "space", x: 0, width: 1, caretStops: [0, 1] })).toEqual([0, 1]);
    expect(getOrBuildTextSegmentCaretStops({ runIndex: 99, kind: "text", text: "x", x: 0, width: 1 })).toBeNull();
  });

  it("builds paragraph reports with fallback widths, defaults, and cached caret stops", () => {
    const textWrapper = {
      textWidth: (text: string) => text.length === 1 ? Number.NaN : text.length * 2
    };
    const runs: ParagraphRun[] = [
      { ...textRun(0, "", 0), wrapper: textWrapper },
      { ...textRun(1, "abcdef", 0), wrapper: textWrapper },
      {
        kind: "space",
        runIndex: 2,
        sourceStart: 6,
        sourceEnd: 7,
        text: " ",
        wrapper: textWrapper,
        breakRef: { kind: "mtext-space", wrapper: textWrapper, childIndex: 0, wordIndex: 0 }
      },
      { kind: "math", runIndex: 3, sourceStart: 7, sourceEnd: 8, wrapper: {} }
    ];

    const report = buildParagraphLayoutReport({
      paragraphId: "fallback",
      width: 20,
      alignment: "center",
      layoutMode: "wrap",
      runs,
      runWidths: new Map([[1, 12], [2, 2], [3, 5]]),
      appliedBreaks: [],
      errors: ["degraded"],
      internalMode: "degraded",
      internalDegradeReason: "measurement",
      externalFallbackUsed: true,
      linebreakingMode: "overfull",
      lines: [
        {
          lineIndex: 0,
          startRun: 0,
          startTextOffset: 0,
          endRun: 0,
          endTextOffset: 0,
          width: 0,
          break: null
        },
        {
          lineIndex: 1,
          startRun: 1,
          startTextOffset: 1,
          endRun: 3,
          endTextOffset: null,
          width: 19,
          spaceCount: 1,
          spaceDeltaPerGap: -5,
          break: {
            kind: "forced",
            runIndex: 2,
            sourceOffset: 7,
            visibleHyphen: false,
            lineLeading: "4pt"
          }
        }
      ]
    });

    expect(report.internalMode).toBe("degraded");
    expect(report.internalDegradeReason).toBe("measurement");
    expect(report.externalFallbackUsed).toBe(true);
    expect(report.linebreakingMode).toBe("overfull");
    expect(report.errors).toEqual(["degraded"]);
    expect(report.runs[0]).toMatchObject({ width: 0, text: "" });
    expect(report.lines[0]).toMatchObject({ targetWidth: 20, naturalWidth: 0, xStart: 0, xEnd: 0, segments: [] });
    expect(report.lines[1]?.segments).toEqual([
      { runIndex: 1, kind: "text", text: "bcdef", startOffset: 1, endOffset: 6, x: 0, width: 10 },
      { runIndex: 2, kind: "space", text: " ", x: 10, width: 0, caretStops: [10, 10] },
      { runIndex: 3, kind: "math", x: 10, width: 5, caretStops: [10, 15] }
    ]);
    expect(report.lines[1]?.break).toMatchObject({ kind: "forced", lineLeading: "4pt" });

    const textSegment = report.lines[1]?.segments[0];
    expect(textSegment).toBeDefined();
    if (textSegment) {
      expect(getOrBuildTextSegmentCaretStops(textSegment)).toEqual([0, 0, 4, 6, 8, 10]);
      delete textSegment.caretStops;
      expect(getOrBuildTextSegmentCaretStops(textSegment)).toEqual([0, 0, 4, 6, 8, 10]);
    }
    expect(getOrBuildTextSegmentCaretStops({ runIndex: 3, kind: "math", x: 0, width: 5 })).toBeNull();
  });

  it("builds paragraph reports for zero-width hyphen fallback and missing runs", () => {
    const runs: ParagraphRun[] = [
      { ...textRun(0, "abc", 0), wrapper: {} },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 3,
        sourceEnd: 4,
        text: " ",
        wrapper,
        breakRef: { kind: "mtext-space", wrapper, childIndex: 0, wordIndex: 0 }
      }
    ];
    const report = buildParagraphLayoutReport({
      paragraphId: "partial",
      width: 6,
      alignment: "ragged-left",
      layoutMode: "wrap",
      runs,
      runWidths: new Map([[0, 3]]),
      appliedBreaks: [{
        lineIndex: 0,
        kind: "hyphen",
        runIndex: 1,
        sourceOffset: 4,
        visibleHyphen: true
      }],
      lines: [{
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 3,
        endRun: 5,
        endTextOffset: null,
        width: 0,
        break: null,
        spaceCount: 1,
        spaceDeltaPerGap: Number.NaN
      }]
    });

    expect(report.lines[0]?.segments).toEqual([
      { runIndex: 1, kind: "space", text: " ", x: 0, width: 0, caretStops: [0, 0] }
    ]);
    expect(report.lines[0]?.break).toMatchObject({ kind: "hyphen", visibleHyphen: true });

    const missingRunReport = buildParagraphLayoutReport({
      paragraphId: "missing",
      width: 4,
      alignment: "ragged-right",
      layoutMode: "wrap",
      runs: [{ ...textRun(0, "", 0), wrapper: {} }],
      runWidths: new Map([[0, 2]]),
      appliedBreaks: [],
      lineMetrics: [{ ascent: 2, descent: Number.NaN }],
      lines: [{
        lineIndex: 0,
        startRun: -1,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: 1,
        width: 2,
        break: null
      }]
    });
    expect(missingRunReport.lines[0]?.segments).toEqual([
      { runIndex: 0, kind: "text", text: "", startOffset: 0, endOffset: 1, x: 0, width: 0 }
    ]);
    expect(missingRunReport.lines[0]?.descent).toBe(0);
  });

  it("flattens text, math, forced mspace breaks, and unsupported wrappers", () => {
    const linebreak = mspace({ linebreak: "newline" });
    const paragraph = {
      node: node("mrow"),
      childNodes: [
        mtext(textChild("Alpha  Beta")),
        linebreak,
        mtext(textChild("[12pt]Gamma")),
        {
          node: node("mtext"),
          childNodes: [
            null,
            {
              node: node("mtable")
            },
            {
              node: node("mi")
            }
          ]
        },
        {
          node: node("mtable")
        },
        null as never
      ]
    };

    const flattened = flattenParagraph(paragraph as never);

    expect(flattened.canProceed).toBe(true);
    expect(flattened.unsupportedKinds).toContain("mtable");
    expect(flattened.unsupportedKinds).toContain("unknown");
    expect(flattened.errors.length).toBeGreaterThan(0);
    expect(flattened.runs.map((run) => run.kind)).toEqual([
      "text",
      "space",
      "text",
      "space",
      "text",
      "math",
      "math",
      "math"
    ]);

    const forced = flattened.runs[3];
    expect(forced?.kind).toBe("space");
    if (forced?.kind === "space" && forced.breakRef.kind === "mspace") {
      expect(forced.breakRef.isForcedLineBreak).toBe(true);
      expect(forced.breakRef.lineLeading).toBe("12pt");
      expect(forced.breakRef.lineLeadingTrim?.consumed).toBe(6);
    }
    expect(flattened.runs[4]).toMatchObject({ kind: "text", text: "Gamma" });

    const latexForced = flattenParagraph({
      node: node("mrow"),
      childNodes: [mspace({ "data-latex": "\\\\" })]
    });
    expect(latexForced.runs[0]?.kind).toBe("space");
    if (latexForced.runs[0]?.kind === "space" && latexForced.runs[0].breakRef.kind === "mspace") {
      expect(latexForced.runs[0].breakRef.isForcedLineBreak).toBe(true);
    }
  });

  it("normalizes optional forced-break leading only when the next text token matches", () => {
    const explicitLeading = flattenParagraph({
      node: node("mrow"),
      childNodes: [
        mspace({ linebreak: "indentingnewline", "data-lineleading": " 6pt " }),
        mtext(textChild("Plain")),
        mspace({ linebreak: "newline" }),
        mtext(textChild("[8pt]After")),
        mspace({}),
        mtext(textChild("plain"))
      ]
    });

    expect(explicitLeading.runs.map((run) => run.kind)).toEqual(["space", "text", "space", "text", "space", "text"]);
    const firstBreak = explicitLeading.runs[0];
    expect(firstBreak?.kind).toBe("space");
    if (firstBreak?.kind === "space" && firstBreak.breakRef.kind === "mspace") {
      expect(firstBreak.breakRef.lineLeading).toBe("6pt");
      expect(firstBreak.breakRef.lineLeadingTrim).toBeUndefined();
    }
    const secondBreak = explicitLeading.runs[2];
    expect(secondBreak?.kind).toBe("space");
    if (secondBreak?.kind === "space" && secondBreak.breakRef.kind === "mspace") {
      expect(secondBreak.breakRef.lineLeading).toBe("8pt");
      expect(secondBreak.breakRef.lineLeadingTrim?.consumed).toBe(5);
    }
    expect(explicitLeading.runs[3]).toMatchObject({ kind: "text", text: "After" });

    const atomic = flattenParagraph({ node: node("math"), childNodes: undefined });
    expect(atomic.runs).toEqual([]);

    const standaloneAtomic = flattenParagraph({ node: node("mi"), childNodes: [] });
    expect(standaloneAtomic.runs).toEqual([
      expect.objectContaining({ kind: "math", sourceStart: 0, sourceEnd: 1 })
    ]);

    const emptyMtext = flattenParagraph({ node: node("mtext"), childNodes: [textChild("   "), textChild("")] });
    expect(emptyMtext.runs).toHaveLength(1);
    expect(emptyMtext.runs[0]).toMatchObject({ kind: "space", text: " " });

    const blankLineLeading = flattenParagraph({
      node: node("mrow"),
      childNodes: [mspace({ linebreak: "newline", "data-lineleading": "   " })]
    });
    expect(blankLineLeading.runs[0]).toMatchObject({ kind: "space" });
    if (blankLineLeading.runs[0]?.kind === "space" && blankLineLeading.runs[0].breakRef.kind === "mspace") {
      expect(blankLineLeading.runs[0].breakRef.lineLeading).toBeUndefined();
    }

    const fullyTrimmed = flattenParagraph({
      node: node("mrow"),
      childNodes: [mspace({ linebreak: "newline" }), mtext(textChild("[7pt]"))]
    });
    expect(fullyTrimmed.runs).toHaveLength(1);
    expect(fullyTrimmed.runs[0]).toMatchObject({ kind: "space" });
    if (fullyTrimmed.runs[0]?.kind === "space" && fullyTrimmed.runs[0].breakRef.kind === "mspace") {
      expect(fullyTrimmed.runs[0].breakRef.lineLeading).toBe("7pt");
    }

    const interruptedTrim = flattenParagraph({
      node: node("mrow"),
      childNodes: [mspace({ linebreak: "newline" }), mspace({ linebreak: "newline" }), mtext(textChild("[9pt]After"))]
    });
    expect(interruptedTrim.runs[0]).toMatchObject({ kind: "space" });
    if (interruptedTrim.runs[0]?.kind === "space" && interruptedTrim.runs[0].breakRef.kind === "mspace") {
      expect(interruptedTrim.runs[0].breakRef.lineLeading).toBeUndefined();
    }
  });
});
