import { arrowLocalPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { ArrowTip } from "../../semantic/types.js";
import { buildArrowTipMetrics, normalizeArrowTip } from "./metrics.js";
import { buildLocalTipPaths } from "./shapes.js";
import type { ArrowLocalPathCommand, NormalizedArrowTip } from "./types.js";
import { formatSvgNumber as fmt } from "../format.js";

export type ArrowTipPreviewPath = {
  d: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
};

export type ArrowTipPreviewRender = {
  paths: ArrowTipPreviewPath[];
  xBounds: { min: number; max: number };
};

export function renderArrowTipPreviewPaths(
  tip: ArrowTip,
  contextLineWidth: number,
  markerColor = "currentColor",
  options: { anchor?: "line-end" | "back" } = {}
): ArrowTipPreviewRender {
  const normalized = normalizeArrowTip(tip, contextLineWidth, markerColor);
  const metrics = buildArrowTipMetrics(normalized, contextLineWidth);
  const anchor = options.anchor ?? "line-end";
  const anchorShift = anchor === "back" ? metrics.lineEnd : 0;
  const paths = buildLocalTipPaths(normalized, metrics).map((path) => shiftPath(path, anchorShift));
  const paint = resolveTipPaint(normalized, contextLineWidth, markerColor);

  return {
    paths: paths.map((commands) => ({
      d: encodePathData(commands),
      stroke: paint.stroke,
      fill: paint.fill,
      strokeWidth: paint.strokeWidth,
      lineCap: paint.lineCap,
      lineJoin: paint.lineJoin
    })),
    xBounds: collectPathXBounds(paths)
  };
}

function resolveTipPaint(
  tip: NormalizedArrowTip,
  contextLineWidth: number,
  markerColor: string
): {
  stroke: string;
  fill: string;
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
} {
  const color = tip.color ?? markerColor;
  const strokeOnlyKinds = new Set([
    "bar",
    "hooks",
    "cm-rightarrow",
    "straight-barb",
    "arc-barb",
    "tee-barb",
    "rays"
  ]);
  const fillDefault = tip.open || strokeOnlyKinds.has(tip.kind) ? "none" : color;
  const fill = tip.fill ?? fillDefault;

  const explicitStrokeOnly = strokeOnlyKinds.has(tip.kind);
  const shouldStroke = explicitStrokeOnly || tip.open || tip.lineWidth > 0;
  const stroke = shouldStroke ? color : "none";
  const fallbackWidth = Number.isFinite(contextLineWidth) && contextLineWidth > 0 ? contextLineWidth : 0.4;
  const strokeWidth = stroke === "none" ? 0 : Math.max(tip.lineWidth, fallbackWidth);

  const rounded =
    tip.round ||
    tip.kind === "cm-rightarrow" ||
    tip.kind === "hooks" ||
    tip.kind === "circle" ||
    tip.kind === "round-cap";
  return {
    stroke,
    fill,
    strokeWidth,
    lineCap: rounded ? "round" : "butt",
    lineJoin: rounded ? "round" : "miter"
  };
}

function encodePathData(commands: ArrowLocalPathCommand[]): string {
  const segments: string[] = [];
  for (const command of commands) {
    if (command.kind === "M") {
      segments.push(`M ${fmt(command.to.x)} ${fmt(command.to.y)}`);
      continue;
    }
    if (command.kind === "L") {
      segments.push(`L ${fmt(command.to.x)} ${fmt(command.to.y)}`);
      continue;
    }
    if (command.kind === "C") {
      segments.push(
        `C ${fmt(command.c1.x)} ${fmt(command.c1.y)} ${fmt(command.c2.x)} ${fmt(command.c2.y)} ${fmt(command.to.x)} ${fmt(command.to.y)}`
      );
      continue;
    }
    if (command.kind === "A") {
      segments.push(
        `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(command.xAxisRotation)} ${command.largeArc ? 1 : 0} ${command.sweep ? 1 : 0} ${fmt(command.to.x)} ${fmt(command.to.y)}`
      );
      continue;
    }
    segments.push("Z");
  }
  return segments.join(" ");
}

function shiftPath(commands: ArrowLocalPathCommand[], deltaX: number): ArrowLocalPathCommand[] {
  if (Math.abs(deltaX) <= 1e-9) {
    return commands;
  }

  return commands.map((command) => {
    if (command.kind === "M" || command.kind === "L" || command.kind === "A") {
      return {
        ...command,
        to: arrowLocalPoint(pt(command.to.x + deltaX), pt(command.to.y))
      };
    }
    if (command.kind === "C") {
      return {
        ...command,
        c1: arrowLocalPoint(pt(command.c1.x + deltaX), pt(command.c1.y)),
        c2: arrowLocalPoint(pt(command.c2.x + deltaX), pt(command.c2.y)),
        to: arrowLocalPoint(pt(command.to.x + deltaX), pt(command.to.y))
      };
    }
    return command;
  });
}

function collectPathXBounds(paths: ArrowLocalPathCommand[][]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const commands of paths) {
    for (const command of commands) {
      if (command.kind === "M" || command.kind === "L" || command.kind === "A") {
        min = Math.min(min, command.to.x);
        max = Math.max(max, command.to.x);
        continue;
      }
      if (command.kind === "C") {
        min = Math.min(min, command.c1.x, command.c2.x, command.to.x);
        max = Math.max(max, command.c1.x, command.c2.x, command.to.x);
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 0 };
  }
  return { min, max };
}
