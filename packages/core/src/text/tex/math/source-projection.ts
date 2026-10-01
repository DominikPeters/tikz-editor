import type { TexMathSourceSpan } from "./ir.js";

/** Copy an owned math IR/hlist graph, translating only source-span fields. */
export function translateTexMathSourceGraph<T extends object>(value: T, offset: number): T {
  const copies = new WeakMap<object, object>();
  const copy = (current: unknown): unknown => {
    if (!current || typeof current !== "object") return current;
    const existing = copies.get(current);
    if (existing) return existing;
    if (Array.isArray(current)) {
      const result: unknown[] = [];
      copies.set(current, result);
      for (const child of current) result.push(copy(child));
      return result;
    }
    const result: Record<string, unknown> = {};
    copies.set(current, result);
    for (const [key, child] of Object.entries(current)) {
      if ((key === "sourceSpan" || key.endsWith("SourceSpan")) && child) {
        const span = child as TexMathSourceSpan;
        result[key] = { start: span.start + offset, end: span.end + offset };
      } else {
        result[key] = copy(child);
      }
    }
    return result;
  };
  return copy(value) as T;
}
