import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  evaluatePgfMathText,
  parsePgfMathFunctionDeclarations,
  type PgfMathMode
} from "../packages/core/src/semantic/pgfmath/evaluator.js";
import { createPgfRandom } from "../packages/core/src/semantic/pgfmath/rng.js";

/**
 * Compares the evaluator with `\pgfmathparse` results captured from LuaLaTeX
 * by `scripts/capture-pgfmath-oracle.mjs` (PGF 3.1.10, fixed-point engine and
 * fpu library). A TeX error ("! ..." in the log) must be an evaluator error;
 * a TeX number must match within the family tolerance below, with the same
 * "units declared" flag; TeX text (strings, arrays, base conversions) must
 * match exactly.
 */

type OracleOutcome = { result: string | null; units: boolean; errors: string[] };
type OracleCase = {
  expr: string;
  family: string;
  setup?: { seed?: number; trig?: "deg" | "rad"; functions?: string };
  fixed: OracleOutcome | null;
  float: OracleOutcome | null;
};

const oracle = JSON.parse(
  readFileSync(new URL("./fixtures/pgfmath/oracle.json", import.meta.url), "utf8")
) as { pgfVersion: string; cases: OracleCase[] };

type Tolerance = { abs: number; rel: number } | ((expr: string) => { abs: number; rel: number });

/** 2^-16 pt: TeX's resolution. */
const SP = 1 / 65536;

/**
 * Fixed mode: our doubles against PGF's TeX-dimension algorithms. Each bound
 * is PGF's own error, derived from its algorithm and confirmed by the data.
 */
const FIXED_TOLERANCE: Record<string, Tolerance> = {
  // Integer arithmetic, comparisons, logic, rounding, min/max, gcd, factorial:
  // PGF computes these exactly on the inputs given (all chosen away from sp
  // rounding boundaries), so any difference is a semantic bug.
  exact: { abs: 1e-9, rel: 0 },
  declare: { abs: 1e-9, rel: 1e-9 },
  text: { abs: 0, rel: 0 },
  // Every operand is rounded to sp (<= 0.5sp = 7.6e-6) and the result prints
  // with 5 decimals; products scale an operand's rounding by the other
  // factor, hence the relative term.
  literal: { abs: 2e-5, rel: 0 },
  linear: { abs: 2e-5, rel: 0 },
  units: { abs: 4e-5, rel: 1e-5 },
  constant: { abs: 4e-5, rel: 1e-5 },
  precedence: { abs: 4e-5, rel: 1e-5 },
  // The generator is exact; TeX stores rnd() in sp (0.24053 prints as 0.24052).
  random: { abs: SP, rel: 0 },
  product: { abs: 2e-5, rel: 3e-5 },
  // `divide` builds 5 decimals digit by digit; divisors below 1 go through
  // `reciprocal` (1/0.3 = 3.33337), so the quotient is good to ~1.2e-5 relative.
  quotient: { abs: 3e-5, rel: 3e-5 },
  // `pow` with an integer exponent multiplies by squaring on sp values; a
  // negative exponent starts from `reciprocal`, accurate to ~1.3e-4 relative.
  "power-int": { abs: 2e-5, rel: 2e-4 },
  // Other exponents use exp(y*ln x): the ln and exp errors below compound.
  power: { abs: 2e-4, rel: 2e-4 },
  // sin/cos interpolate a one-degree table linearly: (pi/180)^2/8 = 3.8e-5,
  // plus sp rounding of the table entries and the result.
  trig: { abs: 7e-5, rel: 0 },
  "trig-rad": { abs: 7e-5, rel: 2e-5 },
  // tan, cot, sec, cosec divide those sines and cosines.
  "trig-ratio": { abs: 1e-4, rel: 1e-4 },
  // asin/acos/atan come from PGF's lookup and interpolation in degrees.
  "inverse-trig": { abs: 1e-3, rel: 0 },
  // deg/rad multiply by a 5-decimal factor; pi enters as 3.14159.
  "trig-convert": { abs: 4e-5, rel: 1e-5 },
  // exp sums its series in sp until the terms vanish (about one sp lost per
  // term) and takes the reciprocal for negative arguments.
  exp: { abs: 2e-4, rel: 1e-4 },
  hyperbolic: { abs: 4e-4, rel: 1e-4 },
  // ln maps x by powers of two in TeX integer arithmetic and applies a
  // quintic fit; below 1 the sp quantization of the scaled argument makes the
  // error grow like 1/x (ln 0.001 is off by 0.03). log2/log10 scale ln.
  log: (expr) => {
    const argument = Number(/\(([^)]*)\)/u.exec(expr)?.[1] ?? "1");
    const scale = expr.startsWith("log2") ? 1 / Math.LN2 : expr.startsWith("log10") ? 1 / Math.LN10 : 1;
    return { abs: scale * (3e-4 + (5 * SP) / argument), rel: 0 };
  },
  // Digit-by-digit square root to 5 decimals.
  sqrt: { abs: 2e-5, rel: 1e-5 },
  // veclen scales its operands down by up to 1500 and applies a 4th-order fit
  // of sqrt(1+t^2): 0.16% at veclen(8000,8000).
  veclen: { abs: 1e-4, rel: 2e-3 },
  error: { abs: 1e-4, rel: 1e-4 }
};

/**
 * Float mode against the fpu library. fpu keeps a decimal mantissa, but in PGF
 * 3.1.10 it divides mantissas with TeX dimension arithmetic (5 significant
 * digits: 1000/7 = 142.85) and evaluates trig with the fixed-point routines
 * after reducing the angle, so only addition and multiplication reach the
 * 1e-5 relative bound.
 */
const FLOAT_TOLERANCE: Record<string, Tolerance> = {
  exact: { abs: 1e-9, rel: 1e-6 },
  declare: { abs: 1e-9, rel: 1e-6 },
  text: { abs: 0, rel: 0 },
  literal: { abs: 1e-5, rel: 1e-5 },
  linear: { abs: 1e-5, rel: 1e-5 },
  units: { abs: 4e-5, rel: 1e-5 },
  constant: { abs: 1e-5, rel: 1e-5 },
  precedence: { abs: 1e-5, rel: 1e-5 },
  // The generator is exact; TeX stores rnd() in sp (0.24053 prints as 0.24052).
  random: { abs: SP, rel: 0 },
  product: { abs: 1e-5, rel: 1e-5 },
  quotient: { abs: 1e-5, rel: 1e-4 },
  "power-int": { abs: 1e-5, rel: 1e-4 },
  power: { abs: 1e-5, rel: 2e-4 },
  trig: { abs: 7e-5, rel: 0 },
  "trig-rad": { abs: 7e-5, rel: 1e-5 },
  "trig-ratio": { abs: 1.5e-4, rel: 1e-4 },
  "inverse-trig": { abs: 1e-3, rel: 0 },
  "trig-convert": { abs: 1e-5, rel: 1e-5 },
  exp: { abs: 1e-5, rel: 3e-4 },
  hyperbolic: { abs: 2e-4, rel: 1e-4 },
  log: { abs: 1e-4, rel: 3e-4 },
  sqrt: { abs: 1e-5, rel: 3e-5 },
  veclen: { abs: 3e-5, rel: 3e-5 },
  error: { abs: 1e-4, rel: 3e-4 }
};

/** Cases left out, with the reason. Keyed by `${mode}:${expr}`. */
const EXCLUDED: Record<string, string> = {
  "fixed:rnd()": "PGF returns an empty result for `rnd()`; the editor keeps its lenient reading as `rnd`.",
  "fixed:rand()": "PGF returns an empty result for `rand()`; the editor keeps its lenient reading as `rand`.",
  "fixed:pi()": "PGF returns an empty result for `pi()`; the editor reads it as `pi`.",
  "fixed:(1+2": "PGF silently accepts the missing ')'; the editor reports a syntax error.",
  "float:(1+2": "fpu silently accepts the missing ')'; the editor reports a syntax error.",
  "float:1 ? 2": "fpu returns the condition for a ternary without ':'; the editor reports a syntax error.",
  "fixed:({1,2,3}[2])^2":
    "PGF reports 'Array index out of bounds' for an index inside parentheses (a parser quirk); the editor indexes normally.",
  "float:dim({5})": "fpu happens to survive a one-element array; the editor rejects all arrays in float mode."
};

function evaluateCase(entry: OracleCase, mode: PgfMathMode) {
  const declared = entry.setup?.functions ? parsePgfMathFunctionDeclarations(entry.setup.functions) : null;
  return evaluatePgfMathText(entry.expr, {
    mode,
    // LuaLaTeX's Latin Modern: 1em = 10pt, 1ex = 4.31pt.
    unitFactors: { em: 10, ex: 4.31 },
    ...(entry.setup?.seed != null ? { rng: createPgfRandom(entry.setup.seed) } : {}),
    ...(entry.setup?.trig ? { trigFormat: entry.setup.trig } : {}),
    ...(declared ? { functions: new Map(declared.map((definition) => [definition.name, definition])) } : {})
  });
}

function parseTexNumber(text: string): number | null {
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)$/u.test(text)) return Number(text);
  if (text === "nan") return Number.NaN;
  if (text === "inf") return Number.POSITIVE_INFINITY;
  if (text === "-inf") return Number.NEGATIVE_INFINITY;
  return null;
}

function compare(entry: OracleCase, mode: PgfMathMode): string | null {
  const tex = entry[mode];
  if (!tex) return null;
  const result = evaluateCase(entry, mode);
  if (tex.errors.length > 0) {
    return result.ok ? `TeX error "${tex.errors[0] ?? ""}" but evaluator gave ${result.text}` : null;
  }
  if (!result.ok) {
    return `TeX gave ${tex.result ?? ""} but evaluator failed: ${result.code} ${result.message}`;
  }
  const texText = tex.result ?? "";
  const expected = parseTexNumber(texText);
  if (expected == null) {
    return result.text === texText ? null : `TeX text "${texText}" but evaluator gave "${result.text}"`;
  }
  const got = typeof result.value === "number" ? result.value : (result.quantity?.value ?? Number.NaN);
  if (!Number.isFinite(expected)) {
    return Object.is(got, expected) || (Number.isNaN(expected) && Number.isNaN(got)) ? null : `TeX ${texText} but evaluator gave ${got}`;
  }
  const table = mode === "fixed" ? FIXED_TOLERANCE : FLOAT_TOLERANCE;
  const spec = table[entry.family];
  if (!spec) return `no tolerance for family ${entry.family}`;
  const { abs, rel } = typeof spec === "function" ? spec(entry.expr) : spec;
  const allowed = abs + rel * Math.abs(expected);
  if (!(Math.abs(got - expected) <= allowed)) {
    return `TeX ${texText} but evaluator gave ${got} (|diff| ${Math.abs(got - expected).toExponential(2)} > ${allowed.toExponential(2)})`;
  }
  const units = result.quantity?.kind === "length";
  if (units !== tex.units) {
    return `units declared: TeX ${String(tex.units)}, evaluator ${String(units)}`;
  }
  return null;
}

describe("pgfmath against TeX (oracle)", () => {
  it("has a large captured table from PGF 3.1.10", () => {
    expect(oracle.pgfVersion).toBe("3.1.10");
    expect(oracle.cases.length).toBeGreaterThanOrEqual(800);
  });

  for (const mode of ["fixed", "float"] as const) {
    it(`matches TeX in ${mode} mode`, () => {
      const failures: string[] = [];
      let compared = 0;
      let texErrors = 0;
      for (const entry of oracle.cases) {
        if (!entry[mode]) continue;
        if (EXCLUDED[`${mode}:${entry.expr}`]) continue;
        compared += 1;
        if ((entry[mode]?.errors.length ?? 0) > 0) texErrors += 1;
        const failure = compare(entry, mode);
        if (failure) failures.push(`${entry.family} ${JSON.stringify(entry.expr)}: ${failure}`);
      }
      expect(failures).toEqual([]);
      expect(compared).toBeGreaterThanOrEqual(800);
      expect(texErrors).toBeGreaterThan(40);
    });
  }

  it("lists only exclusions that exist in the table", () => {
    const keys = new Set(oracle.cases.flatMap((entry) => [`fixed:${entry.expr}`, `float:${entry.expr}`]));
    for (const key of Object.keys(EXCLUDED)) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});
