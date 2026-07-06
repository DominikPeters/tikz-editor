import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { mapGroupText, mapSyntheticNodeItem } from "../packages/core/src/domains/nodes/parse.js";
import { parseSyntax } from "@tikz-editor/lezer-tikz";
import { findFirstNodeByName } from "../packages/core/src/syntax/cursor.js";

function nodesFrom(source: string) {
  return parseTikz(source, { recover: true }).figure.body.flatMap((statement) =>
    statement.kind === "Path" ? statement.items.filter((item) => item.kind === "Node") : []
  );
}

describe("node domain parsing", () => {
  it("prefers explicit node names while preserving option aliases, node contents, and relative option placement", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[name={(from option)},alias=left alias,alias={(right alias)},at={++(1,2)},node contents={Option Text}] (explicit name);
\end{tikzpicture}`;

    const [node] = nodesFrom(source);

    expect(node?.kind).toBe("Node");
    expect(node?.name).toBe("explicit name");
    expect(node?.aliases).toEqual(["left alias", "right alias"]);
    expect(node?.atRaw).toBe("(1,2)");
    expect(node?.atRelativePrefix).toBe("++");
    expect(node?.text).toBe("Option Text");
    expect(node?.textSource).toBe("option");
  });

  it("merges direct and qualifier option lists around foreach clauses into a reusable node template", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node foreach \x [count=\i] in {A,B} [draw] [name=n\x] at +(1,2) {Value \x};
\end{tikzpicture}`;

    const [node] = nodesFrom(source);

    expect(node?.foreachClauses).toHaveLength(1);
    expect(node?.foreachClauses?.[0]?.variablesRaw).toBe("\\x");
    expect(node?.foreachClauses?.[0]?.listRaw).toBe("{A,B}");
    expect(node?.foreachClauses?.[0]?.options?.entries.some((entry) => entry.kind === "kv" && entry.key === "count")).toBe(true);
    expect(node?.templateRaw).toContain("node [draw] [name=n\\x] at +(1,2) {Value \\x}");
    expect(node?.templateRaw).not.toContain("foreach");
    expect(node?.atRaw).toBe("(1,2)");
    expect(node?.atRelativePrefix).toBe("+");
    expect(node?.text).toBe("Value \\x");
  });

  it("maps synthetic nodes with implicit flags, option text, aliases, and fallback empty spans", () => {
    const source = String.raw`\begin{tikzpicture}\path node[draw,name=synth,alias={(copy)},node contents={Synthetic}];\end{tikzpicture}`;
    const tree = parseSyntax(source);
    const optionList = findFirstNodeByName(tree.topNode, "OptionList");
    expect(optionList).not.toBeNull();
    if (!optionList) {
      return;
    }

    const node = mapSyntheticNodeItem(null, [optionList], source, 2, 3, {
      implicitFlags: ["draw", "transform shape"]
    });

    expect(node.name).toBe("synth");
    expect(node.aliases).toEqual(["copy"]);
    expect(node.text).toBe("Synthetic");
    expect(node.textSource).toBe("option");
    expect(node.options?.entries.filter((entry) => entry.kind === "flag").map((entry) => entry.key)).toEqual(["draw", "transform shape"]);

    const empty = mapSyntheticNodeItem(null, [], "", 0, 0, { implicitFlags: ["circle"] });
    expect(empty.span).toEqual({ from: 0, to: 1 });
    expect(empty.options?.raw).toBe("[circle]");
    expect(mapGroupText(null, "", 7)).toEqual({ textSpan: { from: 7, to: 7 }, text: "" });
  });

  it("keeps unbraced group text and malformed option placements defensive", () => {
    const textSource = "bare text";
    const textTree = parseSyntax(textSource);
    const root = textTree.topNode;
    expect(mapGroupText(root, textSource, 0)).toEqual({
      textSpan: { from: 0, to: textSource.length },
      text: textSource
    });

    const source = String.raw`\begin{tikzpicture}
  \path node[name={},alias={},at=not-a-coordinate,node contents] {};
\end{tikzpicture}`;
    const [node] = nodesFrom(source);

    expect(node?.name).toBeUndefined();
    expect(node?.aliases).toBeUndefined();
    expect(node?.atRaw).toBeUndefined();
    expect(node?.text).toBe("");
  });
});
