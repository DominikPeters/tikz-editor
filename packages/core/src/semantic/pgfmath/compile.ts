/**
 * pgfmath AST -> closures. See `evaluator.ts` for the precision model.
 *
 * Function semantics follow PGF 3.1.10's `pgfmathfunctions.*.code.tex`
 * (fixed mode) and `pgflibraryfpu.code.tex` (float mode).
 */
import type { PgfRandom } from "./rng.js";
import {
  PGF_INFIX_PRECEDENCE,
  type PgfMathArity,
  type PgfMathBinaryOp,
  type PgfMathNode
} from "./parser.js";

export type PgfMathValue = number | string | readonly PgfMathValue[];

export type PgfMathRuntimeErrorCode =
  | "division-by-zero"
  | "invalid-arity"
  | "invalid-domain"
  | "invalid-operation"
  | "invalid-index"
  | "overflow"
  | "unknown-function"
  | "unsupported-random"
  | "unsupported-text-measure";

export class PgfMathRuntimeError extends Error {
  constructor(readonly code: PgfMathRuntimeErrorCode, message: string) {
    super(message);
  }
}

export type PgfMathTextMetrics = { width: number; height: number; depth: number };
/** Measures text as TeX boxes it (`\hbox{...}` in the current font), in pt. */
export type PgfMathTextMeasurer = (text: string) => PgfMathTextMetrics | null;

/** A function from `declare function={name(\a,\b)=body;}`. */
export type PgfMathDeclaredFunction = {
  name: string;
  /** Parameter macros, e.g. `["\\x"]`. */
  params: readonly string[];
  body: string;
};

/** Mutable evaluation state, PGF's globals for one `\pgfmathparse`. */
export type PgfMathEvalState = {
  vars: PgfMathValue[];
  /** `\ifpgfmathunitsdeclared`. */
  units: boolean;
  rng: PgfRandom | undefined;
  measure: PgfMathTextMeasurer | undefined;
  depth: number;
  /**
   * Set in fixed mode when a value reached ±16384: TeX stops there with
   * "Dimension too large"; the editor keeps the double and reports a warning.
   */
  overflow?: boolean;
};

export type PgfMathCompiled = (state: PgfMathEvalState) => PgfMathValue;

export type PgfMathCompileOptions = {
  float: boolean;
  rad: boolean;
  functions: ReadonlyMap<string, PgfMathDeclaredFunction> | undefined;
  /** Variable name (`x`, `\x`) -> slot in `state.vars`. */
  slots: ReadonlyMap<string, number>;
  unitFactor: (unit: string) => number | undefined;
  /**
   * Whether `\name` variables behave as inserted text (a negative value
   * before `^` reads `-v^n`). False for declared-function parameters in
   * float mode, where fpu passes arguments as encoded floats.
   */
  textualMacros: boolean;
  /** Compiles a declared function body; the evaluator caches these. */
  compileFunction: (definition: PgfMathDeclaredFunction) => PgfMathCompiled;
};

/**
 * Functions the fpu library (PGF 3.1.10) leaves unimplemented or breaks:
 * TeX stops with an error when an expression uses them in float mode.
 */
const FLOAT_UNSUPPORTED: ReadonlySet<string> = new Set([
  "frac", "Mod", "div", "gcd", "isprime", "iseven", "isodd", "real", "random", "reciprocal", "radians",
  "approxequalto", "array", "dim"
]);

const TEX_MAX_DIMEN = 16384;
const SP = 65536;
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

type Builtin = {
  arity: PgfMathArity;
  /** Unary numeric fast path. */
  unary?: (value: number, options: PgfMathCompileOptions) => number;
  call?: (args: PgfMathValue[], state: PgfMathEvalState, options: PgfMathCompileOptions) => PgfMathValue;
};

export function builtinArity(name: string): PgfMathArity | null {
  return BUILTINS.get(name)?.arity ?? null;
}

export function compilePgfMathNode(node: PgfMathNode, options: PgfMathCompileOptions): PgfMathCompiled {
  return new Compiler(options).compile(node, false);
}

class Compiler {
  constructor(private readonly o: PgfMathCompileOptions) {}

  compile(node: PgfMathNode, spineChild: boolean): PgfMathCompiled {
    // A macro bound to a negative number is inserted as text: `\x^2` reads
    // `-2^2`, which is -(2^2). Wrap the top of the run of tighter-binding
    // operators whose leftmost operand is that macro.
    if (!spineChild && this.o.textualMacros) {
      const slot = this.macroSpineSlot(node);
      if (slot != null) {
        const inner = this.compileSpine(node, slot);
        const neg = this.neg();
        return (state) => {
          const value = state.vars[slot];
          return typeof value === "number" && value < 0 ? neg(num(inner(state))) : inner(state);
        };
      }
    }
    return this.compileNode(node);
  }

  private compileNode(node: PgfMathNode): PgfMathCompiled {
    const o = this.o;
    switch (node.t) {
      case "num": {
        let value = node.v;
        if (node.unit != null) {
          const factor = o.unitFactor(node.unit);
          if (factor == null) {
            return () => {
              throw new PgfMathRuntimeError("invalid-domain", `Unsupported unit '${node.unit ?? ""}'.`);
            };
          }
          value *= factor;
        }
        const checked = o.float || Math.abs(value) < TEX_MAX_DIMEN;
        if (node.units) {
          return (state) => {
            state.units = true;
            if (!checked) state.overflow = true;
            return value;
          };
        }
        return checked
          ? () => value
          : (state) => {
              state.overflow = true;
              return value;
            };
      }
      case "str": {
        if (o.float) {
          return floatTextError;
        }
        const value = node.v;
        return () => value;
      }
      case "macro":
      case "ident": {
        const slot = o.slots.get(node.name);
        if (slot != null) {
          return (state) => state.vars[slot] ?? 0;
        }
        return this.compileCall(node.name, null);
      }
      case "call":
        return this.compileCall(node.name, node.arg);
      case "group": {
        if (node.items.length === 1) {
          return this.compile(requireItem(node.items[0]), false);
        }
        if (node.items.length === 0) {
          return () => "";
        }
        if (o.float) {
          return floatTextError;
        }
        const items = node.items.map((item) => this.compile(item, false));
        // A comma group outside a function call is PGF's collected list `{a}{b}`.
        return (state) => items.map((item) => item(state));
      }
      case "array": {
        if (o.float) {
          return floatTextError;
        }
        const items = node.items.map((item) => this.compile(item, false));
        return (state) => items.map((item) => item(state));
      }
      case "index": {
        const target = this.compile(node.target, false);
        const index = this.compile(node.index, false);
        return (state) => indexValue(target(state), index(state));
      }
      case "cond": {
        const condition = this.compile(node.c, false);
        const whenTrue = this.compile(node.a, false);
        const whenFalse = this.compile(node.b, false);
        const truthy = this.truthy();
        // PGF evaluates both branches before `ifthenelse` picks one.
        return (state) => {
          const c = truthy(num(condition(state)));
          const a = whenTrue(state);
          const b = whenFalse(state);
          return c ? a : b;
        };
      }
      case "un": {
        const operand = this.compile(node.a, node.op === "fact" || node.op === "deg");
        return this.unary(node.op, operand);
      }
      case "bin": {
        const tight = PGF_INFIX_PRECEDENCE[node.op] > 500;
        const left = this.compile(node.l, tight);
        const right = this.compile(node.r, false);
        return this.binary(node.op, left, right);
      }
    }
  }

  /** Compile a spine whose leftmost macro operand reads as its absolute value. */
  private compileSpine(node: PgfMathNode, slot: number): PgfMathCompiled {
    if (node.t === "macro") {
      return (state) => {
        const value = state.vars[slot];
        return typeof value === "number" ? Math.abs(value) : (value ?? 0);
      };
    }
    if (node.t === "bin") {
      return this.binary(node.op, this.compileSpine(node.l, slot), this.compile(node.r, false));
    }
    if (node.t === "un") {
      return this.unary(node.op, this.compileSpine(node.a, slot));
    }
    return this.compileNode(node);
  }

  private macroSpineSlot(node: PgfMathNode): number | null {
    let current = node;
    let depth = 0;
    for (;;) {
      if (current.t === "bin" && PGF_INFIX_PRECEDENCE[current.op] > 500) {
        current = current.l;
      } else if (current.t === "un" && (current.op === "fact" || current.op === "deg")) {
        current = current.a;
      } else {
        break;
      }
      depth += 1;
    }
    if (depth === 0 || current.t !== "macro") {
      return null;
    }
    return this.o.slots.get(current.name) ?? null;
  }

  private compileCall(name: string, arg: PgfMathNode | null): PgfMathCompiled {
    const o = this.o;
    const argFns = arg == null ? [] : this.compileArgs(arg);
    const declared = o.functions?.get(name);
    if (declared) {
      if (argFns.length !== declared.params.length) {
        return () => {
          throw new PgfMathRuntimeError(
            "invalid-arity",
            `Function '${name}' expects ${declared.params.length} argument(s).`
          );
        };
      }
      let body: PgfMathCompiled | null = null;
      return (state) => {
        const values = argFns.map((fn) => fn(state));
        body ??= o.compileFunction(declared);
        if (state.depth > 64) {
          throw new PgfMathRuntimeError("invalid-operation", `Function '${name}' recurses too deeply.`);
        }
        const saved = state.vars;
        state.vars = values;
        state.depth += 1;
        // The body is a nested \pgfmathparse: it resets the units flag.
        state.units = false;
        try {
          return body(state);
        } finally {
          state.vars = saved;
          state.depth -= 1;
        }
      };
    }
    const builtin = BUILTINS.get(name);
    if (o.float && FLOAT_UNSUPPORTED.has(name)) {
      return () => {
        throw new PgfMathRuntimeError("invalid-operation", `The fpu library does not implement '${name}'.`);
      };
    }
    if (!builtin) {
      return () => {
        throw new PgfMathRuntimeError("unknown-function", `Unknown function '${name}'.`);
      };
    }
    const arity = builtin.arity;
    if (arity !== "variadic" && argFns.length !== arity) {
      return () => {
        throw new PgfMathRuntimeError("invalid-arity", `${name}() expects ${arity} argument(s).`);
      };
    }
    const unary = builtin.unary;
    if (unary && argFns.length === 1) {
      const a = requireItem(argFns[0]);
      if (o.float) {
        return (state) => unary(num(a(state)), o);
      }
      return (state) => checkFixed(unary(num(a(state)), o), state);
    }
    const call = builtin.call;
    if (!call) {
      return () => {
        throw new PgfMathRuntimeError("unknown-function", `Unknown function '${name}'.`);
      };
    }
    if (argFns.length === 0) {
      return (state) => call([], state, o);
    }
    return (state) => {
      const values = argFns.map((fn) => fn(state));
      const result = call(values, state, o);
      return typeof result === "number" && !o.float ? checkFixed(result, state) : result;
    };
  }

  private compileArgs(arg: PgfMathNode): PgfMathCompiled[] {
    if (arg.t === "group") {
      if (arg.items.length === 0) {
        return [() => ""];
      }
      return arg.items.map((item) => this.compile(item, false));
    }
    return [this.compile(arg, false)];
  }

  private truthy(): (value: number) => boolean {
    return this.o.float ? (value) => value !== 0 : (value) => Math.round(value * SP) !== 0;
  }

  private neg(): (value: number) => number {
    return (value) => -value;
  }

  private unary(op: "neg" | "not" | "fact" | "deg", operand: PgfMathCompiled): PgfMathCompiled {
    const o = this.o;
    switch (op) {
      case "neg":
        return (state) => -num(operand(state));
      case "not": {
        const truthy = this.truthy();
        return (state) => (truthy(num(operand(state))) ? 0 : 1);
      }
      case "fact":
        return o.float
          ? (state) => factorial(num(operand(state)))
          : (state) => checkFixed(factorial(num(operand(state))), state);
      case "deg":
        return o.float ? (state) => num(operand(state)) * DEG : (state) => checkFixed(num(operand(state)) * DEG, state);
    }
  }

  private binary(op: PgfMathBinaryOp, left: PgfMathCompiled, right: PgfMathCompiled): PgfMathCompiled {
    const o = this.o;
    const float = o.float;
    switch (op) {
      case "+":
        return float
          ? (state) => num(left(state)) + num(right(state))
          : (state) => checkFixed(num(left(state)) + num(right(state)), state);
      case "-":
        return float
          ? (state) => num(left(state)) - num(right(state))
          : (state) => checkFixed(num(left(state)) - num(right(state)), state);
      case "*":
        return float
          ? (state) => num(left(state)) * num(right(state))
          : (state) => checkFixed(num(left(state)) * num(right(state)), state);
      case "/":
        return (state) => divide(num(left(state)), num(right(state)), float, state);
      case "^":
        return float
          ? (state) => powFloat(num(left(state)), num(right(state)))
          : (state) => checkFixed(powFixed(num(left(state)), num(right(state))), state);
      case "&&":
      case "||": {
        const truthy = this.truthy();
        const and = op === "&&";
        return (state) => {
          const a = truthy(num(left(state)));
          const b = truthy(num(right(state)));
          return (and ? a && b : a || b) ? 1 : 0;
        };
      }
      case "<":
      case ">":
      case "==":
      case "!=":
      case "<=":
      case ">=": {
        const compare = comparator(op, float);
        return (state) => (compare(num(left(state)), num(right(state))) ? 1 : 0);
      }
    }
  }
}

function floatTextError(): never {
  throw new PgfMathRuntimeError("invalid-operation", "The fpu library cannot hold text or arrays.");
}

function requireItem<T>(item: T | undefined): T {
  if (item === undefined) {
    throw new PgfMathRuntimeError("invalid-arity", "Missing argument.");
  }
  return item;
}

/**
 * Fixed mode's range check. TeX stops at ±16384 with "Dimension too large";
 * the editor keeps computing in doubles, flags the overflow on the state
 * (reported as a warning) and returns the value. Only a value that cannot be
 * drawn (±Infinity) is still the `overflow` error.
 */
function checkFixed(value: number, state: PgfMathEvalState): number {
  if (value < TEX_MAX_DIMEN && value > -TEX_MAX_DIMEN) {
    return value;
  }
  if (Number.isNaN(value)) {
    throw new PgfMathRuntimeError("invalid-domain", "Expression evaluated to a non-finite value.");
  }
  if (!Number.isFinite(value)) {
    throw new PgfMathRuntimeError("overflow", "Dimension too large (pgfmath fixed-point range is ±16383.99998).");
  }
  state.overflow = true;
  return value;
}

export function num(value: PgfMathValue | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
      return Number(trimmed);
    }
    throw new PgfMathRuntimeError("invalid-operation", `Cannot use '${value}' as a number.`);
  }
  throw new PgfMathRuntimeError("invalid-operation", "Cannot use an array as a number.");
}

function indexValue(target: PgfMathValue, index: PgfMathValue): PgfMathValue {
  if (!Array.isArray(target)) {
    throw new PgfMathRuntimeError("invalid-index", "Only arrays can be indexed.");
  }
  const position = Math.trunc(num(index));
  const item = (target as readonly PgfMathValue[])[position];
  if (position < 0 || item === undefined) {
    throw new PgfMathRuntimeError("invalid-index", "Array index out of bounds.");
  }
  return item;
}

type ComparisonOp = "<" | ">" | "==" | "!=" | "<=" | ">=";

function comparator(op: ComparisonOp, float: boolean): (a: number, b: number) => boolean {
  if (float) {
    switch (op) {
      case "<":
        return fpuLess;
      case ">":
        return (a, b) => fpuLess(b, a);
      case "==":
        return fpuEqual;
      case "!=":
        return (a, b) => !fpuEqual(a, b);
      case "<=":
        return (a, b) => !fpuLess(b, a);
      case ">=":
        return (a, b) => !fpuLess(a, b);
    }
  }
  // `\ifdim#1pt<#2pt`: TeX compares the values in scaled points.
  const q = (value: number): number => Math.round(value * SP);
  switch (op) {
    case "<":
      return (a, b) => q(a) < q(b);
    case ">":
      return (a, b) => q(a) > q(b);
    case "==":
      return (a, b) => q(a) === q(b);
    case "!=":
      return (a, b) => q(a) !== q(b);
    case "<=":
      return (a, b) => q(a) <= q(b);
    case ">=":
      return (a, b) => q(a) >= q(b);
  }
}

/** fpu `equal`: relative error below `/pgf/fpu/rel thresh` (1e-4); against 0 the absolute value. */
function fpuEqual(a: number, b: number): boolean {
  return (b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b)) < 1e-4;
}

/**
 * fpu `less`: by sign, then decimal exponent, then the mantissa in [1,10)
 * compared as a TeX dimension (`\ifdim`, so to 1sp).
 */
function fpuLess(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (a === b) return false;
  if (a === -Infinity || b === Infinity) return true;
  if (a === Infinity || b === -Infinity) return false;
  if (a === 0) return b > 0;
  if (a > 0) return b > 0 && fpuMagnitudeLess(a, b);
  return b >= 0 || fpuMagnitudeLess(-b, -a);
}

function fpuMagnitudeLess(a: number, b: number): boolean {
  const ea = Math.floor(Math.log10(a));
  const eb = Math.floor(Math.log10(b));
  if (ea !== eb) return ea < eb;
  return Math.round((a / 10 ** ea) * SP) < Math.round((b / 10 ** eb) * SP);
}

function divide(a: number, b: number, float: boolean, state: PgfMathEvalState): number {
  if (float) {
    return a / b;
  }
  if (Math.round(b * SP) === 0) {
    throw new PgfMathRuntimeError("division-by-zero", "Division by zero.");
  }
  return checkFixed(a / b, state);
}

/** `pgfmathpow@`: 0^y is 0 (1 for y=0); integer exponents multiply; others use exp(y ln x). */
function powFixed(a: number, b: number): number {
  if (a === 0) {
    return b === 0 ? 1 : 0;
  }
  if (Number.isInteger(b)) {
    return Math.pow(a, b);
  }
  if (a < 0) {
    throw new PgfMathRuntimeError("invalid-domain", "Cannot raise a negative number to a non-integer power.");
  }
  return Math.pow(a, b);
}

function powFloat(a: number, b: number): number {
  return Math.pow(a, b);
}

/** `\c@pgfmath@counta=#1`: TeX truncates toward zero; below 2 the product is 1. */
function factorial(value: number): number {
  const n = Math.trunc(value);
  let result = 1;
  for (let k = 2; k <= n; k += 1) {
    result *= k;
    if (!Number.isFinite(result)) {
      break;
    }
  }
  return result;
}

function sinDegExact(value: number): number {
  const reduced = value % 360;
  const r = reduced < 0 ? reduced + 360 : reduced;
  switch (r) {
    case 0:
    case 180:
      return 0;
    case 90:
      return 1;
    case 270:
      return -1;
    case 30:
    case 150:
      return 0.5;
    case 210:
    case 330:
      return -0.5;
    default:
      return Math.sin(r * RAD);
  }
}

function cosDegExact(value: number): number {
  return sinDegExact(value + 90);
}

function trigIn(value: number, o: PgfMathCompileOptions, fn: "sin" | "cos"): number {
  if (o.rad) {
    return fn === "sin" ? Math.sin(value) : Math.cos(value);
  }
  if (o.float) {
    return fn === "sin" ? sinDegExact(value) : cosDegExact(value);
  }
  return fn === "sin" ? Math.sin(value * RAD) : Math.cos(value * RAD);
}

function angleOut(radians: number, o: PgfMathCompileOptions): number {
  return o.rad ? radians : radians * DEG;
}

function reciprocal(value: number, o: PgfMathCompileOptions, what: string): number {
  if (!o.float && Math.round(value * SP) === 0) {
    throw new PgfMathRuntimeError("division-by-zero", `${what} is undefined here (division by zero).`);
  }
  return 1 / value;
}

function domain(ok: boolean, o: PgfMathCompileOptions, message: string): boolean {
  if (!ok && !o.float) {
    throw new PgfMathRuntimeError("invalid-domain", message);
  }
  return ok;
}

function roundHalfAway(value: number): number {
  const rounded = Math.floor(Math.abs(value) + 0.5);
  return value < 0 ? -rounded : rounded;
}

/** PGF's `mod`: truncated division, so the result has the sign of the dividend. */
function modFixed(a: number, b: number): number {
  if (Math.round(b * SP) === 0) {
    throw new PgfMathRuntimeError("division-by-zero", "mod() by zero.");
  }
  return a - Math.trunc(a / b) * b;
}

/** fpu's `mod`: the quotient comes from both operands truncated to integers. */
function modFloat(a: number, b: number): number {
  const divisor = Math.trunc(b);
  if (divisor === 0) {
    throw new PgfMathRuntimeError("division-by-zero", "mod() by a number whose integer part is zero.");
  }
  return a - Math.trunc(Math.trunc(a) / divisor) * b;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  if (x === 0) return Math.trunc(y);
  if (y === 0) return Math.trunc(x);
  while (y > 1e-9) {
    const t = x % y;
    x = y;
    y = t;
  }
  return Math.trunc(x);
}

function isPrime(value: number): number {
  const n = Math.abs(Math.trunc(value));
  if (n < 2) return 0;
  if (n < 4) return 1;
  if (n % 2 === 0) return 0;
  for (let d = 3; d * d <= n; d += 2) {
    if (n % d === 0) return 0;
  }
  return 1;
}

/** fpu reads the digits back as a decimal float, and fails on letters. */
function baseResult(text: string, o: PgfMathCompileOptions): PgfMathValue {
  if (!o.float) {
    return text;
  }
  if (!/^-?\d+$/u.test(text)) {
    throw new PgfMathRuntimeError("invalid-operation", `The fpu library cannot read '${text}' as a number.`);
  }
  return Number(text);
}

function toBase(value: number, base: number, upper: boolean): string {
  const n = Math.trunc(value);
  const text = Math.abs(n).toString(base);
  return (n < 0 ? "-" : "") + (upper ? text.toUpperCase() : text);
}

function measure(state: PgfMathEvalState, text: PgfMathValue, part: keyof PgfMathTextMetrics): number {
  if (!state.measure) {
    throw new PgfMathRuntimeError("unsupported-text-measure", "Measuring text needs a text engine.");
  }
  const metrics = state.measure(typeof text === "number" ? String(text) : typeof text === "string" ? text : "");
  if (!metrics) {
    throw new PgfMathRuntimeError("unsupported-text-measure", "Could not measure the text.");
  }
  return metrics[part];
}

function requireRng(state: PgfMathEvalState): PgfRandom {
  if (!state.rng) {
    throw new PgfMathRuntimeError("unsupported-random", "Random functions require an active pgfmath RNG runtime.");
  }
  return state.rng;
}

function arg(args: PgfMathValue[], index: number): number {
  return num(args[index]);
}

function truthyFor(o: PgfMathCompileOptions, value: number): boolean {
  return o.float ? value !== 0 : Math.round(value * SP) !== 0;
}

function compare2(op: ComparisonOp): Builtin {
  const fixed = comparator(op, false);
  const float = comparator(op, true);
  return {
    arity: 2,
    call: (args, _state, o) => ((o.float ? float : fixed)(arg(args, 0), arg(args, 1)) ? 1 : 0)
  };
}

const BUILTINS: ReadonlyMap<string, Builtin> = new Map<string, Builtin>([
  // Constants (`pgfmathdeclarefunction{...}{0}`).
  ["pi", { arity: 0, call: () => Math.PI }],
  ["e", { arity: 0, call: () => Math.E }],
  ["true", { arity: 0, call: () => 1 }],
  ["false", { arity: 0, call: () => 0 }],
  ["rnd", { arity: 0, call: (_args, state) => requireRng(state).rnd() }],
  ["rand", { arity: 0, call: (_args, state) => requireRng(state).rand() }],
  [
    "random",
    {
      arity: "variadic",
      call: (args, state) => {
        const rng = requireRng(state);
        if (args.length === 0 || (args.length === 1 && args[0] === "")) {
          return rng.rnd();
        }
        if (args.length === 1) {
          return rng.randomInteger(1, arg(args, 0));
        }
        if (args.length === 2) {
          return rng.randomInteger(arg(args, 0), arg(args, 1));
        }
        throw new PgfMathRuntimeError("invalid-arity", "random() supports 0, 1, or 2 arguments.");
      }
    }
  ],
  // Basic arithmetic as functions.
  ["add", { arity: 2, call: (args) => arg(args, 0) + arg(args, 1) }],
  ["subtract", { arity: 2, call: (args) => arg(args, 0) - arg(args, 1) }],
  ["multiply", { arity: 2, call: (args) => arg(args, 0) * arg(args, 1) }],
  ["divide", { arity: 2, call: (args, state, o) => divide(arg(args, 0), arg(args, 1), o.float, state) }],
  [
    "pow",
    { arity: 2, call: (args, _state, o) => (o.float ? powFloat : powFixed)(arg(args, 0), arg(args, 1)) }
  ],
  ["neg", { arity: 1, unary: (value) => -value }],
  ["abs", { arity: 1, unary: (value) => Math.abs(value) }],
  ["sign", { arity: 1, unary: (value) => (value > 0 ? 1 : value < 0 ? -1 : 0) }],
  ["real", { arity: 1, unary: (value) => value }],
  ["reciprocal", { arity: 1, unary: (value, o) => reciprocal(value, o, "reciprocal()") }],
  ["factorial", { arity: 1, unary: (value) => factorial(value) }],
  [
    "sqrt",
    {
      arity: 1,
      unary: (value, o) =>
        domain(value >= 0, o, "Cannot take the square root of a negative number.") ? Math.sqrt(value) : Number.NaN
    }
  ],
  ["exp", { arity: 1, unary: (value) => Math.exp(value) }],
  [
    "ln",
    {
      arity: 1,
      unary: (value, o) =>
        domain(value > 0, o, "Cannot take the logarithm of a non-positive number.") ? Math.log(value) : Number.NaN
    }
  ],
  [
    "log10",
    {
      arity: 1,
      unary: (value, o) =>
        domain(value > 0, o, "Cannot take the logarithm of a non-positive number.") ? Math.log10(value) : Number.NaN
    }
  ],
  [
    "log2",
    {
      arity: 1,
      unary: (value, o) =>
        domain(value > 0, o, "Cannot take the logarithm of a non-positive number.") ? Math.log2(value) : Number.NaN
    }
  ],
  ["veclen", { arity: 2, call: (args) => Math.hypot(arg(args, 0), arg(args, 1)) }],
  ["sinh", { arity: 1, unary: (value) => Math.sinh(value) }],
  ["cosh", { arity: 1, unary: (value) => Math.cosh(value) }],
  ["tanh", { arity: 1, unary: (value) => Math.tanh(value) }],
  // Rounding (`pgfmathfunctions.round.code.tex`).
  ["round", { arity: 1, unary: (value) => roundHalfAway(value) }],
  ["floor", { arity: 1, unary: (value) => Math.floor(value) }],
  ["ceil", { arity: 1, unary: (value) => Math.ceil(value) }],
  ["int", { arity: 1, unary: (value) => Math.trunc(value) }],
  // `frac` keeps the digits after the period, so frac(-3.25) is 0.25.
  ["frac", { arity: 1, unary: (value) => Math.abs(value) - Math.floor(Math.abs(value)) }],
  // Integer arithmetic.
  [
    "div",
    {
      arity: 2,
      call: (args, state, o) => Math.trunc(divide(arg(args, 0), arg(args, 1), o.float, state))
    }
  ],
  ["mod", { arity: 2, call: (args, _state, o) => (o.float ? modFloat : modFixed)(arg(args, 0), arg(args, 1)) }],
  [
    "Mod",
    {
      arity: 2,
      call: (args) => {
        const divisor = arg(args, 1);
        const remainder = modFixed(arg(args, 0), divisor);
        return remainder < 0 ? remainder + divisor : remainder;
      }
    }
  ],
  [
    "gcd",
    {
      arity: 2,
      call: (args, state) => {
        // PGF ends with `\pgfmathparse{int(\pgfmath@xa)}`: a dimen register declares units.
        state.units = true;
        return gcd(arg(args, 0), arg(args, 1));
      }
    }
  ],
  ["isprime", { arity: 1, unary: (value) => isPrime(value) }],
  ["iseven", { arity: 1, unary: (value) => (Math.abs(Math.trunc(value)) % 2 === 0 ? 1 : 0) }],
  ["isodd", { arity: 1, unary: (value) => (Math.abs(Math.trunc(value)) % 2 === 1 ? 1 : 0) }],
  // Trigonometry (`pgfmathfunctions.trigonometric.code.tex`).
  ["deg", { arity: 1, unary: (value) => value * DEG }],
  ["rad", { arity: 1, unary: (value) => value * RAD }],
  ["radians", { arity: 1, unary: (value) => value * DEG }],
  ["sin", { arity: 1, unary: (value, o) => trigIn(value, o, "sin") }],
  ["cos", { arity: 1, unary: (value, o) => trigIn(value, o, "cos") }],
  [
    "tan",
    {
      arity: 1,
      unary: (value, o) => trigIn(value, o, "sin") * reciprocal(trigIn(value, o, "cos"), o, "tan()")
    }
  ],
  ["sec", { arity: 1, unary: (value, o) => reciprocal(trigIn(value, o, "cos"), o, "sec()") }],
  ["cosec", { arity: 1, unary: (value, o) => reciprocal(trigIn(value, o, "sin"), o, "cosec()") }],
  [
    "cot",
    {
      arity: 1,
      unary: (value, o) => trigIn(value, o, "cos") * reciprocal(trigIn(value, o, "sin"), o, "cot()")
    }
  ],
  [
    "asin",
    {
      arity: 1,
      unary: (value, o) =>
        domain(Math.abs(value) <= 1, o, "asin() is defined on [-1, 1].") ? angleOut(Math.asin(value), o) : Number.NaN
    }
  ],
  [
    "acos",
    {
      arity: 1,
      unary: (value, o) =>
        domain(Math.abs(value) <= 1, o, "acos() is defined on [-1, 1].") ? angleOut(Math.acos(value), o) : Number.NaN
    }
  ],
  ["atan", { arity: 1, unary: (value, o) => angleOut(Math.atan(value), o) }],
  [
    "atan2",
    {
      arity: 2,
      call: (args, _state, o) => {
        const y = arg(args, 0);
        const x = arg(args, 1);
        // PGF's fixed-point atan2 answers 90 degrees for (0,0).
        return angleOut(!o.float && x === 0 && y === 0 ? Math.PI / 2 : Math.atan2(y, x), o);
      }
    }
  ],
  // Comparison and logic (`pgfmathfunctions.comparison.code.tex`).
  ["equal", compare2("==")],
  ["notequal", compare2("!=")],
  ["greater", compare2(">")],
  ["less", compare2("<")],
  ["notgreater", compare2("<=")],
  ["notless", compare2(">=")],
  [
    "approxequalto",
    { arity: 2, call: (args) => (Math.abs(arg(args, 0) - arg(args, 1)) < 0.0001 ? 1 : 0) }
  ],
  ["and", { arity: 2, call: (args, _state, o) => (truthyFor(o, arg(args, 0)) && truthyFor(o, arg(args, 1)) ? 1 : 0) }],
  ["or", { arity: 2, call: (args, _state, o) => (truthyFor(o, arg(args, 0)) || truthyFor(o, arg(args, 1)) ? 1 : 0) }],
  ["not", { arity: 1, unary: (value, o) => (truthyFor(o, value) ? 0 : 1) }],
  [
    "ifthenelse",
    {
      arity: 3,
      call: (args, _state, o) => (truthyFor(o, arg(args, 0)) ? (args[1] ?? 0) : (args[2] ?? 0))
    }
  ],
  // min/max start from ∓16383 in fixed mode.
  [
    "max",
    {
      arity: "variadic",
      call: (args, _state, o) => {
        if (args.length === 0 || (args.length === 1 && args[0] === "")) throw new PgfMathRuntimeError("invalid-arity", "max() expects at least one argument.");
        if (args.length === 1 && o.float) throw new PgfMathRuntimeError("invalid-operation", "The fpu library fails on max() of one argument.");
        let best = o.float ? -Infinity : -16383;
        for (let index = 0; index < args.length; index += 1) best = Math.max(best, arg(args, index));
        return best;
      }
    }
  ],
  [
    "min",
    {
      arity: "variadic",
      call: (args, _state, o) => {
        if (args.length === 0 || (args.length === 1 && args[0] === "")) throw new PgfMathRuntimeError("invalid-arity", "min() expects at least one argument.");
        if (args.length === 1 && o.float) throw new PgfMathRuntimeError("invalid-operation", "The fpu library fails on min() of one argument.");
        let best = o.float ? Infinity : 16383;
        for (let index = 0; index < args.length; index += 1) best = Math.min(best, arg(args, index));
        return best;
      }
    }
  ],
  // Base conversion returns text.
  ["hex", { arity: 1, call: (args, _state, o) => baseResult(toBase(arg(args, 0), 16, false), o) }],
  ["Hex", { arity: 1, call: (args, _state, o) => baseResult(toBase(arg(args, 0), 16, true), o) }],
  ["oct", { arity: 1, call: (args, _state, o) => baseResult(toBase(arg(args, 0), 8, false), o) }],
  ["bin", { arity: 1, call: (args, _state, o) => baseResult(toBase(arg(args, 0), 2, false), o) }],
  // Arrays.
  ["array", { arity: 2, call: (args) => indexValue(args[0] ?? "", args[1] ?? 0) }],
  [
    "dim",
    {
      arity: 1,
      call: (args) => {
        const value = args[0];
        return Array.isArray(value) ? value.length : 1;
      }
    }
  ],
  // `scalar` strips units: `\global\pgfmathunitsdeclaredfalse`.
  [
    "scalar",
    {
      arity: 1,
      call: (args, state) => {
        state.units = false;
        return args[0] ?? 0;
      }
    }
  ],
  // Text boxes (`\setbox\pgfmath@box=\hbox{...}`), in pt without declared units.
  ["width", { arity: 1, call: (args, state) => measure(state, args[0] ?? "", "width") }],
  ["height", { arity: 1, call: (args, state) => measure(state, args[0] ?? "", "height") }],
  ["depth", { arity: 1, call: (args, state) => measure(state, args[0] ?? "", "depth") }]
]);

/** Format a value as `\pgfmathresult` text; arrays print as `{a}{b}`. */
export function formatPgfMathValue(value: PgfMathValue, formatNumber: (value: number) => string): string {
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return value.map((item) => `{${formatPgfMathValue(item, formatNumber)}}`).join("");
}
