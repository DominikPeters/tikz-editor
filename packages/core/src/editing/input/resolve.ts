import {
  resolveCanvasRenderedMotion,
  type CanvasBufferSelection,
  type CanvasMotionResult,
} from "../../beamer/canvas-keys.js";
import type { BeamerCaretDomain } from "../../beamer/caret-stops.js";
import {
  activeTextFormatWrapper,
  applyTextColorCommand,
  toggleTextFormatCommand,
  type TextFormatCommandName,
  type TextFormatToggleResult,
} from "../../text/format-commands.js";
import {
  abandonPlaceholder,
  deleteBackward,
  deleteForward,
  deleteRange,
  enter,
  indentItems,
  joinBackward,
  joinForward,
  placeholderAt,
  tab,
  toggleList,
  typeCharacter,
  type EditOutcome,
} from "../operations/index.js";
import {
  hiddenNodes,
  promoteSelection,
  type EditView,
  type Position,
  type SelectionEnds,
} from "../position/index.js";
import type { NodeId } from "../tree/types.js";
import {
  applyPatches,
  replacementPatches,
  type BufferPatch,
  type BufferRange,
  type Transaction,
  type TransactionSelection,
  type UndoGrouping,
  type VerticalGoal,
} from "../transaction/index.js";
import type { InputSurface } from "./adapter.js";
import { NO_INTERACTION, type InteractionState } from "./interaction.js";
import type { FormatCommand, Intent } from "./intent.js";
import { logicalLineBoundary, nextWordBoundary, previousWordBoundary } from "./text-units.js";

/**
 * Resolves an intent against the session state into a transaction.
 *
 * On the canvas of a scope session, horizontal motion, selection and
 * deletion work on the edit tree (migration step 4 of
 * design/canvas-editing-architecture.md): caret stops, selection
 * promotion and the deletion operations. Flow edges (paragraph and item
 * starts) still go to the structural keys, which read the rendered layout,
 * as do vertical motion, row edges and Enter/Tab. The bar keeps source
 * semantics.
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
  /**
   * The edit view of a buffer text (with the nodes the layout hides), for
   * tree-backed editing on the canvas of a scope session; null keeps
   * source-character semantics.
   */
  readonly structure: ((text: string, hidden?: ReadonlySet<NodeId>) => EditView) | null;
  /** The raw selection ends as positions in the current buffer, when the caller still has them. */
  readonly positions: SelectionEnds | null;
  /** The interaction state the last transaction left, while buffer and selection are unchanged. */
  readonly interaction: InteractionState;
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
export function needsFreshLayout(intent: Intent, surface: InputSurface, _isScopeSession: boolean): boolean {
  switch (intent.type) {
    case "move":
      return surface === "canvas";
    case "enter":
    case "tab":
    case "deleteBackward":
    case "deleteForward":
    case "format":
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
      return resolver.insertText(intent.text, intent.origin === "keyboard");
    case "compose":
      return resolver.compose(intent.text, intent.commit);
    case "deleteBackward":
    case "deleteForward":
      return resolver.delete(intent.type === "deleteBackward" ? "backward" : "forward", intent.unit, intent.repeat);
    case "cut":
      return resolver.cut();
    case "enter":
      return resolver.enter(intent.soft);
    case "tab":
      return resolver.tab(intent.back);
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

/** Whether an offset follows an unescaped backslash (an odd run of them). */
function afterEscape(text: string, offset: number): boolean {
  let start = offset;
  while (start > 0 && text[start - 1] === "\\") {
    start -= 1;
  }
  return (offset - start) % 2 === 1;
}

class Resolver {
  private readonly from: number;
  private readonly to: number;
  /** The edit view of the current buffer, on tree-backed surfaces. */
  private readonly view: EditView | null;

  constructor(private readonly context: IntentContext) {
    this.from = Math.min(context.anchor, context.focus);
    this.to = Math.max(context.anchor, context.focus);
    this.view = context.surface === "canvas" && context.structure ? this.currentView(context.structure) : null;
  }

  /** The current buffer's view, minus what the rendered layout hides on this step. */
  private currentView(structure: NonNullable<IntentContext["structure"]>): EditView {
    const view = structure(this.context.text);
    const hidden = this.context.domain ? hiddenNodes(view.tree, this.context.domain, this.context.bufferFrom) : null;
    return hidden && hidden.size > 0 ? structure(this.context.text, hidden) : view;
  }

  /** The raw selection ends, from the caller or from the offsets. */
  private rawEnds(view: EditView): SelectionEnds {
    return this.context.positions ?? {
      anchor: view.positionAt(this.context.anchor),
      focus: view.positionAt(this.context.focus),
    };
  }

  /** The promoted selection, start first. */
  private effectiveRange(view: EditView, raw: SelectionEnds): { start: Position; end: Position } {
    const effective = promoteSelection(view, raw);
    return view.rank(effective.anchor) <= view.rank(effective.focus)
      ? { start: effective.anchor, end: effective.focus }
      : { start: effective.focus, end: effective.anchor };
  }

  /** Selects by raw ends; the selection drawn is their promotion. */
  private selectPositions(view: EditView, raw: SelectionEnds, interaction = NO_INTERACTION): IntentResolution {
    const effective = promoteSelection(view, raw);
    return this.transaction(
      [],
      { kind: "absolute", anchor: view.offset(effective.anchor), focus: view.offset(effective.focus), positions: raw },
      { group: "own-step" },
      interaction === NO_INTERACTION ? {} : { interaction }
    );
  }

  /**
   * Moving the caret out of placeholder braces that are still empty
   * removes what they were opened for: an empty script, an empty formula
   * (M13, F1). Null when the move keeps the caret there, or nothing goes.
   */
  private leavePlaceholder(view: EditView, to: Position): EditOutcome | null {
    const open = this.context.interaction.placeholder;
    if (open == null) {
      return null;
    }
    const placeholder = placeholderAt(view, open, this.from);
    const target = view.offset(to);
    if (!placeholder || (target > open && target <= open + 1)) {
      return null;
    }
    return abandonPlaceholder(view, placeholder);
  }

  /**
   * Turns an operation's outcome into a transaction. After an edit, the
   * caret snaps to the stop it names in the new buffer (`$ax‸ $` becomes
   * `$ax ‸$`), keeping that position for the next intent.
   */
  private outcome(view: EditView, outcome: EditOutcome, typingRun?: string): IntentResolution {
    switch (outcome.kind) {
      case "patch": {
        const structure = this.context.structure!;
        const nextText = applyPatches(this.context.text, outcome.patches);
        const nextView = structure(nextText);
        // After a structural edit, snap forward over a gap (`$ax‸ $` is
        // `$ax ‸$`), never back. Typed text keeps the caret right after
        // it: a space just typed at a paragraph's end is not a stop yet,
        // and a cell's `&` is not followed by its trailing newline.
        const run = typingRun ?? outcome.run;
        const found = run === "insert" || outcome.exact ? null : nextView.stopAt(outcome.caret);
        const stop = found && nextView.offset(found) >= outcome.caret ? found : null;
        const caret = stop ? nextView.offset(stop) : outcome.caret;
        const focus = outcome.selectionEnd ?? caret;
        return this.transaction(
          outcome.patches,
          { kind: "absolute", anchor: caret, focus, positions: stop && focus === caret ? { anchor: stop, focus: stop } : undefined },
          run ? { group: "typing-run", run } : { group: "own-step" },
          outcome.placeholder != null ? { interaction: { placeholder: outcome.placeholder } } : {}
        );
      }
      case "select":
        return this.selectPositions(view, { anchor: outcome.anchor, focus: outcome.focus });
      case "move": {
        const abandoned = this.leavePlaceholder(view, outcome.to);
        if (abandoned) {
          return this.outcome(view, abandoned);
        }
        const to = outcome.to;
        return this.selectPositions(
          view,
          { anchor: to, focus: to },
          outcome.consumeOpen ? { consumeOpen: view.offset(to) } : NO_INTERACTION
        );
      }
      case "none":
      case "structural":
        return NONE;
    }
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
    extra: Pick<Transaction, "composition" | "verticalGoal" | "interaction"> = {}
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

  /**
   * Typed or inserted text. On the tree, a typed character goes through
   * the input rules (operations/insert.ts): escaping, pairing, scripts,
   * terminators. Typing over a selection removes it as a range deletion
   * would (F6), except that `$` wraps prose in a formula (M2).
   */
  insertText(text: string, keyboard: boolean): IntentResolution {
    const typing: UndoGrouping = keyboard ? { group: "typing-run", run: "insert" } : { group: "own-step" };
    const view = this.view;
    if (!view || !keyboard) {
      return this.replaceSelection(text, typing);
    }
    const raw = this.rawEnds(view);
    if (this.hasRange()) {
      const { start, end } = this.effectiveRange(view, raw);
      if (text === "$" && start.slot === end.slot && view.tree.slots[start.slot].mode === "text") {
        const from = view.offset(start);
        const to = view.offset(end);
        const patches = [{ from, to: from, insert: "$" }, { from: to, to, insert: "$" }];
        return this.outcome(view, { kind: "patch", patches, caret: to + 1, run: null });
      }
      return this.outcome(view, deleteRange(view, start, end, text), "insert");
    }
    // Right after a backslash the user is typing a command name: literal.
    if ([...text].length !== 1 || afterEscape(this.context.text, this.from)) {
      return this.replaceSelection(text, typing);
    }
    // Without recorded positions, text goes exactly at the caret offset
    // (after a space TeX drops, inside a half-typed name), and the tree
    // position there gives the context.
    const caret = this.context.positions ? view.representative(raw.focus) : view.positionAt(this.from);
    const at = this.context.positions ? view.offset(caret) : this.from;
    return this.outcome(view, typeCharacter(view, caret, text, this.context.interaction, at));
  }

  cut(): IntentResolution {
    const view = this.view;
    if (view && this.hasRange()) {
      const { start, end } = this.effectiveRange(view, this.rawEnds(view));
      return this.outcome(view, deleteRange(view, start, end));
    }
    return this.hasRange() ? this.replaceSelection("", { group: "own-step" }) : NONE;
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

  delete(direction: "backward" | "forward", unit: "char" | "item" | "word" | "line", repeat: boolean): IntentResolution {
    const { text } = this.context;
    const view = this.view;
    if (unit === "item" && view) {
      const raw = this.rawEnds(view);
      let outcome: EditOutcome;
      if (this.hasRange()) {
        // R9: auto-repeat never deletes a selection (a construct ⌫ just selected).
        if (repeat) {
          return NONE;
        }
        const { start, end } = this.effectiveRange(view, raw);
        outcome = deleteRange(view, start, end);
      } else {
        const caret = view.representative(raw.focus);
        outcome = direction === "backward" ? deleteBackward(view, caret) : deleteForward(view, caret);
        if (outcome.kind === "structural") {
          // A paragraph or item edge: join the neighbouring block.
          const at = this.context.positions ? view.offset(caret) : this.from;
          outcome = direction === "backward" ? joinBackward(view, caret, at) : joinForward(view, caret, at);
        }
      }
      return this.outcome(view, outcome);
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

  /**
   * ⏎ / ⇧⏎. On the tree, the owner of the key decides (item split, new
   * paragraph, row, leaving a display); over a selection, the selection is
   * deleted first, in the same step.
   */
  enter(soft: boolean): IntentResolution {
    if (this.context.editMode === "inline-typo") {
      return { kind: "close" };
    }
    const view = this.view;
    if (!view) {
      return this.context.surface === "canvas" ? NONE : this.replaceSelection("\n", { group: "own-step" });
    }
    const key = soft ? "line-break" : "enter";
    const raw = this.rawEnds(view);
    if (!this.hasRange()) {
      const caret = this.context.positions ? view.representative(raw.focus) : view.positionAt(this.from);
      const at = this.context.positions ? view.offset(caret) : this.from;
      return this.outcome(view, enter(view, caret, at, key));
    }
    // Delete, then break where the deletion left the caret: one step.
    const { start, end } = this.effectiveRange(view, raw);
    const deleted = deleteRange(view, start, end);
    if (deleted.kind !== "patch") {
      return NONE;
    }
    const middle = applyPatches(this.context.text, deleted.patches);
    const middleView = this.context.structure!(middle);
    const broken = enter(middleView, middleView.positionAt(deleted.caret), deleted.caret, key);
    if (broken.kind !== "patch") {
      return NONE;
    }
    const final = applyPatches(middle, broken.patches);
    return this.transaction(
      replacementPatches(this.context.text, final),
      { kind: "absolute", anchor: broken.caret, focus: broken.caret },
      { group: "own-step" }
    );
  }

  /** ⇥ / ⇧⇥ on the canvas: the next slot or cell, or nesting the selected items. */
  tab(back: boolean): IntentResolution {
    const view = this.view;
    if (!view) {
      return NONE;
    }
    const { start, end } = this.hasRange()
      ? this.effectiveRange(view, this.rawEnds(view))
      : { start: this.caretPosition(view), end: this.caretPosition(view) };
    return this.outcome(view, tab(view, start, back, end));
  }

  /** The caret's position: the recorded one, or the one at its offset. */
  private caretPosition(view: EditView): Position {
    return this.context.positions ? view.representative(this.rawEnds(view).focus) : view.positionAt(this.from);
  }

  move(motion: Extract<Intent, { type: "move" }>): IntentResolution {
    if (this.context.surface !== "canvas") {
      return NONE;
    }
    const view = this.view;
    if (view && motion.unit === "item" && (motion.dir === "left" || motion.dir === "right")) {
      return this.moveOnTree(view, motion.dir === "left" ? -1 : 1, motion.extend);
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

  /**
   * ←/→ by caret stops (R7, R8, N1). Without ⇧, a selection collapses to
   * its start or end; with ⇧, the raw focus moves and the selection drawn
   * is its promotion (N3).
   */
  private moveOnTree(view: EditView, direction: -1 | 1, extend: boolean): IntentResolution {
    const raw = this.rawEnds(view);
    if (!extend && this.hasRange()) {
      const { start, end } = this.effectiveRange(view, raw);
      const target = direction < 0 ? start : end;
      return this.selectPositions(view, { anchor: target, focus: target });
    }
    const next = view.step(raw.focus, direction) ?? view.representative(raw.focus);
    if (extend) {
      return this.selectPositions(view, { anchor: raw.anchor, focus: next });
    }
    return this.outcome(view, { kind: "move", to: next });
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
    // The list buttons work from either surface, on the tree.
    const view = this.context.isScopeSession && this.context.structure ? this.currentView(this.context.structure) : null;
    if (!view) {
      return NONE;
    }
    const start = view.positionAt(this.from);
    const outcome = command === "bullets" || command === "numbered"
      ? toggleList(view, start, command === "bullets" ? "itemize" : "enumerate")
      : indentItems(view, start, view.positionAt(this.to), command === "indent" ? "nest" : "unnest");
    return this.outcome(view, outcome);
  }

  color(color: string | null): IntentResolution {
    if (this.context.composition || !this.formatAllowed("textcolor")) {
      return NONE;
    }
    return this.toggleResult(applyTextColorCommand(this.context.text, this.from, this.to, color));
  }
}
