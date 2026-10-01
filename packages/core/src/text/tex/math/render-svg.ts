import type { GeneratedTexFont, ResolvedTexFont } from "../fonts/types.js";
import { texGlyphSvgPath } from "../fonts/glyph-svg.js";
import {
  texHBoxX,
  texHBoxY,
  translateTexHBoxX,
  translateTexHBoxY,
  type TexHBoxX,
  type TexHBoxY,
} from "../coordinates.js";
import {
  defaultTexMathFontProfile,
  type TexMathFontProfile,
} from "./font-profile.js";
import type {
  TexMathGlyphLayoutItem,
  TexMathHList,
  TexMathHListItem,
  TexMathRuleLayoutItem,
} from "./layout.js";

/** Internal SVG coordinate units emitted for one TeX point. */
export const TEX_MATH_SVG_UNITS_PER_PT = 100;

export interface TexMathSvgRenderOptions {
  readonly fontProfile?: TexMathFontProfile;
}

export interface TexMathGlyphVisualBounds {
  readonly xStart: TexHBoxX;
  readonly xEnd: TexHBoxX;
  readonly yStart: TexHBoxY;
  readonly yEnd: TexHBoxY;
}

export function renderTexMathHListSvgBody(
  hlist: TexMathHList,
  options: TexMathSvgRenderOptions = {}
): string {
  const fontProfile = options.fontProfile ?? defaultTexMathFontProfile;
  const pieces = [
    `<g data-tex-math-hlist="true" data-tex-math-style="${escapeXmlAttribute(hlist.style)}" data-source-start="${hlist.sourceSpan.start}" data-source-end="${hlist.sourceSpan.end}">`,
  ];
  pieces.push(...renderMathHListItems(
    hlist.items,
    fontProfile,
    texHBoxX(0),
    texHBoxY(0)
  ));
  pieces.push("</g>");
  return pieces.join("");
}

export function texMathGlyphVisualBounds(
  item: TexMathGlyphLayoutItem,
  fontProfile: TexMathFontProfile = defaultTexMathFontProfile,
  originX = 0,
  originY = 0
): TexMathGlyphVisualBounds | null {
  const font = fontProfile.metricProvider.resolveFont({
    fontId: item.fontId,
    atPt: item.atPt,
  });
  const d = font.data.glyphs?.[String(item.code)] ?? "";
  if (!d) {
    return null;
  }
  const hboxOriginX = texHBoxX(originX);
  const hboxOriginY = texHBoxY(originY);
  const scale = font.atPt / 10;
  const glyphX = translateTexHBoxX(hboxOriginX, item.x);
  const glyphY = translateTexHBoxY(hboxOriginY, item.y);
  const bounds = glyphControlPointBounds(font.data, item.code, d);
  if (!bounds) return null;
  const x1 = glyphX + bounds.xMin * scale;
  const x2 = glyphX + bounds.xMax * scale;
  const y1 = glyphY + bounds.yMin * scale;
  const y2 = glyphY + bounds.yMax * scale;
  return {
    xStart: texHBoxX(Math.min(x1, x2)),
    xEnd: texHBoxX(Math.max(x1, x2)),
    yStart: texHBoxY(Math.min(y1, y2)),
    yEnd: texHBoxY(Math.max(y1, y2)),
  };
}

function renderMathHListItems(
  items: readonly TexMathHListItem[],
  fontProfile: TexMathFontProfile,
  originX: TexHBoxX,
  originY: TexHBoxY
): string[] {
  const pieces: string[] = [];
  for (const item of items) {
    if (item.kind === "hlist") {
      pieces.push([
        `<g data-tex-math-role="${escapeXmlAttribute(item.role)}"`,
        ` data-source-start="${item.sourceSpan.start}"`,
        ` data-source-end="${item.sourceSpan.end}"`,
        item.color
          ? ` fill="${escapeXmlAttribute(item.color)}" stroke="none"`
          : "",
        ">",
      ].join(""));
      pieces.push(...renderMathHListItems(
        item.items,
        fontProfile,
        translateTexHBoxX(originX, item.x),
        translateTexHBoxY(originY, item.y)
      ));
      pieces.push("</g>");
      continue;
    }
    if (item.kind === "rule") {
      pieces.push(renderMathRule(item, originX, originY));
      continue;
    }
    if (item.kind !== "glyph") {
      continue;
    }
    const font = fontProfile.metricProvider.resolveFont({
      fontId: item.fontId,
      atPt: item.atPt,
    });
    const path = renderMathGlyphPath(item, font, originX, originY);
    if (path) {
      pieces.push(path);
    }
  }
  return pieces;
}

function renderMathRule(
  item: TexMathRuleLayoutItem,
  originX: TexHBoxX,
  originY: TexHBoxY
): string {
  const x = translateTexHBoxX(originX, item.x);
  const y = translateTexHBoxY(originY, item.y);
  return [
    `<rect data-tex-rule="${escapeXmlAttribute(item.role)}"`,
    ` data-source-start="${item.sourceSpan.start}"`,
    ` data-source-end="${item.sourceSpan.end}"`,
    ` x="${formatSvgNumber(x * TEX_MATH_SVG_UNITS_PER_PT)}"`,
    ` y="${formatSvgNumber(y * TEX_MATH_SVG_UNITS_PER_PT)}"`,
    ` width="${formatSvgNumber(item.width * TEX_MATH_SVG_UNITS_PER_PT)}"`,
    ` height="${formatSvgNumber(item.height * TEX_MATH_SVG_UNITS_PER_PT)}"`,
    item.color
      ? ` fill="${escapeXmlAttribute(item.color)}" stroke="none"`
      : "",
    " />",
  ].join("");
}

function renderMathGlyphPath(
  item: TexMathGlyphLayoutItem,
  font: ResolvedTexFont,
  originX: TexHBoxX,
  originY: TexHBoxY
): string {
  const d = texGlyphSvgPath(font, item.code);
  if (!d) {
    return "";
  }
  const scale = (font.atPt / 10) * TEX_MATH_SVG_UNITS_PER_PT;
  const x = translateTexHBoxX(originX, item.x);
  const y = translateTexHBoxY(originY, item.y);
  return [
    `<path data-tex-font="${escapeXmlAttribute(font.id)}"`,
    ` data-tex-glyph="${item.code}"`,
    ` data-source-start="${item.sourceSpan.start}"`,
    ` data-source-end="${item.sourceSpan.end}"`,
    item.color
      ? ` fill="${escapeXmlAttribute(item.color)}" stroke="none"`
      : "",
    ` d="${d}"`,
    ` transform="translate(${formatSvgNumber(x * TEX_MATH_SVG_UNITS_PER_PT)} ${formatSvgNumber(y * TEX_MATH_SVG_UNITS_PER_PT)}) scale(${formatSvgNumber(scale)})" />`,
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
  if (Number.isInteger(value)) {
    return String(value);
  }
  return Number(value.toFixed(6)).toString();
}

interface PathPoint {
  readonly x: number;
  readonly y: number;
}

interface GlyphControlPointBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
}

const controlPointBounds = new WeakMap<GeneratedTexFont, Map<number, {
  readonly source: string;
  readonly bounds: GlyphControlPointBounds | null;
}>>();

function glyphControlPointBounds(
  font: GeneratedTexFont,
  code: number,
  source: string
): GlyphControlPointBounds | null {
  let glyphs = controlPointBounds.get(font);
  const cached = glyphs?.get(code);
  if (cached?.source === source) return cached.bounds;
  const points = svgPathControlPoints(source);
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const point of points) {
    xMin = Math.min(xMin, point.x);
    xMax = Math.max(xMax, point.x);
    yMin = Math.min(yMin, point.y);
    yMax = Math.max(yMax, point.y);
  }
  const bounds = points.length ? { xMin, xMax, yMin, yMax } : null;
  if (!glyphs) {
    glyphs = new Map();
    controlPointBounds.set(font, glyphs);
  }
  glyphs.set(code, { source, bounds });
  return bounds;
}

function svgPathControlPoints(d: string): PathPoint[] {
  const tokens = [...d.matchAll(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)].map((match) => match[0] ?? "");
  const points: PathPoint[] = [];
  let index = 0;
  let command = "";
  let current: PathPoint = { x: 0, y: 0 };
  let subpathStart: PathPoint = current;
  const isCommand = (token: string | undefined) => Boolean(token && /^[a-zA-Z]$/.test(token));
  const hasNumber = () => index < tokens.length && !isCommand(tokens[index]);
  const readNumber = () => Number(tokens[index++]);
  const addPoint = (point: PathPoint) => {
    current = point;
    points.push(current);
  };
  const absolutePoint = (origin: PathPoint, x: number, y: number, relative: boolean): PathPoint => ({
    x: relative ? origin.x + x : x,
    y: relative ? origin.y + y : y,
  });
  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++] ?? "";
    }
    const relative = command === command.toLowerCase();
    switch (command.toUpperCase()) {
      case "M": {
        let first = true;
        while (hasNumber()) {
          const origin = current;
          addPoint(absolutePoint(origin, readNumber(), readNumber(), relative));
          if (first) {
            subpathStart = current;
            first = false;
          }
        }
        break;
      }
      case "L":
      case "T": {
        while (hasNumber()) {
          const origin = current;
          addPoint(absolutePoint(origin, readNumber(), readNumber(), relative));
        }
        break;
      }
      case "H": {
        while (hasNumber()) {
          const x = readNumber();
          addPoint({ x: relative ? current.x + x : x, y: current.y });
        }
        break;
      }
      case "V": {
        while (hasNumber()) {
          const y = readNumber();
          addPoint({ x: current.x, y: relative ? current.y + y : y });
        }
        break;
      }
      case "C": {
        while (hasNumber()) {
          const origin = current;
          const firstControl = absolutePoint(origin, readNumber(), readNumber(), relative);
          const secondControl = absolutePoint(origin, readNumber(), readNumber(), relative);
          const end = absolutePoint(origin, readNumber(), readNumber(), relative);
          points.push(firstControl, secondControl);
          addPoint(end);
        }
        break;
      }
      case "S":
      case "Q": {
        while (hasNumber()) {
          const origin = current;
          const control = absolutePoint(origin, readNumber(), readNumber(), relative);
          const end = absolutePoint(origin, readNumber(), readNumber(), relative);
          points.push(control);
          addPoint(end);
        }
        break;
      }
      case "A": {
        while (hasNumber()) {
          const origin = current;
          readNumber();
          readNumber();
          readNumber();
          readNumber();
          readNumber();
          addPoint(absolutePoint(origin, readNumber(), readNumber(), relative));
        }
        break;
      }
      case "Z": {
        addPoint(subpathStart);
        break;
      }
      default:
        index += 1;
    }
  }
  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}
