import type { Diagnostic } from "../../diagnostics/types.js";
import { texLength } from "../../text/tex/coordinates.js";
import type { BeamerDocumentModel, BeamerThemeKind } from "../types.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import type {
  BeamerThemeColor,
  BeamerThemeComponentProvenance,
  BeamerThemeDimensions,
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
  dimensions: BeamerThemeDimensions;
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
    dimensions: Object.freeze({
      ...state.dimensions,
      listLeftMarginEmByDepth: Object.freeze([
        ...state.dimensions.listLeftMarginEmByDepth,
      ]) as unknown as readonly [number, number, number],
      sidebarWidthLeft: Object.freeze({
        ...state.dimensions.sidebarWidthLeft,
      }),
      sidebarWidthRight: Object.freeze({
        ...state.dimensions.sidebarWidthRight,
      }),
    }),
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
    const mixedBackground = color.bgMix
      ? mixThemeForeground(
          foregroundChannels(
            theme,
            color.bgMix.foregroundRole,
            resolve(color.bgMix.foregroundRole, seen).fg
          ),
          parseHexColor(resolve(color.bgMix.backgroundRole, seen).bg),
          color.bgMix.foregroundPercent
        )
      : undefined;
    return {
      ...parent,
      ...(mixedForeground ? { fg: mixedForeground } : {}),
      ...(mixedBackground ? { bg: mixedBackground } : {}),
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
      "bibliography item": { parent: "item" },
      "bibliography entry author": { parent: "structure" },
      "bibliography entry title": { parent: "normal text" },
      "bibliography entry location": { fgMix: { foregroundRole: "structure", backgroundRole: "normal text", foregroundPercent: 65 } },
      "bibliography entry note": { fgMix: { foregroundRole: "structure", backgroundRole: "normal text", foregroundPercent: 65 } },
      "palette primary": { fg: "#3333b3" },
      "palette secondary": { fg: "#262686" },
      "palette tertiary": { fg: "#1a1a59" },
      "palette quaternary": { fg: "#000000" },
      "palette sidebar primary": { parent: "normal text" },
      "palette sidebar secondary": { parent: "structure" },
      "palette sidebar tertiary": { parent: "normal text" },
      "palette sidebar quaternary": { parent: "structure" },
      titlelike: { parent: "structure" },
      title: { parent: "titlelike" },
      subtitle: { parent: "title" },
      author: {},
      institute: {},
      date: {},
      frametitle: { parent: "titlelike" },
      "section in head/foot": { parent: "palette tertiary" },
      "section in head/foot shaded": {
        parent: "section in head/foot",
        fgMix: {
          foregroundRole: "section in head/foot",
          backgroundRole: "section in head/foot",
          foregroundPercent: 50,
        },
      },
      "subsection in head/foot": { parent: "palette secondary" },
      "subsection in head/foot shaded": {
        parent: "subsection in head/foot",
        fgMix: {
          foregroundRole: "subsection in head/foot",
          backgroundRole: "subsection in head/foot",
          foregroundPercent: 50,
        },
      },
      "title in head/foot": { parent: "palette quaternary" },
      "author in head/foot": { parent: "palette primary" },
      "institute in head/foot": { parent: "palette tertiary" },
      "date in head/foot": { parent: "palette secondary" },
      "page number in head/foot": {},
      sidebar: {},
      "sidebar left": { parent: "sidebar" },
      "sidebar right": { parent: "sidebar" },
      "title in sidebar": { parent: "palette sidebar quaternary" },
      "author in sidebar": { parent: "palette sidebar tertiary" },
      "section in sidebar": { parent: "palette sidebar secondary" },
      "section in sidebar shaded": {
        parent: "section in sidebar",
        fgMix: {
          foregroundRole: "section in sidebar",
          backgroundRole: "sidebar",
          foregroundPercent: 40,
        },
      },
      "subsection in sidebar": { parent: "palette sidebar primary" },
      "subsection in sidebar shaded": {
        parent: "subsection in sidebar",
        fgMix: {
          foregroundRole: "subsection in sidebar",
          backgroundRole: "sidebar",
          foregroundPercent: 40,
        },
      },
      logo: { parent: "palette secondary" },
      "mini frame": { parent: "section in head/foot" },
      "mini frame shaded": {
        parent: "mini frame",
        fgMix: {
          foregroundRole: "mini frame",
          backgroundRole: "mini frame",
          foregroundPercent: 50,
        },
      },
      "separation line": {},
      "upper separation line head": { parent: "separation line" },
      "middle separation line head": { parent: "separation line" },
      "lower separation line head": { parent: "separation line" },
      "upper separation line foot": { parent: "separation line" },
      "middle separation line foot": { parent: "separation line" },
      "lower separation line foot": { parent: "separation line" },
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
      "title-in-sidebar": {
        ...normalFont,
        sizePt: 6,
        lineHeightPt: 7,
      },
      "author-in-sidebar": {
        ...normalFont,
        sizePt: 6,
        lineHeightPt: 7,
      },
      "section-in-sidebar": {
        ...normalFont,
        sizePt: 6,
        lineHeightPt: 7,
      },
      "subsection-in-sidebar": {
        ...normalFont,
        sizePt: 4,
        lineHeightPt: 5,
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
      listLeftMarginEmByDepth: [2, 2, 2],
      sidebarWidthLeft: { kind: "absolute", valuePt: 0 },
      sidebarWidthRight: { kind: "absolute", valuePt: 0 },
    },
    templates: {
      sidebar: DEFAULT_REF("beamer/sidebar/none"),
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
  ["bergen", defineAggregateTheme({
    id: "Bergen",
    // TeX Live 2025 beamerthemeBergen.sty.
    components: [
      { kind: "color-theme", name: "orchid" },
      { kind: "inner-theme", name: "rectangles" },
      { kind: "inner-theme", name: "inmargin" },
    ],
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
  ["berkeley", defineAggregateTheme({
    id: "Berkeley",
    // TeX Live 2025 beamerthemeBerkeley.sty.
    components: [
      {
        kind: "outer-theme",
        name: "sidebar",
        options: (options) => sidebarAggregateOptions(options),
      },
      { kind: "inner-theme", name: "rectangles" },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
    ],
    applyOverrides: (state) => {
      state.colors.frametitle = { parent: "palette primary" };
      resetBlockTitleSize(state);
    },
  })],
  ["goettingen", defineAggregateTheme({
    id: "Goettingen",
    // TeX Live 2025 beamerthemeGoettingen.sty.
    components: [{
      kind: "outer-theme",
      name: "sidebar",
      options: (options) => sidebarAggregateOptions(options, {
        side: "right",
        width: "2cm",
        height: "0pt",
      }),
    }],
    applyOverrides: (state) => {
      state.colors["sidebar canvas top"] = {
        bgMix: {
          foregroundRole: "structure",
          backgroundRole: "normal text",
          foregroundPercent: 25,
        },
      };
      state.colors["sidebar canvas bottom"] = {
        bgMix: {
          foregroundRole: "structure",
          backgroundRole: "normal text",
          foregroundPercent: 10,
        },
      };
      setSidebarCanvas(state, {
        style: "vertical-gradient",
        topRole: "sidebar canvas top",
        bottomRole: "sidebar canvas bottom",
      });
    },
  })],
  ["hannover", defineAggregateTheme({
    id: "Hannover",
    // TeX Live 2025 beamerthemeHannover.sty.
    components: [
      {
        kind: "outer-theme",
        name: "sidebar",
        options: (options) => sidebarAggregateOptions(options, {
          side: "left",
          height: "0pt",
        }),
      },
      { kind: "color-theme", name: "seahorse" },
      { kind: "inner-theme", name: "circles" },
    ],
    applyOverrides: (state) => {
      state.colors.titlelike = { parent: "structure" };
      state.templates.frameTitle = templateRef(
        "beamer/frame-title/default",
        { alignment: "right" }
      );
    },
  })],
  ["marburg", defineAggregateTheme({
    id: "Marburg",
    // TeX Live 2025 beamerthemeMarburg.sty.
    components: [
      { kind: "color-theme", name: "whale" },
      {
        kind: "outer-theme",
        name: "sidebar",
        options: (options) => sidebarAggregateOptions(options, {
          side: "right",
          width: "2cm",
          height: "0pt",
        }),
      },
    ],
    applyOverrides: (state) => {
      state.colors.titlelike = { parent: "structure" };
      state.colors.sidebar = { parent: "palette primary" };
      setSidebarCanvas(state, {
        style: "vertical-gradient",
        topRole: "palette quaternary",
        bottomRole: "palette primary",
      });
    },
  })],
  ["paloalto", defineAggregateTheme({
    id: "PaloAlto",
    // TeX Live 2025 beamerthemePaloAlto.sty.
    components: [
      {
        kind: "outer-theme",
        name: "sidebar",
        options: (options) => sidebarAggregateOptions(options),
      },
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
      { kind: "color-theme", name: "orchid" },
      { kind: "color-theme", name: "whale" },
    ],
    applyOverrides: (state) => {
      state.colors.frametitle = { parent: "palette primary" };
      resetBlockTitleSize(state);
    },
  })],
  ["pittsburgh", defineAggregateTheme({
    id: "Pittsburgh",
    // TeX Live 2025 beamerthemePittsburgh.sty.
    components: [{ kind: "inner-theme", name: "circles" }],
    applyOverrides: (state) => {
      state.templates.frameTitle = templateRef(
        "beamer/frame-title/default",
        { alignment: "right" }
      );
    },
  })],
  ["rochester", defineAggregateTheme({
    id: "Rochester",
    // TeX Live 2025 beamerthemeRochester.sty.
    components: [
      {
        kind: "outer-theme",
        name: "sidebar",
        options: (options) => sidebarAggregateOptions(options, {
          width: "0pt",
        }),
      },
      { kind: "inner-theme", name: "rectangles" },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
    ],
    applyOverrides: (state) => {
      state.colors.frametitle = { parent: "palette primary" };
      resetBlockTitleSize(state);
    },
  })],
  ["antibes", defineAggregateTheme({
    id: "Antibes",
    // TeX Live 2025 beamerthemeAntibes.sty.
    components: [
      { kind: "outer-theme", name: "tree" },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
      { kind: "inner-theme", name: "rectangles" },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["berlin", defineAggregateTheme({
    id: "Berlin",
    // TeX Live 2025 beamerthemeBerlin.sty.
    components: [
      {
        kind: "outer-theme",
        name: "miniframes",
        options: (options) => ({
          footline: "authorinstitutetitle",
          compress: optionBoolean(options.compress, false),
        }),
      },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
      { kind: "inner-theme", name: "rectangles" },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["copenhagen", defineAggregateTheme({
    id: "Copenhagen",
    // TeX Live 2025 beamerthemeCopenhagen.sty.
    components: [
      { kind: "outer-theme", name: "split" },
      { kind: "inner-theme", name: "rounded" },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["dresden", defineAggregateTheme({
    id: "Dresden",
    // TeX Live 2025 beamerthemeDresden.sty.
    components: [
      {
        kind: "outer-theme",
        name: "miniframes",
        options: (options) => ({
          footline: "authorinstitutetitle",
          compress: optionBoolean(options.compress, false),
        }),
      },
      { kind: "color-theme", name: "whale" },
    ],
    applyOverrides: (state) => {
      state.colors.titlelike = { parent: "structure" };
    },
  })],
  ["ilmenau", defineAggregateTheme({
    id: "Ilmenau",
    // TeX Live 2025 beamerthemeIlmenau.sty.
    components: [
      {
        kind: "outer-theme",
        name: "miniframes",
        options: (options) => ({
          footline: "authorinstitutetitle",
          compress: optionBoolean(options.compress, false),
        }),
      },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
      { kind: "inner-theme", name: "rounded" },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["luebeck", defineAggregateTheme({
    id: "Luebeck",
    // TeX Live 2025 beamerthemeLuebeck.sty.
    components: [
      { kind: "outer-theme", name: "split" },
      { kind: "inner-theme", name: "rectangles" },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["malmoe", defineAggregateTheme({
    id: "Malmoe",
    // TeX Live 2025 beamerthemeMalmoe.sty.
    components: [
      { kind: "outer-theme", name: "split" },
      { kind: "color-theme", name: "whale" },
    ],
    applyOverrides: (state) => {
      state.colors.titlelike = { parent: "structure" };
    },
  })],
  ["montpellier", defineAggregateTheme({
    id: "Montpellier",
    // TeX Live 2025 beamerthemeMontpellier.sty.
    components: [{ kind: "outer-theme", name: "tree" }],
    applyOverrides: applyStructureSeparationLine,
  })],
  ["singapore", defineAggregateTheme({
    id: "Singapore",
    // TeX Live 2025 beamerthemeSingapore.sty.
    components: [{
      kind: "outer-theme",
      name: "miniframes",
      options: (options) => ({
        subsection: false,
        compress: optionBoolean(options.compress, false),
        fade: true,
      }),
    }],
    applyOverrides: (state) => {
      // The source paints a fading above the strip, then clears the color-box
      // background. The structural planner therefore sees a transparent band.
      state.colors["section in head/foot"] = {
        parent: "palette tertiary",
      };
      state.colors["section in head/foot fade"] = {
        fgMix: {
          foregroundRole: "structure",
          backgroundRole: "normal text",
          foregroundPercent: 25,
        },
      };
      state.templates.frameTitle = templateRef(
        "beamer/frame-title/default",
        { alignment: "center" }
      );
      state.templates.bullets = [
        DEFAULT_REF("beamer/bullet/circle"),
        DEFAULT_REF("beamer/bullet/circle"),
        DEFAULT_REF("beamer/bullet/circle"),
      ];
    },
  })],
  ["szeged", defineAggregateTheme({
    id: "Szeged",
    // TeX Live 2025 beamerthemeSzeged.sty.
    components: [{
      kind: "outer-theme",
      name: "miniframes",
      options: (options) => ({
        footline: "institutetitle",
        compress: optionBoolean(options.compress, false),
      }),
    }],
    applyOverrides: applyStructureSeparationLine,
  })],
  ["darmstadt", defineAggregateTheme({
    id: "Darmstadt",
    // TeX Live 2025 beamerthemeDarmstadt.sty.
    components: [
      { kind: "outer-theme", name: "smoothbars" },
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
      { kind: "color-theme", name: "orchid" },
      { kind: "color-theme", name: "whale" },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["frankfurt", defineAggregateTheme({
    id: "Frankfurt",
    // TeX Live 2025 beamerthemeFrankfurt.sty.
    components: [
      {
        kind: "outer-theme",
        name: "smoothbars",
        options: { subsection: false },
      },
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
      { kind: "color-theme", name: "orchid" },
      { kind: "color-theme", name: "whale" },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["juanlespins", defineAggregateTheme({
    id: "JuanLesPins",
    // TeX Live 2025 beamerthemeJuanLesPins.sty.
    components: [
      { kind: "outer-theme", name: "smoothtree" },
      { kind: "color-theme", name: "whale" },
      { kind: "color-theme", name: "orchid" },
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
    ],
    applyOverrides: resetBlockTitleSize,
  })],
  ["warsaw", defineAggregateTheme({
    id: "Warsaw",
    // TeX Live 2025 beamerthemeWarsaw.sty.
    components: [
      { kind: "inner-theme", name: "rounded", options: { shadow: true } },
      { kind: "outer-theme", name: "shadow" },
      { kind: "color-theme", name: "orchid" },
      { kind: "color-theme", name: "whale" },
    ],
    applyOverrides: resetBlockTitleSize,
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
    state.colors.sidebar = { bg: "#3333b3" };
    state.colors["palette sidebar primary"] = {
      fg: xcolorMixRgb(
        mutableThemeForegroundRgb(state, "structure", "#3333b3"),
        WHITE_RGB,
        10
      ),
    };
    state.colors["palette sidebar secondary"] = { fg: WHITE };
    state.colors["palette sidebar tertiary"] = {
      fg: xcolorMixRgb(
        mutableThemeForegroundRgb(state, "structure", "#3333b3"),
        WHITE_RGB,
        50
      ),
    };
    state.colors["palette sidebar quaternary"] = { fg: WHITE };
    state.colors.titlelike = { parent: "palette primary" };
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
    state.colors.sidebar = { bg: "#d6d6f0" };
    state.colors.titlelike = { parent: "palette primary" };
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
  ["rectangles", (state, use) => {
    markApplied(state, "inner-theme", "rectangles", use);
    state.templates.bullets = [
      DEFAULT_REF("beamer/bullet/square"),
      DEFAULT_REF("beamer/bullet/square"),
      DEFAULT_REF("beamer/bullet/square"),
    ];
    state.templates.enumerations = [
      DEFAULT_REF("beamer/enumeration/square"),
      DEFAULT_REF("beamer/enumeration/square"),
      DEFAULT_REF("beamer/enumeration/square"),
    ];
  }],
  ["circles", (state, use) => {
    markApplied(state, "inner-theme", "circles", use);
    state.templates.bullets = [
      DEFAULT_REF("beamer/bullet/circle"),
      DEFAULT_REF("beamer/bullet/circle"),
      DEFAULT_REF("beamer/bullet/circle"),
    ];
    state.templates.enumerations = [
      DEFAULT_REF("beamer/enumeration/circle"),
      DEFAULT_REF("beamer/enumeration/circle"),
      DEFAULT_REF("beamer/enumeration/circle"),
    ];
  }],
  ["inmargin", (state, use) => {
    markApplied(state, "inner-theme", "inmargin", use);
    const normalFont = state.fonts["normal-text"];
    const xHeightEm = themeFontXHeightPt(normalFont) / normalFont.sizePt;
    state.colors.sidebar = { parent: "block title" };
    state.colors["sidebar left"] = { parent: "sidebar" };
    state.colors["local structure"] = { parent: "sidebar" };
    state.colors["section in toc"] = { parent: "sidebar" };
    state.colors.title = { parent: "structure" };
    state.dimensions.textMarginLeftPt =
      1.5 * themeFontXHeightPt(normalFont);
    state.dimensions.textMarginRightPt =
      1.5 * themeFontXHeightPt(normalFont);
    state.dimensions.sidebarWidthLeft = {
      kind: "page-width",
      ratio: 0.25,
    };
    state.dimensions.listLeftMarginEmByDepth = [
      0,
      1.5 * xHeightEm,
      1.5 * xHeightEm,
    ];
    state.templates.sidebar = templateRef("beamer/sidebar/canvas", {
      side: "left",
    });
    state.templates.titlePage = DEFAULT_REF("beamer/title-page/inmargin");
    state.templates.block = DEFAULT_REF("beamer/block/inmargin");
  }],
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

function resetBlockTitleSize(state: MutableTheme): void {
  state.fonts["block-title"] = { ...state.fonts["block-body"] };
}

function applyStructureSeparationLine(state: MutableTheme): void {
  state.colors["separation line"] = {
    bgMix: {
      foregroundRole: "structure",
      backgroundRole: "normal text",
      foregroundPercent: 50,
    },
  };
}

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

function applySplitOuterTheme(
  state: MutableTheme,
  use: BeamerThemeUse
): void {
  markApplied(state, "outer-theme", "split", use);
  state.templates.headline = templateRef("beamer/headline/split", {
    compress: optionBoolean(use.options.compress, false),
  });
  state.templates.footline = DEFAULT_REF("beamer/footline/split");
  state.colors["section in head/foot"] = {
    parent: "palette quaternary",
  };
  state.colors["subsection in head/foot"] = {
    parent: "palette primary",
  };
  state.colors["author in head/foot"] = {
    parent: "section in head/foot",
  };
  state.colors["title in head/foot"] = {
    parent: "subsection in head/foot",
  };
}

function applySidebarOuterTheme(
  state: MutableTheme,
  use: BeamerThemeUse
): void {
  markApplied(state, "outer-theme", "sidebar", use);
  const side = optionString(use.options.side, "left") === "right"
    ? "right"
    : "left";
  const widthPt = optionLengthPt(
    use.options.width,
    45,
    state.fonts["frame-title"].sizePt
  );
  const headHeightPt = optionLengthPt(
    use.options.height,
    45,
    state.fonts["frame-title"].sizePt
  );
  state.dimensions.sidebarWidthLeft = {
    kind: "absolute",
    valuePt: side === "left" ? widthPt : 0,
  };
  state.dimensions.sidebarWidthRight = {
    kind: "absolute",
    valuePt: side === "right" ? widthPt : 0,
  };
  if (widthPt > 0) {
    state.dimensions.textMarginLeftPt = cmToTexPt(0.5);
    state.dimensions.textMarginRightPt = cmToTexPt(0.5);
  }
  state.templates.sidebar = templateRef("beamer/sidebar/navigation", {
    side,
    widthPt,
    headHeightPt,
    hideOtherSubsections: optionBoolean(
      use.options.hideothersubsections,
      false
    ),
    hideAllSubsections: optionBoolean(use.options.hideallsubsections, false),
    canvas: "solid",
  });
  if (headHeightPt > 0) {
    state.colors.frametitle = { parent: "sidebar" };
    state.templates.headline = templateRef("beamer/headline/sidebar", {
      side,
      widthPt,
      headHeightPt,
    });
    state.templates.frameTitle = templateRef("beamer/frame-title/sidebar", {
      headHeightPt,
    });
  }
}

const outerThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("outer-theme", "default")],
  ["tree", (state, use) => {
    markApplied(state, "outer-theme", "tree", use);
    state.templates.headline = templateRef("beamer/headline/tree", {
      hooks: optionBoolean(use.options.hooks, true),
    });
  }],
  ["split", applySplitOuterTheme],
  ["miniframes", (state, use) => {
    markApplied(state, "outer-theme", "miniframes", use);
    state.templates.headline = templateRef("beamer/headline/miniframes", {
      subsection: optionBoolean(use.options.subsection, true),
      compress: optionBoolean(use.options.compress, false),
      fade: optionBoolean(use.options.fade, false),
    });
    state.templates.footline = templateRef("beamer/footline/miniframes", {
      style: optionString(use.options.footline, "empty"),
    });
    state.colors["section in head/foot"] = {
      parent: "palette tertiary",
    };
    state.colors["subsection in head/foot"] = {
      parent: "palette secondary",
    };
    state.colors["author in head/foot"] = {
      parent: "subsection in head/foot",
    };
    state.colors["title in head/foot"] = {
      parent: "section in head/foot",
    };
  }],
  ["smoothbars", (state, use) => {
    markApplied(state, "outer-theme", "smoothbars", use);
    const subsection = optionBoolean(use.options.subsection, true);
    state.templates.headline = templateRef(
      "beamer/headline/smoothbars",
      { subsection }
    );
    state.templates.frameTitle = templateRef(
      "beamer/frame-title/smoothbars",
      { subsection }
    );
    state.colors.frametitle = { parent: "palette primary" };
    state.colors["subsection in head/foot"] = {
      parent: "palette secondary",
    };
    state.colors["section in head/foot"] = {
      parent: "palette quaternary",
    };
  }],
  ["smoothtree", (state, use) => {
    markApplied(state, "outer-theme", "smoothtree", use);
    state.templates.headline = DEFAULT_REF("beamer/headline/smoothtree");
    state.templates.frameTitle = DEFAULT_REF(
      "beamer/frame-title/smoothtree"
    );
    state.colors.frametitle = { parent: "palette primary" };
  }],
  ["shadow", (state, use) => {
    // beamerouterthemeshadow.sty begins with \useoutertheme{split}; retain
    // that nested component in provenance as well as reusing its data patch.
    applySplitOuterTheme(state, use);
    markApplied(state, "outer-theme", "shadow", use);
    state.templates.headline = templateRef(
      "beamer/headline/shadow",
      { compress: optionBoolean(use.options.compress, false) }
    );
    state.templates.frameTitle = DEFAULT_REF("beamer/frame-title/shadow");
    state.colors.frametitle = { parent: "subsection in head/foot" };
    state.colors["frametitle right"] = {
      parent: "section in head/foot",
    };
  }],
  ["sidebar", applySidebarOuterTheme],
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
  options: Record<string, string | boolean | number>
): BeamerThemeTemplateRef {
  return { id, options };
}

function sidebarAggregateOptions(
  options: Readonly<Record<string, string | boolean>>,
  defaults: {
    side?: "left" | "right";
    width?: string;
    height?: string;
  } = {}
): Readonly<Record<string, string | boolean>> {
  const side = options.right === true
    ? "right"
    : options.left === true
      ? "left"
      : defaults.side ?? "left";
  return {
    side,
    ...(typeof options.width === "string"
      ? { width: options.width }
      : defaults.width
        ? { width: defaults.width }
        : {}),
    ...(typeof options.height === "string"
      ? { height: options.height }
      : defaults.height
        ? { height: defaults.height }
        : {}),
    ...(options.hideothersubsections == null
      ? {}
      : { hideothersubsections: options.hideothersubsections }),
    ...(options.hideallsubsections == null
      ? {}
      : { hideallsubsections: options.hideallsubsections }),
  };
}

function setSidebarCanvas(
  state: MutableTheme,
  canvas: {
    style: "vertical-gradient";
    topRole: string;
    bottomRole: string;
  }
): void {
  state.templates.sidebar = templateRef(state.templates.sidebar.id, {
    ...state.templates.sidebar.options,
    canvas: canvas.style,
    topRole: canvas.topRole,
    bottomRole: canvas.bottomRole,
  });
}

function optionString(
  value: string | boolean | number | undefined,
  fallback: string
): string {
  return typeof value === "string" ? value : fallback;
}

function optionBoolean(
  value: string | boolean | number | undefined,
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

function optionLengthPt(
  value: string | boolean | number | undefined,
  fallbackPt: number,
  emPt: number
): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return fallbackPt;
  }
  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(pt|cm|mm|em|ex)$/iu.exec(
    value.trim()
  );
  if (!match) {
    return fallbackPt;
  }
  const amount = Number(match[1]);
  switch (match[2].toLocaleLowerCase()) {
    case "cm":
      return cmToTexPt(amount);
    case "mm":
      return cmToTexPt(amount / 10);
    case "em":
      return amount * emPt;
    case "ex":
      return amount * emPt * 0.444;
    default:
      return amount;
  }
}

function themeFontXHeightPt(font: BeamerThemeFont): number {
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(
    profile.defaultFontState,
    texLength(font.sizePt),
    profile.metricProvider
  );
  return resolved.data.fontdimen.xheight * Number(resolved.atPt);
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
          ...("bgMix" in value && value.bgMix
            ? { bgMix: Object.freeze({ ...value.bgMix }) }
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
    sidebar: freezeRef(templates.sidebar),
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
