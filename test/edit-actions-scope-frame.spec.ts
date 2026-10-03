import { afterEach, describe, expect, it, vi } from "vitest";
import { applyEditAction, type EditActionResult } from "../packages/core/src/edit/actions.js";
import * as parser from "../packages/core/src/parser/index.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { applyMatrix, inverseMatrix } from "../packages/core/src/semantic/transform.js";
import { worldTransform } from "../packages/core/src/coords/transforms.js";
import { pt, worldBounds } from "../packages/core/src/coords/index.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { resolveStatementParentFrame } from "../packages/core/src/edit/parent-frame.js";
import { resolveTransformInspectorMutationContext } from "../packages/core/src/edit/property-write-builders.js";
import { collectSourceWorldBounds } from "../packages/core/src/edit/snapping/index.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

function evaluate(source: string) {
  const parsed = parser.parseTikz(source, { recover: true, includeContextDefinitions: true });
  return { source, parsed, semantic: evaluator.evaluateTikzFigure(parsed.figure, source) };
}
function success(result: EditActionResult) {
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  return result;
}
function prepare(parent: string, own = "", picture = "", body = String.raw`\draw (1,1) rectangle (3,2);`) {
  const snapshot = evaluate(String.raw`\begin{tikzpicture}[${picture}]\begin{scope}[${parent}]\begin{scope}[${own}]${body}\end{scope}\end{scope}\end{tikzpicture}`);
  const outer = snapshot.parsed.figure.body.find(statement => statement.kind === "Scope")!;
  if (outer.kind !== "Scope") throw new Error("Expected outer scope");
  const inner = outer.body.find(statement => statement.kind === "Scope")!;
  const scopeId = inner.id;
  const parentFrame = resolveStatementParentFrame(snapshot.source, scopeId)!;
  const frame = worldTransform(parentFrame.a, parentFrame.b, parentFrame.c, parentFrame.d, parentFrame.e, parentFrame.f);
  const inverse = inverseMatrix(frame)!;
  return { ...snapshot, scopeId, frame, inverse };
}
function localBounds(snapshot: ReturnType<typeof prepare>, source = snapshot.source) {
  const elements = source === snapshot.source ? snapshot.semantic.scene.elements : evaluate(source).semantic.scene.elements;
  const bounds = [...collectSourceWorldBounds(elements, snapshot.inverse).values()][0];
  if (!bounds) throw new Error("Expected geometry bounds");
  return bounds;
}
function points(source: string) { return evaluate(source).semantic.editHandles.filter(handle => handle.kind === "path-point").map(handle => handle.world); }
afterEach(() => vi.restoreAllMocks());

describe("scope movement in actual ordered frames", () => {
  it.each([
    ["identity", "", "", ""],
    ["picture scale", "", "", "scale=2"],
    ["inherited rotate/shear", "rotate=30,cm={1,.2,.4,1,(3pt,4pt)}", "", ""],
    ["shift before own scale", "xscale=2,yscale=3", "shift={(4pt,5pt)},scale=2", ""],
    ["shift after own scale", "rotate=60", "scale=2,shift={(4pt,5pt)}", ""],
    ["axis shifts on different prefixes", "rotate=30", "xshift=4pt,rotate=20,yscale=3,yshift=5pt", ""],
    ["resolved own style", "rotate=30", "own", "own/.style={xscale=2,yscale=3,shift={(4pt,5pt)}}"],
    ["background final style", "rotate=30", "on background layer", "every on background layer/.style={xscale=2,yscale=3}"]
  ])("moves every point by the world delta: %s", (_label, parent, own, picture) => {
    const snapshot = prepare(parent, own, picture, String.raw`\draw (1,1)--++(2,0)--++(0,1);`);
    const before = points(snapshot.source), delta = wp(10, -6);
    const result = success(applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "moveElement", elementId: snapshot.scopeId, delta, formatPrecision: "snapped"
    }));
    expectPatchesReconstructSource(snapshot.source, result);
    const after = points(result.newSource);
    before.forEach((point, index) => {
      expect(after[index].x - point.x).toBeCloseTo(delta.x, 5);
      expect(after[index].y - point.y).toBeCloseTo(delta.y, 5);
    });
    expect(result.newSource.match(/\+\+\([^)]*\)/g)).toEqual(snapshot.source.match(/\+\+\([^)]*\)/g));
    if (own.startsWith("shift=")) expect(result.newSource.indexOf("shift=")).toBeLessThan(result.newSource.lastIndexOf("scale=2"));
    if (own.startsWith("scale=")) expect(result.newSource.lastIndexOf("scale=2")).toBeLessThan(result.newSource.indexOf("shift="));
  });

  it("preserves an unchanged literal shift component during a perpendicular move", () => {
    const snapshot = prepare("", "shift={(1cm,2cm)}");
    const result = success(applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "moveElement", elementId: snapshot.scopeId, delta: wp(0, 10)
    }));
    expect(result.newSource).toMatch(/shift=\{?\(1cm,/);
    const before = points(snapshot.source), after = points(result.newSource);
    before.forEach((point, index) => expect(after[index].x).toBeCloseTo(point.x, 8));
  });

  it("keeps generated scope descendants safe through the inherited frame", () => {
    const snapshot = prepare("rotate=30,xscale=2", "", "", String.raw`\foreach \i in {0,1} {\draw (\i,0)--++(1,0);}`);
    const before = points(snapshot.source), delta = wp(10, 6);
    const result = success(applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "moveElement", elementId: snapshot.scopeId, delta, formatPrecision: "snapped"
    }));
    const after = points(result.newSource);
    before.forEach((point, index) => {
      expect(after[index].x - point.x).toBeCloseTo(delta.x, 5);
      expect(after[index].y - point.y).toBeCloseTo(delta.y, 5);
    });
    expect(result.newSource).toContain(String.raw`\foreach \i in {0,1} {\draw (\i,0)--++(1,0);}`);
  });
});

describe("scope resize fixed anchors and ordered transforms", () => {
  it.each([
    ["identity", "", "", ""],
    ["parent translation", "xshift=1cm,yshift=-2cm", "", ""],
    ["parent anisotropic scale", "xscale=2,yscale=3", "", ""],
    ["parent rotation", "rotate=30", "", ""],
    ["parent shear", "cm={1,.2,.4,1,(3pt,4pt)}", "", ""],
    ["shift before scale", "rotate=30", "shift={(4pt,5pt)},xscale=1.2", ""],
    ["shift after scale", "cm={1,.2,.4,1,(0,0)}", "xscale=1.2,shift={(4pt,5pt)}", ""],
    ["retained own cm", "rotate=30", "cm={2,0,0,3,(4pt,5pt)}", ""],
    ["named own diagonal style", "rotate=30", "own", "own/.style={xscale=2,yscale=3,yshift=3pt}"],
    ["background final transform", "rotate=30", "on background layer", "every on background layer/.style={xscale=2,yscale=3}"]
  ])("doubles width and keeps the full left edge: %s", (_label, parent, own, picture) => {
    const snapshot = prepare(parent, own, picture), before = localBounds(snapshot);
    const result = success(applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "resizeElement", elementId: snapshot.scopeId, role: "right", formatPrecision: "snapped",
      newWorld: applyMatrix(snapshot.frame, wp(before.maxX + before.maxX - before.minX, (before.minY + before.maxY) / 2))
    }));
    expectPatchesReconstructSource(snapshot.source, result);
    const after = localBounds(snapshot, result.newSource);
    expect(after.minX).toBeCloseTo(before.minX, 5);
    expect(after.minY).toBeCloseTo(before.minY, 5);
    expect(after.maxY).toBeCloseTo(before.maxY, 5);
    expect(after.maxX - after.minX).toBeCloseTo(2 * (before.maxX - before.minX), 5);
    if (own.startsWith("shift=")) expect(result.newSource.indexOf("shift=")).toBeLessThan(result.newSource.lastIndexOf("xscale="));
    if (own.startsWith("xscale=")) expect(result.newSource.lastIndexOf("xscale=")).toBeLessThan(result.newSource.indexOf("shift="));
    if (own.startsWith("cm=")) expect(result.newSource).toContain(own);
    if (own === "own") expect(result.newSource).toContain("[own,");
  });

  it.each([
    String.raw`\draw (1,1) circle (.6cm);`,
    String.raw`\draw[rotate=25] (1,1) ellipse (.8cm and .4cm);`,
    String.raw`\draw (1,1)..controls (1,3) and (3,3)..(3,1);`,
    String.raw`\draw (2,1) arc (0:220:1cm);`
  ])("keeps tight curved bounds under a sheared parent: %s", body => {
    const snapshot = prepare("rotate=30,cm={1,.2,.4,1,(3pt,4pt)}", "", "", body);
    const control = prepare("", "", "", body), before = localBounds(snapshot), plain = localBounds(control);
    for (const key of ["minX", "minY", "maxX", "maxY"] as const) expect(before[key]).toBeCloseTo(plain[key], 7);
    const result = success(applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "resizeElement", elementId: snapshot.scopeId, role: "right", formatPrecision: "snapped",
      newWorld: applyMatrix(snapshot.frame, wp(before.maxX + before.maxX - before.minX, (before.minY + before.maxY) / 2))
    }));
    const after = localBounds(snapshot, result.newSource);
    expect(after.minX).toBeCloseTo(before.minX, 5);
    expect(after.minY).toBeCloseTo(before.minY, 5);
    expect(after.maxY).toBeCloseTo(before.maxY, 5);
    expect(after.maxX - after.minX).toBeCloseTo(2 * (before.maxX - before.minX), 5);
  });

  it("preserves an unchanged authored shift axis during an edge resize", () => {
    const snapshot = prepare("rotate=30", "xshift=1cm,yshift=5pt"), before = localBounds(snapshot);
    const result = success(applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "resizeElement", elementId: snapshot.scopeId, role: "top", formatPrecision: "snapped",
      newWorld: applyMatrix(snapshot.frame, wp((before.minX + before.maxX) / 2, before.maxY + before.maxY - before.minY))
    }));
    expect(result.newSource).toContain("xshift=1cm");
    const after = localBounds(snapshot, result.newSource);
    expect(after.minX).toBeCloseTo(before.minX, 5);
    expect(after.maxX).toBeCloseTo(before.maxX, 5);
    expect(after.minY).toBeCloseTo(before.minY, 5);
    expect(after.maxY - after.minY).toBeCloseTo(2 * (before.maxY - before.minY), 5);
  });

  it.each([false, true])("resizes the exact browser fixture's optionless negative-coordinate scope from a corner (prepared: %s)", prepared => {
    const snapshot = evaluate(String.raw`\begin{tikzpicture}
  \draw (-3,-3) rectangle (3,3);
  \begin{scope}
    \draw[fill=red] (-2.5,1.5) rectangle (-0.8,-0.3);
    \draw[fill=blue] (-2.4,0) rectangle (-0.9,-2);
  \end{scope}
\end{tikzpicture}`);
    const bounds = (source: string) => {
      const values = [...collectSourceWorldBounds(evaluate(source).semantic.scene.elements).values()].filter(value => value.sourceId !== "path:0");
      return worldBounds(pt(Math.min(...values.map(value => value.minX))), pt(Math.min(...values.map(value => value.minY))),
        pt(Math.max(...values.map(value => value.maxX))), pt(Math.max(...values.map(value => value.maxY))));
    };
    const before = bounds(snapshot.source);
    const geometry = prepared ? createEditGeometrySession(snapshot) : undefined;
    const inspectorValues = resolveTransformInspectorMutationContext(snapshot.source, "scope:1").values;
    expect(inspectorValues.rotateAround).toBeNull();
    let current = snapshot.source;
    for (const [dx, dy] of [[-20, 15], [-40, 25], [-5, 8]]) {
      const result = success(applyEditAction(prepared ? current : snapshot.source, snapshot.semantic.editHandles, {
        kind: "resizeElement", elementId: "scope:1", role: "top-left", formatPrecision: "snapped",
        newWorld: wp(before.minX + dx, before.maxY + dy), referenceBounds: before,
        referenceScopeTransform: inspectorValues
      }, geometry ? { geometry } : {}));
      expectPatchesReconstructSource(prepared ? current : snapshot.source, result);
      current = result.newSource;
      const after = bounds(current);
      expect(after.maxX).toBeCloseTo(before.maxX, 5);
      expect(after.minY).toBeCloseTo(before.minY, 5);
      expect(after.minX).toBeCloseTo(before.minX + dx, 5);
      expect(after.maxY).toBeCloseTo(before.maxY + dy, 5);
      expect(result.newSource).toContain("xscale=");
      expect(result.newSource).toContain("yscale=");
      expect(result.newSource).toContain(String.raw`\draw (-3,-3) rectangle (3,3);`);
    }
    if (geometry) {
      const origin = success(applyEditAction(current, [], { kind: "resizeElement", elementId: "scope:1", role: "top-left",
        newWorld: wp(before.minX, before.maxY), referenceBounds: before }, { geometry }));
      expect(origin.newSource).toBe(snapshot.source);
    }
  });

  it.each(["xscale", "yscale", "xshift", "yshift"] as const)("rejects a non-finite declared numeric reference field with the real inspector payload: %s", key => {
    const snapshot = prepare(""), values = resolveTransformInspectorMutationContext(snapshot.source, snapshot.scopeId).values;
    const result = applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "resizeElement", elementId: snapshot.scopeId, role: "top-left", newWorld: wp(cm(-1), cm(3)),
      referenceBounds: localBounds(snapshot), referenceScopeTransform: { ...values, [key]: Number.NaN }
    }, { geometry: createEditGeometrySession(snapshot) });
    expect(result).toMatchObject({ kind: "unsupported", reason: "Scope resize produced a non-finite transform." });
  });

  it.each(["own", "cm={1,.2,0,1,(0,0)}", "xscale=2,xscale=3"])("rejects unrepresentable own transforms without rewriting: %s", own => {
    const snapshot = prepare("rotate=30", own, "own/.style={rotate=20}");
    const result = applyEditAction(snapshot.source, snapshot.semantic.editHandles, {
      kind: "resizeElement", elementId: snapshot.scopeId, role: "right", newWorld: wp(cm(4), cm(2))
    });
    expect(result.kind).toBe("unsupported");
  });

  it.each(["", "rotate=30", "cm={1,.2,.4,1,(0,0)}"])("keeps the legacy numeric reference baseline across previews: %s", parent => {
    const snapshot = prepare(parent), before = localBounds(snapshot);
    const originalWorld = [...collectSourceWorldBounds(snapshot.semantic.scene.elements).values()][0];
    const action = { kind: "resizeElement" as const, elementId: snapshot.scopeId, role: "right" as const,
      newWorld: applyMatrix(snapshot.frame, wp(before.maxX + before.maxX - before.minX, (before.minY + before.maxY) / 2)),
      referenceBounds: originalWorld, referenceScopeTransform: { xscale: 1, yscale: 1, xshift: 0, yshift: 0 }, formatPrecision: "snapped" as const };
    const first = success(applyEditAction(snapshot.source, [], action));
    const repeated = applyEditAction(first.newSource, [], action);
    if (repeated.kind === "success") {
      const after = localBounds(snapshot, repeated.newSource);
      expect(after.minX).toBeCloseTo(before.minX, 5);
      expect(after.maxX - after.minX).toBeCloseTo(2 * (before.maxX - before.minX), 5);
    } else expect(repeated).toMatchObject({ kind: "unsupported", reason: "Resize would not change node constraints." });
  });

  it("rejects unrecoverable legacy reference order instead of accumulating transforms", () => {
    const snapshot = prepare("", "xscale=2,xshift=4pt");
    const result = applyEditAction(snapshot.source, [], { kind: "resizeElement", elementId: snapshot.scopeId,
      role: "right", newWorld: wp(cm(8), cm(1)), referenceBounds: localBounds(snapshot),
      referenceScopeTransform: { xscale: 2, yscale: 1, xshift: 4, yshift: 0 } });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") expect(result.reason).toContain("original geometry baseline");
  });

  it("reuses a prepared baseline across pointer frames and restores the source at the origin", () => {
    const snapshot = prepare("rotate=30,xscale=2", "shift={(4pt,5pt)},xscale=1.2");
    const geometry = createEditGeometrySession(snapshot, {}, { propertyWriteMode: "drag-frame" });
    geometry.prepare(snapshot.scopeId);
    const before = localBounds(snapshot), width = before.maxX - before.minX;
    const full = vi.spyOn(evaluator, "evaluateTikzFigure"), parse = vi.spyOn(parser, "parseTikz");
    let current = snapshot.source;
    for (const ratio of [1.4, 2, 1.7, 1]) {
      full.mockClear(); parse.mockClear();
      const result = success(applyEditAction(current, [], { kind: "resizeElement", elementId: snapshot.scopeId,
        role: "right", formatPrecision: "snapped", newWorld: applyMatrix(snapshot.frame,
          wp(before.minX + ratio * width, (before.minY + before.maxY) / 2)) }, { geometry }));
      expect(full).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expectPatchesReconstructSource(current, result);
      current = result.newSource;
      if (ratio === 1) expect(current).toBe(snapshot.source);
      else {
        const bounds = localBounds(snapshot, current);
        expect(bounds.minX).toBeCloseTo(before.minX, 5);
        expect(bounds.maxX - bounds.minX).toBeCloseTo(ratio * width, 5);
      }
    }
  });
});
