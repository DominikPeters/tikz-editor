import { describe, expect, it } from "vitest";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import type { EditHandle } from "../../packages/core/src/semantic/types.js";
import { wp } from "../coords-helpers.js";

const picture = (statement: string) => String.raw`\begin{tikzpicture}
${statement}
\end{tikzpicture}`;

function handles(source: string): EditHandle[] {
  return evaluateTikzFigure(parseTikz(source, { recover: true }).figure, source).editHandles;
}

const degrees = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;

describe("to curves are computed in the coordinates they are read in", () => {
  it("turns `out` and `in` with the CTM, as PGF's topaths does", () => {
    const all = handles(picture(String.raw`\draw[rotate=90] (0,0) to[out=0,in=180] (2,0);`));
    const [start] = all.filter(handle => handle.kind === "path-point");
    const [out, into] = all.filter(handle => handle.kind === "path-control");
    // `out=0` leaves along the rotated x axis, straight up, towards the target.
    expect(Math.abs(out.world.x - start.world.x)).toBeLessThan(1e-6);
    expect(out.world.y).toBeGreaterThan(start.world.y);
    expect(Math.abs(into.world.x - start.world.x)).toBeLessThan(1e-6);
  });

  it("writes the angle a control is dragged to in the curve's own coordinates", () => {
    const source = picture(String.raw`\draw[rotate=90,xscale=2] (0,0) to[out=0,in=180] (2,0);`);
    const all = handles(source);
    const start = all.find(handle => handle.kind === "path-point")!.world;
    const out = all.find(handle => handle.kind === "path-control")!;
    const target = wp(start.x - 20, start.y + 20);
    const result = applyEditAction(source, all, { kind: "moveHandle", handleId: out.id, newWorld: target });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const moved = handles(result.newSource).find(handle => handle.kind === "path-control")!.world;
    // The new control leaves towards the dragged point, to the degree the angle is written in.
    expect(Math.abs(degrees(moved.x - start.x, moved.y - start.y) - degrees(target.x - start.x, target.y - start.y))).toBeLessThan(1.5);
  });

  it("keeps a dragged bend where it was dragged under a stretch", () => {
    const source = picture(String.raw`\draw[xscale=2] (0,0) to[bend left=30] (2,0);`);
    const all = handles(source);
    const bend = all.find(handle => handle.kind === "path-bend")!;
    const target = wp(bend.world.x, bend.world.y + 10);
    const result = applyEditAction(source, all, { kind: "moveHandle", handleId: bend.id, newWorld: target });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const moved = handles(result.newSource).find(handle => handle.kind === "path-bend")!.world;
    expect(Math.hypot(moved.x - target.x, moved.y - target.y)).toBeLessThan(2);
  });
});
