import { frameLocalPoint, type WorldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { spelledCoordinateFrame, type SiteContext } from "../../semantic/site-context.js";
import { worldDeltaToLocalDelta } from "../coords.js";
import { formatNumber, type NumberFormatOptions } from "../format.js";
import type { CoordinateText } from "../fragment.js";
import { coordinateText } from "./coordinate-text.js";
import { localToSourceUnits } from "./source-units.js";

export type RadiusUnit = "cm" | "mm" | "pt" | "in" | "bp";

/**
 * How a radius is written. PGF reads a plain number along its x and y
 * vectors and a length along the canvas axes; either then goes through the
 * CTM (`tikz.code.tex`, `\tikz@do@ellipse`). The two cannot be mixed.
 */
export type RadiusSpelling = Readonly<{ unitless: true } | { unitless: false; unit: RadiusUnit }>;

/**
 * An `x radius` and a `y radius` in the local units of their radius frame
 * (frame-local pt, as for coordinates), from one of the functions below:
 * The shape stays structural so resize can constrain the solved lengths.
 * This does not prove provenance: writeRadii's callers are reviewed under F6
 * to check that constraints and spelling still belong to that same frame.
 */
export type RadiusLengths = Readonly<{ x: number; y: number; frameOf: RadiusSpelling }>;

const PT_PER_UNIT: Record<RadiusUnit, number> = { pt: 1, cm: 72.27 / 2.54, mm: 72.27 / 25.4, in: 72.27, bp: 72.27 / 72 };

function radiusFrame(context: SiteContext, spelling: RadiusSpelling) {
  return spelledCoordinateFrame(context, { unitlessX: spelling.unitless, unitlessY: spelling.unitless });
}

/** The radii that reach `reach`, a world offset from the center, along each axis of the radius frame. */
export function radiusLengthsOf(context: SiteContext, spelling: RadiusSpelling, reach: WorldVector): RadiusLengths | null {
  const local = worldDeltaToLocalDelta(reach, radiusFrame(context, spelling));
  return local && { x: Math.abs(local.x), y: Math.abs(local.y), frameOf: spelling };
}

/**
 * The radii of a circle of world radius `radius`: equal where the frame
 * scales evenly, an `x radius` and `y radius` where it stretches. Null where
 * it skews, since no radii draw a circle there.
 */
export function circleRadiusLengths(context: SiteContext, spelling: RadiusSpelling, radius: number): RadiusLengths | null {
  const { a, b, c, d } = radiusFrame(context, spelling);
  const xLength = Math.hypot(a, b);
  const yLength = Math.hypot(c, d);
  if (xLength < 1e-9 || yLength < 1e-9 || Math.abs(a * c + b * d) > 1e-9 * xLength * yLength) return null;
  return { x: radius / xLength, y: radius / yLength, frameOf: spelling };
}

/**
 * The radii of an ellipse with world half-axes `x` and `y` along the world
 * axes; null where the radius frame turns its axes off them.
 */
export function worldEllipseRadiusLengths(context: SiteContext, spelling: RadiusSpelling, x: number, y: number): RadiusLengths | null {
  const { a, b, c, d } = radiusFrame(context, spelling);
  const tolerance = 1e-9 * Math.max(1, Math.hypot(a, b, c, d));
  if (Math.abs(b) <= tolerance && Math.abs(c) <= tolerance && Math.abs(a) > tolerance && Math.abs(d) > tolerance) {
    return { x: x / Math.abs(a), y: y / Math.abs(d), frameOf: spelling };
  }
  if (Math.abs(a) <= tolerance && Math.abs(d) <= tolerance && Math.abs(b) > tolerance && Math.abs(c) > tolerance) {
    return { x: y / Math.abs(b), y: x / Math.abs(c), frameOf: spelling };
  }
  return null;
}

/** Writer-internal (checker rule F3): one radius in its spelling. */
export function writeRadiusLength(length: number, spelling: RadiusSpelling, digits: NumberFormatOptions = {}): CoordinateText {
  if (spelling.unitless) {
    return coordinateText(formatNumber(localToSourceUnits(frameLocalPoint(pt(length), pt(0))).x, digits));
  }
  return coordinateText(`${formatNumber(length / PT_PER_UNIT[spelling.unit], digits)}${spelling.unit}`);
}
