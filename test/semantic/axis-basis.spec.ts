import { resolveContextDelta } from "../../packages/core/src/semantic/style/resolve.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";
import { parseOptionListRaw } from "../../packages/core/src/options/parse.js";
import { describe, expect, it } from "vitest";
import { evaluateSemantic, elementsOfKind } from "./helpers.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { rewriteCoordinate } from "../../packages/core/src/edit/rewrite.js";
import { worldVector, worldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { coordinateTransform, defaultAxisBasis } from "../../packages/core/src/semantic/coords/axis-basis.js";
import { identityMatrix } from "../../packages/core/src/semantic/transform.js";

const CM = 72.27 / 2.54;
const wp = (x: number, y: number) => worldPoint(pt(x), pt(y));
function endpoint(source: string) {
  const result = evaluateSemantic(source);
  expect(result.diagnostics).toEqual([]);
  const command = elementsOfKind(result.scene.elements, "Path")[0]?.commands.slice().reverse().find(c => c.kind === "L" || c.kind === "A");
  if (!command || (command.kind !== "L" && command.kind !== "A")) throw new Error("Missing endpoint");
  return command.to;
}
function expectPoint(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x * CM, 4);
  expect(actual.y).toBeCloseTo(y * CM, 4);
}
const BASIS = "x={(2cm,1cm)},y={(-1cm,3cm)}";

describe("independent TikZ XY basis", () => {
  it.each([
    ["(1,2)", 0, 7],
    ["(1cm,2cm)", 1, 2],
    ["(1cm,2)", -1, 6],
    ["(1,2cm)", 2, 3],
    ["(canvas cs:x=1cm,y=2cm)", 1, 2],
    ["(90:1)", -1, 3],
    ["(90:1cm)", 0, 1]
  ])("converts scalar/dimensional components before rotation: %s", (coordinate, x, y) => {
    const result = endpoint(String.raw`\begin{tikzpicture}[rotate=90,${BASIS}]\draw (0,0)--${coordinate};\end{tikzpicture}`);
    expectPoint(result, -y, x);
  });

  it("replaces one nested basis vector, retains CTM, and restores the entering basis", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[rotate=90,${BASIS}]
      \begin{scope}[x={(0cm,2cm)}]\draw (0,0)--(1,1);\end{scope}
      \draw (0,0)--(1,1);\end{tikzpicture}`);
    const ends = elementsOfKind(result.scene.elements, "Path").map(path => path.commands.find(c => c.kind === "L"));
    expect(ends).toHaveLength(2);
    if (ends[0]?.kind !== "L" || ends[1]?.kind !== "L") throw new Error("Missing lines");
    expectPoint(ends[0].to, -5, -1);
    expectPoint(ends[1].to, -4, 1);
  });

  it("scans vector replacements with the entering basis and preserves authored shift order", () => {
    expectPoint(endpoint(String.raw`\begin{tikzpicture}[x=2cm,x={(1,1)},rotate=90,shift={(1,0)}]\draw (0,0)--(1,0);\end{tikzpicture}`), -2, 4);
    expectPoint(endpoint(String.raw`\begin{tikzpicture}[shift={(1,0)},x=2cm,rotate=90]\draw (0,0)--(1,0);\end{tikzpicture}`), 1, 2);
  });

  it("uses basis units for numeric cm translations and leaves named anchors world-valued", () => {
    expectPoint(endpoint(String.raw`\begin{tikzpicture}[x=2cm,cm={1,0,0,1,(1,0)}]\draw (0,0)--(1cm,0cm);\end{tikzpicture}`), 3, 0);
    expectPoint(endpoint(String.raw`\begin{tikzpicture}\coordinate (a) at (1,2);\begin{scope}[${BASIS},rotate=90]\draw (0,0)--(a);\end{scope}\end{tikzpicture}`), 1, 2);
  });

  it("converts calc terms and dimension-valued relative offsets independently", () => {
    expectPoint(endpoint(String.raw`\begin{tikzpicture}[${BASIS}]\draw (1,1)--++(1cm,2)--($(0,0)+(1,2cm)$);\end{tikzpicture}`), 2, 3);
    expectPoint(endpoint(String.raw`\begin{tikzpicture}[${BASIS}]\draw (1,1)--++(1cm,2);\end{tikzpicture}`), 0, 10);
  });

  it("uses unitless radii for basis geometry and dimensional radii for canvas geometry", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[x=2cm,y=1cm,rotate=90]\draw (0,0) circle (1);\draw (0,0) circle (1cm);\end{tikzpicture}`);
    const ellipse = elementsOfKind(result.scene.elements, "Ellipse")[0];
    const circle = elementsOfKind(result.scene.elements, "Circle")[0];
    expect(ellipse?.rx).toBeCloseTo(2 * CM, 4);
    expect(ellipse?.ry).toBeCloseTo(CM, 4);
    expect(circle?.radius).toBeCloseTo(CM, 4);
    const styled = evaluateSemantic(String.raw`\begin{tikzpicture}[x=2cm,y=3cm]\draw[x radius=1cm,y radius=2cm] (0,0) circle;\end{tikzpicture}`);
    const styledEllipse = elementsOfKind(styled.scene.elements, "Ellipse")[0];
    expect(styledEllipse?.rx).toBeCloseTo(2 * CM, 4);
    expect(styledEllipse?.ry).toBeCloseTo(CM, 4);
    expectPoint(endpoint(String.raw`\begin{tikzpicture}[${BASIS},rotate=90]\draw (0,0) arc (0:90:1);\end{tikzpicture}`), -2, -3);
    expectPoint(endpoint(String.raw`\begin{tikzpicture}[${BASIS},rotate=90]\draw (0,0) arc (0:90:1cm);\end{tikzpicture}`), -1, -1);
  });

  it.each(["1", "1cm"])("keeps local arc label slope distinct from world placement: %s", radius => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${BASIS},rotate=25]
      \draw (1,0) arc(0:90:${radius}) node[pos=.25,sloped,anchor=center]{x};\end{tikzpicture}`);
    const node = elementsOfKind(result.scene.elements, "Text")[0];
    if (!node?.transform || node.pathAttachment?.segment.kind !== "arc") throw new Error("Missing arc label");
    const angle = Math.PI / 8;
    const dx = radius === "1" ? -2 * Math.sin(angle) - Math.cos(angle) : -Math.sin(angle);
    const dy = radius === "1" ? -Math.sin(angle) + 3 * Math.cos(angle) : Math.cos(angle);
    const length = Math.hypot(dx, dy);
    expect(node.transform.a).toBeCloseTo(-dx / length, 6);
    expect(node.transform.b).toBeCloseTo(-dy / length, 6);
    expect(node.pathAttachment.segment.localBasis?.x.x).toBeCloseTo((radius === "1" ? 2 : 1) * CM, 4);
  });

  it("keeps default/explicit grid steps dimensional and sums scalar basis vectors before CTM", () => {
    for (const [step, count] of [["", 7], ["[step=1cm]", 7], ["[step=1]", 4]] as const) {
      const result = evaluateSemantic(String.raw`\begin{tikzpicture}[x=2cm,y=3cm,rotate=90]\draw (0,0) grid ${step} (3,2);\end{tikzpicture}`);
      expect(elementsOfKind(result.scene.elements, "Path").filter(path => path.id.includes("scene-grid-x:"))).toHaveLength(count);
    }
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${BASIS}]\draw (0,0) grid [step=1] (2,1);\end{tikzpicture}`);
    expect(elementsOfKind(result.scene.elements, "Path").filter(path => path.id.includes("scene-grid-x:"))).toHaveLength(4);
  });

  it.each([
    { basis: "", inherited: "2cm", local: "xstep=1cm", vertical: 5, horizontal: 3, dx: 1, dy: 2 },
    { basis: "", inherited: "2cm", local: "ystep=1cm", vertical: 3, horizontal: 5, dx: 2, dy: 1 },
    { basis: "x={(2cm,1cm)},y={(1cm,3cm)}", inherited: "2", local: "xstep=1", vertical: 4, horizontal: 3, dx: 4, dy: 7 },
    { basis: "x={(2cm,1cm)},y={(1cm,3cm)}", inherited: "2", local: "ystep=1", vertical: 3, horizontal: 4, dx: 5, dy: 5 }
  ])("preserves raw inherited grid axes under $local and $basis", ({ basis, inherited, local, vertical, horizontal, dx, dy }) => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}[${basis}]\draw[step=${inherited}] (0,0) grid[${local}] (4,4);\end{tikzpicture}`);
    expect(result.diagnostics).toEqual([]);
    const paths = elementsOfKind(result.scene.elements, "Path");
    const xPaths = paths.filter(path => path.id.includes("scene-grid-x:"));
    const yPaths = paths.filter(path => path.id.includes("scene-grid-y:"));
    expect(xPaths).toHaveLength(vertical);
    expect(yPaths).toHaveLength(horizontal);
    const xMove = xPaths[1].commands[0];
    const yMove = yPaths[1].commands[0];
    if (xMove.kind !== "M" || yMove.kind !== "M") throw new Error("Missing grid lines");
    expect(xMove.to.x).toBeCloseTo(dx * CM, 4);
    expect(yMove.to.y).toBeCloseTo(dy * CM, 4);
  });

  it.each(["(1,2)", "(10mm,2)", "(1,20mm)", "(45:1)", "(45:10mm)", "(canvas cs:x=10mm,y=20mm)", "++(canvas cs:x=10mm,y=20mm)", "($(0,0)+(1,2)$)"])("round-trips visual edits in their source frame and units: %s", coordinate => {
    const source = String.raw`\begin{tikzpicture}[${BASIS},rotate=30]\draw (0,0)--${coordinate};\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const handle = result.editHandles.slice().reverse().find(h => h.kind === "path-point");
    if (!handle) throw new Error("Missing handle");
    const target = wp(handle.world.x + 0.4 * CM, handle.world.y - 0.2 * CM);
    const rewritten = rewriteCoordinate(target, handle, source);
    expect(rewritten).not.toBeNull();
    if (!rewritten) return;
    if (coordinate.includes("mm")) expect(rewritten).toContain("mm");
    const updated = source.slice(0, handle.sourceRef.sourceSpan.from) + rewritten + source.slice(handle.sourceRef.sourceSpan.to);
    const actual = endpoint(updated);
    expect(actual.x).toBeCloseTo(target.x, 0);
    expect(actual.y).toBeCloseTo(target.y, 0);
  });

  it("matches fresh evaluation after scoped basis edits and a later incremental handle edit", () => {
    const source = String.raw`\begin{tikzpicture}\begin{scope}[x=2cm]\draw (0,0)--(1,1);\end{scope}\draw (0,0)--(2,2);\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    let parsed = parseTikz(source);
    session.evaluate({ figure: parsed.figure, source, hints: { trigger: "other" } });
    const next = source.replace("x=2cm", "x={(2cm,1cm)}");
    parsed = parseTikz(next);
    const changed = session.evaluate({ figure: parsed.figure, source: next, hints: { trigger: "drag-element", changedSourceIds: [parsed.figure.body[0].id] } });
    expect(changed.semantic).toEqual(evaluateTikzFigure(parsed.figure, next));
    expect(changed.stats.strategy).toBe("incremental");
    const finalSource = next.replace("(2,2)", "(3,2)");
    parsed = parseTikz(finalSource);
    const final = session.evaluate({ figure: parsed.figure, source: finalSource, hints: { trigger: "drag-element", changedSourceIds: [parsed.figure.body.at(-1)!.id] } });
    expect(final.semantic).toEqual(evaluateTikzFigure(parsed.figure, finalSource));
    expect(final.stats.strategy).toBe("incremental");
  });

  it("resolves numeric axes and affine pivots without a supplied coordinate callback", () => {
    const options = parseOptionListRaw("[x={(2cm,1cm)},y={(-1cm,3cm)},cm={1,.2,.3,1,(4pt,5pt)},rotate around={90:(1cm,0cm)}]");
    const resolved = resolveContextDelta(defaultStyle(), identityMatrix(), [{ kind: "scope", rawOptions: [options] }]);
    expect(resolved.diagnostics).toEqual([]);
    expectPoint(resolved.axisBasis.x, 2, 1);
    expectPoint(resolved.axisBasis.y, -1, 3);
    expect(resolved.transform.a).toBeCloseTo(.3, 6);
    expect(resolved.transform.b).toBeCloseTo(1, 6);
    expect(resolved.transform.c).toBeCloseTo(-1, 6);
    expect(resolved.transform.d).toBeCloseTo(-.2, 6);
    expect(resolved.transform.e).toBeCloseTo(.7 * CM + 4, 4);
    expect(resolved.transform.f).toBeCloseTo(-.8 * CM + 5, 4);
  });

  it("reuses the CTM for ordinary basis and explicit components", () => {
    const transform = identityMatrix();
    expect(coordinateTransform(transform, defaultAxisBasis())).toBe(transform);
    expect(coordinateTransform(transform, { x: worldVector(pt(9), pt(8)), y: worldVector(pt(7), pt(6)) }, false, false)).toBe(transform);
  });
});
