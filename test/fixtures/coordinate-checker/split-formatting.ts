// expect: TS2345
// Coordinate text formatted piece by piece into a span replacement.
import { formatNumber } from "../../../packages/core/src/edit/format.js";
import { replaceSpan } from "../../../packages/core/src/edit/patch.js";

export function rewrite(source: string, x: number, y: number) {
  return replaceSpan(source, { from: 0, to: 5 }, formatNumber(x) + "," + formatNumber(y));
}
