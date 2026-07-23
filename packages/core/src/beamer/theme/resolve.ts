import type { Diagnostic } from "../../diagnostics/types.js";
import type { BeamerDocumentModel, BeamerThemeKind } from "../types.js";
import type {
  BeamerThemeColor,
  BeamerThemeComponentProvenance,
  BeamerThemeFont,
  BeamerThemeFontRole,
  BeamerThemeTemplateRef,
  BeamerThemeTemplates,
  BeamerThemeUse,
  ResolvedBeamerThemeColor,
  ResolvedBeamerTheme,
} from "./types.js";

const TEX_POINTS_PER_CM = 72.27 / 2.54;

type MutableTheme = {
  id: string;
  colors: Record<string, BeamerThemeColor>;
  fonts: Record<BeamerThemeFontRole, BeamerThemeFont>;
  dimensions: {
    textMarginLeftPt: number;
    textMarginRightPt: number;
  };
  templates: BeamerThemeTemplates;
  options: Record<string, string | boolean>;
  appliedComponents: BeamerThemeComponentProvenance[];
  diagnostics: Diagnostic[];
};

type ComponentApplier = (state: MutableTheme, use: BeamerThemeUse) => void;

const DEFAULT_REF = (id: string): BeamerThemeTemplateRef => ({
  id,
  options: {},
});

/**
 * Resolve Beamer's ordered theme component stream into renderer-facing data.
 *
 * Preset composition below follows the corresponding TeX Live 2025 `.sty`
 * files. Aggregate themes call the same component appliers as explicit
 * `\useoutertheme`/`\usecolortheme` commands, so later uses naturally win.
 */
export function resolveBeamerTheme(
  document: BeamerDocumentModel
): ResolvedBeamerTheme {
  const state = createDefaultTheme();
  const uses = document.preamble.themes
    .flatMap((source) =>
      source.name.value.split(",").map((name): BeamerThemeUse => ({
        kind: source.kind,
        name: name.trim(),
        options: parseThemeOptions(source.options?.value),
        source,
      }))
    )
    .filter((use) => use.name.length > 0);

  for (const use of uses) {
    const applier = componentRegistry[use.kind].get(normalizeName(use.name));
    if (applier) {
      applier(state, use);
      continue;
    }
    state.diagnostics.push({
      severity: "warning",
      code: "beamer-unknown-theme-component",
      message: `The Beamer ${use.kind} component '${use.name}' is not registered; class defaults remain active for that component.`,
      span: use.source.span,
    });
  }

  return {
    id: state.id,
    colors: freezeRecord(state.colors),
    fonts: freezeRecord(state.fonts),
    dimensions: Object.freeze({ ...state.dimensions }),
    templates: freezeTemplates(state.templates),
    options: Object.freeze({ ...state.options }),
    appliedComponents: Object.freeze([...state.appliedComponents]),
    diagnostics: Object.freeze([...state.diagnostics]),
  };
}

/** Resolve a Beamer color role through its parent chain. */
export function resolveBeamerThemeColor(
  theme: ResolvedBeamerTheme,
  role: string
): ResolvedBeamerThemeColor {
  const seen = new Set<string>();
  const resolve = (name: string): ResolvedBeamerThemeColor => {
    if (seen.has(name)) {
      return {};
    }
    seen.add(name);
    const color = theme.colors[name];
    if (!color) {
      return {};
    }
    const parent = color.parent ? resolve(color.parent) : {};
    return {
      ...parent,
      ...(color.fg ? { fg: color.fg } : {}),
      ...(color.bg ? { bg: color.bg } : {}),
    };
  };
  return resolve(role);
}

function createDefaultTheme(): MutableTheme {
  const normalFont: BeamerThemeFont = {
    family: "sans",
    series: "medium",
    shape: "upright",
    sizePt: 10.95,
    lineHeightPt: 13.6,
  };
  return {
    id: "default",
    colors: {
      "normal text": { fg: "#000000", bg: "#ffffff" },
      structure: { fg: "#3333b3" },
      "local structure": { parent: "structure" },
      item: { parent: "local structure" },
      "palette primary": { fg: "#3333b3" },
      "palette secondary": { fg: "#262686" },
      "palette tertiary": { fg: "#1a1a59" },
      "palette quaternary": { fg: "#000000" },
      titlelike: { fg: "#3333b3" },
      frametitle: { fg: "#3333b3" },
      "alerted text": { fg: "#ff0000" },
      "example text": { fg: "#008000" },
    },
    fonts: {
      "normal-text": normalFont,
      "frame-title": {
        ...normalFont,
        sizePt: 14.4,
        lineHeightPt: 17.28,
      },
      "frame-subtitle": {
        ...normalFont,
        sizePt: 8,
        lineHeightPt: 9.5,
      },
      footline: {
        ...normalFont,
        sizePt: 6,
        lineHeightPt: 7,
      },
      // beamerfontthemedefault.sty: block title inherits block body and
      // selects \large. In the 11pt class profile that is 12pt/14pt.
      "block-title": {
        ...normalFont,
        sizePt: 12,
        lineHeightPt: 14,
      },
      "block-body": normalFont,
    },
    // beamer.cls passes hmargin=1cm to geometry.
    dimensions: {
      textMarginLeftPt: cmToTexPt(1),
      textMarginRightPt: cmToTexPt(1),
    },
    templates: {
      headline: DEFAULT_REF("beamer/headline/none"),
      footline: DEFAULT_REF("beamer/footline/none"),
      frameTitle: DEFAULT_REF("beamer/frame-title/default"),
      titlePage: DEFAULT_REF("beamer/title-page/default"),
      sectionPage: DEFAULT_REF("beamer/section-page/default"),
      block: DEFAULT_REF("beamer/block/default"),
      bullets: [
        DEFAULT_REF("beamer/bullet/triangle"),
        DEFAULT_REF("beamer/bullet/triangle"),
        DEFAULT_REF("beamer/bullet/triangle"),
      ],
    },
    options: {},
    appliedComponents: [
      {
        kind: "class-defaults",
        name: "beamer",
        source: null,
      },
    ],
    diagnostics: [],
  };
}

const themeAppliers = new Map<string, ComponentApplier>([
  ["default", markAggregateOnly("default")],
  ["madrid", (state, use) => {
    state.id = "Madrid";
    markApplied(state, "theme", "Madrid", use);
    applyNamedComponent(state, "color-theme", "whale", use);
    applyNamedComponent(state, "color-theme", "orchid", use);
    applyNamedComponent(state, "inner-theme", "rounded", use);
    applyNamedComponent(state, "outer-theme", "infolines", use);
    // beamerthemeMadrid.sty resets the infolines headline unless secheader is
    // explicitly selected.
    if (use.options.secheader !== true) {
      state.templates.headline = DEFAULT_REF("beamer/headline/none");
    }
  }],
  ["metropolis", (state, use) => { applyModernTheme(state, use, "metropolis"); }],
  ["moloch", (state, use) => { applyModernTheme(state, use, "moloch"); }],
]);

const colorThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("color-theme", "default")],
  ["whale", (state, use) => {
    markApplied(state, "color-theme", "whale", use);
    state.colors["palette primary"] = { fg: "#ffffff", bg: "#3333b3" };
    state.colors["palette secondary"] = { fg: "#ffffff", bg: "#262686" };
    state.colors["palette tertiary"] = { fg: "#ffffff", bg: "#1a1a59" };
    state.colors["palette quaternary"] = { fg: "#ffffff", bg: "#000000" };
    state.colors.titlelike = { ...state.colors["palette primary"] };
    state.colors.frametitle = { ...state.colors.titlelike };
  }],
  ["orchid", (state, use) => {
    markApplied(state, "color-theme", "orchid", use);
    state.colors["block title"] = { fg: "#ffffff", bg: "#262686" };
    state.colors["block body"] = { fg: "#000000", bg: "#e9e9f3" };
  }],
  ["seahorse", (state, use) => {
    markApplied(state, "color-theme", "seahorse", use);
    // structure.fg!20/25/30/35!white from beamercolorthemeseahorse.sty.
    state.colors["palette primary"] = { fg: "#000000", bg: "#d6d6f0" };
    state.colors["palette secondary"] = { fg: "#000000", bg: "#cccced" };
    state.colors["palette tertiary"] = { fg: "#000000", bg: "#c2c2e8" };
    state.colors["palette quaternary"] = { fg: "#000000", bg: "#b8b8e4" };
    state.colors.titlelike = { ...state.colors["palette primary"] };
    state.colors.frametitle = { ...state.colors.titlelike };
  }],
  ["metropolis", applyMetropolisColors],
  ["moloch", applyMolochColors],
]);

const fontThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("font-theme", "default")],
  ["metropolis", applyModernFonts("metropolis")],
  ["moloch", applyModernFonts("moloch")],
]);

const innerThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("inner-theme", "default")],
  ["rounded", (state, use) => {
    markApplied(state, "inner-theme", "rounded", use);
    state.templates.block = DEFAULT_REF("beamer/block/rounded-shadow");
    state.templates.bullets = [
      DEFAULT_REF("beamer/bullet/ball"),
      DEFAULT_REF("beamer/bullet/ball"),
      DEFAULT_REF("beamer/bullet/ball"),
    ];
  }],
  ["metropolis", applyModernInner("metropolis")],
  ["moloch", applyModernInner("moloch")],
]);

const outerThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("outer-theme", "default")],
  ["infolines", (state, use) => {
    markApplied(state, "outer-theme", "infolines", use);
    state.templates.footline = DEFAULT_REF("beamer/footline/infolines");
    state.templates.headline = DEFAULT_REF("beamer/headline/infolines");
    state.colors["author in head/foot"] = { parent: "palette tertiary" };
    state.colors["title in head/foot"] = { parent: "palette secondary" };
    state.colors["date in head/foot"] = { parent: "palette primary" };
    // beamerouterthemeinfolines.sty: text margin left/right=1em.
    state.dimensions.textMarginLeftPt = state.fonts["normal-text"].sizePt;
    state.dimensions.textMarginRightPt = state.fonts["normal-text"].sizePt;
  }],
  ["metropolis", applyModernOuter("metropolis")],
  ["moloch", applyModernOuter("moloch")],
]);

const componentRegistry: Record<
  BeamerThemeKind,
  ReadonlyMap<string, ComponentApplier>
> = {
  theme: themeAppliers,
  "color-theme": colorThemeAppliers,
  "font-theme": fontThemeAppliers,
  "inner-theme": innerThemeAppliers,
  "outer-theme": outerThemeAppliers,
};

function applyModernTheme(
  state: MutableTheme,
  use: BeamerThemeUse,
  family: "metropolis" | "moloch"
): void {
  state.id = family;
  markApplied(state, "theme", family, use);
  state.options = { ...state.options, ...use.options };
  applyNamedComponent(state, "inner-theme", family, use);
  applyNamedComponent(state, "outer-theme", family, use);
  applyNamedComponent(state, "color-theme", family, use);
  applyNamedComponent(state, "font-theme", family, use);
}

function applyModernOuter(
  family: "metropolis" | "moloch"
): ComponentApplier {
  return (state, use) => {
    markApplied(state, "outer-theme", family, use);
    const progressbar = optionString(use.options.progressbar, "none");
    state.templates.headline = DEFAULT_REF(
      progressbar === "head"
        ? `beamer/headline/${family}-progress`
        : "beamer/headline/none"
    );
    state.templates.footline = templateRef(
      `beamer/footline/${family}`,
      { numbering: optionString(use.options.numbering, "counter") },
    );
    state.templates.frameTitle = templateRef(
      `beamer/frame-title/${family}`,
      { progressbar: progressbar === "frametitle" },
    );
  };
}

function applyModernInner(
  family: "metropolis" | "moloch"
): ComponentApplier {
  return (state, use) => {
    markApplied(state, "inner-theme", family, use);
    state.templates.titlePage = DEFAULT_REF(`beamer/title-page/${family}`);
    state.templates.sectionPage = templateRef(
      `beamer/section-page/${family}`,
      { style: optionString(use.options.sectionpage, "progressbar") },
    );
    state.templates.block = templateRef(
      `beamer/block/${family}`,
      { style: optionString(use.options.block, "transparent") },
    );
    state.templates.bullets = [
      DEFAULT_REF(`beamer/bullet/${family}`),
      DEFAULT_REF(`beamer/bullet/${family}`),
      DEFAULT_REF(`beamer/bullet/${family}`),
    ];
  };
}

function applyModernFonts(
  family: "metropolis" | "moloch"
): ComponentApplier {
  return (state, use) => {
    markApplied(state, "font-theme", family, use);
    // Native Fira metrics are deferred; retain the requested face explicitly.
    state.fonts["normal-text"] = {
      ...state.fonts["normal-text"],
      ...(family === "metropolis"
        ? { substitutedFor: "Fira Sans Light" }
        : {}),
    };
    state.fonts["frame-title"] = {
      ...state.fonts["frame-title"],
      sizePt: 12,
      lineHeightPt: 14.4,
      series: "bold",
      ...(family === "metropolis"
        ? { substitutedFor: "Fira Sans" }
        : {}),
    };
    state.fonts["block-title"] = {
      ...state.fonts["normal-text"],
      series: "bold",
    };
    if (family === "metropolis") {
      state.diagnostics.push({
        severity: "warning",
        code: "beamer-font-substitution",
        message:
          "Metropolis requests Fira Sans; the native Beamer renderer currently substitutes Latin Modern Sans.",
        span: use.source.span,
      });
    }
  };
}

function applyMetropolisColors(state: MutableTheme, use: BeamerThemeUse): void {
  markApplied(state, "color-theme", "metropolis", use);
  applyModernColors(state, use, "#23373b", "#fafafa", "#eb811b", "#14b03d");
}

function applyMolochColors(state: MutableTheme, use: BeamerThemeUse): void {
  markApplied(state, "color-theme", "moloch", use);
  applyModernColors(state, use, "#23373b", "#fafafa", "#eb811b", "#008080");
}

function applyModernColors(
  state: MutableTheme,
  use: BeamerThemeUse,
  dark: string,
  light: string,
  accent: string,
  example: string
): void {
  const darkBackground = use.options.background === "dark";
  const fg = darkBackground ? light : dark;
  const bg = darkBackground ? dark : light;
  state.colors["normal text"] = { fg, bg };
  state.colors.structure = { fg };
  state.colors["palette primary"] = { fg: bg, bg: fg };
  state.colors.titlelike = { fg, bg };
  state.colors.frametitle = { fg: bg, bg: fg };
  state.colors["alerted text"] = { fg: accent };
  state.colors["example text"] = { fg: example };
  state.colors["progress bar"] = { fg: accent, bg: "#8a5a35" };
  state.colors["progress bar background"] = { bg: "#8a5a35" };
}

function applyNamedComponent(
  state: MutableTheme,
  kind: Exclude<BeamerThemeKind, "theme">,
  name: string,
  aggregateUse: BeamerThemeUse
): void {
  componentRegistry[kind].get(name)?.(state, {
    ...aggregateUse,
    kind,
    name,
  });
}

function markAggregateOnly(name: string): ComponentApplier {
  return (state, use) => {
    state.id = name;
    markApplied(state, "theme", name, use);
  };
}

function markComponentOnly(
  kind: Exclude<BeamerThemeKind, "theme">,
  name: string
): ComponentApplier {
  return (state, use) => { markApplied(state, kind, name, use); };
}

function markApplied(
  state: MutableTheme,
  kind: BeamerThemeKind,
  name: string,
  use: BeamerThemeUse
): void {
  state.appliedComponents.push({
    kind,
    name,
    source: use.source,
  });
}

function parseThemeOptions(
  source: string | undefined
): Readonly<Record<string, string | boolean>> {
  if (!source) {
    return {};
  }
  const result: Record<string, string | boolean> = {};
  for (const rawEntry of source.split(",")) {
    const [rawKey, ...rawValue] = rawEntry.split("=");
    const key = rawKey?.trim();
    if (!key) {
      continue;
    }
    result[key] = rawValue.length > 0
      ? rawValue.join("=").trim()
      : true;
  }
  return result;
}

function templateRef(
  id: string,
  options: Record<string, string | boolean>
): BeamerThemeTemplateRef {
  return { id, options };
}

function optionString(
  value: string | boolean | undefined,
  fallback: string
): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeName(name: string): string {
  return name.toLocaleLowerCase();
}

function cmToTexPt(value: number): number {
  return value * TEX_POINTS_PER_CM;
}

function freezeRecord<T extends Record<string, object>>(record: T): Readonly<T> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        Object.freeze({ ...value }),
      ])
    )
  ) as Readonly<T>;
}

function freezeTemplates(templates: BeamerThemeTemplates): BeamerThemeTemplates {
  const freezeRef = (ref: BeamerThemeTemplateRef): BeamerThemeTemplateRef =>
    Object.freeze({
      id: ref.id,
      options: Object.freeze({ ...ref.options }),
    });
  return Object.freeze({
    headline: freezeRef(templates.headline),
    footline: freezeRef(templates.footline),
    frameTitle: freezeRef(templates.frameTitle),
    titlePage: freezeRef(templates.titlePage),
    sectionPage: freezeRef(templates.sectionPage),
    block: freezeRef(templates.block),
    bullets: Object.freeze(templates.bullets.map(freezeRef)) as unknown as
      BeamerThemeTemplates["bullets"],
  });
}
