// expect: TS2769
// A frame key does not take a canvas length: xshift is read in the frame.
import { pt } from "../../../packages/core/src/coords/scalars.js";
import { canvasLength, option } from "../../../packages/core/src/edit/fragment.js";

export const shift = option("xshift", canvasLength(pt(10)));
