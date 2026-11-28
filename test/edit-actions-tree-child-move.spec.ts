import { describe, expect, it } from "vitest";
import { getEditActionAvailability } from "../packages/core/src/edit/action-availability.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { TREE_CHILD_MOVE_BLOCK_REASON } from "../packages/core/src/edit/tree-child-placement.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { wp } from "./coords-helpers.js";
import { cm } from "./edit-actions-helpers.js";

// A tree child is placed by the tree layout (PGF's growth function from its
// parent's anchor); it has no coordinate of its own to rewrite. Moving one
// must refuse and leave the source untouched, never replace the child.
const TREE = String.raw`\begin{tikzpicture}
  \node {Root}
    child { node {A} }
    child { node {B}
      child { node {B1} } };
\end{tikzpicture}`;
const GROW_RIGHT = String.raw`\begin{tikzpicture}[grow=right, level distance=15mm, sibling distance=10mm]
  \node (r) {Root}
    child { node {A} }
    child { node {B} };
\end{tikzpicture}`;
const A = "path:0:tree-child:1:child-operation:0:1";
const B = "path:0:tree-child:2:child-operation:0:2";
const B1 = `${B}:tree-child:1:child-operation:0:1`;

const render = (source: string) => {
  const rendered = renderTikzToSvg(source);
  const ids = new Set(rendered.semantic.scene.elements.map((element) => element.sourceRef.sourceId));
  return { handles: rendered.semantic.editHandles, scene: rendered.semantic.scene, ids };
};

describe("moving a tree child", () => {
  it.each([
    ["a first-level child", TREE, [A]],
    ["a nested child", TREE, [B1]],
    // `(r)` is an item of the path, so the children's operation indices shift.
    ["a child of a grow=right tree", GROW_RIGHT, ["path:0:tree-child:1:child-operation:0:2"]],
    ["two children", TREE, [A, B]],
    ["a child beside an unrelated element", TREE.replace("\\end{tikzpicture}", "  \\draw (3,0) -- (4,0);\n\\end{tikzpicture}"), [A, "path:1"]],
  ])("refuses moveElements on %s and keeps the source", (_name, source, elementIds) => {
    const { handles, ids } = render(source);
    for (const id of elementIds) expect(ids.has(id)).toBe(true);
    const result = applyEditAction(source, handles, { kind: "moveElements", elementIds, delta: wp(cm(1), cm(0.5)) });
    expect(result).toEqual({ kind: "unsupported", reason: TREE_CHILD_MOVE_BLOCK_REASON });
  });

  it("refuses moveElement, the keyboard nudge's action for one selected element", () => {
    const { handles } = render(TREE);
    const result = applyEditAction(TREE, handles, { kind: "moveElement", elementId: A, delta: wp(cm(0.1), cm(0)) });
    expect(result).toEqual({ kind: "unsupported", reason: TREE_CHILD_MOVE_BLOCK_REASON });
  });

  it("refuses moveHandle on the end of a child's edge from parent", () => {
    const { handles } = render(TREE);
    const handle = handles.find((candidate) => candidate.sourceRef.sourceId === A && candidate.kind === "path-point");
    expect(handle?.rewriteMode).toBe("unsupported");
    if (!handle) return;
    const result = applyEditAction(TREE, handles, { kind: "moveHandle", handleId: handle.id, newWorld: wp(handle.world.x + cm(1), handle.world.y) });
    expect(result).toEqual({ kind: "unsupported", reason: TREE_CHILD_MOVE_BLOCK_REASON });
  });

  it("moves the root when its children are selected too, keeping every child", () => {
    const { handles } = render(TREE);
    const result = applyEditAction(TREE, handles, { kind: "moveElements", elementIds: ["path:0", A, B1], delta: wp(cm(1), cm(0)) });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toMatch(/\\node\s+at \(1,0\)\s*\{Root\}/u);
    expect(result.newSource.slice(result.newSource.indexOf("{Root}"))).toBe(TREE.slice(TREE.indexOf("{Root}")));
    expect(result.changedSourceIds).toContain(A);
  });

  it.each([
    ["alignElements", { kind: "alignElements", elementIds: [A, B], mode: "left" }],
    ["alignElements with the root", { kind: "alignElements", elementIds: ["path:0", A], mode: "left" }],
    ["distributeElements", { kind: "distributeElements", elementIds: ["path:0", A, B], axis: "horizontal" }],
  ] as const)("refuses %s and reports it as unavailable", (_name, action) => {
    const { handles, scene } = render(TREE);
    expect(applyEditAction(TREE, handles, { ...action, elementIds: [...action.elementIds] })).toEqual({ kind: "unsupported", reason: TREE_CHILD_MOVE_BLOCK_REASON });
    const availability = getEditActionAvailability({ source: TREE, snapshotSource: TREE, selectedSourceIds: [...action.elementIds], scene, editHandles: handles });
    const id = action.kind === "alignElements" ? "align-left" : "distribute-horizontal";
    expect(availability[id]).toEqual({ enabled: false, reason: TREE_CHILD_MOVE_BLOCK_REASON });
  });
});
