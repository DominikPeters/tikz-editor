import { worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint } from "../../coords/points.js";
import type { PlotOperationItem } from "../../ast/types.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { MacroBinding } from "../../macros/index.js";
import type { SemanticContext } from "../context.js";
import { deleteContextMacroBinding, readContextMacroBinding, writeContextMacroBinding } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseLength } from "../coords/parse-length.js";
import type { ResolvedStyle, SceneElement, ScenePath } from "../types.js";
import type { StyleChainEntry } from "../style-chain.js";
import { appendCircleSubpath, appendRectangleSubpath, hasDrawablePathSegments, makePath } from "./elements.js";
import { formatPlotSampleValue, resolvePlotSampleValues, type PlotSettings } from "./plot.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "./types.js";

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export function extractPlotCoordinateEntries(rawGroup: string): Array<{ raw: string; relativePrefix?: "+" | "++" }> {
  const trimmed = rawGroup.trim();
  const content =
    trimmed.startsWith("{") && trimmed.endsWith("}") && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed;
  const entries: Array<{ raw: string; relativePrefix?: "+" | "++" }> = [];
  let index = 0;

  while (index < content.length) {
    while (index < content.length && (/\s/.test(content[index]) || content[index] === ",")) {
      index += 1;
    }
    if (index >= content.length) {
      break;
    }

    let relativePrefix: "+" | "++" | undefined;
    if (content.startsWith("++", index)) {
      relativePrefix = "++";
      index += 2;
    } else if (content[index] === "+") {
      relativePrefix = "+";
      index += 1;
    }
    while (index < content.length && /\s/.test(content[index])) {
      index += 1;
    }

    if (content[index] !== "(") {
      index += 1;
      continue;
    }

    const coordinateStart = index;
    let depth = 0;
    while (index < content.length) {
      const char = content[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "(") {
        depth += 1;
        index += 1;
        continue;
      }
      if (char === ")") {
        depth -= 1;
        index += 1;
        if (depth === 0) {
          const raw = content.slice(coordinateStart, index).trim();
          if (raw.length > 0) {
            entries.push({ raw, relativePrefix });
          }
          break;
        }
        continue;
      }
      index += 1;
    }
  }

  return entries;
}

export function evaluatePlotCoordinatePoints(params: {
  entries: Array<{ raw: string; relativePrefix?: "+" | "++" }>;
  span: { from: number; to: number };
  issuePrefix: string;
  currentPoint: WorldPoint | null;
  setCurrentPoint: (point: WorldPoint | null) => void;
  pushDiagnostic: DiagnosticPushFn;
  evaluateCoordinateRaw: (raw: string, relativePrefix?: "+" | "++") => {
    world: WorldPoint | null;
    diagnostics: string[];
    advancesCurrentPoint?: boolean;
  };
}): WorldPoint[] {
  const { entries, span, issuePrefix, currentPoint, setCurrentPoint, pushDiagnostic, evaluateCoordinateRaw } = params;
  const savedCurrentPoint = currentPoint;
  let iterationCurrentPoint = currentPoint;
  const points: WorldPoint[] = [];
  for (const entry of entries) {
    setCurrentPoint(iterationCurrentPoint);
    const evaluated = evaluateCoordinateRaw(entry.raw, entry.relativePrefix);
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `${issuePrefix}: ${code}`, span.from, span.to);
    }
    if (!evaluated.world) {
      continue;
    }
    points.push(evaluated.world);
    if (evaluated.advancesCurrentPoint || iterationCurrentPoint == null) {
      iterationCurrentPoint = evaluated.world;
    }
  }
  setCurrentPoint(savedCurrentPoint);
  return points;
}

function appendPlotXMarks(commands: ScenePath["commands"], points: WorldPoint[]): void {
  const halfSize = parseLength("1.5pt", "pt")!;
  for (const point of points) {
    commands.push({
      kind: "M",
      to: wp(point.x - halfSize, point.y - halfSize)
    });
    commands.push({
      kind: "L",
      to: wp(point.x + halfSize, point.y + halfSize)
    });
    commands.push({
      kind: "M",
      to: wp(point.x - halfSize, point.y + halfSize)
    });
    commands.push({
      kind: "L",
      to: wp(point.x + halfSize, point.y - halfSize)
    });
  }
}

function appendPlotPlusMarks(commands: ScenePath["commands"], points: WorldPoint[]): void {
  const halfSize = parseLength("2pt", "pt")!;
  for (const point of points) {
    commands.push({
      kind: "M",
      to: wp(point.x - halfSize, point.y)
    });
    commands.push({
      kind: "L",
      to: wp(point.x + halfSize, point.y)
    });
    commands.push({
      kind: "M",
      to: wp(point.x, point.y - halfSize)
    });
    commands.push({
      kind: "L",
      to: wp(point.x, point.y + halfSize)
    });
  }
}

function appendPlotAsteriskMarks(commands: ScenePath["commands"], points: WorldPoint[]): void {
  const radius = parseLength("2pt", "pt")!;
  for (const point of points) {
    appendCircleSubpath(commands, point, radius);
  }
}

function pointsClose(left: WorldPoint, right: WorldPoint): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= 1e-6;
}

export function emitPlotPath(params: {
  statementId: string;
  item: PlotOperationItem;
  points: WorldPoint[];
  settings: PlotSettings;
  connectFrom: WorldPoint | null;
  style: ResolvedStyle;
  styleChain: StyleChainEntry[];
  geometryElements: SceneElement[];
  markFeature: FeatureMarkFn;
  activeRoundedCorners: number | null;
  setCurrentPoint: (point: WorldPoint) => void;
  setPathStartPoint: (point: WorldPoint | null) => void;
}): { lastPlacementSegment: PlacementSegment | null; previousSegmentRoundedCorners: number | null } {
  const {
    statementId,
    item,
    points,
    settings,
    connectFrom,
    style,
    styleChain,
    geometryElements,
    markFeature,
    activeRoundedCorners,
    setCurrentPoint,
    setPathStartPoint
  } = params;
  if (points.length === 0) {
    return { lastPlacementSegment: null, previousSegmentRoundedCorners: null };
  }

  const commands: ScenePath["commands"] = [];
  let lastSegment: { from: WorldPoint; to: WorldPoint } | null = null;
  const markPoints: WorldPoint[] = [];
  const tensionFactor = 0.2775 * settings.tension;

  const addConnectionToFirstPoint = (source: WorldPoint, target: WorldPoint): void => {
    commands.push({ kind: "M", to: source });
    if (!pointsClose(source, target)) {
      commands.push({ kind: "L", to: target });
      lastSegment = { from: source, to: target };
    }
  };

  const addLine = (from: WorldPoint, to: WorldPoint): void => {
    commands.push({ kind: "L", to });
    if (!pointsClose(from, to)) {
      lastSegment = { from, to };
    }
  };

  const addCurve = (from: WorldPoint, c1: WorldPoint, c2: WorldPoint, to: WorldPoint): void => {
    commands.push({ kind: "C", c1, c2, to });
    if (!pointsClose(from, to)) {
      lastSegment = { from, to };
    }
  };

  if (settings.handler === "sharp") {
    const first = points[0];
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, first);
    } else {
      commands.push({ kind: "M", to: first });
    }
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      addLine(points[pointIndex - 1], points[pointIndex]);
    }
    markPoints.push(...points);
  } else if (settings.handler === "sharp-cycle") {
    const first = points[0];
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, first);
    }
    commands.push({ kind: "M", to: first });
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      addLine(points[pointIndex - 1], points[pointIndex]);
    }
    if (points.length > 1) {
      lastSegment = { from: points[points.length - 1], to: first };
    }
    commands.push({ kind: "Z" });
    markPoints.push(...points);
  } else if (settings.handler === "smooth") {
    const first = points[0];
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, first);
    } else {
      commands.push({ kind: "M", to: first });
    }
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const prev = pointIndex > 0 ? points[pointIndex - 1] : points[pointIndex];
      const current = points[pointIndex];
      const next = points[pointIndex + 1];
      const nextNext = pointIndex + 2 < points.length ? points[pointIndex + 2] : points[pointIndex + 1];
      const c1 =
        pointIndex === 0
          ? current
          : wp(
              current.x + tensionFactor * (next.x - prev.x),
              current.y + tensionFactor * (next.y - prev.y)
            );
      const c2 =
          pointIndex === points.length - 2
          ? next
          : wp(
              next.x - tensionFactor * (nextNext.x - current.x),
              next.y - tensionFactor * (nextNext.y - current.y)
            );
      addCurve(current, c1, c2, next);
    }
    markPoints.push(...points);
  } else if (settings.handler === "smooth-cycle") {
    const first = points[0];
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, first);
    }
    commands.push({ kind: "M", to: first });
    if (points.length > 1) {
      const count = points.length;
      for (let pointIndex = 0; pointIndex < count; pointIndex += 1) {
        const previous = points[(pointIndex - 1 + count) % count];
        const current = points[pointIndex];
        const next = points[(pointIndex + 1) % count];
        const nextNext = points[(pointIndex + 2) % count];
        const c1 = wp(
          current.x + tensionFactor * (next.x - previous.x),
          current.y + tensionFactor * (next.y - previous.y)
        );
        const c2 = wp(
          next.x - tensionFactor * (nextNext.x - current.x),
          next.y - tensionFactor * (nextNext.y - current.y)
        );
        addCurve(current, c1, c2, next);
      }
      lastSegment = { from: points[count - 1], to: first };
      commands.push({ kind: "Z" });
    }
    markPoints.push(...points);
  } else if (
    settings.handler === "const-left" ||
    settings.handler === "const-right" ||
    settings.handler === "const-mid" ||
    settings.handler === "jump-left" ||
    settings.handler === "jump-right" ||
    settings.handler === "jump-mid"
  ) {
    const first = points[0];
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, first);
    } else {
      commands.push({ kind: "M", to: first });
    }

    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      const previous = points[pointIndex - 1];
      const current = points[pointIndex];
      if (settings.handler === "const-left") {
        const step = wp(current.x, previous.y);
        addLine(previous, step);
        addLine(step, current);
        continue;
      }
      if (settings.handler === "const-right") {
        const step = wp(previous.x, current.y);
        addLine(previous, step);
        addLine(step, current);
        continue;
      }
      if (settings.handler === "const-mid") {
        const mid = wp(0.5 * (previous.x + current.x), previous.y);
        const midTop = wp(mid.x, current.y);
        addLine(previous, mid);
        addLine(mid, midTop);
        addLine(midTop, current);
        continue;
      }
      if (settings.handler === "jump-left") {
        const end = wp(current.x, previous.y);
        addLine(previous, end);
        commands.push({ kind: "M", to: current });
        continue;
      }
      if (settings.handler === "jump-right") {
        const start = wp(previous.x, current.y);
        commands.push({ kind: "M", to: start });
        addLine(start, current);
        continue;
      }
      const mid = wp(0.5 * (previous.x + current.x), previous.y);
      const midTop = wp(mid.x, current.y);
      addLine(previous, mid);
      commands.push({ kind: "M", to: midTop });
      addLine(midTop, current);
    }

    if (settings.handler === "const-left" || settings.handler === "jump-left") {
      if (points.length > 1) {
        markPoints.push(...points.slice(0, -1));
      } else {
        markPoints.push(...points);
      }
    } else if (settings.handler === "const-right" || settings.handler === "jump-right") {
      if (points.length > 1) {
        markPoints.push(...points.slice(1));
      } else {
        markPoints.push(...points);
      }
    } else if (settings.handler === "const-mid" || settings.handler === "jump-mid") {
      if (points.length > 1) {
        for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
          const previous = points[pointIndex - 1];
          const current = points[pointIndex];
          markPoints.push(wp(0.5 * (previous.x + current.x), previous.y));
        }
      } else {
        markPoints.push(...points);
      }
    }
  } else if (settings.handler === "ycomb") {
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, points[0]);
    }
    for (const point of points) {
      const base = wp(point.x, 0);
      commands.push({ kind: "M", to: base });
      addLine(base, point);
    }
    markPoints.push(...points);
  } else if (settings.handler === "xcomb") {
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, points[0]);
    }
    for (const point of points) {
      const base = wp(0, point.y);
      commands.push({ kind: "M", to: base });
      addLine(base, point);
    }
    markPoints.push(...points);
  } else if (settings.handler === "polar-comb") {
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, points[0]);
    }
    const origin = wp(0, 0);
    for (const point of points) {
      commands.push({ kind: "M", to: origin });
      addLine(origin, point);
    }
    markPoints.push(...points);
  } else if (settings.handler === "ybar") {
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, points[0]);
    }
    for (const point of points) {
      const left = point.x - 0.5 * settings.barWidth + settings.barShift;
      const from = wp(left, 0);
      const to = wp(left + settings.barWidth, point.y);
      appendRectangleSubpath(commands, from, to);
      if (!pointsClose(from, wp(left, point.y))) {
        lastSegment = { from: wp(left, 0), to: wp(left, point.y) };
      }
    }
    markPoints.push(...points);
  } else if (settings.handler === "xbar") {
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, points[0]);
    }
    for (const point of points) {
      const bottom = point.y - 0.5 * settings.barWidth + settings.barShift;
      const from = wp(0, bottom);
      const to = wp(point.x, bottom + settings.barWidth);
      appendRectangleSubpath(commands, from, to);
      if (!pointsClose(from, wp(point.x, bottom))) {
        lastSegment = { from: wp(0, bottom), to: wp(point.x, bottom) };
      }
    }
    markPoints.push(...points);
  } else if (settings.handler === "ybar-interval") {
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, points[0]);
    }
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const current = points[pointIndex];
      const next = points[pointIndex + 1];
      const interval = next.x - current.x;
      const center = current.x + settings.barIntervalShift * interval;
      const width = settings.barIntervalWidth * interval;
      const left = center - 0.5 * width;
      const from = wp(left, 0);
      const to = wp(left + width, current.y);
      appendRectangleSubpath(commands, from, to);
      if (!pointsClose(from, wp(left, current.y))) {
        lastSegment = { from: wp(left, 0), to: wp(left, current.y) };
      }
    }
    markPoints.push(...points);
  } else if (settings.handler === "xbar-interval") {
    if (connectFrom) {
      addConnectionToFirstPoint(connectFrom, points[0]);
    }
    for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const current = points[pointIndex];
      const next = points[pointIndex + 1];
      const interval = next.y - current.y;
      const center = current.y + settings.barIntervalShift * interval;
      const width = settings.barIntervalWidth * interval;
      const bottom = center - 0.5 * width;
      const from = wp(0, bottom);
      const to = wp(current.x, bottom + width);
      appendRectangleSubpath(commands, from, to);
      if (!pointsClose(from, wp(current.x, bottom))) {
        lastSegment = { from: wp(0, bottom), to: wp(current.x, bottom) };
      }
    }
    markPoints.push(...points);
  } else {
    markPoints.push(...points);
  }

  const plotPath = makePath(statementId, item.id, style, styleChain, item.span);
  plotPath.commands.push(...commands);

  if (hasDrawablePathSegments(plotPath)) {
    geometryElements.push(plotPath);
    markFeature("svg_path", "supported");
  }

  const markName = (settings.mark ?? "").trim().toLowerCase();
  if (markPoints.length > 0 && (markName === "x" || markName === "+" || markName === "*")) {
    const markerPathStyle: ResolvedStyle =
      markName === "*"
        ? {
            ...style,
            stroke: style.stroke ?? style.fill ?? style.textColor ?? "black",
            fill: style.fill ?? style.stroke ?? style.textColor ?? "black"
          }
        : {
            ...style,
            fill: "none"
          };
    const markerPath = makePath(statementId, `${item.id}:mark`, markerPathStyle, styleChain, item.span);
    if (markName === "x") {
      appendPlotXMarks(markerPath.commands, markPoints);
    } else if (markName === "+") {
      appendPlotPlusMarks(markerPath.commands, markPoints);
    } else {
      appendPlotAsteriskMarks(markerPath.commands, markPoints);
    }
    if (hasDrawablePathSegments(markerPath)) {
      geometryElements.push(markerPath);
      markFeature("svg_path", "supported");
    }
  }

  const finalPoint = points[points.length - 1];
  setCurrentPoint(finalPoint);
  setPathStartPoint(connectFrom ?? points[0]);

  if (!lastSegment) {
    return { lastPlacementSegment: null, previousSegmentRoundedCorners: null };
  }

  return {
    lastPlacementSegment: {
      kind: "line",
      from: lastSegment.from,
      to: lastSegment.to
    },
    previousSegmentRoundedCorners: activeRoundedCorners
  };
}

export function buildPlotExpressionEntries(params: {
  context: SemanticContext;
  consumerStatementId: string;
  expressionRaw: string;
  settings: PlotSettings;
  macroBindings: ReadonlyMap<string, MacroBinding>;
}): Array<{ raw: string }> {
  const { context, consumerStatementId, expressionRaw, settings, macroBindings } = params;
  const variableName = settings.variable;
  const sampleValues = resolvePlotSampleValues(settings);
  return sampleValues.map((sampleValue) => {
    const sampleBinding: MacroBinding = {
      kind: "text",
      value: formatPlotSampleValue(sampleValue),
      provenance: []
    };
    const previousBinding = readContextMacroBinding(context, variableName, consumerStatementId);
    writeContextMacroBinding(context, variableName, sampleBinding);
    const expandedExpression = expandMacroBindings(expressionRaw, macroBindings, {
      maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH
    });
    if (previousBinding) {
      writeContextMacroBinding(context, variableName, previousBinding);
    } else {
      deleteContextMacroBinding(context, variableName);
    }
    return { raw: expandedExpression };
  });
}

export function defaultEvaluateCoordinateRaw(
  raw: string,
  contextCurrentPoint: WorldPoint | null,
  setContextCurrentPoint: (point: WorldPoint | null) => void,
  context: Parameters<typeof evaluateRawCoordinate>[1],
  relativePrefix?: "+" | "++"
): ReturnType<typeof evaluateRawCoordinate> {
  setContextCurrentPoint(contextCurrentPoint);
  return evaluateRawCoordinate(raw, context, relativePrefix);
}
