import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type EditAction } from "../packages/core/src/edit/actions.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/index.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

function prepare(body: string) {
  const source = `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const semantic = evaluator.evaluateTikzFigure(parsed.figure, source);
  return createEditGeometrySession({ source, parsed, semantic }, {}, { propertyWriteMode: "drag-frame" });
}

afterEach(() => vi.restoreAllMocks());

describe("prepared edit geometry", () => {
  it.each([
    String.raw`\node[draw,minimum width=2cm,minimum height=1cm] {Hello};`,
    String.raw`\node[draw,circle,minimum size=2cm] {Hello};`,
    String.raw`\node[draw,diamond,minimum width=2cm] {Hello};`,
    String.raw`\node[draw,text width=2cm] {Some text in a box};`,
    String.raw`\begin{scope}[rotate=30,scale=2,transform shape]\node[draw,minimum width=2cm] {Hello};\end{scope}`,
    String.raw`\coordinate (origin) at (2,1);\tikzset{box/.style={draw,minimum width=2cm}}\node[box] at (origin) {Hello};`
  ])("node resize measures only its containing statement: %s", body => {
    const geometry = prepare(`${body}\n\\draw (10,10) rectangle (11,11);`);
    const elementId = geometry.semantic.editHandles.find(handle => handle.kind === "node-position")!.sourceRef.sourceId;
    geometry.prepare(elementId);
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    const statementEvaluate = vi.spyOn(evaluator, "evaluateSemanticStatementByIndex");
    let current = geometry.source;
    for (const [x, y] of [[3, 2], [3.4, 2.3], [1.6, 1.2]]) {
      const action: EditAction = { kind: "resizeElement", elementId, role: "top-right", newWorld: wp(cm(x), cm(y)) };
      fullEvaluate.mockClear(); statementEvaluate.mockClear();
      const actual = applyEditAction(current, [], action, { geometry, parseOptions: { propertyWriteMode: "drag-frame" } });
      expect(actual.kind).toBe("success");
      expect(fullEvaluate).not.toHaveBeenCalled();
      expect(new Set(statementEvaluate.mock.calls.map(([, index]) => index)).size).toBeLessThanOrEqual(1);
      const expected = applyEditAction(geometry.source, geometry.semantic.editHandles, action, { parseOptions: { propertyWriteMode: "drag-frame" } });
      if (actual.kind !== "success") throw new Error(JSON.stringify(actual));
      if (expected.kind === "unsupported" && expected.reason === "Resize would not change node constraints.") {
        expect(actual.newSource).toBe(geometry.source);
      } else {
        if (expected.kind !== "success") throw new Error(JSON.stringify(expected));
        expect(actual.newSource).toBe(expected.newSource);
      }
      expectPatchesReconstructSource(current, actual);
      const measured = collectSourceWorldBounds(geometry.measure(actual.newSource, elementId)).get(elementId);
      const complete = evaluator.evaluateTikzFigure(parseTikz(actual.newSource).figure, actual.newSource);
      expect(measured).toEqual(collectSourceWorldBounds(complete.scene.elements).get(elementId));
      current = actual.newSource;
    }
  });

  it.each([
    String.raw`\draw (1,1) circle (1cm);`,
    String.raw`\draw[rotate=30] (1,1) ellipse (1cm and .5cm);`,
    String.raw`\begin{scope}[xshift=1cm]\draw (0,0) rectangle (2,1);\end{scope}`
  ])("direct resize reuses the rendered geometry: %s", body => {
    const geometry = prepare(body);
    const elementId = geometry.parsed.figure.body[0].id;
    const action: EditAction = { kind: "resizeElement", elementId, role: "top-right", newWorld: wp(cm(4), cm(3)) };
    const expected = applyEditAction(geometry.source, geometry.semantic.editHandles, action);
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    const actual = applyEditAction(geometry.source, [], action, { geometry });
    expect(actual).toEqual(expected);
    expect(fullEvaluate).not.toHaveBeenCalled();
  });

  it.each([
    String.raw`\matrix {\node {A}; & \node {B}; \\};`,
    String.raw`\node[draw] {Root} child {node {Child}};`,
    String.raw`\matrix at (1,1) {\node {A}; \\};\matrix at (4,1) {\node {B}; \\};`
  ])("matrix/tree movement never reevaluates and restores its original placement: %s", body => {
    const geometry = prepare(body);
    const elementIds = geometry.parsed.figure.body.map(statement => statement.id);
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    let source = geometry.source;
    for (const delta of [wp(cm(.123), cm(.987)), wp(cm(2), cm(1)), wp(0, 0)]) {
      const result = applyEditAction(source, [], { kind: "moveElements", elementIds, delta,
        baseline: { source: geometry.source, editHandles: geometry.semantic.editHandles } }, { geometry });
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      expectPatchesReconstructSource(source, result);
      source = result.newSource;
    }
    expect(source).toBe(geometry.source);
    expect(fullEvaluate).not.toHaveBeenCalled();
  });

  it("center rotation reuses the starting snapshot", () => {
    const geometry = prepare(String.raw`\draw[rotate=15] (0,0) rectangle (2,1);`);
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    let source = geometry.source;
    for (const angleDeg of [30, 50, 75]) {
      const result = applyEditAction(source, [], { kind: "rotateElement", elementId: "path:0", mode: "center-pivot", angleDeg,
        baselineSource: geometry.source }, { geometry, parseOptions: { propertyWriteMode: "drag-frame" } });
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      expectPatchesReconstructSource(source, result);
      source = result.newSource;
    }
    expect(fullEvaluate).not.toHaveBeenCalled();
  });

  it("handle rewrites use baseline handles while current rendering is pending", () => {
    const geometry = prepare(String.raw`\draw (0,0) -- ++(1.00000,1.00000);`);
    const handle = geometry.semantic.editHandles[1];
    let source = geometry.source;
    for (const newWorld of [wp(cm(12.5), cm(3.4)), wp(cm(2.5), cm(1.5)), handle.world]) {
      const result = applyEditAction(source, [], { kind: "moveHandle", handleId: handle.id, newWorld }, { geometry });
      if (result.kind !== "success") throw new Error(JSON.stringify(result));
      expectPatchesReconstructSource(source, result);
      source = result.newSource;
    }
    expect(source).toBe(geometry.source);
  });
});

describe("geometry reuse for menu operations", () => {
  it.each([
    { kind: "alignElements", elementIds: ["path:0", "path:1"], mode: "left" },
    { kind: "distributeElements", elementIds: ["path:0", "path:1", "path:2"], axis: "x" },
    { kind: "groupElements", elementIds: ["path:0", "path:1"] }
  ] as EditAction[])("reuses the snapshot for $kind", action => {
    const geometry = prepare(String.raw`\draw (0,0) rectangle (1,1);\draw (2,3) rectangle (3,4);\draw (7,0) rectangle (8,1);`);
    const expected = applyEditAction(geometry.source, geometry.semantic.editHandles, action);
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    const result = applyEditAction(geometry.source, [], action, { geometry });
    expect(result).toEqual(expected);
    expect(fullEvaluate).not.toHaveBeenCalled();
  });

  it("allows circle side handles to shrink the radius", () => {
    const geometry = prepare(String.raw`\draw (0,0) circle (2cm);`);
    const result = applyEditAction(geometry.source, [], { kind: "resizeElement", elementId: "path:0", role: "right", newWorld: wp(cm(1), 0) }, { geometry });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expect(result.newSource).toContain("circle (1cm)");
  });
});

it("Ctrl/Meta bypasses the hidden cardinal attraction of relatively positioned nodes", () => {
  const geometry = prepare(String.raw`\node[draw] (a) at (0,0) {};\node[draw,right=2cm of a] (b) {};`);
  const handle = geometry.semantic.editHandles.find(handle => handle.handleType === "node-positioning")!;
  const requested = wp(handle.world.x + cm(1), handle.world.y + cm(.1));
  const result = applyEditAction(geometry.source, [], { kind: "moveHandle", handleId: handle.id, newWorld: requested, bypassSnapping: true }, { geometry });
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  const actual = evaluator.evaluateTikzFigure(parseTikz(result.newSource).figure, result.newSource).editHandles.find(candidate => candidate.sourceRef.sourceId === handle.sourceRef.sourceId && candidate.kind === handle.kind)!;
  expect(Math.abs(actual.world.y - requested.y)).toBeLessThan(cm(.01));
});

it.each([30, 45, 90])("resizes a rotated node using its local dimensions (%s degrees)", angle => {
  const geometry = prepare(`\\node[draw,rotate=${angle},inner sep=0,minimum width=2cm,minimum height=1cm] {};`);
  const radians = angle * Math.PI / 180;
  const local = { x: cm(2), y: cm(1.5) };
  const pointer = wp(local.x * Math.cos(radians) - local.y * Math.sin(radians), local.x * Math.sin(radians) + local.y * Math.cos(radians));
  const result = applyEditAction(geometry.source, [], { kind: "resizeElement", elementId: "path:0", role: "top-right", newWorld: pointer, formatPrecision: "snapped" }, { geometry });
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  expect(result.newSource).toContain("minimum width=113.8110236pt");
  expect(result.newSource).toContain("minimum height=85.3582677pt");
});

it("restores authored node dimensions when a resize returns to its initial size", () => {
  const geometry = prepare(String.raw`\node[draw,inner sep=0,minimum width=2.000cm,minimum height=1.000cm] {};`);
  let source = geometry.source;
  for (const point of [wp(cm(2), cm(1.5)), wp(cm(1), cm(.5))]) {
    const result = applyEditAction(source, [], { kind: "resizeElement", elementId: "path:0", role: "top-right", newWorld: point }, { geometry });
    if (result.kind !== "success") throw new Error(JSON.stringify(result));
    expectPatchesReconstructSource(source, result);
    source = result.newSource;
  }
  expect(source).toBe(geometry.source);
});
