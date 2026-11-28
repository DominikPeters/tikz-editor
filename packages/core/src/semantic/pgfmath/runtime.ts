import type { PgfRandom } from "./rng.js";
import type { PgfMathDeclaredFunction, PgfMathTextMeasurer } from "./compile.js";

export type PgfMathTrigFormat = "deg" | "rad";

/** What the enclosing TeX groups set: `declare function` and `/pgf/trig format`. */
export type PgfMathScope = {
  functions?: ReadonlyMap<string, PgfMathDeclaredFunction>;
  trigFormat?: PgfMathTrigFormat;
};

export type PgfMathRuntime = {
  rng: PgfRandom;
  /** Read at each evaluation, so it follows the current scope. */
  scope?: () => PgfMathScope | null;
  measureText?: PgfMathTextMeasurer;
  /**
   * Called when an evaluation computed a value TeX would reject (fixed mode
   * past ±16384: "Dimension too large"), with the expression. It may be
   * called many times per expression (once per plot sample).
   */
  onWarning?: (warning: "overflow", expression: string) => void;
};

let currentRuntime: PgfMathRuntime | null = null;

export function withPgfMathRuntime<T>(runtime: PgfMathRuntime | null, fn: () => T): T {
  const previous = currentRuntime;
  currentRuntime = runtime;
  try {
    return fn();
  } finally {
    currentRuntime = previous;
  }
}

export function getCurrentPgfMathRuntime(): PgfMathRuntime | null {
  return currentRuntime;
}
