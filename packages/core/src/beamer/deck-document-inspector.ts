import type { Diagnostic } from "../diagnostics/types.js";
import { scanBeamerNoteCommands } from "./notes.js";
import { scanBeamerColorDeclarations } from "./theme/color-declarations.js";
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
 * shows. Fields carry `write: null` until the document-scoped edit actions
 * exist (design/beamer-document-inspector.md, phase 4).
 */
export type DeckThemeCard = {
  /** Display name: the last `\usetheme`, or "Default" when there is none. */
  name: string;
  group: BeamerThemeGroup | null;
  /** False when the renderer does not know the theme and uses default chrome. */
  supported: boolean;
  /** Components the resolver applied, in order, without class defaults. */
  components: ReadonlyArray<{ kind: Exclude<BeamerThemeKind, "theme">; name: string }>;
  /** A few characteristic colors of the resolved theme, for a swatch strip. */
  palette: readonly string[];
  issues: readonly Diagnostic[];
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
  const uses = activeThemeUses(document);
  const presentation = uses.filter((use) => use.kind === "theme").at(-1) ?? null;
  const presentationName = presentation ? lastName(presentation) : null;
  const entry = presentationName == null ? beamerPresentationTheme("default") : beamerPresentationTheme(presentationName);
  return {
    theme: themeCard(theme, presentation, presentationName, entry),
    themeOptions: (entry?.options ?? [])
      .map((schema) => themeOptionField(schema, parseThemeOptions(presentation?.options?.value))),
    components: (["color-theme", "font-theme", "inner-theme", "outer-theme"] as const)
      .map((kind) => componentField(kind, uses)),
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

/** Theme commands that execute, in source order (not those inside macro definitions). */
function activeThemeUses(document: BeamerDocumentModel): BeamerThemeUseModel[] {
  return document.preamble.themes.filter((use) => !document.preamble.macroDefinitions.some((definition) =>
    definition.span.from <= use.span.from && definition.span.to >= use.span.to));
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
        write: null,
      };
    }
    case "enum": {
      const raw = options[schema.key];
      return {
        kind: "enum", id: `theme-option:${schema.key}`, label: schema.label,
        value: typeof raw === "string" ? raw : schema.default,
        options: [...schema.values],
        write: null,
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
        write: null,
      };
    }
    case "dimension": {
      const raw = options[schema.key];
      return {
        kind: "text", id: `theme-option:${schema.key}`, label: schema.label,
        value: typeof raw === "string" ? raw : "",
        placeholder: schema.placeholder,
        write: null,
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
    write: null,
  };
}

const COLOR_ROLES: ReadonlyArray<{ role: string; label: string; sides: ReadonlyArray<"fg" | "bg"> }> = [
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

function colorFields(document: BeamerDocumentModel, theme: ResolvedBeamerTheme): DeckInspectorField[] {
  // The preamble's own `\setbeamercolor`s, latest last; the resolver has
  // already applied them, so they only decide the origin and the expression.
  const overrides = scanBeamerColorDeclarations(document).flatMap((event) =>
    event.kind === "beamer-color" ? [event] : []);
  const canvas = resolveBeamerThemeColor(theme, "background canvas").bg;
  return COLOR_ROLES.map(({ role, label, sides }) => {
    const resolved = resolveBeamerThemeColor(theme, role);
    const own = overrides.filter((event) => normalizeRole(event.role.value) === role);
    const authored = (side: "fg" | "bg"): string | null => {
      for (const event of [...own].reverse()) {
        const entry = [...event.entries].reverse().find((candidate) => candidate.kind === "kv" && candidate.key.trim() === side);
        if (entry?.kind === "kv") return entry.valueRaw.trim();
      }
      return null;
    };
    const side = (name: "fg" | "bg"): DeckInspectorColor | null => {
      const css = resolved[name];
      return css ? { css, expression: authored(name) } : null;
    };
    return {
      kind: "color" as const,
      id: `color:${role}`,
      label,
      ...(sides.includes("fg") ? { fg: side("fg") } : {}),
      ...(sides.includes("bg") ? { bg: side("bg") } : {}),
      ...(sides.length === 2 && canvas ? { backdrop: canvas } : {}),
      origin: own.length > 0 ? "preamble" as const : "theme" as const,
      write: null,
    };
  });
}

function normalizeRole(raw: string): string {
  return raw.trim().replace(/\s+/gu, " ");
}

/** The `aspectratio` values `beamer.cls` defines, in the order of its manual. */
const ASPECT_RATIOS = [
  { value: "43", label: "4:3" },
  { value: "169", label: "16:9" },
  { value: "1610", label: "16:10" },
  { value: "149", label: "14:9" },
  { value: "141", label: "1.41:1 (A4)" },
  { value: "54", label: "5:4" },
  { value: "32", label: "3:2" },
  { value: "2013", label: "20:13" },
] as const;

const CLASS_FONT_SIZES = ["8", "9", "10", "11", "12", "14", "17", "20"] as const;

function pageFields(document: BeamerDocumentModel, theme: ResolvedBeamerTheme): DeckInspectorField[] {
  const aspect = classOption(document, "aspectratio") ?? "43";
  const aspectOptions: Array<{ value: string; label: string }> = [...ASPECT_RATIOS];
  if (!aspectOptions.some((option) => option.value === aspect)) {
    aspectOptions.push({ value: aspect, label: aspect });
  }
  return [
    {
      kind: "enum", id: "aspectratio", label: "Aspect ratio", value: aspect,
      options: aspectOptions, write: null,
    },
    {
      kind: "enum", id: "class-font-size", label: "Base font size", value: beamerClassFontSize(document),
      options: CLASS_FONT_SIZES.map((size) => ({ value: size, label: `${size} pt` })), write: null,
    },
    {
      kind: "boolean", id: "navigation-symbols", label: "Navigation symbols",
      value: theme.templates.navigationSymbols.id !== "beamer/navigation-symbols/none",
      write: null,
    },
  ];
}

function classOption(document: BeamerDocumentModel, key: string): string | null {
  for (const entry of (document.preamble.documentClass?.options?.value ?? "").split(",")) {
    const [rawKey, ...rawValue] = entry.split("=");
    if (rawKey?.trim() === key) {
      return rawValue.join("=").trim() || null;
    }
  }
  return null;
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
 * empty field shows the long form it falls back to as its placeholder.
 */
function headerFooterFields(document: BeamerDocumentModel, theme: ResolvedBeamerTheme): DeckInspectorField[] {
  return beamerChromeMetadataFields(theme).map((name) => {
    const field = document.preamble.metadata[name];
    const long = field?.value.value.trim() ?? "";
    return {
      kind: "text",
      id: `metadata:${name}:short`,
      label: METADATA_LABELS[name],
      value: field?.shortValue?.value ?? "",
      placeholder: long.length > 0 ? long : "Not set",
      write: null,
    };
  });
}
