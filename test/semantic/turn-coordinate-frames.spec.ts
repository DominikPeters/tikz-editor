import { describe, expect, it } from "vitest";
import { evaluateSemantic, elementsOfKind } from "./helpers.js";
import { applyFrameTransform } from "../../packages/core/src/coords/frame.js";
import { worldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { rewriteCoordinate } from "../../packages/core/src/edit/rewrite.js";
import { appendArcCommand } from "../../packages/core/src/semantic/path/arc.js";
import { pointAtPlacementSegment, tangentAtPlacementSegment } from "../../packages/core/src/semantic/path/path-attached.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { evaluateTikzFigure, evaluateTikzFigureAsync } from "../../packages/core/src/semantic/evaluate.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { computeMinimalReplacementPatch } from "../../packages/core/src/edit/patch.js";
import type { ScenePathCommand } from "../../packages/core/src/semantic/types.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";

const CM = 72.27 / 2.54;
const picture = (options: string, path: string) => `\\begin{tikzpicture}[${options}]\\draw ${path};\\end{tikzpicture}`;
function endpoint(source: string) {
  const result = evaluateSemantic(source);
  expect(result.diagnostics).toEqual([]);
  const path = elementsOfKind(result.scene.elements, "Path")[0];
  const end = path.commands.at(-1);
  if (!end || !("to" in end)) throw new Error("Missing final path endpoint");
  return { result, end: end.to };
}
function expectPoint(actual: { x: number; y: number }, x: number, y: number, precision = 5) {
  expect(actual.x).toBeCloseTo(x, precision);
  expect(actual.y).toBeCloseTo(y, precision);
}

// Fresh PGF numerical controls supplied by the coordinator; precision allows
// PGF fixed-point normalization/trigonometry, without normalizing geometry.
const oracleCases = [
  ["line identity", "", "(0,0)--(1,0)--([turn]0:1cm)", 56.90549, 0],
  ["line rotate90", "rotate=90", "(0,0)--(1,0)--([turn]0:1cm)", 0, 56.90549],
  ["line rotate45", "rotate=45", "(0,0)--(1,0)--([turn]0:1cm)", 40.23830, 40.23830],
  ["line anisotropic", "xscale=2,yscale=.5", "(0,0)--(1,1)--([turn]30:1cm)", 71.63338, 27.96801],
  ["line reflected", "xscale=-1,rotate=30", "(0,0)--(1,1)--([turn]-30:1cm)", -30.53369, 58.98643],
  ["line skew", "cm={1,0,.5,1,(0,0)}", "(0,0)--(1,1)--([turn]30:1cm)", 63.78491, 55.93602],
  ["repeated turns", "rotate=45", "(0,0)--(1,0)--([turn]30:1cm)--([turn]-60:1cm)", 54.96614, 54.96620],
  ["HV entering leg", "rotate=45", "(0,0)-|(1,1)--([turn]30:1cm)", -27.48330, 47.60245],
  ["cubic entering control", "rotate=60", "(0,0)..controls(1,0)and(1,1)..(2,1)--([turn]0:1cm)", 18.03825, 88.14896],
  ["arc identity", "", "(1,0)arc(0:90:1cm)--([turn]0:1cm)", -28.45274, 28.45274],
  ["arc clockwise", "", "(1,0)arc(0:-90:1cm)--([turn]0:1cm)", -28.45274, -28.45274],
  ["arc half", "", "(1,0)arc(0:180:1cm)--([turn]0:1cm)", -28.45274, -28.45274],
  ["arc full", "", "(1,0)arc(0:360:1cm)--([turn]0:1cm)", 28.45274, 28.45274],
  ["arc long and nonzero turn", "", "(1,0)arc(0:450:1cm)--([turn]30:1cm)", -24.64085, 14.22638],
  ["arc rotate90 lookup", "rotate=90", "(1,0)arc(0:90:1cm)--([turn]0:1cm)", -40.07852, 25.96806],
  ["arc rotate45 lookup", "rotate=45", "(1,0)arc(0:90:1cm)--([turn]0:1cm)", 5.03468, 33.41505],
  ["arc anisotropic lookup", "xscale=2,yscale=.5", "(1,0)arc(0:90:1cm)--([turn]30:1cm)", -56.62723, 12.82677],
  ["arc reflected lookup", "xscale=-1", "(1,0)arc(0:90:1cm)--([turn]0:1cm)", -28.45274, 28.45274],
  ["arc skew lookup", "cm={1,0,.5,1,(0,0)}", "(1,0)arc(0:90:1cm)--([turn]30:1cm)", -17.52766, 14.22638],
  ["arc translated lookup", "shift={(1cm,2cm)}", "(1,0)arc(0:90:1cm)--([turn]0:1cm)", 11.00800, 62.88208],
  ["elliptical arc", "", "(2,0)arc(0:90:2cm and 1cm)--([turn]30:1cm)", -24.64087, 14.22638],
  ["negative starting angle", "", "(0,-1)arc(-90:45:1cm)--([turn]-30:1cm)", 12.75497, 47.60242],
] as const;

describe("polar turn coordinate frames", () => {
  it.each(oracleCases)("matches the fresh PGF %s endpoint", (_name, options, path, x, y) => {
    const actual = endpoint(picture(options, path));
    expectPoint(actual.end, x, y, 2);
  });

  it.each([-90, 30, 180, 450])("applies a %s degree local turn once through an anisotropic frame", angle => {
    const radians = angle * Math.PI / 180;
    const { end } = endpoint(picture("xscale=2,yscale=.5", `(0pt,0pt)--(10pt,0pt)--([turn]${angle}:10pt)`));
    expectPoint(end, 20 + 20 * Math.cos(radians), 5 * Math.sin(radians));
  });

  it("composes nested scope frames without inventing world rotation compensation", () => {
    const source = String.raw`\begin{tikzpicture}[rotate=90]
\begin{scope}[xscale=2,yscale=.5,shift={(3pt,4pt)}]
\draw (0pt,0pt)--(10pt,0pt)--([turn]90:10pt);
\end{scope}\end{tikzpicture}`;
    const { end } = endpoint(source);
    // Inner scale acts on its following shift; outer rotation acts last.
    expectPoint(end, -7, 26);
  });

  it.each(["", "rotate=37,xscale=2,yscale=.5", "cm={1,.4,.3,1,(7pt,9pt)}"])("retains authored polar handle coordinates in %s", options => {
    const source = picture(options, "(0pt,0pt)--(10pt,10pt)--([turn]30:1cm)");
    const { result, end } = endpoint(source);
    const handle = result.editHandles.find(h => h.sourceText === "([turn]30:1cm)");
    if (!handle || handle.handleType !== "coordinate" || handle.coordinateSpace !== "frame-local") throw new Error("Missing turn handle");
    expect(handle.rewriteMode).toBe("delta");
    expectPoint(handle.local, CM * Math.cos(Math.PI / 6), CM / 2);
    expectPoint(applyFrameTransform(handle.frame, handle.local), end.x, end.y);
    const same = rewriteCoordinate(handle.world, handle, source);
    expect(same).toContain("[turn]30:");
    expect(same).toBe("([turn]30:1)");
    const target = applyFrameTransform(handle.frame, { ...handle.local, x: pt(0), y: pt(2 * CM) });
    const replacement = rewriteCoordinate(target, handle, source);
    expect(replacement).toContain("[turn]90:");
    if (!replacement) throw new Error("Missing turn rewrite");
    const changed = source.slice(0, handle.sourceRef.sourceSpan.from) + replacement + source.slice(handle.sourceRef.sourceSpan.to);
    expectPoint(endpoint(changed).end, target.x, target.y, 3);
  });

  it("keeps an arc continuation handle's origin and lookup rotation consistent", () => {
    const source = picture("rotate=45,shift={(1cm,2cm)}", "(1,0)arc(0:90:1cm)--([turn]-30:1cm)");
    const { result, end } = endpoint(source);
    const handle = result.editHandles.find(h => h.sourceText.includes("[turn]"));
    if (!handle || handle.handleType !== "coordinate" || handle.coordinateSpace !== "frame-local") throw new Error("Missing arc turn handle");
    expectPoint(handle.local, Math.sqrt(3) * CM / 2, -CM / 2);
    expectPoint(applyFrameTransform(handle.frame, handle.local), end.x, end.y);
    const same = rewriteCoordinate(handle.world, handle, source);
    // Existing formatter normalizes angles to [0,360) and lengths to cm.
    expect(same).toBe("([turn]330:1)");
    if (!same) throw new Error("Missing arc rewrite");
    const unchanged = source.slice(0, handle.sourceRef.sourceSpan.from) + same + source.slice(handle.sourceRef.sourceSpan.to);
    expectPoint(endpoint(unchanged).end, end.x, end.y);
  });

  it.each(["-|", "|-"])("uses the authored %s final leg under a skewed reflected frame", operator => {
    const source = picture("cm={-2,.4,.3,1,(0,0)}", `(0pt,0pt)${operator}(10pt,20pt)--([turn]0:10pt)`);
    const localX = operator === "-|" ? 10 : 20;
    const localY = operator === "-|" ? 30 : 20;
    expectPoint(endpoint(source).end, -2 * localX + .3 * localY, .4 * localX + localY);
  });

  it("keeps the previous cubic chord fallback finite when the final control equals its endpoint", () => {
    const source = picture("rotate=90", "(0pt,0pt)..controls(5pt,5pt)and(10pt,0pt)..(10pt,0pt)--([turn]0:10pt)");
    expectPoint(endpoint(source).end, 0, 20);
  });

  it.each(["xscale=0", "scale=0", "cm={1,0,2,0,(3pt,4pt)}"])("retains deterministic finite fallback for singular %s", options => {
    for (const path of ["(0pt,0pt)--(10pt,10pt)--([turn]30:10pt)", "(1,0)arc(0:90:1cm)--([turn]30:10pt)"]) {
      const { result, end } = endpoint(picture(options, path));
      expect(Number.isFinite(end.x) && Number.isFinite(end.y)).toBe(true);
      const handle = result.editHandles.find(h => h.sourceText.includes("[turn]"));
      if (!handle) throw new Error("Missing singular turn handle");
      expect(rewriteCoordinate(handle.world, handle, picture(options, path))).toBeNull();
    }
  });

  it("retains zero-length and absent-segment fallback without accepting Cartesian turn", () => {
    expectPoint(endpoint(picture("rotate=90", "(0pt,0pt)--(0pt,0pt)--([turn]0:10pt)")).end, 0, 10);
    expectPoint(endpoint(picture("rotate=90", "(0pt,0pt)--([turn]0:10pt)")).end, 0, 10);
    const result = evaluateSemantic(picture("", "(0,0)--(1,0)--([turn]1,1)"));
    expect(result.diagnostics.some(d => d.code?.startsWith("invalid-turn-coordinate:"))).toBe(true);
  });

  it("does not invent a turn heading from roundoff in a zero-length final HV leg", () => {
    expectPoint(endpoint(picture("rotate=90", "(0pt,0pt)-|(10pt,0pt)--([turn]0:10pt)")).end, 0, 20);
    expectPoint(endpoint(picture("rotate=90", "(0pt,0pt)|-(0pt,10pt)--([turn]0:10pt)")).end, -10, 10);
  });

  it.each([
    [90, .55228475], [100, 1.333333333 * Math.tan(10 * Math.PI / 180)],
    [115, 1.333333333 * Math.tan(13.75 * Math.PI / 180)],
    [116, 1.333333333 * Math.tan(6.5 * Math.PI / 180)],
    [180, .55228475], [450, .55228475], [-100, 1.333333333 * Math.tan(10 * Math.PI / 180)],
  ])("retains PGF final control-point distance for a %s degree sweep", (endAngle, factor) => {
    const commands: ScenePathCommand[] = [];
    const { segment } = appendArcCommand(commands, worldPoint(pt(10), pt(0)), { startAngle: 0, endAngle, rx: 10, ry: 20 }, { a: 2, b: .3, c: .4, d: 1 });
    if (segment.kind !== "arc" || !segment.turnLookupControl) throw new Error("Missing turn-only lookup control");
    const angle = endAngle * Math.PI / 180;
    const sign = endAngle < 0 ? -1 : 1;
    const dx = -10 * Math.sin(angle) * sign * factor;
    const dy = 20 * Math.cos(angle) * sign * factor;
    expectPoint(segment.turnLookupControl, segment.to.x - 2 * dx - .4 * dy, segment.to.y - .3 * dx - dy);
    expect(commands).toHaveLength(1);
    expect(commands[0].kind).toBe("A");
    // Lookup metadata is deliberately not a new general arc sampling frame.
    const { turnLookupControl: _lookup, ...originalSegment } = segment;
    expect(pointAtPlacementSegment(segment, .5)).toEqual(pointAtPlacementSegment(originalSegment, .5));
    expect(tangentAtPlacementSegment(segment, .5)).toEqual(tangentAtPlacementSegment(originalSegment, .5));
  });

  it("preserves provider dependencies, source ownership and fresh incremental/cooperative results", async () => {
    const source = String.raw`\begin{tikzpicture}[rotate=45]
\draw (1,0)arc(0:90:1cm)--([turn]0:1cm) coordinate (T);
\draw (T)--(3,3);
\draw (8,0)--(9,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source);
    const session = createIncrementalSemanticSession();
    session.evaluate({ source, figure: parsed.figure });
    // Equal-length edits preserve the existing parse identity policy while
    // the assertions still compare every current source span and dependency.
    const next = source.replace("[turn]0:", "[turn]9:");
    const nextParsed = parseTikz(next);
    const fresh = evaluateTikzFigure(nextParsed.figure, next);
    const actual = session.evaluate({ source: next, figure: nextParsed.figure, hints: {
      changedSourceIds: [parsed.figure.body[0].id], sourcePatches: [computeMinimalReplacementPatch(source, next)],
    } });
    expect(actual.semantic).toEqual(fresh);
    expect(actual.stats.reusedStatementCount).toBeGreaterThan(0);
    expect(fresh.dependencies.nodes.some(node => node.kind === "resource" && node.resourceKind === "named-coordinate" && node.resourceKey === "T")).toBe(true);
    const paths = elementsOfKind(fresh.scene.elements, "Path");
    const firstEnd = paths[0].commands.at(-1);
    const secondStart = paths[1].commands[0];
    if (!firstEnd || !("to" in firstEnd) || secondStart.kind !== "M") throw new Error("Missing named dependency endpoints");
    expect(secondStart.to).toEqual(firstEnd.to);
    const turnHandle = fresh.editHandles.find(h => h.sourceText.includes("[turn]"));
    expect(turnHandle && next.slice(turnHandle.sourceRef.sourceSpan.from, turnHandle.sourceRef.sourceSpan.to)).toBe("([turn]9:1cm)");
    let yields = 0;
    expect(await evaluateTikzFigureAsync(nextParsed.figure, next, {}, { budgetMs: 0, yieldControl: async () => { yields++; } })).toEqual(fresh);
    expect(yields).toBeGreaterThan(0);
  });

  it.each([
    ["", "(0,0)--(1,1)--([turn]30:1cm)--([turn]-60:1cm)"],
    ["rotate=45,xscale=2,yscale=.5", "(0,0)--(1,1)--([turn]30:1cm)--([turn]-60:1cm)"],
    ["rotate=45", "(1,0)arc(0:90:1cm)--([turn]30:1cm)--([turn]-60:1cm)"],
    ["shift={(1cm,2cm)},xscale=2,yscale=.5", "(1,0)arc(0:115:1cm)--([turn]-30:1cm)"],
  ])("moves a whole %s path with turn dependencies exactly once", (options, path) => {
    const source = picture(options, path);
    const { result } = endpoint(source);
    const before = elementsOfKind(result.scene.elements, "Path")[0];
    const delta = worldPoint(pt(CM), pt(-CM));
    const moved = applyEditAction(source, result.editHandles, {
      kind: "moveElement", elementId: before.sourceRef.sourceId, delta,
    });
    if (moved.kind !== "success") throw new Error(JSON.stringify(moved));
    const actual = endpoint(moved.newSource).result;
    const after = elementsOfKind(actual.scene.elements, "Path")[0];
    expect(after.commands).toHaveLength(before.commands.length);
    for (let i = 0; i < before.commands.length; i++) {
      const a = before.commands[i], b = after.commands[i];
      if (!("to" in a) || !("to" in b)) throw new Error("Missing moved endpoint");
      // The existing drag writer rounds coordinates and polar values.
      expectPoint(b.to, a.to.x + delta.x, a.to.y + delta.y, 0);
    }
    expect(moved.newSource.match(/\[turn\]/g)).toHaveLength(source.match(/\[turn\]/g)!.length);
  });
});
