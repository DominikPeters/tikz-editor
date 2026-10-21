// expect: TS2345
// An option value is not a fragment, so it cannot fill a tikz hole.
import { pt } from "../../../packages/core/src/coords/scalars.js";
import { canvasLength, tikz } from "../../../packages/core/src/edit/fragment.js";

export const width = tikz`minimum width=${canvasLength(pt(10))}`;
