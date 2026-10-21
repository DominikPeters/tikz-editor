import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

const candidateGraph = String.raw`\begin{tikzpicture}[
  x=2.0cm,y=1.6cm,
  candidate/.style={circle,draw,fill=white,minimum size=7mm,inner sep=0pt},
  arc/.style={->,>=stealth,semithick},
  first cycles/.style={arc,draw=red!75!black,line width=1pt,
    preaction={draw=white,line width=2.5pt,-}},
  both cycles/.style={arc,draw=red!75!black,line width=1pt,
    preaction={draw=white,line width=2.7pt,-}}]
  \node[candidate] (A) at (0,1) {$A_i$};
  \node[candidate] (B) at (1,1) {$B_i$};
  \node[candidate] (C) at (2,1) {$C_i$};
  \node[candidate] (D) at (0,0) {$D_i$};
  \node[candidate] (E) at (1,0) {$E_i$};
  \node[candidate] (F) at (2,0) {$F_i$};
  \draw[first cycles] (A) to[bend right=5] (E);
  \draw[first cycles] (A) to[bend right=5] (F);
  \draw[first cycles] (B) -- (F);
  \draw[first cycles] (A) -- (B);
  \draw[first cycles] (B) -- (C);
  \draw[first cycles] (D) to[bend right=30] (F);
  \draw[first cycles] (A) to[bend left=30] (C);
  \draw[first cycles] (D) -- (E);
  \draw[first cycles] (E) -- (F);
  \draw[both cycles] (D) -- (A);
  \draw[both cycles] (E) -- (B);
  \draw[both cycles] (F) -- (C);
  \draw[both cycles] (B) -- (D);
  \draw[both cycles] (C) to[bend right=2] (D);
  \draw[both cycles] (C) -- (E);
\end{tikzpicture}`;

describe("detaching named path endpoints", () => {
  it("keeps E -> B under the pointer throughout a drag with custom x/y units", () => {
    const rendered = renderTikzToSvg(candidateGraph);
    const from = candidateGraph.indexOf("(B)", candidateGraph.indexOf("\\draw[both cycles] (E)"));
    const handle = rendered.semantic.editHandles.find(h => h.sourceRef.sourceSpan.from === from);
    if (!handle) throw new Error("Missing E -> B endpoint");
    const geometry = createEditGeometrySession({ source: candidateGraph, parsed: rendered.parse, semantic: rendered.semantic });
    let source = candidateGraph;

    for (const target of [wp(cm(2.4), cm(1.8)), wp(cm(2.8), cm(2.1)), handle.world]) {
      const result = applyEditAction(source, rendered.semantic.editHandles, {
        kind: "moveHandle", handleId: handle.id, newWorld: target
      }, { geometry });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expectPatchesReconstructSource(source, result);
      source = result.newSource;
      const next = renderTikzToSvg(source);
      const endpoint = next.semantic.editHandles.find(h => h.id === handle.id);
      expect(endpoint?.world.x).toBeCloseTo(target.x, 0);
      expect(endpoint?.world.y).toBeCloseTo(target.y, 0);
      expect(source).toContain("\\node[candidate] (B) at (1,1)");
    }
    expect(source).toBe(candidateGraph);
  });

  it.each([
    ["", "", ""],
    ["x=2cm,y=1.6cm", "", ""],
    ["x={(2cm,.5cm)},y={(-.3cm,1.6cm)}", "", ""],
    ["x=2cm,y=1.6cm,rotate=20", "xshift=1cm,scale=1.5", "rotate=-35,xshift=3mm"],
    ["", "rotate=30,xshift=2cm", "xscale=2,yscale=.7"]
  ])("inverts the endpoint's numeric frame: picture=%s scope=%s path=%s", (picture, scope, path) => {
    const source = String.raw`\begin{tikzpicture}[${picture}]
      \node (B) at (1,1) {B};
      \begin{scope}[${scope}]
        \draw[${path}] (0,0) -- (B.south);
      \end{scope}
    \end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const handle = rendered.semantic.editHandles.find(h => h.sourceText === "(B.south)");
    if (!handle) throw new Error("Missing endpoint");
    const target = wp(handle.world.x + cm(.3), handle.world.y + cm(.2));
    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "moveHandle", handleId: handle.id, newWorld: target
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expectPatchesReconstructSource(source, result);
    const endpoint = renderTikzToSvg(result.newSource).semantic.editHandles.find(h => h.id === handle.id);
    // Coordinates are serialized to two decimals in source units.
    expect(endpoint?.world.x).toBeCloseTo(target.x, 0);
    expect(endpoint?.world.y).toBeCloseTo(target.y, 0);
    expect(result.newSource).toContain("\\node (B) at (1,1)");
  });
});
