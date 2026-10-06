import { ExternalTokenizer } from "@lezer/lr";
import { Dollar, DoubleDollar } from "./tex-parser.terms.js";

// Inside inline math the first $ closes that formula, even when another $
// immediately opens the next one. Only an outside-math $$ opens a display.
export const mathDelimiterTokens = new ExternalTokenizer((input, stack) => {
  if (input.next !== 36) return;
  if (input.peek(1) === 36 && stack.canShift(DoubleDollar)) {
    input.advance(2);
    input.acceptToken(DoubleDollar);
  } else {
    input.advance();
    input.acceptToken(Dollar);
  }
}, { contextual: true });
