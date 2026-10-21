import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { editFeatureRegistry } from "../../packages/core/src/capabilities/registries.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import { expectPatchesReconstructSource } from "../edit-actions-helpers.js";
import { wp } from "../coords-helpers.js";

function render(source: string) {
  const result = renderTikzToSvg(source, { parse: { includeContextDefinitions: true } });
  expect(result.parse.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  expect(result.semantic.diagnostics.filter(d => d.severity === "error")).toEqual([]);
  return result;
}

const prefix = String.raw`\coordinate (C) at (0.85,5.30);\coordinate (B) at (2,3);`;

describe("visual editing of calc coordinates", () => {
  it.each([
    [String.raw`$(C)+(.33,.11)$`, String.raw`$(C)+(0.53,0.01)$`],
    [String.raw`$(C)-(.33,.11)$`, String.raw`$(C)-(0.13,0.21)$`],
    [String.raw`$(C)!.5!(B)$`, String.raw`$(C)!.5!(B)+(0.2,-0.1)$`],
    [String.raw`$(C)+(30:1)$`, String.raw`$(C)+(30:1)+(0.2,-0.1)$`],
    [String.raw`$(C)$`, String.raw`$(C)+(0.2,-0.1)$`],
    [String.raw`$ (C) + ( .33333 , .11000 ) $`, String.raw`$ (C) + ( 0.53333 , 0.01000 ) $`],
    [String.raw`$(C)+(2mm,3pt)$`, String.raw`$(C)+(4mm,0.15pt)$`],
    [String.raw`$(C)+(1e-3,.2)$`, String.raw`$(C)+(0.201,0.1)$`]
  ])("preserves %s while moving it", (expression, expected) => {
    const source = String.raw`\begin{tikzpicture}${prefix}\node[anchor=south west] at (${expression}) {Label};\end{tikzpicture}`;
    const before = render(source);
    const handle = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
    expect(handle.rewriteMode).toBe("calc");
    const result = applyEditAction(source, before.semantic.editHandles, {
      kind: "moveElement", elementId: handle.sourceRef.sourceId, delta: wp(.2 * PT_PER_CM, -.1 * PT_PER_CM)
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain(`(${expected})`);
    expect(result.newSource).toContain(prefix);
    expectPatchesReconstructSource(source, result);
    const after = render(result.newSource).semantic.editHandles.find(h => h.id === handle.id)!;
    expect(after.world.x - handle.world.x).toBeCloseTo(.2 * PT_PER_CM, 2);
    expect(after.world.y - handle.world.y).toBeCloseTo(-.1 * PT_PER_CM, 2);
  });

  it("keeps fine drag precision when the original offset has only one decimal place", () => {
    const source = String.raw`\begin{tikzpicture}${prefix}\node at ($(C)+(.1,.2)$) {Label};\end{tikzpicture}`;
    const before = render(source);
    const handle = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
    const result = applyEditAction(source, before.semantic.editHandles, {
      kind: "moveHandle", handleId: handle.id,
      newWorld: wp(handle.world.x + .15 * PT_PER_CM, handle.world.y + .05 * PT_PER_CM)
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain(String.raw`$(C)+(0.25,0.25)$`);
    expectPatchesReconstructSource(source, result);
  });

  it.each(["rotate=30,scale=2,xshift=1cm", "x=1mm,y=-1mm", "cm={1,.3,.2,1,(2cm,3cm)}"])("uses the active frame under %s", options => {
    const source = String.raw`\begin{tikzpicture}[${options}]${prefix}\node at ($(C)+(.33,.11)$) {Label};\end{tikzpicture}`;
    const before = render(source);
    const handle = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
    const result = applyEditAction(source, before.semantic.editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: wp(handle.world.x + 4, handle.world.y + 7) });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    const after = render(result.newSource).semantic.editHandles.find(h => h.id === handle.id)!;
    expect(after.world.x - handle.world.x).toBeCloseTo(4, 0);
    expect(after.world.y - handle.world.y).toBeCloseTo(7, 0);
    expectPatchesReconstructSource(source, result);
  });

  it("keeps a macro offset and adds only one numeric offset across repeated edits", () => {
    let source = String.raw`\def\dx{.33}\begin{tikzpicture}${prefix}\node at ($(C)+(\dx,.11)$) {Label};\end{tikzpicture}`;
    for (let i = 0; i < 3; i += 1) {
      const before = render(source);
      const handle = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
      const result = applyEditAction(source, before.semantic.editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: wp(handle.world.x + .1 * PT_PER_CM, handle.world.y) });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      expectPatchesReconstructSource(source, result);
      source = result.newSource;
    }
    expect(source).toContain(String.raw`$(C)+(\dx,.11)+(0.3,0)$`);
  });

  it("moves a base, an interpolated node, and a dependent node once each", () => {
    const source = String.raw`\begin{tikzpicture}
\node (C) at (0,0) {C};
\node (B) at (2,0) {B};
\node (N) at ($(C)!.5!(B)+(.2,.3)$) {N};
\node at ($(N)+(0,.4)$) {Label};
\end{tikzpicture}`;
    const before = render(source);
    const ids = ["path:0", "path:1", "path:2", "path:3"];
    const result = applyEditAction(source, before.semantic.editHandles, { kind: "moveElements", elementIds: ids, delta: wp(PT_PER_CM, 2 * PT_PER_CM) });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain(String.raw`$(C)!.5!(B)+(0.2,0.3)$`);
    expect(result.newSource).toContain(String.raw`$(N)+(0,0.4)$`);
    expectPatchesReconstructSource(source, result);
    const after = render(result.newSource);
    for (const handle of before.semantic.editHandles) {
      const moved = after.semantic.editHandles.find(h => h.id === handle.id)!;
      expect(moved.world.x - handle.world.x).toBeCloseTo(PT_PER_CM, 5);
      expect(moved.world.y - handle.world.y).toBeCloseTo(2 * PT_PER_CM, 5);
    }
  });

  it("moves a scope and an outside calc dependent once each", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}\coordinate (C) at (0,0);\end{scope}
\node at ($(C)+(.2,.3)$) {Label};
\end{tikzpicture}`;
    const before = render(source);
    const calc = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
    const result = applyEditAction(source, before.semantic.editHandles, {
      kind: "moveElements", elementIds: ["scope:0", calc.sourceRef.sourceId], delta: wp(20, 40)
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expectPatchesReconstructSource(source, result);
    const moved = render(result.newSource).semantic.editHandles.find(h => h.id === calc.id)!;
    expect(moved.world.x - calc.world.x).toBeCloseTo(20, 0);
    expect(moved.world.y - calc.world.y).toBeCloseTo(40, 0);
  });

  it("moves calc curve controls without changing their references or other controls", () => {
    const source = String.raw`\begin{tikzpicture}${prefix}\draw (0,0) .. controls ($(C)+(.1,.2)$) and (1,2) .. (3,0);\end{tikzpicture}`;
    const before = render(source);
    const handle = before.semantic.editHandles.find(h => h.kind === "path-control" && h.coordinateForm === "calc")!;
    const result = applyEditAction(source, before.semantic.editHandles, {
      kind: "moveHandle", handleId: handle.id,
      newWorld: wp(handle.world.x + .2 * PT_PER_CM, handle.world.y)
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain(String.raw`controls ($(C)+(0.3,.2)$) and (1,2)`);
    expectPatchesReconstructSource(source, result);
    render(result.newSource);
  });

  it("keeps an already aligned calc point fixed while its selected base moves", () => {
    const source = String.raw`\begin{tikzpicture}
\node (C) at (2,0) {X};
\node at ($(C)+(-1,1)$) {X};
\end{tikzpicture}`;
    const before = render(source);
    const calc = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
    const result = applyEditAction(source, before.semantic.editHandles, {
      kind: "alignElements", elementIds: ["path:0", "path:1"], mode: "left"
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain(String.raw`$(C)+(0,1)$`);
    expectPatchesReconstructSource(source, result);
    const moved = render(result.newSource).semantic.editHandles.find(h => h.id === calc.id)!;
    expect(moved.world.x).toBeCloseTo(calc.world.x, 2);
    expect(moved.world.y).toBeCloseTo(calc.world.y, 2);
  });

  it.each(["moveHandle", "moveElement"] as const)("rejects %s for calc source shared by loop expansions", kind => {
    const source = String.raw`\begin{tikzpicture}${prefix}\foreach \x in {0,1} { \node at ($(C)+(\x,.2)$) {Label}; }\end{tikzpicture}`;
    const before = render(source);
    const handle = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
    const action = kind === "moveHandle"
      ? { kind, handleId: handle.id, newWorld: wp(handle.world.x + PT_PER_CM, handle.world.y) }
      : { kind, elementId: handle.sourceRef.sourceId, delta: wp(PT_PER_CM, 0) };
    const result = applyEditAction(source, before.semantic.editHandles, action);
    expect(result.kind).toBe("unsupported");
  });

  it("rejects a singular frame without changing the expression", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=0]${prefix}\node at ($(C)+(.33,.11)$) {Label};\end{tikzpicture}`;
    const before = render(source);
    const handle = before.semantic.editHandles.find(h => h.coordinateForm === "calc")!;
    const result = applyEditAction(source, before.semantic.editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: wp(10,10) });
    expect(result.kind).toBe("unsupported");
  });

  it("registers partial calc editing support", () => {
    expect(editFeatureRegistry).toContain("calc_coordinates");
  });
});
