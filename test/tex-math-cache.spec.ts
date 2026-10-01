import { describe, expect, it } from "vitest";
import { createTexDerivedInlineMathBoxProvider } from "../packages/core/src/text/tex/math/inline-provider.js";
import { texLength } from "../packages/core/src/text/tex/coordinates.js";

const params = (content: string, offset = 0) => ({
  source: content, content, delimiter: "equation" as const, sourceStart: offset, sourceEnd: offset + content.length,
  contentStart: offset, contentEnd: offset + content.length, targetWidth: texLength(120),
});
const label = (start: number, text = "1") => ({ text, sourceSpan: { start, end: start + 8 }, textSourceSpan: { start: start + 3, end: start + 4 } });

describe("math layout and source projection caches", () => {
  it("snapshots caller-owned tag spans without freezing or retaining them", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const mutableLabel = label(10);
    const first = provider.getDisplayMathBox!({ ...params("x"), displayLabel: mutableLabel });
    mutableLabel.sourceSpan.start = 100;
    mutableLabel.sourceSpan.end = 108;
    mutableLabel.textSourceSpan.start = 103;
    mutableLabel.textSourceSpan.end = 104;
    const changed = { ...params("x"), displayLabel: mutableLabel };
    expect(provider.getDisplayMathBox!(changed)).toEqual(createTexDerivedInlineMathBoxProvider().getDisplayMathBox!(changed));
    expect(first?.hlist?.items.some((item) => item.sourceSpan.start === 10)).toBe(true);
    expect(first?.hlist?.items.some((item) => item.sourceSpan.start === 100)).toBe(false);
    expect(Object.isFrozen(mutableLabel.sourceSpan)).toBe(false);
  });

  it("observes changed equation tag spans and outer source metadata", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const original = { ...params("x"), displayLabel: label(10) };
    const first = provider.getDisplayMathBox!(original);
    const changed = { ...original, source: "updated source", sourceEnd: 50, displayLabel: label(100) };
    const second = provider.getDisplayMathBox!(changed);
    const fresh = createTexDerivedInlineMathBoxProvider().getDisplayMathBox!(changed);
    expect(second).not.toBe(first);
    expect(second).toEqual(fresh);
    expect(second?.sourceEnd).toBe(50);
    expect(second?.hlist?.items.some((item) => item.sourceSpan.start === 100)).toBe(true);
    expect(provider.getDisplayMathBox!(changed)).toBe(second);
  });

  it("separates embedded colons in tag text and math content", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    const first = provider.getDisplayMathBox!({ ...params("b:c"), displayLabel: label(20, "a") });
    const secondParams = { ...params("c"), displayLabel: label(20, "a:b") };
    const second = provider.getDisplayMathBox!(secondParams);
    expect(second).not.toBe(first);
    expect(second).toEqual(createTexDerivedInlineMathBoxProvider().getDisplayMathBox!(secondParams));
  });

  it.each([
    String.raw`\frac{x_1}{\sqrt{y^2}}+\text{office}`,
    String.raw`\left(\begin{matrix}a&b\\c&d\end{matrix}\right)`,
    String.raw`a=b\tag{A}`,
    String.raw`a=b\notag`,
  ])("projects reused nested layout exactly for %s", (content) => {
    const provider = createTexDerivedInlineMathBoxProvider();
    for (const offset of [0, 30, 500, 1000, 0]) {
      const current = { ...params(content, offset), displayLabel: label(offset + content.length + 5) };
      expect(provider.getDisplayMathBox!(current))
        .toEqual(createTexDerivedInlineMathBoxProvider().getDisplayMathBox!(current));
    }
  });

  it("shares immutable source-relative layout separately from labels and target widths", () => {
    const provider = createTexDerivedInlineMathBoxProvider();
    for (const width of [80, 90]) provider.getDisplayMathBox!({ ...params("x^2"), targetWidth: texLength(width) });
    const third = provider.getDisplayMathBox!({ ...params("x^2"), targetWidth: texLength(100) });
    const fourth = provider.getDisplayMathBox!({ ...params("x^2"), targetWidth: texLength(110) });
    expect(third).not.toBeNull();
    expect(third?.hlist).toBe(fourth?.hlist);
    expect(Object.isFrozen(third?.hlist)).toBe(true);
    expect(Object.isFrozen(third?.hlist?.items[0].sourceSpan)).toBe(true);
  });
});
