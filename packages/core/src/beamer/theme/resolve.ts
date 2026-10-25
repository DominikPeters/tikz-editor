import { requireArrayValue } from "../../utils/collections.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { texLength } from "../../text/tex/coordinates.js";
import type { BeamerDocumentModel, BeamerThemeKind } from "../types.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import { beamerClassFontSize, beamerNamedFontSize } from "./font-sizes.js";
import { scanBeamerFontDeclarations, applyBeamerFontDeclaration } from "./font-declarations.js";
import { scanBeamerNavigationTemplates } from "./template-declarations.js";
import { applyBeamerColorDeclaration, beamerColorRgbToCss, diagnoseBeamerColorDeclarations, resolveBeamerColorExpressionRgb, scanBeamerColorDeclarations, type BeamerColorRgb } from "./color-declarations.js";
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
  colorAliases: Record<string, string>;
  colorAliasRgb: Record<string, BeamerColorRgb>;
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
  const state = createDefaultTheme(beamerClassFontSize(document));
  const uses = document.preamble.themes
    .flatMap((source) =>
      source.name.value.split(",").map((name): BeamerThemeUse => ({
        kind: source.kind,
        name: name.trim(),
        options: parseThemeOptions(source.options?.value),
        source,
      }))
    )
    .filter((use) => use.name.length > 0 && !document.preamble.macroDefinitions.some(definition => definition.span.from <= use.source.span.from && definition.span.to >= use.source.span.to));

  const colorEvents = scanBeamerColorDeclarations(document);
  const events = [...uses.map(use => ({ kind: "theme-use" as const, span: use.source.span, use })), ...colorEvents, ...scanBeamerNavigationTemplates(document), ...scanBeamerFontDeclarations(document)]
    .sort((left, right) => left.span.from - right.span.from);
  for (const event of events) {
    if (event.kind === "font-declaration") {
      state.fonts[event.role] = applyBeamerFontDeclaration(state.fonts[event.role], event, String(state.options["class-font-size"]));
      continue;
    }
    if (event.kind === "navigation-template") {
      if (event.templateId) state.templates.navigationSymbols = DEFAULT_REF(event.templateId);
      if (event.diagnostic) state.diagnostics.push(event.diagnostic);
      continue;
    }
    if (event.kind !== "theme-use") {
      applyBeamerColorDeclaration(state, event, document.source, role => resolveMutableThemeColor(state, role), (role, field) => {
        let channels: BeamerColorRgb | null = null;
        resolveBeamerColorRecord(state.colors, state.colorAliases, state.colorAliasRgb, role, (name, rgb) => { if (name === field) channels = rgb; });
        return channels;
      });
      continue;
    }
    const use = event.use;
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
  const sansOverride = document.preamble.macroDefinitions.filter(definition => definition.nameRaw === "\\sfdefault" &&
    definition.span.from > Math.max(-1, ...uses.filter(use => use.kind === "theme" || use.kind === "font-theme").map(use => use.source.span.from))).at(-1);
  if (sansOverride && (sansOverride.kind === "MacroCommandDefinition" ? sansOverride.bodyRaw : sansOverride.kind === "MacroDefinition" ? sansOverride.valueRaw : "").replace(/[{}\s]/gu, "") === "lmss") {
    for (const font of Object.values(state.fonts)) delete font.typeface;
  }
  const lineSpread = Number(state.options["line-spread"] ?? 1);
  for (const role of ["normal-text", "block-body", "frame-title"] as const) {
    state.fonts[role] = { ...state.fonts[role], lineHeightPt: state.fonts[role].lineHeightPt * lineSpread };
  }
  diagnoseBeamerColorDeclarations(state, colorEvents, role => resolveMutableThemeColor(state, role));

  return {
    id: state.id,
    colors: freezeColors(state.colors),
    colorAliases: Object.freeze({ ...state.colorAliases }),
    colorAliasRgb: Object.freeze(Object.fromEntries(Object.entries(state.colorAliasRgb).map(([name, channels]) => [name, freezeColorChannels(channels)]))),
    fonts: freezeFonts(state.fonts),
    dimensions: Object.freeze({
      ...state.dimensions,
      listLeftMarginEmByDepth: Object.freeze([
        state.dimensions.listLeftMarginEmByDepth[0], state.dimensions.listLeftMarginEmByDepth[1], state.dimensions.listLeftMarginEmByDepth[2],
      ] as const),
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
  return resolveBeamerColorRecord(theme.colors, theme.colorAliases ?? {}, theme.colorAliasRgb ?? {}, role);
}

function resolveBeamerColorRecord(colors: Readonly<Record<string, BeamerThemeColor>>, aliases: Readonly<Record<string, string>>, aliasRgb: Readonly<Record<string, BeamerColorRgb>>, role: string, captureRgb?: (field: "fg" | "bg", channels: BeamerColorRgb | null) => void): ResolvedBeamerThemeColor {
  const roleNameForAlias = (name: string) => Object.keys(colors).find(key => key.toLowerCase() === name.toLowerCase());
  const expressionRgb = (raw: string, seen: ReadonlySet<string>): BeamerColorRgb | null => resolveBeamerColorExpressionRgb(raw, alias => {
    const match = /^(.*)\.(fg|bg)$/u.exec(alias);
    const roleName = match && roleNameForAlias(requireArrayValue(match, 1));
    const field = match?.[2];
    if (roleName && (field === "fg" || field === "bg")) return roleRgb(roleName, field, seen);
    return aliasRgb[alias] ?? (aliases[alias] ? resolveBeamerColorExpressionRgb(aliases[alias], () => null) : null);
  });
  const roleRgb = (name: string, field: "fg" | "bg", ancestors: ReadonlySet<string>): BeamerColorRgb | null => {
    if (ancestors.has(name)) return null;
    const resolved = resolve(name, ancestors)[field];
    if (resolved === undefined) return null;
    const seen = new Set(ancestors); seen.add(name);
    const color = colors[name];
    const expression = field === "fg" ? color?.fgExpression : color?.bgExpression;
    if (expression) return expressionRgb(expression.value, seen);
    if (field === "fg" && color?.fgRgb) return color.fgRgb;
    if (color?.[field] !== undefined || (field === "fg" ? color?.fgMix : color?.bgMix)) return resolveBeamerColorExpressionRgb(resolved, () => null);
    for (const parent of [...(color?.parents ?? (color?.parent ? [color.parent] : []))].reverse()) {
      if (resolve(parent, seen)[field] !== undefined) return roleRgb(parent, field, seen);
    }
    return resolveBeamerColorExpressionRgb(resolved, () => null);
  };
  const resolve = (
    name: string,
    ancestors: ReadonlySet<string>
  ): ResolvedBeamerThemeColor => {
    if (ancestors.has(name)) {
      return {};
    }
    const seen = new Set(ancestors);
    seen.add(name);
    const color = colors[name];
    if (!color) {
      return {};
    }
    const parent = (color.parents ?? (color.parent ? [color.parent] : []))
      .reduce<ResolvedBeamerThemeColor>((inherited, parentRole) => ({ ...inherited, ...resolve(parentRole, seen) }), {});
    const mixedForeground = color.fgMix
      ? mixThemeForeground(
          foregroundChannels(
            { colors },
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
            { colors },
            color.bgMix.foregroundRole,
            resolve(color.bgMix.foregroundRole, seen).fg
          ),
          parseHexColor(resolve(color.bgMix.backgroundRole, seen).bg),
          color.bgMix.foregroundPercent
        )
      : undefined;
    const resolveExpression = (raw: string) => {
      const channels = raw === "" ? null : expressionRgb(raw, seen);
      return channels ? beamerColorRgbToCss(channels) : undefined;
    };
    const result: ResolvedBeamerThemeColor = {
      ...parent,
      ...(mixedForeground ? { fg: mixedForeground } : {}),
      ...(mixedBackground ? { bg: mixedBackground } : {}),
      ...(color.fg ? { fg: color.fg } : {}),
      ...(color.bg ? { bg: color.bg } : {}),
    };
    if (color.fgExpression) {
      const foreground = resolveExpression(color.fgExpression.value);
      if (foreground === undefined) delete result.fg;
      else result.fg = foreground;
    }
    if (color.bgExpression) {
      const background = resolveExpression(color.bgExpression.value);
      if (background === undefined) delete result.bg;
      else result.bg = background;
    }
    return result;
  };
  const result = resolve(role, new Set());
  if (captureRgb) { captureRgb("fg", roleRgb(role, "fg", new Set())); captureRgb("bg", roleRgb(role, "bg", new Set())); }
  return { ...(result.fg === undefined ? {} : { fg: result.fg }), ...(result.bg === undefined ? {} : { bg: result.bg }) };
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
    Math.round(value * ratio + requireArrayValue(background, index) * (1 - ratio))
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function foregroundChannels(
  theme: Pick<ResolvedBeamerTheme, "colors">,
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
        Number.parseInt(requireArrayValue(match, 1), 16),
        Number.parseInt(requireArrayValue(match, 2), 16),
        Number.parseInt(requireArrayValue(match, 3), 16),
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
  return resolveBeamerColorRecord(state.colors, state.colorAliases, state.colorAliasRgb, role);
}

function createDefaultTheme(classSize = "11"): MutableTheme {
  const normalFont: BeamerThemeFont = {
    family: "sans",
    series: "medium",
    shape: "upright",
    ...beamerNamedFontSize(classSize, "normalsize"),
  };
  return {
    id: "default",
    colorAliases: { fg: "#000000", bg: "#ffffff" },
    colorAliasRgb: { fg: [0, 0, 0], bg: [1, 1, 1] },
    colors: {
      "normal text": { fg: "#000000", bg: "#ffffff" },
      "background canvas": { parent: "normal text" },
      background: { parent: "background canvas" },
      // beamercolorthemedefault.sty's blended blue is rgb(.2,.2,.7).
      // Retain those unquantized channels for xcolor percentage mixes.
      structure: { fg: "#3333b3", fgRgb: [0.2, 0.2, 0.7] },
      "local structure": { parent: "structure" },
      item: { parent: "local structure" },
      subitem: { parent: "item" },
      subsubitem: { parent: "subitem" },
      "item projected": { parent: "item", fg: "#ffffff", bgExpression: { value: "item.fg", span: { from: 0, to: 0 } } },
      "subitem projected": { parent: "item projected" },
      "section in toc": { parent: "structure" },
      "subsection in toc": { parent: "normal text" },
      "section number projected": { parent: "item projected" },
      "section number projected text": { fgExpression: { value: "section number projected.fg!90!section number projected.bg", span: { from: 0, to: 0 } } },
      "subsection number projected": { parent: "subitem projected" },
      "subsubitem projected": { parent: "subitem projected" },
      "enumerate item": { parent: "item" },
      "enumerate subitem": { parent: "subitem" },
      "enumerate subsubitem": { parent: "subsubitem" },
      "itemize item": { parent: "item" },
      "itemize subitem": { parent: "subitem" },
      "itemize subsubitem": { parent: "subsubitem" },
      "description item": { parent: "item" },
      "bibliography item": { parent: "item" },
      caption: {},
      "caption name": { parent: "structure" },
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
      framesubtitle: { parent: "frametitle" },
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
        ...beamerNamedFontSize(classSize, "Large"),
      },
      subtitle: normalFont,
      author: normalFont,
      institute: {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "scriptsize"),
      },
      date: normalFont,
      "frame-title": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "Large"),
      },
      "frame-subtitle": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "footnotesize"),
      },
      headline: {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "tiny"),
      },
      "section-in-head-foot": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "tiny"),
      },
      "subsection-in-head-foot": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "tiny"),
      },
      "title-in-sidebar": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "tiny"),
      },
      "author-in-sidebar": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "tiny"),
      },
      "section-in-sidebar": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "tiny"),
      },
      "subsection-in-sidebar": {
        ...normalFont,
        sizePt: 4,
        lineHeightPt: 5,
      },
      "page-number": { ...normalFont, ...beamerNamedFontSize(classSize, "tiny") },
      footline: {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "tiny"),
      },
      // beamerfontthemedefault.sty: block title inherits block body and
      // selects \large. In the 11pt class profile that is 12pt/14pt.
      "block-title": {
        ...normalFont,
        ...beamerNamedFontSize(classSize, "large"),
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
    options: { "class-font-size": classSize },
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
  ["dove", (state, use) => {
    markApplied(state, "color-theme", "dove", use);
    state.colors["normal text"] = { fg: BLACK, bg: WHITE };
    for (const role of ["alerted text", "example text", "structure"]) state.colors[role] = { fg: BLACK };
    for (const role of ["primary", "secondary", "tertiary", "quaternary"]) {
      state.colors[`palette ${role}`] = { ...state.colors[`palette ${role}`], fg: BLACK, bg: WHITE };
      state.colors[`palette sidebar ${role}`] = { fg: BLACK };
    }
    state.colors.sidebar = { bg: "#cccccc" };
    state.colors["item projected"] = { fg: BLACK, bg: "#cccccc" };
    for (const [suffix, parent] of [["", "structure"], [" alerted", "alerted text"], [" example", "example text"]] as const) {
      state.colors[`block body${suffix}`] = {};
      state.colors[`block title${suffix}`] = { parent };
    }
    state.colors.titlelike = { parent: "structure" };
    state.options["alert-bold"] = true;
  }],
  ["wolverine", applyWolverineColors],
  ["rose", applyRoseColors],
  ["dolphin", applyDolphinColors],
  ["beaver", applyBeaverColors],
  ["spruce", applySpruceColors],
  ["whale", (state, use) => {
    markApplied(state, "color-theme", "whale", use);
    const expression = (value: string) => ({ value, span: use.source.span });
    state.colors["palette primary"] = { fg: "#ffffff", use: ["structure"], bgExpression: expression("structure.fg") };
    state.colors["palette secondary"] = { fg: "#ffffff", use: ["structure"], bgExpression: expression("structure.fg!75!black") };
    state.colors["palette tertiary"] = { fg: "#ffffff", use: ["structure"], bgExpression: expression("structure.fg!50!black") };
    state.colors["palette quaternary"] = { fg: "#ffffff", bg: "#000000" };
    state.colors.sidebar = { use: ["structure"], bgExpression: expression("structure.fg") };
    state.colors["palette sidebar primary"] = {
      use: ["structure"], fgExpression: expression("structure.fg!10!white"),
    };
    state.colors["palette sidebar secondary"] = { fg: WHITE };
    state.colors["palette sidebar tertiary"] = {
      use: ["structure"], fgExpression: expression("structure.fg!50!white"),
    };
    state.colors["palette sidebar quaternary"] = { fg: WHITE };
    state.colors.titlelike = { parent: "palette primary" };
  }],
  ["orchid", (state, use) => {
    markApplied(state, "color-theme", "orchid", use);
    const canvas = rgbChannelsFromHex(resolveMutableThemeColor(state, "normal text").bg ?? WHITE);
    for (const [suffix, role, fallback] of [
      ["", "structure", "#3333b3"],
      [" alerted", "alerted text", "#ff0000"],
      [" example", "example text", "#008000"],
    ] as const) {
      const titleRgb = mixRgbChannels(mutableThemeForegroundRgb(state, role, fallback), BLACK_RGB, 75);
      state.colors[`block title${suffix}`] = { fg: WHITE, bg: rgbChannelsToHex(titleRgb) };
      state.colors[`block body${suffix}`] = { parent: "normal text", bg: xcolorMixRgb(titleRgb, canvas, 10) };
    }
  }],
  ["seahorse", (state, use) => {
    markApplied(state, "color-theme", "seahorse", use);
    // structure.fg!20/25/30/35!white from beamercolorthemeseahorse.sty.
    const expression = (value: string) => ({ value, span: use.source.span });
    for (const [role, percent] of [["primary", 20], ["secondary", 25], ["tertiary", 30], ["quaternary", 35]] as const) {
      const palette = { ...state.colors[`palette ${role}`], fg: "#000000", use: ["structure"], bgExpression: expression(`structure.fg!${percent}!white`) };
      delete palette.fgExpression;
      delete palette.fgRgb;
      state.colors[`palette ${role}`] = palette;
    }
    state.colors.sidebar = { ...state.colors.sidebar, use: ["structure"], bgExpression: expression("structure.fg!20!white") };
    state.colors.titlelike = { parent: "palette primary" };
  }],
  ["metropolis", applyMetropolisColors],
  ["moloch", applyMolochColors],
]);

const fontThemeAppliers = new Map<string, ComponentApplier>([
  ["default", markComponentOnly("font-theme", "default")],
  ["professionalfonts", (state, use) => {
    markApplied(state, "font-theme", "professionalfonts", use);
    for (const font of Object.values(state.fonts)) font.suppressMathReplacements = true;
  }],
  ["serif", (state, use) => {
    markApplied(state, "font-theme", "serif", use);
    for (const [role, font] of Object.entries(state.fonts)) {
      const smallStructure = ["headline", "section-in-head-foot", "subsection-in-head-foot", "title-in-sidebar", "author-in-sidebar", "section-in-sidebar", "subsection-in-sidebar", "footline", "page-number"].includes(role);
      const largeStructure = ["title", "subtitle", "frame-title", "frame-subtitle", "block-title"].includes(role);
      const keepSans = use.options.onlymath !== undefined || (smallStructure ? use.options.stillsansserifsmall !== undefined : largeStructure ? use.options.stillsansseriflarge !== undefined : use.options.stillsansseriftext !== undefined);
      if (!keepSans) { font.family = "serif"; delete font.typeface; }
      font.mathFamily = use.options.stillsansserifmath === undefined ? "serif" : "sans";
    }
  }],
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

/** Normalized names of the components the resolver applies, per kind. */
export function registeredBeamerThemeComponents(kind: BeamerThemeKind): readonly string[] {
  return [...componentRegistry[kind].keys()];
}

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
      { numbering: optionString(use.options.numbering, "counter"), progressbar: progressbar === "foot" },
    );
    state.templates.frameTitle = templateRef(
      `beamer/frame-title/${family}`,
      { progressbar: progressbar === "frametitle", paddingPt: Math.round(2.2 * themeFontXHeightPt(state.fonts["normal-text"]) * 65536) / 65536 },
    );
  };
}

function applyModernInner(
  family: "metropolis" | "moloch"
): ComponentApplier {
  return (state, use) => {
    markApplied(state, "inner-theme", family, use);
    state.options["symmetric-frame-center"] = true;
    if (family === "metropolis") {
      state.options["line-spread"] = "1.15";
      state.options["paragraph-skip-pt"] = String(.5 * state.fonts["normal-text"].sizePt);
    }
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
    if (family === "metropolis") {
      for (const font of Object.values(state.fonts)) font.typeface = "fira";
    }
    state.fonts["frame-title"] = {
      ...state.fonts["frame-title"],
      ...beamerNamedFontSize(String(state.options["class-font-size"] ?? "11"), "large"),
      series: "bold",
    };
    const classSize = String(state.options["class-font-size"] ?? "11");
    if (family === "moloch") {
      state.fonts["frame-subtitle"] = { ...state.fonts["frame-title"], ...beamerNamedFontSize(classSize, "small") };
    }
    state.fonts.title = { ...state.fonts.title, ...beamerNamedFontSize(classSize, "Large"), series: "bold" };
    state.fonts.subtitle = { ...state.fonts["normal-text"], ...beamerNamedFontSize(classSize, "large") };
    state.fonts.author = { ...state.fonts.author, ...beamerNamedFontSize(classSize, "small") };
    state.fonts.date = { ...state.fonts.date, ...beamerNamedFontSize(classSize, "small") };
    state.fonts["block-title"] = {
      ...state.fonts["normal-text"],
      series: "bold",
    };
    if (family === "metropolis") {
      state.fonts["page-number"] = { ...state.fonts["page-number"], ...beamerNamedFontSize(classSize, "scriptsize") };
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
  const progressExpression = (value: string) => ({ value, span: use.source.span });
  state.colors["progress bar"] = { use: ["alerted text"], fgExpression: progressExpression("alerted text.fg"), bgExpression: progressExpression("alerted text.fg!50!black!30") };
  state.colors["progress bar in head/foot"] = { parent: "progress bar" };
  state.colors["progress bar in section page"] = { parent: "progress bar" };
  state.colors["title separator"] = { parent: "progress bar" };
  if (use.name.toLowerCase() === "moloch") state.colors.institute = { fgMix: { foregroundRole: "normal text", backgroundRole: "normal text", foregroundPercent: 80 } };
  state.colors["progress bar background"] = { parent: "progress bar in head/foot" };
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

export function parseThemeOptions(
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
  const amount = Number(requireArrayValue(match, 1));
  switch (requireArrayValue(match, 2).toLocaleLowerCase()) {
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

function freezeColorChannels(channels: BeamerColorRgb): BeamerColorRgb {
  return Object.freeze([channels[0], channels[1], channels[2]]);
}

function freezeColors(record: Readonly<Record<string, BeamerThemeColor>>): Readonly<Record<string, BeamerThemeColor>> {
  return Object.freeze(Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Object.freeze({
    ...value,
    ...(value.fgRgb ? { fgRgb: freezeColorChannels(value.fgRgb) } : {}),
    ...(value.parents ? { parents: Object.freeze([...value.parents]) } : {}),
    ...(value.use ? { use: Object.freeze([...value.use]) } : {}),
    ...(value.fgExpression ? { fgExpression: Object.freeze({ ...value.fgExpression }) } : {}),
    ...(value.bgExpression ? { bgExpression: Object.freeze({ ...value.bgExpression }) } : {}),
    ...(value.fgMix ? { fgMix: Object.freeze({ ...value.fgMix }) } : {}),
    ...(value.bgMix ? { bgMix: Object.freeze({ ...value.bgMix }) } : {})
  })] as const)));
}

function freezeFonts(record: Readonly<Record<BeamerThemeFontRole, BeamerThemeFont>>): Readonly<Record<BeamerThemeFontRole, BeamerThemeFont>> {
  const fonts = { ...record };
  const roles: readonly BeamerThemeFontRole[] = ["normal-text", "title", "subtitle", "author", "institute", "date", "frame-title", "frame-subtitle", "headline", "section-in-head-foot", "subsection-in-head-foot", "title-in-sidebar", "author-in-sidebar", "section-in-sidebar", "subsection-in-sidebar", "footline", "page-number", "block-title", "block-body"];
  for (const role of roles) fonts[role] = Object.freeze({ ...record[role] });
  return Object.freeze(fonts);
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
    bullets: Object.freeze([freezeRef(templates.bullets[0]), freezeRef(templates.bullets[1]), freezeRef(templates.bullets[2])] as const),
    enumerations: Object.freeze([freezeRef(templates.enumerations[0]), freezeRef(templates.enumerations[1]), freezeRef(templates.enumerations[2])] as const),
  });
}
