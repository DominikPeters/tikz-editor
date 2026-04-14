import { describe, expect, it } from "vitest";

import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";

const PT_PER_CM = 72.27 / 2.54;
const cm = (value: number): number => value * PT_PER_CM;

function evaluate(source: string) {
  const parsed = parseTikz(source);
  return evaluateTikzFigure(parsed.figure, source);
}

describe("edit handles", () => {
  it("basic cartesian: two handles with direct rewrite mode", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,2) -- (3,4);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);

    const [h0, h1] = result.editHandles;
    expect(h0.kind).toBe("path-point");
    expect(h0.rewriteMode).toBe("direct");
    expect(h0.coordinateForm).toBe("cartesian");
    expect(h0.world.x).toBeCloseTo(cm(1));
    expect(h0.world.y).toBeCloseTo(cm(2));
    expect(h0.local?.x).toBeCloseTo(cm(1));
    expect(h0.local?.y).toBeCloseTo(cm(2));

    expect(h1.kind).toBe("path-point");
    expect(h1.rewriteMode).toBe("direct");
    expect(h1.world.x).toBeCloseTo(cm(3));
    expect(h1.world.y).toBeCloseTo(cm(4));
  });

  it("to operation target emits a path-point handle", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) to (1,1);
\end{tikzpicture}`;
    const result = evaluate(source);
    const pathHandles = result.editHandles.filter((h) => h.kind === "path-point");
    expect(pathHandles).toHaveLength(2);

    const target = pathHandles.find((h) => source.slice(h.sourceRef.sourceSpan.from, h.sourceRef.sourceSpan.to) === "(1,1)");
    expect(target).toBeDefined();
    expect(target?.rewriteMode).toBe("direct");
    expect(target?.world.x).toBeCloseTo(cm(1));
    expect(target?.world.y).toBeCloseTo(cm(1));
  });

  it("to[out=...,in=...] emits synthetic in/out control handles", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) to[out=20,in=160] (2,0);
\end{tikzpicture}`;
    const result = evaluate(source);
    const angleHandles = result.editHandles.filter(
      (handle) => handle.kind === "path-control" && handle.curveEdit?.kind === "to-angle"
    );

    expect(angleHandles).toHaveLength(2);
    expect(angleHandles.map((handle) => (handle.curveEdit as any).role).sort()).toEqual(["in", "out"]);
  });

  it("edge[out=...] also emits synthetic in/out control handles", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) edge[out=45] (2,0);
\end{tikzpicture}`;
    const result = evaluate(source);
    const angleHandles = result.editHandles.filter(
      (handle) => handle.kind === "path-control" && handle.curveEdit?.kind === "to-angle"
    );

    expect(angleHandles).toHaveLength(2);
  });

  it("to[bend left] emits a single synthetic bend handle", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) to[bend left] (2,0);
\end{tikzpicture}`;
    const result = evaluate(source);
    const bendHandles = result.editHandles.filter(
      (handle) => handle.kind === "path-bend" && handle.curveEdit?.kind === "to-bend"
    );
    const angleHandles = result.editHandles.filter(
      (handle) => handle.kind === "path-control" && handle.curveEdit?.kind === "to-angle"
    );

    expect(bendHandles).toHaveLength(1);
    expect(angleHandles).toHaveLength(0);
  });

  it("curve operator with controls+and emits path-control handles and curve endpoint handle", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) .. controls (1,1) and (2,1) .. (3,0);
\end{tikzpicture}`;
    const result = evaluate(source);

    const controlHandles = result.editHandles.filter((h) => h.kind === "path-control");
    expect(controlHandles).toHaveLength(2);
    expect(controlHandles.map((handle) => source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to))).toEqual(
      expect.arrayContaining(["(1,1)", "(2,1)"])
    );

    const pathPointHandles = result.editHandles.filter((h) => h.kind === "path-point");
    expect(pathPointHandles.map((handle) => source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to))).toEqual(
      expect.arrayContaining(["(0,0)", "(3,0)"])
    );
  });

  it("single-control curve operator emits exactly one path-control handle", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) .. controls (1,1) .. (3,0);
\end{tikzpicture}`;
    const result = evaluate(source);

    const controlHandles = result.editHandles.filter((h) => h.kind === "path-control");
    expect(controlHandles).toHaveLength(1);
    expect(source.slice(controlHandles[0]!.sourceRef.sourceSpan.from, controlHandles[0]!.sourceRef.sourceSpan.to)).toBe("(1,1)");
  });

  it("named control-point handles resolve rewrite targets", () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (ctrl) at (1,1);
\draw (0,0) .. controls (ctrl) and (2,1) .. (3,0);
\end{tikzpicture}`;
    const result = evaluate(source);

    const namedControl = result.editHandles.find(
      (handle) =>
        handle.kind === "path-control" &&
        source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to) === "(ctrl)"
    );
    expect(namedControl).toBeDefined();
    expect(namedControl?.coordinateForm).toBe("named");
    expect(namedControl?.rewriteTargetHandleId).toBeDefined();
  });

  it("with transform: local is pre-transform, world is rotated", () => {
    const source = String.raw`\begin{tikzpicture}
\draw[rotate=90] (1,0) -- (0,1);
\end{tikzpicture}`;
    const result = evaluate(source);
    // Two path-point handles
    expect(result.editHandles).toHaveLength(2);

    const [h0, h1] = result.editHandles;

    // (1,0) rotated 90° → (0,1)
    expect(h0.local?.x).toBeCloseTo(cm(1));
    expect(h0.local?.y).toBeCloseTo(0);
    expect(h0.world.x).toBeCloseTo(0);
    expect(h0.world.y).toBeCloseTo(cm(1));
    expect(h0.rewriteMode).toBe("direct");

    // (0,1) rotated 90° → (-1,0)
    expect(h1.local?.x).toBeCloseTo(0);
    expect(h1.local?.y).toBeCloseTo(cm(1));
    expect(h1.world.x).toBeCloseTo(cm(-1));
    expect(h1.world.y).toBeCloseTo(0);
  });

  it("relative: second handle has delta rewrite mode with relativePrefix", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,2) -- ++(1,0);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);

    const [h0, h1] = result.editHandles;
    expect(h0.rewriteMode).toBe("direct");
    expect(h0.relativePrefix).toBeUndefined();

    expect(h1.rewriteMode).toBe("delta");
    expect(h1.relativePrefix).toBe("++");
    // world is (1,2) + (1,0) = (2,2)
    expect(h1.world.x).toBeCloseTo(cm(2));
    expect(h1.world.y).toBeCloseTo(cm(2));
    // local is the delta vector (1,0)
    expect(h1.local?.x).toBeCloseTo(cm(1));
    expect(h1.local?.y).toBeCloseTo(0);
    // relativeBaseWorld is the current point at time of evaluation = (1,2)
    expect(h1.relativeBaseWorld?.x).toBeCloseTo(cm(1));
    expect(h1.relativeBaseWorld?.y).toBeCloseTo(cm(2));
  });

  it("named: handles with unsupported rewrite mode", () => {
    const source = String.raw`\begin{tikzpicture}
\path coordinate (A) at (2,3);
\draw (A) -- (B);
\end{tikzpicture}`;
    const result = evaluate(source);
    // (A) resolves, (B) does not — only one path-point handle for (A)
    const pathHandles = result.editHandles.filter((h) => h.kind === "path-point");
    expect(pathHandles.length).toBeGreaterThanOrEqual(1);
    const namedHandle = pathHandles.find((h) => h.coordinateForm === "named");
    expect(namedHandle).toBeDefined();
    expect(namedHandle?.rewriteMode).toBe("unsupported");
    expect(namedHandle?.rewriteTargetHandleId).toBeDefined();
    expect(namedHandle?.world.x).toBeCloseTo(cm(2));
    expect(namedHandle?.world.y).toBeCloseTo(cm(3));
  });

  it("node position: handle with node-position kind", () => {
    const source = String.raw`\begin{tikzpicture}
\node at (2,3) {text};
\end{tikzpicture}`;
    const result = evaluate(source);
    const nodeHandles = result.editHandles.filter((h) => h.kind === "node-position");
    expect(nodeHandles).toHaveLength(1);
    const h = nodeHandles[0];
    expect(h.rewriteMode).toBe("direct");
    expect(h.world.x).toBeCloseTo(cm(2));
    expect(h.world.y).toBeCloseTo(cm(3));
  });

  it("emits drag metadata for a path-attached node on a line", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const result = evaluate(source);

    const handle = result.editHandles.find((candidate) => candidate.kind === "node-position" && candidate.pathAttachmentContext);
    expect(handle).toBeDefined();
    expect(handle?.pathAttachmentContext?.segment.kind).toBe("line");
    expect(handle?.pathAttachmentContext?.regime.kind).toBe("explicit-direction");
    if (handle?.pathAttachmentContext?.regime.kind === "explicit-direction") {
      expect(handle.pathAttachmentContext.regime.direction).toBe("above");
    }

    const text = result.scene.elements.find(
      (element): element is Extract<(typeof result.scene.elements)[number], { kind: "Text" }> =>
        element.kind === "Text" && element.text === "A"
    );
    expect(text?.pathAttachment?.segment.kind).toBe("line");
    expect(text?.pathAttachment?.pos).toBeCloseTo(0.5, 6);
    expect(text?.position.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThan(0);
  });

  it("emits drag metadata for path-attached directional kv syntax", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,0) node[above=2pt] {A};
\end{tikzpicture}`;
    const result = evaluate(source);

    const handle = result.editHandles.find((candidate) => candidate.kind === "node-position" && candidate.pathAttachmentContext);
    expect(handle).toBeDefined();
    expect(handle?.pathAttachmentContext?.regime.kind).toBe("explicit-direction");
    if (handle?.pathAttachmentContext?.regime.kind === "explicit-direction") {
      expect(handle.pathAttachmentContext.regime.direction).toBe("above");
    }
  });

  it("emits drag metadata for path-attached neutral placement", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (2,0) node[pos=0.4,fill=white] {A};
\end{tikzpicture}`;
    const result = evaluate(source);

    const handle = result.editHandles.find((candidate) => candidate.kind === "node-position" && candidate.pathAttachmentContext);
    expect(handle).toBeDefined();
    expect(handle?.pathAttachmentContext?.regime.kind).toBe("neutral");
    expect(handle?.pathAttachmentContext?.pos).toBeCloseTo(0.4, 6);
  });

  it("positioning: node with right=1cm of emits positioning handle", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node[right=1cm of A] (B) {B};
\end{tikzpicture}`;
    const result = evaluate(source);
    const nodeHandles = result.editHandles.filter((h) => h.kind === "node-position");
    // First handle: node A (direct), second: node B implicit origin, third: node B positioning
    const posHandles = nodeHandles.filter((h) => h.rewriteMode === "positioning");
    expect(posHandles).toHaveLength(1);
    const h = posHandles[0];
    expect(h.positioningContext).toBeDefined();
    expect(h.positioningContext!.direction).toBe("right");
    expect(h.positioningContext!.targetNodeName).toBe("A");
    expect(h.positioningContext!.legacyOf).toBe(false);
    // Target center should be at node A's center (0,0)
    expect(h.positioningContext!.targetCenter.x).toBeCloseTo(0, 0);
    expect(h.positioningContext!.targetCenter.y).toBeCloseTo(0, 0);
    // handle.world is now B's center, should be to the right of A's center
    expect(h.world.x).toBeGreaterThan(cm(1) * 0.8);
    // Anchor half-dimensions should be populated
    expect(h.positioningContext!.targetAnchorHW).toBeGreaterThan(0);
    expect(h.positioningContext!.currentAnchorHW).toBeGreaterThan(0);
  });

  it("positioning: base left direction is not draggable", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node[base left=1cm of A] (B) {B};
\end{tikzpicture}`;
    const result = evaluate(source);
    const posHandles = result.editHandles.filter((h) => h.rewriteMode === "positioning");
    expect(posHandles).toHaveLength(0);
  });

  it("matrix without explicit placement does not emit synthetic node-position handles", () => {
    const source = String.raw`\begin{tikzpicture}
\matrix[matrix of nodes] {
  A & B \\
  C & D \\
};
\end{tikzpicture}`;
    const result = evaluate(source);
    const nodeHandles = result.editHandles.filter((handle) => handle.kind === "node-position");
    expect(nodeHandles).toHaveLength(0);
  });

  it("matrix with inline at emits a single movable node-position handle", () => {
    const source = String.raw`\begin{tikzpicture}
\matrix[matrix of nodes] at (0,0) {
  A & B \\
};
\end{tikzpicture}`;
    const result = evaluate(source);
    const nodeHandles = result.editHandles.filter((handle) => handle.kind === "node-position");
    expect(nodeHandles).toHaveLength(1);
    expect(source.slice(nodeHandles[0]!.sourceRef.sourceSpan.from, nodeHandles[0]!.sourceRef.sourceSpan.to)).toBe("(0,0)");
  });

  it("polar: handle with polar coordinateForm and direct rewrite", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (45:2);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);
    const polarHandle = result.editHandles.find((h) => h.coordinateForm === "polar");
    expect(polarHandle).toBeDefined();
    expect(polarHandle?.rewriteMode).toBe("direct");
    // 45° at radius 2 → (√2, √2) ≈ (1.414, 1.414)
    expect(polarHandle?.world.x).toBeCloseTo(cm(Math.SQRT2));
    expect(polarHandle?.world.y).toBeCloseTo(cm(Math.SQRT2));
  });

  it("source span accuracy: spans point to correct positions", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (1,2) -- (3,4);
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(2);

    for (const handle of result.editHandles) {
      // Span from/to should be within the source string
      expect(handle.sourceRef.sourceSpan.from).toBeGreaterThanOrEqual(0);
      expect(handle.sourceRef.sourceSpan.to).toBeGreaterThan(handle.sourceRef.sourceSpan.from);
      expect(handle.sourceRef.sourceSpan.to).toBeLessThanOrEqual(source.length);

      // The text within the span should be a coordinate like "(1,2)"
      const spanText = source.slice(handle.sourceRef.sourceSpan.from, handle.sourceRef.sourceSpan.to);
      expect(spanText).toMatch(/\(\s*[\d.,]+\s*,\s*[\d.,]+\s*\)/);
    }
  });

  it("nested scope transforms: transform is composed from scope and draw options", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[xshift=1cm]
\draw[rotate=90] (1,0);
\end{scope}
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles).toHaveLength(1);
    const h = result.editHandles[0];
    // local is (1,0), rotated 90° → (0,1), then xshift=1cm → (1,1) in world coords
    // 1cm in the coordinate system units
    expect(h.local?.x).toBeCloseTo(cm(1));
    expect(h.local?.y).toBeCloseTo(0);
    expect(h.world.x).toBeCloseTo(cm(1)); // 0 + xshift(1cm)
    expect(h.world.y).toBeCloseTo(cm(1)); // 1cm from rotation
    expect(h.rewriteMode).toBe("direct");
  });

  it("assigns unique handle ids for repeated source spans (e.g. foreach expansion)", () => {
    const source = String.raw`\begin{tikzpicture}
\foreach \x in {0,1,2} { \draw (\x,0) -- ++(1,0); }
\end{tikzpicture}`;
    const result = evaluate(source);
    expect(result.editHandles.length).toBeGreaterThan(1);
    const ids = result.editHandles.map((handle) => handle.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("aligns handle source ids with emitted element source ids", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (-3,-3) rectangle (3,3);
\node[draw] (A) at (-1,-1) {A};
\node[draw] (B) at (1,-1) {B};
\draw (A) edge (B);
\end{tikzpicture}`;
    const result = evaluate(source);
    const elementSourceIds = new Set(result.scene.elements.map((element) => element.sourceRef.sourceId));

    expect(elementSourceIds.size).toBeGreaterThan(0);
    expect(result.editHandles.length).toBeGreaterThan(0);
    for (const handle of result.editHandles) {
      expect(elementSourceIds.has(handle.sourceRef.sourceId)).toBe(true);
    }
  });
});
