import type { OptionListAst } from "../../options/types.js";
import { pt } from "../../coords/scalars.js";
import {
  writeNamedCoordinate,
  writeNamedNodeGeometry,
  type SemanticContext
} from "../context.js";
import { worldPoint as makeWorldPoint, worldVector as makeWorldVector, type WorldPoint, type WorldVector } from "../../coords/points.js";
import { worldTransform } from "../../coords/transforms.js";
import type { WorldTransform } from "../../coords/transforms.js";
import { applyMatrix, identityMatrix } from "../transform.js";
import {
  makeCircularSector,
  makeChamferedRectanglePolygonForSizing,
  makeCloud,
  makeCylinder,
  makeDoubleArrow,
  makeDartPolygon,
  makeEllipseCallout,
  makeDiamondSplitPolygonForSizing,
  intersectRayWithPolygon,
  makeDiamondPolygonForSizing,
  makeIsoscelesTrianglePolygon,
  makeKitePolygon,
  makeRectangleCallout,
  makeRegularPolygon,
  makeRoundedRectanglePolygonForSizing,
  makeSemicircle,
  makeSignal,
  makeSingleArrow,
  makeStar,
  makeStarburst,
  makeTape,
  makeTrapeziumPolygon,
  makeCloudCallout,
  midpoint,
  resolveCalloutPointerOffset,
  resolveNodeShapeGeometryParams,
  type SignalDirection,
  type TapeBendStyle
} from "./shape-geometry.js";
import { resolveRectangleSplitHorizontal, resolveRectangleSplitParts } from "./multipart.js";
import type { NodeLayout, NodeShape } from "./types.js";

function worldPoint(x: number, y: number): WorldPoint {
  return makeWorldPoint(pt(x), pt(y));
}

function worldVector(x: number, y: number): WorldVector {
  return makeWorldVector(pt(x), pt(y));
}

export function placeNodeCenter(
  target: WorldPoint,
  shape: NodeShape,
  layout: NodeLayout,
  anchor: string,
  options: OptionListAst | undefined = undefined,
  nodeTransform: WorldTransform = identityMatrix()
): WorldPoint {
  const rawOffset = nodeAnchorOffset(shape, layout, anchor, options);
  const offset = applyMatrix(nodeTransform, rawOffset);
  return worldPoint(pt(target.x - offset.x), pt(target.y - offset.y));
}

export function nodeAnchorOffset(
  shape: NodeShape,
  layout: NodeLayout,
  anchorRaw: string,
  options: OptionListAst | undefined = undefined
): WorldPoint {
  const anchor = anchorRaw.trim().toLowerCase().replaceAll("_", " ");
  const shapeGeometry = resolveNodeShapeGeometryParams(options);

  if (shape === "coordinate") {
    return worldPoint(pt(0), pt(0));
  }

  if (shape === "circle solidus") {
    if (anchor === "text") {
      return circleSolidusTextAnchorOffset(layout);
    }
    if (anchor === "lower") {
      return circleSolidusEmptyLowerAnchorOffset(layout);
    }
  }

  if (shape === "diamond split" && anchor === "text") {
    return diamondSplitTextAnchorOffset(layout);
  }

  if (anchor === "text") {
    return worldPoint(pt(-layout.textBlockWidth / 2), pt(layout.baseLineY));
  }

  if (shape === "magnifying glass" || shape === "circle split" || shape === "circle solidus") {
    const base = nodeAnchorOffset("circle", layout, anchor, options);
    if (shape === "circle split" && anchor === "lower") {
      return horizontalTwoPartLowerAnchorOffset(layout);
    }
    return base;
  }

  if (shape === "circle") {
    const r = layout.anchorRadius;
    const d = r / Math.sqrt(2);
    switch (anchor) {
      case "north":
        return worldPoint(pt(0), pt(r));
      case "south":
        return worldPoint(pt(0), pt(-r));
      case "east":
        return worldPoint(pt(r), pt(0));
      case "west":
        return worldPoint(pt(-r), pt(0));
      case "north east":
        return worldPoint(pt(d), pt(d));
      case "north west":
        return worldPoint(pt(-d), pt(d));
      case "south east":
        return worldPoint(pt(d), pt(-d));
      case "south west":
        return worldPoint(pt(-d), pt(-d));
      case "base":
        return worldPoint(pt(0), pt(layout.baseLineY));
      case "base east":
        return worldPoint(circleHorizontalOffsetAtY(r, layout.baseLineY, 1), layout.baseLineY);
      case "base west":
        return worldPoint(circleHorizontalOffsetAtY(r, layout.baseLineY, -1), layout.baseLineY);
      case "mid":
        return worldPoint(pt(0), pt(layout.midLineY));
      case "mid east":
        return worldPoint(circleHorizontalOffsetAtY(r, layout.midLineY, 1), layout.midLineY);
      case "mid west":
        return worldPoint(circleHorizontalOffsetAtY(r, layout.midLineY, -1), layout.midLineY);
      case "center":
      default:
        return worldPoint(pt(0), pt(0));
    }
  }

  if (shape === "ellipse") {
    const rx = layout.anchorHalfWidth;
    const ry = layout.anchorHalfHeight;
    switch (anchor) {
      case "north":
        return worldPoint(pt(0), pt(ry));
      case "south":
        return worldPoint(pt(0), pt(-ry));
      case "east":
        return worldPoint(pt(rx), pt(0));
      case "west":
        return worldPoint(pt(-rx), pt(0));
      case "north east":
        return ellipseCompassOffset(rx, ry, 1, 1);
      case "north west":
        return ellipseCompassOffset(rx, ry, -1, 1);
      case "south east":
        return ellipseCompassOffset(rx, ry, 1, -1);
      case "south west":
        return ellipseCompassOffset(rx, ry, -1, -1);
      case "base east":
        return worldPoint(pt(rx), pt(layout.baseLineY));
      case "base west":
        return worldPoint(pt(-rx), pt(layout.baseLineY));
      case "mid":
        return worldPoint(pt(0), pt(layout.midLineY));
      case "mid east":
        return worldPoint(pt(rx), pt(layout.midLineY));
      case "mid west":
        return worldPoint(pt(-rx), pt(layout.midLineY));
      case "base":
        return worldPoint(pt(0), pt(layout.baseLineY));
      case "center":
      default:
        return worldPoint(pt(0), pt(0));
    }
  }

  if (shape === "ellipse split") {
    const base = nodeAnchorOffset("ellipse", layout, anchor, options);
    if (anchor === "lower") {
      return horizontalTwoPartLowerAnchorOffset(layout);
    }
    return base;
  }

  if (shape === "diamond") {
    const polygon = makeDiamondPolygonForSizing(anchorSizingWithOuter(layout), shapeGeometry.diamondAspect);
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "diamond split") {
    if (anchor === "lower") {
      return diamondSplitLowerAnchorOffset(layout);
    }
    const polygon = makeDiamondSplitAnchorPolygon(layout, shapeGeometry.diamondAspect);
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "trapezium") {
    const polygon = makeTrapeziumAnchorPolygon(layout, shapeGeometry);
    return trapeziumAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "isosceles triangle") {
    const polygon = makeIsoscelesTrianglePolygon(
      rawSizing(layout),
      shapeGeometry.isoscelesTriangleApexAngle,
      shapeGeometry.shapeBorderRotate,
      shapeGeometry.isoscelesTriangleStretches
    );
    const special = isoscelesTriangleSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "kite") {
    const polygon = makeKitePolygon(
      rawSizing(layout),
      shapeGeometry.kiteUpperVertexAngle,
      shapeGeometry.kiteLowerVertexAngle,
      shapeGeometry.shapeBorderRotate
    );
    const special = kiteSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "dart") {
    const polygon = makeDartPolygon(
      rawSizing(layout),
      shapeGeometry.dartTipAngle,
      shapeGeometry.dartTailAngle,
      shapeGeometry.shapeBorderRotate
    );
    const special = dartSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "regular polygon") {
    const polygon = makeRegularPolygon(rawSizing(layout), shapeGeometry.regularPolygonSides, shapeGeometry.shapeBorderRotate);
    const special = regularPolygonSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "star") {
    const star = makeStar(
      rawSizing(layout),
      shapeGeometry.starPoints,
      shapeGeometry.starPointRatio,
      shapeGeometry.starPointHeightPt,
      shapeGeometry.starUsesPointRatio,
      shapeGeometry.shapeBorderRotate
    );
    const special = starSpecialAnchor(anchor, star.outer, star.inner);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, star.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "cloud") {
    const cloud = makeCloud(
      rawSizing(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate
    );
    const special = cloudSpecialAnchor(anchor, cloud.puffs);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, cloud.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "starburst") {
    const starburst = makeStarburst(
      rawSizing(layout),
      shapeGeometry.starburstPoints,
      shapeGeometry.starburstPointHeightPt,
      shapeGeometry.randomStarburstSeed,
      shapeGeometry.shapeBorderRotate
    );
    const special = starburstSpecialAnchor(anchor, starburst.outer, starburst.inner);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, starburst.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "signal") {
    const signal = makeSignal(
      rawSizing(layout),
      shapeGeometry.signalPointerAngle,
      shapeGeometry.signalToSides,
      shapeGeometry.signalFromSides
    );
    const special = signalSpecialAnchor(anchor, layout, shapeGeometry);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, signal.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "tape") {
    const tape = makeTape(
      rawSizing(layout),
      shapeGeometry.tapeBendTop,
      shapeGeometry.tapeBendBottom,
      shapeGeometry.tapeBendHeightPt
    );
    const special = tapeSpecialAnchor(anchor, layout, shapeGeometry);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, tape.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "rectangle callout") {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, null, null);
    const callout = makeRectangleCallout(
      rawSizing(layout),
      pointerOffset,
      shapeGeometry.calloutPointerWidthPt,
      shapeGeometry.calloutPointerIsAbsolute,
      shapeGeometry.calloutPointerShortenPt
    );
    if (anchor === "pointer") {
      return callout.pointerAnchor;
    }
    return rectangleBodyAnchorOffset(anchor, layout);
  }

  if (shape === "ellipse callout") {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, null, null);
    const callout = makeEllipseCallout(
      rawVisualSizing(layout),
      pointerOffset,
      shapeGeometry.calloutPointerArc,
      shapeGeometry.calloutPointerIsAbsolute,
      shapeGeometry.calloutPointerShortenPt
    );
    if (anchor === "pointer") {
      return callout.pointerAnchor;
    }
    return ellipseBodyAnchorOffset(anchor, layout);
  }

  if (shape === "cloud callout") {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, null, null);
    const callout = makeCloudCallout(
      rawSizing(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate,
      pointerOffset,
      shapeGeometry.calloutPointerStartSizeRaw,
      shapeGeometry.calloutPointerEndSizeRaw,
      shapeGeometry.calloutPointerSegments,
      shapeGeometry.calloutPointerIsAbsolute,
      shapeGeometry.calloutPointerShortenPt
    );
    if (anchor === "pointer") {
      return callout.pointerAnchor;
    }
    const special = cloudSpecialAnchor(anchor, callout.puffs);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, callout.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "single arrow") {
    const singleArrow = makeSingleArrow(
      rawSizing(layout),
      shapeGeometry.singleArrowTipAngle,
      shapeGeometry.singleArrowHeadExtendPt,
      shapeGeometry.singleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    );
    const special = singleArrowSpecialAnchor(anchor, singleArrow);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, singleArrow.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "double arrow") {
    const doubleArrow = makeDoubleArrow(
      rawSizing(layout),
      shapeGeometry.doubleArrowTipAngle,
      shapeGeometry.doubleArrowHeadExtendPt,
      shapeGeometry.doubleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    );
    const special = doubleArrowSpecialAnchor(anchor, doubleArrow);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, doubleArrow.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "semicircle") {
    const semicircle = makeSemicircle(rawSizing(layout), shapeGeometry.shapeBorderRotate, 0);
    if (anchor === "apex") {
      return semicircle.apex;
    }
    if (anchor === "arc start") {
      return semicircle.arcStart;
    }
    if (anchor === "arc end") {
      return semicircle.arcEnd;
    }
    if (anchor === "chord center") {
      return semicircle.chordCenter;
    }
    return polygonShapeAnchorOffset(anchor, semicircle.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "circular sector") {
    const sector = makeCircularSector(
      rawSizing(layout),
      shapeGeometry.circularSectorAngle,
      shapeGeometry.shapeBorderRotate,
      0
    );
    if (anchor === "sector center") {
      return sector.sectorCenter;
    }
    if (anchor === "arc start") {
      return sector.arcStart;
    }
    if (anchor === "arc end") {
      return sector.arcEnd;
    }
    if (anchor === "arc center") {
      return sector.arcCenter;
    }
    return polygonShapeAnchorOffset(anchor, sector.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "cylinder") {
    const cylinder = makeCylinder(
      rawSizing(layout),
      shapeGeometry.cylinderAspect,
      shapeGeometry.shapeBorderRotate,
      0
    );
    if (anchor === "shape center") {
      return cylinder.shapeCenter;
    }
    if (anchor === "before top") {
      return cylinder.beforeTop;
    }
    if (anchor === "top") {
      return cylinder.top;
    }
    if (anchor === "after top") {
      return cylinder.afterTop;
    }
    if (anchor === "before bottom") {
      return cylinder.beforeBottom;
    }
    if (anchor === "bottom") {
      return cylinder.bottom;
    }
    if (anchor === "after bottom") {
      return cylinder.afterBottom;
    }
    return polygonShapeAnchorOffset(anchor, cylinder.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "rectangle split") {
    const parts = Math.max(1, resolveRectangleSplitParts(options));
    const horizontal = resolveRectangleSplitHorizontal(options);
    const indexed = resolveRectangleSplitIndexedAnchor(anchor, parts);
    if (indexed != null) {
      return horizontal
        ? worldPoint(pt(-layout.anchorHalfWidth + ((indexed - 0.5) * 2 * layout.anchorHalfWidth) / parts), pt(0))
        : worldPoint(pt(0), pt(layout.anchorHalfHeight - ((indexed - 0.5) * 2 * layout.anchorHalfHeight) / parts));
    }
    const split = resolveRectangleSplitDividerAnchor(anchor, parts);
    if (split != null) {
      return horizontal
        ? worldPoint(pt(-layout.anchorHalfWidth + (split * 2 * layout.anchorHalfWidth) / parts), pt(0))
        : worldPoint(pt(0), pt(layout.anchorHalfHeight - (split * 2 * layout.anchorHalfHeight) / parts));
    }
  }

  const hw = layout.anchorHalfWidth;
  const hh = layout.anchorHalfHeight;
  switch (anchor) {
    case "north":
      return worldPoint(pt(0), pt(hh));
    case "south":
      return worldPoint(pt(0), pt(-hh));
    case "east":
      return worldPoint(pt(hw), pt(0));
    case "west":
      return worldPoint(pt(-hw), pt(0));
    case "north east":
      return worldPoint(pt(hw), pt(hh));
    case "north west":
      return worldPoint(pt(-hw), pt(hh));
    case "south east":
      return worldPoint(pt(hw), pt(-hh));
    case "south west":
      return worldPoint(pt(-hw), pt(-hh));
    case "base east":
      return worldPoint(pt(hw), pt(layout.baseLineY));
    case "base west":
      return worldPoint(pt(-hw), pt(layout.baseLineY));
    case "mid":
      return worldPoint(pt(0), pt(layout.midLineY));
    case "mid east":
      return worldPoint(pt(hw), pt(layout.midLineY));
    case "mid west":
      return worldPoint(pt(-hw), pt(layout.midLineY));
    case "base":
      return worldPoint(pt(0), pt(layout.baseLineY));
    case "center":
    default:
      return worldPoint(pt(0), pt(0));
  }
}

function makeTrapeziumAnchorPolygon(
  layout: NodeLayout,
  shapeGeometry: ReturnType<typeof resolveNodeShapeGeometryParams>
): WorldPoint[] {
  const polygon = makeTrapeziumPolygon(
    {
      naturalHalfWidth: layout.naturalWidth / 2,
      naturalHalfHeight: layout.naturalHeight / 2,
      minimumWidth: layout.minimumWidth,
      minimumHeight: layout.minimumHeight
    },
    shapeGeometry.trapeziumLeftAngle,
    shapeGeometry.trapeziumRightAngle,
    0,
    shapeGeometry.trapeziumStretches,
    shapeGeometry.trapeziumStretchesBody
  );
  const outerSep = Math.max(layout.outerXSep, layout.outerYSep);
  const border = trapeziumBorderPolygon(polygon, outerSep);
  return Math.abs(shapeGeometry.shapeBorderRotate) <= 1e-6
    ? border
    : border.map((point) => rotateAnchorPoint(point, shapeGeometry.shapeBorderRotate));
}

function makeDiamondSplitAnchorPolygon(layout: NodeLayout, aspect: number): WorldPoint[] {
  const sizing = layout.twoPartShapeSizing;
  if (!sizing) {
    return makeDiamondPolygonForSizing(anchorSizingWithOuter(layout), aspect);
  }
  const polygon = makeDiamondSplitPolygonForSizing(sizing, aspect);
  const rx = Math.max(...polygon.map((point) => Math.abs(point.x))) + layout.outerXSep;
  const ry = Math.max(...polygon.map((point) => Math.abs(point.y))) + layout.outerYSep;
  return [worldPoint(pt(0), pt(ry)), worldPoint(pt(rx), pt(0)), worldPoint(pt(0), pt(-ry)), worldPoint(pt(-rx), pt(0))];
}

function resolveAnchorPolygon(
  shape: NodeShape,
  layout: NodeLayout,
  shapeGeometry: ReturnType<typeof resolveNodeShapeGeometryParams>
): WorldPoint[] | undefined {
  if (shape === "diamond") {
    return makeDiamondPolygonForSizing(anchorSizingWithOuter(layout), shapeGeometry.diamondAspect);
  }
  if (shape === "trapezium") {
    return makeTrapeziumAnchorPolygon(layout, shapeGeometry);
  }
  if (shape === "isosceles triangle") {
    return makeIsoscelesTrianglePolygon(
      rawSizing(layout),
      shapeGeometry.isoscelesTriangleApexAngle,
      shapeGeometry.shapeBorderRotate,
      shapeGeometry.isoscelesTriangleStretches
    );
  }
  if (shape === "kite") {
    return makeKitePolygon(
      rawSizing(layout),
      shapeGeometry.kiteUpperVertexAngle,
      shapeGeometry.kiteLowerVertexAngle,
      shapeGeometry.shapeBorderRotate
    );
  }
  if (shape === "dart") {
    return makeDartPolygon(
      rawSizing(layout),
      shapeGeometry.dartTipAngle,
      shapeGeometry.dartTailAngle,
      shapeGeometry.shapeBorderRotate
    );
  }
  if (shape === "circular sector") {
    return makeCircularSector(rawSizing(layout), shapeGeometry.circularSectorAngle, shapeGeometry.shapeBorderRotate, 0).polygon;
  }
  if (shape === "cylinder") {
    return makeCylinder(rawSizing(layout), shapeGeometry.cylinderAspect, shapeGeometry.shapeBorderRotate, 0).polygon;
  }
  if (shape === "regular polygon") {
    return makeRegularPolygon(rawSizing(layout), shapeGeometry.regularPolygonSides, shapeGeometry.shapeBorderRotate);
  }
  if (shape === "star") {
    return makeStar(
      rawSizing(layout),
      shapeGeometry.starPoints,
      shapeGeometry.starPointRatio,
      shapeGeometry.starPointHeightPt,
      shapeGeometry.starUsesPointRatio,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "semicircle") {
    return makeSemicircle(rawSizing(layout), shapeGeometry.shapeBorderRotate, 0).polygon;
  }
  if (shape === "cloud") {
    return makeCloud(
      rawSizing(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "starburst") {
    return makeStarburst(
      rawSizing(layout),
      shapeGeometry.starburstPoints,
      shapeGeometry.starburstPointHeightPt,
      shapeGeometry.randomStarburstSeed,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "signal") {
    return makeSignal(
      rawSizing(layout),
      shapeGeometry.signalPointerAngle,
      shapeGeometry.signalToSides,
      shapeGeometry.signalFromSides
    ).polygon;
  }
  if (shape === "tape") {
    return makeTape(
      rawSizing(layout),
      shapeGeometry.tapeBendTop,
      shapeGeometry.tapeBendBottom,
      shapeGeometry.tapeBendHeightPt
    ).polygon;
  }
  if (shape === "rectangle callout") {
    return [
      rectangleBodyAnchorOffset("north west", layout),
      rectangleBodyAnchorOffset("north east", layout),
      rectangleBodyAnchorOffset("south east", layout),
      rectangleBodyAnchorOffset("south west", layout)
    ];
  }
  if (shape === "ellipse callout") {
    const radii = ellipseCalloutBodyRadii(layout);
    return makeEllipseAnchorPolygon(radii.rx, radii.ry);
  }
  if (shape === "cloud callout") {
    return makeCloud(
      rawSizing(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "single arrow") {
    return makeSingleArrow(
      rawSizing(layout),
      shapeGeometry.singleArrowTipAngle,
      shapeGeometry.singleArrowHeadExtendPt,
      shapeGeometry.singleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "double arrow") {
    return makeDoubleArrow(
      rawSizing(layout),
      shapeGeometry.doubleArrowTipAngle,
      shapeGeometry.doubleArrowHeadExtendPt,
      shapeGeometry.doubleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "cross out" || shape === "strike out" || shape === "rectangle split") {
    return [
      worldPoint(-layout.anchorHalfWidth, layout.anchorHalfHeight),
      worldPoint(layout.anchorHalfWidth, layout.anchorHalfHeight),
      worldPoint(layout.anchorHalfWidth, -layout.anchorHalfHeight),
      worldPoint(-layout.anchorHalfWidth, -layout.anchorHalfHeight)
    ];
  }
  if (shape === "magnifying glass" || shape === "circle split" || shape === "circle solidus") {
    return makeEllipseAnchorPolygon(layout.anchorRadius, layout.anchorRadius);
  }
  if (shape === "ellipse split") {
    return makeEllipseAnchorPolygon(layout.anchorHalfWidth, layout.anchorHalfHeight);
  }
  if (shape === "diamond split") {
    return makeDiamondSplitAnchorPolygon(layout, shapeGeometry.diamondAspect);
  }
  if (shape === "rounded rectangle") {
    return makeRoundedRectanglePolygonForSizing(
      {
        ...anchorSizingWithOuter(layout),
        textBlockWidth: layout.textBlockWidth,
        textBlockHeight: layout.textBlockHeight,
        innerXSep: Math.max(0, (layout.naturalWidth - layout.textBlockWidth) / 2),
        innerYSep: Math.max(0, (layout.naturalHeight - layout.textBlockHeight) / 2)
      },
      shapeGeometry.roundedRectangleArcLength,
      shapeGeometry.roundedRectangleWestArc,
      shapeGeometry.roundedRectangleEastArc
    );
  }
  if (shape === "chamfered rectangle") {
    return makeChamferedRectanglePolygonForSizing(
      anchorSizingWithOuter(layout),
      shapeGeometry.chamferedRectangleXSepPt,
      shapeGeometry.chamferedRectangleYSepPt,
      shapeGeometry.chamferedRectangleAngle,
      shapeGeometry.chamferedRectangleCorners
    );
  }
  return undefined;
}

function makeEllipseAnchorPolygon(rx: number, ry: number, steps = 64): WorldPoint[] {
  const points: WorldPoint[] = [];
  const count = Math.max(8, steps);
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * index) / count;
    points.push(worldPoint(rx * Math.cos(angle), ry * Math.sin(angle)));
  }
  return points;
}

function trapeziumAnchorOffset(anchor: string, polygon: WorldPoint[], baseLineY: number, midLineY: number): WorldPoint {
  const bottomLeft = polygon[0];
  const topLeft = polygon[1];
  const topRight = polygon[2];
  const bottomRight = polygon[3];
  if (!bottomLeft || !topLeft || !topRight || !bottomRight) {
    return polygonShapeAnchorOffset(anchor, polygon, baseLineY, midLineY);
  }

  if (anchor === "bottom left corner") {
    return bottomLeft;
  }
  if (anchor === "top left corner") {
    return topLeft;
  }
  if (anchor === "top right corner") {
    return topRight;
  }
  if (anchor === "bottom right corner") {
    return bottomRight;
  }
  if (anchor === "left side") {
    return midpoint(bottomLeft, topLeft);
  }
  if (anchor === "right side") {
    return midpoint(bottomRight, topRight);
  }
  if (anchor === "top side") {
    return midpoint(topLeft, topRight);
  }
  if (anchor === "bottom side") {
    return midpoint(bottomLeft, bottomRight);
  }

  return polygonShapeAnchorOffset(anchor, polygon, baseLineY, midLineY);
}

function isoscelesTriangleSpecialAnchor(anchor: string, polygon: WorldPoint[]): WorldPoint | null {
  const apex = polygon[0];
  const leftCorner = polygon[1];
  const rightCorner = polygon[2];
  if (!apex || !leftCorner || !rightCorner) {
    return null;
  }

  if (anchor === "apex") {
    return apex;
  }
  if (anchor === "left corner") {
    return leftCorner;
  }
  if (anchor === "right corner") {
    return rightCorner;
  }
  if (anchor === "left side") {
    return midpoint(apex, leftCorner);
  }
  if (anchor === "right side") {
    return midpoint(apex, rightCorner);
  }
  if (anchor === "lower side") {
    return midpoint(leftCorner, rightCorner);
  }

  return null;
}

function kiteSpecialAnchor(anchor: string, polygon: WorldPoint[]): WorldPoint | null {
  const upper = polygon[0];
  const left = polygon[1];
  const lower = polygon[2];
  const right = polygon[3];
  if (!upper || !left || !lower || !right) {
    return null;
  }

  if (anchor === "upper vertex") {
    return upper;
  }
  if (anchor === "left vertex") {
    return left;
  }
  if (anchor === "lower vertex") {
    return lower;
  }
  if (anchor === "right vertex") {
    return right;
  }
  if (anchor === "upper left side") {
    return midpoint(upper, left);
  }
  if (anchor === "upper right side") {
    return midpoint(upper, right);
  }
  if (anchor === "lower left side") {
    return midpoint(lower, left);
  }
  if (anchor === "lower right side") {
    return midpoint(lower, right);
  }

  return null;
}

function dartSpecialAnchor(anchor: string, polygon: WorldPoint[]): WorldPoint | null {
  const tip = polygon[0];
  const leftTail = polygon[1];
  const tailCenter = polygon[2];
  const rightTail = polygon[3];
  if (!tip || !leftTail || !tailCenter || !rightTail) {
    return null;
  }

  if (anchor === "tip") {
    return tip;
  }
  if (anchor === "left tail") {
    return leftTail;
  }
  if (anchor === "right tail") {
    return rightTail;
  }
  if (anchor === "tail center") {
    return tailCenter;
  }
  if (anchor === "left side") {
    return midpoint(tip, leftTail);
  }
  if (anchor === "right side") {
    return midpoint(tip, rightTail);
  }

  return null;
}

function regularPolygonSpecialAnchor(anchor: string, polygon: WorldPoint[]): WorldPoint | null {
  const cornerMatch = anchor.match(/^corner\s+(\d+)$/);
  if (cornerMatch) {
    const index = Number(cornerMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      return polygon[(index - 1) % polygon.length] ?? null;
    }
  }

  const sideMatch = anchor.match(/^side\s+(\d+)$/);
  if (sideMatch) {
    const index = Number(sideMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      const sideIndex = (index - 1) % polygon.length;
      const from = polygon[sideIndex];
      const to = polygon[(sideIndex + 1) % polygon.length];
      if (from && to) {
        return midpoint(from, to);
      }
    }
  }

  return null;
}

function starSpecialAnchor(anchor: string, outerWorldPoints: WorldPoint[], innerWorldPoints: WorldPoint[]): WorldPoint | null {
  const outerMatch = anchor.match(/^(?:outer\s+)?point\s+(\d+)$/);
  if (outerMatch) {
    const index = Number(outerMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      return outerWorldPoints[(index - 1) % outerWorldPoints.length] ?? null;
    }
  }

  const innerMatch = anchor.match(/^inner\s+point\s+(\d+)$/);
  if (innerMatch) {
    const index = Number(innerMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      return innerWorldPoints[(index - 1) % innerWorldPoints.length] ?? null;
    }
  }

  return null;
}

function cloudSpecialAnchor(anchor: string, puffs: WorldPoint[]): WorldPoint | null {
  const match = anchor.match(/^puff\s+(\d+)$/);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  if (!Number.isFinite(index) || index < 1) {
    return null;
  }
  return puffs[(index - 1) % puffs.length] ?? null;
}

function starburstSpecialAnchor(anchor: string, outerWorldPoints: WorldPoint[], innerWorldPoints: WorldPoint[]): WorldPoint | null {
  return starSpecialAnchor(anchor, outerWorldPoints, innerWorldPoints);
}

function singleArrowSpecialAnchor(
  anchor: string,
  geometry: ReturnType<typeof makeSingleArrow>
): WorldPoint | null {
  if (anchor === "tip") {
    return geometry.tip;
  }
  if (anchor === "before tip") {
    return geometry.beforeTip;
  }
  if (anchor === "after tip") {
    return geometry.afterTip;
  }
  if (anchor === "before head") {
    return geometry.beforeHead;
  }
  if (anchor === "after head") {
    return geometry.afterHead;
  }
  if (anchor === "before tail") {
    return geometry.beforeTail;
  }
  if (anchor === "after tail") {
    return geometry.afterTail;
  }
  if (anchor === "tail") {
    return geometry.tail;
  }
  return null;
}

function doubleArrowSpecialAnchor(
  anchor: string,
  geometry: ReturnType<typeof makeDoubleArrow>
): WorldPoint | null {
  if (anchor === "tip 1") {
    return geometry.tip1;
  }
  if (anchor === "before tip 1") {
    return geometry.beforeTip1;
  }
  if (anchor === "after tip 1") {
    return geometry.afterTip1;
  }
  if (anchor === "before head 1") {
    return geometry.beforeHead1;
  }
  if (anchor === "after head 1") {
    return geometry.afterHead1;
  }
  if (anchor === "tip 2") {
    return geometry.tip2;
  }
  if (anchor === "before tip 2") {
    return geometry.beforeTip2;
  }
  if (anchor === "after tip 2") {
    return geometry.afterTip2;
  }
  if (anchor === "before head 2") {
    return geometry.beforeHead2;
  }
  if (anchor === "after head 2") {
    return geometry.afterHead2;
  }
  return null;
}

function polygonShapeAnchorOffset(anchor: string, polygon: WorldPoint[], baseLineY: number, midLineY: number): WorldPoint {
  if (anchor === "center") {
    return worldPoint(pt(0), pt(0));
  }
  if (anchor === "base") {
    return worldPoint(pt(0), pt(baseLineY));
  }
  if (anchor === "mid") {
    return worldPoint(pt(0), pt(midLineY));
  }
  if (anchor === "base east") {
    return polygonDirectionalOffset(polygon, worldPoint(pt(0), pt(baseLineY)), worldVector(1, 0));
  }
  if (anchor === "base west") {
    return polygonDirectionalOffset(polygon, worldPoint(pt(0), pt(baseLineY)), worldVector(-1, 0));
  }
  if (anchor === "mid east") {
    return polygonDirectionalOffset(polygon, worldPoint(pt(0), pt(midLineY)), worldVector(1, 0));
  }
  if (anchor === "mid west") {
    return polygonDirectionalOffset(polygon, worldPoint(pt(0), pt(midLineY)), worldVector(-1, 0));
  }

  const direction = anchorDirection(anchor);
  if (!direction) {
    return worldPoint(pt(0), pt(0));
  }
  return polygonDirectionalOffset(polygon, worldPoint(pt(0), pt(0)), direction);
}

function polygonDirectionalOffset(polygon: WorldPoint[], reference: WorldPoint, direction: WorldVector): WorldPoint {
  const hit = intersectRayWithPolygon(reference, direction, polygon);
  if (!hit) {
    return worldPoint(pt(0), pt(0));
  }
  return hit;
}

function addAnchorPoints(first: WorldPoint, second: WorldPoint): WorldPoint {
  return worldPoint(pt(first.x + second.x), pt(first.y + second.y));
}

function pointPolar(angleDegrees: number, radius: number): WorldPoint {
  const radians = toRadians(angleDegrees);
  return worldPoint(pt(radius * Math.cos(radians)), pt(radius * Math.sin(radians)));
}

function rotateAnchorPoint(point: WorldPoint, degrees: number): WorldPoint {
  const radians = toRadians(degrees);
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return worldPoint(pt(point.x * cosine - point.y * sine), pt(point.x * sine + point.y * cosine));
}

function cotDegrees(degrees: number): number {
  const radians = toRadians(degrees);
  const tangent = Math.tan(radians);
  if (!Number.isFinite(tangent) || Math.abs(tangent) <= 1e-9) {
    return 0;
  }
  return 1 / tangent;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function trapeziumBorderPolygon(polygon: WorldPoint[], outerSep: number): WorldPoint[] {
  if (polygon.length !== 4 || outerSep <= 1e-9) {
    return polygon;
  }
  const [lowerLeft, upperLeft, upperRight, lowerRight] = polygon;
  return [
    worldPoint(pt(lowerLeft.x - trapeziumMiterX(lowerLeft, lowerRight, upperLeft, outerSep)), pt(lowerLeft.y - outerSep)),
    worldPoint(pt(upperLeft.x - trapeziumMiterX(upperLeft, lowerLeft, upperRight, outerSep)), pt(upperLeft.y + outerSep)),
    worldPoint(pt(upperRight.x + trapeziumMiterX(upperRight, upperLeft, lowerRight, outerSep)), pt(upperRight.y + outerSep)),
    worldPoint(pt(lowerRight.x + trapeziumMiterX(lowerRight, upperRight, lowerLeft, outerSep)), pt(lowerRight.y - outerSep))
  ];
}

function trapeziumMiterX(vertex: WorldPoint, first: WorldPoint, second: WorldPoint, outerSep: number): number {
  const firstAngle = Math.atan2(first.y - vertex.y, first.x - vertex.x);
  const secondAngle = Math.atan2(second.y - vertex.y, second.x - vertex.x);
  let angle = Math.abs(firstAngle - secondAngle);
  if (angle > Math.PI) {
    angle = 2 * Math.PI - angle;
  }
  const tangent = Math.tan(angle / 2);
  if (!Number.isFinite(tangent) || Math.abs(tangent) <= 1e-9) {
    return outerSep;
  }
  return Math.abs(outerSep / tangent);
}

function signalSpecialAnchor(
  anchor: string,
  layout: NodeLayout,
  shapeGeometry: ReturnType<typeof resolveNodeShapeGeometryParams>
): WorldPoint | null {
  const anchors = resolveSignalAnchors(layout, shapeGeometry);
  return anchors[anchor] ?? null;
}

function resolveSignalAnchors(
  layout: NodeLayout,
  shapeGeometry: ReturnType<typeof resolveNodeShapeGeometryParams>
): Record<string, WorldPoint> {
  const pointerAngle = Math.max(1e-3, Math.min(179.999, shapeGeometry.signalPointerAngle));
  const halfPointerAngle = pointerAngle / 2;
  const quarterPointerAngle = halfPointerAngle / 2;
  const complementQuarterPointerAngle = 90 - quarterPointerAngle;
  const cotHalfPointerAngle = cotDegrees(halfPointerAngle);
  const outerSep = Math.max(layout.outerXSep, layout.outerYSep);
  const statuses: Record<SignalDirection, "nowhere" | "from" | "to"> = {
    north: signalDirectionStatus("north", shapeGeometry.signalToSides, shapeGeometry.signalFromSides),
    south: signalDirectionStatus("south", shapeGeometry.signalToSides, shapeGeometry.signalFromSides),
    east: signalDirectionStatus("east", shapeGeometry.signalToSides, shapeGeometry.signalFromSides),
    west: signalDirectionStatus("west", shapeGeometry.signalToSides, shapeGeometry.signalFromSides)
  };

  let halfWidth = Math.max(1e-9, layout.naturalWidth / 2);
  let halfHeight = Math.max(1e-9, layout.naturalHeight / 2);
  let horizontalDepth = halfHeight * cotHalfPointerAngle;
  let verticalDepth = halfWidth * cotHalfPointerAngle;

  const verticalPointers = (statuses.north !== "nowhere" ? 1 : 0) + (statuses.south !== "nowhere" ? 1 : 0);
  const horizontalPointers = (statuses.east !== "nowhere" ? 1 : 0) + (statuses.west !== "nowhere" ? 1 : 0);
  if (2 * halfHeight + verticalPointers * verticalDepth < layout.minimumHeight) {
    halfHeight = Math.max(1e-9, (layout.minimumHeight - verticalPointers * verticalDepth) / 2);
    horizontalDepth = halfHeight * cotHalfPointerAngle;
  }
  if (2 * halfWidth + horizontalPointers * horizontalDepth < layout.minimumWidth) {
    halfWidth = Math.max(1e-9, (layout.minimumWidth - horizontalPointers * horizontalDepth) / 2);
    verticalDepth = halfWidth * cotHalfPointerAngle;
  }

  const pointerApexMiter = outerSep / Math.max(Math.sin(toRadians(halfPointerAngle)), 1e-9);
  const toCornerMiter = outerSep / Math.max(Math.cos(toRadians(quarterPointerAngle)), 1e-9);
  const fromCornerMiter = outerSep / Math.max(Math.sin(toRadians(quarterPointerAngle)), 1e-9);
  const base = {
    north: worldPoint(pt(0), pt(halfHeight + (statuses.north === "to" ? verticalDepth : 0))),
    south: worldPoint(pt(0), pt(-halfHeight - (statuses.south === "to" ? verticalDepth : 0))),
    east: worldPoint(pt(halfWidth + (statuses.east === "to" ? horizontalDepth : 0)), pt(0)),
    west: worldPoint(pt(-halfWidth - (statuses.west === "to" ? horizontalDepth : 0)), pt(0)),
    "north east": worldPoint(
      pt(halfWidth + (statuses.east === "from" ? horizontalDepth : 0)),
      pt(halfHeight + (statuses.north === "from" ? verticalDepth : 0))
    ),
    "south east": worldPoint(
      pt(halfWidth + (statuses.east === "from" ? horizontalDepth : 0)),
      pt(-halfHeight - (statuses.south === "from" ? verticalDepth : 0))
    ),
    "south west": worldPoint(
      pt(-halfWidth - (statuses.west === "from" ? horizontalDepth : 0)),
      pt(-halfHeight - (statuses.south === "from" ? verticalDepth : 0))
    ),
    "north west": worldPoint(
      pt(-halfWidth - (statuses.west === "from" ? horizontalDepth : 0)),
      pt(halfHeight + (statuses.north === "from" ? verticalDepth : 0))
    )
  };

  return {
    north: addAnchorPoints(base.north, worldPoint(pt(0), pt(statuses.north === "nowhere" ? outerSep : pointerApexMiter))),
    south: addAnchorPoints(base.south, worldPoint(pt(0), pt(statuses.south === "nowhere" ? -outerSep : -pointerApexMiter))),
    east: addAnchorPoints(base.east, worldPoint(pt(statuses.east === "nowhere" ? outerSep : pointerApexMiter), pt(0))),
    west: addAnchorPoints(base.west, worldPoint(pt(statuses.west === "nowhere" ? -outerSep : -pointerApexMiter), pt(0))),
    "north east": addAnchorPoints(
      base["north east"],
      signalCornerMiter(
        statuses.east,
        statuses.north,
        quarterPointerAngle,
        complementQuarterPointerAngle,
        toCornerMiter,
        fromCornerMiter,
        1,
        1,
        outerSep
      )
    ),
    "south east": addAnchorPoints(
      base["south east"],
      signalCornerMiter(
        statuses.east,
        statuses.south,
        -quarterPointerAngle,
        -complementQuarterPointerAngle,
        toCornerMiter,
        fromCornerMiter,
        1,
        -1,
        outerSep
      )
    ),
    "south west": addAnchorPoints(
      base["south west"],
      signalCornerMiter(
        statuses.west,
        statuses.south,
        180 + quarterPointerAngle,
        180 + complementQuarterPointerAngle,
        toCornerMiter,
        fromCornerMiter,
        -1,
        -1,
        outerSep
      )
    ),
    "north west": addAnchorPoints(
      base["north west"],
      signalCornerMiter(
        statuses.west,
        statuses.north,
        180 - quarterPointerAngle,
        180 - complementQuarterPointerAngle,
        toCornerMiter,
        fromCornerMiter,
        -1,
        1,
        outerSep
      )
    )
  };
}

function signalDirectionStatus(
  direction: SignalDirection,
  toSides: SignalDirection[],
  fromSides: SignalDirection[]
): "nowhere" | "from" | "to" {
  if (toSides.includes(direction)) {
    return "to";
  }
  if (fromSides.includes(direction)) {
    return "from";
  }
  return "nowhere";
}

function signalCornerMiter(
  horizontalStatus: "nowhere" | "from" | "to",
  verticalStatus: "nowhere" | "from" | "to",
  quarterAngle: number,
  complementQuarterAngle: number,
  toCornerMiter: number,
  fromCornerMiter: number,
  xSign: -1 | 1,
  ySign: -1 | 1,
  outerSep: number
): WorldPoint {
  let miter = horizontalStatus === "nowhere"
    ? worldPoint(pt(xSign * outerSep), pt(ySign * outerSep))
    : pointPolar(horizontalStatus === "from" ? quarterAngle : complementQuarterAngle, horizontalStatus === "from" ? fromCornerMiter : toCornerMiter);
  if (verticalStatus === "from") {
    miter = pointPolar(complementQuarterAngle, fromCornerMiter);
  } else if (verticalStatus === "to") {
    miter = pointPolar(quarterAngle, toCornerMiter);
  }
  return miter;
}

function tapeSpecialAnchor(
  anchor: string,
  layout: NodeLayout,
  shapeGeometry: ReturnType<typeof resolveNodeShapeGeometryParams>
): WorldPoint | null {
  const anchors = resolveTapeAnchors(layout, shapeGeometry.tapeBendTop, shapeGeometry.tapeBendBottom, shapeGeometry.tapeBendHeightPt);
  return anchors[anchor] ?? null;
}

function resolveTapeAnchors(
  layout: NodeLayout,
  bendTop: TapeBendStyle,
  bendBottom: TapeBendStyle,
  bendHeightPt: number
): Record<string, WorldPoint> {
  const halfBendHeight = Math.max(0, bendHeightPt) / 2;
  let halfWidth = Math.max(1e-9, layout.naturalWidth / 2);
  let halfHeight = Math.max(1e-9, layout.naturalHeight / 2);
  if (bendTop !== "none") {
    halfHeight += halfBendHeight;
  }
  if (bendBottom !== "none") {
    halfHeight += halfBendHeight;
  }
  halfWidth = Math.max(halfWidth, layout.minimumWidth / 2);
  halfHeight = Math.max(halfHeight, layout.minimumHeight / 2);
  if (bendTop !== "none") {
    halfHeight -= halfBendHeight;
  }
  if (bendBottom !== "none") {
    halfHeight -= halfBendHeight;
  }

  const outerHalfWidth = halfWidth + layout.outerXSep;
  const bendYRadius = 3.414213 * halfBendHeight;
  const bendXRadius = 0.707106 * halfWidth;
  const halfAngle = Math.atan2(bendYRadius, Math.max(bendXRadius, 1e-9)) * 90 / Math.PI;
  const cotHalfAngleIn = cotDegrees(45 - halfAngle);
  const cotHalfAngleOut = cotDegrees(90 - halfAngle);

  const northEast = tapeCornerAnchor(outerHalfWidth, halfHeight, layout.outerYSep, halfBendHeight, bendTop, cotHalfAngleIn, cotHalfAngleOut, 1, 1);
  const northWest = tapeCornerAnchor(outerHalfWidth, halfHeight, layout.outerYSep, halfBendHeight, bendTop, cotHalfAngleIn, cotHalfAngleOut, -1, 1);
  const southEast = tapeCornerAnchor(outerHalfWidth, halfHeight, layout.outerYSep, halfBendHeight, bendBottom, cotHalfAngleIn, cotHalfAngleOut, 1, -1);
  const southWest = tapeCornerAnchor(outerHalfWidth, halfHeight, layout.outerYSep, halfBendHeight, bendBottom, cotHalfAngleIn, cotHalfAngleOut, -1, -1);

  return {
    north: midpoint(northEast, northWest),
    south: midpoint(southEast, southWest),
    east: worldPoint(pt(outerHalfWidth), pt(0)),
    west: worldPoint(pt(-outerHalfWidth), pt(0)),
    "north east": northEast,
    "north west": northWest,
    "south east": southEast,
    "south west": southWest,
    "base east": worldPoint(pt(outerHalfWidth), pt(layout.baseLineY)),
    "base west": worldPoint(pt(-outerHalfWidth), pt(layout.baseLineY)),
    "mid east": worldPoint(pt(outerHalfWidth), pt(layout.midLineY)),
    "mid west": worldPoint(pt(-outerHalfWidth), pt(layout.midLineY))
  };
}

function tapeCornerAnchor(
  outerHalfWidth: number,
  halfHeight: number,
  outerYSep: number,
  halfBendHeight: number,
  bend: TapeBendStyle,
  cotHalfAngleIn: number,
  cotHalfAngleOut: number,
  xSign: -1 | 1,
  ySign: -1 | 1
): WorldPoint {
  let y = ySign * halfHeight;
  if (bend === "in and out") {
    y += ySign * (halfBendHeight + (xSign === ySign ? cotHalfAngleOut : cotHalfAngleIn) * outerYSep);
  } else if (bend === "out and in") {
    y += ySign * (halfBendHeight + (xSign === ySign ? cotHalfAngleIn : cotHalfAngleOut) * outerYSep);
  } else {
    y += ySign * outerYSep;
  }
  return worldPoint(pt(xSign * outerHalfWidth), pt(y));
}

function anchorDirection(anchor: string): WorldVector | null {
  switch (anchor) {
    case "north":
      return worldVector(0, 1);
    case "south":
      return worldVector(0, -1);
    case "east":
      return worldVector(1, 0);
    case "west":
      return worldVector(-1, 0);
    case "north east":
      return worldVector(1, 1);
    case "north west":
      return worldVector(-1, 1);
    case "south east":
      return worldVector(1, -1);
    case "south west":
      return worldVector(-1, -1);
    default:
      return null;
  }
}

function ellipseCompassOffset(rx: number, ry: number, xSign: -1 | 1, ySign: -1 | 1): WorldPoint {
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
    return worldPoint(pt(0), pt(0));
  }
  const factor = Math.SQRT1_2;
  return worldPoint(pt(xSign * rx * factor), pt(ySign * ry * factor));
}

function circleHorizontalOffsetAtY(radius: number, y: number, direction: -1 | 1): number {
  if (!Number.isFinite(radius) || radius <= 1e-9) {
    return 0;
  }

  const clampedY = Math.max(-radius, Math.min(radius, y));
  const xMagnitude = Math.sqrt(Math.max(0, radius * radius - clampedY * clampedY));
  return direction < 0 ? -xMagnitude : xMagnitude;
}

function circleSolidusTextAnchorOffset(layout: NodeLayout): WorldPoint {
  const innerXSep = Math.max(0, (layout.naturalWidth - layout.textBlockWidth) / 2);
  const innerYSep = Math.max(0, (layout.naturalHeight - layout.textBlockHeight) / 2);
  const lineInset = layout.lineWidth * 0.3536;
  return worldPoint(
    pt(-layout.textBlockWidth / 2 - layout.textBlockHeight / 2 - innerXSep - lineInset),
    pt(layout.textBlockWidth / 2 - layout.textBlockHeight / 2 + innerYSep + lineInset)
  );
}

function circleSolidusEmptyLowerAnchorOffset(layout: NodeLayout): WorldPoint {
  const innerXSep = Math.max(0, (layout.naturalWidth - layout.textBlockWidth) / 2);
  const innerYSep = Math.max(0, (layout.naturalHeight - layout.textBlockHeight) / 2);
  const lineInset = layout.lineWidth * 0.3535;
  return worldPoint(pt(innerXSep + lineInset), pt(-innerYSep - lineInset));
}

function horizontalTwoPartLowerAnchorOffset(layout: NodeLayout): WorldPoint {
  const sizing = layout.twoPartShapeSizing;
  if (!sizing) {
    return worldPoint(pt(0), pt(-layout.anchorHalfHeight * 0.5));
  }
  return worldPoint(
    pt(-sizing.lowerWidth / 2),
    pt(-sizing.innerYSep - sizing.lowerAscent - sizing.lineWidth / 2)
  );
}

function diamondSplitTextAnchorOffset(layout: NodeLayout): WorldPoint {
  const sizing = layout.twoPartShapeSizing;
  if (!sizing) {
    return worldPoint(pt(-layout.textBlockWidth / 2), pt(layout.baseLineY));
  }
  return worldPoint(
    pt(-sizing.upperWidth / 2),
    pt(sizing.upperHeight / 4 + layout.outerYSep)
  );
}

function diamondSplitLowerAnchorOffset(layout: NodeLayout): WorldPoint {
  const sizing = layout.twoPartShapeSizing;
  if (!sizing) {
    return worldPoint(pt(0), pt(-layout.anchorHalfHeight * 0.5));
  }
  return worldPoint(
    pt(-sizing.lowerWidth / 2),
    pt(-1.25 * sizing.lowerHeight - layout.outerYSep)
  );
}

function rawSizing(layout: NodeLayout): {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
  innerYSep?: number;
} {
  return {
    naturalWidth: layout.naturalWidth,
    naturalHeight: layout.naturalHeight,
    minimumWidth: layout.minimumWidth,
    minimumHeight: layout.minimumHeight,
    innerYSep: Math.max(0, (layout.naturalHeight - layout.textBlockHeight) / 2)
  };
}

function rawVisualSizing(layout: NodeLayout): {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
} {
  return {
    naturalWidth: layout.visualWidth,
    naturalHeight: layout.visualHeight,
    minimumWidth: 0,
    minimumHeight: 0
  };
}

function rectangleBodyAnchorOffset(anchor: string, layout: NodeLayout): WorldPoint {
  const halfWidth = Math.max(layout.naturalWidth, layout.minimumWidth) / 2 + layout.outerXSep;
  const halfHeight = Math.max(layout.naturalHeight, layout.minimumHeight) / 2 + layout.outerYSep;
  return rectangleAnchorOffset(anchor, halfWidth, halfHeight, layout.baseLineY, layout.midLineY);
}

function rectangleAnchorOffset(anchor: string, halfWidth: number, halfHeight: number, baseLineY: number, midLineY: number): WorldPoint {
  switch (anchor) {
    case "north":
      return worldPoint(pt(0), pt(halfHeight));
    case "south":
      return worldPoint(pt(0), pt(-halfHeight));
    case "east":
      return worldPoint(pt(halfWidth), pt(0));
    case "west":
      return worldPoint(pt(-halfWidth), pt(0));
    case "north east":
      return worldPoint(pt(halfWidth), pt(halfHeight));
    case "north west":
      return worldPoint(pt(-halfWidth), pt(halfHeight));
    case "south east":
      return worldPoint(pt(halfWidth), pt(-halfHeight));
    case "south west":
      return worldPoint(pt(-halfWidth), pt(-halfHeight));
    case "base east":
      return worldPoint(pt(halfWidth), pt(baseLineY));
    case "base west":
      return worldPoint(pt(-halfWidth), pt(baseLineY));
    case "mid":
      return worldPoint(pt(0), pt(midLineY));
    case "mid east":
      return worldPoint(pt(halfWidth), pt(midLineY));
    case "mid west":
      return worldPoint(pt(-halfWidth), pt(midLineY));
    case "base":
      return worldPoint(pt(0), pt(baseLineY));
    case "center":
    default:
      return worldPoint(pt(0), pt(0));
  }
}

function ellipseCalloutBodyRadii(layout: NodeLayout): { rx: number; ry: number } {
  return {
    rx: layout.visualWidth / 2 + layout.outerXSep,
    ry: layout.visualHeight / 2 + layout.outerYSep
  };
}

function ellipseBodyAnchorOffset(anchor: string, layout: NodeLayout): WorldPoint {
  const { rx, ry } = ellipseCalloutBodyRadii(layout);
  switch (anchor) {
    case "north":
      return worldPoint(pt(0), pt(ry));
    case "south":
      return worldPoint(pt(0), pt(-ry));
    case "east":
      return worldPoint(pt(rx), pt(0));
    case "west":
      return worldPoint(pt(-rx), pt(0));
    case "north east":
      return ellipseCompassOffset(rx, ry, 1, 1);
    case "north west":
      return ellipseCompassOffset(rx, ry, -1, 1);
    case "south east":
      return ellipseCompassOffset(rx, ry, 1, -1);
    case "south west":
      return ellipseCompassOffset(rx, ry, -1, -1);
    case "base east":
      return worldPoint(pt(rx), pt(layout.baseLineY));
    case "base west":
      return worldPoint(pt(-rx), pt(layout.baseLineY));
    case "mid":
      return worldPoint(pt(0), pt(layout.midLineY));
    case "mid east":
      return worldPoint(pt(rx), pt(layout.midLineY));
    case "mid west":
      return worldPoint(pt(-rx), pt(layout.midLineY));
    case "base":
      return worldPoint(pt(0), pt(layout.baseLineY));
    case "center":
    default:
      return worldPoint(pt(0), pt(0));
  }
}

function anchorSizingWithOuter(layout: NodeLayout): {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
} {
  return {
    naturalWidth: layout.naturalWidth + layout.outerXSep * 2,
    naturalHeight: layout.naturalHeight + layout.outerYSep * 2,
    minimumWidth: layout.minimumWidth + layout.outerXSep * 2,
    minimumHeight: layout.minimumHeight + layout.outerYSep * 2
  };
}

function visualSizingWithOuter(layout: NodeLayout): {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
} {
  return {
    naturalWidth: layout.visualWidth + layout.outerXSep * 2,
    naturalHeight: layout.visualHeight + layout.outerYSep * 2,
    minimumWidth: 0,
    minimumHeight: 0
  };
}

export function registerNamedNodeAnchors(
  context: SemanticContext,
  name: string,
  center: WorldPoint,
  shape: NodeShape,
  layout: NodeLayout,
  options: OptionListAst | undefined = undefined,
  nodeTransform: WorldTransform = identityMatrix(),
  producerSourceId?: string
): void {
  const shapeGeometry = resolveNodeShapeGeometryParams(options);
  let anchorPolygon = resolveAnchorPolygon(shape, layout, shapeGeometry);
  const needsFallbackPolygon =
    Math.abs(nodeTransform.a - 1) > 1e-6 ||
    Math.abs(nodeTransform.b) > 1e-6 ||
    Math.abs(nodeTransform.c) > 1e-6 ||
    Math.abs(nodeTransform.d - 1) > 1e-6;
  if (!anchorPolygon && needsFallbackPolygon) {
    if (shape === "rectangle") {
      anchorPolygon = [
        worldPoint(-layout.anchorHalfWidth, layout.anchorHalfHeight),
        worldPoint(layout.anchorHalfWidth, layout.anchorHalfHeight),
        worldPoint(layout.anchorHalfWidth, -layout.anchorHalfHeight),
        worldPoint(-layout.anchorHalfWidth, -layout.anchorHalfHeight)
      ];
    } else if (shape === "circle") {
      anchorPolygon = makeEllipseAnchorPolygon(layout.anchorRadius, layout.anchorRadius);
    } else if (shape === "ellipse") {
      anchorPolygon = makeEllipseAnchorPolygon(layout.anchorHalfWidth, layout.anchorHalfHeight);
    }
  }
  if (anchorPolygon) {
    anchorPolygon = anchorPolygon.map((point) => applyMatrix(nodeTransform, point));
  }
  const transformedCenter = worldPoint(center.x + nodeTransform.e, center.y + nodeTransform.f);

  writeNamedNodeGeometry(
    context,
    name,
    {
      sourceId: producerSourceId,
      shape,
      center: transformedCenter,
      anchorTransform: worldTransform(nodeTransform.a, nodeTransform.b, nodeTransform.c, nodeTransform.d, 0, 0),
      anchorHalfWidth: layout.anchorHalfWidth,
      anchorHalfHeight: layout.anchorHalfHeight,
      anchorRadius: layout.anchorRadius,
      diamondAspect: shapeGeometry.diamondAspect,
      trapeziumLeftAngle: shapeGeometry.trapeziumLeftAngle,
      trapeziumRightAngle: shapeGeometry.trapeziumRightAngle,
      shapeBorderRotate: shapeGeometry.shapeBorderRotate,
      trapeziumStretches: shapeGeometry.trapeziumStretches,
      trapeziumStretchesBody: shapeGeometry.trapeziumStretchesBody,
      anchorPolygon
    },
    producerSourceId
  );

  const offsets: Record<string, WorldPoint> = {
    center: nodeAnchorOffset(shape, layout, "center", options),
    text: nodeAnchorOffset(shape, layout, "text", options),
    base: nodeAnchorOffset(shape, layout, "base", options),
    north: nodeAnchorOffset(shape, layout, "north", options),
    south: nodeAnchorOffset(shape, layout, "south", options),
    east: nodeAnchorOffset(shape, layout, "east", options),
    west: nodeAnchorOffset(shape, layout, "west", options),
    "north east": nodeAnchorOffset(shape, layout, "north east", options),
    "north west": nodeAnchorOffset(shape, layout, "north west", options),
    "south east": nodeAnchorOffset(shape, layout, "south east", options),
    "south west": nodeAnchorOffset(shape, layout, "south west", options),
    "base east": nodeAnchorOffset(shape, layout, "base east", options),
    "base west": nodeAnchorOffset(shape, layout, "base west", options),
    mid: nodeAnchorOffset(shape, layout, "mid", options),
    "mid east": nodeAnchorOffset(shape, layout, "mid east", options),
    "mid west": nodeAnchorOffset(shape, layout, "mid west", options)
  };

  if (shape === "trapezium") {
    offsets["bottom left corner"] = nodeAnchorOffset(shape, layout, "bottom left corner", options);
    offsets["top left corner"] = nodeAnchorOffset(shape, layout, "top left corner", options);
    offsets["top right corner"] = nodeAnchorOffset(shape, layout, "top right corner", options);
    offsets["bottom right corner"] = nodeAnchorOffset(shape, layout, "bottom right corner", options);
    offsets["left side"] = nodeAnchorOffset(shape, layout, "left side", options);
    offsets["right side"] = nodeAnchorOffset(shape, layout, "right side", options);
    offsets["top side"] = nodeAnchorOffset(shape, layout, "top side", options);
    offsets["bottom side"] = nodeAnchorOffset(shape, layout, "bottom side", options);
  }

  if (shape === "isosceles triangle") {
    offsets.apex = nodeAnchorOffset(shape, layout, "apex", options);
    offsets["left corner"] = nodeAnchorOffset(shape, layout, "left corner", options);
    offsets["right corner"] = nodeAnchorOffset(shape, layout, "right corner", options);
    offsets["left side"] = nodeAnchorOffset(shape, layout, "left side", options);
    offsets["right side"] = nodeAnchorOffset(shape, layout, "right side", options);
    offsets["lower side"] = nodeAnchorOffset(shape, layout, "lower side", options);
  }

  if (shape === "kite") {
    offsets["upper vertex"] = nodeAnchorOffset(shape, layout, "upper vertex", options);
    offsets["left vertex"] = nodeAnchorOffset(shape, layout, "left vertex", options);
    offsets["lower vertex"] = nodeAnchorOffset(shape, layout, "lower vertex", options);
    offsets["right vertex"] = nodeAnchorOffset(shape, layout, "right vertex", options);
    offsets["upper left side"] = nodeAnchorOffset(shape, layout, "upper left side", options);
    offsets["upper right side"] = nodeAnchorOffset(shape, layout, "upper right side", options);
    offsets["lower left side"] = nodeAnchorOffset(shape, layout, "lower left side", options);
    offsets["lower right side"] = nodeAnchorOffset(shape, layout, "lower right side", options);
  }

  if (shape === "dart") {
    offsets.tip = nodeAnchorOffset(shape, layout, "tip", options);
    offsets["tail center"] = nodeAnchorOffset(shape, layout, "tail center", options);
    offsets["left tail"] = nodeAnchorOffset(shape, layout, "left tail", options);
    offsets["right tail"] = nodeAnchorOffset(shape, layout, "right tail", options);
    offsets["left side"] = nodeAnchorOffset(shape, layout, "left side", options);
    offsets["right side"] = nodeAnchorOffset(shape, layout, "right side", options);
  }

  if (shape === "semicircle") {
    offsets.apex = nodeAnchorOffset(shape, layout, "apex", options);
    offsets["arc start"] = nodeAnchorOffset(shape, layout, "arc start", options);
    offsets["arc end"] = nodeAnchorOffset(shape, layout, "arc end", options);
    offsets["chord center"] = nodeAnchorOffset(shape, layout, "chord center", options);
  }

  if (shape === "circular sector") {
    offsets["sector center"] = nodeAnchorOffset(shape, layout, "sector center", options);
    offsets["arc start"] = nodeAnchorOffset(shape, layout, "arc start", options);
    offsets["arc end"] = nodeAnchorOffset(shape, layout, "arc end", options);
    offsets["arc center"] = nodeAnchorOffset(shape, layout, "arc center", options);
  }

  if (shape === "cylinder") {
    offsets["shape center"] = nodeAnchorOffset(shape, layout, "shape center", options);
    offsets["before top"] = nodeAnchorOffset(shape, layout, "before top", options);
    offsets.top = nodeAnchorOffset(shape, layout, "top", options);
    offsets["after top"] = nodeAnchorOffset(shape, layout, "after top", options);
    offsets["before bottom"] = nodeAnchorOffset(shape, layout, "before bottom", options);
    offsets.bottom = nodeAnchorOffset(shape, layout, "bottom", options);
    offsets["after bottom"] = nodeAnchorOffset(shape, layout, "after bottom", options);
  }

  if (shape === "regular polygon") {
    const sides = Math.max(3, shapeGeometry.regularPolygonSides);
    for (let index = 1; index <= sides; index += 1) {
      offsets[`corner ${index}`] = nodeAnchorOffset(shape, layout, `corner ${index}`, options);
      offsets[`side ${index}`] = nodeAnchorOffset(shape, layout, `side ${index}`, options);
    }
  }

  if (shape === "star") {
    const points = Math.max(2, shapeGeometry.starPoints);
    for (let index = 1; index <= points; index += 1) {
      offsets[`point ${index}`] = nodeAnchorOffset(shape, layout, `point ${index}`, options);
      offsets[`outer point ${index}`] = nodeAnchorOffset(shape, layout, `outer point ${index}`, options);
      offsets[`inner point ${index}`] = nodeAnchorOffset(shape, layout, `inner point ${index}`, options);
    }
  }

  if (shape === "cloud") {
    const puffs = Math.max(2, shapeGeometry.cloudPuffs);
    for (let index = 1; index <= puffs; index += 1) {
      offsets[`puff ${index}`] = nodeAnchorOffset(shape, layout, `puff ${index}`, options);
    }
  }

  if (shape === "starburst") {
    const points = Math.max(2, shapeGeometry.starburstPoints);
    for (let index = 1; index <= points; index += 1) {
      offsets[`point ${index}`] = nodeAnchorOffset(shape, layout, `point ${index}`, options);
      offsets[`outer point ${index}`] = nodeAnchorOffset(shape, layout, `outer point ${index}`, options);
      offsets[`inner point ${index}`] = nodeAnchorOffset(shape, layout, `inner point ${index}`, options);
    }
  }

  if (shape === "rectangle callout" || shape === "ellipse callout") {
    offsets.pointer = nodeAnchorOffset(shape, layout, "pointer", options);
  }

  if (shape === "cloud callout") {
    offsets.pointer = nodeAnchorOffset(shape, layout, "pointer", options);
    const puffs = Math.max(2, shapeGeometry.cloudPuffs);
    for (let index = 1; index <= puffs; index += 1) {
      offsets[`puff ${index}`] = nodeAnchorOffset(shape, layout, `puff ${index}`, options);
    }
  }

  if ((shape === "rectangle callout" || shape === "ellipse callout" || shape === "cloud callout") && shapeGeometry.calloutPointerIsAbsolute) {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, context, center);
    if (shape === "rectangle callout") {
      offsets.pointer = makeRectangleCallout(
        anchorSizingWithOuter(layout),
        pointerOffset,
        shapeGeometry.calloutPointerWidthPt,
        true,
        shapeGeometry.calloutPointerShortenPt
      ).pointerAnchor;
    } else if (shape === "ellipse callout") {
      offsets.pointer = makeEllipseCallout(
        visualSizingWithOuter(layout),
        pointerOffset,
        shapeGeometry.calloutPointerArc,
        true,
        shapeGeometry.calloutPointerShortenPt
      ).pointerAnchor;
    } else {
      offsets.pointer = makeCloudCallout(
        anchorSizingWithOuter(layout),
        shapeGeometry.cloudPuffs,
        shapeGeometry.cloudPuffArc,
        shapeGeometry.diamondAspect,
        shapeGeometry.cloudIgnoresAspect,
        shapeGeometry.shapeBorderRotate,
        pointerOffset,
        shapeGeometry.calloutPointerStartSizeRaw,
        shapeGeometry.calloutPointerEndSizeRaw,
        shapeGeometry.calloutPointerSegments,
        true,
        shapeGeometry.calloutPointerShortenPt
      ).pointerAnchor;
    }
  }

  if (shape === "single arrow") {
    offsets.tip = nodeAnchorOffset(shape, layout, "tip", options);
    offsets["before tip"] = nodeAnchorOffset(shape, layout, "before tip", options);
    offsets["after tip"] = nodeAnchorOffset(shape, layout, "after tip", options);
    offsets["before head"] = nodeAnchorOffset(shape, layout, "before head", options);
    offsets["after head"] = nodeAnchorOffset(shape, layout, "after head", options);
    offsets["before tail"] = nodeAnchorOffset(shape, layout, "before tail", options);
    offsets["after tail"] = nodeAnchorOffset(shape, layout, "after tail", options);
    offsets.tail = nodeAnchorOffset(shape, layout, "tail", options);
  }

  if (shape === "double arrow") {
    offsets["tip 1"] = nodeAnchorOffset(shape, layout, "tip 1", options);
    offsets["before tip 1"] = nodeAnchorOffset(shape, layout, "before tip 1", options);
    offsets["after tip 1"] = nodeAnchorOffset(shape, layout, "after tip 1", options);
    offsets["before head 1"] = nodeAnchorOffset(shape, layout, "before head 1", options);
    offsets["after head 1"] = nodeAnchorOffset(shape, layout, "after head 1", options);
    offsets["tip 2"] = nodeAnchorOffset(shape, layout, "tip 2", options);
    offsets["before tip 2"] = nodeAnchorOffset(shape, layout, "before tip 2", options);
    offsets["after tip 2"] = nodeAnchorOffset(shape, layout, "after tip 2", options);
    offsets["before head 2"] = nodeAnchorOffset(shape, layout, "before head 2", options);
    offsets["after head 2"] = nodeAnchorOffset(shape, layout, "after head 2", options);
  }

  if (shape === "circle split" || shape === "circle solidus" || shape === "ellipse split" || shape === "diamond split") {
    offsets.upper = nodeAnchorOffset(shape, layout, "upper", options);
    offsets.lower = nodeAnchorOffset(shape, layout, "lower", options);
  }

  if (shape === "rectangle split") {
    const parts = Math.max(1, resolveRectangleSplitParts(options));
    for (let index = 1; index <= parts; index += 1) {
      offsets[String(index)] = nodeAnchorOffset(shape, layout, String(index), options);
      const alias = RECTANGLE_SPLIT_CARDINALS[index - 1];
      if (alias) {
        offsets[alias] = nodeAnchorOffset(shape, layout, alias, options);
      }
      const ordinal = RECTANGLE_SPLIT_ORDINALS[index - 1];
      if (ordinal) {
        offsets[ordinal] = nodeAnchorOffset(shape, layout, ordinal, options);
      }
    }
    for (let index = 1; index < parts; index += 1) {
      offsets[`split ${index}`] = nodeAnchorOffset(shape, layout, `split ${index}`, options);
      offsets[`${index} split`] = nodeAnchorOffset(shape, layout, `${index} split`, options);
      const alias = RECTANGLE_SPLIT_CARDINALS[index - 1];
      if (alias) {
        offsets[`${alias} split`] = nodeAnchorOffset(shape, layout, `${alias} split`, options);
      }
      const ordinal = RECTANGLE_SPLIT_ORDINALS[index - 1];
      if (ordinal) {
        offsets[`${ordinal} split`] = nodeAnchorOffset(shape, layout, `${ordinal} split`, options);
      }
    }
  }

  for (const [anchor, offset] of Object.entries(offsets)) {
    const transformedOffset = applyMatrix(nodeTransform, offset);
    const point = worldPoint(center.x + transformedOffset.x, center.y + transformedOffset.y);
    if (anchor === "center") {
      writeNamedCoordinate(context, name, point, producerSourceId);
    }
    writeNamedCoordinate(context, `${name}.${anchor}`, point, producerSourceId);
  }
}

const RECTANGLE_SPLIT_CARDINALS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty"
] as const;

const RECTANGLE_SPLIT_ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth"
] as const;

function resolveRectangleSplitIndexedAnchor(anchor: string, parts: number): number | null {
  const normalized = anchor.trim().toLowerCase();
  const digit = normalized.match(/^(?:part\s+)?(\d{1,2})$/u);
  if (digit) {
    const index = Number.parseInt(digit[1] ?? "", 10);
    return Number.isFinite(index) && index >= 1 && index <= parts ? index : null;
  }
  const cardinalIndex = RECTANGLE_SPLIT_CARDINALS.findIndex((value) => value === normalized);
  if (cardinalIndex >= 0 && cardinalIndex + 1 <= parts) {
    return cardinalIndex + 1;
  }
  const ordinalIndex = RECTANGLE_SPLIT_ORDINALS.findIndex((value) => value === normalized);
  if (ordinalIndex >= 0 && ordinalIndex + 1 <= parts) {
    return ordinalIndex + 1;
  }
  return null;
}

function resolveRectangleSplitDividerAnchor(anchor: string, parts: number): number | null {
  const normalized = anchor.trim().toLowerCase();
  const digit = normalized.match(/^(?:split\s+(\d{1,2})|(\d{1,2})\s+split)$/u);
  if (digit) {
    const raw = digit[1] ?? digit[2] ?? "";
    const index = Number.parseInt(raw, 10);
    return Number.isFinite(index) && index >= 1 && index < parts ? index : null;
  }
  const cardinal = normalized.match(/^([a-z]+)\s+split$/u);
  if (cardinal) {
    const cardinalIndex = RECTANGLE_SPLIT_CARDINALS.findIndex((value) => value === cardinal[1]);
    if (cardinalIndex >= 0 && cardinalIndex + 1 < parts) {
      return cardinalIndex + 1;
    }
    const ordinalIndex = RECTANGLE_SPLIT_ORDINALS.findIndex((value) => value === cardinal[1]);
    if (ordinalIndex >= 0 && ordinalIndex + 1 < parts) {
      return ordinalIndex + 1;
    }
  }
  return null;
}
