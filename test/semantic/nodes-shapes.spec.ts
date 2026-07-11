import { describe, expect, it } from "vitest";

import {
  evaluateSemantic,
  firstElementOfKind,
  elementsOfKind
} from "./helpers.js";

function expectLinearTransform(
  transform: { a: number; b: number; c: number; d: number } | undefined,
  expected: { a: number; b: number; c: number; d: number }
): void {
  expect(transform).toBeDefined();
  if (!transform) {
    return;
  }
  expect(transform.a).toBeCloseTo(expected.a, 3);
  expect(transform.b).toBeCloseTo(expected.b, 3);
  expect(transform.c).toBeCloseTo(expected.c, 3);
  expect(transform.d).toBeCloseTo(expected.d, 3);
}

describe("semantic evaluator / nodes and shapes", () => {
    it("starts an edge directly after a named node at that node's border", () => {
      const source = String.raw`\begin{tikzpicture}
    \node (b) at (2,0) {B};
    \path (0,0) node (c) {C} edge (b);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const c = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      const edgePath = firstElementOfKind(result.scene.elements, "Path");
      expect(c?.kind).toBe("Text");
      expect(edgePath?.kind).toBe("Path");
      if (c?.kind === "Text" && edgePath?.kind === "Path") {
        const start = edgePath.commands[0];
        expect(start?.kind).toBe("M");
        if (start?.kind === "M") {
          expect(start.to.x).toBeGreaterThan(c.position.x);
        }
      }
    });

    it("starts standalone node-command edges from the node without requiring an existing current point", () => {
      const source = String.raw`\begin{tikzpicture}[every node/.style={circle,draw}]
    \node (A) at (0,0) {A};
    \node (B) at (1,0) {B} edge (A);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "edge-without-start")).toBe(false);
      const edgePath = result.scene.elements.find((element) => {
        if (element.kind !== "Path") {
          return false;
        }
        return element.commands.length === 2 && element.commands[0]?.kind === "M" && element.commands[1]?.kind === "L";
      });
      expect(edgePath?.kind).toBe("Path");
      if (edgePath?.kind === "Path") {
        const start = edgePath.commands[0];
        const end = edgePath.commands[1];
        expect(start?.kind).toBe("M");
        expect(end?.kind).toBe("L");
        if (start?.kind === "M" && end?.kind === "L") {
          expect(start.to.x).toBeGreaterThan(end.to.x);
        }
      }
    });

    it("starts a new subpath when a coordinate appears without an operator", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- (2,0) (0,1) -- (2,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.map((command) => command.kind)).toEqual(["M", "L", "M", "L"]);
      }
    });

    it("keeps single-anchor dots ranges as a single item", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {e,...,e}
      \node at (0,0) {\x};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const labels = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""));
      expect(labels).toEqual(["e"]);
    });

    it("expands dots lists for numeric, single-anchor, alphabetic, and contextual forms", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {1,2,...,4} \node at (\x,0) {\x};
    \foreach \x in {1,...,4} \node at (\x,1) {\x};
    \foreach \x in {a,...,d} \node at (0,0) {\x};
    \foreach \x in {2^1,2^...,2^4} \node at (0,0) {\x};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const labels = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""));
      expect(labels).toEqual(
        expect.arrayContaining(["1", "2", "3", "4", "a", "b", "c", "d", "2^1", "2^2", "2^3", "2^4"])
      );
    });

    it("starts grid at the origin when no current point exists yet", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[help lines] grid (3,2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "grid-without-start")).toBe(false);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      const vertical = paths.filter((path) => path.id.includes("scene-grid-x:"));
      const horizontal = paths.filter((path) => path.id.includes("scene-grid-y:"));
      expect(vertical.length).toBe(4);
      expect(horizontal.length).toBe(3);
    });

    it("uses (0,0) as the default start for rectangle operations", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[fill=orange] rectangle (3,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "rectangle-without-start")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands[0];
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(0, 6);
          expect(move.to.y).toBeCloseTo(0, 6);
        }
      }
    });

    it("ignores empty node-name coordinates for node commands", () => {
      const source = String.raw`\begin{tikzpicture}
    \node () at (0,0) {Hi};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-coordinate-form:unknown")).toBe(false);
      const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "Hi");
      expect(text?.kind).toBe("Text");
    });

    it("supports node names that contain the `node` keyword", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw] (example node) at (0.76, 1.5) {Hello};
    \draw (example node.east) -- +(1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      expect(result.scene.elements.some((element) => element.kind === "Text" && element.text === "Hello")).toBe(true);
    });

    it("evaluates matrix nodes, emits cell text, and registers generated matrix cell names", () => {
      const source = String.raw`\begin{tikzpicture}
    \matrix[matrix of nodes,row sep=4mm,column sep=6mm] (m) {
      A & B \\
      C & D \\
    };
    \draw (m-1-1) -- (m-2-2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.featureUsage.matrix_node).toBe("used-supported");
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:m-1-1")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:m-2-2")).toBe(false);
  
      const matrixTexts = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""))
        .sort();
      expect(matrixTexts).toEqual(["A", "B", "C", "D"]);
  
      const linePath = result.scene.elements.find(
        (element) =>
          element.kind === "Path" &&
          element.commands.length === 2 &&
          element.commands[0]?.kind === "M" &&
          element.commands[1]?.kind === "L"
      );
      expect(linePath?.kind).toBe("Path");
    });

    it("evaluates explicit \\node cell entries inside matrices", () => {
      const source = String.raw`\begin{tikzpicture}
    \matrix[row sep=3mm,column sep=5mm] (m) {
      \node(a) {1}; & \node {2}; \\
      \node {3}; & \node(b) {4}; \\
    };
    \draw (a) -- (b);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.featureUsage.matrix_node).toBe("used-supported");
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:a")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:b")).toBe(false);
  
      const matrixTexts = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""))
        .sort();
      expect(matrixTexts).toEqual(["1", "2", "3", "4"]);
    });

    it("preserves difficult matrix-of-nodes cell text", () => {
      const source = String.raw`\begin{tikzpicture}
    \matrix[matrix of nodes,nodes={draw}] {
      plain {nested} $x_1$ & price \$1 and 100\% \\
      \node {explicit {node} $z$}; & final \& marker \\
    };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
      const matrixTexts = result.scene.elements
        .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> => element.kind === "Text")
        .filter((element) => element.id.includes("matrix-cell:"));

      expect(matrixTexts.map((element) => element.text).sort()).toEqual([
        String.raw`explicit {node} $z$`,
        String.raw`final \& marker`,
        String.raw`plain {nested} $x_1$`,
        String.raw`price \$1 and 100\%`
      ]);
      expect(matrixTexts.every((element) => element.matrixCell?.textMode === "text")).toBe(true);
    });

    it("preserves difficult matrix-of-math-nodes cell text in math mode", () => {
      const source = String.raw`\begin{tikzpicture}
    \matrix[matrix of math nodes] {
      \frac{1}{1+x} & \{a,b\}_{i=1}^{n} \\
    };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const matrixTexts = result.scene.elements
        .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> => element.kind === "Text")
        .filter((element) => element.id.includes("matrix-cell:"));
      expect(matrixTexts.map((element) => element.text).sort()).toEqual([String.raw`\frac{1}{1+x}`, String.raw`\{a,b\}_{i=1}^{n}`]);
      expect(matrixTexts.every((element) => element.matrixCell?.textMode === "math")).toBe(true);
    });

    it("stores per-cell editable text spans for matrix text elements", () => {
      const source = String.raw`\begin{tikzpicture}
    \matrix[matrix of nodes] {
      A & BC \\
      \node {D}; & E \\
    };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const matrixTexts = result.scene.elements
        .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> => element.kind === "Text")
        .filter((element) => ["A", "BC", "D", "E"].includes(element.text));
      expect(matrixTexts).toHaveLength(4);

      const seenSpans = new Set<string>();
      for (const text of matrixTexts) {
        expect(text.textSourceSpan).toBeDefined();
        expect(text.matrixCell).toBeDefined();
        const span = text.textSourceSpan;
        const matrixCell = text.matrixCell;
        if (!span) {
          continue;
        }
        if (!matrixCell) {
          continue;
        }
        expect(span.to).toBeGreaterThan(span.from);
        expect(source.slice(span.from, span.to)).toBe(text.text);
        expect(text.sourceRef.sourceId).toBe(matrixCell.cellSourceId);
        expect(text.sourceRef.sourceSpan).toEqual(matrixCell.cellSpan);
        expect(matrixCell.matrixSourceId).toBe("path:0");
        expect(matrixCell.textMode).toBe("text");
        expect(matrixCell.row).toBeGreaterThan(0);
        expect(matrixCell.column).toBeGreaterThan(0);
        expect(matrixCell.cellSpan.to).toBeGreaterThan(matrixCell.cellSpan.from);
        expect(source.slice(matrixCell.textSpan.from, matrixCell.textSpan.to)).toBe(text.text);
        seenSpans.add(`${span.from}:${span.to}`);
      }

      expect(seenSpans.size).toBe(4);
    });

    it("draws matrix container using new shape handlers", () => {
      const source = String.raw`\begin{tikzpicture}
    \matrix[
      matrix of nodes,
      draw,
      rounded rectangle,
      rounded rectangle west arc=concave,
      rounded rectangle east arc=convex
    ] {
      A & B\\
    };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const matrixBox = result.scene.elements.find(
        (element) => element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(matrixBox?.kind).toBe("Path");
      if (matrixBox?.kind === "Path") {
        expect(matrixBox.commands.length).toBeGreaterThan(4);
      }
    });

    it("parses reversed/sep arrow options and reverses multi-tip start specifications", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[-{Stealth[reversed,sep=2pt,length=5mm]}] (0,0) -- (2,0);
    \draw[{Latex[length=4pt] Stealth[length=2pt]}-] (0,1) -- (2,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const paths = elementsOfKind(result.scene.elements, "Path");
  
      expect(paths.length).toBeGreaterThanOrEqual(2);
  
      const first = paths[0];
      const second = paths[1];
      expect(first?.kind).toBe("Path");
      expect(second?.kind).toBe("Path");
      if (first?.kind === "Path" && second?.kind === "Path") {
        expect(first.style.markerEnd?.tips[0]?.kind).toBe("stealth");
        expect(first.style.markerEnd?.tips[0]?.reversed).toBe(true);
        expect(first.style.markerEnd?.tips[0]?.sep).toBeCloseTo(2, 3);
        expect(second.style.markerStart?.tips.map((tip) => tip.kind)).toEqual(["stealth", "latex"]);
      }
    });

    it("registers node anchors used by |- and -| paths", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) node(a) [draw] {A}  (1,1) node(b) [draw] {B};
    \draw (a.north) |- (b.west);
    \draw[color=red] (a.east) -| (2,1.5) -| (b.north);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      expect(result.scene.elements.some((element) => element.kind === "Text")).toBe(true);
      expect(result.scene.elements.some((element) => element.kind === "Path" && element.style.stroke === "#ff0000")).toBe(true);
    });

    it("supports node name scope prefixes/suffixes and aliases in coordinate lookups", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[name prefix=pre-,name suffix=-suf]
      \node[name=a,alias=b,node contents=A] at (0,0);
      \draw (a) -- (b.east);
    \end{scope}
    \draw (pre-a-suf) -- +(1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
    });

    it("orders behind-path nodes before path geometry and front nodes after", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) node[behind path,draw] {B} -- (1,0) node[draw] {F};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const mainPathIndex = result.scene.elements.findIndex(
        (element) => element.kind === "Path" && element.id.startsWith("scene-path:")
      );
      const behindNodeIndex = result.scene.elements.findIndex((element) => element.kind === "Text" && element.text === "B");
      const frontNodeIndex = result.scene.elements.findIndex((element) => element.kind === "Text" && element.text === "F");
  
      expect(mainPathIndex).toBeGreaterThanOrEqual(0);
      expect(behindNodeIndex).toBeLessThan(mainPathIndex);
      expect(frontNodeIndex).toBeGreaterThan(mainPathIndex);
    });

    it("supports circle-shaped nodes with anchor placement and named anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) node[circle,draw,minimum size=1cm,anchor=west,name=n] {A};
    \draw (n.east) -- +(1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      expect(result.scene.elements.some((element) => element.kind === "Circle")).toBe(true);
  
      const text = result.scene.elements.find((element) => element.kind === "Text");
      expect(text?.kind).toBe("Text");
      if (text?.kind === "Text") {
        expect(text.position.x).toBeGreaterThan(0);
      }
    });

    it("keeps circle base and mid anchors distinct from center", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[circle,draw,minimum size=2cm,name=n] at (0,0) {Text};
    \node at (n.center) {C};
    \node at (n.base) {B};
    \node at (n.mid) {M};
    \node at (n.base east) {E};
    \node at (n.base west) {W};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const byLabel = new Map<string, Extract<(typeof result.scene.elements)[number], { kind: "Text" }>>();
      for (const element of result.scene.elements) {
        if (element.kind === "Text") {
          byLabel.set(element.text, element);
        }
      }
  
      const center = byLabel.get("C");
      const base = byLabel.get("B");
      const mid = byLabel.get("M");
      const baseEast = byLabel.get("E");
      const baseWest = byLabel.get("W");
  
      expect(center?.kind).toBe("Text");
      expect(base?.kind).toBe("Text");
      expect(mid?.kind).toBe("Text");
      expect(baseEast?.kind).toBe("Text");
      expect(baseWest?.kind).toBe("Text");
  
      if (
        center?.kind === "Text" &&
        base?.kind === "Text" &&
        mid?.kind === "Text" &&
        baseEast?.kind === "Text" &&
        baseWest?.kind === "Text"
      ) {
        expect(base.position.y).toBeLessThan(center.position.y);
        expect(mid.position.y).toBeLessThan(center.position.y);
        expect(base.position.y).toBeLessThan(mid.position.y);
        expect(baseEast.position.y).toBeCloseTo(base.position.y, 3);
        expect(baseWest.position.y).toBeCloseTo(base.position.y, 3);
        expect(baseEast.position.x).toBeGreaterThan(center.position.x);
        expect(baseWest.position.x).toBeLessThan(center.position.x);
      }
    });

    it("resolves numeric node anchors like node.45 and node.225", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[circle,draw,minimum size=1cm,name=n] at (0,0) {A};
    \draw (n.45) -- (n.225);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:n.45")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:n.225")).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const start = path.commands[0];
        const end = path.commands[1];
        expect(start?.kind).toBe("M");
        expect(end?.kind).toBe("L");
        if (start?.kind === "M" && end?.kind === "L") {
          expect(start.to.x).toBeGreaterThan(0);
          expect(start.to.y).toBeGreaterThan(0);
          expect(end.to.x).toBeLessThan(0);
          expect(end.to.y).toBeLessThan(0);
        }
      }
    });

    it("supports pos and midway placement on line and orthogonal segments", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- (2,0) node[midway,name=m] {M};
    \draw (0,0) -| (2,2) node[pos=0.5,name=c] {C};
    \draw (m) -- (c);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const mText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "M");
      const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      expect(mText?.kind).toBe("Text");
      expect(cText?.kind).toBe("Text");
      if (mText?.kind === "Text") {
        expect(mText.position.x).toBeCloseTo(28.4527, 3);
        expect(mText.position.y).toBeCloseTo(0, 3);
      }
      if (cText?.kind === "Text") {
        expect(cText.position.x).toBeCloseTo(56.9055, 3);
        expect(cText.position.y).toBeCloseTo(0, 3);
      }
    });

    it("supports node label/pin options and node quotes syntax", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,name=a,label=right:L,pin=above:P,"Q" left] at (0,0) {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:label")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:pin")).toBe(false);
  
      const byText = new Map(
        result.scene.elements
          .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> => element.kind === "Text")
          .map((element) => [element.text, element])
      );
      const a = byText.get("A");
      const l = byText.get("L");
      const p = byText.get("P");
      const q = byText.get("Q");
  
      expect(a).toBeDefined();
      expect(l).toBeDefined();
      expect(p).toBeDefined();
      expect(q).toBeDefined();
      if (a && l && p && q) {
        expect(l.position.x).toBeGreaterThan(a.position.x);
        expect(q.position.x).toBeLessThan(a.position.x);
        expect(p.position.y).toBeGreaterThan(a.position.y);
      }
  
      const pinEdge = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-path:") && element.style.stroke === "#808080"
      );
      expect(pinEdge).toBeDefined();
    });

    it("applies inline font-size switches inside node labels", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,label=above:\tiny{$v$}] at (0,0) {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "$v$"
      );
      expect(label).toBeDefined();
      if (label?.kind === "Text") {
        expect(label.style.fontSize).toBeLessThan(8);
        expect(label.text).toBe("$v$");
      }
    });

    it("does not apply every-node styles to labels and pins", () => {
      const source = String.raw`\begin{tikzpicture}[every node/.style={circle,draw}]
    \node[name=a,label=right:L,pin=above:P] at (0,0) {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const circles = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Circle" }> => element.kind === "Circle"
      );
      expect(circles).toHaveLength(1);

      const byText = new Map(
        result.scene.elements
          .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> => element.kind === "Text")
          .map((element) => [element.text, element])
      );
      expect(byText.get("A")).toBeDefined();
      expect(byText.get("L")).toBeDefined();
      expect(byText.get("P")).toBeDefined();
    });

    it("attaches editable adornment metadata to label and pin elements", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,name=a,label=right:L,pin=above:P,"Q" left] at (0,0) {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const adornments = result.scene.elements
        .filter((element) => element.adornment != null)
        .map((element) => element.adornment?.targetId)
        .filter((targetId): targetId is string => targetId != null);

      expect(adornments).toContain("node-adornment:node:0:2:label:0");
      expect(adornments).toContain("node-adornment:node:0:2:pin:1");
      expect(adornments).toContain("node-adornment:node:0:2:label:2");

      const label = result.scene.elements.find((element) => element.kind === "Text" && element.text === "L");
      expect(label?.adornment?.kind).toBe("label");
      expect(label?.adornment?.textSpan.to).toBeGreaterThan(label?.adornment?.textSpan.from ?? 0);

      const pinEdge = result.scene.elements.find((element) => element.kind === "Path" && element.adornment?.kind === "pin");
      expect(pinEdge?.adornment?.targetId).toBe("node-adornment:node:0:2:pin:1");
    });

    it("supports edge label keys and edge quotes syntax", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) to[edge label=A,edge label'=B] (2,0);
    \draw (0,-1) edge["left","right"' near end] (2,-1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:edge label")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:edge label'")).toBe(false);
  
      const labels = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && ["A", "B", "left", "right"].includes(element.text)
      );
      expect(labels.map((label) => label.text).sort()).toEqual(["A", "B", "left", "right"]);
  
      const a = labels.find((label) => label.text === "A");
      const b = labels.find((label) => label.text === "B");
      const left = labels.find((label) => label.text === "left");
      const right = labels.find((label) => label.text === "right");
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(left).toBeDefined();
      expect(right).toBeDefined();
      if (a && b && left && right) {
        expect(a.position.y).toBeGreaterThan(b.position.y);
        expect(left.position.y).toBeGreaterThan(right.position.y);
      }
    });

    it("starts to-operation curves from named-node borders when out/in angles are provided", () => {
      const source = String.raw`\begin{tikzpicture}
    \node (tex) [draw] at (0,0) {TEX};
    \node (pdf) [draw] at (2,0) {PDF};
    \draw[->] (tex) to[out=45,in=225,looseness=1.5] (pdf);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-path:")
      );
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands[0];
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.y).toBeGreaterThan(0.1);
        }
      }
    });

    it("applies rotate=<deg> on nodes to text rotation", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[rotate=15] {TOP SECRET};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "TOP SECRET"
      );
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
          const radians = (15 * Math.PI) / 180;
          expect(label.rotation ?? 0).toBeCloseTo(0, 3);
          expectLinearTransform(label.transform, {
            a: Math.cos(radians),
            b: Math.sin(radians),
            c: -Math.sin(radians),
            d: Math.cos(radians)
          });
      }
    });

    it("applies rotate=<deg> on drawn node geometry", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,rotate=30] {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const nodeBox = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBox?.kind).toBe("Path");
      if (nodeBox?.kind === "Path") {
        const radians = (30 * Math.PI) / 180;
        expectLinearTransform(nodeBox.transform, {
          a: Math.cos(radians),
          b: Math.sin(radians),
          c: -Math.sin(radians),
          d: Math.cos(radians)
        });
      }
    });

    it("places standalone node commands at the scope origin by default", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[opacity=0.6]
      \draw [line width=4mm, red] circle(1);
      \fill[rounded corners, fill=red, rotate=15]
        (-1.3,-0.2) rectangle (1.3,0.2);
    \end{scope}
    \node[rotate=15] {TOP SECRET};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "TOP SECRET"
      );
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.position.x).toBeCloseTo(0, 3);
        expect(label.position.y).toBeCloseTo(0, 3);
          const radians = (15 * Math.PI) / 180;
          expect(label.rotation ?? 0).toBeCloseTo(0, 3);
          expectLinearTransform(label.transform, {
            a: Math.cos(radians),
            b: Math.sin(radians),
            c: -Math.sin(radians),
            d: Math.cos(radians)
          });
      }
    });

    it("keeps sloped node text upright unless allow upside down is set", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (2,0) -- (0,0) node[midway,sloped,above] {outside};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "outside"
      );
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(Math.abs(label.rotation ?? 0)).toBeLessThan(90);
      }
    });

    it("keeps sloped auto labels on the geometric left side for downward edges", () => {
      const source = String.raw`\begin{tikzpicture}[
    every edge/.style={draw},
    every edge quotes/.style={auto,sloped}]
    \node (top) at (0,1) {TOP};
    \node (bottom) at (0,0) {BOTTOM};
    \draw (top) edge["ps2pdf"] (bottom);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "ps2pdf"
      );
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.position.x).toBeGreaterThan(0);
      }
    });

    it("rotates sloped path nodes once the segment endpoint is known", () => {
      const source = String.raw`\begin{tikzpicture}[node distance=2.5cm]
    \node(x1) {$x_1$};
    \node(y1) [below of = x1]{$y_1$};
    \draw [->] (y1) -- node[sloped,below] {(y1) $\to$ (x1)} (x1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text.includes("(y1)")
      );
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expectLinearTransform(label.transform, {
          a: 0,
          b: 1,
          c: -1,
          d: 0
        });
      }
    });

    it("applies scoped defaults and style hooks for label/pin quotes", () => {
      const source = String.raw`\begin{tikzpicture}[label position=right,label distance=4pt]
    \tikzset{every label quotes/.style={text=red}}
    \node["L"] (a) at (0,0) {A};
    \begin{scope}[quotes mean pin,pin position=left,pin distance=3pt,pin edge={draw=blue}]
      \tikzset{every pin quotes/.style={text=green}}
      \node["P"] (b) at (2,0) {B};
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:quotes mean pin")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:pin edge")).toBe(false);
  
      const byText = new Map(
        result.scene.elements
          .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> => element.kind === "Text")
          .map((element) => [element.text, element])
      );
  
      const a = byText.get("A");
      const b = byText.get("B");
      const l = byText.get("L");
      const p = byText.get("P");
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(l).toBeDefined();
      expect(p).toBeDefined();
      if (a && b && l && p) {
        expect(l.position.x).toBeGreaterThan(a.position.x);
        expect(p.position.x).toBeLessThan(b.position.x);
        expect(l.style.textColor).toBe("#ff0000");
        expect(p.style.textColor).toBe("#00ff00");
      }
  
      const pinEdge = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.style.stroke === "#0000ff"
      );
      expect(pinEdge).toBeDefined();
    });

    it("applies every edge quotes styles, preserves apostrophes, and expands edge node syntax", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{every edge quotes/.style={auto=right,text=blue}}
    \draw (0,0) edge["Q"] (2,0);
    \draw (0,-1) edge["James'"] (2,-1);
    \draw (0,-2) edge[edge node={node[above,text=red]{N}}] (2,-2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:edge node")).toBe(false);
  
      const byText = new Map(
        result.scene.elements
          .filter((element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> => element.kind === "Text")
          .map((element) => [element.text, element])
      );
      const q = byText.get("Q");
      const james = byText.get("James'");
      const n = byText.get("N");
      expect(q).toBeDefined();
      expect(james).toBeDefined();
      expect(n).toBeDefined();
      if (q && james && n) {
        expect(q.position.y).toBeLessThan(0);
        expect(q.style.textColor).toBe("#0000ff");
        expect(james.style.textColor).toBe("#0000ff");
        expect(n.style.textColor).toBe("#ff0000");
        expect(n.position.y).toBeGreaterThan(-56.9055);
      }
    });

    it("does not let statement fill options implicitly paint node boxes", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill [fill=yellow!80!black]
         (0,0) node              {first node}
      -- (1,1) node[behind path] {second node}
      -- (2,0) node              {third node};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
      expect(nodeBoxes).toHaveLength(0);
    });

    it("suppresses inherited stroke on fill-only nodes", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill [fill=blue!50, draw=blue, very thick]
         (0,0)   node [behind path, fill=red!50]   {first node}
      -- (1.5,0) node [behind path, fill=green!50] {second node}
      -- (1.5,1) node [behind path, fill=brown!50] {third node}
      -- (0,1)   node [             fill=blue!30]  {fourth node};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBoxes.length).toBe(4);
      expect(nodeBoxes.every((nodeBox) => nodeBox.style.stroke == null)).toBe(true);
    });

    it("applies rounded corners options to rectangle node boxes", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) node[draw,rounded corners=4pt] {rounded};
    \draw (2,0) node[draw,sharp corners]       {sharp};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBoxes).toHaveLength(2);
  
      const rounded = nodeBoxes.find((nodeBox) => nodeBox.commands.some((command) => command.kind === "C"));
      const sharp = nodeBoxes.find((nodeBox) => nodeBox.commands.every((command) => command.kind !== "C"));
      expect(rounded).toBeDefined();
      expect(sharp).toBeDefined();
      expect(rounded?.commands.filter((command) => command.kind === "C").length ?? 0).toBeGreaterThanOrEqual(4);
    });

    it("applies node-local scale options to text and box metrics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[line width=5pt]
      (0,0)  node[draw]         (d) {drawn}
      (1,-1) node[draw,scale=2] (s) {scaled};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const drawn = result.scene.elements.find((element) => element.kind === "Text" && element.text === "drawn");
      const scaled = result.scene.elements.find((element) => element.kind === "Text" && element.text === "scaled");
      expect(drawn?.kind).toBe("Text");
      expect(scaled?.kind).toBe("Text");
      if (drawn?.kind === "Text" && scaled?.kind === "Text") {
        expect(scaled.style.fontSize).toBeCloseTo(drawn.style.fontSize, 3);
        expectLinearTransform(scaled.transform, { a: 2, b: 0, c: 0, d: 2 });
      }
    });

    it("supports ellipse-shaped nodes in path syntax", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill[fill=yellow!80!black]
          (0,0) node                            {first node}
       -- (1,1) node[ellipse,draw,behind path] {second node};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const ellipse = result.scene.elements.find((element) => element.kind === "Ellipse" && element.id.startsWith("scene-node-ellipse:"));
      expect(ellipse?.kind).toBe("Ellipse");
      if (ellipse?.kind === "Ellipse") {
        expect(ellipse.style.stroke).not.toBeNull();
        expect(ellipse.style.fill).toBeNull();
      }
    });

    it("supports misc and symbols shape geometry for rounded/chamfered/cross/strike/magnifying nodes", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,rounded rectangle,name=rr] at (0,0) {RR};
    \node[draw,chamfered rectangle,chamfered rectangle corners={north west,south east},name=cr] at (3,0) {CR};
    \node[draw,cross out,name=xo] at (6,0) {XO};
    \node[draw,strike out,name=so] at (9,0) {SO};
    \node[draw,magnifying glass,magnifying glass handle angle=-35,magnifying glass handle aspect=1.8,name=mg] at (12,0) {MG};
    \draw (rr.east) -- +(6pt,0);
    \draw (cr.west) -- +(-6pt,0);
    \draw (xo.north) -- +(0,6pt);
    \draw (so.south) -- +(0,-6pt);
    \draw (mg.east) -- +(6pt,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      const lineElements = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-line:")
      );
      const circles = result.scene.elements.filter((element) => element.kind === "Circle");
      expect(lineElements.length).toBeGreaterThanOrEqual(4);
      expect(circles.length).toBeGreaterThanOrEqual(1);
    });

    it("supports multipart split shapes with nodepart text and split anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,circle split,name=cs] at (0,0) {Top\nodepart{lower}Bottom};
    \node[draw,ellipse split,name=es] at (3,0) {Top\nodepart{lower}Bottom};
    \node[draw,diamond split,name=ds] at (6,0) {Top\nodepart{lower}Bottom};
    \node[draw,circle solidus,name=ss] at (9,0) {Top\nodepart{lower}Bottom};
    \node[draw,rectangle split,rectangle split parts=3,name=rs] at (12,0) {One\nodepart{two}Two\nodepart{three}Three};
    \draw (cs.lower) -- +(0,-6pt);
    \draw (es.lower) -- +(0,-6pt);
    \draw (ds.lower) -- +(0,-6pt);
    \draw (ss.lower) -- +(0,-6pt);
    \draw (rs.2) -- +(0,-6pt);
    \draw (rs.second split) -- +(0,-6pt);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      const textElements = result.scene.elements.filter((element) => element.kind === "Text");
      expect(textElements.some((element) => element.kind === "Text" && element.text.includes("Bottom"))).toBe(true);
      expect(textElements.some((element) => element.kind === "Text" && element.text.includes("Three"))).toBe(true);
    });

    it("supports vertical rectangle split dividers and part anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[
      draw,
      rectangle split,
      rectangle split parts=4,
      rectangle split horizontal,
      name=rs
    ] at (0,0) {A\nodepart{two}B\nodepart{three}C\nodepart{four}D};
    \draw (rs.3) -- +(0,6pt);
    \draw (rs.3 split) -- +(0,-6pt);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
      const splitLines = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.includes(":split-")
      );
      expect(splitLines.length).toBeGreaterThanOrEqual(3);
      const verticalLine = splitLines.find((path) => {
        const move = path.commands[0];
        const line = path.commands[1];
        return move?.kind === "M" && line?.kind === "L" && Math.abs(line.to.x - move.to.x) < 0.01;
      });
      expect(verticalLine).toBeDefined();
    });

    it("supports diamond-shaped nodes with aspect control and named anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[diamond,draw,aspect=2,name=d] at (0,0) {D};
    \draw (d.east) -- +(8pt,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
      const diamond = result.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
      expect(text?.kind).toBe("Text");
      expect(diamond?.kind).toBe("Path");
  
      if (diamond?.kind === "Path") {
        const points = diamond.commands
          .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to] : []));
        expect(points).toHaveLength(4);
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        expect(width).toBeGreaterThan(height);
      }
    });

    it("supports trapezium-shaped nodes with angle keys and side anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,name=t] at (0,0) {T};
    \draw (t.top side) -- +(0,8pt);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const trapezium = result.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
      expect(trapezium?.kind).toBe("Path");
      if (trapezium?.kind === "Path") {
        const points = trapezium.commands
          .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to] : []));
        expect(points).toHaveLength(4);
        const [bottomLeft, topLeft, topRight, bottomRight] = points;
        const topWidth = topRight.x - topLeft.x;
        const bottomWidth = bottomRight.x - bottomLeft.x;
        expect(bottomWidth).toBeGreaterThan(topWidth);
      }
    });

    it("applies trapezium stretch keys to minimum-size geometry", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,minimum width=3cm] at (0,0)  {A};
    \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,minimum width=3cm,trapezium stretches] at (4,0) {B};
    \node[trapezium,draw,trapezium left angle=75,trapezium right angle=45,minimum width=3cm,trapezium stretches body] at (8,0) {C};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const trapezia = result.scene.elements
        .filter(
          (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
            element.kind === "Path" && element.id.startsWith("scene-node-box:")
        )
        .map((path) => {
          const points = path.commands
            .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to] : []));
          const [bottomLeft, topLeft, topRight, bottomRight] = points;
          return {
            centerX: points.reduce((sum, point) => sum + point.x, 0) / Math.max(points.length, 1),
            topWidth: topRight && topLeft ? topRight.x - topLeft.x : 0,
            bottomWidth: bottomRight && bottomLeft ? bottomRight.x - bottomLeft.x : 0,
            height:
              points.length > 0
                ? Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))
                : 0
          };
        })
        .sort((left, right) => left.centerX - right.centerX);
  
      expect(trapezia).toHaveLength(3);
      const [defaultShape, stretchesShape, stretchesBodyShape] = trapezia;
      const defaultDiff = defaultShape.bottomWidth - defaultShape.topWidth;
      const stretchesDiff = stretchesShape.bottomWidth - stretchesShape.topWidth;
      const stretchesBodyDiff = stretchesBodyShape.bottomWidth - stretchesBodyShape.topWidth;
  
      expect(defaultShape.height).toBeGreaterThan(stretchesShape.height);
      expect(stretchesDiff).toBeGreaterThan(stretchesBodyDiff);
      expect(defaultDiff).toBeCloseTo(stretchesDiff, 3);
    });

    it("rotates trapezium top-side anchor and keeps base-east distinct from east", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[trapezium,draw,name=a] at (0,0) {CenterA};
    \node[trapezium,draw,name=b,shape border rotate=90] at (4,0) {CenterB};
    \node at (a.top side) {TopA};
    \node at (b.top side) {TopB};
    \node at (b.east) {EastB};
    \node at (b.base east) {BaseEastB};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const centerA = result.scene.elements.find((element) => element.kind === "Text" && element.text === "CenterA");
      const centerB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "CenterB");
      const topA = result.scene.elements.find((element) => element.kind === "Text" && element.text === "TopA");
      const topB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "TopB");
      const eastB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "EastB");
      const baseEastB = result.scene.elements.find((element) => element.kind === "Text" && element.text === "BaseEastB");
  
      expect(centerA?.kind).toBe("Text");
      expect(centerB?.kind).toBe("Text");
      expect(topA?.kind).toBe("Text");
      expect(topB?.kind).toBe("Text");
      expect(eastB?.kind).toBe("Text");
      expect(baseEastB?.kind).toBe("Text");
  
      if (
        centerA?.kind === "Text" &&
        centerB?.kind === "Text" &&
        topA?.kind === "Text" &&
        topB?.kind === "Text" &&
        eastB?.kind === "Text" &&
        baseEastB?.kind === "Text"
      ) {
        const topADx = Math.abs(topA.position.x - centerA.position.x);
        const topADy = Math.abs(topA.position.y - centerA.position.y);
        const topBDx = Math.abs(topB.position.x - centerB.position.x);
        const topBDy = Math.abs(topB.position.y - centerB.position.y);
  
        expect(topADy).toBeGreaterThan(topADx);
        expect(topBDx).toBeGreaterThan(topBDy);
        expect(Math.abs(baseEastB.position.y - eastB.position.y)).toBeGreaterThan(0.5);
      }
    });

    it("supports semicircle shape with special anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[semicircle,draw,name=s] at (0,0) {S};
    \node at (s.apex) {A};
    \node at (s.arc start) {B};
    \node at (s.arc end) {C};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
      const apex = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const arcStart = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      const arcEnd = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
  
      expect(center?.kind).toBe("Text");
      expect(apex?.kind).toBe("Text");
      expect(arcStart?.kind).toBe("Text");
      expect(arcEnd?.kind).toBe("Text");
      if (center?.kind === "Text" && apex?.kind === "Text" && arcStart?.kind === "Text" && arcEnd?.kind === "Text") {
        expect(apex.position.y).toBeGreaterThan(center.position.y);
        expect(arcStart.position.x).toBeGreaterThan(center.position.x);
        expect(arcEnd.position.x).toBeLessThan(center.position.x);
      }
    });

    it("supports regular polygon shape with side/corner anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[regular polygon,regular polygon sides=6,shape border rotate=30,draw,name=p] at (0,0) {P};
    \node at (p.corner 1) {C1};
    \node at (p.side 1)   {S1};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P");
      const corner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C1");
      const side = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S1");
      expect(center?.kind).toBe("Text");
      expect(corner?.kind).toBe("Text");
      expect(side?.kind).toBe("Text");
      if (center?.kind === "Text" && corner?.kind === "Text" && side?.kind === "Text") {
        const cornerDistance = Math.hypot(corner.position.x - center.position.x, corner.position.y - center.position.y);
        const sideDistance = Math.hypot(side.position.x - center.position.x, side.position.y - center.position.y);
        expect(cornerDistance).toBeGreaterThan(sideDistance);
      }
    });

    it("supports star shape with point anchors and height/ratio options", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[star,star points=5,star point ratio=1.7,draw,name=a] at (0,0) {A};
    \node[star,star points=5,star point height=.5cm,draw,name=b] at (4,0) {B};
    \node at (a.outer point 1) {O};
    \node at (a.inner point 1) {I};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const outer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "O");
      const inner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "I");
      expect(center?.kind).toBe("Text");
      expect(outer?.kind).toBe("Text");
      expect(inner?.kind).toBe("Text");
      if (center?.kind === "Text" && outer?.kind === "Text" && inner?.kind === "Text") {
        const outerDistance = Math.hypot(outer.position.x - center.position.x, outer.position.y - center.position.y);
        const innerDistance = Math.hypot(inner.position.x - center.position.x, inner.position.y - center.position.y);
        expect(outerDistance).toBeGreaterThan(innerDistance);
      }
    });

    it("supports isosceles triangle shape with corner and side anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[isosceles triangle,draw,name=t] at (0,0) {T};
    \node at (t.apex)        {A};
    \node at (t.left corner) {L};
    \node at (t.lower side)  {B};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "T");
      const apex = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const leftCorner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "L");
      const lowerSide = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      expect(center?.kind).toBe("Text");
      expect(apex?.kind).toBe("Text");
      expect(leftCorner?.kind).toBe("Text");
      expect(lowerSide?.kind).toBe("Text");
      if (center?.kind === "Text" && apex?.kind === "Text" && leftCorner?.kind === "Text" && lowerSide?.kind === "Text") {
        expect(apex.position.x).toBeGreaterThan(center.position.x);
        expect(leftCorner.position.x).toBeLessThan(center.position.x);
        expect(lowerSide.position.y).toBeLessThanOrEqual(center.position.y);
      }
    });

    it("supports kite shape with vertex and side anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[kite,draw,kite vertex angles=90 and 45,name=k] at (0,0) {K};
    \node at (k.upper vertex)     {U};
    \node at (k.lower right side) {R};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "K");
      const upper = result.scene.elements.find((element) => element.kind === "Text" && element.text === "U");
      const rightSide = result.scene.elements.find((element) => element.kind === "Text" && element.text === "R");
      expect(center?.kind).toBe("Text");
      expect(upper?.kind).toBe("Text");
      expect(rightSide?.kind).toBe("Text");
      if (center?.kind === "Text" && upper?.kind === "Text" && rightSide?.kind === "Text") {
        expect(upper.position.y).toBeGreaterThan(center.position.y);
        expect(rightSide.position.x).toBeGreaterThan(center.position.x);
      }
    });

    it("supports dart shape with tip and tail anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[dart,draw,dart tip angle=45,dart tail angle=135,name=d] at (0,0) {D};
    \node at (d.tip)         {T};
    \node at (d.tail center) {C};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
      const tip = result.scene.elements.find((element) => element.kind === "Text" && element.text === "T");
      const tailCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      expect(center?.kind).toBe("Text");
      expect(tip?.kind).toBe("Text");
      expect(tailCenter?.kind).toBe("Text");
      if (center?.kind === "Text" && tip?.kind === "Text" && tailCenter?.kind === "Text") {
        expect(tip.position.x).toBeGreaterThan(center.position.x);
        expect(tailCenter.position.x).toBeLessThan(center.position.x);
      }
    });

    it("supports circular sector shape with arc anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[circular sector,draw,circular sector angle=80,name=c] at (0,0) {C};
    \node at (c.sector center) {S};
    \node at (c.arc center)    {A};
    \node at (c.arc start)     {B};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      const sectorCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
      const arcCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const arcStart = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      expect(center?.kind).toBe("Text");
      expect(sectorCenter?.kind).toBe("Text");
      expect(arcCenter?.kind).toBe("Text");
      expect(arcStart?.kind).toBe("Text");
      if (
        center?.kind === "Text" &&
        sectorCenter?.kind === "Text" &&
        arcCenter?.kind === "Text" &&
        arcStart?.kind === "Text"
      ) {
        expect(sectorCenter.position.x).toBeGreaterThan(center.position.x);
        expect(arcCenter.position.x).toBeLessThan(center.position.x);
        expect(arcStart.position.y).toBeGreaterThan(center.position.y - 1);
      }
    });

    it("supports cylinder shape with top, bottom, and shape-center anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[cylinder,draw,aspect=.5,name=y] at (0,0) {Y};
    \node at (y.top)          {T};
    \node at (y.bottom)       {B};
    \node at (y.shape center) {S};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "Y");
      const top = result.scene.elements.find((element) => element.kind === "Text" && element.text === "T");
      const bottom = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      const shapeCenter = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
      expect(center?.kind).toBe("Text");
      expect(top?.kind).toBe("Text");
      expect(bottom?.kind).toBe("Text");
      expect(shapeCenter?.kind).toBe("Text");
      if (center?.kind === "Text" && top?.kind === "Text" && bottom?.kind === "Text" && shapeCenter?.kind === "Text") {
        expect(top.position.x).toBeGreaterThan(center.position.x);
        expect(bottom.position.x).toBeLessThan(center.position.x);
        expect(shapeCenter.position.x).toBeGreaterThan(center.position.x);
      }
    });

    it("supports cloud shape with puff anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[cloud,cloud puffs=9,cloud puff arc=140,draw,name=c] at (0,0) {C};
    \node at (c.puff 1) {P1};
    \node at (c.puff 4) {P4};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      const puff1 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P1");
      const puff4 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P4");
      expect(center?.kind).toBe("Text");
      expect(puff1?.kind).toBe("Text");
      expect(puff4?.kind).toBe("Text");
      if (center?.kind === "Text" && puff1?.kind === "Text" && puff4?.kind === "Text") {
        const d1 = Math.hypot(puff1.position.x - center.position.x, puff1.position.y - center.position.y);
        const d4 = Math.hypot(puff4.position.x - center.position.x, puff4.position.y - center.position.y);
        expect(d1).toBeGreaterThan(5);
        expect(d4).toBeGreaterThan(5);
        expect(Math.abs(puff1.position.x - puff4.position.x) + Math.abs(puff1.position.y - puff4.position.y)).toBeGreaterThan(1);
      }
    });

    it("supports starburst shape with outer and inner point anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[starburst,starburst points=11,starburst point height=5pt,random starburst=0,draw,name=s] at (0,0) {S};
    \node at (s.outer point 1) {O};
    \node at (s.inner point 1) {I};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
      const outer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "O");
      const inner = result.scene.elements.find((element) => element.kind === "Text" && element.text === "I");
      expect(center?.kind).toBe("Text");
      expect(outer?.kind).toBe("Text");
      expect(inner?.kind).toBe("Text");
      if (center?.kind === "Text" && outer?.kind === "Text" && inner?.kind === "Text") {
        const outerDistance = Math.hypot(outer.position.x - center.position.x, outer.position.y - center.position.y);
        const innerDistance = Math.hypot(inner.position.x - center.position.x, inner.position.y - center.position.y);
        expect(outerDistance).toBeGreaterThan(innerDistance);
      }
    });

    it("keeps random starburst deterministic with explicit seed", () => {
      const source = String.raw`\begin{tikzpicture}
    \pgfmathsetseed{17};
    \node[starburst,starburst points=13,starburst point height=5pt,random starburst,draw] at (0,0) {S};
  \end{tikzpicture}`;
      const first = evaluateSemantic(source);
      const second = evaluateSemantic(source);

      const firstPath = first.scene.elements.find((element) => element.kind === "Path");
      const secondPath = second.scene.elements.find((element) => element.kind === "Path");
      expect(firstPath?.kind).toBe("Path");
      expect(secondPath?.kind).toBe("Path");
      if (firstPath?.kind === "Path" && secondPath?.kind === "Path") {
        expect(firstPath.commands).toEqual(secondPath.commands);
      }
    });

    it("keeps random starburst=0 geometry deterministic and seed-independent", () => {
      const seeded = evaluateSemantic(String.raw`\begin{tikzpicture}
    \pgfmathsetseed{99};
    \node[starburst,starburst points=9,starburst point height=4pt,random starburst=0,draw] at (0,0) {S};
  \end{tikzpicture}`);
      const unseeded = evaluateSemantic(String.raw`\begin{tikzpicture}
    \node[starburst,starburst points=9,starburst point height=4pt,random starburst=0,draw] at (0,0) {S};
  \end{tikzpicture}`);

      const seededPath = seeded.scene.elements.find((element) => element.kind === "Path");
      const unseededPath = unseeded.scene.elements.find((element) => element.kind === "Path");
      expect(seededPath?.kind).toBe("Path");
      expect(unseededPath?.kind).toBe("Path");
      if (seededPath?.kind === "Path" && unseededPath?.kind === "Path") {
        expect(seededPath.commands).toEqual(unseededPath.commands);
      }
    });

    it("supports signal and tape symbol shapes", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[signal,signal to=east and west,signal from=north and south,signal pointer angle=60,draw,name=g] at (0,0) {G};
    \node at (g.east) {E};
    \node at (g.west) {W};
    \node[tape,tape bend top=out and in,tape bend bottom=none,tape bend height=8pt,draw,name=t] at (4,0) {T};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const g = result.scene.elements.find((element) => element.kind === "Text" && element.text === "G");
      const east = result.scene.elements.find((element) => element.kind === "Text" && element.text === "E");
      const west = result.scene.elements.find((element) => element.kind === "Text" && element.text === "W");
      expect(g?.kind).toBe("Text");
      expect(east?.kind).toBe("Text");
      expect(west?.kind).toBe("Text");
      if (g?.kind === "Text" && east?.kind === "Text" && west?.kind === "Text") {
        expect(east.position.x).toBeGreaterThan(g.position.x);
        expect(west.position.x).toBeLessThan(g.position.x);
      }
  
      const tapePath = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:") && element.commands.length > 30
      );
      expect(tapePath).toBeDefined();
    });

    it("supports single and double arrow shapes with named arrow anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[single arrow,single arrow tip angle=60,single arrow head extend=5pt,draw,name=s] at (0,0) {S};
    \node at (s.tip)         {ST};
    \node at (s.before head) {SB};
    \node at (s.tail)        {SL};
  
    \node[double arrow,double arrow tip angle=70,double arrow head indent=2pt,draw,name=d] at (4,0) {D};
    \node at (d.tip 1)         {D1};
    \node at (d.tip 2)         {D2};
    \node at (d.before head 1) {DH1};
    \node at (d.before head 2) {DH2};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const single = result.scene.elements.find((element) => element.kind === "Text" && element.text === "S");
      const singleTip = result.scene.elements.find((element) => element.kind === "Text" && element.text === "ST");
      const singleBeforeHead = result.scene.elements.find((element) => element.kind === "Text" && element.text === "SB");
      const singleTail = result.scene.elements.find((element) => element.kind === "Text" && element.text === "SL");
      expect(single?.kind).toBe("Text");
      expect(singleTip?.kind).toBe("Text");
      expect(singleBeforeHead?.kind).toBe("Text");
      expect(singleTail?.kind).toBe("Text");
      if (
        single?.kind === "Text" &&
        singleTip?.kind === "Text" &&
        singleBeforeHead?.kind === "Text" &&
        singleTail?.kind === "Text"
      ) {
        expect(singleTip.position.x).toBeGreaterThan(single.position.x);
        expect(singleBeforeHead.position.x).toBeGreaterThan(singleTail.position.x);
        expect(singleBeforeHead.position.x).toBeLessThan(singleTip.position.x);
        expect(singleTail.position.x).toBeLessThan(single.position.x);
      }
  
      const double = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
      const doubleTip1 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D1");
      const doubleTip2 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D2");
      const doubleBeforeHead1 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "DH1");
      const doubleBeforeHead2 = result.scene.elements.find((element) => element.kind === "Text" && element.text === "DH2");
      expect(double?.kind).toBe("Text");
      expect(doubleTip1?.kind).toBe("Text");
      expect(doubleTip2?.kind).toBe("Text");
      expect(doubleBeforeHead1?.kind).toBe("Text");
      expect(doubleBeforeHead2?.kind).toBe("Text");
      if (
        double?.kind === "Text" &&
        doubleTip1?.kind === "Text" &&
        doubleTip2?.kind === "Text" &&
        doubleBeforeHead1?.kind === "Text" &&
        doubleBeforeHead2?.kind === "Text"
      ) {
        expect(doubleTip1.position.x).toBeGreaterThan(double.position.x);
        expect(doubleTip2.position.x).toBeLessThan(double.position.x);
        expect(doubleBeforeHead1.position.x).toBeGreaterThan(doubleTip2.position.x);
        expect(doubleBeforeHead1.position.x).toBeLessThan(doubleTip1.position.x);
        expect(doubleBeforeHead2.position.x).toBeLessThan(doubleTip1.position.x);
        expect(doubleBeforeHead2.position.x).toBeGreaterThan(doubleTip2.position.x);
      }
    });

    it("supports rectangle, ellipse, and cloud callout shapes with pointer anchors", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[rectangle callout,callout relative pointer={(5mm,-4mm)},draw,name=r] at (0,0) {R};
    \node at (r.pointer) {RP};
    \node at (r.east) {RE};
  
    \node[ellipse callout,callout relative pointer={(315:6mm)},callout pointer arc=25,draw,name=e] at (3,0) {E};
    \node at (e.pointer) {EP};
    \node at (e.south) {ES};
  
    \node[cloud callout,cloud puffs=9,callout relative pointer={(300:7mm)},callout pointer segments=3,draw,name=c] at (6,0) {C};
    \node at (c.pointer) {CP};
    \node at (c.puff 1) {P1};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const rectangle = result.scene.elements.find((element) => element.kind === "Text" && element.text === "R");
      const rectanglePointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "RP");
      const rectangleEast = result.scene.elements.find((element) => element.kind === "Text" && element.text === "RE");
      expect(rectangle?.kind).toBe("Text");
      expect(rectanglePointer?.kind).toBe("Text");
      expect(rectangleEast?.kind).toBe("Text");
      if (rectangle?.kind === "Text" && rectanglePointer?.kind === "Text" && rectangleEast?.kind === "Text") {
        const pointerDistance = Math.hypot(
          rectanglePointer.position.x - rectangle.position.x,
          rectanglePointer.position.y - rectangle.position.y
        );
        const eastDistance = Math.hypot(rectangleEast.position.x - rectangle.position.x, rectangleEast.position.y - rectangle.position.y);
        expect(pointerDistance).toBeGreaterThan(eastDistance);
        expect(rectanglePointer.position.y).toBeLessThan(rectangle.position.y);
      }
  
      const ellipse = result.scene.elements.find((element) => element.kind === "Text" && element.text === "E");
      const ellipsePointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "EP");
      const ellipseSouth = result.scene.elements.find((element) => element.kind === "Text" && element.text === "ES");
      expect(ellipse?.kind).toBe("Text");
      expect(ellipsePointer?.kind).toBe("Text");
      expect(ellipseSouth?.kind).toBe("Text");
      if (ellipse?.kind === "Text" && ellipsePointer?.kind === "Text" && ellipseSouth?.kind === "Text") {
        const pointerDistance = Math.hypot(ellipsePointer.position.x - ellipse.position.x, ellipsePointer.position.y - ellipse.position.y);
        const southDistance = Math.hypot(ellipseSouth.position.x - ellipse.position.x, ellipseSouth.position.y - ellipse.position.y);
        expect(pointerDistance).toBeGreaterThan(southDistance);
        expect(ellipsePointer.position.y).toBeLessThan(ellipse.position.y);
      }
  
      const cloud = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      const cloudPointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "CP");
      const cloudPuff = result.scene.elements.find((element) => element.kind === "Text" && element.text === "P1");
      expect(cloud?.kind).toBe("Text");
      expect(cloudPointer?.kind).toBe("Text");
      expect(cloudPuff?.kind).toBe("Text");
      if (cloud?.kind === "Text" && cloudPointer?.kind === "Text" && cloudPuff?.kind === "Text") {
        expect(cloudPointer.position.y).toBeLessThan(cloud.position.y);
        const puffDistance = Math.hypot(cloudPuff.position.x - cloud.position.x, cloudPuff.position.y - cloud.position.y);
        expect(puffDistance).toBeGreaterThan(5);
      }
    });

    it("supports absolute callout pointers and pointer shortening", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[rectangle callout,callout absolute pointer={(3,0)},draw,name=a] at (0,0) {A};
    \node[rectangle callout,callout absolute pointer={(3,0)},callout pointer shorten=10pt,draw,name=b] at (0,-2) {B};
    \node at (a.pointer) {AP};
    \node at (b.pointer) {BP};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("unknown-named-coordinate:"))).toBe(false);
  
      const absolutePointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "AP");
      const shortenedPointer = result.scene.elements.find((element) => element.kind === "Text" && element.text === "BP");
      expect(absolutePointer?.kind).toBe("Text");
      expect(shortenedPointer?.kind).toBe("Text");
      if (absolutePointer?.kind === "Text" && shortenedPointer?.kind === "Text") {
        expect(absolutePointer.position.x).toBeCloseTo(85.3583, 1);
        expect(absolutePointer.position.y).toBeCloseTo(0, 1);
        expect(shortenedPointer.position.x).toBeLessThan(absolutePointer.position.x);
        expect(shortenedPointer.position.y).toBeLessThan(absolutePointer.position.y);
      }
    });

    it("recovers trailing coordinates after node-contents nodes", () => {
      const source = String.raw`\begin{tikzpicture}
    \path (0,0) node [red]                    {A}
          (1,0) node [blue]                   {B}
          (2,0) node [green, node contents=C]
          (3,0) node [node contents=D]           ;
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const c = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      const d = result.scene.elements.find((element) => element.kind === "Text" && element.text === "D");
      expect(c?.kind).toBe("Text");
      expect(d?.kind).toBe("Text");
      if (c?.kind === "Text" && d?.kind === "Text") {
        expect(d.position.x).toBeGreaterThan(c.position.x + 20);
        expect(d.position.y).toBeCloseTo(c.position.y, 3);
      }
    });

    it("targets unnamed node coordinates at the node border for line and to operations", () => {
      const source = String.raw`\begin{tikzpicture}
    \node (a) at (2,2) {a};
    \draw[red] (10pt,10pt) to (a);
    \draw[blue] (3,2) -- (a);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "a");
      expect(text?.kind).toBe("Text");
  
      const redPath = result.scene.elements.find(
        (element) => element.kind === "Path" && (element.style.stroke === "red" || element.style.stroke === "#ff0000")
      );
      const bluePath = result.scene.elements.find(
        (element) => element.kind === "Path" && (element.style.stroke === "blue" || element.style.stroke === "#0000ff")
      );
      expect(redPath?.kind).toBe("Path");
      expect(bluePath?.kind).toBe("Path");
  
      if (text?.kind === "Text" && redPath?.kind === "Path" && bluePath?.kind === "Path") {
        const redEnd = redPath.commands[redPath.commands.length - 1];
        expect(redEnd?.kind).toBe("L");
        if (redEnd?.kind === "L") {
          expect(redEnd.to.x).toBeLessThan(text.position.x);
          expect(redEnd.to.y).toBeLessThan(text.position.y);
        }
  
        const blueEnd = bluePath.commands[bluePath.commands.length - 1];
        expect(blueEnd?.kind).toBe("L");
        if (blueEnd?.kind === "L") {
          expect(blueEnd.to.x).toBeGreaterThan(text.position.x);
          expect(blueEnd.to.x).toBeLessThan(85.3583);
        }
      }
    });

    it("restarts named-node line segments without inheriting prior border directions", () => {
      const source = String.raw`\begin{tikzpicture}[scale=0.9, transform shape]
    \node[draw, circle](1) at (0,0) {1};
    \node[draw, circle](2) at (1,0) {2};
    \node[draw, circle](3) at (2,1) {3};
    \node[draw, circle](4) at (2,0) {4};
    \node[draw, circle](5) at (2,-1) {5};
    \node[draw, circle](6) at (3,0) {6};
    \node[draw, circle](7) at (4,0) {7};
    \draw[-, >=latex,thick] (1)--(2) (2)--(3) (2)--(4) (2)--(5) (3)--(6) (4)--(6) (5)--(6) (6)--(7);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
  
      if (path?.kind === "Path") {
        expect(path.commands.map((command) => command.kind)).toEqual([
          "M",
          "L",
          "M",
          "L",
          "M",
          "L",
          "M",
          "L",
          "M",
          "L",
          "M",
          "L",
          "M",
          "L",
          "M",
          "L"
        ]);
  
        const lastMove = path.commands[path.commands.length - 2];
        const previousLine = path.commands[path.commands.length - 3];
        const lastLine = path.commands[path.commands.length - 1];
        expect(lastMove?.kind).toBe("M");
        expect(previousLine?.kind).toBe("L");
        expect(lastLine?.kind).toBe("L");
        if (lastMove?.kind === "M" && previousLine?.kind === "L" && lastLine?.kind === "L") {
          expect(lastMove.to.y).toBeCloseTo(0, 3);
          expect(lastLine.to.y).toBeCloseTo(0, 3);
          expect(Math.abs(lastMove.to.y - previousLine.to.y)).toBeGreaterThan(1);
          expect(lastLine.to.x).toBeGreaterThan(lastMove.to.x);
        }
      }
    });

    it("supports basic placement offsets like above=... and right=...", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,name=a,node contents=A] at (0,0);
    \node[draw,above=4pt,right=2pt,name=b,node contents=B] at (0,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      expect(aText?.kind).toBe("Text");
      expect(bText?.kind).toBe("Text");
      if (aText?.kind === "Text" && bText?.kind === "Text") {
        expect(bText.position.x).toBeGreaterThan(aText.position.x);
        expect(bText.position.y).toBeGreaterThan(aText.position.y);
      }
    });

    it("supports positioning library relative placement like right=of and above left=of", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,name=a,node contents=A] at (0,0);
    \node[draw,right=of a,name=b,node contents=B];
    \node[draw,above left=of a,name=c,node contents=C];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:a")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-positioning"))).toBe(false);
  
      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      expect(aText?.kind).toBe("Text");
      expect(bText?.kind).toBe("Text");
      expect(cText?.kind).toBe("Text");
      if (aText?.kind === "Text" && bText?.kind === "Text" && cText?.kind === "Text") {
        expect(bText.position.x).toBeGreaterThan(aText.position.x + 10);
        expect(cText.position.x).toBeLessThan(aText.position.x - 10);
        expect(cText.position.y).toBeGreaterThan(aText.position.y + 10);
      }
    });

    it("keeps an explicit node anchor when positioning also supplies a synthetic anchor", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,minimum size=1cm,name=a,node contents=A] at (0,0);
    \node[draw,minimum size=2cm,below=1cm of a.south east,anchor=center,name=b,node contents=B];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-positioning"))).toBe(false);

      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      expect(aText?.kind).toBe("Text");
      expect(bText?.kind).toBe("Text");
      if (aText?.kind === "Text" && bText?.kind === "Text") {
        expect(bText.position.y).toBeLessThan(aText.position.y - 20);
      }
    });

    it("resolves standalone node names for above=of chains", () => {
      const source = String.raw`\begin{tikzpicture}[every node/.style=draw]
    \node (a1) at (0,0) {A};
    \node (b1) [above=1cm of a1] {B};
    \node (c1) [above=1cm of b1] {C};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:a1")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unknown-named-coordinate:b1")).toBe(false);
  
      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      const cText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      expect(aText?.kind).toBe("Text");
      expect(bText?.kind).toBe("Text");
      expect(cText?.kind).toBe("Text");
      if (aText?.kind === "Text" && bText?.kind === "Text" && cText?.kind === "Text") {
        expect(bText.position.y).toBeGreaterThan(aText.position.y + 10);
        expect(cText.position.y).toBeGreaterThan(bText.position.y + 10);
      }
    });

    it("treats unitless node distance as coordinate units under on-grid placement", () => {
      const source = String.raw`\begin{tikzpicture}[on grid,node distance=1]
    \node[draw,name=a,node contents=A] at (0,0);
    \node[draw,right=of a,name=b,node contents=B];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      expect(aText?.kind).toBe("Text");
      expect(bText?.kind).toBe("Text");
      if (aText?.kind === "Text" && bText?.kind === "Text") {
        expect(bText.position.x).toBeCloseTo(aText.position.x + 28.4528, 3);
        expect(bText.position.y).toBeCloseTo(aText.position.y, 3);
      }
    });

    it("supports deprecated placement keys like left of=... and below right of=...", () => {
      const source = String.raw`\begin{tikzpicture}[node distance=10pt]
    \node[draw,name=a,node contents=A] at (0,0);
    \node[draw,left of=a,name=l,node contents=L];
    \node[draw,below right of=a,name=r,node contents=R];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const lText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "L");
      const rText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "R");
      expect(aText?.kind).toBe("Text");
      expect(lText?.kind).toBe("Text");
      expect(rText?.kind).toBe("Text");
      if (aText?.kind === "Text" && lText?.kind === "Text" && rText?.kind === "Text") {
        expect(lText.position.x).toBeCloseTo(aText.position.x - 10, 3);
        expect(rText.position.x).toBeCloseTo(aText.position.x + 10 / Math.sqrt(2), 3);
        expect(rText.position.y).toBeCloseTo(aText.position.y - 10 / Math.sqrt(2), 3);
      }
    });

    it("supports on-grid center-to-center relative placement", () => {
      const source = String.raw`\begin{tikzpicture}[on grid,node distance=12pt]
    \node[draw,name=a,node contents=A] at (0,0);
    \node[draw,above=of a,name=b,node contents=B];
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:on grid")).toBe(false);
  
      const aText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "A");
      const bText = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      expect(aText?.kind).toBe("Text");
      expect(bText?.kind).toBe("Text");
      if (aText?.kind === "Text" && bText?.kind === "Text") {
        expect(bText.position.x).toBeCloseTo(aText.position.x, 3);
        expect(bText.position.y).toBeCloseTo(aText.position.y + 12, 3);
      }
    });

    it("applies standalone font-size commands like \\huge before subsequent nodes", () => {
      const source = String.raw`\begin{tikzpicture}[node distance=1ex]
    \huge
    \node (X) at (0,1) {X};
    \node (a) [right=of X] {a};
    \node (y) [base right=of a] {y};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-statement")).toBe(false);
      const texts = elementsOfKind(result.scene.elements, "Text");
      expect(texts.length).toBe(3);
  
      const xText = texts.find((element) => element.kind === "Text" && element.text === "X");
      const aText = texts.find((element) => element.kind === "Text" && element.text === "a");
      const yText = texts.find((element) => element.kind === "Text" && element.text === "y");
      expect(xText?.kind).toBe("Text");
      expect(aText?.kind).toBe("Text");
      expect(yText?.kind).toBe("Text");
      if (xText?.kind === "Text" && aText?.kind === "Text" && yText?.kind === "Text") {
        expect(xText.style.fontSize).toBeGreaterThan(18);
        expect(aText.position.x).toBeGreaterThan(xText.position.x);
        expect(yText.position.x).toBeGreaterThan(aText.position.x);
      }
    });

    it("applies \\tikzset every-node style keys to subsequent nodes", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{
      every node/.style={draw},
      every circle node/.style={double}
    }
    \draw (0,0) node {A} -- (1,1) node[circle] {B};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.includes("every node/.style"))).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.includes("every circle node/.style"))).toBe(false);
  
      const nodeBoxes = result.scene.elements.filter((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
      const circles = elementsOfKind(result.scene.elements, "Circle");
      expect(nodeBoxes.length).toBe(1);
      expect(circles.length).toBe(1);
      const circle = circles[0];
      expect(circle?.kind).toBe("Circle");
      if (circle?.kind === "Circle") {
        expect(circle.style.doubleStroke).toBe(true);
      }
    });

    it("applies every-node style keys for rectangle and circle nodes", () => {
      const source = String.raw`\begin{tikzpicture}[
    every node/.style={draw},
    every circle node/.style={double}
  ]
    \draw (0,0) node {A} -- (1,1) node[circle] {B};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.includes("every node/.style"))).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.includes("every circle node/.style"))).toBe(false);
  
      const nodeBoxes = result.scene.elements.filter((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
      const circles = elementsOfKind(result.scene.elements, "Circle");
      expect(nodeBoxes.length).toBe(1);
      expect(circles.length).toBe(1);
      const circle = circles[0];
      expect(circle?.kind).toBe("Circle");
      if (circle?.kind === "Circle") {
        expect(circle.style.doubleStroke).toBe(true);
      }
    });

    it("keeps shape style replacement and appends data-driven across shape aliases", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{
      every rectangle node/.style={draw},
      every rectangle node/.append style={fill=blue}
    }
    \tikzstyle{every circle node}=[draw]
    \tikzstyle{every circle node}+=[fill=green]
    \node[rounded rectangle] at (0,0) {R};
    \node[circle] at (2,0) {C};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const roundedRectangle = result.scene.elements.find(
        (element) => element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      const circle = elementsOfKind(result.scene.elements, "Circle")[0];
      expect(roundedRectangle?.style.fill).toBe("#0000ff");
      expect(circle?.style.fill).toBe("#00ff00");
    });

    it("applies every-node style keys for diamond and trapezium nodes", () => {
      const source = String.raw`\begin{tikzpicture}[
    every node/.style={draw},
    every diamond node/.style={double},
    every trapezium node/.style={fill=red}
  ]
    \draw (0,0) node[diamond]   {D};
    \draw (2,0) node[trapezium] {T};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBoxes).toHaveLength(2);
  
      const byX = nodeBoxes
        .map((path) => ({
          path,
          centerX:
            path.commands
              .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
              .reduce((sum, x) => sum + x, 0) /
            Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
        }))
        .sort((left, right) => left.centerX - right.centerX);
  
      const diamond = byX[0]?.path;
      const trapezium = byX[1]?.path;
      expect(diamond).toBeDefined();
      expect(trapezium).toBeDefined();
      if (diamond && trapezium) {
        expect(diamond.style.doubleStroke).toBe(true);
        expect(trapezium.style.fill).toBe("#ff0000");
      }
    });

    it("applies every-node style keys for isosceles triangle and cylinder nodes", () => {
      const source = String.raw`\begin{tikzpicture}[
    every node/.style={draw},
    every isosceles triangle node/.style={fill=blue},
    every cylinder node/.style={double}
  ]
    \draw (0,0) node[isosceles triangle] {I};
    \draw (2,0) node[cylinder] {C};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBoxes).toHaveLength(2);
  
      const byX = nodeBoxes
        .map((path) => ({
          path,
          centerX:
            path.commands
              .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
              .reduce((sum, x) => sum + x, 0) /
            Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
        }))
        .sort((left, right) => left.centerX - right.centerX);
  
      const triangle = byX[0]?.path;
      const cylinder = byX[1]?.path;
      expect(triangle).toBeDefined();
      expect(cylinder).toBeDefined();
      if (triangle && cylinder) {
        expect(triangle.style.fill).toBe("#0000ff");
        expect(cylinder.style.doubleStroke).toBe(true);
      }
    });

    it("applies every-node style keys for cloud, starburst, signal, and tape nodes", () => {
      const source = String.raw`\begin{tikzpicture}[
    every node/.style={draw},
    every cloud node/.style={fill=green},
    every starburst node/.style={double},
    every signal node/.style={fill=red},
    every tape node/.style={double}
  ]
    \draw (0,0) node[cloud] {C};
    \draw (2,0) node[starburst] {B};
    \draw (4,0) node[signal] {S};
    \draw (6,0) node[tape] {T};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBoxes).toHaveLength(4);
  
      const byX = nodeBoxes
        .map((path) => ({
          path,
          centerX:
            path.commands
              .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
              .reduce((sum, x) => sum + x, 0) /
            Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
        }))
        .sort((left, right) => left.centerX - right.centerX);
  
      const cloud = byX[0]?.path;
      const starburst = byX[1]?.path;
      const signal = byX[2]?.path;
      const tape = byX[3]?.path;
      expect(cloud).toBeDefined();
      expect(starburst).toBeDefined();
      expect(signal).toBeDefined();
      expect(tape).toBeDefined();
      if (cloud && starburst && signal && tape) {
        expect(cloud.style.fill).toBe("#00ff00");
        expect(starburst.style.doubleStroke).toBe(true);
        expect(signal.style.fill).toBe("#ff0000");
        expect(tape.style.doubleStroke).toBe(true);
      }
    });

    it("applies every-node style keys for single and double arrow nodes", () => {
      const source = String.raw`\begin{tikzpicture}[
    every node/.style={draw},
    every single arrow node/.style={fill=blue},
    every double arrow node/.style={double}
  ]
    \draw (0,0) node[single arrow] {S};
    \draw (2,0) node[double arrow] {D};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBoxes).toHaveLength(2);
  
      const byX = nodeBoxes
        .map((path) => ({
          path,
          centerX:
            path.commands
              .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
              .reduce((sum, x) => sum + x, 0) /
            Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
        }))
        .sort((left, right) => left.centerX - right.centerX);
  
      const singleArrow = byX[0]?.path;
      const doubleArrow = byX[1]?.path;
      expect(singleArrow).toBeDefined();
      expect(doubleArrow).toBeDefined();
      if (singleArrow && doubleArrow) {
        expect(singleArrow.style.fill).toBe("#0000ff");
        expect(doubleArrow.style.doubleStroke).toBe(true);
      }
    });

    it("applies every-node style keys for rectangle, ellipse, and cloud callout nodes", () => {
      const source = String.raw`\begin{tikzpicture}[
    every node/.style={draw},
    every rectangle callout node/.style={fill=yellow},
    every ellipse callout node/.style={double},
    every cloud callout node/.style={fill=red}
  ]
    \draw (0,0) node[rectangle callout] {R};
    \draw (2,0) node[ellipse callout] {E};
    \draw (4,0) node[cloud callout] {C};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBoxes = result.scene.elements.filter(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Path" }> =>
          element.kind === "Path" && element.id.startsWith("scene-node-box:")
      );
      expect(nodeBoxes).toHaveLength(3);
  
      const byX = nodeBoxes
        .map((path) => ({
          path,
          centerX:
            path.commands
              .flatMap((command) => (command.kind === "M" || command.kind === "L" ? [command.to.x] : []))
              .reduce((sum, x) => sum + x, 0) /
            Math.max(path.commands.filter((command) => command.kind === "M" || command.kind === "L").length, 1)
        }))
        .sort((left, right) => left.centerX - right.centerX);
  
      const rectangleCallout = byX[0]?.path;
      const ellipseCallout = byX[1]?.path;
      const cloudCallout = byX[2]?.path;
      expect(rectangleCallout).toBeDefined();
      expect(ellipseCallout).toBeDefined();
      expect(cloudCallout).toBeDefined();
      if (rectangleCallout && ellipseCallout && cloudCallout) {
        expect(rectangleCallout.style.fill).toBe("#ffff00");
        expect(ellipseCallout.style.doubleStroke).toBe(true);
        expect(cloudCallout.style.fill).toBe("#ff0000");
      }
    });

    it("places trailing nodes at the end of +(...) segments", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- +(1,1) node[above] {N};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "N");
      expect(text?.kind).toBe("Text");
      if (text?.kind === "Text") {
        expect(text.position.x).toBeGreaterThan(20);
        expect(text.position.y).toBeGreaterThan(20);
      }
    });

    it("propagates picture-level `auto` to deferred path nodes", () => {
      const source = String.raw`\begin{tikzpicture}[auto]
    \draw (0,0) -- node {A} (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const label = result.scene.elements.find(
        (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
          element.kind === "Text" && element.text === "A"
      );
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.position.y).toBeGreaterThan(0);
      }
    });

    it("inherits anchor options from draw statements and scales node text for transform shape", () => {
      const source = String.raw`\begin{tikzpicture}[scale=3,transform shape]
    \draw[anchor=center] (0,0) node {C};
    \draw[anchor=base]   (0,0) node {B};
    \draw[anchor=mid]    (0,0) node {M};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:transform shape")).toBe(false);
  
      const center = result.scene.elements.find((element) => element.kind === "Text" && element.text === "C");
      const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "B");
      const mid = result.scene.elements.find((element) => element.kind === "Text" && element.text === "M");
      expect(center?.kind).toBe("Text");
      expect(base?.kind).toBe("Text");
      expect(mid?.kind).toBe("Text");
      if (center?.kind === "Text" && base?.kind === "Text" && mid?.kind === "Text") {
        expect(base.position.y).toBeGreaterThan(mid.position.y);
        expect(mid.position.y).toBeGreaterThan(center.position.y);
        expect(base.style.fontSize).toBeCloseTo(9.96264, 3);
        expectLinearTransform(base.transform, { a: 3, b: 0, c: 0, d: 3 });
      }
    });

    it("inherits scope rotation for text when transform shape is enabled", () => {
      const source = String.raw`\begin{tikzpicture}[rotate=40, transform shape]
    \draw (-0.5,3) rectangle (3.5,-0.5);
    \node at (0,2) {test};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "test");
      expect(text?.kind).toBe("Text");
      if (text?.kind === "Text") {
          const radians = (40 * Math.PI) / 180;
          expect(text.rotation ?? 0).toBeCloseTo(0, 3);
          expectLinearTransform(text.transform, {
            a: Math.cos(radians),
            b: Math.sin(radians),
            c: -Math.sin(radians),
            d: Math.cos(radians)
          });
      }
    });

    it("supports node font option for italic text", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[node font=\itshape] (1,0) -- +(1,1) node[above] {italic};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const text = result.scene.elements.find((element) => element.kind === "Text" && element.text === "italic");
      expect(text?.kind).toBe("Text");
      if (text?.kind === "Text") {
        expect(text.style.fontStyle).toBe("italic");
      }
    });

    it("supports font option with TeX size and shape commands", () => {
      const source = String.raw`\begin{tikzpicture}
    \node at (0,0) {base};
    \node[font=\footnotesize] at (1,0) {small};
    \node[font=\Large\itshape] at (2,0) {large};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "base");
      const small = result.scene.elements.find((element) => element.kind === "Text" && element.text === "small");
      const large = result.scene.elements.find((element) => element.kind === "Text" && element.text === "large");
      expect(base?.kind).toBe("Text");
      expect(small?.kind).toBe("Text");
      expect(large?.kind).toBe("Text");
      if (base?.kind === "Text" && small?.kind === "Text" && large?.kind === "Text") {
        expect(small.style.fontSize).toBeCloseTo(base.style.fontSize * 0.8, 3);
        expect(large.style.fontSize).toBeCloseTo(base.style.fontSize * 1.44, 3);
        expect(large.style.fontStyle).toBe("italic");
      }
    });

    it("supports pgfutil font aliases and explicit \\fontsize commands in font options", () => {
      const source = String.raw`\begin{tikzpicture}
    \node at (0,0) {base};
    \node[font=\pgfutil@font@footnotesize\pgfutil@font@itshape] at (1,0) {alias};
    \node[font=\fontsize{6}{7}\selectfont] at (2,0) {custom};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "base");
      const alias = result.scene.elements.find((element) => element.kind === "Text" && element.text === "alias");
      const custom = result.scene.elements.find((element) => element.kind === "Text" && element.text === "custom");
      expect(base?.kind).toBe("Text");
      expect(alias?.kind).toBe("Text");
      expect(custom?.kind).toBe("Text");
      if (base?.kind === "Text" && alias?.kind === "Text" && custom?.kind === "Text") {
        expect(alias.style.fontSize).toBeCloseTo(base.style.fontSize * 0.8, 3);
        expect(alias.style.fontStyle).toBe("italic");
        expect(custom.style.fontSize).toBeCloseTo(6, 3);
      }
    });

    it("supports weight/family font commands and mixed command sequences in font options", () => {
      const source = String.raw`\begin{tikzpicture}
    \node at (0,0) {base};
    \node[font=\sffamily] at (0,1) {sans};
    \node[font=\bf] at (0,2) {bf};
    \node[font=\bfseries] at (0,3) {bfseries};
    \node[font=\sffamily\bfseries] at (0,4) {sansbold};
    \node[font=\small\bf] at (0,5) {smallbold};
    \node[font=\ttfamily\mdseries\upshape] at (0,6) {mono};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const byText = new Map(
        result.scene.elements
          .filter((element) => element.kind === "Text")
          .map((element) => [element.text, element] as const)
      );
  
      const base = byText.get("base");
      const sans = byText.get("sans");
      const bf = byText.get("bf");
      const bfseries = byText.get("bfseries");
      const sansbold = byText.get("sansbold");
      const smallbold = byText.get("smallbold");
      const mono = byText.get("mono");
  
      expect(base?.kind).toBe("Text");
      expect(sans?.kind).toBe("Text");
      expect(bf?.kind).toBe("Text");
      expect(bfseries?.kind).toBe("Text");
      expect(sansbold?.kind).toBe("Text");
      expect(smallbold?.kind).toBe("Text");
      expect(mono?.kind).toBe("Text");
      if (
        base?.kind === "Text" &&
        sans?.kind === "Text" &&
        bf?.kind === "Text" &&
        bfseries?.kind === "Text" &&
        sansbold?.kind === "Text" &&
        smallbold?.kind === "Text" &&
        mono?.kind === "Text"
      ) {
        expect(sans.style.fontFamily).toBe("sans");
        expect(bf.style.fontWeight).toBe("bold");
        expect(bfseries.style.fontWeight).toBe("bold");
        expect(sansbold.style.fontFamily).toBe("sans");
        expect(sansbold.style.fontWeight).toBe("bold");
        expect(smallbold.style.fontWeight).toBe("bold");
        expect(smallbold.style.fontSize).toBeCloseTo(base.style.fontSize * 0.9, 3);
        expect(mono.style.fontFamily).toBe("monospace");
        expect(mono.style.fontWeight).toBe("normal");
        expect(mono.style.fontStyle).toBe("normal");
      }
    });

    it("applies colorlet aliases to both style options and node text colors", () => {
      const source = String.raw`\begin{tikzpicture}
    \colorlet{mycolor}{blue}
    \fill[mycolor] (0,0) rectangle (1,1);
    \node at (0, -1) {My favorite color is \textcolor{mycolor}{this}!};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:mycolor")).toBe(false);
  
      const filledPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.fill != null);
      expect(filledPath?.kind).toBe("Path");
      if (filledPath?.kind === "Path") {
        expect(filledPath.style.fill).toBe("#0000ff");
      }
  
      const label = result.scene.elements.find((element) => element.kind === "Text" && element.text.includes("favorite color"));
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.text).toContain(String.raw`\textcolor{mycolor}{this}`);
      }
    });

    it("applies definecolor HTML aliases to both style options and node text colors", () => {
      const source = String.raw`\begin{tikzpicture}
    \definecolor{brand}{HTML}{1A2B3C}
    \fill[brand] (0,0) rectangle (1,1);
    \node at (0, -1) {Brand is \textcolor{brand}{this}.};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:brand")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-statement")).toBe(false);
  
      const filledPath = result.scene.elements.find((element) => element.kind === "Path" && element.style.fill != null);
      expect(filledPath?.kind).toBe("Path");
      if (filledPath?.kind === "Path") {
        expect(filledPath.style.fill).toBe("#1a2b3c");
      }
  
      const label = result.scene.elements.find((element) => element.kind === "Text" && element.text.includes("Brand is"));
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.text).toContain(String.raw`\textcolor{brand}{this}`);
      }
    });

    it("records node style-chain ordering for every-node/every-shape/command layers", () => {
      const source = String.raw`\begin{tikzpicture}[every node/.style={draw},every circle node/.style={fill=blue}]
    \node[circle,fill=red] at (0,0) {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const circle = result.scene.elements.find((element) => element.kind === "Circle");
      expect(circle?.kind).toBe("Circle");
      if (circle?.kind !== "Circle") {
        return;
      }
  
      const everyNodeIndex = circle.styleChain.findIndex((entry) => entry.kind === "every-node");
      const everyShapeIndex = circle.styleChain.findIndex((entry) => entry.kind === "every-shape" && entry.shape === "circle");
      const nodeCommandIndex = circle.styleChain.findIndex(
        (entry) => entry.kind === "command" && entry.sourceRef?.sourceKind === "node-options"
      );
      expect(everyNodeIndex).toBeGreaterThan(-1);
      expect(everyShapeIndex).toBeGreaterThan(-1);
      expect(nodeCommandIndex).toBeGreaterThan(-1);
      expect(everyNodeIndex).toBeLessThan(everyShapeIndex);
      expect(everyShapeIndex).toBeLessThan(nodeCommandIndex);
    });

    it("expands custom node styles before node-shape resolution", () => {
      const source = String.raw`\begin{tikzpicture}[black_vertex/.style={circle,draw,fill,scale=0.75}]
    \node[black_vertex] at (0,0) {};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:black_vertex")).toBe(false);

      const circle = firstElementOfKind(result.scene.elements, "Circle");
      expect(circle?.kind).toBe("Circle");
    });

    it("attaches traced style chains to edge and pin-edge outputs", () => {
      const source = String.raw`\begin{tikzpicture}[every edge/.style={draw,blue},pin edge={draw=green,dotted}]
    \path (0,0) edge[dashed] (1,0);
    \node[pin=above:P] at (0,1) {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const edgePath = result.scene.elements.find((element) => element.kind === "Path" && element.id.includes("edge-operation"));
      const pinEdgePath = result.scene.elements.find((element) => element.kind === "Path" && element.id.includes(":pin-edge:"));
      expect(edgePath?.kind).toBe("Path");
      expect(pinEdgePath?.kind).toBe("Path");
      if (edgePath?.kind !== "Path" || pinEdgePath?.kind !== "Path") {
        return;
      }
  
      expect(edgePath.styleChain.some((entry) => entry.kind === "named-style" && entry.styleName === "every edge")).toBe(true);
      expect(edgePath.styleChain.some((entry) => entry.kind === "command" && entry.sourceRef?.sourceKind === "edge-options")).toBe(true);
      expect(pinEdgePath.styleChain.some((entry) => entry.kind === "named-style" && entry.styleName === "help lines")).toBe(true);
      expect(pinEdgePath.styleChain.some((entry) => entry.kind === "command" && entry.sourceRef?.sourceKind === "pin-edge-options")).toBe(true);
    });
});
