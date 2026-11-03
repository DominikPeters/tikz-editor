// expect: F1
// A string asserted to be a fragment.
import type { TikzFragment } from "../../../packages/core/src/edit/fragment.js";

export function coordinate(x: number, y: number): TikzFragment {
  return `(${x},${y})` as TikzFragment;
}
