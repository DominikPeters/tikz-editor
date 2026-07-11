import { parseLength } from "../coords/parse-length.js";
import { pt } from "../../coords/scalars.js";
import { worldPoint as makeWorldPoint, worldVector as makeWorldVector, type WorldPoint, type WorldVector } from "../../coords/points.js";
import type { OptionListAst } from "../../options/types.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import type { SemanticContext } from "../context.js";
import { normalizeOptionValue } from "./utils.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import { clamp } from "../../utils/math.js";

export type ShapeGeometryParams = {
  diamondAspect: number;
  isoscelesTriangleApexAngle: number;
  isoscelesTriangleStretches: boolean;
  kiteUpperVertexAngle: number;
  kiteLowerVertexAngle: number;
  dartTipAngle: number;
  dartTailAngle: number;
  circularSectorAngle: number;
  cylinderAspect: number;
  cloudPuffs: number;
  cloudPuffArc: number;
  cloudIgnoresAspect: boolean;
  starburstPoints: number;
  starburstPointHeightPt: number;
  randomStarburstSeed: number;
  signalPointerAngle: number;
  signalToSides: SignalDirection[];
  signalFromSides: SignalDirection[];
  tapeBendTop: TapeBendStyle;
  tapeBendBottom: TapeBendStyle;
  tapeBendHeightPt: number;
  calloutPointerIsAbsolute: boolean;
  calloutRelativePointerRaw: string;
  calloutAbsolutePointerRaw: string | null;
  calloutPointerShortenPt: number;
  calloutPointerWidthPt: number;
  calloutPointerArc: number;
  calloutPointerStartSizeRaw: string;
  calloutPointerEndSizeRaw: string;
  calloutPointerSegments: number;
  singleArrowTipAngle: number;
  singleArrowHeadExtendPt: number;
  singleArrowHeadIndentPt: number;
  doubleArrowTipAngle: number;
  doubleArrowHeadExtendPt: number;
  doubleArrowHeadIndentPt: number;
  trapeziumLeftAngle: number;
  trapeziumRightAngle: number;
  shapeBorderRotate: number;
  trapeziumStretches: boolean;
  trapeziumStretchesBody: boolean;
  regularPolygonSides: number;
  starPoints: number;
  starPointRatio: number;
  starPointHeightPt: number;
  starUsesPointRatio: boolean;
  magnifyingGlassHandleAngle: number;
  magnifyingGlassHandleAspect: number;
  roundedRectangleArcLength: number;
  roundedRectangleWestArc: RoundedRectangleArcType;
  roundedRectangleEastArc: RoundedRectangleArcType;
  chamferedRectangleAngle: number;
  chamferedRectangleXSepPt: number;
  chamferedRectangleYSepPt: number;
  chamferedRectangleCorners: string;
};

export type TrapeziumSizingInput = {
  naturalHalfWidth: number;
  naturalHalfHeight: number;
  minimumWidth: number;
  minimumHeight: number;
};

export type CircularSizingInput = {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
  textBlockWidth?: number;
  textBlockHeight?: number;
  innerXSep?: number;
  innerYSep?: number;
};

export type TwoPartShapeSizingInput = {
  upperWidth: number;
  upperHeight: number;
  upperDepth: number;
  lowerWidth: number;
  lowerHeight: number;
  lowerAscent: number;
  lowerDepth: number;
  innerXSep: number;
  innerYSep: number;
  lineWidth: number;
  minimumWidth: number;
  minimumHeight: number;
};

export type SignalDirection = "north" | "south" | "east" | "west";
export type TapeBendStyle = "in and out" | "out and in" | "none";
export type RoundedRectangleArcType = "convex" | "concave" | "none";

export type SemicircleGeometry = {
  center: WorldPoint;
  radius: number;
  rotation: number;
  apex: WorldPoint;
  arcStart: WorldPoint;
  arcEnd: WorldPoint;
  chordCenter: WorldPoint;
  polygon: WorldPoint[];
};

export type CircularSectorGeometry = {
  sectorCenter: WorldPoint;
  arcStart: WorldPoint;
  arcEnd: WorldPoint;
  arcCenter: WorldPoint;
  radius: number;
  rotation: number;
  polygon: WorldPoint[];
};

export type CylinderGeometry = {
  shapeCenter: WorldPoint;
  beforeTop: WorldPoint;
  top: WorldPoint;
  afterTop: WorldPoint;
  beforeBottom: WorldPoint;
  bottom: WorldPoint;
  afterBottom: WorldPoint;
  endCapArc: WorldPoint[];
  polygon: WorldPoint[];
};

export type CloudGeometry = {
  polygon: WorldPoint[];
  curves: CloudCurveSegment[];
  puffs: WorldPoint[];
  innerRx: number;
  innerRy: number;
  outerRx: number;
  outerRy: number;
};

export type CloudCurveSegment = {
  c1: WorldPoint;
  c2: WorldPoint;
  to: WorldPoint;
};

export type StarburstGeometry = {
  polygon: WorldPoint[];
  outer: WorldPoint[];
  inner: WorldPoint[];
};

export type SignalGeometry = {
  polygon: WorldPoint[];
};

export type TapeGeometry = {
  polygon: WorldPoint[];
};

export type RectangleCalloutGeometry = {
  polygon: WorldPoint[];
  pointer: WorldPoint;
  pointerAnchor: WorldPoint;
};

export type EllipseCalloutGeometry = {
  polygon: WorldPoint[];
  pointer: WorldPoint;
  pointerAnchor: WorldPoint;
};

export type CloudCalloutGeometry = {
  polygon: WorldPoint[];
  curves: CloudCurveSegment[];
  pointerPolygon: WorldPoint[];
  pointerPolygons: WorldPoint[][];
  pointer: WorldPoint;
  pointerAnchor: WorldPoint;
  puffs: WorldPoint[];
};

export type SingleArrowGeometry = {
  polygon: WorldPoint[];
  tip: WorldPoint;
  beforeTip: WorldPoint;
  afterTip: WorldPoint;
  beforeHead: WorldPoint;
  afterHead: WorldPoint;
  beforeTail: WorldPoint;
  afterTail: WorldPoint;
  tail: WorldPoint;
};

export type DoubleArrowGeometry = {
  polygon: WorldPoint[];
  tip1: WorldPoint;
  beforeTip1: WorldPoint;
  afterTip1: WorldPoint;
  beforeHead1: WorldPoint;
  afterHead1: WorldPoint;
  tip2: WorldPoint;
  beforeTip2: WorldPoint;
  afterTip2: WorldPoint;
  beforeHead2: WorldPoint;
  afterHead2: WorldPoint;
};

const DEFAULT_DIAMOND_ASPECT = 1;
const DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE = 45;
const DEFAULT_KITE_UPPER_VERTEX_ANGLE = 120;
const DEFAULT_KITE_LOWER_VERTEX_ANGLE = 60;
const DEFAULT_DART_TIP_ANGLE = 45;
const DEFAULT_DART_TAIL_ANGLE = 135;
const DEFAULT_CIRCULAR_SECTOR_ANGLE = 60;
const DEFAULT_CYLINDER_ASPECT = 1;
const DEFAULT_CLOUD_PUFFS = 10;
const DEFAULT_CLOUD_PUFF_ARC = 150;
const DEFAULT_CLOUD_IGNORES_ASPECT = false;
const DEFAULT_STARBURST_POINTS = 17;
const DEFAULT_STARBURST_POINT_HEIGHT_PT = parseLength(".5cm", "pt") ?? 14.2264;
const DEFAULT_RANDOM_STARBURST_SEED = 100;
const DEFAULT_SIGNAL_POINTER_ANGLE = 90;
const DEFAULT_TAPE_BEND_STYLE: TapeBendStyle = "in and out";
const DEFAULT_TAPE_BEND_HEIGHT_PT = parseLength("5pt", "pt") ?? 5;
const DEFAULT_CALLOUT_RELATIVE_POINTER_RAW = "(300:.5cm)";
const DEFAULT_CALLOUT_POINTER_SHORTEN_PT = 0;
const DEFAULT_CALLOUT_POINTER_WIDTH_PT = parseLength(".25cm", "pt") ?? 7.1132;
const DEFAULT_CALLOUT_POINTER_ARC = 15;
const DEFAULT_CALLOUT_POINTER_START_SIZE_RAW = ".2 of callout";
const DEFAULT_CALLOUT_POINTER_END_SIZE_RAW = ".1 of callout";
const DEFAULT_CALLOUT_POINTER_SEGMENTS = 2;
const DEFAULT_SINGLE_ARROW_TIP_ANGLE = 90;
const DEFAULT_SINGLE_ARROW_HEAD_EXTEND_PT = parseLength(".25cm", "pt") ?? 7.1132;
const DEFAULT_SINGLE_ARROW_HEAD_INDENT_PT = 0;
const DEFAULT_DOUBLE_ARROW_TIP_ANGLE = 90;
const DEFAULT_DOUBLE_ARROW_HEAD_EXTEND_PT = parseLength(".25cm", "pt") ?? 7.1132;
const DEFAULT_DOUBLE_ARROW_HEAD_INDENT_PT = 0;
const DEFAULT_TRAPEZIUM_ANGLE = 60;
const DEFAULT_SHAPE_BORDER_ROTATE = 0;
const DEFAULT_REGULAR_POLYGON_SIDES = 5;
const DEFAULT_STAR_POINTS = 5;
const DEFAULT_STAR_RATIO = 1.5;
const DEFAULT_STAR_POINT_HEIGHT_PT = parseLength(".5cm", "pt") ?? 14.2264;
const DEFAULT_MAGNIFYING_GLASS_HANDLE_ANGLE = -45;
const DEFAULT_MAGNIFYING_GLASS_HANDLE_ASPECT = 1.5;
const DEFAULT_ROUNDED_RECTANGLE_ARC_LENGTH = 180;
const DEFAULT_ROUNDED_RECTANGLE_ARC: RoundedRectangleArcType = "convex";
const DEFAULT_CHAMFERED_RECTANGLE_ANGLE = 45;
const DEFAULT_CHAMFERED_RECTANGLE_SEP_PT = parseLength(".666ex", "pt") ?? 3.333;
const DEFAULT_CHAMFERED_RECTANGLE_CORNERS = "chamfer all";
const EPSILON = 1e-9;

function worldPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

function worldVector(x: number, y: number): WorldVector {
  return makeWorldVector(pt(x), pt(y));
}

export function resolveNodeShapeGeometryParams(
  options?: OptionListAst,
  randomSeedProvider: () => number = defaultRandomSeedProvider
): ShapeGeometryParams {
  let diamondAspect = DEFAULT_DIAMOND_ASPECT;
  let isoscelesTriangleApexAngle = DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE;
  let isoscelesTriangleStretches = false;
  let kiteUpperVertexAngle = DEFAULT_KITE_UPPER_VERTEX_ANGLE;
  let kiteLowerVertexAngle = DEFAULT_KITE_LOWER_VERTEX_ANGLE;
  let dartTipAngle = DEFAULT_DART_TIP_ANGLE;
  let dartTailAngle = DEFAULT_DART_TAIL_ANGLE;
  let circularSectorAngle = DEFAULT_CIRCULAR_SECTOR_ANGLE;
  let cylinderAspect = DEFAULT_CYLINDER_ASPECT;
  let cloudPuffs = DEFAULT_CLOUD_PUFFS;
  let cloudPuffArc = DEFAULT_CLOUD_PUFF_ARC;
  let cloudIgnoresAspect = DEFAULT_CLOUD_IGNORES_ASPECT;
  let starburstPoints = DEFAULT_STARBURST_POINTS;
  let starburstPointHeightPt = DEFAULT_STARBURST_POINT_HEIGHT_PT;
  let randomStarburstSeed = DEFAULT_RANDOM_STARBURST_SEED;
  let signalPointerAngle = DEFAULT_SIGNAL_POINTER_ANGLE;
  let signalToSides: SignalDirection[] = ["east"];
  let signalFromSides: SignalDirection[] = [];
  let tapeBendTop: TapeBendStyle = DEFAULT_TAPE_BEND_STYLE;
  let tapeBendBottom: TapeBendStyle = DEFAULT_TAPE_BEND_STYLE;
  let tapeBendHeightPt = DEFAULT_TAPE_BEND_HEIGHT_PT;
  let calloutPointerIsAbsolute = false;
  let calloutRelativePointerRaw = DEFAULT_CALLOUT_RELATIVE_POINTER_RAW;
  let calloutAbsolutePointerRaw: string | null = null;
  let calloutPointerShortenPt = DEFAULT_CALLOUT_POINTER_SHORTEN_PT;
  let calloutPointerWidthPt = DEFAULT_CALLOUT_POINTER_WIDTH_PT;
  let calloutPointerArc = DEFAULT_CALLOUT_POINTER_ARC;
  let calloutPointerStartSizeRaw = DEFAULT_CALLOUT_POINTER_START_SIZE_RAW;
  let calloutPointerEndSizeRaw = DEFAULT_CALLOUT_POINTER_END_SIZE_RAW;
  let calloutPointerSegments = DEFAULT_CALLOUT_POINTER_SEGMENTS;
  let singleArrowTipAngle = DEFAULT_SINGLE_ARROW_TIP_ANGLE;
  let singleArrowHeadExtendPt = DEFAULT_SINGLE_ARROW_HEAD_EXTEND_PT;
  let singleArrowHeadIndentPt = DEFAULT_SINGLE_ARROW_HEAD_INDENT_PT;
  let doubleArrowTipAngle = DEFAULT_DOUBLE_ARROW_TIP_ANGLE;
  let doubleArrowHeadExtendPt = DEFAULT_DOUBLE_ARROW_HEAD_EXTEND_PT;
  let doubleArrowHeadIndentPt = DEFAULT_DOUBLE_ARROW_HEAD_INDENT_PT;
  let trapeziumLeftAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let trapeziumRightAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let shapeBorderRotate = DEFAULT_SHAPE_BORDER_ROTATE;
  let trapeziumStretches = false;
  let trapeziumStretchesBody = false;
  let regularPolygonSides = DEFAULT_REGULAR_POLYGON_SIDES;
  let starPoints = DEFAULT_STAR_POINTS;
  let starPointRatio = DEFAULT_STAR_RATIO;
  let starPointHeightPt = DEFAULT_STAR_POINT_HEIGHT_PT;
  let starUsesPointRatio = true;
  let magnifyingGlassHandleAngle = DEFAULT_MAGNIFYING_GLASS_HANDLE_ANGLE;
  let magnifyingGlassHandleAspect = DEFAULT_MAGNIFYING_GLASS_HANDLE_ASPECT;
  let roundedRectangleArcLength = DEFAULT_ROUNDED_RECTANGLE_ARC_LENGTH;
  let roundedRectangleWestArc: RoundedRectangleArcType = DEFAULT_ROUNDED_RECTANGLE_ARC;
  let roundedRectangleEastArc: RoundedRectangleArcType = DEFAULT_ROUNDED_RECTANGLE_ARC;
  let chamferedRectangleAngle = DEFAULT_CHAMFERED_RECTANGLE_ANGLE;
  let chamferedRectangleXSepPt = DEFAULT_CHAMFERED_RECTANGLE_SEP_PT;
  let chamferedRectangleYSepPt = DEFAULT_CHAMFERED_RECTANGLE_SEP_PT;
  let chamferedRectangleCorners = DEFAULT_CHAMFERED_RECTANGLE_CORNERS;

  if (!options) {
    return {
      diamondAspect,
      isoscelesTriangleApexAngle,
      isoscelesTriangleStretches,
      kiteUpperVertexAngle,
      kiteLowerVertexAngle,
      dartTipAngle,
      dartTailAngle,
      circularSectorAngle,
      cylinderAspect,
      cloudPuffs,
      cloudPuffArc,
      cloudIgnoresAspect,
      starburstPoints,
      starburstPointHeightPt,
      randomStarburstSeed,
      signalPointerAngle,
      signalToSides,
      signalFromSides,
      tapeBendTop,
      tapeBendBottom,
      tapeBendHeightPt,
      calloutPointerIsAbsolute,
      calloutRelativePointerRaw,
      calloutAbsolutePointerRaw,
      calloutPointerShortenPt,
      calloutPointerWidthPt,
      calloutPointerArc,
      calloutPointerStartSizeRaw,
      calloutPointerEndSizeRaw,
      calloutPointerSegments,
      singleArrowTipAngle,
      singleArrowHeadExtendPt,
      singleArrowHeadIndentPt,
      doubleArrowTipAngle,
      doubleArrowHeadExtendPt,
      doubleArrowHeadIndentPt,
      trapeziumLeftAngle,
      trapeziumRightAngle,
      shapeBorderRotate,
      trapeziumStretches,
      trapeziumStretchesBody,
      regularPolygonSides,
      starPoints,
      starPointRatio,
      starPointHeightPt,
      starUsesPointRatio,
      magnifyingGlassHandleAngle,
      magnifyingGlassHandleAspect,
      roundedRectangleArcLength,
      roundedRectangleWestArc,
      roundedRectangleEastArc,
      chamferedRectangleAngle,
      chamferedRectangleXSepPt,
      chamferedRectangleYSepPt,
      chamferedRectangleCorners
    };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "trapezium stretches") {
        trapeziumStretches = true;
      } else if (entry.key === "trapezium stretches body") {
        trapeziumStretchesBody = true;
      } else if (entry.key === "isosceles triangle stretches") {
        isoscelesTriangleStretches = true;
      } else if (entry.key === "cloud ignores aspect") {
        cloudIgnoresAspect = true;
      } else if (entry.key === "random starburst") {
        randomStarburstSeed = randomSeedProvider();
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "aspect" || entry.key === "shape aspect") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        diamondAspect = normalizeAspect(parsed);
        cylinderAspect = normalizeAspect(parsed);
      }
      continue;
    }

    if (entry.key === "isosceles triangle apex angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        isoscelesTriangleApexAngle = normalizeAcuteAngle(parsed, DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "isosceles triangle stretches") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        isoscelesTriangleStretches = parsed;
      }
      continue;
    }

    if (entry.key === "kite upper vertex angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        kiteUpperVertexAngle = normalizeAcuteAngle(parsed, DEFAULT_KITE_UPPER_VERTEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "kite lower vertex angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        kiteLowerVertexAngle = normalizeAcuteAngle(parsed, DEFAULT_KITE_LOWER_VERTEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "kite vertex angles") {
      const parsed = parseKiteVertexAngles(entry.valueRaw);
      if (parsed) {
        kiteUpperVertexAngle = normalizeAcuteAngle(parsed.upper, DEFAULT_KITE_UPPER_VERTEX_ANGLE);
        kiteLowerVertexAngle = normalizeAcuteAngle(parsed.lower, DEFAULT_KITE_LOWER_VERTEX_ANGLE);
      }
      continue;
    }

    if (entry.key === "dart tip angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        dartTipAngle = normalizeAcuteAngle(parsed, DEFAULT_DART_TIP_ANGLE);
      }
      continue;
    }

    if (entry.key === "dart tail angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        dartTailAngle = normalizeTailAngle(parsed);
      }
      continue;
    }

    if (entry.key === "circular sector angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        circularSectorAngle = normalizeSectorAngle(parsed);
      }
      continue;
    }

    if (entry.key === "cloud puffs") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        cloudPuffs = normalizeInteger(parsed, 2, 360, DEFAULT_CLOUD_PUFFS);
      }
      continue;
    }

    if (entry.key === "cloud puff arc") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        cloudPuffArc = normalizeCloudPuffArc(parsed);
      }
      continue;
    }

    if (entry.key === "cloud ignores aspect") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        cloudIgnoresAspect = parsed;
      }
      continue;
    }

    if (entry.key === "starburst points") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        starburstPoints = normalizeInteger(parsed, 2, 360, DEFAULT_STARBURST_POINTS);
      }
      continue;
    }

    if (entry.key === "starburst point height") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        starburstPointHeightPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "random starburst") {
      const parsed = parseRandomStarburstOption(entry.valueRaw, randomSeedProvider);
      if (parsed != null) {
        randomStarburstSeed = parsed;
      }
      continue;
    }

    if (entry.key === "signal pointer angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        signalPointerAngle = normalizeSignalPointerAngle(parsed);
      }
      continue;
    }

    if (entry.key === "signal to") {
      signalToSides = parseSignalDirectionSpec(entry.valueRaw);
      continue;
    }

    if (entry.key === "signal from") {
      signalFromSides = parseSignalDirectionSpec(entry.valueRaw);
      continue;
    }

    if (entry.key === "tape bend top") {
      tapeBendTop = parseTapeBendStyle(entry.valueRaw, DEFAULT_TAPE_BEND_STYLE);
      continue;
    }

    if (entry.key === "tape bend bottom") {
      tapeBendBottom = parseTapeBendStyle(entry.valueRaw, DEFAULT_TAPE_BEND_STYLE);
      continue;
    }

    if (entry.key === "tape bend") {
      const style = parseTapeBendStyle(entry.valueRaw, DEFAULT_TAPE_BEND_STYLE);
      tapeBendTop = style;
      tapeBendBottom = style;
      continue;
    }

    if (entry.key === "tape bend height") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        tapeBendHeightPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "callout relative pointer") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerIsAbsolute = false;
        calloutRelativePointerRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout absolute pointer") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerIsAbsolute = true;
        calloutAbsolutePointerRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout pointer shorten") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        calloutPointerShortenPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "callout pointer width") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        calloutPointerWidthPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "callout pointer arc") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        calloutPointerArc = normalizeCalloutPointerArc(parsed);
      }
      continue;
    }

    if (entry.key === "callout pointer start size") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerStartSizeRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout pointer end size") {
      const normalized = normalizeOptionValue(entry.valueRaw);
      if (normalized.length > 0) {
        calloutPointerEndSizeRaw = normalized;
      }
      continue;
    }

    if (entry.key === "callout pointer segments") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        calloutPointerSegments = normalizeInteger(parsed, 1, 128, DEFAULT_CALLOUT_POINTER_SEGMENTS);
      }
      continue;
    }

    if (entry.key === "single arrow tip angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        singleArrowTipAngle = normalizeArrowTipAngle(parsed, DEFAULT_SINGLE_ARROW_TIP_ANGLE);
      }
      continue;
    }

    if (entry.key === "single arrow head extend") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        singleArrowHeadExtendPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "single arrow head indent") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        singleArrowHeadIndentPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "double arrow tip angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        doubleArrowTipAngle = normalizeArrowTipAngle(parsed, DEFAULT_DOUBLE_ARROW_TIP_ANGLE);
      }
      continue;
    }

    if (entry.key === "double arrow head extend") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        doubleArrowHeadExtendPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "double arrow head indent") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        doubleArrowHeadIndentPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "trapezium angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        const normalized = normalizeAngle(parsed);
        trapeziumLeftAngle = normalized;
        trapeziumRightAngle = normalized;
      }
      continue;
    }

    if (entry.key === "trapezium left angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumLeftAngle = normalizeAngle(parsed);
      }
      continue;
    }

    if (entry.key === "trapezium right angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumRightAngle = normalizeAngle(parsed);
      }
      continue;
    }

    if (entry.key === "shape border rotate" || entry.key === "regular polygon rotate" || entry.key === "star rotate") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        shapeBorderRotate = parsed;
      }
      continue;
    }

    if (entry.key === "trapezium stretches") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumStretches = parsed;
      }
      continue;
    }

    if (entry.key === "trapezium stretches body") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumStretchesBody = parsed;
      }
      continue;
    }

    if (entry.key === "regular polygon sides") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        regularPolygonSides = normalizeInteger(parsed, 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
      }
      continue;
    }

    if (entry.key === "star points") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        starPoints = normalizeInteger(parsed, 2, 360, DEFAULT_STAR_POINTS);
      }
      continue;
    }

    if (entry.key === "star point ratio") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        starPointRatio = normalizeRatio(parsed);
        starUsesPointRatio = true;
      }
      continue;
    }

    if (entry.key === "star point height") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        starPointHeightPt = Math.max(0, parsedLength);
        starUsesPointRatio = false;
      }
      continue;
    }

    if (entry.key === "magnifying glass handle angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        magnifyingGlassHandleAngle = parsed;
      }
      continue;
    }

    if (entry.key === "magnifying glass handle aspect") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null && parsed > 0) {
        magnifyingGlassHandleAspect = parsed;
      }
      continue;
    }

    if (entry.key === "rounded rectangle arc length") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        roundedRectangleArcLength = Math.max(0, Math.min(180, Math.abs(parsed)));
      }
      continue;
    }

    if (entry.key === "rounded rectangle west arc" || entry.key === "rounded rectangle left arc") {
      roundedRectangleWestArc = parseRoundedRectangleArcType(entry.valueRaw);
      continue;
    }

    if (entry.key === "rounded rectangle east arc" || entry.key === "rounded rectangle right arc") {
      roundedRectangleEastArc = parseRoundedRectangleArcType(entry.valueRaw);
      continue;
    }

    if (entry.key === "chamfered rectangle angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        chamferedRectangleAngle = Math.max(1, Math.min(89, Math.abs(parsed)));
      }
      continue;
    }

    if (entry.key === "chamfered rectangle xsep") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        chamferedRectangleXSepPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "chamfered rectangle ysep") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        chamferedRectangleYSepPt = Math.max(0, parsedLength);
      }
      continue;
    }

    if (entry.key === "chamfered rectangle sep") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        const sep = Math.max(0, parsedLength);
        chamferedRectangleXSepPt = sep;
        chamferedRectangleYSepPt = sep;
      }
      continue;
    }

    if (entry.key === "chamfered rectangle corners") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase().trim();
      if (normalized.length > 0) {
        chamferedRectangleCorners = normalized;
      }
    }
  }

  return {
    diamondAspect,
    isoscelesTriangleApexAngle,
    isoscelesTriangleStretches,
    kiteUpperVertexAngle,
    kiteLowerVertexAngle,
    dartTipAngle,
    dartTailAngle,
    circularSectorAngle,
    cylinderAspect,
    cloudPuffs,
    cloudPuffArc,
    cloudIgnoresAspect,
    starburstPoints,
    starburstPointHeightPt,
    randomStarburstSeed,
    signalPointerAngle,
    signalToSides,
    signalFromSides,
    tapeBendTop,
    tapeBendBottom,
    tapeBendHeightPt,
    calloutPointerIsAbsolute,
    calloutRelativePointerRaw,
    calloutAbsolutePointerRaw,
    calloutPointerShortenPt,
    calloutPointerWidthPt,
    calloutPointerArc,
    calloutPointerStartSizeRaw,
    calloutPointerEndSizeRaw,
    calloutPointerSegments,
    singleArrowTipAngle,
    singleArrowHeadExtendPt,
    singleArrowHeadIndentPt,
    doubleArrowTipAngle,
    doubleArrowHeadExtendPt,
    doubleArrowHeadIndentPt,
    trapeziumLeftAngle,
    trapeziumRightAngle,
    shapeBorderRotate,
    trapeziumStretches,
    trapeziumStretchesBody,
    regularPolygonSides,
    starPoints,
    starPointRatio,
    starPointHeightPt,
    starUsesPointRatio,
    magnifyingGlassHandleAngle,
    magnifyingGlassHandleAspect,
    roundedRectangleArcLength,
    roundedRectangleWestArc,
    roundedRectangleEastArc,
    chamferedRectangleAngle,
    chamferedRectangleXSepPt,
    chamferedRectangleYSepPt,
    chamferedRectangleCorners
  };
}

export function makeRoundedRectanglePolygon(
  width: number,
  height: number,
  arcLength: number,
  westArc: RoundedRectangleArcType,
  eastArc: RoundedRectangleArcType
): WorldPoint[] {
  const halfWidth = Math.max(EPSILON, width / 2);
  const halfHeight = Math.max(EPSILON, height / 2);
  const arcFactor = Math.max(0, Math.min(1, Math.abs(arcLength) / 180));
  const bulgeX = Math.min(halfWidth, halfHeight) * arcFactor;
  const points: WorldPoint[] = [];

  const westJoinX = westArc === "none" ? -halfWidth : -halfWidth + bulgeX;
  const eastJoinX = eastArc === "none" ? halfWidth : halfWidth - bulgeX;
  points.push(worldPoint(westJoinX, halfHeight));
  points.push(worldPoint(eastJoinX, halfHeight));

  if (eastArc !== "none" && bulgeX > EPSILON) {
    const eastDir = eastArc === "concave" ? -1 : 1;
    const eastCenterX = halfWidth - bulgeX;
    const steps = Math.max(6, Math.round(24 * arcFactor));
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const theta = Math.PI / 2 - t * Math.PI;
      points.push(worldPoint(
        eastCenterX + eastDir * bulgeX * Math.cos(theta),
        halfHeight * Math.sin(theta)
      ));
    }
  } else {
    points.push(worldPoint(halfWidth, -halfHeight));
  }

  points.push(worldPoint(westJoinX, -halfHeight));

  if (westArc !== "none" && bulgeX > EPSILON) {
    const westDir = westArc === "concave" ? 1 : -1;
    const westCenterX = -halfWidth + bulgeX;
    const steps = Math.max(6, Math.round(24 * arcFactor));
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      const theta = -Math.PI / 2 + t * Math.PI;
      points.push(worldPoint(
        westCenterX + westDir * bulgeX * Math.cos(theta),
        halfHeight * Math.sin(theta)
      ));
    }
  } else {
    points.push(worldPoint(-halfWidth, halfHeight));
  }

  return points;
}

export function makeRoundedRectanglePolygonForSizing(
  sizing: CircularSizingInput,
  arcLength: number,
  westArc: RoundedRectangleArcType,
  eastArc: RoundedRectangleArcType
): WorldPoint[] {
  const halfArcAngle = Math.max(1e-3, Math.min(90, Math.abs(arcLength) / 2));
  const sineHalfArc = Math.sin(toRadians(halfArcAngle));
  const cosineHalfArc = Math.cos(toRadians(halfArcAngle));
  const textBlockWidth = Math.max(0, sizing.textBlockWidth ?? sizing.naturalWidth);
  const textBlockHeight = Math.max(0, sizing.textBlockHeight ?? sizing.naturalHeight);
  const innerXSep = Math.max(0, sizing.innerXSep ?? Math.max(0, (sizing.naturalWidth - textBlockWidth) / 2));
  const innerYSep = Math.max(0, sizing.innerYSep ?? Math.max(0, (sizing.naturalHeight - textBlockHeight) / 2));
  const halfTextWidth = textBlockWidth / 2;
  const halfTextHeight = textBlockHeight / 2;
  const halfHeight = Math.max(halfTextHeight + innerYSep, sizing.minimumHeight / 2, EPSILON);
  const radius = halfHeight / Math.max(sineHalfArc, EPSILON);
  const arcWidth = radius * (1 - cosineHalfArc);
  const chordAngle = Math.asin(clamp(halfTextHeight / Math.max(radius, EPSILON), -1, 1));
  const chordWidth = radius * (1 - Math.cos(chordAngle));
  const sideContribution = (arc: RoundedRectangleArcType): number => {
    if (arc === "concave") {
      return arcWidth;
    }
    if (arc === "convex") {
      return chordWidth;
    }
    return 0;
  };

  const westContribution = sideContribution(westArc);
  const eastContribution = sideContribution(eastArc);
  let resolvedXSep = innerXSep;
  const naturalPathWidth = 2 * (halfTextWidth + innerXSep) + westContribution + eastContribution;
  if (naturalPathWidth + EPSILON < sizing.minimumWidth) {
    resolvedXSep = (sizing.minimumWidth - naturalPathWidth) / 2;
  }
  resolvedXSep = Math.max(resolvedXSep, radius - chordWidth - halfTextWidth, 0);
  const halfWidth = halfTextWidth + resolvedXSep;

  const points: WorldPoint[] = [];
  points.push(worldPoint(0, halfHeight));
  if (eastArc === "convex") {
    const centerX = halfWidth + chordWidth - radius;
    points.push(worldPoint(halfWidth + chordWidth - arcWidth, halfHeight));
    for (let index = 1; index <= 24; index += 1) {
      const angle = toRadians(halfArcAngle - (2 * halfArcAngle * index) / 24);
      points.push(worldPoint(centerX + radius * Math.cos(angle), radius * Math.sin(angle)));
    }
  } else if (eastArc === "concave") {
    const centerX = halfWidth + arcWidth - radius;
    points.push(worldPoint(halfWidth + arcWidth, halfHeight));
    for (let index = 1; index <= 24; index += 1) {
      const angle = toRadians(180 - halfArcAngle + (2 * halfArcAngle * index) / 24);
      points.push(worldPoint(centerX + radius * Math.cos(angle), radius * Math.sin(angle)));
    }
  } else {
    points.push(worldPoint(halfWidth, halfHeight));
    points.push(worldPoint(halfWidth, -halfHeight));
  }
  if (westArc === "convex") {
    const centerX = -halfWidth - chordWidth + radius;
    points.push(worldPoint(-halfWidth - chordWidth + arcWidth, -halfHeight));
    for (let index = 1; index <= 24; index += 1) {
      const angle = toRadians(180 + halfArcAngle - (2 * halfArcAngle * index) / 24);
      points.push(worldPoint(centerX + radius * Math.cos(angle), radius * Math.sin(angle)));
    }
  } else if (westArc === "concave") {
    const centerX = -halfWidth - arcWidth + radius;
    points.push(worldPoint(-halfWidth - arcWidth, -halfHeight));
    for (let index = 1; index <= 24; index += 1) {
      const angle = toRadians(-halfArcAngle + (2 * halfArcAngle * index) / 24);
      points.push(worldPoint(centerX + radius * Math.cos(angle), radius * Math.sin(angle)));
    }
  } else {
    points.push(worldPoint(-halfWidth, -halfHeight));
    points.push(worldPoint(-halfWidth, halfHeight));
  }

  return points;
}

export function makeChamferedRectanglePolygon(
  width: number,
  height: number,
  chamferX: number,
  chamferY: number,
  chamferAngle: number,
  cornersRaw: string
): WorldPoint[] {
  const halfWidth = Math.max(EPSILON, width / 2);
  const halfHeight = Math.max(EPSILON, height / 2);
  const cy = Math.max(0, Math.min(halfHeight * 0.8, chamferY));
  const angleRad = toRadians(Math.max(1, Math.min(89, Math.abs(chamferAngle))));
  const usesUnifiedChamfer = Math.abs(chamferX - chamferY) < 1e-6;
  const base = Math.min(halfWidth, halfHeight) * 0.55;
  const angleRatio = Math.max(0.2, Math.min(5, 45 / Math.max(1, Math.abs(chamferAngle))));
  const cxFromAngle = usesUnifiedChamfer ? base * angleRatio : cy / Math.tan(angleRad);
  const cyFromAngle = usesUnifiedChamfer ? base / angleRatio : cy;
  const cxRaw = usesUnifiedChamfer ? cxFromAngle : chamferX;
  const cyRaw = usesUnifiedChamfer ? cyFromAngle : chamferY;
  const cx = Math.max(0, Math.min(halfWidth * 0.8, cxRaw));
  const cyEffective = Math.max(0, Math.min(halfHeight * 0.8, cyRaw));
  const corners = parseChamferedCorners(cornersRaw);

  const nw = corners.has("north west");
  const ne = corners.has("north east");
  const se = corners.has("south east");
  const sw = corners.has("south west");

  return [
    worldPoint(-halfWidth + (nw ? cx : 0), halfHeight),
    worldPoint(halfWidth - (ne ? cx : 0), halfHeight),
    worldPoint(halfWidth, halfHeight - (ne ? cyEffective : 0)),
    worldPoint(halfWidth, -halfHeight + (se ? cyEffective : 0)),
    worldPoint(halfWidth - (se ? cx : 0), -halfHeight),
    worldPoint(-halfWidth + (sw ? cx : 0), -halfHeight),
    worldPoint(-halfWidth, -halfHeight + (sw ? cyEffective : 0)),
    worldPoint(-halfWidth, halfHeight - (nw ? cyEffective : 0))
  ];
}

export function makeChamferedRectanglePolygonForSizing(
  sizing: CircularSizingInput,
  chamferX: number,
  chamferY: number,
  chamferAngle: number,
  cornersRaw: string
): WorldPoint[] {
  const angle = Math.max(1, Math.min(89, Math.abs(chamferAngle)));
  const complement = 90 - angle;
  const tanAngle = Math.tan(toRadians(complement));
  const cotAngle = cotDegrees(complement);
  let halfBodyWidth = Math.max(EPSILON, sizing.naturalWidth / 2);
  let halfBodyHeight = Math.max(EPSILON, sizing.naturalHeight / 2);
  let xChamfer = Math.max(0, chamferX);
  let yFromXChamfer = tanAngle * xChamfer;
  if (yFromXChamfer > halfBodyHeight) {
    yFromXChamfer = halfBodyHeight;
    xChamfer = cotAngle * yFromXChamfer;
  }
  let yChamfer = Math.max(0, chamferY);
  let xFromYChamfer = cotAngle * yChamfer;
  if (xFromYChamfer > halfBodyWidth) {
    xFromYChamfer = halfBodyWidth;
    yChamfer = tanAngle * xFromYChamfer;
  }

  if (halfBodyWidth + xChamfer + EPSILON < sizing.minimumWidth / 2) {
    halfBodyWidth = Math.max(EPSILON, sizing.minimumWidth / 2 - xChamfer);
  }
  if (halfBodyHeight + yChamfer + EPSILON < sizing.minimumHeight / 2) {
    halfBodyHeight = Math.max(EPSILON, sizing.minimumHeight / 2 - yChamfer);
  }

  const corners = parseChamferedCorners(cornersRaw);
  const isChamfered = (corner: "north west" | "north east" | "south east" | "south west"): boolean => corners.has(corner);
  const corner = (xSign: -1 | 1, ySign: -1 | 1): WorldPoint =>
    worldPoint(xSign * (halfBodyWidth + xChamfer), ySign * (halfBodyHeight + yChamfer));

  return [
    isChamfered("north east") ? worldPoint(halfBodyWidth + xChamfer, halfBodyHeight - yFromXChamfer) : corner(1, 1),
    isChamfered("north east") ? worldPoint(halfBodyWidth - xFromYChamfer, halfBodyHeight + yChamfer) : corner(1, 1),
    isChamfered("north west") ? worldPoint(-halfBodyWidth + xFromYChamfer, halfBodyHeight + yChamfer) : corner(-1, 1),
    isChamfered("north west") ? worldPoint(-halfBodyWidth - xChamfer, halfBodyHeight - yFromXChamfer) : corner(-1, 1),
    isChamfered("south west") ? worldPoint(-halfBodyWidth - xChamfer, -halfBodyHeight + yFromXChamfer) : corner(-1, -1),
    isChamfered("south west") ? worldPoint(-halfBodyWidth + xFromYChamfer, -halfBodyHeight - yChamfer) : corner(-1, -1),
    isChamfered("south east") ? worldPoint(halfBodyWidth - xFromYChamfer, -halfBodyHeight - yChamfer) : corner(1, -1),
    isChamfered("south east") ? worldPoint(halfBodyWidth + xChamfer, -halfBodyHeight + yFromXChamfer) : corner(1, -1)
  ];
}

export function makeMagnifyingGlassHandle(
  radius: number,
  angleDegrees: number,
  aspect: number
): { from: WorldPoint; to: WorldPoint } {
  const safeAspect = Math.max(0.1, aspect);
  const from = pointPolar(angleDegrees, radius);
  const to = pointPolar(angleDegrees, radius * (1 + safeAspect));
  return { from, to };
}

export function makeDiamondPolygon(halfWidth: number, halfHeight: number, aspect: number): WorldPoint[] {
  const safeHalfWidth = Math.max(0, halfWidth);
  const safeHalfHeight = Math.max(0, halfHeight);
  const safeAspect = normalizeAspect(aspect);
  const horizontalRadius = safeHalfWidth + safeAspect * safeHalfHeight;
  const verticalRadius = safeHalfWidth / safeAspect + safeHalfHeight;
  return makeDiamondPolygonFromRadii(horizontalRadius, verticalRadius);
}

export function makeDiamondPolygonForSizing(sizing: CircularSizingInput, aspect: number): WorldPoint[] {
  const safeAspect = normalizeAspect(aspect);
  const naturalHalfWidth = Math.max(0, sizing.naturalWidth / 2);
  const naturalHalfHeight = Math.max(0, sizing.naturalHeight / 2);
  const horizontalRadius = Math.max(naturalHalfWidth + safeAspect * naturalHalfHeight, Math.max(0, sizing.minimumWidth / 2));
  const verticalRadius = Math.max(naturalHalfWidth / safeAspect + naturalHalfHeight, Math.max(0, sizing.minimumHeight / 2));
  return makeDiamondPolygonFromRadii(horizontalRadius, verticalRadius);
}

export function makeDiamondSplitPolygonForSizing(sizing: TwoPartShapeSizingInput, aspect: number): WorldPoint[] {
  const safeAspect = normalizeAspect(aspect);
  const upperWidth = Math.max(0, sizing.upperWidth);
  const upperHeight = Math.max(0, sizing.upperHeight);
  const lowerWidth = Math.max(0, sizing.lowerWidth + sizing.innerXSep);
  const lowerHeight = Math.max(0, sizing.lowerHeight + sizing.innerYSep);
  const contentWidth = Math.max(upperWidth, lowerWidth);
  const contentHeight = Math.max(upperHeight, lowerHeight);
  const horizontalRadius = Math.max(contentWidth + safeAspect * contentHeight, Math.max(0, sizing.minimumWidth / 2));
  const verticalRadius = Math.max(contentWidth / safeAspect + contentHeight, Math.max(0, sizing.minimumHeight / 2));
  return makeDiamondPolygonFromRadii(horizontalRadius, verticalRadius);
}

export function resolveCircleSplitRadius(sizing: TwoPartShapeSizingInput): number {
  const widthRadius = Math.max(sizing.upperWidth, sizing.lowerWidth) / 2 + sizing.innerXSep;
  const heightRadius = Math.max(sizing.upperHeight, sizing.lowerHeight) + sizing.lineWidth / 2 + 2 * sizing.innerYSep;
  return Math.max(Math.hypot(widthRadius, heightRadius), sizing.minimumWidth / 2, sizing.minimumHeight / 2);
}

export function resolveCircleSolidusRadius(sizing: TwoPartShapeSizingInput): number {
  const upperRadius = sizing.upperWidth + sizing.upperHeight;
  const lowerRadius = sizing.lowerWidth + sizing.lowerHeight;
  const contentRadius = Math.SQRT1_2 * Math.max(upperRadius, lowerRadius);
  const sepRadius = Math.hypot(2 * sizing.innerXSep, 2 * sizing.innerYSep);
  return Math.max(
    contentRadius + sizing.lineWidth / 2 + sepRadius,
    sizing.minimumWidth / 2,
    sizing.minimumHeight / 2
  );
}

export function resolveEllipseSplitRadii(sizing: TwoPartShapeSizingInput): { rx: number; ry: number } {
  const contentHalfWidth = Math.max(sizing.upperWidth, sizing.lowerWidth) / 2 + sizing.innerXSep;
  const contentHeight = Math.max(sizing.upperHeight, sizing.lowerHeight) + 2 * sizing.innerYSep + sizing.lineWidth / 2;
  return {
    rx: Math.max(Math.SQRT2 * contentHalfWidth, sizing.minimumWidth / 2),
    ry: Math.max(Math.SQRT2 * contentHeight, sizing.minimumHeight / 2)
  };
}

function makeDiamondPolygonFromRadii(horizontalRadius: number, verticalRadius: number): WorldPoint[] {
  return [
    worldPoint(0, verticalRadius),
    worldPoint(horizontalRadius, 0),
    worldPoint(0, -verticalRadius),
    worldPoint(-horizontalRadius, 0)
  ];
}

export function makeIsoscelesTrianglePolygon(
  sizing: CircularSizingInput,
  apexAngleRaw: number,
  rotation: number,
  stretches: boolean
): WorldPoint[] {
  const apexAngle = normalizeAcuteAngle(apexAngleRaw, DEFAULT_ISOSCELES_TRIANGLE_APEX_ANGLE);
  const halfAngleRadians = toRadians(apexAngle / 2);
  const tangentRaw = Math.tan(halfAngleRadians);
  const tangent = Number.isFinite(tangentRaw) && Math.abs(tangentRaw) > EPSILON ? Math.abs(tangentRaw) : 1;
  const cotangent = 1 / tangent;
  const sine = Math.sin(halfAngleRadians);
  const cosine = Math.cos(halfAngleRadians);
  const contentHalfWidth = Math.max(0, sizing.naturalWidth / 2);
  const contentHalfHeight = Math.max(0, sizing.naturalHeight / 2);

  // PGF's default is an east-pointing isosceles triangle. It first constructs
  // the smallest triangle that contains the text rectangle, then applies
  // minimum width to the vertical span and minimum height to the tip-to-base span.
  let tipToBase = 2 * contentHalfWidth + cotangent * contentHalfHeight;
  let baseHalfHeight = tangent * (2 * contentHalfWidth) + contentHalfHeight;
  const minimumBaseHalfHeight = Math.max(0, sizing.minimumWidth / 2);
  if (baseHalfHeight + EPSILON < minimumBaseHalfHeight) {
    baseHalfHeight = minimumBaseHalfHeight;
    if (stretches) {
      tipToBase = Math.max(tipToBase, EPSILON);
    } else {
      tipToBase = cotangent * baseHalfHeight;
    }
  }

  const minimumTipToBase = Math.max(0, sizing.minimumHeight);
  if (tipToBase + EPSILON < minimumTipToBase) {
    tipToBase = minimumTipToBase;
    if (stretches) {
      baseHalfHeight = Math.max(baseHalfHeight, EPSILON);
    } else {
      baseHalfHeight = tangent * tipToBase;
    }
  }

  const numerator = cosine * (baseHalfHeight - contentHalfHeight) - 2 * sine * contentHalfWidth;
  const offset = contentHalfWidth + numerator / Math.max(1 + sine, EPSILON);
  const polygon = [
    worldPoint(tipToBase - offset, 0),
    worldPoint(-offset, baseHalfHeight),
    worldPoint(-offset, -baseHalfHeight)
  ];
  return rotatePolygon(polygon, rotation);
}

export function makeKitePolygon(
  sizing: CircularSizingInput,
  upperAngleRaw: number,
  lowerAngleRaw: number,
  rotation: number
): WorldPoint[] {
  const upperAngle = normalizeAcuteAngle(upperAngleRaw, DEFAULT_KITE_UPPER_VERTEX_ANGLE);
  const lowerAngle = normalizeAcuteAngle(lowerAngleRaw, DEFAULT_KITE_LOWER_VERTEX_ANGLE);
  const upperHalfRadians = toRadians(upperAngle / 2);
  const lowerHalfRadians = toRadians(lowerAngle / 2);
  const upperTanRaw = Math.tan(upperHalfRadians);
  const lowerTanRaw = Math.tan(lowerHalfRadians);
  const upperTan = Number.isFinite(upperTanRaw) && Math.abs(upperTanRaw) > EPSILON ? Math.abs(upperTanRaw) : 1;
  const lowerTan = Number.isFinite(lowerTanRaw) && Math.abs(lowerTanRaw) > EPSILON ? Math.abs(lowerTanRaw) : 1;
  const sineSum = Math.sin(upperHalfRadians + lowerHalfRadians);
  const safeSineSum = Number.isFinite(sineSum) && Math.abs(sineSum) > EPSILON ? Math.abs(sineSum) : 1;
  const contentWidth = Math.max(0, sizing.naturalWidth);
  const contentHeight = Math.max(0, sizing.naturalHeight);
  const contentHalfWidth = contentWidth / 2;

  let upperContentHeight =
    contentHeight * Math.cos(upperHalfRadians) * Math.sin(lowerHalfRadians) / safeSineSum;
  let lowerContentHeight = contentHeight - upperContentHeight;
  if (!Number.isFinite(upperContentHeight) || !Number.isFinite(lowerContentHeight)) {
    upperContentHeight = contentHeight / 2;
    lowerContentHeight = contentHeight / 2;
  }
  const diagonalYOffset = contentHeight / 2 - upperContentHeight;
  let halfWidth = contentHalfWidth + upperTan * upperContentHeight;
  let topHeight = upperContentHeight + contentHalfWidth / upperTan;
  let bottomHeight = lowerContentHeight + contentHalfWidth / lowerTan;

  const totalHeight = topHeight + bottomHeight;
  if (totalHeight + EPSILON < sizing.minimumHeight) {
    const scale = sizing.minimumHeight / Math.max(totalHeight, EPSILON);
    halfWidth *= scale;
    topHeight *= scale;
    bottomHeight *= scale;
  }

  const totalWidth = halfWidth * 2;
  if (totalWidth + EPSILON < sizing.minimumWidth) {
    const scale = sizing.minimumWidth / Math.max(totalWidth, EPSILON);
    halfWidth *= scale;
    topHeight *= scale;
    bottomHeight *= scale;
  }

  const polygon = [
    worldPoint(0, diagonalYOffset + topHeight),
    worldPoint(-halfWidth, diagonalYOffset),
    worldPoint(0, diagonalYOffset - bottomHeight),
    worldPoint(halfWidth, diagonalYOffset)
  ];
  return rotatePolygon(polygon, rotation);
}

export function makeDartPolygon(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  tailAngleRaw: number,
  rotation: number
): WorldPoint[] {
  const tipAngle = normalizeAcuteAngle(tipAngleRaw, DEFAULT_DART_TIP_ANGLE);
  const tailAngle = normalizeTailAngle(tailAngleRaw);
  const halfTipRadians = toRadians(tipAngle / 2);
  const halfTailRadians = toRadians(tailAngle / 2);
  const tipTan = Math.tan(halfTipRadians);
  const cotTip = Number.isFinite(tipTan) && Math.abs(tipTan) > EPSILON ? 1 / Math.abs(tipTan) : 1;
  const contentHalfWidth = Math.max(0, sizing.naturalWidth / 2);
  const contentHalfHeight = Math.max(0, sizing.naturalHeight / 2);

  let dartLength = cotTip * contentHalfHeight + 2 * contentHalfWidth;
  const separationAngle = halfTailRadians - halfTipRadians;
  const separationSine = Math.sin(separationAngle);
  const safeSeparationSine = Number.isFinite(separationSine) && Math.abs(separationSine) > EPSILON ? Math.abs(separationSine) : 1;
  let halfTailSeparation = (dartLength / safeSeparationSine) * Math.sin(halfTipRadians) * Math.cos(halfTipRadians);
  const totalLength = cotTip * halfTailSeparation;
  let tailLength = Math.max(0, totalLength - dartLength);

  if (totalLength + EPSILON < sizing.minimumHeight) {
    const scale = sizing.minimumHeight / Math.max(totalLength, EPSILON);
    dartLength *= scale;
    halfTailSeparation *= scale;
    tailLength *= scale;
  }

  const tailSeparation = halfTailSeparation * 2;
  if (tailSeparation + EPSILON < sizing.minimumWidth) {
    const scale = sizing.minimumWidth / Math.max(tailSeparation, EPSILON);
    dartLength *= scale;
    halfTailSeparation *= scale;
    tailLength *= scale;
  }

  const deltaX = contentHalfWidth;
  const tipX = dartLength - deltaX;
  const tailCenterX = -deltaX;
  const tailX = tailCenterX - tailLength;

  const polygon = [
    worldPoint(tipX, 0),
    worldPoint(tailX, halfTailSeparation),
    worldPoint(tailCenterX, 0),
    worldPoint(tailX, -halfTailSeparation)
  ];
  return rotatePolygon(polygon, rotation);
}

export function makeTrapeziumPolygon(
  sizing: TrapeziumSizingInput,
  leftAngle: number,
  rightAngle: number,
  rotation: number,
  stretches: boolean,
  stretchesBody: boolean
): WorldPoint[] {
  const resolved = resolveTrapeziumDimensions(
    sizing.naturalHalfWidth,
    sizing.naturalHalfHeight,
    sizing.minimumWidth,
    sizing.minimumHeight,
    leftAngle,
    rightAngle,
    stretches,
    stretchesBody
  );

  const polygon = [
    worldPoint(-resolved.halfWidth - Math.max(resolved.leftExtension, 0), -resolved.halfHeight),
    worldPoint(-resolved.halfWidth + Math.min(resolved.leftExtension, 0), resolved.halfHeight),
    worldPoint(resolved.halfWidth - Math.min(resolved.rightExtension, 0), resolved.halfHeight),
    worldPoint(resolved.halfWidth + Math.max(resolved.rightExtension, 0), -resolved.halfHeight)
  ];

  if (Math.abs(rotation) <= 1e-6) {
    return polygon;
  }

  return polygon.map((point) => rotateWorldPoint(point, rotation));
}

export function makeRegularPolygon(
  sizing: CircularSizingInput,
  sidesRaw: number,
  rotation: number
): WorldPoint[] {
  const sides = normalizeInteger(Math.round(sidesRaw), 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
  const contentIncircleRadius = Math.SQRT2 * Math.max(Math.max(0, sizing.naturalWidth / 2), Math.max(0, sizing.naturalHeight / 2));
  const minRadius = Math.max(sizing.minimumWidth, sizing.minimumHeight) / 2;
  const cosine = Math.cos(Math.PI / sides);
  const circumRadius = cosine <= 1e-6 ? minRadius : Math.max(contentIncircleRadius / cosine, minRadius);
  const startAngle = regularPolygonStartAngle(sides, rotation);

  const vertices: WorldPoint[] = [];
  const step = 360 / sides;
  for (let index = 0; index < sides; index += 1) {
    vertices.push(pointPolar(startAngle + index * step, circumRadius));
  }
  return vertices;
}

export function makeStar(
  sizing: CircularSizingInput,
  pointsRaw: number,
  ratioRaw: number,
  pointHeightPt: number,
  useRatio: boolean,
  rotation: number
): { polygon: WorldPoint[]; outer: WorldPoint[]; inner: WorldPoint[] } {
  const points = normalizeInteger(Math.round(pointsRaw), 2, 360, DEFAULT_STAR_POINTS);
  const safeRatio = normalizeRatio(ratioRaw);
  const innerBase = Math.SQRT2 * Math.max(Math.max(0, sizing.naturalWidth / 2), Math.max(0, sizing.naturalHeight / 2));
  const safeHeight = Math.max(0, pointHeightPt);

  let innerRadius = innerBase;
  let outerRadius = useRatio ? innerRadius * safeRatio : innerRadius + safeHeight;

  const minRadius = Math.max(sizing.minimumWidth, sizing.minimumHeight) / 2;
  if (outerRadius < minRadius) {
    outerRadius = minRadius;
    innerRadius = useRatio ? outerRadius / safeRatio : Math.max(0, outerRadius - safeHeight);
  }

  const startAngle = 90 + rotation;
  const step = 180 / points;
  const polygon: WorldPoint[] = [];
  const outer: WorldPoint[] = [];
  const inner: WorldPoint[] = [];

  for (let index = 0; index < points; index += 1) {
    const outerAngle = startAngle + index * 2 * step;
    const innerAngle = outerAngle + step;
    const outerWorldPoint = pointPolar(outerAngle, outerRadius);
    const innerWorldPoint = pointPolar(innerAngle, innerRadius);
    outer.push(outerWorldPoint);
    inner.push(innerWorldPoint);
    polygon.push(outerWorldPoint, innerWorldPoint);
  }

  return { polygon, outer, inner };
}

export function makeSemicircle(
  sizing: CircularSizingInput,
  rotation: number,
  outerSep: number,
  sampleSteps = 48
): SemicircleGeometry {
  const safeNaturalWidth = Math.max(0, sizing.naturalWidth);
  const safeNaturalHeight = Math.max(0, sizing.naturalHeight);
  const safeMinimumWidth = Math.max(0, sizing.minimumWidth);
  const safeMinimumHeight = Math.max(0, sizing.minimumHeight);

  const halfWidth = safeNaturalWidth / 2;
  const halfHeight = safeNaturalHeight / 2;
  const defaultRadius = Math.hypot(halfWidth, 2 * halfHeight);
  const radiusBase = Math.max(defaultRadius, safeMinimumWidth / 2, safeMinimumHeight);
  const adjustment = 0.4 * (radiusBase - defaultRadius);
  const centerY = -(adjustment + halfHeight);

  const safeOuterSep = Math.max(0, outerSep);
  const anchorRadius = radiusBase + safeOuterSep;
  const chordY = centerY - safeOuterSep;

  const centerUnrotated = worldPoint(0, centerY);
  const apexUnrotated = worldPoint(0, centerY + anchorRadius);
  const arcStartUnrotated = worldPoint(anchorRadius, chordY);
  const arcEndUnrotated = worldPoint(-anchorRadius, chordY);
  const chordCenterUnrotated = worldPoint(0, chordY);

  const polygonUnrotated: WorldPoint[] = [];
  const steps = Math.max(8, sampleSteps);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const angle = t * Math.PI;
    polygonUnrotated.push(worldPoint(
      anchorRadius * Math.cos(angle),
      centerY + anchorRadius * Math.sin(angle)
    ));
  }
  polygonUnrotated.push(arcEndUnrotated, arcStartUnrotated);

  const center = rotateWorldPoint(centerUnrotated, rotation);
  const apex = rotateWorldPoint(apexUnrotated, rotation);
  const arcStart = rotateWorldPoint(arcStartUnrotated, rotation);
  const arcEnd = rotateWorldPoint(arcEndUnrotated, rotation);
  const chordCenter = rotateWorldPoint(chordCenterUnrotated, rotation);
  const polygon = polygonUnrotated.map((point) => rotateWorldPoint(point, rotation));

  return {
    center,
    radius: anchorRadius,
    rotation,
    apex,
    arcStart,
    arcEnd,
    chordCenter,
    polygon
  };
}

export function makeCircularSector(
  sizing: CircularSizingInput,
  sectorAngleRaw: number,
  rotation: number,
  outerSep: number,
  sampleSteps = 48
): CircularSectorGeometry {
  const sectorAngle = normalizeSectorAngle(sectorAngleRaw);
  const halfAngle = sectorAngle / 2;
  const halfAngleRadians = toRadians(halfAngle);
  const sineHalfAngle = Math.sin(halfAngleRadians);
  const cosineHalfAngle = Math.cos(Math.abs(halfAngleRadians));
  const safeSine = Math.max(Math.abs(sineHalfAngle), 1e-3);
  const contentHalfWidth = Math.max(0, sizing.naturalWidth / 2);
  const contentHalfHeight = Math.max(0, sizing.naturalHeight / 2);
  let centerOffset = (contentHalfHeight / safeSine) * cosineHalfAngle + contentHalfWidth;
  let radius = Math.hypot(centerOffset + contentHalfWidth, contentHalfHeight);

  const halfWidthAtCenter = Math.abs(centerOffset / Math.max(Math.cos(halfAngleRadians), 1e-3));
  if (halfWidthAtCenter + EPSILON < sizing.minimumWidth / 2) {
    const scale = (sizing.minimumWidth / 2) / Math.max(halfWidthAtCenter, EPSILON);
    centerOffset *= scale;
    radius *= scale;
  }
  if (radius + EPSILON < sizing.minimumHeight) {
    const scale = sizing.minimumHeight / Math.max(radius, EPSILON);
    centerOffset *= scale;
    radius = sizing.minimumHeight;
  }

  const safeOuterSep = Math.max(0, outerSep);
  const paintedRadius = radius + safeOuterSep;
  const sectorCenterUnrotated = worldPoint(centerOffset, 0);
  const arcCenterUnrotated = worldPoint(sectorCenterUnrotated.x - paintedRadius, 0);
  const startAngle = 180 - halfAngle;
  const endAngle = 180 + halfAngle;
  const arcStartUnrotated = pointPolarOffset(startAngle, paintedRadius, sectorCenterUnrotated);
  const arcEndUnrotated = pointPolarOffset(endAngle, paintedRadius, sectorCenterUnrotated);

  const polygonUnrotated: WorldPoint[] = [sectorCenterUnrotated];
  const steps = Math.max(8, sampleSteps);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    polygonUnrotated.push(pointPolarOffset(startAngle + sectorAngle * t, paintedRadius, sectorCenterUnrotated));
  }

  return {
    sectorCenter: rotateWorldPoint(sectorCenterUnrotated, rotation),
    arcStart: rotateWorldPoint(arcStartUnrotated, rotation),
    arcEnd: rotateWorldPoint(arcEndUnrotated, rotation),
    arcCenter: rotateWorldPoint(arcCenterUnrotated, rotation),
    radius: paintedRadius,
    rotation,
    polygon: polygonUnrotated.map((point) => rotateWorldPoint(point, rotation))
  };
}

export function makeCylinder(
  sizing: CircularSizingInput,
  aspectRaw: number,
  rotation: number,
  outerSep: number,
  sampleSteps = 24
): CylinderGeometry {
  const aspect = normalizeAspect(aspectRaw);
  const contentHalfWidth = Math.max(EPSILON, sizing.naturalWidth / 2);
  const contentHalfHeight = Math.max(EPSILON, sizing.naturalHeight / 2);
  const capRadiusX = Math.max(EPSILON, contentHalfHeight * aspect);
  const capRadiusY = Math.max(EPSILON, contentHalfHeight, sizing.minimumWidth / 2);
  const innerYSep = Math.max(0, sizing.innerYSep ?? 0);
  const capInsetRatio = clamp((capRadiusY - innerYSep) / Math.max(capRadiusY, EPSILON), -1, 1);
  const capInset = Math.cos(Math.asin(capInsetRatio)) * capRadiusX;
  let bodyHalfLength = contentHalfWidth;
  const totalLength = sizing.naturalWidth + 3 * capRadiusX + 0.2 - capInset;
  if (totalLength + EPSILON < sizing.minimumHeight) {
    bodyHalfLength += (sizing.minimumHeight - totalLength) / 2;
  }
  const safeOuterSep = Math.max(0, outerSep);
  const paintedCapRadiusX = capRadiusX + safeOuterSep;
  const paintedCapRadiusY = capRadiusY + safeOuterSep;

  const leftCenter = worldPoint(-bodyHalfLength + capInset, 0);
  const rightCenter = worldPoint(bodyHalfLength + capRadiusX + 0.2, 0);
  const beforeTopUnrotated = worldPoint(rightCenter.x, paintedCapRadiusY);
  const topUnrotated = worldPoint(rightCenter.x + paintedCapRadiusX, 0);
  const afterTopUnrotated = worldPoint(rightCenter.x, -paintedCapRadiusY);
  const beforeBottomUnrotated = worldPoint(leftCenter.x, -paintedCapRadiusY);
  const bottomUnrotated = worldPoint(leftCenter.x - paintedCapRadiusX, 0);
  const afterBottomUnrotated = worldPoint(leftCenter.x, paintedCapRadiusY);
  const shapeCenterUnrotated = worldPoint((capRadiusX + 0.2 + capInset) / 2, 0);

  const polygonUnrotated: WorldPoint[] = [];
  const rightArcSteps = Math.max(8, sampleSteps);
  const leftArcSteps = Math.max(8, sampleSteps);

  for (let index = 0; index <= leftArcSteps; index += 1) {
    const t = index / leftArcSteps;
    polygonUnrotated.push(pointEllipsePolarOffset(90 + 180 * t, paintedCapRadiusX, paintedCapRadiusY, leftCenter));
  }
  for (let index = 0; index <= rightArcSteps; index += 1) {
    const t = index / rightArcSteps;
    polygonUnrotated.push(pointEllipsePolarOffset(-90 + 180 * t, paintedCapRadiusX, paintedCapRadiusY, rightCenter));
  }
  const endCapArcUnrotated: WorldPoint[] = [];
  for (let index = 0; index <= rightArcSteps; index += 1) {
    const t = index / rightArcSteps;
    endCapArcUnrotated.push(pointEllipsePolarOffset(90 + 180 * t, paintedCapRadiusX, paintedCapRadiusY, rightCenter));
  }

  return {
    shapeCenter: rotateWorldPoint(shapeCenterUnrotated, rotation),
    beforeTop: rotateWorldPoint(beforeTopUnrotated, rotation),
    top: rotateWorldPoint(topUnrotated, rotation),
    afterTop: rotateWorldPoint(afterTopUnrotated, rotation),
    beforeBottom: rotateWorldPoint(beforeBottomUnrotated, rotation),
    bottom: rotateWorldPoint(bottomUnrotated, rotation),
    afterBottom: rotateWorldPoint(afterBottomUnrotated, rotation),
    endCapArc: endCapArcUnrotated.map((point) => rotateWorldPoint(point, rotation)),
    polygon: polygonUnrotated.map((point) => rotateWorldPoint(point, rotation))
  };
}

export function makeCloud(
  sizing: CircularSizingInput,
  puffsRaw: number,
  puffArcRaw: number,
  aspectRaw: number,
  ignoreAspect: boolean,
  rotation: number
): CloudGeometry {
  const puffs = normalizeInteger(Math.round(puffsRaw), 2, 360, DEFAULT_CLOUD_PUFFS);
  const puffArc = normalizeCloudPuffArc(puffArcRaw);
  let innerRx = Math.SQRT2 * Math.max(0, sizing.naturalWidth / 2);
  let innerRy = Math.SQRT2 * Math.max(0, sizing.naturalHeight / 2);
  const aspect = normalizeAspect(aspectRaw);
  if (!ignoreAspect) {
    let adjustedRx = aspect * innerRy;
    if (adjustedRx + EPSILON < innerRx) {
      adjustedRx = innerRx;
    }
    let adjustedRy = adjustedRx / aspect;
    if (adjustedRy + EPSILON < innerRy) {
      adjustedRy = innerRy;
      adjustedRx = aspect * innerRy;
    }
    innerRx = adjustedRx;
    innerRy = adjustedRy;
  }

  const step = 360 / puffs;
  const halfStep = toRadians(step / 2);
  const halfArc = toRadians(puffArc / 2);
  const k = Math.sin(halfStep) * ((1 - Math.cos(halfArc)) / Math.max(Math.sin(halfArc), EPSILON));
  const cosHalfStep = Math.cos(halfStep);
  let outerRx = cosHalfStep * innerRx + k * innerRy;
  let outerRy = cosHalfStep * innerRy + k * innerRx;
  outerRx = Math.max(outerRx, Math.max(0, sizing.minimumWidth / 2));
  outerRy = Math.max(outerRy, Math.max(0, sizing.minimumHeight / 2));

  const denominator = Math.max(EPSILON, cosHalfStep * cosHalfStep - k * k);
  innerRx = Math.max(EPSILON, (outerRx * cosHalfStep - k * outerRy) / denominator);
  innerRy = Math.max(EPSILON, (outerRy * cosHalfStep - k * outerRx) / denominator);

  const halfComplementArc = (180 - puffArc) / 2;
  const arcRadiusQuotient = 0.5 / Math.max(Math.cos(toRadians(halfComplementArc)), EPSILON);
  const sinHalfComplementArc = Math.sin(toRadians(halfComplementArc));
  const samplesPerPuff = Math.max(6, Math.min(24, Math.ceil(puffArc / 12)));
  const polygon: WorldPoint[] = [];
  const curves: CloudCurveSegment[] = [];
  const puffAnchors: WorldPoint[] = [];

  for (let index = 0; index < puffs; index += 1) {
    const startAngle = 90 - step / 2 + index * step;
    const endAngle = startAngle + step;
    const start = pointEllipsePolar(startAngle, innerRx, innerRy);
    const end = pointEllipsePolar(endAngle, innerRx, innerRy);
    const puff = makeCloudPuffParameters(
      start,
      end,
      arcRadiusQuotient,
      sinHalfComplementArc
    );
    const firstSample = index === 0 ? 0 : 1;
    for (let sample = firstSample; sample <= samplesPerPuff; sample += 1) {
      const angle = puff.arcSlope + halfComplementArc + (puffArc * sample) / samplesPerPuff;
      const point = pointPolarOffset(angle, puff.arcRadius, puff.circleCenter);
      polygon.push(rotateWorldPoint(point, rotation));
    }
    curves.push(
      ...makeCloudPuffCurves(start, end, puff, puffArc).map((curve) => ({
        c1: rotateWorldPoint(curve.c1, rotation),
        c2: rotateWorldPoint(curve.c2, rotation),
        to: rotateWorldPoint(curve.to, rotation)
      }))
    );
    puffAnchors.push(rotateWorldPoint(pointPolarOffset(puff.arcSlope + 90, puff.arcRadius, puff.circleCenter), rotation));
  }

  return { polygon, curves, puffs: puffAnchors, innerRx, innerRy, outerRx, outerRy };
}

export function makeStarburst(
  sizing: CircularSizingInput,
  pointsRaw: number,
  pointHeightPt: number,
  randomSeedRaw: number,
  rotation: number
): StarburstGeometry {
  const points = normalizeInteger(Math.round(pointsRaw), 2, 360, DEFAULT_STARBURST_POINTS);
  const pointHeight = Math.max(0, pointHeightPt);
  let innerRx = Math.SQRT2 * Math.max(0, sizing.naturalWidth / 2);
  let innerRy = Math.SQRT2 * Math.max(0, sizing.naturalHeight / 2);
  if (innerRx + pointHeight + EPSILON < sizing.minimumWidth / 2) {
    innerRx = Math.max(EPSILON, sizing.minimumWidth / 2 - pointHeight);
  }
  if (innerRy + pointHeight + EPSILON < sizing.minimumHeight / 2) {
    innerRy = Math.max(EPSILON, sizing.minimumHeight / 2 - pointHeight);
  }
  const step = 180 / points;
  const rng = makeSeededRng(randomSeedRaw);
  const polygon: WorldPoint[] = [];
  const outer: WorldPoint[] = [];
  const inner: WorldPoint[] = [];

  for (let index = 0; index < points; index += 1) {
    const outerAngle = 90 + rotation + index * 2 * step;
    const innerAngle = outerAngle + step;
    const outerScale = randomSeedRaw === 0 ? 1 : 0.25 + 0.75 * rng();
    const delta = pointHeight * outerScale;
    const outerWorldPoint = pointEllipsePolar(outerAngle, innerRx + delta, innerRy + delta);
    const innerWorldPoint = pointEllipsePolar(innerAngle, innerRx, innerRy);
    outer.push(outerWorldPoint);
    inner.push(innerWorldPoint);
    polygon.push(outerWorldPoint, innerWorldPoint);
  }

  return { polygon, outer, inner };
}

function makeCloudPuffParameters(
  arcStart: WorldPoint,
  arcEnd: WorldPoint,
  arcRadiusQuotient: number,
  sinHalfComplementArc: number
): {
  arcSlope: number;
  arcRadius: number;
  circleCenter: WorldPoint;
} {
  const arcSlope = Math.atan2(arcStart.y - arcEnd.y, arcStart.x - arcEnd.x) * 180 / Math.PI;
  const chordLength = Math.hypot(arcEnd.x - arcStart.x, arcEnd.y - arcStart.y);
  const halfChordLength = chordLength / 2;
  const arcRadius = Math.max(EPSILON, arcRadiusQuotient * chordLength);
  const segmentHeight = (1 - sinHalfComplementArc) * arcRadius;
  const localCenter = worldPoint(-halfChordLength, segmentHeight - arcRadius);
  const rotatedCenter = rotateWorldPoint(localCenter, arcSlope);
  return {
    arcSlope,
    arcRadius,
    circleCenter: worldPoint(arcStart.x + rotatedCenter.x, arcStart.y + rotatedCenter.y)
  };
}

function makeCloudPuffCurves(
  arcStart: WorldPoint,
  arcEnd: WorldPoint,
  puff: ReturnType<typeof makeCloudPuffParameters>,
  puffArc: number
): CloudCurveSegment[] {
  const quarterArc = puffArc / 4;
  const sinQuarterArc = Math.sin(toRadians(quarterArc));
  const cosQuarterArc = Math.cos(toRadians(quarterArc));
  const tanQuarterArc = sinQuarterArc / Math.max(cosQuarterArc, EPSILON);
  const controlScale = puff.arcRadius * tanQuarterArc;
  const halfChordLength = Math.hypot(arcEnd.x - arcStart.x, arcEnd.y - arcStart.y) / 2;
  const halfComplementArc = (180 - puffArc) / 2;
  const segmentHeight = (1 - Math.sin(toRadians(halfComplementArc))) * puff.arcRadius;
  const localMidpoint = worldPoint(-halfChordLength, segmentHeight);
  const rotatedMidpoint = rotateWorldPoint(localMidpoint, puff.arcSlope);
  const arcMidpoint = worldPoint(arcStart.x + rotatedMidpoint.x, arcStart.y + rotatedMidpoint.y);

  const controlPoint = (base: WorldPoint, rotation: number, ySign: 1 | -1): WorldPoint => {
    const local = worldPoint(
      0.55228475 * sinQuarterArc * controlScale,
      ySign * 0.55228475 * cosQuarterArc * controlScale
    );
    const rotated = rotateWorldPoint(local, rotation);
    return worldPoint(base.x + rotated.x, base.y + rotated.y);
  };

  const firstRotation = puff.arcSlope + 90 - quarterArc;
  const secondRotation = puff.arcSlope + 90 + quarterArc;
  return [
    {
      c1: controlPoint(arcStart, firstRotation, 1),
      c2: controlPoint(arcMidpoint, firstRotation, -1),
      to: arcMidpoint
    },
    {
      c1: controlPoint(arcMidpoint, secondRotation, 1),
      c2: controlPoint(arcEnd, secondRotation, -1),
      to: arcEnd
    }
  ];
}

export function makeSignal(
  sizing: CircularSizingInput,
  pointerAngleRaw: number,
  toSides: SignalDirection[],
  fromSides: SignalDirection[]
): SignalGeometry {
  const pointerAngle = normalizeSignalPointerAngle(pointerAngleRaw);
  const halfAngle = toRadians(pointerAngle / 2);
  const cotHalf = Math.abs(1 / Math.max(Math.tan(halfAngle), 1e-3));
  const to = new Set<SignalDirection>(toSides);
  const from = new Set<SignalDirection>(fromSides);
  const isActive = (side: SignalDirection): boolean => to.has(side) || from.has(side);

  let halfWidth = Math.max(EPSILON, sizing.naturalWidth / 2);
  let halfHeight = Math.max(EPSILON, sizing.naturalHeight / 2);
  let horizontalDepth = halfHeight * cotHalf;
  let verticalDepth = halfWidth * cotHalf;

  let totalHeight =
    2 * halfHeight +
    (isActive("north") ? verticalDepth : 0) +
    (isActive("south") ? verticalDepth : 0);
  if (totalHeight + EPSILON < sizing.minimumHeight) {
    totalHeight =
      sizing.minimumHeight -
      (isActive("north") ? verticalDepth : 0) -
      (isActive("south") ? verticalDepth : 0);
    halfHeight = Math.max(EPSILON, totalHeight / 2);
    horizontalDepth = halfHeight * cotHalf;
  }

  let totalWidth =
    2 * halfWidth +
    (isActive("east") ? horizontalDepth : 0) +
    (isActive("west") ? horizontalDepth : 0);
  if (totalWidth + EPSILON < sizing.minimumWidth) {
    totalWidth =
      sizing.minimumWidth -
      (isActive("east") ? horizontalDepth : 0) -
      (isActive("west") ? horizontalDepth : 0);
    halfWidth = Math.max(EPSILON, totalWidth / 2);
    verticalDepth = halfWidth * cotHalf;
  }

  const north = worldPoint(0, halfHeight + (to.has("north") ? verticalDepth : 0));
  const south = worldPoint(0, -halfHeight - (to.has("south") ? verticalDepth : 0));
  const east = worldPoint(halfWidth + (to.has("east") ? horizontalDepth : 0), 0);
  const west = worldPoint(-halfWidth - (to.has("west") ? horizontalDepth : 0), 0);
  const northEast = worldPoint(
    halfWidth + (from.has("east") ? horizontalDepth : 0),
    halfHeight + (from.has("north") ? verticalDepth : 0)
  );
  const southEast = worldPoint(
    halfWidth + (from.has("east") ? horizontalDepth : 0),
    -halfHeight - (from.has("south") ? verticalDepth : 0)
  );
  const southWest = worldPoint(
    -halfWidth - (from.has("west") ? horizontalDepth : 0),
    -halfHeight - (from.has("south") ? verticalDepth : 0)
  );
  const northWest = worldPoint(
    -halfWidth - (from.has("west") ? horizontalDepth : 0),
    halfHeight + (from.has("north") ? verticalDepth : 0)
  );

  return {
    polygon: [north, northEast, east, southEast, south, southWest, west, northWest]
  };
}

export function makeTape(
  sizing: CircularSizingInput,
  bendTop: TapeBendStyle,
  bendBottom: TapeBendStyle,
  bendHeightPt: number
): TapeGeometry {
  const halfWidth = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const halfBend = Math.max(0, bendHeightPt) / 2;
  const topMinimumContribution = bendTop === "none" ? 0 : halfBend;
  const bottomMinimumContribution = bendBottom === "none" ? 0 : halfBend;
  let halfHeight = Math.max(EPSILON, sizing.naturalHeight / 2);
  halfHeight += topMinimumContribution + bottomMinimumContribution;
  halfHeight = Math.max(halfHeight, sizing.minimumHeight / 2);
  halfHeight = Math.max(EPSILON, halfHeight - topMinimumContribution - bottomMinimumContribution);
  const bendAmplitude = Math.max(0, bendHeightPt);
  const samples = 18;
  const polygon: WorldPoint[] = [];

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = -halfWidth + 2 * halfWidth * t;
    const y = halfHeight + tapeEdgeOffset(t, bendTop, true, bendAmplitude);
    polygon.push(worldPoint(x, y));
  }

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const x = halfWidth - 2 * halfWidth * t;
    const y = -halfHeight + tapeEdgeOffset(t, bendBottom, false, bendAmplitude);
    polygon.push(worldPoint(x, y));
  }

  return { polygon };
}

export function resolveCalloutPointerOffset(
  shapeGeometry: Pick<
    ShapeGeometryParams,
    "calloutPointerIsAbsolute" | "calloutRelativePointerRaw" | "calloutAbsolutePointerRaw" | "calloutPointerShortenPt"
  >,
  context: SemanticContext | null,
  center: WorldPoint | null
): WorldPoint {
  let pointer =
    parseCalloutCoordinateVector(shapeGeometry.calloutRelativePointerRaw) ??
    parseCalloutCoordinateVector(DEFAULT_CALLOUT_RELATIVE_POINTER_RAW) ?? worldPoint(0, 0);

  if (shapeGeometry.calloutPointerIsAbsolute && shapeGeometry.calloutAbsolutePointerRaw && context && center) {
    const evaluated = evaluateRawCoordinate(ensureCoordinateRaw(shapeGeometry.calloutAbsolutePointerRaw), context);
    if (evaluated.world) {
      pointer = worldPoint(evaluated.world.x - center.x, evaluated.world.y - center.y);
    }
  }

  return pointer;
}

export function makeRectangleCallout(
  sizing: CircularSizingInput,
  pointerOffset: WorldPoint,
  pointerWidthPt: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number
): RectangleCalloutGeometry {
  const halfWidth = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const halfHeight = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);
  const relativeWorldPointer = Math.hypot(pointerOffset.x, pointerOffset.y) > EPSILON ? pointerOffset : worldPoint(halfWidth, 0);
  const relativeSide = rectanglePointerSide(relativeWorldPointer, halfWidth, halfHeight);
  const relativeBorder = rectangleBorderPoint(relativeWorldPointer, halfWidth, halfHeight, relativeSide);
  let pointer = pointerIsAbsolute
    ? relativeWorldPointer
    : resolveRelativeCalloutPointer(relativeWorldPointer, relativeBorder);
  pointer = shortenCalloutPointer(pointer, pointerShortenPt);
  if (Math.hypot(pointer.x, pointer.y) <= EPSILON) {
    pointer = worldPoint(halfWidth, 0);
  }
  const pointerWidth = Math.max(0, pointerWidthPt);

  const side = rectanglePointerSide(pointer, halfWidth, halfHeight);
  const border = rectangleBorderPoint(pointer, halfWidth, halfHeight, side);
  const halfBase = pointerWidth / 2;

  const topLeft = worldPoint(-halfWidth, halfHeight);
  const topRight = worldPoint(halfWidth, halfHeight);
  const bottomRight = worldPoint(halfWidth, -halfHeight);
  const bottomLeft = worldPoint(-halfWidth, -halfHeight);

  let polygon: WorldPoint[];
  if (side === "east") {
    const top = clamp(border.y + halfBase, -halfHeight, halfHeight);
    const bottom = clamp(border.y - halfBase, -halfHeight, halfHeight);
    const baseTop = worldPoint(halfWidth, top);
    const baseBottom = worldPoint(halfWidth, bottom);
    polygon = [topLeft, topRight, baseTop, pointer, baseBottom, bottomRight, bottomLeft];
  } else if (side === "west") {
    const top = clamp(border.y + halfBase, -halfHeight, halfHeight);
    const bottom = clamp(border.y - halfBase, -halfHeight, halfHeight);
    const baseTop = worldPoint(-halfWidth, top);
    const baseBottom = worldPoint(-halfWidth, bottom);
    polygon = [topLeft, topRight, bottomRight, bottomLeft, baseBottom, pointer, baseTop];
  } else if (side === "north") {
    const left = clamp(border.x - halfBase, -halfWidth, halfWidth);
    const right = clamp(border.x + halfBase, -halfWidth, halfWidth);
    const baseLeft = worldPoint(left, halfHeight);
    const baseRight = worldPoint(right, halfHeight);
    polygon = [topLeft, baseLeft, pointer, baseRight, topRight, bottomRight, bottomLeft];
  } else {
    const left = clamp(border.x - halfBase, -halfWidth, halfWidth);
    const right = clamp(border.x + halfBase, -halfWidth, halfWidth);
    const baseLeft = worldPoint(left, -halfHeight);
    const baseRight = worldPoint(right, -halfHeight);
    polygon = [topLeft, topRight, bottomRight, baseRight, pointer, baseLeft, bottomLeft];
  }

  return {
    polygon,
    pointer,
    pointerAnchor: pointer
  };
}

export function makeEllipseCallout(
  sizing: CircularSizingInput,
  pointerOffset: WorldPoint,
  pointerArcRaw: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number,
  sampleSteps = 64
): EllipseCalloutGeometry {
  const rx = Math.max(EPSILON, Math.max(sizing.naturalWidth, sizing.minimumWidth) / 2);
  const ry = Math.max(EPSILON, Math.max(sizing.naturalHeight, sizing.minimumHeight) / 2);
  const relativeWorldPointer = Math.hypot(pointerOffset.x, pointerOffset.y) > EPSILON ? pointerOffset : worldPoint(rx, 0);
  const relativeBorder = ellipseBorderPoint(relativeWorldPointer, rx, ry);
  let pointer = pointerIsAbsolute
    ? relativeWorldPointer
    : resolveRelativeCalloutPointer(relativeWorldPointer, relativeBorder);
  pointer = shortenCalloutPointer(pointer, pointerShortenPt);
  if (Math.hypot(pointer.x, pointer.y) <= EPSILON) {
    pointer = worldPoint(rx, 0);
  }

  const pointerBorder = ellipseBorderPoint(pointer, rx, ry);
  const pointerAngle = Math.atan2(pointerBorder.y / Math.max(ry, EPSILON), pointerBorder.x / Math.max(rx, EPSILON));
  const pointerArc = normalizeCalloutPointerArc(pointerArcRaw);
  const halfArc = toRadians(pointerArc / 2);
  const beforeAngle = pointerAngle + halfArc;
  const afterAngle = pointerAngle - halfArc;

  const arcWorldPoints = sampleEllipseArc(beforeAngle, afterAngle, rx, ry, sampleSteps);
  return {
    polygon: [pointer, ...arcWorldPoints],
    pointer,
    pointerAnchor: pointer
  };
}

export function makeCloudCallout(
  sizing: CircularSizingInput,
  puffsRaw: number,
  puffArcRaw: number,
  aspectRaw: number,
  ignoreAspect: boolean,
  rotation: number,
  pointerOffset: WorldPoint,
  startSizeRaw: string,
  endSizeRaw: string,
  segmentsRaw: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number
): CloudCalloutGeometry {
  const cloud = makeCloud(sizing, puffsRaw, puffArcRaw, aspectRaw, ignoreAspect, rotation);
  const relativeWorldPointer = Math.hypot(pointerOffset.x, pointerOffset.y) > EPSILON ? pointerOffset : worldPoint(0, 0);
  const relativeBorder = ellipseBorderPoint(relativeWorldPointer, cloud.outerRx, cloud.outerRy);
  let pointer = pointerIsAbsolute
    ? relativeWorldPointer
    : resolveRelativeCalloutPointer(relativeWorldPointer, relativeBorder);
  pointer = shortenCalloutPointer(pointer, pointerShortenPt);
  const border = ellipseBorderPoint(pointer, cloud.outerRx, cloud.outerRy);

  const calloutWidth = 2 * cloud.outerRx;
  const calloutHeight = 2 * cloud.innerRy;
  const startSize = resolveCloudCalloutPointerSize(startSizeRaw, calloutWidth, calloutHeight, 0.2);
  const endSize = resolveCloudCalloutPointerSize(endSizeRaw, calloutWidth, calloutHeight, 0.1);
  const segmentCount = normalizeInteger(Math.round(segmentsRaw), 1, 128, DEFAULT_CALLOUT_POINTER_SEGMENTS);
  const pointerPolygons = makeCloudCalloutPointerPolygons(border, pointer, startSize, endSize, segmentCount);
  const pointerPolygon = pointerPolygons.flat();

  return {
    polygon: cloud.polygon,
    curves: cloud.curves,
    pointerPolygon,
    pointerPolygons,
    pointer,
    pointerAnchor: pointer,
    puffs: cloud.puffs
  };
}

export function makeSingleArrow(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  rotation: number
): SingleArrowGeometry {
  const arrow = resolveSingleArrowCore(sizing, tipAngleRaw, headExtendPt, headIndentPt, DEFAULT_SINGLE_ARROW_TIP_ANGLE);
  const tipUnrotated = worldPoint(arrow.bodyHalfLength + arrow.tipExtension, 0);
  const beforeTipUnrotated = worldPoint(arrow.bodyHalfLength - arrow.headBackInset, arrow.headHalfHeight);
  const beforeHeadUnrotated = worldPoint(arrow.bodyHalfLength - arrow.headBackInset + arrow.headIndent, arrow.shaftHalfHeight);
  const afterTailUnrotated = worldPoint(-arrow.bodyHalfLength, arrow.shaftHalfHeight);
  const beforeTailUnrotated = worldPoint(afterTailUnrotated.x, pt(-1 * afterTailUnrotated.y));
  const afterHeadUnrotated = worldPoint(beforeHeadUnrotated.x, pt(-1 * beforeHeadUnrotated.y));
  const afterTipUnrotated = worldPoint(beforeTipUnrotated.x, pt(-1 * beforeTipUnrotated.y));
  const tailUnrotated = worldPoint(afterTailUnrotated.x, 0);

  const polygon = rotatePolygon(
    [
      tipUnrotated,
      beforeTipUnrotated,
      beforeHeadUnrotated,
      afterTailUnrotated,
      beforeTailUnrotated,
      afterHeadUnrotated,
      afterTipUnrotated
    ],
    rotation
  );

  return {
    polygon,
    tip: rotateWorldPoint(tipUnrotated, rotation),
    beforeTip: rotateWorldPoint(beforeTipUnrotated, rotation),
    afterTip: rotateWorldPoint(afterTipUnrotated, rotation),
    beforeHead: rotateWorldPoint(beforeHeadUnrotated, rotation),
    afterHead: rotateWorldPoint(afterHeadUnrotated, rotation),
    beforeTail: rotateWorldPoint(beforeTailUnrotated, rotation),
    afterTail: rotateWorldPoint(afterTailUnrotated, rotation),
    tail: rotateWorldPoint(tailUnrotated, rotation)
  };
}

export function makeDoubleArrow(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  rotation: number
): DoubleArrowGeometry {
  const arrow = resolveDoubleArrowCore(sizing, tipAngleRaw, headExtendPt, headIndentPt, DEFAULT_DOUBLE_ARROW_TIP_ANGLE);
  const tip1Unrotated = worldPoint(arrow.bodyHalfLength + arrow.tipExtension, 0);
  const beforeTip1Unrotated = worldPoint(arrow.bodyHalfLength - arrow.headBackInset, arrow.headHalfHeight);
  const beforeHead1Unrotated = worldPoint(arrow.bodyHalfLength - arrow.headBackInset + arrow.headIndent, arrow.shaftHalfHeight);
  const afterTip1Unrotated = worldPoint(beforeTip1Unrotated.x, pt(-1 * beforeTip1Unrotated.y));
  const afterHead1Unrotated = worldPoint(beforeHead1Unrotated.x, pt(-1 * beforeHead1Unrotated.y));

  const tip2Unrotated = worldPoint(pt(-1 * tip1Unrotated.x), 0);
  const beforeTip2Unrotated = worldPoint(pt(-1 * beforeTip1Unrotated.x), pt(-1 * beforeTip1Unrotated.y));
  const beforeHead2Unrotated = worldPoint(pt(-1 * beforeHead1Unrotated.x), pt(-1 * beforeHead1Unrotated.y));
  const afterTip2Unrotated = worldPoint(pt(-1 * beforeTip1Unrotated.x), beforeTip1Unrotated.y);
  const afterHead2Unrotated = worldPoint(pt(-1 * beforeHead1Unrotated.x), beforeHead1Unrotated.y);

  const polygon = rotatePolygon(
    [
      tip1Unrotated,
      beforeTip1Unrotated,
      beforeHead1Unrotated,
      afterHead2Unrotated,
      afterTip2Unrotated,
      tip2Unrotated,
      beforeTip2Unrotated,
      beforeHead2Unrotated,
      afterHead1Unrotated,
      afterTip1Unrotated
    ],
    rotation
  );

  return {
    polygon,
    tip1: rotateWorldPoint(tip1Unrotated, rotation),
    beforeTip1: rotateWorldPoint(beforeTip1Unrotated, rotation),
    afterTip1: rotateWorldPoint(afterTip1Unrotated, rotation),
    beforeHead1: rotateWorldPoint(beforeHead1Unrotated, rotation),
    afterHead1: rotateWorldPoint(afterHead1Unrotated, rotation),
    tip2: rotateWorldPoint(tip2Unrotated, rotation),
    beforeTip2: rotateWorldPoint(beforeTip2Unrotated, rotation),
    afterTip2: rotateWorldPoint(afterTip2Unrotated, rotation),
    beforeHead2: rotateWorldPoint(beforeHead2Unrotated, rotation),
    afterHead2: rotateWorldPoint(afterHead2Unrotated, rotation)
  };
}

export function regularPolygonStartAngle(sidesRaw: number, rotation: number): number {
  const sides = normalizeInteger(Math.round(sidesRaw), 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
  if (sides % 2 === 1) {
    return 90 + rotation;
  }
  return 90 - 180 / sides + rotation;
}

export function intersectRayWithPolygon(reference: WorldPoint, direction: WorldVector, polygon: WorldPoint[]): WorldPoint | null {
  if (polygon.length < 2) {
    return null;
  }

  const directionLength = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(directionLength) || directionLength <= EPSILON) {
    return null;
  }

  const maxRadius = polygon.reduce((max, point) => Math.max(max, Math.hypot(point.x, point.y)), 0);
  const referenceRadius = Math.hypot(reference.x, reference.y);
  const rayLength = Math.max(1, maxRadius + referenceRadius + 1) * 4;
  const rayTarget = worldPoint(
    reference.x + (direction.x / directionLength) * rayLength,
    reference.y + (direction.y / directionLength) * rayLength
  );

  let best: { point: WorldPoint; t: number } | null = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const hit = intersectSegments(reference, rayTarget, edgeStart, edgeEnd);
    if (!hit) {
      continue;
    }
    if (hit.t < -1e-6) {
      continue;
    }
    if (!best || hit.t < best.t) {
      best = hit;
    }
  }

  return best?.point ?? null;
}

export function midpoint(from: WorldPoint, to: WorldPoint): WorldPoint {
  return worldPoint((from.x + to.x) / 2, (from.y + to.y) / 2);
}

function parseNumericOption(raw: string): number | null {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const direct = Number(normalized);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*deg(?:ree)?s?)?$/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerOption(raw: string): number | null {
  const numeric = parseNumericOption(raw);
  if (numeric == null) {
    return null;
  }
  return Math.round(numeric);
}

function parseBoolishOption(raw: string): boolean | null {
  return parseBooleanishNormalized(normalizeOptionValue(raw), { allowOnOff: true });
}

function parseKiteVertexAngles(raw: string): { upper: number; lower: number } | null {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const andMatch = normalized.match(/^(.+)\band\b(.+)$/i);
  if (andMatch) {
    const upper = parseNumericOption(andMatch[1] ?? "");
    const lower = parseNumericOption(andMatch[2] ?? "");
    if (upper == null || lower == null) {
      return null;
    }
    return { upper, lower };
  }

  const single = parseNumericOption(normalized);
  if (single == null) {
    return null;
  }
  return { upper: single, lower: single };
}

function parseRandomStarburstOption(raw: string, randomSeedProvider: () => number): number | null {
  const normalized = normalizeOptionValue(raw).trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  const boolish = parseBooleanishNormalized(normalized, { allowOnOff: true });
  if (boolish === true) {
    return randomSeedProvider();
  }
  if (boolish === false) {
    return 0;
  }
  const numeric = parseNumericOption(normalized);
  if (numeric == null) {
    return null;
  }
  return Math.abs(Math.round(numeric));
}

function defaultRandomSeedProvider(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}

function parseSignalDirectionSpec(raw: string): SignalDirection[] {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  const tokens = normalized.split(/[^a-z]+/u).filter((token) => token.length > 0);
  const set = new Set<SignalDirection>();
  for (const token of tokens) {
    if (token === "north" || token === "south") {
      set.delete("east");
      set.delete("west");
      set.add(token);
    } else if (token === "east" || token === "west") {
      set.delete("north");
      set.delete("south");
      set.add(token);
    }
  }
  const orderedDirections: SignalDirection[] = ["north", "south", "east", "west"];
  return orderedDirections.filter((direction) => set.has(direction));
}

function parseTapeBendStyle(raw: string, fallback: TapeBendStyle): TapeBendStyle {
  const normalized = normalizeOptionValue(raw).toLowerCase().replace(/\s+/gu, " ").trim();
  if (normalized === "in and out") {
    return "in and out";
  }
  if (normalized === "out and in") {
    return "out and in";
  }
  if (parseBooleanishNormalized(normalized, { allowOnOff: true, allowNoneAsFalse: true }) === false) {
    return "none";
  }
  return fallback;
}

function parseRoundedRectangleArcType(raw: string): RoundedRectangleArcType {
  const normalized = normalizeOptionValue(raw).toLowerCase().trim();
  if (normalized === "concave") {
    return "concave";
  }
  if (normalized === "none" || normalized === "false" || normalized === "off") {
    return "none";
  }
  return "convex";
}

function parseChamferedCorners(raw: string): Set<"north west" | "north east" | "south east" | "south west"> {
  const normalized = normalizeOptionValue(raw).toLowerCase().replace(/[{}]/gu, " ");
  const tokens = normalized.split(/[,]/u).map((token) => token.trim()).filter((token) => token.length > 0);
  const corners = new Set<"north west" | "north east" | "south east" | "south west">();
  if (tokens.length === 0 || tokens.includes("chamfer all")) {
    corners.add("north west");
    corners.add("north east");
    corners.add("south east");
    corners.add("south west");
    return corners;
  }
  for (const token of tokens) {
    if (token === "north west" || token === "north east" || token === "south east" || token === "south west") {
      corners.add(token);
    }
  }
  return corners;
}

function parseCalloutCoordinateVector(raw: string): WorldPoint | null {
  const coordinate = parseCoordinate(ensureCoordinateRaw(raw));
  if (coordinate.form === "cartesian") {
    const x = parseLength(coordinate.x, "cm");
    const y = parseLength(coordinate.y, "cm");
    if (x == null || y == null) {
      return null;
    }
    return worldPoint(pt(x), pt(y));
  }
  if (coordinate.form === "polar") {
    const angle = parseNumericOption(coordinate.x);
    const radius = parseLength(coordinate.y, "cm");
    if (angle == null || radius == null) {
      return null;
    }
    const radians = toRadians(angle);
    return worldPoint(radius * Math.cos(radians), radius * Math.sin(radians));
  }
  return null;
}

function ensureCoordinateRaw(raw: string): string {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    return normalized;
  }
  return `(${normalized})`;
}

function normalizeAspect(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DIAMOND_ASPECT;
  }
  const magnitude = Math.abs(value);
  if (magnitude <= 1e-4) {
    return DEFAULT_DIAMOND_ASPECT;
  }
  return Math.min(10_000, magnitude);
}

function normalizeAcuteAngle(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = ((value % 360) + 360) % 360;
  if (normalized <= 1e-3 || normalized >= 179.999) {
    return fallback;
  }
  return normalized;
}

function normalizeTailAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DART_TAIL_ANGLE;
  }
  const normalized = ((value % 360) + 360) % 360;
  if (normalized <= 1e-3 || normalized >= 359.999) {
    return DEFAULT_DART_TAIL_ANGLE;
  }
  return normalized;
}

function normalizeSectorAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CIRCULAR_SECTOR_ANGLE;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_CIRCULAR_SECTOR_ANGLE;
  }
  return Math.min(179.5, normalized);
}

function normalizeCloudPuffArc(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CLOUD_PUFF_ARC;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_CLOUD_PUFF_ARC;
  }
  return Math.max(10, Math.min(360, normalized));
}

function normalizeSignalPointerAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SIGNAL_POINTER_ANGLE;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_SIGNAL_POINTER_ANGLE;
  }
  return Math.max(1, Math.min(179, normalized));
}

function normalizeCalloutPointerArc(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CALLOUT_POINTER_ARC;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return DEFAULT_CALLOUT_POINTER_ARC;
  }
  return Math.max(1, Math.min(180, normalized));
}

function normalizeArrowTipAngle(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.abs(value);
  if (normalized <= 1e-3) {
    return fallback;
  }
  return Math.max(1, Math.min(179, normalized));
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAR_RATIO;
  }
  const magnitude = Math.abs(value);
  if (magnitude <= 1e-4) {
    return DEFAULT_STAR_RATIO;
  }
  return Math.min(10_000, magnitude);
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TRAPEZIUM_ANGLE;
  }
  const normalized = ((value % 360) + 360) % 360;
  return normalized;
}

function normalizeInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min || value > max) {
    return fallback;
  }
  return value;
}

function resolveSingleArrowCore(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  fallbackTipAngle: number
): {
  bodyHalfLength: number;
  shaftHalfHeight: number;
  headHalfHeight: number;
  tipExtension: number;
  headBackInset: number;
  headIndent: number;
} {
  const dimensions = resolveArrowDimensions(sizing, tipAngleRaw, headExtendPt, headIndentPt, fallbackTipAngle);
  const minimumTotalLength = Math.max(0, sizing.minimumHeight);
  const contentLengthWithTip = sizing.naturalWidth + dimensions.tipExtension;
  const totalLength = Math.max(contentLengthWithTip, minimumTotalLength);
  const bodyHalfLength = Math.max(EPSILON, (totalLength - dimensions.tipExtension) / 2);

  return {
    ...dimensions,
    bodyHalfLength
  };
}

function resolveDoubleArrowCore(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  fallbackTipAngle: number
): {
  bodyHalfLength: number;
  shaftHalfHeight: number;
  headHalfHeight: number;
  tipExtension: number;
  headBackInset: number;
  headIndent: number;
} {
  const dimensions = resolveArrowDimensions(sizing, tipAngleRaw, headExtendPt, headIndentPt, fallbackTipAngle);
  const minimumTotalLength = Math.max(0, sizing.minimumHeight);
  const contentLengthWithTips = 2 * (sizing.naturalWidth / 2 + dimensions.tipExtension);
  const totalLength = Math.max(contentLengthWithTips, minimumTotalLength);
  const bodyHalfLength = Math.max(EPSILON, totalLength / 2 - dimensions.tipExtension);

  return {
    ...dimensions,
    bodyHalfLength
  };
}

function resolveArrowDimensions(
  sizing: CircularSizingInput,
  tipAngleRaw: number,
  headExtendPt: number,
  headIndentPt: number,
  fallbackTipAngle: number
): {
  shaftHalfHeight: number;
  headHalfHeight: number;
  tipExtension: number;
  headBackInset: number;
  headIndent: number;
} {
  const tipAngle = normalizeArrowTipAngle(tipAngleRaw, fallbackTipAngle);
  const halfAngle = toRadians(tipAngle / 2);
  const tangentRaw = Math.tan(halfAngle);
  const tangent = Number.isFinite(tangentRaw) && Math.abs(tangentRaw) > EPSILON ? Math.abs(tangentRaw) : 1;
  const cotangent = 1 / tangent;

  let shaftHalfHeight = Math.max(EPSILON, sizing.naturalHeight / 2);
  let headExtend = Math.max(0, headExtendPt);
  let headHalfHeight = shaftHalfHeight + headExtend;
  let tipExtension = shaftHalfHeight * cotangent;
  const minimumHeadHalfHeight = Math.max(0, sizing.minimumWidth / 2);
  if (headHalfHeight + EPSILON < minimumHeadHalfHeight) {
    const scale = minimumHeadHalfHeight / Math.max(headHalfHeight, EPSILON);
    shaftHalfHeight *= scale;
    headExtend *= scale;
    headHalfHeight *= scale;
    tipExtension *= scale;
  }
  const headBackInset = headExtend * cotangent;
  const headIndent = Math.min(Math.max(0, headIndentPt), Math.max(0, tipExtension + headBackInset - EPSILON));

  return {
    shaftHalfHeight,
    headHalfHeight,
    tipExtension,
    headBackInset,
    headIndent
  };
}

function rectanglePointerSide(pointer: WorldPoint, halfWidth: number, halfHeight: number): "east" | "west" | "north" | "south" {
  const rx = halfWidth > EPSILON ? Math.abs(pointer.x) / halfWidth : Number.POSITIVE_INFINITY;
  const ry = halfHeight > EPSILON ? Math.abs(pointer.y) / halfHeight : Number.POSITIVE_INFINITY;
  if (rx >= ry) {
    return pointer.x >= 0 ? "east" : "west";
  }
  return pointer.y >= 0 ? "north" : "south";
}

function rectangleBorderPoint(
  pointer: WorldPoint,
  halfWidth: number,
  halfHeight: number,
  side: "east" | "west" | "north" | "south"
): WorldPoint {
  if (side === "east" || side === "west") {
    const x = side === "east" ? halfWidth : -halfWidth;
    const yScale = Math.abs(pointer.x) > EPSILON ? x / pointer.x : 0;
    return worldPoint(x, clamp(pointer.y * yScale, -halfHeight, halfHeight));
  }

  const y = side === "north" ? halfHeight : -halfHeight;
  const xScale = Math.abs(pointer.y) > EPSILON ? y / pointer.y : 0;
  return worldPoint(clamp(pointer.x * xScale, -halfWidth, halfWidth), y);
}

function ellipseBorderPoint(pointer: WorldPoint, rx: number, ry: number): WorldPoint {
  const px = pointer.x;
  const py = pointer.y;
  const norm = Math.hypot(px / Math.max(rx, EPSILON), py / Math.max(ry, EPSILON));
  if (!Number.isFinite(norm) || norm <= EPSILON) {
    return worldPoint(pt(rx), pt(0));
  }
  const scale = 1 / norm;
  return worldPoint(pt(px * scale), pt(py * scale));
}

function resolveRelativeCalloutPointer(relativeWorldPointer: WorldPoint, borderWorldPoint: WorldPoint): WorldPoint {
  const length = Math.hypot(relativeWorldPointer.x, relativeWorldPointer.y);
  if (length <= EPSILON) {
    return borderWorldPoint;
  }
  const angle = Math.atan2(borderWorldPoint.y, borderWorldPoint.x);
  return worldPoint(
    pt(borderWorldPoint.x + Math.cos(angle) * length),
    pt(borderWorldPoint.y + Math.sin(angle) * length)
  );
}

function shortenCalloutPointer(pointer: WorldPoint, shortenPt: number): WorldPoint {
  const distance = Math.hypot(pointer.x, pointer.y);
  if (distance <= EPSILON || shortenPt <= 0) {
    return pointer;
  }
  const remaining = Math.max(0, distance - shortenPt);
  const scale = remaining / distance;
  return worldPoint(pt(pointer.x * scale), pt(pointer.y * scale));
}

function sampleEllipseArc(startRadians: number, endRadians: number, rx: number, ry: number, steps: number): WorldPoint[] {
  const tau = 2 * Math.PI;
  const normalizedStart = ((startRadians % tau) + tau) % tau;
  const normalizedEnd = ((endRadians % tau) + tau) % tau;
  let sweep = normalizedEnd - normalizedStart;
  if (sweep < 0) {
    sweep += tau;
  }

  const count = Math.max(8, steps);
  const points: WorldPoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const t = index / count;
    const angle = normalizedStart + sweep * t;
    points.push(worldPoint(pt(rx * Math.cos(angle)), pt(ry * Math.sin(angle))));
  }
  return points;
}

function resolveCloudCalloutPointerSize(
  raw: string,
  calloutWidth: number,
  calloutHeight: number,
  fallbackFraction: number
): { xDiameter: number; yDiameter: number } {
  const normalized = normalizeOptionValue(raw).toLowerCase().trim();
  const fallback = {
    xDiameter: Math.max(EPSILON, calloutWidth * fallbackFraction),
    yDiameter: Math.max(EPSILON, calloutHeight * fallbackFraction)
  };

  const ofIndex = normalized.indexOf("of callout");
  if (ofIndex >= 0) {
    const ratioRaw = normalized.slice(0, ofIndex).trim();
    const ratio = parseNumericOption(ratioRaw);
    if (ratio != null && Number.isFinite(ratio) && ratio > 0) {
      return {
        xDiameter: Math.max(EPSILON, calloutWidth * ratio),
        yDiameter: Math.max(EPSILON, calloutHeight * ratio)
      };
    }
  }

  const andMatch = normalized.match(/^(.+)\band\b(.+)$/i);
  if (andMatch) {
    const xDiameter = parseLength(andMatch[1]?.trim() ?? "", "pt");
    const yDiameter = parseLength(andMatch[2]?.trim() ?? "", "pt");
    if (xDiameter != null && yDiameter != null && xDiameter > 0 && yDiameter > 0) {
      return { xDiameter, yDiameter };
    }
  }

  const diameter = parseLength(normalized, "pt");
  if (diameter != null && diameter > 0) {
    return {
      xDiameter: diameter,
      yDiameter: diameter
    };
  }

  return fallback;
}

function makeCloudCalloutPointerPolygons(
  borderWorldPoint: WorldPoint,
  pointer: WorldPoint,
  startSize: { xDiameter: number; yDiameter: number },
  endSize: { xDiameter: number; yDiameter: number },
  segments: number
): WorldPoint[][] {
  const direction = worldVector(
    borderWorldPoint.x - pointer.x,
    borderWorldPoint.y - pointer.y
  );
  const length = Math.hypot(direction.x, direction.y);
  if (length <= EPSILON) {
    return [[pointer]];
  }

  const segmentCount = Math.max(1, segments);
  const ellipses: WorldPoint[][] = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const t = index / segmentCount;
    const center = worldPoint(
      pt(pointer.x + direction.x * t),
      pt(pointer.y + direction.y * t)
    );
    const diameterX = lerp(endSize.xDiameter, startSize.xDiameter, t);
    const diameterY = lerp(endSize.yDiameter, startSize.yDiameter, t);
    ellipses.push(makeEllipsePolygon(center, diameterX / 2, diameterY / 2, 24));
  }

  return ellipses;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function makeEllipsePolygon(center: WorldPoint, rx: number, ry: number, samples: number): WorldPoint[] {
  const count = Math.max(8, samples);
  const points: WorldPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (360 * index) / count;
    points.push(pointEllipsePolarOffset(angle, Math.max(EPSILON, rx), Math.max(EPSILON, ry), center));
  }
  return points;
}

function pointPolar(degrees: number, radius: number): WorldPoint {
  const radians = toRadians(degrees);
  return worldPoint(pt(radius * Math.cos(radians)), pt(radius * Math.sin(radians)));
}

function pointPolarOffset(degrees: number, radius: number, center: WorldPoint): WorldPoint {
  const point = pointPolar(degrees, radius);
  return worldPoint(pt(center.x + point.x), pt(center.y + point.y));
}

function pointEllipsePolar(degrees: number, rx: number, ry: number): WorldPoint {
  const radians = toRadians(degrees);
  return worldPoint(pt(rx * Math.cos(radians)), pt(ry * Math.sin(radians)));
}

function pointEllipsePolarOffset(degrees: number, rx: number, ry: number, center: WorldPoint): WorldPoint {
  const radians = toRadians(degrees);
  return worldPoint(pt(center.x + rx * Math.cos(radians)), pt(center.y + ry * Math.sin(radians)));
}

function makeSeededRng(seedRaw: number): () => number {
  const modulus = 2_147_483_647;
  const multiplier = 69_621;
  const quotient = 30_845;
  const remainderFactor = 23_902;
  let state = Math.trunc(seedRaw);
  if (state === 0) {
    state = 1;
  }
  state = Math.abs(state) % modulus;
  return () => {
    const hi = Math.trunc(state / quotient);
    const lo = state - hi * quotient;
    state = multiplier * lo - remainderFactor * hi;
    if (state < 0) {
      state += modulus;
    }
    return (state % 100_001) / 100_000;
  };
}

function tapeEdgeOffset(t: number, bend: TapeBendStyle, isTopEdge: boolean, halfBend: number): number {
  if (bend === "none" || halfBend <= EPSILON) {
    return 0;
  }
  let wave = (1 + Math.cos(t * Math.PI * 2)) / 2;
  if (bend === "out and in") {
    wave *= -1;
  }
  return wave * halfBend * (isTopEdge ? 1 : -1);
}

function cotDegrees(degrees: number): number {
  const radians = (degrees * Math.PI) / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  if (!Number.isFinite(sine) || Math.abs(sine) <= 1e-6) {
    return cosine >= 0 ? 1e6 : -1e6;
  }
  return cosine / sine;
}

function resolveTrapeziumDimensions(
  naturalHalfWidth: number,
  naturalHalfHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  leftAngle: number,
  rightAngle: number,
  stretches: boolean,
  stretchesBody: boolean
): {
  halfWidth: number;
  halfHeight: number;
  leftExtension: number;
  rightExtension: number;
} {
  let halfWidth = Math.max(0, naturalHalfWidth);
  let halfHeight = Math.max(0, naturalHalfHeight);
  const targetHalfHeight = Math.max(0, minimumHeight / 2);
  const targetWidth = Math.max(0, minimumWidth);
  let leftExtension = 2 * halfHeight * cotDegrees(leftAngle);
  let rightExtension = 2 * halfHeight * cotDegrees(rightAngle);

  if (halfHeight + EPSILON < targetHalfHeight) {
    if (stretches || stretchesBody) {
      halfHeight = targetHalfHeight;
      leftExtension = 2 * halfHeight * cotDegrees(leftAngle);
      rightExtension = 2 * halfHeight * cotDegrees(rightAngle);
    } else {
      const scale = targetHalfHeight / Math.max(halfHeight, EPSILON);
      halfWidth *= scale;
      halfHeight = targetHalfHeight;
      leftExtension *= scale;
      rightExtension *= scale;
    }
  }

  let totalWidth = 2 * halfWidth + Math.abs(leftExtension) + Math.abs(rightExtension);
  if (totalWidth + EPSILON < targetWidth) {
    if (stretchesBody) {
      const remainder = targetWidth - totalWidth;
      halfWidth += remainder / 2;
    } else {
      const scale = targetWidth / Math.max(totalWidth, EPSILON);
      halfWidth *= scale;
      leftExtension *= scale;
      rightExtension *= scale;
      if (!stretches) {
        halfHeight *= scale;
      }
    }
    totalWidth = 2 * halfWidth + Math.abs(leftExtension) + Math.abs(rightExtension);
  }

  if (!Number.isFinite(totalWidth)) {
    return {
      halfWidth: Math.max(0, naturalHalfWidth),
      halfHeight: Math.max(0, naturalHalfHeight),
      leftExtension: 0,
      rightExtension: 0
    };
  }

  return {
    halfWidth: Math.max(0, halfWidth),
    halfHeight: Math.max(0, halfHeight),
    leftExtension: clampFinite(leftExtension),
    rightExtension: clampFinite(rightExtension)
  };
}

function rotateWorldPoint(point: WorldPoint, degrees: number): WorldPoint {
  const radians = toRadians(degrees);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return worldPoint(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine
  );
}

function rotatePolygon(points: WorldPoint[], rotation: number): WorldPoint[] {
  if (Math.abs(rotation) <= 1e-6) {
    return points;
  }
  return points.map((point) => rotateWorldPoint(point, rotation));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function intersectSegments(
  firstFrom: WorldPoint,
  firstTo: WorldPoint,
  secondFrom: WorldPoint,
  secondTo: WorldPoint
): { point: WorldPoint; t: number } | null {
  const firstDirection = worldVector(firstTo.x - firstFrom.x, firstTo.y - firstFrom.y);
  const secondDirection = worldVector(secondTo.x - secondFrom.x, secondTo.y - secondFrom.y);
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const offset = worldVector(secondFrom.x - firstFrom.x, secondFrom.y - firstFrom.y);
  const firstT = cross(offset, secondDirection) / denominator;
  const secondT = cross(offset, firstDirection) / denominator;
  if (firstT < -1e-6 || firstT > 1 + 1e-6 || secondT < -1e-6 || secondT > 1 + 1e-6) {
    return null;
  }

  const clampedFirstT = Math.max(0, Math.min(1, firstT));
  return {
    point: worldPoint(
      firstFrom.x + clampedFirstT * firstDirection.x,
      firstFrom.y + clampedFirstT * firstDirection.y
    ),
    t: clampedFirstT
  };
}

function clampFinite(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1e6, Math.min(1e6, value));
}

function cross(left: Pick<WorldPoint | WorldVector, "x" | "y">, right: Pick<WorldPoint | WorldVector, "x" | "y">): number {
  return left.x * right.y - left.y * right.x;
}
