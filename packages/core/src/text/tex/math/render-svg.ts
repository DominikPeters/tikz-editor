import type { ResolvedTexFont } from "../fonts/types.js";
import {
  defaultTexMathFontProfile,
  type TexMathFontProfile,
} from "./font-profile.js";
import type {
  TexMathGlyphLayoutItem,
  TexMathHList,
} from "./layout.js";

const SVG_UNIT_SCALE = 100;

export interface TexMathSvgRenderOptions {
  readonly fontProfile?: TexMathFontProfile;
}

export function renderTexMathHListSvgBody(
  hlist: TexMathHList,
  options: TexMathSvgRenderOptions = {}
): string {
  const fontProfile = options.fontProfile ?? defaultTexMathFontProfile;
  const pieces = [
    `<g data-tex-math-hlist="true" data-tex-math-style="${escapeXmlAttribute(hlist.style)}" data-source-start="${hlist.sourceSpan.start}" data-source-end="${hlist.sourceSpan.end}">`,
  ];
  for (const item of hlist.items) {
    if (item.kind !== "glyph") {
      continue;
    }
    const font = fontProfile.metricProvider.resolveFont({
      fontId: item.fontId,
      atPt: item.atPt,
    });
    const path = renderMathGlyphPath(item, font);
    if (path) {
      pieces.push(path);
    }
  }
  pieces.push("</g>");
  return pieces.join("");
}

function renderMathGlyphPath(
  item: TexMathGlyphLayoutItem,
  font: ResolvedTexFont
): string {
  const d = font.data.glyphs?.[String(item.code)] ?? "";
  if (!d) {
    return "";
  }
  const scale = (font.atPt / 10) * SVG_UNIT_SCALE;
  return [
    `<path data-tex-font="${escapeXmlAttribute(font.id)}"`,
    ` data-tex-glyph="${item.code}"`,
    ` data-source-start="${item.sourceSpan.start}"`,
    ` data-source-end="${item.sourceSpan.end}"`,
    ` d="${escapeXmlAttribute(d)}"`,
    ` transform="translate(${formatSvgNumber(item.x * SVG_UNIT_SCALE)} 0) scale(${formatSvgNumber(scale)})" />`,
  ].join("");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Number(value.toFixed(6)).toString();
}
