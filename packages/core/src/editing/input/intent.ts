/**
 * Intents (design/canvas-editing-architecture.md, "Intents"): what the
 * user asked for, independent of which DOM event carried it. The input
 * adapter (adapter.ts) is the only place that looks at key names and
 * input types.
 */

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
 * position (⌘↑/⌘↓).
 */
export type MoveUnit = "item" | "line" | "edge" | "scope";

export type IntentBody =
  | { readonly type: "insertText"; readonly text: string }
  /** IME composition update (`commit` false) or final text (`commit` true). */
  | { readonly type: "compose"; readonly text: string; readonly commit: boolean }
  | { readonly type: "deleteBackward" | "deleteForward"; readonly unit: DeleteUnit }
  | { readonly type: "cut" }
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
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  /** Esc while something transient is open (the command chip); the session itself handles Esc otherwise. */
  | { readonly type: "escape" };

export type Intent = IntentBody & {
  readonly origin: IntentOrigin;
  /** An auto-repeat keystroke (key held down). */
  readonly repeat: boolean;
};

export type IntentType = Intent["type"];
