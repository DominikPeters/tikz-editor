import { describe, expect, it } from "vitest";
import type { EditHandle, Point } from "../packages/core/src/semantic/types.js";
import type { NodeTextEngine } from "../packages/core/src/text/types.js";
import { identityMatrix } from "../packages/core/src/semantic/transform.js";
import { applyEditAction, PATH_ATTACHED_NODE_EDIT_NOOP_REASON } from "../packages/core/src/edit/actions.js";
import { resolveDraggedPathAttachedNodeDirection } from "../packages/core/src/edit/actions/path-attached-node-actions.js";
import { PT_PER_CM } from "../packages/core/src/edit/format.js";
import { TIKZPICTURE_GLOBAL_TARGET_ID } from "../packages/core/src/edit/property-target.js";
import { computeSourceFingerprint } from "../packages/core/src/utils/source-fingerprint.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/geometry.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";

const cm = (v: number) => v * PT_PER_CM;

function mergeTestBounds(
  left: { minX: number; minY: number; maxX: number; maxY: number },
  right: { minX: number; minY: number; maxX: number; maxY: number }
) {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY)
  };
}

function scopeBodyBounds(source: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const parsed = parseTikz(source, { recover: true });
  const evaluated = evaluateTikzFigure(parsed.figure, source);
  const boundsBySource = collectSourceWorldBounds(evaluated.scene.elements);
  const scope = parsed.figure.body.find((statement) => statement.kind === "Scope");
  if (!scope || scope.kind !== "Scope") {
    return null;
  }

  let merged: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (const child of scope.body) {
    const bounds = boundsBySource.get(child.id);
    if (!bounds) {
      continue;
    }
    merged = merged ? mergeTestBounds(merged, bounds) : bounds;
  }
  return merged;
}

function makeHandle(
  source: string,
  overrides: Partial<EditHandle> & {
    world: Point;
    sourceSpan: { from: number; to: number };
    sourceId?: string;
  }
): EditHandle {
  const { world, sourceSpan, sourceId, ...rest } = overrides;
  const span = sourceSpan;
  return {
    id: `handle-${span.from}-${span.to}`,
    runtimeId: `runtime:handle-${span.from}-${span.to}`,
    sourceRef: {
      sourceId: sourceId ?? "elem-1",
      sourceSpan: span,
      sourceFingerprint: computeSourceFingerprint(source)
    },
    kind: "path-point",
    world: world,
    transform: identityMatrix(),
    sourceText: source.slice(span.from, span.to),
    coordinateForm: overrides.coordinateForm ?? "cartesian",
    rewriteMode: overrides.rewriteMode ?? "direct",
    ...rest
  };
}

function expectPatchesReconstructSource(
  previousSource: string,
  result: Extract<ReturnType<typeof applyEditAction>, { kind: "success" | "partial" }>
): void {
  const replayed = applySourcePatches(previousSource, result.patches);
  expect(replayed.kind).toBe("success");
  if (replayed.kind !== "success") return;
  expect(replayed.source).toBe(result.newSource);
}

// ── moveHandle ─────────────────────────────────────────────────────────────────

describe("applyEditAction – moveHandle", () => {
  it("moves a cartesian handle to a new world position", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 11 }
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: { x: cm(5), y: cm(6) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (5,6) -- (3,4);");
      expect(result.patches).toHaveLength(1);
      expectPatchesReconstructSource(source, result);
    }
  });

  it("returns unsupported for unknown handle id", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const result = applyEditAction(source, [], {
      kind: "moveHandle",
      handleId: "nonexistent",
      newWorld: { x: cm(5), y: cm(6) }
    });
    expect(result.kind).toBe("error");
  });

  it("returns unsupported for unsupported coordinate form", () => {
    const source = "\\draw ($0.5*(A)+0.5*(B)$) -- (1,1);";
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 25 },
      coordinateForm: "calc",
      rewriteMode: "unsupported"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: { x: cm(3), y: cm(4) }
    });
    expect(result.kind).toBe("unsupported");
  });
});

describe("applyEditAction – connectHandle", () => {
  it("rewrites path endpoints to named node anchors", () => {
    const source = "\\draw (0,0) -- (1,1);";
    const raw = "(1,1)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(1) },
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "east"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toBe("\\draw (0,0) -- (A.east);");
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("rewrites center anchors to bare node references", () => {
    const source = "\\draw (0,0) -- (1,1);";
    const raw = "(1,1)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(1) },
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "center"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toBe("\\draw (0,0) -- (A);");
  });

  it("rejects handles whose source span is shared by expansion", () => {
    const source = "\\draw (0,0) -- (1,1);";
    const raw = "(1,1)";
    const from = source.indexOf(raw);
    const first = makeHandle(source, {
      id: "h-first",
      world: { x: cm(1), y: cm(1) },
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });
    const second = makeHandle(source, {
      id: "h-second",
      world: { x: cm(1), y: cm(1) },
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:1"
    });

    const result = applyEditAction(source, [first, second], {
      kind: "connectHandle",
      handleId: first.id,
      nodeName: "A",
      anchor: "east"
    });

    expect(result.kind).toBe("unsupported");
  });

  it("rejects stale handles when fingerprint mismatches source", () => {
    const sourceA = "\\draw (0,0) -- (1,1);";
    const sourceB = "\\draw (9,9) -- (8,8);";
    const raw = "(1,1)";
    const from = sourceA.indexOf(raw);
    const handle = makeHandle(sourceA, {
      world: { x: cm(1), y: cm(1) },
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(sourceB, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "east"
    });

    expect(result.kind).toBe("error");
  });

  it("moves the connected path statement after a later named node definition", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-2.5, 2.5) -- (2.5, 2.5);
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;
    const startRaw = "(-2.5, 2.5)";
    const startFrom = source.indexOf(startRaw);
    const handle = makeHandle(source, {
      world: { x: cm(-2.5), y: cm(2.5) },
      sourceSpan: { from: startFrom, to: startFrom + startRaw.length },
      sourceId: "path:0"
    });

    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "A",
      anchor: "center"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    const drawIndex = result.newSource.indexOf("\\draw (A) -- (2.5, 2.5);");
    const nodeIndex = result.newSource.indexOf("\\node[draw] (A) at (-1, -1) {A};");
    expect(drawIndex).toBeGreaterThan(nodeIndex);
    expect(result.changedSourceIds).toEqual([]);
    expectPatchesReconstructSource(source, result);
  });
});

describe("applyEditAction – patch replay invariants", () => {
  it("replays moveHandle patches to the reported newSource", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 11 }
    });
    const result = applyEditAction(source, [handle], {
      kind: "moveHandle",
      handleId: handle.id,
      newWorld: { x: cm(7), y: cm(8) }
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expectPatchesReconstructSource(source, result);
  });

  it("replays connectHandle patches when replacement and statement reorder both occur", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[red] (-1, 1) -- (1, 1);
  \node[draw] (C) at (0, 0) {C};
\end{tikzpicture}`;
    const raw = "(1, 1)";
    const from = source.indexOf(raw);
    const handle = makeHandle(source, {
      world: { x: cm(1), y: cm(1) },
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:0"
    });
    const result = applyEditAction(source, [handle], {
      kind: "connectHandle",
      handleId: handle.id,
      nodeName: "C",
      anchor: "north west"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[red] (-1, 1) -- (C.north west);");
    expectPatchesReconstructSource(source, result);
  });

  it("replays non-handle reorder patches to the reported newSource", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "reorderElements",
      elementIds: ["path:0"],
      direction: "bringToFront"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expectPatchesReconstructSource(source, result);
  });
});

// ── moveElement ────────────────────────────────────────────────────────────────

describe("applyEditAction – moveElement", () => {
  it("moves all handles of an element by a delta", () => {
    const source = "\\draw (1,2) -- (3,4);";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 6, to: 11 },
      sourceId: "elem-1"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 15, to: 20 },
      id: "handle-15-20",
      sourceId: "elem-1"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: { x: cm(1), y: cm(1) }
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toBe("\\draw (2,3) -- (4,5);");
    }
  });

  it("moves handles for multiple element ids in one action", () => {
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 14, to: 19 },
      sourceId: "path:0"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "path:1"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElements",
      elementIds: ["path:0", "path:1"],
      delta: { x: cm(1), y: cm(0) }
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
      delta: { x: cm(1), y: cm(1) }
    });
    expect(result.kind).toBe("unsupported");
  });

  it("returns partial when some handles are unsupported", () => {
    const source = "\\draw (0,0) .. controls (A) .. (1,2);";
    const unsupportedRaw = "(A)";
    const unsupportedFrom = source.indexOf(unsupportedRaw);
    const unsupported = makeHandle(source, {
      world: { x: cm(0), y: cm(0) },
      sourceSpan: { from: unsupportedFrom, to: unsupportedFrom + unsupportedRaw.length },
      sourceId: "elem-1",
      kind: "path-control",
      coordinateForm: "named",
      rewriteMode: "unsupported"
    });
    const supportedRaw = "(1,2)";
    const supportedFrom = source.lastIndexOf(supportedRaw);
    const supported = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: supportedFrom, to: supportedFrom + supportedRaw.length },
      sourceId: "elem-1"
    });

    const result = applyEditAction(source, [unsupported, supported], {
      kind: "moveElement",
      elementId: "elem-1",
      delta: { x: cm(1), y: cm(0) }
    });

    expect(result.kind).toBe("partial");
    if (result.kind === "partial") {
      expect(result.skippedHandles).toHaveLength(1);
      expect(result.newSource).toBe("\\draw (0,0) .. controls (A) .. (2,2);");
    }
  });

  it("applies patches in correct order (handles at different offsets)", () => {
    // Both handles in same source; higher-offset patch applied first
    const source = "\\node (A) at (1,2) {}; \\node (B) at (3,4) {};";
    const h1 = makeHandle(source, {
      world: { x: cm(1), y: cm(2) },
      sourceSpan: { from: 14, to: 19 },
      sourceId: "multi"
    });
    const h2 = makeHandle(source, {
      world: { x: cm(3), y: cm(4) },
      sourceSpan: { from: 34, to: 39 },
      id: "handle-34-39",
      sourceId: "multi"
    } as Parameters<typeof makeHandle>[1]);

    const result = applyEditAction(source, [h1, h2], {
      kind: "moveElement",
      elementId: "multi",
      delta: { x: cm(10), y: cm(10) }
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
      delta: { x: cm(1), y: cm(2) }
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
      delta: { x: cm(2), y: cm(3) }
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
      delta: { x: cm(0.29), y: cm(0.12) }
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
      delta: { x: cm(0.29), y: cm(0.12) }
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
      delta: { x: cm(0.1), y: cm(0) }
    });
    expect(first.kind).toBe("success");
    if (first.kind !== "success") return;
    expect(first.newSource).toMatch(/at\s*\(0\.1,0\)\s*\{Root\}/);

    const second = applyEditAction(first.newSource, [], {
      kind: "moveElement",
      elementId: "path:0",
      delta: { x: cm(0.1), y: cm(0) }
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
      delta: { x: cm(1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\matrix[matrix of nodes] at (1,2) {");
    expect(result.newSource).not.toContain("at={");
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
      delta: { x: cm(1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\matrix[matrix of nodes] at (1,2) {");
    expect(result.newSource).not.toContain("at=(");
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
      delta: { x: cm(-0.21), y: cm(0.17) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("ampersand replacement=\\&");
    expect(result.newSource).toContain("] (m) at (-0.21,0.17) {");
    expect(result.newSource).not.toContain("at=");
    expect(result.newSource).not.toContain(",,");
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
      delta: { x: 5, y: -2 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=7pt");
    expect(result.newSource).toContain("yshift=1pt");
    expectPatchesReconstructSource(source, result);
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
      delta: { x: 4, y: 6 }
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
      delta: { x: 4, y: 6 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=4pt");
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
      delta: { x: 4, y: -6 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\begin{scope}[xshift=4pt, yshift=-6pt]");
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
      world: { x: cm(1), y: cm(1) },
      sourceSpan: { from, to: from + raw.length },
      sourceId: "path:2"
    });

    const result = applyEditAction(source, [handle], {
      kind: "moveElements",
      elementIds: ["scope:0", "path:2"],
      delta: { x: 3, y: 2 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xshift=4pt");
    expect(result.newSource).toContain("(1.11,1.07)");
    expectPatchesReconstructSource(source, result);
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
      delta: { x: cm(1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("at={(10,10)}");
    expect(result.newSource).toContain("] at (1,2)");
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
      delta: { x: cm(1), y: cm(2) }
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
      delta: { x: 0, y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("above right={-0.23cm and 1cm} of A");
  });
});

describe("applyEditAction – node adornments", () => {
  it("duplicates a single label option without duplicating the whole node", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "duplicateAdornment",
      targetId: "node-adornment:node:0:2:label:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("label=right:L, label=right:L");
  });

  it("deletes only the selected pin option", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:P,label=right:L] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "deleteAdornment",
      targetId: "node-adornment:node:0:2:pin:0"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("pin=above:P");
    expect(result.newSource).toContain("label=right:L");
  });

  it("preserves pin edge options when editing pin text", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt}]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_text__",
      value: "Q"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("pin edge={draw=blue,dashed,line width=1pt}");
    expect(result.newSource).toContain("above:Q");
  });

  it("preserves pin edge options when editing pin draw color", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin={[pin edge={draw=blue,dashed,line width=1pt},fill=yellow]above:P}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("pin edge={draw=blue,dashed,line width=1pt}");
    expect(result.newSource).toContain("fill=yellow");
    expect(result.newSource).toContain("draw=red");
  });
});

describe("applyEditAction – alignElements", () => {
  const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,2) -- (3,2);
\end{tikzpicture}`;

  it("aligns left/center/right using selection bounds", () => {
    const left = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(left.kind).toBe("success");
    if (left.kind === "success") {
      expect(left.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const center = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "center"
    });
    expect(center.kind).toBe("success");
    if (center.kind === "success") {
      expect(center.newSource).toContain("\\draw (1,0) -- (2,0);");
      expect(center.newSource).toContain("\\draw (1,2) -- (2,2);");
    }

    const right = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "right"
    });
    expect(right.kind).toBe("success");
    if (right.kind === "success") {
      expect(right.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("aligns top/middle/bottom in world y-up coordinates", () => {
    const top = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "top"
    });
    expect(top.kind).toBe("success");
    if (top.kind === "success") {
      expect(top.newSource).toContain("\\draw (0,2) -- (1,2);");
    }

    const middle = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "middle"
    });
    expect(middle.kind).toBe("success");
    if (middle.kind === "success") {
      expect(middle.newSource).toContain("\\draw (0,1) -- (1,1);");
      expect(middle.newSource).toContain("\\draw (2,1) -- (3,1);");
    }

    const bottom = applyEditAction(source, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "bottom"
    });
    expect(bottom.kind).toBe("success");
    if (bottom.kind === "success") {
      expect(bottom.newSource).toContain("\\draw (2,0) -- (3,0);");
    }
  });

  it("returns unsupported for no-op aligns", () => {
    const aligned = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,2) -- (1,2);
\end{tikzpicture}`;
    const result = applyEditAction(aligned, [], {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
\end{tikzpicture}`;

    const result = applyEditAction(mixed, [], {
      kind: "alignElements",
      elementIds: ["path:2", "path:3"],
      mode: "left"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});

describe("applyEditAction – distributeElements", () => {
  it("distributes horizontal gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (2,0) -- (3,0);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "horizontal"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
      expect(result.newSource).toContain("\\draw (5,0) -- (6,0);");
      expect(result.newSource).toContain("\\draw (10,0) -- (11,0);");
    }
  });

  it("distributes vertical gaps with endpoints fixed", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,10) -- (1,10);
  \draw (0,6) -- (1,6);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,10) -- (1,10);");
      expect(result.newSource).toContain("\\draw (0,5) -- (1,5);");
      expect(result.newSource).toContain("\\draw (0,0) -- (1,0);");
    }
  });

  it("returns unsupported for no-op distributions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,4) -- (1,4);
  \draw (0,2) -- (1,2);
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "vertical"
    });
    expect(result.kind).toBe("unsupported");
  });

  it("fails atomically when any selected element is non-rewritable", () => {
    const mixed = String.raw`\begin{tikzpicture}
  \coordinate (A) at (2,0);
  \coordinate (B) at (3,0);
  \draw (0,0) -- (1,0);
  \draw (A) -- (B);
  \draw (10,0) -- (11,0);
\end{tikzpicture}`;
    const result = applyEditAction(mixed, [], {
      kind: "distributeElements",
      elementIds: ["path:2", "path:3", "path:4"],
      axis: "horizontal"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("unsupported coordinate forms");
    }
  });
});

// ── setProperty ───────────────────────────────────────────────────────────────

describe("applyEditAction – setProperty", () => {
  const lineWidthPresetKeys = [
    "ultra thin",
    "very thin",
    "thin",
    "semithick",
    "thick",
    "very thick",
    "ultra thick"
  ];

  function resolveFirstGridKeywordId(source: string): string {
    const parsed = parseTikz(source);
    for (const statement of parsed.figure.body) {
      if (statement.kind !== "Path") {
        continue;
      }
      const keyword = statement.items.find((item) => item.kind === "PathKeyword" && item.keyword === "grid");
      if (keyword && keyword.kind === "PathKeyword") {
        return keyword.id;
      }
    }
    throw new Error("Expected at least one grid path keyword");
  }

  it("updates an existing command option key", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.4pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.2pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.2pt] (0,0) -- (1,0);");
      expect(result.patches).toHaveLength(1);
    }
  });

  it("supports writing named line width flags while clearing numeric line width", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, line width=0.2pt] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "very thin",
      value: "true",
      clearKeys: ["line width", ...lineWidthPresetKeys.filter((key) => key !== "very thin")]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, very thin] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("line width=");
    }
  });

  it("supports writing numeric line width while clearing preset flags", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, very thin] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "line width",
      value: "1.3pt",
      clearKeys: lineWidthPresetKeys
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[blue, line width=1.3pt] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("very thin");
    }
  });

  it("inserts a new command option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red] (0,0) -- (1,0);");
    }
  });

  it("serializes fill color as a bare option when setting color on a \\fill path", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\fill[yellow] (0,0) rectangle (1,1);");
    }
  });

  it("replaces existing bare draw color flags instead of appending duplicates", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[red, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("blue");
    }
  });

  it("serializes updated draw key values as bare colors on \\draw paths", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[draw=blue, thick] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "green"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw[green, thick] (0,0) -- (1,0);");
      expect(result.newSource).not.toContain("draw=");
    }
  });

  it("inserts node options when targeting a node item id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) node {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected first statement to be a path");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected a node item");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) node[fill=yellow] {A};");
    }
  });

  it("appends transparent inside an existing named node option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (B) at (1.5, -0.5) {B};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    expect(statement?.kind).toBe("Path");
    if (!statement || statement.kind !== "Path") {
      throw new Error("Expected first statement to be a path");
    }
    const node = statement.items.find((item) => item.kind === "Node");
    expect(node?.kind).toBe("Node");
    if (!node || node.kind !== "Node") {
      throw new Error("Expected a node item");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "transparent",
      value: "true"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected node transparent rewrite to succeed");
    }
    expect(result.newSource).toContain("\\node[draw, transparent] (B) at (1.5, -0.5) {B};");
    expect(result.newSource).not.toContain("\\node[transparent][draw]");
  });

  it("inserts a matrix-cell option prefix when setting a property on a matrix-of-nodes cell", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell setProperty insertion to succeed");
    }
    expect(result.newSource).toContain("A & |[draw=red]| B");
  });

  it("updates existing matrix-cell option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "fill",
      value: "yellow"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell option rewrite to succeed");
    }
    expect(result.newSource).toContain("|[draw=red, fill=yellow]| B");
  });

  it("rejects matrix-cell property writes on plain matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: "red"
    });

    expect(result.kind).toBe("unsupported");
  });

  it("removes matrix-cell option prefix when clearing the only supported key", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell prefix removal to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("|[draw=red]|");
  });

  it("keeps remaining matrix-cell options when clearing one of several keys", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw=red,fill=yellow]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "draw",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell partial key removal to succeed");
    }
    expect(result.newSource).toContain("|[fill=yellow]| B");
    expect(result.newSource).not.toContain("draw=red");
  });

  it("supports broader matrix-cell property keys like line width", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "line width",
      value: "1pt"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell line width insertion to succeed");
    }
    expect(result.newSource).toContain("A & |[line width=1pt]| B");
  });

  it("clears broader matrix-cell keys and removes empty option prefixes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[line width=1pt]| B \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node:0:0:matrix-cell:1:2",
      level: "command",
      key: "line width",
      value: ""
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected matrix-cell line width clear to succeed");
    }
    expect(result.newSource).toContain("A & B \\\\");
    expect(result.newSource).not.toContain("|[line width=1pt]|");
  });

  it("updates matrix-level row/column spacing properties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=2mm,column sep=3mm] {
    A & B \\
  };
\end{tikzpicture}`;

    const rowSepResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "row sep",
      value: "5mm"
    });
    expect(rowSepResult.kind).toBe("success");
    if (rowSepResult.kind !== "success") {
      throw new Error("Expected matrix row sep update to succeed");
    }
    expect(rowSepResult.newSource).toContain("row sep=5mm");

    const columnSepResult = applyEditAction(rowSepResult.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "column sep",
      value: "7mm"
    });
    expect(columnSepResult.kind).toBe("success");
    if (columnSepResult.kind !== "success") {
      throw new Error("Expected matrix column sep update to succeed");
    }
    expect(columnSepResult.newSource).toContain("column sep=7mm");
  });

  it("updates matrix-level draw/fill properties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
  };
\end{tikzpicture}`;

    const drawResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "draw",
      value: "blue"
    });
    expect(drawResult.kind).toBe("success");
    if (drawResult.kind !== "success") {
      throw new Error("Expected matrix draw update to succeed");
    }
    expect(drawResult.newSource).toContain("draw=blue");

    const fillResult = applyEditAction(drawResult.newSource, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "fill",
      value: "yellow"
    });
    expect(fillResult.kind).toBe("success");
    if (fillResult.kind !== "success") {
      throw new Error("Expected matrix fill update to succeed");
    }
    expect(fillResult.newSource).toContain("fill=yellow");
  });

  it("keeps matrix-level inspector writes inside one option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[
    matrix of nodes,
    ampersand replacement=\&,
  ] (m) {
    A \& B \& C \\
    D \& E \& F \\
  };
\end{tikzpicture}`;

    const updates = [
      ["draw", "red"],
      ["column sep", "0.2pt"],
      ["row sep", "0.4pt"],
      ["row sep", "0.3pt"],
      ["row sep", "0.2pt"],
      ["column sep", "0.1pt"],
      ["row sep", "0.1pt"]
    ] as const;

    let current = source;
    for (const [key, value] of updates) {
      const result = applyEditAction(current, [], {
        kind: "setProperty",
        elementId: "path:0",
        level: "command",
        key,
        value
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        throw new Error(`Expected matrix property '${key}' to update`);
      }
      current = result.newSource;
    }

    expect(current).toContain("\\matrix[");
    expect(current).toContain("matrix of nodes");
    expect(current).toContain("ampersand replacement=\\&");
    expect(current).toContain("draw=red");
    expect(current).toContain("column sep=0.1pt");
    expect(current).toContain("row sep=0.1pt");
    expect(current).not.toContain("][");
    expect(current.match(/\[/g)?.length ?? 0).toBe(1);
  });

  it("adds matrix rows at start, middle, and end using 1-based insert-at indices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    const addStart = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 1
    });
    expect(addStart.kind).toBe("success");
    if (addStart.kind !== "success") {
      throw new Error("Expected addMatrixRow at start to succeed");
    }
    expect(addStart.changedSourceIds).toEqual(["path:0"]);

    const addMiddle = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(addMiddle.kind).toBe("success");

    const addEnd = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 3
    });
    expect(addEnd.kind).toBe("success");
  });

  it("removes matrix rows with index validation", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
    E & F \\
  };
\end{tikzpicture}`;

    const removeMiddle = applyEditAction(source, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(removeMiddle.kind).toBe("success");
    if (removeMiddle.kind !== "success") {
      throw new Error("Expected removeMatrixRow to succeed");
    }
    expect(removeMiddle.newSource).not.toContain("C & D");

    const invalid = applyEditAction(source, [], {
      kind: "removeMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 4
    });
    expect(invalid.kind).toBe("unsupported");
  });

  it("adds and removes matrix columns at arbitrary indices for ragged matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B & C \\
    D & E \\
    F \\
  };
\end{tikzpicture}`;

    const addColumn = applyEditAction(source, [], {
      kind: "addMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 2
    });
    expect(addColumn.kind).toBe("success");
    if (addColumn.kind !== "success") {
      throw new Error("Expected addMatrixColumn to succeed");
    }
    expect(addColumn.changedSourceIds).toEqual(["path:0"]);

    const removeColumn = applyEditAction(addColumn.newSource, [], {
      kind: "removeMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 3
    });
    expect(removeColumn.kind).toBe("success");
  });

  it("transposes rectangular matrices", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected transposeMatrix to succeed");
    }
    expect(result.newSource).toMatch(/A\s*&\s*C\s*\\\\/);
    expect(result.newSource).toMatch(/B\s*&\s*D/);
  });

  it("transposes ragged matrices by padding then trimming trailing empties", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & B & C \\
    D & E \\
    F \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "transposeMatrix",
      matrixSourceId: "path:0"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected ragged transpose to succeed");
    }
    expect(result.newSource).toMatch(/A\s*&\s*D\s*&\s*F\s*\\\\/);
    expect(result.newSource).toMatch(/B\s*&\s*E\s*\\\\/);
    expect(result.newSource).toMatch(/\n\s*C\s*}\s*;/);
  });

  it("keeps custom ampersand replacement parseable across structural edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,ampersand replacement=\&] {
    A \& B \\
    C \& D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addMatrixColumn",
      matrixSourceId: "path:0",
      columnIndex: 2
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addMatrixColumn with ampersand replacement to succeed");
    }
    const rendered = renderTikzToSvg(result.newSource);
    expect(rendered.semantic.featureUsage.matrix_node).toBe("used-supported");
  });

  it("normalizes away boundary gap overrides in structural matrix rewrites", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A &[2mm] B \\[3mm]
    C & D \\
  };
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addMatrixRow",
      matrixSourceId: "path:0",
      rowIndex: 2
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected addMatrixRow with gap overrides to succeed");
    }
    expect(result.newSource).not.toContain("&[");
    expect(result.newSource).not.toContain("\\\\[");
  });

  it("routes tree-child layout keys to child options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "level distance",
      value: "5mm"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child layout update to succeed");
    }
    expect(result.newSource).toContain("child[level distance=5mm]");
    expect(result.newSource).toContain("node[draw] {leaf}");
  });

  it("routes tree-child node style keys to child root node options", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "fill",
      value: "yellow"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected tree-child node style update to succeed");
    }
    expect(result.newSource).toContain("child[level distance=2mm]");
    expect(result.newSource).toContain("node[");
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("fill=yellow");
    expect(result.newSource).toContain("{leaf}");
  });

  it("supports broader tree-child node property writes (e.g. line width)", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=2mm] { node[draw] {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "line width",
      value: "1.5pt"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected broader tree-child node write to succeed");
    }
    expect(result.newSource).toContain("child[level distance=2mm]");
    expect(result.newSource).toContain("node[");
    expect(result.newSource).toContain("draw");
    expect(result.newSource).toContain("line width=1.5pt");
    expect(result.newSource).toContain("{leaf}");
  });

  it("inserts missing tree-child option lists at the correct level", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child { node {leaf} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leafText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "leaf"
    );
    if (!leafText || leafText.kind !== "Text" || !leafText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const layoutInsert = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "sibling distance",
      value: "4mm"
    });
    expect(layoutInsert.kind).toBe("success");
    if (layoutInsert.kind !== "success") {
      throw new Error("Expected tree-child layout insert to succeed");
    }
    expect(layoutInsert.newSource).toContain("child[sibling distance=4mm] { node {leaf} }");

    const nodeInsert = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: leafText.treeChild.childSourceId,
      level: "command",
      key: "draw",
      value: "red"
    });
    expect(nodeInsert.kind).toBe("success");
    if (nodeInsert.kind !== "success") {
      throw new Error("Expected tree-child node options insert to succeed");
    }
    expect(nodeInsert.newSource).toContain("child { node[draw=red]");
    expect(nodeInsert.newSource).toContain("{leaf}");
  });

  it("rejects tree-child setProperty writes for child foreach", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: syntheticChildId,
      level: "command",
      key: "draw",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toContain("child foreach");
    }
  });

  it("updates an existing grid keyword option list by keyword id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid[step=2mm] (2,2);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: resolveFirstGridKeywordId(source),
      level: "command",
      key: "step",
      value: "0.5cm",
      clearKeys: ["xstep", "x step", "ystep", "y step"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) grid[step=0.5cm] (2,2);");
    }
  });

  it("inserts a grid keyword option list when none exists", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) grid (2,2);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: resolveFirstGridKeywordId(source),
      level: "command",
      key: "xstep",
      value: "0.4cm",
      clearKeys: ["x step"]
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\draw (0,0) grid[xstep=0.4cm] (2,2);");
    }
  });

  it("updates an existing tikzpicture global option key", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=1.2, yscale=0.8]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
      level: "command",
      key: "xscale",
      value: "2"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\begin{tikzpicture}[xscale=2, yscale=0.8]");
    }
  });

  it("inserts a tikzpicture global option list when missing", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: TIKZPICTURE_GLOBAL_TARGET_ID,
      level: "command",
      key: "xscale",
      value: "1.5"
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.newSource).toContain("\\begin{tikzpicture}[xscale=1.5]");
    }
  });

  it("keeps a shadow preset as a flag when setProperty receives true", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[copy shadow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "drop shadow",
      value: "true",
      clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[drop shadow] (0,0) -- (1,0);");
    expect(result.newSource).not.toContain("copy shadow");
  });

  it("writes nested shadow options with braces", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[drop shadow] (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "path:0",
      level: "command",
      key: "drop shadow",
      value: "{shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25}",
      clearKeys: ["copy shadow", "circular drop shadow", "circular glow", "general shadow", "double copy shadow"]
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(
      "\\draw[drop shadow={shadow xshift=2pt,shadow yshift=-3pt,opacity=0.25}] (0,0) -- (1,0);"
    );
    expect(result.newSource).not.toContain("drop shadow=shadow xshift=2pt");
  });

  it("returns unsupported when the target id is missing", () => {
    const result = applyEditAction("\\draw (0,0);", [], {
      kind: "setProperty",
      elementId: "missing",
      level: "command",
      key: "color",
      value: "red"
    });
    expect(result.kind).toBe("unsupported");
  });
});

describe("applyEditAction – resizeElement", () => {
  it("writes minimum width and minimum height when growing from a corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 100, y: 100 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=");
  });

  it("drops non-binding minimum height when shrinking below intrinsic floor", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: 0, y: 0 }
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).not.toContain("minimum height=");
    expect(result.newSource).not.toContain("minimum width=100pt");
  });

  it("updates only the axis targeted by the resize role", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum height=40pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 90, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).toContain("minimum height=40pt");
  });

  it("resizes non-rectangular shaped nodes by rewriting shape constraints", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=diamond,minimum width=2.2cm,minimum height=1.4cm] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: { x: 100, y: 100 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("shape=diamond");
    expect(/minimum (width|height)=/.test(result.newSource)).toBe(true);
    expect(result.newSource).not.toContain("minimum width=2.2cm, minimum height=1.4cm");
  });

  it("can prefer a single constraint when resizing dependent shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,shape=isosceles triangle,minimum width=2.2cm,minimum height=1.4cm] at (0,0) {};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: { x: 120, y: 60 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("shape=isosceles triangle");
    expect(/minimum (width|height)=/.test(result.newSource)).toBe(true);
  });

  it("maps visual drag through inverse node transform when resizing transformed nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,xscale=0.1] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 30, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const match = /minimum width=([0-9.]+)pt/.exec(result.newSource);
    expect(match).not.toBeNull();
    const width = match ? Number(match[1]) : Number.NaN;
    expect(width).toBeGreaterThan(200);
  });

  it("drops non-binding minimum height for unstyled nodes when shrinking", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[minimum width=100pt,minimum height=80pt] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 0, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=");
    expect(result.newSource).not.toContain("minimum height=");
    expect(result.newSource).not.toContain("minimum width=100pt");
  });

  it("uses the provided text engine when computing intrinsic resize floors", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=120pt] at (0,0) {Long label text};
\end{tikzpicture}`;
    const fakeTextEngine: NodeTextEngine = {
      validate: () => null,
      measure: () => ({
        cacheKey: "fake-measure",
        width: 40,
        height: 10,
        baselineY: -2,
        midLineY: 0,
        paragraphId: "fake-paragraph",
        renderSourceText: "Long label text"
      }),
      renderFromCache: () => null
    };

    const result = applyEditAction(
      source,
      [],
      {
        kind: "resizeElement",
        elementId: "path:0",
        role: "right",
        newWorld: { x: 45, y: 0 }
      },
      { evaluateOptions: { textEngine: fakeTextEngine } }
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=90pt");
  });

  it("rewrites text width instead of minimum width for horizontal resize when text width is set", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 120, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const textWidthMatch = /text width=([0-9.]+)pt/.exec(result.newSource);
    expect(textWidthMatch).not.toBeNull();
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("keeps existing minimum width unchanged when horizontal resize targets text width", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm,minimum width=100pt] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 120, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("minimum width=100pt");
    const textWidthMatch = /text width=([0-9.]+)pt/.exec(result.newSource);
    expect(textWidthMatch).not.toBeNull();
  });

  it("updates text width horizontally and minimum height vertically for corner resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 120, y: 120 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=");
    expect(result.newSource).toContain("minimum height=");
    expect(result.newSource).not.toContain("minimum width=");
  });

  it("does not change text width for vertical-only resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {This is wrapped text};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top",
      newWorld: { x: 0, y: 120 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=2cm");
  });

  it("removes minimum height when vertical resize makes it non-binding", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum height=50pt] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom",
      newWorld: { x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY - 20 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("removes non-binding minimum height for multiline text-width corner resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, text width=105.09pt, align=left, minimum height=50pt] at (0,0) {This is the first line which can read quite internationally and this is the second line which is more pedestrian};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(semantic.scene.elements).get("path:0");
    expect(bounds).toBeDefined();
    if (!bounds) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: bounds.maxX - 20, y: bounds.maxY }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("text width=");
    expect(result.newSource).not.toContain("minimum height=");
  });

  it("resizes circle statements that use coordinate radius payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes filled circle statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle (2cm)");
  });

  it("resizes ellipse statements that use explicit x/y radius options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes filled ellipse statements that are emitted as path geometry", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("preserves ellipse aspect ratio when preserveAspect is enabled", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(1.2), y: cm(0.4) },
      preserveAspect: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=0.6cm");
  });

  it("uses the provided preserveAspectRatio instead of the current ratio", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) ellipse [x radius=1.2cm, y radius=0.4cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(0.5) },
      preserveAspect: true,
      preserveAspectRatio: 0.5
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2cm");
    expect(result.newSource).toContain("y radius=1cm");
  });

  it("resizes ellipse statements where y radius is larger than x radius", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-1.88,1.26) ellipse [x radius=0.38cm, y radius=0.88cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(-0.68), y: cm(2.76) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=1.2cm");
    expect(result.newSource).toContain("y radius=1.5cm");
  });

  it("resizes transform-rotated ellipse statements emitted as ellipse primitives", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated filled ellipse path statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45,fill=yellow] (0,0) ellipse [x radius=1cm, y radius=0.5cm];
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("x radius=2.26cm");
    expect(result.newSource).toContain("y radius=0.57cm");
  });

  it("resizes transform-rotated rectangle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0.71,0) rectangle (2,2.12);");
  });

  it("keeps rotated rectangle corner drags continuous across world-topness changes", () => {
    let currentSource = String.raw`\begin{tikzpicture}[rotate=40]
  \draw (-3.73,-1.69) rectangle (2.91,2.78);
\end{tikzpicture}`;

    const dragX = 3.316;
    const dragYValues = [0.58, 0.2, -0.1, -0.3, -0.5, -0.7];
    const rewrittenTargetYValues: number[] = [];

    for (const dragY of dragYValues) {
      const result = applyEditAction(currentSource, [], {
        kind: "resizeElement",
        elementId: "path:0",
        role: "top-right",
        newWorld: { x: cm(dragX), y: cm(dragY) }
      });

      expect(result.kind).toBe("success");
      if (result.kind !== "success") {
        return;
      }
      currentSource = result.newSource;

      const targetMatch = currentSource.match(/rectangle\s*\(\s*[-+0-9.]+\s*,\s*([-+0-9.]+)\s*\)/);
      expect(targetMatch).not.toBeNull();
      if (!targetMatch) {
        return;
      }
      rewrittenTargetYValues.push(Number(targetMatch[1]));
    }

    for (let index = 1; index < rewrittenTargetYValues.length; index += 1) {
      const prev = rewrittenTargetYValues[index - 1]!;
      const next = rewrittenTargetYValues[index]!;
      expect(Math.abs(next - prev)).toBeLessThan(2);
    }
  });

  it("keeps rotated node corner drags stable at existing corners", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,rotate=30] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const nodeBoxPath = semantic.scene.elements.find(
      (element): element is Extract<typeof semantic.scene.elements[number], { kind: "Path" }> =>
        element.sourceRef.sourceId === "path:0" && element.kind === "Path"
    );
    expect(nodeBoxPath).toBeDefined();
    if (!nodeBoxPath) {
      return;
    }

    const corner = nodeBoxPath.commands.find(
      (command): command is Extract<typeof nodeBoxPath.commands[number], { kind: "M" | "L" }> =>
        command.kind === "M" || command.kind === "L"
    )?.to;
    expect(corner).toBeDefined();
    if (!corner) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-right",
      newWorld: corner
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }
    expect(result.newSource).not.toContain("minimum width");
    expect(result.newSource).not.toContain("minimum height");
  });

  it("resizes nodes with label/pin adornments using only the node geometry", () => {
    const plainSource = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const adornedSource = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const plainResult = applyEditAction(plainSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 120, y: 120 }
    });
    const adornedResult = applyEditAction(adornedSource, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 120, y: 120 }
    });

    expect(plainResult.kind).toBe("success");
    expect(adornedResult.kind).toBe("success");
    if (plainResult.kind !== "success" || adornedResult.kind !== "success") {
      return;
    }

    const extractMinimum = (updatedSource: string, key: "minimum width" | "minimum height") =>
      updatedSource.match(new RegExp(`${key}=([0-9.]+)pt`))?.[1] ?? null;

    expect(extractMinimum(adornedResult.newSource, "minimum width")).toBe(
      extractMinimum(plainResult.newSource, "minimum width")
    );
    expect(extractMinimum(adornedResult.newSource, "minimum height")).toBe(
      extractMinimum(plainResult.newSource, "minimum height")
    );
    expect(adornedResult.newSource).toContain("label=right:L");
    expect(adornedResult.newSource).toContain("pin=above:P");
  });

  it("moves adorned nodes without rewriting label/pin option payloads", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label=right:L,pin=above:P] at (0,0) {A};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const semantic = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElements",
      elementIds: ["path:0"],
      delta: { x: 1, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }

    expect(result.newSource).toContain("label=right:L");
    expect(result.newSource).toContain("pin=above:P");
    expect(result.newSource).toContain(" at (0.04,0) ");
    expect(result.newSource).not.toContain("\\node[draw,(");
  });

  it("blocks moveElements direct manipulation for fit nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const fitPathId =
      parsed.figure.body
        .find(
          (statement) =>
            statement.kind === "Path"
            && statement.items.some(
              (item) =>
                item.kind === "Node"
                && item.options?.entries.some(
                  (entry) => (entry.kind === "flag" || entry.kind === "kv") && entry.key === "fit"
                )
            )
        )?.id ?? null;
    expect(fitPathId).not.toBeNull();
    if (!fitPathId) {
      return;
    }

    const semantic = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElements",
      elementIds: [fitPathId],
      delta: { x: 1, y: 0 }
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      return;
    }
    expect(result.reason).toContain("fit");
    expect(result.reason).toContain("disabled");
  });

  it("resizes transform-rotated circle statements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=45] (0,0) circle (1cm);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1.2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[rotate=45] (0,0) circle (2.26cm);");
  });

  it("inserts per-shape radius options when circle radius is inherited from statement options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[radius=1cm] (0,0) circle;
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: cm(1.5), y: cm(1.5) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("circle[radius=1.5cm]");
  });

  it("resizes rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle (2,2);");
  });

  it("resizes filled rectangle statements using opposite-corner anchoring", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=yellow] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw[fill=yellow] (-1,0) rectangle (2,2);");
  });

  it("updates rectangle relative target coordinates against the moved start corner", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle +(2,1);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("\\draw (-1,0) rectangle +(3,2);");
  });

  it("resizes scopes by rewriting scale and compensating shift", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) rectangle (2,1);
  \end{scope}
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-left",
      newWorld: { x: cm(-1), y: cm(2) }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("xscale=1.5");
    expect(result.newSource).toContain("yscale=2");
    const xshiftMatch = result.newSource.match(/xshift=([-0-9.]+)pt/);
    expect(xshiftMatch).not.toBeNull();
    expect(xshiftMatch ? Number(xshiftMatch[1]) : Number.NaN).toBeLessThan(-20);
    expect(result.newSource).not.toContain("yshift=");
    expect(result.changedSourceIds).toEqual(["scope:0", "path:1"]);
  });

  it("keeps the opposite scope edges fixed in semantic bounds during referenced top-right resize", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`;

    const before = scopeBodyBounds(source);
    expect(before).toBeDefined();
    if (!before) {
      return;
    }

    const parsed = parseTikz(source, { recover: true });
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const result = applyEditAction(source, evaluated.editHandles, {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-right",
      newWorld: { x: before.maxX + cm(2), y: before.maxY },
      referenceBounds: before,
      referenceScopeTransform: { xscale: 1, yscale: 1, xshift: 0, yshift: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      return;
    }

    const after = scopeBodyBounds(result.newSource);
    expect(after).toBeDefined();
    if (!after) {
      return;
    }

    expect(Math.abs(after.minX - before.minX)).toBeLessThan(0.5);
    expect(Math.abs(after.minY - before.minY)).toBeLessThan(0.5);
    expect(after.maxX).toBeGreaterThan(before.maxX);
  });

  it("returns unsupported for non-node elements", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: { x: 10, y: 0 }
    });

    expect(result.kind).toBe("unsupported");
  });

  it("reports changedSourceIds for successful resize edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: "path:0",
      role: "bottom-right",
      newWorld: { x: 120, y: 120 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("blocks resizeElement direct manipulation for fit nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (1,0) {};
  \node[draw,fit=(a) (b)] (f) {};
\end{tikzpicture}`;

    const parsed = parseTikz(source, { recover: true });
    const fitPathId =
      parsed.figure.body
        .find(
          (statement) =>
            statement.kind === "Path"
            && statement.items.some(
              (item) =>
                item.kind === "Node"
                && item.options?.entries.some(
                  (entry) => (entry.kind === "flag" || entry.kind === "kv") && entry.key === "fit"
                )
            )
        )?.id ?? null;
    expect(fitPathId).not.toBeNull();
    if (!fitPathId) {
      return;
    }

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: fitPathId,
      role: "bottom-right",
      newWorld: { x: cm(2), y: cm(1) }
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") {
      return;
    }
    expect(result.reason).toContain("fit");
    expect(result.reason).toContain("disabled");
  });
});

// ── addElement / unimplemented actions ─────────────────────────────────────────

describe("applyEditAction – addElement", () => {
  it("inserts a node snippet before \\end{tikzpicture}", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addElement",
      template: { kind: "node", text: "A" },
      at: { x: cm(2), y: cm(3) }
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
        to: { x: cm(3), y: cm(1) },
        control1: { x: cm(1), y: cm(2) },
        control2: { x: cm(2), y: cm(2) }
      },
      at: { x: cm(0), y: cm(0) }
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
        to: { x: cm(2), y: cm(0) }
      },
      at: { x: cm(0), y: cm(0) }
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
      at: { x: cm(1), y: cm(2) }
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
});

describe("applyEditAction – reorderElements", () => {
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
});

describe("applyEditAction – group/ungroup", () => {
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
});

describe("applyEditAction – duplicateElements", () => {
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
});

describe("applyEditAction – repeatElements", () => {
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
});

describe("applyEditAction – adornment placement", () => {
  it("inserts a new label inside an existing node option list", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "addNodeAdornment",
      nodeId: "node:0:3",
      adornmentKind: "label",
      angle: "below",
      text: "Label"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment insertion to succeed");
    }
    expect(result.newSource).toBe(String.raw`\begin{tikzpicture}
  \node[draw, label=below:Label] (A) at (-1, -1) {A};
\end{tikzpicture}`);
  });

  it("omits a local label distance when dragging back to the implicit default distance", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,label={[red,label distance=6pt]above:X}] at (0,0) {A};
\end{tikzpicture}`;

    const result = applyEditAction(source, [], {
      kind: "moveAdornment",
      targetId: "node-adornment:node:0:2:label:0",
      ownerPoint: { x: 0, y: 0 },
      newWorld: { x: 0, y: 0 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error("Expected adornment move to succeed");
    }
    expect(result.newSource).toContain("label={[");
    expect(result.newSource).toContain("center:X");
    expect(result.newSource).not.toContain("label distance=");
    expect(result.newSource).not.toContain("every label");
    expect(result.changedSourceIds).toEqual(["path:0"]);
  });

  it("does not serialize synthetic every-pin styles when rewriting a pin repeatedly", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,pin=above:Pin] at (0,0) {A};
\end{tikzpicture}`;

    const firstRewrite = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_distance__",
      value: "23.5pt"
    });

    expect(firstRewrite.kind).toBe("success");
    if (firstRewrite.kind !== "success") {
      throw new Error("Expected first pin rewrite to succeed");
    }
    expect(firstRewrite.newSource).not.toContain("every pin");

    const secondRewrite = applyEditAction(firstRewrite.newSource, [], {
      kind: "setProperty",
      elementId: "node-adornment:node:0:2:pin:0",
      level: "command",
      key: "__adornment_angle__",
      value: "40"
    });

    expect(secondRewrite.kind).toBe("success");
    if (secondRewrite.kind !== "success") {
      throw new Error("Expected second pin rewrite to succeed");
    }
    expect(secondRewrite.newSource).not.toContain("every pin");
  });
});

describe("applyEditAction – path-attached nodes", () => {
  it("rewrites neutral path-attached nodes by position only", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.4,fill=white] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.75,
      preserveRegime: true
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[fill=white, near end] {A}");
    expect(result.newSource).not.toContain("above");
    expect(result.newSource).not.toContain("auto");
  });

  it("writes explicit directional distance when dragged", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" },
      distanceUpdatePt: 2
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[above=2pt] {A}");
  });

  it("drops explicit directional distance when dragged back near zero", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above=0.04pt] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" },
      distanceUpdatePt: 0.01
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[above] {A}");
    expect(result.newSource).not.toContain("above=");
  });

  it("rewrites dragged path-attached nodes to named position presets", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.24,above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.26,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("node[above, near start] {A}");
    expect(result.newSource).not.toContain("pos=");
    expect(result.changedSourceIds).toEqual([statement.id]);
  });

  it("omits midway when a dragged path-attached node lands on the default position", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.49,above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("node[above] {A}");
    expect(result.newSource).not.toContain("midway");
    expect(result.newSource).not.toContain("pos=");
  });

  it("keeps auto regime and rewrites side via swap only", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.75,
      preserveRegime: true,
      sideUpdate: { kind: "auto-side", side: "right" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;

    expect(result.newSource).toContain("node[auto, near end, swap] {A}");
    expect(result.newSource).not.toContain("above");
    expect(result.newSource).not.toContain("below");
  });

  it("ignores directional distance updates for auto regime", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "auto-side", side: "left" },
      distanceUpdatePt: 7
    });

    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") return;
    expect(result.reason).toBe(PATH_ATTACHED_NODE_EDIT_NOOP_REASON);
  });

  it("supports inspector writes for path-attached side and sloped", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const sideResult = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "__path_attached_node_side__",
      value: "below"
    });
    expect(sideResult.kind).toBe("success");
    if (sideResult.kind !== "success") return;
    expect(sideResult.newSource).toContain("node[below] {A}");

    const slopedResult = applyEditAction(sideResult.newSource, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "sloped",
      value: "true"
    });
    expect(slopedResult.kind).toBe("success");
    if (slopedResult.kind !== "success") return;
    expect(slopedResult.newSource).toContain("node[below, sloped] {A}");
  });

  it("supports resizeElement rewrites for path-attached nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- node[above,draw] {A} (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: node.id,
      role: "bottom-right",
      newWorld: { x: 60, y: 40 }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/node\[[^\]]*above[^\]]*draw/);
    expect(result.newSource).toContain("minimum width=");
  });

  it("drops non-binding minimum width when shrinking a path-attached node at intrinsic floor", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (-0.2,-0.4) -- node[fill=white, minimum width=16.92pt, pos=0.47] {ok} (2.8,-0.4);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");
    const evaluated = evaluateTikzFigure(parsed.figure, source);
    const bounds = collectSourceWorldBounds(evaluated.scene.elements).get(node.id);
    if (!bounds) throw new Error("Expected node bounds");
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    };

    const shrunk = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: node.id,
      role: "right",
      newWorld: center
    });
    expect(shrunk.kind).toBe("success");
    if (shrunk.kind !== "success") return;
    expect(shrunk.newSource).not.toContain("minimum width=");
  });

  it("writes rotate on path-attached node options without touching host path options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->] (0,0) -- node[above,draw] {A} (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const result = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: "rotate",
      value: "15"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/node\[[^\]]*rotate=15/);
    expect(result.newSource).not.toMatch(/\\draw\[[^\]]*rotate=/);
  });

  it("preserves the current explicit vertical side when drag jitter stays near-axis", () => {
    const direction = resolveDraggedPathAttachedNodeDirection(
      { x: 20, y: 0 },
      { x: 10, y: -0.5 },
      { kind: "explicit-direction", direction: "above", family: "cardinal-diagonal" }
    );

    expect(direction).toBe("above");
  });
});

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
