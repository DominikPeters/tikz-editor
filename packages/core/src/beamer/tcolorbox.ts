import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import type { OptionEntry } from "../options/types.js";
import { readTexBalancedDelimited } from "../parser/tex-lexical.js";
import { normalizeColor, type ColorAliasResolver } from "../semantic/style/colors.js";
import { parseTexDimensionExpression, resolveTexDimensionExpression, type TexDimensionContext } from "../text/tex/dimensions.js";
import { concatMappedText, createGeneratedMappedText, createIdentityMappedText, type MappedText } from "../text/source-map.js";
import { escapeAttribute } from "./theme/svg-markup.js";
import type { BeamerDelimitedSourceValue } from "./types.js";

const DIMENSION_KEYS = new Set([
  "width", "boxsep", "boxrule", "leftrule", "rightrule", "toprule", "bottomrule", "titlerule",
  "left", "right", "lefttitle", "righttitle", "leftupper", "rightupper", "top", "bottom", "toptitle", "bottomtitle", "arc", "outer arc",
  "before skip", "after skip", "before skip balanced", "after skip balanced",
]);
const COLOR_KEYS = new Set(["colback", "colframe", "coltext", "colupper", "coltitle", "colbacktitle"]);
const FONT_DECLARATIONS = /^(?:\s*\\(?:normalfont|rmfamily|sffamily|ttfamily|mdseries|bfseries|upshape|itshape|slshape|scshape|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge)\b\s*)*$/u;

export type TcolorboxOptions = {
  entries: readonly OptionEntry[];
  title: BeamerDelimitedSourceValue;
  fontTitle?: BeamerDelimitedSourceValue;
  fontUpper?: BeamerDelimitedSourceValue;
  diagnostics: Diagnostic[];
};

/** Parse only the ordinary, unbroken standard skin; keep option values source-backed. */
export function parseTcolorboxOptions(source: string, options: BeamerDelimitedSourceValue | undefined, fallbackSpan: Span): TcolorboxOptions {
  const entries = options ? parseOptionListRaw(source.slice(options.span.from, options.span.to), options.span.from).entries : [];
  const empty = { span: { from: fallbackSpan.to, to: fallbackSpan.to }, contentSpan: { from: fallbackSpan.to, to: fallbackSpan.to }, value: "" };
  const result: TcolorboxOptions = { entries, title: empty, diagnostics: [] };
  for (const entry of entries) {
    if (entry.kind === "unknown") { unsupported(result, entry, "option"); continue; }
    if (entry.key === "title" && entry.kind === "kv") { result.title = sourceValue(source, entry); continue; }
    if (entry.key === "notitle") { result.title = empty; continue; }
    if ((entry.key === "fonttitle" || entry.key === "fontupper") && entry.kind === "kv") {
      const value = sourceValue(source, entry);
      if (!FONT_DECLARATIONS.test(value.value)) { unsupported(result, entry, "font declaration"); continue; }
      if (entry.key === "fonttitle") result.fontTitle = value; else result.fontUpper = value;
      continue;
    }
    if (entry.kind === "kv" && DIMENSION_KEYS.has(entry.key)) {
      if (!parseTexDimensionExpression(sourceValue(source, entry).value)) unsupported(result, entry, "dimension expression");
      continue;
    }
    if (entry.kind === "kv" && COLOR_KEYS.has(entry.key)) continue;
    if (["sharp corners", "rounded corners", "sharpish corners", "nobeforeafter", "auto outer arc"].includes(entry.key) && entry.kind === "flag") continue;
    unsupported(result, entry, "option");
  }
  return result;
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
};

/** tcolorbox.sty: size/normal, reset@core, and tcb@comp@arc@auto. */
export function resolveTcolorboxPlan(args: { source: string; options: TcolorboxOptions; dimensions: TexDimensionContext; baselineSkipPt: number; resolveColorAlias?: ColorAliasResolver }): { plan: TcolorboxPlan | null; diagnostics: Diagnostic[] } {
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
    title: options.title, fontTitle: options.fontTitle, fontUpper: options.fontUpper,
    frameColor: "#404040", backgroundColor: "#f2f2f2", textColor: "#000000", titleColor: "#ffffff", titleBackgroundColor: null,
    titleXPt: 0, titleWidthPt: 0, bodyXPt: 0, bodyWidthPt: 0,
    beforeSkipPt: args.baselineSkipPt / 2, afterSkipPt: args.baselineSkipPt / 2,
    beforeBalanced: true, afterBalanced: true, noBeforeAfter: false, suppressInitialListTopsep: true,
  };
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
      const color = normalizeColor(value, { resolveAlias: args.resolveColorAlias });
      const colorField = { colback: "backgroundColor", colframe: "frameColor", coltext: "textColor", colupper: "textColor", coltitle: "titleColor", colbacktitle: "titleBackgroundColor" } as const;
      plan[colorField[entry.key as keyof typeof colorField]] = color;
      continue;
    }
    if (!DIMENSION_KEYS.has(entry.key)) continue;
    const dimension = parseTexDimensionExpression(value)!;
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
  plan.titleXPt = plan.leftRulePt + plan.boxsepPt + plan.leftTitlePt;
  plan.bodyXPt = plan.leftRulePt + plan.boxsepPt + plan.leftPt;
  plan.titleWidthPt = plan.widthPt - plan.titleXPt - plan.rightRulePt - plan.boxsepPt - plan.rightTitlePt;
  plan.bodyWidthPt = plan.widthPt - plan.bodyXPt - plan.rightRulePt - plan.boxsepPt - plan.rightPt;
  if (plan.widthPt <= 0 || plan.titleWidthPt <= 0 || plan.bodyWidthPt <= 0 || [plan.leftRulePt, plan.rightRulePt, plan.topRulePt, plan.bottomRulePt, plan.titleRulePt, plan.arcPt, plan.outerArcPt].some(value => value < 0)) {
    return { plan: null, diagnostics: [{ severity: "warning", code: "beamer-tcolorbox-invalid-geometry", span: options.title.span, message: "The tcolorbox dimensions do not leave a supported positive content area." }] };
  }
  return { plan, diagnostics: [] };
}

export type TcolorboxGeometry = { heightPt: number; titleTopPt: number; bodyTopPt: number; interiorTopPt: number; interiorBottomPt: number };

/** tcb@draw@color@box and tcb@drawcolorbox: arguments are total minipage heights (height + depth). */
export function measureTcolorboxGeometry(plan: TcolorboxPlan, titleHeightPt: number, bodyHeightPt: number): TcolorboxGeometry {
  const hasTitle = plan.title.value !== "";
  const paddedTitle = hasTitle ? titleHeightPt + plan.titleRulePt + 2 * plan.boxsepPt + plan.topTitlePt + plan.bottomTitlePt : 0;
  const titleTopPt = plan.topRulePt + plan.boxsepPt + plan.topTitlePt;
  const interiorTopPt = plan.topRulePt + paddedTitle;
  const bodyTopPt = interiorTopPt + plan.boxsepPt + plan.topPt;
  const heightPt = bodyTopPt + bodyHeightPt + plan.boxsepPt + plan.bottomPt + plan.bottomRulePt;
  return { heightPt, titleTopPt, bodyTopPt, interiorTopPt, interiorBottomPt: heightPt - plan.bottomRulePt };
}

/** Before/after balanced skip uses .3 baselineskip as the following paragraph's prevdepth. */
export function tcolorboxSurroundingSpacing(plan: TcolorboxPlan, args: { baselineSkipPt: number; previousDepthPt: number | null; parskipPt?: number; atStart?: boolean; insideMinipage?: boolean }): { beforePt: number; afterPt: number; endingDepthPt: number | null } {
  if (plan.noBeforeAfter) return { beforePt: 0, afterPt: 0, endingDepthPt: 0 };
  const parskip = args.parskipPt ?? 0;
  const depth = args.previousDepthPt;
  const balanced = plan.beforeBalanced && depth != null && depth >= 0 ? Math.max(0, .3 * args.baselineSkipPt - depth) : 0;
  const beforePt = args.atStart ? 0 : args.insideMinipage ? -Math.max(0, parskip) : plan.beforeSkipPt + balanced - parskip;
  return { beforePt, afterPt: plan.afterSkipPt - parskip, endingDepthPt: plan.afterBalanced ? .3 * args.baselineSkipPt : null };
}

/** Standard skin fills the outer frame first, then the inner content (top corners square with a title). */
export function emitTcolorboxBackground(plan: TcolorboxPlan, geometry: TcolorboxGeometry): string {
  const frame = roundedPath(0, 0, plan.widthPt, geometry.heightPt, plan.sharpCorners ? 0 : plan.outerArcPt, true, true);
  const inner = roundedPath(plan.leftRulePt, geometry.interiorTopPt, plan.widthPt - plan.leftRulePt - plan.rightRulePt, geometry.interiorBottomPt - geometry.interiorTopPt, plan.sharpCorners ? 0 : plan.arcPt, plan.title.value === "", true);
  let svg = `<path data-tcolorbox-layer="frame" d="${frame}" fill="${escapeAttribute(plan.frameColor)}"/><path data-tcolorbox-layer="body" d="${inner}" fill="${escapeAttribute(plan.backgroundColor)}"/>`;
  if (plan.title.value !== "" && plan.titleBackgroundColor !== null) {
    const title = roundedPath(plan.leftRulePt, plan.topRulePt, plan.widthPt - plan.leftRulePt - plan.rightRulePt, geometry.interiorTopPt - plan.topRulePt - plan.titleRulePt, plan.sharpCorners ? 0 : plan.arcPt, true, false);
    svg += `<path data-tcolorbox-layer="title" d="${title}" fill="${escapeAttribute(plan.titleBackgroundColor)}"/>`;
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
