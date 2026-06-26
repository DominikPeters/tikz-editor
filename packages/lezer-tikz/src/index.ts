import type { Tree } from "@lezer/common";

import { parser } from "./grammar/tikz-parser.js";

export function parseSyntax(source: string): Tree {
  return parser.parse(source);
}

export { parser };
