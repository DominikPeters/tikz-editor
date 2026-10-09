import type { CommandTable } from "../commands/table.js";
import type { Position } from "../position/position.js";
import type { EditView } from "../position/view.js";
import { buildEditTree } from "../tree/build.js";
import type { EditMode, EditNodeKind, EditTree, NodeId, SlotId } from "../tree/types.js";
import { breaksBoldMath, inBoldMath, lineEndable } from "./command.js";
import type { EditOutcome } from "./delete.js";
import {
  afterSuperscript,
  beforeMulticolumn,
  endsWithControlWord,
  insideOptional,
  optionalArgumentAhead,
  placeInsertion,
  skipSpacesBack,
} from "./insert.js";
import { SPEC_READER_BEFORE, withBracketGuard, withTerminator } from "./source.js";
import { inAlignment, inListFlow, inValue } from "./structure.js";

/**
 * The clipboard (R15, O6, C3, Z3). A copy made on the canvas carries the
 * selection's balanced source with the mode it was copied in; anything
 * else is plain text, pasted literally. Paste converts by destination:
 * formulas copied into prose get `$…$`, prose pasted into math gets
 * `\text{…}`, and source that cannot stand where it goes (a list in a
 * title, rows outside a table) falls back to its plain text.
 */

/** A copy made on the canvas. */
export type CanvasClip = {
  /** The selection's source, balanced: wrappers it cuts through are closed and reopened. */
  readonly source: string;
  /** The mode of the slot the copy was made in. */
  readonly mode: "text" | "math";
  /** `whole` for exactly one inline formula (`$x$`); math pasted into math then drops its delimiters. */
  readonly shape: "fragment" | "whole";
};

export type ClipboardPayload = {
  /** The rendered text (`text/plain`), and what an outside paste carries. */
  readonly plain: string;
  readonly clip?: CanvasClip;
};

/** The clipboard type a canvas copy is written under, next to `text/plain`. */
export const CANVAS_CLIP_TYPE = "application/x-tikz-editor-clip+json";

/** Diagnostics a balanced copy never has. */
const UNBALANCED = new Set(["unclosed-group", "unclosed-math", "unclosed-environment", "unmatched-close"]);

/** Constructs a copy reopens and closes when it starts or ends inside them. */
const CARRIED_KINDS = new Set(["list", "item"]);

/**
 * The payload of a copy of `from`–`to` (a promoted selection): source with
 * the wrappers and lists it cuts through completed, and its plain text.
 */
export function copyRange(view: EditView, from: number, to: number, commands: CommandTable | null): ClipboardPayload | null {
  const { tree } = view;
  if (to <= from) {
    return null;
  }
  const text = tree.text;
  const carried = (node: NodeId) => CARRIED_KINDS.has(tree.nodes[node].kind) || view.role(node) === "transparent";
  const slotAround = (node: NodeId, offset: number) => tree.nodes[node].slots
    .map((slot) => tree.slots[slot])
    .find((slot) => slot.presence === "present" && slot.contentSpan.from <= offset && offset <= slot.contentSpan.to);
  let open = "";
  let close = "";
  // Opened before the range and closed in it: reopened, outermost first.
  for (const node of tree.nodes.filter((node) => node.span.from < from && node.span.to > from && node.span.to <= to)
    .sort((left, right) => left.span.from - right.span.from)) {
    const slot = slotAround(node.id, from);
    if (slot && carried(node.id)) {
      open += text.slice(node.span.from, slot.contentSpan.from);
    }
  }
  // Opened in the range and closed after it: closed, innermost first.
  for (const node of tree.nodes.filter((node) => node.span.from >= from && node.span.from < to && node.span.to > to)
    .sort((left, right) => left.span.to - right.span.to)) {
    const slot = slotAround(node.id, to);
    if (slot && carried(node.id)) {
      close += text.slice(slot.contentSpan.to, node.span.to);
    }
  }
  const mode = modeAround(tree, from, to);
  // (Spaces at a formula's edges are insignificant, as the source lines a display ends with.)
  const body = mode === "math" ? text.slice(from, to).trim() : text.slice(from, to);
  const source = open + body + close;
  const plain = plainText(view, from, to);
  const parsed = buildEditTree(mode === "math" ? `$${source}$` : source, commands ? { commands } : {});
  if (parsed.diagnostics.some((diagnostic) => UNBALANCED.has(diagnostic.code))) {
    return { plain };
  }
  const whole = mode === "text" && tree.nodes.some((node) =>
    node.kind === "formula" && node.span.from === from && node.span.to === to && /^(?:\$[^$]|\\\()/u.test(source));
  return { plain, clip: { source, mode, shape: whole ? "whole" : "fragment" } };
}

/** The mode of the innermost slot holding the range. */
function modeAround(tree: EditTree, from: number, to: number): "text" | "math" {
  let best: { size: number; mode: EditMode } | null = null;
  for (const slot of tree.slots) {
    const { from: start, to: end } = slot.contentSpan;
    if (slot.presence === "present" && start <= from && to <= end && (best == null || end - start < best.size)) {
      best = { size: end - start, mode: slot.mode };
    }
  }
  return best?.mode === "math" ? "math" : "text";
}

/** Text-mode control symbols and words with a plain rendering. */
const PLAIN_SYMBOLS: Readonly<Record<string, string>> = {
  "\\%": "%", "\\&": "&", "\\#": "#", "\\$": "$", "\\_": "_", "\\{": "{", "\\}": "}",
  "\\textbackslash": "\\", "\\ldots": "…", "\\dots": "…", "\\textendash": "–", "\\textemdash": "—",
  "\\LaTeX": "LaTeX", "\\TeX": "TeX", "\\,": " ", "\\ ": " ", "\\quad": " ", "\\qquad": " ",
};

/** Leaves by their plain text: as written (null), fixed, or nothing (hidden syntax). */
const LEAF_TEXT: Partial<Record<EditNodeKind, string | null>> = {
  char: null, space: " ", break: "\n", invisible: "", atom: "", vertical: "",
};

/**
 * What the range shows as plain text: prose as read, formulas as their
 * source, line and paragraph ends as newlines, hidden syntax left out.
 */
function plainText(view: EditView, from: number, to: number): string {
  const { tree } = view;
  const parts: string[] = [];
  const visit = (node: NodeId): void => {
    const record = tree.nodes[node];
    if (record.span.to <= from || record.span.from >= to) {
      return;
    }
    const inside = record.span.from >= from && record.span.to <= to;
    const source = tree.text.slice(Math.max(from, record.span.from), Math.min(to, record.span.to));
    if (record.mode === "math" || record.kind === "formula" || record.kind === "display") {
      // A whole formula reads as its content; a part of one as its source.
      const content = record.kind === "formula" || record.kind === "display" ? tree.slots[record.slots[0]]?.contentSpan : null;
      parts.push(inside && content ? tree.text.slice(content.from, content.to) : source);
      return;
    }
    const leaf = LEAF_TEXT[record.kind];
    if (leaf !== undefined) {
      parts.push(leaf ?? source);
      return;
    }
    if (record.kind === "symbol") {
      parts.push(PLAIN_SYMBOLS[source.replace(/\{\}$/u, "")] ?? "");
      return;
    }
    if ((record.kind === "paragraph" || record.kind === "item") && parts.length > 0 && !/\n$/u.test(parts.at(-1)!)) {
      parts.push(record.kind === "paragraph" ? "\n\n" : "\n");
    }
    if (record.kind === "link" && record.slots.length === 0) {
      // `\url{…}` shows its address.
      parts.push(record.values.map((value) => tree.text.slice(value.contentSpan.from, value.contentSpan.to)).join(""));
      return;
    }
    for (const slot of record.slots) {
      if (tree.slots[slot].role === "label") {
        continue;
      }
      for (const child of tree.slots[slot].children) {
        visit(child);
      }
    }
  };
  visit(tree.root);
  return parts.join("").replace(/[ \t]+/gu, " ").replace(/ *\n */gu, "\n").trim();
}

/**
 * Pastes a payload at the caret (O6): a canvas copy converted by mode, or
 * plain text escaped for its destination, with the seams an insertion
 * needs (R5 terminators, K9 brackets). Nothing goes before a
 * `\multicolumn` or into a value.
 */
export function pasteAt(
  view: EditView,
  caret: Position,
  at: number,
  payload: ClipboardPayload,
  commands: CommandTable | null,
  title = false
): EditOutcome {
  if (beforeMulticolumn(view, caret) || inValue(view, at)) {
    return { kind: "none" };
  }
  const mode = view.tree.slots[caret.slot].mode === "math" ? "math" : "text";
  const place = { view, caret, at, mode, title } as const;
  const converted = (payload.clip && convertClip(place, payload.clip, commands)) ?? convertPlain(place, payload.plain);
  if (!converted) {
    return { kind: "none" };
  }
  const guarded = title || insideOptional(view, caret.slot) ? protectClosingBrackets(converted) : converted;
  const source = startSeam(place, guarded) + guarded;
  const end = at + source.length;
  const patches = withBracketGuard(view.tree.text, withTerminator(view.tree.text, [{ from: at, to: at, insert: source }], end, mode), end);
  const inserted = patches[0].insert;
  return placeInsertion(view, caret, at, { kind: "patch", patches, caret: at + inserted.length, run: null });
}

type Place = {
  readonly view: EditView;
  readonly caret: Position;
  readonly at: number;
  readonly mode: "text" | "math";
  readonly title: boolean;
};

/** A canvas copy as source for the destination, or null when it cannot stand there. */
function convertClip(place: Place, clip: CanvasClip, commands: CommandTable | null): string | null {
  let source: string;
  if (place.mode === "math") {
    source = clip.shape === "whole" ? formulaContent(clip.source) : clip.mode === "text" ? `\\text{${clip.source}}` : clip.source;
  } else {
    source = clip.mode === "math" ? `$${clip.source}$` : clip.source;
  }
  return fits(place, source, commands) ? source : null;
}

function formulaContent(source: string): string {
  return source.startsWith("$") ? source.slice(1, -1) : source.slice(2, -2);
}

/** Commands that only stand where a table or fragile frame has them. */
const PLACE_BOUND = new Set([
  "verb", "lstinline", "multicolumn", "hline", "cline", "toprule", "midrule", "bottomrule", "cmidrule", "addlinespace", "specialrule",
]);

/** Blocks that need a paragraph's place. */
const BLOCK_KINDS = new Set(["list", "item", "container", "display", "alignment", "vertical"]);

const BEAMER_LIST_DEPTH = 3;

/**
 * Whether source can be inserted at the place as it is: paragraph breaks
 * and blocks only where paragraphs go, items only in a list, line breaks
 * only where a line can end, cells and table rules never (they would
 * change the table's shape).
 */
function fits(place: Place, source: string, commands: CommandTable | null): boolean {
  const { view, caret, at, mode, title } = place;
  const tree = buildEditTree(mode === "math" ? `$${source}$` : source, commands ? { commands } : {});
  if (tree.diagnostics.some((diagnostic) => UNBALANCED.has(diagnostic.code) || diagnostic.code === "stray-alignment-tab")) {
    return false;
  }
  const nodes = tree.nodes.filter((node) => node.id !== tree.root);
  if (nodes.some((node) => node.kind === "row" || (node.command != null && PLACE_BOUND.has(node.command)))) {
    return false;
  }
  if (commands && inBoldMath(view, caret.slot) && nodes.some((node) => node.command != null && breaksBoldMath(commands, node.command))) {
    return false;
  }
  const blocks = /\n[ \t]*\n/u.test(source) || nodes.some((node) =>
    BLOCK_KINDS.has(node.kind) || node.command === "item" || (node.kind === "atom" && tree.text.startsWith("\\begin", node.span.from)));
  if (blocks && (mode === "math" || title || !holdsParagraphs(view, caret.slot))) {
    return false;
  }
  // `\item` outside a list of the copy itself goes only into a list.
  const looseItem = nodes.some((node) => node.command === "item" && !insideList(tree, node.id));
  if (looseItem && !inListFlow(view, caret.slot)) {
    return false;
  }
  const lists = nodes.filter((node) => node.kind === "list");
  if (lists.some((node) => listDepth(tree, node.id) + listDepthAt(view, caret.slot) > BEAMER_LIST_DEPTH)) {
    return false;
  }
  if (nodes.some((node) => node.kind === "break") && !(lineEndable(view, caret, at) || inAlignment(view, caret.slot))) {
    return false;
  }
  return true;
}

/** Whether a slot takes paragraphs: a flow, or a paragraph directly in one (not inside a wrapper, cell or title). */
function holdsParagraphs(view: EditView, slot: SlotId): boolean {
  const { tree } = view;
  const record = tree.slots[slot];
  if (record.mode !== "text") {
    return false;
  }
  const owner = tree.nodes[record.node];
  return record.flow || (owner.kind === "paragraph" && owner.parent != null && tree.slots[owner.parent].flow);
}

function insideList(tree: EditTree, node: NodeId): boolean {
  for (let slot = tree.nodes[node].parent; slot != null; slot = tree.nodes[tree.slots[slot].node].parent) {
    if (tree.nodes[tree.slots[slot].node].kind === "list") {
      return true;
    }
  }
  return false;
}

/** Lists around a node and itself. */
function listDepth(tree: EditTree, node: NodeId): number {
  let depth = tree.nodes[node].kind === "list" ? 1 : 0;
  for (let slot = tree.nodes[node].parent; slot != null; slot = tree.nodes[tree.slots[slot].node].parent) {
    depth += tree.nodes[tree.slots[slot].node].kind === "list" ? 1 : 0;
  }
  return depth;
}

function listDepthAt(view: EditView, slot: SlotId): number {
  return listDepth(view.tree, view.tree.slots[slot].node);
}

/**
 * Outside text (R15, O6): literal. In prose every TeX special is escaped,
 * and blank lines become paragraph breaks where paragraphs go (spaces
 * elsewhere); in math characters keep their math meaning except those
 * that would break the formula.
 */
function convertPlain(place: Place, plain: string): string | null {
  const text = plain.replace(/\r\n?/gu, "\n").replace(/\t/gu, " ");
  if (text === "") {
    return null;
  }
  const line = (part: string) => part.replace(/[ ]*\n\s*/gu, " ");
  if (place.mode === "math") {
    return escapeMath(place, line(text));
  }
  const paragraphs = !place.title && holdsParagraphs(place.view, place.caret.slot)
    ? text.split(/\n[ \t]*\n\s*/u).filter((part) => part.trim() !== "")
    : [text];
  const joined = paragraphs.map((part) => escapeText(line(part))).join("\n\n");
  return joined === "" ? " " : joined;
}

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "$": "\\$", "%": "\\%", "#": "\\#", "&": "\\&",
  _: "\\_", "^": "\\^{}", "~": "\\~{}",
};

function escapeText(text: string): string {
  return text.replace(/[\\{}$%#&_^~]/gu, (char) => TEXT_ESCAPES[char]);
}

const MATH_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\backslash ", "{": "\\{", "}": "\\}", "$": "\\$", "%": "\\%", "#": "\\#", "&": "\\&",
};

/**
 * Math characters for outside text. A `^` or `_` stays a script only with
 * a base before it in the pasted text and an argument after (`x^2`,
 * `a_{10}`), once per base; otherwise it is shown as itself.
 */
function escapeMath(place: Place, text: string): string {
  let result = "";
  /** The scripts the base just written has. */
  let scripts = new Set<string>();
  let base = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "^" || char === "_") {
      const argument = /^(?:\d+|[A-Za-z])/u.exec(text.slice(index + 1))?.[0];
      if (base && argument && !scripts.has(char)) {
        result += `${char}${argument.length > 1 ? `{${argument}}` : argument}`;
        scripts.add(char);
        index += argument.length;
        continue;
      }
      result += char === "_" ? "\\_" : "\\text{\\textasciicircum}";
      base = false;
      scripts = new Set();
      continue;
    }
    if (char === "'") {
      // A prime is a superscript: after one, it needs a base of its own.
      const first = index === 0 && afterSuperscript(place.view, place.caret);
      result += scripts.has("^") || first ? "{}'" : "'";
      scripts = new Set();
      base = true;
      continue;
    }
    result += MATH_ESCAPES[char] ?? char;
    base = /[A-Za-z0-9)\]|]/u.test(char);
    scripts = new Set();
  }
  return result;
}

/** `]` at brace depth 0 would end an optional argument (or a title, read as one): it goes in braces. */
function protectClosingBrackets(source: string): string {
  let depth = 0;
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      result += source.slice(index, index + 2);
      index += 1;
      continue;
    }
    depth += char === "{" ? 1 : char === "}" ? -1 : 0;
    result += char === "]" && depth === 0 ? "{]}" : char;
  }
  return result;
}

/**
 * What goes between the source before the caret and the pasted text: a
 * control word's terminator (R5), and `{}` where a `[` or `<` would be
 * read as the optional argument or overlay specification of what is
 * before (K9), or a `'` as a second superscript.
 */
function startSeam(place: Place, source: string): string {
  const { view, at, mode } = place;
  const text = view.tree.text;
  const first = source.trimStart()[0];
  const before = skipSpacesBack(text, at);
  if (first === "[" && (optionalArgumentAhead(view, at) || (mode === "text" && endsWithControlWord(text, before)))) {
    return "{}";
  }
  if (first === "<" && SPEC_READER_BEFORE.test(text.slice(0, before))) {
    return "{}";
  }
  if (mode === "math" && source.startsWith("'") && afterSuperscript(view, place.caret)) {
    return "{}";
  }
  const letter = mode === "math" ? /^[A-Za-z@]/u : /^[A-Za-z@ ]/u;
  if (letter.test(source) && endsWithControlWord(text, at)) {
    return mode === "math" ? " " : "{}";
  }
  return "";
}
