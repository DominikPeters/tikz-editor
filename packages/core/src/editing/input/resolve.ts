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
  beforeMulticolumn,
  braceUnbracedArgument,
  rulesInsideRows,
  deleteBackward,
  deleteForward,
  commitAcrossModes,
  commitCommand,
  commitControlSymbol,
  commitLeftDelimiter,
  deadBreaks,
  lineEndable,
  deleteRange,
  enter,
  indentItems,
  joinBackward,
  joinForward,
  optionalArgumentAhead,
  placeholderAt,
  tab,
  toggleList,
  typeCharacter,
  type EditOutcome,
} from "../operations/index.js";
import {
  hiddenNodes,
  promoteSelection,
  selectionEndsAt,
  type EditView,
  type Position,
  type SelectionEnds,
} from "../position/index.js";
import type { NodeId } from "../tree/types.js";
import {
  applyPatches,
  applyTransaction,
  replacementPatches,
  type BufferPatch,
  type BufferRange,
  type Transaction,
  type TransactionSelection,
  type UndoGrouping,
  type VerticalGoal,
} from "../transaction/index.js";
import type { InputSurface } from "./adapter.js";
import { chipCommitName } from "./chip.js";
import { NO_INTERACTION, type ChipState, type InteractionState } from "./interaction.js";
import type { CommandTable } from "../commands/table.js";
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
  /** The scope's command table, for the command chip (with `structure`). */
  readonly commands: CommandTable | null;
  /** The buffer is a title (a frame title): one line of text, with no paragraph breaks or lists. */
  readonly title?: boolean;
  /**
   * The buffer is a frame body: `\begin{frame}` before it reads a `[` at
   * its start as the frame's options (and a group as its title).
   */
  readonly frameBody?: boolean;
};

export type IntentResolution =
  | { readonly kind: "transaction"; readonly transaction: Transaction }
  | { readonly kind: "history"; readonly direction: "undo" | "redo" }
  /** End the session (Enter in a single-line inline-typo session). */
  | { readonly kind: "close" }
  | { readonly kind: "none" };

const NONE: IntentResolution = { kind: "none" };

/** What `$` around a selection may not enclose (M2). */
const WRAP_REFUSING_KINDS = new Set(["formula", "display", "alignment", "list", "container", "item", "paragraph", "vertical", "break"]);

/**
 * Commands no commit can write whole: `\verb` takes its delimiter from
 * the next character (and needs a fragile frame), and an environment
 * needs its name and its `\end` (the environment chip, still to come).
 */
const UNCOMMITTABLE = new Set(["verb", "lstinline", "begin", "end"]);

/** Commands that structure flow text, never written into math. */
const BLOCK_COMMANDS = new Set(["item", "begin", "end", "par", "bibitem"]);

/** Table rules, which only start a table's rows. */
const TABLE_RULES = new Set(["hline", "cline", "toprule", "midrule", "bottomrule", "cmidrule", "addlinespace", "specialrule"]);

/** Whether a slot is in an alignment's rows (a cell, at any depth short of a formula). */
function inAlignment(view: EditView, slot: number): boolean {
  const { tree } = view;
  for (let current: number | null = slot; current != null; current = tree.nodes[tree.slots[current].node].parent) {
    if (tree.slots[current].role === "cell" || tree.nodes[tree.slots[current].node].kind === "alignment") {
      return true;
    }
    if (tree.nodes[tree.slots[current].node].kind === "formula") {
      return false;
    }
  }
  return false;
}

/** Whether a slot is a list item's flow, or a paragraph in one. */
function inListFlow(view: EditView, slot: number): boolean {
  const { tree } = view;
  const paragraph = tree.nodes[tree.slots[slot].node];
  const flow = paragraph.kind === "paragraph" && paragraph.parent != null ? paragraph.parent : slot;
  const kind = tree.nodes[tree.slots[flow].node].kind;
  return (kind === "item" && tree.slots[flow].role === "flow") || kind === "list";
}

/** Nodes a style wrapper may not cut through. */
const CELL_AND_BLOCK_KINDS = new Set(["row", "paragraph", "item", "list", "alignment", "display", "container"]);

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
    case "escape":
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
    case "escape":
      return resolver.escape();
    case "undo":
      // With the chip open, ⌘Z just closes it.
      return context.interaction.chip ? resolver.escape() : { kind: "history", direction: "undo" };
    case "redo":
      return context.interaction.chip ? resolver.escape() : { kind: "history", direction: "redo" };
  }
}

/** The position a caret at an offset is at: the outermost there (after `x^2‸`, outside the script). */
function caretAt(view: EditView, offset: number): Position {
  return view.index.resolve(offset, "after") ?? view.positionAt(offset);
}

/**
 * Whether an edit made a command name that was not there (R5: unwrapping
 * `\\textbf{n}` after `\\frac` writes `\\fracn`). Format toggles from the
 * text-level helper are refused when they would.
 */
function gluesControlWords(before: string, after: string): boolean {
  const names = (text: string) => new Set([...text.matchAll(/\\([A-Za-z@]+)/gu)].map((match) => match[1]));
  const known = names(before);
  return [...names(after)].some((name) => !known.has(name) && !Object.values(WRAP_COMMANDS).includes(name as never) && name !== "textcolor");
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
    return this.context.positions ?? selectionEndsAt(view, this.context.anchor, this.context.focus);
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
        // After a structural edit, snap forward over a gap (`$ax‸ $` is
        // `$ax ‸$`), never back. Typed text keeps the caret right after
        // it: a space just typed at a paragraph's end is not a stop yet,
        // and a cell's `&` is not followed by its trailing newline.
        const run = typingRun ?? outcome.run;
        const nextView = run === "insert" || outcome.exact ? null : structure(applyPatches(this.context.text, outcome.patches));
        const found = nextView?.stopAt(outcome.caret) ?? null;
        const stop = found && nextView!.offset(found) >= outcome.caret ? found : null;
        const caret = stop ? nextView!.offset(stop) : outcome.caret;
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
    const repaired = this.keepFinalLineEnd(this.protectLeadingBracket(this.dropDeadBreaks(
      this.endRowsBeforeRules({ baseRevision: this.context.revision, patches, selection, undo, ...extra })
    )));
    return { kind: "transaction", transaction: repaired };
  }

  /**
   * A table rule that an edit left inside a row (`\\alpha\\bottomrule`)
   * gets the row break TeX needs before it: rules only start rows. Edits
   * outside tables pass unchanged.
   */
  private endRowsBeforeRules(transaction: Transaction): Transaction {
    const { structure, text } = this.context;
    if (!structure || !this.context.isScopeSession || transaction.patches.length === 0 || !/\\(?:hline|cline|\w*rule|addlinespace)/u.test(text)) {
      return transaction;
    }
    const applied = applyTransaction(text, transaction);
    const rules = rulesInsideRows(structure(applied.text).tree);
    if (rules.length === 0) {
      return transaction;
    }
    let next = applied.text;
    for (const at of [...rules].sort((left, right) => right - left)) {
      next = `${next.slice(0, at)}\\\\ ${next.slice(at)}`;
    }
    const shift = (offset: number) => offset + 3 * rules.filter((at) => at < offset).length;
    return {
      ...transaction,
      patches: replacementPatches(text, next),
      selection: { kind: "absolute", anchor: shift(applied.anchor), focus: shift(applied.focus) },
    };
  }

  /**
   * A frame body that ended with a line end keeps it: a `[fragile]` frame
   * finds its `\\end{frame}` only at the start of a line.
   */
  private keepFinalLineEnd(transaction: Transaction): Transaction {
    const { text } = this.context;
    if (!this.context.frameBody || transaction.patches.length === 0 || !text.endsWith("\n")) {
      return transaction;
    }
    const applied = applyTransaction(text, transaction);
    if (applied.text.endsWith("\n")) {
      return transaction;
    }
    return { ...transaction, patches: replacementPatches(text, `${applied.text}\n`) };
  }

  /**
   * K9 at a frame body's start: a `[` or `<` an edit put first in the body
   * (typed, or left there by a deletion) would be the frame's options or
   * overlay specification, so `\relax` goes before it, which ends the
   * header without adding a title as `{}` would.
   */
  private protectLeadingBracket(transaction: Transaction): Transaction {
    const { text } = this.context;
    if (!this.context.frameBody || transaction.patches.length === 0) {
      return transaction;
    }
    const applied = applyTransaction(text, transaction);
    const at = applied.text.length - applied.text.trimStart().length;
    const reads = (char: string | undefined) => char === "[" || char === "<";
    if (!reads(applied.text[at]) || reads(text.trimStart()[0])) {
      return transaction;
    }
    const next = `${applied.text.slice(0, at)}\\relax${applied.text.slice(at)}`;
    const shift = (offset: number) => (offset >= at ? offset + "\\relax".length : offset);
    return {
      ...transaction,
      patches: replacementPatches(text, next),
      selection: { kind: "absolute", anchor: shift(applied.anchor), focus: shift(applied.focus) },
    };
  }

  /**
   * A line break an edit left with nothing before it on its line (`x \\`
   * with the `x` deleted, or a paragraph split right before it) goes too:
   * TeX has no empty line to end. Breaks that were dead before are the
   * source's own, and stay.
   */
  private dropDeadBreaks(transaction: Transaction): Transaction {
    const { structure, text } = this.context;
    if (!structure || !this.context.isScopeSession || transaction.patches.length === 0 || !text.includes("\\\\")) {
      return transaction;
    }
    const applied = applyTransaction(text, transaction);
    const dead = deadBreaks(structure(applied.text));
    if (dead.length === 0) {
      return transaction;
    }
    // The edit's window, from `start` to `end` in the new text; after it, offsets shift by the length change.
    let start = 0;
    while (start < text.length && start < applied.text.length && text[start] === applied.text[start]) {
      start += 1;
    }
    let suffix = 0;
    while (suffix < Math.min(text.length, applied.text.length) - start && text.at(-1 - suffix) === applied.text.at(-1 - suffix)) {
      suffix += 1;
    }
    const end = applied.text.length - suffix;
    const deadBefore = new Set(deadBreaks(structure(text)).map((span) => span.from));
    const old = (offset: number) => (offset < start ? offset : offset >= end ? offset - (applied.text.length - text.length) : null);
    // The breaks this edit left dead: written by it, or alive before it.
    const drop = dead.filter((span) => {
      const was = old(span.from);
      return was == null || !deadBefore.has(was);
    });
    if (drop.length === 0) {
      return transaction;
    }
    let next = applied.text;
    for (const span of [...drop].sort((left, right) => right.from - left.from)) {
      next = next.slice(0, span.from) + next.slice(span.to);
    }
    const shift = (offset: number) => drop.reduce((moved, span) => moved - Math.max(0, Math.min(offset, span.to) - span.from), offset);
    return {
      ...transaction,
      patches: replacementPatches(text, next),
      selection: { kind: "absolute", anchor: shift(applied.anchor), focus: shift(applied.focus) },
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
    const chip = this.context.interaction.chip;
    if (chip && this.context.commands) {
      return this.chipCharacter(view, this.context.commands, chip, text);
    }
    const raw = this.rawEnds(view);
    if (text === "\\" && this.context.commands && !afterEscape(this.context.text, this.from)) {
      // R4: `\` opens the command chip; the source is untouched until it commits.
      if (this.hasRange() ? this.crossesStructure() : beforeMulticolumn(view, this.caretPosition(view))) {
        // As for ⌘B: a command cannot wrap a selection across cells, blocks or a title and its body;
        // nor can one go before a `\multicolumn`, which must open its cell.
        return this.keepSelection(NO_INTERACTION);
      }
      const held = this.hasRange() ? this.offsetsOf(view, this.effectiveRange(view, raw)) : null;
      const at = held ? held.from : this.hasRange() ? this.from : this.caretOffset(view);
      // Placeholder braces stay recorded: a command typed into them replaces them.
      return this.keepSelection({ ...this.context.interaction, chip: { name: "", at, selected: 0, held } });
    }
    if (this.hasRange()) {
      const { start, end } = this.effectiveRange(view, raw);
      const from = view.offset(start);
      const to = view.offset(end);
      // Only plain inline text becomes a formula: not math, and not a table or list it contains.
      // (A block may hold the selection, with room around it; one the selection reaches or is, it may not.)
      const holds = (span: { from: number; to: number }) => span.from <= from && span.to >= to && (span.from < from || span.to > to);
      const hasMath = view.tree.nodes.some((node) => node.span.from < to && node.span.to > from && (
        (WRAP_REFUSING_KINDS.has(node.kind) && (node.kind === "formula" || node.kind === "display" || !holds(node.span))) ||
        // An environment kept whole (an atom) is a block too.
        (node.kind === "atom" && view.tree.text.startsWith("\\begin", node.span.from))));
      // (A `\\left` just before the closing `$` would take it as its delimiter.)
      const delimiterBefore = /\\(?:left|right|middle)\s*$/u.test(view.tree.text.slice(Math.max(0, to - 12), to));
      if (text === "$" && from < to && start.slot === end.slot && view.tree.slots[start.slot].mode === "text" && !hasMath && !delimiterBefore && !this.crossesStructure()) {
        const patches = [{ from, to: from, insert: "$" }, { from: to, to, insert: "$" }];
        return this.outcome(view, { kind: "patch", patches, caret: to + 1, run: null });
      }
      if ([...text].length === 1) {
        return this.replaceThenType(view, start, end, text);
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
    const caret = this.caretPosition(view);
    const at = this.context.positions ? view.offset(caret) : this.from;
    return this.outcome(view, typeCharacter(view, caret, text, this.context.interaction, at, this.context.title));
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
    // O4/K9: a committed `[` is content, never an optional argument of the command before it.
    const insert = commit && text.startsWith("[") && this.view && optionalArgumentAhead(this.view, range.from) ? `{}${text}` : text;
    const caret = range.from + insert.length;
    return this.transaction(
      [{ from: range.from, to: range.to, insert }],
      { kind: "absolute", anchor: caret, focus: caret },
      { group: "composition", first: this.context.composition == null },
      { composition: commit ? null : { from: range.from, to: caret } }
    );
  }

  delete(direction: "backward" | "forward", unit: "char" | "item" | "word" | "line", repeat: boolean): IntentResolution {
    const { text } = this.context;
    const view = this.view;
    const chip = this.context.interaction.chip;
    if (chip && view) {
      // ⌫ shortens the name; on an empty chip, or with ⌦, the chip closes.
      return direction === "backward" && chip.name !== ""
        ? this.keepSelection({ ...this.context.interaction, chip: { ...chip, name: chip.name.slice(0, -1), selected: 0 } })
        : this.keepSelection(NO_INTERACTION);
    }
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
          outcome = direction === "backward" ? joinBackward(view, caret) : joinForward(view, caret);
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
    const chip = this.context.interaction.chip;
    if (chip && this.context.commands) {
      // ⏎ accepts the highlighted completion, like ⇥ (V2); ␣ commits what was typed.
      return this.commitChip(view, this.context.commands, chip, "structure", true);
    }
    if (this.context.title) {
      return NONE;
    }
    const key = soft ? "line-break" : "enter";
    const raw = this.rawEnds(view);
    if (!this.hasRange()) {
      const caret = this.caretPosition(view);
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
    const broken = enter(middleView, caretAt(middleView, deleted.caret), deleted.caret, key);
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
    const chip = this.context.interaction.chip;
    if (chip && this.context.commands) {
      // ⇥ accepts the highlighted completion (V2).
      return this.commitChip(view, this.context.commands, chip, "structure", true);
    }
    const { start, end } = this.hasRange()
      ? this.effectiveRange(view, this.rawEnds(view))
      : { start: this.caretPosition(view), end: this.caretPosition(view) };
    return this.outcome(view, tab(view, start, back, end));
  }

  /**
   * A character typed over a selection (F6): the selection goes as a range
   * deletion would, then the character is typed where that left the caret,
   * through the same input rules (`%` over a selection is `\%`), in one step.
   */
  private replaceThenType(view: EditView, start: Position, end: Position, char: string): IntentResolution {
    const deleted = deleteRange(view, start, end);
    if (deleted.kind !== "patch") {
      return NONE;
    }
    const middle = applyPatches(this.context.text, deleted.patches);
    const middleView = this.context.structure!(middle);
    const interaction = deleted.placeholder != null ? { placeholder: deleted.placeholder } : NO_INTERACTION;
    const typed = typeCharacter(middleView, caretAt(middleView, deleted.caret), char, interaction, deleted.caret, this.context.title);
    const final = typed.kind === "patch" ? applyPatches(middle, typed.patches) : middle;
    const caret = typed.kind === "patch" ? typed.caret : deleted.caret;
    return this.transaction(
      replacementPatches(this.context.text, final),
      { kind: "absolute", anchor: caret, focus: caret },
      { group: "typing-run", run: "insert" },
      typed.kind === "patch" && typed.placeholder != null ? { interaction: { placeholder: typed.placeholder } } : {}
    );
  }

  /** Esc: closes the command chip without writing anything. */
  escape(): IntentResolution {
    return this.context.interaction.chip ? this.keepSelection(NO_INTERACTION) : NONE;
  }

  /** A transaction changing only the interaction state: buffer, selection and positions stay. */
  private keepSelection(interaction: InteractionState): IntentResolution {
    const { anchor, focus, positions } = this.context;
    return this.transaction(
      [],
      { kind: "absolute", anchor, focus, positions: positions ?? undefined },
      { group: "own-step" },
      interaction === NO_INTERACTION ? {} : { interaction }
    );
  }

  private offsetsOf(view: EditView, range: { start: Position; end: Position }): { from: number; to: number } | null {
    // Only a selection within one slot can be wrapped as a whole.
    return range.start.slot === range.end.slot ? { from: view.offset(range.start), to: view.offset(range.end) } : null;
  }

  /** The caret offset: at its recorded position, or exactly where it is. */
  private caretOffset(view: EditView): number {
    return this.context.positions ? view.offset(view.representative(this.rawEnds(view).focus)) : this.from;
  }

  /**
   * A character typed while the chip is open (R4): letters extend the name;
   * a first non-letter commits a control symbol (`\%`, `\\`, `\{` with
   * its `\}`); ␣, `{` and `[` commit the command with its arguments;
   * `\left` takes a delimiter and its closer; anything else commits the
   * name as typed and is then typed itself.
   */
  private chipCharacter(view: EditView, commands: CommandTable, chip: ChipState, char: string): IntentResolution {
    if (/^[A-Za-z]$/u.test(char)) {
      return this.keepSelection({ ...this.context.interaction, chip: { ...chip, name: chip.name + char, selected: 0 } });
    }
    const caret = caretAt(view, chip.at);
    if (chip.name === "") {
      const symbol = commitControlSymbol(view, caret, chip.at, char, chip.held);
      if (!symbol) {
        return this.keepSelection(NO_INTERACTION);
      }
      return this.commitOutcome(view, symbol.outcome, symbol.pending);
    }
    if (chip.name === "left" && view.tree.slots[caret.slot].mode === "math") {
      const pair = commitLeftDelimiter(chip.at, chip.held, char);
      if (pair) {
        return this.commitOutcome(view, pair);
      }
    }
    if (chip.name === "right" && view.tree.slots[caret.slot].mode === "math") {
      return this.closeRight(view, chip, char);
    }
    if (chip.name === "left" && view.tree.slots[caret.slot].mode === "text" && commitLeftDelimiter(chip.at, null, char)) {
      // In prose, the pair starts a formula.
      const pair = commitAcrossModes(view, commands, caret, chip.at, "left", "typed", chip.held, char);
      if (pair && pair !== "refused") {
        return this.commitOutcome(view, pair.outcome);
      }
    }
    if (char === " ") {
      return this.commitChip(view, commands, chip, "space", false);
    }
    if (char === "\\") {
      // The next command starts: commit this one, open a new chip after it. A command
      // that takes arguments gets its braces, with the new chip in the first, so the
      // source stays whole if that chip is never committed (`\\sqrt{\\te‸}`).
      const name = chipCommitName(commands, view.tree.slots[caret.slot].mode, chip.name, chip.selected, view.tree.text, false);
      const schema = commands.command(name, view.tree.slots[caret.slot].mode === "math" ? "math" : "text");
      const takesArguments = schema?.args.some((arg) => arg.kind === "mandatory") ?? false;
      const committed = this.commitChip(view, commands, chip, takesArguments ? "structure" : "typed", false);
      if (committed.kind !== "transaction" || committed.transaction.selection.kind !== "absolute") {
        return committed;
      }
      const at = committed.transaction.selection.focus;
      return { kind: "transaction", transaction: { ...committed.transaction, interaction: { chip: { name: "", at, selected: 0, held: null } } } };
    }
    if (char === "<") {
      const name = chipCommitName(commands, view.tree.slots[caret.slot].mode, chip.name, chip.selected, view.tree.text, false);
      if (commands.command(name, view.tree.slots[caret.slot].mode === "math" ? "math" : "text")?.args.some((arg) => arg.kind === "overlay")) {
        return this.commitChip(view, commands, chip, "overlay", false);
      }
    }
    if (char === "{" || char === "[") {
      const name = chipCommitName(commands, view.tree.slots[caret.slot].mode, chip.name, chip.selected, view.tree.text, false);
      const schema = commands.command(name, view.tree.slots[caret.slot].mode === "math" ? "math" : "text");
      const opens = char === "{"
        ? schema?.args.some((arg) => arg.kind === "mandatory")
        : schema?.args.find((arg) => arg.kind !== "overlay")?.kind === "optional";
      if (opens) {
        return this.commitChip(view, commands, chip, char === "{" ? "brace" : "bracket", false);
      }
    }
    if (char === "}" || char === "$") {
      // A closer right after a command that takes arguments would leave it without them (`{\underbrace}`):
      // it gets its braces, and the closer acts from inside them.
      const name = chipCommitName(commands, view.tree.slots[caret.slot].mode, chip.name, chip.selected, view.tree.text, false);
      if (commands.command(name, view.tree.slots[caret.slot].mode === "math" ? "math" : "text")?.args.some((arg) => arg.kind === "mandatory")) {
        return this.commitChip(view, commands, chip, "structure", false, char);
      }
    }
    return this.commitChip(view, commands, chip, "typed", false, char);
  }

  /** `\right` and its delimiter typed at the closer `\left` brought: step over it (R3). */
  private closeRight(view: EditView, chip: ChipState, char: string): IntentResolution {
    const text = view.tree.text;
    let at = chip.at;
    while (/\s/u.test(text[at] ?? "")) {
      at += 1;
    }
    if (!chip.held && text.startsWith(`\\right${char}`, at)) {
      const caret = at + "\\right".length + char.length;
      return this.transaction([], { kind: "absolute", anchor: caret, focus: caret }, { group: "own-step" });
    }
    return this.keepSelection(NO_INTERACTION);
  }

  /** Commits the chip; `then` is a character typed right after, in the same step. */
  private commitChip(
    view: EditView,
    commands: CommandTable,
    chip: ChipState,
    key: "space" | "structure" | "brace" | "bracket" | "overlay" | "typed",
    accept: boolean,
    then?: string
  ): IntentResolution {
    if (chip.name === "") {
      // Nothing typed yet: the chip just closes.
      return this.keepSelection(NO_INTERACTION);
    }
    const caret = caretAt(view, chip.at);
    const mode = view.tree.slots[caret.slot].mode;
    const name = chipCommitName(commands, mode, chip.name, chip.selected, view.tree.text, accept);
    if (mode === "math" && BLOCK_COMMANDS.has(name)) {
      // List and environment commands make no sense in a formula.
      return this.keepSelection(NO_INTERACTION);
    }
    if (UNCOMMITTABLE.has(name)) {
      return this.keepSelection(NO_INTERACTION);
    }
    if (name === "newline" && !lineEndable(view, caret, chip.at)) {
      // A line break with no line to end (at an item's start, after a blank line).
      return this.keepSelection(NO_INTERACTION);
    }
    if (TABLE_RULES.has(name) && !inAlignment(view, caret.slot)) {
      // Outside a table, TeX has no row for a rule ("Misplaced \noalign").
      return this.keepSelection(NO_INTERACTION);
    }
    if ((name === "item" || name === "bibitem") && !inListFlow(view, caret.slot)) {
      // Outside a list, TeX has a "lonely \item".
      return this.keepSelection(NO_INTERACTION);
    }
    if (mode === "math" && (name === "left" || name === "right" || name === "middle")) {
      // `\left` and `\right` only exist in pairs (K16, O5): `\left` brings
      // its `\right`; a lone `\right` or `\middle` writes nothing.
      return name === "left"
        ? this.commitOutcome(view, commitLeftDelimiter(chip.at, chip.held, "(")!)
        : this.keepSelection(NO_INTERACTION);
    }
    const across = commitAcrossModes(view, commands, caret, chip.at, name, key, chip.held);
    if (across === "refused") {
      return this.keepSelection(NO_INTERACTION);
    }
    const committed = across ?? commitCommand(view, commands, caret, chip.at, name, key, this.context.interaction, chip.held);
    const commit = { ...committed, outcome: braceUnbracedArgument(view, caretAt(view, chip.at), committed.outcome) };
    if (then == null || commit.outcome.kind !== "patch") {
      return this.commitOutcome(view, commit.outcome, commit.pending);
    }
    // The character after the name, typed into the committed source.
    const middle = applyPatches(this.context.text, commit.outcome.patches);
    const middleView = this.context.structure!(middle);
    const at = commit.outcome.caret;
    const typed = typeCharacter(middleView, caretAt(middleView, at), then, { pending: commit.pending }, at, this.context.title);
    if (typed.kind === "move") {
      // `}` after `\pi` in `e^{i\pi`: the commit, then the caret steps out.
      const caret = middleView.offset(typed.to);
      return this.transaction(
        commit.outcome.patches,
        { kind: "absolute", anchor: caret, focus: caret },
        { group: "own-step" },
        typed.consumeOpen ? { interaction: { consumeOpen: caret } } : {}
      );
    }
    if (typed.kind !== "patch") {
      return this.commitOutcome(view, commit.outcome, commit.pending);
    }
    const final = applyPatches(middle, typed.patches);
    return this.transaction(
      replacementPatches(this.context.text, final),
      { kind: "absolute", anchor: typed.caret, focus: typed.caret },
      { group: "own-step" },
      typed.placeholder != null ? { interaction: { placeholder: typed.placeholder } } : {}
    );
  }

  /** A commit is one undo step (R12), whatever the chip took to type. */
  private commitOutcome(view: EditView, written: EditOutcome, pending?: number): IntentResolution {
    const chip = this.context.interaction.chip;
    const outcome = chip ? braceUnbracedArgument(view, caretAt(view, chip.at), written) : written;
    if (outcome.kind !== "patch") {
      return this.outcome(view, outcome);
    }
    const focus = outcome.selectionEnd ?? outcome.caret;
    return this.transaction(
      outcome.patches,
      { kind: "absolute", anchor: outcome.caret, focus },
      { group: "own-step" },
      pending != null ? { interaction: { pending } } : {}
    );
  }

  /**
   * The caret's position: the recorded one, or the one at its offset (the
   * outermost there: after `x^2‸` the caret is outside the script), so
   * that the position and the offset an edit uses always agree.
   */
  private caretPosition(view: EditView): Position {
    return this.context.positions ? view.representative(this.rawEnds(view).focus) : caretAt(view, this.from);
  }

  move(motion: Extract<Intent, { type: "move" }>): IntentResolution {
    if (this.context.surface !== "canvas") {
      return NONE;
    }
    const view = this.view;
    const chip = this.context.interaction.chip;
    if (view && chip && this.context.commands) {
      if (motion.dir === "up" || motion.dir === "down") {
        const selected = Math.max(0, chip.selected + (motion.dir === "up" ? -1 : 1));
        return this.keepSelection({ ...this.context.interaction, chip: { ...chip, selected } });
      }
      // Leaving the chip commits it, with its arguments: a bare `\\textbf` would take what follows.
      return this.commitChip(view, this.context.commands, chip, "structure", false);
    }
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
    if (!result || gluesControlWords(this.context.text, result.nextText) || this.changesConstructs(result.nextText)) {
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
      if (!this.formatAllowed(wrap) || this.crossesStructure() || this.inUnbracedArgument() || this.inMath() ||
        this.wrapperInsideConstruct(wrap)) {
        return NONE;
      }
      return this.toggleResult(toggleTextFormatCommand(this.context.text, this.from, this.to, wrap));
    }
    // The list buttons work from either surface, on the tree (not in a title).
    const view = this.context.isScopeSession && this.context.structure ? this.currentView(this.context.structure) : null;
    if (!view || this.context.title) {
      return NONE;
    }
    const start = view.positionAt(this.from);
    const outcome = command === "bullets" || command === "numbered"
      ? toggleList(view, start, command === "bullets" ? "itemize" : "enumerate")
      : indentItems(view, start, view.positionAt(this.to), command === "indent" ? "nest" : "unnest");
    return this.outcome(view, outcome);
  }

  /**
   * Whether the selection cuts through block structure or an alignment
   * row: wrapping it in `\textbf{…}` would swallow a cell's `&`, a row's
   * `\\` or a paragraph break, which TeX rejects inside the argument.
   */
  private crossesStructure(): boolean {
    const view = this.context.structure && this.context.isScopeSession ? this.currentView(this.context.structure) : null;
    if (!view || !this.hasRange()) {
      return false;
    }
    const { from, to } = this;
    // The two ends must meet in one slot, or through style wrappers only
    // (`a⟦b\\textbf{c⟧d}`): not across a title and a body, cells or blocks.
    const { tree } = view;
    const ends = selectionEndsAt(view, from, to);
    const chain = (slot: number) => {
      const slots = [slot];
      for (let node = tree.slots[slot].node; tree.nodes[node].parent != null; node = tree.slots[tree.nodes[node].parent!].node) {
        slots.push(tree.nodes[node].parent!);
      }
      return slots;
    };
    const startChain = chain(ends.anchor.slot);
    const endChain = chain(ends.focus.slot);
    const meet = startChain.find((slot) => endChain.includes(slot));
    const throughWrappers = (slots: number[]) => slots.slice(0, slots.indexOf(meet!)).every((slot) => view.role(tree.slots[slot].node) === "transparent");
    if (meet == null || !throughWrappers(startChain) || !throughWrappers(endChain)) {
      return true;
    }
    // Within one block or cell, the wrapper is fine; any such node the range reaches without containing it is not.
    return view.tree.nodes.some((node) =>
      CELL_AND_BLOCK_KINDS.has(node.kind) &&
      node.span.from < to && node.span.to > from &&
      // A row's `&` and `\\` inside the range: cells are slots, not nodes.
      (!(node.span.from <= from && node.span.to >= to) ||
        (node.kind === "row" && node.delimiters.some((span) => span.from >= from && span.to <= to))));
  }

  /**
   * Whether a text-level format toggle changed the source of a construct
   * inside the selection (`\\footnote{\\textit{}}` losing its empty
   * `\\textit{}`): it may add or remove wrappers around them, never inside.
   */
  private changesConstructs(next: string): boolean {
    const view = this.context.structure && this.context.isScopeSession ? this.currentView(this.context.structure) : null;
    if (!view) {
      return false;
    }
    const { tree } = view;
    return tree.nodes.some((node) =>
      node.span.from >= this.from && node.span.to <= this.to && view.role(node.id) === "construct" &&
      node.kind !== "formula" && !next.includes(tree.text.slice(node.span.from, node.span.to)));
  }

  /**
   * Whether the selection holds the same wrapper inside another construct's
   * argument (`\\frac{\\textbf{n}}{}`): the text-level toggle would unwrap it
   * and break the construct's braces.
   */
  private wrapperInsideConstruct(name: string): boolean {
    const view = this.context.structure && this.context.isScopeSession ? this.currentView(this.context.structure) : null;
    if (!view || !this.hasRange()) {
      return false;
    }
    const { tree } = view;
    const { text } = tree;
    // Every `\name{` in the selection must be a wrapper in the selected text
    // itself, not inside another construct (or an atom's source).
    for (let at = text.indexOf(`\\${name}`, this.from); at >= 0 && at < this.to; at = text.indexOf(`\\${name}`, at + 1)) {
      const node = tree.nodes.find((candidate) => candidate.command === name && candidate.span.from === at);
      if (!node) {
        return true;
      }
      for (let parent = node.parent; parent != null; parent = tree.nodes[tree.slots[parent].node].parent) {
        const owner = tree.nodes[tree.slots[parent].node];
        if (owner.span.from <= this.from && owner.span.to >= this.to) {
          break;
        }
        if (view.role(owner.id) === "construct") {
          return true;
        }
      }
    }
    return false;
  }

  /** M17: ⌘B and ⌘I do nothing in math (`\\mathbf` is an alphabet, not bold). */
  private inMath(): boolean {
    const view = this.context.structure && this.context.isScopeSession ? this.currentView(this.context.structure) : null;
    return view?.tree.slots[view.positionAt(this.from).slot].mode === "math";
  }

  /** Whether the selection is the content of an unbraced argument (`\\textbf x`, `x^2`), which a wrapper cannot go into without braces. */
  private inUnbracedArgument(): boolean {
    const view = this.context.structure && this.context.isScopeSession ? this.currentView(this.context.structure) : null;
    if (!view) {
      return false;
    }
    return [this.from, this.to].some((offset) => {
      const slot = view.tree.slots[view.positionAt(offset).slot];
      const owner = view.tree.nodes[slot.node];
      return !slot.braced && slot.role !== "flow" && owner.kind !== "formula" && owner.kind !== "paragraph" &&
        owner.kind !== "group" && owner.kind !== "row" && owner.kind !== "display" && owner.kind !== "scope";
    });
  }

  color(color: string | null): IntentResolution {
    if (this.context.composition || !this.formatAllowed("textcolor") || this.crossesStructure()) {
      return NONE;
    }
    return this.toggleResult(applyTextColorCommand(this.context.text, this.from, this.to, color));
  }
}
