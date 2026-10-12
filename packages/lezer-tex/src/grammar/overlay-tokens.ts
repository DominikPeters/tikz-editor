import { ExternalTokenizer } from "@lezer/lr";
import { Dialect_beamer, OverlayClose, OverlayOpen } from "./tex-parser.terms.js";

// A Beamer overlay specification can only stand where the grammar accepts
// one. Elsewhere, in math above all (`x^Td<0`), `<` and `>` are ordinary
// text, rather than the start of a specification that swallows what follows.
export const overlayTokens = new ExternalTokenizer((input, stack) => {
  if (!stack.dialectEnabled(Dialect_beamer)) return;
  if (input.next === 60 && stack.canShift(OverlayOpen)) {
    input.advance();
    input.acceptToken(OverlayOpen);
  } else if (input.next === 62 && stack.canShift(OverlayClose)) {
    input.advance();
    input.acceptToken(OverlayClose);
  }
}, { contextual: true });
