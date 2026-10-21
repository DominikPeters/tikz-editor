import type { ArrowMarker, ScenePath, ScenePathCommand } from "../../semantic/types.js";
import { worldPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { buildArrowTipMetrics, computeArrowShortening, normalizeArrowTip } from "./metrics.js";
import {
  clonePathCommand,
  commandsToSegments,
  flattenSubpaths,
  perpendicular,
  sampleFrameFromEndExtrapolated,
  sampleFrameFromStartExtrapolated,
  scaleVector,
  splitPathIntoSubpaths
} from "../../geometry/path-sampler.js";
import { placeLocalPathsBent, placeLocalPathsRigid } from "./place.js";
import { buildLocalTipPaths } from "./shapes.js";
import { resolveTipPaint } from "./paint.js";
import { shortenOpenSubpath } from "./shorten.js";
import type { ArrowSide, Frame, NormalizedArrowTip, RenderedArrowPath, RenderedArrowTipPath } from "./types.js";

const DEFAULT_ARROW_COLOR = "#000000";

export function renderPathWithArrows(path: ScenePath): RenderedArrowPath {
  const clonedCommands = path.commands.map((command) => clonePathCommand(command));
  const subpaths = splitPathIntoSubpaths(path.commands);
  if (subpaths.length === 0) {
    return { shaftCommands: clonedCommands, tipPaths: [] };
  }

  const markerColor = resolveMarkerColor(path);
  const startTips = normalizeMarkerTips(path.style.markerStart, path.style.lineWidth, markerColor);
  const endTips = normalizeMarkerTips(path.style.markerEnd, path.style.lineWidth, markerColor);
  const shouldEmitTips = shouldEmitPathTips(path, subpaths, startTips.length > 0 || endTips.length > 0);
  const styleStartShortening = path.style.shortenStart;
  const styleEndShortening = path.style.shortenEnd;
  const hasStyleShortening = styleStartShortening !== 0 || styleEndShortening !== 0;
  if (!shouldEmitTips && !hasStyleShortening) {
    return { shaftCommands: clonedCommands, tipPaths: [] };
  }

  const lastSubpath = subpaths[subpaths.length - 1] ?? [];
  const startShortening = shouldEmitTips ? computeArrowShortening("start", startTips, path.style.lineWidth) : { lineEndShortening: 0, totalLength: 0, plans: [] };
  const endShortening = shouldEmitTips ? computeArrowShortening("end", endTips, path.style.lineWidth) : { lineEndShortening: 0, totalLength: 0, plans: [] };
  const lastSubpathStartShortening = styleStartShortening + startShortening.lineEndShortening;
  const lastSubpathEndShortening = styleEndShortening + endShortening.lineEndShortening;
  const shortenedLastSubpath = shortenOpenSubpath(lastSubpath, lastSubpathStartShortening, lastSubpathEndShortening, [...startTips, ...endTips].some(tip => tip.bend));

  const shaftSubpaths = [
    ...subpaths.slice(0, -1).map((subpath) => shortenSubpathForStyle(subpath, styleStartShortening, styleEndShortening))
  ];
  shaftSubpaths.push(shortenedLastSubpath.commands.map((command) => clonePathCommand(command)));
  const shaftCommands = flattenSubpaths(shaftSubpaths);

  const tipPaths: RenderedArrowTipPath[] = [];
  if (!shouldEmitTips) {
    return { shaftCommands, tipPaths };
  }

  const originalSegments = commandsToSegments(lastSubpath);
  const shortenedSegments = commandsToSegments(shortenedLastSubpath.commands);
  const startLineEndFrameForward = shortenedLastSubpath.startFrameForward ?? sampleFrameFromStartExtrapolated(shortenedSegments, 0)
    ?? sampleFrameFromStartExtrapolated(originalSegments, shortenedLastSubpath.appliedStartShortening);
  const endLineEndFrameForward = shortenedLastSubpath.endFrameForward ?? sampleFrameFromEndExtrapolated(shortenedSegments, 0)
    ?? sampleFrameFromEndExtrapolated(originalSegments, shortenedLastSubpath.appliedEndShortening);
  const startOriginalEndFrameForward = shortenedLastSubpath.startFrameForward ?? sampleFrameFromStartExtrapolated(originalSegments, styleStartShortening);
  const endOriginalEndFrameForward = shortenedLastSubpath.endFrameForward ?? sampleFrameFromEndExtrapolated(originalSegments, styleEndShortening);
  if (!startLineEndFrameForward || !endLineEndFrameForward || !startOriginalEndFrameForward || !endOriginalEndFrameForward) {
    return { shaftCommands, tipPaths };
  }
  const startFrameForward = frameWithPointAndTangent(startLineEndFrameForward, startOriginalEndFrameForward);
  const endFrameForward = frameWithPointAndTangent(endLineEndFrameForward, endOriginalEndFrameForward);

  tipPaths.push(
    ...renderSideTips({
      side: "start",
      plans: startShortening.plans,
      markerColor,
      contextLineWidth: path.style.lineWidth,
      frameForwardAtLineEnd: startFrameForward,
      originalSegments,
      requestedShortening: lastSubpathStartShortening,
      appliedShortening: shortenedLastSubpath.appliedStartShortening
    })
  );
  tipPaths.push(
    ...renderSideTips({
      side: "end",
      plans: endShortening.plans,
      markerColor,
      contextLineWidth: path.style.lineWidth,
      frameForwardAtLineEnd: endFrameForward,
      originalSegments,
      requestedShortening: lastSubpathEndShortening,
      appliedShortening: shortenedLastSubpath.appliedEndShortening
    })
  );

  return { shaftCommands, tipPaths };
}

function shortenSubpathForStyle(
  subpath: ScenePathCommand[],
  startShortening: number,
  endShortening: number
): ScenePathCommand[] {
  if ((startShortening === 0 && endShortening === 0) || subpath.some((command) => command.kind === "Z")) {
    return subpath.map((command) => clonePathCommand(command));
  }
  return shortenOpenSubpath(subpath, startShortening, endShortening).commands;
}

function renderSideTips(args: {
  side: ArrowSide;
  plans: ReturnType<typeof computeArrowShortening>["plans"];
  markerColor: string;
  contextLineWidth: number;
  frameForwardAtLineEnd: Frame;
  originalSegments: ReturnType<typeof commandsToSegments>;
  requestedShortening: number;
  appliedShortening: number;
}): RenderedArrowTipPath[] {
  if (args.plans.length === 0) {
    return [];
  }

  const sideFrame = orientFrameForSide(args.frameForwardAtLineEnd, args.side);
  const shorteningDelta = args.appliedShortening - args.requestedShortening;
  const rendered: RenderedArrowTipPath[] = [];

  for (const plan of args.plans) {
    const normalized = {
      ...plan.tip,
      color: plan.tip.color ?? args.markerColor
    };
    const metrics = buildArrowTipMetrics(normalized, args.contextLineWidth);
    const localPaths = buildLocalTipPaths(normalized, metrics);
    const offset = plan.offset + shorteningDelta;

    const placedPaths = plan.bend && args.originalSegments.length > 0 && args.originalSegments.some(segment => segment.length > 1e-6)
      ? placeLocalPathsBent(localPaths, offset, (xOffset) => frameAlongPathForSide(args.side, args.originalSegments, args.appliedShortening, xOffset))
      : placeLocalPathsRigid(localPaths, sideFrame, offset);

    const paint = resolveTipPaint(normalized, args.markerColor);
    for (const commands of placedPaths) {
      rendered.push({
        commands,
        side: args.side,
        index: plan.index,
        bend: plan.bend,
        tipKind: normalized.kind,
        stroke: paint.stroke,
        fill: paint.fill,
        strokeWidth: paint.strokeWidth,
        lineCap: paint.lineCap,
        lineJoin: paint.lineJoin,
        miterLimit: paint.miterLimit
      });
    }
  }

  return rendered;
}

function frameAlongPathForSide(
  side: ArrowSide,
  originalSegments: ReturnType<typeof commandsToSegments>,
  appliedShortening: number,
  xOffset: number
): Frame {
  const distance = appliedShortening - xOffset;
  const forwardFrame =
    side === "start"
      ? sampleFrameFromStartExtrapolated(originalSegments, distance)
      : sampleFrameFromEndExtrapolated(originalSegments, distance);
  if (!forwardFrame) {
    return {
      point: worldPoint(pt(0), pt(0)),
      tangent: worldVector(pt(1), pt(0)),
      normal: worldVector(pt(0), pt(1))
    };
  }
  return orientFrameForSide(forwardFrame, side);
}

function orientFrameForSide(frameForward: Frame, side: ArrowSide): Frame {
  if (side === "end") {
    return frameForward;
  }
  const tangent = scaleVector(frameForward.tangent, -1);
  return {
    point: frameForward.point,
    tangent,
    normal: perpendicular(tangent)
  };
}

function frameWithPointAndTangent(pointFrame: Frame, tangentFrame: Frame): Frame {
  return {
    point: pointFrame.point,
    tangent: tangentFrame.tangent,
    normal: perpendicular(tangentFrame.tangent)
  };
}

function normalizeMarkerTips(marker: ArrowMarker | null, contextLineWidth: number, fallbackColor: string): NormalizedArrowTip[] {
  if (!marker || marker.tips.length === 0) {
    return [];
  }
  return marker.tips.map((tip) => normalizeArrowTip(tip, contextLineWidth, fallbackColor));
}

function resolveMarkerColor(path: ScenePath): string {
  const stroke = path.style.stroke;
  if (stroke && stroke !== "none") {
    return stroke;
  }
  return DEFAULT_ARROW_COLOR;
}

function shouldEmitPathTips(path: ScenePath, subpaths: ScenePathCommand[][], hasAnyTip: boolean): boolean {
  if (!hasAnyTip) {
    return false;
  }

  if (path.style.tipsMode === "never") {
    return false;
  }

  if (subpaths.length === 0) {
    return false;
  }

  const lastSubpath = subpaths[subpaths.length - 1] ?? [];
  if (path.arrowTipsSuppressed || subpaths.some(subpath => subpath.some(command => command.kind === "Z"))) {
    return false;
  }

  const hasDrawableLastSubpath = commandsToSegments(lastSubpath).some(segment => segment.length > 1e-6);
  if (!hasDrawableLastSubpath && (path.style.tipsMode === "proper" || path.style.tipsMode === "on proper draw")) {
    return false;
  }

  const drawEnabled = path.style.drawExplicit || (path.style.stroke != null && path.style.stroke !== "none");
  if ((path.style.tipsMode === "on draw" || path.style.tipsMode === "on proper draw") && !drawEnabled) {
    return false;
  }

  return true;
}
