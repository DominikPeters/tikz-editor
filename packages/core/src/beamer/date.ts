import { concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText, type MappedText } from "../text/source-map.js";
import { createBeamerSyntaxContext } from "./syntax.js";
import type { MacroBinding } from "../macros/index.js";
import type { BeamerDocumentModel } from "./types.js";
import { preambleCommandScope } from "./preamble-edit-context.js";
import type { BeamerSyntaxContext } from "./syntax.js";

/** Freeze the compilation date once per prepared document, as TeX does. */
export function beamerDateBindings(document: BeamerDocumentModel, context: BeamerSyntaxContext, now = new Date()): { date: BeamerCompilationDate; bindings: ReadonlyMap<string, MacroBinding> } {
  const date = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  for (const control of context.syntax.controlsIn(document.preamble.span)) {
    if (control.name !== "year" && control.name !== "month" && control.name !== "day") continue;
    if (preambleCommandScope(document, control.span, context) !== "top-level") continue;
    const value = /^\s*=?\s*(\d+)(?!\d)/u.exec(document.source.slice(control.span.to));
    if (value) date[control.name] = Number(value[1]);
  }
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][date.month - 1] ?? "";
  return { date, bindings: new Map<string, MacroBinding>([["\\today", { kind: "text", value: `${month} ${date.day}, ${date.year}`, provenance: [] }]]) };
}

export type BeamerCompilationDate = { year: number; month: number; day: number };

export function beamerMetadataWithDefaultDate(document: BeamerDocumentModel): BeamerDocumentModel["preamble"]["metadata"] {
  if (document.preamble.metadata.date) return document.preamble.metadata;
  // Rendering defaults are not authored metadata: the inspector must still insert \date.
  const span = { from: document.preamble.span.to, to: document.preamble.span.to };
  return { ...document.preamble.metadata, date: { name: "date", span, commandSpan: span,
    value: { value: "\\today", span, contentSpan: span } } };
}

export function projectBeamerDateRegisters(mapped: MappedText, date?: BeamerCompilationDate): MappedText {
  if (!date || !/\\(?:number|the)\b/u.test(mapped.text)) return mapped;
  const context = createBeamerSyntaxContext(mapped.text);
  const parts: MappedText[] = [];
  let cursor = 0;
  for (const match of mapped.text.matchAll(/\\(?:number|the)\s*\\(year|month|day)(?![A-Za-z@])/gu)) {
    if (!context.syntax.controlByStart.has(match.index)) continue;
    const end = match.index + match[0].length;
    const owner = projectInputRange(mapped.sourceMap, match.index, end);
    parts.push(sliceMappedText(mapped, cursor, match.index), createGeneratedMappedText(String(match[1] === "year" ? date.year : match[1] === "month" ? date.month : date.day), "TeX compilation date register", owner.kind === "source-range" ? { from: owner.from, to: owner.to } : undefined));
    cursor = end;
  }
  if (!cursor) return mapped;
  parts.push(sliceMappedText(mapped, cursor, mapped.text.length));
  return concatMappedText(parts);
}
