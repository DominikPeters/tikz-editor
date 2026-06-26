import { describe, expect, it } from "vitest";

import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import type { CanvasSnapshot } from "../../packages/app/src/ui/canvas-panel/types.js";
import {
  collectRelativePositionTargetAnchors,
  isPathContextMenuSource,
  resolveNodePositioningContextMenuAction
} from "../../packages/app/src/ui/canvas-panel/node-positioning-context-action.js";

describe("resolveNodePositioningContextMenuAction", () => {
  it("shows Position Relative To for a single absolute node with an earlier named target", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node (B) at (2,0) {B};
\end{tikzpicture}`;
    const snapshot = renderSnapshot(source);
    const [, nodeId] = pathIds(snapshot);

    const action = resolveNodePositioningContextMenuAction({
      source,
      sourceId: nodeId!,
      snapshot,
      parseOptions: {}
    });

    expect(action).toBe("position-relative");
  });

  it("shows Convert to Absolute Position for an already positioned node", () => {
    const source = String.raw`\begin{tikzpicture}
\node (A) at (0,0) {A};
\node[right=1cm of A] (B) {B};
\end{tikzpicture}`;
    const snapshot = renderSnapshot(source);
    const [, nodeId] = pathIds(snapshot);

    const action = resolveNodePositioningContextMenuAction({
      source,
      sourceId: nodeId!,
      snapshot,
      parseOptions: {}
    });

    expect(action).toBe("convert-absolute");
  });

  it("offers only earlier named node centers as relative positioning targets", () => {
    const source = String.raw`\begin{tikzpicture}
\node at (-1,0) {unnamed};
\node (A) at (0,0) {A};
\node (B) at (1,0) {B};
\node (C) at (2,0) {C};
\end{tikzpicture}`;
    const snapshot = renderSnapshot(source);
    const [, , nodeId] = pathIds(snapshot);

    const targets = collectRelativePositionTargetAnchors({ snapshot, sourceId: nodeId! });

    expect(targets.map((target) => target.nodeName)).toEqual(["A"]);
    expect(targets.every((target) => target.anchor === "center")).toBe(true);
  });

  it("does not show a positioning action when no earlier named target exists", () => {
    const source = String.raw`\begin{tikzpicture}
\node at (0,0) {unnamed};
\node (A) at (1,0) {A};
\end{tikzpicture}`;
    const snapshot = renderSnapshot(source);
    const [nodeId] = pathIds(snapshot);

    const action = resolveNodePositioningContextMenuAction({
      source,
      sourceId: nodeId!,
      snapshot,
      parseOptions: {}
    });

    expect(action).toBeNull();
  });

  it("does not offer path-attached nodes as relative positioning targets", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0) node[midway] (A) {A};
\node (B) at (2,0) {B};
\end{tikzpicture}`;
    const snapshot = renderSnapshot(source);
    const [, nodeId] = pathIds(snapshot);

    const targets = collectRelativePositionTargetAnchors({ snapshot, sourceId: nodeId! });
    const action = resolveNodePositioningContextMenuAction({
      source,
      sourceId: nodeId!,
      snapshot,
      parseOptions: {}
    });

    expect(targets).toEqual([]);
    expect(action).toBeNull();
  });
});

describe("isPathContextMenuSource", () => {
  it("accepts eligible paths and rejects node sources", () => {
    const source = String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0);
\node (A) at (0,0) {A};
\end{tikzpicture}`;
    const snapshot = renderSnapshot(source);
    const [pathId, nodeId] = pathIds(snapshot);

    expect(
      isPathContextMenuSource({
        source,
        sourceId: pathId!,
        snapshot,
        parseOptions: {}
      })
    ).toBe(true);
    expect(
      isPathContextMenuSource({
        source,
        sourceId: nodeId!,
        snapshot,
        parseOptions: {}
      })
    ).toBe(false);
  });
});

function renderSnapshot(source: string): CanvasSnapshot {
  const rendered = renderTikzToSvg(source, { parse: { recover: true } });
  return {
    source,
    revision: 0,
    figures: rendered.parse.figures,
    activeFigureId: null,
    editHandles: rendered.semantic.editHandles,
    scene: rendered.semantic.scene,
    svg: rendered.svg,
    svgModel: null,
    parseResult: rendered.parse,
    semanticResult: rendered.semantic,
    incremental: null
  };
}

function pathIds(snapshot: CanvasSnapshot): string[] {
  return (snapshot.parseResult?.figure.body ?? [])
    .filter((statement) => statement.kind === "Path")
    .map((statement) => statement.id);
}
