import { requireDefined } from "../utils/invariants.js";
import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionEntry } from "../options/types.js";
import { readTexBalancedDelimited } from "../parser/tex-lexical.js";
import { normalizeColor, type ColorAliasResolver } from "../semantic/style/colors.js";
import { parseTexDimensionExpression, resolveTexDimensionExpression, type TexDimensionContext } from "../text/tex/dimensions.js";
import { texLength } from "../text/tex/coordinates.js";
import { concatMappedText, createGeneratedMappedText, createIdentityMappedText, type MappedText } from "../text/source-map.js";
import { escapeAttribute } from "./theme/svg-markup.js";
import type { BeamerDelimitedSourceValue } from "./types.js";

const DIMENSION_KEYS = new Set([
  "width", "boxsep", "boxrule", "leftrule", "rightrule", "toprule", "bottomrule", "titlerule",
  "left", "right", "lefttitle", "righttitle", "leftupper", "rightupper", "top", "bottom", "toptitle", "bottomtitle", "arc", "outer arc",
  "before skip", "after skip", "before skip balanced", "after skip balanced",
]);
const COLOR_KEYS = new Set(["colback", "colframe", "coltext", "colupper", "coltitle", "colbacktitle"]);
const FONT_DECLARATIONS = /^(?:\s*\\(?:normalfont|rmfamily|sffamily|ttfamily|mdseries|bfseries|upshape|itshape|slshape|scshape|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b\s*|\s*\\color(?:\[[^\]]*\])?\{[^{}]*\}\s*)*$/u;
/** Skins and settings that do not change the geometry this preview draws. */
const NO_EFFECT_FLAGS = new Set(["enhanced", "enhanced jigsaw", "shield externalize"]);

/** `attach boxed title to top left={xshift=..,yshift=..}`: the title as a separate box on the frame's top edge. */
export type TcolorboxBoxedTitleOptions = {
  placement: "left" | "center" | "right";
  xShift: string; yShift: string; yShiftStar: boolean;
  /** `boxed title style`, in authored order, for the title's own box. */
  style: readonly OptionEntry[];
};

export type TcolorboxOptions = {
  entries: readonly OptionEntry[];
  /** Global `\tcbset` defaults, which a title box inherits (a box inside a box starts from them). */
  setupDefaults?: readonly OptionEntry[];
  boxedTitle?: TcolorboxBoxedTitleOptions;
  title: BeamerDelimitedSourceValue;
  fontTitle?: BeamerDelimitedSourceValue;
  fontUpper?: BeamerDelimitedSourceValue;
  diagnostics: Diagnostic[];
};

type TcolorboxSetup = { styles: Map<string, readonly OptionEntry[]>; defaults: readonly OptionEntry[]; diagnostics: Diagnostic[] };

/** The option list between two source offsets, with entry spans in the source. */
function optionEntriesIn(source: string, inner: Span): readonly OptionEntry[] {
  return parseOptionListRaw(`[${source.slice(inner.from, inner.to)}]`, inner.from - 1).entries;
}

/**
 * `\tcbset{...}` before the box: `name/.style={...}` (and `/.append style`)
 * define styles, every other key is a default for all boxes that follow.
 */
function collectTcolorboxSetup(source: string, before: number): TcolorboxSetup {
  const setup: TcolorboxSetup = { styles: new Map(), defaults: [], diagnostics: [] };
  const defaults: OptionEntry[] = [];
  const pattern = /\\tcbset\s*(?=\{)/gu;
  for (let match = pattern.exec(source); match && match.index < before; match = pattern.exec(source)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    if (/(?<!\\)%/u.test(source.slice(lineStart, match.index))) continue;
    const group = readTexBalancedDelimited(source, match.index + match[0].length, "{", "}");
    if (!group) continue;
    for (const entry of optionEntriesIn(source, { from: group.from + 1, to: group.to - 1 })) {
      const definition = entry.kind === "kv" ? /^(?:\/tcb\/)?([^/]+)\/\.(style|append style)$/u.exec(entry.key) : null;
      if (entry.kind === "kv" && definition) {
        const name = (definition[1] ?? "").trim();
        const value = entry.valueSpan ? readTexBalancedDelimited(source, entry.valueSpan.from, "{", "}") : null;
        const body = value ? optionEntriesIn(source, { from: value.from + 1, to: value.to - 1 }) : [];
        if (!value || /#\d/u.test(source.slice(value.from, value.to))) {
          setup.diagnostics.push({ severity: "warning", code: "beamer-tcolorbox-unsupported-setup", span: entry.span,
            message: `This tcolorbox style is not supported in the preview: ${entry.raw}.` });
          continue;
        }
        setup.styles.set(name, definition[2] === "style" ? body : [...setup.styles.get(name) ?? [], ...body]);
        continue;
      }
      defaults.push(entry);
    }
  }
  return { ...setup, defaults };
}

/** Replace style names by the entries of their definitions, as pgfkeys does. */
function expandTcolorboxStyles(entries: readonly OptionEntry[], styles: ReadonlyMap<string, readonly OptionEntry[]>, depth = 0): OptionEntry[] {
  return entries.flatMap(entry => {
    const style = entry.kind === "flag" ? styles.get(entry.key) : undefined;
    return style && depth < 16 ? expandTcolorboxStyles(style, styles, depth + 1) : [entry];
  });
}

/** Parse the ordinary, unbroken skins; keep option values source-backed. */
export function parseTcolorboxOptions(source: string, options: BeamerDelimitedSourceValue | undefined, fallbackSpan: Span): TcolorboxOptions {
  const written = options ? parseOptionListRaw(source.slice(options.span.from, options.span.to), options.span.from).entries : [];
  const setup = collectTcolorboxSetup(source, fallbackSpan.from);
  const entries = expandTcolorboxStyles([...setup.defaults, ...written], setup.styles);
  const empty = { span: { from: fallbackSpan.to, to: fallbackSpan.to }, contentSpan: { from: fallbackSpan.to, to: fallbackSpan.to }, value: "" };
  const result: TcolorboxOptions = { entries, setupDefaults: setup.defaults, title: empty, diagnostics: [...setup.diagnostics] };
  const boxedStyle: OptionEntry[] = [];
  let boxedTitle: Omit<TcolorboxBoxedTitleOptions, "style"> | undefined;
  for (const entry of entries) {
    const attach = /^attach boxed title to top (left|center|right)$/u.exec(entry.kind === "unknown" ? "" : entry.key);
    if (attach && entry.kind !== "unknown") {
      const inner = entry.kind === "kv" ? optionEntriesIn(source, sourceValue(source, entry).contentSpan) : [];
      const shifts = { xShift: "0pt", yShift: "0pt", yShiftStar: false };
      for (const shift of inner) {
        if (shift.kind !== "kv" || !["xshift", "yshift", "yshift*"].includes(shift.key) || !parseTexDimensionExpression(sourceValue(source, shift).value)) { unsupported(result, shift, "boxed title shift"); continue; }
        const value = sourceValue(source, shift).value;
        if (shift.key === "xshift") shifts.xShift = value; else { shifts.yShift = value; shifts.yShiftStar = shift.key === "yshift*"; }
      }
      boxedTitle = { placement: attach[1] === "center" ? "center" : attach[1] === "right" ? "right" : "left", ...shifts };
      continue;
    }
    if (entry.kind === "kv" && entry.key === "boxed title style") {
      const group = optionEntriesIn(source, sourceValue(source, entry).contentSpan);
      for (const styleEntry of expandTcolorboxStyles(group, setup.styles)) {
        if (!checkTcolorboxEntry(source, styleEntry, result, false)) boxedStyle.push(styleEntry);
      }
      continue;
    }
    checkTcolorboxEntry(source, entry, result, true);
  }
  if (boxedTitle) result.boxedTitle = { ...boxedTitle, style: boxedStyle };
  return result;
}

/** Validate one entry; reports a diagnostic and returns true when the preview cannot honour it. */
function checkTcolorboxEntry(source: string, entry: OptionEntry, result: TcolorboxOptions, allowTitle: boolean): boolean {
  const before = result.diagnostics.length;
  if (entry.kind === "unknown") { unsupported(result, entry, "option"); return true; }
  if (allowTitle && entry.key === "title" && entry.kind === "kv") { result.title = sourceValue(source, entry); return false; }
  if (allowTitle && entry.key === "notitle") { result.title = { span: { from: entry.span.to, to: entry.span.to }, contentSpan: { from: entry.span.to, to: entry.span.to }, value: "" }; return false; }
  if (allowTitle && (entry.key === "fonttitle" || entry.key === "fontupper") && entry.kind === "kv") {
    const value = sourceValue(source, entry);
    if (!FONT_DECLARATIONS.test(value.value)) { unsupported(result, entry, "font declaration"); return true; }
    if (entry.key === "fonttitle") result.fontTitle = value; else result.fontUpper = value;
    return false;
  }
  if (entry.kind === "kv" && DIMENSION_KEYS.has(entry.key)) {
    if (!parseTexDimensionExpression(sourceValue(source, entry).value)) unsupported(result, entry, "dimension expression");
  } else if (entry.kind === "kv" && COLOR_KEYS.has(entry.key)) {
    // Colour expressions are resolved with the plan.
  } else if (entry.kind === "flag" && NO_EFFECT_FLAGS.has(entry.key)) {
    // No effect on the geometry or drawing this preview models.
  } else if (entry.kind === "flag" && ["sharp corners", "rounded corners", "sharpish corners", "nobeforeafter", "auto outer arc"].includes(entry.key)) {
    // Corner and skip flags are applied by the plan.
  } else unsupported(result, entry, "option");
  return result.diagnostics.length > before;
}

function unsupported(result: TcolorboxOptions, entry: OptionEntry, what: string): void {
  result.diagnostics.push({ severity: "warning", code: "beamer-tcolorbox-unsupported-option", span: entry.span,
    message: `This tcolorbox ${what} is not supported in the preview: ${entry.raw}.` });
}

function sourceValue(source: string, entry: Extract<OptionEntry, { kind: "kv" }>): BeamerDelimitedSourceValue {
  const span = entry.valueSpan ?? { from: entry.span.to, to: entry.span.to };
  const group = readTexBalancedDelimited(source, span.from, "{", "}");
  const contentSpan = group?.to === span.to ? { from: span.from + 1, to: span.to - 1 } : span;
  return { span, contentSpan, value: source.slice(contentSpan.from, contentSpan.to) };
}

/** Apply a font option in the savebox without transferring prose ownership to that option. */
export function projectTcolorboxFontDeclaration(content: MappedText, declaration: BeamerDelimitedSourceValue | undefined): MappedText {
  return declaration ? concatMappedText([
    createIdentityMappedText(declaration.value, declaration.contentSpan.from),
    createGeneratedMappedText(" ", "tcolorbox font declaration separator", declaration.span), content,
  ]) : content;
}

export type TcolorboxPlan = {
  widthPt: number;
  boxsepPt: number;
  leftRulePt: number; rightRulePt: number; topRulePt: number; bottomRulePt: number; titleRulePt: number;
  leftPt: number; rightPt: number; leftTitlePt: number; rightTitlePt: number;
  topPt: number; bottomPt: number; topTitlePt: number; bottomTitlePt: number;
  arcPt: number; outerArcPt: number; sharpCorners: boolean;
  title: BeamerDelimitedSourceValue; fontTitle?: BeamerDelimitedSourceValue; fontUpper?: BeamerDelimitedSourceValue;
  frameColor: string; backgroundColor: string; textColor: string; titleColor: string; titleBackgroundColor: string | null;
  titleXPt: number; titleWidthPt: number; bodyXPt: number; bodyWidthPt: number;
  beforeSkipPt: number; afterSkipPt: number; beforeBalanced: boolean; afterBalanced: boolean; noBeforeAfter: boolean;
  /** A tcolorbox savebox begins in minipage mode, unlike a Beamer block colorbox. */
  suppressInitialListTopsep: true;
  /** Title in a box of its own on the frame's edge; the box's top padding then ignores the title. */
  boxedTitle?: { placement: "left" | "center" | "right"; xShiftPt: number; yShiftPt: number; options: TcolorboxBoxedTitleOptions; setupDefaults: readonly OptionEntry[] };
};

/** A title with a frame of its own, positioned relative to the box (before the box's own top is known). */
export type TcolorboxBoxedTitleLayout = { plan: TcolorboxPlan; geometry: TcolorboxGeometry; xPt: number; topPt: number };

/** Whether the title is set inside the box, between its frame's top rule and the text. */
export function tcolorboxHasInlineTitle(plan: TcolorboxPlan): boolean {
  return plan.title.value !== "" && plan.boxedTitle === undefined;
}

/** tcolorbox.sty: size/normal, reset@core, and tcb@comp@arc@auto. */
export function resolveTcolorboxPlan(args: { source: string; options: TcolorboxOptions; dimensions: TexDimensionContext; baselineSkipPt: number; resolveColorAlias?: ColorAliasResolver; seedColors?: { frame: string; back: string }; sizeTitle?: boolean }): { plan: TcolorboxPlan | null; diagnostics: Diagnostic[] } {
  const { source, options, dimensions } = args;
  if (options.diagnostics.length) return { plan: null, diagnostics: options.diagnostics };
  // TeX's unit conversion truncates the fractional scaled point for mm.
  const mm = (value: number) => Math.trunc(value * 72.27 / 25.4 * 65536) / 65536;
  const plan: TcolorboxPlan = {
    widthPt: Number(dimensions.linewidth), boxsepPt: mm(1),
    leftRulePt: mm(.5), rightRulePt: mm(.5), topRulePt: mm(.5), bottomRulePt: mm(.5), titleRulePt: mm(.5),
    leftPt: mm(4), rightPt: mm(4), leftTitlePt: mm(4), rightTitlePt: mm(4),
    topPt: mm(2), bottomPt: mm(2), topTitlePt: 0, bottomTitlePt: 0,
    arcPt: mm(1), outerArcPt: 0, sharpCorners: false,
    title: options.title, ...(options.fontTitle !== undefined ? { fontTitle: options.fontTitle } : {}), ...(options.fontUpper !== undefined ? { fontUpper: options.fontUpper } : {}),
    frameColor: "#404040", backgroundColor: "#f2f2f2", textColor: "#000000", titleColor: "#ffffff", titleBackgroundColor: null,
    titleXPt: 0, titleWidthPt: 0, bodyXPt: 0, bodyWidthPt: 0,
    beforeSkipPt: args.baselineSkipPt / 2, afterSkipPt: args.baselineSkipPt / 2,
    beforeBalanced: true, afterBalanced: true, noBeforeAfter: false, suppressInitialListTopsep: true,
  };
  if (args.sizeTitle) {
    // tcolorbox.sty size/title, the default `boxed title size`.
    Object.assign(plan, { boxsepPt: mm(1), leftRulePt: mm(.4), rightRulePt: mm(.4), topRulePt: mm(.4), bottomRulePt: mm(.4), titleRulePt: mm(.4),
      leftPt: mm(2), rightPt: mm(2), leftTitlePt: mm(2), rightTitlePt: mm(2), topPt: mm(.25), bottomPt: mm(.25), arcPt: mm(.75) });
  }
  if (args.seedColors) { plan.frameColor = args.seedColors.frame; plan.backgroundColor = args.seedColors.back; }
  let autoOuterArc = true;
  for (const entry of options.entries) {
    if (entry.kind === "unknown") continue;
    if (entry.kind === "flag") {
      if (entry.key === "sharp corners") plan.sharpCorners = true;
      if (entry.key === "rounded corners") plan.sharpCorners = false;
      if (entry.key === "sharpish corners") { plan.arcPt = 0; plan.outerArcPt = 0; autoOuterArc = false; }
      if (entry.key === "auto outer arc") autoOuterArc = true;
      if (entry.key === "nobeforeafter") plan.noBeforeAfter = true;
      continue;
    }
    const value = sourceValue(source, entry).value;
    if (COLOR_KEYS.has(entry.key)) {
      const color = normalizeColor(value, { ...(args.resolveColorAlias !== undefined ? { resolveAlias: args.resolveColorAlias } : {}) });
      const colorField = { colback: "backgroundColor", colframe: "frameColor", coltext: "textColor", colupper: "textColor", coltitle: "titleColor", colbacktitle: "titleBackgroundColor" } as const;
      const field = Object.entries(colorField).find(([key]) => key === entry.key)?.[1];
      if (field) plan[field] = color;
      continue;
    }
    if (!DIMENSION_KEYS.has(entry.key)) continue;
    const dimension = requireDefined(parseTexDimensionExpression(value), "Expected an internal tcolorbox value");
    const pt = Math.round(Number(resolveTexDimensionExpression(dimension, dimensions)) * 65536) / 65536;
    switch (entry.key) {
      case "width": plan.widthPt = pt; break;
      case "boxsep": plan.boxsepPt = pt; break;
      case "boxrule": plan.leftRulePt = plan.rightRulePt = plan.topRulePt = plan.bottomRulePt = plan.titleRulePt = pt; break;
      case "leftrule": plan.leftRulePt = pt; break;
      case "rightrule": plan.rightRulePt = pt; break;
      case "toprule": plan.topRulePt = pt; break;
      case "bottomrule": plan.bottomRulePt = pt; break;
      case "titlerule": plan.titleRulePt = pt; break;
      case "left": plan.leftPt = plan.leftTitlePt = pt; break;
      case "right": plan.rightPt = plan.rightTitlePt = pt; break;
      case "leftupper": plan.leftPt = pt; break;
      case "rightupper": plan.rightPt = pt; break;
      case "lefttitle": plan.leftTitlePt = pt; break;
      case "righttitle": plan.rightTitlePt = pt; break;
      case "top": plan.topPt = pt; break;
      case "bottom": plan.bottomPt = pt; break;
      case "toptitle": plan.topTitlePt = pt; break;
      case "bottomtitle": plan.bottomTitlePt = pt; break;
      case "arc": plan.arcPt = pt; break;
      case "outer arc": plan.outerArcPt = pt; autoOuterArc = false; break;
      case "before skip": case "before skip balanced": plan.beforeSkipPt = pt; plan.beforeBalanced = entry.key.endsWith("balanced"); plan.noBeforeAfter = false; break;
      case "after skip": case "after skip balanced": plan.afterSkipPt = pt; plan.afterBalanced = entry.key.endsWith("balanced"); plan.noBeforeAfter = false; break;
    }
  }
  if (autoOuterArc) plan.outerArcPt = plan.arcPt + Math.min(plan.leftRulePt, plan.rightRulePt, plan.topRulePt, plan.bottomRulePt);
  if (options.boxedTitle && plan.title.value !== "") {
    const boxed = options.boxedTitle;
    const resolve = (raw: string) => Math.round(Number(resolveTexDimensionExpression(requireDefined(parseTexDimensionExpression(raw), "Expected an internal tcolorbox value"), dimensions)) * 65536) / 65536;
    const yShiftPt = resolve(boxed.yShift);
    // tcbskins `boxtitle/yshift*@top`: `yshift*` also moves the text down unless the shift is upward.
    const yInnerPt = boxed.yShiftStar ? Math.min(0, yShiftPt + plan.topRulePt) : 0;
    plan.topPt -= yInnerPt;
    plan.boxedTitle = { placement: boxed.placement, xShiftPt: resolve(boxed.xShift), yShiftPt, options: boxed, setupDefaults: options.setupDefaults ?? [] };
  }
  plan.titleXPt = plan.leftRulePt + plan.boxsepPt + plan.leftTitlePt;
  plan.bodyXPt = plan.leftRulePt + plan.boxsepPt + plan.leftPt;
  plan.titleWidthPt = plan.widthPt - plan.titleXPt - plan.rightRulePt - plan.boxsepPt - plan.rightTitlePt;
  plan.bodyWidthPt = plan.widthPt - plan.bodyXPt - plan.rightRulePt - plan.boxsepPt - plan.rightPt;
  if (plan.widthPt <= 0 || plan.titleWidthPt <= 0 || plan.bodyWidthPt <= 0 || [plan.leftRulePt, plan.rightRulePt, plan.topRulePt, plan.bottomRulePt, plan.titleRulePt, plan.arcPt, plan.outerArcPt].some(value => value < 0)) {
    return { plan: null, diagnostics: [{ severity: "warning", code: "beamer-tcolorbox-invalid-geometry", span: options.title.span, message: "The tcolorbox dimensions do not leave a supported positive content area." }] };
  }
  return { plan, diagnostics: [] };
}

export type TcolorboxGeometry = {
  heightPt: number; titleTopPt: number; bodyTopPt: number; interiorTopPt: number; interiorBottomPt: number;
  /** Top of the frame; the box reserves room above it for a boxed title that sticks out. */
  frameTopPt: number;
  titleXPt: number;
  boxedTitle?: TcolorboxBoxedTitleLayout;
};

/** tcb@draw@color@box and tcb@drawcolorbox: arguments are total minipage heights (height + depth). */
export function measureTcolorboxGeometry(plan: TcolorboxPlan, titleHeightPt: number, bodyHeightPt: number, boxedTitle?: { plan: TcolorboxPlan; geometry: TcolorboxGeometry; xPt: number }): TcolorboxGeometry {
  const hasTitle = tcolorboxHasInlineTitle(plan);
  const paddedTitle = hasTitle ? titleHeightPt + plan.titleRulePt + 2 * plan.boxsepPt + plan.topTitlePt + plan.bottomTitlePt : 0;
  // tcbskins `boxtitle/adapt@top`: the bounding box grows by the part of the title above the frame.
  const tabHeight = boxedTitle?.geometry.heightPt ?? 0;
  const frameTopPt = boxedTitle && plan.boxedTitle ? Math.max(0, tabHeight + plan.boxedTitle.yShiftPt) : 0;
  const titleTopPt = frameTopPt + plan.topRulePt + plan.boxsepPt + plan.topTitlePt;
  const interiorTopPt = frameTopPt + plan.topRulePt + paddedTitle;
  const bodyTopPt = interiorTopPt + plan.boxsepPt + plan.topPt;
  const heightPt = bodyTopPt + bodyHeightPt + plan.boxsepPt + plan.bottomPt + plan.bottomRulePt;
  const geometry: TcolorboxGeometry = { heightPt, titleTopPt, bodyTopPt, interiorTopPt, interiorBottomPt: heightPt - plan.bottomRulePt, frameTopPt, titleXPt: plan.titleXPt };
  if (!boxedTitle || !plan.boxedTitle) return geometry;
  const topPt = frameTopPt - plan.boxedTitle.yShiftPt - tabHeight;
  return { ...geometry, titleTopPt: topPt + boxedTitle.geometry.bodyTopPt, titleXPt: boxedTitle.xPt + boxedTitle.plan.bodyXPt,
    boxedTitle: { plan: boxedTitle.plan, geometry: boxedTitle.geometry, xPt: boxedTitle.xPt, topPt } };
}

/**
 * The box a boxed title is set in, as `\tcbox` makes it: a box of its own with the default
 * sizes, the main box's frame and title colours, and `boxed title style`. Its width is the
 * title's natural width.
 */
export function resolveTcolorboxBoxedTitle(args: {
  source: string; plan: TcolorboxPlan; options: TcolorboxOptions; dimensions: TexDimensionContext; baselineSkipPt: number;
  resolveColorAlias?: ColorAliasResolver; contentWidthPt: number; contentHeightPt: number;
}): { plan: TcolorboxPlan; geometry: TcolorboxGeometry; xPt: number } | null {
  const boxed = args.plan.boxedTitle;
  if (!boxed) return null;
  // The title box starts from the global defaults, not from the options of the box it belongs to.
  const entries = [...boxed.setupDefaults.filter(entry => entry.kind !== "unknown" && !COLOR_KEYS.has(entry.key)), ...boxed.options.style];
  const title = { span: args.options.title.span, contentSpan: args.options.title.contentSpan, value: "" };
  const { plan: tab } = resolveTcolorboxPlan({ source: args.source, options: { entries, title, diagnostics: [] },
    dimensions: { ...args.dimensions, linewidth: texLength(1e4), textwidth: texLength(1e4), columnwidth: texLength(1e4) },
    baselineSkipPt: args.baselineSkipPt, ...(args.resolveColorAlias !== undefined ? { resolveColorAlias: args.resolveColorAlias } : {}),
    seedColors: { frame: args.plan.frameColor, back: args.plan.titleBackgroundColor ?? args.plan.frameColor }, sizeTitle: true });
  if (!tab) return null;
  tab.widthPt = tab.bodyXPt + args.contentWidthPt + tab.rightRulePt + tab.boxsepPt + tab.rightPt;
  tab.bodyWidthPt = args.contentWidthPt;
  const geometry = measureTcolorboxGeometry(tab, 0, args.contentHeightPt);
  const xPt = boxed.placement === "left" ? boxed.xShiftPt : boxed.placement === "center" ? (args.plan.widthPt - tab.widthPt) / 2 + boxed.xShiftPt : args.plan.widthPt - tab.widthPt + boxed.xShiftPt;
  return { plan: tab, geometry, xPt };
}

/** Before/after balanced skip uses .3 baselineskip as the following paragraph's prevdepth. */
export function tcolorboxSurroundingSpacing(plan: TcolorboxPlan, args: { baselineSkipPt: number; previousDepthPt: number | null; parskipPt?: number; atStart?: boolean; insideMinipage?: boolean; previousAfterSkipPt?: number }): { beforePt: number; afterPt: number; endingDepthPt: number | null } {
  if (plan.noBeforeAfter) return { beforePt: 0, afterPt: 0, endingDepthPt: 0 };
  const parskip = args.parskipPt ?? 0;
  const depth = args.previousDepthPt;
  const balanced = plan.beforeBalanced && depth != null && depth >= 0 ? Math.max(0, .3 * args.baselineSkipPt - depth) : 0;
  // \addvspace keeps the larger of the skip already there (the previous box's `after skip`) and its own.
  const beforePt = args.atStart ? 0 : args.insideMinipage ? -Math.max(0, parskip) : Math.max(plan.beforeSkipPt + balanced - parskip, args.previousAfterSkipPt ?? 0) - (args.previousAfterSkipPt ?? 0);
  return { beforePt, afterPt: plan.afterSkipPt - parskip, endingDepthPt: plan.afterBalanced ? .3 * args.baselineSkipPt : null };
}

/** Standard skin fills the outer frame first, then the inner content (top corners square with a title). */
export function emitTcolorboxBackground(plan: TcolorboxPlan, geometry: TcolorboxGeometry): string {
  const frame = roundedPath(0, geometry.frameTopPt, plan.widthPt, geometry.heightPt - geometry.frameTopPt, plan.sharpCorners ? 0 : plan.outerArcPt, true, true);
  const inlineTitle = tcolorboxHasInlineTitle(plan);
  const inner = roundedPath(plan.leftRulePt, geometry.interiorTopPt, plan.widthPt - plan.leftRulePt - plan.rightRulePt, geometry.interiorBottomPt - geometry.interiorTopPt, plan.sharpCorners ? 0 : plan.arcPt, !inlineTitle, true);
  let svg = `<path data-tcolorbox-layer="frame" d="${frame}" fill="${escapeAttribute(plan.frameColor)}"/><path data-tcolorbox-layer="body" d="${inner}" fill="${escapeAttribute(plan.backgroundColor)}"/>`;
  if (inlineTitle && plan.titleBackgroundColor !== null) {
    const title = roundedPath(plan.leftRulePt, geometry.frameTopPt + plan.topRulePt, plan.widthPt - plan.leftRulePt - plan.rightRulePt, geometry.interiorTopPt - geometry.frameTopPt - plan.topRulePt - plan.titleRulePt, plan.sharpCorners ? 0 : plan.arcPt, true, false);
    svg += `<path data-tcolorbox-layer="title" d="${title}" fill="${escapeAttribute(plan.titleBackgroundColor)}"/>`;
  }
  // The title box is an underlay: drawn after the frame and interior, before the text.
  if (geometry.boxedTitle) {
    const { plan: tab, geometry: tabGeometry, xPt, topPt } = geometry.boxedTitle;
    svg += `<g data-tcolorbox-layer="boxed-title" transform="translate(${Number(xPt.toFixed(6))} ${Number(topPt.toFixed(6))})">${emitTcolorboxBackground(tab, tabGeometry)}</g>`;
  }
  return svg;
}

function roundedPath(x: number, y: number, width: number, height: number, radius: number, roundTop: boolean, roundBottom: boolean): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / (roundTop && roundBottom ? 2 : 1)));
  const top = roundTop ? r : 0, bottom = roundBottom ? r : 0, k = .5522847498307936;
  const f = (n: number) => Number(n.toFixed(6));
  const parts = [`M${f(x + top)} ${f(y)}`, `H${f(x + width - top)}`];
  if (top) parts.push(`C${f(x + width - top + k * top)} ${f(y)} ${f(x + width)} ${f(y + top - k * top)} ${f(x + width)} ${f(y + top)}`);
  parts.push(`V${f(y + height - bottom)}`);
  if (bottom) parts.push(`C${f(x + width)} ${f(y + height - bottom + k * bottom)} ${f(x + width - bottom + k * bottom)} ${f(y + height)} ${f(x + width - bottom)} ${f(y + height)}`);
  parts.push(`H${f(x + bottom)}`);
  if (bottom) parts.push(`C${f(x + bottom - k * bottom)} ${f(y + height)} ${f(x)} ${f(y + height - bottom + k * bottom)} ${f(x)} ${f(y + height - bottom)}`);
  parts.push(`V${f(y + top)}`);
  if (top) parts.push(`C${f(x)} ${f(y + top - k * top)} ${f(x + top - k * top)} ${f(y)} ${f(x + top)} ${f(y)}`);
  return parts.join(" ") + " Z";
}
