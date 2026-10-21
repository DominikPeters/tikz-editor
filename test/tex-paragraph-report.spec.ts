import { describe, expect, it } from "vitest";
import { buildTexParagraphReport } from "../packages/core/src/text/tex/paragraph-report.js";
import { computerModernTexMetricProvider } from "../packages/core/src/text/tex/fonts/computer-modern.js";
import { texLength } from "../packages/core/src/text/tex/coordinates.js";

describe("TeX paragraph report assembly", () => {
  it("normalizes a math box once per report without retaining stale boxes", () => {
    let widthReads = 0;
    let height = 3;
    const box = {
      source: "$xy$",
      content: "xy",
      sourceStart: 0,
      sourceEnd: 4,
      contentStart: 1,
      contentEnd: 3,
      get width() { widthReads += 1; return 12; },
      get height() { return height; },
      depth: 2,
      caretStops: [0, 12],
      svgBody: "<g />",
    };
    const build = () => buildTexParagraphReport({
      paragraphId: "tex:report-reuse",
      width: texLength(20),
      alignment: "ragged-right",
      runs: [{
        kind: "math",
        runIndex: 0,
        sourceStart: 0,
        sourceEnd: 4,
        wrapper: { texMathBox: box },
      }],
      lines: [{
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 0,
        endTextOffset: null,
        width: 12,
        break: null,
      }],
      shapedRuns: new Map(),
      runWidths: new Map([[0, texLength(12)]]),
      lineLabels: new Map(),
      linebreakingMode: "feasible",
      layoutMode: "wrap",
      font: computerModernTexMetricProvider.resolveFont(),
      metricProvider: computerModernTexMetricProvider,
      errors: [],
    });

    expect(build().report.lines[0].ascent).toBe(3);
    expect(widthReads).toBe(1);
    height = 8;
    expect(build().report.lines[0].ascent).toBe(8);
    expect(widthReads).toBe(2);
  });
});
