import type { Span } from "../ast/types.js";
import { TexWeightedLruCache } from "../text/tex/cache.js";

/** Recent source-bound parses, including their ASTs and synthetic source. */
export class ForeachSnippetParseCache<T> {
  private readonly entries: TexWeightedLruCache<string, T>;

  public constructor(maxEntries: number, maxBytes: number) {
    // A single large loop can be used by many targets/iterations. Keep it
    // reusable without also keeping the earlier large revisions of its body.
    this.entries = new TexWeightedLruCache(maxEntries, maxBytes, { retainOversizedEntry: true });
  }

  public getOrParse(raw: string, span: Span, parse: () => T): T {
    const key = `${span.from}:${span.to}:${raw}`;
    const cached = this.entries.get(key);
    if (cached !== undefined) return cached;
    const value = parse();
    // As with syntax indexes, account for objects per character as well as
    // strings. Estimating from source keeps cache misses free of AST walks.
    this.entries.set(key, value, key.length * 64 + 4096);
    return value;
  }
}
