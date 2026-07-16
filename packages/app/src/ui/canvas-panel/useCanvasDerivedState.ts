import { useMemo } from "react";
import { pt, worldPoint } from "@tikz-editor/core/coords/index";
import { PT_PER_CM } from "@tikz-editor/core/edit/format";
import type { ScenePathCommand } from "@tikz-editor/core/semantic/types";
import type { WorldPoint } from "../coords/types";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import type { NodeShapePresetId } from "@tikz-editor/core/edit/inspector";
import type { CanvasTransform, ToolMode } from "../../store/types";
import { distanceSquared, fmt, worldToSvgPoint, worldToSvgY } from "./geometry";
import { buildAddonGhostPathData, findAddonTemplate } from "../../addons/ghost";
import { useEditorStore } from "../../store/store";
import { resolveBezierControlsFromBend } from "./interaction-helpers";
import { resolveAddShapeDraft, resolveAddShapeOriginFromDrag } from "./add-shape-draft";
import {
  pathToolCanClose,
  pathToolCloseRadiusWorld,
  pathToolShouldClose
} from "./path-tool";
import { resolveFreehandPreviewSegments } from "./freehand-tool";
import { buildAnchoredGridPreviewLines } from "./panel-helpers";
import type { CanvasSnapshot, DragState, FreehandToolDraft, PathToolDraft, PendingBezier } from "./types";
import type { ToolPreview } from "./overlays";

const TOOL_PREVIEW_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const TOOL_PREVIEW_GRID_STEP_PT = PT_PER_CM;
const TOOL_PREVIEW_GRID_MAX_LINES = 120;

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export type UseCanvasDerivedStateArgs = {
  svgResult: CanvasSnapshot["svg"];
  toolMode: ToolMode;
  toolDraft: Extract<DragState, { kind: "tool-create" }> | null;
  toolCursorWorld: WorldPoint | null;
  selectedAddShape: Exclude<NodeShapePresetId, "custom">;
  freehandDraft: FreehandToolDraft | null;
  freehandSmoothingPx: number;
  pathDraft: PathToolDraft | null;
  pathSegmentDraft: Extract<DragState, { kind: "tool-path-segment" }> | null;
  pendingBezier: PendingBezier | null;
  bezierBendDraft: Extract<DragState, { kind: "tool-bezier-bend" }> | null;
  canvasTransform: CanvasTransform;
};

export function useCanvasDerivedState(args: UseCanvasDerivedStateArgs) {
  const {
    svgResult,
    toolMode,
    toolDraft,
    toolCursorWorld,
    selectedAddShape,
    freehandDraft,
    freehandSmoothingPx,
    pathDraft,
    pathSegmentDraft,
    pendingBezier,
    bezierBendDraft,
    canvasTransform
  } = args;

  const toolPreview = useMemo((): ToolPreview | null => {
    if (!svgResult || toolMode === "select") {
      return null;
    }

    if (toolMode === "addNode" || toolMode === "addMatrix" || (toolMode === "addShape" && !toolDraft)) {
      const liveWorld = toolDraft?.currentWorld ?? toolCursorWorld;
      if (!liveWorld) {
        return null;
      }
      const point = worldToSvgPoint(liveWorld, svgResult.viewBox);
      return { kind: "node", x: point.x, y: point.y };
    }

    if (toolMode === "addFreehand") {
      if (!freehandDraft || freehandDraft.points.length < 2) {
        if (!toolCursorWorld) {
          return null;
        }
        const point = worldToSvgPoint(toolCursorWorld, svgResult.viewBox);
        return { kind: "cursor", x: point.x, y: point.y };
      }

      const segments: Extract<ToolPreview, { kind: "freehand" }>["segments"] = [];
      for (const segment of resolveFreehandPreviewSegments(freehandDraft, freehandSmoothingPx, canvasTransform.scale)) {
        if (segment.kind === "line") {
          const from = worldToSvgPoint(segment.from, svgResult.viewBox);
          const to = worldToSvgPoint(segment.to, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
          continue;
        }

        const from = worldToSvgPoint(segment.from, svgResult.viewBox);
        const c1 = worldToSvgPoint(segment.control1, svgResult.viewBox);
        const c2 = worldToSvgPoint(segment.control2, svgResult.viewBox);
        const to = worldToSvgPoint(segment.to, svgResult.viewBox);
        segments.push({
          kind: "bezier",
          x1: from.x,
          y1: from.y,
          c1x: c1.x,
          c1y: c1.y,
          c2x: c2.x,
          c2y: c2.y,
          x2: to.x,
          y2: to.y
        });
      }

      return { kind: "freehand", segments };
    }

    const makeBezierPreview = (startWorld: WorldPoint, endWorld: WorldPoint, bendWorld: WorldPoint): ToolPreview => {
      const controls = resolveBezierControlsFromBend(startWorld, endWorld, bendWorld);
      const start = worldToSvgPoint(startWorld, svgResult.viewBox);
      const end = worldToSvgPoint(controls.endWorld, svgResult.viewBox);
      const c1 = worldToSvgPoint(controls.control1, svgResult.viewBox);
      const c2 = worldToSvgPoint(controls.control2, svgResult.viewBox);
      return {
        kind: "bezier",
        x1: start.x,
        y1: start.y,
        c1x: c1.x,
        c1y: c1.y,
        c2x: c2.x,
        c2y: c2.y,
        x2: end.x,
        y2: end.y
      };
    };

    if (toolMode === "addPath") {
      if (!pathDraft) {
        if (!toolCursorWorld) {
          return null;
        }
        const point = worldToSvgPoint(toolCursorWorld, svgResult.viewBox);
        return { kind: "cursor", x: point.x, y: point.y };
      }

      const segments: Extract<ToolPreview, { kind: "complex-path" }>["segments"] = [];
      let currentWorldPoint = pathDraft.startWorld;
      for (const segment of pathDraft.segments) {
        const from = worldToSvgPoint(currentWorldPoint, svgResult.viewBox);
        if (segment.kind === "line") {
          const to = worldToSvgPoint(segment.to, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
          currentWorldPoint = segment.to;
          continue;
        }

        const c1 = worldToSvgPoint(segment.control1, svgResult.viewBox);
        const c2 = worldToSvgPoint(segment.control2, svgResult.viewBox);
        const to = worldToSvgPoint(segment.to, svgResult.viewBox);
        segments.push({
          kind: "bezier",
          x1: from.x,
          y1: from.y,
          c1x: c1.x,
          c1y: c1.y,
          c2x: c2.x,
          c2y: c2.y,
          x2: to.x,
          y2: to.y
        });
        currentWorldPoint = segment.to;
      }
      if (pathSegmentDraft) {
        if (pathSegmentDraft.isBending) {
          const controls = resolveBezierControlsFromBend(
            pathSegmentDraft.startWorld,
            pathSegmentDraft.endWorld,
            pathSegmentDraft.bendWorld
          );
          const from = worldToSvgPoint(pathSegmentDraft.startWorld, svgResult.viewBox);
          const c1 = worldToSvgPoint(controls.control1, svgResult.viewBox);
          const c2 = worldToSvgPoint(controls.control2, svgResult.viewBox);
          const to = worldToSvgPoint(pathSegmentDraft.endWorld, svgResult.viewBox);
          segments.push({
            kind: "bezier",
            x1: from.x,
            y1: from.y,
            c1x: c1.x,
            c1y: c1.y,
            c2x: c2.x,
            c2y: c2.y,
            x2: to.x,
            y2: to.y
          });
        } else {
          const from = worldToSvgPoint(pathSegmentDraft.startWorld, svgResult.viewBox);
          const to = worldToSvgPoint(pathSegmentDraft.endWorld, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
        }
      } else if (toolCursorWorld) {
        const closeCandidate = pathToolShouldClose(
          pathDraft,
          toolCursorWorld,
          pathToolCloseRadiusWorld(canvasTransform.scale)
        );
        const candidateTarget = closeCandidate ? pathDraft.startWorld : toolCursorWorld;
        if (distanceSquared(currentWorldPoint, candidateTarget) > 1e-6) {
          const from = worldToSvgPoint(currentWorldPoint, svgResult.viewBox);
          const to = worldToSvgPoint(candidateTarget, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
        }
      }

      const start = worldToSvgPoint(pathDraft.startWorld, svgResult.viewBox);
      const closeCandidate =
        toolCursorWorld != null
          ? pathToolShouldClose(pathDraft, toolCursorWorld, pathToolCloseRadiusWorld(canvasTransform.scale))
          : false;
      return {
        kind: "complex-path",
        startX: start.x,
        startY: start.y,
        closeCandidate,
        canClose: pathToolCanClose(pathDraft),
        segments
      };
    }

    if (toolMode === "addBezier" && pendingBezier) {
      const midpoint = wp(
        (pendingBezier.startWorld.x + pendingBezier.endWorld.x) / 2,
        (pendingBezier.startWorld.y + pendingBezier.endWorld.y) / 2
      );
      const bendWorld = bezierBendDraft?.currentWorld ?? toolCursorWorld ?? midpoint;
      return makeBezierPreview(pendingBezier.startWorld, pendingBezier.endWorld, bendWorld);
    }

    const liveWorld = toolDraft?.currentWorld ?? toolCursorWorld;
    if (!liveWorld) {
      return null;
    }

    if (!toolDraft) {
      const point = worldToSvgPoint(liveWorld, svgResult.viewBox);
      return { kind: "cursor", x: point.x, y: point.y };
    }

    if (toolDraft.toolMode === "addBezier") {
      const midpoint = wp(
        (toolDraft.startWorld.x + toolDraft.currentWorld.x) / 2,
        (toolDraft.startWorld.y + toolDraft.currentWorld.y) / 2
      );
      return makeBezierPreview(toolDraft.startWorld, toolDraft.currentWorld, midpoint);
    }

    const start = worldToSvgPoint(toolDraft.startWorld, svgResult.viewBox);
    const end = worldToSvgPoint(toolDraft.currentWorld, svgResult.viewBox);

    if (toolDraft.toolMode === "addLine" || toolDraft.toolMode === "addArrow") {
      return {
        kind: "line",
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        arrow: toolDraft.toolMode === "addArrow"
      };
    }

    if (toolDraft.toolMode === "addGrid") {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      const minWorldX = Math.min(toolDraft.startWorld.x, toolDraft.currentWorld.x);
      const maxWorldX = Math.max(toolDraft.startWorld.x, toolDraft.currentWorld.x);
      const minWorldY = Math.min(toolDraft.startWorld.y, toolDraft.currentWorld.y);
      const maxWorldY = Math.max(toolDraft.startWorld.y, toolDraft.currentWorld.y);
      const verticalLines = buildAnchoredGridPreviewLines(
        minWorldX,
        minWorldX,
        maxWorldX,
        TOOL_PREVIEW_GRID_STEP_PT,
        TOOL_PREVIEW_GRID_MAX_LINES
      );
      const horizontalLines = buildAnchoredGridPreviewLines(
        minWorldY,
        minWorldY,
        maxWorldY,
        TOOL_PREVIEW_GRID_STEP_PT,
        TOOL_PREVIEW_GRID_MAX_LINES
      ).map((worldY) => worldToSvgY(worldY, svgResult.viewBox));
      return {
        kind: "grid",
        x,
        y,
        width,
        height,
        verticalLines,
        horizontalLines
      };
    }

    if (
      toolDraft.toolMode === "addRect" ||
      toolDraft.toolMode === "addEllipse" ||
      toolDraft.toolMode === "addShape"
    ) {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (toolDraft.toolMode === "addShape") {
        const nodeOriginWorld = resolveAddShapeOriginFromDrag(
          selectedAddShape,
          toolDraft.startWorld,
          toolDraft.currentWorld
        );
        const draft = resolveAddShapeDraft(
          selectedAddShape,
          Math.abs(toolDraft.currentWorld.x - toolDraft.startWorld.x),
          Math.abs(toolDraft.currentWorld.y - toolDraft.startWorld.y)
        );
        const localBoundsCenter = wp(
          (draft.preview.bounds.minX + draft.preview.bounds.maxX) / 2,
          (draft.preview.bounds.minY + draft.preview.bounds.maxY) / 2
        );
        const centerWorld = wp(
          nodeOriginWorld.x + localBoundsCenter.x,
          nodeOriginWorld.y + localBoundsCenter.y
        );
        const center = worldToSvgPoint(centerWorld, svgResult.viewBox);
        if (draft.preview.kind === "circle") {
          return {
            kind: "circle",
            cx: center.x,
            cy: center.y,
            r: draft.preview.radius > 1e-4 ? draft.preview.radius : TOOL_PREVIEW_CIRCLE_RADIUS_PT
          };
        }
        if (draft.preview.kind === "ellipse") {
          return {
            kind: "ellipse",
            cx: center.x,
            cy: center.y,
            rx: draft.preview.rx,
            ry: draft.preview.ry
          };
        }
        return {
          kind: "path",
          d: encodeTranslatedPathPreview(
            draft.preview.commands,
            nodeOriginWorld.x,
            nodeOriginWorld.y,
            svgResult.viewBox
          )
        };
      }
      if (toolDraft.toolMode === "addRect") {
        return {
          kind: "rect",
          x,
          y,
          width,
          height
        };
      }
      return {
        kind: "ellipse",
        cx: x + width / 2,
        cy: y + height / 2,
        rx: width / 2,
        ry: height / 2
      };
    }

    if (toolDraft.toolMode === "addonTemplate") {
      const template = findAddonTemplate(useEditorStore.getState().activeAddonTemplateId);
      if (!template) {
        return null;
      }
      const d = buildAddonGhostPathData(template, toolDraft.startWorld, toolDraft.currentWorld, (point) =>
        worldToSvgPoint(point, svgResult.viewBox)
      );
      return d ? { kind: "path", d } : null;
    }

    const dx = toolDraft.currentWorld.x - toolDraft.startWorld.x;
    const dy = toolDraft.currentWorld.y - toolDraft.startWorld.y;
    const radius = Math.hypot(dx, dy);

    return {
      kind: "circle",
      cx: start.x,
      cy: start.y,
      r: radius > 1e-4 ? radius : TOOL_PREVIEW_CIRCLE_RADIUS_PT
    };
  }, [bezierBendDraft, canvasTransform.scale, freehandDraft, freehandSmoothingPx, pathDraft, pathSegmentDraft, pendingBezier, selectedAddShape, svgResult, toolCursorWorld, toolDraft, toolMode]);

  return {
    toolPreview
  };
}

function encodeTranslatedPathPreview(
  commands: readonly ScenePathCommand[],
  originWorldX: number,
  originWorldY: number,
  viewBox: SvgViewBox
): string {
  const parts: string[] = [];
  for (const command of commands) {
    if (command.kind === "M" || command.kind === "L") {
      const point = worldToSvgPoint(wp(command.to.x + originWorldX, command.to.y + originWorldY), viewBox);
      parts.push(`${command.kind} ${fmt(point.x)},${fmt(point.y)}`);
      continue;
    }
    if (command.kind === "C") {
      const c1 = worldToSvgPoint(wp(command.c1.x + originWorldX, command.c1.y + originWorldY), viewBox);
      const c2 = worldToSvgPoint(wp(command.c2.x + originWorldX, command.c2.y + originWorldY), viewBox);
      const to = worldToSvgPoint(wp(command.to.x + originWorldX, command.to.y + originWorldY), viewBox);
      parts.push(`C ${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(to.x)},${fmt(to.y)}`);
      continue;
    }
    if (command.kind === "A") {
      const to = worldToSvgPoint(wp(command.to.x + originWorldX, command.to.y + originWorldY), viewBox);
      parts.push(
        `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(command.xAxisRotation)} ${command.largeArc ? 1 : 0} ${command.sweep ? 1 : 0} ${fmt(to.x)},${fmt(to.y)}`
      );
      continue;
    }
    parts.push("Z");
  }
  return parts.join(" ");
}
