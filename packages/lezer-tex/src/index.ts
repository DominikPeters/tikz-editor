import type { Tree } from "@lezer/common";
import type { LRParser } from "@lezer/lr";

import { parser } from "./grammar/tex-parser.js";

export type TexSyntaxTop = "TexDocument" | "TexFragment" | "TexMathFragment";
export type TexSyntaxDialect = "beamer";

export interface ConfigureTexParserOptions {
  readonly top?: TexSyntaxTop;
  readonly dialects?: readonly TexSyntaxDialect[];
}

export function configureTexParser(
  options: ConfigureTexParserOptions = {}
): LRParser {
  return parser.configure({
    top: options.top ?? "TexDocument",
    dialect: options.dialects?.join(" ") ?? "",
  });
}

export const texDocumentParser = configureTexParser();
export const texFragmentParser = configureTexParser({ top: "TexFragment" });
export const texMathParser = configureTexParser({ top: "TexMathFragment" });
export const beamerDocumentParser = configureTexParser({
  dialects: ["beamer"],
});

export function parseTexSyntax(
  source: string,
  options: ConfigureTexParserOptions = {}
): Tree {
  return configureTexParser(options).parse(source);
}

export { parser };
