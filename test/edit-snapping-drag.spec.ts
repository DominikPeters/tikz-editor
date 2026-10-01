import { describe, expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { applyEditAction, type MoveElementsBaseline } from "../packages/core/src/edit/actions.js";
import {
  buildSnapContext,
  collectSelectionGeometry,
  selectionSnapLines,
  snapSelectionTranslation
} from "../packages/core/src/edit/snapping/index.js";
import { cm, expectPatchesReconstructSource } from "./edit-actions-helpers.js";
import { wp } from "./coords-helpers.js";

const rectangles = String.raw`\begin{tikzpicture}
  \draw (0,3) rectangle (2,1);
  \draw (3,2) rectangle (5,1);
\end{tikzpicture}`;

function evaluate(source: string, sourceFingerprint?: string) {
  return evaluateTikzFigure(parseTikz(source).figure, source, { sourceFingerprint });
}

describe("element dragging through snapping and source rewrites", () => {
  it.each([1, -1])("returns to the exact original coordinates after small moves in direction %s", (direction) => {
    const initial = evaluate(rectangles);
    const elementIds = [initial.scene.elements[1].sourceRef.sourceId];
    const baseline: MoveElementsBaseline = { source: rectangles, editHandles: initial.editHandles };
    const context = buildSnapContext({ sceneElements: initial.scene.elements, selectedSourceIds: elementIds, zoom: 1 });
    const selection = collectSelectionGeometry(initial.scene.elements, elementIds)!;
    let source = rectangles;

    // The old incremental drag loop rounded each 0.016cm move to 0.02cm,
    // finishing at 3.02 or 2.98 when the snap solver requested x=3.
    for (const rawCm of [0.31, 0.326, 0.342, 0.358, 0.374, 0.39, 0]) {
      const snap = snapSelectionTranslation({ context, selection, rawDelta: wp(cm(direction * rawCm), 0) });
      const result = applyEditAction(source, evaluate(source).editHandles, {
        kind: "moveElements", elementIds, baseline, delta: snap.snappedDelta!
      });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") throw new Error(result.kind);
      expectPatchesReconstructSource(source, result);
      source = result.newSource;
      const actual = collectSelectionGeometry(evaluate(source).scene.elements, elementIds)!;
      expect(actual.bounds.minX / cm(1)).toBeCloseTo(Math.round((3 + direction * rawCm) * 100) / 100, 6);
    }
    expect(source).toBe(rectangles);
  });

  it.each([
    String.raw`\draw (0.12345,2) rectangle (2.12345,1);`,
    String.raw`\begin{scope}[rotate=30,scale=2]\draw (0,0) rectangle (2,1);\end{scope}`,
    String.raw`\matrix {\node {A}; & \node {B}; \\};`,
    String.raw`\node[draw] {Root} child {node {Child}};`
  ])("restores original placement syntax after a drag: %s", (body) => {
    const original = `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
    const parsed = parseTikz(original);
    const elementIds = [parsed.figure.body[0].id];
    const initial = evaluate(original, "drag-start-revision");
    const baseline = { source: original, editHandles: initial.editHandles, sourceFingerprint: "drag-start-revision" };
    let source = original;
    for (const delta of [wp(cm(0.31), cm(0.27)), wp(cm(0.326), cm(0.286)), wp(0, 0)]) {
      const result = applyEditAction(source, [], {
        kind: "moveElements", elementIds, baseline, delta
      }, { parseOptions: { sourceFingerprint: "current-revision" } });
      expect(result.kind).toBe("success");
      if (result.kind !== "success") throw new Error(result.kind);
      expectPatchesReconstructSource(source, result);
      expect(result.changedSourceIds).toContain(elementIds[0]);
      source = result.newSource;
    }
    expect(source).toBe(original);
  });

  it("keeps the chosen target and hides its guide when source rounding misses the alignment", () => {
    const original = String.raw`\begin{tikzpicture}
      \draw (1.234,0) rectangle (2.234,1);
      \draw (3,2) rectangle (4,3);
      \draw (1.23,-3) rectangle (2.23,-2);
    \end{tikzpicture}`;
    const initial = evaluate(original);
    const elementIds = [initial.scene.elements[1].sourceRef.sourceId];
    const context = buildSnapContext({
      sceneElements: initial.scene.elements, selectedSourceIds: elementIds, zoom: 1,
      settings: { grid: { enabled: false }, gaps: { enabled: false } }
    });
    const snap = snapSelectionTranslation({
      context, selection: collectSelectionGeometry(initial.scene.elements, elementIds)!, rawDelta: wp(cm(-1.766), 0)
    });
    expect(snap.lines.some(line => line.type === "points" && line.axis === "x")).toBe(true);
    const result = applyEditAction(original, initial.editHandles, {
      kind: "moveElements", elementIds, delta: snap.snappedDelta!
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(result.kind);
    const actual = collectSelectionGeometry(evaluate(result.newSource).scene.elements, elementIds)!;
    expect(actual.bounds.minX / cm(1)).toBeCloseTo(1.23, 6);
    const lines = selectionSnapLines(context, actual, snap.targets!);
    // The nearby third rectangle now happens to align. It must not silently
    // replace the reference that actually caused the snap.
    expect(lines.some(line => line.type === "points" && line.axis === "x")).toBe(false);
  });

  it("excludes transitive node dependents while retaining stationary references", () => {
    const original = String.raw`\begin{tikzpicture}
      \node[draw] (a) at (0,0) {A};
      \node[draw] (b) at (a.center) {B};
      \draw (b.center) rectangle +(2,1);
      \draw (5,0) rectangle (6,1);
    \end{tikzpicture}`;
    const initial = evaluate(original);
    const ids = parseTikz(original).figure.body.map(statement => statement.id);
    const context = buildSnapContext({
      sceneElements: initial.scene.elements, selectedSourceIds: [ids[0]],
      dependencies: initial.dependencies, zoom: 1
    });
    expect(context.selectedSourceIds).toEqual(expect.arrayContaining(ids.slice(0, 3)));
    expect(context.referenceBounds.map(bounds => bounds.sourceId)).toEqual([ids[3]]);
    expect(context.referencePoints.every(point => point.sourceId === ids[3])).toBe(true);
    expect(context.visibleGaps).toEqual({ horizontal: [], vertical: [] });
  });
});
