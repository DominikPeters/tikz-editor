import type { NodeItem } from "../../ast/types.js";
import { worldPoint, type WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import type { FeatureMarkFn } from "../path/types.js";
import type { ResolvedStyle, SceneElement } from "../types.js";
import {
  applyNodeBoxPaintMode,
  makeCircleElement,
  makeNodeBoxElement,
  makeNodeChamferedRectangleElement,
  makeNodeCircularSectorElement,
  makeNodeCloudCalloutElement,
  makeNodeCloudElement,
  makeNodeCylinderElement,
  makeNodeDartElement,
  makeNodeDiamondSizingElement,
  makeNodeDiamondSplitElement,
  makeNodeDoubleArrowElement,
  makeNodeEllipseCalloutElement,
  makeNodeEllipseElement,
  makeNodeIsoscelesTriangleElement,
  makeNodeKiteElement,
  makeNodeLineElement,
  makeNodeMagnifyingHandleElement,
  makeNodeRectangleCalloutElement,
  makeNodeRegularPolygonElement,
  makeNodeRoundedRectangleElement,
  makeNodeSemicircleElement,
  makeNodeSignalElement,
  makeNodeSingleArrowElement,
  makeNodeStarElement,
  makeNodeStarburstElement,
  makeNodeTapeElement,
  makeNodeTrapeziumElement,
  resolveNodeBoxPaintMode
} from "./elements.js";
import {
  resolveRectangleSplitDrawSplits,
  resolveRectangleSplitLayoutGeometry,
  resolveRectangleSplitPartFills,
  resolveRectangleSplitUseCustomFill,
  type RectangleSplitLayoutGeometry
} from "./multipart-layout.js";
import {
  resolveRectangleSplitHorizontal,
  resolveRectangleSplitParts,
  type NodePartText
} from "./multipart.js";
import {
  resolveCalloutPointerOffset,
  type ShapeGeometryParams,
  type TwoPartShapeSizingInput
} from "./shape-geometry.js";
import type { NodeLayout, NodeShape } from "./types.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}
/**
 * Everything the shape-painting phase needs after a node has been laid out.
 *
 * Keeping this object explicit makes the boundary between node evaluation and
 * SVG-agnostic scene-element emission visible without coupling the dispatcher
 * to placement, name registration, or text-part evaluation.
 */
export type NodeShapeEmissionContext = {
  item: Pick<NodeItem, "id" | "span">;
  statementSourceId: string;
  semanticContext: SemanticContext;
  inheritedStyle: ResolvedStyle;
  markFeature: FeatureMarkFn;
  center: WorldPoint;
  nodeShape: NodeShape;
  nodeLayout: NodeLayout;
  shapeGeometry: ShapeGeometryParams;
  twoPartShapeSizing: TwoPartShapeSizingInput | null;
  rectangleSplitOptions: OptionListAst | undefined;
  rectangleSplitLayout: RectangleSplitLayoutGeometry | null;
  rawNodeParts: NodePartText[];
  nodeTextStyle: ResolvedStyle;
  expandedNodeOptions: OptionListAst | undefined;
  expandedNodeLocalOptions: OptionListAst | undefined;
  textMode: "text" | "math";
  nodeStyle: ResolvedStyle;
  nodeSourceId: string;
  pushNodeElement: (element: SceneElement) => void;
};

export function emitNodeShape(state: NodeShapeEmissionContext): void {
  const {
    item,
    statementSourceId,
    semanticContext: context,
    inheritedStyle: style,
    markFeature,
    center,
    nodeShape,
    nodeLayout,
    shapeGeometry,
    twoPartShapeSizing,
    rectangleSplitOptions,
    rectangleSplitLayout,
    rawNodeParts,
    nodeTextStyle,
    expandedNodeOptions,
    expandedNodeLocalOptions,
    textMode,
    nodeStyle,
    nodeSourceId,
    pushNodeElement
  } = state;
  const explicitPaintMode = resolveNodeBoxPaintMode(expandedNodeLocalOptions);
  const resolvedPaintMode = {
    draw:
      explicitPaintMode.draw ||
      (!style.drawExplicit && nodeStyle.drawExplicit && nodeStyle.stroke != null && nodeStyle.stroke !== "none"),
    fill:
      explicitPaintMode.fill ||
      ((style.fill == null || style.fill === "none") && nodeStyle.fill != null && nodeStyle.fill !== "none")
  };
  if (resolvedPaintMode.draw || resolvedPaintMode.fill || nodeStyle.shadowLayers.length > 0) {
    const nodeBoxStyle = applyNodeBoxPaintMode(nodeStyle, resolvedPaintMode);
    const nodeDividerStyle: ResolvedStyle = {
      ...nodeBoxStyle,
      fill: null,
      fillPattern: null,
      doubleStroke: false,
      doubleDistance: 0
    };
    const calloutWorldPointerOffset = resolveCalloutPointerOffset(shapeGeometry, context, center);
    if (nodeShape === "rounded rectangle") {
      pushNodeElement(
        makeNodeRoundedRectangleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          nodeLayout.textBlockWidth,
          nodeLayout.textBlockHeight,
          Math.max(0, (nodeLayout.naturalWidth - nodeLayout.textBlockWidth) / 2),
          Math.max(0, (nodeLayout.naturalHeight - nodeLayout.textBlockHeight) / 2),
          shapeGeometry.roundedRectangleArcLength,
          shapeGeometry.roundedRectangleWestArc,
          shapeGeometry.roundedRectangleEastArc,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_rounded_rectangle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "chamfered rectangle") {
      pushNodeElement(
        makeNodeChamferedRectangleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.chamferedRectangleXSepPt,
          shapeGeometry.chamferedRectangleYSepPt,
          shapeGeometry.chamferedRectangleAngle,
          shapeGeometry.chamferedRectangleCorners,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_chamfered_rectangle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cross out") {
      const halfWidth = nodeLayout.visualWidth / 2;
      const halfHeight = nodeLayout.visualHeight / 2;
      pushNodeElement(
        makeNodeLineElement(
          nodeSourceId,
          `${item.id}:cross-a`,
          wp(center.x - halfWidth, center.y - halfHeight),
          wp(center.x + halfWidth, center.y + halfHeight),
          nodeDividerStyle,
          item.span
        )
      );
      pushNodeElement(
        makeNodeLineElement(
          nodeSourceId,
          `${item.id}:cross-b`,
          wp(center.x - halfWidth, center.y + halfHeight),
          wp(center.x + halfWidth, center.y - halfHeight),
          nodeDividerStyle,
          item.span
        )
      );
      markFeature("shape_cross_out", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "strike out") {
      const halfWidth = nodeLayout.visualWidth / 2;
      const halfHeight = nodeLayout.visualHeight / 2;
      pushNodeElement(
        makeNodeLineElement(
          nodeSourceId,
          `${item.id}:strike`,
          wp(center.x - halfWidth, center.y - halfHeight),
          wp(center.x + halfWidth, center.y + halfHeight),
          nodeDividerStyle,
          item.span
        )
      );
      markFeature("shape_strike_out", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "magnifying glass") {
      pushNodeElement(makeCircleElement(nodeSourceId, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      pushNodeElement(
        makeNodeMagnifyingHandleElement(
          nodeSourceId,
          `${item.id}:handle`,
          center,
          nodeLayout.visualRadius,
          shapeGeometry.magnifyingGlassHandleAngle,
          shapeGeometry.magnifyingGlassHandleAspect,
          { ...nodeBoxStyle, fill: null },
          item.span
        )
      );
      markFeature("shape_magnifying_glass", "supported");
      markFeature("svg_circle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "circle split" || nodeShape === "circle solidus") {
      pushNodeElement(makeCircleElement(nodeSourceId, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      const r = nodeLayout.visualRadius;
      if (nodeShape === "circle split") {
        pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:split`,
            wp(center.x - r, center.y),
            wp(center.x + r, center.y),
            nodeDividerStyle,
            item.span
          )
        );
        markFeature("shape_circle_split", "supported");
      } else {
        pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:solidus`,
            wp(center.x - r * 0.437, center.y - r * 0.437),
            wp(center.x + r * 0.437, center.y + r * 0.437),
            nodeDividerStyle,
            item.span
          )
        );
        markFeature("shape_circle_solidus", "supported");
      }
      markFeature("svg_circle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "ellipse split") {
      pushNodeElement(makeNodeEllipseElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:split`,
            wp(center.x - nodeLayout.visualWidth / 2, center.y),
            wp(center.x + nodeLayout.visualWidth / 2, center.y),
            nodeDividerStyle,
            item.span
          )
        );
      markFeature("shape_ellipse_split", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "diamond split") {
      if (twoPartShapeSizing) {
        pushNodeElement(
          makeNodeDiamondSplitElement(
            nodeSourceId,
            item.id,
            center,
            twoPartShapeSizing,
            shapeGeometry.diamondAspect,
            nodeBoxStyle,
            item.span
          )
        );
      } else {
        pushNodeElement(
          makeNodeDiamondSizingElement(
            nodeSourceId,
            item.id,
            center,
            nodeLayout.naturalWidth,
            nodeLayout.naturalHeight,
            nodeLayout.minimumWidth,
            nodeLayout.minimumHeight,
            shapeGeometry.diamondAspect,
            nodeBoxStyle,
            item.span
          )
        );
      }
      pushNodeElement(
          makeNodeLineElement(
            nodeSourceId,
            `${item.id}:split`,
            wp(center.x - nodeLayout.visualWidth / 2, center.y),
            wp(center.x + nodeLayout.visualWidth / 2, center.y),
            nodeDividerStyle,
            item.span
          )
        );
      markFeature("shape_diamond_split", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle split") {
      const parts = Math.max(1, resolveRectangleSplitParts(rectangleSplitOptions));
      const horizontal = resolveRectangleSplitHorizontal(rectangleSplitOptions);
      const splitLayout = rectangleSplitLayout ?? resolveRectangleSplitLayoutGeometry({
        rawNodeParts,
        options: rectangleSplitOptions,
        style: nodeTextStyle,
        textMode: textMode,
        context,
        baseLayout: nodeLayout
      });
      const effectiveSplitWidth = splitLayout.width;
      const effectiveSplitHeight = splitLayout.height;
      const useCustomFill = resolveRectangleSplitUseCustomFill(expandedNodeOptions);
      const drawSplits = resolveRectangleSplitDrawSplits(expandedNodeOptions);
      const partFills = resolveRectangleSplitPartFills(expandedNodeOptions, context, statementSourceId, nodeTextStyle.textColor ?? "#000000");
      const segments = splitLayout.segments.map((segment) => ({
        ...segment,
        center: wp(center.x + segment.center.x, center.y + segment.center.y),
        minX: center.x + segment.minX,
        maxX: center.x + segment.maxX,
        minY: center.y + segment.minY,
        maxY: center.y + segment.maxY
      }));
      if (useCustomFill && partFills.length > 0) {
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          const fill = partFills[Math.min(index, partFills.length - 1)] ?? null;
          if (!fill || fill === "none") {
            continue;
          }
          pushNodeElement(
            makeNodeBoxElement(
              nodeSourceId,
              `${item.id}:part-fill-${index + 1}`,
              segment.center,
              segment.width,
              segment.height,
              {
                ...nodeBoxStyle,
                stroke: null,
                drawExplicit: false,
                fill,
                fillPattern: null,
                doubleStroke: false,
                doubleDistance: 0
              },
              item.span
            )
          );
        }
        pushNodeElement(
          makeNodeBoxElement(
            nodeSourceId,
            `${item.id}:border`,
            center,
            effectiveSplitWidth,
            effectiveSplitHeight,
            { ...nodeDividerStyle, fill: null, fillPattern: null, drawExplicit: true },
            item.span
          )
        );
      } else {
        pushNodeElement(makeNodeBoxElement(nodeSourceId, item.id, center, effectiveSplitWidth, effectiveSplitHeight, nodeBoxStyle, item.span));
      }
      if (parts > 1) {
        for (let index = 1; index < segments.length; index += 1) {
          if (drawSplits) {
            const previous = segments[index - 1];
            const current = segments[index];
            if (horizontal) {
              const x = (previous.maxX + current.minX) / 2;
              pushNodeElement(
                makeNodeLineElement(
                  nodeSourceId,
                  `${item.id}:split-${index}`,
                  wp(x, center.y - effectiveSplitHeight / 2),
                  wp(x, center.y + effectiveSplitHeight / 2),
                  nodeDividerStyle,
                  item.span
                )
              );
            } else {
              const y = (previous.minY + current.maxY) / 2;
              pushNodeElement(
                makeNodeLineElement(
                  nodeSourceId,
                  `${item.id}:split-${index}`,
                  wp(center.x - effectiveSplitWidth / 2, y),
                  wp(center.x + effectiveSplitWidth / 2, y),
                  nodeDividerStyle,
                  item.span
                )
              );
            }
          }
        }
      }
      markFeature("shape_rectangle_split", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "circle") {
      pushNodeElement(makeCircleElement(nodeSourceId, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      markFeature("shape_circle", "supported");
      markFeature("svg_circle", "supported");
    } else if (nodeShape === "ellipse") {
      pushNodeElement(makeNodeEllipseElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_ellipse", "supported");
    } else if (nodeShape === "diamond") {
      pushNodeElement(
        makeNodeDiamondSizingElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.diamondAspect,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_diamond", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "trapezium") {
      pushNodeElement(
        makeNodeTrapeziumElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.trapeziumLeftAngle,
          shapeGeometry.trapeziumRightAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.trapeziumStretches,
          shapeGeometry.trapeziumStretchesBody,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_trapezium", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "semicircle") {
      pushNodeElement(
        makeNodeSemicircleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_semicircle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "isosceles triangle") {
      pushNodeElement(
        makeNodeIsoscelesTriangleElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.isoscelesTriangleApexAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.isoscelesTriangleStretches,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_isosceles_triangle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "kite") {
      pushNodeElement(
        makeNodeKiteElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.kiteUpperVertexAngle,
          shapeGeometry.kiteLowerVertexAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_kite", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "dart") {
      pushNodeElement(
        makeNodeDartElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.dartTipAngle,
          shapeGeometry.dartTailAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_dart", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "circular sector") {
      pushNodeElement(
        makeNodeCircularSectorElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.circularSectorAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_circular_sector", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cylinder") {
      pushNodeElement(
        makeNodeCylinderElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          Math.max(0, (nodeLayout.naturalHeight - nodeLayout.textBlockHeight) / 2),
          shapeGeometry.cylinderAspect,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cylinder", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "regular polygon") {
      pushNodeElement(
        makeNodeRegularPolygonElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.regularPolygonSides,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_regular_polygon", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "star") {
      pushNodeElement(
        makeNodeStarElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.starPoints,
          shapeGeometry.starPointRatio,
          shapeGeometry.starPointHeightPt,
          shapeGeometry.starUsesPointRatio,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_star", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cloud") {
      pushNodeElement(
        makeNodeCloudElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.cloudPuffs,
          shapeGeometry.cloudPuffArc,
          shapeGeometry.diamondAspect,
          shapeGeometry.cloudIgnoresAspect,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cloud", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "starburst") {
      pushNodeElement(
        makeNodeStarburstElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.starburstPoints,
          shapeGeometry.starburstPointHeightPt,
          shapeGeometry.randomStarburstSeed,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_starburst", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "signal") {
      pushNodeElement(
        makeNodeSignalElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.signalPointerAngle,
          shapeGeometry.signalToSides,
          shapeGeometry.signalFromSides,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_signal", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "tape") {
      pushNodeElement(
        makeNodeTapeElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.tapeBendTop,
          shapeGeometry.tapeBendBottom,
          shapeGeometry.tapeBendHeightPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_tape", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle callout") {
      pushNodeElement(
        makeNodeRectangleCalloutElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          calloutWorldPointerOffset,
          shapeGeometry.calloutPointerWidthPt,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_rectangle_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "ellipse callout") {
      pushNodeElement(
        makeNodeEllipseCalloutElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.visualWidth,
          nodeLayout.visualHeight,
          0,
          0,
          calloutWorldPointerOffset,
          shapeGeometry.calloutPointerArc,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_ellipse_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cloud callout") {
      pushNodeElement(
        makeNodeCloudCalloutElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.cloudPuffs,
          shapeGeometry.cloudPuffArc,
          shapeGeometry.diamondAspect,
          shapeGeometry.cloudIgnoresAspect,
          shapeGeometry.shapeBorderRotate,
          calloutWorldPointerOffset,
          shapeGeometry.calloutPointerStartSizeRaw,
          shapeGeometry.calloutPointerEndSizeRaw,
          shapeGeometry.calloutPointerSegments,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cloud_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "single arrow") {
      pushNodeElement(
        makeNodeSingleArrowElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.singleArrowTipAngle,
          shapeGeometry.singleArrowHeadExtendPt,
          shapeGeometry.singleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_single_arrow", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "double arrow") {
      pushNodeElement(
        makeNodeDoubleArrowElement(
          nodeSourceId,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.doubleArrowTipAngle,
          shapeGeometry.doubleArrowHeadExtendPt,
          shapeGeometry.doubleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_double_arrow", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle") {
      pushNodeElement(makeNodeBoxElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_rectangle", "supported");
      markFeature("svg_path", "supported");
    }
  }
}
