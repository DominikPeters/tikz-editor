import { createSourceRenderOffsetMap } from "./text-offset-map";
import { clampFinite as clamp } from "./geometry";

export type LogicalLineRange = {
  start: number;
  end: number;
};

export type TextMeasureStyle = {
  fontSize?: number | null;
  fontStyle?: string | null;
  fontWeight?: string | null;
  fontFamily?: string | null;
};

export type VisualTextAlign =
  | "left"
  | "flush left"
  | "right"
  | "flush right"
  | "center"
  | "flush center"
  | "justify"
  | "none"
  | undefined;

type VisualTextSyntax = "mathjax" | "plain";
type MathMode = "none" | "dollar" | "paren";

const PLAIN_TEXT_SERIF_FONT_STACK = "MJX-NCM, CMU Serif, Latin Modern Roman, Times New Roman, serif";
const PLAIN_TEXT_SANS_FONT_STACK = "MJX-NCM-Sans, CMU Sans Serif, Latin Modern Sans, Helvetica, Arial, sans-serif";
const PLAIN_TEXT_MONO_FONT_STACK = "MJX-NCM-Monospace, Latin Modern Mono, CMU Typewriter Text, Courier New, monospace";

const STRUCTURAL_MATH_COMMANDS = new Set([
  "left",
  "right",
  "big",
  "Big",
  "bigg",
  "Bigg",
  "textstyle",
  "displaystyle",
  "scriptstyle",
  "scriptscriptstyle"
]);

function isEscapedCharacter(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function measureVisibleText(measureTextWidth: (text: string) => number, text: string, fallback: number): number {
  if (text.length === 0) {
    return 0;
  }
  const measured = measureTextWidth(text);
  if (Number.isFinite(measured) && measured > 0) {
    return measured;
  }
  return fallback;
}

function opaqueCommandAdvance(measureTextWidth: (text: string) => number): number {
  return measureVisibleText(measureTextWidth, "x", 1);
}

function findControlWordEnd(text: string, start: number): number {
  let cursor = start + 1;
  while (cursor < text.length && /[A-Za-z]/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function findTeXLinebreakCommandEnd(text: string, start: number): number | null {
  if (text[start] !== "\\" || text[start + 1] !== "\\") {
    return null;
  }
  let cursor = start + 2;
  if (text[cursor] === "*") {
    cursor += 1;
  }
  while (cursor < text.length && /\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  if (text[cursor] === "[") {
    let bracketCursor = cursor + 1;
    while (bracketCursor < text.length && text[bracketCursor] !== "]") {
      bracketCursor += 1;
    }
    if (bracketCursor < text.length) {
      cursor = bracketCursor + 1;
    }
  }
  return cursor;
}

function hasMatchingUnescapedDollar(text: string, start: number): boolean {
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "$" && !isEscapedCharacter(text, cursor)) {
      return true;
    }
  }
  return false;
}

export function collectLogicalLineRanges(text: string): LogicalLineRange[] {
  if (text.length === 0) {
    return [{ start: 0, end: 0 }];
  }
  const ranges: LogicalLineRange[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] === "\r") {
      const next = text[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
      ranges.push({ start, end: cursor });
      start = next;
      cursor = next;
      continue;
    }
    if (text[cursor] === "\n") {
      ranges.push({ start, end: cursor });
      start = cursor + 1;
      cursor += 1;
      continue;
    }
    const linebreakEnd = findTeXLinebreakCommandEnd(text, cursor);
    if (linebreakEnd != null) {
      ranges.push({ start, end: cursor });
      start = linebreakEnd;
      cursor = linebreakEnd;
      continue;
    }
    cursor += 1;
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

export function applyTextMeasureFont(ctx: CanvasRenderingContext2D | null, style: TextMeasureStyle | null | undefined): void {
  if (!ctx) {
    return;
  }
  const sizePx = Math.max(1, Number(style?.fontSize) || 12);
  const fontStyle = style?.fontStyle === "italic" ? "italic " : "";
  const fontWeight = style?.fontWeight === "bold" ? "bold " : "";
  const fontFamily =
    style?.fontFamily === "sans"
      ? PLAIN_TEXT_SANS_FONT_STACK
      : style?.fontFamily === "monospace"
        ? PLAIN_TEXT_MONO_FONT_STACK
        : PLAIN_TEXT_SERIF_FONT_STACK;
  ctx.font = `${fontStyle}${fontWeight}${sizePx}px ${fontFamily}`;
}

export function buildRenderLinePrefixWidths(
  lineText: string,
  measureTextWidth: (text: string) => number,
  syntax: VisualTextSyntax = "mathjax"
): number[] {
  const prefix = Array.from({ length: lineText.length + 1 }, () => 0);
  prefix[0] = 0;

  let width = 0;
  let cursor = 0;
  let mathMode: MathMode = "none";

  while (cursor < lineText.length) {
    const char = lineText[cursor] ?? "";

    if (syntax === "mathjax" && char === "$" && !isEscapedCharacter(lineText, cursor)) {
      if (mathMode === "dollar") {
        mathMode = "none";
        prefix[cursor + 1] = width;
        cursor += 1;
        continue;
      }
      if (hasMatchingUnescapedDollar(lineText, cursor)) {
        mathMode = "dollar";
        prefix[cursor + 1] = width;
        cursor += 1;
        continue;
      }
    }

    if (char === "\\" && !isEscapedCharacter(lineText, cursor)) {
      const nextChar = lineText[cursor + 1] ?? "";
      if (syntax === "mathjax" && nextChar === "(") {
        mathMode = "paren";
        prefix[cursor + 1] = width;
        prefix[cursor + 2] = width;
        cursor += 2;
        continue;
      }
      if (syntax === "mathjax" && nextChar === ")") {
        mathMode = "none";
        prefix[cursor + 1] = width;
        prefix[cursor + 2] = width;
        cursor += 2;
        continue;
      }

      const linebreakEnd = findTeXLinebreakCommandEnd(lineText, cursor);
      if (linebreakEnd != null) {
        for (let index = cursor + 1; index <= linebreakEnd; index += 1) {
          prefix[index] = width;
        }
        cursor = linebreakEnd;
        continue;
      }

      if (syntax === "plain") {
        width += measureVisibleText(measureTextWidth, char, 1);
        prefix[cursor + 1] = width;
        cursor += 1;
        continue;
      }

      if (syntax === "mathjax" && /[A-Za-z]/.test(nextChar)) {
        const commandEnd = findControlWordEnd(lineText, cursor);
        const command = lineText.slice(cursor + 1, commandEnd);
        const commandWidth =
          mathMode !== "none" && STRUCTURAL_MATH_COMMANDS.has(command)
            ? 0
            : opaqueCommandAdvance(measureTextWidth);
        for (let index = cursor + 1; index < commandEnd; index += 1) {
          prefix[index] = width;
        }
        width += commandWidth;
        prefix[commandEnd] = width;
        cursor = commandEnd;
        continue;
      }

      prefix[cursor + 1] = width;
      width += measureVisibleText(measureTextWidth, nextChar, /\s/.test(nextChar) ? 0.5 : 1);
      prefix[cursor + 2] = width;
      cursor += 2;
      continue;
    }

    if (syntax === "mathjax" && mathMode !== "none" && (char === "{" || char === "}" || char === "^" || char === "_" || char === "&")) {
      prefix[cursor + 1] = width;
      cursor += 1;
      continue;
    }

    width += measureVisibleText(measureTextWidth, char, /\s/.test(char) ? 0.5 : 1);
    prefix[cursor + 1] = width;
    cursor += 1;
  }

  return prefix;
}

function prefixXFromLocalOffset(prefix: number[], offset: number): number {
  const bounded = Math.max(0, Math.min(offset, Math.max(0, prefix.length - 1)));
  const total = prefix[prefix.length - 1] ?? 0;
  if (!(total > 0)) {
    const length = Math.max(1, prefix.length - 1);
    return bounded / length;
  }
  return (prefix[bounded] ?? 0) / total;
}

function prefixWidth(prefix: number[]): number {
  return Math.max(0, prefix[prefix.length - 1] ?? 0);
}

function prefixDistanceFromLocalOffset(prefix: number[], offset: number): number {
  const bounded = Math.max(0, Math.min(offset, Math.max(0, prefix.length - 1)));
  return Math.max(0, prefix[bounded] ?? 0);
}

function offsetFromPrefixDistance(prefix: number[], x: number): number {
  const lineLength = Math.max(0, prefix.length - 1);
  if (lineLength === 0) {
    return 0;
  }
  const total = prefix[lineLength] ?? 0;
  if (!(total > 0)) {
    return clamp(Math.round(x * lineLength), 0, lineLength);
  }
  const target = clamp(x, 0, total);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const hasOnlyUniqueCaretStops = hasUniqueCaretStops(prefix);
  for (let index = 0; index < prefix.length; index += 1) {
    const distance = Math.abs((prefix[index] ?? 0) - target);
    if (distance < bestDistance || (distance === bestDistance && hasOnlyUniqueCaretStops)) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function hasUniqueCaretStops(prefix: number[]): boolean {
  const seen = new Set<number>();
  for (const value of prefix) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
  }
  return true;
}

function offsetFromPrefixRatio(prefix: number[], xRatio: number): number {
  const total = prefixWidth(prefix);
  if (!(total > 0)) {
    return offsetFromPrefixDistance(prefix, clamp(xRatio, 0, 1));
  }
  return offsetFromPrefixDistance(prefix, clamp(xRatio, 0, 1) * total);
}

export function resolveVisualLineLeft(blockWidth: number, lineWidth: number, align: VisualTextAlign): number {
  const safeBlockWidth = Number.isFinite(blockWidth) && blockWidth > 0 ? blockWidth : lineWidth;
  const safeLineWidth = Math.max(0, Number.isFinite(lineWidth) ? lineWidth : 0);
  if (align === "left" || align === "flush left" || align === "justify") {
    return 0;
  }
  if (align === "right" || align === "flush right") {
    return Math.max(0, safeBlockWidth - safeLineWidth);
  }
  return Math.max(0, (safeBlockWidth - safeLineWidth) / 2);
}

function resolveLineIndexForOffset(ranges: LogicalLineRange[], textLength: number, offset: number): number {
  if (ranges.length === 0) {
    return 0;
  }
  const pivot = textLength === 0 ? 0 : Math.min(Math.max(0, offset), textLength - 1);
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (pivot >= range.start && pivot < range.end) {
      return index;
    }
  }
  return ranges.length - 1;
}

function lineRangeAt(ranges: LogicalLineRange[], lineIndex: number, textLength: number): LogicalLineRange {
  return ranges[Math.min(Math.max(0, lineIndex), Math.max(0, ranges.length - 1))] ?? { start: 0, end: textLength };
}

function clampRenderOffsetToLineRange(renderOffset: number, range: LogicalLineRange): number {
  return clamp(renderOffset, range.start, range.end);
}

export function createVisualTextLayout(
  sourceText: string,
  renderText: string,
  measureTextWidth: (text: string) => number,
  options: { syntax?: VisualTextSyntax } = {}
) {
  const syntax = options.syntax ?? "mathjax";
  const offsetMap = createSourceRenderOffsetMap(sourceText, renderText);
  const sourceRanges = collectLogicalLineRanges(sourceText);
  const renderRanges = collectLogicalLineRanges(renderText);
  const renderPrefixes = renderRanges.map((range) =>
    buildRenderLinePrefixWidths(renderText.slice(range.start, range.end), measureTextWidth, syntax)
  );

  const resolveRenderLineRange = (lineIndex: number): LogicalLineRange =>
    lineRangeAt(renderRanges, lineIndex, renderText.length);

  const resolveRenderPrefix = (lineIndex: number): number[] => {
    const bounded = Math.min(Math.max(0, lineIndex), Math.max(0, renderPrefixes.length - 1));
    return renderPrefixes[bounded] ?? [0];
  };

  return {
    sourceLineRanges: sourceRanges,
    renderLineRanges: renderRanges,
    sourceToRender: offsetMap.sourceToRender,
    renderToSource: offsetMap.renderToSource,
    getCaretPosition(sourceOffset: number): { lineIndex: number; ratio: number; x: number; lineWidth: number } {
      const lineIndex = resolveLineIndexForOffset(sourceRanges, sourceText.length, sourceOffset);
      const renderRange = resolveRenderLineRange(lineIndex);
      const renderPrefix = resolveRenderPrefix(lineIndex);
      const renderOffset = clampRenderOffsetToLineRange(offsetMap.sourceToRender(sourceOffset), renderRange);
      const localOffset = renderOffset - renderRange.start;
      return {
        lineIndex,
        ratio: prefixXFromLocalOffset(renderPrefix, localOffset),
        x: prefixDistanceFromLocalOffset(renderPrefix, localOffset),
        lineWidth: prefixWidth(renderPrefix)
      };
    },
    getLineSelectionRatios(
      sourceOffsetStart: number,
      sourceOffsetEnd: number,
      lineIndex: number
    ): { leftRatio: number; rightRatio: number; leftX: number; rightX: number; lineWidth: number } {
      const renderRange = resolveRenderLineRange(lineIndex);
      const renderPrefix = resolveRenderPrefix(lineIndex);
      const renderStart = clampRenderOffsetToLineRange(offsetMap.sourceToRender(sourceOffsetStart), renderRange);
      const renderEnd = clampRenderOffsetToLineRange(offsetMap.sourceToRender(sourceOffsetEnd), renderRange);
      const localStart = renderStart - renderRange.start;
      const localEnd = renderEnd - renderRange.start;
      return {
        leftRatio: prefixXFromLocalOffset(renderPrefix, localStart),
        rightRatio: prefixXFromLocalOffset(renderPrefix, localEnd),
        leftX: prefixDistanceFromLocalOffset(renderPrefix, localStart),
        rightX: prefixDistanceFromLocalOffset(renderPrefix, localEnd),
        lineWidth: prefixWidth(renderPrefix)
      };
    },
    getLineWidth(lineIndex: number): number {
      return prefixWidth(resolveRenderPrefix(lineIndex));
    },
    resolveSourceOffsetFromLineRatio(lineIndex: number, xRatio: number): number {
      const renderRange = resolveRenderLineRange(lineIndex);
      const renderPrefix = resolveRenderPrefix(lineIndex);
      const localOffset = offsetFromPrefixRatio(renderPrefix, xRatio);
      return clamp(offsetMap.renderToSource(renderRange.start + localOffset), 0, sourceText.length);
    },
    resolveSourceOffsetFromLineX(lineIndex: number, x: number): number {
      const renderRange = resolveRenderLineRange(lineIndex);
      const renderPrefix = resolveRenderPrefix(lineIndex);
      const localOffset = offsetFromPrefixDistance(renderPrefix, x);
      return clamp(offsetMap.renderToSource(renderRange.start + localOffset), 0, sourceText.length);
    }
  };
}
