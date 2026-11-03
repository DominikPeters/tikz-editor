// expect: F6
import * as values from "../../../packages/core/src/edit/writer/authored-values.js";
const { writeRadii: radii } = values;
export const result = radii({ x: 3, y: 4, frameOf: { unitless: true } });
