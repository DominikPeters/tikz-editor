import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import type { ArrowTip, ArrowTipKind } from "../packages/core/src/semantic/types.js";
import {
  buildArrowTipMetrics,
  computeArrowShortening,
  computeStealthShapeParameters,
  normalizeArrowTip
} from "../packages/core/src/svg/arrows/metrics.js";

function tip(kind: ArrowTipKind, overrides: Partial<ArrowTip> = {}): ArrowTip {
  return {
    kind,
    open: false,
    round: false,
    reversed: false,
    bend: false,
    afterLineEnd: false,
    color: null,
    fill: null,
    length: 8,
    width: 5,
    inset: null,
    sep: 0,
    lineWidth: null,
    arc: null,
    rayCount: null,
    ...overrides
  };
}

describe("SVG arrow metrics", () => {
  it("normalizes malformed tip dimensions and fallback paint inputs", () => {
    const normalized = normalizeArrowTip(
      tip("stealth", {
        afterLineEnd: undefined,
        color: null,
        length: -1,
        width: 0,
        sep: -4,
        lineWidth: Number.NaN
      }),
      Number.NaN,
      "orange"
    );

    expect(normalized.afterLineEnd).toBe(false);
    expect(normalized.length).toBe(0.01);
    expect(normalized.width).toBe(0.01);
    expect(normalized.sep).toBe(0);
    expect(normalized.contextLineWidth).toBe(0.4);
    expect(normalized.lineWidth).toBeCloseTo(0.0016875, 8);
    expect(normalized.color).toBe("orange");
  });

  it("computes shortening plans for mixed before-line and after-line tips", () => {
    const before = normalizeArrowTip(tip("latex", { length: 6, sep: 1 }), 0.4, "black");
    const after = normalizeArrowTip(tip("stealth", { afterLineEnd: true, length: 5, sep: 2 }), 0.4, "black");

    expect(computeArrowShortening("end", [], 0.4)).toEqual({
      lineEndShortening: 0,
      totalLength: 0,
      plans: []
    });

    const shortening = computeArrowShortening("end", [before, after], 0.4);
    expect(shortening.lineEndShortening).toBeGreaterThan(0);
    expect(shortening.totalLength).toBeGreaterThan(shortening.lineEndShortening);
    expect(shortening.plans).toHaveLength(2);
    expect(shortening.plans.map((plan) => plan.index)).toEqual([0, 1]);
  });

  it("reverses metrics for representative arrow families", () => {
    const reversibleKinds: ArrowTipKind[] = [
      "latex",
      "stealth",
      "kite",
      "cm-rightarrow",
      "bar",
      "hooks",
      "tee-barb",
      "triangle",
      "square",
      "rays",
      "implies",
      "to"
    ];

    for (const kind of reversibleKinds) {
      const forward = normalizeArrowTip(tip(kind, { inset: kind === "tee-barb" ? 3 : null, rayCount: kind === "rays" ? 5 : null }), 0.5, "black");
      const reversed = normalizeArrowTip(
        tip(kind, { reversed: true, inset: kind === "tee-barb" ? 3 : null, rayCount: kind === "rays" ? 5 : null }),
        0.5,
        "black"
      );

      const forwardMetrics = buildArrowTipMetrics(forward, 0.5);
      const reversedMetrics = buildArrowTipMetrics(reversed, 0.5);
      expect(reversedMetrics.tipEnd).toBeCloseTo(-forwardMetrics.backEnd, 8);
      expect(reversedMetrics.backEnd).toBeCloseTo(-forwardMetrics.tipEnd, 8);
      if (["cm-rightarrow", "rays", "implies", "to"].includes(kind)) {
        expect(reversedMetrics.lineEnd).toBeCloseTo(-forwardMetrics.lineEnd, 8);
      }
    }
  });

  it("handles rounded Latex and zero-inset Stealth miter limits", () => {
    const roundedLatex = buildArrowTipMetrics(
      normalizeArrowTip(tip("latex", { round: true, lineWidth: 10 }), 0.4, "black"),
      0.4
    );
    expect(roundedLatex.tipEnd).toBeGreaterThan(0);

    const zeroInsetStealth = normalizeArrowTip(tip("stealth", { inset: 0, lineWidth: 2 }), 0.4, "black");
    const params = computeStealthShapeParameters(zeroInsetStealth);
    expect(params.backMiter).toBeCloseTo(params.lineWidth / 2, 8);
  });

  // PGF pgfarrowtotallength, explicit length=8pt/width=5pt, shaft=.4pt.
  it.each([
    ["Triangle", "", 8, 7.9], ["Bar", "", 8, 4.09999], ["Hooks", "", 8, 7.90001],
    ["Straight Barb", "", 8.8705, 0.8705], ["Arc Barb", "", 8, 0.2],
    ["Tee Barb", "", 8, 4.09999], ["Kite", "", 8, 7.7439],
    ["Square", "", 8, 7.8], ["Circle", "", 8, 7.8],
    ["Round Cap", "", 8, 8.2], ["Butt Cap", "", 8, 8.2], ["Triangle Cap", "", 8, 8.2],
    ["Square", ",reversed", 8, 7.8], ["Circle", ",reversed", 8, 7.8],
    ["Kite", ",reversed", 8, 7.48001], ["Triangle", ",reversed", 8, 7.2295],
    ["Straight Barb", ",reversed", 8.8705, 8.2], ["Hooks", ",reversed", 8, 0.2],
    ["Tee Barb", ",reversed", 8, 4.09999],
    ["Hooks", ",arc=60", 6.955, 6.85501], ["Hooks", ",arc=240", 14.955, 7.90001],
    ["Arc Barb", ",arc=120", 4.2, 0.2], ["Arc Barb", ",arc=240", 12, 0.2],
    ["Latex", ",round", 7.21942, 7.01942], ["Stealth", ",round", 6.99908, 4.74097],
    ["Latex", ",line width=0pt", 8, 8], ["Stealth", ",line width=0pt", 8, 5.40002],
    ["Square", ",line width=0pt", 8, 8],
    ["Kite", ",round", 7.72002, 7.4239], ["Kite", ",round,reversed", 7.72002, 7.52002]
  ] as const)("matches PGF setup for %s%s", (name, options, totalLength, shortening) => {
    const source = String.raw`\begin{tikzpicture}\draw[-{${name}[length=8pt,width=5pt,line width=.4pt${options}]}] (0,0)--(20pt,0);\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const semantic = evaluateTikzFigure(parsed.figure, source);
    expect([...parsed.diagnostics, ...semantic.diagnostics]).toEqual([]);
    const path = semantic.scene.elements.find(element => element.kind === "Path");
    if (path?.kind !== "Path" || !path.style.markerEnd?.tips[0]) throw new Error("Missing arrow tip");
    const metrics = computeArrowShortening("end", [normalizeArrowTip(path.style.markerEnd.tips[0], 0.4, "black")], 0.4);
    expect(metrics.totalLength).toBeCloseTo(totalLength, 3);
    expect(metrics.lineEndShortening).toBeCloseTo(shortening, 3);
  });


  it("retains the signed reversed Butt Cap line-end distance", () => {
    const cap = normalizeArrowTip(tip("butt-cap", { reversed: true, lineWidth: 0.4 }), 4, "black");
    const metrics = computeArrowShortening("end", [cap], 4);
    expect(metrics.totalLength).toBe(8);
    expect(metrics.lineEndShortening).toBe(-2);
  });

});
