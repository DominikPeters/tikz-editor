import { describe, expect, it } from "vitest";

import { computeSnapshot } from "../packages/app/src/compute.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../packages/core/src/semantic/incremental.js";

type IncrementalFrame = {
  source: string;
  sourceRevision: number;
  patchBaseRevision: number;
  changedSourceIds: string[];
  patches: SourcePatch[];
};

describe("incremental equivalence harness", () => {
  it("matches full recompute across direct drag frames with snapping-style coordinate widths", async () => {
    const coordinateFrames = ["(1,2.4)", "(1.03,2.4)", "(1.04,2.4)", "(1.1,2.4)", "(1,2.4)"];
    const sourceForCoordinate = (coordinate: string) => String.raw`\begin{tikzpicture}
  \draw (0,1) -- ${coordinate};
\end{tikzpicture}`;
    const initialSource = sourceForCoordinate(coordinateFrames[0] ?? "(1,2.4)");
    const initialParse = parseTikz(initialSource, { recover: true });
    const changedSourceId = initialParse.figure.body[0]?.id ?? "path:0";
    const frames: IncrementalFrame[] = [];
    let previousSource = initialSource;
    for (let index = 1; index < coordinateFrames.length; index += 1) {
      const source = sourceForCoordinate(coordinateFrames[index] ?? "(1,2.4)");
      frames.push({
        source,
        sourceRevision: index,
        patchBaseRevision: index - 1,
        changedSourceIds: [changedSourceId],
        patches: [computeSinglePatch(previousSource, source)]
      });
      previousSource = source;
    }

    await expectIncrementalFramesEquivalent(initialSource, frames);
  });

  it("matches full recompute when a coalesced frame carries a stale patch base", async () => {
    const initialSource = String.raw`\begin{tikzpicture}
  \draw (0,1) -- (1,2.4);
\end{tikzpicture}`;
    const skippedSource = initialSource.replace("(1,2.4)", "(1.07,2.4)");
    const nextSource = skippedSource.replace("(1.07,2.4)", "(1.14,2.4)");
    const initialParse = parseTikz(initialSource, { recover: true });
    const changedSourceId = initialParse.figure.body[0]?.id ?? "path:0";

    await expectIncrementalFramesEquivalent(initialSource, [
      {
        source: nextSource,
        sourceRevision: 2,
        patchBaseRevision: 1,
        changedSourceIds: [changedSourceId],
        patches: [computeSinglePatch(skippedSource, nextSource)]
      }
    ], {
      expectedPatchApplication: "rebased"
    });
  });

  it("matches full recompute across repeated selective semantic frames", async () => {
    const initialSource = makeClosureFigureWithLongTail(60);
    const initialParse = parseTikz(initialSource, { recover: true });
    const changedSourceId = initialParse.figure.body[1]?.id ?? "path:1";
    const replacements = ["(2.1, -0.1)", "(2.25, -0.2)", "(2.4, -0.35)"];
    const frames: IncrementalFrame[] = [];
    let previousSource = initialSource;
    for (let index = 0; index < replacements.length; index += 1) {
      const source = previousSource.replace(/\([^)]*, -?0\.[^)]+\)|\(1\.5, -0\.5\)/, replacements[index] ?? "(2.1, -0.1)");
      frames.push({
        source,
        sourceRevision: index + 1,
        patchBaseRevision: index,
        changedSourceIds: [changedSourceId],
        patches: [computeSinglePatch(previousSource, source)]
      });
      previousSource = source;
    }

    await expectIncrementalFramesEquivalent(initialSource, frames, {
      expectedSemanticReplayMode: "selective"
    });
  });
});

async function expectIncrementalFramesEquivalent(
  initialSource: string,
  frames: readonly IncrementalFrame[],
  options: {
    expectedPatchApplication?: "direct" | "rebased";
    expectedSemanticReplayMode?: "selective" | "suffix";
  } = {}
): Promise<void> {
  const parseSession = createIncrementalParseSession();
  const initialParse = parseTikz(initialSource, { recover: true, includeContextDefinitions: true });
  parseSession.prime(initialParse, {
    activeFigureId: initialParse.activeFigureId,
    includeContextDefinitions: true,
    sourceRevision: 0
  });

  const semanticSession = createIncrementalSemanticSession();
  semanticSession.evaluate({
    figure: initialParse.figure,
    source: initialSource,
    hints: { trigger: "other" }
  });

  await computeSnapshot({
    id: "incremental-equivalence-seed",
    kind: "render",
    source: initialSource,
    sourceRevision: 0,
    activeRootId: initialParse.activeFigureId
  });

  for (const frame of frames) {
    const fullParse = parseTikz(frame.source, { recover: true, includeContextDefinitions: true });
    const incrementalParse = parseSession.evaluate({
      source: frame.source,
      sourceRevision: frame.sourceRevision,
      activeFigureId: fullParse.activeFigureId,
      includeContextDefinitions: true,
      patches: frame.patches,
      patchBaseRevision: frame.patchBaseRevision,
      changedSourceIds: frame.changedSourceIds,
      trigger: "drag-handle"
    });
    expect(incrementalParse.stats.strategy).toBe("incremental");
    if (options.expectedPatchApplication) {
      expect(incrementalParse.stats.patchApplication).toBe(options.expectedPatchApplication);
    }
    expect(normalizeForComparison(incrementalParse.parse.figure)).toEqual(normalizeForComparison(fullParse.figure));

    const incrementalSemantic = semanticSession.evaluate({
      figure: incrementalParse.parse.figure,
      source: frame.source,
      hints: {
        trigger: "drag-handle",
        changedSourceIds: frame.changedSourceIds
      }
    });
    const fullSemantic = evaluateTikzFigure(fullParse.figure, frame.source);
    expect(incrementalSemantic.semantic).toEqual(fullSemantic);
    if (options.expectedSemanticReplayMode) {
      expect(incrementalSemantic.stats.replayMode).toBe(options.expectedSemanticReplayMode);
    }

    const incrementalCompute = await computeSnapshot({
      id: `incremental-equivalence-${frame.sourceRevision}`,
      kind: "render",
      source: frame.source,
      sourceRevision: frame.sourceRevision,
      activeRootId: fullParse.activeFigureId,
      changedSourceIds: frame.changedSourceIds,
      patches: frame.patches,
      patchBaseRevision: frame.patchBaseRevision,
      trigger: "drag-handle"
    });
    const fullCompute = await computeSnapshot({
      id: `incremental-equivalence-full-${frame.sourceRevision}`,
      kind: "render",
      source: frame.source,
      sourceRevision: frame.sourceRevision,
      activeRootId: fullParse.activeFigureId
    });
    expect(normalizeForComparison(incrementalCompute.snapshot.scene)).toEqual(normalizeForComparison(fullCompute.snapshot.scene));
    if (options.expectedPatchApplication) {
      expect(incrementalCompute.snapshot.incremental?.parsePatchApplication).toBe(options.expectedPatchApplication);
    }
  }
}

function computeSinglePatch(oldSource: string, newSource: string): SourcePatch {
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

function normalizeForComparison<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, currentValue) => {
      if (key === "runtimeId") {
        return undefined;
      }
      return currentValue;
    })
  ) as T;
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
