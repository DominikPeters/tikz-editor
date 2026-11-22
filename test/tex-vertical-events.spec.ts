import { describe, expect, it } from "vitest";
import { parseSimpleTexParagraphIr } from "../packages/core/src/text/tex/ir.js";

function events(source: string): string[] {
  return (parseSimpleTexParagraphIr(source).verticalEvents ?? []).map(event => {
    switch (event.kind) {
      case "list-begin": return `list-begin:${event.listKind}:${event.depth}${event.inheritsPendingLabel ? ":inherits" : ""}`;
      case "item": return `item:${event.depth}:${event.itemIndex}`;
      case "list-end": return `list-end:${event.depth}`;
      case "trivlist-begin": return `trivlist-begin:${event.envName}${event.noParList ? ":noparlist" : ""}`;
      case "trivlist-end": return `trivlist-end:${event.envName}`;
      default: return event.kind;
    }
  });
}

describe("vertical events", () => {
  it("records list, item, trivlist and paragraph boundaries in source order", () => {
    expect(events(String.raw`Lead.\par
\begin{itemize}
\item One.
\item \begin{enumerate}\item Inner.\end{enumerate}
Tail.
\end{itemize}
\begin{center}Centered.\end{center}`)).toEqual([
      "par",
      "list-begin:itemize:1",
      "item:1:1",
      "item:1:2",
      "list-begin:enumerate:2:inherits",
      "item:2:1",
      "list-end:2",
      "list-end:1",
      "trivlist-begin:center",
      "trivlist-end:center",
    ]);
  });

  it("marks an alignment that takes a pending item label as @noparlist", () => {
    expect(events(String.raw`\begin{itemize}\item \begin{center}X\end{center}\end{itemize}`)).toEqual([
      "list-begin:itemize:1", "item:1:1", "trivlist-begin:center:noparlist", "trivlist-end:center", "list-end:1",
    ]);
  });

  it("records groups that scope declarations", () => {
    expect(events(String.raw`A\par{\small B\par}C`)).toEqual(["par", "group-begin", "par", "group-end"]);
  });
});
