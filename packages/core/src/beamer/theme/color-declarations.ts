import type { Span } from "../../ast/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry } from "../../options/types.js";
import { readTexBalancedDelimited } from "../../parser/tex-lexical.js";
import { resolveColorToCss, resolveDefineColorModel } from "../../semantic/style/colors.js";
import { beamerControlSequencesIn, beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, createBeamerSyntaxContext } from "../syntax.js";
import type { BeamerDelimitedSourceValue, BeamerDocumentModel } from "../types.js";
import type { BeamerThemeColor, ResolvedBeamerThemeColor } from "./types.js";

export type BeamerColorDeclarationEvent =
  | { kind: "beamer-color"; span: Span; role: BeamerDelimitedSourceValue; starred: boolean; entries: readonly OptionEntry[] }
  | { kind: "define-color"; span: Span; name: BeamerDelimitedSourceValue; model: BeamerDelimitedSourceValue; specification: BeamerDelimitedSourceValue; provide: boolean }
  | { kind: "color-alias"; span: Span; name: BeamerDelimitedSourceValue; expression: BeamerDelimitedSourceValue }
  | { kind: "use-color"; span: Span; role: BeamerDelimitedSourceValue; starred: boolean }
  | { kind: "color-diagnostic"; span: Span; diagnostic: Diagnostic };

/** Authored preamble declarations only. Commands stored inside macro definitions do not execute here. */
export function scanBeamerColorDeclarations(document: BeamerDocumentModel): BeamerColorDeclarationEvent[] {
  const context = createBeamerSyntaxContext(document.source);
  const limit = document.preamble.span.to;
  const events: BeamerColorDeclarationEvent[] = [];
  const names = new Set(["setbeamercolor", "definecolor", "providecolor", "colorlet", "usebeamercolor"]);
  for (const command of beamerControlSequencesIn(context, document.preamble.span)) {
    if (!names.has(command.name) || document.preamble.macroDefinitions.some(definition => definition.span.from <= command.from && definition.span.to >= command.to)) continue;
    const commandSpan = { from: command.from, to: command.to };
    let syntaxNode = context.syntax.tree.resolveInner(command.from + 1, 1);
    let grouped = false;
    while (syntaxNode.parent) {
      syntaxNode = syntaxNode.parent;
      if (syntaxNode.name === "Group") grouped = true;
    }
    if (grouped) {
      events.push(colorDiagnostic(commandSpan, "beamer-color-scoped-declaration", "Grouped preamble color declarations are not supported in this preview."));
      continue;
    }
    const optional = beamerOptionalArgumentAfter(context, command.to, limit);
    const first = beamerRequiredArgumentAfter(context, optional?.span.to ?? command.to, limit);
    if (!first) {
      events.push(colorDiagnostic(commandSpan, "beamer-color-missing-argument", `The \\${command.name} declaration is missing its color name or role.`));
      continue;
    }
    if (command.name === "usebeamercolor") {
      events.push({ kind: "use-color", role: first, starred: command.starred, span: { from: command.from, to: first.span.to } });
      continue;
    }
    const secondOptional = beamerOptionalArgumentAfter(context, first.span.to, limit);
    const second = beamerRequiredArgumentAfter(context, secondOptional?.span.to ?? first.span.to, limit);
    const third = second && beamerRequiredArgumentAfter(context, second.span.to, limit);
    const span = { from: command.from, to: (command.name === "definecolor" || command.name === "providecolor" ? third : second)?.span.to ?? first.span.to };
    if (optional || secondOptional) {
      events.push(colorDiagnostic(span, "beamer-color-unsupported-model-option", "Optional target-model conversions on color declarations are not supported in this preview."));
      continue;
    }
    if (!second || ((command.name === "definecolor" || command.name === "providecolor") && !third)) {
      events.push(colorDiagnostic(span, "beamer-color-missing-argument", `The \\${command.name} declaration is missing a required argument.`));
      continue;
    }
    if (command.name === "setbeamercolor") {
      // Reuse the shared source-ranged key parser; these synthetic delimiters
      // occupy the authored opening/closing brace offsets exactly.
      const entries = parseOptionListRaw(`[${document.source.slice(second.contentSpan.from, second.contentSpan.to)}]`, second.contentSpan.from - 1).entries;
      events.push({ kind: "beamer-color", role: first, starred: command.starred, entries, span });
    } else if (command.name === "colorlet") {
      events.push({ kind: "color-alias", name: first, expression: second, span });
    } else {
      events.push({ kind: "define-color", name: first, model: second, specification: third!, provide: command.name === "providecolor", span });
    }
  }
  return events;
}

function colorDiagnostic(span: Span, code: string, message: string): Extract<BeamerColorDeclarationEvent, { kind: "color-diagnostic" }> {
  return { kind: "color-diagnostic", span, diagnostic: { severity: "warning", span, code, message } };
}

export type BeamerColorDeclarationState = {
  colors: Record<string, BeamerThemeColor>;
  colorAliases: Record<string, string>;
  colorAliasRgb: Record<string, BeamerColorRgb>;
  diagnostics: Diagnostic[];
};

export function applyBeamerColorDeclaration(state: BeamerColorDeclarationState, event: BeamerColorDeclarationEvent, source: string, resolveRole: (role: string) => ResolvedBeamerThemeColor, resolveRoleRgb?: (role: string, field: "fg" | "bg") => BeamerColorRgb | null): void {
  if (event.kind === "color-diagnostic") { state.diagnostics.push(event.diagnostic); return; }
  if (event.kind === "use-color") {
    const role = event.role.value.trim();
    if (!role || /[\\{}]/u.test(role)) { state.diagnostics.push(colorDiagnostic(event.role.span, "beamer-color-invalid-role", "A Beamer color use requires a literal role name.").diagnostic); return; }
    if (event.starred) {
      const normal = resolveRole("normal text");
      state.colorAliases.fg = normal.fg ?? "#000000"; state.colorAliases.bg = normal.bg ?? "#ffffff";
      state.colorAliasRgb.fg = resolveRoleRgb?.("normal text", "fg") ?? colorRgb(state.colorAliases.fg)!;
      state.colorAliasRgb.bg = resolveRoleRgb?.("normal text", "bg") ?? colorRgb(state.colorAliases.bg)!;
    }
    const resolved = resolveRole(role);
    state.colorAliases[`${role}.fg`.toLowerCase()] = resolved.fg ?? state.colorAliases.fg ?? "#000000";
    state.colorAliases[`${role}.bg`.toLowerCase()] = resolved.bg ?? state.colorAliases.bg ?? "#ffffff";
    state.colorAliasRgb[`${role}.fg`.toLowerCase()] = resolveRoleRgb?.(role, "fg") ?? colorRgb(state.colorAliases[`${role}.fg`.toLowerCase()])!;
    state.colorAliasRgb[`${role}.bg`.toLowerCase()] = resolveRoleRgb?.(role, "bg") ?? colorRgb(state.colorAliases[`${role}.bg`.toLowerCase()])!;
    state.colorAliases.fg = state.colorAliases[`${role}.fg`.toLowerCase()];
    state.colorAliases.bg = state.colorAliases[`${role}.bg`.toLowerCase()];
    state.colorAliasRgb.fg = state.colorAliasRgb[`${role}.fg`.toLowerCase()];
    state.colorAliasRgb.bg = state.colorAliasRgb[`${role}.bg`.toLowerCase()];
    return;
  }
  if (event.kind === "define-color" || event.kind === "color-alias") {
    const name = event.name.value.trim().toLowerCase();
    if (!name || /[\\{}!]/u.test(name)) { state.diagnostics.push(colorDiagnostic(event.name.span, "beamer-color-invalid-name", "This color declaration requires a literal color name.").diagnostic); return; }
    if (event.kind === "define-color" && event.provide && (state.colorAliases[name] !== undefined || DEFAULT_RGB[name] !== undefined)) return;
    const color = event.kind === "define-color"
      ? event.model.value.trim() === "named"
        ? resolveColorToCss(event.specification.value, { resolveAlias: alias => state.colorAliases[alias.toLowerCase()] ?? null })
        : resolveDefineColorModel(event.model.value, event.specification.value)
      : resolveColorToCss(event.expression.value, { resolveAlias: alias => state.colorAliases[alias.toLowerCase()] ?? null });
    if (color) {
      const channels = event.kind === "define-color"
        ? definedColorRgb(event.model.value, event.specification.value, alias => state.colorAliasRgb[alias.toLowerCase()] ?? null) ?? colorRgb(color)!
        : resolveBeamerColorExpressionRgb(event.expression.value, alias => state.colorAliasRgb[alias.toLowerCase()] ?? null) ?? colorRgb(color)!;
      state.colorAliasRgb[name] = channels;
      state.colorAliases[name] = beamerColorRgbToCss(channels);
    }
    else state.diagnostics.push(colorDiagnostic(event.span, "beamer-color-unsupported-expression", `The color declaration '${name}' cannot be resolved in this preview.`).diagnostic);
    return;
  }
  const role = event.role.value.trim();
  if (!role || /[\\{}]/u.test(role)) { state.diagnostics.push(colorDiagnostic(event.role.span, "beamer-color-invalid-role", "A Beamer color declaration requires a literal role name.").diagnostic); return; }
  const color: BeamerThemeColor = event.starred ? {} : { ...state.colors[role] };
  for (const entry of event.entries) {
    if (entry.kind !== "kv" || !["fg", "bg", "parent", "use"].includes(entry.key)) {
      state.diagnostics.push(colorDiagnostic(entry.span, "beamer-color-unsupported-key", `This Beamer color key is not supported: ${entry.raw}.`).diagnostic);
      continue;
    }
    const valueSpan = entry.valueSpan ?? { from: entry.span.to, to: entry.span.to };
    const group = readTexBalancedDelimited(source, valueSpan.from, "{", "}");
    // The shared option parser masks TeX line comments without moving ranges.
    const rawValue = entry.valueRaw.trim();
    const value = (group?.to === valueSpan.to ? rawValue.slice(1, -1) : rawValue).trim();
    if (/\\/u.test(value) || ((entry.key === "fg" || entry.key === "bg") && value.split("!").some(part => [".", "fg", "bg", "parent.fg", "parent.bg"].includes(part.trim())))) {
      state.diagnostics.push(colorDiagnostic(valueSpan, "beamer-color-unsupported-expression", "Contextual color commands and current-color references are not supported in preamble Beamer colors.").diagnostic);
      continue;
    }
    if (entry.key === "parent") {
      delete color.parent;
      color.parents = value.split(",").map(parent => parent.trim()).filter(Boolean);
    } else if (entry.key === "use") {
      color.use = value.split(",").map(parent => parent.trim()).filter(Boolean);
    } else if (entry.key === "fg") {
      delete color.fg; delete color.fgMix; delete color.fgRgb;
      color.fgExpression = { value, span: valueSpan };
    } else {
      delete color.bg; delete color.bgMix;
      color.bgExpression = { value, span: valueSpan };
    }
  }
  state.colors[role] = color;
}

export type BeamerColorRgb = readonly [number, number, number];

// xcolor.sty's standard rgb definitions. Keep their fractional channels until
// the final CSS color so nested mixes do not accumulate byte-rounding errors.
const DEFAULT_RGB: Readonly<Record<string, BeamerColorRgb>> = {
  red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], brown: [.75, .5, .25], lime: [.75, 1, 0],
  orange: [1, .5, 0], pink: [1, .75, .75], purple: [.75, 0, .25], teal: [0, .5, .5], violet: [.5, 0, .5],
  cyan: [0, 1, 1], magenta: [1, 0, 1], yellow: [1, 1, 0], olive: [.5, .5, 0],
  black: [0, 0, 0], darkgray: [.25, .25, .25], gray: [.5, .5, .5], lightgray: [.75, .75, .75], white: [1, 1, 1],
};

export function resolveBeamerColorExpressionRgb(raw: string, resolveAlias: (name: string) => BeamerColorRgb | null): BeamerColorRgb | null {
  const parts = raw.trim().toLowerCase().split("!").map(part => part.trim());
  const channels = (token: string) => resolveAlias(token) ?? DEFAULT_RGB[token] ?? colorRgb(resolveColorToCss(token) ?? "");
  let result = channels(parts[0]);
  if (!result) return null;
  for (let index = 1; index < parts.length; index += 2) {
    if (parts[index] === "") return null;
    const percent = Number(parts[index]);
    const second = channels(parts[index + 1] || "white");
    if (!Number.isFinite(percent) || !second) return null;
    const boundedPercent = Math.max(0, Math.min(100, percent));
    result = boundedPercent === 100 ? result : boundedPercent === 0 ? second : [
      xcolorMixedChannel(result[0], second[0], boundedPercent),
      xcolorMixedChannel(result[1], second[1], boundedPercent),
      xcolorMixedChannel(result[2], second[2], boundedPercent),
    ];
  }
  return result;
}

/** XC@mix@: multiply 16-bit coefficients by percentage dimensions, then
 * XC@vec@@/rrshift reparses two decimal shifts through TeX dimensions. */
function xcolorMixedChannel(first: number, second: number, percent: number): number {
  const percentSp = Math.round(percent * 65536);
  let valueSp = Math.trunc(Math.round(first * 65536) * percentSp / 65536)
    + Math.trunc(Math.round(second * 65536) * (100 * 65536 - percentSp) / 65536);
  for (let shift = 0; shift < 2; shift++) valueSp = Math.round(Number(texPrintedScaled(valueSp)) / 10 * 65536);
  return Number(texPrintedScaled(valueSp));
}

/** TeX's print_scaled chooses a decimal that round-trips to the same scaled
 * point (e.g. 58982sp prints .9, not a fixed five-decimal .89999). */
function texPrintedScaled(valueSp: number): string {
  let result = `${Math.floor(valueSp / 65536)}.`;
  let remainder = 10 * (valueSp % 65536) + 5;
  let delta = 10;
  do {
    if (delta > 65536) remainder += 32768 - 50000;
    result += String(Math.floor(remainder / 65536));
    remainder = 10 * (remainder % 65536);
    delta *= 10;
  } while (remainder > delta);
  return result;
}

function definedColorRgb(model: string, raw: string, resolveAlias: (name: string) => BeamerColorRgb | null): BeamerColorRgb | null {
  const values = raw.split(",").map(value => Number(value.trim()));
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  if (values.every(Number.isFinite)) {
    if ((model.trim() === "rgb" || model.trim() === "RGB") && values.length === 3) {
      const scale = model.trim() === "RGB" ? 255 : 1;
      return [clamp(values[0] / scale), clamp(values[1] / scale), clamp(values[2] / scale)];
    }
    if (model.trim() === "gray" && values.length === 1) return [clamp(values[0]), clamp(values[0]), clamp(values[0])];
  }
  return model.trim() === "named" ? resolveBeamerColorExpressionRgb(raw, resolveAlias) : colorRgb(resolveDefineColorModel(model, raw) ?? "");
}

export function beamerColorRgbToCss(channels: BeamerColorRgb): string {
  return `#${channels.map(value => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`;
}

function colorRgb(css: string): BeamerColorRgb | null {
  if (/^#[0-9a-f]{3}$/iu.test(css)) css = `#${css.slice(1).split("").map(digit => digit + digit).join("")}`;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(css);
  return match ? [Number.parseInt(match[1], 16) / 255, Number.parseInt(match[2], 16) / 255, Number.parseInt(match[3], 16) / 255] : null;
}

/** Return unresolved expression/cycle diagnostics once, at bounded authored spans. */
export function diagnoseBeamerColorDeclarations(state: BeamerColorDeclarationState, events: readonly BeamerColorDeclarationEvent[], resolveRole: (role: string) => ResolvedBeamerThemeColor): void {
  const spans = new Map(events.filter((event): event is Extract<BeamerColorDeclarationEvent, { kind: "beamer-color" }> => event.kind === "beamer-color").map(event => [event.role.value.trim(), event.span]));
  const visiting = new Set<string>(), visited = new Set<string>(), cycles = new Set<string>();
  const visit = (role: string) => {
    if (visiting.has(role)) { cycles.add(role); return; }
    if (visited.has(role)) return;
    visiting.add(role);
    const color = state.colors[role];
    const dependencies = [...(color?.parents ?? (color?.parent ? [color.parent] : [])), ...(color?.use ?? [])];
    for (const expression of [color?.fgExpression, color?.bgExpression]) for (const token of expression?.value.split("!") ?? []) {
      const match = /^(.*)\.(?:fg|bg)$/u.exec(token.trim());
      if (match) dependencies.push(match[1]);
    }
    dependencies.forEach(visit);
    visiting.delete(role); visited.add(role);
  };
  Object.keys(state.colors).forEach(visit);
  for (const role of cycles) state.diagnostics.push(colorDiagnostic(spans.get(role) ?? events[0]?.span ?? { from: 0, to: 0 }, "beamer-color-parent-cycle", `The Beamer color '${role}' participates in an inheritance or use cycle.`).diagnostic);
  for (const role of spans.keys()) {
    const color = state.colors[role], resolved = resolveRole(role);
    for (const field of ["fg", "bg"] as const) {
      const expression = field === "fg" ? color.fgExpression : color.bgExpression;
      if (expression?.value && !resolved[field]) state.diagnostics.push(colorDiagnostic(expression.span, "beamer-color-unsupported-expression", `The ${field} expression for Beamer color '${role}' cannot be resolved in this preview.`).diagnostic);
    }
  }
}
