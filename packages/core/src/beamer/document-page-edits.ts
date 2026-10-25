import type { Span } from "../ast/types.js";
import { joinFragments, layout, sourceSlice, tikz, userText, type TikzFragment } from "../edit/fragment.js";
import { tokenRemovalSpan } from "../editing/operations/lists.js";
import { readTexControlSequence } from "../parser/tex-lexical.js";
import { BEAMER_ASPECT_RATIOS, BEAMER_CLASS_FONT_SIZES, beamerClassFontOption, beamerClassOptionEntries } from "./class-options.js";
import { scanBeamerMetadataDeclarations } from "./metadata-declarations.js";
import { rewriteBeamerOptions } from "./option-edits.js";
import { executingThemeUses, initialThemeInsertionOffset, preambleCommandScope, preambleInsertion, preambleInsertionOffset, themeEditBlocker, type BeamerPreambleEditBlocker } from "./preamble-edit-context.js";
import { beamerRequiredArgumentAfter, beamerSourceValueTokens, createBeamerSyntaxContext } from "./syntax.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import type { BeamerChromeMetadataField } from "./theme/chrome-metadata.js";
import { scanBeamerNavigationTemplates } from "./theme/template-declarations.js";
import type { BeamerDocumentModel } from "./types.js";

export type DeckPageEditAction =
  | { kind: "deckSetClassOption"; key: "aspectratio" | "font-size"; value: string | null }
  | { kind: "deckSetNavigationSymbols"; visible: boolean | null }
  /** null inherits the long form; "" writes an explicitly empty short form. */
  | { kind: "deckSetMetadataShort"; field: BeamerChromeMetadataField; value: string | null };

export function isDeckPageEditAction(action: { kind: string }): action is DeckPageEditAction {
  return action.kind === "deckSetClassOption" || action.kind === "deckSetNavigationSymbols" || action.kind === "deckSetMetadataShort";
}

export function classOptionEditBlocker(document: BeamerDocumentModel): BeamerPreambleEditBlocker | null {
  const context = createBeamerSyntaxContext(document.source);
  const commands = context.syntax.controlsIn(document.preamble.span).filter(command =>
    command.name === "documentclass" && preambleCommandScope(document, command.span, context) !== "macro");
  const target = document.preamble.documentClass;
  const unsafe = commands.find(command => preambleCommandScope(document, command.span, context) !== "top-level");
  if (unsafe) return { reason: "The document class is set inside a group, hook or conditional. Edit it in Source.", span: unsafe.span };
  if (commands.length !== 1 || target?.className.value.trim() !== "beamer") {
    return { reason: "Page settings require one literal Beamer document class. Edit it in Source.", span: target?.span ?? document.preamble.span };
  }
  for (const command of context.syntax.controlsIn(document.preamble.span)) {
    if (command.name !== "PassOptionsToClass" || preambleCommandScope(document, command.span, context) === "macro") continue;
    const options = beamerRequiredArgumentAfter(context, command.span.to, document.preamble.span.to);
    const name = options ? beamerRequiredArgumentAfter(context, options.span.to, document.preamble.span.to) : null;
    if (name && beamerSourceValueTokens(context, name) === "beamer") return {
      reason: "Some page settings are passed separately to the Beamer class. Edit them in Source.", span: { from: command.span.from, to: name.span.to },
    };
  }
  return null;
}

export function metadataShortEditBlocker(document: BeamerDocumentModel, field: BeamerChromeMetadataField): BeamerPreambleEditBlocker | null {
  const redefined = document.preamble.macroDefinitions.find(definition => definition.nameRaw === `\\${field}`);
  if (redefined) return { reason: "This title-information command has been redefined. Edit it in Source.", span: redefined.span };
  const unsafe = scanBeamerMetadataDeclarations(document).find(declaration =>
    declaration.name === field && declaration.scope !== "macro" && (declaration.scope !== "top-level" || declaration.field === null));
  return unsafe ? {
    reason: unsafe.field === null ? "This title-information declaration is incomplete. Edit it in Source." : "This title information is set inside a group, hook or conditional. Edit it in Source.",
    span: unsafe.span,
  } : null;
}

export function navigationEditBlocker(document: BeamerDocumentModel): BeamerPreambleEditBlocker | null {
  const theme = themeEditBlocker(document);
  if (theme) return theme;
  const unsupported = scanBeamerNavigationTemplates(document).find(event => event.diagnostic != null);
  if (unsupported) return { reason: "These navigation symbols use custom or scoped template code. Edit them in Source.", span: unsupported.span };
  const context = createBeamerSyntaxContext(document.source);
  for (const command of context.syntax.controlsIn(document.preamble.span)) {
    if ((command.name.startsWith("beamertemplatenavigationsymbols") || command.name === "usenavigationsymbolstemplate") && preambleCommandScope(document, command.span, context) !== "macro") {
      return { reason: "These navigation symbols use a legacy template command. Edit them in Source.", span: command.span };
    }
    if (!["setbeamertemplate", "addtobeamertemplate", "defbeamertemplate"].includes(command.name) || preambleCommandScope(document, command.span, context) === "macro") continue;
    const role = beamerRequiredArgumentAfter(context, command.starSpan?.to ?? command.span.to, document.preamble.span.to);
    const name = role ? beamerSourceValueTokens(context, role).replace(/\s+/gu, " ") : "";
    if (role && (name.includes("\\") || (command.name !== "setbeamertemplate" && name === "navigation symbols"))) {
      return { reason: "These navigation symbols use custom template code. Edit them in Source.", span: role.span };
    }
  }
  return null;
}

/** Comment-only trivia retained when an inspected command/argument is removed. */
function retainedComments(document: BeamerDocumentModel, span: Span): TikzFragment {
  const newline = layout(document.source.includes("\r\n") ? "\r\n" : "\n");
  const comments = createBeamerSyntaxContext(document.source).syntax.comments.filter(comment => span.from <= comment.from && comment.to <= span.to);
  return comments.length === 0 ? tikz`` : tikz`${newline}${joinFragments(comments.map(comment => tikz`${sourceSlice(document.source, comment)}${newline}`), tikz``)}`;
}

function removeDeclaration(document: BeamerDocumentModel, span: Span): BeamerStructuralEdit {
  const comments = retainedComments(document, span);
  return comments.length > 0 ? { span, insert: comments } : { span: tokenRemovalSpan(document.source, span), insert: tikz`` };
}

function shortFormProblem(value: string): string | null {
  if (/[\r\n]/u.test(value)) return "Enter a single-line short form.";
  let depth = 0;
  let math: string | null = null;
  for (let at = 0; at < value.length; at += 1) {
    const character = value[at];
    if (character === "\\") {
      const control = readTexControlSequence(value, at);
      if (control?.raw === "\\(" || control?.raw === "\\[") {
        if (math !== null) return "The short form needs matching math delimiters.";
        math = control.raw;
      }
      if (control?.raw === "\\)" || control?.raw === "\\]") {
        if (math !== (control.raw === "\\)" ? "\\(" : "\\[")) return "The short form needs matching math delimiters.";
        math = null;
      }
      at = (control?.to ?? at + 1) - 1;
      continue;
    }
    if (character === "$") {
      const delimiter = value[at + 1] === "$" ? "$$" : "$";
      if (math !== null && math !== delimiter) return "The short form needs matching math delimiters.";
      math = math === null ? delimiter : null;
      if (delimiter === "$$") at += 1;
    }
    if (character === "%") return "Escape a literal percent sign as \\%.";
    if (character === "{") depth += 1;
    if (character === "}" && --depth < 0) return "The short form needs balanced braces.";
    if (depth === 0 && (character === "[" || character === "]")) return "Put square brackets inside braces in a short form.";
  }
  return depth !== 0 ? "The short form needs balanced braces." : math !== null ? "The short form needs matching math delimiters." : null;
}

export function planDeckPageEdit(document: BeamerDocumentModel, action: DeckPageEditAction): { edits: BeamerStructuralEdit[] } | { reason: string } {
  if (action.kind === "deckSetClassOption") {
    const blocked = classOptionEditBlocker(document);
    if (blocked) return blocked;
    const target = document.preamble.documentClass;
    if (!target) return { reason: "The document class was not found." };
    const value = action.value;
    if (value !== null && (action.key === "font-size" ? !BEAMER_CLASS_FONT_SIZES.includes(value) : !BEAMER_ASPECT_RATIOS.some(choice => choice.value === value))) {
      return { reason: "This page setting is not supported." };
    }
    const text = value === null ? null : action.key === "font-size"
      ? tikz`${userText(value, "inspector-value")}pt` : tikz`aspectratio=${userText(value, "inspector-value")}`;
    if (!target.options) return { edits: text === null ? [] : [{ span: { from: target.className.span.from, to: target.className.span.from }, insert: tikz`[${text}]` }] };
    const entries = beamerClassOptionEntries(document);
    const matches = entries.map(entry => action.key === "font-size" ? beamerClassFontOption(entry) !== null : entry.kind !== "unknown" && entry.key === "aspectratio");
    const index = matches.lastIndexOf(true);
    return { edits: rewriteBeamerOptions(document.source, target.options, (_entry, i) => matches[i] !== true || (i === index && text !== null),
      index >= 0 && text !== null ? { index, text } : undefined,
      index < 0 && text !== null ? text : undefined) };
  }
  if (action.kind === "deckSetNavigationSymbols") {
    const blocked = navigationEditBlocker(document);
    if (blocked) return blocked;
    const events = scanBeamerNavigationTemplates(document);
    if (action.visible === null) return { edits: events.map(event => removeDeclaration(document, event.span)) };
    const target = events.at(-1);
    const themeEnd = executingThemeUses(document).at(-1)?.span.to ?? initialThemeInsertionOffset(document);
    const id = action.visible ? "beamer/navigation-symbols/default" : "beamer/navigation-symbols/none";
    if (target && target.span.from >= themeEnd && target.templateId === id) return { edits: [] };
    const command = action.visible ? tikz`\setbeamertemplate{navigation symbols}[default]` : tikz`\setbeamertemplate{navigation symbols}{}`;
    const replacement = target ? tikz`${command}${retainedComments(document, target.span)}` : command;
    if (target && target.span.from >= themeEnd) return { edits: [{ span: target.span, insert: replacement }] };
    const at = preambleInsertionOffset(document, themeEnd);
    return { edits: [
      ...(target ? [{ span: tokenRemovalSpan(document.source, target.span), insert: tikz`` }] : []),
      { span: { from: at, to: at }, insert: preambleInsertion(document, at, replacement) },
    ] };
  }
  if (!["title", "author", "institute", "date"].includes(action.field)) return { reason: "This metadata field is not editable here." };
  const blocked = metadataShortEditBlocker(document, action.field);
  if (blocked) return blocked;
  const target = document.preamble.metadata[action.field];
  if (action.value === null) return { edits: target?.shortValue ? [{ span: target.shortValue.span, insert: retainedComments(document, target.shortValue.span) }] : [] };
  const problem = shortFormProblem(action.value);
  if (problem) return { reason: problem };
  const value = userText(action.value, "inspector-value");
  if (target?.shortValue) return { edits: [
    { span: target.shortValue.contentSpan, insert: value },
    { span: { from: target.shortValue.span.to, to: target.shortValue.span.to }, insert: retainedComments(document, target.shortValue.span) },
  ] };
  if (target) return { edits: [{ span: { from: target.value.span.from, to: target.value.span.from }, insert: tikz`[${value}]` }] };
  const command = userText(`\\${action.field}`, "beamer-text");
  const long = action.field === "date" ? tikz`\today` : tikz``;
  const after = Math.max(initialThemeInsertionOffset(document), executingThemeUses(document).at(-1)?.span.to ?? 0,
    ...scanBeamerMetadataDeclarations(document).filter(declaration => declaration.scope === "top-level").map(declaration => declaration.span.to));
  const at = preambleInsertionOffset(document, after);
  return { edits: [{ span: { from: at, to: at }, insert: preambleInsertion(document, at, tikz`${command}[${value}]{${long}}`) }] };
}
