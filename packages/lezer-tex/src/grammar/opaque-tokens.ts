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
const BEGIN_ENVIRONMENT_PREFIX = "\\begin{";

/**
 * LaTeX's verbatim-family scanners consume their body through the matching
 * environment terminator before ordinary comment/group tokenization resumes.
 * Model that lexical unit atomically; the source-backed syntax index projects
 * its exact begin/body/end spans without reparsing the body.
 */
export const opaqueEnvironmentTokens = new ExternalTokenizer(
  (input, stack) => {
    if (
      input.next !== 92 ||
      !matchesExact(input, BEGIN_ENVIRONMENT_PREFIX)
    ) {
      return;
    }
    for (const name of OPAQUE_ENVIRONMENT_NAMES) {
      if (
        !matchesExact(input, name, BEGIN_ENVIRONMENT_PREFIX.length) ||
        input.peek(BEGIN_ENVIRONMENT_PREFIX.length + name.length) !== 125
      ) {
        continue;
      }
      const canComplete = stack.canShift(OpaqueEnvironmentToken);
      const canRecover = stack.canShift(UnterminatedOpaqueEnvironmentToken);
      if (!canComplete && !canRecover) {
        return;
      }
      const begin = `${BEGIN_ENVIRONMENT_PREFIX}${name}}`;
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

function matchesExact(
  input: InputStream,
  value: string,
  offset = 0
): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (input.peek(offset + index) !== value.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}
