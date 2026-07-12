import { describe, expect, it } from "vitest";

import { computeSnapshot } from "../../packages/app/src/compute.js";
import { deriveSingleSourcePatch } from "../../packages/app/src/store/source-patch-diff.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import { wp } from "../coords-helpers.js";

function normalizeForSceneComparison<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, currentValue) => {
      if (key === "id" || key === "runtimeId" || key === "sourceId") {
        return undefined;
      }
      // Native text cache keys are anchored to the node's source-map position
      // (`|sm:<hash>`), and the paragraph id is derived from the anchored key.
      // Selective replay reuses measures taken at the pre-edit position, so
      // these anchors legitimately differ from a canonical recompute; the
      // unanchored key still compares mode/text/width/font identity.
      if (key === "cacheKey" && typeof currentValue === "string") {
        return currentValue.replace(/\|sm:[a-z0-9]+$/, "");
      }
      if (key === "paragraphId" && typeof currentValue === "string" && currentValue.startsWith("tex:")) {
        return "tex:<anchor-normalized>";
      }
      return currentValue;
    })
  ) as T;
}

describe("computeSnapshot incremental parser integration", () => {
  it("keeps path endpoint handles rewritable across consecutive incremental drag frames", async () => {
    const documentId = "consecutive-handle-drag-doc";
    const source = String.raw`\begin{tikzpicture}
  \draw (1,2) -- (3,2);
\end{tikzpicture}`;
    const seeded = await computeSnapshot({
      id: "consecutive-handle-drag-seed",
      documentId,
      kind: "render",
      source,
      sourceRevision: 0,
      activeFigureId: "figure:0"
    });
    const endpoint = seeded.snapshot.editHandles.find(
      (handle) => handle.kind === "path-point" && handle.sourceRef.sourceId === "path:0" && handle.sourceText === "(3,2)"
    );
    if (!endpoint) {
      throw new Error("Expected right endpoint handle.");
    }

    const first = applyEditAction(
      source,
      seeded.snapshot.editHandles,
      {
        kind: "moveHandle",
        handleId: endpoint.id,
        newWorld: wp(2.8 * PT_PER_CM, 1.6 * PT_PER_CM)
      },
      { parseOptions: { sourceFingerprint: `source-revision:${documentId}:0:${source.length}` } }
    );
    expect(first.kind).toBe("success");
    if (first.kind !== "success") {
      throw new Error(`first moveHandle failed: ${first.kind}`);
    }

    const firstSnapshot = await computeSnapshot({
      id: "consecutive-handle-drag-first",
      documentId,
      kind: "render",
      source: first.newSource,
      sourceRevision: 1,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: first.changedSourceIds,
      patches: first.patches,
      trigger: "drag-handle"
    });
    const nextEndpoint = firstSnapshot.snapshot.editHandles.find(
      (handle) => handle.kind === "path-point" && handle.sourceRef.sourceId === "path:0" && handle.sourceText === "(2.8,1.6)"
    );
    if (!nextEndpoint) {
      throw new Error("Expected updated right endpoint handle after first drag frame.");
    }

    const second = applyEditAction(
      first.newSource,
      firstSnapshot.snapshot.editHandles,
      {
        kind: "moveHandle",
        handleId: nextEndpoint.id,
        newWorld: wp(2.88 * PT_PER_CM, 1.73 * PT_PER_CM)
      },
      { parseOptions: { sourceFingerprint: `source-revision:${documentId}:1:${first.newSource.length}` } }
    );
    expect(second.kind).toBe("success");
    if (second.kind !== "success") {
      throw new Error(`second moveHandle failed: ${second.kind}`);
    }
    expect(second.newSource).toContain("\\draw (1,2) -- (2.88,1.73);");
    expect(second.newSource).not.toMatch(/\)\s*\(/);
    expect(second.newSource).toContain("\\end{tikzpicture}");
  });

  it("uses revision source fingerprints when document identity is available", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}`;
    const result = await computeSnapshot({
      id: "source-identity",
      documentId: "doc-a",
      kind: "render",
      source,
      sourceRevision: 7,
      activeFigureId: "figure:0"
    });
    const expected = `source-revision:doc-a:7:${source.length}`;

    expect(result.snapshot.editHandles.length).toBeGreaterThan(0);
    expect(result.snapshot.editHandles.every((handle) => handle.sourceRef.sourceFingerprint === expected)).toBe(true);
  });

  it("uses parser and semantic incremental paths for move drags and keeps dependent edges correct", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) edge (B);
\end{tikzpicture}`;
    const nextSource = source.replace("(2,0)", "(2.5,0.6)");

    const seeded = await computeSnapshot({
      id: "drag-move-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "drag-move-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "drag-move-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.strategy).toBeDefined();
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
    expect(incremental.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("uses parser incremental patching for resize drags", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Long label text};
\end{tikzpicture}`;

    const seeded = await computeSnapshot({
      id: "resize-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const action = applyEditAction(source, seeded.snapshot.editHandles, {
      kind: "resizeElement",
      elementId: "path:0",
      role: "right",
      newWorld: wp(90, 0)
    });
    expect(action.kind === "success" || action.kind === "partial").toBe(true);
    if (!(action.kind === "success" || action.kind === "partial")) {
      throw new Error(`resizeElement failed: ${action.kind}`);
    }

    const incremental = await computeSnapshot({
      id: "resize-incremental",
      kind: "render",
      source: action.newSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: action.changedSourceIds ?? ["path:0"],
      patches: action.patches,
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "resize-canonical",
      kind: "render",
      source: action.newSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.trigger).toBe("drag-element");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
  });

  it("rebases coalesced drag patches and reports patch application", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,1) -- (1,2.4);
\end{tikzpicture}`;
    const skippedSource = source.replace("(1,2.4)", "(1.07,2.4)");
    const nextSource = skippedSource.replace("(1.07,2.4)", "(1.14,2.4)");

    const seeded = await computeSnapshot({
      id: "coalesced-drag-seed",
      kind: "render",
      source,
      sourceRevision: 0,
      activeFigureId: "figure:0"
    });
    const incremental = await computeSnapshot({
      id: "coalesced-drag-incremental",
      kind: "render",
      source: nextSource,
      sourceRevision: 2,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:0"],
      patches: [computeSinglePatch(skippedSource, nextSource)],
      patchBaseRevision: 1,
      trigger: "drag-handle"
    });
    const canonical = await computeSnapshot({
      id: "coalesced-drag-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.parsePatchApplication).toBe("rebased");
    expect(incremental.snapshot.incremental?.parseFallbackReason).toBeUndefined();
    expect(incremental.snapshot.incremental?.fallbackReason).toBeUndefined();
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
  });

  it("reports selective semantic replay for a small dependency closure with a long suffix", async () => {
    const source = makeClosureFigureWithLongTail(200);
    const nextSource = source.replace("(1.5, -0.5)", "(2.1, -0.1)");

    const seeded = await computeSnapshot({
      id: "closure-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "closure-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "closure-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.replayMode).toBe("selective");
    expect(incremental.snapshot.incremental?.corridorEndStatementIndex).toBe(3);
    expect(incremental.snapshot.incremental?.affectedStatementCount).toBe(2);
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
    expect(incremental.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("keeps later graphical scopes on the selective path", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \begin{scope}[shift={(10,0)}]
    \draw (0,0) rectangle (2,1);
    \node[draw] at (1,0.5) {Box};
  \end{scope}
\end{tikzpicture}`;
    const nextSource = source.replace("(2,0)", "(2.4,0.5)");

    const seeded = await computeSnapshot({
      id: "scope-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "scope-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "scope-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.replayMode).toBe("selective");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
  });

  it("keeps later foreach-origin fragments on the selective path", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \foreach \x in {0,1,2,3} {
    \draw (\x,3) circle (0.2);
  }
\end{tikzpicture}`;
    const nextSource = source.replace("(2,0)", "(2.3,0.35)");

    const seeded = await computeSnapshot({
      id: "foreach-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "foreach-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:1"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "foreach-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.replayMode).toBe("selective");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
  });

  it("keeps handle drags working when statement children regenerate ids", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0) -- (1,1);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.2,0.35)");

    const seeded = await computeSnapshot({
      id: "handle-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const incremental = await computeSnapshot({
      id: "handle-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:0"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-handle"
    });
    const canonical = await computeSnapshot({
      id: "handle-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.trigger).toBe("drag-handle");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
  });

  it("replays descendant scene elements when a scope move rewrites only scope options", async () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1560.27pt, yshift=-339.73pt]
    \filldraw[fill=blue!20] (1.5,0) rectangle (2.77,-1.24);
    \filldraw[fill=red!20] (1.75,-0.25) rectangle (3.02,-1.49);
  \end{scope}
\end{tikzpicture}`;

    const seeded = await computeSnapshot({
      id: "scope-move-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const action = applyEditAction(source, seeded.snapshot.editHandles, {
      kind: "moveElement",
      elementId: "scope:0",
      delta: wp(5, 2)
    });
    expect(action.kind === "success" || action.kind === "partial").toBe(true);
    if (!(action.kind === "success" || action.kind === "partial")) {
      throw new Error(`moveElement failed: ${action.kind}`);
    }

    const incremental = await computeSnapshot({
      id: "scope-move-incremental",
      kind: "render",
      source: action.newSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: action.changedSourceIds ?? ["scope:0"],
      patches: action.patches,
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "scope-move-canonical",
      kind: "render",
      source: action.newSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.trigger).toBe("drag-element");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
    expect(incremental.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("replays descendant scene elements when a scope resize rewrites only scope options", async () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \filldraw[fill=blue!20] (1.5,0) rectangle (2.77,-1.24);
    \filldraw[fill=red!20] (1.75,-0.25) rectangle (3.02,-1.49);
  \end{scope}
\end{tikzpicture}`;

    const seeded = await computeSnapshot({
      id: "scope-resize-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const action = applyEditAction(source, seeded.snapshot.editHandles, {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-left",
      newWorld: wp(-10, 10)
    });
    expect(action.kind === "success" || action.kind === "partial").toBe(true);
    if (!(action.kind === "success" || action.kind === "partial")) {
      throw new Error(`resizeElement failed: ${action.kind}`);
    }

    const incremental = await computeSnapshot({
      id: "scope-resize-incremental",
      kind: "render",
      source: action.newSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: action.changedSourceIds ?? ["scope:0"],
      patches: action.patches,
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "scope-resize-canonical",
      kind: "render",
      source: action.newSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.trigger).toBe("drag-element");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
    expect(incremental.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("keeps mixed scope descendants in sync for scope-resize SVG reuse", async () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \filldraw[fill=blue!20] (0,0) rectangle (1.2,-0.8);
    \draw[fill=green!20] (2,0) circle[radius=0.45];
    \node[draw, fill=yellow!20] at (3.2,-0.4) {A};
  \end{scope}
\end{tikzpicture}`;

    const seeded = await computeSnapshot({
      id: "scope-resize-mixed-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });

    const action = applyEditAction(source, seeded.snapshot.editHandles, {
      kind: "resizeElement",
      elementId: "scope:0",
      role: "top-left",
      newWorld: wp(-12, 10)
    });
    expect(action.kind === "success" || action.kind === "partial").toBe(true);
    if (!(action.kind === "success" || action.kind === "partial")) {
      throw new Error(`resizeElement failed: ${action.kind}`);
    }

    const incremental = await computeSnapshot({
      id: "scope-resize-mixed-incremental",
      kind: "render",
      source: action.newSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: action.changedSourceIds ?? ["scope:0"],
      patches: action.patches,
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "scope-resize-mixed-canonical",
      kind: "render",
      source: action.newSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(incremental.snapshot.incremental?.trigger).toBe("drag-element");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
    expect(incremental.snapshot.svg?.svg).toBe(canonical.snapshot.svg?.svg);
  });

  it("reuses the cached parse session for unchanged-source prewarm requests", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;

    await computeSnapshot({
      id: "prewarm-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const prewarm = await computeSnapshot({
      id: "prewarm-reuse",
      kind: "prewarm",
      source
    });

    expect(prewarm.snapshot.source).toBe(source);
    expect(prewarm.snapshot.parseResult).toBeNull();
    expect(prewarm.diagnostics).toEqual([]);
  });

  it("returns to the canonical full path after a drag frame", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.2,0)");

    const seeded = await computeSnapshot({
      id: "canonical-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const dragFrame = await computeSnapshot({
      id: "canonical-drag",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:0"],
      patches: [computeSinglePatch(source, nextSource)],
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "canonical-refresh",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(dragFrame.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(canonical.snapshot.incremental).toBeNull();
  });

  it("uses the incremental path for source scrubbing when a single contiguous patch is available", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1.0,0);
\end{tikzpicture}`;
    const nextSource = source.replace("1.0", "1.25");

    const seeded = await computeSnapshot({
      id: "scrub-seed",
      kind: "render",
      source,
      activeFigureId: "figure:0"
    });
    const patches = deriveSingleSourcePatch(source, nextSource);
    expect(patches).not.toBeNull();
    if (!patches) {
      throw new Error("Expected a contiguous scrub patch");
    }

    const incremental = await computeSnapshot({
      id: "scrub-incremental",
      kind: "render",
      source: nextSource,
      activeFigureId: seeded.snapshot.activeFigureId,
      changedSourceIds: ["path:0"],
      patches,
      trigger: "drag-element"
    });
    const canonical = await computeSnapshot({
      id: "scrub-canonical",
      kind: "render",
      source: nextSource,
      activeFigureId: "figure:0"
    });

    expect(incremental.snapshot.incremental?.parseStrategy).toBe("incremental");
    expect(normalizeForSceneComparison(incremental.snapshot.scene)).toEqual(
      normalizeForSceneComparison(canonical.snapshot.scene)
    );
  });
});

function computeSinglePatch(oldSource: string, newSource: string) {
  let prefix = 0;
  const limit = Math.min(oldSource.length, newSource.length);
  while (prefix < limit && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }

  let oldSuffix = oldSource.length;
  let newSuffix = newSource.length;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: newSource.slice(prefix, newSuffix)
  };
}

function makeClosureFigureWithLongTail(unrelatedPathCount: number): string {
  const lines = [
    "\\begin{tikzpicture}",
    "  \\node[draw] (A) at (-1, -1) {A};",
    "  \\node[draw] (B) at (1.5, -0.5) {B};",
    "  \\node[draw] (C) at (0, 1.5) {C};",
    "  \\draw (A) edge (B)",
    "        (B) edge (C)",
    "        (C) edge (A);"
  ];
  for (let index = 0; index < unrelatedPathCount; index += 1) {
    lines.push(`  \\draw (${index},0) -- (${index + 1},1);`);
  }
  lines.push("\\end{tikzpicture}");
  return lines.join("\n");
}
