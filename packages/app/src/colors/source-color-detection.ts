import type { Tree } from "@lezer/common";
import { parseOptionListRaw } from "tikz-editor/options/parse";
import type { OptionEntry, OptionListAst } from "tikz-editor/options/types";
import { normalizeColor, resolveDefineColorModel } from "tikz-editor/semantic/style/colors";
import { parseStyleValueAsOptionList, readBalancedBlock } from "tikz-editor/semantic/style/option-utils";

export type SourceRange = {
  from: number;
  to: number;
};

export type DetectedColorOccurrence = {
  from: number;
  to: number;
  token: string;
  cssColor: string | null;
  editable: boolean;
  source: "option-value" | "option-flag" | "colorlet" | "definecolor";
  optionKey?: string;
  readOnlyReason?: string;
};

type StatementGroup = {
  innerFrom: number;
  innerTo: number;
  innerRaw: string;
};

type TokenSpan = {
  from: number;
  to: number;
  token: string;
};

type ColorResolution = {
  resolved: boolean;
  cssColor: string | null;
};

export type DeclaredColorAnalysis = {
  signature: string;
  colors: ReadonlyMap<string, string>;
  ranges: readonly SourceRange[];
};

type ColorResolveContext = {
  declaredColors: ReadonlyMap<string, string>;
  currentColor?: string | null;
};

const COLOR_VALUE_KEYS = new Set([
  "draw",
  "fill",
  "color",
  "text",
  "top color",
  "bottom color",
  "middle color",
  "left color",
  "right color",
  "inner color",
  "outer color",
  "ball color",
  "lower left",
  "lower right",
  "upper left",
  "upper right",
  "cylinder end fill",
  "cylinder body fill"
]);

const DEFINECOLOR_READ_ONLY_REASON = "\\definecolor preview is read-only in source swatches.";

export function collectDeclaredColors(source: string, tree: Tree): ReadonlyMap<string, string> {
  if (!sourceMayContainDeclaredColors(source)) {
    return new Map();
  }
  return collectDeclaredColorsFromDeclarations(source, collectDeclaredColorStatements(source, tree));
}

let _cachedDeclaredSignature = "__declared-colors:uninitialized__";
let _cachedDeclaredSource = "__declared-colors:uninitialized__";
let _cachedDeclaredTree: Tree | null = null;
let _cachedDeclaredAnalysis: DeclaredColorAnalysis = {
  signature: _cachedDeclaredSignature,
  colors: new Map(),
  ranges: []
};

/**
 * Cached wrapper around collectDeclaredColors. Cache invalidation is based on
 * the parsed \colorlet/\definecolor statement content rather than the full
 * source string so unrelated edits can reuse the same declaration map.
 */
export function resolveDeclaredColorAnalysis(source: string, tree: Tree): DeclaredColorAnalysis {
  if (source === _cachedDeclaredSource && tree === _cachedDeclaredTree) {
    return _cachedDeclaredAnalysis;
  }
  if (!sourceMayContainDeclaredColors(source)) {
    _cachedDeclaredSignature = "";
    _cachedDeclaredSource = source;
    _cachedDeclaredTree = tree;
    _cachedDeclaredAnalysis = {
      signature: "",
      colors: _cachedDeclaredAnalysis.signature === "" ? _cachedDeclaredAnalysis.colors : new Map(),
      ranges: []
    };
    return _cachedDeclaredAnalysis;
  }
  const declarations = collectDeclaredColorStatements(source, tree);
  const ranges = declarations.map((declaration) => ({
    from: declaration.from,
    to: declaration.to
  }));
  const signature = buildDeclaredColorSignature(declarations);
  if (signature === _cachedDeclaredSignature) {
    _cachedDeclaredSource = source;
    _cachedDeclaredTree = tree;
    _cachedDeclaredAnalysis = {
      signature,
      colors: _cachedDeclaredAnalysis.colors,
      ranges
    };
    return _cachedDeclaredAnalysis;
  }
  _cachedDeclaredSignature = signature;
  _cachedDeclaredSource = source;
  _cachedDeclaredTree = tree;
  _cachedDeclaredAnalysis = {
    signature,
    colors: collectDeclaredColorsFromDeclarations(source, declarations),
    ranges
  };
  return _cachedDeclaredAnalysis;
}

export function resolveDeclaredColors(source: string, tree: Tree): ReadonlyMap<string, string> {
  return resolveDeclaredColorAnalysis(source, tree).colors;
}

export function collectDetectedColors(
  source: string,
  tree: Tree,
  ranges: readonly SourceRange[],
  declaredColors: ReadonlyMap<string, string> = collectDeclaredColors(source, tree)
): DetectedColorOccurrence[] {
  const normalizedRanges = normalizeRanges(ranges, source.length);
  if (normalizedRanges.length === 0) {
    return [];
  }

  const occurrences: DetectedColorOccurrence[] = [];
  const seen = new Set<string>();

  const pushOccurrence = (occurrence: DetectedColorOccurrence) => {
    if (occurrence.to <= occurrence.from) {
      return;
    }
    const key = `${occurrence.from}:${occurrence.to}:${occurrence.source}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    occurrences.push(occurrence);
  };

  walkTree(tree, (name, from, to) => {
    if (name === "OptionList") {
      if (!intersectsRanges(from, to, normalizedRanges)) {
        return;
      }
      const optionList = parseOptionListRaw(source.slice(from, to), from);
      collectFromOptionList(optionList, declaredColors, pushOccurrence);
      return;
    }

    if (name === "ColorletStatement") {
      if (!intersectsRanges(from, to, normalizedRanges)) {
        return;
      }

      const groups = readStatementBraceGroups(source, from, to);
      if (groups.length < 2) {
        return;
      }
      const valueGroup = groups[1];
      if (valueGroup.innerRaw.length === 0) {
        return;
      }

      const resolved = resolveColorExpression(valueGroup.innerRaw, {
        declaredColors
      });
      if (!resolved.resolved) {
        return;
      }

      pushOccurrence({
        from: valueGroup.innerFrom,
        to: valueGroup.innerTo,
        token: valueGroup.innerRaw,
        cssColor: resolved.cssColor,
        editable: true,
        source: "colorlet"
      });
      return;
    }

    if (name === "DefineColorStatement") {
      if (!intersectsRanges(from, to, normalizedRanges)) {
        return;
      }

      const groups = readStatementBraceGroups(source, from, to);
      if (groups.length < 3) {
        return;
      }

      const modelRaw = groups[1].innerRaw.trim();
      const specificationGroup = groups[2];
      const specificationRaw = specificationGroup.innerRaw.trim();
      if (modelRaw.length === 0 || specificationRaw.length === 0) {
        return;
      }

      const resolved = resolveDefineColorModel(modelRaw, specificationRaw);
      if (!resolved) {
        return;
      }

      pushOccurrence({
        from: specificationGroup.innerFrom,
        to: specificationGroup.innerTo,
        token: specificationRaw,
        cssColor: normalizeHex(resolved),
        editable: false,
        source: "definecolor",
        readOnlyReason: DEFINECOLOR_READ_ONLY_REASON
      });
    }
  });

  occurrences.sort((left, right) => {
    if (left.from !== right.from) {
      return left.from - right.from;
    }
    if (left.to !== right.to) {
      return left.to - right.to;
    }
    return left.source.localeCompare(right.source);
  });

  return occurrences;
}

function collectFromOptionList(
  optionList: OptionListAst,
  declaredColors: ReadonlyMap<string, string>,
  pushOccurrence: (occurrence: DetectedColorOccurrence) => void,
  inheritedCurrentColor: string | null = null
): void {
  let currentColor = inheritedCurrentColor;

  for (const entry of optionList.entries) {
    if (entry.kind === "kv") {
      const key = normalizeOptionKey(entry.key);
      const valueToken = resolveOptionValueTokenSpan(entry);

      if (valueToken && COLOR_VALUE_KEYS.has(key)) {
        const resolved = resolveColorExpression(valueToken.token, {
          declaredColors,
          currentColor
        });
        if (resolved.resolved) {
          pushOccurrence({
            from: valueToken.from,
            to: valueToken.to,
            token: valueToken.token,
            cssColor: resolved.cssColor,
            editable: true,
            source: "option-value",
            optionKey: key
          });
        }
        if (key === "color" && resolved.cssColor != null) {
          currentColor = resolved.cssColor;
        }
      } else if (valueToken && key === "color") {
        const resolved = resolveColorExpression(valueToken.token, {
          declaredColors,
          currentColor
        });
        if (resolved.cssColor != null) {
          currentColor = resolved.cssColor;
        }
      }

      if (isStylePayloadCarrierKey(key)) {
        const nested = parseStyleValueAsOptionList(entry.valueRaw, resolveOptionValueStartOffset(entry));
        if (!nested) {
          continue;
        }
        collectFromOptionList(nested, declaredColors, pushOccurrence, currentColor);
      }
      continue;
    }

    if (entry.kind !== "flag") {
      continue;
    }

    const tokenSpan = resolveRawTokenSpan(entry.raw, entry.span.from);
    if (!tokenSpan) {
      continue;
    }

    const resolved = resolveColorExpression(tokenSpan.token, {
      declaredColors,
      currentColor
    });
    if (!resolved.resolved) {
      continue;
    }

    pushOccurrence({
      from: tokenSpan.from,
      to: tokenSpan.to,
      token: tokenSpan.token,
      cssColor: resolved.cssColor,
      editable: true,
      source: "option-flag"
    });

    if (resolved.cssColor != null) {
      currentColor = resolved.cssColor;
    }
  }
}

function resolveOptionValueTokenSpan(entry: Extract<OptionEntry, { kind: "kv" }>): TokenSpan | null {
  const valueStart = resolveOptionValueStartOffset(entry);
  return resolveRawTokenSpan(entry.valueRaw, valueStart);
}

function resolveOptionValueStartOffset(entry: Extract<OptionEntry, { kind: "kv" }>): number {
  const relative = entry.raw.indexOf(entry.valueRaw);
  if (relative >= 0) {
    return entry.span.from + relative;
  }
  return entry.span.from;
}

function resolveRawTokenSpan(raw: string, absoluteFrom: number): TokenSpan | null {
  const outerTrim = trimWithOffsets(raw, absoluteFrom);
  let token = outerTrim.value;
  let from = outerTrim.from;
  if (token.length === 0) {
    return null;
  }

  let unwrapGuard = 0;
  while (token.startsWith("{") && token.endsWith("}") && isWrappedBySingleBracePair(token) && unwrapGuard < 12) {
    const inner = trimWithOffsets(token.slice(1, -1), from + 1);
    token = inner.value;
    from = inner.from;
    unwrapGuard += 1;
    if (token.length === 0) {
      return null;
    }
  }

  return {
    from,
    to: from + token.length,
    token
  };
}

function resolveColorExpression(raw: string, context: ColorResolveContext): ColorResolution {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { resolved: false, cssColor: null };
  }
  const normalized = trimmed.toLowerCase();

  if (normalized === "none") {
    return { resolved: true, cssColor: null };
  }

  if (normalized.startsWith("#")) {
    if (!isHexColor(normalized)) {
      return { resolved: false, cssColor: null };
    }
    return { resolved: true, cssColor: normalizeHex(normalized) };
  }

  if (context.declaredColors.has(normalized)) {
    return { resolved: true, cssColor: context.declaredColors.get(normalized) ?? null };
  }

  if (normalized.includes("!")) {
    const mixed = resolveMixedColor(normalized, context);
    if (mixed) {
      return { resolved: true, cssColor: mixed };
    }
  }

  if (normalized === ".") {
    const current = resolveColorTokenToHex(".", context, "black");
    if (!current) {
      return { resolved: false, cssColor: null };
    }
    return { resolved: true, cssColor: current };
  }

  const normalizedBySemantic = normalizeColor(normalized, {
    currentColor: context.currentColor
  });
  if (isHexColor(normalizedBySemantic)) {
    return {
      resolved: true,
      cssColor: normalizeHex(normalizedBySemantic)
    };
  }

  return { resolved: false, cssColor: null };
}

function resolveMixedColor(raw: string, context: ColorResolveContext): string | null {
  const parts = raw.split("!").map((part) => part.trim());
  if (parts.length <= 1 || !parts[0]) {
    return null;
  }

  let current = resolveColorTokenToRgb(parts[0], context, "black");
  if (!current) {
    return null;
  }

  let cursor = 1;
  while (cursor < parts.length) {
    const percentageRaw = parts[cursor];
    const percentage = Number(percentageRaw);
    if (!percentageRaw || !Number.isFinite(percentage)) {
      return null;
    }
    cursor += 1;

    const mixToken = parts[cursor] && parts[cursor].length > 0 ? parts[cursor] : "white";
    if (parts[cursor] && parts[cursor].length > 0) {
      cursor += 1;
    }

    const mixColor = resolveColorTokenToRgb(mixToken, context, "white");
    if (!mixColor) {
      return null;
    }

    const t = clamp01(percentage / 100);
    current = {
      r: current.r * t + mixColor.r * (1 - t),
      g: current.g * t + mixColor.g * (1 - t),
      b: current.b * t + mixColor.b * (1 - t)
    };
  }

  return rgbToHex(current.r, current.g, current.b);
}

function resolveColorTokenToRgb(
  tokenRaw: string,
  context: ColorResolveContext,
  relativeFallback: string
): { r: number; g: number; b: number } | null {
  const token = tokenRaw.toLowerCase();
  const normalized = token === "." ? context.currentColor ?? relativeFallback : token;
  const color = resolveColorTokenToHex(normalized, context, relativeFallback);
  if (!color) {
    return null;
  }
  return hexToRgb(color);
}

function resolveColorTokenToHex(
  tokenRaw: string,
  context: ColorResolveContext,
  relativeFallback: string
): string | null {
  const token = tokenRaw.trim().toLowerCase();
  if (token.length === 0) {
    return null;
  }

  if (token === ".") {
    const fallback = context.currentColor ?? relativeFallback;
    return resolveColorTokenToHex(fallback, context, relativeFallback);
  }

  if (isHexColor(token)) {
    return normalizeHex(token);
  }

  const declared = context.declaredColors.get(token);
  if (declared) {
    return normalizeHex(declared);
  }

  const normalized = normalizeColor(token, {
    currentColor: context.currentColor
  });
  if (!isHexColor(normalized)) {
    return null;
  }
  return normalizeHex(normalized);
}

function readStatementBraceGroups(source: string, statementFrom: number, statementTo: number): StatementGroup[] {
  const groups: StatementGroup[] = [];
  const statementRaw = source.slice(statementFrom, statementTo);
  let cursor = 0;

  while (cursor < statementRaw.length) {
    const openIndex = statementRaw.indexOf("{", cursor);
    if (openIndex < 0) {
      break;
    }
    const block = readBalancedBlock(statementRaw, openIndex, "{", "}");
    if (!block) {
      break;
    }

    const innerFrom = statementFrom + openIndex + 1;
    const trimmed = trimWithOffsets(block.content, innerFrom);
    groups.push({
      innerFrom: trimmed.from,
      innerTo: trimmed.to,
      innerRaw: trimmed.value
    });
    cursor = block.nextIndex;
  }

  return groups;
}

function isStylePayloadCarrierKey(key: string): boolean {
  return /\/\.(append style|prefix style|style(?:\s+\d+\s+args|\s+args)?|estyle)$/.test(key);
}

type DeclaredColorStatement = {
  kind: "ColorletStatement" | "DefineColorStatement";
  from: number;
  to: number;
  raw: string;
};

function collectDeclaredColorStatements(source: string, tree: Tree): DeclaredColorStatement[] {
  const declarations: DeclaredColorStatement[] = [];

  walkTree(tree, (name, from, to) => {
    if (name !== "ColorletStatement" && name !== "DefineColorStatement") {
      return;
    }
    declarations.push({
      kind: name,
      from,
      to,
      raw: source.slice(from, to)
    });
  });

  return declarations;
}

function sourceMayContainDeclaredColors(source: string): boolean {
  return source.includes("\\colorlet") || source.includes("\\definecolor");
}

function collectDeclaredColorsFromDeclarations(
  source: string,
  declarations: readonly DeclaredColorStatement[]
): ReadonlyMap<string, string> {
  const declaredColors = new Map<string, string>();
  for (const declaration of declarations) {
    const groups = readStatementBraceGroups(source, declaration.from, declaration.to);
    if (declaration.kind === "ColorletStatement") {
      if (groups.length < 2) {
        continue;
      }
      const name = normalizeDeclaredColorName(groups[0]?.innerRaw ?? "");
      const value = groups[1]?.innerRaw ?? "";
      if (!name || value.length === 0) {
        continue;
      }
      const resolved = resolveColorExpression(value, { declaredColors });
      if (resolved.cssColor != null) {
        declaredColors.set(name, resolved.cssColor.toLowerCase());
      }
      continue;
    }

    if (groups.length < 3) {
      continue;
    }
    const name = normalizeDeclaredColorName(groups[0]?.innerRaw ?? "");
    if (!name) {
      continue;
    }
    const css = resolveDefineColorModel(
      groups[1]?.innerRaw.trim() ?? "",
      groups[2]?.innerRaw.trim() ?? ""
    );
    if (css != null) {
      declaredColors.set(name, css.toLowerCase());
    }
  }
  return declaredColors;
}

function normalizeDeclaredColorName(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function buildDeclaredColorSignature(declarations: readonly DeclaredColorStatement[]): string {
  if (declarations.length === 0) {
    return "";
  }
  return declarations.map((declaration) => `${declaration.kind}:${declaration.raw}`).join("\u0000");
}

function normalizeOptionKey(rawKey: string): string {
  return rawKey.trim().toLowerCase().replace(/\s+/gu, " ");
}

function walkTree(tree: Tree, visit: (name: string, from: number, to: number) => void): void {
  const cursor = tree.cursor();

  for (;;) {
    visit(cursor.name, cursor.from, cursor.to);

    if (cursor.firstChild()) {
      continue;
    }

    while (!cursor.nextSibling()) {
      if (!cursor.parent()) {
        return;
      }
    }
  }
}

function normalizeRanges(ranges: readonly SourceRange[], docLength: number): SourceRange[] {
  const normalized: SourceRange[] = [];
  for (const range of ranges) {
    const from = clamp(Math.min(range.from, range.to), 0, docLength);
    const to = clamp(Math.max(range.from, range.to), 0, docLength);
    if (to <= from) {
      continue;
    }
    normalized.push({ from, to });
  }

  normalized.sort((left, right) => {
    if (left.from !== right.from) {
      return left.from - right.from;
    }
    return left.to - right.to;
  });

  return normalized;
}

function intersectsRanges(from: number, to: number, ranges: readonly SourceRange[]): boolean {
  for (const range of ranges) {
    if (range.to <= from) {
      continue;
    }
    if (range.from >= to) {
      return false;
    }
    return true;
  }
  return false;
}

function trimWithOffsets(raw: string, absoluteFrom: number): { value: string; from: number; to: number } {
  let start = 0;
  let end = raw.length;
  while (start < end && isWhitespace(raw[start])) {
    start += 1;
  }
  while (end > start && isWhitespace(raw[end - 1])) {
    end -= 1;
  }

  return {
    value: raw.slice(start, end),
    from: absoluteFrom + start,
    to: absoluteFrom + end
  };
}

function isWhitespace(input: string): boolean {
  return /\s/u.test(input);
}

function isWrappedBySingleBracePair(raw: string): boolean {
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
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
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function isHexColor(input: string): boolean {
  return /^#[0-9a-f]{3}$/iu.test(input) || /^#[0-9a-f]{6}$/iu.test(input);
}

function normalizeHex(input: string): string {
  const raw = input.trim().toLowerCase().replace(/^#/, "");
  if (raw.length === 3) {
    const expanded = raw
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded}`;
  }
  return `#${raw}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex).replace(/^#/, "");
  const parsed = Number.parseInt(normalized, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((component) => Math.round(Math.max(0, Math.min(255, component))))
      .map((component) => component.toString(16).padStart(2, "0"))
      .join("")
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
