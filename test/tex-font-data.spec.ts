import { describe, expect, it } from "vitest";
import { COMPUTER_MODERN_OT1_FONTS } from "../packages/core/src/text/tex/fonts/data/computer-modern-ot1.generated.js";

describe("generated TeX font data", () => {
  it("provides all common TFM parameters required by the font model", () => {
    const parameters = ["slant", "space", "stretch", "shrink", "xheight", "quad"] as const;
    for (const [fontId, font] of Object.entries(COMPUTER_MODERN_OT1_FONTS)) {
      for (const parameter of parameters) {
        expect(Number.isFinite(font.fontdimen[parameter]), `${fontId}.${parameter}`).toBe(true);
      }
    }
  });
});
