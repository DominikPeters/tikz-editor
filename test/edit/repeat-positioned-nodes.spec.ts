import { describe, expect, it } from "vitest";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { cm } from "../edit-actions-helpers.js";

const picture = (...statements: string[]) => String.raw`\begin{tikzpicture}
${statements.join("\n")}
\end{tikzpicture}`;

const step = { columns: 3, rows: 1, horizontalStep: cm(2), verticalStep: cm(1) };

function repeat(source: string, elementIds: string[]) {
  return applyEditAction(source, [], { kind: "repeatElements", elementIds, ...step });
}

/** The x of every node the figure draws, left to right. */
function nodeXs(source: string) {
  const parsed = parseTikz(source, { recover: true });
  return evaluateTikzFigure(parsed.figure, source).editHandles
    .filter((handle) => handle.kind === "node-position")
    .map((handle) => handle.world.x)
    .sort((left, right) => left - right);
}

describe("repeatElements with positioned nodes", () => {
  it("refuses a node positioned relative to a node outside the copy", () => {
    const source = picture(String.raw`\node[draw] (A) at (0,0) {A};`, String.raw`\node[right=1cm of A] {B};`);
    const result = repeat(source, ["path:1"]);
    expect(result).toEqual({
      kind: "unsupported",
      reason: "Repeat cannot step what is placed at or relative to a node outside the copy."
    });
  });

  it("refuses every spelling of a placement relative to an outside node", () => {
    for (const option of ["right=1cm of A", "above left={1cm and 2cm} of A.north", "below=of A", "right of=A", "left=of A"]) {
      const source = picture(String.raw`\node[draw] (A) at (0,0) {A};`, String.raw`\node[${option}] {B};`);
      expect(repeat(source, ["path:1"]).kind, option).toBe("unsupported");
    }
  });

  it("refuses statements whose every point is an outside node, and steps the rest", () => {
    for (const statement of [String.raw`\node at (A.east) {B};`, String.raw`\path (A.east) node {B};`, String.raw`\draw (A) -- (A.north);`]) {
      expect(repeat(picture(String.raw`\node[draw] (A) at (0,0) {A};`, statement), ["path:1"]).kind, statement).toBe("unsupported");
    }
    for (const statement of [String.raw`\draw (A) -- (1,1);`, String.raw`\node at ([xshift=1cm]0,0) {B};`]) {
      expect(repeat(picture(String.raw`\node[draw] (A) at (0,0) {A};`, statement), ["path:1"]).kind, statement).toBe("success");
    }
  });

  it("keeps a node whose placement is not relative to a named node", () => {
    const source = picture(String.raw`\node[right=1cm] at (0,0) {B};`, String.raw`\node[above=of (1,1)] {C};`);
    expect(repeat(source, ["path:0", "path:1"]).kind).toBe("success");
  });

  it("repeats a node together with the node it is positioned against", () => {
    const source = picture(String.raw`\node[draw] (A) at (0,0) {A};`, String.raw`\node[right=1cm of A] {B};`);
    const result = repeat(source, ["path:0", "path:1"]);
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    // Each pass puts its B 1cm right of its own A, so the pairs advance by the step.
    const xs = nodeXs(result.newSource);
    expect(xs).toHaveLength(6);
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBe(6);
    const passStep = step.horizontalStep;
    for (let pass = 0; pass < 3; pass += 1) {
      expect(xs[2 * pass]).toBeCloseTo(passStep * pass, 2);
      expect(xs[2 * pass + 1]! - xs[2 * pass]!).toBeCloseTo(xs[1]! - xs[0]!, 2);
    }
  });

  it("still repeats a plain absolute node", () => {
    const result = repeat(picture(String.raw`\node[draw] at (0,0) {A};`), ["path:0"]);
    expect(result.kind).toBe("success");
    expect(result.kind === "success" && result.newSource).toContain(String.raw`\node[draw] at (\i*2,0) {A};`);
  });
});
