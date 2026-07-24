import { formatSvgNumber as fmt } from "../../svg/format.js";
import { texLength } from "../../text/tex/coordinates.js";
import type { TexListMarkerProfile } from "../../text/tex/layout-options.js";
import type { ResolvedTexFont } from "../../text/tex/index.js";
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
  const triangleFont = fontProfile.metricProvider.resolveFont({
    fontId: "msam10",
    atPt: texLength(font.sizePt),
  });
  const circleFont = fontProfile.metricProvider.resolveFont({
    // beamerbaseauxtemplates.sty paints the circle template as
    // `\donotcoloroutermaths$\bullet$` in the normal math-symbol face.
    fontId: "cmsy10",
    atPt: texLength(font.sizePt),
  });
  const tinySymbolFont = fontProfile.metricProvider.resolveFont({
    // umsa.fd selects msam7 for the 6pt `\tiny` size used by Boadilla.
    fontId: "msam7",
    atPt: texLength(6),
  });
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
      triangleFont,
      circleFont,
      tinySymbolFont,
      structure,
      canvas,
    })
  );
}

export function resolveBeamerEnumerateMarker(
  theme: ResolvedBeamerTheme,
  itemIndex: number,
  labelDepth: number
): TexListMarkerProfile | undefined {
  const template = theme.templates.enumerations[
    Math.max(0, Math.min(labelDepth - 1, theme.templates.enumerations.length - 1))
  ];
  const family = template?.id.split("/").at(-1);
  if (family !== "ball" && family !== "square") {
    return undefined;
  }
  const bodyFont = theme.fonts["normal-text"];
  const fontProfile = createBeamerTexTextFontProfile(bodyFont);
  const resolvedBodyFont = fontProfile.resolveTextFont(
    fontProfile.defaultFontState,
    texLength(bodyFont.sizePt),
    fontProfile.metricProvider
  );
  const projectedFont = fontProfile.metricProvider.resolveFont({
    fontId: "lmsans8-regular",
    atPt: texLength(family === "square" ? 8 : 6),
  });
  const text = String(itemIndex);
  const projectedRun = fontProfile.metricProvider.shapeText(text, projectedFont);
  const textWidthEm = Number(projectedRun.width) / bodyFont.sizePt;
  const projectedGlyphs = projectedRun.items.filter((item) =>
    item.kind === "glyph"
  );
  const projectedHeight = Math.max(
    0,
    ...projectedGlyphs.map((glyph) => Number(glyph.height))
  );
  const projectedDepth = Math.max(
    0,
    ...projectedGlyphs.map((glyph) => Number(glyph.depth))
  );
  const referenceProjectedCenterPt =
    ((projectedFont.data.chars["49"]?.height ?? 0) -
      (projectedFont.data.chars["49"]?.depth ?? 0)) *
    Number(projectedFont.atPt) /
    2;
  const projectedCenterPt =
    (projectedHeight - projectedDepth) / 2;
  const xHeightEm = resolvedBodyFont.data.fontdimen.xheight;
  if (family === "square") {
    const projectedXHeightPt =
      projectedFont.data.fontdimen.xheight * Number(projectedFont.atPt);
    const boxWidthPt = 2.25 * projectedXHeightPt;
    const boxHeightPt = 1.85 * projectedXHeightPt;
    const boxDepthPt = 0.4 * projectedXHeightPt;
    const background =
      resolveBeamerThemeColor(theme, "item projected").bg ??
      resolveBeamerThemeColor(theme, "item").fg ??
      resolveBeamerThemeColor(theme, "structure").fg ??
      "#3333b3";
    const foreground =
      resolveBeamerThemeColor(theme, "item projected").fg ?? WHITE;
    const widthEm = boxWidthPt / bodyFont.sizePt;
    const heightEm = boxHeightPt / bodyFont.sizePt;
    const depthEm = boxDepthPt / bodyFont.sizePt;
    return {
      widthEm,
      heightEm,
      depthEm,
      paintBoundsEm: {
        x: 0,
        y: 0,
        width: widthEm,
        height: heightEm + depthEm,
      },
      projectedText: {
        text,
        fontId: projectedFont.id,
        fontSizePt: Number(projectedFont.atPt),
        color: foreground,
        xEm: (widthEm - textWidthEm) / 2,
        baselineOffsetEm: 0,
      },
      svgBody:
        `<rect data-beamer-list-marker="enumerate-square" x="0" ` +
        `y="${fmt(-boxHeightPt * 100)}" ` +
        `width="${fmt(boxWidthPt * 100)}" ` +
        `height="${fmt((boxHeightPt + boxDepthPt) * 100)}" ` +
        `fill="${background}"/>`,
    };
  }
  const boxWidthEm = 2 * xHeightEm;
  const sphereSizeEm = 1.06 * xHeightEm;
  // beamerbaseauxtemplates.sty's projected-ball pgfpicture spans
  // (-1ex,-.65ex)..(1ex,1ex). The transformed bigsphere paint is a strict
  // sub-rectangle of that picture; these factors are the resulting PGF
  // transform in ex units, locked down against the shipout trace.
  const paintXEm = 0.0725 * xHeightEm;
  const paintTopFromBaselineEm = -0.7825 * xHeightEm;
  const paintYEm = xHeightEm + paintTopFromBaselineEm;
  const background =
    resolveBeamerThemeColor(theme, "item projected").bg ??
    resolveBeamerThemeColor(theme, "item").fg ??
    resolveBeamerThemeColor(theme, "structure").fg ??
    "#3333b3";
  const foreground =
    resolveBeamerThemeColor(theme, "item projected").fg ?? WHITE;
  const canvas =
    resolveBeamerThemeColor(theme, "normal text").bg ?? WHITE;
  const size = sphereSizeEm * bodyFont.sizePt * 100;
  // The shipout rule records the unscaled bigsphere box above, while the
  // template paints it through \pgftransformscale{1.75}. Keep those two
  // geometries separate so structural tracing and raster paint both match.
  const visualSize = 1.75 * size;
  const visualX =
    (boxWidthEm * bodyFont.sizePt * 100 - visualSize) / 2;
  const visualTop =
    -1.5525 * xHeightEm * bodyFont.sizePt * 100;

  return {
    widthEm: boxWidthEm,
    heightEm: xHeightEm,
    depthEm: 0.65 * xHeightEm,
    paintBoundsEm: {
      x: paintXEm,
      y: paintYEm,
      width: sphereSizeEm,
      height: sphereSizeEm,
    },
    projectedText: {
      text,
      fontId: projectedFont.id,
      fontSizePt: Number(projectedFont.atPt),
      color: foreground,
      xEm: (boxWidthEm - textWidthEm) / 2,
      baselineOffsetEm:
        (-0.33509 * xHeightEm * bodyFont.sizePt +
          projectedCenterPt -
          referenceProjectedCenterPt) /
        bodyFont.sizePt,
    },
    svgBody: sphereSvgBody({
      id: `beamer-enumerate-ball-${labelDepth}-${itemIndex}-${sanitizeId(background)}`,
      size: visualSize,
      x: visualX,
      top: visualTop,
      structure: background,
      canvas,
      markerKind: "enumerate-ball",
    }),
  };
}

function markerForTemplate(params: {
  template: BeamerThemeTemplateRef;
  depth: number;
  fontSizePt: number;
  xHeightEm: number;
  triangleFont: ResolvedTexFont;
  circleFont: ResolvedTexFont;
  tinySymbolFont: ResolvedTexFont;
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
    return circleGlyphMarker(params);
  }
  if (family === "tiny-triangle") {
    return tinyAmsMarker(params, 0x49, "tiny-triangle");
  }
  if (family === "tiny-star") {
    return tinyAmsMarker(params, 0x46, "tiny-star");
  }
  if (family === "metropolis") {
    return circleMarker(params, false);
  }
  if (family === "moloch") {
    return circleMarker(params, params.depth === 2);
  }
  return triangleMarker(params);
}

function tinyAmsMarker(
  params: {
    fontSizePt: number;
    tinySymbolFont: ResolvedTexFont;
    structure: string;
  },
  code: number,
  markerKind: string
): TexListMarkerProfile {
  const metric = params.tinySymbolFont.data.chars[String(code)];
  if (metric?.width == null || metric.height == null) {
    throw new Error(`The msam7 marker metric ${code} is unavailable.`);
  }
  const scale = Number(params.tinySymbolFont.atPt) / params.fontSizePt;
  const raiseEm = 1.5 / params.fontSizePt;
  return {
    widthEm: metric.width * scale,
    heightEm: metric.height * scale + raiseEm,
    depthEm: (metric.depth ?? 0) * scale - raiseEm,
    glyph: {
      text: String.fromCodePoint(code),
      code,
      fontId: params.tinySymbolFont.id,
      fontSizePt: Number(params.tinySymbolFont.atPt),
      color: params.structure,
      baselineOffsetEm: -raiseEm,
    },
    svgBody: `<g data-beamer-list-marker="${markerKind}"/>`,
  };
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
  const size = diameterEm * params.fontSizePt * 100;
  const raise = 0.2 * 100;
  const id = `beamer-ball-${params.depth}-${sanitizeId(params.structure)}`;

  return {
    widthEm: diameterEm,
    heightEm: diameterEm + raiseEm,
    depthEm: -raiseEm,
    svgBody: sphereSvgBody({
      id,
      size,
      x: 0,
      top: -(raise + size),
      structure: params.structure,
      canvas: params.canvas,
      markerKind: "ball",
    }),
  };
}

function sphereSvgBody(params: {
  id: string;
  size: number;
  x: number;
  top: number;
  structure: string;
  canvas: string;
  markerKind: string;
}): string {
  const pale = mixHex(params.structure, WHITE, 0.15);
  const light = mixHex(params.structure, WHITE, 0.75);
  const dark = mixHex(params.structure, BLACK, 0.7);
  const darker = mixHex(params.structure, BLACK, 0.5);
  const centerX = params.x + params.size / 2;
  const centerY = params.top + params.size / 2;
  return (
    `<g data-beamer-list-marker="${params.markerKind}">` +
    `<defs><radialGradient id="${params.id}" gradientUnits="userSpaceOnUse" ` +
    `cx="${fmt(params.x + params.size * 0.326)}" ` +
    `cy="${fmt(params.top + params.size * 0.287)}" ` +
    `r="${fmt(params.size * 0.72)}">` +
    `<stop offset="0" stop-color="${pale}"/>` +
    `<stop offset="0.31" stop-color="${light}"/>` +
    `<stop offset="0.62" stop-color="${dark}"/>` +
    `<stop offset="0.85" stop-color="${darker}"/>` +
    `<stop offset="1" stop-color="${params.canvas}"/>` +
    `</radialGradient></defs>` +
    `<circle cx="${fmt(centerX)}" cy="${fmt(centerY)}" ` +
    `r="${fmt(params.size / 2)}" fill="url(#${params.id})"/>` +
    `</g>`
  );
}

function triangleMarker(params: {
  depth: number;
  fontSizePt: number;
  triangleFont: ResolvedTexFont;
  structure: string;
}): TexListMarkerProfile {
  // beamerinnerthemedefault.sty:
  // \raise1.25pt\hbox{$\blacktriangleright$}, with 1.5pt at deeper levels.
  const metric = params.triangleFont.data.chars["73"];
  const widthEm = metric?.width;
  const heightEm = metric?.height;
  if (widthEm == null || heightEm == null) {
    throw new Error("The msam10 blacktriangleright metric is unavailable.");
  }
  const depthEm = metric?.depth ?? 0;
  const raiseEm = (params.depth === 1 ? 1.25 : 1.5) / params.fontSizePt;
  return {
    widthEm,
    heightEm: heightEm + raiseEm,
    depthEm: depthEm - raiseEm,
    glyph: {
      text: "I",
      code: 73,
      fontId: params.triangleFont.id,
      fontSizePt: Number(params.triangleFont.atPt),
      color: params.structure,
      baselineOffsetEm: -raiseEm,
    },
    svgBody: "",
  };
}

function squareMarker(params: {
  depth: number;
  fontSizePt: number;
  xHeightEm: number;
  structure: string;
}): TexListMarkerProfile {
  // beamerbaseauxtemplates.sty: \vrule width 1ex height 1ex.
  const sizeEm = params.xHeightEm;
  const size = sizeEm * params.fontSizePt * 100;
  return {
    widthEm: sizeEm,
    heightEm: sizeEm,
    depthEm: 0,
    svgBody:
      `<rect data-beamer-list-marker="square" x="0" y="${fmt(-size)}" ` +
      `width="${fmt(size)}" height="${fmt(size)}" fill="${params.structure}"/>`,
  };
}

function circleGlyphMarker(params: {
  depth: number;
  fontSizePt: number;
  circleFont: ResolvedTexFont;
  structure: string;
}): TexListMarkerProfile {
  const code = 15;
  const metric = params.circleFont.data.chars[String(code)];
  if (
    metric?.width == null ||
    metric.height == null
  ) {
    throw new Error("The cmsy10 bullet metric is unavailable.");
  }
  const scale = Number(params.circleFont.atPt) / params.fontSizePt;
  const raiseEm = (params.depth === 1 ? 1.25 : 1.5) / params.fontSizePt;
  return {
    widthEm: metric.width * scale,
    heightEm: metric.height * scale + raiseEm,
    depthEm: (metric.depth ?? 0) * scale - raiseEm,
    glyph: {
      text: String.fromCodePoint(code),
      code,
      fontId: params.circleFont.id,
      fontSizePt: Number(params.circleFont.atPt),
      color: params.structure,
      baselineOffsetEm: -raiseEm,
    },
    svgBody: '<g data-beamer-list-marker="circle"/>',
  };
}

function circleMarker(
  params: {
    depth: number;
    fontSizePt: number;
    xHeightEm: number;
    structure: string;
  },
  outlined: boolean
): TexListMarkerProfile {
  const diameterEm = (params.depth === 1 ? 0.88 : 0.72) * params.xHeightEm;
  const size = diameterEm * params.fontSizePt * 100;
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
