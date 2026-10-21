// expect: TS2769 F2
// A key typed as string could be a frame key in disguise.
import { option, userText } from "../../../packages/core/src/edit/fragment.js";

export function anyOption(key: string) {
  return option(key, userText("1cm", "inspector-value"));
}
