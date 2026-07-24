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

type AggregateComponentUse = {
  kind: Exclude<BeamerThemeKind, "theme">;
  name: string;
  options?:
    | Readonly<Record<string, string | boolean>>
    | ((
        aggregateOptions: Readonly<Record<string, string | boolean>>
      ) => Readonly<Record<string, string | boolean>>);
};

type AggregateThemeDefinition = {
  id: string;
  components: readonly AggregateComponentUse[];
  applyOverrides?: ComponentApplier;
};

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
  const resolve = (
    name: string,
    ancestors: ReadonlySet<string>
  ): ResolvedBeamerThemeColor => {
    if (ancestors.has(name)) {
      return {};
    }
    const seen = new Set(ancestors);
    seen.add(name);
    const color = theme.colors[name];
    if (!color) {
      return {};
    }
    const parent = color.parent ? resolve(color.parent, seen) : {};
    const mixedForeground = color.fgMix
      ? mixThemeForeground(
          foregroundChannels(
            theme,
            color.fgMix.foregroundRole,
            resolve(color.fgMix.foregroundRole, seen).fg
          ),
          parseHexColor(resolve(color.fgMix.backgroundRole, seen).bg),
          color.fgMix.foregroundPercent
        )
      : undefined;
    return {
      ...parent,
      ...(mixedForeground ? { fg: mixedForeground } : {}),
      ...(color.fg ? { fg: color.fg } : {}),
      ...(color.bg ? { bg: color.bg } : {}),
    };
  };
  return resolve(role, new Set());
}

function mixThemeForeground(
  foreground: readonly [number, number, number] | null,
  background: readonly [number, number, number] | null,
  foregroundPercent: number
): string | undefined {
  if (!foreground || !background) {
    return undefined;
  }
  const ratio = Math.max(0, Math.min(100, foregroundPercent)) / 100;
  const channels = foreground.map((value, index) =>
    Math.round(value * ratio + background[index] * (1 - ratio))
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function foregroundChannels(
  theme: ResolvedBeamerTheme,
  role: string,
  resolvedForeground: string | undefined
): [number, number, number] | null {
  const precise = theme.colors[role]?.fgRgb;
  return precise
    ? [precise[0] * 255, precise[1] * 255, precise[2] * 255]
    : parseHexColor(resolvedForeground);
}

function parseHexColor(
  color: string | undefined
): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(
    color ?? ""
  );
  return match
    ? [
        Number.parseInt(match[1], 16),
        Number.parseInt(match[2], 16),
        Number.parseInt(match[3], 16),
      ]
    : null;
}

type RgbChannels = readonly [number, number, number];

function xcolorMixRgb(
  first: RgbChannels,
  second: RgbChannels,
  firstPercent: number
): string {
  return rgbChannelsToHex(mixRgbChannels(first, second, firstPercent));
}

function mixRgbChannels(
  first: RgbChannels,
  second: RgbChannels,
  firstPercent: number
): RgbChannels {
  const ratio = Math.max(0, Math.min(100, firstPercent)) / 100;
  return [
    first[0] * ratio + second[0] * (1 - ratio),
    first[1] * ratio + second[1] * (1 - ratio),
    first[2] * ratio + second[2] * (1 - ratio),
  ];
}

function rgbChannelsToHex(channels: RgbChannels): string {
  return `#${channels
    .map((value) => Math.round(value * 255))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgbChannelsFromHex(color: string): RgbChannels {
  const channels = parseHexColor(color);
  if (!channels) {
    throw new Error(`Cannot resolve non-RGB theme color '${color}'.`);
  }
  return [
    channels[0] / 255,
    channels[1] / 255,
    channels[2] / 255,
  ];
}

function mutableThemeForegroundRgb(
  state: MutableTheme,
  role: string,
  fallback: string
): RgbChannels {
  return (
    state.colors[role]?.fgRgb ??
    rgbChannelsFromHex(
      resolveMutableThemeColor(state, role).fg ?? fallback
    )
  );
}

function resolveMutableThemeColor(
  state: MutableTheme,
  role: string
): ResolvedBeamerThemeColor {
  const resolve = (
    name: string,
    ancestors: ReadonlySet<string>
  ): ResolvedBeamerThemeColor => {
    if (ancestors.has(name)) {
      return {};
    }
    const color = state.colors[name];
    if (!color) {
      return {};
    }
    const seen = new Set(ancestors);
    seen.add(name);
    return {
      ...(color.parent ? resolve(color.parent, seen) : {}),
      ...(color.fg ? { fg: color.fg } : {}),
      ...(color.bg ? { bg: color.bg } : {}),
    };
  };
  return resolve(role, new Set());
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
      // beamercolorthemedefault.sty's blended blue is rgb(.2,.2,.7).
      // Retain those unquantized channels for xcolor percentage mixes.
      structure: { fg: "#3333b3", fgRgb: [0.2, 0.2, 0.7] },
      "local structure": { parent: "structure" },
      item: { parent: "local structure" },
      "palette primary": { fg: "#3333b3" },
      "palette secondary": { fg: "#262686" },
      "palette tertiary": { fg: "#1a1a59" },
      "palette quaternary": { fg: "#000000" },
      titlelike: { parent: "structure" },
      title: { parent: "titlelike" },
      subtitle: { parent: "title" },
      author: {},
      institute: {},
      date: {},
      frametitle: { parent: "titlelike" },
      "section in head/foot": { parent: "palette tertiary" },
      "subsection in head/foot": { parent: "palette secondary" },
      "alerted text": { fg: "#ff0000" },
      "example text": { fg: "#008000", fgRgb: [0, 0.5, 0] },
      "block body": {},
      "block body alerted": {},
      "block body example": {},
      "block title": { parent: "structure" },
      "block title alerted": { parent: "alerted text" },
      "block title example": { parent: "example text" },
      "navigation symbols": {
        fgMix: {
          foregroundRole: "structure",
          backgroundRole: "normal text",
          foregroundPercent: 40,
        },
      },
      "navigation symbols dimmed": {
        fgMix: {
          foregroundRole: "structure",
          backgroundRole: "normal text",
          foregroundPercent: 20,
        },
      },
    },
    fonts: {
      "normal-text": normalFont,
      title: {
        ...normalFont,
        sizePt: 14.4,
        lineHeightPt: 18,
      },
      subtitle: normalFont,
      author: normalFont,
      institute: {
        ...normalFont,
        sizePt: 8,
        lineHeightPt: 9.5,
      },
      date: normalFont,
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
      headline: {
        ...normalFont,
        sizePt: 6,
        lineHeightPt: 7,
      },
      "section-in-head-foot": {
        ...normalFont,
        sizePt: 6,
        lineHeightPt: 7,
      },
      "subsection-in-head-foot": {
        ...normalFont,
        sizePt: 6,
        lineHeightPt: 7,
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
      navigationSymbols: DEFAULT_REF("beamer/navigation-symbols/default"),
      frameTitle: DEFAULT_REF("beamer/frame-title/default"),
      titlePage: DEFAULT_REF("beamer/title-page/default"),
      sectionPage: DEFAULT_REF("beamer/section-page/default"),
      block: DEFAULT_REF("beamer/block/default"),
      bullets: [
        DEFAULT_REF("beamer/bullet/triangle"),
        DEFAULT_REF("beamer/bullet/triangle"),
        DEFAULT_REF("beamer/bullet/triangle"),
      ],
      enumerations: [
        DEFAULT_REF("beamer/enumeration/default"),
        DEFAULT_REF("beamer/enumeration/default"),
        DEFAULT_REF("beamer/enumeration/default"),
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
  ["default", defineAggregateTheme({
    id: "default",
    components: [],
  })],
  ["annarbor", defineAggregateTheme({
    id: "AnnArbor",
    // TeX Live 2025 beamerthemeAnnArbor.sty.
    components: [
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
      { kind: "outer-theme", name: "infolines" },
      { kind: "color-theme", name: "wolverine" },
    ],
    applyOverrides: (state) => {
      state.fonts["block-title"] = { ...state.fonts["block-body"] };
      state.colors.titlelike = {
        parent: "structure",
        bg: xcolorMixRgb(YELLOW_RGB, ORANGE_RGB, 85),
      };
    },
  })],
  ["boadilla", defineAggregateTheme({
    id: "Boadilla",
    // TeX Live 2025 beamerthemeBoadilla.sty.
    components: [
      { kind: "color-theme", name: "rose" },
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
      { kind: "color-theme", name: "dolphin" },
      { kind: "outer-theme", name: "infolines" },
    ],
    applyOverrides: (state, use) => {
      state.templates.bullets = [
        state.templates.bullets[0],
        DEFAULT_REF("beamer/bullet/tiny-triangle"),
        DEFAULT_REF("beamer/bullet/tiny-star"),
      ];
      if (use.options.secheader !== true) {
        state.templates.headline = DEFAULT_REF("beamer/headline/none");
      }
    },
  })],
  ["cambridgeus", defineAggregateTheme({
    id: "CambridgeUS",
    // TeX Live 2025 beamerthemeCambridgeUS.sty.
    components: [
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
      { kind: "outer-theme", name: "infolines" },
      { kind: "color-theme", name: "beaver" },
    ],
    applyOverrides: (state) => {
      state.fonts["block-title"] = { ...state.fonts["block-body"] };
      state.colors.titlelike = { parent: "structure", bg: WHITE };
    },
  })],
  ["eastlansing", defineAggregateTheme({
    id: "EastLansing",
    // TeX Live 2025 beamerthemeEastLansing.sty.
    components: [
      { kind: "inner-theme", name: "rounded" },
      { kind: "outer-theme", name: "infolines" },
      { kind: "color-theme", name: "spruce" },
    ],
    applyOverrides: (state) => {
      state.fonts["block-title"] = {
        ...state.fonts["block-body"],
        sizePt: 12,
        lineHeightPt: 14,
      };
      state.templates.bullets = [
        state.templates.bullets[0],
        DEFAULT_REF("beamer/bullet/triangle"),
        state.templates.bullets[2],
      ];
      state.colors.titlelike = {
        parent: "structure",
        bg: xcolorMixRgb(WHITE_RGB, MSU_GREEN_RGB, 85),
      };
    },
  })],
  ["madrid", defineAggregateTheme({
    id: "Madrid",
    // TeX Live 2025 beamerthemeMadrid.sty applies these in this exact order.
    components: [
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
      {
        kind: "inner-theme",
        name: "rounded",
        options: { shadow: true },
      },
      { kind: "outer-theme", name: "infolines" },
    ],
    applyOverrides: (state, use) => {
      // Madrid resets the Infolines headline unless its own secheader option
      // is explicitly selected.
      if (use.options.secheader !== true) {
        state.templates.headline = DEFAULT_REF("beamer/headline/none");
      }
    },
  })],
  ["metropolis", (state, use) => { applyModernTheme(state, use, "metropolis"); }],
  ["moloch", (state, use) => { applyModernTheme(state, use, "moloch"); }],
]);

const colorThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("color-theme", "default")],
  ["wolverine", applyWolverineColors],
  ["rose", applyRoseColors],
  ["dolphin", applyDolphinColors],
  ["beaver", applyBeaverColors],
  ["spruce", applySpruceColors],
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
    const shadow = optionBoolean(use.options.shadow, false);
    state.templates.titlePage = DEFAULT_REF(
      shadow
        ? "beamer/title-page/rounded-shadow"
        : "beamer/title-page/rounded"
    );
    state.templates.block = DEFAULT_REF(
      shadow
        ? "beamer/block/rounded-shadow"
        : "beamer/block/rounded"
    );
    state.templates.bullets = [
      DEFAULT_REF("beamer/bullet/ball"),
      DEFAULT_REF("beamer/bullet/ball"),
      DEFAULT_REF("beamer/bullet/ball"),
    ];
    state.templates.enumerations = [
      DEFAULT_REF("beamer/enumeration/ball"),
      DEFAULT_REF("beamer/enumeration/ball"),
      DEFAULT_REF("beamer/enumeration/ball"),
    ];
  }],
  ["metropolis", applyModernInner("metropolis")],
  ["moloch", applyModernInner("moloch")],
]);

const WHITE = "#ffffff";
const BLACK = "#000000";
const DARK_BLUE = "#0000cc";
const DARK_RED = "#cc0000";
const MSU_GREEN = "#006633";
const WHITE_RGB = [1, 1, 1] as const;
const BLACK_RGB = [0, 0, 0] as const;
const YELLOW_RGB = [1, 1, 0] as const;
const ORANGE_RGB = [1, 0.5, 0] as const;
const GRAY_RGB = [0.5, 0.5, 0.5] as const;
const DARK_BLUE_RGB = [0, 0, 0.8] as const;
const DARK_RED_RGB = [0.8, 0, 0] as const;
const MSU_GREEN_RGB = [0, 0.4, 0.2] as const;

function applyWolverineColors(state: MutableTheme, use: BeamerThemeUse): void {
  markApplied(state, "color-theme", "wolverine", use);
  state.colors["alerted text"] = {
    fg: xcolorMixRgb(DARK_BLUE_RGB, YELLOW_RGB, 80),
  };
  state.colors["palette primary"] = {
    fg: xcolorMixRgb(DARK_BLUE_RGB, BLACK_RGB, 60),
    bg: xcolorMixRgb(YELLOW_RGB, ORANGE_RGB, 85),
  };
  state.colors["palette secondary"] = {
    fg: xcolorMixRgb(DARK_BLUE_RGB, BLACK_RGB, 70),
    bg: xcolorMixRgb(YELLOW_RGB, ORANGE_RGB, 60),
  };
  state.colors["palette tertiary"] = {
    fg: xcolorMixRgb(YELLOW_RGB, ORANGE_RGB, 50),
    bg: xcolorMixRgb(DARK_BLUE_RGB, BLACK_RGB, 80),
  };
  state.colors["palette quaternary"] = {
    fg: DARK_BLUE,
    bg: xcolorMixRgb(YELLOW_RGB, ORANGE_RGB, 20),
  };
  state.colors.titlelike = { parent: "palette primary" };
  state.colors.frametitle = {
    parent: "titlelike",
    bg: xcolorMixRgb(YELLOW_RGB, ORANGE_RGB, 90),
  };
  state.colors["frametitle right"] = {
    parent: "frametitle",
    bg: xcolorMixRgb(YELLOW_RGB, ORANGE_RGB, 60),
  };
}

function applyRoseColors(state: MutableTheme, use: BeamerThemeUse): void {
  markApplied(state, "color-theme", "rose", use);
  const normal = resolveMutableThemeColor(state, "normal text");
  const structure = resolveMutableThemeColor(state, "structure");
  const alerted = resolveMutableThemeColor(state, "alerted text");
  const example = resolveMutableThemeColor(state, "example text");
  const canvas = normal.bg ?? WHITE;
  const canvasRgb = rgbChannelsFromHex(canvas);
  const applyBlockFamily = (
    suffix: "" | " alerted" | " example",
    foreground: string,
    foregroundRgb: RgbChannels
  ) => {
    const titleBackgroundRgb = mixRgbChannels(
      foregroundRgb,
      canvasRgb,
      20
    );
    const titleBackground = rgbChannelsToHex(titleBackgroundRgb);
    state.colors[`block title${suffix}`] = {
      fg: foreground,
      bg: titleBackground,
    };
    state.colors[`block body${suffix}`] = {
      parent: "normal text",
      bg: xcolorMixRgb(titleBackgroundRgb, canvasRgb, 50),
    };
  };
  applyBlockFamily(
    "",
    structure.fg ?? "#3333b3",
    mutableThemeForegroundRgb(state, "structure", "#3333b3")
  );
  applyBlockFamily(
    " alerted",
    alerted.fg ?? "#ff0000",
    mutableThemeForegroundRgb(state, "alerted text", "#ff0000")
  );
  applyBlockFamily(
    " example",
    example.fg ?? "#008000",
    mutableThemeForegroundRgb(state, "example text", "#008000")
  );
}

function applyDolphinColors(state: MutableTheme, use: BeamerThemeUse): void {
  markApplied(state, "color-theme", "dolphin", use);
  const structure = resolveMutableThemeColor(state, "structure").fg ??
    "#3333b3";
  const structureRgb = mutableThemeForegroundRgb(
    state,
    "structure",
    structure
  );
  state.colors["palette primary"] = {
    fg: BLACK,
    bg: xcolorMixRgb(structureRgb, WHITE_RGB, 40),
  };
  state.colors["palette secondary"] = {
    fg: WHITE,
    bg: xcolorMixRgb(structureRgb, WHITE_RGB, 60),
  };
  state.colors["palette tertiary"] = {
    fg: WHITE,
    bg: xcolorMixRgb(structureRgb, WHITE_RGB, 90),
  };
  state.colors["palette quaternary"] = { fg: WHITE, bg: BLACK };
  state.colors.titlelike = { fg: structure };
}

function applyBeaverColors(state: MutableTheme, use: BeamerThemeUse): void {
  markApplied(state, "color-theme", "beaver", use);
  state.colors["alerted text"] = {
    fg: xcolorMixRgb(DARK_RED_RGB, GRAY_RGB, 80),
  };
  state.colors["palette primary"] = {
    fg: xcolorMixRgb(DARK_RED_RGB, BLACK_RGB, 60),
    bg: xcolorMixRgb(GRAY_RGB, WHITE_RGB, 30),
  };
  state.colors["palette secondary"] = {
    fg: xcolorMixRgb(DARK_RED_RGB, BLACK_RGB, 70),
    bg: xcolorMixRgb(GRAY_RGB, WHITE_RGB, 15),
  };
  state.colors["palette tertiary"] = {
    fg: xcolorMixRgb(GRAY_RGB, WHITE_RGB, 10),
    bg: xcolorMixRgb(DARK_RED_RGB, BLACK_RGB, 80),
  };
  state.colors["palette quaternary"] = {
    fg: DARK_RED,
    bg: xcolorMixRgb(GRAY_RGB, WHITE_RGB, 5),
  };
  state.colors.titlelike = {
    parent: "palette primary",
    fg: DARK_RED,
  };
  state.colors.frametitle = {
    parent: "titlelike",
    bg: xcolorMixRgb(GRAY_RGB, WHITE_RGB, 10),
  };
  state.colors["frametitle right"] = {
    parent: "frametitle",
    bg: xcolorMixRgb(GRAY_RGB, WHITE_RGB, 60),
  };
}

function applySpruceColors(state: MutableTheme, use: BeamerThemeUse): void {
  markApplied(state, "color-theme", "spruce", use);
  state.colors["alerted text"] = {
    fg: xcolorMixRgb(MSU_GREEN_RGB, WHITE_RGB, 80),
  };
  state.colors["palette primary"] = {
    fg: xcolorMixRgb(MSU_GREEN_RGB, BLACK_RGB, 60),
    bg: xcolorMixRgb(WHITE_RGB, MSU_GREEN_RGB, 85),
  };
  state.colors["palette secondary"] = {
    fg: xcolorMixRgb(MSU_GREEN_RGB, BLACK_RGB, 70),
    bg: xcolorMixRgb(WHITE_RGB, MSU_GREEN_RGB, 60),
  };
  state.colors["palette tertiary"] = {
    fg: xcolorMixRgb(WHITE_RGB, MSU_GREEN_RGB, 50),
    bg: xcolorMixRgb(MSU_GREEN_RGB, BLACK_RGB, 80),
  };
  state.colors["palette quaternary"] = {
    fg: MSU_GREEN,
    bg: xcolorMixRgb(WHITE_RGB, MSU_GREEN_RGB, 20),
  };
  state.colors.titlelike = { parent: "palette primary" };
  state.colors.frametitle = {
    parent: "titlelike",
    bg: xcolorMixRgb(WHITE_RGB, MSU_GREEN_RGB, 90),
  };
  state.colors["frametitle right"] = {
    parent: "frametitle",
    bg: xcolorMixRgb(WHITE_RGB, MSU_GREEN_RGB, 60),
  };
  state.colors["block body"] = {
    parent: "normal text",
    bg: WHITE,
  };
}

const outerThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("outer-theme", "default")],
  ["infolines", (state, use) => {
    markApplied(state, "outer-theme", "infolines", use);
    state.templates.footline = DEFAULT_REF("beamer/footline/infolines");
    state.templates.headline = DEFAULT_REF("beamer/headline/infolines");
    state.colors["author in head/foot"] = { parent: "palette tertiary" };
    state.colors["title in head/foot"] = { parent: "palette secondary" };
    state.colors["date in head/foot"] = { parent: "palette primary" };
    state.colors["section in head/foot"] = { parent: "palette tertiary" };
    state.colors["subsection in head/foot"] = { parent: "palette primary" };
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
    // Both upstream outer themes explicitly clear Beamer's navigation strip.
    state.templates.navigationSymbols = DEFAULT_REF(
      "beamer/navigation-symbols/none"
    );
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
  aggregateUse: BeamerThemeUse,
  options: Readonly<Record<string, string | boolean>> = aggregateUse.options
): void {
  const applier = componentRegistry[kind].get(normalizeName(name));
  if (!applier) {
    state.diagnostics.push({
      severity: "warning",
      code: "beamer-unknown-theme-component",
      message: `The Beamer theme '${aggregateUse.name}' requires the unregistered ${kind} component '${name}'.`,
      span: aggregateUse.source.span,
    });
    return;
  }
  applier(state, {
    ...aggregateUse,
    kind,
    name,
    options,
  });
}

function defineAggregateTheme(
  definition: AggregateThemeDefinition
): ComponentApplier {
  return (state, use) => {
    state.id = definition.id;
    markApplied(state, "theme", definition.id, use);
    for (const component of definition.components) {
      applyNamedComponent(
        state,
        component.kind,
        component.name,
        use,
        typeof component.options === "function"
          ? component.options(use.options)
          : component.options ?? {}
      );
    }
    definition.applyOverrides?.(state, use);
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

function optionBoolean(
  value: string | boolean | undefined,
  fallback: boolean
): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLocaleLowerCase() === "true";
  }
  return fallback;
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
        Object.freeze({
          ...value,
          ...(hasRgbChannels(value)
            ? { fgRgb: Object.freeze([...value.fgRgb]) }
            : {}),
          ...("fgMix" in value && value.fgMix
            ? { fgMix: Object.freeze({ ...value.fgMix }) }
            : {}),
        }),
      ])
    )
  ) as Readonly<T>;
}

function hasRgbChannels(
  value: object
): value is { fgRgb: readonly number[] } {
  return (
    "fgRgb" in value &&
    Array.isArray(value.fgRgb) &&
    value.fgRgb.every((channel: unknown) => typeof channel === "number")
  );
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
    navigationSymbols: freezeRef(templates.navigationSymbols),
    frameTitle: freezeRef(templates.frameTitle),
    titlePage: freezeRef(templates.titlePage),
    sectionPage: freezeRef(templates.sectionPage),
    block: freezeRef(templates.block),
    bullets: Object.freeze(templates.bullets.map(freezeRef)) as unknown as
      BeamerThemeTemplates["bullets"],
    enumerations: Object.freeze(
      templates.enumerations.map(freezeRef)
    ) as unknown as BeamerThemeTemplates["enumerations"],
  });
}
