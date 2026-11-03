// expect: TS2322
// A patch whose replacement is concatenated from numbers.
import type { SourcePatch } from "../../../packages/core/src/edit/types.js";

export function movePatch(x: number, y: number): SourcePatch {
  return { oldSpan: { from: 0, to: 5 }, newSpan: { from: 0, to: 5 }, replacement: "(" + x + "," + y + ")" };
}
