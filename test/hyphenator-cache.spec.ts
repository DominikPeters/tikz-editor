import { describe, expect, it } from "vitest";
import { createEnglishHyphenator } from "../packages/core/src/text/knuth-plass/paragraph/hyphenate.js";

function wordSuffix(value: number): string {
  let result = "";
  do {
    result += String.fromCharCode(97 + value % 26);
    value = Math.floor(value / 26);
  } while (value > 0);
  return result;
}

describe("hyphenation cache lifetime", () => {
  it("reuses recent words while dropping old words during sustained editing", () => {
    const hyphenator = createEnglishHyphenator({ leftMin: 2, rightMin: 3 });
    const cold = hyphenator.hyphenate("representation");
    const hot = hyphenator.hyphenate("hyphenation");
    for (let index = 0; index < 17000; index++) {
      hyphenator.hyphenate(`paragraph${wordSuffix(index)}`);
      if (index % 100 === 0) expect(hyphenator.hyphenate("hyphenation")).toBe(hot);
    }
    expect(hyphenator.hyphenate("representation")).not.toBe(cold);
    expect(hyphenator.hyphenate("representation")).toEqual(cold);
    expect(hyphenator.hyphenate("HYPHENATION")).toBe(hot);
  });

  it("bounds retained word bytes even below the word count limit", () => {
    const hyphenator = createEnglishHyphenator({ leftMin: 3, rightMin: 3 });
    const firstWord = `${"z".repeat(250000)}a`;
    const first = hyphenator.hyphenate(firstWord);
    const hot = hyphenator.hyphenate("hyphenation");
    for (let index = 1; index < 8; index++) {
      hyphenator.hyphenate(`${"z".repeat(250000)}${wordSuffix(index)}`);
      expect(hyphenator.hyphenate("hyphenation")).toBe(hot);
    }
    expect(hyphenator.hyphenate(firstWord)).not.toBe(first);
    expect(hyphenator.hyphenate(firstWord)).toEqual(first);
  });

  it("drops inactive minima profiles while preserving a recently used profile", () => {
    const first = createEnglishHyphenator({ leftMin: 2000 });
    const hot = createEnglishHyphenator({ leftMin: 2001 });
    for (let index = 2002; index < 2020; index++) {
      createEnglishHyphenator({ leftMin: index });
      expect(createEnglishHyphenator({ leftMin: 2001 })).toBe(hot);
    }
    expect(createEnglishHyphenator({ leftMin: 2000 })).not.toBe(first);
    // Callers can still use a profile after its reusable cache entry expires.
    expect(first.hyphenate("hyphenation")).toEqual([]);
  });
});
