import { parseLength } from "../coords/parse-length.js";
import type { WorldTransform } from "../../coords/transforms.js";
import type { ResolvedStyle } from "../types.js";
import { parseArrowSpecification } from "./arrows.js";
import type { ApplyOutcome } from "./apply-types.js";
import { normalizeColor, type ColorAliasResolver } from "./colors.js";
import { COLOR_HEX, NAMED_COLORS, NON_STYLE_OPTION_FLAGS } from "./constants.js";
import { DEFAULT_PATTERN } from "./patterns.js";

export function applyFlagEntry(
  key: string,
  raw: string,
  style: ResolvedStyle,
  transform: WorldTransform,
  resolveColorAlias?: ColorAliasResolver
): ApplyOutcome {
  const currentColor = style.textColor ?? style.stroke ?? style.fill ?? "black";
  const normalizedColorCandidate = normalizeColor(key, { currentColor, ...(resolveColorAlias === undefined ? {} : { resolveAlias: resolveColorAlias }) });
  if (key === "draw") {
    return {
      style: {
        ...style,
        stroke: style.stroke ?? style.textColor ?? "black",
        drawExplicit: true
      },
      transform,
      diagnostics: []
    };
  }
  // A bare `fill` only switches filling on: it paints with the current colour,
  // as `draw` does above (\path[red, fill] fills red), and keeps a pattern.
  if (key === "fill") {
    return {
      style: {
        ...style,
        fill: style.fill ?? style.textColor ?? "black"
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "clip") {
    return {
      style: {
        ...style,
        clip: true
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "use as bounding box") {
    return {
      style: {
        ...style,
        useAsBoundingBox: true
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "overlay") {
    return { style: { ...style, overlay: true }, transform, diagnostics: [] };
  }
  if (key === "shade") {
    return { style: { ...style, fill: style.fill ?? "black", shadeEnabled: true }, transform, diagnostics: [] };
  }
  if (key === "pattern") {
    return {
      style: {
        ...style,
        fill: style.fill ?? "black",
        fillPattern: style.fillPattern ?? DEFAULT_PATTERN,
        shadeEnabled: false
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "transparent") {
    return {
      style: {
        ...style,
        strokeOpacity: 0,
        fillOpacity: 0,
        textOpacity: 0
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "ultra nearly transparent") {
    return applyOpacityAlias(0.05, style, transform);
  }
  if (key === "very nearly transparent") {
    return applyOpacityAlias(0.1, style, transform);
  }
  if (key === "nearly transparent") {
    return applyOpacityAlias(0.25, style, transform);
  }
  if (key === "semitransparent") {
    return applyOpacityAlias(0.5, style, transform);
  }
  if (key === "nearly opaque") {
    return applyOpacityAlias(0.75, style, transform);
  }
  if (key === "very nearly opaque") {
    return applyOpacityAlias(0.9, style, transform);
  }
  if (key === "ultra nearly opaque") {
    return applyOpacityAlias(0.95, style, transform);
  }
  if (key === "opaque") {
    return applyOpacityAlias(1, style, transform);
  }
  if (key === "rounded corners") {
    return { style: { ...style, roundedCorners: parseLength("4pt", "pt") ?? 4 }, transform, diagnostics: [] };
  }
  if (key === "sharp corners") {
    return { style: { ...style, roundedCorners: null }, transform, diagnostics: [] };
  }
  if (key === "ultra thin") {
    return { style: { ...style, lineWidth: 0.1 }, transform, diagnostics: [] };
  }
  if (key === "very thin") {
    return { style: { ...style, lineWidth: 0.2 }, transform, diagnostics: [] };
  }
  if (key === "thick") {
    return { style: { ...style, lineWidth: 0.8 }, transform, diagnostics: [] };
  }
  if (key === "semithick") {
    return { style: { ...style, lineWidth: 0.6 }, transform, diagnostics: [] };
  }
  if (key === "very thick") {
    return { style: { ...style, lineWidth: 1.2 }, transform, diagnostics: [] };
  }
  if (key === "ultra thick") {
    return { style: { ...style, lineWidth: 1.6 }, transform, diagnostics: [] };
  }
  if (key === "thin") {
    return { style: { ...style, lineWidth: 0.4 }, transform, diagnostics: [] };
  }
  if (key.includes("-") || raw.includes("-")) {
    const parsedArrow = parseArrowSpecification(raw, style);
    if (parsedArrow) {
      return { style: { ...style, markerStart: parsedArrow.start, markerEnd: parsedArrow.end }, transform, diagnostics: [] };
    }
  }
  if (key === "solid") {
    return { style: { ...style, dashArray: null, dashOffset: 0 }, transform, diagnostics: [] };
  }
  if (key === "double") {
    return { style: { ...style, doubleStroke: true }, transform, diagnostics: [] };
  }
  if (key === "double equal sign distance") {
    const length = parseLength("0.45ex", "pt");
    return {
      style: {
        ...style,
        doubleStroke: true,
        doubleLineCenterDistance: length ?? style.doubleLineCenterDistance
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "decorate") {
    return {
      style: {
        ...style,
        decoration: {
          ...style.decoration,
          enabled: true
        }
      },
      transform,
      diagnostics: []
    };
  }
  if (key === "even odd rule") {
    return { style: { ...style, fillRule: "evenodd" }, transform, diagnostics: [] };
  }
  if (key === "nonzero rule") {
    return { style: { ...style, fillRule: "nonzero" }, transform, diagnostics: [] };
  }
  if (key === "dashed") {
    return { style: { ...style, dashArray: [3, 3] }, transform, diagnostics: [] };
  }
  if (key === "densely dashed") {
    return { style: { ...style, dashArray: [4, 2] }, transform, diagnostics: [] };
  }
  if (key === "loosely dashed") {
    return { style: { ...style, dashArray: [6, 4] }, transform, diagnostics: [] };
  }
  if (key === "dotted") {
    return { style: { ...style, dashArray: [style.lineWidth, 2] }, transform, diagnostics: [] };
  }
  if (key === "densely dotted") {
    return { style: { ...style, dashArray: [style.lineWidth, 1] }, transform, diagnostics: [] };
  }
  if (key === "loosely dotted") {
    return { style: { ...style, dashArray: [style.lineWidth, 4] }, transform, diagnostics: [] };
  }
  if (NAMED_COLORS.has(key) || normalizedColorCandidate !== key) {
    const normalizedColor = normalizedColorCandidate;
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
  if (key.includes("!") || key.startsWith("#")) {
    const normalizedColor = normalizedColorCandidate;
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
  if (key === "help lines") {
    return {
      style: {
        ...style,
        stroke: COLOR_HEX.gray,
        textColor: COLOR_HEX.gray,
        lineWidth: 0.2
      },
      transform,
      diagnostics: []
    };
  }

  if (
    key === "auto" ||
    key === "every label" ||
    key === "every pin" ||
    key === "quotes mean label" ||
    key === "quotes mean pin" ||
    key === "every label quotes" ||
    key === "every pin quotes" ||
    key === "every edge quotes"
  ) {
    return { style, transform, diagnostics: [] };
  }

  if (/^level\s+\d+$/.test(key)) {
    return { style, transform, diagnostics: [] };
  }

  if (NON_STYLE_OPTION_FLAGS.has(key)) {
    return { style, transform, diagnostics: [] };
  }

  return {
    style,
    transform,
    diagnostics: [`unsupported-option-flag:${key}`]
  };
}

function applyOpacityAlias(opacity: number, style: ResolvedStyle, transform: WorldTransform): ApplyOutcome {
  return {
    style: {
      ...style,
      strokeOpacity: opacity,
      fillOpacity: opacity,
      textOpacity: opacity
    },
    transform,
    diagnostics: []
  };
}
