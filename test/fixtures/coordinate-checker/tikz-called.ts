// expect: F4
// tikz called as a function would accept built template strings.
import { tikz } from "../../../packages/core/src/edit/fragment.js";

export function build(strings: TemplateStringsArray) {
  return tikz(strings);
}
