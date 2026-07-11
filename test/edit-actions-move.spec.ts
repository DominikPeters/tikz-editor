import { describe, expect, it } from "vitest";
import type { WorldPoint } from "../packages/core/src/coords/points.js";
import { frameToWorldTransform } from "../packages/core/src/coords/transforms.js";
import { scaleMatrix } from "../packages/core/src/semantic/transform.js";
import { applyEditAction, preflightPositionNodeRelativeToAction } from "../packages/core/src/edit/actions.js";
import { createEditAnalysisSession } from "../packages/core/src/edit/analysis.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { createMathJaxNodeTextEngine } from "../packages/core/src/text/mathjax-engine.js";
import { wp } from "./coords-helpers.js";
import { cm, expectPatchesReconstructSource, makeHandle } from "./edit-actions-helpers.js";

// ── moveElement ────────────────────────────────────────────────────────────────

describe("applyEditAction – moveElement", () => {
  it("returns unsupported for empty or duplicate-normalized moveElements selections", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: [" ", "", " "] as string[],
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("No element ids");
    }
  });

  it("rejects stale handles when moving elements with opaque source identities", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const sourceFingerprint = `source-revision:doc-a:7:${source.length}`;
    const nextSourceFingerprint = `source-revision:doc-a:8:${source.length}`;
    const firstSpan = { from: 6, to: 11 };
    const secondSpan = { from: 15, to: 20 };
    const first = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: firstSpan,
      sourceId: "path:0",
      sourceRef: {
        sourceId: "path:0",
        sourceSpan: firstSpan,
        sourceFingerprint
      }
    });
    const second = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: secondSpan,
      sourceId: "path:0",
      sourceRef: {
        sourceId: "path:0",
        sourceSpan: secondSpan,
        sourceFingerprint
      }
    });

    const result = applyEditAction(
      source,
      [first, second],
      {
        kind: "moveElements",
        elementIds: ["path:0"],
        delta: wp(cm(1), cm(1))
      },
      { parseOptions: { sourceFingerprint: nextSourceFingerprint } }
    );

    expect(result.kind).toBe("error");
  });

  it("moves all handles of an element by a delta", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const h1 = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 6, to: 11 },
      sourceId: "elem-1"
    });
    const h2 = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: { from: 15, to: 20 },
      id: "handle-15-20",
      sourceId: "elem-1"
    });

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (2,3) -- (4,5);");
    }
  });

  it("moves handles for multiple element ids in one action", () => {
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 14, to: 19 },
      sourceId: "path:0"
    });
    const h2 = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "path:1"
    });

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElements",
      elementIds: ["path:0", "path:1"],
      delta: wp(cm(1), cm(0))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("(2,2)");
      expect(result.newSource).toContain("(4,4)");
    }
  });

  it("returns unsupported when element has no handles", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "nonexistent",
      delta: wp(cm(1), cm(1))
    });
    expect(result.kind).toBe("unsupported");
  });

  it("returns unsupported when every selected handle is non-rewritable", () => {
    const source = "\\draw (A) -- (B);";
    const firstRaw = "(A)";
    const secondRaw = "(B)";
    const firstFrom = source.indexOf(firstRaw);
    const secondFrom = source.indexOf(secondRaw);
    const first = makeHandle(source, {
      world: wp(0, 0),
      sourceSpan: { from: firstFrom, to: firstFrom + firstRaw.length },
      sourceId: "path:0",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    const second = makeHandle(source, {
      world: wp(1, 1),
      sourceSpan: { from: secondFrom, to: secondFrom + secondRaw.length },
      sourceId: "path:0",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });

    const result = applyEditAction(source, [first, second], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(1, 1)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("All handles");
    }
  });

  it("skips handles whose source text no longer matches the current span", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const raw = "(1,2)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0",
      sourceText: "(9,9)"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("No coordinate rewrites");
    }
  });

  it("returns partial when some handles are unsupported", () => {
    const source = "\\draw (0,0) .. controls (A) .. (1,2);";
    const unsupportedRaw = "(A)";
    const unsupportedFrom = source.indexOf(unsupportedRaw);
    const unsupported = makeHandle(source, {
      world: wp(cm(0), cm(0)),
      sourceSpan: { from: unsupportedFrom, to: unsupportedFrom + unsupportedRaw.length },
      sourceId: "elem-1",
      kind: "path-control",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    const supportedRaw = "(1,2)";
    const supportedFrom = source.lastIndexOf(supportedRaw);
    const supported = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: supportedFrom, to: supportedFrom + supportedRaw.length },
      sourceId: "elem-1"
    });

    const result = applyEditAction(source, [unsupported, supported], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: wp(cm(1), cm(0))
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.skippedHandles).toHaveLength(1);
      expect(result.newSource).toBe("\\draw (0,0) .. controls (A) .. (2,2);");
    }
  });

  it("returns partial for moveElements when only some handles on a selected element rewrite", () => {
    const source = "\\draw (0,0) .. controls (A) .. (1,2);";
    const unsupportedRaw = "(A)";
    const unsupportedFrom = source.indexOf(unsupportedRaw);
    const unsupported = makeHandle(source, {
      world: wp(cm(0), cm(0)),
      sourceSpan: { from: unsupportedFrom, to: unsupportedFrom + unsupportedRaw.length },
      sourceId: "path:0",
      kind: "path-control",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    const supportedRaw = "(1,2)";
    const supportedFrom = source.lastIndexOf(supportedRaw);
    const supported = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: supportedFrom, to: supportedFrom + supportedRaw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [unsupported, supported], {
      kind: "moveElements",
      elementIds: ["path:0"],
      delta: wp(cm(1), cm(0))
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.reason).toContain("unsupported coordinate forms");
    expect(result.skippedHandles).toEqual([unsupported.id]);
    expect(result.newSource).toBe("\\draw (0,0) .. controls (A) .. (2,2);");
    expectPatchesReconstructSource(source, result);
  });

  it("applies patches in correct order (handles at different offsets)", () => {
    // Both handles in same source; higher-offset patch applied first
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: wp(cm(1), cm(2)),
      sourceSpan: { from: 14, to: 19 },
      sourceId: "multi"
    });
    const h2 = makeHandle(source, {
      world: wp(cm(3), cm(4)),
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "multi"
    });

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "multi",
      delta: wp(cm(10), cm(10))
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("(11,12)");
      expect(result.newSource).toContain("(13,14)");
    }
  });

  it("moves matrix statements by rewriting inline at coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at (1,2)");
    expect(result.newSource).not.toContain("at=(1,2)");
  });

  it("moves nodes without explicit placement by inserting an inline at coordinate", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(2), cm(3))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("  \\node (A) at (2,3) {A};");
    expectPatchesReconstructSource(source, result);
  });

  it("moves tree roots without rewriting child operation bodies into coordinates", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right] node[draw,level distance=15mm, sibling distance=10mm, rounded corners=2pt,fill=blue!10] at (0,0) {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.29), cm(0.12))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("child { node[draw,fill=green!12] {Leaf A} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B1} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B2} }");
    expect(result.newSource).not.toMatch(/\n\s*\([^)]+\)\s*\n\s*\([^)]+\)\s*;/);
    expect(result.newSource).toMatch(/at\s*\([^)]+\)\s*\{Root\}/);
    expectPatchesReconstructSource(source, result);
  });

  it("moves tree roots without explicit at by inserting inline placement", () => {
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
    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.29), cm(0.12))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/node\[draw,rounded corners=2pt,fill=blue!10\]\s*at\s*\([^)]+\)\s*\{Root\}/);
    expect(result.newSource).toContain("child { node[draw,fill=green!12] {Leaf A} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B1} }");
    expect(result.newSource).toContain("child { node[draw,fill=yellow!16] {Leaf B2} }");
    expectPatchesReconstructSource(source, result);
  });

  it("moves tree roots incrementally from the root node position (not full-tree bounds center)", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=15mm,sibling distance=10mm]
    node[draw,rounded corners=2pt,fill=blue!10] at (0,0) {Root}
    child { node[draw,fill=green!12] {Leaf A} }
    child {
      node[draw,fill=green!12] {Branch}
      child { node[draw,fill=yellow!16] {Leaf B1} }
      child { node[draw,fill=yellow!16] {Leaf B2} }
    };
\end{tikzpicture}`;

    const first = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.1), cm(0))
    });
    expect(first.kind).toBe("success");
    if (first.kind !== "success") return;
    expect(first.newSource).toMatch(/at\s*\(0\.1,0\)\s*\{Root\}/);

    const second = applyEditAction(first.newSource, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(0.1), cm(0))
    });
    expect(second.kind).toBe("success");
    if (second.kind !== "success") return;
    expect(second.newSource).toMatch(/at\s*\(0\.2,0\)\s*\{Root\}/);
    expect(second.newSource).not.toMatch(/at\s*\(1\.[0-9]+,0\)\s*\{Root\}/);
    expectPatchesReconstructSource(first.newSource, second);
  });

  it("moves matrix statements by normalizing buggy at options into inline placement", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,at={(0,0)}] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\matrix[matrix of nodes] at (1,2) {");
    expect(result.newSource).not.toContain("at={");
  });

  it("preserves matrix option comments while moving option-based placement inline", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes, % keep matrix layout
    row sep=2mm, at={(0,0)}] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("% keep matrix layout");
    expect(result.newSource).toContain("    row sep=2mm");
    expect(result.newSource).toContain(" at (1,2) {");
    expect(result.newSource).not.toContain("at={(0,0)}");
  });

  it("moves matrix statements without placement by inserting inline at (...)", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\matrix[matrix of nodes] at (1,2) {");
    expect(result.newSource).not.toContain("at=(");
  });

  it("rejects a matrix target whose cached body opening is missing", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;
    const analysisView = createEditAnalysisSession().ensure(source);
    const target = analysisView.resolvePropertyTarget("path:0");
    expect(target.kind).toBe("found");
    if (target.kind !== "found") return;
    delete target.target.matrixBodyOpenOffset;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    }, {
      parseOptions: { analysisView }
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "Could not resolve matrix body opening for path:0"
    });
  });

  it("moves matrix statements with ampersand replacement using inline placement syntax", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[
    matrix of nodes,
    ampersand replacement=\&,
  ] (m) {
    A \& B \& C \\
    D \& E \& F \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(-0.21), cm(0.17))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("ampersand replacement=\\&");
    expect(result.newSource).toContain("] (m) at (-0.21,0.17) {");
    expect(result.newSource).not.toContain("at=");
    expect(result.newSource).not.toContain(",,");
  });

  it("formats matrix placement through a provided frame-local placement handle", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A \\
  };
\end{tikzpicture}`;
    const raw = "(0,0)";
    const from = source.indexOf(raw);
    const placementHandle = makeHandle(source, {
      kind: "node-position",
      world: wp(0, 0),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0",
      frame: frameToWorldTransform(2, 0, 0, 1, 0, 0),
      transform: scaleMatrix(2, 1)
    });

    const result = applyEditAction(source, [placementHandle], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(2), 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at (1,0)");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes by rewriting xshift and yshift options", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(5.6, -2.4)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=8pt");
    expect(result.newSource).toContain("yshift=1pt");
    expectPatchesReconstructSource(source, result);

    const fine = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(5.6, -2.4),
      formatPrecision: "fine"
    });
    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") return;
    expect(fine.newSource).toContain("xshift=7.6pt");
    expect(fine.newSource).toContain("yshift=0.6pt");
  });

  it("moves scopes with scale before shift by adjusting shift in local scope units", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=2, shift={(2pt,3pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/shift=\{\(4pt,6pt\)\}|shift=\(4pt,6pt\)/);
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes with scale before xshift/yshift by adjusting shifts in local scope units", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=2, xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=4pt");
    expect(result.newSource).toContain("yshift=6pt");
    expectPatchesReconstructSource(source, result);
  });

  it("ignores non-translation flags before scope xshift and yshift entries", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw, xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("xshift=6pt");
    expect(result.newSource).toContain("yshift=9pt");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes through rotated and anisotropic transform prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[rotate=90, xscale=2, yscale=4, shift={(1pt,2pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(8, -4)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/shift=\{\(-1pt,0pt\)\}|shift=\(-1pt,0pt\)/);
    expectPatchesReconstructSource(source, result);
  });

  it("ignores non-transform flags while applying scope transform prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw,scale=2,shift={(1pt,2pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toMatch(/shift=\{\(3pt,5pt\)\}|shift=\(3pt,5pt\)/);
    expectPatchesReconstructSource(source, result);
  });

  it("falls back to absolute scope shifts when a transform prefix is not numeric", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[rotate=\angle, xshift=2pt, yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("rotate=\\angle");
    expect(result.newSource).toContain("xshift=6pt");
    expect(result.newSource).toContain("yshift=-3pt");
    expectPatchesReconstructSource(source, result);
  });

  it("falls back to absolute scope shifts for nonnumeric scale prefixes", () => {
    const scaleSource = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=\s, shift={(2pt,3pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const scale = applyEditAction(scaleSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(scale.kind).toBe("success");
    if (scale.kind !== "success") return;
    expect(scale.newSource).toContain("scale=\\s");
    expect(scale.newSource).not.toContain("shift={");
    expect(scale.newSource).toContain("xshift=2pt");
    expect(scale.newSource).toContain("yshift=-3pt");
    expectPatchesReconstructSource(scaleSource, scale);

    const xscaleSource = String.raw`\begin{tikzpicture}
  \begin{scope}[xscale=\sx, shift={(2pt,3pt)}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const xscale = applyEditAction(xscaleSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(xscale.kind).toBe("success");
    if (xscale.kind !== "success") return;
    expect(xscale.newSource).toContain("xscale=\\sx");
    expect(xscale.newSource).not.toContain("shift={");
    expect(xscale.newSource).toContain("xshift=2pt");
    expect(xscale.newSource).toContain("yshift=-3pt");
    expectPatchesReconstructSource(xscaleSource, xscale);

    const yscaleSource = String.raw`\begin{tikzpicture}
  \begin{scope}[yscale=\sy, xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const yscale = applyEditAction(yscaleSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(yscale.kind).toBe("success");
    if (yscale.kind !== "success") return;
    expect(yscale.newSource).toContain("yscale=\\sy");
    expect(yscale.newSource).toContain("xshift=6pt");
    expect(yscale.newSource).toContain("yshift=6pt");
    expectPatchesReconstructSource(yscaleSource, yscale);
  });

  it("removes scope shift components when a move cancels them out", () => {
    const xOnly = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const movedXOnly = applyEditAction(xOnly, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(-2, 0)
    });

    expect(movedXOnly.kind).toBe("success");
    if (movedXOnly.kind !== "success") return;
    expect(movedXOnly.newSource).not.toContain("xshift");
    expect(movedXOnly.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(xOnly, movedXOnly);

    const yOnly = String.raw`\begin{tikzpicture}
  \begin{scope}[yshift=3pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const movedYOnly = applyEditAction(yOnly, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, -3)
    });

    expect(movedYOnly.kind).toBe("success");
    if (movedYOnly.kind !== "success") return;
    expect(movedYOnly.newSource).not.toContain("xshift");
    expect(movedYOnly.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(yOnly, movedYOnly);

    const explicitZero = String.raw`\begin{tikzpicture}[
  box/.style={draw,rounded corners=2pt,fill=blue!10,minimum width=2.4cm,minimum height=9mm,align=center},
  >=Stealth
]
  \begin{scope}[yshift=0pt]
    \node[box] (start) at (0,0) {Start};
    \node[box] (step)  at (0,-1.6) {Process};
    \node[box] (check) at (0,-3.2) {Check};
    \draw[->] (start) -- (step);
    \draw[->] (step)  -- (check);
  \end{scope}
  \node[box,fill=green!15] (done) at (4,-3.2) {Done};
  \draw[->] (check) -- node[above] {ok} (done);
\end{tikzpicture}`;
    const movedExplicitZero = applyEditAction(explicitZero, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 0)
    });

    expect(movedExplicitZero.kind).toBe("success");
    if (movedExplicitZero.kind !== "success") return;
    expect(movedExplicitZero.newSource).toContain("xshift=4pt");
    expect(movedExplicitZero.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(explicitZero, movedExplicitZero);

    const tinyMoveExplicitZero = applyEditAction(explicitZero, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0.4, 0.4)
    });

    expect(tinyMoveExplicitZero.kind).toBe("success");
    if (tinyMoveExplicitZero.kind !== "success") return;
    expect(tinyMoveExplicitZero.newSource).not.toContain("xshift=0pt");
    expect(tinyMoveExplicitZero.newSource).not.toContain("yshift=0pt");
    expect(tinyMoveExplicitZero.newSource).not.toContain("yshift");
    expectPatchesReconstructSource(explicitZero, tinyMoveExplicitZero);
  });

  it("rejects no-op scope moves for each scope placement rewrite path", () => {
    const withoutOptions = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const noOptions = applyEditAction(withoutOptions, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, 0)
    });
    expect(noOptions.kind).toBe("unsupported");
    if (noOptions.kind === "unsupported") {
      expect(noOptions.reason).toContain("already matches");
    }

    const xshiftSource = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const xshift = applyEditAction(xshiftSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, 0)
    });
    expect(xshift.kind).toBe("unsupported");
    if (xshift.kind === "unsupported") {
      expect(xshift.reason).toContain("already matches");
    }

    const shiftSource = String.raw`\begin{tikzpicture}
  \begin{scope}[shift=(2pt,3pt)]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const shift = applyEditAction(shiftSource, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(0, 0)
    });
    expect(shift.kind).toBe("unsupported");
    if (shift.kind === "unsupported") {
      expect(shift.reason).toContain("already matches");
    }
  });

  it("falls back to xshift and yshift when a scope shift prefix is not invertible", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=0, shift=(2pt,3pt)]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("scale=0");
    expect(result.newSource).not.toContain("shift=(");
    expect(result.newSource).toContain("xshift=2pt");
    expect(result.newSource).toContain("yshift=9pt");
    expectPatchesReconstructSource(source, result);
  });

  it("falls back to xshift and yshift when scope transform prefixes are not invertible", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[scale=0, xshift=2pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, 6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=6pt");
    expect(result.newSource).toContain("yshift=6pt");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes without options by inserting xshift and yshift", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}[xshift=4pt, yshift=-6pt]");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes with unrelated options by adding shift keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[draw]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(4, -6)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}[draw, xshift=4pt, yshift=-6pt]");
    expectPatchesReconstructSource(source, result);
  });

  it("moves scopes and regular elements together in moveElements", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1pt]
    \draw (0,0) -- (1,0);
  \end{scope}
  \draw (1,1) -- (2,2);
\end{tikzpicture}`;
    const raw = "(1,1)";
    const from = source.lastIndexOf(raw);
    const handle = makeHandle(source, {
      world: wp(cm(1), cm(1)),
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:2"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveElements",
      elementIds: ["scope:0", "path:2"],
      delta: wp(3, 2)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=4pt");
    expect(result.newSource).toContain("(1.11,1.07)");
    expectPatchesReconstructSource(source, result);
  });

  it("returns partial when a scope moves but another selected element cannot", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1pt]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: ["missing-path", "scope:0"],
      delta: wp(3, 2)
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.newSource).toContain("xshift=4pt");
    expect(result.reason).toContain("No handles found");
    expect(result.changedSourceIds).toEqual(["missing-path", "scope:0", "path:1"]);
    expectPatchesReconstructSource(source, result);
  });

  it("expands changed ids for nested moved scopes without duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1pt]
    \draw (0,0) -- (1,0);
    \begin{scope}
      \draw (2,0) -- (3,0);
    \end{scope}
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: ["scope:0", "scope:0"],
      delta: wp(2, 0)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=3pt");
    expect(result.changedSourceIds).toEqual(["scope:0", "path:1", "scope:2", "path:3"]);
    expectPatchesReconstructSource(source, result);
  });

  it("returns unsupported when matrix placement is already at the requested position", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(0, 0)
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("already matches");
    }
  });

  it("rewrites tree root at options and rejects no-op tree root moves", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[draw,at={(0,0)}] {Root}
    child { node {Leaf} };
\end{tikzpicture}`;

    const moved = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });
    expect(moved.kind).toBe("success");
    if (moved.kind !== "success") return;
    expect(moved.newSource).toContain("at=(1,2)");
    expectPatchesReconstructSource(source, moved);

    const noOp = applyEditAction(moved.newSource, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(0, 0)
    });
    expect(noOp.kind).toBe("unsupported");
    if (noOp.kind === "unsupported") {
      expect(noOp.reason).toContain("already matches");
    }
  });

  it("rejects child-operation paths that have no tree root node", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) child { node {Leaf} };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(1))
    });

    expect(result).toEqual({
      kind: "unsupported",
      reason: "Tree root path:0 has no root node to move"
    });
  });

  it("prefers rewriting inline at when both inline and option placement are present", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,at={(10,10)}] at (0,0) {
    A \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at={(10,10)}");
    expect(result.newSource).toContain("] at (1,2)");
  });

  it("returns partial when only the matrix portion of a mixed moveElements selection can move", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveElements",
      elementIds: ["missing-path", "path:0"],
      delta: wp(cm(1), cm(1))
    });

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.newSource).toContain("at (1,1)");
    expect(result.reason).toContain("No handles found");
    expect(result.changedSourceIds).toEqual(["missing-path", "path:0"]);
    expectPatchesReconstructSource(source, result);
  });
});

describe("applyEditAction – moveElement with positioning", () => {
  it("rewrites right=1cm of A to compound direction when dragged diagonally", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node[right=1cm of A] (B) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const handles = evaluated.editHandles;

    // Find the positioning handle for node B
    const posHandle = handles.find((h) => h.rewriteMode === "positioning");
    expect(posHandle).toBeDefined();
    if (!posHandle) return;

    // The positioning handle's sourceId is the statement ID for node B
    const elementId = posHandle.sourceRef.sourceId;

    // Move node B up and further right
    const result = applyEditAction(source, handles, {
      kind: "moveElement",
      elementId,
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    // Should have rewritten the positioning option
    expect(result.newSource).toContain("above right=");
    expect(result.newSource).toContain("of A");
    // Should NOT contain the original "right=1cm of A"
    expect(result.newSource).not.toContain("right=1cm of A");
  });

  it("rewrites below right positioning to above right when dragged upward across the target center", () => {
    const source = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
\node (A) at (0,0) {A};
\node[below right={1cm and 1cm} of A] (B) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const handles = evaluated.editHandles;
    const posHandle = handles.find((handle) => handle.rewriteMode === "positioning");

    expect(posHandle).toBeDefined();
    if (!posHandle) return;

    const result = applyEditAction(source, handles, {
      kind: "moveElement",
      elementId: posHandle.sourceRef.sourceId,
      delta: wp(0, cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("above right={-0.23cm and 1cm} of A");
  });
});

describe("applyEditAction – node relative positioning conversions", () => {
  function pathStatementIds(source: string): string[] {
    const parsed = parseTikz(source, { recover: true });
    return parsed.figure.body
      .filter((statement) => statement.kind === "Path")
      .map((statement) => statement.id);
  }

  function nodeCenter(source: string, sourceId: string, evaluateOptions?: Parameters<typeof evaluateTikzFigure>[2]): WorldPoint {
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source, evaluateOptions);
    const handle = evaluated.editHandles.find(
      (candidate) => candidate.sourceRef.sourceId === sourceId && candidate.kind === "node-position"
    );
    expect(handle).toBeDefined();
    return handle!.world;
  }

  function expectPointClose(actual: WorldPoint, expected: WorldPoint): void {
    expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.15);
    expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.15);
  }

  function expectAbsoluteRelativeAbsoluteRoundTrip(
    source: string,
    options: {
      targetNodeName?: string;
      evaluateOptions?: Parameters<typeof evaluateTikzFigure>[2];
    } = {}
  ): void {
    const [targetId, nodeId] = pathStatementIds(source);
    const targetNodeName = options.targetNodeName ?? "A";
    const before = nodeCenter(source, nodeId, options.evaluateOptions);

    const relative = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId,
      targetNodeName,
      targetNodeSourceId: targetId
    }, {
      evaluateOptions: options.evaluateOptions
    });

    expect(relative.kind).toBe("success");
    if (relative.kind !== "success") return;
    expect(relative.newSource).toContain(`of ${targetNodeName}`);
    expectPatchesReconstructSource(source, relative);

    const [, relativeNodeId] = pathStatementIds(relative.newSource);
    const absolute = applyEditAction(relative.newSource, [], {
      kind: "convertNodePositionToAbsolute",
      nodeId: relativeNodeId
    }, {
      evaluateOptions: options.evaluateOptions
    });

    expect(absolute.kind).toBe("success");
    if (absolute.kind !== "success") return;
    expect(absolute.newSource).toContain(" at (");
    expect(absolute.newSource).not.toContain(`of ${targetNodeName}`);
    expectPointClose(nodeCenter(absolute.newSource, pathStatementIds(absolute.newSource)[1], options.evaluateOptions), before);
    expectPatchesReconstructSource(relative.newSource, absolute);
  }

  it("converts an absolute node to modern right-of positioning", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,0) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);
    const before = nodeCenter(source, nodeId);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId,
      targetNodeName: "A",
      targetNodeSourceId: targetId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("right=");
    expect(result.newSource).toContain("of A");
    expect(result.newSource).not.toContain("at (2,0)");
    expectPointClose(nodeCenter(result.newSource, nodeId), before);
    expectPatchesReconstructSource(source, result);
  });

  it("previews relative positioning links with the chosen anchors", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,0) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);
    const targetCenter = nodeCenter(source, targetId);
    const currentCenter = nodeCenter(source, nodeId);

    const preflight = preflightPositionNodeRelativeToAction(source, {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId,
      targetNodeName: "A",
      targetNodeSourceId: targetId
    });

    expect(preflight.result.kind).toBe("success");
    expect(preflight.preview).toBeDefined();
    if (!preflight.preview) return;
    expect(preflight.preview.direction).toBe("right");
    expect(preflight.preview.targetAnchor.x).toBeGreaterThan(targetCenter.x);
    expect(preflight.preview.currentAnchor.x).toBeLessThan(currentCenter.x);
    expect(preflight.preview.targetAnchor.y).toBeCloseTo(targetCenter.y);
    expect(preflight.preview.currentAnchor.y).toBeCloseTo(currentCenter.y);
  });

  it("preserves shaped node placement when converting to relative positioning", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw,circle,minimum size=1cm] (A) at (0,0) {A};
\node[draw,diamond,minimum size=1cm] (B) at (2,0) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);
    const before = nodeCenter(source, nodeId);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId,
      targetNodeName: "A",
      targetNodeSourceId: targetId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("right=");
    expect(result.newSource).toContain("of A");
    expectPointClose(nodeCenter(result.newSource, nodeId), before);
  });

  it("serializes diagonal relative positioning with vertical and horizontal distances", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node (B) at (2,2) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId,
      targetNodeName: "A",
      targetNodeSourceId: targetId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("above right={");
    expect(result.newSource).toContain("} of A");
  });

  it("converts a relatively positioned node back to absolute positioning", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node[right=1cm of A] (B) {B};
\end{tikzpicture}`;
    const [, nodeId] = pathStatementIds(source);
    const before = nodeCenter(source, nodeId);

    const result = applyEditAction(source, [], {
      kind: "convertNodePositionToAbsolute",
      nodeId: nodeId
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(" at (");
    expect(result.newSource).not.toContain("right=1cm of A");
    expectPointClose(nodeCenter(result.newSource, nodeId), before);
    expectPatchesReconstructSource(source, result);
  });

  it("round trips cardinal absolute positioning through relative positioning", () => {
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,0) {B};
\end{tikzpicture}`);
  });

  it("round trips diagonal absolute positioning through relative positioning", () => {
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (2,2) {B};
\end{tikzpicture}`);
  });

  it("round trips shaped absolute positioning through relative positioning", () => {
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
\node[draw,circle,minimum size=1cm] (A) at (0,0) {A};
\node[draw,diamond,minimum size=1cm] (B) at (2.6,1.8) {B};
\end{tikzpicture}`);
  });

  it("round trips text nodes with different inner sep through diagonal relative positioning", async () => {
    const textEngine = await createMathJaxNodeTextEngine();
    expectAbsoluteRelativeAbsoluteRoundTrip(String.raw`\begin{tikzpicture}
  \node[draw, inner sep=4pt] (a) at (-0.2,2.66) {node a};
  \node[draw, inner sep=1pt] (b) at (1.35,1.8) {node b};
\end{tikzpicture}`, {
      targetNodeName: "a",
      evaluateOptions: { textEngine }
    });
  });

  it("rejects relative positioning that would need a negative distance", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {A};
\node[draw] (B) at (0,0) {B};
\end{tikzpicture}`;
    const [targetId, nodeId] = pathStatementIds(source);

    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId,
      targetNodeName: "A",
      targetNodeSourceId: targetId
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("negative positioning distance");
  });

  it("rejects path-attached target nodes", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0) node[midway] (A) {A};
\node (B) at (2,0) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const targetSourceId = evaluated.nodeAnchorTargets.find(
      (target) => target.nodeName === "A" && target.anchor === "center"
    )?.nodeSourceId;
    const [, nodeId] = pathStatementIds(source);

    expect(targetSourceId).toBeDefined();
    const result = applyEditAction(source, [], {
      kind: "positionNodeRelativeTo",
      nodeId: nodeId,
      targetNodeName: "A",
      targetNodeSourceId: targetSourceId!
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toContain("Path-attached target nodes");
  });
});
