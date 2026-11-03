import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

// An edge is a path of its own (`\path[every edge, ...]`, tikz.code.tex): it
// keeps the colours and settings of the path it is on, but not its draw /
// fill mode.
function edgePaint(body: string) {
  const elements = renderTikzToSvg(`\\begin{tikzpicture}\n  ${body}\n\\end{tikzpicture}`).semantic.scene.elements;
  const edge = elements.at(-1);
  if (!edge) throw new Error("Expected an edge");
  return { stroke: edge.style.stroke, fill: edge.style.fill, lineWidth: edge.style.lineWidth };
}

describe("edge paint", () => {
  it.each([
    [String.raw`\path[draw=none] (0,0) edge (1,1);`, { stroke: "black", fill: null }],
    [String.raw`\draw[red, draw=none] (0,0) -- (1,0) edge (1,1);`, { stroke: "#ff0000", fill: null }],
    [String.raw`\path[draw=blue] (0,0) edge (1,1);`, { stroke: "#0000ff", fill: null }],
    [String.raw`\path[fill=red] (0,0) edge[bend left] (1,1);`, { stroke: "black", fill: null }],
    [String.raw`\path[fill=red] (0,0) edge[fill=blue] (1,1);`, { stroke: "black", fill: "#0000ff" }],
    [String.raw`\draw[thick] (0,0) edge (1,1);`, { stroke: "black", fill: null, lineWidth: 0.8 }]
  ])("%s", (body, expected) => {
    expect(edgePaint(body)).toMatchObject(expected);
  });
});
