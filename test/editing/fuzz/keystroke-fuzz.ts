import type { CommandTable } from "../../../packages/core/src/editing/commands/index.js";
import type { Intent } from "../../../packages/core/src/editing/input/index.js";
import { valueEditorFields, type ValueField } from "../../../packages/core/src/editing/operations/index.js";
import { itemRole } from "../../../packages/core/src/editing/ownership/kinds.js";
import type { EditView } from "../../../packages/core/src/editing/position/index.js";
import { formatMarkedSource, parseScenarioKeys } from "../../../packages/core/src/editing/testing/index.js";
import { checkEditTree } from "../../../packages/core/src/editing/tree/invariants.js";
import { isLeaf } from "../../../packages/core/src/editing/tree/navigate.js";
import type { EditTree, EditTreeDiagnosticCode, Span } from "../../../packages/core/src/editing/tree/types.js";
import type { CorpusScope } from "../beamer-corpus.js";
import { KeystrokeSession, type FuzzKey } from "./keystroke-session.js";

/**
 * Keystroke fuzzing of canvas editing: random key sequences on real scope
 * buffers, through the app's edit machine and the resolver, with the
 * contracts of design/canvas-keyboard-scenarios.md checked after every key.
 *
 * A key sequence is a list of tokens: scenario keys (`a`, `⌫`, `⇧→`, `⌘Z`,
 * `\frac` typed letter by letter) or clicks (`@12`, `@12:20`), which set the
 * selection to caret stops as a pointer would. A failure is shrunk to a
 * minimal sequence and printed as a replayable case.
 */

export type FuzzStart = {
  /** Where the buffer comes from, for reports. */
  readonly label: string;
  readonly text: string;
  readonly commands: CommandTable;
  /** A frame title: one line, no paragraph breaks. */
  readonly title?: boolean;
  /** A frame body, right after `\begin{frame}` and its header. */
  readonly frameBody?: boolean;
  /** The deck the buffer is a scope of, to compile edited states in (see tex-oracle.ts). */
  readonly deck?: {
    readonly path: string;
    readonly source: string;
    readonly span: Span;
    /** The deck's frames, and the one the buffer is in. */
    readonly frames: readonly Span[];
    readonly frame: number;
  };
};

/** Fuzz starts from corpus scopes. */
export function corpusStarts(scopes: readonly CorpusScope[]): FuzzStart[] {
  return scopes.map((scope) => ({
    label: `${scope.file} frame ${scope.frameIndex + 1} ${scope.kind}`,
    text: scope.text,
    commands: scope.commands,
    title: scope.kind === "frame-title",
    // (A column body's start is read by `\begin{column}{width}` before it, as a frame body's by `\begin{frame}`.)
    frameBody: scope.kind === "frame-body" || scope.kind === "column",
    deck: { path: scope.path, source: scope.source, span: scope.span, frames: scope.frames, frame: scope.frameIndex },
  }));
}

export type FuzzCase = {
  readonly start: FuzzStart;
  readonly anchor: number;
  readonly focus: number;
  readonly tokens: readonly string[];
};

export type FuzzFailure = {
  readonly invariant: string;
  readonly message: string;
  /** The index of the token after which the invariant failed (-1: at the end of the sequence). */
  readonly step: number;
  /** The buffer when it failed. */
  readonly text: string;
};

// --- Random --------------------------------------------------------------

/** A small seeded generator (mulberry32), so cases replay exactly. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

// --- Generation ----------------------------------------------------------

/**
 * Token families and their weights. Specials and structure keys are
 * over-represented on purpose: they are where the rules live.
 */
const FAMILIES: readonly (readonly [number, readonly string[]])[] = [
  [18, ["a", "b", "x", "n", "i", "e", "s", "A", "B", "1", "2", "+", "=", ",", ".", "(", ")", "'"]],
  [6, ["␣"]],
  [14, ["$", "{", "}", "[", "]", "^", "_", "%", "&", "#", "~"]],
  [10, [
    "\\frac", "\\alpha", "\\in", "\\textbf", "\\emph", "\\left", "\\sqrt", "\\LaTeX", "\\bf", "\\foo",
    "\\text", "\\sum", "\\mathbb", "\\cup", "\\ldots", "\\item", "\\{", "\\}", "\\\\", "\\%", "\\,", "\\$",
    "\\setm", "\\te",
  ]],
  // Punctuation real decks use (from a survey of public Beamer decks): overlay brackets, dashes, quotes, bars.
  [8, ["<", ">", "-", "`", "\"", "|", "*", ";", ":", "!", "?", "/", "@"]],
  // The commands most frames use.
  [6, [
    "\\pause", "\\only", "\\alert", "\\textcolor", "\\vspace", "\\hfill", "\\newline", "\\url", "\\footnote", "\\hline",
    "\\small", "\\textit", "\\texttt", "\\cite", "\\label", "\\uncover", "\\medskip", "\\color", "\\mbox",
    "\\href", "\\hspace", "\\ref", "\\colorbox",
  ]],
  [4, [
    "\\hat", "\\vec", "\\mathcal", "\\mathrm", "\\underbrace", "\\leq", "\\to", "\\cdot", "\\quad", "\\operatorname",
    "\\displaystyle", "\\notag",
  ]],
  // Sequences random keys almost never type: overlay specifications, spacing, labels, dashes and quotes.
  [4, ["<2->", "<+->", "[<+->]", "\\\\[2pt]", "\\item[", "\\item<2->", "--", "---", "``", "''", "{}", "{\\bf"]],
  [16, ["⌫", "⌦"]],
  [6, ["⏎", "⇧⏎"]],
  [5, ["⇥", "⇧⇥"]],
  // Home/End and ↑/↓ read the rendered rows, which this harness does not have.
  [14, ["←", "→", "⇧←", "⇧→"]],
  [3, ["Esc"]],
  [4, ["⌘Z", "⇧⌘Z"]],
  [2, ["⌘B", "⌘I"]],
  [1, ["⏸"]],
  [7, ["@click"]],
  // The clipboard: copies of what is on the canvas, and text from outside.
  [6, ["@copy", "@copy", "@cut", "@paste", "@paste", "@paste-text"]],
  // Clicks at a slot's or block's edge, where most rules apply (item starts, slot ends).
  [5, ["@edge"]],
  // Values already written, edited through their tag (O8).
  [2, ["@setvalue"]],
  // A deletion right at a block's edge: joins, merges, labels.
  [4, ["@block ⌫", "@block ⌦", "@edge ⌫", "@edge ⌦", "@block ⏎", "@block ⇥"]],
];

const TOTAL_WEIGHT = FAMILIES.reduce((sum, [weight]) => sum + weight, 0);

/** After a chip-opening `\name`, how it ends: the commit keys, or nothing (the next token decides). */
const CHIP_ENDINGS = ["␣", "⇥", "⏎", "{", "[", "", "", "Esc", "⌫"];

function randomTokens(random: () => number): string[] {
  let roll = random() * TOTAL_WEIGHT;
  for (const [weight, tokens] of FAMILIES) {
    roll -= weight;
    if (roll < 0) {
      const token = pick(random, tokens);
      const ending = /^\\[A-Za-z]+$/u.test(token) ? pick(random, CHIP_ENDINGS) : "";
      // A commit may open the value editor (O8): mostly filled, the next token deciding otherwise.
      const filled = ending && ending !== "Esc" && ending !== "⌫" && random() < 0.7 ? ["@pick"] : [];
      return ending ? [token, ending, ...filled] : token.split(" ");
    }
  }
  return [FAMILIES[0][1][0]];
}

/** A random case: a start, a caret on a stop, and `length` tokens (clicks still unresolved). */
export function generateCase(random: () => number, starts: readonly FuzzStart[], length: number): FuzzCase {
  const start = pick(random, starts);
  const session = new KeystrokeSession(start.text, start.commands, 0);
  const view = session.view();
  const roll = random();
  const stops = (roll < 0.2 ? blockStops(view) : roll < 0.4 ? edgeStops(view) : view.stops).map((stop) => view.offset(stop));
  const caret = stops.length > 0 ? pick(random, stops) : 0;
  const tokens: string[] = [];
  while (tokens.length < length) {
    tokens.push(...randomTokens(random));
  }
  return { start, anchor: caret, focus: caret, tokens };
}

/**
 * Clicks are resolved against the buffer at the time they happen: `@click`
 * becomes `@n` (a caret) or `@n:m` (a selection) on caret stops, chosen
 * from the token's own seed so that shrinking keeps them stable.
 */
function resolveClick(token: string, session: KeystrokeSession, index: number): FuzzKey {
  const view = session.view();
  const match = /^@(\d+)(?::(\d+))?$/u.exec(token);
  if (match) {
    // A click lands on a caret stop, also when shrinking moved the text under it.
    const snap = (offset: number) => view.offset(view.positionAt(Math.min(offset, session.text.length)));
    const anchor = snap(Number(match[1]));
    return { kind: "select", anchor, focus: match[2] == null ? anchor : snap(Number(match[2])) };
  }
  const random = createRandom(hash(session.text) ^ index);
  const pool = token === "@edge" ? edgeStops(view) : token === "@block" ? blockStops(view) : view.stops;
  const offsets = pool.map((stop) => view.offset(stop));
  const anchor = offsets.length > 0 ? pick(random, offsets) : 0;
  const focus = random() < 0.3 && offsets.length > 0 ? pick(random, offsets) : anchor;
  return { kind: "select", anchor, focus };
}

/** Stops at the start or end of a paragraph or item. */
function blockStops(view: EditView) {
  const blocks = edgeStops(view).filter((stop) => ["paragraph", "item"].includes(view.tree.nodes[view.tree.slots[stop.slot].node].kind));
  return blocks.length > 0 ? blocks : edgeStops(view);
}

/** Stops at the start or end of their slot. */
function edgeStops(view: EditView) {
  const edges = view.stops.filter((stop) => stop.index === 0 || stop.index === view.tree.slots[stop.slot].children.length);
  return edges.length > 0 ? edges : view.stops;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return value >>> 0;
}

/**
 * Text pasted from outside: specials, brackets the commands around may
 * read, newlines and blank lines, scripts in and out of place.
 */
export const OUTSIDE_TEXTS = [
  "Costs rose 50% at R&D",
  "$x^2$ and \\alpha",
  "a_b^c",
  "{braces} [brackets] <angles>",
  "line one\nline two",
  "first part\n\nsecond part",
  "~tilde # hash",
  "x^10 + y_i'",
  "]",
  "[draft] note",
  "<2-> later",
  "\\\\",
  "C:\\dir\\file",
  "  spaced  ",
  "f'(x)^2",
  "e^ix",
  "tab\tseparated",
  "\n\n\n- dash\n",
  "word",
  "x",
] as const;

/**
 * Values the editor fills in that TeX accepts in a beamer frame, by the
 * command and its field (null: none the fuzzer can give, so it cancels).
 */
function valueChoices(command: string, field: ValueField, model: boolean): readonly string[] | null {
  switch (`${command}:${field.argument}`) {
    case "multicolumn:0":
      return ["1", "2"];
    case "scalebox:0":
      return ["1.5"];
    case "rotatebox:1":
      return ["90"];
    case "setlength:0":
    case "addtolength:0":
      return ["\\parskip", "\\itemsep"];
    case "includegraphics:2":
      return ["example-image"];
    case "footnote:2":
      return ["A note.", "50\\% more"];
    case "setbeamertemplate:0":
      return ["navigation symbols"];
    case "setbeamercolor:0":
      return ["structure"];
    case "setbeamercolor:1":
      return ["fg=red"];
    case "setbeamerfont:0":
      return ["title"];
    case "setbeamerfont:1":
      return ["size=\\small"];
    case "setbeamercovered:0":
      return ["transparent"];
  }
  if (["newcommand", "renewcommand", "sideset", "substack", "genfrac", "emoji", "qrcode", "bibitem"].includes(command)) {
    return null;
  }
  switch (field.kind) {
    case "color":
      return model ? ["0.2,0.4,0.6"] : ["red", "blue!50", "red!30!black", "teal"];
    case "url":
      return ["https://example.org", "https://example.org/a%20b#part", "https://example.org/~me/a_b"];
    case "dimension":
      return command === "hspace" || command === "vspace" ? ["1em", "-2pt", "\\fill", "1em plus 1fil"] : ["1em", "-2pt", "0.5\\textwidth", "3mm"];
    case "label-key":
      return ["sec:intro", "fig:a-1"];
    case "overlay":
      return ["", "2-", "+-", "1-3"];
    case "options":
      return command === "textcolor" || command === "color" || command === "colorbox" ? ["", "rgb"] : [""];
    case "spec":
      return ["c", "l"];
    case "value":
      // (Accents take a letter; other values mean something the fuzzer does not know.)
      return field.optional ? [""] : ["c", "v", "u", "H", "r", "k", "b", "d", "t"].includes(command) ? ["o"] : null;
  }
}

/** Values for the open value editor's fields, chosen by `seed`; null when the fuzzer has none. */
function pickedValues(session: KeystrokeSession, seed: number): string[] | null {
  const picker = session.picker();
  const editor = picker ? valueEditorFields(session.commands, session.view(), picker.at, picker.name, picker.key) : null;
  if (!picker || !editor) {
    return null;
  }
  const random = createRandom(seed);
  const values: string[] = [];
  for (const field of editor.fields) {
    const model = values.some((value, index) => editor.fields[index].open === "[" && value !== "");
    const choices = valueChoices(picker.name, field, model && field.kind === "color");
    if (!choices) {
      return null;
    }
    values.push(pick(random, choices));
  }
  return values;
}

/** An edit of a value already written, chosen by `seed`: one the fuzzer has a valid replacement for. */
function valueEdit(session: KeystrokeSession, seed: number): FuzzKey | null {
  const { tree } = session.view();
  const random = createRandom(seed);
  // (Not overprint's `\onslide` specifications, which must not overlap: overlays are still to be designed.)
  const overprint = (node: { span: { from: number; to: number } }) => tree.nodes.some((outer) => outer.span.from < node.span.from &&
    outer.span.to > node.span.to && tree.text.startsWith("\\begin{overprint}", outer.span.from));
  const candidates = tree.nodes.flatMap((node) => node.command == null || (node.command === "onslide" && overprint(node)) ? []
    : node.values.map((value, index) => ({ node, value, index })));
  if (candidates.length === 0) {
    return null;
  }
  const { node, value } = pick(random, candidates);
  const schema = session.commands.command(node.command!, tree.slots[node.parent ?? 0]?.mode === "math" ? "math" : "text");
  const open = value.span.from < value.contentSpan.from ? tree.text[value.span.from] : "";
  // The argument the value is: the first of its kind and delimiter.
  const argument = schema?.args.findIndex((arg) => !arg.rendered && arg.role === value.role && (arg.kind === "mandatory") === (open !== "[" && open !== "<")) ?? -1;
  const model = node.values.some((other) => tree.text[other.span.from] === "[" && other.span.to <= value.span.from);
  const choices = valueChoices(node.command!, { argument, kind: value.role, optional: open === "[" || open === "<", open, close: "" }, model && value.role === "color");
  if (!choices) {
    return null;
  }
  return { kind: "setValues", edits: [{ span: value.contentSpan, text: pick(random, choices) }] };
}

/** The keys a token stands for. */
function keysOf(token: string, session: KeystrokeSession, index: number): FuzzKey[] {
  if (token === "@pick" || token === "@setvalue") {
    return keysOf(`${token}:${hash(session.text) ^ index}`, session, index);
  }
  const valued = /^@(pick|setvalue):(-?\d+)$/u.exec(token);
  if (valued) {
    const seed = Number(valued[2]);
    if (valued[1] === "setvalue") {
      const edit = valueEdit(session, seed);
      return edit ? [edit] : [];
    }
    const values = session.pickerOpen() ? pickedValues(session, seed) : null;
    if (!session.pickerOpen()) {
      return [];
    }
    return values ? [{ kind: "pick", values, viaBrace: seed % 2 === 0 }] : parseScenarioKeys("Esc");
  }
  switch (token) {
    case "@copy":
    case "@cut":
      return [{ kind: token === "@copy" ? "copy" : "cut" }];
    case "@paste":
      return [{ kind: "paste" }];
    case "@paste-text":
      return [{ kind: "paste", plain: pick(createRandom(hash(session.text) ^ index), OUTSIDE_TEXTS) }];
  }
  const pasted = /^@paste-text:(\d+)$/u.exec(token);
  if (pasted) {
    return [{ kind: "paste", plain: OUTSIDE_TEXTS[Number(pasted[1]) % OUTSIDE_TEXTS.length] }];
  }
  if (token.startsWith("@")) {
    return [resolveClick(token, session, index)];
  }
  // A lone `␣` is typed text, as inside a word.
  return token === "␣" ? [{ kind: "text", text: " " }] : parseScenarioKeys(token);
}

// --- Invariants ----------------------------------------------------------

/** Diagnostics an edit must never add: the source stays balanced (R3) and well-formed. */
const BALANCE: ReadonlySet<EditTreeDiagnosticCode> = new Set([
  "unclosed-group", "unclosed-math", "unclosed-environment", "unmatched-close", "double-script", "text-before-first-item",
]);

function diagnosticCounts(tree: EditTree): Map<EditTreeDiagnosticCode, number> {
  const counts = new Map<EditTreeDiagnosticCode, number>();
  for (const diagnostic of tree.diagnostics) {
    if (BALANCE.has(diagnostic.code)) {
      counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
    }
  }
  return counts;
}

/** Display math written with `$$`: an inline formula left empty turns into one. */
function dollarDisplays(tree: EditTree): number {
  return tree.nodes.filter((node) => (node.kind === "display" || node.kind === "formula") && tree.text.startsWith("$$", node.span.from)).length;
}

/** Table rules: structure between rows (the tree binds them by position), not text. */
const TABLE_RULES = /^\\(?:hline|cline|toprule|midrule|bottomrule|specialrule|cmidrule|addlinespace)\b/u;

/** What the reader sees, item by item in source order: the visible leaves (spaces and line breaks aside), with their spans. */
type Item = { readonly key: string; readonly from: number; readonly to: number };

function visibleItems(view: EditView): Item[] {
  const { tree } = view;
  const items: Item[] = [];
  // A rule's optional width (`\midrule[.2pt]`) is part of the rule wherever it is bound.
  const ruleArguments: { from: number; to: number }[] = [];
  for (const node of tree.nodes) {
    const source = tree.text.slice(node.span.from, node.span.to);
    if (TABLE_RULES.test(source) && tree.text[node.span.to] === "[") {
      const close = tree.text.indexOf("]", node.span.to);
      ruleArguments.push({ from: node.span.to, to: close < 0 ? node.span.to : close + 1 });
    }
  }
  for (const node of tree.nodes) {
    if (ruleArguments.some((range) => node.span.from >= range.from && node.span.to <= range.to)) {
      continue;
    }
    if (node.id === tree.root || !isLeaf(tree, node.id) || node.kind === "space" || node.kind === "break") {
      continue;
    }
    if (view.role(node.id) === "invisible" || itemRole(tree, node.id) === "flow" || TABLE_RULES.test(tree.text.slice(node.span.from, node.span.to))) {
      continue;
    }
    items.push({ key: tree.text.slice(node.span.from, node.span.to), from: node.span.from, to: node.span.to });
  }
  return items.sort((left, right) => left.from - right.from);
}

function keys(items: readonly Item[]): string[] {
  return items.map((item) => item.key);
}

/** The items of `before` missing from `after`, and the items `after` adds, around their common prefix and suffix. */
function difference(before: readonly string[], after: readonly string[]): { removed: string[]; added: string[] } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { removed: before.slice(prefix, before.length - suffix), added: after.slice(prefix, after.length - suffix) };
}

/** What a key may do to the visible items, by the intent it became. */
type ContentRule = "unchanged" | "adds" | "deletes-one" | "replaces-selection" | "any";

function contentRule(intent: Intent | null, hadSelection: boolean, chipOpen: boolean): ContentRule {
  if (!intent) {
    return "unchanged";
  }
  if (intent.type === "setValues") {
    // A value edited through its tag, whatever it shows.
    return "any";
  }
  if (chipOpen) {
    // The chip commits on ␣, ⏎, ⇥, arrows and characters; letters, ⌫ and Esc only edit it.
    if (intent.type === "deleteBackward" || intent.type === "deleteForward" || intent.type === "escape") {
      return "unchanged";
    }
    return hadSelection ? "replaces-selection" : "adds";
  }
  switch (intent.type) {
    case "insertText":
    case "paste":
    case "pickValues":
      return hadSelection ? "replaces-selection" : "adds";
    case "deleteBackward":
    case "deleteForward":
      return hadSelection ? "replaces-selection" : "deletes-one";
    case "enter":
      return hadSelection ? "replaces-selection" : "unchanged";
    case "cut":
      return "replaces-selection";
    case "undo":
    case "redo":
    case "compose":
      return "any";
    case "tab":
    case "move":
    case "format":
    case "color":
    case "escape":
      return "unchanged";
  }
}

function checkContent(
  rule: ContentRule,
  allBefore: readonly Item[],
  after: readonly Item[],
  selection: { from: number; to: number }
): string | null {
  // With the caret inside an item (a value argument, `\footnote{‸}`), the item is edited in place.
  const caret = selection.from;
  if (selection.from === selection.to && allBefore.some((item) => item.from < caret && caret < item.to)) {
    return null;
  }
  const before = allBefore;
  const { removed, added } = difference(keys(before), keys(after));
  switch (rule) {
    case "any":
      return null;
    case "unchanged":
      return removed.length || added.length ? `visible items changed: -[${removed.join(" ")}] +[${added.join(" ")}]` : null;
    case "adds":
      return removed.length ? `typing removed visible items: [${removed.join(" ")}]` : null;
    case "deletes-one":
      // R9: never more than one visible item without showing it first.
      if (added.length) {
        return `deleting added visible items: [${added.join(" ")}]`;
      }
      return removed.length > 1 ? `one keystroke deleted ${removed.length} visible items: [${removed.join(" ")}]` : null;
    case "replaces-selection": {
      // Everything outside the selection survives, in order.
      const outside = before.filter((item) => item.to <= selection.from || item.from >= selection.to);
      const kept = difference(keys(outside), keys(after));
      return kept.removed.length ? `items outside the selection went: [${kept.removed.join(" ")}]` : null;
    }
  }
}

/** Checks one step; returns the first broken invariant. */
function checkStep(
  session: KeystrokeSession,
  intent: Intent | null,
  before: {
    text: string;
    items: Item[];
    diagnostics: Map<EditTreeDiagnosticCode, number>;
    displays: number;
    selection: { from: number; to: number };
    chipOpen: boolean;
    /** Where commands miss an argument (the offset after them). */
    missing: number[];
  }
): Omit<FuzzFailure, "step" | "text"> | null {
  const view = session.view();
  const { tree } = view;
  const structural = checkEditTree(tree);
  if (structural.length > 0) {
    return { invariant: "tree", message: structural.slice(0, 3).join("; ") };
  }
  const history = intent?.type === "undo" || intent?.type === "redo";
  if (!history) {
    const counts = diagnosticCounts(tree);
    for (const [code, count] of counts) {
      if (count > (before.diagnostics.get(code) ?? 0)) {
        const diagnostic = tree.diagnostics.find((candidate) => candidate.code === code)!;
        return { invariant: "balance", message: `${code} at ${diagnostic.span.from}: ${diagnostic.message}` };
      }
    }
    if (dollarDisplays(tree) > before.displays) {
      return { invariant: "balance", message: "an inline formula turned into $$ display math" };
    }
    const rule = contentRule(intent, before.selection.to > before.selection.from, before.chipOpen);
    // A command still missing its argument takes what is typed next to it, as TeX reads it (`\b` then `\text`).
    const waiting = new Set(before.missing.filter((offset) => offset === before.selection.from));
    const typing = rule === "adds" || rule === "replaces-selection";
    const items = typing ? before.items.filter((item) => !waiting.has(item.to)) : before.items;
    const content = checkContent(rule, items, visibleItems(view), before.selection);
    if (content) {
      return { invariant: "content", message: content };
    }
  }
  // The selection the machine holds is inside the buffer, and its recorded positions are its own.
  const { anchor, focus } = session.selection;
  if (anchor < 0 || focus < 0 || anchor > session.text.length || focus > session.text.length) {
    return { invariant: "caret", message: `selection ${anchor}:${focus} outside the buffer` };
  }
  const recorded = session.state.treeSelection;
  if (recorded?.ends && recorded.text === session.text) {
    for (const end of [recorded.ends.anchor, recorded.ends.focus]) {
      if (!tree.slots[end.slot] || end.index > tree.slots[end.slot].children.length) {
        return { invariant: "caret", message: `recorded position ${end.slot}:${end.index} is not in the tree` };
      }
    }
  }
  const interaction = session.interaction();
  if (history && (interaction.chip || interaction.picker || interaction.placeholder != null || interaction.pending != null)) {
    // O7: undo and redo restore source and selection, never editing state.
    return { invariant: "undo", message: "undo or redo brought back interaction state" };
  }
  if (interaction.placeholder != null && session.text.slice(interaction.placeholder, interaction.placeholder + 2) !== "{}") {
    return { invariant: "interaction", message: `placeholder at ${interaction.placeholder} is not {}` };
  }
  return null;
}

// --- Running -------------------------------------------------------------

export type FuzzRun = {
  readonly failure: FuzzFailure | null;
  /** The tokens with clicks resolved, for replay. */
  readonly tokens: readonly string[];
  readonly finalText: string;
  /** The buffer after each token. */
  readonly states: readonly string[];
  /** Keys that changed the source. */
  readonly edits: number;
  /** Values the value editor wrote (O8), as `writtenValues` lists them. */
  readonly picked: readonly string[];
};

/** The values a buffer holds: `command role content`, one per value argument. */
export function writtenValues(view: EditView): string[] {
  const { tree } = view;
  return tree.nodes.flatMap((node) =>
    node.values.map((value) => `${node.command ?? node.kind} ${value.role} ${tree.text.slice(value.contentSpan.from, value.contentSpan.to).trim()}`));
}

/** Runs a case, checking every step, then undoes everything and redoes it. */
export function runCase(fuzz: FuzzCase): FuzzRun {
  const { start } = fuzz;
  const session = new KeystrokeSession(start.text, start.commands, fuzz.anchor, fuzz.focus, start.title, start.frameBody);
  const initial = session.view();
  const resolved: string[] = [];
  const states: string[] = [];
  let edits = 0;
  const picked: string[] = [];
  const fail = (failure: Omit<FuzzFailure, "step" | "text">, step: number): FuzzRun =>
    ({ failure: { ...failure, step, text: session.text }, tokens: resolved, finalText: session.text, states, edits, picked });
  let diagnostics = diagnosticCounts(initial.tree);
  for (let index = 0; index < fuzz.tokens.length; index += 1) {
    const token = fuzz.tokens[index];
    const keysForToken = keysOf(token, session, index);
    const head = keysForToken[0];
    resolved.push(head?.kind === "select" ? (head.anchor === head.focus ? `@${head.anchor}` : `@${head.anchor}:${head.focus}`)
      : head?.kind === "paste" && head.plain != null ? `@paste-text:${OUTSIDE_TEXTS.indexOf(head.plain as never)}`
      : token === "@pick" || token === "@setvalue" ? `${token}:${hash(session.text) ^ index}` : token);
    for (const key of keysForToken) {
      const view = session.view();
      const { anchor, focus } = session.selection;
      const before = {
        text: session.text,
        items: visibleItems(view),
        diagnostics,
        displays: dollarDisplays(view.tree),
        selection: { from: Math.min(anchor, focus), to: Math.max(anchor, focus) },
        chipOpen: session.chipOpen(),
        missing: view.tree.diagnostics.filter((diagnostic) => diagnostic.code === "missing-argument").map((diagnostic) => diagnostic.span.from),
      };
      let intent: Intent | null;
      try {
        intent = session.press(key);
      } catch (error) {
        return fail({ invariant: "exception", message: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) }, index);
      }
      if (session.text !== before.text) {
        edits += 1;
        if (key.kind === "pick" || key.kind === "setValues") {
          const left = writtenValues(view);
          picked.push(...writtenValues(session.view()).filter((value) => {
            const index = left.indexOf(value);
            return index < 0 || left.splice(index, 1).length === 0;
          }));
        }
      }
      let broken: Omit<FuzzFailure, "step" | "text"> | null;
      try {
        broken = checkStep(session, intent, before);
      } catch (error) {
        broken = { invariant: "exception", message: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error) };
      }
      if (broken) {
        return fail(broken, index);
      }
      if (intent?.type !== "undo" && intent?.type !== "redo") {
        diagnostics = mergeCounts(diagnostics, diagnosticCounts(session.view().tree));
      }
    }
    states.push(session.text);
  }
  const finalText = session.text;
  // Redo all the way reaches the newest state; undo all the way returns the start; redo again returns the newest.
  const [undo] = parseScenarioKeys("⌘Z");
  const [redo] = parseScenarioKeys("⇧⌘Z");
  const drain = (key: typeof undo, depth: () => number) => {
    for (let guard = 0; depth() > 0 && guard < 1000; guard += 1) {
      session.press(key);
    }
  };
  drain(redo, () => session.redoDepth);
  const newest = session.text;
  drain(undo, () => session.undoDepth);
  if (session.text !== start.text) {
    return fail({ invariant: "undo", message: "undoing every step did not restore the start" }, -1);
  }
  drain(redo, () => session.redoDepth);
  if (session.text !== newest) {
    return fail({ invariant: "undo", message: "redoing every step did not restore the newest state" }, -1);
  }
  return { failure: null, tokens: resolved, finalText, states, edits, picked };
}

/** Diagnostics allowed from here on: those of the start, and any the source already had. */
function mergeCounts(
  allowed: Map<EditTreeDiagnosticCode, number>,
  now: Map<EditTreeDiagnosticCode, number>
): Map<EditTreeDiagnosticCode, number> {
  const merged = new Map(allowed);
  for (const [code, count] of now) {
    merged.set(code, Math.max(merged.get(code) ?? 0, count));
  }
  return merged;
}

// --- Shrinking -----------------------------------------------------------

/**
 * Shrinks a failing case: drops chunks of tokens while the same invariant
 * still fails (delta debugging), then single tokens, then tries to start
 * from a smaller buffer around the caret.
 */
export function shrinkCase(fuzz: FuzzCase, invariant: string): FuzzCase {
  const fails = (candidate: FuzzCase) => runCase(candidate).failure?.invariant === invariant;
  // Resolve clicks first, so that removing tokens keeps their targets.
  let current: FuzzCase = { ...fuzz, tokens: runCase(fuzz).tokens };
  const failing = runCase(current).failure;
  if (failing && failing.step >= 0) {
    current = { ...current, tokens: current.tokens.slice(0, failing.step + 1) };
  }
  for (let chunk = Math.ceil(current.tokens.length / 2); chunk >= 1; chunk = Math.floor(chunk / 2)) {
    for (let at = 0; at < current.tokens.length;) {
      const candidate = { ...current, tokens: [...current.tokens.slice(0, at), ...current.tokens.slice(at + chunk)] };
      if (candidate.tokens.length > 0 && fails(candidate)) {
        current = candidate;
      } else {
        at += chunk;
      }
    }
  }
  return current;
}

/** A failing case as text: the start with its caret, the keys, and what broke. */
export function describeCase(fuzz: FuzzCase, failure: FuzzFailure): string {
  const body = formatMarkedSource(fuzz.start.text, { anchor: fuzz.anchor, focus: fuzz.focus });
  const clicks = fuzz.tokens.some((token) => token.startsWith("@"));
  return [
    `${failure.invariant}: ${failure.message.split("\n")[0]}`,
    `  start: ${fuzz.start.label}`,
    `  keys: ${JSON.stringify(fuzz.tokens.join(" "))}${clicks ? " (@n: a click selecting buffer offset n)" : ""}`,
    `  body: ${JSON.stringify(body)}`,
    `  then: ${JSON.stringify(failure.text)}`,
  ].join("\n");
}

// --- Campaigns -----------------------------------------------------------

export type CampaignResult = {
  /** Shrunk failing cases, described. */
  readonly failures: readonly string[];
  /** The invariants that failed. */
  readonly invariants: readonly string[];
  /** Keys that changed the source, over all cases. */
  readonly edits: number;
};

/** Runs `cases` random cases from a seed, stopping after `maxFailures`. */
export function runCampaign(options: {
  readonly starts: readonly FuzzStart[];
  readonly seed: number;
  readonly cases: number;
  readonly length: number;
  readonly maxFailures?: number;
  readonly shrink?: boolean;
}): CampaignResult {
  const random = createRandom(options.seed);
  const failures: string[] = [];
  const invariants: string[] = [];
  let edits = 0;
  for (let index = 0; index < options.cases && failures.length < (options.maxFailures ?? 3); index += 1) {
    const fuzz = generateCase(random, options.starts, options.length);
    const run = runCase(fuzz);
    edits += run.edits;
    if (run.failure) {
      invariants.push(run.failure.invariant);
      const small = options.shrink === false ? fuzz : shrinkCase(fuzz, run.failure.invariant);
      failures.push(`case ${index}: ${describeCase(small, runCase(small).failure ?? run.failure)}`);
    }
  }
  return { failures, invariants, edits };
}
