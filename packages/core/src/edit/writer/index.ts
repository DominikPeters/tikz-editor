import { frameLocalPoint, worldPoint, worldVector, type FrameLocalPoint, type WorldBounds, type WorldPoint, type WorldVector } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
import { requireArrayValue } from "../../utils/collections.js";
import { applyFrameToWorldPoint } from "../../coords/frame.js";
import { coordinateSourceUnit, parseLengthWithInfo } from "../../semantic/coords/parse-length.js";
import { spelledCoordinateFrame, type CoordinateSpelling, type SiteContext } from "../../semantic/site-context.js";
import { isFrameLocalCoordinateEditHandle, isRelativeCoordinateEditHandle, type CoordinateEditHandle } from "../../semantic/types.js";
import { worldDeltaToLocalDelta, worldToLocal } from "../coords.js";
import { formatNumber, type NumberFormatOptions } from "../format.js";
import { joinFragments, tikz, type CoordinateText, type TikzFragment } from "../fragment.js";
import type { EditHandlePositioningContext } from "../../semantic/types.js";
import { coordinateText } from "./coordinate-text.js";
import { writePositioning } from "./positioning.js";
import { cartesianComponents, coordinateLayout, formatCanvasCoordinate, formatCoordinate, formatPolarCoordinate, translatedComponent } from "./format.js";
import { localToSourceUnits } from "./source-units.js";

/**
 * Where a coordinate is written: an existing coordinate, or a place whose
 * context the evaluator resolved (a gap, a statement's options, a node's
 * placement). Node placement and offsets come with the failure classes that
 * need them (design/coordinate-writer.md).
 */
export type WriteSite = CoordinateSite | ContextSite;

export type CoordinateSite = Readonly<{
  kind: "coordinate";
  handle: CoordinateEditHandle;
  /**
   * The context the coordinate is read in after the edit, when the edit
   * changes it (the options before it); else the handle's own.
   */
  context?: SiteContext;
}>;

export type ContextSite = Readonly<{
  kind: "context";
  /** From the evaluator: a handle's, a gap's, or a statement's option state. */
  context: SiteContext;
  /**
   * Authored cartesian text the coordinate replaces, whose units and spacing
   * are kept. Without it the coordinate is new, and unitless.
   */
  replaces?: string;
}>;

export type WriterResult<T> = { kind: "ok"; fragment: T } | { kind: "unsupported"; reason: string };

/**
 * `drag`: two decimals, polar angles in [0, 360). `reparameterize`: when an
 * edit changes a coordinate's frame without moving it, six decimals and the
 * angle as computed, so the point does not jump by rounding.
 */
export type PointPrecision = "drag" | "reparameterize";

export type PointWriteOptions = Readonly<{ precision?: PointPrecision }>;

/** A loop variable and the world vector one step of it moves a copy by. */
export type LoopStep = Readonly<{ variable: string; world: WorldVector }>;

export interface CoordinateWriter {
  /** The text that puts `site`'s coordinate at `world`, in its own spelling. */
  point(site: WriteSite, world: WorldPoint, options?: PointWriteOptions): WriterResult<CoordinateText>;
  /**
   * The coordinate at `site` moved by the sum of `variable × world` over the
   * steps, as the loop expression `1+\i*2-\j*0.5`, in the coordinate's own
   * spelling: each component keeps its unit, and a plain number stays one,
   * so the move is right under axis vectors and rotated scopes alike. At a
   * context site the coordinate is `replaces` (`(0,0)` when absent), which
   * serves a vector such as a scope's `shift`.
   */
  translated(site: WriteSite, steps: readonly LoopStep[]): WriterResult<CoordinateText>;
  /**
   * The positioning option (`right=1.2cm of A`) that puts a node positioned
   * from another at `world`. Its distances are canvas lengths, so the context
   * is the node's, not a frame's. `world` is where the positioning puts the
   * node (the handle's point), before the node's own shifts.
   */
  positioning(context: EditHandlePositioningContext, world: WorldPoint, options?: Readonly<{ bypassSnapping?: boolean }>): WriterResult<CoordinateText>;
  /**
   * A path body read in `context` whose canvas hull is `world`. PGF grows the
   * picture by canvas-transformed points, so a `rectangle` serves only where
   * the map keeps axes axis-aligned; elsewhere the four corners and `cycle`.
   */
  bounds(context: SiteContext, world: WorldBounds): WriterResult<TikzFragment>;
  /**
   * A `rotate around` value at `context` (the options before it) about the
   * world point `pivot`. The option multiplies onto the CTM, so an angle is a
   * world angle only where the CTM is conformal: `world` turns what follows
   * by that much (the sense flips under a reflection) and is refused under
   * stretch or skew; `authored` is the option's own angle, which TikZ
   * composes with whatever the parent does.
   */
  rotation(context: SiteContext, angle: Readonly<{ world: number } | { authored: number }>, pivot: WorldPoint): WriterResult<CoordinateText>;
}

const UNITLESS: CoordinateSpelling = Object.freeze({ unitlessX: true, unitlessY: true });
const REPARAMETERIZE: NumberFormatOptions = Object.freeze({ fractionDigits: 6 });

/** A writer for coordinates in `source`, the text the sites' handles were read from. */
export function createCoordinateWriter(source: string): CoordinateWriter {
  return {
    point(site, world, options = {}) {
      return site.kind === "context"
        ? writeContextPoint(site, world, options.precision ?? "drag")
        : writeCoordinatePoint(source, site, world, options.precision ?? "drag");
    },
    positioning(context, world, options = {}) {
      const text = writePositioning(world, context, options.bypassSnapping ?? false);
      return text === null ? unsupported("this positioning cannot be written as one option") : ok(text);
    },
    translated(site, steps) {
      return writeTranslated(source, site, steps);
    },
    rotation(context, angle, pivot) {
      let authored: number;
      if ("authored" in angle) authored = angle.authored;
      else {
        const sense = rotationSense(context);
        if (sense === null) return unsupported("a world rotation cannot be expressed in a stretched or skewed frame");
        authored = sense * angle.world;
      }
      const written = writeContextPoint({ kind: "context", context }, pivot, "reparameterize");
      if (written.kind !== "ok") return written;
      return ok(`{${formatNumber(authored, REPARAMETERIZE)}:${written.fragment}}`);
    },
    bounds(context, world) {
      const frame = spelledCoordinateFrame(context, UNITLESS);
      const corner = (x: number, y: number) => writeContextPoint({ kind: "context", context }, worldPoint(pt(x), pt(y)), "drag");
      const axisAligned = (Math.abs(frame.b) < 1e-9 && Math.abs(frame.c) < 1e-9) || (Math.abs(frame.a) < 1e-9 && Math.abs(frame.d) < 1e-9);
      const corners = axisAligned
        ? [corner(world.minX, world.minY), corner(world.maxX, world.maxY)]
        : [corner(world.minX, world.minY), corner(world.maxX, world.minY), corner(world.maxX, world.maxY), corner(world.minX, world.maxY)];
      const texts: CoordinateText[] = [];
      for (const written of corners) {
        if (written.kind !== "ok") return written;
        texts.push(written.fragment);
      }
      return { kind: "ok", fragment: axisAligned
        ? tikz`${requireArrayValue(texts, 0)} rectangle ${requireArrayValue(texts, 1)}`
        : tikz`${joinFragments(texts, tikz` -- `)} -- cycle` };
    }
  };
}

/**
 * How a rotation option at `context` turns the world: 1 where the CTM's
 * linear part is a rotation and scaling, -1 where it also reflects, null
 * where it stretches or skews.
 */
export function rotationSense(context: SiteContext): 1 | -1 | null {
  const { a, b, c, d } = context.ctm;
  const tolerance = 1e-9 * Math.max(1, Math.hypot(a, b, c, d));
  if (Math.abs(a - d) <= tolerance && Math.abs(b + c) <= tolerance) return 1;
  if (Math.abs(a + d) <= tolerance && Math.abs(b - c) <= tolerance) return -1;
  return null;
}

/**
 * Where authored cartesian text read in `context` puts its point, as the
 * evaluator reads it: each plain number through its axis vector, each length
 * through the CTM alone. Null for any other form.
 */
export function readContextPoint(context: SiteContext, raw: string): WorldPoint | null {
  const read = readCartesian(raw);
  return read && applyFrameToWorldPoint(spelledCoordinateFrame(context, read.spelling), read.local);
}

function readCartesian(raw: string): { spelling: CoordinateSpelling; local: FrameLocalPoint } | null {
  const components = cartesianComponents(raw);
  const x = components && parseLengthWithInfo(components.x, "cm");
  const y = components && parseLengthWithInfo(components.y, "cm");
  if (!x || !y) return null;
  return { spelling: { unitlessX: !x.hasExplicitUnit, unitlessY: !y.hasExplicitUnit }, local: frameLocalPoint(pt(x.value), pt(y.value)) };
}

function writeContextPoint(site: ContextSite, world: WorldPoint, precision: PointPrecision): WriterResult<CoordinateText> {
  const spelling = site.replaces === undefined ? UNITLESS : readCartesian(site.replaces)?.spelling;
  if (!spelling) return unsupported("only cartesian coordinates are rewritten at a context");
  const local = worldToLocal(world, spelledCoordinateFrame(site.context, spelling));
  if (!local) return singular();
  const units = localToSourceUnits(local);
  const digits = precision === "reparameterize" ? REPARAMETERIZE : {};
  return ok(formatCoordinate(site.replaces ?? "", formatNumber(units.x, digits), formatNumber(units.y, digits)));
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

function writeTranslated(source: string, site: WriteSite, steps: readonly LoopStep[]): WriterResult<CoordinateText> {
  let context: SiteContext;
  let oldRaw: string;
  if (site.kind === "context") {
    context = site.context;
    oldRaw = site.replaces ?? "(0,0)";
  } else {
    const { handle } = site;
    if (handle.rewriteMode !== "direct" || !isFrameLocalCoordinateEditHandle(handle) || (handle.coordinateForm !== "cartesian" && handle.coordinateForm !== "xyz")) {
      return unsupported("only cartesian coordinates are moved by a loop");
    }
    context = site.context ?? handle.siteContext;
    oldRaw = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
  }
  const layout = coordinateLayout(oldRaw);
  const x = layout && parseLengthWithInfo(layout.x, "cm");
  const y = layout && parseLengthWithInfo(layout.y, "cm");
  if (!layout || !x || !y) return unsupported("only cartesian coordinates are moved by a loop");
  const frame = spelledCoordinateFrame(context, { unitlessX: !x.hasExplicitUnit, unitlessY: !y.hasExplicitUnit });
  const moves: { variable: string; x: number; y: number }[] = [];
  for (const step of steps) {
    const local = worldDeltaToLocalDelta(step.world, frame);
    if (!local) return singular();
    const units = localToSourceUnits(local);
    moves.push({ variable: step.variable, x: units.x, y: units.y });
  }
  const xText = translatedComponent(layout.x, moves.map(move => ({ variable: move.variable, value: move.x })), coordinateSourceUnit(layout.x));
  const yText = translatedComponent(layout.y, moves.map(move => ({ variable: move.variable, value: move.y })), coordinateSourceUnit(layout.y));
  return ok(`(${layout.open}${layout.options}${xText}${layout.gap}${yText}${layout.afterY}${layout.z === null ? "" : `,${layout.z}`})`);
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
