import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { applyPasteStatementsAction } from "../packages/core/src/edit/actions/paste-duplicate.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { renameSnippetDeclaredNames } from "../packages/core/src/edit/name-conflicts.js";
import { wp } from "./coords-helpers.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";

describe("applyEditAction – duplicateElements", () => {
  it("rejects empty and unresolved duplicate selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: [" ", " "]
    })).toEqual({
      kind: "unsupported",
      reason: "No element ids were provided for duplicateElements."
    });

    expect(applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["missing"]
    })).toEqual({
      kind: "unsupported",
      reason: "No duplicable statements were found for the selected element ids."
    });
  });

  it("duplicates selected statements after the same-parent anchor with default down-right offset", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;

    expect(result.newSource.indexOf("\\draw (0,0) -- (1,0);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0.25,-0.25) -- (1.25,-0.25);")
    );
    expect(result.newSource.indexOf("\\draw (0.25,-0.25) -- (1.25,-0.25);")).toBeLessThan(
      result.newSource.indexOf("\\draw (0,1) -- (1,1);")
    );
    expect(result.selectedSourceIds?.length ?? 0).toBe(1);
  });

  it("renames duplicated named nodes to avoid name conflicts", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
  \node[draw] (C2) at (2, 1.5) {C2};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (C3) at (0.25, 1.25) {C};");
  });

  it("uses spaced numeric suffixes for names that contain spaces", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (My Node) at (0, 1.5) {C};
  \node[draw] (My Node 2) at (2, 1.5) {C2};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (My Node 3) at (0.25, 1.25) {C};");
  });

  it("renames declared names across nested pasted snippets and rewrites references", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[alias={Alias}, name path={(Route)}, name path global=Trail] (A) at (0,0) {A};
  \node (A2) at (1,0) {A2};
  \node (Alias2) at (2,0) {Alias2};
  \path[name path local=Local] (A) -- (A2);
\end{tikzpicture}`;

    expect(renameSnippetDeclaredNames(source, [])).toEqual([]);
    expect(renameSnippetDeclaredNames(source, ["  \n  "])).toEqual(["  \n  "]);
    expect(renameSnippetDeclaredNames(source, ["\\draw (0,0) -- (1,0);"])).toEqual(["\\draw (0,0) -- (1,0);"]);

    const [renamed] = renameSnippetDeclaredNames(source, [
      String.raw`\begin{scope}[name path={Route}, alias=(Alias)]
  \node[alias={Alias}, name path local={(Local)}] (A) at (0,0) {A};
  \coordinate (A2) at (1,0);
  \path (A) edge node[alias=Alias] (B) {edge} (A2);
  \node (Root) {root} child { node[alias={Alias}] (Leaf) {leaf} edge from parent node (Edge Label) {} };
  \node (Placed) [right=of A, below=of Alias] {P};
  \draw[name path global=Trail] (A) -- (Alias);
\end{scope}`
    ]);

    expect(renamed).toContain("name path={Route2}");
    expect(renamed).toContain("alias=(Alias3)");
    expect(renamed).toContain("\\node[alias={Alias3}, name path local={(Local2)}] (A3)");
    expect(renamed).toContain("\\coordinate (A4) at");
    expect(renamed).toContain("(A3) edge node[alias=Alias3] (B)");
    expect(renamed).toContain("node[alias={Alias3}] (Leaf)");
    expect(renamed).toContain("edge from parent node (Edge Label)");
    expect(renamed).toContain("[right=of A3, below=of Alias3]");
    expect(renamed).toContain("(A3) -- (Alias3)");
    expect(renamed).toContain("name path global=Trail2");
  });

  it("renames conflicts across duplicate pasted snippets and unusual numeric suffixes", () => {
    const enormousSuffix = "9".repeat(400);
    const source = String.raw`\begin{tikzpicture}
  \node (Fresh) {fresh};
  \node (A) {a};
  \node (My Node 2) {spaced};
  \node (A${enormousSuffix}) {huge};
  \tikzset{kept/.style={draw}}
\end{tikzpicture}`;

    expect(renameSnippetDeclaredNames(source, ["\\node (Fresh2) {fresh};"])).toEqual(["\\node (Fresh2) {fresh};"]);

    const renamed = renameSnippetDeclaredNames(source, [
      "\\node (A) {one};\\node[alias={}] {empty alias};\\path (0,0) coordinate (Coord);\\node {anonymous};",
      "\\node (A) {two};\\node (My Node 2) {spaced};",
      `\\node (A${enormousSuffix}) {huge};`
    ]);

    expect(renamed[0]).toContain("\\node (A2) {one};");
    expect(renamed[1]).toContain("\\node (A2) {two};");
    expect(renamed[1]).toContain("\\node (My Node 3) {spaced};");
    expect(renamed[2]).toContain("\\node (A3) {huge};");
    expect(renamed[0]).toContain("alias={}");
    expect(renamed[0]).toContain("coordinate (Coord)");
  });

  it("duplicates without offset when delta is zero and falls back for non-finite components", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const zero = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"],
      delta: wp(0, 0)
    });
    expect(zero.kind).toBe("success");
    if (zero.kind !== "success") {
      throw new Error("Expected zero-offset duplicate to succeed");
    }
    expect((zero.newSource.match(/\\draw \(0,0\) -- \(1,0\);/g) ?? []).length).toBe(2);

    const fallback = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0"],
      delta: wp(Number.POSITIVE_INFINITY, Number.NaN)
    });
    expect(fallback.kind === "success" || fallback.kind === "partial").toBe(true);
    if (fallback.kind !== "success" && fallback.kind !== "partial") return;
    expect(fallback.newSource).toContain("\\draw (0.25,-0.25) -- (1.25,-0.25);");
  });

  it("duplicates unmovable named-reference paths as partial inserts", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {A};
  \node (B) at (1,0) {B};
  \draw (A) -- (B);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:2"]
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") {
      throw new Error("Expected named-reference duplicate to be partial");
    }
    expect(result.reason).toContain("Could not offset");
    expect(result.newSource).toContain("\\draw (A) -- (B);\n  \\draw (A) -- (B);");
    expectPatchesReconstructSource(source, result);
  });

  it("reuses offset preparation for identical snippets in mixed-parent duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateElements",
      elementIds: ["path:0", "path:2"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected mixed-parent duplicate to succeed");
    }
    expect((result.newSource.match(/\\draw \(0\.25,-0\.25\) -- \(1\.25,-0\.25\);/g) ?? []).length).toBe(2);
    expect(result.selectedSourceIds).toHaveLength(2);
  });
});

describe("applyEditAction – repeatElements", () => {
  it("rejects empty, no-op, and non-finite repeat requests", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const empty = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: [" ", "path:0", "path:0"],
      columns: 1,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(empty).toEqual({
      kind: "unsupported",
      reason: "Repeat needs more than one row or column."
    });

    const missingSelection = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: [" "],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(missingSelection).toEqual({
      kind: "unsupported",
      reason: "Select at least one authored element to repeat."
    });

    const nonFiniteStep = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: Number.POSITIVE_INFINITY,
      verticalStep: cm(1)
    });
    expect(nonFiniteStep).toEqual({
      kind: "error",
      message: "Repeat step values must be finite numbers."
    });

    const nonFiniteColumns = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: Number.NaN,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(nonFiniteColumns.kind).toBe("success");
    if (nonFiniteColumns.kind === "success") {
      expect(nonFiniteColumns.newSource).toContain(String.raw`\foreach \j in {0, ..., 1}`);
      expect(nonFiniteColumns.newSource).not.toContain(String.raw`\foreach \i`);
    }
  });

  it("rejects repeat selections that are missing, existing foreach statements, or cross-parent", () => {
    const missingSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const missing = applyEditAction(missingSource, [], {
      kind: "repeatElements",
      elementIds: ["path:99"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(missing.kind).toBe("unsupported");
    if (missing.kind === "unsupported") {
      expect(missing.reason).toContain("direct authored statement");
    }

    const foreachSource = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} {
    \draw (\x,0) -- ++(1,0);
  }
\end{tikzpicture}`;
    const existingForeach = applyEditAction(foreachSource, [], {
      kind: "repeatElements",
      elementIds: ["foreach:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(existingForeach.kind).toBe("unsupported");
    if (existingForeach.kind === "unsupported") {
      expect(existingForeach.reason).toContain("foreach");
    }

    const crossParentSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,1) -- (1,1);
  \end{scope}
\end{tikzpicture}`;
    const crossParent = applyEditAction(crossParentSource, [], {
      kind: "repeatElements",
      elementIds: ["path:0", "path:2"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });
    expect(crossParent.kind).toBe("unsupported");
    if (crossParent.kind === "unsupported") {
      expect(crossParent.reason).toContain("same parent scope");
    }
  });

  it("repeats a single draw statement by rewriting path coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\draw (\i*2cm,0) -- (1cm+\i*2cm,0);`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("normalizes duplicate changed ids for successful repeats without indentation", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: [" ", "path:0", "path:0"],
      columns: 2.8,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 1}`);
    expect(result.changedSourceIds).toEqual(["path:0", "foreach:0"]);
  });

  it("rewrites coordinate options, xyz coordinates, and to/edge coordinate targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw ([xshift=1pt] 0,0,2) to[out=20,in=160] (1,0) edge (2,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(0.5)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`([xshift=1pt] \i*1cm,-\j*0.5cm,2)`);
    expect(result.newSource).toContain(String.raw`to[out=20,in=160] (1cm+\i*1cm,-\j*0.5cm)`);
    expect(result.newSource).toContain(String.raw`edge (2cm+\i*1cm,-\j*0.5cm)`);
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("falls back to a shifted scope for relative and polar coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- ++(1,0) -- (45:1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,0)}]`);
    expect(result.newSource).toContain(String.raw`\draw (0,0) -- ++(1,0) -- (45:1);`);
  });

  it("falls back to shifted scopes for relative to targets and malformed coordinates", () => {
    const relativeTo = String.raw`\begin{tikzpicture}
  \draw (0,0) to ++(1,0);
\end{tikzpicture}`;
    const relativeResult = applyEditAction(relativeTo, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });
    expect(relativeResult.kind).toBe("success");
    if (relativeResult.kind !== "success") {
      throw new Error("Expected relative to-target repeat to succeed via fallback");
    }
    expect(relativeResult.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,0)}]`);
    expect(relativeResult.newSource).toContain(String.raw`\draw (0,0) to ++(1,0);`);

    const malformed = String.raw`\begin{tikzpicture}
  \draw (,0) -- (1,0);
\end{tikzpicture}`;
    const malformedResult = applyEditAction(malformed, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });
    expect(malformedResult.kind).toBe("success");
    if (malformedResult.kind !== "success") {
      throw new Error("Expected malformed-coordinate repeat to succeed via fallback");
    }
    expect(malformedResult.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,0)}]`);
    expect(malformedResult.newSource).toContain(String.raw`\draw (,0) -- (1,0);`);
  });

  it("keeps named-node declaration coordinates unshifted while shifting the node placement", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (A) at (0,0) node[draw] (A) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\draw (A) at (\i*2cm,0) node[draw] (A) {A};`);
  });

  it("chooses fallback loop variables when the snippet already uses preferred names", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw node {\i \col \x \dx \xx \j \row \y \dy \yy \v1} (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \v2 in {0, ..., 1}`);
    expect(result.newSource).toContain(String.raw`\foreach \v3 in {0, ..., 1}`);
  });

  it("normalizes zero step repeats without adding zero-offset expressions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (1,2) -- (3,4);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: 0,
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\draw (1cm,2) -- (3cm,4);`);
    expect(result.newSource).not.toContain("*0cm");
  });

  it("preserves CRLF newlines in repeat rewrites", () => {
    const source = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n\\end{tikzpicture}";

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(1),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\r\n");
    expect(result.newSource).not.toContain("\n  \\draw (0,0)");
  });

  it("repeats a node with at-placement by rewriting the at coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(3),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\node[draw] at (\i*3cm,1.5) {C};`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a named node with at-placement by rewriting the at coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\node[draw] (C) at (\i*3cm,1.5cm-\j*2cm) {C};`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a node in two dimensions without falling back to a shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\node[draw] at (\i*3cm,1.5cm-\j*2cm) {C};`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a rectangle path in two dimensions by rewriting both corners", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\draw (\i*3cm,-\j*2cm) rectangle (1cm+\i*3cm,1cm-\j*2cm);`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a line path in two dimensions without introducing a shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\draw (\i*3cm,-\j*2cm) -- (1cm+\i*3cm,-\j*2cm);`);
    expect(result.newSource).not.toContain(String.raw`\begin{scope}[shift=`);
    expect(result.newSource).not.toContain("shift=");
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("repeats a single scope without inserting an extra inner scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["scope:0"],
      columns: 1,
      rows: 2,
      horizontalStep: cm(1),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect((result.newSource.match(/\\begin\{scope\}/g) ?? []).length).toBe(1);
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(0,-\j*2cm)}]`);
  });

  it("repeats a scope in two dimensions without wrapping it in an extra shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["scope:0"],
      columns: 3,
      rows: 2,
      horizontalStep: cm(3),
      verticalStep: cm(2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 2} {`);
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(\i*3cm,-\j*2cm)}]`);
    expect((result.newSource.match(/\\begin\{scope\}/g) ?? []).length).toBe(1);
  });

  it("wraps multi-statement repeats in an inner shifted scope", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0", "path:1"],
      columns: 2,
      rows: 2,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\foreach \j in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\foreach \i in {0, ..., 1} {`);
    expect(result.newSource).toContain(String.raw`\begin{scope}[shift={(\i*2cm,-\j*1cm)}]`);
    expect(parseTikz(result.newSource, { recover: true }).diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("rejects non-contiguous repeat selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["path:0", "path:2"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("contiguous");
  });

  it("rejects foreach-origin repeat selections", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,...,1} {
    \draw (\x,0) -- ++(1,0);
  }
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "repeatElements",
      elementIds: ["foreach:0"],
      columns: 2,
      rows: 1,
      horizontalStep: cm(2),
      verticalStep: cm(1)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("foreach");
  });
});

describe("applyEditAction – pasteStatements", () => {
  it("rejects empty paste snippets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    expect(applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["   ", "\n"]
    })).toEqual({
      kind: "unsupported",
      reason: "No snippets were provided for pasteStatements."
    });
  });

  it("pastes non-statement snippets without trying to offset them", () => {
    const source = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;
    let moveCallCount = 0;

    const result = applyPasteStatementsAction(source, {
      snippets: ["% retained comment"],
      delta: wp(4, 4)
    }, {
      applyMoveElements: () => {
        moveCallCount += 1;
        return { kind: "success", newSource: "" };
      },
      normalizeElementIds: (ids) => ids.map((id) => id.trim()).filter((id) => id.length > 0),
      uniqueStrings: (values) => [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))],
      defaultDuplicateOffsetPt: cm(0.25)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected comment paste to succeed");
    }
    expect(result.selectedSourceIds).toBeUndefined();
    expect(result.newSource).toContain("% retained comment");
    expect(moveCallCount).toBe(0);
  });

  it("reports paste offset failures from unsupported and error move attempts", () => {
    const source = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;
    const deps = {
      normalizeElementIds: (ids: readonly string[]) => ids.map((id) => id.trim()).filter((id) => id.length > 0),
      uniqueStrings: (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))],
      defaultDuplicateOffsetPt: cm(0.25)
    };

    const unsupported = applyPasteStatementsAction(source, {
      snippets: [String.raw`\draw (0,0) -- (1,0);`],
      delta: wp(4, 4)
    }, {
      ...deps,
      applyMoveElements: () => ({ kind: "unsupported", reason: "locked handles" })
    });
    expect(unsupported.kind).toBe("partial");
    if (unsupported.kind !== "partial") {
      throw new Error("Expected unsupported offset paste to be partial");
    }
    expect(unsupported.reason).toContain("locked handles");
    expect(unsupported.newSource).toContain(String.raw`\draw (0,0) -- (1,0);`);

    const errored = applyPasteStatementsAction(source, {
      snippets: [String.raw`\draw (0,0) -- (1,0);`],
      delta: wp(4, 4)
    }, {
      ...deps,
      applyMoveElements: () => ({ kind: "error", message: "invalid geometry" })
    });
    expect(errored.kind).toBe("partial");
    if (errored.kind !== "partial") {
      throw new Error("Expected errored offset paste to be partial");
    }
    expect(errored.reason).toContain("invalid geometry");
    expect(errored.newSource).toContain(String.raw`\draw (0,0) -- (1,0);`);
  });

  it("pastes snippets after anchor and returns selected source ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (0,0) -- (1,0);"],
      anchorElementId: "path:0"
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\draw (0.25,-0.25) -- (1.25,-0.25);");
    expect(result.selectedSourceIds?.length ?? 0).toBe(1);
  });

  it("pastes snippets before \\end{tikzpicture} when no anchor is provided", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (2,2) -- (3,2);"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (2.25,1.75) -- (3.25,1.75);");
    expect(result.newSource).toContain("\\draw (2.25,1.75) -- (3.25,1.75);\n\\end{tikzpicture}");
    const endIndex = result.newSource.lastIndexOf("\\end{tikzpicture}");
    expect(result.newSource.lastIndexOf("\\draw (2.25,1.75) -- (3.25,1.75);")).toBeLessThan(endIndex);
  });

  it("renames pasted named nodes and updates coordinate references", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: [
        "\\node[draw] (C) at (0, 1.5) {C};",
        "\\draw (C) -- ++(1,0);"
      ]
    });

    expect(result.kind === "success" || result.kind === "partial").toBe(true);
    if (result.kind !== "success" && result.kind !== "partial") return;
    expect(result.newSource).toContain("\\node[draw] (C2) at (0.25, 1.25) {C};");
    expect(result.newSource).toContain("\\draw (C2) -- ++");
  });

  it("pastes with zero offset and preserves CRLF insertion style", () => {
    const source = "\\begin{tikzpicture}\r\n  \\draw (0,0) -- (1,0);\r\n\\end{tikzpicture}";

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (2,2) -- (3,2);"],
      delta: wp(0, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected zero-offset CRLF paste to succeed");
    }
    expect(result.newSource).toContain("  \\draw (2,2) -- (3,2);");
    expect(result.newSource).toContain("\r\n\\end{tikzpicture}");
  });

  it("returns partial when pasted named-reference coordinates cannot be offset", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "pasteStatements",
      snippets: ["\\draw (A) -- (B);"]
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") {
      throw new Error("Expected named-reference paste to be partial");
    }
    expect(result.reason).toContain("Could not offset");
    expect(result.newSource).toContain("\\draw (A) -- (B);");
  });
});
