import { isDeclarationGroup, itemRole } from "./kinds.js";
import type { EditNodeKind, EditTree, NodeId, SlotId } from "../tree/types.js";

/**
 * Who handles a structural key (design/canvas-editing-architecture.md,
 * "Ownership"; scenarios O1, Z1, D2). Each node declares, for the slot
 * the caret is in, one capability per key:
 * - `owns`: it handles the key;
 * - `barrier`: nothing at or above it may (the key does nothing, with a hint);
 * - `transparent`: skip it, but the owner's edit must carry it along
 *   (a style wrapper or formula split across an item break);
 * - `pass`: skip it.
 *
 * The decision is one rule for every key: a barrier anywhere on the
 * caret's chain stops the key; otherwise the innermost owner handles it,
 * with the transparent nodes between.
 */
export type StructuralKey = "enter" | "line-break" | "tab";

export type Capability =
  | { readonly kind: "owns" }
  | { readonly kind: "barrier"; readonly hint: string }
  | { readonly kind: "transparent" }
  | { readonly kind: "pass" };

/** One step of the caret's chain: a node and the slot of it the caret is in. */
export type ChainLink = { readonly node: NodeId; readonly slot: SlotId; readonly capability: Capability };

export type OwnerDecision =
  | { readonly kind: "owner"; readonly node: NodeId; readonly slot: SlotId; readonly transparent: readonly ChainLink[] }
  | { readonly kind: "stop"; readonly hint: string | null };

const OWNS: Capability = { kind: "owns" };
const PASS: Capability = { kind: "pass" };
const TRANSPARENT: Capability = { kind: "transparent" };
const barrier = (hint: string): Capability => ({ kind: "barrier", hint });

/** Math slots: a break inside one would split the construct (O1). */
const MATH_SLOTS = new Set(["numerator", "denominator", "radicand", "index", "sup", "sub", "above", "below", "base"]);
/** Commands whose content is a title, not flow text. */
const TITLE_COMMANDS = new Set(["frametitle", "framesubtitle", "caption", "title", "subtitle", "author", "institute", "date"]);

function isTitle(tree: EditTree, node: NodeId, slot: SlotId): boolean {
  const role = tree.slots[slot].role;
  const command = tree.nodes[node].command;
  return role === "title" || role === "label" || (command != null && TITLE_COMMANDS.has(command));
}

/** Whether a slot is inside a title (`\frametitle`, a block title, an item label): not flow text. */
export function inTitle(tree: EditTree, slot: SlotId): boolean {
  return capabilityChain(tree, "tab", slot).some((link) => isTitle(tree, link.node, link.slot));
}

export function capability(tree: EditTree, key: StructuralKey, node: NodeId, slot: SlotId): Capability {
  const record = tree.nodes[node];
  const role = tree.slots[slot].role;
  if (isTitle(tree, node, slot)) {
    return key === "tab" ? PASS : barrier("⏎ does nothing in a title");
  }
  if (key === "tab") {
    if (record.kind === "row" || record.kind === "item") {
      return OWNS;
    }
    const kind = itemRole(tree, node);
    return MATH_SLOTS.has(role) && (kind === "construct" || kind === "scripted") ? OWNS : PASS;
  }
  if (record.kind === "row" || record.kind === "item") {
    return OWNS;
  }
  if (record.kind === "display") {
    return key === "enter" ? OWNS : barrier("⇧⏎ does nothing in a display");
  }
  if (record.kind === "paragraph") {
    // In an item, the item splits.
    return record.parent != null && tree.nodes[tree.slots[record.parent].node].kind === "item" ? PASS : OWNS;
  }
  if (record.kind === "formula") {
    return key === "enter" ? TRANSPARENT : barrier("⇧⏎ does nothing in math");
  }
  if (record.kind === "text-in-math") {
    return barrier("⏎ does nothing in \\text inside math");
  }
  if (WRAPPERS.has(record.kind)) {
    if (key === "line-break") {
      return PASS;
    }
    // Only a wrapper whose last slot holds the caret closes and reopens cleanly.
    return record.slots.filter((id) => tree.slots[id].presence === "present").at(-1) === slot &&
      (record.kind !== "group" || isDeclarationGroup(tree, node) || tree.slots[slot].children.length > 0)
      ? TRANSPARENT
      : barrier("⏎ does nothing here");
  }
  if (FLOW_CONTAINERS.has(record.kind)) {
    return PASS;
  }
  return MATH_SLOTS.has(role) || itemRole(tree, node) === "construct" || itemRole(tree, node) === "scripted"
    ? barrier("⏎ does nothing in a fraction or script")
    : PASS;
}

const WRAPPERS = new Set<EditNodeKind>(["style", "overlay", "link", "group"]);
const FLOW_CONTAINERS = new Set<EditNodeKind>(["list", "container", "scope", "alignment"]);

/** The caret's chain, innermost first: each enclosing node with the slot of it the caret is in. */
export function capabilityChain(tree: EditTree, key: StructuralKey, slot: SlotId): ChainLink[] {
  const links: ChainLink[] = [];
  for (let current: SlotId | null = slot; current != null;) {
    const node: NodeId = tree.slots[current].node;
    links.push({ node, slot: current, capability: capability(tree, key, node, current) });
    current = tree.nodes[node].parent;
  }
  return links;
}

/** One rule for every key: any barrier stops it; otherwise the innermost owner, with the transparent links inside it. */
export function decideOwner(links: readonly ChainLink[]): OwnerDecision {
  const stop = links.find((link) => link.capability.kind === "barrier");
  if (stop?.capability.kind === "barrier") {
    return { kind: "stop", hint: stop.capability.hint };
  }
  const at = links.findIndex((link) => link.capability.kind === "owns");
  if (at < 0) {
    return { kind: "stop", hint: null };
  }
  return {
    kind: "owner",
    node: links[at].node,
    slot: links[at].slot,
    transparent: links.slice(0, at).filter((link) => link.capability.kind === "transparent"),
  };
}
