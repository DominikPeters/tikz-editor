import type { Span } from "../ast/types.js";
import { layout, sourceSlice, tikz, type TikzFragment } from "../edit/fragment.js";
import { beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, createBeamerSyntaxContext, type BeamerSyntaxContext } from "./syntax.js";
import type { BeamerDocumentModel, BeamerThemeKind, BeamerThemeUseModel } from "./types.js";

export type BeamerPreambleEditBlocker = { reason: string; span: Span };
type PreambleScope = "top-level" | "macro" | "scoped";
const scopeCache = new WeakMap<BeamerDocumentModel, ReadonlyMap<number, PreambleScope>>();
const primitiveConditionals = new Set(["if", "ifcat", "ifnum", "ifdim", "ifodd", "ifvmode", "ifhmode", "ifmmode", "ifinner", "ifvoid", "ifhbox", "ifvbox", "ifx", "ifeof", "iftrue", "iffalse", "ifcase", "ifdefined", "ifcsname", "iffontchar"]);

/** Macro bodies are stored code; groups, hooks and conditionals are not safe edit targets. */
export function preambleCommandScope(
  document: BeamerDocumentModel,
  span: Span,
  context: BeamerSyntaxContext = createBeamerSyntaxContext(document.source)
): PreambleScope {
  const cached = scopeCache.get(document);
  if (cached) return cached.get(span.from) ?? "scoped";
  const scopes = new Map<number, PreambleScope>();
  const inMacro = (at: number): boolean => document.preamble.macroDefinitions.some(definition =>
    definition.span.from <= at && definition.span.to > at);
  const grouped = (at: number): boolean => {
    let node = context.syntax.tree.resolveInner(at + 1, 1);
    while (node.parent) {
      node = node.parent;
      if (node.name === "Group" || node.name === "OptionalArgument") return true;
    }
    return false;
  };
  let depth = 0;
  let environmentDepth = 0;
  let previous = "";
  // Classify once per scanned document. Color resolution and inspector
  // planning share this pass rather than walking every preceding token for
  // each declaration in a large preamble.
  for (const control of context.syntax.controlsIn(document.preamble.span)) {
    if (inMacro(control.span.from)) { scopes.set(control.span.from, "macro"); continue; }
    if (grouped(control.span.from)) { scopes.set(control.span.from, "scoped"); continue; }
    scopes.set(control.span.from, depth > 0 || environmentDepth > 0 ? "scoped" : "top-level");
    // Commands such as \ifthenelse take grouped arguments; they are not
    // open conditionals extending to a later \fi.
    const conditional = control.name.startsWith("if") && previous !== "newif" &&
      (primitiveConditionals.has(control.name) || !beamerRequiredArgumentAfter(context, control.span.to, document.preamble.span.to));
    if (conditional || control.name === "begingroup" || control.name === "bgroup") depth += 1;
    if (control.name === "fi" || control.name === "endgroup" || control.name === "egroup") depth = Math.max(0, depth - 1);
    const boundary = context.syntax.environmentBoundaryByStart.get(control.span.from);
    if (boundary?.kind === "begin") environmentDepth += 1;
    if (boundary?.kind === "end") environmentDepth = Math.max(0, environmentDepth - 1);
    previous = control.name;
  }
  scopeCache.set(document, scopes);
  return scopes.get(span.from) ?? "scoped";
}

export function executingThemeUses(document: BeamerDocumentModel): BeamerThemeUseModel[] {
  return document.preamble.themes.filter(use => !document.preamble.macroDefinitions.some(definition =>
    definition.span.from <= use.span.from && definition.span.to >= use.span.to));
}

export function themeEditBlocker(document: BeamerDocumentModel): BeamerPreambleEditBlocker | null {
  const context = createBeamerSyntaxContext(document.source);
  for (const use of executingThemeUses(document)) {
    if (preambleCommandScope(document, use.span, context) !== "top-level") {
      return { reason: "This theme is set inside a group, hook or conditional. Edit it in Source.", span: use.span };
    }
    const names = literalThemeNames(use);
    if (!names) {
      return { reason: "This theme uses a computed name. Edit it in Source.", span: use.name.span };
    }
    if (names.length > 1 && use.options?.value.trim()) {
      return { reason: "These options are shared by several themes. Edit them in Source.", span: use.span };
    }
  }
  return null;
}

export function literalThemeNames(use: BeamerThemeUseModel): string[] | null {
  const names = use.name.value.split(",").map(name => name.trim());
  return names.every(name => /^[A-Za-z0-9_-]+$/u.test(name)) ? names : null;
}

export const BEAMER_THEME_COMMANDS: Readonly<Record<BeamerThemeKind, string>> = {
  theme: "usetheme", "color-theme": "usecolortheme", "font-theme": "usefonttheme",
  "inner-theme": "useinnertheme", "outer-theme": "useoutertheme",
};

/** The class and its immediately following package block, before other declarations. */
export function initialThemeInsertionOffset(document: BeamerDocumentModel): number {
  const context = createBeamerSyntaxContext(document.source);
  const limit = document.preamble.span.to;
  let after = document.preamble.documentClass?.span.to ?? document.preamble.span.from;
  for (;;) {
    let cursor = after;
    for (;;) {
      const end = context.syntax.triviaEndByStart.get(cursor);
      if (end === undefined || end <= cursor) break;
      cursor = end;
    }
    const command = context.syntax.controlByStart.get(cursor);
    if (!command || (command.name !== "usepackage" && command.name !== "RequirePackage")) break;
    const options = beamerOptionalArgumentAfter(context, command.span.to, limit);
    const name = beamerRequiredArgumentAfter(context, options?.span.to ?? command.span.to, limit);
    if (!name) break;
    const date = beamerOptionalArgumentAfter(context, name.span.to, limit);
    after = date?.span.to ?? name.span.to;
  }
  return preambleInsertionOffset(document, after);
}

/** Stay in the preamble, and retain a trailing line comment on its command. */
export function preambleInsertionOffset(document: BeamerDocumentModel, after: number): number {
  const limit = document.preamble.span.to;
  const end = document.source.indexOf("\n", after);
  const lineEnd = end < 0 ? limit : Math.min(end, limit);
  const rest = document.source.slice(after, lineEnd).replace(/\r$/u, "");
  return /^\s*(?:%[^\n]*)?$/u.test(rest) ? (document.source[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd) : after;
}

export function preambleInsertion(document: BeamerDocumentModel, at: number, command: TikzFragment): TikzFragment {
  const newline = layout(document.source.includes("\r\n") ? "\r\n" : "\n");
  // Inserting immediately before a same-line command needs a separator on both sides.
  const suffix = document.source[at] === "\n" || document.source[at] === "\r" ? tikz`` : newline;
  return tikz`${newline}${command}${suffix}`;
}

/** Retain names before the final name in a comma-separated use command. */
export function themeNamePrefix(document: BeamerDocumentModel, use: BeamerThemeUseModel): TikzFragment {
  const comma = document.source.lastIndexOf(",", use.name.contentSpan.to - 1);
  return comma >= use.name.contentSpan.from
    ? sourceSlice(document.source, { from: use.name.contentSpan.from, to: comma + 1 }) : tikz``;
}
