import type { CommitKey } from "../operations/command.js";

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
  /** The command chip (R4), open while a command name is typed. */
  readonly chip?: ChipState;
  /**
   * A command just committed whose optional argument the next keystroke
   * may still open (`\\` then `[`, O4). The offset right after it.
   */
  readonly pending?: number;
  /** The value editor (O8), open for a command that is not written until its values are filled. */
  readonly picker?: PickerState;
  /** The source lens (R13), open on a span of the buffer. */
  readonly lens?: LensState;
  /**
   * A `\right` written with its `\left` and not yet accepted (M14): drawn
   * faint, it stays at the caret, which is right before it. Typing goes
   * in front of it; ←/→ (⌥ by word, ⌘ to the end) take it along over
   * what is already written; ⇥, Esc, typing its delimiter or `\right`, or
   * anything that moves the caret elsewhere accepts it where it stands.
   * The offset is the `\right`'s, which is the caret's.
   */
  readonly pendingCloser?: number;
  /** Outside text just pasted as TeX (C2), which ⌘Z gives back as text. The caret's offset after it. */
  readonly pastedTex?: number;
};

/**
 * The source lens: raw source of a span edited in place. Its edits carry
 * it on with the span they leave; Esc, or any other edit, closes it.
 */
export type LensState = {
  /** The span it edits (buffer offsets). */
  readonly span: { readonly from: number; readonly to: number };
};

/**
 * The command chip: the name typed after `\`, outside the source until it
 * is committed, so a half-typed command never reaches the renderer.
 */
export type ChipState = {
  readonly name: string;
  /** Where the command goes (buffer offset). */
  readonly at: number;
  /** The highlighted completion. */
  readonly selected: number;
  /** A selection the command will wrap or replace (R10). */
  readonly held: { readonly from: number; readonly to: number } | null;
};

/**
 * A command waiting for its values (O8): the chip committed it, and the
 * value editor asks for them. Nothing is written until they are filled;
 * Esc, or any other edit, closes it with nothing written.
 */
export type PickerState = {
  readonly name: string;
  /** Where the command goes (buffer offset). */
  readonly at: number;
  /** A selection the command will wrap, or replace when it has no content argument. */
  readonly held: { readonly from: number; readonly to: number } | null;
  /** The key that committed it: `[` and `<` add the argument they open to the fields. */
  readonly key: CommitKey;
  /** What the first field starts with: a character typed right after the name, or the selection it replaces. */
  readonly seed: string;
};

export const NO_INTERACTION: InteractionState = {};
