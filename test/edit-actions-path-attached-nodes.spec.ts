import { describe, expect, it } from "vitest";
import { applyEditAction, PATH_ATTACHED_NODE_EDIT_NOOP_REASON } from "../packages/core/src/edit/actions.js";
import { applyPathAttachedNodeInspectorAction, resolveDraggedPathAttachedNodeDirection } from "../packages/core/src/edit/actions/path-attached-node-actions.js";
import { PATH_ATTACHED_NODE_POSITION_VALUE_KEY, PATH_ATTACHED_NODE_SIDE_KEY } from "../packages/core/src/edit/path-attached-node-keys.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/geometry.js";
import { wp } from "./coords-helpers.js";

describe("applyEditAction – path-attached nodes", () => {
  function firstPathNode(source: string) {
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");
    return { statement, node };
  }

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
      distanceUpdatePt: 2.6
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[above=3pt] {A}");

    const fine = applyEditAction(source, [], {
      kind: "movePathAttachedNode",
      nodeId: node.id,
      hostPathSourceId: statement.id,
      pos: 0.5,
      preserveRegime: true,
      sideUpdate: { kind: "explicit-direction", direction: "above" },
      distanceUpdatePt: 2.6,
      formatPrecision: "fine"
    });

    expect(fine.kind).toBe("success");
    if (fine.kind !== "success") return;
    expect(fine.newSource).toContain("node[above=2.6pt] {A}");
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

  it("removes swap when an auto-side node is dragged back to its base side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto,swap,pos=0.25] {A};
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
      pos: 0.25,
      preserveRegime: true,
      sideUpdate: { kind: "auto-side", side: "left" }
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[auto, near start] {A}");
    expect(result.newSource).not.toContain("swap");
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

  it("ignores unrelated path-attached inspector keys and reports no-op rewrites", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above] {A};
\end{tikzpicture}`;
    const { statement, node } = firstPathNode(source);

    expect(applyPathAttachedNodeInspectorAction(source, {
      elementId: node.id,
      key: "fill",
      value: "red"
    })).toBeNull();

    const unresolved = applyPathAttachedNodeInspectorAction(source, {
      elementId: "node:missing",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "below"
    });
    expect(unresolved?.kind).toBe("unsupported");

    const pathTarget = applyPathAttachedNodeInspectorAction(source, {
      elementId: statement.id,
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "below"
    });
    expect(pathTarget?.kind).toBe("unsupported");

    const noop = applyPathAttachedNodeInspectorAction(source, {
      elementId: node.id,
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "above"
    });
    expect(noop?.kind).toBe("unsupported");
    if (noop?.kind === "unsupported") {
      expect(noop.reason).toBe(PATH_ATTACHED_NODE_EDIT_NOOP_REASON);
    }
  });

  it("rewrites path-attached inspector sides within each explicit direction family", () => {
    const cases = [
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[base left] {A};
\end{tikzpicture}`,
        value: "base right",
        expected: "node[base right] {A}",
        removed: "base left"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[mid left] {A};
\end{tikzpicture}`,
        value: "mid right",
        expected: "node[mid right] {A}",
        removed: "mid left"
      },
      {
        source: String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[above left] {A};
\end{tikzpicture}`,
        value: "below right",
        expected: "node[below right] {A}",
        removed: "above left"
      }
    ];

    for (const entry of cases) {
      const { node } = firstPathNode(entry.source);
      const result = applyPathAttachedNodeInspectorAction(entry.source, {
        elementId: node.id,
        key: PATH_ATTACHED_NODE_SIDE_KEY,
        value: entry.value
      });

      expect(result?.kind).toBe("success");
      if (result?.kind !== "success") continue;
      expect(result.newSource).toContain(entry.expected);
      expect(result.newSource).not.toContain(entry.removed);
    }
  });

  it("keeps explicit auto=right when rewriting to the swapped side", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto=right] {A};
\end{tikzpicture}`;
    const { node } = firstPathNode(source);

    const result = applyPathAttachedNodeInspectorAction(source, {
      elementId: node.id,
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "left"
    });

    expect(result?.kind).toBe("success");
    if (result?.kind !== "success") return;
    expect(result.newSource).toContain("node[auto=right, swap] {A}");
  });

  it("rejects incompatible path-attached inspector side values by regime", () => {
    const autoSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[auto] {A};
\end{tikzpicture}`;
    const autoParsed = parseTikz(autoSource);
    const autoStatement = autoParsed.figure.body[0];
    if (!autoStatement || autoStatement.kind !== "Path") throw new Error("Expected path statement");
    const autoNode = autoStatement.items.find((item) => item.kind === "Node");
    if (!autoNode || autoNode.kind !== "Node") throw new Error("Expected auto node item");

    const badAutoSide = applyEditAction(autoSource, [], {
      kind: "setProperty",
      elementId: autoNode.id,
      level: "command",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "above"
    });
    expect(badAutoSide.kind).toBe("error");

    const explicitSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[base left] {A};
\end{tikzpicture}`;
    const explicitParsed = parseTikz(explicitSource);
    const explicitStatement = explicitParsed.figure.body[0];
    if (!explicitStatement || explicitStatement.kind !== "Path") throw new Error("Expected path statement");
    const explicitNode = explicitStatement.items.find((item) => item.kind === "Node");
    if (!explicitNode || explicitNode.kind !== "Node") throw new Error("Expected explicit node item");

    const badExplicitSide = applyEditAction(explicitSource, [], {
      kind: "setProperty",
      elementId: explicitNode.id,
      level: "command",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "above"
    });
    expect(badExplicitSide.kind).toBe("error");
  });

  it("rejects invalid path-attached inspector positions and neutral side edits", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0) node[pos=0.4] {A};
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const node = statement.items.find((item) => item.kind === "Node");
    if (!node || node.kind !== "Node") throw new Error("Expected node item");

    const invalidPosition = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: PATH_ATTACHED_NODE_POSITION_VALUE_KEY,
      value: "not-a-number"
    });
    expect(invalidPosition.kind).toBe("error");

    const neutralSide = applyEditAction(source, [], {
      kind: "setProperty",
      elementId: node.id,
      level: "command",
      key: PATH_ATTACHED_NODE_SIDE_KEY,
      value: "left"
    });
    expect(neutralSide.kind).toBe("unsupported");
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
      newWorld: wp(60, 40)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/node\[[^\]]*above[^\]]*draw/);
    expect(result.newSource).toContain("minimum width=");
  });

  it("supports resizeElement rewrites for edge-attached nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) edge node[draw] {A} (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const statement = parsed.figure.body[0];
    if (!statement || statement.kind !== "Path") throw new Error("Expected path statement");
    const edge = statement.items.find((item) => item.kind === "EdgeOperation");
    if (!edge || edge.kind !== "EdgeOperation" || !edge.nodes?.[0]) throw new Error("Expected edge node");

    const result = applyEditAction(source, [], {
      kind: "resizeElement",
      elementId: edge.nodes[0].id,
      role: "bottom-right",
      newWorld: wp(60, 40)
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("node[draw, minimum width=");
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
    const center = wp((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);

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
      wp(20, 0),
      wp(10, -0.5),
      { kind: "explicit-direction", direction: "above", family: "cardinal-diagonal" }
    );

    expect(direction).toBe("above");
  });
});
