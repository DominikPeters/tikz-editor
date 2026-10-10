import type { Intent, IntentBody, IntentOrigin } from "./intent.js";

/**
 * The input adapter: the one place that turns DOM keyboard and
 * `beforeinput` events into intents. Text arrives through `beforeinput`
 * (so IME, dead keys and keyboard layouts work); keys without text
 * (arrows, Enter, Backspace on the canvas) are claimed at keydown.
 *
 * During an IME composition the adapter claims nothing at keydown: the
 * composition overlay suspends interpretation until it commits.
 */

export type KeyStroke = {
  /** `KeyboardEvent.key`. */
  readonly key: string;
  readonly shift: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  readonly primary: boolean;
  readonly alt: boolean;
  readonly repeat: boolean;
  readonly composing: boolean;
};

/** The surface holding keyboard focus in a session. */
export type InputSurface = "canvas" | "bar";

export type KeyDownDecision =
  | { readonly kind: "intent"; readonly intent: Intent }
  /** Session lifecycle: step out one level. */
  | { readonly kind: "escape" }
  /** ⌘E: the source lens in a scope session (R13); elsewhere, the keyboard to the docked bar. */
  | { readonly kind: "focusBar" }
  /** Consume the key without effect (e.g. Tab must not leave the session). */
  | { readonly kind: "block" }
  /** Let the browser handle it; any text arrives through `beforeinput`. */
  | { readonly kind: "native" };

const NATIVE: KeyDownDecision = { kind: "native" };
const BLOCK: KeyDownDecision = { kind: "block" };

const FORMAT_SHORTCUTS = { b: "bold", i: "italic", u: "underline" } as const;

/**
 * `pendingCloser`: a `\right` is pending (M14), so ⌥←/⌥→ take it along by
 * word instead of moving natively.
 */
export function interpretKeyDown(stroke: KeyStroke, surface: InputSurface, pendingCloser = false): KeyDownDecision {
  if (stroke.composing) {
    return NATIVE;
  }
  const { key, shift, primary, alt } = stroke;
  const intent = (body: IntentBody): KeyDownDecision => ({
    kind: "intent",
    intent: { ...body, origin: "keyboard", repeat: stroke.repeat },
  });
  if (key === "Escape") {
    return { kind: "escape" };
  }
  if (primary && !alt) {
    const lower = key.toLowerCase();
    if (!shift && lower === "e") {
      // On the bar ⌘E targets the bar itself; swallow it so the browser's
      // "use selection for find" cannot fire mid-session.
      return surface === "canvas" ? { kind: "focusBar" } : BLOCK;
    }
    if (!shift && lower in FORMAT_SHORTCUTS) {
      return intent({ type: "format", command: FORMAT_SHORTCUTS[lower as keyof typeof FORMAT_SHORTCUTS] });
    }
    if (lower === "z") {
      return intent({ type: shift ? "redo" : "undo" });
    }
    if (lower === "y" && !shift) {
      return intent({ type: "redo" });
    }
  }
  if (surface === "bar") {
    return NATIVE;
  }
  switch (key) {
    case "Enter":
      return primary || alt ? NATIVE : intent({ type: "enter", soft: shift });
    case "Tab":
      return primary || alt ? BLOCK : intent({ type: "tab", back: shift });
    case "Backspace":
    case "Delete":
      // Modified deletes (word, line, shift) stay native source deletes,
      // arriving as `beforeinput`.
      if (primary || alt || shift) {
        return NATIVE;
      }
      return intent({ type: key === "Backspace" ? "deleteBackward" : "deleteForward", unit: "item" });
    case "ArrowLeft":
    case "ArrowRight":
      if (alt && pendingCloser && surface === "canvas" && !primary) {
        return intent({ type: "move", dir: key === "ArrowLeft" ? "left" : "right", unit: "word", extend: shift });
      }
      if (alt) {
        return NATIVE;
      }
      return intent({
        type: "move",
        dir: key === "ArrowLeft" ? "left" : "right",
        unit: primary ? "edge" : "item",
        extend: shift,
      });
    case "ArrowUp":
    case "ArrowDown":
      if (alt) {
        return NATIVE;
      }
      return intent({
        type: "move",
        dir: key === "ArrowUp" ? "up" : "down",
        unit: primary ? "scope" : "line",
        extend: shift,
      });
    case "Home":
    case "End":
      if (alt) {
        return NATIVE;
      }
      return intent({ type: "move", dir: key === "Home" ? "left" : "right", unit: "edge", extend: shift });
    default:
      return NATIVE;
  }
}

const BEFORE_INPUT_TYPES = [
  "insertText",
  "insertReplacementText",
  "insertLineBreak",
  "insertParagraph",
  "insertCompositionText",
  "insertFromComposition",
  "insertFromPaste",
  "insertFromDrop",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteWordBackward",
  "deleteWordForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteHardLineBackward",
  "deleteHardLineForward",
  "deleteByCut",
  "historyUndo",
  "historyRedo",
] as const;

export type BeforeInputType = (typeof BEFORE_INPUT_TYPES)[number];

export function isSupportedBeforeInputType(inputType: string): inputType is BeforeInputType {
  return (BEFORE_INPUT_TYPES as readonly string[]).includes(inputType);
}

export const SUPPORTED_BEFORE_INPUT_TYPES: readonly string[] = BEFORE_INPUT_TYPES;

/**
 * Maps a `beforeinput` event to an intent; null for input types the
 * session does not support (the caller lets those through and reports
 * them). `data` must already be resolved (paste and drop payloads).
 */
export function intentFromBeforeInput(inputType: string, data: string | null): Intent | null {
  if (!isSupportedBeforeInputType(inputType)) {
    return null;
  }
  const text = data ?? "";
  const make = (body: IntentBody, origin: IntentOrigin = "keyboard"): Intent => ({
    ...body,
    origin,
    repeat: false,
  });
  switch (inputType) {
    case "insertText":
      return make({ type: "insertText", text });
    case "insertReplacementText":
      return make({ type: "insertText", text }, "menu");
    case "insertFromPaste":
      return make({ type: "paste", payload: { plain: text } }, "paste");
    case "insertFromDrop":
      return make({ type: "paste", payload: { plain: text } }, "pointer");
    case "insertLineBreak":
      return make({ type: "enter", soft: true });
    case "insertParagraph":
      return make({ type: "enter", soft: false });
    case "insertCompositionText":
      return make({ type: "compose", text, commit: false }, "composition");
    case "insertFromComposition":
      return make({ type: "compose", text, commit: true }, "composition");
    case "deleteContentBackward":
      return make({ type: "deleteBackward", unit: "char" });
    case "deleteContentForward":
      return make({ type: "deleteForward", unit: "char" });
    case "deleteWordBackward":
      return make({ type: "deleteBackward", unit: "word" });
    case "deleteWordForward":
      return make({ type: "deleteForward", unit: "word" });
    case "deleteSoftLineBackward":
    case "deleteHardLineBackward":
      return make({ type: "deleteBackward", unit: "line" });
    case "deleteSoftLineForward":
    case "deleteHardLineForward":
      return make({ type: "deleteForward", unit: "line" });
    case "deleteByCut":
      return make({ type: "cut" }, "menu");
    case "historyUndo":
      return make({ type: "undo" }, "menu");
    case "historyRedo":
      return make({ type: "redo" }, "menu");
  }
}
