/**
 * `\pgfmathprintnumber` and the `/pgf/number format/` keys.
 *
 * Ported from PGF 3.1.10 (LPPL): `generic/pgf/math/pgfmathfloat.code.tex`
 * (parser, digit-string rounding, the number printers and the display
 * styles) and `generic/pgf/libraries/pgflibraryfpu.code.tex` (the float
 * arithmetic `frac` needs). Everything works on decimal strings the way PGF
 * does; no step goes through a binary double, so rounding is PGF's
 * digit-string rounding.
 *
 * The output is the TeX math-mode source PGF produces (the token list
 * `\pgfmathprintnumberto` stores, without the `\pgfutilensuremath` wrapper)
 * plus a structured form so callers can measure or render the parts.
 */

import { pgfFloatDivide, pgfFloatMultiply, texDimenFromDecimal, texDimenToDecimal } from "./number-format-fpu.js";

export type PgfNumberPrinter = "std" | "fixed" | "sci" | "relative" | "fixed relative" | "int detect" | "int trunc" | "frac";

export type PgfSciDisplayStyle = "10^e" | "e" | "E" | "subscript" | "superscript" | "generic";

export type PgfRelativeRoundMode = "fixed" | "mantissa" | "compatible";

/** The state the `/pgf/number format/` keys set. Values are TeX source. */
export type PgfNumberFormat = {
  readonly printer: PgfNumberPrinter;
  /** `std=<lower>:<upper>`; `null` lower means `-precision/2` (truncated). */
  readonly stdLower: number | null;
  readonly stdUpper: number;
  readonly relativeExponent: number;
  readonly relativeRoundMode: PgfRelativeRoundMode;
  /** Option lists that make up the `every relative` style, in order. */
  readonly everyRelative: readonly string[];
  readonly fixedZerofill: boolean;
  readonly sciZerofill: boolean;
  readonly precision: number;
  /** `null`: follow `precision`. */
  readonly sciPrecision: number | null;
  readonly decimalSeparator: string;
  readonly thousandsSeparator: string;
  readonly decSepMark: string;
  readonly sciExponentMark: string;
  readonly thousandsSepInFractionals: boolean;
  readonly minExponentFor1000Sep: number;
  readonly showPositive: boolean;
  readonly readCommaAsPeriod: boolean;
  readonly skipZeroPeriod: boolean;
  readonly sciStyle: PgfSciDisplayStyle;
  /** The option list of the last `sci generic={...}`; `#1`..`#3` are exponent, flags, mantissa. */
  readonly sciGenericKeys: string;
  readonly sciGenericMantissaSep: string;
  readonly sciGenericEmptyMantissaSep: string;
  readonly sciGenericExponent: string;
  readonly retainUnitMantissa: boolean;
  readonly assumeMathMode: boolean;
  readonly fracTeX: string;
  /** Body of `\def\pgfmathresult{...}` in `frac whole format/.code`; `#1` is the whole part. */
  readonly fracWholeFormat: string;
  readonly fracDenominator: string;
  readonly fracWhole: boolean;
  readonly fracShift: number;
  readonly fracWarning: boolean;
};

export const PGF_NUMBER_FORMAT_PATH = "/pgf/number format/";

const BASE_FORMAT: PgfNumberFormat = {
  printer: "std",
  stdLower: null,
  stdUpper: 4,
  relativeExponent: 0,
  relativeRoundMode: "compatible",
  everyRelative: ["std"],
  fixedZerofill: false,
  sciZerofill: false,
  precision: 2,
  sciPrecision: null,
  decimalSeparator: "",
  thousandsSeparator: "",
  decSepMark: "",
  sciExponentMark: "",
  thousandsSepInFractionals: false,
  minExponentFor1000Sep: 0,
  showPositive: false,
  readCommaAsPeriod: false,
  skipZeroPeriod: false,
  sciStyle: "10^e",
  sciGenericKeys: "",
  sciGenericMantissaSep: "",
  sciGenericEmptyMantissaSep: "",
  sciGenericExponent: "",
  retainUnitMantissa: true,
  assumeMathMode: false,
  fracTeX: "\\frac",
  fracWholeFormat: "#1",
  fracDenominator: "",
  fracWhole: true,
  fracShift: 4,
  fracWarning: true
};

export type PgfNumberFormatDiagnostic = {
  code: "unknown-key" | "invalid-value" | "unsupported-key" | "invalid-number" | "unsupported-input";
  message: string;
  key?: string;
};


// ---------------------------------------------------------------------------
// Key parsing
// ---------------------------------------------------------------------------

type RawEntry = { key: string; value: string | null };

/** Split a pgfkeys list at top-level commas into key/value with pgfkeys' brace stripping. */
export function splitPgfKeyList(raw: string): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const item of splitTopLevel(raw, ",")) {
    let text = item;
    // `\pgfkeys@@normal#1,` strips braces around a whole entry.
    const whole = stripOuterGroup(text.trim());
    if (whole !== null && text.trim().length > 0) text = whole;
    if (text.trim().length === 0) continue;
    const eq = indexOfTopLevel(text, "=");
    if (eq < 0) {
      entries.push({ key: normalizeKeyName(text), value: null });
      continue;
    }
    entries.push({ key: normalizeKeyName(text.slice(0, eq)), value: stripPgfKeysValue(text.slice(eq + 1)) });
  }
  return entries;
}

function normalizeKeyName(raw: string): string {
  return raw.replace(/\s+/gu, " ").trim();
}

/**
 * pgfkeys strips one level of braces when the text after `=` is a single
 * group (`\pgfkeys@unpack` takes it as a delimited argument), trims spaces,
 * and strips another level in `\pgfkeys@spdef`.
 */
export function stripPgfKeysValue(raw: string): string {
  let value = raw;
  const first = stripOuterGroup(value);
  if (first !== null) value = first;
  value = trimTexSpaces(value);
  const second = stripOuterGroup(value);
  if (second !== null) value = second;
  return value;
}

/** Trim surrounding spaces, keeping the space of a trailing control symbol `\ `. */
function trimTexSpaces(text: string): string {
  let end = text.length;
  while (end > 0 && /\s/u.test(text[end - 1] ?? "")) {
    let backslashes = 0;
    for (let index = end - 2; index >= 0 && text[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 1) break;
    end -= 1;
  }
  return text.slice(0, end).replace(/^\s+/u, "");
}

/** Return the inside of `{...}` when the whole text is exactly one group. */
function stripOuterGroup(text: string): string | null {
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== text.length - 1) return null;
    }
  }
  return depth === 0 ? text.slice(1, -1) : null;
}

function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function indexOfTopLevel(text: string, needle: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === needle && depth === 0) return index;
  }
  return -1;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type PgfNumberFormatApplyResult = {
  format: PgfNumberFormat;
  diagnostics: PgfNumberFormatDiagnostic[];
};

/**
 * Apply `/pgf/number format/` keys in order (later keys override). Keys may be
 * relative to `/pgf/number format/` or carry that full path.
 */
export function applyPgfNumberFormatOptions(base: PgfNumberFormat, optionsRaw: string): PgfNumberFormatApplyResult {
  const state: Mutable<PgfNumberFormat> = { ...base, everyRelative: [...base.everyRelative] };
  const diagnostics: PgfNumberFormatDiagnostic[] = [];
  applyEntries(state, splitPgfKeyList(optionsRaw), diagnostics, 0);
  return { format: state, diagnostics };
}

/** Apply already split keys (paths relative to `/pgf/number format/`). */
export function applyPgfNumberFormatKey(base: PgfNumberFormat, key: string, value: string | null): PgfNumberFormatApplyResult {
  const state: Mutable<PgfNumberFormat> = { ...base, everyRelative: [...base.everyRelative] };
  const diagnostics: PgfNumberFormatDiagnostic[] = [];
  applyEntries(state, [{ key: normalizeKeyName(key), value }], diagnostics, 0);
  return { format: state, diagnostics };
}

const MAX_STYLE_DEPTH = 20;

function applyEntries(state: Mutable<PgfNumberFormat>, entries: readonly RawEntry[], diagnostics: PgfNumberFormatDiagnostic[], depth: number): void {
  if (depth > MAX_STYLE_DEPTH) {
    diagnostics.push({ code: "invalid-value", message: "number format styles nest too deeply" });
    return;
  }
  for (const entry of entries) applyEntry(state, entry, diagnostics, depth);
}

function applyStyle(state: Mutable<PgfNumberFormat>, list: string, diagnostics: PgfNumberFormatDiagnostic[], depth: number): void {
  applyEntries(state, splitPgfKeyList(list), diagnostics, depth + 1);
}

function parseTexInteger(raw: string): number | null {
  const match = /^\s*([-+\s]*)(\d+)\s*$/u.exec(raw);
  if (!match) return null;
  const negative = ((match[1] ?? "").match(/-/gu)?.length ?? 0) % 2 === 1;
  const value = Number.parseInt(match[2] ?? "0", 10);
  return negative ? -value : value;
}

function applyEntry(state: Mutable<PgfNumberFormat>, entry: RawEntry, diagnostics: PgfNumberFormatDiagnostic[], depth: number): void {
  let key = entry.key;
  if (key.startsWith("/")) {
    if (!key.startsWith(PGF_NUMBER_FORMAT_PATH)) {
      diagnostics.push({ code: "unknown-key", key, message: `key \`${key}\` is outside /pgf/number format/` });
      return;
    }
    key = key.slice(PGF_NUMBER_FORMAT_PATH.length);
  }
  const value = entry.value;
  const invalid = (what: string): void => {
    diagnostics.push({ code: "invalid-value", key, message: `invalid value \`${value ?? ""}\` for /pgf/number format/${key}: ${what}` });
  };
  const bool = (defaultValue: boolean | null): boolean | null => {
    if (value === null) {
      if (defaultValue === null) invalid("a boolean is required");
      return defaultValue;
    }
    if (value === "true") return true;
    if (value === "false") return false;
    invalid("expected true or false");
    return null;
  };
  const integer = (): number | null => {
    const parsed = parseTexInteger(value ?? "");
    if (parsed === null) invalid("expected an integer");
    return parsed;
  };
  const setBool = (field: BooleanField, defaultValue: boolean | null): void => {
    const parsed = bool(defaultValue);
    if (parsed !== null) state[field] = parsed;
  };

  switch (key) {
    case "fixed": state.printer = "fixed"; return;
    case "sci": state.printer = "sci"; return;
    case "std": {
      state.printer = "std";
      const param = (value ?? "").trim();
      if (param.length === 0) {
        state.stdLower = null;
        state.stdUpper = 4;
        return;
      }
      const colon = param.indexOf(":");
      const lower = parseTexInteger(colon < 0 ? param : param.slice(0, colon));
      const upper = colon < 0 ? 4 : parseTexInteger(param.slice(colon + 1));
      if (lower === null || upper === null) {
        invalid("expected <lower> or <lower>:<upper>");
        return;
      }
      state.stdLower = lower;
      state.stdUpper = upper;
      return;
    }
    case "relative round mode":
      if (value === "fixed" || value === "mantissa" || value === "compatible") state.relativeRoundMode = value;
      else invalid("expected fixed, mantissa or compatible");
      return;
    case "relative": {
      if (value === null) { invalid("a value is required"); return; }
      const parsed = Number.parseFloat(value.trim());
      if (!Number.isFinite(parsed)) { invalid("expected a number"); return; }
      state.printer = "relative";
      state.relativeExponent = Math.trunc(parsed + (parsed < 0 ? -0.5 : 0.5));
      return;
    }
    case "relative*":
      applyEntries(state, [{ key: "relative", value }, { key: "relative round mode", value: "fixed" }], diagnostics, depth + 1);
      return;
    case "every relative":
      // A style may redefine `every relative` while it runs; iterate the old list.
      for (const list of state.everyRelative.slice()) applyStyle(state, list, diagnostics, depth);
      return;
    case "every relative/.style":
      state.everyRelative = [value ?? ""];
      return;
    case "every relative/.append style":
    case "relative style":
      state.everyRelative = [...state.everyRelative, value ?? ""];
      return;
    case "every relative/.prefix style":
      state.everyRelative = [value ?? "", ...state.everyRelative];
      return;
    case "fixed relative": state.printer = "fixed relative"; return;
    case "int detect": state.printer = "int detect"; return;
    case "int trunc": state.printer = "int trunc"; return;
    case "frac": state.printer = "frac"; return;
    case "frac TeX": state.fracTeX = value ?? ""; return;
    case "frac whole format/.code": {
      const match = /^\s*\\def\s*\\pgfmathresult\s*\{([\s\S]*)\}\s*$/u.exec(value ?? "");
      if (match) state.fracWholeFormat = match[1] ?? "";
      else diagnostics.push({ code: "unsupported-key", key, message: "frac whole format/.code is supported only as \\def\\pgfmathresult{...}" });
      return;
    }
    case "frac denom": state.fracDenominator = (value ?? "").trim(); return;
    case "frac whole": setBool("fracWhole", null); return;
    case "frac shift": { const parsed = integer(); if (parsed !== null) state.fracShift = parsed; return; }
    case "frac warning": setBool("fracWarning", null); return;
    case "assume math mode": setBool("assumeMathMode", true); return;
    case "fixed zerofill": setBool("fixedZerofill", true); return;
    case "sci zerofill": setBool("sciZerofill", true); return;
    case "zerofill": {
      const parsed = bool(true);
      if (parsed !== null) { state.fixedZerofill = parsed; state.sciZerofill = parsed; }
      return;
    }
    case "precision": { const parsed = integer(); if (parsed !== null) state.precision = parsed; return; }
    case "sci precision": {
      const raw = (value ?? "").trim();
      if (raw.length === 0) { state.sciPrecision = null; return; }
      const parsed = integer();
      if (parsed !== null) state.sciPrecision = parsed;
      return;
    }
    case "fixed default": return;
    case "set decimal separator": state.decimalSeparator = value ?? ""; return;
    case "dec sep": applyEntries(state, [{ key: "set decimal separator", value: stripPgfKeysValue(`{${value ?? ""}}`) }], diagnostics, depth + 1); return;
    case "@dec sep mark": state.decSepMark = value ?? ""; return;
    case "@sci exponent mark": state.sciExponentMark = value ?? ""; return;
    case "set thousands separator": state.thousandsSeparator = value ?? ""; return;
    case "1000 sep in fractionals": setBool("thousandsSepInFractionals", true); return;
    case "1000 sep": applyEntries(state, [{ key: "set thousands separator", value: stripPgfKeysValue(`{${value ?? ""}}`) }], diagnostics, depth + 1); return;
    case "min exponent for 1000 sep": { const parsed = integer(); if (parsed !== null) state.minExponentFor1000Sep = parsed; return; }
    case "use period": applyStyle(state, "set decimal separator={.},set thousands separator={{{,}}}", diagnostics, depth); return;
    case "use comma": applyStyle(state, "set decimal separator={{{,}}},set thousands separator={.}", diagnostics, depth); return;
    case "showpos":
    case "print sign": setBool("showPositive", true); return;
    case "read comma as period": setBool("readCommaAsPeriod", true); return;
    case "skip 0.": setBool("skipZeroPeriod", true); return;
    case "sci 10^e":
    case "sci 10e": state.sciStyle = "10^e"; return;
    case "sci e": state.sciStyle = "e"; return;
    case "sci E": state.sciStyle = "E"; return;
    case "sci subscript": state.sciStyle = "subscript"; return;
    case "sci superscript": state.sciStyle = "superscript"; return;
    case "sci generic":
      if (value === null) { invalid("a value is required"); return; }
      state.sciStyle = "generic";
      state.sciGenericKeys = value;
      return;
    case "sci generic/mantissa sep":
    case "sci generic/mantisse sep": state.sciGenericMantissaSep = value ?? ""; return;
    case "sci generic/empty mantissa sep":
    case "sci generic/empty mantisse sep": state.sciGenericEmptyMantissaSep = value ?? ""; return;
    case "sci generic/exponent": state.sciGenericExponent = value ?? ""; return;
    case "verbatim":
      applyStyle(state, "sci generic={mantissa sep=,exponent={e#1}},1000 sep=,skip 0.=false,print sign=false,dec sep=.,assume math mode,frac TeX=\\pgfmathfloatfrac@verbatim,@dec sep mark=,@sci exponent mark=", diagnostics, depth);
      state.fracWholeFormat = "#1 ";
      return;
    case "retain unit mantissa": setBool("retainUnitMantissa", true); return;
    case "implementation":
      diagnostics.push({ code: "unsupported-key", key, message: "/pgf/number format/implementation is not supported" });
      return;
    default:
      diagnostics.push({ code: "unknown-key", key, message: `unknown key /pgf/number format/${key}` });
  }
}

type BooleanField = {
  [K in keyof PgfNumberFormat]: PgfNumberFormat[K] extends boolean ? K : never
}[keyof PgfNumberFormat];

// ---------------------------------------------------------------------------
// Float parsing (\pgfmathfloatparsenumber)
// ---------------------------------------------------------------------------

/** PGF's low-level float: flags 0 zero, 1 +, 2 -, 3 nan, 4 +inf, 5 -inf. */
export type PgfFloat = { flags: 0 | 1 | 2 | 3 | 4 | 5; mantissa: string; exponent: number };

export type PgfFloatParseResult = { float: PgfFloat; error: string | null };

const NAN_FLOAT: PgfFloat = { flags: 3, mantissa: "0.0", exponent: 0 };
const FLAG_VALUES: readonly PgfFloat["flags"][] = [0, 1, 2, 3, 4, 5];

/** Port of the `\pgfflt@*` state machine. Spaces are skipped as TeX's undelimited arguments do. */
export function parsePgfFloat(input: string, readCommaAsPeriod = false): PgfFloatParseResult {
  const text = input.replace(/\s+/gu, "");
  let index = 0;
  let flags: PgfFloat["flags"] = 1;
  let mantissa = "";
  let exponent = 0;
  let pendingPeriod = false;
  let pendingZeros = "";
  const fail = (message: string): PgfFloatParseResult => ({ float: NAN_FLOAT, error: message });
  const done = (): PgfFloatParseResult => {
    if (pendingPeriod) mantissa += ".0";
    return { float: { flags, mantissa, exponent }, error: null };
  };
  const zeroDone = (): PgfFloatParseResult => ({ float: { flags: 0, mantissa: "0.0", exponent }, error: null });
  const peek = (): string | null => (index < text.length ? text[index] ?? null : null);
  const isDigit = (char: string | null): boolean => char !== null && char >= "0" && char <= "9";
  const readExponent = (): PgfFloatParseResult | null => {
    const rest = text.slice(index);
    const match = /^([+-]*)(\d+)$/u.exec(rest);
    if (!match) return fail(`cannot read exponent \`${rest}\``);
    const negative = ((match[1] ?? "").match(/-/gu)?.length ?? 0) % 2 === 1;
    const value = Number.parseInt(match[2] ?? "0", 10);
    exponent += negative ? -value : value;
    index = text.length;
    return null;
  };
  const comma = (char: string | null): boolean => char === "," && readCommaAsPeriod;
  const readLowLevel = (flagText: string): PgfFloatParseResult => {
    const rest = text.slice(index);
    const match = /^([^e]*)e([^\]]*)\]$/u.exec(rest);
    const flagValue = FLAG_VALUES.find(value => String(value) === flagText);
    const parsedExponent = parseTexInteger(match?.[2] ?? "");
    if (!match || flagValue === undefined || parsedExponent === null) return fail(`malformed low-level float \`${input}\``);
    return { float: { flags: flagValue, mantissa: match[1] ?? "", exponent: parsedExponent }, error: null };
  };

  // sign
  const first = peek();
  if (first === null) return fail("empty number");
  if (first === "+") { flags = 1; index += 1; }
  else if (first === "-") { flags = 2; index += 1; }

  // state A
  const a = peek();
  index += 1;
  if (a === "0") return leadingZero();
  if (a !== null && a >= "1" && a <= "9") { mantissa = a; pendingPeriod = true; return positiveExp(); }
  if (a === "n" || a === "N") return readNan();
  if (a === "i" || a === "I") return readInf();
  if (a === "." || comma(a)) { exponent = -1; return afterLeadingZeroPeriod(); }
  if (a === ",") return fail(`unexpected decimal separator \`,\` in \`${input}\` (read comma as period?)`);
  return fail(`cannot parse \`${input}\` as a number`);

  function readNan(): PgfFloatParseResult {
    const c1 = text[index];
    const c2 = text[index + 1];
    if ((c1 === "a" || c1 === "A") && (c2 === "n" || c2 === "N")) return { float: NAN_FLOAT, error: null };
    return fail(`cannot parse \`${input}\` as a number`);
  }
  function readInf(): PgfFloatParseResult {
    const c1 = text[index];
    const c2 = text[index + 1];
    if ((c1 === "n" || c1 === "N") && (c2 === "f" || c2 === "F")) {
      return { float: { flags: flags === 1 ? 4 : 5, mantissa: "0.0", exponent: 0 }, error: null };
    }
    return fail(`cannot parse \`${input}\` as a number`);
  }
  // state B
  function leadingZero(): PgfFloatParseResult {
    for (;;) {
      const char = peek();
      index += 1;
      if (char === null) { exponent = 0; return zeroDone(); }
      if (char === "0") continue;
      if (char >= "1" && char <= "9") { mantissa = char; pendingPeriod = true; return positiveExp(); }
      if (char === "Y") return readLowLevel(String(mantissa === "" ? "0" : mantissa));
      if (char === "." || comma(char)) { exponent = -1; return afterLeadingZeroPeriod(); }
      if (char === "e" || char === "E") { exponent = 0; const error = readExponent(); return error ?? zeroDone(); }
      if (char === ",") return fail(`unexpected decimal separator \`,\` in \`${input}\` (read comma as period?)`);
      return fail(`cannot parse \`${input}\` as a number`);
    }
  }
  // state C
  function afterLeadingZeroPeriod(): PgfFloatParseResult {
    for (;;) {
      const char = peek();
      index += 1;
      if (char === null) { exponent = 0; return zeroDone(); }
      if (char === "0") { exponent -= 1; continue; }
      if (char >= "1" && char <= "9") { mantissa = char; pendingPeriod = true; return afterPeriod(); }
      if (char === "e" || char === "E") { exponent = 0; const error = readExponent(); return error ?? zeroDone(); }
      return fail(`cannot parse \`${input}\` as a number`);
    }
  }
  // states D and E
  function positiveExp(): PgfFloatParseResult {
    for (;;) {
      const char = peek();
      index += 1;
      if (char === null) return done();
      if (char === "0") { exponent += 1; pendingZeros += "0"; continue; }
      if (char >= "1" && char <= "9") {
        exponent += 1;
        if (pendingPeriod) { mantissa += "."; pendingPeriod = false; }
        mantissa += pendingZeros + char;
        pendingZeros = "";
        continue;
      }
      if (char === "Y" && pendingZeros === "") return readLowLevel(mantissa);
      if (char === "." || comma(char)) return afterPeriod();
      if (char === "e" || char === "E") { const error = readExponent(); return error ?? done(); }
      if (char === ",") return fail(`unexpected decimal separator \`,\` in \`${input}\` (read comma as period?)`);
      return fail(`cannot parse \`${input}\` as a number`);
    }
  }
  // states F and G
  function afterPeriod(): PgfFloatParseResult {
    for (;;) {
      const char = peek();
      index += 1;
      if (char === null) return done();
      if (char === "0") { pendingZeros += "0"; continue; }
      if (isDigit(char)) {
        if (pendingPeriod) { mantissa += "."; pendingPeriod = false; }
        mantissa += pendingZeros + char;
        pendingZeros = "";
        continue;
      }
      if (char === "e" || char === "E") { const error = readExponent(); return error ?? done(); }
      return fail(`cannot parse \`${input}\` as a number`);
    }
  }
}

// ---------------------------------------------------------------------------
// Digit-string rounding (\pgfmathroundto@impl)
// ---------------------------------------------------------------------------

export type PgfRoundResult = { result: string; hasPeriod: boolean; mayNeedRenormalize: boolean };

/** Port of `\pgfmathroundto@impl`: round a fixed-point digit string to `precision` digits after the period. */
export function pgfRoundTo(input: string, precision: number, zerofill: boolean): PgfRoundResult {
  let hasPeriod = true;
  let renormalize = false;
  const collected: string[] = [];
  let negativeZero = true;
  let offset = -1;
  let lastZeros = 0;
  let next: string | null = null;
  let index = 0;

  /** Collect up to `precision` digits after the period; returns the first digit beyond them. */
  const collectFraction = (): string | null => {
    collected.push(".");
    offset = 0;
    index += 1;
    while (index < input.length) {
      const char = input[index] ?? "";
      if (offset === precision) return char;
      offset += 1;
      if (char === "0") lastZeros += 1;
      else lastZeros = 0;
      collected.push(char);
      index += 1;
    }
    return null;
  };

  if (input.length === 0) {
    negativeZero = false;
  } else if (input[0] === ".") {
    negativeZero = false;
    next = collectFraction();
  } else {
    if (input[0] !== "-") negativeZero = false;
    collected.push(input[0] ?? "");
    index = 1;
    while (index < input.length) {
      const char = input[index] ?? "";
      if (char === ".") { next = collectFraction(); break; }
      if (char !== "0") negativeZero = false;
      collected.push(char);
      index += 1;
    }
  }

  const forward = (): string => collected.join("");
  const finishWithTruncation = (): string => {
    if (zerofill) {
      let text = forward();
      if (lastZeros === offset && negativeZero && text.startsWith("-")) text = text.slice(1);
      if (precision === 0) {
        hasPeriod = false;
        const dot = text.indexOf(".");
        return dot < 0 ? text : text.slice(0, dot);
      }
      return text + "0".repeat(Math.max(0, precision - offset));
    }
    if (lastZeros === offset) {
      hasPeriod = false;
      if (negativeZero) return "0";
      const dot = input.indexOf(".");
      return dot < 0 ? input : input.slice(0, dot);
    }
    const text = forward();
    return lastZeros === 0 ? text : text.slice(0, text.length - lastZeros);
  };

  const addOne = (): string => {
    let off = -offset;
    const reversed = [...collected].reverse();
    let acc = "";
    let position = 0;
    for (;;) {
      if (position >= reversed.length) { renormalize = true; return "1" + acc; }
      const char = reversed[position] ?? "";
      if (char === ".") {
        if (precision === 0) hasPeriod = false;
        else acc = "." + acc;
        position += 1;
        continue;
      }
      if (char === "+") { renormalize = true; return "1" + acc; }
      if (char === "-") { renormalize = true; return "-1" + acc; }
      position += 1;
      if (char === "9") {
        if (off >= 0 || zerofill) acc = "0" + acc;
        off += 1;
        if (off === 0 && !zerofill) {
          // `\pgfmathroundto@impl@ADD@ONE@ITERATE@gobble@dot.`
          position += 1;
          hasPeriod = false;
        }
        continue;
      }
      const digit = Number.parseInt(char, 10);
      acc = String(digit + 1) + acc;
      return reversed.slice(position).reverse().join("") + acc;
    }
  };

  let result: string;
  if (next === null) {
    if (offset < 0) {
      if (zerofill && precision !== 0) {
        result = input + "." + "0".repeat(Math.max(0, precision));
      } else {
        hasPeriod = false;
        result = input;
      }
    } else {
      result = finishWithTruncation();
    }
  } else if (Number.parseInt(next, 10) < 5) {
    result = finishWithTruncation();
  } else {
    result = addOne();
  }
  return { result, hasPeriod, mayNeedRenormalize: renormalize };
}

/** `\pgfmathfloattofixed`. */
export function pgfFloatToFixed(float: PgfFloat): string {
  switch (float.flags) {
    case 0: return "0.0";
    case 3: return "nan";
    case 4: return "inf";
    case 5: return "-inf";
    case 1: return mantissaToFixed(float.mantissa, float.exponent);
    case 2: return "-" + mantissaToFixed(float.mantissa, float.exponent);
  }
}

function mantissaToFixed(mantissa: string, exponent: number): string {
  const dot = mantissa.indexOf(".");
  const lead = dot < 0 ? mantissa : mantissa.slice(0, dot);
  const fraction = dot < 0 ? "" : mantissa.slice(dot + 1);
  if (exponent < 0) {
    const prefix = "0." + "0".repeat(-exponent - 1);
    return fraction === "0" ? prefix + lead : prefix + lead + fraction;
  }
  const digits = lead + fraction + "000000000";
  if (exponent + 1 < digits.length) return digits.slice(0, exponent + 1) + "." + digits.slice(exponent + 1);
  return digits.padEnd(exponent + 1, "0") + ".0";
}

type RoundedFloat = { float: PgfFloat; hasPeriod: boolean };

/** `\pgfmathfloatround` / `\pgfmathfloatroundzerofill`: round the mantissa. */
export function pgfFloatRound(float: PgfFloat, precision: number, zerofill: boolean): RoundedFloat {
  const first = pgfRoundTo(float.mantissa, precision, zerofill);
  let hasPeriod = first.hasPeriod;
  let mantissa = first.result;
  let exponent = float.exponent;
  if (first.mayNeedRenormalize) {
    const text = first.hasPeriod ? mantissa : mantissa + ".";
    const dot = text.indexOf(".");
    // `\pgfmathfloatround@impl@renormalize#1#2.#3`
    const head = text.slice(0, 1);
    const middle = text.slice(1, dot);
    const tail = text.slice(dot + 1);
    const second = pgfRoundTo(`${head}.${middle}${tail}`, precision, zerofill);
    mantissa = second.result;
    hasPeriod = hasPeriod && second.hasPeriod;
    exponent += 1;
  }
  return { float: { flags: float.flags, mantissa, exponent }, hasPeriod };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type PgfNumberPartRole =
  | "sign"
  | "integer"
  | "thousands-separator"
  | "decimal-separator-mark"
  | "decimal-separator"
  | "fraction"
  | "sci-exponent-mark"
  | "mantissa-separator"
  | "exponent"
  | "special"
  | "frac-whole"
  | "frac";

export type PgfNumberPart = {
  role: PgfNumberPartRole;
  /** TeX math-mode source of this part. */
  tex: string;
  /** The exponent of an `exponent` part, or `numerator/denominator` of a `frac` part. */
  value?: string;
};

export type PgfNumberOutputKind = "fixed" | "sci" | "frac" | "nan" | "inf";

export type PgfNumberOutput = {
  /** Math-mode TeX source, as `\pgfmathprintnumberto` stores it (minus the `\pgfutilensuremath` wrapper). */
  tex: string;
  /** `false` under `assume math mode`; otherwise PGF wraps the result in `\pgfutilensuremath`. */
  ensureMath: boolean;
  kind: PgfNumberOutputKind;
  /** Explicit sign printed in front of the number (or mantissa). */
  sign: "" | "+" | "-";
  /** Integer digits shown (without separators); for sci the mantissa's. Empty if suppressed by `skip 0.` or a unit mantissa. */
  integerDigits: string;
  /** Fraction digits shown, `null` when no decimal separator is printed. */
  fractionDigits: string | null;
  /** Exponent for sci output, `null` otherwise. */
  exponent: string | null;
  /** `false` when a unit mantissa was dropped (`retain unit mantissa=false`). */
  mantissaShown: boolean;
  parts: PgfNumberPart[];
  diagnostics: PgfNumberFormatDiagnostic[];
};

type Render = {
  parts: PgfNumberPart[];
  kind: PgfNumberOutputKind;
  exponent: string | null;
  mantissaShown: boolean;
};

/** Join TeX fragments, keeping a control word from swallowing a following letter. */
export function joinTexFragments(fragments: readonly string[]): string {
  let out = "";
  for (const fragment of fragments) {
    if (fragment.length === 0) continue;
    if (/\\[A-Za-z@]+$/u.test(out) && /^[A-Za-z@]/u.test(fragment)) out += " ";
    out += fragment;
  }
  return out;
}

type Ctx = {
  fmt: PgfNumberFormat;
  /** `\pgfmathfloat@round@precision@orig` when a printer overrode `precision`. */
  originalPrecision: number;
  diagnostics: PgfNumberFormatDiagnostic[];
};

function pushPart(parts: PgfNumberPart[], role: PgfNumberPartRole, tex: string, value?: string): void {
  if (tex.length === 0) return;
  parts.push(value === undefined ? { role, tex } : { role, tex, value });
}

/** `\pgfmathprintnumber@fixed@styleDEFAULT`. */
function fixedStyle(text: string, flags: number, exponent: number, hasPeriod: boolean, ctx: Ctx): PgfNumberPart[] {
  const fmt = ctx.fmt;
  const parts: PgfNumberPart[] = [];
  const counta = flags === 0 ? 0 : exponent;
  if (hasPeriod) {
    const dot = text.indexOf(".");
    const integer = dot < 0 ? text : text.slice(0, dot);
    const fraction = dot < 0 ? "" : text.slice(dot + 1);
    if (fmt.skipZeroPeriod && (integer === "0" || integer === "-0" || integer === "+0")) {
      if (integer !== "0") pushPart(parts, "sign", integer.slice(0, 1));
    } else {
      integerPart(integer, counta, ctx, parts);
    }
    pushPart(parts, "decimal-separator-mark", fmt.decSepMark);
    pushPart(parts, "decimal-separator", fmt.decimalSeparator);
    if (fmt.thousandsSepInFractionals) {
      for (let start = 0; start < fraction.length; start += 3) {
        if (start > 0) pushPart(parts, "thousands-separator", fmt.thousandsSeparator);
        pushPart(parts, "fraction", fraction.slice(start, start + 3));
      }
    } else {
      pushPart(parts, "fraction", fraction);
    }
  } else {
    integerPart(text, counta, ctx, parts);
    pushPart(parts, "decimal-separator-mark", fmt.decSepMark);
  }
  return parts;
}

function integerPart(text: string, counta: number, ctx: Ctx, parts: PgfNumberPart[]): void {
  const fmt = ctx.fmt;
  const signChar = text.startsWith("-") || text.startsWith("+") ? text.slice(0, 1) : "";
  const digits = signChar === "" ? text : text.slice(1);
  if (signChar !== "") pushPart(parts, "sign", signChar);
  else if (fmt.showPositive) pushPart(parts, "sign", "+");
  const grouped = fmt.thousandsSeparator !== "" && counta >= 0 && counta >= fmt.minExponentFor1000Sep;
  if (!grouped) {
    pushPart(parts, "integer", digits);
    return;
  }
  let count = counta + 1;
  if (count !== digits.length) {
    // PGF derives the group count from the exponent; if the digits disagree it
    // typesets stray tokens or loops forever. Group the digits actually present.
    ctx.diagnostics.push({ code: "unsupported-input", message: `PGF's 1000-separator logic expects ${count} integer digits but got \`${digits}\`` });
    count = digits.length;
  }
  const head = count % 3;
  if (head > 0) pushPart(parts, "integer", digits.slice(0, head));
  for (let start = head; start < count; start += 3) {
    if (start > 0) pushPart(parts, "thousands-separator", fmt.thousandsSeparator);
    pushPart(parts, "integer", digits.slice(start, start + 3));
  }
}

/** `\pgfmathfloatrounddisplaystyle` for the current sci style. */
function displayStyle(float: PgfFloat, hasPeriod: boolean, ctx: Ctx): Render {
  const fmt = ctx.fmt;
  const exponentText = String(float.exponent);
  let mantissaSep = "";
  let emptyMantissa = "";
  let exponentTex = "";
  switch (fmt.sciStyle) {
    case "10^e": mantissaSep = "\\cdot"; emptyMantissa = ""; exponentTex = `10^{${exponentText}}`; break;
    case "subscript": emptyMantissa = "1"; exponentTex = `_{${exponentText}}`; break;
    case "superscript": emptyMantissa = "1"; exponentTex = `^{${exponentText}}`; break;
    case "e":
    case "E": {
      const letter = fmt.sciStyle;
      emptyMantissa = "1";
      exponentTex = float.exponent < 0 ? `${letter}{-}${-float.exponent}` : `${letter}{+}${float.exponent}`;
      break;
    }
    case "generic": {
      let sep = fmt.sciGenericMantissaSep;
      let empty = fmt.sciGenericEmptyMantissaSep;
      let exp = fmt.sciGenericExponent;
      const substituted = fmt.sciGenericKeys
        .replace(/#1/gu, exponentText)
        .replace(/#2/gu, String(float.flags))
        .replace(/#3/gu, float.mantissa);
      for (const entry of splitPgfKeyList(substituted)) {
        const key = entry.key.startsWith("/pgf/number format/sci generic/") ? entry.key.slice("/pgf/number format/sci generic/".length) : entry.key;
        if (key === "mantissa sep" || key === "mantisse sep") sep = entry.value ?? "";
        else if (key === "empty mantissa sep" || key === "empty mantisse sep") empty = entry.value ?? "";
        else if (key === "exponent") exp = entry.value ?? "";
        else ctx.diagnostics.push({ code: "unknown-key", key: entry.key, message: `unknown key /pgf/number format/sci generic/${entry.key}` });
      }
      mantissaSep = sep;
      emptyMantissa = empty;
      exponentTex = exp;
      break;
    }
  }

  const parts: PgfNumberPart[] = [];
  const finishSci = (shown: boolean): Render => {
    pushPart(parts, "sci-exponent-mark", fmt.sciExponentMark);
    if (shown) pushPart(parts, "mantissa-separator", mantissaSep);
    pushPart(parts, "exponent", exponentTex, exponentText);
    return { parts, kind: "sci", exponent: exponentText, mantissaShown: shown };
  };
  const special = (tex: string, kind: PgfNumberOutputKind): Render => {
    pushPart(parts, "special", tex);
    pushPart(parts, "sci-exponent-mark", fmt.sciExponentMark);
    pushPart(parts, "decimal-separator-mark", fmt.decSepMark);
    return { parts, kind, exponent: null, mantissaShown: true };
  };

  switch (float.flags) {
    case 0:
      parts.push(...fixedStyle(float.mantissa, 0, 0, hasPeriod, ctx));
      return finishSci(true);
    case 1:
    case 2: {
      const draw = fmt.retainUnitMantissa || texDimenFromDecimal(float.mantissa) !== 65536;
      if (draw) {
        parts.push(...fixedStyle(float.flags === 2 ? "-" + float.mantissa : float.mantissa, float.flags, 0, hasPeriod, ctx));
        return finishSci(true);
      }
      if (float.flags === 2) pushPart(parts, "sign", "-");
      pushPart(parts, "integer", emptyMantissa);
      return finishSci(false);
    }
    case 3: return special("\\hbox{NaN}", "nan");
    case 4: return special(fmt.showPositive ? "+\\infty" : "\\infty", "inf");
    case 5: return special("-\\infty", "inf");
  }
}

function fixedRender(parts: PgfNumberPart[]): Render {
  return { parts, kind: "fixed", exponent: null, mantissaShown: true };
}

// --- printers --------------------------------------------------------------

function printFixed(float: PgfFloat, ctx: Ctx): Render {
  if (float.flags >= 3) return displayStyle(float, true, ctx);
  const fixed = pgfFloatToFixed(float);
  const rounded = pgfRoundTo(fixed, ctx.fmt.precision, ctx.fmt.fixedZerofill);
  const exponent = rounded.mayNeedRenormalize ? float.exponent + 1 : float.exponent;
  return fixedRender(fixedStyle(rounded.result, float.flags, exponent, rounded.hasPeriod, ctx));
}

function printSci(float: PgfFloat, ctx: Ctx): Render {
  const precision = ctx.fmt.sciPrecision ?? ctx.fmt.precision;
  const rounded = pgfFloatRound(float, precision, ctx.fmt.sciZerofill);
  return displayStyle(rounded.float, rounded.hasPeriod, ctx);
}

function printStd(float: PgfFloat, ctx: Ctx): Render {
  if (float.flags >= 3) return displayStyle(float, true, ctx);
  if (float.exponent > ctx.fmt.stdUpper) return printSci(float, ctx);
  const lower = ctx.fmt.stdLower ?? Math.trunc(ctx.originalPrecision / -2);
  if (float.exponent < lower) return printSci(float, ctx);
  return printFixed(float, ctx);
}

function printIntTrunc(float: PgfFloat, ctx: Ctx): Render {
  if (float.flags >= 3) return displayStyle(float, true, ctx);
  const fixed = pgfFloatToFixed(float);
  const dot = fixed.indexOf(".");
  return fixedRender(fixedStyle(dot < 0 ? fixed : fixed.slice(0, dot), float.flags, float.exponent, false, ctx));
}

function printIntDetect(float: PgfFloat, ctx: Ctx): Render {
  if (float.flags >= 3) return displayStyle(float, true, ctx);
  const rounded = pgfRoundTo(pgfFloatToFixed(float), 6, false);
  if (rounded.hasPeriod) return printSci(float, ctx);
  return fixedRender(fixedStyle(rounded.result, float.flags, float.exponent, false, ctx));
}

function withPeriod(mantissa: string, hasPeriod: boolean): string {
  return hasPeriod ? mantissa : mantissa + ".0";
}

function printFixedRelative(float: PgfFloat, ctx: Ctx): Render {
  const precision = ctx.fmt.precision - 1;
  const rounded = pgfFloatRound(float, precision, false);
  const exponent = rounded.float.flags === 0 ? 0 : rounded.float.exponent;
  const next: PgfFloat = { flags: rounded.float.flags, mantissa: withPeriod(rounded.float.mantissa, rounded.hasPeriod), exponent };
  const inner: Ctx = {
    fmt: { ...ctx.fmt, fixedZerofill: false, precision: 9999 },
    originalPrecision: precision,
    diagnostics: ctx.diagnostics
  };
  return printFixed(next, inner);
}

function printRelative(float: PgfFloat, ctx: Ctx): Render {
  const fmt = ctx.fmt;
  const shifted: PgfFloat = { ...float, exponent: float.exponent - fmt.relativeExponent };
  const roundFixed = fmt.relativeRoundMode === "fixed" || (fmt.relativeRoundMode === "compatible" && shifted.exponent <= 0);
  let result: PgfFloat;
  let hasPeriod: boolean;
  if (roundFixed) {
    const rounded = pgfRoundTo(pgfFloatToFixed(shifted), fmt.precision, false);
    result = parsePgfFloat(rounded.result).float;
    hasPeriod = true;
  } else {
    const rounded = pgfFloatRound(shifted, fmt.precision, false);
    result = rounded.float;
    hasPeriod = rounded.hasPeriod;
  }
  const exponent = result.flags === 0 ? 0 : result.exponent + fmt.relativeExponent;
  const next: PgfFloat = { flags: result.flags, mantissa: withPeriod(result.mantissa, hasPeriod), exponent };
  const styled: Mutable<PgfNumberFormat> = { ...fmt, everyRelative: [...fmt.everyRelative] };
  for (const list of fmt.everyRelative) applyStyle(styled, list, ctx.diagnostics, 0);
  styled.fixedZerofill = false;
  styled.sciZerofill = false;
  if (styled.printer === "relative") {
    ctx.diagnostics.push({ code: "invalid-value", key: "every relative", message: "The '/pgf/number format/every relative' style should set a valid display style" });
    styled.printer = "std";
  }
  const inner: Ctx = { fmt: { ...styled, precision: 9999 }, originalPrecision: fmt.precision, diagnostics: ctx.diagnostics };
  return printWith(next, inner);
}

function printWith(float: PgfFloat, ctx: Ctx): Render {
  switch (ctx.fmt.printer) {
    case "std": return printStd(float, ctx);
    case "fixed": return printFixed(float, ctx);
    case "sci": return printSci(float, ctx);
    case "relative": return printRelative(float, ctx);
    case "fixed relative": return printFixedRelative(float, ctx);
    case "int detect": return printIntDetect(float, ctx);
    case "int trunc": return printIntTrunc(float, ctx);
    case "frac": return printFrac(float, ctx);
  }
}

// --- frac ------------------------------------------------------------------

/** `\pgfmathfloatgetfrac@`: `{whole}{numerator}{denominator}`. */
export function pgfFloatGetFrac(float: PgfFloat, fmt: PgfNumberFormat): [string, string, string] {
  switch (float.flags) {
    case 0: return ["0", "0", "1"];
    case 3: return ["", "NaN", "1"];
    case 4: return ["", "\\infty", "1"];
    case 5: return ["-", "\\infty", "1"];
    case 1:
    case 2: break;
  }
  const negative = float.flags === 2;
  let mantissa = float.mantissa;
  let exponent = float.exponent;
  let whole = "";
  if (exponent >= 0) {
    const fixed = mantissaToFixed(mantissa, exponent);
    const dot = fixed.indexOf(".");
    whole = fixed.slice(0, dot);
    const reparsed = parsePgfFloat("0." + fixed.slice(dot + 1)).float;
    mantissa = reparsed.mantissa;
    exponent = reparsed.exponent;
  }
  const dot = mantissa.indexOf(".");
  const mantissaBelowOne = "0." + (dot < 0 ? "" : mantissa.slice(dot + 1));
  const toInt = (text: string): number => {
    const point = text.indexOf(".");
    const intPart = Number.parseInt(point < 0 ? text : text.slice(0, point), 10) || 0;
    const frac = point < 0 ? "" : text.slice(point + 1);
    return texDimenFromDecimal("0." + frac) > 32768 ? intPart + 1 : intPart;
  };
  let numerator: number;
  let denominator: number;
  const target = fmt.fracDenominator;
  if (target === "") {
    exponent = -exponent;
    let factor: number;
    let scaledNumerator: string;
    if (texDimenFromDecimal(mantissaBelowOne) === 0) {
      factor = 1;
      scaledNumerator = mantissa;
    } else {
      const parse = (text: string): PgfFloat => parsePgfFloat(text).float;
      const inverse = pgfFloatDivide({ flags: 1, mantissa: "1.0", exponent: 0 }, parse(mantissaBelowOne), parse);
      const scale: PgfFloat = { flags: 1, mantissa: "1.0", exponent: fmt.fracShift };
      const factorFloat = pgfFloatMultiply(inverse, scale, parse);
      scaledNumerator = pgfFloatToFixed(pgfFloatMultiply(factorFloat, parse(mantissa), parse));
      factor = toInt(pgfFloatToFixed(factorFloat));
    }
    denominator = factor;
    while (exponent > 0) { denominator *= 10; exponent -= 1; }
    numerator = toInt(scaledNumerator);
    const divisor = gcd(numerator, denominator);
    numerator = Math.trunc(numerator / divisor);
    denominator = Math.trunc(denominator / divisor);
  } else {
    denominator = Number.parseInt(target, 10);
    const fixed = mantissaToFixed(mantissa, exponent);
    const product = texDimenFromDecimal(fixed) * denominator;
    numerator = toInt(texDimenToDecimal(product));
  }
  if (!fmt.fracWhole && whole !== "") {
    numerator += Number.parseInt(whole, 10) * denominator;
    whole = "";
  }
  return [negative ? "-" + whole : whole, String(numerator), String(denominator)];
}

/** `\pgfmathgreatestcommondivisor` (subtraction based; gcd(0, n) = n). */
function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  if (x === 0) return y;
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

function printFrac(float: PgfFloat, ctx: Ctx): Render {
  const fmt = ctx.fmt;
  const [rawWhole, numerator, denominator] = pgfFloatGetFrac(float, fmt);
  const parts: PgfNumberPart[] = [];
  if (rawWhole === "") {
    if (fmt.showPositive) pushPart(parts, "sign", "+");
  } else {
    // `\pgfmathprintnumber@frac@formatresult` also tests `\ifx<macro>-` and
    // `\ifx<macro>+`, which never hold, so a bare `-` gets the showpos `+` and
    // the whole-number format too (`+-\frac{1}{2}`, verbatim `- 1/2`).
    const signed = fmt.showPositive ? "+" + rawWhole : rawWhole;
    const wholeTex = fmt.fracWholeFormat.replace(/#1/gu, signed);
    pushPart(parts, /^[+-]+\s*$/u.test(wholeTex) ? "sign" : "frac-whole", wholeTex);
  }
  if (numerator !== "0") {
    const fracTex = fmt.fracTeX === "\\pgfmathfloatfrac@verbatim" ? `${numerator}/${denominator}` : joinTexFragments([fmt.fracTeX, `{${numerator}}{${denominator}}`]);
    pushPart(parts, "frac", fracTex, `${numerator}/${denominator}`);
  }
  return { parts, kind: float.flags === 3 ? "nan" : float.flags >= 4 ? "inf" : "frac", exponent: null, mantissaShown: true };
}

// --- entry point -------------------------------------------------------------

/** Convert a JS number to the decimal text PGF would read. */
function numberToInput(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (value === Number.POSITIVE_INFINITY) return "inf";
  if (value === Number.NEGATIVE_INFINITY) return "-inf";
  return String(value);
}

/**
 * Format `input` as `\pgfmathprintnumber` does under `options`. `input` is the
 * (macro-expanded) argument text: decimal or sci notation of any length,
 * PGF's low-level float `1Y1.5e2]`, `inf`, `nan`; numbers are converted with
 * `String()`.
 */
export function formatPgfNumber(input: string | number, options: PgfNumberFormat = DEFAULT_PGF_NUMBER_FORMAT): PgfNumberOutput {
  const text = typeof input === "number" ? numberToInput(input) : input;
  const diagnostics: PgfNumberFormatDiagnostic[] = [];
  const parsed = parsePgfFloat(text, options.readCommaAsPeriod);
  if (parsed.error !== null) diagnostics.push({ code: "invalid-number", message: parsed.error });
  const ctx: Ctx = { fmt: options, originalPrecision: options.precision, diagnostics };
  const render = printWith(parsed.float, ctx);
  return summarize(render, options, diagnostics);
}

function summarize(render: Render, options: PgfNumberFormat, diagnostics: PgfNumberFormatDiagnostic[]): PgfNumberOutput {
  const parts = render.parts;
  const mantissaParts = render.kind === "sci" ? parts.slice(0, Math.max(0, parts.findIndex(part => part.role === "exponent" || part.role === "sci-exponent-mark" || part.role === "mantissa-separator"))) : parts;
  const signPart = mantissaParts.find(part => part.role === "sign");
  const sign = signPart?.tex === "+" || signPart?.tex === "-" ? signPart.tex : "";
  const integerDigits = render.mantissaShown ? mantissaParts.filter(part => part.role === "integer").map(part => part.tex).join("") : "";
  const hasDecimal = mantissaParts.some(part => part.role === "decimal-separator") || mantissaParts.some(part => part.role === "fraction");
  const fractionDigits = hasDecimal ? mantissaParts.filter(part => part.role === "fraction").map(part => part.tex).join("") : null;
  return {
    tex: joinTexFragments(parts.map(part => part.tex)),
    ensureMath: !options.assumeMathMode,
    kind: render.kind,
    sign,
    integerDigits,
    fractionDigits,
    exponent: render.exponent,
    mantissaShown: render.mantissaShown,
    parts,
    diagnostics
  };
}

/** The initial state after loading PGF (`use period` and `std` applied). */
export const DEFAULT_PGF_NUMBER_FORMAT: PgfNumberFormat = applyPgfNumberFormatOptions(BASE_FORMAT, "use period").format;
