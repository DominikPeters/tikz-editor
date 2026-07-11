import { getCurrentPgfMathRuntime } from "./runtime.js";
import type { PgfRandom } from "./rng.js";
import { PT_PER_CM } from "../../coords/source.js";

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
  | "unknown-function"
  | "unsupported-random"
  | "invalid-operation";

export type PgfMathEvalResult =
  | { ok: true; quantity: PgfMathQuantity }
  | { ok: false; code: PgfMathEvalErrorCode; message: string };
type PgfMathEvalSuccess = Extract<PgfMathEvalResult, { ok: true }>;
type PgfMathEvalFailure = Extract<PgfMathEvalResult, { ok: false }>;

type Token =
  | { kind: "number"; value: number; unit?: string }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string };

const UNIT_FACTORS: Record<string, number> = {
  pt: 1,
  bp: 72.27 / 72,
  px: 72.27 / 72,
  cm: PT_PER_CM,
  mm: 2.84527559055,
  in: 72.27,
  ex: 4.3,
  em: 10
};

export type EvaluatePgfMathOptions = {
  rng?: PgfRandom;
};

export function evaluatePgfMathExpression(input: string, options: EvaluatePgfMathOptions = {}): PgfMathEvalResult {
  const normalizedInput = normalizeQuantityInput(input);
  if (normalizedInput.length === 0) {
    return { ok: false, code: "empty", message: "Expression is empty." };
  }

  if (normalizedInput.includes("{") || normalizedInput.includes("}") || normalizedInput.includes("\"")) {
    return {
      ok: false,
      code: "unsupported-syntax",
      message: "Array and quoted-string pgfmath expressions are not supported yet."
    };
  }

  const tokenized = tokenize(normalizedInput);
  if (tokenized.ok === false) {
    return tokenized;
  }

  const runtime = options.rng ? { rng: options.rng } : getCurrentPgfMathRuntime();
  const parser = new Parser(tokenized.tokens, runtime ? runtime.rng : undefined);
  return parser.parse();
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

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly rng?: PgfRandom
  ) {}

  parse(): PgfMathEvalResult {
    const expression = this.parseTernary();
    if (expression.ok === false) {
      return expression;
    }
    if (this.atEnd() === false) {
      return this.error("unexpected-token", "Unexpected trailing tokens in expression.");
    }
    if (Number.isFinite(expression.quantity.value) === false) {
      return this.error("invalid-domain", "Expression evaluated to a non-finite value.");
    }
    return expression;
  }

  private parseTernary(): PgfMathEvalResult {
    const condition = this.parseLogicalOr();
    if (condition.ok === false) {
      return condition;
    }
    if (this.matchOp("?") === false) {
      return condition;
    }

    const whenTrue = this.parseTernary();
    if (whenTrue.ok === false) {
      return whenTrue;
    }
    if (this.matchOp(":") === false) {
      return this.error("unexpected-token", "Ternary expression is missing ':'.");
    }
    const whenFalse = this.parseTernary();
    if (whenFalse.ok === false) {
      return whenFalse;
    }
    return this.truthy(condition.quantity) ? whenTrue : whenFalse;
  }

  private parseLogicalOr(): PgfMathEvalResult {
    let left = this.parseLogicalAnd();
    if (left.ok === false) {
      return left;
    }
    while (this.matchOp("||")) {
      const right = this.parseLogicalAnd();
      if (right.ok === false) {
        return right;
      }
      left = this.scalar(this.truthy(left.quantity) || this.truthy(right.quantity) ? 1 : 0);
    }
    return left;
  }

  private parseLogicalAnd(): PgfMathEvalResult {
    let left = this.parseComparison();
    if (left.ok === false) {
      return left;
    }
    while (this.matchOp("&&")) {
      const right = this.parseComparison();
      if (right.ok === false) {
        return right;
      }
      left = this.scalar(this.truthy(left.quantity) && this.truthy(right.quantity) ? 1 : 0);
    }
    return left;
  }

  private parseComparison(): PgfMathEvalResult {
    let left = this.parseAddSub();
    if (left.ok === false) {
      return left;
    }

    while (true) {
      const operator = this.peekOp(["==", "!=", "<", "<=", ">", ">="]);
      if (operator == null) {
        return left;
      }
      this.index += 1;
      const right = this.parseAddSub();
      if (right.ok === false) {
        return right;
      }

      const compared = this.compare(left.quantity, right.quantity, operator);
      if (compared.ok === false) {
        return compared;
      }
      left = this.scalar(compared.value ? 1 : 0);
    }
  }

  private parseAddSub(): PgfMathEvalResult {
    let left = this.parseMulDiv();
    if (left.ok === false) {
      return left;
    }

    while (true) {
      const operator = this.peekOp(["+", "-"]);
      if (operator == null) {
        return left;
      }
      this.index += 1;
      const right = this.parseMulDiv();
      if (right.ok === false) {
        return right;
      }

      if (left.quantity.kind !== right.quantity.kind) {
        return this.error("invalid-operation", "Cannot add or subtract scalar and length values.");
      }

      left = {
        ok: true,
        quantity: {
          kind: left.quantity.kind,
          value: operator === "+" ? left.quantity.value + right.quantity.value : left.quantity.value - right.quantity.value
        }
      };
    }
  }

  private parseMulDiv(): PgfMathEvalResult {
    let left = this.parseUnary();
    if (left.ok === false) {
      return left;
    }

    while (true) {
      const operator = this.peekOp(["*", "/"]);
      if (operator == null) {
        return left;
      }
      this.index += 1;
      const right = this.parseUnary();
      if (right.ok === false) {
        return right;
      }

      if (operator === "*") {
        if (left.quantity.kind === "scalar" && right.quantity.kind === "scalar") {
          left = this.scalar(left.quantity.value * right.quantity.value);
          continue;
        }
        if (left.quantity.kind === "length" && right.quantity.kind === "scalar") {
          left = this.length(left.quantity.value * right.quantity.value);
          continue;
        }
        if (left.quantity.kind === "scalar" && right.quantity.kind === "length") {
          left = this.length(left.quantity.value * right.quantity.value);
          continue;
        }
        return this.error("invalid-operation", "Cannot multiply two length values.");
      }

      if (Math.abs(right.quantity.value) <= 1e-12) {
        return this.error("division-by-zero", "Division by zero.");
      }

      if (left.quantity.kind === "scalar" && right.quantity.kind === "scalar") {
        left = this.scalar(left.quantity.value / right.quantity.value);
        continue;
      }
      if (left.quantity.kind === "length" && right.quantity.kind === "scalar") {
        left = this.length(left.quantity.value / right.quantity.value);
        continue;
      }
      if (left.quantity.kind === "length" && right.quantity.kind === "length") {
        left = this.scalar(left.quantity.value / right.quantity.value);
        continue;
      }
      return this.error("invalid-operation", "Cannot divide scalar by length.");
    }
  }

  private parsePower(): PgfMathEvalResult {
    const left = this.parsePostfix();
    if (left.ok === false) {
      return left;
    }

    if (this.matchOp("^") === false) {
      return left;
    }

    const right = this.parseUnary();
    if (right.ok === false) {
      return right;
    }

    if (right.quantity.kind !== "scalar") {
      return this.error("invalid-operation", "Exponent must be a scalar value.");
    }

    if (left.quantity.kind === "scalar") {
      return this.scalar(Math.pow(left.quantity.value, right.quantity.value));
    }

    if (Math.abs(right.quantity.value - Math.round(right.quantity.value)) > 1e-9) {
      return this.error("invalid-operation", "Length exponent must be an integer scalar.");
    }

    return this.length(Math.pow(left.quantity.value, right.quantity.value));
  }

  private parseUnary(): PgfMathEvalResult {
    if (this.matchOp("+")) {
      return this.parseUnary();
    }
    if (this.matchOp("-")) {
      const value = this.parseUnary();
      if (value.ok === false) {
        return value;
      }
      return {
        ok: true,
        quantity: {
          kind: value.quantity.kind,
          value: -value.quantity.value
        }
      };
    }
    if (this.matchOp("!")) {
      const value = this.parseUnary();
      if (value.ok === false) {
        return value;
      }
      return this.scalar(this.truthy(value.quantity) ? 0 : 1);
    }
    return this.parsePower();
  }

  private parsePostfix(): PgfMathEvalResult {
    let current = this.parsePrimary();
    if (current.ok === false) {
      return current;
    }

    while (true) {
      if (this.matchOp("!")) {
        if (current.quantity.kind !== "scalar") {
          return this.error("invalid-operation", "Factorial requires a scalar argument.");
        }
        const factorial = factorialOf(current.quantity.value);
        if (factorial == null) {
          return this.error("invalid-domain", "Factorial requires a non-negative integer.");
        }
        current = this.scalar(factorial);
        continue;
      }

      const token = this.peek();
      if (token?.kind === "ident" && token.value.toLowerCase() === "r") {
        this.index += 1;
        if (current.quantity.kind !== "scalar") {
          return this.error("invalid-operation", "The postfix 'r' operator requires a scalar value.");
        }
        current = this.scalar((current.quantity.value * 180) / Math.PI);
        continue;
      }
      break;
    }

    return current;
  }

  private parsePrimary(): PgfMathEvalResult {
    const token = this.peek();
    if (token == null) {
      return this.error("unexpected-token", "Unexpected end of expression.");
    }

    if (token.kind === "number") {
      this.index += 1;
      if (token.unit == null) {
        return this.scalar(token.value);
      }
      const unit = token.unit.toLowerCase();
      if (unit === "r") {
        return this.scalar((token.value * 180) / Math.PI);
      }
      const factor = UNIT_FACTORS[unit];
      if (factor == null) {
        return this.error("invalid-domain", `Unsupported unit '${token.unit}'.`);
      }
      return this.length(token.value * factor);
    }

    if (token.kind === "op" && token.value === "(") {
      this.index += 1;
      const nested = this.parseTernary();
      if (nested.ok === false) {
        return nested;
      }
      if (this.matchOp(")") === false) {
        return this.error("unexpected-token", "Missing closing ')' in expression.");
      }
      return nested;
    }

    if (token.kind === "ident") {
      this.index += 1;
      const ident = token.value;
      const normalized = ident.toLowerCase();

      if (normalized === "pi") {
        return this.scalar(Math.PI);
      }
      if (normalized === "e") {
        return this.scalar(Math.E);
      }
      if (normalized === "true") {
        return this.scalar(1);
      }
      if (normalized === "false") {
        return this.scalar(0);
      }
      if (normalized === "rnd") {
        if (this.matchOp("(")) {
          if (this.matchOp(")") === false) {
            return this.error("invalid-arity", "rnd() does not accept arguments.");
          }
          return this.evaluateFunction(ident, []);
        }
        if (this.rng == null) {
          return this.error("unsupported-random", "Random functions require an active pgfmath RNG runtime.");
        }
        return this.scalar(this.rng.rnd());
      }
      if (normalized === "rand") {
        if (this.matchOp("(")) {
          if (this.matchOp(")") === false) {
            return this.error("invalid-arity", "rand() does not accept arguments.");
          }
          return this.evaluateFunction(ident, []);
        }
        if (this.rng == null) {
          return this.error("unsupported-random", "Random functions require an active pgfmath RNG runtime.");
        }
        return this.scalar(this.rng.rand());
      }

      if (this.matchOp("(")) {
        const args: PgfMathQuantity[] = [];
        if (this.matchOp(")") === false) {
          while (true) {
            const argument = this.parseTernary();
            if (argument.ok === false) {
              return argument;
            }
            args.push(argument.quantity);
            if (this.matchOp(")")) {
              break;
            }
            if (this.matchOp(",") === false) {
              return this.error("unexpected-token", `Function '${ident}' expects comma-separated arguments.`);
            }
          }
        }
        return this.evaluateFunction(ident, args);
      }

      return this.error("unknown-function", `Unknown identifier '${ident}'.`);
    }

    return this.error("token", "Unexpected token in expression.");
  }

  private evaluateFunction(name: string, args: PgfMathQuantity[]): PgfMathEvalResult {
    const key = name.toLowerCase();

    if (key === "rnd") {
      if (args.length !== 0) {
        return this.error("invalid-arity", "rnd() does not accept arguments.");
      }
      if (this.rng == null) {
        return this.error("unsupported-random", "Random functions require an active pgfmath RNG runtime.");
      }
      return this.scalar(this.rng.rnd());
    }

    if (key === "rand") {
      if (args.length !== 0) {
        return this.error("invalid-arity", "rand() does not accept arguments.");
      }
      if (this.rng == null) {
        return this.error("unsupported-random", "Random functions require an active pgfmath RNG runtime.");
      }
      return this.scalar(this.rng.rand());
    }

    if (key === "random") {
      if (this.rng == null) {
        return this.error("unsupported-random", "Random functions require an active pgfmath RNG runtime.");
      }
      if (args.length === 0) {
        return this.scalar(this.rng.rnd());
      }
      if (args.length === 1) {
        const upper = this.requireScalar(args[0], "random");
        if (upper.ok === false) {
          return upper;
        }
        return this.scalar(this.rng.randomInteger(1, upper.value));
      }
      if (args.length === 2) {
        const lower = this.requireScalar(args[0], "random");
        if (lower.ok === false) {
          return lower;
        }
        const upper = this.requireScalar(args[1], "random");
        if (upper.ok === false) {
          return upper;
        }
        return this.scalar(this.rng.randomInteger(lower.value, upper.value));
      }
      return this.error("invalid-arity", "random() supports 0, 1, or 2 arguments.");
    }

    if (key === "min" || key === "max") {
      if (args.length < 1) {
        return this.error("invalid-arity", `${name}() expects at least one argument.`);
      }
      let best: number | null = null;
      for (const arg of args) {
        const value = this.requireScalar(arg, name);
        if (value.ok === false) {
          return value;
        }
        best = best == null ? value.value : key === "min" ? Math.min(best, value.value) : Math.max(best, value.value);
      }
      return this.scalar(best ?? 0);
    }

    const unary = (fn: (value: number) => number): PgfMathEvalResult => {
      if (args.length !== 1) {
        return this.error("invalid-arity", `${name}() expects exactly one argument.`);
      }
      const value = this.requireScalar(args[0], name);
      if (value.ok === false) {
        return value;
      }
      const next = fn(value.value);
      if (Number.isFinite(next) === false) {
        return this.error("invalid-domain", `${name}() produced a non-finite result.`);
      }
      return this.scalar(next);
    };

    const binary = (fn: (left: number, right: number) => number): PgfMathEvalResult => {
      if (args.length !== 2) {
        return this.error("invalid-arity", `${name}() expects exactly two arguments.`);
      }
      const left = this.requireScalar(args[0], name);
      if (left.ok === false) {
        return left;
      }
      const right = this.requireScalar(args[1], name);
      if (right.ok === false) {
        return right;
      }
      const next = fn(left.value, right.value);
      if (Number.isFinite(next) === false) {
        return this.error("invalid-domain", `${name}() produced a non-finite result.`);
      }
      return this.scalar(next);
    };

    if (key === "sin") return unary((value) => Math.sin((value * Math.PI) / 180));
    if (key === "cos") return unary((value) => Math.cos((value * Math.PI) / 180));
    if (key === "tan") return unary((value) => Math.tan((value * Math.PI) / 180));
    if (key === "asin") return unary((value) => (Math.asin(value) * 180) / Math.PI);
    if (key === "acos") return unary((value) => (Math.acos(value) * 180) / Math.PI);
    if (key === "atan") return unary((value) => (Math.atan(value) * 180) / Math.PI);
    if (key === "sqrt") return unary((value) => (value < 0 ? Number.NaN : Math.sqrt(value)));
    if (key === "abs") return unary((value) => Math.abs(value));
    if (key === "exp") return unary((value) => Math.exp(value));
    if (key === "ln") return unary((value) => (value <= 0 ? Number.NaN : Math.log(value)));
    if (key === "log10") return unary((value) => (value <= 0 ? Number.NaN : Math.log10(value)));
    if (key === "log2") return unary((value) => (value <= 0 ? Number.NaN : Math.log2(value)));
    if (key === "round") return unary((value) => Math.round(value));
    if (key === "floor") return unary((value) => Math.floor(value));
    if (key === "ceil") return unary((value) => Math.ceil(value));
    if (key === "int") return unary((value) => Math.trunc(value));
    if (key === "frac") return unary((value) => value - Math.trunc(value));
    if (key === "sign") return unary((value) => (value > 0 ? 1 : value < 0 ? -1 : 0));
    if (key === "deg") return unary((value) => (value * 180) / Math.PI);
    if (key === "rad") return unary((value) => (value * Math.PI) / 180);
    if (key === "scalar") {
      if (args.length !== 1) {
        return this.error("invalid-arity", "scalar() expects exactly one argument.");
      }
      return this.scalar(args[0].value);
    }

    if (key === "pow") return binary((left, right) => Math.pow(left, right));
    if (key === "atan2") return binary((y, x) => (Math.atan2(y, x) * 180) / Math.PI);
    if (key === "mod") {
      const positive = name === "Mod";
      return binary((left, right) => {
        if (Math.abs(right) <= 1e-12) {
          return Number.NaN;
        }
        const remainder = left % right;
        if (!positive) {
          return remainder;
        }
        const divisor = Math.abs(right);
        return ((remainder % divisor) + divisor) % divisor;
      });
    }

    return this.error("unknown-function", `Unsupported function '${name}'.`);
  }

  private requireScalar(quantity: PgfMathQuantity, functionName: string): { ok: true; value: number } | PgfMathEvalFailure {
    if (quantity.kind !== "scalar") {
      return this.error("invalid-operation", `${functionName}() expects scalar arguments.`);
    }
    return { ok: true, value: quantity.value };
  }

  private compare(left: PgfMathQuantity, right: PgfMathQuantity, operator: string): { ok: true; value: boolean } | PgfMathEvalFailure {
    if (left.kind !== right.kind) {
      return this.error("invalid-operation", "Cannot compare scalar and length values.");
    }
    if (operator === "==") return { ok: true, value: Math.abs(left.value - right.value) <= 1e-9 };
    if (operator === "!=") return { ok: true, value: Math.abs(left.value - right.value) > 1e-9 };
    if (operator === "<") return { ok: true, value: left.value < right.value };
    if (operator === "<=") return { ok: true, value: left.value <= right.value };
    if (operator === ">") return { ok: true, value: left.value > right.value };
    return { ok: true, value: left.value >= right.value };
  }

  private truthy(quantity: PgfMathQuantity): boolean {
    return Math.abs(quantity.value) > 1e-12;
  }

  private scalar(value: number): PgfMathEvalSuccess {
    return { ok: true, quantity: { kind: "scalar", value } };
  }

  private length(value: number): PgfMathEvalSuccess {
    return { ok: true, quantity: { kind: "length", value } };
  }

  private peek(): Token | null {
    return this.tokens[this.index] ?? null;
  }

  private matchOp(expected: string): boolean {
    const token = this.tokens[this.index];
    if (token == null) {
      return false;
    }
    if (token.kind !== "op") {
      return false;
    }
    if (token.value !== expected) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private peekOp(expected: string[]): string | null {
    const token = this.tokens[this.index];
    if (token?.kind !== "op") {
      return null;
    }
    for (const value of expected) {
      if (token.value === value) {
        return value;
      }
    }
    return null;
  }

  private atEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private error(code: PgfMathEvalErrorCode, message: string): PgfMathEvalFailure {
    return { ok: false, code, message };
  }
}

function tokenize(input: string): { ok: true; tokens: Token[] } | PgfMathEvalFailure {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (
      input.startsWith("&&", index) ||
      input.startsWith("||", index) ||
      input.startsWith("==", index) ||
      input.startsWith("!=", index) ||
      input.startsWith("<=", index) ||
      input.startsWith(">=", index)
    ) {
      tokens.push({ kind: "op", value: input.slice(index, index + 2) });
      index += 2;
      continue;
    }

    if ("+-*/^()?,:!<>".includes(char)) {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }

    if (isDigit(char) || char === ".") {
      const numberStart = index;
      if (char === ".") {
        index += 1;
        const digitsStart = index;
        while (index < input.length && isDigit(input[index])) {
          index += 1;
        }
        if (digitsStart === index) {
          return { ok: false, code: "token", message: "Invalid decimal number." };
        }
      } else {
        while (index < input.length && isDigit(input[index])) {
          index += 1;
        }
        if (index < input.length && input[index] === ".") {
          index += 1;
          while (index < input.length && isDigit(input[index])) {
            index += 1;
          }
        }
      }

      if (index < input.length && (input[index] === "e" || input[index] === "E")) {
        const exponentStart = index;
        index += 1;
        if (index < input.length && (input[index] === "+" || input[index] === "-")) {
          index += 1;
        }
        const exponentDigitsStart = index;
        while (index < input.length && isDigit(input[index])) {
          index += 1;
        }
        if (exponentDigitsStart === index) {
          index = exponentStart;
        }
      }

      const value = Number(input.slice(numberStart, index));
      if (Number.isFinite(value) === false) {
        return { ok: false, code: "token", message: "Invalid numeric literal." };
      }

      let unitCursor = index;
      while (unitCursor < input.length && /\s/.test(input[unitCursor])) {
        unitCursor += 1;
      }
      const unitStart = unitCursor;
      while (unitCursor < input.length && /[A-Za-z]/.test(input[unitCursor])) {
        unitCursor += 1;
      }
      const unit = input.slice(unitStart, unitCursor);
      if (unit.length > 0) {
        index = unitCursor;
      }

      tokens.push({ kind: "number", value, unit: unit.length > 0 ? unit : undefined });
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      const identStart = index;
      while (index < input.length && /[A-Za-z0-9_]/.test(input[index])) {
        index += 1;
      }
      tokens.push({ kind: "ident", value: input.slice(identStart, index) });
      continue;
    }

    return { ok: false, code: "token", message: `Unexpected token '${char}' in expression.` };
  }

  return { ok: true, tokens };
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
    const char = raw[index];
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

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function factorialOf(value: number): number | null {
  if (Number.isFinite(value) === false) {
    return null;
  }
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 1e-9 || rounded < 0) {
    return null;
  }
  if (rounded > 170) {
    return null;
  }
  let result = 1;
  for (let current = 2; current <= rounded; current += 1) {
    result *= current;
  }
  return result;
}
