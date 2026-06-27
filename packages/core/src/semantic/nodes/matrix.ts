import type { NodeItem, PathStatement, Span } from "../../ast/types.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings, expandMacroBindingsMapped } from "../../macros/index.js";
import { parseOptionListRaw, splitTopLevel } from "../../options/parse.js";
import type { OptionListAst } from "../../options/types.js";
import { mapTransformedTextWithFallback } from "../../text/source-map.js";
import { parseLength } from "../coords/parse-length.js";
import type { SemanticContext } from "../context.js";
import type { NodePositioningResolution } from "../path/node-positioning.js";
import type { DiagnosticPushFn, FeatureMarkFn } from "../path/types.js";
import { normalizeOptionValue, parseStyleValueAsOptionList, readBalancedBlock } from "../style/option-utils.js";
import { cloneStyleChain, type StyleChainEntry } from "../style-chain.js";
import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import type { MatrixCellInfo, ResolvedStyle, SceneElement } from "../types.js";
import { parseBooleanishNormalized } from "../../utils/booleanish.js";
import { placeNodeCenter, registerNamedNodeAnchors } from "./anchors.js";
import {
  applyNodeBoxPaintMode,
  makeCircleElement,
  makeNodeBoxElement,
  makeNodeCircularSectorElement,
  makeNodeChamferedRectangleElement,
  makeNodeCloudCalloutElement,
  makeNodeCloudElement,
  makeNodeCylinderElement,
  makeNodeDartElement,
  makeNodeDiamondSizingElement,
  makeNodeEllipseCalloutElement,
  makeNodeEllipseElement,
  makeNodeLineElement,
  makeNodeMagnifyingHandleElement,
  makeNodeRoundedRectangleElement,
  makeNodeIsoscelesTriangleElement,
  makeNodeKiteElement,
  makeNodeRectangleCalloutElement,
  makeNodeRegularPolygonElement,
  makeNodeSemicircleElement,
  makeNodeSignalElement,
  makeNodeSingleArrowElement,
  makeNodeStarElement,
  makeNodeStarburstElement,
  makeNodeTapeElement,
  makeNodeTrapeziumElement,
  makeNodeDoubleArrowElement,
  resolveNodeBoxPaintMode
} from "./elements.js";
import { resolveNodeLayout } from "./layout.js";
import { collectScopedNodeNames } from "./named-coordinates.js";
import { normalizeEscapedTextSpaces, normalizeNodeTextFontSize } from "./normalize-text.js";
import {
  resolveNodeLayer,
  resolveNodeOptionScale,
  resolveNodeStyle
} from "./options.js";
import { resolveCalloutPointerOffset, resolveNodeShapeGeometryParams } from "./shape-geometry.js";
import { resolveRectangleSplitHorizontal, resolveRectangleSplitParts } from "./multipart.js";
import type { NodeLayout, NodeShape } from "./types.js";

type MatrixSpacingSpec = {
  gap: number;
  betweenOrigins: boolean;
};

export type MatrixMode = {
  enabled: boolean;
  matrixOfNodes: boolean;
  matrixKind: "plain" | "nodes" | "math-nodes";
  textMode: "text" | "math";
  includeEmptyCells: boolean;
  cellSeparator: string;
  rowSep: MatrixSpacingSpec;
  columnSep: MatrixSpacingSpec;
  nodesOption?: OptionListAst;
  matrixAnchor?: string;
};

type MatrixParsedRows = {
  rows: Array<{
    cells: MatrixParsedCell[];
    columnGapOverrides: number[];
  }>;
  rowGapOverrides: number[];
};

export type MatrixParsedRowsForEdit = {
  rows: Array<{
    cells: Array<{
      raw: string;
      span: Span;
    }>;
  }>;
};

type MatrixParsedCell = {
  raw: string;
  span: Span;
};

type MatrixCell = {
  raw: string;
  text: string;
  textSpan: Span;
  name?: string;
  aliases?: string[];
  options?: OptionListAst;
};

type ResolvedMatrixCell = {
  cell: MatrixCell;
  options?: OptionListAst;
  cellSpan: Span;
};

export type MatrixNodeEvaluation = {
  behindElements: SceneElement[];
  frontElements: SceneElement[];
};

type MatrixNodeEvaluator = (item: NodeItem, defaultTargetWorldPoint: WorldPoint) => MatrixNodeEvaluation;

export type EvaluateMatrixNodeParams = {
  item: NodeItem;
  statement: PathStatement;
  context: SemanticContext;
  style: ResolvedStyle;
  markFeature: FeatureMarkFn;
  pushDiagnostic: DiagnosticPushFn;
  forcedName?: string;
  matrixMode: MatrixMode;
  nodeShape: NodeShape;
  nodeStyle: ResolvedStyle;
  nodeStyleChain: StyleChainEntry[];
  effectiveNodeOptions: OptionListAst | undefined;
  effectiveNodeLocalOptions: OptionListAst | undefined;
  inheritedTransformScale: number;
  resolvedPositioning: NodePositioningResolution;
  fallbackAnchor: string;
  evaluateNestedNode: MatrixNodeEvaluator;
};

const MATRIX_FLAG_KEYS = new Set(["matrix", "matrix of nodes", "matrix of math nodes", "nodes in empty cells"]);
const MATRIX_KEY_VALUE_KEYS = new Set(["matrix", "matrix of nodes", "matrix of math nodes", "row sep", "column sep", "ampersand replacement", "matrix anchor"]);

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export function evaluateMatrixNodeItem(params: EvaluateMatrixNodeParams): MatrixNodeEvaluation {
  params.markFeature("matrix_node", "supported");

  const parsed = parseMatrixRows(params.item.text, params.matrixMode.cellSeparator, params.item.textSpan.from);
  const rowCount = Math.max(1, parsed.rows.length);
  const colCount = Math.max(1, parsed.rows.reduce((max, row) => Math.max(max, row.cells.length), 0));

  const columnGapOverrides = Array.from<number>({ length: Math.max(0, colCount - 1) }).fill(0);
  for (const row of parsed.rows) {
    for (let column = 0; column < Math.min(row.columnGapOverrides.length, columnGapOverrides.length); column += 1) {
      columnGapOverrides[column] = Math.max(columnGapOverrides[column], row.columnGapOverrides[column] ?? 0);
    }
  }

  const rowGapOverrides = Array.from<number>({ length: Math.max(0, rowCount - 1) }).fill(0);
  for (let row = 0; row < Math.min(parsed.rowGapOverrides.length, rowGapOverrides.length); row += 1) {
    rowGapOverrides[row] = parsed.rowGapOverrides[row] ?? 0;
  }

  const cellGrid: Array<Array<ResolvedMatrixCell | null>> = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => null));
  const colWidths = Array.from<number>({ length: colCount }).fill(0);
  const rowHeights = Array.from<number>({ length: rowCount }).fill(0);
  const matrixEveryNodeOptions = collectMatrixEveryNodeOptions(params.effectiveNodeOptions);

  for (let row = 0; row < rowCount; row += 1) {
    const rawRow = parsed.rows[row] ?? { cells: [] as MatrixParsedCell[], columnGapOverrides: [] };
    for (let column = 0; column < colCount; column += 1) {
      const rawCell = rawRow.cells[column] ?? {
        raw: "",
        span: { from: params.item.textSpan.from, to: params.item.textSpan.from }
      };
      const parsedCell = parseMatrixCell(rawCell, params.matrixMode);
      if (!parsedCell) {
        continue;
      }

      const combinedCellOptions = stripMatrixSpecificOptions(
        mergeOptionLists([matrixEveryNodeOptions, params.matrixMode.nodesOption, parsedCell.options])
      );
      const cellOptionScale = resolveNodeOptionScale(combinedCellOptions, params.style, params.context);
      const cellTransformScale = params.inheritedTransformScale * cellOptionScale;
      const cellStyle = resolveNodeStyle(combinedCellOptions, params.style, params.context, cellTransformScale);
      const expandedCellText = expandMacroBindingsMapped(
        parsedCell.text,
        params.context.stack[params.context.stack.length - 1].macroBindings,
        {
          maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
          trace: params.context.macroTraceCollector ?? undefined,
          sourceOffset: parsedCell.textSpan.from
        }
      );
      const resolvedCellText = mapTransformedTextWithFallback(
        expandedCellText,
        normalizeEscapedTextSpaces(expandedCellText.text),
        "escaped text space normalization"
      );
      const normalizedCellText = normalizeNodeTextFontSize(resolvedCellText.text, cellStyle.fontSize);
      const normalizedMappedCellText = mapTransformedTextWithFallback(
        resolvedCellText,
        normalizedCellText.text,
        "node font size normalization"
      );
      if (containsIncludeGraphicsCommand(normalizedCellText.text)) {
        params.markFeature("text_includegraphics", "supported");
      }
      const cellTextStyle = normalizedCellText.fontSizePt === cellStyle.fontSize
        ? cellStyle
        : { ...cellStyle, fontSize: normalizedCellText.fontSizePt };
      const cellLayout = resolveNodeLayout(
        normalizedCellText.text,
        combinedCellOptions,
        cellTextStyle,
        cellTransformScale,
        params.context.textEngine,
        params.matrixMode.textMode,
        normalizedMappedCellText.sourceMap,
        params.context.graphicsResolver
      );

      cellGrid[row][column] = {
        cell: parsedCell,
        options: combinedCellOptions,
        cellSpan: rawCell.span
      };
      colWidths[column] = Math.max(colWidths[column], cellLayout.visualWidth);
      rowHeights[row] = Math.max(rowHeights[row], cellLayout.visualHeight);
    }
  }

  for (let column = 0; column < colCount; column += 1) {
    if (colWidths[column] <= 0) {
      colWidths[column] = 1;
    }
  }
  for (let row = 0; row < rowCount; row += 1) {
    if (rowHeights[row] <= 0) {
      rowHeights[row] = 1;
    }
  }

  const columnGaps = Array.from<number>({ length: Math.max(0, colCount - 1) })
    .fill(params.matrixMode.columnSep.gap)
    .map((gap, index) => gap + (columnGapOverrides[index] ?? 0));
  const rowGaps = Array.from<number>({ length: Math.max(0, rowCount - 1) })
    .fill(params.matrixMode.rowSep.gap)
    .map((gap, index) => gap + (rowGapOverrides[index] ?? 0));

  const xCenters = computeAxisCenters(colWidths, columnGaps, params.matrixMode.columnSep.betweenOrigins, 1);
  const yCenters = computeAxisCenters(rowHeights, rowGaps, params.matrixMode.rowSep.betweenOrigins, -1);

  const xWorldBounds = computeWorldBoundsFromCenters(xCenters, colWidths);
  const yWorldBounds = computeWorldBoundsFromCenters(yCenters, rowHeights);
  const contentWidth = Math.max(1, xWorldBounds.max - xWorldBounds.min);
  const contentHeight = Math.max(1, yWorldBounds.max - yWorldBounds.min);
  const contentCenter = {
    x: (xWorldBounds.min + xWorldBounds.max) / 2,
    y: (yWorldBounds.min + yWorldBounds.max) / 2
  };

  const matrixLayout = makeMatrixLayout(contentWidth, contentHeight);
  const matrixAnchor = params.matrixMode.matrixAnchor ?? params.fallbackAnchor;
  const shapeGeometry = resolveNodeShapeGeometryParams(params.effectiveNodeOptions, () => params.context.mathRandom.nextRaw());
  const matrixCenter = placeNodeCenter(
    params.resolvedPositioning.anchorPoint,
    params.nodeShape,
    matrixLayout,
    matrixAnchor,
    params.effectiveNodeOptions
  );
  const scopedMatrixNames = collectScopedNodeNames(params.forcedName ?? params.item.name, params.item.aliases, params.context);

  for (const name of scopedMatrixNames) {
    registerNamedNodeAnchors(params.context, name, matrixCenter, params.nodeShape, matrixLayout, params.effectiveNodeOptions);
  }

  const matrixNodeElements: SceneElement[] = [];
  const pushMatrixNodeElement = (element: SceneElement): void => {
    element.styleChain = cloneStyleChain(params.nodeStyleChain);
    matrixNodeElements.push(element);
  };
  const matrixBoxPaintMode = resolveNodeBoxPaintMode(params.effectiveNodeLocalOptions);
  if (matrixBoxPaintMode.draw || matrixBoxPaintMode.fill || params.nodeStyle.shadowLayers.length > 0) {
    const matrixBoxStyle = applyNodeBoxPaintMode(params.nodeStyle, matrixBoxPaintMode);
    const matrixDividerStyle: ResolvedStyle = {
      ...matrixBoxStyle,
      fill: null,
      fillPattern: null,
      doubleStroke: false,
      doubleDistance: 0
    };
    const calloutPointerOffset = resolveCalloutPointerOffset(shapeGeometry, params.context, matrixCenter);
    if (params.nodeShape === "rounded rectangle") {
      pushMatrixNodeElement(
        makeNodeRoundedRectangleElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          matrixLayout.textBlockWidth,
          matrixLayout.textBlockHeight,
          Math.max(0, (matrixLayout.naturalWidth - matrixLayout.textBlockWidth) / 2),
          Math.max(0, (matrixLayout.naturalHeight - matrixLayout.textBlockHeight) / 2),
          shapeGeometry.roundedRectangleArcLength,
          shapeGeometry.roundedRectangleWestArc,
          shapeGeometry.roundedRectangleEastArc,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_rounded_rectangle", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "chamfered rectangle") {
      pushMatrixNodeElement(
        makeNodeChamferedRectangleElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.chamferedRectangleXSepPt,
          shapeGeometry.chamferedRectangleYSepPt,
          shapeGeometry.chamferedRectangleAngle,
          shapeGeometry.chamferedRectangleCorners,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_chamfered_rectangle", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "cross out") {
      const halfWidth = matrixLayout.visualWidth / 2;
      const halfHeight = matrixLayout.visualHeight / 2;
      pushMatrixNodeElement(
        makeNodeLineElement(
          params.statement.id,
          `${params.item.id}:cross-a`,
          wp(matrixCenter.x - halfWidth, matrixCenter.y - halfHeight),
          wp(matrixCenter.x + halfWidth, matrixCenter.y + halfHeight),
          matrixDividerStyle,
          params.item.span
        )
      );
      pushMatrixNodeElement(
        makeNodeLineElement(
          params.statement.id,
          `${params.item.id}:cross-b`,
          wp(matrixCenter.x - halfWidth, matrixCenter.y + halfHeight),
          wp(matrixCenter.x + halfWidth, matrixCenter.y - halfHeight),
          matrixDividerStyle,
          params.item.span
        )
      );
      params.markFeature("shape_cross_out", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "strike out") {
      const halfWidth = matrixLayout.visualWidth / 2;
      const halfHeight = matrixLayout.visualHeight / 2;
      pushMatrixNodeElement(
        makeNodeLineElement(
          params.statement.id,
          `${params.item.id}:strike`,
          wp(matrixCenter.x - halfWidth, matrixCenter.y - halfHeight),
          wp(matrixCenter.x + halfWidth, matrixCenter.y + halfHeight),
          matrixDividerStyle,
          params.item.span
        )
      );
      params.markFeature("shape_strike_out", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "magnifying glass") {
      pushMatrixNodeElement(
        makeCircleElement(params.statement.id, matrixCenter, matrixLayout.visualRadius, matrixBoxStyle, params.item.span)
      );
      pushMatrixNodeElement(
        makeNodeMagnifyingHandleElement(
          params.statement.id,
          `${params.item.id}:handle`,
          matrixCenter,
          matrixLayout.visualRadius,
          shapeGeometry.magnifyingGlassHandleAngle,
          shapeGeometry.magnifyingGlassHandleAspect,
          { ...matrixBoxStyle, fill: null },
          params.item.span
        )
      );
      params.markFeature("shape_magnifying_glass", "supported");
      params.markFeature("svg_circle", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "circle split" || params.nodeShape === "circle solidus") {
      pushMatrixNodeElement(
        makeCircleElement(params.statement.id, matrixCenter, matrixLayout.visualRadius, matrixBoxStyle, params.item.span)
      );
      const radius = matrixLayout.visualRadius;
      if (params.nodeShape === "circle split") {
        pushMatrixNodeElement(
          makeNodeLineElement(
            params.statement.id,
            `${params.item.id}:split`,
            wp(matrixCenter.x - radius, matrixCenter.y),
            wp(matrixCenter.x + radius, matrixCenter.y),
            matrixDividerStyle,
            params.item.span
          )
        );
        params.markFeature("shape_circle_split", "supported");
      } else {
        pushMatrixNodeElement(
          makeNodeLineElement(
            params.statement.id,
            `${params.item.id}:solidus`,
            wp(matrixCenter.x - radius * 0.52, matrixCenter.y - radius * 0.52),
            wp(matrixCenter.x + radius * 0.52, matrixCenter.y + radius * 0.52),
            matrixDividerStyle,
            params.item.span
          )
        );
        params.markFeature("shape_circle_solidus", "supported");
      }
      params.markFeature("svg_circle", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "ellipse split") {
      pushMatrixNodeElement(
        makeNodeEllipseElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          matrixBoxStyle,
          params.item.span
        )
      );
      pushMatrixNodeElement(
        makeNodeLineElement(
          params.statement.id,
          `${params.item.id}:split`,
          wp(matrixCenter.x - matrixLayout.visualWidth / 2, matrixCenter.y),
          wp(matrixCenter.x + matrixLayout.visualWidth / 2, matrixCenter.y),
          matrixDividerStyle,
          params.item.span
        )
      );
      params.markFeature("shape_ellipse_split", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "diamond split") {
      pushMatrixNodeElement(
        makeNodeDiamondSizingElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.diamondAspect,
          matrixBoxStyle,
          params.item.span
        )
      );
      pushMatrixNodeElement(
        makeNodeLineElement(
          params.statement.id,
          `${params.item.id}:split`,
          wp(matrixCenter.x - matrixLayout.visualWidth / 2, matrixCenter.y),
          wp(matrixCenter.x + matrixLayout.visualWidth / 2, matrixCenter.y),
          matrixDividerStyle,
          params.item.span
        )
      );
      params.markFeature("shape_diamond_split", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "rectangle split") {
      pushMatrixNodeElement(
        makeNodeBoxElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          matrixBoxStyle,
          params.item.span
        )
      );
      const dividerCount = Math.max(1, resolveRectangleSplitParts(params.effectiveNodeOptions));
      const horizontal = resolveRectangleSplitHorizontal(params.effectiveNodeOptions);
      if (dividerCount > 1) {
        for (let index = 1; index < dividerCount; index += 1) {
          if (horizontal) {
            const x = matrixCenter.x - matrixLayout.visualWidth / 2 + (matrixLayout.visualWidth * index) / dividerCount;
            pushMatrixNodeElement(
              makeNodeLineElement(
                params.statement.id,
                `${params.item.id}:split-${index}`,
                wp(x, matrixCenter.y - matrixLayout.visualHeight / 2),
                wp(x, matrixCenter.y + matrixLayout.visualHeight / 2),
                matrixDividerStyle,
                params.item.span
              )
            );
          } else {
            const y = matrixCenter.y + matrixLayout.visualHeight / 2 - (matrixLayout.visualHeight * index) / dividerCount;
            pushMatrixNodeElement(
              makeNodeLineElement(
                params.statement.id,
                `${params.item.id}:split-${index}`,
                wp(matrixCenter.x - matrixLayout.visualWidth / 2, y),
                wp(matrixCenter.x + matrixLayout.visualWidth / 2, y),
                matrixDividerStyle,
                params.item.span
              )
            );
          }
        }
      }
      params.markFeature("shape_rectangle_split", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "circle") {
      pushMatrixNodeElement(makeCircleElement(params.statement.id, matrixCenter, matrixLayout.visualRadius, matrixBoxStyle, params.item.span));
      params.markFeature("shape_circle", "supported");
      params.markFeature("svg_circle", "supported");
    } else if (params.nodeShape === "ellipse") {
      pushMatrixNodeElement(
        makeNodeEllipseElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_ellipse", "supported");
    } else if (params.nodeShape === "diamond") {
      pushMatrixNodeElement(
        makeNodeDiamondSizingElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.diamondAspect,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_diamond", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "trapezium") {
      pushMatrixNodeElement(
        makeNodeTrapeziumElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.trapeziumLeftAngle,
          shapeGeometry.trapeziumRightAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.trapeziumStretches,
          shapeGeometry.trapeziumStretchesBody,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_trapezium", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "semicircle") {
      pushMatrixNodeElement(
        makeNodeSemicircleElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_semicircle", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "isosceles triangle") {
      pushMatrixNodeElement(
        makeNodeIsoscelesTriangleElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.isoscelesTriangleApexAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.isoscelesTriangleStretches,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_isosceles_triangle", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "kite") {
      pushMatrixNodeElement(
        makeNodeKiteElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.kiteUpperVertexAngle,
          shapeGeometry.kiteLowerVertexAngle,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_kite", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "dart") {
      pushMatrixNodeElement(
        makeNodeDartElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.dartTipAngle,
          shapeGeometry.dartTailAngle,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_dart", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "circular sector") {
      pushMatrixNodeElement(
        makeNodeCircularSectorElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.circularSectorAngle,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_circular_sector", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "cylinder") {
      pushMatrixNodeElement(
        makeNodeCylinderElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          Math.max(0, (matrixLayout.naturalHeight - matrixLayout.textBlockHeight) / 2),
          shapeGeometry.cylinderAspect,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_cylinder", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "regular polygon") {
      pushMatrixNodeElement(
        makeNodeRegularPolygonElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.regularPolygonSides,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_regular_polygon", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "star") {
      pushMatrixNodeElement(
        makeNodeStarElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.starPoints,
          shapeGeometry.starPointRatio,
          shapeGeometry.starPointHeightPt,
          shapeGeometry.starUsesPointRatio,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_star", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "cloud") {
      pushMatrixNodeElement(
        makeNodeCloudElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.cloudPuffs,
          shapeGeometry.cloudPuffArc,
          shapeGeometry.diamondAspect,
          shapeGeometry.cloudIgnoresAspect,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_cloud", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "starburst") {
      pushMatrixNodeElement(
        makeNodeStarburstElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.starburstPoints,
          shapeGeometry.starburstPointHeightPt,
          shapeGeometry.randomStarburstSeed,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_starburst", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "signal") {
      pushMatrixNodeElement(
        makeNodeSignalElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.signalPointerAngle,
          shapeGeometry.signalToSides,
          shapeGeometry.signalFromSides,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_signal", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "tape") {
      pushMatrixNodeElement(
        makeNodeTapeElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.tapeBendTop,
          shapeGeometry.tapeBendBottom,
          shapeGeometry.tapeBendHeightPt,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_tape", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "rectangle callout") {
      pushMatrixNodeElement(
        makeNodeRectangleCalloutElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          calloutPointerOffset,
          shapeGeometry.calloutPointerWidthPt,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_rectangle_callout", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "ellipse callout") {
      pushMatrixNodeElement(
        makeNodeEllipseCalloutElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          0,
          0,
          calloutPointerOffset,
          shapeGeometry.calloutPointerArc,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_ellipse_callout", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "cloud callout") {
      pushMatrixNodeElement(
        makeNodeCloudCalloutElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.cloudPuffs,
          shapeGeometry.cloudPuffArc,
          shapeGeometry.diamondAspect,
          shapeGeometry.cloudIgnoresAspect,
          shapeGeometry.shapeBorderRotate,
          calloutPointerOffset,
          shapeGeometry.calloutPointerStartSizeRaw,
          shapeGeometry.calloutPointerEndSizeRaw,
          shapeGeometry.calloutPointerSegments,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_cloud_callout", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "single arrow") {
      pushMatrixNodeElement(
        makeNodeSingleArrowElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.singleArrowTipAngle,
          shapeGeometry.singleArrowHeadExtendPt,
          shapeGeometry.singleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_single_arrow", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "double arrow") {
      pushMatrixNodeElement(
        makeNodeDoubleArrowElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.naturalWidth,
          matrixLayout.naturalHeight,
          matrixLayout.minimumWidth,
          matrixLayout.minimumHeight,
          shapeGeometry.doubleArrowTipAngle,
          shapeGeometry.doubleArrowHeadExtendPt,
          shapeGeometry.doubleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_double_arrow", "supported");
      params.markFeature("svg_path", "supported");
    } else if (params.nodeShape === "rectangle") {
      pushMatrixNodeElement(
        makeNodeBoxElement(
          params.statement.id,
          params.item.id,
          matrixCenter,
          matrixLayout.visualWidth,
          matrixLayout.visualHeight,
          matrixBoxStyle,
          params.item.span
        )
      );
      params.markFeature("shape_rectangle", "supported");
      params.markFeature("svg_path", "supported");
    }
  }

  const behindCellElements: SceneElement[] = [];
  const frontCellElements: SceneElement[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < colCount; column += 1) {
      const resolvedCell = cellGrid[row][column];
      if (!resolvedCell) {
        continue;
      }

      const generatedCellNames = scopedMatrixNames.map((matrixName) => `${matrixName}-${row + 1}-${column + 1}`);
      const namedCell = resolveMatrixCellNames(resolvedCell.cell, generatedCellNames);
      const position = wp(
        matrixCenter.x + xCenters[column] - contentCenter.x,
        matrixCenter.y + yCenters[row] - contentCenter.y
      );

      const cellItem: NodeItem = {
        kind: "Node",
        id: `${params.item.id}:matrix-cell:${row + 1}:${column + 1}`,
        span: params.item.span,
        raw: resolvedCell.cell.raw,
        templateRaw: resolvedCell.cell.raw,
        name: namedCell.name,
        aliases: namedCell.aliases,
        optionsSpan: resolvedCell.options?.span,
        options: resolvedCell.options,
        textSource: "group",
        textSpan: resolvedCell.cell.textSpan,
        text: normalizeEscapedTextSpaces(
          expandMacroBindings(
            resolvedCell.cell.text,
            params.context.stack[params.context.stack.length - 1].macroBindings,
            {
              maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
              trace: params.context.macroTraceCollector ?? undefined
            }
          )
        )
      };
      const evaluatedCell = params.evaluateNestedNode(cellItem, position);
      const matrixCellInfo: MatrixCellInfo = {
        matrixSourceId: params.statement.id,
        cellSourceId: cellItem.id,
        row: row + 1,
        column: column + 1,
        textMode: params.matrixMode.textMode,
        textSpan: resolvedCell.cell.textSpan,
        cellSpan: resolvedCell.cellSpan
      };
      stampMatrixCellElements(evaluatedCell.behindElements, matrixCellInfo);
      stampMatrixCellElements(evaluatedCell.frontElements, matrixCellInfo);
      behindCellElements.push(...evaluatedCell.behindElements);
      frontCellElements.push(...evaluatedCell.frontElements);
    }
  }

  const matrixLayer = resolveNodeLayer(params.effectiveNodeOptions, params.context);
  if (matrixLayer === "behind") {
    return {
      behindElements: [...matrixNodeElements, ...behindCellElements, ...frontCellElements],
      frontElements: []
    };
  }
  return {
    behindElements: behindCellElements,
    frontElements: [...matrixNodeElements, ...frontCellElements]
  };
}

export type MatrixCellEditTarget = {
  row: number;
  column: number;
  textMode: "text" | "math";
  cellSpan: Span;
  textSpan: Span;
  optionSpan?: Span;
};

export function resolveMatrixCellEditTarget(
  matrixText: string,
  matrixTextSpan: Span,
  mode: MatrixMode,
  row: number,
  column: number
): MatrixCellEditTarget | null {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row <= 0 || column <= 0) {
    return null;
  }

  const parsed = parseMatrixRows(matrixText, mode.cellSeparator, matrixTextSpan.from);
  const parsedRow = parsed.rows[row - 1];
  const rawCell = parsedRow?.cells[column - 1];
  if (!rawCell) {
    return null;
  }

  const parsedCell = parseMatrixCell(rawCell, mode);
  if (!parsedCell) {
    return null;
  }

  return {
    row,
    column,
    textMode: mode.textMode,
    cellSpan: rawCell.span,
    textSpan: parsedCell.textSpan,
    optionSpan: resolveLeadingMatrixCellOptionSpan(rawCell.raw, rawCell.span.from)
  };
}

function stampMatrixCellElements(elements: SceneElement[], matrixCell: MatrixCellInfo): void {
  for (const element of elements) {
    element.matrixCell = matrixCell;
    element.sourceRef.sourceId = matrixCell.cellSourceId;
    element.sourceRef.sourceSpan = matrixCell.cellSpan;
    if (element.kind === "Text" && element.textRenderInfo?.mode === "mathjax") {
      element.textRenderInfo = {
        ...element.textRenderInfo,
        layoutKind: "matrix-cell"
      };
    }
  }
}

export function resolveMatrixMode(options: OptionListAst | undefined): MatrixMode {
  let enabled = false;
  let matrixOfNodes = false;
  let matrixKind: MatrixMode["matrixKind"] = "plain";
  let includeEmptyCells = false;
  let cellSeparator = "&";
  let rowSep: MatrixSpacingSpec = { gap: 0, betweenOrigins: false };
  let columnSep: MatrixSpacingSpec = { gap: 0, betweenOrigins: false };
  let matrixAnchor: string | undefined;
  const nodesOptionLists: OptionListAst[] = [];

  if (!options) {
    return {
      enabled,
      matrixOfNodes,
      matrixKind,
      textMode: "text",
      includeEmptyCells,
      cellSeparator,
      rowSep,
      columnSep,
      nodesOption: mergeOptionLists(nodesOptionLists),
      matrixAnchor
    };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "matrix") {
        enabled = true;
      } else if (entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
        enabled = true;
        matrixOfNodes = true;
        matrixKind = entry.key === "matrix of math nodes" ? "math-nodes" : "nodes";
      } else if (entry.key === "nodes in empty cells") {
        includeEmptyCells = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "matrix") {
      const parsed = parseBoolish(normalizeOptionValue(entry.valueRaw));
      if (parsed === true) {
        enabled = true;
      } else if (parsed === false) {
        enabled = false;
      }
      continue;
    }

    if (entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      const parsed = parseBoolish(normalizeOptionValue(entry.valueRaw));
      if (parsed === true) {
        enabled = true;
        matrixOfNodes = true;
        matrixKind = entry.key === "matrix of math nodes" ? "math-nodes" : "nodes";
      } else if (parsed === false) {
        matrixOfNodes = false;
        matrixKind = "plain";
      }
      continue;
    }

    if (entry.key === "row sep") {
      rowSep = parseMatrixSpacing(entry.valueRaw);
      continue;
    }

    if (entry.key === "column sep") {
      columnSep = parseMatrixSpacing(entry.valueRaw);
      continue;
    }

    if (entry.key === "ampersand replacement") {
      const replacement = normalizeOptionValue(entry.valueRaw).trim();
      cellSeparator = replacement.length > 0 ? replacement : "&";
      continue;
    }

    if (entry.key === "nodes") {
      const parsedNodes = parseStyleValueAsOptionList(entry.valueRaw);
      if (parsedNodes) {
        nodesOptionLists.push(parsedNodes);
      }
      continue;
    }

    if (entry.key === "matrix anchor") {
      const normalized = normalizeOptionValue(entry.valueRaw).trim().toLowerCase().replaceAll("_", " ");
      if (normalized.length > 0) {
        matrixAnchor = normalized;
      }
    }
  }

  if (matrixOfNodes) {
    enabled = true;
  }

  return {
    enabled,
    matrixOfNodes,
    matrixKind,
    textMode: matrixKind === "math-nodes" ? "math" : "text",
    includeEmptyCells,
    cellSeparator,
    rowSep,
    columnSep,
    nodesOption: mergeOptionLists(nodesOptionLists),
    matrixAnchor
  };
}

function parseMatrixRows(input: string, cellSeparator: string, baseOffset: number): MatrixParsedRows {
  const rows: Array<{ cells: MatrixParsedCell[]; columnGapOverrides: number[] }> = [];
  const rowGapOverrides: number[] = [];
  let start = 0;
  let cursor = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (cursor < input.length) {
    const char = input[cursor];
    if (char === "\\") {
      if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0 && input.startsWith("\\\\", cursor)) {
        const rowRaw = input.slice(start, cursor);
        const split = splitMatrixRowCells(rowRaw, cellSeparator, baseOffset + start);
        rows.push(split);

        cursor += 2;
        while (cursor < input.length && /\s/u.test(input[cursor] ?? "")) {
          cursor += 1;
        }
        let rowGap = 0;
        if (input[cursor] === "[") {
          const block = readBalancedBlock(input, cursor, "[", "]");
          if (block) {
            rowGap = parseMatrixSpacing(block.content).gap;
            cursor = block.nextIndex;
          }
        }
        rowGapOverrides.push(rowGap);
        start = cursor;
        continue;
      }

      cursor += input[cursor + 1] != null ? 2 : 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }

    cursor += 1;
  }

  rows.push(splitMatrixRowCells(input.slice(start), cellSeparator, baseOffset + start));
  while (rows.length > 1 && rows[rows.length - 1]?.cells.every((cell) => cell.raw.trim().length === 0)) {
    rows.pop();
    rowGapOverrides.pop();
  }

  return { rows, rowGapOverrides };
}

export function parseMatrixRowsForEdit(input: string, cellSeparator: string, baseOffset: number): MatrixParsedRowsForEdit {
  const parsed = parseMatrixRows(input, cellSeparator, baseOffset);
  return {
    rows: parsed.rows.map((row) => ({
      cells: row.cells.map((cell) => ({
        raw: cell.raw,
        span: cell.span
      }))
    }))
  };
}

function splitMatrixRowCells(
  rowRaw: string,
  cellSeparator: string,
  rowOffset: number
): { cells: MatrixParsedCell[]; columnGapOverrides: number[] } {
  const cells: MatrixParsedCell[] = [];
  const columnGapOverrides: number[] = [];
  let start = 0;
  let cursor = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (cursor < rowRaw.length) {
    const separatorLength =
      braceDepth === 0 && bracketDepth === 0 && parenDepth === 0 ? matchMatrixCellSeparator(rowRaw, cursor, cellSeparator) : 0;
    if (separatorLength > 0) {
      cells.push({
        raw: rowRaw.slice(start, cursor),
        span: {
          from: rowOffset + start,
          to: rowOffset + cursor
        }
      });
      cursor += separatorLength;
      while (cursor < rowRaw.length && /\s/u.test(rowRaw[cursor] ?? "")) {
        cursor += 1;
      }
      let columnGap = 0;
      if (rowRaw[cursor] === "[") {
        const block = readBalancedBlock(rowRaw, cursor, "[", "]");
        if (block) {
          columnGap = parseMatrixSpacing(block.content).gap;
          cursor = block.nextIndex;
        }
      }
      columnGapOverrides.push(columnGap);
      start = cursor;
      continue;
    }

    const char = rowRaw[cursor];
    if (char === "\\") {
      cursor += rowRaw[cursor + 1] != null ? 2 : 1;
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
    cursor += 1;
  }

  cells.push({
    raw: rowRaw.slice(start),
    span: {
      from: rowOffset + start,
      to: rowOffset + rowRaw.length
    }
  });
  return { cells, columnGapOverrides };
}

function parseMatrixCell(rawCell: MatrixParsedCell, mode: MatrixMode): MatrixCell | null {
  const outer = trimOuterWhitespaceWorldBounds(rawCell.raw, 0, rawCell.raw.length);
  let working = rawCell.raw.slice(outer.from, outer.to);
  let workingOffset = rawCell.span.from + outer.from;
  if (working.length === 0 && !mode.includeEmptyCells) {
    return null;
  }

  const prefixOptions: OptionListAst[] = [];
  let prefixName: string | undefined;
  while (working.startsWith("|")) {
    const closing = findMatrixPipeClosing(working);
    if (closing <= 0) {
      break;
    }
    const prefixRaw = working.slice(1, closing).trim();
    if (prefixRaw.startsWith("[") && prefixRaw.endsWith("]")) {
      prefixOptions.push(parseOptionListRaw(prefixRaw));
    } else if (prefixRaw.startsWith("(") && prefixRaw.endsWith(")")) {
      const parsedName = prefixRaw.slice(1, -1).trim();
      if (parsedName.length > 0) {
        prefixName = parsedName;
      }
    }
    workingOffset += closing + 1;
    const nextWorking = working.slice(closing + 1);
    const trimmedLeading = trimLeadingWhitespace(nextWorking);
    workingOffset += trimmedLeading.consumed;
    working = trimmedLeading.text;
  }

  const explicitNode = parseExplicitMatrixNode(working, workingOffset);
  if (explicitNode) {
    const options = mergeOptionLists([mergeOptionLists(prefixOptions), explicitNode.options]);
    const explicitAliases = explicitNode.aliases ?? [];
    const optionAliases = extractNodeAliasesFromOptions(options);
    const aliases = dedupeNames([...explicitAliases, ...optionAliases]);
    const name = explicitNode.name ?? prefixName ?? extractNodeNameFromOptions(options);
    return {
      raw: working,
      text: explicitNode.text,
      textSpan: explicitNode.textSpan,
      name,
      aliases: aliases.length > 0 ? aliases : undefined,
      options
    };
  }

  let textEnd = trimRightWhitespaceBoundary(working, working.length);
  if (textEnd > 0 && working[textEnd - 1] === ";") {
    textEnd -= 1;
    textEnd = trimRightWhitespaceBoundary(working, textEnd);
  }
  const textStart = trimLeftWhitespaceBoundary(working, 0, textEnd);
  const text = working.slice(textStart, textEnd);
  if (text.length === 0 && !mode.includeEmptyCells) {
    return null;
  }
  if (!mode.matrixOfNodes && text.startsWith("\\")) {
    return null;
  }

  const options = mergeOptionLists(prefixOptions);
  const optionAliases = extractNodeAliasesFromOptions(options);
  const name = prefixName ?? extractNodeNameFromOptions(options);
  return {
    raw: working,
    text,
    textSpan: {
      from: workingOffset + textStart,
      to: workingOffset + textEnd
    },
    name,
    aliases: optionAliases.length > 0 ? optionAliases : undefined,
    options
  };
}

function parseExplicitMatrixNode(
  raw: string,
  baseOffset: number
): { text: string; textSpan: Span; name?: string; aliases?: string[]; options?: OptionListAst } | null {
  let cursor = skipWhitespace(raw, 0);
  if (!raw.startsWith("\\node", cursor)) {
    return null;
  }

  cursor += "\\node".length;
  const optionLists: OptionListAst[] = [];
  let explicitName: string | undefined;

  while (cursor < raw.length) {
    cursor = skipWhitespace(raw, cursor);
    const char = raw[cursor];
    if (char === "[") {
      const block = readBalancedBlock(raw, cursor, "[", "]");
      if (!block) {
        return null;
      }
      optionLists.push(parseOptionListRaw(raw.slice(cursor, block.nextIndex), baseOffset + cursor));
      cursor = block.nextIndex;
      continue;
    }

    if (char === "(") {
      const block = readBalancedBlock(raw, cursor, "(", ")");
      if (!block) {
        return null;
      }
      const name = block.content.trim();
      if (name.length > 0) {
        explicitName = name;
      }
      cursor = block.nextIndex;
      continue;
    }

    if (raw.slice(cursor, cursor + 2) === "at" && /[\s(]/u.test(raw[cursor + 2] ?? "")) {
      cursor += 2;
      cursor = skipWhitespace(raw, cursor);
      if (raw[cursor] === "(") {
        const block = readBalancedBlock(raw, cursor, "(", ")");
        if (!block) {
          return null;
        }
        cursor = block.nextIndex;
      }
      continue;
    }

    break;
  }

  cursor = skipWhitespace(raw, cursor);
  if (raw[cursor] !== "{") {
    return null;
  }
  const textBlock = readBalancedBlock(raw, cursor, "{", "}");
  if (!textBlock) {
    return null;
  }

  const options = mergeOptionLists(optionLists);
  const optionName = extractNodeNameFromOptions(options);
  const aliases = extractNodeAliasesFromOptions(options);
  return {
    text: textBlock.content,
    textSpan: {
      from: baseOffset + cursor + 1,
      to: baseOffset + textBlock.nextIndex - 1
    },
    name: explicitName ?? optionName,
    aliases: aliases.length > 0 ? aliases : undefined,
    options
  };
}

function resolveMatrixCellNames(cell: MatrixCell, generatedNames: string[]): { name?: string; aliases?: string[] } {
  const explicitName = cell.name?.trim();
  const explicitAliases = dedupeNames(cell.aliases ?? []);
  if (explicitName && explicitName.length > 0) {
    const aliases = dedupeNames([...explicitAliases, ...generatedNames]).filter((entry) => entry !== explicitName);
    return {
      name: explicitName,
      aliases: aliases.length > 0 ? aliases : undefined
    };
  }

  if (generatedNames.length > 0) {
    const name = generatedNames[0];
    const aliases = dedupeNames([...generatedNames.slice(1), ...explicitAliases]).filter((entry) => entry !== name);
    return {
      name,
      aliases: aliases.length > 0 ? aliases : undefined
    };
  }

  return {
    name: explicitName && explicitName.length > 0 ? explicitName : undefined,
    aliases: explicitAliases.length > 0 ? explicitAliases : undefined
  };
}

function parseMatrixSpacing(raw: string): MatrixSpacingSpec {
  const normalized = normalizeOptionValue(raw);
  const tokens = splitTopLevel(normalized, ",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  let gap = 0;
  let betweenOrigins = false;
  for (const token of tokens) {
    const normalizedToken = normalizeOptionValue(token).toLowerCase();
    if (normalizedToken === "between origins") {
      betweenOrigins = true;
      continue;
    }
    if (normalizedToken === "between borders") {
      betweenOrigins = false;
      continue;
    }
    const parsed = parseLength(token, "pt");
    if (parsed != null) {
      gap += parsed;
    }
  }

  return { gap, betweenOrigins };
}

function stripMatrixSpecificOptions(options: OptionListAst | undefined): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }
  const filteredEntries = options.entries.filter((entry) => {
    if (entry.kind === "flag") {
      return !MATRIX_FLAG_KEYS.has(entry.key);
    }
    if (entry.kind === "kv") {
      return !MATRIX_KEY_VALUE_KEYS.has(entry.key);
    }
    return true;
  });
  if (filteredEntries.length === options.entries.length) {
    return options;
  }
  if (filteredEntries.length === 0) {
    return undefined;
  }
  return {
    ...options,
    entries: filteredEntries
  };
}

function collectMatrixEveryNodeOptions(options: OptionListAst | undefined): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }
  const lists: OptionListAst[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key !== "every node/.style" && entry.key !== "every node/.append style") {
      continue;
    }
    const parsed = parseStyleValueAsOptionList(entry.valueRaw);
    if (parsed) {
      lists.push(parsed);
    }
  }
  return mergeOptionLists(lists);
}

function mergeOptionLists(lists: Array<OptionListAst | undefined>): OptionListAst | undefined {
  const present = lists.filter((list): list is OptionListAst => Boolean(list));
  if (present.length === 0) {
    return undefined;
  }

  const spanFrom = present.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = present.reduce((max, list) => Math.max(max, list.span.to), 0);
  return {
    span: {
      from: Number.isFinite(spanFrom) ? spanFrom : 0,
      to: spanTo
    },
    raw: present.map((list) => list.raw).join(", "),
    entries: present.flatMap((list) => list.entries)
  };
}

function extractNodeNameFromOptions(options: OptionListAst | undefined): string | undefined {
  if (!options) {
    return undefined;
  }
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "name") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

function extractNodeAliasesFromOptions(options: OptionListAst | undefined): string[] {
  if (!options) {
    return [];
  }

  const aliases: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "alias") {
      continue;
    }
    const parsed = normalizeNodeName(entry.valueRaw);
    if (parsed) {
      aliases.push(parsed);
    }
  }
  return dedupeNames(aliases);
}

function normalizeNodeName(raw: string): string | undefined {
  let normalized = normalizeOptionValue(raw).trim();
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.length > 0 ? normalized : undefined;
}

function computeAxisCenters(sizes: number[], gaps: number[], betweenOrigins: boolean, direction: 1 | -1): number[] {
  if (sizes.length === 0) {
    return [];
  }

  const centers = Array.from<number>({ length: sizes.length }).fill(0);
  if (!betweenOrigins) {
    centers[0] = direction * (sizes[0] / 2);
  }

  for (let index = 1; index < sizes.length; index += 1) {
    if (betweenOrigins) {
      centers[index] = centers[index - 1] + direction * (gaps[index - 1] ?? 0);
      continue;
    }
    centers[index] =
      centers[index - 1] +
      direction * (sizes[index - 1] / 2 + (gaps[index - 1] ?? 0) + sizes[index] / 2);
  }

  return centers;
}

function computeWorldBoundsFromCenters(centers: number[], sizes: number[]): { min: number; max: number } {
  if (centers.length === 0 || sizes.length === 0) {
    return { min: 0, max: 1 };
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < centers.length; index += 1) {
    const half = (sizes[index] ?? 0) / 2;
    min = Math.min(min, centers[index] - half);
    max = Math.max(max, centers[index] + half);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { min: 0, max: 1 };
  }
  return { min, max };
}

function makeMatrixLayout(width: number, height: number): NodeLayout {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return {
    textLines: [""],
    textBlockWidth: 0,
    textBlockHeight: 0,
    textRenderInfo: { mode: "plain" },
    naturalWidth: safeWidth,
    naturalHeight: safeHeight,
    minimumWidth: safeWidth,
    minimumHeight: safeHeight,
    lineWidth: 0,
    outerXSep: 0,
    outerYSep: 0,
    visualWidth: safeWidth,
    visualHeight: safeHeight,
    visualRadius: Math.max(safeWidth, safeHeight) / 2,
    anchorHalfWidth: safeWidth / 2,
    anchorHalfHeight: safeHeight / 2,
    anchorRadius: Math.max(safeWidth, safeHeight) / 2,
    baseLineY: 0,
    midLineY: 0
  };
}

function parseBoolish(raw: string): boolean | null {
  return parseBooleanishNormalized(raw, { allowOnOff: true });
}

function dedupeNames(names: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return deduped;
}

function matchMatrixCellSeparator(input: string, cursor: number, separator: string): number {
  if (separator.length === 0) {
    return 0;
  }

  if (separator === "&") {
    if (input[cursor] === "&" && input[cursor - 1] !== "\\") {
      return 1;
    }
    return 0;
  }

  return input.startsWith(separator, cursor) ? separator.length : 0;
}

function findMatrixPipeClosing(input: string): number {
  for (let index = 1; index < input.length; index += 1) {
    if (input[index] === "|" && input[index - 1] !== "\\") {
      return index;
    }
  }
  return -1;
}

function resolveLeadingMatrixCellOptionSpan(rawCell: string, baseOffset: number): Span | undefined {
  const trimmed = trimOuterWhitespaceWorldBounds(rawCell, 0, rawCell.length);
  if (trimmed.from >= trimmed.to || rawCell[trimmed.from] !== "|") {
    return undefined;
  }

  const firstPipeClose = findMatrixPipeClosing(rawCell.slice(trimmed.from));
  if (firstPipeClose <= 0) {
    return undefined;
  }

  const absoluteClose = trimmed.from + firstPipeClose;
  const payloadRaw = rawCell.slice(trimmed.from + 1, absoluteClose);
  const payloadTrimStart = trimLeftWhitespaceBoundary(payloadRaw, 0, payloadRaw.length);
  const payloadTrimEnd = trimRightWhitespaceBoundary(payloadRaw, payloadRaw.length, payloadTrimStart);
  const trimmedPayload = payloadRaw.slice(payloadTrimStart, payloadTrimEnd);
  if (!trimmedPayload.startsWith("[") || !trimmedPayload.endsWith("]")) {
    return undefined;
  }

  const optionBlock = readBalancedBlock(trimmedPayload, 0, "[", "]");
  if (optionBlock?.nextIndex !== trimmedPayload.length) {
    return undefined;
  }

  const openBracketOffset = rawCell.indexOf("[", trimmed.from + 1);
  if (openBracketOffset < 0 || openBracketOffset > absoluteClose) {
    return undefined;
  }

  return {
    from: baseOffset + openBracketOffset,
    to: baseOffset + openBracketOffset + optionBlock.nextIndex
  };
}

function trimOuterWhitespaceWorldBounds(input: string, from: number, to: number): { from: number; to: number } {
  const left = trimLeftWhitespaceBoundary(input, from, to);
  const right = trimRightWhitespaceBoundary(input, to, left);
  return {
    from: left,
    to: right
  };
}

function trimLeadingWhitespace(input: string): { text: string; consumed: number } {
  let consumed = 0;
  while (consumed < input.length && /\s/u.test(input[consumed] ?? "")) {
    consumed += 1;
  }
  return {
    text: input.slice(consumed),
    consumed
  };
}

function containsIncludeGraphicsCommand(text: string): boolean {
  return /\\includegraphics\b/.test(text);
}

function trimLeftWhitespaceBoundary(input: string, from: number, to: number): number {
  let cursor = from;
  while (cursor < to && /\s/u.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function trimRightWhitespaceBoundary(input: string, to: number, min = 0): number {
  let cursor = to;
  while (cursor > min && /\s/u.test(input[cursor - 1] ?? "")) {
    cursor -= 1;
  }
  return cursor;
}

function skipWhitespace(input: string, start: number): number {
  let cursor = start;
  while (cursor < input.length && /\s/u.test(input[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}
