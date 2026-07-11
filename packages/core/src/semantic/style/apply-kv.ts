import type { OptionEntry } from "../../options/types.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { multiplyMatrix, rotationMatrix, scaleMatrix, translationMatrix } from "../transform.js";
import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldTransform } from "../../coords/transforms.js";
import {
  SHADOW_INHERIT_FILL,
  SHADOW_INHERIT_STROKE,
  type DecorationStyle,
  type ResolvedStyle,
  type ShadowFadeKind,
  type ShadowLayer,
  type ShadowPaintStyle
} from "../types.js";
import { parseArrowSideSpecification, parseArrowSpecification, parseTipsMode } from "./arrows.js";
import type { ApplyEntryFn, ApplyOutcome } from "./apply-types.js";
import { DEFAULT_TEXT_FONT_SIZE, NON_STYLE_OPTION_KEYS, PT_PER_CM } from "./constants.js";
import { clamp01, mixNormalizedColors, normalizeColor, normalizeShadingName, type ColorAliasResolver } from "./colors.js";
import { parseDashPattern, parseDashValue } from "./dash.js";
import {
  normalizeOptionValue,
  parseAxisVector,
  parseCmTransformValue,
  parseFontStyle,
  parseRotateAroundValue,
  parseStyleValueAsOptionList
} from "./option-utils.js";
import { parsePatternValue } from "./patterns.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import { isPicCodeOptionKey, isPicDefinitionOptionKey } from "../pics/registry.js";
import type { StyleDiagnosticInput } from "./diagnostics.js";

type KvHandlerContext = {
  key: string;
  valueRaw: string;
  style: ResolvedStyle;
  transform: WorldTransform;
  applyOptionEntry: ApplyEntryFn;
  resolveCoordinate?: (raw: string) => WorldPoint | null;
  resolveColorAlias?: ColorAliasResolver;
};

type KvHandler = (context: KvHandlerContext) => ApplyOutcome;

type KvHandlerRegistration = {
  keys: readonly string[];
  handle: KvHandler;
};

function normalizeOptionColor(valueRaw: string, style: ResolvedStyle, resolveColorAlias?: ColorAliasResolver): string {
  const currentColor = style.textColor ?? style.stroke ?? style.fill ?? "black";
  return normalizeColor(valueRaw, { currentColor, resolveAlias: resolveColorAlias });
}

export function applyKvEntry(
  key: string,
  valueRaw: string,
  style: ResolvedStyle,
  transform: WorldTransform,
  applyOptionEntry: ApplyEntryFn,
  resolveCoordinate?: (raw: string) => WorldPoint | null,
  resolveColorAlias?: ColorAliasResolver
): ApplyOutcome {
  if (isPicCodeOptionKey(key) || isPicDefinitionOptionKey(key)) {
    return { style, transform, diagnostics: [] };
  }

  const exactHandler = EXACT_KV_HANDLERS.get(key);
  if (exactHandler) {
    return exactHandler({
      key,
      valueRaw,
      style,
      transform,
      applyOptionEntry,
      resolveCoordinate,
      resolveColorAlias
    });
  }

  if (key.startsWith("/pgf/decoration/") || key.startsWith("/pgf/decorations/")) {
    const canonical = canonicalDecorationKey(key);
    const parsed = applyDecorationSetting(style.decoration, canonical, valueRaw);
    return {
      style: {
        ...style,
        decoration: parsed.decoration
      },
      transform,
      diagnostics: parsed.diagnostics
    };
  }

  if (/^level\s+\d+\s*\/\.(style|append style)$/.test(key)) {
    return { style, transform, diagnostics: [] };
  }

  if (/^level\s+\d+$/.test(key)) {
    return { style, transform, diagnostics: [] };
  }

  if (NON_STYLE_OPTION_KEYS.has(key)) {
    return { style, transform, diagnostics: [] };
  }

  return {
    style,
    transform,
    diagnostics: [`unsupported-option-key:${key}`]
  };
}

const EXACT_KV_HANDLERS = createKvHandlerMap([
  {
    keys: ["pic type", "label position", "pin position", "label distance", "pin distance", "pin edge", "quotes mean label", "quotes mean pin"],
    handle: ({ style, transform }) => ({ style, transform, diagnostics: [] })
  },
  {
    keys: ["every path/.style", "every path/.append style"],
    handle: ({ valueRaw, style, transform, applyOptionEntry }) => {
      const nested = parseStyleValueAsOptionList(valueRaw);
      if (!nested) {
        return { style, transform, diagnostics: [`invalid-style-value:${valueRaw}`] };
      }

      let nextStyle = style;
      let nextTransform = transform;
      const diagnostics: StyleDiagnosticInput[] = [];
      for (const entry of nested.entries) {
        const outcome = applyOptionEntry(entry, nextStyle, nextTransform);
        nextStyle = outcome.style;
        nextTransform = outcome.transform;
        diagnostics.push(...outcome.diagnostics);
      }
      return { style: nextStyle, transform: nextTransform, diagnostics };
    }
  },
  {
    keys: ["every shadow/.style", "every shadow/.append style"],
    handle: ({ key, valueRaw, style, transform }) => {
      const nested = parseStyleValueAsOptionList(valueRaw);
      if (!nested) {
        return { style, transform, diagnostics: [`invalid-style-value:${valueRaw}`] };
      }
      const everyShadowStyles = key === "every shadow/.style"
        ? [nested]
        : [...style.everyShadowStyles, nested];
      return { style: { ...style, everyShadowStyles }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["shadow scale"],
    handle: ({ valueRaw, style, transform }) => {
      const scale = Number(normalizeOptionValue(valueRaw));
      if (!Number.isFinite(scale)) {
        return { style, transform, diagnostics: [`invalid-shadow-scale:${valueRaw}`] };
      }
      return { style: { ...style, shadowScale: scale }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["shadow xshift"],
    handle: styleLengthHandler(
      "pt",
      "invalid-shadow-xshift",
      (style, shadowXShift) => ({ ...style, shadowXShift })
    )
  },
  {
    keys: ["shadow yshift"],
    handle: styleLengthHandler(
      "pt",
      "invalid-shadow-yshift",
      (style, shadowYShift) => ({ ...style, shadowYShift })
    )
  },
  {
    keys: ["path fading"],
    handle: ({ valueRaw, style, transform }) => {
      const fading = parseShadowFadeKind(valueRaw);
      if (!fading) {
        return {
          style,
          transform,
          diagnostics: [`unsupported-path-fading:${normalizeOptionValue(valueRaw)}`]
        };
      }
      return { style: { ...style, shadowFade: fading }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["general shadow"],
    handle: shadowHandler({ preset: null, applyEveryShadow: false })
  },
  {
    keys: ["drop shadow"],
    handle: shadowHandler({
      preset: "shadow scale=1,shadow xshift=.5ex,shadow yshift=-.5ex,opacity=.5,fill=black!50",
      applyEveryShadow: true
    })
  },
  {
    keys: ["copy shadow"],
    handle: shadowHandler({
      preset: "shadow scale=1,shadow xshift=.5ex,shadow yshift=-.5ex",
      applyEveryShadow: true,
      copyMainPaint: true
    })
  },
  {
    keys: ["double copy shadow"],
    handle: shadowHandler({
      preset: "shadow scale=1,shadow xshift=.5ex,shadow yshift=-.5ex",
      applyEveryShadow: true,
      duplicateWithDoubleShift: true,
      copyMainPaint: true
    })
  },
  {
    keys: ["circular drop shadow"],
    handle: shadowHandler({
      preset: "shadow scale=1.1,shadow xshift=.3ex,shadow yshift=-.3ex,fill=black,path fading={circle with fuzzy edge 15 percent}",
      applyEveryShadow: true
    })
  },
  {
    keys: ["circular glow"],
    handle: shadowHandler({
      preset: "shadow scale=1.25,shadow xshift=0pt,shadow yshift=0pt,fill=black,path fading={circle with fuzzy edge 15 percent}",
      applyEveryShadow: true
    })
  },
  {
    keys: ["decorate", "/tikz/decorate"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseDecorationBoolean(valueRaw);
      if (parsed == null) {
        return { style, transform, diagnostics: [`invalid-decorate-flag:${valueRaw}`] };
      }
      return {
        style: {
          ...style,
          decoration: {
            ...style.decoration,
            enabled: parsed
          }
        },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["decoration", "/pgf/decoration"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseDecorationOptionValue(style.decoration, valueRaw);
      return {
        style: { ...style, decoration: parsed.decoration },
        transform,
        diagnostics: parsed.diagnostics
      };
    }
  },
  {
    keys: ["preaction", "postaction"],
    handle: ({ key, valueRaw, style, transform }) => {
      const action = parseDecorationAction(style.decoration, valueRaw);
      if (!action) {
        return { style, transform, diagnostics: [] };
      }
      return {
        style: {
          ...style,
          decorationPreActions: key === "preaction"
            ? [...style.decorationPreActions, action]
            : style.decorationPreActions,
          decorationPostActions: key === "postaction"
            ? [...style.decorationPostActions, action]
            : style.decorationPostActions
        },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["arrows"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseArrowSpecification(valueRaw, style);
      if (!parsed) {
        return { style, transform, diagnostics: [] };
      }
      return {
        style: { ...style, markerStart: parsed.start, markerEnd: parsed.end },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: [">"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseArrowSideSpecification(valueRaw, "end", style);
      if (!parsed) {
        return { style, transform, diagnostics: [] };
      }
      return { style: { ...style, arrowShorthandEnd: parsed }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["<"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseArrowSideSpecification(valueRaw, "start", style);
      if (!parsed) {
        return { style, transform, diagnostics: [] };
      }
      return { style: { ...style, arrowShorthandStart: parsed }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["tips"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseTipsMode(valueRaw);
      if (!parsed) {
        return { style, transform, diagnostics: [`invalid-tips:${valueRaw}`] };
      }
      return { style: { ...style, tipsMode: parsed }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["shade"],
    handle: ({ valueRaw, style, transform }) => {
      const normalized = normalizeOptionValue(valueRaw).toLowerCase();
      if (normalized === "" || normalized === "true") {
        return {
          style: { ...style, fill: style.fill ?? "black", shadeEnabled: true },
          transform,
          diagnostics: []
        };
      }
      if (normalized === "false" || normalized === "none") {
        return { style: { ...style, shadeEnabled: false }, transform, diagnostics: [] };
      }
      return { style, transform, diagnostics: [`invalid-shade:${valueRaw}`] };
    }
  },
  {
    keys: ["pattern"],
    handle: ({ valueRaw, style, transform }) => {
      const parsedPattern = parsePatternValue(valueRaw, style);
      if (parsedPattern.disabled) {
        return {
          style: { ...style, fill: null, fillPattern: null, shadeEnabled: false },
          transform,
          diagnostics: parsedPattern.diagnostics
        };
      }
      if (parsedPattern.recognized && parsedPattern.pattern) {
        return {
          style: {
            ...style,
            fill: style.fill ?? "black",
            fillPattern: parsedPattern.pattern,
            shadeEnabled: false
          },
          transform,
          diagnostics: parsedPattern.diagnostics
        };
      }
      return {
        style: {
          ...style,
          fill: style.fill ?? "black",
          fillPattern: null,
          shadeEnabled: false
        },
        transform,
        diagnostics: parsedPattern.diagnostics
      };
    }
  },
  {
    keys: ["pattern color"],
    handle: normalizedColorStyleHandler(
      (style, patternColor) => ({ ...style, patternColor })
    )
  },
  {
    keys: ["shading"],
    handle: ({ valueRaw, style, transform }) => {
      const shading = normalizeShadingName(valueRaw);
      if (!shading) {
        return { style, transform, diagnostics: [`invalid-shading:${valueRaw}`] };
      }
      return { style: { ...style, shading, shadeEnabled: true }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["shading angle"],
    handle: ({ valueRaw, style, transform }) => {
      const angle = Number(valueRaw);
      if (!Number.isFinite(angle)) {
        return { style, transform, diagnostics: [`invalid-shading-angle:${valueRaw}`] };
      }
      return {
        style: { ...style, shadingAngle: angle, shadeEnabled: true },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["top color"],
    handle: axisShadingColorHandler("top", 0)
  },
  {
    keys: ["bottom color"],
    handle: axisShadingColorHandler("bottom", 0)
  },
  {
    keys: ["middle color"],
    handle: normalizedColorStyleHandler(
      (style, axisMiddleColor) => ({
        ...style,
        shadeEnabled: true,
        shading: "axis",
        axisMiddleColor
      })
    )
  },
  {
    keys: ["left color"],
    handle: axisShadingColorHandler("top", 90)
  },
  {
    keys: ["right color"],
    handle: axisShadingColorHandler("bottom", 90)
  },
  {
    keys: ["ball color"],
    handle: normalizedColorStyleHandler(
      (style, ballColor) => ({ ...style, shadeEnabled: true, shading: "ball", ballColor })
    )
  },
  {
    keys: ["inner color"],
    handle: normalizedColorStyleHandler(
      (style, radialInnerColor) => ({
        ...style,
        shadeEnabled: true,
        shading: "radial",
        radialInnerColor
      })
    )
  },
  {
    keys: ["outer color"],
    handle: normalizedColorStyleHandler(
      (style, radialOuterColor) => ({
        ...style,
        shadeEnabled: true,
        shading: "radial",
        radialOuterColor
      })
    )
  },
  {
    keys: ["lower left"],
    handle: bilinearShadingColorHandler("bilinearLowerLeft")
  },
  {
    keys: ["lower right"],
    handle: bilinearShadingColorHandler("bilinearLowerRight")
  },
  {
    keys: ["upper left"],
    handle: bilinearShadingColorHandler("bilinearUpperLeft")
  },
  {
    keys: ["upper right"],
    handle: bilinearShadingColorHandler("bilinearUpperRight")
  },
  {
    keys: ["fill"],
    handle: ({ valueRaw, style, transform, resolveColorAlias }) => ({
      style: {
        ...style,
        fill: normalizeOptionColor(valueRaw, style, resolveColorAlias),
        fillPattern: null
      },
      transform,
      diagnostics: []
    })
  },
  {
    keys: ["draw"],
    handle: ({ valueRaw, style, transform, resolveColorAlias }) => {
      if (valueRaw.trim().toLowerCase() === "none") {
        return { style: { ...style, stroke: null, drawExplicit: false }, transform, diagnostics: [] };
      }
      return {
        style: {
          ...style,
          stroke: normalizeOptionColor(valueRaw, style, resolveColorAlias),
          drawExplicit: true
        },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["color"],
    handle: ({ valueRaw, style, transform, resolveColorAlias }) => {
      if (valueRaw.trim().toLowerCase() === "none") {
        return {
          style: {
            ...style,
            stroke: style.drawExplicit || style.stroke != null ? null : style.stroke,
            fill: style.fill != null ? null : style.fill,
            fillPattern: style.fill != null ? null : style.fillPattern,
            textColor: null
          },
          transform,
          diagnostics: []
        };
      }
      const normalizedColor = normalizeOptionColor(valueRaw, style, resolveColorAlias);
      return {
        style: {
          ...style,
          stroke: style.drawExplicit || style.stroke != null ? normalizedColor : style.stroke,
          fill: style.fill != null ? normalizedColor : style.fill,
          textColor: normalizedColor
        },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["text"],
    handle: ({ valueRaw, style, transform, resolveColorAlias }) => ({
      style: {
        ...style,
        textColor: normalizeOptionColor(valueRaw, style, resolveColorAlias)
      },
      transform,
      diagnostics: []
    })
  },
  {
    keys: ["text opacity"],
    handle: finiteNumberStyleHandler(
      "invalid-text-opacity",
      (style, value) => ({ ...style, textOpacity: clamp01(value) })
    )
  },
  {
    keys: ["align"],
    handle: ({ valueRaw, style, transform }) => {
      const normalized = valueRaw.trim().toLowerCase();
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
        return { style: { ...style, textAlign: normalized }, transform, diagnostics: [] };
      }
      return { style, transform, diagnostics: [`invalid-align:${valueRaw}`] };
    }
  },
  {
    keys: ["line width"],
    handle: styleLengthHandler(
      "pt",
      "invalid-line-width",
      (style, length) => ({ ...style, lineWidth: length })
    )
  },
  {
    keys: ["double distance"],
    handle: styleLengthHandler(
      "pt",
      "invalid-double-distance",
      (style, length) => ({
        ...style,
        doubleStroke: true,
        doubleDistance: length,
        doubleLineCenterDistance: null
      }),
      (length) => length >= 0
    )
  },
  {
    keys: ["double distance between line centers"],
    handle: styleLengthHandler(
      "pt",
      "invalid-double-distance-between-line-centers",
      (style, length) => ({
        ...style,
        doubleStroke: true,
        doubleLineCenterDistance: length
      }),
      (length) => length >= 0
    )
  },
  {
    keys: ["double"],
    handle: ({ valueRaw, style, transform, resolveColorAlias }) => {
      if (valueRaw.trim().toLowerCase() === "none") {
        return { style: { ...style, doubleStroke: false }, transform, diagnostics: [] };
      }
      return {
        style: {
          ...style,
          doubleStroke: true,
          doubleColor: normalizeOptionColor(valueRaw, style, resolveColorAlias)
        },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["node font", "font"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseFontStyle(valueRaw);
      if (!parsed) {
        return { style, transform, diagnostics: [] };
      }
      return {
        style: {
          ...style,
          fontStyle: parsed.fontStyle ?? "normal",
          fontWeight: parsed.fontWeight ?? "normal",
          fontFamily: parsed.fontFamily ?? "serif",
          fontSize: parsed.fontSize ?? DEFAULT_TEXT_FONT_SIZE
        },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["radius"],
    handle: styleLengthHandler(
      "cm",
      "invalid-radius",
      (style, radius) => ({ ...style, radius })
    )
  },
  {
    keys: ["x radius"],
    handle: styleLengthHandler(
      "cm",
      "invalid-x-radius",
      (style, xRadius) => ({ ...style, xRadius })
    )
  },
  {
    keys: ["y radius"],
    handle: styleLengthHandler(
      "cm",
      "invalid-y-radius",
      (style, yRadius) => ({ ...style, yRadius })
    )
  },
  {
    keys: ["rounded corners"],
    handle: styleLengthHandler(
      "pt",
      "invalid-rounded-corners",
      (style, roundedCorners) => ({ ...style, roundedCorners })
    )
  },
  {
    keys: ["transparent"],
    handle: ({ style, transform }) => ({
      style: {
        ...style,
        strokeOpacity: 0,
        fillOpacity: 0,
        textOpacity: 0
      },
      transform,
      diagnostics: []
    })
  },
  {
    keys: ["opacity"],
    handle: finiteNumberStyleHandler(
      "invalid-opacity",
      (style, value) => ({
        ...style,
        strokeOpacity: clamp01(value),
        fillOpacity: clamp01(value),
        textOpacity: clamp01(value)
      })
    )
  },
  {
    keys: ["draw opacity"],
    handle: finiteNumberStyleHandler(
      "invalid-draw-opacity",
      (style, value) => ({ ...style, strokeOpacity: clamp01(value) })
    )
  },
  {
    keys: ["fill opacity"],
    handle: finiteNumberStyleHandler(
      "invalid-fill-opacity",
      (style, value) => ({ ...style, fillOpacity: clamp01(value) })
    )
  },
  {
    keys: ["line cap", "cap"],
    handle: ({ valueRaw, style, transform }) => {
      const normalized = valueRaw.trim().toLowerCase();
      if (normalized === "round" || normalized === "butt") {
        return { style: { ...style, lineCap: normalized }, transform, diagnostics: [] };
      }
      if (normalized === "rect" || normalized === "projecting") {
        return { style: { ...style, lineCap: "square" }, transform, diagnostics: [] };
      }
      return { style, transform, diagnostics: [`invalid-line-cap:${valueRaw}`] };
    }
  },
  {
    keys: ["line join", "join"],
    handle: ({ valueRaw, style, transform }) => {
      const normalized = valueRaw.trim().toLowerCase();
      if (normalized === "round" || normalized === "bevel" || normalized === "miter") {
        return { style: { ...style, lineJoin: normalized }, transform, diagnostics: [] };
      }
      return { style, transform, diagnostics: [`invalid-line-join:${valueRaw}`] };
    }
  },
  {
    keys: ["shorten <", "shorten <="],
    handle: styleLengthHandler(
      "pt",
      "invalid-shorten-start",
      (style, shortenStart) => ({ ...style, shortenStart })
    )
  },
  {
    keys: ["shorten >", "shorten >="],
    handle: styleLengthHandler(
      "pt",
      "invalid-shorten-end",
      (style, shortenEnd) => ({ ...style, shortenEnd })
    )
  },
  {
    keys: ["dash pattern"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseDashPattern(valueRaw);
      if (!parsed) {
        return { style, transform, diagnostics: [`invalid-dash-pattern:${valueRaw}`] };
      }
      return { style: { ...style, dashArray: parsed }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["dash phase"],
    handle: ({ valueRaw, style, transform }) => {
      const phase = parseLength(normalizeOptionValue(valueRaw), "pt");
      if (phase == null) {
        return { style, transform, diagnostics: [`invalid-dash-phase:${valueRaw}`] };
      }
      return { style: { ...style, dashOffset: phase }, transform, diagnostics: [] };
    }
  },
  {
    keys: ["dash"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseDashValue(valueRaw);
      if (!parsed) {
        return { style, transform, diagnostics: [`invalid-dash:${valueRaw}`] };
      }
      return {
        style: {
          ...style,
          dashArray: parsed.pattern,
          dashOffset: parsed.phase ?? style.dashOffset
        },
        transform,
        diagnostics: []
      };
    }
  },
  {
    keys: ["xshift"],
    handle: transformLengthHandler(
      "invalid-xshift",
      (transform, shift) => multiplyMatrix(transform, translationMatrix(shift, 0))
    )
  },
  {
    keys: ["yshift"],
    handle: transformLengthHandler(
      "invalid-yshift",
      (transform, shift) => multiplyMatrix(transform, translationMatrix(0, shift))
    )
  },
  {
    keys: ["shift"],
    handle: ({ valueRaw, style, transform, resolveCoordinate }) => {
      const normalizedShift = normalizeOptionValue(valueRaw);
      const vector = parseCoordinateLike(normalizedShift);
      if (vector) {
        const x = parseLength(vector.x, "cm");
        const y = parseLength(vector.y, "cm");
        if (x != null && y != null) {
          return {
            style,
            transform: multiplyMatrix(transform, translationMatrix(x, y)),
            diagnostics: []
          };
        }
      }

      const resolved = resolveCoordinate?.(normalizedShift);
      if (resolved) {
        return {
          style,
          transform: multiplyMatrix(transform, translationMatrix(resolved.x, resolved.y)),
          diagnostics: []
        };
      }

      return { style, transform, diagnostics: [`invalid-shift:${valueRaw}`] };
    }
  },
  {
    keys: ["scale"],
    handle: finiteNumberTransformHandler(
      "invalid-scale",
      (transform, factor) => multiplyMatrix(transform, scaleMatrix(factor, factor))
    )
  },
  {
    keys: ["xscale"],
    handle: finiteNumberTransformHandler(
      "invalid-xscale",
      (transform, factor) => multiplyMatrix(transform, scaleMatrix(factor, 1))
    )
  },
  {
    keys: ["yscale"],
    handle: finiteNumberTransformHandler(
      "invalid-yscale",
      (transform, factor) => multiplyMatrix(transform, scaleMatrix(1, factor))
    )
  },
  {
    keys: ["rotate"],
    handle: finiteNumberTransformHandler(
      "invalid-rotate",
      (transform, degrees) => multiplyMatrix(transform, rotationMatrix(degrees))
    )
  },
  {
    keys: ["rotate around", "/tikz/rotate around"],
    handle: ({ valueRaw, style, transform, resolveCoordinate }) => {
      const parsed = parseRotateAroundValue(valueRaw, resolveCoordinate);
      if (!parsed) {
        return { style, transform, diagnostics: [`invalid-rotate-around:${valueRaw}`] };
      }
      const { angleDeg, pivot } = parsed;
      const aroundMatrix = multiplyMatrix(
        translationMatrix(pivot.x, pivot.y),
        multiplyMatrix(
          rotationMatrix(angleDeg),
          translationMatrix(pt(-1 * pivot.x), pt(-1 * pivot.y))
        )
      );
      return {
        style,
        transform: multiplyMatrix(transform, aroundMatrix),
        diagnostics: []
      };
    }
  },
  {
    keys: ["cm", "/tikz/cm"],
    handle: ({ valueRaw, style, transform, resolveCoordinate }) => {
      const parsed = parseCmTransformValue(valueRaw, resolveCoordinate);
      if (!parsed) {
        return { style, transform, diagnostics: [`invalid-cm:${valueRaw}`] };
      }
      return {
        style,
        transform: multiplyMatrix(transform, parsed),
        diagnostics: []
      };
    }
  },
  {
    keys: ["x"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseAxisVector(valueRaw, "x");
      if (!parsed) {
        return { style, transform, diagnostics: [`invalid-x-axis:${valueRaw}`] };
      }
      return {
        style,
        transform: {
          ...transform,
          a: parsed.x / PT_PER_CM,
          b: parsed.y / PT_PER_CM
        },
        diagnostics: []
      };
    }
  },
  {
    keys: ["y"],
    handle: ({ valueRaw, style, transform }) => {
      const parsed = parseAxisVector(valueRaw, "y");
      if (!parsed) {
        return { style, transform, diagnostics: [`invalid-y-axis:${valueRaw}`] };
      }
      return {
        style,
        transform: {
          ...transform,
          c: parsed.x / PT_PER_CM,
          d: parsed.y / PT_PER_CM
        },
        diagnostics: []
      };
    }
  }
]);

function createKvHandlerMap(
  registrations: readonly KvHandlerRegistration[]
): ReadonlyMap<string, KvHandler> {
  const handlers = new Map<string, KvHandler>();
  for (const registration of registrations) {
    for (const key of registration.keys) {
      if (handlers.has(key)) {
        throw new Error(`Duplicate key-value style handler: ${key}`);
      }
      handlers.set(key, registration.handle);
    }
  }
  return handlers;
}

function styleLengthHandler(
  unit: "pt" | "cm",
  diagnosticCode: string,
  update: (style: ResolvedStyle, length: number) => ResolvedStyle,
  validate: (length: number) => boolean = () => true
): KvHandler {
  return ({ valueRaw, style, transform }) => {
    const length = parseLength(valueRaw, unit);
    if (length == null || !validate(length)) {
      return { style, transform, diagnostics: [`${diagnosticCode}:${valueRaw}`] };
    }
    return { style: update(style, length), transform, diagnostics: [] };
  };
}

function finiteNumberStyleHandler(
  diagnosticCode: string,
  update: (style: ResolvedStyle, value: number) => ResolvedStyle
): KvHandler {
  return ({ valueRaw, style, transform }) => {
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) {
      return { style, transform, diagnostics: [`${diagnosticCode}:${valueRaw}`] };
    }
    return { style: update(style, value), transform, diagnostics: [] };
  };
}

function transformLengthHandler(
  diagnosticCode: string,
  update: (transform: WorldTransform, length: number) => WorldTransform
): KvHandler {
  return ({ valueRaw, style, transform }) => {
    const length = parseLength(valueRaw, "pt");
    if (length == null) {
      return { style, transform, diagnostics: [`${diagnosticCode}:${valueRaw}`] };
    }
    return { style, transform: update(transform, length), diagnostics: [] };
  };
}

function finiteNumberTransformHandler(
  diagnosticCode: string,
  update: (transform: WorldTransform, value: number) => WorldTransform
): KvHandler {
  return ({ valueRaw, style, transform }) => {
    const value = Number(valueRaw);
    if (!Number.isFinite(value)) {
      return { style, transform, diagnostics: [`${diagnosticCode}:${valueRaw}`] };
    }
    return { style, transform: update(transform, value), diagnostics: [] };
  };
}

function shadowHandler(options: AppendShadowOptions): KvHandler {
  return ({ valueRaw, style, transform, applyOptionEntry }) =>
    appendShadowLayers(style, transform, valueRaw, applyOptionEntry, options);
}

function normalizedColorStyleHandler(
  update: (style: ResolvedStyle, color: string) => ResolvedStyle
): KvHandler {
  return ({ valueRaw, style, transform, resolveColorAlias }) => ({
    style: update(style, normalizeOptionColor(valueRaw, style, resolveColorAlias)),
    transform,
    diagnostics: []
  });
}

function axisShadingColorHandler(
  side: "top" | "bottom",
  shadingAngle: number
): KvHandler {
  return normalizedColorStyleHandler((style, color) => {
    if (side === "top") {
      return {
        ...style,
        shadeEnabled: true,
        shading: "axis",
        shadingAngle,
        axisTopColor: color,
        axisMiddleColor:
          mixNormalizedColors(color, style.axisBottomColor, 0.5)
          ?? style.axisMiddleColor
      };
    }
    return {
      ...style,
      shadeEnabled: true,
      shading: "axis",
      shadingAngle,
      axisBottomColor: color,
      axisMiddleColor:
        mixNormalizedColors(style.axisTopColor, color, 0.5)
        ?? style.axisMiddleColor
    };
  });
}

function bilinearShadingColorHandler(
  property:
    | "bilinearLowerLeft"
    | "bilinearLowerRight"
    | "bilinearUpperLeft"
    | "bilinearUpperRight"
): KvHandler {
  return normalizedColorStyleHandler((style, color) => ({
    ...style,
    shadeEnabled: true,
    shading: "bilinear interpolation",
    [property]: color
  }));
}

type AppendShadowOptions = {
  preset: string | null;
  applyEveryShadow: boolean;
  duplicateWithDoubleShift?: boolean;
  copyMainPaint?: boolean;
};

function appendShadowLayers(
  style: ResolvedStyle,
  transform: WorldTransform,
  valueRaw: string,
  applyOptionEntry: ApplyEntryFn,
  options: AppendShadowOptions
): ApplyOutcome {
  const seedStyle = toShadowSeedStyle(style);
  let workingStyle = options.copyMainPaint
    ? {
        ...seedStyle,
        stroke: SHADOW_INHERIT_STROKE,
        drawExplicit: true,
        fill: SHADOW_INHERIT_FILL
      }
    : seedStyle;
  let workingTransform = transform;
  const diagnostics: StyleDiagnosticInput[] = [];

  if (options.preset) {
    const presetList = parseStyleValueAsOptionList(options.preset);
    if (presetList) {
      const presetResult = applyOptionListEntries(presetList.entries, workingStyle, workingTransform, applyOptionEntry);
      workingStyle = presetResult.style;
      workingTransform = presetResult.transform;
      diagnostics.push(...presetResult.diagnostics);
    }
  }

  if (options.applyEveryShadow) {
    for (const list of style.everyShadowStyles) {
      const everyResult = applyOptionListEntries(list.entries, workingStyle, workingTransform, applyOptionEntry);
      workingStyle = everyResult.style;
      workingTransform = everyResult.transform;
      diagnostics.push(...everyResult.diagnostics);
    }
  }

  const nested = parseStyleValueAsOptionList(valueRaw);
  if (valueRaw.trim().length > 0 && !nested) {
    diagnostics.push(`invalid-style-value:${valueRaw}`);
  } else if (nested) {
    const nestedResult = applyOptionListEntries(nested.entries, workingStyle, workingTransform, applyOptionEntry);
    workingStyle = nestedResult.style;
    diagnostics.push(...nestedResult.diagnostics);
  }

  const shadowLayer = makeShadowLayerFromStyle(workingStyle);
  const shadowLayers = options.duplicateWithDoubleShift
    ? [
        {
          ...shadowLayer,
          xshift: shadowLayer.xshift * 2,
          yshift: shadowLayer.yshift * 2
        },
        shadowLayer
      ]
    : [shadowLayer];

  return {
    style: {
      ...style,
      shadowLayers: [...style.shadowLayers, ...shadowLayers]
    },
    transform,
    diagnostics
  };
}

function applyOptionListEntries(
  entries: OptionEntry[],
  style: ResolvedStyle,
  transform: WorldTransform,
  applyOptionEntry: ApplyEntryFn
): ApplyOutcome {
  let nextStyle = style;
  let nextTransform = transform;
  const diagnostics: StyleDiagnosticInput[] = [];

  for (const entry of entries) {
    const outcome = applyOptionEntry(entry, nextStyle, nextTransform);
    nextStyle = outcome.style;
    nextTransform = outcome.transform;
    diagnostics.push(...outcome.diagnostics);
  }

  return { style: nextStyle, transform: nextTransform, diagnostics };
}

function makeShadowLayerFromStyle(style: ResolvedStyle): ShadowLayer {
  const scale = Number.isFinite(style.shadowScale) ? style.shadowScale : 1;
  const xshift = Number.isFinite(style.shadowXShift) ? style.shadowXShift : 0;
  const yshift = Number.isFinite(style.shadowYShift) ? style.shadowYShift : 0;
  const fade: ShadowFadeKind = style.shadowFade;
  return {
    scale,
    xshift,
    yshift,
    fade,
    style: extractShadowPaintStyle(style)
  };
}

function toShadowSeedStyle(style: ResolvedStyle): ResolvedStyle {
  return {
    ...style,
    stroke: null,
    drawExplicit: false,
    shadeEnabled: false,
    shadowLayers: []
  };
}

function extractShadowPaintStyle(style: ResolvedStyle): ShadowPaintStyle {
  return {
    stroke: style.stroke,
    fill: style.fill,
    fillRule: style.fillRule,
    doubleStroke: style.doubleStroke,
    doubleDistance: style.doubleDistance,
    doubleLineCenterDistance: style.doubleLineCenterDistance,
    doubleColor: style.doubleColor,
    lineWidth: style.lineWidth,
    dashArray: style.dashArray ? [...style.dashArray] : null,
    dashOffset: style.dashOffset,
    lineCap: style.lineCap,
    lineJoin: style.lineJoin,
    opacity: style.opacity,
    strokeOpacity: style.strokeOpacity,
    fillOpacity: style.fillOpacity,
    shadeEnabled: style.shadeEnabled,
    shading: style.shading,
    shadingAngle: style.shadingAngle,
    axisTopColor: style.axisTopColor,
    axisMiddleColor: style.axisMiddleColor,
    axisBottomColor: style.axisBottomColor,
    radialInnerColor: style.radialInnerColor,
    radialOuterColor: style.radialOuterColor,
    ballColor: style.ballColor,
    bilinearLowerLeft: style.bilinearLowerLeft,
    bilinearLowerRight: style.bilinearLowerRight,
    bilinearUpperLeft: style.bilinearUpperLeft,
    bilinearUpperRight: style.bilinearUpperRight
  };
}

function parseShadowFadeKind(valueRaw: string): ShadowFadeKind | null {
  const normalized = normalizeOptionValue(valueRaw).toLowerCase().replace(/\s+/g, " ");
  if (normalized === "circle with fuzzy edge 15 percent") {
    return "circle-fuzzy-edge-15";
  }
  if (normalized === "none" || normalized === "false") {
    return "none";
  }
  return null;
}

function cloneDecorationStyle(decoration: DecorationStyle): DecorationStyle {
  return {
    ...decoration,
    params: { ...decoration.params }
  };
}

function canonicalDecorationKey(rawKey: string): string {
  const normalized = rawKey.trim().toLowerCase().replace(/^\/pgf\/decorations\//, "/pgf/decoration/");
  if (normalized === "decoration" || normalized === "/pgf/decoration") {
    return "decoration";
  }
  if (normalized.startsWith("/pgf/decoration/")) {
    return normalized.slice("/pgf/decoration/".length);
  }
  return normalized;
}

function parseDecorationOptionValue(
  decoration: DecorationStyle,
  valueRaw: string
): { decoration: DecorationStyle; diagnostics: string[] } {
  const nested = parseStyleValueAsOptionList(valueRaw);
  const next = cloneDecorationStyle(decoration);
  const diagnostics: string[] = [];

  if (!nested) {
    const normalized = normalizeOptionValue(valueRaw);
    if (normalized.length > 0) {
      next.name = normalized;
    }
    return { decoration: next, diagnostics };
  }

  for (const entry of nested.entries) {
    if (entry.kind === "kv") {
      const parsed = applyDecorationSetting(next, canonicalDecorationKey(entry.key), entry.valueRaw);
      next.raise = parsed.decoration.raise;
      next.mirror = parsed.decoration.mirror;
      next.transformRaw = parsed.decoration.transformRaw;
      next.name = parsed.decoration.name;
      next.pre = parsed.decoration.pre;
      next.preLength = parsed.decoration.preLength;
      next.post = parsed.decoration.post;
      next.postLength = parsed.decoration.postLength;
      next.params = parsed.decoration.params;
      diagnostics.push(...parsed.diagnostics);
      continue;
    }

    if (entry.kind === "flag") {
      const key = canonicalDecorationKey(entry.key);
      if (key === "mirror") {
        next.mirror = true;
      } else if (key === "path has corners" || key === "reverse path") {
        next.params[key] = "true";
      } else if (key !== "decorate") {
        next.name = entry.key.trim();
      }
    }
  }

  return { decoration: next, diagnostics };
}

function applyDecorationSetting(
  decoration: DecorationStyle,
  key: string,
  valueRaw: string
): { decoration: DecorationStyle; diagnostics: string[] } {
  const next = cloneDecorationStyle(decoration);
  const diagnostics: string[] = [];
  const normalized = normalizeOptionValue(valueRaw);

  if (key === "name") {
    next.name = normalized.length > 0 ? normalized : null;
    return { decoration: next, diagnostics };
  }
  if (key === "raise") {
    const raise = parseLength(valueRaw, "pt");
    if (raise == null) {
      diagnostics.push(`invalid-decoration-raise:${valueRaw}`);
      return { decoration: next, diagnostics };
    }
    next.raise = raise;
    return { decoration: next, diagnostics };
  }
  if (key === "mirror") {
    const parsed = parseDecorationBoolean(valueRaw);
    if (parsed == null) {
      diagnostics.push(`invalid-decoration-mirror:${valueRaw}`);
      return { decoration: next, diagnostics };
    }
    next.mirror = parsed;
    return { decoration: next, diagnostics };
  }
  if (key === "transform") {
    next.transformRaw = normalized.length > 0 ? normalized : null;
    return { decoration: next, diagnostics };
  }
  if (key === "pre") {
    next.pre = normalized.length > 0 ? normalized : next.pre;
    return { decoration: next, diagnostics };
  }
  if (key === "pre length") {
    const length = parseLength(valueRaw, "pt");
    if (length == null) {
      diagnostics.push(`invalid-decoration-pre-length:${valueRaw}`);
      return { decoration: next, diagnostics };
    }
    next.preLength = length;
    return { decoration: next, diagnostics };
  }
  if (key === "post") {
    next.post = normalized.length > 0 ? normalized : next.post;
    return { decoration: next, diagnostics };
  }
  if (key === "post length") {
    const length = parseLength(valueRaw, "pt");
    if (length == null) {
      diagnostics.push(`invalid-decoration-post-length:${valueRaw}`);
      return { decoration: next, diagnostics };
    }
    next.postLength = length;
    return { decoration: next, diagnostics };
  }
  if (key === "decoration") {
    const parsed = parseDecorationOptionValue(next, valueRaw);
    return parsed;
  }

  next.params[key] = normalized;
  return { decoration: next, diagnostics };
}

function parseDecorationBoolean(raw: string): boolean | null {
  return parseBooleanishNormalized(normalizeOptionValue(raw), { allowOnOff: true, empty: true });
}

function parseDecorationAction(baseDecoration: DecorationStyle, valueRaw: string): DecorationStyle | null {
  const nested = parseStyleValueAsOptionList(valueRaw);
  if (!nested) {
    return null;
  }

  let hasDecorate = false;
  let decoration = cloneDecorationStyle(baseDecoration);
  for (const entry of nested.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "decorate") {
        hasDecorate = true;
      }
      continue;
    }
    if (entry.kind !== "kv") {
      continue;
    }
    const canonicalKey = canonicalDecorationKey(entry.key);
    const parsed = applyDecorationSetting(decoration, canonicalKey, entry.valueRaw);
    decoration = parsed.decoration;
    if (
      canonicalKey === "decoration" ||
      canonicalKey === "name" ||
      canonicalKey === "decorate" ||
      entry.key.startsWith("/pgf/decoration/") ||
      entry.key.startsWith("/pgf/decorations/")
    ) {
      hasDecorate = true;
    }
  }

  if (!hasDecorate) {
    return null;
  }

  return {
    ...decoration,
    enabled: true
  };
}
