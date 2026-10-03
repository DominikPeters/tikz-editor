import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { planCenteredPivotMoves } from "../packages/core/src/edit/center-pivot-move.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { rewritePreciseFrameCoordinate } from "../packages/core/src/edit/frame-coordinate.js";
import { applyTextReplacements } from "../packages/core/src/edit/statement-ops.js";
import { findPathStatementById } from "../packages/core/src/edit/statement-find.js";
import { resolveStatementOptionFrame } from "../packages/core/src/edit/parent-frame.js";
import { applyFrameToWorldPoint } from "../packages/core/src/coords/frame.js";
import { frameLocalPoint } from "../packages/core/src/coords/points.js";
import { worldTransform } from "../packages/core/src/coords/transforms.js";
import { parseRotateAroundValue } from "../packages/core/src/semantic/style/option-utils.js";
import { applyMatrix } from "../packages/core/src/semantic/transform.js";
import type { EditHandle, SceneElement } from "../packages/core/src/semantic/types.js";
import type { EditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { cm } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

afterEach(() => vi.restoreAllMocks());

function snapshot(source: string) {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const semantic = evaluator.evaluateTikzFigure(parsed.figure, source);
  const elementId = semantic.editHandles[0].sourceRef.sourceId;
  return { source, parsed, semantic, elementId };
}

function plannedMove(source: string, delta: ReturnType<typeof wp>, geometry?: EditGeometrySession) {
  const baseline = geometry ?? snapshot(source);
  const sourceIds = [...new Set(baseline.semantic.editHandles.map(handle => handle.sourceRef.sourceId))];
  const plan = planCenteredPivotMoves(source, baseline.semantic.editHandles, new Map(sourceIds.map(id => [id, delta])), {}, geometry);
  if (plan.kind !== "success") throw new Error(plan.reason);
  const replacements = [...plan.replacements];
  for (const handle of baseline.semantic.editHandles) {
    const frame = plan.framesBySource.get(handle.sourceRef.sourceId);
    const rewrittenHandle = frame ? { ...handle, frame,
      transform: worldTransform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f) } as EditHandle : handle;
    const text = rewritePreciseFrameCoordinate(wp(handle.world.x + delta.x, handle.world.y + delta.y), rewrittenHandle, source);
    if (text == null) throw new Error("Cannot rewrite explicit coordinate");
    replacements.push({ span: handle.sourceRef.sourceSpan, text });
  }
  return { plan, source: applyTextReplacements(source, replacements).source };
}

function geometryPoints(element: SceneElement): Array<{ x: number; y: number }> {
  let points: Array<{ x: number; y: number }>;
  if (element.kind === "Path") {
    points = element.commands.flatMap(command => {
      if (command.kind === "M" || command.kind === "L" || command.kind === "A") return [command.to];
      if (command.kind === "C") return [command.c1, command.c2, command.to];
      return [];
    });
  } else if (element.kind === "Circle" || element.kind === "Ellipse") {
    const rx = element.kind === "Circle" ? element.radius : element.rx;
    const ry = element.kind === "Circle" ? element.radius : element.ry;
    const angle = element.kind === "Ellipse" ? (element.rotation ?? 0) * Math.PI / 180 : 0;
    points = Array.from({ length: 8 }, (_, i) => {
      const x = rx * Math.cos(i * Math.PI / 4), y = ry * Math.sin(i * Math.PI / 4);
      return { x: element.center.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: element.center.y + x * Math.sin(angle) + y * Math.cos(angle) };
    });
  } else throw new Error("Expected explicit shape");
  const transform = element.transform;
  return transform ? points.map(point => applyMatrix(transform, wp(point.x, point.y))) : points;
}

function expectTranslated(beforeSource: string, afterSource: string, delta: ReturnType<typeof wp>) {
  const before = snapshot(beforeSource).semantic.scene.elements;
  const after = snapshot(afterSource).semantic.scene.elements;
  expect(after.map(element => element.kind)).toEqual(before.map(element => element.kind));
  before.forEach((element, i) => {
    const points = geometryPoints(element), actual = geometryPoints(after[i]);
    expect(actual).toHaveLength(points.length);
    actual.forEach((point, j) => expect(Math.hypot(point.x - points[j].x - delta.x, point.y - points[j].y - delta.y), afterSource).toBeLessThan(.001));
  });
}

function expectCentered(source: string) {
  const fresh = snapshot(source);
  for (const sourceId of new Set(fresh.semantic.editHandles.map(handle => handle.sourceRef.sourceId))) {
    const statement = findPathStatementById(fresh.parsed.figure.body, sourceId)!;
    const entries = statement.options!.entries;
    const index = entries.findIndex(entry => entry.kind === "kv" && entry.key.includes("rotate around"));
    const entry = entries[index];
    if (entry.kind !== "kv") throw new Error("Missing pivot");
    const rotation = parseRotateAroundValue(entry.valueRaw)!;
    const prefix = resolveStatementOptionFrame(source, statement.id, entries.slice(0, index))!;
    const pivot = applyFrameToWorldPoint(prefix, frameLocalPoint(rotation.pivot.x, rotation.pivot.y));
    const handles = fresh.semantic.editHandles.filter(handle => handle.sourceRef.sourceId === statement.id);
    const center = handles.length === 1 ? handles[0].world : wp((handles[0].world.x + handles[1].world.x) / 2,
      (handles[0].world.y + handles[1].world.y) / 2);
    expect(Math.hypot(pivot.x - center.x, pivot.y - center.y)).toBeLessThan(.001);
  }
}

describe("centered rotate-around movement planning", () => {
  for (const [shape, syntax] of [
    ["rectangle", "(0,0) rectangle (2,1)"],
    ["circle", "(1,.5) circle (.7cm)"],
    ["ellipse", "(1,.5) ellipse (.7cm and .4cm)"]
  ]) {
    it.each([0, 15, 32.123456, 90, 135, -45])(`${shape} moves all fresh geometry once while its pivot remains centered at %s degrees`, angle => {
      const source = `\\begin{tikzpicture}[rotate=20,xscale=2]\\draw[rotate around={${angle}:(1,.5)}] ${syntax};\\end{tikzpicture}`;
      const delta = wp(cm(.75), cm(-.25));
      const result = plannedMove(source, delta);
      expect(result.plan.framesBySource.size).toBe(1);
      expectTranslated(source, result.source, delta);
      expectCentered(result.source);
    });
  }

  it.each(["xshift=1cm", "scale=2", "rotate=15", "cm={1,.2,.3,1,(.2,.1)}", "rotate=20,xscale=2,yscale=.8"])("respects named prefix and suffix ordering: %s", prefix => {
    const source = `\\begin{tikzpicture}\\tikzset{prefix/.style={${prefix}},suffix/.style={scale=2}}\\draw[prefix,/tikz/rotate around={90/2:(1,.5)},suffix,draw=red] (0,0) rectangle (1,.5);\\end{tikzpicture}`;
    const delta = wp(cm(.12345), cm(-.98765));
    const result = plannedMove(source, delta);
    expect(result.plan.framesBySource.size).toBe(1);
    expect([...result.plan.mutationsBySource.values()].map(mutations => mutations.size)).toEqual([1]);
    expect(result.source).toContain("/tikz/rotate around={90/2:");
    expect(result.source).toContain(",suffix,draw=red]");
    expect(result.source).toContain(`prefix/.style={${prefix}}`);
    expectTranslated(source, result.source, delta);
    expectCentered(result.source);
  });

  it("retains other authored rotations while replacing only the actual pivot key", () => {
    // The suffix rotates the local rectangle center onto the pivot.
    const center = { x: 1 * Math.cos(15 * Math.PI / 180) - .5 * Math.sin(15 * Math.PI / 180),
      y: 1 * Math.sin(15 * Math.PI / 180) + .5 * Math.cos(15 * Math.PI / 180) };
    const source = `\\begin{tikzpicture}\\draw[rotate=15,rotate around={32:(1,.5)},rotate=-15] (${center.x - 1},${center.y - .5}) rectangle (${center.x + 1},${center.y + .5});\\end{tikzpicture}`;
    const result = plannedMove(source, wp(cm(.5), cm(.75)));
    expect(result.plan.framesBySource.size).toBe(1);
    expect(result.source).toContain("[rotate=15,rotate around={32:");
    expect(result.source).toContain(",rotate=-15]");
    expectTranslated(source, result.source, wp(cm(.5), cm(.75)));
    expectCentered(result.source);
  });

  it("retains a noncentral authored pivot while ordinary coordinate movement translates the shape", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate around={90:(0,0)}] (0,0) rectangle (2,1);\end{tikzpicture}`;
    const delta = wp(cm(1), 0), result = plannedMove(source, delta);
    expect(result.plan.framesBySource.size).toBe(0);
    expect(result.plan.replacements).toHaveLength(0);
    expect(result.source).toContain("rotate around={90:(0,0)}");
    expectTranslated(source, result.source, delta);
  });

  it.each([
    "(.5,.25) circle (.7cm)",
    "(.5,.25) ellipse (.7cm and .4cm)"
  ])("preserves centered ellipse-like shapes through nested scopes and named suffixes: %s", syntax => {
    const source = `\\begin{tikzpicture}[rotate=10]\\tikzset{scopeStyle/.style={xscale=2,cm={1,.2,.3,1,(.5,.2)}},post/.style={scale=2}}\\begin{scope}[scopeStyle]\\begin{scope}[xshift=.4cm]\\draw[rotate around={32:(1,.5)},post] ${syntax};\\end{scope}\\end{scope}\\end{tikzpicture}`;
    const delta = wp(cm(.76543), cm(-.23456)), result = plannedMove(source, delta);
    expect(result.plan.framesBySource.size).toBe(1);
    expectTranslated(source, result.source, delta);
    expectCentered(result.source);
  });

  it("plans each selected centered pivot with its own world delta", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate around={32:(1,.5)}] (0,0) rectangle (2,1);\draw[rotate around={90:(4,2)}] (3,1.5) rectangle (5,2.5);\end{tikzpicture}`;
    const baseline = snapshot(source);
    const plan = planCenteredPivotMoves(source, baseline.semantic.editHandles,
      new Map([["path:0", wp(cm(1), 0)], ["path:1", wp(0, cm(2))]]));
    if (plan.kind !== "success") throw new Error(plan.reason);
    expect(plan.framesBySource.size).toBe(2);
    expect(plan.replacements.map(replacement => replacement.text)).toEqual([
      "rotate around={32:(2,0.5)}", "rotate around={90:(4,4)}"
    ]);
  });

  it("reuses a prepared baseline without evaluating statements for each movement frame", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=20,xscale=2]\draw[rotate around={32:(1,.5)}] (0.000,0.000) rectangle (2.000,1.000);\end{tikzpicture}`;
    const baseline = snapshot(source), geometry = createEditGeometrySession(baseline);
    geometry.prepare(baseline.elementId);
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure"), statementEvaluate = vi.spyOn(evaluator, "evaluateSemanticStatementByIndex");
    for (const delta of [wp(cm(.2), cm(.3)), wp(cm(.5), cm(.7)), wp(0, 0)]) {
      fullEvaluate.mockClear(); statementEvaluate.mockClear();
      const plan = planCenteredPivotMoves(source, baseline.semantic.editHandles, new Map([[baseline.elementId, delta]]), {}, geometry);
      if (plan.kind !== "success") throw new Error(plan.reason);
      expect(fullEvaluate).not.toHaveBeenCalled();
      expect(statementEvaluate).not.toHaveBeenCalled();
      if (delta.x === 0 && delta.y === 0) {
        expect(plan.replacements).toHaveLength(0);
        expect(plan.framesBySource.size).toBe(0);
      }
    }
  });

  it("rejects stale or shared coordinates before emitting a pivot change", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate around={90:(1,.5)}] (0,0) rectangle (2,1);\end{tikzpicture}`;
    const baseline = snapshot(source), delta = new Map([[baseline.elementId, wp(cm(1), 0)]]);
    const stale = baseline.semantic.editHandles.map(handle => ({ ...handle, sourceText: "stale" }));
    expect(planCenteredPivotMoves(source, stale, delta).kind).toBe("unsupported");
    const shared = [...baseline.semantic.editHandles, { ...baseline.semantic.editHandles[0], id: "expanded", sourceRef:
      { ...baseline.semantic.editHandles[0].sourceRef, sourceId: "other" } }];
    expect(planCenteredPivotMoves(source, shared, delta).kind).toBe("unsupported");
  });

  it("rejects a singular suffix before emitting a standalone pivot change", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate around={30:(0,0)},xscale=0] (-1,-.5) rectangle (1,.5);\end{tikzpicture}`;
    const baseline = snapshot(source);
    const result = planCenteredPivotMoves(source, baseline.semantic.editHandles, new Map([[baseline.elementId, wp(10, 0)]]));
    expect(result.kind).toBe("unsupported");
  });

  it("leaves unwritable direct coordinate forms out of a pivot plan", () => {
    const source = String.raw`\begin{tikzpicture}\draw[rotate around={30:(1,.5)}] (0,0,0) rectangle (2,1,0);\end{tikzpicture}`;
    const baseline = snapshot(source);
    const result = planCenteredPivotMoves(source, baseline.semantic.editHandles, new Map([[baseline.elementId, wp(10, 0)]]));
    if (result.kind !== "success") throw new Error(result.reason);
    expect(result.replacements).toHaveLength(0);
    expect(result.framesBySource.size).toBe(0);
  });
});
