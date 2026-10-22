import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { applyMatrix } from "../../packages/core/src/semantic/transform.js";
import { worldPoint, pt } from "../../packages/core/src/coords/index.js";

type Probe = { kind: string; x: number; y: number };
const oracle = JSON.parse(readFileSync(new URL("../fixtures/coordinate-oracles/coordinates.json", import.meta.url), "utf8")) as {
  cases: Array<{ id: string; kind: "node" | "path"; source: string; expected: Probe[] }>;
};

describe("coordinates agree with recorded PGF probes", () => {
  it("keeps mid-path transforms local to their statement", () => {
    const source = String.raw`\begin{tikzpicture}[x=2cm,y=1.6cm]
\draw (0,0) -- (1,0) [rotate=30] -- (1,1);
\draw (1,1) -- (2,1);
\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source).figure, source);
    const points = semantic.editHandles.filter(handle => handle.sourceRef.sourceId === "path:1");
    expect(points).toHaveLength(2);
    expect(points[0].world.x).toBeCloseTo(56.9055, 3);
    expect(points[0].world.y).toBeCloseTo(45.5244, 3);
    expect(points[1].world.x).toBeCloseTo(113.811, 3);
    expect(points[1].world.y).toBeCloseTo(45.5244, 3);
  });

  it.each(oracle.cases)("$id", entry => {
    const probes = entry.kind === "node"
      ? entry.expected.map(probe => `(N.${probe.kind})`).join(" -- ")
      : null;
    const source = probes ? entry.source.replace("\\end{tikzpicture}", `\\draw ${probes};\n\\end{tikzpicture}`) : entry.source;
    const semantic = evaluateTikzFigure(parseTikz(source).figure, source);
    const actual = probes
      ? semantic.editHandles.filter(handle => handle.sourceText.startsWith("(N.")).map(handle => handle.world)
      : semantic.scene.elements.flatMap(element => element.kind !== "Path" ? [] : element.commands.flatMap(command => {
        const points = command.kind === "M" || command.kind === "L" ? [command.to] : command.kind === "C" ? [command.c1, command.c2, command.to] : [];
        return points.map(point => element.transform ? applyMatrix(element.transform, point) : point);
      }));
    expect(actual).toHaveLength(entry.expected.length);
    for (const [index, expected] of entry.expected.entries()) {
      const point = actual[index];
      expect(point, expected.kind).toBeDefined();
      expect(Math.hypot(point.x - expected.x, point.y - expected.y), expected.kind).toBeLessThan(.02);
    }
    if (entry.kind === "node") {
      const center = entry.expected.find(point => point.kind === "center")!;
      const handle = semantic.editHandles.find(handle => handle.kind === "node-position");
      const placement = handle?.handleType === "coordinate" ? handle.nodePlacement : undefined;
      expect(placement).toBeDefined();
      expect(Math.hypot(placement!.drawnCenter.x - center.x, placement!.drawnCenter.y - center.y)).toBeLessThan(.02);
      for (const expected of entry.expected.filter(point => point.kind !== "center")) {
        const offset = placement!.anchorOffsets[expected.kind];
        expect(offset).toBeDefined();
        const anchor = worldPoint(pt(center.x + offset.x), pt(center.y + offset.y));
        expect(Math.hypot(anchor.x - expected.x, anchor.y - expected.y)).toBeLessThan(.02);
      }
    }
  });
});
