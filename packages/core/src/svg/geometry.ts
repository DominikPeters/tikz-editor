import { worldToSvgPoint } from "../coords/svg.js";
import { pt } from "../coords/scalars.js";
import { svgPoint, svgBounds, worldPoint } from "../coords/points.js";
import type { SvgBounds, SvgPoint, WorldPoint } from "../coords/points.js";
import type { SvgTransform } from "../coords/transforms.js";
import type { ScenePathCommand } from "../semantic/types.js";
import type { SvgViewBox } from "./types.js";
import { commandsToSegments, sampleFrameFromStartExtrapolated, sampleFrameFromEndExtrapolated } from "../geometry/path-sampler.js";

export function computeSvgPathBounds(commands: ScenePathCommand[], viewBox: Pick<SvgViewBox, "y" | "height">): SvgBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: SvgPoint | null = null;
  let subpathStart: SvgPoint | null = null;

  const includePoint = (point: SvgPoint) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of commands) {
    if (command.kind === "Z") {
      previous = subpathStart;
      continue;
    }

    if (command.kind === "A") {
      const to = worldToSvgPoint(command.to, viewBox);
      if (previous) {
        includeSvgArcBounds({
          start: previous,
          end: to,
          rx: command.rx,
          ry: command.ry,
          xAxisRotation: -command.xAxisRotation,
          largeArc: command.largeArc,
          sweep: command.sweep ? 0 : 1,
          includePoint
        });
      } else {
        includePoint(to);
      }
      previous = to;
      continue;
    }

    if (command.kind === "C") {
      const to = worldToSvgPoint(command.to, viewBox);
      if (previous) {
        includePoint(to);
        for (const point of cubicExtremaPoints(
          previous,
          worldToSvgPoint(command.c1, viewBox),
          worldToSvgPoint(command.c2, viewBox),
          to
        )) {
          includePoint(point);
        }
      } else {
        includePoint(to);
      }
      previous = to;
      continue;
    }

    const point = worldToSvgPoint(command.to, viewBox);
    if (command.kind === "M") {
      subpathStart = point;
    }
    includePoint(point);
    previous = point;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

type StrokeDirection = { x: number; y: number };
type StrokeSegment = { from: WorldPoint; to: WorldPoint; start: StrokeDirection; end: StrokeDirection };

/** Conservative curve-stroke bounds, with actual SVG miter joins and square caps. */
export function computeSvgStrokedPathBounds(
  commands: ScenePathCommand[],
  viewBox: Pick<SvgViewBox, "y" | "height">,
  stroke: { strokeWidth: number; lineCap: "butt" | "round" | "square"; lineJoin: "miter" | "round" | "bevel"; miterLimit?: number }
): SvgBounds | null {
  const centerline = computeSvgPathBounds(commands, viewBox);
  if (!centerline || !(stroke.strokeWidth > 0)) return centerline;
  const halfWidth = stroke.strokeWidth / 2;
  let minX = centerline.minX - halfWidth;
  let minY = centerline.minY - halfWidth;
  let maxX = centerline.maxX + halfWidth;
  let maxY = centerline.maxY + halfWidth;
  const include = (point: WorldPoint, dx: number, dy: number): void => {
    const mapped = worldToSvgPoint(worldPoint(pt(point.x + dx), pt(point.y + dy)), viewBox);
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  };
  const direction = (from: WorldPoint, to: WorldPoint): StrokeDirection | null => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    return length > 1e-9 ? { x: dx / length, y: dy / length } : null;
  };
  const includeJoin = (before: StrokeSegment, after: StrokeSegment): void => {
    if (stroke.lineJoin !== "miter") return;
    const incoming = before.end;
    const outgoing = after.start;
    const turn = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const denominator = 1 + incoming.x * outgoing.x + incoming.y * outgoing.y;
    if (Math.abs(turn) < 1e-9 || denominator <= 1e-9) return;
    const side = turn > 0 ? -1 : 1;
    const dx = side * halfWidth * (-incoming.y - outgoing.y) / denominator;
    const dy = side * halfWidth * (incoming.x + outgoing.x) / denominator;
    // SVG's default miter limit is 4. Larger intersections become bevels,
    // which already fit the half-width envelope above.
    if (Math.hypot(dx, dy) <= (stroke.miterLimit ?? 4) * halfWidth + 1e-9) include(after.from, dx, dy);
  };
  const includeCap = (point: WorldPoint, tangent: StrokeDirection, side: number): void => {
    if (stroke.lineCap !== "square") return;
    for (const normalSide of [-1, 1]) {
      include(point, halfWidth * (side * tangent.x - normalSide * tangent.y),
        halfWidth * (side * tangent.y + normalSide * tangent.x));
    }
  };
  let segments: StrokeSegment[] = [];
  const flush = (closed: boolean): void => {
    for (let index = 1; index < segments.length; index += 1) includeJoin(segments[index - 1], segments[index]);
    if (segments.length > 0) {
      const first = segments[0];
      const last = segments[segments.length - 1];
      if (closed) includeJoin(last, first);
      else {
        includeCap(first.from, first.start, -1);
        includeCap(last.to, last.end, 1);
      }
    }
    segments = [];
  };
  let previous: WorldPoint | null = null;
  let subpathStart: WorldPoint | null = null;
  for (const command of commands) {
    if (command.kind === "M") {
      flush(false);
      previous = subpathStart = command.to;
      continue;
    }
    if (command.kind === "Z") {
      if (previous && subpathStart) {
        const tangent = direction(previous, subpathStart);
        if (tangent) segments.push({ from: previous, to: subpathStart, start: tangent, end: tangent });
      }
      flush(true);
      previous = subpathStart;
      continue;
    }
    if (!previous) {
      previous = subpathStart = command.to;
      continue;
    }
    let start: StrokeDirection | null;
    let end: StrokeDirection | null;
    if (command.kind === "C") {
      start = direction(previous, command.c1) ?? direction(previous, command.c2) ?? direction(previous, command.to);
      end = direction(command.c2, command.to) ?? direction(command.c1, command.to) ?? direction(previous, command.to);
    } else if (command.kind === "A") {
      const arc = commandsToSegments([{ kind: "M", to: previous }, command]);
      start = sampleFrameFromStartExtrapolated(arc, 0)?.tangent ?? null;
      end = sampleFrameFromEndExtrapolated(arc, 0)?.tangent ?? null;
    } else {
      start = end = direction(previous, command.to);
    }
    if (start && end) segments.push({ from: previous, to: command.to, start, end });
    previous = command.to;
  }
  flush(false);
  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function cubicExtremaPoints(p0: SvgPoint, p1: SvgPoint, p2: SvgPoint, p3: SvgPoint): SvgPoint[] {
  const roots = new Set<number>();
  for (const axis of ["x", "y"] as const) {
    for (const root of cubicExtremaRoots(p0[axis], p1[axis], p2[axis], p3[axis])) {
      roots.add(root);
    }
  }
  return [...roots].map((t) => cubicPoint(p0, p1, p2, p3, t));
}

function cubicExtremaRoots(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = -p0 + p1;
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) {
      return [];
    }
    const t = -c / b;
    return t > 0 && t < 1 ? [t] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const sqrt = Math.sqrt(discriminant);
  return [(-b + sqrt) / (2 * a), (-b - sqrt) / (2 * a)].filter((t) => t > 0 && t < 1);
}

function cubicPoint(p0: SvgPoint, p1: SvgPoint, p2: SvgPoint, p3: SvgPoint, t: number): SvgPoint {
  const u = 1 - t;
  return svgPoint(
    pt(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x),
    pt(u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y)
  );
}

export function includeSvgArcBounds(args: {
  start: SvgPoint;
  end: SvgPoint;
  rx: number;
  ry: number;
  xAxisRotation: number;
  largeArc: boolean;
  sweep: 0 | 1;
  includePoint: (point: SvgPoint) => void;
}): void {
  const { start, end, xAxisRotation, largeArc, sweep, includePoint } = args;
  let rx = Math.abs(args.rx);
  let ry = Math.abs(args.ry);
  includePoint(start);
  includePoint(end);
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
    return;
  }

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (start.x - end.x) / 2;
  const dy2 = (start.y - end.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const numerator = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const denominator = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const factor = denominator <= 1e-12 ? 0 : Math.sqrt(Math.max(0, numerator / denominator));
  const sign = largeArc === Boolean(sweep) ? -1 : 1;
  const cxp = sign * factor * ((rx * y1p) / ry);
  const cyp = sign * factor * ((-ry * x1p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = Math.atan2(uy, ux);
  let deltaTheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (sweep === 0 && deltaTheta > 0) {
    deltaTheta -= Math.PI * 2;
  } else if (sweep === 1 && deltaTheta < 0) {
    deltaTheta += Math.PI * 2;
  }

  const candidates = [
    Math.atan2(-ry * sinPhi, rx * cosPhi),
    Math.atan2(-ry * sinPhi, rx * cosPhi) + Math.PI,
    Math.atan2(ry * cosPhi, rx * sinPhi),
    Math.atan2(ry * cosPhi, rx * sinPhi) + Math.PI
  ];

  for (const angle of candidates) {
    if (!isAngleOnArc(angle, theta1, deltaTheta)) {
      continue;
    }
    const cosT = Math.cos(angle);
    const sinT = Math.sin(angle);
    includePoint(
      svgPoint(
        pt(cx + rx * cosPhi * cosT - ry * sinPhi * sinT),
        pt(cy + rx * sinPhi * cosT + ry * cosPhi * sinT)
      )
    );
  }
}

export function computeSvgEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): SvgBounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
  return svgBounds(pt(cx - extentX), pt(cy - extentY), pt(cx + extentX), pt(cy + extentY));
}

export function transformSvgBounds(bounds: SvgBounds, transform: SvgTransform): SvgBounds {
  const corners: SvgPoint[] = [
    svgPoint(pt(bounds.minX), pt(bounds.minY)),
    svgPoint(pt(bounds.maxX), pt(bounds.minY)),
    svgPoint(pt(bounds.maxX), pt(bounds.maxY)),
    svgPoint(pt(bounds.minX), pt(bounds.maxY))
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of corners) {
    const mapped = svgPoint(
      pt(transform.a * point.x + transform.c * point.y + transform.e),
      pt(transform.b * point.x + transform.d * point.y + transform.f)
    );
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  }
  return svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function isAngleOnArc(angle: number, startAngle: number, deltaAngle: number): boolean {
  const tau = Math.PI * 2;
  const normalize = (value: number): number => {
    let normalized = value % tau;
    if (normalized < 0) {
      normalized += tau;
    }
    return normalized;
  };

  const epsilon = 1e-9;
  if (deltaAngle >= 0) {
    const distance = normalize(angle - startAngle);
    return distance <= deltaAngle + epsilon;
  }
  const distance = normalize(startAngle - angle);
  return distance <= -deltaAngle + epsilon;
}
