// expect: F1
// A type guard that would let any string through as a fragment.
import type { CoordinateText } from "../../../packages/core/src/edit/fragment.js";

export function isCoordinateText(text: string): text is CoordinateText {
  return text.startsWith("(");
}
