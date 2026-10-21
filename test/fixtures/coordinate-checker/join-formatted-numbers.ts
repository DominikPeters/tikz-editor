// expect: TS2345
// Formatted numbers joined into a tikz hole.
import { formatNumber } from "../../../packages/core/src/edit/format.js";
import { tikz } from "../../../packages/core/src/edit/fragment.js";

export function coordinate(x: number, y: number) {
  return tikz`(${[formatNumber(x), formatNumber(y)].join(",")})`;
}
