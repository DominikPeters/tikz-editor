import { ExternalTokenizer, type InputStream } from "@lezer/lr";

import {
  OpaqueEnvironmentToken,
  UnterminatedOpaqueEnvironmentToken,
} from "./tex-parser.terms.js";

const OPAQUE_ENVIRONMENT_NAMES = [
  "BVerbatim",
  "Verbatim",
  "alltt",
  "lstlisting",
  "minted",
  "semiverbatim",
  "verbatim",
  "verbatim*",
] as const;

/**
 * LaTeX's verbatim-family scanners consume their body through the matching
 * environment terminator before ordinary comment/group tokenization resumes.
 * Model that lexical unit atomically; the source-backed syntax index projects
 * its exact begin/body/end spans without reparsing the body.
 */
export const opaqueEnvironmentTokens = new ExternalTokenizer(
  (input, stack) => {
    if (input.next !== 92) {
      return;
    }
    for (const name of OPAQUE_ENVIRONMENT_NAMES) {
      const begin = `\\begin{${name}}`;
      if (!matchesExact(input, begin)) {
        continue;
      }
      const canComplete = stack.canShift(OpaqueEnvironmentToken);
      const canRecover = stack.canShift(UnterminatedOpaqueEnvironmentToken);
      if (!canComplete && !canRecover) {
        return;
      }
      advanceExact(input, begin);
      const end = `\\end{${name}}`;
      while (input.next >= 0 && !matchesExact(input, end)) {
        input.advance();
      }
      if (input.next >= 0) {
        advanceExact(input, end);
        if (canComplete) {
          input.acceptToken(OpaqueEnvironmentToken);
        }
      } else if (canRecover) {
        input.acceptToken(UnterminatedOpaqueEnvironmentToken);
      }
      return;
    }
  },
  { contextual: true }
);

function advanceExact(input: InputStream, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    input.advance();
  }
}

function matchesExact(input: InputStream, value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (input.peek(index) !== value.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}
