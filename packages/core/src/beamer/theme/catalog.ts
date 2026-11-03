import type { BeamerThemeKind } from "../types.js";

/**
 * What the editor offers for each theme component the resolver applies: the
 * display name, the gallery group, and the options the applier reads. An
 * option the resolver ignores is not listed, so the inspector never offers a
 * setting that would change the source but not the preview.
 * `test/beamer-theme-catalog.spec.ts` keeps this in step with the resolver's
 * component registry.
 */
export type BeamerThemeOptionSchema =
  | { kind: "boolean"; key: string; label: string; default: boolean }
  | {
      kind: "enum";
      key: string;
      label: string;
      default: string;
      values: ReadonlyArray<{ value: string; label: string }>;
    }
  /** Two flag options of which at most one is given, e.g. `left` / `right`. */
  | {
      kind: "flag-choice";
      id: string;
      label: string;
      default: string;
      values: ReadonlyArray<{ value: string; label: string }>;
    }
  | { kind: "dimension"; key: string; label: string; placeholder: string };

/** Beamer's own grouping of its presentation themes (user guide, section 15.1). */
export type BeamerThemeGroup =
  | "no-navigation"
  | "tree"
  | "sidebar"
  | "mini-frames"
  | "section-tables"
  | "modern";

export type BeamerThemeCatalogEntry = {
  /** Normalized name, as the resolver registers it. */
  id: string;
  /** The spelling Beamer's file uses, written back into `\usetheme`. */
  name: string;
  /** Display name; differs from `name` only for `default`. */
  label: string;
  group: BeamerThemeGroup | null;
  options: readonly BeamerThemeOptionSchema[];
};

/** Beamer's grouping of color themes (user guide, section 17.1). */
export type BeamerColorThemeGroup = "complete" | "inner" | "outer" | "default" | "modern";

const SECTION_HEADER: BeamerThemeOptionSchema = {
  kind: "boolean", key: "secheader", label: "Section header", default: false,
};

const COMPRESS: BeamerThemeOptionSchema = {
  kind: "boolean", key: "compress", label: "Compact navigation", default: false,
};

const SIDEBAR_OPTIONS: readonly BeamerThemeOptionSchema[] = [
  {
    kind: "flag-choice", id: "side", label: "Sidebar", default: "left",
    values: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }],
  },
  { kind: "dimension", key: "width", label: "Width", placeholder: "Theme default" },
  { kind: "dimension", key: "height", label: "Head height", placeholder: "Theme default" },
  { kind: "boolean", key: "hideothersubsections", label: "Hide other subsections", default: false },
  { kind: "boolean", key: "hideallsubsections", label: "Hide all subsections", default: false },
];

const MODERN_OPTIONS: readonly BeamerThemeOptionSchema[] = [
  {
    kind: "enum", key: "progressbar", label: "Progress bar", default: "none",
    values: [
      { value: "none", label: "None" },
      { value: "head", label: "Head" },
      { value: "frametitle", label: "Frame title" },
      { value: "foot", label: "Foot" },
    ],
  },
  {
    kind: "enum", key: "numbering", label: "Numbering", default: "counter",
    values: [
      { value: "counter", label: "Counter" },
      { value: "fraction", label: "Fraction" },
      { value: "none", label: "None" },
    ],
  },
  {
    kind: "enum", key: "background", label: "Background", default: "light",
    values: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }],
  },
];

function theme(
  name: string,
  group: BeamerThemeGroup | null,
  options: readonly BeamerThemeOptionSchema[] = []
): BeamerThemeCatalogEntry {
  return { id: name.toLocaleLowerCase(), name, label: name === "default" ? "Default" : name, group, options };
}

export const BEAMER_PRESENTATION_THEMES: readonly BeamerThemeCatalogEntry[] = [
  theme("default", "no-navigation"),
  theme("Bergen", "no-navigation"),
  theme("Boadilla", "no-navigation", [SECTION_HEADER]),
  theme("Madrid", "no-navigation", [SECTION_HEADER]),
  theme("AnnArbor", "no-navigation"),
  theme("CambridgeUS", "no-navigation"),
  theme("EastLansing", "no-navigation"),
  theme("Pittsburgh", "no-navigation"),
  theme("Rochester", "no-navigation", SIDEBAR_OPTIONS),
  theme("Antibes", "tree"),
  theme("JuanLesPins", "tree"),
  theme("Montpellier", "tree"),
  theme("Berkeley", "sidebar", SIDEBAR_OPTIONS),
  theme("PaloAlto", "sidebar", SIDEBAR_OPTIONS),
  theme("Goettingen", "sidebar", SIDEBAR_OPTIONS),
  theme("Marburg", "sidebar", SIDEBAR_OPTIONS),
  theme("Hannover", "sidebar", SIDEBAR_OPTIONS),
  theme("Berlin", "mini-frames", [COMPRESS]),
  theme("Ilmenau", "mini-frames", [COMPRESS]),
  theme("Dresden", "mini-frames", [COMPRESS]),
  theme("Darmstadt", "mini-frames"),
  theme("Frankfurt", "mini-frames"),
  theme("Singapore", "mini-frames", [COMPRESS]),
  theme("Szeged", "mini-frames", [COMPRESS]),
  theme("Copenhagen", "section-tables"),
  theme("Luebeck", "section-tables"),
  theme("Malmoe", "section-tables"),
  theme("Warsaw", "section-tables"),
  theme("metropolis", "modern", MODERN_OPTIONS),
  theme("moloch", "modern", MODERN_OPTIONS),
];

export const BEAMER_COLOR_THEMES: ReadonlyArray<{ id: string; group: BeamerColorThemeGroup }> = [
  { id: "default", group: "default" },
  { id: "beaver", group: "complete" },
  { id: "dove", group: "complete" },
  { id: "spruce", group: "complete" },
  { id: "wolverine", group: "complete" },
  { id: "orchid", group: "inner" },
  { id: "rose", group: "inner" },
  { id: "dolphin", group: "outer" },
  { id: "seahorse", group: "outer" },
  { id: "whale", group: "outer" },
  { id: "metropolis", group: "modern" },
  { id: "moloch", group: "modern" },
];

export const BEAMER_FONT_THEMES: readonly string[] = ["default", "serif", "professionalfonts", "metropolis", "moloch"];
export const BEAMER_INNER_THEMES: readonly string[] = ["default", "rectangles", "circles", "rounded", "inmargin", "metropolis", "moloch"];
export const BEAMER_OUTER_THEMES: readonly string[] = [
  "default", "infolines", "miniframes", "smoothbars", "sidebar", "split", "shadow", "tree", "smoothtree", "metropolis", "moloch",
];

/** Component names per kind, in the order the inspector lists them. */
export function beamerThemeComponentChoices(kind: Exclude<BeamerThemeKind, "theme">): readonly string[] {
  switch (kind) {
    case "color-theme":
      return BEAMER_COLOR_THEMES.map((entry) => entry.id);
    case "font-theme":
      return BEAMER_FONT_THEMES;
    case "inner-theme":
      return BEAMER_INNER_THEMES;
    case "outer-theme":
      return BEAMER_OUTER_THEMES;
  }
}

export function beamerPresentationTheme(name: string): BeamerThemeCatalogEntry | null {
  const id = name.trim().toLocaleLowerCase();
  return BEAMER_PRESENTATION_THEMES.find((entry) => entry.id === id) ?? null;
}
