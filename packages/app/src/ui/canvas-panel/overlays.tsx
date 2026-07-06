import { Fragment, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import type { EditHandle, NodeAnchorTarget } from "tikz-editor/semantic/types";
import type { WorldPoint } from "../coords/types";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type { SnapLine } from "tikz-editor/edit/snapping";
import type { SvgViewBox } from "tikz-editor/svg/types";
import type { ToolMode } from "../../store/types";
import type { HitRegion } from "./hit-regions";
import type { CurveControlLine } from "./curve-controls";
import type {
  AdornmentConnectorDisplay,
  AdornmentHighlightBox,
  HandleDisplay,
  NodeAnchorOverlayState,
  NodePositionLinkDisplay,
  SelectionBoxDisplay
} from "./types";
import { fmt, worldToSvgPoint } from "./geometry";
import css from "./CanvasPanel.module.css";

const SNAP_GAP_ARROW_MARKER_ID = "snap-gap-arrow-marker";
const TOOL_PREVIEW_NODE_RADIUS_PX = 12;
const ROTATE_GLYPH_PATH_1 = "M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z";
const ROTATE_GLYPH_PATH_2 = "M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466";

export type ToolPreview =
  | { kind: "cursor"; x: number; y: number }
  | { kind: "node"; x: number; y: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; arrow: boolean }
  | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
  | {
      kind: "complex-path";
      startX: number;
      startY: number;
      closeCandidate: boolean;
      canClose: boolean;
      segments: Array<
        | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
        | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
      >;
    }
  | {
      kind: "freehand";
      segments: Array<
        | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
        | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
      >;
    }
  | { kind: "grid"; x: number; y: number; width: number; height: number; verticalLines: number[]; horizontalLines: number[] }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "path"; d: string };

const PT_PER_CM = 28.4527559055;
const SNAP_GAP_LABEL_FONT_PX = 9;
const SNAP_GAP_LABEL_HEIGHT_PX = 13;
const SNAP_GAP_LABEL_CHAR_PX = 5.4;
const SNAP_GAP_LABEL_PADDING_PX = 6;

function formatGapDistanceCm(distancePt: number): string {
  return Number((distancePt / PT_PER_CM).toFixed(2)).toString();
}

function SnapLabelPill({
  x,
  y,
  text,
  worldPerPx
}: {
  x: number;
  y: number;
  text: string;
  worldPerPx: number;
}) {
  const width = (text.length * SNAP_GAP_LABEL_CHAR_PX + SNAP_GAP_LABEL_PADDING_PX) * worldPerPx;
  const height = SNAP_GAP_LABEL_HEIGHT_PX * worldPerPx;
  return (
    <g>
      <rect
        x={x - width / 2}
        y={y - height / 2}
        width={width}
        height={height}
        rx={2 * worldPerPx}
        className={css.snapGapLabelRect}
      />
      <text
        x={x}
        y={y}
        className={css.snapGapLabelText}
        fontSize={SNAP_GAP_LABEL_FONT_PX * worldPerPx}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </g>
  );
}

function snapNameLabel(
  sourceIds: readonly string[] | undefined,
  sourceNames: ReadonlyMap<string, string> | undefined,
  role?: "corner" | "center"
): string | null {
  if (sourceIds?.length !== 1 || !sourceNames) {
    return null;
  }
  const name = sourceNames.get(sourceIds[0]);
  if (!name) {
    return null;
  }
  if (!role) {
    return name;
  }
  return `${role === "center" ? "center" : "edge"} · ${name}`;
}

export function SnapOverlay({
  snapLines,
  sourceNames,
  viewBox,
  scale,
  snapStrokeWidth,
  snapCrossSize
}: {
  snapLines: readonly SnapLine[];
  sourceNames?: ReadonlyMap<string, string>;
  viewBox: SvgViewBox;
  scale: number;
  snapStrokeWidth: number;
  snapCrossSize: number;
}) {
  if (snapLines.length === 0) {
    return null;
  }

  const worldPerPx = 1 / Math.max(scale, 1e-3);

  return (
    <g className={css.snapOverlay}>
      <defs>
        <marker
          id={SNAP_GAP_ARROW_MARKER_ID}
          markerWidth={6}
          markerHeight={6}
          refX={10}
          refY={5}
          orient="auto-start-reverse"
          viewBox="0 0 10 10"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className={css.snapGapArrowHead} />
        </marker>
      </defs>
      {snapLines.map((line, index) => {
        if (line.type === "points") {
          const points = line.points.map((point) => worldToSvgPoint(point, viewBox));
          const first = points[0];
          const last = points[points.length - 1];
          const lineClass =
            line.role === "center" ? `${css.snapLine} ${css.snapCenterLine}` : css.snapLine;
          const label = snapNameLabel(line.sourceIds, sourceNames, line.role);
          let labelPosition: { x: number; y: number } | null = null;
          if (label && first && last) {
            const dx = last.x - first.x;
            const dy = last.y - first.y;
            const length = Math.hypot(dx, dy);
            const ux = length > 1e-6 ? dx / length : 1;
            const uy = length > 1e-6 ? dy / length : 0;
            const labelWidth = (label.length * SNAP_GAP_LABEL_CHAR_PX + SNAP_GAP_LABEL_PADDING_PX) * worldPerPx;
            const halfAlong =
              Math.abs(ux) > Math.abs(uy) ? labelWidth / 2 : (SNAP_GAP_LABEL_HEIGHT_PX * worldPerPx) / 2;
            const offset = 10 * worldPerPx + halfAlong;
            labelPosition = { x: last.x + ux * offset, y: last.y + uy * offset };
          }
          return (
            <g key={`snap-points-${index}`}>
              {first && last && points.length > 1 && (
                <line
                  x1={first.x}
                  y1={first.y}
                  x2={last.x}
                  y2={last.y}
                  className={lineClass}
                  strokeWidth={snapStrokeWidth}
                />
              )}
              {label && labelPosition && (
                <SnapLabelPill
                  x={labelPosition.x}
                  y={labelPosition.y}
                  text={label}
                  worldPerPx={worldPerPx}
                />
              )}
              {points.map((point, pointIndex) => (
                <g key={`snap-point-${index}-${pointIndex}`}>
                  <line
                    x1={point.x - snapCrossSize}
                    y1={point.y - snapCrossSize}
                    x2={point.x + snapCrossSize}
                    y2={point.y + snapCrossSize}
                    className={css.snapLine}
                    strokeWidth={snapStrokeWidth}
                  />
                  <line
                    x1={point.x - snapCrossSize}
                    y1={point.y + snapCrossSize}
                    x2={point.x + snapCrossSize}
                    y2={point.y - snapCrossSize}
                    className={css.snapLine}
                    strokeWidth={snapStrokeWidth}
                  />
                </g>
              ))}
            </g>
          );
        }

        if (line.type === "pointer") {
          const from = worldToSvgPoint(line.from, viewBox);
          const to = worldToSvgPoint(line.to, viewBox);
          const label = snapNameLabel(line.sourceIds, sourceNames);
          let labelPosition: { x: number; y: number } | null = null;
          if (label) {
            const dx = from.x - to.x;
            const dy = from.y - to.y;
            const length = Math.hypot(dx, dy);
            const ux = length > 1e-6 ? dx / length : 1;
            const uy = length > 1e-6 ? dy / length : 0;
            const labelWidth = (label.length * SNAP_GAP_LABEL_CHAR_PX + SNAP_GAP_LABEL_PADDING_PX) * worldPerPx;
            const halfAlong =
              Math.abs(ux) > Math.abs(uy) ? labelWidth / 2 : (SNAP_GAP_LABEL_HEIGHT_PX * worldPerPx) / 2;
            const offset = 10 * worldPerPx + halfAlong;
            labelPosition = { x: from.x + ux * offset, y: from.y + uy * offset };
          }
          return (
            <g key={`snap-pointer-${index}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={css.snapLine}
                strokeWidth={snapStrokeWidth}
              />
              {label && labelPosition && (
                <SnapLabelPill
                  x={labelPosition.x}
                  y={labelPosition.y}
                  text={label}
                  worldPerPx={worldPerPx}
                />
              )}
              <line
                x1={from.x - snapCrossSize}
                y1={from.y - snapCrossSize}
                x2={from.x + snapCrossSize}
                y2={from.y + snapCrossSize}
                className={css.snapLine}
                strokeWidth={snapStrokeWidth}
              />
              <line
                x1={from.x - snapCrossSize}
                y1={from.y + snapCrossSize}
                x2={from.x + snapCrossSize}
                y2={from.y - snapCrossSize}
                className={css.snapLine}
                strokeWidth={snapStrokeWidth}
              />
            </g>
          );
        }

        return (
          <g key={`snap-gap-${index}`}>
            {line.segments.map((segment, segmentIndex) => {
              const a = worldToSvgPoint(segment[0], viewBox);
              const b = worldToSvgPoint(segment[1], viewBox);
              const isEqualGap = line.gapKind === "equal";
              const distancePt =
                line.direction === "horizontal"
                  ? Math.abs(segment[1].x - segment[0].x)
                  : Math.abs(segment[1].y - segment[0].y);
              const label = formatGapDistanceCm(distancePt);
              const labelWidth =
                (label.length * SNAP_GAP_LABEL_CHAR_PX + SNAP_GAP_LABEL_PADDING_PX) * worldPerPx;
              const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
              const showLabel = segmentLength > labelWidth * 1.3;
              const midX = (a.x + b.x) / 2;
              const midY = (a.y + b.y) / 2;
              return (
                <g key={`snap-gap-segment-${index}-${segmentIndex}`}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    className={`${css.snapLine} ${css.snapGapLine}`}
                    strokeWidth={snapStrokeWidth}
                    markerStart={isEqualGap ? `url(#${SNAP_GAP_ARROW_MARKER_ID})` : undefined}
                    markerEnd={isEqualGap ? `url(#${SNAP_GAP_ARROW_MARKER_ID})` : undefined}
                  />
                  {showLabel && (
                    <SnapLabelPill x={midX} y={midY} text={label} worldPerPx={worldPerPx} />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export function ToolPreviewOverlay({
  toolPreview,
  scale,
  handleStrokeWidth,
  previewArrowPoints
}: {
  toolPreview: ToolPreview | null;
  scale: number;
  handleStrokeWidth: number;
  previewArrowPoints: (x1: number, y1: number, x2: number, y2: number, size: number) => string;
}) {
  if (!toolPreview) {
    return null;
  }

  return (
    <g className={css.toolPreview}>
      {toolPreview.kind === "cursor" && (
        <g>
          <line
            x1={toolPreview.x - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y1={toolPreview.y}
            x2={toolPreview.x + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y2={toolPreview.y}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x}
            y1={toolPreview.y - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            x2={toolPreview.x}
            y2={toolPreview.y + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
        </g>
      )}
      {toolPreview.kind === "node" && (
        <g>
          <circle
            cx={toolPreview.x}
            cy={toolPreview.y}
            r={TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            className={css.toolPreviewFill}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y1={toolPreview.y}
            x2={toolPreview.x + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y2={toolPreview.y}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x}
            y1={toolPreview.y - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            x2={toolPreview.x}
            y2={toolPreview.y + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
        </g>
      )}
      {toolPreview.kind === "line" && (
        <g>
          <line
            x1={toolPreview.x1}
            y1={toolPreview.y1}
            x2={toolPreview.x2}
            y2={toolPreview.y2}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
          {toolPreview.arrow && (
            <polygon
              points={previewArrowPoints(
                toolPreview.x1,
                toolPreview.y1,
                toolPreview.x2,
                toolPreview.y2,
                10 / Math.max(scale, 1e-3)
              )}
              className={css.toolPreviewStroke}
            />
          )}
        </g>
      )}
      {toolPreview.kind === "bezier" && (
        <g>
          <line
            x1={toolPreview.x1}
            y1={toolPreview.y1}
            x2={toolPreview.c1x}
            y2={toolPreview.c1y}
            className={css.curveControlLine}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x2}
            y1={toolPreview.y2}
            x2={toolPreview.c2x}
            y2={toolPreview.c2y}
            className={css.curveControlLine}
            strokeWidth={handleStrokeWidth}
          />
          <path
            d={`M ${fmt(toolPreview.x1)},${fmt(toolPreview.y1)} C ${fmt(toolPreview.c1x)},${fmt(toolPreview.c1y)} ${fmt(toolPreview.c2x)},${fmt(toolPreview.c2y)} ${fmt(toolPreview.x2)},${fmt(toolPreview.y2)}`}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
        </g>
      )}
      {toolPreview.kind === "complex-path" && (
        <g>
          {toolPreview.segments.map((segment, index) =>
            segment.kind === "line" ? (
              <line
                key={`complex-line-${index}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                className={css.toolPreviewStroke}
                strokeWidth={handleStrokeWidth}
              />
            ) : (
              <g key={`complex-bezier-${index}`}>
                <line
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.c1x}
                  y2={segment.c1y}
                  className={css.curveControlLine}
                  strokeWidth={handleStrokeWidth}
                />
                <line
                  x1={segment.x2}
                  y1={segment.y2}
                  x2={segment.c2x}
                  y2={segment.c2y}
                  className={css.curveControlLine}
                  strokeWidth={handleStrokeWidth}
                />
                <path
                  d={`M ${fmt(segment.x1)},${fmt(segment.y1)} C ${fmt(segment.c1x)},${fmt(segment.c1y)} ${fmt(segment.c2x)},${fmt(segment.c2y)} ${fmt(segment.x2)},${fmt(segment.y2)}`}
                  className={css.toolPreviewStroke}
                  strokeWidth={handleStrokeWidth}
                />
              </g>
            )
          )}
          <circle
            cx={toolPreview.startX}
            cy={toolPreview.startY}
            r={toolPreview.canClose ? 5 / Math.max(scale, 1e-3) : 3.5 / Math.max(scale, 1e-3)}
            className={toolPreview.closeCandidate ? css.toolPreviewFill : css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
        </g>
      )}
      {toolPreview.kind === "freehand" && (
        <g>
          {toolPreview.segments.map((segment, index) =>
            segment.kind === "line" ? (
              <line
                key={`freehand-line-${index}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                className={css.toolPreviewStroke}
                strokeWidth={handleStrokeWidth}
              />
            ) : (
              <path
                key={`freehand-bezier-${index}`}
                d={`M ${fmt(segment.x1)},${fmt(segment.y1)} C ${fmt(segment.c1x)},${fmt(segment.c1y)} ${fmt(segment.c2x)},${fmt(segment.c2y)} ${fmt(segment.x2)},${fmt(segment.y2)}`}
                className={css.toolPreviewStroke}
                strokeWidth={handleStrokeWidth}
              />
            )
          )}
        </g>
      )}
      {toolPreview.kind === "grid" && (
        <g>
          <rect
            x={toolPreview.x}
            y={toolPreview.y}
            width={toolPreview.width}
            height={toolPreview.height}
            className={css.toolPreviewFill}
            strokeWidth={handleStrokeWidth}
          />
          {toolPreview.verticalLines.map((x, index) => (
            <line
              key={`grid-v-${index}`}
              x1={x}
              y1={toolPreview.y}
              x2={x}
              y2={toolPreview.y + toolPreview.height}
              className={css.toolPreviewStroke}
              strokeWidth={handleStrokeWidth}
            />
          ))}
          {toolPreview.horizontalLines.map((y, index) => (
            <line
              key={`grid-h-${index}`}
              x1={toolPreview.x}
              y1={y}
              x2={toolPreview.x + toolPreview.width}
              y2={y}
              className={css.toolPreviewStroke}
              strokeWidth={handleStrokeWidth}
            />
          ))}
        </g>
      )}
      {toolPreview.kind === "rect" && (
        <rect
          x={toolPreview.x}
          y={toolPreview.y}
          width={toolPreview.width}
          height={toolPreview.height}
          className={css.toolPreviewFill}
          strokeWidth={handleStrokeWidth}
        />
      )}
      {toolPreview.kind === "ellipse" && (
        <ellipse
          cx={toolPreview.cx}
          cy={toolPreview.cy}
          rx={toolPreview.rx}
          ry={toolPreview.ry}
          className={css.toolPreviewFill}
          strokeWidth={handleStrokeWidth}
        />
      )}
      {toolPreview.kind === "circle" && (
        <circle
          cx={toolPreview.cx}
          cy={toolPreview.cy}
          r={toolPreview.r}
          className={css.toolPreviewFill}
          strokeWidth={handleStrokeWidth}
        />
      )}
      {toolPreview.kind === "path" && (
        <path
          d={toolPreview.d}
          data-testid="canvas-tool-preview-path"
          className={css.toolPreviewFill}
          strokeWidth={handleStrokeWidth}
        />
      )}
    </g>
  );
}

export function CurveControlOverlay({
  lines,
  viewBox,
  strokeWidth
}: {
  lines: readonly CurveControlLine[];
  viewBox: SvgViewBox;
  strokeWidth: number;
}) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <g className={css.curveControlOverlay}>
      {lines.map((line) => {
        const from = worldToSvgPoint(line.from, viewBox);
        const to = worldToSvgPoint(line.to, viewBox);
        return (
          <line
            key={line.key}
            className={css.curveControlLine}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            strokeWidth={strokeWidth}
          />
        );
      })}
    </g>
  );
}

export function NodePositionLinkOverlay({
  links,
  viewBox
}: {
  links: readonly NodePositionLinkDisplay[];
  viewBox: SvgViewBox;
}) {
  if (links.length === 0) {
    return null;
  }

  return (
    <g className={css.nodePositionLinkOverlay}>
      {links.map((link) => {
        const from = worldToSvgPoint(link.from, viewBox);
        const to = worldToSvgPoint(link.to, viewBox);
        return (
          <line
            key={link.key}
            className={css.nodePositionLinkLine}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            data-testid="node-position-link"
            data-node-position-link-source-id={link.sourceId}
            data-node-position-link-target-source-id={link.targetSourceId}
          />
        );
      })}
    </g>
  );
}

export function HitRegionLayer({
  hitRegions,
  hoveredElementId,
  toolMode,
  editableTextRegionKeys,
  draggableSourceIds,
  onElementPointerDown,
  onElementContextMenu,
  onElementDoubleClick,
  onHoverChange,
  cursorByTargetId
}: {
  hitRegions: readonly HitRegion[];
  hoveredElementId: string | null;
  toolMode: ToolMode;
  editableTextRegionKeys: ReadonlySet<string>;
  draggableSourceIds: ReadonlySet<string>;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, targetId: string, region?: HitRegion) => void;
  onElementContextMenu: (event: ReactMouseEvent<SVGElement>, targetId: string, region?: HitRegion) => void;
  onElementDoubleClick: (event: ReactMouseEvent<SVGElement>, targetId: string, region?: HitRegion) => void;
  onHoverChange: (targetId: string | null) => void;
  cursorByTargetId?: ReadonlyMap<string, string>;
}) {
  const clipSvgIdBySceneId = new Map<string, string>();
  const clipDefs: Array<{ sceneId: string; svgId: string; d: string; fillRule: "nonzero" | "evenodd" }> = [];
  for (const region of hitRegions) {
    for (const clipPath of region.clipChain ?? []) {
      if (clipSvgIdBySceneId.has(clipPath.id)) {
        continue;
      }
      const svgId = `canvas-hit-clip-${clipDefs.length + 1}`;
      clipSvgIdBySceneId.set(clipPath.id, svgId);
      clipDefs.push({
        sceneId: clipPath.id,
        svgId,
        d: clipPath.d,
        fillRule: clipPath.fillRule
      });
    }
  }

  const wrapWithClipChain = (region: HitRegion, content: ReactElement): ReactElement => {
    let wrapped = content;
    for (const clipPath of region.clipChain ?? []) {
      const svgId = clipSvgIdBySceneId.get(clipPath.id);
      if (!svgId) {
        continue;
      }
      wrapped = <g clipPath={`url(#${svgId})`}>{wrapped}</g>;
    }
    return wrapped;
  };

  return (
    <g className={css.hitRegions}>
      {clipDefs.length > 0 ? (
        <defs>
          {clipDefs.map((clipPath) => (
            <clipPath key={clipPath.sceneId} id={clipPath.svgId} clipPathUnits="userSpaceOnUse">
              <path d={clipPath.d} clipRule={clipPath.fillRule === "evenodd" ? "evenodd" : undefined} />
            </clipPath>
          ))}
        </defs>
      ) : null}
      {hitRegions.map((region) => {
        const isHovered = hoveredElementId === (toolMode === "addBucket" ? region.sourceId : region.targetId);
        const cursorOverride = cursorByTargetId?.get(region.targetId);
        const cursor =
          cursorByTargetId
            ? cursorOverride ?? "default"
          : toolMode === "select"
            ? region.shape === "rect" && region.matrixEdgeSelection
              ? region.matrixEdgeSelection.cursor
              : region.shape === "rect" && region.interactionMode === "move"
              ? "move"
              : editableTextRegionKeys.has(region.key)
              ? "text"
              : draggableSourceIds.has(region.targetId)
                ? "move"
                : undefined
            : toolMode === "addBucket"
              ? isBucketPreviewRegion(region)
                ? "copy"
                : undefined
            : undefined;
        const className = [css.hitRegion, isHovered ? css.hitRegionHovered : ""].filter(Boolean).join(" ");
        const bucketUsesFillHitArea = toolMode === "addBucket" && shouldUseBucketFillHitArea(region);
        const pointerEvents =
          toolMode === "select"
            ? region.pointerMode === "stroke"
              ? "stroke"
              : region.shape === "rect"
                ? "all"
                : "fill"
            : toolMode === "addBucket"
              ? bucketUsesFillHitArea
                ? region.shape === "rect"
                  ? "all"
                  : "fill"
                : region.pointerMode === "stroke"
                ? "stroke"
                : region.shape === "rect"
                  ? "all"
                  : "fill"
              : "none";

        const onEnter = () => {
          if (toolMode === "select") {
            onHoverChange(region.targetId);
            return;
          }
          if (toolMode === "addBucket") {
            onHoverChange(isBucketPreviewRegion(region) ? region.sourceId : null);
          }
        };
        const onLeave = () => {
          if (toolMode === "select" || toolMode === "addBucket") onHoverChange(null);
        };

        if (region.shape === "path") {
          const transform = region.transform
            ? `matrix(${fmt(region.transform.a)} ${fmt(region.transform.b)} ${fmt(region.transform.c)} ${fmt(region.transform.d)} ${fmt(region.transform.e)} ${fmt(region.transform.f)})`
            : undefined;
          return (
            <Fragment key={region.key}>
              {wrapWithClipChain(region, (
            <path
              className={className}
              d={region.d}
              transform={transform}
              fill={bucketUsesFillHitArea || region.pointerMode === "fill" ? "transparent" : "none"}
              stroke={region.pointerMode === "stroke" ? "transparent" : "none"}
              strokeWidth={region.pointerMode === "stroke" ? region.strokeWidth : undefined}
              style={cursor ? { cursor } : undefined}
              pointerEvents={pointerEvents}
              onPointerDown={(event) => { onElementPointerDown(event, region.targetId, region); }}
              onContextMenu={(event) => { onElementContextMenu(event, region.targetId, region); }}
              onDoubleClick={(event) => { onElementDoubleClick(event, region.targetId, region); }}
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
              data-hit-region-target-id={region.targetId}
              data-hit-region-key={region.key}
            />
              ))}
            </Fragment>
          );
        }

        if (region.shape === "circle") {
          return (
            <Fragment key={region.key}>
              {wrapWithClipChain(region, (
            <circle
              className={className}
              cx={region.cx}
              cy={region.cy}
              r={region.r}
              fill={bucketUsesFillHitArea || region.pointerMode === "fill" ? "transparent" : "none"}
              stroke={region.pointerMode === "stroke" ? "transparent" : "none"}
              strokeWidth={region.pointerMode === "stroke" ? region.strokeWidth : undefined}
              style={cursor ? { cursor } : undefined}
              pointerEvents={pointerEvents}
              onPointerDown={(event) => { onElementPointerDown(event, region.targetId, region); }}
              onContextMenu={(event) => { onElementContextMenu(event, region.targetId, region); }}
              onDoubleClick={(event) => { onElementDoubleClick(event, region.targetId, region); }}
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
              data-hit-region-target-id={region.targetId}
              data-hit-region-key={region.key}
            />
              ))}
            </Fragment>
          );
        }

        if (region.shape === "ellipse") {
          const transform =
            Math.abs(region.rotation) > 1e-6
              ? `rotate(${fmt(-region.rotation)} ${fmt(region.cx)} ${fmt(region.cy)})`
              : undefined;
          return (
            <Fragment key={region.key}>
              {wrapWithClipChain(region, (
            <ellipse
              className={className}
              cx={region.cx}
              cy={region.cy}
              rx={region.rx}
              ry={region.ry}
              transform={transform}
              fill={bucketUsesFillHitArea || region.pointerMode === "fill" ? "transparent" : "none"}
              stroke={region.pointerMode === "stroke" ? "transparent" : "none"}
              strokeWidth={region.pointerMode === "stroke" ? region.strokeWidth : undefined}
              style={cursor ? { cursor } : undefined}
              pointerEvents={pointerEvents}
              onPointerDown={(event) => { onElementPointerDown(event, region.targetId, region); }}
              onContextMenu={(event) => { onElementContextMenu(event, region.targetId, region); }}
              onDoubleClick={(event) => { onElementDoubleClick(event, region.targetId, region); }}
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
              data-hit-region-target-id={region.targetId}
              data-hit-region-key={region.key}
            />
              ))}
            </Fragment>
          );
        }

        const rectTransform = region.transform
          ? `matrix(${fmt(region.transform.a)} ${fmt(region.transform.b)} ${fmt(region.transform.c)} ${fmt(region.transform.d)} ${fmt(region.transform.e)} ${fmt(region.transform.f)})`
          : Math.abs(region.rotation) > 1e-6
            ? `rotate(${fmt(-region.rotation)} ${fmt(region.cx)} ${fmt(region.cy)})`
            : undefined;
        return (
          <Fragment key={region.key}>
            {wrapWithClipChain(region, (
              <rect
                className={className}
                x={region.x}
                y={region.y}
                width={region.width}
                height={region.height}
                transform={rectTransform}
                fill={region.pointerMode === "stroke" ? "none" : "transparent"}
                stroke={region.pointerMode === "stroke" ? "transparent" : "none"}
                strokeWidth={region.pointerMode === "stroke" ? region.strokeWidth : undefined}
                style={cursor ? { cursor } : undefined}
                pointerEvents={pointerEvents}
                onPointerDown={(event) => { onElementPointerDown(event, region.targetId, region); }}
                onContextMenu={(event) => { onElementContextMenu(event, region.targetId, region); }}
                onDoubleClick={(event) => { onElementDoubleClick(event, region.targetId, region); }}
                onPointerEnter={onEnter}
                onPointerLeave={onLeave}
                data-hit-region-target-id={region.targetId}
                data-hit-region-key={region.key}
                data-hit-region-interaction-mode={region.interactionMode}
                data-hit-region-matrix-edge-kind={region.matrixEdgeSelection?.kind}
                data-hit-region-matrix-source-id={region.matrixEdgeSelection?.matrixSourceId}
              />
            ))}
          </Fragment>
        );
      })}
    </g>
  );
}

function isBucketPreviewRegion(region: HitRegion): boolean {
  return region.shape !== "rect";
}

function shouldUseBucketFillHitArea(region: HitRegion): boolean {
  return region.shape !== "rect";
}

export function SelectionOverlay({
  marqueeBounds,
  selectionBoxes,
  adornmentHighlightBoxes,
  adornmentConnectors,
  selectionStrokeWidth
}: {
  marqueeBounds: AdornmentHighlightBox["bounds"] | null;
  selectionBoxes: ReadonlyArray<SelectionBoxDisplay>;
  adornmentHighlightBoxes: ReadonlyArray<AdornmentHighlightBox>;
  adornmentConnectors: ReadonlyArray<AdornmentConnectorDisplay>;
  selectionStrokeWidth: number;
}) {
  return (
    <>
      <g className={css.selectionOverlay}>
        {adornmentHighlightBoxes.map((bounds) => (
          <rect
            key={bounds.key}
            className={css.adornmentSelectionRect}
            x={bounds.bounds.minX}
            y={bounds.bounds.minY}
            width={Math.max(0.001, bounds.bounds.maxX - bounds.bounds.minX)}
            height={Math.max(0.001, bounds.bounds.maxY - bounds.bounds.minY)}
            strokeWidth={selectionStrokeWidth}
          />
        ))}
        {selectionBoxes.map((bounds) =>
          bounds.kind === "polygon" ? (
            <polygon
              key={bounds.key}
              className={
                bounds.isAdornment
                  ? css.adornmentSelectionRect
                  : [css.selectionRect, bounds.dashed ? css.selectionRectDashed : ""].filter(Boolean).join(" ")
              }
              points={bounds.points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ")}
              strokeWidth={selectionStrokeWidth}
              data-selection-overlay-box-source-id={bounds.sourceId}
            />
          ) : (
            <rect
              key={bounds.key}
              className={
                bounds.isAdornment
                  ? css.adornmentSelectionRect
                  : [css.selectionRect, bounds.dashed ? css.selectionRectDashed : ""].filter(Boolean).join(" ")
              }
              x={bounds.bounds.minX}
              y={bounds.bounds.minY}
              width={Math.max(0.001, bounds.bounds.maxX - bounds.bounds.minX)}
              height={Math.max(0.001, bounds.bounds.maxY - bounds.bounds.minY)}
              strokeWidth={selectionStrokeWidth}
              data-selection-overlay-box-source-id={bounds.sourceId}
            />
          )
        )}
        {adornmentConnectors.map((connector) => (
          <line
            key={connector.key}
            className={
              connector.kind === "pin" ? css.pinSelectionConnector : css.labelSelectionConnector
            }
            x1={connector.from.x}
            y1={connector.from.y}
            x2={connector.to.x}
            y2={connector.to.y}
            strokeWidth={selectionStrokeWidth}
          />
        ))}
        {marqueeBounds && (
          <rect
            className={css.marqueeRect}
            x={marqueeBounds.minX}
            y={marqueeBounds.minY}
            width={Math.max(0.001, marqueeBounds.maxX - marqueeBounds.minX)}
            height={Math.max(0.001, marqueeBounds.maxY - marqueeBounds.minY)}
            strokeWidth={selectionStrokeWidth}
          />
        )}
      </g>
    </>
  );
}

export function SelectionDragLayer({
  toolMode,
  selectionBoxes,
  dragStrokeWidth,
  draggableSourceIds,
  onElementPointerDown,
  onElementContextMenu,
  onElementDoubleClick
}: {
  toolMode: ToolMode;
  selectionBoxes: ReadonlyArray<SelectionBoxDisplay>;
  dragStrokeWidth: number;
  draggableSourceIds: ReadonlySet<string>;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onElementContextMenu: (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onElementDoubleClick: (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
}) {
  if (toolMode !== "select" || selectionBoxes.length === 0) {
    return null;
  }

  return (
    <g className={css.selectionDragLayer}>
      {selectionBoxes.map((bounds) => {
        if (!draggableSourceIds.has(bounds.sourceId)) {
          return null;
        }
        if (bounds.kind === "polygon") {
          return (
            <polygon
              key={`${bounds.key}:drag`}
              className={css.selectionDragStroke}
              points={bounds.points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ")}
              strokeWidth={dragStrokeWidth}
              onPointerDown={(event) => { onElementPointerDown(event, bounds.sourceId); }}
              onContextMenu={(event) => { onElementContextMenu(event, bounds.sourceId); }}
              onDoubleClick={(event) => { onElementDoubleClick(event, bounds.sourceId); }}
            />
          );
        }

        return (
          <rect
            key={`${bounds.key}:drag`}
            className={css.selectionDragStroke}
            x={bounds.bounds.minX}
            y={bounds.bounds.minY}
            width={Math.max(0.001, bounds.bounds.maxX - bounds.bounds.minX)}
            height={Math.max(0.001, bounds.bounds.maxY - bounds.bounds.minY)}
            strokeWidth={dragStrokeWidth}
            onPointerDown={(event) => { onElementPointerDown(event, bounds.sourceId); }}
            onContextMenu={(event) => { onElementContextMenu(event, bounds.sourceId); }}
            onDoubleClick={(event) => { onElementDoubleClick(event, bounds.sourceId); }}
          />
        );
      })}
    </g>
  );
}

export function HandleOverlay({
  handleDisplays,
  handleHalfSize,
  handleStrokeWidth,
  onHandlePointerDown,
  onElementPointerDown,
  onElementContextMenu,
  onResizeHandlePointerDown,
  onRotateHandlePointerDown
}: {
  handleDisplays: readonly HandleDisplay[];
  handleHalfSize: number;
  handleStrokeWidth: number;
  onHandlePointerDown: (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => void;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onElementContextMenu: (
    event: ReactMouseEvent<SVGElement>,
    sourceId: string,
    region?: HitRegion,
    handleId?: string | null
  ) => void;
  onResizeHandlePointerDown: (
    event: ReactPointerEvent<SVGElement>,
    sourceId: string,
    role: ResizeRole,
    cursor: string
  ) => void;
  onRotateHandlePointerDown: (
    event: ReactPointerEvent<SVGElement>,
    sourceId: string,
    centerWorld: WorldPoint,
    centerPivotWorld: WorldPoint,
    cursor: string
  ) => void;
}) {
  return (
    <g className={css.handleOverlay}>
      {handleDisplays.map((display) => {
        const onPointerDown = (event: ReactPointerEvent<SVGElement>) => {
          if (display.kind === "move-handle") {
            onHandlePointerDown(event, display.handle);
            return;
          }
          if (display.kind === "move-element") {
            onElementPointerDown(event, display.elementId);
            return;
          }
          if (display.kind === "resize-element") {
            onResizeHandlePointerDown(event, display.elementId, display.role, display.cursor);
            return;
          }
          onRotateHandlePointerDown(event, display.elementId, display.centerWorld, display.centerPivotWorld, display.cursor);
        };
        const onContextMenu = (event: ReactMouseEvent<SVGElement>) =>
          { onElementContextMenu(
            event,
            display.kind === "move-handle" ? display.handle.sourceRef.sourceId : display.elementId,
            undefined,
            display.kind === "move-handle" ? display.handle.id : null
          ); };

        if (display.kind === "rotate-element") {
          const rotateCursorClass =
            display.cursor === "not-allowed" ? css.rotateHandleCursorDisabled : css.rotateHandleCursor;
          const rotateRadius = handleHalfSize * 1.3;
          const glyphSize = rotateRadius * 1.4;
          const glyphScale = glyphSize / 16;
          return (
            <g key={display.key}>
              <line
                className={`${css.rotateHandleStem} ${rotateCursorClass}`}
                x1={display.anchor.x}
                y1={display.anchor.y}
                x2={display.point.x}
                y2={display.point.y}
                strokeWidth={handleStrokeWidth}
                onPointerDown={onPointerDown}
                onContextMenu={onContextMenu}
                data-handle-kind="rotate-element-stem"
                data-source-id={display.elementId}
              />
              <circle
                className={`${css.handle} ${css.rotateHandleCircle} ${rotateCursorClass}`}
                cx={display.point.x}
                cy={display.point.y}
                r={rotateRadius}
                strokeWidth={handleStrokeWidth*0.75}
                onPointerDown={onPointerDown}
                onContextMenu={onContextMenu}
                data-testid="canvas-rotate-handle"
                data-handle-kind="rotate-element"
                data-source-id={display.elementId}
              />
              <g
                className={css.rotateHandleGlyph}
                transform={`translate(${fmt(display.point.x)} ${fmt(display.point.y)}) scale(${fmt(glyphScale)}) translate(-8 -8)`}
              >
                <path d={ROTATE_GLYPH_PATH_1} />
                <path d={ROTATE_GLYPH_PATH_2} />
              </g>
            </g>
          );
        }

        if (
          display.kind === "move-handle" &&
          (display.handle.kind === "path-control" || display.handle.kind === "path-bend")
        ) {
          return (
            <circle
              key={display.key}
              className={`${css.handle} ${css.handleControl}`}
              cx={display.point.x}
              cy={display.point.y}
              r={handleHalfSize}
              strokeWidth={handleStrokeWidth}
              style={{ cursor: display.cursor }}
              onPointerDown={onPointerDown}
              onContextMenu={onContextMenu}
              data-handle-kind={display.kind}
              data-source-id={display.handle.sourceRef.sourceId}
            />
          );
        }

        return (
          <rect
            key={display.key}
            className={css.handle}
            x={display.point.x - handleHalfSize}
            y={display.point.y - handleHalfSize}
            width={handleHalfSize * 2}
            height={handleHalfSize * 2}
            strokeWidth={handleStrokeWidth}
            transform={
              display.kind === "resize-element" && Math.abs(display.rotationDeg) > 1e-6
                ? `rotate(${fmt(display.rotationDeg)} ${fmt(display.point.x)} ${fmt(display.point.y)})`
                : undefined
            }
            style={{ cursor: display.cursor }}
            onPointerDown={onPointerDown}
            onContextMenu={onContextMenu}
            data-handle-kind={display.kind}
            data-source-id={display.kind === "move-handle" ? display.handle.sourceRef.sourceId : display.elementId}
            data-resize-role={display.kind === "resize-element" ? display.role : undefined}
          />
        );
      })}
    </g>
  );
}

export function NodeAnchorOverlay({
  anchorOverlay,
  viewBox,
  strokeWidth,
  radius,
  onAnchorPointerDown,
  onAnchorClick,
  onAnchorHoverChange
}: {
  anchorOverlay: NodeAnchorOverlayState | null;
  viewBox: SvgViewBox;
  strokeWidth: number;
  radius: number;
  onAnchorPointerDown?: (event: ReactPointerEvent<SVGCircleElement>, anchor: NodeAnchorTarget) => void;
  onAnchorClick?: (event: ReactMouseEvent<SVGCircleElement>, anchor: NodeAnchorTarget) => void;
  onAnchorHoverChange?: (anchor: NodeAnchorTarget | null) => void;
}) {
  if (!anchorOverlay || anchorOverlay.visibleAnchors.length === 0) {
    return null;
  }

  return (
    <g className={css.nodeAnchorOverlay}>
      {anchorOverlay.visibleAnchors.map((anchor) => {
        const point = worldToSvgPoint(anchor.world, viewBox);
        const anchorSourceId = anchor.nodeSourceId?.trim() ?? "";
        const anchorState = anchorSourceId ? anchorOverlay.anchorStateBySourceId?.get(anchorSourceId) : undefined;
        const disabled = anchorState?.disabled === true;
        const radiusScale = anchorOverlay.radiusScale ?? 1;
        const snapped =
          anchorOverlay.snappedAnchor?.nodeName === anchor.nodeName &&
          anchorOverlay.snappedAnchor?.nodeSourceId === anchor.nodeSourceId &&
          anchorOverlay.snappedAnchor.anchor === anchor.anchor;
        return (
          <circle
            key={`${anchor.nodeName || anchor.nodeSourceId}:${anchor.anchor}`}
            className={`${css.nodeAnchorPoint} ${snapped ? css.nodeAnchorPointSnapped : ""} ${onAnchorPointerDown || onAnchorClick ? css.nodeAnchorPointInteractive : ""} ${disabled ? css.nodeAnchorPointDisabled : ""}`}
            cx={point.x}
            cy={point.y}
            r={(snapped ? radius * 1.1 : radius * 0.85) * radiusScale}
            strokeWidth={strokeWidth}
            onPointerDown={
              onAnchorPointerDown
                ? (event) => { onAnchorPointerDown(event, anchor); }
                : undefined
            }
            onClick={
              onAnchorClick
                ? (event) => { onAnchorClick(event, anchor); }
                : undefined
            }
            onPointerEnter={
              onAnchorHoverChange
                ? () => { onAnchorHoverChange(anchor); }
                : undefined
            }
            onPointerLeave={
              onAnchorHoverChange
                ? () => { onAnchorHoverChange(null); }
                : undefined
            }
            data-testid="node-anchor-dot"
            data-anchor-node={anchor.nodeName}
            data-anchor-source-id={anchor.nodeSourceId}
            data-anchor-name={anchor.anchor}
            data-anchor-snapped={snapped ? "true" : undefined}
            data-anchor-disabled={disabled ? "true" : undefined}
          />
        );
      })}
    </g>
  );
}
