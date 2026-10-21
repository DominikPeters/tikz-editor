import { describe, expect, it, vi } from "vitest";
import { encodeOt1Text } from "../packages/core/src/text/tex/encoding/ot1.js";

describe("OT1 source-cluster encoding", () => {
  it("keeps ASCII spans without Unicode normalization", () => {
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      const text = "office AV -- 42";
      expect(encodeOt1Text(text, 20)).toEqual(
        [...text].map((char, index) => ({
          code: char.charCodeAt(0),
          sourceStart: 20 + index,
          sourceEnd: 21 + index,
        }))
      );
      expect(normalize).not.toHaveBeenCalled();
    } finally {
      normalize.mockRestore();
    }
  });

  it("retains combining clusters, nonbreaking spaces, and UTF-16 spans", () => {
    expect(encodeOt1Text("Ae\u0301\u00a0😀Z", 10)).toEqual([
      { code: 65, sourceStart: 10, sourceEnd: 11 },
      { code: 233, sourceStart: 11, sourceEnd: 13 },
      { code: 32, sourceStart: 13, sourceEnd: 14 },
      { code: 0x1f600, sourceStart: 14, sourceEnd: 16 },
      { code: 90, sourceStart: 16, sourceEnd: 17 },
    ]);
  });

  it("applies a synthesized source end only to a single complete cluster", () => {
    expect(encodeOt1Text("A", 10, 30)).toEqual([
      { code: 65, sourceStart: 10, sourceEnd: 30 },
    ]);
    expect(encodeOt1Text("e\u0301", 10, 30)).toEqual([
      { code: 233, sourceStart: 10, sourceEnd: 30 },
    ]);
    expect(encodeOt1Text("AB", 10, 30)).toEqual([
      { code: 65, sourceStart: 10, sourceEnd: 11 },
      { code: 66, sourceStart: 11, sourceEnd: 12 },
    ]);
    expect(() => encodeOt1Text("\t")).toThrow("Unsupported OT1 character U+9");
  });
});
