import { sourceSlice, tikz, userText } from "../edit/fragment.js";
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
  if (!entry) {
    return null;
  }
  const target = document.preamble.themes
    .filter((use) => use.kind === "theme" && !document.preamble.macroDefinitions.some((definition) =>
      definition.span.from <= use.span.from && definition.span.to >= use.span.to))
    .at(-1) ?? null;
  const readKeys = new Set(entry.options.flatMap((schema) =>
    schema.kind === "flag-choice" ? schema.values.map((choice) => choice.value) : [schema.key]));
  const keptOptions: Array<{ text: string; from: number; to: number }> = [];
  if (target?.options) {
    let from = target.options.contentSpan.from;
    for (const raw of target.options.value.split(",")) {
      const to = from + raw.length;
      const key = raw.split("=")[0]?.trim() ?? "";
      if (readKeys.has(key)) {
        keptOptions.push({ text: raw.trim(), from: from + raw.indexOf(raw.trim()), to: from + raw.indexOf(raw.trim()) + raw.trim().length });
      }
      from = to + 1;
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
        name: { ...target.name, value: plan.entry.name },
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
    return [{ span: { from: at, to: at }, insert: tikz`
\usetheme{${name}}` }];
  }
  const edits: BeamerStructuralEdit[] = [{ span: target.name.contentSpan, insert: name }];
  if (target.options) {
    const kept = plan.keptOptions.map((option) => sourceSlice(document.source, option));
    edits.push(kept.length > 0
      ? { span: target.options.contentSpan, insert: kept.reduce((joined, option) => tikz`${joined},${option}`) }
      : { span: target.options.span, insert: tikz`` });
  }
  return edits;
}

/** The end of the `\documentclass` line, where a new `\usetheme` goes. */
function themeInsertionOffset(document: BeamerDocumentModel): number {
  const documentClass = document.preamble.documentClass;
  if (!documentClass) {
    return document.preamble.span.from;
  }
  const lineEnd = document.source.indexOf("\n", documentClass.span.to);
  return lineEnd === -1 ? documentClass.span.to : lineEnd;
}

function syntheticThemeUse(document: BeamerDocumentModel, name: string): BeamerThemeUseModel {
  // Placed where the edit inserts it, so later theme commands still win.
  const at = themeInsertionOffset(document);
  const span = { from: at, to: at };
  return { kind: "theme", span, commandSpan: span, name: { span, contentSpan: span, value: name } };
}
