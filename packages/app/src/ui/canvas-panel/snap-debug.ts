import type { WorldPoint } from "../coords/types";
import type { SnapContext, SnapLine } from "tikz-editor/edit/snapping";

export type SnapDebugPoint = {
  x: number;
  y: number;
};

export type SnapDebugLineSummary =
  | {
      type: "points";
      axis: "x" | "y";
      pointCount: number;
      points: SnapDebugPoint[];
    }
  | {
      type: "pointer";
      axis: "x" | "y";
      from: SnapDebugPoint;
      to: SnapDebugPoint;
    }
  | {
      type: "gap";
      direction: "horizontal" | "vertical";
      gapKind: "center" | "equal";
      segmentCount: number;
      segments: Array<{ from: SnapDebugPoint; to: SnapDebugPoint }>;
    };

export type SnapDebugContextSummary = {
  zoom: number;
  thresholdWorld: number;
  selectedSourceIds: string[];
  referenceWorldPointCount: number;
  referenceBoundsCount: number;
  horizontalGapCount: number;
  verticalGapCount: number;
};

function roundForDebug(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

export function toDebugPoint(point: WorldPoint | null | undefined): SnapDebugPoint | null {
  if (!point) {
    return null;
  }
  return {
    x: roundForDebug(point.x),
    y: roundForDebug(point.y)
  };
}

export function summarizeSnapContextForDebug(context: SnapContext | null | undefined): SnapDebugContextSummary | null {
  if (!context) {
    return null;
  }

  return {
    zoom: roundForDebug(context.zoom),
    thresholdWorld: roundForDebug(context.settings.thresholdPx / Math.max(context.zoom, 1e-6)),
    selectedSourceIds: context.selectedSourceIds.slice(0, 8),
    referenceWorldPointCount: context.referencePoints.length,
    referenceBoundsCount: context.referenceBounds.length,
    horizontalGapCount: context.visibleGaps.horizontal.length,
    verticalGapCount: context.visibleGaps.vertical.length
  };
}

export function summarizeSnapLinesForDebug(lines: readonly SnapLine[]): SnapDebugLineSummary[] {
  return lines.slice(0, 8).map((line) => {
    if (line.type === "points") {
      return {
        type: "points",
        axis: line.axis,
        pointCount: line.points.length,
        points: line.points.slice(0, 6).map((point) => ({
          x: roundForDebug(point.x),
          y: roundForDebug(point.y)
        }))
      };
    }

    if (line.type === "pointer") {
      return {
        type: "pointer",
        axis: line.axis,
        from: {
          x: roundForDebug(line.from.x),
          y: roundForDebug(line.from.y)
        },
        to: {
          x: roundForDebug(line.to.x),
          y: roundForDebug(line.to.y)
        }
      };
    }

    return {
      type: "gap",
      direction: line.direction,
      gapKind: line.gapKind,
      segmentCount: line.segments.length,
      segments: line.segments.slice(0, 4).map((segment) => ({
        from: {
          x: roundForDebug(segment[0].x),
          y: roundForDebug(segment[0].y)
        },
        to: {
          x: roundForDebug(segment[1].x),
          y: roundForDebug(segment[1].y)
        }
      }))
    };
  });
}
