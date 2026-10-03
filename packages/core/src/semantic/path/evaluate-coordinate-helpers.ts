import { coordinateTransform, defaultAxisBasis, type AxisBasis } from "../coords/axis-basis.js";
import { worldTransform } from "../../coords/transforms.js";
import { frameLocalPoint, worldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { frameTransform } from "../../coords/transforms.js";
import type { FrameTransform } from "../../coords/transforms.js";
import { worldToFrameLocal, worldVectorToFrameLocal, applyFrameTransform } from "../../coords/frame.js";
import type { WorldPoint, WorldVector } from "../../coords/points.js";
import type { CoordinateForm, CoordinateItem } from "../../ast/types.js";
import { coordinateSourceUnit, parseLengthWithInfo, parseQuantityExpression } from "../coords/parse-length.js";
import type { EvaluatedCoordinate } from "../coords/evaluate.js";
import type { PlacementSegment } from "./types.js";

function wv(x: number, y: number): WorldVector {
  return worldVector(pt(x), pt(y));
}

function inferSegmentEndHeadingDegrees(segment: PlacementSegment | null, frame: FrameTransform): number {
  if (!segment) {
    return 0;
  }

  let direction: WorldVector | null = null;
  if (segment.kind === "line") {
    direction = wv(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
  } else if (segment.kind === "hv") {
    // TikZ's final orthogonal leg is defined before applying the frame.
    const displacement = worldVectorToFrameLocal(wv(segment.to.x - segment.from.x, segment.to.y - segment.from.y), frame);
    if (!displacement) return 0;
    const finalComponent = segment.operator === "-|" ? displacement.y : displacement.x;
    if (Math.abs(finalComponent) <= 1e-9) return 0;
    return segment.operator === "-|"
      ? Math.atan2(displacement.y, 0) * 180 / Math.PI
      : Math.atan2(0, displacement.x) * 180 / Math.PI;
  } else if (segment.kind === "cubic") {
    direction = wv(segment.to.x - segment.c2.x, segment.to.y - segment.c2.y);
    if (Math.hypot(direction.x, direction.y) <= 1e-9) {
      direction = wv(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    }
  } else if (segment.kind === "arc") {
    if (segment.turnLookupControl) {
      const endpointLocal = worldToFrameLocal(segment.to, frame);
      if (!endpointLocal) return 0;
      // PGF's tangent lookup reads the soft path's WORLD second-last control
      // while `turn` subtracts TikZ's LOCAL last point after resetting the
      // matrix. Preserve this established transformed/translated arc behavior.
      const dx = endpointLocal.x - segment.turnLookupControl.x;
      const dy = endpointLocal.y - segment.turnLookupControl.y;
      const length = Math.hypot(dx, dy);
      return !Number.isFinite(length) || length <= 1e-9 ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;
    }
    // Synthetic placement segments predate lookup metadata. Their parameters
    // describe the local directed derivative, never the start-to-end chord.
    const radians = segment.params.endAngle * Math.PI / 180;
    const sign = segment.params.endAngle >= segment.params.startAngle ? 1 : -1;
    const dx = -segment.params.rx * Math.sin(radians) * sign;
    const dy = segment.params.ry * Math.cos(radians) * sign;
    return Math.hypot(dx, dy) <= 1e-9 ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;
  }

  if (!direction || Math.hypot(direction.x, direction.y) <= 1e-9) {
    return 0;
  }
  // Placement endpoints/control points are already in world coordinates.
  // TikZ resets the coordinate-options matrix before composing `turn`, so
  // recover its entering direction in the authored frame first.
  const localDirection = worldVectorToFrameLocal(direction, frame);
  if (!localDirection || Math.hypot(localDirection.x, localDirection.y) <= 1e-9) return 0;
  return (Math.atan2(localDirection.y, localDirection.x) * 180) / Math.PI;
}

export function evaluateTurnCoordinate(
  item: CoordinateItem,
  currentPoint: WorldPoint | null,
  transform: { a: number; b: number; c: number; d: number; e: number; f: number },
  lastPlacementSegment: PlacementSegment | null,
  axisBasis: AxisBasis = defaultAxisBasis()
): EvaluatedCoordinate | null {
  const hasTurnOption = item.options?.entries.some(
    (entry) =>
      (entry.kind === "flag" && entry.key === "turn") ||
      (entry.kind === "kv" && entry.key === "turn")
  );
  if (!hasTurnOption) {
    return null;
  }

  const polarForm: CoordinateForm = "polar";
  if (item.form !== "polar") {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: [`invalid-turn-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  if (!currentPoint) {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: ["turn-coordinate-without-current-point"],
      advancesCurrentPoint: true
    };
  }

  const angleQuantity = parseQuantityExpression(item.x.trim());
  const radius = parseLengthWithInfo(item.y, "cm");
  if (angleQuantity?.kind !== "scalar" || radius == null) {
    return {
      kind: "invalid",
      world: null,
      coordinateForm: polarForm,
      diagnostics: [`invalid-polar-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  const activeFrame = frameTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  const heading = inferSegmentEndHeadingDegrees(lastPlacementSegment, activeFrame);
  const headingRadians = (heading * Math.PI) / 180;
  const cos = Math.cos(headingRadians);
  const sin = Math.sin(headingRadians);
  const turnFrame = frameTransform(
    transform.a * cos + transform.c * sin,
    transform.b * cos + transform.d * sin,
    transform.c * cos - transform.a * sin,
    transform.d * cos - transform.b * sin,
    currentPoint.x,
    currentPoint.y
  );
  const composed = coordinateTransform(worldTransform(turnFrame.a, turnFrame.b, turnFrame.c, turnFrame.d, turnFrame.e, turnFrame.f), axisBasis, !radius.hasExplicitUnit, !radius.hasExplicitUnit);
  const coordinateFrame = frameTransform(composed.a, composed.b, composed.c, composed.d, composed.e, composed.f);
  const radians = (angleQuantity.value * Math.PI) / 180;
  const localVector = frameLocalPoint(
    pt(radius.value * Math.cos(radians)),
    pt(radius.value * Math.sin(radians))
  );

  return {
    kind: "transformed",
    world: applyFrameTransform(coordinateFrame, localVector),
    local: localVector,
    frame: coordinateFrame,
    sourceUnits: { radius: coordinateSourceUnit(item.y) },
    origin: "turn",
    relativeBase: currentPoint,
    coordinateForm: polarForm,
    relativePrefix: item.relativePrefix,
    diagnostics: [],
    advancesCurrentPoint: true
  };
}


/** TikZ's initial grid spacing is dimensional 1cm, independent of XY vectors. */
export function resolveDefaultGridStep(
  _transform: { a: number; b: number; c: number; d: number },
  _axis: "x" | "y"
): number {
  return 72.27 / 2.54;
}
