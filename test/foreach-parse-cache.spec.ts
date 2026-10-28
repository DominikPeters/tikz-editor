import { describe, expect, it, vi } from "vitest";
import { ForeachSnippetParseCache } from "../packages/core/src/foreach/snippet-parse-cache.js";

describe("foreach snippet parse cache", () => {
  it("keys cached parses by both source text and mapped source span", () => {
    const cache = new ForeachSnippetParseCache<object>(16, 100000);
    const parse = vi.fn(() => ({}));
    const first = cache.getOrParse("body", { from: 10, to: 14 }, parse);
    expect(cache.getOrParse("body", { from: 10, to: 14 }, parse)).toBe(first);
    expect(cache.getOrParse("body", { from: 11, to: 15 }, parse)).not.toBe(first);
    expect(cache.getOrParse("edit", { from: 10, to: 14 }, parse)).not.toBe(first);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it("drops old large revisions before reaching the entry count limit", () => {
    const cache = new ForeachSnippetParseCache<object>(4096, 20000);
    const parse = () => ({});
    const span = { from: 0, to: 100 };
    const first = cache.getOrParse("a".repeat(100), span, parse);
    const recent = cache.getOrParse("b".repeat(100), span, parse);
    expect(cache.getOrParse("b".repeat(100), span, parse)).toBe(recent);
    expect(cache.getOrParse("a".repeat(100), span, parse)).not.toBe(first);
  });

  it("keeps a large active loop reusable without retaining earlier revisions", () => {
    const cache = new ForeachSnippetParseCache<object>(64, 10000);
    const parse = () => ({});
    const span = { from: 0, to: 300 };
    const first = cache.getOrParse("old", span, parse);
    const large = cache.getOrParse("x".repeat(300), span, parse);
    expect(cache.getOrParse("x".repeat(300), span, parse)).toBe(large);
    expect(cache.getOrParse("old", span, parse)).not.toBe(first);
  });
});
