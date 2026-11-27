import { worldVector } from "../../coords/points.js";
import type { WorldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { PT_PER_CM } from "../../coords/source.js";
import { worldTransform } from "../../coords/transforms.js";
import type { WorldTransform } from "../../coords/transforms.js";
import { multiplyMatrix } from "../transform.js";

/**
 * A pgfplots log axis: a unitless component is a data value whose logarithm
 * (to this base: `Math.E` unless `log basis x` is set) is the coordinate the
 * x/y vectors apply to. Present only inside such an axis.
 */
export type AxisLogScale = Readonly<{ x?: number; y?: number }>;

/** PGF's x/y vectors in canvas pt, independent of the coordinate CTM. */
export type AxisBasis = Readonly<{ x: WorldVector; y: WorldVector; log?: AxisLogScale }>;
export type AxisBasisState = { basis: AxisBasis };
const DEFAULT_BASIS: AxisBasis = Object.freeze({
  x: Object.freeze(worldVector(pt(PT_PER_CM), pt(0))),
  y: Object.freeze(worldVector(pt(0), pt(PT_PER_CM)))
});
export function defaultAxisBasis(): AxisBasis { return DEFAULT_BASIS; }

/** Source coordinates remain cm-equivalent pt; dimensional components skip the basis. */
export function coordinateTransform(
  transform: WorldTransform,
  basis: AxisBasis,
  scalarX = true,
  scalarY = true
): WorldTransform {
  if ((!scalarX || (basis.x.x === PT_PER_CM && basis.x.y === 0)) &&
      (!scalarY || (basis.y.x === 0 && basis.y.y === PT_PER_CM))) return transform;
  return multiplyMatrix(transform, worldTransform(
    scalarX ? basis.x.x / PT_PER_CM : 1,
    scalarX ? basis.x.y / PT_PER_CM : 0,
    scalarY ? basis.y.x / PT_PER_CM : 0,
    scalarY ? basis.y.y / PT_PER_CM : 1, 0, 0
  ));
}

/**
 * A unitless component (cm-equivalent pt) through the axis' log scale, if
 * that direction has one: data value → logarithm. Null for a value with no
 * logarithm (zero or negative), which pgfplots discards.
 */
export function unitlessToAxisCoordinate(basis: AxisBasis, letter: "x" | "y", value: number): number | null {
  const base = basis.log?.[letter];
  if (base === undefined) return value;
  const data = value / PT_PER_CM;
  if (!(data > 0) || !Number.isFinite(data)) return null;
  return (Math.log(data) / Math.log(base)) * PT_PER_CM;
}

/** The inverse of `unitlessToAxisCoordinate` (the coordinate writer's direction). */
export function axisCoordinateToUnitless(basis: AxisBasis, letter: "x" | "y", value: number): number {
  const base = basis.log?.[letter];
  if (base === undefined) return value;
  return base ** (value / PT_PER_CM) * PT_PER_CM;
}
