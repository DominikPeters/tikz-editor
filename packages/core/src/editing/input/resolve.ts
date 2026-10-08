import {
  applyBeamerStructuralPatchToBuffer,
  resolveCanvasAtomSelection,
  resolveCanvasRenderedMotion,
  resolveCanvasStructuralDelete,
  resolveCanvasStructuralEnter,
  resolveCanvasStructuralTab,
  type CanvasBufferSelection,
  type CanvasMotionResult,
  type CanvasStructuralKeyOutcome,
} from "../../beamer/canvas-keys.js";
import type { BeamerCaretDomain } from "../../beamer/caret-stops.js";
import {
  beamerStructuralListTogglePatch,
  beamerStructuralTabPatch,
  type BeamerStructuralPatch,
} from "../../beamer/structural-edit.js";
import {
  activeTextFormatWrapper,
  applyTextColorCommand,
  toggleTextFormatCommand,
  type TextFormatCommandName,
  type TextFormatToggleResult,
} from "../../text/format-commands.js";
import {
  replacementPatches,
  type BufferPatch,
  type BufferRange,
  type Transaction,
  type TransactionSelection,
  type UndoGrouping,
  type VerticalGoal,
} from "../transaction/index.js";
import type { InputSurface } from "./adapter.js";
import type { FormatCommand, Intent } from "./intent.js";
import { logicalLineBoundary, nextWordBoundary, previousWordBoundary } from "./text-units.js";

/**
 * Resolves an intent against the session state into a transaction.
 *
 * This is today's canvas and bar behaviour expressed as one function per
 * intent type (migration step 2 of design/canvas-editing-architecture.md):
 * the precedence that used to live in a ladder of key handlers (structural
 * keys, then rendered motion, then the textarea) is now explicit per
 * intent. Ownership-based resolution replaces it in a later step.
 */
export type IntentContext = {
  readonly surface: InputSurface;
  readonly editMode: "default" | "inline-typo";
  readonly isScopeSession: boolean;
  /** Buffer revision; becomes the transaction's base revision. */
  readonly revision: number;
  readonly text: string;
  /** Document offset of the buffer start. */
  readonly bufferFrom: number;
  /** Buffer-local selection. */
  readonly anchor: number;
  readonly focus: number;
  readonly composition: BufferRange | null;
  /**
   * The scope's rendered caret domain (scope sessions only). The caller
   * ensures it is current for intents that need it (needsFreshLayout).
   */
  readonly domain: BeamerCaretDomain | null;
  readonly verticalGoal: VerticalGoal | null;
};

export type IntentResolution =
  | { readonly kind: "transaction"; readonly transaction: Transaction }
  | { readonly kind: "history"; readonly direction: "undo" | "redo" }
  /** End the session (Enter in a single-line inline-typo session). */
  | { readonly kind: "close" }
  | { readonly kind: "none" };

const NONE: IntentResolution = { kind: "none" };

const WRAP_COMMANDS: Partial<Record<FormatCommand, Exclude<TextFormatCommandName, "textcolor">>> = {
  bold: "textbf",
  italic: "textit",
  underline: "underline",
  mono: "texttt",
  alert: "alert",
};

/**
 * Whether resolving the intent reads the rendered layout, so it must wait
 * until the layout reflects the current buffer (the revision protocol).
 */
export function needsFreshLayout(intent: Intent, surface: InputSurface, isScopeSession: boolean): boolean {
  switch (intent.type) {
    case "move":
    case "enter":
    case "tab":
      return surface === "canvas";
    case "deleteBackward":
    case "deleteForward":
      return surface === "canvas" && intent.unit === "item";
    case "format":
      return isScopeSession && WRAP_COMMANDS[intent.command] === undefined;
    case "insertText":
    case "compose":
    case "cut":
    case "color":
    case "undo":
    case "redo":
      return false;
  }
}

export function resolveIntent(context: IntentContext, intent: Intent): IntentResolution {
  const resolver = new Resolver(context);
  switch (intent.type) {
    case "insertText":
      if (
        context.editMode === "inline-typo" &&
        intent.origin !== "keyboard" &&
        /[\r\n]/u.test(intent.text)
      ) {
        return NONE;
      }
      return resolver.replaceSelection(
        intent.text,
        intent.origin === "keyboard" ? { group: "typing-run", run: "insert" } : { group: "own-step" }
      );
    case "compose":
      return resolver.compose(intent.text, intent.commit);
    case "deleteBackward":
    case "deleteForward":
      return resolver.delete(intent.type === "deleteBackward" ? "backward" : "forward", intent.unit);
    case "cut":
      return resolver.hasRange() ? resolver.replaceSelection("", { group: "own-step" }) : NONE;
    case "enter":
      return resolver.enter(intent.soft);
    case "tab":
      return context.surface === "canvas"
        ? resolver.structural(resolveCanvasStructuralTab(context.domain, resolver.bufferSelection(), intent.back))
        : NONE;
    case "move":
      return resolver.move(intent);
    case "format":
      return resolver.format(intent.command);
    case "color":
      return resolver.color(intent.color);
    case "undo":
      return { kind: "history", direction: "undo" };
    case "redo":
      return { kind: "history", direction: "redo" };
  }
}

class Resolver {
  private readonly from: number;
  private readonly to: number;

  constructor(private readonly context: IntentContext) {
    this.from = Math.min(context.anchor, context.focus);
    this.to = Math.max(context.anchor, context.focus);
  }

  hasRange(): boolean {
    return this.from !== this.to;
  }

  bufferSelection(): CanvasBufferSelection {
    return {
      bufferFrom: this.context.bufferFrom,
      bufferLength: this.context.text.length,
      selectionStart: this.from,
      selectionEnd: this.to,
      backward: this.context.focus < this.context.anchor,
    };
  }

  private transaction(
    patches: readonly BufferPatch[],
    selection: TransactionSelection,
    undo: UndoGrouping,
    extra: Pick<Transaction, "composition" | "verticalGoal"> = {}
  ): IntentResolution {
    return {
      kind: "transaction",
      transaction: { baseRevision: this.context.revision, patches, selection, undo, ...extra },
    };
  }

  private select(anchor: number, focus: number, verticalGoal: VerticalGoal | null = null): IntentResolution {
    return this.transaction([], { kind: "absolute", anchor, focus }, { group: "own-step" }, { verticalGoal });
  }

  private selectMotionResult(result: CanvasMotionResult): IntentResolution {
    const backward = result.direction === "backward";
    return this.select(
      backward ? result.selectionEnd : result.selectionStart,
      backward ? result.selectionStart : result.selectionEnd,
      result.verticalGoal
    );
  }

  /** Replaces the selection; the caret lands after the inserted text. */
  replaceSelection(insert: string, undo: UndoGrouping): IntentResolution {
    const after = { offset: this.to, assoc: 1 as const };
    return this.transaction(
      [{ from: this.from, to: this.to, insert }],
      { kind: "mapped", anchor: after, focus: after },
      undo
    );
  }

  private deleteRange(from: number, to: number, undo: UndoGrouping): IntentResolution {
    if (from < 0 || to <= from) {
      return NONE;
    }
    const at = { offset: from, assoc: -1 as const };
    return this.transaction([{ from, to, insert: "" }], { kind: "mapped", anchor: at, focus: at }, undo);
  }

  compose(text: string, commit: boolean): IntentResolution {
    const range = this.context.composition ?? { from: this.from, to: this.to };
    const caret = range.from + text.length;
    return this.transaction(
      [{ from: range.from, to: range.to, insert: text }],
      { kind: "absolute", anchor: caret, focus: caret },
      { group: "composition", first: this.context.composition == null },
      { composition: commit ? null : { from: range.from, to: caret } }
    );
  }

  delete(direction: "backward" | "forward", unit: "char" | "item" | "word" | "line"): IntentResolution {
    const { text } = this.context;
    if (unit === "item" && this.context.surface === "canvas") {
      const structural = resolveCanvasStructuralDelete(this.context.domain, this.bufferSelection(), direction);
      if (structural.kind !== "native") {
        return this.structural(structural);
      }
      const atom = resolveCanvasAtomSelection(this.context.domain, this.bufferSelection(), direction);
      if (atom) {
        return this.selectMotionResult(atom);
      }
    }
    if (this.hasRange()) {
      return this.deleteRange(this.from, this.to, { group: "own-step" });
    }
    const caret = this.from;
    switch (unit) {
      case "char":
      case "item":
        return direction === "backward"
          ? this.deleteRange(caret - 1, caret, { group: "typing-run", run: "delete-backward" })
          : this.deleteRange(caret, Math.min(text.length, caret + 1), { group: "typing-run", run: "delete-forward" });
      case "word":
        return direction === "backward"
          ? this.deleteRange(previousWordBoundary(text, caret), caret, { group: "own-step" })
          : this.deleteRange(caret, nextWordBoundary(text, caret), { group: "own-step" });
      case "line":
        return direction === "backward"
          ? this.deleteRange(logicalLineBoundary(text, caret, "backward"), caret, { group: "own-step" })
          : this.deleteRange(caret, logicalLineBoundary(text, caret, "forward"), { group: "own-step" });
    }
  }

  enter(soft: boolean): IntentResolution {
    if (this.context.editMode === "inline-typo") {
      return { kind: "close" };
    }
    if (this.context.surface === "canvas") {
      const structural = resolveCanvasStructuralEnter(this.context.domain, this.bufferSelection(), soft);
      if (structural.kind !== "native") {
        return this.structural(structural);
      }
    }
    return this.replaceSelection("\n", { group: "own-step" });
  }

  move(motion: Extract<Intent, { type: "move" }>): IntentResolution {
    if (this.context.surface !== "canvas") {
      return NONE;
    }
    const rendered = resolveCanvasRenderedMotion(
      this.context.domain,
      this.bufferSelection(),
      motion,
      this.context.verticalGoal
    );
    if (rendered) {
      return this.selectMotionResult(rendered);
    }
    // No rendered domain: source-character motion.
    const { text, anchor, focus } = this.context;
    const backward = motion.dir === "left" || motion.dir === "up";
    let next: number;
    switch (motion.unit) {
      case "item":
        if (!motion.extend && this.hasRange()) {
          next = backward ? this.from : this.to;
        } else {
          next = Math.min(text.length, Math.max(0, focus + (backward ? -1 : 1)));
        }
        break;
      case "edge":
        next = logicalLineBoundary(text, focus, backward ? "backward" : "forward");
        break;
      case "scope":
        next = backward ? 0 : text.length;
        break;
      case "line":
        return NONE;
    }
    return motion.extend ? this.select(anchor, next) : this.select(next, next);
  }

  structural(outcome: CanvasStructuralKeyOutcome): IntentResolution {
    switch (outcome.kind) {
      case "native":
      case "swallow":
        return NONE;
      case "patch":
        return this.structuralPatch(outcome.patch);
    }
  }

  /**
   * A structural patch computed against the rendered domain. The staleness
   * guard drops it when the buffer no longer holds the text it was
   * computed against (layout fell behind and the caller ran it anyway).
   */
  private structuralPatch(patch: BeamerStructuralPatch): IntentResolution {
    const { domain, bufferFrom, text } = this.context;
    if (!domain) {
      return NONE;
    }
    const applied = applyBeamerStructuralPatchToBuffer({ text, from: bufferFrom }, domain.source, patch);
    if (!applied) {
      return NONE;
    }
    const patches = patch.edits
      .map((edit) => ({ from: edit.span.from - bufferFrom, to: edit.span.to - bufferFrom, insert: edit.insert }))
      .sort((left, right) => left.from - right.from);
    return this.transaction(
      patches,
      { kind: "absolute", anchor: applied.caretLocal, focus: applied.selectionEndLocal },
      { group: "own-step" }
    );
  }

  private toggleResult(result: TextFormatToggleResult | null): IntentResolution {
    if (!result) {
      return NONE;
    }
    return this.transaction(
      replacementPatches(this.context.text, result.nextText),
      { kind: "absolute", anchor: result.selectionStart, focus: result.selectionEnd },
      { group: "own-step" }
    );
  }

  /**
   * Format wraps must not swallow structure: a selection containing an
   * `\item` or environment boundary would wrap it into the command
   * argument. Removing an active wrapper is always allowed.
   */
  private formatAllowed(name: TextFormatCommandName): boolean {
    if (activeTextFormatWrapper(this.context.text, this.from, this.to, name)) {
      return true;
    }
    return !/\\(?:item|begin|end)(?![a-zA-Z])/u.test(this.context.text.slice(this.from, this.to));
  }

  format(command: FormatCommand): IntentResolution {
    if (this.context.composition) {
      return NONE;
    }
    const wrap = WRAP_COMMANDS[command];
    if (wrap) {
      if (!this.formatAllowed(wrap)) {
        return NONE;
      }
      return this.toggleResult(toggleTextFormatCommand(this.context.text, this.from, this.to, wrap));
    }
    const { domain, bufferFrom } = this.context;
    if (!this.context.isScopeSession || !domain) {
      return NONE;
    }
    const offset = bufferFrom + this.from;
    const result =
      command === "bullets" || command === "numbered"
        ? beamerStructuralListTogglePatch(domain, offset, command === "bullets" ? "itemize" : "enumerate")
        : beamerStructuralTabPatch(domain, offset, command === "indent" ? "nest" : "unnest", bufferFrom + this.to);
    if (!result || result === "swallow") {
      return NONE;
    }
    return this.structuralPatch(result);
  }

  color(color: string | null): IntentResolution {
    if (this.context.composition || !this.formatAllowed("textcolor")) {
      return NONE;
    }
    return this.toggleResult(applyTextColorCommand(this.context.text, this.from, this.to, color));
  }
}
