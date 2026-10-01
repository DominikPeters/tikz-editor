import { describe, expect, it } from "vitest";
import { TexWeightedLruCache } from "../packages/core/src/text/tex/cache.js";

describe("bounded TeX LRU cache", () => {
  it("releases owned metadata on eviction, replacement, and explicit deletion", () => {
    const released: [string, number][] = [];
    const cache = new TexWeightedLruCache<string, number>(2, 100, {
      onEvict: (key, value) => released.push([key, value]),
    });
    cache.set("a", 1, 10);
    cache.set("b", 2, 10);
    cache.set("a", 3, 10);
    expect([...cache.values()]).toEqual([2, 3]);
    cache.set("c", 4, 10);
    cache.delete("a");
    expect(released).toEqual([["a", 1], ["b", 2], ["a", 3]]);
    expect([...cache.values()]).toEqual([4]);
  });

  it("can retain one oversized render while evicting its other entries", () => {
    const cache = new TexWeightedLruCache<string, number>(10, 100, { retainOversizedEntry: true });
    cache.set("small", 1, 10);
    expect(cache.set("large", 2, 200)).toBe(true);
    expect(cache.get("small")).toBeUndefined();
    expect(cache.get("large")).toBe(2);
    cache.set("next", 3, 10);
    expect(cache.get("large")).toBeUndefined();
    expect([...cache.values()]).toEqual([3]);
  });

  it("retains recently read entries and evicts by count", () => {
    const cache = new TexWeightedLruCache<string, number>(2, 100);
    cache.set("a", 1, 10);
    cache.set("b", 2, 10);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3, 10);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  it("evicts by memory budget and accounts for replacements", () => {
    const cache = new TexWeightedLruCache<string, number>(10, 100);
    cache.set("a", 1, 60);
    cache.set("b", 2, 30);
    cache.set("a", 3, 70);
    cache.set("c", 4, 10);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(3);
    expect(cache.get("c")).toBe(4);
    cache.set("a", 5, 101);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(4);
  });

  it("matches a reference LRU across mixed reads, replacements, and evictions", () => {
    const cache = new TexWeightedLruCache<number, number>(7, 100);
    const reference = new Map<number, { value: number; bytes: number }>();
    let seed = 834523;
    const random = () => {
      seed = Math.imul(seed, 1664525) + 1013904223;
      return seed >>> 0;
    };
    for (let index = 0; index < 2000; index++) {
      const key = random() % 17;
      if (random() % 3 === 0) {
        const entry = reference.get(key);
        if (entry) {
          reference.delete(key);
          reference.set(key, entry);
        }
        expect(cache.get(key)).toBe(entry?.value);
      } else {
        const bytes = random() % 121;
        reference.delete(key);
        if (bytes <= 100) reference.set(key, { value: index, bytes });
        while (reference.size > 7 || [...reference.values()].reduce((sum, entry) => sum + entry.bytes, 0) > 100) {
          reference.delete(reference.keys().next().value!);
        }
        cache.set(key, index, bytes);
      }
    }
  });
});
