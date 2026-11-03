// expect: F6
import * as values from "../../../packages/core/src/edit/writer/authored-values.js";
import type { CoordinateText } from "../../../packages/core/src/edit/fragment.js";
const narrowed: { writeScaleFactor(n: number): CoordinateText } = values;
export const result = narrowed.writeScaleFactor(42);
