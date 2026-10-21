import { describe, expect, it } from "vitest";
import { buildEditTree } from "../../packages/core/src/editing/tree/build.js";
import { createEditView } from "../../packages/core/src/editing/position/index.js";
import { indentItems, toggleList, type EditOutcome } from "../../packages/core/src/editing/operations/index.js";
import { capabilityChain, decideOwner } from "../../packages/core/src/editing/ownership/keys.js";
import { applyPatches } from "../../packages/core/src/editing/transaction/index.js";
import { formatMarkedSource, parseMarkedSource } from "../../packages/core/src/editing/testing/index.js";
import type { EditView } from "../../packages/core/src/editing/position/index.js";

const R = String.raw;
const lines = (...rows: string[]) => rows.join("\n");

/** Runs an operation on marked source and returns the marked result (unchanged when it does nothing). */
function run(marked: string, operation: (view: EditView, from: number, to: number) => EditOutcome): string {
  const { source, selection } = parseMarkedSource(marked);
  const view = createEditView(buildEditTree(source));
  const outcome = operation(view, Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus));
  if (outcome.kind !== "patch") {
    return marked;
  }
  const next = applyPatches(source, outcome.patches);
  return formatMarkedSource(next, { anchor: outcome.caret, focus: outcome.selectionEnd ?? outcome.caret });
}

const nest = (direction: "nest" | "unnest") => (view: EditView, from: number, to: number) =>
  indentItems(view, view.positionAt(from), view.positionAt(to), direction);
const toggle = (environment: "itemize" | "enumerate") => (view: EditView, from: number) =>
  toggleList(view, view.positionAt(from), environment);

const NESTED = (marked: string) => lines(
  R`\begin{itemize}`,
  R`\item Outer top`,
  R`\begin{itemize}`,
  ...["Alpha", "Beta", "Gamma"].map((name) => R`\item ${name} row`),
  R`\end{itemize}`,
  R`\item Outer last`,
  R`\end{itemize}`,
).replace(marked.replace(/[‸⟦⟧]/gu, ""), marked);

describe("structural keys: nesting items", () => {
  it("nests selected siblings together and unnests them back, keeping the selection", () => {
    const start = lines(R`\begin{itemize}`, R`\item First one`, R`\item ⟦Second two`, R`\item Third three⟧`, R`\end{itemize}`);
    const nested = run(start, nest("nest"));
    expect(nested).toBe(lines(
      R`\begin{itemize}`, R`\item First one`, R`\begin{itemize}`, R`\item ⟦Second two`, R`\item Third three⟧`, R`\end{itemize}`, R`\end{itemize}`
    ));
    expect(run(nested, nest("unnest"))).toBe(start);
  });

  it("does not nest the first item, nor unnest a top-level one", () => {
    const first = lines(R`\begin{itemize}`, R`\item ‸First`, R`\item Second`, R`\end{itemize}`);
    expect(run(first, nest("nest"))).toBe(first);
    expect(run(first, nest("unnest"))).toBe(first);
  });

  it("extends a nested list that ends the previous item instead of opening a second one", () => {
    const start = lines(R`\begin{itemize}`, R`\item One`, R`\begin{itemize}`, R`\item Two`, R`\end{itemize}`, R`\item ‸Three`, R`\end{itemize}`);
    expect(run(start, nest("nest"))).toBe(
      lines(R`\begin{itemize}`, R`\item One`, R`\begin{itemize}`, R`\item Two`, R`\item ‸Three`, R`\end{itemize}`, R`\end{itemize}`)
    );
  });

  it.each([
    ["‸Alpha", lines(R`\begin{itemize}`, R`\item Outer top`, R`\item ‸Alpha row`, R`\begin{itemize}`, R`\item Beta row`, R`\item Gamma row`, R`\end{itemize}`, R`\item Outer last`, R`\end{itemize}`)],
    ["‸Beta", lines(R`\begin{itemize}`, R`\item Outer top`, R`\begin{itemize}`, R`\item Alpha row`, R`\end{itemize}`, R`\item ‸Beta row`, R`\begin{itemize}`, R`\item Gamma row`, R`\end{itemize}`, R`\item Outer last`, R`\end{itemize}`)],
    ["‸Gamma", lines(R`\begin{itemize}`, R`\item Outer top`, R`\begin{itemize}`, R`\item Alpha row`, R`\item Beta row`, R`\end{itemize}`, R`\item ‸Gamma row`, R`\item Outer last`, R`\end{itemize}`)],
  ])("unnests the %s item", (marked, expected) => {
    expect(run(NESTED(marked), nest("unnest"))).toBe(expected);
  });

  it("unnests a lone nested item, removing its list", () => {
    const start = lines(R`\begin{itemize}`, R`\item Top`, R`\begin{itemize}`, R`\item ‸Lone`, R`\end{itemize}`, R`\item Last`, R`\end{itemize}`);
    expect(run(start, nest("unnest"))).toBe(lines(R`\begin{itemize}`, R`\item Top`, R`\item ‸Lone`, R`\item Last`, R`\end{itemize}`));
  });
});

describe("structural keys: the list toggle", () => {
  const list = (environment: string, ...items: string[]) =>
    lines(`\\begin{${environment}}`, ...items.map((item) => `\\item ${item}`), `\\end{${environment}}`);

  it("renames the list at the caret to the other kind", () => {
    expect(run(list("itemize", "One", "‸Two"), toggle("enumerate"))).toBe(list("enumerate", "One", "‸Two"));
  });

  it("dissolves the caret's item into prose when the kind matches", () => {
    expect(run(lines("Intro.", list("itemize", "One", "‸Two", "Three")), toggle("itemize"))).toBe(
      lines("Intro.", list("itemize", "One"), "‸Two", list("itemize", "Three"))
    );
  });

  it("dissolves a single-item list, keeping the paragraph breaks", () => {
    expect(run(lines("Intro.", list("itemize", "‸Only"), "Outro."), toggle("itemize"))).toBe(
      lines("Intro.", "", "‸Only", "", "Outro.")
    );
  });

  it("wraps a prose paragraph in a new list", () => {
    expect(run(lines(list("itemize", "One"), "‸Outro prose."), toggle("enumerate"))).toBe(
      lines(list("itemize", "One"), R`\begin{enumerate}`, R`\item ‸Outro prose.`, R`\end{enumerate}`)
    );
  });

  it("does nothing in a block title", () => {
    const marked = R`\begin{block}{Ti‸tle} body \end{block}`;
    expect(run(marked, toggle("itemize"))).toBe(marked);
  });
});

describe("structural keys: ownership", () => {
  const decide = (marked: string, key: "enter" | "line-break" | "tab") => {
    const { source, selection } = parseMarkedSource(marked);
    const view = createEditView(buildEditTree(source));
    const decision = decideOwner(capabilityChain(view.tree, key, view.positionAt(selection.focus).slot));
    return decision.kind === "stop" ? "stop" : view.tree.nodes[decision.node].kind;
  };

  it.each([
    [R`Let $a‸+b$ be.`, "paragraph"],
    [R`\begin{itemize} \item one \textbf{two‸ three} \end{itemize}`, "item"],
    [R`$\text{one $a‸+b$ two}$`, "stop"],
    [R`$\frac{a‸+b}{c}$`, "stop"],
    [R`\[ x‸ \]`, "display"],
    ["\\begin{align*}\n  a &= b‸\n\\end{align*}", "row"],
  ])("⏎ in %s goes to %s", (marked, owner) => {
    expect(decide(marked, "enter")).toBe(owner);
  });

  it.each([
    [R`$\frac{a‸+b}{c}$`, "fraction"],
    [R`\begin{itemize} \item $\frac{a‸}{b}$ \end{itemize}`, "fraction"],
    [R`\begin{itemize} \item on‸e \end{itemize}`, "item"],
    [R`Prose‸ only.`, "stop"],
  ])("⇥ in %s goes to %s", (marked, owner) => {
    expect(decide(marked, "tab")).toBe(owner);
  });
});
