/**
 * pgfmath expression parser: source text -> AST.
 *
 * PGF parses with an operator-precedence (shunting-yard) machine
 * (`pgfmathparser.code.tex`). This is a precedence-climbing parser that
 * reproduces the groupings that machine produces, including its quirks:
 *
 * - every infix operator is left-associative, `^` included (`2^3^2` = 64);
 * - `&&` and `||` share one precedence (`1||0&&0` = 0);
 * - the ternary is left-associative (`1?2:3?4:5` = 4);
 * - postfix `!` and `r` stay on the operator stack, so operators that bind
 *   tighter and follow them apply first (`3!^2` = `(3^2)!`, `2*3r` = `(2*3)r`);
 * - prefix minus has the precedence of `+` (`-2^2` = -4), functions bind
 *   tightest (`sin 30^2` = `(sin 30)^2`);
 * - an index `[...]` after `)`/`}` applies to that group only.
 *
 * Precedences (PGF 3.1.10): `?` 100, `:` 101, `&&` `||` 200, comparisons
 * 250, `+` `-` and prefix minus 500, postfix `r` 600, `*` `/` 700, postfix
 * `!` 800, `^` 900, prefix `!` 975, functions 1000.
 */

export type PgfMathNode =
  | { t: "num"; v: number; units: boolean; unit?: string }
  | { t: "str"; v: string }
  | { t: "macro"; name: string }
  | { t: "ident"; name: string }
  | { t: "call"; name: string; arg: PgfMathNode }
  | { t: "group"; items: PgfMathNode[] }
  | { t: "array"; items: PgfMathNode[] }
  | { t: "index"; target: PgfMathNode; index: PgfMathNode }
  | { t: "bin"; op: PgfMathBinaryOp; l: PgfMathNode; r: PgfMathNode }
  | { t: "un"; op: PgfMathUnaryOp; a: PgfMathNode }
  | { t: "cond"; c: PgfMathNode; a: PgfMathNode; b: PgfMathNode };

export type PgfMathBinaryOp = "+" | "-" | "*" | "/" | "^" | "<" | ">" | "==" | "!=" | "<=" | ">=" | "&&" | "||";
export type PgfMathUnaryOp = "neg" | "not" | "fact" | "deg";

/** 0: constant (operand without argument); a positive count or "variadic": takes one operand. */
export type PgfMathArity = number | "variadic";

export type PgfMathSyntaxErrorCode = "empty" | "token" | "unexpected-token" | "unknown-function" | "invalid-domain";

export class PgfMathSyntaxError extends Error {
  constructor(readonly code: PgfMathSyntaxErrorCode, message: string) {
    super(message);
  }
}

export const PGF_INFIX_PRECEDENCE: Readonly<Record<PgfMathBinaryOp | "?" | ":", number>> = {
  "?": 100,
  ":": 101,
  "&&": 200,
  "||": 200,
  "<": 250,
  ">": 250,
  "==": 250,
  "!=": 250,
  "<=": 250,
  ">=": 250,
  "+": 500,
  "-": 500,
  "*": 700,
  "/": 700,
  "^": 900
};
const POSTFIX_PRECEDENCE = { r: 600, "!": 800 } as const;
const NEG_PRECEDENCE = 500;
const NOT_PRECEDENCE = 975;
const FUNCTION_PRECEDENCE = 1000;
const COMMA_PRECEDENCE = 10;

/** Units PGF recognizes after a number under LuaTeX (`pgfmath@tokens@make{unit}`). */
export const PGF_LENGTH_UNITS: ReadonlySet<string> = new Set([
  "bp", "cc", "cm", "dd", "em", "ex", "in", "mm", "pc", "pt", "sp", "nc", "nd", "px"
]);

type Operator =
  | { kind: "infix"; op: PgfMathBinaryOp | "?" | ":"; prec: number; width: number }
  | { kind: "postfix"; op: "r" | "!"; prec: number }
  | { kind: "comma" }
  | { kind: "close"; char: ")" | "]" | "}" }
  | { kind: "end" };

export type ParsePgfMathOptions = {
  /** Arity of a function or pseudo-constant name, or null when unknown. */
  arityOf: (name: string) => PgfMathArity | null;
  /** Whether `\name` tokens are accepted (compiled expressions with macro bindings). */
  isMacro?: (name: string) => boolean;
  /** Accept `rnd()`, `pi()`: an empty argument list after a constant. */
  emptyCallAfterConstant?: boolean;
};

/**
 * Parse a pgfmath expression (after macro expansion and outer-brace
 * stripping). Throws `PgfMathSyntaxError`.
 */
export function parsePgfMathSource(source: string, options: ParsePgfMathOptions): PgfMathNode {
  const parser = new Parser(source, options);
  return parser.parseTop();
}

class Parser {
  private i = 0;

  constructor(private readonly s: string, private readonly options: ParsePgfMathOptions) {}

  parseTop(): PgfMathNode {
    this.skipSpaces();
    if (this.i >= this.s.length) {
      throw new PgfMathSyntaxError("empty", "Expression is empty.");
    }
    const items = this.parseList();
    const operator = this.peekOperator();
    if (operator.kind !== "end") {
      throw new PgfMathSyntaxError("unexpected-token", "Unexpected trailing tokens in expression.");
    }
    return items.length === 1 ? requireNode(items[0]) : { t: "group", items };
  }

  /** Comma-separated items (PGF's `@collect`, precedence 10). */
  private parseList(): PgfMathNode[] {
    const items = [this.parseExpression(COMMA_PRECEDENCE)];
    for (;;) {
      const operator = this.peekOperator();
      if (operator.kind !== "comma") {
        return items;
      }
      this.i += 1;
      items.push(this.parseExpression(COMMA_PRECEDENCE));
    }
  }

  private parseExpression(min: number): PgfMathNode {
    return this.parseInfix(this.parseOperand(), min);
  }

  private parseInfix(initial: PgfMathNode, min: number): PgfMathNode {
    let left = initial;
    for (;;) {
      const operator = this.peekOperator();
      if (operator.kind === "postfix") {
        if (operator.prec <= min) {
          return left;
        }
        this.i += 1;
        // The postfix operator waits on the stack: what binds tighter and
        // follows it combines with its operand first.
        const operand = this.parseInfix(left, operator.prec);
        left = { t: "un", op: operator.op === "r" ? "deg" : "fact", a: operand };
        continue;
      }
      if (operator.kind !== "infix" || operator.prec <= min) {
        return left;
      }
      if (operator.op === ":") {
        throw new PgfMathSyntaxError("unexpected-token", "':' without a matching '?'.");
      }
      this.i += operator.width;
      if (operator.op === "?") {
        const whenTrue = this.parseExpression(PGF_INFIX_PRECEDENCE[":"]);
        const colon = this.peekOperator();
        if (colon.kind !== "infix" || colon.op !== ":") {
          throw new PgfMathSyntaxError("unexpected-token", "Ternary expression is missing ':'.");
        }
        this.i += 1;
        const whenFalse = this.parseExpression(PGF_INFIX_PRECEDENCE[":"]);
        left = { t: "cond", c: left, a: whenTrue, b: whenFalse };
        continue;
      }
      const right = this.parseExpression(operator.prec);
      left = { t: "bin", op: operator.op, l: left, r: right };
    }
  }

  private parseOperand(): PgfMathNode {
    this.skipSpaces();
    const char = this.s.charAt(this.i);
    if (char === "") {
      throw new PgfMathSyntaxError("unexpected-token", "Unexpected end of expression.");
    }
    if (char === "+") {
      this.i += 1;
      return this.parseOperand();
    }
    if (char === "-") {
      this.i += 1;
      return { t: "un", op: "neg", a: this.parseExpression(NEG_PRECEDENCE) };
    }
    if (char === "!") {
      this.i += 1;
      return { t: "un", op: "not", a: this.parseExpression(NOT_PRECEDENCE) };
    }
    if (char === "\"") {
      const end = this.s.indexOf("\"", this.i + 1);
      if (end < 0) {
        throw new PgfMathSyntaxError("token", "Unterminated quoted string.");
      }
      const value = this.s.slice(this.i + 1, end);
      this.i = end + 1;
      return { t: "str", v: value };
    }
    if (char === "(" || char === "{") {
      this.i += 1;
      const close = char === "(" ? ")" : "}";
      this.skipSpaces();
      const items = this.s.charAt(this.i) === close ? [] : this.parseList();
      this.skipSpaces();
      if (this.s.charAt(this.i) !== close) {
        throw new PgfMathSyntaxError("unexpected-token", `Missing closing '${close}' in expression.`);
      }
      this.i += 1;
      const node: PgfMathNode = char === "(" ? { t: "group", items } : { t: "array", items };
      return this.parseIndexSuffix(node);
    }
    if (isDigit(char) || char === ".") {
      return this.parseNumber();
    }
    if (isIdentStart(char)) {
      return this.parseIdentifier();
    }
    if (char === "\\") {
      return this.parseMacro();
    }
    throw new PgfMathSyntaxError("token", `Unexpected token '${char}' in expression.`);
  }

  /** `(...)[i]`, `{...}[i][j]`: PGF reads the index as an operand right after the group. */
  private parseIndexSuffix(initial: PgfMathNode): PgfMathNode {
    let node = initial;
    for (;;) {
      this.skipSpaces();
      if (this.s.charAt(this.i) !== "[") {
        return node;
      }
      this.i += 1;
      const items = this.parseList();
      this.skipSpaces();
      if (this.s.charAt(this.i) !== "]") {
        throw new PgfMathSyntaxError("unexpected-token", "Missing closing ']' in expression.");
      }
      this.i += 1;
      const index = items.length === 1 ? requireNode(items[0]) : { t: "group" as const, items };
      node = { t: "index", target: node, index };
    }
  }

  private parseIdentifier(): PgfMathNode {
    const start = this.i;
    while (this.i < this.s.length && isIdentPart(this.s.charAt(this.i))) {
      this.i += 1;
    }
    const name = this.s.slice(start, this.i);
    const arity = this.options.arityOf(name);
    if (arity == null) {
      throw new PgfMathSyntaxError("unknown-function", `Unknown function '${name}'.`);
    }
    if (arity === 0) {
      // `rnd()`: PGF yields an empty result here (fpu: an error); accept it as the constant.
      const match = this.options.emptyCallAfterConstant === true ? /^\s*\(\s*\)/u.exec(this.s.slice(this.i)) : null;
      if (match) {
        this.i += match[0].length;
      }
      return { t: "ident", name };
    }
    // A function waits on the operator stack for its operand: normally a
    // parenthesized argument list, but `sin 30` and `sin -30` work too.
    return { t: "call", name, arg: this.parseExpression(FUNCTION_PRECEDENCE) };
  }

  private parseMacro(): PgfMathNode {
    const start = this.i;
    this.i += 1;
    while (this.i < this.s.length && /[A-Za-z@]/u.test(this.s.charAt(this.i))) {
      this.i += 1;
    }
    if (this.i === start + 1 && this.i < this.s.length) {
      this.i += 1;
    }
    const name = this.s.slice(start, this.i);
    if (this.options.isMacro?.(name) !== true) {
      throw new PgfMathSyntaxError("token", `Undefined control sequence '${name}' in expression.`);
    }
    return { t: "macro", name };
  }

  /**
   * Numbers as `\pgfmath@parse@number` reads them: digits and periods
   * (spaces between them are skipped), then a two-letter unit, an
   * exponent, a `0x`/`0b` base prefix, or `mu`. A leading 0 means octal.
   */
  private parseNumber(): PgfMathNode {
    let digits = "";
    for (;;) {
      const char = this.s.charAt(this.i);
      if (isDigit(char) || char === ".") {
        digits += char;
        this.i += 1;
        this.skipSpaces();
        continue;
      }
      break;
    }
    const next2 = this.s.slice(this.i, this.i + 2);
    if (PGF_LENGTH_UNITS.has(next2)) {
      this.i += 2;
      return { t: "num", v: this.parseDecimal(digits), units: true, unit: next2 };
    }
    const next = this.s.charAt(this.i);
    if (next === "e" || next === "E") {
      this.i += 1;
      this.skipSpaces();
      let sign = 1;
      while (this.s.charAt(this.i) === "+" || this.s.charAt(this.i) === "-" || this.s.charAt(this.i) === " ") {
        if (this.s.charAt(this.i) === "-") sign = -sign;
        this.i += 1;
      }
      const exponentStart = this.i;
      while (isDigit(this.s.charAt(this.i))) {
        this.i += 1;
      }
      if (exponentStart === this.i) {
        throw new PgfMathSyntaxError("invalid-domain", "Missing exponent digits in scientific notation.");
      }
      const exponent = sign * Number(this.s.slice(exponentStart, this.i));
      const mantissa = this.parseDecimal(digits);
      const value = Number(`${mantissa}e${exponent}`);
      // PGF rejects a unit after an exponent; the editor has always accepted `1.5e2 pt`.
      this.skipSpaces();
      const unit = this.s.slice(this.i, this.i + 2);
      if (PGF_LENGTH_UNITS.has(unit)) {
        this.i += 2;
        return { t: "num", v: value, units: true, unit };
      }
      return { t: "num", v: value, units: false };
    }
    if (digits === "0" && (next === "x" || next === "X" || next === "b" || next === "B")) {
      this.i += 1;
      const hex = next === "x" || next === "X";
      const start = this.i;
      while (this.i < this.s.length && (hex ? /[0-9A-Fa-f]/u : /[01]/u).test(this.s.charAt(this.i))) {
        this.i += 1;
      }
      const text = this.s.slice(start, this.i);
      if (text.length === 0) {
        throw new PgfMathSyntaxError("token", "Missing digits after a base prefix.");
      }
      return { t: "num", v: Number.parseInt(text, hex ? 16 : 2), units: false };
    }
    if (next2 === "mu") {
      this.i += 2;
      return { t: "num", v: this.parseDecimal(digits), units: true, unit: "pt" };
    }
    if (digits.length > 1 && digits.startsWith("0") && !digits.includes(".")) {
      if (/[89]/u.test(digits)) {
        throw new PgfMathSyntaxError("token", `Digit invalid for base 8 in '${digits}'.`);
      }
      return { t: "num", v: Number.parseInt(digits, 8), units: false };
    }
    return { t: "num", v: this.parseDecimal(digits), units: false };
  }

  private parseDecimal(digits: string): number {
    if (digits.length === 0 || digits === "." || digits.indexOf(".") !== digits.lastIndexOf(".")) {
      throw new PgfMathSyntaxError(digits.length === 0 || digits === "." ? "token" : "unexpected-token", `Invalid number '${digits}'.`);
    }
    return Number(digits.endsWith(".") ? digits.slice(0, -1) : digits);
  }

  private peekOperator(): Operator {
    this.skipSpaces();
    const s = this.s;
    const i = this.i;
    if (i >= s.length) {
      return { kind: "end" };
    }
    const two = s.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||") {
      return { kind: "infix", op: two, prec: PGF_INFIX_PRECEDENCE[two], width: 2 };
    }
    const char = s.charAt(i);
    switch (char) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "^":
      case "<":
      case ">":
      case "?":
      case ":":
        return { kind: "infix", op: char, prec: PGF_INFIX_PRECEDENCE[char], width: 1 };
      case "!":
        return { kind: "postfix", op: "!", prec: POSTFIX_PRECEDENCE["!"] };
      case "r":
        return { kind: "postfix", op: "r", prec: POSTFIX_PRECEDENCE.r };
      case ",":
        return { kind: "comma" };
      case ")":
      case "]":
      case "}":
        return { kind: "close", char };
      default:
        throw new PgfMathSyntaxError(
          "unexpected-token",
          `Unknown operator '${char}' in expression.`
        );
    }
  }

  private skipSpaces(): void {
    while (this.i < this.s.length && isSpace(this.s.charCodeAt(this.i))) {
      this.i += 1;
    }
  }
}

function requireNode(node: PgfMathNode | undefined): PgfMathNode {
  if (!node) {
    throw new PgfMathSyntaxError("unexpected-token", "Missing operand.");
  }
  return node;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isIdentStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isIdentPart(char: string): boolean {
  return isIdentStart(char) || isDigit(char);
}
