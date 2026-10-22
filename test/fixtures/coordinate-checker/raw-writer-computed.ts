// expect: F6
import * as values from "../../../packages/core/src/edit/writer/authored-values.js";
export function pick(name: "writeAuthoredAngle" | "writeScaleFactor") {
  return values[name](42);
}
