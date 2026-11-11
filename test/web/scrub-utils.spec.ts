import { describe, expect, it } from "vitest";
import {
  SCRUB_ACTIVATION_DELTA_PX,
  computeScrubbedValue,
  formatScrubNumber,
  pixelsPerStepForModifiers,
  shouldStartScrub
} from "../../packages/app/src/scrub-utils";

describe("scrub-utils", () => {
  it("uses the shared activation threshold", () => {
    expect(shouldStartScrub(SCRUB_ACTIVATION_DELTA_PX - 1)).toBe(false);
    expect(shouldStartScrub(SCRUB_ACTIVATION_DELTA_PX)).toBe(true);
    expect(shouldStartScrub(-SCRUB_ACTIVATION_DELTA_PX)).toBe(true);
  });

  it("applies modifier-based sensitivity", () => {
    expect(pixelsPerStepForModifiers({ shiftKey: false, altKey: false })).toBe(8);
    expect(pixelsPerStepForModifiers({ shiftKey: true, altKey: false })).toBe(32);
    expect(pixelsPerStepForModifiers({ shiftKey: false, altKey: true })).toBe(2);
    expect(pixelsPerStepForModifiers({ shiftKey: true, altKey: true })).toBe(8);
  });

  it("computes scrubbed values with rounding and clamping", () => {
    expect(
      computeScrubbedValue({
        startX: 100,
        currentX: 116,
        startValue: 1,
        step: 0.1,
        modifiers: { shiftKey: false, altKey: false }
      })
    ).toBeCloseTo(1.2, 6);

    expect(
      computeScrubbedValue({
        startX: 100,
        currentX: 400,
        startValue: 0.5,
        step: 0.1,
        min: 0,
        max: 1,
        modifiers: { shiftKey: false, altKey: false }
      })
    ).toBe(1);
  });

  it("scrubs on the step's grid without float noise", () => {
    const scrub = (startValue: number, steps: number, step = 0.1) => computeScrubbedValue({
      startX: 0, currentX: steps * 8, startValue, step, modifiers: { shiftKey: false, altKey: false }
    });
    expect(scrub(0.1, 2)).toBe(0.3);
    expect(scrub(0.37, 1)).toBe(0.4);
    expect(scrub(0.37, 2)).toBe(0.5);
    expect(scrub(0.37, -1)).toBe(0.3);
    expect(scrub(0.37, 0)).toBe(0.37);
    expect(scrub(2.5, 3, 1)).toBe(5);
    expect(scrub(1.2, -3, 0.25)).toBe(0.5);
  });

  it("formats scrubbed values while preserving display precision", () => {
    expect(formatScrubNumber(1.2, 3, 2)).toBe("1.20");
    expect(formatScrubNumber(1.234, 3, 0)).toBe("1.234");
    expect(formatScrubNumber(1.2, 3, 0)).toBe("1.2");
  });
});
