/**
 * pgfmath evaluator.
 *
 * Precision model
 * ---------------
 * PGF's default engine computes in TeX dimensions: every intermediate is a
 * multiple of 1sp = 2^-16 pt within ±16383.99998, and each function has its
 * own fixed-point algorithm (interpolated sine table, series for exp, a
 * polynomial for ln, digit-by-digit sqrt, ...), good to about 4-5 decimals.
 * The `fpu` library, which pgfplots uses for plot expressions, keeps a
 * decimal mantissa of about 7 significant digits with no range limit, and
 * returns `nan`/`inf` instead of raising errors.
 *
 * This evaluator computes in IEEE doubles in both modes and does not round to
 * scaled points, so its results are at least as accurate as PGF's and differ
 * from TeX's output by PGF's own approximation error (the tolerances are
 * documented in `test/pgfmath-oracle.spec.ts`). The modes differ in what TeX
 * treats as an error and in a few discrete rules:
 *
 * - `fixed` (default, what TikZ uses): a value (literal, intermediate or
 *   result) reaching ±16384 is where TeX stops with "Dimension too large".
 *   The editor does not stop: it keeps computing in doubles, so the picture
 *   shows what the user meant, and flags the evaluation with the `overflow`
 *   warning (`warnings: ["overflow"]` on the result, and the runtime's
 *   `onWarning`), which the semantic evaluator reports once per statement as
 *   `pgfmath-dimension-too-large`. Only a value that cannot be drawn (±∞) is
 *   still the `overflow` error. Division by zero and domain errors raise
 *   errors, comparisons and truth tests use values rounded to sp (`\ifdim`),
 *   and a whole expression made only of digits and periods is returned as
 *   written (PGF's number fast path).
 * - `float` (the `fpu` library): no range limit; division by zero, `sqrt` and
 *   `ln` of out-of-domain values give ±Infinity/NaN like fpu's `inf`/`nan`;
 *   `mod` truncates both operands first as fpu does; degree trig is exact at
 *   multiples of 30 and 90 degrees; equality allows double rounding noise.
 *
 * In both modes the semantics are PGF's: degrees for trig unless
 * `trig format=rad`, `mod` takes the sign of the dividend, `round` rounds
 * half away from zero, `div` truncates, lengths are converted to pt and only
 * set the "units declared" flag (`\ifpgfmathunitsdeclared`), and so on.
 *
 * Parsing is cached per source text; `compilePgfMathExpression` exposes the
 * compiled closure for repeated evaluation with variable bindings.
 */
import { getCurrentPgfMathRuntime, type PgfMathScope, type PgfMathTrigFormat } from "./runtime.js";
import type { PgfRandom } from "./rng.js";
import { PT_PER_CM } from "../../coords/source.js";
import {
  builtinArity,
  compilePgfMathNode,
  formatPgfMathValue,
  num,
  PgfMathRuntimeError,
  type PgfMathCompiled,
  type PgfMathDeclaredFunction,
  type PgfMathEvalState,
  type PgfMathTextMeasurer,
  type PgfMathValue
} from "./compile.js";
import { parsePgfMathSource, PgfMathSyntaxError, type PgfMathArity } from "./parser.js";
import { pgfMathFunctionsSignature } from "./declarations.js";

export type { PgfMathDeclaredFunction, PgfMathTextMeasurer, PgfMathValue } from "./compile.js";
export type { PgfMathScope, PgfMathTrigFormat } from "./runtime.js";
export { parsePgfMathFunctionDeclarations } from "./declarations.js";

export type PgfMathQuantity = {
  kind: "scalar" | "length";
  value: number;
};

export type PgfMathEvalErrorCode =
  | "empty"
  | "token"
  | "unexpected-token"
  | "unsupported-syntax"
  | "division-by-zero"
  | "invalid-arity"
  | "invalid-domain"
  | "invalid-index"
  | "overflow"
  | "unknown-function"
  | "unsupported-random"
  | "unsupported-text-measure"
  | "non-numeric-result"
  | "invalid-operation";

/** What TeX would reject although the editor computes a value (see the mode notes above). */
export type PgfMathEvalWarning = "overflow";

export type PgfMathEvalResult =
  | { ok: true; quantity: PgfMathQuantity; warnings?: PgfMathEvalWarning[] }
  | { ok: false; code: PgfMathEvalErrorCode; message: string };
export type PgfMathEvalFailure = Extract<PgfMathEvalResult, { ok: false }>;

/** `fixed`: PGF's TeX-dimension engine (TikZ). `float`: the fpu library (pgfplots). */
export type PgfMathMode = "fixed" | "float";

const UNIT_FACTORS: Record<string, number> = {
  pt: 1,
  bp: 72.27 / 72,
  px: 72.27 / 72,
  cm: PT_PER_CM,
  mm: 2.84527559055,
  in: 72.27,
  pc: 12,
  dd: 1238 / 1157,
  cc: (12 * 1238) / 1157,
  nd: 685 / 642,
  nc: (12 * 685) / 642,
  sp: 1 / 65536,
  ex: 4.3,
  em: 10
};

export type EvaluatePgfMathOptions = {
  rng?: PgfRandom;
  /**
   * Context-dependent TeX units, expressed in pt. In TeX, `em` and `ex`
   * depend on the current font, so callers that know that font should
   * override the process-wide fallback values here.
   */
  unitFactors?: Readonly<Partial<Record<"em" | "ex", number>>>;
  /** Defaults to `fixed`. */
  mode?: PgfMathMode;
  /** Defaults to the active runtime scope, else `deg`. */
  trigFormat?: PgfMathTrigFormat;
  /** Functions from `declare function`; defaults to the active runtime scope. */
  functions?: ReadonlyMap<string, PgfMathDeclaredFunction>;
  /** Text measuring for `width`, `height` and `depth`. */
  measureText?: PgfMathTextMeasurer;
};

export type PgfMathTextResult =
  | { ok: true; text: string; value: PgfMathValue; quantity: PgfMathQuantity | null; warnings?: PgfMathEvalWarning[] }
  | PgfMathEvalFailure;

/** Evaluate to a number (a length in pt when units were declared). */
export function evaluatePgfMathExpression(input: string, options: EvaluatePgfMathOptions = {}): PgfMathEvalResult {
  const evaluated = evaluateValue(input, options);
  if (evaluated.ok === false) {
    return evaluated;
  }
  return withWarnings(toQuantityResult(evaluated.value, evaluated.units, evaluated.float), evaluated.warnings);
}

/** Evaluate to `\pgfmathresult` text; strings and arrays are allowed. */
export function evaluatePgfMathText(input: string, options: EvaluatePgfMathOptions = {}): PgfMathTextResult {
  const evaluated = evaluateValue(input, options);
  if (evaluated.ok === false) {
    return evaluated;
  }
  const quantity = toQuantityResult(evaluated.value, evaluated.units, evaluated.float);
  return {
    ok: true,
    text: formatPgfMathValue(evaluated.value, formatPgfMathNumber),
    value: evaluated.value,
    quantity: quantity.ok ? quantity.quantity : null,
    ...(evaluated.warnings ? { warnings: evaluated.warnings } : {})
  };
}

export function convertQuantityToLength(quantity: PgfMathQuantity, defaultUnit: "cm" | "pt"): number | null {
  if (quantity.kind === "length") {
    return quantity.value;
  }
  const factor = UNIT_FACTORS[defaultUnit.toLowerCase()];
  if (factor == null) {
    return null;
  }
  return quantity.value * factor;
}

export function formatPgfMathNumber(value: number): string {
  if (Number.isFinite(value) === false) {
    return "0";
  }
  if (Math.abs(value) <= 1e-12) {
    return "0";
  }
  if (Math.abs(value - Math.round(value)) <= 1e-9) {
    return String(Math.round(value));
  }
  return value
    .toFixed(12)
    .replace(/\.?0+$/, "")
    .replace(/^-0$/, "0");
}

// ---------------------------------------------------------------------------
// Compiled expressions

export type PgfMathBindings = Readonly<Record<string, number | PgfMathValue>> | readonly (number | PgfMathValue)[];

export type PgfMathCompileEnvironment = {
  mode?: PgfMathMode;
  trigFormat?: PgfMathTrigFormat;
  functions?: ReadonlyMap<string, PgfMathDeclaredFunction>;
  /**
   * Names bound at each evaluation, in positional order: identifiers such as
   * `x` (pgfplots' pseudo-constants) or macros such as `\x`. A macro is
   * inserted as text in TeX, so a negative `\x` in `\x^2` gives -(x^2).
   */
  variables?: readonly string[];
  /** Macros expanded as text before parsing, e.g. `{ "\\r": "2*3" }`. */
  macros?: Readonly<Record<string, string>>;
  unitFactors?: Readonly<Partial<Record<"em" | "ex", number>>>;
  rng?: PgfRandom;
  measureText?: PgfMathTextMeasurer;
};

export type CompiledPgfMathExpression = {
  /**
   * Evaluate with bindings by name or by position; a number (NaN/±Infinity
   * only in float mode) or a failure. An `overflow` warning goes to the
   * runtime's `onWarning`; `evaluate` also returns it.
   */
  (bindings?: PgfMathBindings): number | PgfMathEvalFailure;
  readonly variables: readonly string[];
  readonly mode: PgfMathMode;
  /** Evaluate to a full result, including whether units were declared. */
  evaluate(bindings?: PgfMathBindings): PgfMathEvalResult;
};

export type PgfMathCompileResult = { ok: true; fn: CompiledPgfMathExpression } | PgfMathEvalFailure;

/** Parse once; evaluate many times with different variable bindings. */
export function compilePgfMathExpression(source: string, env: PgfMathCompileEnvironment = {}): PgfMathCompileResult {
  const variables = [...(env.variables ?? [])];
  const expanded = env.macros ? expandMacrosAsText(source, env.macros, new Set(variables)) : source;
  const normalized = normalizeQuantityInput(expanded);
  const float = env.mode === "float";
  const compiled = compileCached(normalized, {
    float,
    rad: env.trigFormat === "rad",
    functions: env.functions,
    unitFactors: env.unitFactors,
    variables
  });
  if (compiled.ok === false) {
    return compiled;
  }
  const program = compiled.program;
  const state: PgfMathEvalState = {
    vars: Array.from({ length: variables.length }, (): PgfMathValue => 0),
    units: false,
    rng: env.rng,
    measure: env.measureText,
    depth: 0
  };
  const bind = (bindings: PgfMathBindings | undefined): void => {
    const vars = state.vars;
    if (bindings == null) {
      return;
    }
    if (isPositionalBindings(bindings)) {
      for (let index = 0; index < vars.length; index += 1) {
        vars[index] = bindings[index] ?? 0;
      }
      return;
    }
    for (let index = 0; index < vars.length; index += 1) {
      vars[index] = bindings[variables[index] ?? ""] ?? 0;
    }
  };
  const run = (bindings: PgfMathBindings | undefined): PgfMathValue | PgfMathEvalFailure => {
    bind(bindings);
    state.units = false;
    state.depth = 0;
    state.overflow = false;
    try {
      const value = program(state);
      if (overflowed(state)) reportWarning("overflow", normalized);
      return value;
    } catch (error) {
      return toFailure(error);
    }
  };
  const call = (bindings?: PgfMathBindings): number | PgfMathEvalFailure => {
    const value = run(bindings);
    if (typeof value === "number") {
      return float || Number.isFinite(value) ? value : nonFinite();
    }
    if (isFailure(value)) {
      return value;
    }
    const quantity = toQuantityResult(value, false, float);
    return quantity.ok ? quantity.quantity.value : quantity;
  };
  const fn: CompiledPgfMathExpression = Object.assign(call, {
    variables,
    mode: float ? ("float" as const) : ("fixed" as const),
    evaluate: (bindings?: PgfMathBindings): PgfMathEvalResult => {
      const value = run(bindings);
      if (isFailure(value)) {
        return value;
      }
      return withWarnings(toQuantityResult(value, state.units, float), overflowed(state) ? ["overflow"] : undefined);
    }
  });
  return { ok: true, fn };
}

// ---------------------------------------------------------------------------
// Internals

type CompileKey = {
  float: boolean;
  rad: boolean;
  functions: ReadonlyMap<string, PgfMathDeclaredFunction> | undefined;
  unitFactors: EvaluatePgfMathOptions["unitFactors"];
  variables: readonly string[];
  /** Declared-function parameters under fpu are values, not inserted text. */
  paramValues?: boolean;
};

type CacheEntry = { ok: true; program: PgfMathCompiled } | PgfMathEvalFailure;

const PROGRAM_CACHE = new Map<string, CacheEntry>();
const PROGRAM_CACHE_LIMIT = 4096;
const SIGNATURES = new WeakMap<ReadonlyMap<string, PgfMathDeclaredFunction>, string>();

function functionsSignature(functions: ReadonlyMap<string, PgfMathDeclaredFunction> | undefined): string {
  if (!functions || functions.size === 0) {
    return "";
  }
  let signature = SIGNATURES.get(functions);
  if (signature === undefined) {
    signature = pgfMathFunctionsSignature(functions);
    SIGNATURES.set(functions, signature);
  }
  return signature;
}

function compileCached(source: string, key: CompileKey): CacheEntry {
  const em = key.unitFactors?.em;
  const ex = key.unitFactors?.ex;
  const cacheKey = `${key.float ? "f" : "x"}${key.rad ? "r" : "d"}${key.paramValues === true ? "v" : "t"}|${em ?? ""}|${ex ?? ""}|${key.variables.join(",")}|${functionsSignature(key.functions)}|${source}`;
  const cached = PROGRAM_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }
  const entry = compileUncached(source, key, new Set(key.variables.filter((name) => name.startsWith("\\"))));
  if (PROGRAM_CACHE.size >= PROGRAM_CACHE_LIMIT) {
    const oldest = PROGRAM_CACHE.keys().next().value;
    if (oldest !== undefined) PROGRAM_CACHE.delete(oldest);
  }
  PROGRAM_CACHE.set(cacheKey, entry);
  return entry;
}

function compileUncached(source: string, key: CompileKey, macros: ReadonlySet<string>): CacheEntry {
  const slots = new Map<string, number>();
  key.variables.forEach((name, index) => slots.set(name, index));
  const functions = key.functions;
  const arityOf = (name: string): PgfMathArity | null => {
    if (slots.has(name)) return 0;
    const declared = functions?.get(name);
    if (declared) return declared.params.length;
    return builtinArity(name);
  };
  try {
    const ast = parsePgfMathSource(source, {
      arityOf,
      isMacro: (name) => macros.has(name),
      emptyCallAfterConstant: !key.float
    });
    const unitFactor = (unit: string): number | undefined =>
      (unit === "em" || unit === "ex" ? key.unitFactors?.[unit] : undefined) ?? UNIT_FACTORS[unit];
    const program = compilePgfMathNode(ast, {
      float: key.float,
      rad: key.rad,
      functions,
      slots,
      unitFactor,
      textualMacros: key.paramValues !== true,
      compileFunction: (definition) => compileDeclaredFunction(definition, key)
    });
    return { ok: true, program };
  } catch (error) {
    return toFailure(error);
  }
}

function compileDeclaredFunction(definition: PgfMathDeclaredFunction, key: CompileKey): PgfMathCompiled {
  const entry = compileCached(normalizeQuantityInput(definition.body), {
    ...key,
    variables: definition.params,
    paramValues: key.float
  });
  if (entry.ok === false) {
    const failure = entry;
    return () => {
      throw new PgfMathRuntimeError(
        failure.code === "unknown-function" ? "unknown-function" : "invalid-operation",
        `In function '${definition.name}': ${failure.message}`
      );
    };
  }
  return entry.program;
}

type ValueResult = { ok: true; value: PgfMathValue; units: boolean; float: boolean; warnings?: PgfMathEvalWarning[] } | PgfMathEvalFailure;

function evaluateValue(input: string, options: EvaluatePgfMathOptions): ValueResult {
  const float = options.mode === "float";
  // PGF's fast path: only digits and periods come back exactly as written.
  if (/^[0-9.]+$/u.test(input)) {
    const value = Number(input);
    if (Number.isFinite(value)) {
      return { ok: true, value, units: false, float };
    }
  }
  const normalizedInput = normalizeQuantityInput(input);
  if (normalizedInput.length === 0) {
    return { ok: false, code: "empty", message: "Expression is empty." };
  }
  const runtime = getCurrentPgfMathRuntime();
  const scope: PgfMathScope | null =
    options.functions !== undefined && options.trigFormat !== undefined ? null : (runtime?.scope?.() ?? null);
  const compiled = compileCached(normalizedInput, {
    float,
    rad: (options.trigFormat ?? scope?.trigFormat) === "rad",
    functions: options.functions ?? scope?.functions,
    unitFactors: options.unitFactors,
    variables: []
  });
  if (compiled.ok === false) {
    return compiled;
  }
  const state: PgfMathEvalState = {
    vars: [],
    units: false,
    rng: options.rng ?? runtime?.rng,
    measure: options.measureText ?? runtime?.measureText,
    depth: 0
  };
  try {
    const value = compiled.program(state);
    if (overflowed(state)) {
      reportWarning("overflow", normalizedInput);
      return { ok: true, value, units: state.units, float, warnings: ["overflow"] };
    }
    return { ok: true, value, units: state.units, float };
  } catch (error) {
    return toFailure(error);
  }
}

/** Whether the evaluation passed TeX's fixed-point range (set by the compiled program). */
function overflowed(state: PgfMathEvalState): boolean {
  return state.overflow === true;
}

function reportWarning(warning: PgfMathEvalWarning, expression: string): void {
  getCurrentPgfMathRuntime()?.onWarning?.(warning, expression.trim());
}

function withWarnings(result: PgfMathEvalResult, warnings: PgfMathEvalWarning[] | undefined): PgfMathEvalResult {
  return result.ok && warnings ? { ...result, warnings } : result;
}

function toQuantityResult(value: PgfMathValue, units: boolean, float: boolean): PgfMathEvalResult {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else {
    try {
      numeric = num(value);
    } catch {
      return {
        ok: false,
        code: "non-numeric-result",
        message: `Expression evaluated to text '${formatPgfMathValue(value, formatPgfMathNumber)}', not a number.`
      };
    }
  }
  if (!float && Number.isFinite(numeric) === false) {
    return nonFinite();
  }
  return { ok: true, quantity: { kind: units ? "length" : "scalar", value: numeric } };
}

function nonFinite(): PgfMathEvalFailure {
  return { ok: false, code: "invalid-domain", message: "Expression evaluated to a non-finite value." };
}

function isPositionalBindings(bindings: PgfMathBindings): bindings is readonly (number | PgfMathValue)[] {
  return Array.isArray(bindings);
}

function isFailure(value: unknown): value is PgfMathEvalFailure {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { ok?: unknown }).ok === false;
}

function toFailure(error: unknown): PgfMathEvalFailure {
  if (error instanceof PgfMathSyntaxError || error instanceof PgfMathRuntimeError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof RangeError) {
    return { ok: false, code: "invalid-operation", message: "Expression is nested too deeply." };
  }
  throw error;
}

function expandMacrosAsText(
  source: string,
  macros: Readonly<Record<string, string>>,
  keep: ReadonlySet<string>
): string {
  let current = source;
  for (let pass = 0; pass < 16; pass += 1) {
    const next = current.replace(/\\(?:[A-Za-z@]+|.)/gu, (name) => (keep.has(name) ? undefined : macros[name]) ?? name);
    if (next === current) {
      break;
    }
    current = next;
  }
  return current;
}

function normalizeQuantityInput(input: string): string {
  let normalized = input.trim();
  while (normalized.length >= 2 && normalized.startsWith("{") && normalized.endsWith("}")) {
    const unwrapped = unwrapSingleOuterBracePair(normalized);
    if (unwrapped == null) {
      break;
    }
    normalized = unwrapped.trim();
  }
  return normalized;
}

function unwrapSingleOuterBracePair(raw: string): string | null {
  if (!(raw.startsWith("{") && raw.endsWith("}"))) {
    return null;
  }

  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return null;
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  if (depth !== 0) {
    return null;
  }
  return raw.slice(1, -1);
}
