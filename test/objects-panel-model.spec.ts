import { describe, expect, it } from "vitest";
import { createEditAnalysisSession } from "../packages/core/src/edit/analysis.js";
import { evaluateSemantic } from "./semantic/helpers.js";
import { buildObjectsPanelModel } from "../packages/app/src/ui/objects-panel/model";

describe("objects panel model", () => {
  it("derives names, hidden state, labels, and same-parent reorder metadata", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[transparent]
    \draw[name=box] (0,0) rectangle (1,1);
  \end{scope}
  \matrix[matrix of nodes] (m) {
    A & B\\
  };
  \draw (2,0) circle (0.5);
\end{tikzpicture}`;
    const analysisView = createEditAnalysisSession().ensure(source);
    const semantic = evaluateSemantic(source);
    const model = buildObjectsPanelModel({
      analysisView,
      scene: semantic.scene,
      selectedIds: new Set(["scope:0"])
    });

    expect(model.nodes).toHaveLength(3);

    const scope = model.byId.get("scope:0");
    expect(scope?.title).toBe("Scope");
    expect(scope?.hidden).toBe(true);
    expect(scope?.selected).toBe(true);
    expect(scope?.childCount).toBe(1);

    const box = model.byId.get("path:1");
    expect(box?.title).toBe("box");
    expect(box?.label).toBe("Rectangle");
    expect(box?.canDragReorder).toBe(false);

    const matrix = model.byId.get("path:2");
    expect(matrix?.title).toBe("m");
    expect(matrix?.label).toBe("Matrix");
    expect(matrix?.canDragReorder).toBe(true);

    const circle = model.byId.get("path:3");
    expect(circle?.label).toBe("Circle");
    expect(circle?.canDragReorder).toBe(true);
  });

  it("uses node item names and node item options for node rows", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw, transparent] (B) at (1.5, -0.5) {B};
\end{tikzpicture}`;
    const analysisView = createEditAnalysisSession().ensure(source);
    const semantic = evaluateSemantic(source);
    const model = buildObjectsPanelModel({
      analysisView,
      scene: semantic.scene,
      selectedIds: new Set()
    });

    const node = model.byId.get("path:0");
    expect(node?.title).toBe("B");
    expect(node?.label).toBe("Node");
    expect(node?.hidden).toBe(true);
    expect(node?.writeTargetId).not.toBe(node?.id);
  });

  it("labels explicit background scopes as background layers", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[on background layer]
    \draw (0,0) -- (1,0);
  \end{scope}
  \begin{scope}[on background layer={draw=yellow}]
    \draw (0,-1) -- (1,-1);
  \end{scope}
\end{tikzpicture}`;
    const analysisView = createEditAnalysisSession().ensure(source);
    const semantic = evaluateSemantic(source);
    const model = buildObjectsPanelModel({
      analysisView,
      scene: semantic.scene,
      selectedIds: new Set()
    });

    expect(model.nodes.map((node) => node.label)).toEqual(["Background Layer", "Background Layer"]);
    expect(model.nodes.flatMap((node) => node.children.map((child) => child.label))).toEqual(["Line", "Line"]);
  });

  it("derives smarter labels for supported path operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-2.5, 2.5) -- (2.5, 2.5);
  \draw (-2.11,1.26) grid (-1.11,0.26);
  \draw (0,0) -- (1,0) -- (1,1);
  \draw (0,0) to (1,1);
  \draw (0,0) .. controls (1,1) .. (2,0);
\end{tikzpicture}`;
    const analysisView = createEditAnalysisSession().ensure(source);
    const semantic = evaluateSemantic(source);
    const model = buildObjectsPanelModel({
      analysisView,
      scene: semantic.scene,
      selectedIds: new Set()
    });

    expect(model.byId.get("path:0")?.label).toBe("Line");
    expect(model.byId.get("path:1")?.label).toBe("Grid");
    expect(model.byId.get("path:2")?.label).toBe("Polyline");
    expect(model.byId.get("path:3")?.label).toBe("Connector");
    expect(model.byId.get("path:4")?.label).toBe("Curve");
  });

  it("labels recognized leading figure bounds as Bounding Box", () => {
    const source = String.raw`\begin{tikzpicture}
  \useasboundingbox (0,0) rectangle (1,1);
  \draw (0.2,0.8) rectangle (0.8,0.2);
\end{tikzpicture}`;
    const analysisView = createEditAnalysisSession().ensure(source);
    const semantic = evaluateSemantic(source);
    const model = buildObjectsPanelModel({
      analysisView,
      scene: semantic.scene,
      selectedIds: new Set()
    });

    expect(model.byId.get("path:0")?.label).toBe("Bounding Box");
    expect(model.byId.get("path:1")?.label).toBe("Rectangle");
  });

  it("does not label later bounding-box directives as canonical Bounding Box", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (-1,-1) rectangle (1,1);
  \path[use as bounding box] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const analysisView = createEditAnalysisSession().ensure(source);
    const semantic = evaluateSemantic(source);
    const model = buildObjectsPanelModel({
      analysisView,
      scene: semantic.scene,
      selectedIds: new Set()
    });

    expect(model.byId.get("path:0")?.label).toBe("Rectangle");
    expect(model.byId.get("path:1")?.label).toBe("Rectangle");
  });
});
