import type { CoordinateText } from "../fragment.js";

/**
 * Writer-internal (checker rule F3): the one place coordinate text gets its
 * brand. Only the writer formats a number for a frame key or a coordinate.
 */
export function coordinateText(text: string): CoordinateText {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The writer is the coordinate text constructor boundary.
  return text as CoordinateText;
}
