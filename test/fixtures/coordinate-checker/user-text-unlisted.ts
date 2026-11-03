// expect: F2
// User text from a module whose call site was never reviewed.
import { userText } from "../../../packages/core/src/edit/fragment.js";

export function radius(value: number) {
  return userText(String(value), "inspector-value");
}
