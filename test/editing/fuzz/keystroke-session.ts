import {
  copySelection,
  intentFromBeforeInput,
  interpretKeyDown,
  resolveIntent,
  type Intent,
  type IntentContext,
} from "../../../packages/core/src/editing/input/index.js";
import type { CommandTable } from "../../../packages/core/src/editing/commands/index.js";
import type { ClipboardPayload } from "../../../packages/core/src/editing/operations/index.js";
import { createEditViewCache, promotedOffsets, type EditView } from "../../../packages/core/src/editing/position/index.js";
import { applyTransaction, TYPING_RUN_PAUSE_MS } from "../../../packages/core/src/editing/transaction/index.js";
import type { ScenarioKey } from "../../../packages/core/src/editing/testing/index.js";
import {
  INITIAL_CANVAS_TEXT_EDIT_STATE,
  interactionState,
  reduceCanvasTextEdit,
  selectionPositions,
  type CanvasTextEditAction,
  type CanvasTextEditState,
} from "../../../packages/app/src/ui/canvas-panel/canvas-text-edit-machine.js";
import type { EditableTextTarget } from "../../../packages/app/src/ui/canvas-panel/types.js";

/**
 * A canvas-focused scope session without rendering: the app's edit
 * machine, the input adapter and the resolver, as the session hook wires
 * them, with no layout (nothing hidden on the step; vertical motion does
 * nothing). Fast enough to run thousands of keystrokes per test.
 *
 * Besides the scenario keys, a session takes clicks: a selection set
 * directly, as a pointer or the hidden input would.
 */
export type FuzzKey =
  | ScenarioKey
  | { readonly kind: "select"; readonly anchor: number; readonly focus: number }
  /** ⌘C and ⌘X, into the session's own clipboard. */
  | { readonly kind: "copy" | "cut" }
  /** ⌘V: the session's clipboard, or text from outside. */
  | { readonly kind: "paste"; readonly plain?: string }
  /** The value editor's fields filled and confirmed (⏎, or `}` with `viaBrace`). */
  | { readonly kind: "pick"; readonly values: readonly string[]; readonly viaBrace?: boolean }
  /** Values already written, edited through their tag. */
  | { readonly kind: "setValues"; readonly edits: readonly { readonly span: { readonly from: number; readonly to: number }; readonly text: string }[] };

export class KeystrokeSession {
  private machine: CanvasTextEditState = INITIAL_CANVAS_TEXT_EDIT_STATE;
  private backward = false;
  private time = 0;
  private readonly views = createEditViewCache();
  private clipboard: ClipboardPayload | null = null;

  constructor(
    text: string,
    readonly commands: CommandTable,
    anchor: number,
    focus = anchor,
    private readonly title = false,
    private readonly frameBody = false
  ) {
    const target = {
      sourceId: "scope",
      sceneTextId: "scope",
      sourceSpan: { from: 0, to: text.length },
      text,
      scopeParagraphs: [],
      renderSourceText: text,
      usesTex: true,
      paragraphId: null,
      layoutKind: "single-line",
      region: { key: "scope", shape: "rect" },
    } as unknown as EditableTextTarget;
    this.dispatch({
      type: "start_session",
      target,
      source: text,
      selectionStart: anchor,
      selectionEnd: focus,
      historyMergeKey: "fuzz",
    });
    this.backward = focus < anchor;
  }

  get text(): string {
    return this.session().text;
  }

  get selection(): { anchor: number; focus: number } {
    const { selectionStart: start, selectionEnd: end } = this.session();
    return this.backward ? { anchor: end, focus: start } : { anchor: start, focus: end };
  }

  get state(): CanvasTextEditState {
    return this.machine;
  }

  get undoDepth(): number {
    return this.machine.history.undo.length;
  }

  get redoDepth(): number {
    return this.machine.history.redo.length;
  }

  view(text = this.text): EditView {
    return this.views(text, this.commands);
  }

  /** Presses one key; returns the intent it became (null for keys without one). */
  press(key: FuzzKey): Intent | null {
    this.time += 50;
    switch (key.kind) {
      case "pause":
        this.time += TYPING_RUN_PAUSE_MS * 2;
        return null;
      case "select": {
        const length = this.text.length;
        // As the session hook does for pointer selections: drawn as promoted.
        const promoted = promotedOffsets(this.view(), Math.min(length, Math.max(0, key.anchor)), Math.min(length, Math.max(0, key.focus)));
        const { anchor, focus } = promoted;
        this.dispatch({ type: "textarea_selection", selectionStart: Math.min(anchor, focus), selectionEnd: Math.max(anchor, focus) });
        this.backward = focus < anchor;
        return null;
      }
      case "copy":
      case "cut": {
        this.clipboard = copySelection(this.context()) ?? this.clipboard;
        if (key.kind === "copy") {
          return null;
        }
        const intent: Intent = { type: "cut", origin: "menu", repeat: false };
        this.run(intent);
        return intent;
      }
      case "paste": {
        const payload = key.plain != null ? { plain: key.plain } : this.clipboard;
        if (!payload) {
          return null;
        }
        const intent: Intent = { type: "paste", payload, origin: "paste", repeat: false };
        this.run(intent);
        return intent;
      }
      case "pick": {
        if (!this.pickerOpen()) {
          return null;
        }
        const intent: Intent = { type: "pickValues", values: key.values, viaBrace: key.viaBrace ?? false, origin: "keyboard", repeat: false };
        this.run(intent);
        return intent;
      }
      case "setValues": {
        const intent: Intent = { type: "setValues", edits: key.edits, origin: "pointer", repeat: false };
        this.run(intent);
        return intent;
      }
      case "text": {
        const intent = intentFromBeforeInput("insertText", key.text)!;
        this.run(intent);
        return intent;
      }
      case "key": {
        const decision = interpretKeyDown({ ...key, composing: false }, "canvas");
        if (decision.kind === "intent") {
          this.run(decision.intent);
          return decision.intent;
        }
        if (decision.kind === "escape" && (this.chipOpen() || this.pickerOpen())) {
          const intent: Intent = { type: "escape", origin: "keyboard", repeat: false };
          this.run(intent);
          return intent;
        }
        return null;
      }
    }
  }

  /** The interaction state the next intent would see. */
  interaction() {
    const { anchor, focus } = this.selection;
    return interactionState(this.machine, anchor, focus);
  }

  chipOpen(): boolean {
    return this.interaction().chip != null;
  }

  /** The value editor, while it is open (O8). */
  picker() {
    return this.interaction().picker ?? null;
  }

  pickerOpen(): boolean {
    return this.picker() != null;
  }

  private session() {
    const session = this.machine.session;
    if (!session) {
      throw new Error("keystroke session: the session closed");
    }
    return session;
  }

  private dispatch(action: CanvasTextEditAction): void {
    this.machine = reduceCanvasTextEdit(this.machine, action).state;
  }

  /** The resolver's view of the session, as the session hook builds it. */
  private context(): IntentContext {
    const state = this.machine;
    const session = this.session();
    const { anchor, focus } = this.selection;
    return {
      surface: "canvas",
      editMode: session.editMode,
      isScopeSession: true,
      revision: state.inputRevision,
      text: session.text,
      bufferFrom: 0,
      anchor,
      focus,
      composition: null,
      domain: null,
      verticalGoal: state.verticalGoal,
      structure: (text, visibility) => this.views(text, this.commands, visibility),
      positions: selectionPositions(state, anchor, focus),
      interaction: interactionState(state, anchor, focus),
      commands: this.commands,
      title: this.title,
      frameBody: this.frameBody,
    };
  }

  private run(intent: Intent): void {
    const session = this.session();
    const resolution = resolveIntent(this.context(), intent);
    switch (resolution.kind) {
      case "transaction": {
        const applied = applyTransaction(session.text, resolution.transaction);
        this.backward = applied.focus < applied.anchor;
        this.dispatch({ type: "apply_transaction", transaction: resolution.transaction, time: this.time });
        return;
      }
      case "history":
        this.backward = false;
        this.dispatch({ type: "history", direction: resolution.direction });
        return;
      case "close":
      case "none":
        return;
    }
  }
}
