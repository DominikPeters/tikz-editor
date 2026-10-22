import { describe, expect, it } from "vitest";
import { applyEditAction, type EditAction } from "../../packages/core/src/edit/actions.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { collectSourceWorldBounds } from "../../packages/core/src/edit/snapping/index.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import { wp } from "../coords-helpers.js";

const picture = (options: string, ...statements: string[]) => String.raw`\begin{tikzpicture}[${options}]
${statements.join("\n")}
\end{tikzpicture}`;

function evaluate(source: string) {
  return evaluateTikzFigure(parseTikz(source, { recover: true, includeContextDefinitions: true }).figure, source);
}

/** Half the world width and height of what a statement draws. */
function worldRadii(source: string, sourceId: string): [number, number] {
  const bounds = collectSourceWorldBounds(evaluate(source).scene.elements).get(sourceId);
  if (!bounds) throw new Error(`nothing drawn for ${sourceId}`);
  return [(bounds.maxX - bounds.minX) / 2, (bounds.maxY - bounds.minY) / 2];
}

function apply(source: string, action: EditAction) {
  return applyEditAction(source, evaluate(source).editHandles, action);
}

/** Bounds carry half the line width, 0.2pt. */
const close = (actual: [number, number], expected: [number, number]) =>
  expect(actual.map((value, index) => Math.abs(value - expected[index]!) < 0.4)).toEqual([true, true]);

describe("radii are written in the frame they are read in", () => {
  it("draws a new circle with the world radius it was dragged to", () => {
    for (const options of ["", "x=2cm,y=2cm", "scale=2", "rotate=30,scale=1.5", "xscale=2"]) {
      const source = picture(options, String.raw`\draw (0,0) -- (1,0);`);
      const result = apply(source, { kind: "addElement", at: wp(0, 0), template: { kind: "circle", edge: wp(PT_PER_CM, 0) } });
      expect([options, result.kind]).toEqual([options, "success"]);
      if (result.kind !== "success") continue;
      close(worldRadii(result.newSource, "path:1"), [PT_PER_CM, PT_PER_CM]);
    }
  });

  it("refuses a circle in a skewed frame and an ellipse the frame turns", () => {
    expect(apply(picture("cm={1,0,1,1,(0,0)}", String.raw`\draw (0,0) -- (1,0);`),
      { kind: "addElement", at: wp(0, 0), template: { kind: "circle", edge: wp(PT_PER_CM, 0) } }).kind).toBe("unsupported");
    expect(apply(picture("rotate=30", String.raw`\draw (0,0) -- (1,0);`),
      { kind: "addElement", at: wp(0, 0), template: { kind: "ellipse", corner: wp(2 * PT_PER_CM, PT_PER_CM) } }).kind).toBe("unsupported");
    const turned = apply(picture("rotate=90", String.raw`\draw (0,0) -- (1,0);`),
      { kind: "addElement", at: wp(0, 0), template: { kind: "ellipse", corner: wp(2 * PT_PER_CM, PT_PER_CM) } });
    expect(turned.kind).toBe("success");
    if (turned.kind === "success") close(worldRadii(turned.newSource, "path:1"), [PT_PER_CM, PT_PER_CM / 2]);
  });

  it("resizes a radius in its own spelling, through the axis vectors when it is unitless", () => {
    for (const [options, circle, written] of [
      ["x=2cm,y=2cm", String.raw`\draw (1,1) circle (.5);`, "circle (1.5)"],
      ["x=2cm,y=2cm", String.raw`\draw (1,1) circle (5mm);`, "circle (30mm)"],
      ["scale=2", String.raw`\draw (1,1) circle [radius=1];`, "radius=1.5"],
      ["", String.raw`\draw (1,1) ellipse (1cm and 5mm);`, "ellipse (3cm and 5mm)"]
    ] as const) {
      const source = picture(options, circle);
      const center = evaluate(source).editHandles.find(handle => handle.sourceRef.sourceId === "path:0" && handle.kind === "path-point")!.world;
      const result = apply(source, { kind: "resizeElement", elementId: "path:0", role: "right", newWorld: wp(center.x + 3 * PT_PER_CM, center.y) });
      expect([circle, result.kind]).toEqual([circle, "success"]);
      if (result.kind !== "success") continue;
      expect(result.newSource).toContain(written);
      expect(Math.abs(worldRadii(result.newSource, "path:0")[0] - 3 * PT_PER_CM)).toBeLessThan(0.4);
    }
  });
});
