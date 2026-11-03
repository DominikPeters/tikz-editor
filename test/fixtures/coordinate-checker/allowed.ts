// expect:
// What the fragment layer allows: literals, fragments in holes, typed option values.
import { pt } from "../../../packages/core/src/coords/scalars.js";
import { worldPoint, worldVector, type WorldPoint } from "../../../packages/core/src/coords/points.js";
import { canvasLength, EMPTY_FRAGMENT, joinFragments, layout, option, optionList, tikz } from "../../../packages/core/src/edit/fragment.js";

export const node = tikz`\node${optionList([option("minimum width", canvasLength(pt(10))), option("draw")])} {};`;
export const lines = joinFragments([node, EMPTY_FRAGMENT], layout("\n"));
export function offset(from: WorldPoint, to: WorldPoint) {
  return worldVector(pt(to.x - from.x), pt(to.y - from.y));
}
export const origin = worldPoint(pt(0), pt(0));

import { createCoordinateWriter } from "../../../packages/core/src/edit/writer/index.js";
import type { SiteContext } from "../../../packages/core/src/semantic/site-context.js";
export function place(context: SiteContext, world: WorldPoint) {
  return createCoordinateWriter("").point({ kind: "context", context }, world);
}
