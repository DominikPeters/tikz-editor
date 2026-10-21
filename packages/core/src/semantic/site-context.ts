import { frameTransform, worldTransform, type FrameToWorldTransform } from "../coords/transforms.js";
import { coordinateTransform, type AxisBasis } from "./coords/axis-basis.js";
import type { SemanticContextFrame } from "./context.js";

declare const siteContextBrand: unique symbol;

/**
 * What TikZ applies to text written at one place, as the evaluator had it:
 * the raw coordinate transformation matrix and PGF's x/y vectors, before any
 * coordinate's own spelling picks which of them apply. Frozen, so a capture
 * cannot change when the evaluator's (mutable) frame later does.
 */
export type SiteContext = Readonly<{
  ctm: FrameToWorldTransform;
  axes: AxisBasis;
  [siteContextBrand]: true;
}>;

/** A statement's entry context: the state the statement starts from. */
export type StatementEntryContext = Readonly<{
  statementId: string;
  sourceId: string;
  context: SiteContext;
}>;

/** Where text can be written, for every statement of a figure and at its end. */
export type FigureSiteContexts = Readonly<{
  /** In evaluation order. A scope's `:leave` step starts from the state at the end of its body. */
  statementEntries: readonly StatementEntryContext[];
  /** The state after the last statement, where a new statement is appended. */
  figureEnd: SiteContext;
}>;

// Frames share their transform and axis objects until an option replaces
// them, so one capture serves every handle and statement of that frame.
const captures = new WeakMap<object, WeakMap<object, SiteContext>>();

export function captureSiteContext(frame: Pick<SemanticContextFrame, "transform" | "axisBasis">): SiteContext {
  let byAxes = captures.get(frame.transform);
  if (!byAxes) {
    byAxes = new WeakMap();
    captures.set(frame.transform, byAxes);
  }
  const cached = byAxes.get(frame.axisBasis);
  if (cached) return cached;
  const { a, b, c, d, e, f } = frame.transform;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- This constructor establishes the capture brand without changing its runtime representation.
  const context = Object.freeze({
    ctm: Object.freeze(frameTransform(a, b, c, d, e, f)),
    axes: Object.freeze({ x: Object.freeze({ ...frame.axisBasis.x }), y: Object.freeze({ ...frame.axisBasis.y }) })
  }) as unknown as SiteContext;
  byAxes.set(frame.axisBasis, context);
  return context;
}

/**
 * The map a coordinate written at this site goes through: unitless
 * components use the axis vectors, dimensioned ones only the CTM.
 */
export function siteCoordinateFrame(context: SiteContext, unitlessX = true, unitlessY = true): FrameToWorldTransform {
  const { a, b, c, d, e, f } = context.ctm;
  const composed = coordinateTransform(worldTransform(a, b, c, d, e, f), context.axes, unitlessX, unitlessY);
  return frameTransform(composed.a, composed.b, composed.c, composed.d, composed.e, composed.f);
}

export function sameSiteContext(left: SiteContext, right: SiteContext, tolerance = 1e-9): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) <= tolerance * Math.max(1, Math.abs(x), Math.abs(y));
  const l = left.ctm, r = right.ctm;
  return close(l.a, r.a) && close(l.b, r.b) && close(l.c, r.c) && close(l.d, r.d) && close(l.e, r.e) && close(l.f, r.f) &&
    close(left.axes.x.x, right.axes.x.x) && close(left.axes.x.y, right.axes.x.y) &&
    close(left.axes.y.x, right.axes.y.x) && close(left.axes.y.y, right.axes.y.y);
}

/** Every entry context recorded for an authored statement: one per `\foreach` iteration. */
export function entryContextsForSource(contexts: FigureSiteContexts, sourceId: string): SiteContext[] {
  return contexts.statementEntries.filter(entry => entry.sourceId === sourceId).map(entry => entry.context);
}
