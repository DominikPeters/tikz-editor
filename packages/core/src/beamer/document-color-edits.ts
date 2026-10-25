import { tikz, userText } from "../edit/fragment.js";
import { tokenRemovalSpan } from "../editing/operations/lists.js";
import { rewriteBeamerOptions } from "./option-edits.js";
import { executingThemeUses, preambleCommandScope, preambleInsertion, preambleInsertionOffset, themeEditBlocker, type BeamerPreambleEditBlocker } from "./preamble-edit-context.js";
import { beamerRequiredArgumentAfter, beamerSourceValueTokens, createBeamerSyntaxContext } from "./syntax.js";
import { resolveBeamerTheme, resolveBeamerThemeColor } from "./theme/resolve.js";
import { scanBeamerColorDeclarations, type BeamerColorDeclarationEvent } from "./theme/color-declarations.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import type { BeamerDocumentModel } from "./types.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";

export const BEAMER_INSPECTOR_COLOR_ROLES: ReadonlyArray<{ role: string; label: string; sides: readonly ("fg" | "bg")[] }> = [
  { role: "structure", label: "Structure", sides: ["fg"] },
  { role: "normal text", label: "Text", sides: ["fg"] },
  { role: "background canvas", label: "Background", sides: ["bg"] },
  { role: "alerted text", label: "Alerted text", sides: ["fg"] },
  { role: "example text", label: "Example text", sides: ["fg"] },
  { role: "palette primary", label: "Primary", sides: ["fg", "bg"] },
  { role: "palette secondary", label: "Secondary", sides: ["fg", "bg"] },
  { role: "palette tertiary", label: "Tertiary", sides: ["fg", "bg"] },
  { role: "palette quaternary", label: "Quaternary", sides: ["fg", "bg"] },
];

/** null removes authored keys; "" explicitly clears the side, as Beamer's fg=/bg=. */
export type DeckColorEditAction = { kind: "deckSetColor"; role: string; side: "fg" | "bg"; value: string | null };
type RoleDeclaration = Extract<BeamerColorDeclarationEvent, { kind: "beamer-color" }>;

export function colorEditBlocker(document: BeamerDocumentModel, role: string): BeamerPreambleEditBlocker | null {
  const theme = themeEditBlocker(document);
  if (theme) return theme;
  const redefined = document.preamble.macroDefinitions.find(definition => definition.nameRaw === "\\setbeamercolor");
  if (redefined) return { reason: "The color declaration command has been redefined. Edit colors in Source.", span: redefined.span };
  const context = createBeamerSyntaxContext(document.source);
  const events = scanBeamerColorDeclarations(document);
  for (const command of context.syntax.controlsIn(document.preamble.span)) {
    if (command.name !== "setbeamercolor") continue;
    const scope = preambleCommandScope(document, command.span, context);
    if (scope === "macro") continue;
    const argument = beamerRequiredArgumentAfter(context, command.starSpan?.to ?? command.span.to, document.preamble.span.to);
    const name = argument ? beamerSourceValueTokens(context, argument).replace(/\s+/gu, " ") : "";
    if (!name || /[\\{}]/u.test(name)) return { reason: "A color declaration uses a computed or incomplete role. Edit colors in Source.", span: argument?.span ?? command.span };
    if (name !== role) continue;
    if (scope !== "top-level") return { reason: "This color is set inside a group, hook or conditional. Edit it in Source.", span: command.span };
    const event = events.find(event => event.span.from === command.span.from);
    if (event?.kind !== "beamer-color" || event.entries.some(entry => entry.kind !== "kv" || !["fg", "bg", "parent", "use"].includes(entry.key))) {
      return { reason: "This color declaration uses incomplete or custom keys. Edit it in Source.", span: event?.span ?? command.span };
    }
  }
  return null;
}

export function authoredColorSides(document: BeamerDocumentModel, role: string): ReadonlySet<string> {
  return new Set(scanBeamerColorDeclarations(document).flatMap(event => event.kind === "beamer-color" && event.role.value.trim() === role
    ? event.entries.flatMap(entry => entry.kind === "kv" && (entry.key === "fg" || entry.key === "bg") ? [entry.key] : []) : []));
}

/** Only authored named colors, with native spelling and their final resolved swatch. */
export function beamerNamedColorSwatches(document: BeamerDocumentModel, theme: ResolvedBeamerTheme): Array<{ token: string; cssColor: string }> {
  const names = new Map<string, string>();
  for (const event of scanBeamerColorDeclarations(document)) {
    if (event.kind !== "define-color" && event.kind !== "color-alias") continue;
    const token = event.name.value.trim();
    if (/^[a-z][a-z0-9._:@-]*$/iu.test(token)) names.set(token.toLowerCase(), token);
  }
  return [...names].flatMap(([key, token]) => theme.colorAliases?.[key] ? [{ token, cssColor: theme.colorAliases[key] }] : []);
}

function validColorValue(document: BeamerDocumentModel, theme: ResolvedBeamerTheme, role: string, value: string): boolean {
  if (value === "") return true;
  if (/[\\{}\r\n%,#[\]]/u.test(value) || value.trim().length === 0) return false;
  const named = new Set(beamerNamedColorSwatches(document, theme).map(swatch => swatch.token));
  const builtins = new Set("red green blue brown lime orange pink purple teal violet cyan magenta yellow olive black darkgray gray lightgray white".split(" "));
  const parts = value.split("!");
  return parts.every((part, index) => {
    const token = part.trim();
    if (index % 2 === 1) return /^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(token) && Number(token) <= 100;
    if (builtins.has(token) || named.has(token)) return true;
    const reference = /^(.*)\.(fg|bg)$/u.exec(token);
    const dependency = reference?.[1];
    const side = reference?.[2];
    return dependency !== undefined && (side === "fg" || side === "bg") &&
      (theme.colors[role]?.use?.includes(dependency) === true || theme.colorAliases?.[token.toLowerCase()] !== undefined) &&
      resolveBeamerThemeColor(theme, dependency)[side] !== undefined;
  });
}

function rewriteSide(document: BeamerDocumentModel, event: RoleDeclaration, side: "fg" | "bg", value: string | null): BeamerStructuralEdit[] {
  const options = event.options;
  const matches = event.entries.map(entry => entry.kind === "kv" && entry.key === side);
  const index = matches.lastIndexOf(true);
  const text = value === null ? null : tikz`${userText(side, "inspector-value")}=${userText(value, "inspector-value")}`;
  const keep = event.entries.map((_entry, i) => !matches[i] || (i === index && text !== null));
  const comments = createBeamerSyntaxContext(document.source).syntax.comments.some(comment => event.span.from <= comment.from && comment.to <= event.span.to);
  if (!keep.includes(true) && text === null && !event.starred && !comments) {
    return [{ span: tokenRemovalSpan(document.source, event.span), insert: tikz`` }];
  }
  return rewriteBeamerOptions(document.source, options, (_entry, i) => keep[i] === true,
    index >= 0 && text !== null ? { index, text } : undefined,
    index < 0 && text !== null ? text : undefined)
    .map(edit => edit.span.from === options.span.from ? { span: options.contentSpan, insert: tikz`` } : edit);
}

export function planDeckColorEdit(document: BeamerDocumentModel, action: DeckColorEditAction): { edits: BeamerStructuralEdit[] } | { reason: string } {
  if (!BEAMER_INSPECTOR_COLOR_ROLES.some(entry => entry.role === action.role && entry.sides.includes(action.side))) return { reason: "This color role is not editable here." };
  const blocked = colorEditBlocker(document, action.role);
  if (blocked) return blocked;
  const events = scanBeamerColorDeclarations(document);
  const declarations = events.filter((event): event is RoleDeclaration => event.kind === "beamer-color" && event.role.value.trim() === action.role);
  if (action.value === null) return { edits: declarations.filter(event => event.entries.some(entry => entry.kind === "kv" && entry.key === action.side)).flatMap(event => rewriteSide(document, event, action.side, null)) };
  const theme = resolveBeamerTheme(document);
  if (!validColorValue(document, theme, action.role, action.value)) return { reason: "Choose a known color name or supported xcolor mix. Color names are case-sensitive." };
  const target = declarations.at(-1);
  // Named colors must exist before a role can be used, and later theme loads
  // can overwrite earlier role settings. Keep both before the effective edit.
  const barrier = Math.max(0, ...executingThemeUses(document).map(use => use.span.to),
    ...events.filter(event => event.kind === "define-color" || event.kind === "color-alias").map(event => event.span.to));
  if (target && target.span.from >= barrier) return { edits: rewriteSide(document, target, action.side, action.value) };
  const limit = document.preamble.span.to;
  const end = document.source[limit - 1] === "\n" ? limit - (document.source[limit - 2] === "\r" ? 2 : 1) : limit;
  const at = preambleInsertionOffset(document, Math.max(barrier, end));
  const command = tikz`\setbeamercolor{${userText(action.role, "inspector-value")}}{${userText(action.side, "inspector-value")}=${userText(action.value, "inspector-value")}}`;
  return { edits: [{ span: { from: at, to: at }, insert: preambleInsertion(document, at, command) }] };
}
