import { describe, expect, it } from "vitest";
import { expandSelectionToMathDelimiters } from "../../packages/app/src/ui/canvas-panel/text-selection-ranges.js";

describe("canvas text selection ranges", () => {
  it("expands selections covering visible inline math to include source delimiters", () => {
    const text = String.raw`node $x=y$`;

    expect(expandSelectionToMathDelimiters(text, { start: 0, end: text.indexOf("$", text.indexOf("$") + 1) })).toEqual({
      start: 0,
      end: text.length,
    });
    expect(expandSelectionToMathDelimiters(text, { start: text.indexOf("x"), end: text.indexOf("y") + 1 })).toEqual({
      start: text.indexOf("$"),
      end: text.length,
    });
  });

  it("does not expand collapsed carets or partial inline math selections", () => {
    const text = String.raw`node $x=y$`;

    expect(expandSelectionToMathDelimiters(text, { start: text.indexOf("y"), end: text.indexOf("y") })).toEqual({
      start: text.indexOf("y"),
      end: text.indexOf("y"),
    });
    expect(expandSelectionToMathDelimiters(text, { start: text.indexOf("="), end: text.indexOf("y") + 1 })).toEqual({
      start: text.indexOf("="),
      end: text.indexOf("y") + 1,
    });
  });
});
