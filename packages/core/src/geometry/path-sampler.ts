import { worldPoint, worldVector } from "../coords/points.js";
import { pt } from "../coords/scalars.js";
import type { WorldPoint, WorldVector } from "../coords/points.js";
import type { ScenePathCommand } from "../semantic/types.js";

export type Frame = {
  point: WorldPoint;
  tangent: WorldVector;
  normal: WorldVector;
};

const EPSILON = 1e-9;

export type DrawableCommand = Extract<ScenePathCommand, { kind: "L" | "C" | "A" }>;

type ArcGeometry = {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  phi: number;
  xAxisRotation: number;
  startAngle: number;
  deltaAngle: number;
};

export type PathSegment =
  | {
      kind: "L";
      from: WorldPoint;
      to: WorldPoint;
      command: Extract<ScenePathCommand, { kind: "L" }>;
      length: number;
    }
  | {
      kind: "C";
      from: WorldPoint;
      to: WorldPoint;
      command: Extract<ScenePathCommand, { kind: "C" }>;
      length: number;
    }
  | {
      kind: "A";
      from: WorldPoint;
      to: WorldPoint;
      command: Extract<ScenePathCommand, { kind: "A" }>;
      length: number;
      arc: ArcGeometry | null;
    };

type PathMetrics = {
  totalLength: number;
  cumulativeLengths: number[];
};

type LengthParameterTable = {
  parameters: number[];
  cumulativeLengths: number[];
  measurementScale: number;
  totalLength: number;
};

const LENGTH_PARAMETER_TABLE_STEPS = 32;
const LENGTH_PARAMETER_REFINE_STEPS = 12;
const pathMetricsCache = new WeakMap<readonly PathSegment[], PathMetrics>();
const lengthParameterTableCache = new WeakMap<PathSegment, LengthParameterTable>();

export function clonePoint(point: WorldPoint): WorldPoint {
  return worldPoint(pt(point.x), pt(point.y));
}

export function addPoint(left: WorldPoint, right: WorldVector): WorldPoint {
  return worldPoint(pt(left.x + right.x), pt(left.y + right.y));
}

export function subtractPoint(left: WorldPoint, right: WorldPoint): WorldVector {
  return worldVector(pt(left.x - right.x), pt(left.y - right.y));
}

export function scaleVector(vector: WorldVector, factor: number): WorldVector {
  return worldVector(pt(vector.x * factor), pt(vector.y * factor));
}

export function lengthOfVector(vector: WorldVector): number {
  return Math.hypot(vector.x, vector.y);
}

export function normalizeVector(vector: WorldVector): WorldVector {
  const length = lengthOfVector(vector);
  if (length <= EPSILON) {
    return worldVector(pt(1), pt(0));
  }
  return worldVector(pt(vector.x / length), pt(vector.y / length));
}

export function perpendicular(vector: WorldVector): WorldVector {
  return worldVector(pt(-1 * vector.y), pt(vector.x));
}

export function clonePathCommand(command: ScenePathCommand): ScenePathCommand {
  if (command.kind === "M" || command.kind === "L") {
    return { kind: command.kind, to: clonePoint(command.to) };
  }
  if (command.kind === "C") {
    return { kind: "C", c1: clonePoint(command.c1), c2: clonePoint(command.c2), to: clonePoint(command.to) };
  }
  if (command.kind === "A") {
    return {
      kind: "A",
      rx: command.rx,
      ry: command.ry,
      xAxisRotation: command.xAxisRotation,
      largeArc: command.largeArc,
      sweep: command.sweep,
      to: clonePoint(command.to)
    };
  }
  return { kind: "Z" };
}

export function splitPathIntoSubpaths(commands: ScenePathCommand[]): ScenePathCommand[][] {
  const subpaths: ScenePathCommand[][] = [];
  let current: ScenePathCommand[] = [];

  for (const command of commands) {
    if (command.kind === "M" && current.length > 0) {
      subpaths.push(current);
      current = [clonePathCommand(command)];
      continue;
    }
    current.push(clonePathCommand(command));
  }

  if (current.length > 0) {
    subpaths.push(current);
  }
  return subpaths;
}

export function flattenSubpaths(subpaths: ScenePathCommand[][]): ScenePathCommand[] {
  const flattened: ScenePathCommand[] = [];
  for (const subpath of subpaths) {
    for (const command of subpath) {
      flattened.push(clonePathCommand(command));
    }
  }
  return flattened;
}

export function hasDrawablePathCommands(commands: ScenePathCommand[]): boolean {
  return commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

export function commandsToSegments(commands: ScenePathCommand[]): PathSegment[] {
  const segments: PathSegment[] = [];
  let current: WorldPoint | null = null;

  for (const command of commands) {
    if (command.kind === "M") {
      current = clonePoint(command.to);
      continue;
    }

    if (command.kind === "Z") {
      current = null;
      continue;
    }

    if (!current) {
      current = clonePoint(command.to);
      continue;
    }

    if (command.kind === "L") {
      const to = clonePoint(command.to);
      segments.push({
        kind: "L",
        from: current,
        to,
        command: { kind: "L", to: clonePoint(command.to) },
        length: lineLength(current, to)
      });
      current = to;
      continue;
    }

    if (command.kind === "C") {
      const to = clonePoint(command.to);
      const c1 = clonePoint(command.c1);
      const c2 = clonePoint(command.c2);
      const length = cubicLength(current, c1, c2, to, 0, 1);
      segments.push({
        kind: "C",
        from: current,
        to,
        command: { kind: "C", c1, c2, to: clonePoint(command.to) },
        length
      });
      current = to;
      continue;
    }

    const to = clonePoint(command.to);
    const arc = command.rx > EPSILON && command.ry > EPSILON ? arcEndpointToCenter(current, command) : null;
    const length = arc ? arcLength(arc, 0, 1) : lineLength(current, to);
    segments.push({
      kind: "A",
      from: current,
      to,
      command: {
        kind: "A",
        rx: command.rx,
        ry: command.ry,
        xAxisRotation: command.xAxisRotation,
        largeArc: command.largeArc,
        sweep: command.sweep,
        to: clonePoint(command.to)
      },
      length,
      arc
    });
    current = to;
  }

  return segments;
}

export function totalSegmentLength(segments: PathSegment[]): number {
  return pathMetricsForSegments(segments).totalLength;
}

export function sampleFrameFromStartExtrapolated(segments: PathSegment[], distance: number): Frame | null {
  if (segments.length === 0) {
    return null;
  }

  const metrics = pathMetricsForSegments(segments);
  const totalLength = metrics.totalLength;
  if (distance <= 0) {
    const frame = sampleSegmentFrameAtDistance(segments[0], 0);
    const shifted = addPoint(frame.point, scaleVector(frame.tangent, distance));
    return { point: shifted, tangent: frame.tangent, normal: frame.normal };
  }

  if (distance >= totalLength) {
    const last = segments[segments.length - 1];
    const frame = sampleSegmentFrameAtDistance(last, last.length);
    const shifted = addPoint(frame.point, scaleVector(frame.tangent, distance - totalLength));
    return { point: shifted, tangent: frame.tangent, normal: frame.normal };
  }

  const hit = segmentAtDistanceFromStart(segments, metrics, distance);
  return sampleSegmentFrameAtDistance(hit.segment, hit.localDistance);
}

export function sampleFrameFromEndExtrapolated(segments: PathSegment[], distance: number): Frame | null {
  if (segments.length === 0) {
    return null;
  }

  const metrics = pathMetricsForSegments(segments);
  const totalLength = metrics.totalLength;
  const first = segments[0];
  const last = segments[segments.length - 1];

  if (distance <= 0) {
    const frame = sampleSegmentFrameAtDistance(last, last.length);
    const shifted = addPoint(frame.point, scaleVector(frame.tangent, -distance));
    return { point: shifted, tangent: frame.tangent, normal: frame.normal };
  }

  if (distance >= totalLength) {
    const frame = sampleSegmentFrameAtDistance(first, 0);
    const shifted = addPoint(frame.point, scaleVector(frame.tangent, -(distance - totalLength)));
    return { point: shifted, tangent: frame.tangent, normal: frame.normal };
  }

  const hit = segmentAtDistanceFromStart(segments, metrics, totalLength - distance);
  return sampleSegmentFrameAtDistance(hit.segment, hit.localDistance);
}

export function samplePointFromStartExtrapolated(segments: PathSegment[], distance: number): WorldPoint | null {
  const frame = sampleFrameFromStartExtrapolated(segments, distance);
  return frame ? frame.point : null;
}

function pathMetricsForSegments(segments: readonly PathSegment[]): PathMetrics {
  const cached = pathMetricsCache.get(segments);
  if (cached) {
    return cached;
  }
  let totalLength = 0;
  const cumulativeLengths: number[] = [];
  for (const segment of segments) {
    totalLength += segment.length;
    cumulativeLengths.push(totalLength);
  }
  const metrics = { totalLength, cumulativeLengths };
  pathMetricsCache.set(segments, metrics);
  return metrics;
}

function segmentAtDistanceFromStart(
  segments: readonly PathSegment[],
  metrics: PathMetrics,
  distance: number
): { segment: PathSegment; localDistance: number } {
  const index = findFirstCumulativeDistanceAtLeast(metrics.cumulativeLengths, distance);
  const segment = segments[index] ?? segments[segments.length - 1];
  const previousDistance = index > 0 ? metrics.cumulativeLengths[index - 1] ?? 0 : 0;
  return {
    segment,
    localDistance: distance - previousDistance
  };
}

function findFirstCumulativeDistanceAtLeast(cumulativeLengths: readonly number[], distance: number): number {
  let low = 0;
  let high = cumulativeLengths.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if ((cumulativeLengths[mid] ?? 0) < distance) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function commandFromSegment(segment: PathSegment): DrawableCommand {
  if (segment.kind === "L") {
    return { kind: "L", to: clonePoint(segment.to) };
  }
  if (segment.kind === "C") {
    return {
      kind: "C",
      c1: clonePoint(segment.command.c1),
      c2: clonePoint(segment.command.c2),
      to: clonePoint(segment.to)
    };
  }
  return {
    kind: "A",
    rx: segment.command.rx,
    ry: segment.command.ry,
    xAxisRotation: segment.command.xAxisRotation,
    largeArc: segment.command.largeArc,
    sweep: segment.command.sweep,
    to: clonePoint(segment.to)
  };
}

export function sliceSegment(segment: PathSegment, startDistance: number, endDistance: number): PathSegment | null {
  const length = Math.max(segment.length, 0);
  const localStart = clamp(startDistance, 0, length);
  const localEnd = clamp(endDistance, 0, length);
  if (localEnd - localStart <= EPSILON) {
    return null;
  }

  if (segment.kind === "L" || length <= EPSILON) {
    const startPoint = interpolateLine(segment.from, segment.to, localStart / Math.max(length, 1));
    const endPoint = interpolateLine(segment.from, segment.to, localEnd / Math.max(length, 1));
    return {
      kind: "L",
      from: startPoint,
      to: endPoint,
      command: { kind: "L", to: clonePoint(endPoint) },
      length: lineLength(startPoint, endPoint)
    };
  }

  if (segment.kind === "C") {
    const t0 = parameterAtSegmentDistance(segment, localStart);
    const t1 = parameterAtSegmentDistance(segment, localEnd);
    const [p0, p1, p2, p3] = sliceCubic(segment.from, segment.command.c1, segment.command.c2, segment.to, t0, t1);
    return {
      kind: "C",
      from: p0,
      to: p3,
      command: { kind: "C", c1: p1, c2: p2, to: clonePoint(p3) },
      length: cubicLength(p0, p1, p2, p3, 0, 1)
    };
  }

  if (!segment.arc) {
    const startPoint = interpolateLine(segment.from, segment.to, localStart / Math.max(length, 1));
    const endPoint = interpolateLine(segment.from, segment.to, localEnd / Math.max(length, 1));
    return {
      kind: "L",
      from: startPoint,
      to: endPoint,
      command: { kind: "L", to: clonePoint(endPoint) },
      length: lineLength(startPoint, endPoint)
    };
  }

  const arc = segment.arc;
  const u0 = parameterAtSegmentDistance(segment, localStart);
  const u1 = parameterAtSegmentDistance(segment, localEnd);
  const startPoint = pointOnArc(arc, u0);
  const endPoint = pointOnArc(arc, u1);
  const delta = arc.deltaAngle * (u1 - u0);
  const largeArc = Math.abs(delta) > Math.PI + 1e-6;
  return {
    kind: "A",
    from: startPoint,
    to: endPoint,
    command: {
      kind: "A",
      rx: arc.rx,
      ry: arc.ry,
      xAxisRotation: arc.xAxisRotation,
      largeArc,
      sweep: delta >= 0,
      to: clonePoint(endPoint)
    },
    length: arcLength(arc, u0, u1),
    arc: {
      ...arc,
      startAngle: arc.startAngle + arc.deltaAngle * u0,
      deltaAngle: delta
    }
  };
}

function sampleSegmentFrameAtDistance(segment: PathSegment, distance: number): Frame {
  const safeLength = Math.max(segment.length, 0);
  const localDistance = clamp(distance, 0, safeLength);
  if (segment.kind === "L" || safeLength <= EPSILON) {
    const ratio = safeLength <= EPSILON ? 0 : localDistance / safeLength;
    const point = interpolateLine(segment.from, segment.to, ratio);
    const tangent = normalizeVector(subtractPoint(segment.to, segment.from));
    const normal = perpendicular(tangent);
    return { point, tangent, normal };
  }

  if (segment.kind === "C") {
    const t = parameterAtSegmentDistance(segment, localDistance);
    const point = pointOnCubic(segment.from, segment.command.c1, segment.command.c2, segment.to, t);
    const derivative = derivativeOnCubic(segment.from, segment.command.c1, segment.command.c2, segment.to, t);
    const tangent =
      lengthOfVector(derivative) <= EPSILON ? normalizeVector(subtractPoint(segment.to, segment.from)) : normalizeVector(derivative);
    const normal = perpendicular(tangent);
    return { point, tangent, normal };
  }

  if (segment.arc) {
    const u = parameterAtSegmentDistance(segment, localDistance);
    const point = pointOnArc(segment.arc, u);
    const derivative = derivativeOnArc(segment.arc, u);
    const tangent =
      lengthOfVector(derivative) <= EPSILON ? normalizeVector(subtractPoint(segment.to, segment.from)) : normalizeVector(derivative);
    const normal = perpendicular(tangent);
    return { point, tangent, normal };
  }

  const ratio = safeLength <= EPSILON ? 0 : localDistance / safeLength;
  const point = interpolateLine(segment.from, segment.to, ratio);
  const tangent = normalizeVector(subtractPoint(segment.to, segment.from));
  const normal = perpendicular(tangent);
  return { point, tangent, normal };
}

function parameterAtSegmentDistance(segment: PathSegment, distance: number): number {
  const safeLength = Math.max(segment.length, 0);
  if (safeLength <= EPSILON) {
    return 0;
  }
  const target = clamp(distance, 0, safeLength);
  if (target <= EPSILON) {
    return 0;
  }
  if (target >= safeLength - EPSILON) {
    return 1;
  }

  if (segment.kind === "C") {
    return parameterAtCurvedSegmentDistance(segment, target, (start, end) =>
      cubicLength(segment.from, segment.command.c1, segment.command.c2, segment.to, start, end)
    );
  }
  if (segment.kind === "A" && segment.arc) {
    const arc = segment.arc;
    return parameterAtCurvedSegmentDistance(segment, target, (start, end) => arcLength(arc, start, end));
  }
  return target / safeLength;
}

function parameterAtCurvedSegmentDistance(
  segment: PathSegment,
  distance: number,
  measureBetween: (start: number, end: number) => number
): number {
  const table = lengthParameterTableForSegment(segment, measureBetween);
  if (table.totalLength <= EPSILON) {
    return 0;
  }
  const scaledDistance = clamp(distance, 0, Math.max(segment.length, EPSILON)) * (table.totalLength / Math.max(segment.length, EPSILON));
  const index = findFirstCumulativeDistanceAtLeast(table.cumulativeLengths, scaledDistance);
  const previousIndex = Math.max(0, index - 1);
  const t0 = table.parameters[previousIndex] ?? 0;
  const t1 = table.parameters[index] ?? 1;
  const distanceBefore = table.cumulativeLengths[previousIndex] ?? 0;
  const targetInInterval = scaledDistance - distanceBefore;
  if (t1 - t0 <= EPSILON) {
    return t0;
  }

  let low = t0;
  let high = t1;
  for (let step = 0; step < LENGTH_PARAMETER_REFINE_STEPS; step += 1) {
    const mid = (low + high) / 2;
    const measured = measureBetween(t0, mid) * table.measurementScale;
    if (measured < targetInInterval) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function lengthParameterTableForSegment(
  segment: PathSegment,
  measureBetween: (start: number, end: number) => number
): LengthParameterTable {
  const cached = lengthParameterTableCache.get(segment);
  if (cached) {
    return cached;
  }

  const parameters: number[] = [0];
  const rawCumulativeLengths: number[] = [0];
  let rawTotalLength = 0;
  let previousParameter = 0;
  for (let step = 1; step <= LENGTH_PARAMETER_TABLE_STEPS; step += 1) {
    const parameter = step / LENGTH_PARAMETER_TABLE_STEPS;
    rawTotalLength += measureBetween(previousParameter, parameter);
    parameters.push(parameter);
    rawCumulativeLengths.push(rawTotalLength);
    previousParameter = parameter;
  }

  const scale = rawTotalLength > EPSILON ? Math.max(segment.length, 0) / rawTotalLength : 1;
  const cumulativeLengths = rawCumulativeLengths.map((length) => length * scale);
  const finalIndex = cumulativeLengths.length - 1;
  if (finalIndex >= 0) {
    cumulativeLengths[finalIndex] = Math.max(segment.length, 0);
  }
  const table = {
    parameters,
    cumulativeLengths,
    measurementScale: scale,
    totalLength: Math.max(segment.length, 0)
  };
  lengthParameterTableCache.set(segment, table);
  return table;
}

function lineLength(from: WorldPoint, to: WorldPoint): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function interpolateLine(from: WorldPoint, to: WorldPoint, ratio: number): WorldPoint {
  const t = clamp(ratio, 0, 1);
  return worldPoint(
    pt(from.x + (to.x - from.x) * t),
    pt(from.y + (to.y - from.y) * t)
  );
}

function cubicLength(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, t0: number, t1: number): number {
  const start = clamp(t0, 0, 1);
  const end = clamp(t1, 0, 1);
  if (end - start <= EPSILON) {
    return 0;
  }
  return integrateSimpson((t) => {
    const d = derivativeOnCubic(p0, p1, p2, p3, t);
    return Math.hypot(d.x, d.y);
  }, start, end, 30);
}

function pointOnCubic(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, t: number): WorldPoint {
  const u = clamp(t, 0, 1);
  const oneMinus = 1 - u;
  const oneMinusSq = oneMinus * oneMinus;
  const uSq = u * u;
  return worldPoint(
    pt(
      oneMinusSq * oneMinus * p0.x +
      3 * oneMinusSq * u * p1.x +
      3 * oneMinus * uSq * p2.x +
      uSq * u * p3.x
    ),
    pt(
      oneMinusSq * oneMinus * p0.y +
      3 * oneMinusSq * u * p1.y +
      3 * oneMinus * uSq * p2.y +
      uSq * u * p3.y
    )
  );
}

function derivativeOnCubic(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, t: number): WorldVector {
  const u = clamp(t, 0, 1);
  const oneMinus = 1 - u;
  return worldVector(
    pt(3 * oneMinus * oneMinus * (p1.x - p0.x) +
      6 * oneMinus * u * (p2.x - p1.x) +
      3 * u * u * (p3.x - p2.x)),
    pt(3 * oneMinus * oneMinus * (p1.y - p0.y) +
      6 * oneMinus * u * (p2.y - p1.y) +
      3 * u * u * (p3.y - p2.y))
  );
}

function splitCubic(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, t: number): [[WorldPoint, WorldPoint, WorldPoint, WorldPoint], [WorldPoint, WorldPoint, WorldPoint, WorldPoint]] {
  const u = clamp(t, 0, 1);
  const p01 = interpolateLine(p0, p1, u);
  const p12 = interpolateLine(p1, p2, u);
  const p23 = interpolateLine(p2, p3, u);
  const p012 = interpolateLine(p01, p12, u);
  const p123 = interpolateLine(p12, p23, u);
  const p0123 = interpolateLine(p012, p123, u);
  return [
    [p0, p01, p012, p0123],
    [p0123, p123, p23, p3]
  ];
}

function sliceCubic(p0: WorldPoint, p1: WorldPoint, p2: WorldPoint, p3: WorldPoint, t0: number, t1: number): [WorldPoint, WorldPoint, WorldPoint, WorldPoint] {
  const start = clamp(t0, 0, 1);
  const end = clamp(t1, 0, 1);
  if (end <= start + EPSILON) {
    const point = pointOnCubic(p0, p1, p2, p3, start);
    return [point, point, point, point];
  }
  if (start <= EPSILON && end >= 1 - EPSILON) {
    return [clonePoint(p0), clonePoint(p1), clonePoint(p2), clonePoint(p3)];
  }
  if (start <= EPSILON) {
    const [left] = splitCubic(p0, p1, p2, p3, end);
    return left;
  }
  if (end >= 1 - EPSILON) {
    const [, right] = splitCubic(p0, p1, p2, p3, start);
    return right;
  }
  const [left] = splitCubic(p0, p1, p2, p3, end);
  const ratio = start / end;
  const [, middle] = splitCubic(left[0], left[1], left[2], left[3], ratio);
  return middle;
}

function arcEndpointToCenter(from: WorldPoint, command: Extract<ScenePathCommand, { kind: "A" }>): ArcGeometry | null {
  const to = command.to;
  let rx = Math.abs(command.rx);
  let ry = Math.abs(command.ry);
  if (rx <= EPSILON || ry <= EPSILON) {
    return null;
  }

  const phi = (command.xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1Prime = cosPhi * dx + sinPhi * dy;
  const y1Prime = -sinPhi * dx + cosPhi * dy;

  const lambda = x1Prime * x1Prime / (rx * rx) + y1Prime * y1Prime / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1PrimeSq = x1Prime * x1Prime;
  const y1PrimeSq = y1Prime * y1Prime;
  const sign = command.largeArc === command.sweep ? -1 : 1;
  const numerator = Math.max(0, rxSq * rySq - rxSq * y1PrimeSq - rySq * x1PrimeSq);
  const denominator = Math.max(EPSILON, rxSq * y1PrimeSq + rySq * x1PrimeSq);
  const factor = sign * Math.sqrt(numerator / denominator);
  const cxPrime = factor * ((rx * y1Prime) / ry);
  const cyPrime = factor * (-(ry * x1Prime) / rx);

  const cx = cosPhi * cxPrime - sinPhi * cyPrime + (from.x + to.x) / 2;
  const cy = sinPhi * cxPrime + cosPhi * cyPrime + (from.y + to.y) / 2;

  const ux = (x1Prime - cxPrime) / rx;
  const uy = (y1Prime - cyPrime) / ry;
  const vx = (-x1Prime - cxPrime) / rx;
  const vy = (-y1Prime - cyPrime) / ry;
  const startAngle = Math.atan2(uy, ux);
  let deltaAngle = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!command.sweep && deltaAngle > 0) {
    deltaAngle -= Math.PI * 2;
  } else if (command.sweep && deltaAngle < 0) {
    deltaAngle += Math.PI * 2;
  }

  return {
    cx,
    cy,
    rx,
    ry,
    phi,
    xAxisRotation: command.xAxisRotation,
    startAngle,
    deltaAngle
  };
}

function arcLength(arc: ArcGeometry, start: number, end: number): number {
  const u0 = clamp(start, 0, 1);
  const u1 = clamp(end, 0, 1);
  if (u1 - u0 <= EPSILON) {
    return 0;
  }
  return integrateSimpson((u) => {
    const derivative = derivativeOnArc(arc, u);
    return Math.hypot(derivative.x, derivative.y);
  }, u0, u1, 32);
}

function pointOnArc(arc: ArcGeometry, t: number): WorldPoint {
  const u = clamp(t, 0, 1);
  const theta = arc.startAngle + arc.deltaAngle * u;
  const cosPhi = Math.cos(arc.phi);
  const sinPhi = Math.sin(arc.phi);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  return worldPoint(
    pt(arc.cx + arc.rx * cosPhi * cosTheta - arc.ry * sinPhi * sinTheta),
    pt(arc.cy + arc.rx * sinPhi * cosTheta + arc.ry * cosPhi * sinTheta)
  );
}

function derivativeOnArc(arc: ArcGeometry, t: number): WorldVector {
  const u = clamp(t, 0, 1);
  const theta = arc.startAngle + arc.deltaAngle * u;
  const cosPhi = Math.cos(arc.phi);
  const sinPhi = Math.sin(arc.phi);
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);
  const dTheta = arc.deltaAngle;
  return worldVector(
    pt(dTheta * (-arc.rx * cosPhi * sinTheta - arc.ry * sinPhi * cosTheta)),
    pt(dTheta * (-arc.rx * sinPhi * sinTheta + arc.ry * cosPhi * cosTheta))
  );
}

function integrateSimpson(fn: (t: number) => number, start: number, end: number, steps: number): number {
  const n = Math.max(2, steps + (steps % 2));
  const h = (end - start) / n;
  let sum = fn(start) + fn(end);
  for (let i = 1; i < n; i += 1) {
    const x = start + h * i;
    sum += fn(x) * (i % 2 === 0 ? 2 : 4);
  }
  return (h / 3) * sum;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
