import { parseOptionListRaw } from "../../options/parse.js";
import { parseLength } from "../coords/parse-length.js";
import type { ArrowMarker, ArrowTip, ArrowTipKind, ResolvedStyle, TipsMode } from "../types.js";
import { ARROW_NAME_ALIASES, DEFAULT_ARROW_LENGTH, DEFAULT_ARROW_WIDTH, NAMED_COLORS } from "./constants.js";
import { normalizeColor } from "./colors.js";
import { findTopLevelCharacter, readBalancedBlock, readOptionalBracketOptions, stripEnclosingBraces } from "./option-utils.js";

const EPSILON = 1e-6;

// From /pgf/arrow keys/sep default in pgfcorearrows.code.tex.
const DEFAULT_SEP_BASE_PT = 0.88;
const DEFAULT_SEP_LINE_FACTOR = 0.3;

// From Latex/Stealth defaults in pgflibraryarrows.meta.code.tex.
const DEFAULT_GEOMETRIC_LENGTH_BASE_PT = 3;
const DEFAULT_GEOMETRIC_LENGTH_LINE_FACTOR = 4.5;
const DEFAULT_GEOMETRIC_WIDTH_FACTOR = 0.75;
const DEFAULT_STEALTH_INSET_FACTOR = 0.325;
const DEFAULT_KITE_LENGTH_BASE_PT = 3.6;
const DEFAULT_KITE_LENGTH_LINE_FACTOR = 5.4;
const DEFAULT_KITE_WIDTH_FACTOR = 0.5;
const DEFAULT_KITE_INSET_FACTOR = 0.25;

export function parseTipsMode(raw: string): TipsMode | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized.length === 0) {
    return "true";
  }
  if (normalized === "proper") {
    return "proper";
  }
  if (normalized === "on draw") {
    return "on draw";
  }
  if (normalized === "on proper draw") {
    return "on proper draw";
  }
  if (normalized === "false" || normalized === "never") {
    return "never";
  }
  return null;
}

export function parseArrowSpecification(raw: string, style: ResolvedStyle): { start: ArrowMarker | null; end: ArrowMarker | null } | null {
  const trimmed = stripEnclosingBraces(raw.trim());
  if (!trimmed.includes("-")) {
    return null;
  }

  const splitIndex = findTopLevelCharacter(trimmed, "-");
  if (splitIndex < 0) {
    return null;
  }

  const startRaw = trimmed.slice(0, splitIndex).trim();
  const endRaw = trimmed.slice(splitIndex + 1).trim();
  const start = parseArrowSideSpecification(startRaw, "start", style);
  const end = parseArrowSideSpecification(endRaw, "end", style);

  return {
    start,
    end
  };
}

export function parseArrowSideSpecification(raw: string, side: "start" | "end", style: ResolvedStyle): ArrowMarker | null {
  const input = stripEnclosingBraces(raw.trim());
  if (input.length === 0) {
    return null;
  }

  const tips: ArrowTip[] = [];
  let afterLineEnd = false;
  let cursor = 0;
  while (cursor < input.length) {
    while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
      cursor += 1;
    }
    if (cursor >= input.length) {
      break;
    }

    const char = input[cursor];
    if (char === ".") {
      afterLineEnd = true;
      cursor += 1;
      continue;
    }

    if (char === "{") {
      const group = readBalancedBlock(input, cursor, "{", "}");
      if (!group) {
        break;
      }
      // Handle translation/reversal at this level only.
      const nested = parseArrowSideSpecification(group.content, "end", style);
      if (nested) {
        tips.push(
          ...nested.tips.map((tip) => ({
            ...cloneArrowTip(tip),
            afterLineEnd: afterLineEnd || tip.afterLineEnd
          }))
        );
      }
      cursor = group.nextIndex;
      continue;
    }

    if (char === "_") {
      cursor += 1;
      if (tips.length > 0) {
        const last = tips[tips.length - 1];
        if (last) {
          tips[tips.length - 1] = { ...last, sep: parseDefaultArrowSep(style.lineWidth) };
        }
      }
      continue;
    }

    if (char === ">" || char === "<" || char === "|") {
      cursor += 1;
      const optionBlock = readOptionalBracketOptions(input, cursor);
      cursor = optionBlock.nextIndex;
      const baseTips = expandArrowSymbol(char, side, style);
      for (const tip of baseTips) {
        tips.push({
          ...applyArrowTipOptions(tip, optionBlock.optionsRaw, style.lineWidth),
          afterLineEnd
        });
      }
      continue;
    }

    const named = readArrowNamedTip(input, cursor);
    if (!named) {
      cursor += 1;
      continue;
    }
    cursor = named.nextIndex;
    const optionBlock = readOptionalBracketOptions(input, cursor);
    cursor = optionBlock.nextIndex;
    const tip = applyArrowTipOptions(makeDefaultArrowTip(resolveArrowTipKind(named.name), style.lineWidth), optionBlock.optionsRaw, style.lineWidth);
    tips.push({ ...tip, afterLineEnd });
  }

  if (tips.length === 0) {
    return null;
  }

  if (side === "start") {
    tips.reverse();
  }
  return { tips };
}

function expandArrowSymbol(symbol: ">" | "<" | "|", _side: "start" | "end", style: ResolvedStyle): ArrowTip[] {
  if (symbol === "|") {
    return [makeDefaultArrowTip("bar", style.lineWidth)];
  }

  if (symbol === "<") {
    if (style.arrowShorthandStart.tips.length > 0) {
      return style.arrowShorthandStart.tips.map(cloneArrowTip);
    }
    if (style.arrowShorthandEnd.tips.length > 0) {
      return style.arrowShorthandEnd.tips.map(cloneArrowTip);
    }
    return [makeDefaultArrowTip("cm-rightarrow", style.lineWidth)];
  }

  if (style.arrowShorthandEnd.tips.length > 0) {
    return style.arrowShorthandEnd.tips.map(cloneArrowTip);
  }
  return [makeDefaultArrowTip("cm-rightarrow", style.lineWidth)];
}

function resolveArrowTipKind(rawName: string): ArrowTipKind {
  const normalized = rawName.trim().toLowerCase();
  for (const alias of ARROW_NAME_ALIASES) {
    if (normalized === alias.name) {
      return alias.kind;
    }
  }
  if (normalized.includes("stealth")) {
    return "stealth";
  }
  if (normalized.includes("latex")) {
    return "latex";
  }
  if (normalized.includes("kite") || normalized.includes("diamond")) {
    return "kite";
  }
  if (normalized.includes("square") || normalized.includes("rectangle")) {
    return "square";
  }
  if (normalized.includes("circle") || normalized.includes("ellipse")) {
    return "circle";
  }
  if (normalized.includes("rays") || normalized.includes("ray")) {
    return "rays";
  }
  if (normalized.includes("parenthesis") || normalized.includes("arc barb")) {
    return "arc-barb";
  }
  if (normalized.includes("bracket") || normalized.includes("tee barb")) {
    return "tee-barb";
  }
  if (normalized.includes("butt cap")) {
    return "butt-cap";
  }
  if (normalized.includes("round cap") || normalized.includes("fast round")) {
    return "round-cap";
  }
  if (normalized.includes("triangle cap") || normalized.includes("fast triangle")) {
    return "triangle-cap";
  }
  if (normalized.includes("triangle")) {
    return "triangle";
  }
  if (normalized.includes("straight barb")) {
    return "straight-barb";
  }
  if (normalized.includes("hook")) {
    return "hooks";
  }
  if (normalized.includes("bar")) {
    return "bar";
  }
  if (normalized.includes("implies")) {
    return "implies";
  }
  if (normalized.includes("rightarrow") || normalized === ">" || normalized === "<") {
    return "cm-rightarrow";
  }
  if (normalized === "to") {
    return "to";
  }
  if (normalized.includes("to")) {
    return "cm-rightarrow";
  }
  return "to";
}

export function makeDefaultArrowMarker(kind: ArrowTipKind, lineWidth = 0.4): ArrowMarker {
  return { tips: [makeDefaultArrowTip(kind, lineWidth)] };
}

function makeDefaultArrowTip(kind: ArrowTipKind, lineWidth = 0.4): ArrowTip {
  const baseLineWidth = normalizeArrowLineWidth(lineWidth);

  if (kind === "cm-rightarrow") {
    // Based on pgflibraryarrows.meta.code.tex (Computer Modern Rightarrow defaults + setup code).
    const nominalLength = 1.6 + 2.2 * baseLineWidth;
    const nominalWidth = nominalLength * 2.096774;
    return {
      kind,
      open: true,
      round: true,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: "none",
      length: Math.max(1, nominalLength - baseLineWidth),
      width: Math.max(1, nominalWidth - baseLineWidth),
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "latex") {
    return buildLatexTip(DEFAULT_GEOMETRIC_LENGTH_BASE_PT + DEFAULT_GEOMETRIC_LENGTH_LINE_FACTOR * baseLineWidth, null, baseLineWidth);
  }

  if (kind === "stealth") {
    const nominalLength = DEFAULT_GEOMETRIC_LENGTH_BASE_PT + DEFAULT_GEOMETRIC_LENGTH_LINE_FACTOR * baseLineWidth;
    return buildStealthTip(nominalLength, null, null, baseLineWidth);
  }

  if (kind === "kite") {
    const nominalLength = DEFAULT_KITE_LENGTH_BASE_PT + DEFAULT_KITE_LENGTH_LINE_FACTOR * baseLineWidth;
    return buildKiteTip(nominalLength, null, null, baseLineWidth);
  }

  if (kind === "bar") {
    return {
      kind,
      open: true,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: "none",
      length: 4,
      width: 8,
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "hooks") {
    return {
      kind,
      open: true,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: "none",
      length: 7,
      width: 8,
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: 180,
      rayCount: null
    };
  }

  if (kind === "straight-barb") {
    const nominalLength = 1.5 + 2 * baseLineWidth;
    return {
      kind,
      open: true,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: "none",
      length: Math.max(1, nominalLength),
      width: Math.max(1, nominalLength * 1.8),
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "arc-barb") {
    const nominalLength = 1.5 + 2 * baseLineWidth;
    return {
      kind,
      open: true,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: "none",
      length: Math.max(1, nominalLength),
      width: Math.max(1, nominalLength * 1.4),
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: 180,
      rayCount: null
    };
  }

  if (kind === "tee-barb") {
    const nominalLength = 1.5 + 2 * baseLineWidth;
    return {
      kind,
      open: true,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: "none",
      length: Math.max(1, nominalLength),
      width: Math.max(1, 3 + 4 * baseLineWidth),
      inset: Math.max(0, nominalLength * 0.5),
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "square") {
    const nominalLength = 2.12132 + 2.828427 * baseLineWidth;
    return {
      kind,
      open: false,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: null,
      length: Math.max(0.01, nominalLength),
      width: Math.max(0.01, nominalLength),
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "circle") {
    const nominalLength = 2.39365 + 3.191538 * baseLineWidth;
    return {
      kind,
      open: false,
      round: true,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: null,
      length: Math.max(0.01, nominalLength),
      width: Math.max(0.01, nominalLength),
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "rays") {
    const nominalLength = 3 + 4 * baseLineWidth;
    return {
      kind,
      open: true,
      round: true,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: "none",
      length: Math.max(1, nominalLength),
      width: Math.max(1, nominalLength),
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: 4
    };
  }

  if (kind === "round-cap" || kind === "butt-cap" || kind === "triangle-cap") {
    return {
      kind,
      open: false,
      round: kind === "round-cap",
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: null,
      length: Math.max(0.01, 0.5 * baseLineWidth),
      width: Math.max(0.01, baseLineWidth),
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "triangle") {
    return {
      kind,
      open: false,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: null,
      length: 8,
      width: 8,
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  if (kind === "implies") {
    return {
      kind,
      open: false,
      round: false,
      reversed: false,
      bend: false,
      afterLineEnd: false,
      color: null,
      fill: null,
      length: 9,
      width: 7,
      inset: null,
      sep: 0,
      lineWidth: baseLineWidth,
      arc: null,
      rayCount: null
    };
  }

  return {
    kind,
    open: false,
    round: false,
    reversed: false,
    bend: false,
    afterLineEnd: false,
    color: null,
    fill: null,
    length: DEFAULT_ARROW_LENGTH,
    width: DEFAULT_ARROW_WIDTH,
    inset: null,
    sep: 0,
    lineWidth: baseLineWidth,
    arc: null,
    rayCount: null
  };
}

function normalizeArrowLineWidth(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0.4;
}

function buildLatexTip(nominalLength: number, nominalWidth: number | null, requestedLineWidth: number): ArrowTip {
  const length = Math.max(1, nominalLength);
  const width = Math.max(1, nominalWidth ?? length * DEFAULT_GEOMETRIC_WIDTH_FACTOR);
  // Cap line width at one fifth of the length.
  const lineWidth = Math.max(0, Math.min(normalizeArrowLineWidth(requestedLineWidth), 0.2 * length));

  return {
    kind: "latex",
    open: false,
    round: false,
    reversed: false,
    bend: false,
    afterLineEnd: false,
    color: null,
    fill: null,
    length: Math.max(1, length),
    width,
    inset: null,
    sep: 0,
    lineWidth,
    arc: null,
    rayCount: null
  };
}

function buildStealthTip(
  nominalLength: number,
  nominalWidth: number | null,
  nominalInset: number | null,
  requestedLineWidth: number
): ArrowTip {
  const length = Math.max(1, nominalLength);
  const width = Math.max(1, nominalWidth ?? length * DEFAULT_GEOMETRIC_WIDTH_FACTOR);
  const inset = Math.max(0, nominalInset ?? length * DEFAULT_STEALTH_INSET_FACTOR);

  // Cap line width at one quarter of distance from inset to tip.
  const maxLineWidth = 0.25 * Math.max(0, length - inset);
  const lineWidth = Math.max(0, Math.min(normalizeArrowLineWidth(requestedLineWidth), maxLineWidth));

  return {
    kind: "stealth",
    open: false,
    round: false,
    reversed: false,
    bend: false,
    afterLineEnd: false,
    color: null,
    fill: null,
    length,
    width,
    inset,
    sep: 0,
    lineWidth,
    arc: null,
    rayCount: null
  };
}

function buildKiteTip(
  nominalLength: number,
  nominalWidth: number | null,
  nominalInset: number | null,
  requestedLineWidth: number
): ArrowTip {
  const length = Math.max(1, nominalLength);
  const width = Math.max(1, nominalWidth ?? length * DEFAULT_KITE_WIDTH_FACTOR);
  const inset = Math.max(0, nominalInset ?? length * DEFAULT_KITE_INSET_FACTOR);
  const maxLineWidth = Math.min(0.4 * length, 0.4 * width);
  const lineWidth = Math.max(0, Math.min(normalizeArrowLineWidth(requestedLineWidth), maxLineWidth));

  return {
    kind: "kite",
    open: false,
    round: false,
    reversed: false,
    bend: false,
    afterLineEnd: false,
    color: null,
    fill: null,
    length,
    width,
    inset: Math.min(length - EPSILON, inset),
    sep: 0,
    lineWidth,
    arc: null,
    rayCount: null
  };
}

export function cloneArrowMarker(marker: ArrowMarker): ArrowMarker {
  return { tips: marker.tips.map(cloneArrowTip) };
}

function cloneArrowTip(tip: ArrowTip): ArrowTip {
  return { ...tip };
}

function applyArrowTipOptions(base: ArrowTip, optionsRaw: string | null, contextLineWidth: number): ArrowTip {
  if (!optionsRaw || optionsRaw.trim().length === 0) {
    return base;
  }

  const normalizedContextLineWidth = normalizeArrowLineWidth(contextLineWidth);
  const options = parseOptionListRaw(`[${optionsRaw}]`);
  let tip: ArrowTip = { ...base };
  let length = tip.length;
  let width = tip.width;
  let sep = tip.sep;
  let lineWidth = tip.lineWidth ?? normalizedContextLineWidth;
  let inset = tip.inset ?? 0;

  // Geometric tips use nominal values and recompute miter-corrected dimensions.
  let nominalLength = DEFAULT_GEOMETRIC_LENGTH_BASE_PT + DEFAULT_GEOMETRIC_LENGTH_LINE_FACTOR * normalizedContextLineWidth;
  let nominalWidth = nominalLength * DEFAULT_GEOMETRIC_WIDTH_FACTOR;
  let nominalInset = nominalLength * DEFAULT_STEALTH_INSET_FACTOR;
  let widthExplicit = false;
  let insetExplicit = false;
  const isGeometricMetaTip = tip.kind === "stealth" || tip.kind === "latex" || tip.kind === "kite";
  if (!isGeometricMetaTip) {
    nominalLength = length;
    nominalWidth = width;
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      const key = entry.key;
      if (key === "open") {
        tip = { ...tip, open: true, fill: "none" };
        continue;
      }
      if (key === "round") {
        tip = { ...tip, round: true };
        continue;
      }
      if (key === "sharp") {
        tip = { ...tip, round: false };
        continue;
      }
      if (key === "reversed") {
        tip = { ...tip, reversed: !tip.reversed };
        continue;
      }
      if (key === "bend" || key === "flex") {
        tip = { ...tip, bend: true };
        continue;
      }
      if (key === "sep") {
        sep = parseDefaultArrowSep(normalizedContextLineWidth);
        continue;
      }
      if (NAMED_COLORS.has(key) || key.includes("!") || key.startsWith("#")) {
        tip = { ...tip, color: normalizeColor(key) };
        continue;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    const key = entry.key;
    if (key === "length") {
      const parsed = parseArrowDimension(entry.valueRaw, normalizedContextLineWidth);
      if (parsed != null && parsed >= 0) {
        if (isGeometricMetaTip) {
          nominalLength = parsed;
        } else {
          length = parsed;
        }
      }
      continue;
    }
    if (key === "width" || key === "width'") {
      const parsed = parseArrowDimension(entry.valueRaw, normalizedContextLineWidth);
      if (parsed != null && parsed >= 0) {
        if (isGeometricMetaTip) {
          nominalWidth = parsed;
          widthExplicit = true;
        } else {
          width = parsed;
        }
      }
      continue;
    }
    if (key === "inset" || key === "inset'") {
      const parsed = parseArrowDimension(entry.valueRaw, normalizedContextLineWidth);
      if (parsed != null && parsed >= 0) {
        if (isGeometricMetaTip) {
          nominalInset = parsed;
          insetExplicit = true;
        } else {
          inset = parsed;
          insetExplicit = true;
        }
      }
      continue;
    }
    if (key === "arc") {
      const parsed = parseArrowFactor(entry.valueRaw);
      if (parsed != null && Number.isFinite(parsed)) {
        tip = { ...tip, arc: parsed };
      }
      continue;
    }
    if (key === "n") {
      const parsed = parseArrowFactor(entry.valueRaw);
      if (parsed != null && parsed >= 1) {
        tip = { ...tip, rayCount: Math.max(1, Math.round(parsed)) };
      }
      continue;
    }
    if (key === "scale") {
      const factor = parseArrowFactor(entry.valueRaw);
      if (factor != null && factor >= 0) {
        if (isGeometricMetaTip) {
          nominalLength *= factor;
          nominalWidth *= factor;
          nominalInset *= factor;
        } else {
          length *= factor;
          width *= factor;
          inset *= factor;
        }
      }
      continue;
    }
    if (key === "scale length") {
      const factor = parseArrowFactor(entry.valueRaw);
      if (factor != null && factor >= 0) {
        if (isGeometricMetaTip) {
          nominalLength *= factor;
        } else {
          length *= factor;
          inset *= factor;
        }
      }
      continue;
    }
    if (key === "scale width") {
      const factor = parseArrowFactor(entry.valueRaw);
      if (factor != null && factor >= 0) {
        if (isGeometricMetaTip) {
          nominalWidth *= factor;
          widthExplicit = true;
        } else {
          width *= factor;
        }
      }
      continue;
    }
    if (key === "line width" || key === "line width'") {
      const parsed = parseArrowDimension(entry.valueRaw, normalizedContextLineWidth);
      if (parsed != null && parsed >= 0) {
        lineWidth = parsed;
      }
      continue;
    }
    if (key === "sep") {
      const parsed = parseArrowDimension(entry.valueRaw, normalizedContextLineWidth);
      if (parsed != null && parsed >= 0) {
        sep = parsed;
      }
      continue;
    }
    if (key === "color") {
      tip = { ...tip, color: normalizeColor(entry.valueRaw) };
      continue;
    }
    if (key === "fill") {
      const fill = normalizeColor(entry.valueRaw);
      tip = { ...tip, fill, open: fill === "none" ? true : tip.open };
      continue;
    }
  }

  if (isGeometricMetaTip) {
    if (!widthExplicit) {
      nominalWidth = nominalLength * (tip.kind === "kite" ? DEFAULT_KITE_WIDTH_FACTOR : DEFAULT_GEOMETRIC_WIDTH_FACTOR);
    }
    if (!insetExplicit) {
      nominalInset = nominalLength * (tip.kind === "kite" ? DEFAULT_KITE_INSET_FACTOR : DEFAULT_STEALTH_INSET_FACTOR);
    }

    if (tip.kind === "stealth") {
      const stealth = buildStealthTip(nominalLength, nominalWidth, nominalInset, lineWidth);
      tip = {
        ...tip,
        length: stealth.length,
        width: stealth.width,
        inset: stealth.inset,
        lineWidth: stealth.lineWidth
      };
    } else if (tip.kind === "kite") {
      const kite = buildKiteTip(nominalLength, nominalWidth, nominalInset, lineWidth);
      tip = {
        ...tip,
        length: kite.length,
        width: kite.width,
        inset: kite.inset,
        lineWidth: kite.lineWidth
      };
    } else {
      const latex = buildLatexTip(nominalLength, nominalWidth, lineWidth);
      tip = {
        ...tip,
        length: latex.length,
        width: latex.width,
        lineWidth: latex.lineWidth
      };
    }
  } else {
    tip = {
      ...tip,
      length: Math.max(0, length),
      width: Math.max(0, width),
      inset: (tip.kind === "tee-barb" || tip.kind === "bar") && !insetExplicit
        ? 0.5 * length
        : tip.inset == null && inset <= EPSILON ? null : Math.max(0, inset),
      lineWidth: Math.max(0, lineWidth)
    };
  }

  if (tip.open && tip.fill !== "none") {
    tip = { ...tip, fill: "none" };
  }

  return {
    ...tip,
    sep: Math.max(0, sep)
  };
}

function parseArrowDimension(raw: string, contextLineWidth: number): number | null {
  const parsed = parseArrowDimensionSpec(raw);
  if (!parsed) {
    return null;
  }
  return parsed.base + parsed.lineFactor * contextLineWidth;
}

function parseArrowDimensionSpec(raw: string): { base: number; lineFactor: number } | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }

  const base = parseLength(tokens[0] ?? "", "pt");
  if (base == null) {
    return null;
  }
  const lineFactor = tokens.length >= 2 ? parseArrowNumber(tokens[1]) ?? 0 : 0;
  return { base, lineFactor };
}

function parseArrowNumber(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseArrowFactor(raw: string): number | null {
  const primaryToken = raw.trim().split(/\s+/)[0];
  if (!primaryToken) {
    return null;
  }
  const parsed = Number(primaryToken);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDefaultArrowSep(lineWidth: number): number {
  return DEFAULT_SEP_BASE_PT + DEFAULT_SEP_LINE_FACTOR * normalizeArrowLineWidth(lineWidth);
}

function readArrowNamedTip(input: string, startIndex: number): { name: string; nextIndex: number } | null {
  let cursor = startIndex;
  while (cursor < input.length) {
    const char = input[cursor] ?? "";
    if (char === "[" || char === "." || char === "{" || char === "}" || char === "_" || char === ">" || char === "<" || char === "|") {
      break;
    }
    cursor += 1;
  }

  const name = input.slice(startIndex, cursor).trim();
  if (name.length === 0) {
    return null;
  }

  return {
    name,
    nextIndex: cursor
  };
}
