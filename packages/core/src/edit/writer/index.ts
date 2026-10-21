import type { WorldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { worldVector } from "../../coords/points.js";
import { worldTransform, type FrameTransform } from "../../coords/transforms.js";
import { defaultAxisBasis } from "../../semantic/coords/axis-basis.js";
import { captureSiteContext, spelledCoordinateFrame, type CoordinateSpelling, type SiteContext } from "../../semantic/site-context.js";
import { isFrameLocalCoordinateEditHandle, isRelativeCoordinateEditHandle, type CoordinateEditHandle } from "../../semantic/types.js";
import { worldDeltaToLocalDelta, worldToLocal } from "../coords.js";
import { formatNumber, type NumberFormatOptions } from "../format.js";
import type { CoordinateText } from "../fragment.js";
import { coordinateText } from "./coordinate-text.js";
import { formatCanvasCoordinate, formatCoordinate, formatPolarCoordinate } from "./format.js";
import { localToSourceUnits } from "./source-units.js";

/**
 * Where a coordinate is written. Phase 3 has existing coordinates only;
 * insertion gaps, statements, node placement and picture bounds come with
 * the failure classes that need them (design/coordinate-writer.md).
 */
export type WriteSite = CoordinateSite;

export type CoordinateSite = Readonly<{
  kind: "coordinate";
  handle: CoordinateEditHandle;
  /**
   * The context the coordinate is read in after the edit, when the edit
   * changes it (the options before it); else the handle's own.
   */
  context?: SiteContext;
}>;

export type WriterResult<T> = { kind: "ok"; fragment: T } | { kind: "unsupported"; reason: string };

/**
 * `drag`: two decimals, polar angles in [0, 360). `reparameterize`: when an
 * edit changes a coordinate's frame without moving it, six decimals and the
 * angle as computed, so the point does not jump by rounding.
 */
export type PointPrecision = "drag" | "reparameterize";

export type PointWriteOptions = Readonly<{ precision?: PointPrecision }>;

export interface CoordinateWriter {
  /** The text that puts `site`'s coordinate at `world`, in its own spelling. */
  point(site: WriteSite, world: WorldPoint, options?: PointWriteOptions): WriterResult<CoordinateText>;
}

const UNITLESS: CoordinateSpelling = Object.freeze({ unitlessX: true, unitlessY: true });
const REPARAMETERIZE: NumberFormatOptions = Object.freeze({ fractionDigits: 6 });

/** A writer for coordinates in `source`, the text the sites' handles were read from. */
export function createCoordinateWriter(source: string): CoordinateWriter {
  return {
    point(site, world, options = {}) {
      return writeCoordinatePoint(source, site, world, options.precision ?? "drag");
    }
  };
}

function writeCoordinatePoint(source: string, site: CoordinateSite, world: WorldPoint, precision: PointPrecision): WriterResult<CoordinateText> {
  const { handle } = site;
  const context = site.context ?? handle.siteContext;
  const oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  const digits = precision === "reparameterize" ? REPARAMETERIZE : {};

  if (handle.rewriteMode === "calc") return unsupported("calc coordinates are rewritten through their offsets");

  if (handle.rewriteMode === "delta") {
    // A relative or turn coordinate is a vector from where the path stands.
    if (!isRelativeCoordinateEditHandle(handle)) return unsupported("relative coordinate without its base point");
    const frame = spelledCoordinateFrame(context, handle.spelling);
    const delta = worldVector(pt(world.x - handle.relativeBase.x), pt(world.y - handle.relativeBase.y));
    const local = worldDeltaToLocalDelta(delta, frame);
    if (!local) return singular();
    const units = localToSourceUnits(local);
    if (handle.coordinateForm === "polar") return polar(oldRaw, units, handle, precision);
    if (handle.coordinateForm === "explicit") return canvas(oldRaw, units, handle, digits);
    if (handle.coordinateForm === "xyz") return unsupported("xyz coordinates are not rewritten");
    return ok(formatCoordinate(oldRaw, formatNumber(units.x, digits), formatNumber(units.y, digits), handle.sourceUnits));
  }

  if (handle.rewriteMode === "unsupported") {
    // A named path endpoint can be detached into a new coordinate, unitless.
    if (handle.kind !== "path-point" || handle.coordinateForm !== "named") return unsupported("this coordinate cannot be rewritten");
    const spelling = handle.coordinateSpace === "frame-local" ? handle.spelling : UNITLESS;
    const local = worldToLocal(world, spelledCoordinateFrame(context, spelling));
    if (!local) return singular();
    const units = localToSourceUnits(local);
    return ok(formatCoordinate(oldRaw, formatNumber(units.x, digits), formatNumber(units.y, digits),
      handle.coordinateSpace === "frame-local" ? handle.sourceUnits : undefined));
  }

  // Handles are runtime data: a direct one without a frame is malformed.
  if (!isFrameLocalCoordinateEditHandle(handle)) return unsupported("this coordinate has no frame to write in");
  const local = worldToLocal(world, spelledCoordinateFrame(context, handle.spelling));
  if (!local) return singular();
  const units = localToSourceUnits(local);
  switch (handle.coordinateForm) {
    case "cartesian":
      return ok(formatCoordinate(oldRaw, formatNumber(units.x, digits), formatNumber(units.y, digits), handle.sourceUnits));
    case "polar":
      return polar(oldRaw, units, handle, precision);
    case "explicit":
      return canvas(oldRaw, units, handle, digits);
    case "xyz":
    case "calc":
    case "named":
    case "unknown":
      return unsupported(`${handle.coordinateForm} coordinates are not rewritten`);
  }
}

function polar(oldRaw: string, units: { x: number; y: number }, handle: CoordinateEditHandle, precision: PointPrecision): WriterResult<CoordinateText> {
  const radius = Math.hypot(units.x, units.y);
  let angleDeg = (Math.atan2(units.y, units.x) * 180) / Math.PI;
  if (precision === "reparameterize") {
    return ok(formatPolarCoordinate(oldRaw, formatNumber(angleDeg, REPARAMETERIZE), formatNumber(radius, REPARAMETERIZE), handle.sourceUnits));
  }
  if (angleDeg < 0) angleDeg += 360;
  return ok(formatPolarCoordinate(oldRaw, formatNumber(angleDeg), formatNumber(radius), handle.sourceUnits));
}

function canvas(oldRaw: string, units: { x: number; y: number }, handle: CoordinateEditHandle, digits: NumberFormatOptions): WriterResult<CoordinateText> {
  const text = formatCanvasCoordinate(oldRaw, formatNumber(units.x, digits), formatNumber(units.y, digits), handle.sourceUnits);
  return text === null ? unsupported("canvas coordinate without both x= and y=") : ok(text);
}

function ok(text: string): WriterResult<CoordinateText> {
  return { kind: "ok", fragment: coordinateText(text) };
}

function unsupported(reason: string): WriterResult<CoordinateText> {
  return { kind: "unsupported", reason };
}

function singular(): WriterResult<CoordinateText> {
  return unsupported("the coordinate's frame is not invertible");
}

/**
 * Migration only (listed, checker rule F2): the context for a frame an
 * action computed as a bare CTM, without PGF's axis vectors. Center-pivot
 * moves and rotations resolve the frame after their option edit that way;
 * under `x=`/`y=` it misplaces unitless coordinates (failure class 1). It
 * goes when they resolve the full option state.
 */
export function legacyCtmSiteContext(frame: FrameTransform): SiteContext {
  return captureSiteContext({ transform: worldTransform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f), axisBasis: defaultAxisBasis() });
}
