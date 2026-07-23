import { formatSvgNumber as fmt } from "../../svg/format.js";
import { texLength } from "../../text/tex/coordinates.js";
import type { TexListMarkerProfile } from "../../text/tex/layout-options.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import type {
  BeamerThemeTemplateRef,
  ResolvedBeamerTheme,
} from "./types.js";
import { resolveBeamerThemeColor } from "./resolve.js";

const WHITE = "#ffffff";
const BLACK = "#000000";

/**
 * Resolve the active inner-theme item templates into measured marker boxes.
 *
 * The returned SVG uses the text engine's 1000-units-per-em convention, so
 * marker painting, VList box geometry, and editor hit geometry share one box.
 */
export function resolveBeamerItemizeMarkers(
  theme: ResolvedBeamerTheme
): readonly TexListMarkerProfile[] {
  const font = theme.fonts["normal-text"];
  const fontProfile = createBeamerTexTextFontProfile(font);
  const resolvedFont = fontProfile.resolveTextFont(
    fontProfile.defaultFontState,
    texLength(font.sizePt),
    fontProfile.metricProvider
  );
  const xHeightEm = resolvedFont.data.fontdimen.xheight;
  const structure =
    resolveBeamerThemeColor(theme, "item").fg ??
    resolveBeamerThemeColor(theme, "structure").fg ??
    "#3333b3";
  const canvas =
    resolveBeamerThemeColor(theme, "normal text").bg ?? WHITE;

  return theme.templates.bullets.map((template, index) =>
    markerForTemplate({
      template,
      depth: index + 1,
      fontSizePt: font.sizePt,
      xHeightEm,
      structure,
      canvas,
    })
  );
}

function markerForTemplate(params: {
  template: BeamerThemeTemplateRef;
  depth: number;
  fontSizePt: number;
  xHeightEm: number;
  structure: string;
  canvas: string;
}): TexListMarkerProfile {
  const family = params.template.id.split("/").at(-1);
  if (family === "ball") {
    return ballMarker(params);
  }
  if (family === "square") {
    return squareMarker(params);
  }
  if (family === "circle") {
    return circleMarker(params, false);
  }
  if (family === "metropolis") {
    return circleMarker(params, false);
  }
  if (family === "moloch") {
    return circleMarker(params, params.depth === 2);
  }
  return triangleMarker(params);
}

function ballMarker(params: {
  depth: number;
  fontSizePt: number;
  xHeightEm: number;
  structure: string;
  canvas: string;
}): TexListMarkerProfile {
  // beamerbaseauxtemplates.sty declares bigsphere as 1.06ex square and
  // smallsphere as 0.854ex square. All sphere templates restore \normalsize
  // and raise the painted shading by 0.2pt.
  const diameterEm =
    (params.depth === 1 ? 1.06 : 0.854) * params.xHeightEm;
  const raiseEm = 0.2 / params.fontSizePt;
  const size = diameterEm * 1000;
  const raise = raiseEm * 1000;
  const centerX = size / 2;
  const centerY = -(raise + size / 2);
  const id = `beamer-ball-${params.depth}-${sanitizeId(params.structure)}`;
  const pale = mixHex(params.structure, WHITE, 0.15);
  const light = mixHex(params.structure, WHITE, 0.75);
  const dark = mixHex(params.structure, BLACK, 0.7);
  const darker = mixHex(params.structure, BLACK, 0.5);

  return {
    widthEm: diameterEm,
    heightEm: diameterEm + raiseEm,
    depthEm: -raiseEm,
    svgBody:
      `<g data-beamer-list-marker="ball">` +
      `<defs><radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `cx="${fmt(size * 0.326)}" cy="${fmt(-(raise + size * 0.713))}" ` +
      `r="${fmt(size * 0.72)}">` +
      `<stop offset="0" stop-color="${pale}"/>` +
      `<stop offset="0.31" stop-color="${light}"/>` +
      `<stop offset="0.62" stop-color="${dark}"/>` +
      `<stop offset="0.85" stop-color="${darker}"/>` +
      `<stop offset="1" stop-color="${params.canvas}"/>` +
      `</radialGradient></defs>` +
      `<circle cx="${fmt(centerX)}" cy="${fmt(centerY)}" ` +
      `r="${fmt(size / 2)}" fill="url(#${id})"/>` +
      `</g>`,
  };
}

function triangleMarker(params: {
  depth: number;
  fontSizePt: number;
  xHeightEm: number;
  structure: string;
}): TexListMarkerProfile {
  // beamerinnerthemedefault.sty uses a raised \blacktriangleright. Keep the
  // vector template explicit; an oracle pass can refine the math-glyph box
  // without changing list layout or the theme/template boundary.
  const widthEm = 0.78 * params.xHeightEm;
  const paintHeightEm = 0.9 * params.xHeightEm;
  const raiseEm = (params.depth === 1 ? 1.25 : 1.5) / params.fontSizePt;
  const width = widthEm * 1000;
  const bottom = -raiseEm * 1000;
  const top = bottom - paintHeightEm * 1000;
  return {
    widthEm,
    heightEm: paintHeightEm + raiseEm,
    depthEm: -raiseEm,
    svgBody:
      `<path data-beamer-list-marker="triangle" ` +
      `d="M0 ${fmt(top)} L${fmt(width)} ${fmt((top + bottom) / 2)} ` +
      `L0 ${fmt(bottom)} Z" fill="${params.structure}"/>`,
  };
}

function squareMarker(params: {
  depth: number;
  xHeightEm: number;
  structure: string;
}): TexListMarkerProfile {
  // beamerbaseauxtemplates.sty: \vrule width 1ex height 1ex.
  const sizeEm = params.xHeightEm;
  const size = sizeEm * 1000;
  return {
    widthEm: sizeEm,
    heightEm: sizeEm,
    depthEm: 0,
    svgBody:
      `<rect data-beamer-list-marker="square" x="0" y="${fmt(-size)}" ` +
      `width="${fmt(size)}" height="${fmt(size)}" fill="${params.structure}"/>`,
  };
}

function circleMarker(
  params: {
    depth: number;
    xHeightEm: number;
    structure: string;
  },
  outlined: boolean
): TexListMarkerProfile {
  const diameterEm = (params.depth === 1 ? 0.88 : 0.72) * params.xHeightEm;
  const size = diameterEm * 1000;
  const center = size / 2;
  const paint = outlined
    ? `fill="none" stroke="${params.structure}" stroke-width="${fmt(size * 0.16)}"`
    : `fill="${params.structure}"`;
  return {
    widthEm: diameterEm,
    heightEm: diameterEm,
    depthEm: 0,
    svgBody:
      `<circle data-beamer-list-marker="${outlined ? "circle" : "bullet"}" ` +
      `cx="${fmt(center)}" cy="${fmt(-center)}" r="${fmt(size * 0.42)}" ${paint}/>`,
  };
}

function mixHex(left: string, right: string, leftWeight: number): string {
  const leftRgb = parseHex(left);
  const rightRgb = parseHex(right);
  if (!leftRgb || !rightRgb) {
    return left;
  }
  const channel = (index: number) =>
    Math.round(
      leftRgb[index] * leftWeight +
      rightRgb[index] * (1 - leftWeight)
    );
  return `#${[0, 1, 2]
    .map((index) => channel(index).toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseHex(value: string): readonly [number, number, number] | null {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);
  return match
    ? [
        Number.parseInt(match[1], 16),
        Number.parseInt(match[2], 16),
        Number.parseInt(match[3], 16),
      ]
    : null;
}

function sanitizeId(value: string): string {
  return value.replaceAll(/[^a-z0-9_-]/giu, "");
}
