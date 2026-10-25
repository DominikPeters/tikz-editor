import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { scanBeamerNoteCommands } from "./notes.js";
import { themeOptionEditBlocker } from "./document-theme-edits.js";
import { executingThemeUses, themeEditBlocker } from "./preamble-edit-context.js";
import { BEAMER_ASPECT_RATIOS, BEAMER_CLASS_FONT_SIZES, beamerClassFontOption, beamerClassOptionEntries, beamerClassOptionValue } from "./class-options.js";
import { classOptionEditBlocker, metadataShortEditBlocker, navigationEditBlocker } from "./document-page-edits.js";
import { authoredColorSides, BEAMER_INSPECTOR_COLOR_ROLES, beamerNamedColorSwatches, colorEditBlocker } from "./document-color-edits.js";
import { scanBeamerNavigationTemplates } from "./theme/template-declarations.js";
import {
  beamerPresentationTheme,
  beamerThemeComponentChoices,
  type BeamerThemeCatalogEntry,
  type BeamerThemeGroup,
  type BeamerThemeOptionSchema,
} from "./theme/catalog.js";
import { beamerChromeMetadataFields, type BeamerChromeMetadataField } from "./theme/chrome-metadata.js";
import { beamerClassFontSize } from "./theme/font-sizes.js";
import {
  parseThemeOptions,
  registeredBeamerThemeComponents,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
  resolveBeamerThemeColorOrigin,
} from "./theme/resolve.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";
import type { DeckInspectorColor, DeckInspectorField } from "./deck-inspector.js";
import type {
  BeamerDocumentModel,
  BeamerFrameLayout,
  BeamerThemeKind,
  BeamerThemeUseModel,
} from "./types.js";

/**
 * Inspector model for the whole deck, shown below the slide's options when
 * nothing is selected. Everything is read from the scanned document and the
 * theme the renderer resolves from it, so the panel shows what the preview
 * shows. Theme, page, navigation and short metadata controls are writable;
 * color controls are writable (design/beamer-document-inspector.md).
 */
export type DeckThemeCard = {
  /** Display name: the last `\usetheme`, or "Default" when there is none. */
  name: string;
  /** The catalog id of that theme, null when the preview does not know it. */
  catalogId: string | null;
  group: BeamerThemeGroup | null;
  /** False when the renderer does not know the theme and uses default chrome. */
  supported: boolean;
  /** Components the resolver applied, in order, without class defaults. */
  components: ReadonlyArray<{ kind: Exclude<BeamerThemeKind, "theme">; name: string }>;
  /** A few characteristic colors of the resolved theme, for a swatch strip. */
  palette: readonly string[];
  issues: readonly Diagnostic[];
  readOnly?: { reason: string; span: Span };
};

export type DeckDocumentInspectorModel = {
  theme: DeckThemeCard;
  themeOptions: DeckInspectorField[];
  /** Color, font, inner and outer theme, behind an Advanced disclosure. */
  components: DeckInspectorField[];
  colors: DeckInspectorField[];
  page: DeckInspectorField[];
  /** Text the theme's chrome prints; empty when it prints no title-page fields. */
  headerFooter: DeckInspectorField[];
};

export type DeckSlideContext = {
  section: string | null;
  subsection: string | null;
  noteCount: number;
  /** What the preview approximates or leaves out on this slide. */
  issues: ReadonlyArray<{ severity: Diagnostic["severity"]; message: string }>;
};

/** `theme` is the document's resolved theme when the caller has one. */
export function buildDeckDocumentInspector(
  document: BeamerDocumentModel,
  theme: ResolvedBeamerTheme = resolveBeamerTheme(document)
): DeckDocumentInspectorModel {
  const uses = executingThemeUses(document);
  const blocked = themeEditBlocker(document);
  const optionBlocked = themeOptionEditBlocker(document);
  const presentation = uses.filter((use) => use.kind === "theme").at(-1) ?? null;
  const presentationName = presentation ? lastName(presentation) : null;
  const entry = presentationName == null ? beamerPresentationTheme("default") : beamerPresentationTheme(presentationName);
  return {
    theme: { ...themeCard(theme, presentation, presentationName, entry), ...(blocked ? { readOnly: blocked } : {}) },
    themeOptions: (entry?.options ?? [])
      .map((schema) => {
        const field = themeOptionField(schema, parseThemeOptions(presentation?.options?.value));
        return optionBlocked ? { ...field, write: null, readOnly: optionBlocked } : field;
      }),
    components: (["color-theme", "font-theme", "inner-theme", "outer-theme"] as const)
      .map((kind) => {
        const field = componentField(kind, uses);
        return blocked ? { ...field, write: null, readOnly: blocked } : field;
      }),
    colors: colorFields(document, theme),
    page: pageFields(document, theme),
    headerFooter: headerFooterFields(document, theme),
  };
}

export function buildDeckSlideContext(
  document: BeamerDocumentModel,
  frameId: string,
  layout?: BeamerFrameLayout
): DeckSlideContext | null {
  const frame = document.frames.find((candidate) => candidate.id === frameId);
  if (!frame) {
    return null;
  }
  const sectionTitle = (id: string | null): string | null =>
    id == null ? null : document.sections.find((section) => section.id === id)?.title.value ?? null;
  const notes = scanBeamerNoteCommands(document.source)
    .filter((note) => note.kind === "note" && note.span.from >= frame.span.from && note.span.to <= frame.span.to);
  const issues = [
    ...document.diagnostics.filter((diagnostic) =>
      diagnostic.span.from >= frame.span.from && diagnostic.span.to <= frame.span.to),
    ...(layout?.items ?? []).flatMap((item) =>
      item.kind === "unsupported" && item.message ? [{ severity: "warning" as const, message: item.message }] : []),
  ];
  const byMessage = new Map<string, DeckSlideContext["issues"][number]>();
  for (const issue of issues) {
    if (!byMessage.has(issue.message)) byMessage.set(issue.message, { severity: issue.severity, message: issue.message });
  }
  return {
    section: sectionTitle(frame.sectionId),
    subsection: sectionTitle(frame.subsectionId),
    noteCount: notes.length,
    issues: [...byMessage.values()],
  };
}

/** `\usetheme{a,b}` loads both; the later one is the one the deck looks like. */
function lastName(use: BeamerThemeUseModel): string | null {
  const names = use.name.value.split(",").map((name) => name.trim()).filter((name) => name.length > 0);
  return names.at(-1) ?? null;
}

function themeCard(
  theme: ResolvedBeamerTheme,
  presentation: BeamerThemeUseModel | null,
  presentationName: string | null,
  entry: BeamerThemeCatalogEntry | null
): DeckThemeCard {
  const components: Array<{ kind: Exclude<BeamerThemeKind, "theme">; name: string }> = [];
  for (const applied of theme.appliedComponents) {
    if (applied.kind === "class-defaults" || applied.kind === "theme" || applied.name === "default") {
      continue;
    }
    if (!components.some((component) => component.kind === applied.kind && component.name === applied.name)) {
      components.push({ kind: applied.kind, name: applied.name });
    }
  }
  const palette: string[] = [];
  const add = (css: string | undefined): void => {
    if (css && !palette.includes(css.toLowerCase())) palette.push(css.toLowerCase());
  };
  add(resolveBeamerThemeColor(theme, "background canvas").bg);
  for (const role of ["palette primary", "palette secondary", "palette tertiary", "palette quaternary"]) {
    add(resolveBeamerThemeColor(theme, role).bg);
  }
  add(resolveBeamerThemeColor(theme, "structure").fg);
  add(resolveBeamerThemeColor(theme, "alerted text").fg);
  add(resolveBeamerThemeColor(theme, "example text").fg);
  return {
    name: entry?.label ?? presentationName ?? "Default",
    catalogId: entry?.id ?? null,
    group: entry?.group ?? null,
    supported: presentation == null || entry != null,
    components,
    palette: palette.slice(0, 6),
    issues: theme.diagnostics.filter((diagnostic) => diagnostic.code === "beamer-unknown-theme-component"),
  };
}

function themeOptionField(
  schema: BeamerThemeOptionSchema,
  options: Readonly<Record<string, string | boolean>>
): DeckInspectorField {
  switch (schema.kind) {
    case "boolean": {
      const raw = options[schema.key];
      return {
        kind: "boolean", id: `theme-option:${schema.key}`, label: schema.label,
        value: raw === undefined ? schema.default : raw === true || raw === "true",
        write: { kind: "setThemeOption", key: schema.key },
      };
    }
    case "enum": {
      const raw = options[schema.key];
      return {
        kind: "enum", id: `theme-option:${schema.key}`, label: schema.label,
        value: typeof raw === "string" ? raw : schema.default,
        options: [...schema.values],
        write: { kind: "setThemeOption", key: schema.key },
      };
    }
    case "flag-choice": {
      // Beamer processes options in order, so the last flag given wins.
      const flags = schema.values.map((choice) => choice.value);
      const given = Object.keys(options).filter((key) => flags.includes(key) && options[key] === true).at(-1);
      return {
        kind: "enum", id: `theme-option:${schema.id}`, label: schema.label,
        value: given ?? schema.default,
        options: [...schema.values],
        write: { kind: "setThemeFlagChoice", keys: flags },
      };
    }
    case "dimension": {
      const raw = options[schema.key];
      return {
        kind: "text", id: `theme-option:${schema.key}`, label: schema.label,
        value: typeof raw === "string" ? raw : "",
        placeholder: schema.placeholder,
        write: { kind: "setThemeOption", key: schema.key },
      };
    }
  }
}

const COMPONENT_LABELS: Record<Exclude<BeamerThemeKind, "theme">, string> = {
  "color-theme": "Color theme",
  "font-theme": "Font theme",
  "inner-theme": "Inner theme",
  "outer-theme": "Outer theme",
};

/** "" stands for "whatever the presentation theme chose". */
function componentField(
  kind: Exclude<BeamerThemeKind, "theme">,
  uses: readonly BeamerThemeUseModel[]
): DeckInspectorField {
  const explicit = uses.filter((use) => use.kind === kind).at(-1);
  const value = explicit ? lastName(explicit) ?? "" : "";
  const registered = new Set(registeredBeamerThemeComponents(kind));
  const choices = beamerThemeComponentChoices(kind).filter((name) => registered.has(name));
  const options = [
    { value: "", label: "From theme" },
    ...choices.map((name) => ({ value: name, label: name })),
  ];
  if (value !== "" && !choices.includes(value.toLocaleLowerCase())) {
    options.push({ value, label: `${value} (not previewed)` });
  }
  return {
    kind: "enum",
    id: `component:${kind}`,
    label: COMPONENT_LABELS[kind],
    value: choices.find((name) => name === value.toLocaleLowerCase()) ?? value,
    options,
    write: { kind: "setTheme", themeKind: kind },
  };
}

function colorFields(document: BeamerDocumentModel, theme: ResolvedBeamerTheme): DeckInspectorField[] {
  const canvas = resolveBeamerThemeColor(theme, "background canvas").bg;
  const namedColorSwatches = beamerNamedColorSwatches(document, theme);
  return BEAMER_INSPECTOR_COLOR_ROLES.map(({ role, label, sides }) => {
    const resolved = resolveBeamerThemeColor(theme, role);
    const blocked = colorEditBlocker(document, role);
    const authored = authoredColorSides(document, role);
    const side = (name: "fg" | "bg"): DeckInspectorColor | null => {
      const css = resolved[name];
      const origin = resolveBeamerThemeColorOrigin(theme, role, name);
      return css || origin ? { css: css ?? "transparent", expression: origin?.expression ?? null, origin: origin ? "preamble" : "theme", ...(origin ? { sourceSpan: origin.span, role: origin.role } : {}) } : null;
    };
    return {
      kind: "color" as const,
      id: `color:${role}`,
      label,
      role,
      namedColorSwatches,
      resetSides: sides.filter(side => authored.has(side)),
      ...(sides.includes("fg") ? { fg: side("fg") } : {}),
      ...(sides.includes("bg") ? { bg: side("bg") } : {}),
      ...(sides.length === 2 && canvas ? { backdrop: canvas } : {}),
      origin: sides.some(name => resolveBeamerThemeColorOrigin(theme, role, name) != null) ? "preamble" as const : "theme" as const,
      write: blocked ? null : { kind: "setColor" as const, role, side: sides[0] ?? "fg" },
      ...(blocked ? { readOnly: blocked } : {}),
    };
  });
}

/** "" is the class or theme default; choosing it removes the authored setting. */
function pageFields(document: BeamerDocumentModel, theme: ResolvedBeamerTheme): DeckInspectorField[] {
  const options = beamerClassOptionEntries(document);
  const aspect = options.some(option => option.kind !== "unknown" && option.key === "aspectratio")
    ? beamerClassOptionValue(document, "aspectratio") ?? "43" : "";
  const aspectOptions: Array<{ value: string; label: string }> = [{ value: "", label: "Default (4:3)" }, ...BEAMER_ASPECT_RATIOS];
  const classBlocked = classOptionEditBlocker(document);
  const navigationBlocked = navigationEditBlocker(document);
  if (!aspectOptions.some((option) => option.value === aspect)) {
    aspectOptions.push({ value: aspect, label: aspect });
  }
  const shown = theme.templates.navigationSymbols.id !== "beamer/navigation-symbols/none";
  return [
    {
      kind: "enum", id: "aspectratio", label: "Aspect ratio", value: aspect,
      options: aspectOptions, write: classBlocked ? null : { kind: "setClassOption", key: "aspectratio" },
      ...(classBlocked ? { readOnly: classBlocked } : {}),
    },
    {
      kind: "enum", id: "class-font-size", label: "Font size",
      value: options.some(option => beamerClassFontOption(option) !== null) ? beamerClassFontSize(document) : "",
      options: [{ value: "", label: "Default (11 pt)" }, ...BEAMER_CLASS_FONT_SIZES.map((size) => ({ value: size, label: `${size} pt` }))],
      write: classBlocked ? null : { kind: "setClassOption", key: "font-size" },
      ...(classBlocked ? { readOnly: classBlocked } : {}),
    },
    {
      kind: "enum", id: "navigation-symbols", label: "Navigation",
      value: scanBeamerNavigationTemplates(document).length > 0 ? shown ? "shown" : "hidden" : "",
      options: [
        { value: "", label: "From theme" },
        { value: "shown", label: "Symbols shown" },
        { value: "hidden", label: "Symbols hidden" },
      ],
      write: navigationBlocked ? null : { kind: "setNavigationSymbols" },
      ...(navigationBlocked ? { readOnly: navigationBlocked } : {}),
    },
  ];
}

const METADATA_LABELS: Record<BeamerChromeMetadataField, string> = {
  title: "Title",
  author: "Author",
  institute: "Institute",
  date: "Date",
};

/**
 * The short forms, as the text the theme prints in its header, footer or
 * sidebar. The long forms belong to the title slide and are edited there; an
 * inherited field shows the full text as its placeholder, and clearing a
 * field inherits again. An authored empty short form (`[]`) shows "Hidden".
 */
function headerFooterFields(document: BeamerDocumentModel, theme: ResolvedBeamerTheme): DeckInspectorField[] {
  return beamerChromeMetadataFields(theme).map((name) => {
    const field = document.preamble.metadata[name];
    const long = field?.value.value.trim() ?? "";
    const blocked = metadataShortEditBlocker(document, name);
    return {
      kind: "text",
      id: `metadata:${name}:short`,
      label: METADATA_LABELS[name],
      value: field?.shortValue?.value ?? "",
      placeholder: field?.shortValue ? "Hidden" : long.length > 0 ? long : "Not set",
      write: blocked ? null : { kind: "setMetadataShort", field: name },
      ...(blocked ? { readOnly: blocked } : {}),
    };
  });
}
