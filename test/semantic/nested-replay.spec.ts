import { expect, it, vi } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import * as evaluator from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { createEditGeometrySession } from "../../packages/core/src/edit/geometry-session.js";
import { collectSourceWorldBounds } from "../../packages/core/src/edit/snapping/index.js";
import { emitSvg } from "../../packages/core/src/svg/index.js";

const source = `\\begin{tikzpicture}
\\pgfmathsetseed{42}
\\begin{scope}[xshift=1cm,rotate=25,transform shape]
${Array.from({ length: 80 }, (_, i) => `\\node[draw] (n${i}) at (${i},0) {${i}};`).join('\n')}
\\begin{scope}[scale=2]
\\node[draw,minimum width=2cm] (target) at (n79) {Target};
\\end{scope}
${Array.from({ length: 60 }, (_, i) => `\\draw (${i},2) circle (.1);`).join('\n')}
\\end{scope}
\\draw (target)--(0,0);
\\end{tikzpicture}`;

it("measures a nested node without evaluating either its prefix or suffix on each frame", () => {
  const parsed = parseTikz(source), semantic = evaluator.evaluateTikzFigure(parsed.figure, source);
  const targetId = semantic.scene.elements.find(e => e.kind === "Text" && e.text === "Target")!.sourceRef.sourceId;
  const geometry = createEditGeometrySession({ source, parsed, semantic });
  const spy = vi.spyOn(evaluator, "evaluateSemanticStatementByIndex");
  geometry.prepare(targetId);
  expect(spy.mock.calls.length).toBeLessThan(8);
  for (const size of [3, 4, 1]) {
    const changed = source.replace('minimum width=2cm', `minimum width=${size}cm`);
    spy.mockClear();
    const measured = geometry.measure(changed, targetId);
    expect(spy).toHaveBeenCalledTimes(1);
    const full = evaluator.evaluateTikzFigure(parseTikz(changed).figure, changed);
    expect(collectSourceWorldBounds(measured).get(targetId)).toEqual(collectSourceWorldBounds(full.scene.elements).get(targetId));
  }
  spy.mockRestore();
});

it("resumes rendering inside a nested scope and matches full evaluation across repeated edits", () => {
  const parsed = parseTikz(source); const session = createIncrementalSemanticSession();
  const first = session.evaluate({ source, figure: parsed.figure });
  const targetId = first.semantic.scene.elements.find(e => e.kind === "Text" && e.text === "Target")!.sourceRef.sourceId;
  for (const size of [3, 4, 1]) {
    const changed = source.replace('minimum width=2cm', `minimum width=${size}cm`);
    const result = session.evaluate({ source: changed, figure: parseTikz(changed).figure, hints: { changedSourceIds: [targetId] } });
    expect(result.stats.strategy).toBe("incremental");
    expect(result.stats.recomputeFromStatementIndex).toBeGreaterThan(70);
    expect(emitSvg(result.semantic.scene).svg).toBe(emitSvg(evaluator.evaluateTikzFigure(parseTikz(changed).figure, changed).scene).svg);
  }
});

it.each([String.raw`\clip (-1,-1) rectangle (5,5);`, String.raw`\pgfmathsetmacro{\r}{rnd}\tikzset{box/.style={draw,red}}`])("preserves scoped sequential state: %s", prefix => {
  const input = `\\begin{tikzpicture}\\begin{scope}[xshift=1cm]${prefix}\\node[draw,minimum width=2cm] {Target};\\end{scope}\\draw (0,0)--(1,1);\\end{tikzpicture}`;
  const parsed = parseTikz(input), semantic = evaluator.evaluateTikzFigure(parsed.figure, input);
  const id = semantic.scene.elements.find(e => e.kind === "Text")!.sourceRef.sourceId;
  const changed = input.replace('width=2cm', 'width=4cm');
  const measured = createEditGeometrySession({ source: input, parsed, semantic }).measure(changed, id);
  const full = evaluator.evaluateTikzFigure(parseTikz(changed).figure, changed);
  expect(collectSourceWorldBounds(measured).get(id)).toEqual(collectSourceWorldBounds(full.scene.elements).get(id));
});

it("invalidates children and their outside dependents when scope options change", () => {
  const session = createIncrementalSemanticSession();
  const parsed = parseTikz(source);
  session.evaluate({ source, figure: parsed.figure });
  const scope = parsed.figure.body.find(statement => statement.kind === "Scope")!;
  const changed = source.replace("rotate=25", "rotate=35");
  const result = session.evaluate({ source: changed, figure: parseTikz(changed).figure, hints: { changedSourceIds: [scope.id] } });
  expect(result.stats.strategy).toBe("incremental");
  expect(emitSvg(result.semantic.scene).svg).toBe(emitSvg(evaluator.evaluateTikzFigure(parseTikz(changed).figure, changed).scene).svg);
});

it("keeps usable checkpoints when a later gesture edits a different nested object", () => {
  const session = createIncrementalSemanticSession();
  let text = source;
  let result = session.evaluate({ source: text, figure: parseTikz(text).figure });
  for (const [before, after, label] of [["(0,0)", "(0,1)", "0"], ["{60}", "{Sixty}", "Sixty"]]) {
    const id = result.semantic.scene.elements.find(e => e.kind === "Text" && e.text === (label === "Sixty" ? "60" : label))!.sourceRef.sourceId;
    text = text.replace(before, after);
    result = session.evaluate({ source: text, figure: parseTikz(text).figure, hints: { changedSourceIds: [id] } });
    const full = evaluator.evaluateTikzFigure(parseTikz(text).figure, text);
    expect(emitSvg(result.semantic.scene).svg).toBe(emitSvg(full.scene).svg);
    expect(result.semantic.editHandles).toEqual(full.editHandles);
    const targetId = result.semantic.scene.elements.find(e => e.kind === "Text" && e.text === "Target")!.sourceRef.sourceId;
    const geometry = createEditGeometrySession({ source: text, parsed: parseTikz(text), semantic: result.semantic });
    const spy = vi.spyOn(evaluator, "evaluateSemanticStatementByIndex");
    geometry.prepare(targetId);
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    expect(calls).toBeLessThan(8);
    const resized = text.replace("minimum width=2cm", "minimum width=5cm");
    expect(collectSourceWorldBounds(geometry.measure(resized, targetId)).get(targetId)).toEqual(
      collectSourceWorldBounds(evaluator.evaluateTikzFigure(parseTikz(resized).figure, resized).scene.elements).get(targetId));
  }
});
