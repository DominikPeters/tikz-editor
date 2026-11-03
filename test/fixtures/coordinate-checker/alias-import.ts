// expect: F3
// A writer internal imported under another name.
import { formatCoordinate as writeCoordinate } from "../../../packages/core/src/edit/writer/format.js";

export function rewrite(oldRaw: string): string {
  return writeCoordinate(oldRaw, "1", "2");
}
