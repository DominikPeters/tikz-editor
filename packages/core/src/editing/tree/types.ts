/**
 * The EditTree (design/canvas-editing-architecture.md, "Binding layer and
 * EditTree"): one tree per edit scope, built from the scope's source by
 * the binding layer. Spans are buffer-local (0 is the scope start), like
 * transactions.
 *
 * Every source offset is covered by exactly one leaf, one delimiter (source
 * a construct owns: braces, `$`, command names, value arguments), or a
 * slot gap (insignificant source between a slot's children: whitespace in
 * math and between flow blocks).
 */

export type Span = { readonly from: number; readonly to: number };

export type NodeId = number;
export type SlotId = number;

export type EditMode = "text" | "math" | "verbatim";

export type EditNodeKind =
  // Flow
  | "scope"
  | "paragraph"
  | "list"
  | "item"
  | "container"
  | "display"
  | "alignment"
  /** Alignment cells are the slots of a row (like a fraction's numerator). */
  | "row"
  | "vertical"
  // Inline
  | "style"
  | "declaration"
  | "overlay"
  | "group"
  | "formula"
  | "text-in-math"
  | "link"
  | "break"
  // Math
  | "fraction"
  | "radical"
  | "scripted"
  | "delimited"
  | "accent"
  | "overset"
  | "operator"
  // Leaves
  | "char"
  | "symbol"
  | "atom"
  | "space"
  | "invisible";

export type SlotRole =
  | "content"
  | "flow"
  | "title"
  | "label"
  | "numerator"
  | "denominator"
  | "index"
  | "radicand"
  | "base"
  | "sup"
  | "sub"
  | "above"
  | "below"
  | "row"
  | "cell";

/** A value argument (colour, URL, overlay spec, …): edited by pickers, not as text. */
export type EditValue = {
  readonly role: "overlay" | "color" | "url" | "label-key" | "dimension" | "options" | "spec" | "value";
  /** The whole argument, delimiters included. Part of the node's delimiters. */
  readonly span: Span;
  readonly contentSpan: Span;
};

export type EditNode = {
  readonly id: NodeId;
  readonly kind: EditNodeKind;
  /** Full source extent, delimiters included. */
  readonly span: Span;
  readonly slots: readonly SlotId[];
  /** Source owned by the construct itself (never items). */
  readonly delimiters: readonly Span[];
  readonly values: readonly EditValue[];
  /** The mode this node sits in. */
  readonly mode: EditMode;
  /** The control sequence or environment name, without the backslash. */
  readonly command?: string;
  readonly parent: SlotId | null;
};

export type EditSlot = {
  readonly id: SlotId;
  readonly node: NodeId;
  readonly role: SlotRole;
  /** An absent optional slot is a ghost; a present-but-empty one has one position. */
  readonly presence: "present" | "absent";
  /** Interior, without the slot's own delimiters; empty when absent or empty. */
  readonly contentSpan: Span;
  /** `\frac{1}{n}` vs `\frac1n`, `x^{2}` vs `x^2`. */
  readonly braced: boolean;
  /** The mode of the slot's content. */
  readonly mode: EditMode;
  /** Flow slots hold blocks (paragraphs, lists, displays); others hold inline items. */
  readonly flow: boolean;
  readonly children: readonly NodeId[];
};

export type EditTreeDiagnosticCode =
  | "unknown-command"
  | "unknown-environment"
  | "unclosed-group"
  | "unclosed-math"
  | "unclosed-environment"
  | "unmatched-close"
  | "missing-argument"
  | "double-script"
  | "script-in-text"
  | "stray-alignment-tab"
  | "text-before-first-item"
  | "nested-scope";

export type EditTreeDiagnostic = {
  readonly code: EditTreeDiagnosticCode;
  readonly span: Span;
  readonly message: string;
};

export type EditTree = {
  readonly text: string;
  readonly nodes: readonly EditNode[];
  readonly slots: readonly EditSlot[];
  /** The `scope` node; always id 0. */
  readonly root: NodeId;
  readonly diagnostics: readonly EditTreeDiagnostic[];
};
