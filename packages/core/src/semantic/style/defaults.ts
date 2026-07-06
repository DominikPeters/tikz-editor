import type { PathCommand } from "../../ast/types.js";
import type { ResolvedStyle } from "../types.js";
import {
  COLOR_HEX,
  DEFAULT_AXIS_BOTTOM_COLOR,
  DEFAULT_AXIS_MIDDLE_COLOR,
  DEFAULT_AXIS_TOP_COLOR,
  DEFAULT_BALL_COLOR,
  DEFAULT_DOUBLE_DISTANCE,
  DEFAULT_RADIAL_INNER_COLOR,
  DEFAULT_RADIAL_OUTER_COLOR,
  DEFAULT_TEXT_FONT_SIZE
} from "./constants.js";
import { cloneArrowMarker, makeDefaultArrowMarker } from "./arrows.js";
import { DEFAULT_PATTERN } from "./patterns.js";

export function defaultStyle(): ResolvedStyle {
  const defaultTip = makeDefaultArrowMarker("cm-rightarrow");
  return {
    stroke: "black",
    fill: null,
    fillPattern: null,
    patternColor: "black",
    fillRule: "nonzero",
    clip: false,
    useAsBoundingBox: false,
    textColor: null,
    textOpacity: 1,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    fontStyle: "normal",
    fontWeight: "normal",
    fontFamily: "serif",
    doubleStroke: false,
    doubleDistance: DEFAULT_DOUBLE_DISTANCE,
    doubleLineCenterDistance: null,
    doubleColor: "#ffffff",
    textAlign: "center",
    drawExplicit: false,
    radius: null,
    xRadius: null,
    yRadius: null,
    roundedCorners: null,
    lineWidth: 0.4,
    dashArray: null,
    dashOffset: 0,
    lineCap: "butt",
    lineJoin: "miter",
    shortenStart: 0,
    shortenEnd: 0,
    markerStart: null,
    markerEnd: null,
    arrowShorthandStart: { tips: [] },
    arrowShorthandEnd: cloneArrowMarker(defaultTip),
    tipsMode: "on draw",
    opacity: 1,
    strokeOpacity: 1,
    fillOpacity: 1,
    shadeEnabled: false,
    shading: "axis",
    shadingAngle: 0,
    axisTopColor: DEFAULT_AXIS_TOP_COLOR,
    axisMiddleColor: DEFAULT_AXIS_MIDDLE_COLOR,
    axisBottomColor: DEFAULT_AXIS_BOTTOM_COLOR,
    radialInnerColor: DEFAULT_RADIAL_INNER_COLOR,
    radialOuterColor: DEFAULT_RADIAL_OUTER_COLOR,
    ballColor: DEFAULT_BALL_COLOR,
    bilinearLowerLeft: COLOR_HEX.white,
    bilinearLowerRight: COLOR_HEX.white,
    bilinearUpperLeft: COLOR_HEX.white,
    bilinearUpperRight: COLOR_HEX.white,
    shadowScale: 1,
    shadowXShift: 0,
    shadowYShift: 0,
    shadowFade: "none",
    everyShadowStyles: [],
    shadowLayers: [],
    decoration: {
      enabled: false,
      name: null,
      raise: 0,
      mirror: false,
      transformRaw: null,
      pre: "lineto",
      preLength: 0,
      post: "lineto",
      postLength: 0,
      params: {}
    },
    decorationPreActions: [],
    decorationPostActions: []
  };
}

export function commandDefaultStyle(command: PathCommand, inheritedStyle: ResolvedStyle): Partial<ResolvedStyle> {
  const inheritedFillColor = currentFillColor(inheritedStyle);
  switch (command) {
    case "draw":
      return {
        stroke: currentStrokeColor(inheritedStyle),
        fill: null,
        fillPattern: null,
        shadeEnabled: false,
        drawExplicit: true
      };
    case "path":
    case "graph":
      return {
        stroke: null,
        fill: null,
        fillPattern: null,
        drawExplicit: false,
        shadeEnabled: false
      };
    case "pattern":
      return {
        fill: inheritedFillColor,
        fillPattern: inheritedStyle.fillPattern ?? DEFAULT_PATTERN,
        shadeEnabled: false
      };
    case "shade":
      return {
        fill: inheritedFillColor,
        stroke: inheritedStyle.drawExplicit ? inheritedStyle.stroke ?? "black" : null,
        shadeEnabled: true
      };
    case "shadedraw":
      return {
        fill: inheritedFillColor,
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true,
        shadeEnabled: true
      };
    case "fill":
      return {
        fill: inheritedFillColor,
        stroke: null,
        drawExplicit: false
      };
    case "filldraw":
      return {
        fill: inheritedFillColor,
        stroke: inheritedStyle.stroke ?? "black",
        drawExplicit: true
      };
    case "clip":
      return {
        stroke: null,
        fill: null,
        fillPattern: null,
        clip: true,
        useAsBoundingBox: false,
        drawExplicit: false,
        shadeEnabled: false
      };
    case "useasboundingbox":
      return {
        stroke: null,
        fill: null,
        fillPattern: null,
        clip: false,
        useAsBoundingBox: true,
        drawExplicit: false,
        shadeEnabled: false
      };
    case "node":
    case "coordinate":
      return {};
    default:
      return {};
  }
}

function currentFillColor(style: ResolvedStyle): string {
  return style.fill ?? style.textColor ?? (!style.drawExplicit ? style.stroke : null) ?? "black";
}

function currentStrokeColor(style: ResolvedStyle): string {
  return style.stroke ?? style.textColor ?? "black";
}

export { DEFAULT_TEXT_FONT_SIZE };
