import { describe, expect, it, vi } from "vitest";
import { breakWithDp } from "../packages/core/src/text/knuth-plass/paragraph/dp.js";
import { runsToItems } from "../packages/core/src/text/knuth-plass/paragraph/items.js";
import { createMeasurementService } from "../packages/core/src/text/knuth-plass/paragraph/measure.js";
import type { ParagraphRun } from "../packages/core/src/text/knuth-plass/paragraph/types.js";

describe("paragraph DP candidate traversal", () => {
  it.each([50, 200])("bounds text measurements for a %i-word paragraph", (wordCount) => {
    const wrapper = { textWidth: (text: string) => text.length };
    const runs: ParagraphRun[] = [];
    for (let wordIndex = 0; wordIndex < wordCount; wordIndex++) {
      const sourceStart = wordIndex * 5;
      runs.push({
        kind: "text",
        text: "word",
        wrapper,
        childIndex: 0,
        wordIndex,
        runIndex: runs.length,
        sourceStart,
        sourceEnd: sourceStart + 4,
      });
      if (wordIndex < wordCount - 1) {
        runs.push({
          kind: "space",
          text: " ",
          wrapper,
          breakRef: { kind: "mspace", wrapper },
          texGlue: { width: 1, stretch: 0, shrink: 0 },
          runIndex: runs.length,
          sourceStart: sourceStart + 4,
          sourceEnd: sourceStart + 5,
        });
      }
    }
    const measurement = createMeasurementService();
    const measureSlice = vi.fn((_text: string, start: number, end: number) => end - start);
    measurement.measureSlice = measureSlice;
    const model = runsToItems(runs, measurement, {
      enableAutomaticHyphenation: false,
    });

    const result = breakWithDp(model, 10, {
      rightskipStretch: Infinity,
      preventOverflow: true,
    });

    expect(result.canProceed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.mode).toBe("feasible");
    expect(result.lines).toHaveLength(wordCount / 2);
    expect(result.lines.map((line) => [line.startRun, line.endRun, line.width])).toEqual(
      Array.from({ length: wordCount / 2 }, (_, index) => [index * 4, index * 4 + 2, 9])
    );
    expect(result.totalCost).toBe(100 * wordCount / 2);
    // Overfull states expire after a few words. Rebuilding their entire
    // remaining suffix at each breakpoint makes this count quadratic.
    expect(measureSlice.mock.calls.length).toBeLessThan(wordCount * 4);
  });
});
