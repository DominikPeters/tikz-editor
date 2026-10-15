import { requireDefined } from "../../utils/invariants.js";
import { editNodeAt, editSlotAt } from "../tree/lookup.js";
import type { MacroBinding } from "../../macros/types.js";
import { itemRole } from "../ownership/kinds.js";
import { buildEditTree } from "../tree/build.js";
import type { EditMode, EditTree, NodeId } from "../tree/types.js";

/**
 * K1: user macros are classified by what their definition expands to, with
 * no per-macro configuration (design/canvas-keyboard-scenarios.md, K1).
 * - `style`: exactly one argument, used once, wrapped only in style
 *   commands (`\newcommand{\ee}[1]{\textcolor{emphcolor}{#1}}`). It edits
 *   like `\textbf`: two stops, ⌫ deletes the last character.
 * - `other`: anything else, an atom (a bare symbol macro such as `\R` is a
 *   one-press unit; one with arguments is selected first).
 */
export type MacroClass = { readonly kind: "style"; readonly mode: EditMode } | { readonly kind: "other" };

const OTHER: MacroClass = { kind: "other" };
/** Stands for `#1` while the body is bound (a private-use character binds as one char). */
const ARGUMENT = "";

const classes = new WeakMap<MacroBinding, MacroClass>();

export function classifyMacro(binding: MacroBinding): MacroClass {
  let found = classes.get(binding);
  if (!found) {
    found = classify(binding);
    classes.set(binding, found);
  }
  return found;
}

function classify(binding: MacroBinding): MacroClass {
  if (binding.kind !== "callable" || binding.parameterCount !== 1 || binding.optionalFirstArgDefault != null) {
    return OTHER;
  }
  if (binding.body.split("#1").length !== 2 || binding.body.includes(ARGUMENT)) {
    return OTHER;
  }
  const body = binding.body.replace("#1", ARGUMENT);
  if (wrapsArgumentOnly(buildEditTree(body), "paragraph")) {
    return { kind: "style", mode: "text" };
  }
  if (wrapsArgumentOnly(buildEditTree(`$${body}$`), "formula")) {
    return { kind: "style", mode: "math" };
  }
  return OTHER;
}

/**
 * Whether the argument is the only visible thing in the body, reached from
 * the outermost `container` node through style wrappers only.
 */
function wrapsArgumentOnly(tree: EditTree, container: "paragraph" | "formula"): boolean {
  const marker = tree.nodes.find((node) => node.kind === "char" && tree.text.slice(node.span.from, node.span.to) === ARGUMENT);
  if (!marker || tree.diagnostics.length > 0) {
    return false;
  }
  let child: NodeId = marker.id;
  for (;;) {
    const slot = editSlotAt(tree.slots, requireDefined(editNodeAt(tree.nodes, child).parent, "Missing required editNodeAt(tree.nodes, child).parent"));
    const visible = slot.children.filter((id) => itemRole(tree, id) !== "invisible");
    if (visible.length !== 1 || visible[0] !== child) {
      return false;
    }
    const owner = editNodeAt(tree.nodes, slot.node);
    if (owner.kind === container) {
      // The container must be the body's only block.
      const outer = owner.parent == null ? null : editSlotAt(tree.slots, owner.parent);
      return outer?.children.length === 1 && editNodeAt(tree.nodes, outer.node).kind === (container === "paragraph" ? "scope" : "paragraph");
    }
    if (itemRole(tree, owner.id) !== "transparent") {
      return false;
    }
    child = owner.id;
  }
}
