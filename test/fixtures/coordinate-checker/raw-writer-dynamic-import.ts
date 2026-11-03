// expect: F6
import type { CoordinateText } from "../../../packages/core/src/edit/fragment.js";
export async function narrowed() {
  const values: { writeScaleFactor(n: number): CoordinateText } = await import("../../../packages/core/src/edit/writer/authored-values.js");
  return values.writeScaleFactor(42);
}
