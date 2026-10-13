/**
 * Intents (design/canvas-editing-architecture.md, "Intents"): what the
 * user asked for, independent of which DOM event carried it. The input
 * adapter (adapter.ts) is the only place that looks at key names and
 * input types.
 */

import type { ClipboardPayload } from "../operations/paste.js";
import type { Span } from "../tree/types.js";

export type IntentOrigin = "keyboard" | "composition" | "paste" | "menu" | "pointer";

/** Toolbar and shortcut format commands. */
export type FormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "mono"
  | "alert"
  | "bullets"
  | "numbered"
  | "outdent"
  | "indent";

/**
 * Deletion units: `item` is the canvas unit (rendered constructs, list
 * structure); `char` is one source character, as in a plain textarea.
 */
export type DeleteUnit = "char" | "item" | "word" | "line";

/**
 * Motion units: `item` for ←/→, `line` for ↑/↓ (rendered rows), `edge`
 * for row edges (Home/End, ⌘←/⌘→), `scope` for the session's first/last
 * position (⌘↑/⌘↓), `word` for ⌥←/⌥→ while a `\right` is pending
 * (otherwise ⌥←/⌥→ stay native).
 */
export type MoveUnit = "item" | "line" | "edge" | "scope" | "word";

export type IntentBody =
  | { readonly type: "insertText"; readonly text: string }
  /** IME composition update (`commit` false) or final text (`commit` true). */
  | { readonly type: "compose"; readonly text: string; readonly commit: boolean }
  | { readonly type: "deleteBackward" | "deleteForward"; readonly unit: DeleteUnit }
  | { readonly type: "cut" }
  /** Pasted or dropped content: a canvas copy, or plain text from outside (O6). */
  | { readonly type: "paste"; readonly payload: ClipboardPayload }
  | { readonly type: "enter"; readonly soft: boolean }
  | { readonly type: "tab"; readonly back: boolean }
  | {
      readonly type: "move";
      readonly dir: "left" | "right" | "up" | "down";
      readonly unit: MoveUnit;
      readonly extend: boolean;
    }
  | { readonly type: "format"; readonly command: FormatCommand }
  | { readonly type: "color"; readonly color: string | null }
  /**
   * The value editor's fields, filled (O8): writes the command it is open
   * for. `viaBrace`: confirmed by a typed `}`, so a `{` typed next is the
   * following argument's own brace.
   */
  | { readonly type: "pickValues"; readonly values: readonly string[]; readonly viaBrace: boolean }
  /** Values already written, edited: each named by its content span (buffer-local). */
  | { readonly type: "setValues"; readonly edits: readonly { readonly span: Span; readonly text: string }[] }
  /** ⌘E: the source lens (R13), on the innermost construct around the caret or the selection. */
  | { readonly type: "openLens" }
  /** The lens's text after an edit, and its caret there: written over the lens span. */
  | { readonly type: "setLensText"; readonly text: string; readonly caret: number }
  /** Write the closers recovery put in virtually (T6), at buffer-local offsets. */
  | { readonly type: "insertClosers"; readonly closers: readonly { readonly at: number; readonly text: string }[] }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  /**
   * An entry of the focus tag's menu (V4) for the construct with this
   * span (buffer-local): a variant, Unwrap, Select or Edit source.
   */
  | { readonly type: "constructMenu"; readonly span: Span; readonly id: string }
  /** A ghost slot clicked (V3): the optional slot it stands for is written, with the caret in it. */
  | { readonly type: "createSlot"; readonly kind: "index" | "sup" | "sub" | "label"; readonly at: number }
  /** A completion of the command chip picked with the pointer (V2): committed as ⇥ commits the highlighted one. */
  | { readonly type: "pickCompletion"; readonly index: number }
  /** Esc while something transient is open (the command chip, value editor or lens); the session itself handles Esc otherwise. */
  | { readonly type: "escape" };

export type Intent = IntentBody & {
  readonly origin: IntentOrigin;
  /** An auto-repeat keystroke (key held down). */
  readonly repeat: boolean;
};

export type IntentType = Intent["type"];
