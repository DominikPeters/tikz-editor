import { requireArrayValue } from "../../utils/collections.js";
import { isObjectRecord } from "../../utils/records.js";
import { editSlotAt, editNodeAt } from "./lookup.js";
import { parseSimpleTexInlineNodes, SIMPLE_TEX_FONT_COMMAND_NAMES, type SimpleTexInlineNode } from "../../text/tex/ir.js";
import { parseTexMath } from "../../text/tex/math/parser.js";
import type { EditTree, NodeId } from "./types.js";

/**
 * Engine agreement (design/canvas-editing-architecture.md, "Engine
 * annotations"): the binding layer decides what belongs to what; the
 * engines' own parses must agree with it. Disagreements are reported, not
 * resolved — for editing, the binding layer wins.
 *
 * Compared facts: fraction, radical and scripted-atom spans inside each
 * formula and single-content display (math parser), and font-command
 * spans inside each paragraph (text IR).
 *
 * Known representation differences are normalized, not reported:
 * - the math parser models `\overset`-style stacking as a scripted atom;
 * - it models a prime (`f'`) as a superscript, where the tree keeps the
 *   prime as a character;
 * - a script with an empty base (`$^*$`) has no base atom in the math IR;
 * - the text IR desugars `\url` into a `\texttt` font command;
 * - the renderer projects Beamer source before the text IR reads it: link
 *   commands become their text in braces, and a font command's overlay
 *   specification (`\textbf<2>{x}`) is resolved per step. The IR reads the
 *   paragraph as projected on a step where the specification matches.
 */
export type EngineDisagreement = {
  readonly engine: "math" | "text";
  /** The construct that only one side has, as `kind@from-to`. */
  readonly fact: string;
  readonly side: "tree-only" | "engine-only";
  /** The formula or paragraph compared. */
  readonly within: { readonly from: number; readonly to: number };
};

const FONT_COMMANDS: ReadonlySet<string> = new Set(SIMPLE_TEX_FONT_COMMAND_NAMES);

export function compareEditTreeWithEngines(tree: EditTree): EngineDisagreement[] {
  const disagreements: EngineDisagreement[] = [];
  for (const node of tree.nodes) {
    if (node.kind === "formula" || node.kind === "display") {
      const slotId = node.slots[0];
      const slot = slotId === undefined ? undefined : tree.slots[slotId];
      if (slot?.role !== "content") continue;
      const { from, to } = slot.contentSpan;
      const literalSpans: { from: number; to: number }[] = [];
      const engine = mathFacts(tree.text.slice(from, to), from, literalSpans);
      const ours = new Set(
        [...treeFacts(tree, node.id, ["fraction", "radical", "scripted", "overset"])]
          .map((fact) => fact.replace(/^overset/u, "scripted"))
      );
      for (const id of emptyBaseScripts(tree, node.id)) {
        ours.delete(`scripted@${editNodeAt(tree.nodes, id).span.from}-${editNodeAt(tree.nodes, id).span.to}`);
      }
      // Unsupported package macros are literal text in the math IR. Their
      // argument groups have no math facts to compare, though the edit tree
      // still exposes source structure there. Keep checking adjacent math.
      for (const fact of ours) {
        const range = /@(\d+)-(\d+)$/u.exec(fact);
        if (range && literalSpans.some(span => Number(range[1]) >= span.from && Number(range[2]) <= span.to)) ours.delete(fact);
      }
      diff(disagreements, "math", ours, engine, slot.contentSpan);
    } else if (node.kind === "paragraph") {
      const { from } = node.span;
      const parsed = parseSimpleTexInlineNodes(projectedParagraph(tree, node.id), from);
      if (parsed.unsupportedCommand) continue;
      const engine = new Set<string>();
      collectFontCommands(parsed.nodes, engine);
      for (const fact of engine) {
        const parts = fact.split("@");
        const head = requireArrayValue(parts, 0);
        const range = requireArrayValue(parts, 1);
        const command = head.slice("font:".length);
        if (!tree.text.startsWith(`\\${command}`, Number(range.split("-")[0]))) engine.delete(fact);
      }
      const ours = new Set(
        [...treeFacts(tree, node.id, ["style"])].filter((fact) => FONT_COMMANDS.has(requireArrayValue(fact.split("@"), 0).split(":")[1] ?? ""))
          .map((fact) => `font${fact.slice(fact.indexOf(":"))}`)
      );
      diff(disagreements, "text", ours, engine, node.span);
    }
  }
  return disagreements;
}

/**
 * The paragraph's source as the renderer's Beamer projections hand it to
 * the text IR, with every offset kept: replaced syntax becomes spaces.
 */
function projectedParagraph(tree: EditTree, paragraph: NodeId): string {
  const { from, to } = editNodeAt(tree.nodes, paragraph).span;
  const chars = tree.text.slice(from, to).split("");
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index++) chars[index - from] = " ";
  };
  const visit = (id: NodeId) => {
    const node = editNodeAt(tree.nodes, id);
    if (node.kind === "link") {
      const text = node.slots.map((slot) => editSlotAt(tree.slots, slot)).find((slot) => slot.role === "content");
      const { from: start, to: end } = text?.contentSpan ?? { from: -1, to: -1 };
      if (text && tree.text[start - 1] === "{" && tree.text[end] === "}") {
        blank(node.span.from, start - 1);
        blank(end + 1, node.span.to);
      }
    } else if (node.kind === "style" && node.command && FONT_COMMANDS.has(node.command)) {
      const spec = /^\\[A-Za-z]+(\s*<[^<>{}]*>)/u.exec(tree.text.slice(node.span.from, node.span.to));
      if (spec) blank(node.span.from + spec[0].length - requireArrayValue(spec, 1).length, node.span.from + spec[0].length);
    }
    for (const slot of node.slots) {
      for (const child of editSlotAt(tree.slots, slot).children) visit(child);
    }
  };
  visit(paragraph);
  return chars.join("");
}

function diff(
  out: EngineDisagreement[],
  engine: EngineDisagreement["engine"],
  ours: ReadonlySet<string>,
  theirs: ReadonlySet<string>,
  within: { from: number; to: number }
): void {
  for (const fact of ours) {
    if (!theirs.has(fact)) out.push({ engine, fact, side: "tree-only", within });
  }
  for (const fact of theirs) {
    if (!ours.has(fact)) out.push({ engine, fact, side: "engine-only", within });
  }
}

function treeFacts(tree: EditTree, root: NodeId, kinds: readonly string[]): Set<string> {
  const facts = new Set<string>();
  const visit = (id: NodeId) => {
    const node = editNodeAt(tree.nodes, id);
    if (id !== root && (node.kind === "formula" || node.kind === "display" || node.kind === "text-in-math")) {
      return;
    }
    if (kinds.includes(node.kind)) {
      const command = node.kind === "style" ? `:${node.command ?? ""}` : "";
      facts.add(`${node.kind}${command}@${node.span.from}-${node.span.to}`);
    }
    for (const slot of node.slots) {
      for (const child of editSlotAt(tree.slots, slot).children) visit(child);
    }
  };
  visit(root);
  return facts;
}

function emptyBaseScripts(tree: EditTree, root: NodeId): NodeId[] {
  return tree.nodes
    .filter((node) => node.kind === "scripted" && node.span.from >= editNodeAt(tree.nodes, root).span.from &&
      node.span.to <= editNodeAt(tree.nodes, root).span.to)
    .filter((node) => editSlotAt(tree.slots, requireArrayValue(node.slots, 0)).children.length === 0)
    .map((node) => node.id);
}

function mathFacts(source: string, offset: number, literalSpans: { from: number; to: number }[]): Set<string> {
  const facts = new Set<string>();
  const visit = (value: unknown, insideText: boolean) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, insideText);
      return;
    }
    if (!isObjectRecord(value)) return;
    const record = value;
    // Formulas nested in \text are their own comparison.
    if (record.kind === "text") {
      if (Array.isArray(record.nodes)) for (const node of record.nodes) {
        if (isObjectRecord(node) && node.kind === "literal" && typeof node.sourceStart === "number" && typeof node.sourceEnd === "number") {
          literalSpans.push({ from: node.sourceStart, to: node.sourceEnd });
        }
      }
      return;
    }
    const span = record.sourceSpan;
    if (isObjectRecord(span) && typeof span.start === "number" && typeof span.end === "number" && !insideText) {
      if (record.kind === "fraction") facts.add(`fraction@${span.start}-${span.end}`);
      if (record.kind === "radical") facts.add(`radical@${span.start}-${span.end}`);
      if (record.kind === "atom" && (record.subscript || record.superscript)) {
        // A prime-only superscript (f') stays a character in the tree.
        if (/[_^]|\\(?:overset|underset|stackrel|overunderset|xleftarrow|xrightarrow)/u.test(source.slice(span.start - offset, span.end - offset))) {
          facts.add(`scripted@${span.start}-${span.end}`);
        }
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== "sourceSpan") visit(child, insideText);
    }
  };
  visit(parseTexMath(source, { sourceOffset: offset }).list, false);
  return facts;
}

function collectFontCommands(nodes: readonly SimpleTexInlineNode[], facts: Set<string>): void {
  for (const node of nodes) {
    if (node.kind === "font-command") {
      facts.add(`font:${node.command}@${node.sourceStart}-${node.sourceEnd}`);
    }
    if ("children" in node && Array.isArray(node.children)) {
      collectFontCommands(node.children as readonly SimpleTexInlineNode[], facts);
    }
  }
}
