import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { isUngroupableScopeStatement } from "../packages/core/src/edit/actions/group-ungroup-actions.js";
import { buildParentReorderReplacement } from "../packages/core/src/edit/actions/reorder-elements.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { wp } from "./coords-helpers.js";
import { cm } from "./edit-actions-helpers.js";

// ── addElement / unimplemented actions ─────────────────────────────────────────

describe("applyEditAction – addElement", () => {
  it("inserts a node snippet before \\end{tikzpicture}", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: { kind: "node", text: "A" },
      at: wp(cm(2), cm(3))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\node at (2,3) {A};");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("inserts a bezier snippet with explicit controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: {
        kind: "bezier",
        to: wp(cm(3), cm(1)),
        control1: wp(cm(1), cm(2)),
        control2: wp(cm(2), cm(2))
      },
      at: wp(cm(0), cm(0))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\draw (0,0) .. controls (1,2) and (2,2) .. (3,1);");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("inserts a line snippet with named anchor endpoints", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {};
  \node (B) at (1,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: {
        kind: "line",
        hasArrow: true,
        fromAnchor: { nodeName: "A", anchor: "center" },
        toAnchor: { nodeName: "B", anchor: "east" },
        to: wp(cm(2), cm(0))
      },
      at: wp(cm(0), cm(0))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("  \\draw[->] (A) -- (B.east);");
      expect(result.newSource).toContain("\\end{tikzpicture}");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("inserts a matrix snippet without delimiter options by default", () => {
    const source = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: {
        kind: "matrix",
        rows: 2,
        columns: 3,
        matrixKind: "nodes"
      },
      at: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\matrix [matrix of nodes] at (1,2) {");
      expect(result.newSource).toContain("A & B & C \\\\");
      expect(result.newSource).toContain("D & E & F \\\\");
      expect(result.newSource).not.toContain("left delimiter");
      expect(result.newSource).not.toContain("right delimiter");
      expect(result.patches).toHaveLength(1);
    }
  });
});

describe("applyEditAction – deleteElement", () => {
  it("rejects empty and unresolved delete selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: [" ", " "]
    })).toEqual({
      kind: "unsupported",
      reason: "No element ids were provided for deleteElements"
    });

    expect(applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: ["missing", "missing"]
    })).toEqual({
      kind: "unsupported",
      reason: "No deletable source span was found for the selected element(s)"
    });
  });

  it("deletes a whole path statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).not.toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("deletes nested scope statements and CRLF trailing statements cleanly", () => {
    const nestedSource = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const nested = applyEditAction(nestedSource, [], {
      kind: "deleteElement",
      elementId: "path:1"
    });
    expect(nested.kind).toBe("success");
    if (nested.kind !== "success") {
      throw new Error("Expected nested statement deletion to succeed");
    }
    expect(nested.newSource).not.toContain("(0,0) -- (1,0)");
    expect(nested.newSource).toContain("\\begin{scope}");

    const crlfSource = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n  \\draw (0,1) -- (1,1);\r\n\\end{tikzpicture}";
    const crlf = applyEditAction(crlfSource, [], {
      kind: "deleteElement",
      elementId: "path:1"
    });
    expect(crlf.kind).toBe("success");
    if (crlf.kind !== "success") {
      throw new Error("Expected CRLF trailing statement deletion to succeed");
    }
    expect(crlf.newSource).toBe("\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n\\end{tikzpicture}");
  });

  it("deletes a single node path as a whole statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \node {Only};
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "node:0:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected single-node path deletion to succeed");
    }
    expect(result.newSource).not.toContain("Only");
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
  });

  it("deletes multiple elements in one action", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: ["path:0", "path:2"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).not.toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(result.newSource).not.toContain("\\draw (0,2) -- (1,2);");
    }
  });

  it("deletes a same-line statement without swallowing the next statement", () => {
    const source = "\\begin{tikzpicture}\\draw (0,0) -- (1,0);   \\draw (0,1) -- (1,1);\\end{tikzpicture}";

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected same-line statement deletion to succeed");
    }
    expect(result.newSource).toBe("\\begin{tikzpicture}\\draw (0,1) -- (1,1);\\end{tikzpicture}");
  });

  it("prunes deleted node references from fit options", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("(a)");
    expect(result.newSource).toContain("fit=(b)");
  });

  it("deletes a node item from a compound path without removing the path", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node[above] {A} -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "node:0:1"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    expect(result.newSource).not.toContain("node[above]");
  });

  it("deletes a path-attached node inside an edge operation", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) edge node[midway] {label} (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const edge = statement.items.find((item) => item.kind === "EdgeOperation");
    if (!edge || edge.kind !== "EdgeOperation" || !edge.nodes?.[0]) throw new Error("Expected edge node");

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: edge.nodes[0].id
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected edge-node deletion to succeed");
    }
    expect(result.newSource).toContain("\\path (0,0) edge (1,0);");
    expect(result.newSource).not.toContain("label");
  });

  it("deletes path items with leading whitespace when there is no trailing gap", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0)--node[midway]{A}(1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "node:0:2"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected compact node deletion to succeed");
    }
    expect(result.newSource).toContain("\\draw (0,0)--(1,0);");
  });

  it("deletes a path-attached node inside a to operation", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) to node[midway] {label} (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "to-node:0:1:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).toContain("\\draw (0,0) to (1,0);");
    expect(result.newSource).not.toContain("label");
  });

  it("collapses overlapping statement and child selections before deletion", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {A};
  \draw (1,0) -- (2,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElements",
      elementIds: ["path:0", "node:0:1", "path:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.patches).toHaveLength(1);
    expect(result.newSource).not.toContain("node {A}");
    expect(result.newSource).toContain("\\draw (1,0) -- (2,0);");
  });

  it("removes fit and rotate fit when deleted names exhaust the fit list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[alias=oldA] (a) at (0,0) {};
  \node[draw,fit={(oldA.south) (a)},rotate fit=30] (f) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("fit=");
    expect(result.newSource).not.toContain("rotate fit");
    expect(result.changedSourceIds).toEqual(["node:0:1"]);
  });

  it("prunes deleted tree node names from mixed fit lists without touching malformed fits", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node (leaf) {leaf} };
  \node[draw,fit={(leaf) (0,0) (\ignored)}] (mixed) {};
  \node[draw,fit={not-a-coordinate}] (textfit) {};
  \node[draw,fit={}] (emptyfit) {};
  \node[draw,fit=] (emptyValueFit) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree delete with fit pruning to succeed");
    }
    expect(result.newSource).not.toContain("node (leaf)");
    expect(result.newSource).toContain("fit={(0,0) (\\ignored)}");
    expect(result.newSource).toContain("fit={not-a-coordinate}");
    expect(result.newSource).toContain("fit={}");
    expect(result.newSource).toContain("fit=] (emptyValueFit)");
    expect(result.changedSourceIds).toEqual(["node:0:1"]);
  });

  it("does not crash when a remaining node has a bare fit flag", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (gone) at (0,0) {};
  \node[draw,fit] (bareFit) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected bare-fit deletion to succeed");
    }
    expect(result.newSource).toContain("\\node[draw,fit] (bareFit) {};");
    expect(result.changedSourceIds).toEqual([]);
  });

  it("prunes valid deleted fit references while preserving malformed surrounding tokens", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (gone) at (0,0) {};
  \node[draw,fit={) (gone) (0,0)}] (malformedClose) {};
  \node[draw,fit=(kept)] (keptFit) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteElement",
      elementId: "path:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected malformed fit pruning to succeed");
    }
    expect(result.newSource).toContain("fit={(0,0)}");
    expect(result.newSource).toContain("fit=(kept)");
    expect(result.changedSourceIds).toEqual(["node:0:1"]);
  });
});

describe("applyEditAction – reorderElements", () => {
  it("rejects empty or unresolved reorder selections after id normalization", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: [" ", "", "path:0", "path:0", 42 as never],
      direction: "sendBackward"
    }).kind).toBe("success");
    expect(applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: [" ", 42 as never],
      direction: "sendBackward"
    }).kind).toBe("unsupported");
    expect(applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["missing"],
      direction: "bringForward"
    }).kind).toBe("unsupported");
  });

  it("brings a single statement forward by one slot", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringForward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
  });

  it("leaves boundary reorder requests unchanged while preserving selection ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const alreadyBack = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "sendBackward"
    });
    expect(alreadyBack.kind).toBe("success");
    if (alreadyBack.kind !== "success") return;
    expect(alreadyBack.newSource).toBe(source);
    expect(alreadyBack.patches).toEqual([]);
    expect(alreadyBack.selectedSourceIds).toEqual(["path:0"]);

    const alreadyFront = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "bringForward"
    });
    expect(alreadyFront.kind).toBe("success");
    if (alreadyFront.kind !== "success") return;
    expect(alreadyFront.newSource).toBe(source);
    expect(alreadyFront.patches).toEqual([]);
    expect(alreadyFront.selectedSourceIds).toEqual(["path:1"]);
  });

  it("sends a single statement backward by one slot", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "sendBackward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
  });

  it("supports sendToBack and bringToFront", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const toBack = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:2"],
      direction: "sendToBack"
    });
    expect(toBack.kind).toBe("success");
    if (toBack.kind === "success") {
      expect(toBack.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
        toBack.newSource.indexOf("\\draw (0,0) -- (1,0);")
      );
    }

    const toFront = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringToFront"
    });
    expect(toFront.kind).toBe("success");
    if (toFront.kind === "success") {
      expect(toFront.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
        toFront.newSource.indexOf("\\draw (0,0) -- (1,0);")
      );
    }
  });

  it("keeps contiguous multi-selection stable while moving one step forward", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1", "path:2"],
      direction: "bringForward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
  });

  it("moves non-contiguous multi-selection one step backward per statement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1", "path:3"],
      direction: "sendBackward"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource.indexOf("\\draw (0,1) -- (1,1);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
  });

  it("keeps statements separated by newline+indent when reordering forward/backward", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);\draw[fill=gray] (-1.31,1.23) rectangle (1,-0.29);

  \draw (-2.5, 2.5) -- (2.5, 2.5);
\end{tikzpicture}`;

    const backward = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:1"],
      direction: "sendBackward"
    });
    expect(backward.kind).toBe("success");
    if (backward.kind !== "success") return;
    expect(backward.newSource).not.toContain(";\\draw");
    expect(backward.newSource).toContain(";\n  \\draw");

    const forward = applyEditAction(backward.newSource, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringForward"
    });
    expect(forward.kind).toBe("success");
    if (forward.kind !== "success") return;
    expect(forward.newSource).not.toContain(";\\draw");
    expect(forward.newSource).toContain(";\n  \\draw");
  });

  it("reorders mixed-parent selections per parent list", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
    \draw (0,2) -- (1,2);
  \end{scope}
  \draw (0,3) -- (1,3);
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const scope = parsed.figure.body.find((statement) => statement.kind === "Scope");
    expect(scope?.kind).toBe("Scope");
    if (!scope || scope.kind !== "Scope") {
      throw new Error("Expected a scope statement.");
    }
    const nestedFirst = scope.body.find((statement) => statement.kind === "Path");
    expect(nestedFirst?.kind).toBe("Path");
    if (!nestedFirst || nestedFirst.kind !== "Path") {
      throw new Error("Expected a nested path statement.");
    }

    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0", nestedFirst.id],
      direction: "bringToFront"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource.indexOf("\\draw (0,3) -- (1,3);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,0) -- (1,0);")
    );
    expect(result.newSource.indexOf("\\draw (0,2) -- (1,2);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
  });

  it("uses CRLF separators and tolerates missing ids in direct replacement building", () => {
    const source = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n  \\draw (0,1) -- (1,1);\r\n\\end{tikzpicture}";
    const first = source.indexOf("\\draw (0,0)");
    const second = source.indexOf("\\draw (0,1)");
    const refs = [
      { id: "a", span: { from: first, to: source.indexOf(";", first) + 1 }, parentKey: "root", index: 0 },
      { id: "b", span: { from: second, to: source.indexOf(";", second) + 1 }, parentKey: "root", index: 1 }
    ];

    expect(buildParentReorderReplacement(source, [], [])).toBeNull();
    const replacement = buildParentReorderReplacement(source, refs as never, ["missing", "b", "a"]);
    expect(replacement?.text).toContain("\r\n  ");
    expect(replacement?.newSpansById.has("missing")).toBe(false);
    expect(replacement?.text.indexOf("\\draw (0,1)")).toBeLessThan(replacement?.text.indexOf("\\draw (0,0)") ?? 0);

    const adjacent = buildParentReorderReplacement("ab", [
      { id: "a", span: { from: 0, to: 1 }, parentKey: "root", index: 0 },
      { id: "b", span: { from: 1, to: 2 }, parentKey: "root", index: 1 }
    ] as never, ["b", "a"]);
    expect(adjacent?.text).toBe("b\na");
  });
});

describe("applyEditAction – group/ungroup", () => {
  it("rejects too-small, unresolved, and cross-parent group selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0"]
    })).toEqual({
      kind: "unsupported",
      reason: "Group requires at least two selected statements."
    });

    expect(applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "missing"]
    })).toEqual({
      kind: "unsupported",
      reason: "Group requires at least two selected statements."
    });

    const crossParent = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:2"]
    });
    expect(crossParent.kind).toBe("unsupported");
    if (crossParent.kind !== "unsupported") return;
    expect(crossParent.reason).toContain("same parent scope");
  });

  it("groups contiguous sibling statements into a scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:1"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}");
    expect(result.newSource).toContain("\\end{scope}");
    expect(result.newSource.indexOf("\\begin{scope}")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,2) -- (1,2);")
    );
    expect(result.selectedSourceIds?.[0]?.startsWith("scope:")).toBe(true);
  });

  it("groups with configured indentation width", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1, -1) {B};
  \draw (-1.35,-2.28) rectangle (2.2,-3.4);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:1"]
    }, {
      parseOptions: {
        indentSize: 4
      }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n      \\node[draw] (A) at (-1, -1) {A};");
    expect(result.newSource).toContain("\n      \\node[draw] (B) at (1, -1) {B};");
  });

  it("groups normalized statement ids while preserving CRLF separators", () => {
    const source = [
      String.raw`\begin{tikzpicture}`,
      String.raw`  \draw (0,0) -- (1,0);`,
      String.raw`  \draw (0,1) -- (1,1);`,
      String.raw`  \draw (0,2) -- (1,2);`,
      String.raw`\end{tikzpicture}`
    ].join("\r\n");

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["node:ignored", "path:0", "path:0", "path:1"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\r\n  \\begin{scope}\r\n");
    expect(result.newSource).toContain("\r\n    \\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\r\n    \\draw (0,1) -- (1,1);");
    expect(result.newSource).toContain("\r\n  \\draw (0,2) -- (1,2);");
  });

  it("infers grouping indentation from the shortest existing child indent", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
      \draw (0,0) -- (1,0);
        \draw (0,1) -- (1,1);
      \draw (0,2) -- (1,2);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:1", "path:2"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n      \\begin{scope}\n");
    expect(result.newSource).toContain("\n        \\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\n        \\draw (0,1) -- (1,1);");
  });

  it("keeps grouped children on their own source ids for downstream selection and drag", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1, -1) {B};
  \draw (-1.35,-2.28) rectangle (2.2,-3.4);
\end{tikzpicture}`;

    const grouped = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:1"]
    });
    expect(grouped.kind).toBe("success");
    if (grouped.kind !== "success") return;

    const parsed = parseTikz(grouped.newSource, { recover: true, includeContextDefinitions: true });
    const semantic = evaluateTikzFigure(parsed.figure, grouped.newSource);
    const sourceIds = new Set(semantic.scene.elements.map((element) => element.sourceRef.sourceId));

    expect(sourceIds.has("path:1")).toBe(true);
    expect(sourceIds.has("path:2")).toBe(true);
    expect(sourceIds.has("scope:0")).toBe(false);
  });

  it("groups non-contiguous statements at a dependency-safe position", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (a) at (0,0);
  \draw (a) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (a) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:3"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const beginScopeIndex = result.newSource.indexOf("\\begin{scope}");
    expect(beginScopeIndex).toBeGreaterThanOrEqual(0);
    expect(beginScopeIndex).toBeLessThan(result.newSource.indexOf("\\draw (a) -- (1,0);"));
    expect(beginScopeIndex).toBeLessThan(result.newSource.indexOf("\\draw (2,0) -- (3,0);"));
  });

  it("refuses grouping when no dependency-safe non-contiguous placement exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (a) at (0,0);
  \coordinate (b) at (a);
  \draw (b) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "groupElements",
      elementIds: ["path:0", "path:2"]
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("dependency order");
  });

  it("ungroups a scope with no options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("\\begin{scope}");
    expect(result.newSource).not.toContain("\\end{scope}");
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    expect(result.newSource).toContain("\\draw (0,1) -- (1,1);");
  });

  it("ungroup reindents inlined scope statements to the parent indentation level", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \begin{scope}
        \node[draw] (A) at (-1.1, -1.56) {A};
        \node[draw] (B) at (0.9, -1.56) {B};
  \end{scope}
  \draw (-1.3,-2.3) rectangle (2.2,-3.4);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n  \\node[draw] (A) at (-1.1, -1.56) {A};");
    expect(result.newSource).toContain("\n  \\node[draw] (B) at (0.9, -1.56) {B};");
    expect(result.newSource).not.toContain("\n        \\node[draw] (A) at (-1.1, -1.56) {A};");
    expect(result.newSource).not.toContain("\n        \\node[draw] (B) at (0.9, -1.56) {B};");
  });

  it("ungroup trims blank scope body edges before reindenting", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}

      \draw (0,0) -- (1,0);

  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\n  \\draw (0,0) -- (1,0);\n");
    expect(result.newSource).not.toContain("\n\n  \\draw");
  });

  it("ungroups a scope with name-only options and drops name", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[name=mygroup]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("\\begin{scope}");
    expect(result.newSource).not.toContain("name=mygroup");
    expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
  });

  it("refuses ungroup when scope has transform/style options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[shift={(1,0)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("without options");
  });

  it("refuses ungroup when scope options contain unsupported option syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[{bad option}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("without options");
  });

  it("rejects invalid ungroup selections and non-scope statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: []
    })).toEqual({
      kind: "unsupported",
      reason: "Ungroup currently requires exactly one selected scope."
    });

    expect(applyEditAction(source, [], {
      kind: "ungroupElements",
      elementIds: ["path:0"]
    })).toEqual({
      kind: "unsupported",
      reason: "Ungroup currently supports scope selections only."
    });
  });

  it("ungroups empty and root-level scopes without inventing indentation", () => {
    const emptyScope = String.raw`\begin{tikzpicture}
  \begin{scope}[]
  \end{scope}
\end{tikzpicture}`;

    const emptyResult = applyEditAction(emptyScope, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });
    expect(emptyResult.kind).toBe("success");
    if (emptyResult.kind !== "success") {
      throw new Error("Expected empty scope ungroup to succeed");
    }
    expect(emptyResult.newSource).not.toContain("\\begin{scope}");
    expect(emptyResult.selectedSourceIds).toBeUndefined();

    const rootLevel = String.raw`\begin{tikzpicture}
\begin{scope}
\draw (0,0) -- (1,0);
\end{scope}
\end{tikzpicture}`;
    const rootResult = applyEditAction(rootLevel, [], {
      kind: "ungroupElements",
      elementIds: ["scope:0"]
    });
    expect(rootResult.kind).toBe("success");
    if (rootResult.kind !== "success") return;
    expect(rootResult.newSource).toContain("\n\\draw (0,0) -- (1,0);\n\\end{tikzpicture}");
  });

  it("classifies ungroupable scopes by option shape", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[name=ok]
    \draw (0,0) -- (1,0);
  \end{scope}
  \begin{scope}[shift={(1,0)}]
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const scopes = parsed.figure.body.filter((statement) => statement.kind === "Scope");

    expect(scopes.map((scope) => isUngroupableScopeStatement(scope))).toEqual([true, false]);
  });
});
