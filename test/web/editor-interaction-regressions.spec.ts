import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../../packages/app/src/compute";
import { applyEditAction } from "../../packages/core/src/edit/actions";
import { PT_PER_CM } from "../../packages/core/src/edit/format";
import { wp } from "../coords-helpers.js";

const cm = (value: number): number => value * PT_PER_CM;

describe("cutover regressions", () => {
  it("emits unpadded SVG viewBox for recognized fixed figure bounds", async () => {
    const auto = await computeSnapshot({
      id: "auto-bounds-padding",
      kind: "render",
      source: String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
\end{tikzpicture}`
    });
    const fixed = await computeSnapshot({
      id: "fixed-bounds-padding",
      kind: "render",
      source: String.raw`\begin{tikzpicture}
  \useasboundingbox (0,0) rectangle (1,1);
  \draw (0.2,0.8) rectangle (0.8,0.2);
\end{tikzpicture}`
    });

    expect(auto.snapshot.svg?.viewBox.width).toBeGreaterThan(cm(1));
    expect(fixed.snapshot.svg?.viewBox.x).toBeCloseTo(0, 6);
    expect(fixed.snapshot.svg?.viewBox.y).toBeCloseTo(0, 6);
    expect(fixed.snapshot.svg?.viewBox.width).toBeCloseTo(cm(1), 6);
    expect(fixed.snapshot.svg?.viewBox.height).toBeCloseTo(cm(1), 6);
  });

  it("updates rendered scene after source edits", async () => {
    const sourceA = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
\end{tikzpicture}`;
    const sourceB = String.raw`\begin{tikzpicture}
  \node[draw] at (2,1) {A};
\end{tikzpicture}`;

    const first = await computeSnapshot({
      id: "cutover-render-a",
      kind: "render",
      source: sourceA
    });
    const second = await computeSnapshot({
      id: "cutover-render-b",
      kind: "render",
      source: sourceB
    });

    const firstText = first.snapshot.scene?.elements.find((element) => element.kind === "Text");
    const secondText = second.snapshot.scene?.elements.find((element) => element.kind === "Text");
    expect(firstText).toBeDefined();
    expect(secondText).toBeDefined();
    if (!firstText || !secondText || firstText.kind !== "Text" || secondText.kind !== "Text") {
      throw new Error("Expected text elements in both snapshots.");
    }

    expect(firstText.position).toEqual(wp(0, 0));
    expect(secondText.position).toEqual(wp(cm(2), cm(1)));
    expect(first.snapshot.svg?.svg).not.toEqual(second.snapshot.svg?.svg);
  });

  it("keeps handle-driven edits working after a code edit and recompute", async () => {
    const baseSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
  \draw (2,2) -- (3,3);
\end{tikzpicture}`;
    const editedSource = String.raw`\begin{tikzpicture}
  % formatting-only edit before drag
  \draw (0,0) -- (1,1);
  \draw (2,2) -- (3,3);
\end{tikzpicture}`;

    await computeSnapshot({
      id: "cutover-drag-prewarm",
      kind: "render",
      source: baseSource
    });
    const recomputed = await computeSnapshot({
      id: "cutover-drag-recompute",
      kind: "render",
      source: editedSource
    });

    const secondPathHandle = recomputed.snapshot.editHandles.find(
      (handle) => handle.kind === "path-point" && handle.sourceRef.sourceId === "path:1"
    );
    expect(secondPathHandle).toBeDefined();
    if (!secondPathHandle) {
      throw new Error("Expected a path-point handle for path:1");
    }

    const moved = applyEditAction(editedSource, recomputed.snapshot.editHandles, {
      kind: "moveHandle",
      handleId: secondPathHandle.id,
      newWorld: wp(
        secondPathHandle.world.x + cm(1),
        secondPathHandle.world.y + cm(1)
      )
    });

    expect(moved.kind).toBe("success");
  });

  it("keeps grouped children incrementally draggable without source-id mismatch fallback", async () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \node[draw] (A) at (-1, -1) {A};
    \node[draw] (B) at (1, -1) {B};
  \end{scope}
  \draw (-1.35,-2.28) rectangle (2.2,-3.4);
\end{tikzpicture}`;

    const initial = await computeSnapshot({
      id: "grouped-drag-base",
      kind: "render",
      source
    });
    const initialSourceIds = new Set((initial.snapshot.scene?.elements ?? []).map((element) => element.sourceRef.sourceId));
    expect(initialSourceIds.has("path:1")).toBe(true);
    expect(initialSourceIds.has("path:2")).toBe(true);

    const moved = applyEditAction(source, initial.snapshot.editHandles, {
      kind: "moveElements",
      elementIds: ["path:1", "path:2"],
      delta: wp(cm(0.2), cm(0.1))
    });
    expect(moved.kind === "success" || moved.kind === "partial").toBe(true);
    if (moved.kind !== "success" && moved.kind !== "partial") {
      return;
    }

    const next = await computeSnapshot({
      id: "grouped-drag-next",
      kind: "render",
      source: moved.newSource,
      activeFigureId: initial.snapshot.activeFigureId,
      trigger: "drag-element",
      changedSourceIds: moved.changedSourceIds ?? null,
      patches: moved.patches
    });

    expect(next.snapshot.incremental?.parseFallbackReason).not.toBe("patch-source-id-mismatch");
  });
});
