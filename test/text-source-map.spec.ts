import { describe, expect, it } from "vitest";

import {
  concatMappedText,
  createGeneratedMappedText,
  createIdentityMappedText,
  createMappedText,
  mapTransformedTextWithFallback,
  projectInputOffset,
  projectInputRange,
  sliceMappedText,
  translateTextSourceMap,
  type TextSourceProjection
} from "../packages/core/src/text/source-map.js";

describe("text source maps", () => {
  it("translates optional projection metadata while preserving its absence", () => {
    const translated = translateTextSourceMap({
      inputText: "abcd",
      charOrigins: [
        { kind: "macro-argument", from: 1, to: 2, invocation: { from: 0, to: 3 } },
        { kind: "macro-generated", invocation: { from: 0, to: 3 }, definition: { from: 10, to: 12 } },
        { kind: "generated", reason: "padding" },
        { kind: "generated", reason: "padding", owner: { from: 4, to: 5 } }
      ],
      boundaryOrigins: [
        { kind: "range", from: 1, to: 2, policy: "select" },
        { kind: "range", from: 2, to: 3, policy: "macro", projection: {
          kind: "macro-argument", from: 2, to: 3, invocation: { from: 0, to: 3 }, definition: { from: 10, to: 12 }
        } },
        { kind: "offset", offset: 3 },
        { kind: "offset", offset: 4 },
        { kind: "offset", offset: 5 }
      ]
    }, 20);

    expect(translated.charOrigins).toStrictEqual([
      { kind: "macro-argument", from: 21, to: 22, invocation: { from: 20, to: 23 } },
      { kind: "macro-generated", invocation: { from: 20, to: 23 }, definition: { from: 30, to: 32 } },
      { kind: "generated", reason: "padding" },
      { kind: "generated", reason: "padding", owner: { from: 24, to: 25 } }
    ]);
    expect(translated.boundaryOrigins).toStrictEqual([
      { kind: "range", from: 21, to: 22, policy: "select" },
      { kind: "range", from: 22, to: 23, policy: "macro", projection: {
        kind: "macro-argument", from: 22, to: 23, invocation: { from: 20, to: 23 }, definition: { from: 30, to: 32 }
      } },
      { kind: "offset", offset: 23 },
      { kind: "offset", offset: 24 },
      { kind: "offset", offset: 25 }
    ]);
  });

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

  it("preserves direct coordinates around localized text normalization", () => {
    const source = "Alpha \\\\[4pt] Beta";
    const mapped = createIdentityMappedText(source, 50);
    const transformed = mapTransformedTextWithFallback(
      mapped,
      "Alpha\\\\[4pt]Beta",
      "line-break normalization"
    );

    expect(projectInputRange(transformed.sourceMap, 0, 5)).toEqual({
      kind: "source-range",
      from: 50,
      to: 55,
      policy: "caret"
    });
    expect(projectInputRange(
      transformed.sourceMap,
      transformed.text.indexOf("Beta"),
      transformed.text.length
    )).toEqual({
      kind: "source-range",
      from: 50 + source.indexOf("Beta"),
      to: 50 + source.length,
      policy: "caret"
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
