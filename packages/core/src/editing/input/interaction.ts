/**
 * The session's non-source state between keystrokes
 * (design/canvas-editing-architecture.md, "Interaction state"). A
 * transaction carries the state after it; a transaction without one, any
 * other change of buffer or selection (a click, undo), and the end of the
 * session reset it. So every field lives only until the next intent unless
 * that intent hands it on.
 *
 * Offsets are buffer-local, in the buffer the state was recorded with.
 */
export type InteractionState = {
  /**
   * Editor-created braces `{}` holding an empty slot the caret is in
   * (R6): `x^{‸}` after `^`, `${‸}$` after `$`, `\frac1{‸}` after ⌫. The
   * first thing typed replaces them, and a single token in a script or
   * argument leaves it (`x^2‸`). Leaving an empty script or formula
   * removes it. The offset is the `{`.
   */
  readonly placeholder?: number;
  /**
   * `}` just moved the caret to the start of the next argument
   * (`\frac{n}‸{}`): a `{` typed now is the argument's own brace and is
   * consumed (R3 delimiter consumption). The offset is the caret's.
   */
  readonly consumeOpen?: number;
};

export const NO_INTERACTION: InteractionState = {};
