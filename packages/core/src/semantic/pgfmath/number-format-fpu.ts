/**
 * The slice of PGF's fpu (`pgflibraryfpu.code.tex`, LPPL) and basic pgfmath
 * arithmetic (`pgfmathfunctions.basic.code.tex`) that the `frac` number
 * printer relies on: float multiply and divide with extended precision 1,
 * which run on TeX dimensions. TeX's own scaled arithmetic (`round_decimals`,
 * `print_scaled`, `xn_over_d`) is reproduced exactly so the digits match.
 */

import type { PgfFloat } from "./number-format.js";

const UNITY = 65536;
const SMALL_NUMBER_SP = texDimenFromDecimal("0.00002");

/** TeX's conversion of `<decimal>pt` to scaled points (sign, integer part, `round_decimals`). */
export function texDimenFromDecimal(text: string): number {
  let index = 0;
  let negative = false;
  while (text[index] === "-" || text[index] === "+") {
    if (text[index] === "-") negative = !negative;
    index += 1;
  }
  const rest = text.slice(index);
  const dot = rest.indexOf(".");
  const integerText = dot < 0 ? rest : rest.slice(0, dot);
  const fractionText = dot < 0 ? "" : rest.slice(dot + 1);
  const integer = integerText.length === 0 ? 0 : Number.parseInt(integerText, 10) || 0;
  const digits = fractionText.replace(/[^0-9].*$/u, "").slice(0, 17);
  let a = 0;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    a = Math.floor((a + Number.parseInt(digits[i] ?? "0", 10) * 131072) / 10);
  }
  const sp = integer * UNITY + Math.floor((a + 1) / 2);
  return negative ? -sp : sp;
}

/** TeX's `print_scaled`: the text `\the` gives for a dimension, without `pt`. */
export function texDimenToDecimal(sp: number): string {
  let s = sp;
  let out = "";
  if (s < 0) { out = "-"; s = -s; }
  out += String(Math.floor(s / UNITY)) + ".";
  s = 10 * (s % UNITY) + 5;
  let delta = 10;
  do {
    if (delta > UNITY) s = s + 0x8000 - 50000;
    out += String(Math.floor(s / UNITY));
    s = 10 * (s % UNITY);
    delta *= 10;
  } while (s > delta);
  return out;
}

/** `\pgfmath@x=<factor>\pgfmath@y`: TeX's `nx_plus_y(int, v, xn_over_d(v, f, unity))`. */
function scaleDimen(factorText: string, dimen: number): number {
  let negative = false;
  let text = factorText;
  while (text.startsWith("-") || text.startsWith("+")) {
    if (text.startsWith("-")) negative = !negative;
    text = text.slice(1);
  }
  const whole = texDimenFromDecimal(text);
  const integer = Math.floor(whole / UNITY);
  const fraction = whole % UNITY;
  const sign = dimen < 0 ? -1 : 1;
  const magnitude = Math.abs(dimen);
  const scaled = integer * magnitude + Math.floor((magnitude * fraction) / UNITY);
  const result = sign * scaled;
  return negative ? -result : result;
}

/** `\pgfmathmultiply@`. */
function basicMultiply(a: string, b: string): string {
  const x = texDimenFromDecimal(a);
  const y = texDimenFromDecimal(b);
  return texDimenToDecimal(scaleDimen(texDimenToDecimal(y), x));
}

/** `\pgfmathdivide@dimenbyten`: shift the printed digits of the dimension. */
function dimenByTen(y: number): number {
  const printed = texDimenToDecimal(y);
  const dot = printed.indexOf(".");
  const integer = Number.parseInt(printed.slice(0, dot), 10);
  const fraction = printed.slice(dot + 1);
  const high = Math.trunc(integer / 10);
  const low = integer - high * 10;
  return texDimenFromDecimal(`${high}.${low}${fraction}`);
}

/** `\pgfmath@tonumber@notrailingzero`. */
function printNoTrailingZero(sp: number): string {
  const printed = texDimenToDecimal(sp);
  const dot = printed.indexOf(".");
  const fraction = printed.slice(dot + 1);
  return printed.slice(0, dot + 1) + (Number.parseInt(fraction, 10) === 0 ? "" : fraction);
}

/** `\pgfmathdivide@advance@last@digit`. */
function advanceLastDigit(result: string): string {
  const dot = result.indexOf(".");
  const fractionDigits = dot < 0 ? 0 : result.length - dot - 1;
  const steps = ["1", "0.1", "0.01", "0.001", "0.0001"];
  const increment = texDimenFromDecimal(steps[fractionDigits] ?? "0.00001");
  return printNoTrailingZero(texDimenFromDecimal(result) + increment);
}

/** `\pgfmathreciprocal@` is not needed here: the fpu divides mantissas in [10, 100). */
function basicDivide(a: string, b: string): string {
  let x = texDimenFromDecimal(a);
  let y = texDimenFromDecimal(b);
  if (y === 0) return "0.0";
  const yInteger = Math.trunc(y / UNITY);
  const yFraction = y - yInteger * UNITY;
  if (yFraction === 0) return texDimenToDecimal(Math.trunc(x / yInteger));
  let sign = "";
  if (x < 0) { sign = "-"; x = -x; }
  if (y < 0) { sign += "-"; y = -y; }
  if (y < UNITY) throw new Error("pgfmath reciprocal path is not implemented");
  let result = "0";
  let beforePeriod = true;
  for (let guard = 0; guard < 10000; guard += 1) {
    if (!(SMALL_NUMBER_SP < x) || !(SMALL_NUMBER_SP < y)) break;
    if (y > x) {
      if (beforePeriod) { result += "."; beforePeriod = false; }
      y = dimenByTen(y);
      if (y > x) result += "0";
      continue;
    }
    let quotient = Math.trunc(x / y);
    x -= quotient * y;
    let append = true;
    if (!beforePeriod && quotient > 9) {
      result = advanceLastDigit(result);
      quotient -= 10;
      if (quotient === 0) append = false;
    }
    if (append) result += String(quotient);
  }
  const signs = sign.length % 2 === 1 ? -1 : 1;
  return texDimenToDecimal(signs * texDimenFromDecimal(result));
}

/** `\pgfmathfloattoextentedprecision@a/b` with precision 1: `d.ddd` becomes `dd.dd`. */
function extendedMantissa(mantissa: string, padding: string): string {
  const text = mantissa + padding;
  const dot = text.indexOf(".");
  const head = text.slice(0, dot);
  const tail = text.slice(dot + 1);
  return `${head}${tail.slice(0, 1)}.${tail.slice(1)}`;
}

type Parse = (input: string) => PgfFloat;

function parseResult(text: string, exponent: number, flags: 1 | 2, parse: Parse): PgfFloat {
  const parsed = parse(`${text}e${exponent}`);
  return { flags: parsed.flags === 0 ? 0 : flags, mantissa: parsed.mantissa, exponent: parsed.exponent };
}

/** `\pgfmathfloatmultiply@` for finite operands; `parse` is `\pgfmathfloatparsenumber`. */
export function pgfFloatMultiply(a: PgfFloat, b: PgfFloat, parse: Parse): PgfFloat {
  if (a.flags === 0 || b.flags === 0) return { flags: 0, mantissa: "0.0", exponent: 0 };
  if (a.flags >= 3 || b.flags >= 3) return { flags: 3, mantissa: "0.0", exponent: 0 };
  const product = basicMultiply(extendedMantissa(a.mantissa, "000"), extendedMantissa(b.mantissa, "00"));
  return parseResult(product, a.exponent - 1 + b.exponent - 1, a.flags === b.flags ? 1 : 2, parse);
}

/** `\pgfmathfloatdivide@` for finite operands. */
export function pgfFloatDivide(a: PgfFloat, b: PgfFloat, parse: Parse): PgfFloat {
  if (a.flags === 0) return { flags: 0, mantissa: "0.0", exponent: 0 };
  if (a.flags >= 3 || b.flags >= 3 || b.flags === 0) return { flags: 3, mantissa: "0.0", exponent: 0 };
  const quotient = basicDivide(extendedMantissa(a.mantissa, "000"), extendedMantissa(b.mantissa, "00"));
  return parseResult(quotient, a.exponent - 1 - (b.exponent - 1), a.flags === b.flags ? 1 : 2, parse);
}
