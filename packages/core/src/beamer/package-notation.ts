import { requireArrayValue } from "../utils/collections.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { Span } from "../ast/types.js";
import { concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText, type MappedText } from "../text/source-map.js";
import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";
import { createBeamerSyntaxContext } from "./syntax.js";

export type ScientificNumber = { mantissa: string; exponent?: string };
export function parseScientificNumber(raw: string): ScientificNumber | null {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:[eE]([+-]?\d+))?$/u.exec(raw.trim());
  if (!match || !/^-?(?:0|[1-9]\d{0,3})(?:\.\d{1,4})?$/u.test(match[1] ?? "") || /^-0(?:\.0+)?$/u.test(match[1] ?? "") || (match[2] !== undefined && !Number.isSafeInteger(Number(match[2])))) return null;
  return { mantissa: requireArrayValue(match, 1), ...(match[2] !== undefined && Number(match[2]) !== 0 ? { exponent: String(Number(match[2])) } : {}) };
}
export type UnitFactor = { symbol: string; power: number; span: Span };
const symbols: Record<string, string> = { metre: "m", meter: "m", pascal: "Pa", second: "s", gram: "g", kilogram: "kg", ampere: "A", kelvin: "K", mole: "mol", hertz: "Hz", newton: "N", joule: "J", watt: "W", volt: "V" };
const prefixes: Record<string, string> = { milli: "m", kilo: "k", centi: "c", nano: "n", micro: "\\micro" };
export function parseUnitExpression(raw: string): UnitFactor[] | null {
  const factors: UnitFactor[] = [];
  let cursor = 0, prefix = "", prefixStart = 0, reciprocal = false;
  for (const token of raw.matchAll(/\\([A-Za-z]+)|\s+|./gu)) {
    if (token.index !== cursor) return null;
    cursor += token[0].length;
    if (/^\s+$/u.test(token[0])) continue;
    const name = token[1];
    if (!name) return null;
    if (name === "per") { if (prefix || reciprocal) return null; reciprocal = true; continue; }
    if (prefixes[name]) { if (prefix) return null; prefix = prefixes[name]; prefixStart = token.index; continue; }
    if (name === "squared" || name === "cubed") {
      const last = factors.at(-1); if (!last || prefix || reciprocal || Math.abs(last.power) !== 1) return null;
      last.power *= name === "squared" ? 2 : 3; last.span.to = cursor; continue;
    }
    if (!symbols[name]) return null;
    // Micro needs a separately specified glyph/font policy; keep it explicit.
    if (prefix === "\\micro") return null;
    factors.push({ symbol: prefix + symbols[name], power: reciprocal ? -1 : 1, span: { from: prefix ? prefixStart : token.index, to: cursor } });
    prefix = ""; reciprocal = false;
  }
  return factors.length && !prefix && !reciprocal ? factors : null;
}

/** siunitx v3's default decimal/scientific numbers and reciprocal units.
 * No package configuration, uncertainty, locale or S-column inference. */
export function projectBeamerScientificNotation(mapped: MappedText, diagnostics: Diagnostic[], source = mapped.text): MappedText {
  if (!/\\(?:SI|si|num)\b/u.test(mapped.text)) return mapped;
  const { syntax } = createBeamerSyntaxContext(mapped.text);
  const document = createBeamerSyntaxContext(source).syntax;
  const scopes = [...document.groups, ...matchTexSyntaxEnvironments(document).values()];
  const configuredAt = (offset: number) => document.controlsIn({ from: 0, to: offset }).some(command => {
    if (scopes.some(scope => scope.contentSpan.from <= command.span.from && command.span.to <= scope.contentSpan.to && !(scope.contentSpan.from <= offset && offset < scope.contentSpan.to))) return false;
    if (command.name === "sisetup") return true;
    if (command.name !== "usepackage" && command.name !== "RequirePackage") return false;
    const option = document.argumentAfter(command.span.to, "optional", source.length);
    const names = option && document.argumentAfter(option.span.to, "required", source.length);
    return names != null && source.slice(names.contentSpan.from, names.contentSpan.to).split(",").some(name => name.trim() === "siunitx");
  });
  const pieces: MappedText[] = []; let cursor = 0;
  for (const command of syntax.controls) {
    if (!["SI", "si", "num"].includes(command.name) || command.span.from < cursor) continue;
    const optional = syntax.argumentAfter(command.span.to, "optional", mapped.text.length);
    const first = syntax.argumentAfter(optional?.span.to ?? command.span.to, "required", mapped.text.length);
    const second = command.name === "SI" && first ? syntax.argumentAfter(first.span.to, "required", mapped.text.length) : null;
    if (!first || (command.name === "SI" && !second)) continue;
    const end = second?.span.to ?? first.span.to;
    const hit = projectInputRange(mapped.sourceMap, command.span.from, end);
    const owner = hit.kind === "source-range" ? { from: hit.from, to: hit.to } : { from: 0, to: 0 };
    const number = command.name === "si" ? null : parseScientificNumber(mapped.text.slice(first.contentSpan.from, first.contentSpan.to));
    const unitArg = command.name === "si" ? first : second;
    const factors = unitArg ? parseUnitExpression(mapped.text.slice(unitArg.contentSpan.from, unitArg.contentSpan.to)) : null;
    if (optional || configuredAt(owner.from) || (command.name !== "si" && !number) || (unitArg && !factors)) {
      diagnostics.push({ severity: "warning", code: "beamer-siunitx-unsupported", message: "Supported siunitx forms are default decimal/scientific numbers and named products/reciprocal units; options and this expression remain literal.", span: owner });
      continue;
    }
    const generated = (text: string, from?: number, to?: number) => {
      const hit = from !== undefined && to !== undefined ? projectInputRange(mapped.sourceMap, from, to) : null;
      return createGeneratedMappedText(text, "siunitx notation", hit?.kind === "source-range" ? { from: hit.from, to: hit.to } : owner);
    };
    const upright = "\\textnormal";
    const body: MappedText[] = [];
    if (number) {
      const raw = mapped.text.slice(first.contentSpan.from, first.contentSpan.to);
      const start = first.contentSpan.from + raw.indexOf(number.mantissa);
      for (const part of number.mantissa.matchAll(/\d+|./gu)) {
        const text = part[0], from = start + part.index;
        if (/\d/u.test(text)) body.push(generated(`${upright}{`), sliceMappedText(mapped, from, from + text.length), generated("}"));
        else body.push(sliceMappedText(mapped, from, from + text.length));
      }
      if (number.exponent !== undefined) body.push(generated(`\\times 10^{${number.exponent}}`));
    }
    if (number && factors) body.push(generated("\\,"));
    for (const [i, factor] of (factors ?? []).entries()) {
      if (i) body.push(generated("\\,"));
      const from = (unitArg?.contentSpan.from ?? 0) + factor.span.from, to = (unitArg?.contentSpan.from ?? 0) + factor.span.to;
      for (const letter of factor.symbol) body.push(generated(`${upright}{${letter}}`, from, to));
      if (factor.power !== 1) body.push(generated(`^{${factor.power}}`, from, to));
    }
    let node = syntax.tree.resolveInner(command.span.from + 1, 1), math = false;
    while (node.parent) { if (["InlineMath", "DisplayMath", "MathEnvironment"].includes(node.name)) math = true; node = node.parent; }
    pieces.push(sliceMappedText(mapped, cursor, command.span.from), generated(math ? "{" : "$"), ...body, generated(math ? "}" : "$"));
    cursor = end;
  }
  if (!cursor) return mapped;
  return concatMappedText([...pieces, sliceMappedText(mapped, cursor, mapped.text.length)]);
}
