import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { PT_PER_CM } from "../../packages/core/src/coords/source.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { PATH_ATTACHED_NODE_POSITION_VALUE_KEY } from "../../packages/core/src/edit/path-attached-node-keys.js";
import { getInspectorDescriptor } from "../../packages/core/src/edit/inspector.js";
import { expectPatchesReconstructSource } from "../edit-actions-helpers.js";

function attachment(source: string) {
  const parse = parseTikz(source);
  const rendered = { parse, semantic: evaluateTikzFigure(parse.figure, source) };
  expect(rendered.parse.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  expect(rendered.semantic.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  const handle = rendered.semantic.editHandles.find(h => h.pathAttachmentContext);
  if (!handle?.pathAttachmentContext) throw new Error("Expected a path-attached node handle");
  return { rendered, handle, context: handle.pathAttachmentContext };
}

describe("path position extrapolation", () => {
  // PGF reference centers include the trimmed borders of the empty o/a nodes.
  it.each([
    [-1, 49.8472, 74.75931],
    [-0.25, 10.69728, 16.04008],
    [1.25, -67.60255, -101.39832],
    [2, -106.75247, -160.11754]
  ])("renders issue #18 at pos=%s", (position, xPt, yPt) => {
    const source = String.raw`\begin{tikzpicture}
\node[draw] (o) at (0,0) {};
\node[draw] (a) at (-2,-3) {};
\path (o) -- (a) node[draw,pos=${position},name=b] {};
\end{tikzpicture}`;
    const { handle, context } = attachment(source);
    expect(context.pos).toBe(position);
    expect(handle.world.x).toBeCloseTo(xPt, 1);
    expect(handle.world.y).toBeCloseTo(yPt, 1);
  });

  it.each([
    [String.raw`(0,0) -- node[pos=2] {} (2,3)`, 2, 4, 6],
    [String.raw`(0,0) -| (2,3) node[pos=-.5] {}`, -.5, -2, 0],
    [String.raw`(0,0) -| (2,3) node[pos=1.5] {}`, 1.5, 2, 6],
    [String.raw`(0,0) |- (2,3) node[pos=-.5] {}`, -.5, 0, -3],
    [String.raw`(0,0) |- (2,3) node[pos=1.5] {}`, 1.5, 4, 3],
    [String.raw`(0,0) .. controls (0,1) and (1,1) .. (1,0) node[pos=2,sloped] {}`, 2, -4, -6],
    [String.raw`(0,0) .. controls (0,1) and (1,1) .. (1,0) node[pos=-.5] {}`, -.5, 1, -2.25],
    [String.raw`(1,0) arc[start angle=0,end angle=90,radius=1cm] node[pos=1.5,sloped] {}`, 1.5, -Math.SQRT1_2, Math.SQRT1_2],
    [String.raw`(1,0) arc[start angle=0,end angle=90,radius=1cm] node[pos=-.5] {}`, -.5, Math.SQRT1_2, -Math.SQRT1_2]
  ])("extrapolates %s", (path, position, x, y) => {
    const { handle, context } = attachment(String.raw`\begin{tikzpicture}\draw ${path};\end{tikzpicture}`);
    expect(context.pos).toBe(position);
    expect(handle.world.x / PT_PER_CM).toBeCloseTo(Number(x), 5);
    expect(handle.world.y / PT_PER_CM).toBeCloseTo(Number(y), 5);
  });

  it.each([-0.01, -0.5, 1.0001, 2])("preserves pos=%s through drag and inspector writes", position => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (2,0) node[pos=.4] {Label};\end{tikzpicture}`;
    const { rendered, handle, context } = attachment(source);
    for (const action of [
      { kind: "movePathAttachedNode" as const, nodeId: handle.sourceRef.sourceId, hostPathSourceId: context.hostPathSourceId, pos: position, preserveRegime: true as const },
      { kind: "setProperty" as const, elementId: handle.sourceRef.sourceId, level: "command" as const, key: PATH_ATTACHED_NODE_POSITION_VALUE_KEY, value: String(position) }
    ]) {
      const result = applyEditAction(source, rendered.semantic.editHandles, action);
      expect(result.kind).toBe("success");
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      expectPatchesReconstructSource(source, result);
      expect(attachment(result.newSource).context.pos).toBe(position);
    }
  });

  it.each([-1.5, 2])("includes pos=%s in the attachment inspector slider", position => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (2,0) node[pos=${position}] {Label};\end{tikzpicture}`;
    const { rendered } = attachment(source);
    const text = rendered.semantic.scene.elements.find(e => e.kind === "Text" && e.text === "Label");
    if (!text) throw new Error("Expected node text");
    const descriptor = getInspectorDescriptor(text, { source, editHandles: rendered.semantic.editHandles });
    const property = descriptor.sections.flatMap(s => s.properties).find(p => p.id === "path-attached-node-position");
    if (property?.kind !== "slider") throw new Error("Expected attachment position slider");
    expect(property.value).toBe(position);
    expect(property.min).toBeLessThanOrEqual(position);
    expect(property.max).toBeGreaterThanOrEqual(position);
    expect(property.displayLabel).toBe(position.toFixed(2));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects non-finite drag positions (%s)", position => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (2,0) node {Label};\end{tikzpicture}`;
    const { rendered, handle, context } = attachment(source);
    const result = applyEditAction(source, rendered.semantic.editHandles, {
      kind: "movePathAttachedNode", nodeId: handle.sourceRef.sourceId,
      hostPathSourceId: context.hostPathSourceId, pos: position, preserveRegime: true
    });
    expect(result.kind).toBe("error");
  });
});
