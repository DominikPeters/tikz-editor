import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import { parseCoordinateLike, parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import { worldPoint } from "../../coords/points.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { worldTransform } from "../../coords/transforms.js";
import type { WorldTransform } from "../../coords/transforms.js";
import type { ResolvedStyle } from "../types.js";
import { DEFAULT_TEXT_FONT_SIZE, FONT_SIZE_COMMAND_FACTORS } from "./constants.js";

type TransformAxisVector = Readonly<{ x: number; y: number }>;

function transformAxisVector(x: number, y: number): TransformAxisVector {
  return { x, y };
}

export function parseStyleValueAsOptionList(valueRaw: string, absoluteFrom = 0): OptionListAst | null {
  const trimmed = valueRaw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let inner = trimmed;
  let innerStartOffset = 0;
  if (inner.startsWith("{") && inner.endsWith("}")) {
    const withoutOuter = inner.slice(1, -1);
    const leadingInner = withoutOuter.search(/\S/);
    innerStartOffset = 1 + (leadingInner >= 0 ? leadingInner : 0);
    inner = withoutOuter.trim();
  }

  if (inner.length === 0) {
    return null;
  }

  const hasExplicitBrackets = inner.startsWith("[");
  const optionRaw = hasExplicitBrackets ? inner : `[${inner}]`;
  const offsetAdjustment = hasExplicitBrackets ? innerStartOffset : innerStartOffset - 1;
  return parseOptionListRaw(optionRaw, absoluteFrom + offsetAdjustment);
}

const FONT_STYLE_BY_COMMAND: Record<string, ResolvedStyle["fontStyle"]> = {
  "\\it": "italic",
  "\\itshape": "italic",
  "\\sl": "italic",
  "\\slshape": "italic",
  "\\up": "normal",
  "\\upshape": "normal",
  "\\normalfont": "normal",
  "\\pgfutil@font@itshape": "italic",
  "\\pgfutil@font@normalfont": "normal"
};

const FONT_WEIGHT_BY_COMMAND: Record<string, ResolvedStyle["fontWeight"]> = {
  "\\bf": "bold",
  "\\bfseries": "bold",
  "\\md": "normal",
  "\\mdseries": "normal",
  "\\normalfont": "normal",
  "\\pgfutil@font@bfseries": "bold",
  "\\pgfutil@font@mdseries": "normal",
  "\\pgfutil@font@normalfont": "normal"
};

const FONT_FAMILY_BY_COMMAND: Record<string, ResolvedStyle["fontFamily"]> = {
  "\\rm": "serif",
  "\\rmfamily": "serif",
  "\\sf": "sans",
  "\\sffamily": "sans",
  "\\tt": "monospace",
  "\\ttfamily": "monospace",
  "\\normalfont": "serif",
  "\\pgfutil@font@rmfamily": "serif",
  "\\pgfutil@font@sffamily": "sans",
  "\\pgfutil@font@ttfamily": "monospace",
  "\\pgfutil@font@normalfont": "serif"
};

const CONTROL_SEQUENCE_PATTERN = /\\[A-Za-z@]+/g;

export function parseFontStyle(
  raw: string
): Partial<Pick<ResolvedStyle, "fontStyle" | "fontWeight" | "fontFamily" | "fontSize">> | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let fontStyle: ResolvedStyle["fontStyle"] | undefined;
  let fontWeight: ResolvedStyle["fontWeight"] | undefined;
  let fontFamily: ResolvedStyle["fontFamily"] | undefined;
  let fontSize: number | undefined;

  const commands = extractControlSequences(trimmed);
  for (const command of commands) {
    const mappedStyle = FONT_STYLE_BY_COMMAND[command.name];
    if (mappedStyle) {
      fontStyle = mappedStyle;
    }

    const mappedWeight = FONT_WEIGHT_BY_COMMAND[command.name];
    if (mappedWeight) {
      fontWeight = mappedWeight;
    }

    const mappedFamily = FONT_FAMILY_BY_COMMAND[command.name];
    if (mappedFamily) {
      fontFamily = mappedFamily;
    }

    const mappedScale = FONT_SIZE_COMMAND_FACTORS[command.name];
    if (mappedScale != null) {
      fontSize = DEFAULT_TEXT_FONT_SIZE * mappedScale;
      continue;
    }

    if (command.name !== "\\fontsize") {
      continue;
    }

    const explicitSize = parseExplicitFontSize(trimmed, command.endIndex);
    if (explicitSize != null) {
      fontSize = explicitSize;
    }
  }

  const parsed: Partial<Pick<ResolvedStyle, "fontStyle" | "fontWeight" | "fontFamily" | "fontSize">> = {};
  if (fontStyle) {
    parsed.fontStyle = fontStyle;
  }
  if (fontWeight) {
    parsed.fontWeight = fontWeight;
  }
  if (fontFamily) {
    parsed.fontFamily = fontFamily;
  }
  if (fontSize != null) {
    parsed.fontSize = fontSize;
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

export function parseAxisVector(raw: string, axis: "x" | "y", resolveCoordinate?: (raw: string) => WorldPoint | null): TransformAxisVector | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.startsWith("(") && resolveCoordinate) {
    const point = resolveCoordinate(normalized);
    return point ? transformAxisVector(point.x, point.y) : null;
  }
  const pair = parseCoordinateLike(normalized);
  if (pair) {
    const x = parseLength(pair.x, "cm");
    const y = parseLength(pair.y, "cm");
    if (x == null || y == null) {
      return null;
    }
    return transformAxisVector(x, y);
  }

  const length = parseLength(normalized, "cm");
  if (length == null) {
    return null;
  }
  return axis === "x"
    ? transformAxisVector(length, 0)
    : transformAxisVector(0, length);
}

export function parseCmTransformValue(
  raw: string,
  resolveCoordinate?: (raw: string) => WorldPoint | null
): WorldTransform | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return null;
  }

  const parts = splitAllAtTopLevel(normalized, ",").map((part) => part.trim());
  if (parts.length !== 5) {
    return null;
  }

  const [aRaw, bRaw, cRaw, dRaw, translationRaw] = parts;
  const a = parseScalarQuantity(aRaw);
  const b = parseScalarQuantity(bRaw);
  const c = parseScalarQuantity(cRaw);
  const d = parseScalarQuantity(dRaw);
  if (a == null || b == null || c == null || d == null) {
    return null;
  }

  const parsedCoordinate = resolveCoordinate ? null : parseCoordinateLike(translationRaw);
  if (parsedCoordinate) {
    const x = parseLength(parsedCoordinate.x, "cm");
    const y = parseLength(parsedCoordinate.y, "cm");
    if (x == null || y == null) {
      return null;
    }
    return worldTransform(a, b, c, d, x, y);
  }

  if (resolveCoordinate) {
    const resolved = resolveCoordinate(translationRaw);
    if (resolved) {
      return worldTransform(a, b, c, d, resolved.x, resolved.y);
    }
  }

  return null;
}

export function parseRotateAroundValue(
  raw: string,
  resolveCoordinate?: (raw: string) => WorldPoint | null
): { angleDeg: number; pivot: WorldPoint } | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return null;
  }

  const parts = splitAllAtTopLevel(normalized, ":").map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }

  const angleRaw = parts[0];
  const coordinateRaw = parts.slice(1).join(":").trim();
  if (angleRaw.length === 0 || coordinateRaw.length === 0) {
    return null;
  }

  const parsedAngle = parseQuantityExpression(angleRaw);
  if (parsedAngle?.kind !== "scalar" || !Number.isFinite(parsedAngle.value)) {
    return null;
  }

  const parsedCoordinate = resolveCoordinate ? null : parseCoordinateLike(coordinateRaw);
  if (parsedCoordinate) {
    const x = parseLength(parsedCoordinate.x, "cm");
    const y = parseLength(parsedCoordinate.y, "cm");
    if (x == null || y == null) {
      return null;
    }
    return { angleDeg: parsedAngle.value, pivot: worldPoint(pt(x), pt(y)) };
  }

  if (resolveCoordinate) {
    const resolved = resolveCoordinate(coordinateRaw);
    if (resolved) {
      return { angleDeg: parsedAngle.value, pivot: resolved };
    }
  }

  return null;
}

function parseScalarQuantity(raw: string): number | null {
  const parsed = parseQuantityExpression(raw);
  if (parsed?.kind !== "scalar") {
    return null;
  }
  return Number.isFinite(parsed.value) ? parsed.value : null;
}

export function normalizeOptionValue(raw: string): string {
  return stripEnclosingBraces(raw).trim();
}

export function stripEnclosingBraces(raw: string): string {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return trimmed;
  }

  const block = readBalancedBlock(trimmed, 0, "{", "}");
  if (block?.nextIndex !== trimmed.length) {
    return trimmed;
  }
  return block.content.trim();
}

export function readOptionalBracketOptions(input: string, startIndex: number): { optionsRaw: string | null; nextIndex: number } {
  let cursor = startIndex;
  while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  if (input[cursor] !== "[") {
    return { optionsRaw: null, nextIndex: cursor };
  }
  const block = readBalancedBlock(input, cursor, "[", "]");
  if (!block) {
    return { optionsRaw: null, nextIndex: cursor };
  }
  return { optionsRaw: block.content, nextIndex: block.nextIndex };
}

export function readBalancedBlock(
  input: string,
  startIndex: number,
  open: string,
  close: string
): { content: string; nextIndex: number } | null {
  if (input[startIndex] !== open) {
    return null;
  }

  let depth = 0;
  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === open) {
      depth += 1;
      continue;
    }
    if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: input.slice(startIndex + 1, index),
          nextIndex: index + 1
        };
      }
    }
  }

  return null;
}

export function findTopLevelCharacter(input: string, character: string): number {
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
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
    if (char === character && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return index;
    }
  }

  return -1;
}

function extractControlSequences(input: string): Array<{ name: string; endIndex: number }> {
  const commands: Array<{ name: string; endIndex: number }> = [];
  const matcher = new RegExp(CONTROL_SEQUENCE_PATTERN.source, "g");
  let match = matcher.exec(input);
  while (match) {
    commands.push({
      name: match[0],
      endIndex: match.index + match[0].length
    });
    match = matcher.exec(input);
  }
  return commands;
}

function parseExplicitFontSize(input: string, startIndex: number): number | null {
  let cursor = startIndex;
  while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
    cursor += 1;
  }

  const sizeBlock = readBalancedBlock(input, cursor, "{", "}");
  if (!sizeBlock) {
    return null;
  }
  cursor = sizeBlock.nextIndex;
  while (cursor < input.length && /\s/.test(input[cursor] ?? "")) {
    cursor += 1;
  }

  const baselineBlock = readBalancedBlock(input, cursor, "{", "}");
  if (!baselineBlock) {
    return null;
  }

  const parsedSize = parseLength(sizeBlock.content, "pt");
  if (parsedSize == null || !Number.isFinite(parsedSize) || parsedSize <= 0) {
    return null;
  }
  return parsedSize;
}
