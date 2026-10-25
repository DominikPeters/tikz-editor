import { sourceSlice, tikz, userText } from "../edit/fragment.js";
import { parseOptionListRaw } from "../options/parse.js";
import { parseTexDimensionExpression } from "../text/tex/dimensions.js";
import { tokenRemovalSpan } from "../editing/operations/lists.js";
import { rewriteBeamerOptions } from "./option-edits.js";
import { BEAMER_THEME_COMMANDS, executingThemeUses, initialThemeInsertionOffset, literalThemeNames, preambleInsertion, preambleInsertionOffset, themeEditBlocker, themeNamePrefix, type BeamerPreambleEditBlocker } from "./preamble-edit-context.js";
import { beamerPresentationTheme, beamerThemeComponentChoices } from "./theme/catalog.js";
import { planPresentationThemeSwitch, presentationThemeEdits } from "./theme-switch.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import type { BeamerDocumentModel, BeamerThemeKind, BeamerThemeUseModel } from "./types.js";
import { isDeckPageEditAction, type DeckPageEditAction } from "./document-page-edits.js";
import type { DeckColorEditAction } from "./document-color-edits.js";

export type DeckThemeEditAction =
  | { kind: "deckSetPresentationTheme"; name: string }
  | { kind: "deckSetThemeOption"; key: string; value: string | true | null }
  | { kind: "deckSetTheme"; themeKind: Exclude<BeamerThemeKind, "theme">; name: string | null };
export type DeckDocumentEditAction = DeckThemeEditAction | DeckPageEditAction | DeckColorEditAction;

export function isDeckDocumentEditAction(action: { kind: string }): action is DeckDocumentEditAction {
  return action.kind === "deckSetColor" || action.kind === "deckSetPresentationTheme" || action.kind === "deckSetThemeOption" || action.kind === "deckSetTheme" || isDeckPageEditAction(action);
}

export function themeOptionEditBlocker(document: BeamerDocumentModel): BeamerPreambleEditBlocker | null {
  const blocked = themeEditBlocker(document);
  if (blocked) return blocked;
  const uses = executingThemeUses(document).filter(use => use.kind === "theme");
  const target = uses.at(-1);
  if (!target) return null;
  const names = literalThemeNames(target) ?? [];
  if (names.length > 1) return { reason: "These options are shared by several themes. Edit them in Source.", span: target.span };
  if (uses.slice(0, -1).some(use => literalThemeNames(use)?.includes(names[0] ?? ""))) {
    return { reason: "This theme is loaded more than once. Edit its options in Source.", span: target.span };
  }
  return null;
}

function removeThemeUse(document: BeamerDocumentModel, use: BeamerThemeUseModel): BeamerStructuralEdit {
  const retained = use.options ? rewriteBeamerOptions(document.source, use.options, () => false)[0] : null;
  // A content-only edit means comments survived. Keep that trivia as source
  // after removing the command's syntax; otherwise remove its whole line.
  return retained && retained.span.from === use.options?.contentSpan.from
    ? { span: use.span, insert: retained.insert }
    : { span: tokenRemovalSpan(document.source, use.span), insert: tikz`` };
}

export function planDeckDocumentThemeEdit(
  document: BeamerDocumentModel,
  action: DeckThemeEditAction
): { edits: BeamerStructuralEdit[] } | { reason: string } {
  const blocked = themeEditBlocker(document);
  if (blocked) return blocked;
  if (action.kind === "deckSetPresentationTheme") {
    const plan = planPresentationThemeSwitch(document, action.name);
    return plan ? { edits: presentationThemeEdits(document, plan) } : { reason: `The preview does not know the theme '${action.name}'.` };
  }
  const uses = executingThemeUses(document);
  if (action.kind === "deckSetThemeOption") {
    const blocker = themeOptionEditBlocker(document);
    if (blocker) return blocker;
    const target = uses.filter(use => use.kind === "theme").at(-1);
    const name = target ? literalThemeNames(target)?.at(-1) : "default";
    const entry = name ? beamerPresentationTheme(name) : null;
    const schema = entry?.options.find(option => option.kind === "flag-choice"
      ? option.values.some(choice => choice.value === action.key) : option.key === action.key);
    if (!schema || !target) return { reason: "This theme option is not editable in the preview." };
    const value = action.value;
    if (schema.kind === "boolean" || schema.kind === "flag-choice") {
      if (value !== true && value !== null) return { reason: "This option requires a flag or reset." };
    } else if (value !== null) {
      if (typeof value !== "string") return { reason: "This option requires a value." };
      if (schema.kind === "enum" && !schema.values.some(choice => choice.value === value)) return { reason: "This theme option value is not supported." };
      if (schema.kind === "dimension" && (!parseTexDimensionExpression(value) || /[\r\n%,[\]]/u.test(value))) return { reason: "Enter a supported TeX dimension." };
    }
    const key = userText(action.key, "inspector-value");
    const text = value === true ? key : value === null ? null : tikz`${key}=${userText(value, "inspector-value")}`;
    if (!target.options) return { edits: text === null ? [] : [{ span: { from: target.name.span.from, to: target.name.span.from }, insert: tikz`[${text}]` }] };
    const entries = parseOptionListRaw(document.source.slice(target.options.span.from, target.options.span.to), target.options.span.from).entries;
    const keys = schema.kind === "flag-choice" ? schema.values.map(choice => choice.value) : [action.key];
    const index = entries.map(option => option.kind !== "unknown" && option.key === action.key).lastIndexOf(true);
    return { edits: rewriteBeamerOptions(document.source, target.options,
      (option, i) => option.kind === "unknown" || !keys.includes(option.key) || (i === index && text !== null),
      index >= 0 && text !== null ? { index, text } : undefined,
      index < 0 && text !== null ? text : undefined) };
  }
  const kind = action.themeKind;
  const matching = uses.filter(use => use.kind === kind);
  if (action.name === null) return { edits: matching.map(use => removeThemeUse(document, use)) };
  const name = beamerThemeComponentChoices(kind).find(choice => choice === action.name?.toLowerCase());
  if (!name) return { reason: "The preview does not know this theme component." };
  const target = matching.at(-1);
  const names = target ? literalThemeNames(target) ?? [] : [];
  // Only a later presentation theme loads components over this one. Moving
  // past anything else would also move past the author's own declarations.
  const overriding = uses.filter(use => use.kind === "theme" && (!target || use.span.from > target.span.from)).at(-1);
  const command = userText(`\\${BEAMER_THEME_COMMANDS[kind]}`, "beamer-text");
  const typedName = userText(name, "inspector-value");
  // A repeated explicit package cannot be loaded again to override a later theme.
  if (matching.slice(0, -1).some(use => literalThemeNames(use)?.includes(name))) {
    return { reason: "This component is already loaded earlier. Reset to the theme before choosing it again." };
  }
  const prefix = target ? themeNamePrefix(document, target) : tikz``;
  const same = names.at(-1)?.toLowerCase() === name;
  let options = same && target?.options ? sourceSlice(document.source, target.options.span) : tikz``;
  if (!same && target?.options) {
    const retained = rewriteBeamerOptions(document.source, target.options, () => false)[0];
    if (retained?.span.from === target.options.contentSpan.from) options = tikz`[${retained.insert}]`;
  }
  const replacement = tikz`${command}${options}{${prefix}${typedName}}`;
  if (target && !overriding) {
    if (same) return { edits: [] };
    return { edits: [{ span: target.span, insert: replacement }] };
  }
  const after = overriding ?? uses.at(-1);
  const at = after ? preambleInsertionOffset(document, after.span.to) : initialThemeInsertionOffset(document);
  return { edits: [
    ...(target ? [{ span: tokenRemovalSpan(document.source, target.span), insert: tikz`` }] : []),
    { span: { from: at, to: at }, insert: preambleInsertion(document, at, replacement) },
  ] };
}
