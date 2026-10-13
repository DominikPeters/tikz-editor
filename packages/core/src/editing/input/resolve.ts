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
  breaksBoldMath,
  inBoldMath,
  beforeMulticolumn,
  braceUnbracedArgument,
  rulesInsideRows,
  deleteBackward,
  deleteForward,
  commitAcrossModes,
  commitCommand,
  commitControlSymbol,
  apart,
  insideOptional,
  commitLeftDelimiter,
  isDelimiter,
  matchingRightDelimiter,
  isControlSymbol,
  copyRange,
  commitWithValues,
  editValues,
  lensEdit,
  lensSpan,
  needsValues,
  valueEditorFields,
  deadBreaks,
  inAlignment,
  inListFlow,
  pasteAt,
  type ClipboardPayload,
  lineEndable,
  deleteRange,
  isDollarFormula,
  enter,
  indentItems,
  joinBackward,
  joinForward,
  optionalArgumentAhead,
  placeholderAt,
  tab,
  toggleList,
  typeCharacter,
  constructMenuEdit,
  listAutoformat,
  smartQuote,
  type EditOutcome,
} from "../operations/index.js";
import { childIndex } from "../tree/navigate.js";
import {
  ghostSlots,
  insertionOffset,
  renderedVisibility,
  promoteSelection,
  selectionEndsAt,
  type EditView,
  type EditViewOptions,
  type Position,
  type SelectionEnds,
} from "../position/index.js";
import type { EditNode, NodeId, SlotId, Span } from "../tree/types.js";
import {
  applyPatches,
  applyTransaction,
  replacementPatches,
  type BufferPatch,
  type BufferRange,
  type MappedPosition,
  type Transaction,
  type TransactionSelection,
  type UndoGrouping,
  type VerticalGoal,
} from "../transaction/index.js";
import type { InputSurface } from "./adapter.js";
import { chipCommitName } from "./chip.js";
import { NO_INTERACTION, type ChipState, type InteractionState } from "./interaction.js";
import type { CommitKey } from "../operations/index.js";
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
  readonly structure: ((text: string, visibility?: EditViewOptions) => EditView) | null;
  /** The raw selection ends as positions in the current buffer, when the caller still has them. */
  readonly positions: SelectionEnds | null;
  /** The interaction state the last transaction left, while buffer and selection are unchanged. */
  readonly interaction: InteractionState;
  /** The scope's command table, for the command chip (with `structure`). */
  readonly commands: CommandTable | null;
  /** The buffer is a title (a frame title): one line of text, with no paragraph breaks or lists. */
  readonly title?: boolean;
  /** Reveal codes (R14): invisible syntax is an item the caret steps over and ⌫ selects first. */
  readonly revealCodes?: boolean;
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
 * `\def` takes the macro it defines unbraced.
 */
const UNCOMMITTABLE = new Set(["verb", "lstinline", "begin", "end", "def"]);

/** Commands that structure flow text, never written into math. */
const BLOCK_COMMANDS = new Set(["item", "begin", "end", "par", "bibitem"]);

/** Overlay commands that fail inside `\operatorname` ("Limit controls must follow a math operator"); `\only` and `\alt` do not. */
const UNCOVERING = new Set(["uncover", "visible", "invisible"]);

/** Whether a slot is inside an argument of a command of that name. */
function insideCommand(view: EditView, slot: SlotId, command: string): boolean {
  const { tree } = view;
  for (let current: SlotId | null = slot; current != null; current = tree.nodes[tree.slots[current].node].parent) {
    if (tree.nodes[tree.slots[current].node].command === command) {
      return true;
    }
  }
  return false;
}

/** Table rules, which only start a table's rows. */
const TABLE_RULES = new Set(["hline", "cline", "toprule", "midrule", "bottomrule", "cmidrule", "addlinespace", "specialrule"]);

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
    case "paste":
    case "color":
    case "pickValues":
    case "pickCompletion":
    case "createSlot":
    case "constructMenu":
    case "setValues":
    case "openLens":
    case "setLensText":
    case "insertClosers":
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
    case "paste":
      if (context.editMode === "inline-typo" && /[\r\n]/u.test(intent.payload.plain)) {
        return NONE;
      }
      return resolver.paste(intent.payload);
    case "compose":
      return resolver.compose(intent.text, intent.commit);
    case "deleteBackward":
    case "deleteForward":
      return resolver.delete(intent.type === "deleteBackward" ? "backward" : "forward", intent.unit, intent.repeat);
    case "cut":
      return resolver.cut();
    case "enter":
      return resolver.enter(intent.soft);
    case "pickCompletion":
      return resolver.pickCompletion(intent.index);
    case "createSlot":
      return resolver.createSlot(intent.kind, intent.at);
    case "constructMenu":
      return resolver.constructMenu(intent.span, intent.id);
    case "tab":
      return resolver.tab(intent.back);
    case "move":
      return resolver.move(intent);
    case "format":
      return resolver.format(intent.command);
    case "color":
      return resolver.color(intent.color);
    case "pickValues":
      return resolver.pickValues(intent.values, intent.viaBrace);
    case "setValues":
      return resolver.setValues(intent.edits);
    case "openLens":
      return resolver.openLens();
    case "setLensText":
      return resolver.setLensText(intent.text, intent.caret);
    case "insertClosers":
      return resolver.insertClosers(intent.closers);
    case "escape":
      return resolver.escape();
    case "undo":
      // With the chip or the value editor open, ⌘Z just closes it.
      return context.interaction.chip || context.interaction.picker ? resolver.escape() : { kind: "history", direction: "undo" };
    case "redo":
      return context.interaction.chip || context.interaction.picker ? resolver.escape() : { kind: "history", direction: "redo" };
  }
}

/**
 * Next to an offset in a slot, a plain `(` (or `[`) with its match later in
 * the same slot: the offset after the match. Backward, from a `)` before
 * the offset: the offset of its `(`. Null when there is none.
 */
function matchingPlainBracket(view: EditView, slot: SlotId, at: number, forward: boolean): number | null {
  const { tree } = view;
  const children = tree.slots[slot].children.map((id) => tree.nodes[id]);
  const glyph = (node: EditNode) => tree.text.slice(node.span.from, node.span.to);
  const start = forward
    ? children.findIndex((node) => node.span.from >= at)
    : children.length - 1 - [...children].reverse().findIndex((node) => node.span.to <= at);
  const first = children[start];
  const pairs: Readonly<Record<string, string>> = forward ? { "(": ")", "[": "]" } : { ")": "(", "]": "[" };
  const close = first ? pairs[glyph(first)] : undefined;
  if (!first || close == null) {
    return null;
  }
  let depth = 0;
  for (let index = start; index >= 0 && index < children.length; index += forward ? 1 : -1) {
    const text = glyph(children[index]);
    depth += text === glyph(first) ? 1 : text === close ? -1 : 0;
    if (depth === 0) {
      return forward ? children[index].span.to : children[index].span.from;
    }
  }
  return null;
}

/**
 * The next (or previous) end of a run of letters and digits, past what is
 * not one, as ⌥→ moves in a native field: in `+bc+d`, after `bc`.
 */
function alphanumericWordEdge(text: string, offset: number, forward: boolean): number {
  const word = (char: string | undefined) => char != null && /[\p{L}\p{N}]/u.test(char);
  let index = offset;
  const step = forward ? 1 : -1;
  const at = () => text[forward ? index : index - 1];
  const inside = () => (forward ? index < text.length : index > 0);
  while (inside() && !word(at())) {
    index += step;
  }
  while (inside() && word(at())) {
    index += step;
  }
  return index;
}

/** The `\right` token (with its delimiter) of the pair whose `\right` starts at an offset: a pending one (M14). */
export function pendingCloserSpan(view: EditView, at: number): { readonly from: number; readonly to: number } | null {
  return view.tree.nodes.find((node) => node.kind === "delimited" && node.delimiters.length === 2 && node.delimiters[1].from === at)?.delimiters[1] ?? null;
}

/**
 * Where a transaction leaves the caret, if that is right before a pair's
 * `\right` with nothing selected (not one in a comment, or in source the
 * tree does not read).
 */
function pendingCloserAfter(context: IntentContext, transaction: Transaction): number | null {
  const applied = applyTransaction(context.text, transaction);
  if (applied.anchor !== applied.focus || !applied.text.startsWith("\\right", applied.focus) || !context.structure) {
    return null;
  }
  return pendingCloserSpan(context.structure(applied.text), applied.focus) ? applied.focus : null;
}

/**
 * Whether a character typed at a pending `\right` (M14) is its delimiter
 * closing the pair, not one of its contents: `)` at `\right)`, unless a
 * plain `(` typed inside is still open (`\left(f(x‸\right)`); `|` at
 * `\right|` unless one inside is unmatched.
 */
function closesPending(text: string, pair: EditNode, char: string): boolean {
  const token = pair.delimiters[1];
  if (text.slice(token.from, token.to) !== `\\right${char}`) {
    return false;
  }
  const inside = text.slice(pair.delimiters[0].to, token.from);
  const count = (needle: string) => inside.split(needle).length - 1;
  switch (char) {
    case ")":
      return count("(") <= count(")");
    case "]":
      return count("[") <= count("]");
    case "|":
      return count("|") % 2 === 0;
    default:
      return true;
  }
}

/** Whether a node is inside an environment of that name (kept as a node, or an atom holding it). */
function insideEnvironment(view: EditView, node: NodeId, name: string): boolean {
  const { tree } = view;
  const { from, to } = tree.nodes[node].span;
  return tree.nodes.some((candidate) => candidate.span.from < from && candidate.span.to > to &&
    (candidate.command === name || tree.text.startsWith(`\\begin{${name}}`, candidate.span.from)));
}

/** What a copy (or cut) of the current selection writes to the clipboard (C3). */
export function copySelection(context: IntentContext): ClipboardPayload | null {
  return new Resolver(context).copy();
}

/** The position a caret at an offset is at: the outermost there (after `x^2‸`, outside the script). */
function caretAt(view: EditView, offset: number): Position {
  const found = view.index.resolve(offset, "after") ?? view.positionAt(offset);
  return outsideUnbracedScript(view, found, offset) ?? found;
}

/**
 * A bare offset at the end of an unbraced script is after the scripted
 * atom (R6: `x^2‸` has left its script), also where whitespace puts that
 * position further on (`x^2 & y`). Positions recorded by motion keep the
 * inside.
 */
function outsideUnbracedScript(view: EditView, position: Position, offset: number): Position | null {
  const { tree } = view;
  const slot = tree.slots[position.slot];
  if ((slot.role !== "sup" && slot.role !== "sub") || slot.braced || position.index < slot.children.length) {
    return null;
  }
  const scripted = tree.nodes[slot.node];
  if (scripted.parent == null || scripted.span.to !== offset) {
    return null;
  }
  const after = { slot: scripted.parent, index: childIndex(tree, scripted.id) + 1 };
  return /^\s*$/u.test(tree.text.slice(offset, view.offset(after))) ? after : null;
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
    const reveal = this.context.revealCodes === true ? { revealCodes: true } : undefined;
    const view = structure(this.context.text, reveal);
    const visibility = this.context.domain ? renderedVisibility(view.tree, this.context.domain, this.context.bufferFrom) : null;
    return visibility && (visibility.hidden.size > 0 || visibility.hiddenSlots.size > 0)
      ? structure(this.context.text, { ...visibility, ...reveal }) : view;
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
        const nextView = run === "insert" || outcome.exact ? null
          : structure(applyPatches(this.context.text, outcome.patches), this.context.revealCodes === true ? { revealCodes: true } : undefined);
        const found = nextView?.stopAt(outcome.caret) ?? null;
        const stop = found && nextView!.offset(found) >= outcome.caret ? found : null;
        const caret = stop ? nextView!.offset(stop) : outcome.caret;
        const focus = outcome.selectionEnd ?? caret;
        const literal = outcome.literal;
        return this.transaction(
          outcome.patches,
          { kind: "absolute", anchor: caret, focus, positions: stop && focus === caret ? { anchor: stop, focus: stop } : undefined },
          literal
            ? {
                group: "transformation",
                run: run ?? "insert",
                literal: { text: applyPatches(this.context.text, literal.patches), anchor: literal.caret, focus: literal.caret },
              }
            : run ? { group: "typing-run", run } : { group: "own-step" },
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
    return { kind: "transaction", transaction: this.carryPendingCloser(repaired) };
  }

  /**
   * A pending `\right` (M14) stays pending through an edit that leaves the
   * caret right before a `\right`: typing in front of it, a command
   * committed there, the chip opening and closing. An edit that accepts
   * it says so (`acceptsCloser`), or leaves the caret elsewhere.
   */
  private carryPendingCloser(transaction: Transaction): Transaction {
    if (this.context.interaction.pendingCloser == null || this.acceptsCloser || transaction.interaction?.pendingCloser != null) {
      return transaction;
    }
    const at = pendingCloserAfter(this.context, transaction);
    return at == null ? transaction : { ...transaction, interaction: { ...(transaction.interaction ?? NO_INTERACTION), pendingCloser: at } };
  }

  /** Set by an intent that accepts a pending `\right` where it stands (⇥, Esc). */
  private acceptsCloser = false;

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
    // Text typed in place takes no ink away: only deletions, line ends and commands can (and typing must stay fast).
    if (transaction.patches.every((patch) => patch.from === patch.to && !/[\n\\]/u.test(patch.insert))) {
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
    const pair = this.pendingPair(view);
    if (pair && closesPending(this.context.text, pair, text)) {
      // Its delimiter typed at a pending `\right` accepts it (M14).
      return this.acceptCloser(pair, true);
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
    const at = this.context.positions ? insertionOffset(view.tree, caret) : this.from;
    const typed = typeCharacter(view, caret, text, this.context.interaction, at, this.context.title);
    return this.outcome(view, (keyboard && !this.context.title ? this.transform(view, caret, at, text, typed) : null) ?? typed);
  }

  /** The input rules that transform a typed key after the fact (R12): smart quotes (P3), list autoformat (P10). */
  private transform(view: EditView, caret: Position, at: number, char: string, typed: EditOutcome): EditOutcome | null {
    if (char === "\"") {
      return smartQuote(view, caret, at, typed, this.context.commands?.quotes ?? "tex");
    }
    return char === " " ? listAutoformat(view, caret, at, typed) : null;
  }

  /**
   * Paste (O6): over a selection, the selection goes first, as a range
   * deletion would; then the payload is converted for where that left the
   * caret. Without the tree, the plain text goes in as it is.
   */
  paste(payload: ClipboardPayload): IntentResolution {
    const view = this.view;
    if (!view) {
      return this.replaceSelection(payload.plain, { group: "own-step" });
    }
    const { commands, title } = this.context;
    if (!this.hasRange()) {
      const caret = this.caretPosition(view);
      const at = this.context.positions ? insertionOffset(view.tree, caret) : this.from;
      return this.outcome(view, pasteAt(view, caret, at, payload, commands, title));
    }
    const { start, end } = this.effectiveRange(view, this.rawEnds(view));
    const deleted = deleteRange(view, start, end);
    if (deleted.kind !== "patch") {
      return NONE;
    }
    const middle = applyPatches(this.context.text, deleted.patches);
    const middleView = this.context.structure!(middle);
    const pasted = pasteAt(middleView, caretAt(middleView, deleted.caret), deleted.caret, payload, commands, title);
    if (pasted.kind !== "patch") {
      return NONE;
    }
    const caret = pasted.caret;
    return this.transaction(
      replacementPatches(this.context.text, applyPatches(middle, pasted.patches)),
      { kind: "absolute", anchor: caret, focus: caret },
      { group: "own-step" }
    );
  }

  /** What a copy of the selection carries; null without a selection, or off the tree (the input's own copy then). */
  copy(): ClipboardPayload | null {
    const view = this.view;
    if (!view || !this.hasRange()) {
      return null;
    }
    const { start, end } = this.effectiveRange(view, this.rawEnds(view));
    return copyRange(view, view.offset(start), view.offset(end), this.context.commands);
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

  /**
   * Removes a `\left…\right` pair's delimiters (and its `\middle`s, which
   * need the pair), keeping its content. Scripted, the content is braced
   * so the script stays on all of it; an emptied `$…$` keeps `{}`.
   */
  private unwrapDelimiters(view: EditView, id: NodeId, direction: "backward" | "forward"): IntentResolution {
    const { text, nodes, slots } = view.tree;
    const node = nodes[id];
    const [left, right] = node.delimiters;
    const content = slots[node.slots[0]];
    const middles = content.children.map((child) => nodes[child]).filter((child) => child.command === "middle");
    const scripted = /^\s*[_^']/u.test(text.slice(right.to));
    const parent = node.parent == null ? null : slots[node.parent];
    const emptied = text.slice(content.contentSpan.from, content.contentSpan.to).trim() === "" && parent != null &&
      isDollarFormula(view, parent.node) &&
      (text.slice(parent.contentSpan.from, node.span.from) + text.slice(node.span.to, parent.contentSpan.to)).trim() === "";
    if (emptied) {
      const brace = parent.contentSpan.from;
      return this.outcome(view, { kind: "patch", patches: [{ from: brace, to: parent.contentSpan.to, insert: "{}" }], caret: brace + 1, run: null, placeholder: brace });
    }
    // A control word left next to a letter would read as one longer name (`\alpha\left(x` → `\alpha x`).
    const removal = (from: number, to: number, insert: string): BufferPatch =>
      ({ from, to, insert: insert === "" && /\\[A-Za-z]+$/u.test(text.slice(0, from)) && /^[A-Za-z]/u.test(text.slice(to)) ? " " : insert });
    const patches: BufferPatch[] = [
      removal(left.from, left.to, scripted ? "{" : ""),
      ...middles.map((middle) => {
        const delimiter = text.slice(middle.span.from + "\\middle".length, middle.span.to).trim();
        return removal(middle.span.from, middle.span.to, delimiter === "." ? "" : delimiter);
      }),
      removal(right.from, right.to, scripted ? "}" : ""),
    ];
    // The caret stays at the content's edge it was at.
    const at: MappedPosition = direction === "backward" ? { offset: left.from + 1, assoc: 1 } : { offset: right.from + 1, assoc: -1 };
    return this.transaction(patches, { kind: "mapped", anchor: at, focus: at }, { group: "own-step" });
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
        // A `\left` still open is one token, not a construct around what follows it (which
        // runs on to the formula's end until its `\right` is typed): it goes alone (M14).
        const offset = this.caretOffset(view);
        const open = view.tree.nodes.find((node) => node.kind === "delimited" && node.delimiters.length === 1 &&
          (direction === "backward" ? node.delimiters[0].to === offset : node.delimiters[0].from === offset));
        if (open) {
          const { from, to } = open.delimiters[0];
          const slot = open.parent == null ? null : view.tree.slots[open.parent];
          // The formula's only content: it holds `{}`, never `$$`, as any emptied `$…$` does.
          if (slot && isDollarFormula(view, slot.node) &&
            (text.slice(slot.contentSpan.from, from) + text.slice(to, slot.contentSpan.to)).trim() === "") {
            const brace = slot.contentSpan.from;
            return this.outcome(view, { kind: "patch", patches: [{ from: brace, to: slot.contentSpan.to, insert: "{}" }], caret: brace + 1, run: null, placeholder: brace });
          }
          return this.deleteRange(from, to, { group: "own-step" });
        }
        // ⌫ just inside a pair's `\left(` (or ⌦ just inside its `\right)`) unwraps it, keeping
        // what it enclosed: there is no way to delete one delimiter of a pair alone (M14).
        const pair = view.tree.nodes.find((node) => node.kind === "delimited" && node.delimiters.length === 2 &&
          (direction === "backward" ? node.delimiters[0].to === offset : node.delimiters[1].from === offset));
        if (pair) {
          return this.unwrapDelimiters(view, pair.id, direction);
        }
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
      const at = this.context.positions ? insertionOffset(view.tree, caret) : this.from;
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
  /** An entry of the focus tag's menu (V4), for the construct with `span`, while it is still there. */
  constructMenu(span: Span, id: string): IntentResolution {
    const view = this.view;
    const commands = this.context.commands;
    if (!view || !commands) {
      return NONE;
    }
    const { tree } = view;
    const { chip, picker } = this.context.interaction;
    if (chip || picker) {
      return NONE;
    }
    if (id === "lens") {
      return this.keepSelection({ lens: { span } });
    }
    const node = tree.nodes.find((candidate) => candidate.span.from === span.from && candidate.span.to === span.to && candidate.parent != null);
    if (!node) {
      return NONE;
    }
    if (id === "select") {
      const index = childIndex(tree, node.id);
      return this.selectPositions(view, { anchor: { slot: node.parent!, index }, focus: { slot: node.parent!, index: index + 1 } });
    }
    const edit = constructMenuEdit(view, node.id, id, commands, this.from, this.context.title);
    return edit ? this.outcome(view, edit) : NONE;
  }

  /** A ghost slot of the construct around the caret, written (V3): as a typed `^`/`_` adds a missing script (K4), `[]` for an index or label. */
  createSlot(kind: "index" | "sup" | "sub" | "label", at: number): IntentResolution {
    const view = this.view;
    if (!view || this.hasRange()) {
      return NONE;
    }
    const ghost = ghostSlots(view, this.caretPosition(view)).find((candidate) => candidate.kind === kind && candidate.at === at);
    if (!ghost) {
      return NONE;
    }
    if (kind === "sup" || kind === "sub") {
      const after = { slot: view.tree.nodes[ghost.node].parent!, index: childIndex(view.tree, ghost.node) + 1 };
      return this.outcome(view, typeCharacter(view, after, kind === "sup" ? "^" : "_", NO_INTERACTION, at));
    }
    return this.outcome(view, { kind: "patch", patches: [{ from: at, to: at, insert: "[]" }], caret: at + 1, run: null, exact: true });
  }

  pickCompletion(index: number): IntentResolution {
    const view = this.view;
    const chip = this.context.interaction.chip;
    if (!view || !chip || !this.context.commands) {
      return NONE;
    }
    return this.commitChip(view, this.context.commands, { ...chip, selected: index }, "structure", true);
  }

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
    const pair = this.pendingPair(view);
    if (pair && !back) {
      // ⇥ accepts a pending `\right` (M14).
      return this.acceptCloser(pair, true);
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

  /** Esc: closes the command chip, value editor or lens; what the lens wrote stays. */
  escape(): IntentResolution {
    const { chip, picker, lens } = this.context.interaction;
    if (lens && this.view && !this.hasRange()) {
      // The lens's caret may be anywhere in the source (`\‸\newpage`); the canvas's is on a stop.
      const stop = this.view.offset(this.view.positionAt(this.from));
      if (stop !== this.from) {
        return this.transaction([], { kind: "absolute", anchor: stop, focus: stop }, { group: "own-step" });
      }
    }
    if (chip || picker || lens) {
      return this.keepSelection(NO_INTERACTION);
    }
    const pair = this.view ? this.pendingPair(this.view) : null;
    // A pending `\right` (M14) is accepted where it stands.
    return pair ? this.acceptCloser(pair, false) : NONE;
  }

  /** ⌘E: the source lens (R13) on the selection, or on the innermost construct around the caret. */
  openLens(): IntentResolution {
    const view = this.view;
    if (!view) {
      return NONE;
    }
    return this.keepSelection({ lens: { span: lensSpan(view, this.context.anchor, this.context.focus) } });
  }

  /**
   * The lens's text after an edit, written over its span as typed: the
   * lens is a literal surface, so none of the canvas's input rules or
   * repairs apply. The canvas caret follows the lens's.
   */
  setLensText(next: string, caret: number): IntentResolution {
    const lens = this.context.interaction.lens;
    if (!lens) {
      return NONE;
    }
    const { patch, span } = lensEdit(this.context.text, lens.span, next);
    const offset = span.from + Math.max(0, Math.min(caret, next.length));
    return {
      kind: "transaction",
      transaction: {
        baseRevision: this.context.revision,
        patches: patch ? [patch] : [],
        selection: { kind: "absolute", anchor: offset, focus: offset },
        undo: { group: "typing-run", run: "lens" },
        interaction: { lens: { span } },
      },
    };
  }

  /** The quick fix (T6): the closers recovery put in virtually, written in, as one step. */
  insertClosers(closers: readonly { readonly at: number; readonly text: string }[]): IntentResolution {
    const { text } = this.context;
    const patches = closers
      .filter((closer) => closer.at >= 0 && closer.at <= text.length)
      .map((closer) => ({ from: closer.at, to: closer.at, insert: closer.text }))
      .sort((left, right) => left.from - right.from);
    if (patches.length === 0) {
      return NONE;
    }
    // Closers at one offset go in innermost first, as the recovery lists them outermost first.
    const merged: BufferPatch[] = [];
    for (const patch of patches) {
      const last = merged.at(-1);
      if (last?.from === patch.from) {
        merged[merged.length - 1] = { ...last, insert: patch.insert + last.insert };
      } else {
        merged.push(patch);
      }
    }
    return {
      kind: "transaction",
      transaction: {
        baseRevision: this.context.revision,
        patches: merged,
        selection: { kind: "mapped", anchor: { offset: this.context.anchor, assoc: -1 }, focus: { offset: this.context.focus, assoc: -1 } },
        undo: { group: "own-step" },
      },
    };
  }

  /**
   * The value editor's fields, filled (O8): the command it is open for,
   * written whole, as one step. Values that cannot be written leave it
   * open, writing nothing.
   */
  pickValues(values: readonly string[], viaBrace: boolean): IntentResolution {
    const picker = this.context.interaction.picker;
    const view = this.view;
    const commands = this.context.commands;
    const editor = picker && view && commands ? valueEditorFields(commands, view, picker.at, picker.name, picker.key) : null;
    if (!picker || !view || !commands || !editor) {
      return NONE;
    }
    const caret = caretAt(view, picker.at);
    const written = braceUnbracedArgument(view, caret,
      commitWithValues(view, commands, caret, picker.at, picker.name, picker.held, editor.fields, values));
    if (written.kind !== "patch") {
      return NONE;
    }
    const focus = written.selectionEnd ?? written.caret;
    const applied = applyPatches(this.context.text, written.patches);
    // Confirmed by `}` into an empty argument: a `{` typed next is that argument's own.
    const consumeOpen = viaBrace && focus === written.caret && applied[written.caret - 1] === "{";
    return this.transaction(
      written.patches,
      { kind: "absolute", anchor: written.caret, focus },
      { group: "own-step" },
      consumeOpen ? { interaction: { consumeOpen: written.caret } } : {}
    );
  }

  /** Values already written, edited in place (O8): one step; the selection keeps its place. */
  setValues(edits: readonly { readonly span: { readonly from: number; readonly to: number }; readonly text: string }[]): IntentResolution {
    const view = this.view ?? this.context.structure?.(this.context.text) ?? null;
    const patches = view ? editValues(view, edits) : null;
    const { text, anchor, focus } = this.context;
    if (!patches || patches.every((patch) => text.slice(patch.from, patch.to) === patch.insert)) {
      return NONE;
    }
    const map = (offset: number) => {
      let shift = 0;
      for (const patch of patches) {
        if (patch.to <= offset) {
          shift += patch.insert.length - (patch.to - patch.from);
        } else if (patch.from < offset) {
          return patch.from + shift + patch.insert.length;
        }
      }
      return offset + shift;
    };
    return this.transaction(patches, { kind: "absolute", anchor: map(anchor), focus: map(focus) }, { group: "own-step" });
  }

  /**
   * Opens the value editor for a command that needs values (O8), in place
   * of writing it with empty ones. A held selection goes into the content
   * argument when the command has one (of the selection's mode); else the
   * command replaces it, and it is what the first field starts with.
   */
  private openPicker(view: EditView, commands: CommandTable, chip: ChipState, name: string, key: CommitKey, then?: string): IntentResolution {
    const mode = view.tree.slots[caretAt(view, chip.at).slot].mode === "math" ? "math" : "text";
    const own = commands.command(name, mode);
    const schema = own ?? commands.command(name, mode === "math" ? "text" : "math")!;
    const target = schema.args.find((arg) => arg.kind === "mandatory" && arg.rendered);
    if (chip.held && (!own || (target && (target.mode ?? mode) !== mode))) {
      // A selection does not go into another mode, nor into a command of another mode.
      return this.keepSelection(NO_INTERACTION);
    }
    const replaced = chip.held && !target ? this.context.text.slice(chip.held.from, chip.held.to) : "";
    const seed = replaced + (then != null && !"{}$".includes(then) ? then : "");
    return this.keepSelection({ picker: { name, at: chip.at, held: chip.held, key, seed } });
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
    return this.context.positions ? insertionOffset(view.tree, view.representative(this.rawEnds(view).focus)) : this.from;
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
    if (chip.name === "" && !isControlSymbol(char, view.tree.slots[caret.slot].mode)) {
      // `\<` is no command: the chip closes, and the character is typed as itself.
      return new Resolver({ ...this.context, interaction: NO_INTERACTION }).insertText(char, true);
    }
    if (chip.name === "") {
      const symbol = commitControlSymbol(view, caret, chip.at, char, chip.held);
      if (!symbol) {
        return this.keepSelection(NO_INTERACTION);
      }
      return this.commitOutcome(view, symbol.outcome, symbol.pending);
    }
    const delimiterChip = /^(left|right)(?:\\([A-Za-z]*))?$/u.exec(chip.name);
    if (delimiterChip) {
      const [, side, named] = delimiterChip;
      if (named == null && char === "\\") {
        // The delimiter is a command (`\left\{`, `\left\langle`): the chip goes on to its name.
        return this.keepSelection({ ...this.context.interaction, chip: { ...chip, name: `${chip.name}\\`, selected: 0 } });
      }
      // A named delimiter ends at a non-letter, which is then typed (a space is just its end).
      const delimiter = named == null ? char : `\\${named === "" ? char : named}`;
      const committed = this.commitDelimiter(view, commands, caret, chip, side, delimiter);
      if (committed) {
        return named ? this.thenType(committed, char === " " ? null : char) : committed;
      }
      if (named != null) {
        // `\left\foo`: no delimiter; nothing is written.
        return this.keepSelection(NO_INTERACTION);
      }
    }
    if (char === " ") {
      return this.commitChip(view, commands, chip, "space", false);
    }
    if (char === "\\") {
      // The next command starts: commit this one, open a new chip after it. A command
      // that takes arguments gets its braces, with the new chip in the first, so the
      // source stays whole if that chip is never committed (`\\sqrt{\\te‸}`).
      // (A command that needs values asks for them first, the `\\` starting the first.)
      const name = chipCommitName(commands, view.tree.slots[caret.slot].mode, chip.name, chip.selected, view.tree.text, false);
      const schema = commands.command(name, view.tree.slots[caret.slot].mode === "math" ? "math" : "text");
      if (schema && needsValues(schema)) {
        return this.commitChip(view, commands, chip, "typed", false, char);
      }
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
    // TeX would take the character as the argument (K2), but it belongs to the argument's mode
    // (`_` after `$\textit` is text): it goes inside the braces, typed there.
    const mode = view.tree.slots[caret.slot].mode === "math" ? "math" : "text";
    const name = chipCommitName(commands, mode, chip.name, chip.selected, view.tree.text, false);
    const argument = commands.command(name, mode)?.args.find((arg) => arg.kind === "mandatory");
    const crosses = argument?.rendered === true && argument.mode != null && argument.mode !== mode;
    return this.commitChip(view, commands, chip, crosses ? "structure" : "typed", false, char);
  }

  /**
   * `\left` or `\right` with its delimiter (M14). `\left` writes its pair
   * with the `\right` pending, or around a held selection, which it wraps;
   * in prose the pair starts a formula. `\right` closes, steps over or
   * moves one (closeRight). Null: not a delimiter for that side.
   */
  private commitDelimiter(
    view: EditView,
    commands: CommandTable,
    caret: Position,
    chip: ChipState,
    side: string,
    delimiter: string
  ): IntentResolution | null {
    const mode = view.tree.slots[caret.slot].mode;
    // A bare `]` would end the optional argument it is in (`\bibitem[A$\right]$`): the bracket by name.
    const bracketed = this.context.title === true || insideOptional(view, caret.slot);
    const named = bracketed && delimiter === "]" ? "\\rbrack" : bracketed && delimiter === "[" ? "\\lbrack" : delimiter;
    if (side === "right") {
      return mode === "math" && isDelimiter(named) ? this.closeRight(view, chip, named) : null;
    }
    if (matchingRightDelimiter(named) == null) {
      return null;
    }
    let written: EditOutcome | null;
    if (mode === "math") {
      written = commitLeftDelimiter(view.tree.text, chip.at, chip.held, named);
    } else {
      const pair = commitAcrossModes(view, commands, caret, chip.at, "left", "typed", chip.held, named);
      if (pair === "refused") {
        return this.keepSelection(NO_INTERACTION);
      }
      written = pair?.outcome ?? null;
    }
    if (!written) {
      return null;
    }
    const committed = this.commitOutcome(view, written);
    return chip.held ? committed : this.withPendingCloser(committed);
  }

  /** A transaction leaving the caret right before a `\right`, with that `\right` pending (M14). */
  private withPendingCloser(resolution: IntentResolution): IntentResolution {
    if (resolution.kind !== "transaction") {
      return resolution;
    }
    const at = pendingCloserAfter(this.context, resolution.transaction);
    return at == null ? resolution : {
      ...resolution,
      transaction: { ...resolution.transaction, interaction: { ...(resolution.transaction.interaction ?? NO_INTERACTION), pendingCloser: at } },
    };
  }

  /**
   * A character typed right after a commit, in the same step: what it
   * types is resolved against the committed buffer.
   */
  private thenType(committed: IntentResolution, char: string | null): IntentResolution {
    if (char == null || committed.kind !== "transaction") {
      return committed;
    }
    const applied = applyTransaction(this.context.text, committed.transaction);
    const next = new Resolver({
      ...this.context,
      text: applied.text,
      anchor: applied.anchor,
      focus: applied.focus,
      positions: null,
      interaction: committed.transaction.interaction ?? NO_INTERACTION,
    }).insertText(char, true);
    if (next.kind !== "transaction") {
      return committed;
    }
    const final = applyTransaction(applied.text, next.transaction);
    return {
      kind: "transaction",
      transaction: {
        ...next.transaction,
        baseRevision: this.context.revision,
        patches: replacementPatches(this.context.text, final.text),
        selection: { kind: "absolute", anchor: final.anchor, focus: final.focus },
        undo: { group: "own-step" },
      },
    };
  }

  /** The pending `\right` (M14), as written (`\right)`): the chip offers it first. */
  private pendingCloserText(view: EditView): string | null {
    const at = this.context.interaction.pendingCloser;
    const token = at == null ? null : pendingCloserSpan(view, at);
    return token ? view.tree.text.slice(token.from, token.to) : null;
  }

  /** The pending `\right` (M14) the caret is right before, with nothing selected: its pair's node. */
  private pendingPair(view: EditView): EditNode | null {
    const at = this.context.interaction.pendingCloser;
    if (at == null || this.hasRange() || this.from !== at) {
      return null;
    }
    return view.tree.nodes.find((node) => node.kind === "delimited" && node.delimiters.length === 2 && node.delimiters[1].from === at) ?? null;
  }

  /** Accepts the pending `\right` (M14): the caret steps past it, or stays put (Esc). */
  private acceptCloser(pair: EditNode, stepPast: boolean): IntentResolution {
    this.acceptsCloser = true;
    const caret = stepPast ? pair.delimiters[1].to : this.from;
    return this.transaction([], { kind: "absolute", anchor: caret, focus: caret }, { group: "own-step" });
  }

  /**
   * ←/→ with a `\right` pending (M14) take it along, over what is already
   * written in the pair's own slot: by caret stop, by word (⌥) or to the
   * end (⌘), never into a construct (its stops are in its own slots) and
   * never back past its `\left`. At the end there is nothing more to
   * enclose: → accepts it and steps past; ← at the start accepts it and
   * moves on as usual. The moves join the step that wrote the pair.
   */
  private movePendingCloser(view: EditView, pair: EditNode, motion: Extract<Intent, { type: "move" }>): IntentResolution {
    const { text } = this.context;
    const token = pair.delimiters[1];
    const closer = text.slice(token.from, token.to);
    const unwrapped = text.slice(0, token.from) + text.slice(token.to);
    const loose = this.context.structure!(unwrapped);
    // Without the `\right`, the `\left` runs on to its slot's end (or to a `\right` further on): its content's stops are where the `\right` may go.
    const open = loose.tree.nodes.find((node) => node.kind === "delimited" && node.delimiters[0]?.from === pair.delimiters[0].from);
    if (!open) {
      return this.acceptCloser(pair, motion.dir === "right");
    }
    const content = open.slots[0];
    const stops = [...new Set(loose.stops.filter((stop) => stop.slot === content).map((stop) => loose.offset(stop)))].sort((a, b) => a - b);
    const at = token.from;
    const forward = motion.dir === "right";
    let target: number | undefined;
    if (motion.unit === "edge" || motion.unit === "scope") {
      target = forward ? stops.at(-1) : stops[0];
    } else if (motion.unit === "word") {
      const word = alphanumericWordEdge(unwrapped, at, forward);
      target = forward ? stops.find((stop) => stop >= word) ?? stops.at(-1) : [...stops].reverse().find((stop) => stop <= word) ?? stops[0];
    } else {
      // A plain `(…)` or `[…]` already written goes over as one: `g_i(x^\star)` is `g_i` and then its parentheses.
      const group = matchingPlainBracket(loose, content, at, forward);
      target = group != null
        ? (forward ? stops.find((stop) => stop >= group) : [...stops].reverse().find((stop) => stop <= group))
        : forward ? stops.find((stop) => stop > at) : [...stops].reverse().find((stop) => stop < at);
    }
    if (target == null || target === at) {
      if (forward) {
        return this.acceptCloser(pair, true);
      }
      this.acceptsCloser = true;
      return new Resolver({ ...this.context, interaction: NO_INTERACTION }).move(motion);
    }
    // A control word must not run into a letter where the `\right` leaves or lands (`\alpha\right)x`, `\right\rangle x`).
    const leaving = /\\[A-Za-z]+$/u.test(text.slice(0, token.from)) && /^[A-Za-z]/u.test(text.slice(token.to)) ? " " : "";
    const landing = target > at ? target + (token.to - token.from) : target;
    const removal = { from: token.from, to: token.to, insert: leaving };
    const insertion = { from: landing, to: landing, insert: apart(closer, text, landing) };
    const patches = target > at ? [removal, insertion] : [insertion, removal];
    return this.withPendingCloser(this.transaction(patches, {
      kind: "mapped",
      anchor: { offset: landing, assoc: -1 },
      focus: { offset: landing, assoc: -1 },
    }, { group: "amend" }));
  }

  /**
   * `\right` and its delimiter. In a `\left` still open, it closes it
   * here: `\left(` typed before what is to be wrapped and `\right)` typed
   * after it wrap it (M14). At a `\right` already there, it steps over it
   * (R3). After a pair, further on in the same formula, it extends the
   * pair to here: its `\right` moves (TeX has no `\right` without a
   * `\left`). Elsewhere it writes nothing.
   */
  private closeRight(view: EditView, chip: ChipState, char: string): IntentResolution {
    const text = view.tree.text;
    let at = chip.at;
    while (/\s/u.test(text[at] ?? "")) {
      at += 1;
    }
    const here = view.tree.nodes.find((node) => node.kind === "delimited" && node.delimiters[1]?.from === at)?.delimiters[1];
    if (!chip.held && here) {
      // At a `\right` (the one pending, say): this is it, with the delimiter typed.
      const insert = `\\right${char}`;
      if (text.slice(here.from, here.to) === insert) {
        return this.transaction([], { kind: "absolute", anchor: here.to, focus: here.to }, { group: "own-step" });
      }
      const caret = here.from + insert.length;
      return this.transaction([{ from: here.from, to: here.to, insert: apart(insert, text, here.to) }], { kind: "absolute", anchor: caret, focus: caret }, { group: "own-step" });
    }
    const { tree } = view;
    const slot = tree.slots[caretAt(view, chip.at).slot];
    // The innermost `\left` still open whose contents the caret is in (or at the end of, with nothing
    // in it yet), in its own slot: not inside a script or argument within it.
    const open = tree.nodes
      .filter((node) => node.kind === "delimited" && node.delimiters.length === 1)
      .filter((node) => {
        const content = tree.slots[node.slots[0]];
        return content.contentSpan.from <= chip.at && chip.at <= content.contentSpan.to &&
          (content.id === slot.id || (node.span.to === chip.at && slot.children.includes(node.id)));
      })
      .sort((left, right) => (left.span.to - left.span.from) - (right.span.to - right.span.from))[0];
    if (!chip.held && isDelimiter(char) && open) {
      const insert = `\\right${char}`;
      return this.transaction(
        [{ from: chip.at, to: chip.at, insert: apart(insert, text, chip.at) }],
        { kind: "absolute", anchor: chip.at + insert.length, focus: chip.at + insert.length },
        { group: "own-step" }
      );
    }
    const pair = chip.held || !isDelimiter(char) ? undefined : slot.children
      .map((id) => tree.nodes[id])
      .filter((node) => node.kind === "delimited" && node.delimiters.length === 2 && node.span.to <= chip.at)
      .at(-1);
    if (!pair) {
      return this.keepSelection(NO_INTERACTION);
    }
    const closer = pair.delimiters[1];
    const insert = `\\right${char}`;
    const caret = chip.at - (closer.to - closer.from) + insert.length;
    return this.transaction(
      [{ from: closer.from, to: closer.to, insert: "" }, { from: chip.at, to: chip.at, insert: apart(insert, text, chip.at) }],
      { kind: "absolute", anchor: caret, focus: caret },
      { group: "own-step" }
    );
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
    const name = chipCommitName(commands, mode, chip.name, chip.selected, view.tree.text, accept, this.pendingCloserText(view));
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
    const rowLevel = view.tree.slots[caret.slot].role === "cell" || view.tree.nodes[view.tree.slots[caret.slot].node].kind === "alignment";
    if (TABLE_RULES.has(name) && !(rowLevel && inAlignment(view, caret.slot))) {
      // Outside a table, or inside something in a cell (a script, a group), TeX has no row for a rule ("Misplaced \noalign").
      return this.keepSelection(NO_INTERACTION);
    }
    if ((name === "item" || name === "bibitem") && !inListFlow(view, caret.slot)) {
      // Outside a list, TeX has a "lonely \item".
      return this.keepSelection(NO_INTERACTION);
    }
    if (UNCOVERING.has(name) && insideCommand(view, caret.slot, "operatorname")) {
      // beamer's `\uncover` family is set with `\limits`, which an operator's name has no operator for.
      return this.keepSelection(NO_INTERACTION);
    }
    const holder = view.tree.slots[caret.slot].node;
    if (name === "pause" && (view.tree.nodes[holder].command === "overprint" || insideEnvironment(view, holder, "overprint"))) {
      // In `overprint`, a `\pause` makes its areas overlap (beamer: "Overprints may not overlap").
      return this.keepSelection(NO_INTERACTION);
    }
    if (inBoldMath(view, caret.slot) && breaksBoldMath(commands, name)) {
      // `\bm` expands what it holds, and these do not survive it (LuaLaTeX loops).
      return this.keepSelection(NO_INTERACTION);
    }
    const delimited = /^(left|right)([^A-Za-z].*)?$/su.exec(name);
    if (delimited && (mode === "math" || delimited[2] != null)) {
      // `\left` and `\right` only exist in pairs (K16, O5): `\left` brings its
      // `\right` (a completion names the delimiter, `\left(`; bare, it is `(`);
      // a `\right` closes or steps over one (a bare one, or `\middle`, writes nothing).
      const [, side, given] = delimited;
      const delimiter = given ?? (side === "left" ? "(" : "");
      return this.commitDelimiter(view, commands, caret, chip, side, delimiter) ?? this.keepSelection(NO_INTERACTION);
    }
    if (mode === "math" && name === "middle") {
      return this.keepSelection(NO_INTERACTION);
    }
    const valued = commands.command(name, mode === "math" ? "math" : "text") ??
      (mode === "math" && ["declaration", "vertical", "break", "overlay"].includes(commands.command(name, "text")?.category ?? "") ? null : commands.command(name, mode === "math" ? "text" : "math"));
    if (valued && needsValues(valued) && !UNCOMMITTABLE.has(name)) {
      // Never written with empty values (O8): the value editor asks for them first.
      return this.openPicker(view, commands, chip, name, key, then);
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
    const pair = view && this.context.structure && !motion.extend && (motion.dir === "left" || motion.dir === "right") ? this.pendingPair(view) : null;
    if (view && pair) {
      return this.movePendingCloser(view, pair, motion);
    }
    const { unit } = motion;
    if (unit === "word") {
      // (⌥←/⌥→ are native but with a `\right` pending; should one arrive anyway, it moves by source word.)
      const { text, anchor, focus } = this.context;
      const next = motion.dir === "left" || motion.dir === "up" ? previousWordBoundary(text, focus) : nextWordBoundary(text, focus);
      return motion.extend ? this.select(anchor, next) : this.select(next, next);
    }
    if (view && motion.unit === "item" && (motion.dir === "left" || motion.dir === "right")) {
      return this.moveOnTree(view, motion.dir === "left" ? -1 : 1, motion.extend);
    }
    const rendered = resolveCanvasRenderedMotion(
      this.context.domain,
      this.bufferSelection(),
      { ...motion, unit },
      this.context.verticalGoal
    );
    if (rendered) {
      return this.selectMotionResult(rendered);
    }
    // No rendered domain: source-character motion.
    const { text, anchor, focus } = this.context;
    const backward = motion.dir === "left" || motion.dir === "up";
    let next: number;
    switch (unit) {
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
    // (Judged on the selection as drawn: its promotion takes a construct an end is in, `\lambda_i`, whole.)
    const { tree } = view;
    const ends = promoteSelection(view, selectionEndsAt(view, from, to));
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
    // In `overprint`, `\\onslide` starts the next area: a box around it would hold half of two.
    if (tree.nodes.some((node) => node.command === "onslide" && node.span.from >= from && node.span.to <= to && insideEnvironment(view, node.id, "overprint"))) {
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
