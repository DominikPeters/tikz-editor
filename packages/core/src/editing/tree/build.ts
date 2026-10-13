import { beamerDocumentParser } from "@tikz-editor/lezer-tex";

import {
  getTexSyntaxIndex,
  matchTexSyntaxEnvironments,
  type TexSyntaxIndex,
  type TexSyntaxMatchedEnvironment,
} from "../../text/tex/syntax-index.js";
import { scanTexRecovery, texVirtualCloserAt } from "../../text/tex/recovery.js";
import { parseTexTabularPreamble } from "../../text/tex/tabular/parser.js";
import {
  createCommandTable,
  type ArgSchema,
  type CommandSchema,
  type CommandTable,
  type EnvironmentSchema,
} from "../commands/table.js";
import type {
  EditMode,
  EditNode,
  EditNodeKind,
  EditSlot,
  EditTree,
  EditTreeDiagnostic,
  EditTreeDiagnosticCode,
  EditValue,
  NodeId,
  SlotId,
  SlotRole,
  Span,
} from "./types.js";

/**
 * The binding layer (design/canvas-editing-architecture.md, "Binding layer
 * and EditTree"): one pass over a scope's source that decides what belongs
 * to what — command arguments (by the CommandTable, including TeX's
 * unbraced single-token arguments), script attachment (TeX's single-token
 * rule, onto the preceding item or an empty base), environments, list
 * items and alignment rows — and builds the EditTree from it.
 *
 * The syntax index is the lexical authority for matched groups and
 * environments; the binder never re-derives them. Anything it cannot bind
 * becomes an atom with a diagnostic naming the cause (principle 6).
 */
export type BuildEditTreeOptions = {
  readonly commands?: CommandTable;
};

export function buildEditTree(text: string, options: BuildEditTreeOptions = {}): EditTree {
  return new Binder(text, options.commands ?? createCommandTable()).build();
}

type MutableSpan = { from: number; to: number };
type MutableNode = Omit<EditNode, "kind" | "span" | "slots" | "delimiters" | "values" | "parent"> & {
  kind: EditNodeKind;
  span: MutableSpan;
  slots: SlotId[];
  delimiters: Span[];
  values: EditValue[];
  parent: SlotId | null;
};
type MutableSlot = Omit<EditSlot, "contentSpan" | "children"> & {
  contentSpan: MutableSpan;
  children: NodeId[];
};

/** `\item<overlay>[label]`, for list environments that do not declare their own item. */
const DEFAULT_LIST_ITEM: NonNullable<EnvironmentSchema["item"]> = {
  command: "item",
  args: [
    { kind: "overlay", rendered: false, role: "overlay" },
    { kind: "optional", rendered: true, role: "label", mode: "text" },
  ],
};

type Stop = "dollar" | "double-dollar" | "paren" | "bracket" | "right" | "cell";

/** One run of items into a slot. */
type Run = {
  readonly slot: SlotId;
  readonly mode: EditMode;
  readonly end: number;
  /** A flow slot: inline items are grouped into paragraphs. */
  readonly flow: boolean;
  /** Leading and trailing whitespace is insignificant (paragraphs, cells). */
  readonly trim: boolean;
  readonly stops: ReadonlySet<Stop>;
  paragraph: SlotId | null;
  pendingSpace: Span | null;
  /** TeX skips spaces after a control word and after a comment. */
  skipSpace: boolean;
};

const NO_STOPS: ReadonlySet<Stop> = new Set();
/** A TeX dimension: a factor and a unit or a length register (`2pt`, `-.5\\textwidth`). */
const DIMEN = String.raw`\s*[-+]?\s*(?:\d+(?:\.\d*)?|\.\d+)?\s*(?:(?:true)?(?:pt|em|ex|cm|mm|in|bp|pc|dd|cc|sp|mu|px)\b|\\[A-Za-z@]+)`;
export const GLUE = String.raw`${DIMEN}(?:\s*(?:plus|minus)\s*[-+]?\s*(?:\d+(?:\.\d*)?|\.\d+)?\s*(?:fil+\b|(?:true)?(?:pt|em|ex|cm|mm|in|bp|pc|dd|cc|sp|mu)\b|\\[A-Za-z@]+))*`;

/** The keyword syntax after TeX's rule, box and skip primitives. */
const PRIMITIVE_SPECS: Readonly<Record<string, RegExp>> = {
  vrule: new RegExp(String.raw`^(?:\s*(?:width|height|depth)${DIMEN})*`, "u"),
  hrule: new RegExp(String.raw`^(?:\s*(?:width|height|depth)${DIMEN})*`, "u"),
  hbox: new RegExp(String.raw`^(?:\s*(?:to|spread)${DIMEN})?`, "u"),
  vbox: new RegExp(String.raw`^(?:\s*(?:to|spread)${DIMEN})?`, "u"),
  vtop: new RegExp(String.raw`^(?:\s*(?:to|spread)${DIMEN})?`, "u"),
  kern: new RegExp(`^${DIMEN}`, "u"),
  hskip: new RegExp(`^${GLUE}`, "u"),
  vskip: new RegExp(`^${GLUE}`, "u"),
};

const WORD_CHAR = /[A-Za-z@]/u;
const TEXT_LIGATURE = /^(?:---?|``|'')/u;
const MULTICOLUMN = /\\multicolumn\s*\{\s*(\d+)\s*\}/uy;
/**
 * Rules between alignment rows and the arguments each takes, in order:
 * `[` an optional width, `(` a trim (`\cmidrule(lr)`), `{` a mandatory
 * argument. `\toprule` takes no braced argument: a group after it is the
 * next row's content.
 */
const RULE_COMMANDS = new Map<string, string>([
  ["hline", ""], ["toprule", "["], ["midrule", "["], ["bottomrule", "["], ["addlinespace", "["],
  ["cline", "{"], ["cmidrule", "[({"], ["specialrule", "{{{"], ["noalign", "{"],
]);
const LEAF_KINDS: ReadonlySet<EditNodeKind> = new Set([
  "char", "symbol", "atom", "space", "invisible", "declaration", "vertical", "break",
]);

class Binder {
  private readonly nodes: MutableNode[] = [];
  private readonly slots: MutableSlot[] = [];
  private readonly diagnostics: EditTreeDiagnostic[] = [];
  private readonly index: TexSyntaxIndex;
  private readonly environments: ReadonlyMap<number, TexSyntaxMatchedEnvironment>;

  constructor(
    private readonly text: string,
    private readonly table: CommandTable
  ) {
    this.index = getTexSyntaxIndex(text, beamerDocumentParser);
    this.environments = matchTexSyntaxEnvironments(this.index);
  }

  build(): EditTree {
    const root = this.node("scope", "text", { from: 0, to: this.text.length });
    const slot = this.slot(root, "flow", { from: 0, to: this.text.length }, { mode: "text", flow: true });
    this.scan(this.run(slot, "text", this.text.length, { flow: true, trim: true }), 0);
    return {
      text: this.text,
      nodes: this.nodes,
      slots: this.slots,
      root,
      diagnostics: this.diagnostics,
    };
  }

  // ---------------------------------------------------------------- records

  private node(kind: EditNodeKind, mode: EditMode, span: Span, command?: string): NodeId {
    const id = this.nodes.length;
    this.nodes.push({ id, kind, span: { ...span }, slots: [], delimiters: [], values: [], mode, command, parent: null });
    return id;
  }

  private slot(
    node: NodeId,
    role: SlotRole,
    contentSpan: Span,
    options: { mode: EditMode; flow?: boolean; braced?: boolean; presence?: "present" | "absent" }
  ): SlotId {
    const id = this.slots.length;
    this.slots.push({
      id,
      node,
      role,
      presence: options.presence ?? "present",
      contentSpan: { ...contentSpan },
      braced: options.braced ?? false,
      mode: options.mode,
      flow: options.flow ?? false,
      children: [],
    });
    this.nodes[node].slots.push(id);
    return id;
  }

  private attach(slot: SlotId, node: NodeId): void {
    this.slots[slot].children.push(node);
    this.nodes[node].parent = slot;
  }

  private delimiter(node: NodeId, from: number, to: number): void {
    if (to > from) {
      this.nodes[node].delimiters.push({ from, to });
    }
  }

  private diagnose(code: EditTreeDiagnosticCode, from: number, to: number, message: string): void {
    this.diagnostics.push({ code, span: { from, to }, message });
  }

  private run(
    slot: SlotId,
    mode: EditMode,
    end: number,
    options: { flow?: boolean; trim?: boolean; stops?: ReadonlySet<Stop> } = {}
  ): Run {
    return {
      slot,
      mode,
      end,
      flow: options.flow ?? false,
      trim: options.trim ?? false,
      stops: options.stops ?? NO_STOPS,
      paragraph: null,
      pendingSpace: null,
      skipSpace: false,
    };
  }

  // -------------------------------------------------------------- attaching

  /** Attaches an inline item, opening a paragraph in flow slots. */
  private inline(run: Run, node: NodeId): void {
    const span = this.nodes[node].span;
    let target = run.slot;
    if (run.flow) {
      if (run.paragraph == null) {
        const paragraph = this.node("paragraph", "text", span);
        this.attach(run.slot, paragraph);
        run.paragraph = this.slot(paragraph, "content", span, { mode: "text" });
        run.pendingSpace = null;
      }
      target = run.paragraph;
    }
    const pending = run.pendingSpace;
    run.pendingSpace = null;
    if (pending && (!run.trim || this.slots[target].children.length > 0)) {
      this.attach(target, this.node("space", run.mode, pending));
    }
    this.attach(target, node);
    if (run.flow) {
      const paragraphSlot = this.slots[target];
      const paragraphNode = this.nodes[paragraphSlot.node];
      paragraphNode.span.to = span.to;
      paragraphSlot.contentSpan.to = span.to;
    }
  }

  /** Attaches a block: closes any open paragraph first. */
  private block(run: Run, node: NodeId): void {
    if (!run.flow) {
      this.inline(run, node);
      return;
    }
    run.paragraph = null;
    run.pendingSpace = null;
    this.attach(run.slot, node);
  }

  /** Ends a run: trailing whitespace becomes a space only in untrimmed inline slots. */
  private finish(run: Run): void {
    if (run.pendingSpace && !run.trim && !run.flow) {
      this.attach(run.slot, this.node("space", run.mode, run.pendingSpace));
    }
    run.pendingSpace = null;
    run.paragraph = null;
  }

  private leaf(run: Run, kind: EditNodeKind, from: number, to: number, command?: string): NodeId {
    const node = this.node(kind, run.mode, { from, to }, command);
    this.inline(run, node);
    return node;
  }

  // ------------------------------------------------------------------ lexing

  private controlAt(at: number): { name: string; end: number } {
    const text = this.text;
    if (at + 1 >= text.length) {
      return { name: "", end: at + 1 };
    }
    if (WORD_CHAR.test(text[at + 1])) {
      let end = at + 2;
      while (end < text.length && WORD_CHAR.test(text[end])) {
        end += 1;
      }
      return { name: text.slice(at + 1, end), end };
    }
    const codePoint = text.codePointAt(at + 1)!;
    return { name: String.fromCodePoint(codePoint), end: at + 1 + (codePoint > 0xffff ? 2 : 1) };
  }

  private isControl(at: number, name: string): boolean {
    return this.text.startsWith(`\\${name}`, at) &&
      !(WORD_CHAR.test(name) && WORD_CHAR.test(this.text[at + 1 + name.length] ?? ""));
  }

  private commentEnd(at: number): number {
    const known = this.index.commentEndByStart.get(at);
    if (known != null) {
      return known;
    }
    let end = at;
    while (end < this.text.length && this.text[end] !== "\n" && this.text[end] !== "\r") {
      end += 1;
    }
    return end;
  }

  /**
   * The end of the group opened at `at` (after `}`), by brace matching as
   * TeX does (the syntax index's groups can pair braces across stray
   * brackets, `s[{]}ame`, after its error recovery), and whether it
   * closed. One left open ends where recovery closes it, as the renderer
   * does (T2): at the end of its paragraph or item.
   */
  private groupEnd(at: number, limit: number): { end: number; complete: boolean } {
    const match = this.matchDelimited(at, limit, "{", "}");
    if (match.complete) {
      return match;
    }
    const closer = texVirtualCloserAt(scanTexRecovery(this.text), at);
    return closer?.kind === "group" && closer.at <= limit ? { end: closer.at, complete: false } : match;
  }

  private matchDelimited(
    at: number,
    limit: number,
    open: string,
    close: string
  ): { end: number; complete: boolean } {
    const text = this.text;
    let depth = 0;
    for (let cursor = at; cursor < limit; cursor += 1) {
      const char = text[cursor];
      if (char === "\\") {
        cursor += 1;
      } else if (char === "%") {
        cursor = this.commentEnd(cursor) - 1;
      } else if (char === "{" && open !== "{") {
        const inner = this.groupEnd(cursor, limit);
        cursor = inner.end - 1;
      } else if (char === open && (open === "{" || cursor === at)) {
        // As in LaTeX, `[` and `<` do not nest: an optional argument ends
        // at the first `]` outside braces (`[Named r[esult]`).
        depth += 1;
      } else if (char === close) {
        depth -= 1;
        if (depth === 0) {
          return { end: cursor + 1, complete: true };
        }
      }
    }
    return { end: limit, complete: false };
  }

  /**
   * TeX ignores comments, including their line end, while looking for an
   * argument; the next line starts afresh, so a blank line right after a
   * comment is a paragraph end all the same.
   */
  private skipSpaces(at: number, limit: number): number {
    let cursor = at;
    let newlines = 0;
    while (cursor < limit) {
      if (this.text[cursor] === "%") {
        cursor = Math.min(this.commentEnd(cursor), limit);
        if (cursor < limit && this.text[cursor] === "\r") cursor += 1;
        if (cursor < limit && this.text[cursor] === "\n") {
          cursor += 1;
          newlines = 1;
        }
        continue;
      }
      if (!/[ \t\r\n]/u.test(this.text[cursor])) {
        break;
      }
      if (this.text[cursor] === "\n") {
        newlines += 1;
        if (newlines > 1) {
          return at;
        }
      }
      cursor += 1;
    }
    return cursor;
  }

  /** One TeX token at `at`: a control sequence or one character. */
  /** A text character, or TeX's ligature starting there (`---`, `--`, ``` `` ```, `''`), which shows as one (P4, P3). */
  private ligatureEnd(at: number, limit: number): number {
    const match = TEXT_LIGATURE.exec(this.text.slice(at, Math.min(limit, at + 3)));
    return match ? at + match[0].length : this.tokenEnd(at);
  }

  private tokenEnd(at: number): number {
    if (this.text[at] === "\\") {
      return this.controlAt(at).end;
    }
    const codePoint = this.text.codePointAt(at)!;
    return at + (codePoint > 0xffff ? 2 : 1);
  }

  private atStop(run: Run, at: number): boolean {
    if (run.stops.size === 0) {
      return false;
    }
    const text = this.text;
    for (const stop of run.stops) {
      switch (stop) {
        case "dollar":
          if (text[at] === "$") return true;
          break;
        case "double-dollar":
          if (text.startsWith("$$", at)) return true;
          break;
        case "paren":
          if (text.startsWith("\\)", at)) return true;
          break;
        case "bracket":
          if (text.startsWith("\\]", at)) return true;
          break;
        case "right":
          if (this.isControl(at, "right")) return true;
          break;
        case "cell":
          if (text[at] === "&" || text.startsWith("\\\\", at) || this.isControl(at, "tabularnewline")) return true;
          break;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- scanning

  /** Scans items into the run's slot until its end or a stop; returns where it stopped. */
  private scan(run: Run, from: number): number {
    const text = this.text;
    let cursor = from;
    while (cursor < run.end) {
      if (this.atStop(run, cursor)) {
        break;
      }
      const char = text[cursor];
      if (/[ \t\r\n]/u.test(char)) {
        cursor = this.whitespace(run, cursor);
        continue;
      }
      run.skipSpace = false;
      if (char === "%") {
        const end = this.commentEnd(cursor);
        this.attachComment(run, cursor, end);
        run.skipSpace = true;
        cursor = end;
        continue;
      }
      if (char === "\\") {
        cursor = this.command(run, cursor);
        continue;
      }
      if (char === "{") {
        cursor = this.group(run, cursor);
        continue;
      }
      if (char === "}") {
        this.diagnose("unmatched-close", cursor, cursor + 1, "Unmatched }");
        this.leaf(run, "atom", cursor, cursor + 1);
        cursor += 1;
        continue;
      }
      if (char === "$") {
        cursor = this.dollar(run, cursor);
        continue;
      }
      if (run.mode === "math" && (char === "^" || char === "_")) {
        cursor = this.script(run, cursor);
        continue;
      }
      if (char === "~" && run.mode === "text") {
        this.leaf(run, "space", cursor, cursor + 1);
        cursor += 1;
        continue;
      }
      if (run.mode === "text" && (char === "^" || char === "_")) {
        this.diagnose("script-in-text", cursor, cursor + 1, `${char} outside math`);
      }
      if (char === "&") {
        this.diagnose("stray-alignment-tab", cursor, cursor + 1, "& outside an alignment");
      }
      const end = run.mode === "text" ? this.ligatureEnd(cursor, run.end) : this.tokenEnd(cursor);
      this.leaf(run, "char", cursor, end);
      cursor = end;
    }
    return Math.min(cursor, run.end);
  }

  private whitespace(run: Run, at: number): number {
    let end = at;
    let newlines = 0;
    while (end < run.end && /[ \t\r\n]/u.test(this.text[end])) {
      if (this.text[end] === "\n") {
        newlines += 1;
      }
      end += 1;
    }
    const blankLine = newlines >= 2;
    if (run.mode === "math") {
      return end;
    }
    if (blankLine && run.flow) {
      run.paragraph = null;
      run.pendingSpace = null;
      run.skipSpace = false;
      return end;
    }
    if (run.skipSpace) {
      run.skipSpace = false;
      return end;
    }
    const open = run.flow ? run.paragraph != null : true;
    if (open) {
      run.pendingSpace = { from: at, to: end };
    }
    return end;
  }

  private attachComment(run: Run, from: number, to: number): void {
    const node = this.node("invisible", run.mode, { from, to });
    if (run.flow && run.paragraph == null) {
      this.block(run, node);
    } else {
      this.inline(run, node);
    }
  }

  private group(run: Run, at: number): number {
    const { end, complete } = this.groupEnd(at, run.end);
    const node = this.node("group", run.mode, { from: at, to: end });
    const contentTo = complete ? end - 1 : end;
    const slot = this.slot(node, "content", { from: at + 1, to: contentTo }, { mode: run.mode, braced: true });
    this.delimiter(node, at, at + 1);
    if (!complete) {
      this.diagnose("unclosed-group", at, end, "Unclosed {");
    }
    // An unclosed group still ends where its enclosing construct does.
    const stopped = this.scanSlot(slot, run.mode, at + 1, contentTo, complete ? NO_STOPS : run.stops);
    if (complete) {
      this.delimiter(node, end - 1, end);
    }
    this.nodes[node].span.to = complete ? end : stopped;
    this.inline(run, node);
    return this.nodes[node].span.to;
  }

  /** Scans a slot's interior and returns where scanning stopped. */
  private scanSlot(
    slot: SlotId,
    mode: EditMode,
    from: number,
    to: number,
    stops: ReadonlySet<Stop> = NO_STOPS,
    options: { flow?: boolean; trim?: boolean } = {}
  ): number {
    const run = this.run(slot, mode, to, { stops, flow: options.flow, trim: options.trim });
    const stopped = this.scan(run, from);
    this.finish(run);
    if (stopped < to) {
      this.slots[slot].contentSpan.to = stopped;
    }
    return stopped;
  }

  private dollar(run: Run, at: number): number {
    const display = this.text.startsWith("$$", at) && run.mode === "text";
    if (run.mode === "math") {
      this.diagnose("unmatched-close", at, at + 1, "$ inside math");
      this.leaf(run, "char", at, at + 1);
      return at + 1;
    }
    const open = display ? 2 : 1;
    return this.math(run, at, open, display ? "display" : "formula", display ? "double-dollar" : "dollar");
  }

  /** A formula or display delimited by `$…$`, `$$…$$`, `\(…\)` or `\[…\]`. */
  private math(run: Run, at: number, openLength: number, kind: "formula" | "display", stop: Stop): number {
    const closeLength = openLength;
    const node = this.node(kind, run.mode, { from: at, to: at + openLength });
    this.delimiter(node, at, at + openLength);
    const slot = this.slot(node, "content", { from: at + openLength, to: run.end }, { mode: "math" });
    const stopped = this.scanSlot(slot, "math", at + openLength, run.end, new Set([stop]));
    let end = stopped;
    if (stopped < run.end && this.atStop({ ...run, stops: new Set([stop]) }, stopped)) {
      this.delimiter(node, stopped, stopped + closeLength);
      end = stopped + closeLength;
    } else {
      this.diagnose("unclosed-math", at, stopped, "Unclosed formula");
    }
    this.nodes[node].span.to = end;
    if (kind === "display") {
      this.block(run, node);
    } else {
      this.inline(run, node);
    }
    return end;
  }

  // --------------------------------------------------------------- commands

  private command(run: Run, at: number): number {
    const { name, end } = this.controlAt(at);
    const isWord = name.length > 0 && WORD_CHAR.test(name[0]);
    if (name === "") {
      this.diagnose("missing-argument", at, end, "Lone backslash");
      this.leaf(run, "atom", at, Math.min(end, this.text.length));
      return Math.min(end, this.text.length);
    }
    switch (name) {
      case "begin":
        return this.environment(run, at);
      case "end":
        return this.strayEnd(run, at);
      case "(":
        return run.mode === "text" ? this.math(run, at, 2, "formula", "paren") : this.stray(run, at, end);
      case "[":
        return run.mode === "text" ? this.math(run, at, 2, "display", "bracket") : this.stray(run, at, end);
      case ")":
      case "]":
        return this.stray(run, at, end);
      case "\\":
        return this.lineBreak(run, at);
      case "left":
        if (run.mode === "math") return this.delimited(run, at, end);
        break;
      case "right":
        return this.stray(run, at, this.delimiterTokenEnd(end, run.end));
      case "middle":
        if (run.mode === "math") {
          const tokenEnd = this.delimiterTokenEnd(end, run.end);
          this.leaf(run, "symbol", at, tokenEnd, name);
          return tokenEnd;
        }
        break;
      case "verb":
        return this.verb(run, at, end);
      case "tikz":
        return this.inlineTikz(run, at, end);
      case "vrule":
      case "hrule":
      case "hbox":
      case "vbox":
      case "vtop":
      case "kern":
      case "hskip":
      case "vskip":
      case "leaders":
      case "cleaders":
      case "xleaders": {
        // TeX's keyword syntax (`\vrule width2pt`, `\hbox to3em{…}`, `\hskip 1em plus 1fil`) is part of
        // the command, not text: a dimension edited as prose would no longer be one.
        const specEnd = this.primitiveEnd(name, end, run.end);
        this.leaf(run, name === "vskip" ? "vertical" : name.endsWith("skip") || name === "kern" ? "space" : "atom", at, specEnd, name);
        run.skipSpace = specEnd === end;
        return specEnd;
      }
      case "item":
        this.diagnose("unknown-command", at, end, "\\item outside a list");
        this.leaf(run, "atom", at, end, name);
        run.skipSpace = true;
        return end;
    }
    const schema = this.table.command(name, run.mode);
    if (!schema) {
      this.diagnose("unknown-command", at, end, `Unknown command \\${name}`);
      this.leaf(run, "atom", at, end, name);
      run.skipSpace = isWord;
      return end;
    }
    const node = this.bindCommand(run, at, end, schema);
    const nodeEnd = this.nodes[node].span.to;
    run.skipSpace = isWord && nodeEnd === end;
    return nodeEnd;
  }

  /**
   * Where a TeX primitive's own syntax ends: its keywords; a box's group
   * too; for leaders, the box or rule and the glue they fill.
   */
  private primitiveEnd(name: string, end: number, limit: number): number {
    if (name.endsWith("leaders")) {
      const box = /^\s*\\(vrule|hrule|hbox|vbox|vtop)(?![A-Za-z@])/u.exec(this.text.slice(end, limit));
      const boxEnd = box ? this.primitiveEnd(box[1], end + box[0].length, limit) : end;
      const glue = /^\s*\\(?:[hv]fill|[hv]fil|[hv]ss|[hv]filneg)(?![A-Za-z@])|^\s*\\([hv]skip)(?![A-Za-z@])/u.exec(this.text.slice(boxEnd, limit));
      if (!glue) {
        return boxEnd;
      }
      const glueEnd = boxEnd + glue[0].length;
      return glue[1] ? this.primitiveEnd(glue[1], glueEnd, limit) : glueEnd;
    }
    const specEnd = end + (PRIMITIVE_SPECS[name].exec(this.text.slice(end, limit))?.[0].length ?? 0);
    if (name === "hbox" || name === "vbox" || name === "vtop") {
      const open = /^\s*\{/u.exec(this.text.slice(specEnd, limit));
      if (open) {
        return this.groupEnd(specEnd + open[0].length - 1, limit).end;
      }
    }
    return specEnd;
  }

  private stray(run: Run, at: number, end: number): number {
    this.diagnose("unmatched-close", at, end, `Unmatched ${this.text.slice(at, end)}`);
    this.leaf(run, "atom", at, end);
    return end;
  }

  private strayEnd(run: Run, at: number): number {
    const boundary = this.index.environmentBoundaryByStart.get(at);
    const end = boundary ? boundary.span.to : this.controlAt(at).end;
    return this.stray(run, at, Math.min(end, run.end));
  }

  private verb(run: Run, at: number, nameEnd: number): number {
    let cursor = nameEnd;
    if (this.text[cursor] === "*") cursor += 1;
    const delimiter = this.text[cursor];
    const close = delimiter ? this.text.indexOf(delimiter, cursor + 1) : -1;
    const end = close < 0 || close >= run.end ? run.end : close + 1;
    this.leaf(run, "atom", at, end, "verb");
    return end;
  }

  /** `\tikz[options]{…}` or `\tikz[options] … ;`: one atom. */
  private inlineTikz(run: Run, at: number, nameEnd: number): number {
    let cursor = this.skipSpaces(nameEnd, run.end);
    if (this.text[cursor] === "[") {
      const options = this.matchDelimited(cursor, run.end, "[", "]");
      cursor = this.skipSpaces(options.end, run.end);
    }
    let end: number;
    if (this.text[cursor] === "{") {
      end = this.groupEnd(cursor, run.end).end;
    } else {
      end = run.end;
      for (let index = cursor; index < run.end; index += 1) {
        const char = this.text[index];
        if (char === "{") {
          index = this.groupEnd(index, run.end).end - 1;
        } else if (char === ";") {
          end = index + 1;
          break;
        }
      }
    }
    this.leaf(run, "atom", at, end, "tikz");
    return end;
  }

  private lineBreak(run: Run, at: number): number {
    let end = at + 2;
    if (this.text[end] === "*") end += 1;
    const optional = this.skipSpaces(end, run.end);
    if (this.text[optional] === "[") {
      const match = this.matchDelimited(optional, run.end, "[", "]");
      if (match.complete) end = match.end;
    }
    this.leaf(run, "break", at, end, "\\");
    return end;
  }

  /** The delimiter token after \left, \right, \middle. */
  private delimiterTokenEnd(at: number, limit: number): number {
    const start = this.skipSpaces(at, limit);
    return start < limit ? Math.min(this.tokenEnd(start), limit) : at;
  }

  private delimited(run: Run, at: number, nameEnd: number): number {
    const openEnd = this.delimiterTokenEnd(nameEnd, run.end);
    const node = this.node("delimited", "math", { from: at, to: openEnd }, "left");
    this.delimiter(node, at, openEnd);
    const slot = this.slot(node, "content", { from: openEnd, to: run.end }, { mode: "math" });
    const stops = new Set(run.stops);
    stops.add("right");
    const stopped = this.scanSlot(slot, "math", openEnd, run.end, stops);
    let end = stopped;
    if (this.isControl(stopped, "right")) {
      end = this.delimiterTokenEnd(stopped + "\\right".length, run.end);
      this.delimiter(node, stopped, end);
    } else {
      this.diagnose("missing-argument", at, stopped, "\\left without \\right");
    }
    this.nodes[node].span.to = end;
    this.inline(run, node);
    return end;
  }

  /**
   * Binds a command's arguments per its schema and attaches the node.
   * Nodes that end up without slots are leaves covering the whole call.
   */
  private bindCommand(run: Run, at: number, nameEnd: number, schema: CommandSchema): NodeId {
    const node = this.node(schema.node, run.mode, { from: at, to: nameEnd }, schema.name);
    let cursor = nameEnd;
    if (schema.star && (this.text[cursor] === "*" || (schema.name === "onslide" && this.text[cursor] === "+"))) {
      cursor += 1;
    }
    this.delimiter(node, at, cursor);
    for (const arg of schema.args) {
      cursor = this.bindArgument(run, node, arg, cursor);
    }
    const record = this.nodes[node];
    record.span.to = cursor;
    if (record.slots.length === 0) {
      record.delimiters = [];
    }
    if (LEAF_KINDS.has(record.kind) && record.slots.length > 0) {
      record.kind = "style";
    }
    const isBlock = record.kind === "vertical" && (run.paragraph == null || record.command === "par");
    if (isBlock) {
      this.block(run, node);
    } else {
      this.inline(run, node);
    }
    return node;
  }

  private bindArgument(run: Run, node: NodeId, arg: ArgSchema, cursor: number): number {
    const text = this.text;
    const start = this.skipSpaces(cursor, run.end);
    const mode = arg.mode ?? run.mode;
    let span: Span | null = null;
    let content: Span | null = null;
    let braced = false;
    if (arg.kind === "optional" || arg.kind === "overlay") {
      const [open, close] = arg.kind === "optional" ? ["[", "]"] : ["<", ">"];
      if (start < run.end && text[start] === open) {
        const match = this.matchDelimited(start, run.end, open, close);
        if (match.complete) {
          span = { from: start, to: match.end };
          content = { from: start + 1, to: match.end - 1 };
          braced = true;
        }
      }
      if (!span) {
        if (arg.rendered) {
          this.slot(node, arg.role as SlotRole, { from: cursor, to: cursor }, { mode, presence: "absent" });
        }
        return cursor;
      }
    } else if (start < run.end && text[start] === "{") {
      // (Bounded by the run: an unbraced argument that is itself a command,
      // `\textbf\textit{x}`, takes nothing beyond its own token.)
      const match = this.groupEnd(start, run.end);
      span = { from: start, to: match.end };
      content = { from: start + 1, to: match.complete ? match.end - 1 : match.end };
      braced = true;
      if (!match.complete) {
        this.diagnose("unclosed-group", start, match.end, "Unclosed argument");
      }
    } else if (start < run.end && !this.atStop(run, start) && !"}$&%".includes(text[start]) &&
      !(text[start] === "\\" && this.isControl(start, "\\"))) {
      // TeX's undelimited argument: exactly one token (\frac1n, x^2).
      const end = this.tokenEnd(start);
      span = { from: start, to: end };
      content = span;
    } else {
      this.diagnose("missing-argument", cursor, cursor, `\\${this.nodes[node].command ?? ""} is missing an argument`);
      if (arg.rendered) {
        this.slot(node, arg.role as SlotRole, { from: cursor, to: cursor }, { mode });
      }
      return cursor;
    }
    this.delimiter(node, cursor, start);
    if (!content) {
      return cursor;
    }
    if (arg.rendered) {
      const slot = this.slot(node, arg.role as SlotRole, content, { mode, braced });
      this.delimiter(node, span.from, content.from);
      this.scanSlot(slot, mode, content.from, content.to);
      this.delimiter(node, content.to, span.to);
    } else {
      this.nodes[node].values.push({ role: arg.role as EditValue["role"], span, contentSpan: content });
      this.delimiter(node, span.from, span.to);
    }
    return span.to;
  }

  // ----------------------------------------------------------------- scripts

  private script(run: Run, at: number): number {
    const role: SlotRole = this.text[at] === "^" ? "sup" : "sub";
    const siblings = this.slots[run.slot].children;
    const last = siblings.at(-1);
    const lastNode = last != null ? this.nodes[last] : null;
    const baseable = lastNode != null && !["space", "invisible", "declaration", "break", "vertical"].includes(lastNode.kind);
    let scripted: NodeId;
    let gapFrom: number;
    if (baseable && lastNode.kind === "scripted" &&
      !lastNode.slots.some((slot) => this.slots[slot].role === role)) {
      scripted = lastNode.id;
      gapFrom = lastNode.span.to;
    } else {
      if (baseable && lastNode.kind === "scripted") {
        this.diagnose("double-script", at, at + 1, role === "sup" ? "Double superscript" : "Double subscript");
      }
      const base = baseable && lastNode.kind !== "scripted" ? lastNode : null;
      scripted = this.node("scripted", "math", { from: base ? base.span.from : at, to: at });
      if (base) {
        siblings.pop();
        const baseSlot = this.slot(scripted, "base", base.span, { mode: "math" });
        this.attach(baseSlot, base.id);
      } else {
        this.slot(scripted, "base", { from: at, to: at }, { mode: "math" });
      }
      gapFrom = base ? base.span.to : at;
      this.attach(run.slot, scripted);
    }
    this.delimiter(scripted, gapFrom, at);
    this.delimiter(scripted, at, at + 1);
    const end = this.bindArgument(run, scripted, { kind: "mandatory", rendered: true, role }, at + 1);
    this.nodes[scripted].span.to = end;
    return end;
  }

  // ------------------------------------------------------------ environments

  /**
   * The environment begun at `at`: the syntax index's match, else a direct
   * `\begin`/`\end` name match (the index's error recovery can lose a
   * match after a stray token, e.g. `->` read as an overlay closer).
   */
  private matchEnvironment(at: number, limit: number): { name: string; beginEnd: number; endFrom: number; endTo: number } | null {
    const matched = this.environments.get(at);
    if (matched && matched.span.to <= limit) {
      return { name: matched.name, beginEnd: matched.begin.span.to, endFrom: matched.end.span.from, endTo: matched.span.to };
    }
    const head = /^\\begin\s*\{([^{}]*)\}/u.exec(this.text.slice(at, Math.min(limit, at + 200)));
    if (!head) {
      return null;
    }
    const name = head[1];
    const pattern = /\\(begin|end)\s*\{([^{}]*)\}|%[^\n]*|\\[\\%{}]/gu;
    pattern.lastIndex = at + head[0].length;
    let depth = 1;
    for (let match = pattern.exec(this.text); match && match.index < limit; match = pattern.exec(this.text)) {
      if (match[2] !== name) {
        continue;
      }
      depth += match[1] === "begin" ? 1 : -1;
      if (depth === 0) {
        const endTo = match.index + match[0].length;
        return endTo <= limit ? { name, beginEnd: at + head[0].length, endFrom: match.index, endTo } : null;
      }
    }
    return null;
  }

  private environment(run: Run, at: number): number {
    const boundary = this.index.environmentBoundaryByStart.get(at);
    const matched = this.matchEnvironment(at, run.end);
    const beginEnd = boundary ? Math.min(boundary.span.to, run.end) : this.controlAt(at).end;
    if (!matched) {
      this.diagnose("unclosed-environment", at, beginEnd, "Environment without a matching \\end");
      this.leaf(run, "atom", at, beginEnd, "begin");
      return beginEnd;
    }
    const name = matched.name;
    const span = { from: at, to: matched.endTo };
    const schema = this.table.environment(name);
    if (!schema || schema.body === "opaque") {
      if (!schema) {
        this.diagnose("unknown-environment", at, span.to, `Unknown environment ${name}`);
      }
      const node = this.node("atom", run.mode, span, name);
      this.block(run, node);
      return span.to;
    }
    const node = this.node(schema.node, run.mode, span, name);
    this.delimiter(node, at, matched.beginEnd);
    let cursor = matched.beginEnd;
    const bodyEnd = matched.endFrom;
    const bodyRun: Run = { ...run, end: bodyEnd };
    for (const arg of schema.args) {
      cursor = this.bindArgument(bodyRun, node, arg, cursor);
    }
    switch (schema.body) {
      case "flow": {
        const slot = this.slot(node, "flow", { from: cursor, to: bodyEnd }, { mode: "text", flow: true });
        this.scanSlot(slot, "text", cursor, bodyEnd, NO_STOPS, { flow: true, trim: true });
        break;
      }
      case "math": {
        const slot = this.slot(node, "content", { from: cursor, to: bodyEnd }, { mode: "math" });
        this.scanSlot(slot, "math", cursor, bodyEnd);
        break;
      }
      case "list":
        this.list(node, cursor, bodyEnd, schema.item ?? DEFAULT_LIST_ITEM);
        break;
      case "math-alignment":
        this.alignment(node, cursor, bodyEnd, "math");
        break;
      case "text-alignment":
        this.alignment(node, cursor, bodyEnd, "text");
        break;
    }
    this.delimiter(node, bodyEnd, span.to);
    if (run.mode === "math" || !run.flow) {
      this.inline(run, node);
    } else {
      this.block(run, node);
    }
    return span.to;
  }

  /** `\item` starts at the top level of a list body (not inside groups or nested environments). */
  private topLevelControls(from: number, to: number, names: ReadonlySet<string>): number[] {
    const found: number[] = [];
    const text = this.text;
    for (let cursor = from; cursor < to; cursor += 1) {
      const char = text[cursor];
      if (char === "%") {
        cursor = this.commentEnd(cursor) - 1;
      } else if (char === "{") {
        cursor = this.groupEnd(cursor, to).end - 1;
      } else if (char === "\\") {
        if (this.isControl(cursor, "begin")) {
          const matched = this.matchEnvironment(cursor, to);
          if (matched) {
            cursor = matched.endTo - 1;
            continue;
          }
        }
        const { name, end } = this.controlAt(cursor);
        if (names.has(name)) {
          found.push(cursor);
        }
        cursor = end - 1;
      }
    }
    return found;
  }

  private list(list: NodeId, from: number, to: number, itemSchema: NonNullable<EnvironmentSchema["item"]>): void {
    const slot = this.slot(list, "flow", { from, to }, { mode: "text", flow: true });
    const starts = this.topLevelControls(from, to, new Set([itemSchema.command]));
    const firstItem = starts[0] ?? to;
    this.preamble(slot, from, firstItem);
    starts.forEach((start, index) => {
      const itemEnd = starts[index + 1] ?? to;
      const item = this.node("item", "text", { from: start, to: itemEnd }, itemSchema.command);
      this.attach(slot, item);
      const itemRun = this.run(slot, "text", itemEnd);
      let cursor = start + 1 + itemSchema.command.length;
      this.delimiter(item, start, cursor);
      for (const arg of itemSchema.args) {
        cursor = this.bindArgument(itemRun, item, arg, cursor);
      }
      // Spaces on the item's own line belong to `\item `; content on the next line starts after a gap.
      let contentFrom = cursor;
      while (contentFrom < itemEnd && (this.text[contentFrom] === " " || this.text[contentFrom] === "\t")) {
        contentFrom += 1;
      }
      this.delimiter(item, cursor, contentFrom);
      const content = this.slot(item, "flow", { from: contentFrom, to: itemEnd }, { mode: "text", flow: true });
      this.scanSlot(content, "text", contentFrom, itemEnd, NO_STOPS, { flow: true, trim: true });
    });
  }

  /**
   * Source before a list's first `\item`: declarations and comments
   * (`\setlength{\itemsep}{…}`) bind normally; typeset text there is
   * reported.
   */
  private preamble(slot: SlotId, from: number, to: number): void {
    const before = this.slots[slot].children.length;
    const run = this.run(slot, "text", to, { trim: true });
    this.scan(run, from);
    this.finish(run);
    const stray = this.slots[slot].children.slice(before).map((id) => this.nodes[id])
      .filter((node) => !["invisible", "declaration", "atom", "space", "vertical"].includes(node.kind));
    if (stray.length > 0) {
      this.diagnose("text-before-first-item", stray[0].span.from, stray.at(-1)!.span.to, "Content before the first \\item");
    }
  }

  private alignment(node: NodeId, from: number, to: number, mode: EditMode): void {
    const columns = mode === "text" ? this.columnModes(node) : [];
    // Text typed between rows starts a row: in the first column's mode.
    const slot = this.slot(node, "content", { from, to }, { mode: columns[0] ?? mode, flow: false });
    const text = this.text;
    let cursor = from;
    while (cursor < to) {
      // Whitespace, comments and rules between rows.
      if (/[ \t\r\n]/u.test(text[cursor])) {
        cursor += 1;
        continue;
      }
      if (text[cursor] === "%") {
        const end = this.commentEnd(cursor);
        this.attach(slot, this.node("invisible", mode, { from: cursor, to: end }));
        cursor = end;
        continue;
      }
      if (text[cursor] === "\\") {
        const { name, end } = this.controlAt(cursor);
        const shape = RULE_COMMANDS.get(name);
        if (shape != null) {
          let ruleEnd = end;
          for (const opener of shape) {
            const next = this.skipSpaces(ruleEnd, to);
            if (text[next] !== opener) {
              if (opener === "{") break;
              continue;
            }
            const match = opener === "{"
              ? this.groupEnd(next, to)
              : this.matchDelimited(next, to, opener, opener === "[" ? "]" : ")");
            if (!match.complete) break;
            ruleEnd = match.end;
          }
          this.attach(slot, this.node("invisible", mode, { from: cursor, to: ruleEnd }, name));
          cursor = ruleEnd;
          continue;
        }
      }
      // A row takes the indentation before it, so that an empty first
      // cell (`  & b`) has its place where the line's text begins.
      let start = cursor;
      while (start > from && (text[start - 1] === " " || text[start - 1] === "\t")) {
        start -= 1;
      }
      cursor = this.row(slot, start, to, mode, columns);
    }
  }

  /**
   * The mode of each column of a table: math where the column
   * specification wraps it in `>{$}…<{$}`, as the renderer reads it
   * (text/tex/ir.ts); text otherwise, and for a specification it cannot read.
   */
  private columnModes(node: NodeId): EditMode[] {
    const spec = this.nodes[node].values.find((value) => value.role === "spec");
    if (!spec) {
      return [];
    }
    try {
      return parseTexTabularPreamble(this.text.slice(spec.contentSpan.from, spec.contentSpan.to)).columns
        .map((column) => column.before?.trim() === "$" && column.after?.trim() === "$" ? "math" : "text");
    } catch {
      return [];
    }
  }

  private row(parent: SlotId, from: number, to: number, mode: EditMode, columns: readonly EditMode[] = []): number {
    const row = this.node("row", columns[0] ?? mode, { from, to: from });
    this.attach(parent, row);
    const stops: ReadonlySet<Stop> = new Set(["cell"]);
    let cellFrom = from;
    let column = 0;
    for (;;) {
      // `\multicolumn{n}` takes n columns (its content is its own argument).
      MULTICOLUMN.lastIndex = this.skipSpaces(cellFrom, to);
      const span = MULTICOLUMN.exec(this.text);
      const cellMode = span ? mode : columns[column] ?? mode;
      column += span ? Number(span[1]) : 1;
      const slot = this.slot(row, "cell", { from: cellFrom, to }, { mode: cellMode });
      const stopped = this.scanSlot(slot, cellMode, cellFrom, to, stops, { trim: true });
      if (stopped >= to) {
        this.nodes[row].span.to = to;
        return to;
      }
      if (this.text[stopped] === "&") {
        this.delimiter(row, stopped, stopped + 1);
        cellFrom = stopped + 1;
        continue;
      }
      // Row end: `\\`, `\\*`, `\\[2pt]`, `\tabularnewline`.
      let end = this.text.startsWith("\\\\", stopped) ? stopped + 2 : this.controlAt(stopped).end;
      if (this.text[end] === "*") end += 1;
      const optional = this.skipSpaces(end, to);
      if (this.text[optional] === "[") {
        const match = this.matchDelimited(optional, to, "[", "]");
        if (match.complete) end = match.end;
      }
      this.delimiter(row, stopped, end);
      this.nodes[row].span.to = end;
      return end;
    }
  }
}
