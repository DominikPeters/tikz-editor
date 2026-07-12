import type { PathOptionItem } from "../../ast/types.js";
import type {
  NodeTextEngine,
  NodeTextColorResolver,
  NodeTextGraphicsResolver,
  NodeTextLayoutKind,
  NodeTextParagraphAlignment,
  NodeTextRenderInfo
} from "../../text/types.js";
import {
  concatMappedText,
  createGeneratedMappedText,
  mapTransformedTextWithFallback,
  projectInputOffset,
  type TextSourceMap,
  type TextSourceRange
} from "../../text/source-map.js";
import { parseLength } from "../coords/parse-length.js";
import type { ResolvedStyle } from "../types.js";
import type { NodeLayout, NodeShape } from "./types.js";
import { normalizeOptionValue } from "./utils.js";

const EXPLICIT_LINE_BREAK_PATTERN = /[ \t\r\n]*\\\\(?:\[[^\]]*\])?[ \t\r\n]*/g;
const EXPLICIT_LINE_BREAK_CANONICAL_PATTERN = /[ \t\r\n]*(\\\\(?:\[[^\]]*\])?)[ \t\r\n]*/g;
const EXPLICIT_LINE_BREAK_TOKEN_PATTERN = /\\\\(?:\[[^\]]*\])?/;
const PLAIN_TEXT_SERIF_FONT_STACK = "MJX-NCM, CMU Serif, Latin Modern Roman, Times New Roman, serif";
const PLAIN_TEXT_SANS_FONT_STACK = "MJX-NCM-Sans, CMU Sans Serif, Latin Modern Sans, Helvetica, Arial, sans-serif";
const PLAIN_TEXT_MONO_FONT_STACK = "MJX-NCM-Monospace, Latin Modern Mono, CMU Typewriter Text, Courier New, monospace";

let plainTextMeasureContext: CanvasRenderingContext2D | null | undefined;

type PlainTextBlockMetrics = {
  width: number;
  height: number;
  baselineY: number;
  midLineY: number;
};

export function resolveNodeLayout(
  text: string,
  options: PathOptionItem["options"] | undefined,
  style: ResolvedStyle,
  _transformScale = 1,
  textEngine: NodeTextEngine | null = null,
  textMode: "text" | "math" = "text",
  textSourceMap?: TextSourceMap,
  graphicsResolver?: NodeTextGraphicsResolver,
  colorResolver?: NodeTextColorResolver
): NodeLayout {
  void _transformScale;
  const fontSize = style.fontSize;
  const charWidth = fontSize * 0.7;
  const lineHeight = fontSize * 1.05;

  const defaultInner = parseLength(".3333em", "pt")!;
  let innerXSep = defaultInner;
  let innerYSep = defaultInner;
  let textWidth: number | null = null;
  let minWidth = parseLength("1pt", "pt")!;
  let minHeight = parseLength("1pt", "pt")!;
  let minSize: number | null = null;
  let textHeightOverride: number | null = null;
  let textDepthOverride: number | null = null;

  let outerSep = style.lineWidth / 2;
  let outerXSep: number | null = null;
  let outerYSep: number | null = null;
  let explicitAlign: ResolvedStyle["textAlign"] | null = null;
  let hasNoWidthHalignHeader = false;

  if (options) {
    for (const entry of options.entries) {
      if (entry.kind !== "kv") {
        continue;
      }

      if (entry.key === "inner sep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerXSep = parsed;
          innerYSep = parsed;
        }
      } else if (entry.key === "inner xsep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerXSep = parsed;
        }
      } else if (entry.key === "inner ysep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerYSep = parsed;
        }
      } else if (entry.key === "text width") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          textWidth = Math.max(0, parsed);
        }
      } else if (entry.key === "align") {
        const parsed = parseAlignOption(entry.valueRaw);
        if (parsed != null) {
          explicitAlign = parsed;
        }
      } else if (entry.key === "node halign header") {
        hasNoWidthHalignHeader = normalizeOptionValue(entry.valueRaw).trim().length > 0;
      } else if (entry.key === "minimum width") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minWidth = Math.max(0, parsed);
        }
      } else if (entry.key === "minimum height") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minHeight = Math.max(0, parsed);
        }
      } else if (entry.key === "minimum size") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minSize = Math.max(0, parsed);
        }
      } else if (entry.key === "text height") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          textHeightOverride = Math.max(0, parsed);
        }
      } else if (entry.key === "text depth") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          textDepthOverride = Math.max(0, parsed);
        }
      } else if (entry.key === "outer sep") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
        if (normalized === "auto") {
          outerSep = style.stroke && style.stroke !== "none" ? style.lineWidth / 2 : 0;
        } else {
          const parsed = parseLength(entry.valueRaw, "pt");
          if (parsed != null) {
            outerSep = parsed;
          }
        }
      } else if (entry.key === "outer xsep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          outerXSep = parsed;
        }
      } else if (entry.key === "outer ysep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          outerYSep = parsed;
        }
      }
    }
  }

  const noWidthHalignEnabled = (explicitAlign != null && explicitAlign !== "none") || hasNoWidthHalignHeader;
  const explicitLineBreaksActive = textWidth != null || noWidthHalignEnabled;
  const normalizedText = normalizeTextForLineBreakPolicy(text, explicitLineBreaksActive);
  const normalizedTextSourceMap = textSourceMap
    ? mapTransformedTextWithFallback(
        { text, sourceMap: textSourceMap },
        normalizedText,
        "node line-break policy normalization"
      ).sourceMap
    : undefined;

  // TikZ's `matrix of math nodes` implements math-mode cells as
  // `execute at begin node=$` / `execute at end node=$` (tikzlibrarymatrix.code.tex),
  // i.e. plain `$` toggles around the node text — so a cell that contains its own
  // `$...$` escapes back to text. Mirror that desugaring here and measure the
  // wrapped text in text mode, which routes it through the native TeX engine.
  const mathModeWrap = textMode === "math" && normalizedText.trim().length > 0;
  const measureText = mathModeWrap ? `$${normalizedText}$` : normalizedText;
  const measureMode = mathModeWrap ? "text" : textMode;
  const measureSourceMap = mathModeWrap
    ? wrapMathModeSourceMap(normalizedText, normalizedTextSourceMap)
    : normalizedTextSourceMap;

  let textRenderInfo: NodeTextRenderInfo = { mode: "plain" };
  let textLines = computeNodeTextLines(normalizedText, textWidth, charWidth);
  let textNaturalWidth: number;
  let textNaturalHeight: number;
  let baseLineY = -fontSize * 0.28;
  let midLineY = -fontSize * 0.065;
  const paragraphAlignment = resolveParagraphAlignment(textWidth, explicitAlign);
  const layoutKind = resolveTextLayoutKind(text, textWidth, explicitLineBreaksActive);

  const measuredText = (() => {
    try {
      return textEngine?.measure({
        text: measureText,
        mode: measureMode,
        textWidthPt: textWidth,
        alignment: paragraphAlignment,
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        fontFamily: style.fontFamily,
        fontSizePt: style.fontSize,
        ...(measureSourceMap ? { sourceMap: measureSourceMap } : {}),
        ...(graphicsResolver ? { graphicsResolver } : {}),
        ...(colorResolver ? { colorResolver } : {})
      }) ?? null;
    } catch {
      return null;
    }
  })();

  if (measuredText) {
    // We trust MathJax for block metrics/wrapping; line-level alignment inside the block is best-effort for now.
    textLines = splitNodeLines(normalizedText);
    textNaturalWidth = measuredText.width;
    textNaturalHeight = measuredText.height;
    baseLineY = measuredText.baselineY;
    midLineY = measuredText.midLineY;
    textRenderInfo = {
      mode: "mathjax",
      cacheKey: measuredText.cacheKey,
      paragraphId: measuredText.paragraphId,
      renderSourceText: measuredText.renderSourceText,
      layoutKind,
      paragraphAlignment
    };
  } else {
    const plainMetrics = measurePlainTextBlock(textLines, style, charWidth, lineHeight, baseLineY, midLineY);
    textNaturalWidth = plainMetrics.width;
    textNaturalHeight = plainMetrics.height;
    baseLineY = plainMetrics.baselineY;
    midLineY = plainMetrics.midLineY;
  }

  // Empty node text should not contribute a synthetic baseline line box
  // unless explicit text metrics were requested.
  if (normalizedText.length === 0 && textHeightOverride == null && textDepthOverride == null) {
    textLines = [""];
    textNaturalWidth = 0;
    textNaturalHeight = 0;
    baseLineY = 0;
    midLineY = 0;
  }

  const resolvedMinWidth = Math.max(minWidth, minSize ?? minWidth);
  const resolvedMinHeight = Math.max(minHeight, minSize ?? minHeight);
  const measuredTextWidth = textWidth != null ? Math.max(textNaturalWidth, textWidth) : textNaturalWidth;
  const effectiveTextHeight =
    textHeightOverride != null || textDepthOverride != null
      ? Math.max(0, (textHeightOverride ?? 0) + (textDepthOverride ?? 0))
      : textNaturalHeight;
  const naturalWidth = measuredTextWidth + innerXSep * 2;
  const naturalHeight = effectiveTextHeight + innerYSep * 2;
  const visualWidth = Math.max(naturalWidth, resolvedMinWidth);
  const visualHeight = Math.max(naturalHeight, resolvedMinHeight);
  const resolvedOuterX = outerXSep ?? outerSep;
  const resolvedOuterY = outerYSep ?? outerSep;

  return {
    textLines,
    textBlockWidth: measuredTextWidth,
    textBlockHeight: textNaturalHeight,
    textRenderInfo,
    naturalWidth,
    naturalHeight,
    minimumWidth: resolvedMinWidth,
    minimumHeight: resolvedMinHeight,
    lineWidth: style.lineWidth,
    outerXSep: resolvedOuterX,
    outerYSep: resolvedOuterY,
    visualWidth,
    visualHeight,
    visualRadius: Math.max(visualWidth, visualHeight) / 2,
    anchorHalfWidth: visualWidth / 2 + resolvedOuterX,
    anchorHalfHeight: visualHeight / 2 + resolvedOuterY,
    anchorRadius: Math.max(visualWidth / 2 + resolvedOuterX, visualHeight / 2 + resolvedOuterY),
    baseLineY,
    midLineY
  };
}

const MATH_MODE_DELIMITER_REASON = "math-mode node delimiter";

/**
 * Extends the node's source map across the synthetic `$` delimiters so caret
 * and hit mapping keep pointing at the user's cell text rather than shifting
 * by one for the generated dollars.
 */
function wrapMathModeSourceMap(
  text: string,
  sourceMap: TextSourceMap | undefined
): TextSourceMap | undefined {
  if (!sourceMap) {
    return undefined;
  }
  const openOwner = zeroLengthOwnerAt(sourceMap, 0);
  const closeOwner = zeroLengthOwnerAt(sourceMap, text.length);
  return concatMappedText([
    createGeneratedMappedText("$", MATH_MODE_DELIMITER_REASON, openOwner),
    { text, sourceMap },
    createGeneratedMappedText("$", MATH_MODE_DELIMITER_REASON, closeOwner)
  ]).sourceMap;
}

function zeroLengthOwnerAt(sourceMap: TextSourceMap, inputOffset: number): TextSourceRange | undefined {
  const hit = projectInputOffset(sourceMap, inputOffset);
  if (hit.kind === "source-offset") {
    return { from: hit.offset, to: hit.offset };
  }
  if (hit.kind === "source-range") {
    return { from: hit.from, to: hit.to };
  }
  return undefined;
}

function resolveTextLayoutKind(text: string, textWidth: number | null, explicitLineBreaksActive: boolean): NodeTextLayoutKind {
  if (explicitLineBreaksActive && hasExplicitLineBreakTokens(text)) {
    return "explicit-multiline";
  }
  if (textWidth != null) {
    return "wrapped";
  }
  return "single-line";
}

export function adjustNodeLayoutForShape(layout: NodeLayout, shape: NodeShape): NodeLayout {
  if (shape === "ellipse" || shape === "ellipse callout") {
    const naturalHalfWidth = layout.naturalWidth / 2;
    const naturalHalfHeight = layout.naturalHeight / 2;
    const minimumHalfWidth = layout.minimumWidth / 2;
    const minimumHalfHeight = layout.minimumHeight / 2;

    const drawHalfWidth = Math.max(naturalHalfWidth * Math.SQRT2, minimumHalfWidth);
    const drawHalfHeight = Math.max(naturalHalfHeight * Math.SQRT2, minimumHalfHeight);
    const anchorHalfWidth = drawHalfWidth + layout.outerXSep;
    const anchorHalfHeight = drawHalfHeight + layout.outerYSep;

    return {
      ...layout,
      visualWidth: drawHalfWidth * 2,
      visualHeight: drawHalfHeight * 2,
      visualRadius: Math.max(drawHalfWidth, drawHalfHeight),
      anchorHalfWidth,
      anchorHalfHeight,
      anchorRadius: Math.max(anchorHalfWidth, anchorHalfHeight)
    };
  }

  if (shape === "circle" || shape === "magnifying glass") {
    const naturalHalfWidth = layout.naturalWidth / 2;
    const naturalHalfHeight = layout.naturalHeight / 2;
    const minimumHalfWidth = layout.minimumWidth / 2;
    const minimumHalfHeight = layout.minimumHeight / 2;

    const drawRadius = Math.max(Math.hypot(naturalHalfWidth, naturalHalfHeight), minimumHalfWidth, minimumHalfHeight);
    const outerSep = Math.max(layout.outerXSep, layout.outerYSep);
    const anchorRadius = drawRadius + outerSep;

    return {
      ...layout,
      visualWidth: drawRadius * 2,
      visualHeight: drawRadius * 2,
      visualRadius: drawRadius,
      anchorHalfWidth: anchorRadius,
      anchorHalfHeight: anchorRadius,
      anchorRadius
    };
  }

  return layout;
}

function splitNodeLines(text: string): string[] {
  const parts = text.replace(EXPLICIT_LINE_BREAK_PATTERN, "\n").split("\n");
  if (parts.length === 0) {
    return [""];
  }
  return parts;
}

function computeNodeTextLines(text: string, textWidth: number | null, charWidth: number): string[] {
  const explicitLines = splitNodeLines(text);
  if (textWidth == null || textWidth <= 0 || charWidth <= 0) {
    return explicitLines;
  }

  const maxChars = Math.max(1, Math.floor(textWidth / charWidth));
  const wrapped: string[] = [];
  for (const line of explicitLines) {
    wrapped.push(...wrapLine(line, maxChars));
  }
  return wrapped.length > 0 ? wrapped : [""];
}

function measurePlainTextBlock(
  lines: string[],
  style: ResolvedStyle,
  fallbackCharWidth: number,
  fallbackLineHeight: number,
  fallbackBaselineY: number,
  fallbackMidLineY: number
): PlainTextBlockMetrics {
  const context = getPlainTextMeasureContext();
  if (context) {
    applyPlainTextMeasureFont(context, style);
    let measuredWidth = 0;
    let measuredAscent = 0;
    let measuredDescent = 0;
    for (const line of lines) {
      const metrics = context.measureText(line);
      if (Number.isFinite(metrics.width) && metrics.width > measuredWidth) {
        measuredWidth = metrics.width;
      }
      const ascent = resolvePlainTextMetric(metrics, "fontBoundingBoxAscent", "actualBoundingBoxAscent");
      const descent = resolvePlainTextMetric(metrics, "fontBoundingBoxDescent", "actualBoundingBoxDescent");
      if (ascent != null) {
        measuredAscent = Math.max(measuredAscent, ascent);
      }
      if (descent != null) {
        measuredDescent = Math.max(measuredDescent, descent);
      }
    }
    if (measuredWidth > 0) {
      const measuredLineHeight = measuredAscent + measuredDescent;
      const lineHeight = measuredLineHeight > 0 ? measuredLineHeight : fallbackLineHeight;
      const lineGap = Math.max(style.fontSize * 1.15, lineHeight);
      const height = lineHeight + Math.max(0, lines.length - 1) * lineGap;
      const baselineY = measuredLineHeight > 0 ? (measuredDescent - measuredAscent) / 2 : fallbackBaselineY;
      const midLineY = measuredLineHeight > 0 ? 0 : fallbackMidLineY;
      return {
        width: measuredWidth,
        height,
        baselineY,
        midLineY
      };
    }
  }

  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    width: maxLineLength * fallbackCharWidth,
    height: lines.length * fallbackLineHeight,
    baselineY: fallbackBaselineY,
    midLineY: fallbackMidLineY
  };
}

function resolvePlainTextMetric(
  metrics: TextMetrics,
  preferredKey: "fontBoundingBoxAscent" | "fontBoundingBoxDescent",
  fallbackKey: "actualBoundingBoxAscent" | "actualBoundingBoxDescent"
): number | null {
  const preferred = metrics[preferredKey];
  if (Number.isFinite(preferred) && preferred > 0) {
    return preferred;
  }
  const fallback = metrics[fallbackKey];
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

function getPlainTextMeasureContext(): CanvasRenderingContext2D | null {
  if (plainTextMeasureContext !== undefined) {
    return plainTextMeasureContext;
  }

  const userAgent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  if (typeof userAgent === "string" && userAgent.includes("jsdom")) {
    plainTextMeasureContext = null;
    return plainTextMeasureContext;
  }

  const documentLike = (globalThis as { document?: { createElement?: (tagName: string) => unknown } }).document;
  if (typeof documentLike?.createElement !== "function") {
    return null;
  }

  const canvas = documentLike.createElement("canvas") as { getContext?: (contextId: "2d") => CanvasRenderingContext2D | null };
  try {
    plainTextMeasureContext = typeof canvas?.getContext === "function" ? canvas.getContext("2d") : null;
  } catch {
    plainTextMeasureContext = null;
  }
  return plainTextMeasureContext;
}

function applyPlainTextMeasureFont(context: CanvasRenderingContext2D, style: ResolvedStyle): void {
  const fontStyle = style.fontStyle === "italic" ? "italic " : "";
  const fontWeight = style.fontWeight === "bold" ? "bold " : "";
  const fontFamily =
    style.fontFamily === "sans"
      ? PLAIN_TEXT_SANS_FONT_STACK
      : style.fontFamily === "monospace"
        ? PLAIN_TEXT_MONO_FONT_STACK
        : PLAIN_TEXT_SERIF_FONT_STACK;
  context.font = `${fontStyle}${fontWeight}${Math.max(1, style.fontSize)}px ${fontFamily}`;
}

function resolveParagraphAlignment(
  textWidth: number | null,
  explicitAlign: ResolvedStyle["textAlign"] | null
): NodeTextParagraphAlignment | undefined {
  if (textWidth == null || textWidth <= 0) {
    if (explicitAlign == null || explicitAlign === "none") {
      return undefined;
    }
    if (explicitAlign === "right" || explicitAlign === "flush right") {
      return "ragged-left";
    }
    if (explicitAlign === "center" || explicitAlign === "flush center") {
      return "center";
    }
    return "ragged-right";
  }

  if (explicitAlign == null) {
    return "ragged-right";
  }

  if (explicitAlign === "right" || explicitAlign === "flush right") {
    return "ragged-left";
  }
  if (explicitAlign === "justify" || explicitAlign === "none") {
    return "justified";
  }
  if (explicitAlign === "left" || explicitAlign === "flush left") {
    return "ragged-right";
  }
  if (explicitAlign === "center" || explicitAlign === "flush center") {
    return "center";
  }
  return "ragged-right";
}

function parseAlignOption(valueRaw: string): ResolvedStyle["textAlign"] | null {
  const normalized = normalizeOptionValue(valueRaw).toLowerCase();
  if (
    normalized === "left" ||
    normalized === "flush left" ||
    normalized === "right" ||
    normalized === "flush right" ||
    normalized === "center" ||
    normalized === "flush center" ||
    normalized === "justify" ||
    normalized === "none"
  ) {
    return normalized;
  }
  return null;
}

function hasExplicitLineBreakTokens(text: string): boolean {
  return EXPLICIT_LINE_BREAK_TOKEN_PATTERN.test(text);
}

function normalizeTextForLineBreakPolicy(text: string, explicitLineBreaksActive: boolean): string {
  if (explicitLineBreaksActive) {
    return text.replace(EXPLICIT_LINE_BREAK_CANONICAL_PATTERN, "$1");
  }
  return text.replace(EXPLICIT_LINE_BREAK_PATTERN, "");
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) {
    return [line];
  }

  const words = line.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [line];
  }

  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      if (word.length <= maxChars) {
        current = word;
      } else {
        result.push(...splitLongWord(word, maxChars));
      }
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    result.push(current);
    if (word.length <= maxChars) {
      current = word;
    } else {
      const chunks = splitLongWord(word, maxChars);
      result.push(...chunks.slice(0, -1));
      current = chunks[chunks.length - 1] ?? "";
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result.length > 0 ? result : [line];
}

function splitLongWord(word: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxChars) {
    chunks.push(word.slice(index, index + maxChars));
  }
  return chunks.length > 0 ? chunks : [word];
}
