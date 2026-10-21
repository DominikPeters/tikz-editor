import { describe, expect, it } from "vitest";

import type { Statement } from "../packages/core/src/ast/types.js";
import {
  applyTextReplacements,
  buildStatementSnapshotFromStatements,
  formatSnippetsForInsertion,
  groupStatementRefsByParent,
  lineIndentAtOffset,
  mapSpansToStatementIds,
  parseStatementSnapshot,
  resolveRootInsertionPoint,
  resolveStatementRefs,
  shiftSpansAfterReplacement,
  statementSnippet
} from "../packages/core/src/edit/statement-ops.js";
import { fragment } from "./fragment-helpers.js";

describe("statement ops", () => {
  it("builds nested snapshots and resolves deduplicated statement refs", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,0) -- (0,1);
  \end{scope}
\end{tikzpicture}`;
    const snapshot = parseStatementSnapshot(source);
    const nestedPath = snapshot.all.find((ref) => ref.parentKey !== "root" && ref.statement.kind === "Path");

    expect(nestedPath).toBeDefined();
    const refs = resolveStatementRefs(snapshot, [" path:0 ", "", "path:0", "missing", nestedPath?.id ?? ""]);
    expect(refs.map((ref) => ref.id)).toEqual(["path:0", nestedPath?.id]);

    const groups = groupStatementRefsByParent(refs);
    expect(groups[0]?.depth).toBeGreaterThanOrEqual(groups[1]?.depth ?? 0);
    expect(groups.flatMap((group) => group.refs).map((ref) => ref.id)).toContain("path:0");

    expect(statementSnippet(source, refs[0])).toContain("\\draw");
    expect(lineIndentAtOffset(source, Number.NaN)).toBe("");

    const analysisView = {
      source,
      activeFigureId: "figure:0",
      statementSnapshot: snapshot
    };
    expect(parseStatementSnapshot(source, {
      activeFigureId: "figure:0",
      analysisView
    } as never)).toBe(snapshot);
  });

  it("handles sparse synthetic statement arrays defensively", () => {
    const source = "\\draw (0,0) -- (1,0);";
    const statement = {
      kind: "Path",
      id: "b",
      span: { from: 0, to: source.length },
      command: "draw",
      options: [],
      items: []
    } as unknown as Statement;
    const sparse = new Array<Statement>(1);

    const emptySnapshot = buildStatementSnapshotFromStatements(source, sparse);
    expect(emptySnapshot.all).toEqual([]);
    expect(emptySnapshot.byParentKey.get("root")).toEqual([]);

    const first = {
      ...statement,
      id: "a",
      span: { from: 0, to: 1 }
    };
    const second = {
      ...statement,
      id: "b",
      span: { from: 2, to: 3 }
    };
    const tieGroups = groupStatementRefsByParent(
      [
        {
          id: "nested-b",
          span: { from: 0, to: 1 },
          statement: first,
          parentKey: "root/1",
          depth: 1,
          index: 0
        },
        {
          id: "nested-a",
          span: { from: 2, to: 3 },
          statement: second,
          parentKey: "root/0",
          depth: 1,
          index: 0
        },
        ...buildStatementSnapshotFromStatements("a b", [second, first]).all
      ]
    );
    expect(tieGroups.map((group) => group.parentKey)).toEqual(["root/0", "root/1", "root"]);
    expect(tieGroups[2]?.refs.map((ref) => ref.index)).toEqual([0, 1]);
  });

  it("formats snippets and insertion points across blank input and custom newlines", () => {
    expect(resolveRootInsertionPoint("\\draw (0,0);")).toEqual({ offset: 12, indent: "" });
    expect(resolveRootInsertionPoint("  \\end{tikzpicture}")).toEqual({ offset: 2, indent: "    " });
    expect(formatSnippetsForInsertion(["   ", "\t\\draw (0,0);\n"], "  ", {
      trailingNewline: true,
      newline: "\r\n"
    })).toEqual({
      text: "\n  \\draw (0,0);\r\n",
      snippetSpans: [{ from: 1, to: 15 }]
    });
    expect(formatSnippetsForInsertion(["   "], "  ")).toEqual({ text: "", snippetSpans: [] });
    expect(formatSnippetsForInsertion(["\\draw (0,0);"], "  ", {
      trailingNewline: true
    }).text).toBe("\n  \\draw (0,0);\n");
  });

  it("applies sorted replacements, rejects overlaps, and shifts spans by replacement shape", () => {
    const applied = applyTextReplacements("abcdef", [
      { span: { from: 4, to: 99 }, text: fragment("Z") },
      { span: { from: 0, to: 1 }, text: fragment("A") }
    ]);
    expect(applied.source).toBe("AbcdZ");
    expect(applied.applied).toEqual([
      { oldSpan: { from: 0, to: 1 }, newSpan: { from: 0, to: 1 } },
      { oldSpan: { from: 4, to: 6 }, newSpan: { from: 4, to: 5 } }
    ]);
    expect(applyTextReplacements("abc", [
      { span: { from: Number.NaN, to: Number.NaN }, text: fragment("!") }
    ])).toMatchObject({
      source: "!abc",
      applied: [{ oldSpan: { from: 0, to: 0 }, newSpan: { from: 0, to: 1 } }]
    });
    expect(applyTextReplacements("abc", [])).toEqual({ source: "abc", patches: [], applied: [] });
    expect(() => applyTextReplacements("abcdef", [
      { span: { from: 1, to: 4 }, text: fragment("X") },
      { span: { from: 3, to: 5 }, text: fragment("Y") }
    ])).toThrow("Overlapping replacements");

    expect(shiftSpansAfterReplacement([], { from: 1, to: 3 }, { from: 1, to: 2 })).toEqual([]);
    expect(shiftSpansAfterReplacement([
      { from: 0, to: 1 },
      { from: 4, to: 5 },
      { from: 2, to: 3 },
      { from: 5, to: 6 },
      { from: 1, to: 5 }
    ], { from: 1, to: 5 }, { from: 1, to: 3 })).toEqual([
      { from: 0, to: 1 },
      { from: 3, to: 3 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
      { from: 1, to: 3 }
    ]);
  });

  it("maps exact, contained, and overlapping spans back to statement ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \node at (0,0) {A};
\end{tikzpicture}`;
    const snapshot = parseStatementSnapshot(source);
    const first = snapshot.all.find((ref) => source.slice(ref.span.from, ref.span.to).includes("\\draw"));
    const second = snapshot.all.find((ref) => source.slice(ref.span.from, ref.span.to).includes("\\node"));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) {
      throw new Error("Expected two statements");
    }

    expect(mapSpansToStatementIds(source, [])).toEqual([]);
    expect(mapSpansToStatementIds(source, [
      first.span,
      { from: first.span.from + 2, to: first.span.to - 2 },
      { from: second.span.from - 1, to: second.span.from + 4 },
      { from: first.span.from, to: second.span.to },
      { from: source.length + 10, to: source.length + 20 }
    ])).toEqual([first.id, second.id]);
  });
});
