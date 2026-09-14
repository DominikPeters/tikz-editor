import { describe, expect, it } from "vitest";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { resolveHandleIdForDrag } from "../../packages/app/src/ui/canvas-panel/interaction-helpers.js";
import { resolveHandleDragAction, updateHandleDragAfterAction } from "../../packages/app/src/ui/canvas-panel/handle-drag-actions.js";
import type { DragState } from "../../packages/app/src/ui/canvas-panel/types.js";
import { expectPatchesReconstructSource } from "../edit-actions-helpers.js";
import { wp } from "../coords-helpers.js";

const triangle = String.raw`\fill[green] (10.3,49)--(11.6500,48.4250)--(11.6500,49.5750)--cycle;`;
const renderOptions = { parse: { includeContextDefinitions: true } };

function connectLine(named: boolean, scoped: boolean) {
  const node = String.raw`\node[anchor=north]${named ? " (depot)" : ""} at (6,52) {Depot};`;
  const source = String.raw`\tikzset{route/.style={draw=green}}
\begin{tikzpicture}[x=1mm,y=-1mm]
${scoped ? String.raw`\begin{scope}[shift={(5,3)},rotate=20]` : ""}
\draw[route] (26,49)--(11.1775,49.0000);
${triangle}
${node}
${scoped ? String.raw`\end{scope}` : ""}
\end{tikzpicture}`;
  const before = renderTikzToSvg(source, renderOptions);
  const endpoint = before.semantic.editHandles.find((handle) => handle.sourceText === "(11.1775,49.0000)")!;
  const nodeSourceId = before.semantic.editHandles.find((handle) => handle.sourceText === "(6,52)")!.sourceRef.sourceId;
  const namedSource = named ? source : source.replace(node, node.replace("\\node[anchor=north]", "\\node[anchor=north] (depot)"));
  const target = renderTikzToSvg(namedSource, renderOptions).semantic.nodeAnchorTargets.find((anchor) =>
    anchor.nodeName === "depot" && anchor.anchor === "north east"
  )!;
  const drag: Extract<DragState, { kind: "handle" }> = {
    kind: "handle", pointerId: 1, handleId: endpoint.id, sourceId: endpoint.sourceRef.sourceId,
    handleKind: endpoint.kind, cursor: "move", lastKnownWorld: endpoint.world,
    snapContext: null, gridResizeSnap: null, historyMergeKey: "drag-endpoint",
    activeEndpointAnchor: { ...target, nodeName: named ? "depot" : "", nodeSourceId }
  };
  const result = applyEditAction(source, before.semantic.editHandles, resolveHandleDragAction({
    handleId: drag.handleId, newWorld: target.world, activeEndpointAnchor: drag.activeEndpointAnchor
  }));
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  expectPatchesReconstructSource(source, result);
  updateHandleDragAfterAction(drag, { ...result, sourceChanged: result.newSource !== source }, target.world);
  return { drag, result, target, before, after: renderTikzToSvg(result.newSource, renderOptions) };
}

describe("anchor drag across statement reordering", () => {
  it.each([
    { named: true, scoped: false }, { named: false, scoped: false },
    { named: true, scoped: true }, { named: false, scoped: true }
  ])("keeps dragging the line and preserves the separate triangle ($named, $scoped)", ({ named, scoped }) => {
    const { drag, result, target, after } = connectLine(named, scoped);
    // This id still exists, but is now the second vertex of the triangle.
    const recycled = after.semantic.editHandles.find((handle) => handle.id === drag.handleId);
    expect(recycled?.sourceText).toBe("(11.6500,48.4250)");

    const resolvedId = resolveHandleIdForDrag(drag, after.semantic.editHandles);
    const resolved = after.semantic.editHandles.find((handle) => handle.id === resolvedId)!;
    expect(resolved.sourceText).toBe(`(${named ? "depot" : "node1"}.north east)`);
    expect(drag.sourceId).toBe(resolved.sourceRef.sourceId);
    expect(result.selectedSourceIds).toEqual([resolved.sourceRef.sourceId]);
    expect(result.newSource).toContain(triangle);

    // A mouse release immediately after snapping must use the newly assigned
    // node name, even when the next move has not refreshed the anchor overlay.
    const released = applyEditAction(result.newSource, after.semantic.editHandles, resolveHandleDragAction({
      handleId: resolved.id, newWorld: target.world, activeEndpointAnchor: drag.activeEndpointAnchor
    }));
    expect(released.kind).toBe("success");
    if (released.kind !== "success") throw new Error(JSON.stringify(released));
    expect(released.newSource).toBe(result.newSource);

    // Moving away in the same drag detaches only the line endpoint.
    const moved = applyEditAction(result.newSource, after.semantic.editHandles, resolveHandleDragAction({
      handleId: resolved.id, newWorld: wp(target.world.x + 20, target.world.y + 10), activeEndpointAnchor: null
    }));
    if (moved.kind !== "success") throw new Error(JSON.stringify(moved));
    expect(moved.newSource).toContain(triangle);
    expect(moved.newSource).not.toContain(`--${resolved.sourceText}`);
    const rendered = renderTikzToSvg(moved.newSource, renderOptions);
    expect(rendered.parse.diagnostics).toEqual([]);
    expect(rendered.semantic.diagnostics).toEqual([]);
    expectPatchesReconstructSource(result.newSource, moved);
  });

  it("does not fall back to a recycled or nearby handle when the connected endpoint is missing", () => {
    const { drag, result, after } = connectLine(true, false);
    const handles = after.semantic.editHandles.filter((handle) => handle.sourceRef.sourceId !== result.connectedHandle?.sourceId);
    expect(handles.some((handle) => handle.id === drag.handleId)).toBe(true);
    expect(resolveHandleIdForDrag(drag, handles)).toBeNull();
    expect(drag.connectedHandle).toBeDefined();
    expect(resolveHandleIdForDrag(drag, after.semantic.editHandles)).not.toBeNull();
  });
});
