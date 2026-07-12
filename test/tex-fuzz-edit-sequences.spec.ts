import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../packages/app/src/compute.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import {
  caseFromTexFuzzAst,
  generateTexFuzzCase,
  generateTexFuzzEditSequence,
  projectTexFuzzCaseToParagraph,
  runTexFuzzEditSequence,
  type TexFuzzComputeContext,
  type TexFuzzEditAdapter,
  type TexFuzzEditSequence,
} from "@tikz-editor/tex-fuzz";

function sourceAdapter(reuse = false): TexFuzzEditAdapter<string> {
  return {
    compute: (context: TexFuzzComputeContext<string>) => ({
      value: context.source,
      stages: {
        parser: context.previous && reuse
          ? { status: "reused", evidence: "test parser fragment identity" }
          : { status: "fresh" },
        shaping: { status: "fresh" },
      },
    }),
  };
}

const alpha = caseFromTexFuzzAst([{ kind: "text", value: "Alpha Beta" }]);
const gamma = caseFromTexFuzzAst([{ kind: "text", value: "Gamma" }]);

function singleSourcePatch(oldSource: string, newSource: string): SourcePatch {
  let prefix = 0;
  const limit = Math.min(oldSource.length, newSource.length);
  while (prefix < limit && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) prefix += 1;
  let oldSuffix = oldSource.length;
  let newSuffix = newSource.length;
  while (
    oldSuffix > prefix
    && newSuffix > prefix
    && oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }
  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: newSource.slice(prefix, newSuffix),
  };
}

function normalizeSnapshotOutput(value: unknown): string {
  return JSON.stringify(value, (key, current) => key === "runtimeId" ? undefined : current);
}

/** Adapter over the app's real parser/semantic/text/SVG compute pipeline. */
function appComputeAdapter(): TexFuzzEditAdapter<string> {
  let requestIndex = 0;
  return {
    compute: async (context) => {
      requestIndex += 1;
      if (context.purpose === "fresh-oracle" || !context.previous) {
        const response = await computeSnapshot({
          id: `tex-fuzz-full-${requestIndex}`,
          documentId: context.nodeId,
          source: context.source,
          sourceRevision: context.revision,
        });
        return {
          value: normalizeSnapshotOutput({ scene: response.snapshot.scene, svg: response.snapshot.svg?.svg }),
          stages: {
            parser: { status: "fresh" },
            semantic: { status: "fresh" },
            "tex-text-shaping": { status: "fresh" },
          },
        };
      }

      const patch = singleSourcePatch(context.previous.source, context.source);
      const previousParse = parseTikz(context.previous.source, { recover: true, includeContextDefinitions: true });
      const changedStatement = previousParse.figure.body.find((statement) =>
        statement.span.from <= patch.oldSpan.from && statement.span.to >= patch.oldSpan.to
      );
      if (!changedStatement) throw new Error("The integration edit must remain inside one TikZ statement.");
      const response = await computeSnapshot({
        id: `tex-fuzz-incremental-${requestIndex}`,
        documentId: context.nodeId,
        source: context.source,
        sourceRevision: context.revision,
        activeFigureId: previousParse.activeFigureId,
        changedSourceIds: [changedStatement.id],
        patches: [patch],
        patchBaseRevision: context.previous.revision,
        trigger: "drag-element",
      });
      const incremental = response.snapshot.incremental;
      if (!incremental) throw new Error("The app did not expose incremental compute instrumentation.");
      const parserReused = incremental.parseStrategy !== "full" && incremental.parserReusedStatementCount > 0;
      const semanticReused = incremental.strategy === "incremental" && incremental.reusedStatementCount > 0;
      return {
        value: normalizeSnapshotOutput({ scene: response.snapshot.scene, svg: response.snapshot.svg?.svg }),
        stages: {
          parser: parserReused ? {
            status: "reused",
            evidence: `strategy=${incremental.parseStrategy}; reused=${incremental.parserReusedStatementCount}`,
          } : { status: "fresh" },
          semantic: semanticReused ? {
            status: "reused",
            evidence: `strategy=${incremental.strategy}; reused=${incremental.reusedStatementCount}`,
          } : { status: "fresh" },
          // The compute metadata does not claim incremental TeX shaping, so neither do we.
          "tex-text-shaping": { status: "fresh" },
        },
      };
    },
  };
}

describe("stateful TeX fuzz edit sequences", () => {
  it("generates deterministic histories spanning the editor operation vocabulary", () => {
    const first = generateTexFuzzEditSequence(alpha, 20260711);
    const second = generateTexFuzzEditSequence(alpha, 20260711);
    expect(first).toEqual(second);
    expect(new Set(first.operations.map((operation) => operation.kind))).toEqual(new Set([
      "request-compute",
      "complete-compute",
      "selection",
      "edit",
      "undo",
      "redo",
      "stale-edit",
      "switch-node",
    ]));
    expect(new Set(first.operations.flatMap((operation) =>
      operation.kind === "edit" || operation.kind === "stale-edit" ? [operation.inputKind] : []
    ))).toEqual(new Set(["insert", "delete", "replace", "paste"]));
  });

  it("runs generated multi-node histories and records stale rejection and proven reuse", async () => {
    const sequence = generateTexFuzzEditSequence(alpha, 20260711);
    const result = await runTexFuzzEditSequence([
      { id: "node-a", case: alpha },
      { id: "node-b", case: gamma },
    ], sequence, sourceAdapter(true));

    expect(result.activeNodeId).toBe("node-a");
    expect(result.steps).toContainEqual(expect.objectContaining({ outcome: "discarded-stale" }));
    expect(result.steps).toContainEqual(expect.objectContaining({ outcome: "rejected-stale" }));
    expect(result.nodes.every((node) => node.installedSnapshotEquivalent)).toBe(true);
    expect(result.reuseComparisons).toContainEqual(expect.objectContaining({
      stage: "parser",
      evidence: "test parser fragment identity",
      freshEquivalent: true,
    }));
    expect(result.reuseComparisons.some((comparison) => comparison.stage === "shaping")).toBe(false);
  });

  it("retargets a stale snapshot edit only when the intended text is unique", async () => {
    const sequence: TexFuzzEditSequence = {
      seed: 1,
      operations: [
        { kind: "request-compute", requestId: "snapshot" },
        { kind: "complete-compute", requestId: "snapshot" },
        { kind: "edit", inputKind: "insert", mutation: { kind: "insert", offset: 0, text: "Prefix " } },
        {
          kind: "stale-edit",
          snapshotId: "snapshot",
          inputKind: "replace",
          target: { start: 6, end: 10, expectedText: "Beta" },
          mutation: { kind: "replace", start: 6, end: 10, text: "Delta" },
          policy: "retarget-unique",
        },
        { kind: "request-compute", requestId: "final" },
        { kind: "complete-compute", requestId: "final" },
      ],
    };
    const result = await runTexFuzzEditSequence([{ id: "node-a", case: alpha }], sequence, sourceAdapter());
    expect(result.steps[3]).toEqual(expect.objectContaining({
      outcome: "retargeted",
      source: "Prefix Alpha Delta",
    }));
  });

  it("delivers compute results out of order without installing stale source", async () => {
    const sequence: TexFuzzEditSequence = {
      seed: 2,
      operations: [
        { kind: "request-compute", requestId: "old" },
        { kind: "edit", inputKind: "paste", mutation: { kind: "insert", offset: 10, text: "!" } },
        { kind: "request-compute", requestId: "new" },
        { kind: "complete-compute", requestId: "new" },
        { kind: "complete-compute", requestId: "old" },
      ],
    };
    const result = await runTexFuzzEditSequence([{ id: "node-a", case: alpha }], sequence, sourceAdapter());
    expect(result.steps[3].outcome).toBe("installed");
    expect(result.steps[4].outcome).toBe("discarded-stale");
    expect(result.nodes[0].source).toBe("Alpha Beta!");
  });

  it("round-trips Unicode edits through byte-exact undo and redo", async () => {
    const unicode = caseFromTexFuzzAst([{ kind: "text", value: "café 😀" }]);
    const sequence: TexFuzzEditSequence = {
      seed: 3,
      operations: [
        { kind: "edit", inputKind: "replace", mutation: { kind: "replace", start: 0, end: 4, text: "naïve" } },
        { kind: "undo" },
        { kind: "redo" },
        { kind: "request-compute", requestId: "final" },
        { kind: "complete-compute", requestId: "final" },
      ],
    };
    const result = await runTexFuzzEditSequence([{ id: "node-a", case: unicode }], sequence, sourceAdapter());
    expect(result.steps[1].source).toBe("café 😀");
    expect(result.steps[2].source).toBe("naïve 😀");
  });

  it("rejects unsupported offsets and unsubstantiated incremental reuse claims", async () => {
    const invalidOffset: TexFuzzEditSequence = {
      seed: 4,
      operations: [{ kind: "edit", inputKind: "insert", mutation: { kind: "insert", offset: 99, text: "x" } }],
    };
    await expect(runTexFuzzEditSequence([{ id: "node-a", case: alpha }], invalidOffset, sourceAdapter()))
      .rejects.toThrow("outside source length");

    const falseReuse: TexFuzzEditSequence = {
      seed: 5,
      operations: [{ kind: "request-compute", requestId: "bad" }],
    };
    await expect(runTexFuzzEditSequence([{ id: "node-a", case: alpha }], falseReuse, {
      compute: ({ source }) => ({ value: source, stages: { parser: { status: "reused" } } }),
    })).rejects.toThrow("claims reuse without evidence");
  });

  it("compares genuinely reused app stages with a fresh render without claiming TeX shaping reuse", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {Alpha};
  \node (B) at (2,0) {\textbf{Beta}};
\end{tikzpicture}`;
    const initial = caseFromTexFuzzAst([{ kind: "text", value: source }]);
    const alphaStart = source.indexOf("Alpha");
    const sequence: TexFuzzEditSequence = {
      seed: 6,
      operations: [
        { kind: "request-compute", requestId: "seed" },
        { kind: "complete-compute", requestId: "seed" },
        {
          kind: "edit",
          inputKind: "replace",
          mutation: { kind: "replace", start: alphaStart, end: alphaStart + 5, text: "Omega" },
        },
        { kind: "request-compute", requestId: "incremental" },
        { kind: "complete-compute", requestId: "incremental" },
      ],
    };
    const result = await runTexFuzzEditSequence([{ id: "node-a", case: initial }], sequence, appComputeAdapter());

    expect(result.nodes[0].installedSnapshotEquivalent).toBe(true);
    expect(result.reuseComparisons).toContainEqual(expect.objectContaining({
      requestId: "incremental",
      stage: "parser",
      freshEquivalent: true,
    }));
    expect(result.reuseComparisons).toContainEqual(expect.objectContaining({
      requestId: "incremental",
      stage: "semantic",
      freshEquivalent: true,
    }));
    expect(result.reuseComparisons.some((comparison) => comparison.stage === "tex-text-shaping")).toBe(false);
  });

  it("runs generated TeX edit histories through the real app compute pipeline", async () => {
    for (let seed = 0; seed < 8; seed += 1) {
      const generated = projectTexFuzzCaseToParagraph(generateTexFuzzCase(50_000 + seed, {
        profile: "aggressive",
      }));
      const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {${generated.source}};
  \node (B) at (2,0) {Stable suffix};
\end{tikzpicture}`;
      const initial = caseFromTexFuzzAst([{ kind: "text", value: source }]);
      const contentStart = source.indexOf(generated.source);
      const replaceStart = contentStart + Math.min(2, Math.max(0, generated.source.length - 1));
      const sequence: TexFuzzEditSequence = {
        seed,
        operations: [
          { kind: "request-compute", requestId: `seed-${seed}` },
          { kind: "complete-compute", requestId: `seed-${seed}` },
          {
            kind: "edit",
            inputKind: "replace",
            mutation: { kind: "replace", start: replaceStart, end: replaceStart + 1, text: "Q" },
          },
          { kind: "request-compute", requestId: `incremental-${seed}` },
          { kind: "complete-compute", requestId: `incremental-${seed}` },
        ],
      };
      const result = await runTexFuzzEditSequence([{ id: `node-${seed}`, case: initial }], sequence, appComputeAdapter());
      expect(result.nodes[0].installedSnapshotEquivalent, `seed ${seed}`).toBe(true);
      expect(result.reuseComparisons.some((comparison) =>
        comparison.stage === "parser" && comparison.freshEquivalent
      ), `seed ${seed}`).toBe(true);
      expect(result.reuseComparisons.some((comparison) =>
        comparison.stage === "semantic" && comparison.freshEquivalent
      ), `seed ${seed}`).toBe(true);
    }
  }, 30_000);
});
