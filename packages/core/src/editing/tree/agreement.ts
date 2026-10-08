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
 * - the text IR desugars `\url` into a `\texttt` font command.
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
      const slot = tree.slots[node.slots[0]];
      if (slot?.role !== "content") continue;
      const { from, to } = slot.contentSpan;
      const engine = mathFacts(tree.text.slice(from, to), from);
      const ours = new Set(
        [...treeFacts(tree, node.id, ["fraction", "radical", "scripted", "overset"])]
          .map((fact) => fact.replace(/^overset/u, "scripted"))
      );
      for (const id of emptyBaseScripts(tree, node.id)) {
        ours.delete(`scripted@${tree.nodes[id].span.from}-${tree.nodes[id].span.to}`);
      }
      diff(disagreements, "math", ours, engine, slot.contentSpan);
    } else if (node.kind === "paragraph") {
      const { from, to } = node.span;
      const parsed = parseSimpleTexInlineNodes(tree.text.slice(from, to), from);
      if (parsed.unsupportedCommand) continue;
      const engine = new Set<string>();
      collectFontCommands(parsed.nodes, engine);
      for (const fact of engine) {
        const [head, range] = fact.split("@");
        const command = head.slice("font:".length);
        if (!tree.text.startsWith(`\\${command}`, Number(range.split("-")[0]))) engine.delete(fact);
      }
      const ours = new Set(
        [...treeFacts(tree, node.id, ["style"])].filter((fact) => FONT_COMMANDS.has(fact.split("@")[0].split(":")[1] ?? ""))
          .map((fact) => `font${fact.slice(fact.indexOf(":"))}`)
      );
      diff(disagreements, "text", ours, engine, node.span);
    }
  }
  return disagreements;
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
    const node = tree.nodes[id];
    if (id !== root && (node.kind === "formula" || node.kind === "display" || node.kind === "text-in-math")) {
      return;
    }
    if (kinds.includes(node.kind)) {
      const command = node.kind === "style" ? `:${node.command ?? ""}` : "";
      facts.add(`${node.kind}${command}@${node.span.from}-${node.span.to}`);
    }
    for (const slot of node.slots) {
      for (const child of tree.slots[slot].children) visit(child);
    }
  };
  visit(root);
  return facts;
}

function emptyBaseScripts(tree: EditTree, root: NodeId): NodeId[] {
  return tree.nodes
    .filter((node) => node.kind === "scripted" && node.span.from >= tree.nodes[root].span.from &&
      node.span.to <= tree.nodes[root].span.to)
    .filter((node) => tree.slots[node.slots[0]].children.length === 0)
    .map((node) => node.id);
}

function mathFacts(source: string, offset: number): Set<string> {
  const facts = new Set<string>();
  const visit = (value: unknown, insideText: boolean) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, insideText);
      return;
    }
    if (value == null || typeof value !== "object") return;
    const record = value as Record<string, unknown> & { kind?: string; sourceSpan?: { start: number; end: number } };
    // Formulas nested in \text are their own comparison.
    if (record.kind === "text") return;
    const span = record.sourceSpan;
    if (span && !insideText) {
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
