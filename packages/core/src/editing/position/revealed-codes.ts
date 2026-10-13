import { isRevealedCode } from "../ownership/kinds.js";
import type { NodeId } from "../tree/types.js";
import type { EditView } from "./view.js";

/** A piece of invisible syntax as reveal codes shows it (R14): a small chip at its place. */
export type RevealedCode = {
  readonly node: NodeId;
  readonly span: { readonly from: number; readonly to: number };
  readonly label: string;
};

const MAX_LABEL = 24;

/** The invisible syntax of a buffer, labelled: `⏸ pause`, `% TODO cite`, `label eq:kkt`, `vspace 1em`. */
export function revealedCodes(view: EditView): RevealedCode[] {
  const { tree } = view;
  return tree.nodes.flatMap((node): RevealedCode[] => {
    if (node.parent == null || view.hidden.has(node.id) || !isRevealedCode(tree, node.id)) {
      return [];
    }
    const source = tree.text.slice(node.span.from, node.span.to).trim();
    if (source === "") {
      return [];
    }
    return [{ node: node.id, span: node.span, label: codeLabel(source, node.command) }];
  });
}

function codeLabel(source: string, command: string | undefined): string {
  if (source.startsWith("%")) {
    return shorten(source.replace(/^%+\s*/u, "% "));
  }
  if (command === "pause") {
    return "⏸ pause";
  }
  const name = command ?? /^\\([A-Za-z@]+)/u.exec(source)?.[1] ?? source;
  const argument = /\{([^{}]*)\}\s*$/u.exec(source)?.[1];
  return shorten(argument ? `${name} ${argument}` : name);
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/gu, " ");
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
}
