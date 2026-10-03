import { worldPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { PathOptionItem } from "../../ast/types.js";
import type { DiagnosticPushFn, ArcParameters, PlacementSegment } from "./types.js";
import { coordinateInner, toRadians } from "./shared.js";
import { parseLength } from "../coords/parse-length.js";
import type { MacroBinding, MacroExpansionTraceEvent } from "../../macros/index.js";
import type { ResolvedStyle, ScenePathCommand } from "../types.js";
import { applyMatrixToVector } from "../transform.js";
import { expandPathMacroBindings } from "./macro-expansion.js";

type BasisVector = Readonly<{ x: number; y: number }>;
type ArcEndpoint = WorldPoint;

function wp(x: number, y: number): WorldPoint {
  return worldPoint(pt(x), pt(y));
}

export function extractArcParameters(
  item: PathOptionItem,
  pushDiagnostic: DiagnosticPushFn,
  style: ResolvedStyle,
  macroBindings?: ReadonlyMap<string, MacroBinding>,
  macroTraceCollector?: MacroExpansionTraceEvent[]
): ArcParameters | null {
  let startAngle: number | null = null;
  let endAngle: number | null = null;
  let deltaAngle: number | null = null;
  let rx: number | null = style.xRadius ?? style.radius;
  let ry: number | null = style.yRadius ?? style.radius;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "start angle") {
      const parsed = Number(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector));
      if (Number.isFinite(parsed)) {
        startAngle = parsed;
      }
    } else if (entry.key === "end angle") {
      const parsed = Number(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector));
      if (Number.isFinite(parsed)) {
        endAngle = parsed;
      }
    } else if (entry.key === "delta angle") {
      const parsed = Number(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector));
      if (Number.isFinite(parsed)) {
        deltaAngle = parsed;
      }
    } else if (entry.key === "radius") {
      const parsed = parseLength(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        rx = parsed;
        ry = parsed;
      }
    } else if (entry.key === "x radius") {
      const parsed = parseLength(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        rx = parsed;
      }
    } else if (entry.key === "y radius") {
      const parsed = parseLength(expandPathMacroBindings(entry.valueRaw, macroBindings, macroTraceCollector), "cm");
      if (parsed != null) {
        ry = parsed;
      }
    }
  }

  if (startAngle == null) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires a start angle.", item.span.from, item.span.to);
    return null;
  }

  const resolvedEndAngle = endAngle ?? (deltaAngle != null ? startAngle + deltaAngle : null);
  if (resolvedEndAngle == null) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires an end angle or delta angle.", item.span.from, item.span.to);
    return null;
  }

  if (rx != null && ry != null) {
    return {
      startAngle,
      endAngle: resolvedEndAngle,
      rx,
      ry
    };
  }

  pushDiagnostic("invalid-arc-parameters", "Arc requires `radius` or both `x radius` and `y radius`.", item.span.from, item.span.to);
  return null;
}

export function parseArcShorthand(raw: string): ArcParameters | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const parts = splitAllAtTopLevel(inner, ":").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 3) {
    return null;
  }

  const startAngle = Number(parts[0]);
  const endAngle = Number(parts[1]);
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
    return null;
  }

  const radiiSpec = parts[2];
  const elliptical = radiiSpec.match(/^(.+?)\s+and\s+(.+)$/i);
  if (elliptical) {
    const rx = parseLength(elliptical[1].trim(), "cm");
    const ry = parseLength(elliptical[2].trim(), "cm");
    if (rx == null || ry == null) {
      return null;
    }
    return { startAngle, endAngle, rx, ry };
  }

  const radius = parseLength(radiiSpec, "cm");
  if (radius == null) {
    return null;
  }

  return { startAngle, endAngle, rx: radius, ry: radius };
}

export function appendArcCommand(
  commands: ScenePathCommand[],
  from: WorldPoint,
  params: ArcParameters,
  transform: { a: number; b: number; c: number; d: number } = { a: 1, b: 0, c: 0, d: 1 }
): { endpoint: WorldPoint; segment: PlacementSegment } {
  const geometry = computeArcGeometry(from, params, transform);
  commands.push({
    kind: "A",
    rx: geometry.rx,
    ry: geometry.ry,
    xAxisRotation: geometry.xAxisRotation,
    largeArc: Math.abs(params.endAngle - params.startAngle) > 180,
    sweep: geometry.sweep,
    to: geometry.endpoint
  });
  return {
    endpoint: geometry.endpoint,
    segment: {
      kind: "arc",
      from,
      to: geometry.endpoint,
      params,
      basis: geometry.basis,
      turnLookupControl: arcTurnLookupControl(geometry.endpoint, params, transform)
    }
  };
}

/** Mirror pgfpatharc's last cubic piece without changing SVG arc emission. */
function arcTurnLookupControl(
  endpoint: WorldPoint,
  params: ArcParameters,
  transform: { a: number; b: number; c: number; d: number }
): WorldPoint {
  const sweep = params.endAngle - params.startAngle;
  const span = Math.abs(sweep);
  if (!Number.isFinite(span)) return endpoint;
  // PGF takes 90-degree steps above 115 degrees, then a 60-degree step
  // if 90 < remaining <= 115. Arithmetic keeps large finite sweeps bounded.
  let finalSpan = span - Math.max(0, Math.ceil((span - 115) / 90)) * 90;
  if (finalSpan > 90) finalSpan -= 60;
  const factor = finalSpan === 90 ? 0.55228475 : 1.333333333 * Math.tan(toRadians(finalSpan) / 4);
  const radians = toRadians(params.endAngle);
  const sign = sweep >= 0 ? 1 : -1;
  const offset = applyMatrixToVector(transform, {
    x: pt(-params.rx * Math.sin(radians) * sign * factor),
    y: pt(params.ry * Math.cos(radians) * sign * factor)
  });
  return wp(endpoint.x - offset.x, endpoint.y - offset.y);
}

function computeArcGeometry(
  from: WorldPoint,
  params: ArcParameters,
  transform: { a: number; b: number; c: number; d: number }
): {
  endpoint: WorldPoint;
  rx: number;
  ry: number;
  xAxisRotation: number;
  sweep: boolean;
  basis: { x: WorldVector; y: WorldVector };
} {
  const startRadians = toRadians(params.startAngle);
  const endRadians = toRadians(params.endAngle);

  const localStart = worldVector(
    pt(params.rx * Math.cos(startRadians)),
    pt(params.ry * Math.sin(startRadians))
  );
  const localEnd = worldVector(
    pt(params.rx * Math.cos(endRadians)),
    pt(params.ry * Math.sin(endRadians))
  );
  const transformedStart = applyMatrixToVector(transform, localStart);
  const transformedEnd = applyMatrixToVector(transform, localEnd);

  const center = wp(from.x - transformedStart.x, from.y - transformedStart.y);
  const endpoint: ArcEndpoint = wp(center.x + transformedEnd.x, center.y + transformedEnd.y);

  const basisX = applyMatrixToVector(transform, worldVector(pt(params.rx), pt(0))) satisfies BasisVector;
  const basisY = applyMatrixToVector(transform, worldVector(pt(0), pt(params.ry))) satisfies BasisVector;
  const ellipse = ellipseGeometryFromBasis(basisX, basisY);
  const delta = params.endAngle - params.startAngle;
  const baseSweep = delta >= 0;
  const determinant = transform.a * transform.d - transform.b * transform.c;

  return {
    endpoint,
    rx: ellipse.rx,
    ry: ellipse.ry,
    xAxisRotation: ellipse.rotation,
    sweep: determinant < 0 ? !baseSweep : baseSweep,
    basis: { x: basisX, y: basisY }
  };
}

function ellipseGeometryFromBasis(
  basisX: BasisVector,
  basisY: BasisVector
): { rx: number; ry: number; rotation: number } {
  const s11 = basisX.x * basisX.x + basisY.x * basisY.x;
  const s12 = basisX.x * basisX.y + basisY.x * basisY.y;
  const s22 = basisX.y * basisX.y + basisY.y * basisY.y;

  const traceHalf = (s11 + s22) / 2;
  const discriminant = Math.sqrt(Math.max(0, traceHalf * traceHalf - (s11 * s22 - s12 * s12)));
  const lambda1 = Math.max(0, traceHalf + discriminant);
  const lambda2 = Math.max(0, traceHalf - discriminant);
  const major = Math.sqrt(lambda1);
  const minor = Math.sqrt(lambda2);
  const rotationRadians = Math.abs(lambda1 - lambda2) <= 1e-9 ? 0 : 0.5 * Math.atan2(2 * s12, s11 - s22);

  return {
    rx: Number.isFinite(major) && major > 1e-9 ? major : Math.hypot(basisX.x, basisX.y),
    ry: Number.isFinite(minor) && minor > 1e-9 ? minor : Math.hypot(basisY.x, basisY.y),
    rotation: normalizeDegrees((rotationRadians * 180) / Math.PI)
  };
}

function normalizeDegrees(degrees: number): number {
  let normalized = degrees % 360;
  if (normalized <= -180) {
    normalized += 360;
  } else if (normalized > 180) {
    normalized -= 360;
  }
  return Math.abs(normalized) <= 1e-9 ? 0 : normalized;
}
