/**
 * `\pgfmathprintnumber` / `\pgfmathprintnumberto` in node text, and the
 * `/pgf/number format/` state that `\pgfkeys` and `\tikzset` set.
 *
 * PGF keeps that state in pgfkeys macros, which TeX scopes like any other
 * macro. Here it lives in the frame's macro bindings under a name no control
 * word can spell, as the ordered list of number-format keys applied so far;
 * the state is rebuilt from that list (cached) when a number is printed.
 */

import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings, expandMacroBindingsMapped, type MacroExpansionOptions } from "../../macros/expand.js";
import type { MacroBinding } from "../../macros/types.js";
import {
  concatMappedText,
  createGeneratedMappedText,
  createIdentityMappedText,
  projectInputRange,
  sliceMappedText,
  type MappedText,
  type TextSourceRange
} from "../../text/source-map.js";
import {
  DEFAULT_PGF_NUMBER_FORMAT,
  PGF_NUMBER_FORMAT_PATH,
  applyPgfNumberFormatOptions,
  formatPgfNumber,
  type PgfNumberFormat,
  type PgfNumberFormatDiagnostic
} from "./number-format.js";

/** Binding that holds the scoped number-format key list (not a valid control word, so never expanded). */
export const PGF_NUMBER_FORMAT_STATE_BINDING = "\\pgf number format state";

const formatCache = new Map<string, PgfNumberFormat>();
const FORMAT_CACHE_LIMIT = 64;

function formatFromState(state: string): PgfNumberFormat {
  if (state.length === 0) return DEFAULT_PGF_NUMBER_FORMAT;
  const cached = formatCache.get(state);
  if (cached) return cached;
  const format = applyPgfNumberFormatOptions(DEFAULT_PGF_NUMBER_FORMAT, state).format;
  if (formatCache.size >= FORMAT_CACHE_LIMIT) formatCache.clear();
  formatCache.set(state, format);
  return format;
}

function stateOf(bindings: ReadonlyMap<string, MacroBinding>): string {
  const binding = bindings.get(PGF_NUMBER_FORMAT_STATE_BINDING);
  return binding?.kind === "text" ? binding.value : "";
}

/** The `/pgf/number format/` state in effect for these bindings. */
export function readPgfNumberFormat(bindings: ReadonlyMap<string, MacroBinding>): PgfNumberFormat {
  return formatFromState(stateOf(bindings));
}

/** The binding that records `entries` (relative `/pgf/number format/` keys) after the current state. */
export function pgfNumberFormatStateBinding(bindings: ReadonlyMap<string, MacroBinding>, entries: readonly string[]): MacroBinding {
  const previous = stateOf(bindings);
  const value = [previous, ...entries].filter(entry => entry.length > 0).join(",");
  return { kind: "text", value, provenance: [] };
}

/** Validate number-format keys the way applying them would (unknown keys, bad values). */
export function diagnosePgfNumberFormatKeys(entries: readonly string[]): PgfNumberFormatDiagnostic[] {
  return applyPgfNumberFormatOptions(DEFAULT_PGF_NUMBER_FORMAT, entries.join(",")).diagnostics;
}

// ---------------------------------------------------------------------------
// Key lists in \pgfkeys / \tikzset payloads
// ---------------------------------------------------------------------------

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

function stripWholeGroup(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return text;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0 && index !== trimmed.length - 1) return text;
  }
  return depth === 0 ? trimmed.slice(1, -1) : text;
}

function withTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/**
 * Pick the `/pgf/number format/` keys out of a `\pgfkeys` (default path `/`)
 * or `\tikzset` (default path `/tikz/`, where TikZ forwards unknown keys to
 * `/pgf/`) payload, following `.cd`. Returns raw entries relative to
 * `/pgf/number format/`, value text untouched so pgfkeys' brace stripping
 * applies once, as in TeX.
 */
export function collectPgfNumberFormatKeys(payloadRaw: string, mode: "pgfkeys" | "tikz"): string[] {
  return partitionPgfNumberFormatKeys(splitTopLevel(stripWholeGroup(payloadRaw), ","), mode).entries;
}

/**
 * The same over separate list items; `consumed[i]` says whether item `i` is a
 * number-format key (or a `.cd` into that directory) that other key handling
 * should skip.
 */
export function partitionPgfNumberFormatKeys(items: readonly string[], mode: "pgfkeys" | "tikz"): { entries: string[]; consumed: boolean[] } {
  const entries: string[] = [];
  const consumed: boolean[] = [];
  let path = mode === "pgfkeys" ? "/" : "/tikz/";
  const resolve = (key: string): string => {
    const full = key.startsWith("/") ? key : path + key;
    return mode === "tikz" && full.startsWith("/tikz/number format/") ? "/pgf/" + full.slice("/tikz/".length) : full;
  };
  for (const item of items) {
    const entry = stripWholeGroup(item);
    const eq = indexOfTopLevelEquals(entry);
    const key = (eq < 0 ? entry : entry.slice(0, eq)).replace(/\s+/gu, " ").trim();
    if (key.length === 0) { consumed.push(false); continue; }
    if (key === ".cd" || key.endsWith("/.cd")) {
      path = withTrailingSlash(resolve(key.slice(0, -".cd".length)));
      consumed.push(path.startsWith(PGF_NUMBER_FORMAT_PATH));
      continue;
    }
    const full = resolve(key);
    const isNumberFormat = full.startsWith(PGF_NUMBER_FORMAT_PATH);
    consumed.push(isNumberFormat);
    if (isNumberFormat) entries.push(full.slice(PGF_NUMBER_FORMAT_PATH.length) + (eq < 0 ? "" : entry.slice(eq)));
  }
  return { entries, consumed };
}

function indexOfTopLevelEquals(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "=" && depth === 0) return index;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Node text
// ---------------------------------------------------------------------------

type Invocation = {
  start: number;
  end: number;
  optionsRaw: string;
  argumentRaw: string;
  /** `\pgfmathprintnumberto`: the target macro name. */
  target?: string;
};

const PRINT_NUMBER = "\\pgfmathprintnumber";

function skipSpaces(text: string, index: number): number {
  let cursor = index;
  while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) cursor += 1;
  return cursor;
}

function readGroup(text: string, index: number): { inner: string; end: number } | null {
  if (text[index] !== "{") return null;
  let depth = 0;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === "\\") { cursor += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return { inner: text.slice(index + 1, cursor), end: cursor + 1 };
  }
  return null;
}

/** One undelimited TeX argument: a group, a control sequence or a character. */
function readArgument(text: string, index: number): { raw: string; end: number } | null {
  const start = skipSpaces(text, index);
  if (start >= text.length) return null;
  const group = readGroup(text, start);
  if (group) return { raw: group.inner, end: group.end };
  if (text[start] === "{" || text[start] === "}") return null;
  if (text[start] === "\\") {
    const word = /^\\(?:[A-Za-z@]+|.)/u.exec(text.slice(start));
    return word ? { raw: word[0], end: start + word[0].length } : null;
  }
  return { raw: text[start] ?? "", end: start + 1 };
}

function readOptional(text: string, index: number): { raw: string; end: number } | null {
  const start = skipSpaces(text, index);
  if (text[start] !== "[") return null;
  let depth = 0;
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (char === "\\") { cursor += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "]" && depth === 0) return { raw: text.slice(start + 1, cursor), end: cursor + 1 };
  }
  return null;
}

function findInvocation(text: string, from: number): Invocation | null {
  let search = from;
  for (;;) {
    const start = text.indexOf(PRINT_NUMBER, search);
    if (start < 0) return null;
    let cursor = start + PRINT_NUMBER.length;
    let isTo = false;
    if (text.startsWith("to", cursor) && !/[A-Za-z@]/u.test(text[cursor + 2] ?? "")) {
      isTo = true;
      cursor += 2;
    } else if (/[A-Za-z@]/u.test(text[cursor] ?? "")) {
      search = cursor;
      continue;
    }
    const optional = readOptional(text, cursor);
    if (optional) cursor = optional.end;
    const argument = readArgument(text, cursor);
    if (!argument) { search = cursor; continue; }
    cursor = argument.end;
    if (isTo) {
      const target = readArgument(text, cursor);
      const name = target ? target.raw.trim() : "";
      if (!target || !/^\\[A-Za-z@]+$/u.test(name)) { search = cursor; continue; }
      return { start, end: target.end, optionsRaw: optional?.raw ?? "", argumentRaw: argument.raw, target: name };
    }
    return { start, end: cursor, optionsRaw: optional?.raw ?? "", argumentRaw: argument.raw };
  }
}

export type PrintNumberExpansion = {
  text: MappedText;
  /** Whether any `\pgfmathprintnumber` was replaced. */
  used: boolean;
  diagnostics: PgfNumberFormatDiagnostic[];
};

function ownerRange(input: MappedText, start: number, end: number): TextSourceRange {
  const hit = projectInputRange(input.sourceMap, start, end);
  if (hit.kind === "source-offset") return { from: hit.offset, to: hit.offset };
  if (hit.kind === "source-range") return { from: hit.from, to: hit.to };
  return { from: start, to: end };
}

/**
 * Replace `\pgfmathprintnumber[opts]{x}` with the TeX PGF typesets (wrapped in
 * `\ensuremath` unless `assume math mode`). The argument and options are
 * macro-expanded first, as PGF's `\edef` does. `\pgfmathprintnumberto[opts]{x}{\m}`
 * defines `\m` for the rest of the text (node text is a TeX group).
 */
export function expandPgfMathPrintNumberMapped(
  input: MappedText,
  bindings: ReadonlyMap<string, MacroBinding>
): PrintNumberExpansion {
  if (!input.text.includes(PRINT_NUMBER)) return { text: input, used: false, diagnostics: [] };
  const diagnostics: PgfNumberFormatDiagnostic[] = [];
  const parts: MappedText[] = [];
  let cursor = 0;
  let used = false;
  let current = input;
  let localBindings: ReadonlyMap<string, MacroBinding> = bindings;
  for (;;) {
    const invocation = findInvocation(current.text, cursor);
    if (!invocation) break;
    used = true;
    if (invocation.start > cursor) parts.push(sliceMappedText(current, cursor, invocation.start));
    const expand = (raw: string): string => expandMacroBindings(raw, localBindings, { maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH });
    const applied = applyPgfNumberFormatOptions(readPgfNumberFormat(localBindings), expand(invocation.optionsRaw));
    diagnostics.push(...applied.diagnostics);
    const output = formatPgfNumber(expand(invocation.argumentRaw).trim(), applied.format);
    diagnostics.push(...output.diagnostics);
    const tex = output.ensureMath ? `\\ensuremath{${output.tex}}` : output.tex;
    if (invocation.target === undefined) {
      parts.push(createGeneratedMappedText(tex, "\\pgfmathprintnumber", ownerRange(current, invocation.start, invocation.end)));
      cursor = invocation.end;
      continue;
    }
    // \pgfmathprintnumberto: bind the target for the remainder of the text.
    const extended = new Map(localBindings);
    extended.set(invocation.target, { kind: "text", value: tex, provenance: [] });
    localBindings = extended;
    const rest = sliceMappedText(current, invocation.end, current.text.length);
    current = expandMacroBindingsMapped(rest, new Map([[invocation.target, { kind: "text", value: tex, provenance: [] }]]));
    cursor = 0;
  }
  parts.push(sliceMappedText(current, cursor, current.text.length));
  return { text: concatMappedText(parts), used, diagnostics };
}

/**
 * Macro-expand node text with `\pgfmathprintnumber` handled: once before
 * expansion (so `\pgfmathprintnumber\x` reads the whole value of `\x`) and once
 * after (for macros whose bodies print numbers).
 */
export function expandNodeTextWithNumberPrinting(
  text: string,
  bindings: ReadonlyMap<string, MacroBinding>,
  opts: MacroExpansionOptions & { sourceOffset: number }
): PrintNumberExpansion {
  if (!text.includes(PRINT_NUMBER)) {
    const expanded = expandMacroBindingsMapped(text, bindings, opts);
    if (!expanded.text.includes(PRINT_NUMBER)) return { text: expanded, used: false, diagnostics: [] };
    return expandPgfMathPrintNumberMapped(expanded, bindings);
  }
  const before = expandPgfMathPrintNumberMapped(createIdentityMappedText(text, opts.sourceOffset), bindings);
  const expanded = expandMacroBindingsMapped(before.text, bindings, opts);
  const after = expandPgfMathPrintNumberMapped(expanded, bindings);
  return { text: after.text, used: before.used || after.used, diagnostics: [...before.diagnostics, ...after.diagnostics] };
}

/** String form of {@link expandPgfMathPrintNumberMapped}. */
export function expandPgfMathPrintNumber(input: string, bindings: ReadonlyMap<string, MacroBinding>): string {
  if (!input.includes(PRINT_NUMBER)) return input;
  return expandPgfMathPrintNumberMapped(createIdentityMappedText(input), bindings).text.text;
}
