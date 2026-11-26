import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { MacroBinding } from "../macros/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import { texScannedDimensionPt } from "../text/tex/dimensions.js";
import { preambleCommandScope } from "./preamble-edit-context.js";
import { beamerControlSequencesIn, beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, beamerSourceValueTokens, createBeamerSyntaxContext, type BeamerSyntaxContext } from "./syntax.js";
import type { BeamerDocumentModel } from "./types.js";

/**
 * beamerposter 1.13 (TeX Live 2026 `beamerposter.sty`), as loaded literally
 * by the document's own preamble. Loads through theme files, input files or
 * macros need preamble execution and are not seen here.
 */
export type BeamerPosterSettings = {
  /** The `\usepackage` command that loads the package. */
  span: Span;
  size: BeamerPosterSize;
  portrait: boolean;
  /** The package's `scale` option (1 when absent). */
  scale: number;
  /** `\myfontscale`: `scale` × the size's font scale, rounded to two decimals. */
  fontScale: number;
  /** Paper as `\geometry` computes it at package load, in TeX points. */
  geometryPaper: { widthPt: number; heightPt: number };
  /** Paper after later literal `\setlength{\paperwidth}` / `{\paperheight}`. */
  paper: { widthPt: number; heightPt: number };
  diagnostics: readonly Diagnostic[];
};

const POSTER_SIZES = ["a0b", "a0", "a1", "a2", "a3", "a4", "custom"] as const;
export type BeamerPosterSize = typeof POSTER_SIZES[number];

const TEX_POINTS_PER_CM = 72.27 / 2.54;

// Landscape paper (cm) and font scale per size; the text dimensions in the
// package's table are overwritten by its later \geometry call.
const SIZES: Readonly<Record<Exclude<BeamerPosterSize, "custom">, readonly [number, number, string]>> = {
  a0b: [119, 88, "1.0"],
  a0: [118.9, 84.1, "1.0"],
  a1: [84.1, 59.4, "0.70710678"],
  a2: [59.4, 42.0, "0.5"],
  a3: [42.0, 29.7, "0.35355339"],
  a4: [29.7, 21.0, "0.25"],
};

/** The A0 font table, `\fontsize{X}{Y}` before scaling. */
export const BEAMER_POSTER_FONT_TABLE = [
  ["tiny", 12, 14], ["scriptsize", 14.4, 18], ["footnotesize", 17.28, 22],
  ["small", 20.74, 25], ["normalsize", 24.88, 30], ["large", 29.86, 37],
  ["Large", 35.83, 45], ["LARGE", 43, 54], ["huge", 51.6, 64],
  ["Huge", 61.92, 77], ["veryHuge", 74.3, 93], ["VeryHuge", 89.16, 112],
  ["VERYHuge", 107, 134],
] as const;

export type BeamerPosterFontSizeName = typeof BEAMER_POSTER_FONT_TABLE[number][0];

/** The commands beamerposter adds; the other ten redefine LaTeX's. */
export const BEAMER_POSTER_EXTRA_SIZE_COMMANDS = ["veryHuge", "VeryHuge", "VERYHuge"] as const;

/**
 * `fp`'s `round` to two places on a decimal product. The operands are short
 * decimals, so scale to integers before rounding instead of trusting the
 * binary product's last digit.
 */
export function beamerPosterRound2(a: string | number, b: string | number): number {
  const [aInt, aScale] = decimalParts(String(a));
  const [bInt, bScale] = decimalParts(String(b));
  const product = aInt * bInt;
  const scale = aScale + bScale;
  if (scale <= 2) return product * 10 ** (2 - scale) / 100;
  const divisor = 10n ** BigInt(scale - 2);
  const big = BigInt(product);
  const magnitude = big < 0n ? -big : big;
  let rounded = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) rounded += 1n;
  return Number(big < 0n ? -rounded : rounded) / 100;
}

function decimalParts(text: string): [number, number] {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?\s*$/u.exec(text);
  if (!match) return [Number.NaN, 0];
  const fraction = match[3] ?? "";
  const digits = `${match[2] ?? ""}${fraction}` || "0";
  return [Number(`${match[1] ?? ""}${digits}`), fraction.length];
}

/** Named sizes for a poster, as the package's redefinitions select them. */
export function beamerPosterFontSizes(fontScale: number): readonly (readonly [BeamerPosterFontSizeName, number, number])[] {
  return BEAMER_POSTER_FONT_TABLE.map(([name, size, skip]) =>
    [name, beamerPosterRound2(fontScale, size), beamerPosterRound2(fontScale, skip)] as const);
}

/**
 * List registers the package assigns once at load, in `em` of the font that
 * is current then (the class's normal size).
 */
export function beamerPosterListDimensionsEm(fontScale: number): {
  leftMarginEmByDepth: readonly [number, number, number];
  labelSepEm: number;
  labelWidthEm: number;
} {
  return {
    leftMarginEmByDepth: [beamerPosterRound2(4, fontScale), beamerPosterRound2(2.2, fontScale), beamerPosterRound2(1.87, fontScale)],
    labelSepEm: beamerPosterRound2(1, fontScale),
    labelWidthEm: beamerPosterRound2(1, fontScale),
  };
}

const settingsCache = new WeakMap<BeamerDocumentModel, BeamerPosterSettings | null>();
const scopedLoads = new WeakMap<BeamerDocumentModel, Span>();

/**
 * A load this preview does not execute: inside a macro, group or
 * conditional (ICML 2026's `\PosterWorkshop`). Reported so that the poster
 * is not silently shown as a slide.
 */
export function beamerPosterUnsupportedLoad(document: BeamerDocumentModel, context?: BeamerSyntaxContext): Diagnostic | null {
  if (scanBeamerPoster(document, context)) return null;
  const span = scopedLoads.get(document);
  return span ? { severity: "warning", code: "beamerposter-indirect-load", span,
    message: "beamerposter is loaded inside a macro, group or conditional; this preview shows the document as slides." } : null;
}

export function scanBeamerPoster(
  document: BeamerDocumentModel,
  context?: BeamerSyntaxContext
): BeamerPosterSettings | null {
  if (settingsCache.has(document)) return settingsCache.get(document) ?? null;
  const settings = /beamerposter/u.test(document.source.slice(document.preamble.span.from, document.preamble.span.to))
    ? scanUncached(document, context ?? createBeamerSyntaxContext(document.source))
    : null;
  settingsCache.set(document, settings);
  return settings;
}

function scanUncached(document: BeamerDocumentModel, context: BeamerSyntaxContext): BeamerPosterSettings | null {
  const limit = document.preamble.span.to;
  const controls = beamerControlSequencesIn(context, document.preamble.span);
  let found: { span: Span; options: BeamerOptionValue | null } | null = null;
  let loadIndex = -1;
  for (const [index, command] of controls.entries()) {
    if (command.name !== "usepackage" && command.name !== "RequirePackage") continue;
    const options = beamerOptionalArgumentAfter(context, command.to, limit);
    const names = beamerRequiredArgumentAfter(context, options?.span.to ?? command.to, limit);
    if (!names || !beamerSourceValueTokens(context, names).split(",").some(name => name.trim() === "beamerposter")) continue;
    if (preambleCommandScope(document, { from: command.from, to: command.to }, context) !== "top-level") {
      scopedLoads.set(document, { from: command.from, to: names.span.to });
      continue;
    }
    found = { span: { from: command.from, to: names.span.to }, options };
    loadIndex = index;
    break;
  }
  if (!found) return null;
  const loaded = found;
  const diagnostics: Diagnostic[] = [];
  const warn = (code: string, message: string, span: Span = loaded.span) =>
    diagnostics.push({ severity: "warning", code, message, span });

  let size: BeamerPosterSize = "a0";
  let portrait = false;
  let scale = "1.0";
  let width: string | null = null;
  let height: string | null = null;
  const entries = loaded.options
    ? parseOptionListRaw(document.source.slice(loaded.options.span.from, loaded.options.span.to), loaded.options.span.from).entries
    : [];
  for (const entry of entries) {
    if (entry.kind === "unknown") continue;
    const key = entry.key.trim();
    const value = entry.kind === "kv" ? unbrace(entry.valueRaw) : null;
    if (key === "size") {
      const choice = (value ?? "a0").toLowerCase();
      const known = POSTER_SIZES.find(candidate => candidate === choice);
      if (known) size = known;
      else warn("beamerposter-size-ignored", `beamerposter ignores the size "${value}".`, entry.span);
    } else if (key === "orientation") {
      const choice = (value ?? "portrait").toLowerCase();
      if (choice === "portrait") portrait = true;
      else if (choice === "landscape") portrait = false;
      else warn("beamerposter-orientation-ignored", `beamerposter ignores the orientation "${value}".`, entry.span);
    } else if (key === "scale") {
      scale = value ?? "1.0";
    } else if (key === "width") {
      width = value;
    } else if (key === "height") {
      height = value;
    } else if (key !== "debug" && key !== "grid" && key !== "printer") {
      warn("beamerposter-option-ignored", `beamerposter ignores the option "${key}".`, entry.span);
    }
  }

  const scaleNumber = Number(scale);
  if (!/^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*$/u.test(scale) || !Number.isFinite(scaleNumber)) {
    warn("beamerposter-scale-unsupported", `The beamerposter scale "${scale}" is not a number; this preview uses 1.0.`);
    scale = "1.0";
  }
  let paperCm: readonly [number, number];
  let sizeFontScale: string;
  if (size === "custom") {
    const w = width === null ? Number.NaN : Number(width);
    const h = height === null ? Number.NaN : Number(height);
    sizeFontScale = "1.0";
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      // Custom dimensions are assigned after the orientation swap.
      paperCm = [w, h];
    } else {
      warn("beamerposter-custom-size-unsupported", "A custom beamerposter size needs numeric width and height in cm; this preview uses A0.");
      size = "a0";
      const [pw, ph] = SIZES.a0;
      paperCm = portrait ? [ph, pw] : [pw, ph];
    }
  } else {
    const [pw, ph, fontScale] = SIZES[size];
    sizeFontScale = fontScale;
    paperCm = portrait ? [ph, pw] : [pw, ph];
  }
  const fontScale = beamerPosterRound2(scale, sizeFontScale);
  // \setlength{\paperwidth}{<value> cm}, scanned as TeX does.
  const cm = (value: number) => texScannedDimensionPt(String(value), "cm") ?? value * TEX_POINTS_PER_CM;
  const geometryPaper = { widthPt: cm(paperCm[0]), heightPt: cm(paperCm[1]) };

  // Later literal assignments change the page (and so the PDF page size)
  // but not the text width \geometry computed at package load.
  const paper = { ...geometryPaper };
  for (const command of controls.slice(loadIndex + 1)) {
    if (command.name !== "setlength") continue;
    const target = beamerRequiredArgumentAfter(context, command.to, limit);
    const register = target ? beamerSourceValueTokens(context, target).trim() : "";
    if (register !== "\\paperwidth" && register !== "\\paperheight") continue;
    const valueArg = target ? beamerRequiredArgumentAfter(context, target.span.to, limit) : null;
    const span = { from: command.from, to: valueArg?.span.to ?? command.to };
    if (preambleCommandScope(document, { from: command.from, to: command.to }, context) !== "top-level") continue;
    const literal = valueArg ? /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([A-Za-z]{2})\s*$/u.exec(beamerSourceValueTokens(context, valueArg)) : null;
    const length = literal ? texScannedDimensionPt(literal[1] ?? "", literal[2] ?? "") : null;
    if (length === null) {
      warn("beamerposter-paper-length-unsupported", "Only literal paper dimensions are supported in this preview.", span);
      continue;
    }
    if (register === "\\paperwidth") paper.widthPt = Number(length);
    else paper.heightPt = Number(length);
  }
  return { span: loaded.span, size, portrait, scale: Number(scale), fontScale, geometryPaper, paper, diagnostics };
}

type BeamerOptionValue = { span: Span; contentSpan: Span; value: string };

function unbrace(raw: string): string {
  const value = raw.trim();
  return value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1).trim() : value;
}

/**
 * Commands the package defines as macros: the three extra sizes, and
 * `\normalfont`, which it redefines as `\normalsize` (so it no longer resets
 * family, series or shape).
 */
export function beamerPosterMacroBindings(settings: BeamerPosterSettings | null): ReadonlyMap<string, MacroBinding> {
  if (!settings) return new Map();
  const sizes = new Map(beamerPosterFontSizes(settings.fontScale).map(([name, size, skip]) => [name, [size, skip] as const]));
  const bindings = new Map<string, MacroBinding>();
  for (const name of BEAMER_POSTER_EXTRA_SIZE_COMMANDS) {
    const [size, skip] = sizes.get(name) ?? [0, 0];
    bindings.set(`\\${name}`, { kind: "text", value: `\\fontsize{${size}}{${skip}}\\selectfont `, provenance: [] });
  }
  bindings.set("\\normalfont", { kind: "text", value: "\\normalsize ", provenance: [] });
  return bindings;
}
