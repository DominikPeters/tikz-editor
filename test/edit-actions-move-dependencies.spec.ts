import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEditAction, type EditAction, type EditActionResult } from "../packages/core/src/edit/actions.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { applyMatrix } from "../packages/core/src/semantic/transform.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { editorReducer, makeInitialState } from "../packages/app/src/store/reducer.js";
import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import type { WorldPoint } from "../packages/core/src/coords/points.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

function evaluate(source: string) {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
  return { parsed, semantic: evaluator.evaluateTikzFigure(parsed.figure, source) };
}

function pathPoints(source: string): WorldPoint[][] {
  return evaluate(source).semantic.scene.elements.flatMap(path => {
    if (path.kind !== "Path") return [];
    return [path.commands.flatMap(command => {
      const points = command.kind === "M" || command.kind === "L" ? [command.to]
        : command.kind === "C" ? [command.c1, command.c2, command.to] : [];
      return points.map(point => path.transform ? applyMatrix(path.transform, point) : point);
    })];
  });
}

function success(result: EditActionResult): Extract<EditActionResult, { kind: "success" }> {
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  return result;
}

function expectTranslation(before: readonly WorldPoint[], after: readonly WorldPoint[], delta: WorldPoint, tolerance = .15) {
  expect(after).toHaveLength(before.length);
  for (let index = 0; index < before.length; index++) {
    expect(Math.abs(after[index].x - before[index].x - delta.x)).toBeLessThan(tolerance);
    expect(Math.abs(after[index].y - before[index].y - delta.y)).toBeLessThan(tolerance);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("dependency-aware element translation", () => {
  it.each([
    "(0,0) -- ++(1,0) -- ++(0,1) -- ++(-1,0)",
    "(0,0) -- +(1,0) -- +(1,1) -- +(0,1)",
    "(0,0) -- ++(1,0) -- +(0,1) -- ++(1,0) -- (5,1) -- ++(0,2)",
    "(1,0) .. controls +(30:1cm) and +(60:1cm) .. (3,-1)",
    "(1,0) .. controls ++(1,1) and ++(-1,1) .. ++(3,-1) -- ++(1,1)",
    "(1,0) .. controls +(1,1) and +(-1,1) .. +(3,-1) -- ++(1,1)",
    "(1,0) -- ++(1,1) .. controls +(1,0) and +(-1,0) .. cycle",
    "(0.000cm,0.000cm) -- ++(12.345pt,0pt) -- +(0pt,12.345pt) -- ++(0.123456cm,0.654321cm)"
  ])("preserves every endpoint and Bezier control's displacement: %s", body => {
    const source = `\\begin{tikzpicture}\\draw ${body};\\end{tikzpicture}`;
    const before = pathPoints(source)[0];
    const { semantic } = evaluate(source);
    const delta = wp(10, -10);
    const result = success(applyEditAction(source, semantic.editHandles, { kind: "moveElement", elementId: "path:0", delta }));
    expectPatchesReconstructSource(source, result);
    expectTranslation(before, pathPoints(result.newSource)[0], delta);
    expect(result.newSource.match(/\+\+?\([^)]*\)/g)).toEqual(source.match(/\+\+?\([^)]*\)/g));
  });

  it.each([false, true])("uses the PGF endpoint base for the second relative Bezier control, including individual edits (parent transform: %s)", transformed => {
    const path = String.raw`\draw (1,0) .. controls +(1,1) and +(-1,1) .. ++(3,-1);`;
    const source = String.raw`\begin{tikzpicture}` + (transformed ? String.raw`\begin{scope}[xscale=2,yscale=3]` : "")
      + path + (transformed ? String.raw`\end{scope}` : "") + String.raw`\end{tikzpicture}`;
    const { semantic } = evaluate(source);
    const controls = semantic.editHandles.filter(handle => handle.kind === "path-control");
    expect(controls.map(handle => [handle.world.x / cm(1), handle.world.y / cm(1)])).toEqual(transformed ? [[4, 3], [6, 0]] : [[2, 1], [3, 0]]);
    const result = success(applyEditAction(source, semantic.editHandles, {
      kind: "moveHandle", handleId: controls[1].id, newWorld: wp(controls[1].world.x, controls[1].world.y + cm(transformed ? 3 : 1))
    }));
    const before = pathPoints(source)[0], after = pathPoints(result.newSource)[0];
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect(after[3]).toEqual(before[3]);
    expectTranslation([before[2]], [after[2]], wp(0, cm(transformed ? 3 : 1)), 1e-6);
  });

  it("preserves the original base for an individual relative endpoint edit", () => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- ++(1,0);\end{tikzpicture}`;
    const { semantic } = evaluate(source), handle = semantic.editHandles[1];
    const result = success(applyEditAction(source, semantic.editHandles, {
      kind: "moveHandle", handleId: handle.id, newWorld: wp(handle.world.x + cm(1), handle.world.y)
    }));
    const before = pathPoints(source)[0], after = pathPoints(result.newSource)[0];
    expect(after[0]).toEqual(before[0]);
    expectTranslation([before[1]], [after[1]], wp(cm(1), 0), 1e-6);
  });

  it.each([
    ["base and positioning chain", ["path:0", "path:1", "path:2"]],
    ["positioning dependents alone", ["path:1", "path:2"]],
    ["unselected positioning intermediate", ["path:0", "path:2"]]
  ])("moves each named dependency once: %s", (_label, elementIds) => {
    const source = String.raw`\begin{tikzpicture}
\node[draw] (A) at (0,0) {};
\node[draw,right=1.000cm of A] (B) {};
\node[draw,above=1.000cm of B] (C) {};
\end{tikzpicture}`;
    const { semantic } = evaluate(source);
    const before = semantic.editHandles.filter(handle => handle.kind === "node-position");
    const result = success(applyEditAction(source, semantic.editHandles, {
      kind: "moveElements", elementIds, delta: wp(cm(1), cm(1))
    }));
    const after = evaluate(result.newSource).semantic.editHandles;
    for (const handle of before) {
      const moves = elementIds.includes(handle.sourceRef.sourceId) || elementIds.includes("path:0");
      const moved = after.find(candidate => candidate.id === handle.id)!;
      expectTranslation([handle.world], [moved.world], moves ? wp(cm(1), cm(1)) : wp(0, 0));
    }
    if (elementIds.includes("path:0")) expect(result.newSource).toContain("right=1.000cm of A");
    expect(result.newSource).toContain("above=1.000cm of B");
  });

  it("combines calc bases, relative endpoints and endpoint-relative controls", () => {
    const source = String.raw`\begin{tikzpicture}
\coordinate (A) at (0,0);
\draw ($(A)+(1,0)$) .. controls +(1,1) and +(-1,1) .. ($(A)+(4,-1)$) -- ++(1,0);
\end{tikzpicture}`;
    const before = pathPoints(source)[0], { semantic } = evaluate(source), delta = wp(cm(1), cm(2));
    const result = success(applyEditAction(source, semantic.editHandles, {
      kind: "moveElements", elementIds: ["path:0", "path:1"], delta
    }));
    expectTranslation(before, pathPoints(result.newSource)[0], delta, 1e-6);
  });

  it("preserves offsets through inherited rotation and nonuniform scale", () => {
    const source = String.raw`\begin{tikzpicture}
\begin{scope}[rotate=30,xscale=2,yscale=3]
\draw (0,0) -- ++(1,0) -- +(0,1) -- ++(1,1);
\end{scope}\end{tikzpicture}`;
    const before = pathPoints(source)[0], { semantic } = evaluate(source), delta = wp(cm(1), cm(2));
    const result = success(applyEditAction(source, semantic.editHandles, { kind: "moveElement", elementId: "path:1", delta }));
    const after = pathPoints(result.newSource)[0];
    // Only the absolute base needs coordinate formatting. Every dependent
    // receives exactly the same effective displacement in the authored frame.
    const effective = wp(after[0].x - before[0].x, after[0].y - before[0].y);
    expectTranslation(before, after, effective, 1e-6);
    expect(Math.abs(effective.x - delta.x)).toBeLessThan(.5);
    expect(Math.abs(effective.y - delta.y)).toBeLessThan(.5);
  });

  it("keeps a long precise relative chain unchanged across baseline drag frames with bounded replay", () => {
    const offsets = Array.from({ length: 180 }, (_, index) => index % 3 === 0
      ? "-- +(0.123456cm,12.345pt)" : "-- ++(0.654321cm,0.000cm)").join(" ");
    const source = `\\begin{tikzpicture}\\coordinate (A) at (0,0);\\draw (0.000cm,0.000cm) ${offsets};
\\node at (10,10) {Unrelated suffix};\\end{tikzpicture}`;
    const { parsed, semantic } = evaluate(source);
    const geometry = createEditGeometrySession({ source, parsed, semantic });
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    const statementEvaluate = vi.spyOn(evaluator, "evaluateSemanticStatementByIndex");
    let current = source;
    for (const delta of [wp(10, 20), wp(-7, 13), wp(cm(1), cm(2)), wp(0, 0)]) {
      const result = success(applyEditAction(current, [], {
        kind: "moveElements", elementIds: ["path:1"], delta,
        baseline: { source, editHandles: semantic.editHandles }
      }, { geometry }));
      expectPatchesReconstructSource(current, result);
      expect(result.newSource).toContain(offsets);
      current = result.newSource;
    }
    expect(current).toBe(source);
    expect(fullEvaluate).not.toHaveBeenCalled();
    expect(statementEvaluate.mock.calls.filter(([, index]) => index === 0)).toHaveLength(1);
    expect(statementEvaluate.mock.calls.filter(([, index]) => index === 1)).toHaveLength(4);
    expect(statementEvaluate.mock.calls.every(([, index]) => index <= 1)).toBe(true);
  });
});

describe("arrange dependency planning", () => {
  it.each(["+", "++"])("aligns relative %s paths without changing their shape", prefix => {
    const source = `\\begin{tikzpicture}\\draw (0,0)--(1,0);\\draw (4,2)--${prefix}(1,0)--${prefix}(0,1);\\end{tikzpicture}`;
    const before = pathPoints(source);
    const result = success(applyEditAction(source, [], { kind: "alignElements", elementIds: ["path:0", "path:1"], mode: "left" }));
    const after = pathPoints(result.newSource);
    expectTranslation(before[0], after[0], wp(0, 0), 1e-6);
    expectTranslation(before[1], after[1], wp(-cm(4), 0), 1e-6);
  });

  it("distributes a relative chain using the same dependency planner", () => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0)--(1,0);\draw (2,0)--++(1,0);\draw (10,0)--++(1,0);\end{tikzpicture}`;
    const before = pathPoints(source);
    const result = success(applyEditAction(source, [], {
      kind: "distributeElements", elementIds: ["path:0", "path:1", "path:2"], axis: "horizontal"
    }));
    const after = pathPoints(result.newSource);
    expectTranslation(before[0], after[0], wp(0, 0), 1e-6);
    expectTranslation(before[1], after[1], wp(cm(3), 0), 1e-6);
    expectTranslation(before[2], after[2], wp(0, 0), 1e-6);
  });

  it("keeps a positioning dependent at its planned position when its selected base receives a different delta", () => {
    const source = String.raw`\begin{tikzpicture}
\node[draw,inner sep=0,outer sep=0,minimum width=1cm] (A) at (0,0) {};
\node[draw,inner sep=0,outer sep=0,minimum width=1cm,right=1cm of A] (B) {};
\end{tikzpicture}`;
    const before = evaluate(source).semantic.editHandles.filter(handle => handle.kind === "node-position");
    const result = success(applyEditAction(source, [], { kind: "alignElements", elementIds: ["path:0", "path:1"], mode: "right" }));
    const after = evaluate(result.newSource).semantic.editHandles.filter(handle => handle.kind === "node-position");
    expectTranslation([before[0].world], [after[0].world], wp(cm(2), 0), 1e-6);
    expectTranslation([before[1].world], [after[1].world], wp(0, 0), 1e-6);
  });
});

const overlapSource = String.raw`\begin{tikzpicture}
\begin{scope}\begin{scope}\draw (0,0) rectangle (1,1);\node at (2,0) {};\end{scope}\end{scope}
\draw (4,0) rectangle (5,1);
\end{tikzpicture}`;

describe("overlapping movement selections", () => {
  it.each([
    ["scope and leaf", ["scope:0", "path:2"]],
    ["leaf and scope in reverse selection order", ["path:2", "scope:0"]],
    ["outer and nested scope", ["scope:0", "scope:1"]],
    ["scope and node", ["scope:0", "path:3"]],
    ["nested, leaf, duplicates and outer scope", ["scope:1", "path:2", "scope:0", "scope:0"]],
    ["disjoint scope and path", ["scope:0", "path:4"]]
  ])("moves selected descendants exactly once: %s", (_label, elementIds) => {
    const before = pathPoints(overlapSource), { semantic } = evaluate(overlapSource), delta = wp(10, -10);
    const result = success(applyEditAction(overlapSource, semantic.editHandles, { kind: "moveElements", elementIds, delta }));
    expectPatchesReconstructSource(overlapSource, result);
    expectTranslation(before[0], pathPoints(result.newSource)[0], delta, 1e-6);
    expectTranslation(before[1], pathPoints(result.newSource)[1], elementIds.includes("path:4") ? delta : wp(0, 0));
    const beforeNode = semantic.editHandles.find(handle => handle.sourceRef.sourceId === "path:3")!;
    const afterNode = evaluate(result.newSource).semantic.editHandles.find(handle => handle.sourceRef.sourceId === "path:3")!;
    expectTranslation([beforeNode.world], [afterNode.world], delta, 1e-6);
    expect(new Set(result.changedSourceIds)).toEqual(new Set(elementIds.includes("path:4")
      ? ["scope:0", "scope:1", "path:2", "path:3", "path:4"] : ["scope:0", "scope:1", "path:2", "path:3"]));
    expect(result.newSource).toContain("\\draw (0,0) rectangle (1,1)");
  });

  it("includes inline node targets in the ancestor cover and changed ids", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}\draw (0,0)--(1,0) node[above=1cm] (N) {};\end{scope}\end{tikzpicture}`;
    const { semantic } = evaluate(source);
    const node = semantic.editHandles.find(handle => handle.kind === "node-position")!;
    const result = success(applyEditAction(source, semantic.editHandles, {
      kind: "moveElements", elementIds: ["scope:0", node.sourceRef.sourceId], delta: wp(10, 0)
    }));
    expect(result.changedSourceIds).toContain(node.sourceRef.sourceId);
    expect(result.newSource).toContain("\\draw (0,0)--(1,0) node[above=1cm] (N) {}");
  });

  it("safely refuses shared macro coordinate spans", () => {
    const source = String.raw`\newcommand{\piece}{\draw (0,0)--++(1,0);}\begin{tikzpicture}\piece\piece\end{tikzpicture}`;
    const { semantic } = evaluate(source);
    expect(semantic.editHandles.length).toBeGreaterThan(2);
    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElements", elementIds: [semantic.editHandles[0].sourceRef.sourceId], delta: wp(10, 0)
    });
    expect(result.kind).toBe("unsupported");
  });

  it.each([
    [String.raw`\foreach \i in {0,1} {\draw (\i,0)--++(1,0);}`, 10],
    [String.raw`\foreach \i in {0,1} {\draw (\i,0)--++(1,0);}`, 10.49],
    [String.raw`\foreach \i in {0,1} {\draw (\i,0)--(2,0);}`, 10.49],
    [String.raw`\piece\piece`, 10],
    [String.raw`\piece\piece`, 10.49]
  ])("carries generated paths by their selected scope without rewriting shared coordinates: %s, %spt", (body, delta) => {
    const source = String.raw`\newcommand{\piece}{\draw (0,0)--++(1,0);}\begin{tikzpicture}\begin{scope}`
      + body + String.raw`\end{scope}\end{tikzpicture}`;
    const before = pathPoints(source), { semantic } = evaluate(source);
    expect(before).toHaveLength(2);
    const result = success(applyEditAction(source, semantic.editHandles, { kind: "moveElement", elementId: "scope:0", delta: wp(delta, 0) }));
    const after = pathPoints(result.newSource);
    before.forEach((points, index) => expectTranslation(points, after[index], wp(10, 0), 1e-6));
    expect(result.newSource).toContain(body);
  });

  it("uses the effective rounded scope displacement for mixed absolute and relative points", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[scale=2]\draw (0,0)--++(1,0)--(3,1)--+(1,0);\end{scope}\end{tikzpicture}`;
    const before = pathPoints(source)[0], { semantic } = evaluate(source);
    const result = success(applyEditAction(source, semantic.editHandles, { kind: "moveElements", elementIds: ["scope:0", "path:1"], delta: wp(10.49, 0) }));
    // The scope writer rounds its 5.245pt local shift to 5pt, which the scale
    // turns into a 10pt world displacement shared by every child point.
    expectTranslation(before, pathPoints(result.newSource)[0], wp(10, 0), 1e-6);
    expect(result.newSource).toContain("\\draw (0,0)--++(1,0)--(3,1)--+(1,0)");
  });

  it("corrects named dependencies outside a moved scope against its effective shift", () => {
    const source = String.raw`\begin{tikzpicture}\node (A) at(0,0) {};\begin{scope}
\node[right=1cm of A](B) {};
\draw ($(A)+(1,2)$)--++(1,0);
\end{scope}\end{tikzpicture}`;
    const { semantic } = evaluate(source), before = pathPoints(source)[0];
    const result = success(applyEditAction(source, semantic.editHandles, { kind: "moveElement", elementId: "scope:1", delta: wp(10.49, 0) }));
    const after = evaluate(result.newSource).semantic.editHandles;
    const originalBase = semantic.editHandles.find(handle => handle.sourceRef.sourceId === "path:0")!;
    expect(after.find(handle => handle.id === originalBase.id)!.world).toEqual(originalBase.world);
    const originalNode = semantic.editHandles.find(handle => handle.handleType === "node-positioning")!;
    expectTranslation([originalNode.world], [after.find(handle => handle.id === originalNode.id)!.world], wp(10, 0));
    expectTranslation(before, pathPoints(result.newSource)[0], wp(10, 0));
    const points = pathPoints(result.newSource)[0];
    expect(points[1].x - points[0].x).toBeCloseTo(cm(1), 6);
  });

  it("retains hydrated editing identities and the overlapping selection after recompute", () => {
    const ready = (state: ReturnType<typeof makeInitialState>) => {
      const rendered = renderTikzToSvg(state.source);
      state = editorReducer(state, { type: "COMPUTE_REQUESTED", requestId: "move-ready" });
      return editorReducer(state, { type: "SNAPSHOT_READY", requestId: "move-ready", snapshot: {
        ...makeEmptySnapshot(state.source), parseResult: rendered.parse, semanticResult: rendered.semantic,
        activeRootId: rendered.parse.activeFigureId, figures: rendered.parse.figures,
        scene: rendered.semantic.scene, editHandles: rendered.semantic.editHandles, svg: rendered.svg
      } });
    };
    let state = ready(editorReducer(makeInitialState(), { type: "CODE_EDITED", source: overlapSource }));
    const beforeIdentities = state.snapshot.editHandles.map(handle => [handle.id, handle.editingId]);
    expect(beforeIdentities.every(([, editingId]) => typeof editingId === "string")).toBe(true);
    state = editorReducer(state, { type: "SELECT_RANGE", ids: ["scope:0", "path:2"] });
    const selection = [...state.selectedElementIds];
    const action: EditAction = { kind: "moveElements", elementIds: selection, delta: wp(10, 0) };
    state = editorReducer(state, { type: "APPLY_EDIT_ACTION", action });
    expectTranslation(pathPoints(overlapSource)[0], pathPoints(state.source)[0], wp(10, 0), 1e-6);
    state = ready(state);
    expect([...state.selectedElementIds]).toEqual(selection);
    expect(state.snapshot.editHandles.map(handle => [handle.id, handle.editingId])).toEqual(beforeIdentities);
  });
});
