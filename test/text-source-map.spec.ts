import { describe, expect, it } from "vitest";

import {
  concatMappedText,
  createGeneratedMappedText,
  createIdentityMappedText,
  createMappedText,
  projectInputOffset,
  projectInputRange,
  sliceMappedText,
  type TextSourceProjection
} from "../packages/core/src/text/source-map.js";

describe("text source maps", () => {
  it("creates identity maps in absolute source coordinates", () => {
    const mapped = createIdentityMappedText("Alpha", 10);

    expect(mapped.text).toBe("Alpha");
    expect(mapped.sourceMap.inputText).toBe("Alpha");
    expect(mapped.sourceMap.charOrigins[0]).toEqual({ kind: "direct", from: 10, to: 11 });
    expect(mapped.sourceMap.charOrigins[4]).toEqual({ kind: "direct", from: 14, to: 15 });
    expect(projectInputOffset(mapped.sourceMap, 2)).toEqual({ kind: "source-offset", offset: 12 });
    expect(projectInputRange(mapped.sourceMap, 1, 4)).toEqual({
      kind: "source-range",
      from: 11,
      to: 14,
      policy: "caret"
    });
  });

  it("preserves source mapping through slices and concatenation", () => {
    const mapped = createIdentityMappedText("abcdef", 100);
    const result = concatMappedText([
      sliceMappedText(mapped, 1, 3),
      sliceMappedText(mapped, 4, 6)
    ]);

    expect(result.text).toBe("bcef");
    expect(projectInputRange(result.sourceMap, 0, 2)).toEqual({
      kind: "source-range",
      from: 101,
      to: 103,
      policy: "caret"
    });
    expect(projectInputRange(result.sourceMap, 2, 4)).toEqual({
      kind: "source-range",
      from: 104,
      to: 106,
      policy: "caret"
    });
    expect(projectInputOffset(result.sourceMap, 2)).toEqual({
      kind: "source-range",
      from: 103,
      to: 104,
      policy: "select"
    });
  });

  it("maps generated text back to its owning range", () => {
    const mapped = createGeneratedMappedText("default", "optional macro default", { from: 20, to: 29 });

    expect(projectInputRange(mapped.sourceMap, 0, mapped.text.length)).toEqual({
      kind: "source-range",
      from: 20,
      to: 29,
      policy: "generated",
      reason: "optional macro default"
    });
    expect(projectInputOffset(mapped.sourceMap, 3)).toEqual({
      kind: "source-range",
      from: 20,
      to: 29,
      policy: "generated",
      reason: "optional macro default"
    });
  });

  it("maps macro-generated text to the invocation range", () => {
    const origin: TextSourceProjection = {
      kind: "macro-generated",
      invocation: { from: 40, to: 49 },
      macroName: "\\wrap"
    };
    const mapped = createMappedText(
      String.raw`\textbf{`,
      Array.from({ length: 8 }, () => origin)
    );

    expect(projectInputRange(mapped.sourceMap, 0, mapped.text.length)).toEqual({
      kind: "source-range",
      from: 40,
      to: 49,
      policy: "macro",
      macroName: "\\wrap"
    });
  });
});
