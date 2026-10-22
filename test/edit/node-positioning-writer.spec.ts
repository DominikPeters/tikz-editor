import { describe, expect, it } from "vitest";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { createCoordinateWriter } from "../../packages/core/src/edit/writer/index.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { collectSourceWorldBounds } from "../../packages/core/src/edit/snapping/index.js";
import { wp } from "../coords-helpers.js";

const A = String.raw`\node[draw] (A) at (0,1) {A};`;

function evaluate(source: string) {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
  return evaluateTikzFigure(parsed.figure, source);
}

const picture = (...statements: string[]) => String.raw`\begin{tikzpicture}
${statements.join("\n")}
\end{tikzpicture}`;

function positionOf(source: string, sourceId: string) {
  const handle = evaluate(source).editHandles.find(candidate => candidate.sourceRef.sourceId === sourceId && candidate.kind === "node-position");
  if (!handle) throw new Error(`no position handle for ${sourceId}`);
  return handle.world;
}

describe("positioned nodes", () => {
  it("stand where the positioning puts them, whatever shifts the node adds on top", () => {
    const plain = positionOf(picture(A, String.raw`\node[right=1cm of A] {B};`), "path:1");
    for (const own of ["xshift=3mm", "rotate=-35,xshift=3mm", "xshift=3mm,rotate=-35", "yshift=-2mm,rotate=20"]) {
      const shifted = positionOf(picture(A, String.raw`\node[right=1cm of A,${own}] {B};`), "path:1");
      const rotated = own.includes("rotate") ? positionOf(picture(A, String.raw`\node[right=1cm of A,${own.replace(/[xy]shift=[^,]*,?/g, "").replace(/,$/, "")}] {B};`), "path:1") : plain;
      expect([own, shifted.x.toFixed(3), shifted.y.toFixed(3)]).toEqual([own, rotated.x.toFixed(3), rotated.y.toFixed(3)]);
    }
  });

  it("move to where they are dragged when they have shifts and a rotation of their own", () => {
    const source = picture(A, String.raw`\node[right=1cm of A,rotate=-35,xshift=3mm] {B};`);
    const handle = evaluate(source).editHandles.find(candidate => candidate.sourceRef.sourceId === "path:1" && candidate.kind === "node-position")!;
    const target = wp(handle.world.x + 12.3, handle.world.y - 20.1);
    const result = applyEditAction(source, evaluate(source).editHandles, { kind: "moveHandle", handleId: handle.id, newWorld: target, bypassSnapping: true });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const after = positionOf(result.newSource, "path:1");
    expect(Math.hypot(after.x - target.x, after.y - target.y)).toBeLessThan(0.3); // two decimals of a cm
  });

  it("are copied and aligned exactly, not snapped to a direction", () => {
    const source = picture(A, String.raw`\node[right=1cm of A] {B};`);
    const handles = evaluate(source).editHandles;
    const before = positionOf(source, "path:1");
    const duplicated = applyEditAction(source, handles, { kind: "duplicateElements", elementIds: ["path:1"], delta: wp(10, -30) });
    expect(duplicated.kind).toBe("success");
    if (duplicated.kind !== "success") return;
    const copy = evaluate(duplicated.newSource).editHandles.filter(handle => handle.kind === "node-position" && handle.sourceRef.sourceId === "path:2")[0]!;
    expect([copy.world.x, copy.world.y].map(Math.round)).toEqual([before.x + 10, before.y - 30].map(Math.round));

    const aligned = applyEditAction(source, handles, { kind: "alignElements", elementIds: ["path:0", "path:1"], mode: "top" });
    expect(aligned.kind).toBe("success");
    if (aligned.kind !== "success") return;
    const bounds = collectSourceWorldBounds(evaluate(aligned.newSource).scene.elements);
    expect(bounds.get("path:1")!.maxY).toBeCloseTo(bounds.get("path:0")!.maxY, 1);
  });

  it("are positioned from anchors a rotated, unnamed node really has", () => {
    // A rotated rectangle's west anchor is not at its bounds' west edge.
    for (const own of ["rotate=-35", "circle"]) {
      const source = picture(A, String.raw`\node[draw,${own}] at (2,1.5) {B};`);
      const before = positionOf(source, "path:1");
      const result = applyEditAction(source, evaluate(source).editHandles, { kind: "positionNodeRelativeTo", nodeId: "path:1", targetNodeName: "A", targetNodeSourceId: "path:0", bypassSnapping: true });
      if (result.kind !== "success") {
        expect(result.kind).toBe("unsupported");
        continue;
      }
      const after = positionOf(result.newSource, "path:1");
      expect([own, Math.round(after.x), Math.round(after.y)]).toEqual([own, Math.round(before.x), Math.round(before.y)]);
    }
  });

  it("take a later anchor= over the anchor the positioning implies", () => {
    const anchorOf = (options: string, anchor: string) => evaluate(picture(A, String.raw`\node[draw,${options}] (B) {B};`)).nodeAnchorTargets.find(target => target.nodeName === "B" && target.anchor === anchor)!.world;
    expect(anchorOf("anchor=north,right=1cm of A", "center")).toEqual(anchorOf("right=1cm of A", "center"));
    // B's north sits where the implied anchor, its west, would.
    const north = anchorOf("right=1cm of A,anchor=north", "north");
    const west = anchorOf("right=1cm of A", "west");
    expect([north.x, north.y].map(value => value.toFixed(3))).toEqual([west.x, west.y].map(value => value.toFixed(3)));
  });

  it("keep where they are drawn when positioned relative to another node", () => {
    const drawnCenter = (source: string) => {
      const center = evaluate(source).nodeAnchorTargets.find(target => target.nodeName === "B" && target.anchor === "center");
      if (!center) throw new Error("no center for B");
      return center.world;
    };
    for (const own of ["", "xshift=3mm", "yshift=-2mm", "xshift=3mm,anchor=north", "anchor=north west", "rotate=-35,xshift=3mm", "shift={(0.5,0.2)}", "xshift=3mm,shift={(0.5,0.2)}"]) {
      for (const at of ["(2,2)", "(-2,-1)"]) {
        const source = picture(A, String.raw`\node[draw${own ? `,${own}` : ""}] (B) at ${at} {B};`);
        const before = drawnCenter(source);
        const result = applyEditAction(source, evaluate(source).editHandles, { kind: "positionNodeRelativeTo", nodeId: "path:1", targetNodeName: "A", targetNodeSourceId: "path:0", bypassSnapping: true });
        if (result.kind !== "success") {
          expect([own, at, result.kind]).toEqual([own, at, "unsupported"]);
          continue;
        }
        const after = drawnCenter(result.newSource);
        expect([own, at, Math.hypot(after.x - before.x, after.y - before.y) < 0.3]).toEqual([own, at, true]);
      }
    }
  });

  it("writes canvas distances, which carry no frame", () => {
    const source = picture(A, String.raw`\node[right=1cm of A] {B};`);
    const handle = evaluate(source).editHandles.find(candidate => candidate.sourceRef.sourceId === "path:1" && candidate.handleType === "node-positioning")!;
    if (handle.handleType !== "node-positioning") throw new Error("not a positioning handle");
    const writer = createCoordinateWriter(source);
    // Straight right of A by 3cm more: a cardinal direction, then a diagonal when it also rises.
    const right = writer.positioning(handle.positioningContext, wp(handle.world.x + 3 * 28.45276, handle.world.y));
    expect(right.kind === "ok" && right.fragment).toMatch(/^right=[\d.]+cm of A$/);
    const diagonal = writer.positioning(handle.positioningContext, wp(handle.world.x + 3 * 28.45276, handle.world.y + 28.45276), { bypassSnapping: true });
    expect(diagonal.kind === "ok" && diagonal.fragment).toMatch(/^above right=\{[\d.]+cm and [\d.]+cm\} of A$/);
  });
});
