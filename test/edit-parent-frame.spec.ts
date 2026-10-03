import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import * as evaluator from "../packages/core/src/semantic/evaluate.js";
import { createEditGeometrySession } from "../packages/core/src/edit/geometry-session.js";
import { resolveStatementOptionFrame, resolveStatementParentFrame } from "../packages/core/src/edit/parent-frame.js";
import { isFrameLocalCoordinateEditHandle } from "../packages/core/src/semantic/types.js";
import { findPathStatementById } from "../packages/core/src/edit/statement-find.js";

afterEach(() => vi.restoreAllMocks());

function snapshot(source: string) {
  const parsed = parseTikz(source, { includeContextDefinitions: true });
  const semantic = evaluator.evaluateTikzFigure(parsed.figure, source);
  return { source, parsed, semantic };
}

describe("semantic statement entry frames", () => {
  it.each([
    "rotate=20,xscale=2,xshift=1cm",
    "xshift=1cm,xscale=2,rotate=20",
    "cm={1,.2,.3,1,(.5,.2)},rotate=20,yscale=.8"
  ])("resolves named picture and nested scope transforms in authored order: %s", transforms => {
    const source = `\\begin{tikzpicture}[rotate=10,xshift=.2cm]\\tikzset{framed/.style={${transforms}}}\\begin{scope}[framed]\\begin{scope}[rotate=-15,xshift=.3cm]\\draw (0,0) -- (1,1);\\end{scope}\\end{scope}\\end{tikzpicture}`;
    const baseline = snapshot(source);
    const handle = baseline.semantic.editHandles[0];
    if (!isFrameLocalCoordinateEditHandle(handle)) throw new Error("Expected a coordinate frame");
    expect(resolveStatementParentFrame(source, handle.sourceRef.sourceId)).toEqual(handle.frame);
    const geometry = createEditGeometrySession(baseline);
    expect(resolveStatementParentFrame(source, handle.sourceRef.sourceId, {}, geometry)).toEqual(handle.frame);
  });

  it("resolves a scope parent before that scope's own options", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=2]\begin{scope}[rotate=20]\draw (0,0) -- (1,1);\begin{scope}[xshift=1cm]\draw (2,2) -- (3,3);\end{scope}\end{scope}\end{tikzpicture}`;
    const baseline = snapshot(source);
    const outer = baseline.parsed.figure.body[0];
    if (outer.kind !== "Scope") throw new Error("Expected scope");
    const nested = outer.body.find(statement => statement.kind === "Scope")!;
    const handle = baseline.semantic.editHandles[0];
    if (!isFrameLocalCoordinateEditHandle(handle)) throw new Error("Expected a coordinate frame");
    expect(resolveStatementParentFrame(source, nested.id)).toEqual(handle.frame);
  });

  it("resolves named options and macro prefixes without evaluating the selected path or suffix", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=10]\tikzset{framed/.style={xscale=2,rotate=15}}\def\opts{xshift=.5cm,yscale=.8}\draw[framed,\opts,rotate=30] (0,0) -- (1,1);\node at (20,20) {Unrelated};\end{tikzpicture}`;
    const baseline = snapshot(source);
    const handle = baseline.semantic.editHandles[0];
    if (!isFrameLocalCoordinateEditHandle(handle)) throw new Error("Expected a coordinate frame");
    const target = findPathStatementById(baseline.parsed.figure.body, handle.sourceRef.sourceId)!;
    const statementEvaluate = vi.spyOn(evaluator, "evaluateSemanticStatementByIndex");
    const fullEvaluate = vi.spyOn(evaluator, "evaluateTikzFigure");
    expect(resolveStatementOptionFrame(source, target.id)).toEqual(handle.frame);
    expect(fullEvaluate).not.toHaveBeenCalled();
    expect(statementEvaluate.mock.calls.every(([run, index]) => run.expandedFigureBody[index].id !== target.id)).toBe(true);
    expect(statementEvaluate.mock.calls.every(([run, index]) => run.expandedFigureBody[index].kind !== "Path")).toBe(true);
    const geometry = createEditGeometrySession(baseline);
    geometry.prepare(target.id);
    fullEvaluate.mockClear(); statementEvaluate.mockClear();
    for (let i = 0; i < 3; i++) {
      expect(resolveStatementOptionFrame(source, target.id, undefined, {}, geometry)).toEqual(handle.frame);
      const prefix = resolveStatementOptionFrame(source, target.id, target.options!.entries.slice(0, -1), {}, geometry)!;
      expect(prefix).not.toEqual(handle.frame);
    }
    expect(fullEvaluate).not.toHaveBeenCalled();
    expect(statementEvaluate).not.toHaveBeenCalled();
  });

  it("does not substitute an unrelated geometry snapshot", () => {
    const source = String.raw`\begin{tikzpicture}[xscale=2]\draw (0,0) -- (1,1);\end{tikzpicture}`;
    const geometry = createEditGeometrySession(snapshot(source));
    const changed = source.replace("xscale=2", "xscale=3");
    expect(resolveStatementParentFrame(changed, "path:0", {}, geometry)?.a).toBe(3);
    expect(resolveStatementParentFrame(source, "missing", {}, geometry)).toBeUndefined();
  });

  it("distinguishes authored scope prefixes from final background layer transforms", () => {
    const source = String.raw`\begin{tikzpicture}[every on background layer/.style={xscale=2,rotate=15}]\begin{scope}[on background layer,xshift=.5cm]\draw (0,0) rectangle (1,1);\end{scope}\end{tikzpicture}`;
    const baseline = snapshot(source);
    const scope = baseline.parsed.figure.body[0];
    if (scope.kind !== "Scope") throw new Error("Expected scope");
    const handle = baseline.semantic.editHandles[0];
    if (!isFrameLocalCoordinateEditHandle(handle)) throw new Error("Expected a coordinate frame");
    const geometry = createEditGeometrySession(baseline);
    expect(geometry.optionFrame(scope.id)).toEqual(handle.frame);
    expect(resolveStatementOptionFrame(source, scope.id)).toEqual(handle.frame);
    const entries = scope.options!.entries;
    expect(geometry.optionFrame(scope.id, entries, true)).toEqual(handle.frame);
    expect(geometry.optionFrame(scope.id, entries)?.a).toBe(1);
    expect(geometry.optionFrame(scope.id, entries.slice(0, 1))?.a).toBe(1);
    expect(geometry.parentFrame(handle.sourceRef.sourceId)).toEqual(handle.frame);
  });
});
