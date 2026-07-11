import { DEFAULT_TEXT_FONT_SIZE, FONT_SIZE_COMMAND_FACTORS } from "../style/constants.js";
import { stripWrappingBraces } from "../../utils/braces.js";

export function normalizeEscapedTextSpaces(text: string): string {
  if (text.length === 0) {
    return text;
  }

  // Preserve `\\ ` (line break command followed by whitespace) while still
  // normalizing the `\ ` escaped-space command.
  return text.replaceAll("\\space", " ").replace(/(^|[^\\])\\ /g, "$1 ");
}

const FONT_SIZE_COMMAND_PATTERN = new RegExp(
  String.raw`^\s*(\\(?:tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|pgfutil@font@tiny|pgfutil@font@scriptsize|pgfutil@font@footnotesize|pgfutil@font@small|pgfutil@font@normalsize|pgfutil@font@large|pgfutil@font@Large|pgfutil@font@LARGE|pgfutil@font@huge|pgfutil@font@Huge)\b|\\fontsize\s*\{\s*([^{}]+?)\s*\}\s*\{\s*[^{}]*?\s*\}\s*\\selectfont)\s*`
);

export type NormalizedNodeText = {
  text: string;
  fontSizePt: number;
};

/**
 * Remove inline font-size switches from node text and apply their effect to the
 * effective font size used for measurement and rendering.
 */
export function normalizeNodeTextFontSize(text: string, baseFontSizePt: number): NormalizedNodeText {
  if (text.length === 0) {
    return { text, fontSizePt: baseFontSizePt };
  }

  let fontSizePt = baseFontSizePt;
  const unwrappedText = stripWrappingBraces(text);
  const normalizedText = unwrappedText.replace(
    FONT_SIZE_COMMAND_PATTERN,
    (_match, command: string, fontsizeValue?: string) => {
      if (command.trimStart().startsWith("\\fontsize")) {
        const parsed = parseFontSizeValue(fontsizeValue);
        if (parsed != null) {
          fontSizePt = parsed;
        }
        return "";
      }

      const factor = FONT_SIZE_COMMAND_FACTORS[command.trim()];
      if (factor != null) {
        fontSizePt = DEFAULT_TEXT_FONT_SIZE * factor;
      }
      return "";
    }
  );

  return {
    text: stripWrappingBraces(normalizedText),
    fontSizePt
  };
}

function parseFontSizeValue(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw.trim().replace(/pt$/u, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}
