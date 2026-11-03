import {
  frameLocalPoint,
  pt,
  svgBounds,
  svgPoint,
  worldBounds,
  worldPoint,
  worldVector
} from "../packages/core/src/coords/index.js";
import { worldTransform } from "../packages/core/src/coords/transforms.js";
import { defaultAxisBasis } from "../packages/core/src/semantic/coords/axis-basis.js";
import { captureSiteContext, type CoordinateSpelling, type SiteContext } from "../packages/core/src/semantic/site-context.js";
import { createCoordinateWriter } from "../packages/core/src/edit/writer/index.js";
import type { CoordinateText } from "../packages/core/src/edit/fragment.js";
import { statementPointWriter, type NewStatementPoints } from "../packages/core/src/edit/new-statement.js";
import type { WorldPoint } from "../packages/core/src/coords/points.js";

export const wp = (x: number, y: number) => worldPoint(pt(x), pt(y));
export const wv = (x: number, y: number) => worldVector(pt(x), pt(y));
export const wb = (minX: number, minY: number, maxX: number, maxY: number) =>
  worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));

export const sp = (x: number, y: number) => svgPoint(pt(x), pt(y));
export const sb = (minX: number, minY: number, maxX: number, maxY: number) =>
  svgBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));

export const flp = (x: number, y: number) => frameLocalPoint(pt(x), pt(y));

type Affine = { a: number; b: number; c: number; d: number; e: number; f: number };

/**
 * The site context a hand-built handle stands for: the CTM `frame` with
 * PGF's default axes, so a unitless coordinate's map is `frame` itself.
 */
export function testSiteContext(frame: Affine): SiteContext {
  return captureSiteContext({ transform: worldTransform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f), axisBasis: defaultAxisBasis() });
}

export const UNITLESS_SPELLING: CoordinateSpelling = { unitlessX: true, unitlessY: true };

const identityWriter = createCoordinateWriter("");
const identityContext = testSiteContext({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/** Writes a new coordinate in a picture without options: world cm, unitless. */
export function identityPoint(point: WorldPoint): CoordinateText {
  const written = identityWriter.point({ kind: "context", context: identityContext }, point);
  if (written.kind !== "ok") throw new Error(written.reason);
  return written.fragment;
}

/** New statements in a picture without options. */
export const identityPoints: NewStatementPoints = () => statementPointWriter("", identityContext);
