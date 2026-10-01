import type { Span } from "../ast/types.js";
import { formatSvgNumber as fmt } from "../svg/format.js";
import { escapeAttribute } from "./theme/svg-markup.js";
import type { BeamerRect } from "./types.js";

const MAX_PREVIEW_SOURCE_LENGTH = 512;
const MAX_PREVIEW_LINE_LENGTH = 100;
const MAX_PREVIEW_LINES = 3;
const PREVIEW_LINE_HEIGHT_PT = 10;
const PREVIEW_FIRST_BASELINE_PT = 24;
const HORIZONTAL_PADDING_PT = 6;
// Estimated advance for the 7pt monospace preview font.
const PREVIEW_CHARACTER_WIDTH_PT = 4.2;

/** Estimated layout and source preview for an unsupported flow node. */
export type BeamerUnsupportedPlaceholder = {
  id: string;
  sourceSpan: Span;
  message: string;
  width: number;
  height: number;
  lines: string[];
};

export function prepareUnsupportedPlaceholder(
  source: string,
  node: { id: string; span: Span; message: string },
  width: number
): BeamerUnsupportedPlaceholder {
  const charactersPerLine = Math.max(1, Math.min(
    MAX_PREVIEW_LINE_LENGTH,
    Math.floor((width - 2 * HORIZONTAL_PADDING_PT) / PREVIEW_CHARACTER_WIDTH_PT)
  ));
  // Bound scanning as well as output size for large source regions.
  const previewSource = source.slice(
    node.span.from,
    Math.min(node.span.to, node.span.from + MAX_PREVIEW_SOURCE_LENGTH)
  );
  const text = previewSource.trim().replace(/\s+/gu, " ");
  const maxVisibleCharacters = charactersPerLine * MAX_PREVIEW_LINES;
  const isTruncated = text.length > maxVisibleCharacters ||
    node.span.to - node.span.from > MAX_PREVIEW_SOURCE_LENGTH;
  const visibleText = text.slice(0, maxVisibleCharacters);
  const lines: string[] = [];
  for (let offset = 0; offset < visibleText.length; offset += charactersPerLine) {
    lines.push(visibleText.slice(offset, offset + charactersPerLine));
  }
  if (isTruncated && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  }
  return {
    id: node.id,
    sourceSpan: node.span,
    message: node.message,
    width: Math.max(0, width),
    height: PREVIEW_FIRST_BASELINE_PT + Math.max(1, lines.length) * PREVIEW_LINE_HEIGHT_PT,
    lines,
  };
}

export function unsupportedPlaceholderMarkup(
  placeholder: BeamerUnsupportedPlaceholder,
  bounds: BeamerRect
): string {
  // A nested SVG clips even very narrow columns without introducing shared IDs.
  const sourceMarkup = placeholder.lines.map((line, index) => {
    const baseline = PREVIEW_FIRST_BASELINE_PT + index * PREVIEW_LINE_HEIGHT_PT;
    return (
      `<text x="${HORIZONTAL_PADDING_PT}" y="${baseline}" font-family="monospace" font-size="7">` +
      `${escapeAttribute(line)}</text>`
    );
  }).join("");
  return (
    `<svg data-beamer-placeholder="${escapeAttribute(placeholder.id)}" ` +
    `x="${fmt(bounds.x)}" y="${fmt(bounds.y)}" ` +
    `width="${fmt(bounds.width)}" height="${fmt(bounds.height)}" overflow="hidden">` +
    `<title>${escapeAttribute(placeholder.message)} — Select to edit source</title>` +
    `<rect x="0.5" y="0.5" width="${fmt(Math.max(0, bounds.width - 1))}" ` +
    `height="${fmt(Math.max(0, bounds.height - 1))}" rx="2" ` +
    `fill="#f3f4f6" stroke="#9ca3af" stroke-dasharray="3 2"/>` +
    `<g fill="#4b5563">` +
    `<text x="${HORIZONTAL_PADDING_PT}" y="12" font-family="sans-serif" font-size="8">` +
    `Unsupported content</text>${sourceMarkup}</g></svg>`
  );
}
