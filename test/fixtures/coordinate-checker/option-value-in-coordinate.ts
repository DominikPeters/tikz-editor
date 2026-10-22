// expect: TS2345
// An option value checked against one key is not coordinate syntax.
import { canvasLength, optionValueFor, tikz } from "../../../packages/core/src/edit/fragment.js";
import type { Pt } from "../../../packages/core/src/coords/scalars.js";

export function coordinate(p: { x: Pt; y: Pt }) {
  return tikz`(${optionValueFor("line width", canvasLength(p.x, "cm"))},${optionValueFor("line width", canvasLength(p.y, "cm"))})`;
}
