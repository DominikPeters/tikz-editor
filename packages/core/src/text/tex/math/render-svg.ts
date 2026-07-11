import type { ResolvedTexFont } from "../fonts/types.js";
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

const SVG_UNIT_SCALE = 100;

export interface TexMathSvgRenderOptions {
  readonly fontProfile?: TexMathFontProfile;
}

export interface TexMathGlyphVisualBounds {
  readonly xStart: number;
  readonly xEnd: number;
  readonly yStart: number;
  readonly yEnd: number;
}

export function renderTexMathHListSvgBody(
  hlist: TexMathHList,
  options: TexMathSvgRenderOptions = {}
): string {
  const fontProfile = options.fontProfile ?? defaultTexMathFontProfile;
  const pieces = [
    `<g data-tex-math-hlist="true" data-tex-math-style="${escapeXmlAttribute(hlist.style)}" data-source-start="${hlist.sourceSpan.start}" data-source-end="${hlist.sourceSpan.end}">`,
  ];
  pieces.push(...renderMathHListItems(hlist.items, fontProfile, 0, 0));
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
  const scale = font.atPt / 10;
  const points = svgPathControlPoints(d).map((point) => ({
    x: originX + item.x + point.x * scale,
    y: originY + item.y + point.y * scale,
  }));
  if (!points.length) {
    return null;
  }
  return {
    xStart: Math.min(...points.map((point) => point.x)),
    xEnd: Math.max(...points.map((point) => point.x)),
    yStart: Math.min(...points.map((point) => point.y)),
    yEnd: Math.max(...points.map((point) => point.y)),
  };
}

function renderMathHListItems(
  items: readonly TexMathHListItem[],
  fontProfile: TexMathFontProfile,
  originX: number,
  originY: number
): string[] {
  const pieces: string[] = [];
  for (const item of items) {
    if (item.kind === "hlist") {
      pieces.push([
        `<g data-tex-math-role="${escapeXmlAttribute(item.role)}"`,
        ` data-source-start="${item.sourceSpan.start}"`,
        ` data-source-end="${item.sourceSpan.end}"`,
        item.color
          ? ` fill="${escapeXmlAttribute(item.color)}" stroke="${escapeXmlAttribute(item.color)}"`
          : "",
        ">",
      ].join(""));
      pieces.push(...renderMathHListItems(
        item.items,
        fontProfile,
        originX + item.x,
        originY + item.y
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
  originX: number,
  originY: number
): string {
  return [
    `<rect data-tex-rule="${escapeXmlAttribute(item.role)}"`,
    ` data-source-start="${item.sourceSpan.start}"`,
    ` data-source-end="${item.sourceSpan.end}"`,
    ` x="${formatSvgNumber((originX + item.x) * SVG_UNIT_SCALE)}"`,
    ` y="${formatSvgNumber((originY + item.y) * SVG_UNIT_SCALE)}"`,
    ` width="${formatSvgNumber(item.width * SVG_UNIT_SCALE)}"`,
    ` height="${formatSvgNumber(item.height * SVG_UNIT_SCALE)}"`,
    item.color
      ? ` fill="${escapeXmlAttribute(item.color)}" stroke="none"`
      : "",
    " />",
  ].join("");
}

function renderMathGlyphPath(
  item: TexMathGlyphLayoutItem,
  font: ResolvedTexFont,
  originX: number,
  originY: number
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
    item.color
      ? ` fill="${escapeXmlAttribute(item.color)}" stroke="${escapeXmlAttribute(item.color)}"`
      : "",
    ` d="${escapeXmlAttribute(d)}"`,
    ` transform="translate(${formatSvgNumber((originX + item.x) * SVG_UNIT_SCALE)} ${formatSvgNumber((originY + item.y) * SVG_UNIT_SCALE)}) scale(${formatSvgNumber(scale)})" />`,
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

interface PathPoint {
  readonly x: number;
  readonly y: number;
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
