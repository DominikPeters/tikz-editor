import type { EditTree, NodeId, SlotId } from "./types.js";

/**
 * A compact, readable rendering of an EditTree for tests and debugging:
 * runs of characters print as one string, `␣` is a space, slots print as
 * `role:[…]` (a node with a single content slot prints its content
 * inline), and an absent slot prints as `role:∅`.
 */
export function printEditTree(tree: EditTree, node: NodeId = tree.root): string {
  return printNode(tree, node);
}

function printNode(tree: EditTree, id: NodeId): string {
  const node = tree.nodes[id];
  const source = tree.text.slice(node.span.from, node.span.to);
  const leaf = printLeaf(node.kind, source, node.command);
  if (leaf != null) {
    return leaf;
  }
  const head = node.command && !["item", "left"].includes(node.command)
    ? `${node.kind}:${node.command}`
    : node.kind;
  const slots = node.slots;
  const values = node.values.map((value) => ` ${value.role}=${tree.text.slice(value.contentSpan.from, value.contentSpan.to)}`).join("");
  if (slots.length === 1 && ["content", "flow"].includes(tree.slots[slots[0]].role)) {
    return `(${head}${values} ${printSlotContent(tree, slots[0])})`.replace(/ \)$/u, ")");
  }
  const parts = slots.map((slot) => {
    const record = tree.slots[slot];
    return record.presence === "absent" ? `${record.role}:∅` : `${record.role}:[${printSlotContent(tree, slot)}]`;
  });
  return `(${[head + values, ...parts].join(" ")})`;
}

function printLeaf(kind: string, source: string, command: string | undefined): string | null {
  if (kind === "char") return JSON.stringify(source);
  if (kind === "space") return command ? `\\${command}` : "␣";
  if (["symbol", "declaration", "vertical", "break"].includes(kind)) return source;
  if (kind === "invisible") return command ? `\\${command}` : "%";
  if (kind === "atom") return `⟨${source.length > 24 ? `${source.slice(0, 21)}…` : source}⟩`;
  return null;
}

function printSlotContent(tree: EditTree, slot: SlotId): string {
  const parts: string[] = [];
  let run = "";
  const flush = () => {
    if (run) {
      parts.push(JSON.stringify(run));
      run = "";
    }
  };
  for (const child of tree.slots[slot].children) {
    const node = tree.nodes[child];
    if (node.kind === "char") {
      run += tree.text.slice(node.span.from, node.span.to);
      continue;
    }
    flush();
    parts.push(printNode(tree, child));
  }
  flush();
  return parts.join(" ");
}
