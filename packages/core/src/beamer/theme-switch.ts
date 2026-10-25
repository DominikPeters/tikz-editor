import { tikz, userText } from "../edit/fragment.js";
import { parseOptionListRaw } from "../options/parse.js";
import { rewriteBeamerOptions } from "./option-edits.js";
import { executingThemeUses, initialThemeInsertionOffset, literalThemeNames, preambleInsertion, themeEditBlocker, themeNamePrefix } from "./preamble-edit-context.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import { beamerPresentationTheme, type BeamerThemeCatalogEntry } from "./theme/catalog.js";
import type { BeamerDocumentModel, BeamerThemeUseModel } from "./types.js";

/**
 * Switching a deck's presentation theme (design/beamer-document-inspector.md,
 * phase 2). The gallery previews a switch and the inspector writes it from the
 * same plan, so a preview shows exactly what applying it produces: the last
 * executing `\usetheme` gets the new name and keeps only the options the new
 * theme reads; without one, a `\usetheme` goes in after `\documentclass`.
 * Later color, font, inner and outer theme commands stay and still apply.
 */
export type BeamerPresentationThemeSwitch = {
  entry: BeamerThemeCatalogEntry;
  /** The `\usetheme` rewritten; null when the deck has none and one is inserted. */
  target: BeamerThemeUseModel | null;
  /** Authored option entries the new theme reads, verbatim and in order. */
  keptOptions: ReadonlyArray<{ text: string; from: number; to: number }>;
};

export function planPresentationThemeSwitch(
  document: BeamerDocumentModel,
  name: string
): BeamerPresentationThemeSwitch | null {
  const entry = beamerPresentationTheme(name);
  if (!entry || themeEditBlocker(document)) {
    return null;
  }
  const target = executingThemeUses(document)
    .filter((use) => use.kind === "theme")
    .at(-1) ?? null;
  const readKeys = new Set(entry.options.flatMap((schema) =>
    schema.kind === "flag-choice" ? schema.values.map((choice) => choice.value) : [schema.key]));
  // These native options are intentionally not controls until the renderer
  // draws them, but switching between modern themes must not erase them.
  if (entry.id === "metropolis" || entry.id === "moloch") {
    for (const key of ["block", "sectionpage", "subsectionpage", "titleformat", "titleformat plain", "titleformat title", "titleformat subtitle", "titleformat section", "titleformat frame"]) readKeys.add(key);
  }
  if (entry.id === "madrid" || entry.id === "boadilla") readKeys.add("shadow");
  const keptOptions: Array<{ text: string; from: number; to: number }> = [];
  const sameTheme = target && literalThemeNames(target)?.at(-1)?.toLowerCase() === entry.id;
  if (target?.options) {
    const entries = parseOptionListRaw(document.source.slice(target.options.span.from, target.options.span.to), target.options.span.from).entries;
    for (const option of entries) {
      if (sameTheme || (option.kind !== "unknown" && readKeys.has(option.key))) {
        keptOptions.push({ text: option.raw, ...option.span });
      }
    }
  }
  return { entry, target, keptOptions };
}

/** The document as the switch would leave it, for rendering a preview. */
export function documentWithPresentationTheme(
  document: BeamerDocumentModel,
  plan: BeamerPresentationThemeSwitch
): BeamerDocumentModel {
  const options = plan.keptOptions.map((option) => option.text).join(",");
  const { target } = plan;
  const switched: BeamerThemeUseModel = target
    ? {
        ...target,
        name: { ...target.name, value: [...(literalThemeNames(target) ?? []).slice(0, -1), plan.entry.name].join(",") },
        ...(options.length > 0 && target.options ? { options: { ...target.options, value: options } } : {}),
      }
    : syntheticThemeUse(document, plan.entry.name);
  if (target && options.length === 0) {
    delete switched.options;
  }
  const themes = target
    ? document.preamble.themes.map((use) => (use === target ? switched : use))
    : [switched, ...document.preamble.themes];
  return { ...document, preamble: { ...document.preamble, themes } };
}

export function presentationThemeEdits(
  document: BeamerDocumentModel,
  plan: BeamerPresentationThemeSwitch
): BeamerStructuralEdit[] {
  const name = userText(plan.entry.name, "inspector-value");
  const { target } = plan;
  if (!target) {
    const at = themeInsertionOffset(document);
    return [{ span: { from: at, to: at }, insert: preambleInsertion(document, at, tikz`\usetheme{${name}}`) }];
  }
  const edits: BeamerStructuralEdit[] = [{ span: target.name.contentSpan, insert: tikz`${themeNamePrefix(document, target)}${name}` }];
  if (target.options) {
    const kept = new Set(plan.keptOptions.map(option => option.from));
    edits.push(...rewriteBeamerOptions(document.source, target.options, option => kept.has(option.span.from)));
  }
  return edits;
}

/** The end of the `\documentclass` line, where a new `\usetheme` goes. */
function themeInsertionOffset(document: BeamerDocumentModel): number {
  return initialThemeInsertionOffset(document);
}

function syntheticThemeUse(document: BeamerDocumentModel, name: string): BeamerThemeUseModel {
  // Placed where the edit inserts it, so later theme commands still win.
  const at = themeInsertionOffset(document);
  const span = { from: at, to: at };
  return { kind: "theme", span, commandSpan: span, name: { span, contentSpan: span, value: name } };
}
