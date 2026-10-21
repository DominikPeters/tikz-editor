/**
 * Structural comparison of compute results, reporting where they differ.
 * Functions are behaviour, not output, and are skipped; maps and sets compare
 * by their entries in order; shared or cyclic objects compare once per pair.
 */

export type DiffOptions = {
  /** Keys skipped wherever they occur. */
  ignoredKeys?: ReadonlySet<string>;
  /** Stop after this many differences. */
  limit?: number;
  /** Rewrites strings before comparing them. */
  normalizers?: { expected: (text: string) => string; actual: (text: string) => string };
};

export function diffValues(expected: unknown, actual: unknown, options: DiffOptions = {}): string[] {
  const differences: string[] = [];
  const limit = options.limit ?? 8;
  const ignored = options.ignoredKeys ?? new Set<string>();
  const visited = new WeakMap<object, WeakSet<object>>();

  const visit = (expectedValue: unknown, actualValue: unknown, path: string): void => {
    if (differences.length >= limit) return;
    let left = expectedValue;
    let right = actualValue;
    if (typeof left === "string" && typeof right === "string" && options.normalizers) {
      left = options.normalizers.expected(left);
      right = options.normalizers.actual(right);
    }
    if (Object.is(left, right)) return;
    if (typeof left === "function" && typeof right === "function") return;
    if (typeof left === "string" && typeof right === "string") {
      differences.push(`${path}: ${describeStringDifference(left, right)}`);
      return;
    }
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
      differences.push(`${path || "(root)"}: expected ${describe(left)}, got ${describe(right)}`);
      return;
    }
    const pairs = visited.get(left);
    if (pairs?.has(right)) return;
    if (pairs) pairs.add(right);
    else visited.set(left, new WeakSet([right]));

    // By name: the two sides may come from separate module instances.
    if (Array.isArray(left) !== Array.isArray(right) || left.constructor?.name !== right.constructor?.name) {
      differences.push(`${path || "(root)"}: expected ${describe(left)}, got ${describe(right)}`);
      return;
    }
    if (left instanceof Map && right instanceof Map) {
      visit([...left.entries()], [...right.entries()], `${path}<map>`);
      return;
    }
    if (left instanceof Set && right instanceof Set) {
      visit([...left], [...right], `${path}<set>`);
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) {
        differences.push(`${path}.length: expected ${left.length}, got ${right.length}`);
      }
      const length = Math.min(left.length, right.length);
      for (let index = 0; index < length; index += 1) visit(left[index], right[index], `${path}[${index}]`);
      return;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (ignored.has(key)) continue;
      const leftValue = (left as Record<string, unknown>)[key];
      const rightValue = (right as Record<string, unknown>)[key];
      // An absent key and an undefined one are the same output.
      if (leftValue === undefined && rightValue === undefined) continue;
      visit(leftValue, rightValue, `${path}.${key}`);
    }
  };

  visit(expected, actual, "");
  return differences;
}

/** The text around the first differing character of two strings. */
function describeStringDifference(expected: string, actual: string): string {
  if (expected.length <= 80 && actual.length <= 80) return `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  let at = 0;
  while (at < expected.length && expected[at] === actual[at]) at += 1;
  const start = Math.max(0, at - 30);
  const excerpt = (text: string) => JSON.stringify(text.slice(start, at + 50));
  return `differ at ${at} of ${expected.length}/${actual.length} chars: expected …${excerpt(expected)}…, got …${excerpt(actual)}…`;
}

function describe(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 80 ? `${JSON.stringify(value.slice(0, 80))}… (${value.length} chars)` : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value && typeof value === "object") return `${value.constructor?.name ?? "object"} {${Object.keys(value).slice(0, 4).join(", ")}…}`;
  return String(value);
}
