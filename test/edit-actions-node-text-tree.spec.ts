import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { TIKZPICTURE_GLOBAL_TARGET_ID } from "../packages/core/src/edit/property-target.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

describe("applyEditAction – updateNodeText", () => {
  it("replaces only node text span for node path statement ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {$x+y$};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "path:0",
      text: "$x-y$"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected node text update to succeed");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {$x-y$};
\end{tikzpicture}`);
    expect(result.patches).toHaveLength(1);
  });

  it("replaces the selected repeated path-attached node text when neighboring coordinates use macros", () => {
    const source = String.raw`\begin{tikzpicture}
  \def\r{0.9}
  \draw[<->, thick] (0.02,0) -- node[above, sloped] {$r$} (\r-0.02,0);
  \draw[<->, thick] (\r+0.02,0) -- node[above, sloped] {$r$} (2*\r-0.01,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:2:3",
      text: "$R$"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected node text update to succeed");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \def\r{0.9}
  \draw[<->, thick] (0.02,0) -- node[above, sloped] {$r$} (\r-0.02,0);
  \draw[<->, thick] (\r+0.02,0) -- node[above, sloped] {$R$} (2*\r-0.01,0);
\end{tikzpicture}`);
    expect(result.patches).toHaveLength(1);
  });

  it("updates matrix cell text by synthetic matrix-cell ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:0:0:matrix-cell:1:2",
      text: "Beta"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix cell text update to succeed");
    }
    expect(result.newSource).toContain("A & Beta");
    expect(result.newSource).toContain("Beta \\\\");
    expect(result.patches).toHaveLength(1);
  });

  it("updates matrix-of-math-nodes cell text by synthetic matrix-cell ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of math nodes] {
    x^2 & y^2 \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:0:0:matrix-cell:1:2",
      text: "\\frac{1}{y}"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-of-math-nodes text update to succeed");
    }
    expect(result.newSource).toContain("x^2 & \\frac{1}{y}");
    expect(result.patches).toHaveLength(1);
  });

  it("updates tree child text by synthetic tree-child ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} child { node {left-left} } };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const left = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    const leftLeft = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left-left"
    );
    if (!left || left.kind !== "Text" || !left.treeChild || !leftLeft || leftLeft.kind !== "Text" || !leftLeft.treeChild) {
      throw new Error("Expected direct and nested tree-child text elements");
    }

    const nestedChildResult = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: leftLeft.treeChild.childSourceId,
      text: "left-left*"
    });
    expect(nestedChildResult.kind).toBe("success");
    if (nestedChildResult.kind !== "success") {
      throw new Error("Expected nested tree-child text edit to succeed");
    }
    expect(nestedChildResult.newSource).toContain("node {left-left*}");

    const directChildResult = applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: left.treeChild.childSourceId,
      text: "left*"
    });
    expect(directChildResult.kind).toBe("success");
    if (directChildResult.kind !== "success") {
      throw new Error("Expected direct tree-child text edit to succeed");
    }
    expect(directChildResult.newSource).toContain("node {left*}");
  });

  it("rejects blank, missing, and no-op node text updates", () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {A};
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "  ",
      text: "B"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "node:missing",
      text: "B"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "updateNodeText",
      elementId: "path:0",
      text: "A"
    })).toEqual({
      kind: "unsupported",
      reason: "Node text update would not change the source."
    });
  });

  it("adds a child to a selected tree root", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addTreeChild on root to succeed");
    }
    expect(result.newSource).toContain("child { node {left} }");
    expect(result.newSource).toContain("child { node {New} }");
  });

  it("rejects tree child actions for empty, unresolved, non-tree, and foreach-expanded targets", () => {
    const plainSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: ""
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0"
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: "missing"
    })).toEqual({
      kind: "unsupported",
      reason: "Could not resolve tree parent missing."
    });
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeChild",
      parentSourceId: TIKZPICTURE_GLOBAL_TARGET_ID
    })).toEqual({
      kind: "unsupported",
      reason: "Tree child insertion requires selecting a tree root or tree child."
    });
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeSibling",
      siblingSourceId: "",
      position: "after"
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "addTreeSibling",
      siblingSourceId: "path:0",
      position: "after"
    })).toEqual({
      kind: "unsupported",
      reason: "Could not resolve tree sibling path:0."
    });
    expect(applyEditAction(plainSource, [], {
      kind: "removeTreeChild",
      childSourceId: ""
    }).kind).toBe("unsupported");
    expect(applyEditAction(plainSource, [], {
      kind: "removeTreeChild",
      childSourceId: "path:0"
    })).toEqual({
      kind: "unsupported",
      reason: "Could not resolve tree child path:0."
    });

    const foreachSource = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const parsed = parseTikz(foreachSource, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;
    expect(applyEditAction(foreachSource, [], {
      kind: "addTreeChild",
      parentSourceId: syntheticChildId
    }).kind).toBe("unsupported");
    expect(applyEditAction(foreachSource, [], {
      kind: "addTreeSibling",
      siblingSourceId: syntheticChildId,
      position: "after"
    }).kind).toBe("unsupported");
    expect(applyEditAction(foreachSource, [], {
      kind: "removeTreeChild",
      childSourceId: syntheticChildId
    }).kind).toBe("unsupported");
  });

  it("inserts root children after explicit child indices with fallback to the last child", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`;

    const afterFirst = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0",
      afterChildIndex: 0
    });
    expect(afterFirst.kind).toBe("success");
    if (afterFirst.kind !== "success") {
      throw new Error("Expected indexed root child insertion");
    }
    expect(afterFirst.newSource).toMatch(/node \{left\}[\s\S]*child \{ node \{New\} \}[\s\S]*node \{right\}/);

    const afterOutOfRange = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0",
      afterChildIndex: 99
    });
    expect(afterOutOfRange.kind).toBe("success");
    if (afterOutOfRange.kind !== "success") {
      throw new Error("Expected fallback root child insertion");
    }
    expect(afterOutOfRange.newSource).toMatch(/node \{right\}[\s\S]*child \{ node \{New\} \}/);
  });

  it("adds the first child to a CRLF tree root before trailing semicolon whitespace", () => {
    const source = "\\begin{tikzpicture}\r\n  \\path node {root}   ;\r\n\\end{tikzpicture}";
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: statement.id
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addTreeChild on childless root to succeed");
    }
    expect(result.newSource).toContain("\\path node {root}   \r\n    child { node {New} };");
    renderTikzToSvg(result.newSource);
  });

  it("adds children to tree roots nested inside scopes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \path node {root};
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:1"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected nested root child insertion to succeed");
    }
    expect(result.newSource).toContain("    \\path node {root}\n      child { node {New} };");
  });

  it("adds a child to a semicolonless tree root at the statement tail", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected semicolonless root child insertion to succeed");
    }
    expect(result.newSource).toContain("node {root}\n\n    child { node {New} }");
  });

  it("adds a nested child when a tree child is selected", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "addTreeChild",
      parentSourceId: leftText.treeChild.childSourceId
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addTreeChild on child to succeed");
    }
    expect(result.newSource).toContain("child { node {left}");
    expect(result.newSource).toContain("child { node {New} }");
  });

  it("adds tree siblings before and after a selected child", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected left tree child text element");
    }
    const leftId = leftText.treeChild.childSourceId;

    const after = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leftId,
      position: "after"
    });
    expect(after.kind).toBe("success");
    if (after.kind !== "success") {
      throw new Error("Expected addTreeSibling(after) to succeed");
    }
    expect(after.newSource).toMatch(/node \{left\}[\s\S]*child \{ node \{New\} \}[\s\S]*node \{right\}/);

    const before = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leftId,
      position: "before"
    });
    expect(before.kind).toBe("success");
    if (before.kind !== "success") {
      throw new Error("Expected addTreeSibling(before) to succeed");
    }
    expect(before.newSource).toMatch(/child \{ node \{New\} \}[\s\S]*node \{left\}/);
  });

  it("removes a selected tree child by synthetic id", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {left} }
    child { node {right} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rightText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "right"
    );
    if (!rightText || rightText.kind !== "Text" || !rightText.treeChild) {
      throw new Error("Expected right tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "removeTreeChild",
      childSourceId: rightText.treeChild.childSourceId
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected removeTreeChild to succeed");
    }
    expect(result.newSource).toContain("child { node {left} }");
    expect(result.newSource).not.toContain("node {right}");
  });

  it("removes a selected CRLF tree child together with surrounding line whitespace", () => {
    const source = "\\begin{tikzpicture}\r\n  \\path node {root}\r\n    child { node {left} }\r\n    child { node {right} };\r\n\\end{tikzpicture}";
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected left tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "removeTreeChild",
      childSourceId: leftText.treeChild.childSourceId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected CRLF removeTreeChild to succeed");
    }
    expect(result.newSource).not.toContain("node {left}");
    expect(result.newSource).toContain("\r\n    child { node {right} };");
  });

  it("removes a final CRLF tree child with trailing spaces before the semicolon", () => {
    const source = "\\begin{tikzpicture}\r\n  \\path node {root}\r\n    child { node {left} }\r\n    child { node {right} }   ;\r\n\\end{tikzpicture}";
    const rendered = renderTikzToSvg(source);
    const rightText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "right"
    );
    if (!rightText || rightText.kind !== "Text" || !rightText.treeChild) {
      throw new Error("Expected right tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "removeTreeChild",
      childSourceId: rightText.treeChild.childSourceId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected final CRLF removeTreeChild to succeed");
    }
    expect(result.newSource).not.toContain("node {right}");
    expect(result.newSource).toContain("child { node {left} };");
  });

  it("keeps nested tree structure valid when adding children to deep descendants", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=15mm,sibling distance=10mm]
    node[draw,rounded corners=2pt,fill=blue!10] {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leaves = rendered.semantic.scene.elements.filter(
      (entry) => entry.kind === "Text" && (entry.text === "Leaf B1" || entry.text === "Leaf B2")
    );
    expect(leaves).toHaveLength(2);

    for (const leaf of leaves) {
      if (leaf.kind !== "Text" || !leaf.treeChild) {
        throw new Error("Expected tree-child text for deep leaf");
      }
      const result = applyEditAction(source, [], {
        kind: "addTreeChild",
        parentSourceId: leaf.treeChild.childSourceId
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error("Expected addTreeChild on deep descendant to succeed");
      }
      const rerendered = renderTikzToSvg(result.newSource);
      const newTexts = rerendered.semantic.scene.elements.filter(
        (entry) => entry.kind === "Text" && entry.text === "New"
      );
      expect(newTexts.length).toBeGreaterThanOrEqual(1);
      expect(result.newSource).toContain("Leaf B1");
      expect(result.newSource).toContain("Leaf B2");
    }
  });

  it("keeps nested tree structure valid when adding siblings around deep descendants", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=15mm,sibling distance=10mm]
    node[draw,rounded corners=2pt,fill=blue!10] {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafB1 = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "Leaf B1"
    );
    const leafB2 = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "Leaf B2"
    );
    if (!leafB1 || leafB1.kind !== "Text" || !leafB1.treeChild || !leafB2 || leafB2.kind !== "Text" || !leafB2.treeChild) {
      throw new Error("Expected deep tree descendants");
    }

    const afterB1 = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leafB1.treeChild.childSourceId,
      position: "after"
    });
    expect(afterB1.kind).toBe("success");
    if (afterB1.kind !== "success") {
      throw new Error("Expected addTreeSibling(after) on Leaf B1 to succeed");
    }
    renderTikzToSvg(afterB1.newSource);
    expect(afterB1.newSource).toContain("Leaf B1");
    expect(afterB1.newSource).toContain("Leaf B2");
    expect(afterB1.newSource).toContain("node {New}");

    const beforeB2 = applyEditAction(source, [], {
      kind: "addTreeSibling",
      siblingSourceId: leafB2.treeChild.childSourceId,
      position: "before"
    });
    expect(beforeB2.kind).toBe("success");
    if (beforeB2.kind !== "success") {
      throw new Error("Expected addTreeSibling(before) on Leaf B2 to succeed");
    }
    renderTikzToSvg(beforeB2.newSource);
    expect(beforeB2.newSource).toContain("Leaf B1");
    expect(beforeB2.newSource).toContain("Leaf B2");
    expect(beforeB2.newSource).toContain("node {New}");
  });
});
