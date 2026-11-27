import { requireDefined } from "../../utils/invariants.js";
import type { OptionListAst } from "../../options/types.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { MacroBinding } from "../../macros/index.js";
import { expandForeachList } from "../../foreach/list.js";
import { parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import type { StyleChainEntry } from "../style-chain.js";
import { parseStyleValueAsOptionList } from "../../options/parse.js";
import { DEFAULT_PLOT_MARK_SIZE } from "./plot-marks.js";

export type PlotSettings = {
  handler:
    | "sharp"
    | "sharp-cycle"
    | "smooth"
    | "smooth-cycle"
    | "const-left"
    | "const-right"
    | "const-mid"
    | "jump-left"
    | "jump-right"
    | "jump-mid"
    | "ycomb"
    | "xcomb"
    | "polar-comb"
    | "ybar"
    | "xbar"
    | "ybar-interval"
    | "xbar-interval"
    | "only-marks";
  domainStart: number;
  domainEnd: number;
  samples: number;
  samplesAt: number[] | null;
  variable: string;
  mark: string | null;
  /** `mark size` (`\pgfplotmarksize`), pt. */
  markSize: number;
  /** `mark options` / `every mark`: null while unset, so a `\tikzset` definition still applies. */
  markOptions: OptionListAst[] | null;
  markRepeat: number;
  markPhase: number;
  /** `mark indices` (1-based stream positions), or null for `mark repeat`/`mark phase` selection. */
  markIndices: number[] | null;
  /** Raw `/pgf/mark color` value, or null while unset. */
  markColor: string | null;
  textMark: string;
  textMarkStyle: string;
  textMarkAsNode: boolean;
  tension: number;
  barWidth: number;
  barShift: number;
  barIntervalWidth: number;
  barIntervalShift: number;
};

export function createDefaultPlotSettings(): PlotSettings {
  return {
    handler: "sharp",
    domainStart: -5,
    domainEnd: 5,
    samples: 25,
    samplesAt: null,
    variable: "\\x",
    mark: null,
    markSize: DEFAULT_PLOT_MARK_SIZE,
    markOptions: null,
    markRepeat: 1,
    markPhase: 1,
    markIndices: null,
    markColor: null,
    textMark: "p",
    textMarkStyle: "",
    textMarkAsNode: false,
    tension: 0.55,
    barWidth: requireDefined(parseLength("10pt", "pt"), "Expected an internal plot value"),
    barShift: 0,
    barIntervalWidth: 1,
    barIntervalShift: 0.5
  };
}

export function applyPlotSettingsFromStyleChain(
  base: PlotSettings,
  styleChain: StyleChainEntry[],
  bindings: ReadonlyMap<string, MacroBinding>
): PlotSettings {
  let settings = { ...base };
  for (const layer of styleChain) {
    settings = applyPlotOptionLists(settings, layer.rawOptions, bindings);
  }
  return settings;
}

export function applyPlotOptionLists(
  base: PlotSettings,
  optionLists: OptionListAst[],
  bindings: ReadonlyMap<string, MacroBinding>
): PlotSettings {
  let settings = { ...base };
  for (const optionList of optionLists) {
    settings = applyPlotOptionList(settings, optionList, bindings);
  }
  return settings;
}

function applyPlotOptionList(
  base: PlotSettings,
  optionList: OptionListAst,
  bindings: ReadonlyMap<string, MacroBinding>
): PlotSettings {
  const settings = { ...base };
  for (const entry of optionList.entries) {
    if (entry.kind === "flag") {
      applyPlotFlag(settings, entry.key);
      continue;
    }

    if (entry.kind === "unknown") {
      continue;
    }

    const key = entry.key.toLowerCase().trim();
    const valueRaw = expandPlotOptionValue(entry.valueRaw, bindings);

    if (key === "domain") {
      const parsed = parsePlotDomain(valueRaw);
      if (parsed) {
        settings.domainStart = parsed.start;
        settings.domainEnd = parsed.end;
        settings.samplesAt = null;
      }
      continue;
    }

    if (key === "samples") {
      const parsed = parsePlotSamples(valueRaw);
      if (parsed != null) {
        settings.samples = parsed;
        settings.samplesAt = null;
      }
      continue;
    }

    if (key === "samples at") {
      const parsed = parsePlotSamplesAt(valueRaw);
      if (parsed.length > 0) {
        settings.samplesAt = parsed;
      }
      continue;
    }

    if (key === "variable") {
      const parsed = parsePlotVariable(valueRaw);
      if (parsed) {
        settings.variable = parsed;
      }
      continue;
    }

    if (key === "mark") {
      settings.mark = parsePlotMark(valueRaw);
      continue;
    }

    if (applyPlotMarkOption(settings, key, valueRaw, entry.valueRaw)) {
      continue;
    }

    if (key === "tension") {
      const parsed = parsePlotScalar(valueRaw);
      if (parsed != null && Number.isFinite(parsed)) {
        settings.tension = parsed;
      }
      continue;
    }

    if (key === "bar width") {
      const parsed = parsePlotLength(valueRaw, "pt");
      if (parsed != null && Number.isFinite(parsed)) {
        settings.barWidth = parsed;
      }
      continue;
    }

    if (key === "bar shift") {
      const parsed = parsePlotLength(valueRaw, "pt");
      if (parsed != null && Number.isFinite(parsed)) {
        settings.barShift = parsed;
      }
      continue;
    }

    if (key === "bar interval width") {
      const parsed = parsePlotScalar(valueRaw);
      if (parsed != null && Number.isFinite(parsed)) {
        settings.barIntervalWidth = parsed;
      }
      continue;
    }

    if (key === "bar interval shift") {
      const parsed = parsePlotScalar(valueRaw);
      if (parsed != null && Number.isFinite(parsed)) {
        settings.barIntervalShift = parsed;
      }
    }
  }

  return settings;
}

function applyPlotFlag(settings: PlotSettings, rawKey: string): void {
  const key = rawKey.toLowerCase().trim();
  if (key === "smooth") {
    settings.handler = "smooth";
    return;
  }
  if (key === "smooth cycle") {
    settings.handler = "smooth-cycle";
    return;
  }
  if (key === "sharp plot") {
    settings.handler = "sharp";
    return;
  }
  if (key === "sharp cycle") {
    settings.handler = "sharp-cycle";
    return;
  }
  if (key === "const plot" || key === "const plot mark left") {
    settings.handler = "const-left";
    return;
  }
  if (key === "const plot mark right") {
    settings.handler = "const-right";
    return;
  }
  if (key === "const plot mark mid") {
    settings.handler = "const-mid";
    return;
  }
  if (key === "jump mark left") {
    settings.handler = "jump-left";
    return;
  }
  if (key === "jump mark right") {
    settings.handler = "jump-right";
    return;
  }
  if (key === "jump mark mid") {
    settings.handler = "jump-mid";
    return;
  }
  if (key === "ycomb") {
    settings.handler = "ycomb";
    return;
  }
  if (key === "xcomb") {
    settings.handler = "xcomb";
    return;
  }
  if (key === "polar comb") {
    settings.handler = "polar-comb";
    return;
  }
  if (key === "ybar") {
    settings.handler = "ybar";
    return;
  }
  if (key === "xbar") {
    settings.handler = "xbar";
    return;
  }
  if (key === "ybar interval") {
    settings.handler = "ybar-interval";
    return;
  }
  if (key === "xbar interval") {
    settings.handler = "xbar-interval";
    return;
  }
  if (key === "only marks") {
    settings.handler = "only-marks";
    return;
  }
  if (key === "no marks" || key === "no markers") {
    settings.mark = null;
    return;
  }
  if (key === "text mark as node" || key === "/pgf/text mark as node") {
    settings.textMarkAsNode = true;
  }
}

/** Keys of `\tikz@plot@mark` and friends (tikz.code.tex) and of the plotmarks library. */
function applyPlotMarkOption(settings: PlotSettings, key: string, valueRaw: string, unexpandedRaw: string): boolean {
  const pgfKey = key.startsWith("/pgf/") ? key.slice("/pgf/".length) : key.startsWith("/tikz/") ? key.slice("/tikz/".length) : key;
  switch (pgfKey) {
    case "mark size": {
      const parsed = parsePlotLength(valueRaw, "pt");
      if (parsed != null && Number.isFinite(parsed)) settings.markSize = parsed;
      return true;
    }
    case "mark options":
    case "every mark/.style": {
      const list = parseStyleValueAsOptionList(unexpandedRaw);
      settings.markOptions = list ? [list] : [];
      return true;
    }
    case "every mark/.append style": {
      const list = parseStyleValueAsOptionList(unexpandedRaw);
      if (list) settings.markOptions = [...(settings.markOptions ?? []), list];
      return true;
    }
    case "mark repeat": {
      const parsed = parsePlotScalar(valueRaw);
      if (parsed != null && Number.isFinite(parsed)) settings.markRepeat = Math.trunc(parsed);
      return true;
    }
    case "mark phase": {
      const parsed = parsePlotScalar(valueRaw);
      if (parsed != null && Number.isFinite(parsed)) settings.markPhase = Math.trunc(parsed);
      return true;
    }
    case "mark indices": {
      const normalized = stripBalancedOuterBraces(valueRaw);
      settings.markIndices = normalized.length === 0 ? null : parsePlotSamplesAt(normalized).map((value) => Math.round(value));
      return true;
    }
    case "mark color": {
      const normalized = stripBalancedOuterBraces(valueRaw);
      settings.markColor = normalized.length === 0 ? null : normalized;
      return true;
    }
    case "text mark":
      settings.textMark = stripBalancedOuterBraces(valueRaw);
      return true;
    case "text mark style":
      settings.textMarkStyle = stripBalancedOuterBraces(valueRaw);
      return true;
    case "text mark as node":
      settings.textMarkAsNode = stripBalancedOuterBraces(valueRaw).toLowerCase() !== "false";
      return true;
    default:
      return false;
  }
}

function parsePlotDomain(raw: string): { start: number; end: number } | null {
  const normalized = stripBalancedOuterBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const split = splitTopLevelOnce(normalized, ":");
  if (!split) {
    return null;
  }

  const start = parsePlotScalar(split.left);
  const end = parsePlotScalar(split.right);
  if (start == null || end == null) {
    return null;
  }
  return { start, end };
}

function parsePlotSamples(raw: string): number | null {
  const scalar = parsePlotScalar(raw);
  if (scalar == null) {
    return null;
  }
  if (!Number.isFinite(scalar)) {
    return null;
  }
  return Math.max(2, Math.round(scalar));
}

function parsePlotSamplesAt(raw: string): number[] {
  const expanded = expandForeachList(stripBalancedOuterBraces(raw), { parseExpressions: true });
  const values: number[] = [];
  for (const candidate of expanded) {
    const parsed = parsePlotScalar(candidate);
    if (parsed == null || !Number.isFinite(parsed)) {
      continue;
    }
    values.push(parsed);
  }
  return values;
}

function parsePlotVariable(raw: string): string | null {
  const normalized = stripBalancedOuterBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.startsWith("\\")) {
    return normalized;
  }
  return `\\${normalized}`;
}

function parsePlotMark(raw: string): string | null {
  // \tikz@plot@mark: `mark=none` switches marks off; names are case- and space-sensitive.
  const normalized = stripBalancedOuterBraces(raw).trim();
  return normalized.length > 0 && normalized !== "none" ? normalized : null;
}

function parsePlotLength(raw: string, defaultUnit: "cm" | "pt"): number | null {
  const normalized = stripBalancedOuterBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }
  return parseLength(normalized, defaultUnit);
}

function parsePlotScalar(raw: string): number | null {
  const normalized = stripBalancedOuterBraces(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const parsed = parseQuantityExpression(normalized);
  if (parsed?.kind === "scalar" && Number.isFinite(parsed.value)) {
    return parsed.value;
  }

  const asNumber = Number(normalized);
  return Number.isFinite(asNumber) ? asNumber : null;
}

export function resolvePlotSampleValues(settings: PlotSettings): number[] {
  if (settings.samplesAt && settings.samplesAt.length > 0) {
    return [...settings.samplesAt];
  }

  const count = Math.max(2, Math.round(settings.samples));
  if (count <= 2) {
    return [settings.domainStart, settings.domainEnd];
  }

  const diff = (settings.domainEnd - settings.domainStart) / (count - 1);
  if (!Number.isFinite(diff)) {
    return [settings.domainStart, settings.domainEnd];
  }
  if (Math.abs(diff) <= 1e-12) {
    return [settings.domainStart, settings.domainEnd];
  }

  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    values.push(settings.domainStart + diff * index);
  }
  values[count - 1] = settings.domainEnd;
  return values;
}

export function formatPlotSampleValue(value: number): string {
  if (Math.abs(value) <= 1e-12) {
    return "0";
  }
  if (Math.abs(value - Math.round(value)) <= 1e-9) {
    return String(Math.round(value));
  }
  return value
    .toFixed(12)
    .replace(/\.?0+$/, "")
    .replace(/^-0$/, "0");
}

function expandPlotOptionValue(raw: string, bindings: ReadonlyMap<string, MacroBinding>): string {
  if (raw.length === 0) {
    return raw;
  }
  return expandMacroBindings(raw, bindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH
  });
}

function stripBalancedOuterBraces(raw: string): string {
  let normalized = raw.trim();
  while (normalized.startsWith("{") && normalized.endsWith("}") && normalized.length >= 2) {
    const unwrapped = unwrapSingleOuterBracePair(normalized);
    if (!unwrapped) {
      break;
    }
    normalized = unwrapped.trim();
  }
  return normalized;
}

function unwrapSingleOuterBracePair(raw: string): string | null {
  if (!(raw.startsWith("{") && raw.endsWith("}"))) {
    return null;
  }

  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return null;
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  if (depth !== 0) {
    return null;
  }
  return raw.slice(1, -1);
}

function splitTopLevelOnce(input: string, separator: string): { left: string; right: string } | null {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === separator && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return {
        left: input.slice(0, index).trim(),
        right: input.slice(index + 1).trim()
      };
    }
  }

  return null;
}
