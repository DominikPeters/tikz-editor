import { evaluateTexLengthExpression } from "../../text/tex/dimensions.js";
import type { TexDisplayMathLayoutProfile, TexListLayoutProfile } from "../../text/tex/layout-options.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import { beamerFontSizeProfile, beamerNamedFontSize } from "./font-sizes.js";
import type { BeamerThemeFont, ResolvedBeamerTheme } from "./types.js";
import { texLength } from "../../text/tex/coordinates.js";

/**
 * Spacing registers that theme and preamble code assigns directly: the list
 * registers of `\def\@listi`, `\@listii`, `\@listiii`, and the lengths
 * `\abovecaptionskip`, `\belowcaptionskip` and `\belowdisplayshortskip`.
 * Source order decides; the last definition wins.
 */
type Glue = { natural: string; stretch: string; shrink: string };
type RawListRegisters = Partial<Record<"topsep" | "partopsep" | "parsep" | "itemsep", Glue>>;
type RawSpacing = { lists: Array<RawListRegisters | undefined>; lengths: Map<string, string> };

const rawCache = new WeakMap<readonly { text: string }[], RawSpacing>();
const SPACING_LENGTHS = new Set(["abovecaptionskip", "belowcaptionskip", "belowdisplayshortskip"]);

function stripComments(text: string): string {
  return text.replace(/(^|[^\\])%[^\n]*/gu, "$1");
}

function balancedBody(text: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "\\") { index += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return text.slice(open + 1, index);
  }
  return null;
}

function parseGlue(value: string): Glue {
  const [natural = "", rest = ""] = value.split(/\bplus\b/u);
  const [stretch = "", shrinkFromPlus = ""] = rest.split(/\bminus\b/u);
  const [naturalOnly = "", shrinkFromNatural = ""] = natural.split(/\bminus\b/u);
  return { natural: naturalOnly.trim(), stretch: stretch.trim(), shrink: (shrinkFromPlus || shrinkFromNatural).trim() };
}

const LIST_REGISTERS = ["topsep", "partopsep", "parsep", "itemsep"] as const;
type ListRegisterName = (typeof LIST_REGISTERS)[number];
function isListRegister(name: string): name is ListRegisterName { return (LIST_REGISTERS as readonly string[]).includes(name); }
function listRegisterName(name: string): ListRegisterName { return isListRegister(name) ? name : "topsep"; }

function parseListBody(body: string): RawListRegisters {
  const normalized = body.replace(/\\@plus/gu, " plus ").replace(/\\@minus/gu, " minus ").replace(/(?<![\d.])\\p@/gu, "1pt ").replace(/\\p@/gu, "pt ");
  const result: RawListRegisters = {};
  const parts = normalized.split(/(\\(?:topsep|partopsep|parsep|itemsep|leftmargin|labelwidth|labelsep|itemindent|listparindent|rightmargin))(?![A-Za-z@])/u);
  for (let index = 1; index + 1 < parts.length; index += 2) {
    const name = (parts[index] ?? "").slice(1);
    const value = (parts[index + 1] ?? "").replace(/^\s*=?\s*/u, "").trim();
    if (!isListRegister(name)) continue;
    const aliasName = /^\\(topsep|partopsep|parsep|itemsep)\s*$/u.exec(value)?.[1];
    const glue = aliasName === undefined ? parseGlue(value) : result[listRegisterName(aliasName)];
    if (glue) result[name] = glue;
  }
  return result;
}

function rawSpacing(theme: ResolvedBeamerTheme): RawSpacing | null {
  const units = theme.interpreted?.units;
  if (!units) return null;
  const known = rawCache.get(units);
  if (known) return known;
  const result: RawSpacing = { lists: [undefined, undefined, undefined], lengths: new Map() };
  for (const unit of units) {
    const text = stripComments(unit.text);
    const definition = /\\(?:def|renewcommand\s*\{?)\s*\\@list(i{1,3})\s*\}?\s*(?=\{)/gu;
    for (let match = definition.exec(text); match; match = definition.exec(text)) {
      const body = balancedBody(text, definition.lastIndex);
      const depth = (match[1] ?? "i").length - 1;
      if (body !== null) result.lists[depth] = { ...result.lists[depth], ...parseListBody(body) };
    }
    const assignment = /\\setlength\s*\{?\\([A-Za-z@]+)\}?\s*\{([^{}]*)\}/gu;
    for (let match = assignment.exec(text); match; match = assignment.exec(text)) {
      if (SPACING_LENGTHS.has(match[1] ?? "")) result.lengths.set(match[1] ?? "", (match[2] ?? "").trim());
    }
  }
  rawCache.set(units, result);
  return result;
}

const unitCache = new WeakMap<BeamerThemeFont, { em: number; ex: number }>();
function fontUnits(font: BeamerThemeFont): { em: number; ex: number } {
  const known = unitCache.get(font);
  if (known) return known;
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  const units = { em: font.sizePt, ex: Math.round(Number(resolved.atPt) * resolved.data.fontdimen.xheight * 65_536) / 65_536 };
  unitCache.set(font, units);
  return units;
}

function noLength(): number | undefined { return; }

function evaluate(text: string, units: { em: number; ex: number }): number | null {
  return text === "" ? 0 : evaluateTexLengthExpression(text, noLength, units);
}

/** The document's `\normalsize` (beamerposter's, for posters): what `ex` and `em` mean where theme and preamble code assign lengths. */
function classFont(theme: ResolvedBeamerTheme): BeamerThemeFont {
  // Beamer applies its sans-serif font theme later: when theme files assign lengths, the font is Computer Modern roman.
  const { typeface: _typeface, ...normal } = theme.fonts["normal-text"];
  return { ...normal, family: "serif", series: "medium", shape: "upright", ...beamerNamedFontSize(beamerFontSizeProfile(theme), "normalsize") };
}

/** `\@listi`... registers of a theme, with `ex` and `em` taken in the list's own font. */
export function withThemeListRegisters(profile: TexListLayoutProfile, theme: ResolvedBeamerTheme): TexListLayoutProfile {
  const raw = rawSpacing(theme);
  if (!raw || raw.lists.every(entry => entry === undefined)) return profile;
  const units = fontUnits(theme.fonts["normal-text"]);
  const fields: Record<ListRegisterName, readonly [string, string, string]> = {
    topsep: ["topsepPtByDepth", "topsepStretchPtByDepth", "topsepShrinkPtByDepth"],
    partopsep: ["partopsepPtByDepth", "", ""],
    parsep: ["parsepPtByDepth", "parsepStretchPtByDepth", "parsepShrinkPtByDepth"],
    itemsep: ["itemsepPtByDepth", "itemsepStretchPtByDepth", "itemsepShrinkPtByDepth"],
  };
  const current = new Map<string, readonly number[] | undefined>(Object.entries(profile).map(([key, value]) => [key, Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number") : undefined]));
  const next: Record<string, number[]> = {};
  const read = (key: string): number[] => next[key] ??= [...(current.get(key) ?? profile.topsepPtByDepth.map(() => 0))];
  raw.lists.forEach((registers, depth) => {
    if (!registers) return;
    for (const name of LIST_REGISTERS) {
      const glue = registers[name];
      if (!glue) continue;
      const keys = fields[name];
      const values = [evaluate(glue.natural, units), evaluate(glue.stretch, units), evaluate(glue.shrink, units)];
      keys.forEach((key, slot) => { const value = values[slot]; if (key && value !== null && value !== undefined) read(key)[depth] = value; });
    }
  });
  return { ...profile, ...next, sizeOverrides: [] };
}

/** `\abovecaptionskip` and `\belowcaptionskip` in points, null when the theme leaves Beamer's 7pt. */
export function themeCaptionSkips(theme: ResolvedBeamerTheme | undefined): { above: number | null; below: number | null } {
  const raw = theme ? rawSpacing(theme) : null;
  if (!theme || !raw) return { above: null, below: null };
  const units = fontUnits(classFont(theme));
  const read = (name: string) => { const value = raw.lengths.get(name); return value === undefined ? null : evaluate(parseGlue(value).natural, units); };
  return { above: read("abovecaptionskip"), below: read("belowcaptionskip") };
}

/** `\belowdisplayshortskip` set by the theme (poster size commands keep it; decks' `\small` resets it). */
export function withThemeDisplaySkips(profile: TexDisplayMathLayoutProfile, theme: ResolvedBeamerTheme | undefined): TexDisplayMathLayoutProfile {
  const raw = theme ? rawSpacing(theme) : null;
  const text = raw?.lengths.get("belowdisplayshortskip");
  if (!theme || text === undefined) return profile;
  const value = evaluate(parseGlue(text).natural, fontUnits(classFont(theme)));
  if (value === null) return profile;
  const set = <T extends Pick<TexDisplayMathLayoutProfile, "below">>(entry: T): T => ({ ...entry, below: { ...entry.below, short: { sizePt: value, stretchPt: 0, shrinkPt: 0 } } });
  const poster = theme.options["poster-font-scale"] !== undefined;
  const overrides = profile.sizeOverrides;
  return { ...set(profile),
    ...(overrides ? { sizeOverrides: Object.fromEntries(Object.entries(overrides).map(([name, entry]) => [name, poster || name === "normalsize" ? set(entry) : entry])) } : {}) };
}

/** The first-level `\topsep` a theme's `\def\@listi` sets, in the list's font; null when it sets none. */
export function themeListTopsepPt(theme: ResolvedBeamerTheme | undefined, font: BeamerThemeFont): number | null {
  const natural = theme ? rawSpacing(theme)?.lists[0]?.topsep?.natural : undefined;
  return natural === undefined ? null : evaluate(natural, fontUnits(font));
}
