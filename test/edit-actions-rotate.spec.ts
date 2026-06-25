import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import type { ScenePath } from "../packages/core/src/semantic/types.js";
import { wp } from "./coords-helpers.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";

describe("applyEditAction - rotateElement", () => {
  it("converts an explicit rectangle to center-pivot rotate without changing its visual pose", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=32] (2.85,1.03) rectangle (3.33,0.55);
\end{tikzpicture}`;

    const beforePoints = pathCommandPoints(source, "path:0");
    const result = applyEditAction(source, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "center-pivot",
      angleDeg: 32,
      baselineSource: source
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("rotate around={32:");
    expect(result.newSource).not.toContain("rotate=32");
    expectPathPointsClose(pathCommandPoints(result.newSource, "path:0"), beforePoints);
    expectPatchesReconstructSource(source, result);
  });

  it("writes center-pivot rotate around for explicit circles and ellipses", () => {
    const circleSource = String.raw`\begin{tikzpicture}
  \draw[rotate=15] (1,0) circle (0.5cm);
\end{tikzpicture}`;
    const ellipseSource = String.raw`\begin{tikzpicture}
  \draw[rotate=15] (1,0) ellipse [x radius=0.75cm, y radius=0.25cm];
\end{tikzpicture}`;

    const circle = applyEditAction(circleSource, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "center-pivot",
      angleDeg: 30,
      baselineSource: circleSource
    });
    const ellipse = applyEditAction(ellipseSource, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "center-pivot",
      angleDeg: 30,
      baselineSource: ellipseSource
    });

    expect(circle.kind).toBe("success");
    expect(ellipse.kind).toBe("success");
    if (circle.kind !== "success" || ellipse.kind !== "success") return;
    expect(circle.newSource).toContain("rotate around={30:");
    expect(ellipse.newSource).toContain("rotate around={30:");
    expect(circle.newSource).not.toContain("rotate=15");
    expect(ellipse.newSource).not.toContain("rotate=15");
  });

  it("restores an origin rotate from the pre-Alt baseline when leaving center-pivot mode", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=10] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const centered = applyEditAction(source, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "center-pivot",
      angleDeg: 25,
      baselineSource: source
    });
    expect(centered.kind).toBe("success");
    if (centered.kind !== "success") return;

    const restored = applyEditAction(centered.newSource, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "origin",
      angleDeg: 40,
      baselineSource: source
    });

    expect(restored.kind).toBe("success");
    if (restored.kind !== "success") return;
    expect(restored.newSource).toContain("rotate=40");
    expect(restored.newSource).not.toContain("rotate around");
    expect(restored.newSource).toContain("(0,0) rectangle (1,1)");
  });

  it("computes center-pivot rotate from the pre-edit baseline instead of the current drag source", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate=10] (0,0) rectangle (2,1);
\end{tikzpicture}`;
    const normal = applyEditAction(source, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "property",
      angleDeg: 40,
      baselineSource: source
    });
    expect(normal.kind).toBe("success");
    if (normal.kind !== "success") return;

    const fromCurrentDragSource = applyEditAction(normal.newSource, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "center-pivot",
      angleDeg: 40,
      baselineSource: source
    });
    const directFromPreEdit = applyEditAction(source, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "center-pivot",
      angleDeg: 40,
      baselineSource: source
    });

    expect(fromCurrentDragSource.kind).toBe("success");
    expect(directFromPreEdit.kind).toBe("success");
    if (fromCurrentDragSource.kind !== "success" || directFromPreEdit.kind !== "success") return;
    expect(fromCurrentDragSource.newSource).toBe(directFromPreEdit.newSource);
    expectPatchesReconstructSource(normal.newSource, fromCurrentDragSource);
  });

  it("keeps an authored rotate-around context after a rotate drag passes through zero", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate around={10:(1,0.5)}] (0,0) rectangle (2,1);
\end{tikzpicture}`;

    const zero = applyEditAction(source, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "property",
      angleDeg: 0,
      baselineSource: source
    });
    expect(zero.kind).toBe("success");
    if (zero.kind !== "success") return;
    expect(zero.newSource).not.toContain("rotate around");

    const continued = applyEditAction(zero.newSource, [], {
      kind: "rotateElement",
      elementId: "path:0",
      targetId: "path:0",
      mode: "property",
      angleDeg: -5,
      baselineSource: source
    });
    expect(continued.kind).toBe("success");
    if (continued.kind !== "success") return;
    expect(continued.newSource).toContain("rotate around={-5:(1,0.5)}");
    expect(continued.newSource).not.toContain("rotate=-5");
    expectPatchesReconstructSource(zero.newSource, continued);
  });

  it("moves center rotate-around pivots with explicit path shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate around={32:(0.5,0.5)}] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source, { recover: true }).figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("rotate around={32:(1.5,2.5)}");
  });

  it("leaves authored external rotate-around pivots unchanged when moving", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[rotate around={32:(0,0)}] (0,0) rectangle (1,1);
\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source, { recover: true }).figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "moveElement",
      elementId: "path:0",
      delta: wp(cm(1), cm(2))
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("rotate around={32:(0,0)}");
  });

  it("moves center rotate-around pivots when aligning explicit path shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
  \draw[rotate around={0:(3.5,2.5)}] (3,2) rectangle (4,3);
\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source, { recover: true }).figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "alignElements",
      elementIds: ["path:0", "path:1"],
      mode: "left"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("rotate around={0:(0.5,2.5)}");
  });

  it("moves center rotate-around pivots when distributing explicit path shapes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
  \draw[rotate around={0:(3.5,0.5)}] (3,0) rectangle (4,1);
  \draw (10,0) rectangle (11,1);
\end{tikzpicture}`;
    const semantic = evaluateTikzFigure(parseTikz(source, { recover: true }).figure, source);

    const result = applyEditAction(source, semantic.editHandles, {
      kind: "distributeElements",
      elementIds: ["path:0", "path:1", "path:2"],
      axis: "horizontal"
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain("rotate around={0:(5.5,0.5)}");
  });
});

function pathCommandPoints(source: string, sourceId: string): Array<{ x: number; y: number }> {
  const parsed = parseTikz(source, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, source);
  const path = semantic.scene.elements.find(
    (element): element is ScenePath => element.kind === "Path" && element.sourceRef.sourceId === sourceId
  );
  if (!path) {
    throw new Error(`Missing path ${sourceId}`);
  }
  return path.commands.flatMap((command) => {
    if (command.kind === "M" || command.kind === "L") {
      return [{ x: command.to.x, y: command.to.y }];
    }
    if (command.kind === "C") {
      return [
        { x: command.c1.x, y: command.c1.y },
        { x: command.c2.x, y: command.c2.y },
        { x: command.to.x, y: command.to.y }
      ];
    }
    if (command.kind === "A") {
      return [{ x: command.to.x, y: command.to.y }];
    }
    return [];
  });
}

function expectPathPointsClose(actual: Array<{ x: number; y: number }>, expected: Array<{ x: number; y: number }>): void {
  expect(actual).toHaveLength(expected.length);
  for (let index = 0; index < actual.length; index += 1) {
    expect(Math.abs(actual[index]!.x - expected[index]!.x)).toBeLessThan(0.15);
    expect(Math.abs(actual[index]!.y - expected[index]!.y)).toBeLessThan(0.15);
  }
}
