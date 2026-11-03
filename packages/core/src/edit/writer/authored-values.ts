/**
 * Low-level serialization for values callers have already solved in the
 * authored frame, or received from the user. These are deliberately absent
 * from CoordinateWriter: unlike point/rotation, they cannot check a frame.
 * Every reference outside the writer is reviewed and fingerprinted by F6.
 */
import { formatNumber, type NumberFormatOptions } from "../format.js";
import type { CoordinateText, TikzFragment } from "../fragment.js";
import { coordinateText } from "./coordinate-text.js";
import { formatCoordinate } from "./format.js";
import type { PointWriteOptions } from "./index.js";
import { writeRadiusLength, type RadiusLengths, type RadiusSpelling, type RadiusUnit } from "./radius.js";

/** Lengths already resolved through their radius frame; preserves each radius's unit. */
export function writeRadii(lengths: RadiusLengths, options: PointWriteOptions & Readonly<{ units?: Readonly<{ x?: RadiusUnit; y?: RadiusUnit }> }> = {}): { x: CoordinateText; y: CoordinateText } {
  const digits = options.precision === "reparameterize" ? { fractionDigits: 6 } : {};
  const spelled = (unit: RadiusUnit | undefined): RadiusSpelling => lengths.frameOf.unitless || unit === undefined ? lengths.frameOf : { unitless: false, unit };
  return { x: writeRadiusLength(lengths.x, spelled(options.units?.x), digits), y: writeRadiusLength(lengths.y, spelled(options.units?.y), digits) };
}

/** An option's authored angle, rather than a turn in world space. */
export function writeAuthoredAngle(authoredDeg: number, options: Readonly<{ fractionDigits?: number }> = {}): CoordinateText {
  return coordinateText(formatNumber(authoredDeg, options.fractionDigits === undefined ? {} : { fractionDigits: options.fractionDigits }));
}

/** A scale factor solved for and checked against the frame it produces. */
export function writeScaleFactor(value: number, options: Readonly<{ fractionDigits?: number }> = {}): CoordinateText {
  return coordinateText(formatNumber(value, options.fractionDigits === undefined ? {} : { fractionDigits: options.fractionDigits }));
}

/** A pt length solved in the ordered option frame, or an untransformed PGF distance. */
export function writeLocalLength(valuePt: number, options: NumberFormatOptions = {}): CoordinateText {
  return coordinateText(`${formatNumber(valuePt, options)}pt`);
}

/** A local shift; null components preserve text read from the document. */
export function writeShiftPair(authored: Readonly<{ x: string; y: string }> | null, next: Readonly<{ x: number | null; y: number | null }>, options: NumberFormatOptions = {}): CoordinateText {
  const component = (value: number | null, kept: string | undefined) => value === null ? kept ?? "0pt" : `${formatNumber(value, options)}pt`;
  return coordinateText(`(${component(next.x, authored?.x)},${component(next.y, authored?.y)})`);
}

/** User-typed components in the existing coordinate's layout; no frame is inferred. */
export function writeTypedComponents(oldRaw: string, x: TikzFragment, y: TikzFragment): CoordinateText {
  return coordinateText(formatCoordinate(oldRaw, x, y));
}
